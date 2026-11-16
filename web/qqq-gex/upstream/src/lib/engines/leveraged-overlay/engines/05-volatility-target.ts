import type { PipelineContext, EngineResult, VolTargetData } from '../types/pipeline';
import { calcEfficiencyRatio, calcEwmaVol, calcRealizedVol, calcROC, closes } from '../utils';
import { DEFAULT_STRATEGY_PARAMS, resolveTrendParticipationQuality } from '../types/params';

function riskOnWeakeningFactor(ctx: PipelineContext, qqqEr20?: number, realizedVol?: number): number {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const conditional = p.conditionalRiskOnWeakeningFactor;
  const regime = ctx.results.regime?.data.regime;
  const currentTqqqPct = ctx.results.hardRisk?.data.tqqq_current_pct ?? 0;
  if (conditional != null && regime === 'RISK_ON_WEAKENING'
    && (ctx.results.regime?.data.vix ?? Infinity) >= (conditional.vixMin ?? -Infinity)
    && (ctx.results.regime?.data.vix ?? Infinity) <= (conditional.vixMax ?? Infinity)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (conditional.vixRise5dMax ?? .02)
    && (realizedVol ?? Infinity) <= (conditional.realizedVolMax ?? 1)
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= (conditional.roc5Min ?? 0)
    && (qqqEr20 ?? -Infinity) >= (conditional.er20Min ?? .20)
    && (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= (conditional.priceVsSma200Min ?? 0)
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= (conditional.drawdownMax ?? .05)) {
    return conditional.factor;
  }
  const cfg = p.riskOnWeakeningGradedDiscount;
  if (!cfg) return p.riskOnWeakeningFactor ?? 0.92;
  const signalCount = ctx.results.regime?.data.weakening_signal_count ?? 3;
  return Math.max(0.5, 0.92 - cfg.perSignalPct * (signalCount - 3));
}

function sidewaysFactor(ctx: PipelineContext, qqqEr20: number, realizedVol: number): number {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const baseline = ctx.input.sidewaysFactorOverride ?? p.sidewaysFactor ?? 0.85;
  const conditional = p.conditionalSidewaysFactor;
  if (conditional == null || ctx.results.regime?.data.regime !== 'SIDEWAYS') return baseline;
  const score = [
    (ctx.results.regime?.data.roc5 ?? -Infinity) >= (conditional.roc5Min ?? 0),
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= (conditional.roc20Min ?? .02),
    (ctx.results.regime?.data.sma20_slope_pct ?? -Infinity) >= (conditional.sma20SlopeMin ?? 0),
    qqqEr20 >= (conditional.er20Min ?? .20),
  ].filter(Boolean).length;
  const clean = score >= Math.max(1, Math.floor(conditional.minScore ?? 3))
    && (ctx.results.regime?.data.vix ?? Infinity) <= (conditional.vixMax ?? 24)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (conditional.vixRise5dMax ?? .02)
    && realizedVol <= (conditional.realizedVolMax ?? 1)
    && (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= (conditional.priceVsSma200Min ?? 0)
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= (conditional.drawdownMax ?? .05)
    && (ctx.results.regime?.data.price_extension_atr ?? Infinity) <= (conditional.priceExtensionMax ?? 2.65);
  return clean ? Math.max(baseline, conditional.factor) : baseline;
}

export function runVolatilityTarget(ctx: PipelineContext): EngineResult<VolTargetData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const policy = ctx.stockPolicy?.value.overrides;
  const currentTqqqPct = ctx.results.hardRisk?.data.tqqq_current_pct ?? 0;

  const { prices } = ctx.input;
  const warnings: string[] = [];
  const blockers: string[] = [];

  const qqqRolling = ctx.input.precomputedIndicators?.qqq;
  const tqqqRolling = ctx.input.precomputedIndicators?.tqqq;
  const qqqIndex = prices.QQQ.length - 1;
  const tqqqIndex = prices.TQQQ.length - 1;
  let qqqCloses: number[] | undefined;
  let tqqqCloses: number[] | undefined;
  const getQqqCloses = () => qqqCloses ??= closes(prices.QQQ);
  const getTqqqCloses = () => tqqqCloses ??= closes(prices.TQQQ);
  const qqqEr20 = qqqRolling?.efficiencyAt(qqqIndex, 20) ?? calcEfficiencyRatio(getQqqCloses(), 20);
  const tqqq_realized_vol_20d = tqqqRolling?.realizedVolAt(tqqqIndex, 20) ?? calcRealizedVol(getTqqqCloses(), 20);

  const regime = ctx.results.regime?.data.regime;

  // In BULL regime, use min(5d, 10d, 20d) realized vol: after a crash, 20d/10d windows carry
  // stale spike-vol for days. min() uses whichever lookback has calmed first — typically 5d
  // drops after ~5 calm days, allowing faster re-entry than waiting the full 10-20d window.
  // Safety: if a NEW spike occurs, the short window is HIGHER → min() naturally reverts to 20d.
  const isRiskOn = regime === 'BULL' || regime === 'RISK_ON_EXTENDED' || regime === 'RISK_ON_WEAKENING';
  // Opt-in (fastVolReentry): extend the fast-calm blend to the recovery base-building regimes
  // (SIDEWAYS / RANGE_BOUND) so a calmed tape re-sizes before the full 20d window rolls off.
  // BEAR/CRISIS stay on 20d-only (still conservative in a confirmed downtrend).
  const allowFastVol = isRiskOn ||
    ((policy?.fastVolReentry ?? p.fastVolReentry) === true && (regime === 'SIDEWAYS' || regime === 'RANGE_BOUND'));
  const tqqq_realized_vol_10d = allowFastVol ? (tqqqRolling?.realizedVolAt(tqqqIndex, 10) ?? calcRealizedVol(getTqqqCloses(), 10)) : null;
  const tqqq_realized_vol_5d  = allowFastVol ? (tqqqRolling?.realizedVolAt(tqqqIndex, 5) ?? calcRealizedVol(getTqqqCloses(), 5)) : null;
  const windowVol = (tqqq_realized_vol_10d !== null && tqqq_realized_vol_5d !== null)
    ? Math.min(tqqq_realized_vol_20d, tqqq_realized_vol_10d, tqqq_realized_vol_5d)
    : tqqq_realized_vol_20d;
  const configuredEstimator = p.volEstimator ?? 'window';
  const estimator = (regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
    ? (p.riskOnVolEstimator ?? configuredEstimator)
    : configuredEstimator;
  const qqqVol = qqqRolling?.realizedVolAt(qqqIndex, 20) ?? calcRealizedVol(getQqqCloses(), 20);
  const qqqScaledVol = estimator === 'qqq_scaled_2_5x'
    ? qqqVol * 2.5
    : estimator === 'qqq_scaled_3x'
      ? qqqVol * 3
      : estimator === 'qqq_scaled_3_5x'
        ? qqqVol * 3.5
        : 0;
  const minWindowVixMultiplier = estimator === 'min_window_vix_2x'
    ? 2
    : estimator === 'min_window_vix_2_5x'
      ? 2.5
      : estimator === 'min_window_vix_3x'
        ? 3
        : undefined;
  const ewmaVol = estimator === 'window' ? 0 : calcEwmaVol(getTqqqCloses());
  const vixLedVol = ctx.input.macro.vix != null ? (ctx.input.macro.vix / 100) * 2.5 : 0;
  const minWindowVixVol = minWindowVixMultiplier == null || ctx.input.macro.vix == null
    ? undefined
    : (ctx.input.macro.vix / 100) * minWindowVixMultiplier;
  const baseActiveVol = estimator.startsWith('qqq_scaled_')
    ? qqqScaledVol
    : minWindowVixVol != null
      ? Math.min(windowVol, minWindowVixVol)
    : estimator === 'ewma'
    ? ewmaVol
    : estimator === 'ewma_vix_blend'
      ? Math.max(ewmaVol, vixLedVol)
      : windowVol;
  const activeVol = p.bearVolBlend === true && (regime === 'BEAR' || regime === 'CRISIS')
    ? Math.max(baseActiveVol, vixLedVol)
    : baseActiveVol;
  const weakeningMaxWindowVolMinActual = p.researchRiskOnWeakeningUseMaxWindowVolMinActual;
  const weakeningMaxWindowVolActive = regime === 'RISK_ON_WEAKENING'
    && p.researchRiskOnWeakeningUseMaxWindowVol === true
    && (weakeningMaxWindowVolMinActual == null || currentTqqqPct >= weakeningMaxWindowVolMinActual)
    && (ctx.results.regime?.data.roc5 ?? Infinity) <= (p.researchRiskOnWeakeningTargetVolRoc5Max ?? Infinity)
    && (ctx.results.regime?.data.vix_change_5d ?? -Infinity) >= (p.researchRiskOnWeakeningTargetVolVixRise5dMin ?? -Infinity);
  const riskOnWeakeningActiveVol = weakeningMaxWindowVolActive
    ? Math.max(tqqq_realized_vol_20d, tqqq_realized_vol_10d ?? tqqq_realized_vol_20d, tqqq_realized_vol_5d ?? tqqq_realized_vol_20d)
    : activeVol;

  const effectiveVol = Math.max(riskOnWeakeningActiveVol, p.minVolFloor);
  const inputNav = ctx.input.account?.netLiquidation ?? 0;
  const navPeak = ctx.input.navDrawdownPeak;
  const currentNavDrawdownPct = navPeak != null && navPeak > 0 && inputNav > 0
    ? Math.max(0, (navPeak - inputNav) / navPeak)
    : Infinity;
  // G1: double-gate on fast regime too — see 02-hard-risk-rules.ts for rationale.
  const baseTargetVol = p.slowBearTargetVol?.targetVol != null
    && ctx.input.macroRegimeState?.phase === 'SLOW_BEAR'
    && (regime === 'BEAR' || regime === 'CRISIS')
    ? p.slowBearTargetVol.targetVol
    : ctx.input.targetVolOverride ?? p.targetVol;
  let effectiveTargetVol = baseTargetVol * (policy?.targetVolMultiplier ?? 1);
  const bullConfidenceBudget = p.bullConfidenceTargetVolMultiplier;
  if (regime === 'BULL'
    && bullConfidenceBudget != null
    && Number.isFinite(bullConfidenceBudget.multiplier)
    && (ctx.results.regime?.data.confidence ?? -Infinity) >= (bullConfidenceBudget.minConfidence ?? 8)) {
    effectiveTargetVol *= Math.max(1, bullConfidenceBudget.multiplier);
  }
  // Research-only local budget adjustment. Keep the frozen estimator and all
  // confirmed risk-off branches unchanged; only weakening bars matching the
  // optional ROC20 ceiling are affected.
  const weakeningTargetVolMultiplier = p.researchRiskOnWeakeningTargetVolMultiplier;
  const weakeningRoc20 = ctx.results.trend?.data.roc20 ?? -Infinity;
  const weakeningRoc5 = ctx.results.regime?.data.roc5 ?? -Infinity;
  const weakeningTargetVolActive = regime === 'RISK_ON_WEAKENING'
    && weakeningTargetVolMultiplier != null
    && Number.isFinite(weakeningTargetVolMultiplier)
    && weakeningRoc20 <= (p.researchRiskOnWeakeningTargetVolRoc20Max ?? Infinity)
    && weakeningRoc5 <= (p.researchRiskOnWeakeningTargetVolRoc5Max ?? Infinity);
  if (weakeningTargetVolActive) {
    effectiveTargetVol *= Math.max(0, weakeningTargetVolMultiplier!);
  }
  const releaseConfig = p.trendParticipationRelease;
  const strongTargetVolMultiplier = releaseConfig?.strongTargetVolMultiplier;
  const strongTargetVolOverride = releaseConfig?.strongTargetVolOverride;
  const strongTargetVolLowRvOverride = releaseConfig?.strongTargetVolLowRvOverride;
  const strongQuality = resolveTrendParticipationQuality(releaseConfig, 'strong');
  const stockPolicyId = ctx.stockPolicy?.value.id;
  const strongTargetVolPolicyAllowed = stockPolicyId === 'SLOW_BULL_GROWTH'
    || (releaseConfig?.stockPolicyIn?.includes(stockPolicyId as 'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_RECOVERY') ?? false);
  const strongTargetVolRegime = releaseConfig?.enabled === true
    && strongTargetVolPolicyAllowed
    && (regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
    && ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true;
  const strongTargetVolScore = [
    (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0,
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= (strongQuality?.roc20Min ?? .02),
    (ctx.results.regime?.data.sma20_slope_pct ?? -Infinity) >= 0,
    qqqEr20 >= (strongQuality?.er20Min ?? .20),
  ].filter(Boolean).length;
  const strongTargetVolScoreMin = Math.max(1, Math.floor(releaseConfig?.strongTargetVolScoreMin ?? strongQuality?.minScore ?? 4));
  const strongTargetVolClean = strongTargetVolRegime
    && strongTargetVolScore >= strongTargetVolScoreMin
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= (strongQuality?.roc5Min ?? -Infinity)
    && (strongQuality?.adxMin == null || (ctx.results.regime?.data.adx14 ?? -Infinity) >= strongQuality.adxMin)
    && (ctx.results.regime?.data.distanceToSma20Pct ?? -Infinity) >= 0
    && (ctx.results.regime?.data.vix ?? Infinity) <= (strongQuality?.vixMax ?? 24)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (strongQuality?.vixRise5dMax ?? .02)
    && tqqq_realized_vol_20d <= (strongQuality?.realizedVolMax ?? 1)
    && (strongQuality?.priceExtensionMax == null || (ctx.results.regime?.data.price_extension_atr ?? Infinity) <= strongQuality.priceExtensionMax)
    && (strongQuality?.drawdownMaxPct == null || (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= strongQuality.drawdownMaxPct);
  const strongTargetVolOverrideActive = strongTargetVolClean
    && strongTargetVolOverride != null
    && Number.isFinite(strongTargetVolOverride.multiplier)
    && (strongTargetVolOverride.regimeIn == null
      || strongTargetVolOverride.regimeIn.includes(regime as 'BULL' | 'RISK_ON_EXTENDED'))
    && (strongTargetVolOverride.requireActive !== true || ctx.input.trendParticipationState?.active === true)
    && qqqEr20 >= (strongTargetVolOverride.er20Min ?? Infinity)
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= (strongTargetVolOverride.roc5Min ?? -Infinity)
    && (strongTargetVolOverride.qqqReturnMin == null
      || (prices.QQQ.length >= 2 && prices.QQQ.at(-1)!.close / prices.QQQ.at(-2)!.close - 1 >= strongTargetVolOverride.qqqReturnMin))
    && (ctx.results.regime?.data.vix ?? Infinity) <= (strongTargetVolOverride.vixMax ?? Infinity)
    && tqqq_realized_vol_20d <= (strongTargetVolOverride.realizedVolMax ?? Infinity);
  const effectiveStrongTargetVolMultiplier = strongTargetVolOverrideActive
    ? Math.max(strongTargetVolMultiplier ?? 1, strongTargetVolOverride!.multiplier)
    : strongTargetVolMultiplier;
  const strongTargetVolLowRvActive = strongTargetVolOverrideActive
    && strongTargetVolLowRvOverride != null
    && Number.isFinite(strongTargetVolLowRvOverride.multiplier)
    && Number.isFinite(strongTargetVolLowRvOverride.realizedVolMax)
    && tqqq_realized_vol_20d <= strongTargetVolLowRvOverride.realizedVolMax
    && (strongTargetVolLowRvOverride.maxActualPct == null || currentTqqqPct <= strongTargetVolLowRvOverride.maxActualPct);
  const effectiveStrongTargetVolMultiplierWithLowRv = strongTargetVolLowRvActive
    ? Math.max(effectiveStrongTargetVolMultiplier ?? 1, strongTargetVolLowRvOverride!.multiplier)
    : effectiveStrongTargetVolMultiplier;
  if (strongTargetVolClean && effectiveStrongTargetVolMultiplierWithLowRv != null && Number.isFinite(effectiveStrongTargetVolMultiplierWithLowRv)) {
    effectiveTargetVol *= Math.max(1, effectiveStrongTargetVolMultiplierWithLowRv);
  }
  // Research-only independent participation recovery budget. This adjusts the
  // volatility budget, not the target percentage, and only during a causal
  // low-RV recovery state with a low current position.
  const independentTargetVolMultiplier = p.researchIndependentParticipationTargetVolMultiplier;
  const independentTargetVolScoreMin = Math.max(1, Math.floor(p.researchIndependentParticipationTargetVolScoreMin ?? 5));
  const independentTargetVolNavDrawdownMaxPct = p.researchIndependentParticipationTargetVolNavDrawdownMaxPct ?? .03;
  const independentTargetVolSlowBullOnly = p.researchIndependentParticipationTargetVolSlowBullOnly === true;
  const independentTargetVolTrendScoreMin = p.researchIndependentParticipationTargetVolTrendScoreMin;
  const independentTargetVolRequireQqqUp = p.researchIndependentParticipationTargetVolRequireQqqUp === true;
  const independentTargetVolScore = [
    (ctx.results.regime?.data.vix ?? Infinity) <= 22 && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= 0,
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= 0,
    (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= 0,
    (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) < .05
      && (ctx.results.regime?.data.price_extension_atr ?? Infinity) < 2.65,
    prices.QQQ.length >= 2 && prices.QQQ.at(-1)!.close >= prices.QQQ.at(-2)!.close,
    tqqq_realized_vol_20d <= .90,
  ].filter(Boolean).length;
  const independentTargetVolActive = independentTargetVolMultiplier != null
    && Number.isFinite(independentTargetVolMultiplier)
    && independentTargetVolMultiplier > 1
    && regime != null
    && ['BULL', 'RISK_ON_EXTENDED'].includes(regime)
    && (!independentTargetVolSlowBullOnly || ctx.input.macroRegimeState?.phase === 'SLOW_BULL')
    && (independentTargetVolTrendScoreMin == null || (ctx.results.trend?.data.score ?? -Infinity) >= independentTargetVolTrendScoreMin)
    && (!independentTargetVolRequireQqqUp || (prices.QQQ.length >= 2 && prices.QQQ.at(-1)!.close >= prices.QQQ.at(-2)!.close))
    && independentTargetVolScore >= independentTargetVolScoreMin
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
    && tqqq_realized_vol_20d <= .70
    && currentTqqqPct < .70
    && currentNavDrawdownPct <= independentTargetVolNavDrawdownMaxPct
    && ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true;
  if (independentTargetVolActive) {
    effectiveTargetVol *= independentTargetVolMultiplier;
  }
  const strongVolEstimator = releaseConfig?.strongVolEstimator;
  const strongVolEstimatorVol = strongVolEstimator === 'qqq_scaled_2_5x'
    ? qqqVol * 2.5
    : strongVolEstimator === 'qqq_scaled_3x'
      ? qqqVol * 3
      : strongVolEstimator === 'qqq_scaled_3_5x'
        ? qqqVol * 3.5
        : undefined;
  const strongVolEstimatorAllowed = strongVolEstimatorVol != null
    && qqqEr20 >= (releaseConfig?.strongVolEstimatorErMin ?? -Infinity);
  const proxyBudgetVol = strongVolEstimatorAllowed ? Math.max(strongVolEstimatorVol!, p.minVolFloor) : undefined;
  const budgetVol = strongTargetVolClean && proxyBudgetVol != null
    ? releaseConfig?.strongVolEstimatorMode === 'min' ? Math.min(effectiveVol, proxyBudgetVol) : proxyBudgetVol
    : effectiveVol;
  let raw_weight = effectiveTargetVol / budgetVol;
  if (isRiskOn) raw_weight *= policy?.riskOnWeightMultiplier ?? 1;
  if (p.macroRegime && ctx.input.macroRegimeState?.phase === 'SLOW_BULL' && isRiskOn) {
    let boostFactor = p.macroRegime.boostFactor;
    if (p.macroBoostMomentumDamping) {
      const { k, floor, ceil, signal, rocDays } = p.macroBoostMomentumDamping;
      const momentumPct = signal === 'roc'
        ? (qqqRolling?.rocAt(qqqIndex, rocDays ?? 3) ?? calcROC(getQqqCloses(), rocDays ?? 3))
        : (ctx.results.regime?.data.sma20_slope_pct ?? 0);
      const dampingFactor = Math.max(floor, Math.min(ceil, 1 + k * momentumPct));
      boostFactor = 1 + (boostFactor - 1) * dampingFactor;
    }
    raw_weight *= boostFactor;
  }

  const hardRiskMax = ctx.results.hardRisk?.data.max_tqqq_allowed_pct ?? 0.50;
  const rangeBoundOverride = ctx.input.rangeBoundCapOverride;
  const rangeBoundCapMode = rangeBoundOverride === 'scaled' ? 'scaled' : policy?.rangeBoundCapMode ?? p.rangeBoundCapMode;
  const rangeBoundQualityCap = p.rangeBoundQualityCap;
  const rangeBoundQualityScore = [
    (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0,
    (ctx.results.trend?.data.roc20 ?? -Infinity) >= .02,
    (ctx.results.regime?.data.sma20_slope_pct ?? -Infinity) >= 0,
    qqqEr20 >= .20,
  ].filter(Boolean).length;
  const rangeBoundQualityCapActive = regime === 'RANGE_BOUND'
    && rangeBoundQualityCap != null
    && rangeBoundQualityScore >= Math.max(1, Math.floor(rangeBoundQualityCap.minScore ?? 3))
    && (ctx.results.regime?.data.vix ?? Infinity) <= (rangeBoundQualityCap.vixMax ?? 24)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (rangeBoundQualityCap.vixRise5dMax ?? .02)
    && raw_weight < (rangeBoundQualityCap.rawWeightMax ?? Infinity)
    && Number.isFinite(rangeBoundQualityCap.capPct);
  let capped_weight = Math.min(raw_weight, hardRiskMax);
  let regime_adjusted_weight = capped_weight;

  const crisisPhase = ctx.results.regime?.data.crisisPhase;

  // Crisis state machine overrides regime-based weight calculation:
  // CONFIRMED / RECOVERY → weight = 0 (no TQQQ)
  // PENDING              → freeze at current pct (no new buys, allow natural vol-driven reduction)
  // NONE + raw CRISIS    → first bar, treat as PENDING (state machine had no history yet)
  // undefined (legacy)  → old behavior: raw CRISIS immediately → weight = 0
  if (p.regimeTargetVolMode === true) {
    if (crisisPhase === 'CONFIRMED') {
      regime_adjusted_weight = 0;
      warnings.push('CRISIS_CONFIRMED，TQQQ 目标权重归零');
    } else if (crisisPhase === 'RECOVERY') {
      regime_adjusted_weight = 0;
      warnings.push('CRISIS_RECOVERY 冷却期，禁止重新建仓 TQQQ');
    } else if (crisisPhase === 'PENDING' || (crisisPhase === 'NONE' && regime === 'CRISIS')) {
      capped_weight = Math.min(raw_weight, hardRiskMax);
      regime_adjusted_weight = Math.min(capped_weight, currentTqqqPct);
      const label = crisisPhase === 'PENDING' ? 'CRISIS_PENDING（待确认）' : 'CRISIS 首日（状态机初始化）';
      warnings.push(`${label}，冻结持仓至 ${(regime_adjusted_weight * 100).toFixed(1)}%，禁止加仓`);
    } else if (crisisPhase === undefined && regime === 'CRISIS') {
      regime_adjusted_weight = 0;
      warnings.push('Regime=CRISIS，TQQQ 目标权重归零');
    } else if (regime === 'BEAR') {
      const bearFactor = (p.bearRegimeFactor ?? 0.5) * (policy?.bearWeightMultiplier ?? 1);
      regime_adjusted_weight = Math.min(raw_weight * bearFactor, hardRiskMax);
      const discount = `按 ${(bearFactor * 100).toFixed(1)}% 折扣`;
      warnings.push(`Regime=BEAR，TQQQ 目标权重${discount}至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
  } else if (regime === 'RANGE_BOUND') {
    const directionalCap = p.rangeBoundDirectionalCap;
    const priceVsSma200Pct = ctx.results.regime?.data.price_vs_sma200_pct ?? 0;
    const slowSubregime = ctx.input.slowSubregimeFactors?.slow_subregime_state?.value;
    const independentDirectionalCapActive = directionalCap != null
      && directionalCap.independentScoreMin != null
      && independentTargetVolScore >= Math.max(1, Math.floor(directionalCap.independentScoreMin))
      && priceVsSma200Pct >= directionalCap.highThresholdPct
      && (directionalCap.highMaxThresholdPct == null || priceVsSma200Pct <= directionalCap.highMaxThresholdPct)
      && (directionalCap.navDrawdownMaxPct == null || currentNavDrawdownPct <= directionalCap.navDrawdownMaxPct)
      && (directionalCap.slowSubregimeIn == null || directionalCap.slowSubregimeIn.includes(slowSubregime as 'SR01' | 'SR02'))
      && ctx.results.hardRisk?.status === 'PASS'
      && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
      && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
      && ctx.currentFlashCrashState?.active !== true;
    if (rangeBoundQualityCapActive) {
      regime_adjusted_weight = Math.min(raw_weight, rangeBoundQualityCap!.capPct, hardRiskMax);
      warnings.push(`Regime=RANGE_BOUND，质量分${rangeBoundQualityScore}，研究帽 ${(rangeBoundQualityCap!.capPct * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (independentDirectionalCapActive) {
      regime_adjusted_weight = Math.min(capped_weight, directionalCap!.highCapPct);
      warnings.push(`Regime=RANGE_BOUND，独立参与评分${independentTargetVolScore}，独立盘整帽 ${(directionalCap!.highCapPct * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (typeof rangeBoundOverride === 'number') {
        regime_adjusted_weight = Math.min(raw_weight, rangeBoundOverride, hardRiskMax);
        warnings.push(`Regime=RANGE_BOUND，研究帽 ${(rangeBoundOverride * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
      } else if (directionalCap && directionalCap.gatedOnly !== true && priceVsSma200Pct >= directionalCap.highThresholdPct) {
        regime_adjusted_weight = Math.min(raw_weight, directionalCap.highCapPct, hardRiskMax);
        warnings.push(`Regime=RANGE_BOUND，高位盘整上限 ${(directionalCap.highCapPct * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
      } else if (rangeBoundCapMode === 'scaled') {
        const scaledCap = Math.min(Math.max(raw_weight * (0.4 + 0.45 * qqqEr20), 0.10), raw_weight * 0.85);
        regime_adjusted_weight = Math.min(raw_weight, scaledCap, hardRiskMax);
        warnings.push(`Regime=RANGE_BOUND，TQQQ 软上限 ${(scaledCap * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
      } else {
        regime_adjusted_weight = Math.min(raw_weight, 0.10, hardRiskMax);
        warnings.push(`Regime=RANGE_BOUND，TQQQ 上限 10%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
      }
    } else if (regime === 'SIDEWAYS') {
      regime_adjusted_weight = Math.min(raw_weight * sidewaysFactor(ctx, qqqEr20, tqqq_realized_vol_20d), hardRiskMax);
      warnings.push(`Regime=SIDEWAYS，TQQQ 目标权重打折至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (regime === 'RISK_ON_WEAKENING') {
      const factor = riskOnWeakeningFactor(ctx, qqqEr20, tqqq_realized_vol_20d);
      regime_adjusted_weight = Math.min(raw_weight * factor, hardRiskMax);
      warnings.push(`Regime=RISK_ON_WEAKENING，TQQQ 目标权重小幅折扣至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    }
  } else if (crisisPhase === 'CONFIRMED') {
    regime_adjusted_weight = 0;
    warnings.push('CRISIS_CONFIRMED，TQQQ 目标权重归零');
  } else if (crisisPhase === 'RECOVERY') {
    regime_adjusted_weight = 0;
    warnings.push('CRISIS_RECOVERY 冷却期，禁止重新建仓 TQQQ');
  } else if (crisisPhase === 'PENDING' || (crisisPhase === 'NONE' && regime === 'CRISIS')) {
    // Pending: no new buys but hold current position
    regime_adjusted_weight = Math.min(capped_weight, currentTqqqPct);
    const label = crisisPhase === 'PENDING' ? 'CRISIS_PENDING（待确认）' : 'CRISIS 首日（状态机初始化）';
    warnings.push(`${label}，冻结持仓至 ${(regime_adjusted_weight * 100).toFixed(1)}%，禁止加仓`);
  } else if (crisisPhase === undefined && regime === 'CRISIS') {
    // Legacy fallback for live pipeline (no external state)
    regime_adjusted_weight = 0;
    warnings.push('Regime=CRISIS，TQQQ 目标权重归零');
  } else if (regime === 'BEAR') {
    const bearFactor = (p.bearRegimeFactor ?? 0.5) * (policy?.bearWeightMultiplier ?? 1);
    regime_adjusted_weight = capped_weight * bearFactor;
    const discount = `按 ${(bearFactor * 100).toFixed(1)}% 折扣`;
    warnings.push(`Regime=BEAR，TQQQ 目标权重${discount}至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
  } else if (regime === 'RANGE_BOUND') {
    const directionalCap = p.rangeBoundDirectionalCap;
    const priceVsSma200Pct = ctx.results.regime?.data.price_vs_sma200_pct ?? 0;
    if (rangeBoundQualityCapActive) {
      regime_adjusted_weight = Math.min(capped_weight, rangeBoundQualityCap!.capPct);
      warnings.push(`Regime=RANGE_BOUND，质量分${rangeBoundQualityScore}，研究帽 ${(rangeBoundQualityCap!.capPct * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (typeof rangeBoundOverride === 'number') {
      regime_adjusted_weight = Math.min(capped_weight, rangeBoundOverride);
      warnings.push(`Regime=RANGE_BOUND，研究帽 ${(rangeBoundOverride * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (directionalCap && directionalCap.gatedOnly !== true && priceVsSma200Pct >= directionalCap.highThresholdPct) {
      regime_adjusted_weight = Math.min(capped_weight, directionalCap.highCapPct);
      warnings.push(`Regime=RANGE_BOUND，高位盘整上限 ${(directionalCap.highCapPct * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else if (rangeBoundCapMode === 'scaled') {
      const scaledCap = Math.min(Math.max(capped_weight * (0.4 + 0.45 * qqqEr20), 0.10), capped_weight * 0.85);
      regime_adjusted_weight = Math.min(capped_weight, scaledCap);
      warnings.push(`Regime=RANGE_BOUND，TQQQ 软上限 ${(scaledCap * 100).toFixed(1)}%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    } else {
      regime_adjusted_weight = Math.min(capped_weight, 0.10);
      warnings.push(`Regime=RANGE_BOUND，TQQQ 上限 10%，当前目标 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
    }
  } else if (regime === 'SIDEWAYS') {
    regime_adjusted_weight = capped_weight * sidewaysFactor(ctx, qqqEr20, tqqq_realized_vol_20d);
    warnings.push(`Regime=SIDEWAYS，TQQQ 目标权重打折至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
  } else if (regime === 'RISK_ON_WEAKENING') {
    // Mild discount: still bullish (above SMA200, low VIX) but showing short-term weakness
    regime_adjusted_weight = capped_weight * riskOnWeakeningFactor(ctx);
    warnings.push(`Regime=RISK_ON_WEAKENING，TQQQ 目标权重小幅折扣至 ${(regime_adjusted_weight * 100).toFixed(1)}%`);
  }

  const chop = p.chopDampener;
  if (chop && regime && (regime === 'SIDEWAYS' || regime === 'RANGE_BOUND' || regime === 'RISK_ON_WEAKENING')) {
    const threshold = chop.erThreshold ?? 0.25;
    if (threshold > 0 && qqqEr20 < threshold) {
      const minFactor = chop.minWeightFactor ?? 0.75;
      const ratio = Math.max(0, Math.min(1, qqqEr20 / threshold));
      const factor = minFactor + (1 - minFactor) * ratio;
      regime_adjusted_weight *= factor;
      warnings.push(`QQQ ER20=${qqqEr20.toFixed(2)} 低于 ${(threshold).toFixed(2)}，震荡阻尼 ${(factor * 100).toFixed(0)}%`);
    }
  }

  if (regime && (regime === 'SIDEWAYS' || regime === 'RANGE_BOUND' || regime === 'RISK_ON_WEAKENING')) {
    regime_adjusted_weight = Math.min(regime_adjusted_weight * (policy?.chopWeightMultiplier ?? 1), hardRiskMax);
  }

  const slopeCfg = p.slopeSizingFactor;
  if (slopeCfg && regime && regime !== 'CRISIS' && regime !== 'BEAR' &&
    (!slopeCfg.regimes || slopeCfg.regimes.includes(regime))) {
    const sma20SlopePct = ctx.results.regime?.data.sma20_slope_pct ?? 0;
    const factor = Math.max(slopeCfg.floor, Math.min(slopeCfg.ceil, 1 + slopeCfg.k * sma20SlopePct));
    regime_adjusted_weight *= factor;
    warnings.push(`斜率连续因子：sma20斜率=${(sma20SlopePct * 100).toFixed(2)}%，乘数=${factor.toFixed(3)}`);
  }

  const strongBudgetFloorPct = releaseConfig?.strongBudgetFloorPct;
  if (strongTargetVolClean && strongBudgetFloorPct != null && Number.isFinite(strongBudgetFloorPct)) {
    const floor = Math.max(0, Math.min(strongBudgetFloorPct, hardRiskMax));
    if (regime_adjusted_weight < floor) {
      regime_adjusted_weight = floor;
      warnings.push(`clean strong budget floor ${(floor * 100).toFixed(1)}%`);
    }
  }

  // Research-only local participation overlay. Unlike the target-vol budget
  // probe above, this applies after regime/risk adjustments and only changes
  // the final target on the already-qualified independent recovery state.
  const independentTargetWeightMultiplier = p.researchIndependentParticipationTargetWeightMultiplier;
  const independentTargetWeightMinGapPp = p.researchIndependentParticipationTargetWeightMinGapPp ?? 0;
  const independentTargetWeightActive = independentTargetWeightMultiplier != null
    && Number.isFinite(independentTargetWeightMultiplier)
    && independentTargetWeightMultiplier > 1
    && regime != null
    && ['BULL', 'RISK_ON_EXTENDED'].includes(regime)
    && independentTargetVolScore >= independentTargetVolScoreMin
    && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
    && tqqq_realized_vol_20d <= .70
    && currentTqqqPct < .70
    && regime_adjusted_weight - currentTqqqPct >= independentTargetWeightMinGapPp
    && currentNavDrawdownPct <= independentTargetVolNavDrawdownMaxPct
    && ctx.results.hardRisk?.status === 'PASS'
    && (ctx.results.hardRisk.data.constraints?.length ?? 0) === 0
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true;
  if (independentTargetWeightActive) {
    regime_adjusted_weight = Math.min(
      hardRiskMax,
      regime_adjusted_weight * independentTargetWeightMultiplier,
    );
    warnings.push(`independent recovery target overlay ${(independentTargetWeightMultiplier * 100).toFixed(1)}%`);
  }

  if (tqqq_realized_vol_20d === 0) {
    warnings.push('TQQQ 历史不足，无法计算实现波动率，已使用最低 vol floor');
  }

  const status = warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'VolatilityTarget',
    status,
    data: {
      tqqq_realized_vol_20d,
      tqqq_realized_vol_10d: tqqq_realized_vol_10d ?? undefined,
      tqqq_realized_vol_5d: tqqq_realized_vol_5d ?? undefined,
      window_vol: windowVol,
      active_vol: activeVol,
      effective_vol: effectiveVol,
      qqq_er20: qqqEr20,
      target_vol: effectiveTargetVol,
      raw_weight,
      capped_weight,
      regime_adjusted_weight,
    },
    warnings,
    blockers,
  };
}
