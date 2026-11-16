import type { CSBreachState } from '../../types/input';

export type Wr89EntryContext = {
  regime?: string;
  slowSubregime?: string;
  credit?: number;
  vix?: number;
  realisedVol20d?: number;
  termSlope?: number;
};

export type TransitionConditionalGate = {
  creditMax?: number;
  rvMin?: number;
  rvMax?: number;
  termSlopeMax?: number;
  termSlopeReleaseRegime?: string;
};

export type Wr89CooldownRescueMode = 'off' | 'sr02' | 'sr02_risk_on' | 'sr02_risk_on_range_low_rv' | 'sr02_risk_on_range_credit_extreme' | 'sr02_risk_on_range_credit_extremes' | 'sr02_risk_on_range_low_credit' | 'sr02_risk_on_range_high_credit' | 'sr02_compact' | 'sr01_quality_compact' | 'c1_sr01_quality' | 'c1_hardgate_quality';


export function isWr89RiskContext(context: Wr89EntryContext) {
  return (context.credit ?? Number.POSITIVE_INFINITY) < 40
    || ((context.vix ?? Number.POSITIVE_INFINITY) >= 17 && (context.vix ?? Number.POSITIVE_INFINITY) < 20)
    || ((context.realisedVol20d ?? Number.POSITIVE_INFINITY) >= .45 && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .60);
}

export function isWr89HardGate(context: Wr89EntryContext) {
  return context.regime === 'RISK_ON_EXTENDED' && (context.credit ?? Number.POSITIVE_INFINITY) < 40;
}

export function isWr89BaseRescue(context: Wr89EntryContext) {
  return (context.realisedVol20d ?? Number.NEGATIVE_INFINITY) >= .57 && (context.termSlope ?? Number.NEGATIVE_INFINITY) >= 1.5
    || context.slowSubregime === 'SR01' && context.regime === 'RISK_ON_EXTENDED'
    || context.slowSubregime === 'SR02' && context.regime === 'BULL';
}

export function isWr89ContextualRescue(context: Wr89EntryContext) {
  return context.slowSubregime === 'CURRENT'
    || context.regime === 'RISK_ON_WEAKENING'
      && (context.credit ?? Number.POSITIVE_INFINITY) < 40
      && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) >= .45
      && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .60;
}

function isWr89CooldownRescue(context: Wr89EntryContext, mode: Wr89CooldownRescueMode = 'off') {
  if (mode === 'c1_hardgate_quality') mode = 'c1_sr01_quality';
  const sr01Quality = context.slowSubregime === 'SR01'
    && ((context.vix ?? Number.POSITIVE_INFINITY) < 18
      || (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .33);
  if (mode === 'sr01_quality_compact') return sr01Quality;
  if (mode === 'c1_sr01_quality' && sr01Quality) return true;
  if (mode === 'c1_sr01_quality') mode = 'sr02_compact';
  if (context.slowSubregime !== 'SR02') return false;
  if (mode === 'sr02') return true;
  if (mode === 'sr02_compact') {
    const riskOnRegime = context.regime?.startsWith('RISK_ON_') === true;
    const rangeQuality = context.regime === 'RANGE_BOUND'
      && ((context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .33
        || (context.credit ?? Number.POSITIVE_INFINITY) < 30
        || (context.credit ?? Number.NEGATIVE_INFINITY) > 100);
    return riskOnRegime || rangeQuality;
  }
  if (mode === 'sr02_risk_on') return context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING';
  if (mode === 'sr02_risk_on_range_low_rv') {
    return context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING'
      || context.regime === 'RANGE_BOUND' && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .33;
  }
  if (mode === 'sr02_risk_on_range_credit_extreme') {
    return context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING'
      || context.regime === 'RANGE_BOUND'
        && ((context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .33
          || (context.credit ?? Number.POSITIVE_INFINITY) < 30
          || (context.credit ?? Number.NEGATIVE_INFINITY) > 100);
  }
  if (mode === 'sr02_risk_on_range_credit_extremes') {
    return context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING'
      || context.regime === 'RANGE_BOUND'
        && ((context.credit ?? Number.POSITIVE_INFINITY) < 30 || (context.credit ?? Number.NEGATIVE_INFINITY) > 100);
  }
  if (mode === 'sr02_risk_on_range_low_credit') {
    return context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING'
      || context.regime === 'RANGE_BOUND' && (context.credit ?? Number.POSITIVE_INFINITY) < 30;
  }
  return mode === 'sr02_risk_on_range_high_credit'
    && (context.regime === 'RISK_ON_EXTENDED' || context.regime === 'RISK_ON_WEAKENING'
      || context.regime === 'RANGE_BOUND' && (context.credit ?? Number.NEGATIVE_INFINITY) > 100);
}

function isWr89HardGateQualityRescue(context: Wr89EntryContext, mode: Wr89CooldownRescueMode) {
  return mode === 'c1_hardgate_quality'
    && context.slowSubregime === 'SR02'
    && context.regime === 'RISK_ON_EXTENDED'
    && (context.credit ?? Number.POSITIVE_INFINITY) < 30
    && (context.vix ?? Number.POSITIVE_INFINITY) < 15
    && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < .45
    && (context.termSlope ?? Number.NEGATIVE_INFINITY) > 2.5;
}

/** WR-90 entry gate: block the low-credit/mid-RV intersection except weakening regime. */
export function isWr90ConditionalBlock(context: Wr89EntryContext, gate: TransitionConditionalGate = {}) {
  const creditMax = gate.creditMax ?? 40;
  const rvMin = gate.rvMin ?? .45;
  const rvMax = gate.rvMax ?? .60;
  const baseBlock = (context.credit ?? Number.POSITIVE_INFINITY) < creditMax
    && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) >= rvMin
    && (context.realisedVol20d ?? Number.POSITIVE_INFINITY) < rvMax
    && context.regime !== 'RISK_ON_WEAKENING';
  const slopeReleases = gate.termSlopeMax !== undefined
    && (context.termSlope ?? Number.POSITIVE_INFINITY) >= gate.termSlopeMax
    && (gate.termSlopeReleaseRegime === undefined || context.regime === gate.termSlopeReleaseRegime);
  return baseBlock && !slopeReleases;
}

export function applyWr89LossState(state: CSBreachState | undefined, pnl: number, cooldownOpportunities: number) {
  const current = state?.wr89CooldownRemaining ?? 0;
  return {
    ...(state ?? {}),
    wr89CooldownRemaining: pnl <= 0 ? Math.max(0, Math.floor(cooldownOpportunities)) : current,
  } as CSBreachState;
}

export function evaluateWr89Entry(state: CSBreachState | undefined, context: Wr89EntryContext, enabled: boolean, cooldownRescueMode: Wr89CooldownRescueMode = 'off') {
  if (!enabled) {
    return { allowed: true, state, reason: undefined as string | undefined };
  }

  const remaining = state?.wr89CooldownRemaining ?? 0;
  const hardGateRescued = isWr89HardGate(context) && (remaining === 2 || isWr89HardGateQualityRescue(context, cooldownRescueMode));
  if (isWr89HardGate(context) && !hardGateRescued) {
    return { allowed: false, state, reason: 'wr89_hard_gate' };
  }
  if (state?.wr89CooldownRemaining === undefined || state.wr89CooldownRemaining <= 0) {
    return { allowed: true, state, reason: undefined as string | undefined };
  }

  const nextState = { ...state, wr89CooldownRemaining: Math.max(0, remaining - 1) } as CSBreachState;

  if (!hardGateRescued && isWr89RiskContext(context) && !isWr89BaseRescue(context) && !isWr89ContextualRescue(context) && !isWr89CooldownRescue(context, cooldownRescueMode)) {
    return { allowed: false, state: nextState, reason: 'wr89_cooldown_risk' };
  }
  return { allowed: true, state: nextState, reason: undefined as string | undefined };
}
