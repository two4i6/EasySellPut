import { qqqEbAdmissionSnapshot } from './qqqEbDailyAdmission';
import type { BacktestResult } from '../leveraged-overlay/backtest/types';
/**
 * EB7.E2 research-only current-bar child builder.
 *
 * This child starts from the dynamic EB7.E0 replay, applies one precision
 * veto and one residual release using current-bar fields, and keeps the
 * chronological settlement/P&L machinery from the parent.
 */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import {
  buildQqqEb7DynamicReplayWithData,
  computeQqqEb7MtmMdd,
  computeQqqEb7RealizedMdd,
  summarizeQqqEb7Cycles,
  type QqqEb7DynamicReplayOptions,
} from './QqqEb7DynamicReplay';
import { EB7_E2_RELEASE_RULE, EB7_E2_VETO_RULE } from './QqqEb7E2Rules';

export const QQQ_EB7_E2_REPLAY_VERSION = 'eb7-e2-precision-veto-release-current-bar-v1' as const;

type Eb7ResearchPools = Awaited<ReturnType<typeof buildQqqEb7DynamicReplayWithData>>['researchPools'];

export type QqqEb7E2DynamicReplay = {
  admissionRaw: Pick<BacktestResult, 'debug'>;
  candidateId: 'EB7.E2';
  parentId: 'EB7.E0';
  replayVersion: typeof QQQ_EB7_E2_REPLAY_VERSION;
  parentReplayVersion: string;
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
    parentBuilder: 'buildQqqEb7DynamicReplayWithData';
    residualPoolSize: number;
    vetoedCycleCount: number;
    releasedCycleCount: number;
    vetoRule: typeof EB7_E2_VETO_RULE.rule;
    releaseRule: typeof EB7_E2_RELEASE_RULE.rule;
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

function residualPool(pools: Eb7ResearchPools, acceptedCycles: readonly QqqEb2Cycle[]): QqqEb2Cycle[] {
  const acceptedDays = new Set(acceptedCycles.map(day));
  return dedupeByDay([
    ...pools.rawE1,
    ...pools.e1Parent,
    ...pools.c4Parent,
    ...pools.qualityExcluded,
    ...pools.researchVetoed,
    ...pools.highRecovery.blockedCycles,
    ...pools.highRecovery.gatedCycles,
    ...pools.highRecovery.replacementCycles,
    ...pools.highRecovery.mergedReleaseCycles,
    ...pools.highRecovery.finalVetoedCycles,
    ...pools.lowRecovery.blockedCycles,
    ...pools.lowRecovery.gatedCycles,
    ...pools.lowRecovery.replacementCycles,
    ...pools.lowRecovery.mergedReleaseCycles,
    ...pools.lowRecovery.finalVetoedCycles,
    ...pools.e218OnlyCycles,
  ]).filter(cycle => !acceptedDays.has(day(cycle)));
}

export async function buildQqqEb7E2DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7DynamicReplayOptions = {},
): Promise<QqqEb7E2DynamicReplay> {
  const parent = await buildQqqEb7DynamicReplayWithData(startDate, endDate, data, options);
  const pool = residualPool(parent.researchPools, parent.cycles);
  const vetoed = parent.cycles.filter(EB7_E2_VETO_RULE.blocks);
  const keptParent = parent.cycles.filter(cycle => !EB7_E2_VETO_RULE.blocks(cycle));
  const additions = dedupeByDay(pool.filter(EB7_E2_RELEASE_RULE.accepts));
  const cycles = [...keptParent, ...additions].sort((left, right) => day(left).localeCompare(day(right)));
  const summary = summarizeQqqEb7Cycles(cycles);
  return {
    admissionRaw: qqqEbAdmissionSnapshot(parent.upstream.raw),
    candidateId: 'EB7.E2',
    parentId: 'EB7.E0',
    replayVersion: QQQ_EB7_E2_REPLAY_VERSION,
    parentReplayVersion: parent.replayVersion,
    dataFingerprint: data.fingerprint,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedEndDate: parent.resolvedEndDate,
    cycles,
    researchPool: pool,
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
      parentBuilder: 'buildQqqEb7DynamicReplayWithData',
      residualPoolSize: pool.length,
      vetoedCycleCount: vetoed.length,
      releasedCycleCount: additions.length,
      vetoRule: EB7_E2_VETO_RULE.rule,
      releaseRule: EB7_E2_RELEASE_RULE.rule,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
