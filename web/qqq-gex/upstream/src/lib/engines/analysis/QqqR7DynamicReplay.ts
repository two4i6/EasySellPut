import { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsHistoricalBacktest';
import { QQQ_R7_E0_REPLAY_VERSION, QQQ_R7_E0_STRATEGY_OVERRIDES } from './QqqEb6P4R7CandidateRegistry';
import type { BacktestTraceEntry, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import { runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';

const R7_TAG = 'QQQ_PCS_RESCUE' as const;
const day = (value: string | undefined) => (value ?? '').slice(0, 10);

export type QqqR7Cycle = { open: TradeEntry; close: TradeEntry; pnl: number };
export type QqqR7DynamicReplay = {
  candidateId: 'R7.E0';
  replayVersion: typeof QQQ_R7_E0_REPLAY_VERSION;
  dataFingerprint: string;
  requestedStartDate: string;
  requestedEndDate: string;
  resolvedEndDate: string;
  raw: V2BacktestResult;
  cycles: readonly QqqR7Cycle[];
  metrics: { n: number; wins: number; losses: number; winRate: number; pnl: number; cvar5: number; worst: number; mdd: number };
  audit: {
    currentBarFeatures: true;
    settledPnlStateUpdates: true;
    retrospectiveSelection: false;
    onCloseUsesRealSettlement: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

function resolvedEndDate(startDate: string, requestedEndDate: string, data: MarketDataSet) {
  const qqqEnd = day(data.qqqBars.at(-1)?.date);
  const tqqqEnd = day(data.tqqqBars.at(-1)?.date);
  const available = qqqEnd < tqqqEnd ? qqqEnd : tqqqEnd;
  const resolved = requestedEndDate < available ? requestedEndDate : available;
  if (!resolved || resolved < startDate) throw new Error(`R7.E0 replay range unavailable: ${startDate}..${requestedEndDate}`);
  return resolved;
}

function pairCycles(log: readonly TradeEntry[]): QqqR7Cycle[] {
  const opens = new Map<string, TradeEntry[]>();
  const cycles: QqqR7Cycle[] = [];
  for (const trade of log) {
    if (trade.strategyTag !== R7_TAG) continue;
    const key = `${trade.symbol}|${trade.expiry ?? ''}`;
    if (trade.action === 'OPEN') { const queue = opens.get(key) ?? []; queue.push(trade); opens.set(key, queue); continue; }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    if (!Number.isFinite(trade.pnl)) continue;
    const open = opens.get(key)?.shift();
    if (open) cycles.push({ open, close: trade, pnl: trade.pnl! });
  }
  return cycles.sort((left, right) => day(left.open.signalDate ?? left.open.date).localeCompare(day(right.open.signalDate ?? right.open.date)));
}

function metrics(cycles: readonly QqqR7Cycle[]) {
  const pnls = cycles.map(cycle => cycle.pnl);
  const sorted = [...pnls].sort((a, b) => a - b);
  const wins = pnls.filter(pnl => pnl > 0).length;
  let equity = 0; let peak = 0; let mdd = 0;
  for (const cycle of cycles) { equity += cycle.pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  const tail = pnls.length ? Math.max(1, Math.ceil(pnls.length * .05)) : 0;
  return { n: pnls.length, wins, losses: pnls.length - wins, winRate: pnls.length ? wins / pnls.length : 0, pnl: pnls.reduce((sum, pnl) => sum + pnl, 0), cvar5: tail ? sorted.slice(0, tail).reduce((sum, pnl) => sum + pnl, 0) / tail : 0, worst: sorted[0] ?? 0, mdd };
}

export async function buildQqqR7DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqR7DynamicReplay> {
  const resolvedEnd = resolvedEndDate(startDate, endDate, data);
  const spec = buildQqqPcsHistoricalBacktestSpec({ startDate, endDate: resolvedEnd, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
  const raw = runWithData({
    ...spec,
    config: { ...spec.config, includeTerminalMarkOnly: true, trace: true },
    scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true },
    strategyOverrides: { ...spec.strategyOverrides, ...QQQ_R7_E0_STRATEGY_OVERRIDES, pcsRescueResearchComplementMode: 'p3_r7_e0_v1', pcsRescuePromoteOnMainProposal: true },
  }, data) as V2BacktestResult & { debug?: { trace?: BacktestTraceEntry[] } };
  const cycles = pairCycles(raw.tradeLog);
  return {
    candidateId: 'R7.E0', replayVersion: QQQ_R7_E0_REPLAY_VERSION, dataFingerprint: data.fingerprint,
    requestedStartDate: startDate, requestedEndDate: endDate, resolvedEndDate: resolvedEnd, raw, cycles,
    metrics: metrics(cycles),
    audit: { currentBarFeatures: true, settledPnlStateUpdates: true, retrospectiveSelection: false, onCloseUsesRealSettlement: true, noDateWhitelist: true, noFrozenTape: true, noWrapperTimeGate: true },
  };
}
