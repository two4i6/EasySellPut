import { buildQqqPcsHistoricalBacktestSpec, buildQqqPcsReplayDailySignalHistory, type QqqPcsHistoricalReplayResult, type QqqPcsReplayDailySignal } from './QqqPcsHistoricalBacktest';
import { computeRollingAdmission, computeScreenAdmission } from './QqqE1DynamicAdmission';
import { buildQqqReplayDailySnapshots } from './QqqReplaySnapshot';
import { loadFixture, type MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import { createBacktestSessionWithData, loadRunData, runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import type { BacktestResult, BacktestTraceEntry, OptionCycleDebug, TradeEntry } from '../leveraged-overlay/backtest/types';
import { resolveRunSpec, type BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';

/**
 * E1+P0+R2 是研究组合，不是 bass2.3.x 的单 spec 变体：
 * - E1 = E0-PL-L-FR，由当前引擎实时计算 rolling parent 与 admission；
 * - P0 = v1.2.7b/P0 PCS（V1.2.7b Candidate A + 倒挂 rescue 主链）；
 * - R2 = R1-smart-v6-slim-RV-Calm18-ATR1.40+Normal13.5 PCS_RESCUE；
 * - 共享协调：每天最多接受一个开仓，优先级 EB > PCS > PCS_RESCUE。
 *
 * 引擎的 SellerOpportunity PCS 独立回放不能在一次 runWithData 中同时承载
 * P0 Candidate A 主 PCS、EB 与独立 PCS_RESCUE；因此这里按 CLI 研究脚本一样
 * 分别跑三个账本，再在输出层做严格的一天一笔共享合并。本模块只用于
 * /analysis/qqq 的只读回放配置；线上入口使用当前引擎的 live historical data，
 * 研究脚本仍可显式调用 fixture wrapper 做可复现基准，不进入下单路径。
 */
export const QQQ_E1_P0_R2_REPLAY_VARIANT = 'e1_p0_r2' as const;
export const QQQ_E1_P0_R2_REPLAY_VERSION = 'e1-e0-pl-l-fr-dynamic-live-v1' as const;
export const QQQ_E1_P0_R2_REPLAY_LABEL = '研究：E1（当前引擎动态准入） + V1.2.7b/P0 PCS + R2 rescue' as const;

export type QqqE1P0R2LayerId = 'E1' | 'P0' | 'R2';
export type QqqE1P0R2LayerStatus = 'ACCEPTED' | 'PREEMPTED' | 'BLOCKED' | 'UNAVAILABLE' | 'NO_CANDIDATE';
export type QqqE1P0R2LayerRecord = {
  layer: QqqE1P0R2LayerId;
  status: QqqE1P0R2LayerStatus;
  signal: QqqPcsReplayDailySignal | null;
  accepted: boolean;
  reasons: string[];
};
export type QqqE1P0R2DailyRecord = {
  date: string;
  layers: Record<QqqE1P0R2LayerId, QqqE1P0R2LayerRecord>;
  acceptedLayer: QqqE1P0R2LayerId | null;
  priorityDecision: string;
};

const FIXTURE = (process.env.QQQ_E1_P0_R2_FIXTURE ?? 'market-2026-07-31-vxn') as 'market-2026-07-31-vxn' | 'market-2026-07-03-vxn' | 'market-2026-07-21-vxn' | 'market-2026-09-09-vxn';
const EB_TAG = 'QQQ_EQUITY_BOOST_PUT_SPREAD' as const;
const PCS_TAG = 'QQQ_PUT_CREDIT_SPREAD' as const;
const RESCUE_TAG = 'QQQ_PCS_RESCUE' as const;
const INITIAL_NAV = 100_000;
const dynamicE1AdmissionCache = new Map<string, Promise<Set<string>>>();

type Result = V2BacktestResult & { debug?: { optionCycles?: OptionCycleDebug[]; trace?: BacktestTraceEntry[] } };
type PnlRow = { date: string; pnl: number; kind: 'EB' | 'PCS' | 'PCS-rescue' };
type Cycle = { open: TradeEntry; close: TradeEntry; pnl: number };

export type QqqE1DynamicEbCycle = Cycle;
export type QqqE1DynamicEbReplay = {
  dataFingerprint: string;
  endDate: string;
  admissionSignalDates: ReadonlySet<string>;
  result: V2BacktestResult;
  cycles: QqqE1DynamicEbCycle[];
};

const day = (value: string | undefined) => (value ?? '').slice(0, 10);

function pairCycles(result: V2BacktestResult, tag: string): Cycle[] {
  const queues = new Map<string, TradeEntry[]>();
  const out: Cycle[] = [];
  for (const t of result.tradeLog) {
    if (t.strategyTag !== tag) continue;
    const key = `${t.symbol}|${t.expiry ?? ''}`;
    if (t.action === 'OPEN') {
      const q = queues.get(key) ?? [];
      q.push(t);
      queues.set(key, q);
      continue;
    }
    if (t.action !== 'CLOSE' && t.action !== 'SETTLE') continue;
    if (!Number.isFinite(t.pnl)) continue;
    const open = queues.get(key)?.shift();
    if (open) out.push({ open, close: t, pnl: t.pnl! });
  }
  return out.sort((a, b) => day(a.open.date).localeCompare(day(b.open.date)));
}

function debugRescueRows(result: Result): PnlRow[] {
  return (result.debug?.optionCycles ?? [])
    .filter((c) => c.kind === 'PCS_RESCUE' && Number.isFinite(c.pnl))
    .map((c) => ({ date: day(c.openDate), pnl: c.pnl!, kind: 'PCS-rescue' as const }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function debugRows(result: Result, kind: 'PCS' | 'PCS_RESCUE'): PnlRow[] {
  return (result.debug?.optionCycles ?? [])
    .filter((c) => c.kind === kind && Number.isFinite(c.pnl))
    .map((c) => ({ date: day(c.openDate), pnl: c.pnl!, kind: kind === 'PCS' ? 'PCS' as const : 'PCS-rescue' as const }));
}

function runFixtureSpec(spec: unknown, data: MarketDataSet, session?: ReturnType<typeof createBacktestSessionWithData>): Result {
  return (session ? session.runSpec(spec as BacktestRunSpec) : runWithData(spec as BacktestRunSpec, data)) as Result;
}

function applyReplayDataSource(spec: unknown, dataSource: 'fixture' | 'live'): BacktestRunSpec {
  return {
    ...(spec as BacktestRunSpec),
    dataSource: dataSource === 'live' ? { kind: 'live' as const } : { kind: 'fixture' as const, fixtureId: FIXTURE },
  };
}

function resolvedEndDate(data: MarketDataSet, startDate: string, endDate: string) {
  const dataLast = day(data.tqqqBars[data.tqqqBars.length - 1]?.date);
  const resolved = endDate < dataLast ? endDate : dataLast;
  if (resolved < startDate) {
    throw new Error(`E1 动态回放窗口无数据：${startDate}..${resolved}（${data.fingerprint}）`);
  }
  return resolved;
}

async function resolveDynamicE1Admission(data: MarketDataSet, endDate: string, dataSource: 'fixture' | 'live'): Promise<Set<string>> {
  const cacheKey = `${dataSource}|${data.fingerprint}|${endDate}`;
  const cached = dynamicE1AdmissionCache.get(cacheKey);
  if (cached) return cached;
  const admissionPromise = Promise.resolve().then(() => {
      const rolling = computeRollingAdmission(data, { endDate, dataSource });
      const screen = computeScreenAdmission(data, rolling, { endDate, dataSource });
      return new Set(screen.rescue5Lite.rows.map((row: { date: string }) => row.date));
    }).catch((error) => {
      dynamicE1AdmissionCache.delete(cacheKey);
      throw error;
    });
  dynamicE1AdmissionCache.set(cacheKey, admissionPromise);
  return admissionPromise;
}

function pickDebugMatchedPairs(pairs: Cycle[], debug: readonly PnlRow[]): Cycle[] {
  const byDate = new Map<string, Cycle[]>();
  for (const pair of pairs) {
    const key = day(pair.open.date);
    const bucket = byDate.get(key) ?? [];
    bucket.push(pair);
    byDate.set(key, bucket);
  }
  const used = new Set<Cycle>();
  const out: Cycle[] = [];
  for (const row of debug) {
    const candidates = (byDate.get(row.date) ?? []).filter((pair) => !used.has(pair));
    if (!candidates.length) continue;
    const exact = candidates.find((pair) => Math.abs(pair.pnl - row.pnl) < .01);
    const chosen = exact ?? candidates[0]!;
    used.add(chosen);
    out.push(chosen);
  }
  return out;
}

function alignPairsToDebug(pairs: Cycle[], debug: readonly PnlRow[]): Cycle[] {
  const pnlByDate = new Map(debug.map((row) => [row.date, row.pnl]));
  return pairs.map((pair) => {
    const pnl = pnlByDate.get(day(pair.open.date));
    if (pnl === undefined || Math.abs(pair.pnl - pnl) < .0001) return pair;
    return { ...pair, pnl, close: { ...pair.close, pnl } };
  });
}

export function buildQqqE1P0R2EbSpec(startDate: string, endDate: string) {
  const built = buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate,
    replayVariant: 'bass2_3_3',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  });
  const eb = {
    ...built,
    dataSource: { kind: 'fixture' as const, fixtureId: FIXTURE },
    strategyOverrides: {
      ...built.strategyOverrides,
      enablePCS: false,
      enableEquityBoostPCS: true,
      equityBoostCandidate6Mdd: true,
      equityBoostRatioMin: .6,
      equityBoostRatioMax: 1.4,
      equityBoostRatioSelectionTarget: 1,
      equityBoostEntryMode: 'continuous' as const,
      equityBoostWidthMode: 'risk_adaptive_v1' as const,
      equityBoostDynamicWidthVxnThreshold: 22,
      equityBoostDynamicWidthLowVxnTargetPct: .05,
      equityBoostDynamicWidthHighVxnTargetPct: .045,
      equityBoostDteMode: 'risk_adaptive_hysteresis_v1' as const,
      equityBoostDynamicDteVxnThreshold: 24,
      equityBoostTargetDte: 35,
    },
  };
  return {
    ...eb,
    strategyOverrides: {
      ...eb.strategyOverrides,
      equityBoostCandidate6Mdd: false,
      equityBoostRatioMin: .5,
      equityBoostRatioMax: 1.5,
      equityBoostDynamicWidthLowVxnTargetPct: .06,
      equityBoostDynamicWidthHighVxnTargetPct: .055,
    },
  };
}

async function runQqqE1DynamicEbReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  dataSource: 'fixture' | 'live',
  session?: ReturnType<typeof createBacktestSessionWithData>,
): Promise<QqqE1DynamicEbReplay> {
  const resolvedEnd = resolvedEndDate(data, startDate, endDate);
  const ebSpec = applyReplayDataSource(buildQqqE1P0R2EbSpec(startDate, resolvedEnd), dataSource);
  const admissionSignalDates = await resolveDynamicE1Admission(data, resolvedEnd, dataSource);
  const result = runFixtureSpec({
    ...ebSpec,
    config: {
      ...ebSpec.config,
      includeTerminalMarkOnly: true,
      equityBoostEntryGate: ({ date: entryDate }: { date: string }) => !admissionSignalDates.has(entryDate),
    },
  }, data, session);
  return {
    dataFingerprint: data.fingerprint,
    endDate: resolvedEnd,
    admissionSignalDates,
    result,
    cycles: pairCycles(result, EB_TAG),
  };
}

/** Current-engine dynamic E1 ledger for research-only downstream overlays. */
export async function runQqqE1DynamicEbReplay(
  startDate: string,
  endDate: string,
  dataSource: 'fixture' | 'live' = 'fixture',
): Promise<QqqE1DynamicEbReplay> {
  if (dataSource === 'live') {
    const seed = applyReplayDataSource(buildQqqE1P0R2EbSpec(startDate, endDate), 'live');
    return runQqqE1DynamicEbReplayWithData(startDate, endDate, await loadRunData(resolveRunSpec(seed)), 'live');
  }
  return runQqqE1DynamicEbReplayWithData(startDate, endDate, await loadFixture(FIXTURE), 'fixture');
}

export function buildQqqE1P0R2ReplayDailySignalHistory(trace: readonly BacktestTraceEntry[] | undefined): QqqPcsReplayDailySignal[] {
  return (trace ?? []).flatMap((entry) => {
    const admission = entry.overlay?.strategyAdmissions?.find((candidate) => candidate.strategyTag === EB_TAG);
    if (!admission) return [];
    return [{
      date: entry.date,
      strategy: 'EB' as const,
      eligibility: admission.eligibility,
      reasons: admission.reasons,
      gates: admission.gates,
    }];
  });
}

export function buildV127bPcsSpec(startDate: string, endDate: string) {
  const built = buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate,
    replayVariant: 'v1_2_7_b',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  });
  return {
    ...built,
    dataSource: { kind: 'fixture' as const, fixtureId: FIXTURE },
    config: { ...built.config, includeTerminalMarkOnly: true },
    strategyOverrides: {
      ...built.strategyOverrides,
      enablePCS: true,
      enableEquityBoostPCS: false,
    },
  };
}

export function buildR2RescueSpec(startDate: string, endDate: string) {
  const built = buildQqqPcsHistoricalBacktestSpec({
    startDate,
    endDate,
    replayVariant: 'v1_2_6',
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
  });
  return {
    ...built,
    dataSource: { kind: 'fixture' as const, fixtureId: FIXTURE },
    config: { ...built.config, includeTerminalMarkOnly: true },
    strategyOverrides: {
      ...built.strategyOverrides,
      enablePCS: true,
      enableEquityBoostPCS: false,
      pcsRescueEnabled: true,
      pcsRescueEntryMode: 'reactive_soft_pool',
      pcsRescueRegimeScope: 'selective_quality_v16_atr',
      pcsRescueDeltaMode: 'range_smart_quality_v31',
      pcsRescuePressureDelta: .04,
      pcsRescueNormalDelta: .135,
      pcsRescueCalmDelta: .18,
      pcsRescueExtremeDelta: .2425,
      pcsRescueExtremeBaseDelta: .20,
      pcsRescueExtremeFallbackDelta: .18,
      pcsRescueWidthPct: .0216,
      pcsRescueExtremeWidthPct: .0325,
      pcsRescueTargetDte: 35,
      pcsRescueRiskBudgetNav: .005,
    },
  };
}

function acceptedTradeRows(cycles: Cycle[]): TradeEntry[] {
  const rows: TradeEntry[] = [];
  for (const cycle of cycles) {
    rows.push(cycle.open);
    rows.push(cycle.close);
  }
  return rows.sort((a, b) => day(a.date).localeCompare(day(b.date)));
}

function buildEquityCurve(accepted: readonly PnlRow[], data: Awaited<ReturnType<typeof loadFixture>>, startDate: string, endDate: string) {
  const pnlByDate = new Map<string, number>();
  for (const row of accepted) {
    pnlByDate.set(row.date, (pnlByDate.get(row.date) ?? 0) + row.pnl);
  }
  const dates = data.tqqqBars.map((b: any) => day(b.date)).filter((d: string) => d >= startDate && d <= endDate);
  const priceByDate = new Map(data.tqqqBars.map((b: any) => [day(b.date), b.close]));
  let nav = INITIAL_NAV;
  let peak = INITIAL_NAV;
  let maxDrawdownPct = 0;
  const points = dates.map((date) => {
    nav += pnlByDate.get(date) ?? 0;
    peak = Math.max(peak, nav);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - nav) / peak : 0);
    return {
      date,
      nav,
      tqqqValue: 0,
      boxxValue: 0,
      cashValue: nav,
      tqqqPct: 0,
      boxxPct: 0,
      regime: 'SIDEWAYS' as const,
      trend: 'NEUTRAL' as const,
      systemStatus: 'OK',
      qqqPrice: priceByDate.get(date),
    };
  });
  return { points, endNav: nav, maxDrawdownPct };
}

function computeMetrics(accepted: readonly PnlRow[], startDate: string, endDate: string, equityCurve: { points: unknown[]; endNav: number; maxDrawdownPct: number }) {
  const wins = accepted.filter((x) => x.pnl > 0).length;
  const totalReturnPct = (equityCurve.endNav - INITIAL_NAV) / INITIAL_NAV;
  const years = Math.max((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 / 365, 1 / 365);
  const cagr = Math.pow(equityCurve.endNav / INITIAL_NAV, 1 / years) - 1;
  return {
    totalReturnPct,
    cagr,
    sharpeRatio: 0,
    maxDrawdownPct: equityCurve.maxDrawdownPct,
    calmarRatio: equityCurve.maxDrawdownPct > 0 ? cagr / equityCurve.maxDrawdownPct : 0,
    totalTrades: accepted.length,
    equityFlipCount: 0,
    whipsawCostPct: 0,
    tradingDays: equityCurve.points.length,
    startNAV: INITIAL_NAV,
    endNAV: equityCurve.endNav,
    startDate,
    endDate,
  };
}

export type QqqE1P0R2SharedBreakdown = {
  byKind: Record<'EB' | 'PCS' | 'PCS-rescue', { n: number; pnl: number }>;
  byLayer: Record<QqqE1P0R2LayerId, { n: number; pnl: number; wins: number }>;
  acceptedDays: number;
  daily: QqqE1P0R2DailyRecord[];
};

export type QqqE1P0R2ReplayResult = BacktestResult & {
  dataFingerprint: string;
  qqqE1P0R2?: QqqE1P0R2SharedBreakdown;
};

function buildLayerHistory(trace: readonly BacktestTraceEntry[] | undefined, replayVariant: 'v1_2_6' | 'v1_2_7_b', strategyTagOverride?: 'QQQ_PCS_RESCUE'): QqqPcsReplayDailySignal[] {
  return buildQqqPcsReplayDailySignalHistory(
    trace,
    replayVariant,
    strategyTagOverride ?? undefined,
  );
}

export function buildQqqE1P0R2DailyRecords(
  histories: Record<QqqE1P0R2LayerId, readonly QqqPcsReplayDailySignal[]>,
  acceptedDates: Record<QqqE1P0R2LayerId, ReadonlySet<string>>,
): QqqE1P0R2DailyRecord[] {
  const dates = [...new Set(Object.values(histories).flatMap((history) => history.map((item) => item.date)).concat(Object.values(acceptedDates).flatMap((items) => [...items])))].sort();
  const priority: QqqE1P0R2LayerId[] = ['E1', 'P0', 'R2'];
  const historyMaps = Object.fromEntries((Object.keys(histories) as QqqE1P0R2LayerId[]).map((layer) => [layer, new Map(histories[layer].map((item) => [item.date, item]))])) as Record<QqqE1P0R2LayerId, Map<string, QqqPcsReplayDailySignal>>;
  return dates.map((date) => {
    const acceptedLayer = priority.find((layer) => acceptedDates[layer].has(date)) ?? null;
    const layers = Object.fromEntries(priority.map((layer) => {
      const signal = historyMaps[layer].get(date) ?? null;
      const accepted = acceptedDates[layer].has(date);
      const status: QqqE1P0R2LayerStatus = accepted
        ? 'ACCEPTED'
        : signal?.eligibility === 'UNAVAILABLE'
          ? 'UNAVAILABLE'
          : signal?.eligibility === 'BLOCK'
            ? 'BLOCKED'
            : signal?.eligibility === 'OPEN'
              ? acceptedLayer ? 'PREEMPTED' : 'NO_CANDIDATE'
              : 'NO_CANDIDATE';
      const reasons = accepted
        ? ['共享协调器接受该层并形成实际执行。', ...(signal?.eligibility === 'OPEN' ? signal.reasons : [])]
        : status === 'PREEMPTED' && acceptedLayer
          ? [`被优先层 ${acceptedLayer} 抢占；共享协调每天最多接受一笔。`, ...(signal?.reasons ?? [])]
          : (signal?.reasons ?? []);
      return [layer, { layer, status, signal, accepted, reasons } satisfies QqqE1P0R2LayerRecord];
    })) as Record<QqqE1P0R2LayerId, QqqE1P0R2LayerRecord>;
    return {
      date,
      layers,
      acceptedLayer,
      priorityDecision: acceptedLayer ? `${acceptedLayer} 通过共享优先级（E1 > P0 > R2）` : '当日没有被共享协调器接受的开仓',
    };
  });
}

export async function runQqqE1P0R2ReplayWithData(startDate: string, endDate: string, data: MarketDataSet, dataSource: 'fixture' | 'live', options: { executionMode?: 'shared' | 'isolated' } = {}): Promise<QqqE1P0R2ReplayResult> {
  const end = resolvedEndDate(data, startDate, endDate);
  const seed = applyReplayDataSource(buildQqqE1P0R2EbSpec(startDate, end), dataSource);
  const session = options.executionMode === 'isolated' ? undefined : createBacktestSessionWithData(seed, data);
  const ebReplay = await runQqqE1DynamicEbReplayWithData(startDate, endDate, data, dataSource, session);
  const resolvedEnd = ebReplay.endDate;
  const ebResult = ebReplay.result;
  const ebCycles = ebReplay.cycles;
  const ebDays = new Set(ebCycles.map((c) => day(c.open.date)));

  const pcsResult = runFixtureSpec(applyReplayDataSource(buildV127bPcsSpec(startDate, resolvedEnd), dataSource), data, session);
  const pcsAll = pairCycles(pcsResult, PCS_TAG);
  const pcsDebug = debugRows(pcsResult, 'PCS');
  const pcsAcceptedRows = pcsDebug.filter((r) => !ebDays.has(r.date));
  const pcsDays = new Set(pcsAcceptedRows.map((r) => r.date));
  const pcsAccepted = alignPairsToDebug(pickDebugMatchedPairs(pcsAll, pcsAcceptedRows), pcsAcceptedRows);

  const r2Result = runFixtureSpec(applyReplayDataSource(buildR2RescueSpec(startDate, resolvedEnd), dataSource), data, session);
  const rescueRows = debugRescueRows(r2Result);
  const rescueAcceptedRows = rescueRows.filter((r) => !ebDays.has(r.date) && !pcsDays.has(r.date));
  const rescueCycles = alignPairsToDebug(pickDebugMatchedPairs(pairCycles(r2Result, RESCUE_TAG), rescueAcceptedRows), rescueAcceptedRows);

  const ebRows = acceptedTradeRows(ebCycles);
  const pcsRows = acceptedTradeRows(pcsAccepted);
  const rescueRowsForLedger = acceptedTradeRows(rescueCycles);
  const tradeLog = [...ebRows, ...pcsRows, ...rescueRowsForLedger].sort((a, b) => day(a.date).localeCompare(day(b.date)));

  const accepted = [
    ...ebCycles.map((c) => ({ date: day(c.open.date), pnl: c.pnl, kind: 'EB' as const })),
    ...pcsAcceptedRows.map((c) => ({ date: c.date, pnl: c.pnl, kind: 'PCS' as const })),
    ...rescueAcceptedRows.map((c) => ({ date: c.date, pnl: c.pnl, kind: 'PCS-rescue' as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const byKind = {
    EB: { n: ebCycles.length, pnl: ebCycles.reduce((s, c) => s + c.pnl, 0) },
    PCS: { n: pcsAcceptedRows.length, pnl: pcsAcceptedRows.reduce((s, c) => s + c.pnl, 0) },
    'PCS-rescue': { n: rescueAcceptedRows.length, pnl: rescueAcceptedRows.reduce((s, c) => s + c.pnl, 0) },
  };

  const acceptedDates = {
    E1: new Set(ebCycles.map((cycle) => day(cycle.open.date))),
    P0: new Set(pcsAccepted.map((cycle) => day(cycle.open.date))),
    R2: new Set(rescueCycles.map((cycle) => day(cycle.open.date))),
  } as Record<QqqE1P0R2LayerId, ReadonlySet<string>>;
  const histories = {
    E1: buildQqqE1P0R2ReplayDailySignalHistory(ebResult.debug?.trace),
    P0: buildLayerHistory(pcsResult.debug?.trace, 'v1_2_7_b'),
    R2: buildLayerHistory(r2Result.debug?.trace, 'v1_2_6', RESCUE_TAG),
  } satisfies Record<QqqE1P0R2LayerId, readonly QqqPcsReplayDailySignal[]>;
  const daily = buildQqqE1P0R2DailyRecords(histories, acceptedDates);
  const byLayer = {
    E1: { n: ebCycles.length, pnl: byKind.EB.pnl, wins: ebCycles.filter((cycle) => cycle.pnl > 0).length },
    P0: { n: pcsAccepted.length, pnl: byKind.PCS.pnl, wins: pcsAccepted.filter((cycle) => cycle.pnl > 0).length },
    R2: { n: rescueCycles.length, pnl: byKind['PCS-rescue'].pnl, wins: rescueCycles.filter((cycle) => cycle.pnl > 0).length },
  } satisfies Record<QqqE1P0R2LayerId, { n: number; pnl: number; wins: number }>;

  const equity = buildEquityCurve(accepted, data, startDate, resolvedEnd);
  const metrics = computeMetrics(accepted, startDate, resolvedEnd, equity);
  return {
    dataFingerprint: data.fingerprint,
    config: { ...ebResult.config, includeTerminalMarkOnly: true },
    equityCurve: equity.points,
    tradeLog,
    metrics,
    debug: {
      trace: ebResult.debug?.trace,
      optionCycles: [
        ...ebCycles.map((c) => ({ kind: 'EB' as const, openDate: day(c.open.date), closeDate: day(c.close.date), exitKey: String(c.close.outcomeReasonKey ?? ''), credit: 0, pnl: c.pnl })),
        ...pcsAccepted.map((c) => ({ kind: 'PCS' as const, openDate: day(c.open.date), closeDate: day(c.close.date), exitKey: String(c.close.outcomeReasonKey ?? ''), credit: 0, pnl: c.pnl })),
        ...rescueCycles.map((c) => ({ kind: 'PCS_RESCUE' as const, openDate: day(c.open.date), closeDate: day(c.close.date), exitKey: String(c.close.outcomeReasonKey ?? ''), credit: 0, pnl: c.pnl })),
      ],
    },
    qqqE1P0R2: {
      byKind,
      byLayer,
      acceptedDays: new Set(accepted.map((r) => r.date)).size,
      daily,
    },
  } as unknown as QqqE1P0R2ReplayResult;
}

/** Research-only reproducible fixture replay. */
export async function runQqqE1P0R2Replay(startDate: string, endDate: string): Promise<QqqE1P0R2ReplayResult> {
  return runQqqE1P0R2ReplayWithData(startDate, endDate, await loadFixture(FIXTURE), 'fixture');
}

/** Online analysis replay: current engine + current live historical market data. */
export async function runQqqE1P0R2LiveReplay(startDate: string, endDate: string): Promise<QqqE1P0R2ReplayResult> {
  const seed = applyReplayDataSource(buildQqqE1P0R2EbSpec(startDate, endDate), 'live');
  const data = await loadRunData(resolveRunSpec(seed));
  return runQqqE1P0R2ReplayWithData(startDate, endDate, data, 'live');
}

export async function buildQqqE1P0R2ReplayResult(startDate: string, endDate: string): Promise<QqqPcsHistoricalReplayResult> {
  const result = await runQqqE1P0R2Replay(startDate, endDate);
  return buildQqqE1P0R2ReplayResultFromRun(result);
}

export async function buildQqqE1P0R2LiveReplayResult(startDate: string, endDate: string): Promise<QqqPcsHistoricalReplayResult> {
  const result = await runQqqE1P0R2LiveReplay(startDate, endDate);
  return buildQqqE1P0R2ReplayResultFromRun(result);
}

/** The combined frontend supplies one snapshot to both PCS composition and CCS. */
export async function buildQqqE1P0R2ReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqPcsHistoricalReplayResult> {
  return buildQqqE1P0R2ReplayResultFromRun(await runQqqE1P0R2ReplayWithData(startDate, endDate, data, 'live'));
}

function buildQqqE1P0R2ReplayResultFromRun(result: BacktestResult & { qqqE1P0R2?: QqqE1P0R2SharedBreakdown }): QqqPcsHistoricalReplayResult {
  return {
    ...result,
    pcsDailySignalHistory: buildQqqE1P0R2ReplayDailySignalHistory(result.debug?.trace),
    pcsDailyReplaySnapshots: buildQqqReplayDailySnapshots(result.debug?.trace, 'pcs', result.tradeLog, {
      equityCurve: result.equityCurve,
    }),
  };
}
