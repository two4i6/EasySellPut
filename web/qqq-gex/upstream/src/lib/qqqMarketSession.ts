/** Data acquisition calendar only. Never gates historical strategy admission.
 * Sources: nasdaqtrader.com/Trader.aspx?id=optionshours and ?id=Calendar;
 * NYSE eligible-option early closes: nyse.com/markets/hours-calendars.
 */
export const QQQ_MARKET_CALENDAR_VERSION = 'nasdaq-20261008-v1';
const easternFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const sessionCache = new Map<string, ReturnType<typeof buildSessionForDate>>();
const iso = (date: Date) => date.toISOString().slice(0, 10);
const day = (year: number, month: number, date: number) => new Date(Date.UTC(year, month - 1, date, 12));
function nth(year: number, month: number, weekday: number, n: number) {
  const first = day(year, month, 1);
  return iso(day(year, month, 1 + (weekday - first.getUTCDay() + 7) % 7 + (n - 1) * 7));
}
function observed(year: number, month: number, date: number) {
  const value = day(year, month, date);
  // NYSE/Nasdaq do not close the prior Friday for a Saturday New Year's Day.
  if (value.getUTCDay() === 6 && month !== 1) value.setUTCDate(value.getUTCDate() - 1);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return iso(value);
}
function goodFriday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const value = day(year, Math.floor((h + l - 7 * m + 114) / 31), (h + l - 7 * m + 114) % 31 + 1);
  value.setUTCDate(value.getUTCDate() - 2); return iso(value);
}
export function qqqTradingDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`), year = value.getUTCFullYear();
  if (!Number.isFinite(value.getTime()) || [0, 6].includes(value.getUTCDay())) return false;
  const memorial = day(year, 5, 31); memorial.setUTCDate(31 - (memorial.getUTCDay() + 6) % 7);
  const holidays = [observed(year, 1, 1), nth(year, 1, 1, 3), nth(year, 2, 1, 3), goodFriday(year), iso(memorial),
    ...(year >= 2022 ? [observed(year, 6, 19)] : []), observed(year, 7, 4), nth(year, 9, 1, 1), nth(year, 11, 4, 4), observed(year, 12, 25),
    // Exceptional full exchange closures, separate from strategy evaluation.
    '2025-01-09', '2018-12-05', '2012-10-29', '2012-10-30', '2007-01-02', '2004-06-11'];
  return !holidays.includes(date);
}
function buildSessionForDate(date: string) {
  const year = Number(date.slice(0, 4));
  const thanksgivingFriday = new Date(`${nth(year, 11, 4, 4)}T12:00:00Z`); thanksgivingFriday.setUTCDate(thanksgivingFriday.getUTCDate() + 1);
  const early = date === iso(thanksgivingFriday) || date === `${year}-12-24` || date === `${year}-07-03`;
  const trading = qqqTradingDate(date);
  return { date, trading, openMinute: 570, stockCloseMinute: early ? 780 : 960, optionCloseMinute: early ? 795 : 975,
    stockAcquisitionCloseMinute: early ? 1020 : 1200,
    expectedStockBuckets: trading ? (early ? 105 : 195) : 0, calendarVersion: QQQ_MARKET_CALENDAR_VERSION };
}
export function qqqSessionForDate(date: string) {
  let session = sessionCache.get(date);
  if (!session) {
    session = Object.freeze(buildSessionForDate(date));
    if (sessionCache.size >= 1024) sessionCache.clear();
    sessionCache.set(date, session);
  }
  return session;
}
export function qqqMarketSession(now = new Date()) {
  const parts = Object.fromEntries(easternFormatter.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`, minute = Number(parts.hour) * 60 + Number(parts.minute);
  const session = qqqSessionForDate(date);
  return { ...session, minute, optionsOpen: session.trading && minute >= 570 && minute < session.optionCloseMinute,
    stocksOpen: session.trading && minute >= 570 && minute < session.stockCloseMinute,
    premarket: session.trading && minute >= 240 && minute < 570,
    postmarket: session.trading && minute >= session.stockCloseMinute && minute < session.stockAcquisitionCloseMinute,
    stockAcquisitionOpen: session.trading && minute >= 240 && minute < session.stockAcquisitionCloseMinute };
}

export function qqqPreviousTradingDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  do { value.setUTCDate(value.getUTCDate() - 1); } while (!qqqTradingDate(iso(value)));
  return iso(value);
}

/** Display/execution calendar; does not evaluate strategy admission. */
export function qqqNextTradingDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  do { value.setUTCDate(value.getUTCDate() + 1); } while (!qqqTradingDate(iso(value)));
  return iso(value);
}

/** Bars are labelled by open; analytical inputs become available only at close. */
export function qqqClosedBarPrice(bars: readonly { timestamp: string; close: number }[], asOf: string | number, intervalSeconds = 120) {
  const cutoff = typeof asOf === 'string' ? Date.parse(asOf) : asOf;
  let selected: { timestamp: string; close: number } | undefined;
  for (const bar of bars) {
    const opened = Date.parse(bar.timestamp);
    if (Number.isFinite(opened) && opened + intervalSeconds * 1000 <= cutoff && Number.isFinite(bar.close) && bar.close > 0 && (!selected || opened > Date.parse(selected.timestamp))) selected = bar;
  }
  return selected;
}

/** Display quote policy; never supplies volume or strategy observations. */
export function qqqLiveQuoteUsable(quote: { time: number; price: number } | null | undefined, nowMs = Date.now(), date?: string) {
  if (!quote || !Number.isFinite(quote.time) || !Number.isFinite(quote.price) || quote.price <= 0) return false;
  const at = quote.time * 1000;
  if (at > nowMs + 5000 || nowMs - at > 45000) return false;
  const session = qqqMarketSession(new Date(at)), current = qqqMarketSession(new Date(nowMs));
  return session.stockAcquisitionOpen && current.stockAcquisitionOpen && session.date === current.date && (!date || session.date === date);
}

/** Frozen levels are references from a real completed option session, not a
 * stale mid-session model. Restrict carry to the previous trading day. */
export function qqqFrozenReferenceUsable(sourceAsOf: string | null, nowMs: number, expiryDate?: string) {
  const sourceMs = Date.parse(sourceAsOf ?? '');
  if (!Number.isFinite(sourceMs) || sourceMs > nowMs) return false;
  const current = qqqMarketSession(new Date(nowMs)), source = qqqMarketSession(new Date(sourceMs));
  if (current.optionsOpen || !source.trading || source.minute < source.stockCloseMinute - 6 || source.minute > source.optionCloseMinute) return false;
  const referenceDate = current.trading && current.minute >= current.optionCloseMinute ? current.date : qqqPreviousTradingDate(current.date);
  if (source.date !== referenceDate) return false;
  if (expiryDate && (expiryDate < current.date || expiryDate === current.date && current.minute >= current.optionCloseMinute)) return false;
  return true;
}

/** Authenticated intraday API envelope: 09:00–16:30 ET, earlier on half days. */
export function isQqqIntradayCollectorOpen(now: Date) {
  const session = qqqMarketSession(now);
  const cutoff = session.stockCloseMinute < 960 ? session.optionCloseMinute : 990;
  return session.trading && session.minute >= 540 && session.minute < cutoff;
}
