/** Complete causal E226 policy. No fixtures, accounts, transport, future chains or replay delegation. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyObject,type StrategyIntent} from '../strategy-module-v2';
import type {OptionChain} from '../../engines/leveraged-overlay/types/input';
import type {PcsAnalyticalProbe} from '../qqq-pcs-analytics-v2';
import {resolveVolatilityCoordinates} from '../market-coordinates-v3';
import {projectNativeMarketFacts} from '../native-market-facts-v7';
import {settledFeedbackPnl} from '../settlement-observations-v3';
import {stressOnlyPcsSelectionProfile} from '../pcs-selection-v6';
import {isPcsV12GateBlocked} from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import {isCallCreditSpreadPreCrisis} from '../put-spread-kernel-v6';
import {R9_MAIN_PCS_CONTRACT,r9MainPcsStress,selectR9MainPcs} from './r9-e226-main-pcs-v3';
import {R9_E226_SOURCE_CONTRACT} from './r9-e226-source-contract-v1';
import {createAdmissionTrace} from '../strategy-admission-v1';
import {R9_E226_PARAMS,R9_E226_LINEAGE,r9E226SourceAdmission,r9E226LowRvBlocked,
  buildR9E226CurrentBarContract,r9E226ProposalPriority,r9E226FillRetryPolicy,type R9E226Market} from './r9-e226-policy-v5';

export const R9_E226_STANDALONE_DEFAULTS:StrategyObject=freezeStrategyData({...R9_E226_PARAMS,
  lineage:{...R9_E226_LINEAGE},mainPcs:{...R9_MAIN_PCS_CONTRACT},positionMode:'independent-one-contract',
  exitMode:'hold-to-expiry',sourceNav:'native-stock-only',sampleExecution:'adapter-owned',
  // Signal-policy schema, not the separately declared delta-parent-chain-v2 execution capability.
  fillRetryVersion:'delta-parent-preserving-v1'});
const n=(o:Readonly<StrategyObject>,key:string)=>typeof o[key]==='number'?Number(o[key]):undefined;
const object=(value:unknown,label:string):StrategyObject=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Missing R9 ${label}`);
  return value as StrategyObject;
};
/** The native independent PCS/Rescue books never credit option profits to stock NAV. */
export function r9NativeStockNav(native:Readonly<StrategyObject>){
  const nav=Number(object(native.stockAccount,'stock account').netLiquidation);
  if(!Number.isFinite(nav)||nav<=0)throw new Error('Invalid R9 current stock NAV');return nav;
}
export function r9CurrentCoordinates(native:Readonly<StrategyObject>,includeAdmission=true){
  const c=object(native.marketContext,'current context'),macro=object(native.macro,'macro');
  if(typeof c.regime!=='string')throw new Error('Missing R9 regime');
  const coordinates=resolveVolatilityCoordinates(macro,{positiveVixRequired:true,rawTermFallback:true});
  const primary=coordinates.primaryVol,term=coordinates.primaryVol3m,change=coordinates.primaryChange5d;
  const facts=projectNativeMarketFacts(c,n);
  const market:R9E226Market={regime:c.regime,slowSubregime:typeof c.slowSubregime==='string'?c.slowSubregime:undefined,
    vix:facts.vix??primary,vix3m:term,primaryTermSlope:primary!==undefined&&term!==undefined?term-primary:undefined,
    rv20:facts.tqqqRealisedVol20d,adx14:facts.adx14,trendScore:facts.trendScore,sma200Pct:facts.priceVsSma200Pct,
    priceExtensionAtr:facts.priceExtensionAtr,regimePriceExtensionAtr:facts.priceExtensionAtr,
    range20dPct:facts.range20dPct,roc5:facts.roc5,roc20:facts.roc20,er20:facts.qqqEr20,rsi14:facts.rsi14,
    weakeningCount:facts.weakeningSignalCount,ma50SlopePct:facts.ma50SlopePct,
    drawdownFromRecentHighPct:facts.drawdownFromRecentHighPct,vixChange5d:change,regimeVixChange5d:facts.vixChange5d};
  if(includeAdmission){market.versionPressure=isPcsV12GateBlocked({enabled:true,v11ReleaseMode:'rv20_lt_067_or_sr02_adx20',
    regime:market.regime,slowSubregime:market.slowSubregime,vix:market.vix,adx14:market.adx14,
    tqqqRealisedVol20d:market.rv20,priceVsSma200Pct:market.sma200Pct,range20dPct:market.range20dPct,
    priceExtensionAtr:market.priceExtensionAtr,roc5:market.roc5,roc20:market.roc20,rsi14:market.rsi14,
    weakeningSignalCount:market.weakeningCount,drawdownFromRecentHighPct:market.drawdownFromRecentHighPct});
  market.preCrisisActive=isCallCreditSpreadPreCrisis({regime:market.regime,vix:primary,
    tqqqRealisedVol20d:market.rv20,tqqqRoc20:facts.tqqqRoc20});}
  return {market,primaryVol:primary,primaryVol3m:term};
}
const contract=(expiry:string,shortStrike:number,longStrike:number,targetDte:number):StrategyObject=>({symbol:'QQQ',type:'put',
  expiry,shortStrike,longStrike,targetDte});
export const r9E226StandaloneV4:BarStrategyModule={
  // State schema is the empty object; version pins this layout without changing effective defaults/lineage.
  manifest:{sdkVersion:2,id:'R9.E226',version:'r9-e226-causal-standalone-v4-slim-state',researchOnly:true,
    migration:{complete:true,missing:[]}},params:R9_E226_STANDALONE_DEFAULTS,
  initialize(params){assertFixedStrategyParams(params,R9_E226_STANDALONE_DEFAULTS);
    return {};},
  onFeedback({params,feedback}){
    assertFixedStrategyParams(params,R9_E226_STANDALONE_DEFAULTS);
    const id=String(feedback.payload.sourceAccount);
    if(!['portfolio',R9_E226_SOURCE_CONTRACT.contextSource].includes(id))throw new Error('Unknown R9 feedback source');
    settledFeedbackPnl(feedback);
    return {};
  },
  planObservations({params,nativeState,annualizedQqqRv20,sourceId}){
    assertFixedStrategyParams(params,R9_E226_STANDALONE_DEFAULTS);
    if(sourceId!==R9_E226_SOURCE_CONTRACT.contextSource)return null;
    const coordinates=r9CurrentCoordinates(nativeState,false),p=R9_MAIN_PCS_CONTRACT;
    const stressed=r9MainPcsStress({regime:coordinates.market.regime,...coordinates,annualizedQqqRv20});
    return {widths:[p.widthPct],sigmas:stressOnlyPcsSelectionProfile(stressed).candidateSigmas,targetDte:p.targetDte,
      nav:r9NativeStockNav(nativeState),riskBudget:p.riskBudgetNav,forceMinimumContract:p.forceMinimumContract,includeTail:false};
  },
  onBar({params,snapshot}){
    assertFixedStrategyParams(params,R9_E226_STANDALONE_DEFAULTS);
    const state:StrategyObject={};
    const source=object(object(snapshot.market.sourceAccounts,'source observations')[R9_E226_SOURCE_CONTRACT.contextSource],'PCS source');
    const facts=object(source.market,'source market'),native=object(facts.nativeState,'native observation');
    const trace=createAdmissionTrace(['上游数据','机会池准入','低波动风控','救援合约','同日优先级']);
    const none=(reason:string)=>({state,intents:[],plots:{reason,gates:trace.gates}});
    if(native.available===false)return none('native-warmup-unavailable');
    const upstream=object(native.upstreamStatuses,'upstream statuses');
    trace.check(0,!Object.values(upstream).some(s=>s==='BLOCK'||s==='ERROR'),'上游观测与数据质量检查');
    if(Object.values(upstream).some(s=>s==='BLOCK'||s==='ERROR'))return none('upstream-block');
    const coordinates=r9CurrentCoordinates(native),{market,primaryVol,primaryVol3m}=coordinates,nav=r9NativeStockNav(native);
    // Reactive PCS timing uses raw VIX/VIX3M; VXN-derived term belongs to contract selection.
    const macro=object(native.macro,'macro');
    const admission=r9E226SourceAdmission({market,macroVix:n(macro,'vix'),macroVix3m:n(macro,'vix3m'),
      crisisPhase:String(native.crisisPhase),backwardation:primaryVol!==undefined&&primaryVol3m!==undefined&&primaryVol3m<primaryVol,
      hasOpenCollar:false,collarTriggered:false});
    const analytics=object(facts.pcsAnalytics,'PCS analytics');
    if(!Array.isArray(analytics.candidates))throw new Error('Missing R9 analytical candidates');
    const main=selectR9MainPcs({...coordinates,originalSignal:admission.originalSignal,
      annualizedQqqRv20:Number(analytics.annualizedQqqRv20),candidates:analytics.candidates as unknown as PcsAnalyticalProbe[]});
    const lowRvBlocked=r9E226LowRvBlocked(market);
    const built=admission.sourceActive&&!lowRvBlocked
      ? buildR9E226CurrentBarContract({chain:snapshot.market.chain as unknown as OptionChain,asOf:snapshot.asOf,nav,market}):null;
    const rescue=built?.selected;
    const priority=r9E226ProposalPriority({market,sourceActive:admission.sourceActive,
      mainPcsProposalBuilt:!!main.selected,rescueProposalBuilt:!!rescue});
    trace.check(1,admission.sourceActive,`safety=${admission.safety}; scope=${admission.scope}; complement=${admission.complement}`);
    if(admission.sourceActive){
      trace.check(2,!lowRvBlocked,lowRvBlocked?'低波动风险阻断':'低波动风控通过');
      if(!lowRvBlocked){
        trace.check(3,!!rescue,rescue?'救援候选已构建':'救援候选不可构建');
        if(rescue)trace.check(4,priority.rescue,`main=${priority.main}; rescue=${priority.rescue}; dual=${priority.dual}`);
      }
    }
    const intents:StrategyIntent[]=[];
    const risk=(sourceAccount:string):StrategyObject=>({sourceAccount,multiplier:1,quantity:1,
      ratioMin:0,ratioMax:Number.MAX_VALUE,entrySource:sourceAccount==='portfolio'?'r9-rescue':'r9-main-pcs'});
    if(priority.main&&main.selected)intents.push({kind:'open-spread',key:`r9-main:${snapshot.asOf}`,
      contract:contract(main.selected.expiry,main.selected.shortStrike,main.selected.longStrike,R9_MAIN_PCS_CONTRACT.targetDte),risk:risk(R9_E226_SOURCE_CONTRACT.contextSource)});
    if(priority.rescue&&rescue){
      const {shortStrike:short,longStrike:long,expiry}=rescue;
      if(short===undefined||long===undefined||!expiry)throw new Error('Incomplete R9 rescue contract');
      // Native fill guards use regime VIX change, unlike the VXN-coordinate scope.
      const retry=r9E226FillRetryPolicy({signalMarket:{...market,vixChange5d:market.regimeVixChange5d},
        signalDelta:built!.attempts[0]!.delta,nav});
      intents.push({kind:'open-spread',key:`r9-rescue:${snapshot.asOf}`,contract:contract(expiry,short,long,R9_E226_PARAMS.targetDte),
        risk:{...risk('portfolio'),...(retry?{fillRetry:retry as unknown as StrategyObject}:{})}});
    }
    return {state,intents,plots:{reason:priority.rescue?'rescue-admitted':main.reason,
      sourceActive:admission.sourceActive,lowRvBlocked,...priority,gates:trace.gates}};
  },
};
