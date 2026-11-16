import type { SellerStat } from '../../../analysis/SellerStatsEngine';
import type { PCSSurvivalPriceSelectionMode, PCSSurvivalSelectionObjective } from '../../types/params';

export type PcsSigma = 1 | 1.5 | 2 | 2.5;

export type PcsSurvivalSelectionCandidate = {
  sigma: PcsSigma;
  widthPct?: number;
  baselineCredit?: number;
  shortStrike: number;
  credit: number;
  maxLoss: number;
  survival: SellerStat;
  /** 击穿样本内的条件损失；缺失时条件尾部目标回退到 maxLoss。 */
  tailLoss?: SellerStat;
  tailLossP75?: SellerStat;
  tailLossCvar75?: SellerStat;
  /** 击穿样本内，从 as-of 收盘到未来最低价的条件跌幅。 */
  tailDropPct?: SellerStat;
};

export type PcsPriceSelectionDiagnostic = {
  mode: Exclude<PCSSurvivalPriceSelectionMode, 'off'>;
  objective: PCSSurvivalSelectionObjective;
  survivalWeight: number;
  wilsonWeight: number;
  conditionalLossCapRatio: number | null;
  tailVetoRatio: number | null;
  floor: number;
  candidateCount: number;
  eligibleCandidates: number;
  tailVetoedCandidates: number;
  selectedSigma: PcsSigma;
  selectedWidthPct: number | null;
  selectedNoTouch: number | null;
  selectedNoTouchLower: number | null;
  selectedSurvivalForRanking: number | null;
  selectedConditionalTailLoss: number | null;
  selectedConditionalTailLossP75: number | null;
  selectedConditionalTailLossCvar75: number | null;
  selectedConditionalTailLossRatio: number | null;
  selectedConditionalTailDropPct: number | null;
  selectedObjectiveScore: number;
  creditRetentionFloor: number | null;
  creditVetoedCandidates: number;
};

export function candidateSigmasForPcsSurvivalSelection(
  mode: Exclude<PCSSurvivalPriceSelectionMode, 'off'>,
  baseSigma?: PcsSigma,
): PcsSigma[] {
  if (mode === 'survival_only') return [1, 1.5, 2, 2.5];
  if (baseSigma === 1.5) return [1.5, 2];
  if (baseSigma === 2) return [2, 2.5];
  if (baseSigma === 2.5) return [2.5];
  return [];
}

/**
 * 先过 no-touch Wilson 下限，再按研究目标选约。
 *
 * 旧的 survival_adjusted_expected_pnl 是生存率加权风险效率；
 * survival_adjusted_expected_pnl_v2 使用 credit/maxLoss 之外的实际二元预期 P&L 口径；
 * tail_aware_expected_pnl 使用二元 maxLoss 尾部代理；
 * tail_aware_conditional_expected_pnl 使用历史击穿后的条件损失。credit 是每股报价，maxLoss 是每张合约。
 * tail_aware_conditional_p75/cvar75_expected_pnl 使用条件损失的稳健尾部分位数。
 * constrained_tail_efficiency 先限制 conditionalLoss/maxLoss，再最大化 credit/conditionalLoss。
 */
export function selectPcsSurvivalCandidate(input: {
  mode: Exclude<PCSSurvivalPriceSelectionMode, 'off'>;
  floor: number;
  baseSigma?: PcsSigma;
  candidateSigmas?: readonly PcsSigma[];
  objective?: PCSSurvivalSelectionObjective;
  survivalWeight?: number;
  survivalWilsonWeight?: number;
  baseWidthPct?: number;
  creditRetentionFloor?: number;
  maxConditionalTailLossRatio?: number;
  tailVetoRatio?: number;
  candidates: readonly PcsSurvivalSelectionCandidate[];
}): { selectedIndex: number; diagnostic: PcsPriceSelectionDiagnostic } | null {
  const allowed = new Set(input.candidateSigmas ?? candidateSigmasForPcsSurvivalSelection(input.mode, input.baseSigma));
  const floor = Math.min(1, Math.max(0, input.floor));
  const objective = input.objective ?? 'survival_adjusted_expected_pnl';
  const survivalWeight = objective === 'risk_efficiency'
    ? 0
    : Math.min(1, Math.max(0, input.survivalWeight ?? 1));
  const wilsonWeight = objective === 'risk_efficiency'
    ? 0
    : Math.min(1, Math.max(0, input.survivalWilsonWeight ?? 0));
  const creditRetentionFloor = input.creditRetentionFloor === undefined
    ? null
    : Math.min(1, Math.max(0, input.creditRetentionFloor));
  const conditionalLossCapRatio = objective === 'constrained_tail_efficiency'
    ? Math.min(1, Math.max(0, input.maxConditionalTailLossRatio ?? .75))
    : null;
  const tailVetoRatio = input.tailVetoRatio === undefined
    ? null
    : Math.min(1, Math.max(0, input.tailVetoRatio));
  const baseEligible = input.candidates
    .map((candidate, index) => ({ candidate, index, lower: candidate.survival.interval?.lower ?? null }))
    .filter(({ candidate, lower }) => allowed.has(candidate.sigma)
      && lower !== null
      && lower >= floor
      && candidate.credit > 0
      && candidate.maxLoss > 0
      && Number.isFinite(candidate.credit / candidate.maxLoss)
      && Number.isFinite(candidate.survival.value));
  const creditEligible = creditRetentionFloor === null || input.baseWidthPct === undefined
    ? baseEligible
    : baseEligible.filter(({ candidate }) => {
      const narrower = candidate.widthPct !== undefined && candidate.widthPct < input.baseWidthPct! - 1e-12;
      if (!narrower) return true;
      const baselineCredit = candidate.baselineCredit;
      return baselineCredit !== undefined
        && Number.isFinite(baselineCredit)
        && baselineCredit > 0
        && candidate.credit / baselineCredit >= creditRetentionFloor;
    });
  const vetoEligible = tailVetoRatio === null
    ? creditEligible
    : creditEligible.filter(({ candidate }) => {
      const conditionalLoss = candidate.tailLoss?.value;
      return conditionalLoss !== null && conditionalLoss !== undefined
        && Number.isFinite(conditionalLoss)
        && conditionalLoss >= 0
        && conditionalLoss / candidate.maxLoss <= tailVetoRatio;
    });
  const eligible = objective === 'constrained_tail_efficiency'
    ? vetoEligible.filter(({ candidate }) => {
      const conditionalLoss = candidate.tailLoss?.value;
      return conditionalLoss !== null && conditionalLoss !== undefined
        && Number.isFinite(conditionalLoss)
        && conditionalLoss >= 0
        && conditionalLoss / candidate.maxLoss <= conditionalLossCapRatio!;
    })
    : vetoEligible;
  if (eligible.length === 0) return null;

  const rankedSurvival = (candidate: PcsSurvivalSelectionCandidate) => {
    const point = candidate.survival.value ?? 0;
    const lower = candidate.survival.interval?.lower ?? point;
    return point * (1 - wilsonWeight) + lower * wilsonWeight;
  };

  const score = (candidate: PcsSurvivalSelectionCandidate) => {
    const survival = rankedSurvival(candidate);
    if (objective === 'survival_adjusted_expected_pnl_v2') {
      const adjustedSurvival = 1 - survivalWeight + survivalWeight * survival;
      return candidate.credit * 100 * adjustedSurvival - candidate.maxLoss * (1 - adjustedSurvival);
    }
    if (objective === 'tail_aware_expected_pnl') {
      // credit is quoted per share; maxLoss is already per contract. This is
      // deliberately a no-transaction-cost binary tail-loss proxy.
      return candidate.credit * 100 * survival - candidate.maxLoss * (1 - survival);
    }
    if (objective === 'tail_aware_conditional_expected_pnl') {
      // Conditional loss is measured only after historical intraday breach;
      // missing/insufficient tail samples fail soft to the prior maxLoss proxy.
      const conditionalLoss = candidate.tailLoss?.value ?? candidate.maxLoss;
      return candidate.credit * 100 * survival - conditionalLoss * (1 - survival);
    }
    if (objective === 'tail_aware_conditional_p75_expected_pnl' || objective === 'tail_aware_conditional_cvar75_expected_pnl') {
      const conditionalLoss = objective === 'tail_aware_conditional_p75_expected_pnl'
        ? candidate.tailLossP75?.value ?? candidate.maxLoss
        : candidate.tailLossCvar75?.value ?? candidate.maxLoss;
      return candidate.credit * 100 * survival - conditionalLoss * (1 - survival);
    }
    if (objective === 'constrained_tail_efficiency') {
      const conditionalLoss = candidate.tailLoss?.value;
      return conditionalLoss && conditionalLoss > 0 ? candidate.credit * 100 / conditionalLoss : -Infinity;
    }
    return candidate.credit / candidate.maxLoss
      * (1 - survivalWeight + survivalWeight * survival);
  };

  eligible.sort((left, right) => {
    const objectiveScore = score(right.candidate) - score(left.candidate);
    if (Math.abs(objectiveScore) > 1e-12) return objectiveScore;
    const lower = (right.lower ?? -Infinity) - (left.lower ?? -Infinity);
    if (Math.abs(lower) > 1e-12) return lower;
    const efficiency = right.candidate.credit / right.candidate.maxLoss - left.candidate.credit / left.candidate.maxLoss;
    if (Math.abs(efficiency) > 1e-12) return efficiency;
    return right.candidate.sigma - left.candidate.sigma;
  });

  const selected = eligible[0]!;
  return {
    selectedIndex: selected.index,
    diagnostic: {
      mode: input.mode,
      objective,
      survivalWeight,
      wilsonWeight,
      conditionalLossCapRatio,
      tailVetoRatio,
      floor,
      candidateCount: input.candidates.length,
      eligibleCandidates: eligible.length,
      tailVetoedCandidates: creditEligible.length - vetoEligible.length,
      selectedSigma: selected.candidate.sigma,
      selectedWidthPct: selected.candidate.widthPct ?? null,
      selectedNoTouch: selected.candidate.survival.value,
      selectedNoTouchLower: selected.lower,
      selectedSurvivalForRanking: rankedSurvival(selected.candidate),
      selectedConditionalTailLoss: selected.candidate.tailLoss?.value ?? null,
      selectedConditionalTailLossP75: selected.candidate.tailLossP75?.value ?? null,
      selectedConditionalTailLossCvar75: selected.candidate.tailLossCvar75?.value ?? null,
      selectedConditionalTailLossRatio: selected.candidate.tailLoss?.value != null
        ? selected.candidate.tailLoss.value / selected.candidate.maxLoss
        : null,
      selectedConditionalTailDropPct: selected.candidate.tailDropPct?.value ?? null,
      selectedObjectiveScore: score(selected.candidate),
      creditRetentionFloor,
      creditVetoedCandidates: baseEligible.length - creditEligible.length,
    },
  };
}
