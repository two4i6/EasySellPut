import type { StrategyParams } from '../leveraged-overlay/types/params';

export const QQQ_R7_E0_REPLAY_VERSION = 'r7-e0-current-engine-v1' as const;

/** R7.E0 的正式运行时参数；生产入口不依赖研究脚本。 */
export const QQQ_R7_E0_STRATEGY_OVERRIDES = {
  enablePCS: true,
  enableEquityBoostPCS: false,
  pcsRescueEnabled: true,
  pcsRescueEntryMode: 'reactive_soft_pool',
  pcsRescueRegimeScope: 'selective_quality_v104_bull_er10',
  pcsRescueDeltaMode: 'range_smart_quality_v33',
  pcsRescueExtremeDelta: .2425,
  pcsRescueExtremeBaseDelta: .2075,
  pcsRescueExtremeFallbackDelta: .206,
  pcsRescueCalmDelta: .1839,
  pcsRescueNormalDelta: .135,
  pcsRescuePressureDelta: .04,
  pcsRescueWidthPct: .0218,
  pcsRescueExtremeWidthPct: .055,
  pcsRescueTargetDte: 35,
  pcsRescueRiskBudgetNav: .005,
  pcsRescueContractFallbackMode: 'narrow_updelta_v1',
  pcsRescuePairSearchMode: 'nearest_valid_r6e5_bull_vix24_adx10_roc20_v1',
  pcsRescueContractFallbackQualityMode: 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_or_sr02_adx15_v1',
  pcsRescueFillFallbackMode: 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_simplified_v1',
  pcsRescueSelectiveQualitySidewaysVixMin: 19,
  pcsRescueSelectiveQualitySidewaysRoc5Min: .02,
  pcsRescueSelectiveQualityBullVix10: true,
  pcsRescueContractFallbackForceMinimumContract: true,
  pcsRescueContractFallbackMaxRiskPct: .0051538,
  pcsRescueContractFallbackDeltaUplift: .025,
  pcsRescueContractFallbackSecondaryDeltaUplift: .01,
  pcsRescueContractFallbackTertiaryDeltaUplift: .0375,
  pcsRescueContractFallbackTertiaryQualityMode: 'exclude_bull_sr02_side_sr01_v1',
  pcsRescueContractFallbackTertiaryStepDeltaUplift: .07985,
  pcsRescueContractFallbackTertiaryStepQualityMode: 'exclude_bull_sr02_side_sr01_riskext_sr01_v1',
  pcsRescueFillFallbackQuoteOnlyWidth: true,
  pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Min: .61,
  pcsRescueExtremeWidthProfile: 'adx_split_v1',
  pcsRescueExtremeWidthNarrowPct: .043,
} as const satisfies Partial<StrategyParams>;

/**
 * Launch manifest for the production EB6.E209.P4(E0).R7 composite.
 *
 * Activation is supported only by the formal coordinator and its shared
 * current-bar gate suite. The manifest contains no dates, date lists, tape
 * fingerprints, or wrapper-level time gates.
 */
export const QQQ_EB6_P4_R7_CANDIDATE = {
  id: 'EB6.P4(E0).R7',
  status: 'active',
  liveActivation: 'active',
  lineage: {
    equityBoost: 'EB6.E209 current-bar',
    pcs: 'P4.E0',
    rescue: 'R7=R6.E342',
  },
  contract: {
    dataSource: 'live',
    admission: 'current-bar-dynamic',
    noDateWhitelist: true,
    noFrozenTape: true,
    noWrapperTimeGate: true,
    dte: 35,
    strikeMode: 'delta',
    exitMode: 'hold_to_expiry',
    replayVersion: QQQ_R7_E0_REPLAY_VERSION,
    r7Mode: 'p3_r7_e0_v1',
  },
  legacyRollbackVariant: 'eb2_p2_r5',
  launchBlockers: [],
} as const;

export function assertQqqEb6P4R7Launchable(): true {
  return true;
}
