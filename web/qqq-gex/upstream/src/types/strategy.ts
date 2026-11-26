/*
 * Copyright (c) 2026 by ${git_name_email} JE Solution Co., All Rights Reserved. 
 */
import { FinancialFactor } from './factor';
import { StockDecisionAnalysis, StockDecisionSystem } from './macro';

/**
 * 期权策略管理相关类型定义
 */

// 期权策略类型枚举
export type StrategyType = 
  | 'PMCC' | 'Put Credit Spread' | 'Call Credit Spread' | 'Put Debit Spread' | 'Call Debit Spread' | 'Credit Spread' | 'Debit Spread' | 'Covered Call' | 'Wheel' 
  | 'Iron Condor' | 'Condor' | 'Butterfly' | 'Broken-Wing Butterfly' | 'Iron Butterfly' | 'Strangle' | 'Straddle'
  | 'Calendar' | 'Diagonal' | 'Double Diagonal' | 'Jade Lizard' | 'Ratio Spread' | 'Call Backspread' | 'Put Backspread'
  | 'Collar' | 'Put Spread Collar' | 'Box Spread' | 'Conversion' | 'Reversal' | 'Synthetic' | 'Synthetic Long Stock' | 'Synthetic Short Stock'
  | 'Long Call' | 'Naked Call' | 'Short Put' | 'Long Put' | 'Custom'
  | 'CASH_SECURED_PUT';

export interface StrategyRecognitionContext {
  underlyingQuantity?: number;
  underlyingEntryPrice?: number;
  contractMultiplier?: number;
}

export type StrategyRecognitionStatus = 'exact' | 'contextual' | 'ambiguous' | 'custom';

export interface StrategyRecognitionConstraint {
  key: string;
  expected: string;
  actual: string;
  satisfied: boolean;
}

export interface StrategyRecognitionResult {
  type: StrategyType;
  status: StrategyRecognitionStatus;
  reasons: string[];
  constraints: StrategyRecognitionConstraint[];
  contextUsed: Array<'underlyingQuantity' | 'underlyingEntryPrice' | 'contractMultiplier'>;
}

// 期权交易方向：买入或卖出
export type OptionSide = 'Buy' | 'Sell';

// 期权类型：看涨期权或看跌期权
export type OptionType = 'Call' | 'Put';

/**
 * 市场环境快照 (开仓时记录)
 */
export type MarketSnapshot = {
  underlyingPrice: number;
  ma7?: number;
  ma30?: number;
  ma200?: number;
  hv20?: number;
  ivAtm?: number;
  ivScore?: number;
  ivRank?: number;
  vix?: number;
  vixTerm?: number;
  rsi?: number;
  rsi7?: number;
  rsi21?: number;
  macdMomentumStrength?: number;
  kcUpper?: number;
  kcLower?: number;
  kcMiddle?: number;
  atr?: number;
  macd?: { line: number; signal: number; histogram: number };
  bbWidth?: number;
  trend?: string;
  regime?: string;
  timestamp: string;
};

/**
 * 开仓参数指标快照
 */
export type EntryMetrics = {
  delta?: number;
  dte?: number;
  otmPct?: number;
  probITM?: number;
  probOTM?: number;
  expectedMove?: number;
  premiumYield?: number;
  riskRewardRatio?: number;
  distanceToStrike?: number;
};

/**
 * 交易风险预警
 */
export type TradeWarning = {
  type: string;
  label?: 'price' | 'time' | 'greeks' | 'profit' | 'volatility' | 'regime'; // Categorization for icons/UI
  level: "low" | "medium" | "high";
  message: string;
  triggerValue?: number;
  timestamp: string;
};

/**
 * 交易流水/操作历史记录
 */
export interface TradeAction {
  id: string;
  timestamp: number;
  type: 'OPEN' | 'ADJUST' | 'CLOSE' | 'ROLL';
  description: string;
  legs: Leg[]; // 该动作涉及的腿及其状态
  underlyingPrice: number;
  realizedPnL?: number;
  netCredit?: number; // 权利金变动
}

export interface AccountHistoryItem {
  timestamp: number;
  equity: number;
}

/**
 * 期权希腊字母
 * 用于衡量期权价格对各种因素的敏感性
 */
export interface Greeks {
  price?: number; // 理论期权价格 (新增)
  delta: number; // 期权价格对标的资产价格变化的敏感性
  gamma: number; // Delta 对标的资产价格变化的敏感性
  theta: number; // 期权价格对时间衰减的敏感性（时间价值衰减）
  vega: number;  // 期权价格对隐含波动率变化的敏感性
  rho: number;   // 期权价格对无风险利率变化的敏感性
}

/**
 * 期权腿（单个期权合约）
 * 组合策略中的每个期权合约定义
 */
export interface Leg {
  id: string;              // 唯一标识符
  side: 'Buy' | 'Sell';    // 交易方向：买入或卖出
  type: 'Call' | 'Put';    // 期权类型：看涨或看跌
  quantity: number;        // 合约数量
  strike: number;          // 行权价格
  entryPrice: number;      // 建仓价格
  currentPrice: FinancialFactor<number>;    // 当前市价
  exitPrice?: number;      // 平仓价格（可选）
  expiry: string;          // 到期日期（ISO格式）
  iv: FinancialFactor<number>;              // 隐含波动率
  greeks: FinancialFactor<Greeks>;          // 希腊字母信息
}

/**
 * 完整的期权投资策略
 * 包含策略基本信息和所有期权腿
 */
export interface StrategyWithLegs {
  id: string;              // 策略唯一标识符
  name?: string;           // 策略名称（可选）
  type: StrategyType;      // 策略类型（必填，用于归类和逻辑驱动）
  description: string;     // 策略描述
  underlyingAsset: string; // 标的资产股票代码
  underlyingEntryPrice: number; // 建仓时标的资产价格
  underlyingQuantity?: number; // 识别 Covered Call/Collar/Conversion 时的股票数量
  createdAt: number;       // 创建时间戳
  legs: Leg[];             // 策略包含的所有期权腿
  status: 'active' | 'closed'; // 策略状态
  
  // --- 增强功能 ---
  openSnapshot?: MarketSnapshot; // 开仓环境快照
  entryMetrics?: EntryMetrics;   // 开仓指标快照
  entryAnalysis?: StockDecisionAnalysis; // 新增：保存开仓时的 AI 分析结果
  entryDecision?: StockDecisionSystem;   // 新增：保存开仓时的系统判定
  history: TradeAction[];        // 交易流水/历史记录
  warnings?: TradeWarning[];     // 实时风险预警
  
  // --- 财务摘要 ---
  netPremium: number;      // 初始收到的净权利金 (1.00 表示 $100)
  marginUsed?: number;     // 该策略占用的保证金
  note?: string;           // 策略备注
  closedAt?: number;       // 平仓时间戳
  realizedPnL?: number;    // 已实现盈亏
  tags?: string[];         // 自定义标签
  mergedFromStrategyIds?: string[]; // 策略库修复合并时保留来源策略
  splitFromStrategyId?: string; // 从组合策略拆出的来源策略
}

/**
 * 股价详细信息
 */
export interface OptionQuote {
  strike: number;
  type: 'call' | 'put';
  expiry: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface PriceData {
  price: number;           // 当前价格
  change: number;          // 涨跌金额
  changePercent: number;   // 涨跌幅百分比
  previousClose: number;   // 前收盘价
  iv?: number | null;      // 隐含波动率 (新增)
  optionQuotes?: Record<string, OptionQuote>; // 期权链报价信息 (新增)
}

/**
 * 账户资金信息
 */
export interface AccountInfo {
  totalBuyingPower: number;           // 总购买力
  availableBuyingPower: number;       // 可用购买力
  marginUsed: number;                 // 已使用保证金
  marginUsageRate: number;            // 保证金使用率 (0-1)
  cashBalance: number;                // 现金余额
  lastUpdate: number;                 // 最后更新时间
}
