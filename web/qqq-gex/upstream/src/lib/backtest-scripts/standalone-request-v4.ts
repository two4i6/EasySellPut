/** The shared request parser is usable before loading any executable strategy. */
import {parseResearchReplayRequest,type ResearchReplayRequest} from './research-request-v3';
import {standaloneStrategyPaths,assertStandaloneExecutionProfile,DEFAULT_STANDALONE_STRATEGY} from './standalone-strategy-catalog-v4';
export type StandaloneRequest=ResearchReplayRequest&{strategyId:keyof typeof standaloneStrategyPaths;terminalExit?:'mark-only'};
export function parseStandaloneRequest(raw:unknown):StandaloneRequest{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Expected research request');
  const {strategyId=DEFAULT_STANDALONE_STRATEGY,terminalExit,...rest}=raw as Record<string,unknown>;
  if(terminalExit!==undefined&&terminalExit!=='mark-only')throw Error('Unsupported terminal exit policy');
  if(typeof strategyId!=='string'||!Object.hasOwn(standaloneStrategyPaths,strategyId))throw Error('Unknown registered strategy');
  const request=parseResearchReplayRequest(rest);
  assertStandaloneExecutionProfile(strategyId as StandaloneRequest['strategyId'],request.executionProfile);
  return {...request,strategyId:strategyId as StandaloneRequest['strategyId'],...(terminalExit===undefined?{}:{terminalExit})};
}
