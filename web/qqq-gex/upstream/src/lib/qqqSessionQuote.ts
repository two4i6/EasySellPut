import { qqqEasternDateKey } from './qqqMarketDate';
import { qqqMarketSession, qqqTradingDate } from './qqqMarketSession';

export type QqqSessionQuote = { date: string; price: number; change: number | null; changePercent: number | null };

/** Only non-trading days need a completed-session quote instead of a live tick. */
export function qqqClosedSessionDate(now: Date): string | null {
  const session = qqqMarketSession(now);
  if (session.stockAcquisitionOpen) return null;
  if (session.trading && session.minute >= session.stockAcquisitionCloseMinute) return session.date;
  const day = new Date(`${session.date}T12:00:00Z`);
  do { day.setUTCDate(day.getUTCDate() - 1); } while (!qqqTradingDate(day.toISOString().slice(0, 10)));
  return day.toISOString().slice(0, 10);
}

/** Reject fallback, incomplete, or older-session data rather than inventing a daily move. */
export function parseQqqSessionQuote(payload: unknown, expectedDate: string): QqqSessionQuote | null {
  if (!payload || typeof payload !== 'object') return null;
  const factor = payload as { confidence?: number; value?: { price?: number; previousClose?: number; meta?: { date?: string | number } } };
  const value = factor.value;
  if (!(typeof factor.confidence === 'number' && factor.confidence > 0) || !value || typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0) return null;
  const time = value.meta?.date;
  if (time === undefined || !Number.isFinite(new Date(time).getTime()) || qqqEasternDateKey(time) !== expectedDate) return null;
  const previousClose = value.previousClose;
  const change = typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose > 0 ? value.price - previousClose : null;
  return { date: expectedDate, price: value.price, change, changePercent: change === null ? null : change / previousClose! * 100 };
}
