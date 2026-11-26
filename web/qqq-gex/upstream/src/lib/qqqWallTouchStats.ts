import { qqqRegularBarIndex, type IntradayReferenceDay } from './qqqIntradayIndicators';
import { qqqMarketSession } from './qqqMarketSession';
export type WallTouchEvent = { date: string; time: number; side: 'call' | 'put'; expiry: string; dte: number; wall: number; gamma: 'positive' | 'negative' | 'zero'; period: 'open' | 'middle' | 'late'; horizon: 10 | 30; returnedInside: boolean; confirmedBreak: boolean; favorable: number; adverse: number; endingMove: number };

/** One first touch per date/expiry/side. The wall must be known before the
 * touch candle opens; its intrabar ordering is never used as a rejection.
 * Outcomes require every subsequent 2m candle through the complete horizon.
 */
export async function prepareWallTouchEvents(days: readonly IntradayReferenceDay[], beforeDate: string, signal: AbortSignal, schedule = () => new Promise<void>(resolve => setTimeout(resolve, 0))) {
  const events: WallTouchEvent[] = []; let started = performance.now();
  await schedule(); signal.throwIfAborted();
  for (const day of days) {
    if (day.date >= beforeDate) continue;
    const bars = qqqRegularBarIndex(day.bars, day.date), levels = [...day.levels].sort((a, b) => a.time - b.time);
    let cursor = -1; const seen = new Set<string>();
    for (let index = 0; index < bars.length; index++) {
      if (performance.now() - started >= 5) { await schedule(); signal.throwIfAborted(); started = performance.now(); }
      const bar = bars[index];
      while (cursor + 1 < levels.length && levels[cursor + 1].time <= bar.openedAt) cursor++;
      const level = levels[cursor];
      if (!level || bar.openedAt - level.time > 300_000) continue;
      for (const side of ['call', 'put'] as const) {
        const wall = side === 'call' ? level.callWall : level.putWall, key = `${level.expiry}:${side}`;
        if (wall === null || !Number.isFinite(wall) || wall <= 0 || seen.has(key) || bar.low > wall || bar.high < wall) continue;
        seen.add(key);
        for (const horizon of [10, 30] as const) {
          const future = bars.slice(index + 1, index + 1 + horizon / 2);
          if (future.length !== horizon / 2 || future.some((point, i) => point.openedAt !== (i ? future[i - 1].time : bar.time)) || future.at(-1)!.time !== bar.time + horizon * 60_000) continue;
          const sign = side === 'put' ? 1 : -1;
          const inside = (price: number) => sign * (price - wall) > 0;
          const favorable = Math.max(0, ...future.map(point => sign * ((side === 'put' ? point.high : point.low) - wall)));
          const adverse = Math.max(0, ...future.map(point => -sign * ((side === 'put' ? point.low : point.high) - wall)));
          // The event is only observable at close; cohort labels describe the
          // interval in which it happened, rather than the following interval.
          const minute = qqqMarketSession(new Date(bar.openedAt)).minute;
          events.push({ date: day.date, time: bar.time, side, expiry: level.expiry, dte: level.dte, wall,
            gamma: level.netGex > 0 ? 'positive' : level.netGex < 0 ? 'negative' : 'zero', period: minute < 630 ? 'open' : minute < 900 ? 'middle' : 'late', horizon,
            returnedInside: inside(future.at(-1)!.close), confirmedBreak: future.some((point, i) => i > 0 && !inside(point.close) && point.close !== wall && !inside(future[i - 1].close) && future[i - 1].close !== wall),
            favorable, adverse, endingMove: sign * (future.at(-1)!.close - wall) });
        }
      }
    }
  }
  signal.throwIfAborted(); return events;
}
const quantile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return null; const at = (sorted.length - 1) * p, lo = Math.floor(at); return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo); };
export function summarizeWallTouches(events: readonly WallTouchEvent[]) {
  const count = events.length, successes = events.filter(event => event.returnedInside).length, rate = count >= 5 ? successes / count : null;
  const z = 1.96, p = count ? successes / count : 0, denominator = 1 + z * z / Math.max(1, count);
  const midpoint = (p + z * z / (2 * Math.max(1, count))) / denominator, radius = z * Math.sqrt((p * (1 - p) + z * z / (4 * Math.max(1, count))) / Math.max(1, count)) / denominator;
  return { count, days: new Set(events.map(event => event.date)).size, rate, interval: rate === null ? null : [Math.max(0, midpoint - radius), Math.min(1, midpoint + radius)],
    breakRate: count >= 5 ? events.filter(event => event.confirmedBreak).length / count : null,
    favorableMedian: quantile(events.map(event => event.favorable), .5), adverseMedian: quantile(events.map(event => event.adverse), .5), adverseP90: quantile(events.map(event => event.adverse), .9),
    endingQuantiles: [.1, .25, .5, .75, .9].map(p => quantile(events.map(event => event.endingMove), p)) };
}
