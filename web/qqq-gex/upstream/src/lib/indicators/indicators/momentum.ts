import { IndicatorSeries } from '../types';
import { calculateSMA } from './trend';

/**
 * Relative Strength Index (RSI)
 */
export function calculateRSI(data: number[], times: number[], period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  let gains = 0, losses = 0, changes = 0;
  let previous: number | null = null;
  for (let i = 0; i < data.length; i++) {
    const current = data[i];
    if (!Number.isInteger(period) || period < 1 || !Number.isFinite(current) || current <= 0) {
      gains = 0; losses = 0; changes = 0; previous = null;
      result.push({time:times[i],value:null,confidence:0});
      continue;
    }
    if (previous === null) {
      previous = current;
      result.push({time:times[i],value:null,confidence:0});
      continue;
    }
    const diff = current - previous;
    previous = current;
    const gain = Math.max(diff, 0), loss = Math.max(-diff, 0);
    changes++;
    if (changes <= period) {
      gains += gain; losses += loss;
      if (changes < period) {
        result.push({time:times[i],value:null,confidence:0});
        continue;
      }
      gains /= period; losses /= period;
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
    }
    const rsi = losses === 0 ? (gains === 0 ? 50 : 100) : 100 - 100 / (1 + gains / losses);
    result.push({time:times[i],value:Number(rsi.toFixed(4)),confidence:10});
  }
  return result;
}

/**
 * RSI Slope
 */
export function calculateRSISlope(rsiSeries: IndicatorSeries, lookback: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  for (let i = 0; i < rsiSeries.length; i++) {
    if (i < lookback || rsiSeries[i].value === null || rsiSeries[i - lookback].value === null) {
      result.push({ time: rsiSeries[i].time, value: null, confidence: 0 });
      continue;
    }

    const slope = (rsiSeries[i].value! - rsiSeries[i - lookback].value!) / lookback;
    result.push({
      time: rsiSeries[i].time,
      value: Number(slope.toFixed(4)),
      confidence: 10
    });
  }
  return result;
}

/**
 * KDJ Indicator
 */
export function calculateKDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  times: number[],
  kPeriod: number,
  dPeriod: number,
  jSmooth: number
): { k: IndicatorSeries; d: IndicatorSeries; j: IndicatorSeries } {
  const k: IndicatorSeries = [];
  const d: IndicatorSeries = [];
  const j: IndicatorSeries = [];

  let lastK = 50;
  let lastD = 50;

  for (let i = 0; i < times.length; i++) {
    if (i < kPeriod - 1) {
      k.push({ time: times[i], value: null, confidence: 0 });
      d.push({ time: times[i], value: null, confidence: 0 });
      j.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    let lowestLow = lows[i];
    let highestHigh = highs[i];
    for (let m = 0; m < kPeriod; m++) {
      lowestLow = Math.min(lowestLow, lows[i - m]);
      highestHigh = Math.max(highestHigh, highs[i - m]);
    }

    const rsv = highestHigh === lowestLow ? 50 : ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
    
    const curK = (rsv + (dPeriod - 1) * lastK) / dPeriod;
    const curD = (curK + (jSmooth - 1) * lastD) / jSmooth;
    const curJ = 3 * curK - 2 * curD;

    k.push({ time: times[i], value: Number(curK.toFixed(4)), confidence: 10 });
    d.push({ time: times[i], value: Number(curD.toFixed(4)), confidence: 10 });
    j.push({ time: times[i], value: Number(curJ.toFixed(4)), confidence: 10 });

    lastK = curK;
    lastD = curD;
  }

  return { k, d, j };
}

/**
 * Rate of Change (ROC)
 */
export function calculateROC(data: number[], times: number[], period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period || data[i - period] === 0) {
      result.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    const roc = ((data[i] - data[i - period]) / data[i - period]) * 100;
    result.push({
      time: times[i],
      value: Number(roc.toFixed(4)),
      confidence: 10
    });
  }
  return result;
}
