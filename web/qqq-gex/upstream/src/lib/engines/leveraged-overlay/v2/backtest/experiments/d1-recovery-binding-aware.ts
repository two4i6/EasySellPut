import type { BacktestResult, EquityPoint } from '../../../backtest/types';
import type { MarketDataSet } from '../fixtures';

type Signal = {
  date: string;
  macro: 'SLOW_BULL' | 'SLOW_BEAR';
  crisis: string;
  vix: number;
  qqq: number;
  sma50: number;
  roc5: number;
  allocationPct: number;
};

type Episode = { start: string; dates: string[] };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function signals(baseline: BacktestResult, allocation: BacktestResult, data: MarketDataSet): Signal[] {
  const baselineByDate = new Map(baseline.equityCurve.map(point => [point.date, point]));
  const allocationByDate = new Map(allocation.equityCurve.map(point => [point.date, point]));
  const closes: number[] = [];
  return data.qqqBars.flatMap(bar => {
    closes.push(bar.close);
    const point = baselineByDate.get(bar.date);
    if (!point || closes.length < 50) return [];
    return [{
      date: bar.date,
      macro: point.marketContext?.macroRegime === 'SLOW_BEAR' ? 'SLOW_BEAR' : 'SLOW_BULL',
      crisis: point.crisisPhase ?? point.marketContext?.crisisPhase ?? 'NONE',
      vix: data.vixByDate[bar.date] ?? Infinity,
      qqq: bar.close,
      sma50: mean(closes.slice(-50)),
      roc5: closes.length > 5 ? bar.close / closes.at(-6)! - 1 : -Infinity,
      allocationPct: allocationByDate.get(bar.date)?.tqqqPct ?? point.tqqqPct,
    }];
  });
}

function episodes(rows: Signal[]): Episode[] {
  const result: Episode[] = [];
  let pressureAt: number | undefined;
  let episode: Episode | undefined;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.crisis !== 'NONE' || row.vix >= 30) pressureAt = i;
    if (episode && (row.macro === 'SLOW_BEAR' || row.crisis !== 'NONE' || row.vix >= 30 || row.qqq < row.sma50 || episode.dates.length >= 40)) {
      result.push(episode);
      episode = undefined;
    }
    if (!episode && pressureAt != null && i - pressureAt > 60) pressureAt = undefined;
    if (!episode && pressureAt != null && row.macro === 'SLOW_BULL' && row.crisis === 'NONE' && row.vix < 30 && row.qqq >= row.sma50 && row.roc5 >= .02 && row.allocationPct < .60) {
      episode = { start: row.date, dates: [] };
      pressureAt = undefined;
    }
    episode?.dates.push(row.date);
  }
  if (episode) result.push(episode);
  return result;
}

function acceptsEntry(point: EquityPoint | undefined): boolean {
  if (point?.targetTqqqPct == null || point.tqqqPct >= point.targetTqqqPct) return false;
  return (point.marketContext?.priceVsSma200Pct ?? -Infinity) >= 0 || point.bindingConstraint === 'trend_discount';
}

/** D1：仅给欠配 Recovery episode 加 10pp；SMA200 下只放行趋势折扣造成的欠配。 */
export function d1RecoveryBoostDates(
  baseline: BacktestResult,
  allocation: BacktestResult,
  data: MarketDataSet,
): Readonly<Record<string, number>> {
  const baselineByDate = new Map(baseline.equityCurve.map(point => [point.date, point]));
  return Object.fromEntries(
    episodes(signals(baseline, allocation, data))
      .filter(episode => acceptsEntry(baselineByDate.get(episode.start)))
      .flatMap(episode => episode.dates.map(date => [date, .10])),
  );
}
