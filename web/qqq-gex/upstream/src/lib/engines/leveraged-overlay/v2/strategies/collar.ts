import { closeOptionPosition, createLegacyOptionMarket, optionOutcomeReasonKey, settleOptionPosition, type OptionPricing } from '../options';
import { OVERLAY_STRATEGY_TAGS } from '../../constants';
import type { CollarLifecycleDebug, MarketEnvironmentSnapshot } from '../../backtest/types';
import type { OptionChain } from '../../types/input';
import type { OverlayPosition, OverlaySettlementResult } from '../base';
import { findContractByDelta, findNearestExpiry } from '../../utils';
import { validateCollarPutSpread, validateCoveredShortCall } from '../../overlayValidation';
import { COLLAR_LONG_PUT_DELTA, COLLAR_SHORT_CALL_DELTA, COLLAR_SHORT_PUT_DELTA, COLLAR_TARGET_DTE } from '../../constants';

export type CollarCandidateInput = {
  enabled: boolean;
  sellAlternativeScenario: boolean;
  mode: string;
  hasLargePosition: boolean;
  regime: string;
  highDrawdown: boolean;
  vixSpiked: boolean;
  backwardation: boolean;
  extremeCallSpreadMode: boolean;
  vix: number;
  hasOpenCollar: boolean;
  hasOpenCallSpread: boolean;
  effectiveLevPct: number;
  tqqqThreshold: number;
};

export type CollarProposedStrikes = {
  put_strike?: number;
  put_spread_short_strike?: number;
  call_strike?: number;
  call_symbol: string;
  put_symbol: string;
  put_quantity: number;
  call_quantity: number;
  expiry: string;
};

/** Collar 的单日波动率突刺：保留旧逻辑的 prevVix 缺失回退与双阈值门。 */
export function evaluateCollarVixSpike(input: { vix: number; prevVix?: number; spikePct: number; spikeFloor: number }): { prevVix: number; pct: number; spiked: boolean } {
  const prevVix = input.prevVix ?? input.vix;
  const pct = prevVix > 0 ? (input.vix - prevVix) / prevVix : 0;
  return { prevVix, pct, spiked: pct >= input.spikePct && input.vix >= input.spikeFloor };
}

export function isCollarBackwardation(vix: number, vix3m?: number): boolean {
  return vix3m != null && vix3m < vix;
}

export function hasCollarLargePosition(effectiveLeveragedPct: number, defaultThreshold: number): boolean {
  return effectiveLeveragedPct > defaultThreshold;
}

/** 超目标杠杆仓位可选择 Collar 代替立即减仓；保留旧的范围与互斥条件。 */
export function evaluateCollarAlternativeToSell(input: {
  enabled: boolean;
  hasOpenCollar: boolean;
  hasOpenCallSpread: boolean;
  leveragedShares: number;
  regime: string;
  actualLeveragedPct: number;
  targetLeveragedPct: number;
  excessThreshold: number;
}): boolean {
  return input.enabled &&
    !input.hasOpenCollar &&
    !input.hasOpenCallSpread &&
    input.leveragedShares >= 100 &&
    (input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED' || input.regime === 'RISK_ON_WEAKENING') &&
    input.actualLeveragedPct > input.targetLeveragedPct + input.excessThreshold;
}

/** Collar 是否允许卖出 covered call；Put Spread 保护场景保持原有短 call 抑制。 */
export function allowCollarShortCall(input: {
  collarTriggered: boolean;
  regime: string;
  highDrawdown: boolean;
  vixSpiked: boolean;
  backwardation: boolean;
  sellAlternativeScenario: boolean;
  mode: string;
}): boolean {
  const bullOrdinaryDrawdown = input.regime === 'BULL' && input.highDrawdown && !input.vixSpiked && !input.backwardation && !input.sellAlternativeScenario;
  return input.collarTriggered &&
    !bullOrdinaryDrawdown &&
    input.regime !== 'RISK_ON_WEAKENING' &&
    input.mode !== 'overheat';
}

export function evaluateCollarCandidate(input: CollarCandidateInput): boolean {
  if (!input.enabled) return false;
  if (input.sellAlternativeScenario) return true;
  if (input.mode === 'reactive') return (input.hasLargePosition && (input.regime === 'SIDEWAYS' || input.regime === 'BEAR' || input.highDrawdown || input.vixSpiked)) || input.backwardation;
  if (input.mode === 'early') return (input.hasLargePosition && input.regime !== 'CRISIS' && (input.regime === 'SIDEWAYS' || input.regime === 'BEAR' || (input.regime === 'RISK_ON_EXTENDED' && !input.extremeCallSpreadMode) || input.highDrawdown || input.vixSpiked || (input.regime === 'BULL' && input.vix > 18))) || input.backwardation;
  if (input.mode === 'overheat') return input.hasLargePosition && input.regime === 'RISK_ON_EXTENDED' && !input.hasOpenCollar && !input.hasOpenCallSpread;
  if (input.mode === 'weakening') return input.hasLargePosition && input.regime === 'RISK_ON_WEAKENING' && !input.hasOpenCollar && !input.hasOpenCallSpread;
  if (input.mode === 'top_protect') return input.hasLargePosition && !input.hasOpenCollar && !input.hasOpenCallSpread && (input.regime === 'RISK_ON_EXTENDED' || input.regime === 'RISK_ON_WEAKENING');
  return input.mode === 'always' && input.effectiveLevPct > input.tqqqThreshold;
}

export function shouldRenewCollarInBear(input: { enabled: boolean; renewalEnabled: boolean; hasOpenCollar: boolean; regime: string; leveragedShares: number }): boolean {
  return input.enabled && input.renewalEnabled && !input.hasOpenCollar && (input.regime === 'BEAR' || input.regime === 'CRISIS') && input.leveragedShares >= 100;
}

export function evaluateCollarEligibility(input: CollarCandidateInput & { renewalEnabled: boolean; leveragedShares: number; qqqRv20: number; ivGate?: boolean | { maxVixRvRatio?: number } }): { eligible: boolean; scenario?: CollarLifecyclePosition['triggerScenario']; renewed: boolean; ivRejected: boolean; ivRejectionReason?: string } {
  const baseEligible = evaluateCollarCandidate(input);
  const renewed = !baseEligible && shouldRenewCollarInBear({ enabled: input.enabled, renewalEnabled: input.renewalEnabled, hasOpenCollar: input.hasOpenCollar, regime: input.regime, leveragedShares: input.leveragedShares });
  let eligible = baseEligible || renewed;
  const iv = collarIvGateAllows(input.ivGate, input.vix, input.qqqRv20);
  const ivRejected = eligible && !iv.ok && !input.sellAlternativeScenario && !input.backwardation && !input.vixSpiked;
  if (ivRejected) eligible = false;
  const scenario = input.sellAlternativeScenario ? 'alternative_to_sell'
    : eligible && input.backwardation ? 'backwardation'
    : eligible && input.vixSpiked ? 'vix_spike'
    : eligible && input.highDrawdown ? 'drawdown'
    : eligible && (input.regime === 'RISK_ON_EXTENDED' || input.mode === 'overheat' || (input.mode === 'early' && input.regime === 'BULL' && input.vix > 18)) ? 'overheat'
    : eligible && (input.regime === 'RISK_ON_WEAKENING' || input.regime === 'SIDEWAYS' || input.regime === 'BEAR') ? 'weakening'
    : undefined;
  return { eligible, scenario, renewed, ivRejected, ivRejectionReason: ivRejected ? iv.reason : undefined };
}

export function shouldBlockOverheatCollar(input: { scenario?: string; usedThisStreak: boolean; streakEntryRegime?: string; daysSinceLastBearExit: number; minPostBearDays: number }): boolean {
  if (input.scenario !== 'overheat') return false;
  return input.usedThisStreak || input.streakEntryRegime === 'BEAR' || input.streakEntryRegime === 'CRISIS' || input.daysSinceLastBearExit < input.minPostBearDays;
}

export function nextCollarExitConfirmation(input: { profile: string; reason: string | null; previousKey?: string; previousBars?: number }): { key?: string; bars: number; confirmed: boolean } {
  const key = input.reason && (input.reason.includes('Regime') || input.reason.includes('过热已消散') || input.reason.includes('VIX=')) ? input.reason : '';
  if (input.profile !== 'hold' || !key) return { bars: 0, confirmed: input.reason !== null };
  const bars = input.previousKey === key ? (input.previousBars ?? 0) + 1 : 1;
  return { key, bars, confirmed: bars >= 3 };
}

/** Collar 生命周期的退出确认状态转换；执行层据此决定当日成交或排入次日。 */
export function advanceCollarExitState(input: { profile: string; reason: string | null; previousKey?: string; previousBars?: number; exitAtOpen: boolean }): { exitConfirmKey?: string; exitConfirmBars: number; shouldClose: boolean; scheduleNextOpen: boolean } {
  const confirmation = nextCollarExitConfirmation(input);
  return {
    exitConfirmKey: confirmation.key,
    exitConfirmBars: confirmation.bars,
    shouldClose: confirmation.confirmed,
    scheduleNextOpen: confirmation.confirmed && !input.exitAtOpen,
  };
}

/** Collar 退出优先级。定价与成交由执行层负责；该函数只决定是否退出。 */
export function evaluateCollarExit(input: {
  shortPutStrike?: number;
  putStrike: number;
  putSymbol: string;
  putOpen: number;
  putLow: number;
  putDelta: number;
  callDelta?: number;
  callExitDelta: number;
  mtmExtraLoss: number;
  stopLoss: number;
  longPutExitDelta: number;
  sharedExitKey?: string;
  daysLeft: number;
  exitProfile: string;
  mode: string;
  scenario?: string;
  regime: string;
  vix: number;
  vixExit: number;
  drawdownRecovery: number;
  exitDrawdownPct: number;
}): { reason: string | null; exitAtOpen: boolean } {
  if (input.shortPutStrike && input.putOpen <= input.shortPutStrike) return { exitAtOpen: true, reason: `开盘跌穿 Short Put，锁定 Put Spread 保护收益：${input.putSymbol} open ${input.putOpen.toFixed(2)} ≤ Short Put @${input.shortPutStrike}（Long Put @${input.putStrike}）` };
  if (input.callDelta != null && input.callDelta > input.callExitDelta) return { exitAtOpen: false, reason: `Call Δ${(input.callDelta * 100).toFixed(0)}% 超限（阈值 Δ${(input.callExitDelta * 100).toFixed(0)}%），方向止损` };
  if (input.exitProfile !== 'hold' && input.mtmExtraLoss > input.stopLoss) return { exitAtOpen: false, reason: `Collar 逆方向亏损 $${input.mtmExtraLoss.toFixed(0)}（止损 $${input.stopLoss.toFixed(0)}），平仓` };
  if (input.shortPutStrike && input.putLow < input.shortPutStrike) return { exitAtOpen: false, reason: `${input.putSymbol} ${input.putLow.toFixed(2)} 跌破 Short Put @${input.shortPutStrike}，Put Spread 达到最大收益，平仓锁定` };
  if (input.sharedExitKey === 'delta_stop' && Math.abs(input.putDelta) > input.longPutExitDelta) return { exitAtOpen: false, reason: `Put Δ${(Math.abs(input.putDelta) * 100).toFixed(0)}% 深度价内，结算保护收益` };
  if (input.sharedExitKey === 'dte_exit') return { exitAtOpen: false, reason: `DTE=${input.daysLeft.toFixed(0)} 接近到期` };
  if (input.mode !== 'always' && input.scenario === 'drawdown' && input.exitDrawdownPct < input.drawdownRecovery) return { exitAtOpen: false, reason: `QQQ 回撤恢复（距20日高点 ${(input.exitDrawdownPct * 100).toFixed(1)}%），开仓条件消失，撤除保护` };
  if (input.mode !== 'always' && input.scenario === 'vix_spike' && input.vix < input.vixExit) return { exitAtOpen: false, reason: `VIX=${input.vix.toFixed(1)} 回落，VIX 突刺保护条件消失` };
  if (input.mode !== 'always' && input.scenario === 'weakening' && (input.regime === 'BULL' || input.regime === 'RISK_ON_EXTENDED') && input.vix < input.vixExit) return { exitAtOpen: false, reason: `Regime 回升至 ${input.regime}，VIX=${input.vix.toFixed(1)}，撤除保护` };
  if (input.mode !== 'always' && input.scenario === 'overheat' && input.regime === 'BULL' && input.vix < input.vixExit) return { exitAtOpen: false, reason: `过热已消散（Regime=${input.regime}，VIX=${input.vix.toFixed(1)}），Collar 撤除` };
  if (input.mode === 'top_protect' && input.scenario === 'overheat' && input.regime === 'RISK_ON_WEAKENING') return { exitAtOpen: false, reason: '顶部保护切换：Regime 进入 RISK_ON_WEAKENING，过热层让位转弱层' };
  return { exitAtOpen: false, reason: null };
}

export function collarOpenReasonKey(scenario?: string): string {
  if (scenario === 'overheat') return 'collar_overheat_open';
  if (scenario === 'drawdown') return 'collar_drawdown_open';
  if (scenario === 'vix_spike') return 'collar_vix_spike_open';
  if (scenario === 'weakening') return 'collar_weakening_open';
  if (scenario === 'alternative_to_sell') return 'collar_alternative_open';
  return 'collar_protection_open';
}

export function collarExitReasonKey(reason: string, isSettle: boolean): string {
  if (isSettle) return optionOutcomeReasonKey(reason, true);
  if (reason.includes('Regime 回升') || reason.includes('过热已消散')) return 'regime_recovered';
  if (reason.includes('VIX=')) return 'vix_normalized';
  if (reason.includes('顶部保护切换')) return 'regime_flip_roundtrip';
  return optionOutcomeReasonKey(reason, false);
}

export function calculateCollarOpen(input: { putAsk?: number; shortPutBid?: number; callBid?: number; putQuantity: number; callQuantity: number; impactPerShare: number; commission: number; putContractMultiplier?: number; callContractMultiplier?: number }): { netDebitPerContract: number; totalNetDebit: number } {
  const putMultiplier = input.putContractMultiplier ?? 100;
  let netDebitPerContract = ((input.putAsk ?? 0) - (input.shortPutBid ?? 0) + input.impactPerShare) * putMultiplier;
  const callCreditTotal = (input.callBid ?? 0) * (input.callContractMultiplier ?? 100) * input.callQuantity;
  return { netDebitPerContract, totalNetDebit: netDebitPerContract * input.putQuantity - callCreditTotal + input.commission };
}

export function buildCollarStrikes(input: { date: string; chains?: Partial<Record<string, OptionChain>>; leveragedSymbol: string; leveragedShares: number; actualLeveragedValue: number; qqqSpot: number; rollingHigh: number; allowShortCall: boolean; legMode?: 'putOnly' | 'callOnly' | 'both'; putUnderlying?: 'leveraged' | 'qqq'; strikeAnchor?: 'spot' | 'rollingHigh'; floorPct?: number }): { strikes?: CollarProposedStrikes; warning?: string } {
  const legMode = input.legMode ?? 'both';
  const putSymbol = input.putUnderlying === 'qqq' ? 'QQQ' : input.leveragedSymbol;
  const levChain = input.chains?.[input.leveragedSymbol];
  const putChain = input.chains?.[putSymbol];
  const levExpiry = levChain && findNearestExpiry(levChain.expirations, input.date, COLLAR_TARGET_DTE);
  const putExpiry = putChain && findNearestExpiry(putChain.expirations, input.date, COLLAR_TARGET_DTE);
  const levExp = levChain?.expirations.find(exp => exp.date === levExpiry);
  const putExp = putChain?.expirations.find(exp => exp.date === putExpiry);
  if (!levChain || !levExp || (legMode !== 'callOnly' && (!putChain || !putExp || !putExpiry))) return { warning: `${putSymbol}/${input.leveragedSymbol} 期权链缺失，无法构建 Collar` };
  const callMultiplier = levExp?.calls[0]?.contractMultiplier ?? 100;
  const covered = validateCoveredShortCall({ underlying: input.leveragedSymbol, leveragedSymbol: input.leveragedSymbol, requestedQuantity: Math.max(1, Math.floor(input.leveragedShares / callMultiplier)), leveragedSymbolShares: input.leveragedShares, contractMultiplier: callMultiplier });
  if (!covered.ok) return { warning: covered.reason ?? `${input.leveragedSymbol} shares are insufficient to cover short call` };
  const deltaPut = legMode === 'callOnly' ? undefined : findContractByDelta(putExp!.puts, -COLLAR_LONG_PUT_DELTA);
  const floor = legMode === 'callOnly' || input.strikeAnchor !== 'rollingHigh' ? undefined : putExp!.puts.filter(put => put.strike >= input.rollingHigh * (1 - (input.floorPct ?? .1)) * (putSymbol === input.leveragedSymbol ? levChain.spot / Math.max(input.qqqSpot, 1) : 1)).sort((a, b) => a.strike - b.strike)[0];
  const longPut = deltaPut && floor && floor.strike > deltaPut.strike ? floor : deltaPut;
  const shortPut = legMode === 'callOnly' ? undefined : findContractByDelta(putExp!.puts, -COLLAR_SHORT_PUT_DELTA);
  const shortCall = (input.allowShortCall || legMode === 'callOnly') ? findContractByDelta(levExp.calls, COLLAR_SHORT_CALL_DELTA) : undefined;
  if (legMode !== 'callOnly') {
    const putValidation = validateCollarPutSpread({ longPutStrike: longPut?.strike, shortPutStrike: shortPut?.strike });
    if (!putValidation.ok) return { warning: putValidation.reason };
  }
  if (legMode === 'callOnly' && !shortCall) return { warning: '无法构建 Covered Call 行权价' };
  const putMultiplier = putExp?.puts[0]?.contractMultiplier ?? 100;
  return { strikes: { put_strike: longPut?.strike, put_spread_short_strike: shortPut?.strike, call_strike: shortCall?.strike, call_symbol: input.leveragedSymbol, put_symbol: putSymbol, put_quantity: legMode === 'callOnly' ? 0 : putSymbol === 'QQQ' ? Math.max(0, Math.floor(input.actualLeveragedValue * 3 / Math.max(input.qqqSpot, 1) / putMultiplier)) : covered.quantity, call_quantity: covered.quantity, expiry: putExpiry ?? levExpiry! } };
}

/** Collar 开仓 proposal 的唯一构建入口；保留 v1 的价格、成本和文案顺序。 */
export function buildCollarProposal(input: {
  date: string;
  chains?: Partial<Record<string, OptionChain>>;
  leveragedSymbol: string;
  leveragedShares: number;
  actualLeveragedValue: number;
  qqqSpot: number;
  rollingHigh: number;
  allowShortCall: boolean;
  legMode?: 'putOnly' | 'callOnly' | 'both';
  putUnderlying: 'leveraged' | 'qqq';
  strikeAnchor: 'spot' | 'rollingHigh';
  floorPct: number;
  exitProfile: string;
  maxDebitPct?: number;
}): { strikes?: CollarProposedStrikes; premiumEstimate?: number; warning: string; preserveAction?: boolean } {
  const legMode = input.legMode ?? 'both';
  const putSymbol = input.putUnderlying === 'qqq' ? 'QQQ' : input.leveragedSymbol;
  const levChain = input.chains?.[input.leveragedSymbol];
  const putChain = input.chains?.[putSymbol];
  const levExpiry = levChain ? findNearestExpiry(levChain.expirations, input.date, COLLAR_TARGET_DTE) : null;
  const putExpiry = putChain ? findNearestExpiry(putChain.expirations, input.date, COLLAR_TARGET_DTE) : null;
  const levExpData = levChain && levExpiry ? levChain.expirations.find(e => e.date === levExpiry) : null;
  const putExpData = putChain && putExpiry ? putChain.expirations.find(e => e.date === putExpiry) : null;
  if (!levChain || !levExpData || !levExpiry || (legMode !== 'callOnly' && (!putChain || !putExpData || !putExpiry))) {
    return { warning: `${putSymbol}/${input.leveragedSymbol} 期权链缺失，无法构建 Collar`, preserveAction: true };
  }
  const built = buildCollarStrikes(input);
  if (!built.strikes) return { warning: built.warning ?? '无法构建 Collar 行权价' };
  const strikes = built.strikes;
  const shortCall = strikes.call_strike ? levExpData.calls.find(call => call.strike === strikes.call_strike) : undefined;
  const longPut = putExpData?.puts.find(put => put.strike === strikes.put_strike);
  const shortPut = putExpData?.puts.find(put => put.strike === strikes.put_spread_short_strike);
  if (legMode !== 'callOnly') {
    const putValidation = validateCollarPutSpread({ longPutStrike: longPut?.strike, shortPutStrike: shortPut?.strike });
    if (!putValidation.ok) return { warning: putValidation.reason! };
  }
  const premiumEstimate = legMode === 'callOnly'
    ? shortCall ? (shortCall.bid + shortCall.ask) / 2 : undefined
    : (!input.allowShortCall || shortCall) && longPut && shortPut
      ? (shortCall ? (shortCall.bid + shortCall.ask) / 2 : 0) + (shortPut.bid + shortPut.ask) / 2 - (longPut.bid + longPut.ask) / 2
      : undefined;
  const usesRebuiltCollar = input.strikeAnchor === 'rollingHigh' || input.putUnderlying === 'qqq' || input.exitProfile === 'hold' || input.maxDebitPct != null;
  const effectiveMaxDebitPct = input.maxDebitPct ?? .01;
  const protectedNotional = strikes.put_quantity * 100 * (putChain?.spot ?? 0);
  if (legMode !== 'callOnly' && usesRebuiltCollar && premiumEstimate != null && premiumEstimate < 0 && Math.abs(premiumEstimate) * 100 * strikes.put_quantity > protectedNotional * effectiveMaxDebitPct) {
    return { warning: `Collar 成本 ${(Math.abs(premiumEstimate) * 100 * strikes.put_quantity).toFixed(0)} 超过 ${(effectiveMaxDebitPct * 100).toFixed(1)}% 被保护名义，跳过` };
  }
  const netLabel = premiumEstimate != null ? premiumEstimate >= 0 ? `净权利金 +$${premiumEstimate.toFixed(2)}` : `净成本 -$${Math.abs(premiumEstimate).toFixed(2)}` : '权利金估算不可用';
  if (legMode === 'callOnly') return { strikes, premiumEstimate, warning: `Covered Call（${input.leveragedSymbol}）@${strikes.call_strike ?? '?'} | ${netLabel}` };
  const strategyLabel = input.allowShortCall ? 'Put Spread Collar' : 'Put Spread Protection';
  const callLabel = input.allowShortCall ? `Covered Call @${strikes.call_strike ?? '?'} | ` : '无 Call 腿 | ';
  return { strikes, premiumEstimate, warning: `${strategyLabel}（${input.leveragedSymbol}）：${callLabel}${putSymbol} 保护区间 $${strikes.put_spread_short_strike ?? '?'}–$${strikes.put_strike ?? '?'} | 尾部 <$${strikes.put_spread_short_strike ?? '?'} 无保护 | ${netLabel}` };
}

/** 复用与行权价选择相同的覆盖校验，避免 Pipeline 重算 Collar 展示元数据。 */
export function buildCollarProposalMetadata(input: { leveragedSymbol: string; leveragedShares: number; callSymbol: string; callStrike?: number }) {
  const covered = validateCoveredShortCall({
    underlying: input.callSymbol,
    leveragedSymbol: input.leveragedSymbol,
    requestedQuantity: Math.max(1, Math.floor(input.leveragedShares / 100)),
    leveragedSymbolShares: input.leveragedShares,
  });
  return {
    strategyName: input.callStrike ? `${input.leveragedSymbol} Put Spread Collar` : `${input.leveragedSymbol} Put Spread Protection`,
    underlying: input.leveragedSymbol,
    quantity: covered.quantity,
    coveredByShares: covered.coveredByShares,
    coveredSharesRequired: covered.coveredSharesRequired,
    currentShares: covered.currentShares,
    uncoveredQuantity: covered.uncoveredQuantity,
  };
}

export function collarPnlBreakdown(collar: CollarPosition, putSpot: number, closeCashImpact: number, callSpot = putSpot): { intrinsicPnl: number; residualTimeValuePnl: number } {
  const putQuantity = collar.putQuantity ?? collar.quantity;
  const callQuantity = collar.callQuantity ?? collar.quantity;
  const intrinsicValue = (collar.putStrike > 0 ? Math.max(collar.putStrike - putSpot, 0) * 100 * putQuantity : 0)
    - (collar.shortPutStrike ? Math.max(collar.shortPutStrike - putSpot, 0) * 100 * putQuantity : 0)
    - (collar.callStrike ? Math.max(callSpot - collar.callStrike, 0) * 100 * callQuantity : 0);
  return { intrinsicPnl: intrinsicValue - collar.netDebit, residualTimeValuePnl: closeCashImpact - intrinsicValue };
}

export function recordCollarLifecycleClose(lifecycle: CollarLifecycleDebug | undefined, collar: CollarLifecyclePosition, input: { closeDate: string; closeSpot: number; closeCashImpact: number; pnl: number; reason: string; isSettle: boolean }): void {
  if (!lifecycle || lifecycle.closeDate) return;
  lifecycle.closeDate = input.closeDate;
  lifecycle.closeSpot = input.closeSpot;
  lifecycle.closeCashImpact = input.closeCashImpact;
  lifecycle.pnl = input.pnl;
  lifecycle.exitKey = collarExitReasonKey(input.reason, input.isSettle);
  lifecycle.pnlBreakdown = collarPnlBreakdown(collar, input.closeSpot, input.closeCashImpact);
  lifecycle.regimeFlipRoundTrip = lifecycle.exitKey === 'regime_flip_roundtrip' || (lifecycle.exitKey === 'regime_recovered' && (new Date(input.closeDate).getTime() - new Date(lifecycle.openDate).getTime()) / 86400000 <= 1);
}

export type CollarPosition = OverlayPosition & { putUnderlying?: string; putStrike: number; shortPutStrike?: number; callStrike?: number; putQuantity?: number; callQuantity?: number; netDebit: number; putContractMultiplier?: number; callContractMultiplier?: number; putSplitAdjustmentFactor?: number; callSplitAdjustmentFactor?: number };

export type CollarLifecyclePosition = CollarPosition & {
  debugId?: number;
  callUnderlying?: string;
  triggerScenario?: 'overheat' | 'weakening' | 'alternative_to_sell' | 'drawdown' | 'vix_spike' | 'backwardation';
  exitConfirmKey?: string;
  exitConfirmBars?: number;
  exitScheduled?: boolean;
  marketContext?: MarketEnvironmentSnapshot;
};

export function buildCollarLifecyclePosition(input: {
  debugId: number;
  expiry: string;
  putUnderlying: string;
  leveragedSymbol: string;
  putStrike: number;
  shortPutStrike?: number;
  callStrike?: number;
  putQuantity: number;
  callQuantity: number;
  netDebit: number;
  putContractMultiplier?: number;
  callContractMultiplier?: number;
  putSplitAdjustmentFactor?: number;
  callSplitAdjustmentFactor?: number;
  triggerScenario?: CollarLifecyclePosition['triggerScenario'];
  marketContext?: MarketEnvironmentSnapshot;
}): CollarLifecyclePosition {
  return {
    debugId: input.debugId,
    expiry: input.expiry,
    putUnderlying: input.putUnderlying,
    callUnderlying: input.leveragedSymbol,
    putStrike: input.putStrike,
    shortPutStrike: input.shortPutStrike,
    callStrike: input.callStrike,
    quantity: input.putQuantity,
    putQuantity: input.putQuantity,
    callQuantity: input.callQuantity,
    netDebit: input.netDebit,
    putContractMultiplier: input.putContractMultiplier,
    callContractMultiplier: input.callContractMultiplier,
    putSplitAdjustmentFactor: input.putSplitAdjustmentFactor,
    callSplitAdjustmentFactor: input.callSplitAdjustmentFactor,
    triggerScenario: input.triggerScenario,
    marketContext: input.marketContext,
  };
}

function collarLegs(collar: CollarPosition, leveragedSymbol: string) {
  const putSymbol = collar.putUnderlying ?? leveragedSymbol;
  const putQuantity = collar.putQuantity ?? collar.quantity;
  const callQuantity = collar.callQuantity ?? collar.quantity;
  return [
    ...(collar.putStrike > 0 ? [{ symbol: putSymbol, type: 'put' as const, side: 'long' as const, strike: collar.putStrike, expiry: collar.expiry, quantity: putQuantity, contractMultiplier: collar.putContractMultiplier, splitAdjustmentFactor: collar.putSplitAdjustmentFactor }] : []),
    ...(collar.shortPutStrike ? [{ symbol: putSymbol, type: 'put' as const, side: 'short' as const, strike: collar.shortPutStrike, expiry: collar.expiry, quantity: putQuantity, contractMultiplier: collar.putContractMultiplier, splitAdjustmentFactor: collar.putSplitAdjustmentFactor }] : []),
    ...(collar.callStrike ? [{ symbol: leveragedSymbol, type: 'call' as const, side: 'short' as const, strike: collar.callStrike, expiry: collar.expiry, quantity: callQuantity, contractMultiplier: collar.callContractMultiplier, splitAdjustmentFactor: collar.callSplitAdjustmentFactor }] : []),
  ];
}

export function closeCollarAtMark(collar: CollarPosition, today: string, levClose: number, vix: number, leveragedSymbol: string, reason: string, pricing: OptionPricing, vix3m?: number, qqqClose = levClose, splitAdjustmentFactors?: Record<string, number>): OverlaySettlementResult {
  const closed = closeOptionPosition({ openingCashImpact: -collar.netDebit, legs: collarLegs(collar, leveragedSymbol) }, createLegacyOptionMarket({ asOfDate: today, prices: { [leveragedSymbol]: levClose, QQQ: qqqClose }, vix, vix3m, splitAdjustmentFactors }), pricing);
  const { cashImpact, pnl } = closed;
  return { cashImpact, pnl, note: `平仓 Collar [${reason}]，现金流 ${cashImpact >= 0 ? '+' : ''}$${cashImpact.toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}` };
}

export function settleCollar(collar: CollarPosition, levClose: number, leveragedSymbol: string, qqqClose = levClose): OverlaySettlementResult {
  const putSymbol = collar.putUnderlying ?? leveragedSymbol;
  const putSpot = putSymbol === 'QQQ' ? qqqClose : levClose;
  const putQty = collar.putQuantity ?? collar.quantity;
  const longPutIntrinsic = collar.putStrike > 0 ? Math.max(collar.putStrike - putSpot, 0) * (collar.putContractMultiplier ?? 100) * putQty : 0;
  const shortPutIntrinsic = collar.shortPutStrike ? Math.max(collar.shortPutStrike - putSpot, 0) * (collar.putContractMultiplier ?? 100) * putQty : 0;
  const settled = settleOptionPosition({ openingCashImpact: -collar.netDebit, legs: collarLegs(collar, leveragedSymbol) }, createLegacyOptionMarket({ asOfDate: '', prices: { [leveragedSymbol]: levClose, QQQ: qqqClose }, vix: 20 }));
  const { cashImpact, pnl } = settled;
  const spreadNote = collar.shortPutStrike ? ` | 空头 Put@${collar.shortPutStrike} 结算 -$${shortPutIntrinsic.toFixed(0)}` : '';
  const note = cashImpact === 0
    ? `Collar 到期，各腿价外（${leveragedSymbol} ${levClose.toFixed(2)}），到期价值 $0，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`
    : cashImpact > 0
      ? collar.putStrike > 0
        ? `Collar 结算：Long Put@${collar.putStrike} 价内（${collar.putUnderlying ?? leveragedSymbol} ${putSpot.toFixed(2)}），获赔 +$${longPutIntrinsic.toFixed(0)}${spreadNote}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`
        : `Covered Call 结算：Call 被行权（${leveragedSymbol} ${levClose.toFixed(2)} > @${collar.callStrike}），支出 -$${Math.abs(cashImpact).toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`
      : collar.callStrike
        ? `Collar 结算：Call 被行权（${leveragedSymbol} ${levClose.toFixed(2)} > @${collar.callStrike}），支出 -$${Math.abs(cashImpact).toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`
        : `Collar 结算：Put Spread 保护净支出 -$${Math.abs(cashImpact).toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`;
  return { cashImpact, pnl, note };
}

/** Collar 终局估值只负责期权腿；现金归属与 lifecycle 仍由调用方的独立 Collar 账本处理。 */
export function finalizeCollar(input: {
  collar: CollarPosition;
  asOfDate: string;
  leveragedClose: number;
  qqqClose: number;
  vix: number;
  leveragedSymbol: string;
  pricing: OptionPricing;
  commission: number;
  vix3m?: number;
  splitAdjustmentFactors?: Record<string, number>;
}): OverlaySettlementResult & { settled: boolean; grossCashImpact: number } {
  const { collar, asOfDate, leveragedClose, qqqClose, vix, leveragedSymbol, pricing, commission, vix3m, splitAdjustmentFactors } = input;
  if (collar.expiry <= asOfDate) {
    const settled = settleCollar(collar, leveragedClose, leveragedSymbol, qqqClose);
    return { ...settled, settled: true, grossCashImpact: settled.cashImpact };
  }
  const marked = closeCollarAtMark(collar, asOfDate, leveragedClose, vix, leveragedSymbol, '回测结束', pricing, vix3m, qqqClose, splitAdjustmentFactors);
  return {
    cashImpact: marked.cashImpact - commission,
    pnl: marked.pnl - commission,
    note: marked.note,
    settled: false,
    grossCashImpact: marked.cashImpact,
  };
}

export function collarIvGateAllows(gate: boolean | { maxVixRvRatio?: number } | undefined, vix: number, qqqRv20: number): { ok: boolean; reason?: string } {
  if (!gate) return { ok: true };
  const maxRatio = typeof gate === 'object' ? gate.maxVixRvRatio ?? 1.4 : 1.4;
  if (qqqRv20 <= 0 || vix <= 0) return { ok: true };
  const ratio = (vix / 100) / qqqRv20;
  return ratio <= maxRatio ? { ok: true } : { ok: false, reason: `Collar IV 门：VIX/QQQ RV20=${ratio.toFixed(2)} > ${maxRatio.toFixed(2)}，保护过贵，跳过新开 Collar` };
}

export function getOpenOverlayPositionFlags(input: { leveragedSymbol: string; positions: Array<{ symbol: string }>; optionPositions: Array<{ symbol: string; type: 'call' | 'put'; quantity: number; strategyTag?: string; groupId?: string; expiry: string; strike: number }> }) {
  const legacyCollar = input.positions.some((position) => position.symbol === `${input.leveragedSymbol} COL` || position.symbol.endsWith(' COL'));
  let hasOpenCollar = legacyCollar;
  let hasOpenCollarShortCall = legacyCollar;
  let hasOpenQQQCallSpread = false;
  let hasOpenQQQPutSpread = false;
  let hasOpenEquityBoost = false;
  const openICGroups = new Set<string>();
  for (const position of input.optionPositions) {
    if (position.strategyTag === OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR || position.strategyTag === `${input.leveragedSymbol}_COLLAR` || position.groupId?.includes('collar')) {
      hasOpenCollar = true;
      if (position.symbol === input.leveragedSymbol && position.type === 'call' && position.quantity < 0) hasOpenCollarShortCall = true;
    }
    if (position.symbol === 'QQQ' && position.type === 'call' && position.quantity < 0 && (position.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD || position.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD || position.groupId?.includes('call-spread') || position.groupId?.includes('bear-bcs'))) hasOpenQQQCallSpread = true;
    if (position.symbol === 'QQQ' && position.type === 'put' && position.quantity < 0 && position.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD) hasOpenQQQPutSpread = true;
    if (position.symbol === 'QQQ' && position.type === 'put' && position.quantity < 0 && position.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD) hasOpenEquityBoost = true;
    if (position.symbol === 'QQQ' && position.quantity < 0 && (position.strategyTag === OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR || position.groupId?.includes('iron-condor'))) openICGroups.add(position.groupId ?? `${position.symbol}:${position.expiry}:${position.strike}`);
  }
  return { hasOpenCollar, hasOpenCollarShortCall, hasOpenQQQCallSpread, hasOpenQQQPutSpread, hasOpenEquityBoost, openICCount: openICGroups.size };
}
