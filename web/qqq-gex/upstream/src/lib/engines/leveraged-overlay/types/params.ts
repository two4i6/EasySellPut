import type { MarketRegime } from './output';

// 'reactive'    = 现有逻辑（等 BEAR 确认）
// 'early'       = A：SIDEWAYS 即触发，绕过上游 BLOCK
// 'overheat'    = 只在 RISK_ON_EXTENDED 极度过热但趋势未破时触发
// 'weakening'   = 只在 RISK_ON_WEAKENING 牛市转弱但趋势未破时触发
// 'top_protect' = 两层顶部保护：RISK_ON_EXTENDED（过热层）+ RISK_ON_WEAKENING（转弱层）顺序覆盖
// 'always'      = B：TQQQ > maxTqqqWarnPct 时常态持仓，无 regime 条件
export type CollarMode = 'reactive' | 'early' | 'overheat' | 'weakening' | 'top_protect' | 'always';

// 'reactive'   = 牛市 + VIX < 15 + ROC20 > 20%（严格）
// 'strict_recovery' = 严格 + RISK_ON_WEAKENING 转弱修复补仓（需 VIX<15、QQQ ROC5>0、TQQQ ROC20>10%、仅有 Put Spread Protection）
// 'overbought' = 牛市 + ROC20 > 20%（去掉 VIX 低位要求）
// 'bull'       = 牛市 + VIX < 20（无需超买，持续卖 Call Spread）
// 'extreme'    = RISK_ON_EXTENDED：极度过热但趋势未破，优先用定义风险 Call Spread，不开 Collar
// 'sp_like'    = PCS 风格频率臂：VIX 14-20 + RISK_ON 家族/转弱，仍拒绝期限倒挂与价格过度延伸
// 'sp_like_dynamic' = SP-like 入口 + 按 VIX/状态切换短 Call Delta
export type CSMode = 'reactive' | 'strict_recovery' | 'overbought' | 'bull' | 'extreme' | 'sp_like' | 'sp_like_dynamic';
export type CSProfitTakeMode = 'fixed' | 'conditional';
export type CSDeltaStopMode = 'fixed' | 'stateful';
/** CS 开仓时的 SR 路径风险闸。V2.1 生产 profile 使用高后验 BULL/SR02 阻断。 */
export type CSResearchEntryGate = 'off' | 'posterior_below_70' | 'posterior_below_70_or_weak_persistence_5' | 'posterior_below_70_and_weak_persistence_5' | 'posterior_below_70_or_weak_persistence_5_vxn_rising' | 'posterior_below_70_or_weak_persistence_7' | 'posterior_below_70_or_weak_persistence_5_posterior_below_80' | 'posterior_below_70_or_weak_persistence_5_exclude_range_bound' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_and_bull_sr02' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_bull_sr02_80' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_bull_sr02_90' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_sr02_riskon_80' | 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_sr02_riskon_90';
/** CS 研究尾部入场闸；candidate4_six_factor 是 CCS v2.3 的生产口径。 */
export type CSTailEntryGate = 'off' | 'vix19_or_adx35' | 'vix19_or_adx35_or_bull_conflict' | 'vix19_or_adx35_or_bull_conflict_or_pullback' | 'candidate4_six_factor' | 'candidate4_six_factor_bull_lowvix_weak_extension';
/** CS 研究门的选择性释放；默认 off，避免未经回测改变现有准入。 */
export type CSResearchEntryReleaseMode = 'off' | 'balanced_l1ab_without_v11' | 'balanced_l1ab_without_v11_precrisis_quality' | 'balanced_l1ab_without_v11_precrisis_tail_intersection' | 'bull_vix_19_band_quality' | 'bull_sr02_highposterior_vix19_band_quality' | 'bull_sr02_vix_band_quality' | 'sr02_vix_band_quality' | 'sr02_vix_price_quality' | 'bull_vix_falling_quality';
/** CCS v2.3 候选9的 MDD-A-S 硬阻断；off 保持历史 profile。 */
export type CSCandidate9MddEntryGate = 'off' | 'range_bound_sr01_drawdown_vix_roc20';
/** CCS v2.3 候选9的核心融合释放；off 保持历史 profile。 */
export type CSCandidate9CoreFusionReleaseMode = 'off' | 'extension_nonnegative_vix_rising_sr01';
/** CCS v2.4：把滚动验证通过的 Safe-FK 释放联合，并叠加慢 VIX 释放。 */
export type CSValidatedSafeReleaseMode = 'off' | 'validated_safe_fk_union' | 'validated_safe_fk_union_slow_vix';
/** 研究专用：仅对已有正向 MFE 且仍处于可控浮亏的 CS，选择性延后 Delta-stop。 */
export type CSMfeRescueMode = 'off' | 'positive_mfe_near_stop';
/** 研究专用：状态转入 RISK_ON_EXTENDED 后，测试一次持仓内止损确认延迟。默认关闭。 */
export type CSTransitionExitMode = 'off' | 'confirm_extended_transition' | 'rescue_extended_transition';
/** 研究专用：仅在指定状态使用窄 CS 宽度，其余状态保持基准宽度。 */
export type CSConditionalWidthMode = 'off' | 'bull_sr02' | 'range_sr02' | 'bull_or_range_sr02' | 'range_sr02_vix_lt_19' | 'range_sr02_vix_lt_18_5' | 'range_sr02_rv_lt_50' | 'range_sr02_vix_lt_19_rv_lt_50' | 'range_sr02_extension_lt_neg1' | 'range_sr02_extension_lt_neg2' | 'range_sr02_extension' | 'range_or_weakening_sr02_extension' | 'extension_lt_neg1_all' | 'range_sr01_extension';
export type CSDaysHeldExitRegimeScope = 'all' | 'bull' | 'risk_on_weakening' | 'risk_on_extended' | 'bull_or_risk_on_weakening';

/** CS V2.1 基线；保留用于历史回放的可复现对照组。 */
export const CS_V21_PRODUCTION_VERSION = 'V2.1' as const;
export const CS_V21_PRODUCTION_PROFILE = {
  csResearchEntryGate: 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_bull_sr02_90' as const,
  csMode: 'sp_like_dynamic' as const,
  csProfitTakeEnabled: true,
  csProfitTarget: .75,
  csProfitTakeMode: 'conditional' as const,
  csConditionalProfitTakeMaxDte: 14,
  csTargetDte: 21,
  csSpreadWidthPct: .025,
  csSpLikeDynamicCalmVix: 18,
  csSpLikeDynamicCalmRoc20: .20,
  csSpLikeDynamicCalmExtensionGate: 3,
  csDeltaStopThreshold: .45,
  csDeltaStopMode: 'stateful' as const,
  csDeltaStopCalmVix: 18,
  csDeltaStopRiskVix: 20,
  csDeltaStopCalmRoc20: .20,
  csDeltaStopCalmThreshold: .40,
  csDeltaStopRiskThreshold: .36,
} as const;

/** V2.1.1：保持 V2.1 入场、选腿与退出规则，仅在 VXN rescue 条件下放大名义仓位 1.25 倍。 */
export const CS_V21_1_PRODUCTION_VERSION = 'V2.1.1' as const;
export const CS_V21_1_PRODUCTION_PROFILE = {
  ...CS_V21_PRODUCTION_PROFILE,
  csVxnRescueSizeMultiplier: 1.25,
} as const;

/** CCS v2.3：候选9（候选8 + 核心融合释放）的生产 profile。 */
export const CS_V23_PRODUCTION_VERSION = 'V2.3' as const;
export const CS_V23_PRODUCTION_PROFILE = {
  ...CS_V21_PRODUCTION_PROFILE,
  csResearchEntryReleaseMode: 'balanced_l1ab_without_v11' as const,
  csTailEntryGate: 'candidate4_six_factor' as const,
  csCandidate9MddEntryGate: 'range_bound_sr01_drawdown_vix_roc20' as const,
  csCandidate9CoreFusionReleaseMode: 'extension_nonnegative_vix_rising_sr01' as const,
  csSpLikeDynamicCalmVix: 17.8,
  csSpLikeDynamicCalmDelta: .17,
  csSpreadWidthPct: .026,
  csDeltaStopCalmThreshold: .45,
  csResearchDaysHeldExitMode: 'risk_threshold' as const,
  csResearchDaysHeldExitMin: 8,
  csResearchDaysHeldExitMax: 10,
  csResearchDaysHeldRiskThreshold: .40,
  csPreCrisisVixMax: 20,
  csPreCrisisTqqqRv20Min: .42,
  csPreCrisisTqqqRoc20Max: .15,
  csPreCrisisEventScope: 'sr01_weakening_or_sr02_bull' as const,
  csPreCrisisMaxEntriesInWindow: 1,
  csPreCrisisWindowTradingDays: 5,
} as const;

/** CCS v2.4：v2.3 + Validated Safe-FK Union + Slow-VIX Releases。 */
export const CS_V24_PRODUCTION_VERSION = 'V2.4' as const;
export const CS_V24_PRODUCTION_PROFILE = {
  ...CS_V23_PRODUCTION_PROFILE,
  csValidatedSafeReleaseMode: 'validated_safe_fk_union_slow_vix' as const,
  csValidatedSafeVixPointThreshold: 1.5,
  csValidatedSafeVixHorizon: 5 as const,
  csSpLikeVixHigh: 21,
} as const;

/** CCS v2.5：WR-9；在 v2.4 基础上合并已验证的质量释放、风险护栏、慢趋势短腿与 4% 宽度参数。 */
export const CS_V25_PRODUCTION_VERSION = 'V2.5' as const;
export const CS_V25_PRODUCTION_PROFILE = {
  ...CS_V24_PRODUCTION_PROFILE,
  csPreCrisisCapReleaseMode: 'second_entry_quality_v1' as const,
  csResearchRiskGuardMode: 'vix_rising' as const,
  csResearchRiskGuardThreshold: .47,
  csDeltaStopCalmThreshold: .60,
  csDeltaStopRiskVix: 20,
  csDeltaStopCalmVix: 16,
  csDeltaStopCalmRoc20: .18,
  csSpLikeDynamicCalmVix: 19,
  csSpLikeVixHigh: 22,
  csSlopeShortLegMode: 'slow_trend_v1' as const,
  csSlopeShortLegFastDelta: .11,
  csSlopeShortLegSlowDelta: .12,
  csSpreadWidthPct: .040,
} as const;

/** CCS v2.6：WR-89 Compact Controller-v1。 */
export const CS_V26_PRODUCTION_VERSION = 'V2.6' as const;
export const CS_V26_PRODUCTION_PROFILE = {
  ...CS_V25_PRODUCTION_PROFILE,
  csTransitionRiskMode: 'score4_all4_d10_w05' as const,
  csResearchDeltaStopRescueMode: 'vix_falling_weak' as const,
  csResearchDeltaStopRescueMinDaysLeft: 8,
  csWr89CompactController: true,
  csWr89CooldownOpportunities: 4,
  csProfitTarget: .765,
} as const;

/** WR-90：WR-89 causal Transition-Risk Conditional Gate。显式研究 profile，不是默认。 */
export const CS_WR90_RESEARCH_VERSION = 'WR-90' as const;
export const CS_WR90_RESEARCH_PROFILE = {
  ...CS_V26_PRODUCTION_PROFILE,
  csTransitionConditionalGate: true,
  csTransitionConditionalCreditMax: 40,
  csTransitionConditionalRvMin: .45,
  csTransitionConditionalRvMax: .60,
} as const;

/** WR-91：同一条件门的 balanced credit 边界；显式研究 profile，不是默认。 */
export const CS_WR91_RESEARCH_VERSION = 'WR-91' as const;
export const CS_WR91_RESEARCH_PROFILE = {
  ...CS_WR90_RESEARCH_PROFILE,
  csTransitionConditionalCreditMax: 35,
} as const;

/** WR-93：WR-91 + conditional take-profit max DTE 10；显式研究 profile，不是默认。 */
export const CS_WR93_RESEARCH_VERSION = 'WR-93' as const;
export const CS_WR93_RESEARCH_PROFILE = {
  ...CS_WR91_RESEARCH_PROFILE,
  csConditionalProfitTakeMaxDte: 10,
} as const;

/** C0：WR-93 Exit-Tight-10，历史生产 profile，保留用于回放对照。 */
export const CS_C0_PRODUCTION_VERSION = 'C0' as const;
export const CS_C0_PRODUCTION_PROFILE = CS_WR93_RESEARCH_PROFILE;

/** C1：C0.E47 / E43 Compact，历史研究 profile；不用于生产默认。 */
export const CS_C1_RESEARCH_VERSION = 'C1' as const;
export const CS_C1_RESEARCH_PROFILE = {
  ...CS_C0_PRODUCTION_PROFILE,
  csDeltaStopWideThreshold: .60,
  csDeltaStopWideRegime: 'RISK_ON_EXTENDED',
  csDeltaStopWideTqqqRoc20Min: .05,
  csSlowTrendExitMode: 'confirm2_hysteresis',
  csSlowTrendVixMax: 17,
  csWr89CooldownRescueMode: 'sr02_compact',
} as const;

/** C3：C2.E856 四块 semantic profile；保留 E821 的完整行为并收敛 coverage 接口。 */
export const CS_C3_PRODUCTION_VERSION = 'C3' as const;
export const CS_C3_PRODUCTION_PROFILE = {
  ...CS_C1_RESEARCH_PROFILE,
  csMode: 'sp_like_dynamic' as const,
  csProfitTakeEnabled: true,
  csProfitTarget: .792,
  csProfitTakeMode: 'conditional' as const,
  csConditionalProfitTakeMaxDte: 2,
  csTargetDte: 21,
  csSpreadWidthPct: .04,
  csDeltaStopThreshold: .47,
  csDeltaStopMode: 'stateful' as const,
  csDeltaStopCalmVix: 17.5,
  csDeltaStopRiskVix: 22,
  csDeltaStopCalmRoc20: .04,
  csDeltaStopCalmThreshold: .75,
  csDeltaStopRiskThreshold: .30,
  csResearchEntryReleaseMode: 'bull_sr02_vix_band_quality' as const,
  csResearchEntryBullVixBandMin: 14,
  csResearchEntryBullVixBandPriceExtensionMax: 1.45,
  csResearchEntryBullVixBandVixChange5dMax: .15,
  csResearchEntryBullVixBandLowerSegmentPriceExtensionMin: .99,
  csResearchEntryBullVixBandLowerSegmentVixMax: 16.7,
  csPreCrisisCapReleaseMode: 'second_entry_quality_v1' as const,
  csPreCrisisCapReleaseMinVix: 15.5,
  csPreCrisisVixMax: 17,
  csPreCrisisTqqqRv20Min: .525,
  csPreCrisisEventScope: 'sr01_weakening' as const,
  csPreCrisisMaxEntriesInWindow: 1,
  csPreCrisisWindowTradingDays: 1,
  csConditionalWidthMode: 'range_sr02_vix_lt_19' as const,
  csConditionalWidthPct: .0367,
  csSlowTrendProfitTarget: 1,
  csSlowTrendDeltaStopThreshold: .45,
  csSlowTrendDeltaStopHysteresis: .035,
  csSlowTrendFastAccelerationRoc5: .035,
  csSlowTrendFastAccelerationSlopePct: .012,
  csSlopeShortLegMode: 'slow_trend_v1' as const,
  csSlopeShortLegFastDelta: .11,
  csSlopeShortLegSlowDelta: .12,
  csSpLikeVixHigh: 22,
  csSpLikeExtensionGate: 2.05,
  csSpLikeDynamicCalmVix: 19.38,
  csSpLikeDynamicCalmDelta: .1742,
  csSpLikeDynamicCalmRoc20: .07,
  csTransitionConditionalGate: true,
  csTransitionConditionalCreditMax: 32.5,
  csTransitionConditionalTermSlopeMax: 0,
  csTransitionConditionalTermSlopeReleaseRegime: 'BULL' as const,
  csSlowTrendExitMode: 'confirm2_hysteresis' as const,
  csSlowTrendVixMax: 17,
  csDeltaStopWideThreshold: .73,
  csDeltaStopWideRegime: 'RISK_ON_EXTENDED' as const,
  csDeltaStopWideTqqqRoc20Min: .15,
  csWr89CooldownRescueMode: 'c1_hardgate_quality' as const,
  csResearchRiskGuardMode: 'vix_rising' as const,
  csResearchRiskGuardThreshold: .44,
  csResearchDeltaStopRescueMode: 'vix_falling_weak' as const,
  csResearchDeltaStopRescueMinDaysLeft: 0,
  csSurvivalPriceSelectionMode: 'survival_only' as const,
  csSurvivalSelectionFloor: .30,
  csSurvivalSelectionSurvivalWeight: .50,
  csSurvivalSelectionWilsonWeight: .50,
  csSurvivalSelectionObjective: 'tail_aware_conditional_p75_expected_pnl' as const,
  csSurvivalSelectionCreditRetentionFloor: .70,
  csSurvivalSelectionStateMode: 'stress_only' as const,
  csSurvivalSelectionWidthMode: 'full' as const,
  csSurvivalSelectionDistanceMode: 'base' as const,
  csSurvivalSelectionDteMode: 'fixed' as const,
  csSurvivalFallbackEnabled: true,
  csSurvivalFallbackShortDelta: .07,
  csSurvivalFallbackWidthPct: .04,
  csResearchMinCredit: .07,
  csResearchMinCreditScope: 'range_bound_vix_ge_15_5' as const,
  csVxnRescueSizeMultiplier: 2,
  csResearchVxnRescueMinVix: 23.75,
  csResearchVxnRescueVixChangeMin: -.20,
  csResearchVxnRescueDelta: .1525,
  csSecondaryCoverageProfile: 'high_win_coverage_v1' as const,
  csSecondaryCoverageTriggerMode: 'tail_or_research_or_extension_quality_v1' as const,
  csSecondaryCoverageSelectionMode: 'fixed' as const,
  csSecondaryCoverageShortDelta: .05,
  csSecondaryCoverageWidthPct: .02,
  csSecondaryCoverageSurvivalFloor: .95,
  csSecondaryCoverageNormalFloorMode: 'non_bull_or_bull_sr02_term_structure_quality_v1' as const,
  csSecondaryCoverageNormalRelaxedFloor: .925,
  csSecondaryCoverageBullSr02VixMax: 20,
  csSecondaryCoverageBullSr02TermStructureSlopeMin: 1,
  csSecondaryCoverageBullSr02TermStructureExtensionMin: 1,
  csSecondaryCoverageBullSr02VixChange5dMax: .075,
  csSecondaryCoverageBullDeltaStopThreshold: .45,
  csSecondaryCoverageProfitTarget: .95,
  csSecondaryCoverageDeltaStopThreshold: .35,
} as const;

/** C3.E0：后续研究固定从当前 C3 默认 profile 分叉，保持 parent 可复现。 */
export const CS_C3_E0_RESEARCH_VERSION = 'C3.E0' as const;
export const CS_C3_E0_RESEARCH_PROFILE = CS_C3_PRODUCTION_PROFILE;

/** 当前默认生产 profile；C0/C1 保留为历史 profile，C3 为显式上线默认。 */
export const CS_STATEFUL_PRODUCTION_VERSION = CS_C3_PRODUCTION_VERSION;
export const CS_STATEFUL_PRODUCTION_PROFILE = CS_C3_PRODUCTION_PROFILE;

/** 独立 QQQ CS 页面当前候选；不注入 PCS 或组合 overlay 默认。 */
export const CS_PAGE_SURVIVAL_PRODUCTION_PROFILE = {
  csSurvivalPriceSelectionMode: 'survival_only' as const,
  csSurvivalSelectionFloor: .30,
  csSurvivalSelectionSurvivalWeight: .50,
  csSurvivalSelectionWilsonWeight: .50,
  csSurvivalSelectionWidthMode: 'full' as const,
  csSurvivalSelectionCreditRetentionFloor: .70,
  csSurvivalSelectionStateMode: 'stress_only' as const,
  csSurvivalSelectionDistanceMode: 'base' as const,
  csPreCrisisVixMax: 20,
  csPreCrisisTqqqRv20Min: .42,
  csPreCrisisTqqqRoc20Max: .15,
  csPreCrisisEventScope: 'sr01_weakening_or_sr02_bull' as const,
  csPreCrisisMaxEntriesInWindow: 1,
  csPreCrisisWindowTradingDays: 5,
} as const;

export const CS_PAGE_SURVIVAL_PRODUCTION_PROFILE_ID = 'cs-scoped-union-cap1-stress70-credit70-weight50-full-v1';

// 'strict'     = 现有逻辑：RSI 45-60，MA 距离 ≤3%，VIX ≥18
// 'relaxed'    = 放宽：RSI 40-65，MA 距离 ≤5%，VIX ≥16（允许提前入场）
// 'early'      = 反弹初期：RSI 35-58，5日涨幅>0（去掉 MA 距离要求），VIX ≥14
// 'overbought' = 熊市反弹超买/阻力区卖看涨价差：QQQ<SMA200，RSI 58-72，QQQ>=SMA20，VIX<35
export type BearOverlayMode = 'strict' | 'relaxed' | 'early' | 'overbought';

// 'standard'   = RANGE_BOUND only, delta=0.15, wing=3%, VIX 14-28 — 现有逻辑（默认）
// 'relaxed'    = RANGE_BOUND + SIDEWAYS(价格>SMA200), delta=0.18, wing=4%, VIX 14-32
// 'aggressive' = 以上 + RISK_ON_WEAKENING, delta=0.22, wing=5%, VIX 12-35
export type ICMode = 'standard' | 'relaxed' | 'aggressive';

// 'reactive'      = VIX 14-28 平静区间 + RISK_ON 家族 + 非 CRISIS/backwardation（默认）
// 'post_pullback' = QQQ 5日跌幅 >= 3% 且 VIX >= 20（等回调/恐慌出现后再卖）
// 'off'           = 关闭原 PCS 时机；页面信号仍可独立开仓
export type PCSMode = 'reactive' | 'post_pullback' | 'off';
/** PCS_RESCUE 的机会池；只研究安全闸通过但主 PCS 没有成交的软阻断机会。 */
export type PCSRescueEntryMode = 'reactive_soft_pool' | 'main_blocked';
/** Research-only single-factor regime release; augments (never replaces) the selected PCS_RESCUE scope. */
export type PCSRescueResearchRegimeReleaseMode = 'roc20_nonnegative_v1' | 'price_above_sma200_v1' | 'trend_score_ge70_v1' | 'er20_ge40_v1' | 'roc5ge03_or_roc5ge0_er20ge015_vixle175_v1' | 'roc5ge03_or_er20ge015_vixle175_v1' | 'roc5ge03_or_roc5ge0_vixle175_v1' | 'roc5ge03_or_roc5ge0_er20ge015_v1' | 'roc5ge03_scope_source_v1' | 'roc5ge03_nonextended_scope_source_v1' | 'roc5nonneg_lt03_er15orvixle16_scope_source_v1' | 'roc5nonneg_lt03_er15orvixle16_scope_source_fixed25_v1' | 'roc5nonneg_lt03_er15orvixle16_scope_fixed25_v1';
/** Additional explicitly research-only R9 scope/source probes; none is a default mode. */
export type PCSRescueResearchRegimeReleaseModeR9 = 'rext_sr02_rvlt50_scope_source_v1' | 'rv20_ge40_scope_source_v1' | 'adxlt28_ma50slopege002_scope_source_v1' | 'vix_term_contango_scope_source_v1' | 'vix_term_contango_and_vix5d_falling_scope_source_v1' | 'vix5d_falling_scope_source_v1' | 'vix5d_nonnegative_scope_source_v1' | 'roc20lt0_roc5ge0_scope_source_v1' | 'roc20ge0_roc5lt0_scope_source_v1' | 'roc5ge0_scope_source_v1' | 'roc5lt0_scope_source_v1' | 'range20ge08_roc20lt0_scope_source_v1' | 'weakening_count_le1_scope_source_v1' | 'weakening_count_le1_scope_source_fixed25_v1' | 'weakening_count_le1_scope_source_fixed05_v1' | 'roc5nonneg_lt03_er15andvixle16_scope_source_v1' | 'bull_sr01_vix17_20_adxge25_scope_source_v1' | 'rext_sr02_vix14_17_adx25_30_rvlt50_scope_source_v1' | 'rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_scope_source_v1' | 'bull_sr02_vix13_15_adxge15_scope_source_v1' | 'adxge24_or_trendscorele35_scope_source_v1' | 'rsi14_ge50_scope_source_v1' | 'rsi14_ge50_vixlt20_scope_source_v1' | 'rsi14_le30_scope_source_v1' | 'vxn_gt_vix_scope_source_v1' | 'vxn_gt_vix_scope_source_fixed05_v1';
  /** PCS_RESCUE 的状态范围；expanded_quality_v1 只释放有质量的扩展区，selective_quality_v1 再捡少量边界口袋。 */
export type PCSRescueRegimeScope = 'soft_pool' | 'core_v1' | 'expanded_quality_v1' | 'selective_quality_v1' | 'selective_quality_v2' | 'selective_quality_v3' | 'selective_quality_v4' | 'selective_quality_v5' | 'selective_quality_v6' | 'selective_quality_v7' | 'selective_quality_v8' | 'selective_quality_v9' | 'selective_quality_v10' | 'selective_quality_v11' | 'selective_quality_v12' | 'selective_quality_v13' | 'selective_quality_v14' | 'selective_quality_v15' | 'selective_quality_v16_atr' | 'selective_quality_v17_no_tail_d' | 'selective_quality_v18_no_tail_e' | 'selective_quality_v19_range_all' | 'selective_quality_v20_merge_tail_de' | 'selective_quality_v21_side_ext_compact' | 'selective_quality_v22_side_compact' | 'selective_quality_v23_side_rv85' | 'selective_quality_v24_no_tail_a' | 'selective_quality_v25_no_tail_b' | 'selective_quality_v26_no_tail_c' | 'selective_quality_v27_side_rv86' | 'selective_quality_v28_side_rv87' | 'selective_quality_v29_side_rv90' | 'selective_quality_v30_side_rv8625' | 'selective_quality_v31_side_rv865' | 'selective_quality_v32_side_rv8675' | 'selective_quality_v33_side_rv87_alias' | 'selective_quality_v34_side_ext_atr2' | 'selective_quality_v35_side_ext_adx30_atr2' | 'selective_quality_v36_risk_ext_atr2_adx_lt30' | 'selective_quality_v37_risk_ext_atr2_adx_lt20' | 'selective_quality_v38_risk_ext_adx_lt30' | 'selective_quality_v39_risk_ext_atr225_adx_lt20' | 'selective_quality_v40_risk_ext_atr25_adx_lt20' | 'selective_quality_v41_risk_ext_atr3_adx_lt20' | 'selective_quality_v42_risk_ext_adx_lt20' | 'selective_quality_v43_risk_ext_adx_lt21' | 'selective_quality_v44_risk_ext_adx_lt22' | 'selective_quality_v45_risk_ext_adx_lt25' | 'selective_quality_v46_bull_tail_atr_nonnegative' | 'selective_quality_v47_side_rv100_adx_ge20' | 'selective_quality_v48_side_adx_ge20' | 'selective_quality_v49_bull_tail_no_adx' | 'selective_quality_v50_bull_tail_atr_ge_neg025' | 'selective_quality_v51_bull_tail_atr_ge_neg05' | 'selective_quality_v52_bull_tail_atr_ge_neg1' | 'selective_quality_v53_side_mid_adx_rv90' | 'selective_quality_v54_side_mid_adx_rv95' | 'selective_quality_v55_side_mid_adx_rv100' | 'selective_quality_v56_side_adx_ge16' | 'selective_quality_v57_side_adx_ge14' | 'selective_quality_v58_side_adx14_atr2' | 'selective_quality_v59_bull_adx_ge13' | 'selective_quality_v60_range_atr225' | 'selective_quality_v61_range_atr25' | 'selective_quality_v62_risk_ext_adx_lt30_atr2' | 'selective_quality_v63_side_adx12_atr2_roc5ge0' | 'selective_quality_v64_side_adx12_atr2' | 'selective_quality_v65_side_adx12_roc5ge0' | 'selective_quality_v66_side_atr2_roc5ge0' | 'selective_quality_v67_risk_ext_sma_ge19' | 'selective_quality_v68_risk_ext_sma_ge20' | 'selective_quality_v69_risk_ext_sma_ge22' | 'selective_quality_v70_combined_e70_sma22' | 'selective_quality_v71_combined_sma21' | 'selective_quality_v72_slim_no_bull_tail' | 'selective_quality_v73_slim_preserve_core_bull_tail' | 'selective_quality_v74_risk_ext_roc5_lt0' | 'selective_quality_v75_risk_ext_sma15_roc5_lt0' | 'selective_quality_v76_risk_ext_sma17_roc5_lt0' | 'selective_quality_v77_risk_ext_weakening_ge1' | 'selective_quality_v78_risk_ext_weakening_sma9' | 'selective_quality_v79_risk_ext_weakening_momentum' | 'selective_quality_v80_risk_ext_weakening_roc20' | 'selective_quality_v81_risk_ext_weakening_drawdown' | 'selective_quality_v82_risk_ext_drawdown05_1_vix15' | 'selective_quality_v83_risk_ext_drawdown05_1_vix15_atr35' | 'selective_quality_v84_risk_ext_drawdown05_1_vix15_atr35_no_weakening' | 'selective_quality_v85_risk_ext_drawdown05_1_vix15_atr35_no_weakening_ablation' | 'selective_quality_v86_risk_ext_drawdown05_1_vix15_roc20_8' | 'selective_quality_v87_risk_ext_drawdown05_1_vix15_roc20_8_on_e99' | 'selective_quality_v88_risk_ext_atr35_ge_on_e105' | 'selective_quality_v89_risk_ext_atr35_vix13_on_e105' | 'selective_quality_v90_risk_ext_atr35_vix14_on_e105' | 'selective_quality_v91_risk_ext_atr35_sma12_17_on_e111' | 'selective_quality_v92_risk_ext_sma15_vix13_roc20_8_on_e121' | 'selective_quality_v93_risk_ext_vix13_roc20_8_on_e121' | 'selective_quality_v94_risk_ext_sma15_roc20_8_on_e121' | 'selective_quality_v95_risk_ext_sma15_vix13_on_e121' | 'selective_quality_v96_current_plus_side_vix22' | 'selective_quality_v97_current_plus_side_vix19_roc5_02_riskext_sr02_adx30_35_roc5ge0' | 'selective_quality_v98_risk_ext_sr02_lowvix_sma15_adx40_vixfall' | 'selective_quality_v99_risk_ext_sr02_lowvix_sma15_adx40_marketvixfall' | 'selective_quality_v100_risk_ext_sr02_lowvix_er50_roc5' | 'selective_quality_v101_risk_ext_sr02_lowvix_er40_roc5neg_adx34' | 'selective_quality_v102_risk_ext_sr02_lowvix_er40_roc5neg_adx35' | 'selective_quality_v103_risk_ext_sr02_lowvix_adx45_rv20_lt20' | 'selective_quality_v104_bull_er10';
export type PCSRescueContractFallbackQualityMode = 'off' | 'roc20_nonnegative_v1' | 'tqqq_roc20_nonnegative_v1' | 'either_roc20_nonnegative_v1' | 'roc5_nonnegative_v1' | 'roc20_or_sr02_roc5_nonnegative_v1' | 'roc20_or_sr02_roc5_or_vix22_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_sr02_roc20_lt_m05_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_v1' | 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_or_sr02_adx15_v1';
/** 研究专用：仅约束第三顺位 fallback 的状态，不影响 E114 基础层。 */
export type PCSRescueContractFallbackTertiaryQualityMode = 'exclude_bull_sr02_side_sr01_v1' | 'exclude_bull_sr02_side_sr01_riskext_sr01_v1';
/** 研究专用：仅把 P3.E471 residual 的一个动态状态交集释放给 Rescue，不改变主 PCS 信号。 */
export type PCSRescueResearchComplementMode = 'off' | 'p3_bull_sr02_vix13_adx12_rv40_v1' | 'p3_range_sr01_vix17_20_adx12_20_rv40_50_v1' | 'p3_range_sr02_vix17_adx12_rv50_60_v1' | 'p3_rext_sr02_vix17_20_adx20_25_v1' | 'p3_rext_sr02_vixge17_adx20_25_v1' | 'p3_rext_sr02_vix17_20_adxge20_v1' | 'p3_rext_sr02_vixge17_adxge20_v1' | 'p3_weak_sr01_adx20_25_v1' | 'p3_e150c_plus_weak_sr01_adx20_25_v1' | 'p3_range_sr01_adxge20_v1' | 'p3_e152_plus_range_sr01_adxge20_v1' | 'p3_side_sr02_v1' | 'p3_e152_plus_side_sr02_v1' | 'p3_rext_sr02_adxge20_v1' | 'p3_e155_plus_rext_sr02_adxge20_v1' | 'p3_rext_sr02_vixlt17_adx20_25_rvge50_v1' | 'p3_e155_plus_rext_sr02_vixlt17_adx20_25_rvge50_v1' | 'p3_e526_range_sr01_or_adxge12_v1' | 'p3_e159_plus_e526_range_sr01_or_adxge12_v1' | 'p3_e159_plus_e526_range_state_v1' | 'p3_e159_plus_e526_range_vixlt19_v1' | 'p3_e159_plus_e526_range_sr01_vixlt19_or_adxge12_v1' | 'p3_e159_plus_e526_range_sr01_vixlt19_or_non_sr01_adxge12_v1' | 'p3_e159_plus_e526_range_sr01_vixlt195_quality_or_non_sr01_adxge12_v1' | 'p3_e159_plus_e526_range_sr01_vixlt195_quality_merge_v1' | 'p3_e159_plus_e526_range_sr01_vixlt20_strict_quality_v1' | 'p3_e159_plus_e526_range_sr01_vix20_25_adxlt195_v1' | 'p3_e159_plus_e526_range_sr01_vixge25_adxlt20_v1' | 'p3_e159_plus_e526_range_sr01_vix25_union_v1' | 'p3_e159_plus_e526_range_sr01_vix25_union_bull_lowvix_atr_v1' | 'p3_e159_plus_e526_range_sr01_vix25_union_range_sr02_vixge20_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_lowvix_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_highadx_vix13_15_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_lowvix_quality_v1' | 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_midquality_v1' | 'p3_e159_plus_e526_side_sr01_vix13_19_adxge12_v1' | 'p3_e159_plus_e526_side_sr01_vix13_19_adxge12_rvlt80_v1' | 'p3_e159_plus_e526_bull_sr02_vix10_13_adx20_25_v1' | 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_roc5lt0_v1' | 'p3_e159_plus_e526_bull_sr02_vix17_19_adx20_25_v1' | 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_20_v1' | 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_25_v1' | 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1' | 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1' | 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1' | 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1' | 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1' | 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1' | 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1' | 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1' | 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1' | 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1' | 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1' | 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1' | 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1' | 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1' | 'p3_e159_plus_e526_range_path_v1' | 'p3_e159_plus_e526_range_vix_v1' | 'p3_e159_plus_e526_range_path_atr_sr01_v1' | 'p3_e159_plus_e526_range_path_or_vix_v1' | 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1' | 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_or_bull_sr02_vix10_25_adx12_25_v1';
export type PCSRescueResearchRangeContractMode = 'p3_sigma2_width03925_v1' | 'p3_sigma2_width03925_complement_only_v1';
/** PCS_RESCUE 短腿 Delta：fixed 单一目标，state_adaptive_v1 三档切换，quality_v1 不把低 VIX 的 RISK_ON_EXTENDED 一律压到 2.5Δ，continuous_v1 连续插值；continuous_quality_v1/2/3/4、range_fixed_quality_v1 与 range_smart_quality_v1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/20/21/22/23/24/25/26/27/28/29/30/31/32/33 仅研究用，保留 quality 极端尾部保护。 */
export type PCSRescueDeltaMode = 'fixed' | 'state_adaptive_v1' | 'state_adaptive_quality_v1' | 'state_adaptive_quality_v2' | 'state_adaptive_quality_v3' | 'state_adaptive_quality_v4' | 'state_adaptive_quality_v5' | 'continuous_v1' | 'continuous_quality_v1' | 'continuous_quality_v2' | 'continuous_quality_v3' | 'continuous_quality_v4' | 'range_fixed_quality_v1' | 'range_smart_quality_v1' | 'range_smart_quality_v2' | 'range_smart_quality_v3' | 'range_smart_quality_v4' | 'range_smart_quality_v5' | 'range_smart_quality_v6' | 'range_smart_quality_v7' | 'range_smart_quality_v8' | 'range_smart_quality_v9' | 'range_smart_quality_v10' | 'range_smart_quality_v11' | 'range_smart_quality_v12' | 'range_smart_quality_v13' | 'range_smart_quality_v14' | 'range_smart_quality_v15' | 'range_smart_quality_v16' | 'range_smart_quality_v17' | 'range_smart_quality_v18' | 'range_smart_quality_v19' | 'range_smart_quality_v20' | 'range_smart_quality_v21' | 'range_smart_quality_v22' | 'range_smart_quality_v23' | 'range_smart_quality_v24' | 'range_smart_quality_v25' | 'range_smart_quality_v26' | 'range_smart_quality_v27' | 'range_smart_quality_v28' | 'range_smart_quality_v29' | 'range_smart_quality_v30' | 'range_smart_quality_v31' | 'range_smart_quality_v32' | 'range_smart_quality_v33' | 'macro_continuous_v1_non_bull_non_sr02_v1' | 'macro_continuous_v1_non_bull_non_sr02_or_vix18_adx22_v1' | 'macro_continuous_v2_non_bull_non_sr02_v1' | 'macro_continuous_v3_e52_or_bull_sr01_v1' | 'macro_continuous_v3_e52_or_bull_sr01_v2' | 'macro_continuous_v3_e52_or_bull_sr01_v3' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v1' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v2' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v3' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_not_precrisis_v1' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v1' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v2' | 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v3' | 'macro_continuous_v3_e67_or_vix18_adx22_v1' | 'macro_continuous_v3_e67_or_rv_ge67_v1' | 'macro_continuous_v3_e67_or_trend50_70_v1' | 'macro_continuous_v3_e67_or_ext_lt0_v1' | 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_non_bull_sr02_v1' | 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_v1' | 'macro_continuous_v3_e52_or_not_precrisis_v1' | 'macro_continuous_v3_e52_or_risk_on_rv_lt50_v1' | 'macro_continuous_v3_e52_or_rv_lt50_v1' | 'macro_continuous_v3_e52_or_vix18_adx22_v1' | 'macro_continuous_v3_non_bull_sr02_guarded_v1' | 'macro_continuous_v3_non_bull_v1' | 'macro_continuous_v3_non_bull_non_sr02_v1' | 'macro_continuous_v3_non_sr02_v1' | 'macro_continuous_v3_non_bull_non_sr02_or_range_midtrend_ext_v1' | 'macro_continuous_v3_risk_on_v1' | 'macro_continuous_v4_non_bull_non_sr02_v1' | 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_v1' | 'macro_continuous_v3_e67_or_range20_ge8_drawdown_le5_v1' | 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_residual_v1' | 'macro_continuous_v3_e67_or_range20_ge8_drawdown_le5_residual_v1';
export type PCSRescueExtremeWidthProfile = 'global' | 'adx_split_v1';
/** V1.1 底层选择性释放；off 保持原有 V1.1 阻断口径。 */
export type PCSV11ReleaseMode = 'off' | 'sr02_adx20' | 'rv20_lt_067_or_sr02_adx20';
/** V1.2.3 误杀归因研究：分别只释放 A9、B30 或 C10；current 保持正式口径。 */
export type PCSV123ReleaseClass = 'current' | 'none' | 'a9_only' | 'b30_only' | 'c10_only';
/** 候选3 BULL/SR02 释放口袋的规则简化研究臂；off 保持当前严格四条件。 */
export type PCSCandidate3ExtraReleaseMode =
  | 'off'
  | 'bull_sr02_lowvol_v1'
  | 'bull_sr02_rv_adx'
  | 'bull_sr02_vix_adx'
  | 'bull_sr02_vix_rv'
  | 'bull_sr02_adx'
  | 'bull_sr02_vix'
  | 'bull_sr02_rv'
  | 'bull_sr02'
  | 'bull_sr02_vol_or_adx'
  | 'r7_weak_sr01_vixlt20_adxlt30'
  | 'r7_e434_plus_weak_sr01_v1'
  | 'sr02_rv_adx'
  | 'bull_rv_adx'
  | 'bull_sr02_rv60_adx20'
  | 'bull_sr02_rv65_adx20'
  | 'bull_sr02_rv70_adx20'
  | 'bull_sr02_rv67_adx15'
  | 'bull_sr02_rv67_adx25'
  | 'bull_sr02_rv67_adx30';
  /** 仅卖方机会快速回测：建仓时锁定的概率参考线退出研究，默认到期持有。 */
export type PCSProbabilityReferenceExitMode = 'hold_to_expiry' | 'risk_reference' | 'realization_reference' | 'both_references';
/** PCS 路径生存率退出研究；off 保持原有回测路径。 */
export type PCSSurvivalExitMode = 'off' | 'probability' | 'touch' | 'both';
/** PCS 短腿触碰退出的确认口径；默认 intraday_touch 保持历史基线。 */
export type PCSSurvivalTouchConfirmation = 'intraday_touch' | 'close_confirmation' | 'two_close_confirmation' | 'buffered_touch';
/** PCS 研究选价模式；off 保持原有 Delta/Profile 选约。 */
export type PCSSurvivalPriceSelectionMode = 'off' | 'survival_only' | 'dynamic_v1_survival';
/** PCS 生存率选价的期限研究模式；默认 fixed 保持固定目标 DTE。 */
export type PCSSurvivalSelectionDteMode = 'fixed' | 'dynamic_dte_v1';
/** PCS 生存率选价的宽度研究模式；默认 fixed 保持固定宽度。 */
export type PCSSurvivalSelectionWidthMode = 'fixed' | 'dynamic_width_v1' | 'guarded_dynamic_width_v1' | 'width_only_guarded_dynamic_width_v1' | 'width_only_guarded_v2_width_v1' | 'width_only_guarded_expected_pnl_lcb_v1' | 'confirmed_guarded_dynamic_width_v1' | 'stress_dynamic_width_v1' | 'state_guarded_dynamic_width_v1' | 'joint_dynamic_width_v1' | 'tail_triggered_dynamic_width_v1';
/** PCS 固定宽度下的压力分层仓位研究；off 保持原风险预算。 */
export type PCSPressureSizingMode = 'off' | 'state_v1';
/** PCS 风险包络研究；candidate3_v1 保留为兼容别名，candidate4_v1 启用候选4。 */
export type PCSRiskEnvelopeMode = 'off' | 'candidate3_v1' | 'candidate4_v1';
export type PCSRiskEnvelopeProfile =
  | 'candidate4_v1'
  | 'candidate4_full_v1'
  /** 研究专用：仅接受四分支的精确 FULL 命中，不消费边界 HALF。 */
  | 'candidate4_full_only_v1'
  /** 研究专用：只保留 weakening 两分支的精确 FULL 命中。 */
  | 'candidate4_weakening_full_only_v1'
  | 'candidate4_merged_bull_strict_v1'
  | 'candidate4_merged_bull_broad_v1'
  | 'candidate4_weakening_only_v1';
/** PCS 研究专用的胜率过滤；默认 off，不进入生产/API/UI。 */
export type PCSResearchEntryFilter = 'off' | 'block_bull_sr01_extension2_v1';
/** PCS 生存率选价的 Sigma 研究模式；stress_only 只在高压状态收窄候选 Sigma。 */
export type PCSSurvivalSelectionSigmaMode = 'full' | 'dynamic_v1' | 'stress_only_dynamic_v1' | 'stress_two_step_v1';
/** PCS 研究选价排序目标；tail_* 不计交易成本，显式扣除尾部损失代理。 */
export type PCSSurvivalSelectionObjective = 'risk_efficiency' | 'survival_priority' | 'survival_adjusted_expected_pnl' | 'survival_adjusted_expected_pnl_v2' | 'tail_aware_expected_pnl' | 'tail_aware_conditional_expected_pnl' | 'tail_aware_conditional_p75_expected_pnl' | 'tail_aware_conditional_cvar75_expected_pnl' | 'constrained_tail_efficiency';
/** CS 短 Call 生存率选价研究；off 保持现有 Delta 选约。 */
export type CSSurvivalPriceSelectionMode = 'off' | 'survival_only';
/** CS 斜率动态短腿研究；slow_trend_v1 仅在慢涨且未快速加速时外移。 */
export type CSSlopeShortLegMode = 'off' | 'slope_v1' | 'slow_trend_v1';
/** CS 慢涨止损研究；off 保持现有 Delta 止损。 */
export type CSSlowTrendExitMode = 'off' | 'widened' | 'confirm2' | 'confirm2_hysteresis';
/** CS 与 PCS 的组合评分研究；off 不消费 PCS 组合代理。 */
export type CSPortfolioScoreMode = 'off' | 'pcs_hedge_v1';
/** CS 生存率选价的宽度网格；full 联合搜索距离与宽度，fixed 保持当前宽度。 */
export type CSSurvivalSelectionWidthMode = 'fixed' | 'full';
/** CS 生存率选价状态范围；预危机模式只作为研究开关，不改变默认生产状态。 */
export type CSSurvivalSelectionStateMode = 'all' | 'stress_only' | 'stress_or_pre_crisis' | 'pre_crisis_only';
/** CS 距离候选研究模式；pcs_dynamic_v1 复用 PCS dynamic-v1 的状态化候选层级。 */
export type CSSurvivalSelectionDistanceMode = 'base' | 'pcs_dynamic_v1';
/** CS 生存率选价期限；dynamic_dte_v1 复用 PCS 的 21/28/35 DTE 压力分层。 */
export type CSSurvivalSelectionDteMode = 'fixed' | 'dynamic_dte_v1';
export type CSPreCrisisEventScope = 'all' | 'sr01_weakening' | 'sr02_bull' | 'sr01_weakening_or_sr02_bull' | 'all_exclude_bull_sr01_weakening_sr02';
/** 预危机 cap1 的第二笔质量释放；默认 off，研究专用。 */
export type CSPreCrisisCapReleaseMode = 'off' | 'second_entry_quality_v1';
/** CS 独立保险覆盖层；默认关闭，不改变主层历史回放或生产配置。 */
export type CSSecondaryCoverageProfile = 'off' | 'high_win_coverage_v1';
/** 高胜率覆盖层的机会池；默认只接主层选约失败，不改变既有行为。 */
export type CSSecondaryCoverageTriggerMode = 'selector_failure' | 'research_blocked' | 'tail_or_research_blocked' | 'tail_or_research_or_extension_blocked' | 'tail_or_research_or_extension_quality_v1' | 'tail_or_research_or_extension_low_vix_v1' | 'tail_or_research_or_calm_vix_v1' | 'tail_or_research_or_extension_calm_term_v1' | 'tail_or_research_or_extension_quiet_vix_adx_v1' | 'macro_calm_vix_all_v1';
export type CSSecondaryCoverageTier = 'normal_coverage' | 'pre_crisis_coverage';
export type CSSecondaryCoverageSelectionMode = 'fixed' | 'survival_priority' | 'sr02_calm_survival_priority_v1' | 'extension_quality_survival_v1' | 'extension_quality_fixed_then_survival_fallback_v1' | 'sr02_calm_ultra_tail_fallback_v1' | 'sr02_calm_sigma_fallback_v1' | 'risk_efficiency_width_search_v1';
/** Research-only coverage geometry override for the unified BULL/SR02 calm bucket. */
export type CSSecondaryCoverageGeometryMode = 'fixed' | 'bull_sr02_calm_v1';
/** Research-only normal coverage floor release; fixed preserves the current floor. */
export type CSSecondaryCoverageNormalFloorMode = 'fixed' | 'non_bull_relaxed_v1' | 'non_bull_or_bull_extension_band_v1' | 'non_bull_or_bull_low_quality_v1' | 'non_bull_or_bull_high_quality_v1' | 'non_bull_or_bull_roc20_cap_v1' | 'non_bull_or_bull_er20_cap_v1' | 'non_bull_or_bull_bull_low_vix_v1' | 'non_bull_or_bull_bull_low_vix_contango_v1' | 'non_bull_or_bull_low_vix_contango_quality_v1' | 'non_bull_or_bull_vix_floor_bridge_v1' | 'non_bull_or_bull_term_quality_floor_bridge_v1' | 'non_bull_or_bull_sr02_calm_floor_bridge_v1' | 'non_bull_or_bull_sr02_quiet_floor_bridge_v1' | 'non_bull_or_bull_bull_quiet_vix_floor_bridge_v1' | 'non_bull_or_bull_sr02_quality_v1' | 'non_bull_or_bull_sr02_er20_cap_v1' | 'non_bull_or_bull_sr02_extension_cap_v1' | 'non_bull_or_bull_sr02_term_structure_v1' | 'non_bull_or_bull_sr02_stable_term_structure_v1' | 'non_bull_or_bull_sr02_term_structure_quality_v1' | 'non_bull_or_bull_sr02_term_structure_quality_er20_v1' | 'non_bull_or_bull_sr02_term_structure_quality_roc20_v1';
export type CSSecondaryCoverageExitProfileId = 'coverage_normal_v1' | 'coverage_pre_crisis_v1';
export type CSSecondaryCoverageExitProfile = {
  id: CSSecondaryCoverageExitProfileId;
  profitTarget: number;
  deltaStopThreshold: number;
};
// 'reactive_pcs' 仅回测 UI 的原始 PCS 入口；序列化 RunSpec 时降为 pcsMode='reactive' + filter='off'。
// 两个 *_open 仅回测：一个忠实 Git 38/120，另一个显式标记为 Edge 70 研究假设。
export type PCSStockDecisionFilterMode = 'watch_open' | 'open' | 'historical_38_open' | 'research_open_70' | 'legacy_open' | 'carry' | 'reactive_pcs' | 'reactive_pcs_v1' | 'off';

/** 兼容已保存的已移除 strict_open：它原本就是正式 OPEN 的严格事件链。 */
export function normalizePcsStockDecisionFilterMode(mode: unknown): PCSStockDecisionFilterMode {
  if (mode === 'strict_open') return 'open';
  if (mode === 'historical_open') return 'historical_38_open';
  return mode === 'watch_open' || mode === 'open' || mode === 'historical_38_open' || mode === 'research_open_70' || mode === 'legacy_open' || mode === 'carry' || mode === 'reactive_pcs' || mode === 'reactive_pcs_v1' || mode === 'off' ? mode : 'off';
}
export type VolEstimator = 'window' | 'ewma' | 'ewma_vix_blend' | 'qqq_scaled_2_5x' | 'qqq_scaled_3x' | 'qqq_scaled_3_5x' | 'min_window_vix_2x' | 'min_window_vix_2_5x' | 'min_window_vix_3x';
export type StockPhasePolicyId = 'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_DEFENSE' | 'SLOW_BEAR_RECOVERY';
export type MacroExecutionDriver = 'none' | 'slow-macro' | 'slow-subregime';
export type StockPhasePolicyOverride = {
  /** 回测研究专用：CURRENT 最终目标的有界临时增益；仅由 DecisionEngine 的 manual/7 因子写入。 */
  recoveryBoostPct?: number;
  /** SLOW_BULL_GROWTH gate 通过时提高软仓位上限；仍受 preset hard cap 截断。 */
  maxTqqqWarnPct?: number;
  /** SLOW_BULL_GROWTH gate 通过时提高成本回撤后的仓位上限；仍受软/硬上限截断。 */
  costBasisDrawdownCapPct?: number;
  targetVolMultiplier?: number;
  riskOnWeightMultiplier?: number;
  chopWeightMultiplier?: number;
  rangeBoundCapMode?: 'hard' | 'scaled';
  bearWeightMultiplier?: number;
  bearTrendMultiplier?: number;
  strongBearTrendMultiplier?: number;
  downSmoothing?: 'inherit' | 'off';
  fastVolReentry?: boolean;
  softenStrongBearBlock?: boolean;
  postCrisisFastEntry?: boolean;
  crisisRecoveryBars?: number;
  upstreamBlockSellMode?: 'target' | 'hardmax' | 'ramp';
  maxSellPerBarPctMultiplier?: number | null;
};
/**
 * 研究专用：SLOW_BULL_GROWTH 的条件化临时上限。
 * 未配置时保持既有 90% Growth 软上限；该字段不由 UI/API/live 调用设置。
 */
export type ConditionalGrowthCapConfig = {
  /** 触发期间的实际目标仓位上限，例如 .80 或 .85。 */
  capPct: number;
  /** VIX 达到该值时触发；未配置则关闭此条件。 */
  vixMin?: number;
  /** QQQ 单日收盘跌幅达到该值时触发，例如 -.04；未配置则关闭此条件。 */
  qqqOneDayShockPct?: number;
  /** QQQ 累计收盘跌幅触发；key 为回看交易日数，例如 { 2: -.06, 5: -.08 }。 */
  qqqCumulativeShockPct?: Partial<Record<2 | 5, number>>;
  /** 触发结束后、尚未确认恢复时保留上限的交易日数。 */
  releaseBars?: number;
};

/** Research-only: temporarily raise the normal TQQQ cap on clean strong-growth bars. */
export type ConditionalHardCapRaiseConfig = {
  capPct: number;
  /** Research-only: require the existing trend-participation state to be active. */
  requireActive?: boolean;
  regimeIn?: string[];
  vixMax?: number;
  vixRise5dMax?: number;
  realizedVolMax?: number;
  roc5Min?: number;
  roc20Min?: number;
  sma20SlopeMin?: number;
  er20Min?: number;
  priceVsSma200Min?: number;
  drawdownMax?: number;
  priceExtensionMax?: number;
  scoreMin?: number;
};
export type StockPhaseSignalGate = {
  /** Research-only fast-regime restriction; omitted preserves the existing policy path. */
  fastRegimeIn?: readonly string[];
  /** Research-only: allow an otherwise excluded slow subregime only in selected fast regimes. */
  slowSubregimeConditionalFastRegimeIn?: Partial<Record<'SR01' | 'SR02', readonly string[]>>;
  /** Research-only overrides applied only when the matching slow subregime is admitted. */
  slowSubregimeConditionalOverrides?: Partial<Record<'SR01' | 'SR02', Partial<StockPhasePolicyOverride>>>;
  /** Research-only gates applied only to the matching slow subregime. */
  slowSubregimeConditionalGate?: Partial<Record<'SR01' | 'SR02', {
    roc5Min?: number;
    er20Min?: number;
    sma20SlopeMin?: number;
    vixMax?: number;
    aboveSma20?: boolean;
    aboveSma50?: boolean;
  }>>;
  roc5Min?: number;
  roc20Min?: number;
  sma20SlopeMin?: number;
  vixMax?: number;
  vixMin?: number;
  vixTermMin?: number;
  /** Research-only upper bound for VIX/VIX3M backwardation. */
  vixTermMax?: number;
  relativeRoc20Min?: number;
  relativeRoc60Min?: number;
  aboveSma20?: boolean;
  aboveSma50?: boolean;
  slowSubregimeIn?: readonly ('SR01' | 'SR02')[];
  slowSubregimePosteriorMin?: number;
};

/** STATE-BAL85：超防御增长分支保留 SR02，但将后验门槛降至 85%。 */
export const ULTRA_DEFENSIVE_GROWTH_GATE = { slowSubregimeIn: ['SR02'], slowSubregimePosteriorMin: 0.85 } as const;
/** STATE-BAL85：只在有恢复迹象的高 VIX 熊市状态提高恢复仓位。 */
export const STATE_BAL85_RECOVERY_POLICY = {
  overrides: { targetVolMultiplier: 1.10, riskOnWeightMultiplier: 1.05, downSmoothing: 'off' },
  gate: { roc5Min: 0, aboveSma20: true, vixMin: 20 },
} as const;
export type StockPhasePolicyRule = { overrides: StockPhasePolicyOverride; gate?: StockPhaseSignalGate };
export type NavDrawdownGovernorTier = { ddPct: number; factor: number };
export type NavDrawdownGovernorConfig =
  | NavDrawdownGovernorTier[]
  | {
      tiers: NavDrawdownGovernorTier[];
      regimeGated?: boolean;
      /** Research-only: restrict NAV drawdown governance to selected current regimes. */
      regimeIn?: MarketRegime[];
      /** Research-only optional market confirmation for NAV drawdown governance. */
      marketRiskGate?: {
        vixMin?: number;
        vixRise5dMin?: number;
        roc5Max?: number;
        roc20Max?: number;
      };
      /** Research-only partial release while recovering from a NAV drawdown. */
      marketRecoveryRelease?: {
      roc5Min?: number;
      roc20Min?: number;
      vixMax?: number;
      factor?: number;
      regimeIn?: string[];
      regimeFactors?: Record<string, number>;
      };
      /** Research-only target cap after a realized NAV drawdown; omitted callers are unchanged. */
      recoveryTargetCap?: {
        minDrawdownPct: number;
        maxTargetPct: number;
        regimeIn?: MarketRegime[];
      };
    };

export type TrendParticipationQualityOverride = {
  minScore?: number;
  roc5Min?: number;
  /** Research-only upper bound used for a short-term momentum band test. */
  roc5Max?: number;
  roc20Min?: number;
  /** Research-only ADX floor for current-bar trend persistence screening. */
  adxMin?: number;
  vixMax?: number;
  vixRise5dMax?: number;
  realizedVolMax?: number;
  er20Min?: number;
  priceExtensionMax?: number;
  drawdownMaxPct?: number;
  baseTargetMinPct?: number;
};

/** Research-only shared quality profiles; omitted callers preserve baseline behavior. */
export type TrendParticipationQualityProfile = 'Q85_SHARED';

export const TREND_PARTICIPATION_QUALITY_PROFILES: Record<TrendParticipationQualityProfile, {
  strong: TrendParticipationQualityOverride;
  recovery: TrendParticipationQualityOverride;
}> = {
  Q85_SHARED: {
    // Q85 intentionally omits realizedVolMax on the strong branch (the NoRV parent).
    strong: { minScore: 3, roc5Min: .005, roc5Max: .025, roc20Min: .02, vixMax: 24, vixRise5dMax: .02, priceExtensionMax: 2.65, drawdownMaxPct: .05 },
    recovery: { minScore: 3, roc20Min: .03, vixMax: 20, vixRise5dMax: 0, realizedVolMax: .90, priceExtensionMax: 2.25 },
  },
};

export function resolveTrendParticipationQuality(
  config: Pick<TrendParticipationReleaseConfig, 'qualityProfile' | 'strongQualityOverride' | 'recoveryQualityOverride'> | undefined,
  branch: 'strong' | 'recovery',
): TrendParticipationQualityOverride | undefined {
  if (!config) return undefined;
  const profile = config.qualityProfile == null ? undefined : TREND_PARTICIPATION_QUALITY_PROFILES[config.qualityProfile][branch];
  const explicit = branch === 'strong' ? config.strongQualityOverride : config.recoveryQualityOverride;
  return profile == null && explicit == null ? undefined : { ...profile, ...explicit };
}

/** Research-only asymmetric trend participation release; omitted callers preserve baseline behavior. */
export type TrendParticipationReleaseConfig = {
  enabled?: boolean;
  mode?: 'strong' | 'recovery' | 'unified';
  /** Research-only: centralize the Q85 strong/recovery quality gates without changing their values. */
  qualityProfile?: TrendParticipationQualityProfile;
  /** Research-only: allow selected non-growth stock policies to use the release layer; omitted preserves SLOW_BULL_GROWTH-only behavior. */
  stockPolicyIn?: Array<'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_RECOVERY'>;
  /** Research-only: restrict the strong release branch to selected regimes. */
  strongRegimes?: Array<'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING'>;
  /** Research-only: when extending strong release to RISK_ON_EXTENDED, require prior strong participation to remain active. */
  strongExtendedRequiresActive?: boolean;
  recoveryMinScore?: number;
  strongQualityOverride?: TrendParticipationQualityOverride;
  /** Research-only: multiply target volatility only on clean strong-release bars. */
  strongTargetVolMultiplier?: number;
  /** Research-only: replace the active volatility estimate only on clean strong bars. */
  strongVolEstimator?: Extract<VolEstimator, 'qqq_scaled_2_5x' | 'qqq_scaled_3x' | 'qqq_scaled_3_5x'>;
  /** Research-only: keep the lower of the existing and proxy estimate instead of replacing it. */
  strongVolEstimatorMode?: 'replace' | 'min';
  /** Research-only: permit the proxy estimate only above this existing ER20 threshold. */
  strongVolEstimatorErMin?: number;
  /** Research-only: replace the strong target-vol multiplier only when an additional ER20 gate passes. */
  strongTargetVolOverride?: {
    multiplier: number;
    er20Min?: number;
    roc5Min?: number;
    /** Optional research-only current-bar QQQ return floor. */
    qqqReturnMin?: number;
    /** Optional research-only regime scope. */
    regimeIn?: Array<'BULL' | 'RISK_ON_EXTENDED'>;
    /** Optional research-only current-bar realized-volatility ceiling. */
    realizedVolMax?: number;
  /** Optional research-only price location floor relative to SMA200. */
  priceVsSma200MinPct?: number;
  vixMax?: number;
    requireActive?: boolean;
  };
  /** Research-only: add a low-realized-volatility uplift without replacing the base strong override. */
  strongTargetVolLowRvOverride?: {
    multiplier: number;
    realizedVolMax: number;
    /** Optional research-only actual-exposure ceiling for the uplift. */
    maxActualPct?: number;
  };
  /** Research-only: require a separate quality score for the strong target-vol multiplier. */
  strongTargetVolScoreMin?: number;
  /** Research-only: refill the current vol-target by a bounded amount after a separate two-bar strong-trend confirmation. */
  trendBudgetRefill?: {
    maxPct: number;
    /** Research-only engine seam; omitted preserves the frozen 5% refill cap. */
    hardCapPct?: number;
    confirmBars?: number;
    /** Research-only: allow a bounded refill while the 5d VIX change remains below this ceiling. */
    vixRise5dMax?: number;
    /** Research-only: require the current QQQ bar to meet this return floor. */
    qqqOneDayMin?: number;
    /** Research-only: require TQQQ realized volatility to remain below this ceiling. */
    realizedVolMax?: number;
    /** Research-only: release this fraction of maxPct on the first eligible bar before confirmation. */
    preConfirmFraction?: number;
    /** Research-only: in BULL, allow the existing refill quality gate to admit ROC5<0 only when VIX five-day change is non-positive. */
    allowBullNegativeRoc5VixFall?: boolean;
  };
  /** Research-only: floor the final volatility-budget target on clean strong bars, before the hard cap. */
  strongBudgetFloorPct?: number;
  /** Research-only: raise strong release capacity only when the existing strong gate is active and ER20 confirms the move. */
  strongCapacityOverride?: {
    capacityPct: number;
    er20Min?: number;
    /** Optional research-only ADX floor for conditional capacity release. */
    adxMin?: number;
    /** Optional research-only continuous ER20-to-capacity slope; omitted preserves step-gate behavior. */
    slope?: number;
    roc5Min?: number;
    /** Optional research-only price location floor relative to SMA200. */
    priceVsSma200MinPct?: number;
    /** Optional research-only current-bar QQQ return floor for conditional capacity release. */
    qqqOneDayMin?: number;
    vixMax?: number;
    baseTargetMinPct?: number;
    drawdownMaxPct?: number;
  };
  /** Research-only: require this many consecutive strong-regime eligible bars before strong release. */
  strongConfirmBars?: number;
  /** Research-only: bounded TQQQ release during CRISIS recovery when current-bar rebound conditions pass. */
  crisisRecoveryRelease?: {
    maxPct: number;
    roc5Min?: number;
    roc20Min?: number;
    /** Optional research-only current-bar QQQ return floor for crisis recovery release. */
    qqqOneDayMin?: number;
    vixMax?: number;
    vixRise5dMax?: number;
  };
  /** Research-only: permit a partial release on clean strong bars that score below the full-release threshold. */
  strongPartialRelease?: {
    minScore?: number;
    capacityPct?: number;
    releaseFraction: number;
    confirmBars?: number;
  };
  recoveryQualityOverride?: TrendParticipationQualityOverride;
  recoveryExcludeWeakening?: boolean;
  recoveryRegimes?: Array<'SIDEWAYS' | 'RANGE_BOUND' | 'RISK_ON_WEAKENING'>;
  conditionalHighExtensionCap?: {
    capPct: number;
    /** Research-only: when true, apply this cap only while release is active. */
    requireActive?: boolean;
    /** Research-only trigger ablation; omitted preserves the existing ROC5 OR VIX-rise rule. */
    triggerMode?: 'either' | 'both' | 'roc5' | 'vix_rise';
    /** Research-only regime split; omitted preserves BULL + RISK_ON_EXTENDED. */
    regimeIn?: Array<'BULL' | 'RISK_ON_EXTENDED'>;
    priceVsSma200MinPct?: number;
    priceExtensionAtrMin?: number;
    roc5Max?: number;
    vixRise5dMin?: number;
  };
  stickyBars?: number;
  strongFloorPct?: number;
  recoveryFloorPct?: number;
  /**
   * Research-only conditional recovery of the BEAR trend discount.
   * The normal discount remains unchanged unless all current-bar guards pass.
   */
  trendDiscountRecovery?: {
    factor: number;
    /** Research-only: restrict recovery to selected current regimes; omitted preserves BULL/RISK_ON_EXTENDED. */
    regimeIn?: Array<'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING'>;
    minScore?: number;
    vixMax?: number;
    vixRise5dMax?: number;
    realizedVolMax?: number;
    roc5Min?: number;
    roc20Min?: number;
    sma20SlopeMin?: number;
    er20Min?: number;
    priceVsSma200Min?: number;
    drawdownMax?: number;
    priceExtensionMax?: number;
    /** Research-only: do not restore the BEAR discount while strategy NAV drawdown is above this fraction. */
    navDrawdownMax?: number;
  };
  releaseFraction: number;
  strongCapacityPct: number;
  recoveryCapacityPct: number;
  confirmBars: number;
  normalHardCapPct: number;
};

export function navDrawdownGovernorTiers(config?: NavDrawdownGovernorConfig): NavDrawdownGovernorTier[] {
  if (!config) return [];
  return Array.isArray(config) ? config : config.tiers;
}

export function navDrawdownGovernorRegimeGated(config?: NavDrawdownGovernorConfig): boolean {
  return !Array.isArray(config) && config?.regimeGated === true;
}

/**
 * @frozen 字段的默认值/预设值变更，必须附带：
 * 1. robustness.ts 的 --perturbation 报告；
 * 2. robustness.ts 的 --walk-forward 报告；
 * 3. UI 窗口口径复核。
 * 三者缺一不可。
 */
export type StrategyParams = {
  /** Research-only: execute upstream TQQQ block sells at the signal close; omitted callers keep T+1. */
  researchSameDayUpstreamBlock?: boolean;
  researchSameDayUpstreamBlockMode?: 'all' | 'crisis';
  researchUpstreamRecoveryDelayBars?: number;
  /** Research-only: selectively execute a large T+1 target drop on the signal bar. */
  researchSameDayTargetDropPp?: number;
  /** Research-only: minimum prior actual TQQQ exposure for same-day target-drop execution. */
  researchSameDayTargetDropMinActual?: number;
  /** Research-only: restrict same-day target-drop execution to RANGE_BOUND bars whose target is at or below this terminal level. */
  researchSameDayTargetDropRangeBoundTerminalPct?: number;
  /** Research-only: optional ROC20 ceiling for the terminal RANGE_BOUND target-drop branch. */
  researchSameDayTargetDropRangeBoundRoc20Max?: number;
  /** Research-only: require a positive same-day TQQQ return for terminal RANGE_BOUND target-drop. */
  researchSameDayTargetDropRangeBoundTqqqUp?: boolean;
  researchSameDayTargetDropSkipCrisis?: boolean;
  researchSameDayTargetDropRiskOffOnly?: boolean;
  /** Research-only: restrict same-day target-drop execution to RISK_ON_WEAKENING bars. */
  researchSameDayTargetDropRiskOnWeakeningOnly?: boolean;
  /** Research-only: fraction of a qualifying target-drop sell executed on the signal close. */
  researchSameDayTargetDropFraction?: number;
  /** Research-only：高实际仓位且目标下降时，TQQQ 减仓信号按当日收盘执行；买入仍保持 T+1。 */
  researchSameDayStockDeRisk?: boolean;
  researchSameDayStockDeRiskMode?: 'all' | 'crisis' | 'high_vol' | 'risk_on_extended' | 'risk_on_extended_weak' | 'transition_loss' | 'risk_on_transition_loss' | 'bear_loss' | 'risk_on_weak_loss';
  /** Research-only: for transition_loss mode, require the same-day TQQQ return to be at or below this threshold. */
  researchSameDayStockDeRiskTqqqReturnMax?: number;
  /** Research-only: for risk_on_transition_loss, require QQQ ROC20 to be at or below this ceiling unless the NAV override is active. */
  researchSameDayStockDeRiskRiskOnTransitionRoc20Max?: number;
  /** Research-only: for risk_on_transition_loss, allow the same-day de-risk branch once NAV drawdown reaches this override floor. */
  researchSameDayStockDeRiskRiskOnTransitionNavDrawdownOverrideMin?: number;
  /** Research-only: for risk_on_weak_loss, require VIX 5d change at or above this floor. */
  researchSameDayStockDeRiskRiskOnWeakVixRise5dMin?: number;
  /** Research-only: for risk_on_weak_loss, require ROC20 at or below this ceiling. */
  researchSameDayStockDeRiskRiskOnWeakRoc20Max?: number;
  /** Research-only: for risk_on_weak_loss, require the current NAV drawdown to reach this floor. */
  researchSameDayStockDeRiskRiskOnWeakNavDrawdownMin?: number;
  /** Research-only: for risk_on_weak_loss, require the target to fall by at least this many percentage points. */
  researchSameDayStockDeRiskRiskOnWeakMinTargetDropPp?: number;
  /** Research-only: allow bear_loss same-day de-risk while the proposed target remains below this ceiling. */
  researchSameDayStockDeRiskBearTargetMax?: number;
  /** Research-only: minimum prior actual TQQQ exposure for same-day de-risk modes. */
  researchSameDayStockDeRiskMinActual?: number;
  /** Research-only: pause later TQQQ buys for N decision bars after a same-day de-risk fill. */
  researchSameDayStockDeRiskBuyCooldownBars?: number;
  /** Research-only: fraction of the qualifying TQQQ sell executed on the signal close; remainder stays T+1. */
  researchSameDayStockDeRiskFraction?: number;
  /** Research-only: local same-day de-risk fraction in an existing strong-trend recovery state; default off. */
  researchSameDayStockDeRiskStrongTrendFraction?: number;
  /** Research-only: local same-day de-risk fraction in a compact recovery-quality state; default off. */
  researchSameDayStockDeRiskRecoveryQualityFraction?: number;
  /** Research-only: allow the compact recovery-quality state to bypass the risk_on_transition_loss admission gates. */
  researchSameDayStockDeRiskRecoveryQualityException?: boolean;
  /** Research-only: minimum existing six-factor participation score for the recovery-quality exception. */
  researchSameDayStockDeRiskRecoveryQualityScoreMin?: number;
  /** Research-only: execute a qualifying clean risk-on TQQQ buy on the signal close; remainder stays T+1. */
  researchSameDayStockReRisk?: boolean;
  /** Research-only: fraction of the qualifying TQQQ buy executed on the signal close. */
  researchSameDayStockReRiskFraction?: number;
  /** Research-only: VIX ceiling for the qualifying same-day TQQQ buy. */
  researchSameDayStockReRiskVixMax?: number;
  /** Research-only: realized-volatility ceiling for the qualifying same-day TQQQ buy. */
  researchSameDayStockReRiskRealizedVolMax?: number;
  /** Research-only: compare a same-day re-risk buy against prior actual exposure instead of prior target. */
  researchSameDayStockReRiskFromActual?: boolean;
  /** Research-only: use the post-settlement current actual exposure for same-day re-risk. */
  researchSameDayStockReRiskUseCurrentActual?: boolean;
  /** Research-only: minimum prior actual TQQQ exposure for a same-day re-risk buy. */
  researchSameDayStockReRiskMinActual?: number;
  /** Research-only: allow a same-day buy when today's target jumps above prior actual, even if prior target was already met. */
  researchSameDayStockReRiskAllowTargetJump?: boolean;
  /** Research-only: when target-jump is enabled, restrict it to current BULL clean-budget bars. */
  researchSameDayStockReRiskCleanBudgetOnly?: boolean;
  /** Research-only: allow same-day stock re-risk only when risk budget is currently vol-target bound. */
  researchSameDayStockReRiskVolTargetOnly?: boolean;
  /** Research-only: while vol-target-only is enabled, also allow the existing trend-participation binding. */
  researchSameDayStockReRiskAllowTrendParticipation?: boolean;
  /** Research-only: narrow the trend-participation same-day bypass to already eligible state. */
  researchSameDayStockReRiskRequireTrendParticipationEligible?: boolean;
  /** Research-only: require this target floor for the trend-participation same-day bypass. */
  researchSameDayStockReRiskTrendParticipationTargetMinPct?: number;
  /** Research-only: require the existing trend-participation score to reach this floor before same-day re-risk. */
  researchSameDayStockReRiskTrendScoreMin?: number;
  /** Research-only: require the existing confirmed trend-participation state before same-day re-risk. */
  researchSameDayStockReRiskRequireTrendActive?: boolean;
  /** Research-only: require a same-day BOXX SELL proposal to fund the qualifying TQQQ re-risk BUY. */
  researchSameDayStockReRiskRequireBoxxSell?: boolean;
  /** Research-only: cap same-day TQQQ re-risk during an existing NAV drawdown. */
  researchSameDayStockReRiskNavDrawdownTargetCapPct?: number;
  /** Research-only: block a TQQQ target increase above this cap during an existing NAV drawdown. */
  researchNavDrawdownTargetIncreaseCapPct?: number;
  /** Research-only: NAV drawdown threshold for the target-increase cap. */
  researchNavDrawdownTargetIncreaseMinPct?: number;
  /** Research-only: cap the same-day target increase when target-jump is enabled. */
  researchSameDayStockReRiskMaxTargetJumpPp?: number;
  /** Research-only: conditional same-day target-jump ceiling when a large target/actual gap meets a non-rising-VIX, shallow-drawdown state. */
  researchSameDayStockReRiskGapVixMaxTargetJumpPp?: number;
  /** Research-only: conditionally replace the target-jump cap on low-RV BULL bars with non-rising VIX. */
  researchSameDayStockReRiskLowRvMaxTargetJumpPp?: number;
  /** Research-only: fraction of the excess jump to execute only inside the existing strong-trend jump state. */
  researchSameDayStockReRiskStrongTrendJumpFraction?: number;
  /** Research-only: let the low-RV target-jump cap also apply to RISK_ON_EXTENDED. Default off. */
  researchSameDayStockReRiskLowRvIncludeExtended?: boolean;
  /** Research-only: ER20 floor for the qualifying same-day TQQQ buy. */
  researchSameDayStockReRiskErMin?: number;
  /** Research-only: ROC20 floor for the qualifying same-day TQQQ buy. */
  researchSameDayStockReRiskRoc20Min?: number;
  /** Research-only: require the strong-trend core quality gate for same-day re-risk. */
  researchSameDayStockReRiskStrongCore?: boolean;
  /** Research-only: keep same-day re-risk restricted to SR02 unless explicitly relaxed. */
  researchSameDayStockReRiskSr02Only?: boolean;
  /** Research-only: allow the existing same-day re-risk safety gates in RANGE_BOUND. */
  researchSameDayStockReRiskAllowRangeBound?: boolean;
  /** Research-only: allow the existing same-day re-risk safety gates in RISK_ON_WEAKENING. */
  researchSameDayStockReRiskAllowRiskOnWeakening?: boolean;
  /** Research-only: allow a minimal cross-regime recovery score to bypass only BULL-specific re-risk gates. */
  researchSameDayStockReRiskCrossRegimeRecovery?: boolean;
  /** Research-only: restrict cross-regime recovery to an explicit state subset; omitted preserves SIDEWAYS/RANGE_BOUND. */
  researchSameDayStockReRiskCrossRegimeRecoveryRegimeIn?: Array<'SIDEWAYS' | 'RANGE_BOUND'>;
  /** Research-only: optional realized-volatility floor for the cross-regime recovery bridge. */
  researchSameDayStockReRiskCrossRegimeRecoveryRealizedVolMin?: number;
  /** Research-only: optional target-jump ceiling used only by the cross-regime recovery bridge. */
  researchSameDayStockReRiskCrossRegimeRecoveryMaxTargetJumpPp?: number;
  /** Research-only: reuse the independent-score jump ceiling for all actual recovery bridges. */
  researchSameDayStockReRiskSharedRecoveryJumpCap?: boolean;
  /** Research-only: use current actual exposure, rather than the prior path point, only in the cross-regime recovery bridge. */
  researchSameDayStockReRiskCrossRegimeRecoveryFromActual?: boolean;
  /** Research-only: extend current-actual confirmation to a separately gated clean BULL/EXTENDED recovery bridge. */
  researchSameDayStockReRiskCleanBullRecoveryFromActual?: boolean;
  /** Research-only: minimum independent participation score for current-actual recovery in BULL/EXTENDED. */
  researchSameDayStockReRiskIndependentScoreMin?: number;
  /** Research-only: local independent-score minimum used only in RISK_ON_WEAKENING; default inherits the global minimum. */
  researchSameDayStockReRiskIndependentScoreRiskOnWeakeningMin?: number;
  /** Research-only: local independent-score fallback used only when the risk budget is vol_target-bound. */
  researchSameDayStockReRiskIndependentScoreVolTargetMin?: number;
  /** Research-only: target floor for the vol_target-bound independent-score fallback. */
  researchSameDayStockReRiskIndependentScoreVolTargetTargetMin?: number;
  /** Research-only: execution fraction for the vol_target-bound score fallback only. */
  researchSameDayStockReRiskIndependentScoreVolTargetFraction?: number;
  /** Research-only: minimum prior target required by the strong-trend jump-cap override. */
  researchSameDayStockReRiskStrongTrendJumpPreviousTargetMinPct?: number;
  /** Research-only: allow a bounded continuation after a previously allowed independent-score recovery. */
  researchSameDayStockReRiskIndependentScoreCarryBars?: number;
  researchSameDayStockReRiskIndependentScoreTargetMin?: number;
  researchSameDayStockReRiskIndependentScoreAllowSlowBearLowTarget?: boolean;
  researchSameDayStockReRiskIndependentScoreRequireQqqUp?: boolean;
  researchSameDayStockReRiskIndependentScoreAllowSlowBullVixLowTarget?: boolean;
  researchSameDayStockReRiskIndependentScoreAllowSlowBullTrendLowTarget?: boolean;
  /** Research-only: allow the full independent participation score bridge in RANGE_BOUND. */
  researchSameDayStockReRiskIndependentScoreAllowRangeBound?: boolean;
  /** Research-only: cap execution fraction only for the independent-score RANGE_BOUND branch. */
  researchSameDayStockReRiskIndependentScoreRangeBoundFraction?: number;
  /** Research-only: local independent-score floor used only by the RANGE_BOUND bridge. */
  researchSameDayStockReRiskIndependentScoreRangeBoundMin?: number;
  /** Research-only: allow the full independent participation score bridge in SIDEWAYS. Default off. */
  researchSameDayStockReRiskIndependentScoreAllowSideways?: boolean;
  researchIndependentParticipationTargetBoostPct?: number;
  /** Research-only: allow the existing independent target boost in transition regimes, but only at score 6. */
  researchIndependentParticipationTargetBoostAllowTransitionRegimes?: boolean;
  /** Research-only: let trendDiscountRecovery honor trendParticipationRelease.stockPolicyIn; default preserves the growth-only gate. */
  researchTrendDiscountRecoveryUseStockPolicyIn?: boolean;
  /** Research-only: scoped stock-policy allow-list for trendDiscountRecovery only; does not widen other release branches. */
  researchTrendDiscountRecoveryStockPolicyIn?: Array<'SLOW_BULL_GROWTH' | 'SLOW_BULL_SHOCK' | 'SLOW_BEAR_DEFENSE' | 'SLOW_BEAR_RECOVERY'>;
  /** Research-only: capped micro-participation target for a confirmed-crisis rebound state. */
  researchConfirmedReboundTargetCapPct?: number;
  researchIndependentParticipationTargetVolMultiplier?: number;
  researchIndependentParticipationTargetVolScoreMin?: number;
  researchIndependentParticipationTargetVolNavDrawdownMaxPct?: number;
  /** Research-only: restrict the independent target-vol budget boost to the causal SLOW_BULL macro phase. */
  researchIndependentParticipationTargetVolSlowBullOnly?: boolean;
  /** Research-only: optional existing trend-score floor for the independent target-vol budget boost. */
  researchIndependentParticipationTargetVolTrendScoreMin?: number;
  /** Research-only: require non-negative same-day QQQ return for the independent target-vol budget boost. */
  researchIndependentParticipationTargetVolRequireQqqUp?: boolean;
  /** Research-only: multiply the final TQQQ target only while the independent recovery state is active. */
  researchIndependentParticipationTargetWeightMultiplier?: number;
  /** Research-only: minimum target-minus-actual gap for the final target overlay; omitted means no gap filter. */
  researchIndependentParticipationTargetWeightMinGapPp?: number;
  /** Research-only: VIX ceiling for the cross-regime recovery bridge; defaults to the historical 22 ceiling. */
  researchSameDayStockReRiskCrossRegimeRecoveryVixMax?: number;
  /** Research-only: optional ER20 floor inside the independent score bridge. */
  researchSameDayStockReRiskIndependentScoreErMin?: number;
  /** Research-only: optional ROC20 floor inside the independent score bridge. */
  researchSameDayStockReRiskIndependentScoreRoc20Min?: number;
  researchSameDayStockReRiskIndependentScoreSma20SlopeMin?: number;
  researchSameDayStockReRiskIndependentScoreTrendScoreMin?: number;
  researchSameDayStockReRiskIndependentScoreLowTrendScoreMax?: number;
  researchSameDayStockReRiskIndependentScoreLowTrendFraction?: number;
  /** Research-only: optional price-vs-SMA200 floor inside the independent score bridge. */
  researchSameDayStockReRiskIndependentScorePriceVsSma200MinPct?: number;
  /** Research-only: require the independent score's VIX-stable component. */
  researchSameDayStockReRiskIndependentScoreRequireVixStable?: boolean;
  /** Research-only: replace the independent score's VIX-stable point with a clean high-ER BULL/EXTENDED point when VIX is rising. */
  researchSameDayStockReRiskIndependentScoreAllowHighErVixRise?: boolean;
  /** Research-only: replace the independent score's VIX-stable point with a valid SLOW_BULL SR01/SR02 state point. */
  researchSameDayStockReRiskIndependentScoreAllowSlowSubregimePoint?: boolean;
  researchSameDayStockReRiskHighErVixRiseErMin?: number;
  researchSameDayStockReRiskHighErVixRiseCleanExtensionExtendedOnly?: boolean;
  /** Research-only: replace the independent score's VIX-stable point with a high-VIX but clean continuation point. */
  researchSameDayStockReRiskIndependentScoreAllowHighVixClean?: boolean;
  /** Research-only: allow the high-VIX clean-continuation score bridge to use its local 50% target floor. */
  researchSameDayStockReRiskIndependentScoreAllowHighVixCleanLowTarget?: boolean;
  researchSameDayStockReRiskIndependentScoreHighVixCleanTargetMin?: number;
  /** Research-only: override the high-VIX clean-continuation price-extension ceiling. */
  researchSameDayStockReRiskIndependentScoreHighVixCleanPriceExtensionMax?: number;
  /** Research-only: require the independent score's clean drawdown/extension component. */
  researchSameDayStockReRiskIndependentScoreRequireCleanShape?: boolean;
  /** Research-only: allow the independent score bridge to use its fifth-of-six score when QQQ is down, while leaving other paths unchanged. */
  researchSameDayStockReRiskIndependentScoreAllowQqqDown?: boolean;
  /** Research-only: replace the independent score's same-day QQQ direction with a positive short-window return. */
  researchSameDayStockReRiskIndependentScoreQqqReturnWindowBars?: number;
  /** Research-only: maximum same-day QQQ pullback allowed when the short-window direction is used. */
  researchSameDayStockReRiskIndependentScoreQqqReturnWindowCurrentDayFloor?: number;
  /** Research-only: allow a clean independent-score recovery bridge in RISK_ON_WEAKENING at a fixed 75% target floor. */
  researchSameDayStockReRiskIndependentScoreAllowRiskOnWeakening?: boolean;
  researchSameDayStockReRiskIndependentScoreRiskOnWeakeningTargetMin?: number;
  /** Research-only: bypass the independent score bridge's hard QQQ direction veto as one local semantic gate. */
  researchSameDayStockReRiskIndependentScoreBypassQqqDirectionGate?: boolean;
  /** Research-only: target-jump ceiling used only by the independent score bridge. */
  researchSameDayStockReRiskIndependentScoreMaxTargetJumpPp?: number;
  /** Research-only: bounded high-quality BULL/EXTENDED recovery jump ceiling; requires score 6, vol_target, QQQ up, stable VIX and low RV. */
  researchSameDayStockReRiskIndependentScoreHighQualityJumpCapPp?: number;
  /** Research-only: partial jump fraction scoped only to the high-quality jump override above. */
  researchSameDayStockReRiskIndependentScoreHighQualityJumpFraction?: number;
  /** Research-only: numerical tolerance for target-jump boundary comparisons. */
  researchSameDayStockReRiskTargetJumpEpsilonPp?: number;
  /** Research-only: execute a large recovery target jump partially, capped at the existing jump ceiling, instead of rejecting it outright. */
  researchSameDayStockReRiskQueueLargeTargetJump?: boolean;
  /** Research-only: emit same-day stock de-risk proposal diagnostics; default off. */
  researchSameDayStockDeRiskDiagnostic?: boolean;
  /** Research-only: when the independent score bridge is active, let the jump cap use actual exposure if actual is already near target. Default off. */
  researchSameDayStockReRiskIndependentScoreUseActualForJumpCap?: boolean;
  /** Research-only: when a high prior actual exposure was reset by the target path, let the independent-score jump cap use that prior actual as the restoration reference. Default off. */
  researchSameDayStockReRiskIndependentScoreUsePriorActualForJumpCap?: boolean;
  /** Research-only: minimum prior actual exposure required by the prior-actual restoration reference. */
  researchSameDayStockReRiskIndependentScorePriorActualMinPct?: number;
  /** Research-only: narrow clean-score actual-near-target jump cap; only applies to score 6/6, stable VIX, low RV, and shallow NAV drawdown. */
  researchSameDayStockReRiskIndependentScoreCleanActualJumpCapPp?: number;
  /** Research-only: strong-trend quality jump cap; only applies to high-score recovery under a vol-target budget. */
  researchSameDayStockReRiskStrongTrendJumpCapPp?: number;
  /** Research-only: require the existing shallow-drawdown/low-extension shape inside the strong-trend jump override. */
  researchSameDayStockReRiskStrongTrendJumpRequireCleanShape?: boolean;
  /** Research-only: minimum independent score for the strong-trend jump-cap override; default 5. */
  researchSameDayStockReRiskStrongTrendJumpScoreMin?: number;
  /** Research-only: current actual exposure floor for the strong-trend jump-cap override. */
  researchSameDayStockReRiskStrongTrendJumpMinActualPct?: number;
  /** Research-only: fraction of a 30–35pp independent-score jump executed same-day. */
  researchSameDayStockReRiskIndependentScorePartialJumpFraction?: number;
  /** Research-only: NAV drawdown ceiling under which the independent score jump override may apply. */
  researchSameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct?: number;
  /** Research-only: NAV drawdown ceiling for the independent participation score bridge. */
  researchSameDayStockReRiskIndependentScoreNavDrawdownMaxPct?: number;
  /** Research-only: when the independent score bridge allows same-day TQQQ re-risk, release the paired BOXX sell on the same bar. */
  researchSameDayStockReRiskReleaseBoxxSameDay?: boolean;
  /** Research-only: limit same-day BOXX funding release to BULL bars. */
  researchSameDayStockReRiskReleaseBoxxSameDayBullOnly?: boolean;
  /** Research-only: limit same-day BOXX funding release to the independent RISK_ON_WEAKENING bridge. */
  researchSameDayStockReRiskReleaseBoxxSameDayRiskOnWeakeningOnly?: boolean;
  /** Research-only: fraction of the paired BOXX sell released on the same bar. */
  researchSameDayStockReRiskReleaseBoxxSameDayFraction?: number;
  /** Research-only: NAV drawdown ceiling for same-day BOXX funding release. */
  researchSameDayStockReRiskReleaseBoxxSameDayNavDrawdownMaxPct?: number;
  /** Research-only: VIX ceiling for same-day BOXX funding release. */
  researchSameDayStockReRiskReleaseBoxxSameDayVixMax?: number;
  /** Research-only: retain per-day same-day re-risk gate outcomes for attribution; no strategy effect. */
  researchSameDayStockReRiskDiagnostic?: boolean;
  /** Research-only: minimum target-minus-actual gap for a same-day re-risk buy. */
  researchSameDayStockReRiskMinGapPp?: number;
  /** Research-only: optional lower gap floor used only inside a predeclared clean-BULL state. */
  researchSameDayStockReRiskLocalMinGapPp?: number;
  /** Research-only: scope for the local same-day re-risk gap floor; omitted keeps the global floor. */
  researchSameDayStockReRiskLocalMinGapMode?: 'clean_bull_dd1';
  /** Research-only: require the current TQQQ bar itself to be positive for same-day re-risk. */
  researchSameDayStockReRiskTqqqUp?: boolean;
  /** Research-only: in BULL, permit same-day re-risk with ROC5<0 only when VIX five-day change is non-positive. */
  researchSameDayStockReRiskAllowBullNegativeRoc5VixFall?: boolean;
  /** Research-only: allow a clean high-ER BULL/EXTENDED bridge through a rising-VIX gate while retaining the VIX level cap. */
  researchSameDayStockReRiskAllowHighErVixRise?: boolean;
  /** Research-only: require clean extension/drawdown bounds for the high-ER rising-VIX bridge. */
  researchSameDayStockReRiskHighErVixRiseCleanExtension?: boolean;
  /** Research-only: apply the clean-extension bounds only to RISK_ON_EXTENDED states with rising VIX. */
  researchSameDayStockReRiskHighErVixRiseCleanExtensionExtendedVixRiseOnly?: boolean;
  /** Research-only: optional trend-score floor for the high-ER rising-VIX bridge. */
  researchSameDayStockReRiskHighErVixRiseTrendScoreMin?: number;
  /** Research-only: replace the trend-score floor with the existing BULL trend state. */
  researchSameDayStockReRiskHighErVixRiseRequireBullTrend?: boolean;
  /** Research-only: override the high-ER rising-VIX clean-extension ATR ceiling. */
  researchSameDayStockReRiskHighErVixRiseCleanExtensionPriceExtensionMax?: number;
  /** Research-only: bridge same-day re-risk through selected VIX/ROC gates on a clean BULL/EXTENDED state. */
  researchSameDayStockReRiskCleanBullBridge?: 'vix_change' | 'vix_all' | 'vix_all_roc' | 'vix_all_roc_bull' | 'vix_all_roc_extended' | 'vix_all_roc_bull_qqq01' | 'vix_all_roc_bull_qqq02' | 'vix_all_roc_bull_dd3' | 'vix_all_roc_bull_ext20' | 'vix_all_roc_bull_sr02' | 'vix_cap_roc_bull' | 'vix_cap_roc_bull_roc5' | 'vix_cap_roc_bull_roc5m005' | 'vix_cap_roc_bull_roc5m010' | 'vix_cap_roc_bull_roc5m015' | 'vix_cap_roc_bull_weak0' | 'vix_cap_roc_bull_dd15' | 'vix_cap_roc_bull_dd20' | 'vix_cap_roc_bull_dd25' | 'vix_cap_roc_extended' | 'vix_cap_roc_extended_only';
  /** Research-only: require the prior QQQ bar to be positive in addition to the current-bar tail veto. */
  researchSameDayStockReRiskRequirePriorQqqUp?: boolean;
  /** Research-only: minimum prior-day QQQ return for the same-day re-risk continuity gate. */
  researchSameDayStockReRiskPriorQqqReturnMin?: number;
  /** Research-only: separate realized-vol ceiling for BULL/RISK_ON_EXTENDED same-day re-risk; RANGE_BOUND keeps the base ceiling. */
  researchSameDayStockReRiskRiskOnRealizedVolMax?: number;
  /** Research-only: minimum current-day QQQ return for same-day re-risk. */
  researchSameDayStockReRiskQqqReturnMin?: number;
  /** Research-only: restrict same-day re-risk to BULL bars. */
  researchSameDayStockReRiskBullOnly?: boolean;
  /** Research-only: require the prior TQQQ bar to be positive in the continuity gate. */
  researchSameDayStockReRiskRequirePriorTqqqUp?: boolean;
  /** Research-only: add current-day and no-rising-volatility tail vetoes. */
  researchSameDayStockReRiskTailVeto?: boolean;
  /** Research-only: process same-day equity SELLs before BUYs so BOXX liquidation can fund TQQQ purchases. */
  researchEquitySellFirst?: boolean;
  /** Research-only: size BOXX orders from the resolver's current execution price when the historical BOXX tape is absent. */
  researchBoxxOrderSizingAtCurrentPrice?: boolean;
  /** Research-only: blend historical BOXX sizing toward the current execution price; 1 means full correction. */
  researchBoxxOrderSizingCurrentPriceFraction?: number;
  /** Research-only: restrict current-price BOXX sizing to the existing clean BULL state. */
  researchBoxxOrderSizingMode?: 'all' | 'clean_bull' | 'clean_bull_gap' | 'slow_bull_gap';
  /** Research-only: enable SELL-before-BUY only when a pending TQQQ BUY target exceeds current actual exposure. */
  researchEquitySellFirstTargetIncreaseOnly?: boolean;
  /** Research-only: minimum target-minus-open-actual gap (percentage points) for target-increase SELL-before-BUY. */
  researchEquitySellFirstMinGapPp?: number;
  /** Research-only: restrict target-increase SELL-before-BUY to a causal signal-day quality gate. */
  researchEquitySellFirstMode?: 'all' | 'clean_bull' | 'clean_risk_on' | 'slow_bull_gap' | 'target80_high_gap' | 'target85_high_gap' | 'target90_high_gap' | 'target90_vol_resize';
  /** Research-only: ablate the same-day re-risk tail veto into one current-bar component. */
  researchSameDayStockReRiskTailVetoMode?: 'both' | 'vix_stable' | 'qqq_up';
  /** Research-only: allow the existing target-floor re-risk bypass when trend_discount is the binding constraint. */
  researchSameDayStockReRiskAllowTrendDiscount?: boolean;
  /** Research-only: current-bar trend participation release; omitted in production/default configs. */
  trendParticipationRelease?: TrendParticipationReleaseConfig;
  /** Research-only: suppress new TQQQ buys for N post-crisis decision bars. */
  researchRecoveryBuyDelayBars?: number;
  /** 仅回测独立单笔采样：按腿固定一张，绕过 NAV 风险预算。 */
  optionsBacktestPositionMode?: Partial<Record<'cs' | 'ic' | 'eb' | 'pcs' | 'bearCs', 'portfolio' | 'independent'>>;
  /** 实验参数：FR0 裁决 FAIL 未采纳；CAGR 增量疑似路径噪声（见 fr0 报告），仅供观察。0~1，如 0.10=10% 带宽。 */
  orderDeadbandPct?: number;
  /** Research-only: in RISK_ON_WEAKENING, widen only BUY deadband after a recent SELL. */
  researchRiskOnWeakeningBuyCooldownDays?: number;
  /** 实验参数：opt-in，默认 undefined/false 保持 P0b 后的安全行为（<1 张跳过）；打开后 CS/IC/EB/PCS/BearCS 在 quantity<1 且信号触发时强制开 1 张，回退至 P0b 修复前的旧行为，可能使单笔风险超过 riskBudget% 上限。仅供研究/回测观察。 */
  forceMinimumContract?: boolean;
  // E02 HardRiskRules
  // @frozen preset default
  maxTqqqHardPct: number;
  // @frozen preset default
  maxTqqqWarnPct: number;
  // @frozen preset default
  maxLeverage: number;
  // @frozen preset default
  minLiquidPct: number;
  // @frozen preset default
  maxDailyLossPct: number;
  // @frozen preset default
  drawdownWarnPct: number;
  // @frozen Default disabled / manual-only. 2026-07 calibration with preset-relative caps produced
  // no metric change on robustness slices or 2023-06-16..2026-06-12 UI window: existing
  // vol/warn/drawdown caps bound first. Keep as an explicit hard-risk override only.
  hardCapByRegime?: Partial<Record<MarketRegime, number>>;
  // E05 VolatilityTarget
  // @frozen preset default
  targetVol: number;
  // @frozen preset default
  minVolFloor: number;
  volEstimator?: VolEstimator; // default 'window'
  /** Research-only: use a separate volatility estimator only in BULL/RISK_ON_EXTENDED. */
  riskOnVolEstimator?: VolEstimator;
  /** Research-only: increase the target-vol budget only in sufficiently confident BULL bars. */
  bullConfidenceTargetVolMultiplier?: { multiplier: number; minConfidence?: number };
  bearVolBlend?: boolean; // default false — in BEAR/CRISIS use max(activeVol, VIX-led vol)
  // Opt-in M1 slow-macro sizing boost; omitted preserves baseline behavior.
  macroRegime?: { boostFactor: number; classifier?: MacroRegimeClassifier };
  // Opt-in F2/F3 macro boost momentum damping parameters; omitted preserves baseline behavior.
  // signal omitted/'sma20Slope' preserves F2's exact behavior; 'roc' (F3) drives damping off a
  // short-window QQQ rate-of-change instead, which reacts within days rather than ~1 week.
  macroBoostMomentumDamping?: { k: number; floor: number; ceil: number; signal?: 'sma20Slope' | 'roc'; rocDays?: number };
  // Opt-in G0 SLOW_BEAR-only targetVol/hardCap tightening; omitted or outside SLOW_BEAR preserves
  // baseline behavior exactly. Requires macroRegime to be set (macroRegimeState is only computed then).
  slowBearTargetVol?: { targetVol?: number; hardCapPct?: number };
  chopDampener?: { erThreshold?: number; minWeightFactor?: number; deadbandMult?: number }; // default disabled
  flipCooldownDays?: number; // default disabled; requires MarketInput.lastLeveragedTrade
  rangeBoundCapMode?: 'hard' | 'scaled'; // default 'hard'
  // @frozen Default disabled / manual-only. perSignalPct=.04 helped 2025 ultra/aggressive and some
  // 2018/2020 slices, but hurt 2023-24 bull and raised UI-window MDD for conservative/aggressive/ultra.
  // Uses 0.92 / 0.88 / 0.84 for 3/4/5 weakening signals; keep preset default at fixed 0.92.
  riskOnWeakeningGradedDiscount?: { perSignalPct: number };
  // Opt-in: override the fixed RISK_ON_WEAKENING discount (default 0.92). regime-diagnose.ts
  // (2026-07) found this regime's forward-20d return/negative-rate historically *better* than
  // BULL, suggesting the discount direction may be wrong — this lets us test values >1 as well
  // as <1. Default undefined falls back to fixed 0.92.
  riskOnWeakeningFactor?: number;
  /** Research-only conditional release of the RISK_ON_WEAKENING discount. */
  conditionalRiskOnWeakeningFactor?: {
    factor: number;
    vixMin?: number;
    vixMax?: number;
    vixRise5dMax?: number;
    realizedVolMax?: number;
    roc5Min?: number;
    er20Min?: number;
    priceVsSma200Min?: number;
    drawdownMax?: number;
  };
  /** Research-only: adjust the target-vol budget only in RISK_ON_WEAKENING. */
  researchRiskOnWeakeningTargetVolMultiplier?: number;
  /** Research-only: use the maximum of available short/medium realized-vol windows only in weakening. */
  researchRiskOnWeakeningUseMaxWindowVol?: boolean;
  /** Research-only: gate the weakening max-window-vol estimator by current TQQQ exposure. */
  researchRiskOnWeakeningUseMaxWindowVolMinActual?: number;
  /** Research-only: optional ROC20 ceiling for the weakening target-vol adjustment. */
  researchRiskOnWeakeningTargetVolRoc20Max?: number;
  /** Research-only: optional ROC5 ceiling for the weakening target-vol adjustment. */
  researchRiskOnWeakeningTargetVolRoc5Max?: number;
  /** Research-only: optional VIX 5-day rise floor for the weakening target-vol adjustment. */
  researchRiskOnWeakeningTargetVolVixRise5dMin?: number;
  /** Research-only classifier threshold; undefined preserves the frozen 3/5 default. */
  riskOnWeakeningMinSignals?: number;
  /** Research-only VIX ceiling for RISK_ON_WEAKENING; undefined preserves the frozen 25 ceiling. */
  riskOnWeakeningVixMax?: number;
  // Opt-in: override the fixed BEAR regime discount (default 0.5). Default undefined falls back
  // to fixed 0.5, preserving the existing BEAR target-weight behavior.
  bearRegimeFactor?: number;
  // Opt-in: override the fixed SIDEWAYS discount (default 0.85). regime-diagnose.ts (2026-07)
  // found SIDEWAYS forward-20d return/negative-rate nearly indistinguishable from BULL,
  // suggesting this discount may double-penalize a period VolatilityTarget's realized-vol
  // sizing already accounts for. Default undefined falls back to fixed 0.85.
  sidewaysFactor?: number;
  /** Research-only: replace the SIDEWAYS discount only on clean current bars. */
  conditionalSidewaysFactor?: {
    factor: number;
    minScore?: number;
    vixMax?: number;
    vixRise5dMax?: number;
    realizedVolMax?: number;
    roc5Min?: number;
    roc20Min?: number;
    sma20SlopeMin?: number;
    er20Min?: number;
    priceVsSma200Min?: number;
    drawdownMax?: number;
    priceExtensionMax?: number;
  };
  // @frozen Default false / manual-only. Front-loading regime sizing helped the UI window for neutral/ultra
  // and some 2025 / 2022 aggressive slices, but hurt 2022 ultra and 2023-24 ultra. Revisit preset
  // adoption only in a separate step with tighter bear-slice gates.
  regimeTargetVolMode?: boolean;
  // @frozen Opt-in: split RANGE_BOUND cap by price_vs_sma200_pct — bull-market high consolidation
  // (price well above SMA200) gets a higher cap than a true no-direction chop near SMA200.
  // Default disabled: falls back to existing rangeBoundCapMode behavior.
  // 2026-07 calibration: highCap 25% improved 2020 but hurt most 2023-26 / 2025 chop windows
  // by lifting exposure in false consolidations; keep manual only for confirmed high-base bull chop.
  rangeBoundDirectionalCap?: {
    highThresholdPct: number; // e.g. 0.08 — price_vs_sma200_pct above this = bull consolidation
    highCapPct: number;       // e.g. 0.25 — cap used above threshold
    /** Research-only: optionally require the existing six-factor independent participation score. */
    independentScoreMin?: number;
    /** Research-only: upper price-vs-SMA200 boundary to exclude overextended consolidations. */
    highMaxThresholdPct?: number;
    /** Research-only: portfolio NAV drawdown guard for the independent cap. */
    navDrawdownMaxPct?: number;
    /** Research-only: optional slow-subregime allow-list for the independent cap. */
    slowSubregimeIn?: readonly ('SR01' | 'SR02')[];
    /** Research-only: when true, do not fall through to the legacy price-only cap. */
    gatedOnly?: boolean;
  };
  /** Research-only: raise RANGE_BOUND cap only when the existing four-factor trend quality is clean. */
  rangeBoundQualityCap?: {
    capPct: number;
    minScore?: number;
    vixMax?: number;
    vixRise5dMax?: number;
    /** Research-only: keep the quality cap limited to lower raw-volatility targets. */
    rawWeightMax?: number;
  };
  // @frozen Opt-in continuous sizing factor on top of the regime discrete discount. Scales the
  // regime_adjusted_weight by a linear function of QQQ SMA20 slope, so weight moves smoothly
  // across regime-classification boundaries instead of stepping. Default disabled (undefined).
  // 2026-07 calibration: k=3/floor=.6/ceil=1.15 helped 2025 chop and aggressive bull, but
  // hurt neutral 2020 and ultra 2022; keep manual for slope-aware chop reduction, not preset default.
  slopeSizingFactor?: {
    k: number;        // multiplier steepness, e.g. 3
    floor: number;    // e.g. 0.6 — min multiplier
    ceil: number;     // e.g. 1.15 — max multiplier
    regimes?: MarketRegime[]; // default applies to all non-CRISIS/BEAR regimes
  };
  // @frozen Smooth final TQQQ target changes asymmetrically. halfLifeBars preserves the existing
  // upward-only behavior; downHalfLifeBars only damps safe downward moves.
  // Requires MarketInput.targetWeightSmoothingState; live callers without state degrade to no smoothing.
  // 2026-07 chop-opt Stage 5 Arm L: downward smoothing + VIX gate is ultra's default:
  // chop flips -25%, chop_2026H1 CAGR +16.7pp, user-slice Calmar +0.15; accepted cost is
  // melt-up MDD +4.06pp. See docs/overlay-tuning/baseline-chop-opt-2026-07.md. Upward
  // halfLifeBars remains opt-in.
  // undefined = disabled.
  targetWeightSmoothing?: {
    halfLifeBars?: number;
    downHalfLifeBars?: number;
    downVixCeiling?: number;
    // 回撤起点单 bar target 大幅下坠时跳过下行平滑；2026-07 melt-up 调参结论。
    downMaxDropPp?: number;
  };
  /** Research-only: hold a prior 90% target for one clean BULL bar when vol-target drops it. */
  researchTargetPersistenceMode?: 'clean_bull_target90' | 'clean_bull_target90_adx_lt30' | 'clean_bull_target90_not_strong_trend' | 'clean_bull_target90_roc5_le25';
  /** Research-only: fraction of the prior-to-current target drop to retain; defaults to 1. */
  researchTargetPersistenceFraction?: number;
  /** Research-only: add a bounded clean-BULL target release only when actual exposure is materially below target. */
  researchStrongGapRelease?: {
    /** `p37_vix_tier` reproduces the P37 participation-state dose on the full engine path. */
    mode?: 'p37_vix_tier';
    addPct: number;
    minGapPp: number;
    /** P37 uses a release proportional to the target/actual gap. */
    dosePct?: number;
    tierMultiplier?: number;
    minTargetPct?: number;
    navDrawdownMaxPct?: number;
    stateGapPp?: number;
    vixChange5dMax?: number;
    /** Research-only P62 simplification: release only when the unmodified budget is vol_target-bound. */
    requireVolTargetBinding?: boolean;
    er20Min?: number;
    realizedVolMax?: number;
    vixMax?: number;
    qqqReturnMin?: number;
    priceExtensionMax?: number;
    drawdownMaxPct?: number;
  };
  /** Research-only: selectively relax the down-smoothing drop limit during confirmed transition weakness. */
  researchTransitionDownSmoothing?: {
    maxDropPp: number;
    regimeIn?: Array<'SIDEWAYS' | 'RISK_ON_WEAKENING'>;
    vixMin?: number;
    vixRise5dMin?: number;
    roc5Max?: number;
  };
  /** Research-only: cap the target in RISK_ON_WEAKENING when ROC20 is negative. */
  researchRiskOnWeakeningNegativeRoc20TargetCapPct?: number;
  /** Research-only: ROC20 ceiling for the RISK_ON_WEAKENING target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapRoc20Max?: number;
  /** Research-only: optional ROC5 ceiling for the RISK_ON_WEAKENING target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapRoc5Max?: number;
  /** Research-only: optional VIX 5-day rise floor for the RISK_ON_WEAKENING target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapVixRise5dMin?: number;
  /** Research-only: optional distance-to-SMA20 ceiling for the RISK_ON_WEAKENING target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapDistanceToSma20Max?: number;
  /** Research-only: optional realized-volatility ceiling for the RISK_ON_WEAKENING target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapRealizedVol20dMax?: number;
  /** Research-only: require current TQQQ exposure before applying the weakening target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapMinActual?: number;
  /** Research-only: require the prior smoothed TQQQ target before applying the weakening target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapMinPriorTarget?: number;
  /** Research-only: require the uncapped current target before applying the weakening target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapMinCurrentTarget?: number;
  /** Research-only: require the weakening target to have dropped from the prior smoothed target. */
  researchRiskOnWeakeningNegativeRoc20TargetCapMinPriorTargetDropPp?: number;
  /** Research-only: apply the weakening target cap only on a strong-regime to weakening transition. */
  researchRiskOnWeakeningNegativeRoc20TargetCapTransitionOnly?: boolean;
  /** Research-only: optional same-day TQQQ return ceiling for the weakening target cap. */
  researchRiskOnWeakeningNegativeRoc20TargetCapTqqqReturnMax?: number;
  /** Research-only: block weakening recovery participation when current exposure is high. */
  researchRiskOnWeakeningRecoveryHighExposureBlockMinActual?: number;
  /** Research-only: VIX 5-day rise floor for the high-exposure recovery block. */
  researchRiskOnWeakeningRecoveryHighExposureBlockVixRise5dMin?: number;
  /** Research-only: cap a single upward target jump in BULL when ROC20 is negative. */
  researchBullNegativeRoc20TargetJumpCapPp?: number;
  /** Research-only: cap BULL targets when short-term ROC5 is negative. */
  researchBullNegativeRoc5TargetCapPct?: number;
  /** Research-only: ROC5 ceiling for the BULL target cap. */
  researchBullNegativeRoc5TargetCapRoc5Max?: number;
  /** Research-only: require current TQQQ exposure before applying the BULL target cap. */
  researchBullNegativeRoc5TargetCapMinActual?: number;
  /** Research-only: soft target reduction in BULL when short-term ROC5 is negative. */
  researchBullNegativeRoc5TargetReductionPp?: number;
  /** Research-only: apply the BULL target cap before existing downward smoothing. */
  researchBullNegativeRoc5TargetCapBeforeSmoothing?: boolean;
  /** Research-only: allow the BULL target cap only when vol-target is the original binding. */
  researchBullNegativeRoc5TargetCapVolTargetOnly?: boolean;
  /** Research-only: optional same-day TQQQ return ceiling for the BULL target cap. */
  researchBullNegativeRoc5TargetCapTqqqReturnMax?: number;
  /** Research-only: optional VIX 5-day rise floor for the BULL target cap. */
  researchBullNegativeRoc5TargetCapVixRise5dMin?: number;
  // E06 RiskBudget
  // @frozen preset default
  minCashReserve: number;
  // @frozen preset default — Opt-in: override the fixed STRONG_BEAR trend discount (default 0.5). Default undefined falls
  // back to fixed 0.5, preserving the existing STRONG_BEAR final-allocation behavior.
  strongBearTrendFactor?: number;
  // @frozen preset default — 2026-07 melt-up 窗口回归修复：仅非 BEAR/CRISIS regime 下使用。
  strongBearTrendFactorChop?: number;
  // Opt-in: override the fixed BEAR trend discount (default 0.75). Default undefined falls back
  // to fixed 0.75, preserving the existing BEAR final-allocation behavior.
  bearTrendFactor?: number;
  // @frozen preset default
  navDrawdownGovernor?: NavDrawdownGovernorConfig; // default disabled; object form supports regimeGated opt-in
  // @frozen preset default — E10 upstream-BLOCK defensive sell target. 'target' (default) sells to
  // min(hardMax, final_tqqq_pct); 'hardmax' sells only to the hardMax ratchet
  // (drawdown constraint still caps ~25%) and rides V-recoveries. 'blend' sells to
  // an interpolation between those targets; 0=pure hardmax, 1=pure target. 'ramp' sells
  // toward the target like 'target', but caps each bar's sell value at maxSellPerBarPct:
  // a middle path between hardmax riding V-recoveries with deeper MDD and target's full exit.
  // 2026-07 bear-exposure-diagnose.ts found hardmax leaves aggressive/ultra 5-8pp
  // above the BEAR RiskBudget target for weeks with zero equity orders.
  // 'blend' at weight 0.5 was tested as the fix: didn't help 2022 aggressive, made
  // 2022 ultra MDD worse (27.6%→31.2%), and eroded the 2020 V-recovery gain 'hardmax'
  // exists for (aggressive CAGR 31.6%→26.3%, ultra 42.6%→33.2%). Adopted in aggressive/ultra presets.
  upstreamBlockSellMode?: 'target' | 'hardmax' | 'blend' | 'ramp';
  // @frozen preset default — 2026-07 melt-up 窗口回归修复：仅非 BEAR/CRISIS regime 下使用。
  upstreamBlockSellModeChop?: 'target' | 'hardmax' | 'blend' | 'ramp';
  upstreamBlockSellBlendWeight?: number; // default 0.5 when mode='blend'
  // 仅供研究基线显式关闭；配置任意 macroRegime classifier 时生产默认自动启用。
  stockMacroPolicyEnabled?: boolean;
  // 经固定快照搜索和稳健性门槛裁决后的生产 winner；研究候选沿用同一结构但只存在于扫描脚本。
  stockPhasePolicy?: Partial<Record<StockPhasePolicyId, StockPhasePolicyRule>>;
  /**
   * 研究专用：只在短期价格冲击、VIX 高位或 CRISIS_PENDING 后临时压低 Growth 上限；
   * 恢复确认（crisis NONE、QQQ 站上 SMA20 且 ROC5>=0）后立即解除。绝不进入 preset/UI/API。
   */
  conditionalGrowthCap?: ConditionalGrowthCapConfig | null;
  /** Research-only; omitted preserves the frozen normal hard/soft caps. */
  conditionalHardCapRaise?: ConditionalHardCapRaiseConfig | null;
  // @frozen preset default
  flashCrashOverride?: {
    vixSpikeRatio?: number;
    vixMin?: number;
    maxSpeedDays?: number;
    drawdownThreshold?: number;
    mode: 'hardmax';
    confirmBars?: number;
    releaseBars?: number;
  } | null;
  // 2026-07-22 研究 opt-in（未采纳，禁止设为 preset 默认）：TQQQ 闪崩提前预警（信用线 + Topping 线，
  // 见 tail-risk-signals.ts）触发时，将 TQQQ 目标仓位乘以 multiplier，持续 releaseBars 个交易日后
  // 自动解除。releaseBars 是纯日历/交易日倒计时（updateTailRiskState），不是交易计数式门控。
  // 由 tailRiskTriggerByDate（研究专用逐日 replay，见 backtest/types.ts）驱动，永不进入生产 RunSpec/API/UI。
  tailRiskOverride?: {
    multiplier: number; // 例如 0.5 = 降到当前目标仓位的 50%
    releaseBars?: number; // 默认 10
  } | null;
  // 2026-07-22 研究 opt-in（未采纳，禁止设为 preset 默认）：tail-risk 信号触发期间（复用
  // tailRiskOverride 驱动的 currentTailRiskState.active，日历/交易日倒计时解除）临时强制
  // enableCollar=true + collarMode=<此处配置>，买 protective put（可选卖 covered call 摊薄权利金）；
  // 信号不活跃时 Collar 回落到 enableCollar 原始配置（通常是 false）。必须同时配置 tailRiskOverride
  // （即使 multiplier:1 不做仓位缩放）以驱动状态机。见 pipeline.ts 中的应用点。
  tailRiskCollarOverride?: {
    collarMode?: CollarMode; // 默认 'always'
    /** 默认 both；callOnly 仅卖 covered call，不买 protective put。 */
    legMode?: 'putOnly' | 'callOnly' | 'both';
  } | null;
  // @frozen preset default — 非风险豁免的杠杆 SELL 单笔上限（NAV 占比 / 每决策 bar）。
  // 风险类卖出（hard_risk / BEAR / CRISIS / intraday gate）永不限速；仅 upstream BLOCK
  // 的 ramp 模式受此上限约束。
  // 无状态、live 与回测行为一致。undefined = 关闭（沿用单笔全额卖出）。
  maxSellPerBarPct?: number;
  // Opt-in F4: exempt maxSellPerBarPct whenever the crisis state machine (not just regime's
  // literal label) is CONFIRMED/RECOVERY. Omitted preserves baseline behavior (regime-label-only
  // exemption). See docs/overlay-tuning/f4-crisis-phase-sell-exempt-2026-07.md.
  crisisPhaseSellExempt?: boolean;
  // @frozen preset default — Overlay CS total risk budget as fraction of NAV; defaults to CS_MAX_TOTAL_RISK_NAV (0.10).
  csMaxTotalRiskNav?: number;
  regimeConfirmBars?: number; // default disabled; requires MarketInput.regimeConfirmState
  // @frozen preset default
  sellDeltaByRegime?: Partial<Record<string, number>>; // default disabled; falls back to MIN_SELL_DELTA_PCT
  // @frozen preset default — Only apply SIDEWAYS/RANGE_BOUND/RISK_ON_WEAKENING sellDeltaByRegime when QQQ ER20 >= this.
  // Low-ER chop falls back to MIN_SELL_DELTA_PCT. BEAR/CRISIS tightened values always apply.
  // undefined = unconditional legacy behavior.
  sellDeltaErThreshold?: number;
  /** Research-only: use a smaller weakening sell deadband only when actual exposure is above target by a material gap. */
  researchRiskOnWeakeningOverweightSellDelta?: { minGapPp: number; sellDeltaPp: number };
  /** Research-only: use a smaller weakening sell deadband only on a losing TQQQ day. */
  researchRiskOnWeakeningLossSellDelta?: { sellDeltaPp: number; tqqqReturnMax?: number };
  /** Research-only: raise the sell ramp only when weakening exposure is materially above target. */
  researchRiskOnWeakeningOverweightMaxSellPerBar?: { minGapPp: number; maxSellPerBarPct: number };
  // Overlay switches
  // UI profile default false after 2026-07 calibration: full collar mode x anchor x exit matrix
  // did not beat disabled; protection duty moves to fast de-leveraging + csMode='extreme'.
  enableCollar?: boolean;   // default true — allow Collar/Put Spread Collar
  collarMode?: CollarMode;
  /** 研究专用 Collar 腿选择；未设置保持原有 Collar 行为。 */
  collarLegMode?: 'putOnly' | 'callOnly' | 'both';
  allowCollarAsAlternativeToSell?: boolean; // opt-in: when actual TQQQ weight > target + 3%, open collar instead of reducing position
  enableCS?: boolean;       // default true — allow Call Credit Spread
  csMode?: CSMode;
  /** 研究专用 CS-SP 频率臂；默认仅在 csMode='sp_like' 时生效。 */
  csSpLikeVixHigh?: number; // default 20; lower bound follows PCS 14
  csSpLikeExtensionGate?: number; // default 2 ATR; blocks new CS only when sp_like is active
  csShortDelta?: number; // default 0.20; reactive Call short-leg target
  csSpLikeShortDelta?: number; // default 0.15; farther OTM short leg for sp_like
  csSpLikeDynamicCalmVix?: number; // default 16; calm-state cutoff for sp_like_dynamic
  csSpLikeDynamicCalmRoc20?: number; // default 0.20; BULL must also clear this momentum threshold for calm treatment
  csSpLikeDynamicCalmDelta?: number; // default 0.20; calm strong-trend short-leg target
  csSpLikeDynamicCalmDeltaRegimeScope?: 'all' | 'bull' | 'risk_on_extended' | 'bull_or_risk_on_extended';
  csSpLikeDynamicWeakDelta?: number; // default 0.15; neutral/weakening short-leg target
  csSpLikeDynamicRequireTermStructure?: boolean; // default true; live fail-closed when VIX3M is unavailable
  csSpLikeDynamicCalmExtensionGate?: number; // default 3 ATR; only calm strong-trend dynamic entries use the wider gate
  /** 研究专用：按 QQQ SMA20 斜率和斜率加速度动态选择 CS 短腿；默认 off。 */
  csSlopeShortLegMode?: CSSlopeShortLegMode;
  /** slow_trend_v1 仅在慢涨状态启用动态外移，快速加速时交给紧急止损。 */
  csSlopeShortLegSlowTrendOnly?: boolean;
  /** 斜率短腿进入快速上行档的 SMA20 5日斜率阈值。 */
  csSlopeShortLegFastSlopePct?: number;
  /** 斜率短腿快速上行档的短 Call Delta，默认 .10。 */
  csSlopeShortLegFastDelta?: number;
  /** 斜率短腿慢涨档的短 Call Delta，默认 .15。 */
  csSlopeShortLegSlowDelta?: number;
  /** 研究专用：慢涨状态下的 Delta 止损处理。 */
  csSlowTrendExitMode?: CSSlowTrendExitMode;
  /** 慢涨识别的最低 SMA20 5日斜率，默认 0。 */
  csSlowTrendSlopeMinPct?: number;
  /** 慢涨识别的最低 QQQ ROC20，默认 0。 */
  csSlowTrendQqqRoc20Min?: number;
  /** 慢涨识别的最高 QQQ ROC5，超过后视为快速上冲。 */
  csSlowTrendQqqRoc5Max?: number;
  /** 慢涨识别的 VIX 上限，默认 20。 */
  csSlowTrendVixMax?: number;
  /** 慢涨状态放宽后的 Delta 止损阈值，默认 .40。 */
  csSlowTrendDeltaStopThreshold?: number;
  /** confirm2_hysteresis 额外的 Delta 滞后带，默认 .03。 */
  csSlowTrendDeltaStopHysteresis?: number;
  /** 研究专用：慢涨状态下的条件止盈目标（占 credit 比例），覆盖 csProfitTarget；undefined=关闭。 */
  csSlowTrendProfitTarget?: number;
  /** 研究专用：慢涨状态下条件止盈的临到期天数阈值，覆盖 csConditionalProfitTakeMaxDte；undefined=关闭。 */
  csSlowTrendConditionalPtMaxDte?: number;
  /** 快速上冲识别的 QQQ ROC5 阈值，默认 .04。 */
  csSlowTrendFastAccelerationRoc5?: number;
  /** 快速上冲识别的 SMA20 5日斜率阈值，默认 .015。 */
  csSlowTrendFastAccelerationSlopePct?: number;
  /** 快速上冲时恢复盘中止损的 Delta 阈值，默认 .30。 */
  csSlowTrendFastAccelerationDeltaStopThreshold?: number;
  /** 快速上冲紧急止损总开关；默认关闭，避免改变既有慢涨回测基线。 */
  csSlowTrendFastAccelerationEmergency?: boolean;
  /** 研究专用：当前 bar 短 Call Delta 相对前收 Delta 的单日跳升阈值；undefined=关闭。 */
  csDeltaAccelerationThreshold?: number;
  /** 扩展牛市禁止消费慢涨延迟保护；默认关闭，研究臂使用。 */
  csSlowTrendBlockExtended?: boolean;
  csTransitionExitMode?: CSTransitionExitMode;
  csConditionalWidthMode?: CSConditionalWidthMode;
  csConditionalWidthPct?: number;
  csConditionalWidthExtensionMax?: number;
  /** 将低 VIX + 扩展动量视为扩展牛市的 TQQQ ROC20 下限，默认 .20。 */
  csSlowTrendExtendedTqqqRoc20Min?: number;
  /** 低 VIX 扩展牛市独立 Delta 上限；undefined=关闭。 */
  csExtendedLowVixDeltaCap?: number;
  /** 低 VIX 扩展牛市识别的 VIX 上限，默认 18。 */
  csExtendedLowVixVixMax?: number;
  /** 低 VIX 扩展牛市识别的 TQQQ ROC20 下限，默认 .20。 */
  csExtendedLowVixTqqqRoc20Min?: number;
  /** 研究专用：仅低 VIX 扩展牛市 Delta cap 触发时允许信号日模型平仓；默认关闭。 */
  csExtendedLowVixImmediateClose?: boolean;
  /** 同日 cap 平仓的成交敏感性：signal_close（默认）或 worst_of。 */
  csExtendedLowVixImmediateCloseMode?: 'signal_close' | 'worst_of';
  /** 研究专用：CS 选约消费 PCS-CS 组合预期 P&L 代理。 */
  csPortfolioScoreMode?: CSPortfolioScoreMode;
  /** PCS-CS 组合预期 P&L 进入 CS 选约排序的权重，默认 .50。 */
  csPortfolioScoreWeight?: number;
  csTargetDte?: number; // default SPREAD_TARGET_DTE (28); CS research DTE override
  csSpreadWidthPct?: number; // default CS_SPREAD_WIDTH_PCT (2%); CS research width override
  // UI profile default true after 2026-07 calibration: main window CS opens 12→16,
  // CS pnl 1545→11396, MDD 5.6%→4.2%; robustness worst MDD hit is 2018 +1.99pp.
  // DEFAULT_STRATEGY_PARAMS remains unchanged unless a preset/profile sets this.
  csProfitTakeEnabled?: boolean; // default false — opt-in early profit-take, frees slot for dead-cat-bounce re-entry
  csProfitTarget?: number;       // 0.5 | 0.6 | 0.75 — close when profit reaches this % of credit, default 0.6
  /** Research-only: apply a separate main-layer profit target only in the selected existing regime; unset preserves the base target. */
  csProfitTargetRegimeMode?: 'risk_on_extended' | 'bull_or_risk_on_extended' | 'bull_only' | 'range_or_weakening' | 'range_only' | 'weakening_only';
  /** Research-only: target override paired with csProfitTargetRegimeMode; unset preserves the base target. */
  csProfitTargetRegimeValue?: number;
  /** Research-only: macro trigger for conditional main-layer profit taking; omitted preserves weakening OR backwardation. */
  csConditionalProfitTakeRiskMode?: 'weakening_or_backwardation' | 'backwardation_only' | 'weakening_only' | 'backwardation_or_weakening_high_vix' | 'backwardation_or_high_vix' | 'weakening_or_high_vix';
  /** Research-only: VIX floor used by the conditional profit-take high-VIX modes. */
  csConditionalProfitTakeWeakeningVixMin?: number;
  /** 研究专用：最终 CS proposal 的最低 credit（每股 premium；回放每张金额约为其 100 倍）；undefined 或 <=0=关闭。 */
  csResearchMinCredit?: number;
  /** 研究专用：最低 credit 门的 regime 范围；默认 all。 */
  csResearchMinCreditScope?: 'all' | 'range_bound' | 'range_bound_sr01' | 'range_bound_sr01_vix_ge_15_5' | 'range_bound_sr01_vix_ge_15_75' | 'range_bound_sr01_vix_ge_16' | 'range_bound_vix_ge_15_5' | 'range_bound_vix_ge_15_5_vix_rising' | 'range_bound_vix_ge_15_5_vix_not_rising' | 'range_bound_vix_ge_15_75' | 'range_bound_vix_ge_16' | 'range_bound_sr02' | 'range_bound_vix_lt_15_0' | 'range_bound_vix_lt_15_5' | 'range_bound_vix_lt_16' | 'risk_on_weakening' | 'bull' | 'bull_or_risk_on_weakening';
  csProfitTakeMode?: CSProfitTakeMode; // default fixed; conditional only exits late/weakening/backwardation winners
  csConditionalProfitTakeMaxDte?: number; // default 14; conditional mode's late-life threshold
  csDeltaStopThreshold?: number; // default 0.35; short Call Delta hard stop threshold
  /** C0.E27 research-only: per-position loss cap in dollars; undefined=off. */
  csResearchMaxLossDollars?: number;
  /** Research-only: per-position loss trigger as a fraction of current stock NAV; supersedes the defined-risk and absolute variants when valid. */
  csResearchMaxLossNavPct?: number;
  /** Research-only alternative: exit loss cap as a fraction of the position's defined maximum risk; overrides the absolute dollar cap when valid. */
  csResearchMaxLossRiskPct?: number;
  csDeltaStopMode?: CSDeltaStopMode; // default fixed; research-only state-conditioned exit threshold
  csDeltaStopCalmVix?: number; // default 18; stateful mode's calm-state cutoff
  csDeltaStopRiskVix?: number; // default 20; stateful mode's high-pressure cutoff
  csDeltaStopCalmRoc20?: number; // default 0.20; stateful BULL strong-trend evidence
  csDeltaStopCalmThreshold?: number; // default 0.40; stateful calm/strong-trend threshold
  csDeltaStopRiskThreshold?: number; // default 0.30; stateful high-pressure threshold
  /** C0.E20 research-only: widen base Delta-stop only in one regime. */
  csDeltaStopWideThreshold?: number;
  csDeltaStopWideRegime?: string;
  csDeltaStopWideTqqqRoc20Min?: number;
  /** 研究专用：VXN 5日上升时覆盖 stateful risk 分支阈值；默认关闭。 */
  csResearchRiskGuardMode?: 'off' | 'vix_rising';
  /** 研究专用：VXN risk guard 激活时使用的 risk 分支阈值。 */
  csResearchRiskGuardThreshold?: number;
  /** CCS TransitionCore-4：已验证的 score4 条件腿模式。 */
  csTransitionRiskMode?: string;
  /** CCS WR-89：VIX falling / weak Delta-stop rescue。 */
  csResearchDeltaStopRescueMode?: string;
  csResearchDeltaStopRescueMinDaysLeft?: number;
  /** CCS WR-89 Compact Controller：亏损后风险信号控制器。 */
  csWr89CompactController?: boolean;
  csWr89CooldownOpportunities?: number;
  /** C0.E40 research-only: allow SR02 during WR-89 cooldown when other rescue rules do not apply. */
  csWr89CooldownRescueMode?: 'off' | 'sr02' | 'sr02_risk_on' | 'sr02_risk_on_range_low_rv' | 'sr02_risk_on_range_credit_extreme' | 'sr02_risk_on_range_credit_extremes' | 'sr02_risk_on_range_low_credit' | 'sr02_risk_on_range_high_credit' | 'sr02_compact' | 'sr01_quality_compact' | 'c1_sr01_quality' | 'c1_hardgate_quality';
  csTransitionConditionalGate?: boolean;
  csTransitionConditionalCreditMax?: number;
  csTransitionConditionalRvMin?: number;
  csTransitionConditionalRvMax?: number;
  /** C0.E4 research-only: release the transition block when term structure is healthy. */
  csTransitionConditionalTermSlopeMax?: number;
  /** C0.E5 research-only: limit the term-slope release to one market regime. */
  csTransitionConditionalTermSlopeReleaseRegime?: string;
  /** 研究专用：仅满足 VXN≥24、QQQ ROC20<0 且 VXN 5日上升时覆盖动态 CS 弱化短腿 Delta；默认关闭。 */
  csResearchVxnRescueDelta?: number;
  /** 研究专用：VXN rescue 最低触发边界；省略保持默认 24。 */
  csResearchVxnRescueMinVix?: number;
  /** 研究专用：VXN rescue Delta 的市场 VIX 上限；省略则不设上限。 */
  csResearchVxnRescueMaxVix?: number;
  /** 研究专用：VXN rescue 的 VXN 5 日变化下限；省略保持严格上升。 */
  csResearchVxnRescueVixChangeMin?: number;
  /** V2.1.1：仅满足 VXN≥24、QQQ ROC20<0 且 VXN 5日上升时放大 CS 名义仓位；默认关闭。 */
  csVxnRescueSizeMultiplier?: number;
  /** 研究专用：仅在持仓天数窗口内覆盖 stateful risk 分支；默认关闭。 */
  csResearchDaysHeldExitMode?: 'off' | 'risk_threshold';
  csResearchDaysHeldExitRegimeScope?: CSDaysHeldExitRegimeScope;
  /** 研究专用：持仓天数窗口下限，默认 7。 */
  csResearchDaysHeldExitMin?: number;
  /** 研究专用：持仓天数窗口上限，默认 14。 */
  csResearchDaysHeldExitMax?: number;
  /** 研究专用：持仓天数窗口内使用的 stateful risk 阈值。 */
  csResearchDaysHeldRiskThreshold?: number;
  /** 研究选价：按历史上行路径生存率选择 CS 短 Call；默认 off。 */
  csSurvivalPriceSelectionMode?: CSSurvivalPriceSelectionMode;
  /** CS 生存率选价的 no-touch Wilson 下限门槛，默认 0.30。 */
  csSurvivalSelectionFloor?: number;
  /** CS 生存率选价排序目标；默认生存率调整后的预期 P&L。 */
  csSurvivalSelectionObjective?: PCSSurvivalSelectionObjective;
  /** CS 生存率参与排序的权重；0=旧风险效率，1=完全按生存率调整。 */
  csSurvivalSelectionSurvivalWeight?: number;
  /** CS 生存率排序使用 Wilson 下限的权重。 */
  csSurvivalSelectionWilsonWeight?: number;
  /** CS 生存率选价宽度模式；默认 full 仅在研究开关开启时生效。 */
  csSurvivalSelectionWidthMode?: CSSurvivalSelectionWidthMode;
  /** CS 联合选价的信用金保留下限；undefined=关闭，候选 credit 需不低于基准 credit 的该比例。 */
  csSurvivalSelectionCreditRetentionFloor?: number;
  /** CS 生存率选价状态范围；stress_only 仅高压启用，默认 all 保持兼容。 */
  csSurvivalSelectionStateMode?: CSSurvivalSelectionStateMode;
  /** CS 距离候选模式；pcs_dynamic_v1 仅改变候选距离层级，默认 base 保持兼容。 */
  csSurvivalSelectionDistanceMode?: CSSurvivalSelectionDistanceMode;
  /** CS 生存率选价期限；默认 fixed，研究模式按压力切换 21/28/35 DTE。 */
  csSurvivalSelectionDteMode?: CSSurvivalSelectionDteMode;
  /** CS 高压选价的条件尾损/maxLoss 上限；仅高压状态消费，undefined=关闭。 */
  csSurvivalSelectionStressTailVetoRatio?: number;
  /** CS 选价相对基准的最低得分优势；0.025=至少高 2.5%，undefined=关闭。 */
  csSurvivalSelectionSwitchMargin?: number;
  /** CS 选价相对基准的最低生存率提升；0.05=至少高 5 个百分点，undefined=关闭。 */
  csSurvivalSelectionMinSurvivalLift?: number;
  /** 研究专用：主 CS 生存率选价失败时，允许在非预危机/非危机日使用保守 fallback。 */
  csSurvivalFallbackEnabled?: boolean;
  /** fallback 固定短 Call Delta；双层回放首轮固定为 0.10。 */
  csSurvivalFallbackShortDelta?: number;
  /** fallback 固定价差宽度；双层回放首轮测试 1.5% 与 2.0%。 */
  csSurvivalFallbackWidthPct?: number;
  /** fallback 使用更严格的 no-touch Wilson 下限；主策略 .30，首轮 fallback 使用 .40。 */
  csSurvivalFallbackFloor?: number;
  /** CS 研究状态：低 VIX 但 TQQQ realized vol 偏高、趋势已变脆弱。 */
  csPreCrisisVixMax?: number; // default 20
  csPreCrisisTqqqRv20Min?: number; // default 0.42
  csPreCrisisTqqqRoc20Max?: number; // default 0.08
  /** 预危机事件上限的状态范围；默认 all，且只有配置事件上限时生效。 */
  csPreCrisisEventScope?: CSPreCrisisEventScope;
  /** 事件级风险缩放研究开关；1 或未配置保持原行为。 */
  csPreCrisisRiskMultiplier?: number;
  /** Research-only primary-CS notional scale by existing regime; portfolio sizing still obeys the shared option-risk cap. */
  csRiskMultiplierByRegime?: Partial<Record<MarketRegime, number>>;
  /** Research-only primary-CS notional multiplier when observed VIX reaches this floor. */
  csResearchRiskMultiplierVixMin?: number;
  /** Research-only primary-CS notional multiplier above the VIX floor; omitted preserves exact parity. */
  csResearchRiskMultiplierVixAbove?: number;
  /** 独立 CS 的事件级开仓上限；仅在预危机窗口消费，undefined=关闭。 */
  csPreCrisisMaxEntriesInWindow?: number;
  /** 研究专用：cap1 达到后，仅对经验证的第二笔质量画像放行。 */
  csPreCrisisCapReleaseMode?: CSPreCrisisCapReleaseMode;
  /** 研究专用：第二笔质量释放的 SR01 最低 VIX；省略保持 15。 */
  csPreCrisisCapReleaseMinVix?: number;
  /** 研究专用：第二笔质量释放的 BULL/SR02 最低 QQQ ROC5；省略保持 0。 */
  csPreCrisisCapReleaseMinQqqRoc5?: number;
  /** 研究专用：第二笔质量释放的 SR01 最低 slow-subregime 后验；省略不加后验门。 */
  csPreCrisisCapReleaseMinPosterior?: number;
  /** 预危机事件窗口长度，按交易日计算。 */
  csPreCrisisWindowTradingDays?: number;
  /** 研究专用：按 SR 后验/QQQ 弱势路径过滤 CS 新开；默认 off。 */
  csResearchEntryGate?: CSResearchEntryGate;
  /** 研究专用：BULL/SR02 VIX-band 局部释放的消融参数，默认保持既有条件。 */
  csResearchEntryBullVixBandRoc20Required?: boolean;
  /** Research-only lower bound for the Bull/SR02 VIX-band release; undefined preserves the boolean gate. */
  csResearchEntryBullVixBandRoc20Min?: number;
  csResearchEntryBullVixBandPosteriorMin?: number;
  /** 研究专用：BULL/VIX 局部释放区间边界，默认 19 到 19.5。 */
  csResearchEntryBullVixBandMin?: number;
  csResearchEntryBullVixBandMax?: number;
  /** 研究专用：用价格相对 SMA200 下限替代 BULL regime。 */
  csResearchEntryBullVixPriceSma200Min?: number;
  /** 研究专用：VIX-band 释放允许的 VIX 5 日变化上限；省略表示不增加该条件。 */
  csResearchEntryBullVixBandVixChange5dMax?: number;
  /** 研究专用：VIX-band 释放允许的最大价格扩展 ATR；省略表示不增加该条件。 */
  csResearchEntryBullVixBandPriceExtensionMax?: number;
  /** Research-only lower-segment quality bound paired with the existing Bull/SR02 VIX-band release; undefined preserves prior behavior. */
  csResearchEntryBullVixBandLowerSegmentPriceExtensionMin?: number;
  /** Research-only upper VIX boundary for the lower-segment quality bound; both fields must be set to activate it. */
  csResearchEntryBullVixBandLowerSegmentVixMax?: number;
  /** 按入场日 VIX/ADX 过滤尾部画像；v2.3 使用 candidate4_six_factor。 */
  csTailEntryGate?: CSTailEntryGate;
  /** 只释放 Balanced/L1AB 且排除 V11 深度转弱；v2.3 默认开启。 */
  csResearchEntryReleaseMode?: CSResearchEntryReleaseMode;
  /** CCS v2.3 候选9 MDD-A-S 硬阻断。 */
  csCandidate9MddEntryGate?: CSCandidate9MddEntryGate;
  /** CCS v2.3 候选9核心融合释放。 */
  csCandidate9CoreFusionReleaseMode?: CSCandidate9CoreFusionReleaseMode;
  /** CCS v2.4 安全 Safe-FK 联合释放；默认 off，v2.4 profile 开启慢 VIX 版本。 */
  csValidatedSafeReleaseMode?: CSValidatedSafeReleaseMode;
  /** CCS v2.4 研究参数：Slow-VIX 绝对点差阈值；省略保持 1.5 点。 */
  csValidatedSafeVixPointThreshold?: number;
  /** CCS v2.4 研究参数：Slow-VIX 回看交易日；省略保持 5 日。 */
  csValidatedSafeVixHorizon?: 3 | 5 | 10;
  /** MFE rescue 默认关闭；仅使用已经发生的持仓路径。 */
  csMfeRescueMode?: CSMfeRescueMode;
  /** MFE 相对开仓信用的最低比例；默认 0，表示曾经盈利即可。 */
  csMfeRescueMinPnlPctOfCredit?: number;
  /** 当前浮亏相对信用的最大比例；默认 .50。 */
  csMfeRescueMaxCurrentLossPctOfCredit?: number;
  /** MFE rescue 的最小剩余 DTE；默认 5。 */
  csMfeRescueMinDaysLeft?: number;
  /** MFE rescue 的最大剩余 DTE；默认 14。 */
  csMfeRescueMaxDaysLeft?: number;
  /** 研究专用：预危机 cap1 阻断时启用独立 CS 副层；不改变主层 cap1。 */
  csSecondaryEnabled?: boolean;
  /** 副层固定短 Call Delta；首轮研究使用更远的 10Δ。 */
  csSecondaryShortDelta?: number;
  /** 副层固定价差宽度；由副层模型独立决定。 */
  csSecondaryWidthPct?: number;
  /** 副层单笔风险预算（NAV 比例）；与主层 csMaxTotalRiskNav 分离。 */
  csSecondaryRiskBudgetNav?: number;
  /** 副层自己的预危机子状态资格；主层 cap1 仍按 csPreCrisisEventScope 判断阻断。 */
  csSecondaryEventRiskScope?: CSPreCrisisEventScope;
  /** 副层独立事件预算；undefined 表示副层不启用事件级 cadence cap。 */
  csSecondaryMaxEntriesInWindow?: number;
  /** 副层事件预算窗口，单位为交易日。 */
  csSecondaryWindowTradingDays?: number;
  /** Research-only: cap repeated coverage-layer opens inside a coarse trading-day window. */
  csSecondaryCoverageMaxEntriesInWindow?: number;
  /** Research-only: coverage occupancy window, in trading days. */
  csSecondaryCoverageWindowTradingDays?: number;
  /** 副层独立 DTE 模型；不改变主层 csSurvivalSelectionDteMode。 */
  csSecondaryTargetDteMode?: CSSurvivalSelectionDteMode;
  /** 研究专用：副层专用 QQQ 20 日涨幅上限；主层资格和主层 cap1 不受影响。 */
  csSecondaryQqqRoc20Max?: number;
  /** 研究专用：副层候选的 no-touch Wilson 下限质量闸；undefined=关闭（当前行为）。 */
  csSecondarySurvivalFloor?: number;
  /** 研究专用：副层候选的生存率调整后预期 P&L 下限（credit*ranking-maxLoss*(1-ranking)）；undefined=关闭。 */
  csSecondaryExpectedPnlFloor?: number;
  /** 从头设计的高胜率覆盖层；off/省略保持所有既有副层参数行为。 */
  csSecondaryCoverageProfile?: CSSecondaryCoverageProfile;
  /** 覆盖层触发池；research_blocked / tail_or_research_blocked 仅研究使用，默认 selector_failure。 */
  csSecondaryCoverageTriggerMode?: CSSecondaryCoverageTriggerMode;
  /** Research-only：保留 VIX<18，并在 18<=VIX<20 且 ADX 低于该阈值时消费 extension block。 */
  csSecondaryCoverageQuietAdxMax?: number;
  /** Research-only：BULL、VIX<该阈值、0<=extension<1 时释放 coverage floor。 */
  csSecondaryCoverageBullQuietVixMax?: number;
  /** Research-only：macro_calm_vix_all_v1 的统一 VIX 上限；该模式不再区分 research/tail/extension blocker。 */
  csSecondaryCoverageMacroVixMax?: number;
  /** 覆盖层选约：fixed 使用指定距离/宽度，survival_priority 按 Wilson 下限优先；研究模式可只在质量窗口切换或 fixed 失败时 fallback。 */
  csSecondaryCoverageSelectionMode?: CSSecondaryCoverageSelectionMode;
  /** Research-only：仅在 BULL/SR02/VIX<18/0<=extension<1 状态统一切换覆盖层几何。 */
  csSecondaryCoverageGeometryMode?: CSSecondaryCoverageGeometryMode;
  /** Research-only：覆盖层候选排序目标；省略时保持 Wilson 下限优先。 */
  csSecondaryCoverageSelectionObjective?: PCSSurvivalSelectionObjective;
  /** 研究专用：覆盖层目标 DTE；省略时保持历史 28 DTE，不影响 production/API 默认。 */
  csSecondaryCoverageTargetDte?: number;
  /** 普通补位层短腿 Delta；研究网格使用 .05/.075/.10。 */
  csSecondaryCoverageShortDelta?: number;
  /** 普通补位层宽度；研究网格使用 1.0%/1.5%/2.0%。 */
  csSecondaryCoverageWidthPct?: number;
  /** 普通补位层 Wilson 生存率下限。 */
  csSecondaryCoverageSurvivalFloor?: number;
  /** Research-only：仅在已释放的低 VIX extension 质量窗口使用的覆盖层 floor。 */
  csSecondaryCoverageExtensionQualityFloor?: number;
  /** Research-only：仅在已释放的低 VIX extension 质量窗口使用的覆盖层止盈目标。 */
  csSecondaryCoverageExtensionQualityProfitTarget?: number;
  /** Research-only：仅在已释放的低 VIX extension 质量窗口使用的覆盖层目标 DTE。 */
  csSecondaryCoverageExtensionQualityTargetDte?: number;
  /** Research-only：仅在非 BULL 状态消费 relaxed floor，BULL 保持原 floor。 */
  csSecondaryCoverageNormalFloorMode?: CSSecondaryCoverageNormalFloorMode;
  csSecondaryCoverageNormalRelaxedFloor?: number;
  /** Research-only：extension-band mode also releases the relaxed floor for BULL observations outside a middle extension band. */
  csSecondaryCoverageBullExtensionLowMax?: number;
  csSecondaryCoverageBullExtensionHighMin?: number;
  /** Research-only：low-extension BULL release requires calm VIX or deep under-extension. */
  csSecondaryCoverageBullLowVixMax?: number;
  csSecondaryCoverageBullLowExtensionDeepMin?: number;
  /** Research-only：high-extension BULL release requires calm VIX or sufficiently deep extension. */
  csSecondaryCoverageBullHighVixMax?: number;
  csSecondaryCoverageBullHighExtensionDeepMin?: number;
  /** Research-only：release the relaxed floor for the healthy BULL/SR02 state bucket. */
  csSecondaryCoverageBullSr02VixMax?: number;
  /** Research-only：release the relaxed floor for a generalized low-VIX BULL macro bucket. */
  csSecondaryCoverageBullVixMax?: number;
  /** Research-only：minimum VIX3M-minus-VIX contango for the generalized low-VIX BULL bucket. */
  csSecondaryCoverageBullTermStructureSlopeMin?: number;
  /** Research-only：lower VIX boundary for the BULL survival-floor bridge. */
  csSecondaryCoverageBullVixMin?: number;
  /** Research-only：BULL-only floor used by the survival-floor bridge; non-BULL keeps normalRelaxedFloor. */
  csSecondaryCoverageBullFloorBridge?: number;
  /** Research-only：VIX cap for the BULL/SR02 calm extension-segment floor bridge. */
  csSecondaryCoverageBullSr02CalmVixMax?: number;
  /** Research-only：短腿 Delta used by the precise BULL/SR02 calm geometry bucket. */
  csSecondaryCoverageBullSr02CalmShortDelta?: number;
  /** Research-only：spread width used by the precise BULL/SR02 calm geometry bucket. */
  csSecondaryCoverageBullSr02CalmWidthPct?: number;
  /** Research-only：healthy BULL/SR02 release requires a minimum VIX term-structure slope. */
  csSecondaryCoverageBullSr02TermStructureSlopeMin?: number;
  /** Research-only：stable term-structure release also requires a bounded 5-day VIX change. */
  csSecondaryCoverageBullSr02VixChange5dMax?: number;
  /** Research-only：conditional term-structure quality applies the VIX-change cap only above this extension. */
  csSecondaryCoverageBullSr02TermStructureExtensionMin?: number;
  /** Research-only：upper price-extension boundary for the generalized BULL/SR02 release. */
  csSecondaryCoverageBullSr02ExtensionMax?: number;
  /** Research-only：ROC20-cap mode releases the relaxed floor for BULL observations below an existing momentum cap. */
  csSecondaryCoverageBullQqqRoc20Max?: number;
  /** Research-only：ER20-cap mode releases the relaxed floor for BULL observations below the existing efficiency-ratio cap. */
  csSecondaryCoverageBullQqqEr20Max?: number;
  /** Research-only：BULL extension-band coverage can use a separate exit stop without changing other coverage exits. */
  csSecondaryCoverageBullDeltaStopThreshold?: number;
  /** Research-only：BULL extension-band coverage can use a separate short-leg delta. */
  csSecondaryCoverageBullShortDelta?: number;
  /** Research-only：BULL extension-band coverage can use a separate spread width. */
  csSecondaryCoverageBullWidthPct?: number;
  /** 普通补位层独立止盈目标，按 credit 百分比。 */
  csSecondaryCoverageProfitTarget?: number;
  /** 普通补位层即时 Delta 止损阈值。 */
  csSecondaryCoverageDeltaStopThreshold?: number;
  /** 预危机补位层可单独覆盖；省略时自动使用更保守的 .05Δ/1.0%/PT50/Delta20%。 */
  csSecondaryCoveragePreCrisisShortDelta?: number;
  csSecondaryCoveragePreCrisisWidthPct?: number;
  csSecondaryCoveragePreCrisisSurvivalFloor?: number;
  csSecondaryCoveragePreCrisisProfitTarget?: number;
  csSecondaryCoveragePreCrisisDeltaStopThreshold?: number;
  /** 副层 v2（从头重来，研究专用）：触发条件与主层 cap1 计数器解耦（仍默认要求预危机状态）；undefined=沿用旧 secondaryRouteActive 触发逻辑。 */
  csSecondary2TriggerMode?: 'independent';
  /** 研究专用：进一步放开副层 v2，连预危机状态也不要求。实测在 2023 会让胜率崩到 72-80%、MDD 恶化数倍，默认 false，不建议开启。 */
  csSecondary2AllowOutsidePreCrisis?: boolean;
  /** 副层 v2：动态生存率网格选约；undefined=沿用旧固定 Delta 单候选逻辑。 */
  csSecondary2SelectionMode?: 'survival_dynamic';
  /** 副层 v2 动态选约的候选 Delta 网格；undefined 时用 [.05,.075,.10,.15]。 */
  csSecondary2ShortDeltaGrid?: number[];
  /** 副层 v2 选约目标函数；undefined 时用 'survival_priority'（先胜率后收益）。 */
  csSecondary2SelectionObjective?: PCSSurvivalSelectionObjective;
  csSecondary2SelectionSurvivalWeight?: number;
  csSecondary2SelectionWilsonWeight?: number;
  /** 副层 v2 生存率下限：survival_dynamic 模式下是网格入选门槛；undefined 时用 .75 兜底。 */
  csSecondary2SurvivalFloor?: number;
  csExtensionGate?: number;       // default disabled — skip new CS opens when QQQ priceExtensionAtr >= gate; existing CS exits unchanged
  csBreachGate?: 'off' | 'strike_reclaim' | 'pullback' | 'trend_pause';  // default 'off'
  csVixOpenFloor?: number;         // VE: default 0（no-op）— VIX < floor 时跳过新开 CS（已有持仓退出不受影响）；诊断依据=VIX<16 开仓期望显著为负且 2025 保费全在 VIX≥16（2026-07-17 环境分桶）
  csVixFloorPullbackExempt?: number; // VE2: default undefined = floor 无条件生效；设置后当 QQQ 距 60 日高回撤 ≥ 该比例时豁免 floor（放行回撤已展开时的对冲性低 VIX 开仓，如 2024-07-12）
  csBreachSizeDiscount?: number;   // GS: default 1.0（no-op）— CS/BearCS 亏损平仓后，重开仓位按此折扣缩小；诊断依据=连败 streak=1 期望显著恶化（2026-07-17）
  csBreachSizeRampCloses?: number; // GS: default 0（no-op）— 折扣后每次盈利平仓线性爬升，N 次后回满仓；禁止任何日历/天数冷却
  /** 组合模式下 CS、PCS、IC、Equity Boost 与 Bear CS 共享的定义风险上限；省略时兼容 csMaxTotalRiskNav。 */
  optionMaxTotalRiskNav?: number;
  enablePCS?: boolean;      // default false — allow Put Credit Spread
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 BULL/SR01、BULL/SR02、RISK_ON_WEAKENING/SR02 时额外触发一次 PCS 开仓（不受 VIX 14-28/pcsMode 时机限制，仍受安全闸+连败冷静期约束），用于测试补空档覆盖率能否带来增量 P&L。 */
  pcsGoodSubstateBoost?: boolean;
  /** PCS 候选 profile；candidateAResearch 保留旧两阶段研究回放，candidateARescue 为 v1.2.7b/P0 单次准入。 */
  pcsResearchProfile?: 'candidate1' | 'candidate2' | 'candidate3' | 'candidate4' | 'candidateA' | 'candidateAResearch' | 'candidateARescue';
  /** 研究专用：原生执行正式候选 P1 的状态/校正 W20 门；字段名保留 P1R1 以兼容历史研究调用，不使用日期 admission artifact，生产调用省略。 */
  pcsNativeCandidateP1R1?: boolean;
  /** 研究专用：正式候选 P1 分支消融；字段名保留 P1R1 以兼容历史研究调用，省略时运行全部分支。 */
  pcsNativeP1R1Scope?: 'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20';
  /** 研究专用：正式候选 P1 多分支组合消融；字段名保留 P1R1 以兼容历史研究调用，省略时使用 pcsNativeP1R1Scope。 */
  pcsNativeP1R1Scopes?: Array<'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20'>;
  /** 研究专用：P1 残余尾部过滤器；生产调用省略。 */
  pcsNativeP1ResidualFilter?: 'bullSr01HighAdxLowRv';
  /** 研究专用：在保留 Candidate-A 其余准入的前提下释放 V1.2.3 A9；生产调用省略。 */
  pcsNativeP0A9Release?: boolean;
  /** 研究专用：A9 的最小质量交互释放；生产调用省略。 */
  pcsNativeP0A9QualityRelease?: boolean;
  /** 研究专用独立补位层；undefined/false 保持主 PCS 完全不变。 */
  pcsRescueEnabled?: boolean;
  /** 研究专用：简化/消融 RANGE_BOUND rescue 质量门；生产调用省略。 */
  pcsRescueRangeQualityFilter?: 'rangeWeakVix' | 'rangeWeak' | 'rangeVix' | 'rangeWeak4Vix';
  /** 研究专用：Rescue 剩余亏损特征门；生产调用省略。 */
  pcsRescueLossQualityFilter?: 'bullLowVixAdx' | 'sidewaysHighVol' | 'bullHighVol' | 'combined';
  /** 研究专用：Rescue BULL 低 VIX 门的 ADX 上限；未提供时为 15。 */
  pcsRescueLossQualityAdxMax?: number;
  /** 研究专用：Rescue SIDEWAYS 高波动门的 VIX 下限；未提供时为 30。 */
  pcsRescueLossQualitySidewaysVixMin?: number;
  /** 研究专用：Rescue BULL 高波动门的 VIX 下限；未提供时为 24。 */
  pcsRescueLossQualityBullVixMin?: number;
  /** PCS_RESCUE 机会池来源；不旁路安全闸，只补主层软阻断/主层未构建的机会。 */
  pcsRescueEntryMode?: PCSRescueEntryMode;
  /** 研究专用：复用强动量 ROC5 信号补充 Rescue 机会池来源；未提供时关闭。 */
  pcsRescueResearchEntryReleaseMode?: 'roc5_floor_v1' | 'e182_source_quality_v1' | 'roc5_nonnegative_v1';
  pcsRescueResearchEntryReleaseRoc5Min?: number;
  /** 研究专用：普通 PCS 已触发但 proposal 构建失败时，允许已构建的 PCS_RESCUE 晋升为最终动作；默认关闭。 */
  pcsRescuePromoteOnMainFailure?: boolean;
  /** 研究专用：基础 rescue 次日两腿 fill 失败时，按同一 Delta/宽度在实际 fill 链重选一次；默认关闭。 */
    pcsRescueFillFallbackMode?: 'next_chain_delta_v1' | 'next_chain_delta_core_v1' | 'next_chain_delta_calm_v1' | 'next_chain_delta_core_bull_vix16_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_bull_sr02_vixlt12_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_or_bull_sr02_vixlt12_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_bull_sr02_vixrise_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_or_bull_sr02_vixrise_v1' | 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_simplified_v1';
  /** PCS_RESCUE 状态范围；core_v1 排除 RISK_ON_EXTENDED/SIDEWAYS，expanded_quality_v1 只释放质量扩展区，selective_quality_v1 仅增加少量边界口袋。 */
  pcsRescueRegimeScope?: PCSRescueRegimeScope | 'selective_quality_v105_compact_vix13' | 'selective_quality_v106_compact_vix13' | 'selective_quality_v107_compact_vix13_no_rv20tail' | 'selective_quality_v108_compact_vix13_adx45';
  /** 研究专用：v96 scope 的 SIDEWAYS VIX 下限；省略时保持已验证的 22。生产调用省略。 */
  pcsRescueSelectiveQualitySidewaysVixMin?: number;
  /** 研究专用：v96 scope 可选的 SIDEWAYS ROC5 补充下限；省略时不增加动量分支。生产调用省略。 */
  pcsRescueSelectiveQualitySidewaysRoc5Min?: number;
  /** 研究专用：在 v97 scope 上可选合并 BULL 且 VIX<10；省略时关闭。生产调用省略。 */
  pcsRescueSelectiveQualityBullVix10?: boolean;
  /** 研究专用：在既有 rescue scope 上附加 RISK_ON_EXTENDED/SR02/VIX>=18 交集；默认关闭。 */
  pcsRescueResearchReleaseRiskExtSr02Vix18?: boolean;
  /** 研究专用：在既有 rescue scope 上附加 RISK_ON_EXTENDED/SR02 的 VIX 下限；未设置时关闭。 */
  pcsRescueResearchReleaseRiskExtSr02VixMin?: number;
  /** 研究专用：在既有 rescue scope 上附加 RISK_ON_EXTENDED/SR02 且 VIX 五日变化不为正；默认关闭。 */
  pcsRescueResearchReleaseRiskExtSr02VixFalling5d?: boolean;
  /** 研究专用：在既有 regime scope 上增加一个全局单因子机会释放；不会旁路安全/质量/合约门，默认关闭。 */
  pcsRescueResearchRegimeReleaseMode?: PCSRescueResearchRegimeReleaseMode | PCSRescueResearchRegimeReleaseModeR9;
  /** 研究专用：P3.E471 互补状态释放；默认关闭。 */
  pcsRescueResearchComplementMode?: PCSRescueResearchComplementMode | PCSRescueResearchComplementModeE295 | PCSRescueResearchComplementModeE298 | PCSRescueResearchComplementModeE301 | PCSRescueResearchComplementModeE302 | PCSRescueResearchComplementModeE304 | PCSRescueResearchComplementModeE307 | PCSRescueResearchComplementModeE309 | PCSRescueResearchComplementModeE310 | PCSRescueResearchComplementModeE313 | PCSRescueResearchComplementModeE316 | PCSRescueResearchComplementModeE317 | PCSRescueResearchComplementModeE320 | PCSRescueResearchComplementModeE323 | PCSRescueResearchComplementModeE324 | PCSRescueResearchComplementModeE327 | PCSRescueResearchComplementModeE328 | PCSRescueResearchComplementModeE330 | PCSRescueResearchComplementModeE331 | PCSRescueResearchComplementModeE333 | PCSRescueResearchComplementModeE336 | PCSRescueResearchComplementModeE337 | PCSRescueResearchComplementModeE338 | PCSRescueResearchComplementModeE340 | PCSRescueResearchComplementModeE342 | PCSRescueResearchComplementModeR7E0 | PCSRescueResearchComplementModeR7 | PCSRescueResearchComplementModeE346 | PCSRescueResearchComplementModeE348 | PCSRescueResearchComplementModeE456;
  /** 研究专用：仅在 E526 RANGE 互补分支使用 P3 的 Sigma/宽度作为 Rescue 合约探针；默认关闭。 */
  pcsRescueResearchRangeContractMode?: PCSRescueResearchRangeContractMode;
  /** 研究专用：在 E526 RANGE 互补分支用当前 bar 独立复算 P3 lower/Sigma path；默认关闭。 */
  pcsRescueResearchShadowP3Path?: boolean;
  /** 研究专用：互补状态内主 PCS 已构建时，允许 Rescue 作为替代 proposal；默认关闭。 */
  pcsRescuePromoteOnMainProposal?: boolean;
  /** 研究专用：主 PCS 已构建时，同时保留独立 Rescue proposal；默认关闭。 */
  pcsRescueDualWithMainProposal?: boolean;
  /** 研究专用：双层主 proposal 的最小动态质量门；默认关闭。 */
  pcsRescueDualMainQualityGate?: 'off' | 'adx30_or_rv20_lt30_v1' | 'adx28_or_rv20_lt30_v1' | 'adx27_or_rv20_lt30_v1' | 'adx26_or_rv20_lt30_v1' | 'adx26_or_rv20_lt30_or_adx25_non_sr01_v1' | 'adx26_or_rv20_lt30_or_adx25_safe_state_v1' | 'adx26_or_rv20_lt30_or_adx24_safe_state_v1' | 'adx26_or_rv20_lt30_or_adx23_safe_state_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_v1' | 'adx26_or_rv20_lt30_or_adx21_safe_state_v1' | 'adx26_or_rv20_lt30_or_adx21_safe_state_marginal_v1' | 'adx26_or_rv20_lt30_or_rv20_lt60_sma_nonnegative_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_vix17_sma010_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_vix17_nonrange_sma010_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt50_or_vix17_nonrange_sma010_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt40_notbullsr02_or_vix17_nonrange_sma010_v1' | 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt50_atr2_or_vix17_nonrange_sma010_v1' | 'adx25_or_rv20_lt30_v1' | 'adx30_or_rv20_lt30_and_er20vix_v1';
  /** PCS_RESCUE 选约 Delta 模式；透明状态桶，不使用逐日拟合。 */
  pcsRescueDeltaMode?: PCSRescueDeltaMode;
  /** PCS_RESCUE 固定 Delta；默认研究值 2.5%。 */
  pcsRescueShortDelta?: number;
  /** state_adaptive_v1 的平静/正常/压力 Delta；默认 7.5%/5%/2.5%。 */
  pcsRescueCalmDelta?: number;
  pcsRescueNormalDelta?: number;
  pcsRescuePressureDelta?: number;
  /** quality 模式遇到极端低VIX延伸时的中间压力 Delta；省略时回退到 pressure Delta。 */
  pcsRescueExtremeDelta?: number;
  pcsRescueExtremeBaseDelta?: number;
  /** 研究专用：quality_v2 在高延伸/高ADX簇中使用的保护性回退 Delta。 */
  pcsRescueExtremeFallbackDelta?: number;
  /** quality 模式遇到极端低VIX延伸时收窄保护宽度；省略时沿用普通 rescue width。 */
  pcsRescueExtremeWidthPct?: number;
  /** 研究专用：极端宽度的状态分配；默认 global 保持历史行为。 */
  pcsRescueExtremeWidthProfile?: PCSRescueExtremeWidthProfile;
  /** 研究专用：adx_split_v1 在低/高 ADX 桶使用的窄极端宽度。 */
  pcsRescueExtremeWidthNarrowPct?: number;
  /** PCS_RESCUE 固定价差宽度/DTE/独立单笔风险预算。 */
  pcsRescueWidthPct?: number;
  /** 研究专用：仅在非 BULL 状态使用窄幅宽度扩展；默认关闭。 */
  pcsRescueResearchWidthMode?: 'non_bull_wide_v1';
  /** 研究专用：非 BULL 宽度扩展值；省略时使用 2.25%。 */
  pcsRescueResearchWidthPct?: number;
  /** 研究专用：按入场前 RV20 状态 veto Rescue；默认关闭。 */
  pcsRescueResearchVetoMode?: 'rv20_ge40_v1' | 'rv20_ge40_or_er20_lt20_v1' | 'rv20_ge40_or_er20_lt20_or_adx_lt16_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_adxlt28_slope02_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_rvge40_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_rvge40_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_v1' | 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_or_er20lt07_range08_v1' | 'r7_e596_compact_base_v1' | 'r7_e596_compact_slope_v1' | 'r7_e596_compact_adx_v1' | 'r7_e596_compact_exact_v1' | 'r8_e0_compact_exact_v1' | 'r8_e1_atrlt2_vixchange02_v1' | 'r8_e2_sma200lt005_v1' | 'r8_e2_adxlt30_ma50slope03_v1' | 'r8_e3_er20ge04_roc5ge02_v1' | 'r9_e308_lowrv_release_fixed05_v1' | 'r9_e309_lowrv_new_release_fixed05_v1' | 'r9_e317_lowrv_new_release_fixed10_v1' | 'r9_e318_lowrv_new_release_fixed10_width03_v1';
  /** Research-only: re-use E182's low-risk source predicate to reopen the low-RV construction veto. */
  pcsRescueResearchVetoE182QualityRelease?: boolean;
  /** Research-only VIX-only release surface for the existing low-RV veto. */
  pcsRescueResearchVetoLowRvVixCeiling?: number;
  pcsRescueTargetDte?: number;
  pcsRescueRiskBudgetNav?: number;
    /** 研究专用：原 rescue 合约不可构建时，仅重试一次窄宽度/上移 Delta 的合约 fallback；省略或 none 不启用。 */
    pcsRescueContractFallbackMode?: 'none' | 'narrow_updelta_v1' | 'narrow_updelta_v2' | 'narrow_updelta_sideways_v1' | 'narrow_downdelta_v1' | 'narrow_width_v1' | 'expiry28_v1' | 'expiry42_v1';
    /** 研究专用：仅允许 PCS_RESCUE contract fallback 在剩余风险预算不足一张时强制一张；基础 proposal 仍不强制。 */
    pcsRescueContractFallbackForceMinimumContract?: boolean;
    /** 研究专用：强制一张的 PCS_RESCUE contract fallback 最大风险占用；省略表示不设额外上限。 */
    pcsRescueContractFallbackMaxRiskPct?: number;
  /** 研究专用：fallback 短腿 Delta 上移幅度；默认 2.5pp，仅用于参数邻域研究。 */
  pcsRescueContractFallbackDeltaUplift?: number;
  /** 研究专用：主 fallback 不可行时的第二顺位 Delta uplift；省略时保持单次 fallback 语义。 */
  pcsRescueContractFallbackSecondaryDeltaUplift?: number;
  /** 研究专用：第二顺位仍不可行时的第三顺位 Delta uplift；省略时保持两层 fallback 语义。 */
  pcsRescueContractFallbackTertiaryDeltaUplift?: number;
  /** 研究专用：第三顺位首选不可行时的阶梯 uplift；省略时保持单一第三顺位尝试。 */
  pcsRescueContractFallbackTertiaryStepDeltaUplift?: number;
  /** 研究专用：第三顺位 fallback 的最小状态 veto；省略时不增加状态限制。 */
  pcsRescueContractFallbackTertiaryQualityMode?: PCSRescueContractFallbackTertiaryQualityMode;
  /** 研究专用：第三顺位阶梯 step 的状态 veto；省略时继承首个 tertiary veto。 */
  pcsRescueContractFallbackTertiaryStepQualityMode?: PCSRescueContractFallbackTertiaryQualityMode;
  /** 研究专用：第三顺位 fallback 的合约形态；省略时不启用第三层。 */
    pcsRescueContractFallbackTertiaryMode?: 'narrow_updelta_v1' | 'narrow_updelta_v2' | 'narrow_updelta_sideways_v1' | 'narrow_downdelta_v1' | 'narrow_width_v1' | 'expiry28_v1' | 'expiry42_v1';
    pcsRescueContractFallbackQuaternaryMode?: 'expiry28_v1' | 'expiry42_v1';
    /** Research-only retry after every ordinary proposal-construction fallback fails. */
    pcsRescueContractBuildRecoveryPairSearchMode?: 'nearest_valid_all_pairs_v1' | 'nearest_valid_all_pairs_below_target_delta_v1';
    /** Optional economic floor for the research-only contract-build recovery scan. */
    pcsRescueContractBuildRecoveryMinCreditWidthRatio?: number;
    /** Reuses E182 momentum/efficiency features only for research recovery admission. */
    pcsRescueContractBuildRecoveryQualityMode?: 'roc5_nonnegative_v1' | 'er20_ge15_v1' | 'roc5_nonnegative_and_er20_ge15_v1';
    /** 研究专用：仅允许 fallback 在 ROC20 非负时尝试；不改变基础合约、状态机或日期准入。 */
    pcsRescueContractFallbackQualityMode?: PCSRescueContractFallbackQualityMode;
    /** 研究专用：仅在首次 PCS_RESCUE 成交失败后的执行 fallback 使用 quote-only 保护腿；不改变 proposal 层 pair-search。 */
    pcsRescueFillFallbackQuoteOnlyWidth?: boolean;
    /** 研究专用：首次成交失败后的 execution fallback pair-search 形态；默认仍关闭。 */
    pcsRescueFillFallbackPairSearchMode?: 'nearest_valid_width_cap_v1' | 'nearest_valid_risk_cap_v1' | 'quote_only_width_v1' | 'nearest_valid_delta_cap_v1' | 'nearest_valid_credit_floor_v1' | 'nearest_valid_all_pairs_v1' | 'nearest_valid_all_pairs_quote_only_v1' | 'nearest_valid_quote_only_both_width_v1';
    /** Research-only: after the configured fill fallback fails, retry once with executable all-pairs search. */
    pcsRescueFillFallbackRecoveryPairSearchMode?: 'nearest_valid_all_pairs_v1';
    /** 研究专用：首次成交失败后的 execution fallback 到期链；省略时沿用 Rescue 目标 DTE。 */
    pcsRescueFillFallbackDteMode?: 'expiry28_v1' | 'expiry42_v1';
    /** 研究专用：仅在执行 fallback 中按目标 DTE 顺序扫描可行到期日；省略时保持单一最近到期日。 */
    pcsRescueFillFallbackExpirySearchMode?: 'nearest_feasible_v1' | 'nearest_feasible_full_chain_v1' | 'nearest_feasible_full_chain_parent_preserving_v1' | 'shortest_feasible_full_chain_parent_preserving_v1';
    /** Research-only: gate expanded-chain rescue attempts with one compact macro-quality expression; baseline fills remain untouched. */
    pcsRescueFillFallbackExpandedChainGate?: 'roc5_nonnegative_v1' | 'er20_at_least_015_v1' | 'roc5_nonnegative_and_er20_at_least_015_v1';
    /** Research-only: optional VIX ceiling for expanded-chain attempts, applied only after the parent fallback fails. */
    pcsRescueFillFallbackExpandedChainVixMax?: number;
    /** Research-only: minimum QQQ ROC5 for expanded-chain attempts; omitted leaves only the selected categorical gate. */
    pcsRescueFillFallbackExpandedChainRoc5Min?: number;
    /** Research-only: one parent-preserving OR release rule for expanded-chain attempts; baseline fills remain untouched. */
    pcsRescueFillFallbackExpandedChainReleaseMode?: 'roc5_ge03_or_roc5nonneg_er20ge015_vixle175_v1' | 'roc5_ge03_or_er20ge015_vixle175_v1' | 'roc5_ge03_or_roc5nonneg_vixle175_v1' | 'roc5_ge03_or_roc5nonneg_er20ge015_v1' | 'vixle175_and_roc5_or_roc5nonneg_er20_v1' | 'roc5ge03_or_roc5ge0275_er15_or_roc5nonneg_er15_vix175_v1' | 'roc5ge03_or_roc5nonneg_er15_or_weakroc_er_vix_v1' | 'roc5ge03_or_roc5nonneg_er15_or_trendscore70_v1' | 'roc5ge03_or_roc5nonneg_er15_or_adx24_v1' | 'roc5ge03_or_roc5nonneg_erband_vixguard_v1' | 'roc5ge03_or_roc5nonneg_er15_or_vixlow_v1' | 'roc5_nonnegative_only_v1' | 'e182_or_weakroc_vixlow_v1' | 'e182_or_weakroc_roc20positive_v1' | 'e182_or_roc5nonneg_roc20positive_v1';
    /** Research-only: strong-momentum arm threshold; defaults to 3% for the expanded-chain release family. */
    pcsRescueFillFallbackExpandedChainReleaseRoc5Min?: number;
    /** Research-only: efficiency floor on the nonnegative-momentum arm; defaults to 0.15. */
    pcsRescueFillFallbackExpandedChainReleaseEr20Min?: number;
    /** Research-only: lower momentum floor and stronger efficiency/VIX guard for a residual expansion arm. */
    pcsRescueFillFallbackExpandedChainReleaseWeakRoc5Min?: number;
    pcsRescueFillFallbackExpandedChainReleaseWeakEr20Min?: number;
    pcsRescueFillFallbackExpandedChainReleaseWeakVixMax?: number;
    /** Research-only: spread width used only after the exact parent fill fallback fails and full-chain search is admitted. */
    pcsRescueFillFallbackExpandedChainWidthPct?: number;
    /** Research-only: short-leg delta used only for an expanded-chain search after the exact parent fallback fails. */
    pcsRescueFillFallbackExpandedChainShortDelta?: number;
    /** 研究专用：execution fallback 在风险 cap 内可强制开一张；默认关闭。 */
    pcsRescueFillFallbackForceMinimumContract?: boolean;
    /** 研究专用：execution fallback 强制一张的最大风险占用；省略表示不设额外上限。 */
    pcsRescueFillFallbackMaxRiskPct?: number;
    /** 研究专用：execution fallback 短腿 Delta 的一次性偏移；默认沿用 proposal Delta。 */
    pcsRescueFillFallbackShortDeltaUplift?: number;
    /** 研究专用：execution fallback 搜索的最低信用金/宽度比；默认不设。 */
    pcsRescueFillFallbackMinCreditWidthRatio?: number;
    /** 研究专用：在既有 fallback 准入之外，允许任意状态在 ADX 达到该下限时尝试一次；默认关闭。 */
    pcsRescueFillFallbackAnyStateAdxMin?: number;
    /** 研究专用：在既有 fallback 准入之外，允许任意状态在 QQQ ROC5 不高于该上限时尝试一次；默认关闭。 */
    pcsRescueFillFallbackAnyStateRoc5Max?: number;
    /** 研究专用：在既有 fallback 准入之外，允许 BULL/SR02 且 VIX 达到该下限时尝试一次；默认关闭。 */
    pcsRescueFillFallbackBullSr02VixMin?: number;
    /** 研究专用：在既有 fallback 准入之外，允许任意状态在趋势评分达到该下限时尝试一次；默认关闭。 */
    pcsRescueFillFallbackAnyStateTrendScoreMin?: number;
    /** Research-only: release an otherwise excluded BULL/SR01 failed fill proposal when VIX is at or below this ceiling; omitted by production defaults. */
    pcsRescueFillFallbackBullSr01VixMax?: number;
    /** Research-only: replace (not add to) the legacy BULL/SR01 VIX-falling fallback subcondition with a VIX ceiling. */
    pcsRescueFillFallbackBullSr01VixReplacementMax?: number;
    /** 研究专用：execution fallback 的宽度；省略时沿用原 proposal 宽度。 */
    pcsRescueFillFallbackWidthPct?: number;
    /** 研究专用：quote-only 执行 fallback 在 BULL/SR01 且 RV20 达到该值时关闭；不改变 proposal 层 pair-search。 */
    pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Max?: number;
    /** 研究专用：quote-only 执行 fallback 在 BULL/SR01 且 RV20 低于该值时关闭；不改变 proposal 层 pair-search。 */
    pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Min?: number;
  /** 研究专用：原 rescue 目标腿失败时，在同一 Delta/宽度下扫描最近有效 Put 组合；默认关闭。 */
  /** 研究专用：将 RANGE pair search 限制为 E526 互补且无原 soft-timing 的机会；默认关闭。 */
  pcsRescuePairSearchComplementOnly?: boolean;
  pcsRescuePairSearchMode?: 'nearest_valid_v1' | 'nearest_valid_calm_v1' | 'nearest_valid_calm_vix20_v1' | 'nearest_valid_side_weak_vix20_v1' | 'nearest_valid_side_vix20_bull_vix12_v1' | 'nearest_valid_side_vix20_bull_vix13_v1' | 'nearest_valid_side_vix20_bull_vix13_adx10_v1' | 'nearest_valid_bull_vix12_v1' | 'nearest_valid_bull_vix13_adx10_v1' | 'nearest_valid_bull_vix14_adx15_v1' | 'nearest_valid_bull_vix14_adx20_v1' | 'nearest_valid_bull_vix15_adx10_v1' | 'nearest_valid_bull_vix15_adx15_v1' | 'nearest_valid_bull_vix15_adx20_v1' | 'nearest_valid_bull_vix18_adx15_v1' | 'nearest_valid_r6_v1' | 'nearest_valid_r6_bull_vix16_adx10_v1' | 'nearest_valid_r6_bull_vix16_adx15_v1' | 'nearest_valid_r6_bull_vix16_adx20_v1' | 'nearest_valid_r6_bull_vix16_adx25_v1' | 'nearest_valid_r6_bull_vix17_adx15_v1' | 'nearest_valid_r6_bull_vix17_adx20_v1' | 'nearest_valid_r6_bull_vix18_adx20_v1' | 'nearest_valid_r6_bull_vix18_adx25_v1' | 'nearest_valid_r6e0g_bull_vix18_adx20_v1' | 'nearest_valid_r6e0g_bull_vix18_adx20_sr02_v1' | 'nearest_valid_r6e0g_bull_vix18_adx20_roc20_v1' | 'nearest_valid_r6e0g_bull_vix18_adx25_v1' | 'nearest_valid_r6e0g_bull_vix18_adx30_v1' | 'nearest_valid_r6e2_bull_vix18_adx15_roc20_v1' | 'nearest_valid_r6e2_bull_vix18_adx10_roc20_v1' | 'nearest_valid_r6e3_bull_vix20_adx10_roc20_v1' | 'nearest_valid_r6e3_bull_vix20_adx15_roc20_v1' | 'nearest_valid_r6e3_bull_vix20_adx20_roc20_v1' | 'nearest_valid_r6e4_bull_vix22_adx10_roc20_v1' | 'nearest_valid_r6e4_bull_vix22_adx15_roc20_v1' | 'nearest_valid_r6e4_bull_vix22_adx20_roc20_v1' | 'nearest_valid_r6e5_bull_vix24_adx10_roc20_v1' | 'nearest_valid_r6e5_bull_vix24_adx15_roc20_v1' | 'nearest_valid_r6e5_bull_vix24_adx20_roc20_v1' | 'nearest_valid_r6e6_bull_vix26_adx10_roc20_v1' | 'nearest_valid_r6e6_bull_vix26_adx15_roc20_v1' | 'nearest_valid_r6e6_bull_vix26_adx20_roc20_v1' | 'nearest_valid_bull_vix15_linear_adx_v1' | 'nearest_valid_bull_vix15_linear_adx_m51_v1' | 'nearest_valid_bull_vix15_linear_adx_m52_v1' | 'nearest_valid_range_vix20_adx20_v1' | 'nearest_valid_range_v1' | 'nearest_valid_side_v1' | 'nearest_valid_side_rv55_v1' | 'nearest_valid_side_adx20_v1' | 'nearest_valid_side_vix20_v1' | 'nearest_valid_side_vix22_v1' | 'nearest_valid_width_cap_v1' | 'nearest_valid_risk_cap_v1' | 'quote_only_width_v1' | 'nearest_valid_delta_cap_v1' | 'nearest_valid_credit_floor_v1' | 'nearest_valid_all_pairs_v1' | 'nearest_valid_all_pairs_quote_only_v1' | 'nearest_valid_p3_range_sr01_vix17_20_adx12_20_rv40_50_v1' | 'nearest_valid_r6e5_bull_vix24_adx20_roc20_v1' | 'nearest_valid_r7_e443_all_pairs_bull_adx10_v1' | 'nearest_valid_r7_e445_creditfloor_bull_adx10_v1' | 'nearest_valid_r7_e447_creditfloor_weak_vix21_v1' | 'nearest_valid_r7_e448_creditfloor_weak_sr01_v1' | 'nearest_valid_r7_e449_creditfloor_weak_bull_v1' | 'nearest_valid_r7_e453_creditfloor_sr01_adx25_vix22_v1';
  /** 候选3局部释放规则；v1.2.6/P0 默认保留 bull_sr02_rv_adx 下游释放。 */
  pcsCandidate3ExtraRelease?: PCSCandidate3ExtraReleaseMode;
  /**
   * 只读研究旁路：保持 Reactive 诊断，但允许机会池进入后续版本闸。
   * 细分模式只用于反事实研究，默认不设置，不得由生产入口传入。
   */
  pcsResearchTimingOverride?: 'allow' | 'allow_low_vix_12_14_adx20' | 'allow_high_vix_28_30_adx20' | 'allow_range_adx_edge' | 'allow_range_bound_vix_14_18_adx12_30' | 'allow_risk_on_extended_vix_12_14_adx12_30';
  /** 只读研究旁路：仅作用于上述 Reactive 细分释放的 PCS 风险预算；1=不缩放，默认不设置。 */
  pcsResearchReactiveRiskMultiplier?: number;
  /** 只读研究旁路：允许机会池穿过 PCS 安全资格门。默认不设置。 */
  pcsResearchSafetyOverride?: 'allow' | 'allow_backwardation_only' | 'allow_bear_only' | 'allow_crisis_phase_only';
  /** 只读研究门：过滤 BULL/SR01 且价格延伸≥2 ATR 的新开仓；默认 off。 */
  pcsResearchEntryFilter?: PCSResearchEntryFilter;
  /** 研究专用：候选3对 V1.2.1 高质量选腿区间按 25% 风险预算释放；默认关闭。 */
  pcsCandidate3V121Release?: 'off' | 'sigma25_lower045_049_quarter';
  /** 研究专用：禁止 PCS 在 RISK_ON_WEAKENING 状态新开；默认关闭。 */
  pcsExcludeRiskOnWeakening?: boolean;
  /** 研究专用：低 ADX + 高区间 + 价格扩张且 VIX<19 时阻断 PCS 新开；默认关闭。 */
  pcsChopVixGate?: boolean;
  /** 研究专用：2.2.1 PCS 组合闸；包含 chop/VIX、SR02 高波动、SR01 过热和 2018 型 BULL 高波动过滤；默认关闭。 */
  pcsBass221Gate?: boolean;
  /** V1.1 PCS 闸：保留 bass2.2.1 保护，并阻断 RISK_ON_WEAKENING 且回撤≥5%、ROC20<0 的慢性转弱段；默认关闭。 */
  pcsV11Gate?: boolean;
  /** bass2.3.3 / V1.2.6：V1.1 底层选择性释放；默认 off。 */
  pcsV11ReleaseMode?: PCSV11ReleaseMode;
  /** V1.2.5：V1.2.3 B30 释放所需的 selected lower；省略时保持历史 0.40。 */
  pcsV123B30ReleaseLower?: number;
  /** V1.2 PCS 闸：V1.1 保护 + Balanced-Tail 状态过滤；默认由 PCS live/API 入口开启。 */
  pcsV12Gate?: boolean;
  /** V1.2.1 PCS 闸：简化5族；先沿用 V1.2 状态保护，再在选腿后的生存率下限/Sigma满足时释放高质量信号。 */
  pcsV121Gate?: boolean;
  /** V1.2.2 PCS 闸：A9+B30+C10；在 V1.2.1 释放后应用，保持独立历史回放口径。 */
  pcsV122Gate?: boolean;
  /** V1.2.3 PCS 历史闸：2.50% 宽度；A9/B30 按选腿生存率条件释放，C10 保留。 */
  pcsV123Gate?: boolean;
  /** 研究专用：V1.2.3 A9/B30/C10 单类释放；未设置时为 current。 */
  pcsV123ReleaseClass?: PCSV123ReleaseClass;
  /** PCS V1.2.4 / bass2.3.2 候选2闸：V1.2.3 基线之上的 A-lite/B-lite/顶端延伸入场过滤。 */
  pcsBass232Candidate2Gate?: boolean;
  /** bass2.3.2 候选3 PCS 闸：将 A-lite 与高 RV BULL/SR01 保护合并，再保留 B-lite/顶端延伸。 */
  pcsBass232Candidate3Gate?: boolean;
  pcsMode?: PCSMode;        // default 'reactive' — 原 PCS 时机，可与页面信号并用
  pcsStockDecisionFilterMode?: PCSStockDecisionFilterMode; // default 'off' — 页面 PCS 开仓来源；2026-07-16 归因：watch_open 增量=卖 vol 尾部（单笔 -$34k），默认关闭
  pcsStockDecisionBearVeto?: 'off' | 'ma200'; // default 'off' — 页面信号的熊市否决：close<ma200 时不开仓（评分高分=事件强度非安全度，下跌中继日需趋势闸）
  pcsStockDecisionVolConfirmDays?: number; // default 0 — 页面信号需 VXN 连续回落 K 日才放行：评分在冲击日最高，等 vol 衰减确认再接（2018 高位崩盘型接刀的时机闸假设）
  pcsStockDecisionPersistDays?: number; // default 0 — raw 页面信号需已连续出现 N 日（不含当日）才放行；streak 由 simulator 跨 bar 维护，live 无 streak 来源时等效关闭
  pcsDeltaStopEnabled?: boolean; // default false — opt-in short-put delta stop, mirrors csProfitTakeEnabled precedent
  pcsDeltaStopThreshold?: number; // default TBD by PT2/PE2 grid scan — do NOT hardcode CS's 0.35 (shown to worsen aggregate PCS PnL naively)
  pcsProfitTakeEnabled?: boolean; // default false — opt-in early profit-take, mirrors csProfitTakeEnabled
  pcsProfitTarget?: number;       // 0.5 | 0.6 | 0.75 — close when profit reaches this % of credit, default TBD by PT2/PE2
  /** 研究专用：PCS 建仓时锁定概率参考线；不改变实时开仓或默认到期结算。 */
  pcsProbabilityReferenceExitMode?: PCSProbabilityReferenceExitMode;
  /** 研究专用：按 as-of 生存率/短腿首次触碰做路径退出；不改变实时开仓或默认到期结算。 */
  pcsSurvivalExitMode?: PCSSurvivalExitMode;
  /** 生存率退出下限；仅 probability/both 消费，默认 0.40。 */
  pcsSurvivalFloor?: number;
  /** 生存率相对建仓预测的最大允许下降；仅 probability/both 消费，默认 0.20。 */
  pcsSurvivalDrop?: number;
  /** 短腿触碰退出确认；仅 touch/both 消费，默认 intraday_touch。 */
  pcsSurvivalTouchConfirmation?: PCSSurvivalTouchConfirmation;
  /** buffered_touch 的 short strike 相对缓冲，默认 0.005（0.5%）。 */
  pcsSurvivalTouchBufferPct?: number;
  /** 研究专用：仅对开仓时 VIX 低于该阈值的 PCS 启用触碰路径退出；未设置则不分层。 */
  pcsSurvivalTouchVixThreshold?: number;
  /** PCS 连败冷静期：亏损平仓后 N 个交易日内不开新仓，N 天后无条件解除（按日期过期，不是交易计数——
   *  计数式设计已确认会在实盘反馈环里自锁，见 memory/pcs-streak-cooldown-selflock-pitfall.md）。
   *  default 0（显式设置后启用）。依据：11-streak-cooldown-timeboxed-2026-07-20.md，
   *  真实 walk-forward 模拟确认不自锁，Discovery/Validation/Holdout 三段（hold_to_expiry + risk_reference）
   *  均通过。设为 0 关闭（等效改动前行为）。 */
  pcsStreakCooldownTradingDays?: number;
  /** 研究回放专用：独立 PCS 样本仍按固定单笔计量，但复用真实未平仓判断限制并发；默认 undefined 保持允许重叠。 */
  pcsMaxOpenPositions?: 1;
  pcsMaxRiskNav?: number;         // dedicated max-loss budget for a single PCS as fraction of NAV; when unset, falls back to csMaxTotalRiskNav / CS_MAX_TOTAL_RISK_NAV (legacy shared behavior)
  /** PS-MDD: PCS 专用预算折扣乘数，1.0=不打折（no-op）。2026-07-24 验证：静态 0.5 使 Ultra Defensive
   *  TQQQ PCS-only 组合 MDD 从 52.87%→42.01%（非因果代理，见 memory pcs-portfolio-mdd-crisis-gate-exit-gap.md——
   *  五条精准检测危险时刻的方向全部 FAIL 后采纳的朴素静态代理）。只影响 PCS 腿的 riskBudget，不影响 CS/IC/EB/BearCS。 */
  pcsRiskBudgetMultiplier?: number;
  /** 研究专用：固定宽度下按压力状态折扣 PCS risk budget；不改变宽度或 Sigma。 */
  pcsPressureSizingMode?: PCSPressureSizingMode;
  /** state_v1 中等压力状态的 risk budget 乘数，默认 0.75。 */
  pcsPressureSizingMediumMultiplier?: number;
  /** state_v1 极端压力状态的 risk budget 乘数，默认 0.50。 */
  pcsPressureSizingStressedMultiplier?: number;
  /** 研究专用：候选4风险包络；只在 V1.2.1 已阻断时释放，默认关闭。 */
  pcsRiskEnvelopeMode?: PCSRiskEnvelopeMode;
  /** 候选4风险包络规则表；默认使用四分支原始表，可切换合并研究臂。 */
  pcsRiskEnvelopeProfile?: PCSRiskEnvelopeProfile;
  pcsShortDelta?: number;         // short-leg |delta| target for PCS; default 0.20 (hardcoded in buildPutSpreadProposal) when unset
  /** 研究选约：用当日历史日频 σ20 距离选短腿；未设置时保持 pcsShortDelta。 */
  pcsShortStrikeSigma?: 1 | 1.5 | 2 | 2.5;
  /** 研究选约：仅用冻结日频因子动态选择 σ、DTE 与宽度；不改变 PCS 入场资格。 */
  pcsContractProfile?: 'dynamic-v1' | 'dynamic-sigma-v1' | 'dynamic-dte-v1' | 'dynamic-width-v1' | 'dynamic-sigma-dte-v1' | 'dynamic-sigma-width-v1' | 'dynamic-dte-width-v1';
  /** 研究选价：按 as-of no-touch 生存率下限筛选 PCS 短腿；不改变默认开仓或退出。 */
  pcsSurvivalPriceSelectionMode?: PCSSurvivalPriceSelectionMode;
  /** Research-only: scale the realized-volatility sigma used by PCS survival selection; undefined preserves exact default behavior. */
  pcsSurvivalSelectionVolatilityScale?: number;
  /** 研究选价使用 no-touch Wilson 下限的最低门槛，默认 0.40。 */
  pcsSurvivalSelectionFloor?: number;
  /** 研究选价：高压状态专用生存率下限；未设置时沿用普通 floor。 */
  pcsSurvivalSelectionStressFloor?: number;
  /** 研究选价排序目标；选价模式开启时默认使用生存率调整后的预期 P&L。 */
  pcsSurvivalSelectionObjective?: PCSSurvivalSelectionObjective;
  /** Research-only: apply the alternate PCS selector objective only in one current regime. */
  pcsSurvivalSelectionObjectiveRegime?: MarketRegime;
  /** Research-only: optionally narrow the scoped PCS selector objective to one slow subregime. */
  pcsSurvivalSelectionObjectiveSlowSubregime?: 'SR01' | 'SR02';
  /** Research-only: optionally activate the scoped PCS selector objective only at/above this ADX14. */
  pcsSurvivalSelectionObjectiveAdxMin?: number;
  /** Research-only: optionally activate the scoped PCS selector objective only at/above this RV20 level. */
  pcsSurvivalSelectionObjectiveRv20Min?: number;
  /** 研究选价：生存率调整权重，0=旧风险效率，1=纯生存率调整；默认 1。 */
  pcsSurvivalSelectionSurvivalWeight?: number;
  /** 研究选价：将 no-touch 点估计与 Wilson 下限混合参与排序，0=点估计，1=Wilson 下限。 */
  pcsSurvivalSelectionWilsonWeight?: number;
  /** 研究选价：约束式排序允许的条件损失/maxLoss 上限；默认 0.75，仅 constrained_tail_efficiency 消费。 */
  pcsSurvivalSelectionMaxConditionalLossRatio?: number;
  /** 研究选价：仅高压状态启用的条件损失 veto；超过 conditionalLoss/maxLoss 即拒绝候选。 */
  pcsSurvivalSelectionStressTailVetoRatio?: number;
  /** Research-only: restrict the stress tail veto to one current regime. */
  pcsSurvivalSelectionStressTailVetoRegime?: MarketRegime;
  /** Research-only: optionally narrow the stress tail veto to one slow subregime. */
  pcsSurvivalSelectionStressTailVetoSlowSubregime?: 'SR01' | 'SR02';
  /** Research-only: optionally activate the stress tail veto only below this current RV20 level. */
  pcsSurvivalSelectionStressTailVetoRv20Max?: number;
  /** 研究选价：仅 stress_only_dynamic_v1 高压状态使用的生存率权重；未设置时沿用普通权重。 */
  pcsSurvivalSelectionStressWeight?: number;
  /** 研究选价：fixed 使用 pcsTargetDte；dynamic_dte_v1 按冻结 VIX/RV/期限结构切换 28/35/42 DTE。 */
  pcsSurvivalSelectionDteMode?: PCSSurvivalSelectionDteMode;
  /** 研究选价：fixed 使用 pcsSpreadWidthPct；dynamic_width_v1 按冻结状态切换 1.5%/2.0% 宽度；guarded_dynamic 在没有足够优势时回退基准宽度；stress_dynamic 仅高压切换；state_guarded 仅高压且带基准回退；joint_dynamic 同时比较 Sigma×宽度；tail_triggered 按条件尾部触发。 */
  pcsSurvivalSelectionWidthMode?: PCSSurvivalSelectionWidthMode;
  /** 研究选价：动态宽度相对 pcsSpreadWidthPct 的收缩比例；0=固定基准，1=完整动态宽度。 */
  pcsSurvivalSelectionWidthBlend?: number;
  /** 研究选价：confirmed 动态宽度要求当前压力状态连续确认的天数；支持1/2/5日。 */
  pcsSurvivalSelectionWidthConfirmDays?: number;
  /** 研究选价：guarded_dynamic 的动态宽度相对固定基准至少需要的分数优势；用于切换死区/滞回。 */
  pcsSurvivalSelectionWidthSwitchMargin?: number;
  /** 研究选价：expected-pnl-lcb 宽度切换要求相对固定宽度的最低预期 P&L 增量。 */
  pcsSurvivalSelectionWidthDeltaPnlFloor?: number;
  /** 研究选价：动态宽度相对固定宽度的条件尾部严重度必须改善的比例；0=不得变差。 */
  pcsSurvivalSelectionWidthTailImprovementMargin?: number;
  /** 研究选价：联合宽度排序时，窄宽度相对固定2%必须保留的 credit 比例。 */
  pcsSurvivalSelectionCreditRetentionFloor?: number;
  /** 研究选价：tail_triggered_dynamic_width_v1 的条件尾部损失/maxLoss 触发阈值，默认 0.75。 */
  pcsSurvivalSelectionTailWidthTriggerRatio?: number;
  /** 研究选价：full 全 Sigma 排序；stress_only_dynamic_v1 仅高压状态使用 dynamic-v1 Sigma。 */
  pcsSurvivalSelectionSigmaMode?: PCSSurvivalSelectionSigmaMode;
  /** Research-only: explicitly restrict the Sigma candidate set; undefined preserves the existing mode-derived set. */
  pcsSurvivalSelectionCandidateSigmas?: readonly (1 | 1.5 | 2 | 2.5)[];
  pcsSpreadWidthPct?: number;     // PCS long-strike offset from short strike, as % of spot; default CS_SPREAD_WIDTH_PCT when unset
  /** Research-only current-bar width override; omitted preserves the fixed PCS width. */
  pcsResearchSpreadWidthBySlowSubregime?: Partial<Record<'SR01' | 'SR02', number>>;
  /** Research-only current-bar width override when observed spot VIX is at or below maxVix. */
  pcsResearchSpreadWidthByVix?: { maxVix: number; widthPct: number };
  pcsTargetDte?: number;          // PCS target days-to-expiry; default SPREAD_TARGET_DTE when unset

  // ── Equity Boost Put Spread (QQQ 1:1 defined-risk credit spread; independent of PCS) ──
  enableEquityBoostPCS?: boolean; // default false — allow QQQ Equity Boost Put Spread
  equityBoostEntryMode?: 'continuous' | 'post_pullback' | 'melt_up' | 'post_pullback_or'; // default 'continuous'
  equityBoostTargetDte?: 21 | 28 | 35 | 42; // default 28
  /** 研究专用；undefined/'fixed' 保持原有固定DTE行为。 */
  equityBoostDteMode?: 'fixed' | 'risk_adaptive_v1' | 'risk_adaptive_hysteresis_v1' | 'state_adaptive_sr01_v1' | 'state_adaptive_bad_sr01_v1' | 'price_adaptive_v1';
  equityBoostDynamicDteVxnThreshold?: number; // risk_adaptive_v1/hysteresis: VXN>=阈值进入高压28
  equityBoostDynamicDteRecoveryVxnThreshold?: number; // hysteresis: VXN<=阈值且满足最短持有后恢复低压35
  equityBoostDynamicDteMinHighRiskDays?: number; // hysteresis: 高压状态最少保持的交易日数
  equityBoostDynamicDtePriceThresholdPct?: number; // price_adaptive_v1: price_vs_sma200_pct 低于阈值时使用28 DTE
  /** 研究专用；EB原生宽度由腿距产生，这里只控制候选组合的目标腿距。 */
  equityBoostWidthMode?: 'fixed' | 'fixed_target_v1' | 'risk_adaptive_v1' | 'price_adaptive_v1';
  equityBoostDynamicWidthVxnThreshold?: number; // risk_adaptive_v1: VXN>=阈值用高压目标宽度
  equityBoostDynamicWidthLowVxnTargetPct?: number;
  equityBoostDynamicWidthHighVxnTargetPct?: number;
  equityBoostDynamicWidthPriceThresholdPct?: number; // price_adaptive_v1: price_vs_sma200_pct 低于阈值时使用低位目标宽度
  equityBoostDynamicWidthLowPriceTargetPct?: number;
  equityBoostProfitTarget?: 0.225 | 0.5 | 0.75;     // undefined = no active profit-take, hold to expiry/forced-close
  /** 研究专用：entry_price_adaptive_v1 只对入场时低于 SMA200 阈值的 EB 启用上述止盈。 */
  equityBoostProfitTargetMode?: 'fixed' | 'entry_price_adaptive_v1' | 'entry_bad_sr01_adaptive_v1';
  equityBoostProfitTargetPriceThresholdPct?: number;
  equityBoostMaxRiskNav?: number;           // default EQUITY_BOOST_DEFAULT_MAX_RISK_NAV (0.02)
  // Research-only overrides (EB1 widened-search iteration, 2026-07). Not exposed in UI forms;
  // undefined preserves the original fixed constants (-3%/20 pullback gate, 0.8-1.2 ratio) exactly.
  equityBoostPullbackRocCeiling?: number;   // default -0.03 (post_pullback QQQ ROC5 must be <= this)
  equityBoostPullbackVixFloor?: number;     // default 20 (post_pullback VIX must be >= this)
  equityBoostRatioMin?: number;             // default EQUITY_BOOST_RATIO_MIN (0.8)
  equityBoostRatioMax?: number;             // default EQUITY_BOOST_RATIO_MAX (1.2)
  /** 研究专用：软选腿时偏好的 credit/max-loss ratio；不改变 ratio 边界或开仓笔数。 */
  equityBoostRatioSelectionTarget?: number;
  /** 研究专用：保留宽度目标但可让 ratio 误差先于宽度误差排序；undefined 保持宽度优先。 */
  equityBoostLegSelectionPriority?: 'width_first' | 'ratio_first';
  /** 研究专用：仅低于 SMA200 阈值时使用较低的软 ratio 偏好，其他入场仍使用普通偏好。 */
  equityBoostRatioSelectionTargetMode?: 'fixed' | 'price_adaptive_v1' | 'rv_adaptive_v1' | 'state_adaptive_v1';
  equityBoostRatioSelectionPriceThresholdPct?: number;
  equityBoostRatioSelectionLowPriceTarget?: number;
  equityBoostRatioSelectionRv20Threshold?: number;
  equityBoostRatioSelectionHighRvTarget?: number;
  /** 研究专用：state_adaptive_v1 仅在显式列出的 regime|slowSubregime 子状态使用较低的软 ratio 偏好。 */
  equityBoostRatioSelectionStateTargetStates?: readonly string[];
  equityBoostRatioSelectionStateTarget?: number;
  // Research-only overrides (EB2 melt_up-entry iteration, 2026-07). Not exposed in UI forms;
  // undefined preserves the fixed constants (2% drawdown ceiling, VIX<=15, ROC20>0) exactly.
  equityBoostMeltUpDrawdownMax?: number;    // default EQUITY_BOOST_MELTUP_DRAWDOWN_MAX (0.02)
  equityBoostMeltUpVixCeiling?: number;     // default EQUITY_BOOST_MELTUP_VIX_CEILING (15)
  equityBoostMeltUpRoc20Min?: number;       // default EQUITY_BOOST_MELTUP_ROC20_MIN (0)
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 RANGE_BOUND/SR02 时禁止新开 EB——
   *  continuous 模式10年独立单笔回测：该子状态 n=136/胜率40.4%/净P&L -$31,024，单独贡献组合86.6%的MDD（-$39,212/-$45,301）。 */
  equityBoostExcludeRangeBoundSr02?: boolean;
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 RISK_ON_EXTENDED/SR01 时禁止新开 EB——
   *  continuous 模式基线分桶：该子状态 n=61/胜率45.9%/净P&L -$5,188/MDD -$10,667。2026-08-23 胜率/尾部优化扫描新增。 */
  equityBoostExcludeRiskOnExtendedSr01?: boolean;
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 SIDEWAYS/SR01 时禁止新开 EB——
   *  continuous 模式基线分桶：该子状态 n=94/胜率45.7%/净P&L -$2,330/MDD -$11,547。2026-08-23 胜率/尾部优化扫描新增。 */
  equityBoostExcludeSidewaysSr01?: boolean;
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 RISK_ON_WEAKENING/SR01 时禁止新开 EB——
   *  continuous 模式基线分桶：该子状态 n=88/胜率60.2%/净P&L +$6,927/MDD -$7,495（净正但低于三重排除后66.2%的整体胜率）。2026-08-23 追加胜率优化扫描新增。 */
  equityBoostExcludeRiskOnWeakeningSr01?: boolean;
  /** 研究专用：default undefined=off。regime+slowSubregime 命中 RISK_ON_EXTENDED/SR02 时禁止新开 EB——
   *  continuous 模式基线分桶：该子状态 n=389/胜率61.7%/净P&L +$50,379/MDD -$12,171（组合最大单笔$贡献桶之一，胜率低于整体但绝对收益很高，排除代价大）。2026-08-23 追加胜率优化扫描新增。 */
  equityBoostExcludeRiskOnExtendedSr02?: boolean;
  /** 研究专用：default undefined=off。regime+subregime 排除闸被诊断为"弱代理变量"后（79.6%亏损笔发生在
   *  持仓期QQQ下跌时，但开仓时VIX在亏/赢笔间几乎无差异），改测多因子筛选找到的候选。三重排除基线上，
   *  trend==='STRONG_BULL' 时禁止新开——该分类 n=221/胜率59.3%（整体66.2%）/总P&L $15,515，样本量与
   *  priceVsSma200Pct 的相关性方向一致（入场时越"超涨"越容易亏）。2026-08-24 因子筛选新增。 */
  equityBoostExcludeStrongBullTrend?: boolean;
  /** 研究专用：2.2.1 回放使用的 EB BULL/SR02 + VIX/RV20/ROC20 过滤；默认关闭。 */
  equityBoostBass221Gate?: boolean;
  /** 2.2.1 候选 EB：RANGE_BOUND/SR01 慢反转时启用 VIX/ROC5 反弹确认闸；默认关闭。 */
  equityBoostBass221VixReboundGate?: boolean;
  /** 2.2.1 严重度缩放：命中 RV20/20日区间严重度时，将 EB 风险预算乘以该系数；默认不缩放。 */
  equityBoostBass221SeverityMultiplier?: number;
  /** 研究专用：当前 bar 宏观风险簇缩放；undefined 保持关闭。 */
  equityBoostMacroRiskMode?: 'risk_on_weakening_neutral_stale_v1' | 'macro_tilt_v1' | 'macro_safe_cluster_tilt_v1' | 'macro_bull_lowvix_cluster_tilt_v1' | 'macro_bull_lowvix_weakening_tilt_v1' | 'macro_bull_lowvix_neutral_tilt_v1' | 'macro_bull_lowvix_weakening_neutral_tilt_v1' | 'macro_bull_weakening_neutral_tilt_v1' | 'macro_bull_weakening_range_neutral_tilt_v1' | 'macro_bull_weakening_range_all_tilt_v1' | 'macro_bull_weakening_all_range_neutral_tilt_v1' | 'macro_bull_weakening_range_neutral_sideways_defensive_tilt_v1' | 'macro_bull_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_weakening_range_neutral_bear_defensive_tilt_v1' | 'macro_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_neutral_weakening_range_neutral_bear_sr01_defensive_tilt_v1' | 'macro_bull_neutral_weakening_range_neutral_bear_sr01_split_budget_v1';
  equityBoostMacroRiskMultiplier?: number;
  /** 研究专用：macro_tilt_v1 的低风险宏观状态升仓系数；默认关闭。 */
  equityBoostMacroRiskUpMultiplier?: number;
  equityBoostMacroRiskRangeMultiplier?: number;
  equityBoostMacroRiskBullNeutralSr02Multiplier?: number;
  /** Research-only current-bar low-VIX BULL/NEUTRAL/SR02 budget; undefined keeps the shared split-budget multiplier. */
  equityBoostMacroRiskBullNeutralSr02LowVixMultiplier?: number;
  /** Research-only current-bar BULL/NEUTRAL/SR01 donor budget in split-budget mode; undefined uses the shared up multiplier. */
  equityBoostMacroRiskBullNeutralSr01Multiplier?: number;
  equityBoostMacroRiskBullSr02BullTrendMultiplier?: number;
  equityBoostMacroRiskVixLowMultiplier?: number;
  equityBoostMacroRiskVixMidMultiplier?: number;
  equityBoostMacroRiskVixHighMultiplier?: number;
  /** Research-only current-bar relief factor for RISK_ON_EXTENDED/SR02/VIX<16 under split-budget mode; undefined=off. */
  equityBoostMacroRiskExtendedSr02LowVixMultiplier?: number;
  /** 研究专用：macro_tilt_v1 的高风险宏观状态降仓系数；默认关闭。 */
  equityBoostMacroRiskDownMultiplier?: number;
  /** 研究专用：default undefined=off。三重排除基线上，csPreCrisisActive===true（低VIX+TQQQ实现波动率抬升
   *  的"暴风雨前"诊断标记，复用 CS 现成计算）时禁止新开 EB——该分组 n=343/胜率60.3%（非预危机组68.5%）/
   *  总P&L $41,658 vs $131,610。2026-08-24 因子筛选新增。 */
  equityBoostExcludeCsPreCrisis?: boolean;
  /** 研究专用：default undefined=off。价格相对200日均线偏离度超过该阈值时禁止新开 EB——三重排除基线因子
   *  筛选里数值因子中与胜负相关性最强的一项（r=-0.187；亏损笔均值11.98% vs 盈利笔均值10.08%）。
   *  未设置时不限制。2026-08-24 因子筛选新增。 */
  equityBoostPriceVsSma200Ceiling?: number;
  /** 研究专用：default undefined=off。VXN（纳斯达克波动率指数，比大盘VIX更贴合QQQ实际敞口）超过该阈值时
   *  禁止新开 EB——第二轮因子筛选：数值因子里第三强（r=-0.100；亏损笔均值20.02 vs 盈利笔均值19.03），
   *  跟已验证的 priceVsSma200Pct 相关但非完全重复（同为"过热"信号的不同侧面）。未设置时不限制。
   *  2026-08-24 第二轮因子筛选新增。 */
  equityBoostVxnCeiling?: number;
  /** 研究专用：仅 RISK_ON_WEAKENING/SR01 生效。VXN/VIX 达到该比例时禁止新开；缺少波动率值时安全拦截。 */
  equityBoostRiskOnWeakeningSr01VxnVixRatioCeiling?: number;
  /** 研究专用：仅 RISK_ON_WEAKENING/SR01 生效。要求当前 VXN 高于 10 个交易日前；历史不足时安全拦截。 */
  equityBoostRiskOnWeakeningSr01RequireVxn10dRising?: boolean;
  /**
   * 研究专用：候选6-MDD。仅历史回放显式开启；在候选 EB 的重叠、状态和
   * 已实现回撤达到阈值时缩减风险预算。默认关闭，不改变实盘默认链路。
   */
  equityBoostCandidate6Mdd?: boolean;

  enableIC?: boolean;       // default true — allow Iron Condor
  icMode?: ICMode;
  icMaxConcurrent?: number; // default 1 — when >1, simulator can stagger half-budget ICs; live proposal risk is divided by this count
  // Not profile default: 2026-07 main window IC profit-take cut IC pnl 7834→3463.
  // icMode='relaxed' improved the main window but failed robustness (2018 MDD +14.8pp).
  icProfitTakeEnabled?: boolean; // default false — opt-in IC 止盈，腾出 slot 立即再入场
  icProfitTarget?: number;       // 0.45 | 0.5 | 0.6 — close when profit reaches this % of credit, default 0.5
  collarRenewalInBear?: boolean;     // default false — when in BEAR/CRISIS and collar closes, bypass position-size gate and re-open immediately
  // Research-only. Omitted/'normal' preserves v1 mutual exclusion; non_blocking is used only by Collar causality experiments.
  collarInteractionMode?: 'normal' | 'non_blocking';
  collarCashMode?: 'normal' | 'shadow'; // research-only shadow ledger; omitted preserves v1 NAV/cash
  crisisPendingThreshold?: number;   // default 3 — consecutive CRISIS bars before CONFIRMED
  // @frozen preset default
  crisisRecoveryBars?: number;       // default 5 — cooldown bars after crisis clears before re-entry
  // UI profile default false after 2026-07 calibration: 2022 home slice had 36 rounds,
  // 41.7% win rate, net -4350. A 0.6c take-profit / 2c stop-loss needs 77% win rate;
  // negative expectancy is structural, and delta 0.32 short calls cannot absorb bear rallies.
  // Re-enable only after fixing payoff structure and re-running evaluation.
  enableBearOverlay?: boolean;       // default true — allow QQQ Bear Call Spread overlay
  bearOverlayMode?: BearOverlayMode; // default 'strict'
  bearProfitTarget?: number;         // 0.5 | 0.6 | 0.75 — close when profit reaches this % of credit, default 0.6
  bearRoc5ExitRequiresLoss?: boolean; // default false — only simulator Bear CS ROC5 exit waits for loss when true
  maxSingleBearSpreadRisk?: number;  // default 0.02 NAV per spread
  maxTotalBearOverlayRisk?: number;  // default 0.12 NAV total
  maxOpenBearSpreads?: number;       // default 6
  cooldownAfterOpenDays?: number;    // default 3
  cooldownAfterLossDays?: number;    // default 10
  // @frozen ── Re-entry speedups (opt-in; preset-tiered, conservative keeps all off) ──
  // Extend the min(5d,10d,20d) realized-vol blend to SIDEWAYS/RANGE_BOUND so a calmed
  // tape re-sizes TQQQ before the full 20d window rolls off. Safety preserved: a fresh
  // spike raises the short window, so min() reverts to 20d. Default false.
  fastVolReentry?: boolean;
  // @frozen preset default — A deep price-vs-SMA200 drawdown (≤ -20%) normally keeps the crisis state machine latched
  // far into a recovery because SMA200 lags. When true, that price term only sustains crisis
  // while VIX is still elevated (≥25); a calm rebound exits crisis on schedule. Default false.
  vixLedCrisisExit?: boolean;
  // STRONG_BEAR trend + regime≠BULL is a hard re-entry block. When true, it is downgraded to a
  // discount (warning) in recovery regimes (SIDEWAYS/RANGE_BOUND/RISK_ON_*), while BEAR/CRISIS
  // still hard-block. Lets sizing resume earlier under the existing trend discounts. Default false.
  softenStrongBearBlock?: boolean;
  // @frozen preset default — After crisis RECOVERY has cleared, lower the TQQQ buy floor for N decision bars.
  // true uses 10 bars / 2%; object can tune it. Default false.
  postCrisisFastEntry?: boolean | { days?: number; minBuyDeltaPct?: number };
  // Skip reactive Collar opens when implied vol is rich vs realized vol. true uses VIX/RV <= 1.4.
  // Default false.
  collarIvGate?: boolean | { maxVixRvRatio?: number };
  // Phase 3 opt-in rebuild. 2026-07 matrix found `top_protect + rollingHigh + hold + qqq`
  // fixes collar cycle quality (main collar pnl +1255, 2020 MDD 14.9%→12.2%) but fails
  // profile-default NAV MDD gate on the main window (noCollar 4.6%, candidate 8.5%).
  // Keep these manual until skew/slippage calibration is revisited.
  collarStrikeAnchor?: 'spot' | 'rollingHigh'; // default 'spot'
  collarFloorPct?: number; // rollingHigh anchor floor, default 0.10
  collarMaxDebitPct?: number; // max debit as protected notional pct, default 0.01
  collarExitProfile?: 'legacy' | 'hold'; // default 'legacy'
  collarPutUnderlying?: 'leveraged' | 'qqq'; // default 'leveraged'
  // Include open option legs' net delta exposure in E02 leverage checks. Default false.
  includeOptionDeltaInLeverage?: boolean;
  // @frozen ── Intraday de-risk gate (opt-in; live-only; preset-tiered) ──────────────
  // When the real-time leveraged price has dropped intraday vs the last *completed*
  // daily close beyond a tier threshold, scale down the close-based TQQQ target
  // immediately instead of waiting for the close. Freed weight is split 50/50 to
  // cash + BOXX. No-op in backtest (no per-bar live quote) and when market is closed
  // (live quote ≈ last close). Default false; conservative preset enables it.
  intradayDeRisk?: boolean;
  // @frozen preset default — Laddered thresholds on the leveraged ETF intraday drawdown; deepest matched tier
  // wins. dropPct/keepFactor are fractions in [0,1]. Omit to use DEFAULT_INTRADAY_DERISK_TIERS.
  intradayDeRiskTiers?: { dropPct: number; keepFactor: number }[];
};

export const FLASH_CRASH_OVERRIDE_DEFAULT = {
  vixSpikeRatio: 1.05,
  vixMin: 24,
  maxSpeedDays: 50,
  drawdownThreshold: -0.12,
  mode: 'hardmax' as const,
  releaseBars: 15,
};

export type MacroRegimeClassifier = 'm0b' | 'w0-week-raw' | 'w5-hybrid' | 'w7-hybrid' | 'w9-fast' | 'w10-balanced' | 'w11-observe';

// Fallback tiers when intradayDeRisk is on but no explicit tiers provided.
// Calibrated via backtest (06b-intraday-risk-gate made backtestable): the original
// 5/8/11 -> .85/.60/.40 tiers whipsawed heavily on intrabar noise at 1h (100+ on/off
// toggles across a multi-year synthetic run); widening the thresholds and softening
// the keep-factors below materially cut whipsaw while improving return/Sharpe/drawdown.
// Per-preset tiers (conservative/aggressive) are this baseline scaled tighter/looser.
export const DEFAULT_INTRADAY_DERISK_TIERS: { dropPct: number; keepFactor: number }[] = [
  { dropPct: 0.08, keepFactor: 0.90 },
  { dropPct: 0.12, keepFactor: 0.75 },
  { dropPct: 0.16, keepFactor: 0.60 },
];

export type StrategyPreset = 'conservative' | 'neutral' | 'aggressive' | 'ultra' | 'ultra-defensive';
export const DEFAULT_STRATEGY_PRESET: StrategyPreset = 'ultra-defensive';

type StrategyPresetDefinition = {
  label: string; labelEn: string; color: string; desc: string; params: StrategyParams;
};

const BASE_STRATEGY_PRESETS: Record<
  Exclude<StrategyPreset, 'ultra-defensive'>,
  { label: string; labelEn: string; color: string; desc: string; params: StrategyParams }
> = {
  conservative: {
    label: '保守',
    labelEn: 'Conservative',
    color: '#6EE7B7',
    desc: '低波动目标 10%，TQQQ 上限 35%，流动性充裕',
    params: {
      maxTqqqHardPct: 0.35,
      maxTqqqWarnPct: 0.25,
      maxLeverage: 1.5,
      minLiquidPct: 0.30,
      maxDailyLossPct: 0.03,
      drawdownWarnPct: 0.10,
      targetVol: 0.10,
      minVolFloor: 0.08,
      minCashReserve: 0.08,
      maxSellPerBarPct: 0.15,
      navDrawdownGovernor: {
        tiers: [
          { ddPct: 0.15, factor: 0.60 },
          { ddPct: 0.22, factor: 0.30 },
        ],
        regimeGated: true,
      },
      // CS risk budget stays at 0.05 here: the global 0.10 raised this preset's user-window
      // MDD 7.9%→9.9% (Calmar 2.12→1.70) — conservative pays for drawdown, not premium.
      csMaxTotalRiskNav: 0.05,
      // postCrisisFastEntry: +0.47 Calmar in the 2020 V-recovery, no drawdown cost in any slice.
      // volEstimator 'ewma_vix_blend' is NOT defaulted: it is 2022-style-extended-bear insurance
      // (robustness: bear-slice MDD -1~-2pp) that on the 2023-26 melt-up window cost -4.5pp CAGR
      // with essentially no MDD reduction. Enable manually when hedging an extended bear.
      postCrisisFastEntry: true,
      // Intraday de-risk: on by default for the most risk-averse preset. Tighter than the
      // validated 8/12/16 baseline (DEFAULT_INTRADAY_DERISK_TIERS) so it reacts earlier;
      // calibration re-check confirmed this doesn't reintroduce the whipsaw pattern the
      // original (pre-calibration) 4/6/9 tiers had.
      intradayDeRisk: true,
      intradayDeRiskTiers: [
        { dropPct: 0.07, keepFactor: 0.88 },
        { dropPct: 0.11, keepFactor: 0.73 },
        { dropPct: 0.14, keepFactor: 0.58 },
      ],
    },
  },
  neutral: {
    label: '中性',
    labelEn: 'Neutral',
    color: '#93C5FD',
    desc: '目标波动 15%，TQQQ 上限 60%，系统默认参数',
    params: {
      maxTqqqHardPct: 0.60,
      maxTqqqWarnPct: 0.40,
      maxLeverage: 2.5,
      minLiquidPct: 0.20,
      maxDailyLossPct: 0.05,
      drawdownWarnPct: 0.15,
      targetVol: 0.15,
      minVolFloor: 0.10,
      minCashReserve: 0.05,
      maxSellPerBarPct: 0.15,
      navDrawdownGovernor: {
        tiers: [
          { ddPct: 0.15, factor: 0.60 },
          { ddPct: 0.22, factor: 0.30 },
        ],
        regimeGated: true,
      },
      // Re-entry tier 1: faster vol-driven re-sizing in sideways/range recoveries
      fastVolReentry: true,
      // Robustness matrix: regime-tiered sell deadband trimmed 2022 MDD by ~3.7pp at
      // unchanged bull-year results; ER gate keeps 2022 directional bear protection while
      // avoiding 2025 low-ER chop round trips. postCrisisFastEntry is a free 2020-recovery gain.
      // ewma_vix_blend deliberately NOT defaulted here — it cost -0.87 Calmar in the
      // 2020 slice for this preset (early de-risk missed the V-rebound).
      sellDeltaByRegime: {
        RISK_ON_WEAKENING: 0.07,
        SIDEWAYS: 0.07,
        RANGE_BOUND: 0.07,
        BEAR: 0.04,
        CRISIS: 0.03,
      },
      sellDeltaErThreshold: 0.25,
      postCrisisFastEntry: true,
      // crisisRecoveryBars: 5 → 2. 2026-07 calibration (robustness.ts + compare-window.ts):
      // clean win — 2020 CAGR +1.6~5.8pp, Calmar +0.10~0.27, zero MDD/flips cost on 2018/2022/UI
      // window. Only real CONFIRMED-CRISIS events in the tested history are 2018/2020 (both clean
      // single-dip recoveries); no double-dip sample exists to stress-test the shorter cooldown.
      crisisRecoveryBars: 2,
      // Intraday de-risk available but off by default; this is DEFAULT_INTRADAY_DERISK_TIERS,
      // the calibrated baseline (see backtest calibration note near that constant).
      intradayDeRisk: false,
      intradayDeRiskTiers: [
        { dropPct: 0.08, keepFactor: 0.90 },
        { dropPct: 0.12, keepFactor: 0.75 },
        { dropPct: 0.16, keepFactor: 0.60 },
      ],
      // 2026-07-11 flashCrashOverride opt-in: avoids selling low in flash crashes (e.g. 2024-08, 2025-04)
      // see validation data in docs/overlay-tuning/flash-crash-discriminator-2026-07-11.md
      flashCrashOverride: {
        vixSpikeRatio: 1.05,
        vixMin: 24,
        maxSpeedDays: 50,
        drawdownThreshold: -0.12,
        mode: 'hardmax',
        releaseBars: 15,
      },
    },
  },
  aggressive: {
    label: '激进',
    labelEn: 'Aggressive',
    color: '#FCD34D',
    desc: '目标波动 20%，TQQQ 上限 75%，追求超额收益',
    params: {
      maxTqqqHardPct: 0.75,
      maxTqqqWarnPct: 0.55,
      maxLeverage: 3.0,
      minLiquidPct: 0.15,
      maxDailyLossPct: 0.07,
      drawdownWarnPct: 0.20,
      targetVol: 0.20,
      minVolFloor: 0.12,
      minCashReserve: 0.03,
      maxSellPerBarPct: 0.15,
      navDrawdownGovernor: {
        tiers: [
          { ddPct: 0.15, factor: 0.60 },
          { ddPct: 0.22, factor: 0.30 },
        ],
        regimeGated: true,
      },
      // Re-entry tier 2: + VIX-led crisis exit (don't stay latched on lagging SMA200)
      fastVolReentry: true,
      vixLedCrisisExit: true,
      // sellDeltaByRegime added +0.22 Calmar in 2023-24 and trimmed 2022 MDD; the ER gate
      // preserves that directional-bear benefit without amplifying 2025 low-ER chop, and is
      // a no-op on the 2023-26 melt-up window.
      // volEstimator 'ewma_vix_blend' is NOT defaulted: despite improving 3/4 historical
      // slices, on the 2023-26 melt-up window it cost -3.6pp CAGR (EWMA reads calm periods
      // as low vol → oversized into the 2024-08 crash). 2022-bear insurance, enable manually.
      sellDeltaByRegime: {
        RISK_ON_WEAKENING: 0.07,
        SIDEWAYS: 0.07,
        RANGE_BOUND: 0.07,
        BEAR: 0.04,
        CRISIS: 0.03,
      },
      sellDeltaErThreshold: 0.25,
      postCrisisFastEntry: true,
      // crisisRecoveryBars: 5 → 2. 2026-07 calibration (robustness.ts + compare-window.ts):
      // clean win — 2020 CAGR +1.6~5.8pp, Calmar +0.10~0.27, zero MDD/flips cost on 2018/2022/UI
      // window. Only real CONFIRMED-CRISIS events in the tested history are 2018/2020 (both clean
      // single-dip recoveries); no double-dip sample exists to stress-test the shorter cooldown.
      crisisRecoveryBars: 2,
      // 'hardmax': robustness shows riding V-recoveries beats selling to target for this
      // preset (2020 CAGR 24%→35%, 2025 +6pp); cost is 2018 +2.9pp / 2022 +5.2pp MDD.
      upstreamBlockSellMode: 'hardmax',
      // Intraday de-risk off by default; wider than the validated 8/12/16 baseline so it
      // only reacts to more severe moves (aggressive users accept more intraday drawdown).
      intradayDeRisk: false,
      intradayDeRiskTiers: [
        { dropPct: 0.09, keepFactor: 0.92 },
        { dropPct: 0.13, keepFactor: 0.78 },
        { dropPct: 0.17, keepFactor: 0.63 },
      ],
    },
  },
  ultra: {
    label: '超激进',
    labelEn: 'Ultra',
    color: '#F87171',
    desc: '目标波动 28%，TQQQ 上限 90%，极高风险敞口',
    params: {
      maxTqqqHardPct: 0.90,
      maxTqqqWarnPct: 0.70,
      maxLeverage: 3.5,
      minLiquidPct: 0.08,
      maxDailyLossPct: 0.10,
      drawdownWarnPct: 0.30,
      targetVol: 0.28,
      minVolFloor: 0.15,
      minCashReserve: 0.02,
      targetWeightSmoothing: { downHalfLifeBars: 2, downVixCeiling: 20, downMaxDropPp: 10 },
      // 2026-07 fixed-snapshot calibration: strongBearTrendFactor 0.35 + ramp 0.20
      // improves 2020 MDD 38.10%→21.51%, 2018 22.89%→18.38%, and 2022 30.37%→23.93%;
      // melt_up CAGR 42.15%→40.18% stays within the 2pp budget, while user_2025 Calmar
      // rises 8.62→9.44. Adopted for ultra only after passing all fixed-snapshot gates.
      strongBearTrendFactor: 0.35,
      strongBearTrendFactorChop: 0.5,
      maxSellPerBarPct: 0.2,
      navDrawdownGovernor: {
        tiers: [
          { ddPct: 0.15, factor: 0.60 },
          { ddPct: 0.22, factor: 0.30 },
        ],
        regimeGated: true,
      },
      fastVolReentry: true,
      vixLedCrisisExit: true,
      // softenStrongBearBlock 于 2026-07-11 移除(手术 armB,docs/overlay-tuning/ultra-default-surgery-2026-07-11.md):
      // 干净模拟器上 2022 MDD -2.41pp、2025 tariff CAGR +3.43pp、UI 双口径均改善,代价仅 2023-24 -1.72pp。
      // 同场手术拒绝了 armD(ramp→hardmax):裸切片 2020 +28pp 但 UI 覆盖口径 MDD +1.0pp/Calmar 转差、
      // 2023-24 -6.15pp。armD 仅作纯股票/轻 overlay 场景的手动选项(hardmax + 关本开关),勿设默认。
      postCrisisFastEntry: true,
      // crisisRecoveryBars: 5 → 2. 2026-07 calibration (robustness.ts + compare-window.ts):
      // clean win — 2020 CAGR +1.6~5.8pp, Calmar +0.10~0.27, zero MDD/flips cost on 2018/2022/UI
      // window. Only real CONFIRMED-CRISIS events in the tested history are 2018/2020 (both clean
      // single-dip recoveries); no double-dip sample exists to stress-test the shorter cooldown.
      crisisRecoveryBars: 2,
      // 2026-07 fixed-snapshot gates: 2020 CAGR +4.07pp / Calmar +0.20，MDD 不变；
      // 其余风险、chop、股票 UI 与完整 overlay UI 门槛全部通过。
      // 2026-07-17 m0b → w7-hybrid：当前 HEAD 行为等价（w7-econ-grid 12-cell |Δ|≤0.44pp），
      // 死开关回归 ALIVE；phase-policy 规则采纳后须重跑 econ grid 复核分类器经济差异。
      macroRegime: { boostFactor: 1, classifier: 'w7-hybrid' },
      stockPhasePolicy: {
        SLOW_BULL_GROWTH: {
          overrides: {
            maxTqqqWarnPct: 0.90,
            costBasisDrawdownCapPct: 0.90,
            targetVolMultiplier: 1.60,
            riskOnWeightMultiplier: 1.30,
            chopWeightMultiplier: 1.10,
            rangeBoundCapMode: 'scaled',
            upstreamBlockSellMode: 'hardmax',
            maxSellPerBarPctMultiplier: null,
          },
          gate: { vixMax: 35 },
        },
      },
      upstreamBlockSellMode: 'ramp',
      upstreamBlockSellModeChop: 'hardmax',
      // 2026-07-11 flashCrashOverride opt-in: avoids selling low in flash crashes (e.g. 2024-08, 2025-04)
      // see validation data in docs/overlay-tuning/flash-crash-discriminator-2026-07-11.md
      flashCrashOverride: FLASH_CRASH_OVERRIDE_DEFAULT,
    },
  },
};

const ultraDefensiveParams = structuredClone(BASE_STRATEGY_PRESETS.ultra.params);
ultraDefensiveParams.pcsRiskBudgetMultiplier = 0.5;
const ultraGrowthPolicy = ultraDefensiveParams.stockPhasePolicy!;
ultraDefensiveParams.stockPhasePolicy = {
  ...ultraGrowthPolicy,
  SLOW_BULL_GROWTH: {
    ...ultraGrowthPolicy.SLOW_BULL_GROWTH!,
    overrides: { ...ultraGrowthPolicy.SLOW_BULL_GROWTH!.overrides, targetVolMultiplier: 2.2 },
    gate: { ...ultraGrowthPolicy.SLOW_BULL_GROWTH!.gate, ...ULTRA_DEFENSIVE_GROWTH_GATE },
  },
  SLOW_BEAR_RECOVERY: STATE_BAL85_RECOVERY_POLICY,
};
export const STRATEGY_PRESETS: Record<StrategyPreset, StrategyPresetDefinition> = {
  ...BASE_STRATEGY_PRESETS,
  'ultra-defensive': {
    label: '超防御',
    labelEn: 'Ultra Defensive',
    color: '#A78BFA',
    desc: 'STATE-BAL85：SR02 后验≥85% + 条件化熊市恢复；固定启用 D1 Recovery 与 Flash-Crash 保护',
    params: ultraDefensiveParams,
  },
};

export const DEFAULT_STRATEGY_PARAMS: StrategyParams = STRATEGY_PRESETS.neutral.params;

/** Research-only E295 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE295 = 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_no_rv_v1';

/** Research-only E298 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE298 = 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_no_quality_filter_v1';

/** Research-only E301 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE301 = 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_no_quality_filter_v1';

/** Research-only E302 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE302 = 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_rvlt50_v1';

/** Research-only E304 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE304 = 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_v1';

/** Research-only E307 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE307 = 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_v1';

/** Research-only E309 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE309 = 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc20lt0_v1';

/** Research-only E310 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE310 = 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_or_er20lt20_v1';

/** Research-only E313 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE313 = 'p3_e159_plus_e526_e310_plus_weak_sr01_vix17_20_adx25_30_v1';

/** Research-only E316 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE316 = 'p3_e159_plus_e526_e313_plus_weak_sr01_vix17_20_adx20_25_v1';

/** Research-only E317 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE317 = 'p3_e159_plus_e526_e313_plus_bull_sr01_vix17_20_adx20_25_v1';

/** Research-only E320 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE320 = 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1';

/** Research-only E323 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE323 = 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1';

/** Research-only E324 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE324 = 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1';

/** Research-only E327 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE327 = 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1';

/** Research-only E328 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE328 = 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1';

/** Research-only E330 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE330 = 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1';

/** Research-only E331 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE331 = 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1';

/** Research-only E333 alias; runtime-normalized to the E289 inheritance family. */
export type PCSRescueResearchComplementModeE333 = 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';

/** Research-only E336 alias; flat equivalent of the accepted E333 rule union. */
export type PCSRescueResearchComplementModeE336 = 'p3_e159_plus_e526_e333_flat_v1';

/** Research-only E337 alias; E336 with the redundant low-VIX SR01 branch removed. */
export type PCSRescueResearchComplementModeE337 = 'p3_e159_plus_e526_e336_compact_v1';

/** Research-only E338 alias; direct E159/E526 core plus flat E333 additions. */
export type PCSRescueResearchComplementModeE338 = 'p3_e159_plus_e526_e333_corecompact_v1';

/** Research-only E340 alias; E338 repaired with the two audited quality boundaries. */
export type PCSRescueResearchComplementModeE340 = 'p3_e159_plus_e526_e339_repaired_corecompact_v1';

/** Research-only E342 alias; E340 plus the three audited missing base-state blocks. */
export type PCSRescueResearchComplementModeE342 = 'p3_e159_plus_e526_e341_repaired_corecompact_v1';

/** Research-only R7.E0 alias; R7.E0 is the promoted, compact R6.E342 frontier. */
export type PCSRescueResearchComplementModeR7E0 = 'p3_r7_e0_v1';

/** Backward-compatible legacy alias; canonical lineage name is R7.E0. */
export type PCSRescueResearchComplementModeR7 = 'p3_r7_e342_v1';

/** Research-only E346 alias; R7 plus the BULL/SR01 low-VIX high-RV complement. */
export type PCSRescueResearchComplementModeE346 = 'p3_r7_plus_bull_sr01_vixlt17_adx20_30_rvge50_v1';

/** Research-only E348 alias; E346 with the audited ADX floor raised to 26. */
export type PCSRescueResearchComplementModeE348 = 'p3_r7_plus_bull_sr01_vixlt17_adx26_30_rvge50_v1';

/** Research-only E351 alias; R7.E348 plus the clean BULL/SR02 low-VIX low-ADX pocket. */
export type PCSRescueResearchComplementModeE351 = 'p3_r7_e348_plus_bull_sr02_vixlt13_adxlt20_v1';

/** Research-only E352 alias; E351 narrowed to ADX 13-20 to exclude audited low-ADX losses. */
export type PCSRescueResearchComplementModeE352 = 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_20_v1';

/** Research-only E355 alias; E352 plus the adjacent BULL/SR02 low-VIX ADX20-25 pocket. */
export type PCSRescueResearchComplementModeE355 = 'p3_r7_e352_plus_bull_sr02_vixlt13_adx20_25_v1';

/** Research-only E358 alias; merge E352 and E355 into one contiguous ADX13-25 predicate. */
export type PCSRescueResearchComplementModeE358 = 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_25_v1';

/** Research-only E359 alias; E358 plus the compact RANGE_BOUND/SR01 low-VIX low-ADX pocket. */
export type PCSRescueResearchComplementModeE359 = 'p3_r7_e358_plus_range_sr01_vixlt20_adxlt20_v1';

/** Research-only E361 alias; E359 repaired with the audited VIX<17 boundary. */
export type PCSRescueResearchComplementModeE361 = 'p3_r7_e358_plus_range_sr01_vixlt17_adxlt20_v1';

/** Research-only E362 alias; BULL/SR02 low-VIX ADX25-30 with negative ROC5 quality filter. */
export type PCSRescueResearchComplementModeE362 = 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1';

/** Research-only E367 alias; R7.E362 plus the compact BULL/SR01 low-VIX ADX<25 pocket. */
export type PCSRescueResearchComplementModeE367 = 'p3_r7_e362_plus_bull_sr01_vixlt17_adxlt25_v1';

/** Research-only E369 alias; E367 narrowed by the audited positive ROC20 quality gate. */
export type PCSRescueResearchComplementModeE369 = 'p3_r7_e362_plus_bull_sr01_vixlt17_adxlt25_roc20ge0_v1';

/** Research-only E372 alias; E369 widened to the adjacent VIX<20 boundary. */
export type PCSRescueResearchComplementModeE372 = 'p3_r7_e369_plus_bull_sr01_vixlt20_adxlt25_roc20ge0_v1';

/** Research-only E374 alias; E369's next narrow VIX boundary after the E372 loss audit. */
export type PCSRescueResearchComplementModeE374 = 'p3_r7_e369_plus_bull_sr01_vixlt17_5_adxlt25_roc20ge0_v1';

/** Research-only E378 alias; E374 plus the disjoint RISK_ON_WEAKENING/SR02 high-ADX pocket. */
export type PCSRescueResearchComplementModeE378 = 'p3_r7_e374_plus_rext_sr02_vixlt20_adxge30_v1';

/** Research-only E381 alias; E378 plus the disjoint RISK_ON_EXTENDED/SR02 low-VIX ADX pocket. */
export type PCSRescueResearchComplementModeE381 = 'p3_r7_e378_plus_rextx_sr02_vixlt17_adxlt30_v1';

/** Research-only E383 alias; E378 plus the disjoint RISK_ON_WEAKENING/SR01 low-VIX pocket. */
export type PCSRescueResearchComplementModeE383 = 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1';

/** Research-only E386 alias; E383 plus the residual BULL/SR02 VIX13-20 low-ADX band. */
export type PCSRescueResearchComplementModeE386 = 'p3_r7_e383_plus_bull_sr02_vix13_20_adxlt25_v1';

/** Research-only E388 alias; E383 plus the narrow RISK_ON_WEAKENING/SR02 low-ADX pocket. */
export type PCSRescueResearchComplementModeE388 = 'p3_r7_e383_plus_weak_sr02_vixlt20_adxlt15_v1';

/** Research-only E390 alias; E383 plus the disjoint high-VIX SIDEWAYS/SR01 high-ADX pocket. */
export type PCSRescueResearchComplementModeE390 = 'p3_r7_e383_plus_side_sr01_vixge25_adxge30_v1';

/** Research-only E391 alias; E383 plus the disjoint high-VIX SIDEWAYS/SR01 low-ADX pocket. */
export type PCSRescueResearchComplementModeE391 = 'p3_r7_e383_plus_side_sr01_vixge25_adxlt30_v1';

/** Research-only E394 alias; E383 plus the disjoint RISK_ON_EXTENDED/SR01 pocket. */
export type PCSRescueResearchComplementModeE394 = 'p3_r7_e383_plus_rext_sr01_vixlt20_adxlt30_v1';

/** Research-only E396 alias; E394 with the audited price-extension quality gate. */
export type PCSRescueResearchComplementModeE396 = 'p3_r7_e383_plus_rext_sr01_vixlt20_adxlt30_atrlt3_v1';

/** Research-only E399 alias; E396 plus the audited mid-ADX WEAK/SR02 pocket. */
export type PCSRescueResearchComplementModeE399 = 'p3_r7_e396_plus_weak_sr02_vixlt20_adx15_20_v1';

/** Research-only E402 alias; E399 plus the audited narrower RANGE_BOUND/SR01 pocket. */
export type PCSRescueResearchComplementModeE402 = 'p3_r7_e399_plus_range_sr01_vixlt19_adxlt20_v1';

/** Research-only E404 alias; E399 plus the audited higher-VIX BULL/SR02 residual. */
export type PCSRescueResearchComplementModeE404 = 'p3_r7_e399_plus_bull_sr02_vix16_20_adxlt25_v1';

/** Research-only E408 alias; E404 plus the disjoint RISK_ON_EXTENDED/SR02 high-ADX pocket. */
export type PCSRescueResearchComplementModeE408 = 'p3_r7_e404_plus_rext_sr02_vixlt17_adxge30_v1';

/** Research-only E410 alias; E404 plus the audited VIX floor for the REXT/SR02 high-ADX pocket. */
export type PCSRescueResearchComplementModeE410 = 'p3_r7_e404_plus_rext_sr02_vix13_17_adxge30_v1';

/** Research-only E412 alias; E404 plus the audited VIX 16-17 high-ADX pocket. */
export type PCSRescueResearchComplementModeE412 = 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1';

/** Research-only E416 alias; E412 plus the disjoint SR01 weakening pocket. */
export type PCSRescueResearchComplementModeE416 = 'p3_r7_e412_plus_weak_sr01_vixlt20_adxlt30_v1';

/** Research-only E418 alias; E412 plus the disjoint higher-VIX REXT/SR02 pocket. */
export type PCSRescueResearchComplementModeE418 = 'p3_r7_e412_plus_rext_sr02_vix17_20_adxge35_v1';

/** Research-only E421 alias; E412 plus the disjoint BULL/SR02 mid-VIX high-ADX pocket. */
export type PCSRescueResearchComplementModeE421 = 'p3_r7_e412_plus_bull_sr02_vix13_16_adx25_30_v1';

/** Research-only E456 alias; E412 plus the existing P3.E526 RANGE path. */
export type PCSRescueResearchComplementModeE456 = 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1';

/** Research-only E100 route probes; preserve E412 and add one macro residual family. */
export type PCSRescueResearchComplementModeE100 = 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_ext_ge15_adx_lt15_v1' | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range20_ge8_drawdown_le5_v1';

/** Research-only E103 residual macro probes. */
export type PCSRescueResearchComplementModeE103 = 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_v1' | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix14_18_range8_v1' | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_adx15_22_trend_lt50_v1';

/** Research-only E104: simplify RV high-volatility residual with a regime guard. */
export type PCSRescueResearchComplementModeE104 = 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1';

/** Research-only E106: broad macro residual frontier discovered from the E104 parent. */
export type PCSRescueResearchComplementModeE106 =
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_weakening2_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_adxge22_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_roc20lt0_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_rvlt50_v1';

/** Research-only E107: simplify the best E106 family with macro guards. */
export type PCSRescueResearchComplementModeE107 =
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge20_rvlt50_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_rvlt50_nonweakening_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_range8_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_er10_30_v1';

/** Research-only E108: merge adjacent high-VIX macro families under one regime guard. */
export type PCSRescueResearchComplementModeE108 =
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_rv_or_adx_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_non_sideways_rvlt50_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_non_sideways_adxge22_v1';

/** Research-only E111: top-level macro factorization and dimension ablation. */
export type PCSRescueResearchComplementModeE111 =
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_nonweakening_vix_or_rv67_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv67_or_vix18_nonweakening_v1'
  | 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_adxge22_v1';

/** Research-only E114: flat equivalent of E108; no boundary change, fewer recursive layers. */
export type PCSRescueResearchComplementModeE114 = 'p3_r7_e404_plus_r8_flat_highvix_union_v1';
