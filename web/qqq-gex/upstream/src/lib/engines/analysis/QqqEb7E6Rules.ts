import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);
const textField = (cycle: QqqEb2Cycle, key: string) => String(context(cycle)[key]);

/** EB7.E6: four-field zero-loss continuation after EB7.E5. */
export const EB7_E6_RELEASE_RULE = {
  id: 'EB7.E6.release',
  rule: 'RSI14>=70 AND trend=BULL AND VIXTermStructureSlope<2 AND ADX14<30',
  accepts: (cycle: QqqEb2Cycle) => numberField(cycle, 'rsi14') >= 70
    && textField(cycle, 'trend') === 'BULL'
    && numberField(cycle, 'vixTermStructureSlope') < 2
    && numberField(cycle, 'adx14') < 30,
} as const;
