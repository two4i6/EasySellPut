import type { BacktestConfig, CollarLifecycleDebug, EquityPoint, OptionCycleDebug, TradeEntry } from './types';
import { reasonLabel } from '../reasonLabels';
import { OVERLAY_STRATEGY_TAGS } from '../constants';

export type BreakdownItem = {
  key: string;
  label: string;
  cycleCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number;
  pnl: number;
  avgPnlPerCycle: number;
};

export type AttributionItem = {
  pnl: number;
  finalValue?: number;
  cashFlow?: number;
  tradeCount: number;
  openCount?: number;
  closeOrSettleCount?: number;
  cycleCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number;
  avgPnlPerCycle: number;
  profitFactor: number;
  bestCyclePnl: number;
  worstCyclePnl: number;
  maxDrawdown: number;
  maxDrawdownPctOfInitialCapital: number;
  breakdowns?: {
    byExecutionReason: BreakdownItem[];
    byOutcomeReason: BreakdownItem[];
    byEntryRegime: BreakdownItem[];
    byEntryTrend: BreakdownItem[];
  };
};

export type TradeAttribution = {
  leveragedSymbol: string;
  tqqqSpot: AttributionItem;
  boxxSpot: AttributionItem;
  ironCondor: AttributionItem;
  callCreditSpreads: AttributionItem;
  bearCallSpreads: AttributionItem;
  collar: AttributionItem;
  putCreditSpreads: AttributionItem;
  equityBoostPutSpreads: AttributionItem;
  pcsRescuePutSpreads?: AttributionItem;
};

export type CollarLifecycleAttribution = {
  cycleCount: number;
  closedCount: number;
  lossCount: number;
  totalPnl: number;
  lossPnl: number;
  lossIntrinsicPnl: number;
  lossResidualTimeValuePnl: number;
  regimeFlipRoundTripCount: number;
};

export function summarizeCollarLifecycles(lifecycles: CollarLifecycleDebug[] = []): CollarLifecycleAttribution {
  const closed = lifecycles.filter(item => item.pnl != null);
  const losses = closed.filter(item => (item.pnl ?? 0) < 0);
  return {
    cycleCount: lifecycles.length,
    closedCount: closed.length,
    lossCount: losses.length,
    totalPnl: closed.reduce((sum, item) => sum + (item.pnl ?? 0), 0),
    lossPnl: losses.reduce((sum, item) => sum + (item.pnl ?? 0), 0),
    lossIntrinsicPnl: losses.reduce((sum, item) => sum + (item.pnlBreakdown?.intrinsicPnl ?? 0), 0),
    lossResidualTimeValuePnl: losses.reduce((sum, item) => sum + (item.pnlBreakdown?.residualTimeValuePnl ?? 0), 0),
    regimeFlipRoundTripCount: closed.filter(item => item.regimeFlipRoundTrip).length,
  };
}

export function isOptionTrade(t: TradeEntry): boolean {
  return t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD ||
    t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE;
}

export function isOptionSettle(t: TradeEntry): boolean {
  return t.action === 'SETTLE';
}

export function isOptionClose(t: TradeEntry): boolean {
  return t.action === 'CLOSE';
}

export function isOptionOpen(t: TradeEntry): boolean {
  return t.action === 'OPEN';
}

function updateBreakdown(
  map: Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>,
  key: string,
  label: string,
  pnl: number
) {
  const existing = map.get(key) || { label, cycleCount: 0, win: 0, loss: 0, breakeven: 0, pnl: 0 };
  existing.label = label;
  existing.cycleCount++;
  existing.pnl += pnl;
  if (pnl > 0) {
    existing.win++;
  } else if (pnl < 0) {
    existing.loss++;
  } else {
    existing.breakeven++;
  }
  map.set(key, existing);
}

function mapToBreakdownItems(
  map: Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>
): BreakdownItem[] {
  const items: BreakdownItem[] = [];
  map.forEach((val, key) => {
    items.push({
      key,
      label: val.label,
      cycleCount: val.cycleCount,
      winCount: val.win,
      lossCount: val.loss,
      breakevenCount: val.breakeven,
      winRatePct: val.cycleCount > 0 ? (val.win / val.cycleCount) * 100 : 0,
      pnl: val.pnl,
      avgPnlPerCycle: val.cycleCount > 0 ? val.pnl / val.cycleCount : 0,
    });
  });
  return items;
}

function computeCyclePnlStats(cyclePnls: number[], initialCapital: number) {
  let positivePnl = 0;
  let negativePnl = 0;
  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  for (const pnl of cyclePnls) {
    if (pnl > 0) positivePnl += pnl;
    if (pnl < 0) negativePnl += pnl;

    cumulativePnl += pnl;
    peakPnl = Math.max(peakPnl, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peakPnl - cumulativePnl);
  }

  return {
    avgPnlPerCycle: cyclePnls.length > 0 ? cyclePnls.reduce((sum, pnl) => sum + pnl, 0) / cyclePnls.length : 0,
    profitFactor: negativePnl < 0 ? positivePnl / Math.abs(negativePnl) : positivePnl > 0 ? Infinity : 0,
    bestCyclePnl: cyclePnls.length > 0 ? Math.max(...cyclePnls) : 0,
    worstCyclePnl: cyclePnls.length > 0 ? Math.min(...cyclePnls) : 0,
    maxDrawdown,
    maxDrawdownPctOfInitialCapital: initialCapital > 0 ? maxDrawdown / initialCapital : 0,
  };
}

function environmentLabel(key: string): string {
  const labels: Record<string, string> = {
    BULL: '牛市',
    RISK_ON_EXTENDED: '风险偏好过热',
    RISK_ON_WEAKENING: '风险偏好转弱',
    SIDEWAYS: '震荡',
    RANGE_BOUND: '区间震荡',
    BEAR: '熊市',
    CRISIS: '危机',
    STRONG_BULL: '强牛趋势',
    NEUTRAL: '中性趋势',
    STRONG_BEAR: '强熊趋势',
    unknown: '未知',
  };
  return labels[key] ?? key;
}

function computeOptionStats(trades: TradeEntry[], initialCapital: number) {
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let cycleCount = 0;
  const cyclePnls: number[] = [];

  const execReasonMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const outcomeReasonMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const entryRegimeMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const entryTrendMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();

  // 按 symbol 分组，以执行 FIFO 配对
  const groups: { [symbol: string]: TradeEntry[] } = {};
  for (const t of trades) {
    if (!groups[t.symbol]) {
      groups[t.symbol] = [];
    }
    groups[t.symbol].push(t);
  }

  for (const symbol in groups) {
    const symbolTrades = groups[symbol];
    const openQueue: TradeEntry[] = [];
    for (const t of symbolTrades) {
      if (isOptionOpen(t)) {
        openQueue.push(t);
      } else if (isOptionClose(t) || isOptionSettle(t)) {
        if (openQueue.length > 0) {
          const openTrade = openQueue.shift()!;
          let pnl = t.pnl;
          if (pnl === undefined) {
            pnl = openTrade.cashImpact + t.cashImpact;
          }
          cycleCount++;
          if (pnl > 0) {
            winCount++;
          } else if (pnl < 0) {
            lossCount++;
          } else {
            breakevenCount++;
          }
          cyclePnls.push(pnl);

          // 收集 OPEN 环境及 CLOSE 退出原因
          const execKey = openTrade.executionReasonKey || 'unknown';
          const outcomeKey = t.outcomeReasonKey || 'unknown';
          const entryRegime = openTrade.marketContext?.regime || 'unknown';
          const entryTrend = openTrade.marketContext?.trend || 'unknown';

          updateBreakdown(execReasonMap, execKey, reasonLabel(execKey, openTrade.executionReason), pnl);
          updateBreakdown(outcomeReasonMap, outcomeKey, reasonLabel(outcomeKey, t.outcomeReason), pnl);
          updateBreakdown(entryRegimeMap, entryRegime, environmentLabel(entryRegime), pnl);
          updateBreakdown(entryTrendMap, entryTrend, environmentLabel(entryTrend), pnl);
        }
      }
    }
  }

  const winRatePct = cycleCount > 0 ? (winCount / cycleCount) * 100 : 0;
  return {
    cycleCount,
    winCount,
    lossCount,
    breakevenCount,
    winRatePct,
    ...computeCyclePnlStats(cyclePnls, initialCapital),
    breakdowns: {
      byExecutionReason: mapToBreakdownItems(execReasonMap),
      byOutcomeReason: mapToBreakdownItems(outcomeReasonMap),
      byEntryRegime: mapToBreakdownItems(entryRegimeMap),
      byEntryTrend: mapToBreakdownItems(entryTrendMap),
    },
  };
}

function computeSpotStats(trades: TradeEntry[], initialCapital: number) {
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let cycleCount = 0;
  const cyclePnls: number[] = [];

  const execReasonMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const outcomeReasonMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const entryRegimeMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();
  const entryTrendMap = new Map<string, { label: string; cycleCount: number; win: number; loss: number; breakeven: number; pnl: number }>();

  for (const t of trades) {
    if (t.side === 'SELL') {
      const pnl = t.pnl ?? 0;
      cycleCount++;
      if (pnl > 0) {
        winCount++;
      } else if (pnl < 0) {
        lossCount++;
      } else {
        breakevenCount++;
      }
      cyclePnls.push(pnl);

      // 现货使用 SELL 时的环境和原因
      const execKey = t.executionReasonKey || 'unknown';
      const outcomeKey = t.outcomeReasonKey || t.executionReasonKey || 'unknown';
      const entryRegime = t.marketContext?.regime || 'unknown';
      const entryTrend = t.marketContext?.trend || 'unknown';

      updateBreakdown(execReasonMap, execKey, reasonLabel(execKey, t.executionReason), pnl);
      updateBreakdown(outcomeReasonMap, outcomeKey, reasonLabel(outcomeKey, t.outcomeReason ?? t.executionReason), pnl);
      updateBreakdown(entryRegimeMap, entryRegime, environmentLabel(entryRegime), pnl);
      updateBreakdown(entryTrendMap, entryTrend, environmentLabel(entryTrend), pnl);
    }
  }

  const winRatePct = cycleCount > 0 ? (winCount / cycleCount) * 100 : 0;
  return {
    cycleCount,
    winCount,
    lossCount,
    breakevenCount,
    winRatePct,
    ...computeCyclePnlStats(cyclePnls, initialCapital),
    breakdowns: {
      byExecutionReason: mapToBreakdownItems(execReasonMap),
      byOutcomeReason: mapToBreakdownItems(outcomeReasonMap),
      byEntryRegime: mapToBreakdownItems(entryRegimeMap),
      byEntryTrend: mapToBreakdownItems(entryTrendMap),
    },
  };
}

export function computeTradeAttribution(
  tradeLog: TradeEntry[],
  equityCurve: EquityPoint[],
  config: BacktestConfig
): TradeAttribution {
  const leveragedSymbol = config.leveragedSymbol || 'TQQQ';
  const lastPoint = equityCurve.at(-1) ?? null;
  const lastDate = lastPoint?.date;
  const scopedTrades = lastDate ? tradeLog.filter(t => t.date <= lastDate) : [];

  const tqqqFinalValue = lastPoint?.tqqqValue ?? 0;
  const tqqqTrades = scopedTrades.filter(t => t.symbol === leveragedSymbol);
  const tqqqCashFlow = tqqqTrades.reduce((sum, t) => sum + t.cashImpact, 0);
  const tqqqStats = computeSpotStats(tqqqTrades, config.initialCapital);

  const boxxFinalValue = lastPoint?.boxxValue ?? 0;
  const boxxTrades = scopedTrades.filter(t => t.symbol === 'BOXX');
  const boxxCashFlow = boxxTrades.reduce((sum, t) => sum + t.cashImpact, 0);
  const boxxStats = computeSpotStats(boxxTrades, config.initialCapital);

  const icTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR);
  const callCreditSpreadTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD);
  const bearCallSpreadTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD);
  const collarTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR);
  const putCreditSpreadTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD);
  const equityBoostTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD);
  const pcsRescueTrades = scopedTrades.filter(t => t.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE);

  const closedIcTrades = icTrades.filter(t => isOptionClose(t) || isOptionSettle(t));
  const closedCallCreditSpreadTrades = callCreditSpreadTrades.filter(t => isOptionClose(t) || isOptionSettle(t));
  const closedBearCallSpreadTrades = bearCallSpreadTrades.filter(t => isOptionClose(t) || isOptionSettle(t));
  const closedCollarTrades = collarTrades.filter(t => isOptionClose(t) || isOptionSettle(t));
  const closedPutCreditSpreadTrades = putCreditSpreadTrades.filter(t => isOptionClose(t) || isOptionSettle(t));
  const closedEquityBoostTrades = equityBoostTrades.filter(t => isOptionClose(t) || isOptionSettle(t));

  const icStats = computeOptionStats(icTrades, config.initialCapital);
  const csStats = computeOptionStats(callCreditSpreadTrades, config.initialCapital);
  const bearCsStats = computeOptionStats(bearCallSpreadTrades, config.initialCapital);
  const collarStats = computeOptionStats(collarTrades, config.initialCapital);
  const pcsStats = computeOptionStats(putCreditSpreadTrades, config.initialCapital);
  const equityBoostStats = computeOptionStats(equityBoostTrades, config.initialCapital);
  const pcsRescueStats = computeOptionStats(pcsRescueTrades, config.initialCapital);

  return {
    leveragedSymbol,
    tqqqSpot: {
      pnl: tqqqFinalValue + tqqqCashFlow,
      finalValue: tqqqFinalValue,
      cashFlow: tqqqCashFlow,
      tradeCount: tqqqTrades.length,
      ...tqqqStats,
    },
    boxxSpot: {
      pnl: boxxFinalValue + boxxCashFlow,
      finalValue: boxxFinalValue,
      cashFlow: boxxCashFlow,
      tradeCount: boxxTrades.length,
      ...boxxStats,
    },
    ironCondor: {
      pnl: icTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: icTrades.length,
      openCount: icTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedIcTrades.length,
      ...icStats,
    },
    callCreditSpreads: {
      pnl: callCreditSpreadTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: callCreditSpreadTrades.length,
      openCount: callCreditSpreadTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedCallCreditSpreadTrades.length,
      ...csStats,
    },
    bearCallSpreads: {
      pnl: bearCallSpreadTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: bearCallSpreadTrades.length,
      openCount: bearCallSpreadTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedBearCallSpreadTrades.length,
      ...bearCsStats,
    },
    collar: {
      pnl: collarTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: collarTrades.length,
      openCount: collarTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedCollarTrades.length,
      ...collarStats,
    },
    putCreditSpreads: {
      pnl: putCreditSpreadTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: putCreditSpreadTrades.length,
      openCount: putCreditSpreadTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedPutCreditSpreadTrades.length,
      ...pcsStats,
    },
    equityBoostPutSpreads: {
      pnl: equityBoostTrades.reduce((sum, t) => sum + t.cashImpact, 0),
      tradeCount: equityBoostTrades.length,
      openCount: equityBoostTrades.filter(isOptionOpen).length,
      closeOrSettleCount: closedEquityBoostTrades.length,
      ...equityBoostStats,
    },
    ...(pcsRescueTrades.length > 0 ? {
      pcsRescuePutSpreads: {
        pnl: pcsRescueTrades.reduce((sum, t) => sum + t.cashImpact, 0),
        tradeCount: pcsRescueTrades.length,
        openCount: pcsRescueTrades.filter(isOptionOpen).length,
        closeOrSettleCount: pcsRescueTrades.filter(t => isOptionClose(t) || isOptionSettle(t)).length,
        ...pcsRescueStats,
      },
    } : {}),
  };
}

export function computeOptionCycleDebug(trades: TradeEntry[]): OptionCycleDebug[] {
  const cycles: OptionCycleDebug[] = [];
  const queues: Record<'CS' | 'IC' | 'PCS' | 'EB' | 'PCS_RESCUE', TradeEntry[]> = { CS: [], IC: [], PCS: [], EB: [], PCS_RESCUE: [] };

  for (const trade of trades) {
    const kind = trade.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD
      ? 'CS'
      : trade.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR
        ? 'IC'
        : trade.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD
            ? 'PCS'
            : trade.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD
              ? 'EB'
              : trade.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE
                ? 'PCS_RESCUE'
              : null;
    if (!kind) continue;

    if (isOptionOpen(trade)) {
      queues[kind].push(trade);
      continue;
    }
    if (!isOptionClose(trade) && !isOptionSettle(trade)) continue;

    const open = queues[kind].shift();
    if (!open) continue;
    const pnl = trade.pnl ?? open.cashImpact + trade.cashImpact;
    cycles.push({
      kind,
      openDate: open.date,
      closeDate: trade.date,
      regimeAtOpen: open.marketContext?.regime ?? 'unknown',
      regimeAtClose: trade.marketContext?.regime ?? 'unknown',
      exitKey: trade.outcomeReasonKey ?? 'unknown',
      priceExtensionAtr: open.marketContext?.priceExtensionAtr,
      vix: open.marketContext?.vix,
      qqqEr20: open.marketContext?.qqqEr20,
      credit: open.cashImpact,
      pnl,
    });
  }

  return cycles;
}
