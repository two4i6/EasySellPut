import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const db=process.argv[2];if(!db)throw Error('Pass local pipeline fixture DB');
const query=path=>JSON.parse(execFileSync(process.execPath,[new URL('../runtime-dist/query.mjs',import.meta.url).pathname,db,path],{encoding:'utf8'}));
const replay=query('/api/analysis/qqq/pcs/backtest?stream=signals&from=2026-01-02T05:00:00Z&to=2026-01-03T05:00:00Z&page=1&pageSize=1');assert.equal(replay.available,true);assert.equal(replay.fingerprint,replay.repeatedFingerprint);assert.equal(replay.completeDays,0);assert.ok(Array.isArray(replay.items));
const window=query('/api/analysis/qqq/pcs?from=2026-01-02T14:30:00Z&to=2026-01-02T14:34:00Z&gexDisplay=1&gexOverview=1');assert.equal(window.view.mode,'historical');assert.ok(window.intraday.bars.every(b=>Date.parse(b.timestamp)<=Date.parse('2026-01-02T14:34:00Z')));
const context=query('/api/analysis/qqq/gex/intraday-context?date=2026-01-02&dte=6&include=volume');assert.equal(context.dte,6);assert.equal(context.days.length,20);assert.equal(context.referenceComplete,false);assert.ok(context.days.every(d=>d.levels.length===0));
console.log('PASS: original replay determinism/partial coverage, inclusive PCS window and arbitrary context DTE');
