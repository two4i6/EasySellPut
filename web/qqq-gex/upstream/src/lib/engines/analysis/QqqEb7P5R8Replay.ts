import { buildQqqEb7DynamicReplayWithData } from './QqqEb7DynamicReplay';
import { buildQqqP4DynamicReplayWithData, isQqqP4E290MergedCurrentBarReject, isQqqP4E290RecoveryCurrentBar, type QqqP4DynamicRow } from './QqqP4DynamicReplay';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import { loadRunData, runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { BacktestResult, EquityPoint, PerformanceMetrics, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import { closeOptionPosition, createLegacyOptionMarket } from '../leveraged-overlay/v2/options';
import { MOCK_OPTION_CALIBRATION } from '../leveraged-overlay/backtest/mockOptionCalibration';
import { normalizeVolIndexForMockOptions } from '../leveraged-overlay/backtest/mockOptions';
import { QQQ_EB7_REPLAY_VERSION } from './QqqEb7DynamicReplay';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession, type QqqReplayProfiler } from './QqqCompositeReplaySession';
import { coordinateQqqCompositeCandidates, type QqqCompositeDecision } from './QqqCompositeCoordinator';

export const QQQ_EB7_P5_R8_REPLAY_VARIANT = 'eb7_p5_r8' as const;
export const QQQ_EB7_P5_R8_REPLAY_VERSION = `eb7-p5-r8-${QQQ_EB7_REPLAY_VERSION}-coord-v2-pending-v1` as const;
export const QQQ_EB7_P5_R8_REPLAY_LABEL = '默认：EB7 > P5 > R8（按实际 openDate）' as const;
export type QqqEb7P5R8Layer = 'EB7' | 'P5' | 'R8';
type Layer = QqqEb7P5R8Layer;
export type QqqEb7P5R8CandidateCycle = {
  layer: Layer;
  signalDate: string;
  openDate: string;
  expiry: string;
  pnl?: number;
  open: TradeEntry;
  close?: TradeEntry;
  pending: boolean;
};
type Cycle = QqqEb7P5R8CandidateCycle;
type CandidateDecision = QqqCompositeDecision<Layer, Cycle>;
export type QqqEb7P5R8DailyRecord = {
  date: string;
  layers: Record<Layer, { status: 'ACCEPTED' | 'PREEMPTED' | 'NO_CANDIDATE'; signal: null; accepted: boolean; reasons: string[] }>;
  acceptedLayer: Layer | null;
  priorityDecision: string;
};

const INITIAL_CAPITAL = 100_000;
const PRIORITY: readonly Layer[] = ['EB7', 'P5', 'R8'];
const TAG: Record<Layer, string> = { EB7: 'QQQ_EQUITY_BOOST_PUT_SPREAD', P5: 'QQQ_PUT_CREDIT_SPREAD', R8: 'QQQ_PCS_RESCUE' };
const day = (value: string | undefined) => (value ?? '').slice(0, 10);
const number = (value: number | null | undefined) => Number.isFinite(value) ? value as number : Number.NaN;

function p5E374(row: QqqP4DynamicRow): boolean {
  const m = row.market;
  if (m.regime !== 'RISK_ON_EXTENDED' || m.slowSubregime !== 'SR02') return false;
  return (number(m.adx14) < 30 && number(m.roc5) < .0044 && (number(m.vix) < 17 || number(m.vixChange5d) >= 0 || number(m.range20dPct) < .06 || number(m.vixTermStructureSlope) < 2.5))
    || (number(m.vix) < 12 && number(m.roc5) < .01 && (number(m.adx14) >= 25 || number(m.priceExtensionAtr) < 3))
    || (number(m.priceExtensionAtr) < 2.5 && number(m.roc5) >= .02 && (number(m.vixTermStructureSlope) < 2.5 || number(m.tqqqRealisedVol20d) < .3))
    || (number(m.adx14) < 25 && number(m.priceExtensionAtr) < 2.5 && number(m.rsi14) >= 70)
    || (number(m.adx14) >= 40 && number(m.drawdownFromRecentHighPct) >= .01 && (number(m.vix) < 15 || number(m.tqqqRealisedVol20d) < .5));
}

function e307(row: QqqP4DynamicRow): boolean {
  return isQqqP4E290RecoveryCurrentBar(row)
    || (number(row.market.adx14) >= 10 && number(row.market.adx14) < 12 && number(row.market.priceExtensionAtr) >= 2 && number(row.market.priceExtensionAtr) < 3)
    || (number(row.market.vixTermStructureSlope) < -.1 && number(row.market.distanceToSma20Pct) >= -.02 && number(row.market.distanceToSma20Pct) < 0);
}
function e315Bypass(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && number(row.market.adx14) >= 35 && number(row.market.tqqqRealisedVol20d) < .3 && (number(row.market.vix) < 13.5 || number(row.market.priceExtensionAtr) < .5 || number(row.market.priceExtensionAtr) >= 1.8);
}
function e336(row: QqqP4DynamicRow): boolean {
  return (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && number(row.market.vixTermStructureSlope) < 2.5 && number(row.market.vixChange5d) < .1)
    || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && number(row.market.sma20SlopePct) < -.006 && number(row.market.range20dPct) < .091)
    || (isQqqP4E290MergedCurrentBarReject(row) && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && number(row.market.roc5) >= .0044 && number(row.market.range20dPct) >= .0651)
    || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'CURRENT' && number(row.market.adx14) < 12)
    || (row.market.regime === 'BULL' && row.market.slowSubregime === 'CURRENT' && number(row.market.vixTermStructureSlope) < 2.5)
    || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && number(row.market.vix) < 14 && number(row.market.roc20) < 0)
    || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR02' && number(row.market.adx14) >= 15 && number(row.market.priceExtensionAtr) < 3)
    || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && number(row.market.range20dPct) < .12 && number(row.market.sma20SlopePct) < -.02)
    || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && number(row.market.range20dPct) < .091 && number(row.market.vixTermStructureSlope) < 1)
    || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR02' && number(row.market.adx14) < 10 && number(row.market.rsi14) < 50);
}
function e348(row: QqqP4DynamicRow): boolean {
  return e336(row)
    || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && number(row.market.vix) < 14 && number(row.market.adx14) < 10 && number(row.market.vixTermStructureSlope) >= 2)
    || (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && number(row.market.vix) >= 12 && number(row.market.priceExtensionAtr) >= 3 && number(row.market.range20dPct) >= .091)
    || (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02' && number(row.market.vix) < 14 && number(row.market.adx14) < 20 && number(row.market.priceExtensionAtr) >= 1.5);
}
function e354Micro(row: QqqP4DynamicRow): boolean {
  return (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && number(row.market.adx14) >= 30 && number(row.market.roc5) >= .02 && number(row.market.rsi14) < 70)
    || (row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR01' && number(row.market.adx14) >= 25 && number(row.market.priceExtensionAtr) >= 2.5 && number(row.market.roc5) < .02)
    || (row.market.regime === 'SIDEWAYS' && row.market.slowSubregime === 'SR01' && number(row.market.vix) < 25 && number(row.market.range20dPct) >= .16 && number(row.market.vixChange5d) >= -.1)
    || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && number(row.market.adx14) >= 15 && number(row.market.priceExtensionAtr) >= 0 && number(row.market.sma20SlopePct) < 0);
}
function p5Admission(row: QqqP4DynamicRow): boolean { return e307(row) || e348(row) || e354Micro(row) || p5E374(row); }
function p5ChildOptions() {
  return {
    additionalReject: isQqqP4E290MergedCurrentBarReject,
    additionalProtectionBypass: e315Bypass,
    additionalRejectBypass: (row: QqqP4DynamicRow) => isQqqP4E290MergedCurrentBarReject(row) && row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && number(row.market.roc5) >= .0044 && number(row.market.range20dPct) >= .0651,
    additionalAdmission: p5Admission,
  } as const;
}

export const R8_OVERRIDES = {
  enablePCS: true, enableEquityBoostPCS: false, pcsRescueEnabled: true, pcsRescueEntryMode: 'reactive_soft_pool',
  pcsRescueRegimeScope: 'selective_quality_v104_bull_er10', pcsRescueDeltaMode: 'range_smart_quality_v33',
  pcsRescueExtremeDelta: .2425, pcsRescueExtremeBaseDelta: .2075, pcsRescueExtremeFallbackDelta: .206,
  pcsRescueCalmDelta: .1839, pcsRescueNormalDelta: .135, pcsRescuePressureDelta: .04, pcsRescueWidthPct: .0218,
  pcsRescueExtremeWidthPct: .055, pcsRescueTargetDte: 35, pcsRescueRiskBudgetNav: .005,
  pcsRescueContractFallbackMode: 'narrow_updelta_v1',
  pcsRescueContractFallbackQualityMode: 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_or_sr02_adx15_v1',
  pcsRescueSelectiveQualitySidewaysVixMin: 19, pcsRescueSelectiveQualitySidewaysRoc5Min: .02, pcsRescueSelectiveQualityBullVix10: true,
  pcsRescueContractFallbackForceMinimumContract: true, pcsRescueContractFallbackMaxRiskPct: .0051538,
  pcsRescueContractFallbackDeltaUplift: .025, pcsRescueContractFallbackSecondaryDeltaUplift: .01,
  pcsRescueContractFallbackTertiaryDeltaUplift: .0375, pcsRescueContractFallbackTertiaryQualityMode: 'exclude_bull_sr02_side_sr01_v1',
  pcsRescueContractFallbackTertiaryStepDeltaUplift: .07985, pcsRescueContractFallbackTertiaryStepQualityMode: 'exclude_bull_sr02_side_sr01_riskext_sr01_v1',
  pcsRescueFillFallbackQuoteOnlyWidth: true, pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Min: .61,
  pcsRescueExtremeWidthProfile: 'adx_split_v1', pcsRescueExtremeWidthNarrowPct: .043,
  pcsRescueResearchVetoMode: 'r8_e0_compact_exact_v1', pcsRescueResearchWidthMode: 'non_bull_wide_v1', pcsRescueResearchWidthPct: .035,
  pcsRescueFillFallbackMode: 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_or_bull_sr02_vixge13_5_or_bull_sr01_vix15_16_atrge0_weaklt2_v1',
  pcsRescuePairSearchMode: 'nearest_valid_r7_e449_creditfloor_weak_bull_v1',
  pcsRescueResearchComplementMode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1',
  pcsRescuePromoteOnMainProposal: true, pcsRescueDualWithMainProposal: true,
  pcsRescueDualMainQualityGate: 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_navdd05_or_ma50slope02_trend50_v1',
} as const;

export function pairQqqEb7P5R8Cycles(log: readonly TradeEntry[], layer: Layer): Cycle[] {
  const queues = new Map<string, TradeEntry[]>(); const rows: Cycle[] = [];
  for (const trade of log) {
    if (trade.strategyTag !== TAG[layer]) continue;
    const key = `${trade.symbol}|${trade.expiry ?? ''}`;
    if (trade.action === 'OPEN') { const queue = queues.get(key) ?? []; queue.push(trade); queues.set(key, queue); continue; }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    if (!Number.isFinite(trade.pnl)) continue;
    const open = queues.get(key)?.shift();
    if (open) rows.push({ layer, signalDate: day(open.signalDate ?? open.date), openDate: day(open.date), expiry: day(open.expiry), pnl: trade.pnl!, open, close: trade, pending: false });
  }
  for (const open of [...queues.values()].flat()) {
    rows.push({ layer, signalDate: day(open.signalDate ?? open.date), openDate: day(open.date), expiry: day(open.expiry), open, pending: true });
  }
  return rows.sort((a, b) => `${a.openDate}|${a.signalDate}|${a.layer}`.localeCompare(`${b.openDate}|${b.signalDate}|${b.layer}`));
}

const isCompleted = (row: Cycle): row is Cycle & { close: TradeEntry; pnl: number; pending: false } => !row.pending && row.close !== undefined && Number.isFinite(row.pnl);

function metric(rows: readonly Cycle[]) {
  const completed = rows.filter(isCompleted);
  const pnls = completed.map(row => row.pnl); const sorted = [...pnls].sort((a, b) => a - b); const wins = pnls.filter(pnl => pnl > 0).length;
  let equity = 0; let peak = 0; let mdd = 0;
  for (const row of [...completed].sort((a, b) => a.close.date.localeCompare(b.close.date))) { equity += row.pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  const tail = pnls.length ? Math.max(1, Math.ceil(pnls.length * .05)) : 0;
  return { n: pnls.length, wins, losses: pnls.length - wins, winRate: pnls.length ? wins / pnls.length : 0, pnl: pnls.reduce((sum, pnl) => sum + pnl, 0), cvar5: tail ? sorted.slice(0, tail).reduce((sum, pnl) => sum + pnl, 0) / tail : 0, worst: sorted[0] ?? 0, realizedMdd: mdd };
}

export function coordinateQqqEb7P5R8Candidates(rows: readonly Cycle[]) {
  return coordinateQqqCompositeCandidates(rows, PRIORITY);
}

const coordinate = coordinateQqqEb7P5R8Candidates;

export function buildQqqEb7P5R8DailyRecords(candidates: readonly CandidateDecision[], dates: readonly string[]): QqqEb7P5R8DailyRecord[] {
  const byDate = new Map<string, CandidateDecision[]>();
  for (const candidate of candidates) byDate.set(candidate.openDate, [...(byDate.get(candidate.openDate) ?? []), candidate]);
  return dates.map((date) => {
    const decisions = byDate.get(date) ?? [];
    const accepted = decisions.find((decision) => decision.accepted);
    const layers = Object.fromEntries(PRIORITY.map((layer) => {
      const decision = decisions.find((item) => item.layer === layer);
      return [layer, decision
        ? { status: decision.accepted ? 'ACCEPTED' as const : 'PREEMPTED' as const, signal: null, accepted: decision.accepted, reasons: decision.accepted ? ['按实际 openDate 通过 EB7 > P5 > R8 共享优先级'] : [`被 ${decision.selectedLayer} 优先层抢占`] }
        : { status: 'NO_CANDIDATE' as const, signal: null, accepted: false, reasons: [] }];
    })) as QqqEb7P5R8DailyRecord['layers'];
    return { date, layers, acceptedLayer: accepted?.layer ?? null, priorityDecision: accepted ? `${accepted.layer} 通过实际 openDate 优先级 EB7 > P5 > R8` : '当日没有被 EB7 > P5 > R8 共享 coordinator 接受的开仓' };
  });
}

function unrealized(row: Cycle, date: string, data: MarketDataSet) {
  const match = row.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/); const bar = data.qqqBars.find(item => day(item.date) === date);
  if (!match || !bar || !row.expiry) return 0;
  const rawVol = data.vxnByDate[date] ?? data.vixByDate[date] ?? 20; const vol = normalizeVolIndexForMockOptions(rawVol, 'VXN');
  const rawVol3m = data.vix3mByDate[date]; const vol3m = rawVol3m != null && rawVol > 0 ? rawVol3m * (vol / rawVol) : undefined;
  return closeOptionPosition({ openingCashImpact: row.open.cashImpact, legs: [{ symbol: 'QQQ', type: 'put', side: 'short', strike: Number(match[2]), expiry: row.expiry, quantity: row.open.quantity }, { symbol: 'QQQ', type: 'put', side: 'long', strike: Number(match[1]), expiry: row.expiry, quantity: row.open.quantity }] }, createLegacyOptionMarket({ asOfDate: date, prices: { QQQ: bar.close }, vix: vol, vix3m: vol3m }), { spreadMultiplier: 1, skewSlope: MOCK_OPTION_CALIBRATION.skewSlope, riskFreeRate: .045 }).pnl;
}

function unifiedMtm(rows: readonly Cycle[], data: MarketDataSet, startDate: string, endDate: string) {
  const closes = new Map<string, number>(); for (const row of rows) if (isCompleted(row)) closes.set(day(row.close.date), (closes.get(day(row.close.date)) ?? 0) + row.pnl);
  let realized = 0; let peak = INITIAL_CAPITAL; let runningPeakDate: string | null = null; let mdd = 0; let peakDate: string | null = null; let troughDate: string | null = null; let peakNav = INITIAL_CAPITAL; let troughNav = INITIAL_CAPITAL;
  const snapshots: EquityPoint[] = [];
  for (const bar of data.qqqBars.filter(item => day(item.date) >= startDate && day(item.date) <= endDate)) {
    const date = day(bar.date); realized += closes.get(date) ?? 0; const open = rows.filter(row => row.openDate <= date && (!row.close || day(row.close.date) > date)); const nav = INITIAL_CAPITAL + realized + open.reduce((sum, row) => sum + unrealized(row, date, data), 0);
    if (nav > peak) { peak = nav; runningPeakDate = date; }
    if (peak - nav > mdd) { mdd = peak - nav; peakDate = runningPeakDate; troughDate = date; peakNav = peak; troughNav = nav; }
    snapshots.push({ date, nav, tqqqValue: 0, boxxValue: 0, cashValue: nav, tqqqPct: 0, boxxPct: 0, regime: 'SIDEWAYS', trend: 'NEUTRAL', systemStatus: 'OK', qqqPrice: bar.close });
  }
  return { snapshots, mdd: { value: -mdd, peakDate, troughDate, interval: { startDate: peakDate, endDate: troughDate }, peakNav, troughNav, sourceLayers: [...new Set(rows.map(row => row.layer))] as Layer[] } };
}

function metricsFor(rows: readonly Cycle[], snapshots: readonly EquityPoint[], startDate: string, endDate: string): PerformanceMetrics {
  const m = metric(rows); const years = Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000)); const endNav = INITIAL_CAPITAL + m.pnl; const cagr = (Math.pow(Math.max(endNav / INITIAL_CAPITAL, 0), 1 / years) - 1) * 100;
  return { totalReturnPct: m.pnl / INITIAL_CAPITAL * 100, cagr: Number.isFinite(cagr) ? cagr : 0, sharpeRatio: 0, maxDrawdownPct: Math.abs(m.realizedMdd) / INITIAL_CAPITAL * 100, calmarRatio: m.realizedMdd ? cagr / (Math.abs(m.realizedMdd) / INITIAL_CAPITAL * 100) : 0, totalTrades: m.n, equityFlipCount: 0, whipsawCostPct: 0, tradingDays: snapshots.length, startNAV: INITIAL_CAPITAL, endNAV: endNav, startDate, endDate };
}

function resolvedEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet): string {
  const qqqEnd = day(data.qqqBars.at(-1)?.date);
  const tqqqEnd = day(data.tqqqBars.at(-1)?.date);
  const availableEndDate = qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
  const resolved = requestedEndDate < availableEndDate ? requestedEndDate : availableEndDate;
  if (!resolved || resolved < startDate) throw new Error(`EB7.P5.R8 replay range unavailable: ${startDate}..${requestedEndDate}`);
  return resolved;
}

function commonSpec(startDate: string, endDate: string) { return buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' }); }

function r8WithData(startDate: string, endDate: string, data: MarketDataSet, execution?: ReturnType<typeof executionFromQqqCompositeReplaySession>) {
  const spec = commonSpec(startDate, endDate);
  return runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true, trace: true }, scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true }, strategyOverrides: { ...spec.strategyOverrides, ...R8_OVERRIDES } as never }, data, undefined, execution) as V2BacktestResult;
}

export type QqqEb7P5R8ReplayBuildOptions = Readonly<{
  executionMode?: 'shared' | 'isolated';
  /** Research-only timing seam; omitted in production and adds no clock calls. */
  profiler?: QqqReplayProfiler;
  /** Research-only reference mode; restores traces for every EB7 recovery arm. */
  recoveryTraceMode?: 'minimal' | 'full';
}>;

async function timedReplayStage<T>(
  profiler: QqqEb7P5R8ReplayBuildOptions['profiler'],
  stage: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!profiler) return task();
  const started = Date.now();
  const result = await task();
  profiler.record(stage, Date.now() - started);
  return result;
}

export async function buildQqqEb7P5R8ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb7P5R8ReplayBuildOptions = {}): Promise<BacktestResult & { replayVariant: typeof QQQ_EB7_P5_R8_REPLAY_VARIANT; replayVersion: typeof QQQ_EB7_P5_R8_REPLAY_VERSION; dataFingerprint: string; requestedStartDate: string; requestedEndDate: string; resolvedEndDate: string; daily: readonly QqqEb7P5R8DailyRecord[]; unifiedMtmMdd: ReturnType<typeof unifiedMtm>['mdd']; pendingOpenPositions: readonly QqqEb7P5R8CandidateCycle[]; acceptedLayerBreakdown: Record<Layer, { n: number; wins: number; losses: number; pnl: number }>; coordination: { preemptedCountsByLayer: Record<Layer, number>; oneOpenPerOpenDate: true } }> {
  const resolved = resolvedEndDate(startDate, endDate, data);
  const session = options.executionMode === 'isolated' ? undefined : createQqqCompositeReplaySession(resolveRunSpec(commonSpec(startDate, endDate)), data);
  const execution = session ? executionFromQqqCompositeReplaySession(session) : undefined;
  // Historical UI rendering consumes the executable cycles and final metrics,
  // not the intermediate EB7 research trace. Full trace remains opt-in for
  // research diagnostics; the default path is deliberately trace-free.
  const eb7Options = {
    ...(execution ? { execution } : {}),
    ...(options.profiler ? { profiler: options.profiler } : {}),
    ...(options.recoveryTraceMode === 'full'
      ? { highRecoveryTrace: true, lowRecoveryTrace: true, intermediateRecoveryTrace: true, skipIntermediateMtm: false }
      : { highRecoveryTrace: false, lowRecoveryTrace: false, intermediateRecoveryTrace: false, skipIntermediateMtm: true }),
  };
  const [eb7, p5, r8] = await Promise.all([
    timedReplayStage(options.profiler, 'EB7 adapter', () => buildQqqEb7DynamicReplayWithData(startDate, endDate, data, eb7Options)),
    timedReplayStage(options.profiler, 'P5 adapter', () => buildQqqP4DynamicReplayWithData(startDate, endDate, data, execution ? { ...p5ChildOptions(), execution } : p5ChildOptions())),
    timedReplayStage(options.profiler, 'R8 adapter', () => Promise.resolve(r8WithData(startDate, endDate, data, execution))),
  ]);
  const cycles: Cycle[] = [
    ...eb7.cycles.map(cycle => ({ layer: 'EB7' as const, signalDate: day(cycle.open.signalDate ?? cycle.open.date), openDate: day(cycle.open.date), expiry: day(cycle.open.expiry), pnl: cycle.pnl, open: cycle.open, close: cycle.close, pending: false })),
    ...pairQqqEb7P5R8Cycles(p5.tradeLog, 'P5'), ...pairQqqEb7P5R8Cycles(r8.tradeLog, 'R8'),
  ];
  const coordinated = coordinate(cycles); const rows = coordinated.accepted; const metricResult = metric(rows);
  const mtmStarted = options.profiler ? Date.now() : 0;
  const mtm = unifiedMtm(rows, data, startDate, resolved);
  if (options.profiler) options.profiler.record('unified MTM', Date.now() - mtmStarted);
  const breakdown = Object.fromEntries(PRIORITY.map(layer => { const part = rows.filter(isCompleted).filter(row => row.layer === layer); return [layer, { n: part.length, wins: part.filter(row => row.pnl > 0).length, losses: part.filter(row => row.pnl <= 0).length, pnl: part.reduce((sum, row) => sum + row.pnl, 0) }]; })) as Record<Layer, { n: number; wins: number; losses: number; pnl: number }>;
  const pendingOpenPositions = rows.filter(row => row.pending);
  if (![eb7.dataFingerprint, p5.dataFingerprint, data.fingerprint].every(value => value === data.fingerprint)) throw new Error('EB7/P5/R8 dataFingerprint mismatch');
  if (new Set(rows.map(row => row.openDate)).size !== rows.length) throw new Error('EB7.P5.R8 oneOpenPerOpenDate invariant failed');
  return { replayVariant: QQQ_EB7_P5_R8_REPLAY_VARIANT, replayVersion: QQQ_EB7_P5_R8_REPLAY_VERSION, dataFingerprint: data.fingerprint, requestedStartDate: startDate, requestedEndDate: endDate, resolvedEndDate: resolved, daily: buildQqqEb7P5R8DailyRecords(coordinated.all, mtm.snapshots.map((snapshot) => snapshot.date)), config: { ...eb7.upstream.raw.config, startDate, endDate: resolved, initialCapital: INITIAL_CAPITAL }, equityCurve: mtm.snapshots, tradeLog: rows.flatMap(row => row.close ? [row.open, row.close] : [row.open]).sort((a, b) => `${day(a.date)}|${a.action === 'OPEN' ? 0 : 1}`.localeCompare(`${day(b.date)}|${b.action === 'OPEN' ? 0 : 1}`)), metrics: metricsFor(rows, mtm.snapshots, startDate, resolved), totalTrades: metricResult.n, wins: metricResult.wins, losses: metricResult.losses, winRate: metricResult.winRate, realizedPnl: metricResult.pnl, realizedMdd: metricResult.realizedMdd, cvar5: metricResult.cvar5, worstTrade: metricResult.worst, unifiedMtmMdd: mtm.mdd, pendingOpenPositions, acceptedLayerBreakdown: breakdown, coordination: { preemptedCountsByLayer: coordinated.preempted, oneOpenPerOpenDate: true }, debug: { trace: eb7.upstream.raw.debug?.trace }, warnings: ['unified MTM MDD is worse than EB6.P4(E0).R7 on the launch gate; activated by explicit user risk override.'] } as BacktestResult & { replayVariant: typeof QQQ_EB7_P5_R8_REPLAY_VARIANT; replayVersion: typeof QQQ_EB7_P5_R8_REPLAY_VERSION; dataFingerprint: string; requestedStartDate: string; requestedEndDate: string; resolvedEndDate: string; daily: readonly QqqEb7P5R8DailyRecord[]; unifiedMtmMdd: ReturnType<typeof unifiedMtm>['mdd']; pendingOpenPositions: readonly QqqEb7P5R8CandidateCycle[]; acceptedLayerBreakdown: Record<Layer, { n: number; wins: number; losses: number; pnl: number }>; coordination: { preemptedCountsByLayer: Record<Layer, number>; oneOpenPerOpenDate: true } };
}

export async function buildQqqEb7P5R8LiveReplayResult(startDate: string, endDate: string) {
  const data = await loadRunData(resolveRunSpec(commonSpec(startDate, endDate)));
  return buildQqqEb7P5R8ReplayWithData(startDate, endDate, data);
}

export type QqqEb7P5R8ReplayResult = Awaited<ReturnType<typeof buildQqqEb7P5R8ReplayWithData>>;

export function buildQqqEb7P5R8DailySignalHistory(result: Awaited<ReturnType<typeof buildQqqEb7P5R8ReplayWithData>>) {
  const accepted = new Map(result.tradeLog.filter(trade => trade.action === 'OPEN').map(trade => [day(trade.date), trade.strategyTag]));
  return result.equityCurve.map(point => ({ date: point.date, strategy: accepted.has(point.date) ? accepted.get(point.date) : undefined, eligibility: accepted.has(point.date) ? 'OPEN' as const : 'BLOCK' as const, reasons: accepted.has(point.date) ? ['按实际 openDate 通过 EB7 > P5 > R8 共享优先级'] : ['没有候选通过共享 openDate coordinator'], gates: [] }));
}
