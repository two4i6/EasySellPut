import {
  buildQqqPcsHistoricalBacktestSpec,
  buildQqqPcsReplayDailySignalHistory,
  type QqqPcsReplayDailySignal,
} from './QqqPcsHistoricalBacktest';
import { computeRollingAdmission, computeScreenAdmission } from './QqqE1DynamicAdmission';
import { matchesQqqC4CurrentBarReAdmission } from './QqqC4CurrentBarRules';
export { matchesQqqC4CurrentBarReAdmission } from './QqqC4CurrentBarRules';
import { buildQqqE1P0R2EbSpec } from './QqqE1P0R2Replay';
import { buildQqqEb2E44Layers, runQqqEb2E44Fused, runQqqEb2E44Union, type QqqEb2Cycle } from './QqqEb2E44Fused';
import { ACTIVE_QQQ_EB2_CANDIDATE, ACTIVE_QQQ_EB3_CANDIDATE, QQQ_EB3_CANDIDATES, type QqqEb3CandidateDefinition } from './QqqEb2CandidateRegistry';
import { applyQqqEb3QualityGate, applyQqqEb3ReplacementRule, buildQqqEb3E12FullRules, buildQqqEb3FusedRules, runQqqEb3E12, runQqqEb3E12Union } from './QqqEb3E12';
import { buildQqqReplayDailySnapshots } from './QqqReplaySnapshot';
import type { QqqReplayDailySnapshot } from './QqqReplaySnapshot';
import { loadRunData, runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec, type BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { BacktestResult, BacktestTraceEntry, OptionCycleDebug, TradeEntry } from '../leveraged-overlay/backtest/types';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession, type QqqCompositeReplayExecution, type QqqEb2AdmissionCacheEntry } from './QqqCompositeReplaySession';

export const QQQ_EB2_P2_R5_REPLAY_VARIANT = 'eb2_p2_r5' as const;
export const QQQ_EB2_P2_R5_REPLAY_VERSION = `eb2-p2-r5-${ACTIVE_QQQ_EB2_CANDIDATE.version}` as const;
export const QQQ_EB2_P2_R5_REPLAY_LABEL = `线上：${ACTIVE_QQQ_EB2_CANDIDATE.label} + P2（P1.E29 survival=.80） + R5` as const;

export type QqqEb2P2R5LayerId = 'EB2' | 'P2' | 'R5';
export type QqqEb2P2R5LayerStatus = 'ACCEPTED' | 'PREEMPTED' | 'BLOCKED' | 'UNAVAILABLE' | 'NO_CANDIDATE';
export type QqqEb2P2R5LayerRecord = {
  layer: QqqEb2P2R5LayerId;
  status: QqqEb2P2R5LayerStatus;
  signal: QqqPcsReplayDailySignal | null;
  accepted: boolean;
  reasons: string[];
};
export type QqqEb2P2R5DailyRecord = {
  date: string;
  layers: Record<QqqEb2P2R5LayerId, QqqEb2P2R5LayerRecord>;
  acceptedLayer: QqqEb2P2R5LayerId | null;
  priorityDecision: string;
};

export type QqqEb2P2R5SharedBreakdown = {
  byLayer: Record<QqqEb2P2R5LayerId, { n: number; pnl: number; wins: number }>;
  acceptedDays: number;
  daily: QqqEb2P2R5DailyRecord[];
};

export type QqqEb2P2R5ReplayResult = BacktestResult & {
  dataFingerprint: string;
  pcsDailySignalHistory: QqqPcsReplayDailySignal[];
  pcsDailyReplaySnapshots: QqqReplayDailySnapshot[];
  qqqEb2P2R5: QqqEb2P2R5SharedBreakdown;
};

type Result = V2BacktestResult & { debug?: { optionCycles?: OptionCycleDebug[]; trace?: BacktestTraceEntry[] } };
type Cycle = { open: TradeEntry; close: TradeEntry; pnl: number };
type LayerRow = { date: string; cycle: Cycle; layer: QqqEb2P2R5LayerId };

const INITIAL_NAV = 100_000;
const EB_TAG = 'QQQ_EQUITY_BOOST_PUT_SPREAD';
const PCS_TAG = 'QQQ_PUT_CREDIT_SPREAD';
const R5_TAG = 'QQQ_PCS_RESCUE';
const day = (value: string | undefined) => (value ?? '').slice(0, 10);

function pairCycles(result: V2BacktestResult, tag: string): Cycle[] {
  const queues = new Map<string, TradeEntry[]>();
  const cycles: Cycle[] = [];
  for (const trade of result.tradeLog) {
    if (trade.strategyTag !== tag) continue;
    const key = `${trade.symbol}|${trade.expiry ?? ''}`;
    if (trade.action === 'OPEN') {
      const queue = queues.get(key) ?? [];
      queue.push(trade);
      queues.set(key, queue);
      continue;
    }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    if (!Number.isFinite(trade.pnl)) continue;
    const open = queues.get(key)?.shift();
    if (open) cycles.push({ open, close: trade, pnl: trade.pnl! });
  }
  return cycles.sort((left, right) => day(left.open.signalDate ?? left.open.date).localeCompare(day(right.open.signalDate ?? right.open.date)));
}

function rows(result: V2BacktestResult, layer: QqqEb2P2R5LayerId, tag: string): LayerRow[] {
  return pairCycles(result, tag).map((cycle) => ({ date: day(cycle.open.signalDate ?? cycle.open.date), cycle, layer }));
}

function cycleContext(cycle: Cycle): Record<string, unknown> {
  return (cycle.open.marketContext ?? {}) as Record<string, unknown>;
}

function cycleWidth(cycle: Cycle) {
  const match = cycle.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return match ? Number(match[2]) - Number(match[1]) : Number.NaN;
}

/**
 * Re-expresses the C4 parent as current-bar predicates. It intentionally
 * returns a projection of the raw C4 cycles instead of passing a generated
 * date block back into the engine as a whitelist.
 */
export type QqqEb2DynamicParentOptions = {
  /** Research-only reference repair; never promoted by default. */
  referenceCooldownMode?: 'settlement_feedback_v1';
  /** Composite replay session resources; never contains strategy state. */
  execution?: QqqCompositeReplayExecution;
  /** Research-only: omit per-day trace allocation when the caller only needs cycles. */
  trace?: boolean;
  /** Research-only: trace controls for the two intermediate EB2 arms. */
  rawE1Trace?: boolean;
  e1Trace?: boolean;
  /** Research-only switch used to isolate the legacy C4 parent semantics. */
  includeRescue5Lite?: boolean;
  /** Research-only: independently replay the two inherited parent windows. */
  e1AdmissionStartDate?: string;
  c4AdmissionStartDate?: string;
  /** Data-relative readiness requirement; never a fixed strategy date. */
  e1WarmupFullCalendarYears?: number;
  /** Data-relative canonical option-signal warm-up; never a date whitelist. */
  canonicalOptionSignalStartDate?: string;
  /** Composite-only optimization; omitted preserves the independent arm baseline. */
  canonicalOptionSignalTapeShared?: boolean;
  /** Research replay mode; omitted preserves existing executable-run defaults. */
  canonicalOptionSignalTapeMode?: 'required' | 'skip' | 'legacy';
  /** Research-only C4 admission ablation; names are dynamic screen layers, never dates. */
  c4ExcludedAdmissionLayers?: readonly string[];
  e44ExcludedLayers?: readonly string[];
  e44Mode?: 'layered' | 'fused';
  c4ReAdmissionRule?: 'weakening-1-2-and-trendscore-0-25' | 'weakening-under-2-and-trendscore-0-25' | 'adx-low-trend-low-or-er-high-adx-mid' | 'e36-plus-adx-low-trend-low-or-er-high-adx-mid' | 'e42-plus-adx-mid-current-or-navdd-roc-or-roc5-rsi' | 'e47-plus-f10-four-branch-union' | 'e53-plus-shared-volatility-rsi-adx' | 'e56-plus-adx-lowvol-weakening';
  /** Research-only execution neighborhood; omitted values preserve EB2.D0. */
  executionOverrides?: {
    equityBoostEntryMode?: 'continuous' | 'post_pullback' | 'melt_up' | 'post_pullback_or';
    equityBoostDteMode?: 'fixed' | 'risk_adaptive_v1' | 'risk_adaptive_hysteresis_v1' | 'state_adaptive_sr01_v1' | 'state_adaptive_bad_sr01_v1' | 'price_adaptive_v1';
    equityBoostTargetDte?: 28 | 35 | 42;
    equityBoostWidthMode?: 'fixed' | 'fixed_target_v1' | 'risk_adaptive_v1' | 'price_adaptive_v1';
    equityBoostDynamicWidthLowVxnTargetPct?: number;
    equityBoostDynamicWidthHighVxnTargetPct?: number;
    equityBoostDynamicDteVxnThreshold?: number;
    equityBoostDynamicDteRecoveryVxnThreshold?: number;
    equityBoostDynamicDteMinHighRiskDays?: number;
    equityBoostDynamicDtePriceThresholdPct?: number;
    equityBoostDynamicWidthVxnThreshold?: number;
    equityBoostDynamicWidthPriceThresholdPct?: number;
    equityBoostDynamicWidthLowPriceTargetPct?: number;
    equityBoostProfitTarget?: 0.225 | 0.5 | 0.75;
    equityBoostProfitTargetMode?: 'fixed' | 'entry_price_adaptive_v1' | 'entry_bad_sr01_adaptive_v1';
    equityBoostProfitTargetPriceThresholdPct?: number;
    /** Research-only global portfolio risk budget/severity knobs. */
    equityBoostMaxRiskNav?: number;
    equityBoostBass221SeverityMultiplier?: number;
    equityBoostMacroRiskMode?: 'risk_on_weakening_neutral_stale_v1' | 'macro_tilt_v1' | 'macro_safe_cluster_tilt_v1' | 'macro_bull_lowvix_cluster_tilt_v1' | 'macro_bull_lowvix_weakening_tilt_v1' | 'macro_bull_lowvix_neutral_tilt_v1' | 'macro_bull_lowvix_weakening_neutral_tilt_v1' | 'macro_bull_weakening_neutral_tilt_v1' | 'macro_bull_weakening_range_neutral_tilt_v1' | 'macro_bull_weakening_range_all_tilt_v1' | 'macro_bull_weakening_all_range_neutral_tilt_v1' | 'macro_bull_weakening_range_neutral_sideways_defensive_tilt_v1' | 'macro_bull_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_weakening_range_neutral_bear_defensive_tilt_v1' | 'macro_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_neutral_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_neutral_weakening_range_neutral_bear_sr01_split_budget_v1';
    equityBoostMacroRiskMultiplier?: number;
    equityBoostMacroRiskUpMultiplier?: number;
    equityBoostMacroRiskDownMultiplier?: number;
    equityBoostMacroRiskRangeMultiplier?: number;
    equityBoostMacroRiskVixLowMultiplier?: number;
    equityBoostMacroRiskVixMidMultiplier?: number;
    equityBoostMacroRiskVixHighMultiplier?: number;
    equityBoostRatioSelectionTarget?: number;
    equityBoostLegSelectionPriority?: 'width_first' | 'ratio_first';
    equityBoostRatioSelectionTargetMode?: 'fixed' | 'price_adaptive_v1' | 'rv_adaptive_v1' | 'state_adaptive_v1';
    equityBoostRatioSelectionPriceThresholdPct?: number;
    equityBoostRatioSelectionLowPriceTarget?: number;
    equityBoostRatioSelectionRv20Threshold?: number;
    equityBoostRatioSelectionHighRvTarget?: number;
    equityBoostRatioSelectionStateTargetStates?: readonly string[];
    equityBoostRatioSelectionStateTarget?: number;
    equityBoostRatioMin?: number;
    equityBoostRatioMax?: number;
    e1WarmupFullCalendarYears?: number;
  };
};

/** Research-only EB4 final-cycle veto; omitted in all active/default replays. */
export type QqqEb4ResearchFinalVetoBounds = {
  navDrawdownPct: readonly [number, number];
  slowSubregimePosterior: readonly [number, number];
  priceExtensionAtr: readonly [number, number];
};

export type QqqEb4ResearchFinalVetoCondition =
  | { key: string; range: readonly [number, number] }
  | { key: string; equals: string };
export type QqqEb4ResearchFinalVetoSpec = { allOf: readonly QqqEb4ResearchFinalVetoCondition[] };
type QqqEb4ResearchFinalVeto = QqqEb4ResearchFinalVetoBounds | QqqEb4ResearchFinalVetoSpec;

export function matchesQqqEb4ResearchFinalVeto(cycle: Cycle, bounds: QqqEb4ResearchFinalVeto): boolean {
  const market = cycleContext(cycle);
  const inRange = (key: string, range: readonly [number, number]) => {
    const value = Number(market[key]);
    return value >= range[0] && value < range[1];
  };
  if ('allOf' in bounds) return bounds.allOf.every((condition) => 'range' in condition ? inRange(condition.key, condition.range) : String(market[condition.key] ?? '') === condition.equals);
  return inRange('navDrawdownPct', bounds.navDrawdownPct)
    && inRange('slowSubregimePosterior', bounds.slowSubregimePosterior)
    && inRange('priceExtensionAtr', bounds.priceExtensionAtr);
}

export function resolveQqqEb2ParentWindows(data: MarketDataSet, startDate: string, options: QqqEb2DynamicParentOptions = {}) {
  const firstTqqqDate = day(data.tqqqBars[0]?.date);
  if (!firstTqqqDate) throw new Error('EB2 requires TQQQ history to establish its E1 warm-up');
  const warmupYears = options.e1WarmupFullCalendarYears ?? 0;
  const warmupStart = warmupYears > 0 ? `${Number(firstTqqqDate.slice(0, 4)) + warmupYears}-01-01` : startDate;
  return {
    e1AdmissionStartDate: options.e1AdmissionStartDate ?? (warmupStart > startDate ? warmupStart : startDate),
    c4AdmissionStartDate: options.c4AdmissionStartDate ?? startDate,
  };
}

type C4ReAdmissionRule = Exclude<QqqEb2DynamicParentOptions['c4ReAdmissionRule'], undefined>;

/** Pure current-bar C4 re-admission predicates shared by all registered EB3 children. */
function matchesC4ReAdmissionRule(cycle: Cycle, rule: C4ReAdmissionRule): boolean {
  return matchesQqqC4CurrentBarReAdmission(cycleContext(cycle), rule);
}

function selectC4ReAdmissions(raw: readonly Cycle[], allowed: ReadonlySet<string>, rule: C4ReAdmissionRule | undefined): Cycle[] {
  if (!rule) return [];
  return raw.filter((cycle) => !allowed.has(day(cycle.open.signalDate ?? cycle.open.date)) && matchesC4ReAdmissionRule(cycle, rule));
}

function dynamicC4Allowed(raw: readonly Cycle[], screen: any, options: QqqEb2DynamicParentOptions = {}): ReadonlySet<string> {
  const rawDates = new Set(raw.map((cycle) => day(cycle.open.signalDate ?? cycle.open.date)));
  const e0Dates = new Set<string>((screen.rescue5Lite?.rows ?? []).map((row: { date: string }) => row.date));
  const guard = new Set(raw
    .filter((cycle) => e0Dates.has(day(cycle.open.signalDate ?? cycle.open.date))
      && Number(cycleContext(cycle).roc5) >= .034
      && Number(cycleContext(cycle).adx14) < 10)
    .map((cycle) => day(cycle.open.signalDate ?? cycle.open.date)));
  const excludedLayers = new Set(options.c4ExcludedAdmissionLayers ?? []);
  const parentLayers = ['post', 'acceptedR1', 'acceptedSR02', 'acceptedSR01', 'acceptedExtra', 'wideRounded', 'rescueBull', 'rescueRange', ...(options.includeRescue5Lite === false ? [] : ['rescue5Lite'])]
    .filter((layer) => !excludedLayers.has(layer));
  const allowed = new Set(parentLayers
    .flatMap((layer) => screen.e0LayerDates?.[layer] ?? [])
    .filter((date: string) => e0Dates.has(date) && !guard.has(date) && rawDates.has(date)));
  const weak = (cycle: Cycle) => cycleContext(cycle).regime === 'RISK_ON_WEAKENING'
    && cycleContext(cycle).slowSubregime === 'SR01'
    && cycleWidth(cycle) >= 20
    && Number(cycleContext(cycle).vix) >= 16
    && Number(cycleContext(cycle).vix) < 19
    && Number(cycleContext(cycle).drawdownFromRecentHighPct) >= .05
    && Number(cycleContext(cycle).vixChange5d) < .05;
  const bull = (cycle: Cycle) => cycleContext(cycle).regime === 'BULL'
    && cycleContext(cycle).slowSubregime === 'SR02'
    && cycleWidth(cycle) >= 25
    && Number(cycleContext(cycle).vix) < 16
    && Number(cycleContext(cycle).vixChange5d) <= -.01
    && Number(cycleContext(cycle).priceVsSma200Pct) < .11
    && Number(cycleContext(cycle).priceExtensionAtr) < 2;
  for (const cycle of raw) {
    const date = day(cycle.open.signalDate ?? cycle.open.date);
    if (!allowed.has(date) && (weak(cycle) || bull(cycle))) allowed.add(date);
  }
  return allowed;
}

export type DynamicEb2Replay = {
  raw: Result;
  rows: LayerRow[];
  /** Complete dynamic E1 parent before E44/C4 fusion; research diagnostics only. */
  e1Parent: readonly QqqEb2Cycle[];
  /** Complete E1 execution universe used by the historical EB3 E1–E12 chain. */
  rawE1: readonly QqqEb2Cycle[];
  /** Candidate C4 parent before E44 releases; exposed for research parity only. */
  c4Parent: readonly QqqEb2Cycle[];
  e44ReleasedByLayer: ReturnType<typeof runQqqEb2E44Fused>['releasedByLayer'];
  blocked: ReadonlySet<string>;
  audit: ReturnType<typeof runQqqEb2E44Fused>['audit'];
};

/**
 * Shared EB2 execution seam.  Research must call this function rather than
 * rebuilding E1/C4 or materialising historical admission dates in a script.
 */
export async function buildQqqEb2DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb2DynamicParentOptions = {}): Promise<DynamicEb2Replay> {
  const candidate = ACTIVE_QQQ_EB2_CANDIDATE;
  if (candidate.admission.e1 !== 'rolling-screen-rescue5-lite'
    || candidate.admission.c4 !== 'dynamic-c4-v1'
    || candidate.admission.releaseLayers !== 'e44-fused-v1') {
    throw new Error(`Unsupported active EB2 candidate definition: ${candidate.id}`);
  }
  const windows = resolveQqqEb2ParentWindows(data, startDate, options);
  const legacyCanonicalTape = options.canonicalOptionSignalTapeMode === 'legacy';
  const admissionTapeMode: 'required' | 'skip' = legacyCanonicalTape
    ? 'required'
    : options.canonicalOptionSignalTapeMode === 'required' ? 'required' : 'skip';
  const admissionCacheKey = JSON.stringify({
    dataFingerprint: data.fingerprint,
    endDate,
    dataSource: 'live',
    e1AdmissionStartDate: windows.e1AdmissionStartDate,
    c4AdmissionStartDate: windows.c4AdmissionStartDate,
    e1WarmupFullCalendarYears: options.e1WarmupFullCalendarYears ?? 0,
    canonicalOptionSignalTapeMode: admissionTapeMode,
    referenceCooldownMode: options.referenceCooldownMode ?? 'legacy',
  });
  let admission = options.execution?.eb2AdmissionCache?.get(admissionCacheKey) as QqqEb2AdmissionCacheEntry | undefined;
  if (!admission) {
    const rolling = computeRollingAdmission(data, { endDate, dataSource: 'live', canonicalOptionSignalTapeMode: admissionTapeMode, referenceCooldownMode: options.referenceCooldownMode });
    admission = {
      rolling,
      e1Screen: computeScreenAdmission(data, rolling, { startDate: windows.e1AdmissionStartDate, endDate, dataSource: 'live', canonicalOptionSignalTapeMode: admissionTapeMode }),
      c4Screen: computeScreenAdmission(data, rolling, { startDate: windows.c4AdmissionStartDate, endDate, dataSource: 'live', canonicalOptionSignalTapeMode: admissionTapeMode }),
    };
    options.execution?.eb2AdmissionCache?.set(admissionCacheKey, admission);
  }
  const { rolling, e1Screen, c4Screen } = admission;
  const e1Dates = new Set<string>((e1Screen.rescue5Lite?.rows ?? []).map((row: { date: string }) => row.date));
  const executionOverrides = options.executionOverrides ?? {};
  const trace = options.trace ?? true;
  const withTrace = <T extends BacktestRunSpec>(spec: T, enabled: boolean, admissionDiagnostics = false): T => ({
    ...spec,
    config: { ...spec.config, trace: enabled, admissionDiagnostics },
  });
  const liveParentSpec = withTrace(liveSpec(startDate, endDate, 'eb2'), trace, !trace);
  const parentSpec = {
    ...liveParentSpec,
    scenarioOptions: {
      ...liveParentSpec.scenarioOptions,
      ...(options.canonicalOptionSignalStartDate ? { canonicalOptionSignalStartDate: options.canonicalOptionSignalStartDate } : {}),
      ...(options.canonicalOptionSignalTapeShared ? { canonicalOptionSignalTapeShared: true } : {}),
      ...(options.canonicalOptionSignalTapeMode && !legacyCanonicalTape ? { canonicalOptionSignalTapeMode: options.canonicalOptionSignalTapeMode } : {}),
    },
    strategyOverrides: { ...liveParentSpec.strategyOverrides, ...executionOverrides },
  };
  const rawE1BaseSpec = withTrace(eb3RawE1Spec(startDate, endDate), options.rawE1Trace ?? options.e1Trace ?? trace);
  const rawE1Result = runWithData({
    ...rawE1BaseSpec,
    ...(options.canonicalOptionSignalTapeMode && !legacyCanonicalTape ? { scenarioOptions: { ...rawE1BaseSpec.scenarioOptions, canonicalOptionSignalTapeMode: options.canonicalOptionSignalTapeMode } } : {}),
    strategyOverrides: { ...rawE1BaseSpec.strategyOverrides, ...executionOverrides },
  } as BacktestRunSpec, data, undefined, options.execution) as Result;
  const e1Result = runWithData({
    ...parentSpec,
    scenarioOptions: { ...parentSpec.scenarioOptions, canonicalOptionSignalTapeMode: legacyCanonicalTape ? 'skip' : admissionTapeMode },
    config: {
      ...parentSpec.config,
      trace: options.e1Trace ?? trace,
      includeTerminalMarkOnly: true,
      equityBoostEntryGate: ({ date }: { date: string }) => !e1Dates.has(date),
    },
  } as BacktestRunSpec, data, undefined, options.execution) as Result;
  // Keep C4 un-gated. Its parent is selected by dynamicC4Allowed below.
  const c4Result = runWithData(parentSpec as BacktestRunSpec, data, undefined, options.execution) as Result;
  const e1Cycles = pairCycles(e1Result, EB_TAG);
  const rawE1Cycles = pairCycles(rawE1Result, EB_TAG);
  const c4Cycles = pairCycles(c4Result, EB_TAG);
  const allowed = dynamicC4Allowed(c4Cycles, c4Screen, options);
  const c4Parent = c4Cycles.filter((cycle) => allowed.has(day(cycle.open.signalDate ?? cycle.open.date)));
  const c4ReAdmissions = selectC4ReAdmissions(c4Cycles, allowed, options.c4ReAdmissionRule);
  const effectiveC4Parent = [...c4Parent, ...c4ReAdmissions];
  const e44Layers = buildQqqEb2E44Layers().filter((layer) => !(options.e44ExcludedLayers ?? []).includes(layer.name));
  const fused = options.e44Mode === 'fused'
    ? runQqqEb2E44Union(e1Cycles as QqqEb2Cycle[], effectiveC4Parent as QqqEb2Cycle[], e44Layers)
    : runQqqEb2E44Fused(e1Cycles as QqqEb2Cycle[], effectiveC4Parent as QqqEb2Cycle[], e44Layers);
  const acceptedDates = new Set(fused.cycles.map((cycle) => day(cycle.open.signalDate ?? cycle.open.date)));
  return {
    raw: c4Result,
    rows: fused.cycles.map((cycle) => ({ date: day(cycle.open.signalDate ?? cycle.open.date), cycle, layer: 'EB2' })),
    e1Parent: e1Cycles,
    rawE1: rawE1Cycles,
    c4Parent: effectiveC4Parent,
    e44ReleasedByLayer: fused.releasedByLayer,
    blocked: new Set(c4Cycles
      .map((cycle) => day(cycle.open.signalDate ?? cycle.open.date))
      .filter((date) => !acceptedDates.has(date))),
    audit: fused.audit,
  };
}

/** The active online EB2 proxy always uses its registered default parent. */
export async function buildActiveQqqEb2ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb2DynamicParentOptions = {}): Promise<DynamicEb2Replay> {
  return buildQqqEb2DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    includeRescue5Lite: options.includeRescue5Lite ?? ACTIVE_QQQ_EB2_CANDIDATE.admission.includeRescue5Lite,
    e1WarmupFullCalendarYears: options.e1WarmupFullCalendarYears ?? ACTIVE_QQQ_EB2_CANDIDATE.admission.e1WarmupFullCalendarYears,
  });
}

/**
 * Online EB2 layer seam.  The composite coordinator calls this exact function;
 * research callers use the same seam instead of rebuilding a parallel ledger.
 */
export async function buildQqqEb2OnlineLayerWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb2DynamicParentOptions = {}): Promise<DynamicEb2Replay> {
  return buildActiveQqqEb2ReplayWithData(startDate, endDate, data, options);
}

export type DynamicEb3Replay = DynamicEb2Replay & {
  rows: LayerRow[];
  eb2Rows: readonly LayerRow[];
  eb3Release: readonly QqqEb2Cycle[];
  eb3ReleasedByRule: ReturnType<typeof runQqqEb3E12>['releasedByRule'];
  eb3QualityExcluded: readonly QqqEb2Cycle[];
  eb4ResearchVetoed: readonly QqqEb2Cycle[];
};

/**
 * Registered EB3 candidate seam. The optional id makes research replay the
 * same rule bundle it records, while the default remains the active D0
 * baseline. The composite coordinator does not use this seam until promotion.
 */
export async function buildQqqEb3OnlineLayerWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  candidateId: keyof typeof QQQ_EB3_CANDIDATES = ACTIVE_QQQ_EB3_CANDIDATE.id,
  executionOverrides?: QqqEb2DynamicParentOptions['executionOverrides'],
  researchFinalVeto?: QqqEb4ResearchFinalVeto,
  execution?: QqqCompositeReplayExecution,
  trace?: boolean,
  rawE1Trace?: boolean,
  e1Trace?: boolean,
  canonicalOptionSignalStartDate?: string,
  canonicalOptionSignalTapeShared?: boolean,
  canonicalOptionSignalTapeMode?: 'required' | 'skip' | 'legacy',
  referenceCooldownMode?: 'settlement_feedback_v1',
): Promise<DynamicEb3Replay> {
  const candidate = QQQ_EB3_CANDIDATES[candidateId];
  if (!['EB2.D0', 'EB3.D0', 'EB3.E1', 'EB3.E2', 'EB3.E10', 'EB3.E12', 'EB3.E13', 'EB3.E14', 'EB3.E18', 'EB3.E29', 'EB3.E32', 'EB3.E34', 'EB3.E36', 'EB3.E42', 'EB3.E47', 'EB3.E53', 'EB3.E56'].includes(candidate.parent)
    || candidate.releaseChain !== 'eb2-e1-e10-e12-current-bar-v1') {
    throw new Error(`Unsupported EB3 candidate definition: ${candidate.id}`);
  }
  const definition = candidate as QqqEb3CandidateDefinition;
  const eb2 = await buildQqqEb2OnlineLayerWithData(startDate, endDate, data, { e1WarmupFullCalendarYears: executionOverrides?.e1WarmupFullCalendarYears, canonicalOptionSignalStartDate, canonicalOptionSignalTapeShared, canonicalOptionSignalTapeMode, referenceCooldownMode, e44ExcludedLayers: definition.e44ExcludedLayers, e44Mode: definition.e44Mode, c4ReAdmissionRule: definition.c4ReAdmissionRule, executionOverrides, execution, trace, rawE1Trace, e1Trace });
  const releaseRules = definition.ruleMode === 'fused' ? buildQqqEb3FusedRules(definition.e12RuleVariant) : buildQqqEb3E12FullRules(definition.e12RuleVariant);
  const eb3 = runQqqEb3E12Union(eb2.rows.map((row) => row.cycle), eb2.rawE1, releaseRules);
  const gated = applyQqqEb3QualityGate(eb3.cycles, candidate.qualityGate);
  const rawFinalCycles = applyQqqEb3ReplacementRule(gated, eb2.rawE1, candidate.replacementRule);
  const finalCycles = researchFinalVeto
    ? rawFinalCycles.filter((cycle) => !matchesQqqEb4ResearchFinalVeto(cycle, researchFinalVeto))
    : rawFinalCycles;
  const eb4ResearchVetoed = researchFinalVeto
    ? rawFinalCycles.filter((cycle) => matchesQqqEb4ResearchFinalVeto(cycle, researchFinalVeto))
    : [];
  const keptDates = new Set(finalCycles.map((cycle) => day(cycle.open.signalDate ?? cycle.open.date)));
  const replacementRelease = finalCycles.filter((cycle) => !gated.some((kept) => day(kept.open.signalDate ?? kept.open.date) === day(cycle.open.signalDate ?? cycle.open.date)));
  return {
    ...eb2,
    rows: finalCycles.map((cycle) => ({ date: day(cycle.open.signalDate ?? cycle.open.date), cycle, layer: 'EB2' })),
    eb2Rows: eb2.rows,
    eb3Release: [...eb3.released.filter((cycle) => keptDates.has(day(cycle.open.signalDate ?? cycle.open.date))), ...replacementRelease],
    eb3ReleasedByRule: [...eb3.releasedByRule, ...(replacementRelease.length ? [{ name: candidate.replacementRule, released: replacementRelease.length }] : [])],
    eb3QualityExcluded: eb3.cycles.filter((cycle) => !keptDates.has(day(cycle.open.signalDate ?? cycle.open.date))),
    eb4ResearchVetoed,
  };
}

function liveSpec(startDate: string, endDate: string, variant: 'eb2' | 'p2' | 'r5'): BacktestRunSpec {
  const built = buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate,
    replayVariant: variant === 'r5' ? 'v1_2_6' : variant === 'p2' ? 'v1_2_7_b' : 'bass2_3_3',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  });
  const strategyOverrides = {
    ...built.strategyOverrides,
    enablePCS: variant !== 'eb2',
    enableEquityBoostPCS: variant === 'eb2',
    ...(variant === 'eb2' ? {
      equityBoostCandidate6Mdd: false,
      equityBoostBass221Gate: false,
      equityBoostBass221VixReboundGate: false,
      equityBoostExcludeRangeBoundSr02: false,
      equityBoostExcludeRiskOnExtendedSr01: false,
      equityBoostExcludeSidewaysSr01: false,
      equityBoostPriceVsSma200Ceiling: 999,
      equityBoostVxnCeiling: 999,
      equityBoostRatioMin: .5,
      equityBoostRatioMax: 1.5,
      equityBoostRatioSelectionTarget: 1,
      equityBoostEntryMode: ACTIVE_QQQ_EB2_CANDIDATE.contract.entryMode,
      equityBoostWidthMode: ACTIVE_QQQ_EB2_CANDIDATE.contract.widthMode,
      equityBoostDynamicWidthVxnThreshold: 22,
      // E44-FUSED parent contract: keep the supplied research script's
      // 6.5%/6.0% width pair while recomputing admission live.
      equityBoostDynamicWidthLowVxnTargetPct: .065,
      equityBoostDynamicWidthHighVxnTargetPct: .06,
      equityBoostDteMode: 'risk_adaptive_hysteresis_v1' as const,
      equityBoostDynamicDteVxnThreshold: 24,
      equityBoostTargetDte: ACTIVE_QQQ_EB2_CANDIDATE.contract.targetDte,
    } : {}),
    ...(variant === 'p2' ? {
      pcsSpreadWidthPct: .03925,
      pcsSurvivalSelectionSurvivalWeight: .8,
      pcsSurvivalSelectionWilsonWeight: .25,
    } : {}),
    ...(variant === 'r5' ? {
      pcsRescueEnabled: true,
      pcsRescueEntryMode: 'reactive_soft_pool' as const,
      pcsRescueRegimeScope: 'selective_quality_v20_merge_tail_de' as const,
      pcsRescueDeltaMode: 'range_smart_quality_v33' as const,
      pcsRescuePressureDelta: .04,
      pcsRescueNormalDelta: .135,
      pcsRescueCalmDelta: .1839,
      pcsRescueExtremeDelta: .2425,
      pcsRescueExtremeBaseDelta: .2075,
      pcsRescueExtremeFallbackDelta: .206,
      pcsRescueWidthPct: .0218,
      pcsRescueExtremeWidthPct: .055,
      pcsRescueTargetDte: 35,
      pcsRescueRiskBudgetNav: .005,
    } : {}),
  };
  return {
    ...built,
    dataSource: { kind: 'live' },
    config: { ...built.config, includeTerminalMarkOnly: true },
    strategyOverrides,
  } as BacktestRunSpec;
}

/**
 * The EB3 E1–E12 lineage was researched against this narrower raw-E1
 * universe. It is intentionally separate from EB2.D0's wider E44 execution
 * contract, and mirrors `makeE1Spec()` in the original research script.
 */
function eb3RawE1Spec(startDate: string, endDate: string): BacktestRunSpec {
  const built = buildQqqE1P0R2EbSpec(startDate, endDate);
  return {
    ...built,
    dataSource: { kind: 'live' },
    scenarioOptions: { ...built.scenarioOptions, canonicalOptionSignalTapeMode: 'skip' as const },
    config: { ...built.config, includeTerminalMarkOnly: true },
    strategyOverrides: {
      ...built.strategyOverrides,
      equityBoostCandidate6Mdd: false,
      equityBoostRatioMin: .5,
      equityBoostRatioMax: 1.5,
      equityBoostRatioSelectionTarget: 1,
      equityBoostEntryMode: 'continuous' as const,
      equityBoostWidthMode: 'risk_adaptive_v1' as const,
      equityBoostDynamicWidthVxnThreshold: 22,
      equityBoostDynamicWidthLowVxnTargetPct: .065,
      equityBoostDynamicWidthHighVxnTargetPct: .06,
      equityBoostDteMode: 'risk_adaptive_hysteresis_v1' as const,
      equityBoostDynamicDteVxnThreshold: 24,
      equityBoostTargetDte: 35,
    },
  } as BacktestRunSpec;
}

function p1E29Blocked(cycles: readonly LayerRow[]): Set<string> {
  const ordered = [...cycles].sort((left, right) => left.date.localeCompare(right.date));
  const context = (row: LayerRow) => (row.cycle.open.marketContext ?? {}) as Record<string, any>;
  const blocked = new Set<string>();
  const stress = (row: LayerRow) => {
    const market = context(row);
    return market.slowSubregime === 'SR02' && Number(market.tqqqRealisedVol20d) >= .6 && Number(market.adx14) < 20;
  };
  const compact = (row: LayerRow) => {
    const market = context(row);
    return market.regime === 'BULL' && market.slowSubregime === 'SR01' && Number(market.vix) < 17
      && Number(market.priceExtensionAtr) >= 2.5 && Number(market.adx14) < 21;
  };
  const weak = (row: LayerRow) => {
    const market = context(row);
    return market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR02' && Number(market.adx14) < 20;
  };
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    if (compact(current) || stress(current)) blocked.add(current.date);
    if (!weak(current) || blocked.has(current.date)) continue;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const prior = ordered[previous]!;
      if (blocked.has(prior.date)) continue;
      if (day(prior.cycle.close.expiry) < current.date) {
        if (prior.cycle.pnl <= 0) blocked.add(current.date);
        break;
      }
    }
  }
  return blocked;
}

function alignToDebug(cycles: readonly Cycle[], debug: readonly OptionCycleDebug[]): Cycle[] {
  const debugByDate = new Map(debug.map((item) => [day(item.openDate), item.pnl]));
  return cycles.map((cycle) => {
    const pnl = debugByDate.get(day(cycle.open.date));
    return pnl === undefined || Math.abs(cycle.pnl - pnl) < .0001
      ? cycle
      : { ...cycle, pnl, close: { ...cycle.close, pnl } };
  });
}

function acceptedRows(result: V2BacktestResult, layer: QqqEb2P2R5LayerId, tag: string, blocked: ReadonlySet<string>, higherPriorityDates: ReadonlySet<string>): LayerRow[] {
  const cycles = pairCycles(result, tag);
  const kind = layer === 'R5' ? 'PCS_RESCUE' : 'PCS';
  const debug = ((result as Result).debug?.optionCycles ?? []).filter((item) => item.kind === kind && Number.isFinite(item.pnl));
  const candidates = alignToDebug(cycles, debug);
  return candidates
    .map((cycle) => ({ date: day(cycle.open.signalDate ?? cycle.open.date), cycle, layer }))
    .filter((row) => !blocked.has(row.date) && !higherPriorityDates.has(row.date));
}

function compose(rowsToCompose: readonly LayerRow[]): LayerRow[] {
  const byDate = new Map<string, LayerRow[]>();
  for (const row of rowsToCompose) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  const order: QqqEb2P2R5LayerId[] = ['EB2', 'P2', 'R5'];
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, candidates]) => [candidates.sort((left, right) => order.indexOf(left.layer) - order.indexOf(right.layer))[0]!]);
}

function acceptedTradeRows(cycles: readonly LayerRow[]): TradeEntry[] {
  return cycles.flatMap((row) => [row.cycle.open, row.cycle.close]).sort((left, right) => day(left.date).localeCompare(day(right.date)));
}

function buildEquityCurve(accepted: readonly LayerRow[], data: MarketDataSet, startDate: string, endDate: string) {
  const pnlByDate = new Map<string, number>();
  for (const row of accepted) pnlByDate.set(day(row.cycle.close.date), (pnlByDate.get(day(row.cycle.close.date)) ?? 0) + row.cycle.pnl);
  let nav = INITIAL_NAV;
  let peak = INITIAL_NAV;
  let maxDrawdownPct = 0;
  const points = data.tqqqBars
    .map((bar) => day(bar.date))
    .filter((date) => date >= startDate && date <= endDate)
    .map((date) => {
      nav += pnlByDate.get(date) ?? 0;
      peak = Math.max(peak, nav);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - nav) / peak : 0);
      return { date, nav, tqqqValue: 0, boxxValue: 0, cashValue: nav, tqqqPct: 0, boxxPct: 0, regime: 'SIDEWAYS' as const, trend: 'NEUTRAL' as const, systemStatus: 'OK', qqqPrice: data.qqqBars.find((bar) => day(bar.date) === date)?.close };
    });
  return { points, endNav: nav, maxDrawdownPct };
}

function buildMetrics(curve: ReturnType<typeof buildEquityCurve>, accepted: readonly LayerRow[], startDate: string, endDate: string) {
  const years = Math.max((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 / 365, 1 / 365);
  const cagr = Math.pow(curve.endNav / INITIAL_NAV, 1 / years) - 1;
  return {
    totalReturnPct: (curve.endNav - INITIAL_NAV) / INITIAL_NAV,
    cagr,
    sharpeRatio: 0,
    maxDrawdownPct: curve.maxDrawdownPct,
    calmarRatio: curve.maxDrawdownPct > 0 ? cagr / curve.maxDrawdownPct : 0,
    totalTrades: accepted.length,
    equityFlipCount: 0,
    whipsawCostPct: 0,
    tradingDays: curve.points.length,
    startNAV: INITIAL_NAV,
    endNAV: curve.endNav,
    startDate,
    endDate,
  };
}

function signalHistory(result: V2BacktestResult, layer: QqqEb2P2R5LayerId): QqqPcsReplayDailySignal[] {
  if (layer !== 'EB2') return buildQqqPcsReplayDailySignalHistory(result.debug?.trace, layer === 'P2' ? 'v1_2_7_b' : 'v1_2_6', layer === 'R5' ? R5_TAG : undefined);
  return (result.debug?.trace ?? []).flatMap((entry) => {
    const admission = entry.overlay?.strategyAdmissions?.find((candidate) => candidate.strategyTag === EB_TAG);
    return admission ? [{ date: entry.date, strategy: 'EB' as const, eligibility: admission.eligibility, reasons: admission.reasons, gates: admission.gates }] : [];
  });
}

function dailyRecords(histories: Record<QqqEb2P2R5LayerId, readonly QqqPcsReplayDailySignal[]>, accepted: Record<QqqEb2P2R5LayerId, ReadonlySet<string>>, blocked: Record<QqqEb2P2R5LayerId, ReadonlySet<string>>): QqqEb2P2R5DailyRecord[] {
  const order: QqqEb2P2R5LayerId[] = ['EB2', 'P2', 'R5'];
  const dates = [...new Set(Object.values(histories).flatMap((items) => items.map((item) => item.date)).concat(Object.values(accepted).flatMap((items) => [...items])))].sort();
  const maps = Object.fromEntries(order.map((layer) => [layer, new Map(histories[layer].map((item) => [item.date, item]))])) as Record<QqqEb2P2R5LayerId, Map<string, QqqPcsReplayDailySignal>>;
  return dates.map((date) => {
    const acceptedLayer = order.find((layer) => accepted[layer].has(date)) ?? null;
    const layers = Object.fromEntries(order.map((layer) => {
      const signal = maps[layer].get(date) ?? null;
      const isAccepted = accepted[layer].has(date);
      const status: QqqEb2P2R5LayerStatus = isAccepted ? 'ACCEPTED' : blocked[layer].has(date) ? 'BLOCKED' : signal?.eligibility === 'UNAVAILABLE' ? 'UNAVAILABLE' : signal?.eligibility === 'BLOCK' ? 'BLOCKED' : signal?.eligibility === 'OPEN' && acceptedLayer ? 'PREEMPTED' : 'NO_CANDIDATE';
      const reasons = isAccepted ? ['共享协调器接受该层并形成实际执行。', ...(signal?.reasons ?? [])] : status === 'PREEMPTED' && acceptedLayer ? [`被优先层 ${acceptedLayer} 抢占；每天最多接受一笔。`, ...(signal?.reasons ?? [])] : (signal?.reasons ?? []);
      return [layer, { layer, status, signal, accepted: isAccepted, reasons } satisfies QqqEb2P2R5LayerRecord];
    })) as Record<QqqEb2P2R5LayerId, QqqEb2P2R5LayerRecord>;
    return { date, layers, acceptedLayer, priorityDecision: acceptedLayer ? `${acceptedLayer} 通过共享优先级（EB2 > P2 > R5）` : '当日没有被共享协调器接受的开仓' };
  });
}

export async function buildQqqEb2P2R5LiveReplayResult(startDate: string, endDate: string): Promise<QqqEb2P2R5ReplayResult> {
  const seed = liveSpec(startDate, endDate, 'eb2');
  const data = await loadRunData(resolveRunSpec(seed));
  return buildQqqEb2P2R5ReplayWithData(startDate, endDate, data);
}

export async function buildQqqEb2P2R5ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: { executionMode?: 'shared' | 'isolated' } = {}): Promise<QqqEb2P2R5ReplayResult> {
  const resolvedEndDate = day(data.tqqqBars.at(-1)?.date) < endDate ? day(data.tqqqBars.at(-1)?.date) : endDate;
  const session = options.executionMode === 'isolated' ? undefined : createQqqCompositeReplaySession(resolveRunSpec(liveSpec(startDate, resolvedEndDate, 'eb2')), data);
  const execution = session ? executionFromQqqCompositeReplaySession(session) : undefined;
  const dynamicEb2 = await buildQqqEb2OnlineLayerWithData(startDate, resolvedEndDate, data, execution ? { execution } : {});
  const ebRaw = dynamicEb2.raw;
  const eb2 = dynamicEb2.rows;

  const p2Spec = liveSpec(startDate, resolvedEndDate, 'p2');
  const p2Raw = runWithData(p2Spec, data, undefined, execution) as Result;
  const p2All = rows(p2Raw, 'P2', PCS_TAG);
  const p2Blocked = p1E29Blocked(p2All);
  const eb2DateSet = new Set(eb2.map((row) => row.date));
  const p2 = acceptedRows(p2Raw, 'P2', PCS_TAG, p2Blocked, eb2DateSet);

  const r5Spec = liveSpec(startDate, resolvedEndDate, 'r5');
  const r5Raw = runWithData(r5Spec, data, undefined, execution) as Result;
  const p2DateSet = new Set(p2.map((row) => row.date));
  const r5 = acceptedRows(r5Raw, 'R5', R5_TAG, new Set(), new Set([...eb2DateSet, ...p2DateSet]));
  const composed = compose([...eb2, ...p2, ...r5]);
  const curve = buildEquityCurve(composed, data, startDate, resolvedEndDate);
  const tradeLog = acceptedTradeRows(composed);
  const accepted = { EB2: new Set(eb2.map((row) => row.date)), P2: new Set(p2.map((row) => row.date)), R5: new Set(r5.map((row) => row.date)) } as Record<QqqEb2P2R5LayerId, ReadonlySet<string>>;
  const blocked = { EB2: dynamicEb2.blocked, P2: p2Blocked, R5: new Set<string>() } as Record<QqqEb2P2R5LayerId, ReadonlySet<string>>;
  const histories = { EB2: signalHistory(ebRaw, 'EB2'), P2: signalHistory(p2Raw, 'P2'), R5: signalHistory(r5Raw, 'R5') } as Record<QqqEb2P2R5LayerId, readonly QqqPcsReplayDailySignal[]>;
  const daily = dailyRecords(histories, accepted, blocked);
  const byLayer = Object.fromEntries((['EB2', 'P2', 'R5'] as const).map((layer) => {
    const layerRows = composed.filter((row) => row.layer === layer);
    return [layer, { n: layerRows.length, pnl: layerRows.reduce((sum, row) => sum + row.cycle.pnl, 0), wins: layerRows.filter((row) => row.cycle.pnl > 0).length }];
  })) as Record<QqqEb2P2R5LayerId, { n: number; pnl: number; wins: number }>;
  const trace = ebRaw.debug?.trace;
  const pcsDailySignalHistory = histories.EB2.concat(histories.P2, histories.R5).sort((left, right) => left.date.localeCompare(right.date));
  const pcsDailyReplaySnapshots = buildQqqReplayDailySnapshots(trace, 'pcs', tradeLog, { equityCurve: curve.points });
  const result: QqqEb2P2R5ReplayResult = {
    config: ebRaw.config,
    dataFingerprint: data.fingerprint,
    pcsDailySignalHistory,
    pcsDailyReplaySnapshots,
    equityCurve: curve.points,
    tradeLog,
    metrics: buildMetrics(curve, composed, startDate, resolvedEndDate),
    debug: { trace, optionCycles: [...(ebRaw.debug?.optionCycles ?? []), ...(p2Raw.debug?.optionCycles ?? []), ...(r5Raw.debug?.optionCycles ?? [])] },
    qqqEb2P2R5: { byLayer, acceptedDays: composed.length, daily },
  };
  return result;
}

export function buildQqqEb2P2R5ReplayDailySnapshots(result: QqqEb2P2R5ReplayResult) {
  return buildQqqReplayDailySnapshots(result.debug?.trace, 'pcs', result.tradeLog, { equityCurve: result.equityCurve });
}
