/** Trusted strategy registry. Request, identity and execution are shared, not inherited from E209. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import {assertBarStrategyModule} from './strategy-module-v2';
import {STANDALONE_RESEARCH_FIXTURES} from './research-request-v3';
import {parseStandaloneRequest,type StandaloneRequest} from './standalone-request-v4';
import {resolveStandaloneIdentity} from './standalone-identity-v4';
import {standaloneResearchReleaseGates} from './standalone-risk-v1';
import {standaloneStrategyCatalog} from './standalone-strategy-catalog-v4';
import {STANDALONE_IDS,standalonePlugins,runStandalonePluginWithData,type StandaloneId,type ResearchRunOptions} from './standalone-research-v3';
export {STANDALONE_IDS};
export type {StandaloneId};
export {parseStandaloneRequest,resolveStandaloneIdentity};
export type {StandaloneRequest};
export function assertStandaloneRunnable(request:StandaloneRequest){assertBarStrategyModule(standalonePlugins[request.strategyId]?.module);}
export function describeStandaloneStrategy(id:StandaloneId){
  const {module,path}=standalonePlugins[id];
  const capability=standaloneStrategyCatalog[id];
  return {id,path,manifest:structuredClone(module.manifest),defaults:structuredClone(module.params),
    fixtures:[...STANDALONE_RESEARCH_FIXTURES],
    lineage:id==='EB7.E209'?'EB7.E207 → EB7.E209 historical → causal-sources V4 → source-host V5 → framework-terminal V6':structuredClone(module.params.lineage),
    adapter:capability.adapter,
    ...(capability.executionProfiles.length?{executionProfiles:[...capability.executionProfiles]}:{}),
    releaseGates:{...standaloneResearchReleaseGates},
    runnable:module.manifest.migration.complete&&!module.manifest.migration.missing.length,
    retention:'strategy-source-only',researchOnly:true,productionReady:false,
    releaseStatus:'RESEARCH_ONLY_NOT_RELEASED'};
}
export function describeStandaloneRegistry(){
  return {sdkVersion:2,researchOnly:true,productionReady:false,retention:'strategy-source-only',
    strategies:STANDALONE_IDS.map(describeStandaloneStrategy)};
}
export function runStandaloneResearchWithData(data:MarketDataSet,request:StandaloneRequest,options:ResearchRunOptions={}){
  assertStandaloneRunnable(request);const {strategyId,...base}=request;
  return runStandalonePluginWithData(data,strategyId,base,options);
}
