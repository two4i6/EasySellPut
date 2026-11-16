import type { MarketRegime, SystemOutput } from '../../types/output';

export type DecisionMemoryState = {
  prevRegime: MarketRegime;
  overheatCollarUsedThisStreak: boolean;
  overheatStreakEntryRegime: MarketRegime;
  daysSinceLastBearExit: number;
  regimeConfirmState: { confirmedRegime: MarketRegime; candidateRegime?: MarketRegime; candidateBars?: number };
  targetWeightSmoothingState?: { smoothedTqqqPct: number };
  flashCrashState?: { active: boolean; cooldownBars: number; triggerDate?: string };
  tailRiskState?: { active: boolean; cooldownBars: number; triggerDate?: string };
  trendParticipationState?: { eligibleStreak: number; active: boolean; activeBars?: number; strongEligibleStreak?: number; strongPartialEligibleStreak?: number; recoveryEligibleStreak?: number };
  trendBudgetRefillState?: { eligibleStreak: number; active: boolean };
  pcsPageSignalStreak: number;
};

export function createDecisionMemoryState(): DecisionMemoryState {
  return {
    prevRegime: 'SIDEWAYS',
    overheatCollarUsedThisStreak: false,
    overheatStreakEntryRegime: 'BULL',
    daysSinceLastBearExit: 999,
    regimeConfirmState: { confirmedRegime: 'SIDEWAYS' },
    pcsPageSignalStreak: 0,
  };
}

/** 仅在决策 bar 完成后更新，供下一次 Pipeline 调用读取。 */
export function updateDecisionMemory(state: DecisionMemoryState, output: SystemOutput, isDecisionBar: boolean): void {
  if (!isDecisionBar) return;
  const pipeline = output.pipeline as Record<string, { data?: Record<string, unknown> }>;
  const currentRegime = output.currentState.regime;
  state.regimeConfirmState = pipeline.regime?.data?.regimeConfirmState as DecisionMemoryState['regimeConfirmState']
    ?? { confirmedRegime: currentRegime };
  state.targetWeightSmoothingState = pipeline.riskBudget?.data?.targetWeightSmoothingState as DecisionMemoryState['targetWeightSmoothingState'];
  state.flashCrashState = pipeline.orderProposal?.data?.flashCrashState as DecisionMemoryState['flashCrashState'];
  state.tailRiskState = (pipeline as unknown as { currentTailRiskState?: DecisionMemoryState['tailRiskState'] }).currentTailRiskState;
  const trendParticipation = pipeline.riskBudget?.data?.trendParticipation as { nextState?: DecisionMemoryState['trendParticipationState'] } | undefined;
  state.trendParticipationState = trendParticipation?.nextState;
  const trendBudgetRefill = pipeline.riskBudget?.data?.trendParticipation as { budgetRefillNextState?: DecisionMemoryState['trendBudgetRefillState'] } | undefined;
  state.trendBudgetRefillState = trendBudgetRefill?.budgetRefillNextState;
  state.pcsPageSignalStreak = pipeline.overlay?.data?.pcsPageSignalRaw === true ? state.pcsPageSignalStreak + 1 : 0;
  if (currentRegime === 'RISK_ON_EXTENDED' && state.prevRegime !== 'RISK_ON_EXTENDED') state.overheatStreakEntryRegime = state.prevRegime;
  if (currentRegime !== 'RISK_ON_EXTENDED') state.overheatCollarUsedThisStreak = false;
  if (state.prevRegime === 'BEAR' || state.prevRegime === 'CRISIS') {
    if (currentRegime !== 'BEAR' && currentRegime !== 'CRISIS') state.daysSinceLastBearExit = 0;
  } else {
    state.daysSinceLastBearExit++;
  }
  state.prevRegime = currentRegime;
}
