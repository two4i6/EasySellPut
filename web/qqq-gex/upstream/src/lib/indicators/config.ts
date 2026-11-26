import { IndicatorResult } from './types';

export interface IndicatorConfig {
  ma:            { periods: number[] };
  vwap:          { sessionBased: boolean };
  macd:          { fast: number; slow: number; signal: number };
  arbr:          { period: number };
  cr:            { period: number; ma: number[] };
  magicNine:     { count: number };
  rsi:           { periods: number[]; overbought: number; oversold: number };
  rsiSlope:      { period: number; lookback: number };
  kdj:           { kPeriod: number; dPeriod: number; jSmooth: number };
  roc:           { periods: number[] };
  atr:           { period: number };
  bb:            { period: number; multiplier: number };
  kc:            { period: number; multiplier: number };
  hv:            { periods: number[] };
  ivWindow:      number;
  volSurface:    { strikeRange: number[]; dtes: number[] };
  volume:        { maPeriods: number[] };
  trendStrength: { maPeriods: number[]; rsiWeight: number };
  priceExt:      { maKey: keyof IndicatorResult; atrKey: keyof IndicatorResult };
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  ma:            { periods: [7, 14, 20, 30, 60, 200] },
  vwap:          { sessionBased: true },
  macd:          { fast: 12, slow: 26, signal: 9 },
  arbr:          { period: 26 },
  cr:            { period: 26, ma: [5, 10, 20] },
  magicNine:     { count: 9 },
  rsi:           { periods: [7, 14, 21], overbought: 70, oversold: 30 },
  rsiSlope:      { period: 14, lookback: 3 },
  kdj:           { kPeriod: 9, dPeriod: 3, jSmooth: 3 },
  roc:           { periods: [5, 10, 20] },
  atr:           { period: 14 },
  bb:            { period: 20, multiplier: 2.0 },
  kc:            { period: 20, multiplier: 2.0 },
  hv:            { periods: [5, 20, 30, 60] },
  ivWindow:      252,
  volSurface:    { strikeRange: [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20],
                   dtes: [7, 14, 21, 30, 45, 60, 90] },
  volume:        { maPeriods: [5, 20] },
  trendStrength: { maPeriods: [7, 14, 30, 60], rsiWeight: 0.2 },
  priceExt:      { maKey: 'ma_7', atrKey: 'atr' },
};
