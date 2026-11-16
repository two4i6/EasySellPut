/** R9 policy v5: exact effective policy-v4 rules, with direct shared open selection. */
import {freezeStrategyData,type StrategyObject} from '../strategy-module-v2';
/** Pure current-bar policy/contract kernel, composed by the complete standalone module. */
import { buildPutCreditSpreadOpen, attemptPutCreditSpreadOpen, createPutCreditSpreadPreparation, evaluatePutCreditSpreadSafety, resolvePcsRescueExtremeWidth, resolvePcsRescueShortDelta } from '../put-spread-kernel-v6';
import type { SpreadFillRetryPolicy } from '../spread-fill-retry-v2';
import { explainReactivePcsTiming } from '../../engines/analysis/PcsReactiveRule';
import {isPcsCandidate3TimingWindow} from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';

export const R9_E226_LINEAGE = freezeStrategyData({ parent: 'R9.E221', source: 'R9.E226 current-bar', id: 'R9.E226' } as const);
export {R9_E226_SOURCE_CONTRACT} from './r9-e226-source-contract-v1';
// Standalone owns its resolved effective contract. No research-script import or inherited builder.
export const R9_E226_PARAMS = freezeStrategyData({
  targetDte: 35 as const, riskBudgetNav: .005, widthPct: .0218, nonBullWidthPct: .045,
  extremeWidthPct: .055, extremeNarrowWidthPct: .043,
  calmDelta: .1839, normalDelta: .135, pressureDelta: .04,
  extremeDelta: .2425, extremeBaseDelta: .2075, extremeFallbackDelta: .206,
  deltaMode: 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt6_term_lt1_9_if_non_bull_sr02_v3' as const,
  retryWidthPct: .01, retryDeltaUplifts: [.025, .01, .0375, .079], retryRiskCap: .0051538,
  fillFallbackWidthPct: .03, fillFallbackBullSr01VixMax: 15.5,
  fillFallbackReleaseRoc5Min: .03, fillFallbackReleaseEr20Min: .15,
  fillFallbackWeakVixMax: 16, fillFallbackAnyStateRoc5Max: 0,
  fillFallbackQuoteOnlyBullSr01Rv20Min: .61,
  streakCooldownTradingDays: 0,
} satisfies StrategyObject);

export type R9E226Market = {
  regime: string; slowSubregime?: string; vix?: number; vix3m?: number;
  /** Overlay's primary-volatility term slope; distinct from regime VIX. */
  primaryTermSlope?: number;
  rv20?: number; adx14?: number; trendScore?: number; sma200Pct?: number;
  priceExtensionAtr?: number; regimePriceExtensionAtr?: number; range20dPct?: number;
  roc5?: number; roc20?: number; er20?: number; rsi14?: number; weakeningCount?: number; ma50SlopePct?: number;
  // These coordinates are intentionally distinct: raw VIX delta vs regime's fractional change.
  vixChange5d?: number; regimeVixChange5d?: number;
  preCrisisActive?: boolean; versionPressure?: boolean; extremePressure?: boolean;
  drawdownFromRecentHighPct?: number;
};
const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const ge = (n: number | undefined, min: number) => finite(n) && n >= min;
const lt = (n: number | undefined, max: number) => finite(n) && n < max;
const band = (n: number | undefined, min: number, max: number) => ge(n, min) && lt(n, max);

/** Effective E226 complement: flatten the selected repaired P3/R7/R8 ancestry only.
 * Bounds and missing-field semantics are preserved; these are observations, not trade outcomes.
 */
export function r9E226Complement(m: Readonly<R9E226Market>) {
  const sr1 = m.slowSubregime === 'SR01', sr2 = m.slowSubregime === 'SR02';
  const v = m.vix, a = m.adx14, rv = m.rv20;
  const macro = (m.regime !== 'SIDEWAYS' && ge(rv, .67))
    || (m.regime !== 'RISK_ON_WEAKENING' && ge(v, 18) && (lt(rv, .5) || ge(a, 22)))
    || (ge(m.range20dPct, .07) && lt(m.er20, .1))
    || (m.regime === 'BULL' && ge(v, 17) && lt(m.er20, .3))
    || (m.regime === 'BULL' && sr2 && band(v, 14, 18) && ge(m.range20dPct, .08));
  if (macro) return true;
  switch (m.regime) {
    case 'RANGE_BOUND': return sr1
      ? (lt(v, 19.5) && (lt(v, 19) || (ge(m.priceExtensionAtr, 0) && (lt(m.roc5, 0) || ge(m.weakeningCount, 1)))))
        || (band(v, 20, 25) && lt(a, 19.5)) || (ge(v, 25) && lt(a, 20))
      : ge(a, 12);
    case 'SIDEWAYS': return sr2 || (sr1 && band(v, 13, 19) && ge(a, 12) && lt(rv, .8));
    case 'RISK_ON_WEAKENING': return (sr1 && (band(a, 20, 25) || (lt(v, 20) && lt(a, 30))))
      || (sr2 && (band(a, 20, 25) || (lt(v, 20) && (band(a, 15, 20) || ge(a, 30)))));
    case 'RISK_ON_EXTENDED': return (sr1 && ((band(v, 13, 17) && lt(a, 20) && lt(rv, .5))
        || (lt(v, 20) && lt(a, 30) && lt(m.priceExtensionAtr, 3))))
      || (sr2 && ((ge(v, 17) && ge(a, 20))
        || (lt(v, 17) && band(a, 20, 25) && ge(rv, .5))
        || (band(v, 13, 17) && band(a, 20, 25) && lt(rv, .5))
        || (band(v, 13, 17) && band(a, 25, 30) && lt(rv, .5) && lt(m.roc5, 0))
        || (band(v, 14, 17) && band(a, 25, 30) && lt(rv, .5))
        || (band(v, 13, 17) && band(a, 15, 20) && lt(rv, .5) && (lt(m.roc5, 0) || lt(m.er20, .2)))
        || (band(v, 16, 17) && ge(a, 30))));
    case 'BULL': return (sr1 && ((band(v, 13, 17) && band(a, 20, 30) && lt(rv, .5))
        || (band(v, 17, 20) && ge(a, 20)) || (band(v, 20, 25) && ge(a, 30))
        || (lt(v, 17) && band(a, 26, 30) && ge(rv, .5))
        || (lt(v, 17.5) && lt(a, 25) && ge(m.roc20, 0))))
      || (sr2 && ((band(v, 10, 13) && band(a, 20, 25))
        || (band(v, 13, 15) && band(a, 15, 20) && ge(m.roc20, 0))
        || (band(v, 13, 17) && band(a, 20, 25) && lt(m.roc5, 0))
        || (band(v, 17, 19) && band(a, 15, 25))
        || (band(v, 20, 25) && lt(a, 25))
        || (band(v, 13, 17) && band(a, 25, 30))
        || (lt(v, 13) && band(a, 13, 25))
        || (lt(v, 13) && band(a, 25, 30) && lt(m.roc5, 0))
        || (band(v, 16, 20) && lt(a, 25))));
    default: return false;
  }
}

/** Source activation only. Macro timing and regime research VIX remain separate observations.
 * E226's independent one-contract mode permits overlapping puts, but never bypasses safety.
 */
export function r9E226SourceAdmission(input: {
  market: Readonly<R9E226Market>; macroVix?: number; macroVix3m?: number;
  crisisPhase?: string; backwardation: boolean; hasOpenCollar: boolean; collarTriggered: boolean;
}) {
  const m = input.market;
  const safety = evaluatePutCreditSpreadSafety({ ...input, enabled:true, regime:m.regime, hasOpenPutSpread:false });
  const timing = explainReactivePcsTiming({ symbol:'QQQ', regime:m.regime, crisisPhase:input.crisisPhase,
    vix:input.macroVix ?? NaN, vix3m:input.macroVix3m ?? NaN });
  const softTiming = !timing.reasonCodes.some(reason => ['CRISIS_PHASE','BACKWARDATED_TERM','MISSING_VIX','MISSING_TERM_RATIO'].includes(reason))
    && (timing.eligible || timing.reasonCodes.includes('VIX_OUT_OF_RANGE') || timing.reasonCodes.includes('REGIME_DISALLOWED'));
  const candidate3Timing = finite(m.vix) && finite(m.adx14)
    && isPcsCandidate3TimingWindow({regime:m.regime,vix:m.vix,adx14:m.adx14});
  const originalSignal = safety && (timing.eligible || candidate3Timing);
  const complement = r9E226Complement(m), scope = r9E226RegimeScope(m);
  return { safety, softTiming, originalSignal, complement, scope,
    sourceActive:safety && (scope || complement) && (softTiming || complement || originalSignal) };
}

/** Same-bar proposal priority; presence means a proposal actually formed, not just a signal. */
export function r9E226ProposalPriority(input: {
  market: Readonly<R9E226Market>; sourceActive:boolean;
  mainPcsProposalBuilt:boolean; rescueProposalBuilt:boolean;
}) {
  const complement = r9E226Complement(input.market), dualQuality = r9E226DualMainQuality(input.market);
  const rescue = input.sourceActive && input.rescueProposalBuilt
    && (!input.mainPcsProposalBuilt || complement || dualQuality);
  const replacesMain = rescue && input.mainPcsProposalBuilt && complement && !dualQuality;
  return { rescue, main:input.mainPcsProposalBuilt && !replacesMain, replacesMain,
    dual:rescue && input.mainPcsProposalBuilt && dualQuality };
}

/** Evaluated at fill retry from the saved SIGNAL observation, never a future regime/outcome. */
export function r9E226FillFallbackAllowed(m: Readonly<R9E226Market>) {
  return ['RANGE_BOUND','SIDEWAYS','RISK_ON_WEAKENING','RISK_ON_EXTENDED'].includes(m.regime)
    || (finite(m.roc5) && m.roc5 <= R9_E226_PARAMS.fillFallbackAnyStateRoc5Max)
    || (m.regime === 'BULL' && (ge(m.vix, 16)
      || (lt(m.vix, 16) && (lt(m.adx14, 15)
        || (m.slowSubregime === 'SR01' && finite(m.vix) && m.vix <= R9_E226_PARAMS.fillFallbackBullSr01VixMax)
        || (m.slowSubregime === 'SR02' && finite(m.vixChange5d) && m.vixChange5d <= -.02)))
      || (m.slowSubregime === 'SR02' && (lt(m.vix, 12) || ge(m.vixChange5d, 0)))));
}

export function r9E226ExpandedChainRelease(m: Readonly<R9E226Market>) {
  return ge(m.roc5, R9_E226_PARAMS.fillFallbackReleaseRoc5Min)
    || (ge(m.roc5, 0) && (ge(m.er20, R9_E226_PARAMS.fillFallbackReleaseEr20Min)
      || (finite(m.vix) && m.vix <= R9_E226_PARAMS.fillFallbackWeakVixMax)));
}

/** Signal-time policy only. The shared adapter owns future execution observations. */
export function r9E226FillRetryPolicy(input: {
  signalMarket: Readonly<R9E226Market>; signalDelta:number; nav:number;
}): SpreadFillRetryPolicy | null {
  if (!finite(input.nav) || input.nav <= 0 || !finite(input.signalDelta) || input.signalDelta <= 0)
    throw new Error('R9 fill retry requires actual NAV and signal delta');
  if (!r9E226FillFallbackAllowed(input.signalMarket)) return null;
  const m = input.signalMarket;
  const pairSearchMode = m.regime === 'BULL' && m.slowSubregime === 'SR01'
    && (m.rv20 ?? Number.NEGATIVE_INFINITY) < R9_E226_PARAMS.fillFallbackQuoteOnlyBullSr01Rv20Min
    ? undefined : 'quote_only_width_v1' as const;
  return { version:'delta-parent-preserving-v1', targetDte:R9_E226_PARAMS.targetDte,
    widthPct:R9_E226_PARAMS.fillFallbackWidthPct, nav:input.nav, riskBudget:R9_E226_PARAMS.riskBudgetNav,
    forceMinimumContract:false, shortDelta:input.signalDelta, ...(pairSearchMode ? {pairSearchMode} : {}),
    expandedSearch:r9E226ExpandedChainRelease(m) ? 'nearest-feasible' : 'none' };
}

/** Flatten only E226's effective v106 scope, not 106 historical builder layers. */
export function r9E226RegimeScope(m: Readonly<R9E226Market>) {
  if (m.regime === 'RISK_ON_WEAKENING') return true;
  if (m.regime === 'RANGE_BOUND') return !(ge(m.rv20, .5) && finite(m.vix) && m.vix > 18)
    || (finite(m.priceExtensionAtr) && m.priceExtensionAtr > -2);
  if (m.regime === 'BULL') return !(lt(m.vix, 12) && lt(m.adx14, 13.5))
    || ge(m.priceExtensionAtr, 0) || lt(m.vix, 10) || lt(m.er20, .1);
  if (m.regime === 'SIDEWAYS') {
    const initial = finite(m.vix) && m.vix > 18
      && (lt(m.adx14, 12) || ge(m.adx14, 20) || lt(m.sma200Pct, .12));
    return (initial && !(band(m.adx14, 12, 20) && ge(m.rv20, .67)))
      || lt(m.rv20, .86) || ge(m.adx14, 16) || (lt(m.priceExtensionAtr, 2) && ge(m.roc5, 0))
      || ge(m.vix, 19) || ge(m.roc5, .02);
  }
  if (m.regime !== 'RISK_ON_EXTENDED') return false;
  const initial = (lt(m.vix, 14) && ge(m.adx14, 12) && finite(m.adx14) && m.adx14 <= 30)
    || (lt(m.vix, 12) && lt(m.adx14, 12)) || (band(m.vix, 14, 18) && lt(m.adx14, 30))
    || (lt(m.vix, 18) && lt(m.sma200Pct, .15));
  const tails = (band(m.vix, 12, 14) && ge(m.adx14, 45) && ge(m.regimePriceExtensionAtr, 3))
    || (band(m.rv20, .48, .55) && lt(m.sma200Pct, .09))
    || (ge(m.adx14, 44.5) && band(m.sma200Pct, .085, .10))
    || (band(m.adx14, 28, 32) && ((lt(m.vix, 10) && ge(m.sma200Pct, .13))
      || (band(m.vix, 13, 13.5) && ge(m.sma200Pct, .16))));
  return (initial && !tails) || lt(m.adx14, 20) || ge(m.sma200Pct, .21)
    || (ge(m.sma200Pct, .17) && lt(m.roc5, 0)) || (ge(m.weakeningCount, 1) && lt(m.drawdownFromRecentHighPct, .005))
    || (band(m.drawdownFromRecentHighPct, .005, .01)
      && ((lt(m.vix, 15) && lt(m.priceExtensionAtr, 3.5) && (m.weakeningCount ?? 0) < 1)
        || (ge(m.vix, 15) && ge(m.roc20, .08))))
    || (ge(m.priceExtensionAtr, 3.5) && (ge(m.vix, 14) || band(m.sma200Pct, .12, .17)))
    || (ge(m.vix, 13) && ge(m.roc20, .08))
    || (m.slowSubregime === 'SR02' && band(m.adx14, 30, 35) && ge(m.roc5, 0))
    || (m.slowSubregime === 'SR02' && lt(m.vix, 13)
      && ((ge(m.adx14, 40) && ge(m.sma200Pct, .15) && lt(m.vixChange5d, 0))
        || (ge(m.adx14, 35) && ge(m.sma200Pct, .15) && lt(m.er20, .5) && ge(m.roc5, .01))
        || (ge(m.adx14, 35) && ge(m.sma200Pct, .15) && lt(m.er20, .4) && lt(m.roc5, 0))
        || (ge(m.adx14, 45) && lt(m.rv20, .2))));
}

/** Effective R8.E3 veto: only the low-RV pool is filtered; do not fabricate missing RV. */
export function r9E226LowRvBlocked(m: Readonly<R9E226Market>) {
  // Native E226 includes unavailable RV in the veto pool; absence is not a release.
  if (finite(m.rv20) && m.rv20 >= .4) return false;
  const reopen = lt(m.er20, .2) || lt(m.roc5, 0) || m.regime === 'SIDEWAYS'
    || lt(m.vix, 12) || ge(m.vix, 16)
    || (['BULL', 'RISK_ON_EXTENDED'].includes(m.regime)
      && ((lt(m.adx14, 22) && ge(m.priceExtensionAtr, 1)) || (ge(m.trendScore, 80) && ge(m.rv20, .25))))
    || (lt(m.adx14, 30) && ge(m.roc5, .02))
    || (ge(m.ma50SlopePct, .03) && (ge(m.range20dPct, .05) || lt(m.adx14, 30)))
    || (lt(m.adx14, 20) && ge(m.roc20, 0) && lt(m.er20, .4))
    || (lt(m.er20, .7) && ge(m.range20dPct, .08))
    || (lt(m.priceExtensionAtr, 2) && ge(m.regimeVixChange5d, .02))
    || (ge(m.er20, .4) && ge(m.roc5, .02));
  return !reopen;
}

/** E49/E47 quality union, retaining native raw-term and regime-extension coordinates. */
export function r9E226DualMainQuality(m: Readonly<R9E226Market>) {
  const safeAdx22 = ge(m.adx14, 22) && !(m.regime === 'BULL' && m.slowSubregime === 'SR01')
    && !(m.regime === 'RISK_ON_WEAKENING' && m.slowSubregime === 'SR02')
    && !(m.regime === 'RISK_ON_EXTENDED' && m.slowSubregime === 'SR01');
  const term = m.primaryTermSlope ?? (finite(m.vix3m) && finite(m.vix) ? m.vix3m - m.vix : undefined);
  return ge(m.adx14, 26) || lt(m.rv20, .3) || safeAdx22
    || (ge(m.vix, 20) && ge(m.sma200Pct, .05)) || (lt(m.rv20, .5) && ge(m.roc5, .02))
    || (ge(m.vix, 16) && lt(m.rv20, .4)) || lt(m.adx14, 12)
    || band(m.regimeVixChange5d, .02, .05)
    || (lt(m.adx14, 15) && ge(m.range20dPct, .05)) || (lt(m.rv20, .5) && ge(m.trendScore, 70))
    || (band(m.trendScore, 50, 70) && band(m.regimePriceExtensionAtr, 0, 1.5))
    || (lt(term, 1) && lt(m.roc20, 0)) || (band(term, 0, 2) && band(m.trendScore, 50, 70))
    || (['RISK_ON_WEAKENING', 'RISK_ON_EXTENDED'].includes(m.regime)
      && (band(m.adx14, 15, 22) || band(m.range20dPct, .05, .08)))
    || (lt(m.rv20, .5) && ge(m.weakeningCount, 2) && ge(m.rsi14, 50));
}

export function r9E226PairSearch(m: Readonly<R9E226Market>): 'nearest_valid_credit_floor_v1' | undefined {
  // Native absent trend defaults to -Infinity in this particular arm, not zero.
  const weakBlocked = m.regime === 'RISK_ON_WEAKENING' && ge(m.weakeningCount, 3)
    && lt(m.vix, 21) && !(ge(m.adx14, 24) || (m.trendScore ?? Number.NEGATIVE_INFINITY) <= 35);
  const bullBlocked = m.regime === 'BULL' && m.slowSubregime === 'SR02'
    && (m.adx14 ?? Number.NEGATIVE_INFINITY) < 10 && !ge(m.er20, .08);
  return weakBlocked || bullBlocked ? undefined : 'nearest_valid_credit_floor_v1';
}

export function r9E226RetryAllowed(m: Readonly<R9E226Market>) {
  return ge(m.roc20, 0) || (m.slowSubregime === 'SR02' && ge(m.roc5, 0)) || ge(m.vix, 22)
    || (m.slowSubregime === 'SR01' && ge(m.vix, 20)) || (m.slowSubregime === 'SR02' && lt(m.vix, 19))
    || m.slowSubregime === 'CURRENT' || (m.slowSubregime === 'SR02' && lt(m.roc20, -.05))
    || (m.slowSubregime === 'SR02' && ge(m.adx14, 15));
}

/** Contract construction only: callers must independently pass complete upstream admission. */
export function buildR9E226CurrentBarContract(input: {
  chain: Parameters<typeof buildPutCreditSpreadOpen>[0]['chain']; asOf: string; nav: number;
  market: Readonly<R9E226Market>;
}) {
  if (!finite(input.nav) || input.nav <= 0) throw new Error('R9 requires actual as-of NAV');
  const m = input.market, p = R9_E226_PARAMS;
  const extremePressure = m.regime === 'RISK_ON_EXTENDED' && lt(m.vix, 14)
    && ((finite(m.adx14) && m.adx14 > 30) || ge(m.priceExtensionAtr, 1.5) || ge(m.sma200Pct, .15));
  // Effective research mode is implemented by the shared resolver but predates its narrow public enum.
  const delta = resolvePcsRescueShortDelta({ ...m, extremePressure,
    mode: p.deltaMode as Parameters<typeof resolvePcsRescueShortDelta>[0]['mode'],
    vixTermStructureSlope: m.primaryTermSlope ?? (finite(m.vix) && finite(m.vix3m) ? m.vix3m - m.vix : undefined),
    priceVsSma200Pct: m.sma200Pct, calmDelta: p.calmDelta, normalDelta: p.normalDelta,
    pressureDelta: p.pressureDelta, extremeDelta: p.extremeDelta,
    extremeBaseDelta: p.extremeBaseDelta, extremeFallbackDelta: p.extremeFallbackDelta });
  const width = resolvePcsRescueExtremeWidth({ ...m, extremePressure, profile: 'adx_split_v1',
    extremeWidthPct: p.extremeWidthPct, narrowWidthPct: p.extremeNarrowWidthPct })
    ?? (m.regime === 'BULL' ? p.widthPct : p.nonBullWidthPct);
  const base = { chain: input.chain, underlying: 'QQQ', date: input.asOf, targetDte: p.targetDte,
    nav: input.nav, riskBudget: p.riskBudgetNav };
  const preparation = createPutCreditSpreadPreparation(base);
  const attempts: { stage: string; delta: number; width: number; accepted: boolean; warning: string | null }[] = [];
  const primary = attemptPutCreditSpreadOpen({ ...base, shortDelta: delta, widthPct: width,
    pairSearchMode: r9E226PairSearch(m), forceMinimumContract: false }, preparation);
  let built=primary.result;
  attempts.push({ stage: 'primary', delta, width, accepted: Boolean(built.open), warning: built.warning ?? null });
  if (built.open || !r9E226RetryAllowed(m)
    || !(primary.failure==='put-geometry-invalid'||primary.failure==='economics-invalid'
      ||primary.failure==='protection-unavailable')) return { selected: built.open, warning: built.warning ?? null, attempts };
  const tertiaryBlocked = (m.regime === 'BULL' && m.slowSubregime === 'SR02')
    || (m.regime === 'SIDEWAYS' && m.slowSubregime === 'SR01');
  for (const [index, uplift] of p.retryDeltaUplifts.entries()) {
    if (index >= 2 && tertiaryBlocked) continue;
    const retryDelta = Math.min(.25, delta + uplift), retryWidth = Math.min(width, p.retryWidthPct);
    const candidate = buildPutCreditSpreadOpen({ ...base, shortDelta: retryDelta, widthPct: retryWidth, forceMinimumContract: true }, preparation);
    const accepted = Boolean(candidate.open && (candidate.open.riskBudgetUsed ?? Number.POSITIVE_INFINITY) <= p.retryRiskCap);
    attempts.push({ stage: `retry-${index + 1}`, delta: retryDelta, width: retryWidth, accepted, warning: candidate.warning ?? null });
    if (accepted) { built = candidate; break; }
  }
  return { selected: built.open, warning: built.warning ?? null, attempts };
}
