/** Versioned native policy configuration; windows remain relative to supplied data. */
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type { QqqPcsHistoricalBacktestOptions } from '../engines/analysis/QqqPcsHistoricalBacktest';
import type { BacktestRunSpec, ResolvedBacktestRunSpec } from '../engines/leveraged-overlay/v2/backtest/run-spec';
import type { StrategyParams } from '../engines/leveraged-overlay/types/params';

// Preserve inherited insertion order independently of mutable preset/production defaults.
const NATIVE_SOURCE_PARAMETERS_V1: StrategyParams = {
  maxTqqqHardPct: .6, maxTqqqWarnPct: .4, maxLeverage: 2.5,
  minLiquidPct: .2, maxDailyLossPct: .05, drawdownWarnPct: .15,
  targetVol: .15, minVolFloor: .1, minCashReserve: .05, maxSellPerBarPct: .15,
  navDrawdownGovernor: {tiers: [{ddPct: .15, factor: .6}, {ddPct: .22, factor: .3}], regimeGated: true},
  fastVolReentry: true,
  sellDeltaByRegime: {RISK_ON_WEAKENING: .07, SIDEWAYS: .07, RANGE_BOUND: .07, BEAR: .04, CRISIS: .03},
  sellDeltaErThreshold: .25, postCrisisFastEntry: true, crisisRecoveryBars: 2,
  intradayDeRisk: false,
  intradayDeRiskTiers: [{dropPct: .08, keepFactor: .9}, {dropPct: .12, keepFactor: .75}, {dropPct: .16, keepFactor: .6}],
  flashCrashOverride: {vixSpikeRatio: 1.05, vixMin: 24, maxSpeedDays: 50, drawdownThreshold: -.12, mode: 'hardmax', releaseBars: 15},
  macroRegime: {boostFactor: 1, classifier: 'w7-hybrid'}, crisisPhaseSellExempt: true,
  pcsTargetDte: 35, pcsSpreadWidthPct: .02,
  pcsSurvivalPriceSelectionMode: 'survival_only', pcsSurvivalSelectionFloor: .3,
  pcsSurvivalSelectionObjective: 'survival_adjusted_expected_pnl',
  pcsSurvivalSelectionSurvivalWeight: .75, pcsSurvivalSelectionWilsonWeight: .5,
  pcsSurvivalSelectionDteMode: 'fixed', pcsSurvivalSelectionWidthMode: 'fixed',
  pcsSurvivalSelectionSigmaMode: 'stress_only_dynamic_v1',
  pcsRescueEnabled: true, pcsRescueEntryMode: 'reactive_soft_pool',
  pcsRescueRegimeScope: 'selective_quality_v14', pcsRescueDeltaMode: 'state_adaptive_quality_v5',
  pcsRescueExtremeDelta: .2425, pcsRescueExtremeBaseDelta: .2, pcsRescueExtremeFallbackDelta: .18,
  pcsRescueNormalDelta: .075, pcsRescueCalmDelta: .1, pcsRescuePressureDelta: .025,
  pcsRescueWidthPct: .02, pcsRescueExtremeWidthPct: .0325, pcsRescueTargetDte: 35, pcsRescueRiskBudgetNav: .005,
};
const NATIVE_SOURCE_SELECTION_V1: Partial<StrategyParams> = {
  pcsRescueEnabled: false, pcsSurvivalPriceSelectionMode: 'survival_only', pcsSurvivalExitMode: 'off',
  pcsSurvivalSelectionFloor: .3, pcsSurvivalSelectionObjective: 'survival_adjusted_expected_pnl',
  pcsSurvivalSelectionSurvivalWeight: .75, pcsSurvivalSelectionWilsonWeight: .5,
  pcsSurvivalSelectionMaxConditionalLossRatio: undefined, pcsSurvivalSelectionStressTailVetoRatio: undefined,
  pcsSurvivalSelectionTailWidthTriggerRatio: undefined, pcsSurvivalSelectionWidthBlend: undefined,
  pcsSurvivalSelectionWidthConfirmDays: undefined, pcsSurvivalSelectionWidthSwitchMargin: undefined,
  pcsSurvivalSelectionWidthDeltaPnlFloor: undefined, pcsSurvivalSelectionWidthTailImprovementMargin: undefined,
  pcsSurvivalSelectionCreditRetentionFloor: undefined,
  pcsSurvivalSelectionDteMode: 'fixed', pcsSurvivalSelectionWidthMode: 'fixed',
  pcsSurvivalSelectionSigmaMode: 'stress_only_dynamic_v1', pcsPressureSizingMode: 'off',
  pcsPressureSizingMediumMultiplier: undefined, pcsPressureSizingStressedMultiplier: undefined,
  pcsContractProfile: undefined,
};
export type NativeSourceInitialization = { replayVariant: QqqPcsHistoricalBacktestOptions['replayVariant'];
  fullCalendarYearsWarmup?: number; alignMonday?: boolean };
export function resolveNativeSourceWindow(data:MarketDataSet,startDate:string,endDate:string,policy:NativeSourceInitialization) {
  if (!data.tqqqBars[0] || !data.qqqBars.length) throw new Error('QQQ/TQQQ inception is required for source initialization');
  const resolvedEndDate=[endDate,data.qqqBars.at(-1)!.date,data.tqqqBars.at(-1)!.date].sort()[0]!;
  const years=policy.fullCalendarYearsWarmup ?? 0;
  if (!Number.isInteger(years) || years < 0) throw new Error('Invalid source warm-up');
  let sourceStart=startDate;
  if(years){const warmup=`${Number(data.tqqqBars[0].date.slice(0,4))+years}-01-01`;sourceStart=warmup>sourceStart?warmup:sourceStart;}
  if(policy.alignMonday){const value=new Date(`${sourceStart}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+(8-value.getUTCDay())%7);sourceStart=value.toISOString().slice(0,10);}
  return {sourceStart,resolvedEndDate};
}
export function createNativeSourceSpec(data:MarketDataSet,startDate:string,endDate:string,policy:NativeSourceInitialization,
  options:{config?:BacktestRunSpec['config'];strategyOverrides?:BacktestRunSpec['strategyOverrides']}={}) {
  if(policy.replayVariant !== 'bass2_3_3' && policy.replayVariant !== 'v1_2_6' && policy.replayVariant !== 'v1_2_7_b')
    throw new Error(`Unsupported native source variant: ${policy.replayVariant}`);
  const window=resolveNativeSourceWindow(data,startDate,endDate,policy);
  const bass=policy.replayVariant === 'bass2_3_3';
  const rescue=policy.replayVariant === 'v1_2_7_b';
  const strategyOverrides: Partial<StrategyParams> = {
    enablePCS: true, pcsMode: 'reactive', pcsStockDecisionFilterMode: 'reactive_pcs_v1',
    pcsProbabilityReferenceExitMode: 'hold_to_expiry', enableCollar: false, enableCS: false,
    enableIC: false, enableBearOverlay: false, enableEquityBoostPCS: bass,
    pcsTargetDte: 35, pcsSpreadWidthPct: .03, pcsExcludeRiskOnWeakening: false, pcsBass221Gate: false,
    ...(bass ? {
      equityBoostBass221Gate: true, equityBoostBass221VixReboundGate: true, equityBoostBass221SeverityMultiplier: .5,
      pcsV11Gate: false, pcsBass232Candidate2Gate: false, pcsBass232Candidate3Gate: true,
      pcsV11ReleaseMode: 'sr02_adx20' as const,
      equityBoostEntryMode: 'continuous' as const, equityBoostDteMode: 'risk_adaptive_hysteresis_v1' as const,
      equityBoostTargetDte: 35 as const, equityBoostDynamicDteVxnThreshold: 24,
      equityBoostDynamicDteRecoveryVxnThreshold: 21, equityBoostDynamicDteMinHighRiskDays: 5,
      equityBoostExcludeRangeBoundSr02: true, equityBoostExcludeRiskOnExtendedSr01: true,
      equityBoostExcludeSidewaysSr01: true, equityBoostPriceVsSma200Ceiling: .1275, equityBoostVxnCeiling: 24,
      equityBoostRiskOnWeakeningSr01VxnVixRatioCeiling: 1.3, equityBoostRiskOnWeakeningSr01RequireVxn10dRising: true,
      equityBoostCandidate6Mdd: true, equityBoostWidthMode: 'risk_adaptive_v1' as const,
      equityBoostDynamicWidthVxnThreshold: 24, equityBoostDynamicWidthLowVxnTargetPct: .04,
      equityBoostDynamicWidthHighVxnTargetPct: .04, equityBoostRatioMin: .6, equityBoostRatioMax: 1.4,
    } : {
      pcsV11Gate: false, pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' as const,
      pcsV12Gate: false, pcsV121Gate: true, pcsV122Gate: false, pcsV123Gate: true,
      pcsV123B30ReleaseLower: .38, pcsBass232Candidate2Gate: false, pcsBass232Candidate3Gate: false,
      pcsResearchProfile: rescue ? 'candidateARescue' as const : 'candidate3' as const,
      pcsCandidate3ExtraRelease: rescue ? 'off' as const : 'bull_sr02_rv_adx' as const,
      ...(rescue ? {pcsRiskEnvelopeMode: 'candidate4_v1' as const,
        pcsRiskEnvelopeProfile: 'candidate4_full_only_v1' as const,
        pcsResearchSafetyOverride: 'allow_backwardation_only' as const} : {}),
    }),
    pcsV12Gate: false, pcsV121Gate: true, pcsV122Gate: false, pcsV123Gate: true,
    ...NATIVE_SOURCE_SELECTION_V1,
    ...options.strategyOverrides,
  };
  const strategyParams={...NATIVE_SOURCE_PARAMETERS_V1,...strategyOverrides};
  if(strategyOverrides.pcsContractProfile !== undefined &&
    (strategyOverrides.pcsSurvivalPriceSelectionMode === undefined || strategyOverrides.pcsSurvivalPriceSelectionMode === 'off')) {
    strategyParams.pcsSurvivalPriceSelectionMode='off';
    strategyParams.pcsTargetDte=undefined;
    strategyParams.pcsSpreadWidthPct=undefined;
  }
  strategyParams.csMaxTotalRiskNav ??= .215;
  const config: BacktestRunSpec['config'] = {
    initialCapital: 100_000, startDate: window.sourceStart, endDate: window.resolvedEndDate,
    timeframe: '1d', useMockOptions: true, includeTerminalMarkOnly: true, appendTerminalPcsOpen: true,
    realExpiryCalendar: true, realStrikeGrid: true, optionUnderlyingSymbol: 'QQQ',
    optionsBacktestPositionMode: {pcs: 'independent',...(bass ? {eb: 'independent' as const} : {})},
    trace: true,...(!bass ? {canonicalPcsCandidate2Gate: true} : {}),...options.config,
  };
  const spec: ResolvedBacktestRunSpec = structuredClone({
    version: 1, preset: 'neutral', universeId: 'nasdaq-tqqq', signalSymbol: 'QQQ', dataSource: {kind: 'live'},
    config: {
      initialCapital: config.initialCapital ?? 100_000, minBarHistory: config.minBarHistory ?? 200,...config,
      leveragedSymbol: 'TQQQ', universeId: 'nasdaq-tqqq', signalSymbol: 'QQQ',
      volIndex: config.volIndex ?? 'VXN', riskVolIndex: config.riskVolIndex ?? 'VIX',
      useMockOptions: config.useMockOptions ?? true, includeTerminalMarkOnly: config.includeTerminalMarkOnly ?? true,
      realExpiryCalendar: config.realExpiryCalendar ?? true, realStrikeGrid: config.realStrikeGrid ?? true,
      timeframe: config.timeframe ?? '1d', trace: config.trace, strategyParams,
    },
    strategyOverrides, scenarioOptions: {macroExecutionDriver: 'slow-macro', slowSubregimeDiagnostics: true},
    mode: 'single', macroExecutionDriver: 'slow-macro',
  });
  return {...window,spec};
}
