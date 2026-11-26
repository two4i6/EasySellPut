import { easternDayStartUtc, easternNextDayStartUtc } from './engineTimeline';
import { supabaseAdmin } from './supabase';
import { createSuccessfulWriteCache } from './successfulWriteCache';

const QQQ_CANDLE_TIMEOUT_MS = 3_000;
const writeClosedCandles = createSuccessfulWriteCache();

export type QqqIntradayCandle = {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume: number;
};

function validCandle(candle: QqqIntradayCandle): boolean {
  return typeof candle.timestamp === 'string'
    && Number.isFinite(new Date(candle.timestamp).getTime())
    && [candle.open, candle.high, candle.low, candle.close].every((value) => value === undefined || (Number.isFinite(value) && value > 0))
    && Number.isFinite(candle.close) && candle.close > 0
    && Number.isFinite(candle.volume) && candle.volume >= 0;
}

/**
 * Merges persisted, closed two-minute candles with Yahoo's live response.
 * The live row wins for a shared bucket; this keeps the still-forming candle
 * current without rewriting the immutable persisted history.
 */
export function mergeQqqIntradayCandles(
  persisted: QqqIntradayCandle[],
  live: QqqIntradayCandle[],
): QqqIntradayCandle[] {
  const byTime = new Map<string, QqqIntradayCandle>();
  for (const candle of persisted) if (validCandle(candle)) byTime.set(candle.timestamp, candle);
  for (const candle of live) if (validCandle(candle)) byTime.set(candle.timestamp, candle);
  return Array.from(byTime.values()).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/** Store only completed candles. A currently forming Yahoo bucket stays live-only. */
export async function appendQqqClosedIntradayCandles(candles: QqqIntradayCandle[]): Promise<boolean> {
  const closed = candles.slice(0, -1).filter(validCandle);
  if (!closed.length) return true;
  return writeClosedCandles(closed, candle => candle.timestamp, persistClosedCandles);
}

async function persistClosedCandles(closed: QqqIntradayCandle[]): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_CANDLE_TIMEOUT_MS);
  try {
    const { error } = await supabaseAdmin.from('qqq_intraday_candle').upsert(
      closed.map((candle) => ({
        symbol: 'QQQ', bar_at: candle.timestamp, interval_seconds: 120,
        open: candle.open ?? candle.close, high: candle.high ?? candle.close, low: candle.low ?? candle.close,
        close: candle.close, volume: candle.volume,
      })),
      { onConflict: 'symbol,bar_at,interval_seconds', ignoreDuplicates: true },
    ).abortSignal(controller.signal);
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Read-only fallback; a missing migration or transient DB failure is non-fatal. */
export async function readTodayQqqIntradayCandles(now = new Date()): Promise<QqqIntradayCandle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_CANDLE_TIMEOUT_MS);
  try {
    const { data, error } = await supabaseAdmin.from('qqq_intraday_candle')
      .select('bar_at, open, high, low, close, volume')
      .eq('symbol', 'QQQ').eq('interval_seconds', 120)
      .gte('bar_at', easternDayStartUtc(now).toISOString())
      .lt('bar_at', easternNextDayStartUtc(now).toISOString())
      .order('bar_at', { ascending: true })
      .abortSignal(controller.signal);
    if (error) return [];
    return (data ?? []).flatMap((row: any) => {
      const candle = { timestamp: row.bar_at, open: row.open, high: row.high, low: row.low, close: row.close, volume: Number(row.volume) };
      return validCandle(candle) ? [candle] : [];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Select the latest actual Eastern session, not a guessed weekday/holiday. */
export function latestQqqCandleSession(candles: QqqIntradayCandle[], now = new Date()): QqqIntradayCandle[] {
  const valid = candles.filter(candle => validCandle(candle) && Date.parse(candle.timestamp) <= now.getTime())
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const last = valid.at(-1);
  if (!last) return [];
  const from = easternDayStartUtc(new Date(last.timestamp)).getTime();
  return valid.filter(candle => Date.parse(candle.timestamp) >= from);
}

/** A bounded indexed read also works before today's first bar and on holidays. */
export async function readLatestQqqIntradayCandles(now = new Date()): Promise<QqqIntradayCandle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_CANDLE_TIMEOUT_MS);
  try {
    let { data, error } = await supabaseAdmin.rpc('qqq_candle_latest_session_v1', { p_now: now.toISOString() })
      .abortSignal(controller.signal);
    // Older installations retain the bounded read. Timeouts never trigger a second load.
    if (error && ['PGRST202','42883'].includes(error.code)) ({ data, error } = await supabaseAdmin.from('qqq_intraday_candle')
      .select('bar_at, open, high, low, close, volume')
      .eq('symbol', 'QQQ').eq('interval_seconds', 120)
      .gte('bar_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())
      .lte('bar_at', now.toISOString())
      .order('bar_at', { ascending: false }).limit(720)
      .abortSignal(controller.signal));
    if (error) return [];
    return latestQqqCandleSession((data ?? []).map((row: any) => ({
      timestamp: row.bar_at, open: row.open, high: row.high, low: row.low, close: row.close, volume: Number(row.volume),
    })), now);
  } catch { return []; }
  finally { clearTimeout(timeout); }
}
