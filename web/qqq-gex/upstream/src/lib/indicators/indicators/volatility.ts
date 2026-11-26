import { OHLCVBar, IndicatorSeries, IVDataPoint, VolSurfacePoint } from '../types';
import { calculateSMA, calculateEMA } from './trend';

/**
 * Average True Range (ATR)
 */
export function calculateATR(bars: OHLCVBar[], period: number): { 
  atr: IndicatorSeries; 
  atrPercent: IndicatorSeries; 
  atrState: IndicatorSeries<string>;
  atrShockWeight: IndicatorSeries;
} {
  const tr: number[] = [];
  const times = bars.map(b => b.time);

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];
    if (!prevBar) {
      tr.push(bar.high - bar.low);
      continue;
    }
    const h_l = bar.high - bar.low;
    const h_pc = Math.abs(bar.high - prevBar.close);
    const l_pc = Math.abs(bar.low - prevBar.close);
    tr.push(Math.max(h_l, h_pc, l_pc));
  }

  // 1. Calculate base ATR using EMA (faster responsiveness)
  const baseAtr = calculateEMA(tr, times, period);

  // 2. Secondary smoothing: EMA(baseAtr, 5) for better stability/smoothness
  const baseAtrValues = baseAtr.map(v => v.value ?? 0);
  const smoothedAtr = calculateEMA(baseAtrValues, times, 5);

  // 3. Rate Limiter with Shock Weight and Dual-Condition Exit
  const limitedAtr: IndicatorSeries = [];
  const atrState: IndicatorSeries<string> = [];
  const atrShockWeight: IndicatorSeries = [];
  
  let currentShockWeight = 0; // 0 to 1
  let barsSinceShock = 0;
  
  const volumes = bars.map(b => b.volume);
  const vma20: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < 19) { vma20.push(0); continue; }
    const sum = volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0);
    vma20.push(sum / 20);
  }

  for (let i = 0; i < smoothedAtr.length; i++) {
    const current = smoothedAtr[i];
    if (i === 0 || current.value === null || (i > 0 && limitedAtr[i - 1].value === null)) {
      limitedAtr.push(current);
      atrState.push({ time: times[i], value: 'NORMAL', confidence: 10 });
      atrShockWeight.push({ time: times[i], value: 0, confidence: 10 });
      continue;
    }

    const prevValue = limitedAtr[i - 1].value!;
    const currentValue = current.value!;
    const change = currentValue - prevValue;
    const absChange = Math.abs(change);

    // Thresholds
    const softThreshold = prevValue * 0.10; // 10% standard limit
    const hardThreshold = prevValue * 0.25; // 25% shock trigger
    
    // Conditions
    const currentVol = bars[i].volume;
    const avgVol = vma20[i] || 0;
    const isVolumeSpike = avgVol > 0 && currentVol > avgVol * 2;
    const isExtremeJump = absChange > hardThreshold;
    const shockDetected = isExtremeJump && isVolumeSpike;

    if (shockDetected) {
      // Impact: Jump intensity determines initial weight (min 0.6)
      const intensity = Math.min(1.0, 0.6 + (absChange / (prevValue * 0.5)));
      currentShockWeight = Math.max(currentShockWeight, intensity);
      barsSinceShock = 0;
    } else {
      // Decay Logic
      const isPriceStable = absChange < prevValue * 0.05;
      const isVolumeStable = avgVol > 0 && currentVol < avgVol;
      
      // Accelerated decay (0.6) if market confirms stability, otherwise standard (0.8)
      const decayFactor = (isPriceStable && isVolumeStable) ? 0.6 : 0.8;
      currentShockWeight *= decayFactor;
      barsSinceShock++;
      
      // Dual-Condition Exit: Only hard-reset to 0 if criteria met
      if (barsSinceShock >= 5 && isPriceStable && currentVol < avgVol * 1.2) {
        currentShockWeight = 0;
      }
    }

    // Determine state for UI (Segmented Mapping)
    let state = 'NORMAL';
    if (currentShockWeight >= 0.6) state = 'SHOCK';
    else if (currentShockWeight >= 0.3) state = 'TRANSITION';
    
    atrState.push({ time: times[i], value: state, confidence: 10 });
    atrShockWeight.push({ time: times[i], value: Number(currentShockWeight.toFixed(4)), confidence: 10 });

    // Pure Indicator Logic: Apply fixed 10% limiter only, don't bypass with shockWeight
    // This keeps the ATR value predictable and smooth for KC/Technical use
    if (absChange > softThreshold) {
      const limitedValue = prevValue + (Math.sign(change) * softThreshold);
      limitedAtr.push({ ...current, value: Number(limitedValue.toFixed(4)) });
    } else {
      limitedAtr.push(current);
    }
  }

  // Final pass to ensure warmup period is null (period-1)
  for (let i = 0; i < period - 1 && i < limitedAtr.length; i++) {
    limitedAtr[i].value = null;
    limitedAtr[i].confidence = 0;
  }

  const atrPercent: IndicatorSeries = limitedAtr.map((v, i) => ({
    time: v.time,
    value: (v.value !== null && v.value > 0 && bars[i].close > 0) ? Number(((v.value / bars[i].close) * 100).toFixed(4)) : null,
    confidence: (v.value !== null && v.value > 0 && bars[i].close > 0) ? 10 : 0
  }));

  return { atr: limitedAtr, atrPercent, atrState, atrShockWeight };
}

/**
 * ATR Mean (Rolling Average of ATR)
 */
export function calculateATRMean(atrSeries: IndicatorSeries, period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  for (let i = 0; i < atrSeries.length; i++) {
    if (i < period - 1 || atrSeries[i].value === null) {
      result.push({ time: atrSeries[i].time, value: null, confidence: 0 });
      continue;
    }
    const window = atrSeries.slice(i - period + 1, i + 1).filter(v => v.value !== null);
    const mean = window.reduce((a, b) => a + b.value!, 0) / window.length;
    result.push({ time: atrSeries[i].time, value: Number(mean.toFixed(4)), confidence: 10 });
  }
  return result;
}

/**
 * Bollinger Bands (BB)
 */
export function calculateBB(data: number[], times: number[], period: number, multiplier: number): {
  upper: IndicatorSeries;
  lower: IndicatorSeries;
  middle: IndicatorSeries;
  width: IndicatorSeries;
  percentB: IndicatorSeries;
} {
  const middle = calculateSMA(data, times, period);
  const upper: IndicatorSeries = [];
  const lower: IndicatorSeries = [];
  const width: IndicatorSeries = [];
  const percentB: IndicatorSeries = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1 || middle[i].value === null) {
      upper.push({ time: times[i], value: null, confidence: 0 });
      lower.push({ time: times[i], value: null, confidence: 0 });
      width.push({ time: times[i], value: null, confidence: 0 });
      percentB.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    let sumSq = 0;
    const avg = middle[i].value!;
    for (let j = 0; j < period; j++) {
      sumSq += Math.pow(data[i - j] - avg, 2);
    }
    const stdDev = Math.sqrt(sumSq / (period - 1));
    const u = avg + multiplier * stdDev;
    const l = avg - multiplier * stdDev;
    const w = (u - l) / avg;
    const pb = (data[i] - l) / (u - l);

    upper.push({ time: times[i], value: Number(u.toFixed(4)), confidence: 10 });
    lower.push({ time: times[i], value: Number(l.toFixed(4)), confidence: 10 });
    width.push({ time: times[i], value: Number(w.toFixed(4)), confidence: 10 });
    percentB.push({ time: times[i], value: Number(pb.toFixed(4)), confidence: 10 });
  }

  return { upper, lower, middle, width, percentB };
}

/**
 * Keltner Channels (KC)
 */
export function calculateKC(bars: OHLCVBar[], period: number, multiplier: number): {
  upper: IndicatorSeries;
  lower: IndicatorSeries;
  middle: IndicatorSeries;
} {
  const closes = bars.map(b => b.close);
  const times = bars.map(b => b.time);
  const middle = calculateEMA(closes, times, period);
  const { atr } = calculateATR(bars, period);

  const upper: IndicatorSeries = [];
  const lower: IndicatorSeries = [];

  for (let i = 0; i < bars.length; i++) {
    const m = middle[i].value;
    const a = atr[i].value;

    if (m !== null && a !== null) {
      upper.push({ time: times[i], value: Number((m + multiplier * a).toFixed(4)), confidence: 10 });
      lower.push({ time: times[i], value: Number((m - multiplier * a).toFixed(4)), confidence: 10 });
    } else {
      upper.push({ time: times[i], value: null, confidence: 0 });
      lower.push({ time: times[i], value: null, confidence: 0 });
    }
  }

  return { upper, lower, middle };
}

/**
 * Historical Volatility (HV)
 */
export function calculateHV(data: number[], times: number[], period: number): IndicatorSeries {
  const result: IndicatorSeries = [];
  const logReturns: number[] = [];

  for (let i = 1; i < data.length; i++) {
    logReturns.push(Math.log(data[i] / data[i - 1]));
  }

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    const window = logReturns.slice(i - period, i);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const sumSq = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
    const stdDev = Math.sqrt(sumSq / (period - 1));
    const hv = stdDev * Math.sqrt(252);

    result.push({
      time: times[i],
      value: Number(hv.toFixed(4)),
      confidence: 10
    });
  }
  return result;
}

/**
 * IV Rank and Percentile
 */
export function calculateIVStats(ivData: IVDataPoint[], times: number[], window: number): {
  iv: IndicatorSeries;
  ivRank: IndicatorSeries;
  ivPercentile: IndicatorSeries;
} {
  const iv: IndicatorSeries = [];
  const ivRank: IndicatorSeries = [];
  const ivPercentile: IndicatorSeries = [];

  // Align IV data with bars
  const ivMap = new Map(ivData.map(d => [d.time, d.iv]));
  const alignedIv = times.map(t => ivMap.get(t) ?? null);

  for (let i = 0; i < times.length; i++) {
    const currentIv = alignedIv[i];
    iv.push({ time: times[i], value: currentIv, confidence: currentIv !== null ? 10 : 0 });

    if (currentIv === null) {
      ivRank.push({ time: times[i], value: null, confidence: 0 });
      ivPercentile.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    // Adaptive Windowing Strategy
    // Try primary window (e.g. 252), then 126, then 63, then whatever is available (min 20)
    const candidateWindows = [window, 126, 63];
    let effectiveSlice: number[] = [];
    let confidence = 10;

    for (const w of candidateWindows) {
      if (i < w - 1) continue;
      const s = alignedIv.slice(i - w + 1, i + 1).filter((v): v is number => v !== null);
      if (s.length >= w * 0.8) {
        effectiveSlice = s;
        // Confidence reduces for shorter windows
        confidence = w === window ? 10 : w === 126 ? 8 : 6;
        break;
      }
    }

    // Fallback: Use whatever is available if it's at least 20 days
    if (effectiveSlice.length === 0) {
      const allAvailable = alignedIv.slice(0, i + 1).filter((v): v is number => v !== null);
      if (allAvailable.length >= 20) {
        effectiveSlice = allAvailable;
        confidence = 4;
      }
    }

    if (effectiveSlice.length === 0) {
      ivRank.push({ time: times[i], value: null, confidence: 0 });
      ivPercentile.push({ time: times[i], value: null, confidence: 0 });
      continue;
    }

    const min = Math.min(...effectiveSlice);
    const max = Math.max(...effectiveSlice);
    const rank = max === min ? 50 : ((currentIv - min) / (max - min)) * 100;

    const countBelow = effectiveSlice.filter(v => v < currentIv).length;
    const percentile = (countBelow / effectiveSlice.length) * 100;

    ivRank.push({ time: times[i], value: Number(rank.toFixed(4)), confidence });
    ivPercentile.push({ time: times[i], value: Number(percentile.toFixed(4)), confidence });
  }

  return { iv, ivRank, ivPercentile };
}

/**
 * Volatility Surface (Approximate)
 */
export function calculateVolSurface(
  ivSeries: IndicatorSeries,
  strikeRange: number[],
  dtes: number[]
): IndicatorSeries<VolSurfacePoint[] | null> {
  return ivSeries.map(({ time, value: iv }) => {
    if (iv === null) {
      return { time, value: null, confidence: 0 };
    }

    const points: VolSurfacePoint[] = [];
    for (const strike of strikeRange) {
      for (const dte of dtes) {
        // Skew approximation: simple smile/skew model
        // IV(strike) = IV_atm * (1 - 0.5 * (strike - 1) + 0.2 * (strike - 1)^2)
        // Term structure: IV(dte) = IV_atm * sqrt(dte / 30)
        const ivStrike = iv * (1 - 0.5 * strike + 0.2 * Math.pow(strike, 2));
        const ivDte = ivStrike * Math.sqrt(dte / 30);
        
        points.push({
          strike: Number(strike.toFixed(2)),
          dte,
          iv: Number(ivDte.toFixed(4))
        });
      }
    }
    return { time, value: points, confidence: 10 };
  });
}
