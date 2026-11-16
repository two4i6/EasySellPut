import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);

/** EB7.E4: simplest latest-fixture zero-loss continuation after EB7.E3. */
export const EB7_E4_RELEASE_RULE = {
  id: 'EB7.E4.release',
  rule: 'TQQQRealisedVol20d<0.30 AND VIX>=16 AND RSI14>=70 AND ROC20<0.10 AND ADX14<35',
  accepts: (cycle: QqqEb2Cycle) => numberField(cycle, 'tqqqRealisedVol20d') < 0.3
    && numberField(cycle, 'vix') >= 16
    && numberField(cycle, 'rsi14') >= 70
    && numberField(cycle, 'roc20') < 0.1
    && numberField(cycle, 'adx14') < 35,
} as const;
