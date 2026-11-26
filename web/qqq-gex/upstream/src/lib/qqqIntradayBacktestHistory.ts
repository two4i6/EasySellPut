import type { QqqIntradayCandle } from './qqqIntradayCandles';
import { supabaseAdmin } from './supabase';

const QQQ_INTRADAY_BACKTEST_TIMEOUT_MS = 8_000;

export type QqqIntradayBacktestHistoryPage = {
  range: { from: string; to: string; toExclusive: true };
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
  rejectedBars: number;
  bars: QqqIntradayCandle[];
};

type StoredQqqIntradayBar = {
  bar_at: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
};

const finitePositive = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value)
  && value > 0;

function parseStoredBar(value: unknown): QqqIntradayCandle | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as StoredQqqIntradayBar;
  const timestamp = typeof row.bar_at === 'string' ? Date.parse(row.bar_at) : Number.NaN;
  const volume = Number(row.volume);
  if (!Number.isFinite(timestamp)
    || ![row.open, row.high, row.low, row.close].every(finitePositive)
    || !Number.isFinite(volume)
    || volume < 0) return null;
  return {
    timestamp: new Date(timestamp).toISOString(),
    open: row.open as number,
    high: row.high as number,
    low: row.low as number,
    close: row.close as number,
    volume,
  };
}

/**
 * Normalize persisted rows for formal replay only. Rows outside [from, to),
 * invalid rows, and duplicate bar timestamps are excluded deterministically.
 */
export function normalizeQqqIntradayBacktestBars(
  rows: readonly unknown[],
  range: { from: string; to: string },
): { bars: QqqIntradayCandle[]; rejectedBars: number } {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return { bars: [], rejectedBars: rows.length };
  }

  const byTimestamp = new Map<number, QqqIntradayCandle>();
  let rejectedBars = 0;
  for (const row of rows) {
    const bar = parseStoredBar(row);
    const timestamp = bar ? Date.parse(bar.timestamp) : Number.NaN;
    if (!bar || timestamp < from || timestamp >= to || byTimestamp.has(timestamp)) {
      rejectedBars += 1;
      continue;
    }
    byTimestamp.set(timestamp, bar);
  }
  return {
    bars: [...byTimestamp.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    rejectedBars,
  };
}

/** Formal-replay-only persisted QQQ 2m OHLCV page; never reads live session data. */
export async function readQqqIntradayBacktestHistoryPage(input: {
  from: string;
  to: string;
  page: number;
  pageSize: number;
}): Promise<QqqIntradayBacktestHistoryPage | null> {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to
    || !Number.isInteger(input.page) || input.page < 1
    || !Number.isInteger(input.pageSize) || input.pageSize < 1) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_INTRADAY_BACKTEST_TIMEOUT_MS);
  try {
    const offset = (input.page - 1) * input.pageSize;
    const result = await supabaseAdmin.from('qqq_intraday_candle')
      .select('bar_at, open, high, low, close, volume')
      .eq('symbol', 'QQQ')
      .eq('interval_seconds', 120)
      .gte('bar_at', new Date(from).toISOString())
      .lt('bar_at', new Date(to).toISOString())
      .order('bar_at', { ascending: true })
      .range(offset, offset + input.pageSize)
      .abortSignal(controller.signal);
    if (result.error) return null;

    const rawRows = (result.data ?? []) as unknown[];
    const hasMore = rawRows.length > input.pageSize;
    const pageRows = rawRows.slice(0, input.pageSize);
    const normalized = normalizeQqqIntradayBacktestBars(pageRows, {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    return {
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), toExclusive: true },
      page: input.page,
      pageSize: input.pageSize,
      hasMore,
      nextPage: hasMore ? input.page + 1 : null,
      rejectedBars: normalized.rejectedBars,
      bars: normalized.bars,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
