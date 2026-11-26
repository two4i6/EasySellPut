export interface OHLCVBar {
  time: number;     // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IVDataPoint {
  time: number;
  iv: number;           // Annualized IV, decimal (e.g. 0.25 = 25%)
  ivRank?: number;      // 0-100
  ivPercentile?: number;
}

export interface IndicatorValue<T = number | null> {
  time: number;
  value: T;
  confidence?: number;  // 0-10, following the FinancialFactor system
}

export type IndicatorSeries<T = number | null> = IndicatorValue<T>[];

export interface VolSurfacePoint {
  strike: number;   // Strike price (relative to spot price, e.g. 0.95 = 5% OTM)
  dte: number;
  iv: number;
}

// Result structure for all indicators
export interface IndicatorResult {
  // Trend
  ma_7: IndicatorSeries;
  ma_14: IndicatorSeries;
  ma_20: IndicatorSeries;
  ma_30: IndicatorSeries;
  ma_60: IndicatorSeries;
  ma_200: IndicatorSeries;
  vwap: IndicatorSeries;
  macd_line: IndicatorSeries;
  macd_signal: IndicatorSeries;
  macd_histogram: IndicatorSeries;
  arbr_ar: IndicatorSeries;
  arbr_br: IndicatorSeries;
  cr: IndicatorSeries;
  cr_ma5: IndicatorSeries;
  cr_ma10: IndicatorSeries;
  cr_ma20: IndicatorSeries;
  magic9_buy: IndicatorSeries;   // value = 1-9 count, null otherwise
  magic9_sell: IndicatorSeries;

  // Momentum
  rsi_7: IndicatorSeries;
  rsi_14: IndicatorSeries;
  rsi_21: IndicatorSeries;
  rsi_slope: IndicatorSeries;
  rsi_overbought: IndicatorSeries<boolean>;
  rsi_oversold: IndicatorSeries<boolean>;
  kdj_k: IndicatorSeries;
  kdj_d: IndicatorSeries;
  kdj_j: IndicatorSeries;
  roc_5d: IndicatorSeries;
  roc_7d: IndicatorSeries;
  roc_10d: IndicatorSeries;
  roc_20d: IndicatorSeries;
  roc_30d: IndicatorSeries;
  roc_100d: IndicatorSeries;
  roc_200d: IndicatorSeries;

  // Volatility
  atr: IndicatorSeries;
  atr_state: IndicatorSeries<string>;
  atr_shock_weight: IndicatorSeries;
  atr_percent: IndicatorSeries;
  atr_mean_60: IndicatorSeries;
  bb_upper: IndicatorSeries;
  bb_lower: IndicatorSeries;
  bb_middle: IndicatorSeries;
  bb_width: IndicatorSeries;
  bb_percent_b: IndicatorSeries;
  kc_upper: IndicatorSeries;
  kc_lower: IndicatorSeries;
  kc_middle: IndicatorSeries;
  hv_5: IndicatorSeries;
  hv_20: IndicatorSeries;
  hv_30: IndicatorSeries;
  hv_60: IndicatorSeries;
  iv: IndicatorSeries;
  iv_rank: IndicatorSeries;
  iv_percentile: IndicatorSeries;
  hv_ratio: IndicatorSeries;
  vol_acceleration: IndicatorSeries;
  iv_hv_deviation: IndicatorSeries;
  vol_surface: IndicatorSeries<VolSurfacePoint[] | null>;

  // Volume
  volume: IndicatorSeries;
  volume_ma_5: IndicatorSeries;
  volume_ma_20: IndicatorSeries;
  obv: IndicatorSeries;
  vol_price_regime: IndicatorSeries<string | null>;

  // Composite
  trend_strength: IndicatorSeries;
  price_extension: IndicatorSeries;

  // Pattern
  pattern: IndicatorSeries<string | null>;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};
