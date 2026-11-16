/** Default composite: EB7.E209 > P6.E385 > R9.E226. */
import { loadRunData } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import {
  buildQqqEb7P6R9DailySignalHistory,
  buildQqqEb7P6R9ReplayWithData,
  type QqqEb7P6R9ReplayBuildOptions,
  type QqqEb7P6R9ReplayResult,
} from './QqqEb7P6R9Replay';

export const QQQ_EB7_E209_P6_R9_REPLAY_VARIANT = 'eb7_e209_p6_e385_r9_e226' as const;
export const QQQ_EB7_E209_P6_R9_REPLAY_VERSION = 'eb7-e209-p6-e385-r9-e226-coord-v1-mt' as const;
export const QQQ_EB7_E209_P6_R9_REPLAY_LABEL = '默认：EB7.E209 > P6.E385 > R9.E226（多线程，按实际 openDate）' as const;

export type QqqEb7E209P6R9ReplayBuildOptions = Omit<QqqEb7P6R9ReplayBuildOptions, 'equityBoostMode'>;
export type QqqEb7E209P6R9ReplayResult = Omit<QqqEb7P6R9ReplayResult, 'replayVariant' | 'replayVersion'> & {
  replayVariant: typeof QQQ_EB7_E209_P6_R9_REPLAY_VARIANT;
  replayVersion: typeof QQQ_EB7_E209_P6_R9_REPLAY_VERSION;
};

function remap(base: QqqEb7P6R9ReplayResult): QqqEb7E209P6R9ReplayResult {
  return {
    ...base,
    replayVariant: QQQ_EB7_E209_P6_R9_REPLAY_VARIANT,
    replayVersion: QQQ_EB7_E209_P6_R9_REPLAY_VERSION,
  };
}

export async function buildQqqEb7E209P6E385R9E226ReplayWithData(
  startDate: string,
  endDate: string,
  data: Parameters<typeof buildQqqEb7P6R9ReplayWithData>[2],
  options: QqqEb7E209P6R9ReplayBuildOptions = {},
): Promise<QqqEb7E209P6R9ReplayResult> {
  const base = await buildQqqEb7P6R9ReplayWithData(startDate, endDate, data, {
    ...options,
    equityBoostMode: 'EB7.E209',
    parallelWorkers: options.parallelWorkers ?? true,
  });
  return remap(base);
}

export async function buildQqqEb7E209P6E385R9E226LiveReplayResult(startDate: string, endDate: string): Promise<QqqEb7E209P6R9ReplayResult> {
  const seed = buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
  const data = await loadRunData(resolveRunSpec(seed));
  return buildQqqEb7E209P6E385R9E226ReplayWithData(startDate, endDate, data, { parallelWorkers: true });
}

export function buildQqqEb7E209P6E385R9E226DailySignalHistory(result: QqqEb7E209P6R9ReplayResult) {
  return buildQqqEb7P6R9DailySignalHistory(result as unknown as QqqEb7P6R9ReplayResult);
}
