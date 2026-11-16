import { expect, test } from 'bun:test';
import { buildQqqDailyMarketBase, clearQqqDailyMarketBaseCache } from './QqqDailyMarketBase';

function bars(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * .4;
    return {
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: close - .2,
      high: close + .4,
      low: close - .4,
      close,
      volume: 1_000,
    };
  });
}

test('shared QQQ daily base computes common metrics once for equivalent PCS/CS inputs', () => {
  clearQqqDailyMarketBaseCache();
  const input = { qqqBars: bars(30), vix: 18, vix3m: 20, previousVix: 17 };
  const pcsBase = buildQqqDailyMarketBase(input);
  const csBase = buildQqqDailyMarketBase({ ...input, qqqBars: input.qqqBars.map((bar) => ({ ...bar })) });

  expect(pcsBase).toBe(csBase);
  expect(pcsBase.qqqRoc5).toBeCloseTo((input.qqqBars.at(-1)!.close / input.qqqBars.at(-6)!.close) - 1, 10);
  expect(pcsBase.annualizedRv20).toBeGreaterThan(0);
  expect(pcsBase.sma50).toBeNull();
});
