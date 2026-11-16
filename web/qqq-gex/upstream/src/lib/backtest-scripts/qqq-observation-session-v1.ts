/** Run-local observation lifecycle shared by single and isolated source books.
 * Native streams may be pooled by complete specification; execution accounts never are.
 */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {ResolvedBacktestRunSpec} from '../engines/leveraged-overlay/v2/backtest/run-spec';
import type {QqqMarketContext} from './qqq-market-context-v5';
import type {BarStrategyModule,StrategyObject} from './strategy-module-v2';
import {createQqqNativeObservation} from './qqq-native-observation-v2';
import {createQqqPcsAnalytics} from './qqq-pcs-analytics-v2';
import {createQqqCcsAnalytics} from './qqq-ccs-analytics-v1';
import {createPcsObservationPlanner} from './pcs-observation-planner-v3';
import {createMarketDataModule} from './market-data-v7';
import type {QqqSpreadAdapterConfig} from './qqq-spread-adapter-v2';

export function createQqqObservationSession(data:MarketDataSet,
  specs:Readonly<Record<string,ResolvedBacktestRunSpec>>,market?:QqqMarketContext,
  policy?:{module:BarStrategyModule;params?:StrategyObject;executionConfig?:Pick<QqqSpreadAdapterConfig,'callCreditSpread'>}){
  const marketData=market?.data??createMarketDataModule(data);
  const call=policy?.executionConfig?.callCreditSpread;
  const planner=policy?createPcsObservationPlanner(marketData,policy.module,{
    put:()=>createQqqPcsAnalytics(data,marketData),
    ...(call?{call:()=>createQqqCcsAnalytics(data,marketData,call.targetDtes)}:{}),
  },policy.params):null;
  const pool=new Map<string,ReturnType<typeof createQqqNativeObservation>>();
  const observers=new Map<string,ReturnType<typeof createQqqNativeObservation>>();
  let closed=false;
  const close=()=>{closed=true;for(const observer of pool.values())observer.close();};
  try{
    for(const [id,spec] of Object.entries(specs)){
      const key=JSON.stringify(spec);
      let observer=pool.get(key);
      if(!observer){observer=createQqqNativeObservation(data,spec,market);pool.set(key,observer);}
      observers.set(id,observer);
    }
  }catch(error){close();throw error;}
  return {
    marketData,
    count:pool.size,
    identity:Object.fromEntries([...observers].map(([id,observer])=>[id,{version:observer.version,specHash:observer.specHash}])),
    plannerIdentity:planner?.identity,
    close,
    advanceTo(asOf:string,unavailableReason?:string){
      if(closed)throw Error('Observation session is closed');
      const advanced=new Map<ReturnType<typeof createQqqNativeObservation>,StrategyObject>();
      const states=new Map<string,StrategyObject>();
      try{
        for(const [id,observer] of observers){
          let state=advanced.get(observer);
          if(!state){
            state=observer.availableOn(asOf)?observer.advanceTo(asOf):{asOf,available:false,
              ...(unavailableReason===undefined?{}:{reason:unavailableReason})};
            advanced.set(observer,state);
          }
          states.set(id,state);
        }
        return states;
      }catch(error){close();throw error;}
    },
    // Called only after execution has applied fills/settlements. Account ownership
    // and whether absent analytics is emitted remain the adapter's output contract.
    observe(input:Parameters<NonNullable<typeof planner>['observe']>[0]){
      if(closed)throw Error('Observation session is closed');
      return planner?.observe(input)??null;
    },
  };
}
