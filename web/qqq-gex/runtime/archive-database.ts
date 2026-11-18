import {DatabaseSync} from 'node:sqlite';
import {archiveWriteCodec} from './archive-body.ts';
export class ArchiveDatabase extends DatabaseSync{
 constructor(path:any,options:any={}){
  super(path,options);
  try{
   this.function('gex_v2_writer',{deterministic:true},()=>2);
   const format=this.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_archive_format'").get();
   if(format){const row=this.prepare('SELECT version,status FROM qqq_gex_archive_format WHERE id=1').get();if(!row||row.version!==2||row.status!=='ready')throw Error('GEX archive version unsupported or migration incomplete');verifyArchiveFence(this);}
   else if(archiveWriteCodec()==='brotli-v2')throw Error('Migrate to a separate guarded archive before enabling v2');
   archiveWriteCodec();
  }catch(error){this.close();throw error;}
 }
}
export function archiveDatabaseCodec(db:any){return db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_archive_format'").get()?'brotli-v2':'gzip-v1';}

export function verifyArchiveFence(db:any){
 const tables=["qqq_gex_cache_meta", "qqq_gex_wire", "qqq_gex_local_days", "qqq_gex_local_day_hashes", "qqq_gex_raw", "qqq_gex_observed_inputs", "qqq_gex_provider_raw", "qqq_gex_local_rows", "qqq_gex_partial_days", "qqq_gex_context_days", "qqq_gex_local_summaries", "qqq_gex_import_receipts", "qqq_gex_pcs_lifecycle", "qqq_gex_live_signals", "qqq_gex_observed_imports", "qqq_gex_archive_format", "qqq_gex_archive_receipt"];
 const guards=new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all().map((r:any)=>[r.name,r.sql]));
 for(const table of tables)for(const operation of ['INSERT','UPDATE','DELETE']){const sql=String(guards.get('gex_v2_'+table+'_'+operation)??'');if(!sql.includes('gex_v2_writer()!=2')||!sql.includes(' BEFORE '+operation+' ON \"'+table+'\" '))throw Error('GEX archive compatibility fence missing or invalid; migrate to a new verified copy');}
}
