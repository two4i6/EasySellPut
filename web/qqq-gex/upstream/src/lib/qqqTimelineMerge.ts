/** Exact comparison of immutable JSON data, skipping already shared subtrees.
 * No serialized history copies or unbounded signature cache are retained.
 */
export function qqqEqualData(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return false;
  if (Array.isArray(previous)) {
    if (!Array.isArray(next) || previous.length !== next.length) return false;
    for (let i = 0; i < previous.length; i++) if (!qqqEqualData(previous[i], next[i])) return false;
    return true;
  }
  if (Array.isArray(next)) return false;
  // API/cache payloads are plain JSON. Other object types must not accidentally
  // compare equal just because they expose no enumerable fields.
  if (Object.getPrototypeOf(previous) !== Object.prototype || Object.getPrototypeOf(next) !== Object.prototype) return false;
  const left = previous as Record<string, unknown>, right = next as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key) || !qqqEqualData(left[key], right[key])) return false;
  }
  return true;
}

/** Parsed responses are immutable; preserve identities for unchanged history. */
export function qqqShareValue<T>(previous: T, next: T): T {
  return qqqEqualData(previous, next) ? previous : next;
}

export function qqqMergeTimeline<T extends { time?: string; timestamp?: string; date?: string }>(left: T[], right: readonly T[]): T[] {
  const keyOf = (point: T) => point.time ?? point.timestamp ?? point.date;
  const merged = new Map<string, T>();
  for (const point of left) { const key = keyOf(point); if (key) merged.set(key, point); }
  for (const point of right) {
    const key = keyOf(point);
    if (key) merged.set(key, merged.has(key) ? qqqShareValue(merged.get(key)!, point) : point);
  }
  const result = [...merged.values()].sort((a, b) => Date.parse(keyOf(a)!) - Date.parse(keyOf(b)!));
  return result.length === left.length && result.every((point, i) => point === left[i]) ? left : result;
}
