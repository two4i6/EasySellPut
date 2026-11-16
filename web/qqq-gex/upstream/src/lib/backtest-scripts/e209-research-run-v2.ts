/** Compatibility entry: public execution is implemented once in the shared research module. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import {runStandalonePluginWithData,type ResearchRunOptions} from './standalone-research-v3';
import {STANDALONE_RESEARCH_FIXTURES,parseResearchReplayRequest,type ResearchReplayRequest} from './research-request-v3';
import {E209_CAUSAL_RELEASE_GATES} from './strategies/eb7-e209-causal-v6';
import {describeStandaloneStrategy} from './standalone-registry-v2';
import type {resolveE209SourceContract} from './e209-source-initialization-v2';
import type {createQqqSourceExecutionAdapter} from './qqq-source-adapter-v2';
export const E209_RESEARCH_FIXTURES=STANDALONE_RESEARCH_FIXTURES;
export type E209ResearchRequest=ResearchReplayRequest;
export const parseE209ResearchRequest=parseResearchReplayRequest;
export function describeE209CausalResearch() {
  const description=describeStandaloneStrategy('EB7.E209');
  return { ...description, researchReleaseGates:description.releaseGates,
    releaseStatus: 'RESEARCH_RUNNABLE_NOT_RELEASED', releaseGates: [...E209_CAUSAL_RELEASE_GATES],
  };
}

export async function runE209ResearchWithData(data:MarketDataSet,request:ResearchReplayRequest,options:ResearchRunOptions={}){
  const result=await runStandalonePluginWithData(data,'EB7.E209',request,options);
  return {...result,sourceContract:result.sourceContract as ReturnType<typeof resolveE209SourceContract>,
    execution:result.execution as ReturnType<ReturnType<typeof createQqqSourceExecutionAdapter>['evidence']>};
}
