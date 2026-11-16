import type { BacktestResult } from '../leveraged-overlay/backtest/types';
/** EB7.E6 research-only current-bar child builder. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import {
  buildQqqEb7E5DynamicReplayWithData,
  QQQ_EB7_E5_REPLAY_VERSION,
} from './QqqEb7E5DynamicReplay';
import { EB7_E6_RELEASE_RULE } from './QqqEb7E6Rules';
import {
  computeQqqEb7MtmMdd,
  computeQqqEb7RealizedMdd,
  summarizeQqqEb7Cycles,
  type QqqEb7DynamicReplayOptions,
} from './QqqEb7DynamicReplay';

export const QQQ_EB7_E6_REPLAY_VERSION = 'eb7-e6-zero-loss-release-current-bar-v1' as const;

export type QqqEb7E6DynamicReplay = {
  admissionRaw: Pick<BacktestResult, 'debug'>;
  candidateId: 'EB7.E6';
  parentId: 'EB7.E5';
  replayVersion: typeof QQQ_EB7_E6_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E5_REPLAY_VERSION;
  dataFingerprint: string;
  requestedStartDate: string;
  requestedEndDate: string;
  resolvedEndDate: string;
  cycles: readonly QqqEb2Cycle[];
  researchPool: readonly QqqEb2Cycle[];
  metrics: ReturnType<typeof summarizeQqqEb7Cycles> & { realizedMdd: number; mtmMdd: number };
  audit: {
    admission: 'current-bar';
    source: 'MarketDataSet';
    chronologicalReplay: true;
    settlementStateUpdates: true;
    parentBuilder: 'buildQqqEb7E5DynamicReplayWithData';
    residualPoolSize: number;
    releasedCycleCount: number;
    rule: typeof EB7_E6_RELEASE_RULE.rule;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

const day = (cycle: QqqEb2Cycle) => (cycle.open.signalDate ?? cycle.open.date ?? '').slice(0, 10);

function dedupeByDay(cycles: readonly QqqEb2Cycle[]): QqqEb2Cycle[] {
  const seen = new Set<string>();
  const result: QqqEb2Cycle[] = [];
  for (const cycle of cycles) {
    const value = day(cycle);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(cycle);
  }
  return result;
}

export async function buildQqqEb7E6DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7DynamicReplayOptions = {},
): Promise<QqqEb7E6DynamicReplay> {
  const parent = await buildQqqEb7E5DynamicReplayWithData(startDate, endDate, data, options);
  const pool = dedupeByDay(parent.researchPool);
  const additions = dedupeByDay(pool.filter(EB7_E6_RELEASE_RULE.accepts));
  const cycles = [...parent.cycles, ...additions].sort((left, right) => day(left).localeCompare(day(right)));
  const summary = summarizeQqqEb7Cycles(cycles);
  return {
    admissionRaw: parent.admissionRaw,
    candidateId: 'EB7.E6',
    parentId: 'EB7.E5',
    replayVersion: QQQ_EB7_E6_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E5_REPLAY_VERSION,
    dataFingerprint: data.fingerprint,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedEndDate: parent.resolvedEndDate,
    cycles,
    researchPool: pool.filter(cycle => !EB7_E6_RELEASE_RULE.accepts(cycle)),
    metrics: {
      ...summary,
      realizedMdd: computeQqqEb7RealizedMdd(cycles),
      mtmMdd: options.skipIntermediateMtm ? parent.metrics.mtmMdd : computeQqqEb7MtmMdd(cycles, data, startDate, parent.resolvedEndDate),
    },
    audit: {
      admission: 'current-bar',
      source: 'MarketDataSet',
      chronologicalReplay: true,
      settlementStateUpdates: true,
      parentBuilder: 'buildQqqEb7E5DynamicReplayWithData',
      residualPoolSize: pool.length,
      releasedCycleCount: additions.length,
      rule: EB7_E6_RELEASE_RULE.rule,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
