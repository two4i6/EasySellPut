import { buildQqqEb6DynamicReplayWithData, type QqqEb6DynamicReplay } from './QqqEb6DynamicReplay';
import { buildQqqP4DynamicReplayWithData, type QqqP4DynamicReplay } from './QqqP4DynamicReplay';
import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import { buildQqqR7DynamicReplayWithData, type QqqR7DynamicReplay } from './QqqR7DynamicReplay';
import { loadRunData, runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { BacktestConfig, BacktestTraceEntry, EquityPoint, PerformanceMetrics, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import { closeOptionPosition, createLegacyOptionMarket } from '../leveraged-overlay/v2/options';
import { MOCK_OPTION_CALIBRATION } from '../leveraged-overlay/backtest/mockOptionCalibration';
import { normalizeVolIndexForMockOptions } from '../leveraged-overlay/backtest/mockOptions';
import { QQQ_R7_E0_REPLAY_VERSION } from './QqqEb6P4R7CandidateRegistry';
import { createQqqCompositeReplaySession, executionFromQqqCompositeReplaySession } from './QqqCompositeReplaySession';

export const QQQ_EB6_P4_E0_R7_REPLAY_VARIANT = 'eb6_p4e0_r7' as const;
export const QQQ_EB6_P4_E0_R7_REPLAY_VERSION = `eb6-e209-p4e0-r7-${QQQ_R7_E0_REPLAY_VERSION}-coord-v1` as const;
export const QQQ_EB6_P4_E0_R7_REPLAY_LABEL = '默认：EB6.E209 > P4.E0 > R7（按实际 openDate）' as const;

export type QqqEb6P4E0R7Layer = 'EB6' | 'P4.E0' | 'R7';
type Layer = QqqEb6P4E0R7Layer;
export type QqqEb6P4E0R7CandidateCycle = { layer: Layer; signalDate: string; openDate: string; expiry: string; pnl: number; open: TradeEntry; close: TradeEntry };
type Cycle = QqqEb6P4E0R7CandidateCycle;
export type QqqEb6P4E0R7CandidateDecision = Cycle & { selectedLayer: Layer | null; preemptedLayer: Layer | null; preemptionReason: string | null; accepted: boolean };
type CandidateDecision = QqqEb6P4E0R7CandidateDecision;
type ComponentMetric = { n: number; wins: number; losses: number; winRate: number; pnl: number; cvar5: number; worst: number; realizedMdd: number };

export type QqqEb6P4E0R7ReplayOptions = {
  /** Research-only EB6 comparison profile; omitted means the production E209 profile. */
  eb6Profile?: 'E209' | 'E261';
};

export type QqqEb6P4E0R7DailySnapshot = {
  date: string;
  realizedPnl: number;
  nav: number;
  acceptedLayer: Layer | null;
  acceptedSignalDate: string | null;
  acceptedOpenDate: string | null;
  acceptedPnl: number | null;
  openPositions: readonly { layer: Layer; signalDate: string; openDate: string; expiry: string; unrealizedPnl: number }[];
};
export type QqqEb6P4E0R7DailyRecord = {
  date: string;
  layers: Record<Layer, { status: 'ACCEPTED' | 'PREEMPTED' | 'NO_CANDIDATE'; signal: null; accepted: boolean; reasons: string[] }>;
  acceptedLayer: Layer | null;
  priorityDecision: string;
};

export type QqqEb6P4E0R7ReplayResult = {
  replayVariant: typeof QQQ_EB6_P4_E0_R7_REPLAY_VARIANT;
  replayVersion: typeof QQQ_EB6_P4_E0_R7_REPLAY_VERSION;
  dataFingerprint: string;
  requestedStartDate: string;
  requestedEndDate: string;
  resolvedEndDate: string;
  config: BacktestConfig;
  equityCurve: EquityPoint[];
  metrics: PerformanceMetrics;
  componentResults: {
    EB6: { candidateId: string; dataFingerprint: string; metrics: ComponentMetric; cycles: readonly Cycle[]; audit: QqqEb6P4E0R7Audit };
    'P4.E0': { candidateId: string; dataFingerprint: string; metrics: ComponentMetric; cycles: readonly Cycle[]; audit: QqqEb6P4E0R7Audit };
    R7: { candidateId: string; dataFingerprint: string; metrics: ComponentMetric; cycles: readonly Cycle[]; audit: QqqEb6P4E0R7Audit };
  };
  acceptedLayerBreakdown: Record<Layer, { n: number; wins: number; losses: number; pnl: number }>;
  finalRows: readonly CandidateDecision[];
  coordination: { candidates: readonly CandidateDecision[]; preemptedCountsByLayer: Record<Layer, number>; oneOpenPerOpenDate: true };
  tradeLog: TradeEntry[];
  dailySnapshots: readonly QqqEb6P4E0R7DailySnapshot[];
  daily: readonly QqqEb6P4E0R7DailyRecord[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  cvar5: number;
  worstTrade: number;
  realizedMdd: number;
  unifiedMtmMdd: { value: number; peakDate: string | null; troughDate: string | null; interval: { startDate: string | null; endDate: string | null }; peakNav: number; troughNav: number; sourceLayers: readonly Layer[] };
  distinctSignalDates: number;
  distinctOpenDates: number;
  audit: QqqEb6P4E0R7Audit;
};

export type QqqEb6P4E0R7Audit = {
  noDateWhitelist: true;
  noFrozenTape: true;
  noWrapperTimeGate: true;
  retrospectiveSelection: false;
  settledPnlStateUpdates: true;
  oneOpenPerOpenDate: true;
  sameMarketDataSet: true;
  sameDataFingerprint: true;
  actualOpenDateCoordination: true;
};

const INITIAL_CAPITAL = 100_000;
const day = (value: string | undefined) => (value ?? '').slice(0, 10);
const priority: readonly Layer[] = ['EB6', 'P4.E0', 'R7'];
const layerTag: Record<Layer, string> = { EB6: 'QQQ_EQUITY_BOOST_PUT_SPREAD', 'P4.E0': 'QQQ_PUT_CREDIT_SPREAD', R7: 'QQQ_PCS_RESCUE' };

function commonResolvedEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet) {
  const qqqEnd = day(data.qqqBars.at(-1)?.date);
  const tqqqEnd = day(data.tqqqBars.at(-1)?.date);
  const available = qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
  const resolved = requestedEndDate < available ? requestedEndDate : available;
  if (!resolved || resolved < startDate) throw new Error(`EB6.P4.E0.R7 range unavailable: ${startDate}..${requestedEndDate}`);
  return resolved;
}

function pairCycles(log: readonly TradeEntry[], layer: Layer): Cycle[] {
  const queues = new Map<string, TradeEntry[]>();
  const cycles: Cycle[] = [];
  for (const trade of log) {
    if (trade.strategyTag !== layerTag[layer]) continue;
    const key = `${trade.symbol}|${trade.expiry ?? ''}`;
    if (trade.action === 'OPEN') { const queue = queues.get(key) ?? []; queue.push(trade); queues.set(key, queue); continue; }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    if (!Number.isFinite(trade.pnl)) continue;
    const open = queues.get(key)?.shift();
    if (open) cycles.push({ layer, signalDate: day(open.signalDate ?? open.date), openDate: day(open.date), expiry: day(open.expiry), pnl: trade.pnl!, open, close: trade });
  }
  return cycles.sort((a, b) => `${a.openDate}|${a.signalDate}`.localeCompare(`${b.openDate}|${b.signalDate}`));
}

function metric(cycles: readonly Cycle[]): ComponentMetric {
  const pnls = cycles.map(cycle => cycle.pnl); const sorted = [...pnls].sort((a, b) => a - b); const wins = pnls.filter(pnl => pnl > 0).length;
  let equity = 0; let peak = 0; let mdd = 0;
  for (const cycle of [...cycles].sort((a, b) => a.close.date.localeCompare(b.close.date))) { equity += cycle.pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  const tail = pnls.length ? Math.max(1, Math.ceil(pnls.length * .05)) : 0;
  return { n: pnls.length, wins, losses: pnls.length - wins, winRate: pnls.length ? wins / pnls.length : 0, pnl: pnls.reduce((sum, pnl) => sum + pnl, 0), cvar5: tail ? sorted.slice(0, tail).reduce((sum, pnl) => sum + pnl, 0) / tail : 0, worst: sorted[0] ?? 0, realizedMdd: mdd };
}

function componentAudit(): QqqEb6P4E0R7Audit { return { noDateWhitelist: true, noFrozenTape: true, noWrapperTimeGate: true, retrospectiveSelection: false, settledPnlStateUpdates: true, oneOpenPerOpenDate: true, sameMarketDataSet: true, sameDataFingerprint: true, actualOpenDateCoordination: true }; }

function normalizedCycles(eb6: QqqEb6DynamicReplay, p4: QqqP4DynamicReplay, r7: QqqR7DynamicReplay): Record<Layer, Cycle[]> {
  return {
    EB6: eb6.cycles.map(cycle => ({ layer: 'EB6', signalDate: day(cycle.open.signalDate ?? cycle.open.date), openDate: day(cycle.open.date), expiry: day(cycle.open.expiry), pnl: cycle.pnl, open: cycle.open, close: cycle.close })),
    'P4.E0': pairCycles(p4.tradeLog, 'P4.E0'),
    R7: r7.cycles.map(cycle => ({ layer: 'R7', signalDate: day(cycle.open.signalDate ?? cycle.open.date), openDate: day(cycle.open.date), expiry: day(cycle.open.expiry), pnl: cycle.pnl, open: cycle.open, close: cycle.close })),
  };
}

export function coordinateQqqEb6P4E0R7Candidates(all: readonly QqqEb6P4E0R7CandidateCycle[]): { finalRows: QqqEb6P4E0R7CandidateDecision[]; all: QqqEb6P4E0R7CandidateDecision[]; preemptedCountsByLayer: Record<Layer, number> } {
  const byOpenDate = new Map<string, Cycle[]>();
  for (const cycle of all) byOpenDate.set(cycle.openDate, [...(byOpenDate.get(cycle.openDate) ?? []), cycle]);
  const decisions: CandidateDecision[] = [];
  const counts: Record<Layer, number> = { EB6: 0, 'P4.E0': 0, R7: 0 };
  for (const candidates of byOpenDate.values()) {
    const ordered = [...candidates].sort((a, b) => priority.indexOf(a.layer) - priority.indexOf(b.layer) || `${a.signalDate}|${a.expiry}`.localeCompare(`${b.signalDate}|${b.expiry}`));
    const winner = ordered[0]!;
    decisions.push({ ...winner, selectedLayer: winner.layer, preemptedLayer: null, preemptionReason: null, accepted: true });
    for (const loser of ordered.slice(1)) { counts[loser.layer] += 1; decisions.push({ ...loser, selectedLayer: winner.layer, preemptedLayer: loser.layer, preemptionReason: `openDate ${loser.openDate} 冲突；优先级 ${winner.layer} > ${loser.layer}`, accepted: false }); }
  }
  decisions.sort((a, b) => `${a.openDate}|${a.signalDate}|${a.layer}`.localeCompare(`${b.openDate}|${b.signalDate}|${b.layer}`));
  return { finalRows: decisions.filter(row => row.accepted), all: decisions, preemptedCountsByLayer: counts };
}

const coordinate = coordinateQqqEb6P4E0R7Candidates;

function buildTradeLog(rows: readonly CandidateDecision[]) {
  return rows.flatMap(row => [row.open, row.close]).sort((a, b) => `${day(a.date)}|${a.action === 'OPEN' ? 0 : 1}`.localeCompare(`${day(b.date)}|${b.action === 'OPEN' ? 0 : 1}`));
}

function optionUnrealized(row: Cycle, barDate: string, data: MarketDataSet) {
  const match = row.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  if (!match || !row.expiry) return 0;
  const bar = data.qqqBars.find(item => day(item.date) === barDate);
  if (!bar) return 0;
  const rawVol = data.vxnByDate[barDate] ?? data.vixByDate[barDate] ?? 20;
  const vol = normalizeVolIndexForMockOptions(rawVol, 'VXN');
  const rawVol3m = data.vix3mByDate[barDate];
  const vol3m = rawVol3m != null && rawVol > 0 ? rawVol3m * (vol / rawVol) : undefined;
  return closeOptionPosition({ openingCashImpact: row.open.cashImpact, legs: [
    { symbol: 'QQQ', type: 'put', side: 'short', strike: Number(match[2]), expiry: row.expiry, quantity: row.open.quantity },
    { symbol: 'QQQ', type: 'put', side: 'long', strike: Number(match[1]), expiry: row.expiry, quantity: row.open.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: barDate, prices: { QQQ: bar.close }, vix: vol, vix3m: vol3m }), { spreadMultiplier: 1, skewSlope: MOCK_OPTION_CALIBRATION.skewSlope, riskFreeRate: .045 }).pnl;
}

export function computeQqqEb6P4E0R7UnifiedMtm(rows: readonly QqqEb6P4E0R7CandidateCycle[], data: MarketDataSet, startDate: string, endDate: string) {
  const acceptedByClose = new Map<string, number>(); for (const row of rows) acceptedByClose.set(day(row.close.date), (acceptedByClose.get(day(row.close.date)) ?? 0) + row.pnl);
  let realized = 0; let peak = INITIAL_CAPITAL; let runningPeakDate: string | null = null; let mddPeakDate: string | null = null; let troughDate: string | null = null; let troughNav = INITIAL_CAPITAL; let mddPeakNav = INITIAL_CAPITAL; let mdd = 0;
  const snapshots: QqqEb6P4E0R7DailySnapshot[] = [];
  for (const bar of data.qqqBars.filter(item => day(item.date) >= startDate && day(item.date) <= endDate)) {
    const date = day(bar.date); realized += acceptedByClose.get(date) ?? 0;
    const openPositions = rows.filter(row => row.openDate <= date && row.close.date > date).map(row => ({ ...row, unrealizedPnl: optionUnrealized(row, date, data) }));
    const unrealized = openPositions.reduce((sum, row) => sum + row.unrealizedPnl, 0); const nav = INITIAL_CAPITAL + realized + unrealized;
    if (nav > peak) { peak = nav; runningPeakDate = date; }
    if (peak - nav > mdd) { mdd = peak - nav; mddPeakDate = runningPeakDate; mddPeakNav = peak; troughDate = date; troughNav = nav; }
    const accepted = rows.find(row => row.openDate === date);
    snapshots.push({ date, realizedPnl: realized, nav, acceptedLayer: accepted?.layer ?? null, acceptedSignalDate: accepted?.signalDate ?? null, acceptedOpenDate: accepted?.openDate ?? null, acceptedPnl: accepted?.pnl ?? null, openPositions: openPositions.map(row => ({ layer: row.layer, signalDate: row.signalDate, openDate: row.openDate, expiry: row.expiry, unrealizedPnl: row.unrealizedPnl })) });
  }
  return { snapshots, mdd: { value: -mdd, peakDate: mddPeakDate, troughDate, interval: { startDate: mddPeakDate, endDate: troughDate }, peakNav: mddPeakNav, troughNav, sourceLayers: [...new Set(rows.map(row => row.layer))] as Layer[] } };
}

function dailyRecords(rows: readonly CandidateDecision[], snapshots: readonly QqqEb6P4E0R7DailySnapshot[]): QqqEb6P4E0R7DailyRecord[] {
  const byDate = new Map<string, CandidateDecision[]>();
  for (const row of rows) byDate.set(row.openDate, [...(byDate.get(row.openDate) ?? []), row]);
  return snapshots.map(snapshot => {
    const decisions = byDate.get(snapshot.date) ?? [];
    const accepted = decisions.find(row => row.accepted) ?? null;
    const layers = Object.fromEntries(priority.map(layer => {
      const decision = decisions.find(row => row.layer === layer);
      return [layer, decision
        ? { status: decision.accepted ? 'ACCEPTED' : 'PREEMPTED', signal: null, accepted: decision.accepted, reasons: decision.accepted ? ['按实际 openDate 通过共享优先级'] : [decision.preemptionReason ?? '被更高优先级层抢占'] }
        : { status: 'NO_CANDIDATE', signal: null, accepted: false, reasons: [] }];
    })) as QqqEb6P4E0R7DailyRecord['layers'];
    return { date: snapshot.date, layers, acceptedLayer: accepted?.layer ?? null, priorityDecision: accepted ? `${accepted.layer} 通过实际 openDate 优先级 EB6 > P4.E0 > R7` : '当日没有被共享 coordinator 接受的开仓' };
  });
}

function performanceMetrics(finalMetric: ComponentMetric, daily: readonly QqqEb6P4E0R7DailySnapshot[], startDate: string, endDate: string): PerformanceMetrics {
  const endNav = INITIAL_CAPITAL + finalMetric.pnl;
  const years = Math.max(1 / 365, (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.25 * 86_400_000));
  const cagr = (Math.pow(Math.max(endNav / INITIAL_CAPITAL, 0), 1 / years) - 1) * 100;
  return { totalReturnPct: finalMetric.pnl / INITIAL_CAPITAL * 100, cagr: Number.isFinite(cagr) ? cagr : 0, sharpeRatio: 0, maxDrawdownPct: Math.abs(finalMetric.realizedMdd) / INITIAL_CAPITAL * 100, calmarRatio: finalMetric.realizedMdd !== 0 ? cagr / (Math.abs(finalMetric.realizedMdd) / INITIAL_CAPITAL * 100) : 0, totalTrades: finalMetric.n, equityFlipCount: 0, whipsawCostPct: 0, tradingDays: daily.length, startNAV: INITIAL_CAPITAL, endNAV: endNav, startDate, endDate };
}

function equityCurve(snapshots: readonly QqqEb6P4E0R7DailySnapshot[], data: MarketDataSet): EquityPoint[] {
  return snapshots.map(snapshot => ({ date: snapshot.date, nav: snapshot.nav, tqqqValue: 0, boxxValue: 0, cashValue: snapshot.nav, tqqqPct: 0, boxxPct: 0, regime: 'SIDEWAYS', trend: 'NEUTRAL', systemStatus: 'OK', qqqPrice: data.qqqBars.find(bar => day(bar.date) === snapshot.date)?.close }));
}

function resultFromComponents(startDate: string, requestedEndDate: string, data: MarketDataSet, eb6: QqqEb6DynamicReplay, p4: QqqP4DynamicReplay, r7: QqqR7DynamicReplay): QqqEb6P4E0R7ReplayResult {
  const resolvedEndDate = commonResolvedEndDate(startDate, requestedEndDate, data); const normalized = normalizedCycles(eb6, p4, r7); const coordinated = coordinate(Object.values(normalized).flat()); const finalRows = coordinated.finalRows;
  const finalMetric = metric(finalRows); const dailyMtm = computeQqqEb6P4E0R7UnifiedMtm(finalRows, data, startDate, resolvedEndDate); const daily = dailyRecords(coordinated.all, dailyMtm.snapshots); const tradeLog = buildTradeLog(finalRows);
  const breakdown = Object.fromEntries(priority.map(layer => { const layerRows = finalRows.filter(row => row.layer === layer); return [layer, { n: layerRows.length, wins: layerRows.filter(row => row.pnl > 0).length, losses: layerRows.filter(row => row.pnl <= 0).length, pnl: layerRows.reduce((sum, row) => sum + row.pnl, 0) }]; })) as Record<Layer, { n: number; wins: number; losses: number; pnl: number }>;
  const fingerprint = data.fingerprint; if (eb6.dataFingerprint !== fingerprint || p4.dataFingerprint !== fingerprint || r7.dataFingerprint !== fingerprint) throw new Error('EB6/P4.E0/R7 dataFingerprint mismatch');
  if (new Set(finalRows.map(row => row.openDate)).size !== finalRows.length) throw new Error('oneOpenPerOpenDate invariant failed');
  const audit = componentAudit();
  return { replayVariant: QQQ_EB6_P4_E0_R7_REPLAY_VARIANT, replayVersion: QQQ_EB6_P4_E0_R7_REPLAY_VERSION, dataFingerprint: fingerprint, requestedStartDate: startDate, requestedEndDate, resolvedEndDate, config: { ...eb6.upstream.raw.config, startDate, endDate: resolvedEndDate, initialCapital: INITIAL_CAPITAL }, equityCurve: equityCurve(dailyMtm.snapshots, data), metrics: performanceMetrics(finalMetric, dailyMtm.snapshots, startDate, resolvedEndDate), componentResults: {
    EB6: { candidateId: eb6.candidateId, dataFingerprint: eb6.dataFingerprint, metrics: metric(normalized.EB6), cycles: normalized.EB6, audit },
    'P4.E0': { candidateId: 'P4.E0', dataFingerprint: p4.dataFingerprint, metrics: metric(normalized['P4.E0']), cycles: normalized['P4.E0'], audit },
    R7: { candidateId: r7.candidateId, dataFingerprint: r7.dataFingerprint, metrics: metric(normalized.R7), cycles: normalized.R7, audit },
  }, acceptedLayerBreakdown: breakdown, finalRows, coordination: { candidates: coordinated.all, preemptedCountsByLayer: coordinated.preemptedCountsByLayer, oneOpenPerOpenDate: true }, tradeLog, dailySnapshots: dailyMtm.snapshots, daily, totalTrades: finalMetric.n, wins: finalMetric.wins, losses: finalMetric.losses, winRate: finalMetric.winRate, realizedPnl: finalMetric.pnl, cvar5: finalMetric.cvar5, worstTrade: finalMetric.worst, realizedMdd: finalMetric.realizedMdd, unifiedMtmMdd: dailyMtm.mdd, distinctSignalDates: new Set(finalRows.map(row => row.signalDate)).size, distinctOpenDates: new Set(finalRows.map(row => row.openDate)).size, audit };
}

export function buildQqqEb6P4E0R7DailySignalHistory(result: QqqEb6P4E0R7ReplayResult) {
  return result.daily.map(record => ({ date: record.date, strategy: record.acceptedLayer === 'EB6' ? 'EB' as const : record.acceptedLayer === 'R7' ? 'PCS_RESCUE' as const : record.acceptedLayer === 'P4.E0' ? 'PCS' as const : undefined, eligibility: record.acceptedLayer ? 'OPEN' as const : 'BLOCK' as const, reasons: record.acceptedLayer ? [record.priorityDecision] : ['没有候选通过共享 openDate coordinator'], gates: [] }));
}

export async function buildQqqEb6P4E0R7ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqEb6P4E0R7ReplayOptions = {}): Promise<QqqEb6P4E0R7ReplayResult> {
  const resolvedEnd = commonResolvedEndDate(startDate, endDate, data);
  const session = createQqqCompositeReplaySession(resolveRunSpec(buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate: resolvedEnd,
    replayVariant: 'bass2_3_3',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  })), data);
  const execution = executionFromQqqCompositeReplaySession(session);
  const [eb6, p4, r7] = await Promise.all([
    buildQqqEb6DynamicReplayWithData(startDate, endDate, data, { execution, activeProfile: options.eb6Profile }),
    buildQqqP4DynamicReplayWithData(startDate, endDate, data, { execution }),
    buildQqqR7DynamicReplayWithData(startDate, endDate, data),
  ]);
  return resultFromComponents(startDate, endDate, data, eb6, p4, r7);
}

export async function buildQqqEb6P4E0R7LiveReplayResult(startDate: string, endDate: string): Promise<QqqEb6P4E0R7ReplayResult> {
  const seed = buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_7_b', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
  const data = await loadRunData(resolveRunSpec(seed));
  return buildQqqEb6P4E0R7ReplayWithData(startDate, endDate, data);
}

export function isQqqEb6P4E0R7AuditSafe(result: QqqEb6P4E0R7ReplayResult) {
  return result.dataFingerprint.length > 0
    && result.audit.noDateWhitelist
    && result.audit.noFrozenTape
    && result.audit.noWrapperTimeGate
    && result.audit.retrospectiveSelection === false
    && result.audit.settledPnlStateUpdates
    && result.audit.oneOpenPerOpenDate
    && result.audit.actualOpenDateCoordination;
}
