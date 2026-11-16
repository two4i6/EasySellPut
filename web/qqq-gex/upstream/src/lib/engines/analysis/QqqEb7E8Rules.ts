import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

/** EB7.E8: four-field zero-loss continuation after EB7.E7. */
export const EB7_E8_RELEASE_RULE = {
  id: 'EB7.E8.release',
  rule: 'TQQQROC20<-0.10 AND navDrawdownPct<0.05 AND QQQER20>=0.20 AND VIX>=18',
  accepts: (cycle: QqqEb2Cycle) => numberField(cycle, 'tqqqRoc20') < -0.1
    && numberField(cycle, 'navDrawdownPct') < 0.05
    && numberField(cycle, 'qqqEr20') >= 0.2
    && numberField(cycle, 'vix') >= 18,
} as const;
