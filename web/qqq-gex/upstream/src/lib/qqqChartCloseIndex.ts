type CloseBar = { timestamp: string; close: number };
const indexes = new WeakMap<readonly CloseBar[], { time: number; close: number }[]>();

/** Immutable bar windows: build once, then causal lookup in logarithmic time. */
export function qqqCloseAtOrBefore(bars: readonly CloseBar[], iso: string): number | null {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  let index = indexes.get(bars);
  if (!index) {
    index = bars.map(bar => ({ time: Date.parse(bar.timestamp), close: bar.close }))
      .filter(bar => Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0)
      .sort((a, b) => a.time - b.time);
    indexes.set(bars, index);
  }
  let lo = 0, hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid]!.time <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo ? index[lo - 1]!.close : null;
}
