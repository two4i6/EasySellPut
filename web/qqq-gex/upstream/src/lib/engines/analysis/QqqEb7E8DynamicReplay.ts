import type { BacktestResult } from '../leveraged-overlay/backtest/types';
/** EB7.E8 research-only current-bar child builder. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import {
  buildQqqEb7E7DynamicReplayWithData,
  QQQ_EB7_E7_REPLAY_VERSION,
} from './QqqEb7E7DynamicReplay';
import { EB7_E8_RELEASE_RULE } from './QqqEb7E8Rules';
import {
  computeQqqEb7MtmMdd,
  computeQqqEb7RealizedMdd,
  summarizeQqqEb7Cycles,
  type QqqEb7DynamicReplayOptions,
} from './QqqEb7DynamicReplay';

export const QQQ_EB7_E8_REPLAY_VERSION = 'eb7-e8-zero-loss-release-current-bar-v1' as const;

export type QqqEb7E8DynamicReplay = {
  admissionRaw: Pick<BacktestResult, 'debug'>;
  candidateId: 'EB7.E8';
  parentId: 'EB7.E7';
  replayVersion: typeof QQQ_EB7_E8_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E7_REPLAY_VERSION;
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
    parentBuilder: 'buildQqqEb7E7DynamicReplayWithData';
    residualPoolSize: number;
    releasedCycleCount: number;
    rule: typeof EB7_E8_RELEASE_RULE.rule;
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

export async function buildQqqEb7E8DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7DynamicReplayOptions = {},
): Promise<QqqEb7E8DynamicReplay> {
  const parent = await buildQqqEb7E7DynamicReplayWithData(startDate, endDate, data, options);
  const pool = dedupeByDay(parent.researchPool);
  const additions = dedupeByDay(pool.filter(EB7_E8_RELEASE_RULE.accepts));
  const cycles = [...parent.cycles, ...additions].sort((left, right) => day(left).localeCompare(day(right)));
  const summary = summarizeQqqEb7Cycles(cycles);
  return {
    admissionRaw: parent.admissionRaw,
    candidateId: 'EB7.E8',
    parentId: 'EB7.E7',
    replayVersion: QQQ_EB7_E8_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E7_REPLAY_VERSION,
    dataFingerprint: data.fingerprint,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedEndDate: parent.resolvedEndDate,
    cycles,
    researchPool: pool.filter(cycle => !EB7_E8_RELEASE_RULE.accepts(cycle)),
    metrics: {
      ...summary,
      realizedMdd: computeQqqEb7RealizedMdd(cycles),
      mtmMdd: computeQqqEb7MtmMdd(cycles, data, startDate, parent.resolvedEndDate, {
        applyRiskMultiplierToMtm: typeof options.executionOverrides?.equityBoostMacroRiskMode === 'string',
      }),
    },
    audit: {
      admission: 'current-bar',
      source: 'MarketDataSet',
      chronologicalReplay: true,
      settlementStateUpdates: true,
      parentBuilder: 'buildQqqEb7E7DynamicReplayWithData',
      residualPoolSize: pool.length,
      releasedCycleCount: additions.length,
      rule: EB7_E8_RELEASE_RULE.rule,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
