import { OHLCVBar, IndicatorSeries } from '../types';
import { calculateSMA } from './trend';

/**
 * On-Balance Volume (OBV)
 */
export function calculateOBV(bars: OHLCVBar[]): IndicatorSeries {
  const result: IndicatorSeries = [];
  let obv = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    if (!prevBar) {
      obv = bar.volume;
    } else {
      if (bar.close > prevBar.close) {
        obv += bar.volume;
      } else if (bar.close < prevBar.close) {
        obv -= bar.volume;
      }
    }

    result.push({
      time: bar.time,
      value: Number(obv.toFixed(0)),
      confidence: 10
    });
  }
  return result;
}

/**
 * Volume MA
 */
export function calculateVolumeMA(bars: OHLCVBar[], period: number): IndicatorSeries {
  const volumes = bars.map(b => b.volume);
  const times = bars.map(b => b.time);
  return calculateSMA(volumes, times, period);
}

/**
 * Volume/Price Regime
 * 1. 放量上涨 (VOL_UP_PRICE_UP)
 * 2. 放量下跌 (VOL_UP_PRICE_DOWN)
 * 3. 缩量上涨 (VOL_DOWN_PRICE_UP)
 * 4. 缩量下跌 (VOL_DOWN_PRICE_DOWN)
 */
export function calculateVolumePriceRegime(
  bars: OHLCVBar[], 
  volumeMA: IndicatorSeries
): IndicatorSeries<string | null> {
  const result: IndicatorSeries<string | null> = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];
    const volMAValue = volumeMA[i]?.value;

    if (!prevBar || volMAValue === null || volMAValue === 0) {
      result.push({ time: bar.time, value: null, confidence: 0 });
      continue;
    }

    const isVolUp = bar.volume > volMAValue;
    const priceDiff = bar.close - prevBar.close;
    const priceChangePct = Math.abs(priceDiff) / prevBar.close;
    
    // Threshold for "sideways/flat" is 0.1% change
    const isSideways = priceChangePct < 0.001;

    let regime = '';
    if (isSideways) {
      regime = isVolUp ? 'VOL_UP_SIDEWAYS' : 'VOL_DOWN_SIDEWAYS';
    } else if (isVolUp && priceDiff > 0) {
      regime = 'VOL_UP_PRICE_UP';
    } else if (isVolUp && priceDiff < 0) {
      regime = 'VOL_UP_PRICE_DOWN';
    } else if (!isVolUp && priceDiff > 0) {
      regime = 'VOL_DOWN_PRICE_UP';
    } else {
      regime = 'VOL_DOWN_PRICE_DOWN';
    }

    result.push({
      time: bar.time,
      value: regime,
      confidence: 10
    });
  }
  return result;
}
