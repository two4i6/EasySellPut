import type { OHLCV } from '../../types/input';
import { barDateKey } from './decision-view';

function synthBoxxPrice(startPrice: number, dayIndex: number, dailyYield = 0.045 / 252): number {
  return startPrice * Math.pow(1 + dailyYield, dayIndex);
}

/** BOXX 真实价格缺失时按自然日复利补齐，日内 bar 不重复复利。 */
export function buildBoxxPriceResolver(qqqBars: OHLCV[], boxxBars: OHLCV[] | undefined) {
  const realByDate = new Map((boxxBars ?? []).map(bar => [bar.date, bar]));
  const dailyYield = 0.045 / 252;
  const fallbackStart = boxxBars?.at(0)?.close ?? 100;
  const prices: number[] = [];
  const dayIndexByBar: number[] = [];
  let dayCount = -1;
  let lastKey = '';
  for (const bar of qqqBars) {
    const key = barDateKey(bar.date);
    if (key !== lastKey) { dayCount++; lastKey = key; }
    dayIndexByBar.push(dayCount);
  }
  const dayIndexOf = (i: number): number => dayIndexByBar[i] ?? 0;
  const firstRealIndex = qqqBars.findIndex(bar => realByDate.has(bar.date));
  if (firstRealIndex >= 0) {
    const firstReal = realByDate.get(qqqBars[firstRealIndex].date)!;
    for (let i = 0; i < firstRealIndex; i++) prices[i] = firstReal.close / Math.pow(1 + dailyYield, dayIndexOf(firstRealIndex) - dayIndexOf(i));
  }
  for (let i = Math.max(firstRealIndex, 0); i < qqqBars.length; i++) {
    const real = realByDate.get(qqqBars[i].date);
    prices[i] = real?.close ?? (prices[i - 1] != null
      ? prices[i - 1] * Math.pow(1 + dailyYield, dayIndexOf(i) - dayIndexOf(i - 1))
      : synthBoxxPrice(fallbackStart, dayIndexOf(i), dailyYield));
  }
  return {
    close: (date: string, index: number) => realByDate.get(date)?.close ?? prices[index] ?? synthBoxxPrice(fallbackStart, dayIndexOf(index), dailyYield),
    open: (date: string, index: number) => realByDate.get(date)?.open ?? prices[index] ?? synthBoxxPrice(fallbackStart, dayIndexOf(index), dailyYield),
  };
}
