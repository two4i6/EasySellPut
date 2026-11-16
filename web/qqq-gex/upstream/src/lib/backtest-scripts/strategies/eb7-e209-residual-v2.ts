/** Pure current-bar E2-E8 admission stage. No cycle objects, dates, P&L or completed-trade inputs. */
import type { StrategyObject } from '../strategy-module-v2';
import { createEquityBoostDteHysteresisState, updateEquityBoostDteHysteresisState, type EquityBoostDteHysteresisState } from '../../engines/leveraged-overlay/v2/strategies/equity-boost-put-spread';

type Context = Readonly<StrategyObject>;
const n = (context: Context, key: string) => Number(context[key]);
export function e209ParentVeto(c: Context): boolean {
  return n(c, 'rsi14') < 60 && n(c, 'roc5') >= 0 && n(c, 'tqqqRoc20') >= 0
    && n(c, 'vixTermStructureSlope') >= 2 && n(c, 'navDrawdownPct') < .09
    && n(c, 'priceVsSma200Pct') < .1 && n(c, 'range20dPct') < .08;
}

// Replace six inherited builder layers with one ordered OR, keeping first-hit provenance.
export const E209_RESIDUAL_RULES_V2 = [
  { id: 'E2', accepts: (c: Context) => c.slowSubregimeHealth === 'STALE_OR_MISSING' && c.regime === 'RISK_ON_WEAKENING'
    && n(c, 'vix') >= 16 && n(c, 'tqqqRealisedVol20d') >= .4 },
  { id: 'E3', accepts: (c: Context) => n(c, 'vixTermStructureSlope') >= 4 && n(c, 'range20dPct') < .05
    && n(c, 'adx14') >= 12 && n(c, 'vix') >= 16 },
  { id: 'E4', accepts: (c: Context) => n(c, 'tqqqRealisedVol20d') < .3 && n(c, 'vix') >= 16 && n(c, 'rsi14') >= 70
    && n(c, 'roc20') < .1 && n(c, 'adx14') < 35 },
  { id: 'E5', accepts: (c: Context) => c.trend === 'BEAR' && n(c, 'distanceToSma50Pct') >= 0
    && n(c, 'vixTermStructureSlope') < 2 && n(c, 'tqqqRealisedVol20d') < .8 && n(c, 'sma20SlopePct') < .02 },
  { id: 'E6', accepts: (c: Context) => n(c, 'rsi14') >= 70 && c.trend === 'BULL'
    && n(c, 'vixTermStructureSlope') < 2 && n(c, 'adx14') < 30 },
  { id: 'E7', accepts: (c: Context) => n(c, 'vixTermStructureSlope') >= 4 && n(c, 'priceExtensionAtr') < 1
    && n(c, 'adx14') >= 18 && n(c, 'priceVsSma200Pct') >= .05 },
  { id: 'E8', accepts: (c: Context) => n(c, 'tqqqRoc20') < -.1 && n(c, 'navDrawdownPct') < .05
    && n(c, 'qqqEr20') >= .2 && n(c, 'vix') >= 18 },
] as const;

/** Source membership must come from causal upstream proposals, not a recovered research pool. */
export function evaluateE209ResidualStage(input: { context: Context; e0Admitted: boolean; residualEligible: boolean }) {
  if (input.e0Admitted) return { admitted: !e209ParentVeto(input.context), reason: e209ParentVeto(input.context) ? 'E2-veto' : 'E0-parent' };
  if (!input.residualEligible) return { admitted: false, reason: 'upstream-unavailable' };
  const match = E209_RESIDUAL_RULES_V2.find(rule => rule.accepts(input.context));
  return { admitted: !!match, reason: match?.id ?? 'residual-no-match' };
}

/** Two source-arm states, not two completed ledgers; strategy state owns both. */
export function initializeE209DteArms() {
  return { high: createEquityBoostDteHysteresisState(), low: createEquityBoostDteHysteresisState() };
}
export function advanceE209DteArms(state: { high: EquityBoostDteHysteresisState; low: EquityBoostDteHysteresisState }, vxn: number) {
  if (!Number.isFinite(vxn) || vxn <= 0) throw new Error('Missing current-bar VXN for E209 DTE');
  const common = { vxnThreshold: 24, recoveryVxnThreshold: 22.4 };
  return { high: updateEquityBoostDteHysteresisState(state.high, vxn, { ...common, minHighRiskDays: 3 }),
    low: updateEquityBoostDteHysteresisState(state.low, vxn, { ...common, minHighRiskDays: 2 }) };
}

/** Consume every as-of VXN input since native warm-up, including unavailable-stock bars. */
export function consumeE209DteObservations(current: {
  arms: ReturnType<typeof initializeE209DteArms>; nextIndex: number | null;
}, observations: { firstIndex: number; endIndexExclusive: number; values: readonly (number | null)[] }) {
  const { firstIndex, endIndexExclusive, values } = observations;
  if (!Number.isInteger(firstIndex) || firstIndex < 0 || !Number.isInteger(endIndexExclusive)
    || endIndexExclusive < firstIndex || values.length !== endIndexExclusive - firstIndex
    || (current.nextIndex !== null && current.nextIndex !== firstIndex)) throw new Error('Non-contiguous DTE observations');
  let arms = current.arms;
  for (const vxn of values) {
    if (vxn === null) continue; // Native missing-VXN semantics: preserve the prior state.
    arms = advanceE209DteArms(arms, vxn);
  }
  return { arms, nextIndex: endIndexExclusive };
}
