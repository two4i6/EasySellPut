import type { ExposureBar } from './qqqExposureWorkbench';
import { qqqMarketSession, qqqSessionForDate } from './qqqMarketSession';
import { qqqObservationPrefix } from './qqqOptionObservationHistory';
import { qqqGammaExpiryTime } from './qqqGammaModel';
import { qqqEasternMidnightUtc } from './qqqMarketDate';

export type RegularBar = { time: number; openedAt: number; minute: number; open: number; high: number; low: number; close: number; volume: number };
export type IntradayReferenceDay = { date: string; bars: ExposureBar[]; levels: IntradayLevelSnapshot[] };
export type IntradayLevelSnapshot = { time: number; expiry: string; dte: number; netGex: number; callWall: number | null; putWall: number | null };
export type IntradayContext = { date: string; dte: number; asOf: string; currentBars: ExposureBar[]; days: IntradayReferenceDay[]; requestedDays: number; issues?: string[]; referenceComplete?: boolean };
export const INTRADAY_BAR_MS = 120_000;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const regularCache = new WeakMap<readonly ExposureBar[], Map<string, RegularBar[]>>();

/** Retain the completed regular session after close, including early closes.
 * Intraday missing candles still fail the normal freshness/continuity checks.
 */
export function qqqRegularObservationCutoff(date: string, cutoff: number) {
  const close = qqqEasternMidnightUtc(date).getTime() + qqqSessionForDate(date).stockCloseMinute * 60_000;
  return Math.min(cutoff, close);
}

/** Exchange regular hours only, with opening timestamps and explicit close availability. */
export function qqqRegularBarIndex(bars: readonly ExposureBar[], date: string): RegularBar[] {
  let dates = regularCache.get(bars);
  const cached = dates?.get(date); if (cached) return cached;
  const unique = new Map<number, RegularBar>();
  for (const bar of bars) {
    const openedAt = Date.parse(bar.timestamp);
    if (!Number.isFinite(openedAt)) continue;
    unique.delete(openedAt); // A later invalid correction must leave a gap.
    const session = qqqMarketSession(new Date(openedAt));
    if (session.date !== date || !session.stocksOpen || session.minute + 2 > session.stockCloseMinute || (session.minute - 570) % 2 || openedAt % 60_000
      || ![bar.open, bar.high, bar.low, bar.close].every(positive) || bar.high! < Math.max(bar.open!, bar.close, bar.low!) || bar.low! > Math.min(bar.open!, bar.close)
      || !Number.isFinite(bar.volume) || bar.volume < 0) continue;
    unique.set(openedAt, { time: openedAt + INTRADAY_BAR_MS, openedAt, minute: session.minute, open: bar.open!, high: bar.high!, low: bar.low!, close: bar.close, volume: bar.volume });
  }
  const result = [...unique.values()].sort((a, b) => a.time - b.time);
  if (!dates) { dates = new Map(); regularCache.set(bars, dates); }
  dates.set(date, result); while (dates.size > 2) dates.delete(dates.keys().next().value!);
  return result;
}

export type PulsePoint = RegularBar & { vwap: number | null; deviation: number | null; cumulativeVolume: number | null; openingHigh: number | null; openingLow: number | null };
export function qqqPulseSeries(bars: readonly RegularBar[]): PulsePoint[] {
  let volume = 0, mean = 0, m2 = 0, complete = true, openingComplete = false, high = -Infinity, low = Infinity;
  return bars.map((bar, index) => {
    if (index === 0 ? bar.minute !== 570 : bar.openedAt !== bars[index - 1].time) complete = false;
    if (bar.minute < 600) { high = Math.max(high, bar.high); low = Math.min(low, bar.low); }
    if (bar.minute === 598 && complete) openingComplete = true;
    const price = (bar.high + bar.low + bar.close) / 3;
    const nextVolume = volume + bar.volume;
    if (bar.volume > 0) { const delta = price - mean; mean += delta * bar.volume / nextVolume; m2 += bar.volume * delta * (price - mean); }
    volume = nextVolume;
    return { ...bar, vwap: complete && volume > 0 ? mean : null, deviation: complete && volume > 0 ? Math.sqrt(Math.max(0, m2 / volume)) : null,
      cumulativeVolume: complete ? volume : null, openingHigh: openingComplete ? high : null, openingLow: openingComplete ? low : null };
  });
}

/** RV and frozen term IV are compared as log-return volatility over identical
 * calendar-minute horizons; neither is an inferred future realized volatility.
 */
export function qqqWindowVolatility(bars: readonly RegularBar[], cutoff: number, minutes: 10 | 30, iv: number | null, ivAt: number | null, expiry: string | null) {
  const prefix = qqqObservationPrefix([...bars], cutoff), count = minutes / 2;
  const window = prefix.slice(-count - 1), latest = prefix.at(-1);
  const contiguous = window.length === count + 1 && window.every((bar, index) => !index || bar.openedAt === window[index - 1].time);
  const fresh = latest && cutoff - latest.time <= 300_000;
  const realized = contiguous && fresh ? Math.sqrt(window.slice(1).reduce((sum, bar, index) => sum + Math.log(bar.close / window[index].close) ** 2, 0)) : null;
  const ivFresh = ivAt !== null && ivAt <= cutoff && cutoff - ivAt <= 300_000;
  const termEnough = expiry && qqqGammaExpiryTime(expiry) - cutoff >= minutes * 60_000;
  const implied = positive(iv) && ivFresh && termEnough && fresh ? iv * Math.sqrt(minutes * 60_000 / (365 * 86400_000)) : null;
  return { minutes, realized, implied, realizedPoints: realized !== null && latest ? latest.close * realized : null,
    impliedPoints: implied !== null && latest ? latest.close * implied : null, ratio: realized !== null && realized > 0 && implied !== null ? implied / realized : null,
    reason: !fresh || !contiguous ? '需要连续且已收盘的同期 2 分钟 K 线' : !ivFresh || !positive(iv) ? '缺少同期有效 ATM IV' : !termEnough ? '到期剩余时间不足该比较窗口' : null };
}

export function qqqRvol(current: readonly PulsePoint[], days: readonly IntradayReferenceDay[], date: string) {
  const latest = current.at(-1);
  const samples: number[] = [];
  if (latest?.cumulativeVolume !== null && latest) for (const day of days) {
    if (day.date >= date || qqqSessionForDate(day.date).stockCloseMinute < latest.minute + 2) continue;
    const prefix = qqqRegularBarIndex(day.bars, day.date).filter(bar => bar.minute <= latest.minute);
    if (prefix.length !== (latest.minute - 570) / 2 + 1 || prefix[0]?.minute !== 570 || prefix.at(-1)?.minute !== latest.minute || prefix.some((bar, i) => i > 0 && bar.minute !== prefix[i - 1].minute + 2)) continue;
    samples.push(prefix.reduce((sum, bar) => sum + bar.volume, 0));
  }
  samples.sort((a, b) => a - b);
  const median = samples.length ? (samples[Math.floor((samples.length - 1) / 2)] + samples[Math.floor(samples.length / 2)]) / 2 : null;
  return { value: samples.length >= 5 && median !== null && median > 0 && latest?.cumulativeVolume != null ? latest.cumulativeVolume / median : null,
    sampleDays: samples.length, baseline: median, current: latest?.cumulativeVolume ?? null };
}

export type RvolBaseline = Array<{ minute: number; baseline: number; sampleDays: number }>;
/** Build historical buckets off the render path. Every day contributes only
 * its contiguous prefix from 09:30, so missing minutes never depress a baseline.
 */
export async function prepareRvolBaseline(days: readonly IntradayReferenceDay[], beforeDate: string, signal: AbortSignal, schedule = () => new Promise<void>(resolve => setTimeout(resolve, 0))): Promise<RvolBaseline> {
  const buckets = new Map<number, number[]>(); let started = performance.now();
  await schedule(); signal.throwIfAborted();
  for (const day of days) {
    if (day.date >= beforeDate) continue;
    const bars = qqqRegularBarIndex(day.bars, day.date); let volume = 0;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (i === 0 ? bar.minute !== 570 : bar.openedAt !== bars[i - 1].time) break;
      volume += bar.volume;
      const values = buckets.get(bar.minute) ?? []; values.push(volume); buckets.set(bar.minute, values);
    }
    if (performance.now() - started >= 5) { await schedule(); signal.throwIfAborted(); started = performance.now(); }
  }
  signal.throwIfAborted();
  return [...buckets].sort(([a], [b]) => a - b).map(([minute, values]) => {
    values.sort((a, b) => a - b);
    return { minute, baseline: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2, sampleDays: values.length };
  });
}
export function qqqRvolFromBaseline(current: PulsePoint | undefined, baseline: RvolBaseline, cutoff: number) {
  const bucket = current ? baseline.find(point => point.minute === current.minute) : null;
  return { value: current?.cumulativeVolume != null && cutoff - current.time <= 300_000 && bucket && bucket.sampleDays >= 5 && bucket.baseline > 0 ? current.cumulativeVolume / bucket.baseline : null,
    current: current?.cumulativeVolume ?? null, baseline: bucket?.baseline ?? null, sampleDays: bucket?.sampleDays ?? 0 };
}
