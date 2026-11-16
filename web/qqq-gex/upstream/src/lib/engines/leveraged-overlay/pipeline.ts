/** Production-compatible Adapter; native observations inject disabled diagnostics
 * through the same ordered pipeline, without importing the option coordinator. */
import type { MarketInput } from './types/input';
import type { SystemOutput } from './types/output';
import { runOverlay } from './v2/overlay-runner';
import { runPipelineWithOverlay, type PipelineRunOptions } from './pipeline-core-v3';
import { decisionEngine } from '../core/DecisionEngine';
export type {PipelineRunOptions, PipelineStageProfiler} from './pipeline-core-v3';
export function runPipeline(input: MarketInput, options?: PipelineRunOptions): SystemOutput {
  return runPipelineWithOverlay(input, runOverlay, options, factors => decisionEngine.getLeveragedOverlayStockPolicy(factors));
}
