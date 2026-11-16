import {build} from 'esbuild';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));await build({absWorkingDir:root,entryPoints:['runtime/import-cli.ts'],bundle:true,platform:'node',format:'esm',outfile:'runtime-dist/import.mjs',target:'node24',alias:{'@':path.join(root,'upstream/src')}});
await build({absWorkingDir:root,entryPoints:['runtime/benchmark.ts'],bundle:true,platform:'node',format:'esm',outfile:'runtime-dist/benchmark.mjs',target:'node24',alias:{'@':path.join(root,'upstream/src')}});
await build({absWorkingDir:root,entryPoints:['runtime/query.ts'],bundle:true,platform:'node',format:'esm',outfile:'runtime-dist/query.mjs',target:'node24',alias:{'@':path.join(root,'upstream/src')}});

await build({absWorkingDir:root,entryPoints:['runtime/history.ts'],bundle:true,platform:'node',format:'esm',outfile:'runtime-dist/history.mjs',target:'node24',alias:{'@':path.join(root,'upstream/src')}});
