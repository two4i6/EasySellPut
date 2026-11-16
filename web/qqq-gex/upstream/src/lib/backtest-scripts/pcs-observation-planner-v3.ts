/** One immutable planning seam for single-account and isolated-source adapters. */
import {createHash} from 'node:crypto';
import {assertBarStrategyModule,freezeStrategyData,type BarStrategyModule,type StrategyObject} from './strategy-module-v2';
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import type {createQqqPcsAnalytics,PcsObservationRequest} from './qqq-pcs-analytics-v2';
import type {createQqqCcsAnalytics,CcsObservationRequest} from './qqq-ccs-analytics-v1';
import type {MarketDataModule} from './market-data-v7';
export {validatePcsObservationPlan} from './qqq-pcs-analytics-v2';
export function createPcsObservationPlanner(market:Pick<MarketDataModule,'annualizedQqqRv20'>,module:BarStrategyModule,
  factories:{put:()=>ReturnType<typeof createQqqPcsAnalytics>;call?:()=>ReturnType<typeof createQqqCcsAnalytics>},overrides?:StrategyObject){
  assertBarStrategyModule(module);const params=freezeStrategyData({...module.params,...overrides});
  let calls:ReturnType<typeof createQqqCcsAnalytics>|undefined;
  let puts:ReturnType<typeof createQqqPcsAnalytics>|undefined;
  return {identity:`pcs-asof-planner-v3:${module.manifest.id}:${module.manifest.version}:${createHash('sha256').update(JSON.stringify(params)).digest('hex')}`,
    observe(input:{asOf:string;nativeState:StrategyObject;chain:OptionChain;sourceId?:string;account?:StrategyObject}){
      if(input.nativeState.available===false||!module.planObservations)return null;
      const {chain,...facts}=input;
      const plan=module.planObservations(freezeStrategyData({...facts,params,annualizedQqqRv20:market.annualizedQqqRv20(input.asOf)}));
      if(plan?.kind==='call'){
        if(!factories.call)throw Error('Call analytical planning is not configured');
        calls??=factories.call();return calls.observe(input.asOf,chain,plan as unknown as CcsObservationRequest) as unknown as StrategyObject;
      }
      if(plan===null)return null;
      puts??=factories.put();return puts.observe(input.asOf,chain,plan as unknown as PcsObservationRequest) as unknown as StrategyObject;
    }};
}
