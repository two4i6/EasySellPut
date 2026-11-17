import assert from 'node:assert/strict';import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{execFileSync}from'node:child_process';import{DatabaseSync}from'node:sqlite';
const dir=mkdtempSync(path.join(tmpdir(),'gex-partial-read-')),dbPath=path.join(dir,'archive.db'),input=path.join(dir,'input.json');
const query=p=>JSON.parse(execFileSync(process.execPath,['runtime-dist/query.mjs',dbPath,'/api/analysis/qqq/local-archive?'+new URLSearchParams(p)],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
try{
 writeFileSync(input,JSON.stringify({symbol:'QQQ',source:'synthetic-partial-archive',captures:[{valuationAt:'2026-01-02T15:00:00Z',sourceTimeAligned:false,expiry:Date.parse('2026-01-02')/1000,spot:600,result:{receivedAt:'2026-01-02T15:00:02Z',options:[{calls:[599,600].map(strike=>({strike,impliedVolatility:.2,openInterest:100})),puts:[599,600].map(strike=>({strike,impliedVolatility:.2,openInterest:100}))}]}}],bars:[]}));
 const imported=JSON.parse(execFileSync(process.execPath,['runtime-dist/import.mjs',input,dbPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(imported.status,'partial');
 assert.equal(query({resource:'dates'}).items.length,0);const dates=query({resource:'dates',archiveState:'partial'});assert.equal(dates.items[0].date,'2026-01-02');assert.equal(dates.archiveState,'partial');assert.equal(dates.complete,false);
 const snapshots=query({resource:'snapshots',date:'2026-01-02',archiveState:'partial'});assert.equal(snapshots.items[0].sourceTimeAligned,false);
 const args={resource:'profile',archiveState:'partial',date:'2026-01-02',expiry:'2026-01-02',capturedAt:snapshots.items[0].capturedAt,pageSize:'1'};
 const first=query(args),second=query({...args,page:'2',revision:first.revision});assert.equal(first.total,2);assert.equal(second.items.length,1);assert.equal(second.hasMore,false);assert.notEqual(first.items[0].strike,second.items[0].strike);
 assert.deepEqual(query({resource:'bars',date:'2026-01-02',archiveState:'partial'}).items,[]);
 const db=new DatabaseSync(dbPath);try{db.exec("UPDATE qqq_gex_partial_days SET revision='changed'");assert.equal(query({...args,page:'2',revision:first.revision}).status,'revision_changed');db.exec("UPDATE qqq_gex_partial_days SET sha256='bad'");assert.throws(()=>query(args));}finally{db.close();}
 console.log('PASS partial-only dates/snapshots/lossless profiles/bars remain separate, paginated, integrity checked and never certified as regular replay');
}finally{rmSync(dir,{recursive:true,force:true});}
