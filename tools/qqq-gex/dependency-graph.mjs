import {sourceChartModule} from '../../web/qqq-gex/source-chart.mjs';
// Conservative graph of actual browser/runtime/build/test roots. Data-only source
// extraction inputs are retained without treating their old hosted imports as executable roots.
import ts from '../../web/qqq-gex/node_modules/typescript/lib/typescript.js';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {sourcePcsModule} from '../../web/qqq-gex/source-pcs.mjs';import {sourceMacroModule} from '../../web/qqq-gex/source-macro.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(repo,'web/qqq-gex'),upstream=path.join(root,'upstream'),manifest=JSON.parse(await readFile(path.join(root,'source-manifest.json'),'utf8'));
const dataOnly=new Set(['src/app/api/analysis/qqq/pcs/route.ts','src/services/orchestrators/macroDataService.ts','src/lib/qqqIntradayDirectionalReplayHistory.ts'].map(p=>path.join(upstream,p)));
const virtual=new Map([['source:qqq-chart',await sourceChartModule(root)],['source:qqq-pcs',{text:(await sourcePcsModule(root)).contents,dir:root}],['source:qqq-macro',await sourceMacroModule(root)],['source:qqq-day-coverage',{text:'',dir:root}]]);for(const value of virtual.values()){value.text??=value.contents;value.dir??=value.resolveDir;}
const queue=[],seen=new Set(),required=new Set(dataOnly),edges=[],packages=new Set(['esbuild','typescript','@playwright/test']),unresolved=[],dynamic=[];
const add=(file,mode,from='root')=>queue.push({file,mode,from});
add(path.join(root,'main.tsx'),'browser');for(const p of ['import-cli.ts','query.ts','history.ts','benchmark.ts'])add(path.join(root,'runtime',p),'runtime');
for(const f of await readdir(path.join(root,'tests')))if(/\.(?:mjs|ts|tsx)$/.test(f))add(path.join(root,'tests',f),'test');
for(const f of manifest.files)if(/\.test\.[tj]sx?$/.test(f.path))add(path.join(upstream,f.path),'test');
for(const p of ['build.mjs','build-runtime.mjs','source-pcs.mjs','source-macro.mjs','source-chart.mjs'])add(path.join(root,p),'build');
async function resolve(spec,dir){for(const p of [path.resolve(dir,spec),...['.ts','.tsx','.mjs','.js','.json','.css'].map(e=>path.resolve(dir,spec)+e),...['index.ts','index.tsx','index.js'].map(n=>path.resolve(dir,spec,n))])try{if((await stat(p)).isFile())return p;}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}return null;}
while(queue.length){const {file,mode,from}=queue.pop(),key=mode+'|'+file;if(seen.has(key))continue;seen.add(key);if(virtual.has(file)){const value=virtual.get(file);await scan(value.text,file,value.dir,mode);continue;}required.add(file);if(!/\.(?:mjs|js|ts|tsx)$/.test(file))continue;
 let text=await readFile(file,'utf8');if(mode==='runtime'&&/(?:qqqIntradayDirectionalSummary|engineTimeline|qqqGexBacktestHistory|qqqIntradayBacktestHistory|qqqGexHistory)\.ts$/.test(file))text=text.replace("import { readQqqIntradayDirectionalReplay } from './qqqIntradayDirectionalReplayHistory';",'').replace("import { supabaseAdmin } from './supabase';",'');
 await scan(text,file,path.dirname(file),mode);
}
async function scan(text,file,dir,mode){const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);async function edge(spec,typeOnly=false){let target;
 if(virtual.has(spec))target=spec;
 else if(spec==='next/dynamic'||spec==='next/link')target=path.join(root,'adapters',spec.endsWith('dynamic')?'dynamic.tsx':'link.tsx');
 else if(mode==='browser'&&spec.endsWith('QqqCacheHealth'))target=path.join(root,'adapters/cache-health.tsx');
 else if(mode==='browser'&&spec==='@/components/Strategy/qqq/QqqNextActionCard')target=path.join(root,'adapters/next-action.tsx');
 else if(spec.startsWith('@/'))target=await resolve('./'+spec.slice(2),path.join(upstream,'src'));
 else if(spec.startsWith('.'))target=await resolve(spec,dir);
 else {if(!typeOnly&&!spec.startsWith('node:')&&!['crypto','fs','path','os','stream','util','bun:test'].includes(spec))packages.add(spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]);return;}
 if(!target){unresolved.push({from:path.relative(root,file),spec,mode,typeOnly});return;}edges.push({from:path.relative(root,file),to:virtual.has(target)?target:path.relative(root,target),mode,typeOnly});add(target,mode,file);}
 const jobs=[];function visit(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){const only=ts.isImportDeclaration(node)?node.importClause?.isTypeOnly:node.isTypeOnly;jobs.push(edge(node.moduleSpecifier.text,only));}
 if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){const first=node.arguments[0];if(first&&ts.isStringLiteralLike(first))jobs.push(edge(first.text));else dynamic.push({from:path.relative(root,file),mode,expression:node.getText(tree).slice(0,180)});}
 if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.[0]&&ts.isStringLiteralLike(node.arguments[0])&&/\.(?:ts|tsx|mjs|js|json|css)$/.test(node.arguments[0].text)){const parent=node.parent;if(!(ts.isCallExpression(parent)&&/writeFile/.test(parent.expression.getText(tree))))jobs.push(edge(node.arguments[0].text));}ts.forEachChild(node,visit);}visit(tree);await Promise.all(jobs);}
const retained=manifest.files.filter(f=>required.has(path.join(upstream,f.path))),unused=manifest.files.filter(f=>!required.has(path.join(upstream,f.path)));
const report={sourceCommit:manifest.commit,roots:'Browser main/aliased adapters/workers; four runtime entrypoints; source extraction files as data-only; all local test sources and all pinned source tests; build helpers.',retained:retained.map(f=>f.path),unusedCandidates:unused.map(f=>({path:f.path,bytes:f.bytes})),requiredPackages:[...packages].sort(),unresolved,dynamic,edges,limitations:'Conservative imports, including type edges; unresolved/dynamic edges require manual review before deletion. Node_modules are package boundaries, not copied source roots.'};
await writeFile(path.join(root,'test-results/dependency-graph.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({retained:retained.length,unusedCandidates:unused.length,candidateSourceBytes:unused.reduce((n,f)=>n+f.bytes,0),requiredPackages:report.requiredPackages,unresolved,dynamic}));
