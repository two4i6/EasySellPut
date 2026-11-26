import { OHLCVBar, IndicatorSeries } from '../types';

/**
 * Simple Moving Average (SMA)
 */
export function calculateSMA(data: number[], times: number[], period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result.push({
      time: times[i],
      value: Number((sum / period).toFixed(4)),
      confidence: 10
    });
  }
  return result;
}

/**
 * Volume Weighted Average Price (VWAP)
 */
export function calculateVWAP(bars: OHLCVBar[], sessionBased: boolean): IndicatorSeries {
  const result: IndicatorSeries = [];
  let cumulativeTypicalPriceVolume = 0;
  let cumulativeVolume = 0;
  let lastDay = -1;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const currentDay = Math.floor(bar.time / 86400);

    if (sessionBased && currentDay !== lastDay) {
      cumulativeTypicalPriceVolume = 0;
      cumulativeVolume = 0;
      lastDay = currentDay;
    }

    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativeTypicalPriceVolume += typicalPrice * bar.volume;
    cumulativeVolume += bar.volume;

    result.push({
      time: bar.time,
      value: cumulativeVolume > 0 ? Number((cumulativeTypicalPriceVolume / cumulativeVolume).toFixed(4)) : null,
      confidence: cumulativeVolume > 0 ? 10 : 0
    });
  }
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  data: number[],
  times: number[],
  fast: number,
  slow: number,
  signal: number
): { line: IndicatorSeries; signal: IndicatorSeries; histogram: IndicatorSeries } {
  const emaFast = calculateEMA(data, times, fast);
  const emaSlow = calculateEMA(data, times, slow);
  
  const macdLine: IndicatorSeries = [];
  for (let i = 0; i < data.length; i++) {
    const f = emaFast[i].value;
    const s = emaSlow[i].value;
    macdLine.push({
      time: times[i],
      value: (f !== null && s !== null) ? Number((f - s).toFixed(4)) : null,
      confidence: (f !== null && s !== null) ? 10 : 0
    });
  }

  const macdStart = macdLine.findIndex(v => v.value !== null);
  if (macdStart === -1) {
    return { 
      line: macdLine, 
      signal: times.map(t => ({ time: t, value: null, confidence: 0 })), 
      histogram: times.map(t => ({ time: t, value: null, confidence: 0 }))
    };
  }

  const validMacdValues = macdLine.slice(macdStart).map(v => v.value!);
  const validTimes = times.slice(macdStart);
  const validSignal = calculateEMA(validMacdValues, validTimes, signal);

  const signalLine: IndicatorSeries = times.map((t, i) => {
    if (i < macdStart) return { time: t, value: null, confidence: 0 };
    const idx = i - macdStart;
    const warmupEnd = signal - 1;
    if (idx < warmupEnd) return { time: t, value: null, confidence: 0 };
    return validSignal[idx];
  });

  const histogram: IndicatorSeries = [];
  for (let i = 0; i < data.length; i++) {
    const l = macdLine[i].value;
    const s = signalLine[i].value;
    histogram.push({
      time: times[i],
      value: (l !== null && s !== null) ? Number((l - s).toFixed(4)) : null,
      confidence: (l !== null && s !== null) ? 10 : 0
    });
  }

  return { line: macdLine, signal: signalLine, histogram };
}

export function calculateEMA(data: number[], times: number[], period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  const k = 2 / (period + 1);
  let ema = data[0];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push({ time: times[i], value: Number(ema.toFixed(4)), confidence: 10 });
      continue;
    }
    ema = (data[i] - ema) * k + ema;
    result.push({
      time: times[i],
      value: i < period - 1 ? null : Number(ema.toFixed(4)),
      confidence: i < period - 1 ? 0 : 10
    });
  }
  return result;
}

/**
 * ARBR (Accumulation/Distribution & Buying/Selling Power)
 */
export function calculateARBR(bars: OHLCVBar[], period: number): { ar: IndicatorSeries; br: IndicatorSeries } {
  const ar: IndicatorSeries = [];
  const br: IndicatorSeries = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period) {
      ar.push({ time: bars[i].time, value: null, confidence: 0 });
      br.push({ time: bars[i].time, value: null, confidence: 0 });
      continue;
    }

    let arSumHighOpen = 0;
    let arSumOpenLow = 0;
    let brSumHighPrevClose = 0;
    let brSumPrevCloseLow = 0;

    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const bar = bars[idx];
      const prevBar = bars[idx - 1];

      arSumHighOpen += (bar.high - bar.open);
      arSumOpenLow += (bar.open - bar.low);

      if (prevBar) {
        brSumHighPrevClose += Math.max(0, bar.high - prevBar.close);
        brSumPrevCloseLow += Math.max(0, prevBar.close - bar.low);
      }
    }

    ar.push({
      time: bars[i].time,
      value: arSumOpenLow !== 0 ? Number(((arSumHighOpen / arSumOpenLow) * 100).toFixed(4)) : null,
      confidence: arSumOpenLow !== 0 ? 10 : 0
    });

    br.push({
      time: bars[i].time,
      value: brSumPrevCloseLow !== 0 ? Number(((brSumHighPrevClose / brSumPrevCloseLow) * 100).toFixed(4)) : null,
      confidence: brSumPrevCloseLow !== 0 ? 10 : 0
    });
  }

  return { ar, br };
}

/**
 * CR (Energy Indicator)
 */
export function calculateCR(bars: OHLCVBar[], period: number, maPeriods: number[]): { cr: IndicatorSeries; mas: IndicatorSeries[] } {
  const cr: IndicatorSeries = [];

  for (let i = 0; i < bars.length; i++) {
    if (i < period) {
      cr.push({ time: bars[i].time, value: null, confidence: 0 });
      continue;
    }

    let sumHighMid = 0;
    let sumMidLow = 0;

    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const prevBar = bars[idx - 1];
      if (!prevBar) continue;

      const mid = (prevBar.high + prevBar.low + prevBar.close) / 3;
      sumHighMid += Math.max(0, bars[idx].high - mid);
      sumMidLow += Math.max(0, mid - bars[idx].low);
    }

    cr.push({
      time: bars[i].time,
      value: sumMidLow !== 0 ? Number(((sumHighMid / sumMidLow) * 100).toFixed(4)) : null,
      confidence: sumMidLow !== 0 ? 10 : 0
    });
  }

  const crValues = cr.map(v => v.value ?? 0);
  const times = bars.map(b => b.time);
  const mas = maPeriods.map(p => {
    const ma = calculateSMA(crValues, times, p);

    for (let i = 0; i < bars.length; i++) {
      let windowHasNull = false;

      for (let k = 0; k < p; k++) {
        const idx = i - k;
        if (idx < 0 || cr[idx].value === null) {
          windowHasNull = true;
          break;
        }
      }

      if (windowHasNull) {
        ma[i].value = null;
        ma[i].confidence = 0;
      }
    }

    return ma;
  });

  return { cr, mas };
}

/**
 * Magic 9 (TD Sequential)
 */
export function calculateMagic9(bars: OHLCVBar[]): { buy: IndicatorSeries; sell: IndicatorSeries } {
  const buy: IndicatorSeries = [];
  const sell: IndicatorSeries = [];
  let buyCount = 0;
  let sellCount = 0;

  for (let i = 0; i < bars.length; i++) {
    if (i < 4) {
      buy.push({ time: bars[i].time, value: null, confidence: 0 });
      sell.push({ time: bars[i].time, value: null, confidence: 0 });
      continue;
    }

    const curClose = bars[i].close;
    const refClose = bars[i - 4].close;

    if (curClose < refClose) {
      buyCount++;
      sellCount = 0;
    } else if (curClose > refClose) {
      sellCount++;
      buyCount = 0;
    } else {
      buyCount = 0;
      sellCount = 0;
    }

    buy.push({
      time: bars[i].time,
      value: (buyCount > 0 && buyCount <= 9) ? buyCount : null,
      confidence: (buyCount > 0 && buyCount <= 9) ? 10 : 0
    });

    sell.push({
      time: bars[i].time,
      value: (sellCount > 0 && sellCount <= 9) ? sellCount : null,
      confidence: (sellCount > 0 && sellCount <= 9) ? 10 : 0
    });
    
    if (buyCount >= 9) buyCount = 0;
    if (sellCount >= 9) sellCount = 0;
  }

  return { buy, sell };
}
