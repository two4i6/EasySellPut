import { qqqEbDailyAdmissions } from './qqqEbDailyAdmission';
import { buildQqqEb7E175DynamicReplayWithData } from './QqqEb7E175DynamicReplay';
import { buildQqqEb7E209DynamicReplayWithData } from './QqqEb7E209DynamicReplay';
import { buildQqqEb6DynamicReplayWithData } from './QqqEb6DynamicReplay';
import { buildQqqP4DynamicReplayWithData, qqqCanonicalOptionSignalWarmupStartDate, type QqqP4DynamicReplayOptions } from './QqqP4DynamicReplay';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import { buildQqqPcsHistoricalBacktestSpec, type QqqPcsReplayDailySignal } from './QqqPcsHistoricalBacktest';
import { loadRunData, runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { BacktestResult, EquityPoint, PerformanceMetrics, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { StrategyParams } from '../leveraged-overlay/types/params';
import { closeOptionPosition, createLegacyOptionMarket } from '../leveraged-overlay/v2/options';
import { MOCK_OPTION_CALIBRATION } from '../leveraged-overlay/backtest/mockOptionCalibration';
import { normalizeVolIndexForMockOptions } from '../leveraged-overlay/backtest/mockOptions';
import { QQQ_EB7_E175_REPLAY_VERSION } from './QqqEb7E175DynamicReplay';
import { QQQ_P6_E385_OPTIONS, QQQ_R9_E226_OVERRIDES } from './QqqEb7E175P6E385R9E226Contract';
import { QQQ_P6_E218_OPTIONS } from './QqqEb7E175P6E218R9E221Contract';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession, type QqqReplayProfiler } from './QqqCompositeReplaySession';
import { coordinateQqqCompositeCandidates, type QqqCompositeDecision } from './QqqCompositeCoordinator';
import { runQqqEb7P6R9ArmsInWorkers } from './QqqEb7P6R9Parallel';

export const QQQ_EB7_P6_R9_REPLAY_VARIANT = 'eb7_p6_r9' as const;
export const QQQ_EB7_P6_R9_REPLAY_VERSION = `eb7-e175-p6-e385-r9-e226-${QQQ_EB7_E175_REPLAY_VERSION}-coord-v4-current-bar` as const;
export const QQQ_EB7_P6_R9_REPLAY_LABEL = '默认：EB7.E175 > P6.E385 > R9.E226（按实际 openDate）' as const;
export type QqqEb7P6R9Layer = 'EB7' | 'P6' | 'R9';
type Layer = QqqEb7P6R9Layer;
export type QqqEb7P6R9CandidateCycle = {
  layer: Layer;
  signalDate: string;
  openDate: string;
  expiry: string;
  pnl?: number;
  open: TradeEntry;
  close?: TradeEntry;
  pending: boolean;
};
type Cycle = QqqEb7P6R9CandidateCycle;
type CandidateDecision = QqqCompositeDecision<Layer, Cycle>;
export type QqqEb7P6R9DailyRecord = {
  date: string;
  layers: Record<Layer, { status: 'ACCEPTED' | 'PREEMPTED' | 'NO_CANDIDATE'; signal: QqqPcsReplayDailySignal | null; accepted: boolean; reasons: string[] }>;
  dailyInputs?: { close?: number; vix?: number; vix3m?: number; regime: string; rsi14?: number; adx14?: number };
  acceptedLayer: Layer | null;
  priorityDecision: string;
};

const INITIAL_CAPITAL = 100_000;
const PRIORITY: readonly Layer[] = ['EB7', 'P6', 'R9'];
const TAG: Record<Layer, string> = { EB7: 'QQQ_EQUITY_BOOST_PUT_SPREAD', P6: 'QQQ_PUT_CREDIT_SPREAD', R9: 'QQQ_PCS_RESCUE' };
const day = (value: string | undefined) => (value ?? '').slice(0, 10);
const number = (value: number | null | undefined) => Number.isFinite(value) ? value as number : Number.NaN;

/** Promoted R9.E226 current-bar contract; kept under the stable runtime export. */
export const QQQ_EB7_P6_R9_RESCUE_OVERRIDES = QQQ_R9_E226_OVERRIDES;

function pairCycles(log: readonly TradeEntry[], layer: Layer): Cycle[] {
  const queues = new Map<string, TradeEntry[]>();
  const rows: Cycle[] = [];
  for (const trade of log) {
    if (trade.strategyTag !== TAG[layer]) continue;
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
    if (open) rows.push({ layer, signalDate: day(open.signalDate ?? open.date), openDate: day(open.date), expiry: day(open.expiry), pnl: trade.pnl!, open, close: trade, pending: false });
  }
  for (const open of [...queues.values()].flat()) rows.push({ layer, signalDate: day(open.signalDate ?? open.date), openDate: day(open.date), expiry: day(open.expiry), open, pending: true });
  return rows.sort((a, b) => `${a.openDate}|${a.signalDate}|${a.layer}`.localeCompare(`${b.openDate}|${b.signalDate}|${b.layer}`));
}

const isCompleted = (row: Cycle): row is Cycle & { close: TradeEntry; pnl: number; pending: false } => !row.pending && row.close !== undefined && Number.isFinite(row.pnl);

function metric(rows: readonly Cycle[]) {
  const completed = rows.filter(isCompleted);
  const pnls = completed.map(row => row.pnl);
  const sorted = [...pnls].sort((a, b) => a - b);
  const wins = pnls.filter(pnl => pnl > 0).length;
  let equity = 0; let peak = 0; let mdd = 0;
  for (const row of [...completed].sort((a, b) => a.close.date.localeCompare(b.close.date))) {
    equity += row.pnl;
    peak = Math.max(peak, equity);
    mdd = Math.min(mdd, equity - peak);
  }
  const tail = pnls.length ? Math.max(1, Math.ceil(pnls.length * .05)) : 0;
  return { n: pnls.length, wins, losses: pnls.length - wins, winRate: pnls.length ? wins / pnls.length : 0, pnl: pnls.reduce((sum, pnl) => sum + pnl, 0), cvar5: tail ? sorted.slice(0, tail).reduce((sum, pnl) => sum + pnl, 0) / tail : 0, worst: sorted[0] ?? 0, realizedMdd: mdd };
}

function buildDailyRecords(candidates: readonly CandidateDecision[], dates: readonly string[]): QqqEb7P6R9DailyRecord[] {
  const byDate = new Map<string, CandidateDecision[]>();
  for (const candidate of candidates) byDate.set(candidate.openDate, [...(byDate.get(candidate.openDate) ?? []), candidate]);
  return dates.map((date) => {
    const decisions = byDate.get(date) ?? [];
    const accepted = decisions.find((decision) => decision.accepted);
    const layers = Object.fromEntries(PRIORITY.map((layer) => {
      const decision = decisions.find((item) => item.layer === layer);
      return [layer, decision
        ? { status: decision.accepted ? 'ACCEPTED' as const : 'PREEMPTED' as const, signal: null, accepted: decision.accepted, reasons: decision.accepted ? ['按实际 openDate 通过 EB7 > P6 > R9 共享优先级'] : [`被 ${decision.selectedLayer} 优先层抢占`] }
        : { status: 'NO_CANDIDATE' as const, signal: null, accepted: false, reasons: [] }];
    })) as QqqEb7P6R9DailyRecord['layers'];
    return { date, layers, acceptedLayer: accepted?.layer ?? null, priorityDecision: accepted ? `${accepted.layer} 通过实际 openDate 优先级 EB7 > P6 > R9` : '当日没有被 EB7 > P6 > R9 共享 coordinator 接受的开仓' };
  });
}

function unrealized(row: Cycle, date: string, data: MarketDataSet) {
  const match = row.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  const bar = data.qqqBars.find(item => day(item.date) === date);
  if (!match || !bar || !row.expiry) return 0;
  const rawVol = data.vxnByDate[date] ?? data.vixByDate[date] ?? 20;
  const vol = normalizeVolIndexForMockOptions(rawVol, 'VXN');
  const rawVol3m = data.vix3mByDate[date];
  const vol3m = rawVol3m != null && rawVol > 0 ? rawVol3m * (vol / rawVol) : undefined;
  return closeOptionPosition({ openingCashImpact: row.open.cashImpact, legs: [{ symbol: 'QQQ', type: 'put', side: 'short', strike: Number(match[2]), expiry: row.expiry, quantity: row.open.quantity }, { symbol: 'QQQ', type: 'put', side: 'long', strike: Number(match[1]), expiry: row.expiry, quantity: row.open.quantity }] }, createLegacyOptionMarket({ asOfDate: date, prices: { QQQ: bar.close }, vix: vol, vix3m: vol3m }), { spreadMultiplier: 1, skewSlope: MOCK_OPTION_CALIBRATION.skewSlope, riskFreeRate: .045 }).pnl;
}

function unifiedMtm(rows: readonly Cycle[], data: MarketDataSet, startDate: string, endDate: string) {
  const closes = new Map<string, number>();
  for (const row of rows) if (isCompleted(row)) closes.set(day(row.close.date), (closes.get(day(row.close.date)) ?? 0) + row.pnl);
  let realized = 0; let peak = INITIAL_CAPITAL; let runningPeakDate: string | null = null; let mdd = 0; let peakDate: string | null = null; let troughDate: string | null = null; let peakNav = INITIAL_CAPITAL; let troughNav = INITIAL_CAPITAL;
  const snapshots: EquityPoint[] = [];
  for (const bar of data.qqqBars.filter(item => day(item.date) >= startDate && day(item.date) <= endDate)) {
    const date = day(bar.date);
    realized += closes.get(date) ?? 0;
    const open = rows.filter(row => row.openDate <= date && (!row.close || day(row.close.date) > date));
    const nav = INITIAL_CAPITAL + realized + open.reduce((sum, row) => sum + unrealized(row, date, data), 0);
    if (nav > peak) { peak = nav; runningPeakDate = date; }
    if (peak - nav > mdd) { mdd = peak - nav; peakDate = runningPeakDate; troughDate = date; peakNav = peak; troughNav = nav; }
    snapshots.push({ date, nav, tqqqValue: 0, boxxValue: 0, cashValue: nav, tqqqPct: 0, boxxPct: 0, regime: 'SIDEWAYS', trend: 'NEUTRAL', systemStatus: 'OK', qqqPrice: bar.close });
  }
  return { snapshots, mdd: { value: -mdd, peakDate, troughDate, interval: { startDate: peakDate, endDate: troughDate }, peakNav, troughNav, sourceLayers: [...new Set(rows.map(row => row.layer))] as Layer[] } };
}

function metricsFor(rows: readonly Cycle[], snapshots: readonly EquityPoint[], startDate: string, endDate: string): PerformanceMetrics {
  const m = metric(rows);
  const years = Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86400000));
  const endNav = INITIAL_CAPITAL + m.pnl;
  const cagr = (Math.pow(Math.max(endNav / INITIAL_CAPITAL, 0), 1 / years) - 1) * 100;
  return { totalReturnPct: m.pnl / INITIAL_CAPITAL * 100, cagr: Number.isFinite(cagr) ? cagr : 0, sharpeRatio: 0, maxDrawdownPct: Math.abs(m.realizedMdd) / INITIAL_CAPITAL * 100, calmarRatio: m.realizedMdd ? cagr / (Math.abs(m.realizedMdd) / INITIAL_CAPITAL * 100) : 0, totalTrades: m.n, equityFlipCount: 0, whipsawCostPct: 0, tradingDays: snapshots.length, startNAV: INITIAL_CAPITAL, endNAV: endNav, startDate, endDate };
}

function resolvedEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet): string {
  const qqqEnd = day(data.qqqBars.at(-1)?.date);
  const tqqqEnd = day(data.tqqqBars.at(-1)?.date);
  const availableEndDate = qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
  const resolved = requestedEndDate < availableEndDate ? requestedEndDate : availableEndDate;
  if (!resolved || resolved < startDate) throw new Error(`EB7.P6.R9 replay range unavailable: ${startDate}..${requestedEndDate}`);
  return resolved;
}

function commonSpec(startDate: string, endDate: string) { return buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' }); }
function r9WithData(startDate: string, endDate: string, data: MarketDataSet, execution?: ReturnType<typeof executionFromQqqCompositeReplaySession>, rescueOverrides: Partial<StrategyParams> = QQQ_EB7_P6_R9_RESCUE_OVERRIDES as unknown as Partial<StrategyParams>) {
  const spec = commonSpec(startDate, endDate);
  return runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true, trace: true }, scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true }, strategyOverrides: { ...spec.strategyOverrides, ...rescueOverrides } as never }, data, undefined, execution) as V2BacktestResult;
}

export type QqqEb7P6R9ReplayBuildOptions = Readonly<{ executionMode?: 'shared' | 'isolated'; profiler?: QqqReplayProfiler; recoveryTraceMode?: 'minimal' | 'full'; parallelWorkers?: boolean; rescueOverrides?: Partial<StrategyParams>; pcsOptions?: Partial<QqqP4DynamicReplayOptions>; pcsMode?: 'E385' | 'E218'; equityBoostMode?: 'EB7.E175' | 'EB7.E209' | 'EB6.E209'; canonicalOptionSignalTapeMode?: 'skip' | 'legacy' }>;
type CompositeEquityBoostArm = { dailySignals: QqqPcsReplayDailySignal[]; cycles: readonly QqqEb2Cycle[]; dataFingerprint: string };
async function timedReplayStage<T>(profiler: QqqEb7P6R9ReplayBuildOptions['profiler'], stage: string, task: () => Promise<T>): Promise<T> {
  if (!profiler) return task();
  const started = Date.now();
  const result = await task();
  profiler.record(stage, Date.now() - started);
  return result;
}

export async function buildQqqEb7P6R9ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb7P6R9ReplayBuildOptions = {}): Promise<BacktestResult & { replayVariant: typeof QQQ_EB7_P6_R9_REPLAY_VARIANT; replayVersion: typeof QQQ_EB7_P6_R9_REPLAY_VERSION; dataFingerprint: string; requestedStartDate: string; requestedEndDate: string; resolvedEndDate: string; daily: readonly QqqEb7P6R9DailyRecord[]; unifiedMtmMdd: ReturnType<typeof unifiedMtm>['mdd']; pendingOpenPositions: readonly QqqEb7P6R9CandidateCycle[]; acceptedLayerBreakdown: Record<Layer, { n: number; wins: number; losses: number; pnl: number }>; coordination: { preemptedCountsByLayer: Record<Layer, number>; oneOpenPerOpenDate: true } }> {
  const resolved = resolvedEndDate(startDate, endDate, data);
  // Vercel bundles the server module; source .ts workers are not deployable
  // entrypoints there. Preserve the worker arms' isolated execution semantics.
  const parallelWorkers = options.parallelWorkers && !process.env.VERCEL;
  const session = options.parallelWorkers ? undefined : options.executionMode === 'isolated' ? undefined : createQqqCompositeReplaySession(resolveRunSpec(commonSpec(startDate, endDate)), data);
  const execution = session ? executionFromQqqCompositeReplaySession(session) : undefined;
  // The page needs cycles, daily rows, and final risk metrics; it does not
  // need EB7's intermediate research trace. Keep the full trace available for
  // explicit research callers, but make the production/default path pay only
  // for the executable result. These flags are diagnostics-only and are
  // parity-tested below at the candidate builder seam.
  const eb7Options = {
    canonicalOptionSignalTapeShared: options.canonicalOptionSignalTapeMode === 'legacy' ? false : true,
    ...(options.canonicalOptionSignalTapeMode ? { canonicalOptionSignalTapeMode: options.canonicalOptionSignalTapeMode } : {}),
    ...(execution ? { execution } : {}),
    ...(options.profiler ? { profiler: options.profiler } : {}),
    ...(options.recoveryTraceMode === 'full'
      ? { highRecoveryTrace: true, lowRecoveryTrace: true, intermediateRecoveryTrace: true, skipIntermediateMtm: false }
      : { highRecoveryTrace: false, lowRecoveryTrace: false, intermediateRecoveryTrace: false, skipIntermediateMtm: true }),
  };
  const p6Options = { ...(options.pcsMode === 'E218' ? QQQ_P6_E218_OPTIONS : QQQ_P6_E385_OPTIONS), ...options.pcsOptions, trace: false, canonicalOptionSignalStartDate: qqqCanonicalOptionSignalWarmupStartDate(startDate), ...(execution ? { execution } : {}) };
  const runSerialArms = () => Promise.all([
    timedReplayStage(options.profiler, `${options.equityBoostMode ?? 'EB7.E175'} adapter`, async (): Promise<CompositeEquityBoostArm> => {
      const replay = options.equityBoostMode === 'EB6.E209'
        ? await buildQqqEb6DynamicReplayWithData(startDate, endDate, data, execution ? { execution } : {})
        : options.equityBoostMode === 'EB7.E209'
          ? await buildQqqEb7E209DynamicReplayWithData(startDate, endDate, data, eb7Options)
          : await buildQqqEb7E175DynamicReplayWithData(startDate, endDate, data, eb7Options);
      return { cycles: replay.cycles, dataFingerprint: replay.dataFingerprint, dailySignals: qqqEbDailyAdmissions('admissionRaw' in replay ? replay.admissionRaw : replay.upstream.raw, replay.cycles) };
    }),
    timedReplayStage(options.profiler, 'P6.E385 adapter', () => buildQqqP4DynamicReplayWithData(startDate, endDate, data, p6Options)),
  ] as const);
  let eb7: CompositeEquityBoostArm;
  let p6: Awaited<ReturnType<typeof buildQqqP4DynamicReplayWithData>> | Pick<Awaited<ReturnType<typeof buildQqqP4DynamicReplayWithData>>, 'tradeLog' | 'dataFingerprint' | 'dailySignals'>;
  let r9: V2BacktestResult;
  if (parallelWorkers) {
    const [workerArms, r9Result] = await Promise.all([
      timedReplayStage(options.profiler, 'EB7/P6 worker arms', async () => {
        try {
          return await runQqqEb7P6R9ArmsInWorkers(startDate, endDate, data, options.equityBoostMode, options.pcsMode);
        } catch {
          // Some Node hosts do not expose the source worker as a runnable
          // module. Preserve correctness with the proven serial fallback.
          return undefined;
        }
      }),
      timedReplayStage(options.profiler, 'R9 adapter', () => Promise.resolve(r9WithData(startDate, endDate, data, undefined, options.rescueOverrides))),
    ]);
    r9 = r9Result;
    if (workerArms) {
      eb7 = workerArms.eb7;
      p6 = workerArms.p6;
    } else {
      [eb7, p6] = await runSerialArms();
    }
  } else {
    const [serialArms, r9Result] = await Promise.all([
      runSerialArms(),
      timedReplayStage(options.profiler, 'R9 adapter', () => Promise.resolve(r9WithData(startDate, endDate, data, execution, options.rescueOverrides))),
    ]);
    [eb7, p6] = serialArms;
    r9 = r9Result;
  }
  const cycles: Cycle[] = [
    ...eb7.cycles.map(cycle => ({ layer: 'EB7' as const, signalDate: day(cycle.open.signalDate ?? cycle.open.date), openDate: day(cycle.open.date), expiry: day(cycle.open.expiry), pnl: cycle.pnl, open: cycle.open, close: cycle.close, pending: false })),
    ...pairCycles(p6.tradeLog, 'P6'), ...pairCycles(r9.tradeLog, 'R9'),
  ];
  const coordinated = coordinateQqqCompositeCandidates(cycles, PRIORITY);
  const rows = coordinated.accepted;
  const metricResult = metric(rows);
  const mtmStarted = options.profiler ? Date.now() : 0;
  const mtm = unifiedMtm(rows, data, startDate, resolved);
  if (options.profiler) options.profiler.record('unified MTM', Date.now() - mtmStarted);
  const breakdown = Object.fromEntries(PRIORITY.map(layer => { const part = rows.filter(isCompleted).filter(row => row.layer === layer); return [layer, { n: part.length, wins: part.filter(row => row.pnl > 0).length, losses: part.filter(row => row.pnl <= 0).length, pnl: part.reduce((sum, row) => sum + row.pnl, 0) }]; })) as Record<Layer, { n: number; wins: number; losses: number; pnl: number }>;
  const pendingOpenPositions = rows.filter(row => row.pending);
  if (![eb7.dataFingerprint, p6.dataFingerprint, data.fingerprint].every(value => value === data.fingerprint)) throw new Error('EB7/P6/R9 dataFingerprint mismatch');
  if (new Set(rows.map(row => row.openDate)).size !== rows.length) throw new Error('EB7.P6.R9 oneOpenPerOpenDate invariant failed');
  const dailyTrace = new Map((r9.debug?.trace ?? []).map(entry => [day(entry.date), entry]));
  const ebDailySignals = new Map(eb7.dailySignals.map(signal => [signal.date, signal]));
  const pcsDailySignals = new Map(p6.dailySignals.map(signal => [signal.date, signal]));
  const dailyBars = new Map(data.qqqBars.map(bar => [day(bar.date), bar]));
  return { replayVariant: QQQ_EB7_P6_R9_REPLAY_VARIANT, replayVersion: QQQ_EB7_P6_R9_REPLAY_VERSION, dataFingerprint: data.fingerprint, requestedStartDate: startDate, requestedEndDate: endDate, resolvedEndDate: resolved, daily: buildDailyRecords(coordinated.all, mtm.snapshots.map(snapshot => snapshot.date)).map(record => { const entry = dailyTrace.get(record.date); record.layers.EB7.signal = ebDailySignals.get(record.date) ?? null; record.layers.P6.signal = pcsDailySignals.get(record.date) ?? null; const market = entry?.marketState; const admission = entry?.overlay?.strategyAdmissions?.find(item => item.strategyTag === TAG.R9); if (admission) record.layers.R9.signal = { date: record.date, strategy: admission.strategyLabel, eligibility: admission.eligibility, reasons: admission.reasons, gates: admission.gates }; return { ...record, dailyInputs: { close: dailyBars.get(record.date)?.close, vix: data.vixByDate[record.date], vix3m: data.vix3mByDate[record.date], regime: market?.regime ?? 'UNKNOWN', rsi14: market?.rsi14, adx14: market?.adx14 } }; }), config: { ...commonSpec(startDate, endDate).config, startDate, endDate: resolved, initialCapital: INITIAL_CAPITAL }, equityCurve: mtm.snapshots, tradeLog: rows.flatMap(row => row.close ? [row.open, row.close] : [row.open]).sort((a, b) => `${day(a.date)}|${a.action === 'OPEN' ? 0 : 1}`.localeCompare(`${day(b.date)}|${b.action === 'OPEN' ? 0 : 1}`)), metrics: metricsFor(rows, mtm.snapshots, startDate, resolved), totalTrades: metricResult.n, wins: metricResult.wins, losses: metricResult.losses, winRate: metricResult.winRate, realizedPnl: metricResult.pnl, realizedMdd: metricResult.realizedMdd, cvar5: metricResult.cvar5, worstTrade: metricResult.worst, unifiedMtmMdd: mtm.mdd, pendingOpenPositions, acceptedLayerBreakdown: breakdown, coordination: { preemptedCountsByLayer: coordinated.preempted, oneOpenPerOpenDate: true }, debug: { trace: r9.debug?.trace }, warnings: [] } as BacktestResult & { replayVariant: typeof QQQ_EB7_P6_R9_REPLAY_VARIANT; replayVersion: typeof QQQ_EB7_P6_R9_REPLAY_VERSION; dataFingerprint: string; requestedStartDate: string; requestedEndDate: string; resolvedEndDate: string; daily: readonly QqqEb7P6R9DailyRecord[]; unifiedMtmMdd: ReturnType<typeof unifiedMtm>['mdd']; pendingOpenPositions: readonly QqqEb7P6R9CandidateCycle[]; acceptedLayerBreakdown: Record<Layer, { n: number; wins: number; losses: number; pnl: number }>; coordination: { preemptedCountsByLayer: Record<Layer, number>; oneOpenPerOpenDate: true } };
}

export async function buildQqqEb7P6R9LiveReplayResult(startDate: string, endDate: string) {
  const data = await loadRunData(resolveRunSpec(commonSpec(startDate, endDate)));
  return buildQqqEb7P6R9ReplayWithData(startDate, endDate, data);
}

export type QqqEb7P6R9ReplayResult = Awaited<ReturnType<typeof buildQqqEb7P6R9ReplayWithData>>;
export function buildQqqEb7P6R9DailySignalHistory(result: QqqEb7P6R9ReplayResult) {
  const accepted = new Map(result.tradeLog.filter(trade => trade.action === 'OPEN').map(trade => [day(trade.date), trade.strategyTag]));
  return result.equityCurve.map(point => ({ date: point.date, strategy: accepted.has(point.date) ? accepted.get(point.date) : undefined, eligibility: accepted.has(point.date) ? 'OPEN' as const : 'BLOCK' as const, reasons: accepted.has(point.date) ? ['按实际 openDate 通过 EB7 > P6 > R9 共享优先级'] : ['没有候选通过共享 openDate coordinator'], gates: [] }));
}
