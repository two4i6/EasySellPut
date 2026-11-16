/** Phase 1: native as-of observation projection/history only. Stock/NAV transitions
 * remain in the authoritative chronological loop, not reimplemented as indicators. */
import type {OHLCV} from '../../types/input';
import type {SystemOutput} from '../../types/output';
import type {NativeDecisionObservation} from './native-observation-contract-v2';
export type {NativeDecisionObservation} from './native-observation-contract-v2';
type Input=Omit<NativeDecisionObservation,'marketContext'|'systemStatus'|'blockers'|'upstreamStatuses'|'qqqRoc5Slope'|'macro'> & {
  output:SystemOutput;macro:Omit<NativeDecisionObservation['macro'],'vxnHistory'>;qqq:readonly OHLCV[];
};
const upstreamKeys=['dataQuality','regime','hardRisk','trend','volTarget','riskBudget','drawdownGovernor','tailRiskGovernor','intradayGate'];
export function createNativeDecisionObservationEngine(resolveVxn:(date:string)=>number|undefined,appendOnlyDaily:boolean,
  snapshot:(value:NativeDecisionObservation)=>NativeDecisionObservation=structuredClone){
  let cursor=0,lastAsOf:string|null=null,historyBars:readonly OHLCV[]|undefined,lastHistoryDate:string|undefined;
  const history:number[]=[];
  return {
    observe(input:Input):NativeDecisionObservation{
      if(lastAsOf!==null&&input.asOf<=lastAsOf)throw Error('Native observation must advance chronologically');
      const {qqq,output}=input;
      let vxnHistory:number[];
      if(appendOnlyDaily){
        if(historyBars&&(historyBars!==qqq||qqq.length<cursor||qqq[cursor-1]?.date!==lastHistoryDate))
          throw Error('Native observation history must be append-only');
        historyBars=qqq;
        while(cursor<qqq.length){const value=resolveVxn(qqq[cursor++]!.date);if(value!=null)history.push(value);}
        lastHistoryDate=qqq.at(-1)?.date;
        vxnHistory=history;
      }else{
        // Intraday aggregation may revise the last bar. Keep its historical semantics.
        vxnHistory=qqq.map(bar=>resolveVxn(bar.date)).filter((value):value is number=>value!=null);
      }
      lastAsOf=input.asOf;
      // The synchronous snapshot must own its result before the chronological loop resumes.
      return snapshot({asOf:input.asOf,marketContext:output.currentState,stockAccount:input.stockAccount,
        priorRegime:input.priorRegime,crisisPhase:input.crisisPhase,prevCloseNav:input.prevCloseNav,navDrawdownPeak:input.navDrawdownPeak,
        macro:{...input.macro,vxnHistory},systemStatus:output.systemStatus,blockers:output.blockers,
        upstreamStatuses:Object.fromEntries(upstreamKeys.flatMap(key=>{
          const result=output.pipeline[key as keyof typeof output.pipeline] as {status?:string}|undefined;
          return result?.status?[[key,result.status]]:[];
        })),
        qqqRoc5Slope:qqq.length>=7?qqq.at(-1)!.close/qqq.at(-6)!.close-qqq.at(-2)!.close/qqq.at(-7)!.close:undefined});
    },
  };
}
