// Synthetic contract tests only. Never imports into a user's cache or claims market coverage.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const directory=mkdtempSync(path.join(tmpdir(),'qqq-pulse-parity-'));
const start=Date.parse('2026-01-02T14:30:00Z');
const iso=offset=>new Date(start+offset*60000).toISOString();
try {
 for(const gap of [false,true]) {
  const captures=Array.from({length:22},(_,i)=>[2,5].map(d=>({
   valuationAt:iso(i*2),expiry:Date.parse(`2026-01-0${d}`)/1000,spot:600+i*.1,
   result:{receivedAt:iso(i*2+.1),options:[{calls:[{strike:600,impliedVolatility:.2,openInterest:100+i}],puts:[{strike:600,impliedVolatility:.22,openInterest:70+i}]}]}
  }))).flat();
  const bars=Array.from({length:22},(_,i)=>({timestamp:iso(i*2),open:600+i*.1,high:601+i*.1,low:599+i*.1,close:600+i*.1,volume:100+i})).filter((_,i)=>!gap||i!==8);
  const input=path.join(directory,`${gap}.json`),db=path.join(directory,`${gap}.db`);
  writeFileSync(input,JSON.stringify({symbol:'QQQ',source:'synthetic-positive-and-gap-test',captures,bars}));
  execFileSync(process.execPath,['runtime-dist/import.mjs',input,db],{stdio:['ignore','pipe','pipe']});
  execFileSync(process.execPath,['test-results/mcp-kernel-parity.mjs'],{env:{...process.env,QQQ_PARITY_DB:db,QQQ_PARITY_SYNTHETIC:"1"},stdio:'inherit'});
  const query=(analysis,minute)=>JSON.parse(execFileSync(process.execPath,['runtime-dist/query.mjs',db,'/api/analysis/qqq/local-analysis?'+new URLSearchParams({date:'2026-01-02',expiry:'2026-01-02',at:iso(minute),analysis})],{encoding:'utf8'}));
  const early=query('pulse',23),opening=query('pulse',31),last=query('pulse',43);
  assert.equal(early.complete,false);
  assert.equal(opening.result.points.at(-1).openingHigh!==null,!gap,'OR30 requires an unbroken opening prefix');
  assert.equal(early.result.volatility[0].realized!==null,!gap,'10m window rejects the missing bar');
  assert.equal(last.result.volatility[0].realized!==null,true,'short-window RV recovers after the gap passes');
  assert.equal(last.result.volatility[1].realized!==null,!gap,'30m window still detects the gap');
  assert.equal(last.result.rvol.value,null,'no historical baseline is not zero RVOL');
  assert.equal(last.result.rvol.sampleDays,0);
  const table=query('replayTable',31).result;
  assert.ok(table.length>1);
  assert.ok(table.every(row=>row.time<=Date.parse(iso(31))));
  assert.ok(table[0].delta.reason,'first snapshot has no preceding comparison');
  console.log(`PASS synthetic ${gap?'missing-bar':'continuous'} cohort: causal replay, positive RV/OR30, gap invalidation/recovery and absent RVOL baseline.`);
 }
} finally {rmSync(directory,{recursive:true,force:true});}
