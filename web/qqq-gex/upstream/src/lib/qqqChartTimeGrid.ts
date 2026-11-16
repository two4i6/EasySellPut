const projections = new WeakMap<readonly object[], Map<string, readonly object[]>>();

/** Presentation-only coordinates for the shared candle axis. Source observations stay intact.
 * Candle labels identify intervals, so seconds inside that interval share its x slot.
 * Exact observation times remain on the source and off-grid projected points. */
export function qqqChartTimeGrid<T extends { time: unknown }>(points: readonly T[], granularity: '2m' | '5m' | '1d'): readonly T[] {
  if (granularity === '1d') return points;
  const cached = projections.get(points)?.get(granularity);
  if (cached) return cached as readonly T[];
  const seconds = granularity === '2m' ? 120 : 300;
  const buckets = new Map<number, { point: T; observed: number }>();
  let unchanged = true, previous = -Infinity;
  for (const point of points) {
    const observed = typeof point.time === 'number' ? point.time : NaN;
    if (!Number.isFinite(observed)) { unchanged = false; continue; }
    const time = Math.floor(observed / seconds) * seconds;
    if (time !== observed || time <= previous) unchanged = false;
    previous = time;
    const current = buckets.get(time);
    if (!current || observed >= current.observed) buckets.set(time, {
      observed, point: time === observed ? point : { ...point, time, observedTime: observed },
    });
  }
  const result = unchanged ? points : [...buckets.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry.point);
  const cache = projections.get(points) ?? new Map<string, readonly object[]>();
  cache.set(granularity, result); projections.set(points, cache);
  return result;
}

/** Place exact observation times between candle slots without adding axis entries. */
export function qqqChartTimeCoordinate(
  time: number,
  granularity: '2m' | '5m' | '1d',
  coordinate: (time: number) => number | null,
): number | null {
  if (!Number.isFinite(time)) return null;
  if (granularity === '1d') return coordinate(time);
  const seconds = granularity === '2m' ? 120 : 300;
  const bucket = Math.floor(time / seconds) * seconds;
  const start = coordinate(bucket);
  if (start === null || time === bucket) return start;
  const end = coordinate(bucket + seconds);
  const previous = end === null ? coordinate(bucket - seconds) : null;
  const spacing = end !== null ? end - start : previous !== null ? start - previous : null;
  return spacing === null ? start : start + spacing * (time - bucket) / seconds;
}
