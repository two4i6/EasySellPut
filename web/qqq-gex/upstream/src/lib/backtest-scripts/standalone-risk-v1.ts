/** Independent release checks; never used for admission or parameter selection. */
import type {StrategyFeedback,StrategyObject} from './strategy-module-v2';
import {spreadTradeStatistics} from './spread-research-metrics-v2';
export const standaloneResearchReleaseGates=Object.freeze({untouchedHoldout:'UNPASSED',capitalAcceptance:'WAIVED_BY_USER_NOT_PROVEN',
  approvedStrategyRiskLimits:'UNPASSED',stressMatrix:'UNPASSED_FULL_FEEDBACK_REPLAY',
  observedFillCapacity:'WAIVED_BY_USER_NOT_PROVEN',productionPromotion:'NOT_AUTHORIZED'});
export function assessStandaloneRisk(events:readonly StrategyFeedback[],accounts:readonly StrategyObject[],
  initialCapital:number,expected:{trades:number;pl:number;mtmMdd:number;realizedMdd:number;wins:number;losses:number}){
  const live=new Map<string,StrategyFeedback>(),closed:Array<{date:string;pnl:number}>=[];
  let rejected=0;
  for(const e of events){if(e.payload.sourceAccount!==undefined&&e.payload.sourceAccount!=='portfolio')continue;
    if(e.kind==='reject'){rejected++;continue;}
    const id=String(e.payload.positionId);
    if(e.kind==='fill'){if(live.has(id))throw Error('Risk duplicate opening');live.set(id,e);}
    else{const own=live.get(id);if(!own)throw Error('Risk close without ownership');
      const pnl=(Number(own.payload.cashImpact)+Number(e.payload.cashImpact))*Number(own.payload.multiplier);
      if(!Number.isFinite(pnl)||Math.abs(pnl-Number(e.payload.pnl))>1e-7)throw Error('Risk P&L mismatch');
      closed.push({date:e.asOf,pnl});live.delete(id);}
  }
  function measure(start:string,end:string){
    let peak=initialCapital,realizedPeak=0,mtmMdd=0,realizedMdd=0;
    for(const row of accounts){const date=String(row.asOf),equity=Number(row.equity),realized=Number(row.realized);
      if(!Number.isFinite(equity)||!Number.isFinite(realized))throw Error('Risk invalid account');
      if(date<start){peak=equity;realizedPeak=realized;continue;}if(date>end)break;
      peak=Math.max(peak,equity);realizedPeak=Math.max(realizedPeak,realized);
      mtmMdd=Math.max(mtmMdd,peak-equity);realizedMdd=Math.max(realizedMdd,realizedPeak-realized);}
    const pnls=closed.filter(t=>t.date>=start&&t.date<=end).map(t=>t.pnl);
    return {...spreadTradeStatistics(pnls),pl:pnls.reduce((a,b)=>a+b,0),mtmMdd,realizedMdd};
  }
  const full=measure('0000-01-01','9999-12-31');
  for(const key of ['trades','wins','losses','pl','mtmMdd','realizedMdd'] as const)
    if(Math.abs(Number(full[key])-expected[key])>1e-7)throw Error(`Independent risk summary mismatch: ${key}`);
  return {version:'standalone-independent-risk-v1',accountAndTailReconstruction:'PASS',full,
    openPositions:live.size,rejected,
    periods:[['2010-01-01','2016-12-31','MODEL-SENSITIVE'],['2017-01-01','2021-12-31','DEVELOPMENT'],['2022-01-01','9999-12-31','RETROSPECTIVE-NOT-HOLDOUT']].map(([start,end,status])=>({start,end,status,...measure(start!,end!)})),
    gates:{...standaloneResearchReleaseGates},productionReady:false};
}
