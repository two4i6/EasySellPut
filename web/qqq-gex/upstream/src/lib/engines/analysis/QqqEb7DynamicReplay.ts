/**
 * EB7.E235 research-only current-bar replay.
 *
 * EB7 is intentionally implemented as its own replay. It shares only the
 * lower-level market/option execution seams with EB3; it never invokes the
 * EB6 builder and never turns an EB6 result into an EB7 label.
 */
import { buildQqqEb3OnlineLayerWithData, matchesQqqEb4ResearchFinalVeto, type DynamicEb3Replay, type QqqEb2DynamicParentOptions, type QqqEb4ResearchFinalVetoSpec } from './QqqEb2P2R5Replay';
import { applyQqqEb3QualityGate, buildQqqEb3FusedRules, runQqqEb3E12Union } from './QqqEb3E12';
import { buildQqqEb2E44Layers, runQqqEb2E44Union, type QqqEb2Cycle } from './QqqEb2E44Fused';
import { QQQ_EB7_CANDIDATE } from './QqqEb2CandidateRegistry';
import { EB7_E235_BRANCHES, EB7_E235_CONDITION_COUNT, EB7_PRE_E235_RULES, admitsEb7E235, scoreEb7E235 } from './QqqEb7E235Rules';
import type { TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { QqqCompositeReplayExecution, QqqReplayProfiler } from './QqqCompositeReplaySession';
import { closeOptionPosition, createLegacyOptionMarket } from '../leveraged-overlay/v2/options';
import { MOCK_OPTION_CALIBRATION } from '../leveraged-overlay/backtest/mockOptionCalibration';
import { normalizeVolIndexForMockOptions } from '../leveraged-overlay/backtest/mockOptions';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession } from './QqqCompositeReplaySession';

// A MarketDataSet is immutable for the lifetime of a research run. Reuse only
// read-only market-derived caches across candidate replays; strategy state and
// admission intermediates remain keyed inside the execution session.
const EB7_REPLAY_SESSIONS = new WeakMap<MarketDataSet, ReturnType<typeof createQqqCompositeReplaySession>>();

const EB_TAG = 'QQQ_EQUITY_BOOST_PUT_SPREAD';
const E45_FINAL_VETO: QqqEb4ResearchFinalVetoSpec = QQQ_EB7_CANDIDATE.contract.finalVeto;
export const QQQ_EB7_REPLAY_VERSION = 'eb7-e235-score1-current-bar-v1' as const;
const day = (cycle: QqqEb2Cycle) => (cycle.open.signalDate ?? cycle.open.date ?? '').slice(0, 10);
const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

export type QqqEb7ReleaseStage = {
  blockedCycles: readonly QqqEb2Cycle[];
  gatedCycles: readonly QqqEb2Cycle[];
  replacementCycles: readonly QqqEb2Cycle[];
  mergedReleaseCycles: readonly QqqEb2Cycle[];
  preVetoCycles: readonly QqqEb2Cycle[];
  finalVetoedCycles: readonly QqqEb2Cycle[];
  postVetoCycles: readonly QqqEb2Cycle[];
};

export type QqqEb7ResearchPools = {
  highRecovery: QqqEb7ReleaseStage;
  lowRecovery: QqqEb7ReleaseStage;
  highProbe: QqqEb7ReleaseStage;
  lowProbe: QqqEb7ReleaseStage;
  rawE1: readonly QqqEb2Cycle[];
  e1Parent: readonly QqqEb2Cycle[];
  c4Parent: readonly QqqEb2Cycle[];
  qualityExcluded: readonly QqqEb2Cycle[];
  researchVetoed: readonly QqqEb2Cycle[];
  e209Cycles: readonly QqqEb2Cycle[];
  e218OnlyCycles: readonly QqqEb2Cycle[];
  e64Cycles: readonly QqqEb2Cycle[];
  e27Cycles: readonly QqqEb2Cycle[];
  rescueCycles: readonly QqqEb2Cycle[];
  preE235Cycles: readonly QqqEb2Cycle[];
};

export type QqqEb7CycleSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pl: number;
  worst: number | null;
  cvar5: number | null;
};

export type QqqEb7DynamicReplay = {
  candidateId: 'EB7';
  replayVersion: typeof QQQ_EB7_REPLAY_VERSION;
  dataFingerprint: string;
  requestedStartDate: string;
  requestedEndDate: string;
  resolvedEndDate: string;
  upstream: DynamicEb3Replay;
  cycles: readonly QqqEb2Cycle[];
  metrics: QqqEb7CycleSummary & { realizedMdd: number; mtmMdd: number };
  researchPools: QqqEb7ResearchPools;
  audit: {
    admission: 'current-bar';
    source: 'MarketDataSet';
    chronologicalReplay: true;
    settlementStateUpdates: true;
    settledCycleCount: number;
    e64StageCount: number;
    preE235RuleCount: number;
    excludedPreE235RuleIds: readonly string[];
    e235BranchCount: number;
    e235ConditionCount: number;
    e235StructuralForm: 'score>=1';
    baseCycleCount: number;
    e64CycleCount: number;
    preE235CycleCount: number;
    e235AdditionCount: number;
    independentFromEb6Builder: true;
    independentCycleSet: boolean;
    canonicalOptionSignalTapeMode: 'skip' | 'legacy';
    canonicalTapeEntriesGenerated: number;
    noFrozenTape: true;
  };
};

/**
 * Research-only macro knobs. Defaults reproduce the registered EB7.E0
 * contract exactly; callers must opt in explicitly to a parameter variant.
 */
export type QqqEb7DynamicReplayOptions = Readonly<{
  /** Research reference repair only; standalone modules must not invoke this builder. */
  referenceCooldownMode?: 'settlement_feedback_v1';
  /** Composite replay session resources; never contains strategy state. */
  execution?: QqqCompositeReplayExecution;
  profiler?: QqqReplayProfiler;
  /** Research-only parity switch; low recovery does not need a daily trace. */
  lowRecoveryTrace?: boolean;
  /** Research-only: omit the high-recovery diagnostic trace when only cycles/metrics are needed. */
  highRecoveryTrace?: boolean;
  /** Research-only: parent layers may reuse the inherited MTM value until the final layer. */
  skipIntermediateMtm?: boolean;
  /** Data-relative canonical option-signal warm-up; never a date whitelist. */
  canonicalOptionSignalStartDate?: string;
  /** Composite-only optimization; independent EB7 builders keep arm-specific tapes. */
  canonicalOptionSignalTapeShared?: boolean;
  /** Research-only compatibility path for the pre-current-bar EB7 ledger. */
  canonicalOptionSignalTapeMode?: 'skip' | 'legacy';
  /** Research-only reference switch; restores traces for intermediate EB2 arms. */
  intermediateRecoveryTrace?: boolean;
  highRiskMinDays?: number;
  lowRiskMinDays?: number;
  mergedReleaseVixLower?: number;
  ratioMin?: number;
  ratioMax?: number;
  /** One-factor VIX-budget ablation; replaces all VIX sub-bucket multipliers and low-VIX exceptions. */
  unifiedVixMultiplier?: number;
  /** Two-bucket VIX ablation; one low-VIX scalar, neutral/high VIX held at 1. */
  lowVixOnlyMultiplier?: number;
  /** Research-only structural ablation of current-bar pre-E235 rules. */
  excludedPreE235RuleIds?: readonly string[];
  /** Research-only structural ablations; undefined preserves the registered execution modes. */
  dteMode?: 'fixed' | 'risk_adaptive_v1' | 'risk_adaptive_hysteresis_v1' | 'state_adaptive_sr01_v1' | 'state_adaptive_bad_sr01_v1' | 'price_adaptive_v1';
  widthMode?: 'fixed' | 'fixed_target_v1' | 'risk_adaptive_v1' | 'price_adaptive_v1';
  dteRecoveryVxnThreshold?: number;
  dteVxnThreshold?: number;
  widthVxnThreshold?: number;
  widthLowVxnTargetPct?: number;
  widthHighVxnTargetPct?: number;
  /** Research-only current-bar contract selection overrides; omitted preserves EB7.E0. */
  executionOverrides?: QqqEb2DynamicParentOptions['executionOverrides'];
}>;

function latestRequiredDataDate(data: MarketDataSet): string {
  const qqqEnd = data.qqqBars.at(-1)?.date;
  const tqqqEnd = data.tqqqBars.at(-1)?.date;
  if (!qqqEnd || !tqqqEnd) throw new Error('EB7 requires QQQ and TQQQ history');
  return qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
}

function resolveEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet): string {
  const dataEndDate = latestRequiredDataDate(data);
  const resolved = requestedEndDate < dataEndDate ? requestedEndDate : dataEndDate;
  if (resolved < startDate) throw new Error(`EB7 replay startDate is after available end date: ${startDate} > ${resolved}`);
  return resolved;
}

function sharedReplaySession(startDate: string, endDate: string, data: MarketDataSet) {
  const cached = EB7_REPLAY_SESSIONS.get(data);
  if (cached?.data.fingerprint === data.fingerprint) return cached;
  const session = createQqqCompositeReplaySession(resolveRunSpec(buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate,
    replayVariant: 'bass2_3_3',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  })), data);
  EB7_REPLAY_SESSIONS.set(data, session);
  return session;
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

async function buildEb7Upstream(data: MarketDataSet, startDate: string, endDate: string, minHighRiskDays: number, options: QqqEb7DynamicReplayOptions = {}, trace = true, rawE1Trace = false, e1Trace = false): Promise<DynamicEb3Replay & { blockedCycles: readonly QqqEb2Cycle[]; gated: readonly QqqEb2Cycle[] }> {
  const replay = await buildQqqEb3OnlineLayerWithData(
    startDate,
    endDate,
    data,
    'EB3.E76',
    {
      ...options.executionOverrides,
      equityBoostRatioMin: options.ratioMin ?? QQQ_EB7_CANDIDATE.contract.ratioMin,
      equityBoostRatioMax: options.ratioMax ?? QQQ_EB7_CANDIDATE.contract.ratioMax,
      equityBoostDynamicDteRecoveryVxnThreshold: options.dteRecoveryVxnThreshold ?? QQQ_EB7_CANDIDATE.contract.dteRecoveryVxnThreshold,
      equityBoostDynamicDteVxnThreshold: options.dteVxnThreshold ?? QQQ_EB7_CANDIDATE.contract.dteVxnThreshold,
      equityBoostDynamicDteMinHighRiskDays: minHighRiskDays,
      equityBoostDynamicWidthVxnThreshold: options.widthVxnThreshold ?? QQQ_EB7_CANDIDATE.contract.widthVxnThreshold,
      equityBoostDynamicWidthLowVxnTargetPct: options.widthLowVxnTargetPct ?? QQQ_EB7_CANDIDATE.contract.widthLowVxnTargetPct,
      equityBoostDynamicWidthHighVxnTargetPct: options.widthHighVxnTargetPct ?? QQQ_EB7_CANDIDATE.contract.widthHighVxnTargetPct,
      ...(options.dteMode ? { equityBoostDteMode: options.dteMode } : {}),
      ...(options.widthMode ? { equityBoostWidthMode: options.widthMode } : {}),
      ...(options.unifiedVixMultiplier != null ? {
        equityBoostMacroRiskVixLowMultiplier: options.unifiedVixMultiplier,
        equityBoostMacroRiskVixMidMultiplier: options.unifiedVixMultiplier,
        equityBoostMacroRiskVixHighMultiplier: options.unifiedVixMultiplier,
        equityBoostMacroRiskBullNeutralSr02LowVixMultiplier: undefined,
        equityBoostMacroRiskExtendedSr02LowVixMultiplier: undefined,
      } : {}),
      ...(options.lowVixOnlyMultiplier != null ? {
        equityBoostMacroRiskVixLowMultiplier: options.lowVixOnlyMultiplier,
        equityBoostMacroRiskVixMidMultiplier: 1,
        equityBoostMacroRiskVixHighMultiplier: 1,
        equityBoostMacroRiskBullNeutralSr02LowVixMultiplier: undefined,
        equityBoostMacroRiskExtendedSr02LowVixMultiplier: undefined,
      } : {}),
    },
    E45_FINAL_VETO,
    options.execution,
    trace,
    rawE1Trace,
    e1Trace,
    options.canonicalOptionSignalStartDate,
    options.canonicalOptionSignalTapeShared,
    options.canonicalOptionSignalTapeMode ?? 'skip',
    options.referenceCooldownMode,
  );
  const baseDays = new Set(replay.rows.map(row => row.date));
  const c4Days = new Set(replay.c4Parent.map(day));
  const blockedCycles = pairRawCycles(replay.raw.tradeLog)
    .filter(cycle => !c4Days.has(day(cycle)) && !baseDays.has(day(cycle)));
  const adxReAdmission = blockedCycles.filter(cycle => numberField(cycle, 'adx14') >= 20 && numberField(cycle, 'adx14') < 32
    && numberField(cycle, 'tqqqRealisedVol20d') >= 0 && numberField(cycle, 'tqqqRealisedVol20d') < .3
    && numberField(cycle, 'weakeningSignalCount') >= 1);
  const releasedDays = new Set(replay.e44ReleasedByLayer.flatMap(layer => layer.cycles.map(day)));
  const e1 = replay.eb2Rows.map(row => row.cycle).filter(cycle => !releasedDays.has(day(cycle)));
  const e44 = runQqqEb2E44Union(
    e1,
    [...replay.c4Parent, ...adxReAdmission],
    buildQqqEb2E44Layers().filter(layer => !['E3', 'E5', 'E31', 'E34'].includes(layer.name)),
  ).cycles;
  const eb3 = runQqqEb3E12Union(e44, replay.rawE1, buildQqqEb3FusedRules('rule2-tqqqroc05-slow-confidence')).cycles;
  const gated = applyQqqEb3QualityGate(eb3, 'exclude-unavailable-slow-subregime-high-rv');
  return { ...replay, blockedCycles, gated };
}

function buildEb7MergedRelease(
  upstream: Awaited<ReturnType<typeof buildEb7Upstream>>,
  data: MarketDataSet,
  vixLower: number,
): { cycles: QqqEb2Cycle[]; stage: QqqEb7ReleaseStage; replacementSize: number; mergedReleaseSize: number; finalVetoedSize: number } {
  const used = new Set(upstream.gated.map(day));
  const replacement = upstream.rawE1.filter(cycle => !used.has(day(cycle))
    && numberField(cycle, 'tqqqRealisedVol20d') >= .6 && numberField(cycle, 'tqqqRealisedVol20d') < .7
    && (String(context(cycle).trend) === 'BEAR'
      || (numberField(cycle, 'vix') >= 11 && numberField(cycle, 'vix') < 16 && numberField(cycle, 'adx14') >= 15)));
  const e86 = [...upstream.gated, ...replacement].sort((left, right) => day(left).localeCompare(day(right)));
  const e86Days = new Set(e86.map(day));
  const mergedRelease = upstream.blockedCycles.filter(cycle => !e86Days.has(day(cycle)) && (
    (numberField(cycle, 'vix') >= vixLower && numberField(cycle, 'priceVsSma200Pct') >= .05 && numberField(cycle, 'priceVsSma200Pct') < .08 && numberField(cycle, 'tqqqRealisedVol20d') < .7)
    || (numberField(cycle, 'range20dPct') >= 0 && numberField(cycle, 'range20dPct') < .03 && numberField(cycle, 'weakeningSignalCount') >= 1 && numberField(cycle, 'weakeningSignalCount') < 3)
    || (numberField(cycle, 'tqqqRoc20') >= .05 && numberField(cycle, 'tqqqRoc20') < .1 && numberField(cycle, 'priceVsSma200Pct') < 0)
    || (data.vxnByDate[day(cycle)] != null && data.vxnByDate[day(cycle)] >= 17.5 && data.vxnByDate[day(cycle)] < 20.5 && numberField(cycle, 'trendScore') < 25)
  ));
  const all = [...e86, ...mergedRelease].sort((left, right) => day(left).localeCompare(day(right)));
  const vetoed = all.filter(cycle => matchesQqqEb4ResearchFinalVeto(cycle, E45_FINAL_VETO));
  const postVetoCycles = all
    .filter(cycle => !(numberField(cycle, 'roc20') >= -.05 && numberField(cycle, 'roc20') < 0 && numberField(cycle, 'priceExtensionAtr') >= 2))
    .filter(cycle => !matchesQqqEb4ResearchFinalVeto(cycle, E45_FINAL_VETO));
  return {
    cycles: postVetoCycles,
    stage: { blockedCycles: upstream.blockedCycles, gatedCycles: upstream.gated, replacementCycles: replacement, mergedReleaseCycles: mergedRelease, preVetoCycles: all, finalVetoedCycles: vetoed, postVetoCycles },
    replacementSize: replacement.length,
    mergedReleaseSize: mergedRelease.length,
    finalVetoedSize: vetoed.length,
  };
}

function constructEb7Base(
  data: MarketDataSet,
  highRecovery: Awaited<ReturnType<typeof buildEb7Upstream>>,
  lowRecovery: Awaited<ReturnType<typeof buildEb7Upstream>>,
  mergedReleaseVixLower = 22.4,
): { cycles: QqqEb2Cycle[]; coreCycles: QqqEb2Cycle[]; researchPools: QqqEb7ResearchPools; diagnostics: { blockedPoolSize: number; gatedSize: number; replacementSize: number; mergedReleaseSize: number; finalVetoedSize: number } } {
  const high = buildEb7MergedRelease(highRecovery, data, mergedReleaseVixLower);
  const low = buildEb7MergedRelease(lowRecovery, data, mergedReleaseVixLower);
  const highProbe = buildEb7MergedRelease(highRecovery, data, mergedReleaseVixLower - .4);
  const lowProbe = buildEb7MergedRelease(lowRecovery, data, mergedReleaseVixLower - .4);
  const highByDay = new Map(high.cycles.map(cycle => [day(cycle), cycle]));
  const e209 = low.cycles.map(cycle => numberField(cycle, 'trendScore') >= 50 ? cycle : (highByDay.get(day(cycle)) ?? cycle));
  const highProbeByDay = new Map(highProbe.cycles.map(cycle => [day(cycle), cycle]));
  const probe22 = lowProbe.cycles.map(cycle => numberField(cycle, 'trendScore') >= 50 ? cycle : (highProbeByDay.get(day(cycle)) ?? cycle));
  const e209Days = new Set(e209.map(day));
  const e218Only = probe22.filter(cycle => !e209Days.has(day(cycle)) && numberField(cycle, 'priceVsSma200Pct') >= .05 && numberField(cycle, 'priceVsSma200Pct') < .06);
  const cycles = [...e209, ...e218Only].sort((left, right) => day(left).localeCompare(day(right)));
  const coreCycleDays = new Set(cycles.map(day));
  const e64Pool = dedupeByDay([
    ...highRecovery.rawE1,
    ...highRecovery.e1Parent,
    ...highRecovery.c4Parent,
    ...highRecovery.eb3QualityExcluded,
    ...highRecovery.eb4ResearchVetoed,
    ...high.stage.blockedCycles,
  ]).filter(cycle => !coreCycleDays.has(day(cycle)));
  const e64Stages = buildEb7E64Stages();
  let remaining = e64Pool;
  const picked: QqqEb2Cycle[][] = [];
  for (const predicate of e64Stages) {
    const selected = remaining.filter(predicate);
    const dates = new Set(selected.map(day));
    remaining = remaining.filter(cycle => !dates.has(day(cycle)));
    picked.push(selected);
  }
  const e64Cycles = [...cycles, ...picked.flat()].sort((left, right) => day(left).localeCompare(day(right)));
  const e27Cycles = buildEb7E27Cycles(cycles, highRecovery);
  const e64Keys = new Set(e64Cycles.map(cycleKey));
  const e64Days = new Set(e64Cycles.map(day));
  const rescueCycles = e27Cycles.filter(cycle => !e64Keys.has(cycleKey(cycle)) && !e64Days.has(day(cycle)));
  return {
    cycles: e64Cycles,
    coreCycles: cycles,
    researchPools: {
      highRecovery: high.stage,
      lowRecovery: low.stage,
      highProbe: highProbe.stage,
      lowProbe: lowProbe.stage,
      rawE1: highRecovery.rawE1,
      e1Parent: highRecovery.e1Parent,
      c4Parent: highRecovery.c4Parent,
      qualityExcluded: highRecovery.eb3QualityExcluded,
      researchVetoed: highRecovery.eb4ResearchVetoed,
      e209Cycles: e209,
      e218OnlyCycles: e218Only,
      e64Cycles,
      e27Cycles,
      rescueCycles,
      preE235Cycles: [],
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

function cycleKey(cycle: QqqEb2Cycle): string {
  return `${day(cycle)}|${cycle.open.date}|${cycle.close.date}|${cycle.open.symbol}|${cycle.pnl.toFixed(8)}`;
}

function buildEb7E27Cycles(coreCycles: readonly QqqEb2Cycle[], upstream: Awaited<ReturnType<typeof buildEb7Upstream>>): QqqEb2Cycle[] {
  const n = numberField;
  const s = (cycle: QqqEb2Cycle, key: string, value: string) => String(context(cycle)[key]) === value;
  const keep = (cycle: QqqEb2Cycle) => {
    const e1 = s(cycle, 'slowSubregime', 'SR01') && n(cycle, 'vix') < 14 && n(cycle, 'adx14') >= 25 && n(cycle, 'priceExtensionAtr') >= 1.18;
    const e2 = n(cycle, 'tqqqRealisedVol20d') >= .7 && n(cycle, 'range20dPct') < .06;
    const e3 = n(cycle, 'adx14') >= 15 && n(cycle, 'range20dPct') < .03 && n(cycle, 'trendScore') < 50;
    const e4 = n(cycle, 'adx14') < 10 && n(cycle, 'priceExtensionAtr') >= 3 && n(cycle, 'range20dPct') < .06;
    const e5 = n(cycle, 'vix') < 12 && n(cycle, 'adx14') >= 50 && n(cycle, 'weakeningSignalCount') >= 1;
    const e6 = n(cycle, 'tqqqRealisedVol20d') < .6 && n(cycle, 'priceExtensionAtr') >= -1 && n(cycle, 'roc20') < -.05;
    const e7 = n(cycle, 'tqqqRealisedVol20d') >= .3 && n(cycle, 'priceExtensionAtr') >= 3 && n(cycle, 'range20dPct') < .05;
    return !e1 && !e2 && !e3 && !e4 && !e5 && !e6 && !e7;
  };
  const e8 = (cycle: QqqEb2Cycle) => s(cycle, 'regime', 'RANGE_BOUND') && n(cycle, 'tqqqRealisedVol20d') >= .7;
  const e9 = (cycle: QqqEb2Cycle) => n(cycle, 'tqqqRealisedVol20d') < .6 && n(cycle, 'drawdownFromRecentHighPct') >= .08;
  const e10 = (cycle: QqqEb2Cycle) => n(cycle, 'tqqqRealisedVol20d') >= 1 && n(cycle, 'drawdownFromRecentHighPct') >= .1;
  const e11 = (cycle: QqqEb2Cycle) => n(cycle, 'vix') < 14 && n(cycle, 'range20dPct') >= .1;
  const e12 = (cycle: QqqEb2Cycle) => n(cycle, 'vix') >= 22 && n(cycle, 'tqqqRealisedVol20d') < .4;
  const e13 = (cycle: QqqEb2Cycle) => n(cycle, 'vix') >= 30 && n(cycle, 'priceVsSma200Pct') >= .1;
  const e14 = (cycle: QqqEb2Cycle) => s(cycle, 'slowSubregime', 'SR01') && n(cycle, 'vix') < 12;
  const e15 = (cycle: QqqEb2Cycle) => n(cycle, 'adx14') < 15 && n(cycle, 'priceExtensionAtr') >= 3;
  const e16 = (cycle: QqqEb2Cycle) => (s(cycle, 'regime', 'RISK_ON_EXTENDED') && n(cycle, 'tqqqRealisedVol20d') >= .7) || (n(cycle, 'roc20') < -.05 && n(cycle, 'trendScore') >= 55);
  const e17 = (cycle: QqqEb2Cycle) => s(cycle, 'regime', 'RANGE_BOUND') && n(cycle, 'drawdownFromRecentHighPct') >= .08;
  const e18 = (cycle: QqqEb2Cycle) => (s(cycle, 'regime', 'RISK_ON_EXTENDED') && n(cycle, 'drawdownFromRecentHighPct') >= .02) || (n(cycle, 'tqqqRealisedVol20d') < .4 && n(cycle, 'priceVsSma200Pct') >= .2);
  const e19 = (cycle: QqqEb2Cycle) => n(cycle, 'adx14') < 10 && n(cycle, 'priceVsSma200Pct') < 0;
  const e20 = (cycle: QqqEb2Cycle) => n(cycle, 'adx14') >= 50 && n(cycle, 'vixTermStructureSlope') >= 2.5;
  const e22 = (cycle: QqqEb2Cycle) => n(cycle, 'priceVsSma200Pct') < -.1;
  const e24 = (cycle: QqqEb2Cycle) => n(cycle, 'rsi14') >= 75 && n(cycle, 'trendScore') < 60;
  const e25 = (cycle: QqqEb2Cycle) => (n(cycle, 'vix') < 14 && n(cycle, 'tqqqRealisedVol20d') >= .6) || (n(cycle, 'tqqqRealisedVol20d') < .6 && n(cycle, 'range20dPct') >= .15);
  const e27 = (cycle: QqqEb2Cycle) => n(cycle, 'vix') < 17 && n(cycle, 'priceVsSma200Pct') < 0;
  const base = coreCycles.filter(keep);
  const baseDays = new Set(base.map(day));
  const map = new Map<string, QqqEb2Cycle>();
  const collect = (cycles: readonly QqqEb2Cycle[]) => cycles.forEach(cycle => {
    const date = day(cycle);
    if (date && !baseDays.has(date) && keep(cycle) && !map.has(date)) map.set(date, cycle);
  });
  collect(upstream.rawE1);
  collect(upstream.e1Parent);
  collect(upstream.c4Parent);
  collect(upstream.blockedCycles);
  collect(upstream.eb3QualityExcluded);
  collect(upstream.eb4ResearchVetoed);
  const used = new Set<string>();
  const take = (predicate: (cycle: QqqEb2Cycle) => boolean) => {
    const dates = new Set([...map.values()].filter(cycle => !used.has(day(cycle)) && predicate(cycle)).map(day));
    dates.forEach(date => used.add(date));
    return dates;
  };
  const prior = [e8, e9, e10, e11, e12, e13, e14, e15, e16, e17, e18, e19, e20, e22, e24, e25].map(take);
  const parent = [...base, ...prior.flatMap(dates => [...map.values()].filter(cycle => dates.has(day(cycle))))];
  return [...parent, ...[...map.values()].filter(cycle => !used.has(day(cycle)) && e27(cycle))]
    .sort((left, right) => day(left).localeCompare(day(right)));
}

function buildEb7E64Stages(): readonly ((cycle: QqqEb2Cycle) => boolean)[] {
  const n = numberField;
  const s = (cycle: QqqEb2Cycle, key: string, value: string) => String(context(cycle)[key]) === value;
  return [
    cycle => n(cycle, 'vix') >= 22 && n(cycle, 'tqqqRealisedVol20d') < .4,
    cycle => (s(cycle, 'regime', 'RISK_ON_EXTENDED') && n(cycle, 'tqqqRealisedVol20d') >= .7) || (n(cycle, 'roc20') < -.05 && n(cycle, 'trendScore') >= 55) || (s(cycle, 'regime', 'RANGE_BOUND') && n(cycle, 'drawdownFromRecentHighPct') >= .08) || (n(cycle, 'vix') < 14 && n(cycle, 'tqqqRealisedVol20d') >= .6) || (n(cycle, 'tqqqRealisedVol20d') < .6 && n(cycle, 'range20dPct') >= .15),
    cycle => n(cycle, 'priceVsSma200Pct') >= .1 && n(cycle, 'drawdownFromRecentHighPct') >= .1,
    cycle => n(cycle, 'tqqqRealisedVol20d') >= 1.2 && n(cycle, 'adx14') < 20,
    cycle => n(cycle, 'adx14') < 15 && n(cycle, 'priceExtensionAtr') >= 3,
    cycle => s(cycle, 'regime', 'RISK_ON_EXTENDED') && n(cycle, 'drawdownFromRecentHighPct') >= .02,
    cycle => n(cycle, 'tqqqRealisedVol20d') < .4 && n(cycle, 'priceVsSma200Pct') >= .2,
    cycle => n(cycle, 'tqqqRealisedVol20d') >= .8 && n(cycle, 'rsi14') >= 70,
    cycle => n(cycle, 'priceExtensionAtr') >= 1 && n(cycle, 'drawdownFromRecentHighPct') >= .1,
    cycle => n(cycle, 'tqqqRealisedVol20d') < .6 && n(cycle, 'drawdownFromRecentHighPct') >= .1,
    cycle => n(cycle, 'vix') >= 18 && n(cycle, 'range20dPct') < .03,
    cycle => n(cycle, 'vix') >= 30 && n(cycle, 'tqqqRealisedVol20d') < .6,
    cycle => n(cycle, 'roc20') >= .05 && s(cycle, 'regime', 'RISK_ON_WEAKENING'),
    cycle => n(cycle, 'priceVsSma200Pct') >= .2 && n(cycle, 'range20dPct') >= .15,
    cycle => n(cycle, 'adx14') >= 10 && n(cycle, 'priceVsSma200Pct') < -.1,
    cycle => n(cycle, 'adx14') < 10 && n(cycle, 'trendScore') < 25,
    cycle => n(cycle, 'priceVsSma200Pct') >= .2 && s(cycle, 'regime', 'RANGE_BOUND'),
    cycle => n(cycle, 'priceExtensionAtr') < 1 && n(cycle, 'roc20') >= .1,
    cycle => n(cycle, 'vix') < 12 && n(cycle, 'priceExtensionAtr') < -1,
    cycle => n(cycle, 'rsi14') >= 80 && s(cycle, 'slowSubregime', 'SR01'),
  ];
}

function dedupeByDay(cycles: readonly QqqEb2Cycle[]): QqqEb2Cycle[] {
  const seen = new Set<string>();
  const result: QqqEb2Cycle[] = [];
  for (const cycle of cycles) {
    const date = day(cycle);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    result.push(cycle);
  }
  return result;
}

function buildDynamicE235Parent(base: readonly QqqEb2Cycle[], pools: QqqEb7ResearchPools, excludedRuleIds: ReadonlySet<string> = new Set()): { cycles: QqqEb2Cycle[]; preE235Cycles: QqqEb2Cycle[] } {
  const baseDays = new Set(base.map(day));
  // E67–E116 were screened only against the E27 minus E64 rescue pool.
  // E123 onward was screened against the complete remaining upstream pool.
  let rescueRemaining = pools.rescueCycles;
  const additions: QqqEb2Cycle[] = [];
  for (const rule of EB7_PRE_E235_RULES.slice(0, 26)) {
    if (excludedRuleIds.has(rule.id)) continue;
    const picked = rescueRemaining.filter(rule.accept);
    const dates = new Set(picked.map(day));
    rescueRemaining = rescueRemaining.filter(cycle => !dates.has(day(cycle)));
    additions.push(...picked);
  }
  const rescueParentDays = new Set([...baseDays, ...additions.map(day)]);
  const all = dedupeByDay([
    ...base,
    ...pools.rawE1,
    ...pools.e1Parent,
    ...pools.c4Parent,
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
  ]).filter(cycle => !rescueParentDays.has(day(cycle)));
  let remaining = all;
  for (const rule of EB7_PRE_E235_RULES.slice(26)) {
    if (excludedRuleIds.has(rule.id)) continue;
    const picked = remaining.filter(rule.accept);
    const dates = new Set(picked.map(day));
    remaining = remaining.filter(cycle => !dates.has(day(cycle)));
    additions.push(...picked);
  }
  const preE235Cycles = [...base, ...additions].sort((left, right) => day(left).localeCompare(day(right)));
  return { cycles: preE235Cycles, preE235Cycles };
}

export function computeQqqEb7RealizedMdd(cycles: readonly QqqEb2Cycle[]): number {
  const closes = new Map<string, number>();
  for (const cycle of cycles) closes.set(cycle.close.date, (closes.get(cycle.close.date) ?? 0) + cycle.pnl);
  let realized = 0;
  let peak = 0;
  let mdd = 0;
  for (const date of [...closes.keys()].sort()) {
    realized += closes.get(date) ?? 0;
    peak = Math.max(peak, realized);
    mdd = Math.max(mdd, peak - realized);
  }
  return +mdd.toFixed(2);
}

export function summarizeQqqEb7Cycles(cycles: readonly QqqEb2Cycle[]): QqqEb7CycleSummary {
  const pnls = cycles.map(cycle => cycle.pnl);
  const sorted = [...pnls].sort((left, right) => left - right);
  const wins = pnls.filter(pnl => pnl > 0).length;
  const tailCount = Math.max(1, Math.ceil(sorted.length * .05));
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

export function computeQqqEb7MtmMdd(cycles: readonly QqqEb2Cycle[], data: MarketDataSet, startDate: string, endDate: string, config: Readonly<Record<string, unknown>> = {}): number {
  const closes = new Map<string, number>();
  for (const cycle of cycles) closes.set(cycle.close.date, (closes.get(cycle.close.date) ?? 0) + cycle.pnl);
  const pricing = {
    spreadMultiplier: typeof config.optionSpreadMultiplier === 'number' ? config.optionSpreadMultiplier : 1,
    skewSlope: typeof config.optionSkewSlope === 'number' ? config.optionSkewSlope : MOCK_OPTION_CALIBRATION.skewSlope,
    riskFreeRate: typeof config.riskFreeRate === 'number' ? config.riskFreeRate : .045,
  };
  type PreparedCycle = {
    cycle: QqqEb2Cycle;
    ordinal: number;
    openDate: string;
    closeDate: string;
    expiry: string;
    shortStrike: number;
    longStrike: number;
    markMultiplier: number;
  };
  // MTM is a chronological mark-to-market pass. Keep only cycles that can be
  // open on the current bar instead of scanning the complete cycle universe
  // for every bar. The ordinal preserves the historical summation order even
  // when a caller supplies cycles that share an open date.
  const prepared = cycles.flatMap((cycle, ordinal): PreparedCycle[] => {
    const match = cycle.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
    if (!match || !cycle.open.expiry) return [];
    return [{
      cycle,
      ordinal,
      openDate: cycle.open.date ?? '',
      closeDate: cycle.close.date ?? '',
      expiry: cycle.open.expiry,
      shortStrike: Number(match[2]),
      longStrike: Number(match[1]),
      markMultiplier: config.applyRiskMultiplierToMtm === true
        && typeof cycle.open.riskMultiplier === 'number'
        && Number.isFinite(cycle.open.riskMultiplier)
        ? cycle.open.riskMultiplier
        : 1,
    }];
  }).sort((left, right) => left.openDate.localeCompare(right.openDate) || left.ordinal - right.ordinal);
  let realized = 0;
  let peak = 0;
  let mdd = 0;
  const active: PreparedCycle[] = [];
  let nextPending = 0;
  const insertByOrdinal = (entry: PreparedCycle) => {
    let low = 0;
    let high = active.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (active[middle]!.ordinal < entry.ordinal) low = middle + 1;
      else high = middle;
    }
    active.splice(low, 0, entry);
  };
  for (const bar of data.qqqBars) {
    if (bar.date < startDate) continue;
    if (bar.date > endDate) break;
    realized += closes.get(bar.date) ?? 0;
    // Closing/settling on this bar is excluded from unrealized MTM, matching
    // the original `(close.date ?? '') <= bar.date` condition.
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index]!.closeDate <= bar.date) active.splice(index, 1);
    }
    while (nextPending < prepared.length && prepared[nextPending]!.openDate <= bar.date) {
      const entry = prepared[nextPending++]!;
      if (entry.closeDate > bar.date) insertByOrdinal(entry);
    }
    let unrealized = 0;
    const rawVol = data.vxnByDate[bar.date] ?? data.vixByDate[bar.date] ?? 20;
    const vol = normalizeVolIndexForMockOptions(rawVol, 'VXN');
    const rawVol3m = data.vix3mByDate[bar.date];
    const vol3m = rawVol3m != null && rawVol > 0 ? rawVol3m * (vol / rawVol) : undefined;
    const market = createLegacyOptionMarket({ asOfDate: bar.date, prices: { QQQ: bar.close }, vix: vol, vix3m: vol3m });
    for (const preparedCycle of active) {
      const { cycle, expiry, shortStrike, longStrike, markMultiplier } = preparedCycle;
      unrealized += closeOptionPosition({
        openingCashImpact: cycle.open.cashImpact,
        legs: [
          { symbol: 'QQQ', type: 'put', side: 'short', strike: shortStrike, expiry, quantity: cycle.open.quantity },
          { symbol: 'QQQ', type: 'put', side: 'long', strike: longStrike, expiry, quantity: cycle.open.quantity },
        ],
      }, market, pricing).pnl * markMultiplier;
    }
    const nav = realized + unrealized;
    peak = Math.max(peak, nav);
    mdd = Math.max(mdd, peak - nav);
  }
  return +mdd.toFixed(2);
}

export async function buildQqqEb7DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb7DynamicReplayOptions = {}): Promise<QqqEb7DynamicReplay> {
  const resolvedEndDate = resolveEndDate(startDate, endDate, data);
  const ownedSession = options.execution ? undefined : sharedReplaySession(startDate, resolvedEndDate, data);
  const baseExecution = options.execution ?? (ownedSession ? executionFromQqqCompositeReplaySession(ownedSession) : undefined);
  const execution = baseExecution && options.profiler
    ? {
      ...baseExecution,
      phaseProfiler: {
        record: (phase: string, milliseconds: number) => options.profiler!.record(`EB7 phase ${phase}`, milliseconds),
      },
    }
    : baseExecution;
  let canonicalTapeEntriesGenerated = 0;
  const replayOptions = execution
    ? { ...options, execution: { ...execution, onCanonicalOptionSignalTapeGenerated: () => { canonicalTapeEntriesGenerated += 1; } } }
    : options;
  const highRiskMinDays = options.highRiskMinDays ?? QQQ_EB7_CANDIDATE.contract.dteMinHighRiskDays;
  const lowRiskMinDays = options.lowRiskMinDays ?? 2;
  const mergedReleaseVixLower = options.mergedReleaseVixLower ?? 22.4;
  const timed = async <T>(stage: string, task: () => Promise<T>): Promise<T> => {
    if (!options.profiler) return task();
    const started = Date.now();
    const result = await task();
    options.profiler.record(stage, Date.now() - started);
    return result;
  };
  const [highRecovery, lowRecovery] = await Promise.all([
    timed('EB7 high recovery', () => buildEb7Upstream(data, startDate, resolvedEndDate, highRiskMinDays, replayOptions, options.highRecoveryTrace ?? true, options.intermediateRecoveryTrace ?? false, options.intermediateRecoveryTrace ?? false)),
    timed('EB7 low recovery', () => buildEb7Upstream(data, startDate, resolvedEndDate, lowRiskMinDays, replayOptions, options.lowRecoveryTrace ?? false, options.intermediateRecoveryTrace ?? false, options.intermediateRecoveryTrace ?? false)),
  ]);
  if ((options.canonicalOptionSignalTapeMode ?? 'skip') === 'skip' && canonicalTapeEntriesGenerated > 0) {
    throw new Error('EB7 current-bar replay unexpectedly generated a canonical option signal tape');
  }
  const constructStarted = options.profiler ? Date.now() : 0;
  const constructed = constructEb7Base(data, highRecovery, lowRecovery, mergedReleaseVixLower);
  if (options.profiler) options.profiler.record('EB7 construct base', Date.now() - constructStarted);
  const sourcePools: QqqEb7ResearchPools = { ...constructed.researchPools };
  const parentStarted = options.profiler ? Date.now() : 0;
  const excludedPreE235RuleIds = [...new Set(options.excludedPreE235RuleIds ?? [])].sort();
  const parent = buildDynamicE235Parent(constructed.cycles, sourcePools, new Set(excludedPreE235RuleIds));
  if (options.profiler) options.profiler.record('EB7 E235 parent', Date.now() - parentStarted);
  sourcePools.preE235Cycles = parent.preE235Cycles;
  const parentDays = new Set(parent.cycles.map(day));
  const e235Pool = dedupeByDay([
    ...highRecovery.rawE1,
    ...highRecovery.e1Parent,
    ...highRecovery.c4Parent,
    ...highRecovery.eb3QualityExcluded,
    ...highRecovery.eb4ResearchVetoed,
    ...constructed.researchPools.highRecovery.blockedCycles,
    ...constructed.researchPools.highRecovery.gatedCycles,
    ...constructed.researchPools.highRecovery.replacementCycles,
    ...constructed.researchPools.highRecovery.mergedReleaseCycles,
    ...constructed.researchPools.highRecovery.finalVetoedCycles,
    ...constructed.researchPools.lowRecovery.blockedCycles,
    ...constructed.researchPools.lowRecovery.gatedCycles,
    ...constructed.researchPools.lowRecovery.replacementCycles,
    ...constructed.researchPools.lowRecovery.mergedReleaseCycles,
    ...constructed.researchPools.lowRecovery.finalVetoedCycles,
    ...constructed.researchPools.e218OnlyCycles,
  ]).filter(cycle => !parentDays.has(day(cycle)));
  const e235Cycles = e235Pool.filter(admitsEb7E235);
  const cycles = [...parent.cycles, ...e235Cycles].sort((left, right) => day(left).localeCompare(day(right)));
  const metricsStarted = options.profiler ? Date.now() : 0;
  const summary = summarizeQqqEb7Cycles(cycles);
  const settledCycleCount = cycles.filter(cycle => cycle.close.action === 'SETTLE' || cycle.close.action === 'CLOSE').length;
  const realizedMdd = computeQqqEb7RealizedMdd(cycles);
  const mtmMdd = computeQqqEb7MtmMdd(cycles, data, startDate, resolvedEndDate);
  if (options.profiler) options.profiler.record('EB7 metrics and MTM', Date.now() - metricsStarted);
  return {
    candidateId: QQQ_EB7_CANDIDATE.id,
    replayVersion: QQQ_EB7_REPLAY_VERSION,
    dataFingerprint: data.fingerprint,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    resolvedEndDate,
    upstream: highRecovery,
    cycles,
    metrics: {
      ...summary,
      realizedMdd,
      mtmMdd,
    },
    researchPools: sourcePools,
    audit: {
      admission: 'current-bar',
      source: 'MarketDataSet',
      chronologicalReplay: true,
      settlementStateUpdates: true,
      settledCycleCount,
      e64StageCount: 20,
      preE235RuleCount: EB7_PRE_E235_RULES.length,
      excludedPreE235RuleIds,
      e235BranchCount: EB7_E235_BRANCHES.length,
      e235ConditionCount: EB7_E235_CONDITION_COUNT,
      e235StructuralForm: 'score>=1',
      baseCycleCount: constructed.coreCycles.length,
      e64CycleCount: constructed.cycles.length,
      preE235CycleCount: parent.preE235Cycles.length,
      e235AdditionCount: e235Cycles.length,
      independentFromEb6Builder: true,
      independentCycleSet: cycles.some(cycle => scoreEb7E235(cycle) > 0),
      canonicalOptionSignalTapeMode: options.canonicalOptionSignalTapeMode ?? 'skip',
      canonicalTapeEntriesGenerated,
      noFrozenTape: true,
    },
  };
}
