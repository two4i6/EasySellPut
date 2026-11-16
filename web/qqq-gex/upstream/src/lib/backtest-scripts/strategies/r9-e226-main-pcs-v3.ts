/** E226's effective Candidate3 prerequisite. Selection/admission only; no replay or execution. */
import {freezeStrategyData} from '../strategy-module-v2';
import {isPcsContractProfileStressed} from '../../engines/leveraged-overlay/v2/strategies/pcs-contract-profile';
import {selectStressOnlyPcsCandidate} from '../pcs-selection-v6';
import {evaluatePcsRiskEnvelope} from '../../engines/leveraged-overlay/v2/strategies/pcs-risk-envelope';
import {isPcsV12GateBlocked,isPcsV121Simple5Release,isPcsCandidate3ExtraRelease,evaluatePcsV123Gate}
  from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import type {PcsAnalyticalProbe} from '../qqq-pcs-analytics-v2';
import type {R9E226Market} from './r9-e226-policy-v5';

export const R9_MAIN_PCS_CONTRACT=freezeStrategyData({targetDte:35,widthPct:.03,riskBudgetNav:.215,
  forceMinimumContract:false,survivalFloor:.3,survivalWeight:.75,wilsonWeight:.5,
  objective:'survival_adjusted_expected_pnl',v123B30ReleaseLower:.38} as const);
export function r9MainPcsStress(input:{regime:string;primaryVol?:number;primaryVol3m?:number;annualizedQqqRv20?:number}){
  return isPcsContractProfileStressed({regime:input.regime,vix:input.primaryVol,
    vix3m:input.primaryVol3m,annualizedRv20:input.annualizedQqqRv20});
}
export function selectR9MainPcs(input:{market:Readonly<R9E226Market>;originalSignal:boolean;
  primaryVol?:number;primaryVol3m?:number;annualizedQqqRv20?:number;candidates:readonly PcsAnalyticalProbe[]}){
  if(!input.originalSignal)return {selected:null,reason:'main-source-inactive'};
  const m=input.market,p=R9_MAIN_PCS_CONTRACT;
  const stressed=r9MainPcsStress({regime:m.regime,...input});
  const selection=selectStressOnlyPcsCandidate({stressed,pool:'profile',
    geometry:{widthPct:p.widthPct,error:'R9 main candidate geometry differs from contract'},
    floor:p.survivalFloor,objective:p.objective,survivalWeight:p.survivalWeight,survivalWilsonWeight:p.wilsonWeight,
    candidates:input.candidates});
  if(!selection)return {selected:null,reason:'main-no-survival-contract'};
  const selected=input.candidates[selection.selectedIndex]!;
  const gates={enabled:true,v11ReleaseMode:'rv20_lt_067_or_sr02_adx20' as const,
    regime:m.regime,slowSubregime:m.slowSubregime,vix:m.vix,adx14:m.adx14,
    range20dPct:m.range20dPct,priceExtensionAtr:m.priceExtensionAtr,roc20:m.roc20,
    tqqqRealisedVol20d:m.rv20,drawdownFromRecentHighPct:m.drawdownFromRecentHighPct,
    rsi14:m.rsi14,roc5:m.roc5,priceVsSma200Pct:m.sma200Pct,weakeningSignalCount:m.weakeningCount,
    selectedNoTouchLower:selection.diagnostic.selectedNoTouchLower,selectedSigma:selected.sigma};
  const extra=isPcsCandidate3ExtraRelease(gates,'bull_sr02_rv_adx');
  if(isPcsV12GateBlocked(gates)&&!isPcsV121Simple5Release(gates)&&!extra)
    return {selected:null,reason:'main-v121-block'};
  const v123=evaluatePcsV123Gate({...gates,b30ReleaseLower:p.v123B30ReleaseLower});
  const envelope=evaluatePcsRiskEnvelope({regime:m.regime,slowSubregime:m.slowSubregime,vix:m.vix,
    rv20:m.rv20,priceVsSma200Pct:m.sma200Pct,drawdownFromRecentHighPct:m.drawdownFromRecentHighPct,
    adx14:m.adx14,roc20:m.roc20},'candidate4_full_v1');
  if(v123.blockedBy.length&&!extra&&envelope.band!=='FULL')return {selected:null,reason:'main-v123-block'};
  return {selected,reason:'main-candidate3-admitted',selection:selection.diagnostic};
}
