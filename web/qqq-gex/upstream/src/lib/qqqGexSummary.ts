import { qqqStrikeHasIvFloor } from './qqqIvQuality';
import { qqqGexDisplayStrikeValid } from './qqqGexInputQuality';
/** Largest signed net exposure. Gross Call/Put inventory is a different metric. */
export function qqqNetGexKing<T extends { strike: number }>(points: readonly T[], net: (point: T) => number) {
  let king: { strike: number; magnitude: number; side: 'call' | 'put' } | null = null;
  for (const point of points) {
    const value = net(point);
    if (Number.isFinite(value) && value !== 0 && (!king || Math.abs(value) > Math.abs(king.magnitude))) {
      king = { strike: point.strike, magnitude: value, side: value > 0 ? 'call' : 'put' };
    }
  }
  return king;
}

/** Bounded top-N display projection; full observations stay in the archive. */
export function qqqTopNetGexProfile<T extends { strike: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean; callOi?:number;putOi?:number;callIv?:number;putIv?:number }>(points: readonly T[], net: (point: T) => number, limit = 8) {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const best: Array<{ point: T; value: number }> = [];
  if (!count) return [];
  for (const point of points) {
    const value = net(point);
    if (!Number.isFinite(point.strike) || point.strike <= 0 || !Number.isFinite(value) || qqqStrikeHasIvFloor(point) || !qqqGexDisplayStrikeValid(point)) continue;
    const index = best.findIndex(row => Math.abs(value) > Math.abs(row.value));
    if (index < 0) { if (best.length < count) best.push({ point, value }); }
    else { best.splice(index, 0, { point, value }); if (best.length > count) best.pop(); }
  }
  return best.sort((a, b) => a.point.strike - b.point.strike).map(({ point, value }) => ({ strike: point.strike, magnitude: value, isCallWall: point.isCallWall, isPutWall: point.isPutWall, isGammaFlip: point.isGammaFlip }));
}
