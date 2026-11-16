/** Shared native market coordinates and warm-up calendar; no full backtest runner. */
import {createReadonlyMarketPrecompute,iterateNativeStockState,type BacktestExecutionContext,type ReadonlyMarketPrecompute} from './native-stock-loop-v2';
import type {MarketDataSet} from './fixtures';
import type {ResolvedBacktestRunSpec} from './run-spec';
import {getOverlayUniverse} from '../../universe';
import {MOCK_OPTION_CALIBRATION} from '../../backtest/mockOptionCalibration';
export function iterateResolvedNativeStockState(spec:ResolvedBacktestRunSpec,data:MarketDataSet,execution:BacktestExecutionContext={}){
  return iterateNativeStockState(...resolvedNativeInvocation(spec,data,{...execution,yieldDecisionObservations:true}));
}
export function resolveNativeDecisionBars(spec: ResolvedBacktestRunSpec, data: MarketDataSet): string[] {
  const [signalBars, leveragedBars] = resolvedNativeInvocation(spec, data, {});
  const leveraged = new Map(leveragedBars.map(bar => [bar.date, bar.close]));
  return signalBars.flatMap((bar, index) => index >= (spec.config.minBarHistory ?? 200)
    && (!spec.config.startDate || bar.date >= spec.config.startDate)
    && (!spec.config.endDate || bar.date <= spec.config.endDate)
    && (leveraged.get(bar.date) ?? 0) > 0 ? [bar.date] : []);
}

export function resolvedNativeInvocation(spec: ResolvedBacktestRunSpec, data: MarketDataSet, execution: BacktestExecutionContext): Parameters<typeof iterateNativeStockState> {
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

export function createMarketPrecompute(spec: ResolvedBacktestRunSpec, data: MarketDataSet): ReadonlyMarketPrecompute {
  const universe = getOverlayUniverse(spec.universeId);
  const signalSymbol = spec.signalSymbol ?? universe.signalSymbol;
  const signalBars = data.barsBySymbol?.[signalSymbol] ?? (signalSymbol === 'SPY' ? data.spyBars : data.qqqBars) ?? data.qqqBars;
  const leveragedBars = data.barsBySymbol?.[universe.leveragedSymbol] ?? (universe.leveragedSymbol === 'TQQQ' ? data.tqqqBars : undefined) ?? data.tqqqBars;
  return createReadonlyMarketPrecompute(signalBars, leveragedBars, data.boxxBars);
}
