import type { FactorMap, FinancialFactor } from './factor';
import type {
  VerdictAction, 
  TriggerCondition, 
  StrategyType, 
  TriggerState, 
  TimingAnalysis, 
  RiskAnalysis,
  UnifiedRegime,
  PreTradeGateDecision,
  GEXStructure,
  IVOpportunity,
  CSPRecommendation,
  ExpectedMoveAnalysis,
  GlobalVerdict
} from '../lib/engines';

export type MarketStatus = 'real' | 'fallback';

export interface MarketQuoteSummary {
  value: number;
  change?: number;
  changePercent?: number;
  termStructure?: string;
  status?: MarketStatus | string;
  percentile?: number;
  score?: number;
  description?: string;
  dataSourceStatus?: string;
}

export interface YieldCurveSummary {
  spread?: number;
  status?: string;
  signal?: string;
}

export interface InterestRateSummary {
  treasury_10y: MarketQuoteSummary;
  treasury_2y?: MarketQuoteSummary;
  yield_curve?: YieldCurveSummary;
  signals?: string[];
}

export interface SpxVolatilitySummary {
  ivHvRatio: number;
  underlyingPrice?: number;
  priceChangePercent?: number;
  impliedVolatility?: number;
  historicalVolatility?: number;
  ivRank?: number;
  ivPercentile?: number;
  status?: MarketStatus | string;
}

export interface MarketRegimeSummary {
  regime: string;
  score?: number;
  level?: string;
  canTrade?: boolean;
}

export interface MacroDecisionValue {
  action: VerdictAction;
  strategy: StrategyType | null;
  color: string;
  positionSize: number;
  sizeLabel: string;
  reason: string;
  reasonKeys?: string[];
  triggerConditions: TriggerCondition[];
  regime: UnifiedRegime;
  hmmRegime?: {
    p_bull: number;
    p_neutral: number;
    p_bear: number;
    logScore: number;
    state: 'BULL' | 'NEUTRAL' | 'BEAR';
  };
  confidence: number;
  edgeConfidence: number; // 新增：交易 edge 存在的置信度（WAIT 时低）
  riskScore: number;
  realRisk: number;
  marketLabels: string[];
  priceExtension: number;
  trendQuality: number;
  triggerState: TriggerState;
  ivOpportunity: 'RICH' | 'FAIR' | 'CHEAP';
  ivScore: number; // 统一为 0~100 机会分
  timingState: 'STRONG' | 'NEUTRAL' | 'WEAK' | 'BEARISH';
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  triggers: string[];
  timing: TimingAnalysis;
  risk: RiskAnalysis;
  market_regime: 'range' | 'trend' | 'volatile' | 'compressed';
  volatility_state: 'low' | 'normal' | 'high';
  overall_bias: 'bullish' | 'bearish' | 'neutral';
  market_quality: 'high' | 'medium' | 'low';
  analysisReasons: {
    iv: string[];
    timing: string[];
    risk: string[];
    conflict: string[];
  };
  reduceSpec?: {
    targetPositionSize: number;
    priority: 'highest_risk_first' | 'shortest_dte_first' | 'largest_loss_first';
    rationale: string;
  };
}

export interface MacroRecommendationValue {
  strategy: StrategyType | 'No New Positions';
  reason: string;
  reasonEn: string;
  triggerFactors: string[];
  blockedBy: string[];
  setup: { delta: number; dte: number; width: number };
  financials: { credit: number; maxRisk: number; returnOnRisk: string };
  holding: string;
  ivOpportunity: 'RICH' | 'FAIR' | 'CHEAP';
  tradability: 'ALLOWED' | 'BLOCKED' | 'RESTRICTED';
  recoveryConditions?: string[]; // BLOCKED 状态的解除条件描述（仅展示）
  confidence: number;  // 数据质量置信度（原字段，含义不变）
  edgeConfidence: number; // 新增：交易 edge 存在的置信度（WAIT 时低）
  hmmRegime?: {
    p_bull: number;
    p_neutral: number;
    p_bear: number;
    logScore: number;
    state: 'BULL' | 'NEUTRAL' | 'BEAR';
  };
  positionSizeMultiplier?: number;
  dataQuality: 'high' | 'medium' | 'low';
  tradeStructureAvailable: boolean; // false 表示无 strike/credit/maxRisk 可执行
}

export interface MacroMetrics {
  opportunity: FinancialFactor<{
    score: number;
    label: string;
    breakdown: {
      ivRank:        { value: number; score: number };  // 0-100
      volPremium:    { value: number; score: number };  // IV/HV ratio
      termStructure: { value: number; score: number };  // vixTermRatio
    };
  }>;
  timing: FinancialFactor<{ score: number; state: string; explanation: string }>;
}

export interface DecisionTrace {
  step1_regime:  { regime: UnifiedRegime; score: number; conclusion: string };
  step2_iv:      { opportunity: string; score: number; conclusion: string };
  step3_timing:  { state: string; score: number; conclusion: string };
  step4_risk:    { level: string; score: number; conclusion: string };
  step5_verdict: { action: VerdictAction; reason: string; mainBlocker: string | null };
  step6_structure: {
    available: boolean;
    // TRADE 时填充
    strategy?: string;
    edgeSource?: string;  // "IV Rich + Bull Trend" 等
    // WAIT 时填充
    alternative?: string; // alternativeAdvice.suggestedAction
    nextTrigger?: string; // nextConditions[0]
  };
}

export interface MacroDecisionSystem {
  decision: FinancialFactor<MacroDecisionValue>;
  riskWarning: FinancialFactor<string | null>;
  recommendation: FinancialFactor<MacroRecommendationValue>;
  metrics: MacroMetrics;
  exitRules: FinancialFactor<{ type: string; rule: string }[]>;
  magi: {
    scientist: FinancialFactor<string>;
    macro: FinancialFactor<string>;
    opportunist: FinancialFactor<string>;
  };
  decisionTrace: DecisionTrace; // 新增
}

export type StockFinalAction = 'OPEN' | 'WATCH' | 'WAIT' | 'BLOCK';

export interface StockConditionScore {
  score: number;
  label: string;
  detail: string;
}

export interface StockPositionSizing {
  size: number;
}

export interface StockDecisionAnalysis {
  preTradeGate: PreTradeGateDecision;
  gexStructure: GEXStructure;
  ivOpportunity: IVOpportunity;
  entryRecommendation: CSPRecommendation;
  expectedMoveAnalysis: ExpectedMoveAnalysis;
  finalAction: StockFinalAction;
  baseAction: StockFinalAction;
  promotionSource: 'BASE' | 'WATCH_TRIGGER' | 'OPEN_TRIGGER' | 'CARRY_OPEN' | null;
  selectedSigma: 1 | 1.5 | 2 | 2.5 | null;
  triggerState: {
    watchCondition: boolean;
    openCondition: boolean;
    watchStreak: number;
    openStreak: number;
  };
  /** @deprecated 仅用于读取旧交易日志；新路径读取 factors.seller_edge_score。 */
  sellerEdgeScore?: number;
  tier: import('@/lib/engines/analysis/SellerEdgeScoreEngine').SellerEdgeTier;
  conditionScores: {
    macro: StockConditionScore;
    iv: StockConditionScore;
    entry: StockConditionScore;
  };
  finalReasons: string[];
  overallConfidence: number;
  sentiment?: import('@/lib/engines').SentimentResult;
  csp_recommendation: CSPRecommendation; // 新增
  execution_trace: StrategyExecutionTrace | null; // 新增
  positionSizing: StockPositionSizing;
  }
export interface StockDecisionSystem extends MacroDecisionSystem {
  analysis: StockDecisionAnalysis;
  verdict?: FinancialFactor<GlobalVerdict>;
  strategy?: FinancialFactor<{ type: string } | null>;
}

export interface FeatureInternalValues {
  historicalVolatility: number;
  ivRank: number;
  ivPercentile: number;
  ivHvRatio: number;
  yieldSpread: number;
  vixTermRatio: number;
}

export interface MacroData {
  status: 'real' | 'fallback';
  marketState?: string; // REGULAR, PRE, POST, CLOSED
  confidence: number;
  timestamp: string;
  factors: FactorMap;
  decisionSystem?: MacroDecisionSystem;
  specificStock?: {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    timestamp: string;
  };
  vix: MarketQuoteSummary & { termStructure: string };
  vix3m?: MarketQuoteSummary;
  termStructure?: YieldCurveSummary;
  commodities?: Record<string, MarketQuoteSummary>;
  crudeOil?: MarketQuoteSummary;
  spotGold?: MarketQuoteSummary;
  inflationExpectations?: MarketQuoteSummary;
  employment?: MarketQuoteSummary;
  dxy?: MarketQuoteSummary;
  liquidity?: MarketQuoteSummary;
  marketSentiment?: MarketQuoteSummary;
  interestRates: InterestRateSummary;
  spxVolatility: SpxVolatilitySummary;
  marketRegime: MarketRegimeSummary;
}

export interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyExecutionTrace {
  stage1_authorization: {
    allowed: boolean;
    status: 'TRADE' | 'WAIT' | 'BLOCK';
    reason: string;
  };
  stage2_boundaries: {
    putWall: number;
    expectedMoveLower: number;
    kcLower: number;
    effectiveLower: number;
  };
  stage3_targeting: {
    strike: number;
    expiry: string;
    dte: number;
    delta: number;
    apr: number;
    winProb: number;
    premium: number;
    score: number;
  } | null;
  stage4_sizing: {
    size: number;
    unit: string;
    logic: string;
  };
}
