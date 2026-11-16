import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);
const textField = (cycle: QqqEb2Cycle, key: string) => String(context(cycle)[key]);

/** EB7.E5: highest-P&L zero-loss continuation after EB7.E4 on the latest snapshot. */
export const EB7_E5_RELEASE_RULE = {
  id: 'EB7.E5.release',
  rule: 'trend=BEAR AND distanceToSma50Pct>=0 AND vixTermStructureSlope<2 AND TQQQRealisedVol20d<0.80 AND sma20SlopePct<0.02',
  accepts: (cycle: QqqEb2Cycle) => textField(cycle, 'trend') === 'BEAR'
    && numberField(cycle, 'distanceToSma50Pct') >= 0
    && numberField(cycle, 'vixTermStructureSlope') < 2
    && numberField(cycle, 'tqqqRealisedVol20d') < 0.8
    && numberField(cycle, 'sma20SlopePct') < 0.02,
} as const;
