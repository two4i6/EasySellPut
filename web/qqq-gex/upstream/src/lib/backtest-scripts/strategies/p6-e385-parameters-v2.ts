/** Immutable effective P6 contract, shared by policy and source initialization. */
import {freezeStrategyData} from '../strategy-module-v2';
import {stressOnlyPcsSelectionProfile} from '../pcs-selection-v6';
export const P6_E385_LINEAGE = freezeStrategyData(['P5.E213', 'P6.E0', 'P6.E369', 'P6.E385'] as const);
/** Raw-VIX source prerequisite; intentionally distinct from effective VXN selection. */
export const P6_E385_SOURCE_SELECTION=freezeStrategyData({floor:.3,objective:'survival_adjusted_expected_pnl',
  survivalWeight:.75,survivalWilsonWeight:.5} as const);
export const P6_E385_EFFECTIVE_PARAMETERS = freezeStrategyData({
  targetDte: 35, baseWidthPct: .0661, widthBySlowSubregime: { SR01: .11, SR02: .0661 },
  selection: { survivalFloor: .3, survivalWeight: .803, wilsonWeight: .075,
    objective: 'risk_efficiency', objectiveRegime: 'BULL', objectiveSlowSubregime: 'SR01',
    objectiveAdxMin: null, objectiveRv20Min: .38, stressTailVetoRatio: .762,
    stressTailVetoRegime: 'RANGE_BOUND', stressTailVetoSlowSubregime: 'SR01', stressTailVetoRv20Max: .57 },
  exitMode: 'hold_to_expiry', positionMode: 'independent',
} as const);

/** Runtime defaults kept separate so the existing effective/default JSON order
 * and source-initialization parameter shape remain unchanged. */
export const P6_E385_RUNTIME_CONTRACT = freezeStrategyData({
  probeWidths: [P6_E385_EFFECTIVE_PARAMETERS.baseWidthPct, P6_E385_EFFECTIVE_PARAMETERS.widthBySlowSubregime.SR01],
  probeSigmas: stressOnlyPcsSelectionProfile(false).candidateSigmas, riskBudgetNav: .215,
  forceMinimumContract: true, terminalFill: 'sample-close', terminalExit: 'mark-only', cooldownTradingDays: 0,
} as const);

/** Only differences from the declared preset; tests pin the complete resolved spec.
 * Explicit undefined overrides still suppress inherited values. */
export const P6_E385_NATIVE_SOURCE_CONTRACT = freezeStrategyData({
  version:'p6-e385-effective-native-contract-v1',policy:{replayVariant:'v1_2_7_b' as const},
});
export function p6NativeSourceOptions(){
  const p=P6_E385_EFFECTIVE_PARAMETERS;
  return {strategyOverrides:{
    pcsSpreadWidthPct:p.baseWidthPct,pcsV121Gate:false,pcsV123Gate:false,pcsCandidate3ExtraRelease:'bull_sr02_rv_adx' as const,
    pcsSurvivalSelectionSurvivalWeight:p.selection.survivalWeight,pcsSurvivalSelectionWilsonWeight:p.selection.wilsonWeight,
    pcsSurvivalSelectionStressTailVetoRatio:p.selection.stressTailVetoRatio,
    pcsSurvivalSelectionStressTailVetoRegime:p.selection.stressTailVetoRegime,
    pcsSurvivalSelectionStressTailVetoSlowSubregime:p.selection.stressTailVetoSlowSubregime,
    pcsSurvivalSelectionStressTailVetoRv20Max:p.selection.stressTailVetoRv20Max,
    pcsSurvivalSelectionObjective:p.selection.objective,pcsSurvivalSelectionObjectiveRegime:p.selection.objectiveRegime,
    pcsSurvivalSelectionObjectiveSlowSubregime:p.selection.objectiveSlowSubregime,pcsSurvivalSelectionObjectiveAdxMin:undefined,
    pcsSurvivalSelectionObjectiveRv20Min:p.selection.objectiveRv20Min,
    pcsResearchSpreadWidthBySlowSubregime:{...p.widthBySlowSubregime},pcsResearchTimingOverride:'allow' as const,
    pcsResearchProfile:'candidateAResearch' as const,
  }};
}
