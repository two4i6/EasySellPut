/**
 * Promoted EB7.E175 > P6.E218 > R9.E221 contract.
 *
 * The research parents remain the source of truth for the already-audited
 * current-bar predicates. This adapter keeps the production replay entrypoint
 * stable while making the promoted lineage explicit and versioned.
 */
import { p6e218Options } from '../../../../scripts/research/p6-e218-parent-common';
import { BASE as R9_BASE } from '../../../../scripts/research/pcs-rescue-r6-e187-e167-range-p3-contract-20260915';

export const QQQ_EB7_E175_P6_E218_R9_E221_LINEAGE = {
  equityBoost: 'EB7.E175 current-bar',
  pcs: 'P6.E218 current-bar',
  rescue: 'R9.E221 current-bar',
  priority: ['EB7', 'P6', 'R9'],
} as const;

export const QQQ_P6_E218_OPTIONS = p6e218Options;

export const QQQ_R9_E221_OVERRIDES = {
  ...R9_BASE,
  pcsRescueRegimeScope: 'selective_quality_v106_compact_vix13',
  pcsRescueResearchVetoMode: 'r8_e3_er20ge04_roc5ge02_v1',
  pcsRescueResearchWidthMode: 'non_bull_wide_v1',
  pcsRescueResearchWidthPct: .045,
  pcsStreakCooldownTradingDays: 0,
  pcsRescueFillFallbackMode: 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_simplified_v1',
  pcsRescueFillFallbackWidthPct: .03,
  pcsRescueFillFallbackExpirySearchMode: 'nearest_feasible_full_chain_parent_preserving_v1',
  pcsRescueFillFallbackExpandedChainReleaseRoc5Min: .03,
  pcsRescueFillFallbackExpandedChainReleaseEr20Min: .15,
  pcsRescueFillFallbackExpandedChainReleaseMode: 'roc5ge03_or_roc5nonneg_er15_or_vixlow_v1',
  pcsRescueFillFallbackExpandedChainReleaseWeakVixMax: 16,
  pcsRescuePairSearchMode: 'nearest_valid_r9_e88_e447_weakvix_adx_ge24_or_trend_le35_or_bull_lowadx_er08_v1',
  pcsRescueResearchComplementMode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1',
  pcsRescuePromoteOnMainProposal: true,
  pcsRescueDualWithMainProposal: true,
  pcsRescueResearchQualityExtension: 'vixchange5d_02_to_05',
  pcsRescueDualMainQualityGate: 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening2_rsi50_v1',
  pcsRescueDeltaMode: 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt6_term_lt1_9_if_non_bull_sr02_v3',
  pcsRescueFillFallbackAnyStateRoc5Max: 0,
  pcsRescueFillFallbackBullSr01VixReplacementMax: 15.5,
} as const;
