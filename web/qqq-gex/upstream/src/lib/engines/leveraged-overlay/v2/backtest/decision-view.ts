import type { OHLCV } from '../../types/input';

export type DecisionViewState = {
  qqq: OHLCV[];
  leveraged: OHLCV[];
  boxx?: OHLCV[];
  spy?: OHLCV[];
  leveragedEnd: number;
  boxxEnd: number;
  spyEnd: number;
};

export function barDateKey(date: string): string {
  return date.slice(0, 10);
}

export function isDailyDecisionBar(bars: OHLCV[], index: number, intraday: boolean): boolean {
  if (!intraday) return true;
  const current = bars[index];
  const next = bars[index + 1];
  if (!current) return false;
  if (!next || barDateKey(next.date) !== barDateKey(current.date)) {
    const prev = bars[index - 1];
    return !prev || barDateKey(prev.date) !== barDateKey(current.date);
  }
  const afterNext = bars[index + 2];
  return !afterNext || barDateKey(afterNext.date) !== barDateKey(current.date);
}

/** 日内回测取上一完整交易日 VIX，避免把小时级噪声当作单日突刺。 */
export function resolvePrevVix(
  bars: OHLCV[],
  vixByDate: Record<string, number>,
  i: number,
  isIntradayBacktest: boolean,
  vixToday: number,
): number {
  if (i === 0) return vixToday;
  if (!isIntradayBacktest) return vixByDate[bars[i - 1]!.date] ?? vixByDate[barDateKey(bars[i - 1]!.date)] ?? vixToday;
  const todayKey = barDateKey(bars[i]!.date);
  for (let k = i - 1; k >= 0; k--) {
    const key = barDateKey(bars[k]!.date);
    if (key !== todayKey) return vixByDate[bars[k]!.date] ?? vixByDate[key] ?? vixToday;
  }
  return vixToday;
}

export function hasThreeStrongUpDays(bars: OHLCV[], endIndex: number): boolean {
  if (endIndex < 3) return false;
  for (let k = endIndex - 2; k <= endIndex; k++) {
    const prev = bars[k - 1]?.close;
    const current = bars[k]?.close;
    if (!prev || !current || (current - prev) / prev <= .01) return false;
  }
  return true;
}

export function smaAtEnd(bars: OHLCV[], period: number): number {
  if (bars.length < period) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) sum += bars[i].close;
  return sum / period;
}

export function rocAtEnd(bars: OHLCV[], period: number): number {
  if (bars.length < period + 1) return 0;
  const current = bars[bars.length - 1].close;
  const previous = bars[bars.length - 1 - period].close;
  return previous !== 0 ? (current - previous) / previous : 0;
}

export function rangeAtEnd(bars: OHLCV[], period: number): { pct: number; high: number; low: number } {
  const start = Math.max(0, bars.length - period);
  if (bars.length - start < 5) return { pct: 1, high: 0, low: 0 };
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < bars.length; i++) {
    high = Math.max(high, bars[i].high);
    low = Math.min(low, bars[i].low);
  }
  const mid = (high + low) / 2;
  return { pct: mid > 0 ? (high - low) / mid : 1, high, low };
}

export function annualizedRvPct(bars: OHLCV[], lookback = 20): number | undefined {
  if (bars.length < lookback + 1) return undefined;
  const returns: number[] = [];
  for (let i = bars.length - lookback; i < bars.length; i++) {
    const prev = bars[i - 1]?.close;
    const curr = bars[i]?.close;
    if (!prev || !curr) return undefined;
    returns.push(Math.log(curr / prev));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function drawdownFromHighPct(bars: OHLCV[], lookback: number, price: number): number | undefined {
  const slice = bars.slice(-lookback);
  if (slice.length === 0) return undefined;
  const high = Math.max(...slice.map(bar => bar.close));
  return high > 0 ? Math.max(0, (high - price) / high) : undefined;
}

function appendAggregatedBar(aggregated: OHLCV[], bar: OHLCV | undefined): void {
  if (!bar) return;
  const date = barDateKey(bar.date);
  const current = aggregated.at(-1);
  if (!current || current.date !== date) {
    aggregated.push({ ...bar, date });
    return;
  }
  current.high = Math.max(current.high, bar.high);
  current.low = Math.min(current.low, bar.low);
  current.close = bar.close;
  current.volume += bar.volume;
}

function appendRange(out: OHLCV[], bars: OHLCV[], from: number, toExclusive: number, intraday: boolean): void {
  for (let i = from; i < toExclusive; i++) {
    const bar = bars[i];
    if (intraday) appendAggregatedBar(out, bar);
    else if (bar) out.push(bar);
  }
}

export function createDecisionViewState(input: {
  qqqBars: OHLCV[];
  boxxBars?: OHLCV[];
  spyBars?: OHLCV[];
  minBarHistory: number;
  intraday: boolean;
}): DecisionViewState {
  const state: DecisionViewState = {
    qqq: [],
    leveraged: [],
    boxx: input.boxxBars ? [] : undefined,
    spy: input.spyBars ? [] : undefined,
    leveragedEnd: 0,
    boxxEnd: 0,
    spyEnd: 0,
  };
  appendRange(state.qqq, input.qqqBars, 0, input.minBarHistory, input.intraday);
  return state;
}

/** 只追加截至当前 bar 的输入，绝不读取未来 bar。 */
export function advanceDecisionView(state: DecisionViewState, input: {
  today: OHLCV;
  intraday: boolean;
  leveragedBars: OHLCV[];
  leveragedSliceEnd: number;
  boxxBars?: OHLCV[];
  boxxSliceEnd?: number;
  spyBars?: OHLCV[];
  spySliceEnd?: number;
}): void {
  appendRange(state.qqq, [input.today], 0, 1, input.intraday);
  appendRange(state.leveraged, input.leveragedBars, state.leveragedEnd, input.leveragedSliceEnd, input.intraday);
  state.leveragedEnd = Math.max(state.leveragedEnd, input.leveragedSliceEnd);
  if (input.boxxBars && state.boxx && input.boxxSliceEnd != null) {
    appendRange(state.boxx, input.boxxBars, state.boxxEnd, input.boxxSliceEnd, input.intraday);
    state.boxxEnd = Math.max(state.boxxEnd, input.boxxSliceEnd);
  }
  if (input.spyBars && state.spy && input.spySliceEnd != null) {
    appendRange(state.spy, input.spyBars, state.spyEnd, input.spySliceEnd, input.intraday);
    state.spyEnd = Math.max(state.spyEnd, input.spySliceEnd);
  }
}
