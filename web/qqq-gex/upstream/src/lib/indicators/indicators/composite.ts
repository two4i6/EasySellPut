import { IndicatorSeries, IndicatorResult } from '../types';

/**
 * Trend Strength Indicator
 */
export function calculateTrendStrength(
  ma7: IndicatorSeries,
  ma14: IndicatorSeries,
  ma30: IndicatorSeries,
  ma60: IndicatorSeries,
  rsi: IndicatorSeries,
  rsiWeight: number
): IndicatorSeries {
  const result: IndicatorSeries = [];

  for (let i = 0; i < ma7.length; i++) {
    const m7 = ma7[i].value;
    const m14 = ma14[i].value;
    const m30 = ma30[i].value;
    const m60 = ma60[i].value;
    const r = rsi[i].value;

    if (m7 !== null && m14 !== null && m30 !== null && m60 !== null && r !== null) {
      // Logic: Order of MAs + RSI
      let strength = 0;
      if (m7 > m14 && m14 > m30 && m30 > m60) strength = 1; // Strong Bullish
      else if (m7 < m14 && m14 < m30 && m30 < m60) strength = -1; // Strong Bearish

      const rsiNorm = (r - 50) / 50; // -1 to 1
      const combined = strength * (1 - rsiWeight) + rsiNorm * rsiWeight;

      result.push({
        time: ma7[i].time,
        value: Number(combined.toFixed(4)),
        confidence: 10
      });
    } else {
      result.push({ time: ma7[i].time, value: null, confidence: 0 });
    }
  }

  return result;
}

/**
 * Price Extension (Distance from MA)
 */
export function calculatePriceExtension(
  closes: number[],
  times: number[],
  ma: IndicatorSeries,
  atr: IndicatorSeries
): IndicatorSeries {
  const result: IndicatorSeries = [];

  for (let i = 0; i < closes.length; i++) {
    const m = ma[i].value;
    const a = atr[i].value;

    if (m !== null && a !== null && a > 0) {
      const ext = (closes[i] - m) / a;
      result.push({
        time: times[i],
        value: Number(ext.toFixed(4)),
        confidence: 10
      });
    } else {
      result.push({ time: times[i], value: null, confidence: 0 });
    }
  }

  return result;
}
