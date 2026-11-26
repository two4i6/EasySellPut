import { createRawFactor } from '../../../factor';
import type { FinancialFactor } from '../../../../types/factor';
import type { OverlayExecutionEffect } from './base';
import { dividendYieldForSymbol, effectiveVix, quoteOptionStrike } from '../backtest/mockOptions';

export type OptionLeg = { symbol: string; type: 'call' | 'put'; side: 'long' | 'short'; strike: number; expiry: string; quantity: number; contractMultiplier?: number; splitAdjustmentFactor?: number };
export type OptionPosition = { legs: readonly OptionLeg[]; openingCashImpact: number };
export type OptionPricing = { spreadMultiplier: number; skewSlope: number; riskFreeRate: number };
export type OptionLifecycleEffect = OverlayExecutionEffect;
export type OptionCloseResult = { cashImpact: number; pnl: number; note: string; costPerShare?: number };
export type OptionValuationMarket = {
  asOfDate: string;
  prices: Record<string, FinancialFactor<number>>;
  vix: FinancialFactor<number>;
  vix3m?: FinancialFactor<number>;
  splitAdjustmentFactors?: Record<string, FinancialFactor<number>>;
};

/** 回测成交与策略 proposal 共用的精确行权价查找。 */
export function findOptionContract<T extends { strike: number }>(contracts: readonly T[] | undefined, strike: number): T | undefined {
  return contracts?.find((contract) => contract.strike === strike);
}

/** 统一期权生命周期结果标签，供所有策略的回测成交记录复用。 */
export function optionOutcomeReasonKey(reason: string, isSettle: boolean): string {
  if (isSettle) return reason.includes('回测结束') ? 'final_forced_close' : 'expiry_settlement';
  const normalized = reason.toLowerCase();
  if (normalized.includes('回测结束') || normalized.includes('强制平仓')) return 'final_forced_close';
  if (normalized.includes('止盈') || normalized.includes('profit')) return 'profit_take';
  if (normalized.includes('概率风险参考线')) return 'probability_risk_reference';
  if (normalized.includes('概率兑现参考线')) return 'probability_realization_reference';
  if (normalized.includes('生存率路径退出') || normalized.includes('生存率退出')) {
    return normalized.includes('触碰') ? 'survival_touch' : 'survival_probability';
  }
  if (normalized.includes('delta') || normalized.includes('δ') || normalized.includes('方向止损')) return 'delta_stop';
  if (normalized.includes('跌穿') || normalized.includes('跌破') || normalized.includes('区间突破') || normalized.includes('breach')) return 'range_breach';
  if (normalized.includes('dte') || normalized.includes('接近到期')) return 'dte_exit';
  if (normalized.includes('逆方向亏损') || normalized.includes('止损') || normalized.includes('stop loss') || normalized.includes('stop_loss')) return 'stop_loss';
  return 'other';
}

export function createLegacyOptionMarket(input: { asOfDate: string; prices: Record<string, number>; vix: number; vix3m?: number; splitAdjustmentFactors?: Record<string, number> }): OptionValuationMarket {
  return {
    asOfDate: input.asOfDate,
    prices: Object.fromEntries(Object.entries(input.prices).map(([symbol, value]) => [symbol, createRawFactor(value, (price) => price > 0, 'backtest-market', `${symbol} 定价现货`)])),
    vix: createRawFactor(input.vix, (value) => value > 5 && value < 150, 'backtest-market', '期权定价 VIX'),
    vix3m: input.vix3m == null ? undefined : createRawFactor(input.vix3m, (value) => value > 5 && value < 150, 'backtest-market', '期权定价 VIX3M'),
    splitAdjustmentFactors: input.splitAdjustmentFactors && Object.fromEntries(Object.entries(input.splitAdjustmentFactors).map(([symbol, value]) => [symbol, createRawFactor(value, factor => Number.isFinite(factor) && factor > 0, 'backtest-market', `${symbol} 拆股因子`)])),
  };
}

function daysLeft(expiry: string, asOfDate: string): number {
  return Math.max((new Date(expiry).getTime() - new Date(asOfDate).getTime()) / 86400000, 0);
}

function quoteLeg(leg: OptionLeg, market: OptionValuationMarket, pricing: OptionPricing): { bid: number; ask: number } {
  const spot = market.prices[leg.symbol];
  if (!spot || spot.confidence === 0 || market.vix.confidence === 0) throw new Error(`期权盯市数据缺失: ${leg.symbol}`);
  const days = daysLeft(leg.expiry, market.asOfDate);
  const splitFactor = market.splitAdjustmentFactors?.[leg.symbol]?.value ?? 1;
  const rawSpot = spot.value * splitFactor;
  const rawStrike = leg.strike * splitFactor;
  const quotes = quoteOptionStrike({symbol:leg.symbol,rawSpot,rawStrike,pricingYears:Math.max(days / 365, 1 / 365),
    effectiveVol:effectiveVix(market.vix.value, market.vix3m?.confidence ? market.vix3m.value : undefined, days),
    riskFreeRate:pricing.riskFreeRate,skewSlope:pricing.skewSlope,spreadMultiplier:pricing.spreadMultiplier,
    dividendYield:dividendYieldForSymbol(leg.symbol)});
  const quote = quotes[leg.type];
  return { bid: quote.bid / splitFactor, ask: quote.ask / splitFactor };
}

/** 平仓现金流：多头按 bid 卖出，空头按 ask 买回；佣金由执行层统一计入。 */
export function closeOptionPosition(position: OptionPosition, market: OptionValuationMarket, pricing: OptionPricing): { cashImpact: number; pnl: number; costPerShare: number; legQuotes: Array<{ bid: number; ask: number }> } {
  let cashImpact = 0;
  let costPerShare = 0;
  const legQuotes: Array<{ bid: number; ask: number }> = [];
  for (const leg of position.legs) {
    const quote = quoteLeg(leg, market, pricing);
    legQuotes.push(quote);
    const perShare = leg.side === 'long' ? quote.bid : -quote.ask;
    cashImpact += perShare * (leg.contractMultiplier ?? 100) * leg.quantity;
    costPerShare += perShare * leg.quantity;
  }
  return { cashImpact, pnl: position.openingCashImpact + cashImpact, costPerShare: -costPerShare, legQuotes };
}

/** 执行层唯一扣减佣金与市场冲击的出口，避免现金流与 PnL 分别修正。 */
export function applyOptionExecution(result: { cashImpact: number; pnl: number }, commission = 0, impact = 0): OptionLifecycleEffect {
  const cost = commission + impact;
  return { cashDelta: result.cashImpact - cost, pnl: result.pnl - cost };
}

/** 回测平仓时序的唯一选择器：次日开盘、两点中值或对持仓最不利价格。 */
export function selectOptionCloseFill<T extends OptionCloseResult>(mode: 'next_open' | 'mid' | 'worst_of', nextOpen: T, signalClose: T): T {
  if (mode === 'next_open') return nextOpen;
  if (mode === 'worst_of') return nextOpen.cashImpact < signalClose.cashImpact ? nextOpen : signalClose;
  return {
    ...nextOpen,
    cashImpact: (nextOpen.cashImpact + signalClose.cashImpact) / 2,
    pnl: (nextOpen.pnl + signalClose.pnl) / 2,
    ...(nextOpen.costPerShare != null && signalClose.costPerShare != null ? { costPerShare: (nextOpen.costPerShare + signalClose.costPerShare) / 2 } : {}),
  } as T;
}

/** 已排程平仓的共同执行：填价模式、佣金和冲击只在这里合并。 */
export function executeScheduledOptionClose<T extends OptionCloseResult>(input: {
  mode: 'next_open' | 'mid' | 'worst_of';
  nextOpen: T;
  signalClose: T;
  commission: number;
  impact: number;
}): { chosen: T; effect: OptionLifecycleEffect; netPnl: number } {
  const chosen = selectOptionCloseFill(input.mode, input.nextOpen, input.signalClose);
  return {
    chosen,
    effect: applyOptionExecution(chosen, input.commission, input.impact),
    // 保持旧分步减法顺序，供 breach 和日志文案保持冻结结果一致。
    netPnl: chosen.pnl - input.commission - input.impact,
  };
}

/** 期权单边冲击（每股价格单位）；flat 模式严格返回 0。 */
export function optionExecutionImpact(input: { enabled: boolean; contracts: number; strikeVolume: number; vix: number }): number {
  if (!input.enabled || input.contracts <= 0) return 0;
  const volume = input.strikeVolume > 0 ? input.strikeVolume : 500;
  const stress = 1 + Math.min(1, Math.max(0, (input.vix - 20) / 40));
  return Math.min(.5, .05 * (input.contracts / volume) * stress);
}

/** 多腿期权单边佣金；到期结算是否收费由执行层决定是否调用。 */
export function optionCommission(legs: number, quantity: number, perContract: number): number {
  return Math.max(0, legs) * Math.max(0, quantity) * Math.max(0, perContract);
}

/** 两腿信用价差的开仓成交：数量先受流动性限制，再扣冲击与佣金。 */
export function openCreditSpreadFill(input: {
  requestedQuantity: number;
  maxQuantity: number;
  shortBid?: number;
  longAsk?: number;
  strikeVolume: number;
  vix: number;
  impactEnabled: boolean;
  commissionPerContract: number;
}): { quantity: number; creditPerContract: number; totalCredit: number } {
  const quantity = Math.max(0, Math.min(input.requestedQuantity, input.maxQuantity));
  const grossCredit = input.shortBid != null && input.longAsk != null
    ? (input.shortBid - input.longAsk) * 100
    : 0;
  const creditPerContract = grossCredit - optionExecutionImpact({
    enabled: input.impactEnabled,
    contracts: quantity,
    strikeVolume: input.strikeVolume,
    vix: input.vix,
  }) * 100;
  return {
    quantity,
    creditPerContract,
    totalCredit: creditPerContract * quantity - optionCommission(2, quantity, input.commissionPerContract),
  };
}

/** 用次日真实成交后的单张最大损失重新缩量；预算由 proposal 已有风险额度提供。 */
export function clampDefinedRiskQuantity(requested: number, budgetDollars: number, maxLossPerContract: number): number {
  if (requested <= 0 || budgetDollars <= 0 || !Number.isFinite(maxLossPerContract) || maxLossPerContract <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(requested), Math.floor(budgetDollars / maxLossPerContract)));
}

/** 到期按 intrinsic 结算，无剩余时间价值与买卖价差。 */
export function settleOptionPosition(position: OptionPosition, market: OptionValuationMarket): { cashImpact: number; pnl: number } {
  let cashImpact = 0;
  for (const leg of position.legs) {
    const spot = market.prices[leg.symbol];
    if (!spot || spot.confidence === 0) throw new Error(`期权结算数据缺失: ${leg.symbol}`);
    const intrinsic = leg.type === 'call' ? Math.max(spot.value - leg.strike, 0) : Math.max(leg.strike - spot.value, 0);
    cashImpact += (leg.side === 'long' ? intrinsic : -intrinsic) * (leg.contractMultiplier ?? 100) * leg.quantity;
  }
  return { cashImpact, pnl: position.openingCashImpact + cashImpact };
}
