/** Keep every marker icon; suppress only colliding labels within the same lane. */
export function qqqReadableMarkers<T extends { text?: string; position: string }>(markers: readonly T[], xAt: (marker: T) => number | null, width: number) {
  const occupied = new Map<string, { left: number; right: number }[]>();
  const labels = new Map<number, string>();
  // Confirmed risk/opportunities first, then newest observations.
  const priority = (text = '') => /风险确认|机会待复核/.test(text) ? 2 : /提示·/.test(text) ? 1 : 0;
  const order = markers.map((marker, index) => ({marker, index})).sort((a, b) => priority(b.marker.text) - priority(a.marker.text) || b.index - a.index);
  for (const {marker, index} of order) {
    const x = xAt(marker);
    const text = (marker.text ?? '').replace(/^提示·/, '').replace(/^结构/, '');
    if (!text || x === null || x < 0 || x > width) continue;
    const half = Math.max(30, Array.from(text).length * 4.5);
    const lane = /Bottom/.test(marker.position) ? 'below' : 'above';
    const boxes = occupied.get(lane) ?? [];
    const box = { left: x - half - 6, right: x + half + 6 };
    if (boxes.some(other => box.left < other.right && box.right > other.left)) continue;
    boxes.push(box); occupied.set(lane, boxes); labels.set(index, text);
  }
  return markers.map((marker, index) => ({...marker, text: labels.get(index) ?? ''}));
}

export function qqqHoverCardPosition(x: number, y: number, width: number, height: number, cardWidth: number, cardHeight: number) {
  const left = x + cardWidth + 20 > width ? x - cardWidth - 12 : x + 12;
  const top = y + cardHeight + 20 > height ? y - cardHeight - 12 : y + 12;
  return { left: Math.max(8, Math.min(Math.max(8, width - cardWidth - 8), left)), top: Math.max(8, Math.min(Math.max(8, height - cardHeight - 8), top)) };
}

/** A GEX timestamp can fall between candles; never snap across a missing interval. */
export function qqqCursorCandleTime(times: readonly number[], target: number, interval: number) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  const time = lo ? times[lo - 1]! : null;
  return time !== null && target - time < interval ? time : null;
}
