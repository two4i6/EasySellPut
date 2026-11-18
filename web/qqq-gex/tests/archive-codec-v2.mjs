import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {encodeArchiveBytes,decodeArchiveBytes,encodeArchiveBody,decodeArchiveBody} from '../runtime/archive-body.ts';
import {copyForCodecExperiment,migrateCodecExperimentCopy} from './archive-codec-migration.mjs';
const dir=mkdtempSync(path.join(tmpdir(),'gex-codec-v2-'));const hash=b=>createHash('sha256').update(b).digest('hex');
const inputBytes=Buffer.concat([Buffer.from('{"price":600.0000000000001,"time":"2026-01-02T14:32:00Z","中文":"原始"}'),Buffer.from(Array.from({length:65536},(_,i)=>i%256))]);
for(const bytes of [Buffer.alloc(0),inputBytes]){
 const encoded=encodeArchiveBytes(bytes,'brotli-v2');assert.deepEqual(decodeArchiveBytes(encoded,bytes.length),bytes);
 for(const p of [0,4,5,6,7,8,12,16,47,48,encoded.length-1]){const bad=Buffer.from(encoded);bad[p]^=64;assert.throws(()=>decodeArchiveBytes(bad));}
 assert.throws(()=>decodeArchiveBytes(encoded.subarray(0,-1)));
 if(bytes.length)assert.throws(()=>decodeArchiveBytes(encoded,bytes.length-1));
 const trailing=Buffer.concat([encoded,Buffer.from([1])]);trailing.writeUInt32LE(trailing.length-48,12);assert.throws(()=>decodeArchiveBytes(trailing));
}
assert.equal(decodeArchiveBody('legacy 中文'),'legacy 中文');assert.equal(decodeArchiveBody(encodeArchiveBody('legacy 中文','gzip-v1')),'legacy 中文');assert.throws(()=>encodeArchiveBody('x','unknown'));
console.log('PASS: Node v2 binary/empty, legacy/plain/gzip, header/hash/length/bounds/truncation/trailing rejection');
const file=path.join(dir,'input.json'),source=path.join(dir,'source.db');
const contract={strike:600,impliedVolatility:.2,openInterest:100,bid:1,ask:1.1};
const input={symbol:'QQQ',source:'synthetic-codec-test-NOT-LIVE',captures:Array.from({length:20},(_,i)=>[2,5].map(d=>({valuationAt:new Date(Date.parse('2026-01-02T14:30:00Z')+i*120000).toISOString(),expiry:Date.parse(`2026-01-0${d}`)/1000,spot:600+i*.01,result:{receivedAt:new Date(Date.parse('2026-01-02T14:30:00Z')+i*120000).toISOString(),options:[{calls:[contract],puts:[contract]}]}}))).flat(),bars:Array.from({length:20},(_,i)=>({timestamp:new Date(Date.parse('2026-01-02T14:30:00Z')+i*120000).toISOString(),open:600,high:601,low:599,close:600,volume:100}))};
writeFileSync(file,JSON.stringify(input));const runImport=(db,codec)=>execFileSync(process.execPath,['runtime-dist/import.mjs',file,db],{env:{...process.env,MEILI_GEX_ARCHIVE_CODEC:codec},stdio:['ignore','pipe','pipe']});runImport(source,'gzip-v1');
const populate=new DatabaseSync(source);populate.exec('CREATE TABLE qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB,encoding TEXT);CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER,body_sha256 TEXT,body BLOB)');
const originalInput=readFileSync(file),originalHash=hash(originalInput);populate.prepare('INSERT INTO qqq_gex_observed_inputs VALUES(?,?,?,?)').run('synthetic-observed',0,originalHash.toUpperCase(),originalInput.toString());populate.prepare('UPDATE qqq_gex_raw SET body=? WHERE sha256=?').run('@observed-v1:synthetic-observed',originalHash);
populate.prepare('INSERT INTO qqq_gex_provider_raw VALUES(?,?,?,?,?,?)').run(hash(inputBytes).toUpperCase(),'synthetic',0,0,inputBytes,'identity');populate.close();const sourceFileHash=hash(readFileSync(source));assert.throws(()=>migrateCodecExperimentCopy(source,'brotli-v2'));assert.equal(hash(readFileSync(source)),sourceFileHash);
function logical(dbPath){const c=new DatabaseSync(dbPath,{readOnly:true}),rows=[];try{for(const [table,column] of [['qqq_gex_local_rows','body'],['qqq_gex_observed_inputs','body'],['qqq_gex_raw','body'],['qqq_gex_provider_raw','body'],['qqq_gex_local_days','payload']])for(const r of c.prepare(`SELECT rowid,${column} body${table==='qqq_gex_provider_raw'?',encoding':''} FROM ${table} ORDER BY rowid`).all()){const bytes=r.encoding==='identity'?Buffer.from(r.body):typeof r.body==='string'&&r.body.startsWith('@observed-v1:')?Buffer.from(r.body):decodeArchiveBytes(r.body);rows.push([table,r.rowid,hash(bytes)]);}return rows;}finally{c.close();}}
function physical(dbPath){const c=new DatabaseSync(dbPath,{readOnly:true});try{return ['qqq_gex_local_rows','qqq_gex_observed_inputs','qqq_gex_raw','qqq_gex_provider_raw'].flatMap(t=>c.prepare(`SELECT rowid,hex(CAST(body AS BLOB)) body FROM ${t} ORDER BY rowid`).all().map(r=>[t,r.rowid,r.body]));}finally{c.close();}}
const route='/api/analysis/qqq/local-analysis?date=2026-01-02&expiry=2026-01-02&at=2026-01-02T21:00:00Z&analysis=replayTable';
const query=(db,routeValue=route)=>JSON.parse(execFileSync(process.execPath,['runtime-dist/query.mjs',db,routeValue],{maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']}));const replay=query(source),logicalBefore=logical(source);
const target=path.join(dir,'migrated.db');await copyForCodecExperiment(source,target);const paused=migrateCodecExperimentCopy(target,'brotli-v2',{stopAfterBatches:1});assert.equal(paused.updated,32);assert.equal(paused.paused,true);assert.deepEqual(query(target),replay);assert.deepEqual(logical(target),logicalBefore);assert.throws(()=>migrateCodecExperimentCopy(target,'gzip-v1'));
migrateCodecExperimentCopy(target,'brotli-v2');assert.deepEqual(logical(target),logicalBefore);assert.deepEqual(query(target),replay);const encodedBefore=physical(target);migrateCodecExperimentCopy(target,'brotli-v2');assert.deepEqual(physical(target),encodedBefore);
const rollback=path.join(dir,'rollback.db');await copyForCodecExperiment(target,rollback);migrateCodecExperimentCopy(rollback,'gzip-v1');assert.deepEqual(logical(rollback),logicalBefore);assert.deepEqual(query(rollback),replay);
const failure=path.join(dir,'failure.db');await copyForCodecExperiment(source,failure);const before=physical(failure);assert.throws(()=>migrateCodecExperimentCopy(failure,'brotli-v2',{beforeCommit:()=>{throw Error('injected transaction failure');}}));assert.deepEqual(physical(failure),before);migrateCodecExperimentCopy(failure,'brotli-v2');assert.deepEqual(logical(failure),logicalBefore);
const corrupt=path.join(dir,'corrupt.db');await copyForCodecExperiment(source,corrupt);const bad=new DatabaseSync(corrupt);bad.exec("UPDATE qqq_gex_local_rows SET body='corrupt' WHERE rowid=1");bad.close();const corruptBefore=physical(corrupt);assert.throws(()=>migrateCodecExperimentCopy(corrupt,'brotli-v2'));assert.deepEqual(physical(corrupt),corruptBefore);
// Kill a real child after row updates, before COMMIT, and verify SQLite rollback.
const killed=path.join(dir,'killed.db');await copyForCodecExperiment(source,killed);
const child=spawn(process.execPath,['--input-type=module','-e',`import {migrateCodecExperimentCopy} from ${JSON.stringify(new URL('./archive-codec-migration.mjs',import.meta.url).href)};migrateCodecExperimentCopy(${JSON.stringify(killed)},'brotli-v2',{beforeCommit:()=>{process.stdout.write('ready\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`],{stdio:['ignore','pipe','pipe']});
const exited=new Promise(resolve=>child.once('exit',resolve));await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Crash marker timeout'));},15000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error('Child exited before crash marker'));});});child.kill('SIGKILL');await exited;assert.deepEqual(physical(killed),physical(source));migrateCodecExperimentCopy(killed,'brotli-v2');assert.deepEqual(logical(killed),logicalBefore);
const fresh=path.join(dir,'new-writes.db');runImport(fresh,'brotli-v2');assert.deepEqual(query(fresh),replay);const check=new DatabaseSync(fresh,{readOnly:true});assert.ok(check.prepare("SELECT count(*) n FROM qqq_gex_local_rows WHERE substr(body,1,4)=x'51474558'").get().n===40);check.close();
// Cold full-profile window reconstruction from v2 retained rows.
const cold=new DatabaseSync(target);cold.exec("DELETE FROM qqq_gex_wire WHERE request_key LIKE '/api/analysis/qqq/gex/exposure%'");cold.close();const manifest=JSON.parse(query(target,'/api/analysis/qqq/gex/exposure?date=2026-01-02&format=manifest-v2').body);const window=manifest.windows[0];const fullRoute='/api/analysis/qqq/gex/exposure?date=2026-01-02&format=lines-v2&profiles=true&'+new URLSearchParams({from:window.from,to:window.to,source:window.version});assert.deepEqual(query(target,fullRoute),query(source,fullRoute));
console.log('PASS: actual importer/query, 32-row pause/resume/idempotence, mixed reads, explicit rollback copy, failed transaction, corrupt input, killed uncommitted process, cold full-profile replay');
if(process.env.GEX_CODEC_HOST){
 const host=process.env.GEX_CODEC_HOST,dotnet=process.env.DOTNET??'dotnet',rawFile=path.join(dir,'binary.bin'),nodeFile=path.join(dir,'node-v2.bin'),netFile=path.join(dir,'net-v2.bin'),out=path.join(dir,'decoded.bin');writeFileSync(rawFile,inputBytes);writeFileSync(nodeFile,encodeArchiveBytes(inputBytes,'brotli-v2'));
 execFileSync(dotnet,[host,'decode',nodeFile,out]);assert.deepEqual(readFileSync(out),inputBytes);execFileSync(dotnet,[host,'encode',rawFile,netFile,'brotli-v2']);assert.deepEqual(decodeArchiveBytes(readFileSync(netFile)),inputBytes);
 const netDb=path.join(dir,'dotnet-provider.db');execFileSync(dotnet,[host,'provider',rawFile,out,netDb],{env:{...process.env,MEILI_GEX_ARCHIVE_CODEC:'brotli-v2'}});assert.deepEqual(readFileSync(out),inputBytes);const c=new DatabaseSync(netDb,{readOnly:true});const r=c.prepare('SELECT body,encoding FROM qqq_gex_provider_raw').get();assert.equal(r.encoding,'brotli-v2');assert.deepEqual(decodeArchiveBytes(r.body),inputBytes);c.close();
 const netSource=new DatabaseSync(target,{readOnly:true});const provider=netSource.prepare('SELECT body FROM qqq_gex_provider_raw').get().body;netSource.close();writeFileSync(nodeFile,provider);execFileSync(dotnet,[host,'decode',nodeFile,out]);assert.deepEqual(readFileSync(out),inputBytes);
 const legacyDayCopy=path.join(dir,'net-legacy-day.db');await copyForCodecExperiment(source,legacyDayCopy);execFileSync(dotnet,[host,'day',rawFile,out,legacyDayCopy]);const dayBefore=JSON.parse(readFileSync(out));execFileSync(dotnet,[host,'day',rawFile,out,target]);assert.deepEqual(JSON.parse(readFileSync(out)),dayBefore);
 console.log('PASS: .NET real day projection from Node gzip and migrated v2 profiles is identical');
 console.log('PASS: Node↔.NET envelope interoperability and real .NET provider store opt-in write/read');
}else console.log('SKIP: cross-runtime host not supplied; set GEX_CODEC_HOST');
// Exercise the actual signed-engine capture and providerRaw view entrypoints with
// an in-memory synthetic host protocol. No network/provider/Mac connection.
async function hostEngine(script,root,args,codec,handler){
 const child=spawn(process.execPath,['runtime-dist/'+script+'.mjs'],{env:{...process.env,MEILI_GEX_ARCHIVE_CODEC:codec},stdio:['pipe','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);const lines=createInterface({input:child.stdout});
 const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{if(code)reject(Error(errors));});lines.on('line',line=>{try{const frame=JSON.parse(line);if(frame.type==='result'){child.stdin.end();resolve(frame.result);}else{const data=handler(frame.operation,frame.arguments);child.stdin.write(JSON.stringify({type:'hostResult',id:frame.id,result:{success:true,data}})+'\n');}}catch(error){child.kill();reject(error);}});});
 child.stdin.write(JSON.stringify({protocol:1,framing:'host-jsonl-v1',arguments:args,context:{dataDirectory:root,allowWrites:true,maxHostCalls:100,hostOperations:['open_market_snapshot','read_market_snapshot','write_app_input']}})+'\n');return result;
}
for(const codec of ['gzip-v1','brotli-v2']){
 const root=path.join(dir,'capture-'+codec),receipts=new Map([['raw',inputBytes]]);let published;
 const receipt=b=>{const id='r'+receipts.size;receipts.set(id,b);return {receipt:id,size:b.length,sha256:hash(b).toUpperCase()};};
 const captured=await hostEngine('capture',root,{},codec,(operation,args)=>{
  if(operation==='open_market_snapshot'){
   let value;if(args.kind==='expirations')value=['2026-01-02'];
   else if(args.kind==='chain')value={source:'synthetic-codec-test',asOf:'2026-01-02T14:32:00Z',fetchedAt:'2026-01-02T14:32:02Z',underlyingLastTradeAt:'2026-01-02T14:32:00Z',underlyingPrice:600,delayMinutes:0,isRealtime:true,contracts:['Call','Put'].map(right=>({...contract,right,expiration:'2026-01-02',last:1,volume:100,lastTradeTime:null,inTheMoney:false}))};
   else if(args.kind==='bars')value={series:{source:'synthetic',asOf:'2026-01-02T14:32:00Z',fetchedAt:'2026-01-02T14:32:02Z',delayMinutes:0,isRealtime:true,offlineCache:false,adjustment:'None',bars:[]},marketSessions:[]};else value=[];
   return {...receipt(Buffer.from(JSON.stringify(value))),...(args.kind==='chain'?{raw:{receipt:'raw',size:inputBytes.length,sha256:hash(inputBytes).toUpperCase()}}:{})};
  }
  if(operation==='read_market_snapshot'){const bytes=receipts.get(args.receipt),part=bytes.subarray(args.offset,args.offset+args.length),next=args.offset+part.length;return {bodyBase64:part.toString('base64'),offset:args.offset,chunkBytes:part.length,totalBytes:bytes.length,nextOffset:next<bytes.length?next:null};}
  if(operation==='write_app_input'){published=Buffer.from(args.bodyBase64,'base64');return {committed:true,bytes:args.totalBytes,sha256:args.sha256};}
  throw Error('Unexpected host operation');
 });
 assert.equal(captured.status,'captured_input');const c=new DatabaseSync(path.join(root,'cache','qqq-gex.db'),{readOnly:true});const row=c.prepare('SELECT body,encoding FROM qqq_gex_provider_raw').get();assert.equal(row.encoding,codec);assert.deepEqual(decodeArchiveBytes(row.body),inputBytes);assert.deepEqual(decodeArchiveBytes(c.prepare('SELECT body FROM qqq_gex_observed_inputs').get().body),published);c.close();
 const viewed=await hostEngine('view',root,{resource:'providerRaw',providerHash:hash(inputBytes),length:262144},codec,()=>{throw Error('Provider view must not call host');});assert.equal(viewed.available,true);assert.deepEqual(Buffer.from(viewed.bodyBase64,'base64'),inputBytes);
}
console.log('PASS: actual capture provider+normalized writes and providerRaw view retain exact binary bytes in default gzip and opt-in v2');
assert.equal(hash(readFileSync(source)),sourceFileHash);console.log(JSON.stringify({sample:'synthetic-only',sourceUnchanged:true,directory:dir,records:logicalBefore.length}));
