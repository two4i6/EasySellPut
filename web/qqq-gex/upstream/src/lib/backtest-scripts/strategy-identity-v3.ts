/** Pin the complete statically reachable local import closure, lockfiles and external entry bytes.
 * Computed before AND after execution; source changes during a run fail closed.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

export type StrategyDependencySelection={loaderPath:string;selected:string|readonly string[];alternatives:readonly string[]};
const dependencyScans=new Map<string,{hash:string;runtimeImports:Set<string>;requires:Set<string>;imports:Set<string>}>();
export async function resolveStrategyIdentity(root: string, strategyPath: string, entryRoots: readonly string[],
  selection?:StrategyDependencySelection|readonly StrategyDependencySelection[]) {
  const selections:readonly StrategyDependencySelection[]=selection===undefined?[]:Array.isArray(selection)?selection:[selection as StrategyDependencySelection];
  if(new Set(selections.map(s=>s.loaderPath)).size!==selections.length)throw Error('Duplicate lazy dependency dispatcher');
  const files = new Map<string, string>(), packages = new Map<string, { entry: string; sha256: string }>();
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  async function locate(base: string): Promise<string> {
    for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js']) {
      const path = base + suffix;
      try { if ((await stat(path)).isFile()) return path; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    throw new Error(`Unresolved identity dependency: ${base}`);
  }
  async function visit(path: string): Promise<void> {
    const key = relative(root, path);
    if (key.startsWith('..')) throw new Error('Identity dependency outside repository');
    if (files.has(key)) return;
    const bytes = await readFile(path), digest=hash(bytes); files.set(key,digest);
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    let scan=dependencyScans.get(path);
    if(scan?.hash!==digest){
      const source=bytes.toString('utf8');
      const runtimeImports = new Set<string>();
      const requires=new Set<string>(),imports=new Set<string>();
      // Runtime computed imports cannot be pinned by static traversal; never silently ignore them.
      const ast = ts.createSourceFile(key, source, ts.ScriptTarget.Latest, true);
      const inspect = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const onlyNamedTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly);
          if (!clause?.isTypeOnly && !(onlyNamedTypes && !clause?.name)) {
            runtimeImports.add(node.moduleSpecifier.text);imports.add(node.moduleSpecifier.text);
          }
        }
        if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const onlyNamedTypes = node.exportClause && ts.isNamedExports(node.exportClause)
            && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly);
          if (!onlyNamedTypes) {runtimeImports.add(node.moduleSpecifier.text);imports.add(node.moduleSpecifier.text);}
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) {
            throw new Error(`Computed dependency requires explicit identity: ${key}`);
          }
          runtimeImports.add(node.arguments[0].text);
          (node.expression.kind===ts.SyntaxKind.ImportKeyword?imports:requires).add(node.arguments[0].text);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(ast);
      scan={hash:digest,runtimeImports,requires,imports};
      if(dependencyScans.size>=512)dependencyScans.delete(dependencyScans.keys().next().value!);
      dependencyScans.set(path,scan);
    }
    // Every call rereads and hashes bytes; only unchanged import syntax is reused.
    const runtimeImports=new Set(scan.runtimeImports),requires=scan.requires,imports=scan.imports;
    const dispatch=selections.find(s=>key===s.loaderPath);
    if(dispatch){
      const selected=typeof dispatch.selected==='string'?[dispatch.selected]:dispatch.selected;
      if(!selected.length||new Set(selected).size!==selected.length
        ||new Set(dispatch.alternatives).size!==dispatch.alternatives.length
        ||selected.some(name=>!dispatch.alternatives.includes(name))
        ||requires.size!==dispatch.alternatives.length
        ||[...requires].some(name=>!dispatch.alternatives.includes(name))
        ||dispatch.alternatives.some(name=>imports.has(name)))
        throw Error('Lazy strategy dependency declaration mismatch');
      // This is an explicit literal dispatch, not an unpinned computed import.
      // The complete loader bytes remain pinned; only the selected strategy executes.
      for(const name of dispatch.alternatives)if(!selected.includes(name))runtimeImports.delete(name);
    }
    for (const name of runtimeImports) {
      if (name.startsWith('node:') || builtinModules.includes(name)) continue;
      if (name.startsWith('.') || name.startsWith('@/')) {
        await visit(await locate(name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(path), name)));
      } else {
        for(const mode of ['import','require'] as const){
          if(!(mode==='import'?imports:requires).has(name))continue;
          const entry=mode==='require'?createRequire(path).resolve(name)
            :fileURLToPath(import.meta.resolve(name,pathToFileURL(path).href));
          // Resolve from the actual importer and retain both runtime conditions.
          const identityKey=`${name}#${mode}:${relative(root,entry)}`;
          if(!packages.has(identityKey))packages.set(identityKey,{entry:relative(root,entry),sha256:hash(await readFile(entry))});
        }
      }
    }
  }
  for (const path of [...entryRoots, 'package.json', 'bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig.json']) await visit(resolve(root, path));
  const local = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 }));
  const external = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, ...value }));
  return { strategyHash: files.get(strategyPath)!, closureHash: hash(JSON.stringify({ local, external,...(selection?{selection}:{}) })),
    local, external, sdkVersion: 2, runtime: { node: process.versions.node, bun: process.versions.bun ?? null },
    externalDependencyContract: 'importer-relative ESM/CJS entry bytes + pinned lockfiles; installed transitive package tree not independently attested' };
}

