import type { FactorMap, FinancialFactor } from '../../types/factor';
import type {
  MarketNarrative,
  RiskLevel,
  TechnicalAnalysisConfig,
  TrendState,
  VolRegime,
} from '../engines/analysis/TechnicalAnalysisEngine';
import type { GEXTopology } from '../engines/structure/GEXEngine';

export type MarketTechnicalIndexKey = 'spx' | 'ndx';
export type MarketTechnicalWindow = '1w' | '1m';
export type MarketTechnicalBias = '偏强' | '中性' | '偏弱';
export type MarketTechnicalRisk =
  | '追高风险'
  | '回撤观察'
  | '反弹窗口'
  | '波动升温'
  | '常规波动';
export type MarketTechnicalDataQuality = 'high' | 'low';
export type MarketTechnicalSignalStrength = 'strong' | 'moderate' | 'weak';

export type MarketTechnicalFactorKey =
  | 'roc_5d'
  | 'roc_20d'
  | 'rsi_7'
  | 'rsi_14'
  | 'macd_histogram'
  | 'macd_momentum_strength'
  | 'bb_percent_b'
  | 'bb_width'
  | 'hv_5'
  | 'hv_20'
  | 'vol_acceleration'
  | 'price'
  | 'ma7'
  | 'ma30'
  | 'ma200'
  | 'kc_upper'
  | 'kc_lower'
  | 'volume'
  | 'volume_ma20'
  | 'iv_slope'
  | 'gex_topology';

export type MarketTechnicalFactorMap = FactorMap & Partial<Record<MarketTechnicalFactorKey, FinancialFactor<any>>>;

export type MarketTechnicalLensOptions = {
  index: MarketTechnicalIndexKey;
  window: MarketTechnicalWindow;
  config?: Partial<TechnicalAnalysisConfig>;
};

export type MarketTechnicalLensView = {
  bias: MarketTechnicalBias;
  risk: MarketTechnicalRisk;
  riskLevel: RiskLevel;
  trend: TrendState;
  vol: VolRegime;
  narrative: MarketNarrative;
  signalStrength: MarketTechnicalSignalStrength;
  dataQuality: MarketTechnicalDataQuality;
  totalRisk: number;
  evidence: string[];
  bullets: string[];
  groups: {
    momentum: string;
    overheatPullback: string;
    volatility: string;
    trend: string;
  };
};

const DEFAULT_MARKET_TECH_CONFIG: TechnicalAnalysisConfig = {
  volumeExhaustionThreshold: 0.7,
  compressionWidthThreshold: 0.02,
  ivSlopeWarningThreshold: -0.1,
  riskScoreHighThreshold: 7,
  riskScoreMidThreshold: 4,
  trendFocus: 'BALANCED',
};

function factor<T>(factors: FactorMap, key: string): FinancialFactor<T> | undefined {
  return factors[key] as FinancialFactor<T> | undefined;
}

function usableNumber(factors: FactorMap, key: string): FinancialFactor<number> | undefined {
  const f = factor<number>(factors, key);
  return f && f.confidence >= 7 && f.source.type !== 'fallback' && Number.isFinite(f.value) ? f : undefined;
}

function usableAny<T>(factors: FactorMap, key: string): FinancialFactor<T> | undefined {
  const f = factor<T>(factors, key);
  return f && f.confidence >= 7 && f.source.type !== 'fallback' ? f : undefined;
}

function valueOf(factors: FactorMap, key: string, fallback: number): number {
  const f = factor<number>(factors, key);
  return f && Number.isFinite(f.value) ? f.value : fallback;
}

function pct(value: number) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function numberLabel(value: number, digits = 2) {
  return value.toFixed(digits);
}

function bumpRisk(riskLevel: RiskLevel): RiskLevel {
  if (riskLevel === 'LOW') return 'MEDIUM';
  if (riskLevel === 'MEDIUM') return 'HIGH';
  if (riskLevel === 'HIGH') return 'CRITICAL';
  return 'CRITICAL';
}

function resolveTrend(price: number, ma7: number | undefined, ma30: number | undefined, ma200: number | undefined, cfg: TechnicalAnalysisConfig): TrendState {
  if (cfg.trendFocus === 'SHORT') {
    if (ma7 && ma30) {
      if (price > ma7 && price > ma30) return 'BULL';
      if (price < ma7 && price < ma30) return 'BEAR';
      return 'NEUTRAL';
    }
    if (ma30) return price > ma30 ? 'BULL' : 'BEAR';
    return 'NEUTRAL';
  }

  if (cfg.trendFocus === 'LONG') {
    if (ma200) return price > ma200 ? 'BULL' : 'BEAR';
    return 'NEUTRAL';
  }

  if (ma30 && ma200) {
    if (price > ma30 && price > ma200) return 'BULL';
    if (price < ma30 && price < ma200) return 'BEAR';
  }
  return 'NEUTRAL';
}

function narrativeFor(trend: TrendState, vol: VolRegime, riskLevel: RiskLevel): MarketNarrative {
  if (trend === 'BULL' && riskLevel === 'LOW') return 'STABLE_UPTREND';
  if (trend === 'BULL') return 'FRAGILE_RALLY';
  if (trend === 'BEAR' && (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')) return 'LIQUIDATION_RISK';
  if (trend === 'BEAR') return 'DISTRIBUTION_PHASE';
  if (trend === 'NEUTRAL' && vol === 'COMPRESSION') return 'VOL_EXPANSION_PREP';
  if (trend === 'NEUTRAL' && riskLevel === 'LOW') return 'MEAN_REVERSION_SETUP';
  return 'UNCERTAIN';
}

export function buildMarketTechnicalLensView(
  factors: MarketTechnicalFactorMap,
  options: MarketTechnicalLensOptions,
): MarketTechnicalLensView {
  const cfg = { ...DEFAULT_MARKET_TECH_CONFIG, ...options.config };
  const rocKey = options.window === '1w' ? 'roc_5d' : 'roc_20d';
  const rsiKey = options.window === '1w' ? 'rsi_7' : 'rsi_14';
  const requiredKeys = [
    rocKey,
    rsiKey,
    'macd_histogram',
    'macd_momentum_strength',
    'bb_percent_b',
    'bb_width',
    'hv_5',
    'hv_20',
    'vol_acceleration',
    'price',
    'ma30',
    'ma200',
  ];
  const dataQuality: MarketTechnicalDataQuality = requiredKeys.every(key => !!usableNumber(factors, key)) ? 'high' : 'low';

  const roc = valueOf(factors, rocKey, 0);
  const rsi = valueOf(factors, rsiKey, 50);
  const macd = valueOf(factors, 'macd_histogram', 0);
  const macdStrength = valueOf(factors, 'macd_momentum_strength', 0);
  const percentB = valueOf(factors, 'bb_percent_b', 0.5);
  const bbWidth = valueOf(factors, 'bb_width', 0);
  const hv5 = valueOf(factors, 'hv_5', 0);
  const hv20 = valueOf(factors, 'hv_20', 0);
  const volAcceleration = valueOf(factors, 'vol_acceleration', 1);
  const price = valueOf(factors, 'price', 0);
  const ma7 = usableNumber(factors, 'ma7')?.value;
  const ma30 = usableNumber(factors, 'ma30')?.value;
  const ma200 = usableNumber(factors, 'ma200')?.value;
  const kcUpper = usableNumber(factors, 'kc_upper')?.value;
  const kcLower = usableNumber(factors, 'kc_lower')?.value;
  const volume = usableNumber(factors, 'volume')?.value;
  const volumeMA20 = usableNumber(factors, 'volume_ma20')?.value;
  const ivSlope = usableNumber(factors, 'iv_slope')?.value;
  const topology = usableAny<GEXTopology>(factors, 'gex_topology')?.value;

  let bias: MarketTechnicalBias = '中性';
  if (roc > 0 && macd >= 0 && macdStrength >= 0 && rsi < 75) {
    bias = '偏强';
  } else if (roc < 0 && (macd < 0 || rsi < 45)) {
    bias = '偏弱';
  }

  let risk: MarketTechnicalRisk = '常规波动';
  if (rsi >= 75 && percentB >= 0.9) {
    risk = '追高风险';
  } else if (roc < 0 && rsi <= 42 && percentB <= 0.25) {
    risk = '反弹窗口';
  } else if (volAcceleration >= 1.25) {
    risk = '波动升温';
  } else if (roc < 0 || macdStrength < 0) {
    risk = '回撤观察';
  }

  let trend = price > 0 ? resolveTrend(price, ma7, ma30, ma200, cfg) : 'NEUTRAL';

  let vol: VolRegime = 'STABLE';
  if (price > 0 && kcUpper && kcLower) {
    if (price > kcUpper || price < kcLower) vol = 'EXPANSION';
    else if (kcUpper - kcLower < price * cfg.compressionWidthThreshold) vol = 'COMPRESSION';
  }

  const evidence: string[] = [];
  if (vol === 'EXPANSION') evidence.push('波动正在剧烈变大 (Vol Expansion)');

  const isVolExhaustion = !!(volume && volumeMA20 && volume < volumeMA20 * cfg.volumeExhaustionThreshold);
  if (isVolExhaustion) evidence.push('买盘跟不上了 (Vol Exhaustion)');

  if (ivSlope != null && ivSlope < cfg.ivSlopeWarningThreshold) {
    evidence.push(`IV Slope 异常偏斜 (${ivSlope.toFixed(2)})，机构对冲压力上升`);
  }

  let totalRisk = 0;
  if (trend === 'BEAR') totalRisk += 4;
  if (vol === 'EXPANSION') totalRisk += 3;
  if (isVolExhaustion) totalRisk += 2;
  if (ivSlope != null && ivSlope < cfg.ivSlopeWarningThreshold) totalRisk += 1;

  let riskLevel: RiskLevel = 'LOW';
  if (totalRisk >= cfg.riskScoreHighThreshold) riskLevel = 'HIGH';
  else if (totalRisk >= cfg.riskScoreMidThreshold) riskLevel = 'MEDIUM';

  if (topology) {
    const isFragile = topology.structure === 'CLUSTERED' || topology.flipPosition === 'NEAR_FLIP';
    const isNegative = topology.netGamma === 'NEGATIVE';

    if (isFragile && isNegative) {
      evidence.push('期权底盘极不稳 (Gamma Flip)');
      riskLevel = 'CRITICAL';
      trend = 'BEAR';
    } else if (isFragile || isNegative) {
      if (isFragile) evidence.push('筹码堆积过度 (Gamma Clustered)');
      if (isNegative) evidence.push('做市商抛压放大 (Negative Gamma)');
      riskLevel = bumpRisk(riskLevel);
    }
  }

  totalRisk = Math.min(10, totalRisk);
  const narrative = dataQuality === 'low' && riskLevel !== 'CRITICAL'
    ? 'UNCERTAIN'
    : narrativeFor(trend, vol, riskLevel);

  const alignedBullish = bias === '偏强' && trend === 'BULL' && (risk === '常规波动' || risk === '波动升温');
  const alignedBearish = bias === '偏弱' && trend === 'BEAR';
  const signalStrength: MarketTechnicalSignalStrength = dataQuality === 'low'
    ? 'weak'
    : alignedBullish || alignedBearish || riskLevel === 'CRITICAL'
      ? 'strong'
      : 'moderate';

  const bullets = dataQuality === 'low' && riskLevel !== 'CRITICAL'
    ? [
        '数据质量偏低：关键技术因子缺失、fallback 或置信度不足。',
        `短线读数：ROC ${pct(roc)}，RSI ${numberLabel(rsi, 1)}，仅作保守观察。`,
        `趋势读数：${trend} / ${vol}，不输出强判断。`,
      ]
    : [
        `动量：ROC ${pct(roc)}，MACD 柱 ${numberLabel(macd)}，动能变化 ${numberLabel(macdStrength)}。`,
        `冷热：RSI ${numberLabel(rsi, 1)}，BB %B ${numberLabel(percentB, 2)}，${percentB >= 0.9 ? '贴近上沿' : percentB <= 0.25 ? '贴近下沿' : '位于中段'}。`,
        `趋势：${trend}，波动 ${vol}，风险 ${riskLevel}。`,
      ];

  return {
    bias,
    risk,
    riskLevel,
    trend,
    vol,
    narrative,
    signalStrength,
    dataQuality,
    totalRisk,
    evidence,
    bullets,
    groups: {
      momentum: `${pct(roc)} · MACD ${numberLabel(macdStrength)}`,
      overheatPullback: `RSI ${numberLabel(rsi, 1)} · %B ${numberLabel(percentB, 2)}`,
      volatility: `HV ${numberLabel(hv5 * 100, 1)}% / ${numberLabel(hv20 * 100, 1)}%`,
      trend: `${trend} · ${vol}`,
    },
  };
}
