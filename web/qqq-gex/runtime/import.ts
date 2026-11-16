import {buildQqqGexResearchSurface} from '../upstream/src/lib/engines/analysis/QqqGexResearch';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {buildQqqGexCapture} from '../upstream/src/lib/qqqGexCaptureBuilder';
import {buildHistoricalGexExpiries,historicalGexDisplayPayload} from '../upstream/src/lib/qqqGexDisplayState';
import {exposureArchiveManifest} from '../upstream/src/lib/qqqExposureArchive';
import {serializeExposureWire} from '../upstream/src/lib/qqqExposureWire';
import {qqqRegularBarIndex} from '../upstream/src/lib/qqqIntradayIndicators';
import {qqqDirectionalGexTime} from '../upstream/src/lib/qqqDirectionalGexTime';
import {qqqPreviousTradingDate,qqqMarketSession} from '../upstream/src/lib/qqqMarketSession';
export async function importInput(inputPath:string,dbPath:string,bodyOverride?:string){
const raw=bodyOverride??readFileSync(inputPath,'utf8');if(Buffer.byteLength(raw)>128*1024*1024)throw Error('Input exceeds 128 MB');
const input=JSON.parse(raw);const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
if(input.symbol!=='QQQ'||!Array.isArray(input.captures)||!input.captures.length||!Array.isArray(input.bars)||!input.source)throw Error('Expected QQQ source, captures and bars');
const rows=input.captures.map((c:any)=>{
 if(!Number.isFinite(Date.parse(c.valuationAt))||!Number.isFinite(c.spot)||c.spot<=0||!Number.isInteger(c.expiry)||!Number.isFinite(Date.parse(c.result?.receivedAt)))throw Error('Invalid capture scope/timing');
 const result=buildQqqGexCapture(new Date(c.valuationAt),c.expiry,c.result,c.spot);if(!result)throw Error('GEX calculation rejected capture');return {...result,capturedAt:c.valuationAt,strikeCoverage:'full'};
});
const dates=[...new Set(rows.map((r:any)=>qqqMarketSession(new Date(r.capturedAt)).date))].sort();
const seen=new Set<string>();for(const r of rows){const key=r.capturedAt+'|'+r.expiryDate;if(seen.has(key))throw Error('Duplicate capture');seen.add(key);}
for(const b of input.bars)if(!Number.isFinite(Date.parse(b.timestamp))||![b.open,b.high,b.low,b.close].every((x:any)=>Number.isFinite(x)&&x>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||!Number.isFinite(b.volume)||b.volume<0)throw Error('Invalid original price bar');
mkdirSync(dirname(dbPath),{recursive:true});const db=new DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS qqq_gex_wire(snapshot TEXT NOT NULL,request_key TEXT NOT NULL,content_type TEXT NOT NULL,body TEXT NOT NULL,revision TEXT NOT NULL,as_of INTEGER NOT NULL,expires_at INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(snapshot,request_key)); CREATE TABLE IF NOT EXISTS qqq_gex_local_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS qqq_gex_raw(sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,received_at INTEGER NOT NULL,body TEXT NOT NULL);');
db.exec('CREATE TABLE IF NOT EXISTS qqq_gex_local_day_hashes(day TEXT PRIMARY KEY,sha256 TEXT NOT NULL)');
const revision=hash(raw);const statement=db.prepare('INSERT INTO qqq_gex_wire VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(snapshot,request_key) DO UPDATE SET content_type=excluded.content_type,body=excluded.body,revision=excluded.revision,as_of=excluded.as_of,expires_at=excluded.expires_at,sha256=excluded.sha256');
function save(route:string,query:Record<string,string>,value:any,asOf:number,contentType='application/json'){const body=typeof value==='string'?value:JSON.stringify(value);const q=Object.fromEntries(Object.entries(query).sort(([a],[b])=>a.localeCompare(b)));statement.run('local',route+'|'+JSON.stringify(q),contentType,body,revision,asOf,Date.now()+30*86400000,hash(body).toUpperCase());}
db.exec('PRAGMA busy_timeout=5000');db.exec('BEGIN IMMEDIATE');try{
 db.prepare("DELETE FROM qqq_gex_wire WHERE snapshot='local' AND request_key LIKE '/api/analysis/qqq/pcs|%'").run();
 db.prepare('INSERT OR IGNORE INTO qqq_gex_raw VALUES(?,?,?,?)').run(revision,input.source,Date.now(),raw);
 for(const date of dates){let dayRows=rows.filter((r:any)=>qqqMarketSession(new Date(r.capturedAt)).date===date);let bars=input.bars.filter((b:any)=>qqqMarketSession(new Date(b.timestamp)).date===date);if(!bars.length)throw Error('Capture date has no original bars');
 const previous=db.prepare('SELECT payload FROM qqq_gex_local_days WHERE day=?').get(date) as any;
 if(previous){const check=db.prepare('SELECT sha256 FROM qqq_gex_local_day_hashes WHERE day=?').get(date) as any;if(!check||check.sha256!==hash(previous.payload))throw Error('Historical day hash missing or mismatched; explicit reimport required');const old=JSON.parse(previous.payload);const byKey=new Map(old.rows.map((r:any)=>[r.capturedAt+'|'+r.expiryDate,r]));for(const row of dayRows){const key=row.capturedAt+'|'+row.expiryDate;const prior=byKey.get(key);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('Existing capture revision differs; explicit reconciliation required');byKey.set(key,row);}dayRows=[...byKey.values()].sort((a:any,b:any)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));const mergedBars=new Map(old.bars.map((b:any)=>[b.timestamp,b]));for(const bar of bars)mergedBars.set(bar.timestamp,bar);bars=[...mergedBars.values()].sort((a:any,b:any)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));}
 const expiries=buildHistoricalGexExpiries(dayRows);
 const researchInputs=expiries.map(e=>{const history=dayRows.filter((r:any)=>r.expiryDate===e.expiryDate),last=history.at(-1)!;return {...last,expectedMove:last.indicators?.expectedMove??null,history:history.map((r:any)=>({...r,time:r.capturedAt}))};});
 for(const e of expiries)(e as any).research=buildQqqGexResearchSurface({expiries:researchInputs,selectedExpiryDate:e.expiryDate,bars,asOf:e.asOf,sessionClosed:date<qqqMarketSession(new Date()).date});
 const referenceDates:string[]=[];let priorDate=date;for(let i=0;i<20;i++){priorDate=qqqPreviousTradingDate(priorDate);referenceDates.unshift(priorDate);}
 const references=referenceDates.map(day=>{const record=db.prepare('SELECT d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day=?').get(day) as any;return {date:day,data:record&&record.sha256===hash(record.payload)?JSON.parse(record.payload):null};});
 const missingReferences=references.filter(r=>!r.data).map(r=>r.date);
 for(const dte of [...new Set(dayRows.map((r:any)=>r.dte))].filter((d:any)=>d>=0&&d<=60))for(const include of ['all','volume']){
 const days=references.map(({date:referenceDate,data})=>{const original=data?.bars??[];const valid=new Set(qqqRegularBarIndex(original,referenceDate).map(b=>b.openedAt));return {date:referenceDate,bars:original.filter((b:any)=>valid.has(Date.parse(b.timestamp))),levels:include==='volume'?[]:(data?.rows??[]).filter((r:any)=>r.dte===dte&&r.inputComplete).map((r:any)=>({time:Date.parse(qqqDirectionalGexTime(r.capturedAt,null,r.profile)),expiry:r.expiryDate,dte:r.dte,netGex:r.netGex,callWall:r.callWallPrice,putWall:r.putWallPrice}))};});
 save('/api/analysis/qqq/gex/intraday-context',{date,dte:String(dte),include},{date,dte,asOf:new Date().toISOString(),requestedDays:20,currentBars:bars,days,referenceComplete:false,issues:['Reference coverage is not certified; only locally observed records are included',...(missingReferences.length?['Missing local reference dates: '+missingReferences.join(',')]:[])]},Date.parse(dayRows.at(-1)!.capturedAt));
 }
 const payload=historicalGexDisplayPayload(null,date,expiries,bars,null);const asOf=Math.max(...dayRows.map((r:any)=>Date.parse(r.capturedAt)));
 for(const expiry of [null,...expiries.map(e=>e.expiryDate)]){
 const scopedRows=expiry?dayRows.filter((r:any)=>r.expiryDate===expiry):dayRows;
 const source={revision,items:scopedRows.map((r:any)=>({captured_at:r.capturedAt,expiry_date:r.expiryDate,version:hash(JSON.stringify(r.profile))})),bars:bars.map((b:any)=>({bar_at:b.timestamp,version:hash(JSON.stringify(b))}))};
 const observedAt=new Date(Math.max(asOf,...bars.map((b:any)=>Date.parse(b.timestamp)+120000))).toISOString();
 const manifest=await exposureArchiveManifest(date,source,observedAt,bars);const scope=expiry?{expiryDate:expiry}:{};
 save('/api/analysis/qqq/gex/exposure',{date,format:'manifest-v2',...scope},manifest,asOf);
 for(const window of manifest.windows){const start=Date.parse(window.from),end=Date.parse(window.to);const value={date,observedAt,revision:manifest.revision,items:scopedRows.filter((r:any)=>Date.parse(r.capturedAt)>=start&&Date.parse(r.capturedAt)<end).map((r:any)=>({capturedAt:r.capturedAt,expiryDate:r.expiryDate,dte:r.dte,profile:r.profile})),bars:bars.filter((b:any)=>Date.parse(b.timestamp)>=start&&Date.parse(b.timestamp)<end)};
 save('/api/analysis/qqq/gex/exposure',{date,format:'lines-v2',from:window.from,to:window.to,source:window.version,...scope},serializeExposureWire(value,true),asOf,'application/x-ndjson; charset=utf-8');}
 }
 db.prepare('INSERT INTO qqq_gex_local_days VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at').run(date,revision,JSON.stringify({rows:dayRows,bars,expiries,payload}),Date.now());
 db.prepare('INSERT INTO qqq_gex_local_day_hashes VALUES(?,?) ON CONFLICT(day) DO UPDATE SET sha256=excluded.sha256').run(date,hash(JSON.stringify({rows:dayRows,bars,expiries,payload})));
 if(date===dates.at(-1))for(const expiry of [null,...expiries.map(e=>e.expiryDate)]){
 const scoped=historicalGexDisplayPayload(null,date,expiries,bars,expiry);
 if(input.missingExpiries?.length)scoped.dataIssues.push('Missing source expiries: '+input.missingExpiries.map((x:any)=>x.expiry).join(','));const scope=expiry?{gexExpiry:expiry}:{};
 for(const latest of [true,false])for(const overview of [true,false])save('/api/analysis/qqq/pcs',{gexDisplay:'1',...(latest?{gexWindow:'latest'}:{}),...(overview?{gexOverview:'1'}:{}),...scope},scoped,asOf);
 }
 }
 db.exec('COMMIT');return {status:'imported',source:input.source,revision,dates,rows:rows.length,inputComplete:rows.every((r:any)=>r.inputComplete)&&!(input.missingExpiries?.length),missingExpiries:input.missingExpiries??[],historyCoverage:'only supplied captures; gaps not synthesized'};
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}

}
