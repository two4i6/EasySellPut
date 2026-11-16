import type { QqqEb2Cycle } from './QqqEb2E44Fused';

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (cycle: QqqEb2Cycle, key: string) => Number(context(cycle)[key]);
const textField = (cycle: QqqEb2Cycle, key: string) => String(context(cycle)[key]);

/**
 * EB7.E2 latest-snapshot precision/release child.
 * Both arms are evaluated from the current bar; neither arm contains dates.
 */
export const EB7_E2_VETO_RULE = {
  id: 'EB7.E2.veto',
  rule: 'RSI14<60 AND ROC5>=0 AND TQQQROC20>=0 AND VIXTermStructureSlope>=2 AND navDrawdownPct<0.09 AND priceVsSma200Pct<0.10 AND range20dPct<0.08',
  blocks: (cycle: QqqEb2Cycle) => numberField(cycle, 'rsi14') < 60
    && numberField(cycle, 'roc5') >= 0
    && numberField(cycle, 'tqqqRoc20') >= 0
    && numberField(cycle, 'vixTermStructureSlope') >= 2
    && numberField(cycle, 'navDrawdownPct') < 0.09
    && numberField(cycle, 'priceVsSma200Pct') < 0.1
    && numberField(cycle, 'range20dPct') < 0.08,
} as const;

export const EB7_E2_RELEASE_RULE = {
  id: 'EB7.E2.release',
  rule: 'slowSubregimeHealth=STALE_OR_MISSING AND regime=RISK_ON_WEAKENING AND VIX>=16 AND RV20d>=0.40',
  accepts: (cycle: QqqEb2Cycle) => textField(cycle, 'slowSubregimeHealth') === 'STALE_OR_MISSING'
    && textField(cycle, 'regime') === 'RISK_ON_WEAKENING'
    && numberField(cycle, 'vix') >= 16
    && numberField(cycle, 'tqqqRealisedVol20d') >= 0.4,
} as const;

export const EB7_E2_RULE = {
  id: 'EB7.E2',
  veto: EB7_E2_VETO_RULE.rule,
  release: EB7_E2_RELEASE_RULE.rule,
} as const;
