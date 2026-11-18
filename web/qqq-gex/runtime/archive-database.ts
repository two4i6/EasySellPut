import {DatabaseSync} from 'node:sqlite';
import {archiveWriteCodec} from './archive-body.ts';
export class ArchiveDatabase extends DatabaseSync{
 constructor(path:any,options:any={}){
  super(path,options);
  try{
   this.function('gex_v2_writer',{deterministic:true},()=>2);
   const format=this.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_archive_format'").get();
   if(format){const row=this.prepare('SELECT version,status FROM qqq_gex_archive_format WHERE id=1').get();if(!row||row.version!==2||row.status!=='ready')throw Error('GEX archive version unsupported or migration incomplete');}
   else if(archiveWriteCodec()==='brotli-v2')throw Error('Migrate to a separate guarded archive before enabling v2');
   archiveWriteCodec();
  }catch(error){this.close();throw error;}
 }
}
export function archiveDatabaseCodec(db:any){return db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_archive_format'").get()?'brotli-v2':'gzip-v1';}
