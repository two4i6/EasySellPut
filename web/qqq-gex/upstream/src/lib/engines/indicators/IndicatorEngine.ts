import { FactorEngine } from '../../FactorEngine';
import { type HistoricalData } from '../../../services/adapters/marketDataService';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { isValidPrice, createDerivedFactor } from '../../factor';
import { computeIndicators, toFactorMap, OHLCVBar, IVDataPoint, volatility } from '../../indicators';

const MA_PERIODS = [7, 14, 20, 30, 60, 200];

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface RSIData {
  rsi: number;
  isOverbought: boolean;
  isOversold: boolean;
}

export interface TrendData {
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
  aboveMA7: boolean;
  aboveMA14: boolean;
  aboveMA30: boolean;
  aboveMA60: boolean;
}

export interface VolatilityMetrics {
  currentIV: number;
  currentHV: number;
  ivRank: number;
  ivPercentile: number;
  ivHVRatio: number;
}

export class IndicatorEngine extends FactorEngine {
  private factorCache = new WeakMap<any, FactorMap>();
  private barsCache = new WeakMap<any, OHLCVBar[]>();

  /**
   * 将价格数组转换为 OHLCVBar[]
   */
  private toBars(prices: number[]): OHLCVBar[] {
    if (!prices || !Array.isArray(prices)) return [];
    if (this.barsCache.has(prices)) return this.barsCache.get(prices)!;
    
    const now = Math.floor(Date.now() / 1000);
    const bars = prices.map((p, i) => ({
      // 确保时间戳每天拉开，避免同秒导致指标计算失效
      time: now - (prices.length - i) * 86400,
      open: p, high: p, low: p, close: p, volume: 0
    }));
    this.barsCache.set(prices, bars);
    return bars;
  }

  /**
   * 核心适配器：将 HistoricalData 转换为 FactorMap
   */
  private getIndicatorFactors(historicalData: HistoricalData[] | OHLCVBar[], ivHistory?: number[]): FactorMap {
    if (!historicalData) return {};
    
    // 使用 WeakMap 缓存，仅在无 ivHistory 时复用相同的 historicalData 缓存
    if (!ivHistory && typeof historicalData === 'object' && this.factorCache.has(historicalData)) {
      return this.factorCache.get(historicalData)!;
    }
    
    const bars: OHLCVBar[] = (historicalData as any[]).map(d => {
      if (d && 'close' in d && !('date' in d)) return d as OHLCVBar;
      const close = d?.close || 0;
      return {
        time: d && d.date ? Math.floor(new Date(d.date).getTime() / 1000) : 0,
        open: d?.open ?? close,
        high: d?.high ?? close,
        low: d?.low ?? close,
        close: close,
        volume: d?.volume || 0
      };
    });

    const ivData: IVDataPoint[] | undefined = ivHistory?.map((iv, i) => ({
      time: bars[i]?.time || 0,
      iv: iv / 100 // Convert percentage to decimal
    }));

    const result = computeIndicators(bars, ivData);
    const factorMap = toFactorMap(result);
    
    if (!ivHistory && typeof historicalData === 'object') {
      this.factorCache.set(historicalData, factorMap);
    }
    return factorMap;
  }

  /**
   * 计算移动平均线因子
   */
  calculateMovingAverages(pricesFactor: FinancialFactor<number[]>): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    const factors: FactorMap = {};
    MA_PERIODS.forEach(p => {
      const key = `ma_${p}`;
      factors[`ma${p}`] = allFactors[key] || this.fallback(0, `MA${p} calculation failed`);
    });
    return factors;
  }

  /**
   * 计算 RSI 因子 (多周期)
   */
  calculateRSIFactors(pricesFactor: FinancialFactor<number[]>, _period: number = 14): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    const result: FactorMap = {};

    result['rsi'] = allFactors['rsi_14'] || this.fallback(50, 'RSI 14 calculation failed');
    result['rsi_7'] = allFactors['rsi_7'] || this.fallback(50, 'RSI 7 calculation failed');
    result['rsi_21'] = allFactors['rsi_21'] || this.fallback(50, 'RSI 21 calculation failed');
    
    result.rsi_overbought = allFactors['rsi_overbought'] || this.derived(false, [{ factorId: 'rsi', weight: 1.0 }], result);
    result.rsi_oversold   = allFactors['rsi_oversold'] || this.derived(false, [{ factorId: 'rsi', weight: 1.0 }], result);

    return result;
  }

  /**
   * 计算 RSI 斜率因子
   */
  public calculateRSISlopeFactor(pricesFactor: FinancialFactor<number[]>, _period: number = 14, _lookback: number = 3): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    return {
      rsi_slope: allFactors['rsi_slope'] || this.fallback(0, 'RSI Slope calculation failed'),
    };
  }

  /**
   * 计算 MACD 动能强度因子
   */
  public calculateMACDMomentumFactor(pricesFactor: FinancialFactor<number[]>): FactorMap {
    const bars = this.toBars(pricesFactor.value);
    if (bars.length < 2) {
      return {
        macd_histogram_prev:    this.fallback(0, 'Insufficient data for prev Hist'),
        macd_momentum_strength: this.fallback(0, 'Insufficient data for momentum strength'),
      };
    }

    const allFactors = this.getIndicatorFactors(bars);
    const currentHist = (allFactors['macd_histogram']?.value as number) ?? 0;
    
    const prevFactors = this.getIndicatorFactors(bars.slice(0, -1));
    const prevHist = (prevFactors['macd_histogram']?.value as number) ?? 0;

    const strength = round2(currentHist - prevHist);

    return {
      macd_histogram_prev:    this.derived(prevHist, [{ factorId: 'base_prices', weight: 1.0 }], { base_prices: pricesFactor }),
      macd_momentum_strength: this.derived(strength, [{ factorId: 'base_prices', weight: 1.0 }], { base_prices: pricesFactor }),
    };
  }

/**
 * 计算 HV (Historical Volatility)
 */
public calculateHV(pricesFactor: FinancialFactor<number[]>, period: number = 20): number | null {
  const prices = pricesFactor?.value ?? [];
  if (!Number.isInteger(period) || period < 2 || prices.length < period + 1 || pricesFactor.confidence <= 0
    || prices.slice(-period - 1).some(price => !Number.isFinite(price) || price <= 0)) return null;
  const raw = volatility.calculateHV(prices, prices.map((_, index) => index), period).at(-1)?.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** Rolling HV; NaN is an unavailable sample, never a fabricated volatility. */
public calculateHVHistory(pricesFactor: FinancialFactor<number[]>, period: number = 20): number[] {
  const prices = pricesFactor?.value ?? [];
  if (pricesFactor.confidence <= 0 || !Number.isInteger(period) || period < 2) return prices.map(() => NaN);
  return volatility.calculateHV(prices, prices.map((_, index) => index), period).map((point, index) =>
    prices.slice(Math.max(0, index - period), index + 1).some(price => !Number.isFinite(price) || price <= 0)
      ? NaN : point.value ?? NaN);
}

/**
 * 基于 HV 代理值计算 IV Rank 和 Percentile
 */
public calculateIVRankFromHVProxy(currentIv: number, hvHistory: number[]): { rank: number; percentile: number } {
  const validHV = hvHistory.filter(v => Number.isFinite(v) && v >= 0);
  if (validHV.length === 0) {
    return { rank: 50, percentile: 50 };
  }

  const minHv = Math.min(...validHV.slice(-252));
  const maxHv = Math.max(...validHV.slice(-252));
  
  let rank = 50;
  if (maxHv > minHv) {
    rank = ((currentIv - minHv) / (maxHv - minHv)) * 100;
  }
  rank = Math.min(100, Math.max(0, rank));

  const count = validHV.slice(-252).filter(v => v < currentIv).length;
  const percentile = (count / Math.min(validHV.length, 252)) * 100;

  return { 
    rank: Number(rank.toFixed(2)), 
    percentile: Number(percentile.toFixed(2)) 
  };
}

/**
 * 计算 60 日 ATR 均值
 */
public calculateATRMean60(historicalDataFactor: FinancialFactor<HistoricalData[]>): number {
  const allFactors = this.getIndicatorFactors(historicalDataFactor.value);
  return (allFactors['atr_mean_60']?.value as number) ?? 85;
}

/**
 * 计算 ATR
 */
public calculateATR(historicalDataFactor: FinancialFactor<HistoricalData[]>, period: number = 14): { 
  atr: number, 
  atrPercent: number, 
  atrState: string, 
  atrShockWeight: number,
  atrRatio: number
} {
  const bars: OHLCVBar[] = (historicalDataFactor.value as any[]).map(d => {
    if (d && 'close' in d && !('date' in d)) return d as OHLCVBar;
    const close = d?.close || 0;
    return {
      time: d && d.date ? Math.floor(new Date(d.date).getTime() / 1000) : 0,
      open: d?.open ?? close,
      high: d?.high ?? close,
      low: d?.low ?? close,
      close: close,
      volume: d?.volume || 0
    };
    });

    const { atr, atr_percent, atr_state, atr_shock_weight } = computeIndicators(bars);

    // 计算 60 日 ATR 用于比率
    const { atr: atr60Series } = volatility.calculateATR(bars, 60);
    const atrVal = atr[atr.length - 1]?.value ?? 0;
    const atr60Val = atr60Series[atr60Series.length - 1]?.value ?? 0;

    return {
    atr: atrVal,
    atrPercent: atr_percent[atr_percent.length - 1]?.value ?? 0,
    atrState: (atr_state[atr_state.length - 1]?.value as string) ?? 'NORMAL',
    atrShockWeight: atr_shock_weight[atr_shock_weight.length - 1]?.value ?? 0,
    atrRatio: atr60Val > 0 ? atrVal / atr60Val : 1
    };
    }

  /**
   * 计算 ATR 因子
   */
  calculateATRFactors(historicalDataFactor: FinancialFactor<HistoricalData[]>, _period: number = 14): FactorMap {
    const allFactors = this.getIndicatorFactors(historicalDataFactor.value);
    return {
      atr: allFactors['atr'] || this.fallback(0, 'ATR calculation failed'),
      atr_percent: allFactors['atr_percent'] || this.fallback(0, 'ATR Percent calculation failed'),
      atr_state: allFactors['atr_state'] || this.fallback('NORMAL', 'ATR State calculation failed'),
      atr_shock_weight: allFactors['atr_shock_weight'] || this.fallback(0, 'ATR Shock Weight calculation failed'),
      atr_mean_60: allFactors['atr_mean_60'] || this.fallback(0, 'ATR Mean 60 calculation failed')
    };
  }

  /**
   * 计算成交量/价格量价关系因子
   */
  public calculateVolumePriceFactors(historicalDataFactor: FinancialFactor<HistoricalData[]>): FactorMap {
    const allFactors = this.getIndicatorFactors(historicalDataFactor.value);
    return {
      vol_price_regime: allFactors['vol_price_regime'] || this.fallback(null, 'Volume/Price regime calculation failed'),
      volume: allFactors['volume'] || this.fallback(0, 'Volume calculation failed'),
      volume_ma20: allFactors['volume_ma_20'] || this.fallback(0, 'Volume MA 20 calculation failed')
    };
  }

  /**
   * 分析趋势强度因子 (派生因子)
   */
  analyzeTrendFactors(
    currentPriceFactor: FinancialFactor<number>, 
    priceFactors: FactorMap,
    rsiFactors: FactorMap
  ): FactorMap {
    const factors: FactorMap = {};
    const currentPrice = currentPriceFactor.value;

    const maKeys = ['ma7', 'ma14', 'ma30', 'ma60', 'ma200'];
    const aboveCount = maKeys.filter(k => currentPrice > (priceFactors[k]?.value as number || 0)).length;

    let strength = 50; 
    if (aboveCount >= 3 && (rsiFactors.rsi?.value as number || 0) > 50) {
      strength = 75 + (aboveCount * 4); // Adjusted weight slightly for 5 MAs
    } else if (aboveCount <= 1 && (rsiFactors.rsi?.value as number || 0) < 50) {
      strength = 75 + ((5 - aboveCount) * 4);
    }

    const combinedFactors: FactorMap = { 
      ...priceFactors, 
      ...rsiFactors,
      'current_price': currentPriceFactor
    };

    factors.trend_strength = this.derived(
      Math.min(100, Math.max(0, strength)),
      [
        { factorId: 'ma7', weight: 0.15 },
        { factorId: 'ma14', weight: 0.15 },
        { factorId: 'ma30', weight: 0.15 },
        { factorId: 'ma60', weight: 0.15 },
        { factorId: 'rsi', weight: 0.2 },
        { factorId: 'current_price', weight: 0.2 }
      ],
      combinedFactors
    );

    return factors;
  }

  /**
   * 波动率指标因子
   */
  calculateVolatilityFactors(
    currentIVFactor: FinancialFactor<number>,
    currentHVFactor: FinancialFactor<number>,
    ivHistoryFactor: FinancialFactor<number[]>
  ): FactorMap {
    const factors: FactorMap = {};
    const currentIV = currentIVFactor.value; // 统一为小数，如 0.3 代表 30%
    const currentHV = currentHVFactor.value; // 通常为小数，如 0.2 代表 20%
    const ivHistory = ivHistoryFactor.value;

    const allFactors = this.getIndicatorFactors(this.toBars(ivHistory), ivHistory);

    factors.iv_rank = allFactors['iv_rank'] || this.fallback(50, 'IV Rank failed');
    factors.iv_percentile = allFactors['iv_percentile'] || this.fallback(50, 'IV Percentile failed');
    
    // 统一单位为小数进行比例计算。如果传入的是百分比(>2)，则转换为小数
    const ivDecimal = currentIV > 2 ? currentIV / 100 : currentIV;
    const hvDecimal = currentHV;
    
    factors.iv_hv_ratio = currentIVFactor.confidence > 0 && currentHVFactor.confidence > 0
      && Number.isFinite(ivDecimal) && ivDecimal > 0 && Number.isFinite(hvDecimal) && hvDecimal > 0
      ? this.derived(round2(ivDecimal / hvDecimal),
        [{ factorId: 'current_iv', weight: 0.5 }, { factorId: 'current_hv', weight: 0.5 }],
        { current_iv: currentIVFactor, current_hv: currentHVFactor })
      : this.fallback(null, 'IV/HV requires available IV and strictly positive HV');

    return factors;
  }

  public calculateSMA(pricesFactor: FinancialFactor<number[]>, period: number): number {
    const prices = pricesFactor?.value || [];
    if (prices.length < period) return 0;
    
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    const key = `ma_${period}`;
    // 优先取精确周期，否则取数组长度对应的周期（针对边界情况）
    const val = allFactors[key]?.value ?? allFactors[`ma_${prices.length}`]?.value;
    return (val as number) ?? 0;
  }

  public calculateRSI(pricesFactor: FinancialFactor<number[]>, period: number = 14): number {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    const key = `rsi_${period}`;
    return (allFactors[key]?.value as number) ?? 50;
  }

  /**
   * 计算 RSI 及其昨日差值
   */
  public calculateRSIWithChange(pricesFactor: FinancialFactor<number[]>, period: number = 14): { current: number; previous: number; change: number } {
    const prices = pricesFactor?.value || [];
    if (prices.length < period + 1) {
      return { current: 50, previous: 50, change: 0 };
    }

    const current = this.calculateRSI(pricesFactor, period);
    
    const prevFactor = {
      ...pricesFactor,
      value: prices.slice(0, -1)
    };
    const previous = this.calculateRSI(prevFactor, period);
    
    return {
      current: Number(current.toFixed(2)),
      previous: Number(previous.toFixed(2)),
      change: Number((current - previous).toFixed(2))
    };
  }

  public calculateIVPercentile(currentIVFactor: FinancialFactor<number>, ivHistoryFactor: FinancialFactor<number[]>): number {
    const ivHistory = ivHistoryFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(ivHistory), ivHistory);
    return (allFactors['iv_percentile']?.value as number) ?? 50;
  }

  /**
   * 计算 MACD 因子
   */
  public calculateMACDFactors(
    pricesFactor: FinancialFactor<number[]>,
    _fast: number = 12,
    _slow: number = 26,
    _signal: number = 9
  ): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    
    const getFactor = (key: string, name: string) => {
      const f = allFactors[key];
      if (!f || f.value === null) {
        return this.fallback(0, `${name} failed`);
      }
      return f;
    };

    return {
      macd_line: getFactor('macd_line', 'MACD Line'),
      macd_signal: getFactor('macd_signal', 'MACD Signal'),
      macd_histogram: getFactor('macd_histogram', 'MACD Hist')
    };
  }

  /**
   * 计算 Bollinger Bands 因子
   */
  public calculateBBFactors(
    pricesFactor: FinancialFactor<number[]>,
    _period: number = 20,
    _multiplier: number = 2
  ): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    return {
      bb_upper: allFactors['bb_upper'] || this.fallback(0, 'BB Upper failed'),
      bb_lower: allFactors['bb_lower'] || this.fallback(0, 'BB Lower failed'),
      bb_middle: allFactors['bb_middle'] || this.fallback(0, 'BB Middle failed'),
      bb_width: allFactors['bb_width'] || this.fallback(0, 'BB Width failed'),
      bb_percent_b: allFactors['bb_percent_b'] || this.fallback(0, 'BB %B failed')
    };
  }

  /**
   * 计算价格偏离度 (Price Extension)
   * (price - ma7) / atr
   */
  public calculatePriceExtension(price: number, ma7: number, atr: number): number {
    if (atr <= 0) return 0;
    return round2((price - ma7) / atr);
  }

  /**
   * 计算价格变化率 (Rate of Change) 因子
   */
  public calculateROCFactors(
    pricesFactor: FinancialFactor<number[]>,
    periods: number[] = [5, 10, 20]
  ): FactorMap {
    const prices = pricesFactor?.value || [];
    const allFactors = this.getIndicatorFactors(this.toBars(prices));
    const result: FactorMap = {};
    periods.forEach(p => {
      const key = `roc_${p}d`;
      result[`price_roc_${p}d`] = allFactors[key] || this.fallback(0, `ROC ${p}d failed`);
    });
    return result;
  }

  /**
   * 计算 Keltner Channel 因子
   */
  public calculateKCFactors(historicalDataFactor: FinancialFactor<HistoricalData[]>): FactorMap {
    const allFactors = this.getIndicatorFactors(historicalDataFactor.value);
    
    const kc_upper = allFactors['kc_upper'] || this.fallback(0, 'KC Upper failed');
    const kc_lower = allFactors['kc_lower'] || this.fallback(0, 'KC Lower failed');
    const kc_middle = allFactors['kc_middle'] || this.fallback(0, 'KC Middle failed');

    const result: FactorMap = {
      kc_upper,
      kc_lower,
      kc_middle
    };

    // kc_squeeze — derived bool
    // 逻辑：bb_upper < kc_upper AND bb_lower > kc_lower
    const bb_upper = allFactors['bb_upper'];
    const bb_lower = allFactors['bb_lower'];
    
    if (bb_upper && bb_lower && kc_upper.confidence > 0 && kc_lower.confidence > 0) {
      const squeezeValue = (bb_upper.value as number) < (kc_upper.value as number) && 
                           (bb_lower.value as number) > (kc_lower.value as number);
      result['kc_squeeze'] = this.derived(
        squeezeValue,
        [{ factorId: 'bb_upper', weight: 0.5 }, { factorId: 'kc_upper', weight: 0.5 }],
        { ...allFactors, bb_upper, bb_lower, kc_upper, kc_lower }
      );
    } else {
      result['kc_squeeze'] = this.fallback(false, 'KC Squeeze: BB data missing');
    }

    // kc_position — derived number (0~1)
    // 逻辑：(price - kc_lower) / (kc_upper - kc_lower)
    const priceFactor = allFactors['ma_7'] || allFactors['bb_middle'];
    if (priceFactor && kc_upper.confidence > 0 && kc_lower.confidence > 0) {
      const range = (kc_upper.value as number) - (kc_lower.value as number);
      if (range === 0) {
        result['kc_position'] = this.fallback(0.5, 'KC Position: zero range');
      } else {
        const posValue = ((priceFactor.value as number) - (kc_lower.value as number)) / range;
        result['kc_position'] = this.derived(
          posValue,
          [{ factorId: 'kc_upper', weight: 0.5 }, { factorId: 'kc_lower', weight: 0.5 }],
          { ...allFactors, kc_upper, kc_lower }
        );
      }
    } else {
      result['kc_position'] = this.fallback(0.5, 'KC Position: data missing');
    }

    return result;
  }

  /**
   * 计算 VWAP 因子
   */
  public calculateVWAPFactor(historicalDataFactor: FinancialFactor<HistoricalData[]>): FactorMap {
    const allFactors = this.getIndicatorFactors(historicalDataFactor.value);
    const vwapRaw = allFactors['vwap'];
    const bb_middle = allFactors['bb_middle'];

    const result: FactorMap = {};

    if (vwapRaw) {
      const vwap = { ...vwapRaw };
      vwap.confidence = Math.min(vwap.confidence, 8);
      result['vwap'] = vwap;
    } else {
      result['vwap'] = this.fallback(0, 'VWAP calculation failed');
    }

    // vwap_deviation — derived number
    // 逻辑：(bb_middle - vwap) / vwap
    if (bb_middle && result['vwap'] && (result['vwap'].value as number) !== 0) {
      const vwapValue = result['vwap'].value as number;
      const dev = ((bb_middle.value as number) - vwapValue) / vwapValue;
      result['vwap_deviation'] = this.derived(
        dev,
        [{ factorId: 'bb_middle', weight: 0.5 }, { factorId: 'vwap', weight: 0.5 }],
        { ...allFactors, vwap: result['vwap'], bb_middle }
      );
    } else {
      const reason = (!result['vwap'] || (result['vwap'].value as number) === 0) 
        ? 'VWAP deviation: zero VWAP' 
        : 'VWAP deviation: BB middle missing';
      result['vwap_deviation'] = this.fallback(0, reason);
    }

    return result;
  }

  /**
   * 计算尾部风险探测因子 (6-Sigma)
   */
  public calculateTailRiskFactors(pricesFactor: FinancialFactor<number[]>): FactorMap {
    const prices = pricesFactor?.value || [];
    
    const fallbackMap = {
      z_score_20: this.fallback(0, 'Data insufficient'),
      z_score_60: this.fallback(0, 'Data insufficient'),
      price_percentile_rank: this.fallback(50, 'Data insufficient'),
      bb_squeeze: this.fallback(false, 'Data insufficient'),
      bb_width_rank: this.fallback(50, 'Data insufficient'),
      log_slope_10: this.fallback(0, 'Data insufficient'),
      log_slope_acceleration: this.fallback(0, 'Data insufficient'),
      kurtosis_20: this.fallback(0, 'Data insufficient')
    };
    
    if (prices.length < 2) return fallbackMap;

    // 1. Z-Score 20 and 60
    const calcZScore = (period: number) => {
      if (prices.length < period) return 0;
      const slice = prices.slice(-period);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const stdDev = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
      return stdDev > 0 ? (prices[prices.length - 1] - mean) / stdDev : 0;
    };
    const z_score_20 = calcZScore(20);
    const z_score_60 = calcZScore(60);

    // 2. price_percentile_rank (252-day)
    const pWindow = prices.slice(-252);
    const currPrice = prices[prices.length - 1];
    const priceRank = pWindow.length > 0 ? (pWindow.filter(p => p <= currPrice).length / pWindow.length) * 100 : 50;

    // 3. BB Width history
    const allIndicators = computeIndicators(this.toBars(prices));
    const bbWidthHistory = allIndicators.bb_width.map(s => s?.value).filter(v => v !== null) as number[];
    const bbWWindow = bbWidthHistory.slice(-252);
    const currBbWidth = bbWidthHistory.length > 0 ? bbWidthHistory[bbWidthHistory.length - 1] : 0;
    
    let bb_width_rank = 50;
    let bb_squeeze = false;
    if (bbWWindow.length > 0) {
      bb_width_rank = (bbWWindow.filter(w => w <= currBbWidth).length / bbWWindow.length) * 100;
      bb_squeeze = bb_width_rank <= 20;
    }

    // 4. Log slope 10 and acceleration
    const calcLogSlope = (slice: number[]) => {
      if (slice.length < 2) return 0;
      const y = slice.map(p => Math.log(p));
      const x = Array.from({ length: y.length }, (_, i) => i);
      const xMean = x.reduce((a, b) => a + b, 0) / x.length;
      const yMean = y.reduce((a, b) => a + b, 0) / y.length;
      let num = 0, den = 0;
      for (let i = 0; i < x.length; i++) {
        num += (x[i] - xMean) * (y[i] - yMean);
        den += Math.pow(x[i] - xMean, 2);
      }
      return den > 0 ? num / den : 0;
    };
    
    const log_slope_10 = prices.length >= 10 ? calcLogSlope(prices.slice(-10)) : 0;
    const prevLogSlope = prices.length >= 20 ? calcLogSlope(prices.slice(-20, -10)) : log_slope_10;
    const log_slope_acceleration = log_slope_10 - prevLogSlope;

    // 5. Kurtosis 20
    let kurtosis_20 = 0;
    if (prices.length >= 21) {
      const slice = prices.slice(-21);
      const returns = [];
      for (let i = 1; i < slice.length; i++) {
        returns.push((slice[i] - slice[i-1]) / slice[i-1]);
      }
      const n = returns.length; // 20
      const mean = returns.reduce((a, b) => a + b, 0) / n;
      const s2 = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const s4 = returns.reduce((a, b) => a + Math.pow(b - mean, 4), 0) / n;
      kurtosis_20 = s2 > 0 ? (s4 / Math.pow(s2, 2)) - 3 : 0; // excess kurtosis
    }

    const dep = [{ factorId: 'base_prices', weight: 1.0 }];
    const baseMap = { base_prices: pricesFactor };

    return {
      z_score_20: this.derived(round2(z_score_20), dep, baseMap),
      z_score_60: this.derived(round2(z_score_60), dep, baseMap),
      price_percentile_rank: this.derived(round2(priceRank), dep, baseMap),
      bb_squeeze: this.derived(bb_squeeze, dep, baseMap),
      bb_width_rank: this.derived(round2(bb_width_rank), dep, baseMap),
      log_slope_10: this.derived(round2(log_slope_10), dep, baseMap),
      log_slope_acceleration: this.derived(round2(log_slope_acceleration), dep, baseMap),
      kurtosis_20: this.derived(round2(kurtosis_20), dep, baseMap)
    };
  }
}

export const indicatorEngine = new IndicatorEngine();
