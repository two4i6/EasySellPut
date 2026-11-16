import type { MarketInput } from './types/input';
import type { SystemOutput } from './types/output';
import type { PipelineContext, EngineResult, OverlayData } from './types/pipeline';
import { navDrawdownGovernorTiers } from './types/params';

import { runDataQualityGate } from './engines/01-data-quality-gate';
import { runHardRiskRules } from './engines/02-hard-risk-rules';
import { runMarketRegime } from './engines/03-market-regime';
import { runTrendFollowing } from './engines/04-trend-following';
import { runVolatilityTarget } from './engines/05-volatility-target';
import { runRiskBudget } from './engines/06-risk-budget';
import { runDrawdownGovernor } from './engines/06a-drawdown-governor';
import { runIntradayRiskGate } from './engines/06b-intraday-risk-gate';
import { runTailRiskGovernor } from './engines/06c-tail-risk-governor';
import { runConflictResolver } from './engines/08-conflict-resolver';
import { runExecutionGuard } from './engines/09-execution-guard';
import { runOrderProposal } from './engines/10-order-proposal';
import { updateFlashCrashState, updateTailRiskState } from './engines/crisis-state-machine';
import { buildLeveragedOverlayFactorMap, getLeveragedOverlayStockPolicy, type AppendOnlyPriceSeriesValidationCache } from './stock-policy';
import { calcLatestBarROC } from './utils';
import { isCallCreditSpreadPreCrisis, resolveCallCreditSpreadRegimeRiskMultiplier, resolveCallCreditSpreadVixRiskMultiplier } from './v2/strategies/standalone-policy-gates-v1';

function collectAll(ctx: PipelineContext): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const r of Object.values(ctx.results)) {
    if (r) {
      blockers.push(...r.blockers);
      warnings.push(...r.warnings);
    }
  }
  return { blockers, warnings };
}

function resolveSystemStatus(
  ctx: PipelineContext,
  blockers: string[]
): SystemOutput['systemStatus'] {
  const dataOk = ctx.results.dataQuality?.status !== 'BLOCK' && ctx.results.dataQuality?.status !== 'ERROR';
  if (!dataOk) return 'DATA_ERROR';
  if (blockers.length > 0) return 'RISK_OFF';
  const hasWarnings = Object.values(ctx.results).some(r => r?.status === 'WARN');
  return hasWarnings ? 'DEGRADED' : 'ACTIVE';
}

export type PipelineStageProfiler = { record: (phase: string, milliseconds: number) => void };
export type PipelineRunOptions = {
  profiler?: PipelineStageProfiler;
  /** Only for replay-owned arrays that are append-only for the run lifetime. */
  appendOnlyPriceSeriesValidationCache?: AppendOnlyPriceSeriesValidationCache;
};

export type OverlayPipelineStage = (ctx: PipelineContext) => EngineResult<OverlayData>;

export function runPipelineWithOverlay(
  input: MarketInput,
  overlayStage: OverlayPipelineStage,
  options: PipelineRunOptions = {},
  stockPolicyDecision: typeof getLeveragedOverlayStockPolicy = getLeveragedOverlayStockPolicy,
): SystemOutput {
  const ctx: PipelineContext = { input, results: {} };
  const timed = <T>(phase: string, task: () => T): T => {
    if (!options.profiler) return task();
    const started = performance.now();
    const result = task();
    options.profiler.record(`pipeline.${phase}`, performance.now() - started);
    return result;
  };

  // ── Sequential pipeline (order matters: upper gates block lower) ──────────
  ctx.results.dataQuality    = timed('dataQuality', () => runDataQualityGate(ctx));
  ctx.results.regime         = timed('regime', () => runMarketRegime(ctx));
  ctx.currentFlashCrashState = timed('flashCrashState', () => updateFlashCrashState(
    input.flashCrashState,
    input.prices.QQQ,
    input.macro.vix,
    input.macro.vix3m,
    input.strategyParams,
    input.date,
  ));
  ctx.currentTailRiskState = timed('tailRiskState', () => updateTailRiskState(
    input.tailRiskState,
    input.tailRiskRawTrigger === true,
    input.strategyParams,
    input.date,
  ));
  const stockPolicyFactors = timed('stockPolicy.factorMap', () => buildLeveragedOverlayFactorMap(ctx, options.appendOnlyPriceSeriesValidationCache));
  ctx.stockPolicy = timed('stockPolicy.decision', () => stockPolicyDecision(stockPolicyFactors));
  ctx.results.hardRisk       = timed('hardRisk', () => runHardRiskRules(ctx));
  ctx.results.trend          = timed('trend', () => runTrendFollowing(ctx));
  ctx.results.volTarget      = timed('volTarget', () => runVolatilityTarget(ctx));
  ctx.results.riskBudget     = timed('riskBudget', () => runRiskBudget(ctx));
  if (navDrawdownGovernorTiers(input.strategyParams?.navDrawdownGovernor).length > 0) {
    ctx.results.drawdownGovernor = timed('drawdownGovernor', () => runDrawdownGovernor(ctx)); // mutates riskBudget.data when triggered
  }
  if (input.strategyParams?.tailRiskOverride) {
    ctx.results.tailRiskGovernor = timed('tailRiskGovernor', () => runTailRiskGovernor(ctx)); // mutates riskBudget.data when triggered
  }
  ctx.results.intradayGate   = timed('intradayGate', () => runIntradayRiskGate(ctx)); // mutates riskBudget.data when triggered

  // 2026-07-22 研究 opt-in（未采纳，禁止设为 preset 默认）：tail-risk 信号触发期间临时强制开启
  // Collar（protective put，可选 covered call）。仅在 tailRiskCollarOverride 配置且当前
  // currentTailRiskState.active 时覆盖 enableCollar/collarMode；不活跃时完全不影响原有 enableCollar
  // 配置（通常研究基线是 false）。覆盖只作用于 ctx.input（下游 runOverlay/conflict/execution/order
  // 消费的是 ctx.input），不改变调用方持有的原始 input 引用。
  if (input.strategyParams?.tailRiskCollarOverride && ctx.currentTailRiskState?.active) {
    ctx.input = {
      ...ctx.input,
      strategyParams: {
        ...input.strategyParams,
        enableCollar: true,
        collarMode: input.strategyParams.tailRiskCollarOverride.collarMode ?? 'always',
        collarLegMode: input.strategyParams.tailRiskCollarOverride.legMode ?? 'both',
      },
    };
  }
  const p = ctx.input.strategyParams;
  const stockOnly = p?.enableCollar === false && p.enableCS === false && p.enablePCS === false
    && p.enableIC === false && p.enableBearOverlay === false && p.enableEquityBoostPCS === false
    && (input.account.optionPositions?.length ?? 0) === 0;
  ctx.results.overlay = stockOnly ? {
    engineId: 'Overlay', status: 'PASS',
    data: { action: 'NONE', collar_triggered: false, call_spread_triggered: false, iron_condor_triggered: false, bear_call_spread_triggered: false },
    warnings: [], blockers: [],
  } : timed('overlay', () => overlayStage(ctx));
  ctx.results.conflicts      = timed('conflicts', () => runConflictResolver(ctx));
  ctx.results.executionGuard = timed('executionGuard', () => runExecutionGuard(ctx));

  const orderResult = timed('orderProposal', () => runOrderProposal(ctx));
  const { blockers, warnings } = collectAll(ctx);
  warnings.push(...orderResult.warnings);

  const systemStatus = resolveSystemStatus(ctx, blockers);

  const regime = ctx.results.regime?.data.regime ?? 'SIDEWAYS';
  const regimeData = ctx.results.regime?.data;
  const trend = ctx.results.trend?.data.signal ?? 'NEUTRAL';
  const tqqqVol = ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? 0;
  const vix = ctx.input.macro.vix;
  const vix3m = ctx.input.macro.vix3m;
  const vixSlope = vix != null && vix3m != null ? vix3m - vix : undefined;
  const slowState = ctx.input.slowSubregimeFactors?.slow_subregime_state;
  const slowSubregime = typeof slowState?.value === 'string' ? slowState.value : undefined;
  const slowPosterior = slowSubregime === 'SR02'
    ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr02?.value
    : slowSubregime === 'SR01'
      ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr01?.value
      : undefined;
  const slowHealth = ctx.input.slowSubregimeFactors?.slow_subregime_data_health?.value;
  const tqqqRoc20 = calcLatestBarROC(ctx.input.prices.TQQQ, 20);
  const csPreCrisisActive = isCallCreditSpreadPreCrisis({
    regime,
    vix,
    tqqqRealisedVol20d: tqqqVol,
    tqqqRoc20,
    vixMax: input.strategyParams?.csPreCrisisVixMax,
    tqqqRealisedVol20dMin: input.strategyParams?.csPreCrisisTqqqRv20Min,
    tqqqRoc20Max: input.strategyParams?.csPreCrisisTqqqRoc20Max,
  });
  const csEventRiskMultiplier = (csPreCrisisActive
    ? Math.min(1, Math.max(0, input.strategyParams?.csPreCrisisRiskMultiplier ?? 1))
    : 1)
    * resolveCallCreditSpreadRegimeRiskMultiplier({ regime, multipliers: input.strategyParams?.csRiskMultiplierByRegime })
    * resolveCallCreditSpreadVixRiskMultiplier({
      vix,
      minVix: input.strategyParams?.csResearchRiskMultiplierVixMin,
      multiplier: input.strategyParams?.csResearchRiskMultiplierVixAbove,
    });
  const leveragedSymbol = ctx.input.leveragedSymbol ?? 'TQQQ';
  const currentLeveragedPrice =
    ctx.input.currentPrices?.leveraged ??
    ctx.input.optionChains?.[leveragedSymbol]?.spot ??
    ctx.input.prices.TQQQ.at(-1)?.close;

  const budget = ctx.results.riskBudget?.data;
  const overlay = ctx.results.overlay?.data;
  const drawdownGovernor = ctx.results.drawdownGovernor?.data;
  const intradayGate = ctx.results.intradayGate?.data;
  const nav = ctx.input.account.netLiquidation;
  const leveragedValue = ctx.input.account.positions
    .filter(p => p.symbol === leveragedSymbol)
    .reduce((sum, p) => sum + p.marketValue, 0);
  const boxxValue = ctx.input.account.positions
    .filter(p => p.symbol === 'BOXX')
    .reduce((sum, p) => sum + p.marketValue, 0);

  return {
    timestamp: new Date().toISOString(),
    priceDate: ctx.input.prices.QQQ.at(-1)?.date,
    systemStatus,
    stockPolicyId: ctx.stockPolicy.value.id,
    reasonKeys: ctx.stockPolicy.value.reasonKeys,
    macroClassifier: input.strategyParams?.macroRegime?.classifier,
    bindingConstraint: budget?.binding_constraint,

      currentState: {
        regime,
        rawRegime: regimeData?.rawRegime,
        candidateRegime: regimeData?.regimeConfirmState?.candidateRegime,
        candidateBars: regimeData?.regimeConfirmState?.candidateBars,
        bearMarketPhase: regimeData?.bearMarketPhase,
      crisisPhase: regimeData?.crisisPhase,
      trend,
      macroRegime: ctx.input.macroRegimeState?.phase,
      slowSubregime,
      slowSubregimePosterior: typeof slowPosterior === 'number' ? slowPosterior : undefined,
      slowSubregimeHealth: typeof slowHealth === 'string' ? slowHealth : undefined,
      flashCrashOverrideActive: ctx.currentFlashCrashState?.active === true,
      tqqqRealisedVol20d: tqqqVol,
      vix,
      vixTermStructureSlope: vixSlope,
      sma20: regimeData?.sma20,
      sma50: regimeData?.sma50,
      sma200: regimeData?.sma200,
      roc5: regimeData?.roc5,
      leveragedSpot: currentLeveragedPrice,
      currentLeveragedPrice,
      distanceToSma20Pct: regimeData?.distanceToSma20Pct,
      distanceToSma50Pct: regimeData?.distanceToSma50Pct,

      // Extended indicators
      rsi14: regimeData?.rsi14,
      adx14: regimeData?.adx14,
      range20dPct: regimeData?.range20d_pct,
      priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
      ma50SlopePct: regimeData?.ma50_slope_pct,
      sma20SlopePct: regimeData?.sma20_slope_pct,
      vixChange5d: regimeData?.vix_change_5d,
      drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
      priceExtensionAtr: regimeData?.price_extension_atr,
      qqqEr20: ctx.results.volTarget?.data.qqq_er20,
      weakeningSignalCount: regimeData?.weakening_signal_count,
      roc20: ctx.results.trend?.data.roc20,
      tqqqRoc20,
      ...(csPreCrisisActive ? { csPreCrisisActive: true, csEventRiskMultiplier } : {}),
      trendScore: ctx.results.trend?.data.score,

      navDrawdownGovernorTriggered: drawdownGovernor?.triggered,
      navDrawdownGovernorFactor: drawdownGovernor?.factor,
      navDrawdownPct: drawdownGovernor?.drawdownPct,

      intradayReturnPct: intradayGate?.intradayReturnPct,
      intradayDeRiskTriggered: intradayGate?.triggered,
      intradayDeRiskFactor: intradayGate?.keepFactor,
      intradayMatchedDropPct: intradayGate?.matchedDropPct,
    },

    targetAllocation: {
      boxxPct: budget?.final_boxx_pct ?? 0,
      tqqqPct: budget?.final_tqqq_pct ?? 0,
      cashPct: budget?.final_cash_pct ?? 0.05,
    },

    currentAllocation: {
      boxxPct: nav > 0 ? boxxValue / nav : 0,
      tqqqPct: nav > 0 ? leveragedValue / nav : 0,
      cashPct: nav > 0 ? ctx.input.account.cash / nav : 1,
    },

    proposals: orderResult.data.proposals,

    overlay: {
      action: overlay?.action ?? 'NONE',
      overlay_type: overlay?.overlay_type,
      description: overlay?.action !== 'NONE'
        ? overlay?.action === 'ADD_COLLAR'
          ? overlay?.proposed_strikes?.call_strike
            ? `Put Spread Collar（${overlay?.proposed_strikes?.call_symbol ?? 'LEV'}，coveredOverlay）：Covered Call@${overlay?.proposed_strikes?.call_strike} | Long Put@${overlay?.proposed_strikes?.put_strike ?? '—'} | Short Put@${overlay?.proposed_strikes?.put_spread_short_strike ?? '—'} | exp ${overlay?.proposed_strikes?.expiry ?? '—'}`
            : `Put Spread Protection（${overlay?.proposed_strikes?.call_symbol ?? 'LEV'}，coveredOverlay）：无 Call 腿 | Long Put@${overlay?.proposed_strikes?.put_strike ?? '—'} | Short Put@${overlay?.proposed_strikes?.put_spread_short_strike ?? '—'} | exp ${overlay?.proposed_strikes?.expiry ?? '—'}`
          : overlay?.action === 'ADD_IRON_CONDOR'
          ? `Iron Condor（QQQ，proxyOverlay，RANGE_BOUND）：Put@${overlay?.proposed_strikes?.ic_put_long}/${overlay?.proposed_strikes?.ic_put_short} | Call@${overlay?.proposed_strikes?.ic_call_short}/${overlay?.proposed_strikes?.ic_call_long}, exp ${overlay?.proposed_strikes?.expiry}`
          : overlay?.action === 'OPEN_BEAR_CALL_SPREAD'
          ? `QQQ Bear Call Spread（proxyOverlay，defined-risk）：Short@${overlay?.bearCallSpread?.shortCallStrike ?? overlay?.proposed_strikes?.spread_short_strike}, Long@${overlay?.bearCallSpread?.longCallStrike ?? overlay?.proposed_strikes?.spread_long_strike}, exp ${overlay?.bearCallSpread?.expiry ?? overlay?.proposed_strikes?.expiry}`
          : overlay?.action === 'REVIEW_BEAR_CALL_SPREAD'
          ? `Bear Call Spread Overlay 需要复核：${overlay?.bearCallSpread?.reason ?? '仓位 metadata 不完整'}`
          : overlay?.action === 'SKIP_BEAR_CALL_SPREAD'
          ? `Bear Call Spread Overlay 跳过：${overlay?.bearCallSpread?.reason ?? '条件不满足'}`
          : overlay?.action === 'ADD_PUT_CREDIT_SPREAD'
          ? `Put Credit Spread（QQQ，proxyOverlay）：Long@${overlay?.proposed_strikes?.spread_long_strike}, Short@${overlay?.proposed_strikes?.spread_short_strike}, exp ${overlay?.proposed_strikes?.expiry}`
          : overlay?.action === 'ADD_PCS_RESCUE'
          ? `PCS_RESCUE（QQQ，proxyOverlay，独立补位）：Long@${overlay?.proposed_strikes?.spread_long_strike}, Short@${overlay?.proposed_strikes?.spread_short_strike}, exp ${overlay?.proposed_strikes?.expiry}`
          : `Call Credit Spread（QQQ，proxyOverlay，RISK_ON_EXTENDED）：Short@${overlay?.proposed_strikes?.spread_short_strike}, Long@${overlay?.proposed_strikes?.spread_long_strike}, exp ${overlay?.proposed_strikes?.expiry}`
        : undefined,
      proposed_strikes: overlay?.proposed_strikes,
      premium_estimate: overlay?.premium_estimate,
      iron_condor_max_risk_pct: overlay?.iron_condor_max_risk_pct,
      cs_max_risk_pct: overlay?.cs_max_risk_pct,
      collar: overlay?.collar,
      callCreditSpread: overlay?.callCreditSpread,
      putCreditSpread: overlay?.putCreditSpread,
      ...(overlay?.pcsRescuePutSpread ? { pcsRescuePutSpread: overlay.pcsRescuePutSpread } : {}),
      pcsPriceSelection: overlay?.pcsPriceSelection,
      ...(input.mode === 'backtest' ? { pcsGateDiagnostics: overlay?.pcsGateDiagnostics } : {}),
      ironCondor: overlay?.ironCondor,
      bearCallSpread: overlay?.bearCallSpread,
      collarEligibility: overlay?.collarEligibility,
      overlayProposals: overlay?.overlayProposals,
      strategyAdmissions: overlay?.strategyAdmissions,
      preferredAction: overlay?.preferredAction,
      alternativeAction: overlay?.alternativeAction,
    },

    pipeline: {
      ...ctx.results,
      stockPolicy: ctx.stockPolicy,
      orderProposal: orderResult,
      currentTailRiskState: ctx.currentTailRiskState,
    } as Record<string, unknown>,
    blockers,
    warnings,
  };
}
