/** Observation-only Adapter; policy ordering and currentState projection are
 * shared verbatim with production, while inactive option diagnostics are separate. */
import {runPipelineWithOverlay, type PipelineRunOptions} from '../../pipeline-core-v3';
import type {MarketInput} from '../../types/input';
import {runNativeStockOverlayDiagnostics} from '../native-overlay-diagnostics-v3';
import {createBacktestPipelineInput} from './pipeline-input-v3';
export {applyMacroBoostBlock} from './pipeline-input-v3';
export function runBacktestPipeline(input:Omit<MarketInput,'mode'>,options?:PipelineRunOptions){
  return runPipelineWithOverlay(createBacktestPipelineInput(input),runNativeStockOverlayDiagnostics,options);
}
