import { calcRealizedVol } from '../leveraged-overlay/utils';
import { runMarketRegime } from '../leveraged-overlay/engines/03-market-regime';

export type QqqDailyMarketBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type QqqDailyMarketRegime = {
  regime?: string;
  price_extension_atr?: number;
};

export type QqqDailyMarketBase = {
  qqqRoc5: number | null;
  annualizedRv20: number;
  sma50: number | null;
  sma200: number | null;
  overlayRegime: QqqDailyMarketRegime | null;
};

type BaseInput = {
  qqqBars: readonly QqqDailyMarketBar[];
  vix: number | null;
  vix3m: number | null;
  previousVix: number | null;
};

type CachedBase = { expiresAt: number; value: QqqDailyMarketBase };
const BASE_TTL_MS = 5_000;
const BASE_CACHE_LIMIT = 16;
const baseCache = new Map<string, CachedBase>();

function finiteOrNull(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function calculateQqqRateOfChange(bars: readonly Pick<QqqDailyMarketBar, 'close'>[], period: number): number | null {
  if (bars.length <= period) return null;
  const current = bars.at(-1)?.close;
  const previous = bars.at(-period - 1)?.close;
  return current && previous && previous > 0 ? current / previous - 1 : null;
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function simpleMovingAverage(bars: readonly Pick<QqqDailyMarketBar, 'close'>[], period: number): number | null {
  if (bars.length < period) return null;
  return mean(bars.slice(-period).map((bar) => bar.close));
}

function cacheKey(input: BaseInput) {
  const last = input.qqqBars.at(-1);
  const previous = input.qqqBars.at(-2);
  return [
    input.qqqBars.length,
    last?.date ?? 'none',
    last?.close ?? 'none',
    previous?.close ?? 'none',
    finiteOrNull(input.vix) ?? 'none',
    finiteOrNull(input.vix3m) ?? 'none',
    finiteOrNull(input.previousVix) ?? 'none',
  ].join(':');
}

function buildOverlayRegime(input: BaseInput): QqqDailyMarketRegime | null {
  const vix = finiteOrNull(input.vix);
  const vix3m = finiteOrNull(input.vix3m);
  const previousVix = finiteOrNull(input.previousVix);
  if (input.qqqBars.length < 200 || vix === null || vix3m === null || previousVix === null) return null;
  const result = runMarketRegime({
    input: { prices: { QQQ: input.qqqBars, TQQQ: [], BOXX: [] }, macro: { vix, vix3m, prevVix: previousVix } },
  } as never).data;
  return { regime: result.regime, price_extension_atr: result.price_extension_atr };
}

/**
 * Shared daily market inputs for the QQQ PCS/CS page.
 * Strategy admission and candidate selection deliberately stay outside this seam.
 */
export function buildQqqDailyMarketBase(input: BaseInput): QqqDailyMarketBase {
  const key = cacheKey(input);
  const cached = baseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value: QqqDailyMarketBase = {
    qqqRoc5: calculateQqqRateOfChange(input.qqqBars, 5),
    annualizedRv20: calcRealizedVol(input.qqqBars.map((bar) => bar.close), 20),
    sma50: simpleMovingAverage(input.qqqBars, 50),
    sma200: simpleMovingAverage(input.qqqBars, 200),
    overlayRegime: buildOverlayRegime(input),
  };
  baseCache.set(key, { expiresAt: Date.now() + BASE_TTL_MS, value });
  while (baseCache.size > BASE_CACHE_LIMIT) baseCache.delete(baseCache.keys().next().value!);
  return value;
}

export function clearQqqDailyMarketBaseCache() {
  baseCache.clear();
}
