// TEST-ONLY copy migration experiment. Not wired to CLI, MCP or CacheManager.
// No in-place source migration or automatic startup conversion is exposed.
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodeArchiveBytes,decodeArchiveBytes,archiveEncoding,archiveWriteCodec} from '../runtime/archive-body.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');
const scopes=[['qqq_gex_local_rows','sha256'],['qqq_gex_observed_inputs','body_sha256'],['qqq_gex_raw','sha256'],['qqq_gex_provider_raw','sha256']];
export async function copyForCodecExperiment(source,destination){
 if(source===destination||existsSync(destination))throw Error('Prototype requires a new destination copy');
 const input=new DatabaseSync(source,{readOnly:true});try{await backup(input,destination);}finally{input.close();}
 const output=new DatabaseSync(destination);try{output.exec('DROP TABLE IF EXISTS qqq_gex_codec_prototype;CREATE TABLE qqq_gex_codec_prototype(scope TEXT PRIMARY KEY,last_rowid INTEGER NOT NULL,codec TEXT NOT NULL)');output.prepare('INSERT INTO qqq_gex_codec_prototype VALUES(?,0,?)').run('copy-marker','test-only');}finally{output.close();}
}
export function migrateCodecExperimentCopy(path,codec,{batchSize=32,stopAfterBatches=Infinity,beforeCommit}={}){
 archiveWriteCodec(codec);if(!Number.isInteger(batchSize)||batchSize<1||batchSize>32)throw Error('Invalid bounded prototype batch size');
 const db=new DatabaseSync(path);let batches=0,updated=0;
 try{
  if(!db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_codec_prototype'").get()||!db.prepare("SELECT 1 FROM qqq_gex_codec_prototype WHERE scope='copy-marker' AND codec='test-only'").get())throw Error('Only a marked experiment copy can be migrated');
  for(const [table,hashColumn] of scopes){
   if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table))continue;
   const previous=db.prepare('SELECT codec FROM qqq_gex_codec_prototype WHERE scope=?').get(table);if(previous&&previous.codec!==codec)throw Error('Resume codec differs; create a fresh experiment copy');
   while(batches<stopAfterBatches){
    db.exec('BEGIN IMMEDIATE');let count=0;
    try{
     const cursor=db.prepare('SELECT last_rowid FROM qqq_gex_codec_prototype WHERE scope=?').get(table)?.last_rowid??0;
     const rows=db.prepare(`SELECT rowid,body,${hashColumn} expected FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`).all(cursor,batchSize);
     for(const row of rows){
      if(typeof row.body==='string'&&row.body.startsWith('@observed-v1:')){
       const referenced=db.prepare('SELECT body FROM qqq_gex_observed_inputs WHERE identity=?').get(row.body.slice(13));if(!referenced||hash(decodeArchiveBytes(referenced.body))!==row.expected.toLowerCase())throw Error('Observed archive reference mismatch');
      }else{
       const raw=table==='qqq_gex_provider_raw'&&db.prepare('SELECT encoding FROM qqq_gex_provider_raw WHERE rowid=?').get(row.rowid).encoding==='identity'?Buffer.from(row.body):decodeArchiveBytes(row.body);
       if(hash(raw)!==row.expected.toLowerCase())throw Error('Prototype source archive hash mismatch');
       const encoded=encodeArchiveBytes(raw,codec);if(!raw.equals(decodeArchiveBytes(encoded)))throw Error('Prototype roundtrip mismatch');
       if(table==='qqq_gex_provider_raw')db.prepare(`UPDATE ${table} SET body=?,encoding=? WHERE rowid=?`).run(encoded,archiveEncoding(encoded),row.rowid);
       else db.prepare(`UPDATE ${table} SET body=? WHERE rowid=?`).run(encoded,row.rowid);
       count++;
      }
     }
     if(rows.length)db.prepare('INSERT INTO qqq_gex_codec_prototype VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET last_rowid=excluded.last_rowid').run(table,rows.at(-1).rowid,codec);
     beforeCommit?.({table,batches,rows:rows.length,db});db.exec('COMMIT');updated+=count;batches++;
     if(rows.length<batchSize)break;
    }catch(error){db.exec('ROLLBACK');throw error;}
   }
   if(batches>=stopAfterBatches)return {updated,batches,paused:true};
  }
  return {updated,batches,paused:false};
 }finally{db.close();}
}
