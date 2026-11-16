import type { SellerStat } from '../../../analysis/SellerStatsEngine';
import type { CSSurvivalSelectionWidthMode, PCSSurvivalSelectionObjective } from '../../types/params';

export type CsWidthPct = .01 | .015 | .02 | .025 | .03;
export type CsPcsDynamicDistanceSigma = 1.5 | 2 | 2.5;

export type CsSurvivalSelectionCandidate = {
  distanceSigma: number;
  shortDelta: number;
  widthPct: number;
  shortStrike: number;
  longStrike: number;
  credit: number;
  maxLoss: number;
  survival: SellerStat;
  /** PCS-CS 组合路径的每组预期 P&L 代理；仅研究排序消费。 */
  portfolioScore?: number;
  tailLoss?: SellerStat;
  tailLossP75?: SellerStat;
  tailLossCvar75?: SellerStat;
};

export type CsSurvivalSelectionDiagnostic = {
  mode: 'survival_only';
  objective: PCSSurvivalSelectionObjective;
  survivalWeight: number;
  wilsonWeight: number;
  floor: number;
  widthMode: CSSurvivalSelectionWidthMode;
  candidateCount: number;
  eligibleCandidates: number;
  tailVetoRatio: number | null;
  tailVetoedCandidates: number;
  creditRetentionFloor: number | null;
  creditVetoedCandidates: number;
  switchMargin: number | null;
  minSurvivalLift: number | null;
  switchGuardedCandidates: number;
  switchGuardFallback: boolean;
  selectedDistanceSigma: number;
  selectedShortDelta: number;
  selectedWidthPct: number;
  selectedNoTouch: number | null;
  selectedNoTouchLower: number | null;
  selectedSurvivalForRanking: number | null;
  selectedConditionalTailLoss: number | null;
  selectedConditionalTailLossP75: number | null;
  selectedConditionalTailLossCvar75: number | null;
  selectedPortfolioScore: number | null;
  selectedObjectiveScore: number;
};

export function candidateShortDeltasForCsSurvivalSelection(maxShortDelta?: number): number[] {
  return [.10, .15, .20, .25].filter((delta) => maxShortDelta === undefined || delta <= maxShortDelta);
}

/**
 * 复用 PCS 当前“仅高压 dynamic-v1、其余状态全 Sigma 排序”的口径。
 * CS 用 Delta 表示距离：高压只保留最远 .10Δ，其余状态仍保留原有全距离候选。
 */
export function candidateShortDeltasForCsPcsDynamicDistance(sigma: CsPcsDynamicDistanceSigma, baseShortDelta?: number): number[] {
  if (sigma === 2.5) return [.10];
  return candidateShortDeltasForCsSurvivalSelection(baseShortDelta);
}

export function candidateWidthsForCsSurvivalSelection(mode: CSSurvivalSelectionWidthMode, baseWidthPct: number): number[] {
  if (mode === 'fixed') return [baseWidthPct];
  return [.015, .02, .025, .03];
}

/** Research-only width candidates for a quote-aware, risk-efficiency-ranked coverage replacement. */
export function candidateWidthsForCsRiskEfficiencySearch(baseWidthPct: number, preCrisis = false): number[] {
  if (preCrisis) return [baseWidthPct];
  return [...new Set([.03, .06, baseWidthPct])].sort((left, right) => left - right);
}

/**
 * 高胜率覆盖层专用排序：先满足 Wilson 生存率下限，再按 Wilson 下限、距离、定义风险排序。
 * 不读取信用金，也不把预期 P&L 作为第一目标；收益只作为最终稳定排序的最后一项。
 */
export function selectCsHighWinCoverageCandidate(input: {
  floor: number;
  objective?: PCSSurvivalSelectionObjective;
  candidates: readonly CsSurvivalSelectionCandidate[];
}): { selectedIndex: number; diagnostic: CsSurvivalSelectionDiagnostic } | null {
  const floor = Math.min(1, Math.max(0, input.floor));
  const objective = input.objective ?? 'survival_priority';
  const eligible = input.candidates
    .map((candidate, index) => ({ candidate, index, lower: candidate.survival.interval?.lower ?? null }))
    .filter(({ candidate, lower }) => lower !== null
      && lower >= floor
      && candidate.credit > 0
      && candidate.maxLoss > 0
      && Number.isFinite(candidate.distanceSigma)
      && Number.isFinite(candidate.survival.value));
  if (eligible.length === 0) return null;

  const score = (candidate: CsSurvivalSelectionCandidate): number => {
    const lower = candidate.survival.interval?.lower ?? candidate.survival.value ?? 0;
    const survival = (candidate.survival.value ?? 0) * .5 + lower * .5;
    if (objective === 'survival_priority') return survival;
    if (objective === 'constrained_tail_efficiency' || objective === 'risk_efficiency') {
      return candidate.credit / candidate.maxLoss * survival;
    }
    // Coverage candidates do not carry an independent conditional-tail series;
    // use defined risk as the conservative tail proxy, matching the generic CS
    // survival-adjusted expected-P&L selector.
    return candidate.credit * 100 * survival - candidate.maxLoss * (1 - survival);
  };
  if (objective === 'survival_priority') {
    eligible.sort((left, right) => {
      const lowerDiff = (right.lower ?? -Infinity) - (left.lower ?? -Infinity);
      if (Math.abs(lowerDiff) > 1e-12) return lowerDiff;
      const distanceDiff = right.candidate.distanceSigma - left.candidate.distanceSigma;
      if (Math.abs(distanceDiff) > 1e-12) return distanceDiff;
      const riskDiff = left.candidate.maxLoss - right.candidate.maxLoss;
      if (Math.abs(riskDiff) > 1e-12) return riskDiff;
      return right.candidate.credit - left.candidate.credit;
    });
  } else {
    eligible.sort((left, right) => {
      const scoreDiff = score(right.candidate) - score(left.candidate);
      if (Math.abs(scoreDiff) > 1e-12) return scoreDiff;
      const lowerDiff = (right.lower ?? -Infinity) - (left.lower ?? -Infinity);
      if (Math.abs(lowerDiff) > 1e-12) return lowerDiff;
      const efficiency = right.candidate.credit / right.candidate.maxLoss - left.candidate.credit / left.candidate.maxLoss;
      if (Math.abs(efficiency) > 1e-12) return efficiency;
      return right.candidate.distanceSigma - left.candidate.distanceSigma;
    });
  }
  const selectedCandidate = eligible[0]!;
  const selectedLower = selectedCandidate.lower;
  const selectedRankedSurvival = (selectedCandidate.candidate.survival.value ?? 0) * .5 + (selectedLower ?? 0) * .5;
  return {
    selectedIndex: selectedCandidate.index,
    diagnostic: {
      mode: 'survival_only',
      objective,
      survivalWeight: 1,
      wilsonWeight: .5,
      floor,
      widthMode: 'fixed',
      candidateCount: input.candidates.length,
      eligibleCandidates: eligible.length,
      tailVetoRatio: null,
      tailVetoedCandidates: 0,
      creditRetentionFloor: null,
      creditVetoedCandidates: 0,
      switchMargin: null,
      minSurvivalLift: null,
      switchGuardedCandidates: 0,
      switchGuardFallback: false,
      selectedDistanceSigma: selectedCandidate.candidate.distanceSigma,
      selectedShortDelta: selectedCandidate.candidate.shortDelta,
      selectedWidthPct: selectedCandidate.candidate.widthPct,
      selectedNoTouch: selectedCandidate.candidate.survival.value,
      selectedNoTouchLower: selectedLower,
      selectedSurvivalForRanking: selectedRankedSurvival,
      selectedConditionalTailLoss: selectedCandidate.candidate.tailLoss?.value ?? null,
      selectedConditionalTailLossP75: selectedCandidate.candidate.tailLossP75?.value ?? null,
      selectedConditionalTailLossCvar75: selectedCandidate.candidate.tailLossCvar75?.value ?? null,
      selectedPortfolioScore: selectedCandidate.candidate.portfolioScore ?? null,
      selectedObjectiveScore: score(selectedCandidate.candidate),
    },
  };
}

/**
 * CS 侧沿用 CSP 的结构：先过短腿生存率 Wilson 下限，再对“距离 × 宽度”联合候选排序。
 * 生存率和条件尾损只评价价差质量，不参与市场时机门；缺少有效候选时 fail-closed。
 */
export function selectCsSurvivalCandidate(input: {
  floor: number;
  objective?: PCSSurvivalSelectionObjective;
  survivalWeight?: number;
  survivalWilsonWeight?: number;
  widthMode?: CSSurvivalSelectionWidthMode;
  baselineCredit?: number;
  creditRetentionFloor?: number;
  tailVetoRatio?: number;
  baselineIndex?: number;
  switchMargin?: number;
  minSurvivalLift?: number;
  portfolioScoreWeight?: number;
  candidates: readonly CsSurvivalSelectionCandidate[];
}): { selectedIndex: number; diagnostic: CsSurvivalSelectionDiagnostic } | null {
  const floor = Math.min(1, Math.max(0, input.floor));
  const objective = input.objective ?? 'survival_adjusted_expected_pnl';
  const survivalWeight = Math.min(1, Math.max(0, input.survivalWeight ?? 1));
  const wilsonWeight = Math.min(1, Math.max(0, input.survivalWilsonWeight ?? 0));
  const portfolioScoreWeight = Math.min(1, Math.max(0, input.portfolioScoreWeight ?? 0));
  const widthMode = input.widthMode ?? 'full';
  const baseEligible = input.candidates
    .map((candidate, index) => ({ candidate, index, lower: candidate.survival.interval?.lower ?? null }))
    .filter(({ candidate, lower }) => lower !== null
      && lower >= floor
      && candidate.credit > 0
      && candidate.maxLoss > 0
      && Number.isFinite(candidate.credit / candidate.maxLoss)
      && Number.isFinite(candidate.survival.value));
  const requestedCreditFloor = input.creditRetentionFloor;
  const creditRetentionFloor = requestedCreditFloor === undefined
    ? null
    : Math.min(1, Math.max(0, requestedCreditFloor));
  const minimumCredit = creditRetentionFloor !== null
    && Number.isFinite(input.baselineCredit)
    && input.baselineCredit! > 0
    ? input.baselineCredit! * creditRetentionFloor
    : null;
  const eligible = minimumCredit === null
    ? baseEligible
    : baseEligible.filter(({ candidate }) => candidate.credit + 1e-12 >= minimumCredit);
  const creditVetoedCandidates = baseEligible.length - eligible.length;
  const requestedTailVetoRatio = input.tailVetoRatio;
  const tailVetoRatio = requestedTailVetoRatio === undefined
    ? null
    : Math.min(1, Math.max(0, requestedTailVetoRatio));
  const tailEligible = tailVetoRatio === null
    ? eligible
    : eligible.filter(({ candidate }) => {
      const conditionalLoss = candidate.tailLoss?.value;
      return conditionalLoss !== null
        && conditionalLoss !== undefined
        && Number.isFinite(conditionalLoss)
        && conditionalLoss >= 0
        && conditionalLoss / candidate.maxLoss <= tailVetoRatio;
    });
  const tailVetoedCandidates = eligible.length - tailEligible.length;
  if (tailEligible.length === 0) return null;
  const switchMargin = input.switchMargin === undefined
    ? null
    : Math.min(1, Math.max(0, input.switchMargin));
  const minSurvivalLift = input.minSurvivalLift === undefined
    ? null
    : Math.min(1, Math.max(0, input.minSurvivalLift));

  const rankedSurvival = (candidate: CsSurvivalSelectionCandidate) => {
    const point = candidate.survival.value ?? 0;
    const lower = candidate.survival.interval?.lower ?? point;
    return point * (1 - wilsonWeight) + lower * wilsonWeight;
  };

  const score = (candidate: CsSurvivalSelectionCandidate) => {
    const survival = rankedSurvival(candidate);
    const portfolioScore = candidate.portfolioScore ?? 0;
    const portfolioAdjustment = portfolioScoreWeight * portfolioScore;
    if (objective === 'survival_priority') return survival + portfolioAdjustment;
    if (objective === 'survival_adjusted_expected_pnl') {
      const grossCredit = candidate.credit * 100;
      const expectedPnl = grossCredit * survival - candidate.maxLoss * (1 - survival);
      // survivalWeight=0 保留纯信用金排序；survivalWeight=1 才是完整的路径预期 P&L。
      return grossCredit * (1 - survivalWeight) + expectedPnl * survivalWeight + portfolioAdjustment;
    }
    if (objective === 'tail_aware_expected_pnl') {
      return candidate.credit * 100 * survival - candidate.maxLoss * (1 - survival) + portfolioAdjustment;
    }
    if (objective === 'tail_aware_conditional_expected_pnl') {
      const conditionalLoss = candidate.tailLoss?.value ?? candidate.maxLoss;
      return candidate.credit * 100 * survival - conditionalLoss * (1 - survival) + portfolioAdjustment;
    }
    if (objective === 'tail_aware_conditional_p75_expected_pnl' || objective === 'tail_aware_conditional_cvar75_expected_pnl') {
      const conditionalLoss = objective === 'tail_aware_conditional_p75_expected_pnl'
        ? candidate.tailLossP75?.value ?? candidate.maxLoss
        : candidate.tailLossCvar75?.value ?? candidate.maxLoss;
      return candidate.credit * 100 * survival - conditionalLoss * (1 - survival) + portfolioAdjustment;
    }
    if (objective === 'constrained_tail_efficiency') {
      const conditionalLoss = candidate.tailLoss?.value;
      return conditionalLoss && conditionalLoss > 0 ? candidate.credit * 100 / conditionalLoss + portfolioAdjustment : -Infinity;
    }
    return candidate.credit / candidate.maxLoss * (1 - survivalWeight + survivalWeight * survival) + portfolioAdjustment;
  };

  const baselineCandidate = input.baselineIndex === undefined ? undefined : input.candidates[input.baselineIndex];
  const baselineScore = baselineCandidate ? score(baselineCandidate) : null;
  const baselineSurvival = baselineCandidate ? rankedSurvival(baselineCandidate) : null;
  const switchGuardEnabled = (switchMargin !== null || minSurvivalLift !== null)
    && baselineCandidate !== undefined
    && baselineScore !== null
    && Number.isFinite(baselineScore);
  const scoreThreshold = baselineScore !== null && baselineScore >= 0
    ? baselineScore * (1 + (switchMargin ?? 0))
    : baselineScore !== null
      ? baselineScore + Math.abs(baselineScore) * (switchMargin ?? 0)
      : null;
  const switchEligible = switchGuardEnabled
    ? tailEligible.filter(({ candidate, index }) => index === input.baselineIndex || (
      scoreThreshold !== null
      && score(candidate) >= scoreThreshold
      && (minSurvivalLift === null || baselineSurvival === null || rankedSurvival(candidate) >= baselineSurvival + minSurvivalLift)
    ))
    : tailEligible;
  const switchGuardedCandidates = tailEligible.length - switchEligible.length;
  const switchGuardFallback = switchGuardEnabled && switchEligible.length === 0 && baselineCandidate !== undefined;
  const baselineEntry = baselineCandidate && input.baselineIndex !== undefined
    ? { candidate: baselineCandidate, index: input.baselineIndex, lower: baselineCandidate.survival.interval?.lower ?? null }
    : null;
  const rankable = switchEligible.length > 0
    ? switchEligible
    : switchGuardFallback && baselineEntry
      ? [baselineEntry]
      : [];
  if (rankable.length === 0) return null;

  rankable.sort((left, right) => {
    const scoreDiff = score(right.candidate) - score(left.candidate);
    if (Math.abs(scoreDiff) > 1e-12) return scoreDiff;
    const lowerDiff = (right.lower ?? -Infinity) - (left.lower ?? -Infinity);
    if (Math.abs(lowerDiff) > 1e-12) return lowerDiff;
    const efficiency = right.candidate.credit / right.candidate.maxLoss - left.candidate.credit / left.candidate.maxLoss;
    if (Math.abs(efficiency) > 1e-12) return efficiency;
    return right.candidate.distanceSigma - left.candidate.distanceSigma;
  });

  const selected = rankable[0]!;
  return {
    selectedIndex: selected.index,
    diagnostic: {
      mode: 'survival_only', objective, survivalWeight, wilsonWeight, floor, widthMode,
      candidateCount: input.candidates.length,
      eligibleCandidates: tailEligible.length,
      tailVetoRatio,
      tailVetoedCandidates,
      creditRetentionFloor,
      creditVetoedCandidates,
      switchMargin,
      minSurvivalLift,
      switchGuardedCandidates,
      switchGuardFallback,
      selectedDistanceSigma: selected.candidate.distanceSigma,
      selectedShortDelta: selected.candidate.shortDelta,
      selectedWidthPct: selected.candidate.widthPct,
      selectedNoTouch: selected.candidate.survival.value,
      selectedNoTouchLower: selected.lower,
      selectedSurvivalForRanking: rankedSurvival(selected.candidate),
      selectedConditionalTailLoss: selected.candidate.tailLoss?.value ?? null,
      selectedConditionalTailLossP75: selected.candidate.tailLossP75?.value ?? null,
      selectedConditionalTailLossCvar75: selected.candidate.tailLossCvar75?.value ?? null,
      selectedPortfolioScore: selected.candidate.portfolioScore ?? null,
      selectedObjectiveScore: score(selected.candidate),
    },
  };
}
