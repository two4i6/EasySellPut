import { IndicatorResult } from './types';
import { FactorMap, FinancialFactor } from '../../types/factor';

export function toFactorMap(result: IndicatorResult): FactorMap {
  const factors: FactorMap = {};
  const lastIndex = result.ma_7.length - 1;

  if (lastIndex < 0) return factors;

  Object.entries(result).forEach(([key, series]) => {
    const lastValue = series[lastIndex];
    if (!lastValue) return;

    factors[key] = {
      value: lastValue.value,
      confidence: lastValue.confidence ?? (lastValue.value !== null ? 9 : 0),
      source: lastValue.value !== null 
        ? { type: 'raw', api: 'TechIndicators' } 
        : { type: 'fallback', reason: 'Data insufficient for calculation' }
    } as FinancialFactor<unknown>;
  });

  return factors;
}
