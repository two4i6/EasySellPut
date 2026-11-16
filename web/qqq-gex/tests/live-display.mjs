// Test-only clock supplied explicitly to child Node. Production clears NODE_OPTIONS.
import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const folder=mkdtempSync(path.join(tmpdir(),'qqq-live-display-')),clock=path.join(folder,'clock.mjs'),db=path.join(folder,'local.db');writeFileSync(clock,"const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-01-02T15:02:00Z']));}static now(){return NativeDate.parse('2026-01-02T15:02:00Z');}};");
execFileSync(process.execPath,['--import',clock,'runtime-dist/import.mjs','test-results/pcs-input.json',db],{encoding:'utf8'});
const read=query=>JSON.parse(execFileSync(process.execPath,['--import',clock,'runtime-dist/query.mjs',db,query],{encoding:'utf8',maxBuffer:32*1024*1024}));
const full=read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1');assert.equal(full.view.mode,'live');assert.equal(full.daily.eligibility.value,'OPEN');assert.equal(full.timing.value,'NOW');assert.equal(full.candidate.status,'READY');assert.ok(full.intraday.bars.length);assert.equal(full.asOf,'2026-01-02T15:02:00.000Z');assert.notEqual(full.observedAt,full.asOf);assert.ok(full.lifecycle.points.length);assert.equal(read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1&regimeMode=overlay').regime.selectedEngine,'overlay');
const compact=read('/api/analysis/qqq/pcs?gexDisplay=1&gexEvidence=1&gexWindow=latest&localLive=1');assert.equal(compact.view.mode,'live');assert.equal(compact.intraday.bars,undefined);console.log('PASS: actual local import → original live PCS detail/evidence, OPEN/NOW/READY, stored lifecycle and separate model time; overlay selection preserved');

const decision=read('/api/analysis/qqq/pcs/local-decision');
assert.deepEqual(full.intraday.directional.current,decision.directional.decision);
assert.deepEqual(full.intraday.directional.signals,decision.directional.canonicalSignals);
assert.equal(full.intraday.directional.liveStatus.available,decision.directional.storageAvailable);
assert.deepEqual(compact.intraday.directional,full.intraday.directional);
assert.deepEqual(read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1').intraday.directional,full.intraday.directional);
console.log('PASS: monitor detail/evidence and read-only MCP decision share canonical directional state under identical evaluation clock');
const {DatabaseSync}=await import('node:sqlite');
let database=new DatabaseSync(db);const count=()=>database.prepare('SELECT count(*) n FROM qqq_gex_live_signals').get().n;
const before=count();read('/api/analysis/qqq/pcs/local-decision');read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1');assert.equal(count(),before);database.close();
writeFileSync(clock,"const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-01-02T22:02:00Z']));}static now(){return NativeDate.parse('2026-01-02T22:02:00Z');}};");
const closed=read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1');assert.ok(!['ALERT_LONG','ALERT_SHORT'].includes(closed.intraday.directional.current.status));
database=new DatabaseSync(db);database.exec('DROP TABLE qqq_gex_live_signals');database.close();
const missing=read('/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest&localLive=1');assert.equal(missing.intraday.directional.liveStatus.available,false);assert.ok(missing.intraday.directional.liveStatus.reason);assert.deepEqual(missing.intraday.directional.signals,[]);
console.log('PASS: decision/display reads do not persist alerts, closed session does not promote actionable signal, missing store disables live alert availability');
