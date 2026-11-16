import { closeOptionPosition, createLegacyOptionMarket, settleOptionPosition, type OptionPricing } from '../options';
import { OVERLAY_STRATEGY_TAGS } from '../../constants';
import type { OptionChain, PcsStreakState } from '../../types/input';
import { findNearestExpiry } from '../../utils';
import { validatePutCreditSpread } from '../../overlayValidation';
import { evaluateExitConditions } from '../../exitConditions';
import { evaluatePCSStockDecisionFilter, type PCSPageDecisionMode } from './pcs-stock-decision-filter';
import type { MarketRegime } from '../../types/output';
import type { PCSRescueDeltaMode, PCSRescueExtremeWidthProfile } from '../../types/params';
import type { OverlayCloseResult, OverlayOpenResult, OverlayPosition, OverlaySettlementResult } from '../base';
import { resolveOptionQuote } from '../../../../optionQuote';

export type PutCreditSpreadPosition = OverlayPosition & { shortStrike: number; longStrike: number; width: number; creditReceived: number };
export type PutSpreadKind = 'PCS' | 'EQUITY_BOOST' | 'PCS_RESCUE';

/**
 * Resolve the extreme-state width without changing the default global path.
 * The research-only ADX split keeps the narrow width in the low/high ADX
 * buckets and falls back to the historical wide width in the middle bucket.
 */
export function resolvePcsRescueExtremeWidth(input: {
  profile?: PCSRescueExtremeWidthProfile;
  extremeWidthPct?: number;
  narrowWidthPct?: number;
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  adx14?: number;
  extremePressure?: boolean;
}): number | undefined {
  if (input.extremePressure !== true) return undefined;
  if (input.profile !== 'adx_split_v1') return input.extremeWidthPct;
  if (input.regime !== 'RISK_ON_EXTENDED' || input.slowSubregime !== 'SR02' || (input.vix ?? Number.POSITIVE_INFINITY) >= 14) return input.extremeWidthPct;
  const adx = input.adx14;
  return Number.isFinite(adx) && (adx! < 30 || adx! >= 44) ? input.narrowWidthPct ?? input.extremeWidthPct : input.extremeWidthPct;
}

export function putCreditSpreadTradeMeta(kind: PutSpreadKind, longStrike: number, shortStrike: number, underlying = 'QQQ') {
  if (kind === 'EQUITY_BOOST') {
    return { symbol: `${underlying} Equity Boost Put Spread @${longStrike}/${shortStrike}`, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD };
  }
  if (kind === 'PCS_RESCUE') {
    return { symbol: `${underlying} PCS Rescue @${longStrike}/${shortStrike}`, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE };
  }
  return { symbol: `${underlying} Put Credit Spread @${longStrike}/${shortStrike}`, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD };
}

function boundedRescueDelta(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  return Number.isFinite(candidate) ? Math.min(.25, Math.max(.01, Math.abs(candidate))) : fallback;
}

/**
 * PCS_RESCUE 的透明状态桶选约：只使用入场前已知状态，不按逐日结果拟合。
 * 普通模式的压力状态把短腿外移到 2.5Δ；quality 模式不把低 VIX 的
 * RISK_ON_EXTENDED 一律视为压力，便于在受控扩展池里提高收益密度。
 */
export function resolvePcsRescueShortDelta(input: {
  mode: PCSRescueDeltaMode;
  fixedDelta?: number;
  calmDelta?: number;
  normalDelta?: number;
  pressureDelta?: number;
  extremeDelta?: number;
  extremeBaseDelta?: number;
  extremeFallbackDelta?: number;
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  vixTermStructureSlope?: number;
  qqqEr20?: number;
  weakeningSignalCount?: number;
  rv20?: number;
  adx14?: number;
  trendScore?: number;
  priceVsSma200Pct?: number;
  priceExtensionAtr?: number;
  range20dPct?: number;
  drawdownFromRecentHighPct?: number;
  versionPressure?: boolean;
  extremePressure?: boolean;
  preCrisisActive?: boolean;
}): number {
  if (input.mode === 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_v1' || input.mode === 'macro_continuous_v3_e67_or_range20_ge8_drawdown_le5_v1' || input.mode === 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_residual_v1' || input.mode === 'macro_continuous_v3_e67_or_range20_ge8_drawdown_le5_residual_v1') {
    const e67 = (input.regime !== 'BULL' && input.slowSubregime !== 'SR02')
      || (input.regime === 'BULL' && input.slowSubregime === 'SR01' && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.rv20) && input.rv20! < .5);
    const termLowVix = Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0 && input.vixTermStructureSlope! < 2 && (input.vix ?? Number.POSITIVE_INFINITY) < 14;
    const trendExtension = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const highExtensionMode = input.mode === 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_v1' || input.mode === 'macro_continuous_v3_e67_or_ext_ge15_adx_lt15_residual_v1';
    const residualMode = String(input.mode).endsWith('_residual_v1');
    const complement = highExtensionMode
      ? Number.isFinite(input.adx14) && input.adx14! < 15 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5
      : Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && Number.isFinite(input.drawdownFromRecentHighPct) && input.drawdownFromRecentHighPct! <= .05;
    const parentMacro = e67 || termLowVix || trendExtension;
    return resolvePcsRescueShortDelta({ ...input, mode: residualMode
      ? parentMacro ? 'macro_continuous_v3_e67_or_term0_2_vix_lt14_v1' as any : complement ? 'continuous_quality_v1' : 'range_smart_quality_v33'
      : e67 ? (input.regime !== 'BULL' && input.slowSubregime !== 'SR02' ? 'continuous_quality_v3' : 'continuous_quality_v1') : (complement || termLowVix || trendExtension) ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_or_high_ext_non_sr02_range_non_sr02_v1') {
    const e67 = (input.regime !== 'BULL' && input.slowSubregime !== 'SR02')
      || (input.regime === 'BULL' && input.slowSubregime === 'SR01' && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.rv20) && input.rv20! < .5);
    const weakSr02 = input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02' && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 12;
    const highExtensionNonSr02 = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5 && input.slowSubregime !== 'SR02';
    const rangeNonSr02 = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08 && input.slowSubregime !== 'SR02';
    const termLowVix = Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0 && input.vixTermStructureSlope! < 2 && (input.vix ?? Number.POSITIVE_INFINITY) < 14;
    const trendExtension = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const complement = weakSr02 || highExtensionNonSr02 || rangeNonSr02 || termLowVix || trendExtension;
    return resolvePcsRescueShortDelta({ ...input, mode: e67 ? (input.regime !== 'BULL' && input.slowSubregime !== 'SR02' ? 'continuous_quality_v3' : 'continuous_quality_v1') : complement ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_vix18_adx22_v1') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const vixAdxBucket = (input.vix ?? Number.NEGATIVE_INFINITY) >= 18 && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 22;
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : vixAdxBucket ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_rv_lt50_v1') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const rvBucket = Number.isFinite(input.rv20) && input.rv20! < .50;
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : rvBucket ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_not_precrisis_v1') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const calmMacroBucket = input.preCrisisActive !== true;
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : calmMacroBucket ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_risk_on_rv_lt50_v1') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const riskOnRvBucket = (input.regime === 'RISK_ON_EXTENDED' || input.regime === 'RISK_ON_WEAKENING')
      && Number.isFinite(input.rv20) && input.rv20! < .50;
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : riskOnRvBucket ? 'continuous_quality_v1' : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_bull_sr01_v1' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_v2' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_v3') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const bullSr01Bucket = input.regime === 'BULL' && input.slowSubregime === 'SR01';
    const profile = input.mode.endsWith('_v1') ? 'continuous_quality_v1' : input.mode.endsWith('_v2') ? 'continuous_quality_v2' : 'continuous_quality_v3';
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : bullSr01Bucket ? profile : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_not_precrisis_v1' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v1' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v2' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_rv_lt50_v3') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const trendBucket = input.regime === 'BULL' && input.slowSubregime === 'SR01'
      && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70;
    const guardBucket = input.mode.endsWith('_not_precrisis_v1') ? input.preCrisisActive !== true : Number.isFinite(input.rv20) && input.rv20! < .5;
    const profile = input.mode.endsWith('_v2') ? 'continuous_quality_v2' : input.mode.endsWith('_v3') ? 'continuous_quality_v3' : 'continuous_quality_v1';
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : trendBucket && guardBucket ? profile : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v1' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v2' || input.mode === 'macro_continuous_v3_e52_or_bull_sr01_trend50_70_v3') {
    const e52Bucket = input.regime !== 'BULL' && input.slowSubregime !== 'SR02';
    const trendBucket = input.regime === 'BULL' && input.slowSubregime === 'SR01'
      && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70;
    const profile = input.mode.endsWith('_v1') ? 'continuous_quality_v1' : input.mode.endsWith('_v2') ? 'continuous_quality_v2' : 'continuous_quality_v3';
    return resolvePcsRescueShortDelta({ ...input, mode: e52Bucket ? 'continuous_quality_v3' : trendBucket ? profile : 'range_smart_quality_v33' });
  }
  if (String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_v1'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_v2'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_term_lt1_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_term_lt1_25_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_term_lt1_35_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_term_lt1_4_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt5_5_term_lt1_35_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt6_term_lt1_35_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt6_5_term_lt1_35_v3'
    || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt7_term_lt1_35_v3'
    || /^macro_continuous_v3_e67_or_term0_2_vix_lt14_or_range_lt\d+(?:_\d+)?_term_lt\d+(?:_\d+)?(?:_if_(?:non_bull_sr02_or_vix_lt18|non_bull_sr02_or_rv_lt50|non_bull_sr02|vix_lt18|rv_lt50))?_v3$/.test(String(input.mode))) {
    const e67Bucket = (input.regime !== 'BULL' && input.slowSubregime !== 'SR02')
      || (input.regime === 'BULL' && input.slowSubregime === 'SR01'
        && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70
        && Number.isFinite(input.rv20) && input.rv20! < .5);
    const termMidBucket = Number.isFinite(input.vixTermStructureSlope)
      && input.vixTermStructureSlope! >= 0 && input.vixTermStructureSlope! < 2;
    const originalTermComplement = termMidBucket && (input.vix ?? Number.POSITIVE_INFINITY) < 14;
    const releaseRangeToken = input.mode.match(/_range_lt(\d+(?:_\d+)?)_term_lt/)?.[1] ?? '5';
    const releaseRangeMax = Number(releaseRangeToken.replace('_', '.')) / 100;
    const releaseTermToken = input.mode.match(/_term_lt(\d+(?:_\d+)?)(?:_if_(?:non_bull_sr02_or_vix_lt18|non_bull_sr02_or_rv_lt50|non_bull_sr02|vix_lt18|rv_lt50))?_v3$/)?.[1] ?? '1';
    const releaseTermMax = Number(releaseTermToken.replace('_', '.'));
    const rangeReleaseTerm = input.mode.includes('_term_lt')
      ? Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0
        && input.vixTermStructureSlope! < releaseTermMax
      : termMidBucket;
    const releaseCondition = input.mode.match(/_if_(non_bull_sr02_or_vix_lt18|non_bull_sr02_or_rv_lt50|non_bull_sr02|vix_lt18|rv_lt50)_v3$/)?.[1];
    const nonBullSr02 = input.regime !== 'BULL' || input.slowSubregime !== 'SR02';
    const extensionState = releaseCondition === 'non_bull_sr02'
      ? nonBullSr02
      : releaseCondition === 'vix_lt18'
        ? Number.isFinite(input.vix) && input.vix! < 18
        : releaseCondition === 'rv_lt50'
          ? Number.isFinite(input.rv20) && input.rv20! < .5
          : releaseCondition === 'non_bull_sr02_or_vix_lt18'
            ? nonBullSr02 || (Number.isFinite(input.vix) && input.vix! < 18)
            : releaseCondition === 'non_bull_sr02_or_rv_lt50'
              ? nonBullSr02 || (Number.isFinite(input.rv20) && input.rv20! < .5)
              : true;
    const rangeRelease = releaseCondition !== undefined
      ? Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0
        && Number.isFinite(input.range20dPct)
        && ((input.vixTermStructureSlope! < 1.6 && input.range20dPct! < .06)
          || (extensionState && rangeReleaseTerm && input.range20dPct! < releaseRangeMax))
      : rangeReleaseTerm && Number.isFinite(input.range20dPct) && input.range20dPct! < releaseRangeMax;
    const trendExtensionBucket = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70
      && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const rangeProfile = input.mode.endsWith('_v3') ? 'continuous_quality_v3' : input.mode.endsWith('_v2') ? 'continuous_quality_v2' : 'continuous_quality_v1';
    return resolvePcsRescueShortDelta({ ...input, mode: e67Bucket
      ? input.regime !== 'BULL' && input.slowSubregime !== 'SR02' ? 'continuous_quality_v3' : 'continuous_quality_v1'
      : originalTermComplement || trendExtensionBucket ? 'continuous_quality_v1'
        : rangeRelease ? rangeProfile : 'range_smart_quality_v33' });
  }
  if (input.mode === 'macro_continuous_v3_e67_or_vix18_adx22_v1' || input.mode === 'macro_continuous_v3_e67_or_rv_ge67_v1' || input.mode === 'macro_continuous_v3_e67_or_trend50_70_v1' || input.mode === 'macro_continuous_v3_e67_or_ext_lt0_v1' || input.mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_non_bull_sr02_v1' || input.mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_vix18_adx22_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_vix18_rv_lt50_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_range_rv_lt50_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_bull_sr02_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_bull_sr02_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_risk_on_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_risk_on_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_fallback_v30' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_fallback_v31' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_fallback_v32' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_or_range20_ge8_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_non_bull_sr02_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_trend_lt50_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_vix_ge18_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_risk_on_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_ext_lt0_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_adx_ge22_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_rv_ge67_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_range20_ge8_not_precrisis_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_or_trend50_70_ext_ge15_merged_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_or_trend50_70_ext_ge15_merged_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_or_trend50_70_ext_ge15_merged_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_term0_2_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_vix_lt14_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_er01_03_weakening2_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_v2' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_v3' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt15_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt18_adx_ge12_v1' || String(input.mode) === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_or_high_ext_non_sr02_v1') {
    const e67Bucket = (input.regime !== 'BULL' && input.slowSubregime !== 'SR02')
      || (input.regime === 'BULL' && input.slowSubregime === 'SR01' && Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.rv20) && input.rv20! < .5);
    const vixAdxBucket = (input.vix ?? Number.NEGATIVE_INFINITY) >= 18 && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 22;
    const rvHighBucket = Number.isFinite(input.rv20) && input.rv20! >= .67;
    const trendExtensionBucket = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const highExtensionBucket = Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5;
    const complementGuard = input.mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_non_bull_sr02_v1' ? !(input.regime === 'BULL' && input.slowSubregime === 'SR02') : true;
    const mode = String(input.mode);
    const vixRvBucket = (input.vix ?? Number.NEGATIVE_INFINITY) >= 18 && Number.isFinite(input.rv20) && input.rv20! < .5;
    const vixLowExtensionBucket = (input.vix ?? Number.POSITIVE_INFINITY) < 14 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0;
    const rangeBucket = input.regime === 'RANGE_BOUND' || input.regime === 'SIDEWAYS';
    const riskOnBucket = input.regime === 'RISK_ON_EXTENDED' || input.regime === 'RISK_ON_WEAKENING';
    const rangeRvBucket = rangeBucket && Number.isFinite(input.rv20) && input.rv20! < .5;
    const rangeWideBucket = Number.isFinite(input.range20dPct) && input.range20dPct! >= .08;
    const termLowVixBucket = Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0 && input.vixTermStructureSlope! < 2 && (input.vix ?? Number.POSITIVE_INFINITY) < 14;
    const termMidBucket = Number.isFinite(input.vixTermStructureSlope) && input.vixTermStructureSlope! >= 0 && input.vixTermStructureSlope! < 2;
    const erWeakeningBucket = Number.isFinite(input.qqqEr20) && input.qqqEr20! >= .1 && input.qqqEr20! < .3 && Number.isFinite(input.weakeningSignalCount) && input.weakeningSignalCount! >= 2;
    const weakSr02Bucket = input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02';
    const weakSr02GuardedBucket = weakSr02Bucket && (mode === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt15_v1'
      ? (input.vix ?? Number.POSITIVE_INFINITY) < 15
      : mode === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_v1' || mode === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_or_high_ext_non_sr02_v1'
        ? (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 12
        : mode === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt18_adx_ge12_v1'
          ? (input.vix ?? Number.POSITIVE_INFINITY) < 18 && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 12
          : true);
    const highExtensionNonSr02Bucket = trendExtensionBucket === false
      && highExtensionBucket
      && input.slowSubregime !== 'SR02';
    const rangeNonSr02Bucket = rangeWideBucket && input.slowSubregime !== 'SR02';
    const vixLowBucket = (input.vix ?? Number.POSITIVE_INFINITY) < 14;
    const rangeWideGuard = mode === 'macro_continuous_v3_e67_or_range20_ge8_non_bull_sr02_v1' ? !(input.regime === 'BULL' && input.slowSubregime === 'SR02') : mode === 'macro_continuous_v3_e67_or_range20_ge8_trend_lt50_v1' ? Number.isFinite(input.trendScore) && input.trendScore! < 50 : mode === 'macro_continuous_v3_e67_or_range20_ge8_vix_ge18_v1' ? vixAdxBucket || (input.vix ?? Number.NEGATIVE_INFINITY) >= 18 : mode === 'macro_continuous_v3_e67_or_range20_ge8_risk_on_v1' ? riskOnBucket : mode === 'macro_continuous_v3_e67_or_range20_ge8_ext_lt0_v1' ? Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0 : mode === 'macro_continuous_v3_e67_or_range20_ge8_adx_ge22_v1' ? Number.isFinite(input.adx14) && input.adx14! >= 22 : mode === 'macro_continuous_v3_e67_or_range20_ge8_rv_ge67_v1' ? rvHighBucket : mode === 'macro_continuous_v3_e67_or_range20_ge8_not_precrisis_v1' ? input.preCrisisActive !== true : true;
    const rangeWideComplement = rangeWideBucket && rangeWideGuard;
    const complement = input.mode === 'macro_continuous_v3_e67_or_vix18_adx22_v1' ? vixAdxBucket : input.mode === 'macro_continuous_v3_e67_or_rv_ge67_v1' ? rvHighBucket : input.mode === 'macro_continuous_v3_e67_or_trend50_70_v1' ? (Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70) : input.mode === 'macro_continuous_v3_e67_or_ext_lt0_v1' ? (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 0) : mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_vix18_adx22_v1' ? (trendExtensionBucket || vixAdxBucket) : mode === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v1' || mode === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v2' || mode === 'macro_continuous_v3_e67_or_trend50_70_ext_ge15_v3' ? highExtensionBucket : mode === 'macro_continuous_v3_e67_or_vix18_rv_lt50_v1' ? vixRvBucket : mode === 'macro_continuous_v3_e67_or_range_v1' ? rangeBucket : mode === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v1' || mode === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v2' || mode === 'macro_continuous_v3_e67_or_vix_lt14_ext_lt0_v3' ? vixLowExtensionBucket : mode === 'macro_continuous_v3_e67_or_range_rv_lt50_v1' ? rangeRvBucket : mode === 'macro_continuous_v3_e67_or_risk_on_v2' || mode === 'macro_continuous_v3_e67_or_risk_on_v3' ? riskOnBucket : mode === 'macro_continuous_v3_e67_or_term0_2_vix_lt14_v1' ? termLowVixBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_term0_2_v1' ? termMidBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_vix_lt14_v1' ? vixLowBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_er01_03_weakening2_v1' ? erWeakeningBucket || termLowVixBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_weak_sr02_v1' || mode === 'macro_continuous_v3_e67_or_weak_sr02_v2' || mode === 'macro_continuous_v3_e67_or_weak_sr02_v3' ? weakSr02Bucket || termLowVixBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt15_v1' || mode === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_v1' || mode === 'macro_continuous_v3_e67_or_weak_sr02_vix_lt18_adx_ge12_v1' ? weakSr02GuardedBucket || termLowVixBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_or_high_ext_non_sr02_v1' ? weakSr02GuardedBucket || highExtensionNonSr02Bucket || termLowVixBucket || (trendExtensionBucket && complementGuard) : mode === 'macro_continuous_v3_e67_or_weak_sr02_adx_ge12_or_high_ext_non_sr02_range_non_sr02_v1' ? weakSr02GuardedBucket || highExtensionNonSr02Bucket || rangeNonSr02Bucket || termLowVixBucket || (trendExtensionBucket && complementGuard) : mode.startsWith('macro_continuous_v3_e67_or_trend50_70_ext_lt0_or_trend50_70_ext_ge15_merged_') ? (trendExtensionBucket || highExtensionBucket) : mode.startsWith('macro_continuous_v3_e67_or_range20_ge8_') ? rangeWideComplement || (trendExtensionBucket && complementGuard) : trendExtensionBucket && complementGuard;
    const bullSr02ProfileOverride = (mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_bull_sr02_v2' || mode === 'macro_continuous_v3_e67_or_trend50_70_ext_lt0_bull_sr02_v3') && input.regime === 'BULL' && input.slowSubregime === 'SR02';
    const complementProfile = bullSr02ProfileOverride ? (mode.endsWith('_v3') ? 'continuous_quality_v3' : 'continuous_quality_v2') : mode.endsWith('_v2') ? 'continuous_quality_v2' : mode.endsWith('_v3') ? 'continuous_quality_v3' : 'continuous_quality_v1';
    const fallbackProfile = mode.endsWith('_fallback_v30') ? 'range_smart_quality_v30' : mode.endsWith('_fallback_v31') ? 'range_smart_quality_v31' : mode.endsWith('_fallback_v32') ? 'range_smart_quality_v32' : 'range_smart_quality_v33';
    return resolvePcsRescueShortDelta({ ...input, mode: e67Bucket ? (input.regime !== 'BULL' && input.slowSubregime !== 'SR02' ? 'continuous_quality_v3' : 'continuous_quality_v1') : complement ? complementProfile : fallbackProfile });
  }
  if (input.mode.startsWith('macro_continuous_')) {
    const profile = input.mode.startsWith('macro_continuous_v1_') ? 'continuous_quality_v1'
      : input.mode.startsWith('macro_continuous_v2_') ? 'continuous_quality_v2'
        : input.mode.startsWith('macro_continuous_v4_') ? 'continuous_quality_v4'
          : 'continuous_quality_v3';
    const useContinuous = input.mode === 'macro_continuous_v3_non_bull_sr02_guarded_v1'
      ? !(input.regime === 'BULL' && input.slowSubregime === 'SR02')
      : input.mode === 'macro_continuous_v3_non_bull_v1'
        ? input.regime !== 'BULL'
        : input.mode === 'macro_continuous_v1_non_bull_non_sr02_v1' || input.mode === 'macro_continuous_v2_non_bull_non_sr02_v1' || input.mode === 'macro_continuous_v3_non_bull_non_sr02_v1' || input.mode === 'macro_continuous_v4_non_bull_non_sr02_v1'
          ? input.regime !== 'BULL' && input.slowSubregime !== 'SR02'
        : input.mode === 'macro_continuous_v1_non_bull_non_sr02_or_vix18_adx22_v1'
          ? (input.regime !== 'BULL' && input.slowSubregime !== 'SR02') || ((input.vix ?? Number.NEGATIVE_INFINITY) >= 18 && (input.adx14 ?? Number.NEGATIVE_INFINITY) >= 22)
          : input.mode === 'macro_continuous_v3_non_sr02_v1'
          ? input.slowSubregime !== 'SR02'
          : input.mode === 'macro_continuous_v3_non_bull_non_sr02_or_range_midtrend_ext_v1'
            ? (input.regime !== 'BULL' && input.slowSubregime !== 'SR02')
              || input.regime === 'RANGE_BOUND'
              || (Number.isFinite(input.trendScore) && input.trendScore! >= 50 && input.trendScore! < 70 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 1.5)
            : input.regime === 'RISK_ON_EXTENDED' || input.regime === 'RISK_ON_WEAKENING';
    return resolvePcsRescueShortDelta({ ...input, mode: useContinuous ? profile : 'range_smart_quality_v33' });
  }
  if (input.mode === 'fixed') return boundedRescueDelta(input.fixedDelta, .025);
  const vix = input.vix ?? Number.POSITIVE_INFINITY;
  const rv20 = input.rv20 ?? Number.POSITIVE_INFINITY;
  const adx14 = input.adx14 ?? Number.NEGATIVE_INFINITY;
  const rangeSmartVersion = input.mode.startsWith('range_smart_quality_v')
    ? Number(input.mode.slice('range_smart_quality_v'.length))
    : 0;
  const smartRangeFixed = rangeSmartVersion > 0;
  const qualityAdaptive = input.mode === 'state_adaptive_quality_v1'
    || input.mode === 'state_adaptive_quality_v2'
    || input.mode === 'state_adaptive_quality_v3'
    || input.mode === 'state_adaptive_quality_v4'
    || input.mode === 'state_adaptive_quality_v5'
    || input.mode === 'continuous_quality_v1'
    || input.mode === 'continuous_quality_v2'
    || input.mode === 'continuous_quality_v3'
    || input.mode === 'continuous_quality_v4'
    || input.mode === 'range_fixed_quality_v1'
    || smartRangeFixed;
  const strictRangeOnly = (input.mode === 'continuous_quality_v4' || input.mode === 'range_fixed_quality_v1') && input.regime !== 'RANGE_BOUND';
  const calmGuarded = rangeSmartVersion >= 2;
  const calmRequiresPrice = calmGuarded && rangeSmartVersion !== 10 && rangeSmartVersion !== 13;
  const calmRequiresRv = calmGuarded && rangeSmartVersion !== 2 && rangeSmartVersion !== 12 && rangeSmartVersion !== 16 && rangeSmartVersion !== 17 && rangeSmartVersion !== 18 && rangeSmartVersion !== 19 && rangeSmartVersion !== 20 && rangeSmartVersion !== 21 && rangeSmartVersion !== 22 && rangeSmartVersion !== 23 && rangeSmartVersion !== 24 && rangeSmartVersion !== 25 && rangeSmartVersion !== 26 && rangeSmartVersion !== 27 && rangeSmartVersion !== 28 && rangeSmartVersion !== 29 && rangeSmartVersion !== 30 && rangeSmartVersion !== 31 && rangeSmartVersion !== 32;
  const calmRequiresAtr = calmGuarded && rangeSmartVersion !== 2 && rangeSmartVersion !== 3 && rangeSmartVersion !== 11 && rangeSmartVersion !== 13 && rangeSmartVersion !== 33;
  const smartCalmAllowed = !calmGuarded
    || (!calmRequiresPrice || (Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct! < .15))
      && (!calmRequiresRv || (Number.isFinite(input.rv20) && input.rv20! < .45))
      && (!calmRequiresAtr || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.5));
  const ultraCleanCalm = rangeSmartVersion === 20
    && vix < 13
    && rv20 < .35
    && adx14 >= 30
    && Number.isFinite(input.priceVsSma200Pct)
    && input.priceVsSma200Pct! < .10
    && Number.isFinite(input.priceExtensionAtr)
    && input.priceExtensionAtr! < 1;
  const conditionalCalmGate = rangeSmartVersion === 24
    ? vix < 13.5
    : rangeSmartVersion === 25
      ? Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.25
      : rangeSmartVersion === 26
        ? vix < 13.5 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.25)
        : rangeSmartVersion === 27
          ? vix < 13.5 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.25
          : rangeSmartVersion === 28
            ? vix < 13.5 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.40)
            : rangeSmartVersion === 29
              ? vix < 13.5 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.35)
              : rangeSmartVersion === 30
                ? vix < 13.5 || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.30)
                : rangeSmartVersion === 31
                  ? Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.40
                  : rangeSmartVersion === 32
                    ? Number.isFinite(input.priceExtensionAtr) && vix + input.priceExtensionAtr! < 14.75
                    : rangeSmartVersion === 33
                      ? Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! < 1.40
          : true;
  const conditionalNormalUplift = (rangeSmartVersion === 21 || rangeSmartVersion === 23)
    && input.regime === 'RANGE_BOUND'
    && !(
      input.versionPressure === true
      || input.extremePressure === true
      || vix >= 18
      || rv20 >= .67
      || adx14 < 12
    )
    && Number.isFinite(input.adx14)
    && input.adx14! >= 20;
  const calmDeltaInput = smartRangeFixed
    ? rangeSmartVersion === 20 && !ultraCleanCalm
      ? .15
      : rangeSmartVersion >= 24 && rangeSmartVersion <= 33 && !conditionalCalmGate
        ? .15
        : input.calmDelta
    : strictRangeOnly ? .10 : input.calmDelta;
  const normalDeltaInput = smartRangeFixed && input.regime !== 'RANGE_BOUND' ? .075 : strictRangeOnly ? .075 : input.normalDelta;
  const pressure = input.versionPressure === true
    || input.extremePressure === true
    || (!qualityAdaptive && (input.regime === 'RISK_ON_EXTENDED' || input.regime === 'SIDEWAYS'))
    || vix >= 18
    || rv20 >= .67
    || adx14 < 12;
  const smartPressureSafe = ((rangeSmartVersion >= 5 && rangeSmartVersion <= 7) || rangeSmartVersion >= 10)
    && input.versionPressure !== true
    && input.extremePressure !== true
    && ((Number.isFinite(input.rv20) && input.rv20! < .67) || (Number.isFinite(input.adx14) && input.adx14! >= 12));
  const strictPressureSafe = rangeSmartVersion === 8
    && input.versionPressure !== true
    && input.extremePressure !== true
    && ((Number.isFinite(input.rv20) && input.rv20! < .50) || (Number.isFinite(input.adx14) && input.adx14! >= 20));
  const mediumPressureSafe = rangeSmartVersion === 9
    && input.versionPressure !== true
    && input.extremePressure !== true
    && ((Number.isFinite(input.rv20) && input.rv20! < .55) || (Number.isFinite(input.adx14) && input.adx14! >= 15));
  const pressureDeltaInput = ((rangeSmartVersion >= 5 && rangeSmartVersion <= 7) || rangeSmartVersion >= 10) && pressure && !smartPressureSafe
    ? .0375
    : (rangeSmartVersion === 8 && pressure && !strictPressureSafe) || (rangeSmartVersion === 9 && pressure && !mediumPressureSafe)
      ? .0375
      : input.pressureDelta;
  const smartNormalSafe = rangeSmartVersion >= 6
    && input.regime === 'RANGE_BOUND'
    && !pressure
    && Number.isFinite(input.adx14)
    && input.adx14! >= (rangeSmartVersion === 16 || rangeSmartVersion === 19 ? 20 : 15)
    && (rangeSmartVersion !== 19 || (Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct! < .10));
  const normalDelta = conditionalNormalUplift
    ? input.normalDelta
    : (rangeSmartVersion === 21 || rangeSmartVersion === 23)
      ? (smartNormalSafe ? .13 : .12)
      : rangeSmartVersion >= 6 && !smartNormalSafe ? .12 : input.normalDelta;
  if ((input.mode === 'range_fixed_quality_v1' || smartRangeFixed) && input.regime === 'RANGE_BOUND' && input.extremePressure !== true) {
    return boundedRescueDelta(pressure ? pressureDeltaInput : normalDelta, .05);
  }
  // Research-only hybrid: keep the quality modes' extreme branch intact, and
  // interpolate only the non-extreme portion. The original continuous_v1
  // intentionally remains unchanged for historical parity.
  if (input.mode === 'continuous_v1' || (input.mode === 'continuous_quality_v1' && input.extremePressure !== true) || (input.mode === 'continuous_quality_v2' && input.extremePressure !== true) || (input.mode === 'continuous_quality_v3' && input.extremePressure !== true) || (input.mode === 'continuous_quality_v4' && input.extremePressure !== true && input.regime === 'RANGE_BOUND')) {
    const unit = (value: number, low: number, high: number) => Math.min(1, Math.max(0, (value - low) / (high - low)));
    const vixStress = unit(vix, 12, 20);
    const rvStress = unit(rv20, .30, .67);
    const adxStress = unit(20 - adx14, 0, 8);
    const regimeStress = input.regime === 'RISK_ON_EXTENDED' || input.regime === 'SIDEWAYS' ? 1 : 0;
    const stress = Math.min(1, Math.max(regimeStress, .45 * vixStress + .35 * rvStress + .20 * adxStress));
    const calmDelta = boundedRescueDelta(calmDeltaInput, .075);
    const normalDelta = boundedRescueDelta(normalDeltaInput, .05);
    const pressureDelta = boundedRescueDelta(input.pressureDelta, .025);
    const target = stress <= .5
      ? normalDelta + (calmDelta - normalDelta) * (1 - stress * 2)
      : pressureDelta + (normalDelta - pressureDelta) * (2 - stress * 2);
    if (input.mode === 'continuous_quality_v2' || input.mode === 'continuous_quality_v3' || input.mode === 'continuous_quality_v4') {
      // Research-only upward float: retain qv5's pressure floor, and only
      // let normal states drift toward the calm ceiling as stress falls.
      if (pressure) return boundedRescueDelta(pressureDelta, .025);
      const calm = input.regime === 'BULL' || input.regime === 'RANGE_BOUND' || input.regime === 'RISK_ON_WEAKENING'
        || (qualityAdaptive && input.regime === 'RISK_ON_EXTENDED');
      const floor = calm && vix < 14 && rv20 < .50 && adx14 >= 20 ? calmDelta : normalDelta;
      if ((input.mode === 'continuous_quality_v3' || input.mode === 'continuous_quality_v4') && input.regime !== 'RANGE_BOUND') return boundedRescueDelta(undefined, floor);
      return boundedRescueDelta(undefined, Math.max(floor, target));
    }
    return boundedRescueDelta(undefined, target);
  }
  const calmEligible = !pressure
    && (input.regime === 'BULL' || input.regime === 'RANGE_BOUND' || input.regime === 'RISK_ON_WEAKENING' || (qualityAdaptive && input.regime === 'RISK_ON_EXTENDED'))
    && (rangeSmartVersion === 14 || vix < 14)
    && rv20 < .50
    && (rangeSmartVersion === 15 || adx14 >= 20);
  const calm = calmEligible && smartCalmAllowed;
  if (calm) return boundedRescueDelta(calmDeltaInput, .075);
  if (rangeSmartVersion >= 2 && calmEligible) return boundedRescueDelta(.10, .075);
  if (pressure) {
    const highRiskExtreme = input.mode === 'state_adaptive_quality_v2'
      && input.extremePressure === true
      && (
        (Number.isFinite(input.adx14) && input.adx14! >= 45)
        || (Number.isFinite(input.rv20) && input.rv20! >= .45 && Number.isFinite(input.adx14) && input.adx14! >= 20)
        || (Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct! >= .15)
        || (Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 3)
        || (Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct! >= .10 && Number.isFinite(input.priceExtensionAtr) && input.priceExtensionAtr! >= 2.5)
      );
    const precisionRiskExtreme = (input.mode === 'state_adaptive_quality_v3' || input.mode === 'state_adaptive_quality_v4' || input.mode === 'state_adaptive_quality_v5' || input.mode === 'continuous_quality_v1' || input.mode === 'continuous_quality_v2' || input.mode === 'continuous_quality_v3' || input.mode === 'continuous_quality_v4' || input.mode === 'range_fixed_quality_v1' || rangeSmartVersion >= 1)
      && input.extremePressure === true
      && (
        (input.regime === 'RISK_ON_EXTENDED'
          && vix < 13
          && Number.isFinite(input.rv20)
          && input.rv20! >= .45
          && Number.isFinite(input.adx14)
          && input.adx14! >= 20
          && input.adx14! < 35)
        || (input.regime === 'RISK_ON_EXTENDED'
          && vix < 13.5
          && Number.isFinite(input.adx14)
          && input.adx14! >= 20
          && input.adx14! < 30
          && Number.isFinite(input.priceVsSma200Pct)
          && input.priceVsSma200Pct! >= .10)
        || (input.regime === 'RISK_ON_EXTENDED'
          && vix < 13.5
          && Number.isFinite(input.adx14)
          && input.adx14! >= 44.5)
        || (input.regime === 'RISK_ON_EXTENDED'
          && vix < 14
          && Number.isFinite(input.priceVsSma200Pct)
          && input.priceVsSma200Pct! >= .15)
        || (input.regime === 'BULL'
          && vix < 12
          && Number.isFinite(input.adx14)
          && input.adx14! < 20)
        || (input.regime === 'RANGE_BOUND'
          && vix > 18
          && Number.isFinite(input.rv20)
          && input.rv20! >= .50)
      );
    const residualRiskExtreme = (input.mode === 'state_adaptive_quality_v4' || input.mode === 'state_adaptive_quality_v5' || input.mode === 'continuous_quality_v1' || input.mode === 'continuous_quality_v2' || input.mode === 'continuous_quality_v3' || input.mode === 'continuous_quality_v4' || input.mode === 'range_fixed_quality_v1' || rangeSmartVersion >= 1)
      && input.extremePressure === true
      && (
        (input.regime === 'RISK_ON_EXTENDED'
          && vix < 10
          && Number.isFinite(input.adx14)
          && input.adx14! < 20
          && Number.isFinite(input.priceVsSma200Pct)
          && input.priceVsSma200Pct! >= .10)
        || (input.regime === 'RISK_ON_EXTENDED'
          && vix < 10.5
          && Number.isFinite(input.adx14)
          && input.adx14! >= 30
          && input.adx14! < 40
          && Number.isFinite(input.priceVsSma200Pct)
          && input.priceVsSma200Pct! >= .13
          && Number.isFinite(input.priceExtensionAtr)
          && input.priceExtensionAtr! >= 2.5)
        || (input.regime === 'BULL'
          && vix < 13
          && Number.isFinite(input.rv20)
          && input.rv20! >= .45
          && Number.isFinite(input.adx14)
          && input.adx14! >= 20)
        || (input.regime === 'BULL'
          && vix < 13
          && Number.isFinite(input.adx14)
          && input.adx14! < 15)
      );
    const baseSafeExtreme = input.extremePressure === true
      && input.regime === 'RISK_ON_EXTENDED'
      && vix < 13
      && Number.isFinite(input.adx14)
      && input.adx14! >= 20;
    const conditionalExtremeUplift = (rangeSmartVersion === 22 || rangeSmartVersion === 23)
      && baseSafeExtreme
      && input.adx14! >= 30;
    const safeExtremeUplift = (input.mode === 'state_adaptive_quality_v5' || input.mode === 'continuous_quality_v1' || input.mode === 'continuous_quality_v2' || input.mode === 'continuous_quality_v3' || input.mode === 'continuous_quality_v4' || input.mode === 'range_fixed_quality_v1' || (rangeSmartVersion >= 1 && rangeSmartVersion !== 22 && rangeSmartVersion !== 23))
      && input.extremePressure === true
      && input.regime === 'RISK_ON_EXTENDED'
      && vix < 13
      && Number.isFinite(input.adx14)
      && input.adx14! >= (rangeSmartVersion === 17 ? 30 : rangeSmartVersion === 18 ? 25 : 20)
      && (rangeSmartVersion !== 18 || (Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct! < .10));
    const extremeDelta = highRiskExtreme || precisionRiskExtreme || residualRiskExtreme
      ? input.extremeFallbackDelta ?? normalDeltaInput
      : conditionalExtremeUplift
        ? input.extremeDelta
      : safeExtremeUplift
        ? input.extremeDelta
        : (rangeSmartVersion === 22 || rangeSmartVersion === 23) && baseSafeExtreme
          ? .2425
        : input.extremeBaseDelta ?? input.extremeDelta;
    return boundedRescueDelta(input.extremePressure ? extremeDelta ?? pressureDeltaInput : pressureDeltaInput, .025);
  }
  return boundedRescueDelta(normalDeltaInput, .05);
}

export type PutCreditSpreadOpen = OverlayPosition & { shortStrike: number; longStrike: number; credit?: number; maxLoss: number; riskBudgetUsed?: number; quoteSource?: 'market' | 'last_trade'; quoteAsOf?: number | null; quoteHaircut?: number; pairSearchUsed?: boolean };

const executablePut = (put: OptionChain['expirations'][number]['puts'][number] | undefined) => {
  if (put == null || !Number.isFinite(put.strike) || put.strike <= 0 || !Number.isFinite(put.openInterest) || put.openInterest <= 0 || !Number.isFinite(put.volume) || put.volume < 0) return null;
  const quote = resolveOptionQuote(put, 0.5);
  return quote ? { put, quote } : null;
};

const executablePutQuoteOnly = (put: OptionChain['expirations'][number]['puts'][number] | undefined) => {
  if (put == null || !Number.isFinite(put.strike) || put.strike <= 0 || !Number.isFinite(put.openInterest) || put.openInterest < 0 || !Number.isFinite(put.volume) || put.volume < 0) return null;
  const quote = resolveOptionQuote(put, 0.5);
  return quote ? { put, quote } : null;
};

export function evaluatePutCreditSpreadSafety(input: { enabled: boolean; regime: string; crisisPhase?: string; backwardation: boolean; hasOpenCollar: boolean; collarTriggered: boolean; hasOpenPutSpread: boolean }): boolean {
  if (!input.enabled || input.backwardation || input.hasOpenCollar || input.collarTriggered || input.hasOpenPutSpread) return false;
  return input.regime !== 'CRISIS' && input.regime !== 'BEAR' && input.crisisPhase !== 'CONFIRMED' && input.crisisPhase !== 'PENDING';
}

/**
 * 快速回测的 reactive_pcs 是既有研究基线；不得接入 reactive_pcs_v1 的
 * 期限结构/危机阶段门控，避免改写历史对比口径。
 */
export function evaluatePutCreditSpreadTiming(input: { mode: string; regime: string; vix: number; qqqRoc5: number; pullbackRoc5Ceiling: number; pullbackVixFloor: number }): boolean {
  if (input.mode === 'post_pullback') return input.qqqRoc5 <= input.pullbackRoc5Ceiling && input.vix >= input.pullbackVixFloor;
  return ['BULL', 'RISK_ON_EXTENDED', 'RISK_ON_WEAKENING'].includes(input.regime) && input.vix >= 14 && input.vix <= 28;
}

/** PCS 页面评分的 v2 策略入口；底层 DecisionEngine 适配器暂由旧模块兼容提供。 */
export function evaluatePutCreditSpreadPageDecision(input: Parameters<typeof evaluatePCSStockDecisionFilter>[0] & { mode: PCSPageDecisionMode }) {
  return evaluatePCSStockDecisionFilter(input);
}

export function evaluatePutCreditSpreadPageSignal(input: { mode: string; allowed?: boolean; priorStreak: number; persistDays: number }) {
  const raw = input.mode !== 'off' && input.allowed === true;
  return { raw, triggered: raw && input.priorStreak >= input.persistDays };
}

type PutCreditSpreadOpenInput = { chain: OptionChain; date: string; targetDte: number; widthPct: number; nav: number; riskBudget: number; forceMinimumContract?: boolean; shortDelta: number; shortStrikeSigma?: 1 | 1.5 | 2 | 2.5; dailySigma20?: number; underlying?: string; pairSearchMode?: 'nearest_valid_v1' | 'nearest_valid_width_cap_v1' | 'nearest_valid_risk_cap_v1' | 'quote_only_width_v1' | 'nearest_valid_delta_cap_v1' | 'nearest_valid_credit_floor_v1' | 'nearest_valid_all_pairs_v1' | 'nearest_valid_all_pairs_below_target_delta_v1' | 'nearest_valid_all_pairs_quote_only_v1' | 'nearest_valid_quote_only_both_width_v1'; pairSearchMinCreditWidthRatio?: number };

function buildPutCreditSpreadOpenDefault(input: PutCreditSpreadOpenInput): OverlayOpenResult<PutCreditSpreadOpen> {
  const expiry = findNearestExpiry(input.chain.expirations, input.date, input.targetDte);
  const expiration = input.chain.expirations.find((item) => item.date === expiry);
  if (!expiry || !expiration) return {};
  const executablePuts = expiration.puts.map(executablePut).filter((item): item is NonNullable<typeof item> => item !== null);
  const targetShortStrike = input.shortStrikeSigma === undefined ? undefined : input.chain.spot * (1 - input.shortStrikeSigma * (input.dailySigma20 ?? 0));
  if (input.shortStrikeSigma !== undefined && (!Number.isFinite(input.dailySigma20) || input.dailySigma20! <= 0 || targetShortStrike! <= 0)) {
    return { warning: 'Put Credit Spread：日频 σ20 不可用，无法按生存曲线选约' };
  }
  const short = input.shortStrikeSigma === undefined
    ? executablePuts.sort((a, b) => Math.abs(a.put.delta + input.shortDelta) - Math.abs(b.put.delta + input.shortDelta))[0]
    : executablePuts.filter(({ put }) => put.strike < input.chain.spot).sort((a, b) => Math.abs(a.put.strike - targetShortStrike!) - Math.abs(b.put.strike - targetShortStrike!))[0];
  if (!short) return { warning: 'Put Credit Spread：没有可成交的短 Put' };
  const { put: shortPut, quote: shortQuote } = short;
  const shortStrike = shortPut.strike;
  const targetLongStrike = shortStrike - Math.round(input.chain.spot * input.widthPct / 5) * 5;
  const long = expiration.puts.map(executablePut).filter((item): item is NonNullable<typeof item> => item !== null).filter(({ put }) => put.strike < shortStrike).sort((a, b) => Math.abs(a.put.strike - targetLongStrike) - Math.abs(b.put.strike - targetLongStrike))[0];
  const longPut = long?.put;
  const longStrike = longPut?.strike;
  const underlying = input.underlying ?? 'QQQ';
  const validation = validatePutCreditSpread({ underlying, shortPutStrike: shortStrike, longPutStrike: longStrike });
  if (!validation.ok) return { warning: validation.reason };
  if (!longPut || !long) return { warning: 'Put Credit Spread：没有可成交的保护 Put' };
  // 卖方保费按可成交边计价：卖短腿取 bid、买保护腿取 ask，禁止用 mid-mid 高估。
  const credit = shortQuote.sell - long.quote.buy;
  const maxLoss = (shortStrike - longStrike) * 100 - credit * 100;
  if (!(credit > 0) || !(maxLoss > 0) || !Number.isFinite(maxLoss)) return { warning: 'Put Credit Spread：净信用金或最大损失无效' };
  let quantity = Math.floor(input.nav * input.riskBudget / maxLoss);
  if (quantity < 1) {
    if (!input.forceMinimumContract) return { warning: `Put Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），跳过` };
    quantity = 1;
    return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined, quoteSource: shortQuote.source === 'last_trade' || long.quote.source === 'last_trade' ? 'last_trade' : 'market', quoteAsOf: shortQuote.source === 'last_trade' || long.quote.source === 'last_trade' ? Math.min(...[shortQuote.asOf, long.quote.asOf].filter((value): value is number => value !== null)) : null, quoteHaircut: shortQuote.source === 'last_trade' || long.quote.source === 'last_trade' ? .05 : 0 }, warning: `Put Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），[FMQ0]强制开1张，超预算${(maxLoss / (input.nav * input.riskBudget) * 100).toFixed(0)}%` };
  }
  const proxy = shortQuote.source === 'last_trade' || long.quote.source === 'last_trade';
  return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined, quoteSource: proxy ? 'last_trade' : 'market', quoteAsOf: proxy ? Math.min(...[shortQuote.asOf, long.quote.asOf].filter((value): value is number => value !== null)) : null, quoteHaircut: proxy ? .05 : 0 } };
}

/** 研究专用：原目标短腿无法与保护腿组成有效价差时，扫描最近的有效短/长 Put 对。
 * 默认路径完全不经过该方法；它只用于 PCS_RESCUE 的一次性合约构建 fallback。 */
function buildNearestValidPutCreditSpreadOpen(input: PutCreditSpreadOpenInput): OverlayOpenResult<PutCreditSpreadOpen> {
  const base = buildPutCreditSpreadOpenDefault({ ...input, pairSearchMode: undefined });
  if (base.open) return base;
  const expiry = findNearestExpiry(input.chain.expirations, input.date, input.targetDte);
  const expiration = input.chain.expirations.find((item) => item.date === expiry);
  if (!expiry || !expiration || input.shortStrikeSigma !== undefined) return base;
  const executablePuts = expiration.puts.map(executablePut).filter((item): item is NonNullable<typeof item> => item !== null);
  const quoteOnlyBoth = input.pairSearchMode === 'nearest_valid_quote_only_both_width_v1';
  const shortPuts = quoteOnlyBoth
    ? expiration.puts.map(executablePutQuoteOnly).filter((item): item is NonNullable<typeof item> => item !== null)
    : executablePuts;
  const longPuts = input.pairSearchMode === 'quote_only_width_v1' || input.pairSearchMode === 'nearest_valid_all_pairs_quote_only_v1' || quoteOnlyBoth
    ? expiration.puts.map(executablePutQuoteOnly).filter((item): item is NonNullable<typeof item> => item !== null)
    : executablePuts;
  const targetWidth = Math.max(5, Math.round(input.chain.spot * input.widthPct / 5) * 5);
  const candidates: Array<{ score: number; short: NonNullable<ReturnType<typeof executablePut>>; long: NonNullable<ReturnType<typeof executablePut>>; credit: number; maxLoss: number }> = [];
  for (const short of shortPuts) {
    const targetLongStrike = short.put.strike - Math.round(input.chain.spot * input.widthPct / 5) * 5;
    const longCandidates = longPuts
      .filter(({ put }) => put.strike < short.put.strike)
      .sort((a, b) => Math.abs(a.put.strike - targetLongStrike) - Math.abs(b.put.strike - targetLongStrike));
    const longChoices = input.pairSearchMode === 'nearest_valid_all_pairs_v1' || input.pairSearchMode === 'nearest_valid_all_pairs_below_target_delta_v1' || input.pairSearchMode === 'nearest_valid_all_pairs_quote_only_v1' ? longCandidates : longCandidates.slice(0, 1);
    for (const long of longChoices) {
      if (input.pairSearchMode === 'nearest_valid_all_pairs_below_target_delta_v1'
        && Math.abs(short.put.delta) > Math.abs(input.shortDelta)) continue;
      if ((input.pairSearchMode === 'nearest_valid_width_cap_v1' || input.pairSearchMode === 'quote_only_width_v1' || input.pairSearchMode === 'nearest_valid_all_pairs_quote_only_v1' || quoteOnlyBoth) && short.put.strike - long.put.strike > targetWidth) continue;
      if (input.pairSearchMode === 'nearest_valid_delta_cap_v1' && Math.abs(short.put.delta + input.shortDelta) > .025) continue;
      const validation = validatePutCreditSpread({ underlying: input.underlying ?? 'QQQ', shortPutStrike: short.put.strike, longPutStrike: long.put.strike });
      if (!validation.ok) continue;
      const credit = short.quote.sell - long.quote.buy;
      const maxLoss = (short.put.strike - long.put.strike) * 100 - credit * 100;
      if (!(credit > 0) || !(maxLoss > 0) || !Number.isFinite(maxLoss)) continue;
      if (Number.isFinite(input.pairSearchMinCreditWidthRatio)
        && credit / (short.put.strike - long.put.strike) + 1e-12 < input.pairSearchMinCreditWidthRatio!) continue;
      if (input.pairSearchMode === 'nearest_valid_credit_floor_v1' && credit / (short.put.strike - long.put.strike) < .025) continue;
      if (input.pairSearchMode === 'nearest_valid_risk_cap_v1' && maxLoss > targetWidth * 100) continue;
      candidates.push({ score: Math.abs(short.put.delta + input.shortDelta), short, long, credit, maxLoss });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.maxLoss - b.maxLoss);
  const selected = candidates[0];
  if (!selected) return base;
  let quantity = Math.floor(input.nav * input.riskBudget / selected.maxLoss);
  if (quantity < 1) {
    if (!input.forceMinimumContract) return base;
    quantity = 1;
  }
  const proxy = selected.short.quote.source === 'last_trade' || selected.long.quote.source === 'last_trade';
  const underlying = input.underlying ?? 'QQQ';
  return { open: { shortStrike: selected.short.put.strike, longStrike: selected.long.put.strike, expiry, credit: selected.credit, maxLoss: selected.maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * selected.maxLoss / input.nav : undefined, quoteSource: proxy ? 'last_trade' : 'market', quoteAsOf: proxy ? Math.min(...[selected.short.quote.asOf, selected.long.quote.asOf].filter((value): value is number => value !== null)) : null, quoteHaircut: proxy ? .05 : 0, pairSearchUsed: true } };
}

export function buildPutCreditSpreadOpen(input: PutCreditSpreadOpenInput): OverlayOpenResult<PutCreditSpreadOpen> {
  const searchMode = input.pairSearchMode;
  const usesPairSearch = searchMode === 'nearest_valid_v1' || searchMode === 'nearest_valid_width_cap_v1' || searchMode === 'nearest_valid_risk_cap_v1' || searchMode === 'quote_only_width_v1' || searchMode === 'nearest_valid_delta_cap_v1' || searchMode === 'nearest_valid_credit_floor_v1' || searchMode === 'nearest_valid_all_pairs_v1' || searchMode === 'nearest_valid_all_pairs_below_target_delta_v1' || searchMode === 'nearest_valid_all_pairs_quote_only_v1' || searchMode === 'nearest_valid_quote_only_both_width_v1';
  return usesPairSearch ? buildNearestValidPutCreditSpreadOpen(input) : buildPutCreditSpreadOpenDefault(input);
}

/** Research-only execution fallback: select the closest-to-target expiration with a valid spread.
 * Every expiry still uses the ordinary execution quotes, strike choice, spread validation, and risk budget.
 */
export function buildPutCreditSpreadOpenNearestFeasibleExpiry(input: PutCreditSpreadOpenInput, order: 'target_nearest' | 'shortest_dte' = 'target_nearest'): OverlayOpenResult<PutCreditSpreadOpen> {
  const from = new Date(input.date).getTime();
  const expirations = [...input.chain.expirations].sort((a, b) => {
    const dteA = (new Date(a.date).getTime() - from) / 86400000;
    const dteB = (new Date(b.date).getTime() - from) / 86400000;
    return (order === 'shortest_dte' ? dteA - dteB : Math.abs(dteA - input.targetDte) - Math.abs(dteB - input.targetDte)) || a.date.localeCompare(b.date);
  });
  let warning: string | undefined;
  for (const expiration of expirations) {
    const result = buildPutCreditSpreadOpen({ ...input, chain: { ...input.chain, expirations: [expiration] } });
    if (result.open) return result;
    warning ??= result.warning;
  }
  return { warning };
}

/** PCS proposal 的展示与风险字段从同一开仓结果派生。 */
export function buildPutCreditSpreadProposal(input: Parameters<typeof buildPutCreditSpreadOpen>[0]) {
  const built = buildPutCreditSpreadOpen(input);
  if (!built.open) return { warning: built.warning };
  const { shortStrike, longStrike, expiry, credit, maxLoss, quantity, riskBudgetUsed, quoteSource, quoteAsOf, quoteHaircut, pairSearchUsed } = built.open;
  return {
    proposal: {
      proposedStrikes: { spread_short_strike: shortStrike, spread_long_strike: longStrike, expiry }, premiumEstimate: credit, maxRiskPct: riskBudgetUsed,
      metadata: { strategyName: `${built.open.underlying ?? 'QQQ'} Put Credit Spread @${longStrike}/${shortStrike}`, underlying: (built.open.underlying ?? 'QQQ') as 'QQQ', shortPutStrike: shortStrike, longPutStrike: longStrike, credit, maxLoss, buyingPowerImpact: maxLoss, quantity, riskBudgetUsed, quoteSource, quoteAsOf, quoteHaircut, pairSearchUsed, definedRisk: true as const, proxyOverlay: true as const, notCoveredOverlay: true as const },
    },
    warning: built.warning,
  };
}

export function evaluatePutCreditSpreadExit(input: { expiry: string; creditReceived: number; asOfDate: string; regime: MarketRegime; daysLeft: number; shortPutDelta: number; lowPrice: number; unrealizedPnl: number; deltaStopEnabled: boolean; deltaStopThreshold: number; profitTakeEnabled: boolean; profitTarget: number }): string | null {
  const exit = evaluateExitConditions({ type: 'pcs', expiry: input.expiry, credit: input.creditReceived }, {
    asOfDate: input.asOfDate, regime: input.regime, dte: input.daysLeft, shortPutDelta: input.shortPutDelta,
    deltaStopEnabled: input.deltaStopEnabled, deltaStopThreshold: input.deltaStopThreshold,
    profitTakeEnabled: input.profitTakeEnabled, profitTargetPct: input.profitTarget, unrealizedPnl: input.unrealizedPnl,
  }).find((signal) => signal.auto && signal.severity === 'CLOSE');
  if (exit?.key === 'delta_stop') return `短腿 Put Δ${(Math.abs(input.shortPutDelta) * 100).toFixed(0)}% 超限，标的 ${input.lowPrice.toFixed(2)}`;
  return exit?.key === 'profit_take' ? `提前止盈（达到 credit 的 ${(input.profitTarget * 100).toFixed(0)}%），腾出仓位等待再入场` : null;
}

export function settlePutCreditSpread(position: PutCreditSpreadPosition, qqqClose: number): OverlaySettlementResult {
  const underlying = position.underlying ?? 'QQQ';
  const loss = qqqClose < position.shortStrike ? Math.min(position.shortStrike - qqqClose, position.width) * 100 * position.quantity : 0;
  const settled = settleOptionPosition({ openingCashImpact: position.creditReceived, legs: [
    { symbol: underlying, type: 'put', side: 'short', strike: position.shortStrike, expiry: '', quantity: position.quantity },
    { symbol: underlying, type: 'put', side: 'long', strike: position.longStrike, expiry: '', quantity: position.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: '', prices: { [underlying]: qqqClose }, vix: 20 }));
  const { cashImpact, pnl } = settled;
  const note = loss === 0
    ? `Put Credit Spread 到期无损（${underlying} ${qqqClose.toFixed(2)} > @${position.shortStrike}），净 +$${pnl.toFixed(0)}`
    : `Put Credit Spread 结算：短腿 @${position.shortStrike} 被跌破，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`;
  return { cashImpact, pnl, note };
}

export function closePutCreditSpreadAtMark(position: PutCreditSpreadPosition, today: string, qqqClose: number, vix: number, reason: string, pricing: OptionPricing, vix3m?: number): OverlayCloseResult {
  const underlying = position.underlying ?? 'QQQ';
  const closed = closeOptionPosition({ openingCashImpact: position.creditReceived, legs: [
    { symbol: underlying, type: 'put', side: 'short', strike: position.shortStrike, expiry: position.expiry, quantity: position.quantity },
    { symbol: underlying, type: 'put', side: 'long', strike: position.longStrike, expiry: position.expiry, quantity: position.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: today, prices: { [underlying]: qqqClose }, vix, vix3m }), pricing);
  const [shortPut, longPut] = closed.legQuotes;
  const costPerShare = shortPut && longPut ? Math.max(0, shortPut.ask - longPut.bid) : 0;
  const cashImpact = -costPerShare * 100 * position.quantity;
  const pnl = position.creditReceived + cashImpact;
  return { cashImpact, pnl, costPerShare, note: `提前平仓 Put Credit Spread [${reason}]，回购成本 $${(-cashImpact).toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}` };
}

/** 回测终局只走一条路径：到期按 intrinsic 结算，否则按 B-S 买回并计入平仓佣金。 */
export function finalizePutCreditSpread(input: {
  position: PutCreditSpreadPosition;
  asOfDate: string;
  qqqClose: number;
  vix: number;
  pricing: OptionPricing;
  commission: number;
  vix3m?: number;
  label?: string;
}): OverlaySettlementResult & { settled: boolean } {
  const { position, asOfDate, qqqClose, vix, pricing, commission, vix3m, label = 'Put Credit Spread' } = input;
  const underlying = position.underlying ?? 'QQQ';
  if (position.expiry <= asOfDate) return { ...settlePutCreditSpread(position, qqqClose), settled: true };
  const marked = closePutCreditSpreadAtMark(position, asOfDate, qqqClose, vix, '回测结束', pricing, vix3m);
  const cashImpact = marked.cashImpact - commission;
  return {
    cashImpact,
    // 保持既有回测的运算顺序，避免浮点尾差污染冻结结果。
    pnl: position.creditReceived + cashImpact,
    note: `回测结束强制平仓 ${underlying} ${label}`,
    settled: false,
  };
}

/** 冷静期门控：today 早于 cooldownUntilDate 则阻止本次开仓。cooldownTradingDays<=0 恒返回 false（no-op，仅用于校验参数是否显式关闭，实际过期时机完全由 state.cooldownUntilDate 决定）。 */
export function evaluatePcsStreakCooldownBlocked(state: PcsStreakState | undefined, cooldownTradingDays: number, today: string): boolean {
  if (cooldownTradingDays <= 0 || !state?.cooldownUntilDate) return false;
  return today < state.cooldownUntilDate;
}

/**
 * PCS 平仓/结算时的冷静期状态更新（3 个平仓/结算点共用）。
 * 亏损平仓 → 冷静期解除日期设为「closeDate 之后第 cooldownTradingDays 个交易日」（用调用方传入的交易日日历数组做索引；
 * 若 closeDate 超出日历范围或找不到，退化为 closeDate 当天，即等效不延长）。盈利平仓不改变现有冷静期（若仍在冷静期内，维持原状态；不提前解除也不延长）。
 */
export function updatePcsStreakStateOnClose(
  state: PcsStreakState | undefined,
  input: { pnl: number; closeDate: string; cooldownTradingDays: number; tradingDayCalendar: string[] },
): PcsStreakState | undefined {
  if (input.pnl >= 0) return state;
  const idx = input.tradingDayCalendar.indexOf(input.closeDate);
  const cooldownUntilDate = idx === -1 ? input.closeDate : (input.tradingDayCalendar[idx + input.cooldownTradingDays] ?? input.tradingDayCalendar.at(-1) ?? input.closeDate);
  return { cooldownUntilDate };
}
