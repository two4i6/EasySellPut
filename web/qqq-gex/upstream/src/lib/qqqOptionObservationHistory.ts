import type { PcsGexExpiry } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from './qqqExposureReplay';
import { exposureSpotIndex, type ExposureBar, type ExposureFrame } from './qqqExposureWorkbench';
import { qqqEasternDateKey } from './qqqMarketDate';

type Strikes = PcsGexExpiry['fullGexProfile'];
type Source = { expiry: string; time: number; strikes: Strikes; head?: boolean };
export type QqqObservationTrack<T> = { expiry: string; history: Array<T & { time: number }> };
export const EMPTY_OBSERVATION_EXPIRIES: readonly PcsGexExpiry[] = [];
export const EMPTY_OBSERVATION_FRAMES: readonly ExposureFrame[] = [];
export const EMPTY_OBSERVATION_BARS: readonly ExposureBar[] = [];

export function qqqOptionObservationCutoff(observedAt: number, replay: Pick<QqqExposureReplayContext, 'followingLatest' | 'frame'> | null) {
  // The last selected frame may precede other arrivals in the live batch.
  const cutoff = replay && !replay.followingLatest ? replay.frame?.time : observedAt;
  return typeof cutoff === 'number' && Number.isFinite(cutoff) ? cutoff : -Infinity;
}

// Receipt times depend on immutable source arrays, not on cursor or valuation.
const receiptCache = new WeakMap<Strikes, number>();
const receiptFields = ['computedAt', 'callReceivedAt', 'putReceivedAt'] as const;
function availableAt(time: number, strikes: Strikes) {
  let latest = receiptCache.get(strikes);
  if (latest === undefined) {
    latest = -Infinity;
    for (const row of strikes) for (const field of receiptFields) {
      const value = row[field];
      if (typeof value !== 'string') continue;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
    }
    receiptCache.set(strikes, latest);
  }
  return Math.max(time, latest);
}

function* sources(expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[]): Generator<Source> {
  for (const expiry of expiries) {
    for (const point of expiry.fullGexProfileHistory) if (point.strikeCoverage !== 'top8') yield { expiry: expiry.expiryDate, time: Date.parse(point.time), strikes: point.strikes };
    yield { expiry: expiry.expiryDate, time: Date.parse(expiry.asOf), strikes: expiry.fullGexProfile, head: true };
  }
  for (const frame of frames) for (const profile of frame.profiles) yield { expiry: profile.expiry, time: profile.time ?? frame.time, strikes: profile.strikes };
}

function createIndex(expiries: readonly PcsGexExpiry[], date: string) {
  const tracks = new Map<string, Map<number, Strikes>>();
  const validExpiry = (expiry: string) => /^\d{4}-\d{2}-\d{2}$/.test(expiry) && Number.isFinite(Date.parse(expiry)) && new Date(expiry).toISOString().slice(0, 10) === expiry && expiry >= date;
  const days = new Map<number, string>();
  for (const expiry of expiries) if (validExpiry(expiry.expiryDate)) tracks.set(expiry.expiryDate, new Map());
  return {
    add(source: Source) {
      if (!Number.isFinite(source.time) || !validExpiry(source.expiry)) return;
      // An overview without a full head profile is not a new empty capture.
      // Explicit empty historical captures below still invalidate observations.
      if (source.head && !source.strikes.length) return;
      const time = availableAt(source.time, source.strikes);
      let day = days.get(time);
      if (day === undefined) { day = qqqEasternDateKey(time); days.set(time, day); }
      if (day !== date) return;
      if (!tracks.has(source.expiry)) tracks.set(source.expiry, new Map());
      tracks.get(source.expiry)!.set(time, source.strikes);
    },
    finish: () => [...tracks].sort(([a], [b]) => a.localeCompare(b)).map(([expiry, points]) => ({ expiry, points: [...points].sort(([a], [b]) => a - b) })),
  };
}

export function indexQqqOptionObservations(expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[], date: string, cutoff = Infinity) {
  const index = createIndex(expiries, date);
  for (const source of sources(expiries, frames)) index.add(source);
  return index.finish().map(track => ({ ...track, points: track.points.filter(([time]) => time <= cutoff) }));
}

/** Bound both indexing and computation to cooperative tasks. Yield before any
 * contract scan, and check cancellation between snapshots, including within a DTE.
 */
export async function prepareQqqOptionObservations<T extends object>(
  expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[], date: string, signal: AbortSignal,
  evaluate: (strikes: Strikes, time: number) => T,
  schedule: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<QqqObservationTrack<T>[]> {
  signal.throwIfAborted();
  await schedule();
  signal.throwIfAborted();
  let started = performance.now();
  const checkpoint = () => {
    signal.throwIfAborted();
    if (performance.now() - started < 5) return null;
    return schedule().then(() => { signal.throwIfAborted(); started = performance.now(); });
  };
  const index = createIndex(expiries, date);
  for (const source of sources(expiries, frames)) {
    index.add(source);
    const pending = checkpoint();
    if (pending) await pending;
  }
  const result: QqqObservationTrack<T>[] = [];
  for (const track of index.finish()) {
    const history: Array<T & { time: number }> = [];
    for (const [time, strikes] of track.points) {
      history.push({ time, ...evaluate(strikes, time) });
      const pending = checkpoint();
      if (pending) await pending;
    }
    result.push({ expiry: track.expiry, history });
  }
  signal.throwIfAborted();
  return result;
}

/** Sorted histories retain identity at the live edge; no full filter on scrubs. */
export function qqqObservationPrefix<T extends { time: number }>(history: T[], cutoff: number): T[] {
  let low = 0, high = history.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (history[middle].time <= cutoff) low = middle + 1; else high = middle;
  }
  return low === history.length ? history : history.slice(0, low);
}

const spotCache = new WeakMap<readonly ExposureBar[], Map<string, ReturnType<typeof exposureSpotIndex>>>();
export function qqqObservationSpotIndex(bars: readonly ExposureBar[], date: string) {
  let dates = spotCache.get(bars);
  const cached = dates?.get(date);
  if (cached) return cached;
  const lookup = exposureSpotIndex(bars.filter(bar => Number.isFinite(Date.parse(bar.timestamp)) && qqqEasternDateKey(bar.timestamp) === date));
  if (!dates) { dates = new Map(); spotCache.set(bars, dates); }
  dates.set(date, lookup);
  while (dates.size > 2) dates.delete(dates.keys().next().value!);
  return lookup;
}
