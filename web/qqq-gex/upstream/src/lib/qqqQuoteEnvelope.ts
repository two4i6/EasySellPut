export type QqqQuoteRange = { price: number; time: number; observedBucket?: number; observedOpen?: number; observedHigh?: number; observedLow?: number };
/** Preserve forming-bar extrema before visual frame coalescing. No volume/decision inputs. */
export function qqqQuoteEnvelope<T extends QqqQuoteRange>(previous: QqqQuoteRange | null, tick: T): T & QqqQuoteRange {
  const bucket = Math.floor(tick.time / 120) * 120;
  const seed = previous?.observedBucket === bucket ? previous : null;
  return { ...tick, observedBucket: bucket, observedOpen: seed?.observedOpen ?? tick.price,
    observedHigh: Math.max(seed?.observedHigh ?? tick.price, tick.price),
    observedLow: Math.min(seed?.observedLow ?? tick.price, tick.price) };
}
