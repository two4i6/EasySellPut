/**
 * 期权策略计算工具函数
 * 
 * 包含所有与期权策略分析相关的数学计算函数:
 * - 盈亏计算 (PnL)
 * - 希腊字母聚合计算
 * - 到期时间计算
 * - 实/虚值判断
 * - 损益平衡点计算
 * - 行权价百分比计算
 */

import type { Leg, Greeks, StrategyWithLegs, StrategyType, OptionType, StrategyRecognitionContext, StrategyRecognitionResult } from '../types/strategy';
import { blackScholesEngine } from '../lib/engines';

/**
 * 使用 Black-Scholes 模型计算期权希腊字母
 * 代理到 BlackScholesEngine，保留此函数签名以维持向后兼容。
 */
export const calculateOptionGreeks = (
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  type: OptionType
): Greeks => {
  if (T <= 0) {
    return type === 'Call'
      ? { delta: S > K ? 1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 }
      : { delta: S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const bsType = type === 'Call' ? 'call' : 'put';
  const g = blackScholesEngine.price({ S, K, T, r, sigma, type: bsType });
  return { price: g.price, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, rho: g.rho };
};

/**
 * 计算单个期权腿的盈亏
 * @param leg 期权腿对象
 * @returns 盈亏金额（美元）
 */
export const calculateLegPnL = (leg: Leg): number => {
  const multiplier = 100;  // 期权合约倍数
  const currentPrice = leg.currentPrice.value;
  const priceDiff = leg.side === 'Sell' 
    ? leg.entryPrice - currentPrice   // 卖出时，价格下跌盈利
    : currentPrice - leg.entryPrice;  // 买入时，价格上涨盈利
  return priceDiff * leg.quantity * multiplier;
};

/**
 * 计算整个策略的总盈亏
 * @param strategy 完整策略对象
 * @returns 策略总盈亏（美元）
 */
export const calculateStrategyPnL = (strategy: StrategyWithLegs): number => {
  return strategy.legs.reduce((total, leg) => total + calculateLegPnL(leg), 0);
};

/**
 * 计算策略的净希腊字母 (支持实时计算)
 * @param legs 期权腿数组
 * @param currentUnderlyingPrice 标的资产当前价格（可选，用于实时重算）
 * @param r 无风险利率（可选，默认 4.5%）
 * @param atmIV 标的资产的实时 ATM IV (可选，由外部获取)
 * @returns 聚合后的希腊字母指标
 */
export const calculateNetGreeks = (
  legs: Leg[], 
  currentUnderlyingPrice?: number,
  r: number = 0.045,
  atmIV?: number
): Greeks => {
  return legs.reduce((total, leg) => {
    const factor = leg.side === 'Sell' ? -1 : 1;  // 卖出为负，买入为正
    const qty = leg.quantity;
    
    // IV 优先级: 1. Leg 自身的 IV (针对性) -> 2. 标的资产实时的 ATM IV -> 3. 25% 默认值
    const legIv = leg.iv.value;
    const effectiveIv = legIv > 0 ? legIv : (atmIV && atmIV > 0 ? atmIV : 0.25);
    
    let legGreeks = leg.greeks.value;
    
    // 如果提供了当前价格，进行实时重算
    if (currentUnderlyingPrice && currentUnderlyingPrice > 0) {
      const dte = calculateDTE(leg.expiry);
      const T = dte / 365; // 年化时间
      legGreeks = calculateOptionGreeks(
        currentUnderlyingPrice,
        leg.strike,
        T,
        effectiveIv,
        r,
        leg.type
      );
    }
    
    const multiplier = 1;
    return {
      delta: total.delta + (legGreeks.delta * factor * qty * multiplier),
      theta: total.theta + (legGreeks.theta * factor * qty * multiplier),
      gamma: total.gamma + (legGreeks.gamma * factor * qty * multiplier),
      vega: total.vega + (legGreeks.vega * factor * qty * multiplier),
      rho: total.rho + (legGreeks.rho * factor * qty * multiplier),
    };
  }, { delta: 0, theta: 0, gamma: 0, vega: 0, rho: 0 });
};

/**
 * 计算到期天数 (Days to Expiration)
 * @param expiry 到期日期字符串（ISO格式）
 * @returns 剩余天数，最小为0
 * 
 * 用于计算期权剩余时间价值，是影响 Theta 的重要因素
 */
export const calculateDTE = (expiry: string): number => {
  if (!expiry) return 0;
  // 将 "YYYY-MM-DD" 解析为本地时间（避免 ISO 纯日期被解析为 UTC 导致时区偏移）
  const parts = expiry.split('T')[0].split('-').map(Number);
  const expiryDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffTime = expiryDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

/**
 * 判断期权是否为实值 (In-The-Money)
 * @param leg 期权腿对象
 * @param currentUnderlyingPrice 标的资产当前价格
 * @returns 是否为实值期权
 * 
 * 判断逻辑:
 * - 看涨期权 (Call): 当前价 > 行权价 为实值
 * - 看跌期权 (Put): 当前价 < 行权价 为实值
 */
export const isITM = (leg: Leg, currentUnderlyingPrice: number): boolean => {
  if (leg.type === 'Call') {
    return currentUnderlyingPrice > leg.strike;
  } else {
    return currentUnderlyingPrice < leg.strike;
  }
};

/**
 * 计算策略的损益平衡点
 * @param strategy 完整策略对象
 * @returns 损益平衡点数组（可能有多个）
 * 
 * 注意: 这是一个简化版本，仅适用于单腿策略
 * 复杂策略（如价差策略）需要更精细的数学模型
 * 
 * 计算逻辑:
 * - 计算净权利金收入/支出
 * - 根据期权类型和方向计算平衡点
 */
export const calculateBreakEven = (strategy: StrategyWithLegs): number[] => {
  // 计算净权利金（收入减去支出）
  const netPremium = strategy.legs.reduce((total, leg) => {
    const factor = leg.side === 'Sell' ? 1 : -1;  // 卖出收入为正，买入支出为负
    return total + (leg.entryPrice * factor);
  }, 0);

  // 仅支持单腿策略的简单计算
  if (strategy.legs.length === 1) {
    const leg = strategy.legs[0];
    if (leg.type === 'Call') {
      // 看涨期权: 平衡点 = 行权价 + 净权利金支出
      return leg.side === 'Sell' ? [leg.strike + netPremium] : [leg.strike + Math.abs(netPremium)];
    } else {
      // 看跌期权: 平衡点 = 行权价 - 净权利金支出
      return leg.side === 'Sell' ? [leg.strike - netPremium] : [leg.strike - Math.abs(netPremium)];
    }
  }

  // 多腿策略的平衡点计算更复杂，这里暂不实现
  return [];
};

/**
 * 计算年化收益率 (Annualized Return)
 * @param profit 预期利润（收到的权利金）
 * @param capital 投入资金（如行权价或价差宽度）
 * @param dte 到期天数
 * @returns 年化百分比 (如 0.15 表示 15%)
 * 
 * 计算公式: (利润 / 投入资金) * (365 / 到期天数)
 */
export const calculateAnnualizedReturn = (profit: number, capital: number, dte: number): number => {
  if (capital <= 0 || dte <= 0) return 0;
  // 简单的线性年化计算
  return (profit / capital) * (365 / dte);
};

/**
 * 计算组合级别的年化Greeks
 * @param legs 期权腿数组
 * @returns 年化的Greeks指标
 * 
 * 年化逻辑:
 * - Delta: 不需要年化（表示对标的价格的敏感性）
 * - Gamma: 不需要年化（表示Delta的变化率）
 * - Theta: 已经是日Theta，乘以365得到年化
 * - Vega: 不需要年化（表示对波动率的敏感性）
 */
export const calculateAnnualizedGreeks = (legs: Leg[]): Greeks & { annualizedTheta: number } => {
  const netGreeks = calculateNetGreeks(legs);
  
  return {
    ...netGreeks,
    annualizedTheta: netGreeks.theta * 365  // 将日Theta年化
  };
};

/**
 * 计算策略的总权利金（净收入/支出）
 * @param legs 期权腿数组
 * @returns 净权利金收入（正数为收入，负数为支出）
 */
export const calculateNetPremium = (legs: Leg[]): number => {
  return legs.reduce((total, leg) => {
    const multiplier = 100;  // 期权合约倍数
    const factor = leg.side === 'Sell' ? 1 : -1;  // 卖出收入为正，买入支出为负
    return total + (leg.entryPrice * factor * leg.quantity * multiplier);
  }, 0);
};

function optionPayoffAtExpiry(legs: Leg[], underlyingPrice: number): number {
  return legs.reduce((total, leg) => {
    const intrinsic = leg.type === 'Call'
      ? Math.max(0, underlyingPrice - leg.strike)
      : Math.max(0, leg.strike - underlyingPrice);
    const payoff = leg.side === 'Sell'
      ? leg.entryPrice - intrinsic
      : intrinsic - leg.entryPrice;
    return total + payoff * leg.quantity * 100;
  }, 0);
}

function underlyingAwarePayoffAtExpiry(legs: Leg[], underlyingPrice: number, context: StrategyRecognitionContext): number {
  const stockQuantity = context.underlyingQuantity ?? 0;
  const stockEntryPrice = context.underlyingEntryPrice ?? 0;
  return optionPayoffAtExpiry(legs, underlyingPrice) + (underlyingPrice - stockEntryPrice) * stockQuantity;
}

function calculateOptionStructureMaxRisk(legs: Leg[]): number {
  const strikes = [...new Set(legs.map(leg => leg.strike).filter(Number.isFinite))].sort((left, right) => left - right);
  if (strikes.length === 0) return 0;
  const prices = [0, ...strikes, strikes.at(-1)! + Math.max(1, strikes.at(-1)! * 0.01)];
  const payoffs = prices.map(price => optionPayoffAtExpiry(legs, price));
  return Math.max(...payoffs.map(payoff => -payoff), 0);
}

/**
 * 计算策略的最大风险
 * @param legs 期权腿数组
 * @returns 最大可能损失金额，如果是无限风险则返回 Infinity
 */
export const calculateMaxRisk = (legs: Leg[], context: StrategyRecognitionContext = {}): number => {
  if (legs.length === 0) return 0;

  const netPremium = calculateNetPremium(legs);
  const strategyType = identifyStrategyType(legs, context);
  const calls = legs.filter(l => l.type === 'Call').sort((a, b) => (a.strike || 0) - (b.strike || 0));
  const puts = legs.filter(l => l.type === 'Put').sort((a, b) => (a.strike || 0) - (b.strike || 0));
  const sells = legs.filter(l => l.side === 'Sell');
  const buys = legs.filter(l => l.side === 'Buy');

  if (context.underlyingQuantity !== undefined && context.underlyingEntryPrice !== undefined
    && ['Covered Call', 'Collar', 'Put Spread Collar', 'Conversion', 'Reversal'].includes(strategyType)) {
    const strikes = [...new Set(legs.map(leg => leg.strike).filter(Number.isFinite))].sort((left, right) => left - right);
    const prices = [0, ...strikes, (strikes.at(-1) ?? context.underlyingEntryPrice) + Math.max(1, (strikes.at(-1) ?? context.underlyingEntryPrice) * 0.01)];
    const payoffs = prices.map(price => underlyingAwarePayoffAtExpiry(legs, price, context));
    return Math.max(...payoffs.map(payoff => -payoff), 0);
  }

  // 1. 检查无限风险 (Unlimited Risk)
  const shortCalls = sells.filter(l => l.type === 'Call');
  const longCalls = buys.filter(l => l.type === 'Call');
  if (shortCalls.length > 0) {
    const totalShortCallQty = shortCalls.reduce((sum, l) => sum + l.quantity, 0);
    const totalLongCallQty = longCalls.reduce((sum, l) => sum + l.quantity, 0);
    // 裸卖或卖多买少
    if (totalLongCallQty < totalShortCallQty) return Infinity;
  }

  const shortPuts = sells.filter(l => l.type === 'Put');
  const longPuts = buys.filter(l => l.type === 'Put');
  if (shortPuts.length > 0) {
    const totalShortPutQty = shortPuts.reduce((sum, l) => sum + l.quantity, 0);
    const totalLongPutQty = longPuts.reduce((sum, l) => sum + l.quantity, 0);
    // 如果没有 Long Put 保护且不是无限风险（虽然股价最低为0，但在卖方视角下通常看作固定最大风险）
    if (totalLongPutQty < totalShortPutQty) {
      // 实际上 Short Put 的最大风险是 K * 100 - Premium，但在复杂的未对等组合中可能难以简单加总
      // 这里先简单处理单腿或对等卖出的情况
      if (legs.length === 1 && legs[0].side === 'Sell' && legs[0].type === 'Put') {
        return (legs[0].strike * 100 * legs[0].quantity) - netPremium;
      }
      return Infinity; // 非标准定义的卖权风险暂定为 Infinity 以示警
    }
  }

  // 2. 计算有限风险 (Defined Risk)
  
  // Debit Strategies (支付权利金)
  if (netPremium < 0) {
    return Math.abs(netPremium);
  }

  // Credit Strategies (收入权利金)
  if (strategyType === 'Credit Spread' || strategyType === 'Put Credit Spread' || strategyType === 'Call Credit Spread') {
    if (calls.length === 2 && calls[0].strike !== calls[1].strike) {
      const width = Math.abs(calls[1].strike - calls[0].strike);
      return Math.max((width * 100 * Math.min(calls[0].quantity, calls[1].quantity)) - netPremium, 0);
    }
    if (puts.length === 2 && puts[0].strike !== puts[1].strike) {
      const width = Math.abs(puts[1].strike - puts[0].strike);
      return Math.max((width * 100 * Math.min(puts[0].quantity, puts[1].quantity)) - netPremium, 0);
    }
  }

  if (strategyType === 'Iron Condor' || strategyType === 'Iron Butterfly') {
    if (puts.length === 2 && calls.length === 2) {
      // 分别计算两边的宽度：Put 侧和 Call 侧
      const sortedPuts = puts.sort((a, b) => (a.strike || 0) - (b.strike || 0));
      const sortedCalls = calls.sort((a, b) => (a.strike || 0) - (b.strike || 0));
      
      const putWidth = Math.abs((sortedPuts[1].strike || 0) - (sortedPuts[0].strike || 0));
      const callWidth = Math.abs((sortedCalls[1].strike || 0) - (sortedCalls[0].strike || 0));
      
      const maxWidth = Math.max(putWidth, callWidth);
      const minQty = Math.min(...legs.map(l => l.quantity || 1));
      
      if (maxWidth > 0) {
        return Math.max((maxWidth * 100 * minQty) - netPremium, 0);
      }
    }
  }

  if (strategyType === 'Butterfly') {
    const strikes = Array.from(new Set(legs.map(l => l.strike))).sort((a, b) => a - b);
    if (strikes.length >= 2) {
      const width = strikes[1] - strikes[0];
      return Math.max((width * 100 * Math.min(...legs.map(l => l.quantity))) - netPremium, 0);
    }
  }

  if (strategyType === 'Jade Lizard') {
    if (puts.length >= 1 && calls.length >= 2) {
      const shortPut = puts.find(p => p.side === 'Sell')!;
      const callSpreadWidth = Math.abs(calls[1].strike - calls[0].strike);
      const downsideRisk = Math.max((shortPut.strike * 100 * shortPut.quantity) - netPremium, 0);
      const upsideRisk = Math.max((callSpreadWidth * 100 * Math.min(calls[0].quantity, calls[1].quantity)) - netPremium, 0);
      return Math.max(downsideRisk, upsideRisk);
    }
  }

  if (['Condor', 'Broken-Wing Butterfly', 'Box Spread', 'Double Diagonal', 'Call Backspread', 'Put Backspread', 'Synthetic Long Stock'].includes(strategyType)) {
    return calculateOptionStructureMaxRisk(legs);
  }

  if (strategyType === 'Synthetic Short Stock') return Infinity;

  // 默认回退：如果是自定义策略且风险有限
  const strikes = legs.map(leg => leg.strike || 0).sort((a, b) => a - b);
  if (strikes.length >= 2) {
    const maxSpread = Math.max(...strikes) - Math.min(...strikes);
    const minQty = Math.min(...legs.map(l => l.quantity || 1));
    return Math.max((maxSpread * 100 * minQty) - netPremium, 0);
  }

  return 0;
  };

  /**
  * 计算策略的最大潜在利润
  * @param legs 期权腿数组
  * @returns 最大可能利润金额，如果是无限利润则返回 Infinity
  */
  export const calculateMaxProfit = (legs: Leg[]): number => {
  if (legs.length === 0) return 0;

  const netPremium = calculateNetPremium(legs);
  const strategyType = identifyStrategyType(legs);
  const calls = legs.filter(l => l.type === 'Call').sort((a, b) => (a.strike || 0) - (b.strike || 0));
  const puts = legs.filter(l => l.type === 'Put').sort((a, b) => (a.strike || 0) - (b.strike || 0));
  const sells = legs.filter(l => l.side === 'Sell');
  const buys = legs.filter(l => l.side === 'Buy');

  // 1. 无限利润检查 (Unlimited Profit Check)
  const longCalls = buys.filter(l => l.type === 'Call');
  const shortCalls = sells.filter(l => l.type === 'Call');
  if (longCalls.length > 0 && longCalls.length > shortCalls.length) return Infinity;

  const longPuts = buys.filter(l => l.type === 'Put');
  const shortPuts = sells.filter(l => l.type === 'Put');
  if (longPuts.length > 0 && longPuts.length > shortPuts.length) return Infinity;

  // 2. 有限利润计算 (Defined Profit Calculation)

  // 收权利金策略 (Credit Strategies) - 最大利润通常是净权利金
  if (netPremium > 0) {
    return netPremium;
  }

  // 支权利金策略 (Debit Strategies)
  if (netPremium < 0) {
    if (strategyType === 'Debit Spread' || strategyType === 'Put Debit Spread' || strategyType === 'Call Debit Spread') {
      if (calls.length === 2 && calls[0].strike !== calls[1].strike) {
        const width = Math.abs(calls[1].strike - calls[0].strike);
        return Math.max((width * 100 * Math.min(calls[0].quantity, calls[1].quantity)) - Math.abs(netPremium), 0);
      }
      if (puts.length === 2 && puts[0].strike !== puts[1].strike) {
        const width = Math.abs(puts[1].strike - puts[0].strike);
        return Math.max((width * 100 * Math.min(puts[0].quantity, puts[1].quantity)) - Math.abs(netPremium), 0);
      }
    }

    if (strategyType === 'Butterfly') {
      const strikes = Array.from(new Set(legs.map(l => l.strike))).sort((a, b) => a - b);
      if (strikes.length >= 2) {
        const width = strikes[1] - strikes[0];
        return Math.max((width * 100 * Math.min(...legs.map(l => l.quantity))) - Math.abs(netPremium), 0);
      }
    }
  }

  return Math.max(netPremium, 0);
  };

  /**
  * 计算策略的年化收益率（基于组合）
 * @param strategy 完整策略对象
 * @returns 年化收益率百分比
 */
export const calculateStrategyAnnualizedReturn = (strategy: StrategyWithLegs): number => {
  const netPremium = calculateNetPremium(strategy.legs);
  const maxRisk = calculateMaxRisk(strategy.legs, { underlyingQuantity: strategy.underlyingQuantity, underlyingEntryPrice: strategy.underlyingEntryPrice });
  
  // 取最短到期时间作为策略到期时间
  const minDTE = Math.min(...strategy.legs.map(leg => calculateDTE(leg.expiry)));
  
  if (maxRisk <= 0 || minDTE <= 0) return 0;
  
  // 对于收权利金策略，年化收益率 = (收到权利金 / 最大风险) * (365 / 到期天数)
  if (netPremium > 0) {
    return (netPremium / maxRisk) * (365 / minDTE) * 100;
  }
  
  return 0;
};

/**
 * 保证金计算接口
 */
export interface MarginRequirement {
  initialMargin: number;        // 初始保证金
  maintenanceMargin: number;    // 维持保证金
  buyingPowerReduction: number; // 购买力占用
  marginType: 'cash' | 'naked' | 'covered' | 'spread' | 'protective';
  description: string;          // 保证金计算说明
}

/**
 * 计算单个期权腿的保证金需求
 * @param leg 期权腿对象
 * @param underlyingPrice 标的资产当前价格
 * @returns 保证金需求
 */
export const calculateLegMargin = (leg: Leg, underlyingPrice: number): MarginRequirement => {
  const multiplier = 100; // 期权合约倍数
  const strike = leg.strike;
  const quantity = leg.quantity;
  
  if (leg.side === 'Buy') {
    // 买入期权：只需支付权利金，无额外保证金
    const premium = leg.entryPrice * quantity * multiplier;
    return {
      initialMargin: premium,
      maintenanceMargin: premium,
      buyingPowerReduction: premium,
      marginType: 'cash',
      description: `买入${leg.type === 'Call' ? '看涨' : '看跌'}期权，支付权利金`
    };
  }
  
  // 卖出期权保证金计算
  const premium = leg.entryPrice * quantity * multiplier;
  let initialMargin: number;
  let description: string;
  let marginType: 'naked' | 'covered' = 'naked';
  
  if (leg.type === 'Call') {
    // 卖出看涨期权
    if (underlyingPrice >= strike) {
      // 实值看涨期权
      initialMargin = Math.max(
        premium + 0.2 * underlyingPrice * quantity * multiplier,
        premium + 0.1 * underlyingPrice * quantity * multiplier
      );
    } else {
      // 虚值看涨期权
      const otmAmount = (strike - underlyingPrice) * quantity * multiplier;
      initialMargin = Math.max(
        premium + 0.2 * underlyingPrice * quantity * multiplier - otmAmount,
        premium + 0.1 * underlyingPrice * quantity * multiplier
      );
    }
    description = `卖出看涨期权保证金（${strike > underlyingPrice ? '虚值' : '实值'}）`;
  } else {
    // 卖出看跌期权
    if (underlyingPrice <= strike) {
      // 实值看跌期权
      initialMargin = Math.max(
        premium + 0.2 * strike * quantity * multiplier,
        premium + 0.1 * strike * quantity * multiplier
      );
    } else {
      // 虚值看跌期权
      const otmAmount = (underlyingPrice - strike) * quantity * multiplier;
      initialMargin = Math.max(
        premium + 0.2 * strike * quantity * multiplier - otmAmount,
        premium + 0.1 * strike * quantity * multiplier
      );
    }
    description = `卖出看跌期权保证金（${strike < underlyingPrice ? '虚值' : '实值'}）`;
  }
  
  return {
    initialMargin,
    maintenanceMargin: initialMargin * 0.75, // 维持保证金通常为初始保证金的75%
    buyingPowerReduction: initialMargin,
    marginType,
    description
  };
};

/**
 * 计算策略的总保证金需求
 * @param strategy 完整策略对象
 * @param underlyingPrice 标的资产当前价格
 * @returns 策略保证金需求
 */
export const calculateStrategyMargin = (strategy: StrategyWithLegs, underlyingPrice: number): MarginRequirement & {
  legMargins: MarginRequirement[];
  netCredit: number;
  maxLoss: number;
  marginEfficiency: number;
} => {
  const legMargins = strategy.legs.map(leg => calculateLegMargin(leg, underlyingPrice));
  
  // 检查是否为特殊策略（可以享受保证金优惠）
  const strategyMargin = calculateStrategySpecificMargin(strategy, underlyingPrice, legMargins);
  
  const totalInitialMargin = strategyMargin !== null ? strategyMargin : legMargins.reduce((total, margin) => total + margin.initialMargin, 0);
  const totalMaintenanceMargin = strategyMargin !== null ? strategyMargin : legMargins.reduce((total, margin) => total + margin.maintenanceMargin, 0);
  const totalBuyingPowerReduction = strategyMargin !== null ? strategyMargin : legMargins.reduce((total, margin) => total + margin.buyingPowerReduction, 0);
  
  const netCredit = calculateNetPremium(strategy.legs);
  const maxLoss = calculateMaxRisk(strategy.legs, { underlyingQuantity: strategy.underlyingQuantity, underlyingEntryPrice: strategy.underlyingEntryPrice });
  const marginEfficiency = netCredit > 0 && totalBuyingPowerReduction > 0 ? netCredit / totalBuyingPowerReduction : 0;
  
  let marginType: 'cash' | 'naked' | 'covered' | 'spread' | 'protective' = 'naked';
  let description = '期权组合保证金';
  
  const strategyType = identifyStrategyType(strategy.legs, { underlyingQuantity: strategy.underlyingQuantity });

  // 识别策略类型用于描述
  if (strategyType === 'Covered Call') {
    marginType = 'covered';
    description = 'Covered Call 正股覆盖保证金';
  } else if (['Collar', 'Put Spread Collar'].includes(strategyType)) {
    marginType = 'protective';
    description = `${strategyType} 保护结构保证金`;
  } else if (strategyType.includes('Spread') || ['Condor', 'Broken-Wing Butterfly', 'Double Diagonal', 'Iron Condor', 'Iron Butterfly', 'Box Spread', 'Conversion', 'Reversal'].includes(strategyType)) {
    marginType = 'spread';
    description = `${strategyType} 策略保证金`;
  } else if (strategyType === 'Straddle' || strategyType === 'Strangle') {
    marginType = 'naked';
    description = `${strategyType} 策略保证金`;
  }
  
  return {
    initialMargin: totalInitialMargin,
    maintenanceMargin: totalMaintenanceMargin,
    buyingPowerReduction: totalBuyingPowerReduction,
    marginType,
    description,
    legMargins,
    netCredit,
    maxLoss,
    marginEfficiency
  };
};

/**
 * 计算特定策略的保证金优惠
 * @param strategy 策略对象
 * @param underlyingPrice 标的价格
 * @param legMargins 单腿保证金数组
 * @returns 优化后的保证金需求（如果适用）
 */
function calculateStrategySpecificMargin(
  strategy: StrategyWithLegs, 
  underlyingPrice: number, 
  legMargins: MarginRequirement[]
): number | null {
  const { legs, type } = strategy;
  
  // 0. 处理 Cash Secured Put (CSP) 或 Wheel (当其为卖出 Put 时)
  if (type === 'CASH_SECURED_PUT' || (legs.length === 1 && legs[0].side === 'Sell' && legs[0].type === 'Put')) {
    const leg = legs[0];
    const premium = calculateNetPremium(legs);
    // 保证金 = 行权价 * 数量 * 100 - 收到的权利金
    return Math.max(leg.strike * leg.quantity * 100 - premium, 0);
  }

  const contextualType = identifyStrategyType(legs, { underlyingQuantity: strategy.underlyingQuantity });
  if (contextualType === 'Covered Call' && (strategy.underlyingQuantity ?? 0) >= legs.filter(leg => leg.side === 'Sell' && leg.type === 'Call').reduce((total, leg) => total + leg.quantity * 100, 0)) {
    return 0;
  }

  if (legs.length < 2) return null;

  const strategyType = identifyStrategyType(legs, { underlyingQuantity: strategy.underlyingQuantity });
  const netCredit = calculateNetPremium(legs);

  // 1. 垂直价差 (Vertical Spread)
  if (strategyType === 'Credit Spread' || strategyType === 'Debit Spread' || 
      strategyType === 'Put Credit Spread' || strategyType === 'Call Credit Spread' || 
      strategyType === 'Put Debit Spread' || strategyType === 'Call Debit Spread') {
    if (legs.length === 2 && legs[0].type === legs[1].type && legs[0].side !== legs[1].side) {
      const strikeWidth = Math.abs(legs[0].strike - legs[1].strike);
      if (strikeWidth > 0) {
        const margin = (strikeWidth * 100 * Math.min(legs[0].quantity, legs[1].quantity));
        const isCredit = strategyType === 'Credit Spread' || strategyType === 'Put Credit Spread' || strategyType === 'Call Credit Spread';
        return isCredit ? Math.max(margin - netCredit, 0) : margin;
      }
    }
  }

  // 2. 跨式/宽跨式 (Straddle / Strangle)
  if (strategyType === 'Straddle' || strategyType === 'Strangle') {
    // 保证金 = 两腿中保证金较高者 + 另一腿的权利金
    if (legMargins.length === 2) {
      const m1 = legMargins[0].initialMargin;
      const m2 = legMargins[1].initialMargin;
      const p1 = Math.abs(legs[0].entryPrice * legs[0].quantity * 100);
      const p2 = Math.abs(legs[1].entryPrice * legs[1].quantity * 100);
      
      return Math.max(m1 + p2, m2 + p1);
    }
  }

  // 3. 铁鹰/铁蝴蝶 (Iron Condor / Iron Butterfly)
  if (strategyType === 'Iron Condor' || strategyType === 'Iron Butterfly') {
    const puts = legs.filter(l => l.type === 'Put').sort((a, b) => (a.strike || 0) - (b.strike || 0));
    const calls = legs.filter(l => l.type === 'Call').sort((a, b) => (a.strike || 0) - (b.strike || 0));
    
    if (puts.length === 2 && calls.length === 2) {
      const putWidth = Math.abs((puts[1].strike || 0) - (puts[0].strike || 0));
      const callWidth = Math.abs((calls[1].strike || 0) - (calls[0].strike || 0));
      const maxWidth = Math.max(putWidth, callWidth);
      const minQty = Math.min(...legs.map(l => l.quantity || 1));
      
      if (maxWidth > 0) {
        // 保证金 = 最大价差宽度 * 100 - 总权利金
        return Math.max((maxWidth * 100 * minQty) - netCredit, 0);
      }
    }
  }

  if (['Condor', 'Broken-Wing Butterfly', 'Box Spread', 'Double Diagonal', 'Call Backspread', 'Put Backspread'].includes(strategyType)) {
    return calculateMaxRisk(legs, { underlyingQuantity: strategy.underlyingQuantity, underlyingEntryPrice: strategy.underlyingEntryPrice });
  }

  // 4. 玉蜥蜴 (Jade Lizard)
  if (strategyType === 'Jade Lizard') {
    const puts = legs.filter(l => l.type === 'Put');
    const calls = legs.filter(l => l.type === 'Call').sort((a, b) => a.strike - b.strike);
    
    if (puts.length === 1 && calls.length === 2) {
      const shortPutMargin = legMargins.find((_, i) => legs[i].type === 'Put')!.initialMargin;
      const callSpreadWidth = Math.abs(calls[1].strike - calls[0].strike);
      const callSpreadMargin = (callSpreadWidth * 100 * Math.min(calls[0].quantity, calls[1].quantity));
      
      // 保证金 = Max(Short Put 保证金, Call Spread 风险) - 总权利金
      // 注意：Jade Lizard 的设计通常使得上行无风险，但保证金计算仍需考虑两端
      return Math.max(Math.max(shortPutMargin, callSpreadMargin) - netCredit, 0);
    }
  }

  return null;
}

/**
 * 计算保证金使用率
 * @param strategies 所有策略
 * @param underlyingPrices 标的价格字典
 * @param totalBuyingPower 总购买力
 * @param cspTrades CSP 交易记录 (可选)
 * @returns 保证金使用情况
 */
export const calculatePortfolioMarginUsage = (
  strategies: StrategyWithLegs[],
  underlyingPrices: Record<string, number>,
  totalBuyingPower: number
): {
  totalMarginUsed: number;
  totalBuyingPowerUsed: number;
  marginUsageRate: number;
  availableBuyingPower: number;
  strategyMargins: Array<{
    strategyId: string;
    strategyName: string;
    marginUsed: number;
    marginEfficiency: number;
  }>;
} => {
  let totalMarginUsed = 0;
  let totalBuyingPowerUsed = 0;
  const strategyMargins: Array<{
    strategyId: string;
    strategyName: string;
    marginUsed: number;
    marginEfficiency: number;
  }> = [];
  
  // 1. 处理所有策略 (包括已合并的 CSP)
  strategies.forEach(strategy => {
    const underlyingPrice = underlyingPrices[strategy.underlyingAsset] || 0;
    // 即使 underlyingPrice 为 0，CSP 仍需计算保证金 (基于行权价)
    const margin = calculateStrategyMargin(strategy, underlyingPrice);
    totalMarginUsed += margin.initialMargin;
    totalBuyingPowerUsed += margin.buyingPowerReduction;
    
    strategyMargins.push({
      strategyId: strategy.id,
      strategyName: strategy.name || `${strategy.type} ${strategy.underlyingAsset}`,
      marginUsed: margin.buyingPowerReduction,
      marginEfficiency: margin.marginEfficiency
    });
  });
  
  const marginUsageRate = totalBuyingPower > 0 ? totalBuyingPowerUsed / totalBuyingPower : 0;
  const availableBuyingPower = totalBuyingPower - totalBuyingPowerUsed;
  
  return {
    totalMarginUsed,
    totalBuyingPowerUsed,
    marginUsageRate,
    availableBuyingPower,
    strategyMargins
  };
};

/**
 * 计算行权价相对于当前股价的百分比偏离度
 * @param strike 行权价
 * @param currentUnderlyingPrice 标的资产当前价格
 * @returns 百分比偏离度（正数表示虚值，负数表示实值）
 * 
 * 计算公式: (行权价 - 当前价) / 当前价 * 100%
 * 
 * 示例:
 * - 当前价 100，行权价 105 -> +5% (虚值 5%)
 * - 当前价 100，行权价 95 -> -5% (实值 5%)
 */
export const calculateStrikePercentageAway = (strike: number, currentUnderlyingPrice: number): number => {
  if (currentUnderlyingPrice === 0) {
    return 0;
  }
  // 计算行权价与当前价的百分比差距
  return ((strike - currentUnderlyingPrice) / currentUnderlyingPrice) * 100;
};

/**
 * 自动识别期权策略类型
 * @param legs 期权腿数组
 * @returns 策略类型名称
 */
export const identifyStrategyType = (legs: Leg[], context: StrategyRecognitionContext = {}): StrategyType => {
  if (legs.length === 0) return 'Custom';

  const expiryDate = (expiry: string) => expiry.split('T')[0];
  const uniqueExpiries = Array.from(new Set(legs.map(l => expiryDate(l.expiry)))).sort();
  const isMultiExpiry = uniqueExpiries.length > 1;
  const sameExpiry = uniqueExpiries.length === 1;
  const sameQuantity = (items: Leg[] = legs) => items.length > 0 && items.every(leg => leg.quantity === items[0].quantity);
  const stockQuantity = context.underlyingQuantity ?? 0;
  const multiplier = context.contractMultiplier ?? 100;
  const requiredShares = Math.max(...legs.map(leg => leg.quantity)) * multiplier;
  const hasLongStock = stockQuantity >= requiredShares;
  const hasShortStock = stockQuantity <= -requiredShares;

  const calls = legs.filter(l => l.type === 'Call').sort((a, b) => a.strike - b.strike);
  const puts = legs.filter(l => l.type === 'Put').sort((a, b) => a.strike - b.strike);
  const buys = legs.filter(l => l.side === 'Buy');
  const sells = legs.filter(l => l.side === 'Sell');
  
  // 单腿策略
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.side === 'Sell' && leg.type === 'Call' && hasLongStock) return 'Covered Call';
    if (leg.side === 'Buy' && leg.type === 'Call') return 'Long Call';
    if (leg.side === 'Sell' && leg.type === 'Call') return 'Naked Call';
    if (leg.side === 'Sell' && leg.type === 'Put') return 'Short Put';
    if (leg.side === 'Buy' && leg.type === 'Put') return 'Long Put';
    return 'Custom';
  }

  // 两腿策略
  if (legs.length === 2) {
    if (sameExpiry && calls.length === 2 && puts.length === 0 && buys.length === 1 && sells.length === 1
      && buys[0].quantity === sells[0].quantity * 2 && sells[0].strike < buys[0].strike) return 'Call Backspread';
    if (sameExpiry && puts.length === 2 && calls.length === 0 && buys.length === 1 && sells.length === 1
      && buys[0].quantity === sells[0].quantity * 2 && sells[0].strike > buys[0].strike) return 'Put Backspread';

    // 同一到期日
    if (sameExpiry && sameQuantity()) {
      if (calls.length === 1 && puts.length === 1 && calls[0].strike === puts[0].strike) {
        const call = calls[0];
        const put = puts[0];
        if (hasLongStock && put.side === 'Buy' && call.side === 'Sell') return 'Conversion';
        if (hasShortStock && put.side === 'Sell' && call.side === 'Buy') return 'Reversal';
        if (call.side === 'Buy' && put.side === 'Sell') return 'Synthetic Long Stock';
        if (call.side === 'Sell' && put.side === 'Buy') return 'Synthetic Short Stock';
      }
      if (hasLongStock && calls.length === 1 && puts.length === 1 && puts[0].side === 'Buy' && calls[0].side === 'Sell') return 'Collar';

      if (hasLongStock && puts.length === 2 && puts[0].side === 'Buy' && puts[1].side === 'Sell') return 'Put Spread Collar';

      // 卖出跨式/宽跨式
      if (sells.length === 2 && calls.length === 1 && puts.length === 1) {
        return sells[0].strike === sells[1].strike ? 'Straddle' : 'Strangle';
      }
      // 买入跨式/宽跨式
      if (buys.length === 2 && calls.length === 1 && puts.length === 1) {
        return buys[0].strike === buys[1].strike ? 'Straddle' : 'Strangle';
      }
      
      // 价差策略 (Spread)
      if (buys.length === 1 && sells.length === 1) {
        if (calls.length === 2) {
          return sells[0].strike < buys[0].strike ? 'Call Credit Spread' : 'Call Debit Spread';
        }
        if (puts.length === 2) {
          return sells[0].strike > buys[0].strike ? 'Put Credit Spread' : 'Put Debit Spread';
        }
      }

      if (buys.length === 1 && sells.length === 1 && calls.length === 1 && puts.length === 1) {
        if (buys[0].strike === sells[0].strike) return 'Synthetic';
      }
    } else if (isMultiExpiry && sameQuantity()) {
      // 不同到期日 (Calendar / Diagonal)
      const nearExp = uniqueExpiries[0];
      const farExp = uniqueExpiries[1];
      const nearLeg = legs.find(l => expiryDate(l.expiry) === nearExp)!;
      const farLeg = legs.find(l => expiryDate(l.expiry) === farExp)!;

      if (nearLeg.type === farLeg.type && nearLeg.side !== farLeg.side) {
        if (nearLeg.strike === farLeg.strike) return 'Calendar';
        if (nearLeg.side === 'Sell' && farLeg.side === 'Buy' && nearLeg.type === 'Call' && farLeg.strike < nearLeg.strike) return 'PMCC';
        return 'Diagonal';
      }
    }
  }

  // 三腿策略
  if (legs.length === 3 && sameExpiry) {
    if (calls.length === 3 || puts.length === 3) {
      const sameTypeLegs = calls.length === 3 ? calls : puts;
      const sorted = [...sameTypeLegs].sort((a, b) => a.strike - b.strike);
      const uniqueStrikes = [...new Set(sorted.map(leg => leg.strike))];
      const wings = sorted[0].side === 'Buy' && sorted[1].side === 'Sell' && sorted[2].side === 'Buy';
      if (uniqueStrikes.length === 3 && wings && sorted[1].quantity === sorted[0].quantity + sorted[2].quantity) {
        const leftWidth = sorted[1].strike - sorted[0].strike;
        const rightWidth = sorted[2].strike - sorted[1].strike;
        if (leftWidth === rightWidth && sorted[0].quantity === sorted[2].quantity) return 'Butterfly';
        return 'Broken-Wing Butterfly';
      }

      if (buys.length === 2 && sells.length === 1 && new Set(sorted.map(leg => leg.strike)).size === 2) {
        const short = sells[0];
        const longQty = buys.reduce((total, leg) => total + leg.quantity, 0);
        if (longQty === short.quantity * 2) {
          if (calls.length === 3 && short.strike < buys[0].strike) return 'Call Backspread';
          if (puts.length === 3 && short.strike > buys[0].strike) return 'Put Backspread';
        }
      }

      if (buys.length === 1 && sells.length === 2 && buys[0].quantity * 2 === sells.reduce((total, leg) => total + leg.quantity, 0)) return 'Ratio Spread';
    }

    // 玉蜥蜴 (Jade Lizard) - 卖出Put + 卖出Call价差 (无上行风险)
    if (sells.length === 2 && buys.length === 1 && puts.length === 1 && calls.length === 2) {
      const shortPut = puts[0];
      const shortCall = sells.find(s => s.type === 'Call')!;
      const longCall = buys.find(b => b.type === 'Call')!;
      if (shortPut.strike < shortCall.strike && shortCall.strike < longCall.strike) return 'Jade Lizard';
    }
  }

  // 四腿策略
  if (legs.length === 4 && sameExpiry && sameQuantity()) {
    if (calls.length === 2 && puts.length === 2) {
      const callLow = calls[0];
      const callHigh = calls[1];
      const putLow = puts[0];
      const putHigh = puts[1];
      const longBox = callLow.strike === putLow.strike && callHigh.strike === putHigh.strike
        && callLow.side === 'Buy' && callHigh.side === 'Sell' && putLow.side === 'Sell' && putHigh.side === 'Buy';
      const shortBox = callLow.strike === putLow.strike && callHigh.strike === putHigh.strike
        && callLow.side === 'Sell' && callHigh.side === 'Buy' && putLow.side === 'Buy' && putHigh.side === 'Sell';
      if (longBox || shortBox) return 'Box Spread';
    }

    const sorted = [...legs].sort((a, b) => (a.strike || 0) - (b.strike || 0));
    const sides = sorted.map(l => l.side);
    const types = sorted.map(l => l.type);
    
    // 标准铁鹰/铁蝴蝶布局: Buy Put, Sell Put, Sell Call, Buy Call
    const isIC = 
      sides[0] === 'Buy' && sides[1] === 'Sell' && sides[2] === 'Sell' && sides[3] === 'Buy' &&
      types[0] === 'Put' && types[1] === 'Put' && types[2] === 'Call' && types[3] === 'Call' &&
      sameQuantity();
    
    if (isIC) {
      return sorted[1].strike === sorted[2].strike ? 'Iron Butterfly' : 'Iron Condor';
    }

    // 蝴蝶策略 (全 Call 或 全 Put): Buy, Sell, Sell, Buy 且中间行权价相同
    const isButterfly = 
      sides[0] === 'Buy' && sides[1] === 'Sell' && sides[2] === 'Sell' && sides[3] === 'Buy' &&
      sorted[1].strike === sorted[2].strike &&
      (types.every(t => t === 'Call') || types.every(t => t === 'Put')) &&
      sameQuantity();
    
    if (isButterfly) return 'Butterfly';

    if ((types.every(type => type === 'Call') || types.every(type => type === 'Put'))
      && sides[0] === 'Buy' && sides[1] === 'Sell' && sides[2] === 'Sell' && sides[3] === 'Buy'
      && new Set(sorted.map(leg => leg.strike)).size === 4) return 'Condor';
  }

  if (legs.length === 4 && isMultiExpiry && sameQuantity() && calls.length === 2 && puts.length === 2) {
    const callExpiries = new Set(calls.map(leg => expiryDate(leg.expiry)));
    const putExpiries = new Set(puts.map(leg => expiryDate(leg.expiry)));
    if (callExpiries.size === 2 && putExpiries.size === 2
      && calls[0].side !== calls[1].side && puts[0].side !== puts[1].side
      && calls[0].strike !== calls[1].strike && puts[0].strike !== puts[1].strike) {
      return 'Double Diagonal';
    }
  }

  return 'Custom';
};

const CONTEXTUAL_STRATEGIES: readonly StrategyType[] = ['Covered Call', 'Collar', 'Put Spread Collar', 'Conversion', 'Reversal'];

const recognitionReason = (type: StrategyType): string => {
  const reasons: Partial<Record<StrategyType, string>> = {
    'Long Call': '单腿 Buy Call',
    'Naked Call': '单腿 Sell Call，未提供足够正股覆盖',
    'Covered Call': 'Sell Call 且正股数量足以覆盖合约',
    'Short Put': '单腿 Sell Put',
    'Long Put': '单腿 Buy Put',
    'Iron Condor': '四腿、同到期、两侧 Put/Call 翼结构完整',
    'Iron Butterfly': '四腿、同到期、中间行权价相同',
    'Butterfly': '同类型、同到期、买卖买且中心行权价对称',
    'Broken-Wing Butterfly': '同类型、同到期、买卖买但两翼不对称',
    'Condor': '同类型、同到期、四个不同翼行权价',
    'Calendar': '同类型、同执行价、不同到期日',
    'Diagonal': '同类型、不同执行价和到期日',
    'Double Diagonal': '两组不同到期的 Call/Put 对角结构',
    'Box Spread': '同到期、同两组行权价的 Call/Put 四腿平价结构',
    'Call Backspread': 'Call 数量为多头两倍的反向比例结构',
    'Put Backspread': 'Put 数量为多头两倍的反向比例结构',
    'Ratio Spread': '同类型、买一卖二的比例结构',
    'Straddle': '同到期、同执行价的 Call/Put 双腿',
    'Strangle': '同到期、不同执行价的 Call/Put 双腿',
    'Collar': '正股、Long Put 和 Short Call 共同形成保护结构',
    'Put Spread Collar': '正股与 Put 价差共同形成保护结构',
    'Conversion': '正股、Long Put 和 Short Call 形成转换结构',
    'Reversal': '空头正股、Short Put 和 Long Call 形成反转结构',
    'Synthetic Long Stock': 'Long Call + Short Put 合成多头正股',
    'Synthetic Short Stock': 'Short Call + Long Put 合成空头正股',
  };
  return reasons[type] ?? `${type} 结构规则匹配`;
};

export const recognizeStrategy = (legs: Leg[], context: StrategyRecognitionContext = {}): StrategyRecognitionResult => {
  const type = identifyStrategyType(legs, context);
  const contractKeys = legs.map(leg => `${leg.expiry.split('T')[0]}:${leg.type}:${leg.strike}`);
  const hasDuplicateContracts = new Set(contractKeys).size !== contractKeys.length;
  const quantities = legs.map(leg => leg.quantity);
  const sameQuantity = quantities.length > 0 && quantities.every(quantity => quantity === quantities[0]);
  const expiries = [...new Set(legs.map(leg => leg.expiry.split('T')[0]))];
  const constraints = [
    { key: 'legs.count', expected: type === 'Custom' ? 'supported pattern' : `${legs.length}`, actual: `${legs.length}`, satisfied: type !== 'Custom' },
    { key: 'contracts.unique', expected: 'unique', actual: hasDuplicateContracts ? 'duplicate' : 'unique', satisfied: !hasDuplicateContracts },
    { key: 'quantities', expected: sameQuantity ? 'same or rule-specific' : 'rule-specific', actual: sameQuantity ? 'same' : 'mixed', satisfied: true },
    { key: 'expiry.count', expected: `${expiries.length}`, actual: `${expiries.length}`, satisfied: true },
  ];
  const contextUsed: StrategyRecognitionResult['contextUsed'] = [];
  if (context.underlyingQuantity !== undefined) contextUsed.push('underlyingQuantity');
  if (context.underlyingEntryPrice !== undefined) contextUsed.push('underlyingEntryPrice');
  if (context.contractMultiplier !== undefined) contextUsed.push('contractMultiplier');
  const status = hasDuplicateContracts
    ? 'ambiguous'
    : type === 'Custom'
    ? 'custom'
    : contextUsed.length > 0 && CONTEXTUAL_STRATEGIES.includes(type)
    ? 'contextual'
    : 'exact';
  const reasons = hasDuplicateContracts
    ? ['存在重复合约键，无法确认是数量聚合还是重复数据']
    : type === 'Custom'
    ? ['未匹配到支持的唯一结构；保留为 Custom，不自动合并']
    : [recognitionReason(type)];
  return { type, status, reasons, constraints, contextUsed };
};

/**
 * 检查期权腿是否过于接近当前价格
 * @param leg 期权腿对象
 * @param currentUnderlyingPrice 标的资产当前价格
 * @param warningThreshold 警告阈值（默认5%）
 * @returns 风险级别和描述
 */
export const checkStrikeProximityRisk = (
  leg: Leg, 
  currentUnderlyingPrice: number,
  warningThreshold: number = 5
): {
  riskLevel: 'safe' | 'warning' | 'danger';
  message: string;
  percentageAway: number;
} => {
  if (currentUnderlyingPrice === 0) {
    return { riskLevel: 'safe', message: '', percentageAway: 0 };
  }

  const percentageAway = Math.abs(calculateStrikePercentageAway(leg.strike, currentUnderlyingPrice));
  const dte = calculateDTE(leg.expiry);
  
  // 根据到期时间调整警告阈值
  let adjustedThreshold = warningThreshold;
  if (dte <= 7) {
    adjustedThreshold = warningThreshold * 1.5; // 短期期权更严格
  } else if (dte <= 30) {
    adjustedThreshold = warningThreshold * 1.2;
  }

  const sideText = leg.side === 'Sell' ? '卖出' : '买入';
  const typeText = leg.type === 'Call' ? '看涨' : '看跌';
  
  if (percentageAway < adjustedThreshold * 0.6) {
    return {
      riskLevel: 'danger',
      message: `${sideText}${typeText}过于接近当前价 (${percentageAway.toFixed(1)}%)，高风险被行权`,
      percentageAway
    };
  } else if (percentageAway < adjustedThreshold) {
    return {
      riskLevel: 'warning',
      message: `${sideText}${typeText}接近当前价 (${percentageAway.toFixed(1)}%)，注意行权风险`,
      percentageAway
    };
  }

  return { riskLevel: 'safe', message: '', percentageAway };
};

/**
 * 检查整个策略的行权价风险
 * @param legs 期权腿数组
 * @param currentUnderlyingPrice 标的资产当前价格
 * @returns 风险警告数组
 */
export const checkStrategyStrikeRisks = (
  legs: Leg[], 
  currentUnderlyingPrice: number
): Array<{
  legIndex: number;
  riskLevel: 'warning' | 'danger';
  message: string;
}> => {
  const risks = [];
  
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const risk = checkStrikeProximityRisk(leg, currentUnderlyingPrice);
    
    if (risk.riskLevel !== 'safe') {
      risks.push({
        legIndex: i,
        riskLevel: risk.riskLevel,
        message: risk.message
      });
    }
  }
  
  return risks;
};
