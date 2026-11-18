import {fileURLToPath} from 'node:url';
import {writeFileSync,existsSync,mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),out=process.argv[2];
if(!out||existsSync(out))throw Error('Pass a NEW empty destination directory for SYNTHETIC fixture');mkdirSync(out,{recursive:true});
// STRUCTURAL SYNTHETIC extension of tests/local-pipeline.mjs. Never a live capture.
for(let i=0;i<6;i++){
 const time=new Date(Date.parse('2026-01-02T14:30:00Z')+i*120000).toISOString();
 const contracts=Array.from({length:183},(_,j)=>({strike:510+j,impliedVolatility:.18+j*.0003+i*.00001,openInterest:50+j*7,bid:Math.max(.01,20-j*.1+i*.01),ask:Math.max(.02,20.1-j*.1+i*.01)}));
 const daily=Object.fromEntries(Array.from({length:11},(_,s)=>['SYNTH'+s,{source:'synthetic-structural-test',fetchedAt:time,bars:Array.from({length:1000},(_,j)=>({timestamp:new Date(Date.parse('2022-01-01')+j*86400000).toISOString(),open:100+j*.1+s,high:102+j*.1+s,low:99+j*.1+s,close:101+j*.1+s,volume:10000+j*137}))}]));
 const input={symbol:'QQQ',source:'synthetic-structural-test-NOT-LIVE',marketInputs:{daily},captures:Array.from({length:29},(_,d)=>({valuationAt:time,expiry:Array.from({length:40},(_,n)=>Date.parse('2026-01-02')/1000+n*7*86400).filter(t=>!['2026-04-03','2026-06-19','2026-07-03'].includes(new Date(t*1000).toISOString().slice(0,10)))[d],spot:600+i*.03,result:{receivedAt:time,options:[{calls:contracts,puts:contracts.map(c=>({...c,openInterest:c.openInterest+10}))}]}})),bars:Array.from({length:6},(_,k)=>({timestamp:new Date(Date.parse('2026-01-02T14:30:00Z')+k*120000).toISOString(),open:600,high:601,low:599,close:600,volume:100}))};
 const file=out+'/input-'+i+'.json',body=JSON.stringify(input);writeFileSync(file,body);execFileSync(process.execPath,[root+'/runtime-dist/import.mjs',file,out+'/structural.db'],{cwd:root,env:{...process.env,MEILI_GEX_ARCHIVE_CODEC:'gzip-v1'},stdio:['ignore','ignore','pipe']});
 const db=new DatabaseSync(out+'/structural.db');db.exec('CREATE TABLE IF NOT EXISTS qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB,encoding TEXT)');const provider=JSON.stringify({source:'synthetic-provider-NOT-LIVE',asOf:time,options:input.captures,daily});db.prepare('INSERT INTO qqq_gex_provider_raw VALUES(?,?,?,?,?,?)').run(createHash('sha256').update(provider).digest('hex'),'synthetic',Date.parse(time),Date.parse(time),gzipSync(provider,{level:1}),'gzip-v1');db.close();
}

const script=`import sqlite3,gzip,hashlib
c=sqlite3.connect(__import__('sys').argv[1])
c.execute('CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER NOT NULL,body_sha256 TEXT NOT NULL,body BLOB NOT NULL)')
for sha,received,b in c.execute('select sha256,received_at,body from qqq_gex_raw').fetchall():
 raw=gzip.decompress(b);identity=hashlib.sha256(raw).hexdigest()
 c.execute('insert into qqq_gex_observed_inputs values(?,?,?,?)',(identity,received,identity.upper(),gzip.compress(raw,compresslevel=3,mtime=0)))
 c.execute('update qqq_gex_raw set body=? where sha256=?',('@observed-v1:'+identity,sha))
c.commit();c.close()
`;
execFileSync(process.env.PYTHON??'python3',['-c',script,out+'/structural.db']);
console.log(JSON.stringify({kind:'STRUCTURAL SYNTHETIC NOT LIVE',source:out+'/structural.db',captures:6,expiries:29,strikes:183}));
