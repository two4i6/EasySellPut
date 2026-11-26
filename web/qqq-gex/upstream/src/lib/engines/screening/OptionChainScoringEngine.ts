import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { createDerivedFactor } from '../../factor';

export class OptionChainScoringEngine extends FactorEngine {
  /**
   * 计算期权链机会评分
   */
  public calculateScore(factors: FactorMap): FinancialFactor<any> {
    // 兼容逻辑：优先从 factors 直接取，或者从 stock_data 包装器取
    const stockData = factors.stock_data?.value as any;
    
    const hv20 = (factors.hv_20?.value as number) ?? (stockData?.hv_20 ?? 0);
    const ivAtm = (factors.implied_volatility?.value as number) ?? (stockData?.implied_volatility ?? 0);
    const rsi = (factors.rsi?.value as number) ?? (stockData?.rsi ?? 50);

    const ivHvRatio = hv20 > 0 ? ivAtm / hv20 : 1;
    
    let score = 50;
    if (ivHvRatio > 1.2) score += 20;
    if (ivAtm > 0.4) score += 15;
    if (rsi < 40 || rsi > 70) score += 10;
    
    const val = {
      totalScore: Math.min(100, score),
      returnScore: Math.round(ivAtm * 100),
      riskScore: Math.round((1 - (Math.min(100, score) / 100)) * 100)
    };

    return createDerivedFactor(val, [{ factorId: 'stock_data', weight: 1.0 }], factors);
  }

  /**
   * 硬性过滤器检查
   */
  public checkHardFilters(factors: FactorMap, _config: any): { passed: boolean; reason?: string } {
    const iv = factors.implied_volatility?.value as number ?? 0;
    if (iv < 0.15) return { passed: false, reason: 'IV too low (< 15%)' };
    
    const spread = factors.atm_bid_ask_spread?.value as number ?? 0;
    if (spread > 0.20) return { passed: false, reason: 'Bid-Ask spread too wide' };

    return { passed: true };
  }
}

export const optionChainScoringEngine = new OptionChainScoringEngine();
