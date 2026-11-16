/** Run-local market computation only. Never owns admission, positions or feedback. */
import {buildMockOptionChain,listedExpiries,strikesFor,QQQ_EXPIRY_CALENDAR_VERSION} from '../engines/leveraged-overlay/backtest/mockOptions';
import {createMarketPrecompute} from '../engines/leveraged-overlay/v2/backtest/native-market-coordinates-v2';
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {ResolvedBacktestRunSpec} from '../engines/leveraged-overlay/v2/backtest/run-spec';
import type {OptionPricing} from '../engines/leveraged-overlay/v2/options';
import {sealStrategyData,freezeObservationData} from './strategy-module-v2';
import {createMarketDataModule} from './market-data-v7';

export type DecisionContractRequests = NonNullable<Parameters<typeof buildMockOptionChain>[6]>['decisionContracts'];
/** SDK put-chain capability, not a strategy's chosen DTE. */
export const QQQ_PUT_TARGET_DTES:readonly number[]=Object.freeze([28,35]);

export function createQqqMarketContext(data:MarketDataSet,cacheChains=true){
  let volatilityHistory:{asOf:string;values:number[]}|undefined;
  let currentDate:string|undefined,chainBuilds=0,chainHits=0;
  const chains=new Map<string,ReturnType<typeof buildMockOptionChain>>();
  const indicators=new Map<string,ReturnType<typeof createMarketPrecompute>>();
  let executionDate:string|undefined,executionBuilds=0,executionHits=0;
  const executionChains=new Map<string,ReturnType<typeof buildMockOptionChain>>();
  let gridDate:string|undefined;
  const executionGrids=new Map<string,Readonly<{expiries:readonly string[];strikes:readonly number[];hasStrike:(strike:number)=>boolean}>>();
  return {
    data:createMarketDataModule(data),
    assertData(actual:MarketDataSet){if(actual!==data)throw Error('Market context belongs to another data instance');},
    volatilityHistory(asOf:string,values:readonly number[]){
      // Compare actual as-of values, never assume that different observers share coordinates.
      if(volatilityHistory?.asOf===asOf&&volatilityHistory.values.length===values.length
        &&values.every((value,i)=>Object.is(value,volatilityHistory!.values[i])))return volatilityHistory.values;
      const frozen=freezeObservationData(values) as number[];
      volatilityHistory={asOf,values:frozen};return frozen;
    },
    executionGrid(role:'next-open'|'terminal-close',quoteAsOf:string,asOf:string,spot:number,realStrikeGrid:boolean,maximumDte:75|365=75){
      if(![75,365].includes(maximumDte))throw Error('Invalid execution expiry horizon');
      if(gridDate!==asOf){executionGrids.clear();gridDate=asOf;}
      const key=JSON.stringify([QQQ_EXPIRY_CALENDAR_VERSION,role,quoteAsOf,asOf,spot,realStrikeGrid,...(maximumDte===75?[]:[maximumDte])]);
      const cached=cacheChains?executionGrids.get(key):undefined;if(cached)return cached;
      const expiries=Object.freeze(listedExpiries(asOf,maximumDte,'QQQ')),listed=new Set(strikesFor('QQQ',spot,realStrikeGrid));
      const value=Object.freeze({expiries,strikes:Object.freeze([...listed]),hasStrike:(strike:number)=>listed.has(strike)});
      if(cacheChains){
        if(executionGrids.size>=16)executionGrids.delete(executionGrids.keys().next().value!);
        executionGrids.set(key,value);
      }
      return value;
    },
    /** Distinct from decision-close chains; all arguments and information time participate. */
    executionChain(role:'next-open'|'terminal-close',quoteAsOf:string,args:Parameters<typeof buildMockOptionChain>){
      if(!cacheChains){executionBuilds++;return sealStrategyData(buildMockOptionChain(...args));}
      if(executionDate!==args[0]){executionChains.clear();executionDate=args[0];}
      const key=JSON.stringify([QQQ_EXPIRY_CALENDAR_VERSION,role,quoteAsOf,args]);
      const cached=executionChains.get(key);if(cached){executionHits++;return cached;}
      const value=sealStrategyData(buildMockOptionChain(...args));
      if(executionChains.size>=128)executionChains.delete(executionChains.keys().next().value!);
      executionChains.set(key,value);executionBuilds++;return value;
    },
    decisionChain(asOf:string,spot:number,pricingVol:number,pricingVol3m:number|undefined,
      pricing:OptionPricing,realStrikeGrid:boolean,liquidityModel:boolean,decisionContracts?:DecisionContractRequests,maximumDte:75|365=75){
      if(![75,365].includes(maximumDte))throw Error('Invalid decision expiry horizon');
      if(decisionContracts!==undefined&&(!Array.isArray(decisionContracts)||!decisionContracts.length||decisionContracts.length>16
        ||decisionContracts.some(r=>!r||!Number.isInteger(r.targetDte)||r.targetDte<1||r.targetDte>maximumDte
          ||!Array.isArray(r.types)||!r.types.length||r.types.some((t:unknown)=>t!=='put'&&t!=='call'))))throw Error('Invalid decision contract requests');
      // Only retain this bar: no all-history chain tape or cross-run cache.
      if(currentDate!==asOf){chains.clear();currentDate=asOf;}
      const key=JSON.stringify([QQQ_EXPIRY_CALENDAR_VERSION,asOf,spot,pricingVol,pricingVol3m,
        pricing.spreadMultiplier,pricing.skewSlope,pricing.riskFreeRate,realStrikeGrid,liquidityModel,
        ...(decisionContracts===undefined?[]:[decisionContracts]),...(maximumDte===75?[]:[maximumDte])]);
      const cached=cacheChains?chains.get(key):undefined;if(cached){chainHits++;return cached;}
      const chain=sealStrategyData(buildMockOptionChain(asOf,spot,pricingVol,'QQQ',pricing.spreadMultiplier,pricing.skewSlope,{
        vix3m:pricingVol3m,riskFreeRate:pricing.riskFreeRate,expiryCalendar:true,realStrikeGrid,liquidityModel,...(maximumDte===75?{}:{expiryHorizonDays:maximumDte}),
        decisionContracts:decisionContracts??QQQ_PUT_TARGET_DTES.map(targetDte=>({targetDte,types:['put'] as const})),
      }));
      // Bound differing model variants too. Eviction changes work, never quotes.
      if(cacheChains){
        if(chains.size>=16)chains.delete(chains.keys().next().value!);
        chains.set(key,chain);
      }
      chainBuilds++;return chain;
    },
    nativePrecompute(spec:ResolvedBacktestRunSpec){
      const key=JSON.stringify([spec.universeId,spec.signalSymbol??null]);
      let value=indicators.get(key);
      if(!value){value=createMarketPrecompute(spec,data);indicators.set(key,value);}
      return value;
    },
    stats:()=>({chainBuilds,chainHits,retainedChains:chains.size,indicatorCoordinateSets:indicators.size,
      executionBuilds,executionHits,retainedExecutionChains:executionChains.size}),
  };
}
export type QqqMarketContext=ReturnType<typeof createQqqMarketContext>;
