import { QQQ_INTRADAY_DIRECTIONAL_POLICY, type QqqIntradayDirectionalDecision, type QqqIntradayBar } from './engines/analysis/QqqIntradayDirectional';
import { qqqMarketSession } from './qqqMarketSession';

/** Browser clocks must age evidence even when no further response arrives. */
export function qqqDirectionalEvidenceExpired(quality:QqqIntradayDirectionalDecision['dataQuality']|undefined,now:number) {
  if(!quality?.evaluatedAt)return false;
  const elapsed=Math.max(0,(now-Date.parse(quality.evaluatedAt))/1000);
  return !Number.isFinite(elapsed) || quality.barAgeSeconds===null || quality.gexAgeSeconds===null
    || quality.barAgeSeconds+elapsed>QQQ_INTRADAY_DIRECTIONAL_POLICY.maxBarAgeSeconds
    || quality.gexAgeSeconds+elapsed>QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds;
}

/** Display persisted canonical alerts only; stale evidence can never revive them. */
export function qqqDisplayDecision(computed:QqqIntradayDirectionalDecision,signals:readonly QqqIntradayDirectionalDecision[],now:number,bars:readonly QqqIntradayBar[] = []) {
  const quality=computed.dataQuality;
  const regular=qqqMarketSession(new Date(now)).stocksOpen;
  const fresh=quality.barAgeSeconds!==null && quality.gexAgeSeconds!==null
    && quality.barAgeSeconds>=0 && quality.barAgeSeconds<=QQQ_INTRADAY_DIRECTIONAL_POLICY.maxBarAgeSeconds
    && quality.gexAgeSeconds>=0 && quality.gexAgeSeconds<=QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds;
  const latest=regular && fresh && computed.status!=='INSUFFICIENT_DATA' && !computed.blockers?.length
    ? [...signals].filter(signal=>signal.anchorBar && Date.parse(signal.anchorBar)<=now)
      .sort((a,b)=>Date.parse(a.anchorBar!)-Date.parse(b.anchorBar!)).at(-1):undefined;
  const invalidated = latest?.intent==='ENTRY' && latest.invalidation!==null && Number.isFinite(latest.invalidation)
    && bars.some(bar=>Date.parse(bar.timestamp)>Date.parse(latest.anchorBar!)
      && Date.parse(bar.timestamp)+QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes*60000<=now
      && (latest.direction==='LONG' ? (bar.low ?? bar.close)<=latest.invalidation! : (bar.high ?? bar.close)>=latest.invalidation!));
  if(latest?.validUntil && Date.parse(latest.validUntil)>now && !invalidated)return {...latest,dataQuality:quality};
  if(!computed.signalId && (regular || computed.status==='INSUFFICIENT_DATA'))return computed;
  return {...computed,status:'NO_SIGNAL' as const,signalId:null,structureId:null,alertType:null,direction:null,playbook:null,
    grade:null,intent:null,stage:null,riskPlan:null,structureContext:null,anchorBar:null,entryZone:null,invalidation:null,
    targets:null,validUntil:null,planExpiresAt:null};
}
