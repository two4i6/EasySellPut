import { runPipeline, type PipelineRunOptions } from '../../pipeline';
import type { MarketInput } from '../../types/input';
import type { SystemOutput } from '../../types/output';
import {createBacktestPipelineInput} from './pipeline-input-v3';
export {applyMacroBoostBlock, createBacktestPipelineInput} from './pipeline-input-v3';

/** v2 日循环进入唯一业务决策主链的唯一入口。 */
export function runBacktestPipeline(input: Omit<MarketInput, 'mode'>, options?: PipelineRunOptions): SystemOutput {
  return runPipeline(createBacktestPipelineInput(input), options);
}
