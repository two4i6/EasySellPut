import type { FactorMap } from '../../../../../types/factor';
import type { OptionPosition } from '../../types/input';
import type { SystemOutput } from '../../types/output';
import type { OverlayProposal } from '../../types/pipeline';
import type { BacktestTraceEntry, EquityPoint, OptionRiskBudgetTrace, TradeEntry } from '../../backtest/types';

/** Trace 只审计当日决策；历史原始因子保留溯源摘要，避免每个交易日重复整段行情。 */
function compactTraceFactors(factors: FactorMap | undefined): FactorMap | undefined {
  if (!factors) return undefined;
  return Object.fromEntries(Object.entries(factors).map(([id, factor]) => {
    if (!Array.isArray(factor.value)) return [id, factor];
    const last = factor.value.at(-1) as { date?: string } | undefined;
    return [id, {
      ...factor,
      value: { bars: factor.value.length, asOf: last?.date },
      logicReason: `${factor.logicReason ? `${factor.logicReason}；` : ''}trace 仅保留历史摘要`,
    }];
  }));
}

export function buildEquityPoint(input: {
  date: string;
  nav: number;
  allocationNav?: number;
  cash: number;
  tqqqValue: number;
  boxxValue: number;
  tqqqShares: number;
  boxxShares: number;
  output: SystemOutput;
  hasOpenIC: boolean;
  hasOpenCollar: boolean;
  hasOpenCS: boolean;
  hasOpenBearCS: boolean;
  hasOpenEquityBoost: boolean;
  benchmarkPrice: number;
  leveragedPrice: number;
  spyPrice?: number;
  observedMacroRegime?: 'SLOW_BULL' | 'SLOW_BEAR';
  targetVolOverride?: number;
  sidewaysFactorOverride?: number;
  researchSameDayReriskGateAudit?: Record<string, number>;
}): EquityPoint {
  const pipeline = input.output.pipeline as Record<string, { data?: Record<string, unknown> }>;
  const allocationNav = input.allocationNav ?? input.nav;
  return {
    date: input.date,
    nav: input.nav,
    tqqqValue: input.tqqqValue,
    boxxValue: input.boxxValue,
    cashValue: input.cash,
    tqqqPct: allocationNav > 0 ? input.tqqqValue / allocationNav : 0,
    targetTqqqPct: (input.output.proposals as Array<{ kind?: string; executionReasonKey?: string; targetPct?: number }>).find((proposal) => proposal.kind === 'equity' && proposal.executionReasonKey === 'upstream_block' && proposal.targetPct != null)?.targetPct ?? input.output.targetAllocation.tqqqPct,
    boxxPct: allocationNav > 0 ? input.boxxValue / allocationNav : 0,
    tqqqShares: input.tqqqShares,
    boxxShares: input.boxxShares,
    regime: input.output.currentState.regime,
    crisisPhase: input.output.currentState.crisisPhase,
    trend: input.output.currentState.trend,
    systemStatus: input.output.systemStatus,
    hasOpenIC: input.hasOpenIC,
    hasOpenCollar: input.hasOpenCollar,
    hasOpenCS: input.hasOpenCS,
    hasOpenBearCS: input.hasOpenBearCS,
    hasOpenEquityBoost: input.hasOpenEquityBoost,
    benchmarkPrice: input.benchmarkPrice,
    leveragedPrice: input.leveragedPrice,
    qqqPrice: input.benchmarkPrice,
    spyPrice: input.spyPrice,
    stockPolicyId: input.output.stockPolicyId,
    stockPolicyActive: input.output.reasonKeys?.some(key => key.endsWith('_active')),
    marketContext: input.observedMacroRegime ? { ...input.output.currentState, macroRegime: input.observedMacroRegime } : input.output.currentState,
    researchEquityProposals: input.output.proposals
      .filter((proposal) => proposal.kind === 'equity')
      .map((proposal) => ({
        symbol: proposal.symbol,
        side: proposal.side,
        quantity: proposal.quantity,
        targetPct: 'targetPct' in proposal && typeof proposal.targetPct === 'number' ? proposal.targetPct : undefined,
        executionReasonKey: proposal.executionReasonKey,
      })),
    researchSameDayReriskGateAudit: input.researchSameDayReriskGateAudit,
    bindingConstraint: pipeline.riskBudget?.data?.binding_constraint as string | undefined,
    regAdjWt: pipeline.volTarget?.data?.regime_adjusted_weight as number | undefined,
    recoveryBoostAppliedPct: pipeline.riskBudget?.data?.recoveryBoostAppliedPct as number | undefined,
    targetVolOverride: input.targetVolOverride,
    sidewaysFactorOverride: input.sidewaysFactorOverride,
    pipeline,
  };
}

export function buildTraceEntry(input: {
  date: string;
  nav: number;
  cash: number;
  tqqqShares: number;
  tqqqValue: number;
  boxxShares: number;
  boxxValue: number;
  optionPositions: OptionPosition[];
  output: SystemOutput;
  optionProposals?: readonly OverlayProposal[];
  optionRiskBudget?: OptionRiskBudgetTrace;
  trades: TradeEntry[];
}): BacktestTraceEntry {
  const overlayData = (input.output.pipeline as Record<string, { data?: { indicatorFactors?: FactorMap; bearFactors?: FactorMap } }>).overlay?.data;
  return {
    date: input.date,
    nav: input.nav,
    cash: input.cash,
    tqqqShares: input.tqqqShares,
    tqqqValue: input.tqqqValue,
    boxxShares: input.boxxShares,
    boxxValue: input.boxxValue,
    optionPositions: input.optionPositions.map(position => ({ ...position })),
    factors: compactTraceFactors(overlayData?.indicatorFactors ?? overlayData?.bearFactors),
    marketState: input.output.currentState,
    overlay: input.output.overlay,
    optionProposals: input.optionProposals ?? input.output.overlay.overlayProposals ?? (input.output.overlay.action !== 'NONE' ? [input.output.overlay] : []),
    optionRiskBudget: input.optionRiskBudget && {
      ...input.optionRiskBudget,
      attempts: input.optionRiskBudget.attempts.map(attempt => ({ ...attempt })),
    },
    candidateActions: input.output.proposals.map(proposal => proposal.kind === 'option' ? proposal.strategyTag ?? proposal.rationale : `${proposal.side} ${proposal.symbol}`),
    blockers: [...input.output.blockers],
    warnings: [...input.output.warnings],
    trades: input.trades,
  };
}
