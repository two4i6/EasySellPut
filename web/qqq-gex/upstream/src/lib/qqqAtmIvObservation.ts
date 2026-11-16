import { qqqIvUsable } from './qqqIvQuality';
import { qqqAtmIv } from './qqqAtmIv';
import type { ExposureBar, ExposureFrame } from './qqqExposureWorkbench';
import type { PcsGexExpiry } from '@/types/qqqGex';
import { indexQqqOptionObservations, prepareQqqOptionObservations, qqqObservationPrefix, qqqObservationSpotIndex, type QqqObservationTrack } from './qqqOptionObservationHistory';
export { qqqOptionObservationCutoff as qqqAtmIvObservationCutoff } from './qqqOptionObservationHistory';
// Snapshot arrays are immutable. Re-selecting a DTE or rebuilding a replay
// window must not repeat variance interpolation for every archived contract.
type AtmIvStrike = {strike:number;callIv?:number;putIv?:number};
const ivCache = new WeakMap<readonly AtmIvStrike[], Map<number, number>>();
export function qqqSnapshotAtmIv(strikes: readonly AtmIvStrike[], spot: number | null) {
  if (spot === null || !Number.isFinite(spot) || spot <= 0) return 0;
  let cached = ivCache.get(strikes);
  if (cached?.has(spot)) return cached.get(spot)!;
  const side = (key: 'callIv' | 'putIv') => strikes.flatMap(row => Number.isFinite(row.strike) && row.strike > 0 && qqqIvUsable(row[key]) ? [{ strike: row.strike, iv: row[key]! }] : []);
  const calls = side('callIv'), puts = side('putIv');
  const bracketed = [calls, puts].every(rows => rows.some(row => row.strike <= spot) && rows.some(row => row.strike >= spot));
  const iv = bracketed ? qqqAtmIv(calls, puts, spot) : 0;
  if (!cached) { cached = new Map(); ivCache.set(strikes, cached); }
  cached.set(spot, iv);
  while (cached.size > 2) cached.delete(cached.keys().next().value!);
  return iv;
}

export type QqqAtmIvTrack = QqqObservationTrack<{ iv: number | null }> & { dte: number };

export function qqqAtmIvAt(tracks: readonly QqqAtmIvTrack[], cutoff: number) {
  return tracks.map(track => {
    const history = qqqObservationPrefix(track.history, cutoff);
    const latest = history.at(-1) ?? null;
    const first = history.find(point => point.iv !== null);
    return { ...track, history, latest, change: latest?.iv != null && first && first.time !== latest.time ? latest.iv - first.iv! : null };
  });
}

export function qqqAtmIvObservation(expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[], bars: readonly ExposureBar[], cutoff: number, date: string) {
  const spotAt = qqqObservationSpotIndex(bars, date);
  const tracks = indexQqqOptionObservations(expiries, frames, date, cutoff).map(track => ({
    expiry: track.expiry, dte: Math.round((Date.parse(track.expiry) - Date.parse(date)) / 86400000),
    history: track.points.map(([time, strikes]) => {
      const iv = qqqSnapshotAtmIv(strikes, spotAt(time));
      return { time, iv: iv > 0 ? iv : null };
    }),
  }));
  return qqqAtmIvAt(tracks, cutoff);
}

/** Budget indexing and variance interpolation within each expiry, not just between expiries. */
export async function prepareQqqAtmIvObservation(
  expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[], bars: readonly ExposureBar[], date: string,
  signal: AbortSignal, schedule: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
) {
  // Price lookup is tiny compared with contracts and cached by immutable bars/date.
  signal.throwIfAborted();
  const spotAt = qqqObservationSpotIndex(bars, date);
  const prepared = await prepareQqqOptionObservations(expiries, frames, date, signal, (strikes, time) => {
    const iv = qqqSnapshotAtmIv(strikes, spotAt(time));
    return { iv: iv > 0 ? iv : null };
  }, schedule);
  return qqqAtmIvAt(prepared.map(track => ({ ...track, dte: Math.round((Date.parse(track.expiry) - Date.parse(date)) / 86400000) })), Infinity);
}
