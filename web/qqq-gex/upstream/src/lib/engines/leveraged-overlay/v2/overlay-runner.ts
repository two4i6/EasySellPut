// v2 Overlay 编排；旧路径仅作 Pipeline 兼容入口。
import type { PipelineContext, EngineResult, OverlayData, OverlayProposal } from '../types/pipeline';
import type { OverlayAction } from '../types/output';
import { createOverlayExposure, createOverlayIndicatorCatalog, createOverlayTraceData } from './bridge';
import { resolveOverlayDefaults, resolveOverlayMarketDefaults } from './defaults';
import { collectSupplementalOverlayProposals, coordinateBearCallSpread, coordinateOverlayProposals, finalizeOverlayCoordination, overlayTypeForAction, resolveCollarProxyExclusions, resolveCollarPutSpreadExclusion, resolveOverlayActionPriority, resolveOverlayUpstreamGate, resolvePutStrategyPriority, strictRecoveryCallSpreadSkipReasons } from './coordinator';
import { buildIronCondorProposal, evaluateIronCondorCandidate } from './strategies/iron-condor';
import { buildCallCreditSpreadProposal, computeCSSizeMultiplier, evaluateCallCreditSpreadCandidate, isCallCreditSpreadBalancedL1abV11Release, isCallCreditSpreadBelowResearchCreditFloor, isCallCreditSpreadCandidate9CoreFusionRelease, isCallCreditSpreadCandidate9MddBlocked, isCallCreditSpreadEventRiskScoped, isCallCreditSpreadExtensionBlocked, isCallCreditSpreadFastAcceleration, isCallCreditSpreadHighPressure, isCallCreditSpreadPreCrisis, isCallCreditSpreadResearchEntryBlocked, isCallCreditSpreadSlowTrend, isCallCreditSpreadTailEntryBlocked, isCallCreditSpreadValidatedSafeRelease, releaseCallCreditSpreadBreach, resolveCallCreditSpreadExtensionGate, resolveCallCreditSpreadRegimeContext, resolveCallCreditSpreadRegimeRiskMultiplier, resolveCallCreditSpreadShortDelta, resolveCallCreditSpreadSlopeShortDelta, resolveCallCreditSpreadTargetDte, resolveCallCreditSpreadVixRiskMultiplier, resolveCallCreditSpreadVxnRescueSizeMultiplier } from './strategies/call-credit-spread';
import { buildPutCreditSpreadProposal, evaluatePcsStreakCooldownBlocked, evaluatePutCreditSpreadPageDecision, evaluatePutCreditSpreadPageSignal, evaluatePutCreditSpreadSafety, evaluatePutCreditSpreadTiming, resolvePcsRescueExtremeWidth, resolvePcsRescueShortDelta } from './strategies/put-credit-spread';
import { isPcsContractProfileStressed, selectPcsContractProfile, usesPcsContractProfileFactor } from './strategies/pcs-contract-profile';
import { resolvePcsResearchSpreadWidth } from './strategies/pcs-research-width';
import { computeCallStrikeSurvivalAtAsOf, computeCallStrikeTailLossAtAsOf, computePcsCsPairExpectedPnlAtAsOf, computeStrikeSurvivalAtAsOf, computeStrikeTailLossAtAsOf } from '../../analysis/SellerStatsEngine';
import { candidateSigmasForPcsSurvivalSelection, selectPcsSurvivalCandidate, type PcsSigma, type PcsSurvivalSelectionCandidate } from './strategies/pcs-survival-selector';
import { candidateShortDeltasForCsPcsDynamicDistance, candidateShortDeltasForCsSurvivalSelection, candidateWidthsForCsRiskEfficiencySearch, candidateWidthsForCsSurvivalSelection, selectCsHighWinCoverageCandidate, selectCsSurvivalCandidate, type CsSurvivalSelectionCandidate } from './strategies/cs-survival-selector';
import type { CSSurvivalSelectionDistanceMode, CSSurvivalSelectionStateMode, CSSecondaryCoverageTier, CSSecondaryCoverageTriggerMode, PCSCandidate3ExtraReleaseMode, PCSResearchEntryFilter, PCSRescueContractFallbackQualityMode, PCSRescueContractFallbackTertiaryQualityMode, PCSRescueResearchComplementMode, PCSRescueResearchComplementModeE295, PCSRescueResearchComplementModeE298, PCSRescueResearchComplementModeE301, PCSRescueResearchComplementModeE302, PCSRescueResearchComplementModeE304, PCSRescueResearchComplementModeE307, PCSRescueResearchComplementModeE309, PCSRescueResearchComplementModeE310, PCSRescueResearchComplementModeE313, PCSRescueResearchComplementModeE316, PCSRescueResearchComplementModeE317, PCSRescueResearchComplementModeE320, PCSRescueResearchComplementModeE323, PCSRescueResearchComplementModeE324, PCSRescueResearchComplementModeE327, PCSRescueResearchComplementModeE328, PCSRescueResearchComplementModeE330, PCSRescueResearchComplementModeE331, PCSRescueResearchComplementModeE333, PCSRescueResearchComplementModeE336, PCSRescueResearchComplementModeE337, PCSRescueResearchComplementModeE338, PCSRescueResearchComplementModeE340, PCSRescueResearchComplementModeE342, PCSRescueResearchComplementModeR7E0, PCSRescueResearchComplementModeR7, PCSRescueResearchComplementModeE346, PCSRescueResearchComplementModeE348, PCSRescueResearchComplementModeE456, PCSRescueResearchComplementModeE100, PCSRescueResearchComplementModeE103, PCSRescueResearchComplementModeE104, PCSRescueResearchComplementModeE106, PCSRescueResearchComplementModeE107, PCSRescueResearchComplementModeE108, PCSRescueResearchComplementModeE111, PCSRescueResearchComplementModeE114, PCSRescueResearchRangeContractMode, PCSRescueDeltaMode, PCSRescueEntryMode, PCSRescueRegimeScope, PCSV11ReleaseMode, PCSV123ReleaseClass, PCSSurvivalPriceSelectionMode, PCSSurvivalSelectionDteMode, PCSSurvivalSelectionSigmaMode, PCSSurvivalSelectionWidthMode } from '../types/params';
import { explainReactivePcsTiming, isReactivePcsTiming, REACTIVE_PCS_ALLOWED_REGIMES } from '../../analysis/PcsReactiveRule';
import { evaluatePcsRiskEnvelope } from './strategies/pcs-risk-envelope';
import { allowCollarShortCall, buildCollarProposal, buildCollarProposalMetadata, evaluateCollarAlternativeToSell, evaluateCollarEligibility, evaluateCollarVixSpike, getOpenOverlayPositionFlags, hasCollarLargePosition, isCollarBackwardation } from './strategies/collar';
import { evaluateBearMarketOverlay } from './strategies/bear-call-spread';
import { getOverlayUniverse } from '../universe';
import { buildEquityBoostProposal as buildEquityBoostStrategyProposal, equityBoostRiskOnWeakeningSr01VolGateBlocked, evaluateEquityBoostTrigger, isEquityBoostBass221SeverityActive, isEquityBoostBass221VixReboundGateBlocked, resolveEquityBoostTargetDte, resolveEquityBoostWidthTargetPct } from './strategies/equity-boost-put-spread';
import {
  TQQQ_LARGE_POSITION_PCT,
  VIX_LOW_THRESHOLD,
  TQQQ_OVERBOUGHT_ROC,
  TQQQ_RECOVERY_ROC20,
  QQQ_RECOVERY_ROC5,
  COLLAR_TARGET_DTE,
  SPREAD_TARGET_DTE,
  IC_TARGET_DTE,
  IC_MODE_CONFIG,
  CS_MAX_TOTAL_RISK_NAV,
  OVERLAY_STRATEGY_TAGS,
  CS_SPREAD_WIDTH_PCT,
  COLLAR_DRAWDOWN_PERIOD,
  COLLAR_DRAWDOWN_PERIOD_BULL,
  COLLAR_DRAWDOWN_TRIGGER,
  COLLAR_DRAWDOWN_TRIGGER_BULL,
  COLLAR_VIX_SPIKE_PCT,
  COLLAR_VIX_SPIKE_FLOOR,
  SELL_ALTERNATIVE_EXCESS_THRESHOLD,
  PCS_PULLBACK_ROC5_CEILING,
  PCS_PULLBACK_VIX_FLOOR,
  EQUITY_BOOST_DEFAULT_TARGET_DTE,
  EQUITY_BOOST_DEFAULT_MAX_RISK_NAV,
} from '../constants';

export type PcsChopVixGateInput = {
  enabled: boolean;
  vix?: number;
  adx14?: number;
  range20dPct?: number;
  priceExtensionAtr?: number;
  roc20?: number;
};

/** 仅控制 contract fallback；不影响基础 PCS 触发、状态机或日期准入。 */
export function isPcsRescueContractFallbackQualityBlocked(input: { mode?: PCSRescueContractFallbackQualityMode; roc20?: number; tqqqRoc20?: number; roc5?: number; slowSubregime?: string; vix?: number; adx14?: number }): boolean {
  if (input.mode == null || input.mode === 'off') return false;
  const qqqRoc20Ok = input.roc20 != null && input.roc20 >= 0;
  const tqqqRoc20Ok = input.tqqqRoc20 != null && input.tqqqRoc20 >= 0;
  const roc5Ok = input.roc5 != null && input.roc5 >= 0;
  const vix22Ok = input.vix != null && input.vix >= 22;
  const sr02Roc5Ok = input.slowSubregime === 'SR02' && roc5Ok;
  const sr01Vix20Ok = input.slowSubregime === 'SR01' && input.vix != null && input.vix >= 20;
  const sr02VixLt19Ok = input.slowSubregime === 'SR02' && input.vix != null && input.vix < 19;
  const currentOk = input.slowSubregime === 'CURRENT';
  const sr02Roc20BelowFiveOk = input.slowSubregime === 'SR02' && input.roc20 != null && input.roc20 < -.05;
  const sr02Adx15Ok = input.slowSubregime === 'SR02' && input.adx14 != null && input.adx14 >= 15;
  const allowed = input.mode === 'roc20_nonnegative_v1'
    ? qqqRoc20Ok
    : input.mode === 'tqqq_roc20_nonnegative_v1'
      ? tqqqRoc20Ok
      : input.mode === 'either_roc20_nonnegative_v1'
        ? qqqRoc20Ok || tqqqRoc20Ok
        : input.mode === 'roc5_nonnegative_v1'
          ? roc5Ok
          : input.mode === 'roc20_or_sr02_roc5_nonnegative_v1'
            ? qqqRoc20Ok || sr02Roc5Ok
            : input.mode === 'roc20_or_sr02_roc5_or_vix22_v1'
              ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok
            : input.mode === 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_v1'
              ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok
              : input.mode === 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_v1'
                ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok || sr02VixLt19Ok
                : input.mode === 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_v1'
                  ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok || sr02VixLt19Ok || currentOk
                  : input.mode === 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_sr02_roc20_lt_m05_v1'
                    ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok || sr02VixLt19Ok || sr02Roc20BelowFiveOk
                    : input.mode === 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_v1'
                      ? qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok || sr02VixLt19Ok || currentOk || sr02Roc20BelowFiveOk
                      : qqqRoc20Ok || sr02Roc5Ok || vix22Ok || sr01Vix20Ok || sr02VixLt19Ok || currentOk || sr02Roc20BelowFiveOk || sr02Adx15Ok;
  return !allowed;
}

/** 仅控制第三顺位 contract fallback；不影响 E114 基础层或前两顺位。 */
export function isPcsRescueTertiaryFallbackQualityBlocked(input: { mode?: PCSRescueContractFallbackTertiaryQualityMode; regime?: string; slowSubregime?: string }): boolean {
  const baseBlocked = (input.regime === 'BULL' && input.slowSubregime === 'SR02')
    || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR01');
  if (input.mode === 'exclude_bull_sr02_side_sr01_v1') return baseBlocked;
  return input.mode === 'exclude_bull_sr02_side_sr01_riskext_sr01_v1'
    && (baseBlocked || (input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR01'));
}

type PCSRescueResearchComplementRuntimeMode = `p3_${string}` | `r9_${string}`;

/** 研究专用：P3.E471 互补状态；默认关闭且不改变主 PCS 信号。 */
export function isPcsRescueResearchComplementTiming(input: {
  mode?: PCSRescueResearchComplementMode | PCSRescueResearchComplementModeE295 | PCSRescueResearchComplementModeE298 | PCSRescueResearchComplementModeE301 | PCSRescueResearchComplementModeE302 | PCSRescueResearchComplementModeE304 | PCSRescueResearchComplementModeE307 | PCSRescueResearchComplementModeE309 | PCSRescueResearchComplementModeE310 | PCSRescueResearchComplementModeE313 | PCSRescueResearchComplementModeE316 | PCSRescueResearchComplementModeE317 | PCSRescueResearchComplementModeE320 | PCSRescueResearchComplementModeE323 | PCSRescueResearchComplementModeE324 | PCSRescueResearchComplementModeE327 | PCSRescueResearchComplementModeE328 | PCSRescueResearchComplementModeE330 | PCSRescueResearchComplementModeE331 | PCSRescueResearchComplementModeE333 | PCSRescueResearchComplementModeE336 | PCSRescueResearchComplementModeE337 | PCSRescueResearchComplementModeE338 | PCSRescueResearchComplementModeE340 | PCSRescueResearchComplementModeE342 | PCSRescueResearchComplementModeR7E0 | PCSRescueResearchComplementModeR7 | PCSRescueResearchComplementModeE346 | PCSRescueResearchComplementModeE348 | PCSRescueResearchComplementModeE456 | PCSRescueResearchComplementModeE100 | PCSRescueResearchComplementModeE103 | PCSRescueResearchComplementModeE104 | PCSRescueResearchComplementModeE106 | PCSRescueResearchComplementModeE107 | PCSRescueResearchComplementModeE108 | PCSRescueResearchComplementModeE111 | PCSRescueResearchComplementModeE114 | PCSRescueResearchComplementRuntimeMode;
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  adx14?: number;
  trendScore?: number;
  rv20?: number;
  priceExtensionAtr?: number;
  roc5?: number;
  roc20?: number;
  qqqEr20?: number;
  vixChange5d?: number;
  vixTermStructureSlope?: number;
  weakeningSignalCount?: number;
  rsi14?: number;
  range20dPct?: number;
  drawdownFromRecentHighPct?: number;
  preCrisisActive?: boolean;
}): boolean {
  // Retained research union: preserve the current E226 complement and add one
  // disjoint, dynamically evaluated REXT/SR02 macro pocket. Default behavior is unchanged.
  if (String(input.mode) === 'r9_e226_or_rext_sr02_vix13_17_adx20_25_rvlt50_v1') {
    const parentComplement = isPcsRescueResearchComplementTiming({
      ...input,
      mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any,
    });
    const rextSr02MacroPocket = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! < .5;
    return parentComplement || rextSr02MacroPocket;
  }
  if (String(input.mode) === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_or_bull_sr02_vix10_25_adx12_25_v1') {
    const parentComplement = isPcsRescueResearchComplementTiming({
      ...input,
      mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any,
    });
    const bullSr02MacroBand = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 10 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 12 && input.adx14! < 25;
    return parentComplement || bullSr02MacroBand;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_ext_ge15_adx_lt15_v1' || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range20_ge8_drawdown_le5_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_ext_ge15_adx_lt15_v1'
      ? Number.isFinite(input.adx14) && input.adx14! < 15 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5
      : Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.drawdownFromRecentHighPct) && input.drawdownFromRecentHighPct! <= .05;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_v1' || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix14_18_range8_v1' || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_adx15_22_trend_lt50_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_v1'
      ? Number.isFinite(input.rv20) && input.rv20! >= .67
      : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix14_18_range8_v1'
        ? Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 18 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
        : Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 22 && Number.isFinite(input.trendScore) && input.trendScore! < 50;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any });
    return base || (input.regime !== 'SIDEWAYS' && Number.isFinite(input.rv20) && input.rv20! >= .67);
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_adxge22_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_rvlt50_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_weakening2_v1'
      ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
      : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_adxge22_v1'
        ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22
        : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_roc20lt0_v1'
          ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.roc20) && input.roc20! < 0
          : Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.rv20) && input.rv20! < .5;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge20_rvlt50_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_rvlt50_nonweakening_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_range8_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_range8_er10_30_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge20_rvlt50_v1'
      ? Number.isFinite(input.vix) && input.vix! >= 20 && Number.isFinite(input.rv20) && input.rv20! < .5
      : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_rvlt50_nonweakening_v1'
        ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.rv20) && input.rv20! < .5 && input.regime !== 'RISK_ON_WEAKENING'
        : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vixge18_range8_v1'
          ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
          : Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_rv_or_adx_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_non_sideways_rvlt50_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_non_sideways_adxge22_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_rv_or_adx_v1'
      ? input.regime !== 'RISK_ON_WEAKENING' && Number.isFinite(input.vix) && input.vix! >= 18 && ((Number.isFinite(input.rv20) && input.rv20! < .5) || (Number.isFinite(input.adx14) && input.adx14! >= 22))
      : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_non_sideways_rvlt50_v1'
        ? input.regime !== 'SIDEWAYS' && Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.rv20) && input.rv20! < .5
        : input.regime !== 'SIDEWAYS' && Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_nonweakening_vix_or_rv67_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv67_or_vix18_nonweakening_v1'
    || input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_adxge22_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv_ge67_non_sideways_v1' as any });
    const macro = input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_vix18_nonweakening_v1'
      ? input.regime !== 'RISK_ON_WEAKENING' && Number.isFinite(input.vix) && input.vix! >= 18
      : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_nonweakening_vix_or_rv67_v1'
        ? input.regime !== 'RISK_ON_WEAKENING' && ((Number.isFinite(input.vix) && input.vix! >= 18) || (Number.isFinite(input.rv20) && input.rv20! >= .67))
        : input.mode === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_or_r8_rv67_or_vix18_nonweakening_v1'
          ? (Number.isFinite(input.rv20) && input.rv20! >= .67) || (input.regime !== 'RISK_ON_WEAKENING' && Number.isFinite(input.vix) && input.vix! >= 18)
          : input.regime !== 'RISK_ON_WEAKENING' && Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_v1') {
    const p3Base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any });
    const highRv = input.regime !== 'SIDEWAYS' && Number.isFinite(input.rv20) && input.rv20! >= .67;
    const highVix = input.regime !== 'RISK_ON_WEAKENING'
      && Number.isFinite(input.vix) && input.vix! >= 18
      && ((Number.isFinite(input.rv20) && input.rv20! < .5) || (Number.isFinite(input.adx14) && input.adx14! >= 22));
    return p3Base || highRv || highVix;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_trendlt50_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_vix18_adx22_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_extensionlt0_range8_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const macro = mode.endsWith('range8_weakening2_v1')
      ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
      : mode.endsWith('range8_roc20lt0_v1')
        ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.roc20) && input.roc20! < 0
        : mode.endsWith('trendlt50_range8_v1')
          ? Number.isFinite(input.trendScore) && input.trendScore! < 50 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
          : mode.endsWith('vix18_adx22_v1')
            ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22
            : mode.endsWith('range8_er10_30_v1')
              ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3
              : Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_non_range_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_vixlt18_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_drawdownle5_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_bull_only_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_precrisis_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_weakening2_erlt10_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const family = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
      && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2;
    const guard = mode.endsWith('non_range_v1')
      ? input.regime !== 'RANGE_BOUND'
      : mode.endsWith('vixlt18_v1')
        ? Number.isFinite(input.vix) && input.vix! < 18
        : mode.endsWith('drawdownle5_v1')
          ? Number.isFinite(input.drawdownFromRecentHighPct) && input.drawdownFromRecentHighPct! <= .05
          : mode.endsWith('bull_only_v1')
            ? input.regime === 'BULL'
            : mode.endsWith('precrisis_v1')
              ? input.preCrisisActive === true
              : Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    return base || (family && guard);
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixlt18_range8_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const macro = mode.endsWith('bull_range8_v1') || mode.endsWith('bull_vixlt18_range8_v1')
      ? input.regime === 'BULL' && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
      : mode.endsWith('bull_weakening2_v1')
        ? input.regime === 'BULL' && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
        : mode.endsWith('bull_range8_roc20lt0_v1')
          ? input.regime === 'BULL' && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.roc20) && input.roc20! < 0
          : input.regime === 'BULL' && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    const vixGuard = mode.endsWith('bull_vixlt18_range8_v1') ? Number.isFinite(input.vix) && input.vix! < 18 : true;
    return base || (macro && vixGuard);
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_erlt08_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_erlt12_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range8_erlt15_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range7_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range9_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_roc20lt0_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const bull = input.regime === 'BULL';
    const rangeMin = mode.endsWith('range7_erlt10_v1') ? .07 : mode.endsWith('range9_erlt10_v1') ? .09 : .08;
    const range = Number.isFinite(input.range20dPct) && input.range20dPct! >= rangeMin;
    const lowEr = mode.endsWith('erlt08_v1')
      ? Number.isFinite(input.qqqEr20) && input.qqqEr20! < .08
      : mode.endsWith('erlt12_v1')
        ? Number.isFinite(input.qqqEr20) && input.qqqEr20! < .12
        : mode.endsWith('erlt15_v1')
          ? Number.isFinite(input.qqqEr20) && input.qqqEr20! < .15
          : Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    const macro = mode.endsWith('bull_erlt10_v1')
      ? bull && lowEr
      : mode.endsWith('range8_erlt10_v1')
        ? range && lowEr
        : mode.endsWith('bull_roc20lt0_v1')
          ? bull && Number.isFinite(input.roc20) && input.roc20! < 0
          : bull && range && lowEr;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range5_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range6_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range75_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range7_erlt08_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range7_erlt12_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range6_erlt08_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range6_erlt12_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_range7_erlt15_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const rangeMin = mode.includes('range5_') ? .05 : mode.includes('range6_') ? .06 : mode.includes('range75_') ? .075 : .07;
    const erMax = mode.includes('erlt08') ? .08 : mode.includes('erlt12') ? .12 : mode.includes('erlt15') ? .15 : .1;
    const macro = input.regime === 'BULL'
      && Number.isFinite(input.range20dPct) && input.range20dPct! >= rangeMin
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! < erMax;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_erlt10_or_bull_range7_erlt12_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_erlt10_or_bull_range7_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const range8Er10 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    const bullRange7Er12 = input.regime === 'BULL' && Number.isFinite(input.range20dPct) && input.range20dPct! >= .07 && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .12;
    const bullRange7Er10 = input.regime === 'BULL' && Number.isFinite(input.range20dPct) && input.range20dPct! >= .07 && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    const range7Er10 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .07 && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .1;
    return base || (mode.endsWith('or_bull_range7_erlt12_v1') ? range8Er10 || bullRange7Er12 : mode.endsWith('or_bull_range7_erlt10_v1') ? range8Er10 || bullRange7Er10 : range7Er10);
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range_only_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_er_only_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range65_erlt10_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt08_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt12_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range75_erlt10_v1'
    || String(input.mode) === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range8_erlt10_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const rangeMin = mode.includes('range65_') ? .065 : mode.includes('range75_') ? .075 : mode.includes('range8_') ? .08 : .07;
    const range = Number.isFinite(input.range20dPct) && input.range20dPct! >= rangeMin;
    const erMax = mode.includes('erlt08') ? .08 : mode.includes('erlt12') ? .12 : .1;
    const er = Number.isFinite(input.qqqEr20) && input.qqqEr20! < erMax;
    const macro = mode.endsWith('range_only_v1') ? range : mode.endsWith('er_only_v1') ? er : range && er;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_range8_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_range8_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_trendlt50_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_vix18_adx22_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_range8_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_extensionlt0_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_rv67_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_v1' as any });
    const mode = String(input.mode);
    const range8 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const er10to30 = Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3;
    const residual = mode.endsWith('weakening2_v1')
      ? range8 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
      : mode.endsWith('roc20lt0_v1')
        ? range8 && Number.isFinite(input.roc20) && input.roc20! < 0
        : mode.endsWith('trendlt50_range8_v1')
          ? range8 && Number.isFinite(input.trendScore) && input.trendScore! < 50
          : mode.endsWith('vix18_adx22_v1')
            ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22
            : mode.endsWith('range8_er10_30_v1')
              ? range8 && er10to30
              : mode.endsWith('extensionlt0_range8_v1')
                ? range8 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0
                : Number.isFinite(input.rv20) && input.rv20! >= .67;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge18_range8_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixfall_range8_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixfall_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixfall_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixfall_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_v1' as any });
    const mode = String(input.mode);
    const bull = input.regime === 'BULL';
    const range8 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const er10to30 = Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3;
    const vixGe18 = Number.isFinite(input.vix) && input.vix! >= 18;
    const vixFall = Number.isFinite(input.vixChange5d) && input.vixChange5d! < 0;
    const macro = mode.includes('vixge18') ? vixGe18 : vixFall;
    const shape = mode.endsWith('range8_er10_30_v1') ? range8 && er10to30 : mode.endsWith('range8_v1') ? range8 : mode.endsWith('er10_30_v1') ? er10to30 : true;
    return base || (bull && macro && shape);
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge19_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_er10_25_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_er10_35_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_er15_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_er05_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge18_erge10_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const vixMin = mode.includes('vixge17') ? 17 : mode.includes('vixge19') ? 19 : 18;
    const erMin = mode.includes('er05_') ? .05 : mode.includes('er15_') ? .15 : mode.includes('erlt30') ? 0 : .1;
    const erMax = mode.includes('er10_25') ? .25 : mode.includes('er10_35') ? .35 : mode.includes('erlt30') ? .3 : mode.includes('erge10') ? 1 : .3;
    const macro = input.regime === 'BULL'
      && Number.isFinite(input.vix) && input.vix! >= vixMin
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! >= erMin && input.qqqEr20! < erMax;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge16_5_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge16_75_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_5_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_er10_35_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_er05_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_er15_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_erlt30_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const vixMin = mode.includes('vixge16_5') ? 16.5 : mode.includes('vixge16_75') ? 16.75 : mode.includes('vixge17_5') ? 17.5 : 17;
    const erMin = mode.includes('er05_') ? .05 : mode.includes('er15_') ? .15 : mode.includes('erlt30') ? 0 : .1;
    const erMax = mode.includes('er10_35') ? .35 : mode.includes('erlt30') ? .3 : .3;
    const macro = input.regime === 'BULL'
      && Number.isFinite(input.vix) && input.vix! >= vixMin
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! >= erMin && input.qqqEr20! < erMax;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_vixge17_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_erlt35_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_v1' as any });
    const mode = String(input.mode);
    const bull = mode.includes('bull') ? input.regime === 'BULL' : true;
    const vix = mode.includes('vixge17') ? Number.isFinite(input.vix) && input.vix! >= 17 : true;
    const erMax = mode.endsWith('erlt35_v1') ? .35 : .3;
    const er = mode.includes('erlt') ? Number.isFinite(input.qqqEr20) && input.qqqEr20! < erMax : true;
    return base || (bull && vix && er);
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_v1' as any });
    const macro = input.regime === 'BULL'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .3;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge16_5_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge16_75_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_bull_vixge17_5_erlt30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt35_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_v1' as any });
    const mode = String(input.mode);
    const vixMin = mode.includes('vixge16_5') ? 16.5 : mode.includes('vixge16_75') ? 16.75 : mode.includes('vixge17_5') ? 17.5 : 17;
    const erMax = mode.endsWith('erlt35_v1') ? .35 : .3;
    const macro = input.regime === 'BULL'
      && Number.isFinite(input.vix) && input.vix! >= vixMin
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! < erMax;
    return base || macro;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_range8_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_range8_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_vixfall_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_term1_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_range8_er10_30_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_range8_precrisis_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_term1_extlt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_vix18_rv67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_adxlt15_extge15_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_v1' as any });
    const mode = String(input.mode);
    const residual = mode.endsWith('range8_weakening2_v1')
      ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
      : mode.endsWith('range8_roc20lt0_v1')
        ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.roc20) && input.roc20! < 0
        : mode.endsWith('vixfall_range8_v1')
          ? Number.isFinite(input.vixChange5d) && input.vixChange5d! < 0 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
          : mode.endsWith('term1_weakening2_v1')
            ? Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! < 1 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
            : mode.endsWith('range8_er10_30_v1')
              ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3
              : mode.endsWith('range8_precrisis_v1')
                ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && input.preCrisisActive === true
                : mode.endsWith('term1_extlt0_v1')
                  ? Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! < 1 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0
                  : mode.endsWith('vix18_rv67_v1')
                    ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.rv20) && input.rv20! >= .67
                    : Number.isFinite(input.adx14) && input.adx14! < 15 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_trendlt50_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix18_adx22_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_range8_extlt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_v1' as any });
    const mode = String(input.mode);
    const residual = mode.endsWith('trendlt50_range8_v1')
      ? Number.isFinite(input.trendScore) && input.trendScore! < 50 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08
      : mode.endsWith('vix18_adx22_v1')
        ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22
        : mode.endsWith('range8_extlt0_v1')
          ? Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0
          : Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 18 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_range8_extlt0_nonrange_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_range8_extlt0_nosr01_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_norext_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_norext_nosr01_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix18_adx22_nonweakening_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_v1' as any });
    const mode = String(input.mode);
    const range8Extlt0 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const vix14to18Range8 = Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 18 && Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const residual = mode.endsWith('range8_extlt0_nonrange_v1')
      ? range8Extlt0 && input.regime !== 'RANGE_BOUND'
      : mode.endsWith('range8_extlt0_nosr01_v1')
        ? range8Extlt0 && input.slowSubregime !== 'SR01'
        : mode.endsWith('vix14_18_range8_norext_v1')
          ? vix14to18Range8 && input.regime !== 'RISK_ON_EXTENDED'
          : mode.endsWith('vix14_18_range8_norext_nosr01_v1')
            ? vix14to18Range8 && input.regime !== 'RISK_ON_EXTENDED' && input.slowSubregime !== 'SR01'
            : Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22 && input.regime !== 'RISK_ON_WEAKENING';
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix13_18_range8_bull_sr02_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_19_range8_bull_sr02_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range75_bull_sr02_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_v1' as any });
    const mode = String(input.mode);
    const vixMin = mode.includes('vix13_18') ? 13 : 14;
    const vixMax = mode.includes('vix14_19') ? 19 : 18;
    const rangeMin = mode.includes('range75_') ? .075 : .08;
    const residual = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= vixMin && input.vix! < vixMax
      && Number.isFinite(input.range20dPct) && input.range20dPct! >= rangeMin;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_range8_rsi_lt50_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rv50_67_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vix18_rvlt50_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_range_family_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_term_lt1_sr02_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vixchange_ge5_term_lt1_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any });
    const mode = String(input.mode);
    const range8 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const residual = mode.endsWith('range8_rsi_lt50_v1')
      ? range8 && Number.isFinite(input.rsi14) && input.rsi14! < 50
      : mode.endsWith('rv50_67_range8_v1')
        ? range8 && Number.isFinite(input.rv20) && input.rv20! >= .50 && input.rv20! < .67
        : mode.endsWith('vix18_rvlt50_v1')
          ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.rv20) && input.rv20! < .50
          : mode.endsWith('range_family_v1')
            ? input.regime === 'RANGE_BOUND'
            : mode.endsWith('term_lt1_sr02_v1')
              ? input.slowSubregime === 'SR02' && Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! < 1
              : Number.isFinite(input.vixChange5d) && input.vixChange5d! >= .05 && Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! < 1;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_range8_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_roc20lt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_riskon_rvge67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_extlt0_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vixfall_rvge67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_term_lt1_rv50_67_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any });
    const mode = String(input.mode);
    const rvHigh = Number.isFinite(input.rv20) && input.rv20! >= .67;
    const range8 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const residual = mode.endsWith('rvge67_v1')
      ? rvHigh
      : mode.endsWith('rvge67_range8_v1')
        ? rvHigh && range8
        : mode.endsWith('rvge67_roc20lt0_v1')
          ? rvHigh && Number.isFinite(input.roc20) && input.roc20! < 0
          : mode.endsWith('riskon_rvge67_v1')
            ? rvHigh && input.regime === 'RISK_ON'
            : mode.endsWith('rvge67_extlt0_v1')
              ? rvHigh && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0
              : mode.endsWith('vixfall_rvge67_v1')
                ? rvHigh && Number.isFinite(input.vixChange5d) && input.vixChange5d! < 0
                : Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! < 1
                  && Number.isFinite(input.rv20) && input.rv20! >= .50 && input.rv20! < .67;
    return base || residual;
  }
  if (input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_range8_sr01_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_range8_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vix18_adx22_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_weakening2_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_rvge67_rsi_lt50_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vix18_rvge67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_adxlt15_extge15_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_term1_2_rvge67_v1'
    || input.mode === 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_e25_vix14_18_range8_v1') {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any });
    const mode = String(input.mode);
    const range8 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const rvHigh = Number.isFinite(input.rv20) && input.rv20! >= .67;
    const residual = mode.endsWith('range8_sr01_v1')
      ? range8 && input.slowSubregime === 'SR01'
      : mode.endsWith('range8_weakening2_v1')
        ? range8 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
      : mode.endsWith('vix18_adx22_v1')
        ? Number.isFinite(input.vix) && input.vix! >= 18 && Number.isFinite(input.adx14) && input.adx14! >= 22
      : mode.endsWith('rvge67_weakening2_v1')
        ? rvHigh && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2
        : mode.endsWith('rvge67_rsi_lt50_v1')
          ? rvHigh && Number.isFinite(input.rsi14) && input.rsi14! < 50
          : mode.endsWith('vix18_rvge67_v1')
            ? Number.isFinite(input.vix) && input.vix! >= 18 && rvHigh
            : mode.endsWith('adxlt15_extge15_v1')
              ? Number.isFinite(input.adx14) && input.adx14! < 15 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5
              : mode.endsWith('term1_2_rvge67_v1')
                ? Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 1 && input.vixTermStructureSlope! < 2 && rvHigh
                : Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 18 && range8;
    return base || residual;
  }
  if (String(input.mode) === 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1') {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any })
      || isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_e159_plus_e526_range_path_atr_sr01_v1' as any });
  }
  if (String(input.mode) === 'r9_e65_plus_p3_e526_range_path_v1') {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any })
      || isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_e159_plus_e526_range_path_atr_sr01_v1' as any });
  }
  if (String(input.mode) === 'r9_e65_or_p3_e526_range_residual_v1') {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any })
      || isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_e159_plus_e526_range_path_atr_sr01_v1' as any });
  }
  const e295RelaxedBullSr02HighAdx = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_no_rv_v1';
  const e298RelaxedBullSr02HighAdx = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_no_quality_filter_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc20lt0_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_or_er20lt20_v1'
    || input.mode === 'p3_e159_plus_e526_e310_plus_weak_sr01_vix17_20_adx25_30_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_weak_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_bull_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e301RelaxedBullSr02MidAdx = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_no_quality_filter_v1';
  const e302BullSr02MidAdxLowRv = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_rvlt50_v1';
  const e304RextLowAdxQuality = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_v1';
  const e307RextLowAdxNoQuality = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_v1';
  const e309RextLowAdxSlowRoc = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc20lt0_v1';
  const e310RextLowAdxEr20 = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx15_20_rvlt50_roc5lt0_or_er20lt20_v1'
    || input.mode === 'p3_e159_plus_e526_e310_plus_weak_sr01_vix17_20_adx25_30_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_weak_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_bull_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e313WeakSr01HighVixAdxMode = input.mode === 'p3_e159_plus_e526_e310_plus_weak_sr01_vix17_20_adx25_30_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_weak_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e313_plus_bull_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e316WeakSr01MidVixAdxMode = input.mode === 'p3_e159_plus_e526_e313_plus_weak_sr01_vix17_20_adx20_25_v1';
  const e317BullSr01MidVixAdxMode = input.mode === 'p3_e159_plus_e526_e313_plus_bull_sr01_vix17_20_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e320WeakSr02HighAdxMode = input.mode === 'p3_e159_plus_e526_e317_plus_weak_sr02_vix13_17_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e323RextSr01LowAdxMode = input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_roc5lt0_v1';
  const e324RextSr01LowAdxNoRocMode = input.mode === 'p3_e159_plus_e526_e320_plus_rext_sr01_vix13_17_adxlt20_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e327RextSr01HighAdxMode = input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_rvlt50_roc5lt0_v1';
  const e328RextSr01HighAdxMode = input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_v1';
  const e330RextSr01HighVixFallMode = input.mode === 'p3_e159_plus_e526_e324_plus_rext_sr01_vix13_17_adx20_30_vixchange5dlt0_v1';
  const e331WeakSr02LowVixMode = input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr02_vixlt13_adxge30_rvlt50_roc5lt0_v1';
  const e333WeakSr01LowVixMode = input.mode === 'p3_e159_plus_e526_e324_plus_weak_sr01_vixlt17_adx25_30_v1';
  const e336FlatE333Mode = input.mode === 'p3_e159_plus_e526_e333_flat_v1' || input.mode === 'p3_e159_plus_e526_e336_compact_v1';
  const e338CoreCompactMode = input.mode === 'p3_e159_plus_e526_e333_corecompact_v1';
  const e340RepairedCoreCompactMode = input.mode === 'p3_e159_plus_e526_e339_repaired_corecompact_v1';
  const e342RepairedCoreCompactMode = input.mode === 'p3_e159_plus_e526_e341_repaired_corecompact_v1' || input.mode === 'p3_r7_e0_v1' || input.mode === 'p3_r7_e342_v1';
  const e346BullSr01HighRvMode = input.mode === 'p3_r7_plus_bull_sr01_vixlt17_adx20_30_rvge50_v1';
  const e348BullSr01HighRvMode = input.mode === 'p3_r7_plus_bull_sr01_vixlt17_adx26_30_rvge50_v1';
  const e351BullSr02LowVixMode = String(input.mode) === 'p3_r7_e348_plus_bull_sr02_vixlt13_adxlt20_v1';
  if (e351BullSr02LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_plus_bull_sr01_vixlt17_adx26_30_rvge50_v1' })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 13
        && Number.isFinite(input.adx14) && input.adx14! < 20);
  }
  const e352BullSr02LowVixMode = String(input.mode) === 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_20_v1';
  if (e352BullSr02LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_plus_bull_sr01_vixlt17_adx26_30_rvge50_v1' })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 13
        && Number.isFinite(input.adx14) && input.adx14! >= 13 && input.adx14! < 20);
  }
  const e355BullSr02LowVixMode = String(input.mode) === 'p3_r7_e352_plus_bull_sr02_vixlt13_adx20_25_v1';
  if (e355BullSr02LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_20_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 13
        && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25);
  }
  const e358BullSr02LowVixMergedMode = String(input.mode) === 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_25_v1';
  if (e358BullSr02LowVixMergedMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_plus_bull_sr01_vixlt17_adx26_30_rvge50_v1' })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 13
        && Number.isFinite(input.adx14) && input.adx14! >= 13 && input.adx14! < 25);
  }
  const e359RangeSr01LowVixMode = String(input.mode) === 'p3_r7_e358_plus_range_sr01_vixlt20_adxlt20_v1';
  if (e359RangeSr01LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_25_v1' as any })
      || (input.regime === 'RANGE_BOUND'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 20);
  }
  const e361RangeSr01LowerVixMode = String(input.mode) === 'p3_r7_e358_plus_range_sr01_vixlt17_adxlt20_v1';
  if (e361RangeSr01LowerVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_25_v1' as any })
      || (input.regime === 'RANGE_BOUND'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! < 20);
  }
  const e362BullSr02LowVixHighAdxMode = String(input.mode) === 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1';
  if (e362BullSr02LowVixHighAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e348_plus_bull_sr02_vixlt13_adx13_25_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 13
        && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
        && Number.isFinite(input.roc5) && input.roc5! < 0);
  }
  const e367BullSr01LowVixMode = String(input.mode) === 'p3_r7_e362_plus_bull_sr01_vixlt17_adxlt25_v1';
  if (e367BullSr01LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! < 25);
  }
  const e369BullSr01LowVixRoc20Mode = String(input.mode) === 'p3_r7_e362_plus_bull_sr01_vixlt17_adxlt25_roc20ge0_v1';
  if (e369BullSr01LowVixRoc20Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! < 25
        && Number.isFinite(input.roc20) && input.roc20! >= 0);
  }
  const e372BullSr01Vix20Roc20Mode = String(input.mode) === 'p3_r7_e369_plus_bull_sr01_vixlt20_adxlt25_roc20ge0_v1';
  if (e372BullSr01Vix20Roc20Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 25
        && Number.isFinite(input.roc20) && input.roc20! >= 0);
  }
  const e374BullSr01Vix175Roc20Mode = String(input.mode) === 'p3_r7_e369_plus_bull_sr01_vixlt17_5_adxlt25_roc20ge0_v1';
  if (e374BullSr01Vix175Roc20Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e358_plus_bull_sr02_vixlt13_adx25_30_roc5lt0_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17.5
        && Number.isFinite(input.adx14) && input.adx14! < 25
        && Number.isFinite(input.roc20) && input.roc20! >= 0);
  }
  const e378RextSr02HighAdxMode = String(input.mode) === 'p3_r7_e374_plus_rext_sr02_vixlt20_adxge30_v1';
  if (e378RextSr02HighAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e369_plus_bull_sr01_vixlt17_5_adxlt25_roc20ge0_v1' as any })
      || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! >= 30);
  }
  const e381RextxSr02LowVixMode = String(input.mode) === 'p3_r7_e378_plus_rextx_sr02_vixlt17_adxlt30_v1';
  if (e381RextxSr02LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e374_plus_rext_sr02_vixlt20_adxge30_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! < 30);
  }
  const e383WeakSr01LowVixMode = String(input.mode) === 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1';
  if (e383WeakSr01LowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e374_plus_rext_sr02_vixlt20_adxge30_v1' as any })
      || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 30);
  }
  const e386BullSr02Vix1320LowAdxMode = String(input.mode) === 'p3_r7_e383_plus_bull_sr02_vix13_20_adxlt25_v1';
  if (e386BullSr02Vix1320LowAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 25);
  }
  const e388WeakSr02LowAdxMode = String(input.mode) === 'p3_r7_e383_plus_weak_sr02_vixlt20_adxlt15_v1';
  if (e388WeakSr02LowAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 15);
  }
  const e390SideSr01HighVixHighAdxMode = String(input.mode) === 'p3_r7_e383_plus_side_sr01_vixge25_adxge30_v1';
  if (e390SideSr01HighVixHighAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'SIDEWAYS'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! >= 25
        && Number.isFinite(input.adx14) && input.adx14! >= 30);
  }
  const e391SideSr01HighVixLowAdxMode = String(input.mode) === 'p3_r7_e383_plus_side_sr01_vixge25_adxlt30_v1';
  if (e391SideSr01HighVixLowAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'SIDEWAYS'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! >= 25
        && Number.isFinite(input.adx14) && input.adx14! < 30);
  }
  const e394RextSr01Mode = String(input.mode) === 'p3_r7_e383_plus_rext_sr01_vixlt20_adxlt30_v1';
  if (e394RextSr01Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 30);
  }
  const e396RextSr01AtrGateMode = String(input.mode) === 'p3_r7_e383_plus_rext_sr01_vixlt20_adxlt30_atrlt3_v1';
  if (e396RextSr01AtrGateMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e378_plus_weak_sr01_vixlt20_adxlt30_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 30
        && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 3);
  }
  const e399WeakSr02MidAdxMode = String(input.mode) === 'p3_r7_e396_plus_weak_sr02_vixlt20_adx15_20_v1';
  if (e399WeakSr02MidAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e383_plus_rext_sr01_vixlt20_adxlt30_atrlt3_v1' as any })
      || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20);
  }
  const e402RangeSr01NarrowVixMode = String(input.mode) === 'p3_r7_e399_plus_range_sr01_vixlt19_adxlt20_v1';
  if (e402RangeSr01NarrowVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e396_plus_weak_sr02_vixlt20_adx15_20_v1' as any })
      || (input.regime === 'RANGE_BOUND'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 19
        && Number.isFinite(input.adx14) && input.adx14! < 20);
  }
  const e404BullSr02Vix1620Mode = String(input.mode) === 'p3_r7_e399_plus_bull_sr02_vix16_20_adxlt25_v1';
  if (e404BullSr02Vix1620Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e396_plus_weak_sr02_vixlt20_adx15_20_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 16 && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 25);
  }
  const e408RextSr02HighAdxMode = String(input.mode) === 'p3_r7_e404_plus_rext_sr02_vixlt17_adxge30_v1';
  if (e408RextSr02HighAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e399_plus_bull_sr02_vix16_20_adxlt25_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! >= 30);
  }
  const e410RextSr02HighAdxFloorMode = String(input.mode) === 'p3_r7_e404_plus_rext_sr02_vix13_17_adxge30_v1';
  if (e410RextSr02HighAdxFloorMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e399_plus_bull_sr02_vix16_20_adxlt25_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! >= 30);
  }
  const e412RextSr02HighAdxNarrowMode = String(input.mode) === 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1';
  if (e412RextSr02HighAdxNarrowMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e399_plus_bull_sr02_vix16_20_adxlt25_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 16 && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! >= 30);
  }
  const e416WeakSr01Mode = String(input.mode) === 'p3_r7_e412_plus_weak_sr01_vixlt20_adxlt30_v1';
  if (e416WeakSr01Mode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any })
      || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! < 30);
  }
  const e418RextSr02HigherVixMode = String(input.mode) === 'p3_r7_e412_plus_rext_sr02_vix17_20_adxge35_v1';
  if (e418RextSr02HigherVixMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any })
      || (input.regime === 'RISK_ON_EXTENDED'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
        && Number.isFinite(input.adx14) && input.adx14! >= 35);
  }
  const e421BullSr02MidVixHighAdxMode = String(input.mode) === 'p3_r7_e412_plus_bull_sr02_vix13_16_adx25_30_v1';
  if (e421BullSr02MidVixHighAdxMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 16
        && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30);
  }
  if (e346BullSr01HighRvMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e0_v1' })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30
        && Number.isFinite(input.rv20) && input.rv20! >= .50);
  }
  if (e348BullSr01HighRvMode) {
    return isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_r7_e0_v1' })
      || (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && Number.isFinite(input.vix) && input.vix! < 17
        && Number.isFinite(input.adx14) && input.adx14! >= 26 && input.adx14! < 30
        && Number.isFinite(input.rv20) && input.rv20! >= .50);
  }
  if (e338CoreCompactMode || e340RepairedCoreCompactMode || e342RepairedCoreCompactMode) {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const rangeSr01 = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const rangeSr01Mid = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const rangeSr01High = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sidewaysSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 12
      && Number.isFinite(input.rv20) && input.rv20! < .80;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullLowVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 10 && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const bullHighQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const rangePath = input.regime === 'RANGE_BOUND' && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const bullSr02HighVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullSr02Upper = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 12 && input.adx14! < 25;
    const bullSr02HighAdx = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const rextSr02Mid = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const rextSr02High = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && (!(e340RepairedCoreCompactMode || e342RepairedCoreCompactMode) || (Number.isFinite(input.roc5) && input.roc5! < 0));
    const bullSr01Mid = input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30
      && (!(e340RepairedCoreCompactMode || e342RepairedCoreCompactMode) || (Number.isFinite(input.rv20) && input.rv20! < .50));
    const bullSr01High = input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25;
    const bullSr01Upper = input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 30;
    const rextSr02Low = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (Number.isFinite(input.qqqEr20) && input.qqqEr20! < .20));
    const e333BullSr02HighAdx = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const e333WeakeningSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const e333BullSr01Mid = input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const e333WeakeningSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const e333RextSr01 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const e342SidewaysSr02 = e342RepairedCoreCompactMode
      && input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR02';
    const e342BullSr02Vix17_19 = e342RepairedCoreCompactMode
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20;
    const e342BullSr02Vix20_25LowAdx = e342RepairedCoreCompactMode
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 12;
    const e342RextSr02High = e342RepairedCoreCompactMode
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    return e159HighVix || e159LowVix || weakSr01 || rangeSr01 || rangeSr01Mid || rangeSr01High || sidewaysSr01 || weakSr02 || bullLowVix || bullMidQuality || bullHighQuality || rangePath || bullSr02HighVix || bullSr02Upper || bullSr02HighAdx || rextSr02Mid || rextSr02High || bullSr01Mid || bullSr01High || bullSr01Upper || rextSr02Low || e333BullSr02HighAdx || e333WeakeningSr01 || e333BullSr01Mid || e333WeakeningSr02 || e333RextSr01 || e342SidewaysSr02 || e342BullSr02Vix17_19 || e342BullSr02Vix20_25LowAdx || e342RextSr02High;
  }
  if (e336FlatE333Mode) {
    const base = isPcsRescueResearchComplementTiming({ ...input, mode: 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1' });
    const bullSr02HighAdx = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const rextSr02LowAdx = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (Number.isFinite(input.qqqEr20) && input.qqqEr20! < .20));
    const weakeningSr01HighVix = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const bullSr01MidVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const weakeningSr02HighAdx = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const rextSr01LowAdx = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    return base || bullSr02HighAdx || rextSr02LowAdx || weakeningSr01HighVix || bullSr01MidVix || weakeningSr02HighAdx || rextSr01LowAdx;
  }
  if (e295RelaxedBullSr02HighAdx || e298RelaxedBullSr02HighAdx || e301RelaxedBullSr02MidAdx || e302BullSr02MidAdxLowRv || e304RextLowAdxQuality || e307RextLowAdxNoQuality || e309RextLowAdxSlowRoc || e310RextLowAdxEr20 || e313WeakSr01HighVixAdxMode || e316WeakSr01MidVixAdxMode || e317BullSr01MidVixAdxMode || e320WeakSr02HighAdxMode || e323RextSr01LowAdxMode || e324RextSr01LowAdxNoRocMode || e327RextSr01HighAdxMode || e328RextSr01HighAdxMode || e330RextSr01HighVixFallMode || e331WeakSr02LowVixMode || e333WeakSr01LowVixMode) input.mode = 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1';
  if (input.mode === 'p3_bull_sr02_vix13_adx12_rv40_v1') {
    return input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! < 12
      && Number.isFinite(input.rv20) && input.rv20! < .40;
  }
  if (input.mode === 'p3_range_sr01_vix17_20_adx12_20_rv40_50_v1') {
    return input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 12 && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! >= .40 && input.rv20! < .50;
  }
  if (input.mode === 'p3_range_sr02_vix17_adx12_rv50_60_v1') {
    return input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! < 12
      && Number.isFinite(input.rv20) && input.rv20! >= .50 && input.rv20! < .60;
  }
  if (input.mode === 'p3_rext_sr02_vix17_20_adx20_25_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
  }
  if (input.mode === 'p3_rext_sr02_vixge17_adx20_25_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
  }
  if (input.mode === 'p3_rext_sr02_vix17_20_adxge20_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
  }
  if (input.mode === 'p3_rext_sr02_vixge17_adxge20_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
  }
  if (input.mode === 'p3_weak_sr01_adx20_25_v1') {
    return input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
  }
  if (input.mode === 'p3_e150c_plus_weak_sr01_adx20_25_v1') {
    const e150c = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    return e150c || weakSr01;
  }
  if (input.mode === 'p3_range_sr01_adxge20_v1') {
    return input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
  }
  if (input.mode === 'p3_e152_plus_range_sr01_adxge20_v1') {
    const e152 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const rangeSr01 = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    return e152 || weakSr01 || rangeSr01;
  }
  if (input.mode === 'p3_side_sr02_v1') {
    return input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02';
  }
  if (input.mode === 'p3_e152_plus_side_sr02_v1') {
    const e152 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    return e152 || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02');
  }
  if (input.mode === 'p3_rext_sr02_adxge20_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
  }
  if (input.mode === 'p3_e155_plus_rext_sr02_adxge20_v1') {
    const rextSr02 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    return rextSr02 || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02');
  }
  if (input.mode === 'p3_rext_sr02_vixlt17_adx20_25_rvge50_v1') {
    return input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
  }
  if (input.mode === 'p3_e155_plus_rext_sr02_vixlt17_adx20_25_rvge50_v1') {
    const e152 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const rextLowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    return e152 || rextLowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02');
  }
  if (input.mode === 'p3_e526_range_sr01_or_adxge12_v1') {
    return input.regime === 'RANGE_BOUND'
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_or_adxge12_v1') {
    const e159 = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return e159 || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_state_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_vixlt19_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && Number.isFinite(input.vix) && input.vix! < 19
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixlt19_or_adxge12_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && ((input.slowSubregime === 'SR01' && Number.isFinite(input.vix) && input.vix! < 19)
        || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixlt19_or_non_sr01_adxge12_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && ((input.slowSubregime === 'SR01' && Number.isFinite(input.vix) && input.vix! < 19)
        || (input.slowSubregime !== 'SR01' && Number.isFinite(input.adx14) && input.adx14! >= 12));
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixlt195_quality_or_non_sr01_adxge12_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Quality = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1);
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || sr01Quality || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixlt195_quality_merge_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Base = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19;
    const sr01Extension = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 19 && input.vix! < 19.5
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1);
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Base || sr01Extension || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixlt20_strict_quality_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01Extension = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 19.5 && input.vix! < 20
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
      && Number.isFinite(input.roc5) && input.roc5! < 0
      && (input.weakeningSignalCount ?? 0) >= 1;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01Extension || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vix20_25_adxlt195_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01Band = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01Band || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vixge25_adxlt20_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01Band = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01Band || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vix25_union_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vix25_union_bull_lowvix_atr_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const bullLowVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! < 12
      && Number.isFinite(input.rv20) && input.rv20! < .40
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || bullLowVix || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_sr01_vix25_union_range_sr02_vixge20_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const rangeSr02HighVix = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || rangeSr02HighVix || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_lowvix_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullLowVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! < 12
      && Number.isFinite(input.rv20) && input.rv20! < .40;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullLowVix || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_highadx_vix13_15_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullHighAdx = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullHighAdx || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_lowvix_quality_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullLowVixQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .40
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullLowVixQuality || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_17_adxge12_weak_sr02_adx20_25_bull_midquality_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullMidQuality || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_19_adxge12_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullMidQuality || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_side_sr01_vix13_19_adxge12_rvlt80_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 12
      && Number.isFinite(input.rv20) && input.rv20! < .80;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullMidQuality || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_bull_sr02_vix10_13_adx20_25_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 12
      && Number.isFinite(input.rv20) && input.rv20! < .80;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const bullLowVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 10 && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullMidQuality || bullLowVix || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx20_25_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx20_25_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_20_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_25_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
    || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
    || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
    || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const sr01Existing = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 19.5
      && (input.vix! < 19 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0
        && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1)));
    const sr01MidBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 19.5;
    const sr01HighBand = input.regime === 'RANGE_BOUND'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 25
      && Number.isFinite(input.adx14) && input.adx14! < 20;
    const sideSr01 = input.regime === 'SIDEWAYS'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 12
      && Number.isFinite(input.rv20) && input.rv20! < .80;
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullLowVix = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 10 && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullMidQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 15
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.roc20) && input.roc20! >= 0;
    const bullHighQuality = input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const bullMidVix = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx20_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_20_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullHighVix = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_20_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20;
    const bullHighVixTail = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullHighVixLower = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adx12_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 12 && input.adx14! < 15;
    const bullMidVixLower = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix17_19_adx15_25_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 19
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20;
    const bullHighVixLowAdx = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix20_25_adxlt12_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! < 12;
    const bullUpperQuality = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_roc5lt0_v1'
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const bullUpperNarrowQuality = (input.mode === 'p3_e159_plus_e526_bull_sr02_vix16_17_adx25_30_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 16 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const rextMidVixLowRv = (input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx20_25_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! < .50;
  const rextLowAdxQuality = (e304RextLowAdxQuality || e307RextLowAdxNoQuality || e309RextLowAdxSlowRoc)
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && (e307RextLowAdxNoQuality
        || (e304RextLowAdxQuality && Number.isFinite(input.roc5) && input.roc5! < 0)
        || (e309RextLowAdxSlowRoc && Number.isFinite(input.roc20) && input.roc20! < 0));
    const rextLowAdxEr20 = e310RextLowAdxEr20
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 15 && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (Number.isFinite(input.qqqEr20) && input.qqqEr20! < .20));
    const rextHighAdxLowRv = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_v1'
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const rextHighAdxLowRvQuality = (input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const rextHighAdxLowRvWeakening = input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_weakening_v1'
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && ((Number.isFinite(input.roc5) && input.roc5! < 0) || (input.weakeningSignalCount ?? 0) >= 1);
    const rextHighAdxLowRvEr20 = (input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_qqqer20lt45_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.qqqEr20) && input.qqqEr20! < .45;
    const bullSr01MidAdx = input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_v1'
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30;
    const bullSr01MidAdxLowRv = (input.mode === 'p3_e159_plus_e526_bull_sr01_vix13_17_adx20_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const rextHighAdxLowRvVixFall = (input.mode === 'p3_e159_plus_e526_rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.vixChange5d) && input.vixChange5d! < 0;
    const bullSr01HighVixAdx = (input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 30;
    const bullSr01HighVixAdx25 = (input.mode === 'p3_e159_plus_e526_bull_sr01_vix17_20_adxge25_v1'
      || input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1')
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25;
    const rextHighAdxLowRvVix14 = (input.mode === 'p3_e159_plus_e526_rext_sr02_vix14_17_adx25_30_rvlt50_v1'
      || input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      || input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1')
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 14 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const weakSr01HighVixAdx = input.mode === 'p3_e159_plus_e526_weak_sr01_vix17_20_adx25_30_v1'
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const e313WeakSr01HighVixAdx = e313WeakSr01HighVixAdxMode
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const e317BullSr01MidVixAdx = e317BullSr01MidVixAdxMode
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const e320WeakSr02HighAdx = e320WeakSr02HighAdxMode
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const e323RextSr01LowAdx = (e323RextSr01LowAdxMode || e324RextSr01LowAdxNoRocMode)
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! < 20
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && (e324RextSr01LowAdxNoRocMode || (Number.isFinite(input.roc5) && input.roc5! < 0));
    const e327RextSr01HighAdx = e327RextSr01HighAdxMode
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const e328RextSr01HighAdx = e328RextSr01HighAdxMode
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30;
    const e330RextSr01HighVixFall = e330RextSr01HighVixFallMode
      && input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 30
      && Number.isFinite(input.vixChange5d) && input.vixChange5d! < 0;
    const e331WeakSr02LowVix = e331WeakSr02LowVixMode
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 13
      && Number.isFinite(input.adx14) && input.adx14! >= 30
      && Number.isFinite(input.rv20) && input.rv20! < .50
      && Number.isFinite(input.roc5) && input.roc5! < 0;
    const e333WeakSr01LowVix = e333WeakSr01LowVixMode
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30;
    const e316WeakSr01MidVixAdx = e316WeakSr01MidVixAdxMode
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 17 && input.vix! < 20
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullSr01HighVix25 = input.mode === 'p3_e159_plus_e526_bull_sr01_vix20_25_adxge30_v1'
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.vix) && input.vix! >= 20 && input.vix! < 25
      && Number.isFinite(input.adx14) && input.adx14! >= 30;
    const bullSr02HighAdxQuality = input.mode === 'p3_e159_plus_e526_bull_sr02_vix13_17_adx25_30_rvlt50_roc5lt0_v1'
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 25 && input.adx14! < 30
      && (e295RelaxedBullSr02HighAdx || e298RelaxedBullSr02HighAdx || (Number.isFinite(input.rv20) && input.rv20! < .50))
      && (e298RelaxedBullSr02HighAdx || (Number.isFinite(input.roc5) && input.roc5! < 0));
    const bullSr02MidAdxNoFilter = e301RelaxedBullSr02MidAdx
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const bullSr02MidAdxLowRv = e302BullSr02MidAdxLowRv
      && input.regime === 'BULL'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 13 && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    const nonSr01Adx = input.regime === 'RANGE_BOUND'
      && input.slowSubregime !== 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 12;
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02')
      || sr01Existing || sr01MidBand || sr01HighBand || sideSr01 || weakSr02 || bullLowVix || bullMidQuality || bullHighQuality || bullMidVix || bullHighVix || bullHighVixTail || bullHighVixLower || bullMidVixLower || bullHighVixLowAdx || bullUpperQuality || bullUpperNarrowQuality || rextMidVixLowRv || rextLowAdxQuality || rextLowAdxEr20 || rextHighAdxLowRv || rextHighAdxLowRvQuality || rextHighAdxLowRvWeakening || rextHighAdxLowRvEr20 || rextHighAdxLowRvVixFall || rextHighAdxLowRvVix14 || bullSr01MidAdx || bullSr01MidAdxLowRv || bullSr01HighVixAdx || bullSr01HighVixAdx25 || weakSr01HighVixAdx || e313WeakSr01HighVixAdx || e316WeakSr01MidVixAdx || e317BullSr01MidVixAdx || e320WeakSr02HighAdx || e323RextSr01LowAdx || e327RextSr01HighAdx || e328RextSr01HighAdx || e330RextSr01HighVixFall || e331WeakSr02LowVix || e333WeakSr01LowVix || bullSr01HighVix25 || bullSr02HighAdxQuality || bullSr02MidAdxNoFilter || bullSr02MidAdxLowRv || nonSr01Adx;
  }
  if (input.mode === 'p3_e159_plus_e526_range_path_v1') {
    const rextHighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const rextLowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return rextHighVix || rextLowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_path_atr_sr01_v1') {
    const rextHighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const rextLowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND'
      && (input.slowSubregime !== 'SR01' || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 0))
      && (input.slowSubregime === 'SR01' || (Number.isFinite(input.adx14) && input.adx14! >= 12));
    return rextHighVix || rextLowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_vix_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND';
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  if (input.mode === 'p3_e159_plus_e526_range_path_or_vix_v1' || input.mode === 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1') {
    const e159HighVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! >= 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20;
    const e159LowVix = input.regime === 'RISK_ON_EXTENDED'
      && input.slowSubregime === 'SR02'
      && Number.isFinite(input.vix) && input.vix! < 17
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25
      && Number.isFinite(input.rv20) && input.rv20! >= .50;
    const weakSr01 = input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && Number.isFinite(input.adx14) && input.adx14! >= 20 && input.adx14! < 25;
    const range = input.regime === 'RANGE_BOUND';
    return e159HighVix || e159LowVix || weakSr01 || (input.regime === 'SIDEWAYS' && input.slowSubregime === 'SR02') || range;
  }
  return false;
}

/** v1.2.7b/P0 候选 A 的状态与基础质量门输入。 */
export type PcsCandidateAInput = PcsBass221GateInput;

/**
 * v1.2.7b/P0 候选 A：扩展状态池 + 条件化 BACKWARDATED_TERM rescue。
 * 这是纯 PCS 下游释放门；不包含 EB，也不改变普通 Reactive 信号。
 */
export function isPcsCandidateARelease(input: PcsCandidateAInput): boolean {
  if (!input.enabled) return false;
  const vix = input.vix ?? Number.NaN;
  const adx14 = input.adx14 ?? Number.NaN;
  if (!Number.isFinite(vix) || !Number.isFinite(adx14)) return false;
  const sideways = input.regime === 'SIDEWAYS'
    && (
      adx14 < 12
      || (vix > 30 && adx14 >= 20 && adx14 < 30)
      || (vix >= 28 && vix <= 30 && adx14 >= 12 && adx14 < 20)
    );
  const c1 = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && vix < 12
    && adx14 < 12;
  const c23 = (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING')
    && vix < 12
    && adx14 >= 30;
  const d = input.regime === 'RANGE_BOUND'
    && input.slowSubregime === 'SR01'
    && vix >= 12
    && vix < 14
    && adx14 >= 12
    && adx14 < 20;
  return sideways || c1 || c23 || d;
}

/** Candidate A 中验证过的 BULL/SR02 低 RV、ADX 确认扩展；与基础风险盾牌配套使用。 */
export function isPcsCandidateAExpansionRelease(input: PcsCandidateAInput): boolean {
  if (!input.enabled) return false;
  const adx14 = input.adx14 ?? Number.NaN;
  const realisedVol20d = input.tqqqRealisedVol20d ?? Number.NaN;
  return input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && Number.isFinite(realisedVol20d)
    && realisedVol20d < .67
    && Number.isFinite(adx14)
    && adx14 >= 20;
}

/** P0 基础风险盾牌：保留研究中验证过的三条 currentBlock 与 price/SMA200 质量门。 */
export function isPcsCandidateAEntryBlocked(input: PcsCandidateAInput): boolean {
  if (!input.enabled) return false;
  const vix = input.vix ?? Number.NaN;
  const adx14 = input.adx14 ?? Number.NaN;
  const priceExtensionAtr = input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY;
  const realisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const currentBlock = (
    input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && priceExtensionAtr >= 2
    && adx14 >= 29
  ) || (
    input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && vix >= 15
    && vix < 18
    && adx14 >= 40
  ) || (
    input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR01'
    && adx14 < 12
  );
  const priceSma200Block = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && adx14 < 18
    && realisedVol20d >= .60
    && priceVsSma200Pct >= .10;
  return currentBlock || priceSma200Block;
}

/** bass2.1.2：低 ADX、高区间、价格扩张且低 VIX 时阻断 PCS 新开。 */
export type PcsNativeP1R1Input = PcsCandidateAInput & {
  priorBullStressStreak?: number;
  lastSettledPnl?: number;
  scope?: 'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20';
  scopes?: Array<'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20'>;
};

export function isPcsNativeP1R1CorrectedW20Blocked(input: PcsNativeP1R1Input): boolean {
  return input.lastSettledPnl !== undefined
    && input.lastSettledPnl <= 0
    && input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR02'
    && (input.adx14 ?? Number.NaN) < 20;
}

/** Research-only formal P1 gate. The P1R1 symbol is retained as a compatibility alias; it evaluates today's state plus causal prior state, never dates. */
export function isPcsNativeP1R1EntryBlocked(input: PcsNativeP1R1Input): boolean {
  if (!input.enabled) return false;
  const activeScopes = new Set(
    input.scopes ?? (input.scope === undefined ? ['all'] : [input.scope]),
  );
  const hasScope = (scope: NonNullable<PcsNativeP1R1Input['scope']>) =>
    activeScopes.has('all') || activeScopes.has(scope);
  const vix = input.vix ?? Number.NaN;
  const adx14 = input.adx14 ?? Number.NaN;
  const rv20 = input.tqqqRealisedVol20d ?? Number.NaN;
  const extensionAtr = input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY;
  const aCompact = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && vix < 17
    && extensionAtr >= 2.5
    && adx14 < 21
    && (rv20 < .5 || rv20 >= .6);
  const pressureEnvelope = input.slowSubregime === 'SR02'
    && rv20 >= .6
    && adx14 < 20
    && ((input.regime === 'RISK_ON_EXTENDED' && vix >= 20)
      || (input.regime === 'BULL' && (input.priorBullStressStreak ?? 0) >= 2));
  const weakeningPressure = input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR01'
    && vix >= 20
    && adx14 < 15;
  const correctedW20 = isPcsNativeP1R1CorrectedW20Blocked(input);
  const p1Compact =
    (hasScope('aCompact') && aCompact)
    || (hasScope('pressureEnvelope') && pressureEnvelope)
    || (hasScope('weakeningPressure') && weakeningPressure);
  return p1Compact || (hasScope('correctedW20') && correctedW20);
}

/** Research-only residual-loss filter; no dates or outcome-derived admission. */
export function isPcsNativeP1ResidualFilterBlocked(input: PcsCandidateAInput): boolean {
  if (!input.enabled) return false;
  return input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && (input.adx14 ?? Number.POSITIVE_INFINITY) >= 25
    && (input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .45;
}

export function isPcsChopVixGateBlocked(input: PcsChopVixGateInput): boolean {
  return input.enabled
    && Number.isFinite(input.vix)
    && (input.vix as number) < 19
    && (input.adx14 ?? Number.POSITIVE_INFINITY) < 12
    && (input.range20dPct ?? 0) >= 0.075
    && (input.priceExtensionAtr ?? 0) >= 1.10
    && (input.roc20 ?? Number.NEGATIVE_INFINITY) > 0;
}

type PcsBass221GateInput = PcsChopVixGateInput & {
  regime?: string;
  slowSubregime?: string;
  tqqqRealisedVol20d?: number;
  drawdownFromRecentHighPct?: number;
  rsi14?: number;
  roc5?: number;
  priceVsSma200Pct?: number;
  weakeningSignalCount?: number;
  v11ReleaseMode?: PCSV11ReleaseMode;
};

/** 研究专用：过滤已验证的 BULL/SR01 价格过度延伸新开仓，默认不消费。 */
export function isPcsResearchEntryFilterBlocked(input: PcsBass221GateInput, filter: PCSResearchEntryFilter = 'off'): boolean {
  return filter === 'block_bull_sr01_extension2_v1'
    && input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && (input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY) >= 2;
}

/** bass2.2.1：精细化基础门 + SR01 过热筛选 + 2018 型 BULL 高波动过滤。 */
export function isPcsBass221GateBlocked(input: PcsBass221GateInput): boolean {
  if (!input.enabled) return false;
  const chopBlocked = isPcsChopVixGateBlocked({ ...input, enabled: true });
  const sr02Blocked = input.slowSubregime === 'SR02'
    && (input.tqqqRealisedVol20d ?? 0) >= .67
    && (input.drawdownFromRecentHighPct ?? 0) >= .01
    && (input.vix ?? Number.POSITIVE_INFINITY) < 19;
  const sr01Blocked = input.regime === 'RISK_ON_EXTENDED'
    && input.slowSubregime === 'SR01'
    && (input.rsi14 ?? 0) >= 68
    && (input.priceExtensionAtr ?? 0) >= 2.3
    && (input.vix ?? Number.POSITIVE_INFINITY) < 18;
  const bullHighVolBlocked = input.regime === 'BULL'
    && (input.tqqqRealisedVol20d ?? 0) >= .85
    && (input.roc20 ?? Number.POSITIVE_INFINITY) < 0
    && (input.vix ?? Number.POSITIVE_INFINITY) < 18;
  const postCrisisReentryBlocked = input.regime === 'BULL'
    && (input.vix ?? 0) >= 20
    && (input.drawdownFromRecentHighPct ?? 0) >= .04
    && (input.roc5 ?? 0) > 0;
  // 2.2.1 的安全增量：只放行回撤后的 SR01 短期修复，保留高 VIX 接刀保护。
  const sr01RecoveryAllowed = input.slowSubregime === 'SR01'
    && (input.drawdownFromRecentHighPct ?? 0) >= .04
    && (input.roc20 ?? Number.POSITIVE_INFINITY) < 0
    && (input.roc5 ?? 0) > 0
    && !postCrisisReentryBlocked;
  const bass221SpecificBlocked = sr02Blocked || sr01Blocked || bullHighVolBlocked || postCrisisReentryBlocked;
  return chopBlocked || (bass221SpecificBlocked && !sr01RecoveryAllowed);
}

/** V1.1：在 bass2.2.1 基础上，阻断 RISK_ON_WEAKENING 的深度慢性转弱段。 */
export function isPcsV11GateBlocked(input: PcsBass221GateInput): boolean {
  return input.enabled
    && input.regime === 'RISK_ON_WEAKENING'
    && (input.drawdownFromRecentHighPct ?? 0) >= .05
    && (input.roc20 ?? Number.POSITIVE_INFINITY) < 0;
}

function isPcsV11SelectiveRelease(input: PcsBass221GateInput): boolean {
  const adx14 = input.adx14 ?? Number.NEGATIVE_INFINITY;
  const sr02Adx20 = input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR02'
    && adx14 >= 20;
  if (input.v11ReleaseMode === 'sr02_adx20') return sr02Adx20;
  if (input.v11ReleaseMode === 'rv20_lt_067_or_sr02_adx20') {
    return (input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .67 || sr02Adx20;
  }
  return false;
}

function pcsBass232GateParts(input: PcsBass221GateInput) {
  const adx14 = input.adx14 ?? Number.NEGATIVE_INFINITY;
  const roc20 = input.roc20 ?? Number.POSITIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const drawdownFromRecentHighPct = input.drawdownFromRecentHighPct ?? Number.POSITIVE_INFINITY;
  const aLite = input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR01'
    && adx14 >= 30
    && roc20 < 0;
  const bLite = (input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED')
    && tqqqRealisedVol20d < .45
    && adx14 >= 40
    && roc20 <= .04;
  const topLite = input.regime === 'RISK_ON_EXTENDED'
    && priceVsSma200Pct >= .25
    && drawdownFromRecentHighPct < .005;
  const sr01TrendRiskMerged = input.slowSubregime === 'SR01'
    && adx14 >= 30
    && (
      aLite
      || (
        input.regime === 'BULL'
        && tqqqRealisedVol20d >= .65
        && (input.vix ?? Number.POSITIVE_INFINITY) < 19
        && adx14 < 34
        && (input.range20dPct ?? 0) >= .17
      )
    );
  return { aLite, bLite, topLite, sr01TrendRiskMerged };
}

/** bass2.3.2 候选2 PCS：在 v1.2.3 基线上只阻断三类已验证的低质量入场。 */
export function isPcsBass232Candidate2GateBlocked(input: PcsBass221GateInput): boolean {
  if (!input.enabled) return false;
  const { aLite, bLite, topLite } = pcsBass232GateParts(input);
  return aLite || bLite || topLite;
}

/** bass2.3.2 候选3 PCS：A-lite 与高 RV BULL/SR01 保护合并，行为保持候选2+G等价。 */
export function isPcsBass232Candidate3GateBlocked(input: PcsBass221GateInput): boolean {
  if (!input.enabled) return false;
  const { sr01TrendRiskMerged, bLite, topLite } = pcsBass232GateParts(input);
  return sr01TrendRiskMerged || bLite || topLite;
}

type EquityBoostCandidate6Input = {
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  adx14?: number;
  priceVsSma200Pct?: number;
  tqqqRealisedVol20d?: number;
  tqqqRoc20?: number;
  roc5?: number;
  drawdownFromRecentHighPct?: number;
  openCount?: number;
  realizedDrawdown?: number;
};

/** 候选6-MDD：把研究中候选6的静态核心过滤收敛成一个可复用的入口闸。 */
export function isEquityBoostCandidate6GateBlocked(input: EquityBoostCandidate6Input): boolean {
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
  const tqqqRoc20 = input.tqqqRoc20 ?? Number.POSITIVE_INFINITY;
  const drawdownFromRecentHighPct = input.drawdownFromRecentHighPct ?? Number.POSITIVE_INFINITY;
  const strictB = adx14 >= 45 && drawdownFromRecentHighPct <= .005;
  const micro = vix <= 14.5 && adx14 < 20 && priceVsSma200Pct >= .11;
  const targeted = (
    (input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR01' && priceVsSma200Pct >= .10 && adx14 < 20)
    || (input.regime === 'RANGE_BOUND' && input.slowSubregime === 'SR01' && vix <= 15.5 && priceVsSma200Pct >= .10 && adx14 < 20)
    || (input.regime === 'BULL' && input.slowSubregime === 'SR02' && vix <= 15.5 && priceVsSma200Pct >= .10 && adx14 < 10)
  );
  const base3RHighVix = vix >= 17 && priceVsSma200Pct >= .12 && adx14 < 20
    && (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING');
  const baseHighVix = input.regime === 'BULL'
    && (input.slowSubregime === 'SR01' || input.slowSubregime === 'SR02')
    && drawdownFromRecentHighPct <= .03
    && priceVsSma200Pct >= .115
    && vix >= 17
    && adx14 < 40;
  const lowAdxReversal = adx14 < 10 && tqqqRealisedVol20d < .30 && tqqqRoc20 < 0;
  const coreHighVix = baseHighVix && ((adx14 < 30 && !lowAdxReversal) || (adx14 < 40 && vix < 18));
  const rangeNearHigh = input.regime === 'RANGE_BOUND'
    && input.slowSubregime === 'SR01'
    && drawdownFromRecentHighPct <= .03
    && priceVsSma200Pct >= .09
    && vix <= 15.5
    && adx14 < 20;
  // 研究中的保守恢复池只放回明显已经修复的 targeted 信号；其余核心过滤保持阻断。
  const targetedRecovery = targeted && tqqqRealisedVol20d < .50 && vix >= 12 && tqqqRoc20 >= 0;
  return strictB || micro || base3RHighVix || coreHighVix || rangeNearHigh || (targeted && !targetedRecovery);
}

/** 候选6-MDD的分层风险预算；所有层取最小值，避免覆盖更严格的保护。 */
export function equityBoostCandidate6RiskMultiplier(input: EquityBoostCandidate6Input): number {
  let multiplier = 1;
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
  const tqqqRoc20 = input.tqqqRoc20 ?? Number.POSITIVE_INFINITY;
  const roc5 = input.roc5 ?? Number.NEGATIVE_INFINITY;

  if ((input.openCount ?? 0) >= 20) multiplier = Math.min(multiplier, .95);
  const a6 = input.regime === 'BULL' && input.slowSubregime === 'SR02'
    && priceVsSma200Pct >= .11 && vix <= 15 && tqqqRoc20 >= 0 && adx14 < 30;
  if (a6 && tqqqRealisedVol20d >= .44) multiplier = Math.min(multiplier, .50);
  else if (a6) multiplier = Math.min(multiplier, .90);
  const b3 = tqqqRoc20 <= -.07 && roc5 >= 0 && tqqqRealisedVol20d >= .50
    && priceVsSma200Pct <= .07 && adx14 >= 15 && adx14 <= 25;
  const rangeStress = input.regime === 'RANGE_BOUND' && vix >= 18 && adx14 < 12 && tqqqRoc20 < 0;
  if (b3 || rangeStress) multiplier = Math.min(multiplier, .50);
  const tailRuleW = input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02'
    && vix >= 16 && adx14 >= 30 && tqqqRoc20 < 0;
  const tailRuleE = input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR02'
    && vix >= 15 && vix < 17 && priceVsSma200Pct >= .11 && adx14 < 30 && tqqqRoc20 < .15;
  const tailRuleB = input.regime === 'BULL' && input.slowSubregime === 'SR02'
    && vix >= 15 && tqqqRealisedVol20d >= .60 && adx14 < 25 && priceVsSma200Pct < .11;
  if (tailRuleW || tailRuleE || tailRuleB) multiplier = Math.min(multiplier, .40);

  const r30Safe = vix < 14 && priceVsSma200Pct < .08 && adx14 < 30;
  if ((input.realizedDrawdown ?? 0) > 10_000 && input.regime === 'BULL' && (!r30Safe || tqqqRoc20 >= .12)) {
    multiplier = Math.min(multiplier, .50);
  }
  if ((input.realizedDrawdown ?? 0) > 9_000 && tqqqRealisedVol20d >= .50) {
    multiplier = Math.min(multiplier, .40);
  }
  return multiplier;
}

export function resolveEbMacroRiskVixBucketMultiplier(input: {
  active: boolean;
  vix: number;
  regime: string;
  slowSubregime: string | undefined;
  extendedSr02LowVixMultiplier?: number;
  lowMultiplier?: number;
  midMultiplier?: number;
  highMultiplier?: number;
}): number {
  if (!input.active) return 1;
  if (input.vix < 16 && input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR02'
    && typeof input.extendedSr02LowVixMultiplier === 'number' && Number.isFinite(input.extendedSr02LowVixMultiplier)) {
    return input.extendedSr02LowVixMultiplier;
  }
  return input.vix < 16 ? input.lowMultiplier ?? 1
    : input.vix < 22 ? input.midMultiplier ?? 1
      : input.highMultiplier ?? 1;
}

export function resolveEbBullNeutralSr02MacroMultiplier(input: {
  active: boolean;
  regime: string;
  trend: string;
  slowSubregime: string | undefined;
  vix: number;
  sharedMultiplier: number | undefined;
  lowVixMultiplier?: number;
}): number | undefined {
  if (input.active && input.regime === 'BULL' && input.trend === 'NEUTRAL' && input.slowSubregime === 'SR02'
    && input.vix < 16 && typeof input.lowVixMultiplier === 'number' && Number.isFinite(input.lowVixMultiplier)) {
    return input.lowVixMultiplier;
  }
  return input.sharedMultiplier;
}

export function resolveEbBullNeutralSr01MacroMultiplier(input: {
  active: boolean;
  regime: string;
  trend: string;
  slowSubregime: string | undefined;
  sharedMultiplier: number | undefined;
  donorMultiplier?: number;
}): number | undefined {
  if (input.active && input.regime === 'BULL' && input.trend === 'NEUTRAL' && input.slowSubregime === 'SR01'
    && typeof input.donorMultiplier === 'number' && Number.isFinite(input.donorMultiplier)) {
    return input.donorMultiplier;
  }
  return input.sharedMultiplier;
}

/**
 * V1.2 Balanced-Tail：在 V1.1 的保护之上，过滤已验证的 L1、冲击和弱化尾部状态。
 * 规则与历史研究口径保持一一对应；缺失因子按不命中处理，不猜测状态。
 */
export function isPcsV12GateBlocked(input: PcsBass221GateInput): boolean {
  if (!input.enabled) return false;

  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
  const roc20 = input.roc20 ?? Number.POSITIVE_INFINITY;
  const weakeningSignalCount = input.weakeningSignalCount ?? 0;
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const v11Released = isPcsV11SelectiveRelease(input);

  const l1 = (
    (adx14 < 12 && priceVsSma200Pct >= .10 && tqqqRealisedVol20d >= .50)
    || (adx14 < 15 && priceVsSma200Pct >= .18 && tqqqRealisedVol20d >= .50)
    || (input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR01' && priceVsSma200Pct >= .13 && vix < 19)
  );
  const shock = adx14 >= 30 && tqqqRealisedVol20d >= .45 && priceVsSma200Pct >= .18;
  const tightShock = input.slowSubregime === 'SR02'
    && shock
    && vix < 18
    && roc20 > 0
    && (input.priceExtensionAtr ?? 0) >= 1.2;
  const weak3 = roc20 < 0 && weakeningSignalCount >= 3 && tqqqRealisedVol20d >= .50;
  const balancedWeak = weak3 && (adx14 < 12 || (priceVsSma200Pct < .05 && roc20 <= -.01));
  const moderateWeak = weak3
    && input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR02'
    && adx14 >= 15
    && adx14 < 18
    && priceVsSma200Pct >= .10
    && roc20 > -.01;
  const bullWeak = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && adx14 >= 20
    && adx14 < 25
    && priceVsSma200Pct >= .05
    && priceVsSma200Pct < .10
    && (tqqqRealisedVol20d ?? 0) >= .50
    && roc20 <= -.02
    && weakeningSignalCount >= 2;

  return isPcsBass221GateBlocked(input)
    || (!v11Released && isPcsV11GateBlocked(input))
    || l1
    || tightShock
    || balancedWeak
    || moderateWeak
    || bullWeak;
}

export type PcsV121Simple5ReleaseInput = PcsBass221GateInput & {
  selectedNoTouchLower?: number | null;
  selectedSigma?: PcsSigma;
  b30ReleaseLower?: number;
  releaseClass?: PCSV123ReleaseClass;
};

/** V1.2.1 简化5族：仅释放 V1.2 已阻断状态中、选腿后仍满足稳健生存率条件的信号。 */
export function isPcsV121Simple5Release(input: PcsV121Simple5ReleaseInput): boolean {
  if (!input.enabled) return false;

  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
  const roc20 = input.roc20 ?? Number.POSITIVE_INFINITY;
  const weakeningSignalCount = input.weakeningSignalCount ?? 0;
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const selectedNoTouchLower = input.selectedNoTouchLower ?? Number.NEGATIVE_INFINITY;
  const selectedSigma = input.selectedSigma;
  const l1ab = (
    (adx14 < 12 && priceVsSma200Pct >= .10 && tqqqRealisedVol20d >= .50)
    || (adx14 < 15 && priceVsSma200Pct >= .18 && tqqqRealisedVol20d >= .50)
  );
  const l1c = input.regime === 'RISK_ON_EXTENDED'
    && input.slowSubregime === 'SR01'
    && priceVsSma200Pct >= .13
    && vix < 19;
  const weak3 = roc20 < 0 && weakeningSignalCount >= 3 && tqqqRealisedVol20d >= .50;
  const balancedWeak = weak3 && (adx14 < 12 || (priceVsSma200Pct < .05 && roc20 <= -.01));
  const bullWeak = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && adx14 >= 20
    && adx14 < 25
    && priceVsSma200Pct >= .05
    && priceVsSma200Pct < .10
    && tqqqRealisedVol20d >= .50
    && roc20 <= -.02
    && weakeningSignalCount >= 2;
  const shock = input.slowSubregime === 'SR02'
    && adx14 >= 30
    && tqqqRealisedVol20d >= .45
    && priceVsSma200Pct >= .18
    && vix < 18
    && roc20 > 0
    && (input.priceExtensionAtr ?? 0) >= 1.2;

  const highBull = l1ab
    && input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && priceVsSma200Pct >= .20
    && roc20 >= .07
    && weakeningSignalCount <= 0
    && selectedNoTouchLower >= .49
    && selectedSigma === 2.5;
  const l1cBroad = l1c
    && adx14 >= 25
    && tqqqRealisedVol20d < .40
    && priceVsSma200Pct >= .14
    && roc20 >= .05
    && selectedNoTouchLower >= .38
    && selectedSigma === 2.5;
  const weakLowTouch = (balancedWeak || bullWeak)
    && (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING')
    && input.slowSubregime === 'SR01'
    && priceVsSma200Pct >= .04
    && vix < 16.5
    && selectedNoTouchLower < .40;
  const weakHighLower = balancedWeak
    && input.regime === 'RISK_ON_WEAKENING'
    && input.slowSubregime === 'SR01'
    && adx14 >= 15
    && vix < 19
    && selectedNoTouchLower >= .45;
  const tightUnified = shock
    && input.regime === 'RISK_ON_EXTENDED'
    && selectedSigma === 2.5
    && selectedNoTouchLower >= .44
    && (selectedNoTouchLower >= .45 || (adx14 >= 40.5 && roc20 >= .10) || priceVsSma200Pct >= .20);
  return highBull || l1cBroad || weakLowTouch || weakHighLower || tightUnified;
}

/** 候选3研究扫描：只测试低 VIX/低 RV 的 BULL-SR02 恢复口袋，默认不消费。 */
export function isPcsCandidate3ExtraRelease(input: PcsBass221GateInput, mode: Exclude<PCSCandidate3ExtraReleaseMode, 'off'> = 'bull_sr02_lowvol_v1'): boolean {
  if (mode === 'r7_e434_plus_weak_sr01_v1') {
    return isPcsCandidate3ExtraRelease(input, 'bull_sr02_rv_adx')
      || isPcsCandidate3ExtraRelease(input, 'r7_weak_sr01_vixlt20_adxlt30');
  }
  if (mode === 'r7_weak_sr01_vixlt20_adxlt30') {
    return input.enabled
      && input.regime === 'RISK_ON_WEAKENING'
      && input.slowSubregime === 'SR01'
      && (input.vix ?? Number.POSITIVE_INFINITY) < 20
      && (input.adx14 ?? Number.POSITIVE_INFINITY) < 30;
  }
  const stateMatch = mode === 'sr02_rv_adx'
    ? input.slowSubregime === 'SR02'
    : mode === 'bull_rv_adx'
      ? input.regime === 'BULL'
      : input.regime === 'BULL' && input.slowSubregime === 'SR02';
  if (!input.enabled || !stateMatch) return false;
  const lowVix = (input.vix ?? Number.POSITIVE_INFINITY) < 18;
  const lowRv = (input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .67;
  const adxConfirmed = (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 20;
  const rvAdxThresholdMode = mode === 'bull_sr02_rv60_adx20'
    || mode === 'bull_sr02_rv65_adx20'
    || mode === 'bull_sr02_rv70_adx20'
    || mode === 'bull_sr02_rv67_adx15'
    || mode === 'bull_sr02_rv67_adx25'
    || mode === 'bull_sr02_rv67_adx30';
  if (rvAdxThresholdMode) {
    const rvMax = mode === 'bull_sr02_rv60_adx20' ? .60 : mode === 'bull_sr02_rv65_adx20' ? .65 : mode === 'bull_sr02_rv70_adx20' ? .70 : .67;
    const adxMin = mode === 'bull_sr02_rv67_adx15' ? 15 : mode === 'bull_sr02_rv67_adx25' ? 25 : mode === 'bull_sr02_rv67_adx30' ? 30 : 20;
    return (input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < rvMax
      && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= adxMin;
  }
  switch (mode) {
    case 'sr02_rv_adx': return lowRv && adxConfirmed;
    case 'bull_rv_adx': return lowRv && adxConfirmed;
    case 'bull_sr02_rv_adx': return lowRv && adxConfirmed;
    case 'bull_sr02_vix_adx': return lowVix && adxConfirmed;
    case 'bull_sr02_vix_rv': return lowVix && lowRv;
    case 'bull_sr02_adx': return adxConfirmed;
    case 'bull_sr02_vix': return lowVix;
    case 'bull_sr02_rv': return lowRv;
    case 'bull_sr02': return true;
    case 'bull_sr02_vol_or_adx': return (lowVix || lowRv) && adxConfirmed;
    case 'bull_sr02_lowvol_v1': return lowVix && lowRv && adxConfirmed;
  }
}

/** 候选3研究臂：只在高 Sigma、较高 no-touch 下限区间释放 V1.2.1，并由调用方施加 25% 风险预算。 */
export function isPcsCandidate3V121QuarterRelease(input: PcsV121Simple5ReleaseInput): boolean {
  const lower = input.selectedNoTouchLower ?? Number.NEGATIVE_INFINITY;
  return input.enabled && input.selectedSigma === 2.5 && lower >= .45 && lower < .49;
}

/** V1.2.2：在 V1.2.1 简化5族释放后，应用简化后的 A9+B30+C10 统一状态闸。 */
export function isPcsV122GateBlocked(input: PcsV121Simple5ReleaseInput): boolean {
  if (!input.enabled) return false;

  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY;
  const roc20 = input.roc20 ?? Number.POSITIVE_INFINITY;
  const weakeningSignalCount = input.weakeningSignalCount ?? 0;
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const drawdownFromRecentHighPct = input.drawdownFromRecentHighPct ?? 0;
  const selectedNoTouchLower = input.selectedNoTouchLower ?? Number.NEGATIVE_INFINITY;
  const selectedSigma = input.selectedSigma ?? Number.POSITIVE_INFINITY;
  const bullLike = input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED';

  const a9 = input.regime === 'BULL'
    && priceVsSma200Pct < .06
    && (adx14 < 20 || (weakeningSignalCount >= 1 && roc20 <= .005));
  const b7 = bullLike
    && tqqqRealisedVol20d < .45
    && priceVsSma200Pct >= .12
    && vix < 19
    && (
      (input.slowSubregime === 'SR02' && drawdownFromRecentHighPct >= .005)
      || (input.slowSubregime === 'SR01' && drawdownFromRecentHighPct >= .007 && adx14 < 25)
    );
  // B30 合并 B21 的公共风险条件，移除仅针对 SR01 的 lower<40% 分支。
  const b30 = b7 && (
    drawdownFromRecentHighPct >= .01
    || (selectedNoTouchLower < .38 && adx14 < 22)
  );
  const c10 = input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && selectedSigma <= 2
    && selectedNoTouchLower < .38
    && adx14 < 20
    && priceVsSma200Pct >= .10
    && priceVsSma200Pct < .14
    && vix < 15;

  return a9 || b30 || c10;
}

export type PcsV123GateParts = {
  a9: boolean;
  b30: boolean;
  c10: boolean;
  a9Released: boolean;
  b30Released: boolean;
  blockedBy: Array<'A9' | 'B30' | 'C10'>;
};

/** V1.2.3：返回 A9/B30/C10 的独立命中与释放状态，供回测归因消费。 */
export function evaluatePcsV123Gate(input: PcsV121Simple5ReleaseInput): PcsV123GateParts {
  if (!input.enabled) return { a9: false, b30: false, c10: false, a9Released: true, b30Released: true, blockedBy: [] };

  const adx14 = input.adx14 ?? Number.POSITIVE_INFINITY;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY;
  const roc20 = input.roc20 ?? Number.POSITIVE_INFINITY;
  const weakeningSignalCount = input.weakeningSignalCount ?? 0;
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const drawdownFromRecentHighPct = input.drawdownFromRecentHighPct ?? 0;
  const selectedNoTouchLower = input.selectedNoTouchLower ?? Number.NEGATIVE_INFINITY;
  const selectedSigma = input.selectedSigma ?? Number.POSITIVE_INFINITY;
  const b30ReleaseLower = input.b30ReleaseLower ?? .40;
  const releaseClass: PCSV123ReleaseClass = input.releaseClass ?? 'current';
  const bullLike = input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED';

  const a9 = input.regime === 'BULL'
    && priceVsSma200Pct < .06
    && (adx14 < 20 || (weakeningSignalCount >= 1 && roc20 <= .005));
  const b7 = bullLike
    && tqqqRealisedVol20d < .45
    && priceVsSma200Pct >= .12
    && vix < 19
    && (
      (input.slowSubregime === 'SR02' && drawdownFromRecentHighPct >= .005)
      || (input.slowSubregime === 'SR01' && drawdownFromRecentHighPct >= .007 && adx14 < 25)
    );
  const b30 = b7 && (
    drawdownFromRecentHighPct >= .01
    || (selectedNoTouchLower < .38 && adx14 < 22)
  );
  const c10 = input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && selectedSigma <= 2
    && selectedNoTouchLower < .38
    && adx14 < 20
    && priceVsSma200Pct >= .10
    && priceVsSma200Pct < .14
    && vix < 15;

  const a9ReleaseEnabled = releaseClass === 'current' || releaseClass === 'a9_only';
  const b30ReleaseEnabled = releaseClass === 'current' || releaseClass === 'b30_only';
  const c10ReleaseEnabled = releaseClass === 'c10_only';
  const a9Released = !a9 || (a9ReleaseEnabled && selectedNoTouchLower >= .45 && selectedSigma === 2.5 && priceVsSma200Pct >= .04);
  const b30Released = !b30 || (b30ReleaseEnabled && selectedNoTouchLower >= b30ReleaseLower);
  const blockedBy: Array<'A9' | 'B30' | 'C10'> = [];
  if (!a9Released) blockedBy.push('A9');
  if (!b30Released) blockedBy.push('B30');
  if (c10 && !c10ReleaseEnabled) blockedBy.push('C10');
  return { a9, b30, c10, a9Released, b30Released, blockedBy };
}

/**
 * Research-only native reconstruction of the Candidate-A A9 release.
 * The two pockets are deliberately narrow: low-VIX moderate ADX without
 * weakening, or positive-ROC continuation with high ADX and a 5-6% SMA200
 * extension. Production callers omit this parameter.
 */
export function isPcsNativeP0A9QualityRelease(
  input: PcsV121Simple5ReleaseInput,
): boolean {
  if (!input.enabled || input.regime !== 'BULL') return false;

  const vix = input.vix ?? Number.NaN;
  const adx14 = input.adx14 ?? Number.NaN;
  const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NaN;
  const weakeningSignalCount = input.weakeningSignalCount ?? 0;
  const roc20 = input.roc20 ?? Number.NaN;

  if (
    !Number.isFinite(vix) ||
    !Number.isFinite(adx14) ||
    !Number.isFinite(priceVsSma200Pct) ||
    !Number.isFinite(roc20)
  ) {
    return false;
  }

  if (priceVsSma200Pct >= 0.06 || vix >= 16) return false;

  const moderateAdxPocket =
    adx14 >= 12 && adx14 < 20 && weakeningSignalCount === 0;
  const continuationPocket =
    adx14 >= 20 &&
    priceVsSma200Pct >= 0.05 &&
    weakeningSignalCount >= 1 &&
    roc20 >= 0;

  return moderateAdxPocket || continuationPocket;
}

/** V1.2.3：在 V1.2.1 简化5族之后，按 2.50% 候选的 A9/B30 lower 条件释放并保留 C10。 */
export function isPcsV123GateBlocked(input: PcsV121Simple5ReleaseInput): boolean {
  return evaluatePcsV123Gate(input).blockedBy.length > 0;
}

/** bass2.2.1 EB：保留原 SR02 高波动闸，并加入研究验证通过的 SR01 慢速反转闸。 */
export function isEquityBoostBass221GateBlocked(input: PcsBass221GateInput): boolean {
  const sr02Blocked = input.regime === 'BULL'
    && input.slowSubregime === 'SR02'
    && (input.vix ?? 0) >= 16
    && (input.tqqqRealisedVol20d ?? 0) >= .60
    && (input.roc20 ?? Number.NEGATIVE_INFINITY) >= 0
    && (input.roc20 ?? Number.POSITIVE_INFINITY) < .16;
  const sr01Blocked = input.regime === 'BULL'
    && input.slowSubregime === 'SR01'
    && (input.tqqqRealisedVol20d ?? 0) >= .65
    && (input.drawdownFromRecentHighPct ?? 0) >= .01
    && (input.roc20 ?? Number.POSITIVE_INFINITY) <= .01;
  return sr02Blocked || sr01Blocked;
}

export function runOverlay(ctx: PipelineContext): EngineResult<OverlayData> {
  const { macro, optionChains, prices, account } = ctx.input;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const bearOverlay = evaluateBearMarketOverlay(ctx);
  const indicators = createOverlayIndicatorCatalog(ctx);
  const traceFactors = createOverlayTraceData(ctx, indicators);
  const params = resolveOverlayDefaults(ctx.input.strategyParams);
  let pcsGateDiagnostics: OverlayData['pcsGateDiagnostics'];

  let csBreachState = ctx.input.csBreachState;
  const pcsStreakState = ctx.input.pcsStreakState;
  const pcsStreakCooldownTradingDays = params.pcsStreakCooldownTradingDays ?? 0;
  const pcsStreakCooldownBlocked = evaluatePcsStreakCooldownBlocked(pcsStreakState, pcsStreakCooldownTradingDays, ctx.input.date);

  // If upstream is blocked, skip overlay — UNLESS collarMode forces protection
  const collarModeEarly = params.collarMode;
  const anyUpstreamBlock = Object.values(ctx.results).some(
    r => r?.status === 'BLOCK' || r?.status === 'ERROR'
    );
  const upstreamGate = resolveOverlayUpstreamGate({ hasUpstreamBlock: anyUpstreamBlock, collarMode: collarModeEarly, regime: ctx.results.regime?.data.regime });
  if (upstreamGate !== 'continue') {
    if (upstreamGate === 'crisis') {
      return finalizeOverlayCoordination({
        status: 'WARN',
        data: {
          action: bearOverlay.action,
          collar_triggered: false,
          call_spread_triggered: false,
          iron_condor_triggered: false,
          bear_call_spread_triggered: false,
          bearCallSpread: bearOverlay.bearCallSpread,
          bearFactors: bearOverlay.factors,
          ...traceFactors,
          csBreachState,
        },
        warnings: [...bearOverlay.warnings, '上游 CRISIS BLOCK，Overlay 禁止新开卖方期权结构'],
        blockers: [],
      });
    }
    return finalizeOverlayCoordination({
      status: 'PASS',
      data: { action: 'NONE', collar_triggered: false, call_spread_triggered: false, iron_condor_triggered: false, bear_call_spread_triggered: false, ...traceFactors, csBreachState },
      warnings: ['上游有 BLOCK，Overlay 跳过'],
      blockers: [],
    });
  }

  const universe = getOverlayUniverse(ctx.input.universeId);
  const proxySymbol = ctx.input.optionUnderlyingSymbol ?? universe.optionSymbol;
  // No option chains available
  if (!optionChains?.[proxySymbol]) {
    return finalizeOverlayCoordination({
      status: 'WARN',
      data: { action: 'NONE', collar_triggered: false, call_spread_triggered: false, iron_condor_triggered: false, bear_call_spread_triggered: false, ...traceFactors, csBreachState },
      warnings: [`${proxySymbol} 期权链缺失，无法评估 Overlay 策略`],
      blockers: [],
    });
  }

  const useVixForPageUnderlying = ctx.input.optionUnderlyingSymbol !== undefined && ctx.input.optionUnderlyingSymbol !== 'QQQ';
  // QQQ 独立 CS 回放沿用历史 VIX 主口径；VXN 只作为 V2.1.1 rescue 的附加条件，不能因为被加载就改写主波动率。
  const independentCallSpreadBacktest = ctx.input.strategyParams?.optionsBacktestPositionMode?.cs === 'independent';
  const useVxnAsPrimaryVol = !useVixForPageUnderlying && !independentCallSpreadBacktest && universe.primaryVolatility === 'VXN';
  const primaryVol = useVxnAsPrimaryVol ? (macro.vxn ?? macro.vix) : macro.vix;
  const primaryVol3m = useVxnAsPrimaryVol && Number.isFinite(macro.vxn) && Number.isFinite(macro.vix) && macro.vix! > 0 && Number.isFinite(macro.vix3m)
    ? macro.vxn! * (macro.vix3m! / macro.vix!)
    : macro.vix3m;
  const { vix, vix3m, regime } = resolveOverlayMarketDefaults({ vix: primaryVol, vix3m: primaryVol3m, regime: ctx.results.regime?.data.regime });
  const regimeData = ctx.results.regime?.data;
  // Actual position pct uses max(target, actual) so transition days are covered.
  const exposure = createOverlayExposure(ctx);
  const leveragedSymbol = exposure.leveragedSymbol;
  const nav = exposure.nav.value;
  const final_tqqq_pct = exposure.targetLeveragedPct.value;
  const actualLevPct = exposure.actualLeveragedPct.value;
  const effectiveLevPct = exposure.effectiveLeveragedPct.value;
  const { collarMode, enableCollar, enableCS, enableIC, csMode } = params;
  const extremeCallSpreadMode = enableCS && csMode === 'extreme' && collarMode !== 'overheat';

  const chain = optionChains[proxySymbol]!;
  const spot  = chain.spot;

  // ── Drawdown-from-high signal ─────────────────────────────────────────────
  // In BULL regime: use 5d window so normal ATH consolidation (~1-2% below recent peak)
  // doesn't trigger collar every day — only catch genuine short-term reversals
  // RISK_ON_EXTENDED is still a bull market (just overheated) — use short window to avoid false triggers
  const isBullLike = regime === 'BULL' || regime === 'RISK_ON_EXTENDED';
  const collarWindow = isBullLike ? COLLAR_DRAWDOWN_PERIOD_BULL : COLLAR_DRAWDOWN_PERIOD;
  const rollingHigh = indicators.require<number>(isBullLike ? 'qqq_close_high5' : 'qqq_close_high20').value;
  const drawdownPct = rollingHigh > spot ? (rollingHigh - spot) / rollingHigh : 0;
  const drawdownTrigger = isBullLike ? COLLAR_DRAWDOWN_TRIGGER_BULL : COLLAR_DRAWDOWN_TRIGGER;
  const highDrawdown = drawdownPct >= drawdownTrigger;

  // ── VIX single-day spike signal ───────────────────────────────────────────
  const { prevVix, pct: vixSpikePct, spiked: vixSpiked } = evaluateCollarVixSpike({ vix, prevVix: macro.prevVix, spikePct: COLLAR_VIX_SPIKE_PCT, spikeFloor: COLLAR_VIX_SPIKE_FLOOR });

  // ── Collar trigger ────────────────────────────────────────────────────────
  const leveragedShares = account.positions.find(p => p.symbol === leveragedSymbol)?.quantity ?? 0;
  const { hasOpenCollar, hasOpenCollarShortCall, hasOpenQQQCallSpread, hasOpenQQQPutSpread, hasOpenEquityBoost, openICCount } = getOpenOverlayPositionFlags({ leveragedSymbol, positions: ctx.input.account.positions, optionPositions: ctx.input.account.optionPositions ?? [] });

  const backwardation = isCollarBackwardation(vix, vix3m);
  const tqqq_threshold = params.maxTqqqWarnPct;
  // Use effectiveLevPct (max of target vs actual) so the collar opens during de-risking transitions
  const hasLargePosition = hasCollarLargePosition(effectiveLevPct, TQQQ_LARGE_POSITION_PCT);

  // ── Alternative-to-sell scenario (opt-in) ────────────────────────────────
  // When actual TQQQ weight exceeds target by > 3%, use collar to hedge the excess
  // instead of immediately selling (preserves upside optionality while limiting downside).
  // Only in bull-territory regimes — no point hedging during bear (just reduce).
  const allowCollarAsAlternativeToSell = params.allowCollarAsAlternativeToSell === true;
  const sellAlternativeScenario = evaluateCollarAlternativeToSell({
    enabled: enableCollar && allowCollarAsAlternativeToSell,
    hasOpenCollar,
    hasOpenCallSpread: hasOpenQQQCallSpread,
    leveragedShares,
    regime,
    actualLeveragedPct: actualLevPct,
    targetLeveragedPct: final_tqqq_pct,
    excessThreshold: SELL_ALTERNATIVE_EXCESS_THRESHOLD,
  });

  const collarRenewalInBear = params.collarRenewalInBear === true;
  const collarEligibilityEvaluation = evaluateCollarEligibility({
    enabled: enableCollar,
    sellAlternativeScenario,
    mode: collarMode,
    hasLargePosition,
    regime,
    highDrawdown,
    vixSpiked,
    backwardation,
    extremeCallSpreadMode,
    vix,
    hasOpenCollar,
    hasOpenCallSpread: hasOpenQQQCallSpread,
    effectiveLevPct,
    tqqqThreshold: tqqq_threshold,
    renewalEnabled: collarRenewalInBear,
    leveragedShares,
    qqqRv20: indicators.require<number>('qqq_rv20').value,
    ivGate: params.collarIvGate,
  });
  let collar_triggered = collarEligibilityEvaluation.eligible;

  // Bear renewal override: bypass the 30% position-size gate in BEAR/CRISIS so the
  // collar re-opens immediately after a deep-ITM exit or settlement, even when TQQQ
  // has been de-risked below the large-position threshold.
  if (collarEligibilityEvaluation.renewed) {
    warnings.push(`熊市续期：${regime} 机制下强制续开 Collar（跳过仓位阈值检查，leveragedShares=${leveragedShares}）`);
  }

  if (collarEligibilityEvaluation.ivRejected) {
    warnings.push(collarEligibilityEvaluation.ivRejectionReason!);
  }

  if (backwardation) {
    warnings.push(`VIX 期限倒挂：VIX=${vix.toFixed(1)}, VIX3M=${vix3m!.toFixed(1)}，建议 Collar 保护`);
  }
  if (highDrawdown) {
    warnings.push(`QQQ 距${collarWindow}日高点回撤 ${(drawdownPct * 100).toFixed(1)}%（高点 $${rollingHigh.toFixed(2)}），触发 Collar 保护`);
  }
  if (vixSpiked) {
    warnings.push(`VIX 单日跳升 ${(vixSpikePct * 100).toFixed(1)}%（${prevVix.toFixed(1)} → ${vix.toFixed(1)}），触发 Collar 保护`);
  }
  if (extremeCallSpreadMode && regime === 'RISK_ON_EXTENDED' && !collar_triggered && !hasOpenCollarShortCall && !hasOpenQQQCallSpread) {
    warnings.push('极热 Call Spread 模式：RISK_ON_EXTENDED 且趋势未破，优先使用 QQQ 定义风险 Call Spread，不开 TQQQ Collar');
  }
  if (collar_triggered && collarMode !== 'reactive') {
    warnings.push(`Collar [${collarMode}] 触发：TQQQ=${(final_tqqq_pct * 100).toFixed(1)}%, regime=${regime}`);
  }

  const collarLegMode = params.collarLegMode ?? 'both';
  const allowShortCall = collarLegMode === 'callOnly' || (collarLegMode !== 'putOnly' && allowCollarShortCall({ collarTriggered: collar_triggered, regime, highDrawdown, vixSpiked, backwardation, sellAlternativeScenario, mode: collarMode }));

  // ── Call Credit Spread trigger ────────────────────────────────────────────
  // Rule 4: CS fires in BULL/RISK_ON_EXTENDED; also in RANGE_BOUND when golden cross
  //         confirms bull context (price consolidating above SMA200 with SMA50 > SMA200).
  // Rule 6: block if existing Collar short call already caps upside (duplicate selling)
  // Rule 7: CRISIS/BEAR naturally excluded by requiring regime in bull-family
  const tqqqROC20 = indicators.require<number>('tqqq_roc20').value;
  const tqqqRealisedVol20d = ctx.results.volTarget?.data.tqqq_realized_vol_20d;
  const csPreCrisisActive = isCallCreditSpreadPreCrisis({
    regime,
    vix,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
    tqqqRoc20: tqqqROC20,
    vixMax: params.csPreCrisisVixMax,
    tqqqRealisedVol20dMin: params.csPreCrisisTqqqRv20Min,
    tqqqRoc20Max: params.csPreCrisisTqqqRoc20Max,
  });
  const slowSubregimeState = ctx.input.slowSubregimeFactors?.slow_subregime_state?.value;
  const csEventRiskScoped = isCallCreditSpreadEventRiskScoped({
    preCrisisActive: csPreCrisisActive,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    scope: params.csPreCrisisEventScope,
  });
  const qqqROC5ForCapRelease = indicators.require<number>('qqq_roc5').value;
  const capReleasePosterior = slowSubregimeState === 'SR01'
    ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr01?.value
    : slowSubregimeState === 'SR02'
      ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr02?.value
      : undefined;
  const capReleaseMinVix = params.csPreCrisisCapReleaseMinVix ?? 15;
  const capReleaseMinQqqRoc5 = params.csPreCrisisCapReleaseMinQqqRoc5 ?? 0;
  const capReleaseMinPosterior = params.csPreCrisisCapReleaseMinPosterior;
  const csPreCrisisCapQualityReleased = csEventRiskScoped
    && params.csPreCrisisCapReleaseMode === 'second_entry_quality_v1'
    && params.csPreCrisisMaxEntriesInWindow === 1
    && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) === 1
    && ((slowSubregimeState === 'SR01' && regime === 'RISK_ON_WEAKENING' && vix >= capReleaseMinVix
      && (capReleaseMinPosterior === undefined || (typeof capReleasePosterior === 'number' && capReleasePosterior >= capReleaseMinPosterior)))
      || (slowSubregimeState === 'SR02' && regime === 'BULL' && qqqROC5ForCapRelease >= capReleaseMinQqqRoc5));
  const csEventRiskBlocked = csEventRiskScoped
    && params.csPreCrisisMaxEntriesInWindow !== undefined
    && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) >= params.csPreCrisisMaxEntriesInWindow
    && !csPreCrisisCapQualityReleased;
  const csSecondaryEventRiskScoped = isCallCreditSpreadEventRiskScoped({
    preCrisisActive: csPreCrisisActive,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    scope: params.csSecondaryEventRiskScope ?? 'all',
  });
  const csSecondaryRiskBlocked = csSecondaryEventRiskScoped
    && params.csSecondaryMaxEntriesInWindow !== undefined
    && (ctx.input.csSecondaryEventRiskState?.entriesInWindow ?? 0) >= params.csSecondaryMaxEntriesInWindow;
  const csSecondaryCoverageRiskBlocked = params.csSecondaryCoverageMaxEntriesInWindow !== undefined
    && (ctx.input.csSecondaryEventRiskState?.coverageEntriesInWindow ?? 0) >= params.csSecondaryCoverageMaxEntriesInWindow;
  const qqqROC5 = indicators.require<number>('qqq_roc5').value;
  const qqqROC5Previous = prices.QQQ.length >= 7
    ? prices.QQQ.at(-2)!.close / prices.QQQ.at(-7)!.close - 1
    : undefined;
  const qqqROC5Slope = Number.isFinite(qqqROC5Previous) ? qqqROC5 - qqqROC5Previous! : undefined;
  // EB2 melt_up entry mode: fixed 60d window, regime-independent (unlike the collar's drawdownPct above).
  // Keep the legacy chain spot denominator; it can differ from the latest QQQ close.
const qqqROC20 = indicators.require<number>('qqq_roc20').value;
  const csSecondaryQqqRoc20Blocked = params.csSecondaryQqqRoc20Max !== undefined
    && Number.isFinite(params.csSecondaryQqqRoc20Max)
    && qqqROC20 > params.csSecondaryQqqRoc20Max;
  const csCoverageEnabled = params.csSecondaryCoverageProfile === 'high_win_coverage_v1';
  const csCoverageTriggerMode: CSSecondaryCoverageTriggerMode = params.csSecondaryCoverageTriggerMode ?? 'selector_failure';
  const qqqSma20SlopePct = regimeData?.sma20_slope_pct;
  const meltUpRollingHigh = indicators.require<number>('qqq_close_high60').value;
  const qqqDrawdownFromHigh = meltUpRollingHigh > spot ? (meltUpRollingHigh - spot) / meltUpRollingHigh : 0;
  const sma50Now  = regimeData?.sma50  ?? 0;
  const sma200Now = regimeData?.sma200 ?? 0;
  const { rangeBoundBullContext, regimeAllowed: csRegimeAllowed } = resolveCallCreditSpreadRegimeContext({ regime, mode: csMode, sma50: sma50Now, sma200: sma200Now });

  const csBreachGate = params.csBreachGate;
  if (csBreachState && csBreachState.active) {
    csBreachState = releaseCallCreditSpreadBreach(
      csBreachState,
      csBreachGate,
      spot,
      qqqROC5,
      tqqqROC20
    );
  }

  const collarBlocksOtherOverlays = params.collarInteractionMode !== 'non_blocking';
  const { pendingCollarHasShortCall, hasOnlyPutSpreadProtection, pendingPutSpreadProtection } = resolveCollarProxyExclusions({
    collarTriggered: collar_triggered,
    allowShortCall,
    hasOpenCollar,
    hasOpenCollarShortCall,
    blocksOtherOverlays: collarBlocksOtherOverlays,
  });
  const raw_call_spread_triggered = evaluateCallCreditSpreadCandidate({
    enabled: enableCS,
    pendingCollarHasShortCall,
    hasOpenCollarShortCall,
    hasOpenCallSpread: hasOpenQQQCallSpread,
    regimeAllowed: csRegimeAllowed,
    rangeBoundBullContext,
    mode: csMode,
    regime,
    vix,
    vixHighThreshold: params.csSpLikeVixHigh,
    backwardation: vix3m == null ? undefined : backwardation,
    requireTermStructure: params.csSpLikeDynamicRequireTermStructure,
    tqqqRoc20: tqqqROC20,
    qqqRoc5: qqqROC5,
    hasOnlyPutSpreadProtection,
    pendingPutSpreadProtection,
    vixLowThreshold: VIX_LOW_THRESHOLD,
    overboughtRoc20: TQQQ_OVERBOUGHT_ROC,
    recoveryRoc5: QQQ_RECOVERY_ROC5,
    recoveryRoc20: TQQQ_RECOVERY_ROC20,
    breachBlocked: !!csBreachState?.active && !!csBreachGate && csBreachGate !== 'off',
  });
  const csExtensionGate = resolveCallCreditSpreadExtensionGate({ mode: csMode, regime, vix, tqqqRoc20: tqqqROC20, explicitGate: params.csExtensionGate, baseGate: params.csSpLikeExtensionGate, dynamicCalmVix: params.csSpLikeDynamicCalmVix, dynamicCalmRoc20: params.csSpLikeDynamicCalmRoc20, dynamicCalmGate: params.csSpLikeDynamicCalmExtensionGate });
  const priceExtensionAtr = regimeData?.price_extension_atr;
  const csExtensionBlocked = isCallCreditSpreadExtensionBlocked(raw_call_spread_triggered, priceExtensionAtr, csExtensionGate);
  const csEntryBlocked = ctx.input.csEntryBlocked === true;
  // VE 环境闸：低 VIX 环境跳过新开 CS（默认 0 = off；已有持仓退出不受影响）
  // VE2 组合闸：回撤已展开（距 60 日高 ≥ exempt）时豁免 floor——只挡贴高点磨顶期的低 VIX 开仓
  const csVixOpenFloor = params.csVixOpenFloor ?? 0;
  const csVixPullbackExempt = params.csVixFloorPullbackExempt !== undefined
    && (regimeData?.drawdown_from_recent_high_pct ?? 0) >= params.csVixFloorPullbackExempt;
  const csVixBlocked = raw_call_spread_triggered && csVixOpenFloor > 0 && vix < csVixOpenFloor && !csVixPullbackExempt;
  const csTailEntryBlocked = raw_call_spread_triggered && isCallCreditSpreadTailEntryBlocked({
    gate: params.csTailEntryGate,
    vix,
    adx14: regimeData?.adx14,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    qqqRoc5: qqqROC5,
    qqqRoc20: qqqROC20,
    priceExtensionAtr: regimeData?.price_extension_atr,
  });
  const csVixChange5d = ctx.input.csResearchVixChange5d
    ?? (macro.vxnHistory && macro.vxnHistory.length >= 6 && (macro.vxnHistory.at(-6) ?? 0) > 0
      ? ((macro.vxnHistory.at(-1) ?? 0) - macro.vxnHistory.at(-6)!) / macro.vxnHistory.at(-6)!
      : macro.vix5dAgo !== undefined && macro.vix5dAgo > 0
        ? (vix - macro.vix5dAgo) / macro.vix5dAgo
        : undefined);
  const csVixChange5dPoints = ctx.input.csResearchVixChangePoints ?? (typeof macro.vix5dAgo === 'number'
    && Number.isFinite(macro.vix5dAgo)
    && Number.isFinite(vix)
    ? vix - macro.vix5dAgo
    : undefined);
  const csCandidate9MddBlocked = raw_call_spread_triggered && isCallCreditSpreadCandidate9MddBlocked({
    gate: params.csCandidate9MddEntryGate,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    vix,
    roc20: qqqROC20,
  });
  const csCandidate9CoreFusionReleased = csTailEntryBlocked
    && !csCandidate9MddBlocked
    && isCallCreditSpreadCandidate9CoreFusionRelease({
      mode: params.csCandidate9CoreFusionReleaseMode,
      priceExtensionAtr: regimeData?.price_extension_atr,
      vixChange5d: csVixChange5d,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    });
  const csTailEntryEffectiveBlocked = csTailEntryBlocked && !csCandidate9CoreFusionReleased;
  const slowSubregimePosterior = slowSubregimeState === 'SR01'
    ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr01?.value
    : slowSubregimeState === 'SR02'
      ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr02?.value
      : undefined;
  const csResearchEntryGateBlocked = raw_call_spread_triggered && isCallCreditSpreadResearchEntryBlocked({
    gate: params.csResearchEntryGate,
    posterior: typeof slowSubregimePosterior === 'number' ? slowSubregimePosterior : undefined,
    weakPersistenceDays: ctx.input.csResearchWeakPersistenceDays,
    vixChange5d: ctx.input.csResearchVixChange5d,
    regime,
    slowSubregime: slowSubregimeState,
  });
  const csResearchEntryPreCrisisQualityReleased = csResearchEntryGateBlocked
    && (params.csResearchEntryReleaseMode === 'balanced_l1ab_without_v11_precrisis_quality'
      || (params.csResearchEntryReleaseMode === 'balanced_l1ab_without_v11_precrisis_tail_intersection' && csTailEntryBlocked))
    && csPreCrisisCapQualityReleased;
  const csResearchEntryBullVixBandReleased = csResearchEntryGateBlocked
    && (params.csResearchEntryReleaseMode === 'bull_vix_19_band_quality'
      || params.csResearchEntryReleaseMode === 'bull_sr02_highposterior_vix19_band_quality'
      || params.csResearchEntryReleaseMode === 'bull_sr02_vix_band_quality'
      || params.csResearchEntryReleaseMode === 'sr02_vix_band_quality'
      || params.csResearchEntryReleaseMode === 'sr02_vix_price_quality'
      || params.csResearchEntryReleaseMode === 'bull_vix_falling_quality')
    && (params.csResearchEntryReleaseMode === 'sr02_vix_band_quality'
      || params.csResearchEntryReleaseMode === 'sr02_vix_price_quality'
      || regime === 'BULL')
    && (params.csResearchEntryReleaseMode !== 'sr02_vix_price_quality'
      || (regimeData?.price_vs_sma200_pct ?? Number.NEGATIVE_INFINITY) >= (params.csResearchEntryBullVixPriceSma200Min ?? .10))
    && vix >= (params.csResearchEntryBullVixBandMin ?? 19)
    && vix < (params.csResearchEntryBullVixBandMax ?? 19.5)
    && (params.csResearchEntryBullVixBandLowerSegmentPriceExtensionMin == null
      || params.csResearchEntryBullVixBandLowerSegmentVixMax == null
      || vix >= params.csResearchEntryBullVixBandLowerSegmentVixMax
      || (regimeData?.price_extension_atr ?? Number.NEGATIVE_INFINITY) >= params.csResearchEntryBullVixBandLowerSegmentPriceExtensionMin)
    && (params.csResearchEntryBullVixBandPriceExtensionMax == null
      || (regimeData?.price_extension_atr ?? Number.POSITIVE_INFINITY) <= params.csResearchEntryBullVixBandPriceExtensionMax)
    && (params.csResearchEntryBullVixBandVixChange5dMax == null
      || (typeof csVixChange5d === 'number' && csVixChange5d <= params.csResearchEntryBullVixBandVixChange5dMax))
    && (params.csResearchEntryBullVixBandRoc20Required ?? true ? tqqqROC20 > (params.csResearchEntryBullVixBandRoc20Min ?? 0) : true)
    && (params.csResearchEntryReleaseMode === 'bull_sr02_vix_band_quality' || params.csResearchEntryReleaseMode === 'sr02_vix_band_quality'
      ? slowSubregimeState === 'SR02'
      : params.csResearchEntryReleaseMode === 'bull_vix_falling_quality'
        ? (slowSubregimeState === 'SR02' || (typeof csVixChange5d === 'number' && csVixChange5d <= (params.csResearchEntryBullVixBandVixChange5dMax ?? 0)))
      : params.csResearchEntryReleaseMode !== 'bull_sr02_highposterior_vix19_band_quality'
        || (slowSubregimeState === 'SR02' && typeof slowSubregimePosterior === 'number' && slowSubregimePosterior >= (params.csResearchEntryBullVixBandPosteriorMin ?? .90)));
  const csResearchEntryReleased = csResearchEntryGateBlocked && (csResearchEntryPreCrisisQualityReleased || csResearchEntryBullVixBandReleased || isCallCreditSpreadBalancedL1abV11Release({
    mode: params.csResearchEntryReleaseMode === 'balanced_l1ab_without_v11_precrisis_quality'
      || params.csResearchEntryReleaseMode === 'balanced_l1ab_without_v11_precrisis_tail_intersection'
      || params.csResearchEntryReleaseMode === 'bull_vix_19_band_quality'
      || params.csResearchEntryReleaseMode === 'bull_sr02_highposterior_vix19_band_quality'
      || params.csResearchEntryReleaseMode === 'bull_sr02_vix_band_quality'
      || params.csResearchEntryReleaseMode === 'sr02_vix_band_quality'
      || params.csResearchEntryReleaseMode === 'sr02_vix_price_quality'
      || params.csResearchEntryReleaseMode === 'bull_vix_falling_quality'
      ? 'balanced_l1ab_without_v11'
      : params.csResearchEntryReleaseMode,
    regime,
    adx14: regimeData?.adx14,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    tqqqRealisedVol20d,
    roc20: qqqROC20,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  }));
  const csResearchEntryEffectiveBlocked = csResearchEntryGateBlocked && !csResearchEntryReleased;
  const csValidatedSafeReleased = raw_call_spread_triggered && !csEntryBlocked && !csVixBlocked && !csCandidate9MddBlocked
    && isCallCreditSpreadValidatedSafeRelease({
      mode: params.csValidatedSafeReleaseMode,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      slowSubregimePosterior: typeof slowSubregimePosterior === 'number' ? slowSubregimePosterior : undefined,
      vix,
      adx14: regimeData?.adx14,
      tqqqRealisedVol20d,
      qqqRoc5: qqqROC5,
      qqqRoc20: qqqROC20,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      priceExtensionAtr: regimeData?.price_extension_atr,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      weakPersistenceDays: ctx.input.csResearchWeakPersistenceDays,
      vixChange5d: csVixChange5d,
      vixChange5dPoints: csVixChange5dPoints,
      vixPointThreshold: params.csValidatedSafeVixPointThreshold,
      tailBlocked: csTailEntryEffectiveBlocked,
      researchBlocked: csResearchEntryEffectiveBlocked,
      extensionBlocked: csExtensionBlocked,
      mddBlocked: csCandidate9MddBlocked,
    });
  const csTailEntryFinalBlocked = csTailEntryEffectiveBlocked && !csValidatedSafeReleased;
  const csResearchEntryFinalBlocked = csResearchEntryEffectiveBlocked && !csValidatedSafeReleased;
  const csExtensionFinalBlocked = csExtensionBlocked && !csValidatedSafeReleased;
  const call_spread_triggered = raw_call_spread_triggered && !csEntryBlocked && !csExtensionFinalBlocked && !csVixBlocked && !csCandidate9MddBlocked && !csTailEntryFinalBlocked && !csEventRiskBlocked && !csResearchEntryFinalBlocked;
  // 旧独立副层只补主层预危机 cap1 的阻断日；保留兼容，不作为新方案主体。
  const call_spread_secondary_triggered = !csCoverageEnabled && params.csSecondaryEnabled === true
    && raw_call_spread_triggered
    && csPreCrisisActive
    && csSecondaryEventRiskScoped
    && csEventRiskBlocked
    && !csSecondaryCoverageRiskBlocked
    && !csSecondaryRiskBlocked
    && !csSecondaryQqqRoc20Blocked
    && !csEntryBlocked
    && !csExtensionBlocked
    && !csVixBlocked
    && !csCandidate9MddBlocked
    && !csTailEntryEffectiveBlocked
    && !csResearchEntryEffectiveBlocked
    && regime !== 'BEAR'
    && regime !== 'CRISIS';
  // 新覆盖层的预危机档直接接管 cap1 阻断日；普通档在主层选约失败后由 buildCallSpreadProposal 懒触发，
  // 这样主层成功时永远优先，且不把主层 signal 误标成副层开仓。
  const call_spread_coverage_pre_crisis_triggered = csCoverageEnabled
    && raw_call_spread_triggered
    && csPreCrisisActive
    && csEventRiskScoped
    && csEventRiskBlocked
    && !csSecondaryCoverageRiskBlocked
    && !csEntryBlocked
    && !csExtensionBlocked
    && !csVixBlocked
    && !csCandidate9MddBlocked
    && !csTailEntryEffectiveBlocked
    && !csResearchEntryEffectiveBlocked
    && regime !== 'BEAR'
    && regime !== 'CRISIS';
  const calmVixMacroReleased = csCoverageTriggerMode === 'tail_or_research_or_calm_vix_v1'
    && vix < 18;
  const calmTermMacroReleased = csCoverageTriggerMode === 'tail_or_research_or_extension_calm_term_v1'
    && vix < 20
    && Number.isFinite(vix3m)
    && vix3m! - vix >= 1;
  const quietVixAdxMacroReleased = csCoverageTriggerMode === 'tail_or_research_or_extension_quiet_vix_adx_v1'
    && (vix < 18 || (vix < 20
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < (params.csSecondaryCoverageQuietAdxMax ?? 20)));
  const macroCalmVixAllReleased = csCoverageTriggerMode === 'macro_calm_vix_all_v1'
    && vix < (params.csSecondaryCoverageMacroVixMax ?? 18);
  const coverageCanConsumeExtensionBlock = csCoverageTriggerMode === 'tail_or_research_or_extension_blocked'
    || csCoverageTriggerMode === 'tail_or_research_or_extension_quality_v1'
    || csCoverageTriggerMode === 'tail_or_research_or_extension_low_vix_v1'
    || csCoverageTriggerMode === 'tail_or_research_or_calm_vix_v1'
    || csCoverageTriggerMode === 'tail_or_research_or_extension_calm_term_v1'
    || csCoverageTriggerMode === 'tail_or_research_or_extension_quiet_vix_adx_v1'
    || macroCalmVixAllReleased;
  const coverageExtensionQualityReleased = csCoverageTriggerMode === 'tail_or_research_or_extension_blocked'
    || (csCoverageTriggerMode === 'tail_or_research_or_extension_quality_v1'
      || csCoverageTriggerMode === 'tail_or_research_or_extension_low_vix_v1')
      && vix < 18
    || calmVixMacroReleased
    || calmTermMacroReleased
    || quietVixAdxMacroReleased
    || macroCalmVixAllReleased;
  const call_spread_coverage_normal_triggered = csCoverageEnabled
    && csCoverageTriggerMode !== 'selector_failure'
    && raw_call_spread_triggered
    && !call_spread_triggered
    && !call_spread_coverage_pre_crisis_triggered
    && !csEventRiskBlocked
    && !csSecondaryCoverageRiskBlocked
    && (!csExtensionBlocked || coverageCanConsumeExtensionBlock && coverageExtensionQualityReleased)
    && !csVixBlocked
    && !csCandidate9MddBlocked
    && (csCoverageTriggerMode === 'research_blocked'
      ? csResearchEntryFinalBlocked
      : csCoverageTriggerMode === 'tail_or_research_or_calm_vix_v1'
        ? calmVixMacroReleased && (csResearchEntryFinalBlocked || csTailEntryFinalBlocked || csExtensionFinalBlocked)
      : csCoverageTriggerMode === 'tail_or_research_or_extension_calm_term_v1'
        ? csResearchEntryFinalBlocked || csTailEntryFinalBlocked || calmTermMacroReleased && csExtensionFinalBlocked
      : csCoverageTriggerMode === 'tail_or_research_or_extension_quiet_vix_adx_v1'
        ? csResearchEntryFinalBlocked || csTailEntryFinalBlocked || quietVixAdxMacroReleased && csExtensionFinalBlocked
      : csCoverageTriggerMode === 'macro_calm_vix_all_v1'
        ? macroCalmVixAllReleased && (csResearchEntryFinalBlocked || csTailEntryFinalBlocked || csExtensionFinalBlocked)
      : coverageCanConsumeExtensionBlock
        ? csResearchEntryFinalBlocked || csTailEntryFinalBlocked || coverageExtensionQualityReleased && csExtensionFinalBlocked
        : csResearchEntryFinalBlocked || csTailEntryFinalBlocked)
    && regime !== 'BEAR'
    && regime !== 'CRISIS';
  let call_spread_coverage_triggered = call_spread_coverage_pre_crisis_triggered || call_spread_coverage_normal_triggered;
  // 副层 v2（独立触发，研究专用）：与主层 cap1 计数器完全解耦，只要求主层今天没开单 + 自身资格闸清空。
  // 实测发现：完全解耦（不要求 csPreCrisisActive）会让副层 v2 在 2023 这类非防御性窗口大量开仓，
  // 胜率崩到 72-80%、MDD 炸到 -$3.4k~-$4.9k（2023 单年）——不符合"高胜率"目标，因此默认仍要求
  // csPreCrisisActive（只解耦主层自己的 cap1 计数器，不解耦"是否处于预危机状态"），
  // 只有显式打开 csSecondary2AllowOutsidePreCrisis 才允许完全解耦（研究对照用，不建议默认开启）。
  const csSecondary2EventScoped = isCallCreditSpreadEventRiskScoped({
    preCrisisActive: csPreCrisisActive,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    scope: params.csSecondaryEventRiskScope ?? 'all',
    requirePreCrisis: params.csSecondary2AllowOutsidePreCrisis !== true,
  });
  const csSecondary2RiskBlocked = csSecondary2EventScoped
    && params.csSecondaryMaxEntriesInWindow !== undefined
    && (ctx.input.csSecondaryEventRiskState?.entriesInWindow ?? 0) >= params.csSecondaryMaxEntriesInWindow;
  const call_spread_secondary2_triggered = !csCoverageEnabled && params.csSecondaryEnabled === true
    && params.csSecondary2TriggerMode === 'independent'
    && raw_call_spread_triggered
    && !call_spread_triggered
    && (params.csSecondary2AllowOutsidePreCrisis === true || csPreCrisisActive)
    && csSecondary2EventScoped
    && !csSecondary2RiskBlocked
    && !csSecondaryQqqRoc20Blocked
    && !csEntryBlocked
    && !csExtensionBlocked
    && !csVixBlocked
    && !csCandidate9MddBlocked
    && !csTailEntryEffectiveBlocked
    && !csResearchEntryEffectiveBlocked
    && regime !== 'BEAR'
    && regime !== 'CRISIS';
  const effectiveCallSpreadTriggered = call_spread_triggered || call_spread_secondary_triggered || call_spread_coverage_triggered || call_spread_secondary2_triggered;
  if (csValidatedSafeReleased) {
    warnings.push(`CS v2.5 WR-9 Validated Safe-FK/Slow-VIX 释放：regime=${regime}，SR=${slowSubregimeState ?? 'n/a'}，VIX=${vix.toFixed(1)}`);
  }
  if (csExtensionFinalBlocked) {
    warnings.push(`CS extension gate：priceExtensionAtr=${priceExtensionAtr!.toFixed(2)} >= ${csExtensionGate!.toFixed(2)}，跳过新开 Call Spread`);
  }
  if (csEntryBlocked) {
    warnings.push('CS 研究回放闸：逐日阻断新开 Call Spread');
  }
  if (csVixBlocked) {
    warnings.push(`CS VIX floor：VIX=${vix.toFixed(1)} < ${csVixOpenFloor.toFixed(1)}，低波动环境跳过新开 Call Spread`);
  }
  if (csCandidate9MddBlocked) {
    warnings.push(`CS v2.3 MDD-A-S 阻断新开：regime=${regime}，SR=${slowSubregimeState ?? 'n/a'}，回撤=${((regimeData?.drawdown_from_recent_high_pct ?? 0) * 100).toFixed(1)}%，VIX=${vix.toFixed(1)}，ROC20=${(qqqROC20 * 100).toFixed(1)}%`);
  }
  if (csTailEntryFinalBlocked) {
    warnings.push(`CS 尾部研究闸阻断新开：gate=${params.csTailEntryGate}，VIX=${vix.toFixed(1)}，ADX=${regimeData?.adx14?.toFixed(1) ?? 'n/a'}`);
  }
  if (csResearchEntryFinalBlocked) {
    warnings.push(`CS 研究 SR 路径闸阻断新开：gate=${params.csResearchEntryGate}，posterior=${typeof slowSubregimePosterior === 'number' ? slowSubregimePosterior.toFixed(3) : 'n/a'}，弱势持续=${ctx.input.csResearchWeakPersistenceDays ?? 0}日`);
  }
  if (csSecondaryQqqRoc20Blocked) {
    warnings.push(`CS 独立副层 QQQ ROC20 闸：${(qqqROC20 * 100).toFixed(1)}% > ${((params.csSecondaryQqqRoc20Max ?? 0) * 100).toFixed(1)}%，跳过副层新开`);
  }
  if (csEventRiskBlocked) {
    warnings.push(call_spread_secondary_triggered
      ? `CS 主层预危机 cap1：窗口内已开 ${ctx.input.csEventRiskState?.entriesInWindow ?? 0} 笔，转交独立副层`
      : `CS 预危机事件缩放：窗口内已开 ${ctx.input.csEventRiskState?.entriesInWindow ?? 0} 笔，达到上限 ${params.csPreCrisisMaxEntriesInWindow}，跳过新开`);
  }
  if (csPreCrisisCapQualityReleased && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) >= 1) {
    warnings.push(`CS 预危机 cap1 质量释放：regime=${regime}，SR=${slowSubregimeState ?? 'n/a'}，VIX=${vix.toFixed(1)}，ROC5=${(qqqROC5ForCapRelease * 100).toFixed(1)}%`);
  }

  // ── Put Credit Spread trigger ─────────────────────────────────────────────
  const { enablePCS, pcsMode } = params;
  const pcsSafetyHasOpenPutSpread = params.optionsBacktestPositionMode?.pcs === 'independent' && params.pcsMaxOpenPositions !== 1
    ? false
    : hasOpenQQQPutSpread;
  const pcsSafetyBlockers = [
    !enablePCS ? 'PCS_DISABLED' : null,
    backwardation ? 'BACKWARDATED_TERM' : null,
    hasOpenCollar && collarBlocksOtherOverlays ? 'OPEN_COLLAR' : null,
    collar_triggered && collarBlocksOtherOverlays ? 'COLLAR_TRIGGERED' : null,
    pcsSafetyHasOpenPutSpread ? 'OPEN_PCS' : null,
    regime === 'CRISIS' ? 'REGIME_CRISIS' : null,
    regime === 'BEAR' ? 'REGIME_BEAR' : null,
    regimeData?.crisisPhase === 'CONFIRMED' ? 'CRISIS_PHASE_CONFIRMED' : null,
    regimeData?.crisisPhase === 'PENDING' ? 'CRISIS_PHASE_PENDING' : null,
  ].filter((reason): reason is string => reason !== null);
  const pcsResearchSafetyOverride = params.pcsResearchSafetyOverride;
  const pcsResearchSafetyRelease = pcsResearchSafetyOverride === 'allow'
    || (pcsResearchSafetyOverride === 'allow_backwardation_only'
      && backwardation
      && regime !== 'CRISIS'
      && regime !== 'BEAR'
      && regimeData?.crisisPhase !== 'CONFIRMED'
      && regimeData?.crisisPhase !== 'PENDING'
      && !pcsSafetyHasOpenPutSpread
      && !hasOpenCollar
      && !collar_triggered)
    || (pcsResearchSafetyOverride === 'allow_bear_only'
      && regime === 'BEAR'
      && !backwardation
      && regimeData?.crisisPhase !== 'CONFIRMED'
      && regimeData?.crisisPhase !== 'PENDING'
      && !pcsSafetyHasOpenPutSpread
      && !hasOpenCollar
      && !collar_triggered)
    || (pcsResearchSafetyOverride === 'allow_crisis_phase_only'
      && (regimeData?.crisisPhase === 'CONFIRMED' || regimeData?.crisisPhase === 'PENDING')
      && regime !== 'CRISIS'
      && regime !== 'BEAR'
      && !backwardation
      && !pcsSafetyHasOpenPutSpread
      && !hasOpenCollar
      && !collar_triggered);
  const pcsSafetyConditionsMet = pcsResearchSafetyRelease
    ? enablePCS
    : evaluatePutCreditSpreadSafety({
      enabled: enablePCS,
      regime,
      crisisPhase: regimeData?.crisisPhase,
      backwardation,
      ...resolveCollarPutSpreadExclusion({ hasOpenCollar, collarTriggered: collar_triggered, blocksOtherOverlays: collarBlocksOtherOverlays }),
      // 独立单笔研究默认允许重叠；研究型 maxOpen1 仍按固定单笔计量，但复用真实持仓互斥。
      hasOpenPutSpread: pcsSafetyHasOpenPutSpread,
    });
  const pcsReactiveV1Backtest = params.pcsStockDecisionFilterMode === 'reactive_pcs_v1';
  const pcsReactiveTiming = pcsReactiveV1Backtest
    ? explainReactivePcsTiming({
      symbol: proxySymbol,
      regime,
      vix: macro.vix ?? Number.NaN,
      crisisPhase: regimeData?.crisisPhase,
      vix3m: macro.vix3m ?? Number.NaN,
    })
    : undefined;
  const pcsResearchProfile = params.pcsResearchProfile;
  const researchVix = regimeData?.vix ?? vix;
  const researchAdx14 = regimeData?.adx14;
  const isCandidateARescueProfile = pcsResearchProfile === 'candidateARescue';
  const isCandidateAProfile = pcsResearchProfile === 'candidateA' || isCandidateARescueProfile;
  const pcsCandidateAStateRelease = isCandidateAProfile
    && !pcsReactiveTiming?.eligible
    && isPcsCandidateARelease({
      enabled: true,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      vix: researchVix,
      adx14: researchAdx14,
      tqqqRealisedVol20d,
    });
  const pcsCandidateAExpansionRelease = isCandidateARescueProfile
    && isPcsCandidateAExpansionRelease({
      enabled: true,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      vix: researchVix,
      adx14: researchAdx14,
      tqqqRealisedVol20d,
    });
  const researchReactiveRescue = (() => {
    if (pcsResearchProfile === undefined || !Number.isFinite(researchVix) || !Number.isFinite(researchAdx14)) return false;
    const adx = researchAdx14!;
    const candidate1 = (
      (regime === 'SIDEWAYS' && researchVix! >= 14 && researchVix! < 18)
      || (regime === 'RANGE_BOUND' && researchVix! >= 18 && researchVix! < 28)
    ) && adx >= 12 && adx <= 30;
    if (pcsResearchProfile === 'candidate1') return candidate1;
    const lowVix = (
      (regime === 'BULL' && researchVix! < 10 && adx >= 12 && adx <= 30)
      || (regime === 'BULL' && researchVix! >= 10 && researchVix! < 12 && adx >= 20 && adx <= 30)
      || (regime === 'RISK_ON_WEAKENING' && researchVix! >= 10 && researchVix! < 12 && adx >= 12 && adx <= 30)
      || (regime === 'RISK_ON_EXTENDED' && researchVix! >= 10 && researchVix! < 12 && adx >= 12 && adx <= 20)
    );
    if (pcsResearchProfile === 'candidateARescue') return pcsCandidateAStateRelease || ((!pcsReactiveTiming?.eligible) && (candidate1 || lowVix));
    if (pcsResearchProfile === 'candidateA') return pcsCandidateAStateRelease || ((!pcsReactiveTiming?.eligible) && (candidate1 || lowVix));
    return candidate1 || lowVix;
  })();
  // 研究专用：只旁路 Reactive 的一个内部子门；安全资格、版本闸、选腿后质量闸仍保留。
  // 这些模式不属于任何生产默认，避免把整条 Reactive 放开误当成局部救援。
  const researchReactiveTimingRelease = (() => {
    const mode = params.pcsResearchTimingOverride;
    if (mode === undefined || mode === 'allow' || pcsReactiveTiming === undefined) return false;
    const reactiveVix = macro.vix;
    const adx14 = regimeData?.adx14;
    const reasons = pcsReactiveTiming.reasonCodes;
    if (!Number.isFinite(reactiveVix) || !Number.isFinite(adx14)) return false;
    if (reasons.includes('CRISIS_PHASE') || reasons.includes('BACKWARDATED_TERM')) return false;
    if (mode === 'allow_low_vix_12_14_adx20') {
      return REACTIVE_PCS_ALLOWED_REGIMES.includes(regime as (typeof REACTIVE_PCS_ALLOWED_REGIMES)[number])
        && reactiveVix! >= 12 && reactiveVix! < 14
        && adx14! >= 20 && adx14! <= 30
        && reasons.includes('VIX_OUT_OF_RANGE');
    }
    if (mode === 'allow_high_vix_28_30_adx20') {
      return REACTIVE_PCS_ALLOWED_REGIMES.includes(regime as (typeof REACTIVE_PCS_ALLOWED_REGIMES)[number])
        && reactiveVix! > 28 && reactiveVix! <= 30
        && adx14! >= 20
        && reasons.includes('VIX_OUT_OF_RANGE');
    }
    if (mode === 'allow_range_bound_vix_14_18_adx12_30') {
      return regime === 'RANGE_BOUND'
        && reactiveVix! >= 14 && reactiveVix! <= 18
        && adx14! >= 12 && adx14! <= 30
        && reasons.length === 1
        && reasons.includes('REGIME_DISALLOWED');
    }
    if (mode === 'allow_risk_on_extended_vix_12_14_adx12_30') {
      return regime === 'RISK_ON_EXTENDED'
        && reactiveVix! >= 12 && reactiveVix! < 14
        && adx14! >= 12 && adx14! <= 30
        && reasons.length === 1
        && reasons.includes('VIX_OUT_OF_RANGE');
    }
    return mode === 'allow_range_adx_edge'
      && (regime === 'SIDEWAYS' || regime === 'RANGE_BOUND')
      && reactiveVix! >= 14 && reactiveVix! <= 28
      && (adx14! < 12 || adx14! > 30)
      && reasons.includes('REGIME_DISALLOWED')
      && !reasons.includes('VIX_OUT_OF_RANGE');
  })();
  // 研究专用：regime+slowSubregime 命中已验证的"好子状态"时补开一次，不占用/不改变原时机判定。
  const pcsGoodSubstateMatch = params.pcsGoodSubstateBoost === true && (
    (regime === 'BULL' && (slowSubregimeState === 'SR01' || slowSubregimeState === 'SR02'))
    || (regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
  );
  const pcsOriginalSignal = pcsSafetyConditionsMet && pcsMode !== 'off' && !pcsStreakCooldownBlocked && (
    params.pcsResearchTimingOverride === 'allow'
    || researchReactiveTimingRelease
    || pcsGoodSubstateMatch
    || researchReactiveRescue
    || (pcsReactiveV1Backtest
      ? isReactivePcsTiming(proxySymbol, regime, macro.vix ?? Number.NaN, regimeData?.crisisPhase, macro.vix3m ?? Number.NaN)
      : evaluatePutCreditSpreadTiming({ mode: pcsMode, regime, vix, qqqRoc5: qqqROC5, pullbackRoc5Ceiling: PCS_PULLBACK_ROC5_CEILING, pullbackVixFloor: PCS_PULLBACK_VIX_FLOOR }))
  );
  // 两个 reactive 入口均为引擎时机标记，不是页面决策过滤器。
  const pcsPageDecisionMode = params.pcsStockDecisionFilterMode === 'reactive_pcs' || params.pcsStockDecisionFilterMode === 'reactive_pcs_v1' ? 'off' : params.pcsStockDecisionFilterMode;
  const pcsStockDecision = pcsSafetyConditionsMet && pcsPageDecisionMode !== 'off' ? evaluatePutCreditSpreadPageDecision({
    mode: pcsPageDecisionMode,
    bars: prices.QQQ,
    vix,
    vix3m: ctx.input.macro.vix3m,
    vxnHistory: ctx.input.macro.vxnHistory,
    optionChain: chain,
    bearVeto: params.pcsStockDecisionBearVeto,
    volConfirmDays: params.pcsStockDecisionVolConfirmDays,
  }) : undefined;
  const pcsPersistDays = params.pcsStockDecisionPersistDays;
  // persist 门：raw 信号已连续出现 N 日（streak 不含当日）才放行——评分事件驱动，冲击日首日不接
  const { raw: pcsPageSignalRaw, triggered: pcsPageSignal } = evaluatePutCreditSpreadPageSignal({ mode: pcsPageDecisionMode, allowed: pcsStockDecision?.allowed, priorStreak: ctx.input.pcsPageSignalStreak ?? 0, persistDays: pcsPersistDays });
  const pcsNormalTimingSignal = pcsSafetyConditionsMet && pcsMode !== 'off' && !pcsStreakCooldownBlocked
    && (pcsReactiveV1Backtest
      ? isReactivePcsTiming(proxySymbol, regime, macro.vix ?? Number.NaN, regimeData?.crisisPhase, macro.vix3m ?? Number.NaN)
      : evaluatePutCreditSpreadTiming({ mode: pcsMode, regime, vix, qqqRoc5: qqqROC5, pullbackRoc5Ceiling: PCS_PULLBACK_ROC5_CEILING, pullbackVixFloor: PCS_PULLBACK_VIX_FLOOR }));
  const pcsNormalSignalPassed = pcsNormalTimingSignal || pcsPageSignal;
  const pcsExcludedByRiskOnWeakening = params.pcsExcludeRiskOnWeakening === true && regime === 'RISK_ON_WEAKENING';
  const pcsChopVixBlocked = isPcsChopVixGateBlocked({
    enabled: params.pcsChopVixGate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
  });
  const pcsBass221Blocked = isPcsBass221GateBlocked({
    enabled: params.pcsBass221Gate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
  });
  const pcsV11Blocked = isPcsV11GateBlocked({
    enabled: params.pcsV11Gate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
  });
  const pcsV12Blocked = isPcsV12GateBlocked({
    enabled: params.pcsV12Gate === true,
    v11ReleaseMode: params.pcsV11ReleaseMode,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  });
  const pcsBass232Candidate2Blocked = isPcsBass232Candidate2GateBlocked({
    enabled: params.pcsBass232Candidate2Gate === true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  });
  const pcsBass232Candidate3Blocked = isPcsBass232Candidate3GateBlocked({
    enabled: params.pcsBass232Candidate3Gate === true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  });
  const pcsEntryBlocked = ctx.input.pcsEntryBlocked === true;
  const pcsNativeP1R1EntryBlocked = params.pcsNativeCandidateP1R1 === true && isPcsNativeP1R1EntryBlocked({
    enabled: true,
    regime,
    slowSubregime: slowSubregimeState,
    vix: regimeData?.vix ?? undefined,
    adx14: regimeData?.adx14 ?? undefined,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
    priceExtensionAtr: priceExtensionAtr ?? undefined,
    priorBullStressStreak: ctx.input.pcsResearchP1BullStressStreak,
    lastSettledPnl: ctx.input.pcsResearchP1LastSettledPnl,
    scope: params.pcsNativeP1R1Scope,
    scopes: params.pcsNativeP1R1Scopes,
  });
  const pcsNativeP1ResidualFilterBlocked = params.pcsNativeP1ResidualFilter === 'bullSr01HighAdxLowRv' && isPcsNativeP1ResidualFilterBlocked({
    enabled: true,
    regime,
    slowSubregime: slowSubregimeState,
    adx14: regimeData?.adx14,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
  });
  const pcsCandidateAEntryBlocked = isCandidateAProfile && isPcsCandidateAEntryBlocked({
    enabled: true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  });
  const pcsResearchEntryFilter = params.pcsResearchEntryFilter ?? 'off';
  const pcsResearchEntryFilterBlocked = isPcsResearchEntryFilterBlocked({
    enabled: true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  }, pcsResearchEntryFilter);
  const pcsV121StateBlocked = isPcsV12GateBlocked({
    enabled: params.pcsV121Gate === true,
    v11ReleaseMode: params.pcsV11ReleaseMode,
    // V1.2.1 的简化5研究口径使用状态引擎 VIX；独立 PCS 的本地 `vix` 可能是 VXN。
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
  });
  const pcsDiagnosticRiskEnvelope = evaluatePcsRiskEnvelope({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix: regimeData?.vix ?? vix,
    rv20: tqqqRealisedVol20d,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    adx14: regimeData?.adx14,
    roc20: qqqROC20,
  }, params.pcsResearchProfile === 'candidate3' || params.pcsResearchProfile === 'candidate4' || isCandidateAProfile
    ? (isCandidateARescueProfile ? 'candidate4_full_only_v1' : 'candidate4_full_v1')
    : params.pcsRiskEnvelopeProfile);
  // V1.2.1 enters candidate construction before its selected-Sigma/lower release check.
  // Legacy V1.2 remains an early state gate for explicit historical replay.
  let pcsV121Released: boolean | undefined;
  let pcsV123BlockedBy: PcsV123GateParts['blockedBy'] = [];
  // An explicitly supplied P4 profile is also callable from production.
  // Defaults remain unchanged because production callers omit this field.
  // The profile owner is responsible for carrying current-bar history and
  // invoking its settlement callback after a real close.
  const pcsDynamicEntryProfile = ctx.input.pcsDynamicEntryProfile;
  const pcs_triggered = pcsDynamicEntryProfile
    ? !pcsEntryBlocked && pcsSafetyConditionsMet && !pcsStreakCooldownBlocked && (pcsOriginalSignal || pcsPageSignal || pcsReactiveTiming?.eligible === false || pcsV121StateBlocked)
    : !pcsExcludedByRiskOnWeakening && !pcsChopVixBlocked && !pcsBass221Blocked && !pcsV11Blocked && !pcsBass232Candidate2Blocked && !pcsBass232Candidate3Blocked && !pcsV12Blocked && !pcsEntryBlocked && !pcsNativeP1R1EntryBlocked && !pcsNativeP1ResidualFilterBlocked && !pcsCandidateAEntryBlocked && !pcsResearchEntryFilterBlocked && (pcsOriginalSignal || pcsPageSignal);
  if (pcsSafetyConditionsMet && pcsPageDecisionMode !== 'off' && !pcsPageSignal && !pcsStockDecision?.available) {
    warnings.push('PCS 页面决策信号不可用');
  }
  if (pcsExcludedByRiskOnWeakening) {
    warnings.push('PCS 研究闸：RISK_ON_WEAKENING 禁止新开');
  }
  if (pcsChopVixBlocked) {
    warnings.push('PCS 2.1.2 chop/VIX 闸：低 ADX + 高区间 + 价格扩张且 VIX<19，跳过新开');
  }
  if (pcsBass221Blocked) {
    warnings.push('PCS 2.2.1 研究闸：SR01/SR02/2018 型风险状态，跳过新开');
  }
  if (pcsV11Blocked) {
    warnings.push('PCS V1.1 闸：RISK_ON_WEAKENING 且回撤≥5%、ROC20<0，跳过新开');
  }
  if (pcsBass232Candidate2Blocked) {
    warnings.push('PCS 候选2闸：A-lite/B-lite/顶端延伸状态，跳过新开');
  }
  if (pcsBass232Candidate3Blocked) {
    warnings.push('PCS bass2.3.2 候选3闸：合并 SR01 趋势风险/B-lite/顶端延伸状态，跳过新开');
  }
  if (pcsV12Blocked) {
    warnings.push('PCS V1.2 Balanced-Tail 闸：L1/冲击/弱化尾部状态，跳过新开');
  }
  if (pcsEntryBlocked) {
    warnings.push('PCS 研究闸：逐日配置禁止新开');
  }
  if (pcsCandidateAEntryBlocked) {
    warnings.push('PCS v1.2.7b/P0 候选 A 基础风险盾牌阻断新开');
  }
  if (pcsResearchEntryFilterBlocked) {
    warnings.push(`PCS 研究胜率过滤闸：${pcsResearchEntryFilter} 阻断新开`);
  }
  if (enableCS && csMode === 'strict_recovery' && !call_spread_triggered) {
    const csSkipReasons = strictRecoveryCallSpreadSkipReasons({
      regimeAllowed: csRegimeAllowed, regime, hasOpenCallSpread: hasOpenQQQCallSpread,
      collarShortCall: pendingCollarHasShortCall || hasOpenCollarShortCall, vix,
      vixLowThreshold: VIX_LOW_THRESHOLD,
      hasPutSpreadProtection: hasOnlyPutSpreadProtection || pendingPutSpreadProtection,
      qqqRoc5: qqqROC5, recoveryRoc5: QQQ_RECOVERY_ROC5,
      tqqqRoc20: tqqqROC20, recoveryRoc20: TQQQ_RECOVERY_ROC20,
    });
    if (csSkipReasons.length > 0) {
      warnings.push(`严格补漏 CS 未触发：${csSkipReasons.join('；')}`);
    }
  }
  if (csSecondaryRiskBlocked) {
    warnings.push(`CS 独立副层事件预算：窗口内已开 ${ctx.input.csSecondaryEventRiskState?.entriesInWindow ?? 0} 笔，达到上限 ${params.csSecondaryMaxEntriesInWindow}，跳过副层新开`);
  }

  // ── Equity Boost Put Spread trigger (independent of legacy PCS) ───────────
  const { enableEquityBoostPCS, equityBoostEntryMode } = params;
  // 研究专用：regime+slowSubregime 命中已验证/待验证的坏子状态时禁止新开（见 params.ts 归因注释）。
  const ebTrendSignal = ctx.results.trend?.data.signal;
  const ebPriceVsSma200Pct = ctx.results.regime?.data.price_vs_sma200_pct;
  const ebRiskOnWeakeningSr01VolGateBlocked = equityBoostRiskOnWeakeningSr01VolGateBlocked({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix: macro.vix,
    vxn: macro.vxn,
    vxnHistory: macro.vxnHistory,
    ratioCeiling: params.equityBoostRiskOnWeakeningSr01VxnVixRatioCeiling,
    requireVxn10dRising: params.equityBoostRiskOnWeakeningSr01RequireVxn10dRising,
  });
  const equityBoostBass221Blocked = params.equityBoostBass221Gate === true && isEquityBoostBass221GateBlocked({
    enabled: true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: tqqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
  });
  const equityBoostBass221VixReboundBlocked = isEquityBoostBass221VixReboundGateBlocked({
    enabled: params.equityBoostBass221VixReboundGate === true,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    qqqRoc20: qqqROC20,
    qqqRoc5: qqqROC5,
    qqqRoc5Slope: qqqROC5Slope,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    vix,
    vix5dAgo: macro.vix5dAgo,
  });
  const equityBoostBass221SeverityActive = params.equityBoostBass221SeverityMultiplier !== undefined && isEquityBoostBass221SeverityActive({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    qqqRoc20: qqqROC20,
    qqqRoc5: qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    tqqqRealisedVol20d,
    range20dPct: regimeData?.range20d_pct,
  });
  const slowSubregimeHealth = ctx.input.slowSubregimeFactors?.slow_subregime_data_health?.value;
  const equityBoostMacroRiskActive = params.equityBoostMacroRiskMode === 'risk_on_weakening_neutral_stale_v1'
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT'
    && slowSubregimeHealth === 'STALE_OR_MISSING';
  const equityBoostMacroTiltActive = params.equityBoostMacroRiskMode === 'macro_tilt_v1';
  const equityBoostMacroTiltFavorable = equityBoostMacroTiltActive
    && vix < 22
    && typeof tqqqRealisedVol20d === 'number'
    && tqqqRealisedVol20d < .8
    && regime !== 'SIDEWAYS'
    && regime !== 'BEAR'
    && ebTrendSignal !== 'BEAR'
    && ebTrendSignal !== 'STRONG_BEAR';
  const equityBoostMacroTiltDefensive = equityBoostMacroTiltActive
    && !equityBoostMacroTiltFavorable
    && (vix >= 22 || (typeof tqqqRealisedVol20d === 'number' && tqqqRealisedVol20d >= .8) || regime === 'SIDEWAYS' || regime === 'BEAR' || ebTrendSignal === 'BEAR' || ebTrendSignal === 'STRONG_BEAR');
  const equityBoostMacroSafeClusterTiltActive = params.equityBoostMacroRiskMode === 'macro_safe_cluster_tilt_v1';
  const equityBoostMacroSafeClusterTiltDefensive = equityBoostMacroSafeClusterTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT'
    && slowSubregimeHealth === 'STALE_OR_MISSING';
  const equityBoostMacroSafeClusterTiltFavorable = equityBoostMacroSafeClusterTiltActive
    && !equityBoostMacroSafeClusterTiltDefensive
    && regime === 'BULL'
    && ebTrendSignal === 'NEUTRAL'
    && vix < 22;
  const equityBoostMacroBullLowVixClusterTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_lowvix_cluster_tilt_v1';
  const equityBoostMacroBullLowVixClusterTiltDefensive = equityBoostMacroBullLowVixClusterTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT'
    && slowSubregimeHealth === 'STALE_OR_MISSING';
  const equityBoostMacroBullLowVixClusterTiltFavorable = equityBoostMacroBullLowVixClusterTiltActive
    && !equityBoostMacroBullLowVixClusterTiltDefensive
    && regime === 'BULL'
    && vix < 22;
  const equityBoostMacroBullLowVixWeakeningTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_lowvix_weakening_tilt_v1';
  const equityBoostMacroBullLowVixWeakeningTiltDefensive = equityBoostMacroBullLowVixWeakeningTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullLowVixWeakeningTiltFavorable = equityBoostMacroBullLowVixWeakeningTiltActive
    && !equityBoostMacroBullLowVixWeakeningTiltDefensive
    && regime === 'BULL'
    && vix < 22;
  const equityBoostMacroBullLowVixNeutralTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_lowvix_neutral_tilt_v1';
  const equityBoostMacroBullLowVixNeutralTiltDefensive = equityBoostMacroBullLowVixNeutralTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL';
  const equityBoostMacroBullLowVixNeutralTiltFavorable = equityBoostMacroBullLowVixNeutralTiltActive
    && !equityBoostMacroBullLowVixNeutralTiltDefensive
    && regime === 'BULL'
    && vix < 22;
  const equityBoostMacroBullLowVixWeakeningNeutralTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_lowvix_weakening_neutral_tilt_v1';
  const equityBoostMacroBullLowVixWeakeningNeutralTiltDefensive = equityBoostMacroBullLowVixWeakeningNeutralTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullLowVixWeakeningNeutralTiltFavorable = equityBoostMacroBullLowVixWeakeningNeutralTiltActive
    && !equityBoostMacroBullLowVixWeakeningNeutralTiltDefensive
    && ((regime === 'BULL' && vix < 22)
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL'));
  const equityBoostMacroBullWeakeningNeutralTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_neutral_tilt_v1';
  const equityBoostMacroBullWeakeningNeutralTiltDefensive = equityBoostMacroBullWeakeningNeutralTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullWeakeningNeutralTiltFavorable = equityBoostMacroBullWeakeningNeutralTiltActive
    && !equityBoostMacroBullWeakeningNeutralTiltDefensive
    && (regime === 'BULL' || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL'));
  const equityBoostMacroBullWeakeningRangeNeutralTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_range_neutral_tilt_v1';
  const equityBoostMacroBullWeakeningRangeNeutralTiltDefensive = equityBoostMacroBullWeakeningRangeNeutralTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullWeakeningRangeNeutralTiltFavorable = equityBoostMacroBullWeakeningRangeNeutralTiltActive
    && !equityBoostMacroBullWeakeningRangeNeutralTiltDefensive
    && (regime === 'BULL'
      || (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND')));
  const equityBoostMacroBullWeakeningRangeAllTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_range_all_tilt_v1';
  const equityBoostMacroBullWeakeningRangeAllTiltDefensive = equityBoostMacroBullWeakeningRangeAllTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullWeakeningRangeAllTiltFavorable = equityBoostMacroBullWeakeningRangeAllTiltActive
    && !equityBoostMacroBullWeakeningRangeAllTiltDefensive
    && (regime === 'BULL'
      || regime === 'RANGE_BOUND'
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL'));
  const equityBoostMacroBullWeakeningAllRangeNeutralTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_all_range_neutral_tilt_v1';
  const equityBoostMacroBullWeakeningAllRangeNeutralTiltDefensive = equityBoostMacroBullWeakeningAllRangeNeutralTiltActive
    && regime === 'RISK_ON_WEAKENING'
    && ebTrendSignal === 'NEUTRAL'
    && slowSubregimeState === 'CURRENT';
  const equityBoostMacroBullWeakeningAllRangeNeutralTiltFavorable = equityBoostMacroBullWeakeningAllRangeNeutralTiltActive
    && !equityBoostMacroBullWeakeningAllRangeNeutralTiltDefensive
    && (regime === 'BULL'
      || (regime === 'RISK_ON_WEAKENING')
      || (ebTrendSignal === 'NEUTRAL' && regime === 'RANGE_BOUND'));
  const equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_range_neutral_sideways_defensive_tilt_v1';
  const equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltDefensive = equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltActive
    && (regime === 'SIDEWAYS'
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltFavorable = equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltActive
    && !equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltDefensive
    && (regime === 'BULL'
      || (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND')));
  const equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_range_neutral_bear_sr01_defensive_tilt_v1';
  const equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltDefensive = equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && ((ebTrendSignal === 'BEAR' && slowSubregimeState === 'SR01')
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltFavorable = equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && !equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltDefensive
    && (regime === 'BULL'
      || (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND')));
  const equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_weakening_range_neutral_bear_defensive_tilt_v1';
  const equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltDefensive = equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltActive
    && (ebTrendSignal === 'BEAR'
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltFavorable = equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltActive
    && !equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltDefensive
    && (regime === 'BULL'
      || (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND')));
  const equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltActive = params.equityBoostMacroRiskMode === 'macro_weakening_range_neutral_bear_sr01_defensive_tilt_v1';
  const equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltDefensive = equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && ((ebTrendSignal === 'BEAR' && slowSubregimeState === 'SR01')
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltFavorable = equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && !equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltDefensive
    && (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND'));
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltActive = params.equityBoostMacroRiskMode === 'macro_bull_neutral_weakening_range_neutral_bear_sr01_defensive_tilt_v1';
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltDefensive = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && ((ebTrendSignal === 'BEAR' && slowSubregimeState === 'SR01')
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltFavorable = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltActive
    && !equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltDefensive
    && ((regime === 'BULL' && ebTrendSignal === 'NEUTRAL')
      || (ebTrendSignal === 'NEUTRAL' && (regime === 'RISK_ON_WEAKENING' || regime === 'RANGE_BOUND')));
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive = params.equityBoostMacroRiskMode === 'macro_bull_neutral_weakening_range_neutral_bear_sr01_split_budget_v1';
  const equityBoostMacroRiskBullNeutralSr02ResolvedMultiplier = resolveEbBullNeutralSr02MacroMultiplier({
    active: equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive,
    regime,
    trend: ebTrendSignal ?? 'UNKNOWN',
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix,
    sharedMultiplier: params.equityBoostMacroRiskBullNeutralSr02Multiplier,
    lowVixMultiplier: params.equityBoostMacroRiskBullNeutralSr02LowVixMultiplier,
  });
  const equityBoostMacroRiskBullNeutralSr01ResolvedMultiplier = resolveEbBullNeutralSr01MacroMultiplier({
    active: equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive,
    regime,
    trend: ebTrendSignal ?? 'UNKNOWN',
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    sharedMultiplier: params.equityBoostMacroRiskUpMultiplier,
    donorMultiplier: params.equityBoostMacroRiskBullNeutralSr01Multiplier,
  });
  const equityBoostMacroRiskBullNeutralSr01Override = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && regime === 'BULL' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'SR01'
    && typeof equityBoostMacroRiskBullNeutralSr01ResolvedMultiplier === 'number'
    && Number.isFinite(equityBoostMacroRiskBullNeutralSr01ResolvedMultiplier);
  const equityBoostMacroRiskBullNeutralSr02Override = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && regime === 'BULL' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'SR02'
    && typeof equityBoostMacroRiskBullNeutralSr02ResolvedMultiplier === 'number'
    && Number.isFinite(equityBoostMacroRiskBullNeutralSr02ResolvedMultiplier);
  const equityBoostMacroRiskBullSr02BullTrendOverride = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && typeof params.equityBoostMacroRiskBullSr02BullTrendMultiplier === 'number'
    && Number.isFinite(params.equityBoostMacroRiskBullSr02BullTrendMultiplier)
    && regime === 'BULL'
    && slowSubregimeState === 'SR02'
    && (ebTrendSignal === 'BULL' || ebTrendSignal === 'STRONG_BULL');
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetDefensive = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && ((ebTrendSignal === 'BEAR' && slowSubregimeState === 'SR01')
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL' && slowSubregimeState === 'CURRENT'));
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetRangeFavorable = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && regime === 'RANGE_BOUND'
    && ebTrendSignal === 'NEUTRAL';
  const equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetMainFavorable = equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    && !equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetDefensive
    && !equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetRangeFavorable
    && ((regime === 'BULL' && ebTrendSignal === 'NEUTRAL')
      || (regime === 'RISK_ON_WEAKENING' && ebTrendSignal === 'NEUTRAL'));
  const equityBoostCandidate6GateBlocked = params.equityBoostCandidate6Mdd === true && isEquityBoostCandidate6GateBlocked({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix,
    adx14: regimeData?.adx14,
    priceVsSma200Pct: ebPriceVsSma200Pct,
    tqqqRealisedVol20d,
    tqqqRoc20: tqqqROC20,
    roc5: qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
  });
  const ebExcludedSubstate = (
    (ctx.input.equityBoostEntryBlocked === true)
    ||
    (params.equityBoostExcludeRangeBoundSr02 === true && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02')
    || (params.equityBoostExcludeRiskOnExtendedSr01 === true && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01')
    || (params.equityBoostExcludeSidewaysSr01 === true && regime === 'SIDEWAYS' && slowSubregimeState === 'SR01')
    || (params.equityBoostExcludeRiskOnWeakeningSr01 === true && regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR01')
    || (params.equityBoostExcludeRiskOnExtendedSr02 === true && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR02')
    || (params.equityBoostExcludeStrongBullTrend === true && ebTrendSignal === 'STRONG_BULL')
    || equityBoostBass221Blocked
    || equityBoostBass221VixReboundBlocked
    || equityBoostCandidate6GateBlocked
    || (params.equityBoostExcludeCsPreCrisis === true && csPreCrisisActive === true)
    || (params.equityBoostPriceVsSma200Ceiling !== undefined && (ebPriceVsSma200Pct ?? 0) > params.equityBoostPriceVsSma200Ceiling)
    || (params.equityBoostVxnCeiling !== undefined && (macro.vxn ?? 0) > params.equityBoostVxnCeiling)
    || ebRiskOnWeakeningSr01VolGateBlocked
  );
  const equityBoostRawSignal = evaluateEquityBoostTrigger({
    enableEquityBoostPCS,
    entryMode: equityBoostEntryMode,
    regime,
    crisisPhase: regimeData?.crisisPhase,
    backwardation,
    qqqROC5,
    qqqROC20,
    qqqDrawdownFromHigh,
    vix,
    // Upstream data-quality/regime BLOCK already short-circuited runOverlay above
    // (anyUpstreamBlock early-return), so by this point confidence is sufficient.
    dataConfidenceOk: true,
    hasOpenEquityBoost,
    hasCompetingQQQBullishPutPosition: hasOpenQQQPutSpread || openICCount > 0,
    pullbackRocCeiling: params.equityBoostPullbackRocCeiling,
    pullbackVixFloor: params.equityBoostPullbackVixFloor,
    meltUpDrawdownMax: params.equityBoostMeltUpDrawdownMax,
    meltUpVixCeiling: params.equityBoostMeltUpVixCeiling,
    meltUpRoc20Min: params.equityBoostMeltUpRoc20Min,
  });
  const equityBoostEntryGateBlocked = ctx.input.equityBoostEntryGate?.({
    date: ctx.input.date,
    regime,
    slowSubregime: slowSubregimeState,
    vix: macro.vix,
    vxn: macro.vxn,
    tqqqRealisedVol20d,
    qqqROC20: tqqqROC20,
    qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    priceVsSma200Pct: ebPriceVsSma200Pct,
    adx14: regimeData?.adx14,
    priceExtensionAtr,
    vixChange5d: macro.vix5dAgo == null || macro.vix == null ? undefined : macro.vix - macro.vix5dAgo,
    rawSignal: equityBoostRawSignal,
  }) ?? false;
  const equity_boost_triggered = !ebExcludedSubstate && !equityBoostEntryGateBlocked && equityBoostRawSignal;
  // Mutual exclusion / new-strategy-priority: the new strategy blocks a fresh legacy PCS open
  // the same bar it wants to open (handled by pcs_triggered reading hasOpenQQQPutSpread only —
  // add the explicit "new strategy priority" suppression here so both can never fire together).
  const { pcsTriggered: pcs_triggered_final } = resolvePutStrategyPriority(pcs_triggered, equity_boost_triggered);
  const pcsRescueEntryMode: PCSRescueEntryMode = params.pcsRescueEntryMode ?? 'reactive_soft_pool';
  const pcsRescueRegimeScope: PCSRescueRegimeScope | 'selective_quality_v105_compact_vix13' | 'selective_quality_v106_compact_vix13' | 'selective_quality_v107_compact_vix13_no_rv20tail' | 'selective_quality_v108_compact_vix13_adx45' = params.pcsRescueRegimeScope ?? 'soft_pool';
  const pcsRescueDeltaMode: PCSRescueDeltaMode = params.pcsRescueDeltaMode ?? 'fixed';
  const pcsRescueSoftTiming = pcsReactiveTiming !== undefined
    && !pcsReactiveTiming.reasonCodes.some((reason) => reason === 'CRISIS_PHASE' || reason === 'BACKWARDATED_TERM' || reason === 'MISSING_VIX' || reason === 'MISSING_TERM_RATIO')
    && (pcsReactiveTiming.eligible
      || pcsReactiveTiming.reasonCodes.includes('VIX_OUT_OF_RANGE')
      || pcsReactiveTiming.reasonCodes.includes('REGIME_DISALLOWED'));
  const pcsRescueCoreRegime = regime === 'BULL'
    || regime === 'RANGE_BOUND'
    || regime === 'RISK_ON_WEAKENING';
  const pcsRescueExpandedQuality = pcsRescueCoreRegime
    || (Number.isFinite(regimeData?.vix ?? vix) && Number.isFinite(regimeData?.adx14)
      && ((regime === 'RISK_ON_EXTENDED' && (regimeData?.vix ?? vix) < 14 && regimeData!.adx14! >= 12 && regimeData!.adx14! <= 30)
        || (regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) > 28 && regimeData!.adx14! >= 12 && regimeData!.adx14! <= 30)));
  const pcsRescueSelectiveQuality = pcsRescueExpandedQuality
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 12)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) > 18
      && Number.isFinite(regimeData?.adx14)
      && (regimeData!.adx14! < 12 || regimeData!.adx14! >= 20))
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 14
      && (regimeData?.vix ?? vix) < 18
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 20);
  const pcsRescueSelectiveQualityV2 = pcsRescueSelectiveQuality
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 12
      && (regimeData?.vix ?? vix) < 14
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 12
      && regimeData!.adx14! < 20)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 14
      && (regimeData?.vix ?? vix) < 18
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 20
      && regimeData!.adx14! < 30);
  const pcsRescueSelectiveQualityV3 = pcsRescueSelectiveQualityV2
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 14
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 20);
  const pcsRescueSelectiveQualityV4 = pcsRescueSelectiveQualityV2
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 12
      && (regimeData?.vix ?? vix) < 18
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .15)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) > 18
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .12);
  const pcsRescueSelectiveQualityV5 = pcsRescueSelectiveQualityV4
    && !(
      (regime === 'RISK_ON_EXTENDED'
        && Number.isFinite(regimeData?.vix ?? vix)
        && (regimeData?.vix ?? vix) >= 12
        && (regimeData?.vix ?? vix) < 14
        && Number.isFinite(regimeData?.adx14)
        && regimeData!.adx14! >= 45
        && Number.isFinite(regimeData?.price_extension_atr)
        && regimeData!.price_extension_atr! >= 3)
      || (regime === 'SIDEWAYS'
        && Number.isFinite(regimeData?.vix ?? vix)
        && (regimeData?.vix ?? vix) > 18
        && Number.isFinite(regimeData?.adx14)
        && regimeData!.adx14! >= 12
        && regimeData!.adx14! < 20
        && Number.isFinite(tqqqRealisedVol20d)
        && tqqqRealisedVol20d! >= .67)
    );
  const pcsRescueSelectiveQualityV6 = pcsRescueSelectiveQualityV5
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .15);
  // v7：把 v5 + 低 VIX 分支合并为统一的 VIX<18/价格扩张门；尾部排除保持不变。
  const pcsRescueSelectiveQualityV7 = (
    pcsRescueSelectiveQualityV2
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 18
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .15)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) > 18
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .12)
  ) && !(
    (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 12
      && (regimeData?.vix ?? vix) < 14
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 45
      && Number.isFinite(regimeData?.price_extension_atr)
      && regimeData!.price_extension_atr! >= 3)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) > 18
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 12
      && regimeData!.adx14! < 20
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .67)
  );
  // v8：进一步收敛为 core + RISK_ON_EXTENDED 质量价格门 + SIDEWAYS 边界门。
  const pcsRescueSelectiveQualityV8 = (
    pcsRescueCoreRegime
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && Number.isFinite(regimeData?.adx14)
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && (((regimeData?.vix ?? vix) < 14 && regimeData!.adx14! >= 12 && regimeData!.adx14! <= 30)
        || ((regimeData?.vix ?? vix) < 18 && regimeData!.price_vs_sma200_pct! < .15)))
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && Number.isFinite(regimeData?.adx14)
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && (regimeData?.vix ?? vix) > 18
      && (regimeData!.adx14! < 12 || regimeData!.adx14! >= 20 || regimeData!.price_vs_sma200_pct! < .12))
  ) && !(
    (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 12
      && (regimeData?.vix ?? vix) < 14
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 45
      && Number.isFinite(regimeData?.price_extension_atr)
      && regimeData!.price_extension_atr! >= 3)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) > 18
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 12
      && regimeData!.adx14! < 20
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .67)
  );
  // v9：研究专用的尾部清理，只移除高 VIX + 高 RV20 的 RANGE_BOUND 口袋，
  // 用于检查能否修复单笔尾部而不改变低 VIX 扩展段的收益密度。
  const pcsRescueSelectiveQualityV9 = pcsRescueSelectiveQualityV7 && !(
    regime === 'RANGE_BOUND'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) > 18
    && Number.isFinite(tqqqRealisedVol20d)
    && tqqqRealisedVol20d! >= .50
  );
  // v10：在 v9 尾部清理上，继续排除低 VIX、弱 ADX 的 BULL 口袋；仅用于研究。
  const pcsRescueSelectiveQualityV10 = pcsRescueSelectiveQualityV9 && !(
    regime === 'BULL'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) < 12
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! < 20
  );
  // v11：研究专用的风险簇阻断；只针对已识别的连续亏损/高尾部口袋，
  // 不改变其它 RISK_ON_EXTENDED 的正常 Delta 20 交易。
  const pcsRescueSelectiveQualityV11 = pcsRescueSelectiveQualityV10 && !(
    (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12.5
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .48
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 27
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .09)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13.2
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 44.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .10)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 10
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .13)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 13
      && (regimeData?.vix ?? vix) < 13.5
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .16)
  );
  // v12：研究专用的精简恢复门。保留 v9 横盘尾部门，
  // 收窄 BULL/高 ADX/2015 高 RV 门，回收低金额盈利交易。
  const pcsRescueSelectiveQualityV12 = pcsRescueSelectiveQualityV9 && !(
    (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 13.5)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12.5
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .48
      && tqqqRealisedVol20d! < .55
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 27
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .09)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13.2
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 44.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .085
      && regimeData!.price_vs_sma200_pct! < .10)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 10
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .13)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 13
      && (regimeData?.vix ?? vix) < 13.5
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .16)
  );
  // v13：在 v12 精简恢复基础上放开 v9 横盘尾部门，专门检验交易覆盖率的代价。
  const pcsRescueSelectiveQualityV13 = pcsRescueSelectiveQualityV7 && !(
    (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 13.5)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12.5
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .48
      && tqqqRealisedVol20d! < .55
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 27
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .09)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13.2
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 44.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .085
      && regimeData!.price_vs_sma200_pct! < .10)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 10
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .13)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 13
      && (regimeData?.vix ?? vix) < 13.5
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .16)
  );
  // v14：研究专用的结构精简版。保留 v12 的五个风险口袋，
  // 删除高 RV 门中的 VIX/ADX 冗余条件，以及高 ADX 门中的 VIX 冗余条件；
  // 历史冻结带上应与 v12 同路径，但未来覆盖面更宽，必须单独做 OOS 验证。
  const pcsRescueSelectiveQualityV14 = pcsRescueSelectiveQualityV9 && !(
    (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 13.5)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .48
      && tqqqRealisedVol20d! < .55
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .09)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 44.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .085
      && regimeData!.price_vs_sma200_pct! < .10)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 10
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .13)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) >= 13
      && (regimeData?.vix ?? vix) < 13.5
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 28
      && regimeData!.adx14! < 32
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .16)
  );
  // v15：研究专用的最小三门版，移除 v12 中只有孤立事件支持的 C/D 尾门。
  // 仅用于检验复杂度与胜率/MDD 的交换，不作为默认配置。
  const pcsRescueSelectiveQualityV15 = pcsRescueSelectiveQualityV9 && !(
    (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! < 13.5)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .48
      && tqqqRealisedVol20d! < .55
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! < .09)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 44.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .085
      && regimeData!.price_vs_sma200_pct! < .10)
  );
  // v16_atr：研究专用的 772 笔基点。保留 v14 的全部门，
  // 仅在 RANGE_BOUND 且 priceExtensionATR>-2 时恢复被 v9 拦掉的机会。
  const pcsRescueSelectiveQualityV16Atr = pcsRescueSelectiveQualityV14
    || (regime === 'RANGE_BOUND'
      && Number.isFinite(priceExtensionAtr)
      && priceExtensionAtr! > -2);
  // v17/v18/v19：规则消融研究。分别只删除 v14 的 D/E 尾部口袋，
  // 或测试 RANGE_BOUND 的 ATR>-2 是否只是冗余存在性门；不作为默认配置。
  const pcsRescueSelectiveQualityTailA = regime === 'BULL'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) < 12
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! < 13.5;
  const pcsRescueSelectiveQualityTailB = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(tqqqRealisedVol20d)
    && tqqqRealisedVol20d! >= .48
    && tqqqRealisedVol20d! < .55
    && Number.isFinite(regimeData?.price_vs_sma200_pct)
    && regimeData!.price_vs_sma200_pct! < .09;
  const pcsRescueSelectiveQualityTailC = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! >= 44.5
    && Number.isFinite(regimeData?.price_vs_sma200_pct)
    && regimeData!.price_vs_sma200_pct! >= .085
    && regimeData!.price_vs_sma200_pct! < .10;
  const pcsRescueSelectiveQualityTailD = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) < 10
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! >= 28
    && regimeData!.adx14! < 32
    && Number.isFinite(regimeData?.price_vs_sma200_pct)
    && regimeData!.price_vs_sma200_pct! >= .13;
  const pcsRescueSelectiveQualityTailE = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) >= 13
    && (regimeData?.vix ?? vix) < 13.5
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! >= 28
    && regimeData!.adx14! < 32
    && Number.isFinite(regimeData?.price_vs_sma200_pct)
    && regimeData!.price_vs_sma200_pct! >= .16;
  const pcsRescueSelectiveQualityV17NoTailD = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailA || pcsRescueSelectiveQualityTailB || pcsRescueSelectiveQualityTailC || pcsRescueSelectiveQualityTailE))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueSelectiveQualityV18NoTailE = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailA || pcsRescueSelectiveQualityTailB || pcsRescueSelectiveQualityTailC || pcsRescueSelectiveQualityTailD))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueSelectiveQualityV19RangeAll = pcsRescueSelectiveQualityV14 || regime === 'RANGE_BOUND';
  const pcsRescueSelectiveQualityTailDE = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(regimeData?.adx14)
    && regimeData!.adx14! >= 28
    && regimeData!.adx14! < 32
    && Number.isFinite(regimeData?.vix ?? vix)
    && Number.isFinite(regimeData?.price_vs_sma200_pct)
    && (((regimeData?.vix ?? vix) < 10 && regimeData!.price_vs_sma200_pct! >= .13)
      || ((regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 13.5 && regimeData!.price_vs_sma200_pct! >= .16));
  const pcsRescueSelectiveQualityV20MergeTailDE = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailA || pcsRescueSelectiveQualityTailB || pcsRescueSelectiveQualityTailC || pcsRescueSelectiveQualityTailDE))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueExtremeExtended = regime === 'RISK_ON_EXTENDED'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) < 14
    && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! > 30)
      || (Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1.5)
      || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .15));
  // Research-only R5.E34: reopen two compact quality pockets from soft_pool.
  const pcsRescueSelectiveQualityV21SideExtCompact = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .67)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .45
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 30
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 3);
  const pcsRescueSelectiveQualityV22SideCompact = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .67);
  const pcsRescueSelectiveQualityV23SideRv85 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .85);
  const pcsRescueSelectiveQualityV24NoTailA = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailB || pcsRescueSelectiveQualityTailC || pcsRescueSelectiveQualityTailDE))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueSelectiveQualityV25NoTailB = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailA || pcsRescueSelectiveQualityTailC || pcsRescueSelectiveQualityTailDE))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueSelectiveQualityV26NoTailC = (pcsRescueSelectiveQualityV9
    && !(pcsRescueSelectiveQualityTailA || pcsRescueSelectiveQualityTailB || pcsRescueSelectiveQualityTailDE))
    || (regime === 'RANGE_BOUND' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2);
  const pcsRescueSelectiveQualityV27SideRv86 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .86);
  const pcsRescueSelectiveQualityV28SideRv87 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .87);
  const pcsRescueSelectiveQualityV29SideRv90 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .90);
  const pcsRescueSelectiveQualityV30SideRv8625 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .8625);
  const pcsRescueSelectiveQualityV31SideRv865 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .865);
  const pcsRescueSelectiveQualityV32SideRv8675 = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .8675);
  const pcsRescueSelectiveQualityV33SideRv87Alias = pcsRescueSelectiveQualityV20MergeTailDE
    || (regime === 'SIDEWAYS' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .87);
  const pcsRescueSelectiveQualityV34SideExtAtr2 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED' && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV35SideExtAdx30Atr2 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 30
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV36RiskExtAtr2AdxLt30 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV37RiskExtAtr2AdxLt20 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV38RiskExtAdxLt30 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30);
  const pcsRescueSelectiveQualityV39RiskExtAtr225AdxLt20 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2.25);
  const pcsRescueSelectiveQualityV40RiskExtAtr25AdxLt20 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2.5);
  const pcsRescueSelectiveQualityV41RiskExtAtr3AdxLt20 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 3);
  const pcsRescueSelectiveQualityV42RiskExtAdxLt20 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20);
  const pcsRescueSelectiveQualityV43RiskExtAdxLt21 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 21);
  const pcsRescueSelectiveQualityV44RiskExtAdxLt22 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22);
  const pcsRescueSelectiveQualityV45RiskExtAdxLt25 = pcsRescueSelectiveQualityV27SideRv86
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 25);
  const pcsRescueSelectiveQualityV46BullTailAtrNonnegative = pcsRescueSelectiveQualityV42RiskExtAdxLt20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 13.5
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 0);
  const pcsRescueSelectiveQualityV47SideRv100AdxGe20 = pcsRescueSelectiveQualityV46BullTailAtrNonnegative
    || (regime === 'SIDEWAYS'
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < 1
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 20);
  const pcsRescueSelectiveQualityV48SideAdxGe20 = pcsRescueSelectiveQualityV46BullTailAtrNonnegative
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 20);
  const pcsRescueSelectiveQualityV49BullTailNoAdx = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 0);
  const pcsRescueSelectiveQualityV50BullTailAtrGeNeg025 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= -.25);
  const pcsRescueSelectiveQualityV51BullTailAtrGeNeg05 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= -.5);
  const pcsRescueSelectiveQualityV52BullTailAtrGeNeg1 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= -1);
  const pcsRescueSelectiveQualityV53SideMidAdxRv90 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .9
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16);
  const pcsRescueSelectiveQualityV54SideMidAdxRv95 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .95
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16);
  const pcsRescueSelectiveQualityV55SideMidAdxRv100 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < 1
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16);
  const pcsRescueSelectiveQualityV56SideAdxGe16 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16);
  const pcsRescueSelectiveQualityV57SideAdxGe14 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 14);
  const pcsRescueSelectiveQualityV58SideAdx14Atr2 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 14
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV59BullAdxGe13 = pcsRescueSelectiveQualityV48SideAdxGe20
    || (regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 12
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 13);
  const pcsRescueSelectiveQualityV60RangeAtr225 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RANGE_BOUND'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2.25);
  const pcsRescueSelectiveQualityV61RangeAtr25 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RANGE_BOUND'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! > -2.5);
  const pcsRescueSelectiveQualityV62RiskExtAdxLt30Atr2 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV63SideAdx12Atr2Roc5Ge0 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0);
  const pcsRescueSelectiveQualityV64SideAdx12Atr2 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2);
  const pcsRescueSelectiveQualityV65SideAdx12Roc5Ge0 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0);
  const pcsRescueSelectiveQualityV66SideAtr2Roc5Ge0 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'SIDEWAYS'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0);
  const pcsRescueSelectiveQualityV67RiskExtSmaGe19 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .19);
  const pcsRescueSelectiveQualityV68RiskExtSmaGe20 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .20);
  const pcsRescueSelectiveQualityV69RiskExtSmaGe22 = pcsRescueSelectiveQualityV56SideAdxGe16
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .22);
  const pcsRescueSelectiveQualityV70CombinedE70Sma22 = pcsRescueSelectiveQualityV63SideAdx12Atr2Roc5Ge0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .22);
  const pcsRescueSelectiveQualityV71CombinedSma21 = pcsRescueSelectiveQualityV63SideAdx12Atr2Roc5Ge0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .21);
  const pcsRescueSelectiveQualityV72SlimNoBullTail = pcsRescueSelectiveQualityV42RiskExtAdxLt20
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .21);
  const pcsRescueSelectiveQualityV73SlimPreserveCoreBullTail = pcsRescueSelectiveQualityV46BullTailAtrNonnegative
    || (regime === 'SIDEWAYS'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16)
    || (regime === 'SIDEWAYS'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0)
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .21);
  const pcsRescueSelectiveQualityV74RiskExtRoc5Lt0 = pcsRescueSelectiveQualityV73SlimPreserveCoreBullTail
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(qqqROC5) && qqqROC5! < 0);
  const pcsRescueSelectiveQualityV75RiskExtSma15Roc5Lt0 = pcsRescueSelectiveQualityV73SlimPreserveCoreBullTail
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(qqqROC5) && qqqROC5! < 0);
  const pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0 = pcsRescueSelectiveQualityV73SlimPreserveCoreBullTail
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .17
      && Number.isFinite(qqqROC5) && qqqROC5! < 0);
  const pcsRescueSelectiveQualityV77RiskExtWeakeningGe1 = pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1);
  const pcsRescueSelectiveQualityV78RiskExtWeakeningSma9 = pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .09);
  const pcsRescueSelectiveQualityV79RiskExtWeakeningMomentum = pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1
      && (qqqROC20 >= .05
        || (Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! < .005)));
  const pcsRescueSelectiveQualityV80RiskExtWeakeningRoc20 = pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1
      && qqqROC20 >= .05);
  const pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown = pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! < .005);
  const pcsRescueSelectiveQualityV82RiskExtDrawdown05_1Vix15 = pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 15);
  const pcsRescueSelectiveQualityV83RiskExtDrawdown05_1Vix15Atr35 = pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 15
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 3.5);
  const pcsRescueSelectiveQualityV84RiskExtDrawdown05_1Vix15Atr35NoWeakening = pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 15
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 3.5
      && Number(regimeData?.weakening_signal_count ?? 0) < 1);
  const pcsRescueSelectiveQualityV85RiskExtDrawdown05_1Vix15Atr35NoWeakeningAblation = pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) < 15
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 3.5);
  const pcsRescueSelectiveQualityV86RiskExtDrawdown05_1Vix15Roc20_8 = pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 15
      && qqqROC20 >= .08);
  const pcsRescueSelectiveQualityV87RiskExtDrawdown05_1Vix15Roc20_8OnE99 = pcsRescueSelectiveQualityV84RiskExtDrawdown05_1Vix15Atr35NoWeakening
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.drawdown_from_recent_high_pct) && regimeData!.drawdown_from_recent_high_pct! >= .005
      && regimeData!.drawdown_from_recent_high_pct! < .01
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 15
      && qqqROC20 >= .08);
  const pcsRescueSelectiveQualityV88RiskExtAtr35GeOnE105 = pcsRescueSelectiveQualityV87RiskExtDrawdown05_1Vix15Roc20_8OnE99
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 3.5);
  const pcsRescueSelectiveQualityV89RiskExtAtr35Vix13OnE105 = pcsRescueSelectiveQualityV87RiskExtDrawdown05_1Vix15Roc20_8OnE99
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 3.5
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13);
  const pcsRescueSelectiveQualityV90RiskExtAtr35Vix14OnE105 = pcsRescueSelectiveQualityV87RiskExtDrawdown05_1Vix15Roc20_8OnE99
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 3.5
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 14);
  const pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111 = pcsRescueSelectiveQualityV90RiskExtAtr35Vix14OnE105
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 3.5
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .12
      && regimeData!.price_vs_sma200_pct! < .17);
  const pcsRescueSelectiveQualityV92RiskExtSma15Vix13Roc20_8OnE121 = pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13
      && qqqROC20 >= .08);
  const pcsRescueSelectiveQualityV93RiskExtVix13Roc20_8OnE121 = pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13
      && qqqROC20 >= .08);
  const pcsRescueSelectiveQualityV94RiskExtSma15Roc20_8OnE121 = pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .15
      && qqqROC20 >= .08);
  const pcsRescueSelectiveQualityV95RiskExtSma15Vix13OnE121 = pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111
    || (regime === 'RISK_ON_EXTENDED'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13);
  const pcsRescueSelectiveQualitySidewaysVixMin = Number.isFinite(params.pcsRescueSelectiveQualitySidewaysVixMin)
    ? params.pcsRescueSelectiveQualitySidewaysVixMin!
    : 22;
  const pcsRescueSelectiveQualitySidewaysRoc5Min = Number.isFinite(params.pcsRescueSelectiveQualitySidewaysRoc5Min)
    ? params.pcsRescueSelectiveQualitySidewaysRoc5Min!
    : undefined;
  const pcsRescueSelectiveQualityV96CurrentPlusSideVix22 = pcsRescueSelectiveQualityV93RiskExtVix13Roc20_8OnE121
    || (regime === 'SIDEWAYS'
      && ((Number.isFinite(regimeData?.vix ?? vix)
        && (regimeData?.vix ?? vix) >= pcsRescueSelectiveQualitySidewaysVixMin)
        || (pcsRescueSelectiveQualitySidewaysRoc5Min !== undefined
          && Number.isFinite(qqqROC5)
          && qqqROC5 >= pcsRescueSelectiveQualitySidewaysRoc5Min)));
  const pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35 = pcsRescueSelectiveQualityV96CurrentPlusSideVix22
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 30
      && regimeData!.adx14! < 35
      && Number.isFinite(qqqROC5)
      && qqqROC5 >= 0)
    || (params.pcsRescueSelectiveQualityBullVix10 === true
      && regime === 'BULL'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 10);
  const pcsRescueSelectiveQualityV98RiskExtSr02LowVixSma15Adx40VixFall = pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 40
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(csVixChange5d)
      && csVixChange5d! < 0);
  const pcsMarketVixChange5d = macro.vix5dAgo !== undefined && macro.vix5dAgo > 0
    ? (vix - macro.vix5dAgo) / macro.vix5dAgo
    : undefined;
  const pcsRescueSelectiveQualityV99RiskExtSr02LowVixSma15Adx40MarketVixFall = pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 40
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(pcsMarketVixChange5d)
      && pcsMarketVixChange5d! < 0);
  const qqqEr20 = ctx.results.volTarget?.data.qqq_er20;
  const pcsRescueSelectiveQualityV100RiskExtSr02LowVixEr50Roc5 = pcsRescueSelectiveQualityV98RiskExtSr02LowVixSma15Adx40VixFall
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 35
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .5
      && Number.isFinite(qqqROC5)
      && qqqROC5 >= .01);
  const pcsRescueSelectiveQualityV101RiskExtSr02LowVixEr40Roc5NegAdx34 = pcsRescueSelectiveQualityV100RiskExtSr02LowVixEr50Roc5
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 34
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .4
      && Number.isFinite(qqqROC5)
      && qqqROC5! < 0);
  const pcsRescueSelectiveQualityV102RiskExtSr02LowVixEr40Roc5NegAdx35 = pcsRescueSelectiveQualityV100RiskExtSr02LowVixEr50Roc5
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 35
      && Number.isFinite(regimeData?.price_vs_sma200_pct)
      && regimeData!.price_vs_sma200_pct! >= .15
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .4
      && Number.isFinite(qqqROC5)
      && qqqROC5! < 0);
  const pcsRescueSelectiveQualityV103RiskExtSr02LowVixAdx45Rv20Lt20 = pcsRescueSelectiveQualityV102RiskExtSr02LowVixEr40Roc5NegAdx35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 45
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! < .20);
  const pcsRescueSelectiveQualityV104BullEr10 = pcsRescueSelectiveQualityV103RiskExtSr02LowVixAdx45Rv20Lt20
    || (regime === 'BULL'
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .1);
  // Research-only compressed equivalent of v104: factor the repeated REXT/SR02/VIX<13 core,
  // omit v102 because its ADX>=35 branch is contained by v101's otherwise identical ADX>=34 branch.
  const pcsRescueSelectiveQualityV105CompactVix13 = pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && ((Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 40
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(csVixChange5d)
          && csVixChange5d! < 0)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 35
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .5
          && Number.isFinite(qqqROC5)
          && qqqROC5 >= .01)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 34
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .4
          && Number.isFinite(qqqROC5)
          && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 45
          && Number.isFinite(tqqqRealisedVol20d)
          && tqqqRealisedVol20d! < .20)))
    || (regime === 'BULL'
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .1);
  // Corrected compact equivalent of v104 after tracing the actual inheritance: v104 includes v98/v100/v102/v103,
  // not the separate v99 market-VIX or v101 ADX>=34 branches. Retain v102's ADX>=35 / ER<.4 / ROC5<0 pocket.
  const pcsRescueSelectiveQualityV106CompactVix13 = pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && ((Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 40
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(csVixChange5d)
          && csVixChange5d! < 0)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 35
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .5
          && Number.isFinite(qqqROC5)
          && qqqROC5 >= .01)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 35
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .4
          && Number.isFinite(qqqROC5)
          && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 45
          && Number.isFinite(tqqqRealisedVol20d)
          && tqqqRealisedVol20d! < .20)))
    || (regime === 'BULL'
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .1);
  // Research-only bottom-up ablation: remove only the independent low-VIX/high-ADX/low-RV tail.
  const pcsRescueSelectiveQualityV107CompactVix13NoRv20Tail = pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && ((Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 40
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(csVixChange5d)
          && csVixChange5d! < 0)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 35
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .5
          && Number.isFinite(qqqROC5)
          && qqqROC5 >= .01)
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! >= 35
          && Number.isFinite(regimeData?.price_vs_sma200_pct)
          && regimeData!.price_vs_sma200_pct! >= .15
          && Number.isFinite(qqqEr20)
          && qqqEr20! < .4
          && Number.isFinite(qqqROC5)
          && qqqROC5! < 0)))
    || (regime === 'BULL'
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .1);
  // Research-only broadening: retain every v106 branch and relax RV20 only on its ADX>=45 low-VIX tail.
  const pcsRescueSelectiveQualityV108CompactVix13Adx45 = pcsRescueSelectiveQualityV106CompactVix13
    || (regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) < 13
      && Number.isFinite(regimeData?.adx14)
      && regimeData!.adx14! >= 45);
  const pcsRescueResearchReleaseRiskExtSr02VixMin = params.pcsRescueResearchReleaseRiskExtSr02VixMin
    ?? (params.pcsRescueResearchReleaseRiskExtSr02Vix18 === true ? 18 : undefined);
  const pcsRescueResearchReleaseRiskExtSr02Vix = Number.isFinite(pcsRescueResearchReleaseRiskExtSr02VixMin)
    && regime === 'RISK_ON_EXTENDED'
    && slowSubregimeState === 'SR02'
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) >= pcsRescueResearchReleaseRiskExtSr02VixMin!;
  const pcsRescueResearchReleaseRiskExtSr02VixFalling5d = params.pcsRescueResearchReleaseRiskExtSr02VixFalling5d === true
    && regime === 'RISK_ON_EXTENDED'
    && slowSubregimeState === 'SR02'
    && Number.isFinite(csVixChange5d)
    && csVixChange5d! <= 0;
  const pcsRescueResearchRegimeReleaseMode = params.pcsRescueResearchRegimeReleaseMode;
  const pcsRescueResearchRegimeRelease =
    (pcsRescueResearchRegimeReleaseMode === 'vix_term_contango_scope_source_v1'
      && Number.isFinite(vix) && Number.isFinite(vix3m) && vix3m! > vix!)
    || (pcsRescueResearchRegimeReleaseMode === 'vix_term_contango_and_vix5d_falling_scope_source_v1'
      && Number.isFinite(vix) && Number.isFinite(vix3m) && vix3m! > vix!
      && Number.isFinite(csVixChange5d) && csVixChange5d! < 0)
    || (pcsRescueResearchRegimeReleaseMode === 'vix5d_falling_scope_source_v1'
      && Number.isFinite(pcsMarketVixChange5d) && pcsMarketVixChange5d! < 0)
    || (pcsRescueResearchRegimeReleaseMode === 'vix5d_nonnegative_scope_source_v1'
      && Number.isFinite(pcsMarketVixChange5d) && pcsMarketVixChange5d! >= 0)
    || (pcsRescueResearchRegimeReleaseMode === 'roc20lt0_roc5ge0_scope_source_v1'
      && Number.isFinite(qqqROC20) && qqqROC20! < 0
      && Number.isFinite(qqqROC5) && qqqROC5 >= 0)
    || (pcsRescueResearchRegimeReleaseMode === 'roc5ge0_scope_source_v1'
      && Number.isFinite(qqqROC5) && qqqROC5 >= 0)
    || (pcsRescueResearchRegimeReleaseMode === 'roc5lt0_scope_source_v1'
      && Number.isFinite(qqqROC5) && qqqROC5 < 0)
    || (pcsRescueResearchRegimeReleaseMode === 'roc20ge0_roc5lt0_scope_source_v1'
      && Number.isFinite(qqqROC20) && qqqROC20! >= 0
      && Number.isFinite(qqqROC5) && qqqROC5 < 0)
    || (pcsRescueResearchRegimeReleaseMode === 'range20ge08_roc20lt0_scope_source_v1'
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08
      && Number.isFinite(qqqROC20) && qqqROC20! < 0)
    || ((pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_v1'
      || pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_fixed25_v1'
      || pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_fixed05_v1')
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! <= 1)
    || (pcsRescueResearchRegimeReleaseMode === 'adxge24_or_trendscorele35_scope_source_v1'
      && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 24)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score! <= 35)))
    || (pcsRescueResearchRegimeReleaseMode === 'adxlt28_ma50slopege002_scope_source_v1'
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 28
      && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02)
    || (pcsRescueResearchRegimeReleaseMode === 'rv20_ge40_scope_source_v1'
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! >= .40)
    || (pcsRescueResearchRegimeReleaseMode === 'rext_sr02_rvlt50_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED'
      && slowSubregimeState === 'SR02'
      && Number.isFinite(tqqqRealisedVol20d)
      && tqqqRealisedVol20d! < .50)
    || (pcsRescueResearchRegimeReleaseMode === 'roc20_nonnegative_v1'
      && Number.isFinite(qqqROC20) && qqqROC20! >= 0)
    || (pcsRescueResearchRegimeReleaseMode === 'price_above_sma200_v1'
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= 0)
    || (pcsRescueResearchRegimeReleaseMode === 'trend_score_ge70_v1'
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score! >= 70)
    || (pcsRescueResearchRegimeReleaseMode === 'rsi14_ge50_scope_source_v1'
      && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
    || (pcsRescueResearchRegimeReleaseMode === 'rsi14_le30_scope_source_v1'
      && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! <= 30)
    || (pcsRescueResearchRegimeReleaseMode === 'rsi14_ge50_vixlt20_scope_source_v1'
      && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! < 20)
    || ((pcsRescueResearchRegimeReleaseMode === 'vxn_gt_vix_scope_source_v1'
      || pcsRescueResearchRegimeReleaseMode === 'vxn_gt_vix_scope_source_fixed05_v1')
      && Number.isFinite(macro.vxn) && Number.isFinite(macro.vix) && macro.vxn! > macro.vix!)
    || (pcsRescueResearchRegimeReleaseMode === 'er20_ge40_v1'
      && Number.isFinite(qqqEr20) && qqqEr20! >= .40)
    || (String(pcsRescueResearchRegimeReleaseMode) === 'r9_rext_sr02_vix13_17_adx20_25_rvlt50_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 17
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 20 && regimeData!.adx14! < 25
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
    || (String(pcsRescueResearchRegimeReleaseMode) === 'r9_rext_sr01_vix13_17_adxlt20_rvlt50_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 17
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
    || (String(pcsRescueResearchRegimeReleaseMode) === 'r9_rext_sr01_vix13_17_rvlt50_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 17
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
    || (pcsRescueResearchRegimeReleaseMode === 'roc5ge03_scope_source_v1'
      && Number.isFinite(qqqROC5) && qqqROC5 >= .03)
    || (pcsRescueResearchRegimeReleaseMode === 'roc5ge03_nonextended_scope_source_v1'
      && regime !== 'RISK_ON_EXTENDED'
      && Number.isFinite(qqqROC5) && qqqROC5 >= .03)
    || ((pcsRescueResearchRegimeReleaseMode === 'roc5nonneg_lt03_er15orvixle16_scope_source_v1'
      || pcsRescueResearchRegimeReleaseMode === 'roc5nonneg_lt03_er15orvixle16_scope_source_fixed25_v1'
      || pcsRescueResearchRegimeReleaseMode === 'roc5nonneg_lt03_er15orvixle16_scope_fixed25_v1')
      && Number.isFinite(qqqROC5) && qqqROC5 >= 0 && qqqROC5 < .03
      && ((Number.isFinite(qqqEr20) && qqqEr20! >= .15)
        || (Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) <= 16)))
    || (pcsRescueResearchRegimeReleaseMode === 'roc5nonneg_lt03_er15andvixle16_scope_source_v1'
      && Number.isFinite(qqqROC5) && qqqROC5 >= 0 && qqqROC5 < .03
      && Number.isFinite(qqqEr20) && qqqEr20! >= .15
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) <= 16)
    || (pcsRescueResearchRegimeReleaseMode === 'bull_sr01_vix17_20_adxge25_scope_source_v1'
      && regime === 'BULL' && slowSubregimeState === 'SR01'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 17 && (regimeData?.vix ?? vix) < 20
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 25)
    || (pcsRescueResearchRegimeReleaseMode === 'rext_sr02_vix14_17_adx25_30_rvlt50_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 14 && (regimeData?.vix ?? vix) < 17
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 25 && regimeData!.adx14! < 30
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
    || (pcsRescueResearchRegimeReleaseMode === 'rext_sr02_vix13_17_adx25_30_rvlt50_vixchange5dlt0_scope_source_v1'
      && regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 17
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 25 && regimeData!.adx14! < 30
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
      && Number.isFinite(csVixChange5d) && csVixChange5d! < 0)
    || (pcsRescueResearchRegimeReleaseMode === 'bull_sr02_vix13_15_adxge15_scope_source_v1'
      && regime === 'BULL' && slowSubregimeState === 'SR02'
      && Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 15
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15)
    || ((pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_vixle175_v1'
      || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_er20ge015_vixle175_v1'
      || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_vixle175_v1'
      || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_v1')
      && Number.isFinite(qqqROC5)
      && (qqqROC5! >= .03
        || (qqqROC5! >= 0
          && (pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_vixle175_v1'
            || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_vixle175_v1'
            || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_v1')
          && (pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_v1'
            || (Number.isFinite(qqqEr20) && qqqEr20! >= .15))
          && (pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_er20ge015_v1'
            || pcsRescueResearchRegimeReleaseMode === 'roc5ge03_or_roc5ge0_vixle175_v1'
            || ((regimeData?.vix ?? vix) <= 17.5 && Number.isFinite(regimeData?.vix ?? vix))))));
  const pcsRescueResearchComplementTiming = isPcsRescueResearchComplementTiming({
    mode: params.pcsRescueResearchComplementMode,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    rv20: tqqqRealisedVol20d,
    priceExtensionAtr,
    roc5: qqqROC5,
    roc20: qqqROC20,
    qqqEr20,
    vixChange5d: csVixChange5d,
    weakeningSignalCount: regimeData?.weakening_signal_count,
    range20dPct: regimeData?.range20d_pct,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
  });
  const pcsRescueRegimeAllowedBase = pcsRescueRegimeScope === 'core_v1'
    ? pcsRescueCoreRegime
    : pcsRescueRegimeScope === 'expanded_quality_v1'
      ? pcsRescueExpandedQuality
      : pcsRescueRegimeScope === 'selective_quality_v1'
        ? pcsRescueSelectiveQuality
        : pcsRescueRegimeScope === 'selective_quality_v2'
          ? pcsRescueSelectiveQualityV2
          : pcsRescueRegimeScope === 'selective_quality_v3'
            ? pcsRescueSelectiveQualityV3
            : pcsRescueRegimeScope === 'selective_quality_v4'
              ? pcsRescueSelectiveQualityV4
              : pcsRescueRegimeScope === 'selective_quality_v5'
                ? pcsRescueSelectiveQualityV5
                : pcsRescueRegimeScope === 'selective_quality_v6'
                  ? pcsRescueSelectiveQualityV6
                  : pcsRescueRegimeScope === 'selective_quality_v7'
                    ? pcsRescueSelectiveQualityV7
                    : pcsRescueRegimeScope === 'selective_quality_v8'
                      ? pcsRescueSelectiveQualityV8
                      : pcsRescueRegimeScope === 'selective_quality_v9'
                        ? pcsRescueSelectiveQualityV9
                        : pcsRescueRegimeScope === 'selective_quality_v10'
                          ? pcsRescueSelectiveQualityV10
                          : pcsRescueRegimeScope === 'selective_quality_v11'
                            ? pcsRescueSelectiveQualityV11
                            : pcsRescueRegimeScope === 'selective_quality_v12'
                              ? pcsRescueSelectiveQualityV12
                            : pcsRescueRegimeScope === 'selective_quality_v13'
                              ? pcsRescueSelectiveQualityV13
                              : pcsRescueRegimeScope === 'selective_quality_v14'
                              ? pcsRescueSelectiveQualityV14
                                : pcsRescueRegimeScope === 'selective_quality_v15'
                                  ? pcsRescueSelectiveQualityV15
                                  : pcsRescueRegimeScope === 'selective_quality_v16_atr'
                                    ? pcsRescueSelectiveQualityV16Atr
                                    : pcsRescueRegimeScope === 'selective_quality_v17_no_tail_d'
                                      ? pcsRescueSelectiveQualityV17NoTailD
                                    : pcsRescueRegimeScope === 'selective_quality_v18_no_tail_e'
                                      ? pcsRescueSelectiveQualityV18NoTailE
                                    : pcsRescueRegimeScope === 'selective_quality_v19_range_all'
                                      ? pcsRescueSelectiveQualityV19RangeAll
    : pcsRescueRegimeScope === 'selective_quality_v20_merge_tail_de'
      ? pcsRescueSelectiveQualityV20MergeTailDE
      : pcsRescueRegimeScope === 'selective_quality_v21_side_ext_compact'
        ? pcsRescueSelectiveQualityV21SideExtCompact
      : pcsRescueRegimeScope === 'selective_quality_v22_side_compact'
        ? pcsRescueSelectiveQualityV22SideCompact
      : pcsRescueRegimeScope === 'selective_quality_v23_side_rv85'
        ? pcsRescueSelectiveQualityV23SideRv85
      : pcsRescueRegimeScope === 'selective_quality_v24_no_tail_a'
        ? pcsRescueSelectiveQualityV24NoTailA
      : pcsRescueRegimeScope === 'selective_quality_v25_no_tail_b'
        ? pcsRescueSelectiveQualityV25NoTailB
      : pcsRescueRegimeScope === 'selective_quality_v26_no_tail_c'
        ? pcsRescueSelectiveQualityV26NoTailC
      : pcsRescueRegimeScope === 'selective_quality_v27_side_rv86'
        ? pcsRescueSelectiveQualityV27SideRv86
      : pcsRescueRegimeScope === 'selective_quality_v28_side_rv87'
        ? pcsRescueSelectiveQualityV28SideRv87
      : pcsRescueRegimeScope === 'selective_quality_v29_side_rv90'
        ? pcsRescueSelectiveQualityV29SideRv90
      : pcsRescueRegimeScope === 'selective_quality_v30_side_rv8625'
        ? pcsRescueSelectiveQualityV30SideRv8625
      : pcsRescueRegimeScope === 'selective_quality_v31_side_rv865'
        ? pcsRescueSelectiveQualityV31SideRv865
      : pcsRescueRegimeScope === 'selective_quality_v32_side_rv8675'
        ? pcsRescueSelectiveQualityV32SideRv8675
      : pcsRescueRegimeScope === 'selective_quality_v33_side_rv87_alias'
        ? pcsRescueSelectiveQualityV33SideRv87Alias
      : pcsRescueRegimeScope === 'selective_quality_v34_side_ext_atr2'
        ? pcsRescueSelectiveQualityV34SideExtAtr2
      : pcsRescueRegimeScope === 'selective_quality_v35_side_ext_adx30_atr2'
        ? pcsRescueSelectiveQualityV35SideExtAdx30Atr2
      : pcsRescueRegimeScope === 'selective_quality_v36_risk_ext_atr2_adx_lt30'
        ? pcsRescueSelectiveQualityV36RiskExtAtr2AdxLt30
      : pcsRescueRegimeScope === 'selective_quality_v37_risk_ext_atr2_adx_lt20'
        ? pcsRescueSelectiveQualityV37RiskExtAtr2AdxLt20
      : pcsRescueRegimeScope === 'selective_quality_v38_risk_ext_adx_lt30'
        ? pcsRescueSelectiveQualityV38RiskExtAdxLt30
      : pcsRescueRegimeScope === 'selective_quality_v39_risk_ext_atr225_adx_lt20'
        ? pcsRescueSelectiveQualityV39RiskExtAtr225AdxLt20
      : pcsRescueRegimeScope === 'selective_quality_v40_risk_ext_atr25_adx_lt20'
        ? pcsRescueSelectiveQualityV40RiskExtAtr25AdxLt20
      : pcsRescueRegimeScope === 'selective_quality_v41_risk_ext_atr3_adx_lt20'
        ? pcsRescueSelectiveQualityV41RiskExtAtr3AdxLt20
      : pcsRescueRegimeScope === 'selective_quality_v42_risk_ext_adx_lt20'
        ? pcsRescueSelectiveQualityV42RiskExtAdxLt20
      : pcsRescueRegimeScope === 'selective_quality_v43_risk_ext_adx_lt21'
        ? pcsRescueSelectiveQualityV43RiskExtAdxLt21
      : pcsRescueRegimeScope === 'selective_quality_v44_risk_ext_adx_lt22'
        ? pcsRescueSelectiveQualityV44RiskExtAdxLt22
      : pcsRescueRegimeScope === 'selective_quality_v45_risk_ext_adx_lt25'
        ? pcsRescueSelectiveQualityV45RiskExtAdxLt25
      : pcsRescueRegimeScope === 'selective_quality_v46_bull_tail_atr_nonnegative'
        ? pcsRescueSelectiveQualityV46BullTailAtrNonnegative
      : pcsRescueRegimeScope === 'selective_quality_v47_side_rv100_adx_ge20'
        ? pcsRescueSelectiveQualityV47SideRv100AdxGe20
      : pcsRescueRegimeScope === 'selective_quality_v48_side_adx_ge20'
        ? pcsRescueSelectiveQualityV48SideAdxGe20
      : pcsRescueRegimeScope === 'selective_quality_v49_bull_tail_no_adx'
        ? pcsRescueSelectiveQualityV49BullTailNoAdx
      : pcsRescueRegimeScope === 'selective_quality_v50_bull_tail_atr_ge_neg025'
        ? pcsRescueSelectiveQualityV50BullTailAtrGeNeg025
      : pcsRescueRegimeScope === 'selective_quality_v51_bull_tail_atr_ge_neg05'
        ? pcsRescueSelectiveQualityV51BullTailAtrGeNeg05
      : pcsRescueRegimeScope === 'selective_quality_v52_bull_tail_atr_ge_neg1'
        ? pcsRescueSelectiveQualityV52BullTailAtrGeNeg1
      : pcsRescueRegimeScope === 'selective_quality_v53_side_mid_adx_rv90'
        ? pcsRescueSelectiveQualityV53SideMidAdxRv90
      : pcsRescueRegimeScope === 'selective_quality_v54_side_mid_adx_rv95'
        ? pcsRescueSelectiveQualityV54SideMidAdxRv95
      : pcsRescueRegimeScope === 'selective_quality_v55_side_mid_adx_rv100'
        ? pcsRescueSelectiveQualityV55SideMidAdxRv100
      : pcsRescueRegimeScope === 'selective_quality_v56_side_adx_ge16'
        ? pcsRescueSelectiveQualityV56SideAdxGe16
      : pcsRescueRegimeScope === 'selective_quality_v57_side_adx_ge14'
        ? pcsRescueSelectiveQualityV57SideAdxGe14
      : pcsRescueRegimeScope === 'selective_quality_v58_side_adx14_atr2'
        ? pcsRescueSelectiveQualityV58SideAdx14Atr2
      : pcsRescueRegimeScope === 'selective_quality_v59_bull_adx_ge13'
        ? pcsRescueSelectiveQualityV59BullAdxGe13
      : pcsRescueRegimeScope === 'selective_quality_v60_range_atr225'
        ? pcsRescueSelectiveQualityV60RangeAtr225
      : pcsRescueRegimeScope === 'selective_quality_v61_range_atr25'
        ? pcsRescueSelectiveQualityV61RangeAtr25
      : pcsRescueRegimeScope === 'selective_quality_v62_risk_ext_adx_lt30_atr2'
        ? pcsRescueSelectiveQualityV62RiskExtAdxLt30Atr2
      : pcsRescueRegimeScope === 'selective_quality_v63_side_adx12_atr2_roc5ge0'
        ? pcsRescueSelectiveQualityV63SideAdx12Atr2Roc5Ge0
      : pcsRescueRegimeScope === 'selective_quality_v64_side_adx12_atr2'
        ? pcsRescueSelectiveQualityV64SideAdx12Atr2
      : pcsRescueRegimeScope === 'selective_quality_v65_side_adx12_roc5ge0'
        ? pcsRescueSelectiveQualityV65SideAdx12Roc5Ge0
      : pcsRescueRegimeScope === 'selective_quality_v66_side_atr2_roc5ge0'
        ? pcsRescueSelectiveQualityV66SideAtr2Roc5Ge0
      : pcsRescueRegimeScope === 'selective_quality_v67_risk_ext_sma_ge19'
        ? pcsRescueSelectiveQualityV67RiskExtSmaGe19
      : pcsRescueRegimeScope === 'selective_quality_v68_risk_ext_sma_ge20'
        ? pcsRescueSelectiveQualityV68RiskExtSmaGe20
      : pcsRescueRegimeScope === 'selective_quality_v69_risk_ext_sma_ge22'
        ? pcsRescueSelectiveQualityV69RiskExtSmaGe22
      : pcsRescueRegimeScope === 'selective_quality_v70_combined_e70_sma22'
        ? pcsRescueSelectiveQualityV70CombinedE70Sma22
      : pcsRescueRegimeScope === 'selective_quality_v71_combined_sma21'
        ? pcsRescueSelectiveQualityV71CombinedSma21
      : pcsRescueRegimeScope === 'selective_quality_v72_slim_no_bull_tail'
        ? pcsRescueSelectiveQualityV72SlimNoBullTail
      : pcsRescueRegimeScope === 'selective_quality_v73_slim_preserve_core_bull_tail'
        ? pcsRescueSelectiveQualityV73SlimPreserveCoreBullTail
      : pcsRescueRegimeScope === 'selective_quality_v74_risk_ext_roc5_lt0'
        ? pcsRescueSelectiveQualityV74RiskExtRoc5Lt0
      : pcsRescueRegimeScope === 'selective_quality_v75_risk_ext_sma15_roc5_lt0'
        ? pcsRescueSelectiveQualityV75RiskExtSma15Roc5Lt0
      : pcsRescueRegimeScope === 'selective_quality_v76_risk_ext_sma17_roc5_lt0'
        ? pcsRescueSelectiveQualityV76RiskExtSma17Roc5Lt0
      : pcsRescueRegimeScope === 'selective_quality_v77_risk_ext_weakening_ge1'
        ? pcsRescueSelectiveQualityV77RiskExtWeakeningGe1
      : pcsRescueRegimeScope === 'selective_quality_v78_risk_ext_weakening_sma9'
        ? pcsRescueSelectiveQualityV78RiskExtWeakeningSma9
      : pcsRescueRegimeScope === 'selective_quality_v79_risk_ext_weakening_momentum'
        ? pcsRescueSelectiveQualityV79RiskExtWeakeningMomentum
      : pcsRescueRegimeScope === 'selective_quality_v80_risk_ext_weakening_roc20'
        ? pcsRescueSelectiveQualityV80RiskExtWeakeningRoc20
      : pcsRescueRegimeScope === 'selective_quality_v81_risk_ext_weakening_drawdown'
        ? pcsRescueSelectiveQualityV81RiskExtWeakeningDrawdown
      : pcsRescueRegimeScope === 'selective_quality_v82_risk_ext_drawdown05_1_vix15'
        ? pcsRescueSelectiveQualityV82RiskExtDrawdown05_1Vix15
      : pcsRescueRegimeScope === 'selective_quality_v83_risk_ext_drawdown05_1_vix15_atr35'
        ? pcsRescueSelectiveQualityV83RiskExtDrawdown05_1Vix15Atr35
      : pcsRescueRegimeScope === 'selective_quality_v84_risk_ext_drawdown05_1_vix15_atr35_no_weakening'
        ? pcsRescueSelectiveQualityV84RiskExtDrawdown05_1Vix15Atr35NoWeakening
      : pcsRescueRegimeScope === 'selective_quality_v85_risk_ext_drawdown05_1_vix15_atr35_no_weakening_ablation'
        ? pcsRescueSelectiveQualityV85RiskExtDrawdown05_1Vix15Atr35NoWeakeningAblation
      : pcsRescueRegimeScope === 'selective_quality_v86_risk_ext_drawdown05_1_vix15_roc20_8'
        ? pcsRescueSelectiveQualityV86RiskExtDrawdown05_1Vix15Roc20_8
      : pcsRescueRegimeScope === 'selective_quality_v87_risk_ext_drawdown05_1_vix15_roc20_8_on_e99'
        ? pcsRescueSelectiveQualityV87RiskExtDrawdown05_1Vix15Roc20_8OnE99
      : pcsRescueRegimeScope === 'selective_quality_v88_risk_ext_atr35_ge_on_e105'
        ? pcsRescueSelectiveQualityV88RiskExtAtr35GeOnE105
      : pcsRescueRegimeScope === 'selective_quality_v89_risk_ext_atr35_vix13_on_e105'
        ? pcsRescueSelectiveQualityV89RiskExtAtr35Vix13OnE105
      : pcsRescueRegimeScope === 'selective_quality_v90_risk_ext_atr35_vix14_on_e105'
        ? pcsRescueSelectiveQualityV90RiskExtAtr35Vix14OnE105
      : pcsRescueRegimeScope === 'selective_quality_v91_risk_ext_atr35_sma12_17_on_e111'
        ? pcsRescueSelectiveQualityV91RiskExtAtr35Sma12_17OnE111
      : pcsRescueRegimeScope === 'selective_quality_v92_risk_ext_sma15_vix13_roc20_8_on_e121'
        ? pcsRescueSelectiveQualityV92RiskExtSma15Vix13Roc20_8OnE121
      : pcsRescueRegimeScope === 'selective_quality_v93_risk_ext_vix13_roc20_8_on_e121'
        ? pcsRescueSelectiveQualityV93RiskExtVix13Roc20_8OnE121
      : pcsRescueRegimeScope === 'selective_quality_v94_risk_ext_sma15_roc20_8_on_e121'
        ? pcsRescueSelectiveQualityV94RiskExtSma15Roc20_8OnE121
      : pcsRescueRegimeScope === 'selective_quality_v95_risk_ext_sma15_vix13_on_e121'
        ? pcsRescueSelectiveQualityV95RiskExtSma15Vix13OnE121
      : pcsRescueRegimeScope === 'selective_quality_v96_current_plus_side_vix22'
        ? pcsRescueSelectiveQualityV96CurrentPlusSideVix22
      : pcsRescueRegimeScope === 'selective_quality_v97_current_plus_side_vix19_roc5_02_riskext_sr02_adx30_35_roc5ge0'
        ? pcsRescueSelectiveQualityV97CurrentPlusSideVix19Roc5_02RiskExtSr02Adx30_35
      : pcsRescueRegimeScope === 'selective_quality_v98_risk_ext_sr02_lowvix_sma15_adx40_vixfall'
        ? pcsRescueSelectiveQualityV98RiskExtSr02LowVixSma15Adx40VixFall
      : pcsRescueRegimeScope === 'selective_quality_v99_risk_ext_sr02_lowvix_sma15_adx40_marketvixfall'
        ? pcsRescueSelectiveQualityV99RiskExtSr02LowVixSma15Adx40MarketVixFall
      : pcsRescueRegimeScope === 'selective_quality_v100_risk_ext_sr02_lowvix_er50_roc5'
        ? pcsRescueSelectiveQualityV100RiskExtSr02LowVixEr50Roc5
      : pcsRescueRegimeScope === 'selective_quality_v101_risk_ext_sr02_lowvix_er40_roc5neg_adx34'
        ? pcsRescueSelectiveQualityV101RiskExtSr02LowVixEr40Roc5NegAdx34
      : pcsRescueRegimeScope === 'selective_quality_v102_risk_ext_sr02_lowvix_er40_roc5neg_adx35'
        ? pcsRescueSelectiveQualityV102RiskExtSr02LowVixEr40Roc5NegAdx35
      : pcsRescueRegimeScope === 'selective_quality_v103_risk_ext_sr02_lowvix_adx45_rv20_lt20'
        ? pcsRescueSelectiveQualityV103RiskExtSr02LowVixAdx45Rv20Lt20
      : pcsRescueRegimeScope === 'selective_quality_v104_bull_er10'
        ? pcsRescueSelectiveQualityV104BullEr10
      : pcsRescueRegimeScope === 'selective_quality_v105_compact_vix13'
        ? pcsRescueSelectiveQualityV105CompactVix13
      : pcsRescueRegimeScope === 'selective_quality_v106_compact_vix13'
        ? pcsRescueSelectiveQualityV106CompactVix13
      : pcsRescueRegimeScope === 'selective_quality_v107_compact_vix13_no_rv20tail'
        ? pcsRescueSelectiveQualityV107CompactVix13NoRv20Tail
      : pcsRescueRegimeScope === 'selective_quality_v108_compact_vix13_adx45'
        ? pcsRescueSelectiveQualityV108CompactVix13Adx45
        : true;
  const pcsRescueRegimeAllowed = pcsRescueRegimeAllowedBase || pcsRescueResearchReleaseRiskExtSr02Vix || pcsRescueResearchReleaseRiskExtSr02VixFalling5d || pcsRescueResearchRegimeRelease || pcsRescueResearchComplementTiming;
  const rescueRangeWeak = regime === 'RANGE_BOUND' && (regimeData?.weakening_signal_count ?? 0) >= 3;
  const rescueRangeVix = regime === 'RANGE_BOUND' && (regimeData?.vix ?? vix) >= 19;
  const pcsRescueRangeQualityFilterBlocked =
    (params.pcsRescueRangeQualityFilter === 'rangeWeakVix' && rescueRangeWeak && rescueRangeVix)
    || (params.pcsRescueRangeQualityFilter === 'rangeWeak' && rescueRangeWeak)
    || (params.pcsRescueRangeQualityFilter === 'rangeVix' && rescueRangeVix)
    || (params.pcsRescueRangeQualityFilter === 'rangeWeak4Vix'
      && regime === 'RANGE_BOUND'
      && (regimeData?.weakening_signal_count ?? 0) >= 4
      && (regimeData?.vix ?? vix) >= 19);
  const pcsRescueResearchEntryRelease = (params.pcsRescueResearchEntryReleaseMode === 'roc5_floor_v1'
    && Number.isFinite(qqqROC5)
    && qqqROC5 >= (params.pcsRescueResearchEntryReleaseRoc5Min ?? .03))
    || (params.pcsRescueResearchEntryReleaseMode === 'roc5_nonnegative_v1'
      && Number.isFinite(qqqROC5)
      && qqqROC5 >= 0)
    || (params.pcsRescueResearchEntryReleaseMode === 'e182_source_quality_v1'
      && Number.isFinite(qqqROC5)
      && qqqROC5 >= 0
      && ((Number.isFinite(qqqEr20) && qqqEr20! >= .15)
        || (Number.isFinite(vix) && vix <= 16)));
  const pcsRescueSourceActive = params.pcsRescueEnabled === true
    && pcsSafetyConditionsMet
    && !pcsStreakCooldownBlocked
    && !equity_boost_triggered
    && !pcsRescueRangeQualityFilterBlocked
    && pcsRescueRegimeAllowed
    && (pcsRescueEntryMode === 'reactive_soft_pool'
      ? (pcsRescueSoftTiming || pcsRescueResearchComplementTiming || pcsOriginalSignal || pcsPageSignal || pcsRescueResearchEntryRelease || pcsRescueResearchRegimeRelease)
      : (pcsOriginalSignal || pcsPageSignal));
  if (equity_boost_triggered) {
    warnings.push(`QQQ Equity Boost Put Spread [${equityBoostEntryMode}]：VIX=${vix.toFixed(1)}，QQQ ROC5=${(qqqROC5 * 100).toFixed(1)}%，regime=${regime}`);
  }
  if (equityBoostBass221Blocked) {
    warnings.push('Equity Boost 2.2.1 研究闸：BULL/SR01/SR02 + VIX/RV20/回撤/ROC20 条件，跳过新开');
  }
  if (equityBoostBass221VixReboundBlocked) {
    warnings.push('Equity Boost 2.2.1 候选闸：RANGE_BOUND/SR01 + VIX五日上涨 + ROC5短期转强，跳过新开');
  }
  if (equityBoostCandidate6GateBlocked) {
    warnings.push('Equity Boost 候选6-MDD核心闸：严格 B / micro / 高 VIX / 高位弱趋势状态，跳过新开');
  }
  if (equityBoostBass221SeverityActive) {
    warnings.push(`Equity Boost 2.2.1 严重度：RV20≥50%且20日区间≥6.5%，风险预算缩放${((params.equityBoostBass221SeverityMultiplier ?? 1) * 100).toFixed(0)}%`);
  }
  if (ebRiskOnWeakeningSr01VolGateBlocked) {
    warnings.push('QQQ Equity Boost：RISK_ON_WEAKENING/SR01 的 VXN/VIX 或 VXN 10 日上升闸未通过，跳过新开');
  }

  // Build collar diagnostic — useful for UI and debugging
  const collarEligibilityScenario: NonNullable<OverlayData['collarEligibility']>['scenario'] = collarEligibilityEvaluation.scenario;
  const collarEligibility = {
    eligible: collar_triggered,
    reason: collar_triggered
      ? sellAlternativeScenario
        ? `Collar 替代减仓：${leveragedSymbol} 实际仓位 ${(actualLevPct * 100).toFixed(1)}% 超目标 ${(final_tqqq_pct * 100).toFixed(1)}% 达 ${((actualLevPct - final_tqqq_pct) * 100).toFixed(1)}pp，建议优先减仓`
        : `Collar 触发 [${collarMode}]：${leveragedSymbol} 有效仓位 ${(effectiveLevPct * 100).toFixed(1)}%, regime=${regime}`
      : !enableCollar ? 'Collar 已禁用'
      : !hasLargePosition && collarMode !== 'always' ? `${leveragedSymbol} 仓位不足警戒线（${(effectiveLevPct * 100).toFixed(1)}% < ${(TQQQ_LARGE_POSITION_PCT * 100).toFixed(0)}%）`
      : `未触发：regime=${regime}, collarMode=${collarMode}`,
    scenario: collarEligibilityScenario,
    currentLeveragedWeight: effectiveLevPct,
    targetLeveragedWeight: final_tqqq_pct,
    hasActiveCollar: hasOpenCollar,
    hasActiveCollarProtection: hasOpenCollar,
    hasActiveCollarShortCall: hasOpenCollarShortCall,
    hasActiveQQQCallSpread: hasOpenQQQCallSpread,
  };
  const preferredAction = sellAlternativeScenario ? `SELL_${leveragedSymbol}` : undefined;
  const alternativeAction = sellAlternativeScenario ? 'OPEN_PUT_SPREAD_COLLAR' : undefined;
  if (sellAlternativeScenario) {
    warnings.push(
      `${leveragedSymbol} 超仓 ${((actualLevPct - final_tqqq_pct) * 100).toFixed(1)}pp（实际 ${(actualLevPct * 100).toFixed(1)}% vs 目标 ${(final_tqqq_pct * 100).toFixed(1)}%），建议优先减仓；Collar 作为替代保护`
    );
  }

  if (hasOpenCollarShortCall && enableCS && !collar_triggered && (regime === 'BULL' || regime === 'RISK_ON_EXTENDED')) {
    warnings.push(`市场过热（TQQQ ROC20=${(tqqqROC20 * 100).toFixed(1)}%）但已有 Collar Short Call，禁止叠加 QQQ Call Spread（Rule 6：避免重复卖出上行敞口）`);
  }
  if (call_spread_triggered) {
    warnings.push(`TQQQ 近20天涨幅 ${(tqqqROC20 * 100).toFixed(1)}%，QQQ 近5天涨幅 ${(qqqROC5 * 100).toFixed(1)}%，VIX=${vix.toFixed(1)} 低位，${regime}，开 QQQ Call Spread（proxyOverlay）`);
  }
  if (call_spread_secondary_triggered) {
    warnings.push(`TQQQ 近20天涨幅 ${(tqqqROC20 * 100).toFixed(1)}%，VIX=${vix.toFixed(1)}，${regime}，主层 cap1 阻断，转独立 CS 副层（proxyOverlay）`);
  }
  if (call_spread_coverage_triggered) {
    warnings.push(`CS 高胜率覆盖层：预危机 cap1 阻断，进入 pre_crisis_coverage（主层账本不变）`);
  }
  if (call_spread_secondary2_triggered) {
    warnings.push(`CS 独立副层 v2：主层今日未开单，独立触发（不依赖主层 cap1，proxyOverlay）`);
  }
  if (pcs_triggered_final) {
    warnings.push(`TQQQ 近20天涨幅 ${(tqqqROC20 * 100).toFixed(1)}%，VIX=${vix.toFixed(1)}，${regime}，开 QQQ Put Credit Spread（proxyOverlay）`);
  }
  // ── Iron Condor trigger ───────────────────────────────────────────────────
  const icMode = params.icMode;
  const icCfg  = IC_MODE_CONFIG[icMode];
  const icMaxConcurrent = params.icMaxConcurrent;

  const range20d = indicators.require<{ high: number; low: number }>('qqq_range20').value;
  const distToHigh = range20d.high > 0 ? (range20d.high - spot) / spot : 1;
  const distToLow  = range20d.low  > 0 ? (spot - range20d.low)  / spot : 1;

  const tooCloseToTop    = distToHigh < icCfg.edgePct;
  const tooCloseToBottom = distToLow  < icCfg.edgePct;

  // SIDEWAYS only allowed when price is above SMA200 (avoid below-SMA200 SIDEWAYS)
  const price_vs_sma200_pct = ctx.results.regime?.data.price_vs_sma200_pct ?? 0;
  const icRegimeOk =
    icCfg.regimes.includes(regime) &&
    (regime !== 'SIDEWAYS' || price_vs_sma200_pct > 0);

  const iron_condor_triggered = evaluateIronCondorCandidate({
    enabled: enableIC,
    regimeAllowed: icRegimeOk,
    pendingCollarHasShortCall,
    hasOpenCollarShortCall,
    callSpreadTriggered: effectiveCallSpreadTriggered,
    openCount: openICCount,
    maxConcurrent: icMaxConcurrent,
    vix,
    vixMin: icCfg.vixMin,
    vixMax: icCfg.vixMax,
    tooCloseToTop,
    tooCloseToBottom,
  });

  if (icCfg.regimes.includes(regime) && (tooCloseToTop || tooCloseToBottom)) {
    warnings.push(
      `${regime} 但 QQQ 距20日区间${tooCloseToTop ? '上沿' : '下沿'}仅 ${((tooCloseToTop ? distToHigh : distToLow) * 100).toFixed(1)}%，暂缓开 Iron Condor`
    );
  }

  // ── Bear Market Overlay trigger (BEAR_RALLY plus opt-in alternate modes) ─
  // Priority: CRISIS/DataQuality/Regime gates → RiskBudget → Collar → RANGE_BOUND IC
  // → BearCS → BULL overheat CS.
  const bearCallCoordination = coordinateBearCallSpread({
    pendingCollarHasShortCall,
    hasOpenCollarShortCall,
    ironCondorTriggered: iron_condor_triggered,
    bearAction: bearOverlay.action,
  });

  if (bearCallCoordination.propagateWarnings) {
    warnings.push(...bearOverlay.warnings);
  }
  const bear_call_spread_triggered = bearCallCoordination.triggered;
  const primaryAction = resolveOverlayActionPriority({
    collarTriggered: collar_triggered,
    ironCondorTriggered: iron_condor_triggered,
    bearCallSpreadTriggered: bear_call_spread_triggered,
    bearAction: bearOverlay.action,
    bearSkipEligible: ctx.results.regime?.data.bearMarketPhase === 'CRISIS',
    callSpreadTriggered: call_spread_triggered || call_spread_coverage_triggered,
    equityBoostTriggered: equity_boost_triggered,
    putSpreadTriggered: pcs_triggered_final,
    pcsRescueTriggered: pcsRescueSourceActive,
  });

  // ── Build action & strikes ────────────────────────────────────────────────
  let action: OverlayAction = 'NONE';
  let proposed_strikes: OverlayData['proposed_strikes'];
  let premium_estimate: number | undefined;
  let iron_condor_max_risk_pct: number | undefined;
  let iron_condor_max_contracts: number | undefined;
  let ironCondorMeta: OverlayData['ironCondor'] | undefined;
  let cs_max_risk_pct: number | undefined;
  let bearCallSpread: OverlayData['bearCallSpread'] | undefined;
  let equityBoostPutSpread: OverlayData['equityBoostPutSpread'] | undefined;
  let selectedProposal: OverlayProposal | undefined;

  const buildCallSpreadProposal = (): OverlayProposal | undefined => {
    const coverageTier: CSSecondaryCoverageTier | undefined = call_spread_coverage_pre_crisis_triggered
      ? 'pre_crisis_coverage'
      : call_spread_coverage_normal_triggered
        ? 'normal_coverage'
      : undefined;
    const secondaryRouteActive = (call_spread_secondary_triggered || coverageTier !== undefined || call_spread_secondary2_triggered) && !call_spread_triggered;
    // GS：击穿后重开折扣-爬升，默认参数恒为 1.0；仅作用于主 CS 腿（BearCS 独立预算体系且默认关闭）
    const csSizeMultiplier = computeCSSizeMultiplier(csBreachState, params.csBreachSizeDiscount ?? 1.0, params.csBreachSizeRampCloses ?? 0);
    const csEventRiskMultiplier = (csPreCrisisActive ? (params.csPreCrisisRiskMultiplier ?? 1) : 1)
      * resolveCallCreditSpreadRegimeRiskMultiplier({ regime, multipliers: params.csRiskMultiplierByRegime })
      * resolveCallCreditSpreadVixRiskMultiplier({
        vix: macro.vix,
        minVix: params.csResearchRiskMultiplierVixMin,
        multiplier: params.csResearchRiskMultiplierVixAbove,
      });
    const vxnHistory = macro.vxnHistory;
    const vxnChange5d = ctx.input.csResearchVixChange5d
      ?? (vxnHistory && vxnHistory.length >= 6 && (vxnHistory.at(-6) ?? 0) > 0
        ? ((vxnHistory.at(-1) ?? 0) - vxnHistory.at(-6)!) / vxnHistory.at(-6)!
        : undefined);
    const csVxnRescueSizeMultiplier = secondaryRouteActive
      ? 1
      : resolveCallCreditSpreadVxnRescueSizeMultiplier({
        configuredMultiplier: params.csVxnRescueSizeMultiplier,
        vxn: ctx.input.csResearchVxn ?? macro.vxn,
        qqqRoc20: qqqROC20,
        vixChange5d: vxnChange5d,
        minVxn: params.csResearchVxnRescueMinVix,
        vixChange5dMin: params.csResearchVxnRescueVixChangeMin,
      });
    const secondaryShortDelta = Math.min(.45, Math.max(.05, params.csSecondaryShortDelta ?? .10));
    const baseShortDelta = secondaryRouteActive
      ? secondaryShortDelta
      : resolveCallCreditSpreadShortDelta({ mode: csMode, regime, vix, tqqqRoc20: tqqqROC20, fixedShortDelta: params.csShortDelta, spLikeShortDelta: params.csSpLikeShortDelta, dynamicCalmVix: params.csSpLikeDynamicCalmVix, dynamicCalmRoc20: params.csSpLikeDynamicCalmRoc20, dynamicCalmDelta: params.csSpLikeDynamicCalmDelta, dynamicCalmDeltaRegimeScope: params.csSpLikeDynamicCalmDeltaRegimeScope, dynamicWeakDelta: params.csSpLikeDynamicWeakDelta, vxnRescueDelta: params.csResearchVxnRescueDelta, vxnRescueMinVix: params.csResearchVxnRescueMinVix, vxnRescueMaxVix: params.csResearchVxnRescueMaxVix, vxnRescueVixChangeMin: params.csResearchVxnRescueVixChangeMin, vxn: ctx.input.csResearchVxn, qqqRoc20: qqqROC20, vixChange5d: ctx.input.csResearchVixChange5d });
    const slowTrendForSelection = isCallCreditSpreadSlowTrend({
      regime,
      vix,
      vix3m,
      tqqqRoc20: tqqqROC20,
      sma20SlopePct: qqqSma20SlopePct,
      qqqRoc5: qqqROC5,
      qqqRoc20: qqqROC20,
      vixMax: params.csSlowTrendVixMax,
      slopeMinPct: params.csSlowTrendSlopeMinPct,
      qqqRoc20Min: params.csSlowTrendQqqRoc20Min,
      qqqRoc5Max: params.csSlowTrendQqqRoc5Max,
      blockExtended: params.csSlowTrendBlockExtended,
      extendedTqqqRoc20Min: params.csSlowTrendExtendedTqqqRoc20Min,
    });
    const fastAccelerationForSelection = isCallCreditSpreadFastAcceleration({
      regime,
      sma20SlopePct: qqqSma20SlopePct,
      qqqRoc5: qqqROC5,
      qqqRoc20: qqqROC20,
      roc5Min: params.csSlowTrendFastAccelerationRoc5,
      slopeMinPct: params.csSlowTrendFastAccelerationSlopePct,
    });
    const shortDelta = resolveCallCreditSpreadSlopeShortDelta({
      mode: params.csSlopeShortLegMode,
      baseDelta: baseShortDelta,
      sma20SlopePct: qqqSma20SlopePct,
      qqqRoc5: qqqROC5,
      qqqRoc20: qqqROC20,
      slowTrend: slowTrendForSelection && !fastAccelerationForSelection,
      slowTrendOnly: params.csSlopeShortLegSlowTrendOnly,
      fastSlopePct: params.csSlopeShortLegFastSlopePct,
      fastDelta: params.csSlopeShortLegFastDelta,
      slowDelta: params.csSlopeShortLegSlowDelta,
    });
    const csSurvivalStateMode: CSSurvivalSelectionStateMode = params.csSurvivalSelectionStateMode ?? 'all';
    const csHighPressure = isCallCreditSpreadHighPressure({
      regime,
      vix,
      tqqqRoc20: tqqqROC20,
      riskVix: params.csDeltaStopRiskVix,
      calmRoc20: params.csDeltaStopCalmRoc20,
    });
  const csSurvivalStateActive = csSurvivalStateMode === 'all'
    || (csSurvivalStateMode === 'stress_only' && csHighPressure)
    || (csSurvivalStateMode === 'stress_or_pre_crisis' && (csHighPressure || csPreCrisisActive))
    || (csSurvivalStateMode === 'pre_crisis_only' && csPreCrisisActive);
    const baseTargetDte = params.csTargetDte ?? SPREAD_TARGET_DTE;
    const qqqRv20 = indicators.require<number>('qqq_rv20');
    const buildHighWinCoverageProposal = (tier: CSSecondaryCoverageTier): OverlayProposal | undefined => {
      const isPreCrisis = tier === 'pre_crisis_coverage';
      const configuredSelectionMode = params.csSecondaryCoverageSelectionMode ?? 'survival_priority';
      const riskEfficiencyWidthSearch = configuredSelectionMode === 'risk_efficiency_width_search_v1' && !isPreCrisis;
      const sr02CalmAdaptiveSelector = configuredSelectionMode === 'sr02_calm_survival_priority_v1'
        && !isPreCrisis
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < 18
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= 0
        && priceExtensionAtr! < 1;
      const extensionQualityAdaptiveSelector = configuredSelectionMode === 'extension_quality_survival_v1'
        && !isPreCrisis
        && coverageExtensionQualityReleased;
      const fixedThenSurvivalFallback = configuredSelectionMode === 'extension_quality_fixed_then_survival_fallback_v1'
        && !isPreCrisis
        && coverageExtensionQualityReleased;
      const sr02CalmUltraTailFallback = configuredSelectionMode === 'sr02_calm_ultra_tail_fallback_v1'
        && !isPreCrisis
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < 18;
      const sr02CalmSigmaFallback = configuredSelectionMode === 'sr02_calm_sigma_fallback_v1'
        && !isPreCrisis
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < 18;
      const selectionMode = configuredSelectionMode === 'risk_efficiency_width_search_v1'
        ? isPreCrisis ? 'fixed' : 'survival_priority'
        : configuredSelectionMode === 'sr02_calm_survival_priority_v1'
        ? sr02CalmAdaptiveSelector ? 'survival_priority' : 'fixed'
        : extensionQualityAdaptiveSelector
          ? 'survival_priority'
          : fixedThenSurvivalFallback
            ? 'fixed'
          : configuredSelectionMode === 'sr02_calm_sigma_fallback_v1'
            ? 'fixed'
          : sr02CalmUltraTailFallback
            ? 'fixed'
          : configuredSelectionMode;
      const configuredNormalFloor = params.csSecondaryCoverageSurvivalFloor ?? .70;
      const normalFloorMode = params.csSecondaryCoverageNormalFloorMode ?? 'fixed';
      const nonBullRelaxed = normalFloorMode === 'non_bull_relaxed_v1'
        || normalFloorMode === 'non_bull_or_bull_extension_band_v1'
        || normalFloorMode === 'non_bull_or_bull_low_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_high_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_er20_cap_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_extension_cap_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_term_structure_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_stable_term_structure_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_quiet_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_bull_quiet_vix_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_er20_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_roc20_v1'
        || normalFloorMode === 'non_bull_or_bull_bull_low_vix_v1'
        || normalFloorMode === 'non_bull_or_bull_bull_low_vix_contango_v1'
        || normalFloorMode === 'non_bull_or_bull_vix_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_term_quality_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_calm_floor_bridge_v1';
      const nonBullLowVixContangoQualityReleased = normalFloorMode === 'non_bull_or_bull_low_vix_contango_quality_v1'
        && regime !== 'BULL'
        && vix <= (params.csSecondaryCoverageBullVixMax ?? 18)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullTermStructureSlopeMin ?? 1);
      const bullExtensionBandReleased = normalFloorMode === 'non_bull_or_bull_extension_band_v1'
        && regime === 'BULL'
        && Number.isFinite(priceExtensionAtr)
        && (priceExtensionAtr! <= (params.csSecondaryCoverageBullExtensionLowMax ?? .80)
          || priceExtensionAtr! >= (params.csSecondaryCoverageBullExtensionHighMin ?? 1.45));
      const bullLowQualityReleased = normalFloorMode === 'non_bull_or_bull_low_quality_v1'
        && regime === 'BULL'
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! <= (params.csSecondaryCoverageBullExtensionLowMax ?? .80)
        && (vix <= (params.csSecondaryCoverageBullLowVixMax ?? 19)
          || priceExtensionAtr! <= (params.csSecondaryCoverageBullLowExtensionDeepMin ?? -.50));
      const bullHighQualityReleased = normalFloorMode === 'non_bull_or_bull_high_quality_v1'
        && regime === 'BULL'
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= (params.csSecondaryCoverageBullExtensionHighMin ?? 1.45)
        && (vix <= (params.csSecondaryCoverageBullHighVixMax ?? 20)
          || priceExtensionAtr! >= (params.csSecondaryCoverageBullHighExtensionDeepMin ?? 1.45));
      const bullSr02QualityReleased = (normalFloorMode === 'non_bull_or_bull_sr02_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_er20_cap_v1')
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && (normalFloorMode !== 'non_bull_or_bull_sr02_er20_cap_v1'
          || (Number.isFinite(qqqEr20) && qqqEr20! <= (params.csSecondaryCoverageBullQqqEr20Max ?? .25)));
      const bullSr02ExtensionCapReleased = normalFloorMode === 'non_bull_or_bull_sr02_extension_cap_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! <= (params.csSecondaryCoverageBullSr02ExtensionMax ?? .80);
      const bullSr02TermStructureReleased = normalFloorMode === 'non_bull_or_bull_sr02_term_structure_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullSr02TermStructureSlopeMin ?? 1);
      const bullSr02StableTermStructureReleased = normalFloorMode === 'non_bull_or_bull_sr02_stable_term_structure_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullSr02TermStructureSlopeMin ?? 1)
        && Number.isFinite(csVixChange5d)
        && csVixChange5d! <= (params.csSecondaryCoverageBullSr02VixChange5dMax ?? .10);
      const bullSr02TermStructureQualityReleased = (normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_v1'
        || normalFloorMode === 'non_bull_or_bull_term_quality_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_calm_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_sr02_quiet_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_bull_quiet_vix_floor_bridge_v1')
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullSr02TermStructureSlopeMin ?? 1)
        && Number.isFinite(priceExtensionAtr)
        && (priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1)
          || (Number.isFinite(csVixChange5d) && csVixChange5d! <= (params.csSecondaryCoverageBullSr02VixChange5dMax ?? .05)));
      const bullSr02TermStructureQualityEr20Released = normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_er20_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullSr02TermStructureSlopeMin ?? 1)
        && Number.isFinite(qqqEr20)
        && qqqEr20! <= (params.csSecondaryCoverageBullQqqEr20Max ?? .25)
        && Number.isFinite(priceExtensionAtr)
        && (priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1)
          || (Number.isFinite(csVixChange5d) && csVixChange5d! <= (params.csSecondaryCoverageBullSr02VixChange5dMax ?? .05)));
      const bullSr02TermStructureQualityRoc20Released = normalFloorMode === 'non_bull_or_bull_sr02_term_structure_quality_roc20_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix <= (params.csSecondaryCoverageBullSr02VixMax ?? 20)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullSr02TermStructureSlopeMin ?? 1)
        && Number.isFinite(qqqROC20)
        && qqqROC20! <= (params.csSecondaryCoverageBullQqqRoc20Max ?? .25)
        && Number.isFinite(priceExtensionAtr)
        && (priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1)
          || (Number.isFinite(csVixChange5d) && csVixChange5d! <= (params.csSecondaryCoverageBullSr02VixChange5dMax ?? .05)));
      const bullLowVixReleased = normalFloorMode === 'non_bull_or_bull_bull_low_vix_v1'
        && regime === 'BULL'
        && vix <= (params.csSecondaryCoverageBullVixMax ?? 18);
      const bullLowVixContangoReleased = normalFloorMode === 'non_bull_or_bull_bull_low_vix_contango_v1'
        && regime === 'BULL'
        && vix <= (params.csSecondaryCoverageBullVixMax ?? 18)
        && Number.isFinite(vix3m)
        && vix3m! - vix >= (params.csSecondaryCoverageBullTermStructureSlopeMin ?? 1);
      const bullVixFloorBridgeReleased = (normalFloorMode === 'non_bull_or_bull_vix_floor_bridge_v1'
        || normalFloorMode === 'non_bull_or_bull_term_quality_floor_bridge_v1')
        && regime === 'BULL'
        && vix >= (params.csSecondaryCoverageBullVixMin ?? 18)
        && vix <= (params.csSecondaryCoverageBullVixMax ?? 30);
      const bullSr02CalmFloorBridgeReleased = normalFloorMode === 'non_bull_or_bull_sr02_calm_floor_bridge_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < (params.csSecondaryCoverageBullSr02CalmVixMax ?? 18)
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= 0
        && priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1);
      const bullSr02QuietFloorBridgeReleased = normalFloorMode === 'non_bull_or_bull_sr02_quiet_floor_bridge_v1'
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < (params.csSecondaryCoverageBullSr02CalmVixMax ?? 18)
        && Number.isFinite(regimeData?.adx14)
        && regimeData!.adx14! < (params.csSecondaryCoverageQuietAdxMax ?? 20)
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= 0
        && priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1);
      const bullQuietVixFloorBridgeReleased = normalFloorMode === 'non_bull_or_bull_bull_quiet_vix_floor_bridge_v1'
        && regime === 'BULL'
        && vix < (params.csSecondaryCoverageBullQuietVixMax ?? 18)
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= 0
        && priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1);
      const bullSr02CalmGeometryActive = params.csSecondaryCoverageGeometryMode === 'bull_sr02_calm_v1'
        && !isPreCrisis
        && regime === 'BULL'
        && slowSubregimeState === 'SR02'
        && vix < (params.csSecondaryCoverageBullSr02CalmVixMax ?? 18)
        && Number.isFinite(priceExtensionAtr)
        && priceExtensionAtr! >= 0
        && priceExtensionAtr! < (params.csSecondaryCoverageBullSr02TermStructureExtensionMin ?? 1);
      const bullCoverageReleased = bullExtensionBandReleased || bullLowQualityReleased || bullHighQualityReleased || bullLowVixReleased || bullLowVixContangoReleased || bullVixFloorBridgeReleased || bullSr02QualityReleased || bullSr02ExtensionCapReleased || bullSr02TermStructureReleased || bullSr02StableTermStructureReleased || bullSr02TermStructureQualityReleased || bullSr02TermStructureQualityEr20Released || bullSr02TermStructureQualityRoc20Released;
      const bullRoc20CapReleased = normalFloorMode === 'non_bull_or_bull_roc20_cap_v1'
        && regime === 'BULL'
        && Number.isFinite(qqqROC20)
        && qqqROC20 <= (params.csSecondaryCoverageBullQqqRoc20Max ?? .25);
      const bullEr20CapReleased = normalFloorMode === 'non_bull_or_bull_er20_cap_v1'
        && regime === 'BULL'
        && Number.isFinite(qqqEr20)
        && qqqEr20! <= (params.csSecondaryCoverageBullQqqEr20Max ?? .25);
      const fixedShortDelta = isPreCrisis
        ? params.csSecondaryCoveragePreCrisisShortDelta ?? .05
        : bullSr02CalmGeometryActive
          ? params.csSecondaryCoverageBullSr02CalmShortDelta ?? params.csSecondaryCoverageBullShortDelta ?? params.csSecondaryCoverageShortDelta ?? .075
        : bullCoverageReleased
          ? params.csSecondaryCoverageBullShortDelta ?? params.csSecondaryCoverageShortDelta ?? .075
        : params.csSecondaryCoverageShortDelta ?? .075;
      const fixedWidthPct = isPreCrisis
        ? params.csSecondaryCoveragePreCrisisWidthPct ?? .01
        : bullSr02CalmGeometryActive
          ? params.csSecondaryCoverageBullSr02CalmWidthPct ?? params.csSecondaryCoverageBullWidthPct ?? params.csSecondaryCoverageWidthPct ?? .015
        : bullCoverageReleased
          ? params.csSecondaryCoverageBullWidthPct ?? params.csSecondaryCoverageWidthPct ?? .015
        : params.csSecondaryCoverageWidthPct ?? .015;
      const releasedFloor = (nonBullLowVixContangoQualityReleased || bullVixFloorBridgeReleased || bullSr02CalmFloorBridgeReleased || bullSr02QuietFloorBridgeReleased || bullQuietVixFloorBridgeReleased)
        ? params.csSecondaryCoverageBullFloorBridge ?? params.csSecondaryCoverageNormalRelaxedFloor ?? configuredNormalFloor
        : params.csSecondaryCoverageNormalRelaxedFloor ?? configuredNormalFloor;
      const normalFloor = ((nonBullRelaxed && regime !== 'BULL') || nonBullLowVixContangoQualityReleased || bullCoverageReleased || bullSr02CalmFloorBridgeReleased || bullSr02QuietFloorBridgeReleased || bullQuietVixFloorBridgeReleased || bullRoc20CapReleased || bullEr20CapReleased)
        ? releasedFloor
        : configuredNormalFloor;
      const floor = Math.min(1, Math.max(0, isPreCrisis
        ? params.csSecondaryCoveragePreCrisisSurvivalFloor ?? .75
        : coverageExtensionQualityReleased && params.csSecondaryCoverageExtensionQualityFloor !== undefined
          ? params.csSecondaryCoverageExtensionQualityFloor
          : normalFloor));
      const profitTarget = Math.min(1, Math.max(0, isPreCrisis
        ? params.csSecondaryCoveragePreCrisisProfitTarget ?? .50
        : coverageExtensionQualityReleased && params.csSecondaryCoverageExtensionQualityProfitTarget !== undefined
          ? params.csSecondaryCoverageExtensionQualityProfitTarget
          : params.csSecondaryCoverageProfitTarget ?? .60));
      const deltaStopThreshold = Math.min(.60, Math.max(.05, isPreCrisis
        ? params.csSecondaryCoveragePreCrisisDeltaStopThreshold ?? .20
        : bullCoverageReleased
          ? params.csSecondaryCoverageBullDeltaStopThreshold ?? params.csSecondaryCoverageDeltaStopThreshold ?? .25
          : params.csSecondaryCoverageDeltaStopThreshold ?? .25));
      const dailySigma20 = qqqRv20?.confidence ? qqqRv20.value / Math.sqrt(252) : undefined;
      if (!Number.isFinite(dailySigma20) || dailySigma20! <= 0) {
        warnings.push(`CS 高胜率覆盖层 ${tier}：缺少有效日频 σ20，拒绝生成候选`);
        return undefined;
      }
      if (!(fixedWidthPct > 0 && fixedWidthPct <= .10) || !(fixedShortDelta >= .01 && fixedShortDelta <= .45)) {
        warnings.push(`CS 高胜率覆盖层 ${tier}：距离/宽度参数无效，拒绝生成候选`);
        return undefined;
      }
      const horizonDays = (expiry: string): number => {
        const start = new Date(`${ctx.input.date.slice(0, 10)}T00:00:00Z`);
        const end = new Date(`${expiry.slice(0, 10)}T00:00:00Z`);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
        let sessions = 0;
        for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const weekday = cursor.getUTCDay();
          if (weekday > 0 && weekday < 6) sessions += 1;
        }
        return sessions;
      };
      const deltas = riskEfficiencyWidthSearch
        ? [fixedShortDelta]
        : selectionMode === 'fixed'
        ? [fixedShortDelta]
        : isPreCrisis ? [.05, .075] : [.05, .075, .10];
      const widths = riskEfficiencyWidthSearch
        ? candidateWidthsForCsRiskEfficiencySearch(fixedWidthPct)
        : selectionMode === 'fixed'
        ? [fixedWidthPct]
        : isPreCrisis ? [.01, .015] : [.01, .015, .02];
      const historyBars = !ctx.input.callStrikeSurvivalAsOf ? prices.QQQ.filter((bar) => bar.date <= ctx.input.date) : [];
      const candidates: CsSurvivalSelectionCandidate[] = [];
      const builtCandidates: Array<ReturnType<typeof buildCallCreditSpreadProposal>> = [];
      const appendCandidates = (deltaCandidates: number[], widthCandidates: number[], sigmaCandidates: number[] = []) => {
        const appendBuiltCandidate = (candidateBuilt: ReturnType<typeof buildCallCreditSpreadProposal>, widthCandidate: number, diagnosticShortDelta: number) => {
          const proposal = candidateBuilt.proposal;
          const shortStrike = proposal?.metadata.shortCallStrike;
          const longStrike = proposal?.metadata.longCallStrike;
          const expiry = proposal?.proposedStrikes.expiry;
          const credit = proposal?.metadata.credit;
          const maxLoss = proposal?.metadata.maxLoss;
          if (!proposal || shortStrike === undefined || longStrike === undefined || expiry === undefined || credit === undefined || maxLoss === undefined) return;
          const survival = ctx.input.callStrikeSurvivalAsOf?.compute(ctx.input.date, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry))
            ?? computeCallStrikeSurvivalAtAsOf(historyBars, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry));
          if (!survival) return;
          candidates.push({
            distanceSigma: (shortStrike - chain.spot) / chain.spot / dailySigma20!,
            shortDelta: diagnosticShortDelta,
            widthPct: widthCandidate,
            shortStrike,
            longStrike,
            credit,
            maxLoss,
            survival: survival.noTouch,
          });
          builtCandidates.push(candidateBuilt);
        };
        for (const shortDeltaCandidate of deltaCandidates) {
          for (const widthCandidate of widthCandidates) {
            appendBuiltCandidate(buildCallCreditSpreadProposal({
              chain,
              underlying: proxySymbol,
              date: ctx.input.date,
              targetDte: coverageExtensionQualityReleased && params.csSecondaryCoverageExtensionQualityTargetDte !== undefined
                ? params.csSecondaryCoverageExtensionQualityTargetDte
                : params.csSecondaryCoverageTargetDte ?? SPREAD_TARGET_DTE,
              widthPct: widthCandidate,
              nav,
              riskBudget: params.csSecondaryRiskBudgetNav ?? .01,
              shortDelta: shortDeltaCandidate,
              forceMinimumContract: true,
              independent: params.optionsBacktestPositionMode?.cs === 'independent',
            }), widthCandidate, shortDeltaCandidate);
          }
        }
        for (const shortStrikeSigma of sigmaCandidates) {
          for (const widthCandidate of widthCandidates) {
            appendBuiltCandidate(buildCallCreditSpreadProposal({
              chain,
              underlying: proxySymbol,
              date: ctx.input.date,
              targetDte: coverageExtensionQualityReleased && params.csSecondaryCoverageExtensionQualityTargetDte !== undefined
                ? params.csSecondaryCoverageExtensionQualityTargetDte
                : params.csSecondaryCoverageTargetDte ?? SPREAD_TARGET_DTE,
              widthPct: widthCandidate,
              nav,
              riskBudget: params.csSecondaryRiskBudgetNav ?? .01,
              shortStrikeSigma,
              dailySigma20,
              forceMinimumContract: true,
              independent: params.optionsBacktestPositionMode?.cs === 'independent',
            }), widthCandidate, fixedShortDelta);
          }
        }
      };
      appendCandidates(deltas, widths);
      let selected = selectCsHighWinCoverageCandidate({
        floor,
        objective: riskEfficiencyWidthSearch ? 'risk_efficiency' : params.csSecondaryCoverageSelectionObjective,
        candidates,
      });
      if (!selected && fixedThenSurvivalFallback) {
        appendCandidates(
          isPreCrisis ? [.05, .075] : [.05, .075, .10],
          isPreCrisis ? [.01, .015] : [.01, .015, .02],
        );
        selected = selectCsHighWinCoverageCandidate({
          floor,
          objective: params.csSecondaryCoverageSelectionObjective,
          candidates,
        });
      }
      if (!selected && sr02CalmUltraTailFallback) {
        appendCandidates(
          [.025, .035, .05],
          [.01, .015, .02],
        );
        selected = selectCsHighWinCoverageCandidate({
          floor,
          objective: params.csSecondaryCoverageSelectionObjective,
          candidates,
        });
      }
      if (!selected && sr02CalmSigmaFallback) {
        appendCandidates([], [fixedWidthPct], [1.5, 2, 2.5]);
        selected = selectCsHighWinCoverageCandidate({
          floor,
          objective: params.csSecondaryCoverageSelectionObjective,
          candidates,
        });
      }
      if (!selected) {
        warnings.push(`CS 高胜率覆盖层 ${tier}：没有候选满足 Wilson 生存率下限 ${(floor * 100).toFixed(0)}%`);
        return undefined;
      }
      const built = builtCandidates[selected.selectedIndex];
      if (!built?.proposal) return undefined;
      call_spread_coverage_triggered = true;
      const exitProfile = {
        id: isPreCrisis ? 'coverage_pre_crisis_v1' as const : 'coverage_normal_v1' as const,
        profitTarget,
        deltaStopThreshold,
      };
      return {
        action: 'ADD_CALL_SPREAD',
        csRoute: 'secondary_budget',
        csTier: tier,
        csExitProfile: exitProfile,
        overlay_type: 'proxyOverlay',
        proposed_strikes: built.proposal.proposedStrikes,
        premium_estimate: built.proposal.premiumEstimate,
        cs_max_risk_pct: built.proposal.maxRiskPct,
        callCreditSpread: built.proposal.metadata,
        csPriceSelection: {
          ...selected.diagnostic,
          route: 'secondary_budget',
          stateMode: 'all',
          stateActive: true,
          preCrisisActive: isPreCrisis,
          riskMultiplier: 1,
          distanceMode: 'base',
          distanceProfileSigma: undefined,
          selectedConditionalTailLoss: null,
          selectedConditionalTailLossP75: null,
          selectedConditionalTailLossCvar75: null,
        },
      };
    };
    if (coverageTier) return buildHighWinCoverageProposal(coverageTier);
    const targetDte = resolveCallCreditSpreadTargetDte({
      mode: params.csSurvivalSelectionDteMode === 'dynamic_dte_v1' && csSurvivalStateActive ? 'dynamic_dte_v1' : 'fixed',
      baseDte: baseTargetDte,
      regime,
      vix,
      vix3m,
      annualizedRv20: qqqRv20?.confidence ? qqqRv20.value : undefined,
    });
    if (targetDte === undefined) {
      warnings.push('CS 动态 DTE：缺少有效 VIX/VIX3M/QQQ RV20，拒绝生成候选');
      return undefined;
    }
    const secondaryTargetDte = secondaryRouteActive && params.csSecondaryTargetDteMode !== undefined
      ? resolveCallCreditSpreadTargetDte({
        mode: params.csSecondaryTargetDteMode,
        baseDte: baseTargetDte,
        regime,
        vix,
        vix3m,
        annualizedRv20: qqqRv20?.confidence ? qqqRv20.value : undefined,
      })
      : targetDte;
    if (secondaryTargetDte === undefined) {
      warnings.push('CS 独立副层动态 DTE：缺少有效 VIX/VIX3M/QQQ RV20，拒绝生成候选');
      return undefined;
    }
    const effectiveTargetDte = secondaryRouteActive ? secondaryTargetDte : targetDte;
    const conditionalWidthMode = params.csConditionalWidthMode ?? 'off';
    const safePriceExtensionAtr = priceExtensionAtr ?? Number.POSITIVE_INFINITY;
    const conditionalWidthActive = conditionalWidthMode === 'bull_sr02' && regime === 'BULL' && slowSubregimeState === 'SR02'
      || conditionalWidthMode === 'range_sr02' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02'
      || conditionalWidthMode === 'bull_or_range_sr02' && (regime === 'BULL' || regime === 'RANGE_BOUND') && slowSubregimeState === 'SR02'
      || conditionalWidthMode === 'range_sr02_vix_lt_19' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && vix < 19
      || conditionalWidthMode === 'range_sr02_vix_lt_18_5' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && vix < 18.5
      || conditionalWidthMode === 'range_sr02_rv_lt_50' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && tqqqROC20 < .50
      || conditionalWidthMode === 'range_sr02_vix_lt_19_rv_lt_50' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && vix < 19 && tqqqROC20 < .50
      || conditionalWidthMode === 'range_sr02_extension_lt_neg1' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < -1
      || conditionalWidthMode === 'range_sr02_extension_lt_neg2' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < -2
      || conditionalWidthMode === 'range_sr02_extension' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < (params.csConditionalWidthExtensionMax ?? -1)
      || conditionalWidthMode === 'range_or_weakening_sr02_extension' && (regime === 'RANGE_BOUND' || regime === 'RISK_ON_WEAKENING') && slowSubregimeState === 'SR02' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < (params.csConditionalWidthExtensionMax ?? -1)
      || conditionalWidthMode === 'extension_lt_neg1_all' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < (params.csConditionalWidthExtensionMax ?? -1)
      || conditionalWidthMode === 'range_sr01_extension' && regime === 'RANGE_BOUND' && slowSubregimeState === 'SR01' && Number.isFinite(safePriceExtensionAtr) && safePriceExtensionAtr < (params.csConditionalWidthExtensionMax ?? -1);
    const baseWidthPct = conditionalWidthActive && typeof params.csConditionalWidthPct === 'number'
      ? params.csConditionalWidthPct
      : (params.csSpreadWidthPct ?? CS_SPREAD_WIDTH_PCT);
    const widthPct = secondaryRouteActive
      ? params.csSecondaryWidthPct ?? .015
      : baseWidthPct;
    const secondaryRiskBudget = Math.min(1, Math.max(0, params.csSecondaryRiskBudgetNav ?? .005));
    if (secondaryRouteActive && !(widthPct > 0 && widthPct <= .10)) {
      warnings.push(`CS 独立副层：宽度 ${widthPct} 不在有效范围，拒绝生成候选`);
      return undefined;
    }
    const riskBudget = secondaryRouteActive
      ? secondaryRiskBudget
      : (params.csMaxTotalRiskNav ?? CS_MAX_TOTAL_RISK_NAV) * csSizeMultiplier * csEventRiskMultiplier * csVxnRescueSizeMultiplier;
  let built = buildCallCreditSpreadProposal({ chain, underlying: proxySymbol, date: ctx.input.date, targetDte: effectiveTargetDte, widthPct, nav, riskBudget, shortDelta, forceMinimumContract: secondaryRouteActive ? false : params.forceMinimumContract, independent: params.optionsBacktestPositionMode?.cs === 'independent' });
    const transitionRiskMode = (params as typeof params & { csTransitionRiskMode?: string }).csTransitionRiskMode;
    const transitionCoreTriggered = !secondaryRouteActive && transitionRiskMode === 'score4_all4_d10_w05' && [
      Number(regimeData?.weakening_signal_count ?? 0) >= 2,
      Number(regimeData?.rsi14 ?? Number.NaN) < 50,
      vix < 17,
      Number(regimeData?.price_vs_sma200_pct ?? Number.NaN) < .08,
    ].every(Boolean);
    if (transitionCoreTriggered) {
      built = buildCallCreditSpreadProposal({
        chain, underlying: proxySymbol, date: ctx.input.date, targetDte: effectiveTargetDte,
        widthPct: .05, nav, riskBudget, shortDelta: .10,
        forceMinimumContract: secondaryRouteActive ? false : params.forceMinimumContract,
        independent: params.optionsBacktestPositionMode?.cs === 'independent',
      });
    }
    let csPriceSelection: OverlayProposal['csPriceSelection'];
    // 副层 v2 动态生存率选约（研究专用）：网格搜索 Delta 候选，先过 Wilson 生存率下限再排序，取代上面的固定 Delta 单候选。
    if (secondaryRouteActive && params.csSecondary2SelectionMode === 'survival_dynamic') {
      const secondary2Sigma = qqqRv20?.confidence ? qqqRv20.value / Math.sqrt(252) : undefined;
      if (!Number.isFinite(secondary2Sigma) || secondary2Sigma! <= 0) {
        warnings.push('CS 副层v2动态选价：缺少有效日频 σ20，拒绝生成候选');
        return undefined;
      }
      const secondary2HistoryBars = !ctx.input.callStrikeSurvivalAsOf ? prices.QQQ.filter((bar) => bar.date <= ctx.input.date) : [];
      // 与旧版副层质量闸（约 line 1158）保持一致，用日历日而非交易日——已实测确认交易日口径会
      // 系统性低估到期horizon、抬高生存率估计，让本该被闸掉的候选通过（2023 胜率从93.8%→84.2%、
      // MDD从-$499→-$834），日历日口径更保守、与已验证的锁定候选口径一致。
      const secondary2Horizon = (expiry: string): number => {
        const [year, month, day] = ctx.input.date.slice(0, 10).split('-').map(Number);
        const [expiryYear, expiryMonth, expiryDay] = expiry.slice(0, 10).split('-').map(Number);
        if (![year, month, day, expiryYear, expiryMonth, expiryDay].every(Number.isFinite)) return 0;
        const cursor = new Date(Date.UTC(year!, month! - 1, day!));
        const target = new Date(Date.UTC(expiryYear!, expiryMonth! - 1, expiryDay!));
        return Math.max(0, Math.round((target.getTime() - cursor.getTime()) / 86400000));
      };
      const secondary2Deltas = params.csSecondary2ShortDeltaGrid ?? [.05, .075, .10, .15];
      const secondary2Candidates: CsSurvivalSelectionCandidate[] = [];
      const secondary2Built: Array<ReturnType<typeof buildCallCreditSpreadProposal>> = [];
      for (const candidateDelta of secondary2Deltas) {
        const candidateBuilt = buildCallCreditSpreadProposal({
          chain, underlying: proxySymbol, date: ctx.input.date, targetDte: effectiveTargetDte,
          widthPct, nav, riskBudget, shortDelta: candidateDelta,
          forceMinimumContract: false, independent: params.optionsBacktestPositionMode?.cs === 'independent',
        });
        const candidateProposal = candidateBuilt.proposal;
        const candidateShortStrike = candidateProposal?.metadata.shortCallStrike;
        const candidateLongStrike = candidateProposal?.metadata.longCallStrike;
        const candidateExpiry = candidateProposal?.proposedStrikes.expiry;
        const candidateCredit = candidateProposal?.metadata.credit;
        const candidateMaxLoss = candidateProposal?.metadata.maxLoss;
        if (!candidateProposal || candidateShortStrike === undefined || candidateLongStrike === undefined
          || candidateExpiry === undefined || candidateCredit === undefined || candidateMaxLoss === undefined) continue;
        const candidateSurvival = ctx.input.callStrikeSurvivalAsOf?.compute(ctx.input.date, chain.spot, candidateShortStrike, secondary2Sigma!, secondary2Horizon(candidateExpiry))
          ?? computeCallStrikeSurvivalAtAsOf(secondary2HistoryBars, chain.spot, candidateShortStrike, secondary2Sigma!, secondary2Horizon(candidateExpiry));
        if (!candidateSurvival) continue;
        secondary2Candidates.push({
          distanceSigma: (candidateShortStrike - chain.spot) / chain.spot / secondary2Sigma!,
          shortDelta: candidateDelta,
          widthPct,
          shortStrike: candidateShortStrike,
          longStrike: candidateLongStrike,
          credit: candidateCredit,
          maxLoss: candidateMaxLoss,
          survival: candidateSurvival.noTouch,
        });
        secondary2Built.push(candidateBuilt);
      }
      const secondary2Floor = Math.min(1, Math.max(0, params.csSecondary2SurvivalFloor ?? .75));
      const secondary2Selected = selectCsSurvivalCandidate({
        floor: secondary2Floor,
        objective: params.csSecondary2SelectionObjective ?? 'survival_priority',
        survivalWeight: params.csSecondary2SelectionSurvivalWeight,
        survivalWilsonWeight: params.csSecondary2SelectionWilsonWeight,
        widthMode: 'fixed',
        candidates: secondary2Candidates,
      });
      if (!secondary2Selected) {
        warnings.push(`CS 副层v2动态选价：没有候选满足 no-touch Wilson 下限 ${(secondary2Floor * 100).toFixed(0)}%`);
        return undefined;
      }
      built = secondary2Built[secondary2Selected.selectedIndex]!;
      csPriceSelection = {
        ...secondary2Selected.diagnostic,
        route: 'secondary_budget',
        stateMode: csSurvivalStateMode,
        stateActive: true,
        preCrisisActive: csPreCrisisActive,
        riskMultiplier: 1,
        distanceMode: 'base',
      };
    }
    const csTailVetoRatio = csHighPressure ? params.csSurvivalSelectionStressTailVetoRatio : undefined;
    if (!secondaryRouteActive && params.csSurvivalPriceSelectionMode === 'survival_only' && csSurvivalStateActive) {
      const rv20 = indicators.require<number>('qqq_rv20');
      const dailySigma20 = rv20?.confidence ? rv20.value / Math.sqrt(252) : undefined;
      if (!Number.isFinite(dailySigma20) || dailySigma20! <= 0) {
        warnings.push('CS 生存率选价缺少有效日频 σ20，拒绝生成候选');
        return undefined;
      }
      const portfolioScoreMode = params.csPortfolioScoreMode ?? 'off';
      const historyBars = !ctx.input.callStrikeSurvivalAsOf || portfolioScoreMode === 'pcs_hedge_v1'
        ? prices.QQQ.filter((bar) => bar.date <= ctx.input.date)
        : [];
      const portfolioScoreWeight = Math.min(1, Math.max(0, params.csPortfolioScoreWeight ?? .50));
      const pcsPortfolioProposal = portfolioScoreMode === 'pcs_hedge_v1'
        ? buildPutCreditSpreadProposal({
            chain,
            underlying: proxySymbol,
            date: ctx.input.date,
            targetDte: params.pcsTargetDte ?? targetDte,
            widthPct: params.pcsSpreadWidthPct ?? .02,
            nav,
            riskBudget,
            shortDelta: params.pcsShortDelta ?? .20,
            forceMinimumContract: true,
          }).proposal
        : undefined;
      if (portfolioScoreMode === 'pcs_hedge_v1' && !pcsPortfolioProposal) {
        warnings.push('CS PCS-CS 组合评分：没有可用的 PCS 代理结构，回退到 CS 独立排序');
      }
      const pcsMetadata = pcsPortfolioProposal?.metadata;
      const pcsStrikes = pcsPortfolioProposal?.proposedStrikes;
      const horizonDays = (expiry: string) => {
        const [year, month, day] = ctx.input.date.slice(0, 10).split('-').map(Number);
        const [expiryYear, expiryMonth, expiryDay] = expiry.slice(0, 10).split('-').map(Number);
        if (![year, month, day, expiryYear, expiryMonth, expiryDay].every(Number.isFinite)) return 0;
        const cursor = new Date(Date.UTC(year!, month! - 1, day!));
        const end = new Date(Date.UTC(expiryYear!, expiryMonth! - 1, expiryDay!));
        let sessions = 0;
        while (cursor < end) {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          const weekday = cursor.getUTCDay();
          if (weekday > 0 && weekday < 6) sessions += 1;
        }
        return sessions;
      };
      // 与 CSP 相同：把短腿距离与保护腿宽度组成联合候选；不改变 CS 的市场时机门。
      const widthMode = params.csSurvivalSelectionWidthMode ?? 'full';
      const distanceMode: CSSurvivalSelectionDistanceMode = params.csSurvivalSelectionDistanceMode ?? 'base';
      const distanceProfile = distanceMode === 'pcs_dynamic_v1'
        ? selectPcsContractProfile({
          regime,
          vix,
          vix3m,
          annualizedRv20: qqqRv20?.confidence ? qqqRv20.value : undefined,
        })
        : undefined;
      if (distanceMode === 'pcs_dynamic_v1' && !distanceProfile) {
        warnings.push('CS PCS-style 动态距离：缺少有效 regime/VIX/VIX3M/QQQ RV20，拒绝生成候选');
        return undefined;
      }
      // 用真实可成交期权 Delta 生成距离候选，再把实际 strike 距离换算成 Sigma；
      // 避免把 realized-RV 与期权 IV 的期限口径直接混成行权价。
      const candidateDeltas = distanceMode === 'pcs_dynamic_v1'
      ? candidateShortDeltasForCsPcsDynamicDistance(distanceProfile!.shortStrikeSigma, shortDelta)
      : candidateShortDeltasForCsSurvivalSelection(shortDelta);
      const widthCandidates = candidateWidthsForCsSurvivalSelection(widthMode, widthPct);
      const candidates: CsSurvivalSelectionCandidate[] = [];
      const builtCandidates: Array<ReturnType<typeof buildCallCreditSpreadProposal>> = [];
      let baselineCandidateIndex: number | undefined;
      for (const candidateDelta of candidateDeltas) {
        for (const candidateWidthPct of widthCandidates) {
          const candidateBuilt = buildCallCreditSpreadProposal({ chain, underlying: proxySymbol, date: ctx.input.date, targetDte, widthPct: candidateWidthPct, nav, riskBudget, shortDelta: candidateDelta, forceMinimumContract: params.forceMinimumContract, independent: params.optionsBacktestPositionMode?.cs === 'independent' });
        const proposal = candidateBuilt.proposal;
        const shortStrike = proposal?.metadata.shortCallStrike;
        const longStrike = proposal?.metadata.longCallStrike;
        const expiry = proposal?.proposedStrikes.expiry;
        const credit = proposal?.metadata.credit;
        const maxLoss = proposal?.metadata.maxLoss;
        if (!proposal || shortStrike === undefined || longStrike === undefined || expiry === undefined || credit === undefined || maxLoss === undefined) continue;
        const survival = ctx.input.callStrikeSurvivalAsOf?.compute(ctx.input.date, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry))
          ?? computeCallStrikeSurvivalAtAsOf(historyBars, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry));
        if (!survival) continue;
        const distanceSigma = (shortStrike - chain.spot) / chain.spot / dailySigma20!;
        const needsTail = params.csSurvivalSelectionObjective === 'tail_aware_expected_pnl'
          || params.csSurvivalSelectionObjective === 'tail_aware_conditional_expected_pnl'
          || params.csSurvivalSelectionObjective === 'tail_aware_conditional_p75_expected_pnl'
          || params.csSurvivalSelectionObjective === 'tail_aware_conditional_cvar75_expected_pnl'
          || params.csSurvivalSelectionObjective === 'constrained_tail_efficiency'
          || csTailVetoRatio !== undefined;
        const tail = needsTail
          ? ctx.input.callStrikeSurvivalAsOf?.computeTail(ctx.input.date, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry), candidateWidthPct, credit, maxLoss)
            ?? computeCallStrikeTailLossAtAsOf(historyBars, chain.spot, shortStrike, dailySigma20!, horizonDays(expiry), candidateWidthPct, credit, maxLoss)
          : null;
        const candidateIndex = candidates.length;
        const portfolioScore = dailySigma20 !== undefined
          && pcsMetadata
          && pcsStrikes?.spread_short_strike !== undefined
          && pcsStrikes.spread_long_strike !== undefined
          && pcsMetadata.credit !== undefined
          ? computePcsCsPairExpectedPnlAtAsOf(
              historyBars,
              chain.spot,
              dailySigma20,
              horizonDays(expiry),
              pcsStrikes.spread_short_strike,
              pcsStrikes.spread_long_strike,
              pcsMetadata.credit,
              shortStrike,
              longStrike,
              credit,
            ) ?? undefined
          : undefined;
        candidates.push({ distanceSigma, shortDelta: candidateDelta, widthPct: candidateWidthPct, shortStrike, longStrike, credit, maxLoss, survival: survival.noTouch, portfolioScore, tailLoss: tail?.conditionalLoss, tailLossP75: tail?.conditionalLossP75, tailLossCvar75: tail?.conditionalLossCvar75 });
        if (candidateDelta === shortDelta && candidateWidthPct === widthPct) baselineCandidateIndex = candidateIndex;
        builtCandidates.push(candidateBuilt);
        }
      }
      const selected = selectCsSurvivalCandidate({
        floor: params.csSurvivalSelectionFloor ?? .30,
        objective: params.csSurvivalSelectionObjective,
        survivalWeight: params.csSurvivalSelectionSurvivalWeight,
        survivalWilsonWeight: params.csSurvivalSelectionWilsonWeight,
        widthMode,
        baselineCredit: built.proposal?.metadata.credit,
        creditRetentionFloor: params.csSurvivalSelectionCreditRetentionFloor,
        tailVetoRatio: csTailVetoRatio,
        baselineIndex: baselineCandidateIndex,
        switchMargin: params.csSurvivalSelectionSwitchMargin,
        minSurvivalLift: params.csSurvivalSelectionMinSurvivalLift,
        portfolioScoreWeight: portfolioScoreMode === 'pcs_hedge_v1' ? portfolioScoreWeight : undefined,
        candidates,
      });
      if (!selected) {
        warnings.push(`CS 生存率选价：没有候选满足 no-touch Wilson 下限 ${((params.csSurvivalSelectionFloor ?? .30) * 100).toFixed(0)}%`);
        if (csCoverageEnabled && !csEventRiskBlocked && !csExtensionBlocked && !csVixBlocked && regime !== 'BEAR' && regime !== 'CRISIS') {
          const coverageProposal = buildHighWinCoverageProposal('normal_coverage');
          if (coverageProposal) {
            warnings.push('CS 主层选约失败，转入 normal_coverage；主层 selector 与主层账本未写入副层状态');
            return coverageProposal;
          }
        }
        const fallbackAllowed = params.csSurvivalFallbackEnabled === true
          && !csPreCrisisActive
          && !csEventRiskBlocked
          && !['BEAR', 'CRISIS'].includes(regime);
        if (!fallbackAllowed) return undefined;

        const fallbackShortDelta = Math.min(.45, Math.max(.05, params.csSurvivalFallbackShortDelta ?? .10));
        const fallbackWidthPct = params.csSurvivalFallbackWidthPct ?? .015;
        const fallbackFloor = Math.min(1, Math.max(0, params.csSurvivalFallbackFloor ?? .40));
        if (!(fallbackWidthPct > 0 && fallbackWidthPct <= .10)) {
          warnings.push(`CS 生存率 fallback：宽度 ${fallbackWidthPct} 不在有效范围，拒绝生成候选`);
          return undefined;
        }
        const fallbackBuilt = buildCallCreditSpreadProposal({
          chain,
          underlying: proxySymbol,
          date: ctx.input.date,
          targetDte,
          widthPct: fallbackWidthPct,
          nav,
          riskBudget,
          shortDelta: fallbackShortDelta,
          forceMinimumContract: params.forceMinimumContract,
          independent: params.optionsBacktestPositionMode?.cs === 'independent',
        });
        const fallbackProposal = fallbackBuilt.proposal;
        const fallbackShortStrike = fallbackProposal?.metadata.shortCallStrike;
        const fallbackLongStrike = fallbackProposal?.metadata.longCallStrike;
        const fallbackExpiry = fallbackProposal?.proposedStrikes.expiry;
        const fallbackCredit = fallbackProposal?.metadata.credit;
        const fallbackMaxLoss = fallbackProposal?.metadata.maxLoss;
        if (!fallbackProposal
          || fallbackShortStrike === undefined
          || fallbackLongStrike === undefined
          || fallbackExpiry === undefined
          || fallbackCredit === undefined
          || fallbackMaxLoss === undefined) return undefined;
        const fallbackSurvival = ctx.input.callStrikeSurvivalAsOf?.compute(
          ctx.input.date,
          chain.spot,
          fallbackShortStrike,
          dailySigma20!,
          horizonDays(fallbackExpiry),
        ) ?? computeCallStrikeSurvivalAtAsOf(
          historyBars,
          chain.spot,
          fallbackShortStrike,
          dailySigma20!,
          horizonDays(fallbackExpiry),
        );
        const fallbackLower = fallbackSurvival?.noTouch.interval?.lower ?? null;
        if (!fallbackSurvival
          || fallbackLower === null
          || fallbackLower < fallbackFloor
          || !(fallbackCredit > 0)
          || !(fallbackMaxLoss > 0)) return undefined;

        built = fallbackBuilt;
        const fallbackPoint = fallbackSurvival.noTouch.value ?? 0;
        const fallbackRankingSurvival = fallbackPoint * (1 - (params.csSurvivalSelectionWilsonWeight ?? .50))
          + fallbackLower * (params.csSurvivalSelectionWilsonWeight ?? .50);
        csPriceSelection = {
          mode: 'survival_only',
          route: 'conservative_fallback',
          fallbackReason: 'primary_selection_rejected',
          objective: params.csSurvivalSelectionObjective ?? 'survival_adjusted_expected_pnl',
          survivalWeight: params.csSurvivalSelectionSurvivalWeight ?? .50,
          wilsonWeight: params.csSurvivalSelectionWilsonWeight ?? .50,
          floor: fallbackFloor,
          widthMode: 'fixed',
          stateMode: csSurvivalStateMode,
          stateActive: true,
          preCrisisActive: false,
          riskMultiplier: csEventRiskMultiplier,
          candidateCount: 1,
          eligibleCandidates: 1,
          tailVetoRatio: null,
          tailVetoedCandidates: 0,
          creditRetentionFloor: null,
          creditVetoedCandidates: 0,
          distanceMode: 'base',
          switchMargin: null,
          minSurvivalLift: null,
          switchGuardFallback: false,
          selectedDistanceSigma: (fallbackShortStrike - chain.spot) / chain.spot / dailySigma20!,
          selectedShortDelta: fallbackShortDelta,
          selectedWidthPct: fallbackWidthPct,
          selectedNoTouch: fallbackSurvival.noTouch.value,
          selectedNoTouchLower: fallbackLower,
          selectedSurvivalForRanking: fallbackRankingSurvival,
          selectedConditionalTailLoss: null,
          selectedConditionalTailLossP75: null,
          selectedConditionalTailLossCvar75: null,
          selectedObjectiveScore: fallbackCredit * 100 * fallbackRankingSurvival - fallbackMaxLoss * (1 - fallbackRankingSurvival),
        };
        warnings.push(`CS 生存率选价：主策略无合格候选，启用保守 fallback（${(fallbackShortDelta * 100).toFixed(0)}Δ / ${(fallbackWidthPct * 100).toFixed(1)}% 宽度 / Wilson ${(fallbackFloor * 100).toFixed(0)}%）`);
      } else {
        built = builtCandidates[selected.selectedIndex]!;
        csPriceSelection = {
          ...selected.diagnostic,
          route: 'primary',
          stateMode: csSurvivalStateMode,
          stateActive: true,
          distanceMode,
          distanceProfileSigma: distanceProfile?.shortStrikeSigma,
          preCrisisActive: csPreCrisisActive,
          riskMultiplier: csEventRiskMultiplier,
        };
      }
    }
    if (secondaryRouteActive && built.proposal
      && params.csSecondary2SelectionMode !== 'survival_dynamic'
      && (params.csSecondarySurvivalFloor !== undefined || params.csSecondaryExpectedPnlFloor !== undefined)) {
      const secondaryDailySigma20 = qqqRv20?.confidence ? qqqRv20.value / Math.sqrt(252) : undefined;
      if (!Number.isFinite(secondaryDailySigma20) || secondaryDailySigma20! <= 0) {
        warnings.push('CS 独立副层质量闸：缺少有效日频 σ20，拒绝生成候选');
        return undefined;
      }
      const secondaryShortStrike = built.proposal.metadata.shortCallStrike;
      const secondaryCredit = built.proposal.metadata.credit;
      const secondaryMaxLoss = built.proposal.metadata.maxLoss;
      const secondaryExpiry = built.proposal.proposedStrikes.expiry;
      if (secondaryShortStrike === undefined || secondaryCredit === undefined || secondaryMaxLoss === undefined || secondaryExpiry === undefined) {
        warnings.push('CS 独立副层质量闸：候选缺少必要字段，拒绝生成候选');
        return undefined;
      }
      const secondaryHorizonDays = (() => {
        const [year, month, day] = ctx.input.date.slice(0, 10).split('-').map(Number);
        const [expiryYear, expiryMonth, expiryDay] = secondaryExpiry.slice(0, 10).split('-').map(Number);
        if (![year, month, day, expiryYear, expiryMonth, expiryDay].every(Number.isFinite)) return 0;
        const cursor = new Date(Date.UTC(year!, month! - 1, day!));
        const target = new Date(Date.UTC(expiryYear!, expiryMonth! - 1, expiryDay!));
        return Math.max(0, Math.round((target.getTime() - cursor.getTime()) / 86400000));
      })();
      const secondaryHistoryBars = !ctx.input.callStrikeSurvivalAsOf ? prices.QQQ.filter((bar) => bar.date <= ctx.input.date) : [];
      const secondarySurvival = ctx.input.callStrikeSurvivalAsOf?.compute(ctx.input.date, chain.spot, secondaryShortStrike, secondaryDailySigma20!, secondaryHorizonDays)
        ?? computeCallStrikeSurvivalAtAsOf(secondaryHistoryBars, chain.spot, secondaryShortStrike, secondaryDailySigma20!, secondaryHorizonDays);
      const secondaryLower = secondarySurvival?.noTouch.interval?.lower ?? null;
      if (!secondarySurvival || secondaryLower === null) {
        warnings.push('CS 独立副层质量闸：无法计算生存率，拒绝生成候选');
        return undefined;
      }
      if (params.csSecondarySurvivalFloor !== undefined && secondaryLower < params.csSecondarySurvivalFloor) {
        warnings.push(`CS 独立副层质量闸：生存率下限 ${(secondaryLower * 100).toFixed(1)}% 低于 ${(params.csSecondarySurvivalFloor * 100).toFixed(0)}%，拒绝生成候选`);
        return undefined;
      }
      const secondaryPoint = secondarySurvival.noTouch.value ?? 0;
      const secondaryWilsonWeight = params.csSurvivalSelectionWilsonWeight ?? .50;
      const secondaryRanking = secondaryPoint * (1 - secondaryWilsonWeight) + secondaryLower * secondaryWilsonWeight;
      const secondaryScore = secondaryCredit * 100 * secondaryRanking - secondaryMaxLoss * (1 - secondaryRanking);
      if (params.csSecondaryExpectedPnlFloor !== undefined && secondaryScore < params.csSecondaryExpectedPnlFloor) {
        warnings.push(`CS 独立副层质量闸：预期 P&L 评分 ${secondaryScore.toFixed(2)} 低于下限 ${params.csSecondaryExpectedPnlFloor.toFixed(2)}，拒绝生成候选`);
        return undefined;
      }
      csPriceSelection = {
        mode: 'survival_only',
        route: 'secondary_budget',
        objective: params.csSurvivalSelectionObjective ?? 'survival_adjusted_expected_pnl',
        survivalWeight: params.csSurvivalSelectionSurvivalWeight ?? .50,
        wilsonWeight: secondaryWilsonWeight,
        floor: params.csSecondarySurvivalFloor ?? 0,
        widthMode: 'fixed',
        stateMode: csSurvivalStateMode,
        stateActive: true,
        preCrisisActive: csPreCrisisActive,
        riskMultiplier: 1,
        candidateCount: 1,
        eligibleCandidates: 1,
        tailVetoRatio: null,
        tailVetoedCandidates: 0,
        creditRetentionFloor: null,
        creditVetoedCandidates: 0,
        distanceMode: 'base',
        switchMargin: null,
        minSurvivalLift: null,
        switchGuardFallback: false,
        selectedDistanceSigma: (secondaryShortStrike - chain.spot) / chain.spot / secondaryDailySigma20!,
        selectedShortDelta: secondaryShortDelta,
        selectedWidthPct: widthPct,
        selectedNoTouch: secondarySurvival.noTouch.value,
        selectedNoTouchLower: secondaryLower,
        selectedSurvivalForRanking: secondaryRanking,
        selectedConditionalTailLoss: null,
        selectedConditionalTailLossP75: null,
        selectedConditionalTailLossCvar75: null,
        selectedObjectiveScore: secondaryScore,
      };
    }
    if (built.warning) warnings.push(built.warning);
    if (!built.proposal) return undefined;
    if (!secondaryRouteActive && isCallCreditSpreadBelowResearchCreditFloor(built.proposal.metadata.credit, params.csResearchMinCredit, regime, params.csResearchMinCreditScope, vix, slowSubregimeState, csVixChange5d)) {
      warnings.push(`CS 研究最低 credit 门：每股 premium ${built.proposal.metadata.credit?.toFixed(4) ?? 'NA'} < ${params.csResearchMinCredit?.toFixed(4) ?? 'NA'}，拒绝开仓`);
      return undefined;
    }
    const csRoute = secondaryRouteActive ? 'secondary_budget' : csPriceSelection?.route ?? 'primary';
    if (secondaryRouteActive) {
      warnings.push(`CS 独立副层：主层 cap1 已阻断，使用 ${(secondaryShortDelta * 100).toFixed(0)}Δ / ${(widthPct * 100).toFixed(1)}% 宽度 / ${(secondaryRiskBudget * 100).toFixed(2)}% NAV 单笔预算`);
    }
    return {
      action: 'ADD_CALL_SPREAD',
      csRoute,
      overlay_type: 'proxyOverlay',
      proposed_strikes: built.proposal.proposedStrikes,
      premium_estimate: built.proposal.premiumEstimate,
      cs_max_risk_pct: built.proposal.maxRiskPct,
      callCreditSpread: { ...built.proposal.metadata, vxnRescueSizeMultiplier: csVxnRescueSizeMultiplier },
      csPriceSelection,
      csVxnRescueSizeMultiplier,
    };
  };

  const buildPutSpreadProposal = (): OverlayProposal | undefined => {
    const { pcsTargetDte, pcsShortDelta, pcsSpreadWidthPct: configuredPcsWidthPct } = params;
    const pcsWidthPct = resolvePcsResearchSpreadWidth(
      configuredPcsWidthPct,
      slowSubregimeState,
      params.pcsResearchSpreadWidthBySlowSubregime,
      regimeData?.vix ?? vix,
      params.pcsResearchSpreadWidthByVix,
    );
    const researchReactiveRiskMultiplier = researchReactiveTimingRelease
      ? Math.min(1, Math.max(0, params.pcsResearchReactiveRiskMultiplier ?? 1))
      : 1;
    const pcsBaseRiskBudget = (params.pcsMaxRiskNav ?? params.csMaxTotalRiskNav ?? CS_MAX_TOTAL_RISK_NAV)
      * (params.pcsRiskBudgetMultiplier ?? 1.0)
      * researchReactiveRiskMultiplier;
    const riskEnvelopeMode = params.pcsRiskEnvelopeMode ?? 'off';
    const riskEnvelope = evaluatePcsRiskEnvelope({
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      vix: regimeData?.vix ?? vix,
      rv20: tqqqRealisedVol20d,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      adx14: regimeData?.adx14,
      roc20: qqqROC20,
    }, params.pcsRiskEnvelopeProfile);
    const candidate3BaseEnvelope = pcsResearchProfile === 'candidate3' || pcsResearchProfile === 'candidate4' || isCandidateARescueProfile
      ? evaluatePcsRiskEnvelope({
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        rv20: tqqqRealisedVol20d,
        priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
        drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
        adx14: regimeData?.adx14,
        roc20: qqqROC20,
      }, isCandidateARescueProfile ? 'candidate4_full_only_v1' : 'candidate4_full_v1')
      : riskEnvelope;
    const candidateAReleaseActive = pcsCandidateAStateRelease;
    const candidateAExpansionReleaseActive = pcsCandidateAExpansionRelease;
    const candidate3ExtraReleaseActive = (pcsResearchProfile === 'candidate3'
      || ((pcsResearchProfile === 'candidateA' || isCandidateARescueProfile) && params.pcsCandidate3ExtraRelease === 'bull_sr02_rv_adx'))
      && params.pcsCandidate3ExtraRelease !== undefined
      && params.pcsCandidate3ExtraRelease !== 'off'
      && isPcsCandidate3ExtraRelease({
        enabled: true,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        tqqqRealisedVol20d,
      }, params.pcsCandidate3ExtraRelease);
    // 风险包络只处理已经被 V1.2.1 拦截的候选；正常候选不被意外缩仓。
    const riskEnvelopeEnabled = riskEnvelopeMode === 'candidate3_v1' || riskEnvelopeMode === 'candidate4_v1';
    const riskEnvelopeReleaseActive = riskEnvelopeEnabled && pcsV121StateBlocked;
    // 先用原候选预算完成选腿；只有原释放未通过、且包络命中时，
    // 才在 gate 之后用 HALF 预算重建。这样研究臂不会改变既有候选解。
    const riskEnvelopeMultiplier = 1;
    const rv20 = indicators.require<number>('qqq_rv20');
    const priceSelectionMode: PCSSurvivalPriceSelectionMode = params.pcsSurvivalPriceSelectionMode ?? 'off';
    const survivalSelectionDteMode: PCSSurvivalSelectionDteMode = params.pcsSurvivalSelectionDteMode ?? 'fixed';
    const survivalSelectionWidthMode: PCSSurvivalSelectionWidthMode = params.pcsSurvivalSelectionWidthMode ?? 'fixed';
    const survivalSelectionSigmaMode: PCSSurvivalSelectionSigmaMode = params.pcsSurvivalSelectionSigmaMode
      ?? (priceSelectionMode === 'dynamic_v1_survival' ? 'dynamic_v1' : 'full');
    const tailTriggeredWidthMode = survivalSelectionWidthMode === 'tail_triggered_dynamic_width_v1';
    const jointWidthMode = survivalSelectionWidthMode === 'joint_dynamic_width_v1';
    const widthExpectedPnlLcbMode = survivalSelectionWidthMode === 'width_only_guarded_expected_pnl_lcb_v1';
    const widthOnlyGuardedMode = survivalSelectionWidthMode === 'width_only_guarded_dynamic_width_v1' || widthExpectedPnlLcbMode;
    const widthOnlyV2WidthMode = survivalSelectionWidthMode === 'width_only_guarded_v2_width_v1';
    const confirmedGuardedWidthMode = survivalSelectionWidthMode === 'confirmed_guarded_dynamic_width_v1';
    const guardedWidthMode = survivalSelectionWidthMode === 'guarded_dynamic_width_v1'
      || widthOnlyGuardedMode
      || widthOnlyV2WidthMode
      || confirmedGuardedWidthMode
      || survivalSelectionWidthMode === 'state_guarded_dynamic_width_v1';
    const stateGuardedWidthMode = survivalSelectionWidthMode === 'state_guarded_dynamic_width_v1';
    const profileInput = { regime: regimeData?.regime, vix: primaryVol, vix3m: primaryVol3m, annualizedRv20: rv20?.confidence ? rv20.value : undefined };
    const stressedProfile = isPcsContractProfileStressed(profileInput);
    const scopedSelectionObjectiveActive = (
      params.pcsSurvivalSelectionObjectiveRegime === undefined
      || params.pcsSurvivalSelectionObjectiveRegime === regimeData?.regime
    ) && (
      params.pcsSurvivalSelectionObjectiveSlowSubregime === undefined
      || params.pcsSurvivalSelectionObjectiveSlowSubregime === slowSubregimeState
    ) && (
      params.pcsSurvivalSelectionObjectiveAdxMin === undefined
      || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= params.pcsSurvivalSelectionObjectiveAdxMin)
    ) && (
      params.pcsSurvivalSelectionObjectiveRv20Min === undefined
      || (tqqqRealisedVol20d !== undefined && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d >= params.pcsSurvivalSelectionObjectiveRv20Min)
    );
    const pcsSelectionObjective = scopedSelectionObjectiveActive
      ? params.pcsSurvivalSelectionObjective
      : undefined;
    const stressTailVetoActive = stressedProfile && (
      params.pcsSurvivalSelectionStressTailVetoRegime === undefined
      || params.pcsSurvivalSelectionStressTailVetoRegime === regimeData?.regime
    ) && (
      params.pcsSurvivalSelectionStressTailVetoSlowSubregime === undefined
      || params.pcsSurvivalSelectionStressTailVetoSlowSubregime === slowSubregimeState
    ) && (
      params.pcsSurvivalSelectionStressTailVetoRv20Max === undefined
      || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < params.pcsSurvivalSelectionStressTailVetoRv20Max)
    );
    const dynamicSigmaActive = survivalSelectionSigmaMode === 'dynamic_v1'
      || ((survivalSelectionSigmaMode === 'stress_only_dynamic_v1' || survivalSelectionSigmaMode === 'stress_two_step_v1') && stressedProfile);
    const stressTwoStepActive = survivalSelectionSigmaMode === 'stress_two_step_v1' && dynamicSigmaActive;
    const dynamicDteActive = survivalSelectionDteMode === 'dynamic_dte_v1';
    const mediumWidthState = (Number.isFinite(primaryVol) && primaryVol! >= 18)
      || Boolean(rv20?.confidence && rv20.value >= .20);
    const widthConfirmDays = Math.min(5, Math.max(1, Math.round(params.pcsSurvivalSelectionWidthConfirmDays ?? 1)));
    const previousPrimaryVol = universe.primaryVolatility === 'VXN' ? undefined : macro.prevVix;
    const confirmationVol = widthConfirmDays >= 5 ? macro.vix5dAgo : previousPrimaryVol;
    const widthPressureConfirmed = !confirmedGuardedWidthMode || (
      mediumWidthState
      && Number.isFinite(primaryVol)
      && primaryVol! >= 18
      && Number.isFinite(confirmationVol)
      && confirmationVol! >= 18
    );
    const dynamicWidthActive = survivalSelectionWidthMode === 'dynamic_width_v1'
      || (guardedWidthMode && !stateGuardedWidthMode && !confirmedGuardedWidthMode)
      || (confirmedGuardedWidthMode && widthPressureConfirmed)
      || (survivalSelectionWidthMode === 'stress_dynamic_width_v1' && stressedProfile)
      || (stateGuardedWidthMode && stressedProfile)
      || jointWidthMode;
    const widthProfileActive = dynamicWidthActive || tailTriggeredWidthMode;
    const dynamicWidthMode = widthProfileActive;
    const profileId = priceSelectionMode === 'off'
      ? params.pcsContractProfile
      : dynamicSigmaActive
        ? (widthProfileActive ? 'dynamic-sigma-width-v1' : dynamicDteActive ? 'dynamic-sigma-dte-v1' : 'dynamic-v1')
        : (dynamicDteActive ? (widthProfileActive ? 'dynamic-dte-width-v1' : 'dynamic-dte-v1') : widthProfileActive ? 'dynamic-width-v1' : undefined);
    const profile = profileId
      ? selectPcsContractProfile(profileInput, profileId)
      : undefined;
    if (profileId && !profile) {
      warnings.push(`PCS ${profileId} 缺少冻结市场状态、VIX、VIX3M 或 RV20，拒绝生成候选`);
      return undefined;
    }
    const widthState = profile
      ? stressedProfile ? 'stressed' as const : mediumWidthState ? 'medium' as const : 'calm' as const
      : undefined;
    const pressureSizingMode = params.pcsPressureSizingMode ?? 'off';
    const pressureSizingState = stressedProfile ? 'stressed' as const : mediumWidthState ? 'medium' as const : 'calm' as const;
    const pressureSizingMediumMultiplier = Math.min(1, Math.max(0, params.pcsPressureSizingMediumMultiplier ?? .75));
    const pressureSizingStressedMultiplier = Math.min(1, Math.max(0, params.pcsPressureSizingStressedMultiplier ?? .5));
    const pressureSizingMultiplier = pressureSizingMode === 'state_v1'
      ? pressureSizingState === 'stressed' ? pressureSizingStressedMultiplier : pressureSizingState === 'medium' ? pressureSizingMediumMultiplier : 1
      : 1;
    const pcsRiskBudget = pcsBaseRiskBudget * pressureSizingMultiplier * riskEnvelopeMultiplier;
    // 压力仓位研究必须尊重折扣后的预算；否则 forceMinimumContract 会把所有减仓
    // 吞掉为 1 张，导致“减仓”与基线完全同解。生产 off 模式保留原行为。
    const pressureSizingEnforcesBudget = pressureSizingMode === 'state_v1';
    const pcsForceMinimumContract = pressureSizingEnforcesBudget ? false : params.forceMinimumContract;
    const selectedSigma = pcsStockDecision?.promotionSource === 'CARRY_OPEN' ? pcsStockDecision.selectedSigma ?? undefined : undefined;
    const profileSigma = usesPcsContractProfileFactor(profileId, 'sigma') ? profile?.shortStrikeSigma : undefined;
    const shortStrikeSigma = profileSigma ?? params.pcsShortStrikeSigma ?? selectedSigma;
    const survivalVolatilityScale = Math.min(2, Math.max(.5, params.pcsSurvivalSelectionVolatilityScale ?? 1));
    const dailySigma20 = rv20?.confidence ? (rv20.value / Math.sqrt(252)) * survivalVolatilityScale : undefined;
    const targetDte = usesPcsContractProfileFactor(profileId, 'dte') ? profile?.targetDte ?? pcsTargetDte : pcsTargetDte;
    const widthBlend = Math.min(1, Math.max(0, params.pcsSurvivalSelectionWidthBlend ?? 1));
    const dynamicWidthPct = usesPcsContractProfileFactor(profileId, 'width') ? profile?.widthPct ?? pcsWidthPct : pcsWidthPct;
    let widthPct = tailTriggeredWidthMode
      ? pcsWidthPct
      : pcsWidthPct + (dynamicWidthPct - pcsWidthPct) * widthBlend;
    let widthFallbackUsed = false;
    const buildAtSigma = (sigma?: PcsSigma, candidateWidthPct = widthPct) => buildPutCreditSpreadProposal({
      chain, underlying: proxySymbol, date: ctx.input.date, targetDte, shortDelta: pcsShortDelta,
      shortStrikeSigma: sigma,
      dailySigma20,
      widthPct: candidateWidthPct, nav, riskBudget: pcsRiskBudget, forceMinimumContract: pcsForceMinimumContract,
    });

    let built: ReturnType<typeof buildPutCreditSpreadProposal>;
    let pcsPriceSelection: OverlayProposal['pcsPriceSelection'];
    if (priceSelectionMode === 'off') {
      built = buildAtSigma(shortStrikeSigma);
    } else {
      if (!Number.isFinite(dailySigma20) || dailySigma20! <= 0) {
        warnings.push('PCS 生存率选价缺少有效日频 σ20，拒绝生成候选');
        return undefined;
      }
      const selectionMode = dynamicSigmaActive ? 'dynamic_v1_survival' : 'survival_only';
      const baseSigma = dynamicSigmaActive ? profile?.shortStrikeSigma : undefined;
      const candidateSigmas = params.pcsSurvivalSelectionCandidateSigmas
        ?? (stressTwoStepActive ? [2, 2.5] as const : candidateSigmasForPcsSurvivalSelection(selectionMode, baseSigma));
      const putStrikeSurvivalAsOf = ctx.input.putStrikeSurvivalAsOf;
      const historyBars = putStrikeSurvivalAsOf ? [] : prices.QQQ.filter((bar) => bar.date <= ctx.input.date);
      const putSurvivalAtAsOf = (spot: number, shortStrike: number, currentSigma: number, horizonDays: number) =>
        putStrikeSurvivalAsOf?.compute(ctx.input.date, spot, shortStrike, currentSigma, horizonDays)
          ?? computeStrikeSurvivalAtAsOf(historyBars, spot, shortStrike, currentSigma, horizonDays);
      const putTailLossAtAsOf = (
        spot: number,
        shortStrike: number,
        currentSigma: number,
        horizonDays: number,
        widthPct: number,
        credit: number,
        maxLoss: number,
      ) => putStrikeSurvivalAsOf?.computeTail(ctx.input.date, spot, shortStrike, currentSigma, horizonDays, widthPct, credit, maxLoss)
        ?? computeStrikeTailLossAtAsOf(historyBars, spot, shortStrike, currentSigma, horizonDays, widthPct, credit, maxLoss);
      const candidates: PcsSurvivalSelectionCandidate[] = [];
      const builtCandidates: Array<ReturnType<typeof buildPutCreditSpreadProposal>> = [];
      const horizonDays = (expiry: string) => {
        const [year, month, day] = ctx.input.date.slice(0, 10).split('-').map(Number);
        const [expiryYear, expiryMonth, expiryDay] = expiry.slice(0, 10).split('-').map(Number);
        if (![year, month, day, expiryYear, expiryMonth, expiryDay].every(Number.isFinite)) return 0;
        const cursor = new Date(Date.UTC(year!, month! - 1, day!));
        const end = new Date(Date.UTC(expiryYear!, expiryMonth! - 1, expiryDay!));
        let sessions = 0;
        while (cursor < end) {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          const weekday = cursor.getUTCDay();
          if (weekday > 0 && weekday < 6) sessions += 1;
        }
        return sessions;
      };
      if (tailTriggeredWidthMode) {
        const triggerRatio = Math.min(1, Math.max(0, params.pcsSurvivalSelectionTailWidthTriggerRatio ?? .75));
        const probeSigma = profile?.shortStrikeSigma ?? 2.5;
        const probeBuilt = buildPutCreditSpreadProposal({
          chain, underlying: proxySymbol, date: ctx.input.date, targetDte, shortDelta: pcsShortDelta,
          shortStrikeSigma: probeSigma, dailySigma20, widthPct: pcsWidthPct, nav, riskBudget: pcsRiskBudget, forceMinimumContract: pcsForceMinimumContract,
        });
        const probeProposal = probeBuilt.proposal;
        const probeShortStrike = probeProposal?.metadata.shortPutStrike;
        const probeLongStrike = probeProposal?.metadata.longPutStrike;
        const probeExpiry = probeProposal?.proposedStrikes.expiry;
        if (probeProposal && probeShortStrike !== undefined && probeLongStrike !== undefined && probeExpiry !== undefined) {
          const probeTail = putTailLossAtAsOf(
            chain.spot,
            probeShortStrike,
            dailySigma20!,
            horizonDays(probeExpiry),
            (probeShortStrike - probeLongStrike) / chain.spot,
            probeProposal.metadata.credit ?? 0,
            probeProposal.metadata.maxLoss,
          );
          const probeLoss = probeTail?.conditionalLossCvar75.value ?? probeTail?.conditionalLossP75.value;
          if (probeLoss !== null && probeLoss !== undefined && Number.isFinite(probeLoss)
            && probeLoss / probeProposal.metadata.maxLoss > triggerRatio) {
            widthPct = profile?.widthPct ?? pcsWidthPct;
          }
        }
      }
      const dynamicCandidateWidthPct = widthPct;
      const candidateWidthPcts = jointWidthMode
        ? [...new Set([widthPct, pcsWidthPct])]
        : [widthOnlyGuardedMode ? pcsWidthPct : widthPct];
      const baselineCreditBySigma = new Map<PcsSigma, number>();
      if (jointWidthMode) {
        for (const sigma of candidateSigmas) {
          const baselineProposal = buildAtSigma(sigma, pcsWidthPct).proposal;
          if (baselineProposal?.metadata.credit != null && Number.isFinite(baselineProposal.metadata.credit)) {
            baselineCreditBySigma.set(sigma, baselineProposal.metadata.credit);
          }
        }
      }
      for (const candidateWidthPct of candidateWidthPcts) for (const sigma of candidateSigmas) {
        const candidateBuilt = buildAtSigma(sigma, candidateWidthPct);
        const proposal = candidateBuilt.proposal;
        const shortStrike = proposal?.metadata.shortPutStrike;
        const longStrike = proposal?.metadata.longPutStrike;
        const expiry = proposal?.proposedStrikes.expiry;
        if (!proposal || shortStrike === undefined || longStrike === undefined || expiry === undefined) continue;
        const survival = putSurvivalAtAsOf(chain.spot, shortStrike, dailySigma20!, horizonDays(expiry));
        if (!survival) continue;
        const credit = proposal.metadata.credit ?? 0;
        const tail = pcsSelectionObjective === 'tail_aware_conditional_expected_pnl'
          || pcsSelectionObjective === 'tail_aware_conditional_p75_expected_pnl'
          || pcsSelectionObjective === 'tail_aware_conditional_cvar75_expected_pnl'
          || pcsSelectionObjective === 'constrained_tail_efficiency'
          || (stressTailVetoActive && params.pcsSurvivalSelectionStressTailVetoRatio !== undefined)
          ? putTailLossAtAsOf(
            chain.spot,
            shortStrike,
            dailySigma20!,
            horizonDays(expiry),
            (shortStrike - longStrike) / chain.spot,
            credit,
            proposal.metadata.maxLoss,
          )
          : null;
        candidates.push({
          sigma,
          widthPct: candidateWidthPct,
          baselineCredit: baselineCreditBySigma.get(sigma),
          shortStrike,
          credit,
          maxLoss: proposal.metadata.maxLoss,
          survival: survival.noTouch,
          tailLoss: tail?.conditionalLoss,
          tailLossP75: tail?.conditionalLossP75,
          tailLossCvar75: tail?.conditionalLossCvar75,
          tailDropPct: tail?.conditionalDropPct,
        });
        builtCandidates.push(candidateBuilt);
      }
      const selected = selectPcsSurvivalCandidate({
        mode: selectionMode,
        floor: stressedProfile
          ? (params.pcsSurvivalSelectionStressFloor ?? params.pcsSurvivalSelectionFloor ?? 0.4)
          : (params.pcsSurvivalSelectionFloor ?? 0.4),
        baseSigma,
        candidateSigmas,
        objective: pcsSelectionObjective,
        survivalWeight: dynamicSigmaActive
          ? (params.pcsSurvivalSelectionStressWeight ?? params.pcsSurvivalSelectionSurvivalWeight)
          : params.pcsSurvivalSelectionSurvivalWeight,
        survivalWilsonWeight: params.pcsSurvivalSelectionWilsonWeight,
        baseWidthPct: jointWidthMode ? pcsWidthPct : undefined,
        creditRetentionFloor: jointWidthMode ? params.pcsSurvivalSelectionCreditRetentionFloor : undefined,
        maxConditionalTailLossRatio: params.pcsSurvivalSelectionMaxConditionalLossRatio,
        tailVetoRatio: stressTailVetoActive ? params.pcsSurvivalSelectionStressTailVetoRatio : undefined,
        candidates,
      });
      if (!selected) {
        warnings.push(params.pcsSurvivalSelectionObjective === 'constrained_tail_efficiency'
          ? `PCS 约束式选价：没有候选同时满足 no-touch 下限与条件损失上限`
          : `PCS 生存率选价：没有候选满足 no-touch 下限 ${((params.pcsSurvivalSelectionFloor ?? 0.4) * 100).toFixed(0)}%`);
        return undefined;
      }
      const selectedCandidate = candidates[selected.selectedIndex]!;
      built = builtCandidates[selected.selectedIndex]!;
      widthPct = selectedCandidate.widthPct ?? widthPct;
      let selectedDiagnostic = selected.diagnostic;
      let widthSwitchBaselineScore: number | null = null;
      let widthSwitchCandidateScore: number | null = null;
      let widthSwitchScoreDelta: number | null = null;
      let widthSwitchScoreRatio: number | null = null;
      let widthSwitchAccepted: boolean | undefined;
      const widthTailImprovementMargin = params.pcsSurvivalSelectionWidthTailImprovementMargin === undefined
        ? null
        : Math.min(1, Math.max(0, params.pcsSurvivalSelectionWidthTailImprovementMargin));
      const widthTailSeverityRatio = (candidateBuilt: ReturnType<typeof buildAtSigma>): number | null => {
        if (widthTailImprovementMargin === null || !candidateBuilt.proposal) return null;
        const proposal = candidateBuilt.proposal;
        const shortStrike = proposal.metadata.shortPutStrike;
        const longStrike = proposal.metadata.longPutStrike;
        const expiry = proposal.proposedStrikes.expiry;
        if (shortStrike === undefined || longStrike === undefined || expiry === undefined || !Number.isFinite(proposal.metadata.maxLoss)) return null;
        const tail = putTailLossAtAsOf(
          chain.spot,
          shortStrike,
          dailySigma20!,
          horizonDays(expiry),
          (shortStrike - longStrike) / chain.spot,
          proposal.metadata.credit ?? 0,
          proposal.metadata.maxLoss,
        );
        const severity = tail?.conditionalLossCvar75.value
          ?? tail?.conditionalLossP75.value
          ?? tail?.conditionalLoss.value;
        return severity !== undefined && severity !== null && Number.isFinite(severity) && proposal.metadata.maxLoss > 0
          ? severity / proposal.metadata.maxLoss
          : null;
      };
      const widthTailGatePasses = (dynamicBuilt: ReturnType<typeof buildAtSigma>, fixedBuilt: ReturnType<typeof buildAtSigma>): boolean => {
        if (widthTailImprovementMargin === null) return true;
        const dynamicRatio = widthTailSeverityRatio(dynamicBuilt);
        const fixedRatio = widthTailSeverityRatio(fixedBuilt);
        return dynamicRatio !== null
          && fixedRatio !== null
          && dynamicRatio <= fixedRatio * (1 - widthTailImprovementMargin);
      };
      const expectedPnlAtSurvivalLower = (candidateBuilt: ReturnType<typeof buildAtSigma>, survivalLower: number | null): number | null => {
        if (!candidateBuilt.proposal || survivalLower === null || !Number.isFinite(survivalLower)) return null;
        const adjustedSurvival = 1 - selectedDiagnostic.survivalWeight
          + selectedDiagnostic.survivalWeight * Math.min(1, Math.max(0, survivalLower));
        return (candidateBuilt.proposal.metadata.credit ?? 0) * 100 * adjustedSurvival
          - candidateBuilt.proposal.metadata.maxLoss * (1 - adjustedSurvival);
      };
      if ((widthOnlyGuardedMode || widthOnlyV2WidthMode) && widthPct >= pcsWidthPct) {
        const dynamicBuilt = buildAtSigma(selected.diagnostic.selectedSigma, dynamicCandidateWidthPct);
        const dynamicProposal = dynamicBuilt.proposal;
        const dynamicShortStrike = dynamicProposal?.metadata.shortPutStrike;
        const dynamicLongStrike = dynamicProposal?.metadata.longPutStrike;
        const dynamicExpiry = dynamicProposal?.proposedStrikes.expiry;
        if (dynamicProposal && dynamicShortStrike !== undefined && dynamicLongStrike !== undefined && dynamicExpiry !== undefined
          && dynamicCandidateWidthPct < pcsWidthPct) {
          const creditRetentionFloor = params.pcsSurvivalSelectionCreditRetentionFloor;
          const fixedCredit = built.proposal?.metadata.credit;
          const dynamicCredit = dynamicProposal.metadata.credit;
          const creditRetained = fixedCredit != null && fixedCredit > 0 && dynamicCredit != null
            ? dynamicCredit / fixedCredit
            : null;
          const creditEligible = creditRetentionFloor === undefined
            || (creditRetained != null && creditRetained >= Math.min(1, Math.max(0, creditRetentionFloor)));
          const tailGatePassed = creditEligible && widthTailGatePasses(dynamicBuilt, built);
          if (!creditEligible || !tailGatePassed) {
            widthFallbackUsed = true;
            widthSwitchAccepted = false;
          } else {
          const dynamicSurvival = putSurvivalAtAsOf(
            chain.spot,
            dynamicShortStrike,
            dailySigma20!,
            horizonDays(dynamicExpiry),
          );
          if (dynamicSurvival) {
            const dynamicPoint = dynamicSurvival.noTouch.value ?? 0;
            const dynamicLower = dynamicSurvival.noTouch.interval?.lower ?? dynamicPoint;
            const dynamicRankedSurvival = dynamicPoint * (1 - selectedDiagnostic.wilsonWeight)
              + dynamicLower * selectedDiagnostic.wilsonWeight;
            const dynamicAdjustedSurvival = 1 - selectedDiagnostic.survivalWeight
              + selectedDiagnostic.survivalWeight * dynamicRankedSurvival;
            const dynamicExpectedPnl = widthExpectedPnlLcbMode
              ? expectedPnlAtSurvivalLower(dynamicBuilt, dynamicLower)
              : null;
            const fixedExpectedPnl = widthExpectedPnlLcbMode
              ? expectedPnlAtSurvivalLower(built, selectedDiagnostic.selectedNoTouchLower ?? selectedDiagnostic.selectedNoTouch)
              : null;
            const dynamicScore = widthExpectedPnlLcbMode
              ? dynamicExpectedPnl ?? -Infinity
              : widthOnlyV2WidthMode || selectedDiagnostic.objective === 'survival_adjusted_expected_pnl_v2'
              ? (dynamicProposal.metadata.credit ?? 0) * 100 * dynamicAdjustedSurvival
                - dynamicProposal.metadata.maxLoss * (1 - dynamicAdjustedSurvival)
              : (dynamicProposal.metadata.credit ?? 0) / dynamicProposal.metadata.maxLoss * dynamicAdjustedSurvival;
            const fixedWidthScore = widthExpectedPnlLcbMode
              ? fixedExpectedPnl ?? -Infinity
              : selectedDiagnostic.selectedObjectiveScore;
            widthSwitchBaselineScore = fixedWidthScore;
            widthSwitchCandidateScore = dynamicScore;
            widthSwitchScoreDelta = dynamicScore - fixedWidthScore;
            widthSwitchScoreRatio = fixedWidthScore > 0 ? dynamicScore / fixedWidthScore - 1 : null;
            const switchMargin = Math.min(1, Math.max(0, params.pcsSurvivalSelectionWidthSwitchMargin ?? 0));
            const deltaPnlFloor = Math.max(0, params.pcsSurvivalSelectionWidthDeltaPnlFloor ?? 0);
            widthSwitchAccepted = widthExpectedPnlLcbMode
              ? dynamicExpectedPnl !== null && fixedExpectedPnl !== null && dynamicExpectedPnl - fixedExpectedPnl > deltaPnlFloor
              : dynamicScore > fixedWidthScore * (1 + switchMargin);
            if (widthSwitchAccepted) {
              built = dynamicBuilt;
              widthPct = dynamicCandidateWidthPct;
              selectedDiagnostic = {
                ...selectedDiagnostic,
                selectedWidthPct: dynamicCandidateWidthPct,
                selectedNoTouch: dynamicPoint,
                selectedNoTouchLower: dynamicLower,
                selectedSurvivalForRanking: dynamicRankedSurvival,
                selectedObjectiveScore: dynamicScore,
              };
          } else {
            widthFallbackUsed = true;
            widthSwitchAccepted = false;
          }
        } else {
          widthFallbackUsed = true;
          widthSwitchAccepted = false;
        }
      }
        } else {
          widthFallbackUsed = true;
        }
      }
      if (!widthOnlyGuardedMode && !widthOnlyV2WidthMode && guardedWidthMode && !jointWidthMode && widthPct < pcsWidthPct && selectedDiagnostic.selectedSurvivalForRanking != null) {
        const fixedWidthBuilt = buildPutCreditSpreadProposal({
          chain, underlying: proxySymbol, date: ctx.input.date, targetDte, shortDelta: pcsShortDelta,
          shortStrikeSigma: selected.diagnostic.selectedSigma,
          dailySigma20, widthPct: pcsWidthPct, nav, riskBudget: pcsRiskBudget, forceMinimumContract: pcsForceMinimumContract,
        });
        const fixedWidthProposal = fixedWidthBuilt.proposal;
        if (fixedWidthProposal) {
          const survivalWeight = selectedDiagnostic.survivalWeight;
          const rankedSurvival = selectedDiagnostic.selectedSurvivalForRanking;
          const fixedWidthScore = (fixedWidthProposal.metadata.credit ?? 0) / fixedWidthProposal.metadata.maxLoss
            * (1 - survivalWeight + survivalWeight * rankedSurvival);
          const switchMargin = Math.min(1, Math.max(0, params.pcsSurvivalSelectionWidthSwitchMargin ?? 0));
          const dynamicWidthScore = selectedDiagnostic.selectedObjectiveScore;
          widthSwitchBaselineScore = fixedWidthScore;
          widthSwitchCandidateScore = dynamicWidthScore;
          widthSwitchScoreDelta = dynamicWidthScore - fixedWidthScore;
          widthSwitchScoreRatio = fixedWidthScore > 0 ? dynamicWidthScore / fixedWidthScore - 1 : null;
          widthSwitchAccepted = dynamicWidthScore > fixedWidthScore * (1 + switchMargin)
            && widthTailGatePasses(built, fixedWidthBuilt);
          if (!widthSwitchAccepted) {
            built = fixedWidthBuilt;
            widthPct = pcsWidthPct;
            widthFallbackUsed = true;
          }
        }
      }
      pcsPriceSelection = {
        ...selectedDiagnostic,
        dteMode: survivalSelectionDteMode,
        targetDte,
        widthMode: survivalSelectionWidthMode,
        widthPct,
        dynamicWidthPct: dynamicWidthMode ? dynamicWidthPct : undefined,
        widthBlend: dynamicWidthMode ? widthBlend : undefined,
        widthSwitchMargin: guardedWidthMode ? Math.min(1, Math.max(0, params.pcsSurvivalSelectionWidthSwitchMargin ?? 0)) : undefined,
        widthFallbackUsed: guardedWidthMode ? widthFallbackUsed : undefined,
        widthState,
        sigmaMode: survivalSelectionSigmaMode,
        dynamicSigmaActive,
        widthSwitchBaselineScore,
        widthSwitchCandidateScore,
        widthSwitchScoreDelta,
        widthSwitchScoreRatio,
        widthSwitchAccepted,
        pressureSizingMode,
        pressureSizingMultiplier,
        pressureSizingState,
      };
    }
    if (built.warning) warnings.push(built.warning);
    if (!built.proposal) return undefined;
    if (!pcsDynamicEntryProfile && params.pcsV121Gate === true && pcsV121StateBlocked) {
      const pcsV121SimpleRelease = isPcsV121Simple5Release({
        enabled: true,
        // 简化5研究口径使用状态引擎的 VIX；独立 PCS 的本地 `vix` 可能已切为 VXN。
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        range20dPct: regimeData?.range20d_pct,
        priceExtensionAtr,
        roc20: qqqROC20,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        tqqqRealisedVol20d,
        drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
        rsi14: regimeData?.rsi14,
        roc5: qqqROC5,
        priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
        weakeningSignalCount: regimeData?.weakening_signal_count,
        selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
        selectedSigma: pcsPriceSelection?.selectedSigma,
      });
      pcsV121Released = pcsV121SimpleRelease;
      pcsGateDiagnostics = {
        v121StateBlocked: pcsV121StateBlocked,
        v121SimpleRelease: pcsV121SimpleRelease,
        v121Released: false,
        selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
        selectedSigma: pcsPriceSelection?.selectedSigma,
      };
      if (candidateAReleaseActive || candidateAExpansionReleaseActive) {
        pcsV121Released = true;
      } else if (candidate3ExtraReleaseActive) {
        pcsV121Released = true;
      } else if (pcsResearchProfile === 'candidate3'
        && params.pcsCandidate3V121Release === 'sigma25_lower045_049_quarter'
        && isPcsCandidate3V121QuarterRelease({
          enabled: true,
          selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
          selectedSigma: pcsPriceSelection?.selectedSigma,
        })) {
        const quarterBuilt = buildPutCreditSpreadProposal({
          chain,
          underlying: proxySymbol,
          date: ctx.input.date,
          targetDte,
          shortDelta: pcsShortDelta,
          shortStrikeSigma: pcsPriceSelection?.selectedSigma ?? shortStrikeSigma,
          dailySigma20,
          widthPct: pcsPriceSelection?.selectedWidthPct ?? widthPct,
          nav,
          riskBudget: pcsBaseRiskBudget * pressureSizingMultiplier * .25,
          forceMinimumContract: false,
        });
        if (!quarterBuilt.proposal) {
          if (quarterBuilt.warning) warnings.push(`PCS 候选3 V1.2.1 25%释放：${quarterBuilt.warning}`);
          return undefined;
        }
        built = quarterBuilt;
        pcsV121Released = true;
      } else if (riskEnvelopeReleaseActive && !pcsV121SimpleRelease && riskEnvelope.band !== 'BLOCK') {
        if (riskEnvelope.band === 'HALF') {
          const halfBuilt = buildPutCreditSpreadProposal({
            chain,
            underlying: proxySymbol,
            date: ctx.input.date,
            targetDte,
            shortDelta: pcsShortDelta,
            shortStrikeSigma: pcsPriceSelection?.selectedSigma ?? shortStrikeSigma,
            dailySigma20,
            widthPct: pcsPriceSelection?.selectedWidthPct ?? widthPct,
            nav,
            riskBudget: pcsBaseRiskBudget * pressureSizingMultiplier * .5,
            forceMinimumContract: false,
          });
          if (!halfBuilt.proposal) {
            if (halfBuilt.warning) warnings.push(`PCS 风险包络 HALF：${halfBuilt.warning}`);
            return undefined;
          }
          built = halfBuilt;
        }
        pcsV121Released = true;
      }
      if (pcsGateDiagnostics) pcsGateDiagnostics.v121Released = pcsV121Released;
      if (!pcsV121Released) return undefined;
    }
    if (params.pcsV123Gate === true) {
      const pcsV123GateParts = evaluatePcsV123Gate({
      enabled: true,
      // V1.2.3 统一使用状态引擎的 VIX；独立 PCS 的本地 `vix` 可能是 VXN。
      vix: regimeData?.vix ?? vix,
      adx14: regimeData?.adx14,
      range20dPct: regimeData?.range20d_pct,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      priceExtensionAtr,
      roc20: qqqROC20,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      tqqqRealisedVol20d,
      rsi14: regimeData?.rsi14,
      roc5: qqqROC5,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      weakeningSignalCount: regimeData?.weakening_signal_count,
      selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
      selectedSigma: pcsPriceSelection?.selectedSigma,
      b30ReleaseLower: params.pcsV123B30ReleaseLower,
      releaseClass: params.pcsV123ReleaseClass,
      });
      pcsV123BlockedBy = pcsV123GateParts.blockedBy;
      const pcsNativeP0A9QualityRelease =
        params.pcsNativeP0A9QualityRelease === true &&
        pcsV123GateParts.a9 &&
        isPcsNativeP0A9QualityRelease({
          enabled: true,
          vix: regimeData?.vix ?? vix,
          adx14: regimeData?.adx14,
          range20dPct: regimeData?.range20d_pct,
          priceExtensionAtr,
          roc20: qqqROC20,
          regime,
          slowSubregime:
            typeof slowSubregimeState === 'string'
              ? slowSubregimeState
              : undefined,
          tqqqRealisedVol20d,
          drawdownFromRecentHighPct:
            regimeData?.drawdown_from_recent_high_pct,
          rsi14: regimeData?.rsi14,
          roc5: qqqROC5,
          priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
          weakeningSignalCount: regimeData?.weakening_signal_count,
        });
      if (candidateAReleaseActive || candidateAExpansionReleaseActive || (params.pcsNativeP0A9Release === true && pcsV123GateParts.a9) || pcsNativeP0A9QualityRelease || (isCandidateARescueProfile && candidate3ExtraReleaseActive && candidate3BaseEnvelope.band === 'FULL') || ((pcsResearchProfile === 'candidate3' || pcsResearchProfile === 'candidate4' || (pcsResearchProfile === 'candidateA' && candidate3ExtraReleaseActive)) && (candidate3BaseEnvelope.band === 'FULL' || candidate3ExtraReleaseActive))) {
        // Candidate3 research arm: the four validated downstream pockets release
        // the remaining V1.2.3 block after the same selected-leg checks. P0 uses
        // its explicit state-pool release instead of the older envelope shortcut.
        pcsV123BlockedBy = [];
      }
      if (!pcsDynamicEntryProfile && pcsV123BlockedBy.length > 0) return undefined;
    }
    if (!pcsDynamicEntryProfile && params.pcsV122Gate === true && isPcsV122GateBlocked({
      enabled: true,
      // V1.2.2 统一使用状态引擎的 VIX；独立 PCS 的本地 `vix` 可能是 VXN。
      vix: regimeData?.vix ?? vix,
      adx14: regimeData?.adx14,
      range20dPct: regimeData?.range20d_pct,
      priceExtensionAtr,
      roc20: qqqROC20,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      tqqqRealisedVol20d,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      rsi14: regimeData?.rsi14,
      roc5: qqqROC5,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      weakeningSignalCount: regimeData?.weakening_signal_count,
      selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
      selectedSigma: pcsPriceSelection?.selectedSigma,
    })) return undefined;
    if (pcsDynamicEntryProfile) {
      const dynamicDecision = pcsDynamicEntryProfile.evaluate({
        date: ctx.input.date,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        vxn: macro.vxn,
        tqqqRealisedVol20d,
        qqqROC20,
        qqqROC5,
        vixTermStructureSlope: Number.isFinite(vix) && Number.isFinite(vix3m) ? vix3m! - vix : undefined,
        vixChange5d: regimeData?.vix_change_5d,
        range20dPct: regimeData?.range20d_pct,
        ma50SlopePct: regimeData?.ma50_slope_pct,
        sma20SlopePct: regimeData?.sma20_slope_pct,
        distanceToSma20Pct: regimeData?.distanceToSma20Pct,
        trendScore: ctx.results.trend?.data.score,
        priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
        priceExtensionAtr,
        adx14: regimeData?.adx14,
        rsi14: regimeData?.rsi14,
        weakeningSignalCount: regimeData?.weakening_signal_count,
        drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
        history: [...(ctx.input.pcsDynamicMarketHistory ?? []), {
          regime,
          slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
          vix: regimeData?.vix ?? vix,
          tqqqRealisedVol20d,
          qqqROC20,
          qqqROC5,
          vixTermStructureSlope: Number.isFinite(vix) && Number.isFinite(vix3m) ? vix3m! - vix : undefined,
          vixChange5d: regimeData?.vix_change_5d,
          range20dPct: regimeData?.range20d_pct,
          ma50SlopePct: regimeData?.ma50_slope_pct,
          sma20SlopePct: regimeData?.sma20_slope_pct,
          distanceToSma20Pct: regimeData?.distanceToSma20Pct,
          trendScore: ctx.results.trend?.data.score,
          priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
          priceExtensionAtr,
          adx14: regimeData?.adx14,
          rsi14: regimeData?.rsi14,
          weakeningSignalCount: regimeData?.weakening_signal_count,
          drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
        }],
        selectedNoTouchLower: pcsPriceSelection?.selectedNoTouchLower,
        selectedSigma: pcsPriceSelection?.selectedSigma,
        openCredit: built.proposal.metadata.credit,
        shortStrike: built.proposal.metadata.shortPutStrike,
        longStrike: built.proposal.metadata.longPutStrike,
        expiry: built.proposal.proposedStrikes.expiry,
        hasOpenPcs: (ctx.input.account.optionPositions ?? []).some((position) => position.strategyTag === 'QQQ_PUT_CREDIT_SPREAD'),
        lastSettledPnl: ctx.input.pcsResearchP1LastSettledPnl,
        safetyConditionsMet: pcsSafetyConditionsMet,
        streakCooldownBlocked: pcsStreakCooldownBlocked,
        // Keep the parent admission seam on the same raw signal facts as the
        // engine's ordinary PCS trigger. `pcsNormalSignalPassed` intentionally
        // excludes research rescue releases, while the historical P4 parent
        // uses the ordinary `original || page` signal. Using the narrower
        // helper here silently removed valid parent trades from the dynamic
        // replay.
        normalP4GatePassed: !pcsExcludedByRiskOnWeakening
          && !pcsChopVixBlocked
          && !pcsBass221Blocked
          && !pcsV11Blocked
          && !pcsBass232Candidate2Blocked
          && !pcsBass232Candidate3Blocked
          && !pcsV12Blocked
          && !pcsNativeP1R1EntryBlocked
          && !pcsNativeP1ResidualFilterBlocked
          && !pcsCandidateAEntryBlocked
          && !pcsResearchEntryFilterBlocked
          && (pcsOriginalSignal || pcsPageSignal)
          && (params.pcsV121Gate !== true || !pcsV121StateBlocked || pcsV121Released === true)
          && (params.pcsV123Gate !== true || pcsV123BlockedBy.length === 0),
        dynamicExtensionEligible: pcsReactiveTiming?.eligible === false || pcsV121StateBlocked || pcsV123BlockedBy.length > 0,
        backwardationOnly: pcsSafetyBlockers.length === 1 && pcsSafetyBlockers[0] === 'BACKWARDATED_TERM',
        normalP4SignalPassed: pcsNormalSignalPassed,
      });
      if (!dynamicDecision.allowed) {
        warnings.push(`PCS 动态 profile 阻断：${dynamicDecision.reason ?? '未通过'}`);
        return undefined;
      }
    }
    return {
      action: 'ADD_PUT_CREDIT_SPREAD',
      overlay_type: 'proxyOverlay',
      proposed_strikes: built.proposal.proposedStrikes,
      premium_estimate: built.proposal.premiumEstimate,
      cs_max_risk_pct: built.proposal.maxRiskPct,
      putCreditSpread: built.proposal.metadata,
      pcsPriceSelection,
    };
  };

  /**
   * PCS_RESCUE 独立补位层：只在主 PCS 没有形成 proposal 时构建，使用独立的
   * Delta/宽度/风险预算，不改写主 PCS 的生存率选腿与版本闸。
   */
  let pcsRescueResearchPathAllowed = true;
  let pcsRescueResearchFallbackAllowed = true;
  let pcsRescueShadowP3PathDiagnostic: NonNullable<OverlayData['pcsGateDiagnostics']>['pcsRescueShadowP3Path'];
  const buildPcsRescueProposal = (): OverlayProposal | undefined => {
    if (!pcsRescueResearchFallbackAllowed) return undefined;
    if (!pcsRescueSourceActive) return undefined;
    const lowRv = !Number.isFinite(tqqqRealisedVol20d) || tqqqRealisedVol20d! < .40;
    const lowRvReopenByE182Quality = params.pcsRescueResearchVetoE182QualityRelease === true
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0
      && ((Number.isFinite(qqqEr20) && qqqEr20! >= .15)
        || (Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix) <= 16));
    const lowRvReopenByVixCeiling = Number.isFinite(params.pcsRescueResearchVetoLowRvVixCeiling)
      && Number.isFinite(regimeData?.vix ?? vix)
      && (regimeData?.vix ?? vix) <= params.pcsRescueResearchVetoLowRvVixCeiling!;
    const lowRvReopenByEr20 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_v1'
      && Number.isFinite(qqqEr20)
      && qqqEr20! < .20;
    const lowRvReopenByEr20OrAdx16 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_adx_lt16_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 16));
    const lowRvReopenByEr20OrRoc5 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0));
    const lowRvReopenByEr20OrRoc5OrVix20 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20));
    const lowRvReopenByEr20OrRoc5OrVix20OrSideways = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS');
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRext = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || regime === 'BULL'
        || regime === 'RISK_ON_EXTENDED');
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22)
          && (Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrAdx28Slope02 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_adxlt28_slope02_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 28)
          && (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02))
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrRv40 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_rvge40_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .40)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrRv40 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_rvge40_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .40)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20Er20 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0
          && Number.isFinite(qqqEr20) && qqqEr20! < .40)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20Er20OrEr20Range08 = params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_or_er20lt07_range08_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 20)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30 && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0
          && Number.isFinite(qqqEr20) && qqqEr20! < .40)
        || (Number.isFinite(qqqEr20) && qqqEr20! < .70
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))));
    const lowRvReopenByR7E596CompactBase = params.pcsRescueResearchVetoMode === 'r7_e596_compact_base_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25)))
        || (Number.isFinite(qqqEr20) && qqqEr20! < .70
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08));
    const lowRvReopenByR7E596CompactSlope = params.pcsRescueResearchVetoMode === 'r7_e596_compact_slope_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25)))
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(qqqEr20) && qqqEr20! < .70
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08));
    const lowRvReopenByR7E596CompactAdx = params.pcsRescueResearchVetoMode === 'r7_e596_compact_adx_v1'
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25)))
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0
          && Number.isFinite(qqqEr20) && qqqEr20! < .40)
        || (Number.isFinite(qqqEr20) && qqqEr20! < .70
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08));
    const lowRvReopenByR7E596CompactExact = (params.pcsRescueResearchVetoMode === 'r7_e596_compact_exact_v1'
      || params.pcsRescueResearchVetoMode === 'r8_e0_compact_exact_v1'
      || params.pcsRescueResearchVetoMode === 'r8_e1_atrlt2_vixchange02_v1'
      || params.pcsRescueResearchVetoMode === 'r8_e2_sma200lt005_v1'
      || params.pcsRescueResearchVetoMode === 'r8_e2_adxlt30_ma50slope03_v1'
      || params.pcsRescueResearchVetoMode === 'r8_e3_er20ge04_roc5ge02_v1'
      || params.pcsRescueResearchVetoMode === 'r9_e309_lowrv_new_release_fixed05_v1'
      || params.pcsRescueResearchVetoMode === 'r9_e317_lowrv_new_release_fixed10_v1'
      || params.pcsRescueResearchVetoMode === 'r9_e318_lowrv_new_release_fixed10_width03_v1'
      || String(params.pcsRescueResearchVetoMode) === 'r9_e310_lowrv_new_release_dte21_v1'
      || String(params.pcsRescueResearchVetoMode) === 'r9_e312_lowrv_new_release_width06_v1')
      && ((Number.isFinite(qqqEr20) && qqqEr20! < .20)
        || (Number.isFinite(qqqROC5) && qqqROC5! < 0)
        || regime === 'SIDEWAYS'
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! < 12)
        || (Number.isFinite(regimeData?.vix) && regimeData!.vix! >= 16)
        || ((regime === 'BULL' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 22 && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 1)
            || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80 && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .25))
          )
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30
          && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 20
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0
          && Number.isFinite(qqqEr20) && qqqEr20! < .40)
        || (Number.isFinite(qqqEr20) && qqqEr20! < .70
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .08)
        || ((params.pcsRescueResearchVetoMode === 'r8_e1_atrlt2_vixchange02_v1' || params.pcsRescueResearchVetoMode === 'r8_e2_sma200lt005_v1' || params.pcsRescueResearchVetoMode === 'r8_e2_adxlt30_ma50slope03_v1' || params.pcsRescueResearchVetoMode === 'r8_e3_er20ge04_roc5ge02_v1')
          && Number.isFinite(priceExtensionAtr) && priceExtensionAtr! < 2
          && Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! >= .02)
        || (params.pcsRescueResearchVetoMode === 'r8_e2_sma200lt005_v1'
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! < .05)
        || ((params.pcsRescueResearchVetoMode === 'r8_e2_adxlt30_ma50slope03_v1' || params.pcsRescueResearchVetoMode === 'r8_e3_er20ge04_roc5ge02_v1')
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 30
          && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .03)
        || (params.pcsRescueResearchVetoMode === 'r8_e3_er20ge04_roc5ge02_v1'
          && Number.isFinite(qqqEr20) && qqqEr20! >= .40
          && Number.isFinite(qqqROC5) && qqqROC5! >= .02));
    if ((params.pcsRescueResearchVetoMode === 'rv20_ge40_v1' && lowRv)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_v1' && lowRv && !lowRvReopenByEr20)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_adx_lt16_v1' && lowRv && !lowRvReopenByEr20OrAdx16)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_v1' && lowRv && !lowRvReopenByEr20OrRoc5)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSideways)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRext)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_adxlt28_slope02_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrAdx28Slope02)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_rvge40_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrRv40)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_rvge40_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrRv40)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20Er20)
      || (params.pcsRescueResearchVetoMode === 'rv20_ge40_or_er20_lt20_or_roc5_lt0_or_vix_ge20_or_sideways_or_bull_rext_adxlt22_atrge1_or_trendge80_rvge25_or_vixlt12_or_vixge16_or_adxlt30_roc5ge02_or_ma50slope03_range05_or_adxlt20_roc20ge0_er20lt04_or_er20lt07_range08_v1' && lowRv && !lowRvReopenByEr20OrRoc5OrVix20OrSidewaysOrBullRextAdx22Atr1OrTrend80Rv25OrVix12OrVix16OrAdx30Roc5OrSlope03Range05OrAdx20Roc20Er20OrEr20Range08)
      || (params.pcsRescueResearchVetoMode === 'r7_e596_compact_base_v1' && lowRv && !lowRvReopenByR7E596CompactBase)
      || (params.pcsRescueResearchVetoMode === 'r7_e596_compact_slope_v1' && lowRv && !lowRvReopenByR7E596CompactSlope)
      || (params.pcsRescueResearchVetoMode === 'r7_e596_compact_adx_v1' && lowRv && !lowRvReopenByR7E596CompactAdx)
      || ((params.pcsRescueResearchVetoMode === 'r7_e596_compact_exact_v1' || params.pcsRescueResearchVetoMode === 'r8_e0_compact_exact_v1' || params.pcsRescueResearchVetoMode === 'r8_e1_atrlt2_vixchange02_v1' || params.pcsRescueResearchVetoMode === 'r8_e2_sma200lt005_v1' || params.pcsRescueResearchVetoMode === 'r8_e2_adxlt30_ma50slope03_v1' || params.pcsRescueResearchVetoMode === 'r8_e3_er20ge04_roc5ge02_v1') && lowRv && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling)) return undefined;
    const rescueQualityVix = regimeData?.vix ?? Number.POSITIVE_INFINITY;
    const rescueLossQualityAdxMax = params.pcsRescueLossQualityAdxMax ?? 15;
    const rescueLossQualitySidewaysVixMin = params.pcsRescueLossQualitySidewaysVixMin ?? 30;
    const rescueLossQualityBullVixMin = params.pcsRescueLossQualityBullVixMin ?? 24;
    const bullLowVixAdx = regime === 'BULL' && slowSubregimeState === 'SR02' && rescueQualityVix < 12 && (regimeData?.adx14 ?? Number.POSITIVE_INFINITY) < rescueLossQualityAdxMax;
    const bullHighVol = regime === 'BULL' && slowSubregimeState === 'SR02' && rescueQualityVix >= rescueLossQualityBullVixMin && (tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) >= .60;
    const sidewaysHighVol = regime === 'SIDEWAYS' && slowSubregimeState === 'SR02' && rescueQualityVix >= rescueLossQualitySidewaysVixMin && (tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) >= .60;
    const rescueLossQualityBlocked =
      (params.pcsRescueLossQualityFilter === 'bullLowVixAdx' && bullLowVixAdx) ||
      (params.pcsRescueLossQualityFilter === 'sidewaysHighVol' && sidewaysHighVol) ||
      (params.pcsRescueLossQualityFilter === 'bullHighVol' && bullHighVol) ||
      (params.pcsRescueLossQualityFilter === 'combined' && (bullLowVixAdx || bullHighVol || sidewaysHighVol));
    if (rescueLossQualityBlocked) return undefined;
    const targetDte = String(params.pcsRescueResearchVetoMode) === 'r9_e310_lowrv_new_release_dte21_v1'
      && lowRv && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling
      ? 21
      : params.pcsRescueTargetDte ?? params.pcsTargetDte ?? SPREAD_TARGET_DTE;
    const extremeWidthPct = resolvePcsRescueExtremeWidth({
      profile: params.pcsRescueExtremeWidthProfile,
      extremeWidthPct: params.pcsRescueExtremeWidthPct ?? params.pcsRescueWidthPct ?? .02,
      narrowWidthPct: params.pcsRescueExtremeWidthNarrowPct,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      vix: regimeData?.vix ?? vix,
      adx14: regimeData?.adx14,
      extremePressure: pcsRescueExtremeExtended,
    });
    const baseWidthPct = params.pcsRescueWidthPct ?? .02;
    const lowRvNewReleaseWide = String(params.pcsRescueResearchVetoMode) === 'r9_e312_lowrv_new_release_width06_v1'
      && lowRv && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling;
    const conditionalWideWidthPct = params.pcsRescueResearchWidthMode === 'non_bull_wide_v1'
      && regime !== 'BULL'
      ? Math.max(baseWidthPct, lowRvNewReleaseWide ? .06 : params.pcsRescueResearchWidthPct ?? .0225)
      : baseWidthPct;
    const widthPct = pcsRescueExtremeExtended ? extremeWidthPct ?? conditionalWideWidthPct : conditionalWideWidthPct;
    const rangeP3ContractMode = params.pcsRescueResearchRangeContractMode;
    const e456BaseTiming = params.pcsRescueResearchComplementMode === 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1'
      && isPcsRescueResearchComplementTiming({
        mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        rv20: tqqqRealisedVol20d,
        priceExtensionAtr,
        roc5: qqqROC5,
        roc20: qqqROC20,
        qqqEr20,
        vixChange5d: csVixChange5d,
        weakeningSignalCount: regimeData?.weakening_signal_count,
      });
    const e73P3RangeResidualState = String(params.pcsRescueResearchComplementMode) === 'r9_e65_or_p3_e526_range_residual_v1'
      && regime === 'RANGE_BOUND'
      && (slowSubregimeState === 'SR01' || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12))
      && !isPcsRescueResearchComplementTiming({
        mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        rv20: tqqqRealisedVol20d,
        priceExtensionAtr,
        roc5: qqqROC5,
        roc20: qqqROC20,
        qqqEr20,
        vixChange5d: csVixChange5d,
        weakeningSignalCount: regimeData?.weakening_signal_count,
      });
    const rangeP3ContractActive = (rangeP3ContractMode === 'p3_sigma2_width03925_v1' || rangeP3ContractMode === 'p3_sigma2_width03925_complement_only_v1')
      && (params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_atr_sr01_v1'
        || params.pcsRescueResearchComplementMode === 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1'
        || String(params.pcsRescueResearchComplementMode) === 'r9_e65_plus_p3_e526_range_path_v1'
        || String(params.pcsRescueResearchComplementMode) === 'r9_e65_or_p3_e526_range_residual_v1')
      && !e456BaseTiming
      && (String(params.pcsRescueResearchComplementMode) === 'r9_e65_or_p3_e526_range_residual_v1'
        ? e73P3RangeResidualState
        : regime === 'RANGE_BOUND'
          && (rangeP3ContractMode !== 'p3_sigma2_width03925_complement_only_v1' || pcsReactiveTiming?.eligible !== true)
          && (slowSubregimeState === 'SR01' || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12)));
    const lowRvNewReleaseWidth03 = String(params.pcsRescueResearchVetoMode) === 'r9_e318_lowrv_new_release_fixed10_width03_v1'
      && lowRv && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling;
    const rescueContractWidthPct = lowRvNewReleaseWidth03 ? .03 : rangeP3ContractActive ? .03925 : widthPct;
    const rescueContractSigma = rangeP3ContractActive ? 2 as const : undefined;
    const rescueContractDailySigma20 = rangeP3ContractActive && Number.isFinite(tqqqRealisedVol20d)
      ? tqqqRealisedVol20d! / Math.sqrt(252)
      : undefined;
    const riskBudget = Math.max(0, params.pcsRescueRiskBudgetNav ?? .005);
    const delta = (params.pcsRescueResearchVetoMode === 'r9_e308_lowrv_release_fixed05_v1' && lowRv)
      || (params.pcsRescueResearchVetoMode === 'r9_e309_lowrv_new_release_fixed05_v1' && lowRv
        && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling)
      ? .005
      : ((params.pcsRescueResearchVetoMode === 'r9_e317_lowrv_new_release_fixed10_v1'
        || params.pcsRescueResearchVetoMode === 'r9_e318_lowrv_new_release_fixed10_width03_v1') && lowRv
        && !lowRvReopenByR7E596CompactExact && !lowRvReopenByE182Quality && !lowRvReopenByVixCeiling)
        ? .10
      : pcsRescueResearchRegimeRelease
      && !pcsRescueRegimeAllowedBase
      && (pcsRescueResearchRegimeReleaseMode === 'vxn_gt_vix_scope_source_fixed05_v1'
        || pcsRescueResearchRegimeReleaseMode === 'roc5nonneg_lt03_er15orvixle16_scope_fixed25_v1'
        || pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_fixed25_v1'
        || pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_fixed05_v1')
      ? (pcsRescueResearchRegimeReleaseMode === 'weakening_count_le1_scope_source_fixed05_v1'
        || pcsRescueResearchRegimeReleaseMode === 'vxn_gt_vix_scope_source_fixed05_v1') ? .005 : .025
      : resolvePcsRescueShortDelta({
      mode: pcsRescueDeltaMode,
      fixedDelta: params.pcsRescueShortDelta,
      calmDelta: params.pcsRescueCalmDelta,
      normalDelta: params.pcsRescueNormalDelta,
      pressureDelta: params.pcsRescuePressureDelta,
      regime,
      slowSubregime: slowSubregimeState,
      vix: regimeData?.vix ?? vix,
      vixTermStructureSlope: Number.isFinite(vix) && Number.isFinite(vix3m) ? vix3m! - vix : undefined,
      rv20: tqqqRealisedVol20d,
      adx14: regimeData?.adx14,
      trendScore: ctx.results.trend?.data.score,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      priceExtensionAtr,
      range20dPct: regimeData?.range20d_pct,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      preCrisisActive: csPreCrisisActive,
      versionPressure: pcsV121StateBlocked,
      extremePressure: pcsRescueExtremeExtended,
      extremeDelta: params.pcsRescueExtremeDelta,
      extremeBaseDelta: params.pcsRescueExtremeBaseDelta,
      extremeFallbackDelta: params.pcsRescueExtremeFallbackDelta,
      });
    const shadowP3PathState = params.pcsRescueResearchShadowP3Path === true
      && params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_atr_sr01_v1'
      && regime === 'RANGE_BOUND'
      && pcsReactiveTiming?.eligible !== true
      && !pcsOriginalSignal
      && !pcsPageSignal
      && !pcsRescueRegimeAllowedBase
      && (slowSubregimeState === 'SR01' || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12));
    let shadowP3PathAllowed = true;
    let shadowP3Proposal: ReturnType<typeof buildPutCreditSpreadProposal> | undefined;
    if (shadowP3PathState) {
      const shadowDailySigma20 = Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! > 0
        ? tqqqRealisedVol20d! / Math.sqrt(252)
        : undefined;
      const shadowProbe = shadowDailySigma20 === undefined ? undefined : buildPutCreditSpreadProposal({
        chain,
        underlying: proxySymbol,
        date: ctx.input.date,
        targetDte,
        shortDelta: delta,
        shortStrikeSigma: 2,
        dailySigma20: shadowDailySigma20,
        widthPct: .03925,
        nav,
        riskBudget,
        forceMinimumContract: false,
      });
      shadowP3Proposal = shadowProbe;
      const shadowShortStrike = shadowProbe?.proposal?.metadata.shortPutStrike;
      const shadowExpiry = shadowProbe?.proposal?.proposedStrikes.expiry;
      const shadowBars = ctx.input.putStrikeSurvivalAsOf ? [] : prices.QQQ.filter((bar) => bar.date <= ctx.input.date);
      const shadowHorizonDays = (expiry: string) => {
        const [year, month, day] = ctx.input.date.slice(0, 10).split('-').map(Number);
        const [expiryYear, expiryMonth, expiryDay] = expiry.slice(0, 10).split('-').map(Number);
        if (![year, month, day, expiryYear, expiryMonth, expiryDay].every(Number.isFinite)) return 0;
        const cursor = new Date(Date.UTC(year!, month! - 1, day!));
        const end = new Date(Date.UTC(expiryYear!, expiryMonth! - 1, expiryDay!));
        let sessions = 0;
        while (cursor < end) { cursor.setUTCDate(cursor.getUTCDate() + 1); const weekday = cursor.getUTCDay(); if (weekday > 0 && weekday < 6) sessions += 1; }
        return sessions;
      };
      const shadowSurvival = shadowShortStrike !== undefined && shadowExpiry !== undefined
        ? ctx.input.putStrikeSurvivalAsOf?.compute(ctx.input.date, chain.spot, shadowShortStrike, shadowDailySigma20!, shadowHorizonDays(shadowExpiry))
          ?? computeStrikeSurvivalAtAsOf(shadowBars, chain.spot, shadowShortStrike, shadowDailySigma20!, shadowHorizonDays(shadowExpiry))
        : undefined;
      const shadowLower = shadowSurvival?.noTouch.interval?.lower;
      shadowP3PathAllowed = shadowProbe?.proposal !== undefined
        && shadowSurvival !== undefined
        && Number.isFinite(shadowLower)
        && shadowLower! < .35;
      pcsRescueShadowP3PathDiagnostic = {
        active: true,
        allowed: shadowP3PathAllowed,
        probeBuilt: shadowProbe?.proposal !== undefined,
        lower: shadowLower,
        shortStrike: shadowShortStrike,
        expiry: shadowExpiry,
      };
    } else {
      pcsRescueShadowP3PathDiagnostic = { active: false, allowed: true, probeBuilt: false };
    }
    if (shadowP3PathState && !shadowP3PathAllowed) return undefined;
    const rescuePairVix = regimeData?.vix ?? vix;
    const rescuePairAdx = regimeData?.adx14 ?? Number.NEGATIVE_INFINITY;
    const r6PairBase = (regime === 'SIDEWAYS' && rescuePairVix < 20)
      || (regime === 'BULL' && (
        rescuePairVix < 12
        || (rescuePairVix >= 12 && rescuePairVix < 14 && rescuePairAdx >= 10)
        || (rescuePairVix >= 14 && rescuePairVix < 15 && rescuePairAdx >= 15)
      ));
    const r6PairWithBullBand = (minVix: number, maxVix: number, minAdx: number) =>
      r6PairBase || (regime === 'BULL' && rescuePairVix >= minVix && rescuePairVix < maxVix && rescuePairAdx >= minAdx);
    const r6e0gPairBase = r6PairWithBullBand(15, 17, 15);
    const r6e0gPairWithTail = (minAdx: number) =>
      r6e0gPairBase || (regime === 'BULL' && rescuePairVix >= 17 && rescuePairVix < 18 && rescuePairAdx >= minAdx);
    const r6e0gPairWithTailQuality = (quality: 'sr02' | 'roc20') =>
      r6e0gPairBase || (regime === 'BULL' && rescuePairVix >= 17 && rescuePairVix < 18 && rescuePairAdx >= 20
        && (quality === 'sr02' ? slowSubregimeState === 'SR02' : qqqROC20 >= 0));
    const r6e2PairWithTailAdx = (minAdx: number) =>
      r6e0gPairBase || (regime === 'BULL' && rescuePairVix >= 17 && rescuePairVix < 18 && rescuePairAdx >= minAdx && qqqROC20 >= 0);
    const r6e3PairBase = r6e2PairWithTailAdx(10);
    const r6e3PairWithVix20Tail = (minAdx: number) =>
      r6e3PairBase || (regime === 'BULL' && rescuePairVix >= 18 && rescuePairVix < 20 && rescuePairAdx >= minAdx && qqqROC20 >= 0);
    const r6e4PairBase = r6e3PairWithVix20Tail(10);
    const r6e4PairWithVix22Tail = (minAdx: number) =>
      r6e4PairBase || (regime === 'BULL' && rescuePairVix >= 20 && rescuePairVix < 22 && rescuePairAdx >= minAdx && qqqROC20 >= 0);
    const r6e5PairBase = r6e4PairWithVix22Tail(20);
    const r6e5PairWithVix24Tail = (minAdx: number) =>
      r6e5PairBase || (regime === 'BULL' && rescuePairVix >= 22 && rescuePairVix < 24 && rescuePairAdx >= minAdx && qqqROC20 >= 0);
    const r6e6PairBase = r6e5PairWithVix24Tail(10);
    const r6e6PairWithVix26Tail = (minAdx: number) =>
      r6e6PairBase || (regime === 'BULL' && rescuePairVix >= 24 && rescuePairVix < 26 && rescuePairAdx >= minAdx && qqqROC20 >= 0);
    const negativePriceExtensionAtr = (priceExtensionAtr ?? Number.POSITIVE_INFINITY) < 0;
    const pairSearchE84FixedEr08 = String(params.pcsRescuePairSearchMode) === 'nearest_valid_r9_e84_e447_bull_sr02_adxlt10_er08_v1';
    const pairSearchE90UnifiedRoc5 = String(params.pcsRescuePairSearchMode) === 'nearest_valid_r9_e90_e447_weakvix_or_bull_lowadx_roc5ge0_v1';
    const pairSearchE93WeakRecoveryOrStrength = String(params.pcsRescuePairSearchMode) === 'nearest_valid_r9_e93_e447_weakvix_roc5ge0_or_adxge25_or_bull_lowadx_er08_v1';
    const pairSearchE95WeakAdx25BullLowErRecovery = String(params.pcsRescuePairSearchMode) === 'nearest_valid_r9_e95_e447_weakadx25_or_bull_lowadx_er08_or_roc5ge0_v1';
    const pairSearchE85ErFloorToken = String(params.pcsRescuePairSearchMode).match(/^nearest_valid_r9_e85_e447_er(0_08|0_10|0_12)_weakvix_or_bull_lowadx_v1$/)?.[1];
    const pairSearchE85ErFloor = pairSearchE85ErFloorToken === undefined ? undefined : Number(pairSearchE85ErFloorToken.replace('_', '.'));
    const pairSearchE88WeakSignal = String(params.pcsRescuePairSearchMode).match(/^nearest_valid_r9_e88_e447_weakvix_(roc20_ge_neg05|roc20_ge_neg04|roc20_ge_neg03|roc5_ge0|vixchange5d_lt0|adx_ge20|adx_ge22|adx_ge23|adx_ge24|adx_ge25|adx_ge26|adx_ge(?:20|22|23)_er08|adx_ge(?:20|22|23)_er08_or_ge24|adx_ge24_vix_lt(?:21_5|22|23)|adx_ge24_or_trend_(?:le35|lt40|lt45)|adx_ge24_or_roc5_ge0|adx_ge24_or_roc5_ge0_or_trend_le35|roc5_ge0_or_trend_le35|adx_ge24_or_trend_lt45_roc5_ge0|adx_ge24_or_trend_le35_or_trend_lt45_adx_ge(?:20|22|24)|adx_ge24_or_rsi_ge40|adx_ge24_or_sma200_ge0|adx_ge24_or_rv20_lt50)_or_bull_lowadx_er08_v1$/)?.[1];
    const pairSearchE88VixCeilingToken = pairSearchE88WeakSignal?.match(/_vix_lt(21_5|22|23)$/)?.[1];
    const pairSearchE88VixCeiling = pairSearchE88VixCeilingToken === undefined ? 21 : Number(pairSearchE88VixCeilingToken.replace('_', '.'));
    const pairSearchE82ErFloorToken = String(params.pcsRescuePairSearchMode).match(/^nearest_valid_r9_e82_e447_bull_sr02_adxlt10_er(0_08|0_10|0_12)_v1$/)?.[1];
    const pairSearchE82ErFloor = pairSearchE84FixedEr08 ? .08 : pairSearchE82ErFloorToken === undefined ? undefined : Number(pairSearchE82ErFloorToken.replace('_', '.'));
    const pairSearchErFloorToken = String(params.pcsRescuePairSearchMode).match(/^nearest_valid_r9_e81_e447_bull_sr02_adxlt10_er(0_08|0_10|0_12)_v1$/)?.[1];
    const pairSearchErFloor = pairSearchErFloorToken === undefined ? undefined : Number(pairSearchErFloorToken.replace('_', '.'));
    const pairSearchMode = (String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e453_creditfloor_sr01_adx25_vix22_v1'
      ? (slowSubregimeState === 'SR01'
        && (regimeData?.adx14 ?? Number.POSITIVE_INFINITY) < 25
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 22 ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE95WeakAdx25BullLowErRecovery
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21
        && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 25)
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && !((Number.isFinite(qqqEr20) && qqqEr20! >= .08)
            || (Number.isFinite(qqqEr20) && qqqEr20! < .08 && Number.isFinite(qqqROC5) && qqqROC5 >= 0)))) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE93WeakRecoveryOrStrength
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21
        && !(qqqROC5 >= 0 || (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 25))
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && !(Number.isFinite(qqqEr20) && qqqEr20! >= .08))) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE90UnifiedRoc5
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10))
        && !(Number.isFinite(qqqROC5) && qqqROC5 >= 0) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE88WeakSignal !== undefined
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < pairSearchE88VixCeiling
        && !(pairSearchE88WeakSignal === 'roc20_ge_neg05' ? qqqROC20 >= -.05
          : pairSearchE88WeakSignal === 'roc20_ge_neg04' ? qqqROC20 >= -.04
          : pairSearchE88WeakSignal === 'roc20_ge_neg03' ? qqqROC20 >= -.03
          : pairSearchE88WeakSignal === 'roc5_ge0' ? qqqROC5 >= 0
          : pairSearchE88WeakSignal === 'vixchange5d_lt0' ? Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! < 0
          : pairSearchE88WeakSignal === 'adx_ge20' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20
          : pairSearchE88WeakSignal === 'adx_ge22' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 22
          : pairSearchE88WeakSignal === 'adx_ge23' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 23
          : pairSearchE88WeakSignal === 'adx_ge20_er08' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 && Number.isFinite(qqqEr20) && qqqEr20! >= .08
          : pairSearchE88WeakSignal === 'adx_ge22_er08' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 22 && Number.isFinite(qqqEr20) && qqqEr20! >= .08
          : pairSearchE88WeakSignal === 'adx_ge23_er08' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 23 && Number.isFinite(qqqEr20) && qqqEr20! >= .08
          : pairSearchE88WeakSignal === 'adx_ge20_er08_or_ge24' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || ((regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 && Number.isFinite(qqqEr20) && qqqEr20! >= .08)
          : pairSearchE88WeakSignal === 'adx_ge22_er08_or_ge24' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || ((regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 22 && Number.isFinite(qqqEr20) && qqqEr20! >= .08)
          : pairSearchE88WeakSignal === 'adx_ge23_er08_or_ge24' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || ((regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 23 && Number.isFinite(qqqEr20) && qqqEr20! >= .08)
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_le35' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_lt40' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 40
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_lt45' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 45
          : pairSearchE88WeakSignal === 'adx_ge24_or_roc5_ge0' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || qqqROC5 >= 0
          : pairSearchE88WeakSignal === 'adx_ge24_or_roc5_ge0_or_trend_le35' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || qqqROC5 >= 0 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35
          : pairSearchE88WeakSignal === 'roc5_ge0_or_trend_le35' ? qqqROC5 >= 0 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_lt45_roc5_ge0' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || ((ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 45 && qqqROC5 >= 0)
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_le35_or_trend_lt45_adx_ge20' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35 || ((ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 45 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20)
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_le35_or_trend_lt45_adx_ge22' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35 || ((ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 45 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 22)
          : pairSearchE88WeakSignal === 'adx_ge24_or_trend_le35_or_trend_lt45_adx_ge24' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) <= 35 || ((ctx.results.trend?.data.score ?? Number.NEGATIVE_INFINITY) < 45 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24)
          : pairSearchE88WeakSignal === 'adx_ge24_or_rsi_ge40' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (regimeData?.rsi14 ?? Number.NEGATIVE_INFINITY) >= 40
          : pairSearchE88WeakSignal === 'adx_ge24_or_sma200_ge0' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24 || (regimeData?.price_vs_sma200_pct ?? Number.NEGATIVE_INFINITY) >= 0
          : pairSearchE88WeakSignal === 'adx_ge24_or_rv20_lt50' ? (tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .5
          : pairSearchE88WeakSignal === 'adx_ge24_vix_lt21_5' || pairSearchE88WeakSignal === 'adx_ge24_vix_lt22' || pairSearchE88WeakSignal === 'adx_ge24_vix_lt23' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24
          : pairSearchE88WeakSignal === 'adx_ge24' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 24
          : pairSearchE88WeakSignal === 'adx_ge26' ? (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 26
          : (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 25))
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && !(Number.isFinite(qqqEr20) && qqqEr20! >= .08))) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE85ErFloor !== undefined
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10))
        && !(Number.isFinite(qqqEr20) && qqqEr20! >= pairSearchE85ErFloor) ? undefined : 'nearest_valid_credit_floor_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e449_creditfloor_weak_bull_v1'
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchE82ErFloor !== undefined
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && !(Number.isFinite(qqqEr20) && qqqEr20! >= pairSearchE82ErFloor))) ? undefined : 'nearest_valid_credit_floor_v1')
      : pairSearchErFloor !== undefined
      ? (((regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && Number.isFinite(qqqEr20) && qqqEr20! >= pairSearchErFloor)) ? undefined : 'nearest_valid_credit_floor_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e447_creditfloor_weak_vix21_v1'
      ? (regime === 'RISK_ON_WEAKENING'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21 ? undefined : 'nearest_valid_credit_floor_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e448_creditfloor_weak_sr01_v1'
      ? (((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
        && slowSubregimeState === 'SR01'
        && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
        && negativePriceExtensionAtr
        && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21) ? undefined : 'nearest_valid_credit_floor_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e440_e429_narrow_weak_veto_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || (regime === 'RISK_ON_WEAKENING'
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 20
          && (regimeData?.adx14 ?? Number.POSITIVE_INFINITY) < 25)) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e435_bull_lowadx_reopen_bands_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21))
        && !(regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10
          && (((regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 15)
            || ((regimeData?.vix ?? vix) >= 16 && (regimeData?.vix ?? vix) < 18))) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e434_bull_lowadx_reopen_hi_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21))
        && !(regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.vix ?? vix) >= 16 && (regimeData?.vix ?? vix) < 18
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e433_bull_lowadx_reopen_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21))
        && !(regime === 'BULL' && slowSubregimeState === 'SR02'
          && (regimeData?.vix ?? vix) >= 13 && (regimeData?.vix ?? vix) < 15
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e432_sideways_reopen_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21
          && !(regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) >= 20.7))) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e431_bull_stress_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)
        || (regime === 'BULL'
          && slowSubregimeState === 'SR02'
          && (regimeData?.vix ?? vix) >= 18
          && negativePriceExtensionAtr
          && qqqROC5 < 0)) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e445_creditfloor_bull_adx10_v1'
        ? (regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10 ? undefined : 'nearest_valid_credit_floor_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e443_all_pairs_bull_adx10_v1'
        ? (regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10 ? undefined : 'nearest_valid_all_pairs_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e429_bull_adx10_v1'
        ? (regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10 ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e430_quality_v1'
      ? (((regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'SIDEWAYS')
          && slowSubregimeState === 'SR01'
          && (regimeData?.weakening_signal_count ?? Number.NEGATIVE_INFINITY) >= 3
          && negativePriceExtensionAtr
          && (regimeData?.vix ?? Number.POSITIVE_INFINITY) < 21)) ? undefined : 'nearest_valid_v1')
      : String(params.pcsRescuePairSearchMode) === 'nearest_valid_r7_e428_bull_adx10_v1'
        ? (regime === 'BULL' && slowSubregimeState === 'SR02' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) < 10 ? undefined : 'nearest_valid_v1')
      : params.pcsRescuePairSearchMode === 'nearest_valid_calm_v1'
      ? (regime === 'RANGE_BOUND' || regime === 'SIDEWAYS' ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_calm_vix20_v1'
        ? ((regime === 'RANGE_BOUND' || regime === 'SIDEWAYS') && (regimeData?.vix ?? vix) < 20 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_p3_range_sr01_vix17_20_adx12_20_rv40_50_v1'
        ? (regime === 'RANGE_BOUND'
          && slowSubregimeState === 'SR01'
          && (regimeData?.vix ?? vix) >= 17
          && (regimeData?.vix ?? vix) < 20
          && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 12
          && (regimeData?.adx14 ?? Number.POSITIVE_INFINITY) < 20
          && (tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY) >= .40
          && (tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .50
          ? 'nearest_valid_v1'
          : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_side_weak_vix20_v1'
        ? ((regime === 'SIDEWAYS' || regime === 'RISK_ON_WEAKENING') && (regimeData?.vix ?? vix) < 20 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix12_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) < 12 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix13_adx10_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) < 13 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 10 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix14_adx15_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) < 14 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 15 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix14_adx20_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) < 14 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_adx10_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 12 && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 10 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_adx15_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 12 && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 15 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_adx20_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_v1'
        ? (r6PairBase ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix16_adx10_v1'
        ? (r6PairWithBullBand(15, 16, 10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix16_adx15_v1'
        ? (r6PairWithBullBand(15, 16, 15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix16_adx20_v1'
        ? (r6PairWithBullBand(15, 16, 20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix16_adx25_v1'
        ? (r6PairWithBullBand(15, 16, 25) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix17_adx15_v1'
        ? (r6PairWithBullBand(15, 17, 15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix17_adx20_v1'
        ? (r6PairWithBullBand(15, 17, 20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix18_adx20_v1'
        ? (r6PairWithBullBand(15, 18, 20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6_bull_vix18_adx25_v1'
        ? (r6PairWithBullBand(15, 18, 25) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e0g_bull_vix18_adx20_v1'
        ? (r6e0gPairWithTail(20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e0g_bull_vix18_adx20_sr02_v1'
        ? (r6e0gPairWithTailQuality('sr02') ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e0g_bull_vix18_adx20_roc20_v1'
        ? (r6e0gPairWithTailQuality('roc20') ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e0g_bull_vix18_adx25_v1'
        ? (r6e0gPairWithTail(25) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e0g_bull_vix18_adx30_v1'
        ? (r6e0gPairWithTail(30) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e2_bull_vix18_adx15_roc20_v1'
        ? (r6e2PairWithTailAdx(15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e2_bull_vix18_adx10_roc20_v1'
        ? (r6e2PairWithTailAdx(10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e3_bull_vix20_adx10_roc20_v1'
        ? (r6e3PairWithVix20Tail(10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e3_bull_vix20_adx15_roc20_v1'
        ? (r6e3PairWithVix20Tail(15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e3_bull_vix20_adx20_roc20_v1'
        ? (r6e3PairWithVix20Tail(20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e4_bull_vix22_adx10_roc20_v1'
        ? (r6e4PairWithVix22Tail(10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e4_bull_vix22_adx15_roc20_v1'
        ? (r6e4PairWithVix22Tail(15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e4_bull_vix22_adx20_roc20_v1'
        ? (r6e4PairWithVix22Tail(20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e5_bull_vix24_adx10_roc20_v1'
        ? (r6e5PairWithVix24Tail(10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e5_bull_vix24_adx15_roc20_v1'
        ? (r6e5PairWithVix24Tail(15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e5_bull_vix24_adx20_roc20_v1'
        ? (r6e5PairWithVix24Tail(20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e6_bull_vix26_adx10_roc20_v1'
        ? (r6e6PairWithVix26Tail(10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e6_bull_vix26_adx15_roc20_v1'
        ? (r6e6PairWithVix26Tail(15) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_r6e6_bull_vix26_adx20_roc20_v1'
        ? (r6e6PairWithVix26Tail(20) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix18_adx15_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 15 && (regimeData?.vix ?? vix) < 18 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 15 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_linear_adx_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 12 && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 5 * (regimeData?.vix ?? vix) - 50 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_linear_adx_m51_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 12 && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 5 * (regimeData?.vix ?? vix) - 51 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_bull_vix15_linear_adx_m52_v1'
        ? (regime === 'BULL' && (regimeData?.vix ?? vix) >= 12 && (regimeData?.vix ?? vix) < 15 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 5 * (regimeData?.vix ?? vix) - 52 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_side_vix20_bull_vix12_v1'
        ? ((regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) < 20) || (regime === 'BULL' && (regimeData?.vix ?? vix) < 12) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_side_vix20_bull_vix13_v1'
        ? ((regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) < 20) || (regime === 'BULL' && (regimeData?.vix ?? vix) < 13) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_side_vix20_bull_vix13_adx10_v1'
        ? ((regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) < 20) || (regime === 'BULL' && (regimeData?.vix ?? vix) < 13 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 10) ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode === 'nearest_valid_range_vix20_adx20_v1'
        ? (regime === 'RANGE_BOUND' && (regimeData?.vix ?? vix) < 20 && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 ? 'nearest_valid_v1' : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_range_v1'
        ? (regime === 'RANGE_BOUND'
          && (params.pcsRescuePairSearchComplementOnly !== true
            || (params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_atr_sr01_v1'
              && !pcsRescueSoftTiming
              && !pcsOriginalSignal
              && !pcsPageSignal
              && !pcsRescueRegimeAllowedBase))
          ? 'nearest_valid_v1'
          : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_side_v1'
          ? (regime === 'SIDEWAYS' ? 'nearest_valid_v1' : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_side_rv55_v1'
          ? (regime === 'SIDEWAYS' && (tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .55 ? 'nearest_valid_v1' : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_side_adx20_v1'
          ? (regime === 'SIDEWAYS' && (regimeData?.adx14 ?? Number.NEGATIVE_INFINITY) >= 20 ? 'nearest_valid_v1' : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_side_vix20_v1'
          ? (regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) < 20 ? 'nearest_valid_v1' : undefined)
        : params.pcsRescuePairSearchMode === 'nearest_valid_side_vix22_v1'
          ? (regime === 'SIDEWAYS' && (regimeData?.vix ?? vix) < 22 ? 'nearest_valid_v1' : undefined)
      : params.pcsRescuePairSearchMode) as Parameters<typeof buildPutCreditSpreadProposal>[0]['pairSearchMode'];
    let built = buildPutCreditSpreadProposal({
      chain,
      underlying: proxySymbol,
      date: ctx.input.date,
      targetDte,
      shortDelta: delta,
      // 默认 Rescue 仍只用 Delta；研究旁路只在 E526 RANGE 分支使用 Sigma=2/3.925%。
      shortStrikeSigma: rescueContractSigma,
      dailySigma20: rescueContractDailySigma20,
      widthPct: rescueContractWidthPct,
      nav,
      riskBudget,
      forceMinimumContract: false,
      pairSearchMode,
    });
    if (shadowP3PathState && shadowP3PathAllowed && shadowP3Proposal?.proposal) built = shadowP3Proposal;
    const fallbackBlockedByLowVixExtended = params.pcsRescueContractFallbackMode === 'narrow_updelta_v2' && regime === 'RISK_ON_EXTENDED' && rescueQualityVix < 14;
    const expiryFallback = params.pcsRescueContractFallbackMode === 'expiry28_v1' || params.pcsRescueContractFallbackMode === 'expiry42_v1';
    const widthOnlyFallback = params.pcsRescueContractFallbackMode === 'narrow_width_v1';
    const sidewaysFallback = params.pcsRescueContractFallbackMode === 'narrow_updelta_sideways_v1';
    const downDeltaFallback = params.pcsRescueContractFallbackMode === 'narrow_downdelta_v1';
    const fallbackBlockedByQuality = isPcsRescueContractFallbackQualityBlocked({ mode: params.pcsRescueContractFallbackQualityMode, roc20: qqqROC20, tqqqRoc20: tqqqROC20, roc5: qqqROC5, slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined, vix: rescuePairVix, adx14: rescuePairAdx });
    if (!built.proposal && !fallbackBlockedByLowVixExtended && !fallbackBlockedByQuality && (!sidewaysFallback || regime === 'SIDEWAYS') && (params.pcsRescueContractFallbackMode === 'narrow_updelta_v1' || params.pcsRescueContractFallbackMode === 'narrow_updelta_v2' || sidewaysFallback || downDeltaFallback || widthOnlyFallback || expiryFallback) && built.warning && (built.warning.includes('short put') || built.warning.includes('净信用金') || built.warning.includes('保护 Put'))) {
      const fallbackWidth = expiryFallback ? widthPct : Math.min(widthPct, .01);
      const fallbackDelta = expiryFallback || widthOnlyFallback
        ? delta
        : downDeltaFallback
          ? Math.max(.025, delta + (params.pcsRescueContractFallbackDeltaUplift ?? -.025))
          : Math.min(.25, delta + (params.pcsRescueContractFallbackDeltaUplift ?? .025));
      const fallbackTargetDte = params.pcsRescueContractFallbackMode === 'expiry28_v1' ? 28 : expiryFallback ? 42 : targetDte;
      const fallbackBuilt = buildPutCreditSpreadProposal({
        chain,
        underlying: proxySymbol,
        date: ctx.input.date,
        targetDte: fallbackTargetDte,
        shortDelta: fallbackDelta,
        shortStrikeSigma: undefined,
        widthPct: fallbackWidth,
        nav,
        riskBudget,
        forceMinimumContract: params.pcsRescueContractFallbackForceMinimumContract === true,
      });
      const fallbackRiskCap = params.pcsRescueContractFallbackMaxRiskPct;
      const fallbackRiskWithinCap = fallbackBuilt.proposal
        && (fallbackRiskCap === undefined
          || (Number.isFinite(fallbackRiskCap) && (fallbackBuilt.proposal.maxRiskPct ?? Number.POSITIVE_INFINITY) <= fallbackRiskCap));
      if (fallbackRiskWithinCap) {
        built = fallbackBuilt;
        warnings.push(`PCS_RESCUE 合约 fallback：${params.pcsRescueContractFallbackMode === 'expiry28_v1' ? 'DTE=28' : expiryFallback ? 'DTE=42' : `Delta=${(fallbackDelta * 100).toFixed(2)}%，宽度=${(fallbackWidth * 100).toFixed(2)}%`}`);
      }
      const secondaryUplift = params.pcsRescueContractFallbackSecondaryDeltaUplift;
      const secondaryFallbackAllowed = !built.proposal
        && secondaryUplift !== undefined
        && Number.isFinite(secondaryUplift)
        && !expiryFallback
        && !widthOnlyFallback
        && !downDeltaFallback
        && !sidewaysFallback
        && (params.pcsRescueContractFallbackMode === 'narrow_updelta_v1' || params.pcsRescueContractFallbackMode === 'narrow_updelta_v2');
      if (secondaryFallbackAllowed) {
        const secondaryDelta = Math.min(.25, delta + secondaryUplift);
        const secondaryBuilt = buildPutCreditSpreadProposal({
          chain,
          underlying: proxySymbol,
          date: ctx.input.date,
          targetDte: fallbackTargetDte,
          shortDelta: secondaryDelta,
          shortStrikeSigma: undefined,
          widthPct: fallbackWidth,
          nav,
          riskBudget,
          forceMinimumContract: params.pcsRescueContractFallbackForceMinimumContract === true,
        });
        const secondaryRiskWithinCap = secondaryBuilt.proposal
          && (fallbackRiskCap === undefined
            || (Number.isFinite(fallbackRiskCap) && (secondaryBuilt.proposal.maxRiskPct ?? Number.POSITIVE_INFINITY) <= fallbackRiskCap));
        if (secondaryRiskWithinCap) {
          built = secondaryBuilt;
          warnings.push(`PCS_RESCUE 合约 secondary fallback：Delta=${(secondaryDelta * 100).toFixed(2)}%，宽度=${(fallbackWidth * 100).toFixed(2)}%`);
        }
      }
      const tertiaryUplift = params.pcsRescueContractFallbackTertiaryDeltaUplift;
      const tertiaryStepUplift = params.pcsRescueContractFallbackTertiaryStepDeltaUplift;
      const tertiaryMode = params.pcsRescueContractFallbackTertiaryMode
        ?? (tertiaryUplift !== undefined ? params.pcsRescueContractFallbackMode : undefined);
      const tertiaryExpiryFallback = tertiaryMode === 'expiry28_v1' || tertiaryMode === 'expiry42_v1';
      const tertiaryWidthOnlyFallback = tertiaryMode === 'narrow_width_v1';
      const tertiarySidewaysFallback = tertiaryMode === 'narrow_updelta_sideways_v1';
      const tertiaryDownDeltaFallback = tertiaryMode === 'narrow_downdelta_v1';
      const tertiaryQualityBlocked = isPcsRescueTertiaryFallbackQualityBlocked({
        mode: params.pcsRescueContractFallbackTertiaryQualityMode,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      });
      const tertiaryFallbackAllowed = !built.proposal
        && secondaryUplift !== undefined
        && tertiaryMode !== undefined
        && !tertiaryQualityBlocked
        && (!tertiarySidewaysFallback || regime === 'SIDEWAYS');
      if (tertiaryFallbackAllowed) {
        const tertiaryWidth = tertiaryExpiryFallback ? widthPct : Math.min(widthPct, .01);
        const tertiaryTargetDte = tertiaryMode === 'expiry28_v1' ? 28 : tertiaryMode === 'expiry42_v1' ? 42 : targetDte;
        const tertiaryUplifts = tertiaryExpiryFallback || tertiaryWidthOnlyFallback
          ? [undefined]
          : [tertiaryUplift, tertiaryStepUplift].filter((uplift): uplift is number => Number.isFinite(uplift));
        for (let step = 0; step < tertiaryUplifts.length && !built.proposal; step += 1) {
          const uplift = tertiaryUplifts[step];
          const stepQualityBlocked = step > 0 && isPcsRescueTertiaryFallbackQualityBlocked({
            mode: params.pcsRescueContractFallbackTertiaryStepQualityMode ?? params.pcsRescueContractFallbackTertiaryQualityMode,
            regime,
            slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
          });
          if (stepQualityBlocked) continue;
          const tertiaryDelta = tertiaryExpiryFallback || tertiaryWidthOnlyFallback
            ? delta
            : tertiaryDownDeltaFallback
              ? Math.max(.025, delta + (uplift ?? -.025))
              : Math.min(.25, delta + (uplift ?? .025));
          const tertiaryBuilt = buildPutCreditSpreadProposal({
            chain,
            underlying: proxySymbol,
            date: ctx.input.date,
            targetDte: tertiaryTargetDte,
            shortDelta: tertiaryDelta,
            shortStrikeSigma: undefined,
            widthPct: tertiaryWidth,
            nav,
            riskBudget,
            forceMinimumContract: params.pcsRescueContractFallbackForceMinimumContract === true,
          });
          const tertiaryRiskWithinCap = tertiaryBuilt.proposal
            && (fallbackRiskCap === undefined
              || (Number.isFinite(fallbackRiskCap) && (tertiaryBuilt.proposal.maxRiskPct ?? Number.POSITIVE_INFINITY) <= fallbackRiskCap));
          if (tertiaryRiskWithinCap) {
            built = tertiaryBuilt;
            warnings.push(`PCS_RESCUE 合约 tertiary fallback：mode=${tertiaryMode}，step=${step + 1}/${tertiaryUplifts.length}，Delta=${(tertiaryDelta * 100).toFixed(2)}%，宽度=${(tertiaryWidth * 100).toFixed(2)}%`);
          }
        }
      }
    }
    const quaternaryDteMode = params.pcsRescueContractFallbackQuaternaryMode;
    const quaternaryQualityBlocked = isPcsRescueTertiaryFallbackQualityBlocked({
      mode: params.pcsRescueContractFallbackTertiaryStepQualityMode ?? params.pcsRescueContractFallbackTertiaryQualityMode,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    });
    if (!built.proposal && quaternaryDteMode !== undefined && !quaternaryQualityBlocked) {
      const quaternaryTargetDte = quaternaryDteMode === 'expiry28_v1' ? 28 : 42;
      const quaternaryBuilt = buildPutCreditSpreadProposal({
        chain,
        underlying: proxySymbol,
        date: ctx.input.date,
        targetDte: quaternaryTargetDte,
        shortDelta: delta,
        shortStrikeSigma: undefined,
        widthPct,
        nav,
        riskBudget,
        forceMinimumContract: params.pcsRescueContractFallbackForceMinimumContract === true,
      });
      const quaternaryRiskCap = params.pcsRescueContractFallbackMaxRiskPct;
      const quaternaryRiskWithinCap = quaternaryBuilt.proposal
        && (quaternaryRiskCap === undefined
          || (Number.isFinite(quaternaryRiskCap) && (quaternaryBuilt.proposal.maxRiskPct ?? Number.POSITIVE_INFINITY) <= quaternaryRiskCap));
      if (quaternaryRiskWithinCap) {
        built = quaternaryBuilt;
        warnings.push(`PCS_RESCUE 合约 quaternary fallback：mode=${quaternaryDteMode}，DTE=${quaternaryTargetDte}`);
      }
    }
    const buildRecoveryPairSearchMode = params.pcsRescueContractBuildRecoveryPairSearchMode;
    const buildRecoveryQualityMode = params.pcsRescueContractBuildRecoveryQualityMode;
    const buildRecoveryQualityAllowed = buildRecoveryQualityMode === undefined
      || (buildRecoveryQualityMode === 'roc5_nonnegative_v1' && Number.isFinite(qqqROC5) && qqqROC5! >= 0)
      || (buildRecoveryQualityMode === 'er20_ge15_v1' && Number.isFinite(qqqEr20) && qqqEr20! >= .15)
      || (String(buildRecoveryQualityMode) === 'rv20_lt50_v1' && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
      || (buildRecoveryQualityMode === 'roc5_nonnegative_and_er20_ge15_v1'
        && Number.isFinite(qqqROC5) && qqqROC5! >= 0
        && Number.isFinite(qqqEr20) && qqqEr20! >= .15);
    if (!built.proposal
      && (buildRecoveryPairSearchMode === 'nearest_valid_all_pairs_v1'
        || buildRecoveryPairSearchMode === 'nearest_valid_all_pairs_below_target_delta_v1')
      && buildRecoveryQualityAllowed) {
      const recovered = buildPutCreditSpreadProposal({
        chain,
        underlying: proxySymbol,
        date: ctx.input.date,
        targetDte,
        shortDelta: delta,
        shortStrikeSigma: rescueContractSigma,
        dailySigma20: rescueContractDailySigma20,
        widthPct: rescueContractWidthPct,
        nav,
        riskBudget,
        forceMinimumContract: false,
        pairSearchMode: buildRecoveryPairSearchMode,
        pairSearchMinCreditWidthRatio: params.pcsRescueContractBuildRecoveryMinCreditWidthRatio,
      });
      if (recovered.proposal) {
        built = recovered;
        warnings.push(`PCS_RESCUE 合约 build-recovery：mode=${buildRecoveryPairSearchMode}`);
      }
    }
    if (built.warning) warnings.push(`PCS_RESCUE：${built.warning}`);
    if (!built.proposal) return undefined;
    const metadata = built.proposal.metadata;
    return {
      action: 'ADD_PCS_RESCUE',
      overlay_type: 'proxyOverlay',
      proposed_strikes: built.proposal.proposedStrikes,
      premium_estimate: built.proposal.premiumEstimate,
      cs_max_risk_pct: built.proposal.maxRiskPct,
      pcsRescueShortDelta: delta,
      pcsRescueDeltaMode,
      pcsRescueSource: pcsRescueEntryMode,
      pcsRescuePutSpread: {
        ...metadata,
        strategyName: `${proxySymbol} PCS Rescue @${metadata.longPutStrike}/${metadata.shortPutStrike}`,
      },
    };
  };

  const buildEquityBoostProposal = (): OverlayProposal | undefined => {
    const { equityBoostTargetDte: fixedDte, equityBoostMaxRiskNav: maxRiskNav } = params;
    const candidate6RiskMultiplier = params.equityBoostCandidate6Mdd === true
      ? equityBoostCandidate6RiskMultiplier({
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix,
        adx14: regimeData?.adx14,
        priceVsSma200Pct: ebPriceVsSma200Pct,
        tqqqRealisedVol20d,
        tqqqRoc20: tqqqROC20,
        roc5: qqqROC5,
        drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
        openCount: ctx.input.equityBoostCandidate6State?.openCount,
        realizedDrawdown: ctx.input.equityBoostCandidate6State?.realizedDrawdown,
      })
      : 1;
    const bass221RiskMultiplier = equityBoostBass221SeverityActive ? params.equityBoostBass221SeverityMultiplier! : 1;
    const macroRiskMultiplier = equityBoostMacroRiskActive
      ? (params.equityBoostMacroRiskMultiplier ?? 1)
      : equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
      ? (equityBoostMacroRiskBullNeutralSr01Override
        ? equityBoostMacroRiskBullNeutralSr01ResolvedMultiplier!
        : equityBoostMacroRiskBullNeutralSr02Override
        ? equityBoostMacroRiskBullNeutralSr02ResolvedMultiplier!
        : equityBoostMacroRiskBullSr02BullTrendOverride
        ? params.equityBoostMacroRiskBullSr02BullTrendMultiplier!
        : equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetRangeFavorable
        ? (params.equityBoostMacroRiskRangeMultiplier ?? params.equityBoostMacroRiskUpMultiplier ?? 1)
        : equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetMainFavorable
        ? (params.equityBoostMacroRiskUpMultiplier ?? 1)
        : equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetDefensive
        ? (params.equityBoostMacroRiskDownMultiplier ?? 1)
        : 1)
      : (equityBoostMacroTiltFavorable || equityBoostMacroSafeClusterTiltFavorable || equityBoostMacroBullLowVixClusterTiltFavorable || equityBoostMacroBullLowVixWeakeningTiltFavorable || equityBoostMacroBullLowVixNeutralTiltFavorable || equityBoostMacroBullLowVixWeakeningNeutralTiltFavorable || equityBoostMacroBullWeakeningNeutralTiltFavorable || equityBoostMacroBullWeakeningRangeNeutralTiltFavorable || equityBoostMacroBullWeakeningRangeAllTiltFavorable || equityBoostMacroBullWeakeningAllRangeNeutralTiltFavorable || equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltFavorable || equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltFavorable || equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltFavorable || equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltFavorable || equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltFavorable)
      ? (params.equityBoostMacroRiskUpMultiplier ?? 1)
      : (equityBoostMacroTiltDefensive || equityBoostMacroSafeClusterTiltDefensive || equityBoostMacroBullLowVixClusterTiltDefensive || equityBoostMacroBullLowVixWeakeningTiltDefensive || equityBoostMacroBullLowVixNeutralTiltDefensive || equityBoostMacroBullLowVixWeakeningNeutralTiltDefensive || equityBoostMacroBullWeakeningNeutralTiltDefensive || equityBoostMacroBullWeakeningRangeNeutralTiltDefensive || equityBoostMacroBullWeakeningRangeAllTiltDefensive || equityBoostMacroBullWeakeningAllRangeNeutralTiltDefensive || equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltDefensive || equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltDefensive || equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltDefensive || equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltDefensive || equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltDefensive)
          ? (params.equityBoostMacroRiskDownMultiplier ?? 1)
          : 1;
    const macroRiskVixBucketMultiplier = resolveEbMacroRiskVixBucketMultiplier({
      active: equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive,
      vix,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      extendedSr02LowVixMultiplier: params.equityBoostMacroRiskExtendedSr02LowVixMultiplier,
      lowMultiplier: params.equityBoostMacroRiskVixLowMultiplier,
      midMultiplier: params.equityBoostMacroRiskVixMidMultiplier,
      highMultiplier: params.equityBoostMacroRiskVixHighMultiplier,
    });
    const baseRiskMultiplier = Math.min(candidate6RiskMultiplier, bass221RiskMultiplier);
    const effectiveRiskMultiplier = equityBoostMacroTiltActive || equityBoostMacroSafeClusterTiltActive || equityBoostMacroBullLowVixClusterTiltActive || equityBoostMacroBullLowVixWeakeningTiltActive || equityBoostMacroBullLowVixNeutralTiltActive || equityBoostMacroBullLowVixWeakeningNeutralTiltActive || equityBoostMacroBullWeakeningNeutralTiltActive || equityBoostMacroBullWeakeningRangeNeutralTiltActive || equityBoostMacroBullWeakeningRangeAllTiltActive || equityBoostMacroBullWeakeningAllRangeNeutralTiltActive || equityBoostMacroBullWeakeningRangeNeutralSidewaysDefensiveTiltActive || equityBoostMacroBullWeakeningRangeNeutralBearSr01DefensiveTiltActive || equityBoostMacroBullWeakeningRangeNeutralBearDefensiveTiltActive || equityBoostMacroWeakeningRangeNeutralBearSr01DefensiveTiltActive || equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01DefensiveTiltActive || equityBoostMacroBullNeutralWeakeningRangeNeutralBearSr01SplitBudgetActive
    ? baseRiskMultiplier * macroRiskMultiplier * macroRiskVixBucketMultiplier
      : Math.min(baseRiskMultiplier, macroRiskMultiplier);
    const effectiveMaxRiskNav = maxRiskNav * effectiveRiskMultiplier;
    const vxn = ctx.input.macro?.vxn;
    const targetDte = resolveEquityBoostTargetDte({ mode: params.equityBoostDteMode, fixedDte, vxn, vxnThreshold: params.equityBoostDynamicDteVxnThreshold, hysteresisState: ctx.input.equityBoostDteState, regime, slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined, priceVsSma200Pct: ebPriceVsSma200Pct, priceThresholdPct: params.equityBoostDynamicDtePriceThresholdPct });
    const targetWidthPct = resolveEquityBoostWidthTargetPct({ mode: params.equityBoostWidthMode, vxn, vxnThreshold: params.equityBoostDynamicWidthVxnThreshold, lowVxnTargetPct: params.equityBoostDynamicWidthLowVxnTargetPct, highVxnTargetPct: params.equityBoostDynamicWidthHighVxnTargetPct, priceVsSma200Pct: ebPriceVsSma200Pct, priceThresholdPct: params.equityBoostDynamicWidthPriceThresholdPct, lowPriceTargetPct: params.equityBoostDynamicWidthLowPriceTargetPct });
    const ratioStateKey = `${regime}|${typeof slowSubregimeState === 'string' ? slowSubregimeState : 'missing'}`;
    const ratioSelectionTarget = params.equityBoostRatioSelectionTargetMode === 'state_adaptive_v1'
      && (params.equityBoostRatioSelectionStateTargetStates ?? []).includes(ratioStateKey)
      ? params.equityBoostRatioSelectionStateTarget ?? params.equityBoostRatioSelectionTarget
      : params.equityBoostRatioSelectionTargetMode === 'price_adaptive_v1'
      && typeof ebPriceVsSma200Pct === 'number'
      && Number.isFinite(ebPriceVsSma200Pct)
      && ebPriceVsSma200Pct < (params.equityBoostRatioSelectionPriceThresholdPct ?? .07)
      ? params.equityBoostRatioSelectionLowPriceTarget ?? params.equityBoostRatioSelectionTarget
      : params.equityBoostRatioSelectionTargetMode === 'rv_adaptive_v1'
        && typeof tqqqRealisedVol20d === 'number'
        && Number.isFinite(tqqqRealisedVol20d)
        && tqqqRealisedVol20d >= (params.equityBoostRatioSelectionRv20Threshold ?? .30)
        ? params.equityBoostRatioSelectionHighRvTarget ?? params.equityBoostRatioSelectionTarget
        : params.equityBoostRatioSelectionTarget;
    const built = buildEquityBoostStrategyProposal({ chain, date: ctx.input.date, targetDte, targetWidthPct, nav, maxRiskNav: effectiveMaxRiskNav, forceMinimumContract: params.forceMinimumContract, independent: params.optionsBacktestPositionMode?.eb === 'independent', ratioBounds: { min: params.equityBoostRatioMin, max: params.equityBoostRatioMax }, ratioSelectionTarget, selectionPriority: params.equityBoostLegSelectionPriority, riskMultiplier: effectiveRiskMultiplier !== 1 ? effectiveRiskMultiplier : undefined });
    if (built.warning) warnings.push(built.warning);
    if (!built.proposal) return undefined;
    const proposedShortStrike = built.proposal.proposedStrikes.eb_short_strike;
    const proposedLongStrike = built.proposal.proposedStrikes.eb_long_strike;
    const proposedExpiry = built.proposal.proposedStrikes.expiry;
    const proposedWidthPct = Number.isFinite(spot) && spot > 0
      ? (proposedShortStrike - proposedLongStrike) / spot
      : undefined;
    const contractGateBlocked = ctx.input.equityBoostContractGate?.({
      date: ctx.input.date,
      regime,
      slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
      vix: macro.vix,
      vxn: macro.vxn,
      tqqqRealisedVol20d,
      qqqROC20: tqqqROC20,
      qqqROC5,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      priceVsSma200Pct: ebPriceVsSma200Pct,
      adx14: regimeData?.adx14,
      widthPct: proposedWidthPct,
      priceExtensionAtr,
      vixChange5d: macro.vix5dAgo == null || macro.vix == null ? undefined : (macro.vix - macro.vix5dAgo) / macro.vix5dAgo,
      shortStrike: proposedShortStrike,
      longStrike: proposedLongStrike,
      expiry: proposedExpiry,
      targetDte,
    }) ?? false;
    if (contractGateBlocked) {
      warnings.push('Equity 研究合同闸：价差合同条件阻断');
      return undefined;
    }
    return {
      action: 'ADD_EQUITY_BOOST_PUT_SPREAD',
      overlay_type: 'proxyOverlay',
      proposed_strikes: built.proposal.proposedStrikes,
      premium_estimate: built.proposal.premiumEstimate,
      cs_max_risk_pct: built.proposal.maxRiskPct,
      equityBoostPutSpread: built.proposal.metadata,
    };
  };

  if (primaryAction === 'ADD_COLLAR') {
    action = 'ADD_COLLAR';
    const { collarPutUnderlying: putUnderlying, collarStrikeAnchor: strikeAnchor, collarFloorPct: floorPct, collarExitProfile: exitProfile } = params;
    const built = buildCollarProposal({ date: ctx.input.date, chains: optionChains, leveragedSymbol, leveragedShares, actualLeveragedValue: exposure.actualLeveragedValue.value, qqqSpot: spot, rollingHigh, allowShortCall, legMode: collarLegMode, putUnderlying, strikeAnchor, floorPct, exitProfile, maxDebitPct: params.collarMaxDebitPct });
    if (!built.strikes && !built.preserveAction) {
      action = 'NONE';
      collar_triggered = false;
    } else {
      proposed_strikes = built.strikes;
      premium_estimate = built.premiumEstimate;
    }
    warnings.push(built.warning);
  } else if (primaryAction === 'ADD_IRON_CONDOR') {
    action = 'ADD_IRON_CONDOR';
    const built = buildIronCondorProposal({ chain, date: ctx.input.date, targetDte: IC_TARGET_DTE, config: icCfg, nav: account?.netLiquidation ?? 100000, maxConcurrent: icMaxConcurrent, forceMinimumContract: params.forceMinimumContract, independent: params.optionsBacktestPositionMode?.ic === 'independent' });
    if (built.warning) {
      warnings.push(built.warning);
      if (!built.proposal && built.warning.includes('credit/wing')) action = 'NONE';
    }
    if (built.proposal) {
      proposed_strikes = built.proposal.proposedStrikes;
      premium_estimate = built.proposal.premiumEstimate;
      iron_condor_max_risk_pct = built.proposal.maxRiskPct;
      iron_condor_max_contracts = built.proposal.maxContracts;
      ironCondorMeta = built.proposal.metadata;
    }
  } else if (primaryAction === 'OPEN_BEAR_CALL_SPREAD') {
    action = 'OPEN_BEAR_CALL_SPREAD';
    proposed_strikes = bearOverlay.proposed_strikes;
    premium_estimate = bearOverlay.premium_estimate;
    cs_max_risk_pct = bearOverlay.max_risk_pct;
    bearCallSpread = bearOverlay.bearCallSpread;
  } else if (primaryAction === 'REVIEW_BEAR_CALL_SPREAD') {
    action = 'REVIEW_BEAR_CALL_SPREAD';
    bearCallSpread = bearOverlay.bearCallSpread;
  } else if (primaryAction === 'SKIP_BEAR_CALL_SPREAD') {
    action = 'SKIP_BEAR_CALL_SPREAD';
    bearCallSpread = bearOverlay.bearCallSpread;
    warnings.push(...bearOverlay.warnings);
  } else if (primaryAction === 'ADD_CALL_SPREAD') {
    const callSpreadProposal = buildCallSpreadProposal();
    if (callSpreadProposal) {
      selectedProposal = callSpreadProposal;
      action = 'ADD_CALL_SPREAD';
      proposed_strikes = callSpreadProposal.proposed_strikes;
      premium_estimate = callSpreadProposal.premium_estimate;
      cs_max_risk_pct = callSpreadProposal.cs_max_risk_pct;
    }
  } else if (primaryAction === 'ADD_EQUITY_BOOST_PUT_SPREAD') {
    const equityBoostProposal = buildEquityBoostProposal();
    if (equityBoostProposal) {
      selectedProposal = equityBoostProposal;
      action = 'ADD_EQUITY_BOOST_PUT_SPREAD';
      proposed_strikes = equityBoostProposal.proposed_strikes;
      premium_estimate = equityBoostProposal.premium_estimate;
      cs_max_risk_pct = equityBoostProposal.cs_max_risk_pct;
      equityBoostPutSpread = equityBoostProposal.equityBoostPutSpread;
    }
  } else if (primaryAction === 'ADD_PUT_CREDIT_SPREAD') {
    const putSpreadProposal = buildPutSpreadProposal();
    if (putSpreadProposal) {
      selectedProposal = putSpreadProposal;
      action = 'ADD_PUT_CREDIT_SPREAD';
      proposed_strikes = putSpreadProposal.proposed_strikes;
      premium_estimate = putSpreadProposal.premium_estimate;
      cs_max_risk_pct = putSpreadProposal.cs_max_risk_pct;
    }
  } else if (primaryAction === 'ADD_PCS_RESCUE') {
    const pcsRescueProposal = buildPcsRescueProposal();
    if (pcsRescueProposal) {
      selectedProposal = pcsRescueProposal;
      action = 'ADD_PCS_RESCUE';
      proposed_strikes = pcsRescueProposal.proposed_strikes;
      premium_estimate = pcsRescueProposal.premium_estimate;
      cs_max_risk_pct = pcsRescueProposal.cs_max_risk_pct;
    }
  }

  const collarMeta = action === 'ADD_COLLAR' && proposed_strikes?.call_symbol
    ? buildCollarProposalMetadata({ leveragedSymbol, leveragedShares, callSymbol: proposed_strikes.call_symbol, callStrike: proposed_strikes.call_strike })
    : undefined;

  const callCreditSpreadMeta = action === 'ADD_CALL_SPREAD' ? selectedProposal?.callCreditSpread : undefined;
  const putCreditSpreadMeta = action === 'ADD_PUT_CREDIT_SPREAD' ? selectedProposal?.putCreditSpread : undefined;
  const pcsRescuePutSpread = action === 'ADD_PCS_RESCUE' ? selectedProposal?.pcsRescuePutSpread : undefined;
  equityBoostPutSpread = action === 'ADD_EQUITY_BOOST_PUT_SPREAD'
    ? selectedProposal?.equityBoostPutSpread
    : equityBoostPutSpread;

  if (bearCallSpread?.maxLoss != null) {
    bearCallSpread = {
      ...bearCallSpread,
      definedRisk: true,
      buyingPowerImpact: bearCallSpread.maxLoss,
      riskBudgetUsed: bearCallSpread.newRiskPct,
    };
  }

  const primaryProposal: OverlayProposal | undefined = action !== 'NONE'
    ? {
      action,
      overlay_type: overlayTypeForAction(action),
      proposed_strikes,
      premium_estimate,
      iron_condor_max_risk_pct,
      cs_max_risk_pct,
      collar: collarMeta,
      callCreditSpread: callCreditSpreadMeta,
      csVxnRescueSizeMultiplier: selectedProposal?.csVxnRescueSizeMultiplier,
      csRoute: selectedProposal?.csRoute,
      csTier: selectedProposal?.csTier,
      csExitProfile: selectedProposal?.csExitProfile,
      putCreditSpread: putCreditSpreadMeta,
      pcsPriceSelection: action === 'ADD_PUT_CREDIT_SPREAD' ? selectedProposal?.pcsPriceSelection : undefined,
      ...(params.pcsRescueEnabled === true ? {
        pcsRescueShortDelta: action === 'ADD_PCS_RESCUE' ? selectedProposal?.pcsRescueShortDelta : undefined,
        pcsRescueDeltaMode: action === 'ADD_PCS_RESCUE' ? selectedProposal?.pcsRescueDeltaMode : undefined,
        pcsRescueSource: action === 'ADD_PCS_RESCUE' ? selectedProposal?.pcsRescueSource : undefined,
        pcsRescuePutSpread,
      } : {}),
      ironCondor: ironCondorMeta,
      bearCallSpread,
      equityBoostPutSpread,
      bearFactors: bearOverlay.factors,
    }
    : undefined;
  const supplementalOverlayProposals = collectSupplementalOverlayProposals(action, [
    { action: 'ADD_CALL_SPREAD', triggered: effectiveCallSpreadTriggered, build: buildCallSpreadProposal },
    { action: 'ADD_PUT_CREDIT_SPREAD', triggered: pcs_triggered_final, build: buildPutSpreadProposal },
    { action: 'ADD_EQUITY_BOOST_PUT_SPREAD', triggered: equity_boost_triggered, build: buildEquityBoostProposal },
  ]);
  // 主 PCS 优先：默认只有主 proposal 未形成时，才懒构建独立 PCS_RESCUE。
  // 研究专用的互补替代臂只在显式 P3 complement mode + 主 PCS 动作下启用，
  // 保持默认同日互斥，并让候选脚本可以验证“主 proposal 已构建但覆盖未形成”的瓶颈。
  const mainPcsProposalBuiltBeforeRescue = [primaryProposal, ...supplementalOverlayProposals]
    .some((proposal) => proposal?.action === 'ADD_PUT_CREDIT_SPREAD');
  const e526RangePathMode = params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_v1'
    || params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_atr_sr01_v1'
    || params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_or_vix_v1'
    || params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1'
    || params.pcsRescueResearchComplementMode === 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1'
    || String(params.pcsRescueResearchComplementMode) === 'r9_e65_plus_p3_e526_range_path_v1'
    || String(params.pcsRescueResearchComplementMode) === 'r9_e65_or_p3_e526_range_residual_v1';
  const e526RangePathState = e526RangePathMode
    && regime === 'RANGE_BOUND'
    && (slowSubregimeState === 'SR01' || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 12))
    && !(String(params.pcsRescueResearchComplementMode) === 'r9_e65_or_p3_e526_range_residual_v1'
      && isPcsRescueResearchComplementTiming({
        mode: 'p3_r7_e404_plus_r8_flat_highvix_union_or_range7_erlt10_or_bull_vixge17_erlt30_or_r9_vix14_18_range8_bull_sr02_v1' as any,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        rv20: tqqqRealisedVol20d,
        priceExtensionAtr,
        roc5: qqqROC5,
        roc20: qqqROC20,
        qqqEr20,
        vixChange5d: csVixChange5d,
        weakeningSignalCount: regimeData?.weakening_signal_count,
      }))
    && !(params.pcsRescueResearchComplementMode === 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1'
      && isPcsRescueResearchComplementTiming({
        mode: 'p3_r7_e404_plus_rext_sr02_vix16_17_adxge30_v1' as any,
        regime,
        slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
        vix: regimeData?.vix ?? vix,
        adx14: regimeData?.adx14,
        rv20: tqqqRealisedVol20d,
        priceExtensionAtr,
        roc5: qqqROC5,
        roc20: qqqROC20,
        qqqEr20,
        vixChange5d: csVixChange5d,
        weakeningSignalCount: regimeData?.weakening_signal_count,
      }));
  const e526RangePathAtrPassed = params.pcsRescueResearchComplementMode !== 'p3_e159_plus_e526_range_path_atr_sr01_v1'
    && params.pcsRescueResearchComplementMode !== 'p3_r7_e412_plus_e526_range_path_atr_sr01_v1'
    && params.pcsRescueResearchComplementMode !== 'p3_e159_plus_e526_range_path_or_vix_v1'
    && params.pcsRescueResearchComplementMode !== 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1'
    && String(params.pcsRescueResearchComplementMode) !== 'r9_e65_plus_p3_e526_range_path_v1'
    && String(params.pcsRescueResearchComplementMode) !== 'r9_e65_or_p3_e526_range_residual_v1'
    || slowSubregimeState !== 'SR01'
    || (Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 0);
  const e526RangeVixExtraAllowed = (params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_or_vix_v1'
    || params.pcsRescueResearchComplementMode === 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1')
    && e526RangePathState
    && Number.isFinite(regimeData?.vix ?? vix)
    && (regimeData?.vix ?? vix) < 19;
  pcsRescueResearchFallbackAllowed = params.pcsRescueResearchComplementMode !== 'p3_e159_plus_e526_range_path_or_vix_sr01_quality_v1'
    || !e526RangePathState
    || pcsRescueSoftTiming
    || slowSubregimeState !== 'SR01'
    || (Number.isFinite(priceExtensionAtr) && priceExtensionAtr! >= 0)
    || (regimeData?.weakening_signal_count ?? 0) < 4;
  pcsRescueResearchPathAllowed = !e526RangePathState || (
    (e526RangeVixExtraAllowed || e526RangePathAtrPassed)
    &&
    primaryProposal?.pcsPriceSelection?.selectedSigma === 2
    && (primaryProposal?.pcsPriceSelection?.selectedNoTouchLower ?? Number.NEGATIVE_INFINITY) < .35
  );
  const promoteRescueOnMainProposalCandidate = params.pcsRescuePromoteOnMainProposal === true
    && primaryAction === 'ADD_PUT_CREDIT_SPREAD'
    && mainPcsProposalBuiltBeforeRescue
    && pcsRescueResearchComplementTiming
    && pcsRescueResearchPathAllowed;
  // Research gates are intentionally string-dispatched so new retained experiments do not require widening the production parameter contract first.
  const dualMainQualityGate = String(params.pcsRescueDualMainQualityGate ?? 'off');
  const dualMainQualityBase = (adxMin: number) =>
    (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= adxMin)
    || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .30);
  const dualMainQualityR8E29Base = () =>
    dualMainQualityBase(26)
    || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
      && !(regime === 'BULL' && slowSubregimeState === 'SR01')
      && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
      && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
    || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
      && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
    || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
      && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
    || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
      && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
    || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 12);
  const dualMainQualityResearchExtension = String(
    (params as unknown as { pcsRescueResearchQualityExtension?: string }).pcsRescueResearchQualityExtension ?? 'off',
  );
  const dualMainQualityResearchExtensionSet = new Set(dualMainQualityResearchExtension.split('+').filter(Boolean));
  const dualMainQualityR8MacroScore = [
    regime !== 'CRISIS',
    Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! < 20,
    Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .67,
    Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= 0,
    Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05,
    Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16,
    Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50,
  ].filter(Boolean).length;
  const dualMainQualityR8E29Extension = () =>
    (dualMainQualityResearchExtensionSet.has('trend_lt55_range05')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 55
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('roc20_lt0_range05')
      && Number.isFinite(qqqROC20) && qqqROC20! < 0
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('atr_lt1')
      && Number.isFinite((regimeData as typeof regimeData & { atr14?: number } | undefined)?.atr14)
      && (regimeData as typeof regimeData & { atr14?: number }).atr14! < 1)
    || (dualMainQualityResearchExtensionSet.has('er20_lt03_roc5ge02')
      && Number.isFinite(qqqEr20) && qqqEr20! < .30
      && Number.isFinite(qqqROC5) && qqqROC5! >= .02)
    || (dualMainQualityResearchExtensionSet.has('adx_ge20_range05')
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 20
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('trend_ge60_ma50slope01')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 60
      && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .01)
    || (dualMainQualityResearchExtensionSet.has('trend_ge60_ma50slope005')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 60
      && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .005)
    || (dualMainQualityResearchExtensionSet.has('ma50slope_ge005_lt03')
      && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .005
      && regimeData!.ma50_slope_pct! < .03)
    || (dualMainQualityResearchExtensionSet.has('trend_lt55_range05')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 55
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('roc20_lt0_range05')
      && Number.isFinite(qqqROC20) && qqqROC20! < 0
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('atr_lt1_range05')
      && Number.isFinite((regimeData as typeof regimeData & { atr14?: number } | undefined)?.atr14)
      && (regimeData as typeof regimeData & { atr14?: number }).atr14! < 1
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('adx_ge20_range05')
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 20
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (dualMainQualityResearchExtensionSet.has('trend_lt55_roc5ge0')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 55
      && Number.isFinite(qqqROC5) && qqqROC5! >= 0)
    || (dualMainQualityResearchExtensionSet.has('vixchange5d_02_to_05')
      && Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! >= .02
      && regimeData!.vix_change_5d! < .05)
    || (dualMainQualityResearchExtensionSet.has('vixchange5d_ge02')
      && Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! >= .02)
    || (dualMainQualityResearchExtensionSet.has('vixchange5d_ge0_lt05')
      && Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! >= 0
      && regimeData!.vix_change_5d! < .05)
    || (dualMainQualityResearchExtensionSet.has('adx_ge16_lt18')
      && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 16
      && regimeData!.adx14! < 18)
    || (dualMainQualityResearchExtensionSet.has('macro_range_family')
      && (regime === 'RANGE_BOUND' || regime === 'SIDEWAYS'))
    || (dualMainQualityResearchExtensionSet.has('macro_lowtrend_score5')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
      && dualMainQualityR8MacroScore >= 5)
    || (dualMainQualityResearchExtensionSet.has('macro_lowtrend_score5_no_precrisis')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
      && dualMainQualityR8MacroScore >= 5
      && !csPreCrisisActive)
    || (dualMainQualityResearchExtensionSet.has('macro_lowtrend_score5_no_sr01')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
      && dualMainQualityR8MacroScore >= 5
      && slowSubregimeState !== 'SR01')
    || (dualMainQualityResearchExtensionSet.has('macro_lowtrend_score5_no_sr02')
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
      && dualMainQualityR8MacroScore >= 5
      && slowSubregimeState !== 'SR02')
    || (dualMainQualityResearchExtensionSet.has('macro_range_no_sr01')
      && (regime === 'RANGE_BOUND' || regime === 'SIDEWAYS')
      && slowSubregimeState !== 'SR01')
    || (dualMainQualityResearchExtensionSet.has('macro_range_or_lowtrend_score5')
      && (regime === 'RANGE_BOUND' || regime === 'SIDEWAYS'
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
          && dualMainQualityR8MacroScore >= 5)));
  const dualMainQualityR9E43Parent = () =>
    dualMainQualityR8E29Base()
    || dualMainQualityR8E29Extension()
    || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
      && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
    || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
    || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
      && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
    || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
      && Number.isFinite(qqqROC20) && qqqROC20! < 0)
    || (Number.isFinite(vix3m) && Number.isFinite(vix)
      && vix3m! - vix >= 0 && vix3m! - vix < 2
      && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70);
  const dualMainQualityR9E47Union = () =>
    dualMainQualityR9E43Parent()
    || ((regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
      && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
        || (Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08)));
  const dualMainQualityR9E53Compact = (threshold: number) =>
    dualMainQualityR8E29Base()
    || dualMainQualityR8MacroScore >= threshold
    || ((regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
      && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
        || (Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08)))
    || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
      && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
      && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50);
  const dualMainQualityRawPassed = dualMainQualityGate === 'off'
    || (dualMainQualityGate === 'adx30_or_rv20_lt30_v1' && dualMainQualityBase(30))
    || (dualMainQualityGate === 'adx28_or_rv20_lt30_v1' && dualMainQualityBase(28))
    || (dualMainQualityGate === 'adx27_or_rv20_lt30_v1' && dualMainQualityBase(27))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_v1' && dualMainQualityBase(26))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx25_non_sr01_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 25 && slowSubregimeState !== 'SR01')))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx25_safe_state_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 25
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx24_safe_state_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 24
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx23_safe_state_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 23
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx21_safe_state_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 21
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01')
          && !(regime === 'BULL' && slowSubregimeState === 'SR02'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx21_safe_state_marginal_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 21
          && regimeData!.adx14! < 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01')
          && !(regime === 'BULL' && slowSubregimeState === 'SR02'))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_rv20_lt60_sma_nonnegative_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .60
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= 0)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_trendlt55_range05_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 55
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_ma50slope005_range05_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .005
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_adxlt12_v1'
      && dualMainQualityR8E29Base())
    || (dualMainQualityGate === 'r8_e29_extension_v1'
      && (dualMainQualityR8E29Base() || dualMainQualityR8E29Extension()))
    || (String(dualMainQualityGate) === 'r9_e30_quality_or_adxlt15_range05_v1'
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt15_v1'
      || String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt15_range04_v1'
      || String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt15_range06_v1'
      || String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt14_range05_v1'
      || String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt16_range05_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14)
          && regimeData!.adx14! < (String(dualMainQualityGate).includes('adxlt14') ? 14 : String(dualMainQualityGate).includes('adxlt16') ? 16 : 15)
          && (String(dualMainQualityGate) === 'r9_e32_quality_or_adxlt15_v1'
            || (Number.isFinite(regimeData?.range20d_pct)
              && regimeData!.range20d_pct! >= (String(dualMainQualityGate).includes('range04') ? .04 : String(dualMainQualityGate).includes('range06') ? .06 : .05)))))
    || (String(dualMainQualityGate) === 'r9_e33_quality_or_adxlt15_vixfall_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_weakening2_term1_2_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_extlt0_term1_2_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_roc20lt0_term1_2_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_trendlt50_term1_2_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_rvlt50_term_lt1_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_rvlt50_trendge70_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_rv50_67_adxlt15_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_trend50_70_ext0_1_5_v1'
      || String(dualMainQualityGate) === 'r9_e33_quality_or_er10_30_term_lt1_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_adxlt15_vixfall_v1'
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.vix_change_5d) && regimeData!.vix_change_5d! < 0)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_weakening2_term1_2_v1'
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_extlt0_term1_2_v1'
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! < 0
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_roc20lt0_term1_2_v1'
          && Number.isFinite(qqqROC20) && qqqROC20! < 0
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_trendlt50_term1_2_v1'
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 50
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_rvlt50_term_lt1_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_rvlt50_trendge70_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_rv50_67_adxlt15_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .50 && tqqqRealisedVol20d! < .67
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15)
        || (String(dualMainQualityGate) === 'r9_e33_quality_or_trend50_70_ext0_1_5_v1'
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
    || (String(dualMainQualityGate) === 'r9_e33_quality_or_er10_30_term_lt1_v1'
          && Number.isFinite(qqqEr20) && qqqEr20! >= .1 && qqqEr20! < .3
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1))
    || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_v1'
      || String(dualMainQualityGate) === 'r9_e34_quality_or_trendge70_v1'
      || String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt60_trendge70_v1'
      || String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt40_trendge70_v1'
      || String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_trendge60_v1'
      || String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_trendge80_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_trendge70_v1'
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt60_trendge70_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .60
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt40_trendge70_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_trendge60_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 60)
        || (String(dualMainQualityGate) === 'r9_e34_quality_or_rvlt50_trendge80_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 80))
    || (String(dualMainQualityGate) === 'r9_e36_quality_or_trend50_70_ext0_1_5_v1'
      || String(dualMainQualityGate) === 'r9_e36_quality_or_term1_2_range5_8_v1'
      || String(dualMainQualityGate) === 'r9_e36_quality_or_term_lt1_roc20lt0_v1'
      || String(dualMainQualityGate) === 'r9_e36_quality_or_term_lt1_er10_30_v1'
      || String(dualMainQualityGate) === 'r9_e36_quality_or_residual_union_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (String(dualMainQualityGate) === 'r9_e36_quality_or_trend50_70_ext0_1_5_v1'
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (String(dualMainQualityGate) === 'r9_e36_quality_or_term1_2_range5_8_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08)
        || (String(dualMainQualityGate) === 'r9_e36_quality_or_term_lt1_roc20lt0_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || (String(dualMainQualityGate) === 'r9_e36_quality_or_term_lt1_er10_30_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqEr20) && qqqEr20! >= .1 && qqqEr20! < .3)
        || (String(dualMainQualityGate) === 'r9_e36_quality_or_residual_union_v1'
          && (((Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)
            && (Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5))
            || ((Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
              && (Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08))
            || ((Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1)
              && (Number.isFinite(qqqROC20) && qqqROC20! < 0))
            || ((Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1)
              && (Number.isFinite(qqqEr20) && qqqEr20! >= .1 && qqqEr20! < .3)))))
    || (String(dualMainQualityGate) === 'r9_e37_quality_or_union_ab_v1'
      || String(dualMainQualityGate) === 'r9_e37_quality_or_union_ac_v1'
      || String(dualMainQualityGate) === 'r9_e37_quality_or_union_bc_v1'
      || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_extlt2_v1'
      || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_trend45_70_v1'
      || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_term_lt1_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || ((String(dualMainQualityGate) === 'r9_e37_quality_or_union_ab_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_ac_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_extlt2_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_trend45_70_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_term_lt1_v1')
          && Number.isFinite(ctx.results.trend?.data.score)
          && ctx.results.trend!.data.score >= (String(dualMainQualityGate).includes('trend45') ? 45 : 50)
          && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr)
          && regimeData!.price_extension_atr! >= 0
          && regimeData!.price_extension_atr! < (String(dualMainQualityGate).includes('extlt2') ? 2 : 1.5))
        || ((String(dualMainQualityGate) === 'r9_e37_quality_or_union_ab_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_bc_v1')
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || ((String(dualMainQualityGate) === 'r9_e37_quality_or_union_ac_v1'
          || String(dualMainQualityGate) === 'r9_e37_quality_or_union_bc_v1')
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqEr20) && qqqEr20! >= .1 && qqqEr20! < .3)
        || (String(dualMainQualityGate) === 'r9_e37_quality_or_union_a_term_lt1_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1))
    || (String(dualMainQualityGate) === 'r9_e38_quality_or_union_ab_trend55_ext0_1_5_v1'
      || String(dualMainQualityGate) === 'r9_e38_quality_or_union_ab_trend55_ext0_2_v1'
      || String(dualMainQualityGate) === 'r9_e38_quality_or_union_ab_trend55_ext0_1_0_v1'
      || String(dualMainQualityGate) === 'r9_e38_quality_or_union_ab_trend50_60_ext0_1_5_v1'
      || String(dualMainQualityGate) === 'r9_e38_quality_or_union_ab_b_only_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || ((String(dualMainQualityGate) !== 'r9_e38_quality_or_union_ab_b_only_v1')
          && Number.isFinite(ctx.results.trend?.data.score)
          && ctx.results.trend!.data.score >= (String(dualMainQualityGate).includes('trend55') ? 55 : 50)
          && ctx.results.trend!.data.score < (String(dualMainQualityGate).includes('trend50_60') ? 60 : 70)
          && Number.isFinite(regimeData?.price_extension_atr)
          && regimeData!.price_extension_atr! >= (String(dualMainQualityGate).includes('ext0_1_0') ? 0 : 0)
          && regimeData!.price_extension_atr! < (String(dualMainQualityGate).includes('ext0_2') ? 2 : String(dualMainQualityGate).includes('ext0_1_0') ? 1 : 1.5))
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0))
    || (String(dualMainQualityGate) === 'r9_e41_quality_or_union_ab_term1_2_adx15_22_trend50_70_v1'
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)))
    || (String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_adx15_22_v1'
      || String(dualMainQualityGate) === 'r9_e42_quality_or_adx15_22_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_adx15_22_trend50_70_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || ((String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_trend50_70_v1'
          || String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_adx15_22_trend50_70_v1')
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)
        || ((String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_adx15_22_v1'
          || String(dualMainQualityGate) === 'r9_e42_quality_or_term1_2_adx15_22_trend50_70_v1')
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
        || (String(dualMainQualityGate) === 'r9_e42_quality_or_adx15_22_trend50_70_v1'
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70))
    || (String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_trend55_v1'
      || String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_trend50_60_v1'
      || String(dualMainQualityGate) === 'r9_e43_quality_or_term0_2_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e43_quality_or_term1_5_2_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_v1'
      || String(dualMainQualityGate) === 'r9_e43_quality_or_trend50_70_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_trend55_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 55 && ctx.results.trend!.data.score < 70)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_trend50_60_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 60)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_term0_2_trend50_70_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 0 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_term1_5_2_trend50_70_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1.5 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_term1_2_v1'
          && Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix >= 1 && vix3m! - vix < 2)
        || (String(dualMainQualityGate) === 'r9_e43_quality_or_trend50_70_v1'
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70))
    || (String(dualMainQualityGate) === 'r9_e44_quality_or_term0_5_2_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e44_quality_or_term0_2_trend55_v1'
      || String(dualMainQualityGate) === 'r9_e44_quality_or_term0_2_trend50_60_v1'
      || String(dualMainQualityGate) === 'r9_e44_quality_or_term0_2_vixlt22_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e44_quality_or_term0_2_vixlt23_trend50_70_v1'
      || String(dualMainQualityGate) === 'r9_e44_quality_or_term0_2_roc5ge0_trend50_70_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || (Number.isFinite(vix3m) && Number.isFinite(vix)
          && vix3m! - vix >= (String(dualMainQualityGate).includes('term0_5_2') ? .5 : 0)
          && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score)
          && ctx.results.trend!.data.score >= (String(dualMainQualityGate).includes('trend55') ? 55 : 50)
          && ctx.results.trend!.data.score < (String(dualMainQualityGate).includes('trend50_60') ? 60 : 70)
          && (!String(dualMainQualityGate).includes('vixlt') || Number.isFinite(regimeData?.vix ?? vix))
          && (!String(dualMainQualityGate).includes('vixlt') || (regimeData?.vix ?? vix)! < (String(dualMainQualityGate).includes('vixlt22') ? 22 : 23))
          && (!String(dualMainQualityGate).includes('roc5ge0') || (Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= 0))))
    || (String(dualMainQualityGate) === 'r9_e46_quality_or_riskon_rv50_67_adx15_22_v1'
      || String(dualMainQualityGate) === 'r9_e46_quality_or_riskon_rv50_67_range5_8_v1'
      || String(dualMainQualityGate) === 'r9_e46_quality_or_riskon_rv50_67_union_v1')
      && (dualMainQualityR8E29Base()
        || dualMainQualityR8E29Extension()
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 70)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 0 && regimeData!.price_extension_atr! < 1.5)
        || (Number.isFinite(vix3m) && Number.isFinite(vix) && vix3m! - vix < 1
          && Number.isFinite(qqqROC20) && qqqROC20! < 0)
        || (Number.isFinite(vix3m) && Number.isFinite(vix)
          && vix3m! - vix >= 0 && vix3m! - vix < 2
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50 && ctx.results.trend!.data.score < 70)
        || ((regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .50 && tqqqRealisedVol20d! < .67
          && (String(dualMainQualityGate).includes('adx15_22')
            ? Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22
            : Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08)))
    || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening2_rsi50_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_extlt0_weakening2_rsi50_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_range_lt5_weakening2_rsi50_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_weakening2_rsi50_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening2_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening1_rsi50_v1'
      || String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_rsi50_v1')
      && (dualMainQualityR9E47Union()
        || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening2_rsi50_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
        || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_extlt0_weakening2_rsi50_v1'
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! < 0
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
        || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_range_lt5_weakening2_rsi50_v1'
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! < .05
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
        || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_weakening2_rsi50_v1'
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
        || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening2_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2))
    || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_weakening1_rsi50_v1'
      && (dualMainQualityR9E47Union()
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 1
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)))
    || (String(dualMainQualityGate) === 'r9_e49_quality_or_r9e47_union_or_rvlt50_rsi50_v1'
      && (dualMainQualityR9E47Union()
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)))
    || (String(dualMainQualityGate) === 'r9_e68_e49_or_adxlt15_range05_v1'
      && (dualMainQualityR9E47Union()
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.weakening_signal_count) && regimeData!.weakening_signal_count! >= 2
          && Number.isFinite(regimeData?.rsi14) && regimeData!.rsi14! >= 50)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 15
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (String(dualMainQualityGate) === 'r9_e53_base_or_macro4_or_e47_e49_v1'
      && dualMainQualityR9E53Compact(4))
    || (String(dualMainQualityGate) === 'r9_e53_base_or_macro5_or_e47_e49_v1'
      && dualMainQualityR9E53Compact(5))
    || (String(dualMainQualityGate) === 'r9_e53_base_or_macro6_or_e47_e49_v1'
      && dualMainQualityR9E53Compact(6))
    || (String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_rv50_67_v1'
      || String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_adx15_22_v1'
      || String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_range5_8_v1'
      || String(dualMainQualityGate) === 'r9_e47_quality_or_rv50_67_adx15_22_v1'
      || String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_adx15_22_or_range5_8_v1')
      && (dualMainQualityR9E43Parent()
        || (String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_rv50_67_v1'
          && (regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .50 && tqqqRealisedVol20d! < .67)
        || (String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_adx15_22_v1'
          && (regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
        || (String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_range5_8_v1'
          && (regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08)
        || (String(dualMainQualityGate) === 'r9_e47_quality_or_rv50_67_adx15_22_v1'
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! >= .50 && tqqqRealisedVol20d! < .67
          && Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
        || (String(dualMainQualityGate) === 'r9_e47_quality_or_riskon_adx15_22_or_range5_8_v1'
          && (regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED')
          && ((Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 15 && regimeData!.adx14! < 22)
            || (Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05 && regimeData!.range20d_pct! < .08))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_adxlt12_or_ma50slope005_range05_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 12)
        || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .005
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_adxlt12_or_trendlt55_range05_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! < 12)
        || (Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score < 55
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! >= .05)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_vix17_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt40_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_rv20_lt50_roc5ge002_or_vix16_rv20lt50_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt40_notbullsr02_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .40
          && !(regime === 'BULL' && slowSubregimeState === 'SR02'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt50_atr2_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 2)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt50_atr2_or_priceabove010_notbull_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 2)
        || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10
          && regime !== 'BULL')
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 2)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .45
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_v1'
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 2)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .45
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)
        || (Number.isFinite(qqqEr20) && qqqEr20! >= .20
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || ((dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_sma20slope_range08_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_sma20slope_range07_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_dist50slope02_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_roc20slope02_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_ma50slope02_trend50_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_ma50slope04_trend40_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_navdd05_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_navdd05_or_ma50slope02_trend50_v1'
      || dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_veto_lowvix_range_sr02_v1')
      && (dualMainQualityBase(26)
        || (Number.isFinite(regimeData?.adx14) && regimeData!.adx14! >= 22
          && !(regime === 'BULL' && slowSubregimeState === 'SR01')
          && !(regime === 'RISK_ON_WEAKENING' && slowSubregimeState === 'SR02')
          && !(regime === 'RISK_ON_EXTENDED' && slowSubregimeState === 'SR01'))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 20)
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .05)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(qqqROC5ForCapRelease) && qqqROC5ForCapRelease >= .02)
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 16)
          && Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && Number.isFinite(regimeData?.price_extension_atr) && regimeData!.price_extension_atr! >= 2)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .45
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)
        || (Number.isFinite(qqqEr20) && qqqEr20! >= .20
          && Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)
        || (Number.isFinite(tqqqRealisedVol20d) && tqqqRealisedVol20d! < .50
          && !(regime === 'BULL' && slowSubregimeState === 'SR02'))
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_v1'
          && Number.isFinite(csVixChange5d) && csVixChange5d! >= 0
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! < .08)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_sma20slope_range08_v1'
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! < .08
          && Number.isFinite(qqqSma20SlopePct) && qqqSma20SlopePct! >= 0)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_sma20slope_range07_v1'
          && Number.isFinite(regimeData?.range20d_pct) && regimeData!.range20d_pct! < .07
          && Number.isFinite(qqqSma20SlopePct) && qqqSma20SlopePct! >= 0)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_dist50slope02_v1'
          && Number.isFinite(regimeData?.distanceToSma50Pct) && regimeData!.distanceToSma50Pct! >= .02
          && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_roc20slope02_v1'
          && Number.isFinite(qqqROC20) && qqqROC20! >= 0
          && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_ma50slope02_trend50_v1'
          && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_ma50slope04_trend40_v1'
          && Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .04
          && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 40)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_navdd05_v1'
          && Number.isFinite(ctx.results.drawdownGovernor?.data.drawdownPct)
          && ctx.results.drawdownGovernor!.data.drawdownPct! >= .05)
        || (dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_or_navdd05_or_ma50slope02_trend50_v1'
          && ((Number.isFinite(ctx.results.drawdownGovernor?.data.drawdownPct)
            && ctx.results.drawdownGovernor!.data.drawdownPct! >= .05)
            || (Number.isFinite(regimeData?.ma50_slope_pct) && regimeData!.ma50_slope_pct! >= .02
              && Number.isFinite(ctx.results.trend?.data.score) && ctx.results.trend!.data.score >= 50)))
        || ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)
          && (regime !== 'RANGE_BOUND'
            || (Number.isFinite(regimeData?.price_vs_sma200_pct) && regimeData!.price_vs_sma200_pct! >= .10)))))
    || (dualMainQualityGate === 'adx25_or_rv20_lt30_v1' && dualMainQualityBase(25))
    || (dualMainQualityGate === 'adx30_or_rv20_lt30_and_er20vix_v1'
      && dualMainQualityBase(30)
      && ((Number.isFinite(qqqEr20) && qqqEr20! >= .30)
        || (Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! >= 17)));
  const dualMainQualityPassed = dualMainQualityRawPassed
    && !(dualMainQualityGate === 'adx26_or_rv20_lt30_or_adx22_safe_state_or_vix20_sma005_or_vix16_rv20lt50_or_rv20lt45_sma010_or_er20ge020_sma010_or_vix17_nonrange_sma010_or_notbullsr02_rv20lt50_or_vixchange5d_nonnegative_range08_veto_lowvix_range_sr02_v1'
      && ((Number.isFinite(regimeData?.vix ?? vix) && (regimeData?.vix ?? vix)! < 17)
        || (regime === 'RANGE_BOUND' && slowSubregimeState === 'SR02')));
  const dualRescueWithMainProposal = params.pcsRescueDualWithMainProposal === true
    && primaryAction === 'ADD_PUT_CREDIT_SPREAD'
    && mainPcsProposalBuiltBeforeRescue
    && dualMainQualityPassed;
  const pcsRescueProposal = promoteRescueOnMainProposalCandidate
    ? undefined
    : primaryAction === 'ADD_PCS_RESCUE'
      || (mainPcsProposalBuiltBeforeRescue && !dualRescueWithMainProposal)
    ? undefined
    : buildPcsRescueProposal();
  const pcsRescueProposalForMainReplacement = promoteRescueOnMainProposalCandidate
    ? buildPcsRescueProposal()
    : pcsRescueProposal;
  const promoteRescueOnMainFailure = params.pcsRescuePromoteOnMainFailure === true
    && primaryAction === 'ADD_PUT_CREDIT_SPREAD'
    && primaryProposal === undefined
    && !mainPcsProposalBuiltBeforeRescue
    && pcsRescueProposalForMainReplacement !== undefined;
  const promoteRescueOnMainProposal = !dualRescueWithMainProposal
    && promoteRescueOnMainProposalCandidate
    && pcsRescueProposalForMainReplacement !== undefined;
  if (promoteRescueOnMainFailure || promoteRescueOnMainProposal) {
    selectedProposal = pcsRescueProposalForMainReplacement;
    action = 'ADD_PCS_RESCUE';
    proposed_strikes = pcsRescueProposalForMainReplacement!.proposed_strikes;
    premium_estimate = pcsRescueProposalForMainReplacement!.premium_estimate;
    cs_max_risk_pct = pcsRescueProposalForMainReplacement!.cs_max_risk_pct;
  }
  const promoteRescue = promoteRescueOnMainFailure || promoteRescueOnMainProposal;
  const overlayProposals = coordinateOverlayProposals(promoteRescue ? pcsRescueProposalForMainReplacement : primaryProposal, [...supplementalOverlayProposals, promoteRescue ? undefined : pcsRescueProposalForMainReplacement]);
  const pcsProposalBuilt = overlayProposals.some((proposal) => proposal.action === 'ADD_PUT_CREDIT_SPREAD');
  const equityBoostProposalBuilt = overlayProposals.some((proposal) => proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD');
  const pcsRescueProposalBuilt = overlayProposals.some((proposal) => proposal.action === 'ADD_PCS_RESCUE');
  const pcsV121Blocked = pcsV121StateBlocked && pcsV121Released !== true;
  if (pcsV121Blocked) {
    warnings.push('PCS V1.2.1 简化5族闸：选腿后的生存率下限/Sigma未满足释放条件，跳过新开');
  }
  const pcsVariantBlockers = [
    pcsStreakCooldownBlocked ? '连败冷静期未结束' : null,
    pcsExcludedByRiskOnWeakening ? 'RISK_ON_WEAKENING 专属排除' : null,
    pcsChopVixBlocked ? '2.1.2 chop/VIX 闸阻断' : null,
    pcsBass221Blocked ? '2.2.1 专属闸阻断' : null,
    pcsV11Blocked ? 'V1.1 专属闸阻断' : null,
    pcsBass232Candidate2Blocked ? 'PCS 候选2闸阻断' : null,
    pcsBass232Candidate3Blocked ? 'bass2.3.2 候选3闸阻断' : null,
    pcsV12Blocked ? 'V1.2 Balanced-Tail 闸阻断' : null,
    pcsV121Blocked ? 'V1.2.1 简化5族闸阻断' : null,
    pcsV123BlockedBy.length > 0 ? `V1.2.3 分支阻断：${pcsV123BlockedBy.join('/')}` : null,
    pcsEntryBlocked ? '逐日研究闸阻断' : null,
    pcsNativeP1R1EntryBlocked ? '原生 P1-R1 状态/W20 闸阻断' : null,
    pcsCandidateAEntryBlocked ? 'v1.2.7b/P0 候选 A 基础风险盾牌阻断' : null,
    pcsResearchEntryFilterBlocked ? `研究胜率过滤闸阻断：${pcsResearchEntryFilter}` : null,
  ].filter((reason): reason is string => reason !== null);
  // 回测归因：在所有候选构建已完成后收敛整条 PCS 准入链。
  // 仅记录事实，不参与触发、选腿、仓位或优先级判断。
  pcsGateDiagnostics = {
    ...(pcsGateDiagnostics ?? {
      v121StateBlocked: pcsV121StateBlocked,
      v121SimpleRelease: false,
      v121Released: false,
    }),
    safetyPassed: pcsSafetyConditionsMet,
    safetyBlockers: pcsSafetyBlockers,
    reactiveTimingPassed: pcsReactiveTiming?.eligible,
    reactiveTimingReasons: pcsReactiveTiming?.reasonCodes,
    originalSignalTriggered: pcsOriginalSignal,
    pageSignalTriggered: pcsPageSignal,
    variantBlockers: pcsVariantBlockers,
    priorityPassed: pcs_triggered_final,
    candidateBuildAttempted: pcs_triggered_final,
    candidateBuilt: pcsProposalBuilt,
    v123BlockedBy: pcsV123BlockedBy,
    riskEnvelopeBand: pcsDiagnosticRiskEnvelope.band,
    ...(params.pcsRescueEnabled === true ? {
      pcsRescueEligible: pcsRescueSourceActive,
      pcsRescueSource: pcsRescueSourceActive ? pcsRescueEntryMode : undefined,
      pcsRescueShortDelta: pcsRescueProposal?.pcsRescueShortDelta ?? (action === 'ADD_PCS_RESCUE' ? selectedProposal?.pcsRescueShortDelta : undefined),
      pcsRescueShadowP3Path: pcsRescueShadowP3PathDiagnostic,
    } : {}),
  };
  const equityBoostVariantBlockers = [
    ebExcludedSubstate ? 'EB 专属状态/风险闸阻断' : null,
  ].filter((reason): reason is string => reason !== null);
  const strategyAdmissions: NonNullable<OverlayData['strategyAdmissions']> = [
    {
      strategyTag: 'QQQ_PUT_CREDIT_SPREAD',
      strategyLabel: 'PCS',
      eligibility: pcsProposalBuilt ? 'OPEN' : 'BLOCK',
      reasons: pcsProposalBuilt
        ? ['PCS 候选已构建；按下一交易日执行。']
        : [
            !pcsSafetyConditionsMet ? '安全闸未通过（策略启用、期限结构、危机、Collar 或已有 PCS）' : null,
            !pcsOriginalSignal && !pcsPageSignal ? 'PCS 策略信号未触发' : null,
            ...pcsVariantBlockers,
            pcs_triggered && equity_boost_triggered ? '同日由 EB 优先执行' : null,
            pcs_triggered_final && !pcsProposalBuilt ? 'PCS 候选合约不可构建' : null,
          ].filter((reason): reason is string => reason !== null),
      gates: [
        { label: '安全闸', status: pcsSafetyConditionsMet ? 'PASS' : 'BLOCK', detail: pcsSafetyConditionsMet ? '通过安全、持仓与保护结构检查' : '策略启用、期限结构、危机、Collar 或已有 PCS 未通过' },
        { label: '策略信号', status: pcsOriginalSignal || pcsPageSignal ? 'PASS' : 'BLOCK', detail: pcsOriginalSignal ? 'PCS 时机信号通过' : pcsPageSignal ? 'PCS 页面信号通过' : 'PCS 时机与页面信号均未触发' },
        { label: '变体专属闸', status: pcsVariantBlockers.length === 0 ? 'PASS' : 'BLOCK', detail: pcsVariantBlockers.length === 0 ? '当前回放变体专属闸通过' : pcsVariantBlockers.join('；') },
        { label: '同日优先级', status: pcs_triggered && equity_boost_triggered ? 'BLOCK' : 'PASS', detail: pcs_triggered && equity_boost_triggered ? '同日 Equity Boost 优先于普通 PCS' : '无更高优先级的 bullish Put Spread' },
        { label: '候选可构建', status: pcsProposalBuilt ? 'PASS' : pcs_triggered_final ? 'BLOCK' : 'UNAVAILABLE', detail: pcsProposalBuilt ? 'PCS 合约候选已构建' : pcs_triggered_final ? 'PCS 信号通过但合约候选不可构建' : '前置阶段未通过，未进入候选构建' },
      ],
    },
    {
      strategyTag: 'QQQ_EQUITY_BOOST_PUT_SPREAD',
      strategyLabel: 'EB',
      eligibility: equityBoostProposalBuilt ? 'OPEN' : 'BLOCK',
      reasons: equityBoostProposalBuilt
        ? ['EB 候选已构建；按下一交易日执行。']
        : [
            !enableEquityBoostPCS ? 'EB 未启用' : null,
            !equityBoostRawSignal ? 'EB 策略信号未触发' : null,
            ...equityBoostVariantBlockers,
            equity_boost_triggered && !equityBoostProposalBuilt ? 'EB 候选合约不可构建' : null,
          ].filter((reason): reason is string => reason !== null),
      gates: [
        { label: '安全闸', status: enableEquityBoostPCS ? 'PASS' : 'BLOCK', detail: enableEquityBoostPCS ? 'EB 回放已启用' : 'EB 未启用' },
        { label: '策略信号', status: equityBoostRawSignal ? 'PASS' : 'BLOCK', detail: equityBoostRawSignal ? 'EB 时机信号通过' : 'EB 时机信号未触发' },
        { label: '变体专属闸', status: equityBoostVariantBlockers.length === 0 ? 'PASS' : 'BLOCK', detail: equityBoostVariantBlockers.length === 0 ? '当前回放变体专属闸通过' : equityBoostVariantBlockers.join('；') },
        { label: '同日优先级', status: 'PASS', detail: 'EB 在同日 bullish Put Spread 中优先执行' },
        { label: '候选可构建', status: equityBoostProposalBuilt ? 'PASS' : equity_boost_triggered ? 'BLOCK' : 'UNAVAILABLE', detail: equityBoostProposalBuilt ? 'EB 合约候选已构建' : equity_boost_triggered ? 'EB 信号通过但合约候选不可构建' : '前置阶段未通过，未进入候选构建' },
      ],
    },
    ...(params.pcsRescueEnabled === true ? [{
      strategyTag: 'QQQ_PCS_RESCUE' as const,
      strategyLabel: 'PCS_RESCUE' as const,
      eligibility: pcsRescueProposalBuilt ? 'OPEN' as const : 'BLOCK' as const,
      reasons: pcsRescueProposalBuilt
        ? [`PCS_RESCUE 候选已构建；Delta=${((pcsRescueProposal?.pcsRescueShortDelta ?? selectedProposal?.pcsRescueShortDelta ?? 0) * 100).toFixed(1)}%，按下一交易日执行。`]
        : [
            !pcsSafetyConditionsMet ? '安全闸未通过（危机、期限结构、Collar 或已有 PCS）' : null,
            !pcsRescueSourceActive ? 'PCS_RESCUE 机会池来源未触发' : null,
            equity_boost_triggered ? '同日由 EB 优先执行' : null,
            mainPcsProposalBuiltBeforeRescue ? '普通 PCS 已构建，PCS_RESCUE 不重复开仓' : null,
            pcsRescueSourceActive && !pcsRescueProposalBuilt ? 'PCS_RESCUE 候选合约不可构建' : null,
          ].filter((reason): reason is string => reason !== null),
      gates: [
        { label: '安全闸' as const, status: pcsSafetyConditionsMet ? 'PASS' as const : 'BLOCK' as const, detail: pcsSafetyConditionsMet ? '复用 PCS 安全闸；不旁路危机、倒挂或 Collar 互斥' : 'PCS 安全闸未通过' },
        { label: '策略信号' as const, status: pcsRescueSourceActive ? 'PASS' as const : 'BLOCK' as const, detail: pcsRescueSourceActive ? `PCS_RESCUE ${pcsRescueEntryMode} 机会池通过` : '未进入 PCS_RESCUE 机会池' },
        { label: '变体专属闸' as const, status: pcsRescueRegimeAllowed ? 'PASS' as const : 'BLOCK' as const, detail: pcsRescueRegimeAllowed ? `状态范围 ${pcsRescueRegimeScope} 通过` : `状态范围 ${pcsRescueRegimeScope} 阻断` },
        { label: '同日优先级' as const, status: equity_boost_triggered || mainPcsProposalBuiltBeforeRescue ? 'BLOCK' as const : 'PASS' as const, detail: equity_boost_triggered ? '同日 EB 优先' : mainPcsProposalBuiltBeforeRescue ? '普通 PCS 已占用，不重复开仓' : '无更高优先级 bullish Put Spread' },
        { label: '候选可构建' as const, status: pcsRescueProposalBuilt ? 'PASS' as const : pcsRescueSourceActive && !mainPcsProposalBuiltBeforeRescue ? 'BLOCK' as const : 'UNAVAILABLE' as const, detail: pcsRescueProposalBuilt ? 'PCS_RESCUE 合约候选已构建' : pcsRescueSourceActive && !mainPcsProposalBuiltBeforeRescue ? 'PCS_RESCUE 信号通过但合约候选不可构建' : '前置阶段未通过或普通 PCS 已构建' },
      ],
    }] : []),
  ];

  return finalizeOverlayCoordination({
    data: {
      action,
      overlay_type: overlayTypeForAction(action),
      collar_triggered,
      call_spread_triggered,
      call_spread_secondary_triggered,
      call_spread_coverage_triggered,
      ...(params.csResearchEntryGate && params.csResearchEntryGate !== 'off'
        ? { cs_research_entry_gate_blocked: csResearchEntryFinalBlocked }
        : {}),
      csSecondaryEventRiskState: ctx.input.csSecondaryEventRiskState,
      put_spread_triggered: pcs_triggered_final,
      ...(params.pcsRescueEnabled === true ? { pcs_rescue_triggered: pcsRescueSourceActive } : {}),
      iron_condor_triggered,
      bear_call_spread_triggered,
      equity_boost_triggered,
      proposed_strikes,
      premium_estimate,
      iron_condor_max_risk_pct,
      cs_max_risk_pct,
      collar: collarMeta,
      callCreditSpread: callCreditSpreadMeta,
      putCreditSpread: putCreditSpreadMeta,
      ...(params.pcsRescueEnabled === true ? { pcsRescuePutSpread } : {}),
      ironCondor: ironCondorMeta,
      bearCallSpread,
      equityBoostPutSpread,
      bearFactors: bearOverlay.factors,
      ...traceFactors,
      overlayProposals,
      collarEligibility,
      preferredAction,
      alternativeAction,
      csBreachState,
      pcsPageSignalRaw,
      ...(ctx.input.mode === 'backtest' ? { strategyAdmissions } : {}),
      ...(ctx.input.mode === 'backtest' ? { pcsGateDiagnostics } : {}),
    },
    warnings,
    blockers,
  });
}
