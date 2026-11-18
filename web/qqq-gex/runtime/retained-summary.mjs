import {ArchiveDatabase} from './archive-database.ts';
// App-owned operation: retained local evidence inventory, never inferred market coverage.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRequest, writeResult } from '../../app-sdk/engine.mjs';
const request=await readRequest();
if(request.protocol!==1||request.operation!=='get_qqq_gex_retained_summary'||Object.keys(request.arguments).length)throw Error('Unsupported operation');
const path=join(request.context.dataDirectory,'cache','qqq-gex.db');
const result={status:'empty',appVersion:request.context.appVersion,storageAvailable:existsSync(path),publishedDays:0,partialDays:0,observedInputs:0,firstPublishedDate:null,lastPublishedDate:null,coverage:'Locally retained evidence only; counts do not certify complete market coverage or validate payload integrity.'};
if(result.storageAvailable){
 const db=new ArchiveDatabase(path,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=5000; BEGIN');
  const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  for(const [name,field] of [['qqq_gex_local_days','publishedDays'],['qqq_gex_partial_days','partialDays'],['qqq_gex_observed_inputs','observedInputs']])
   if(present.has(name))result[field]=Number(db.prepare(`SELECT count(*) AS count FROM ${name}`).get().count);
  if(result.publishedDays){const range=db.prepare('SELECT min(day) AS first,max(day) AS last FROM qqq_gex_local_days').get();result.firstPublishedDate=range.first;result.lastPublishedDate=range.last;}
  result.status='available';
 }finally{db.close();}
}
writeResult(result);
