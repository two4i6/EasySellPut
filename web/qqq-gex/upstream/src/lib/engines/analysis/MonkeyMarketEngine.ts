import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { indicatorEngine } from '../indicators/IndicatorEngine';
import { fetchHistoricalData, fetchYahooFinanceData } from '../../../services/adapters/yahooFinance';
import { computeIndicators, OHLCVBar } from '../../indicators';
import { isValidPrice, isValidATR, auditConfidence, getFactorValue as getFV } from '../../factor';

export interface OverrideResult {
  triggered: boolean;
  overrideScore: number;
  reasons: string[];
}

export interface MonkeyMarketSystem {
  timestamp: string;
  factors: FactorMap;
  monkeySystem: {
    score: FinancialFactor<number>;
    status: FinancialFactor<'Trend Market' | 'Choppy Market' | 'High Risk Chop' | 'Monkey Market'>;
    isOverride: FinancialFactor<boolean>;
    overrideDetail?: FinancialFactor<OverrideResult>;
    components: {
      volExpansionScore: FinancialFactor<number>;
      flipImpactScore: FinancialFactor<number>;
      rangeExpansionScore: FinancialFactor<number>;
      trendWeaknessScore: FinancialFactor<number>;
      volRegimeChangeScore: FinancialFactor<number>;
    };
    dimensionScores?: {
      volatilityDimension: FinancialFactor<number>;
      structureDimension: FinancialFactor<number>;
      stabilityDimension: FinancialFactor<number>;
    };
    metrics: FinancialFactor<{
      price: number;
      hv5: number;
      hv20: number;
      hvRatio: number;
      atr14: number;
      atrMean60: number;
      flipRate: number;
      avgFlipReturn: number;
      trendConsistency: number;
      volAcceleration: number;
    }>;
    advisory: FinancialFactor<{
      riskState: 'stable' | 'caution' | 'defensive' | 'avoid_premium';
      exposureBias: 'normal' | 'reduced' | 'minimal' | 'standby';
    }>;
    diagnostics?: FinancialFactor<{
      lowConfidenceFactors: string[];
      topContributors: string[];
      conflictingSignals: string[];
      stabilityFlag: boolean;
    }>;
  };
}

export class MonkeyMarketEngine extends FactorEngine {
  /**
   * Deep factor integrated calculation
   */
  public async fetchAndCalculate(symbol: string): Promise<MonkeyMarketSystem | null> {
    try {
      const [priceData, historyData] = await Promise.all([
        fetchYahooFinanceData(symbol),
        fetchHistoricalData(symbol, '6mo')
      ]);

      if (!priceData || !historyData?.value?.chart?.result?.[0]) return null;

      const currentPrice = priceData.value.price;
      const chartResult = historyData.value.chart.result[0];
      const indicators = chartResult.indicators.quote[0];
      
      const closes = indicators.close.filter((c: any): c is number => c !== null);
      const highs = indicators.high.filter((h: any): h is number => h !== null);
      const lows = indicators.low.filter((l: any): l is number => l !== null);
      
      if (closes.length < 60) return null;

      const bars: OHLCVBar[] = closes.map((c: number, i: number) => ({
        time: i,
        open: c, high: highs[i], low: lows[i], close: c, volume: 0
      }));

      const results = computeIndicators(bars);
      const lastIdx = results.ma_7.length - 1;

      const hv5 = results.hv_5[lastIdx]?.value ?? 20;
      const hv20 = results.hv_20[lastIdx]?.value ?? 20;
      const hvRatio = results.hv_ratio[lastIdx]?.value ?? 1;

      const prevIdx = Math.max(0, lastIdx - 3);
      const hvRatio_prev = results.hv_ratio[prevIdx]?.value ?? 1;

      const { flipRate, avgAbsReturn } = this.calculateFlipMetrics(closes.slice(-20));

      const atr14 = results.atr[lastIdx]?.value ?? 0;
      const atrMean60 = results.atr_mean_60[lastIdx]?.value ?? (atr14 > 0 ? atr14 : 1);
      const volAcceleration = results.vol_acceleration[lastIdx]?.value ?? 0;

      const ma7 = results.ma_7[lastIdx]?.value ?? currentPrice;
      const ma30 = results.ma_30[lastIdx]?.value ?? currentPrice;
      const trendStrength = Math.abs(ma7 - ma30) / currentPrice;
      const trendConsistency = this.calculateTrendConsistency(closes.slice(-15));

      const factors: FactorMap = {
        symbol: { value: symbol, confidence: 10, source: { type: 'manual', description: 'Symbol' } },
        price: isValidPrice(currentPrice)
          ? this.raw(currentPrice, 'Market')
          : this.fallback(0, 'Market 返回无效价格'),
        hv5: isValidATR(hv5)
          ? this.raw(hv5, 'Indicators')
          : this.fallback(0, 'HV5 无效'),
        hv20: isValidATR(hv20)
          ? this.raw(hv20, 'Indicators')
          : this.fallback(0, 'HV20 无效'),
        hv_ratio: isValidATR(hvRatio)
          ? this.raw(hvRatio, 'Indicators')
          : this.fallback(1, 'HV Ratio 无效'),
        hv_ratio_prev: isValidATR(hvRatio_prev)
          ? this.raw(hvRatio_prev, 'Indicators')
          : this.fallback(1, 'HV Ratio Prev 无效'),
        flip_rate: !isNaN(flipRate)
          ? this.raw(flipRate, 'Indicators')
          : this.fallback(0, 'Flip Rate 无效'),
        avg_abs_return: !isNaN(avgAbsReturn)
          ? this.raw(avgAbsReturn, 'Indicators')
          : this.fallback(0, 'Avg Abs Return 无效'),
        atr14: isValidATR(atr14)
          ? this.raw(atr14, 'Indicators')
          : this.fallback(0, 'ATR14 无效'),
        atr_mean_60: isValidATR(atrMean60)
          ? this.raw(atrMean60, 'Indicators')
          : this.fallback(1, 'ATR Mean 60 无效'),
        trend_strength: !isNaN(trendStrength)
          ? this.raw(trendStrength, 'Indicators')
          : this.fallback(0, 'Trend Strength 无效'),
        trend_consistency: !isNaN(trendConsistency)
          ? this.raw(trendConsistency, 'Indicators')
          : this.fallback(0.5, 'Trend Consistency 无效'),
        vol_acceleration: !isNaN(volAcceleration)
          ? this.raw(volAcceleration, 'Indicators')
          : this.fallback(0, 'Vol Acceleration 无效')
      };

      return this.assembleMonkeySystem(factors);
    } catch (e) {
      return null;
    }
  }

  private assembleMonkeySystem(factors: FactorMap): MonkeyMarketSystem {
    const hvRatio = getFV<number>(factors, 'hv_ratio') ?? 1;
    const hvRatioPrev = getFV<number>(factors, 'hv_ratio_prev') ?? 1;
    const flipRate = getFV<number>(factors, 'flip_rate') ?? 0;
    const avgAbsReturn = getFV<number>(factors, 'avg_abs_return') ?? 0;
    const atr14 = getFV<number>(factors, 'atr14') ?? 1;
    const atrMean60 = getFV<number>(factors, 'atr_mean_60') ?? 1;
    const trendStrength = getFV<number>(factors, 'trend_strength') ?? 0;
    const trendConsistency = getFV<number>(factors, 'trend_consistency') ?? 0.5;

    // 1. Component scores normalized to factors
    const volExpansionScoreRaw = Math.min(1, Math.max(0, (hvRatio - 1.0) / 1.0));
    const volExpansionScore = this.derived(Math.round(volExpansionScoreRaw * 100), [{ factorId: 'hv_ratio', weight: 1.0 }], factors);

    const flipImpact = flipRate * (avgAbsReturn * 100);
    const flipImpactScore = this.derived(Math.round(Math.min(1, Math.max(0, flipImpact / 1.5)) * 100), [{ factorId: 'flip_rate', weight: 0.5 }, { factorId: 'avg_abs_return', weight: 0.5 }], factors);

    const rangeRatio = atrMean60 > 0 ? atr14 / atrMean60 : 1;
    const rangeExpansionScore = this.derived(Math.round(Math.min(1, Math.max(0, (rangeRatio - 1.0) / 1.0)) * 100), [{ factorId: 'atr14', weight: 0.5 }, { factorId: 'atr_mean_60', weight: 0.5 }], factors);

    const trendThreshold = atrMean60 > 0 ? (atrMean60 / (factors.price?.value ?? 0)) * 5 : 0.03;
    const trendWeaknessRaw = Math.min(1, Math.max(0, (1 - (trendStrength / trendThreshold)) * (1 - trendConsistency)));
    const trendWeaknessScore = this.derived(Math.round(trendWeaknessRaw * 100), [{ factorId: 'trend_strength', weight: 0.5 }, { factorId: 'trend_consistency', weight: 0.5 }], factors);

    const volRegimeChange = hvRatio - hvRatioPrev;
    const volRegimeChangeScore = this.derived(Math.round(Math.min(1, Math.max(0, volRegimeChange / 0.3)) * 100), [{ factorId: 'hv_ratio', weight: 0.5 }, { factorId: 'hv_ratio_prev', weight: 0.5 }], factors);

    // 2. Dimensions
    const volatilityDimension = this.derived(
      volExpansionScore.value * 0.5 + volRegimeChangeScore.value * 0.5,
      [{ factorId: 'hv_ratio', weight: 0.75 }, { factorId: 'hv_ratio_prev', weight: 0.25 }],
      factors
    );

    const structureDimension = this.derived(
      flipImpactScore.value * 0.6 + trendWeaknessScore.value * 0.4,
      [{ factorId: 'flip_rate', weight: 0.4 }, { factorId: 'trend_strength', weight: 0.3 }, { factorId: 'trend_consistency', weight: 0.3 }],
      factors
    );

    const stabilityDimension = this.derived(
      rangeExpansionScore.value * 1.0,
      [{ factorId: 'atr14', weight: 0.5 }, { factorId: 'atr_mean_60', weight: 0.5 }],
      factors
    );

    // 3. Final Score Calculation
    let finalScore = (
      volatilityDimension.value * 0.40 +
      structureDimension.value * 0.35 +
      stabilityDimension.value * 0.25
    );

    // 4. Override Logic
    const reasons: string[] = [];
    if (hvRatio > 1.6) reasons.push('High HV Ratio (>1.6)');
    if (flipRate > 0.6) reasons.push('Frequent Price Flips (>0.6)');
    if (rangeRatio > 1.3) reasons.push('ATR Range Expansion (>1.3)');

    const overrideScore = reasons.length * 33.3;
    const triggered = reasons.length === 3; // Trigger only if all 3 conditions met (original logic hvRatio > 1.6 && flipRate > 0.6 && rangeRatio > 1.3)
    
    if (triggered) {
      finalScore = Math.max(finalScore, 85);
    }

    const score = this.derived(Math.round(finalScore), [
      { factorId: 'hv_ratio', weight: 0.4 },
      { factorId: 'flip_rate', weight: 0.3 },
      { factorId: 'atr14', weight: 0.3 }
    ], factors);

    const status = this.derived(this.determineRegime(score.value, volatilityDimension.value, structureDimension.value), [
      { factorId: 'hv_ratio', weight: 0.4 },
      { factorId: 'flip_rate', weight: 0.3 },
      { factorId: 'atr14', weight: 0.3 }
    ], factors);

    const metrics = this.derived({
      price: factors.price?.value ?? 0,
      hv5: factors.hv5?.value ?? 0,
      hv20: factors.hv20?.value ?? 0,
      hvRatio: Math.round(hvRatio * 100) / 100,
      atr14: Math.round(atr14 * 100) / 100,
      atrMean60: Math.round(atrMean60 * 100) / 100,
      flipRate: Math.round(flipRate * 100) / 100,
      avgFlipReturn: Math.round(avgAbsReturn * 10000) / 100,
      trendConsistency: Math.round(trendConsistency * 100) / 100,
      volAcceleration: factors.vol_acceleration?.value ?? 0
    }, [{ factorId: 'price', weight: 1.0 }], factors);

    const advisory = this.derived(this.generateAdvisory(score.value), [
      { factorId: 'hv_ratio', weight: 0.4 },
      { factorId: 'flip_rate', weight: 0.3 },
      { factorId: 'atr14', weight: 0.3 }
    ], factors);

    // 5. Diagnostics
    const audit = auditConfidence(factors, ['hv_ratio', 'flip_rate', 'atr14', 'trend_strength', 'trend_consistency']);
    
    // Top contributors calculation
    // volExpansion: hv_ratio (0.4 * 0.5 * 1.0 = 0.2)
    // volRegimeChange: hv_ratio (0.4 * 0.5 * 0.5 = 0.1), hv_ratio_prev (0.4 * 0.5 * 0.5 = 0.1)
    // flipImpact: flip_rate (0.35 * 0.6 * 0.5 = 0.105), avg_abs_return (0.35 * 0.6 * 0.5 = 0.105)
    // trendWeakness: trend_strength (0.35 * 0.4 * 0.5 = 0.07), trend_consistency (0.35 * 0.4 * 0.5 = 0.07)
    // rangeExpansion: atr14 (0.25 * 1.0 * 0.5 = 0.125), atr_mean_60 (0.25 * 1.0 * 0.5 = 0.125)
    
    const contributors = [
      { id: 'hv_ratio', weight: 0.3 }, // 0.2 + 0.1
      { id: 'hv_ratio_prev', weight: 0.1 },
      { id: 'flip_rate', weight: 0.105 },
      { id: 'avg_abs_return', weight: 0.105 },
      { id: 'atr14', weight: 0.125 },
      { id: 'atr_mean_60', weight: 0.125 },
      { id: 'trend_strength', weight: 0.07 },
      { id: 'trend_consistency', weight: 0.07 }
    ].sort((a, b) => b.weight - a.weight);

    const topContributors = contributors.slice(0, 3).map(c => c.id);

    const conflictingSignals: string[] = [];
    if (hvRatio > 1.3 && trendConsistency > 0.6) conflictingSignals.push('hv_ratio vs trend_consistency');
    if (flipRate > 0.5 && (factors.trend_strength?.value ?? 0) > 0.02) conflictingSignals.push('flip_rate vs trend_strength');

    const diagnostics = this.derived({
      lowConfidenceFactors: audit.lowConfidenceFactors,
      topContributors,
      conflictingSignals,
      stabilityFlag: flipRate > 0.5
    }, [{ factorId: 'hv_ratio', weight: 0.5 }, { factorId: 'flip_rate', weight: 0.5 }], factors);

    return {
      timestamp: new Date().toISOString(),
      factors,
      monkeySystem: {
        score,
        status,
        isOverride: this.manual(triggered, 'Non-linear override check'),
        overrideDetail: this.manual({ triggered, overrideScore, reasons }, reasons.join('; ')),
        components: {
          volExpansionScore,
          flipImpactScore,
          rangeExpansionScore,
          trendWeaknessScore,
          volRegimeChangeScore
        },
        dimensionScores: {
          volatilityDimension,
          structureDimension,
          stabilityDimension
        },
        metrics,
        advisory,
        diagnostics
      }
    };
  }

  private calculateFlipMetrics(prices: number[]): { flipRate: number; avgAbsReturn: number } {
    let flips = 0, totalAbsReturn = 0, lastDir = 0;
    for (let i = 1; i < prices.length; i++) {
      const dailyReturn = (prices[i] - prices[i - 1]) / prices[i - 1];
      const dir = dailyReturn > 0 ? 1 : dailyReturn < 0 ? -1 : lastDir;
      if (lastDir !== 0 && dir !== lastDir) { flips++; totalAbsReturn += Math.abs(dailyReturn); }
      lastDir = dir;
    }
    return { flipRate: flips / (prices.length - 1), avgAbsReturn: flips > 0 ? totalAbsReturn / flips : 0 };
  }

  private calculateTrendConsistency(prices: number[]): number {
    if (prices.length < 2) return 0;
    const total = prices.length - 1;
    let upDays = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) upDays++;
    }
    // 全部持平时返回 0
    if (upDays === 0 && prices.every(p => p === prices[0])) return 0;
    return Math.abs((upDays / total) - 0.5) * 2;
  }

  private determineRegime(
    score: number,
    volatilityDimension: number,
    structureDimension: number
  ): MonkeyMarketSystem['monkeySystem']['status']['value'] {
    if (score < 30) {
      // 低波动 + 低结构混乱 = 真趋势
      if (volatilityDimension < 40 && structureDimension < 35) return 'Trend Market';
      // 低波动但结构混乱 = 低波动震荡
      return 'Choppy Market';
    }
    if (score < 60) return 'Choppy Market';
    if (score < 80) return 'High Risk Chop';
    return 'Monkey Market';
  }

  private generateAdvisory(score: number): MonkeyMarketSystem['monkeySystem']['advisory']['value'] {
    if (score < 30) {
      return {
        riskState: 'stable',
        exposureBias: 'normal',
      };
    }
    if (score < 60) {
      return {
        riskState: 'caution',
        exposureBias: 'reduced',
      };
    }
    if (score < 80) {
      return {
        riskState: 'defensive',
        exposureBias: 'minimal',
      };
    }
    return {
      riskState: 'avoid_premium',
      exposureBias: 'standby',
    };
  }
}

export const monkeyMarketEngine = new MonkeyMarketEngine();
