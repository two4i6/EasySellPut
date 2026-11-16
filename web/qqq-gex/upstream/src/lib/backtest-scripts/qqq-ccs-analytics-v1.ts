/** As-of call-spread pricing/statistics only; geometry and winning selection belong to strategy. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import {CallStrikeSurvivalAsOf} from '../engines/analysis/SellerStatsEngine';
import {buildCallCreditSpreadOpen,createCallCreditSpreadPreparation} from './call-spread-kernel-v1';
import type {CsSurvivalSelectionCandidate} from '../engines/leveraged-overlay/v2/strategies/cs-survival-selector';
import {createMarketDataModule,type MarketDataModule} from './market-data-v7';
import {assertStrategyData,type StrategyObject} from './strategy-module-v2';

export type CcsObservationPlan={kind:'call';widths:readonly number[];shortDeltas:readonly number[];sigmas:readonly number[];
  targetDte:number;nav:number;riskBudget:number;forceMinimumContract:boolean;includeTail:boolean;
  /** Original fixed-delta label for sigma probes, not the option's measured delta. */
  sigmaShortDelta?:number};
export type CcsObservationBatch={kind:'call';plans:readonly (Omit<CcsObservationPlan,'kind'>&{id:string})[]};
export type CcsObservationRequest=CcsObservationPlan|CcsObservationBatch;
export type CcsContractProbe=Pick<CsSurvivalSelectionCandidate,'shortDelta'|'widthPct'|'shortStrike'|'longStrike'|'credit'|'maxLoss'>
  &{expiry:string;quantity:number;sigma?:number};
export type CcsAnalyticalProbe=CsSurvivalSelectionCandidate & {expiry:string;quantity:number;sigma?:number;
  tailRisePct?:CsSurvivalSelectionCandidate['tailLoss']};

export function validateCcsObservationPlan(value:StrategyObject):CcsObservationPlan{
  assertStrategyData(value);const p=value as unknown as CcsObservationPlan;
  const bounded=(values:readonly number[],max:number)=>Array.isArray(values)&&values.length<=16
    &&values.every(n=>Number.isFinite(n)&&n>0&&n<max);
  if(Object.keys(value).some(k=>!['kind','widths','shortDeltas','sigmas','targetDte','nav','riskBudget',
    'forceMinimumContract','includeTail','sigmaShortDelta'].includes(k))||p.kind!=='call'
    ||!bounded(p.widths,1)||!p.widths.length||!bounded(p.shortDeltas,1)||!bounded(p.sigmas,10)
    ||p.shortDeltas.length+p.sigmas.length===0||p.widths.length*(p.shortDeltas.length+p.sigmas.length)>256
    ||(p.sigmas.length>0&&!(Number.isFinite(p.sigmaShortDelta)&&p.sigmaShortDelta!>0&&p.sigmaShortDelta!<1))
    ||(p.sigmaShortDelta!==undefined&&!(Number.isFinite(p.sigmaShortDelta)&&p.sigmaShortDelta>0&&p.sigmaShortDelta<1))
    ||!Number.isInteger(p.targetDte)||p.targetDte<1||p.targetDte>365||!Number.isFinite(p.nav)||p.nav<=0
    ||!Number.isFinite(p.riskBudget)||p.riskBudget<=0||p.riskBudget>1
    ||typeof p.forceMinimumContract!=='boolean'||typeof p.includeTail!=='boolean')throw Error('Invalid/beyond-budget CCS observation plan');
  return p;
}

export function validateCcsObservationRequest(value:StrategyObject):CcsObservationRequest{
  if(!('plans' in value))return validateCcsObservationPlan(value);
  assertStrategyData(value);
  const batch=value as unknown as CcsObservationBatch;
  if(batch.kind!=='call'||Object.keys(value).some(k=>!['kind','plans'].includes(k))
    ||!Array.isArray(batch.plans)||batch.plans.length<1||batch.plans.length>8)throw Error('Invalid CCS observation batch');
  const ids=new Set<string>();let probes=0;
  for(const {id,...plan} of batch.plans){
    if(typeof id!=='string'||!(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/).test(id)||ids.has(id)
      ||['constructor','prototype','__proto__'].includes(id))throw Error('Invalid/duplicate CCS plan id');
    ids.add(id);validateCcsObservationPlan({kind:'call',...plan});
    probes+=plan.widths.length*(plan.shortDeltas.length+plan.sigmas.length);
  }
  if(probes>256)throw Error('Beyond-budget CCS observation batch');
  return batch;
}

export function createQqqCcsAnalytics(data:MarketDataSet,market:MarketDataModule=createMarketDataModule(data),targetDtes?:readonly number[]){
  market.assertData(data);
  if(targetDtes&&(!targetDtes.length||targetDtes.some(d=>!Number.isInteger(d)||d<1||d>75)))throw Error('Invalid call analytical capability');
  const allowedDtes=targetDtes?new Set(targetDtes):undefined;
  const statistics=new CallStrikeSurvivalAsOf(data.qqqBars,{resultCache:'current-bar'});
  const observePlan=(asOf:string,chain:OptionChain,requests:CcsObservationPlan)=>{
      const preparation=createCallCreditSpreadPreparation({chain,date:asOf,targetDte:requests.targetDte});
      const annualizedQqqRv20=market.annualizedQqqRv20(asOf),dailySigma20=annualizedQqqRv20/Math.sqrt(252);
      const candidates:CcsAnalyticalProbe[]=[];
      const quotes:CcsContractProbe[]=[];
      const append=(shortDelta:number,sigma?:number)=>{
        for(const widthPct of requests.widths){
          const open=buildCallCreditSpreadOpen({chain,date:asOf,underlying:'QQQ',targetDte:requests.targetDte,
            widthPct,nav:requests.nav,riskBudget:requests.riskBudget,shortDelta,forceMinimumContract:requests.forceMinimumContract,
            ...(sigma===undefined?{}:{shortStrikeSigma:sigma,dailySigma20})},preparation).open;
          if(!open||open.credit===undefined)continue;
          const {shortStrike,longStrike,expiry,credit,maxLoss,quantity}=open;
          if(![shortStrike,longStrike,credit,maxLoss].every(Number.isFinite)||maxLoss<=0||!Number.isSafeInteger(quantity)||quantity<1)
            throw Error('Invalid CCS analytical contract economics');
          const quote={shortDelta,widthPct,shortStrike,longStrike,expiry,credit,maxLoss,quantity,...(sigma===undefined?{}:{sigma})};
          quotes.push(quote);
          const horizon=market.weekdayHorizon(asOf,expiry);
          const survival=statistics.compute(asOf,chain.spot,shortStrike,dailySigma20,horizon);
          if(!survival)continue;
          // CS's effective selector uses requested width, not rounded listed-strike width.
          const tail=requests.includeTail?statistics.computeTail(asOf,chain.spot,shortStrike,dailySigma20,horizon,widthPct,credit,maxLoss):null;
          candidates.push({...quote,distanceSigma:(shortStrike-chain.spot)/chain.spot/dailySigma20,survival:survival.noTouch,
            ...(tail?{tailLoss:tail.conditionalLoss,tailLossP75:tail.conditionalLossP75,
              tailLossCvar75:tail.conditionalLossCvar75,tailRisePct:tail.conditionalRisePct}:{})});
        }
      };
      for(const delta of requests.shortDeltas)append(delta);
      if(dailySigma20>0)for(const sigma of requests.sigmas)append(requests.sigmaShortDelta!,sigma);
      return {kind:'call' as const,annualizedQqqRv20,quotes,candidates};
  };
  return {
    volatilityAt:market.annualizedQqqRv20,
    observe(asOf:string,chain:OptionChain,requests:CcsObservationRequest){
      validateCcsObservationRequest(requests as unknown as StrategyObject);
      if(allowedDtes&&('plans' in requests?requests.plans:[requests]).some(p=>!allowedDtes.has(p.targetDte)))
        throw Error('Call analytical DTE is not configured for execution');
      if(chain.symbol!=='QQQ'||chain.timestamp.split('T')[0]!==asOf||!Number.isFinite(chain.spot)||chain.spot<=0)
        throw Error('CCS analytics requires current as-of QQQ chain');
      if(!('plans' in requests))return observePlan(asOf,chain,requests);
      return {kind:'call' as const,annualizedQqqRv20:market.annualizedQqqRv20(asOf),
        plans:Object.fromEntries(requests.plans.map(({id,...plan})=>{
          const {quotes,candidates}=observePlan(asOf,chain,{kind:'call',...plan});return [id,{quotes,candidates}];
        }))};
    },
  };
}
