/** Explicit research candidate; the original E209 remains the reference. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyJson} from '../strategy-module-v2';
import {E209_PARAMS,e209ExitReason} from './e209-policy-v7';
import {E209_ROUNDED_COEFFICIENTS,e209RoundedRiskMultiplier} from './e209-rounded-policy-v1';
import {initializeE209BarRuntime,feedbackE209BarRuntime,decideE209BarRuntime,type E209BarRuntimeState} from './eb7-e209-bar-runtime-v3';
import {decideE209PrunedSourceGraph} from './eb7-e209-pruned-graph-v1';

export const E209_PRUNED_PARAMS=freezeStrategyData({...E209_PARAMS,...E209_ROUNDED_COEFFICIENTS,parent:'EB7.E209',source:'EB7.E209.PRUNE',
  admissionVersion:'e209-pruned-factored-v2',sizingVersion:'e209-rounded-macro-v1'});
export const eb7E209PrunedV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'EB7.E209.PRUNE',version:'eb7-e209-pruned-rounded-frozen-v2',researchOnly:true,
    migration:{complete:true,missing:[]}},
  params:E209_PRUNED_PARAMS,
  initialize(params){assertFixedStrategyParams(params,E209_PRUNED_PARAMS);return initializeE209BarRuntime() as unknown as StrategyJson;},
  onFeedback({state,params,feedback}){
    assertFixedStrategyParams(params,E209_PRUNED_PARAMS);
    return feedbackE209BarRuntime(state as unknown as E209BarRuntimeState,feedback) as unknown as StrategyJson;
  },
  onBar({state,params,snapshot}){
    assertFixedStrategyParams(params,E209_PRUNED_PARAMS);
    const step=decideE209BarRuntime(state as unknown as E209BarRuntimeState,snapshot,
      {multiplier:e209RoundedRiskMultiplier,exit:e209ExitReason},decideE209PrunedSourceGraph);
    return {...step,state:step.state as unknown as StrategyJson};
  },
};
