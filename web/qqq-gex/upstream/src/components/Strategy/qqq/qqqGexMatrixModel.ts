import type { PcsGexExpiry } from '@/types/qqqGex';
import { qqqGexDisplayStrikeValid } from '@/lib/qqqGexInputQuality';

type MatrixPoint = PcsGexExpiry['fullGexProfile'][number];
export function qqqMatrixPointValue(point: MatrixPoint | undefined, key: 'totalGex' | 'callGex' | 'putGex' = 'totalGex') {
  return point && qqqGexDisplayStrikeValid(point) && Number.isFinite(point[key]) ? point[key] : null;
}
const profileIndexes = new WeakMap<readonly MatrixPoint[], { strikes: Map<number, MatrixPoint>; maximum: number }>();
export function buildQqqGexMatrixIndex(expiries: readonly PcsGexExpiry[]) {
  const columns = expiries.map(expiry => {
    let index = profileIndexes.get(expiry.fullGexProfile);
    if (!index) {
      const strikes = new Map(expiry.fullGexProfile.filter(point => Number.isFinite(point.strike)).map(point => [point.strike, point]));
      let maximum = 0;
      for (const point of strikes.values()) maximum = Math.max(maximum, Math.abs(qqqMatrixPointValue(point) ?? 0));
      index = { strikes, maximum };
      profileIndexes.set(expiry.fullGexProfile, index);
    }
    return { expiry, ...index };
  });
  const strikes = [...new Set(columns.flatMap(column => [...column.strikes.keys()]))].sort((a, b) => b - a);
  return { columns, strikes, maximum: Math.max(0, ...columns.map(column => column.maximum)) };
}
export function nearestQqqMatrixStrike(strikes: readonly number[], spot: number | null) {
  if (spot === null || !Number.isFinite(spot)) return null;
  return strikes.reduce<number | null>((nearest, strike) => nearest === null || Math.abs(strike - spot) < Math.abs(nearest - spot) ? strike : nearest, null);
}
export function qqqMatrixNearbyStrikes(strikes: readonly number[], anchor: number | null, radius = 20) {
  if (anchor === null) return strikes.slice(0, radius * 2 + 1);
  const center = strikes.indexOf(anchor);
  const start = Math.max(0, Math.min(center - radius, strikes.length - (radius * 2 + 1)));
  return strikes.slice(start, start + radius * 2 + 1);
}
export function buildQqqGexMatrix(expiries: readonly PcsGexExpiry[], spot: number | null) {
  const model = buildQqqGexMatrixIndex(expiries);
  return { ...model, nearestStrike: nearestQqqMatrixStrike(model.strikes, spot) };
}
export function qqqMatrixBarPercent(value: number, maximum: number) {
  return Number.isFinite(value) && maximum > 0 ? Math.min(100, Math.abs(value) / maximum * 100) : 0;
}

export function formatQqqMatrixGex(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 1) return `${value < 0 ? '−' : '+'}$<1`;
  const divisor = absolute >= 1e9 ? 1e9 : absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}$${(absolute / divisor).toFixed(divisor === 1 ? 0 : 1)}${divisor === 1e9 ? 'B' : divisor === 1e6 ? 'M' : divisor === 1e3 ? 'K' : ''}`;
}

export { qqqOptionOverview as qqqMatrixOptionOverview } from '@/lib/qqqOptionObservation';
