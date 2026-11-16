import type { OHLCV } from './types/input';

export function createRollingIndicators(bars: OHLCV[]) {
  const closeValues = bars.map(b => b.close);
  const historyValid = new Array<boolean>(bars.length);
  let validThrough = true;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]!;
    validThrough = validThrough && Number.isFinite(bar.close) && bar.close > 0 && Number.isFinite(bar.high) && Number.isFinite(bar.low);
    historyValid[index] = validThrough;
  }
  const prefix = new Array(closeValues.length + 1).fill(0);
  for (let i = 0; i < closeValues.length; i++) prefix[i + 1] = prefix[i] + closeValues[i];

  const emaCache = new Map<number, number[]>();
  const adxCache = new Map<number, number[]>();
  const rangeCache = new Map<number, Array<{ pct: number; high: number; low: number }>>();
  const rsiCache = new Map<number, number[]>();
  const realizedVolCache = new Map<number, number[]>();
  const efficiencyCache = new Map<number, number[]>();
  const atrCache = new Map<number, number[]>();
  const closeHighCache = new Map<number, number[]>();
  const highCache = new Map<number, number[]>();

  return {
    historyValidAt(idx: number): boolean {
      return idx >= 0 ? historyValid[idx] === true : false;
    },
    smaAt(idx: number, period: number): number {
      return idx + 1 >= period ? (prefix[idx + 1] - prefix[idx + 1 - period]) / period : 0;
    },
    rocAt(idx: number, period: number): number {
      const previous = idx >= period ? closeValues[idx - period] : 0;
      return previous !== 0 ? (closeValues[idx] - previous) / previous : 0;
    },
    emaAt(idx: number, period: number): number {
      let values = emaCache.get(period);
      if (!values) {
        values = buildEMAValues(closeValues, period);
        emaCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
    adxAt(idx: number, period: number = 14): number {
      let values = adxCache.get(period);
      if (!values) {
        values = buildADXValues(bars, period);
        adxCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
    rangeAt(idx: number, period: number = 20): { pct: number; high: number; low: number } {
      let values = rangeCache.get(period);
      if (!values) {
        values = buildRangeValues(bars, period);
        rangeCache.set(period, values);
      }
      return values[idx] ?? { pct: 1, high: 0, low: 0 };
    },
    rsiAt(idx: number, period: number = 14): number {
      let values = rsiCache.get(period);
      if (!values) {
        values = buildRSIValues(closeValues, period);
        rsiCache.set(period, values);
      }
      return values[idx] ?? 50;
    },
    realizedVolAt(idx: number, period: number = 20): number {
      let values = realizedVolCache.get(period);
      if (!values) {
        // calcRealizedVol only reads the trailing `period + 1` closes. Passing
        // the full prefix here copied O(n²) values while building a rolling
        // cache, without changing the as-of window or summation order.
        values = buildIndexedValues(closeValues.length, (end) => calcRealizedVol(closeValues.slice(Math.max(0, end - period), end + 1), period));
        realizedVolCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
    efficiencyAt(idx: number, period: number = 20): number {
      let values = efficiencyCache.get(period);
      if (!values) {
        // calcEfficiencyRatio also depends only on its trailing period window.
        values = buildIndexedValues(closeValues.length, (end) => calcEfficiencyRatio(closeValues.slice(Math.max(0, end - period), end + 1), period));
        efficiencyCache.set(period, values);
      }
      return values[idx] ?? 1;
    },
    atrAt(idx: number, period: number = 14): number {
      let values = atrCache.get(period);
      if (!values) {
        // calcATR reads only the latest `period` true ranges, which require
        // at most `period + 1` bars including the prior close.
        values = buildIndexedValues(bars.length, (end) => calcATR(bars.slice(Math.max(0, end - period), end + 1), period));
        atrCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
    closeHighAt(idx: number, period: number): number {
      let values = closeHighCache.get(period);
      if (!values) {
        values = buildIndexedValues(closeValues.length, (end) => Math.max(...closeValues.slice(Math.max(0, end + 1 - period), end + 1)));
        closeHighCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
    highAt(idx: number, period: number): number {
      let values = highCache.get(period);
      if (!values) {
        values = buildIndexedValues(bars.length, (end) => Math.max(...bars.slice(Math.max(0, end + 1 - period), end + 1).map(bar => bar.high)));
        highCache.set(period, values);
      }
      return values[idx] ?? 0;
    },
  };
}

export type RollingIndicators = ReturnType<typeof createRollingIndicators>;

function buildIndexedValues(length: number, calculate: (index: number) => number): number[] {
  const values = new Array<number>(length);
  for (let index = 0; index < length; index++) values[index] = calculate(index);
  return values;
}

function buildEMAValues(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(0);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += values[i];
  ema /= period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// Per-index output must match calcADX(bars.slice(0, i + 1), period) exactly, i.e. it stays 0
// until dxValues has accumulated a full `period` worth of entries (matching calcADX's own
// `bars.length < period * 2 + 1` guard applied at each prefix length, not just the final one).
function buildADXValues(bars: OHLCV[], period: number): number[] {
  const out = new Array(bars.length).fill(0);
  if (bars.length < period + 1) return out;

  let atr = 0;
  let pDM = 0;
  let mDM = 0;
  const dxValues: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(high - low, Math.abs(high - prev.close), Math.abs(low - prev.close));
    const up = high - prev.high;
    const down = prev.low - low;
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;

    if (i <= period) {
      atr += tr;
      pDM += plusDM;
      mDM += minusDM;
      continue;
    }

    atr = atr - atr / period + tr;
    pDM = pDM - pDM / period + plusDM;
    mDM = mDM - mDM / period + minusDM;

    const diPlus = atr > 0 ? (100 * pDM) / atr : 0;
    const diMinus = atr > 0 ? (100 * mDM) / atr : 0;
    const diSum = diPlus + diMinus;
    dxValues.push(diSum > 0 ? (100 * Math.abs(diPlus - diMinus)) / diSum : 0);
    if (dxValues.length >= period) {
      const adxSlice = dxValues.slice(-period);
      out[i] = adxSlice.reduce((a, b) => a + b, 0) / adxSlice.length;
    }
  }

  return out;
}

// Per-index output matches calcRSI(prices.slice(0, i + 1), period) exactly.
function buildRSIValues(prices: number[], period: number): number[] {
  const out = new Array(prices.length).fill(50);
  if (prices.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function buildRangeValues(bars: OHLCV[], period: number): Array<{ pct: number; high: number; low: number }> {
  const out = new Array(bars.length).fill(null).map(() => ({ pct: 1, high: 0, low: 0 }));
  const highs: number[] = [];
  const lows: number[] = [];
  let highHead = 0;
  let lowHead = 0;

  for (let i = 0; i < bars.length; i++) {
    while (highHead < highs.length && highs[highHead] <= i - period) highHead++;
    while (lowHead < lows.length && lows[lowHead] <= i - period) lowHead++;
    while (highs.length > highHead && bars[highs[highs.length - 1]].high <= bars[i].high) highs.pop();
    while (lows.length > lowHead && bars[lows[lows.length - 1]].low >= bars[i].low) lows.pop();
    highs.push(i);
    lows.push(i);

    if (Math.min(i + 1, period) < 5) continue;
    const high = bars[highs[highHead]].high;
    const low = bars[lows[lowHead]].low;
    const mid = (high + low) / 2;
    out[i] = { pct: mid > 0 ? (high - low) / mid : 1, high, low };
  }

  return out;
}

export function calcSMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

/** Calculate the latest SMA from bars while preserving calcSMA's summation order. */
export function calcLatestBarSMA<T extends { close: number }>(bars: readonly T[], period: number): number {
  if (bars.length < period) return 0;
  let sum = 0;
  for (let index = bars.length - period; index < bars.length; index++) sum += bars[index]!.close;
  return sum / period;
}

export function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calcROC(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const previous = closes[closes.length - 1 - period];
  if (previous === 0) return 0;
  return (current - previous) / previous;
}

/** Calculate the latest ROC directly from OHLC bars without projecting all closes. */
export function calcLatestBarROC<T extends { close: number }>(bars: readonly T[], period: number): number | undefined {
  if (bars.length < period + 1) return undefined;
  const current = bars[bars.length - 1]!.close;
  const previous = bars[bars.length - 1 - period]!.close;
  return previous === 0 ? 0 : (current - previous) / previous;
}

export function calcRealizedVol(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const slice = closes.slice(-(period + 1));
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] === 0) continue;
    returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

export function calcEfficiencyRatio(closes: number[], period: number = 20): number {
  if (closes.length < period + 1) return 1;
  const slice = closes.slice(-(period + 1));
  const net = Math.abs(slice.at(-1)! - slice[0]);
  let path = 0;
  for (let i = 1; i < slice.length; i++) path += Math.abs(slice[i] - slice[i - 1]);
  return path > 0 ? net / path : 1;
}

export function calcEwmaVol(closes: number[], lambda: number = 0.94): number {
  if (closes.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0) continue;
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (returns.length < 2) return 0;

  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  }
  return Math.sqrt(variance * 252);
}

export function calcATR(bars: OHLCV[], period: number = 14): number {
  if (bars.length < period + 1) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const bar = bars[i];
    const prevClose = bars[i - 1]?.close ?? bar.close;
    sum += Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  }
  return sum / period;
}

export function calcADX(bars: OHLCV[], period: number = 14): number {
  if (bars.length < period * 2 + 1) return 0;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose = bars[i - 1].close;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;

    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const up = high - prevHigh;
    const down = prevLow - low;
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
  }

  // Wilder smoothing init
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let pDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let mDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    atr = atr - atr / period + trs[i];
    pDM = pDM - pDM / period + plusDMs[i];
    mDM = mDM - mDM / period + minusDMs[i];

    const diPlus = atr > 0 ? (100 * pDM) / atr : 0;
    const diMinus = atr > 0 ? (100 * mDM) / atr : 0;
    const diSum = diPlus + diMinus;
    dxValues.push(diSum > 0 ? (100 * Math.abs(diPlus - diMinus)) / diSum : 0);
  }

  if (dxValues.length === 0) return 0;
  const adxSlice = dxValues.slice(-period);
  return adxSlice.reduce((a, b) => a + b, 0) / adxSlice.length;
}

export function calcRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += change > 0 ? change : 0;
    avgLoss += change < 0 ? -change : 0;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calc20dRange(bars: OHLCV[]): { pct: number; high: number; low: number } {
  const start = Math.max(0, bars.length - 20);
  if (bars.length - start < 5) return { pct: 1, high: 0, low: 0 };
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < bars.length; i++) {
    if (bars[i].high > high) high = bars[i].high;
    if (bars[i].low < low) low = bars[i].low;
  }
  const mid  = (high + low) / 2;
  return { pct: mid > 0 ? (high - low) / mid : 1, high, low };
}

export function closes(bars: OHLCV[]): number[] {
  return bars.map(b => b.close);
}

/** Target DTE for option strikes: find the expiry closest to targetDTE days out */
export function findNearestExpiry(
  expirations: Array<{ date: string }>,
  fromDate: string,
  targetDTE: number
): string | undefined {
  const from = new Date(fromDate).getTime();
  let best: string | undefined;
  let bestDiff = Infinity;
  for (const exp of expirations) {
    const dte = (new Date(exp.date).getTime() - from) / 86400000;
    const diff = Math.abs(dte - targetDTE);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = exp.date;
    }
  }
  return best;
}

/** Find the contract with |delta| closest to target among calls or puts */
export function findContractByDelta(
  contracts: Array<{ delta: number; strike: number }>,
  targetDelta: number
): { delta: number; strike: number } | undefined {
  let best: { delta: number; strike: number } | undefined;
  let bestDiff = Infinity;
  for (const c of contracts) {
    const diff = Math.abs(Math.abs(c.delta) - Math.abs(targetDelta));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}
