import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {hydrateRow} from './local-rows';
import {qqqMarketDateBounds} from '../upstream/src/lib/qqqMarketDate';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
/** Bounded lossless views of the same rows consumed by the page. No remote fetch or database writes. */
export function readMcpArchive(dbPath:string,url:URL){
 const p=url.searchParams,resource=p.get('resource')??'',page=Number(p.get('page')??1),pageSize=Number(p.get('pageSize')??100),expected=p.get('revision');
 if(!['dates','snapshots','profile','bars'].includes(resource)||!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>200||[...p.keys()].some(k=>!['resource','date','expiry','capturedAt','page','pageSize','revision'].includes(k))||[...new Set(p.keys())].some(k=>p.getAll(k).length!==1))throw Error('Invalid bounded archive query');
 if(page>1&&!expected)throw Error('Continuation requires revision from first page');
 const db=new DatabaseSync(dbPath,{readOnly:true});db.exec('PRAGMA busy_timeout=5000;BEGIN');try{
 let revision:string,items:any[],scope:any,metadata:any={};
 if(resource==='dates'){
  if(['date','expiry','capturedAt'].some(k=>p.has(k)))throw Error('Dates query has no snapshot scope');
  const records=db.prepare('SELECT d.day,d.revision,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON h.day=d.day ORDER BY d.day LIMIT 50001').all();
  if(records.length>50000)throw Error('Date index exceeds archive bound');
  revision=hash(JSON.stringify(records));items=records.map((r:any)=>({date:r.day,revision:r.revision,payloadSha256:r.sha256,updatedAt:new Date(r.updated_at).toISOString()}));scope={resource};
 }else{
  const date=p.get('date')??'';qqqMarketDateBounds(date);const record=db.prepare('SELECT d.revision,d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON h.day=d.day WHERE d.day=?').get(date) as any;
  if(!record)return {available:false,status:'cache_miss',complete:false,scope:{resource,date}};
  if(Buffer.byteLength(record.payload)>128*1024*1024||hash(record.payload)!==record.sha256)throw Error('Archive day integrity failed');
  revision=hash(JSON.stringify([date,record.revision,record.sha256]));const day=JSON.parse(record.payload),expiry=p.get('expiry');scope={resource,date,expiry:expiry??null};
  if(expiry)qqqMarketDateBounds(expiry);
  if(resource==='bars'){
   if(expiry||p.has('capturedAt'))throw Error('Bars are scoped to trading date');items=day.bars;
  }else{
   const rows=day.rows.filter((r:any)=>!expiry||r.expiryDate===expiry).sort((a:any,b:any)=>a.capturedAt.localeCompare(b.capturedAt)||a.expiryDate.localeCompare(b.expiryDate));
   if(resource==='snapshots'){
    if(p.has('capturedAt'))throw Error('Snapshot listing does not accept capturedAt');items=rows.map((r:any)=>{const {profile,...rest}=r;return {...rest,profileCount:r.profileCount??profile?.length??0};});
   }else{
    const capturedAt=p.get('capturedAt');if(!expiry||!capturedAt||!Number.isFinite(Date.parse(capturedAt)))throw Error('Profile requires exact expiry and capturedAt from snapshots');
    const matches=rows.filter((r:any)=>r.capturedAt===capturedAt);if(matches.length!==1)return {available:false,status:'snapshot_missing',complete:false,revision,scope:{...scope,capturedAt}};
    const row=hydrateRow(db,matches[0]),{profile,...rest}=row;items=profile;metadata={snapshot:rest,profileSha256:matches[0].rowSha256??hash(JSON.stringify(row)),hashMeaning:'SHA256 of complete decoded source row, including lossless profile'};scope.capturedAt=capturedAt;
   }
  }
 }
 if(expected&&expected!==revision)return {available:false,status:'revision_changed',complete:false,revision,restartPage:1,scope};
 const offset=(page-1)*pageSize,selected=items.slice(offset,offset+pageSize),hasMore=offset+pageSize<items.length;
 return {available:true,complete:false,coverage:'Retained local observations only; missing history and IV are never synthesized. Inspect each snapshot inputComplete, timing, source and calculationVersion.',...metadata,scope,revision,page,pageSize,total:items.length,hasMore,nextPage:hasMore?page+1:null,items:selected};
 }finally{db.close();}
}
