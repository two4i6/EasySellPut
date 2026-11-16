import { FinancialFactor, FactorMap } from '../../types/factor';
import { isValidPrice } from '../../lib/factor';
import { volatilityEngine } from '../../lib/engines';
import { getStockOptionData } from './yahooFinance';

export interface PriceData {
// ... (interfaces remain same)
  symbol: string;
  currentPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  beta?: number;
}

export interface VolatilityData {
  symbol: string;
  impliedVolatility: number;
  historicalVolatility: number;
  ivRank: number;
  ivPercentile: number;
}

export interface OptionChainData {
  symbol: string;
  expiration: string;
  daysToExpiration: number;
  strikes: OptionStrike[];
  atmCallIV: number;
  atmPutIV: number;
  avgATMIV: number;
}

export interface OptionStrike {
  strike: number;
  call: {
    bid: number;
    ask: number;
    impliedVolatility: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    volume: number;
    openInterest: number;
  };
  put: {
    bid: number;
    ask: number;
    impliedVolatility: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    volume: number;
    openInterest: number;
  };
}

export interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class MarketDataService {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 30000; // 30 seconds

  async fetchPriceData(symbol: string): Promise<FinancialFactor<PriceData>> {
    const cacheKey = `price_${symbol}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const { yahooFinanceServer } = await import('./yahooFinanceServer');
      const resultFactor = await yahooFinanceServer.getQuote(symbol);

      if (!resultFactor) throw new Error(`Price API error for ${symbol}`);

      const data = resultFactor.value;
      const isValidCurrentPrice = isValidPrice(data.price);
      const isValidPreviousClose = isValidPrice(data.previousClose);
      
      const priceData: PriceData = {
        symbol: symbol.toUpperCase(),
        currentPrice: data.price,
        previousClose: data.previousClose,
        change: data.change,
        changePercent: data.changePercent,
        volume: (data.meta as any)?.regularMarketVolume || 0,
        marketCap: 0,
        beta: 0
      };

      const finalFactor: FinancialFactor<PriceData> = {
        value: priceData,
        confidence: (isValidCurrentPrice && isValidPreviousClose) ? resultFactor.confidence : 0,
        source: (isValidCurrentPrice && isValidPreviousClose) 
          ? resultFactor.source 
          : { type: 'fallback', reason: '价格数据无效（currentPrice或previousClose <= 0）' },
      };

      this.setCachedData(cacheKey, finalFactor);
      return finalFactor;
    } catch (error) {
      throw new Error(`Failed to fetch price data for ${symbol}: ${error}`);
    }
  }

  async fetchHistoricalData(symbol: string, period: string = '1mo'): Promise<FinancialFactor<HistoricalData[]>> {
    const cacheKey = `historical_${symbol}_${period}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const range = period === '1mo' ? '1mo' : period === '3mo' ? '3mo' : period === '1y' ? '1y' : '1mo';
      const { yahooFinanceServer } = await import('./yahooFinanceServer');
      const resultFactor = await yahooFinanceServer.getHistorical(symbol, range);

      if (!resultFactor?.value?.chart?.result?.[0]) {
        throw new Error(`No historical data found for ${symbol}`);
      }

      const result = resultFactor.value.chart.result[0];
      const timestamps = result.timestamp || [];
      const quotes = result.indicators.quote[0];

      const formattedData: HistoricalData[] = timestamps.map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        open: quotes.open[i] || 0,
        high: quotes.high[i] || 0,
        low: quotes.low[i] || 0,
        close: quotes.close[i] || 0,
        volume: quotes.volume[i] || 0
      })).filter((d: any) => d.close > 0);

      const finalFactor: FinancialFactor<HistoricalData[]> = {
        value: formattedData,
        confidence: resultFactor.confidence,
        source: resultFactor.source,
      };

      this.setCachedData(cacheKey, finalFactor);
      return finalFactor;
    } catch (error) {
      throw new Error(`Failed to fetch historical data for ${symbol}: ${error}`);
    }
  }

  async fetchVolatilityData(symbol: string, lightweight: boolean = false): Promise<FactorMap> {
    // 构建 MarketData 对象
    const [priceData, historicalData, optionChainData] = await Promise.all([
      this.fetchPriceData(symbol),
      this.fetchHistoricalData(symbol, '1mo'),
      this.fetchOptionChain(symbol)
    ]);

    // 构建 ATM IV 曲线
    const atmIVCurve = optionChainData.value.map(chain => ({
      dte: chain.daysToExpiration,
      iv: chain.avgATMIV
    })).filter(point => point.iv > 0);

    // 构建历史价格数据
    const historicalPrices = historicalData.value.map(item => ({
      timestamp: new Date(item.date).getTime() / 1000,
      close: item.close
    }));

    // 构建 MarketData 对象
    const marketData = {
      underlying_price: priceData.value.currentPrice,
      atm_iv_curve: atmIVCurve,
      historical_prices: historicalPrices,
      market_state: 'OPEN' as const // 简化处理，实际应该从价格数据中获取
    };

    return volatilityEngine.fetchVolatilityData(marketData, lightweight);
  }

  async fetchOptionChain(symbol: string, _expirationFilter?: string): Promise<FinancialFactor<OptionChainData[]>> {
    const cacheKey = `options_chain_${symbol}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const responseData = await getStockOptionData(symbol);
      
      const optionChainsFactor = responseData?.optionChains;

      if (!optionChainsFactor) {
        return { value: [], confidence: 0, source: { type: 'fallback', reason: 'No option data' }};
      }

      const formattedChains: OptionChainData[] = optionChainsFactor.value.map((chain: any) => ({
        symbol,
        expiration: chain.expiration,
        daysToExpiration: chain.daysToExpiration,
        strikes: [], 
        atmCallIV: chain.atmCallIV,
        atmPutIV: chain.atmPutIV,
        avgATMIV: chain.avgATMIV
      }));

      const finalFactor: FinancialFactor<OptionChainData[]> = {
        value: formattedChains,
        confidence: optionChainsFactor.confidence,
        source: optionChainsFactor.source,
      };

      this.setCachedData(cacheKey, finalFactor);
      return finalFactor;
    } catch (error) {
      return { value: [], confidence: 0, source: { type: 'fallback', reason: error instanceof Error ? error.message : 'Unknown error' }};
    }
  }


  private getCachedData(key: string): any {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const marketDataService = new MarketDataService();
