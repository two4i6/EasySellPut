import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

/** EB7.E3: simplest latest-fixture zero-loss continuation after EB7.E2. */
export const EB7_E3_RELEASE_RULE = {
  id: 'EB7.E3.release',
  rule: 'VIXTermStructureSlope>=4 AND range20dPct<0.05 AND ADX14>=12 AND VIX>=16',
  accepts: (cycle: QqqEb2Cycle) => numberField(cycle, 'vixTermStructureSlope') >= 4
    && numberField(cycle, 'range20dPct') < 0.05
    && numberField(cycle, 'adx14') >= 12
    && numberField(cycle, 'vix') >= 16,
} as const;
