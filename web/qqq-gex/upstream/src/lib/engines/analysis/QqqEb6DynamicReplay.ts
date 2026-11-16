/**
 * EB6.E209 current-bar dynamic replay.
 *
 * This is the reusable implementation of EB5.E261.  It deliberately builds
 * admission from the supplied MarketDataSet and never consumes a materialized
 * date list, historical ledger, frozen tape, or process arguments.
 */
import { buildQqqEb3OnlineLayerWithData, matchesQqqEb4ResearchFinalVeto, type DynamicEb3Replay, type QqqEb4ResearchFinalVetoSpec } from './QqqEb2P2R5Replay';
import { applyQqqEb3QualityGate, buildQqqEb3FusedRules, runQqqEb3E12Union } from './QqqEb3E12';
import { buildQqqEb2E44Layers, runQqqEb2E44Union, type QqqEb2Cycle } from './QqqEb2E44Fused';
import { QQQ_EB6_CANDIDATE } from './QqqEb2CandidateRegistry';
import type { TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import { closeOptionPosition, createLegacyOptionMarket } from '../leveraged-overlay/v2/options';
import { MOCK_OPTION_CALIBRATION } from '../leveraged-overlay/backtest/mockOptionCalibration';
import { normalizeVolIndexForMockOptions } from '../leveraged-overlay/backtest/mockOptions';
import type { QqqCompositeReplayExecution } from './QqqCompositeReplaySession';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession } from './QqqCompositeReplaySession';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';

const EB_TAG = 'QQQ_EQUITY_BOOST_PUT_SPREAD';
const E45_FINAL_VETO: QqqEb4ResearchFinalVetoSpec = QQQ_EB6_CANDIDATE.contract.finalVeto;
const EB6_REPLAY_SESSIONS = new WeakMap<MarketDataSet, ReturnType<typeof createQqqCompositeReplaySession>>();
const day = (cycle: QqqEb2Cycle) => (cycle.open.signalDate ?? cycle.open.date ?? '').slice(0, 10);
const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

export type QqqEb6DynamicReplay = {
  candidateId: 'EB6';
  dataFingerprint: string;
  requestedStartDate: string;
  requestedEndDate: string;
  resolvedEndDate: string;
  upstream: DynamicEb3Replay;
  cycles: readonly QqqEb2Cycle[];
  /** Dynamic intermediate pools for research extensions; not an admission ledger. */
  researchPools: QqqEb6ResearchPools;
  diagnostics: {
    blockedPoolSize: number;
    gatedSize: number;
    replacementSize: number;
    mergedReleaseSize: number;
    finalVetoedSize: number;
  };
};

type QqqEb6ReleaseStage = {
  blockedCycles: readonly QqqEb2Cycle[];
  gatedCycles: readonly QqqEb2Cycle[];
  replacementCycles: readonly QqqEb2Cycle[];
  mergedReleaseCycles: readonly QqqEb2Cycle[];
  preVetoCycles: readonly QqqEb2Cycle[];
  finalVetoedCycles: readonly QqqEb2Cycle[];
  postVetoCycles: readonly QqqEb2Cycle[];
};

export type QqqEb6ResearchPools = {
  highRecovery: QqqEb6ReleaseStage;
  lowRecovery: QqqEb6ReleaseStage;
  highProbe: QqqEb6ReleaseStage;
  lowProbe: QqqEb6ReleaseStage;
  e209Cycles: readonly QqqEb2Cycle[];
  e218OnlyCycles: readonly QqqEb2Cycle[];
};

/** Research-only current-bar ablation; omitted in the production EB6 path. */
export type QqqEb6DynamicReplayOptions = {
  additionalReject?: (cycle: QqqEb2Cycle) => boolean;
  /** Research-only comparison profile; production/default is E209. */
  activeProfile?: 'E209' | 'E261';
  /** Read-only composite replay resources; never strategy state. */
  execution?: QqqCompositeReplayExecution;
};

function latestRequiredDataDate(data: MarketDataSet): string {
  const qqqEnd = data.qqqBars.at(-1)?.date;
  const tqqqEnd = data.tqqqBars.at(-1)?.date;
  if (!qqqEnd || !tqqqEnd) throw new Error('EB6 requires QQQ and TQQQ history');
  return qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
}

function resolveEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet): string {
  const dataEndDate = latestRequiredDataDate(data);
  const resolved = requestedEndDate < dataEndDate ? requestedEndDate : dataEndDate;
  if (resolved < startDate) throw new Error(`EB6 replay startDate is after available end date: ${startDate} > ${resolved}`);
  return resolved;
}

function pairRawCycles(log: readonly TradeEntry[]): QqqEb2Cycle[] {
  const opens = new Map<string, TradeEntry[]>();
  const cycles: QqqEb2Cycle[] = [];
  for (const trade of log) {
    if (trade.strategyTag !== EB_TAG) continue;
    const key = `${trade.symbol}|${trade.expiry ?? ''}`;
    if (trade.action === 'OPEN') {
      const queue = opens.get(key) ?? [];
      queue.push(trade);
      opens.set(key, queue);
      continue;
    }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    if (!Number.isFinite(trade.pnl)) continue;
    const open = opens.get(key)?.shift();
    if (open) cycles.push({ open, close: trade, pnl: trade.pnl! });
  }
  return cycles.sort((left, right) => day(left).localeCompare(day(right)));
}

async function buildUpstream(data: MarketDataSet, startDate: string, endDate: string, minHighRiskDays: number, execution?: QqqCompositeReplayExecution): Promise<DynamicEb3Replay & { blockedCycles: readonly QqqEb2Cycle[]; gated: readonly QqqEb2Cycle[] }> {
  const replay = await buildQqqEb3OnlineLayerWithData(
    startDate,
    endDate,
    data,
    'EB3.E76',
    {
      equityBoostRatioMin: QQQ_EB6_CANDIDATE.contract.ratioMin,
      equityBoostRatioMax: QQQ_EB6_CANDIDATE.contract.ratioMax,
      equityBoostDynamicDteRecoveryVxnThreshold: QQQ_EB6_CANDIDATE.contract.dteRecoveryVxnThreshold,
      equityBoostDynamicDteVxnThreshold: QQQ_EB6_CANDIDATE.contract.dteVxnThreshold,
      equityBoostDynamicDteMinHighRiskDays: minHighRiskDays,
      equityBoostDynamicWidthVxnThreshold: QQQ_EB6_CANDIDATE.contract.widthVxnThreshold,
      equityBoostDynamicWidthLowVxnTargetPct: QQQ_EB6_CANDIDATE.contract.widthLowVxnTargetPct,
      equityBoostDynamicWidthHighVxnTargetPct: QQQ_EB6_CANDIDATE.contract.widthHighVxnTargetPct,
    },
    E45_FINAL_VETO,
    execution,
  );
  const baseDays = new Set(replay.rows.map((row) => row.date));
  const c4Days = new Set(replay.c4Parent.map(day));
  const blockedCycles = pairRawCycles(replay.raw.tradeLog)
    .filter((cycle) => !c4Days.has(day(cycle)) && !baseDays.has(day(cycle)));
  const adxReAdmission = blockedCycles.filter((cycle) => numberField(cycle, 'adx14') >= 20 && numberField(cycle, 'adx14') < 32
    && numberField(cycle, 'tqqqRealisedVol20d') >= 0 && numberField(cycle, 'tqqqRealisedVol20d') < 0.3
    && numberField(cycle, 'weakeningSignalCount') >= 1);
  const releasedDays = new Set(replay.e44ReleasedByLayer.flatMap((layer) => layer.cycles.map(day)));
  const e1 = replay.eb2Rows.map((row) => row.cycle).filter((cycle) => !releasedDays.has(day(cycle)));
  const e44 = runQqqEb2E44Union(
    e1,
    [...replay.c4Parent, ...adxReAdmission],
    buildQqqEb2E44Layers().filter((layer) => !['E3', 'E5', 'E31', 'E34'].includes(layer.name)),
  ).cycles;
  const eb3 = runQqqEb3E12Union(e44, replay.rawE1, buildQqqEb3FusedRules('rule2-tqqqroc05-slow-confidence')).cycles;
  const gated = applyQqqEb3QualityGate(eb3, 'exclude-unavailable-slow-subregime-high-rv');
  return { ...replay, blockedCycles, gated };
}

function buildMergedRelease(
  upstream: Awaited<ReturnType<typeof buildUpstream>>,
  data: MarketDataSet,
  vixLower: number,
): { cycles: QqqEb2Cycle[]; stage: QqqEb6ReleaseStage; replacementSize: number; mergedReleaseSize: number; finalVetoedSize: number } {
  const used = new Set(upstream.gated.map(day));
  const replacement = upstream.rawE1.filter((cycle) => !used.has(day(cycle))
    && numberField(cycle, 'tqqqRealisedVol20d') >= 0.6 && numberField(cycle, 'tqqqRealisedVol20d') < 0.7
    && (String(context(cycle).trend) === 'BEAR'
      || (numberField(cycle, 'vix') >= 11 && numberField(cycle, 'vix') < 16 && numberField(cycle, 'adx14') >= 15)));
  const e86 = [...upstream.gated, ...replacement].sort((left, right) => day(left).localeCompare(day(right)));
  const e86Days = new Set(e86.map(day));
  const mergedRelease = upstream.blockedCycles.filter((cycle) => !e86Days.has(day(cycle)) && (
    (numberField(cycle, 'vix') >= vixLower && numberField(cycle, 'priceVsSma200Pct') >= 0.05 && numberField(cycle, 'priceVsSma200Pct') < 0.08 && numberField(cycle, 'tqqqRealisedVol20d') < 0.7)
    || (numberField(cycle, 'range20dPct') >= 0 && numberField(cycle, 'range20dPct') < 0.03 && numberField(cycle, 'weakeningSignalCount') >= 1 && numberField(cycle, 'weakeningSignalCount') < 3)
    || (numberField(cycle, 'tqqqRoc20') >= 0.05 && numberField(cycle, 'tqqqRoc20') < 0.1 && numberField(cycle, 'priceVsSma200Pct') < 0)
    || (data.vxnByDate[day(cycle)] != null && data.vxnByDate[day(cycle)] >= 17.5 && data.vxnByDate[day(cycle)] < 20.5 && numberField(cycle, 'trendScore') < 25)
  ));
  const all = [...e86, ...mergedRelease].sort((left, right) => day(left).localeCompare(day(right)));
  const vetoed = all.filter((cycle) => matchesQqqEb4ResearchFinalVeto(cycle, E45_FINAL_VETO));
  const postVetoCycles = all
    .filter((cycle) => !(numberField(cycle, 'roc20') >= -0.05 && numberField(cycle, 'roc20') < 0 && numberField(cycle, 'priceExtensionAtr') >= 2))
    .filter((cycle) => !matchesQqqEb4ResearchFinalVeto(cycle, E45_FINAL_VETO));
  return {
    cycles: postVetoCycles,
    stage: {
      blockedCycles: upstream.blockedCycles,
      gatedCycles: upstream.gated,
      replacementCycles: replacement,
      mergedReleaseCycles: mergedRelease,
      preVetoCycles: all,
      finalVetoedCycles: vetoed,
      postVetoCycles,
    },
    replacementSize: replacement.length,
    mergedReleaseSize: mergedRelease.length,
    finalVetoedSize: vetoed.length,
  };
}

function constructEb6Cycles(
  data: MarketDataSet,
  highRecovery: Awaited<ReturnType<typeof buildUpstream>>,
  lowRecovery: Awaited<ReturnType<typeof buildUpstream>>,
): { cycles: QqqEb2Cycle[]; researchPools: QqqEb6ResearchPools; diagnostics: QqqEb6DynamicReplay['diagnostics'] } {
  const high = buildMergedRelease(highRecovery, data, 22.4);
  const low = buildMergedRelease(lowRecovery, data, 22.4);
  const highProbe = buildMergedRelease(highRecovery, data, 22);
  const lowProbe = buildMergedRelease(lowRecovery, data, 22);
  const highByDay = new Map(high.cycles.map((cycle) => [day(cycle), cycle]));
  const e209 = low.cycles.map((cycle) => numberField(cycle, 'trendScore') >= 50 ? cycle : (highByDay.get(day(cycle)) ?? cycle));
  const highProbeByDay = new Map(highProbe.cycles.map((cycle) => [day(cycle), cycle]));
  const probe22 = lowProbe.cycles.map((cycle) => numberField(cycle, 'trendScore') >= 50 ? cycle : (highProbeByDay.get(day(cycle)) ?? cycle));
  const e209Days = new Set(e209.map(day));
  const e218Only = probe22.filter((cycle) => !e209Days.has(day(cycle)) && numberField(cycle, 'priceVsSma200Pct') >= 0.05 && numberField(cycle, 'priceVsSma200Pct') < 0.06);
  // E209 is the active EB6 profile. E218-only remains a research comparison
  // pool and is intentionally not admitted by the default path.
  const cycles = e209.sort((left, right) => day(left).localeCompare(day(right)));
  return {
    cycles,
    researchPools: {
      highRecovery: high.stage,
      lowRecovery: low.stage,
      highProbe: highProbe.stage,
      lowProbe: lowProbe.stage,
      e209Cycles: e209,
      e218OnlyCycles: e218Only,
    },
    diagnostics: {
      blockedPoolSize: highRecovery.blockedCycles.length,
      gatedSize: highRecovery.gated.length,
      replacementSize: high.replacementSize,
      mergedReleaseSize: high.mergedReleaseSize,
      finalVetoedSize: high.finalVetoedSize,
    },
  };
}

export async function buildQqqEb6DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb6DynamicReplayOptions = {}): Promise<QqqEb6DynamicReplay> {
  const resolvedEndDate = resolveEndDate(startDate, endDate, data);
  const ownedSession = options.execution ? undefined : EB6_REPLAY_SESSIONS.get(data) ?? (() => {
    const session = createQqqCompositeReplaySession(resolveRunSpec(buildQqqPcsHistoricalBacktestSpec({
      startDate,
      endDate: resolvedEndDate,
      replayVariant: 'bass2_3_3',
      strikeMode: 'delta',
      exitMode: 'hold_to_expiry',
    })), data);
    EB6_REPLAY_SESSIONS.set(data, session);
    return session;
  })();
  const execution = options.execution ?? (ownedSession
    ? executionFromQqqCompositeReplaySession(ownedSession)
    : (() => { throw new Error('EB6 replay session was not initialized'); })());
  const [highRecovery, lowRecovery] = await Promise.all([
    buildUpstream(data, startDate, resolvedEndDate, QQQ_EB6_CANDIDATE.contract.dteMinHighRiskDays, execution),
    buildUpstream(data, startDate, resolvedEndDate, 2, execution),
  ]);
  const constructed = constructEb6Cycles(data, highRecovery, lowRecovery);
  const activeProfile = options.activeProfile ?? QQQ_EB6_CANDIDATE.contract.activeProfile;
  const profileCycles = activeProfile === 'E261'
    ? [...constructed.cycles, ...constructed.researchPools.e218OnlyCycles].sort((left, right) => day(left).localeCompare(day(right)))
    : constructed.cycles;
  const cycles = options.additionalReject ? profileCycles.filter((cycle) => !options.additionalReject!(cycle)) : profileCycles;
  return {
    candidateId: QQQ_EB6_CANDIDATE.id,
    dataFingerprint: data.fingerprint,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedEndDate,
    upstream: highRecovery,
    cycles,
    researchPools: constructed.researchPools,
    diagnostics: constructed.diagnostics,
  };
}

export type QqqEb6CycleSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pl: number;
  worst: number | null;
  cvar5: number | null;
};

export function summarizeQqqEb6Cycles(cycles: readonly QqqEb2Cycle[]): QqqEb6CycleSummary {
  const pnls = cycles.map((cycle) => cycle.pnl);
  const sorted = [...pnls].sort((left, right) => left - right);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const tailCount = Math.max(1, Math.ceil(sorted.length * 0.05));
  return {
    trades: pnls.length,
    wins,
    losses: pnls.length - wins,
    winRate: pnls.length ? +(wins / pnls.length * 100).toFixed(4) : null,
    pl: +pnls.reduce((sum, pnl) => sum + pnl, 0).toFixed(2),
    worst: pnls.length ? +(sorted[0] ?? 0).toFixed(2) : null,
    cvar5: pnls.length ? +(sorted.slice(0, tailCount).reduce((sum, pnl) => sum + pnl, 0) / tailCount).toFixed(2) : null,
  };
}

export function computeQqqEb6MtmMdd(
  cycles: readonly QqqEb2Cycle[],
  data: MarketDataSet,
  startDate: string,
  endDate: string,
  config: Readonly<Record<string, unknown>> = {},
): number {
  const closes = new Map<string, number>();
  for (const cycle of cycles) closes.set(cycle.close.date, (closes.get(cycle.close.date) ?? 0) + cycle.pnl);
  const pricing = {
    spreadMultiplier: typeof config.optionSpreadMultiplier === 'number' ? config.optionSpreadMultiplier : 1,
    skewSlope: typeof config.optionSkewSlope === 'number' ? config.optionSkewSlope : MOCK_OPTION_CALIBRATION.skewSlope,
    riskFreeRate: typeof config.riskFreeRate === 'number' ? config.riskFreeRate : 0.045,
  };
  let realized = 0;
  let peak = 0;
  let mdd = 0;
  for (const bar of data.qqqBars.filter((item) => item.date >= startDate && item.date <= endDate)) {
    realized += closes.get(bar.date) ?? 0;
    let unrealized = 0;
    for (const cycle of cycles) {
      if ((cycle.open.date ?? '') > bar.date || (cycle.close.date ?? '') <= bar.date) continue;
      const match = cycle.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
      if (!match || !cycle.open.expiry) continue;
      const rawVol = data.vxnByDate[bar.date] ?? data.vixByDate[bar.date] ?? 20;
      const vol = normalizeVolIndexForMockOptions(rawVol, 'VXN');
      const rawVol3m = data.vix3mByDate[bar.date];
      const vol3m = rawVol3m != null && rawVol > 0 ? rawVol3m * (vol / rawVol) : undefined;
      unrealized += closeOptionPosition({
        openingCashImpact: cycle.open.cashImpact,
        legs: [
          { symbol: 'QQQ', type: 'put', side: 'short', strike: Number(match[2]), expiry: cycle.open.expiry, quantity: cycle.open.quantity },
          { symbol: 'QQQ', type: 'put', side: 'long', strike: Number(match[1]), expiry: cycle.open.expiry, quantity: cycle.open.quantity },
        ],
      }, createLegacyOptionMarket({ asOfDate: bar.date, prices: { QQQ: bar.close }, vix: vol, vix3m: vol3m }), pricing).pnl;
    }
    const nav = realized + unrealized;
    peak = Math.max(peak, nav);
    mdd = Math.max(mdd, peak - nav);
  }
  return +mdd.toFixed(2);
}
