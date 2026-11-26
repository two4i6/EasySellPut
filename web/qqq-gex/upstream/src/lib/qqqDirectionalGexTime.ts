type Receipt = { callReceivedAt?: string; putReceivedAt?: string; computedAt?: string; sourceAsOf?: string; calculationVersion?: string; inputComplete?: boolean };

// String values are immutable; bound retention across live sessions. Do not
// cache generic profile arrays: callers may still be constructing a capture.
const timestamps = new Map<string, number>();
function milliseconds(value: string | null | undefined) {
  if (typeof value !== 'string') return NaN;
  const known = timestamps.get(value);
  if (known !== undefined) return known;
  const parsed = Date.parse(value);
  timestamps.set(value, parsed);
  if (timestamps.size > 8192) timestamps.delete(timestamps.keys().next().value!);
  return parsed;
}
const immutableTimes = new WeakMap<readonly Receipt[], number>();
function extremum(capturedAt: string, receivedAt: string | null | undefined, profile: readonly Receipt[], putReceivedAt: string | null | undefined, source: boolean) {
  let result = source ? Infinity : -Infinity;
  const include = (value: string | null | undefined) => {
    const time = milliseconds(value);
    if (Number.isFinite(time)) result = source ? Math.min(result, time) : Math.max(result, time);
  };
  if (!source) include(capturedAt);
  include(receivedAt); include(putReceivedAt);
  for (const point of profile) {
    include(source ? point.sourceAsOf : point.computedAt);
    include(point.callReceivedAt); include(point.putReceivedAt);
  }
  return Number.isFinite(result) ? new Date(result).toISOString() : capturedAt;
}

/** Freshness is the oldest required source, independent of when the result became available. */
export function qqqDirectionalGexSourceAsOf(capturedAt: string, receivedAt?: string | null, profile: readonly Receipt[] = [], putReceivedAt?: string | null) {
  return extremum(capturedAt, receivedAt, profile, putReceivedAt, true);
}

/** A new computation cannot be backdated to the cached chain it consumed. */
export function qqqDirectionalGexTime(capturedAt: string, receivedAt?: string | null, profile: readonly Receipt[] = [], putReceivedAt?: string | null) {
  return extremum(capturedAt, receivedAt, profile, putReceivedAt, false);
}

/** Display archives own immutable arrays. Every strike still participates in
 * availability; a new/corrected array always gets a fresh scan. */
export function qqqImmutableDirectionalGexTime(capturedAt: string, profile: readonly Receipt[]) {
  let time = immutableTimes.get(profile);
  if (time === undefined) {
    time = Date.parse(qqqDirectionalGexTime('', null, profile));
    immutableTimes.set(profile, time);
  }
  const captured = milliseconds(capturedAt);
  if (Number.isFinite(captured)) time = Number.isFinite(time) ? Math.max(time, captured) : captured;
  return Number.isFinite(time) ? new Date(time).toISOString() : capturedAt;
}

export function qqqDirectionalGexSnapshot(capturedAt: string, receivedAt?: string | null, profile: readonly Receipt[] = [], putReceivedAt?: string | null) {
  return { time: qqqDirectionalGexTime(capturedAt, receivedAt, profile, putReceivedAt), sourceAsOf: qqqDirectionalGexSourceAsOf(capturedAt, receivedAt, profile, putReceivedAt), calculationVersion: profile[0]?.calculationVersion ?? 'qqq-gex-legacy-v1', inputComplete: profile.every(p => p.inputComplete !== false) };
}

/** Shared lightweight DB projection for both scheduled/live evaluation and replay. */
export const QQQ_GEX_TIMING_SELECT = 'received_at:profile->0->>callReceivedAt,put_received_at:profile->0->>putReceivedAt,computed_at:profile->0->>computedAt,source_as_of:profile->0->>sourceAsOf,calculation_version:profile->0->>calculationVersion,input_complete:profile->0->>inputComplete';
export type QqqStoredGexTiming = { captured_at: string; received_at?: string | null; put_received_at?: string | null; computed_at?: string | null; source_as_of?: string | null; calculation_version?: string | null; input_complete?: boolean | string | null; profile?: readonly Receipt[] };
export function qqqStoredGexTiming(row: QqqStoredGexTiming) {
  const metadata: Receipt = { ...(row.computed_at ? { computedAt: row.computed_at } : {}), ...(row.source_as_of ? { sourceAsOf: row.source_as_of } : {}), ...(row.calculation_version ? { calculationVersion: row.calculation_version } : {}), ...((row.input_complete === false || row.input_complete === 'false') ? { inputComplete: false } : {}) };
  const profile = row.profile?.length ? row.profile : [metadata];
  return qqqDirectionalGexSnapshot(row.captured_at, row.received_at, profile, row.put_received_at);
}
