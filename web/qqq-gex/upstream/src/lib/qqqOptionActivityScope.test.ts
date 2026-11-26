import { qqqOptionOverview } from './qqqOptionObservation';
import { expect, test } from 'bun:test';
import type { PcsGexExpiry } from '@/types/qqqGex';
import { aggregateQqqOptionActivity } from './qqqOptionActivityScope';

const expiry = (volume: number | undefined, unit = 'per1pct') => ({ fullGexProfile: [{strike: 750, callVolume: volume, putVolume: 3, callOi: 10, putOi: 20, callGex: 2, putGex: -1, totalGex: 1, gexUnit: unit, calculationVersion: 'v1'}] }) as unknown as PcsGexExpiry;
test('scope aggregation sums observed contracts and does not invent wall levels', () => {
  const combined = aggregateQqqOptionActivity([expiry(5), expiry(8)], '2026-10-09T14:00:00Z')!;
  expect(qqqOptionOverview(combined.fullGexProfile).call.volume).toBe(13);
  expect(qqqOptionOverview(combined.fullGexProfile).call.oi).toBe(20);
  expect(combined.fullGexProfile).toHaveLength(2);
  expect(qqqOptionOverview(combined.fullGexProfile).call.top[0]?.volume).toBe(13);
  expect(combined.gexSummary).toBeNull();
  expect(combined.asOf).toBe('2026-10-09T14:00:00Z');
});
test('scope aggregation keeps missing inputs and incompatible GEX unavailable', () => {
  expect(aggregateQqqOptionActivity([expiry(5)], '', ['2026-10-12'])).toBeNull();
  expect(aggregateQqqOptionActivity([], '')).toBeNull();
  const combined = aggregateQqqOptionActivity([expiry(5), expiry(undefined, 'perpoint')], '')!;
  expect(qqqOptionOverview(combined.fullGexProfile).call.volume).toBe(5);
  expect(qqqOptionOverview(combined.fullGexProfile).call.volumeCoverage).toBe(1);
  expect(qqqOptionOverview(combined.fullGexProfile).call.absoluteGex).toBeNull();
});
test('scope aggregation does not turn invalid source GEX into valid activity totals', () => {
  const current = { ...expiry(5), fullGexProfile: [{ ...expiry(5).fullGexProfile[0]!,
    calculationVersion: 'qqq-gex-full-1pct-usable-iv-v4', gexUnit: 'per-1pct' as const,
    inputComplete: false, callIv: .00001, putIv: .2, callGex: 1e12, putGex: 4,
  }] };
  const combined = aggregateQqqOptionActivity([current, current], '')!;
  expect(qqqOptionOverview(combined.fullGexProfile).call.absoluteGex).toBeNull();
  expect(qqqOptionOverview(combined.fullGexProfile).put.absoluteGex).toBe(8);
  expect(combined.fullGexProfile).toEqual([...current.fullGexProfile,...current.fullGexProfile]);
});
