/** Current-bar page CCS policy. Quotes, settlement, marks and accounts are SDK-owned. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyObject,
  type StrategyJson,type StrategyIntent,type StrategyFeedback} from '../strategy-module-v2';
import type {CcsContractProbe,CcsAnalyticalProbe} from '../qqq-ccs-analytics-v1';
import {settledFeedbackPnl} from '../settlement-observations-v3';
import {createAdmissionTrace} from '../strategy-admission-v1';
import type {MarketRegime} from '../../engines/leveraged-overlay/types/output';
import {evaluateCallCreditSpreadCandidate,resolveCallCreditSpreadRegimeContext,
  resolveCallCreditSpreadExtensionGate,isCallCreditSpreadExtensionBlocked,isCallCreditSpreadPreCrisis,
  isCallCreditSpreadEventRiskScoped,isCallCreditSpreadResearchEntryBlocked,isCallCreditSpreadTailEntryBlocked,
  isCallCreditSpreadCandidate9MddBlocked,isCallCreditSpreadCandidate9CoreFusionRelease,
  isCallCreditSpreadBalancedL1abV11Release,isCallCreditSpreadValidatedSafeRelease,
  resolveCallCreditSpreadShortDelta,resolveCallCreditSpreadSlopeShortDelta,
  isCallCreditSpreadSlowTrend,isCallCreditSpreadFastAcceleration,isCallCreditSpreadHighPressure,
  resolveCallCreditSpreadVxnRescueSizeMultiplier,isCallCreditSpreadBelowResearchCreditFloor,
  resolveCallCreditSpreadDeltaStopThreshold,resolveCallCreditSpreadDaysHeldRiskThreshold,
  shouldTriggerCallCreditSpreadDeltaStop,evaluateCallCreditSpreadExit} from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import {candidateShortDeltasForCsSurvivalSelection,candidateWidthsForCsSurvivalSelection,
  selectCsSurvivalCandidate,selectCsHighWinCoverageCandidate} from '../../engines/leveraged-overlay/v2/strategies/cs-survival-selector';
import {evaluateWr89Entry,isWr90ConditionalBlock} from '../../engines/leveraged-overlay/v2/strategies/cs-wr89-controller';
import {CCS_C3_E856_EFFECTIVE_PARAMETERS as p,CCS_C3_E856_RUNTIME_CONTRACT,
  CCS_C3_E856_LINEAGE} from './ccs-c3-e856-contract-v1';

const defaults:StrategyObject=freezeStrategyData({...p,lineage:[...CCS_C3_E856_LINEAGE],
  positionMode:CCS_C3_E856_RUNTIME_CONTRACT.positionMode});
const transitionContract=freezeStrategyData({shortDelta:.10,widthPct:.05});
const obj=(v:unknown,label:string):StrategyObject=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error(`Missing CCS ${label}`);return v as StrategyObject;
};
const n=(o:Readonly<StrategyObject>,key:string)=>typeof o[key]==='number'&&Number.isFinite(o[key])?Number(o[key]):undefined;
const required=(o:Readonly<StrategyObject>,key:string)=>{const value=n(o,key);if(value===undefined)throw Error(`Missing CCS ${key}`);return value;};
type Route='primary'|'conservative_fallback'|'normal_coverage'|'pre_crisis_coverage';
type Entry={route:Route;signalIndex:number;eventScoped:boolean;nextCooldown:number;
  profitTarget:number;deltaStopThreshold:number;exitScheduled:boolean};
type State={barIndex:number;lastAsOf:string|null;weakPersistenceDays:number;cooldownRemaining:number;
  eventRisk:{entriesInWindow:number;lastSignalIndex:number}|null;pending:Record<string,Entry>;
  owned:Record<string,Entry>;closing:Record<string,string>;priorTqqqRoc20:number|null};
type Facts=ReturnType<typeof ccsCurrentFacts>;

/** Keep entry VIX and execution VXN coordinates distinct, including missing-VXN fallback. */
export function ccsCurrentFacts(native:Readonly<StrategyObject>){
  const c=obj(native.marketContext,'market context'),macro=obj(native.macro,'macro');
  if(typeof c.regime!=='string')throw Error('Missing CCS regime');
  const history=macro.vxnHistory as number[]|undefined,vxn=n(macro,'vxn'),vix=n(macro,'vix')??20,vix3m=n(macro,'vix3m');
  const vxnChange=vxn!==undefined&&history&&history.length>=6&&history.at(-6)!>0
    ?(vxn-history.at(-6)!)/history.at(-6)!:undefined;
  const change=vxnChange??(history&&history.length>=6&&history.at(-6)!>0
    ?(history.at(-1)!-history.at(-6)!)/history.at(-6)!
    :n(macro,'vix5dAgo')!==undefined&&Number(macro.vix5dAgo)>0?(vix-Number(macro.vix5dAgo))/Number(macro.vix5dAgo):undefined);
  const common={regime:String(c.regime),vix,vix3m,tqqqRoc20:n(c,'tqqqRoc20')??0,
    qqqRoc5:n(c,'roc5')??0,qqqRoc20:n(c,'roc20')??0,sma20SlopePct:n(c,'sma20SlopePct')};
  const slow=isCallCreditSpreadSlowTrend({...common,vixMax:p.csSlowTrendVixMax});
  const fast=isCallCreditSpreadFastAcceleration({...common,roc5Min:p.csSlowTrendFastAccelerationRoc5,
    slopeMinPct:p.csSlowTrendFastAccelerationSlopePct});
  const baseDelta=resolveCallCreditSpreadShortDelta({...common,mode:p.csMode,
    dynamicCalmVix:p.csSpLikeDynamicCalmVix,dynamicCalmRoc20:p.csSpLikeDynamicCalmRoc20,
    dynamicCalmDelta:p.csSpLikeDynamicCalmDelta,dynamicWeakDelta:p.csSpLikeDynamicWeakDelta,
    vxnRescueDelta:p.csResearchVxnRescueDelta,vxn,vxnRescueMinVix:p.csResearchVxnRescueMinVix,
    vxnRescueVixChangeMin:p.csResearchVxnRescueVixChangeMin,vixChange5d:vxnChange});
  const shortDelta=resolveCallCreditSpreadSlopeShortDelta({...common,mode:p.csSlopeShortLegMode,
    baseDelta,slowTrend:slow&&!fast,fastDelta:p.csSlopeShortLegFastDelta,slowDelta:p.csSlopeShortLegSlowDelta});
  const width=c.regime==='RANGE_BOUND'&&c.slowSubregime==='SR02'&&vix<19?p.csConditionalWidthPct:p.csSpreadWidthPct;
  const rescueMultiplier=resolveCallCreditSpreadVxnRescueSizeMultiplier({configuredMultiplier:p.csVxnRescueSizeMultiplier,
    vxn,qqqRoc20:common.qqqRoc20,vixChange5d:vxnChange,minVxn:p.csResearchVxnRescueMinVix,
    vixChange5dMin:p.csResearchVxnRescueVixChangeMin});
  return {...common,c,macro,vxn,vxnChange,change,shortDelta,width,rescueMultiplier,
    slowSubregime:typeof c.slowSubregime==='string'?c.slowSubregime:undefined,
    preCrisis:isCallCreditSpreadPreCrisis({...common,tqqqRealisedVol20d:n(c,'tqqqRealisedVol20d'),
      vixMax:p.csPreCrisisVixMax,tqqqRealisedVol20dMin:p.csPreCrisisTqqqRv20Min,tqqqRoc20Max:p.csPreCrisisTqqqRoc20Max}),
    highPressure:isCallCreditSpreadHighPressure({...common,riskVix:p.csDeltaStopRiskVix,calmRoc20:p.csDeltaStopCalmRoc20})};
}

/** Flattened active E856 gates; no native Overlay result is used as a decision. */
export function ccsC3E856Admission(f:Facts,weakPersistenceDays:number,eventCount:number){
  const {c,regime,vix,vix3m,slowSubregime}=f;
  const posterior=slowSubregime==='SR01'||slowSubregime==='SR02'?n(c,'slowSubregimePosterior'):undefined;
  const regimeContext=resolveCallCreditSpreadRegimeContext({regime,mode:p.csMode,sma50:n(c,'sma50'),sma200:n(c,'sma200')});
  const raw=evaluateCallCreditSpreadCandidate({enabled:true,pendingCollarHasShortCall:false,hasOpenCollarShortCall:false,
    hasOpenCallSpread:false,...regimeContext,mode:p.csMode,regime,vix,vixHighThreshold:p.csSpLikeVixHigh,
    backwardation:vix3m===undefined?undefined:vix>vix3m,requireTermStructure:p.csSpLikeDynamicRequireTermStructure,
    tqqqRoc20:f.tqqqRoc20,qqqRoc5:f.qqqRoc5,hasOnlyPutSpreadProtection:false,pendingPutSpreadProtection:false,
    vixLowThreshold:15,overboughtRoc20:.20,recoveryRoc5:0,recoveryRoc20:.10,breachBlocked:false});
  const eventScoped=isCallCreditSpreadEventRiskScoped({preCrisisActive:f.preCrisis,regime,slowSubregime,scope:p.csPreCrisisEventScope});
  const capReleased=eventScoped&&eventCount===1
    &&(slowSubregime==='SR01'&&regime==='RISK_ON_WEAKENING'&&vix>=p.csPreCrisisCapReleaseMinVix
      ||slowSubregime==='SR02'&&regime==='BULL'&&f.qqqRoc5>=0);
  const capBlocked=eventScoped&&eventCount>=p.csPreCrisisMaxEntriesInWindow&&!capReleased;
  const gate=resolveCallCreditSpreadExtensionGate({mode:p.csMode,regime,vix,tqqqRoc20:f.tqqqRoc20,
    baseGate:p.csSpLikeExtensionGate,dynamicCalmVix:p.csSpLikeDynamicCalmVix,
    dynamicCalmRoc20:p.csSpLikeDynamicCalmRoc20,dynamicCalmGate:p.csSpLikeDynamicCalmExtensionGate});
  const extension= isCallCreditSpreadExtensionBlocked(raw,n(c,'priceExtensionAtr'),gate);
  const gateFacts={regime,slowSubregime,vix,adx14:n(c,'adx14'),tqqqRealisedVol20d:n(c,'tqqqRealisedVol20d'),
    qqqRoc5:f.qqqRoc5,qqqRoc20:f.qqqRoc20,priceExtensionAtr:n(c,'priceExtensionAtr'),
    priceVsSma200Pct:n(c,'priceVsSma200Pct'),drawdownFromRecentHighPct:n(c,'drawdownFromRecentHighPct')};
  const tail=raw&&isCallCreditSpreadTailEntryBlocked({...gateFacts,gate:p.csTailEntryGate});
  const mdd=raw&&isCallCreditSpreadCandidate9MddBlocked({...gateFacts,gate:p.csCandidate9MddEntryGate,roc20:f.qqqRoc20});
  const tailEffective=tail&&!( !mdd&&isCallCreditSpreadCandidate9CoreFusionRelease({
    mode:p.csCandidate9CoreFusionReleaseMode,priceExtensionAtr:n(c,'priceExtensionAtr'),vixChange5d:f.change,slowSubregime}));
  const research=raw&&isCallCreditSpreadResearchEntryBlocked({gate:p.csResearchEntryGate,
    posterior,weakPersistenceDays,vixChange5d:f.vxnChange,regime,
    slowSubregime:slowSubregime as 'SR01'|'SR02'|'UNKNOWN'|undefined});
  const bandRelease=research&&regime==='BULL'&&vix>=p.csResearchEntryBullVixBandMin&&vix<19.5
    &&(vix>=p.csResearchEntryBullVixBandLowerSegmentVixMax
      ||(n(c,'priceExtensionAtr')??-Infinity)>=p.csResearchEntryBullVixBandLowerSegmentPriceExtensionMin)
    &&(n(c,'priceExtensionAtr')??Infinity)<=p.csResearchEntryBullVixBandPriceExtensionMax
    &&f.change!==undefined&&f.change<=p.csResearchEntryBullVixBandVixChange5dMax&&f.tqqqRoc20>0&&slowSubregime==='SR02';
  const balanced=research&&isCallCreditSpreadBalancedL1abV11Release({...gateFacts,mode:'balanced_l1ab_without_v11',
    roc20:f.qqqRoc20,weakeningSignalCount:n(c,'weakeningSignalCount')});
  const researchEffective=research&&!bandRelease&&!balanced;
  const safe=raw&&!mdd&&isCallCreditSpreadValidatedSafeRelease({...gateFacts,mode:p.csValidatedSafeReleaseMode,
    slowSubregimePosterior:posterior,weakPersistenceDays,vixChange5d:f.change,
    vixChange5dPoints:n(f.macro,'vix5dAgo')===undefined?undefined:vix-Number(f.macro.vix5dAgo),
    vixPointThreshold:p.csValidatedSafeVixPointThreshold,tailBlocked:tailEffective,
    researchBlocked:researchEffective,extensionBlocked:extension,mddBlocked:mdd});
  const tailFinal=tailEffective&&!safe,researchFinal=researchEffective&&!safe,extensionFinal=extension&&!safe;
  const primary=raw&&!extensionFinal&&!mdd&&!tailFinal&&!capBlocked&&!researchFinal;
  const preCoverage=raw&&f.preCrisis&&eventScoped&&capBlocked&&!extension&&!mdd&&!tailEffective&&!researchEffective;
  const extensionQuality=vix<18;
  const normalCoverage=raw&&!primary&&!preCoverage&&!capBlocked&&(!extension||extensionQuality)&&!mdd
    &&(researchFinal||tailFinal||extensionQuality&&extensionFinal);
  return {raw,primary,preCoverage,normalCoverage,capBlocked,extension,eventScoped,extensionQuality,
    tailFinal,researchFinal,mdd};
}

function selectContract(f:Facts,admission:ReturnType<typeof ccsC3E856Admission>,analytics:StrategyObject){
  const plans=obj(analytics.plans,'analytical plans'),main=obj(plans.main,'main probes'),coverage=obj(plans.coverage,'coverage probes');
  if(!Array.isArray(main.quotes)||!Array.isArray(main.candidates)||!Array.isArray(coverage.quotes)||!Array.isArray(coverage.candidates))
    throw Error('Missing CCS quotes/candidates');
  const quotes=main.quotes as unknown as CcsContractProbe[],candidates=main.candidates as unknown as CcsAnalyticalProbe[];
  const find=(delta:number,width:number)=>quotes.find(c=>c.shortDelta===delta&&c.widthPct===width&&c.sigma===undefined);
  const coverageContract=(pre:boolean)=>{
    const bullReleased=!pre&&f.regime==='BULL'&&f.slowSubregime==='SR02'&&f.vix<=p.csSecondaryCoverageBullSr02VixMax
      &&f.vix3m!==undefined&&f.vix3m-f.vix>=p.csSecondaryCoverageBullSr02TermStructureSlopeMin
      &&n(f.c,'priceExtensionAtr')!==undefined&&(Number(f.c.priceExtensionAtr)<p.csSecondaryCoverageBullSr02TermStructureExtensionMin
        ||f.change!==undefined&&f.change<=p.csSecondaryCoverageBullSr02VixChange5dMax);
    const delta=pre?p.csSecondaryCoveragePreCrisisShortDelta:p.csSecondaryCoverageShortDelta;
    const width=pre?p.csSecondaryCoveragePreCrisisWidthPct:p.csSecondaryCoverageWidthPct;
    const pool=(coverage.candidates as unknown as CcsAnalyticalProbe[]).filter(c=>c.shortDelta===delta&&c.widthPct===width&&c.sigma===undefined);
    const floor=pre?p.csSecondaryCoveragePreCrisisSurvivalFloor
      :f.regime!=='BULL'||bullReleased?p.csSecondaryCoverageNormalRelaxedFloor:p.csSecondaryCoverageSurvivalFloor;
    const selected=selectCsHighWinCoverageCandidate({floor,candidates:pool});
    return selected?{quote:pool[selected.selectedIndex]!,route:(pre?'pre_crisis_coverage':'normal_coverage') as Route,
      targetDte:p.csSecondaryCoverageTargetDte,profitTarget:pre?p.csSecondaryCoveragePreCrisisProfitTarget:p.csSecondaryCoverageProfitTarget,
      deltaStopThreshold:pre?p.csSecondaryCoveragePreCrisisDeltaStopThreshold:bullReleased?p.csSecondaryCoverageBullDeltaStopThreshold:p.csSecondaryCoverageDeltaStopThreshold}:null;
  };
  if(admission.preCoverage)return coverageContract(true);
  if(admission.normalCoverage)return coverageContract(false);
  if(!admission.primary)return null;
  const transition=[Number(f.c.weakeningSignalCount??0)>=2,Number(f.c.rsi14??NaN)<50,f.vix<17,
    Number(f.c.priceVsSma200Pct??NaN)<.08].every(Boolean);
  let quote=transition?find(transitionContract.shortDelta,transitionContract.widthPct):find(f.shortDelta,f.width),route:Route='primary';
  if(f.highPressure){
    const pool:CcsAnalyticalProbe[]=[];
    for(const delta of candidateShortDeltasForCsSurvivalSelection(f.shortDelta))
      for(const width of candidateWidthsForCsSurvivalSelection(p.csSurvivalSelectionWidthMode,f.width)){
        const candidate=candidates.find(c=>c.shortDelta===delta&&c.widthPct===width&&c.sigma===undefined);
        if(candidate)pool.push(candidate);
      }
    const baselineIndex=pool.findIndex(c=>c.shortDelta===f.shortDelta&&c.widthPct===f.width);
    const selected=selectCsSurvivalCandidate({floor:p.csSurvivalSelectionFloor,objective:p.csSurvivalSelectionObjective,
      survivalWeight:p.csSurvivalSelectionSurvivalWeight,survivalWilsonWeight:p.csSurvivalSelectionWilsonWeight,
      widthMode:p.csSurvivalSelectionWidthMode,baselineCredit:quote?.credit,creditRetentionFloor:p.csSurvivalSelectionCreditRetentionFloor,
      ...(baselineIndex<0?{}:{baselineIndex}),candidates:pool});
    if(selected)quote=pool[selected.selectedIndex]!;
    else {
      if(!admission.capBlocked&&!admission.extension){const covered=coverageContract(false);if(covered)return covered;}
      if(f.preCrisis||admission.capBlocked)return null;
      const fallback=candidates.find(c=>c.shortDelta===p.csSurvivalFallbackShortDelta&&c.widthPct===p.csSurvivalFallbackWidthPct&&c.sigma===undefined);
      if(!fallback||fallback.survival.interval?.lower==null||fallback.survival.interval.lower<p.csSurvivalFallbackFloor
        ||!(fallback.credit>0&&fallback.maxLoss>0))return null;
      quote=fallback;route='conservative_fallback';
    }
  }
  if(!quote||isCallCreditSpreadBelowResearchCreditFloor(quote.credit,p.csResearchMinCredit,f.regime,
    p.csResearchMinCreditScope,f.vix,f.slowSubregime,f.change))return null;
  return {quote,route,targetDte:p.csTargetDte,profitTarget:p.csProfitTarget,deltaStopThreshold:p.csDeltaStopThreshold};
}

function closeIntents(state:State,snapshot:{asOf:string;market:StrategyObject;positions:StrategyObject[]},native:StrategyObject,f:Facts){
  const intents:StrategyIntent[]=[];
  const exit=snapshot.market.callExit as StrategyObject|undefined;
  for(const position of snapshot.positions){
    const id=String(position.id),entry=state.owned[id];
    if(!entry)throw Error('Unowned CCS position');
    if(entry.exitScheduled)continue;
    const daysLeft=required(position,'daysLeft');if(daysLeft<=0)continue;
    if(!exit)throw Error('Missing CCS as-of exit observations');
    const regime=String(exit.regime??native.priorRegime??'BULL') as MarketRegime;
    const pricingVol=required(exit,'pricingVol'),pricingVol3m=n(exit,'pricingVol3m');
    const common={regime,vix:pricingVol,vix3m:pricingVol3m,tqqqRoc20:n(exit,'priorTqqqRoc20')??state.priorTqqqRoc20??undefined,
      qqqRoc5:required(exit,'qqqRoc5'),qqqRoc20:required(exit,'qqqRoc20'),sma20SlopePct:n(exit,'sma20SlopePct')};
    const coverage=entry.route==='normal_coverage'||entry.route==='pre_crisis_coverage';
    const slow=isCallCreditSpreadSlowTrend({...common,vixMax:p.csSlowTrendVixMax});
    const fast=isCallCreditSpreadFastAcceleration({...common,roc5Min:p.csSlowTrendFastAccelerationRoc5,
      slopeMinPct:p.csSlowTrendFastAccelerationSlopePct});
    const heldThreshold=resolveCallCreditSpreadDaysHeldRiskThreshold({mode:p.csResearchDaysHeldExitMode,
      openDate:String(position.openDate),asOfDate:snapshot.asOf,minDays:p.csResearchDaysHeldExitMin,
      maxDays:p.csResearchDaysHeldExitMax,riskThreshold:p.csResearchDaysHeldRiskThreshold,regime});
    const threshold=coverage?entry.deltaStopThreshold:resolveCallCreditSpreadDeltaStopThreshold({...common,
      mode:p.csDeltaStopMode,fixedThreshold:p.csDeltaStopThreshold,wideThreshold:p.csDeltaStopWideThreshold,
      wideRegime:p.csDeltaStopWideRegime,wideTqqqRoc20Min:p.csDeltaStopWideTqqqRoc20Min,
      calmVix:p.csDeltaStopCalmVix,riskVix:p.csDeltaStopRiskVix,calmRoc20:p.csDeltaStopCalmRoc20,
      calmThreshold:p.csDeltaStopCalmThreshold,riskThreshold:heldThreshold??p.csDeltaStopRiskThreshold,
      riskGuardMode:p.csResearchRiskGuardMode,riskGuardVixChange5d:f.vxnChange,
      riskGuardThreshold:heldThreshold??p.csResearchRiskGuardThreshold,slowTrendExitMode:p.csSlowTrendExitMode,
      slowTrendVixMax:p.csSlowTrendVixMax,slowTrendThreshold:p.csSlowTrendDeltaStopThreshold,
      slowTrendHysteresis:p.csSlowTrendDeltaStopHysteresis,fastAcceleration:fast});
    const delta=required(position,'shortCallDelta'),previousCloseDelta=n(position,'previousCloseDelta');
    const triggered=shouldTriggerCallCreditSpreadDeltaStop({slowTrend:!coverage&&slow,fastAcceleration:!coverage&&fast,
      immediateDeltaStop:coverage,mode:coverage?'off':p.csSlowTrendExitMode,intradayDelta:delta,
      closeDelta:delta,previousCloseDelta,threshold});
    const rescue=!coverage&&triggered&&daysLeft>=p.csResearchDeltaStopRescueMinDaysLeft
      &&(f.vxnChange??0)<0&&(common.tqqqRoc20??0)<0;
    const reason=evaluateCallCreditSpreadExit({expiry:String(position.expiry),creditReceived:required(position,'creditReceived'),
      asOfDate:snapshot.asOf,regime,daysLeft,shortCallDelta:delta,highPrice:required(exit,'highPrice'),
      unrealizedPnl:required(position,'markPnl'),profitTakeEnabled:p.csProfitTakeEnabled,profitTarget:entry.profitTarget,
      profitTakeMode:coverage?'fixed':p.csProfitTakeMode,conditionalProfitTakeMaxDte:coverage?undefined:p.csConditionalProfitTakeMaxDte,
      vix:pricingVol,vix3m:pricingVol3m,deltaStopThreshold:triggered&&!rescue?threshold:Infinity,
      isSlowTrend:!coverage&&slow,slowTrendProfitTarget:coverage?undefined:p.csSlowTrendProfitTarget});
    if(reason){const key=`ccs-close:${id}:${snapshot.asOf}`;intents.push({kind:'close-position',key,positionId:id,reason});
      state.owned[id]={...entry,exitScheduled:true};state.closing[key]=id;}
  }
  return intents;
}

function feedbackState(state:State,feedback:Readonly<StrategyFeedback>):State{
  const s=structuredClone(state),payload=feedback.payload;
  if(payload.sourceAccount!==undefined&&payload.sourceAccount!=='portfolio')throw Error('Foreign CCS feedback source');
  if(feedback.kind==='reject'){
    const key=String(payload.key);delete s.pending[key];const id=s.closing[key];
    if(id&&s.owned[id])s.owned[id]={...s.owned[id]!,exitScheduled:false};delete s.closing[key];return s;
  }
  const id=String(payload.positionId);
  if(feedback.kind==='fill'){
    const pending=s.pending[id];if(!pending)throw Error('Unowned CCS fill feedback');
    delete s.pending[id];s.owned[id]=pending;
    if(pending.route!=='normal_coverage'&&pending.route!=='pre_crisis_coverage'){
      s.cooldownRemaining=pending.nextCooldown;
      // Native cap is updated/cleared on a successful PRIMARY fill, not expired on every bar.
      s.eventRisk=pending.eventScoped?{entriesInWindow:(s.eventRisk&&pending.signalIndex-s.eventRisk.lastSignalIndex<=p.csPreCrisisWindowTradingDays
        ?s.eventRisk.entriesInWindow:0)+1,lastSignalIndex:pending.signalIndex}:null;
    }
    return s;
  }
  const entry=s.owned[id];if(!entry)throw Error('Unowned CCS close feedback');
  const pnl=settledFeedbackPnl(feedback,'Missing CCS pnl')!;
  if(entry.route!=='normal_coverage'&&entry.route!=='pre_crisis_coverage'&&pnl<=0)s.cooldownRemaining=p.csWr89CooldownOpportunities;
  delete s.owned[id];for(const [key,value] of Object.entries(s.closing))if(value===id)delete s.closing[key];return s;
}

export const ccsC3E856StandaloneV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'CCS.C3.E856',version:'ccs-c3-e856-current-bar-v1-causal-execution',researchOnly:true,
    migration:{complete:true,missing:[]}},params:defaults,
  initialize(params){assertFixedStrategyParams(params,defaults);return {barIndex:-1,lastAsOf:null,weakPersistenceDays:0,
    cooldownRemaining:0,eventRisk:null,pending:{},owned:{},closing:{},priorTqqqRoc20:null};},
  onFeedback({state,params,feedback}){assertFixedStrategyParams(params,defaults);
    return feedbackState(state as unknown as State,feedback) as unknown as StrategyJson;},
  planObservations({params,nativeState}){
    assertFixedStrategyParams(params,defaults);if(nativeState.available===false)return null;
    const f=ccsCurrentFacts(nativeState),nav=required(obj(nativeState.stockAccount,'stock account'),'netLiquidation');
    return {kind:'call',plans:[{id:'main',widths:[...new Set([f.width,...candidateWidthsForCsSurvivalSelection(p.csSurvivalSelectionWidthMode,f.width),transitionContract.widthPct,p.csSurvivalFallbackWidthPct])],
      shortDeltas:[...new Set([f.shortDelta,...candidateShortDeltasForCsSurvivalSelection(f.shortDelta),p.csSurvivalFallbackShortDelta,transitionContract.shortDelta])],
      sigmas:[],targetDte:p.csTargetDte,nav,riskBudget:p.csMaxTotalRiskNav*f.rescueMultiplier,forceMinimumContract:p.forceMinimumContract,includeTail:true},
    {id:'coverage',widths:[p.csSecondaryCoverageWidthPct,p.csSecondaryCoveragePreCrisisWidthPct],shortDeltas:[...new Set([p.csSecondaryCoverageShortDelta,p.csSecondaryCoveragePreCrisisShortDelta])],
      sigmas:[],targetDte:p.csSecondaryCoverageTargetDte,nav,riskBudget:p.csSecondaryRiskBudgetNav,forceMinimumContract:true,includeTail:false}]};
  },
  onBar({state,params,snapshot}){
    assertFixedStrategyParams(params,defaults);const s=structuredClone(state as unknown as State);
    if(s.lastAsOf!==null&&snapshot.asOf<=s.lastAsOf)throw Error('CCS must advance chronologically');
    s.barIndex++;s.lastAsOf=snapshot.asOf;
    const native=obj(snapshot.market.nativeState,'native observation');
    const trace=createAdmissionTrace(['上游数据','策略准入','候选合约','冷却控制','WR90 风控']);
    const none=(reason:string,intents:StrategyIntent[]=[])=>({state:s as unknown as StrategyJson,intents,plots:{reason,gates:trace.gates}});
    // Native updates this QQQ-only streak before checking leveraged availability.
    const exit=snapshot.market.callExit as StrategyObject|undefined;
    if(exit)s.weakPersistenceDays=(n(exit,'qqqRoc20')??0)<0&&(n(exit,'sma20SlopePct')??0)<0?s.weakPersistenceDays+1:0;
    if(native.available===false)return none('native-warmup-unavailable');
    const f=ccsCurrentFacts(native);
    if(!exit)throw Error('Missing CCS as-of exit observations');
    const intents=closeIntents(s,snapshot,native,f);s.priorTqqqRoc20=f.tqqqRoc20;
    const upstreamBlocked=Object.values(obj(native.upstreamStatuses,'upstream statuses')).some(status=>status==='BLOCK'||status==='ERROR');
    trace.check(0,!upstreamBlocked,'上游观测与数据质量检查');
    if(upstreamBlocked)return none('upstream-block',intents);
    const admission=ccsC3E856Admission(f,s.weakPersistenceDays,s.eventRisk?.entriesInWindow??0);
    trace.check(1,admission.primary||admission.preCoverage||admission.normalCoverage,`primary=${admission.primary}; preCoverage=${admission.preCoverage}; normalCoverage=${admission.normalCoverage}; mdd=${admission.mdd}; capBlocked=${admission.capBlocked}`);
    if(!admission.primary&&!admission.preCoverage&&!admission.normalCoverage)return none('current-bar-gates',intents);
    const analytics=obj(snapshot.market.pcsAnalytics,'call analytics');if(analytics.kind!=='call')throw Error('CCS requires call analytics');
    const selected=selectContract(f,admission,analytics);
    trace.check(2,!!selected,selected?selected.route:'no-contract');
    if(!selected)return none('no-contract',intents);
    const primary=selected.route==='primary'||selected.route==='conservative_fallback',quote=selected.quote;
    const context={regime:f.regime,slowSubregime:f.slowSubregime,credit:quote.credit*100,
      vix:required(exit,'pricingVol'),realisedVol20d:n(f.c,'tqqqRealisedVol20d'),termSlope:n(f.c,'vixTermStructureSlope')};
    const wr90=primary&&isWr90ConditionalBlock(context,{creditMax:p.csTransitionConditionalCreditMax,
      rvMin:p.csTransitionConditionalRvMin,rvMax:p.csTransitionConditionalRvMax,
      termSlopeMax:p.csTransitionConditionalTermSlopeMax,termSlopeReleaseRegime:p.csTransitionConditionalTermSlopeReleaseRegime});
    const wr89=primary?evaluateWr89Entry({wr89CooldownRemaining:s.cooldownRemaining} as Parameters<typeof evaluateWr89Entry>[0],
      context,true,p.csWr89CooldownRescueMode):null;
    trace.check(3,!wr89||wr89.allowed,wr89?.reason??(primary?'冷却控制通过':'覆盖路径不要求主路径冷却闸'));
    if(wr89&&!wr89.allowed){s.cooldownRemaining=wr89.state?.wr89CooldownRemaining??s.cooldownRemaining;return none(wr89.reason??'wr89-block',intents);}
    trace.check(4,!wr90,wr90?'wr90-signal-block':'WR90 信号风控通过');
    if(wr90)return none('wr90-signal-block',intents);
    const key=`ccs-c3-e856:${snapshot.asOf}`;
    s.pending[key]={route:selected.route,signalIndex:s.barIndex,eventScoped:admission.eventScoped,
      nextCooldown:wr89?.state?.wr89CooldownRemaining??s.cooldownRemaining,profitTarget:selected.profitTarget,
      deltaStopThreshold:selected.deltaStopThreshold,exitScheduled:false};
    const minimumCredit=isWr90ConditionalBlock({...context,credit:0},{creditMax:p.csTransitionConditionalCreditMax,
      rvMin:p.csTransitionConditionalRvMin,rvMax:p.csTransitionConditionalRvMax,
      termSlopeMax:p.csTransitionConditionalTermSlopeMax,termSlopeReleaseRegime:p.csTransitionConditionalTermSlopeReleaseRegime});
    intents.push({kind:'open-spread',key,contract:{symbol:'QQQ',type:'call',expiry:quote.expiry,
      shortStrike:quote.shortStrike,longStrike:quote.longStrike,targetDte:selected.targetDte},
    risk:{multiplier:1,quantity:primary?f.rescueMultiplier:1,ratioMin:0,ratioMax:Number.MAX_VALUE,
      entrySource:primary?'ccs-primary':selected.route==='normal_coverage'?'ccs-coverage-normal':'ccs-coverage-pre-crisis',
      ...(minimumCredit?{minFillCreditPerContract:p.csTransitionConditionalCreditMax}:{})}});
    return none(selected.route,intents);
  },
};
