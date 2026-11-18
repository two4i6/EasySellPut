// Shared build-only toolchain; runtime apps have no esbuild/GEX dependency.
import {createRequire} from 'node:module';
import path from 'node:path';
const require = createRequire(new URL('../qqq-gex/package.json', import.meta.url));
const {build} = require('esbuild');
const [entry, output] = process.argv.slice(2);
if (!entry || !output || process.argv.length !== 4) throw Error('Usage: build-engine.mjs <entry> <output>');
await build({entryPoints:[path.resolve(entry)],outfile:path.resolve(output),bundle:true,platform:'node',format:'esm',target:'node24'});
