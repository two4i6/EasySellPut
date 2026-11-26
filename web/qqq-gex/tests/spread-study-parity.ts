import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {readMcpAnalysis} from '../runtime/mcp-analysis';import {hydrateDay} from '../runtime/local-rows';import {qqqSpreadStudy,studyLegQuote} from '../upstream/src/lib/qqqSpreadStudy';
const dir=mkdtempSync(path.join(tmpdir(),'gex-spread-parity-')),dbPath=path.join(dir,'archive.db'),input=path.join(dir,'input.json');
const capturedAt='2026-01-02T15:00:00Z',receivedAt='2026-01-02T15:00:06Z',at=Date.parse('2026-01-02T15:00:06Z'),expiry='2026-01-02';
writeFileSync(input,JSON.stringify({symbol:'QQQ',source:'synthetic-two-leg-parity',captures:[{valuationAt:capturedAt,expiry:Date.parse(expiry)/1000,spot:600,result:{receivedAt,options:[{calls:[599,600,601].map(strike=>({strike,impliedVolatility:.2,openInterest:100,bid:3-(strike-599)*.5,ask:3.1-(strike-599)*.5})),puts:[599,600,601].map(strike=>({strike,impliedVolatility:.22,openInterest:100,bid:2+(strike-599)*.5,ask:2.1+(strike-599)*.5}))}]}}],bars:[{timestamp:'2026-01-02T14:58:00Z',open:600,high:601,low:599,close:600,volume:1000}]}));
try{
 execFileSync(process.execPath,['runtime-dist/import.mjs',input,dbPath],{stdio:['ignore','pipe','pipe']});const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  const stored=JSON.parse(String(db.prepare('SELECT payload FROM qqq_gex_local_days WHERE day=?').get(expiry).payload)),day=hydrateDay(db,stored),row=day.rows[0];let cases=0;
  for(const side of ['put','call'] as const)for(const basis of ['bidAsk','mid'] as const)for(const ivShockPp of [-5,0,5])for(const fees of [0,1])for(const manualCredit of [null,.2]){
   const shortStrike=600,longStrike=side==='put'?599:601,url=new URL('http://local/api/analysis/qqq/local-analysis');for(const[k,v]of Object.entries({date:expiry,expiry,at:new Date(at).toISOString(),analysis:'spreadStudy',side,basis,ivShockPp,fees,shortStrike,longStrike,...manualCredit===null?{}:{manualCredit}}))url.searchParams.set(k,String(v));
   const actual=(await readMcpAnalysis(dbPath,url)).result,{quoteSelection,...study}=actual;
   const expected=qqqSpreadStudy({profile:row.profile,expiry,at:Date.parse(row.sourceAsOf),cutoff:at,spot:600,side,shortStrike,longStrike,ivShockPp,fees,basis,manualCredit});
   assert.equal(studyLegQuote(row.profile.find(r=>r.strike===shortStrike),side,at).valid,true);assert.equal(study.available,true);assert.equal(quoteSelection.fallbackRequested,true);assert.equal(quoteSelection.selectedSourceAt,new Date(row.sourceAsOf).toISOString());assert.deepEqual(study,expected);cases++;
  }
  console.log(JSON.stringify({kind:'synthetic-positive-spread-original-kernel-parity',cases,quoteProvenance:'known receipt; source quote time remains unknown; not certified executable real market'}));
 }finally{db.close();}
}finally{rmSync(dir,{recursive:true,force:true});}
