import { expect, test } from 'bun:test';
import { prepareRvolBaseline, qqqRegularBarIndex, qqqPulseSeries, qqqRvol, qqqRvolFromBaseline, qqqWindowVolatility, type IntradayReferenceDay } from './qqqIntradayIndicators';
import { qqqObservationPrefix } from './qqqOptionObservationHistory';
const date = '2026-10-16', open = Date.parse(`${date}T13:30:00Z`);
const bars = (count: number, volume = 10, day = date) => Array.from({ length: count }, (_, i) => ({ timestamp: new Date(Date.parse(`${day}T13:30:00Z`) + i * 120000).toISOString(), open: 100, high: 102, low: 98, close: 100, volume }));

test('regular index excludes off-session, unaligned, invalid OHLC and keeps corrected timestamps', () => {
  const source = bars(2);
  const indexed = qqqRegularBarIndex([...source, { ...source[0], volume: 20 }, { ...source[0], timestamp: new Date(open - 120000).toISOString() }, { ...source[0], timestamp: new Date(open + 60000).toISOString() }, { ...source[1], high: 50 }], date);
  expect(indexed).toHaveLength(1); expect(indexed[0].volume).toBe(20); expect(indexed[0].time).toBe(open + 120000);
  expect(qqqObservationPrefix(indexed, open + 119999)).toEqual([]);
});
test('VWAP and weighted deviation match a direct weighted-price reference', () => {
  const source = bars(2); source[1] = { ...source[1], open: 104, high: 106, low: 102, close: 104, volume: 30 };
  const points = qqqPulseSeries(qqqRegularBarIndex(source, date));
  expect(points[1].vwap).toBe(103); expect(points[1].deviation).toBeCloseTo(Math.sqrt(3), 12);
  expect(points[1].cumulativeVolume).toBe(40);
});
test('OR30 is unavailable before 10:00, then freezes; later gaps invalidate VWAP but not the known opening range', () => {
  const source = bars(20); source[19] = { ...source[19], high: 200 };
  const points = qqqPulseSeries(qqqRegularBarIndex(source, date));
  expect(points[13].openingHigh).toBeNull(); expect(points[14].openingHigh).toBe(102); expect(points[19].openingHigh).toBe(102);
  const gap = qqqPulseSeries(qqqRegularBarIndex(source.filter((_, i) => i !== 16), date));
  expect(gap.at(-1)?.vwap).toBeNull(); expect(gap.at(-1)?.openingHigh).toBe(102);
  expect(qqqPulseSeries(qqqRegularBarIndex(source.slice(1), date)).at(-1)?.vwap).toBeNull();
});
test('RV uses exactly matching contiguous return intervals and refuses future or stale IV', () => {
  const source = bars(18).map((bar, i) => ({ ...bar, open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i }));
  const indexed = qqqRegularBarIndex(source, date), cutoff = indexed[15].time;
  const reading = qqqWindowVolatility(indexed, cutoff, 10, .2, cutoff, date);
  const direct = Math.sqrt(indexed.slice(11, 16).reduce((sum, bar, i) => sum + Math.log(bar.close / indexed[i + 10].close) ** 2, 0));
  expect(reading.realized).toBeCloseTo(direct, 12); expect(reading.implied).toBeCloseTo(.2 * Math.sqrt(10 / (365 * 1440)), 12);
  expect(qqqWindowVolatility(indexed, cutoff, 10, .2, cutoff + 1, date).ratio).toBeNull();
  expect(qqqWindowVolatility(indexed, cutoff, 10, .2, cutoff - 300001, date).ratio).toBeNull();
  expect(qqqWindowVolatility(indexed.filter((_, i) => i !== 13), cutoff, 10, .2, cutoff, date).realized).toBeNull();
  const beforeExpiry = Date.parse(`${date}T20:10:00Z`);
  expect(qqqWindowVolatility(indexed, beforeExpiry, 10, .2, beforeExpiry, date).implied).toBeNull();
});
test('RVOL matches the same elapsed RTH minutes, excludes selected/future and incomplete days, requires five days', () => {
  const current = qqqPulseSeries(qqqRegularBarIndex(bars(20, 20), date)).slice(0, 10);
  const days: IntradayReferenceDay[] = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(day => ({ date: day, bars: bars(20, 10, day), levels: [] }));
  const result = qqqRvol(current, [...days, { date, bars: bars(20, 100000), levels: [] }], date);
  expect(result.value).toBe(2); expect(result.sampleDays).toBe(5); expect(result.baseline).toBe(100);
  expect(qqqRvol(current, days.slice(0, 4), date).value).toBeNull();
  expect(qqqRvol(current, days.map(day => ({ ...day, bars: day.bars.slice(1) })), date).sampleDays).toBe(0);
});
test('zero volume and zero RV never manufacture ratios', () => {
  const indexed = qqqRegularBarIndex(bars(20, 0), date);
  expect(qqqPulseSeries(indexed).at(-1)?.vwap).toBeNull();
  expect(qqqWindowVolatility(indexed, indexed.at(-1)!.time, 10, .2, indexed.at(-1)!.time, date).ratio).toBeNull();
});
test('cooperative RVOL preparation agrees with direct elapsed-time samples and cancels cleanly', async () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(day => ({ date: day, bars: bars(20, 10, day), levels: [] }));
  const current = qqqPulseSeries(qqqRegularBarIndex(bars(20, 20), date));
  const baseline = await prepareRvolBaseline(days, date, new AbortController().signal, async () => {});
  expect(qqqRvolFromBaseline(current.at(-1), baseline, current.at(-1)!.time)).toEqual(qqqRvol(current, days, date));
  expect(qqqRvolFromBaseline(current.at(-1), baseline, current.at(-1)!.time + 300001).value).toBeNull();
  const controller = new AbortController(); controller.abort();
  await expect(prepareRvolBaseline(days, date, controller.signal, async () => {})).rejects.toThrow();
});

test('post-close references stop at the actual regular close without changing intraday replay time', async () => {
  const { qqqRegularObservationCutoff } = await import('./qqqIntradayIndicators');
  expect(qqqRegularObservationCutoff(date, open + 600000)).toBe(open + 600000);
  const close = Date.parse('2026-10-16T20:00:00Z');
  expect(qqqRegularObservationCutoff(date, close + 840000)).toBe(close);
  expect(qqqRegularObservationCutoff('2026-11-27', Date.parse('2026-11-27T21:00:00Z'))).toBe(Date.parse('2026-11-27T18:00:00Z'));
  const source = bars(195).map((b, i) => ({ ...b, close: 100 + .01 * i }));
  const index = qqqRegularBarIndex(source, date);
  expect(qqqWindowVolatility(index, qqqRegularObservationCutoff(date, close + 840000), 10, .2, close, '2026-10-19').realizedPoints).not.toBeNull();
  expect(qqqWindowVolatility(index.slice(0, -3), close, 10, .2, close, '2026-10-19').realizedPoints).toBeNull();
});
