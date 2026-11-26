import {hydrateRow} from './local-rows';
import {createHash} from 'node:crypto';
import {qqqMarketSession} from '../upstream/src/lib/qqqMarketSession';
import {qqqGexExpiriesForSession,qqqGexSessionDte} from '../upstream/src/lib/qqqGexSelection';
import {qqqDirectionalGexSnapshot} from '../upstream/src/lib/qqqDirectionalGexTime';
import {buildQqqIntradayDirectionalFactors,QQQ_INTRADAY_DIRECTIONAL_POLICY} from '../upstream/src/lib/engines/analysis/QqqIntradayDirectional';
import {evaluateQqqDirectionalWithHistory,qqqDirectionalRegularBars} from '../upstream/src/lib/qqqLiveDirectional';
import {qqqDisplayDecision} from '../upstream/src/lib/qqqDisplayDecision';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function localDirectional(db:any,input:any,asOf:string,persist=false){
 const now=new Date(asOf),date=qqqMarketSession(now).date;
 const record=db.prepare('SELECT d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON h.day=d.day WHERE d.day=?').get(date);
 let day:any=null;if(record){if(Buffer.byteLength(record.payload)>128*1024*1024||hash(record.payload)!==record.sha256)throw Error('Directional day integrity/bound failed');day=JSON.parse(record.payload);}
 const bars=qqqDirectionalRegularBars((day?.bars??input.bars??[]).filter((b:any)=>qqqMarketSession(new Date(b.timestamp)).date===date));
 // The engine consumes at most its first three causal expiry buckets. Hydrate
 // their current/previous lossless observations of the newest version; other metadata still reaches the original selector.
 const closeTimes=bars.filter((b:any)=>Date.parse(b.timestamp)+QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes*60000<=now.getTime()).map((b:any)=>Date.parse(b.timestamp)+QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes*60000);const anchorClose=closeTimes.length?Math.max(...closeTimes):-Infinity;
 const sourceExpiries=qqqGexExpiriesForSession(day?.expiries??[],date);const hydratedExpiries=new Set(sourceExpiries.filter((e:any)=>day.rows.some((r:any)=>r.expiryDate===e.expiryDate&&Date.parse(r.archiveTiming?.time??qqqDirectionalGexSnapshot(r.capturedAt,null,r.profile).time)<=anchorClose)).sort((a:any,b:any)=>qqqGexSessionDte(a.expiryDate,date,a.dte)-qqqGexSessionDte(b.expiryDate,date,b.dte)||a.expiryDate.localeCompare(b.expiryDate)).slice(0,QQQ_INTRADAY_DIRECTIONAL_POLICY.expiryLimit).map((e:any)=>e.expiryDate));
 const hydrateKeys=new Set<string>();for(const expiry of hydratedExpiries){const candidates=day.rows.filter((r:any)=>r.expiryDate===expiry&&Date.parse(r.archiveTiming?.time??qqqDirectionalGexSnapshot(r.capturedAt,null,r.profile).time)<=anchorClose).sort((a:any,b:any)=>Date.parse(a.archiveTiming?.time??a.capturedAt)-Date.parse(b.archiveTiming?.time??b.capturedAt));const version=candidates.at(-1)?.archiveTiming?.calculationVersion??candidates.at(-1)?.calculationVersion;for(const row of candidates.filter((r:any)=>(r.archiveTiming?.calculationVersion??r.calculationVersion)===version).slice(-2))hydrateKeys.add(row.expiryDate+'|'+row.capturedAt);}
 const expiries=qqqGexExpiriesForSession(day?.expiries??[],date).map((e:any)=>({expiryDate:e.expiryDate,dte:qqqGexSessionDte(e.expiryDate,date,e.dte),snapshots:day.rows.filter((r:any)=>r.expiryDate===e.expiryDate).map((r:any)=>hydrateKeys.has(r.expiryDate+'|'+r.capturedAt)?hydrateRow(db,r):r).map((r:any)=>({...(r.archiveTiming??qqqDirectionalGexSnapshot(r.capturedAt,null,r.profile)),netGex:r.netGex,gammaFlip:r.gammaFlip,callWallPrice:r.callWallPrice,putWallPrice:r.putWallPrice,profile:r.profile})).sort((a:any,b:any)=>Date.parse(a.time)-Date.parse(b.time))}));
 const available=!!db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_live_signals'").get();const signals:any[]=[];
 if(available&&Number(db.prepare('SELECT count(*) n FROM qqq_gex_live_signals WHERE day=?').get(date).n)>1000)throw Error('Canonical signal count exceeds source bounds');
 if(available)for(const row of db.prepare('SELECT body,sha256 FROM qqq_gex_live_signals WHERE day=? ORDER BY anchor_at,signal_id LIMIT 1000').iterate(date)){if(hash(row.body)!==row.sha256)throw Error('Canonical signal integrity failed');signals.push(JSON.parse(row.body));}
 const built=buildQqqIntradayDirectionalFactors({asOf,bars,expiries});const computed=evaluateQqqDirectionalWithHistory(built.factors,bars,signals);
 if(persist&&available&&qqqMarketSession(now).stocksOpen&&computed.signalId&&computed.anchorBar&&['ALERT_LONG','ALERT_SHORT'].includes(computed.status)&&!signals.some(s=>s.signalId===computed.signalId)){
  const body=JSON.stringify(computed);db.prepare('INSERT INTO qqq_gex_live_signals VALUES(?,?,?,?,?,?)').run(computed.signalId,date,computed.anchorBar,body,JSON.stringify(built.factors),hash(body));signals.push(computed);
 }
 return {decision:qqqDisplayDecision(computed,signals,now.getTime(),bars),canonicalSignals:signals,factors:built.factors,storageAvailable:available,coverage:'Canonical alerts are stored only by explicit capture/calculation writes; reads never create alerts'};
}

export function localPcsLifecycle(db:any,decision:any,persist=false){
 const date=qqqMarketSession(new Date(decision.asOf)).date;const available=!!db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_pcs_lifecycle'").get();
 if(available&&persist&&decision.evaluatedLifecyclePoint){const point=decision.evaluatedLifecyclePoint,body=JSON.stringify(point);db.prepare('INSERT INTO qqq_gex_pcs_lifecycle VALUES(?,?,?,?) ON CONFLICT(day,time) DO UPDATE SET body=excluded.body,sha256=excluded.sha256').run(date,point.time,body,hash(body));}
 const points:any[]=[];if(available){if(Number(db.prepare('SELECT count(*) n FROM qqq_gex_pcs_lifecycle WHERE day=?').get(date).n)>1000)throw Error('PCS lifecycle exceeds bounded two-minute day');for(const row of db.prepare('SELECT body,sha256 FROM qqq_gex_pcs_lifecycle WHERE day=? ORDER BY time').iterate(date)){if(hash(row.body)!==row.sha256)throw Error('PCS lifecycle integrity failed');points.push(JSON.parse(row.body));}}
 return {available,points,coverage:'Only locally computed and persisted source PCS observations; reads do not mint historical points'};
}
