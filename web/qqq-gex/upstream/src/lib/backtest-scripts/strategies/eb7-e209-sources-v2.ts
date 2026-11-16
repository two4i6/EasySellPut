/** E209 source admission primitives. Only current observations/proposals enter here. */
import type { StrategyObject, StrategyFeedback } from '../strategy-module-v2';
import {settledFeedbackPnl} from '../settlement-observations-v3';

export type E209SourceObservation = {
  available: boolean;
  width: number;
  context: Readonly<StrategyObject>;
};
export type E209RollingObservation = E209SourceObservation & { admitted: boolean };
const n = (c: Readonly<StrategyObject>, key: string, fallback = Number.NaN) => {
  const value = c[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const state = (c: Readonly<StrategyObject>) => `${c.regime ?? ''}|${c.slowSubregime ?? ''}`;

/**
 * The effective rescue5Lite screen, reduced from research grids to seven releases.
 * Rolling WR7 uses the rolling source's own contract/context, not this arm's width.
 * The source complement excludes R2-blocked proposals before any releases.
 */
export function evaluateE209E1Screen(source: E209SourceObservation, rolling: E209RollingObservation) {
  if (!source.available) return { admitted: false, reason: 'source-unavailable' };
  const c = source.context, s = state(c), width = source.width;
  const post = rolling.available && rolling.admitted;
  if (post) {
    const r = rolling.context, rs = state(r), rw = rolling.width;
    const wr7 = (rs === 'BULL|SR02' && rw === 6
      && (n(r, 'tqqqRealisedVol20d') >= .5 || n(r, 'vixChange5d') < -.095))
      || (rs === 'RISK_ON_WEAKENING|SR01' && rw === 10 && n(r, 'vix') < 16.5)
      || (rs.startsWith('RANGE_BOUND') && n(r, 'weakeningSignalCount') >= 3
        && (rs === 'RANGE_BOUND|CURRENT' || (rs === 'RANGE_BOUND|SR01' && rw === 15)));
    const r2 = s === 'RISK_ON_WEAKENING|SR01' && n(c, 'adx14', Infinity) < 18;
    return { admitted: !wr7 && !r2, reason: wr7 ? 'WR7' : r2 ? 'R2' : 'rolling-post' };
  }
  // The source complement is the raw R2-passing universe, not all raw proposals.
  if (s === 'RISK_ON_WEAKENING|SR01' && n(c, 'adx14', Infinity) < 18) return { admitted: false, reason: 'R2' };
  const releases: Array<[string, boolean]> = [
    ['R1', s === 'BULL|SR02' && width >= 17 && n(c, 'vix') >= 15 && n(c, 'tqqqRealisedVol20d', Infinity) < .5],
    ['SR02', s === 'BULL|SR02' && width >= 7 && n(c, 'priceVsSma200Pct', Infinity) < .07],
    ['SR01', s === 'BULL|SR01' && width >= 7 && n(c, 'adx14', Infinity) < 15],
    ['extra', s === 'BULL|SR01' && n(c, 'tqqqRealisedVol20d') >= .45 && n(c, 'priceExtensionAtr') >= 2],
    ['wide-rounded', s === 'BULL|SR02' && width >= 18 && n(c, 'tqqqRealisedVol20d', Infinity) < .55
      && n(c, 'priceExtensionAtr', Infinity) < 2 && n(c, 'adx14') >= 15],
    ['rescue-bull-lite', s === 'BULL|SR01' && width >= 18 && n(c, 'vix', Infinity) < 15],
    ['rescue-range-lite', s === 'RANGE_BOUND|SR01' && n(c, 'drawdownFromRecentHighPct') >= .05 && n(c, 'vix', Infinity) < 19],
  ];
  const match = releases.find(([, accepts]) => accepts);
  return { admitted: !!match, reason: match?.[0] ?? 'screen-no-match' };
}

/** Default C4 layer union collapses to E1-screen + one guard + two independent rescues. */
export function evaluateE209C4(source: E209SourceObservation, rolling: E209RollingObservation) {
  return evaluateE209C4WithScreen(source, evaluateE209E1Screen(source, rolling));
}

/** Screen account uses its OWN 5%/4.5% contract; C4 execution uses its own wider contract. */
export function evaluateE209C4WithScreen(source: E209SourceObservation, screen: { admitted: boolean; reason: string }) {
  if (!source.available) return { admitted: false, reason: 'source-unavailable' };
  const c = source.context, s = state(c);
  const guarded = n(c, 'roc5') >= .034 && n(c, 'adx14') < 10;
  if (screen.admitted && !guarded) return { admitted: true, reason: `screen:${screen.reason}` };
  if (s === 'RISK_ON_WEAKENING|SR01' && source.width >= 20 && n(c, 'vix') >= 16 && n(c, 'vix') < 19
    && n(c, 'drawdownFromRecentHighPct') >= .05 && n(c, 'vixChange5d') < .05) return { admitted: true, reason: 'C4-weak-rescue' };
  if (s === 'BULL|SR02' && source.width >= 25 && n(c, 'vix') < 16 && n(c, 'vixChange5d') <= -.01
    && n(c, 'priceVsSma200Pct') < .11 && n(c, 'priceExtensionAtr') < 2) return { admitted: true, reason: 'C4-bull-rescue' };
  return { admitted: false, reason: guarded && screen.admitted ? 'C4-guard' : 'C4-no-match' };
}

export type E209CooldownState = { pendingLoss: boolean; lastFeedbackAsOf: string | null; lastDecisionAsOf: string | null };
export const initializeE209Cooldown = (): E209CooldownState => ({ pendingLoss: false, lastFeedbackAsOf: null, lastDecisionAsOf: null });
/** Called ONLY with actual close/settle feedback, never a forecast or completed pool. */
export function applyE209CooldownSettlement(current: E209CooldownState, asOf: string, sourcePnl: number): E209CooldownState {
  if (!Number.isFinite(sourcePnl) || (current.lastFeedbackAsOf !== null && asOf < current.lastFeedbackAsOf)
    || (current.lastDecisionAsOf !== null && asOf <= current.lastDecisionAsOf)) throw new Error('Non-chronological E1 settlement');
  return { ...current, pendingLoss: current.pendingLoss || sourcePnl <= -400, lastFeedbackAsOf: asOf };
}
/** Host feedback boundary: only this source's realized weighted loss counts. */
export function applyE209CooldownFeedback(current: E209CooldownState, feedback: StrategyFeedback,
  sourceAccount: string): E209CooldownState {
  if (!sourceAccount || sourceAccount === 'portfolio') throw new Error('Cooldown requires an independent source account');
  if ((feedback.kind !== 'close' && feedback.kind !== 'settle')
    || feedback.payload.sourceAccount !== sourceAccount) return current;
  const pnl = settledFeedbackPnl(feedback,'Cooldown requires realized source P&L')!;
  return applyE209CooldownSettlement(current, feedback.asOf, pnl);
}
export function decideE209Cooldown(current: E209CooldownState, asOf: string, context: Readonly<StrategyObject>) {
  if ((current.lastDecisionAsOf !== null && asOf <= current.lastDecisionAsOf)
    || (current.lastFeedbackAsOf !== null && asOf < current.lastFeedbackAsOf)) throw new Error('Non-chronological E1 decision');
  const exempt = state(context) === 'BULL|SR01' && n(context, 'priceVsSma200Pct', Infinity) < .07;
  return { admitted: !current.pendingLoss || exempt,
    state: { ...current, pendingLoss: false, lastDecisionAsOf: asOf } };
}
