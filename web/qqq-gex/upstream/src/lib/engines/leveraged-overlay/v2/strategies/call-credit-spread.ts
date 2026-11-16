import { closeOptionPosition, createLegacyOptionMarket, settleOptionPosition, type OptionPricing } from '../options';
import { optionOutcomeReasonKey } from '../options';
import { CS_SP_LIKE_VIX_HIGH_DEFAULT, CS_SP_LIKE_VIX_LOW, OVERLAY_STRATEGY_TAGS } from '../../constants';
import type { TradeEntry } from '../../backtest/types';
import type { MarketEnvironmentSnapshot } from '../../types/output';
import type { OptionChain } from '../../types/input';
import { findContractByDelta, findNearestExpiry } from '../../utils';
import { validateCallCreditSpread } from '../../overlayValidation';
import { evaluateExitConditions } from '../../exitConditions';
import type { MarketRegime } from '../../types/output';
import type { CSBreachState } from '../../types/input';
import type { CSDeltaStopMode, CSPreCrisisEventScope, CSProfitTakeMode, CSSlowTrendExitMode, CSSlopeShortLegMode, CSSurvivalSelectionDteMode, CSSecondaryCoverageExitProfile, CSSecondaryCoverageTier, CSTailEntryGate, CSResearchEntryGate, CSResearchEntryReleaseMode, CSCandidate9MddEntryGate, CSCandidate9CoreFusionReleaseMode, CSValidatedSafeReleaseMode } from '../../types/params';
import type { OverlayCloseResult, OverlayOpenResult, OverlayPosition, OverlaySettlementResult } from '../base';

export type CallCreditSpreadCandidateInput = {
  enabled: boolean;
  pendingCollarHasShortCall: boolean;
  hasOpenCollarShortCall: boolean;
  hasOpenCallSpread: boolean;
  regimeAllowed: boolean;
  rangeBoundBullContext: boolean;
  mode: string;
  regime: string;
  vix: number;
  vixLowThreshold: number;
  vixHighThreshold?: number;
  vixLowFloor?: number;
  backwardation?: boolean;
  requireTermStructure?: boolean;
  tqqqRoc20: number;
  overboughtRoc20: number;
  qqqRoc5: number;
  recoveryRoc5: number;
  recoveryRoc20: number;
  hasOnlyPutSpreadProtection: boolean;
  pendingPutSpreadProtection: boolean;
  breachBlocked: boolean;
};

/** Research-only entry gate; disabled unless a positive floor is explicitly configured. */
export function isCallCreditSpreadBelowResearchCreditFloor(credit?: number, floor?: number, regime?: string, scope: 'all' | 'range_bound' | 'range_bound_sr01' | 'range_bound_sr01_vix_ge_15_5' | 'range_bound_sr01_vix_ge_15_75' | 'range_bound_sr01_vix_ge_16' | 'range_bound_vix_ge_15_5' | 'range_bound_vix_ge_15_5_vix_rising' | 'range_bound_vix_ge_15_5_vix_not_rising' | 'range_bound_vix_ge_15_75' | 'range_bound_vix_ge_16' | 'range_bound_sr02' | 'range_bound_vix_lt_15_0' | 'range_bound_vix_lt_15_5' | 'range_bound_vix_lt_16' | 'risk_on_weakening' | 'bull' | 'bull_or_risk_on_weakening' = 'all', vix?: number, slowSubregime?: string, vixChange5d?: number): boolean {
  const scoped = scope === 'all'
    || scope === 'range_bound' && regime === 'RANGE_BOUND'
    || scope === 'range_bound_sr01' && regime === 'RANGE_BOUND' && slowSubregime === 'SR01'
    || scope === 'range_bound_sr01_vix_ge_15_5' && regime === 'RANGE_BOUND' && slowSubregime === 'SR01' && vix !== undefined && vix >= 15.5
    || scope === 'range_bound_sr01_vix_ge_15_75' && regime === 'RANGE_BOUND' && slowSubregime === 'SR01' && vix !== undefined && vix >= 15.75
    || scope === 'range_bound_sr01_vix_ge_16' && regime === 'RANGE_BOUND' && slowSubregime === 'SR01' && vix !== undefined && vix >= 16
    || scope === 'range_bound_vix_ge_15_5' && regime === 'RANGE_BOUND' && vix !== undefined && vix >= 15.5
    || scope === 'range_bound_vix_ge_15_5_vix_rising' && regime === 'RANGE_BOUND' && vix !== undefined && vix >= 15.5 && vixChange5d !== undefined && vixChange5d > 0
    || scope === 'range_bound_vix_ge_15_5_vix_not_rising' && regime === 'RANGE_BOUND' && vix !== undefined && vix >= 15.5 && (vixChange5d === undefined || vixChange5d <= 0)
    || scope === 'range_bound_vix_ge_15_75' && regime === 'RANGE_BOUND' && vix !== undefined && vix >= 15.75
    || scope === 'range_bound_vix_ge_16' && regime === 'RANGE_BOUND' && vix !== undefined && vix >= 16
    || scope === 'range_bound_sr02' && regime === 'RANGE_BOUND' && slowSubregime === 'SR02'
    || scope === 'range_bound_vix_lt_15_0' && regime === 'RANGE_BOUND' && vix !== undefined && vix < 15
    || scope === 'range_bound_vix_lt_15_5' && regime === 'RANGE_BOUND' && vix !== undefined && vix < 15.5
    || scope === 'range_bound_vix_lt_16' && regime === 'RANGE_BOUND' && vix !== undefined && vix < 16
    || scope === 'risk_on_weakening' && regime === 'RISK_ON_WEAKENING'
    || scope === 'bull' && regime === 'BULL'
    || scope === 'bull_or_risk_on_weakening' && (regime === 'BULL' || regime === 'RISK_ON_WEAKENING');
  return scoped && floor !== undefined && Number.isFinite(floor) && floor > 0
    && (credit === undefined || !Number.isFinite(credit) || credit < floor);
}

export function resolveCallCreditSpreadRegimeContext(input: { regime: string; mode: string; sma50?: number; sma200?: number }) {
  const rangeBoundBullContext = input.regime === 'RANGE_BOUND' && (input.sma50 ?? 0) > 0 && (input.sma200 ?? 0) > 0 && input.sma50! > input.sma200!;
  const strictRecoveryRegime = input.mode === 'strict_recovery' && input.regime === 'RISK_ON_WEAKENING';
  const spLikeRegime = (input.mode === 'sp_like' || input.mode === 'sp_like_dynamic') && input.regime === 'RISK_ON_WEAKENING';
  return { rangeBoundBullContext, regimeAllowed: input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED' || rangeBoundBullContext || strictRecoveryRegime || spLikeRegime };
}

export function isCallCreditSpreadExtensionBlocked(triggered: boolean, priceExtensionAtr?: number, threshold?: number): boolean {
  return triggered && threshold != null && priceExtensionAtr != null && priceExtensionAtr >= threshold;
}

/** Dynamic SP-like extension gate: widen only in calm, strong-trend states. */
export function resolveCallCreditSpreadExtensionGate(input: {
  mode: string;
  regime: string;
  vix: number;
  explicitGate?: number;
  baseGate?: number;
  dynamicCalmVix?: number;
  dynamicCalmRoc20?: number;
  tqqqRoc20?: number;
  dynamicCalmGate?: number;
}): number | undefined {
  if (input.explicitGate !== undefined) return input.explicitGate;
  if (input.mode === 'sp_like_dynamic') {
    const calmStrongTrend = isDynamicCalmStrongTrend(input);
    return calmStrongTrend ? (input.dynamicCalmGate ?? 3) : input.baseGate;
  }
  return input.mode === 'sp_like' ? input.baseGate : undefined;
}

/**
 * 研究专用：识别高 VXN、QQQ 中期走弱且波动率仍在上行的 rescue 状态。
 * 这是选腿覆盖条件，不改变 CS 入场资格，也不放行 BEAR/CRISIS。
 */
export function isCallCreditSpreadVxnRescue(input: {
  /** CS 当前主波动率；QQQ 独立 CS 回放仍可保持 VIX 原口径。 */
  vix?: number;
  /** 研究条件使用的 QQQ VXN，不替换 CS 主波动率口径。 */
  vxn?: number;
  qqqRoc20?: number;
  vixChange5d?: number;
  minVix?: number;
  vixChange5dMin?: number;
}): boolean {
  return input.vxn !== undefined
    && input.qqqRoc20 !== undefined
    && input.vixChange5d !== undefined
    && input.vxn >= (input.minVix ?? 24)
    && input.qqqRoc20 < 0
    && (input.vixChange5dMin === undefined ? input.vixChange5d > 0 : input.vixChange5d >= input.vixChange5dMin);
}

/** V2.1.1：只在 VXN rescue 状态下应用名义仓位倍率；缺少任一条件时保持 1 倍。 */
export function resolveCallCreditSpreadVxnRescueSizeMultiplier(input: {
  configuredMultiplier?: number;
  vxn?: number;
  qqqRoc20?: number;
  vixChange5d?: number;
  minVxn?: number;
  vixChange5dMin?: number;
}): number {
  if (input.configuredMultiplier === undefined || !Number.isFinite(input.configuredMultiplier) || !isCallCreditSpreadVxnRescue({ ...input, minVix: input.minVxn, vixChange5dMin: input.vixChange5dMin })) return 1;
  return Math.min(2, Math.max(.25, input.configuredMultiplier));
}

/** SP-like 研究臂的状态化短 Call Delta；旧模式仍返回各自原有静态值。 */
export function resolveCallCreditSpreadShortDelta(input: {
  mode: string;
  regime: string;
  vix: number;
  fixedShortDelta?: number;
  spLikeShortDelta?: number;
  dynamicCalmVix?: number;
  dynamicCalmRoc20?: number;
  tqqqRoc20?: number;
  dynamicCalmDelta?: number;
  dynamicCalmDeltaRegimeScope?: 'all' | 'bull' | 'risk_on_extended' | 'bull_or_risk_on_extended';
  dynamicWeakDelta?: number;
  /** 研究专用：VXN rescue 状态覆盖动态弱化短腿；undefined=关闭。 */
  vxnRescueDelta?: number;
  vxn?: number;
  vxnRescueMinVix?: number;
  vxnRescueMaxVix?: number;
  vxnRescueVixChangeMin?: number;
  qqqRoc20?: number;
  vixChange5d?: number;
}): number {
  const fixedShortDelta = input.fixedShortDelta ?? .20;
  const spLikeShortDelta = input.spLikeShortDelta ?? .15;
  if (input.mode === 'sp_like') return spLikeShortDelta;
  if (input.mode !== 'sp_like_dynamic') return fixedShortDelta;
  const calmVix = input.dynamicCalmVix ?? 16;
  const calmDelta = input.dynamicCalmDelta ?? .20;
  const weakDelta = input.dynamicWeakDelta ?? .15;
  if (input.vxnRescueDelta !== undefined
    && (input.vxnRescueMaxVix === undefined || input.vix <= input.vxnRescueMaxVix)
    && isCallCreditSpreadVxnRescue({ ...input, minVix: input.vxnRescueMinVix, vixChange5dMin: input.vxnRescueVixChangeMin })) {
    return Math.min(.45, Math.max(.05, input.vxnRescueDelta));
  }
  const calmStrongTrend = isDynamicCalmStrongTrend(input);
  const scope = input.dynamicCalmDeltaRegimeScope ?? 'all';
  const scopeMatches = scope === 'all'
    || scope === 'bull' && input.regime === 'BULL'
    || scope === 'risk_on_extended' && input.regime === 'RISK_ON_EXTENDED'
    || scope === 'bull_or_risk_on_extended' && (input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED');
  return calmStrongTrend && input.vix <= calmVix && scopeMatches ? calmDelta : weakDelta;
}

/**
 * 慢涨识别：QQQ 仍在上行，但短周期没有明显加速；用于避免把缓慢上行误判成
 * 高压突破。它只服务于 CS 选腿/退出研究，不改变 CS 的开仓资格。
 */
export function isCallCreditSpreadSlowTrend(input: {
  regime: string;
  vix?: number;
  vix3m?: number;
  tqqqRoc20?: number;
  riskOnExtended?: boolean;
  sma20SlopePct?: number;
  qqqRoc5?: number;
  qqqRoc20?: number;
  vixMax?: number;
  slopeMinPct?: number;
  qqqRoc20Min?: number;
  qqqRoc5Max?: number;
  blockExtended?: boolean;
  extendedTqqqRoc20Min?: number;
}): boolean {
  const vix = input.vix;
  const slope = input.sma20SlopePct;
  const qqqRoc5 = input.qqqRoc5;
  const qqqRoc20 = input.qqqRoc20;
  if (input.blockExtended && isCallCreditSpreadExtendedLowVix({
    regime: input.regime,
    riskOnExtended: input.riskOnExtended,
    vix,
    tqqqRoc20: input.tqqqRoc20,
    qqqRoc20,
    vixMax: input.vixMax,
    tqqqRoc20Min: input.extendedTqqqRoc20Min,
  })) return false;
  if (!['BULL', 'RANGE_BOUND'].includes(input.regime)
    || typeof vix !== 'number' || !Number.isFinite(vix) || vix >= (input.vixMax ?? 20)
    || typeof slope !== 'number' || !Number.isFinite(slope) || slope < (input.slopeMinPct ?? 0)
    || typeof qqqRoc5 !== 'number' || !Number.isFinite(qqqRoc5) || qqqRoc5 < -.01
    || typeof qqqRoc20 !== 'number' || !Number.isFinite(qqqRoc20) || qqqRoc20 < (input.qqqRoc20Min ?? 0)
    || qqqRoc5 > (input.qqqRoc5Max ?? .04)) return false;
  return typeof input.vix3m !== 'number' || !Number.isFinite(input.vix3m) || vix <= input.vix3m;
}

/** 慢涨中的快速加速：取消延迟止损，恢复盘中紧急保护。 */
export function isCallCreditSpreadFastAcceleration(input: {
  regime: string;
  sma20SlopePct?: number;
  qqqRoc5?: number;
  qqqRoc20?: number;
  roc5Min?: number;
  slopeMinPct?: number;
}): boolean {
  if (!['BULL', 'RANGE_BOUND'].includes(input.regime)) return false;
  const slope = input.sma20SlopePct;
  const roc5 = input.qqqRoc5;
  const roc20 = input.qqqRoc20;
  if (![slope, roc5, roc20].every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  if (roc20! < 0) return false;
  return roc5! >= (input.roc5Min ?? .04) || slope! >= (input.slopeMinPct ?? .015);
}

/** 低 VIX 扩展牛市：独立于慢涨/快速加速，供尾部 Delta 上限研究使用。 */
export function isCallCreditSpreadExtendedLowVix(input: {
  regime: string;
  riskOnExtended?: boolean;
  vix?: number;
  tqqqRoc20?: number;
  qqqRoc20?: number;
  vixMax?: number;
  tqqqRoc20Min?: number;
}): boolean {
  const vix = input.vix;
  const tqqqRoc20 = input.tqqqRoc20;
  if (typeof vix !== 'number' || !Number.isFinite(vix) || vix >= (input.vixMax ?? 18)) return false;
  if (typeof input.qqqRoc20 === 'number' && Number.isFinite(input.qqqRoc20) && input.qqqRoc20 < 0) return false;
  return input.riskOnExtended === true
    || input.regime === 'RISK_ON_EXTENDED'
    || (input.regime === 'BULL' && typeof tqqqRoc20 === 'number' && Number.isFinite(tqqqRoc20) && tqqqRoc20 >= (input.tqqqRoc20Min ?? .20));
}

/** 用当日已完成 QQQ 数据重建 RISK_ON_EXTENDED，避免退出侧消费上一决策日 regime。 */
export function isCallCreditSpreadRiskOnExtended(input: {
  price: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  priceExtensionAtr?: number;
  vix?: number;
  vixMax?: number;
  rsiMin?: number;
  priceExtensionAtrMin?: number;
}): boolean {
  return [input.price, input.sma20, input.sma50, input.sma200, input.rsi14, input.priceExtensionAtr, input.vix]
    .every((value) => typeof value === 'number' && Number.isFinite(value))
    && input.price > input.sma200!
    && input.price > input.sma20!
    && input.sma50! > input.sma200!
    && input.rsi14! >= (input.rsiMin ?? 65)
    && input.priceExtensionAtr! >= (input.priceExtensionAtrMin ?? 1.5)
    && input.vix! < (input.vixMax ?? 20);
}

/** 斜率动态短腿：快涨取更远 Delta，慢涨取中远 Delta，走弱回到收入优先的近腿。 */
export function resolveCallCreditSpreadSlopeShortDelta(input: {
  mode?: CSSlopeShortLegMode;
  baseDelta: number;
  sma20SlopePct?: number;
  qqqRoc5?: number;
  qqqRoc20?: number;
  slowTrend?: boolean;
  slowTrendOnly?: boolean;
  fastSlopePct?: number;
  fastDelta?: number;
  slowDelta?: number;
  flatDelta?: number;
}): number {
  if (input.mode !== 'slope_v1' && input.mode !== 'slow_trend_v1') return input.baseDelta;
  if (input.mode === 'slow_trend_v1' && input.slowTrendOnly !== false && input.slowTrend !== true) return input.baseDelta;
  const slope = input.sma20SlopePct;
  const roc5 = input.qqqRoc5;
  const roc20 = input.qqqRoc20;
  if (![slope, roc5, roc20].every((value) => typeof value === 'number' && Number.isFinite(value))) return input.baseDelta;
  const fast = Math.min(.45, Math.max(.05, input.fastDelta ?? .10));
  const slow = Math.min(.45, Math.max(fast, input.slowDelta ?? .15));
  const flat = Math.min(.45, Math.max(slow, input.flatDelta ?? .20));
  if (slope! >= (input.fastSlopePct ?? .015) || roc5! >= .02) return fast;
  if (slope! > 0 && roc20! >= 0) return slow;
  return flat;
}

export function shouldTriggerCallCreditSpreadDeltaStop(input: {
  slowTrend: boolean;
  fastAcceleration?: boolean;
  fastAccelerationEmergency?: boolean;
  immediateDeltaStop?: boolean;
  mode?: CSSlowTrendExitMode;
  intradayDelta: number;
  closeDelta: number;
  previousCloseDelta?: number;
  threshold: number;
}): boolean {
  if (input.immediateDeltaStop || (input.fastAccelerationEmergency && input.fastAcceleration) || !input.slowTrend || input.mode === undefined || input.mode === 'off' || input.mode === 'widened') {
    return input.intradayDelta > input.threshold;
  }
  // 慢涨时不让单日盘中高点直接止损；confirm2 需要两个完整收盘都超限。
  return input.closeDelta > input.threshold
    && typeof input.previousCloseDelta === 'number'
    && Number.isFinite(input.previousCloseDelta)
    && input.previousCloseDelta > input.threshold;
}

/** 研究专用：判断短 Call Delta 是否相对前一收盘发生单日加速。 */
export function isCallCreditSpreadDeltaAcceleration(input: {
  previousCloseDelta?: number;
  currentDelta: number;
  threshold?: number;
}): boolean {
  return typeof input.threshold === 'number'
    && Number.isFinite(input.threshold)
    && input.threshold > 0
    && typeof input.previousCloseDelta === 'number'
    && Number.isFinite(input.previousCloseDelta)
    && Number.isFinite(input.currentDelta)
    && input.currentDelta - input.previousCloseDelta + 1e-9 >= input.threshold;
}

function isDynamicCalmStrongTrend(input: { mode: string; regime: string; vix: number; dynamicCalmVix?: number; dynamicCalmRoc20?: number; tqqqRoc20?: number }): boolean {
  if (input.mode !== 'sp_like_dynamic' || input.vix > (input.dynamicCalmVix ?? 16)) return false;
  if (input.regime === 'RISK_ON_EXTENDED') return true;
  return input.regime === 'BULL' && typeof input.tqqqRoc20 === 'number' && input.tqqqRoc20 >= (input.dynamicCalmRoc20 ?? .20);
}

/** 与状态化 Delta 止损共用的 CS 高压定义，供研究选价复用；不改变开仓门。 */
export function isCallCreditSpreadHighPressure(input: {
  regime: string;
  vix?: number;
  tqqqRoc20?: number;
  riskVix?: number;
  calmRoc20?: number;
}): boolean {
  const highPressure = input.regime === 'BEAR' || input.regime === 'CRISIS' || input.regime === 'RISK_ON_WEAKENING' ||
    (typeof input.vix === 'number' && Number.isFinite(input.vix) && input.vix >= (input.riskVix ?? 20));
  const weakBull = input.regime === 'BULL' && typeof input.tqqqRoc20 === 'number' && Number.isFinite(input.tqqqRoc20) &&
    input.tqqqRoc20 < (input.calmRoc20 ?? .20);
  return highPressure || weakBull;
}

/**
 * 研究状态：VIX 还没有进入恐慌区，但 TQQQ 的 realized vol 已经抬高，
 * 且市场处于转弱/过热或低质量 BULL。它用于距离、宽度和风险缩放，
 * 不直接改变 CS 的开仓资格。
 */
export function isCallCreditSpreadPreCrisis(input: {
  regime: string;
  vix?: number;
  tqqqRealisedVol20d?: number;
  tqqqRoc20?: number;
  vixMax?: number;
  tqqqRealisedVol20dMin?: number;
  tqqqRoc20Max?: number;
}): boolean {
  const quietVix = typeof input.vix === 'number' && Number.isFinite(input.vix) && input.vix < (input.vixMax ?? 20);
  const elevatedRealisedVol = typeof input.tqqqRealisedVol20d === 'number'
    && Number.isFinite(input.tqqqRealisedVol20d)
    && input.tqqqRealisedVol20d >= (input.tqqqRealisedVol20dMin ?? .42);
  if (!quietVix || !elevatedRealisedVol) return false;
  if (input.regime === 'RISK_ON_WEAKENING' || input.regime === 'RISK_ON_EXTENDED') return true;
  return input.regime === 'BULL'
    && typeof input.tqqqRoc20 === 'number'
    && Number.isFinite(input.tqqqRoc20)
    && input.tqqqRoc20 < (input.tqqqRoc20Max ?? .08);
}

/** Research-only Delta-stop rescue decision; falling-only intentionally has no momentum confirmation. */
export function shouldRescueCallCreditSpreadDeltaStop(input: {
  mode?: string;
  vxnChange5d?: number;
  tqqqRoc20?: number;
  daysLeft: number;
  minDaysLeft?: number;
}): boolean {
  const mode = input.mode ?? 'off';
  if (mode === 'off' || mode === undefined || input.daysLeft < (input.minDaysLeft ?? 14)) return false;
  const vxnChange5d = input.vxnChange5d ?? 0;
  const tqqqRoc20 = input.tqqqRoc20 ?? 0;
  if (mode === 'vix_falling_only') return vxnChange5d < 0;
  if (mode === 'vix_nonrising_weak') return vxnChange5d <= 0 && tqqqRoc20 < 0;
  if (mode === 'vix_falling_nonpositive') return vxnChange5d < 0 && tqqqRoc20 <= 0;
  return mode === 'vix_falling_weak' && vxnChange5d < 0 && tqqqRoc20 < 0;
}

/** Research-only notional scale keyed only by the existing regime; portfolio sizing remains subject to the shared option-risk cap. */
export function resolveCallCreditSpreadRegimeRiskMultiplier(input: {
  regime: string;
  multipliers?: Partial<Record<MarketRegime, number>>;
}): number {
  const configured = input.multipliers?.[input.regime as MarketRegime];
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return 1;
  return Math.max(0, configured);
}

/** Research-only primary-CS notional tilt above a broad VIX floor; unset inputs preserve exact parity. */
export function resolveCallCreditSpreadVixRiskMultiplier(input: {
  vix?: number | null;
  minVix?: number;
  multiplier?: number;
}): number {
  if (typeof input.vix !== 'number' || !Number.isFinite(input.vix)) return 1;
  if (typeof input.minVix !== 'number' || !Number.isFinite(input.minVix)) return 1;
  if (input.vix < input.minVix) return 1;
  if (typeof input.multiplier !== 'number' || !Number.isFinite(input.multiplier)) return 1;
  return Math.min(2, Math.max(0, input.multiplier));
}

export function isCallCreditSpreadResearchEntryBlocked(input: {
  gate?: CSResearchEntryGate;
  posterior?: number;
  weakPersistenceDays?: number;
  vixChange5d?: number;
  regime?: string;
  slowSubregime?: 'SR01' | 'SR02' | 'UNKNOWN';
}): boolean {
  const gate = input.gate ?? 'off';
  if (gate === 'off') return false;
  const lowPosterior = typeof input.posterior === 'number' && Number.isFinite(input.posterior) && input.posterior < .70;
  if (gate === 'posterior_below_70') return lowPosterior;
  if (gate === 'posterior_below_70_and_weak_persistence_5') return lowPosterior && (input.weakPersistenceDays ?? 0) >= 5;
  if (gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising') return lowPosterior || ((input.weakPersistenceDays ?? 0) >= 5 && (input.vixChange5d ?? 0) > 0);
  if (gate === 'posterior_below_70_or_weak_persistence_7') return lowPosterior || (input.weakPersistenceDays ?? 0) >= 7;
  if (gate === 'posterior_below_70_or_weak_persistence_5_posterior_below_80') return lowPosterior || ((input.weakPersistenceDays ?? 0) >= 5 && typeof input.posterior === 'number' && Number.isFinite(input.posterior) && input.posterior < .80);
  if (gate === 'posterior_below_70_or_weak_persistence_5_exclude_range_bound') return lowPosterior || ((input.weakPersistenceDays ?? 0) >= 5 && input.regime !== 'RANGE_BOUND');
  if (gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening') return lowPosterior || ((input.weakPersistenceDays ?? 0) >= 5 && ((input.vixChange5d ?? 0) > 0 || (input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02')));
  if (gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_and_bull_sr02') return lowPosterior || (input.regime === 'BULL' && input.slowSubregime === 'SR02' && (input.vixChange5d ?? 0) <= 0) || ((input.weakPersistenceDays ?? 0) >= 5 && ((input.vixChange5d ?? 0) > 0 || (input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02')));
  const posterior = typeof input.posterior === 'number' && Number.isFinite(input.posterior) ? input.posterior : undefined;
  const highPosteriorThreshold = gate.endsWith('_90') ? .90 : .80;
  const highPosterior = posterior !== undefined && posterior >= highPosteriorThreshold;
  const bullSr02 = input.regime === 'BULL' && input.slowSubregime === 'SR02';
  const sr02RiskOn = input.slowSubregime === 'SR02' && (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING');
  if (gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_bull_sr02_80' || gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_bull_sr02_90') return lowPosterior || (bullSr02 && highPosterior) || ((input.weakPersistenceDays ?? 0) >= 5 && ((input.vixChange5d ?? 0) > 0 || (input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02')));
  if (gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_sr02_riskon_80' || gate === 'posterior_below_70_or_weak_persistence_5_vxn_rising_preserve_sr02_weakening_high_posterior_sr02_riskon_90') return lowPosterior || (sr02RiskOn && highPosterior) || ((input.weakPersistenceDays ?? 0) >= 5 && ((input.vixChange5d ?? 0) > 0 || (input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR02')));
  return lowPosterior || (input.weakPersistenceDays ?? 0) >= 5;
}

/** 研究专用：只在入场日过滤 VIX/ADX 尾部画像，默认关闭且不影响持仓退出。 */
export function isCallCreditSpreadTailEntryBlocked(input: {
  gate?: CSTailEntryGate;
  vix?: number;
  adx14?: number;
  regime?: string;
  slowSubregime?: string;
  tqqqRealisedVol20d?: number;
  qqqRoc5?: number;
  qqqRoc20?: number;
  priceExtensionAtr?: number;
}): boolean {
  if (input.gate === 'off' || input.gate === undefined) return false;
  if (input.gate === 'candidate4_six_factor') {
    const values = [input.vix, input.adx14, input.tqqqRealisedVol20d, input.qqqRoc5, input.qqqRoc20, input.priceExtensionAtr];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value)) || typeof input.regime !== 'string' || typeof input.slowSubregime !== 'string') return true;
    const highVix = input.vix! >= 19.5;
    const highAdx = input.adx14! >= 40;
    const borderVixAdx = input.vix! >= 19 && input.vix! < 19.5 && input.adx14! >= 16 && input.qqqRoc20! <= .03;
    const bullSr01 = input.regime === 'BULL' && input.slowSubregime === 'SR01';
    const bullishVolMomentumConflict = bullSr01 && input.tqqqRealisedVol20d! >= .55 && input.qqqRoc5! >= .04;
    const weakeningMomentumConflict = bullSr01 && input.vix! >= 18 && input.adx14! <= 25 && input.qqqRoc20! <= .05;
    const pullbackConflict = input.priceExtensionAtr! <= -2 && input.qqqRoc5! <= -.02;
    return highVix || highAdx || borderVixAdx || bullishVolMomentumConflict || weakeningMomentumConflict || pullbackConflict;
  }
  if (![input.vix, input.adx14].every((value) => typeof value === 'number' && Number.isFinite(value))) return true;
  const baselineBlocked = input.vix! >= 19 || input.adx14! >= 35;
    if (input.gate === 'vix19_or_adx35') return baselineBlocked;
    if (input.gate === 'candidate4_six_factor_bull_lowvix_weak_extension') {
      const bullLowVixWeakExtension = input.regime === 'BULL' && input.vix! < 15 && input.priceExtensionAtr! < 1;
      return baselineBlocked || bullLowVixWeakExtension;
    }
  if (typeof input.regime !== 'string' || typeof input.slowSubregime !== 'string') return true;
  if (![input.tqqqRealisedVol20d, input.qqqRoc5, input.qqqRoc20].every((value) => typeof value === 'number' && Number.isFinite(value))) return true;
  const bullSr01 = input.regime === 'BULL' && input.slowSubregime === 'SR01';
  const bullishVolMomentumConflict = bullSr01 && input.tqqqRealisedVol20d! >= .55 && input.qqqRoc5! >= .04;
  const weakeningMomentumConflict = bullSr01 && input.vix! >= 18 && input.adx14! <= 25 && input.qqqRoc20! <= .05;
  const pullbackConflict = input.gate === 'vix19_or_adx35_or_bull_conflict_or_pullback'
    && typeof input.priceExtensionAtr === 'number'
    && Number.isFinite(input.priceExtensionAtr)
    && input.priceExtensionAtr <= -2
    && input.qqqRoc5! <= -.02;
  return baselineBlocked || bullishVolMomentumConflict || weakeningMomentumConflict || pullbackConflict;
}

/** CCS v2.3 候选9：MDD-A-S 仅在 RANGE_BOUND/SR01 且回撤、VIX、ROC20 同时满足时硬阻断。 */
export function isCallCreditSpreadCandidate9MddBlocked(input: {
  gate?: CSCandidate9MddEntryGate;
  regime?: string;
  slowSubregime?: string;
  drawdownFromRecentHighPct?: number;
  vix?: number;
  roc20?: number;
}): boolean {
  if (input.gate === undefined || input.gate === 'off') return false;
  if (typeof input.regime !== 'string' || typeof input.slowSubregime !== 'string') return true;
  const values = [input.drawdownFromRecentHighPct, input.vix, input.roc20];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return true;
  return input.regime === 'RANGE_BOUND'
    && input.slowSubregime === 'SR01'
    && input.drawdownFromRecentHighPct! >= .03
    && input.vix! <= 16
    && input.roc20! <= .02;
}

/** CCS v2.3 候选9：只对非 MDD 阻断日释放 Extension≥0、VIX 5日上升≥5%、SR01。 */
export function isCallCreditSpreadCandidate9CoreFusionRelease(input: {
  mode?: CSCandidate9CoreFusionReleaseMode;
  priceExtensionAtr?: number;
  vixChange5d?: number;
  slowSubregime?: string;
}): boolean {
  if (input.mode !== 'extension_nonnegative_vix_rising_sr01') return false;
  return input.slowSubregime === 'SR01'
    && typeof input.priceExtensionAtr === 'number'
    && Number.isFinite(input.priceExtensionAtr)
    && input.priceExtensionAtr >= 0
    && typeof input.vixChange5d === 'number'
    && Number.isFinite(input.vixChange5d)
    && input.vixChange5d >= .05;
}

/**
 * CCS v2.4：Validated Safe-FK Union + Slow-VIX Releases。
 *
 * 这些条件来自逐层误杀归因后的交互验证。函数只解除 SR/tail/extension
 * 研究闸，不旁路上游、事件 cap、MDD-A-S、持仓互斥、合约可构建或退出规则。
 * Slow-VIX 变化使用 VIX 5 个交易日的绝对点差；缺失数据按 fail-closed 处理。
 */
export function isCallCreditSpreadValidatedSafeRelease(input: {
  mode?: CSValidatedSafeReleaseMode;
  regime?: string;
  slowSubregime?: string;
  slowSubregimePosterior?: number;
  vix?: number;
  adx14?: number;
  tqqqRealisedVol20d?: number;
  qqqRoc5?: number;
  qqqRoc20?: number;
  priceVsSma200Pct?: number;
  priceExtensionAtr?: number;
  drawdownFromRecentHighPct?: number;
  weakPersistenceDays?: number;
  vixChange5d?: number;
  vixChange5dPoints?: number;
  vixPointThreshold?: number;
  tailBlocked?: boolean;
  researchBlocked?: boolean;
  extensionBlocked?: boolean;
  mddBlocked?: boolean;
}): boolean {
  if (input.mode === undefined || input.mode === 'off') return false;
  if (input.mddBlocked === true || !(input.tailBlocked || input.researchBlocked || input.extensionBlocked)) return false;

  const values = [
    input.vix, input.adx14, input.tqqqRealisedVol20d, input.qqqRoc5, input.qqqRoc20,
    input.priceVsSma200Pct, input.priceExtensionAtr, input.drawdownFromRecentHighPct,
  ];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return false;

  const vix = input.vix!;
  const adx = input.adx14!;
  const rv = input.tqqqRealisedVol20d!;
  const roc5 = input.qqqRoc5!;
  const roc20 = input.qqqRoc20!;
  const price = input.priceVsSma200Pct!;
  const extension = input.priceExtensionAtr!;
  const drawdown = input.drawdownFromRecentHighPct!;
  const posterior = input.slowSubregimePosterior;
  const vixPoints = input.vixChange5dPoints;
  const slowVixKnown = typeof vixPoints === 'number' && Number.isFinite(vixPoints);
  const slowVixThreshold = typeof input.vixPointThreshold === 'number' && Number.isFinite(input.vixPointThreshold)
    ? input.vixPointThreshold : 1.5;
  const persistence = input.weakPersistenceDays;

  // Validated Safe-FK Union: the 20 zero-added-loss pockets consolidated by state family.
  const safeBullSr01 = input.regime === 'BULL' && input.slowSubregime === 'SR01'
    && rv >= .55 && roc5 >= .04 && adx < 20;
  const safeWeakSr01 = input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR01'
    && adx >= 20 && adx < 26 && rv < .65
    && ((vix >= 19.5 && extension > -1.5 && drawdown < .05)
      || (vix >= 19.5 && extension > -1)
      || (vix >= 19 && vix < 19.5 && extension > -1 && drawdown < .05));
  const safeRangeSr01 = input.regime === 'RANGE_BOUND' && input.slowSubregime === 'SR01'
    && ((vix >= 15 && adx < 20 && roc20 < -.03 && rv < .60 && drawdown < .06)
      || (vix >= 19 && adx < 14 && rv < .90 && extension > -.5)
      || (typeof posterior === 'number' && posterior < .10 && vix >= 18 && adx >= 17 && adx < 20 && roc5 > 0 && rv < .80 && drawdown < .03));
  const safeExtendedSr01 = input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR01'
    && ((vix < 16.5 && adx >= 20 && adx < 32 && rv < .65 && roc20 > 0 && extension < 3.7 && drawdown < .02)
      || (vix < 15.5 && adx >= 35 && adx < 38 && rv < .55 && roc20 > 0 && extension >= 2 && extension < 2.6 && drawdown < .01)
      || (vix >= 16.5 && vix < 17.1 && adx < 20 && rv < .65 && roc20 > 0 && extension >= 2.7 && extension < 3.2 && drawdown < .01));
  const safeExtendedSr02 = input.regime === 'RISK_ON_EXTENDED' && input.slowSubregime === 'SR02'
    && ((vix < 17 && adx >= 20 && adx < 35 && rv < .70 && roc20 > 0 && extension >= 4)
      || (vix < 16 && adx >= 20 && adx < 35 && rv < .70 && roc20 > 0 && extension >= 3.3 && extension < 4)
      || (vix >= 17 && vix < 19 && adx >= 40 && rv < .50 && roc20 > 0 && extension >= 4.5 && drawdown < .01)
      || (vix >= 20 && adx < 20 && rv < .55 && roc20 > 0 && extension >= 3 && drawdown < .005));
  const safeBullSr02 = input.regime === 'BULL' && input.slowSubregime === 'SR02'
    && typeof posterior === 'number' && posterior >= .90
    && ((vix >= 17 && adx >= 15 && price >= .12 && extension < 2 && rv < .80 && roc20 > 0
      && typeof input.vixChange5d === 'number' && input.vixChange5d <= 0)
      || (vix >= 16 && adx >= 15 && price >= .12 && extension < 2 && rv < .80
        && typeof persistence === 'number' && persistence < 5
        && typeof input.vixChange5d === 'number' && input.vixChange5d <= 0)
      || (vix >= 17 && adx >= 12 && price >= .12 && extension < 2 && rv < .80
        && typeof persistence === 'number' && persistence < 5
        && typeof input.vixChange5d === 'number' && input.vixChange5d <= 0)
      || (vix >= 17 && vix < 19.5 && adx >= 15 && price >= .05 && extension < 2 && rv < .80 && roc20 > 0
        && typeof input.vixChange5d === 'number' && input.vixChange5d <= 0));
  const safeBullSr01FollowThrough = input.regime === 'BULL' && input.slowSubregime === 'SR01'
    && typeof posterior === 'number' && posterior >= .99 && vix >= 18 && adx >= 20 && adx < 35
    && rv < .70 && roc20 > 0 && extension < 1.5 && drawdown < .05
    && typeof input.vixChange5d === 'number' && input.vixChange5d > 0;
  // BULL 高 ADX 与 candidate4 的高方向性尾部画像重叠，保留硬保护，避免释放改变后续链。
  if (input.regime === 'BULL' && adx >= 40) return false;
  const safeFkUnion = safeBullSr01 || safeWeakSr01 || safeRangeSr01 || safeExtendedSr01 || safeExtendedSr02 || safeBullSr02 || safeBullSr01FollowThrough;
  if (input.mode === 'validated_safe_fk_union') return safeFkUnion;

  // Slow-VIX additions: two pockets that remained stable when evaluated together.
  const slowBullSr02 = input.regime === 'BULL' && input.slowSubregime === 'SR02'
    && typeof posterior === 'number' && posterior >= .90 && vix < 15 && adx < 20
    && rv < .45 && roc20 > 0 && extension < 1 && drawdown < .02
    && slowVixKnown && vixPoints! <= slowVixThreshold;
  const slowWeakSr01 = input.regime === 'RISK_ON_WEAKENING' && input.slowSubregime === 'SR01'
    && vix >= 19.5 && adx >= 20 && adx < 26 && rv < .65 && extension > -1.5
    && drawdown < .06 && slowVixKnown && vixPoints! <= slowVixThreshold;
  return safeFkUnion || slowBullSr02 || slowWeakSr01;
}

/**
 * CCS 研究门的简化释放：只释放 Balanced/L1AB，且排除 V11 深度转弱。
 * 该函数只描述状态资格；是否确实释放由调用方先确认原研究门已阻断。
 */
export function isCallCreditSpreadBalancedL1abV11Release(input: {
  mode?: CSResearchEntryReleaseMode;
  regime?: string;
  adx14?: number;
  priceVsSma200Pct?: number;
  tqqqRealisedVol20d?: number;
  roc20?: number;
  drawdownFromRecentHighPct?: number;
  weakeningSignalCount?: number;
}): boolean {
  if (input.mode !== 'balanced_l1ab_without_v11') return false;
  const values = [
    input.adx14,
    input.priceVsSma200Pct,
    input.tqqqRealisedVol20d,
    input.roc20,
    input.drawdownFromRecentHighPct,
    input.weakeningSignalCount,
  ];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return false;

  const adx14 = input.adx14!;
  const priceVsSma200Pct = input.priceVsSma200Pct!;
  const tqqqRealisedVol20d = input.tqqqRealisedVol20d!;
  const roc20 = input.roc20!;
  const balancedWeak = roc20 < 0
    && input.weakeningSignalCount! >= 3
    && tqqqRealisedVol20d >= .50
    && (adx14 < 12 || (priceVsSma200Pct < .05 && roc20 <= -.01));
  const l1ab = tqqqRealisedVol20d >= .50
    && ((adx14 < 12 && priceVsSma200Pct >= .10) || (adx14 < 15 && priceVsSma200Pct >= .18));
  const v11 = input.regime === 'RISK_ON_WEAKENING'
    && input.drawdownFromRecentHighPct! >= .05
    && roc20 < 0;
  return (balancedWeak || l1ab) && !v11;
}

/** 将预危机事件上限限定到指定慢子状态/宏观状态组合；默认 all 保持兼容。 */
export function isCallCreditSpreadEventRiskScoped(input: {
  preCrisisActive: boolean;
  regime: string;
  slowSubregime?: string;
  scope?: CSPreCrisisEventScope;
  /** 研究专用：设为 false 时不要求预危机状态，用于副层 v2 的独立触发。默认 true（原行为）。 */
  requirePreCrisis?: boolean;
}): boolean {
  if ((input.requirePreCrisis ?? true) && !input.preCrisisActive) return false;
  const scope = input.scope ?? 'all';
  const sr01Weakening = input.slowSubregime === 'SR01' && input.regime === 'RISK_ON_WEAKENING';
  const sr02Bull = input.slowSubregime === 'SR02' && input.regime === 'BULL';
  if (scope === 'all') return true;
  if (scope === 'sr01_weakening') return sr01Weakening;
  if (scope === 'sr02_bull') return sr02Bull;
  if (scope === 'all_exclude_bull_sr01_weakening_sr02') {
    // 研究专用：10年归因发现 BULL+SR01 和 RISK_ON_WEAKENING+SR02 是 scoped_union_cap1
    // 相对 full_pre_crisis_cap1 多出来的两个净亏损子状态；这个 scope 把它们排除在
    // cap1 共享窗口计数器之外（不占限流名额，行为等价于不设上限），其余状态仍然
    // 全部计入共享窗口，与 'all' 的限流逻辑一致。
    const bullSr01 = input.slowSubregime === 'SR01' && input.regime === 'BULL';
    const weakeningSr02 = input.slowSubregime === 'SR02' && input.regime === 'RISK_ON_WEAKENING';
    return !bullSr01 && !weakeningSr02;
  }
  return sr01Weakening || sr02Bull;
}

/** CS 研究 DTE：复用 PCS dynamic_dte_v1 的压力分层，但以 CS 的 21DTE 为最短档。 */
export function resolveCallCreditSpreadTargetDte(input: {
  mode?: CSSurvivalSelectionDteMode;
  baseDte?: number;
  regime: string;
  vix?: number;
  vix3m?: number;
  annualizedRv20?: number;
}): number | undefined {
  const baseDte = input.baseDte ?? 21;
  if (input.mode !== 'dynamic_dte_v1') return baseDte;
  if (![input.vix, input.vix3m, input.annualizedRv20].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return undefined;
  const stressed = input.regime === 'CRISIS'
    || input.vix! >= 22
    || input.vix! / input.vix3m! >= .95
    || input.annualizedRv20! >= .28;
  if (stressed) return 21;
  if (input.vix! >= 18 || input.annualizedRv20! >= .20) return 28;
  return 35;
}

/** 状态化 Delta 止损研究臂：平静强趋势给盈利路径更多空间，压力/走弱时提前收缩尾部。 */
export function resolveCallCreditSpreadDeltaStopThreshold(input: {
  mode?: CSDeltaStopMode;
  regime: string;
  vix?: number;
  vix3m?: number;
  tqqqRoc20?: number;
  riskOnExtended?: boolean;
  qqqRoc5?: number;
  qqqRoc20?: number;
  sma20SlopePct?: number;
  fixedThreshold?: number;
  wideThreshold?: number;
  wideRegime?: string;
  wideTqqqRoc20Min?: number;
  calmVix?: number;
  riskVix?: number;
  calmRoc20?: number;
  calmThreshold?: number;
  riskThreshold?: number;
  riskGuardMode?: 'off' | 'vix_rising';
  riskGuardVixChange5d?: number;
  riskGuardThreshold?: number;
  slowTrendExitMode?: CSSlowTrendExitMode;
  slowTrendVixMax?: number;
  slowTrendSlopeMinPct?: number;
  slowTrendQqqRoc20Min?: number;
  slowTrendQqqRoc5Max?: number;
  slowTrendBlockExtended?: boolean;
  slowTrendExtendedTqqqRoc20Min?: number;
  slowTrendThreshold?: number;
  slowTrendHysteresis?: number;
  extendedLowVixDeltaCap?: number;
  extendedLowVixVixMax?: number;
  extendedLowVixTqqqRoc20Min?: number;
  fastAcceleration?: boolean;
  fastAccelerationEmergency?: boolean;
  fastAccelerationThreshold?: number;
}): number {
  const wideState = input.regime === input.wideRegime
    && input.wideThreshold !== undefined
    && (input.wideTqqqRoc20Min === undefined || (input.tqqqRoc20 ?? Number.NEGATIVE_INFINITY) >= input.wideTqqqRoc20Min);
  const fixedThreshold: number = wideState
    ? input.wideThreshold!
    : input.fixedThreshold ?? .35;
  if (input.mode !== 'stateful') return fixedThreshold;

  const vix = input.vix;
  const calmRoc20 = input.calmRoc20 ?? .20;
  const highPressure = isCallCreditSpreadHighPressure({ regime: input.regime, vix, tqqqRoc20: input.tqqqRoc20, riskVix: input.riskVix, calmRoc20 });
  const riskGuardActive = input.riskGuardMode === 'vix_rising'
    && typeof input.riskGuardVixChange5d === 'number'
    && Number.isFinite(input.riskGuardVixChange5d)
    && input.riskGuardVixChange5d > 0;
  const effectiveRiskThreshold = riskGuardActive
    ? (input.riskGuardThreshold ?? input.riskThreshold ?? .30)
    : (input.riskThreshold ?? .30);
  const slowTrend = isCallCreditSpreadSlowTrend({
    regime: input.regime,
    vix,
    vix3m: input.vix3m,
    tqqqRoc20: input.tqqqRoc20,
    riskOnExtended: input.riskOnExtended,
    sma20SlopePct: input.sma20SlopePct,
    qqqRoc5: input.qqqRoc5,
    qqqRoc20: input.qqqRoc20,
    vixMax: input.slowTrendVixMax,
    slopeMinPct: input.slowTrendSlopeMinPct,
    qqqRoc20Min: input.slowTrendQqqRoc20Min,
    qqqRoc5Max: input.slowTrendQqqRoc5Max,
    blockExtended: input.slowTrendBlockExtended,
    extendedTqqqRoc20Min: input.slowTrendExtendedTqqqRoc20Min,
  });
  const extendedLowVixCapActive = input.extendedLowVixDeltaCap !== undefined
    && isCallCreditSpreadExtendedLowVix({
      regime: input.regime,
      riskOnExtended: input.riskOnExtended,
      vix,
      tqqqRoc20: input.tqqqRoc20,
      qqqRoc20: input.qqqRoc20,
      vixMax: input.extendedLowVixVixMax,
      tqqqRoc20Min: input.extendedLowVixTqqqRoc20Min,
    });
  if (extendedLowVixCapActive) return Math.min(.60, Math.max(.05, input.extendedLowVixDeltaCap!));
  if (input.fastAccelerationEmergency && input.fastAcceleration && input.slowTrendExitMode !== undefined && input.slowTrendExitMode !== 'off') {
    return input.fastAccelerationThreshold ?? effectiveRiskThreshold;
  }
  if (slowTrend && input.slowTrendExitMode !== undefined && input.slowTrendExitMode !== 'off') {
    const baseThreshold = highPressure ? effectiveRiskThreshold : fixedThreshold;
    const widened = Math.max(baseThreshold, input.slowTrendThreshold ?? .40);
    return input.slowTrendExitMode === 'confirm2_hysteresis'
      ? Math.min(.60, widened + (input.slowTrendHysteresis ?? .03))
      : input.slowTrendExitMode === 'widened'
        ? widened
        : baseThreshold;
  }
  const calmVol = typeof vix === 'number' && Number.isFinite(vix) && vix <= (input.calmVix ?? 18);
  const strongTrend = input.regime === 'RISK_ON_EXTENDED' ||
    (input.regime === 'BULL' && typeof input.tqqqRoc20 === 'number' && Number.isFinite(input.tqqqRoc20) && input.tqqqRoc20 >= calmRoc20);
  if (calmVol && strongTrend) return input.calmThreshold ?? .40;
  // Stateful B: weak-quality BULL is treated as pressure even if VIX is still low.
  if (highPressure || (input.regime === 'BULL' && typeof input.tqqqRoc20 === 'number' && input.tqqqRoc20 < calmRoc20)) {
    return effectiveRiskThreshold;
  }
  return fixedThreshold;
}

/** 研究专用：按 CS 开仓日计算自然日持仓长度，窗口外严格不覆盖 risk 阈值。 */
export function resolveCallCreditSpreadDaysHeldRiskThreshold(input: {
  mode?: 'off' | 'risk_threshold';
  openDate?: string;
  asOfDate: string;
  minDays?: number;
  maxDays?: number;
  riskThreshold?: number;
  regime?: string;
  regimeScope?: 'all' | 'bull' | 'risk_on_weakening' | 'risk_on_extended' | 'bull_or_risk_on_weakening';
}): number | undefined {
  if (input.mode !== 'risk_threshold' || !input.openDate || typeof input.riskThreshold !== 'number' || !Number.isFinite(input.riskThreshold)) return undefined;
  const scope = input.regimeScope ?? 'all';
  const regimeAllowed = scope === 'all'
    || scope === 'bull' && input.regime === 'BULL'
    || scope === 'risk_on_weakening' && input.regime === 'RISK_ON_WEAKENING'
    || scope === 'risk_on_extended' && input.regime === 'RISK_ON_EXTENDED'
    || scope === 'bull_or_risk_on_weakening' && (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING');
  if (!regimeAllowed) return undefined;
  const openTime = Date.parse(`${input.openDate}T00:00:00Z`);
  const asOfTime = Date.parse(`${input.asOfDate}T00:00:00Z`);
  if (!Number.isFinite(openTime) || !Number.isFinite(asOfTime) || asOfTime < openTime) return undefined;
  const daysHeld = Math.floor((asOfTime - openTime) / 86_400_000);
  const minDays = input.minDays ?? 7;
  const maxDays = input.maxDays ?? 14;
  return daysHeld >= minDays && daysHeld <= maxDays ? input.riskThreshold : undefined;
}

/** CS 的唯一候选门；Collar 互斥和 strict-recovery 例外都在这里。 */
export function evaluateCallCreditSpreadCandidate(input: CallCreditSpreadCandidateInput): boolean {
  if (!input.enabled || input.pendingCollarHasShortCall || input.hasOpenCollarShortCall || input.hasOpenCallSpread || !input.regimeAllowed || input.breachBlocked) return false;
  if (input.mode === 'sp_like' || input.mode === 'sp_like_dynamic') {
    const vixLow = input.vixLowFloor ?? CS_SP_LIKE_VIX_LOW;
    const vixHigh = input.vixHighThreshold ?? CS_SP_LIKE_VIX_HIGH_DEFAULT;
    const termStructureKnown = input.mode !== 'sp_like_dynamic' || input.requireTermStructure === false || typeof input.backwardation === 'boolean';
    return input.vix >= vixLow && input.vix <= vixHigh && termStructureKnown && input.backwardation !== true;
  }
  if (input.rangeBoundBullContext) return input.vix < 20;
  if (input.mode === 'reactive' || (input.mode === 'strict_recovery' && input.regime !== 'RISK_ON_WEAKENING')) {
    return input.vix < input.vixLowThreshold && input.tqqqRoc20 > input.overboughtRoc20;
  }
  if (input.mode === 'strict_recovery') {
    return input.regime === 'RISK_ON_WEAKENING' && input.vix < input.vixLowThreshold &&
      (input.hasOnlyPutSpreadProtection || input.pendingPutSpreadProtection) &&
      input.qqqRoc5 > input.recoveryRoc5 && input.tqqqRoc20 > input.recoveryRoc20;
  }
  if (input.mode === 'overbought') return input.tqqqRoc20 > input.overboughtRoc20;
  if (input.mode === 'bull') return input.vix < 20;
  return input.mode === 'extreme' && input.regime === 'RISK_ON_EXTENDED';
}

export type CallCreditSpreadPosition = OverlayPosition & {
  /** 开仓日；研究退出层据此计算自然日 daysHeld。 */
  openDate?: string;
  shortStrike: number;
  longStrike: number;
  width: number;
  creditReceived: number;
  /** 双层 CS 中标记独立副层，避免副层回放污染主层 breach 状态。 */
  route?: 'primary' | 'secondary_budget';
  /** 新高胜率覆盖层的普通/预危机 tier。 */
  tier?: CSSecondaryCoverageTier;
  /** 开仓时锁定的覆盖层平仓参数；主层保持全局 stateful 规则。 */
  exitProfile?: CSSecondaryCoverageExitProfile;
};
export type CallSpreadKind = 'CS' | 'BEAR_CS';

/** Resolve one position-wide loss cap; percentage mode scales with the spread's defined maximum risk. */
export function resolveCallCreditSpreadMaxLossDollars(input: {
  absoluteCap?: number;
  navPct?: number;
  nav?: number;
  riskPct?: number;
  width: number;
  quantity: number;
  creditReceived: number;
}): number | undefined {
  if (typeof input.navPct === 'number' && Number.isFinite(input.navPct) && input.navPct > 0 && input.navPct <= 1
    && typeof input.nav === 'number' && Number.isFinite(input.nav) && input.nav > 0) {
    return input.nav * input.navPct;
  }
  if (typeof input.riskPct === 'number' && Number.isFinite(input.riskPct) && input.riskPct > 0 && input.riskPct <= 1
    && Number.isFinite(input.width) && input.width > 0
    && Number.isFinite(input.quantity) && input.quantity > 0
    && Number.isFinite(input.creditReceived)) {
    const definedMaxRisk = Math.max(0, input.width * 100 * input.quantity - input.creditReceived);
    return definedMaxRisk * input.riskPct;
  }
  return typeof input.absoluteCap === 'number' && Number.isFinite(input.absoluteCap) && input.absoluteCap > 0
    ? input.absoluteCap
    : undefined;
}

export function callCreditSpreadTradeMeta(kind: CallSpreadKind, shortStrike: number, longStrike: number, underlying = 'QQQ') {
  return kind === 'BEAR_CS'
    ? { label: 'Bear Call Spread', symbol: `${underlying} Bear Call Spread @${shortStrike}/${longStrike}`, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD }
    : { label: 'Call Spread', symbol: `${underlying} Call Credit Spread @${shortStrike}/${longStrike}`, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD };
}

export function buildCallCreditSpreadCloseTrade(input: {
  position: CallCreditSpreadPosition;
  kind: CallSpreadKind;
  signalDate: string;
  date: string;
  fillPrice: number;
  cashImpact: number;
  rationale: string;
  pnl: number;
  outcomeReason: string;
  marketContext?: MarketEnvironmentSnapshot;
}): TradeEntry {
  const meta = callCreditSpreadTradeMeta(input.kind, input.position.shortStrike, input.position.longStrike, input.position.underlying);
  return {
    signalDate: input.signalDate, date: input.date, expiry: input.position.expiry, symbol: meta.symbol, side: 'BUY', quantity: input.position.quantity,
    fillPrice: input.fillPrice, cashImpact: input.cashImpact, rationale: input.rationale, action: 'CLOSE', strategyTag: meta.strategyTag,
    pnl: input.pnl, executionReason: '提前平仓', outcomeReason: input.outcomeReason,
    outcomeReasonKey: optionOutcomeReasonKey(input.outcomeReason, false), marketContext: input.marketContext,
  };
}

export type CallCreditSpreadOpen = OverlayPosition & { shortStrike: number; longStrike: number; credit?: number; maxLoss: number; riskBudgetUsed?: number };

export function settleCallCreditSpread(cs: CallCreditSpreadPosition, qqqClose: number, label: string): OverlaySettlementResult {
  const underlying = cs.underlying ?? 'QQQ';
  const loss = qqqClose > cs.shortStrike ? Math.min(qqqClose - cs.shortStrike, cs.width) * 100 * cs.quantity : 0;
  const settled = settleOptionPosition({ openingCashImpact: cs.creditReceived, legs: [
    { symbol: underlying, type: 'call', side: 'short', strike: cs.shortStrike, expiry: '', quantity: cs.quantity },
    { symbol: underlying, type: 'call', side: 'long', strike: cs.longStrike, expiry: '', quantity: cs.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: '', prices: { [underlying]: qqqClose }, vix: 20 }));
  const { cashImpact, pnl } = settled;
  const note = loss === 0
    ? `${label} 到期无损（${underlying} ${qqqClose.toFixed(2)} < @${cs.shortStrike}），到期现金流 $0，净 +$${pnl.toFixed(0)}`
    : `${label} 结算：短腿 @${cs.shortStrike} 被突破（${underlying} ${qqqClose.toFixed(2)}），亏损 -$${loss.toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`;
  return { cashImpact, pnl, note };
}

export function closeCallCreditSpreadAtMark(cs: CallCreditSpreadPosition, today: string, qqqClose: number, vix: number, reason: string, pricing: OptionPricing, vix3m?: number, label = 'Call Spread'): OverlayCloseResult {
  const underlying = cs.underlying ?? 'QQQ';
  const closed = closeOptionPosition({ openingCashImpact: cs.creditReceived, legs: [
    { symbol: underlying, type: 'call', side: 'short', strike: cs.shortStrike, expiry: cs.expiry, quantity: cs.quantity },
    { symbol: underlying, type: 'call', side: 'long', strike: cs.longStrike, expiry: cs.expiry, quantity: cs.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: today, prices: { [underlying]: qqqClose }, vix, vix3m }), pricing);
  const [shortCall, longCall] = closed.legQuotes;
  const costPerShare = shortCall && longCall ? Math.max(0, shortCall.ask - longCall.bid) : 0;
  const cashImpact = -costPerShare * 100 * cs.quantity;
  const pnl = cs.creditReceived + cashImpact;
  return { cashImpact, pnl, costPerShare, note: `提前平仓 ${label} [${reason}]，回购成本 $${(-cashImpact).toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}` };
}

/** Call Spread 与 Bear Call Spread 共用的回测终局路径；仅由调用方决定策略标签。 */
export function finalizeCallCreditSpread(input: {
  position: CallCreditSpreadPosition;
  asOfDate: string;
  qqqClose: number;
  vix: number;
  pricing: OptionPricing;
  commission: number;
  label: string;
  vix3m?: number;
}): OverlaySettlementResult & { settled: boolean; costPerShare?: number } {
  const { position, asOfDate, qqqClose, vix, pricing, commission, label, vix3m } = input;
  if (position.expiry <= asOfDate) return { ...settleCallCreditSpread(position, qqqClose, label), settled: true };
  const marked = closeCallCreditSpreadAtMark(position, asOfDate, qqqClose, vix, '回测结束', pricing, vix3m, label);
  const cashImpact = marked.cashImpact - commission;
  return {
    cashImpact,
    // 保持既有回测的运算顺序，避免冻结结果产生浮点尾差。
    pnl: position.creditReceived + cashImpact,
    note: marked.note,
    settled: false,
    costPerShare: marked.costPerShare,
  };
}

export function buildCallCreditSpreadOpen(input: { chain: OptionChain; date: string; targetDte: number; widthPct: number; nav: number; riskBudget: number; shortDelta?: number; shortStrikeSigma?: number; dailySigma20?: number; forceMinimumContract?: boolean; independent?: boolean; underlying?: string }): OverlayOpenResult<CallCreditSpreadOpen> {
  const expiry = findNearestExpiry(input.chain.expirations, input.date, input.targetDte);
  const expiration = input.chain.expirations.find((item) => item.date === expiry);
  if (!expiry || !expiration) return {};
  if (input.shortStrikeSigma !== undefined && (!(input.dailySigma20 && input.dailySigma20 > 0) || !Number.isFinite(input.dailySigma20) || !(input.shortStrikeSigma > 0) || !Number.isFinite(input.shortStrikeSigma))) {
    return { warning: 'Call Credit Spread：日频 σ20 不可用，无法按距离选取短 Call' };
  }
  const targetShortStrike = input.shortStrikeSigma === undefined
    ? undefined
    : input.chain.spot * (1 + input.shortStrikeSigma * input.dailySigma20!);
  const shortCall = input.shortStrikeSigma === undefined
    ? findContractByDelta(expiration.calls, input.shortDelta ?? 0.20)
    : expiration.calls
      .filter((call) => call.strike > input.chain.spot)
      .sort((left, right) => Math.abs(left.strike - targetShortStrike!) - Math.abs(right.strike - targetShortStrike!))[0];
  const shortStrike = shortCall?.strike ?? input.chain.spot * 1.05;
  const targetLongStrike = shortStrike + Math.round(input.chain.spot * input.widthPct / 5) * 5;
  const longStrike = expiration.calls.filter((call) => call.strike > shortStrike).sort((a, b) => Math.abs(a.strike - targetLongStrike) - Math.abs(b.strike - targetLongStrike))[0]?.strike;
  const underlying = input.underlying ?? 'QQQ';
  const validation = validateCallCreditSpread({ underlying, shortCallStrike: shortStrike, longCallStrike: longStrike });
  if (!validation.ok) return { warning: validation.reason };
  const shortMid = expiration.calls.find((call) => call.strike === shortCall?.strike);
  const longMid = expiration.calls.find((call) => call.strike === longStrike);
  const credit = shortMid && longMid ? (shortMid.bid + shortMid.ask) / 2 - (longMid.bid + longMid.ask) / 2 : undefined;
  const maxLoss = Math.max(1, (longStrike - shortStrike) * 100 - (credit ?? 0) * 100);
  let quantity = Math.floor(input.nav * input.riskBudget / maxLoss);
  if (quantity < 1) {
    if (!input.forceMinimumContract) return { warning: `Call Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），跳过` };
    quantity = 1;
    return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined }, warning: `Call Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），[FMQ0]强制开1张，超预算${(maxLoss / (input.nav * input.riskBudget) * 100).toFixed(0)}%` };
  }
  return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined } };
}

/** CS proposal 的展示与风险字段从同一开仓结果派生。 */
export function buildCallCreditSpreadProposal(input: Parameters<typeof buildCallCreditSpreadOpen>[0]) {
  const built = buildCallCreditSpreadOpen(input);
  if (!built.open) return { warning: built.warning };
  const { shortStrike, longStrike, expiry, credit, maxLoss, quantity, riskBudgetUsed } = built.open;
  return {
    proposal: {
      proposedStrikes: { spread_short_strike: shortStrike, spread_long_strike: longStrike, expiry }, premiumEstimate: credit, maxRiskPct: riskBudgetUsed,
      metadata: { strategyName: `${built.open.underlying ?? 'QQQ'} Call Credit Spread @${shortStrike}/${longStrike}`, underlying: (built.open.underlying ?? 'QQQ') as 'QQQ', shortCallStrike: shortStrike, longCallStrike: longStrike, credit, maxLoss, buyingPowerImpact: maxLoss, quantity, riskBudgetUsed, definedRisk: true as const, proxyOverlay: true as const, notCoveredOverlay: true as const },
    },
    warning: built.warning,
  };
}

export function shouldTakeCallCreditSpreadProfit(input: { mode?: CSProfitTakeMode; daysLeft: number; regime: string; vix?: number; vix3m?: number; maxDte?: number; isSlowTrend?: boolean; slowTrendMaxDte?: number; conditionalProfitTakeRiskMode?: 'weakening_or_backwardation' | 'backwardation_only' | 'weakening_only' | 'backwardation_or_weakening_high_vix' | 'backwardation_or_high_vix' | 'weakening_or_high_vix'; conditionalProfitTakeWeakeningVixMin?: number }): boolean {
  if (input.mode !== 'conditional') return true;
  const backwardation = typeof input.vix === 'number' && Number.isFinite(input.vix) && typeof input.vix3m === 'number' && Number.isFinite(input.vix3m) && input.vix > input.vix3m;
  const effectiveMaxDte = input.isSlowTrend && typeof input.slowTrendMaxDte === 'number' ? input.slowTrendMaxDte : (input.maxDte ?? 14);
  const riskMode = input.conditionalProfitTakeRiskMode ?? 'weakening_or_backwardation';
  const macroRisk = riskMode === 'backwardation_only'
    ? backwardation
    : riskMode === 'weakening_only'
      ? input.regime === 'RISK_ON_WEAKENING'
      : riskMode === 'backwardation_or_weakening_high_vix'
        ? backwardation || (input.regime === 'RISK_ON_WEAKENING' && typeof input.vix === 'number' && Number.isFinite(input.vix) && input.vix >= (input.conditionalProfitTakeWeakeningVixMin ?? 18))
      : riskMode === 'backwardation_or_high_vix'
        ? backwardation || (typeof input.vix === 'number' && Number.isFinite(input.vix) && input.vix >= (input.conditionalProfitTakeWeakeningVixMin ?? 18))
      : riskMode === 'weakening_or_high_vix'
        ? input.regime === 'RISK_ON_WEAKENING' || (typeof input.vix === 'number' && Number.isFinite(input.vix) && input.vix >= (input.conditionalProfitTakeWeakeningVixMin ?? 18))
      : input.regime === 'RISK_ON_WEAKENING' || backwardation;
  return input.daysLeft <= effectiveMaxDte || macroRisk;
}

export function evaluateCallCreditSpreadExit(input: { expiry: string; creditReceived: number; asOfDate: string; regime: MarketRegime; daysLeft: number; shortCallDelta: number; highPrice: number; unrealizedPnl: number; profitTakeEnabled: boolean; profitTarget: number; profitTargetRegimeMode?: 'risk_on_extended' | 'bull_or_risk_on_extended' | 'bull_only' | 'range_or_weakening' | 'range_only' | 'weakening_only'; profitTargetRegimeValue?: number; profitTakeMode?: CSProfitTakeMode; conditionalProfitTakeMaxDte?: number; conditionalProfitTakeRiskMode?: 'weakening_or_backwardation' | 'backwardation_only' | 'weakening_only' | 'backwardation_or_weakening_high_vix' | 'backwardation_or_high_vix' | 'weakening_or_high_vix'; conditionalProfitTakeWeakeningVixMin?: number; vix?: number; vix3m?: number; deltaStopThreshold?: number; deltaAccelerationTriggered?: boolean; previousCloseDelta?: number; isSlowTrend?: boolean; slowTrendProfitTarget?: number; slowTrendConditionalPtMaxDte?: number; maxLossDollars?: number }): string | null {
  if (typeof input.maxLossDollars === 'number' && Number.isFinite(input.maxLossDollars) && input.maxLossDollars > 0 && input.unrealizedPnl <= -input.maxLossDollars) {
    return `单笔尾损上限触发：亏损 $${Math.abs(input.unrealizedPnl).toFixed(0)}`;
  }
  const exit = evaluateExitConditions({ type: 'cs', expiry: input.expiry, credit: input.creditReceived }, {
    asOfDate: input.asOfDate,
    regime: input.regime,
    dte: input.daysLeft,
    shortCallDelta: input.shortCallDelta,
    csDeltaStopThreshold: input.deltaStopThreshold,
  }).find((signal) => signal.auto && signal.severity === 'CLOSE');
  if (exit?.key === 'delta_stop') {
    if (input.deltaAccelerationTriggered) {
      const previous = typeof input.previousCloseDelta === 'number' ? `${(input.previousCloseDelta * 100).toFixed(0)}%` : '—';
      return `Delta 单日加速退出：前收 ${previous} → 当前 ${(input.shortCallDelta * 100).toFixed(0)}%，QQQ ${input.highPrice.toFixed(2)}`;
    }
    return `短腿 Call Δ${(input.shortCallDelta * 100).toFixed(0)}% 超限，QQQ ${input.highPrice.toFixed(2)}`;
  }
  const regimeTargetApplies = input.profitTargetRegimeMode === 'risk_on_extended'
    ? input.regime === 'RISK_ON_EXTENDED'
    : input.profitTargetRegimeMode === 'bull_only'
      ? input.regime === 'BULL'
    : input.profitTargetRegimeMode === 'bull_or_risk_on_extended'
      ? input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED'
    : input.profitTargetRegimeMode === 'range_or_weakening'
      ? input.regime === 'RANGE_BOUND' || input.regime === 'RISK_ON_WEAKENING'
    : input.profitTargetRegimeMode === 'range_only'
      ? input.regime === 'RANGE_BOUND'
    : input.profitTargetRegimeMode === 'weakening_only'
      ? input.regime === 'RISK_ON_WEAKENING'
      : false;
  const regimeProfitTarget = regimeTargetApplies && typeof input.profitTargetRegimeValue === 'number' ? input.profitTargetRegimeValue : input.profitTarget;
  const effectiveProfitTarget = input.isSlowTrend && typeof input.slowTrendProfitTarget === 'number' ? input.slowTrendProfitTarget : regimeProfitTarget;
  return input.profitTakeEnabled && input.unrealizedPnl >= input.creditReceived * effectiveProfitTarget && shouldTakeCallCreditSpreadProfit({ mode: input.profitTakeMode, daysLeft: input.daysLeft, regime: input.regime, vix: input.vix, vix3m: input.vix3m, maxDte: input.conditionalProfitTakeMaxDte, isSlowTrend: input.isSlowTrend, slowTrendMaxDte: input.slowTrendConditionalPtMaxDte, conditionalProfitTakeRiskMode: input.conditionalProfitTakeRiskMode, conditionalProfitTakeWeakeningVixMin: input.conditionalProfitTakeWeakeningVixMin })
    ? `提前止盈（达到 credit 的 ${(effectiveProfitTarget * 100).toFixed(0)}%），腾出仓位等待死猫跳再入场`
    : null;
}

/**
 * GS1：击穿后重开仓位乘数。默认参数（discount=1 或 rampCloses=0）恒返回 1.0（零行为变化）。
 * 亏损平仓后按 discount 缩仓，每次盈利平仓线性爬升，rampCloses 次后回满仓。
 * 依据 2026-07-17 CS 诊断：恶化集中在连败 streak=1（亏后首开），一次盈利平仓后期望回归基线。
 */
export function computeCSSizeMultiplier(state: CSBreachState | undefined, discount: number, rampCloses: number): number {
  if (!state?.active || rampCloses <= 0 || discount >= 1.0) return 1.0;
  const progress = Math.min(1, (state.cleanClosesSinceBreach ?? 0) / rampCloses);
  return discount + (1 - discount) * progress;
}

/**
 * GS1：CS/BearCS 平仓时的 breach 状态更新（4 个平仓/结算点共用）。
 * 亏损平仓 → 记录 breach 并重置爬升计数；盈利平仓且 breach 激活 → 计数 +1；其余不动。
 */
export function updateCSBreachStateOnClose(
  state: CSBreachState | undefined,
  close: { pnl: number; shortStrike: number; date: string; qqqClose: number },
): CSBreachState | undefined {
  if (close.pnl < 0) {
    return {
      breachedShortStrike: close.shortStrike,
      breachDate: close.date,
      qqqCloseAtBreach: close.qqqClose,
      tqqqROC20AtBreach: 0,
      regimeAtBreach: 'SIDEWAYS',
      active: true,
      cleanClosesSinceBreach: 0,
    };
  }
  if (state?.active) return {
    ...state,
    cleanClosesSinceBreach: (state.cleanClosesSinceBreach ?? 0) + 1,
  };
  return state;
}

export function releaseCallCreditSpreadBreach(state: CSBreachState | undefined, gate: string | undefined, qqqClose: number, qqqRoc5: number, tqqqRoc20: number): CSBreachState | undefined {
  if (!state?.active || !gate || gate === 'off') return state;
  const released = gate === 'strike_reclaim'
    ? qqqClose < state.breachedShortStrike
    : gate === 'pullback'
      ? qqqRoc5 < 0
      : gate === 'trend_pause' && tqqqRoc20 < 0.5 * state.tqqqROC20AtBreach;
  return released ? { ...state, active: false } : state;
}
