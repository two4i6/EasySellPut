import { createReadonlyMarketPrecompute, iterateBacktest, runBacktest, type BacktestExecutionContext, type ReadonlyMarketPrecompute } from './day-loop';
import type { BacktestConfig, BacktestResult } from '../../backtest/types';
import type { OHLCV } from '../../types/input';
import type { MarketDataSet } from './fixtures';
import type { ResolvedBacktestRunSpec } from './run-spec';
import { getOverlayUniverse } from '../../universe';
import { MOCK_OPTION_CALIBRATION } from '../../backtest/mockOptionCalibration';

/**
 * v2 runner 到既有日级执行器的唯一窄适配点。
 * 在完整执行循环迁移前，保留原始参数顺序以锁定成交、现金流和回测结果。
 */
export function executeResolvedBacktest(spec: ResolvedBacktestRunSpec, data: MarketDataSet, execution: BacktestExecutionContext = {}): BacktestResult {
  return executeLegacyBacktest(...resolvedInvocation(spec, data, execution));
}

/** SDK observation stream shares coordinates and the exact native stock/state loop. */
export function iterateResolvedBacktest(spec: ResolvedBacktestRunSpec, data: MarketDataSet, execution: BacktestExecutionContext = {}) {
  return iterateBacktest(...resolvedInvocation(spec, data, { ...execution, yieldDecisionObservations: true }));
}

/** Data availability/warm-up calendar only, never a strategy-approved date collection. */
export function resolveNativeDecisionBars(spec: ResolvedBacktestRunSpec, data: MarketDataSet): string[] {
  const [signalBars, leveragedBars] = resolvedInvocation(spec, data, {});
  const leveraged = new Map(leveragedBars.map(bar => [bar.date, bar.close]));
  return signalBars.flatMap((bar, index) => index >= (spec.config.minBarHistory ?? 200)
    && (!spec.config.startDate || bar.date >= spec.config.startDate)
    && (!spec.config.endDate || bar.date <= spec.config.endDate)
    && (leveraged.get(bar.date) ?? 0) > 0 ? [bar.date] : []);
}

function resolvedInvocation(spec: ResolvedBacktestRunSpec, data: MarketDataSet, execution: BacktestExecutionContext): Parameters<typeof iterateBacktest> {
  const universe = getOverlayUniverse(spec.universeId);
  const signalSymbol = spec.signalSymbol ?? universe.signalSymbol;
  const signalBars = data.barsBySymbol?.[signalSymbol] ?? (signalSymbol === 'SPY' ? data.spyBars : data.qqqBars) ?? data.qqqBars;
  const leveragedBars = data.barsBySymbol?.[universe.leveragedSymbol] ?? (universe.leveragedSymbol === 'TQQQ' ? data.tqqqBars : undefined) ?? data.tqqqBars;
  const hasVxn = Object.keys(data.vxnByDate).length > 0;
  // Mock pricing maps VIX→QQQ ATM IV by ×1.25 and VXN by /1.1. Scale the
  // VIX fallback so the VXN-missing route exactly equals the VIX route.
  const pricingVolByDate = spec.config.volIndex === 'VXN' && !hasVxn
    ? Object.fromEntries(Object.entries(data.vixByDate).map(([date, vol]) => [date, vol * MOCK_OPTION_CALIBRATION.vixToQqqAtmIv * MOCK_OPTION_CALIBRATION.vxnToQqqAtmIvDivisor]))
    : spec.config.volIndex === 'VXN' ? data.vxnByDate : data.vixByDate;
  const riskVolByDate = spec.config.riskVolIndex === 'VXN' && hasVxn ? data.vxnByDate : data.vixByDate;
  return [
    signalBars,
    leveragedBars,
    data.boxxBars,
    riskVolByDate,
    spec.config,
    data.spyBars,
    data.vix3mByDate,
    pricingVolByDate,
    data.vxnByDate,
    data.splitEventsBySymbol ?? {},
    { ...execution, macroExecutionDriver: spec.macroExecutionDriver, slowSubregimeDiagnostics: spec.scenarioOptions?.slowSubregimeDiagnostics, slowSubregimeByDate: data.slowSubregimeByDate },
  ];
}

/** 与 executeResolvedBacktest 使用相同的市场坐标解析，供 batch 复用只读索引。 */
export function createMarketPrecompute(spec: ResolvedBacktestRunSpec, data: MarketDataSet): ReadonlyMarketPrecompute {
  const universe = getOverlayUniverse(spec.universeId);
  const signalSymbol = spec.signalSymbol ?? universe.signalSymbol;
  const signalBars = data.barsBySymbol?.[signalSymbol] ?? (signalSymbol === 'SPY' ? data.spyBars : data.qqqBars) ?? data.qqqBars;
  const leveragedBars = data.barsBySymbol?.[universe.leveragedSymbol] ?? (universe.leveragedSymbol === 'TQQQ' ? data.tqqqBars : undefined) ?? data.tqqqBars;
  return createReadonlyMarketPrecompute(signalBars, leveragedBars, data.boxxBars);
}

/** 旧研究脚本的同签名兼容入口；禁止绕过此适配层直连 simulator。 */
export function executeLegacyBacktest(
  qqqBars: OHLCV[],
  leveragedBars: OHLCV[],
  boxxBars: OHLCV[] | undefined,
  vixByDate: Record<string, number>,
  config: BacktestConfig,
  spyBars?: OHLCV[],
  vix3mByDate: Record<string, number> = {},
  pricingVolByDate?: Record<string, number>,
  vxnByDate?: Record<string, number>,
  splitEventsBySymbol: NonNullable<MarketDataSet['splitEventsBySymbol']> = {},
  execution: BacktestExecutionContext = {},
): BacktestResult {
  return runBacktest(qqqBars, leveragedBars, boxxBars, vixByDate, config, spyBars, vix3mByDate, pricingVolByDate, vxnByDate, splitEventsBySymbol, execution);
}
