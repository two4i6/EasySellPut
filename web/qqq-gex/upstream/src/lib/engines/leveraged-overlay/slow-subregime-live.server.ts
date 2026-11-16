import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import YahooFinance from 'yahoo-finance2';
import { buildFrozenSlowSubregimeObservations, type SlowSubregimePoint, type SlowSubregimeSeries, type SlowSubregimeSnapshot } from './backtest/slow-subregime-model';
import { extendSlowSubregimeDiagnostics, SLOW_SUBREGIME_FROZEN_MODEL } from './slow-subregime-runtime';
import type { SlowSubregimeDiagnostic } from './backtest/types';
import { embeddedRedisCache } from '../../embeddedRedisCache';
import { qqqMarketSession } from '../../qqqMarketSession';

const SNAPSHOT = 'docs/overlay-tuning/fixtures/slow-subregime-market-2026-07-02.json';
const SYMBOLS = ['QQQ', 'SPY', 'RSP', 'IWM', 'XLY', 'XLP', 'LQD', 'TLT'] as const;
const CBOE_VIX = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (date: Date) => date.toISOString().slice(0, 10);
const mdy = (value: string) => { const [month, day, year] = value.replaceAll('"', '').split('/'); return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`; };
const csvRows = (csv: string) => csv.trim().split(/\r?\n/).map(line => line.split(',').map(cell => cell.replaceAll('"', '').trim()));

function mergeSeries(series: SlowSubregimeSeries, incoming: Array<Omit<SlowSubregimePoint, 'availableAt'>>, calendar: string[]): SlowSubregimeSeries {
  const points = [...new Map([...series.points, ...incoming].map(point => [point.observedAt, { observedAt: point.observedAt, value: point.value }])).values()]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .map(point => ({ ...point, availableAt: calendar.find(date => date > point.observedAt) }));
  return { ...series, points, checksum: sha(JSON.stringify(points)) };
}

async function fetchText(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

type LiveInputs = { quotes: (readonly [string, Array<Omit<SlowSubregimePoint, 'availableAt'>>])[]; vixCsv: string; treasuryCsv: string };
const SOURCE_CACHE = 'slow-subregime-inputs-v1';
const HOUR = 60 * 60 * 1000;
function sourceKey(now: Date) {
  const session = qqqMarketSession(now);
  // A completed daily bar must invalidate inputs collected before the close.
  return sha(JSON.stringify([SYMBOLS, CBOE_VIX, 'treasury-daily-yield-curve', '2025-01-01',
    iso(now), Math.floor(now.getTime() / HOUR), session.calendarVersion, session.minute >= session.stockCloseMinute]));
}
function validInputs(value: unknown): value is LiveInputs {
  if (!value || typeof value !== 'object') return false;
  const input = value as LiveInputs;
  return typeof input.vixCsv === 'string' && input.vixCsv.length > 0
    && typeof input.treasuryCsv === 'string' && input.treasuryCsv.length > 0
    && csvRows(input.vixCsv)[0]?.[4]?.toUpperCase() === 'CLOSE'
    && ['2 yr', '10 yr'].every(tenor => csvRows(input.treasuryCsv)[0]?.some(name => name.toLowerCase() === tenor))
    && Array.isArray(input.quotes) && input.quotes.length === SYMBOLS.length
    && input.quotes.every((entry, index) => Array.isArray(entry) && entry[0] === SYMBOLS[index]
      && Array.isArray(entry[1]) && entry[1].length > 0 && entry[1].every(point => point
        && typeof point.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(point.observedAt)
        && typeof point.value === 'number' && Number.isFinite(point.value)));
}

/** Cache source observations across disposable workers; recompute model diagnostics each run. */
export async function loadLiveSlowSubregimeInputs(now = new Date()): Promise<LiveInputs> {
  const key = sourceKey(now), existing = await embeddedRedisCache.getJson<unknown>(SOURCE_CACHE, key);
  if (existing && validInputs(existing.data)) return existing.data;
  const yahoo = new YahooFinance(), period2 = new Date(now.getTime() + 86400000);
  const [quotes, vixCsv, treasuryCsv] = await Promise.all([
    Promise.all(SYMBOLS.map(async symbol => {
      const result = await yahoo.chart(symbol, { period1: new Date('2025-01-01'), period2, interval: '1d' });
      return [symbol, result.quotes.flatMap(quote => quote.adjclose != null && Number.isFinite(quote.adjclose) ? [{ observedAt: iso(quote.date), value: quote.adjclose }] : [])] as const;
    })),
    fetchText(CBOE_VIX),
    fetchText(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${now.getUTCFullYear()}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${now.getUTCFullYear()}&page&_format=csv`),
  ]);
  const inputs = { quotes, vixCsv, treasuryCsv };
  if (!validInputs(inputs)) throw new Error('Incomplete Slow Regime source observations');
  await embeddedRedisCache.setJson(SOURCE_CACHE, key, inputs, (Math.floor(now.getTime() / HOUR) + 1) * HOUR);
  return inputs;
}

async function loadLive(): Promise<Record<string, SlowSubregimeDiagnostic>> {
  const snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as SlowSubregimeSnapshot;
  const now = new Date();
  const { quotes, vixCsv, treasuryCsv } = await loadLiveSlowSubregimeInputs(now);
  const qqqIncoming = quotes.find(([symbol]) => symbol === 'QQQ')![1];
  const calendar = [...new Set([...snapshot.prices.QQQ.points.map(point => point.observedAt), ...qqqIncoming.map(point => point.observedAt)])].sort();
  for (const [symbol, points] of quotes) snapshot.prices[symbol] = mergeSeries(snapshot.prices[symbol], points, calendar);

  const [, ...vixRows] = csvRows(vixCsv);
  const vix = vixRows.flatMap(row => row[0] && Number.isFinite(Number(row[4])) ? [{ observedAt: mdy(row[0]), value: Number(row[4]) }] : []);
  snapshot.volatility.VIX = mergeSeries(snapshot.volatility.VIX, vix, calendar);

  const [headers, ...rateRows] = csvRows(treasuryCsv), names = headers.map(name => name.toLowerCase());
  for (const tenor of ['2 yr', '10 yr'] as const) {
    const index = names.indexOf(tenor);
    if (index < 0) throw new Error(`Treasury ${tenor} column missing`);
    const points = rateRows.flatMap(row => row[0] && Number.isFinite(Number(row[index])) ? [{ observedAt: mdy(row[0]), value: Number(row[index]) }] : []);
    snapshot.rates[tenor] = mergeSeries(snapshot.rates[tenor], points, calendar);
  }
  snapshot.asOf = iso(now); snapshot.end = calendar.at(-1) ?? snapshot.end;
  const rows = buildFrozenSlowSubregimeObservations(snapshot, SLOW_SUBREGIME_FROZEN_MODEL.featureIds, SLOW_SUBREGIME_FROZEN_MODEL.normalization, SLOW_SUBREGIME_FROZEN_MODEL.terminalDate);
  return Object.fromEntries(extendSlowSubregimeDiagnostics(rows).map(item => [item.effectiveDate!, item]));
}

let cached: { key: string; expires: number; value: Promise<Record<string, SlowSubregimeDiagnostic>> } | undefined;
export function loadLiveSlowSubregimeDiagnostics() {
  const now = new Date(), key = sourceKey(now);
  if (!cached || cached.key !== key || cached.expires <= now.getTime()) {
    const value = loadLive();
    cached = { key, expires: (Math.floor(now.getTime() / HOUR) + 1) * HOUR, value };
    value.catch(() => { if (cached?.value === value) cached = undefined; });
  }
  return cached.value;
}
