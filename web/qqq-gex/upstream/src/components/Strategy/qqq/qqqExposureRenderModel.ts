import type { QqqQuoteRange } from '@/lib/qqqQuoteEnvelope';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import type { ExposureBar } from '@/lib/qqqExposureWorkbench';
import { qqqMarketSession } from '@/lib/qqqMarketSession';

/** Quote candles are display-only: never feed incomplete/quote-volume bars to analytics. */
export function updateExposureQuoteBars(previous: readonly ExposureBar[], tick: QqqQuoteRange, date: string | null, source: readonly ExposureBar[], now = Date.now()): readonly ExposureBar[] {
  const time = tick.time * 1000;
  if (!Number.isFinite(time) || !Number.isFinite(tick.price) || tick.price <= 0 || time > now || now-time > 45_000 || qqqEasternDateKey(time) !== date || !qqqMarketSession(new Date(time)).stockAcquisitionOpen) return previous;
  const bucket = Math.floor(time / 120_000) * 120_000;
  if (previous.at(-1) && bucket < Date.parse(previous.at(-1)!.timestamp)) return previous;
  const seed = previous.find(b=>Date.parse(b.timestamp)===bucket) ?? source.find(b=>Date.parse(b.timestamp)===bucket);
  const range = tick.observedBucket === bucket / 1000 ? tick : null;
  const bar = {timestamp:new Date(bucket).toISOString(),open:seed?.open??seed?.close??range?.observedOpen??tick.price,high:Math.max(seed?.high??seed?.close??tick.price,tick.price,range?.observedHigh??tick.price),low:Math.min(seed?.low??seed?.close??tick.price,tick.price,range?.observedLow??tick.price),close:tick.price,volume:0};
  return [...previous.filter(b=>Date.parse(b.timestamp)!==bucket),bar].slice(-512);
}

/** Price display follows quotes in live mode; replay remains bounded by the snapshot. */
export function exposurePriceDisplay(bars: readonly ExposureBar[], quoteBars: readonly ExposureBar[], date: string | null, frameTimes: readonly number[], replayTime: number | null, quoteTime: number | null, now = Date.now()) {
  const current = bars.filter(b=>qqqEasternDateKey(b.timestamp)===date && Number.isFinite(b.close) && b.close>0);
  const last = current.at(-1);
  const cutoff = replayTime ?? Math.min(now,Math.max(frameTimes.at(-1)??0,last?Date.parse(last.timestamp)+120_000:0,quoteTime??0));
  const merged = new Map(current.filter(b=>Date.parse(b.timestamp)+120_000<=cutoff).map(b=>[Date.parse(b.timestamp),b]));
  if (replayTime===null && quoteTime!==null && now-quoteTime<=45_000 && quoteTime<=now) for(const b of quoteBars) {
    const time=Date.parse(b.timestamp);
    if(qqqEasternDateKey(b.timestamp)===date && time<=cutoff && !merged.has(time)) merged.set(time,b);
  }
  // Fixed bucket-close coordinates match completed candles; ticks change OHLC,
  // never the candle's x position. The visible range includes a right margin.
  const candles=[...merged].sort((a,b)=>a[0]-b[0]).map(([time,bar])=>({bar,time:time+120_000,provisional:time+120_000>cutoff}));
  const start=frameTimes[0]??candles[0]?.time??cutoff;
  const live=replayTime===null&&quoteTime!==null&&quoteTime<=now&&now-quoteTime<=45_000&&quoteBars.length>0;
  const markerTime=live?quoteTime:Math.min(cutoff,candles.at(-1)?.time??cutoff);
  return {cutoff,start,end:Math.max(start+120_000,frameTimes.at(-1)??0,(candles.at(-1)?.time??start)+120_000),candles:candles.filter(c=>c.time>=start),anchor:candles.at(-1)?.bar.close??null,live,markerTime};
}

/** Price-only display remains causal when the session has no option captures. */
export function exposurePriceFallback(bars: readonly ExposureBar[], date: string | null, asOf: string, availableAt = Date.now()) {
  const current = bars.filter(bar => Number.isFinite(Date.parse(bar.timestamp)) && Number.isFinite(bar.close) && bar.close > 0 && (!date || qqqEasternDateKey(bar.timestamp) === date));
  const last = current.at(-1);
  const cutoff = Math.min(availableAt, Math.max(Date.parse(asOf) || 0, last ? Date.parse(last.timestamp) + 120_000 : 0));
  const completed = current.filter(bar => Date.parse(bar.timestamp) + 120_000 <= cutoff);
  return { bars: completed, cutoff, anchor: completed.at(-1)?.close ?? null, start: completed[0] ? Date.parse(completed[0].timestamp) + 120_000 : cutoff - 120_000, end: completed.at(-1) ? Date.parse(completed.at(-1)!.timestamp) + 120_000 : cutoff };
}

export type ExposureTile = { time: number; strike: number; value: number|null; top: number; left: number; width: number; height?: number };

/** Avoid a temporary full-history array and the engine's function-argument limit. */
export function maximumExposureMagnitude(cells: readonly {values:ReadonlyMap<number,number|null>}[], strikes: readonly number[]) {
  let maximum=1;
  for(const cell of cells)for(const strike of strikes)maximum=Math.max(maximum,Math.abs(cell.values.get(strike)??0));
  return maximum;
}

/** One archive scan; scrubbing in either direction reads only the causal prefix. */
export function exposureMagnitudeIndex(cells: readonly {values:ReadonlyMap<number,number|null>}[], strikes: readonly number[]) {
  let maximum=1,count=0;
  const prefixes=cells.map(cell=>{
    for(const strike of strikes){const value=cell.values.get(strike);if(value!=null){maximum=Math.max(maximum,Math.abs(value));count++;}}
    return {maximum,count};
  });
  const empty={maximum:1,count:0};
  return (index:number)=>prefixes[index]??empty;
}

/** Sorted unique strikes as first observed. Queries never include future strikes. */
export function exposureStrikeUniverseIndex(frames: readonly { profiles: readonly { strikes: readonly { strike: number }[] }[] }[]) {
  const firstSeen = new Map<number,number>();
  frames.forEach((frame,index)=>{for(const profile of frame.profiles)for(const {strike} of profile.strikes)if(Number.isFinite(strike)&&strike>0&&!firstSeen.has(strike))firstSeen.set(strike,index);});
  const entries=[...firstSeen].sort((a,b)=>a[0]-b[0]);
  return (index:number)=>entries.filter(([,first])=>first<=index).map(([strike])=>strike);
}

/** Tiles are grouped by snapshot in ascending x order. Check overlapping
 * subpixel cells too: the display uses a .5px minimum width, last-painted wins. */
export function findExposureTile(tiles: readonly ExposureTile[], x: number, y: number, height: number) {
  let low = 0, high = tiles.length;
  while (low < high) { const mid = (low + high) >>> 1; if (tiles[mid]!.left <= x) low = mid + 1; else high = mid; }
  const last = tiles[low - 1];
  if (!last) return null;
  for (let i = low - 1; i >= 0; i--) {
    const tile = tiles[i]!;
    if (tile.time !== last.time && tile.left < x - .5) break;
    if (x < tile.left + tile.width && y >= tile.top && y < tile.top + (tile.height??height)) return tile;
  }
  return null;
}

export function matrixRowWindow(count: number, scrollTop: number, height: number, rowHeight = 32, overscan = 6) {
  const capacity=Math.ceil(Math.max(0,height)/rowHeight)+overscan*2+2;
  // A date/range change can shrink the table before the browser clamps scrollTop.
  // Render the trailing window immediately instead of an empty intermediate body.
  const start = Math.min(Math.max(0,count-capacity), Math.max(0, Math.floor(Math.max(0, scrollTop - 48) / rowHeight) - overscan));
  const end = Math.min(count, start + capacity);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}
