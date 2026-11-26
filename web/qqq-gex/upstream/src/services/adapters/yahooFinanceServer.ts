import { readSharedQqqOptionChain } from '@/lib/qqqSharedOptionChain';
import YahooFinance from 'yahoo-finance2';
import { FinancialFactor } from '../../types/factor';
import { YahooFinanceResponse } from './yahooFinance';
import { createYahooProxyFetch } from './yahooProxyFetch';

/**
 * Yahoo Finance Server-side Service
 * Uses yahoo-finance2 library directly to fetch data.
 * This service should only be used in server-side environments (API routes, server components).
 */

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds cache for quotes
const HISTORY_CACHE_DURATION = 5 * 60 * 1000;
const INTRADAY_CACHE_DURATION = 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const historicalInFlight = new Map<string, Promise<FinancialFactor<any>>>();
const optionsInFlight = new Map<string, Promise<FinancialFactor<any>>>();
const quotesInFlight = new Map<string, Promise<FinancialFactor<YahooFinanceResponse>>>();

export type YahooMarketState = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';

/** chart() 不返回可靠 marketState 时，用美东时钟恢复展示状态；不参与交易日或下单判定。 */
export function marketStateAt(now: Date): YahooMarketState {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', hourCycle: 'h23', minute: '2-digit', timeZone: 'America/New_York', weekday: 'short',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  if (value('weekday') === 'Sat' || value('weekday') === 'Sun') return 'CLOSED';
  const minutes = Number(value('hour')) * 60 + Number(value('minute'));
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'PRE';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'REGULAR';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'POST';
  return 'CLOSED';
}

async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500,
  onError?: (err: any, attempt: number) => void
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (onError) onError(error, attempt);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getQuoteVolume(q: any): number {
  return toFiniteNumber(q?.regularMarketVolume ?? q?.volume);
}

function getQuoteAverageVolume(q: any): number {
  return toFiniteNumber(q?.averageDailyVolume3Month ?? q?.averageDailyVolume10Day ?? q?.averageDailyVolume);
}

function getQuoteChangePercent(q: any): number {
  return toFiniteNumber(q?.regularMarketChangePercent);
}

function getCached<T>(key: string, ttl = CACHE_DURATION): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any) {
  for (const [existingKey, entry] of cache) {
    if (Date.now() - entry.timestamp >= HISTORY_CACHE_DURATION) cache.delete(existingKey);
  }
  cache.delete(key);
  cache.set(key, { data, timestamp: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

export class YahooFinanceServer {
  private static instance: YahooFinanceServer;
  private yahooFinance: any;

  private constructor() {
    // Lazy initialization of YahooFinance
    if (typeof window === 'undefined') {
      this.initYahooFinance();
    }
  }

  public static getInstance(): YahooFinanceServer {
    if (!YahooFinanceServer.instance) {
      YahooFinanceServer.instance = new YahooFinanceServer();
    }
    return YahooFinanceServer.instance;
  }

  private initYahooFinance() {
    if (!this.yahooFinance && typeof window === 'undefined') {
      try {
        // Correct way to initialize in newer yahoo-finance2 versions
        const proxyFetch = createYahooProxyFetch();
        this.yahooFinance = new (YahooFinance as any)(proxyFetch ? { fetch: proxyFetch } : {});
      } catch (e) {
        console.error('Failed to initialize YahooFinance on server:', e);
      }
    }
  }

  /**
   * Get current quote(s) for one or multiple symbols
   */
  async getQuote(symbol: string): Promise<FinancialFactor<YahooFinanceResponse>>;
  async getQuote(symbols: string[]): Promise<Record<string, FinancialFactor<YahooFinanceResponse>>>;
  async getQuote(symbolOrSymbols: string | string[]): Promise<any> {
    this.initYahooFinance();
    const isArray = Array.isArray(symbolOrSymbols);
    const symbols = isArray ? (symbolOrSymbols as string[]).map(s => s.toUpperCase()) : [(symbolOrSymbols as string).toUpperCase()];

    const results: Record<string, FinancialFactor<YahooFinanceResponse>> = {};
    const symbolsToFetch: string[] = [];

    // Check cache first
    for (const symbol of symbols) {
      const cacheKey = `quote_${symbol}`;
      const cached = getCached<FinancialFactor<YahooFinanceResponse>>(cacheKey);
      if (cached) {
        results[symbol] = cached;
      } else {
        symbolsToFetch.push(symbol);
      }
    }

    if (symbolsToFetch.length > 0) {
      // Use chart() instead of quote() — chart() works without Yahoo's crumb cookie
      // Fetch symbols in parallel; one failure won't block the rest
      const period1 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await Promise.allSettled(
        [...new Set(symbolsToFetch)].map(async (sym) => {
          const pending = quotesInFlight.get(sym);
          if (pending) { results[sym] = await pending; return; }
          const request = (async () => {
          try {
            const chartResult = await retry<any>(
              () => this.yahooFinance.chart(sym, {
                period1,
                period2: new Date(),
                interval: '1d',
              }),
              3,
              500,
              (err, attempt) => console.warn(`[YahooFinanceServer.getQuote] Attempt ${attempt} failed for ${sym}: ${err.message || err}`)
            );

            const bars: any[] = (chartResult?.quotes ?? []).filter((bar: any) => typeof bar.close === 'number' && Number.isFinite(bar.close) && bar.close > 0);
            if (bars.length === 0) throw new Error('No chart data returned');

            const latest      = bars[bars.length - 1];
            const prev        = bars.length > 1 ? bars[bars.length - 2] : null;
            const price       = latest.close ?? 0;
            const prevClose   = prev?.close ?? 0;
            const change      = prevClose > 0 ? price - prevClose : 0;
            const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

            const factor: FinancialFactor<YahooFinanceResponse> = {
              value: {
                price,
                change,
                changePercent,
                previousClose: prevClose,
                marketState: marketStateAt(new Date()),
                meta: { ...latest, symbol: sym },
              },
              confidence: price > 0 ? 10 : 0,
              source: { type: 'raw', api: 'Yahoo Finance Chart' },
            };

            setCache(`quote_${sym}`, factor);
            return factor;
          } catch (error) {
            console.error(`YahooFinanceServer.getQuote error for ${sym}:`, error);
            return this.getFallbackQuote(sym, String(error));
          }
          })();
          quotesInFlight.set(sym, request);
          try { results[sym] = await request; }
          finally { if (quotesInFlight.get(sym) === request) quotesInFlight.delete(sym); }
        })
      );

      // Fill any gaps not covered by settled promises
      for (const sym of symbolsToFetch) {
        if (!results[sym]) {
          results[sym] = this.getFallbackQuote(sym, 'No data');
        }
      }
    }

    return isArray ? results : results[symbols[0]];
  }

  async getQuotes(symbols: string[]): Promise<Record<string, FinancialFactor<YahooFinanceResponse>>> {
    return this.getQuote(symbols);
  }

  /** Current ETF sector split only; Yahoo does not provide a historical weight series here. */
  async getFundSectorWeights(symbol: string): Promise<FinancialFactor<Record<string, number>>> {
    this.initYahooFinance();
    const normalized = symbol.toUpperCase();
    const cacheKey = `fund_sector_weights_${normalized}`;
    const cached = getCached<FinancialFactor<Record<string, number>>>(cacheKey, HISTORY_CACHE_DURATION);
    if (cached) return cached;

    try {
      const summary = await this.yahooFinance.quoteSummary(normalized, { modules: ['topHoldings'] });
      const weights = Object.assign({}, ...(summary?.topHoldings?.sectorWeightings ?? [])) as Record<string, unknown>;
      const value = Object.fromEntries(Object.entries(weights).filter(([, weight]) => Number.isFinite(weight)).map(([key, weight]) => [key, Number(weight)]));
      if (Object.keys(value).length === 0) throw new Error('No sector weights returned');

      const factor: FinancialFactor<Record<string, number>> = {
        value,
        confidence: 10,
        source: { type: 'raw', api: 'Yahoo Finance QuoteSummary topHoldings' },
      };
      setCache(cacheKey, factor);
      return factor;
    } catch (error) {
      return {
        value: {},
        confidence: 0,
        source: { type: 'fallback', reason: `Yahoo Finance sector weights unavailable: ${String(error)}` },
      };
    }
  }

  /**
   * Get symbols from a predefined Yahoo Finance screener with metadata
   */
  async getScreenerSymbols(scrId: string, count: number = 25): Promise<any[]> {
    this.initYahooFinance();
    const cacheKey = `screener_meta_${scrId}_${count}`;
    const cached = getCached<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.yahooFinance.screener({
        scrIds: scrId,
        count: count
      }, { validateResult: false });

      if (!result || !result.quotes) return [];

      const symbols = result.quotes
        .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.longName || q.shortName || q.symbol,
          industry: q.sector || q.industry || q.quoteType,
          price: toFiniteNumber(q.regularMarketPrice),
          changePercent: getQuoteChangePercent(q),
          volume: getQuoteVolume(q),
          avgVolume: getQuoteAverageVolume(q),
          marketCap: toFiniteNumber(q.marketCap),
        }));

      setCache(cacheKey, symbols);
      return symbols;
    } catch (error) {
      console.error(`YahooFinanceServer.getScreenerSymbols error for ${scrId}:`, error);
      return [];
    }
  }

  /**
   * Batch fetch lightweight metadata for a list of symbols
   */
  async getMetadataBatch(symbols: string[]): Promise<Record<string, { name: string, industry: string }>> {
    this.initYahooFinance();
    const results: Record<string, { name: string, industry: string }> = {};
    
    // Split into chunks of 50 to avoid URL length limits
    for (let i = 0; i < symbols.length; i += 50) {
      const chunk = symbols.slice(i, i + 50);
      try {
        const quotes = await this.yahooFinance.quote(chunk, { 
          fields: ['longName', 'shortName', 'quoteType'] 
        });
        const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
        
        quotesArray.forEach((q: any) => {
          if (q && q.symbol) {
            results[q.symbol] = {
              name: q.longName || q.shortName || q.symbol,
              industry: q.quoteType || 'Equity'
            };
          }
        });
      } catch (e) {
        console.error('Batch metadata fetch failed:', e);
      }
    }
    return results;
  }

  /**
   * Market Scan: Advanced filtering for high liquidity and activity
   * Returns symbols with lightweight metadata (name, industry)
   */
  async getMarketScanSymbols(count: number = 25): Promise<any[]> {
    this.initYahooFinance();
    const cacheKey = `market_scan_meta_${count}`;
    const cached = getCached<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.yahooFinance.screener({
        scrIds: 'most_actives',
        count: 200
      }, { validateResult: false });

      if (!result || !result.quotes) return [];

      const baseQuotes = result.quotes
        .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
        .slice(0, 100);

      const quoteDetails = await this.getQuotes(baseQuotes.map((q: any) => q.symbol));

      const filtered = baseQuotes
        .map((q: any) => {
          const detail = quoteDetails[q.symbol]?.value?.meta || {};
          const merged = { ...q, ...detail };
          const volume = getQuoteVolume(merged);
          const avgVolume = getQuoteAverageVolume(merged);
          const marketCap = toFiniteNumber(merged.marketCap);
          const changePercent = getQuoteChangePercent(merged);
          const volumeSpikeRatio = avgVolume > 0 ? volume / avgVolume : 0;
          const hasMarketCap = marketCap > 0;
          const passesMarketCap = merged.quoteType === 'ETF' || !hasMarketCap || marketCap > 2_000_000_000;
          const isLiquid = volume > 1_000_000 && passesMarketCap;
          const hasActivitySignal = Math.abs(changePercent) > 2 || volumeSpikeRatio > 1.5 || (avgVolume === 0 && volume > 5_000_000);

          return {
            ...merged,
            volume,
            avgVolume,
            marketCap,
            changePercent,
            volumeSpikeRatio,
            isLiquid,
            hasActivitySignal,
          };
        })
        .filter((q: any) => q.isLiquid && q.hasActivitySignal)
        .sort((a: any, b: any) => {
          const scoreA = Math.abs(a.changePercent) * 1_000_000 + a.volumeSpikeRatio * 500_000 + a.volume;
          const scoreB = Math.abs(b.changePercent) * 1_000_000 + b.volumeSpikeRatio * 500_000 + b.volume;
          return scoreB - scoreA;
        })
        .slice(0, count)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.longName || q.shortName || q.symbol,
          industry: q.sector || q.industry || q.quoteType, // Use sector as primary for stocks
          marketCap: q.marketCap,
          volume: q.volume,
          avgVolume: q.avgVolume,
          changePercent: q.changePercent,
          scanReason: Math.abs(q.changePercent) > 2 ? 'PRICE_MOVE' : 'VOLUME_SPIKE',
        }));

      setCache(cacheKey, filtered);
      return filtered;
    } catch (error) {
      console.error(`YahooFinanceServer.getMarketScanSymbols error:`, error);
      return [];
    }
  }

  private getFallbackQuote(symbol: string, reason: string): FinancialFactor<YahooFinanceResponse> {
    return {
      value: {
        price: 0,
        change: 0,
        changePercent: 0,
        previousClose: 0,
        meta: null
      },
      confidence: 0,
      source: { type: 'fallback', reason: `Yahoo Finance API call failed: ${reason}` },
      
    };
  }

  /**
   * Get historical data for a symbol
   */
  async getHistorical(symbol: string, range: string = '1y', interval: string = '1d', timeoutMs: number = 30000, forceRefresh = false, includePrePost = false): Promise<FinancialFactor<any>> {
    let finalRange = range;
    let clamped = false;
    const isMinuteInterval = ['1m', '2m', '5m', '15m', '30m', '60m', '90m'].includes(interval);

    if (isMinuteInterval) {
      const days = this.getDaysForRange(range);
      if (interval === '1m' && days > 7) {
        finalRange = '7d';
        clamped = true;
      } else if (interval !== '1m' && days > 60) {
        finalRange = '60d';
        clamped = true;
      }
    }

    const cacheKey = `history_${symbol.toUpperCase()}_${range}_${interval}_${includePrePost ? 'extended' : 'regular'}`;
    if (!forceRefresh) {
      const cached = getCached<FinancialFactor<any>>(cacheKey, isMinuteInterval ? INTRADAY_CACHE_DURATION : HISTORY_CACHE_DURATION);
      if (cached) return cached;
    }

    const pending = historicalInFlight.get(cacheKey);
    if (pending) return pending;

    const request = this.fetchHistorical(symbol, range, interval, timeoutMs, finalRange, clamped, cacheKey, includePrePost);
    historicalInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      historicalInFlight.delete(cacheKey);
    }
  }

  private async fetchHistorical(symbol: string, range: string, interval: string, timeoutMs: number, finalRange: string, clamped: boolean, cacheKey: string, includePrePost: boolean): Promise<FinancialFactor<any>> {

    try {
      this.initYahooFinance();
      const period1 = this.getStartDateForRange(finalRange);
      const supportsHistoricalFallback = ['1d', '1wk', '1mo'].includes(interval);
      
      let historicalData: any[] = [];
      let chartMeta: any = null;
      let chartEvents: any = null;
      let historicalFetchError: unknown;
      try {
        historicalData = await retry(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            // Use chart API which is often more lenient than historical API
            // and provides the raw data we need.
            const chartResult = await this.yahooFinance.chart(symbol, {
              period1,
              period2: new Date(),
              interval,
              includePrePost,
              events: 'split',
            }, { fetchOptions: { signal: controller.signal } });

            if (chartResult && chartResult.quotes) {
              chartMeta = chartResult.meta;
              chartEvents = chartResult.events;
              return chartResult.quotes;
            }
            throw new Error('No chart quotes returned');
          } catch (e: any) {
            // yahoo-finance2's historical() only accepts daily, weekly, and
            // monthly intervals. For intraday requests, preserve the chart
            // failure so retry/error reporting reflects the actual cause.
            if (!supportsHistoricalFallback) throw e;

            // Fallback: if chart throws, try historical but with even more aggressive error catching
            const fallbackController = new AbortController();
            const fallbackTimer = setTimeout(() => fallbackController.abort(), timeoutMs);
            try {
              const hist = await this.yahooFinance.historical(symbol, {
                period1,
                period2: new Date(),
                interval
              }, { fetchOptions: { signal: fallbackController.signal } });
              if (hist) return hist;
              throw new Error('No historical data returned');
            } catch (hError: any) {
              if (hError.result && Array.isArray(hError.result)) {
                return hError.result;
              }
              throw hError;
            } finally {
              clearTimeout(fallbackTimer);
            }
          } finally {
            clearTimeout(timer);
          }
        }, 3, 500, (err, attempt) => {
          console.warn(`[YahooFinanceServer.getHistorical] Attempt ${attempt} failed for ${symbol}: ${err.message || err}`);
        });
      } catch (finalError: any) {
        historicalFetchError = finalError;
        console.warn(`Both chart and historical failed for ${symbol} after retries:`, finalError.message);
      }

      if (!historicalData || !Array.isArray(historicalData) || historicalData.length === 0) {
        if (historicalFetchError instanceof Error) throw historicalFetchError;
        throw new Error(`No historical data found for ${symbol}`);
      }

      // Filter out any entries with missing data - CRITICAL fix for "SOME null values" error
      // In chart API, field names are the same (close, high, low, open, volume)
      const historical = historicalData.filter(h => 
        h &&
        h.close !== null && h.close !== undefined &&
        h.high !== null && h.high !== undefined &&
        h.low !== null && h.low !== undefined &&
        h.open !== null && h.open !== undefined
      );

      const transformedValue = {
        chart: {
          result: [{
            meta: chartMeta ? {
              ...chartMeta,
              ...(clamped ? { clamped: true, originalRange: range, originalInterval: interval } : {})
            } : (clamped ? { clamped: true, originalRange: range, originalInterval: interval } : null),
            timestamp: historical.map(h => {
              const d = h.date;
              return d instanceof Date
                ? Math.floor(d.getTime() / 1000)
                : Math.floor(new Date(d).getTime() / 1000);
            }),
            indicators: {
              quote: [{
                close: historical.map(h => h.close),
                high: historical.map(h => h.high),
                low: historical.map(h => h.low),
                open: historical.map(h => h.open),
                volume: historical.map(h => h.volume)
              }]
            },
            events: chartEvents,
          }]
        }
      };

      const quality = historical.length > 0 ? 'real' : 'estimated';
      const result: FinancialFactor<any> = {
        value: transformedValue,
        confidence: historical.length > 0 ? 10 : 0,
        source: { type: 'raw', api: 'Yahoo Finance Chart' },
        
      };

      setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`YahooFinanceServer.getHistorical error for ${symbol}:`, error);
      return {
        value: null,
        confidence: 0,
        source: { type: 'fallback', reason: `Yahoo Finance API call failed: ${error instanceof Error ? error.message : String(error)}` },
        
      };
    }
  }

  /**
   * Get option chains for a symbol
   */
  async getOptions(symbol: string, expiration?: number, timeoutMs: number = 30000, attempts = 3): Promise<FinancialFactor<any>> {
    if (symbol.toUpperCase() === 'QQQ') return readSharedQqqOptionChain(expiration ?? 0);
    const cacheKey = `options_${symbol.toUpperCase()}_${expiration || 'default'}`;
    const cached = getCached<FinancialFactor<any>>(cacheKey);
    if (cached) return cached;

    // Keep short page deadlines separate from collector/research retry budgets.
    const requestKey = `${cacheKey}:${timeoutMs}:${attempts}`;
    const pending = optionsInFlight.get(requestKey);
    if (pending) return pending;
    const load = this.fetchOptions(symbol, expiration, timeoutMs, attempts, cacheKey);
    optionsInFlight.set(requestKey, load);
    try { return await load; }
    finally { if (optionsInFlight.get(requestKey) === load) optionsInFlight.delete(requestKey); }
  }

  private async fetchOptions(symbol: string, expiration: number | undefined, timeoutMs: number, attempts: number, cacheKey: string): Promise<FinancialFactor<any>> {

    try {
      this.initYahooFinance();
      const options = await retry<any>(
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await this.yahooFinance.options(
              symbol,
              expiration ? { date: new Date(expiration * 1000) } : undefined,
              { fetchOptions: { signal: controller.signal } }
            );
          } finally {
            clearTimeout(timer);
          }
        },
        attempts,
        500,
        (err, attempt) => console.warn(`[YahooFinanceServer.getOptions] Attempt ${attempt} failed for ${symbol} (exp: ${expiration}): ${err.message || err}`)
      );
      
      // Emulate the v7 options API structure if needed.
      // fetchOptionChainsCore returns: data.optionChain.result[0]...
      
      const transformedValue = {
        optionChain: {
          result: [{
            ...options,
            receivedAt: new Date().toISOString(),
            expirationDates: options.expirationDates?.map((d: any) => 
              d instanceof Date ? Math.floor(d.getTime() / 1000) : d
            )
          }]
        }
      };

      const result: FinancialFactor<any> = {
        value: transformedValue,
        confidence: 10,
        source: { type: 'raw', api: 'Yahoo Finance Direct' },
      };

      setCache(cacheKey, result);
      // The discovery response already contains its first expiry's chain.
      // Reuse that exact response instead of downloading that expiry again.
      if (expiration === undefined) {
        const returnedExpiry = options.options?.[0]?.expirationDate;
        const seconds = returnedExpiry instanceof Date ? returnedExpiry.getTime() / 1000 : Number(returnedExpiry);
        if (Number.isSafeInteger(seconds) && seconds > 0) setCache(`options_${symbol.toUpperCase()}_${seconds}`, result);
      }
      return result;
    } catch (error) {
      console.error(`YahooFinanceServer.getOptions error for ${symbol}:`, error);
      return {
        value: null,
        confidence: 0,
        source: { type: 'fallback', reason: `Yahoo Finance API call failed: ${error instanceof Error ? error.message : String(error)}` },
        
      };
    }
  }

  private getDaysForRange(range: string): number {
    const now = new Date();
    const explicitDays = range.match(/^(\d+)d$/)?.[1];
    const map: Record<string, number> = {
      '1d': 1,
      '5d': 5,
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1y': 365,
      '2y': 720,
      '3y': 1095,
      '5y': 1825,
      '10y': 3650,
      'ytd': now.getDate() + (now.getMonth() * 30), // Approximate
      'max': 20000
    };

    return explicitDays ? Number(explicitDays) : map[range] || 365;
  }

  private getStartDateForRange(range: string): Date {
    const since = /^since:(\d{4}-\d{2}-\d{2})$/.exec(range);
    if (since) {
      const date = new Date(`${since[1]}T00:00:00Z`);
      if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === since[1]) return date;
      throw new Error(`Invalid historical start date: ${range}`);
    }
    const days = this.getDaysForRange(range);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
}

export const yahooFinanceServer = YahooFinanceServer.getInstance();
