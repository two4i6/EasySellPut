import { runMarketRegime } from '../engines/03-market-regime';
import { isoWeek } from '../engines/macro-regime-state';
import { DEFAULT_STRATEGY_PARAMS } from '../types/params';
import type { OHLCV } from '../types/input';
import type { PipelineContext } from '../types/pipeline';

export type Cadence = '3day' | 'week' | 'month';
export type ResampledVote = 'BULLISH_MAJORITY' | 'BEARISH_MAJORITY' | 'NO_MAJORITY';

const bucketFor = (bar: OHLCV, index: number, cadence: Cadence) => cadence === '3day'
  ? String(Math.floor(index / 3))
  : cadence === 'week' ? isoWeek(bar.date) : bar.date.slice(0, 7);

export function resampleBars(qqqBars: OHLCV[], cadence: Cadence): OHLCV[] {
  const out: OHLCV[] = [];
  let bucket = '';
  for (let index = 0; index < qqqBars.length; index++) {
    const bar = qqqBars[index]!;
    const nextBucket = bucketFor(bar, index, cadence);
    if (nextBucket !== bucket) {
      out.push({ ...bar });
      bucket = nextBucket;
    } else {
      const aggregate = out[out.length - 1]!;
      aggregate.high = Math.max(aggregate.high, bar.high);
      aggregate.low = Math.min(aggregate.low, bar.low);
      aggregate.close = bar.close;
      aggregate.volume += bar.volume;
      aggregate.date = bar.date;
    }
  }
  return out;
}

function resampledMacro(
  qqqBars: OHLCV[],
  cadence: Cadence,
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
) {
  const vix: Record<string, number> = {}, vix3m: Record<string, number> = {};
  let bucket = '', latestVix: number | undefined, latestVix3m: number | undefined;
  for (let index = 0; index < qqqBars.length; index++) {
    const bar = qqqBars[index]!;
    const nextBucket = bucketFor(bar, index, cadence);
    if (nextBucket !== bucket && bucket) {
      const previous = qqqBars[index - 1]!;
      if (latestVix != null) vix[previous.date] = latestVix;
      if (latestVix3m != null) vix3m[previous.date] = latestVix3m;
    }
    bucket = nextBucket;
    if (vixByDate[bar.date] != null) latestVix = vixByDate[bar.date];
    if (vix3mByDate[bar.date] != null) latestVix3m = vix3mByDate[bar.date];
  }
  const last = qqqBars.at(-1);
  if (last) {
    if (latestVix != null) vix[last.date] = latestVix;
    if (latestVix3m != null) vix3m[last.date] = latestVix3m;
  }
  return { vix, vix3m };
}

export function computeResampledVote(
  cadence: Cadence,
  qqqBarsThroughToday: OHLCV[],
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
): ResampledVote {
  const qqqBars = resampleBars(qqqBarsThroughToday, cadence);
  const last = qqqBars.at(-1);
  if (!last) return 'NO_MAJORITY';
  const macro = resampledMacro(qqqBarsThroughToday, cadence, vixByDate, vix3mByDate);
  const ctx: PipelineContext = {
    input: {
      date: last.date,
      strategyParams: DEFAULT_STRATEGY_PARAMS,
      account: { netLiquidation: 100_000, cash: 100_000, positions: [] },
      prices: { QQQ: qqqBars, TQQQ: [] },
      macro: { vix: macro.vix[last.date], prevVix: qqqBars.length > 1 ? macro.vix[qqqBars[qqqBars.length - 2]!.date] : undefined, vix3m: macro.vix3m[last.date] },
    },
    results: {},
  };
  const regime = runMarketRegime(ctx).data.regime;
  return regime === 'BULL' || regime === 'RISK_ON_EXTENDED' || regime === 'RISK_ON_WEAKENING'
    ? 'BULLISH_MAJORITY'
    : regime === 'BEAR' || regime === 'CRISIS' ? 'BEARISH_MAJORITY' : 'NO_MAJORITY';
}
