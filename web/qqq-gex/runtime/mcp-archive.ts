import {ArchiveDatabase} from './archive-database.ts';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {qqqMarketSession} from '../upstream/src/lib/qqqMarketSession';
import {hydrateRow} from './local-rows';
import {qqqEasternDateKey,qqqMarketDateBounds} from '../upstream/src/lib/qqqMarketDate';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
/** Bounded lossless views of the same rows consumed by the page. No remote fetch or database writes. */
export function readMcpArchive(dbPath:string,url:URL){
 const p=url.searchParams,resource=p.get('resource')??'',archiveState=p.get('archiveState')??'published',page=Number(p.get('page')??1),pageSize=Number(p.get('pageSize')??100),expected=p.get('revision'),priceBasis=p.get('priceBasis')??'valuation';
 if(!['published','partial'].includes(archiveState)||!['dates','snapshots','profile','bars','extendedBars','providers'].includes(resource)||!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>200||[...p.keys()].some(k=>!['resource','date','expiry','capturedAt','page','pageSize','revision','archiveState','priceBasis'].includes(k))||[...new Set(p.keys())].some(k=>p.getAll(k).length!==1))throw Error('Invalid bounded archive query');
 if(!['valuation','display'].includes(priceBasis)||p.has('priceBasis')&&!['bars','extendedBars'].includes(resource))throw Error('Invalid price basis');
 if(page>1&&!expected)throw Error('Continuation requires revision from first page');
 const db=new ArchiveDatabase(dbPath,{readOnly:true});db.exec('PRAGMA busy_timeout=5000;BEGIN');try{
 let revision:string,items:any[],scope:any,metadata:any={};
 if(resource==='providers'){
  if(['date','expiry','capturedAt','archiveState'].some(k=>p.has(k)))throw Error('Provider index has no date/expiry filter');
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_provider_raw'").get();
  const records=exists?db.prepare('SELECT sha256,source,as_of,fetched_at,length(body) AS storedBytes FROM qqq_gex_provider_raw ORDER BY as_of,sha256 LIMIT 50001').all():[];
  if(records.length>50000)throw Error('Provider index exceeds archive bound');revision=hash(JSON.stringify(records));items=records.map((r:any)=>({providerHash:r.sha256,source:r.source,publicationAt:new Date(r.as_of).toISOString(),receivedAt:new Date(r.fetched_at).toISOString(),storedBytes:r.storedBytes,readResource:'providerRaw'}));scope={resource};
 }else if(resource==='dates'){
  if(['date','expiry','capturedAt'].some(k=>p.has(k)))throw Error('Dates query has no snapshot scope');
  const records=archiveState==='partial'?(db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_partial_days'").get()?db.prepare('SELECT day,revision,updated_at,sha256 FROM qqq_gex_partial_days ORDER BY day LIMIT 50001').all():[]):db.prepare('SELECT d.day,d.revision,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON h.day=d.day ORDER BY d.day LIMIT 50001').all();
  if(records.length>50000)throw Error('Date index exceeds archive bound');
  revision=hash(JSON.stringify(records));items=records.map((r:any)=>({date:r.day,revision:r.revision,payloadSha256:r.sha256,updatedAt:new Date(r.updated_at).toISOString()}));scope={resource};
 }else{
  const date=p.get('date')??'';qqqMarketDateBounds(date);const record=(archiveState==='partial'?(db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_partial_days'").get()?db.prepare('SELECT revision,payload,sha256 FROM qqq_gex_partial_days WHERE day=?').get(date):null):db.prepare('SELECT d.revision,d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON h.day=d.day WHERE d.day=?').get(date)) as any;
  if(!record)return {available:false,status:'cache_miss',complete:false,scope:{resource,date}};
  if(Buffer.byteLength(record.payload)>128*1024*1024||hash(record.payload)!==record.sha256)throw Error('Archive day integrity failed');
  revision=hash(JSON.stringify([date,record.revision,record.sha256]));const day=JSON.parse(record.payload),expiry=p.get('expiry');if(day.date&&day.date!==date)throw Error('Archive date identity mismatch');metadata={displayPricesAvailable:Boolean(day.displayPrices),displayRegularCount:day.displayPrices?.bars.filter((b:any)=>qqqMarketSession(new Date(b.timestamp)).stocksOpen).length??0,source:day.source??null,issues:day.issues??[],barProvenance:day.barProvenance??null,underlyingLastTradeAt:day.underlyingLastTradeAt??null};scope={resource,date,expiry:expiry??null};
  if(expiry)qqqMarketDateBounds(expiry);
  if(resource==='bars'||resource==='extendedBars'){
   if(expiry||p.has('capturedAt'))throw Error('Bars are scoped to trading date');if(priceBasis==='display'&&!day.displayPrices)return {available:false,status:'display_prices_missing',complete:false,scope:{resource,date,priceBasis}};
   const display=day.displayPrices;items=priceBasis==='display'?display.bars.filter((b:any)=>qqqMarketSession(new Date(b.timestamp)).stocksOpen===(resource==='bars')):resource==='bars'?day.bars:(day.extendedHoursBars??[]);scope.priceBasis=priceBasis;metadata.priceBasis=priceBasis;metadata.priceClocks={valuationProvenance:day.barProvenance??null,displayProvenance:display?.provenance??null};if(priceBasis==='display')metadata.barProvenance=display.provenance;const {from:start,to:end}=qqqMarketDateBounds(date);if(items.some((b:any)=>{const time=Date.parse(b.timestamp);return !Number.isFinite(time)||time<Date.parse(start)||time>=Date.parse(end);}))throw Error('Archive bar crosses requested Eastern date');if(items.some((b:any)=>qqqMarketSession(new Date(b.timestamp)).stocksOpen!==(resource==='bars')))throw Error('Archive bar session mismatch');
  }else{
   if(day.rows.some((r:any)=>qqqEasternDateKey(r.capturedAt)!==date))throw Error('Archive snapshot crosses requested Eastern date');const rows=day.rows.filter((r:any)=>!expiry||r.expiryDate===expiry).sort((a:any,b:any)=>a.capturedAt.localeCompare(b.capturedAt)||a.expiryDate.localeCompare(b.expiryDate));
   if(resource==='snapshots'){
    if(p.has('capturedAt'))throw Error('Snapshot listing does not accept capturedAt');items=rows.map((r:any)=>{const {profile,...rest}=r;return {...rest,profileCount:r.profileCount??profile?.length??0};});
   }else{
    const capturedAt=p.get('capturedAt');if(!expiry||!capturedAt||!Number.isFinite(Date.parse(capturedAt)))throw Error('Profile requires exact expiry and capturedAt from snapshots');
    const matches=rows.filter((r:any)=>r.capturedAt===capturedAt);if(matches.length!==1)return {available:false,status:'snapshot_missing',complete:false,revision,scope:{...scope,capturedAt}};
    const row=hydrateRow(db,matches[0]),{profile,...rest}=row;items=profile;metadata={...metadata,snapshot:rest,profileSha256:matches[0].rowSha256??hash(JSON.stringify(row)),hashMeaning:'SHA256 of complete decoded source row, including lossless profile'};scope.capturedAt=capturedAt;
   }
  }
 }
 if(expected&&expected!==revision)return {available:false,status:'revision_changed',complete:false,revision,restartPage:1,scope};
 const offset=(page-1)*pageSize,selected=items.slice(offset,offset+pageSize),hasMore=offset+pageSize<items.length;
 return {available:true,complete:false,archiveState,coverage:'Retained local observations only; missing history and IV are never synthesized. Inspect each snapshot inputComplete, timing, source and calculationVersion.',...metadata,scope,revision,page,pageSize,total:items.length,hasMore,nextPage:hasMore?page+1:null,items:selected};
 }finally{db.close();}
}
