import { GEXTopology } from '../structure/GEXEngine';
import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { buildMarketTechnicalLensView } from '../../presenters/marketTechnicalLens';

export type TrendState = 'BULL' | 'BEAR' | 'NEUTRAL';
export type VolRegime = 'EXPANSION' | 'COMPRESSION' | 'STABLE';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type MarketNarrative = 
  | 'STABLE_UPTREND'
  | 'FRAGILE_RALLY'
  | 'LIQUIDATION_RISK'
  | 'DISTRIBUTION_PHASE'
  | 'MEAN_REVERSION_SETUP'
  | 'VOL_EXPANSION_PREP'
  | 'UNCERTAIN';

/**
 * 引擎敏感度配置
 * 暴露这些参数可以让你在前端微调“实效性”
 */
export interface TechnicalAnalysisConfig {
  volumeExhaustionThreshold: number; // 默认 0.7 (买盘跟不上了的阈值)
  compressionWidthThreshold: number; // 默认 0.02 (2% 宽度判定为变盘准备)
  ivSlopeWarningThreshold: number;  // 默认 -0.1 (机构买保险的敏感度)
  riskScoreHighThreshold: number;   // 默认 7 (判定为 HIGH 风险的分数)
  riskScoreMidThreshold: number;    // 默认 4 (判定为 MEDIUM 风险的分数)
  trendFocus: 'SHORT' | 'LONG' | 'BALANCED'; // 趋势时间范畴重点
}

export const DEFAULT_TECH_CONFIG: TechnicalAnalysisConfig = {
  volumeExhaustionThreshold: 0.7,
  compressionWidthThreshold: 0.02,
  ivSlopeWarningThreshold: -0.1,
  riskScoreHighThreshold: 7,
  riskScoreMidThreshold: 4,
  trendFocus: 'BALANCED',
};

export interface TechnicalVerdict {
  trend: TrendState;
  vol: VolRegime;
  riskLevel: RiskLevel;
  narrative: MarketNarrative;
  evidence: string[];
  totalRisk: number;
}

export interface TechnicalAnalysisInput {
  price: number;
  priceChange?: number;
  ma7?: number;            // 新增 ma7 支持极短期
  ma30?: number;
  ma200?: number;
  kcUpper?: number;
  kcLower?: number;
  ivSlope?: number | null; 
  volume?: number;         
  volumeMA20?: number;     
  topology?: GEXTopology;
  config?: Partial<TechnicalAnalysisConfig>; // 支持传入部分配置进行微调
}

function rawFactor<T>(value: T): FinancialFactor<T> {
  return { value, confidence: 10, source: { type: 'raw', api: 'legacy-technical-wrapper' } };
}

function manualCompatFactor<T>(value: T, description: string): FinancialFactor<T> {
  return { value, confidence: 7, source: { type: 'manual', description } };
}

function addNumber(factors: FactorMap, key: string, value: number | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) factors[key] = rawFactor(value);
}

function legacyFallbackFactors(): FactorMap {
  return {
    roc_5d: manualCompatFactor(0, 'legacy input missing roc_5d'),
    roc_20d: manualCompatFactor(0, 'legacy input missing roc_20d'),
    rsi_7: manualCompatFactor(50, 'legacy input missing rsi_7'),
    rsi_14: manualCompatFactor(50, 'legacy input missing rsi_14'),
    macd_histogram: manualCompatFactor(0, 'legacy input missing macd_histogram'),
    macd_momentum_strength: manualCompatFactor(0, 'legacy input missing macd_momentum_strength'),
    bb_percent_b: manualCompatFactor(0.5, 'legacy input missing bb_percent_b'),
    bb_width: manualCompatFactor(0, 'legacy input missing bb_width'),
    hv_5: manualCompatFactor(0, 'legacy input missing hv_5'),
    hv_20: manualCompatFactor(0, 'legacy input missing hv_20'),
    vol_acceleration: manualCompatFactor(1, 'legacy input missing vol_acceleration'),
  };
}

function legacyNarrativeFor(trend: TrendState, vol: VolRegime, riskLevel: RiskLevel): MarketNarrative {
  if (trend === 'BULL' && riskLevel === 'LOW') return 'STABLE_UPTREND';
  if (trend === 'BULL') return 'FRAGILE_RALLY';
  if (trend === 'BEAR' && (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')) return 'LIQUIDATION_RISK';
  if (trend === 'BEAR') return 'DISTRIBUTION_PHASE';
  if (trend === 'NEUTRAL' && vol === 'COMPRESSION') return 'VOL_EXPANSION_PREP';
  if (trend === 'NEUTRAL' && riskLevel === 'LOW') return 'MEAN_REVERSION_SETUP';
  return 'UNCERTAIN';
}

export class TechnicalAnalysisEngine {
  /**
   * Legacy compatibility wrapper for Screener/StockStatusPanel.
   * New presentation code should call buildMarketTechnicalLensView(FactorMap, options) directly.
   */
  public static getVerdict(input: TechnicalAnalysisInput): TechnicalVerdict {
    const factors = legacyFallbackFactors();
    addNumber(factors, 'price', input.price);
    addNumber(factors, 'ma7', input.ma7);
    addNumber(factors, 'ma30', input.ma30);
    addNumber(factors, 'ma200', input.ma200);
    addNumber(factors, 'kc_upper', input.kcUpper);
    addNumber(factors, 'kc_lower', input.kcLower);
    addNumber(factors, 'volume', input.volume);
    addNumber(factors, 'volume_ma20', input.volumeMA20);
    addNumber(factors, 'iv_slope', input.ivSlope);
    if (input.topology) factors.gex_topology = rawFactor(input.topology);

    const view = buildMarketTechnicalLensView(factors, {
      index: 'spx',
      window: '1m',
      config: input.config,
    });

    return {
      trend: view.trend,
      vol: view.vol,
      riskLevel: view.riskLevel,
      narrative: view.narrative === 'UNCERTAIN' ? legacyNarrativeFor(view.trend, view.vol, view.riskLevel) : view.narrative,
      evidence: view.evidence,
      totalRisk: view.totalRisk,
    };
  }
}
