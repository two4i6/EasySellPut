/** Effective rolling R13/R15/R20/R62 policy, flattened; no grids or trade inputs. */
import type { StrategyObject } from '../strategy-module-v2';
import type { StrategyFeedback } from '../strategy-module-v2';
import { applyE209CooldownFeedback, decideE209Cooldown, initializeE209Cooldown, type E209CooldownState } from './eb7-e209-sources-v2';

export type E209RollingState = {
  cooldown: E209CooldownState;
  previousPreDate: string | null;
  previousPostDate: string | null;
  lastBar: string | null;
};
export const initializeE209Rolling = (): E209RollingState => ({ cooldown: initializeE209Cooldown(),
  previousPreDate: null, previousPostDate: null, lastBar: null });
/** Rolling-base source is an actual independent book, not final portfolio positions. */
export function feedbackE209Rolling(current: E209RollingState, feedback: StrategyFeedback, sourceAccount: string): E209RollingState {
  if ((feedback.kind === 'close' || feedback.kind === 'settle') && feedback.payload.sourceAccount === sourceAccount
    && current.lastBar !== null && feedback.asOf <= current.lastBar) throw new Error('Rolling feedback must precede its current decision');
  return { ...current, cooldown: applyE209CooldownFeedback(current.cooldown, feedback, sourceAccount) };
}
const number = (c: Readonly<StrategyObject>, key: string, fallback: number) => typeof c[key] === 'number' ? c[key] as number : fallback;
/** Effective pre-cooldown filters; no selected-date or completed-trade inputs. */
export function e209RollingBaseVeto(c: Readonly<StrategyObject>): boolean {
  const s = `${c.regime ?? ''}|${c.slowSubregime ?? ''}`, p = number(c, 'priceVsSma200Pct', Infinity);
  const a = number(c, 'adx14', -Infinity), r = number(c, 'tqqqRoc20', -Infinity);
  const v = number(c, 'vix', Infinity), t = number(c, 'vixTermStructureSlope', Infinity);
  const b1 = s === 'BULL|SR01', bull = s === 'BULL|SR02', ext = s === 'RISK_ON_EXTENDED|SR02';
  const release = c.regime === 'SIDEWAYS' || s === 'RANGE_BOUND|SR01'
    || (bull && (t < 2.5 || number(c, 'priceExtensionAtr', Infinity) < 0))
    || (b1 && (v >= 19 || r >= .1)) || (s === 'RISK_ON_WEAKENING|SR01' && a >= 25);
  return (s === 'RISK_ON_WEAKENING|SR01' && a < 18) || (p < .07 && a < 12 && r < 0)
    || (p < .04 && !release) || (b1 && v < 15) || (ext && a >= 40 && p < .10)
    || (bull && a < 15 && r >= .1)
    || (bull && ((a < 30 && p >= .07 && p < .09 && v >= 12 && v < 14)
      || (a >= 30 && p < .07 && t >= 2.5)
      || (p >= .11 && p < .30 && v < 15 && a >= 20 && a < 30 && t >= 2.5)))
    || (ext && p < .10 && v >= 12 && v < 14 && a >= 30)
    || (b1 && p < .09 && v >= 15 && v < 19 && a < 20);
}
const gapDays = (previous: string | null, asOf: string) => previous === null ? null
  : (Date.parse(asOf) - Date.parse(previous)) / 86_400_000;
/**
 * Called once per current bar. Proposal availability is as-of contract selection.
 * `baseAdmitted` instructs the module to open its rolling-base source book; its
 * actual fills/exits feed cooldown and overlap independently of `admitted`.
 * This component does not generate observations or execute any source account.
 */
export function decideE209Rolling(current: E209RollingState, asOf: string,
  proposal: { available: boolean; context: Readonly<StrategyObject> }, actualBaseOverlap: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))
    || (current.lastBar !== null && asOf <= current.lastBar)) throw new Error('Non-chronological rolling bar');
  let next: E209RollingState = { ...current, lastBar: asOf };
  const result = (baseAdmitted: boolean, admitted: boolean, reason: string) => ({ state: next, baseAdmitted, admitted, reason });
  if (!proposal.available) return result(false, false, 'source-unavailable');
  const c = proposal.context, s = `${c.regime ?? ''}|${c.slowSubregime ?? ''}`;
  if (e209RollingBaseVeto(c)) return result(false, false, 'base-veto');
  const preGap = gapDays(current.previousPreDate, asOf);
  next = { ...next, previousPreDate: asOf }; // Every pre-filter passing proposal advances this predecessor.
  if ((s === 'RISK_ON_EXTENDED|SR02' || s === 'BULL|SR02') && preGap !== null && preGap > 5 && preGap <= 15
    && number(c, 'adx14', -Infinity) < (s === 'RISK_ON_EXTENDED|SR02' ? 45 : 25)) return result(false, false, 'pre-gap');
  const cooldown = decideE209Cooldown(current.cooldown, asOf, c);
  next = { ...next, cooldown: cooldown.state };
  if (!cooldown.admitted) return result(false, false, 'settled-loss-cooldown');
  if (e209RollingRiskVeto(c, actualBaseOverlap)) return result(true, false, 'rolling-risk-veto');
  const postGap = gapDays(current.previousPostDate, asOf);
  next = { ...next, previousPostDate: asOf }; // Also advances when the CURRENT gap veto blocks this proposal.
  if (s === 'BULL|CURRENT' && postGap !== null && postGap > 10) return result(true, false, 'post-gap');
  const p = number(c, 'priceVsSma200Pct', Infinity), v = number(c, 'vix', Infinity);
  const r = number(c, 'tqqqRoc20', -Infinity), t = number(c, 'vixTermStructureSlope', Infinity), o = actualBaseOverlap;
  if ((s === 'RISK_ON_WEAKENING|SR02' && o >= 1 && o < 3 && v >= 10 && v < 19)
    || (s === 'BULL|SR02' && p >= .05 && p < .07 && o >= 2 && o < 5 && r >= .1)
    || (s === 'RISK_ON_EXTENDED|SR02' && p >= .11 && o >= 20 && v < 12 && t >= 2.5 && t < 3)) return result(true, false, 'post-risk-veto');
  return result(true, true, 'rolling-post');
}

export function e209RollingRiskVeto(context: Readonly<StrategyObject>, overlap: number): boolean {
  if (!Number.isInteger(overlap) || overlap < 0) throw new Error('Invalid realized source overlap');
  const n = (key: string, fallback: number) => typeof context[key] === 'number' ? context[key] as number : fallback;
  const s = `${context.regime ?? ''}|${context.slowSubregime ?? ''}`;
  const p = n('priceVsSma200Pct', Infinity), a = n('adx14', -Infinity), v = n('vix', Infinity);
  const r = n('tqqqRoc20', -Infinity), t = n('vixTermStructureSlope', Infinity), o = overlap;
  const bull = s === 'BULL|SR02', ext = s === 'RISK_ON_EXTENDED|SR02';
  const b1 = s === 'BULL|SR01', range = s === 'RANGE_BOUND|SR01', w1 = s === 'RISK_ON_WEAKENING|SR01';
  // R13 and R14 with R15's rescue: overlap comes from actual source positions.
  if (o < 2 && bull && (p >= .085 || v >= 16)) return true;
  if (o < 2 && s === 'RISK_ON_WEAKENING|SR02' && !((p < .07 || p >= .10) && r < 0 && t < 1)) return true;
  // R20 is a separate prior veto. R57/R58 releases must not resurrect it.
  const r20 = (ext && p < .083 && a >= 25 && v >= 12 && v < 15)
    || (bull && p >= .085 && p < .10 && a < 11 && v < 12.5 && r < 0)
    || (ext && p >= .095 && p < .105 && a >= 25 && a < 45 && v >= 13 && v < 14.5 && r > .18)
    || (o < 3 && (b1 || range) && p >= .04 && p < .07 && r < 0 && v >= 17);
  if (r20) return true;
  // Flatten R33 -> R35 -> R45 -> R51 -> R56 into one predicate.
  const r56 = (bull && o >= 2 && o < 10 && a >= 9 && a < 30 && v < 13 && r > 0 && t >= 2.5)
    || (w1 && p >= .03 && p < .067 && r >= -.10 && r < -.04 && a >= 20 && a < 30 && v >= 15 && v < 18)
    || (ext && o >= 10 && o < 18 && p >= .085 && a >= 20 && a < 45 && v >= 13 && v < 15 && r > 0 && t >= 2.5)
    || (range && o >= 8 && p < .075 && a < 20 && v >= 17 && r < -.10 && t < 2)
    || (b1 && o < 7 && p < .07 && a >= 20 && a < 35 && v >= 15 && v < 17 && r > 0 && t >= 2.8)
    || (b1 && o < 2 && p >= .08 && p < .10 && a >= 20 && a < 30 && v >= 17 && t < 1)
    || (b1 && o < 2 && p >= .08 && p < .10 && a >= 30 && v >= 18 && r > 0 && t >= 2.5)
    || (bull && o >= 10 && o < 13 && p >= .08 && p < .10 && a >= 35 && a < 45 && v >= 13.5 && v < 15 && r > 0 && t >= 2.5)
    || (bull && o >= 13 && o < 18 && p >= .07 && p < .09 && a >= 13 && a < 19 && v >= 12 && v < 16 && r > 0 && t >= 2.7)
    || (ext && o >= 15 && p >= .105 && a >= 20 && a < 30 && v < 12 && r > 0 && t < 2.5)
    || (range && o >= 7 && o < 12 && p >= .075 && p < .085 && a < 12 && v >= 13 && v < 20 && r > 0 && t >= 1.8)
    || (bull && o >= 20 && p >= .10 && a >= 17 && a < 21 && v < 10.5 && r > 0)
    || (bull && o >= 4 && o < 8 && p >= .08 && p < .09 && a < 11 && v < 12.5 && r > 0 && t >= 2.7)
    || (ext && o >= 20 && p >= .11 && a >= 27 && v >= 15 && v < 17 && r < .12 && t >= 2.7)
    || (w1 && p >= .03 && p < .05 && a >= 18 && a < 30 && v >= 17 && v < 19 && r < -.08 && t < 1.5)
    || (bull && p >= .10 && p < .11 && a >= 20 && a < 30 && v >= 15 && v < 17.5 && r > 0 && t < 2.3)
    || (ext && o >= 15 && p >= .115 && a >= 20 && a < 22 && v >= 16.2 && v < 16.5 && r > 0 && t >= 3.9)
    || ((bull || ext) && o >= 20 && p >= .105 && a >= 15 && a < 20 && v >= 12 && v < 13 && r > 0 && t < 2.5)
    || (s === 'RISK_ON_WEAKENING|SR02' && p >= .07 && p < .09 && r >= 0 && r < .05)
    || (range && p < .05 && r >= .05 && r < .10);
  const release = (range && p >= .04 && p < .05 && a >= 15 && v >= 20)
    || (bull && p >= .06 && p < .07 && a < 14 && v >= 12 && v < 13 && r >= .04 && r < .10 && t >= 3)
    || (ext && p >= .11 && p < .112 && a >= 27 && a < 29 && v < 10.5 && t >= 2.2 && t < 2.5)
    || (bull && p >= .07 && p < .08 && a >= 20 && a < 25 && v < 12.5 && r < .01 && t >= 3.5);
  return (r56 && !release)
    || (ext && p >= .11 && p < .13 && a >= 20 && a < 25 && v < 12)
    || (bull && o >= 10 && o < 15 && a >= 30 && a < 40 && t >= 2 && t < 2.5)
    || (bull && o >= 5 && o < 10 && a >= 15 && a < 20 && t >= 2 && t < 2.5);
}
