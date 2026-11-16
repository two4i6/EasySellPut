import type { OptionChain } from '../../types/input';
import { findContractByDelta, findNearestExpiry } from '../../utils';
import { validateIronCondor } from '../../overlayValidation';
import { evaluateExitConditions } from '../../exitConditions';
import type { ICMode } from '../../types/params';
import type { MarketRegime } from '../../types/output';
import { closeOptionPosition, createLegacyOptionMarket, optionCommission, optionExecutionImpact, settleOptionPosition, type OptionPricing } from '../options';
import type { OverlayCloseResult, OverlayOpenResult, OverlayPosition, OverlaySettlementResult } from '../base';

export type IronCondorCandidateInput = {
  enabled: boolean;
  regimeAllowed: boolean;
  pendingCollarHasShortCall: boolean;
  hasOpenCollarShortCall: boolean;
  callSpreadTriggered: boolean;
  openCount: number;
  maxConcurrent: number;
  vix: number;
  vixMin: number;
  vixMax: number;
  tooCloseToTop: boolean;
  tooCloseToBottom: boolean;
};

/** IC 的唯一候选门；成交与账本仍由既有 Pipeline/模拟器处理。 */
export function evaluateIronCondorCandidate(input: IronCondorCandidateInput): boolean {
  return input.enabled &&
    input.regimeAllowed &&
    !input.pendingCollarHasShortCall &&
    !input.hasOpenCollarShortCall &&
    !input.callSpreadTriggered &&
    input.openCount < input.maxConcurrent &&
    input.vix >= input.vixMin &&
    input.vix <= input.vixMax &&
    !input.tooCloseToTop &&
    !input.tooCloseToBottom;
}

type IronCondorConfig = {
  delta: number;
  wingPct: number;
  maxRiskPct: number;
  minCreditRatio: number;
};

export type IronCondorOpen = {
  strikes: { putShort: number; putLong: number; callShort: number; callLong: number; expiry: string };
  premiumEstimate: number;
  maxRiskPct: number;
  maxContracts: number;
};

/** IC proposal 的风险/展示字段由策略开仓结果唯一派生。 */
export function buildIronCondorProposalMetadata(open: IronCondorOpen) {
  const { putLong, putShort, callShort, callLong } = open.strikes;
  const maxLoss = Math.max(1, Math.max(putShort - putLong, callLong - callShort) * 100 - open.premiumEstimate * 100);
  return {
    strategyName: 'QQQ Iron Condor', underlying: 'QQQ' as const,
    putLongStrike: putLong, putShortStrike: putShort, callShortStrike: callShort, callLongStrike: callLong,
    totalCredit: open.premiumEstimate, maxLoss, buyingPowerImpact: maxLoss,
    quantity: open.maxContracts, riskBudgetUsed: open.maxRiskPct,
    definedRisk: true as const, proxyOverlay: true as const, notCoveredOverlay: true as const,
  };
}

/** IC 开仓 proposal 的唯一出口；保留旧 Pipeline 的 warning 与展示字段。 */
export function buildIronCondorProposal(input: Parameters<typeof buildIronCondorOpen>[0]) {
  const built = buildIronCondorOpen(input);
  if (!built.open) return { warning: built.warning };
  const { strikes, premiumEstimate, maxRiskPct, maxContracts } = built.open;
  return {
    proposal: {
      proposedStrikes: { ic_put_short: strikes.putShort, ic_put_long: strikes.putLong, ic_call_short: strikes.callShort, ic_call_long: strikes.callLong, expiry: strikes.expiry },
      premiumEstimate,
      maxRiskPct,
      maxContracts,
      metadata: buildIronCondorProposalMetadata(built.open),
    },
    warning: [built.warning, `Iron Condor 推荐：Put${strikes.putLong}/${strikes.putShort} + Call${strikes.callShort}/${strikes.callLong}，到期 ${strikes.expiry}，最多 ${maxContracts} 张，最大风险 ${(maxRiskPct * 100).toFixed(1)}% NAV`].filter(Boolean).join('；'),
  };
}

/** IC 估值与结算所需的仓位字段；执行时序元数据由模拟器账本持有。 */
export type IronCondorPosition = OverlayPosition & {
  putShort: number;
  putLong: number;
  callShort: number;
  callLong: number;
  creditReceived: number;
};

export type IronCondorSettlementPosition = Pick<IronCondorPosition, 'putShort' | 'callShort' | 'quantity' | 'creditReceived'> & {
  putWidth: number;
  callWidth: number;
};

/** 四腿 IC 的实际开仓成交；流动性限额、冲击和佣金在此保持同一现金流顺序。 */
export function openIronCondorFill(input: {
  requestedQuantity: number;
  maxQuantity: number;
  shortPutBid?: number;
  longPutAsk?: number;
  shortCallBid?: number;
  longCallAsk?: number;
  strikeVolume: number;
  vix: number;
  impactEnabled: boolean;
  commissionPerContract: number;
}): { quantity: number; creditPerContract: number; totalCredit: number } {
  const quantity = Math.max(0, Math.min(input.requestedQuantity, input.maxQuantity));
  const grossCredit = input.shortPutBid != null && input.longPutAsk != null && input.shortCallBid != null && input.longCallAsk != null
    ? (input.shortPutBid - input.longPutAsk + input.shortCallBid - input.longCallAsk) * 100
    : 0;
  const creditPerContract = grossCredit - optionExecutionImpact({ enabled: input.impactEnabled, contracts: quantity, strikeVolume: input.strikeVolume, vix: input.vix }) * 100;
  return { quantity, creditPerContract, totalCredit: creditPerContract * quantity - optionCommission(4, quantity, input.commissionPerContract) };
}

/** 复用旧成交语义的 IC 开仓计算；调用方仍负责将结果送进原 Pipeline。 */
export function buildIronCondorOpen(input: {
  chain: OptionChain;
  date: string;
  targetDte: number;
  config: IronCondorConfig;
  nav: number;
  maxConcurrent: number;
  forceMinimumContract?: boolean;
  independent?: boolean;
}): OverlayOpenResult<IronCondorOpen> {
  const expiry = findNearestExpiry(input.chain.expirations, input.date, input.targetDte);
  const expData = input.chain.expirations.find((expiration) => expiration.date === expiry);
  if (!expData || !expiry) return {};

  const spot = input.chain.spot;
  const shortPut = findContractByDelta(expData.puts, -input.config.delta);
  const shortCall = findContractByDelta(expData.calls, input.config.delta);
  const wingWidth = Math.max(5, Math.round(spot * input.config.wingPct / 5) * 5);
  const putShort = shortPut?.strike ?? Math.round((spot * 0.92) / 5) * 5;
  const putLong = putShort - wingWidth;
  const callShort = shortCall?.strike ?? Math.round((spot * 1.08) / 5) * 5;
  const callLong = callShort + wingWidth;
  const validation = validateIronCondor({ putLongStrike: putLong, putShortStrike: putShort, callShortStrike: callShort, callLongStrike: callLong });
  if (!validation.ok) return { warning: validation.reason! };

  const shortPutMid = expData.puts.find((put) => put.strike === putShort);
  const longPutMid = expData.puts.find((put) => put.strike === putLong);
  const shortCallMid = expData.calls.find((call) => call.strike === callShort);
  const longCallMid = expData.calls.find((call) => call.strike === callLong);
  const premiumEstimate = shortPutMid && longPutMid && shortCallMid && longCallMid
    ? (shortPutMid.bid + shortPutMid.ask) / 2 - (longPutMid.bid + longPutMid.ask) / 2 + (shortCallMid.bid + shortCallMid.ask) / 2 - (longCallMid.bid + longCallMid.ask) / 2
    : undefined;
  const creditRatio = premiumEstimate != null && wingWidth > 0 ? premiumEstimate / wingWidth : 0;
  if (premiumEstimate == null || creditRatio < input.config.minCreditRatio) {
    return { warning: `Iron Condor credit/wing ${(creditRatio * 100).toFixed(1)}% < 门槛 ${(input.config.minCreditRatio * 100).toFixed(0)}%，暂缓开仓` };
  }
  const maxRiskPerCondor = Math.max(1, wingWidth * 100 - premiumEstimate * 100);
  let maxContracts = Math.floor(input.nav * (input.config.maxRiskPct / input.maxConcurrent) / maxRiskPerCondor);
  if (maxContracts < 1) {
    if (!input.forceMinimumContract) return { warning: `Iron Condor：NAV 预算不足以开 1 张（maxLoss/张=$${maxRiskPerCondor.toFixed(0)}），跳过` };
    maxContracts = 1;
    return { open: { strikes: { putShort, putLong, callShort, callLong, expiry }, premiumEstimate, maxRiskPct: maxRiskPerCondor / input.nav, maxContracts }, warning: `Iron Condor：NAV 预算不足以开 1 张（maxLoss/张=$${maxRiskPerCondor.toFixed(0)}），[FMQ0]强制开1张，超预算${(maxRiskPerCondor / (input.nav * (input.config.maxRiskPct / input.maxConcurrent)) * 100).toFixed(0)}%` };
  }
  return { open: { strikes: { putShort, putLong, callShort, callLong, expiry }, premiumEstimate, maxRiskPct: (maxContracts * maxRiskPerCondor) / input.nav, maxContracts } };
}

export function settleIronCondor(ic: IronCondorSettlementPosition, qqqClose: number): OverlaySettlementResult {
  const callLoss = qqqClose > ic.callShort ? Math.min(qqqClose - ic.callShort, ic.callWidth) : 0;
  const putLoss = qqqClose < ic.putShort ? Math.min(ic.putShort - qqqClose, ic.putWidth) : 0;
  const grossLoss = (callLoss + putLoss) * 100 * ic.quantity;
  const settled = settleOptionPosition({ openingCashImpact: ic.creditReceived, legs: [
    { symbol: 'QQQ', type: 'put', side: 'short', strike: ic.putShort, expiry: '', quantity: ic.quantity },
    { symbol: 'QQQ', type: 'put', side: 'long', strike: ic.putShort - ic.putWidth, expiry: '', quantity: ic.quantity },
    { symbol: 'QQQ', type: 'call', side: 'short', strike: ic.callShort, expiry: '', quantity: ic.quantity },
    { symbol: 'QQQ', type: 'call', side: 'long', strike: ic.callShort + ic.callWidth, expiry: '', quantity: ic.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: '', prices: { QQQ: qqqClose }, vix: 20 }));
  const { cashImpact, pnl } = settled;
  const note = grossLoss === 0
    ? `IC 到期无损耗（标的 ${qqqClose.toFixed(2)} 在区间内），到期现金流 $0，净 +$${pnl.toFixed(0)}`
    : `${callLoss > 0 ? `IC 结算：Call 短腿 @${ic.callShort}` : `IC 结算：Put 短腿 @${ic.putShort}`} 被突破（标的 ${qqqClose.toFixed(2)}），亏损 -$${grossLoss.toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`;
  return { cashImpact, pnl, note };
}

export type IronCondorPricing = OptionPricing;

export function closeIronCondorAtMark(
  ic: IronCondorPosition,
  today: string,
  qqqClose: number,
  vix: number,
  reason: string,
  pricing: IronCondorPricing,
  vix3m?: number,
): OverlayCloseResult {
  const closed = closeOptionPosition({ openingCashImpact: ic.creditReceived, legs: [
    { symbol: 'QQQ', type: 'put', side: 'short', strike: ic.putShort, expiry: ic.expiry, quantity: ic.quantity },
    { symbol: 'QQQ', type: 'put', side: 'long', strike: ic.putLong, expiry: ic.expiry, quantity: ic.quantity },
    { symbol: 'QQQ', type: 'call', side: 'short', strike: ic.callShort, expiry: ic.expiry, quantity: ic.quantity },
    { symbol: 'QQQ', type: 'call', side: 'long', strike: ic.callLong, expiry: ic.expiry, quantity: ic.quantity },
  ] }, createLegacyOptionMarket({ asOfDate: today, prices: { QQQ: qqqClose }, vix, vix3m }), pricing);
  const [shortPut, longPut, shortCall, longCall] = closed.legQuotes;
  const costPerShare = shortPut && longPut && shortCall && longCall
    ? shortPut.ask + shortCall.ask - longPut.bid - longCall.bid
    : 0;
  // 保持旧 IC 的四腿加总/乘数顺序，冻结回放对浮点最后一位也可复现。
  const cashImpact = -costPerShare * 100 * ic.quantity;
  const pnl = ic.creditReceived + cashImpact;
  const totalCostToClose = -cashImpact;
  return { cashImpact, pnl, costPerShare, note: `提前平仓 IC [${reason}]，回购成本 $${totalCostToClose.toFixed(0)}，净 ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}` };
}

/** Iron Condor 回测终局：到期 intrinsic 结算，否则 B-S 买回并在同一结果内扣佣金。 */
export function finalizeIronCondor(input: {
  position: IronCondorPosition & { putWidth: number; callWidth: number };
  asOfDate: string;
  qqqClose: number;
  vix: number;
  pricing: IronCondorPricing;
  commission: number;
  vix3m?: number;
}): OverlaySettlementResult & { settled: boolean; costPerShare?: number } {
  const { position, asOfDate, qqqClose, vix, pricing, commission, vix3m } = input;
  if (position.expiry <= asOfDate) return { ...settleIronCondor(position, qqqClose), settled: true };
  const marked = closeIronCondorAtMark(position, asOfDate, qqqClose, vix, '回测结束', pricing, vix3m);
  const cashImpact = marked.cashImpact - commission;
  return {
    cashImpact,
    pnl: position.creditReceived + cashImpact,
    note: marked.note,
    settled: false,
    costPerShare: marked.costPerShare,
  };
}

export function evaluateIronCondorExit(input: {
  expiry: string;
  creditReceived: number;
  range20dHigh: number;
  range20dLow: number;
  mode: ICMode;
  exitDelta: number;
  rangeBufferPct: number;
  asOfDate: string;
  regime: MarketRegime;
  daysLeft: number;
  putDelta: number;
  callDelta: number;
  lowPrice: number;
  highPrice: number;
  unrealizedPnl: number;
  profitTakeEnabled: boolean;
  profitTarget: number;
}): string | null {
  const exits = evaluateExitConditions({ type: 'ic', expiry: input.expiry, credit: input.creditReceived, icMode: input.mode, openRangeHigh: input.range20dHigh, openRangeLow: input.range20dLow }, {
    asOfDate: input.asOfDate,
    regime: input.regime,
    dte: input.daysLeft,
    shortPutDelta: -input.putDelta,
    shortCallDelta: input.callDelta,
    qqqHigh: input.highPrice,
    qqqLow: input.lowPrice,
    unrealizedPnl: input.unrealizedPnl,
    profitTakeEnabled: input.profitTakeEnabled,
    profitTargetPct: input.profitTarget,
  }).filter((signal) => signal.auto && signal.severity === 'CLOSE');
  if (exits.some((signal) => signal.key === 'delta_stop')) {
    return `短腿 Delta 超限 Put Δ${(input.putDelta * 100).toFixed(0)}% Call Δ${(input.callDelta * 100).toFixed(0)}%（阈值 Δ${(input.exitDelta * 100).toFixed(0)}%）`;
  }
  if (exits.some((signal) => signal.key === 'range_breach')) {
    const high = input.range20dHigh * (1 + input.rangeBufferPct);
    const low = input.range20dLow * (1 - input.rangeBufferPct);
    return `QQQ ${input.highPrice > high ? '上破' : '下破'}20日区间边沿+缓冲 ${(input.highPrice > high ? high : low).toFixed(2)}`;
  }
  return exits.some((signal) => signal.key === 'profit_take')
    ? `提前止盈（达到 credit 的 ${(input.profitTarget * 100).toFixed(0)}%），腾出仓位再入场`
    : null;
}
