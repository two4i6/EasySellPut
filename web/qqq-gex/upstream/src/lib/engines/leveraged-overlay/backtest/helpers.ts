import * as crypto from 'crypto';
import { yahooFinanceServer } from '../../../../services/adapters/yahooFinanceServer';
import { completeVix3mByDate } from '../../../../services/adapters/vix3mHistoryServer';
import type { OHLCV } from '../types/input';
import type { SplitEvent } from '../types/input';
import type { OverlayUniverse } from '../universe';
import { createRawFactor } from '../../../factor';

export interface DataFingerprint {
  qqqBarCount: number;
  tqqqBarCount: number;
  qqqLastDate: string;
  tqqqLastDate: string;
  closeChecksum: string;
}

export function dataFingerprint(bars: { qqqBars: OHLCV[]; tqqqBars: OHLCV[] }): DataFingerprint {
  const qqqBarCount = bars.qqqBars.length;
  const tqqqBarCount = bars.tqqqBars.length;
  const qqqLastDate = bars.qqqBars.length > 0 ? bars.qqqBars[bars.qqqBars.length - 1].date : '';
  const tqqqLastDate = bars.tqqqBars.length > 0 ? bars.tqqqBars[bars.tqqqBars.length - 1].date : '';

  const qqqCloses = bars.qqqBars.map(b => b.close.toString()).join(',');
  const tqqqCloses = bars.tqqqBars.map(b => b.close.toString()).join(',');
  const combined = `QQQ:${qqqCloses}|TQQQ:${tqqqCloses}`;

  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  const closeChecksum = hash.slice(0, 12);

  return {
    qqqBarCount,
    tqqqBarCount,
    qqqLastDate,
    tqqqLastDate,
    closeChecksum,
  };
}

type YahooChartFactor = {
  value?: {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<Record<'open' | 'high' | 'low' | 'close' | 'volume', Array<number | null | undefined>>> };
      }>;
    };
  } | null;
};

export function chartToOHLCV(factor: YahooChartFactor): OHLCV[] {
  const result = factor.value?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps || !quote) return [];

  const bars: OHLCV[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    bars.push({
      date,
      open: quote.open[i] ?? close,
      high: quote.high[i] ?? close,
      low: quote.low[i] ?? close,
      close,
      volume: quote.volume[i] ?? 0,
    });
  }
  return bars;
}

export function barsToMap(bars: OHLCV[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bar of bars) out[bar.date] = bar.close;
  return out;
}

export async function loadBars(universe?: OverlayUniverse, includeSpy = false, optionUnderlyingSymbol?: string, historyRange = 'max') {
  const leveraged = universe?.leveragedSymbol ?? 'TQQQ';
  const underlying = optionUnderlyingSymbol ?? 'QQQ';
  const [qqq, leveragedResult, boxx, vix, vix3m, vxn, spy] = await Promise.all([
    yahooFinanceServer.getHistorical(underlying, historyRange, '1d'),
    yahooFinanceServer.getHistorical(leveraged, historyRange, '1d'),
    yahooFinanceServer.getHistorical('BOXX', historyRange, '1d').catch(() => ({ value: null })),
    yahooFinanceServer.getHistorical('^VIX', historyRange, '1d'),
    yahooFinanceServer.getHistorical('^VIX3M', historyRange, '1d').catch(() => ({ value: null })),
    yahooFinanceServer.getHistorical('^VXN', historyRange, '1d').catch(() => ({ value: null })),
    includeSpy ? yahooFinanceServer.getHistorical('SPY', historyRange, '1d').catch(() => ({ value: null })) : Promise.resolve(undefined),
  ]);
  const qqqBars = chartToOHLCV(qqq);
  const spyBars = spy ? chartToOHLCV(spy) : undefined;
  const leveragedBars = chartToOHLCV(leveragedResult);
  const vixBars = chartToOHLCV(vix);
  const vix3mBars = chartToOHLCV(vix3m);
  const vxnBars = chartToOHLCV(vxn);
  const vix3mCoverage = await completeVix3mByDate({
    primaryByDate: barsToMap(vix3mBars),
    requiredDates: qqqBars.map(({ date }) => date),
    refreshYahoo: async () => barsToMap(chartToOHLCV(
      await yahooFinanceServer.getHistorical('^VIX3M', historyRange, '1d', 30_000, true),
    )),
  });
  const vixByDate = barsToMap(vixBars);
  const missingVixDates = [...new Set(qqqBars.map(bar => bar.date).filter(date => vixByDate[date] === undefined))];
  if (missingVixDates.length) {
    const fresh = barsToMap(chartToOHLCV(await yahooFinanceServer.getHistorical('^VIX', historyRange, '1d', 30_000, true)));
    for (const date of missingVixDates) {
      if (vixByDate[date] === undefined && Number.isFinite(fresh[date]) && fresh[date] > 0) vixByDate[date] = fresh[date];
    }
  }
  const chart = (leveragedResult as { value?: { chart?: { result?: Array<{ events?: { splits?: Record<string, unknown> | unknown[] } }> } } }).value?.chart?.result?.[0];
  const rawSplits = chart?.events?.splits;
  const splitValues = Array.isArray(rawSplits) ? rawSplits : rawSplits && typeof rawSplits === 'object' ? Object.values(rawSplits) : [];
  const splitEvents: SplitEvent[] = splitValues.flatMap(raw => {
    const split = raw as { date?: string | number | Date; numerator?: number; denominator?: number };
    const numerator = Number(split.numerator);
    const denominator = Number(split.denominator);
    const date = new Date(typeof split.date === 'number' && split.date < 1e12 ? split.date * 1000 : split.date ?? '');
    return Number.isNaN(date.getTime()) || !Number.isFinite(numerator / denominator) || numerator <= 0 || denominator <= 0
      ? []
      : [{ date: date.toISOString().slice(0, 10), numerator, denominator, ratio: numerator / denominator }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const splitEventsBySymbol = {
    [leveraged]: createRawFactor(splitEvents, events => events.length > 0, 'Yahoo Finance Chart', `${leveraged} 拆股事件`, []),
  };
  return {
    qqqBars,
    tqqqBars: leveragedBars,
    spyBars,
    barsBySymbol: { QQQ: qqqBars, ...(underlying !== 'QQQ' ? { [underlying]: qqqBars } : {}), ...(spyBars ? { SPY: spyBars } : {}), [leveraged]: leveragedBars },
    boxxBars: chartToOHLCV(boxx),
    vixByDate,
    vixFallbackCount: missingVixDates.filter(date => vixByDate[date] !== undefined).length,
    vix3mByDate: vix3mCoverage.byDate,
    vix3mCoverage,
    vxnByDate: barsToMap(vxnBars),
    splitEventsBySymbol,
  };
}

export function groupBy<K, T>(items: T[], keyFor: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}
