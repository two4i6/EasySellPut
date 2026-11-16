/**
 * Default composite: EB6.E209 > P6.E385 > R9.E226.
 *
 * The coordinator implementation is shared with the proven P6/R9 worker
 * runner. EB6 is executed in an independent CPU worker when the default path
 * is used; the parent thread only remaps the layer identity and coordinates
 * actual openDate decisions/unified MTM.
 */
import { loadRunData } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import {
  buildQqqEb7P6R9DailySignalHistory,
  buildQqqEb7P6R9ReplayWithData,
  type QqqEb7P6R9ReplayBuildOptions,
  type QqqEb7P6R9ReplayResult,
} from './QqqEb7P6R9Replay';

export const QQQ_EB6_P6_R9_REPLAY_VARIANT = 'eb6_p6_r9' as const;
export const QQQ_EB6_P6_R9_REPLAY_VERSION = 'eb6-e209-p6-e385-r9-e226-coord-v1-mt' as const;
export const QQQ_EB6_P6_R9_REPLAY_LABEL = '默认：EB6.E209 > P6.E385 > R9.E226（多线程，按实际 openDate）' as const;

export type QqqEb6P6R9ReplayBuildOptions = Omit<QqqEb7P6R9ReplayBuildOptions, 'equityBoostMode'>;
export type QqqEb6P6R9ReplayResult = Omit<QqqEb7P6R9ReplayResult, 'replayVariant' | 'replayVersion'> & {
  replayVariant: typeof QQQ_EB6_P6_R9_REPLAY_VARIANT;
  replayVersion: typeof QQQ_EB6_P6_R9_REPLAY_VERSION;
};

function layer(value: 'EB7' | 'P6' | 'R9'): 'EB6' | 'P6' | 'R9' {
  return value === 'EB7' ? 'EB6' : value;
}

function remap(base: QqqEb7P6R9ReplayResult): QqqEb6P6R9ReplayResult {
  const acceptedLayerBreakdown = {
    EB6: base.acceptedLayerBreakdown.EB7,
    P6: base.acceptedLayerBreakdown.P6,
    R9: base.acceptedLayerBreakdown.R9,
  };
  const preemptedCountsByLayer = {
    EB6: base.coordination.preemptedCountsByLayer.EB7,
    P6: base.coordination.preemptedCountsByLayer.P6,
    R9: base.coordination.preemptedCountsByLayer.R9,
  };
  return {
    ...base,
    replayVariant: QQQ_EB6_P6_R9_REPLAY_VARIANT,
    replayVersion: QQQ_EB6_P6_R9_REPLAY_VERSION,
    daily: base.daily.map(record => ({
      ...record,
      layers: Object.fromEntries(Object.entries({ EB6: record.layers.EB7, P6: record.layers.P6, R9: record.layers.R9 }).map(([key, value]) => [key, value ? { ...value, reasons: value.reasons.map(reason => reason.replaceAll('EB7', 'EB6')) } : value])) as typeof record.layers,
      acceptedLayer: record.acceptedLayer ? layer(record.acceptedLayer) : null,
      priorityDecision: record.priorityDecision.replaceAll('EB7', 'EB6'),
    })),
    pendingOpenPositions: base.pendingOpenPositions.map(row => ({ ...row, layer: layer(row.layer) })),
    acceptedLayerBreakdown,
    coordination: { ...base.coordination, preemptedCountsByLayer },
    unifiedMtmMdd: { ...base.unifiedMtmMdd, sourceLayers: base.unifiedMtmMdd.sourceLayers.map(layer) },
  } as unknown as QqqEb6P6R9ReplayResult;
}

export async function buildQqqEb6P6R9ReplayWithData(startDate: string, endDate: string, data: Parameters<typeof buildQqqEb7P6R9ReplayWithData>[2], options: QqqEb6P6R9ReplayBuildOptions = {}): Promise<QqqEb6P6R9ReplayResult> {
  const base = await buildQqqEb7P6R9ReplayWithData(startDate, endDate, data, {
    ...options,
    equityBoostMode: 'EB6.E209',
    parallelWorkers: options.parallelWorkers ?? true,
  });
  return remap(base);
}

export async function buildQqqEb6P6R9LiveReplayResult(startDate: string, endDate: string): Promise<QqqEb6P6R9ReplayResult> {
  const seed = buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
  const data = await loadRunData(resolveRunSpec(seed));
  return buildQqqEb6P6R9ReplayWithData(startDate, endDate, data, { parallelWorkers: true });
}

export function buildQqqEb6P6R9DailySignalHistory(result: QqqEb6P6R9ReplayResult) {
  return buildQqqEb7P6R9DailySignalHistory(result as unknown as QqqEb7P6R9ReplayResult).map(record => ({
    ...record,
    reasons: record.reasons.map(reason => reason.replaceAll('EB7', 'EB6')),
  }));
}
