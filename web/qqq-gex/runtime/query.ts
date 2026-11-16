import {buildHistoricalGexExpiries,historicalGexDisplayPayload} from '../upstream/src/lib/qqqGexDisplayState';
import {qqqMarketSession,qqqPreviousTradingDate} from '../upstream/src/lib/qqqMarketSession';
import {qqqMarketDateBounds} from '../upstream/src/lib/qqqMarketDate';
import {qqqRegularBarIndex} from '../upstream/src/lib/qqqIntradayIndicators';
import {qqqDirectionalGexTime} from '../upstream/src/lib/qqqDirectionalGexTime';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {replayQqqIntradayDirectional,validateQqqIntradayDirectional} from '../upstream/src/lib/engines/analysis/QqqIntradayDirectionalReplay';
import {qqqStoredGexTiming} from '../upstream/src/lib/qqqDirectionalGexTime';
const [dbPath,path]=process.argv.slice(2),url=new URL(path,'http://local');
if(url.pathname==='/api/analysis/qqq/pcs'||url.pathname==='/api/analysis/qqq/gex/intraday-context'){
 const database=new DatabaseSync(dbPath,{readOnly:true});database.exec('BEGIN');try{
 const load=(date:string)=>{const record=database.prepare('SELECT d.payload,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day=?').get(date);if(!record||Date.now()-Number(record.updated_at)>=30*86400000)throw Error('Local day is missing or expired');if(Buffer.byteLength(String(record.payload))>128*1024*1024)throw Error('Local day exceeds bound');if(createHash('sha256').update(String(record.payload)).digest('hex')!==record.sha256)throw Error('Local day integrity failed');return JSON.parse(String(record.payload));};
 if(url.pathname==='/api/analysis/qqq/pcs'){
 if([...url.searchParams.keys()].some(k=>!['from','to','gexDisplay','gexOverview','gexExpiry','page'].includes(k))||url.searchParams.has('page')&&url.searchParams.get('page')!=='1')throw Error('Unsupported PCS query variant');
 const start=Date.parse(url.searchParams.get('from')??''),end=Date.parse(url.searchParams.get('to')??'');if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>90*60000||url.searchParams.get('gexDisplay')!=='1'||url.searchParams.get('gexOverview')!=='1')throw Error('Invalid local PCS window');const date=qqqMarketSession(new Date(start)).date;if(qqqMarketSession(new Date(end)).date!==date)throw Error('PCS window crosses date');const value=load(date),rows=value.rows.filter((r:any)=>Date.parse(r.capturedAt)>=start&&Date.parse(r.capturedAt)<=end),bars=value.bars.filter((b:any)=>Date.parse(b.timestamp)>=start&&Date.parse(b.timestamp)<=end);const expiries=buildHistoricalGexExpiries(rows);const response=historicalGexDisplayPayload(null,date,expiries,bars,url.searchParams.get('gexExpiry'));console.log(JSON.stringify(response));
 }else{
 if([...url.searchParams.keys()].some(k=>!['date','dte','include','page'].includes(k)))throw Error('Unsupported context query variant');
 const date=url.searchParams.get('date')??'',dte=Number(url.searchParams.get('dte')),include=url.searchParams.get('include')??'all';qqqMarketDateBounds(date);if(!Number.isInteger(dte)||dte<0||dte>60||!['all','volume'].includes(include))throw Error('Invalid context scope');const current=load(date),days=[];let previous=date,sourceBytes=0;
 for(let i=0;i<20;i++){previous=qqqPreviousTradingDate(previous);let old;try{old=load(previous);}catch{days.unshift({date:previous,bars:[],levels:[]});continue;}sourceBytes+=Buffer.byteLength(JSON.stringify(old));if(sourceBytes>256*1024*1024)throw Error('Context source exceeds 256 MB');const valid=new Set(qqqRegularBarIndex(old.bars,previous).map(b=>b.openedAt));days.unshift({date:previous,bars:old.bars.filter((b:any)=>valid.has(Date.parse(b.timestamp))),levels:include==='volume'?[]:old.rows.filter((r:any)=>r.dte===dte&&r.inputComplete).map((r:any)=>({time:Date.parse(qqqDirectionalGexTime(r.capturedAt,null,r.profile)),expiry:r.expiryDate,dte:r.dte,netGex:r.netGex,callWall:r.callWallPrice,putWall:r.putWallPrice}))});}
 console.log(JSON.stringify({date,dte,asOf:new Date().toISOString(),currentBars:current.bars,days,requestedDays:20,referenceComplete:false,issues:['Only locally imported observations; reference coverage is not certified']}));
 }
 database.exec('COMMIT');}finally{database.close();}process.exit(0);
}
if(url.pathname!=='/api/analysis/qqq/pcs/backtest'||url.searchParams.get('stream')!=='signals')throw Error('Unsupported local query');
const from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'',start=Date.parse(from),end=Date.parse(to),page=Number(url.searchParams.get('page')??1),pageSize=Number(url.searchParams.get('pageSize')??200);
if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>32*86400000||!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>200)throw Error('Invalid bounded replay range/page');
const db=new DatabaseSync(dbPath,{readOnly:true});db.exec('BEGIN');
try{
 const stored=db.prepare('SELECT d.day,d.payload,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day >= ? AND d.day <= ? ORDER BY d.day LIMIT 34').iterate(new Date(start-86400000).toISOString().slice(0,10),new Date(end+86400000).toISOString().slice(0,10));const days=[];let sourceBytes=0;
 for(const record of stored){if(Date.now()-Number(record.updated_at)>=30*86400000)continue;sourceBytes+=Buffer.byteLength(String(record.payload));if(sourceBytes>256*1024*1024)throw Error('Local replay source exceeds 256 MB bounded read');if(createHash('sha256').update(String(record.payload)).digest('hex')!==record.sha256)throw Error('Local replay integrity failed');const value=JSON.parse(String(record.payload));const bars=value.bars.filter((b:any)=>Date.parse(b.timestamp)>=start&&Date.parse(b.timestamp)<end);if(!bars.length)continue;
 const expiries=value.expiries.map((e:any)=>({expiryDate:e.expiryDate,dte:e.dte,snapshots:value.rows.filter((r:any)=>r.expiryDate===e.expiryDate&&Date.parse(r.capturedAt)>=start&&Date.parse(r.capturedAt)<end).map((r:any)=>({...qqqStoredGexTiming({captured_at:r.capturedAt,source_as_of:r.sourceAsOf,calculation_version:r.calculationVersion,input_complete:r.inputComplete,profile:r.profile}),netGex:r.netGex,gammaFlip:r.gammaFlip,callWallPrice:r.callWallPrice,putWallPrice:r.putWallPrice}))}));
 // Local imports have no certification for complete trading-day coverage.
 days.push({date:String(record.day),bars,expiries,complete:false});
 }
 if(!days.length)throw Error('No local replay source records');
 const replay=replayQqqIntradayDirectional(days),repeatedFingerprint=replayQqqIntradayDirectional(days).fingerprint;if(replay.fingerprint!==repeatedFingerprint)throw Error('Replay determinism failed');const offset=(page-1)*pageSize;const {signals,...stats}=replay;
 console.log(JSON.stringify({...stats,available:true,range:{from,to,toExclusive:true},source:'RAW_REPLAY',repeatedFingerprint,page,pageSize,hasMore:offset+pageSize<signals.length,totalSignals:signals.length,validation:validateQqqIntradayDirectional(replay,repeatedFingerprint),items:signals.slice(offset,offset+pageSize),localCoverage:'only imported observations; complete-day coverage is not certified'}));db.exec('COMMIT');
}finally{db.close();}
