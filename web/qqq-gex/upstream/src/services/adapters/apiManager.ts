import { FinancialFactor, FactorMap } from '../../types/factor';
import { YahooFinanceResponse } from './yahooFinance';

/**
 * 统一API管理器
 * 单例模式管理所有外部API调用，提供统一的错误处理
 * 注意：本类不包含UI相关的Toast通知，UI层应通过useAppSWR或手动处理错误
 */

export class ApiManager {
  private static instance: ApiManager;
  private debounceTimers: Map<string, number> = new Map();
  private requestCache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 30000; // 30秒缓存

  private constructor() {}

  static getInstance(): ApiManager {
    if (!ApiManager.instance) {
      ApiManager.instance = new ApiManager();
    }
    return ApiManager.instance;
  }

  // 防抖API调用
  async debouncedApiCall<T>(
    key: string,
    apiFunction: () => Promise<T>,
    delay: number = 1000
  ): Promise<T | null> {
    // 清除之前的定时器
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 检查缓存
    const cached = this.requestCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      return cached.data as T;
    }

    return new Promise((resolve) => {
      const timerId = window.setTimeout(async () => {
        try {
          const result = await apiFunction();
          // 缓存结果
          this.requestCache.set(key, {
            data: result,
            timestamp: Date.now()
          });
          this.debounceTimers.delete(key);
          resolve(result);
        } catch (error) {
          console.error(`Debounced API call failed for ${key}:`, error);
          this.debounceTimers.delete(key);
          resolve(null);
        }
      }, delay);

      this.debounceTimers.set(key, timerId);
    });
  }

  // 清理缓存
  clearCache(pattern?: string) {
    if (pattern) {
      Array.from(this.requestCache.keys()).forEach(key => {
        if (key.includes(pattern)) {
          this.requestCache.delete(key);
        }
      });
    } else {
      this.requestCache.clear();
    }
  }

  // 通用API调用方法
  async apiCall<T>(
    apiFunction: () => Promise<T>,
    options: {
      retryCount?: number;
      retryDelay?: number;
    } = {}
  ): Promise<T | null> {
    const {
      retryCount = 1,
      retryDelay = 1000
    } = options;

    let lastError: Error | null = null;

    // 重试机制
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const result = await apiFunction();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('未知错误');
        
        // 如果不是最后一次尝试，等待后重试
        if (attempt < retryCount - 1) {
          await this.delay(retryDelay);
          continue;
        }
        
        console.error('API调用失败:', lastError);
        throw lastError; // 向上抛出错误，由调用者或 useAppSWR 处理
      }
    }

    return null;
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 通用 fetch 方法
  async fetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    return this.apiCall(async () => {
      const response = await window.fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      return response.json();
    }) as Promise<T>;
  }

  // Yahoo Finance API调用
  async fetchYahooFinanceData(symbol: string): Promise<FinancialFactor<YahooFinanceResponse> | null> {
    return this.apiCall(
      async () => {
        const url = `/api/proxy/yahoo?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        }
        
        const data = await response.json();
        
        // 后端 API 应该已经返回了 FinancialFactor 结构
        if (data && data.value !== undefined) {
          return data as FinancialFactor<YahooFinanceResponse>;
        } else {
          return {
            value: data,
            confidence: 0,
            source: { type: 'fallback', api: 'Yahoo Finance API (Proxied)', reason: 'Backend returned unwrapped data' },
            
          };
        }
      },
      {
        retryCount: 2,
        retryDelay: 1000
      }
    );
  }

  // 通用HTTP GET请求
  async httpGet<T>(
    url: string, 
    options: {
      headers?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<T | null> {
    const {
      headers = {},
      timeout = 10000
    } = options;

    return this.apiCall(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return await response.json();
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('请求超时');
          }
          throw error;
        }
      },
      {
        retryCount: 2,
        retryDelay: 1000
      }
    );
  }

  // 通用HTTP POST请求
  async httpPost<T>(
    url: string, 
    data: any,
    options: {
      headers?: Record<string, string>;
      timeout?: number;
    } = {}
  ): Promise<T | null> {
    const {
      headers = {},
      timeout = 10000
    } = options;

    return this.apiCall(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            body: JSON.stringify(data),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return await response.json();
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('请求超时');
          }
          throw error;
        }
      },
      {
        retryCount: 2,
        retryDelay: 1000
      }
    );
  }

  // 批量API调用
  async batchApiCalls<T>(
    apiCalls: Array<() => Promise<T>>,
    options: {
      maxConcurrency?: number;
      continueOnError?: boolean;
    } = {}
  ): Promise<(T | null)[]> {
    const {
      maxConcurrency = 5,
      continueOnError = true
    } = options;

    const results: (T | null)[] = [];
    
    // 分批处理以控制并发数
    for (let i = 0; i < apiCalls.length; i += maxConcurrency) {
      const batch = apiCalls.slice(i, i + maxConcurrency);
      
      const batchPromises = batch.map(async (apiCall) => {
        try {
          return await this.apiCall(apiCall);
        } catch (error) {
          if (!continueOnError) {
            throw error;
          }
          return null;
        }
      });

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      } catch (error) {
        if (continueOnError) {
          // 如果继续执行，填充null值
          results.push(...new Array(batch.length).fill(null));
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  // 获取API健康状态
  async getApiHealthStatus(): Promise<{
    yahoo: boolean;
    overall: boolean;
  }> {
    const healthChecks = {
      yahoo: false,
      overall: false
    };

    // 测试Yahoo Finance API
    const yahooTest = await this.fetchYahooFinanceData('AAPL');
    healthChecks.yahoo = yahooTest !== null;

    healthChecks.overall = healthChecks.yahoo;

    return healthChecks;
  }

  // ============ 期权卖方筛选器 API ============

  /**
   * 获取单个股票的期权数据
   */
  async getStockOptionData(symbol: string, lightweight: boolean = false): Promise<{
    symbol: string;
    data: FactorMap;
    score: FinancialFactor<any>;
    passedFilter: boolean;
    filterReason?: string;
  } | null> {
    return this.apiCall(
      async () => {
        const url = `/api/options/chain/${encodeURIComponent(symbol.toUpperCase())}${lightweight ? '?lightweight=true' : ''}`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        }
        
        const data = await response.json();
        return data;
      },
      {
        retryCount: 2,
        retryDelay: 1000
      }
    );
  }

  /**
   * 获取纳斯达克100成分股列表
   */
   async getNasdaq100Symbols(): Promise<{
     symbols: string[];
     count: number;
   } | null> {
     return this.apiCall(
       async () => {
         const url = `/api/symbols?group=nasdaq100`;

         const response = await fetch(url, {
           method: 'GET',
           headers: {
             'Accept': 'application/json',
             'Content-Type': 'application/json'
           }
         });

         if (!response.ok) {
           const errorText = await response.text().catch(() => '');
           throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
         }

         const data = await response.json();
         return data;
       },
       {
         retryCount: 2,
         retryDelay: 1000
       }
     );
     }
     }
// 导出单例实例
export const apiManager = ApiManager.getInstance();
