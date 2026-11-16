import type { PipelineContext, EngineResult, RiskBudgetData, TrendParticipationData } from '../types/pipeline';
import { DEFAULT_STRATEGY_PARAMS, resolveTrendParticipationQuality } from '../types/params';
import { calcEfficiencyRatio } from '../utils';

const STRONG_PARTICIPATION_REGIMES = new Set(['BULL', 'RISK_ON_EXTENDED']);
const RECOVERY_PARTICIPATION_REGIMES = new Set(['SIDEWAYS', 'RANGE_BOUND', 'RISK_ON_WEAKENING']);

function evaluateTrendBudgetRefill(ctx: PipelineContext, config: NonNullable<PipelineContext['input']['strategyParams']>['trendParticipationRelease']): {
  eligible: boolean;
  active: boolean;
  configuredPct?: number;
  preConfirmActive: boolean;
  preConfirmConfiguredPct?: number;
  nextState: { eligibleStreak: number; active: boolean };
} {
  const refill = config?.trendBudgetRefill;
  const disabled = { eligible: false, active: false, preConfirmActive: false, nextState: { eligibleStreak: 0, active: false } };
  if (refill == null || !Number.isFinite(refill.maxPct) || refill.maxPct <= 0) return disabled;

  const state = ctx.input.trendBudgetRefillState ?? { eligibleStreak: 0, active: false };
  const regime = ctx.results.regime?.data;
  const trend = ctx.results.trend?.data;
  const vol = ctx.results.volTarget?.data;
  const quality = resolveTrendParticipationQuality(config, 'strong');
  const vixRise5dMax = refill.vixRise5dMax ?? 0;
  const qqqBars = ctx.input.prices?.QQQ ?? [];
  const qqqOneDayReturn = qqqBars.length >= 2
    ? qqqBars.at(-1)!.close / qqqBars.at(-2)!.close - 1
    : undefined;
  const allowBullNegativeRoc5VixFall = refill.allowBullNegativeRoc5VixFall === true
    && regime?.regime === 'BULL'
    && (regime.roc5 ?? Infinity) < 0
    && (regime.vix_change_5d ?? Infinity) <= 0;
  const score = [
    (regime?.roc5 ?? -Infinity) >= 0,
    (trend?.roc20 ?? -Infinity) >= (quality?.roc20Min ?? .02),
    (regime?.sma20_slope_pct ?? -Infinity) >= 0,
    (vol?.qqq_er20 ?? -Infinity) >= (quality?.er20Min ?? .20),
  ].filter(Boolean).length;
  const strongRegime = ['BULL', 'RISK_ON_EXTENDED'].includes(regime?.regime ?? '');
  const roc5QualityOk = (regime?.roc5 ?? -Infinity) >= (quality?.roc5Min ?? -Infinity)
    || allowBullNegativeRoc5VixFall;
  const qualityClean = roc5QualityOk
    && (quality?.roc5Max == null || (regime?.roc5 ?? Infinity) <= quality.roc5Max)
    && (trend?.roc20 ?? -Infinity) >= (quality?.roc20Min ?? .02)
    && (regime?.vix ?? Infinity) <= (quality?.vixMax ?? 24)
    && (regime?.price_extension_atr ?? Infinity) <= (quality?.priceExtensionMax ?? 2.65)
    && (regime?.drawdown_from_recent_high_pct ?? Infinity) <= (quality?.drawdownMaxPct ?? .05);
  const qqqNotWeak = (regime?.distanceToSma20Pct ?? -Infinity) >= 0
    && (regime?.price_vs_sma200_pct ?? -Infinity) >= 0
    && ((regime?.roc5 ?? -Infinity) >= 0 || allowBullNegativeRoc5VixFall);
  const hardRiskClear = ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0;
  const crisisFree = regime?.crisisPhase !== 'CONFIRMED' && ctx.currentFlashCrashState?.active !== true;
  const eligible = ctx.stockPolicy?.value.id === 'SLOW_BULL_GROWTH'
    && strongRegime
    && score >= Math.max(1, Math.floor(quality?.minScore ?? 3))
    && qualityClean
    && qqqNotWeak
    // TQ2.E0's default guard remains VIX non-rising; research children may use a bounded ceiling.
    && (regime?.vix_change_5d ?? Infinity) <= vixRise5dMax
    && (refill.qqqOneDayMin == null || (qqqOneDayReturn ?? -Infinity) >= refill.qqqOneDayMin)
    && (refill.realizedVolMax == null || (vol?.tqqq_realized_vol_20d ?? Infinity) <= refill.realizedVolMax)
    && hardRiskClear
    && crisisFree;
  const eligibleStreak = eligible ? state.eligibleStreak + 1 : 0;
  const confirmBars = Math.max(1, Math.floor(refill.confirmBars ?? 2));
  const active = eligible && eligibleStreak >= confirmBars;
  const hardCapPct = Number.isFinite(refill.hardCapPct) ? Math.max(0, refill.hardCapPct!) : .05;
  const configuredPct = Math.min(hardCapPct, Math.max(0, refill.maxPct));
  const preConfirmFraction = Math.min(1, Math.max(0, refill.preConfirmFraction ?? 0));
  const preConfirmActive = eligible && !active && eligibleStreak > 0 && preConfirmFraction > 0;
  return {
    eligible,
    active,
    configuredPct,
    preConfirmActive,
    preConfirmConfiguredPct: preConfirmActive ? configuredPct * preConfirmFraction : 0,
    nextState: { eligibleStreak, active },
  };
}

export function evaluateTrendParticipation(
  ctx: PipelineContext,
  baseTargetPct: number,
  hardMaxPct: number,
): { data: TrendParticipationData; targetPct: number; effectiveHardMaxPct: number } {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const config = ctx.input.strategyParams?.trendParticipationRelease;
  const state = ctx.input.trendParticipationState ?? { eligibleStreak: 0, active: false };
  const disabled = (reason: string): { data: TrendParticipationData; targetPct: number; effectiveHardMaxPct: number } => ({
    data: {
      enabled: false,
      eligible: false,
      confirmed: false,
      active: false,
      score: 0,
      requiredScore: 0,
      eligibleStreak: 0,
      stateCapPct: undefined,
      qualityCapPct: baseTargetPct,
      volTargetPct: ctx.results.volTarget?.data.regime_adjusted_weight,
      trendDiscountPct: baseTargetPct,
      releaseSource: 'none',
      baseTargetPct,
      releasedTargetPct: baseTargetPct,
      bindingReason: 'disabled',
      vetoReason: reason,
      nextState: { eligibleStreak: 0, active: false },
    },
    targetPct: baseTargetPct,
    effectiveHardMaxPct: hardMaxPct,
  });
  if (!config || config.enabled === false) return disabled('config_off');

  const regime = ctx.results.regime?.data;
  const trend = ctx.results.trend?.data;
  const vol = ctx.results.volTarget?.data;
  const currentRegime = regime?.regime;
  const mode = config.mode ?? 'unified';
  const budgetRefill = evaluateTrendBudgetRefill(ctx, config);
  const explicitWeakeningStrongScope = currentRegime === 'RISK_ON_WEAKENING' && config.strongRegimes?.includes('RISK_ON_WEAKENING') === true;
  const strongState = mode !== 'recovery'
    && currentRegime != null
    && (STRONG_PARTICIPATION_REGIMES.has(currentRegime) || explicitWeakeningStrongScope)
    && (currentRegime !== 'RISK_ON_EXTENDED' || config.strongExtendedRequiresActive !== true || state.active === true)
    && (config.strongRegimes == null || config.strongRegimes.includes(currentRegime as 'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING'));
  const recoveryHighExposureBlockMinActual = p.researchRiskOnWeakeningRecoveryHighExposureBlockMinActual;
  const recoveryHighExposureBlockVixRise5dMin = p.researchRiskOnWeakeningRecoveryHighExposureBlockVixRise5dMin ?? -Infinity;
  const recoveryHighExposurePosition = (ctx.input.account?.positions ?? []).find((position) => position.symbol === ctx.input.leveragedSymbol);
  const recoveryHighExposureActual = (ctx.input.account?.netLiquidation ?? 0) > 0 && recoveryHighExposurePosition != null
    ? Math.max(0, recoveryHighExposurePosition.marketValue / ctx.input.account.netLiquidation)
    : 0;
  const recoveryHighExposureBlocked = currentRegime === 'RISK_ON_WEAKENING'
    && recoveryHighExposureBlockMinActual != null
    && recoveryHighExposureActual >= recoveryHighExposureBlockMinActual
    && (regime?.vix_change_5d ?? -Infinity) >= recoveryHighExposureBlockVixRise5dMin;
  const recoveryState = mode !== 'strong' && currentRegime != null && RECOVERY_PARTICIPATION_REGIMES.has(currentRegime)
    && !(config.recoveryExcludeWeakening === true && currentRegime === 'RISK_ON_WEAKENING')
    && !recoveryHighExposureBlocked
    && (config.recoveryRegimes == null || config.recoveryRegimes.includes(currentRegime as 'SIDEWAYS' | 'RANGE_BOUND' | 'RISK_ON_WEAKENING'));
  const qualityOverride = strongState
    ? resolveTrendParticipationQuality(config, 'strong')
    : recoveryState ? resolveTrendParticipationQuality(config, 'recovery') : undefined;
  const requiredScore = strongState
    ? Math.max(1, Math.floor(qualityOverride?.minScore ?? 3))
    : recoveryState ? Math.max(1, Math.floor(qualityOverride?.minScore ?? config.recoveryMinScore ?? 4)) : 99;
  const score = [
    (regime?.roc5 ?? -Infinity) >= 0,
    (trend?.roc20 ?? -Infinity) >= 0.02,
    (regime?.sma20_slope_pct ?? -Infinity) >= 0,
    (vol?.qqq_er20 ?? -Infinity) >= 0.20,
  ].filter(Boolean).length;
  const stockPolicyId = ctx.stockPolicy?.value.id;
  const growth = stockPolicyId === 'SLOW_BULL_GROWTH'
    || (config.stockPolicyIn?.includes(stockPolicyId as 'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_RECOVERY') ?? false);
  const aboveSma20 = (regime?.distanceToSma20Pct ?? -Infinity) >= 0;
  const vixOk = regime?.vix != null && regime.vix <= 24;
  const vixRiseOk = (regime?.vix_change_5d ?? Infinity) <= 0.02;
  const realizedVolOk = (vol?.tqqq_realized_vol_20d ?? Infinity) <= 1;
  const qualityOverrideClean = qualityOverride == null || (
    (regime?.roc5 ?? -Infinity) >= (qualityOverride.roc5Min ?? -Infinity)
    && (qualityOverride.roc5Max == null || (regime?.roc5 ?? Infinity) <= qualityOverride.roc5Max)
    && (trend?.roc20 ?? -Infinity) >= (qualityOverride.roc20Min ?? .02)
    && (qualityOverride.adxMin == null || (regime?.adx14 ?? -Infinity) >= qualityOverride.adxMin)
    && (regime?.vix ?? Infinity) <= (qualityOverride.vixMax ?? 24)
    && (regime?.vix_change_5d ?? Infinity) <= (qualityOverride.vixRise5dMax ?? .02)
    && (vol?.tqqq_realized_vol_20d ?? Infinity) <= (qualityOverride.realizedVolMax ?? 1)
    && (qualityOverride.er20Min == null || (vol?.qqq_er20 ?? -Infinity) >= qualityOverride.er20Min)
    && (qualityOverride.priceExtensionMax == null || (regime?.price_extension_atr ?? Infinity) <= qualityOverride.priceExtensionMax)
    && (qualityOverride.drawdownMaxPct == null || (regime?.drawdown_from_recent_high_pct ?? Infinity) <= qualityOverride.drawdownMaxPct)
    && (qualityOverride.baseTargetMinPct == null || baseTargetPct >= qualityOverride.baseTargetMinPct)
  );
  const crisisFree = regime?.crisisPhase !== 'CONFIRMED' && ctx.currentFlashCrashState?.active !== true;
  const hardRiskClear = ctx.results.hardRisk?.status === 'PASS' && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0;
  const eligible = growth && (strongState || recoveryState) && score >= requiredScore && aboveSma20 && vixOk && vixRiseOk && realizedVolOk && qualityOverrideClean && crisisFree && hardRiskClear;
  const partialConfig = strongState ? config.strongPartialRelease : undefined;
  const partialMinScore = Math.max(1, Math.floor(partialConfig?.minScore ?? Math.max(1, requiredScore - 1)));
  const partialEligible = partialConfig != null && strongState && growth && score >= partialMinScore && score < requiredScore && aboveSma20 && vixOk && vixRiseOk && realizedVolOk && qualityOverrideClean && crisisFree && hardRiskClear;
  const eligibleStreak = eligible ? state.eligibleStreak + 1 : 0;
  const strongEligibleStreak = strongState && eligible ? (state.strongEligibleStreak ?? 0) + 1 : 0;
  const strongPartialEligibleStreak = partialEligible ? (state.strongPartialEligibleStreak ?? 0) + 1 : 0;
  const recoveryEligibleStreak = recoveryState && eligible ? (state.recoveryEligibleStreak ?? 0) + 1 : 0;
  const confirmBars = Math.max(1, Math.floor(config.confirmBars));
  const strongConfirmBars = Math.max(1, Math.floor(config.strongConfirmBars ?? confirmBars));
  const confirmed = eligible && (strongState
    ? (config.strongConfirmBars == null ? eligibleStreak >= confirmBars : strongEligibleStreak >= strongConfirmBars)
    : recoveryEligibleStreak >= confirmBars);
  const partialConfirmBars = Math.max(1, Math.floor(partialConfig?.confirmBars ?? strongConfirmBars));
  const partialConfirmed = partialEligible && strongPartialEligibleStreak >= partialConfirmBars;
  const stickyBars = Math.max(0, Math.floor(config.stickyBars ?? 0));
  const immediateExit = ['BEAR', 'CRISIS'].includes(currentRegime ?? '') || !crisisFree || !hardRiskClear;
  const stickyActive = !confirmed && state.active && stickyBars > 0 && (state.activeBars ?? 0) < stickyBars && !immediateExit;
  const partialActive = partialConfirmed && !confirmed;
  const active = (confirmed && eligible) || partialActive || stickyActive;
  const strongBaseCapacityPct = partialActive
    ? (partialConfig?.capacityPct ?? config.strongCapacityPct)
    : config.strongCapacityPct;
  const strongCapacityOverride = config.strongCapacityOverride;
  const qqqBars = ctx.input.prices?.QQQ ?? [];
  const qqqOneDayReturn = qqqBars.length >= 2
    ? qqqBars.at(-1)!.close / qqqBars.at(-2)!.close - 1
    : undefined;
  const strongCapacityOverrideActive = active
    && strongState
    && !partialActive
    && strongCapacityOverride != null
    && (vol?.qqq_er20 ?? -Infinity) >= (strongCapacityOverride.er20Min ?? Infinity)
    && (strongCapacityOverride.adxMin == null || (regime?.adx14 ?? -Infinity) >= strongCapacityOverride.adxMin)
    && (regime?.roc5 ?? -Infinity) >= (strongCapacityOverride.roc5Min ?? -Infinity)
    && (strongCapacityOverride.priceVsSma200MinPct == null || (regime?.price_vs_sma200_pct ?? -Infinity) >= strongCapacityOverride.priceVsSma200MinPct)
    && (strongCapacityOverride.qqqOneDayMin == null || (qqqOneDayReturn ?? -Infinity) >= strongCapacityOverride.qqqOneDayMin)
    && (regime?.vix ?? Infinity) <= (strongCapacityOverride.vixMax ?? Infinity)
    && baseTargetPct >= (strongCapacityOverride.baseTargetMinPct ?? -Infinity)
    && (regime?.drawdown_from_recent_high_pct ?? Infinity) <= (strongCapacityOverride.drawdownMaxPct ?? Infinity);
  const strongCapacityOverridePct = strongCapacityOverrideActive
    ? (strongCapacityOverride!.slope == null
      ? Math.max(strongBaseCapacityPct, strongCapacityOverride!.capacityPct)
      : Math.min(
        strongCapacityOverride!.capacityPct,
        strongBaseCapacityPct + Math.max(0, strongCapacityOverride!.slope) * Math.max(0, (vol?.qqq_er20 ?? 0) - (strongCapacityOverride!.er20Min ?? 0)),
      ))
    : strongBaseCapacityPct;
  const capacityPct = active
    ? (strongState
      ? strongCapacityOverridePct
      : recoveryState ? config.recoveryCapacityPct : undefined)
    : undefined;
  const activeBars = active ? (state.activeBars ?? 0) + 1 : 0;
  const fraction = Math.min(1, Math.max(0, partialActive ? (partialConfig?.releaseFraction ?? config.releaseFraction) : config.releaseFraction));
  const floorPct = active ? (strongState ? config.strongFloorPct : config.recoveryFloorPct) : undefined;
  const floorTarget = floorPct == null ? baseTargetPct : Math.max(baseTargetPct, Math.min(floorPct, capacityPct ?? baseTargetPct));
  const candidateTarget = active && capacityPct != null
    ? floorTarget + fraction * Math.max(0, capacityPct - floorTarget)
    : baseTargetPct;
  const normalCapClear = hardRiskClear && hardMaxPct >= config.normalHardCapPct - 1e-9;
  const effectiveHardMaxPct = active && normalCapClear ? Math.max(hardMaxPct, capacityPct ?? hardMaxPct) : hardMaxPct;
  const preConditionalTargetPct = Math.max(0, Math.min(candidateTarget, effectiveHardMaxPct));
  const highExtensionCap = config.conditionalHighExtensionCap;
  const highExtensionWeakSignal = highExtensionCap?.triggerMode === 'both'
    ? (regime?.roc5 ?? Infinity) <= (highExtensionCap.roc5Max ?? 0)
      && (regime?.vix_change_5d ?? -Infinity) >= (highExtensionCap.vixRise5dMin ?? .02)
    : highExtensionCap?.triggerMode === 'roc5'
    ? (regime?.roc5 ?? Infinity) <= (highExtensionCap.roc5Max ?? 0)
    : highExtensionCap?.triggerMode === 'vix_rise'
      ? (regime?.vix_change_5d ?? -Infinity) >= (highExtensionCap.vixRise5dMin ?? .02)
      : ((regime?.roc5 ?? Infinity) <= (highExtensionCap?.roc5Max ?? 0)
        || (regime?.vix_change_5d ?? -Infinity) >= (highExtensionCap?.vixRise5dMin ?? .02));
  const highExtensionWeak = highExtensionCap != null
    && (highExtensionCap.requireActive !== true || active)
    && (highExtensionCap.regimeIn == null
      ? ['BULL', 'RISK_ON_EXTENDED'].includes(currentRegime ?? '')
      : highExtensionCap.regimeIn.includes(currentRegime as 'BULL' | 'RISK_ON_EXTENDED'))
    && (regime?.price_vs_sma200_pct ?? -Infinity) >= (highExtensionCap.priceVsSma200MinPct ?? .12)
    && (regime?.price_extension_atr ?? -Infinity) >= (highExtensionCap.priceExtensionAtrMin ?? 2.5)
    && highExtensionWeakSignal;
  const conditionalCapApplied = highExtensionWeak ? Math.max(0, Math.min(preConditionalTargetPct, highExtensionCap.capPct)) : undefined;
  const targetPct = conditionalCapApplied ?? preConditionalTargetPct;
  const vetoReason = !growth ? 'stock_policy' : !strongState && !recoveryState ? `regime_${currentRegime ?? 'unknown'}` :
    score < requiredScore ? 'quality_score' : !aboveSma20 ? 'below_sma20' : !vixOk ? 'vix' :
    !vixRiseOk ? 'vix_rising' : !realizedVolOk ? 'realized_vol' : !qualityOverrideClean ? 'quality_override_clean' : !crisisFree ? 'crisis_or_flash' :
        !hardRiskClear ? 'hard_risk' : undefined;
  const bindingReason = conditionalCapApplied != null && conditionalCapApplied < preConditionalTargetPct - 1e-9
    ? 'conditional_cap'
    : targetPct > baseTargetPct + 1e-9 ? 'trend_participation' : active ? 'capacity_not_binding' : 'not_active';
  return {
    data: {
      enabled: true,
      eligible,
      qualityOverrideClean,
      partialEligible,
      partialConfirmed,
      partialActive,
      confirmed,
      active,
      score,
      requiredScore,
      eligibleStreak,
    capacityPct,
    stateCapPct: active ? capacityPct : undefined,
    qualityCapPct: eligible ? (capacityPct ?? baseTargetPct) : baseTargetPct,
    volTargetPct: ctx.results.volTarget?.data.regime_adjusted_weight,
    trendDiscountPct: baseTargetPct,
      releaseSource: active ? (partialActive ? 'partial_strong' : strongState ? 'strong' : 'recovery') : 'none',
      baseTargetPct,
      releasedTargetPct: targetPct,
      conditionalCapApplied,
      budgetRefillEligible: budgetRefill.eligible,
      budgetRefillActive: budgetRefill.active,
      budgetRefillConfiguredPct: budgetRefill.configuredPct,
      budgetRefillPreConfirmActive: budgetRefill.preConfirmActive,
      budgetRefillPreConfirmConfiguredPct: budgetRefill.preConfirmConfiguredPct,
      budgetRefillPhase: budgetRefill.preConfirmActive ? 'pre_confirm' : budgetRefill.active ? 'confirmed' : undefined,
      budgetRefillNextState: budgetRefill.nextState,
      releaseFraction: fraction,
      bindingReason,
      vetoReason,
      nextState: { eligibleStreak, active, activeBars, strongEligibleStreak, strongPartialEligibleStreak, recoveryEligibleStreak },
    },
    targetPct,
    effectiveHardMaxPct,
  };
}

export function smoothTargetWeight(input: {
  targetPct: number;
  previousSmoothedPct?: number;
  halfLifeBars?: number;
}): { smoothedPct: number; applied: boolean } {
  const previous = input.previousSmoothedPct;
  if (previous == null || !Number.isFinite(previous)) {
    return { smoothedPct: input.targetPct, applied: false };
  }
  if (input.targetPct <= previous) {
    return { smoothedPct: input.targetPct, applied: false };
  }

  const halfLife = input.halfLifeBars ?? 3;
  if (halfLife <= 0) return { smoothedPct: input.targetPct, applied: false };
  const alpha = 1 - Math.pow(0.5, 1 / halfLife);
  return {
    smoothedPct: previous + (input.targetPct - previous) * alpha,
    applied: true,
  };
}

export function smoothDownTargetWeight(input: {
  targetPct: number;
  previousSmoothedPct?: number;
  halfLifeBars?: number;
}): { smoothedPct: number; applied: boolean } {
  const previous = input.previousSmoothedPct;
  if (previous == null || !Number.isFinite(previous)) {
    return { smoothedPct: input.targetPct, applied: false };
  }
  if (input.targetPct >= previous) {
    return { smoothedPct: input.targetPct, applied: false };
  }

  const halfLife = input.halfLifeBars ?? 3;
  if (halfLife <= 0) return { smoothedPct: input.targetPct, applied: false };
  const alpha = 1 - Math.pow(0.5, 1 / halfLife);
  return {
    smoothedPct: previous + (input.targetPct - previous) * alpha,
    applied: true,
  };
}

export function runRiskBudget(ctx: PipelineContext): EngineResult<RiskBudgetData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const policy = ctx.stockPolicy?.value.overrides;

  const warnings: string[] = [];
  const blockers: string[] = [];

  const hardMax = ctx.results.hardRisk?.data.max_tqqq_allowed_pct ?? 0.50;
  const volTargetWeight = ctx.results.volTarget?.data.regime_adjusted_weight ?? 0;
  const tqqqPosition = (ctx.input.account?.positions ?? []).find((position) => position.symbol === ctx.input.leveragedSymbol);
  const currentTqqqPct = (ctx.input.account?.netLiquidation ?? 0) > 0 && tqqqPosition != null
    ? Math.max(0, tqqqPosition.marketValue / ctx.input.account.netLiquidation)
    : 0;
  const navDrawdownPeak = ctx.input.navDrawdownPeak;
  const nav = ctx.input.account?.netLiquidation ?? 0;
  const navDrawdownPct = navDrawdownPeak != null && navDrawdownPeak > 0 && nav > 0
    ? Math.max(0, (navDrawdownPeak - nav) / navDrawdownPeak)
    : Infinity;
  const trend = ctx.results.trend?.data.signal;
  const crisisPhase = ctx.results.regime?.data.crisisPhase;
  const crisisRecoveryRelease = p.trendParticipationRelease?.crisisRecoveryRelease;
  const qqqBars = ctx.input.prices?.QQQ ?? [];
  const qqqOneDayReturn = qqqBars.length >= 2
    ? qqqBars.at(-1)!.close / qqqBars.at(-2)!.close - 1
    : undefined;
  const tqqqBars = ctx.input.prices?.TQQQ ?? [];
  const tqqqOneDayReturn = tqqqBars.length >= 2
    ? tqqqBars.at(-1)!.close / tqqqBars.at(-2)!.close - 1
    : undefined;
  const crisisRecoveryReleaseEligible = crisisRecoveryRelease != null
    && crisisPhase === 'RECOVERY'
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= (crisisRecoveryRelease.roc5Min ?? 0)
    && (ctx.results.trend?.data.roc20 ?? -Infinity) >= (crisisRecoveryRelease.roc20Min ?? 0)
    && (crisisRecoveryRelease.qqqOneDayMin == null || (qqqOneDayReturn ?? -Infinity) >= crisisRecoveryRelease.qqqOneDayMin)
    && (ctx.results.regime?.data.vix ?? Infinity) <= (crisisRecoveryRelease.vixMax ?? 35)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (crisisRecoveryRelease.vixRise5dMax ?? 0);
  const trendDiscountRecovery = p.trendParticipationRelease?.trendDiscountRecovery;
  const currentRegime = ctx.results.regime?.data.regime;
  const trendDiscountRecoveryPolicyIn = p.trendParticipationRelease?.stockPolicyIn;
  const scopedTrendDiscountRecoveryPolicyIn = p.researchTrendDiscountRecoveryStockPolicyIn;
  const recoveryScore = [
    (ctx.results.regime?.data.roc5 ?? -Infinity) >= (trendDiscountRecovery?.roc5Min ?? 0),
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= (trendDiscountRecovery?.roc20Min ?? 0.02),
    (ctx.results.regime?.data.sma20_slope_pct ?? -Infinity) >= (trendDiscountRecovery?.sma20SlopeMin ?? 0),
    (ctx.results.volTarget?.data.qqq_er20 ?? -Infinity) >= (trendDiscountRecovery?.er20Min ?? 0.20),
  ].filter(Boolean).length;
  const trendDiscountRecoveryPolicyAllowed = scopedTrendDiscountRecoveryPolicyIn != null
    ? scopedTrendDiscountRecoveryPolicyIn.includes(ctx.stockPolicy?.value.id as 'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_DEFENSE' | 'SLOW_BEAR_RECOVERY')
    : p.researchTrendDiscountRecoveryUseStockPolicyIn !== true || trendDiscountRecoveryPolicyIn == null
      ? ctx.stockPolicy?.value.id === 'SLOW_BULL_GROWTH'
      : trendDiscountRecoveryPolicyIn.includes(ctx.stockPolicy?.value.id as 'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_RECOVERY');
  const canRecoverBearTrend = trendDiscountRecovery != null
    && p.trendParticipationRelease?.enabled === true
    && trendDiscountRecoveryPolicyAllowed
    && (trendDiscountRecovery.regimeIn ?? ['BULL', 'RISK_ON_EXTENDED']).includes(currentRegime as 'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING')
    && recoveryScore >= Math.max(1, Math.floor(trendDiscountRecovery.minScore ?? 4))
    && (ctx.results.regime?.data.vix ?? Infinity) <= (trendDiscountRecovery.vixMax ?? 24)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (trendDiscountRecovery.vixRise5dMax ?? 0.02)
    && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= (trendDiscountRecovery.realizedVolMax ?? 1)
    && (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= (trendDiscountRecovery.priceVsSma200Min ?? 0)
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= (trendDiscountRecovery.drawdownMax ?? 0.05)
    && (ctx.results.regime?.data.price_extension_atr ?? Infinity) <= (trendDiscountRecovery.priceExtensionMax ?? 2.5)
    && (trendDiscountRecovery.navDrawdownMax == null || (navDrawdownPct <= trendDiscountRecovery.navDrawdownMax))
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true
    && hardMax >= 0.90 - 1e-9;

  let binding_constraint: RiskBudgetData['binding_constraint'] = 'none';
  let final_tqqq_pct: number;

  if (volTargetWeight <= hardMax) {
    final_tqqq_pct = volTargetWeight;
    binding_constraint = 'vol_target';
  } else {
    final_tqqq_pct = hardMax;
    binding_constraint = 'hard_risk';
    warnings.push(`VolTarget 建议 ${(volTargetWeight * 100).toFixed(1)}%，受 HardRisk 约束降至 ${(hardMax * 100).toFixed(1)}%`);
  }

  if (crisisRecoveryReleaseEligible) {
    const recoveryTarget = Math.min(hardMax, Math.max(0, crisisRecoveryRelease!.maxPct));
    if (recoveryTarget > final_tqqq_pct + 1e-9) {
      final_tqqq_pct = recoveryTarget;
      binding_constraint = 'trend_participation';
      warnings.push(`CRISIS_RECOVERY 当前-bar 反弹释放至 ${(recoveryTarget * 100).toFixed(1)}%`);
    }
  }

  if (trend === 'STRONG_BEAR') {
    const regime = ctx.results.regime?.data.regime;
    const baseStrongBearTrendFactor = regime === 'BEAR' || regime === 'CRISIS'
      ? (p.strongBearTrendFactor ?? 0.5)
      : (p.strongBearTrendFactorChop ?? p.strongBearTrendFactor ?? 0.5);
    const strongBearTrendFactor = baseStrongBearTrendFactor * (policy?.strongBearTrendMultiplier ?? 1);
    const discounted = final_tqqq_pct * strongBearTrendFactor;
    if (discounted < final_tqqq_pct && binding_constraint !== 'hard_risk') {
      binding_constraint = 'trend_discount';
    }
    final_tqqq_pct = discounted;
    const discount = strongBearTrendFactor === 0.5 ? '减半' : `按 ${(strongBearTrendFactor * 100).toFixed(1)}% 折扣`;
    warnings.push(`趋势 STRONG_BEAR，TQQQ 分配${discount}至 ${(final_tqqq_pct * 100).toFixed(1)}%`);
  } else if (trend === 'BEAR') {
    const baseBearTrendFactor = (p.bearTrendFactor ?? 0.75) * (policy?.bearTrendMultiplier ?? 1);
    const bearTrendFactor = canRecoverBearTrend
      ? Math.max(baseBearTrendFactor, Math.min(1, trendDiscountRecovery!.factor))
      : baseBearTrendFactor;
    const discounted = final_tqqq_pct * bearTrendFactor;
    if (discounted < final_tqqq_pct && binding_constraint !== 'hard_risk') {
      binding_constraint = 'trend_discount';
    }
    final_tqqq_pct = discounted;
    const discount = canRecoverBearTrend
      ? `研究恢复至 ${(bearTrendFactor * 100).toFixed(1)}% 后折扣至`
      : `按 ${(bearTrendFactor * 100).toFixed(1)}% 折扣至`;
    warnings.push(`趋势 BEAR，TQQQ 分配${discount} ${(final_tqqq_pct * 100).toFixed(1)}%`);
  }

  final_tqqq_pct = Math.max(0, Math.min(final_tqqq_pct, hardMax));

  let pre_smoothing_tqqq_pct: number | undefined;
  if (p.targetWeightSmoothing && ctx.input.targetWeightSmoothingState) {
    // Preserve legacy `{}` => default 3-bar upward smoothing, while a down-only
    // config leaves re-levering instant.
    if (p.targetWeightSmoothing.halfLifeBars != null || p.targetWeightSmoothing.downHalfLifeBars == null) {
      const smoothed = smoothTargetWeight({
        targetPct: final_tqqq_pct,
        previousSmoothedPct: ctx.input.targetWeightSmoothingState.smoothedTqqqPct,
        halfLifeBars: p.targetWeightSmoothing.halfLifeBars,
      });
      if (smoothed.applied) {
        pre_smoothing_tqqq_pct = final_tqqq_pct;
        final_tqqq_pct = Math.max(0, Math.min(smoothed.smoothedPct, hardMax));
        warnings.push(`TQQQ 目标上行平滑：${(pre_smoothing_tqqq_pct * 100).toFixed(1)}% → ${(final_tqqq_pct * 100).toFixed(1)}%`);
      }
    }

    const regime = ctx.results.regime?.data;
    const transitionDownSmoothing = p.researchTransitionDownSmoothing;
    const transitionDownSmoothingActive = transitionDownSmoothing != null
      && (transitionDownSmoothing.regimeIn ?? ['SIDEWAYS', 'RISK_ON_WEAKENING']).includes(regime?.regime as 'SIDEWAYS' | 'RISK_ON_WEAKENING')
      && (regime?.vix ?? -Infinity) >= (transitionDownSmoothing.vixMin ?? 20)
      && (regime?.vix_change_5d ?? -Infinity) >= (transitionDownSmoothing.vixRise5dMin ?? 0)
      && (regime?.roc5 ?? Infinity) <= (transitionDownSmoothing.roc5Max ?? 0);
    const effectiveDownMaxDropPp = transitionDownSmoothingActive
      ? transitionDownSmoothing!.maxDropPp
      : p.targetWeightSmoothing.downMaxDropPp;
    const canSmoothDown = policy?.downSmoothing !== 'off' &&
      p.targetWeightSmoothing.downHalfLifeBars != null &&
      regime?.regime !== 'BEAR' &&
      regime?.regime !== 'CRISIS' &&
      (regime?.price_vs_sma200_pct ?? 0) > 0 &&
      (p.targetWeightSmoothing.downVixCeiling == null ||
        (typeof regime?.vix === 'number' && regime.vix < p.targetWeightSmoothing.downVixCeiling)) &&
      (effectiveDownMaxDropPp == null ||
        final_tqqq_pct >= ctx.input.targetWeightSmoothingState.smoothedTqqqPct - effectiveDownMaxDropPp / 100) &&
      ctx.results.trend?.status !== 'BLOCK';
    if (canSmoothDown) {
      const smoothed = smoothDownTargetWeight({
        targetPct: final_tqqq_pct,
        previousSmoothedPct: ctx.input.targetWeightSmoothingState.smoothedTqqqPct,
        halfLifeBars: p.targetWeightSmoothing.downHalfLifeBars,
      });
      if (smoothed.applied) {
        pre_smoothing_tqqq_pct = final_tqqq_pct;
        final_tqqq_pct = Math.max(0, Math.min(smoothed.smoothedPct, hardMax));
        warnings.push(`TQQQ 目标下行平滑：${(pre_smoothing_tqqq_pct * 100).toFixed(1)}% → ${(final_tqqq_pct * 100).toFixed(1)}%`);
      }
    }
  }

  const recoveryBoostPct = policy?.recoveryBoostPct ?? 0;
  let recoveryBoostAppliedPct: number | undefined;
  if (recoveryBoostPct > 0) {
    const boosted = Math.min(.80, hardMax, final_tqqq_pct + recoveryBoostPct);
    if (boosted > final_tqqq_pct) {
      final_tqqq_pct = boosted;
      recoveryBoostAppliedPct = recoveryBoostPct;
      warnings.push(`Recovery bounded boost：+${(recoveryBoostPct * 100).toFixed(1)}pp，目标 ${(final_tqqq_pct * 100).toFixed(1)}%`);
    }
  }

  const trendParticipation = evaluateTrendParticipation(ctx, final_tqqq_pct, hardMax);
  const budgetRefillCeiling = trendParticipation.data.conditionalCapApplied ?? trendParticipation.effectiveHardMaxPct;
  const targetBeforeBudgetRefill = trendParticipation.targetPct;
  const budgetRefillPct = trendParticipation.data.budgetRefillActive
    ? (trendParticipation.data.budgetRefillConfiguredPct ?? 0)
    : trendParticipation.data.budgetRefillPreConfirmActive
      ? (trendParticipation.data.budgetRefillPreConfirmConfiguredPct ?? 0)
      : 0;
  const budgetRefillTarget = budgetRefillPct > 0
    ? Math.min(
      budgetRefillCeiling,
      targetBeforeBudgetRefill + budgetRefillPct,
    )
    : final_tqqq_pct;
  if (trendParticipation.data.conditionalCapApplied != null && trendParticipation.targetPct < final_tqqq_pct - 1e-9) {
    final_tqqq_pct = trendParticipation.targetPct;
    binding_constraint = 'conditional_cap';
  } else if (trendParticipation.targetPct > final_tqqq_pct + 1e-9) {
    final_tqqq_pct = trendParticipation.targetPct;
    binding_constraint = 'trend_participation';
    warnings.push(`Trend participation release：${(trendParticipation.data.baseTargetPct * 100).toFixed(1)}% → ${(final_tqqq_pct * 100).toFixed(1)}%`);
  }
  if (trendParticipation.data.budgetRefillActive || trendParticipation.data.budgetRefillPreConfirmActive) {
    const refilledTarget = Math.max(final_tqqq_pct, budgetRefillTarget);
    const applied = Math.max(0, refilledTarget - targetBeforeBudgetRefill);
    trendParticipation.data.budgetRefillAppliedPct = applied;
    trendParticipation.data.budgetRefillBindingReason = applied > 1e-9
      ? trendParticipation.data.budgetRefillPreConfirmActive ? 'pre_confirm_trend_budget_refill' : 'trend_budget_refill'
      : 'capacity_or_existing_release';
    if (refilledTarget > final_tqqq_pct + 1e-9) {
      final_tqqq_pct = refilledTarget;
      binding_constraint = 'trend_participation';
      const phase = trendParticipation.data.budgetRefillPreConfirmActive ? 'pre-confirm' : 'confirmed';
      warnings.push(`Trend budget refill (${phase})：vol-target ${(volTargetWeight * 100).toFixed(1)}% → ${(volTargetWeight + budgetRefillPct) * 100}%`);
    }
  }

  const strongGapRelease = p.researchStrongGapRelease?.mode === 'p37_vix_tier'
    ? undefined
    : p.researchStrongGapRelease;
  const strongGapReleaseBaseBinding = binding_constraint;
  const strongGapReleaseEligible = strongGapRelease != null
    && strongGapReleaseBaseBinding === 'vol_target'
    && currentRegime === 'BULL'
    && currentTqqqPct <= final_tqqq_pct - Math.max(0, strongGapRelease.minGapPp) / 100
    && (ctx.results.volTarget?.data.qqq_er20 ?? -Infinity) >= (strongGapRelease.er20Min ?? .30)
    && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= (strongGapRelease.realizedVolMax ?? .70)
    && (ctx.results.regime?.data.vix ?? Infinity) <= (strongGapRelease.vixMax ?? 20)
    && (tqqqOneDayReturn ?? -Infinity) >= (strongGapRelease.qqqReturnMin ?? 0)
    && (ctx.results.regime?.data.price_extension_atr ?? Infinity) <= (strongGapRelease.priceExtensionMax ?? 2.65)
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= (strongGapRelease.drawdownMaxPct ?? .03)
    && Number.isFinite(strongGapRelease.addPct)
    && strongGapRelease.addPct > 0;
  let researchStrongGapReleaseAppliedPct: number | undefined;
  if (strongGapReleaseEligible) {
    const releaseCeiling = trendParticipation.data.conditionalCapApplied ?? trendParticipation.effectiveHardMaxPct;
    const boosted = Math.min(hardMax, releaseCeiling, final_tqqq_pct + strongGapRelease!.addPct);
    if (boosted > final_tqqq_pct + 1e-9) {
      researchStrongGapReleaseAppliedPct = boosted - final_tqqq_pct;
      final_tqqq_pct = boosted;
      binding_constraint = 'trend_participation';
      warnings.push(`Research strong-gap release：实际低于目标 ${(strongGapRelease!.minGapPp).toFixed(1)}pp，目标增加 ${(researchStrongGapReleaseAppliedPct * 100).toFixed(1)}pp`);
    }
  }

  const p37VixTier = p.researchStrongGapRelease?.mode === 'p37_vix_tier'
    ? p.researchStrongGapRelease
    : undefined;
  let p37VixTierAppliedPct: number | undefined;
  if (p37VixTier != null) {
    const qqqIndex = qqqBars.length - 1;
    const qqqRolling = ctx.input.precomputedIndicators?.qqq;
    const qqqCloses = qqqBars.map((bar) => bar.close);
    const qqqEr30 = qqqIndex >= 0
      ? (qqqRolling?.efficiencyAt(qqqIndex, 30) ?? calcEfficiencyRatio(qqqCloses, 30))
      : 0;
    const tqqqRoc20 = tqqqBars.length >= 21
      ? tqqqBars.at(-1)!.close / tqqqBars.at(-21)!.close - 1
      : -Infinity;
    const p37Trend = currentRegime === 'BULL' || currentRegime === 'RISK_ON_EXTENDED';
    const p37TrendMomentumScore = [
      p37Trend,
      (ctx.results.trend?.data.roc20 ?? -Infinity) > 0,
      (ctx.results.volTarget?.data.qqq_er20 ?? -Infinity) >= (p37VixTier.er20Min ?? .20),
      (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= 0,
      tqqqRoc20 > 0,
      (qqqOneDayReturn ?? -Infinity) > 0,
      (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (p37VixTier.vixChange5dMax ?? 0),
    ].filter(Boolean).length >= 6;
    const p37Breadth = p37Trend
      && qqqEr30 >= .30
      && (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= 0
      && tqqqRoc20 > 0;
    const navDrawdownPeak = ctx.input.navDrawdownPeak;
    const nav = ctx.input.account?.netLiquidation ?? 0;
    const navDrawdown = navDrawdownPeak != null && navDrawdownPeak > 0 && nav > 0
      ? Math.max(0, (navDrawdownPeak - nav) / navDrawdownPeak)
      : Infinity;
    const gap = Math.max(final_tqqq_pct - currentTqqqPct, 0);
    const p37Qualified = (p37TrendMomentumScore || p37Breadth)
      && final_tqqq_pct >= (p37VixTier.minTargetPct ?? .60)
      && gap >= Math.max(0, p37VixTier.minGapPp) / 100
      && (!p37VixTier.requireVolTargetBinding || strongGapReleaseBaseBinding === 'vol_target')
      && navDrawdown <= (p37VixTier.navDrawdownMaxPct ?? .03)
      && (ctx.results.hardRisk?.status === 'PASS')
      && (ctx.results.hardRisk?.data.constraints?.length ?? 0) === 0;
    const p37TierActive = p37Qualified
      && gap >= Math.max(0, p37VixTier.stateGapPp ?? .40) / 100
      && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (p37VixTier.vixChange5dMax ?? 0);
    if (p37TierActive) {
      const releaseCeiling = trendParticipation.data.conditionalCapApplied ?? trendParticipation.effectiveHardMaxPct;
      const dose = Math.max(0, p37VixTier.dosePct ?? .045);
      const multiplier = Math.max(0, p37VixTier.tierMultiplier ?? 1);
      const release = dose * gap * multiplier;
      const boosted = Math.min(hardMax, releaseCeiling, final_tqqq_pct + release);
      if (boosted > final_tqqq_pct + 1e-9) {
        p37VixTierAppliedPct = boosted - final_tqqq_pct;
        final_tqqq_pct = boosted;
        binding_constraint = 'trend_participation';
        warnings.push(`Research P37 VIX tier：gap ${(gap * 100).toFixed(1)}pp，目标增加 ${(p37VixTierAppliedPct * 100).toFixed(1)}pp`);
      }
    }
  }

  const postParticipationBoostPct = ctx.input.stockPostParticipationBoostPct ?? 0;
  const postParticipationBoostRegimes = ctx.input.stockPostParticipationBoostRegimes ?? ['BULL'];
  let postParticipationBoostAppliedPct: number | undefined;
  const postParticipationBoostAllowed = Math.abs(postParticipationBoostPct) > 0
    && currentRegime != null
    && postParticipationBoostRegimes.includes(currentRegime)
    && (postParticipationBoostPct < 0 || trendParticipation.data.conditionalCapApplied == null);
  if (postParticipationBoostAllowed) {
    const targetBeforePostParticipationBoost = final_tqqq_pct;
    const boostedTarget = postParticipationBoostPct > 0
      ? Math.min(budgetRefillCeiling, targetBeforePostParticipationBoost + Math.min(.06, postParticipationBoostPct))
      : Math.max(0, targetBeforePostParticipationBoost + Math.max(-.06, postParticipationBoostPct));
    if (boostedTarget > final_tqqq_pct + 1e-9) {
      final_tqqq_pct = boostedTarget;
      postParticipationBoostAppliedPct = boostedTarget - targetBeforePostParticipationBoost;
      binding_constraint = 'trend_participation';
      warnings.push(`Post-participation BULL target shift：${(postParticipationBoostPct * 100).toFixed(1)}pp，目标 ${(final_tqqq_pct * 100).toFixed(1)}%`);
    } else if (boostedTarget < final_tqqq_pct - 1e-9) {
      final_tqqq_pct = boostedTarget;
      postParticipationBoostAppliedPct = boostedTarget - targetBeforePostParticipationBoost;
      binding_constraint = 'trend_participation';
      warnings.push(`Post-participation BULL target shift：${(postParticipationBoostPct * 100).toFixed(1)}pp，目标 ${(final_tqqq_pct * 100).toFixed(1)}%`);
    }
  }

  const bullNegativeRoc20TargetJumpCapPp = Math.max(0, p.researchBullNegativeRoc20TargetJumpCapPp ?? 0);
  const priorTargetForBullJumpCap = ctx.input.targetWeightSmoothingState?.smoothedTqqqPct;
  if (bullNegativeRoc20TargetJumpCapPp > 0
    && currentRegime === 'BULL'
    && (ctx.results.trend?.data.roc20 ?? Infinity) < 0
    && priorTargetForBullJumpCap != null
    && final_tqqq_pct > priorTargetForBullJumpCap + bullNegativeRoc20TargetJumpCapPp / 100 + 1e-9) {
    final_tqqq_pct = Math.max(0, Math.min(hardMax, priorTargetForBullJumpCap + bullNegativeRoc20TargetJumpCapPp / 100));
    binding_constraint = 'trend_discount';
    warnings.push(`BULL ROC20<0 target jump cap：前一目标 ${(priorTargetForBullJumpCap * 100).toFixed(1)}% → ${(final_tqqq_pct * 100).toFixed(1)}%`);
  }

  const bullNegativeRoc5TargetReductionPp = Math.min(.15, Math.max(0, p.researchBullNegativeRoc5TargetReductionPp ?? 0));
  if (bullNegativeRoc5TargetReductionPp > 0
    && currentRegime === 'BULL'
    && (ctx.results.regime?.data.roc5 ?? Infinity) <= 0) {
    const reducedTarget = Math.max(0, final_tqqq_pct - bullNegativeRoc5TargetReductionPp);
    if (reducedTarget < final_tqqq_pct - 1e-9) {
      final_tqqq_pct = reducedTarget;
      binding_constraint = 'trend_discount';
      warnings.push(`BULL ROC5<0 soft target reduction：-${(bullNegativeRoc5TargetReductionPp * 100).toFixed(1)}pp`);
    }
  }

  const bullNegativeRoc5TargetCapPct = p.researchBullNegativeRoc5TargetCapPct;
  const bullNegativeRoc5TargetCapRoc5Max = p.researchBullNegativeRoc5TargetCapRoc5Max ?? 0;
  const bullNegativeRoc5TargetCapMinActual = p.researchBullNegativeRoc5TargetCapMinActual;
  const bullNegativeRoc5TargetCapTqqqReturnMax = p.researchBullNegativeRoc5TargetCapTqqqReturnMax;
  const bullNegativeRoc5TargetCapVixRise5dMin = p.researchBullNegativeRoc5TargetCapVixRise5dMin;
  const bullNegativeRoc5TargetCapActive = bullNegativeRoc5TargetCapPct != null
    && currentRegime === 'BULL'
    && (ctx.results.regime?.data.roc5 ?? Infinity) <= bullNegativeRoc5TargetCapRoc5Max
    && (bullNegativeRoc5TargetCapMinActual == null || currentTqqqPct >= bullNegativeRoc5TargetCapMinActual)
    && (bullNegativeRoc5TargetCapTqqqReturnMax == null || (tqqqOneDayReturn ?? Infinity) <= bullNegativeRoc5TargetCapTqqqReturnMax)
    && (bullNegativeRoc5TargetCapVixRise5dMin == null || (ctx.results.regime?.data.vix_change_5d ?? -Infinity) >= bullNegativeRoc5TargetCapVixRise5dMin);
  const bullNegativeRoc5TargetCapBindingEligible = p.researchBullNegativeRoc5TargetCapVolTargetOnly !== true
    || binding_constraint === 'vol_target';
  if (p.researchBullNegativeRoc5TargetCapBeforeSmoothing === true
    && bullNegativeRoc5TargetCapActive
    && bullNegativeRoc5TargetCapBindingEligible
    && final_tqqq_pct > bullNegativeRoc5TargetCapPct!) {
    final_tqqq_pct = Math.max(0, Math.min(final_tqqq_pct, bullNegativeRoc5TargetCapPct!));
    binding_constraint = 'trend_discount';
    warnings.push(`BULL ROC5<0 target cap before smoothing：${(final_tqqq_pct * 100).toFixed(1)}%`);
  }

  const riskOnWeakeningNegativeRoc20TargetCapPct = p.researchRiskOnWeakeningNegativeRoc20TargetCapPct;
  const riskOnWeakeningNegativeRoc20TargetCapRoc20Max = p.researchRiskOnWeakeningNegativeRoc20TargetCapRoc20Max ?? 0;
  const riskOnWeakeningNegativeRoc20TargetCapRoc5Max = p.researchRiskOnWeakeningNegativeRoc20TargetCapRoc5Max ?? Infinity;
  const riskOnWeakeningNegativeRoc20TargetCapVixRise5dMin = p.researchRiskOnWeakeningNegativeRoc20TargetCapVixRise5dMin ?? -Infinity;
  const riskOnWeakeningNegativeRoc20TargetCapDistanceToSma20Max = p.researchRiskOnWeakeningNegativeRoc20TargetCapDistanceToSma20Max ?? Infinity;
  const riskOnWeakeningNegativeRoc20TargetCapRealizedVol20dMax = p.researchRiskOnWeakeningNegativeRoc20TargetCapRealizedVol20dMax ?? Infinity;
  const riskOnWeakeningNegativeRoc20TargetCapMinActual = p.researchRiskOnWeakeningNegativeRoc20TargetCapMinActual;
  const riskOnWeakeningNegativeRoc20TargetCapMinPriorTarget = p.researchRiskOnWeakeningNegativeRoc20TargetCapMinPriorTarget;
  const riskOnWeakeningNegativeRoc20TargetCapMinCurrentTarget = p.researchRiskOnWeakeningNegativeRoc20TargetCapMinCurrentTarget;
  const riskOnWeakeningNegativeRoc20TargetCapMinPriorTargetDropPp = Math.max(0, p.researchRiskOnWeakeningNegativeRoc20TargetCapMinPriorTargetDropPp ?? 0);
  const riskOnWeakeningNegativeRoc20TargetCapTransitionOnly = p.researchRiskOnWeakeningNegativeRoc20TargetCapTransitionOnly === true;
  const riskOnWeakeningNegativeRoc20TargetCapTqqqReturnMax = p.researchRiskOnWeakeningNegativeRoc20TargetCapTqqqReturnMax;
  const priorSmoothedTargetPct = ctx.input.targetWeightSmoothingState?.smoothedTqqqPct;
  const riskOnWeakeningNegativeRoc20TargetCapActive = riskOnWeakeningNegativeRoc20TargetCapPct != null
    && currentRegime === 'RISK_ON_WEAKENING'
    && (ctx.results.trend?.data.roc20 ?? Infinity) < riskOnWeakeningNegativeRoc20TargetCapRoc20Max
    && (ctx.results.regime?.data.roc5 ?? Infinity) <= riskOnWeakeningNegativeRoc20TargetCapRoc5Max
    && (ctx.results.regime?.data.vix_change_5d ?? -Infinity) >= riskOnWeakeningNegativeRoc20TargetCapVixRise5dMin
    && (ctx.results.regime?.data.distanceToSma20Pct ?? Infinity) <= riskOnWeakeningNegativeRoc20TargetCapDistanceToSma20Max
    && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= riskOnWeakeningNegativeRoc20TargetCapRealizedVol20dMax
    && (riskOnWeakeningNegativeRoc20TargetCapMinActual == null || currentTqqqPct >= riskOnWeakeningNegativeRoc20TargetCapMinActual)
    && (riskOnWeakeningNegativeRoc20TargetCapMinCurrentTarget == null || final_tqqq_pct >= riskOnWeakeningNegativeRoc20TargetCapMinCurrentTarget)
    && (riskOnWeakeningNegativeRoc20TargetCapMinPriorTarget == null || (priorSmoothedTargetPct ?? -Infinity) >= riskOnWeakeningNegativeRoc20TargetCapMinPriorTarget)
    && (!riskOnWeakeningNegativeRoc20TargetCapTransitionOnly
      || ['BULL', 'RISK_ON_EXTENDED'].includes(ctx.input.researchPreviousRegime ?? ''))
    && (riskOnWeakeningNegativeRoc20TargetCapTqqqReturnMax == null
      || (tqqqOneDayReturn ?? Infinity) <= riskOnWeakeningNegativeRoc20TargetCapTqqqReturnMax)
    && (priorSmoothedTargetPct == null || priorSmoothedTargetPct - final_tqqq_pct >= riskOnWeakeningNegativeRoc20TargetCapMinPriorTargetDropPp / 100);
  if (riskOnWeakeningNegativeRoc20TargetCapActive && final_tqqq_pct > riskOnWeakeningNegativeRoc20TargetCapPct!) {
    final_tqqq_pct = Math.max(0, Math.min(final_tqqq_pct, riskOnWeakeningNegativeRoc20TargetCapPct!));
    binding_constraint = 'trend_discount';
    warnings.push(`RISK_ON_WEAKENING ROC20<0 target cap：${(final_tqqq_pct * 100).toFixed(1)}%`);
  }

  if (p.researchBullNegativeRoc5TargetCapBeforeSmoothing !== true
    && bullNegativeRoc5TargetCapActive
    && bullNegativeRoc5TargetCapBindingEligible
    && final_tqqq_pct > bullNegativeRoc5TargetCapPct!) {
    final_tqqq_pct = Math.max(0, Math.min(final_tqqq_pct, bullNegativeRoc5TargetCapPct!));
    binding_constraint = 'trend_discount';
    warnings.push(`BULL ROC5<0 target cap：${(final_tqqq_pct * 100).toFixed(1)}%`);
  }

  // When the research ordering flag is enabled, reuse the existing down
  // smoother once more after the cap. This keeps the cap's risk intent while
  // avoiding an immediate sell-to-cap / buy-back cycle on the next bar.
  if (p.researchBullNegativeRoc5TargetCapBeforeSmoothing === true
    && bullNegativeRoc5TargetCapActive
    && bullNegativeRoc5TargetCapBindingEligible
    && p.targetWeightSmoothing
    && ctx.input.targetWeightSmoothingState) {
    const regimeData = ctx.results.regime?.data;
    const canSmoothDown = policy?.downSmoothing !== 'off'
      && p.targetWeightSmoothing.downHalfLifeBars != null
      && regimeData?.regime !== 'BEAR'
      && regimeData?.regime !== 'CRISIS'
      && (regimeData?.price_vs_sma200_pct ?? 0) > 0
      && (p.targetWeightSmoothing.downVixCeiling == null
        || (typeof regimeData?.vix === 'number' && regimeData.vix < p.targetWeightSmoothing.downVixCeiling))
      && (p.targetWeightSmoothing.downMaxDropPp == null
        || final_tqqq_pct >= ctx.input.targetWeightSmoothingState.smoothedTqqqPct - p.targetWeightSmoothing.downMaxDropPp / 100)
      && ctx.results.trend?.status !== 'BLOCK';
    if (canSmoothDown) {
      const smoothed = smoothDownTargetWeight({
        targetPct: final_tqqq_pct,
        previousSmoothedPct: ctx.input.targetWeightSmoothingState.smoothedTqqqPct,
        halfLifeBars: p.targetWeightSmoothing.downHalfLifeBars,
      });
      if (smoothed.applied) {
        pre_smoothing_tqqq_pct = final_tqqq_pct;
        final_tqqq_pct = Math.max(0, Math.min(smoothed.smoothedPct, hardMax));
        warnings.push(`BULL ROC5<0 cap后下行平滑：${(pre_smoothing_tqqq_pct * 100).toFixed(1)}% → ${(final_tqqq_pct * 100).toFixed(1)}%`);
      }
    }
  }

  // Research-only target persistence: preserve the existing high target for a
  // clean current BULL bar when vol-target alone would drop it. This is placed
  // after the existing defensive caps and never exceeds HardRisk. It uses only
  // the prior smoothed target plus current-bar information; no forward return
  // or date admission is involved.
  if ((p.researchTargetPersistenceMode === 'clean_bull_target90'
    || p.researchTargetPersistenceMode === 'clean_bull_target90_adx_lt30'
    || p.researchTargetPersistenceMode === 'clean_bull_target90_not_strong_trend'
    || p.researchTargetPersistenceMode === 'clean_bull_target90_roc5_le25')
    && binding_constraint === 'vol_target'
    && currentRegime === 'BULL'
    && priorSmoothedTargetPct != null
    && priorSmoothedTargetPct >= .90 - 1e-9
    && final_tqqq_pct <= priorSmoothedTargetPct - .025 + 1e-9
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= 0
    && (ctx.results.volTarget?.data.qqq_er20 ?? -Infinity) >= .30
    && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= .90
    && (ctx.results.regime?.data.price_extension_atr ?? Infinity) < 2.65
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) < .03
    && (ctx.input.prices?.QQQ?.at(-1)?.close ?? 0) >= (ctx.input.prices?.QQQ?.at(-2)?.close ?? Infinity)
    && (p.researchTargetPersistenceMode !== 'clean_bull_target90_adx_lt30'
      || (ctx.results.regime?.data.adx14 ?? Infinity) < 30)
    && (p.researchTargetPersistenceMode !== 'clean_bull_target90_not_strong_trend'
      || ctx.results.trend?.data.signal !== 'BULL')
    && (p.researchTargetPersistenceMode !== 'clean_bull_target90_roc5_le25'
      || (ctx.results.regime?.data.roc5 ?? Infinity) <= .025)) {
    const persistenceFraction = Math.min(1, Math.max(0, p.researchTargetPersistenceFraction ?? 1));
    const persistedTarget = Math.min(hardMax, final_tqqq_pct + (priorSmoothedTargetPct - final_tqqq_pct) * persistenceFraction);
    if (persistedTarget > final_tqqq_pct + 1e-9) {
      final_tqqq_pct = persistedTarget;
      binding_constraint = 'trend_participation';
      warnings.push(`研究目标持久化：clean BULL 保留 ${(persistedTarget * 100).toFixed(1)}%目标`);
    }
  }

  // Research-only independent participation target ramp. Reuse the same six
  // observable components as the same-day score bridge, but lift the target
  // only by a small amount while vol-target is the binding constraint. This
  // remains causal and does not replace the existing defensive caps.
  const independentTargetBoostPct = Math.min(.06, Math.max(0, p.researchIndependentParticipationTargetBoostPct ?? 0));
  const independentTargetScore = [
    (ctx.results.regime?.data.vix ?? Infinity) <= 22 && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= 0,
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= 0,
    (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= 0,
    (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) < .05
      && (ctx.results.regime?.data.price_extension_atr ?? Infinity) < 2.65,
    (qqqOneDayReturn ?? -Infinity) >= 0,
    (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= .90,
  ].filter(Boolean).length;
  const independentTargetBoostAllowed = independentTargetBoostPct > 0
    && ((['BULL', 'RISK_ON_EXTENDED'].includes(currentRegime ?? '')
      && independentTargetScore >= 5)
      || (p.researchIndependentParticipationTargetBoostAllowTransitionRegimes === true
        && ['RANGE_BOUND', 'SIDEWAYS'].includes(currentRegime ?? '')
        && independentTargetScore >= 6))
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
    && binding_constraint === 'vol_target'
    && final_tqqq_pct < .85 - 1e-9
    && currentTqqqPct < final_tqqq_pct - 1e-9
    && ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true;
  let researchIndependentTargetBoostAppliedPct: number | undefined;
  if (independentTargetBoostAllowed) {
    const boostedTarget = Math.min(hardMax, .85, final_tqqq_pct + independentTargetBoostPct);
    if (boostedTarget > final_tqqq_pct + 1e-9) {
      researchIndependentTargetBoostAppliedPct = boostedTarget - final_tqqq_pct;
      final_tqqq_pct = boostedTarget;
      binding_constraint = 'trend_participation';
      warnings.push(`研究独立参与目标抬升：评分${independentTargetScore}/6，目标增加 ${(researchIndependentTargetBoostAppliedPct * 100).toFixed(1)}pp`);
    }
  }

  // Research-only confirmed-crisis rebound micro-state. It keeps the crisis
  // state machine and HardRisk intact, and only permits a small capped target
  // after a strong, causal rebound with falling VIX and positive short momentum.
  const confirmedReboundTargetCapPct = p.researchConfirmedReboundTargetCapPct;
  const confirmedReboundEligible = confirmedReboundTargetCapPct != null
    && confirmedReboundTargetCapPct > 0
    && crisisPhase === 'CONFIRMED'
    && (qqqOneDayReturn ?? -Infinity) >= .05
    && (tqqqOneDayReturn ?? -Infinity) >= .15
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= 0
    && (ctx.results.regime?.data.vix ?? Infinity) <= 65
    && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= 1.50
    && ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
    && currentTqqqPct < confirmedReboundTargetCapPct - 1e-9;
  if (confirmedReboundEligible) {
    const reboundTarget = Math.min(hardMax, confirmedReboundTargetCapPct!);
    if (reboundTarget > final_tqqq_pct + 1e-9) {
      final_tqqq_pct = reboundTarget;
      binding_constraint = 'trend_participation';
      warnings.push(`研究 CONFIRMED 反弹微量参与：目标 ${(reboundTarget * 100).toFixed(1)}%`);
    }
  }

  const remaining = 1 - final_tqqq_pct;
  const final_cash_pct = p.minCashReserve;
  const final_boxx_pct = Math.max(0, remaining - final_cash_pct);

  const status = warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'RiskBudget',
    status,
    data: {
      final_tqqq_pct,
      final_boxx_pct,
      final_cash_pct,
      binding_constraint,
      targetWeightSmoothingState: { smoothedTqqqPct: final_tqqq_pct },
      pre_smoothing_tqqq_pct,
      recoveryBoostAppliedPct,
    researchPostParticipationBoostPct: Math.abs(postParticipationBoostPct) > 0 ? postParticipationBoostPct : undefined,
    researchPostParticipationBoostAllowed: Math.abs(postParticipationBoostPct) > 0 ? postParticipationBoostAllowed : undefined,
    researchPostParticipationBoostAppliedPct: postParticipationBoostAppliedPct,
    researchStrongGapReleaseAppliedPct: researchStrongGapReleaseAppliedPct ?? p37VixTierAppliedPct,
    researchIndependentTargetBoostAppliedPct,
    trendParticipation: trendParticipation.data,
    },
    warnings,
    blockers,
  };
}
