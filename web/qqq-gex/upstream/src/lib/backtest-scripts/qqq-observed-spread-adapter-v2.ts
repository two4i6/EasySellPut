/** Single-book composition of the shared observer/planner/execution mechanisms. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import {createQqqSpreadExecutionAdapter} from './qqq-spread-adapter-v2';
import {createQqqNativeObservation} from './qqq-native-observation-v2';
import type {BarStrategyModule,StrategyObject} from './strategy-module-v2';
import type {BarStrategyExecutionAdapter} from './strategy-host-v2';
import {createQqqObservationSession} from './qqq-observation-session-v1';
import {createQqqMarketContext} from './qqq-market-context-v5';
export {validatePcsObservationPlan} from './pcs-observation-planner-v3';
export function createQqqObservedSpreadAdapter(data:MarketDataSet,input:{
  executionConfig:Parameters<typeof createQqqSpreadExecutionAdapter>[1];
  nativeSpec:Parameters<typeof createQqqNativeObservation>[1];module:BarStrategyModule;params?:StrategyObject;shareMarket?:boolean;
}){
  const market=input.shareMarket===false?undefined:createQqqMarketContext(data);
  const execution=createQqqSpreadExecutionAdapter(data,input.executionConfig,market);
  const observations=createQqqObservationSession(data,{portfolio:input.nativeSpec},market,input);
  const observer=observations.identity.portfolio!;
  const adapter:BarStrategyExecutionAdapter={...execution.adapter,
    modelVersion:`${execution.adapter.modelVersion}:${observer.version}:${observer.specHash}:${observations.plannerIdentity}`,
    close:observations.close,
    async advanceTo(asOf){
      try{
        const observed=observations.advanceTo(asOf).get('portfolio')!;
        const value=await execution.adapter.advanceTo(asOf);
        const facts=observations.observe({asOf,nativeState:observed as StrategyObject,account:value.snapshot.account,
          chain:value.snapshot.market.chain as unknown as OptionChain})??{candidates:[],annualizedQqqRv20:0};
        const callExit=input.executionConfig.callCreditSpread
          ?{regime:observed.priorRegime??null,...observations.marketData.callExitFacts(asOf)}:undefined;
        return {...value,snapshot:{...value.snapshot,market:{...value.snapshot.market,nativeState:observed,pcsAnalytics:facts,
          ...(callExit?{callExit}:{})}}};
      }catch(error){observations.close();throw error;}
    }};
  return {...execution,adapter};
}
