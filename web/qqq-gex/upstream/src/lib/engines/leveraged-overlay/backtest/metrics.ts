import type { BacktestTimeframe, EquityPoint, PerformanceMetrics, TradeEntry } from './types';

export type EquityFlipPair = {
  first: TradeEntry;
  second: TradeEntry;
  daysApart: number;
  quantity: number;
  pnl: number;
};

export function buildTradingDayDateIndex(dates: Iterable<string>): Map<string, number> {
  const index = new Map<string, number>();
  let lastKey = '';
  let tradingDay = -1;
  for (const date of dates) {
    const key = date.slice(0, 10);
    if (key !== lastKey) {
      tradingDay++;
      lastKey = key;
    }
    if (!index.has(key)) index.set(key, tradingDay);
  }
  return index;
}

function periodsPerYear(timeframe: BacktestTimeframe = '1d'): number {
  if (timeframe === '1h') return 252 * 7;
  if (timeframe === '2h') return 252 * 4;
  if (timeframe === '4h' || timeframe === '6h') return 252 * 2;
  return 252;
}

export function computeMetrics(curve: EquityPoint[], riskFreeRate = 0.045, timeframe: BacktestTimeframe = '1d'): PerformanceMetrics {
  if (curve.length < 2) {
    return {
      totalReturnPct: 0, cagr: 0, sharpeRatio: 0, maxDrawdownPct: 0, calmarRatio: 0,
      totalTrades: 0, equityFlipCount: 0, whipsawCostPct: 0, tradingDays: curve.length,
      startNAV: curve[0]?.nav ?? 0, endNAV: curve[0]?.nav ?? 0,
      startDate: curve[0]?.date ?? '', endDate: curve[0]?.date ?? '',
    };
  }

  const startNAV   = curve[0].nav;
  const endNAV     = curve.at(-1)!.nav;
  const startDate  = curve[0].date;
  const endDate    = curve.at(-1)!.date;
  const tradingDays = curve.length;

  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 86400000);

  const totalReturnPct = startNAV > 0 ? (endNAV - startNAV) / startNAV : 0;
  const cagr           = years > 0 && startNAV > 0 ? Math.pow(endNAV / startNAV, 1 / years) - 1 : 0;

  // Per-bar log returns. Annualisation follows the selected backtest timeframe.
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].nav;
    if (prev > 0) returns.push(Math.log(curve[i].nav / prev));
  }

  // Sharpe uses EXCESS return over the risk-free rate. With rf=0 the metric
  // overstated risk-adjusted performance — a 4.5% T-bill yield is free return
  // the strategy must beat. dailyReturns are log returns, so subtract the daily
  // log risk-free (ln(1+rf)/252) before annualising.
  let sharpeRatio = 0;
  if (returns.length > 1) {
    const periods = periodsPerYear(timeframe);
    const periodRf = Math.log(1 + riskFreeRate) / periods;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    sharpeRatio = std > 0 ? ((mean - periodRf) / std) * Math.sqrt(periods) : 0;
  }

  // Max drawdown
  let peak = curve[0].nav;
  let maxDrawdownPct = 0;
  for (const point of curve) {
    if (point.nav > peak) peak = point.nav;
    const dd = peak > 0 ? (peak - point.nav) / peak : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const calmarRatio = maxDrawdownPct > 0 ? cagr / maxDrawdownPct : 0;

  return {
    totalReturnPct,
    cagr,
    sharpeRatio,
    maxDrawdownPct,
    calmarRatio,
    totalTrades: 0,   // set externally
    equityFlipCount: 0,
    whipsawCostPct: 0,
    tradingDays,
    startNAV,
    endNAV,
    startDate,
    endDate,
  };
}

export function findEquityFlipPairs(
  trades: TradeEntry[],
  leveragedSymbol = 'TQQQ',
  dateIndex?: Map<string, number>,
  maxTradingDays = 10
): EquityFlipPair[] {
  const equityTrades = trades.filter(t =>
    t.symbol === leveragedSymbol &&
    !t.strategyTag &&
    (t.side === 'BUY' || t.side === 'SELL') &&
    t.quantity > 0 &&
    t.fillPrice > 0
  );
  const indexOf = (date: string, fallback: number) => dateIndex?.get(date) ?? dateIndex?.get(date.slice(0, 10)) ?? fallback;
  const pairs: EquityFlipPair[] = [];

  for (let i = 0; i < equityTrades.length - 1; i++) {
    const first = equityTrades[i];
    for (let j = i + 1; j < equityTrades.length; j++) {
      const second = equityTrades[j];
      const daysApart = indexOf(second.date, j) - indexOf(first.date, i);
      if (daysApart > maxTradingDays) break;
      if (daysApart < 0 || first.side === second.side) continue;

      const quantity = Math.min(first.quantity, second.quantity);
      const sell = first.side === 'SELL' ? first : second;
      const buy = first.side === 'BUY' ? first : second;
      pairs.push({
        first,
        second,
        daysApart,
        quantity,
        pnl: quantity * (sell.fillPrice - buy.fillPrice),
      });
      break;
    }
  }

  return pairs;
}

export function computeEquityWhipsawMetrics(
  trades: TradeEntry[],
  startNAV: number,
  leveragedSymbol = 'TQQQ',
  dateIndex?: Map<string, number>
): Pick<PerformanceMetrics, 'equityFlipCount' | 'whipsawCostPct'> {
  const pairs = findEquityFlipPairs(trades, leveragedSymbol, dateIndex);
  const pnl = pairs.reduce((sum, pair) => sum + pair.pnl, 0);
  return {
    equityFlipCount: pairs.length,
    // Round-trip net P&L over start NAV. Positive means the flip pairs made money.
    whipsawCostPct: startNAV > 0 ? pnl / startNAV : 0,
  };
}
