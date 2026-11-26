import { FinancialFactor, FactorMap } from '../../types/factor';
import { createDerivedFactor } from '../../lib/factor';
import { computeIndicators, OHLCVBar } from '../../lib/indicators';
import { calculateSMA as calcSMADirect } from '../../lib/indicators/indicators/trend';
import { calculateRSI as calcRSIDirect } from '../../lib/indicators/indicators/momentum';
import { calculateHV as calcHVDirect } from '../../lib/indicators/indicators/volatility';
import { IVPoint, IVCurveValue, IVCurveOptions, OptionContract } from '../../types/ivCurve';
import { blackScholesEngine } from '../../lib/engines';
import { yahooProxyHeaders, yahooProxyUrl } from './yahooProxyFetch';

// Yahoo Finance 核心服务逻辑

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data as T;
  }
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

const YAHOO_FINANCE_BASE_URL = (process.env.YAHOO_FINANCE_BASE_URL?.trim() || 'https://query1.finance.yahoo.com').replace(/\/+$/, '');

export interface YahooFinanceResponse {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  marketState?: string;
  meta: any;
}

/**
 * 核心方法：直接请求 Yahoo Finance API (仅限服务端使用)
 */
export async function fetchYahooFinanceDataCore(symbol: string): Promise<FinancialFactor<YahooFinanceResponse> | null> {
  const { yahooFinanceServer } = await import('./yahooFinanceServer');
  return yahooFinanceServer.getQuote(symbol);
}

/**
 * 历史数据核心方法
 */
export async function fetchHistoricalDataCore(symbol: string, range: string = '1y', forceRefresh = false): Promise<FinancialFactor<any> | null> {
  const { yahooFinanceServer } = await import('./yahooFinanceServer');
  return yahooFinanceServer.getHistorical(symbol, range, '1d', 30_000, forceRefresh);
}

export async function fetchYahooFinanceData(symbol: string): Promise<FinancialFactor<YahooFinanceResponse> | null> {
  if (typeof window === 'undefined') return fetchYahooFinanceDataCore(symbol);
  try {
    const response = await fetch(`/api/proxy/yahoo?symbol=${symbol.toUpperCase()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${response.status}`);
    }
    return await response.json();
  } catch (error) { throw error; }
}

export async function fetchHistoricalData(symbol: string, range: string = '1y'): Promise<FinancialFactor<any> | null> {
  if (typeof window === 'undefined') return fetchHistoricalDataCore(symbol, range);
  try {
    const response = await fetch(`/api/proxy/yahoo/history?symbol=${symbol.toUpperCase()}&range=${range}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${response.status}`);
    }
    return await response.json();
  } catch (error) { throw error; }
}

/**
 * 技术指标计算
 * @deprecated 请使用 computeIndicators()。此处保留仅为兼容旧代码，内部已重定向至新库。
 */
export function calculateSMA(pricesFactor: FinancialFactor<number[]>, period: number): FinancialFactor<number> {
  const prices = pricesFactor.value;
  if (!prices || prices.length < period) {
    return { value: 0, confidence: 0, source: { type: 'fallback', reason: 'Insufficient price data' } };
  }

  const times = prices.map((_, i) => i);
  const series = calcSMADirect(prices, times, period);
  const val = series[series.length - 1]?.value ?? 0;

  const factors: FactorMap = { 'base_prices': pricesFactor };
  return createDerivedFactor(val, [{ factorId: 'base_prices', weight: 1.0 }], factors);
}

/** @deprecated 请使用 computeIndicators() */
export function calculateRSI(pricesFactor: FinancialFactor<number[]>, period: number = 14): FinancialFactor<number> {
  const prices = pricesFactor.value;
  if (!prices || prices.length < period + 1) {
    return { value: 50, confidence: 0, source: { type: 'fallback', reason: 'Insufficient price data' } };
  }

  const times = prices.map((_, i) => i);
  const series = calcRSIDirect(prices, times, period);
  const val = series[series.length - 1]?.value ?? 50;

  const factors: FactorMap = { 'base_prices': pricesFactor };
  return createDerivedFactor(val, [{ factorId: 'base_prices', weight: 1.0 }], factors);
}

/** @deprecated 请使用 computeIndicators() */
export function calculateHV(pricesFactor: FinancialFactor<number[]>, period: number = 20): FinancialFactor<number> {
  const prices = pricesFactor.value;
  if (!prices || prices.length < period + 1) {
    return { value: 0, confidence: 0, source: { type: 'fallback', reason: 'Insufficient price data' } };
  }

  const times = prices.map((_, i) => i);
  const series = calcHVDirect(prices, times, period);
  const val = series[series.length - 1]?.value ?? 0;

  const factors: FactorMap = { 'base_prices': pricesFactor };
  return createDerivedFactor(val, [{ factorId: 'base_prices', weight: 1.0 }], factors);
}

/** @deprecated 请使用 computeIndicators() */
function calculateIVRank(currentIVFactor: FinancialFactor<number>, pricesFactor: FinancialFactor<number[]>): FinancialFactor<number> {
  const currentIV = currentIVFactor.value;
  const prices = pricesFactor.value;
  
  const bars: OHLCVBar[] = prices.map((p, i) => ({
    time: i, open: p, high: p, low: p, close: p, volume: 0
  }));
  const result = computeIndicators(bars, [{ time: prices.length - 1, iv: currentIV }]);
  const val = result.iv_rank[result.iv_rank.length - 1]?.value ?? 50;
  
  const factors: FactorMap = { 
    'current_iv': currentIVFactor,
    'base_prices': pricesFactor 
  };
  return createDerivedFactor(
    Math.round(val), 
    [
      { factorId: 'current_iv', weight: 0.5 },
      { factorId: 'base_prices', weight: 0.5 }
    ], 
    factors
  );
}

/**
 * 期权相关
 */
export async function fetchOptionChainsCore(symbol: string): Promise<FinancialFactor<any> | null> {
  const { yahooFinanceServer } = await import('./yahooFinanceServer');
  return yahooFinanceServer.getOptions(symbol);
}
export async function fetchOptionChains(symbol: string): Promise<FinancialFactor<any> | null> {
  if (typeof window === 'undefined') return fetchOptionChainsCore(symbol);
  try {
    const response = await fetch(`/api/proxy/yahoo/options?symbol=${symbol.toUpperCase()}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${response.status}`);
    }
    return await response.json();
  } catch (error) { 
    console.error(`Error in fetchOptionChains for ${symbol}:`, error);
    throw error; 
  }
}

export async function fetchOptionChainForExpirationCore(symbol: string, expiration: number): Promise<FinancialFactor<any> | null> {
  const { yahooFinanceServer } = await import('./yahooFinanceServer');
  return yahooFinanceServer.getOptions(symbol, expiration);
}

export async function fetchOptionChainForExpiration(symbol: string, expiration: number): Promise<FinancialFactor<any> | null> {
  if (typeof window === 'undefined') return fetchOptionChainForExpirationCore(symbol, expiration);
  try {
    const response = await fetch(`/api/proxy/yahoo/options?symbol=${symbol.toUpperCase()}&date=${expiration}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${response.status}`);
    }
    return await response.json();
  } catch (error) { 
    console.error(`Error in fetchOptionChainForExpiration for ${symbol}:`, error);
    throw error; 
  }
}

/**
 * 获取特定行权价、到期日、类型的期权 IV
 */
export async function getSpecificOptionIV(symbol: string, expiry: string, strike: number, type: 'call' | 'put'): Promise<FinancialFactor<number> | null> {
  try {
    const dataFactor = await fetchOptionChains(symbol);
    const data = dataFactor?.value;
    const expirations = data?.optionChain?.result?.[0]?.expirationDates || [];
    if (expirations.length === 0) return null;

    const targetDate = new Date(expiry);
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);

    const closestExp = expirations.reduce((prev: number, curr: number) => {
      return (Math.abs(curr - targetTimestamp) < Math.abs(prev - targetTimestamp) ? curr : prev);
    });

    if (Math.abs(closestExp - targetTimestamp) > 86400 * 2) return null;

    const detailFactor = await fetchOptionChainForExpiration(symbol, closestExp);
    const detail = detailFactor?.value;
    const opt = detail?.optionChain?.result?.[0]?.options?.[0];
    if (!opt) return null;

    const contracts = type === 'call' ? opt.calls : opt.puts;
    const contract = contracts?.find((c: any) => Math.abs(c.strike - strike) < 0.01);
    
    if (contract) {
      return {
        value: contract.impliedVolatility,
        confidence: detailFactor?.confidence ?? 0,
        source: detailFactor?.source || { type: 'fallback', reason: '缺失期权链原始来源' }
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function fetchEarningsDate(symbol: string): Promise<FinancialFactor<string> | null> {
  try {
    const url = yahooProxyUrl(`${YAHOO_FINANCE_BASE_URL}/v10/finance/quoteSummary/${symbol.toUpperCase()}?modules=calendarEvents`);
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...yahooProxyHeaders(url) } });
    const data = await response.json();
    const date = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0];
    if (date) {
      return {
        value: new Date(date * 1000).toISOString().split('T')[0],
        confidence: 10,
        source: { type: 'raw', api: 'Yahoo Finance API' },
      };
    }
    return null;
  } catch (error) { return null; }
}

const MIN_VALID_OPTION_IV = 0.01;
const MIN_UNQUOTED_OPTION_IV = 0.03;
const MAX_VALID_OPTION_IV = 5;
const MAX_LAST_TRADE_AGE_SECONDS = 4 * 86400;
const MAX_LAST_TRADE_FUTURE_SKEW_SECONDS = 5 * 60;
const OPTION_PRICING_RATE = 0.04;

function impliedVolatilityFromPrice(
  optionPrice: number,
  currentPrice: number,
  strike: number,
  daysToExpiration: number,
  type: 'call' | 'put',
): number {
  if (
    !Number.isFinite(optionPrice) || optionPrice <= 0 ||
    !Number.isFinite(currentPrice) || currentPrice <= 0 ||
    !Number.isFinite(strike) || strike <= 0 ||
    !Number.isFinite(daysToExpiration) || daysToExpiration <= 0
  ) return 0;

  const T = daysToExpiration / 365;
  const discountedStrike = strike * Math.exp(-OPTION_PRICING_RATE * T);
  const lowerBound = type === 'call'
    ? Math.max(0, currentPrice - discountedStrike)
    : Math.max(0, discountedStrike - currentPrice);
  const upperBound = type === 'call' ? currentPrice : discountedStrike;
  if (optionPrice < lowerBound || optionPrice >= upperBound) return 0;

  let low = MIN_VALID_OPTION_IV;
  let high = MAX_VALID_OPTION_IV;
  const priceAtLow = blackScholesEngine.price({
    S: currentPrice, K: strike, T, r: OPTION_PRICING_RATE, sigma: low, type,
  }).price;
  const priceAtHigh = blackScholesEngine.price({
    S: currentPrice, K: strike, T, r: OPTION_PRICING_RATE, sigma: high, type,
  }).price;
  if (optionPrice < priceAtLow || optionPrice > priceAtHigh) return 0;

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const modelPrice = blackScholesEngine.price({
      S: currentPrice, K: strike, T, r: OPTION_PRICING_RATE, sigma: mid, type,
    }).price;
    if (modelPrice < optionPrice) low = mid;
    else high = mid;
  }
  const iv = (low + high) / 2;
  return iv >= MIN_VALID_OPTION_IV && iv <= MAX_VALID_OPTION_IV ? iv : 0;
}

function findATMOptionIV(
  contracts: any[],
  currentPrice: number,
  daysToExpiration?: number,
  type: 'call' | 'put' = 'call',
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): number {
  if (!contracts || contracts.length === 0) return 0;

  const interpolateYahooIV = (candidates: any[]) => {
    const sorted = [...candidates].sort((a, b) => a.strike - b.strike);
    let lower = sorted[0];
    let upper = sorted[sorted.length - 1];
    if (currentPrice <= lower.strike) return lower.impliedVolatility || 0;
    if (currentPrice >= upper.strike) return upper.impliedVolatility || 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].strike <= currentPrice && sorted[i + 1].strike >= currentPrice) {
        lower = sorted[i]; upper = sorted[i + 1]; break;
      }
    }
    const strikeDiff = upper.strike - lower.strike;
    if (strikeDiff === 0) return lower.impliedVolatility || 0;
    const weight = (currentPrice - lower.strike) / strikeDiff;
    return (lower.impliedVolatility || 0) * (1 - weight) + (upper.impliedVolatility || 0) * weight;
  };

  // Yahoo 的预计算 IV 只有在同一合约仍有有效盘口时才是主路径。
  // 闭市链常见 bid/ask/OI=0 且邻近 strike IV=1%~2%，不能让它抢在最后成交价反解之前。
  const quotedIvContracts = contracts.filter(c =>
    c.strike > 0 &&
    Number.isFinite(c.impliedVolatility) &&
    c.impliedVolatility >= MIN_VALID_OPTION_IV &&
    c.impliedVolatility <= MAX_VALID_OPTION_IV &&
    Number.isFinite(c.bid) && c.bid > 0 &&
    Number.isFinite(c.ask) && c.ask >= c.bid
  );
  if (quotedIvContracts.length > 0) return interpolateYahooIV(quotedIvContracts);

  // Fallback 1：有效盘口中间价，使用 Black-Scholes 二分反解。
  if (!daysToExpiration || daysToExpiration <= 0 || currentPrice <= 0) return 0;
  const liquidContracts = contracts.filter(c =>
    c.strike > 0 &&
    Number.isFinite(c.bid) && c.bid > 0 &&
    Number.isFinite(c.ask) && c.ask >= c.bid
  );
  const liquidByDistance = [...liquidContracts].sort(
    (a, b) => Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice)
  );
  for (const contract of liquidByDistance) {
    const quoteIV = impliedVolatilityFromPrice(
      (contract.bid + contract.ask) / 2,
      currentPrice,
      contract.strike,
      daysToExpiration,
      type,
    );
    if (quoteIV >= MIN_VALID_OPTION_IV) return quoteIV;
  }

  // Fallback 2：仅接受最近完成交易时段附近、有时间戳的最后成交价。
  const recentLastTrades = contracts.filter(c => {
    const tradeTime = optionTradeEpochSeconds(c.lastTradeDate);
    const age = tradeTime === null ? Number.POSITIVE_INFINITY : nowEpochSeconds - tradeTime;
    return c.strike > 0 &&
      Number.isFinite(c.lastPrice) && c.lastPrice > 0 &&
      age >= -MAX_LAST_TRADE_FUTURE_SKEW_SECONDS &&
      age <= MAX_LAST_TRADE_AGE_SECONDS;
  });
  const recentByDistance = [...recentLastTrades].sort(
    (a, b) => Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice)
  );
  for (const contract of recentByDistance) {
    const lastTradeIV = impliedVolatilityFromPrice(
      contract.lastPrice,
      currentPrice,
      contract.strike,
      daysToExpiration,
      type,
    );
    if (lastTradeIV >= MIN_VALID_OPTION_IV) return lastTradeIV;
  }

  // 最后才接受无盘口 Yahoo IV，并提高最低可信阈值；用于没有价格可反解但 IV 本身合理的历史 fixture/稀疏链。
  const unquotedIvContracts = contracts.filter(c =>
    c.strike > 0 &&
    Number.isFinite(c.impliedVolatility) &&
    c.impliedVolatility >= MIN_UNQUOTED_OPTION_IV &&
    c.impliedVolatility <= MAX_VALID_OPTION_IV
  );
  if (unquotedIvContracts.length > 0) return interpolateYahooIV(unquotedIvContracts);
  return 0;
}

function findATMContractSpread(contracts: any[], currentPrice: number): number {
  if (!contracts || contracts.length === 0) return 0;
  let closest = contracts[0];
  let minDiff = Math.abs(contracts[0].strike - currentPrice);
  for (const c of contracts) {
    const diff = Math.abs(c.strike - currentPrice);
    if (diff < minDiff) { minDiff = diff; closest = c; }
  }
  const bid = closest.bid ?? 0;
  const ask = closest.ask ?? 0;
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid : 0; // spread as % of mid
}

function optionTradeEpochSeconds(value: unknown): number | null {
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.floor(timestamp > 1e12 ? timestamp / 1000 : timestamp);
}

export async function fetchATMIVCurve(
  symbol: string,
  currentPriceFactor: FinancialFactor<number>,
  opts?: IVCurveOptions,
): Promise<FinancialFactor<IVCurveValue>> {
  const { 
    minDTE = 1, 
    maxDTE = 180, 
    maxExpirations = 10, 
    concurrency = 4 
  } = opts || {};

  const currentPrice = currentPriceFactor.value;
  const now = Math.floor(Date.now() / 1000);

  try {
    const dataFactor = await fetchOptionChains(symbol);
    if (!dataFactor || dataFactor.confidence === 0) {
      return {
        value: { points: [], iv30: 0 },
        confidence: 0,
        source: { type: 'fallback', reason: '无法获取到期日列表' }
      };
    }

    const root = dataFactor.value?.optionChain?.result?.[0];
    const snapshotPrice = Number(root?.quote?.regularMarketPrice);
    const snapshotAsOfSeconds = optionTradeEpochSeconds(root?.quote?.regularMarketTime);
    const pricingSpot = Number.isFinite(snapshotPrice) && snapshotPrice > 0 ? snapshotPrice : currentPrice;
    const snapshot = Number.isFinite(snapshotPrice) && snapshotPrice > 0
      ? { snapshotPrice, ...(snapshotAsOfSeconds !== null ? { snapshotAsOf: new Date(snapshotAsOfSeconds * 1000).toISOString() } : {}) }
      : {};
    const expirations = root?.expirationDates || [];
    
    const validExps = expirations
      .filter((exp: number) => {
        // Yahoo expiration timestamps are UTC midnight. Use ceil so a contract
        // expiring on the next US session does not become 0DTE after 12:00 UTC.
        const dte = Math.ceil((exp - now) / 86400);
        return dte >= minDTE && dte <= maxDTE;
      })
      .slice(0, maxExpirations);

    if (validExps.length === 0) {
      return {
        value: { points: [], iv30: 0 },
        confidence: 0,
        source: { type: 'fallback', reason: '无符合 DTE 要求的到期日' }
      };
    }

    const points: IVPoint[] = [];

    const mapContracts = (rawContracts: any[], dte: number, type: 'call' | 'put', fallbackIV: number): OptionContract[] =>
      (rawContracts ?? [])
        .filter((c: any) => c.strike > 0)
        .map((c: any) => {
          // 优先使用合约自带 IV，若无则使用回退 ATM IV
          const iv = Number.isFinite(c.impliedVolatility) &&
            c.impliedVolatility >= MIN_VALID_OPTION_IV &&
            c.impliedVolatility <= MAX_VALID_OPTION_IV
            ? c.impliedVolatility
            : fallbackIV;
          
          // 希腊字母复用 BS 算法
          // 即使 IV 较低 (比如 0.01) 也要计算，除非完全为 0
          const greeks = iv > 0 ? blackScholesEngine.chainGreeks({
            S: pricingSpot,
            K: c.strike,
            T: dte / 365,
            r: OPTION_PRICING_RATE,
            sigma: iv,
            type
          }) : null;

          return {
            strike: c.strike,
            bid: Number.isFinite(c.bid) && c.bid > 0 ? c.bid : null,
            ask: Number.isFinite(c.ask) && c.ask > 0 ? c.ask : null,
            mid: Number.isFinite(c.bid) && c.bid > 0 && Number.isFinite(c.ask) && c.ask >= c.bid
              ? (c.bid + c.ask) / 2
              : null,
            lastPrice: Number.isFinite(c.lastPrice) && c.lastPrice > 0 ? c.lastPrice : null,
            lastTradeDate: optionTradeEpochSeconds(c.lastTradeDate),
            iv: iv,
            delta: greeks?.delta ?? c.delta,
            theta: greeks?.theta ?? c.theta,
            gamma: greeks?.gamma ?? c.gamma,
            volume: c.volume,
            openInterest: c.openInterest,
            inTheMoney: c.inTheMoney ?? false,
          };
        });
    
    // 分批并行拉取
    for (let i = 0; i < validExps.length; i += concurrency) {
      const chunk = validExps.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map(async (exp: number) => {
        const detailFactor = await fetchOptionChainForExpiration(symbol, exp);
        const detail = detailFactor?.value;
        const opt = detail?.optionChain?.result?.[0]?.options?.[0];
        if (!opt) return null;

        const dte = Math.ceil((exp - now) / 86400);
        const callAtmIV = findATMOptionIV(opt.calls, pricingSpot, dte, 'call', now);
        const putAtmIV = findATMOptionIV(opt.puts, pricingSpot, dte, 'put', now);
        // 两侧必须分别有效，禁止把单侧失败的 0 混入平均值制造 1/2 IV。
        if (callAtmIV < MIN_VALID_OPTION_IV || putAtmIV < MIN_VALID_OPTION_IV) return null;
        const atmIV = (callAtmIV + putAtmIV) / 2;

        const callSpread = findATMContractSpread(opt.calls, pricingSpot);
        const putSpread = findATMContractSpread(opt.puts, pricingSpot);

        return {
          expiration: new Date(exp * 1000).toISOString().split('T')[0],
          daysToExpiration: dte,
          atmIV: atmIV,
          atmBidAskSpread: (callSpread + putSpread) / 2,
          ...(opts?.includeContracts && {
            contracts: {
              calls: mapContracts(opt.calls, dte, 'call', atmIV),
              puts: mapContracts(opt.puts, dte, 'put', atmIV),
            }
          })
        } as IVPoint;
      }));

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) {
          points.push(res.value);
        }
      }
    }

    points.sort((a, b) => a.daysToExpiration - b.daysToExpiration);

    // 计算 iv30 (映射字段名为 avgATMIV 以复用 calculateIV30)
    const iv30 = calculateIV30(points.map(p => ({ 
      daysToExpiration: p.daysToExpiration, 
      avgATMIV: p.atmIV 
    })));

    // 计算 confidence 和流动性惩罚
    let confidence = 0;
    let source: FinancialFactor<IVCurveValue>['source'] = { type: 'fallback', reason: '无有效数据点' };

    if (points.length > 0) {
      confidence = 10;
      source = { type: 'raw', api: 'Yahoo Finance Options (IV30)' };

      // 流动性惩罚 (原则 VI.2: Spread Penalty)
      const avgSpread = points.reduce((sum, p) => sum + p.atmBidAskSpread, 0) / points.length;
      if (avgSpread > 0.10) {
        confidence -= 3.0; // 严重流动性不足
      } else if (avgSpread > 0.05) {
        confidence -= 1.5; // 中度流动性不足
      }
    }

    return {
      value: { points, iv30, ...snapshot },
      confidence: Math.max(0, confidence),
      source
    };

  } catch (error) {
    console.warn(`[fetchATMIVCurve] ${symbol} outer error:`, error);
    return {
      value: { points: [], iv30: 0 },
      confidence: 0,
      source: { type: 'fallback', reason: `异常: ${error instanceof Error ? error.message : String(error)}` }
    };
  }
}

export async function getOptionChainsWithin60Days(
  symbol: string, 
  currentPriceFactor: FinancialFactor<number>
): Promise<FinancialFactor<any[]>> {
  const curve = await fetchATMIVCurve(symbol, currentPriceFactor, {
    minDTE: 1,
    maxDTE: 60,
    maxExpirations: 5,
    concurrency: 4,
  });
  
  // 映射回旧格式（avgATMIV 字段名）
  const chains = curve.value.points.map(p => ({
    expiration: p.expiration,
    daysToExpiration: p.daysToExpiration,
    avgATMIV: p.atmIV,
    atmBidAskSpread: p.atmBidAskSpread,
  }));

  return {
    value: chains,
    confidence: curve.confidence,
    source: curve.source,
  };
}

export function calculateIV30(chains: any[]): number {
  // Only consider chains with valid (non-zero) ATM IV
  const valid = chains.filter(c => c.avgATMIV > 0);
  if (valid.length === 0) return 0;

  if (valid.length === 1) return valid[0].avgATMIV;
  
  // 按 DTE 排序
  const sorted = [...valid].sort((a, b) => a.daysToExpiration - b.daysToExpiration);
  
  // 寻找包围 30 天的两个到期日
  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];
  
  if (30 <= lower.daysToExpiration) return lower.avgATMIV;
  if (30 >= upper.daysToExpiration) return upper.avgATMIV;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].daysToExpiration <= 30 && sorted[i + 1].daysToExpiration >= 30) {
      lower = sorted[i];
      upper = sorted[i + 1];
      break;
    }
  }
  
  // 时间线性插值 (IV30)
  const dteDiff = upper.daysToExpiration - lower.daysToExpiration;
  if (dteDiff === 0) return lower.avgATMIV;
  
  const weight = (30 - lower.daysToExpiration) / dteDiff;
  const iv30 = lower.avgATMIV * (1 - weight) + upper.avgATMIV * weight;
  
  return iv30;
}

export async function getLightStockOptionData(symbol: string): Promise<FactorMap | null> {
  try {
    const [priceDataFactor, historyDataFactor] = await Promise.all([
      fetchYahooFinanceData(symbol),
      fetchHistoricalData(symbol, '1y')
    ]);
    if (!priceDataFactor || !historyDataFactor) return null;
    
    const historyData = historyDataFactor.value;
    const indicators = historyData?.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = indicators?.close?.filter((c: any) => c !== null) || [];
    if (closes.length < 20) return null;

    const closesFactor: FinancialFactor<number[]> = {
      value: closes,
      confidence: historyDataFactor.confidence,
      source: historyDataFactor.source,
    };

    const hv20Factor = calculateHV(closesFactor, 20);
    let approxIV = 0;
    let approxIVConfidence = 0;
    try {
      const optionsDataFactor = await fetchOptionChains(symbol);
      const firstExp = optionsDataFactor?.value?.optionChain?.result?.[0]?.options?.[0];
      if (firstExp) {
        const atmCallIV = findATMOptionIV(firstExp.calls || [], priceDataFactor.value.price, undefined, 'call');
        const atmPutIV = findATMOptionIV(firstExp.puts || [], priceDataFactor.value.price, undefined, 'put');
        if (atmCallIV > 0 && atmPutIV > 0) {
          approxIV = (atmCallIV + atmPutIV) / 2;
          approxIVConfidence = 10;
        }
      }
    } catch (e) {}

    const approxIVFactor: FinancialFactor<number> = approxIV > 0
      ? {
          value: approxIV,
          confidence: approxIVConfidence,
          source: { type: 'raw', api: 'Yahoo Finance API' },
        }
      : {
          value: 0,
          confidence: 0,
          source: { type: 'fallback', reason: '缺失真实期权链' },
        };

    const result: FactorMap = {
      price_data: priceDataFactor,
      sma50: calculateSMA(closesFactor, 50),
      sma200: calculateSMA(closesFactor, 200),
      rsi14: calculateRSI(closesFactor, 14),
      hv20: hv20Factor,
      maxATMIV: approxIVFactor, // 保持向后兼容
      iv30: approxIVFactor,     // 新增
      ivRank: calculateIVRank(approxIVFactor, closesFactor)
    };

    return result;
  } catch (error) { return null; }
}

export async function getStockOptionData(symbol: string): Promise<FactorMap | null> {
  try {
    const [priceDataFactor, historyDataFactor] = await Promise.all([
      fetchYahooFinanceData(symbol),
      fetchHistoricalData(symbol, '1y')
    ]);
    if (!priceDataFactor || !historyDataFactor) return null;
    
    const historyData = historyDataFactor.value;
    const indicators = historyData?.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = indicators?.close?.filter((c: any) => c !== null) || [];
    if (closes.length < 20) return null;

    const closesFactor: FinancialFactor<number[]> = {
      value: closes,
      confidence: historyDataFactor.confidence,
      source: historyDataFactor.source,
    };

    const hv20Factor = calculateHV(closesFactor, 20);
    const optionChainsFactor = await getOptionChainsWithin60Days(symbol, {
      value: priceDataFactor.value.price,
      confidence: priceDataFactor.confidence,
      source: priceDataFactor.source,
    });
    
    const optionChains = optionChainsFactor.value;
    const iv30Val = calculateIV30(optionChains);

    const realIVFactor: FinancialFactor<number> = iv30Val > 0
      ? {
          value: iv30Val,
          confidence: optionChainsFactor.confidence,
          source: optionChainsFactor.source,
        }
      : {
          value: 0,
          confidence: 0,
          source: { type: 'fallback', reason: '缺失真实期权链' },
        };

    const result: FactorMap = {
      price_data: priceDataFactor,
      sma50: calculateSMA(closesFactor, 50),
      sma200: calculateSMA(closesFactor, 200),
      rsi14: calculateRSI(closesFactor, 14),
      hv20: hv20Factor,
      optionChains: optionChainsFactor,
      maxATMIV: realIVFactor, // 保持向后兼容
      iv30: realIVFactor,     // 新增精确的 IV30
      ivRank: calculateIVRank(realIVFactor, closesFactor)
    };
    
    return result;
  } catch (error) { return null; }
}
