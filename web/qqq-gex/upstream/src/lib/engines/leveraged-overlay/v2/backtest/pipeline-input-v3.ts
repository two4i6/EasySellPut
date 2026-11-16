import type {MarketInput} from '../../types/input';
import type {BacktestConfig} from '../../backtest/types';

export function applyMacroBoostBlock(
  strategyParams: BacktestConfig['strategyParams'],
  date: string,
  blockedDates?: BacktestConfig['macroBoostBlockedDates'],
): BacktestConfig['strategyParams'] {
  if (!strategyParams?.macroRegime || !blockedDates?.[date]) return strategyParams;
  return { ...strategyParams, macroRegime: { ...strategyParams.macroRegime, boostFactor: 1 } };
}

export function createBacktestPipelineInput(input: Omit<MarketInput, 'mode'>): MarketInput {
  return { ...input, mode: 'backtest' };
}
