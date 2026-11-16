import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

/** EB7.E7: four-field zero-loss continuation after EB7.E6. */
export const EB7_E7_RELEASE_RULE = {
  id: 'EB7.E7.release',
  rule: 'VIXTermStructureSlope>=4 AND priceExtensionAtr<1 AND ADX14>=18 AND priceVsSma200Pct>=0.05',
  accepts: (cycle: QqqEb2Cycle) => numberField(cycle, 'vixTermStructureSlope') >= 4
    && numberField(cycle, 'priceExtensionAtr') < 1
    && numberField(cycle, 'adx14') >= 18
    && numberField(cycle, 'priceVsSma200Pct') >= 0.05,
} as const;
