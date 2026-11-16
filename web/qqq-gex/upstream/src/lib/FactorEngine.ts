import type { FinancialFactor, FactorMap, DerivedSource, RawSource, ManualSource } from '../types/factor';
import { createDerivedFactor, fallbackFactor } from './factor';

export abstract class FactorEngine {

  // 原生因子工厂：API 数据有效时用此方法
  protected raw<T>(value: T, api: string, logicReason?: string): FinancialFactor<T> {
    return { value, confidence: 10, source: { type: 'raw', api }, logicReason };
  }

  // fallback 工厂：数据无效或缺失时用此方法
  protected fallback<T>(value: T, reason: string, logicReason?: string): FinancialFactor<T> {
    return fallbackFactor(value, reason, logicReason);
  }

  // 手动输入工厂
  protected manual<T>(value: T, description: string, logicReason?: string): FinancialFactor<T> {
    return { value, confidence: 7, source: { type: 'manual', description }, logicReason };
  }

  // 派生因子工厂：调用前自动检查依赖因子，缺失时返回 fallback
  protected derived<T>(
    value: T,
    inputs: DerivedSource['inputs'],
    factors: FactorMap,
    logicReason?: string,
  ): FinancialFactor<T> {
    const missing = inputs.filter(i => !factors[i.factorId]);
    if (missing.length > 0) {
      return this.fallback(value, `缺失依赖因子: ${missing.map(i => i.factorId).join(', ')}`, logicReason);
    }
    const factor = createDerivedFactor(value, inputs, factors);
    if (logicReason) factor.logicReason = logicReason;
    return factor;
  }

  // 原生因子有效性校验
  protected isValid(value: number, type: 'price' | 'vix' | 'rate' | 'rsi' | 'ma'): boolean {
    switch (type) {
      case 'price': return value > 0;
      case 'vix':   return value > 5 && value < 150;
      case 'rate':  return value >= 0 && value < 30;
      case 'rsi':   return value > 0 && value <= 100;
      case 'ma':    return value > 0;
    }
  }
}
