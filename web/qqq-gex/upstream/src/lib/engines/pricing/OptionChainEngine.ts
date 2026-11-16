/**
 * 准真实期权链引擎 (Option Chain Engine)
 * 支持基于 Black-Scholes 模型生成合成期权链，包含 Delta, Bid/Ask, IV
 */

import { blackScholesEngine } from './BlackScholesEngine';
import { TECHNICAL } from '../shared/constants';

export interface OptionContract {
  strike: number;
  type: 'Call' | 'Put';
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  delta: number;
  theta: number;
  dte: number;
  expiry: string;
  lastPrice?: number;
  lastTradeDate?: number;
}

export interface ExpirationGroup {
  expiryDate: string;
  dte: number;
  options: OptionContract[];
}

export interface OptionChain {
  date: string;
  underlyingPrice: number;
  expirations: ExpirationGroup[];
}

export class OptionChainEngine {
  private static instance: OptionChainEngine;

  public static getInstance(): OptionChainEngine {
    if (!OptionChainEngine.instance) {
      OptionChainEngine.instance = new OptionChainEngine();
    }
    return OptionChainEngine.instance;
  }

  /**
   * 生成指定日期的完整期权链 (合成数据)
   */
  public generateChain(date: string, spot: number, vix: number): OptionChain {
    const expirations: ExpirationGroup[] = [];
    const targetDTEs = TECHNICAL.TARGET_DTES;
    const r = TECHNICAL.DEFAULT_RISK_FREE; // 无风险利率

    targetDTEs.forEach(dte => {
      const expiryDate = new Date(new Date(date).getTime() + dte * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const options: OptionContract[] = [];
      
      // 生成行权价范围: 标的价格的 ±30%
      const minStrike = Math.floor(spot * 0.7);
      const maxStrike = Math.ceil(spot * 1.3);
      const interval = spot > 1000 ? 25 : (spot > 100 ? 5 : 1);

      for (let strike = minStrike; strike <= maxStrike; strike += interval) {
        // 计算 Call 和 Put 的 Greeks 和 价格
        ['Call', 'Put'].forEach(type => {
          const sigma = vix / 100; // 使用 VIX 作为基准波动率
          const T = dte / 365;
          
          const greeks = blackScholesEngine.price({ 
            S: spot, 
            K: strike, 
            T, 
            r, 
            sigma, 
            type: type === 'Call' ? 'call' : 'put' 
          });
          
          const mid = greeks.price;
          
          // 模拟买卖价差 (Bid/Ask): 波动率越高/流动性越低，价差越大
          const spread = Math.max(0.01, mid * (0.05 + (vix / 200))); // 至少 0.01 价差
          let bid = Math.max(0.01, Math.round((mid - spread / 2) * 100) / 100);
          let ask = Math.max(bid + 0.01, Math.round((mid + spread / 2) * 100) / 100);

          if (bid >= ask) {
            ask = bid + 0.01;
          }

          options.push({
            strike,
            type: type as 'Call' | 'Put',
            bid,
            ask,
            mid,
            iv: sigma,
            delta: greeks.delta,
            theta: greeks.theta,
            dte,
            expiry: expiryDate
          });
        });
      }

      expirations.push({ expiryDate, dte, options });
    });

    return { date, underlyingPrice: spot, expirations };
  }

  /**
   * 从期权链中选择符合条件的合约
   */
  public findContract(chain: OptionChain, targetDTE: number, targetDelta: number, type: 'Call' | 'Put'): OptionContract | null {
    if (!chain.expirations || chain.expirations.length === 0) return null;
    
    // targetDelta 应该是负数（Put）或正数（Call），但也可能是直接传的绝对值
    // 但通常参数检查可以统一到绝对值的形式，这里如果超过范围则抛错
    if (Math.abs(targetDelta) > 1) {
      throw new Error(`Invalid targetDelta: ${targetDelta}. Must be between -1 and 1.`);
    }

    // 1. 寻找最接近的到期日，加入 tie-break：距离相同时，选择 DTE 更早的
    const expiration = chain.expirations.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev.dte - targetDTE);
      const currDiff = Math.abs(curr.dte - targetDTE);
      if (currDiff < prevDiff) return curr;
      if (currDiff === prevDiff && curr.dte < prev.dte) return curr;
      return prev;
    });

    // 2. 在该到期日寻找最接近目标 Delta 的合约，加入 tie-break：距离相同时，选择 strike 离现价更远的 (更 OTM)
    const options = expiration.options.filter(o => o.type === type);
    if (options.length === 0) return null;

    return options.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev.delta - targetDelta);
      const currDiff = Math.abs(curr.delta - targetDelta);
      if (currDiff < prevDiff) return curr;
      if (currDiff === prevDiff) {
        // OTM put = lower strike, OTM call = higher strike
        if (type === 'Put' && curr.strike < prev.strike) return curr;
        if (type === 'Call' && curr.strike > prev.strike) return curr;
      }
      return prev;
    });
  }
}

export const optionChainEngine = OptionChainEngine.getInstance();
