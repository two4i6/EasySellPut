import { OHLCVBar, IVDataPoint, IndicatorResult, IndicatorSeries, DeepPartial } from './types';
import { IndicatorConfig, DEFAULT_CONFIG } from './config';
import * as trend from './indicators/trend';
import * as momentum from './indicators/momentum';
import * as volatility from './indicators/volatility';
import * as volume from './indicators/volume';
import * as pattern from './indicators/pattern';
import * as composite from './indicators/composite';

export function computeIndicators(
  bars: OHLCVBar[],
  ivData?: IVDataPoint[],
  config?: DeepPartial<IndicatorConfig>
): IndicatorResult {
  const mergedConfig = deepMerge(DEFAULT_CONFIG, config || {}) as IndicatorConfig;
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const times = bars.map(b => b.time);

  // Trend
  const ma_7 = trend.calculateSMA(closes, times, 7);
  const ma_14 = trend.calculateSMA(closes, times, 14);
  const ma_20 = trend.calculateSMA(closes, times, 20);
  const ma_30 = trend.calculateSMA(closes, times, 30);
  const ma_60 = trend.calculateSMA(closes, times, 60);
  const ma_200 = trend.calculateSMA(closes, times, 200);
  const vwap = trend.calculateVWAP(bars, mergedConfig.vwap.sessionBased);
  const macd = trend.calculateMACD(closes, times, mergedConfig.macd.fast, mergedConfig.macd.slow, mergedConfig.macd.signal);
  const arbr = trend.calculateARBR(bars, mergedConfig.arbr.period);
  const crData = trend.calculateCR(bars, mergedConfig.cr.period, mergedConfig.cr.ma);
  const magic9 = trend.calculateMagic9(bars);

  // Momentum
  const rsi_7 = momentum.calculateRSI(closes, times, 7);
  const rsi_14 = momentum.calculateRSI(closes, times, 14);
  const rsi_21 = momentum.calculateRSI(closes, times, 21);
  const rsi_slope = momentum.calculateRSISlope(rsi_14, mergedConfig.rsiSlope.lookback);

  const rsi_overbought: IndicatorSeries<boolean> = rsi_14.map(v => ({
    time: v.time,
    value: v.value !== null ? v.value > 70 : false,
    confidence: v.confidence
  }));
  const rsi_oversold: IndicatorSeries<boolean> = rsi_14.map(v => ({
    time: v.time,
    value: v.value !== null ? v.value < 30 : false,
    confidence: v.confidence
  }));

  const kdj = momentum.calculateKDJ(highs, lows, closes, times, mergedConfig.kdj.kPeriod, mergedConfig.kdj.dPeriod, mergedConfig.kdj.jSmooth);
  const roc_5d = momentum.calculateROC(closes, times, 5);
  const roc_7d = momentum.calculateROC(closes, times, 7);
  const roc_10d = momentum.calculateROC(closes, times, 10);
  const roc_20d = momentum.calculateROC(closes, times, 20);
  const roc_30d = momentum.calculateROC(closes, times, 30);
  const roc_100d = momentum.calculateROC(closes, times, 100);
  const roc_200d = momentum.calculateROC(closes, times, 200);

  // Volatility
  const { atr, atrPercent: atr_percent, atrState: atr_state, atrShockWeight: atr_shock_weight } = volatility.calculateATR(bars, mergedConfig.atr.period);
  const atr_mean_60 = volatility.calculateATRMean(atr, 60);

  const bb = volatility.calculateBB(closes, times, mergedConfig.bb.period, mergedConfig.bb.multiplier);
  const kc = volatility.calculateKC(bars, mergedConfig.kc.period, mergedConfig.kc.multiplier);
  const hv_5 = volatility.calculateHV(closes, times, 5);
  const hv_20 = volatility.calculateHV(closes, times, 20);
  const hv_30 = volatility.calculateHV(closes, times, 30);
  const hv_60 = volatility.calculateHV(closes, times, 60);
  const ivStats = volatility.calculateIVStats(ivData || [], times, mergedConfig.ivWindow);
  
  const vol_surface = volatility.calculateVolSurface(ivStats.iv, mergedConfig.volSurface.strikeRange, mergedConfig.volSurface.dtes);

  // Additional HV/IV metrics
  const lastHv20 = hv_20[hv_20.length - 1]?.value;
  const hv_ratio = times.map((t, i) => ({
    time: t,
    value: (hv_5[i].value !== null && hv_20[i].value !== null && hv_20[i].value! > 0) ? Number((hv_5[i].value! / hv_20[i].value!).toFixed(4)) : null,
    confidence: (hv_5[i].value !== null && hv_20[i].value !== null) ? 10 : 0
  }));

  const vol_acceleration = times.map((t, i) => ({
    time: t,
    value: (hv_5[i].value !== null && hv_20[i].value !== null && hv_20[i].value! > 0) ? Number(((hv_5[i].value! - hv_20[i].value!) / hv_20[i].value!).toFixed(4)) : null,
    confidence: (hv_5[i].value !== null && hv_20[i].value !== null) ? 10 : 0
  }));

  const iv_hv_deviation = times.map((t, i) => ({
    time: t,
    value: (ivStats.iv[i].value !== null && hv_20[i].value !== null && hv_20[i].value! > 0) ? Number((ivStats.iv[i].value! / hv_20[i].value!).toFixed(4)) : null,
    confidence: (ivStats.iv[i].value !== null && hv_20[i].value !== null) ? 10 : 0
  }));

  // Volume
  const volume_series: IndicatorSeries = bars.map(b => ({ time: b.time, value: b.volume, confidence: 10 }));
  const volume_ma_5 = volume.calculateVolumeMA(bars, 5);
  const volume_ma_20 = volume.calculateVolumeMA(bars, 20);
  const obv = volume.calculateOBV(bars);
  const vol_price_regime = volume.calculateVolumePriceRegime(bars, volume_ma_20);

  // Pattern
  const pattern_series = pattern.calculatePatterns(bars);

  // Composite
  const trend_strength = composite.calculateTrendStrength(ma_7, ma_14, ma_30, ma_60, rsi_14, mergedConfig.trendStrength.rsiWeight);
  
  const maLookup: Record<string, IndicatorSeries> = { ma_7, ma_14, ma_20, ma_30, ma_60, ma_200 };
  const maForExt = maLookup[mergedConfig.priceExt.maKey] || ma_7;
  const price_extension = composite.calculatePriceExtension(closes, times, maForExt, atr);

  return {
    ma_7, ma_14, ma_20, ma_30, ma_60, ma_200,
    vwap,
    macd_line: macd.line, macd_signal: macd.signal, macd_histogram: macd.histogram,
    arbr_ar: arbr.ar, arbr_br: arbr.br,
    cr: crData.cr, cr_ma5: crData.mas[0], cr_ma10: crData.mas[1], cr_ma20: crData.mas[2],
    magic9_buy: magic9.buy, magic9_sell: magic9.sell,
    rsi_7, rsi_14, rsi_21, rsi_slope, rsi_overbought, rsi_oversold,
    kdj_k: kdj.k, kdj_d: kdj.d, kdj_j: kdj.j,
    roc_5d, roc_7d, roc_10d, roc_20d, roc_30d, roc_100d, roc_200d,
    atr, atr_state, atr_shock_weight, atr_percent, atr_mean_60,
    bb_upper: bb.upper, bb_lower: bb.lower, bb_middle: bb.middle, bb_width: bb.width, bb_percent_b: bb.percentB,
    kc_upper: kc.upper, kc_lower: kc.lower, kc_middle: kc.middle,
    hv_5, hv_20, hv_30, hv_60,
    iv: ivStats.iv, iv_rank: ivStats.ivRank, iv_percentile: ivStats.ivPercentile,
    hv_ratio, vol_acceleration, iv_hv_deviation, vol_surface,
    volume: volume_series, volume_ma_5, volume_ma_20, obv, vol_price_regime,
    trend_strength, price_extension,
    pattern: pattern_series
  };
}

function deepMerge(target: any, source: any): any {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) Object.assign(output, { [key]: source[key] });
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item: any) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}
