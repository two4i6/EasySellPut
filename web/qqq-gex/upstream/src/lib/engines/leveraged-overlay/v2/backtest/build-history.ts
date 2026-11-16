import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createRawFactor } from '../../../../factor';
import { loadBars } from '../../backtest/helpers';
import type { OHLCV, SplitEvent } from '../../types/input';
import { getOverlayUniverse, type OverlayUniverseId } from '../../universe';

const SNAPSHOT_PATH = 'data/backtest-build-history.json.gz';
const SYMBOLS = ['QQQ', 'SPY', 'TQQQ', 'QLD'] as const;
const SNAPSHOT_UNIVERSES = ['nasdaq-tqqq', 'nasdaq-qld', 'nasdaq-qqq'] as const;
type LoadedBars = Awaited<ReturnType<typeof loadBars>>;

export type BuiltHistory = {
  version: 1;
  createdAt: string;
  buildDate: string;
  cutoffDate: string;
  source: 'Yahoo Finance Chart; VIX3M Yahoo/CBOE/FRED same-day completion';
  availabilityRule: 'complete daily history through build day T-1; runtime from build day';
  interval: '1d';
  warmup: 'complete source history';
  symbols: Record<string, OHLCV[]>;
  splitEvents: Record<string, SplitEvent[]>;
  boxxBars: OHLCV[];
  vixByDate: Record<string, number>;
  vix3mByDate: Record<string, number>;
  vxnByDate: Record<string, number>;
  vixFallbackCount: number;
  vix3mCoverage: Omit<LoadedBars['vix3mCoverage'], 'byDate'>;
};

type SnapshotEnvelope = { sha256: string; payload: BuiltHistory };
let cached: Promise<BuiltHistory | null> | undefined;

export function newYorkDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function previousCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function closedWeekdaysSinceBuild(snapshot: BuiltHistory, now = new Date()): number {
  const today = newYorkDay(now);
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const hour = Number(clock.find(part => part.type === 'hour')?.value);
  const minute = Number(clock.find(part => part.type === 'minute')?.value);
  let count = 0;
  for (let date = snapshot.buildDate; date <= today; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (date < today || hour * 60 + minute >= 16 * 60 + 30) count++;
  }
  return count;
}

function through<T extends { date: string }>(items: T[], cutoff: string): T[] {
  return items.filter(item => item.date <= cutoff);
}

function mapThrough(values: Record<string, number>, cutoff: string): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter(([day]) => day <= cutoff));
}

function validate(snapshot: BuiltHistory): void {
  if (snapshot.version !== 1 || snapshot.interval !== '1d' || snapshot.cutoffDate !== previousCalendarDay(snapshot.buildDate)) {
    throw new Error('Invalid build history metadata');
  }
  for (const symbol of SYMBOLS) {
    const bars = snapshot.symbols[symbol];
    const daysStale = bars?.length ? (Date.parse(`${snapshot.cutoffDate}T00:00:00Z`) - Date.parse(`${bars.at(-1)!.date}T00:00:00Z`)) / 86_400_000 : Infinity;
    if (!bars?.length || bars.length < 200 || daysStale > 7 || bars.some((bar, index) => bar.date > snapshot.cutoffDate || (index > 0 && bars[index - 1].date >= bar.date))) {
      throw new Error(`Incomplete or unsorted build history: ${symbol}`);
    }
  }
  for (const [symbol, bars] of Object.entries(snapshot.symbols)) {
    const daysStale = bars.length ? (Date.parse(`${snapshot.cutoffDate}T00:00:00Z`) - Date.parse(`${bars.at(-1)!.date}T00:00:00Z`)) / 86_400_000 : Infinity;
    if (!/^[A-Z][A-Z0-9.^-]{0,14}$/.test(symbol) || bars.length < 200 || daysStale > 7 || bars.some((bar, index) => bar.date > snapshot.cutoffDate || (index > 0 && bars[index - 1].date >= bar.date))) {
      throw new Error(`Invalid build history symbol: ${symbol}`);
    }
  }
  if (!snapshot.boxxBars.length || !Object.keys(snapshot.vixByDate).length || !Object.keys(snapshot.vxnByDate).length) throw new Error('Build history lacks cash or volatility data');
}

export async function createBuiltHistory(now = new Date(), loader: typeof loadBars = loadBars): Promise<BuiltHistory> {
  const buildDate = newYorkDay(now);
  const cutoffDate = previousCalendarDay(buildDate);
  const symbols: Record<string, OHLCV[]> = {};
  const splitEvents: Record<string, SplitEvent[]> = {};
  let common: LoadedBars | undefined;
  for (const universeId of SNAPSHOT_UNIVERSES) {
    const universe = getOverlayUniverse(universeId);
    const data = await loader(universe, true, 'QQQ', 'max');
    if (!common) common = data;
    symbols[universe.leveragedSymbol] = through(data.tqqqBars, cutoffDate);
    splitEvents[universe.leveragedSymbol] = through(data.splitEventsBySymbol?.[universe.leveragedSymbol]?.value ?? [], cutoffDate);
  }
  if (!common) throw new Error('No build history was fetched');
  symbols.QQQ = through(common.qqqBars, cutoffDate);
  symbols.SPY = through(common.spyBars ?? [], cutoffDate);
  const snapshot: BuiltHistory = {
    version: 1,
    createdAt: now.toISOString(),
    buildDate,
    cutoffDate,
    source: 'Yahoo Finance Chart; VIX3M Yahoo/CBOE/FRED same-day completion',
    availabilityRule: 'complete daily history through build day T-1; runtime from build day',
    interval: '1d',
    warmup: 'complete source history',
    symbols,
    splitEvents,
    boxxBars: through(common.boxxBars, cutoffDate),
    vixByDate: mapThrough(common.vixByDate, cutoffDate),
    vix3mByDate: mapThrough(common.vix3mByDate, cutoffDate),
    vxnByDate: mapThrough(common.vxnByDate, cutoffDate),
    vixFallbackCount: common.vixFallbackCount,
    vix3mCoverage: {
      yahooRefreshCount: common.vix3mCoverage.yahooRefreshCount,
      cboeSameDayCount: common.vix3mCoverage.cboeSameDayCount,
      fredSameDayCount: common.vix3mCoverage.fredSameDayCount,
      missingDates: common.vix3mCoverage.missingDates.filter(day => day <= cutoffDate),
    },
  };
  validate(snapshot);
  return snapshot;
}

export async function writeBuiltHistory(snapshot: BuiltHistory, path = join(process.cwd(), SNAPSHOT_PATH)): Promise<{ rawBytes: number; gzipBytes: number; sha256: string }> {
  validate(snapshot);
  const raw = JSON.stringify(snapshot);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const compressed = gzipSync(JSON.stringify({ sha256, payload: snapshot } satisfies SnapshotEnvelope), { level: 9 });
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, compressed);
  await rename(temporary, path);
  cached = undefined;
  return { rawBytes: Buffer.byteLength(raw), gzipBytes: compressed.byteLength, sha256 };
}

export async function readBuiltHistory(path = join(process.cwd(), SNAPSHOT_PATH)): Promise<BuiltHistory | null> {
  if (path === join(process.cwd(), SNAPSHOT_PATH) && cached) return cached;
  const read = async () => {
    let compressed: Buffer;
    try { compressed = await readFile(/*turbopackIgnore: true*/ path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const envelope = JSON.parse(gunzipSync(compressed).toString()) as SnapshotEnvelope;
    const actual = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
    if (actual !== envelope.sha256) throw new Error(`Build history checksum mismatch: ${path}`);
    validate(envelope.payload);
    return envelope.payload;
  };
  const pending = read();
  if (path !== join(process.cwd(), SNAPSHOT_PATH)) return pending;
  cached = pending.then(value => {
    if (!value) cached = undefined;
    return value;
  }).catch(error => {
    cached = undefined;
    throw error;
  });
  return cached;
}

export async function loadBuiltHistoryDelta(snapshot: BuiltHistory, universeId: OverlayUniverseId, optionUnderlyingSymbol = 'QQQ', now = new Date(), loader: typeof loadBars = loadBars): Promise<LoadedBars> {
  const universe = getOverlayUniverse(universeId);
  const closedWeekdays = closedWeekdaysSinceBuild(snapshot, now);
  if (closedWeekdays === 0) {
    const empty: OHLCV[] = [];
    return {
      qqqBars: empty, tqqqBars: empty, spyBars: empty, barsBySymbol: { QQQ: empty }, boxxBars: empty,
      vixByDate: {}, vixFallbackCount: 0,
      vix3mByDate: {}, vix3mCoverage: { byDate: {}, yahooRefreshCount: 0, cboeSameDayCount: 0, fredSameDayCount: 0, missingDates: [] },
      vxnByDate: {}, splitEventsBySymbol: { [universe.leveragedSymbol]: createRawFactor([], () => false, 'Yahoo Finance Chart', '尚无构建日后日线', []) },
    };
  }
  const delta = await loader(universe, true, optionUnderlyingSymbol, `since:${snapshot.buildDate}`);
  if (closedWeekdays >= 2 && !delta.qqqBars.some(bar => bar.date >= snapshot.buildDate)) {
    throw new Error(`Build history delta missing since ${snapshot.buildDate}; refused stale backtest`);
  }
  const leveragedDates = new Set(delta.tqqqBars.map(bar => bar.date));
  const spyDates = new Set((delta.spyBars ?? []).map(bar => bar.date));
  const unmatched = delta.qqqBars.find(bar => bar.date >= snapshot.buildDate && (!leveragedDates.has(bar.date) || !spyDates.has(bar.date)));
  if (unmatched) throw new Error(`Build history delta has a market-data gap on ${unmatched.date}`);
  return delta;
}

function mergeBars(base: OHLCV[], delta: OHLCV[], from: string): OHLCV[] {
  return [...base, ...delta.filter(bar => bar.date >= from)].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeMap(base: Record<string, number>, delta: Record<string, number>, from: string): Record<string, number> {
  return { ...base, ...Object.fromEntries(Object.entries(delta).filter(([day]) => day >= from)) };
}

export function mergeBuiltHistory(snapshot: BuiltHistory, delta: LoadedBars, universeId: OverlayUniverseId, optionUnderlyingSymbol = 'QQQ'): LoadedBars {
  if (!snapshot.symbols[optionUnderlyingSymbol]) throw new Error(`Unsupported snapshot underlying: ${optionUnderlyingSymbol}`);
  const universe = getOverlayUniverse(universeId);
  const underlying = mergeBars(snapshot.symbols[optionUnderlyingSymbol], delta.qqqBars, snapshot.buildDate);
  const leveraged = mergeBars(snapshot.symbols[universe.leveragedSymbol], delta.tqqqBars, snapshot.buildDate);
  const spy = mergeBars(snapshot.symbols.SPY, delta.spyBars ?? [], snapshot.buildDate);
  const splitEvents = [...(snapshot.splitEvents[universe.leveragedSymbol] ?? []), ...(delta.splitEventsBySymbol?.[universe.leveragedSymbol]?.value ?? []).filter(event => event.date >= snapshot.buildDate)];
  const vix3mByDate = mergeMap(snapshot.vix3mByDate, delta.vix3mByDate, snapshot.buildDate);
  return {
    qqqBars: underlying,
    tqqqBars: leveraged,
    spyBars: spy,
    barsBySymbol: { QQQ: underlying, ...(optionUnderlyingSymbol !== 'QQQ' ? { [optionUnderlyingSymbol]: underlying } : {}), SPY: spy, [universe.leveragedSymbol]: leveraged },
    boxxBars: mergeBars(snapshot.boxxBars, delta.boxxBars, snapshot.buildDate),
    vixByDate: mergeMap(snapshot.vixByDate, delta.vixByDate, snapshot.buildDate),
    vixFallbackCount: snapshot.vixFallbackCount + delta.vixFallbackCount,
    vix3mByDate,
    vix3mCoverage: {
      byDate: vix3mByDate,
      yahooRefreshCount: snapshot.vix3mCoverage.yahooRefreshCount + delta.vix3mCoverage.yahooRefreshCount,
      cboeSameDayCount: snapshot.vix3mCoverage.cboeSameDayCount + delta.vix3mCoverage.cboeSameDayCount,
      fredSameDayCount: snapshot.vix3mCoverage.fredSameDayCount + delta.vix3mCoverage.fredSameDayCount,
      missingDates: [...snapshot.vix3mCoverage.missingDates, ...delta.vix3mCoverage.missingDates.filter(day => day >= snapshot.buildDate)],
    },
    vxnByDate: mergeMap(snapshot.vxnByDate, delta.vxnByDate, snapshot.buildDate),
    splitEventsBySymbol: { [universe.leveragedSymbol]: createRawFactor(splitEvents, events => events.length > 0, 'Yahoo Finance Chart', `${universe.leveragedSymbol} 拆股事件`, []) },
  };
}
