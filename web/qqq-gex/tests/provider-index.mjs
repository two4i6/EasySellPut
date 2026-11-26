import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
const dir=mkdtempSync(path.join(tmpdir(),'gex-provider-index-')),dbPath=path.join(dir,'archive.db'),db=new DatabaseSync(dbPath);
const query=params=>JSON.parse(execFileSync(process.execPath,['runtime-dist/query.mjs',dbPath,'/api/analysis/qqq/local-archive?'+new URLSearchParams({resource:'providers',...params})],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
try{
 assert.deepEqual(query({}).items,[]);
 db.exec('CREATE TABLE qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB)');
 const insert=db.prepare('INSERT INTO qqq_gex_provider_raw VALUES(?,?,?,?,?)');for(let i=0;i<3;i++)insert.run(String(i).repeat(64),'fixture',i*1000,i*1000+500,Buffer.from('fixture'));
 const first=query({pageSize:'1'});assert.equal(first.total,3);assert.equal(first.items[0].receivedAt,'1970-01-01T00:00:00.500Z');assert.equal(first.items[0].publicationAt,'1970-01-01T00:00:00.000Z');assert.equal(first.items[0].storedBytes,7);
 const second=query({pageSize:'1',page:'2',revision:first.revision});assert.equal(second.items[0].providerHash,'1'.repeat(64));assert.equal(second.hasMore,true);
 insert.run('3'.repeat(64),'fixture',3000,3500,Buffer.from('fixture'));assert.equal(query({pageSize:'1',page:'2',revision:first.revision}).status,'revision_changed');
 assert.throws(()=>query({date:'2026-01-02'}));assert.throws(()=>query({page:'2'}));console.log('PASS original provider metadata pagination, source/receipt separation and revision fencing; fixture only');
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
