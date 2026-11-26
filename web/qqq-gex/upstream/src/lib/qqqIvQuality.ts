/** Display input policy for the observed near-zero source IV floor.
 * Keep raw IV intact; never substitute or clamp it to a plausible value. */
export function qqqIvUsable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > .00001 * (1 + 1e-8);
}

export function qqqStrikeIvUsable(point: {callOi?:number;putOi?:number;callIv?:number;putIv?:number}) {
  return [[point.callOi, point.callIv], [point.putOi, point.putIv]].every(([oi, iv]) => oi === 0 || qqqIvUsable(iv));
}

/** Reject known floor inputs without changing legacy missing-field semantics. */
export function qqqStrikeHasIvFloor(point: {callOi?:number;putOi?:number;callIv?:number;putIv?:number}) {
  return [[point.callOi, point.callIv], [point.putOi, point.putIv]].some(([oi, iv]) =>
    typeof oi === 'number' && oi > 0 && typeof iv === 'number' && iv > 0 && iv <= .00001 * (1 + 1e-8));
}
