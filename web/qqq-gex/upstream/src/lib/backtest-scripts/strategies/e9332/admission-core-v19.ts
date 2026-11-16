/** Native SDK source kernel with explicit current-bar admission; no legacy replay or date lists. */
import{assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyJson}from'../../strategy-module-v2';
import{eb8StandaloneV1}from'../eb8-standalone-v1';
import{e209ExitReason}from'../e209-policy-v7';
import{e209RoundedRiskMultiplier}from'../e209-rounded-policy-v1';
import{initializeE209BarRuntime,feedbackE209BarRuntime,decideE209BarRuntime,type E209BarRuntimeState}from'../eb7-e209-bar-runtime-v3';
import{compileAdmissionPolicy,type AdmissionPolicy}from'./admission-policy-v19';
import{decideE209PrunedSourceGraph,type E209CurrentSourceGraphInput}from'./admission-graph-v19';
export type AdmissionObserver=(input:E209CurrentSourceGraphInput,result:ReturnType<typeof decideE209PrunedSourceGraph>)=>void;
export function createAdmissionSource(policy:AdmissionPolicy,observer?:AdmissionObserver):BarStrategyModule{
 const compiled=compileAdmissionPolicy(policy),params=freezeStrategyData({...eb8StandaloneV1.params,admission:policy});
 return{manifest:{sdkVersion:2,id:'EB8.ADMISSION',version:'e9332-native-feature-core-v1',researchOnly:true,migration:{complete:true,missing:[]}},params,
 initialize(input){assertFixedStrategyParams(input,params);return initializeE209BarRuntime()as unknown as StrategyJson;},
 onFeedback({state,params:input,feedback}){assertFixedStrategyParams(input,params);return feedbackE209BarRuntime(state as unknown as E209BarRuntimeState,feedback)as unknown as StrategyJson;},
 onBar({state,params:input,snapshot}){
  assertFixedStrategyParams(input,params);
  const step=decideE209BarRuntime(state as unknown as E209BarRuntimeState,snapshot,{multiplier:e209RoundedRiskMultiplier,exit:e209ExitReason},data=>{const result=decideE209PrunedSourceGraph(data,compiled);observer?.(data,result);return result;});
  return {...step,state:step.state as unknown as StrategyJson};
 }};
}
