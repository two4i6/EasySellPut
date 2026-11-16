/** Immutable source windows. Equal timestamps use the last source occurrence. */
export function createQqqCausalIndex<T extends object>(timeOf: (value: T) => number) {
  const windows = new WeakMap<readonly T[], { time: number; sourceIndex: number; value: T }[]>();
  return (source: readonly T[], target: number) => {
    if (!Number.isFinite(target)) return null;
    let index = windows.get(source);
    if (!index) {
      index = source.map((value, sourceIndex) => ({ value, sourceIndex, time: timeOf(value) }))
        .filter(item => Number.isFinite(item.time)).sort((a, b) => a.time - b.time || a.sourceIndex - b.sourceIndex);
      windows.set(source, index);
    }
    let lo = 0, hi = index.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (index[mid]!.time <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo ? index[lo - 1]! : null;
  };
}

/** Renderer wrappers change on zoom; their immutable originalData does not. */
export function createQqqOriginalDataCache<T extends object, R>(build: (source: readonly T[]) => R) {
  let originals: readonly T[] | null = null;
  let result: R;
  return (bars: readonly { originalData: T }[]) => {
    if (!originals || originals.length !== bars.length || bars.some((bar, i) => bar.originalData !== originals![i])) {
      originals = bars.map(bar => bar.originalData);
      result = build(originals);
    }
    return result!;
  };
}

export function qqqTrackLowerBound(points: readonly { barIndex: number }[], firstBar: number) {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.barIndex < firstBar) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
