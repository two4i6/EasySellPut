import type { StrategyParams } from '../../types/params';

/** 生产入口共享的宏观默认值；CLI、API 与 UI 由同一 resolver 合并。 */
export const OVERLAY_PRODUCTION_DEFAULTS: Pick<StrategyParams,
  | 'macroRegime'
  | 'crisisPhaseSellExempt'
  | 'pcsTargetDte'
  | 'pcsSpreadWidthPct'
  | 'pcsSurvivalPriceSelectionMode'
  | 'pcsSurvivalSelectionFloor'
  | 'pcsSurvivalSelectionObjective'
  | 'pcsSurvivalSelectionSurvivalWeight'
  | 'pcsSurvivalSelectionWilsonWeight'
  | 'pcsSurvivalSelectionDteMode'
  | 'pcsSurvivalSelectionWidthMode'
  | 'pcsSurvivalSelectionSigmaMode'
  | 'pcsRescueEnabled'
  | 'pcsRescueEntryMode'
  | 'pcsRescueRegimeScope'
  | 'pcsRescueDeltaMode'
  | 'pcsRescueExtremeDelta'
  | 'pcsRescueExtremeBaseDelta'
  | 'pcsRescueExtremeFallbackDelta'
  | 'pcsRescueNormalDelta'
  | 'pcsRescueCalmDelta'
  | 'pcsRescuePressureDelta'
  | 'pcsRescueWidthPct'
  | 'pcsRescueExtremeWidthPct'
  | 'pcsRescueTargetDte'
  | 'pcsRescueRiskBudgetNav'
> = {
  // 2026-07-17 m0b → w7-hybrid：分类器口径均衡最优（退出 28d vs m0b ~30d/W5 44d，翻转 14，
  // 2020 型闪崩进熊 13d vs m0b ~80d）；crisisPhaseSellExempt 死开关回归 ALIVE（w7-econ-grid 报告）；
  // 当前 HEAD 经济行为与 m0b 等价（phase-policy profile 为空 + boost=1 惰性，12-cell |Δ|≤0.44pp）。
  macroRegime: { boostFactor: 1, classifier: 'w7-hybrid' },
  crisisPhaseSellExempt: true,
  // Shared Overlay backtest default: fixed 35 DTE / 2% width, survival-adjusted P&L
  // ranking with 30% Wilson lower-bound floor; only high-pressure states use
  // the dynamic-v1 2.5σ profile, while neutral/calm states search full Sigma.
  pcsTargetDte: 35,
  pcsSpreadWidthPct: 0.02,
  pcsSurvivalPriceSelectionMode: 'survival_only',
  pcsSurvivalSelectionFloor: 0.30,
  pcsSurvivalSelectionObjective: 'survival_adjusted_expected_pnl',
  pcsSurvivalSelectionSurvivalWeight: 0.75,
  pcsSurvivalSelectionWilsonWeight: 0.50,
  pcsSurvivalSelectionDteMode: 'fixed',
  pcsSurvivalSelectionWidthMode: 'fixed',
  pcsSurvivalSelectionSigmaMode: 'stress_only_dynamic_v1',
  // v1.2.6-R：v1.2.6 主 PCS + v14-W3.25 的 PCS_RESCUE；EB 保持独立关闭。
  pcsRescueEnabled: true,
  pcsRescueEntryMode: 'reactive_soft_pool',
  pcsRescueRegimeScope: 'selective_quality_v14',
  pcsRescueDeltaMode: 'state_adaptive_quality_v5',
  pcsRescueExtremeDelta: .2425,
  pcsRescueExtremeBaseDelta: .20,
  pcsRescueExtremeFallbackDelta: .18,
  pcsRescueNormalDelta: .075,
  pcsRescueCalmDelta: .10,
  pcsRescuePressureDelta: .025,
  pcsRescueWidthPct: .02,
  pcsRescueExtremeWidthPct: .0325,
  pcsRescueTargetDte: 35,
  pcsRescueRiskBudgetNav: .005,
};
