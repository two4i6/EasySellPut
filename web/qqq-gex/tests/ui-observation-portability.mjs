// Actual pinned UI transformed with native path/newline conventions, not copied algorithms.
import {readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';import {transform} from 'esbuild';import {observeUi} from '../adapters/observe-ui.mjs';
for(const name of ['QqqExposureWorkbench.tsx','QqqWallTouchStatsCard.tsx','QqqSpreadStudyCard.tsx','QqqPcsGexIntradayChart.tsx','QqqHeatmapInspector.tsx']){
 const path=readdirSync('upstream',{recursive:true}).find(p=>p.endsWith('/'+name));assert.ok(path,name);
 const source=readFileSync('upstream/'+path,'utf8').replaceAll('\r\n','\n');
 const unix=observeUi(source,`/repo/${name}`),windows=observeUi(source.replaceAll('\n','\r\n'),`C:\\repo\\${name}`);
 assert.equal(windows,unix,`${name}: Windows and Unix must emit identical observation hooks`);
 assert.ok(windows.includes(name.includes('Intraday')?'data-qqq-hover':name.includes('Inspector')?'data-qqq-inspection':'qqq-local:observed-'));
 await transform(windows,{loader:'tsx'});
}
console.log('PASS pinned UI observation hooks: Windows backslash/CRLF and Unix slash/LF produce identical valid TSX');
