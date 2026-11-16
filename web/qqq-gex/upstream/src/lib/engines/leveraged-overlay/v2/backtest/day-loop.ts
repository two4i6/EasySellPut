// v2 日循环实现；旧路径仅作兼容再导出。
import { performance } from 'node:perf_hooks';
import {createNativeDecisionObservationEngine,type NativeDecisionObservation} from './native-decision-observation-v1';
export type {NativeDecisionObservation} from './native-decision-observation-v1';
import type { OHLCV, CSBreachState, CSEventRiskState, OptionChain, PcsDynamicEntryProfile, PcsDynamicMarketState, PcsStreakState, SplitEvent } from '../../types/input';
import type { FinancialFactor } from '../../../../../types/factor';
import type { CSConditionalGateTrace } from '../../backtest/types';
import type { MarketEnvironmentSnapshot, SystemOutput } from '../../types/output';
import { createRollingIndicators, findNearestExpiry } from '../../utils';
import { computeRawCrisis, transitionCrisis, updateTailRiskState, type CrisisState } from '../../engines/crisis-state-machine';
import { advanceW7MacroRegime, advanceW9MacroRegime, advanceW10MacroRegime, advanceW11MacroRegime, computeWeeklyVoteFromDailyEngine, computeHybridVote, isoWeek, transitionMacroRegime, type W9MacroRegimeState } from '../../engines/macro-regime-state';
import { buildTradingDayDateIndex, computeEquityWhipsawMetrics, computeMetrics } from '../../backtest/metrics';
import { computeOptionCycleDebug } from '../../backtest/attribution';
import { buildMockOptionChain, bs, ivAt, optionQuote, dividendYieldForSymbol, effectiveVix, liquidityAt, listedExpiries, normalizeVolIndexForMockOptions, splitAdjustmentFactor, strikesFor } from '../../backtest/mockOptions';
import { MOCK_OPTION_CALIBRATION } from '../../backtest/mockOptionCalibration';
import { evaluateExitConditions } from '../../exitConditions';
import { closeIronCondorAtMark, evaluateIronCondorExit, finalizeIronCondor, openIronCondorFill, type IronCondorPosition } from '../strategies/iron-condor';
import { buildCallCreditSpreadCloseTrade, callCreditSpreadTradeMeta, closeCallCreditSpreadAtMark, evaluateCallCreditSpreadExit, finalizeCallCreditSpread, isCallCreditSpreadEventRiskScoped, isCallCreditSpreadExtendedLowVix, isCallCreditSpreadFastAcceleration, isCallCreditSpreadRiskOnExtended, isCallCreditSpreadSlowTrend, isCallCreditSpreadDeltaAcceleration, resolveCallCreditSpreadDaysHeldRiskThreshold, resolveCallCreditSpreadDeltaStopThreshold, resolveCallCreditSpreadMaxLossDollars, shouldTriggerCallCreditSpreadDeltaStop, updateCSBreachStateOnClose, type CallCreditSpreadPosition, type CallSpreadKind } from '../strategies/call-credit-spread';
import { evaluateWr89Entry, isWr90ConditionalBlock } from '../strategies/cs-wr89-controller';
import { buildPutCreditSpreadOpen, buildPutCreditSpreadOpenNearestFeasibleExpiry, closePutCreditSpreadAtMark, evaluatePutCreditSpreadExit, finalizePutCreditSpread, putCreditSpreadTradeMeta, settlePutCreditSpread, updatePcsStreakStateOnClose, type PutCreditSpreadPosition } from '../strategies/put-credit-spread';
import { createEquityBoostDteHysteresisState, equityBoostFillEconomics, updateEquityBoostDteHysteresisState } from '../strategies/equity-boost-put-spread';
import { advanceCollarExitState, buildCollarLifecyclePosition, calculateCollarOpen, closeCollarAtMark as closeV2CollarAtMark, collarOpenReasonKey, evaluateCollarExit, finalizeCollar, recordCollarLifecycleClose, shouldBlockOverheatCollar, type CollarLifecyclePosition } from '../strategies/collar';
import { applyOptionExecution, clampDefinedRiskQuantity, executeScheduledOptionClose, findOptionContract, openCreditSpreadFill, optionCommission, optionExecutionImpact, optionOutcomeReasonKey as getOptionOutcomeReasonKey, type OptionLifecycleEffect } from '../options';
import { OverlayBook } from '../book';
import { findOverlayProposal } from '../coordinator';
import { executePendingEquityOrders, resolveEquityOrderFill, type PendingEquityOrder } from './equity-execution';
import { resolvePcsFillFallbackPairSearchMode } from './pcs-fill-fallback-pair-search';
import { passesBullSr01VixFallbackRelease, resolvesBullSr01FillFallbackAllowed } from './pcs-fill-fallback-admission';
import { createPortfolioState, type PortfolioState } from './execution-state';
import { advanceDecisionView, annualizedRvPct, barDateKey, createDecisionViewState, drawdownFromHighPct, hasThreeStrongUpDays, isDailyDecisionBar, rangeAtEnd, resolvePrevVix, rocAtEnd, smaAtEnd } from './decision-view';
import { applyMacroBoostBlock, runBacktestPipeline } from './pipeline';
import { buildEquityPoint, buildTraceEntry } from './snapshot';
import { optionProposalsFromCanonicalTape } from './canonical-option-signal-tape';
import { usesPcsContractProfileFactor } from '../strategies/pcs-contract-profile';
import { buildStateGridAudit } from '../../backtest/state-grid-audit';
import { createDecisionMemoryState, updateDecisionMemory } from './decision-memory';
import { buildBoxxPriceResolver } from './boxx-price';
import { computeStrikeSurvivalAtAsOf, CallStrikeSurvivalAsOf, PutStrikeSurvivalAsOf, SellerStatsAsOf, type StrikeSurvivalAsOf } from '../../../analysis/SellerStatsEngine';
import { getOverlayUniverse } from '../../universe';
import { resolveOverlayDefaults } from '../defaults';
import { pcsSurvivalTouchExitReason } from './pcs-survival-exit';
import type { BacktestConfig, BacktestResult, BacktestTraceEntry, CollarLifecycleDebug, EquityPoint, OptionRiskBudgetAttempt, OptionRiskBudgetTrace, PcsPathDiagnostic, SlowSubregimeDiagnostic, TradeEntry } from '../../backtest/types';
import type { MacroExecutionDriver, PCSProbabilityReferenceExitMode, PCSSurvivalExitMode } from '../../types/params';
import type { OverlayProposal } from '../../types/pipeline';
import { resolveSlowSubregimeDiagnostic } from '../../slow-subregime-runtime';
import {
  IC_MODE_CONFIG,
  IC_PROFIT_TARGET_DEFAULT,
  CS_EARLY_EXIT_DELTA,
  CS_PROFIT_TARGET_DEFAULT,
  PCS_DELTA_STOP_DEFAULT,
  PCS_PROFIT_TARGET_DEFAULT,
  COLLAR_EXIT_DTE,
  COLLAR_CALL_EXIT_DELTA,
  COLLAR_CALL_EXIT_DELTA_OVERHEAT,
  COLLAR_LONG_PUT_EXIT_DELTA,
  COLLAR_STOP_PER_CONTRACT,
  COLLAR_DRAWDOWN_PERIOD_EXIT,
  COLLAR_DRAWDOWN_RECOVERY,
  COLLAR_VIX_REGIME_EXIT,
  BEAR_CS_DTE_EXIT,
  BEAR_CS_DELTA_EXIT,
  BEAR_CS_ROC5_EXIT,
  BEAR_CS_STOP_LOSS_CREDIT_MULT,
  BEAR_CS_STOP_LOSS_MAX_LOSS_PCT,
  BEAR_CS_PROFIT_TARGET_DEFAULT,
  IC_TARGET_DTE,
  SPREAD_TARGET_DTE,
  COLLAR_TARGET_DTE,
  MIN_POST_BEAR_DAYS,
  VIX_FALLBACK,
  OVERLAY_STRATEGY_TAGS,
  EQUITY_BOOST_RATIO_MIN,
  EQUITY_BOOST_RATIO_MAX,
  CS_MAX_TOTAL_RISK_NAV,
} from '../../constants';

// Pending Iron Condor position
type PendingIC = IronCondorPosition & {
  openedAt: string;
  putWidth: number;
  callWidth: number;
  range20dHigh: number;  // 20d high at IC open — range breach exit trigger
  range20dLow: number;   // 20d low at IC open
  exitScheduled?: boolean;
  marketContext?: MarketEnvironmentSnapshot;
};

// Collar: protect TQQQ position with long put spread plus optional short call
// Quantity = floor(leveragedShares / 100) — one collar per 100 shares held

// Pending Collar (long put spread plus optional short call wrapping TQQQ position)
type PendingCollar = CollarLifecyclePosition;

// Pending Call Spread (bear call credit spread: short lower call + long higher call)
type PendingCallSpreadBase = CallCreditSpreadPosition & {
  exitScheduled?: boolean;
  marketContext?: MarketEnvironmentSnapshot;
};

type PendingCS = PendingCallSpreadBase;
type PendingPCS = PutCreditSpreadPosition & Pick<PendingCallSpreadBase, 'exitScheduled' | 'marketContext'> & {
  openedAt?: string;
  probabilityReferences?: { risk: number; realization: number };
  pathDiagnostic?: PcsPathDiagnostic;
};
// Equity Boost Put Spread: short ITM put + long OTM put, same shape as PendingPCS
// (short/long strike + quantity + credit + width) — settlement math is symmetric in
// strike ordering, so the generic PCS settle/mark/close helpers are reused as-is.
type PendingEquityBoost = PutCreditSpreadPosition & Pick<PendingCallSpreadBase, 'exitScheduled' | 'marketContext'> & {
  /** 独立单笔回放无法用半张合约表达，按入场时风险倍率缩放已实现 P&L。 */
  riskMultiplier?: number;
};

type PendingBearCallSpread = PendingCallSpreadBase & {
  openedAt: string;
  maxLoss: number;
};

function callSpreadLayerLabel(cs: CallCreditSpreadPosition): string {
  if (cs.route !== 'secondary_budget') return '主策略';
  if (cs.tier === 'pre_crisis_coverage') return '独立副层·预危机覆盖层';
  if (cs.tier === 'normal_coverage') return '独立副层·普通覆盖层';
  return '独立副层';
}

type PcsProfileDiagnostic = {
  profile: string;
  signalDate: string;
  reason: 'DYNAMIC_CONTRACT_UNBUILDABLE';
  detail: 'live_overlay_proposal_missing';
};

function recordPcsPathBar(pcs: PendingPCS, bar: OHLCV): void {
  const path = pcs.pathDiagnostic;
  if (!path || !pcs.openedAt || pcs.openedAt >= bar.date) return;
  if (path.firstTouchDate === undefined && bar.low <= pcs.shortStrike) path.firstTouchDate = bar.date;
  if (path.firstCloseBreachDate === undefined && bar.close <= pcs.shortStrike) path.firstCloseBreachDate = bar.date;
}

function definedRiskDollars(position: { quantity: number; width: number; creditReceived: number }): number {
  return Math.max(0, position.quantity * position.width * 100 - position.creditReceived);
}

function ironCondorRiskDollars(position: PendingIC): number {
  return Math.max(0, position.quantity * Math.max(position.putWidth, position.callWidth) * 100 - position.creditReceived);
}

const collarName = (symbol: string) => `${symbol} Put Spread Collar`;
const ironCondorName = 'QQQ Iron Condor';

function buildDateIndex(bars: OHLCV[]): Map<string, number> {
  const m = new Map<string, number>();
  bars.forEach((b, i) => m.set(b.date, i));
  return m;
}

export { buildBoxxPriceResolver } from './boxx-price';

type PricingContext = {
  spreadMultiplier: number;
  skewSlope: number;
  riskFreeRate: number;
};

type IncrementalWeeklyBar = OHLCV & { vix?: number; vix3m?: number };

/** 与 resampleBars(daily, 'week') 等价，但当前周只累积到已见的日 bar。 */
function appendWeeklyBar(
  weekly: IncrementalWeeklyBar[],
  bar: OHLCV,
  latest: { vix?: number; vix3m?: number },
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
) {
  if (vixByDate[bar.date] != null) latest.vix = vixByDate[bar.date];
  if (vix3mByDate[bar.date] != null) latest.vix3m = vix3mByDate[bar.date];
  const prior = weekly[weekly.length - 1];
  if (!prior || isoWeek(prior.date) !== isoWeek(bar.date)) {
    weekly.push({ ...bar, vix: latest.vix, vix3m: latest.vix3m });
    return;
  }
  prior.high = Math.max(prior.high, bar.high);
  prior.low = Math.min(prior.low, bar.low);
  prior.close = bar.close;
  prior.volume += bar.volume;
  prior.date = bar.date;
  prior.vix = latest.vix;
  prior.vix3m = latest.vix3m;
}

/** macro weeklyBars 的历史语义是“周内最后一根日线”，不是 OHLC 聚合。 */
function appendWeeklyLastBar(
  weekly: IncrementalWeeklyBar[],
  bar: OHLCV,
  latest: { vix?: number; vix3m?: number },
) {
  const prior = weekly[weekly.length - 1];
  const next = { ...bar, vix: latest.vix, vix3m: latest.vix3m };
  if (!prior || isoWeek(prior.date) !== isoWeek(bar.date)) weekly.push(next);
  else weekly[weekly.length - 1] = next;
}

/**
 * 日循环阶段耗时分桶——纯测量用途，不影响任何回测行为/输出。
 * pipeline 桶覆盖 crisis/宏观状态推进 + FactorMap + VerdictEngine/DecisionEngine/coordinator
 * (runBacktestPipeline 单次调用)；v2 架构把 factor 计算与决策引擎调用融合进同一次
 * runPipeline 调用（src/lib/engines/leveraged-overlay/pipeline.ts，live 交易共用），
 * 日循环层面无法再细分，故不单列 factorCompute/decisionEngine 两桶。
 */
export type BacktestProfilePhase = 'decisionView' | 'chainLookup' | 'pipeline' | 'execution' | 'snapshot';
export type BacktestPhaseProfiler = { record: (phase: BacktestProfilePhase, ms: number) => void };

export type BacktestExecutionContext = {
  /** Research SDK only: pause the same chronological loop at its as-of observation seam. */
  yieldDecisionObservations?: boolean;
  /** Batch 内按同一数据坐标共享；只含输入派生索引，绝不含策略/账本状态。 */
  marketPrecompute?: ReadonlyMarketPrecompute;
  /** Parity diagnostic for the old full-history validation path. */
  appendOnlyPriceSeriesValidationCache?: boolean;
  /** 可选：逐日阶段耗时分析器。缺省时不产生任何 performance.now() 调用（零开销）。 */
  phaseProfiler?: BacktestPhaseProfiler;
  /** Research-only detailed pipeline profiling. */
  pipelineStageProfiler?: { record: (phase: string, ms: number) => void };
  macroExecutionDriver?: MacroExecutionDriver;
  slowSubregimeDiagnostics?: boolean;
  slowSubregimeByDate?: Record<string, SlowSubregimeDiagnostic>;
  /** 仅 batch 内共享的只读合成链；key 覆盖全部定价输入。 */
  mockOptionChainCache?: Map<string, OptionChain>;
  /** 仅 parity 测试保留旧全量重采样路径；生产默认增量周桶。 */
  incrementalWeeklyMacro?: boolean;
  /** 仅 parity 测试保留旧版“每个决策日双链”行为。 */
  lazyMockChains?: boolean;
  /** 仅 parity 测试保留 PCS 页面评分的逐日全量 SellerStats。 */
  incrementalSellerStats?: boolean;
  /** 仅 parity 测试保留 PCS 页面 VXN 历史的逐日全量重建。 */
  incrementalVxnHistory?: boolean;
  /** 仅 parity 测试保留 Call 生存率的逐日 prefix 全量重算。 */
  incrementalCallSurvival?: boolean;
  /** 仅 parity 测试保留 Put 生存率的逐日 prefix 全量重算。 */
  incrementalPutSurvival?: boolean;
  /** 精确匹配提案成交链的实验开关；默认仍走已验证的旧 DTE 回退，直到逐位 parity 锁定。 */
  preciseFillMockChains?: boolean;
  /** Research-only stateful PCS admission; one fresh profile per replay. */
  pcsDynamicEntryProfile?: PcsDynamicEntryProfile;
  /** 研究专用：按实际成交日覆写股票成交价。缺失或无效因子直接中止，绝不回退到开盘价。 */
  researchEquityFillPriceByDate?: Readonly<Record<string, Readonly<Record<string, FinancialFactor<number>>>>>;
};

export type ReadonlyMarketPrecompute = {
  qqqRolling: ReturnType<typeof createRollingIndicators>;
  tqqqRolling: ReturnType<typeof createRollingIndicators>;
  boxxPrices: ReturnType<typeof buildBoxxPriceResolver>;
  callStrikeSurvivalAsOf: CallStrikeSurvivalAsOf;
  putStrikeSurvivalAsOf: PutStrikeSurvivalAsOf;
};

/** 同一市场坐标的 arm 可复用，内部仅对不可变行情做惰性指标缓存。 */
export function createReadonlyMarketPrecompute(qqqBars: OHLCV[], leveragedBars: OHLCV[], boxxBars: OHLCV[] | undefined): ReadonlyMarketPrecompute {
  return {
    qqqRolling: createRollingIndicators(qqqBars),
    tqqqRolling: createRollingIndicators(leveragedBars),
    boxxPrices: buildBoxxPriceResolver(qqqBars, boxxBars),
    callStrikeSurvivalAsOf: new CallStrikeSurvivalAsOf(qqqBars),
    putStrikeSurvivalAsOf: new PutStrikeSurvivalAsOf(qqqBars),
  };
}

type MockChainContractRequest = { expiry: string; pricingDte: number; strikes: number[]; types: Array<'call' | 'put'> };
type MockDecisionContractRequest = { targetDte: number; types: Array<'call' | 'put'> };

/**
 * 日线合成 PCS 的建仓锚定参考线。尾部损失没有真实历史期权链可估，故以定义风险最大损失作保守 CVaR/条件损失代理。
 * 只用于研究退出，不参与 FactorMap → VerdictEngine → DecisionEngine 的开仓链。
 */
export function probabilityReferenceLevels(input: {
  spot: number;
  shortStrike: number;
  longStrike: number;
  creditPerShare: number;
  daysToExpiry: number;
  annualVol: number;
  riskFreeRate: number;
}) {
  const { spot, shortStrike, longStrike, creditPerShare, daysToExpiry, annualVol, riskFreeRate } = input;
  const width = shortStrike - longStrike;
  const maxLoss = width - creditPerShare;
  const expectedMove = spot * annualVol * Math.sqrt(Math.max(daysToExpiry, 1) / 365);
  // 用盈亏平衡点的合成 put delta 近似到期胜率；限制在开区间以避免退化线。
  const breakeven = shortStrike - creditPerShare;
  const winProbability = Math.max(.01, Math.min(.99, 1 + bs(spot, breakeven, Math.max(daysToExpiry / 365, 1 / 365), riskFreeRate, annualVol).putDelta));
  const expectedPremium = winProbability * creditPerShare;
  const expectedLoss = (1 - winProbability) * maxLoss;
  const denominator = expectedPremium + expectedLoss;
  if (!(spot > 0 && width > 0 && creditPerShare > 0 && maxLoss > 0 && expectedMove > 0 && denominator > 0)) return undefined;
  return {
    risk: breakeven - expectedMove * expectedLoss / denominator,
    realization: breakeven + expectedMove * expectedPremium / denominator,
  };
}

function probabilityReferenceExitReason(mode: PCSProbabilityReferenceExitMode, pcs: PendingPCS, low: number, high: number) {
  const references = pcs.probabilityReferences;
  if (!references) return null;
  if ((mode === 'risk_reference' || mode === 'both_references') && low <= references.risk) {
    return `概率风险参考线触发：日低 ${low.toFixed(2)} ≤ 建仓锁定 ${references.risk.toFixed(2)}`;
  }
  if ((mode === 'realization_reference' || mode === 'both_references') && high >= references.realization) {
    return `概率兑现参考线触发：日高 ${high.toFixed(2)} ≥ 建仓锁定 ${references.realization.toFixed(2)}`;
  }
  return null;
}

// Symbol-aware bid/ask: leveraged-ETF options (collar legs) trade much wider
// than QQQ index options (IC / call spreads). See optionSpreadPct.
function optionBidAsk(mid: number, symbol: string, pricing: PricingContext): { bid: number; ask: number } {
  return optionQuote(mid, symbol, pricing.spreadMultiplier);
}

function markICToMarket(ic: PendingIC, today: string, qqqClose: number, vix: number, pricing: PricingContext, vix3m?: number): number {
  return closeIronCondorAtMark(ic, today, qqqClose, vix, 'mark', pricing, vix3m).cashImpact;
}

function markCSToMarket(cs: PendingCS, today: string, qqqClose: number, vix: number, pricing: PricingContext, vix3m?: number): number {
  return closeCallCreditSpreadAtMark(cs, today, qqqClose, vix, 'mark', pricing, vix3m).cashImpact;
}

function markPCSToMarket(pcs: PendingPCS, today: string, qqqClose: number, vix: number, pricing: PricingContext, vix3m?: number): number {
  return closePutCreditSpreadAtMark(pcs, today, qqqClose, vix, 'mark', pricing, vix3m).cashImpact;
}

function markCollarToMarket(collar: PendingCollar, today: string, levClose: number, vix: number, leveragedSymbol: string, pricing: PricingContext, vix3m?: number, qqqClose = levClose, splitAdjustmentFactors?: Record<string, number>): number {
  return closeV2CollarAtMark(collar, today, levClose, vix, leveragedSymbol, 'mark', pricing, vix3m, qqqClose, splitAdjustmentFactors).cashImpact;
}

function optionDelta(
  symbol: string,
  type: 'call' | 'put',
  spot: number,
  strike: number,
  expiry: string,
  today: string,
  vix: number,
  pricing: PricingContext,
  skewSlope: number,
  vix3m?: number
): number {
  const daysLeft = Math.max((new Date(expiry).getTime() - new Date(today).getTime()) / 86400000, 0);
  const T = Math.max(daysLeft / 365, 1 / 365);
  const ev = effectiveVix(vix, vix3m, daysLeft);
  const q = dividendYieldForSymbol(symbol);
  const priced = bs(spot, strike, T, pricing.riskFreeRate, ivAt(ev, symbol, spot, strike, skewSlope), q);
  return type === 'call' ? priced.callDelta : priced.putDelta;
}

function isIntradayTimeframe(config: BacktestConfig): boolean {
  return config.timeframe != null && config.timeframe !== '1d';
}

// prevVix feeds "single-day VIX spike" checks (03-market-regime.ts, v2 coordinator) — must be
// the last COMPLETED day's VIX, not literally the previous bar. At intraday timeframes, bars[i-1]
// is the previous bar (e.g. previous hour), which would turn a 20%/day threshold into a 20%/bar
// one and fire on ordinary intrabar VIX noise. Exported for direct unit testing.
export { resolvePrevVix } from './decision-view';

export { applyMacroBoostBlock } from './pipeline';

/** Compatibility exhausts the identical loop; no change to default execution or orders. */
export function runBacktest(...args: Parameters<typeof iterateBacktest>): BacktestResult {
  const iterator = iterateBacktest(...args);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

/** No completed trace is replayed: each next() advances only to the next live decision. */
export function* iterateBacktest(
  qqqBars: OHLCV[],
  leveragedBars: OHLCV[],
  boxxBars: OHLCV[] | undefined,
  vixByDate: Record<string, number>,
  config: BacktestConfig,
  spyBars?: OHLCV[],
  vix3mByDate: Record<string, number> = {},
  pricingVolByDate?: Record<string, number>,
  vxnByDate?: Record<string, number>,
  splitEventsBySymbol: Record<string, FinancialFactor<SplitEvent[]>> = {},
  execution: BacktestExecutionContext = {},
): Generator<NativeDecisionObservation, BacktestResult, void> {
  if (config.strategyParams?.enablePCS === false) {
    const { enablePCS: _enablePCS, ...strategyParams } = config.strategyParams;
    config = { ...config, strategyParams };
  }
  if (config.strategyParams?.enableEquityBoostPCS === false) {
    const { enableEquityBoostPCS: _enableEquityBoostPCS, ...strategyParams } = config.strategyParams;
    config = { ...config, strategyParams };
  }
  const {
    initialCapital,
    slippagePct = 0.001,
    minBarHistory = 200,
    useMockOptions = false,
    includeTerminalMarkOnly = false,
    optionSpreadMultiplier = 1,
  } = config;
  const positionMode = config.optionsBacktestPositionMode;
  const independentPCS = (positionMode?.pcs ?? config.pcsBacktestPositionMode) === 'independent';
  const independentCS = positionMode?.cs === 'independent';
  const independentIC = positionMode?.ic === 'independent';
  const independentEquityBoost = positionMode?.eb === 'independent';
  const independentBearCS = positionMode?.bearCs === 'independent';
  const leveragedSymbol = (config.leveragedSymbol ?? 'TQQQ').toUpperCase();
  const proxySymbol = config.optionUnderlyingSymbol ?? getOverlayUniverse(config.universeId).optionSymbol;

  // Equity vol skew applied to BOTH the synthetic chain (opens) and the bs() marks/closes
  // so a strike is priced consistently across its life. Default 0.6 (see ivAt).
  const optionSkewSlope = config.optionSkewSlope ?? MOCK_OPTION_CALIBRATION.skewSlope;
  const riskFreeRate = config.riskFreeRate ?? 0.045;
  const pricing: PricingContext = {
    spreadMultiplier: optionSpreadMultiplier,
    skewSlope: optionSkewSlope,
    riskFreeRate,
  };

  // Intraday high/low stop detection (default off). When on, price-type stop /
  // breach / delta checks use the bar's adverse extreme instead of close; fills
  // still occur next-open via exitFillMode (daily bars lack intraday option px).
  const intrabarStops = config.intrabarStops ?? false;

  // #5/#6 realism knobs (all opt-in, default off → byte-identical to prior runs).
  const realExpiryCalendar = config.realExpiryCalendar ?? false;
  const realStrikeGrid     = config.realStrikeGrid ?? false;
  const liquidityModel     = config.liquidityModel ?? false;
  const slippageModel      = config.slippageModel ?? 'flat';
  // Shared opts threaded into every buildMockOptionChain call (opens).
  const chainOpts = { expiryCalendar: realExpiryCalendar, realStrikeGrid, liquidityModel };
  const splitEventsKeyBySymbol = new Map<string, string>();
  const chainConfigKey = [optionSpreadMultiplier, optionSkewSlope, riskFreeRate, realExpiryCalendar ? 1 : 0, realStrikeGrid ? 1 : 0, liquidityModel ? 1 : 0].join('|');
  const cachedMockChain = (date: string, spot: number, vol: number, symbol: string, vix3m: number | undefined, contracts?: MockChainContractRequest[], decisionContracts?: MockDecisionContractRequest[]): OptionChain => {
    const splitEvents = splitEventsFor(symbol);
    // Cache key covers every price/contract input without serializing JSON inside the daily hot loop.
    let splitKey = splitEventsKeyBySymbol.get(symbol);
    if (!splitKey) {
      splitKey = splitEvents.map(event => `${event.date}:${event.numerator}:${event.denominator}`).join(',');
      splitEventsKeyBySymbol.set(symbol, splitKey);
    }
    const contractsKey = contracts?.map(contract => `${contract.expiry}:${contract.pricingDte}:${contract.types.join(',')}:${contract.strikes.join(',')}`).join(';') ?? '';
    const decisionContractsKey = decisionContracts?.map(contract => `${contract.targetDte}:${contract.types.join(',')}`).join(';') ?? '';
    const key = `${chainConfigKey}|${symbol}|${date}|${spot}|${vol}|${vix3m ?? ''}|${splitKey}|${contractsKey}|${decisionContractsKey}`;
    const cached = execution.mockOptionChainCache?.get(key);
    if (cached) return cached;
    const chain = buildMockOptionChain(date, spot, vol, symbol, optionSpreadMultiplier, optionSkewSlope, { vix3m, riskFreeRate, ...chainOpts, splitEvents, contracts, decisionContracts });
    execution.mockOptionChainCache?.set(key, chain);
    return chain;
  };

  const fillExpiry = <T extends { date: string }>(expirations: T[] | undefined, expiry: string, targetDte: number, date: string): T | undefined => {
    const exact = expirations?.find(candidate => candidate.date === expiry);
    if (exact || execution.preciseFillMockChains === true || !expirations?.length) return exact;
    const nearest = findNearestExpiry(expirations, date, targetDte);
    return expirations.find(candidate => candidate.date === nearest);
  };

  // Preserve the legacy raw-chain source expiry (exact proposal expiry first,
  // then nearest target DTE), but generate only the eventual fill legs.
  const directFillContracts = (date: string, spot: number, symbol: string, contracts: MockChainContractRequest[]): MockChainContractRequest[] => {
    if (!contracts.length) return [];
    const base = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
    const candidates = realExpiryCalendar
      ? listedExpiries(date, 75, symbol).map(expiry => ({ date: expiry, dte: Math.round((Date.parse(`${expiry}T00:00:00Z`) - base) / 86_400_000) })).filter(candidate => candidate.dte > 0)
      : [28, 37, 45].map(dte => ({ date: new Date(base + dte * 86_400_000).toISOString().slice(0, 10), dte }));
    const splitFactor = splitFactorFor(symbol, date);
    const listedStrikes = new Set(strikesFor(symbol, spot * splitFactor, realStrikeGrid).map(strike => strike / splitFactor));
    const grouped = new Map<string, MockChainContractRequest>();
    for (const contract of contracts) {
      const prior = grouped.get(contract.expiry);
      if (prior) {
        for (const strike of contract.strikes) if (!prior.strikes.includes(strike)) prior.strikes.push(strike);
        for (const type of contract.types) if (!prior.types.includes(type)) prior.types.push(type);
      } else grouped.set(contract.expiry, { ...contract, strikes: [...contract.strikes], types: [...contract.types] });
    }
    return [...grouped.values()].map(contract => {
      const source = candidates.find(candidate => candidate.date === contract.expiry)
        ?? candidates.reduce((best, candidate) => Math.abs(candidate.dte - contract.pricingDte) < Math.abs(best.dte - contract.pricingDte) ? candidate : best);
      return { ...contract, pricingDte: source.dte, strikes: contract.strikes.filter(strike => listedStrikes.has(strike)) };
    });
  };

  // #5c: cap opening size to a fraction of the thinnest leg's modeled daily
  // volume. liquidityModel off → Infinity (no clamp, old behavior). Only opens
  // are constrained; closes assume we can always exit (no getting trapped).
  const LIQ_CAP_PCT = 0.10;
  const liqCap = (vol: number) => (liquidityModel ? Math.floor(vol * LIQ_CAP_PCT) : Infinity);

  // #6 slippage: square-root market impact + VIX stress, both opt-in via
  // slippageModel='impact'. stressMult is 1.0 at VIX 20, ~2.0 by VIX 60 (capped).
  const IMPACT_K = 0.1;
  const STRESS_CAP = 1.0;
  const stressMult = (vix: number) => 1 + Math.min(STRESS_CAP, Math.max(0, (vix - 20) / 40));
  // 20-bar rolling ADV from the given series; 0 when unavailable → impact term 0.
  const advFromBars = (bars: OHLCV[] | undefined, idxMap: Map<string, number> | null, date: string): number => {
    if (!bars || !idxMap) return 0;
    const j = idxMap.get(date);
    if (j == null) return 0;
    let sum = 0, n = 0;
    for (let k = Math.max(0, j - 19); k <= j; k++) {
      const v = bars[k]?.volume;
      if (v && v > 0) { sum += v; n++; }
    }
    return n > 0 ? sum / n : 0;
  };
  // Per-contract adverse option market impact (price units), proportional to
  // order size vs the strike's modeled volume, scaled by stress. 0 when flat.
  // Adverse $ impact when closing a position (always subtracted → reduces proceeds
  // / raises buyback cost). 0 when slippageModel='flat'. Uses modeled strike volume
  // when liquidityModel is on, else a constant fallback (per the design's mix-and-match).
  const closeImpactDollars = (sym: string, under: number, strike: number, qty: number, vix: number, contractMultiplier = 100, splitFactor = 1): number => {
    if (slippageModel !== 'impact' || qty <= 0) return 0;
    const vol = liquidityModel ? liquidityAt(sym, under, strike).vol : 500;
    return optionExecutionImpact({ enabled: slippageModel === 'impact', contracts: qty, strikeVolume: vol, vix }) * contractMultiplier / splitFactor * qty;
  };

  // Per-contract one-way commission. Charged on opens and real closes (early exits +
  // end-of-backtest forced closes); expiry settlement is free (worthless legs cost
  // nothing; broker exercise/assignment fees are ~0). Total $ for an N-leg trade.
  const commissionPerContract = config.commissionPerContract ?? 0.65;
  const optCommission = (legs: number, qty: number) => optionCommission(legs, qty, commissionPerContract);
  const splitEventsFor = (symbol: string) => splitEventsBySymbol[symbol]?.confidence ? splitEventsBySymbol[symbol].value : [];
  const splitFactorFor = (symbol: string, date: string) => splitAdjustmentFactor(date, splitEventsFor(symbol));
  const marketSplitFactors = (date: string) => ({ QQQ: splitFactorFor('QQQ', date), [leveragedSymbol]: splitFactorFor(leveragedSymbol, date) });

  const qqqIdx       = buildDateIndex(qqqBars);
  const leveragedIdx = buildDateIndex(leveragedBars);
  const boxxIdx      = boxxBars ? buildDateIndex(boxxBars) : null;
  const spyIdx       = spyBars ? buildDateIndex(spyBars) : null;

  const isIntradayBacktest = isIntradayTimeframe(config);
  const resolveVolAt = (date: string, map: Record<string, number>, fallback = VIX_FALLBACK): number =>
    (isIntradayBacktest ? map[date] : undefined) ?? map[barDateKey(date)] ?? fallback;
  const resolveOptionalVolAt = (date: string, map: Record<string, number>): number | undefined =>
    (isIntradayBacktest ? map[date] : undefined) ?? map[barDateKey(date)];
  const nativeObservation=execution.yieldDecisionObservations===true
    ?createNativeDecisionObservationEngine(date=>resolveOptionalVolAt(date,vxnByDate??{}),!isIntradayBacktest):undefined;
  const resolvePricingVolAt = (date: string, vix: number): number =>
    normalizeVolIndexForMockOptions(pricingVolByDate ? resolveVolAt(date, pricingVolByDate, vix) : vix, config.volIndex);
  const resolvePricingVol3mAt = (date: string, vix: number, pricingVol: number): number | undefined => {
    const vix3m = resolveOptionalVolAt(date, vix3mByDate);
    // VXN has no 3M index; keep the VIX term-structure shape by ratio-scaling VIX3M.
    return vix3m != null && vix > 0 ? vix3m * (pricingVol / vix) : vix3m;
  };
  const startDate = config.startDate
    ? (isIntradayBacktest && config.startDate.length === 10 ? `${config.startDate}T00:00` : config.startDate)
    : qqqBars[minBarHistory]?.date ?? qqqBars[0]?.date;
  const endDate = config.endDate
    ? (isIntradayBacktest && config.endDate.length === 10 ? `${config.endDate}T23:59` : config.endDate)
    : qqqBars.at(-1)?.date;

  const slowSubregimeGateEnabled = Object.values(config.strategyParams?.stockPhasePolicy ?? {}).some(rule => rule?.gate?.slowSubregimeIn != null || rule?.gate?.slowSubregimePosteriorMin != null)
    || config.strategyParams?.csTailEntryGate === 'candidate4_six_factor'
    || config.strategyParams?.csCandidate9MddEntryGate === 'range_bound_sr01_drawdown_vix_roc20'
    || config.strategyParams?.csCandidate9CoreFusionReleaseMode === 'extension_nonnegative_vix_rising_sr01'
    || config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union'
    || config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union_slow_vix';
  const equityCurve: EquityPoint[] = [];
  const sameDayReriskDiagnostics: Array<Record<string, unknown>> = [];
  const sameDayStockDeRiskDiagnostics: Array<Record<string, unknown>> = [];
  const macroExecutionDriver = execution.macroExecutionDriver ?? 'slow-macro';
  const slowSubregimeDiagnostics: SlowSubregimeDiagnostic[] | undefined = macroExecutionDriver === 'slow-subregime' || execution.slowSubregimeDiagnostics ? [] : undefined;
  const tradeLog: TradeEntry[]     = [];
  const pendingICs = new OverlayBook<PendingIC>();
  const pendingCSes = new OverlayBook<PendingCS>();
  const csMfeByPosition = new Map<string, number>();
  const csMfeRescueDiagnostics = { deltaStopTriggered: 0, priorMfeAvailable: 0, mfeThresholdMet: 0, lossThresholdMet: 0, dteWindowMet: 0, activated: 0 };
  const pendingPCSes = new OverlayBook<PendingPCS>();
  // PCS_RESCUE 始终使用独立账本：不计入主 PCS/组合定义风险，不改变主曲线。
  const pendingPCSRescues = new OverlayBook<PendingPCS>();
  const pendingEquityBoosts = new OverlayBook<PendingEquityBoost>();
  const pendingBearCSes = new OverlayBook<PendingBearCallSpread>();
  const pendingCollars = new OverlayBook<PendingCollar>();
  const pendingEquityOrders = new OverlayBook<PendingEquityOrder>();
  const collarLifecycles: CollarLifecycleDebug[] = [];
  const dailyAdmissions: NonNullable<NonNullable<BacktestResult['debug']>['dailyAdmissions']> | undefined = config.admissionDiagnostics ? [] : undefined;
  const trace: BacktestTraceEntry[] | undefined = config.trace ? [] : undefined;
  const pcsProfileDiagnostics: PcsProfileDiagnostic[] = [];
  const csConditionalGateTrace: CSConditionalGateTrace[] = [];
  const pcsPathDiagnostics: PcsPathDiagnostic[] = [];
  const pcsSurvivalExitMode: PCSSurvivalExitMode = config.strategyParams?.pcsSurvivalExitMode ?? 'off';
  const pcsSurvivalFloor = Math.min(1, Math.max(0, config.strategyParams?.pcsSurvivalFloor ?? 0.4));
  const pcsSurvivalDrop = Math.min(1, Math.max(0, config.strategyParams?.pcsSurvivalDrop ?? 0.2));
  const pcsSurvivalTouchConfirmation = config.strategyParams?.pcsSurvivalTouchConfirmation ?? 'intraday_touch';
  const pcsSurvivalTouchBufferPct = Math.min(.2, Math.max(0, config.strategyParams?.pcsSurvivalTouchBufferPct ?? .005));
  const pcsSurvivalTouchVixThreshold = typeof config.strategyParams?.pcsSurvivalTouchVixThreshold === 'number' && Number.isFinite(config.strategyParams.pcsSurvivalTouchVixThreshold)
    ? Math.max(0, config.strategyParams.pcsSurvivalTouchVixThreshold)
    : undefined;
  const pcsSurvivalCache = new Map<string, StrikeSurvivalAsOf | null>();
  const putStrikeSurvivalAsOf = !isIntradayBacktest && execution.incrementalPutSurvival !== false && config.strategyParams?.enablePCS === true
    ? execution.marketPrecompute?.putStrikeSurvivalAsOf ?? new PutStrikeSurvivalAsOf(qqqBars)
    : undefined;
  const optionRiskBudgetAttemptsByDate = new Map<string, OptionRiskBudgetAttempt[]>();
  const createOptionRiskBudgetAttempt = (fillDate: string, signalDate: string, independent: boolean, strategy: OptionRiskBudgetAttempt['strategy'], requestedQuantity: number, maxLossPerContract: number) => {
    if (independent) return undefined;
    const attempt: OptionRiskBudgetAttempt = {
      signalDate,
      fillDate,
      strategy,
      requestedQuantity,
      finalQuantity: 0,
      maxLossPerContract: Math.max(0, maxLossPerContract),
      riskDollars: 0,
      status: 'not_opened',
      reason: 'shared_option_risk_budget',
    };
    const attempts = optionRiskBudgetAttemptsByDate.get(fillDate) ?? [];
    attempts.push(attempt);
    optionRiskBudgetAttemptsByDate.set(fillDate, attempts);
    return attempt;
  };

  const exitFillMode = config.exitFillMode ?? 'next_open';
  const equityFillMode = config.equityFillMode ?? 'next_open';
  const equityTwapBars = config.equityTwapBars ?? 1;
  if (equityFillMode === 'twap' && (!isIntradayBacktest || !Number.isInteger(equityTwapBars) || equityTwapBars < 1)) {
    throw new Error('equityFillMode=twap 需要日内数据和正整数 equityTwapBars');
  }

  type PendingOptionClose = {
    kind: 'IC' | 'COLLAR' | 'CS' | 'BEAR_CS' | 'PCS' | 'PCS_RESCUE' | 'EQUITY_BOOST';
    ic?: PendingIC;
    collar?: PendingCollar;
    cs?: PendingCS;
    bearCS?: PendingBearCallSpread;
    pcs?: PendingPCS;
    pcsRescue?: PendingPCS;
    equityBoost?: PendingEquityBoost;
    reason: string;
    // worst_of 比较所需的信号日(T)输入
    signalDate: string;
    signalUnderlying: number; // IC/CS=QQQ today.close；collar=leveragedDayPrice
    signalQqq?: number;
    signalVix: number;
    signalVix3m?: number;     // 期限结构插值用（信号日 VIX3M）
    signalPricingVol: number;
    signalPricingVol3m?: number;
  };
  const pendingOptionCloses = new OverlayBook<PendingOptionClose>();
  const recordCollarClose = (
    collar: PendingCollar,
    closeDate: string,
    closeSpot: number,
    closeCashImpact: number,
    pnl: number,
    reason: string,
    isSettle: boolean,
  ) => {
    if (collar.debugId == null) return;
    const lifecycle = collarLifecycles[collar.debugId];
    if (!lifecycle || lifecycle.closeDate) return;
    recordCollarLifecycleClose(lifecycle, collar, { closeDate, closeSpot, closeCashImpact, pnl, reason, isSettle });
  };

  let portfolio: PortfolioState = createPortfolioState(initialCapital);
  let optionCash = 0;
  let shadowCollarCash = 0;
  const applyCollarCash = (amount: number) => {
    if (config.strategyParams?.collarCashMode === 'shadow') shadowCollarCash += amount;
    else portfolio.cash += amount;
  };
  // 卖方期权使用独立现金账本，不得改变正股可用资金；Collar 保留既有股票保护账本。
  const applyOverlayEffect = (effect: OptionLifecycleEffect, ledger: 'portfolio' | 'collar' = 'portfolio') => {
    if (ledger === 'collar') applyCollarCash(effect.cashDelta);
    else optionCash += effect.cashDelta;
  };
  const scaleIndependentEquityBoostEffect = (effect: OptionLifecycleEffect, position: PendingEquityBoost) => {
    const multiplier = independentEquityBoost ? position.riskMultiplier ?? 1 : 1;
    return multiplier === 1 ? effect : { cashDelta: effect.cashDelta * multiplier, pnl: effect.pnl * multiplier };
  };
  let equityBoostCandidate6RealizedPnl = 0;
  let equityBoostCandidate6RealizedPeak = 0;
  const recordEquityBoostCandidate6Close = (pnl: number) => {
    if (config.strategyParams?.equityBoostCandidate6Mdd !== true || !Number.isFinite(pnl)) return;
    equityBoostCandidate6RealizedPnl += pnl;
    equityBoostCandidate6RealizedPeak = Math.max(equityBoostCandidate6RealizedPeak, equityBoostCandidate6RealizedPnl);
  };

  const boxxPrices = execution.marketPrecompute?.boxxPrices ?? buildBoxxPriceResolver(qqqBars, boxxBars);
  const decisionMemory = createDecisionMemoryState();
  let equityBoostDteState = createEquityBoostDteHysteresisState();
  let crisisState: CrisisState = { phase: 'NONE', pendingBars: 0, recoveryBars: 0 };
  let prevCrisisRaw = false;
  // overheat collar: one entry per RISK_ON_EXTENDED streak — reset when regime leaves
  // track which regime preceded the current RISK_ON_EXTENDED entry
  // if entry came from BEAR/CRISIS (V-shaped recovery), skip overheat collar — market has upward escape velocity
  // track how many trading days have passed since last exiting BEAR or CRISIS
  let prevCloseNav = initialCapital;
  let navDrawdownPeak = initialCapital;
  let lastLeveragedTrade: { side: 'BUY' | 'SELL'; date: string } | undefined;
  let prevCrisisPhaseForFastEntry = crisisState.phase;
  let postCrisisBars = 999;
  let macroRegimeState: W9MacroRegimeState | undefined;
  let csBreachState: CSBreachState | undefined;
let wr89CooldownRemaining = 0;
let researchUpstreamRecoveryDelayRemaining = 0;
  const updateWr89AfterPrimaryClose = (pnl: number) => {
    if (config.strategyParams?.csWr89CompactController === true && pnl <= 0) wr89CooldownRemaining = config.strategyParams?.csWr89CooldownOpportunities ?? 4;
  };
  let csEventRiskState: CSEventRiskState | undefined;
  let csSecondaryEventRiskState: CSEventRiskState | undefined;
  let csResearchWeakPersistenceDays = 0;
  let csResearchVixChange5d: number | undefined;
  let pcsStreakState: PcsStreakState | undefined;
  const pcsDynamicMarketHistory: PcsDynamicMarketState[] = [];
  // Research-only formal P1 state; legacy P1-R1-compatible fields are never sourced from a date whitelist.
  let pcsResearchP1BullStressStreak = 0;
  let pcsResearchP1LastSettledPnl: number | undefined;
  let policyCrisisRecoveryBars: number | undefined;
  let conditionalGrowthCapReleaseBars = 0;
  let conditionalGrowthCapActive = false;
  let blownUp = false;
  let sameDayStockDeRiskBuyCooldownRemaining = 0;
  let researchIndependentScoreCarryRemaining = 0;

  const qqqRolling = execution.marketPrecompute?.qqqRolling ?? createRollingIndicators(qqqBars);
  const tqqqRolling = execution.marketPrecompute?.tqqqRolling ?? createRollingIndicators(leveragedBars);
  const csResearchVxnHistory = (config.strategyParams?.csResearchEntryGate && config.strategyParams.csResearchEntryGate !== 'off')
    || config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union_slow_vix'
    || config.strategyParams?.csResearchRiskGuardMode === 'vix_rising'
    || config.strategyParams?.csResearchVxnRescueDelta !== undefined
    || config.strategyParams?.csVxnRescueSizeMultiplier !== undefined
    ? qqqBars.slice(0, minBarHistory).map(bar => resolveOptionalVolAt(bar.date, vxnByDate ?? {})).filter((value): value is number => value != null)
    : undefined;
  const tradingDayDates = qqqBars.map(bar => bar.date);
  const tradingDayIndex = qqqIdx;
  const tradingSessionsRemaining = (fromDate: string, toDate: string): number => {
    const from = tradingDayIndex.get(fromDate);
    const to = tradingDayIndex.get(toDate);
    if (from == null || to == null) return 0;
    return Math.max(0, to - from);
  };
  const recordCsPreCrisisOpen = (signalDate: string, eventRiskActive: boolean) => {
    if (!eventRiskActive || config.strategyParams?.csPreCrisisMaxEntriesInWindow === undefined) {
      csEventRiskState = undefined;
      return;
    }
    const windowDays = Math.max(1, Math.floor(config.strategyParams?.csPreCrisisWindowTradingDays ?? 5));
    const previousEntries = csEventRiskState?.lastOpenDate !== undefined
      && tradingSessionsRemaining(csEventRiskState.lastOpenDate, signalDate) <= windowDays
      ? csEventRiskState.entriesInWindow
      : 0;
    csEventRiskState = { entriesInWindow: previousEntries + 1, lastOpenDate: signalDate };
  };
  const recordCsSecondaryOpen = (signalDate: string, eventRiskActive: boolean, coverageOpen: boolean) => {
    const eventLedgerEnabled = eventRiskActive && config.strategyParams?.csSecondaryMaxEntriesInWindow !== undefined;
    const coverageLedgerEnabled = coverageOpen && config.strategyParams?.csSecondaryCoverageMaxEntriesInWindow !== undefined;
    if (!eventLedgerEnabled && !coverageLedgerEnabled) {
      if (config.strategyParams?.csSecondaryMaxEntriesInWindow === undefined
        && config.strategyParams?.csSecondaryCoverageMaxEntriesInWindow === undefined) csSecondaryEventRiskState = undefined;
      return;
    }
    const eventWindowDays = Math.max(1, Math.floor(config.strategyParams?.csSecondaryWindowTradingDays ?? 5));
    const coverageWindowDays = Math.max(1, Math.floor(config.strategyParams?.csSecondaryCoverageWindowTradingDays ?? 5));
    const previousEntries = eventLedgerEnabled && csSecondaryEventRiskState?.lastOpenDate !== undefined
      && tradingSessionsRemaining(csSecondaryEventRiskState.lastOpenDate, signalDate) <= eventWindowDays
      ? csSecondaryEventRiskState.entriesInWindow
      : 0;
    const previousCoverageEntries = coverageLedgerEnabled && csSecondaryEventRiskState?.coverageLastOpenDate !== undefined
      && tradingSessionsRemaining(csSecondaryEventRiskState.coverageLastOpenDate, signalDate) <= coverageWindowDays
      ? csSecondaryEventRiskState.coverageEntriesInWindow ?? 0
      : 0;
    csSecondaryEventRiskState = {
      entriesInWindow: eventLedgerEnabled ? previousEntries + 1 : csSecondaryEventRiskState?.entriesInWindow ?? 0,
      ...(eventLedgerEnabled ? { lastOpenDate: signalDate } : csSecondaryEventRiskState?.lastOpenDate ? { lastOpenDate: csSecondaryEventRiskState.lastOpenDate } : {}),
      coverageEntriesInWindow: coverageLedgerEnabled ? previousCoverageEntries + 1 : csSecondaryEventRiskState?.coverageEntriesInWindow ?? 0,
      ...(coverageLedgerEnabled ? { coverageLastOpenDate: signalDate } : csSecondaryEventRiskState?.coverageLastOpenDate ? { coverageLastOpenDate: csSecondaryEventRiskState.coverageLastOpenDate } : {}),
    };
  };
  const survivalAtAsOf = (asOfDate: string, spot: number, shortStrike: number, horizonDays: number, bars: OHLCV[]): StrikeSurvivalAsOf | null => {
    const annualized = annualizedRvPct(bars);
    const dailySigma = annualized != null ? annualized / 100 / Math.sqrt(252) : undefined;
    if (dailySigma == null || !(dailySigma > 0)) return null;
    const key = `${asOfDate}|${shortStrike.toFixed(6)}|${horizonDays}`;
    if (pcsSurvivalCache.has(key)) return pcsSurvivalCache.get(key)!;
    const result = putStrikeSurvivalAsOf?.compute(asOfDate, spot, shortStrike, dailySigma, horizonDays)
      ?? computeStrikeSurvivalAtAsOf(bars, spot, shortStrike, dailySigma, horizonDays);
    pcsSurvivalCache.set(key, result);
    return result;
  };
  const sma200For = (idx: number): number => {
    if (!isIntradayBacktest) return qqqRolling.smaAt(idx, 200);
    return smaAtEnd(decisionViewState.qqq, 200);
  };
  const roc5For = (idx: number): number => {
    if (!isIntradayBacktest) return qqqRolling.rocAt(idx, 5);
    return rocAtEnd(decisionViewState.qqq, 5);
  };
  const hasThreeStrongUpDaysFor = (idx: number): boolean => {
    if (!isIntradayBacktest) return hasThreeStrongUpDays(qqqBars, idx);
    return hasThreeStrongUpDays(decisionViewState.qqq, decisionViewState.qqq.length - 1);
  };
  const decisionViewState = createDecisionViewState({ qqqBars, boxxBars, spyBars, minBarHistory, intraday: isIntradayBacktest });
  // PCS SellerStats 的样本在未来窗口成熟时才入账；每个 run/arm 单独持有。
  const sellerStatsAsOf = !isIntradayBacktest && execution.incrementalSellerStats !== false ? new SellerStatsAsOf(qqqBars.slice(0, minBarHistory)) : undefined;
  const callStrikeSurvivalAsOf = !isIntradayBacktest && execution.incrementalCallSurvival !== false && config.strategyParams?.enableCS === true
    ? execution.marketPrecompute?.callStrikeSurvivalAsOf ?? new CallStrikeSurvivalAsOf(qqqBars)
    : undefined;
  const vxnMap = vxnByDate ?? {};
  // PCS 评分只看 as-of VXN；每个 run/arm 私有，避免每日从 QQQ 历史重新 map/filter。
  const pcsVxnHistory = !isIntradayBacktest && config.strategyParams?.enablePCS === true && execution.incrementalVxnHistory !== false
    ? qqqBars.slice(0, minBarHistory).map(bar => resolveOptionalVolAt(bar.date, vxnMap)).filter((value): value is number => value != null)
    : undefined;
  // EB 的 VXN 风险闸也需要 as-of 历史；不能只在 PCS 开启时构造，避免 EB-only 回放和线上链路口径不同。
  const ebVxnHistory = !isIntradayBacktest && config.strategyParams?.enableEquityBoostPCS === true && execution.incrementalVxnHistory !== false
    ? qqqBars.slice(0, minBarHistory).map(bar => resolveOptionalVolAt(bar.date, vxnMap)).filter((value): value is number => value != null)
    : undefined;
  const useIncrementalWeeklyMacro = !isIntradayBacktest && execution.incrementalWeeklyMacro !== false;
  // 日线宏观状态机曾每天 resample 全部历史；这里预热并逐日更新周桶，不读取未来 bar。
  const incrementalWeeklyBars: IncrementalWeeklyBar[] = [];
  const incrementalWeeklyLastBars: IncrementalWeeklyBar[] = [];
  const incrementalWeeklyLatest: { vix?: number; vix3m?: number } = {};
  if (useIncrementalWeeklyMacro) {
    for (let index = 0; index < minBarHistory; index++) {
      appendWeeklyBar(incrementalWeeklyBars, qqqBars[index]!, incrementalWeeklyLatest, vixByDate, vix3mByDate);
      appendWeeklyLastBar(incrementalWeeklyLastBars, qqqBars[index]!, incrementalWeeklyLatest);
    }
  }
  let spySliceEnd = 0;

  let lastMarketContext: MarketEnvironmentSnapshot | undefined;
  let nextOpenPlan: BacktestResult['nextOpenPlan'];
  const loopEndExclusive = includeTerminalMarkOnly ? qqqBars.length : qqqBars.length - 1;
  // 分桶耗时分析；execution.phaseProfiler 缺省时 profMark/profRecord 是无 performance.now() 调用的 no-op。
const phaseProfiler = execution.phaseProfiler;
const pipelineOptions = isIntradayBacktest || execution.appendOnlyPriceSeriesValidationCache === false ? undefined : {
  appendOnlyPriceSeriesValidationCache: new WeakMap<OHLCV[], { length: number; valid: boolean }>(),
  profiler: execution.pipelineStageProfiler,
};
  const profMark = (): number => (phaseProfiler ? performance.now() : 0);
  const profRecord = (phase: BacktestProfilePhase, t0: number): void => {
    if (phaseProfiler) phaseProfiler.record(phase, performance.now() - t0);
  };
  for (let i = minBarHistory; i < loopEndExclusive; i++) {
    const today   = qqqBars[i];
    const nextDay = qqqBars[i + 1];
    if (csSecondaryEventRiskState?.lastOpenDate !== undefined
      && tradingSessionsRemaining(csSecondaryEventRiskState.lastOpenDate, today.date)
        > Math.max(1, Math.floor(config.strategyParams?.csSecondaryWindowTradingDays ?? 5))) {
      const coverageStillLive = csSecondaryEventRiskState.coverageLastOpenDate !== undefined
        && tradingSessionsRemaining(csSecondaryEventRiskState.coverageLastOpenDate, today.date)
          <= Math.max(1, Math.floor(config.strategyParams?.csSecondaryCoverageWindowTradingDays ?? 5));
      if (!coverageStillLive) csSecondaryEventRiskState = undefined;
      else csSecondaryEventRiskState = {
        entriesInWindow: 0,
        lastOpenDate: undefined,
        coverageEntriesInWindow: csSecondaryEventRiskState.coverageEntriesInWindow,
        coverageLastOpenDate: csSecondaryEventRiskState.coverageLastOpenDate,
      };
    } else if (csSecondaryEventRiskState?.coverageLastOpenDate !== undefined
      && tradingSessionsRemaining(csSecondaryEventRiskState.coverageLastOpenDate, today.date)
        > Math.max(1, Math.floor(config.strategyParams?.csSecondaryCoverageWindowTradingDays ?? 5))) {
      if (config.strategyParams?.csSecondaryMaxEntriesInWindow === undefined) csSecondaryEventRiskState = undefined;
      else csSecondaryEventRiskState = {
        entriesInWindow: csSecondaryEventRiskState.entriesInWindow,
        lastOpenDate: csSecondaryEventRiskState.lastOpenDate,
        coverageEntriesInWindow: 0,
        coverageLastOpenDate: undefined,
      };
    }
const isDecisionBar = isDailyDecisionBar(qqqBars, i, isIntradayBacktest);
if (isDecisionBar && researchUpstreamRecoveryDelayRemaining > 0) researchUpstreamRecoveryDelayRemaining -= 1;
    const checkOptionExitsThisBar = !isIntradayBacktest || isDecisionBar || intrabarStops;

    const viewLeveragedSliceEnd = leveragedIdx.has(today.date)
      ? leveragedIdx.get(today.date)! + 1
      : 0;
    const viewBoxxSliceEnd = boxxBars && boxxIdx && boxxIdx.has(today.date)
      ? boxxIdx.get(today.date)! + 1
      : undefined;
    while (spyBars?.[spySliceEnd] && spyBars[spySliceEnd]!.date <= today.date) spySliceEnd++;
    const viewSpySliceEnd = spyBars ? spySliceEnd : undefined;
    const __tDecisionView = profMark();
    advanceDecisionView(decisionViewState, { today, intraday: isIntradayBacktest, leveragedBars, leveragedSliceEnd: viewLeveragedSliceEnd, boxxBars, boxxSliceEnd: viewBoxxSliceEnd, spyBars, spySliceEnd: viewSpySliceEnd });
    sellerStatsAsOf?.append(today);
    const vxnToday = resolveOptionalVolAt(today.date, vxnMap);
    if (csResearchVxnHistory && vxnToday != null && csResearchVxnHistory.length >= 5) {
      const vxnFiveBarsAgo = csResearchVxnHistory[csResearchVxnHistory.length - 5]!;
      csResearchVixChange5d = vxnFiveBarsAgo > 0 ? (vxnToday - vxnFiveBarsAgo) / vxnFiveBarsAgo : undefined;
    } else {
      csResearchVixChange5d = undefined;
    }
    if (vxnToday != null) csResearchVxnHistory?.push(vxnToday);
    if (vxnToday != null) pcsVxnHistory?.push(vxnToday);
    if (vxnToday != null) ebVxnHistory?.push(vxnToday);
    if (isDecisionBar && (config.strategyParams?.equityBoostDteMode === 'risk_adaptive_hysteresis_v1' || config.strategyParams?.equityBoostDteMode === 'state_adaptive_sr01_v1' || config.strategyParams?.equityBoostDteMode === 'state_adaptive_bad_sr01_v1' || config.strategyParams?.equityBoostDteMode === 'price_adaptive_v1')) {
      equityBoostDteState = updateEquityBoostDteHysteresisState(equityBoostDteState, vxnToday, {
        vxnThreshold: config.strategyParams.equityBoostDynamicDteVxnThreshold,
        recoveryVxnThreshold: config.strategyParams.equityBoostDynamicDteRecoveryVxnThreshold,
        minHighRiskDays: config.strategyParams.equityBoostDynamicDteMinHighRiskDays,
      });
    }
    if (useIncrementalWeeklyMacro) {
      appendWeeklyBar(incrementalWeeklyBars, today, incrementalWeeklyLatest, vixByDate, vix3mByDate);
      appendWeeklyLastBar(incrementalWeeklyLastBars, today, incrementalWeeklyLatest);
    }
    profRecord('decisionView', __tDecisionView);

    if (today.date < startDate) continue;
    if (endDate && today.date > endDate) break;
    const slowSubregime = slowSubregimeDiagnostics || macroExecutionDriver === 'slow-subregime' || slowSubregimeGateEnabled
      ? execution.slowSubregimeByDate?.[today.date.slice(0, 10)] ?? resolveSlowSubregimeDiagnostic(today.date)
      : undefined;
    if (isDecisionBar && slowSubregimeDiagnostics && slowSubregime) slowSubregimeDiagnostics.push(slowSubregime);
    const csResearchEntryGate = config.strategyParams?.csResearchEntryGate;
    if (csResearchEntryGate && csResearchEntryGate !== 'off') {
      const qqqRoc20 = qqqRolling.rocAt(i, 20);
      const sma20 = qqqRolling.smaAt(i, 20);
      const sma20FiveBarsAgo = i >= 5 ? qqqRolling.smaAt(i - 5, 20) : 0;
      const sma20SlopePct = sma20FiveBarsAgo > 0 ? (sma20 - sma20FiveBarsAgo) / sma20FiveBarsAgo : undefined;
      csResearchWeakPersistenceDays = qqqRoc20 != null && sma20SlopePct != null && qqqRoc20 < 0 && sma20SlopePct < 0
        ? csResearchWeakPersistenceDays + 1
        : 0;
    } else {
      csResearchWeakPersistenceDays = 0;
    }
    const todayTime = new Date(today.date).getTime();

    const leveragedBar      = leveragedBars[leveragedIdx.get(today.date) ?? -1];
    const boxxDayPrice      = boxxPrices.close(today.date, i);
    const leveragedDayPrice = leveragedBar?.close ?? 0;
    const leveragedOpenPrice = leveragedBar?.open ?? leveragedDayPrice;

    if (!leveragedBar || leveragedDayPrice <= 0) continue;

    const recordEquityExecutions = (executions: ReturnType<typeof executePendingEquityOrders>) => {
      for (const { order, isLeveraged, fillPrice, fill } of executions) {
        const qty = fill.quantity;
        if (isLeveraged) {
          if (order.side === 'BUY') {
            tradeLog.push({
              signalDate: order.signalDate,
              date: today.date,
              symbol: leveragedSymbol,
              side: 'BUY',
              quantity: qty,
              fillPrice,
              cashImpact: fill.cashImpact,
          rationale: order.rationale,
          targetPct: order.targetPct,
          executionReason: order.executionReason ?? order.rationale,
              executionReasonKey: order.executionReasonKey,
              marketContext: order.marketContext,
            });
            lastLeveragedTrade = { side: 'BUY', date: today.date };
          } else {
            tradeLog.push({
              signalDate: order.signalDate,
              date: today.date,
              symbol: leveragedSymbol,
              side: 'SELL',
              quantity: qty,
              fillPrice,
              cashImpact: fill.cashImpact,
          rationale: order.rationale,
          targetPct: order.targetPct,
          pnl: fill.pnl,
              executionReason: order.executionReason ?? '调仓卖出',
              executionReasonKey: order.executionReasonKey,
              outcomeReason: order.rationale,
              marketContext: order.marketContext,
            });
            lastLeveragedTrade = { side: 'SELL', date: today.date };
          }
        } else if (order.side === 'BUY') {
          tradeLog.push({ signalDate: order.signalDate, date: today.date, symbol: 'BOXX', side: 'BUY', quantity: qty, fillPrice, cashImpact: fill.cashImpact, rationale: order.rationale, executionReason: order.executionReason ?? order.rationale, executionReasonKey: order.executionReasonKey, marketContext: order.marketContext });
        } else {
          tradeLog.push({ signalDate: order.signalDate, date: today.date, symbol: 'BOXX', side: 'SELL', quantity: qty, fillPrice, cashImpact: fill.cashImpact, rationale: order.rationale, pnl: fill.pnl, executionReason: order.executionReason ?? '调仓卖出', executionReasonKey: order.executionReasonKey, outcomeReason: order.rationale, marketContext: order.marketContext });
        }
      }
    };

    const __tExecA = profMark();
    if (pendingEquityOrders.length > 0 && equityFillMode !== 'twap') {
      const leveragedOpen = leveragedBar.open;
      const boxxOpen = boxxPrices.open(today.date, i);
      const sellFirstTargetIncreaseOnly = config.strategyParams?.researchEquitySellFirstTargetIncreaseOnly === true;
      // The target-increase-only research branch decides the next-open order
      // queue before today's close exists. Use open prices there to avoid
      // forward-looking ordering; preserve the legacy close-based calculation
      // for the broad researchEquitySellFirst branch and the default path.
      const actualPctPrice = sellFirstTargetIncreaseOnly
        ? { leveraged: leveragedOpen, boxx: boxxOpen }
        : { leveraged: leveragedDayPrice, boxx: boxxDayPrice };
      const currentLeveragedValue = portfolio.leveragedShares * actualPctPrice.leveraged;
      const currentBoxxValue = portfolio.boxxShares * actualPctPrice.boxx;
      const currentStockNav = currentLeveragedValue + currentBoxxValue + portfolio.cash;
      const currentActualPct = currentStockNav > 0 ? currentLeveragedValue / currentStockNav : 0;
      const sellFirstMinGapPp = config.strategyParams?.researchEquitySellFirstMinGapPp ?? 0;
      const sellFirstMode = config.strategyParams?.researchEquitySellFirstMode ?? 'all';
      const queueSignalContext = pendingEquityOrders.find(order => order.symbol === leveragedSymbol && order.side === 'BUY')?.marketContext;
      const queueQuality = queueSignalContext != null
        && (queueSignalContext.roc5 ?? -Infinity) >= 0
        && (queueSignalContext.vix ?? Infinity) <= 20
        && (queueSignalContext.vixChange5d ?? Infinity) <= 0
        && (queueSignalContext.qqqEr20 ?? -Infinity) >= 0.30
        && queueSignalContext.tqqqRealisedVol20d <= 0.90
        && (queueSignalContext.priceExtensionAtr ?? Infinity) < 2.65
        && (queueSignalContext.drawdownFromRecentHighPct ?? Infinity) < 0.03;
      const queueQualityGate = sellFirstMode === 'all'
        || (queueQuality && sellFirstMode === 'clean_bull' && queueSignalContext?.regime === 'BULL')
        || (queueQuality && sellFirstMode === 'clean_risk_on' && ['BULL', 'RANGE_BOUND', 'RISK_ON_EXTENDED'].includes(queueSignalContext?.regime ?? ''))
        || (queueQuality && sellFirstMode === 'slow_bull_gap' && queueSignalContext?.macroRegime === 'SLOW_BULL' && queueSignalContext.tqqqRealisedVol20d <= 0.70)
          || (queueQuality && queueSignalContext?.regime === 'BULL' && (
          (sellFirstMode === 'target80_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.80))
          || (sellFirstMode === 'target85_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.85))
          || (sellFirstMode === 'target90_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.90))
          || (sellFirstMode === 'target90_vol_resize' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && order.executionReasonKey === 'vol_target_resize' && (order.targetPct ?? -Infinity) >= 0.90))
        ));
      const sellFirst = (config.strategyParams?.researchEquitySellFirst === true
        || config.researchEquitySellFirstByDate?.[today.date] === true)
        && queueQualityGate
        && (!sellFirstTargetIncreaseOnly || (
          pendingEquityOrders.some(order => order.symbol === 'BOXX' && order.side === 'SELL')
          && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) > currentActualPct + sellFirstMinGapPp / 100 + 1e-9)
        ));
      const executions = executePendingEquityOrders({
        orders: pendingEquityOrders,
        portfolio,
        leveragedSymbol,
        sellFirst,
        resolveFillPrice: order => {
          const isLeveraged = order.symbol === leveragedSymbol;
          const nextOpen = isLeveraged ? leveragedOpen : boxxOpen;
          const researchFill = execution.researchEquityFillPriceByDate?.[barDateKey(today.date)]?.[order.symbol];
          if (execution.researchEquityFillPriceByDate) {
            if (!researchFill || researchFill.confidence === 0 || !Number.isFinite(researchFill.value) || researchFill.value <= 0) {
              throw new Error(`研究股票成交价缺失或无效: ${order.symbol} ${barDateKey(today.date)}`);
            }
          }
          // #6: 'flat' (default) → static slippagePct, byte-identical to before.
        // 'impact' → scale by VIX stress and √(order size / ADV) market impact.
        let eff = slippagePct;
        if (slippageModel === 'impact') {
          const adv = isLeveraged
            ? advFromBars(leveragedBars, leveragedIdx, today.date)
            : advFromBars(boxxBars, boxxIdx, today.date);
          const impact = adv > 0 ? IMPACT_K * Math.sqrt(order.quantity / adv) : 0;
          eff = slippagePct * stressMult(resolveVolAt(today.date, vixByDate)) * (1 + impact);
        }
        return researchFill
          ? (order.side === 'BUY' ? researchFill.value * (1 + eff) : researchFill.value * (1 - eff))
          : resolveEquityOrderFill({ side: order.side, mode: equityFillMode, signalClose: order.signalClose, nextOpen, slippagePct: eff });
        },
      });
      recordEquityExecutions(executions);
    }
    if (pendingEquityOrders.length > 0 && equityFillMode === 'twap') {
      const executionDate = barDateKey(today.date);
      for (let k = pendingEquityOrders.length - 1; k >= 0; k--) {
        if (pendingEquityOrders[k]!.twap!.executionDate < executionDate) pendingEquityOrders.removeAt(k);
      }
      const leveragedOpen = leveragedBar.open;
      const boxxOpen = boxxPrices.open(today.date, i);
      const executions = executePendingEquityOrders({
        orders: pendingEquityOrders,
        portfolio,
        leveragedSymbol,
        shouldExecute: order => order.twap?.executionDate === executionDate,
        requestedQuantityForOrder: order => Math.ceil(order.quantity / order.twap!.barsRemaining),
        resolveFillPrice: order => {
          const isLeveraged = order.symbol === leveragedSymbol;
          const open = isLeveraged ? leveragedOpen : boxxOpen;
          let eff = slippagePct;
          if (slippageModel === 'impact') {
            const adv = isLeveraged ? advFromBars(leveragedBars, leveragedIdx, today.date) : advFromBars(boxxBars, boxxIdx, today.date);
            const impact = adv > 0 ? IMPACT_K * Math.sqrt(order.quantity / adv) : 0;
            eff = slippagePct * stressMult(resolveVolAt(today.date, vixByDate)) * (1 + impact);
          }
          return order.side === 'BUY' ? open * (1 + eff) : open * (1 - eff);
        },
        afterExecution: (order, execution) => {
          const remaining = order.quantity - execution.fill.quantity;
          const barsRemaining = order.twap!.barsRemaining - 1;
          return remaining > 0 && barsRemaining > 0
            ? { ...order, quantity: remaining, twap: { ...order.twap!, barsRemaining } }
            : undefined;
        },
      });
      recordEquityExecutions(executions);
    }

    const vixToday = resolveVolAt(today.date, vixByDate);
    const vixPrev = resolvePrevVix(qqqBars, vixByDate, i, isIntradayBacktest, vixToday);
    const vix3mToday = resolveOptionalVolAt(today.date, vix3mByDate);
    const pricingVolToday = resolvePricingVolAt(today.date, vixToday);
    const pricingVol3mToday = resolvePricingVol3mAt(today.date, vixToday, pricingVolToday);

    // ── Dequeue and fill option early exits scheduled yesterday ──
    if (pendingOptionCloses.length > 0) {
      const fillVix = resolveVolAt(today.date, vixByDate);
      const fillPricingVol = resolvePricingVolAt(today.date, fillVix);
      const fillPricingVol3m = resolvePricingVol3mAt(today.date, fillVix, fillPricingVol);
      for (const pc of pendingOptionCloses.drain()) {
        if (pc.kind === 'IC') {
          const idx = pendingICs.findIndex(item => item === pc.ic);
          if (idx === -1) continue;
          const ic = pc.ic!;

          const nextOpenRes = closeIronCondorAtMark(ic, today.date, today.open, fillPricingVol, pc.reason, pricing, fillPricingVol3m);
          const closeComm = optCommission(4, ic.quantity);
          const closeImp = closeImpactDollars('QQQ', today.open, ic.putShort, ic.quantity, fillVix);
          const { chosen, effect } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closeIronCondorAtMark(ic, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, pc.reason, pricing, pc.signalPricingVol3m), commission: closeComm, impact: closeImp });
          if (!independentIC) applyOverlayEffect(effect);
          tradeLog.push({
            signalDate: pc.signalDate,
            date:       today.date,
            symbol:     ironCondorName,
            side:       'BUY',
            quantity:   ic.quantity,
            fillPrice:  chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale:  chosen.note,
            action:     'CLOSE',
            strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR,
            pnl:        effect.pnl,
            executionReason: '提前平仓',
            outcomeReason: pc.reason,
            outcomeReasonKey: getOptionOutcomeReasonKey(pc.reason, false),
          });
          pendingICs.removeAt(idx);
        } else if (pc.kind === 'COLLAR') {
          const idx = pendingCollars.findIndex(item => item === pc.collar);
          if (idx === -1) continue;
          const collar = pc.collar!;

          const nextOpenRes = closeV2CollarAtMark(collar, today.date, leveragedOpenPrice, fillPricingVol, leveragedSymbol, pc.reason, pricing, fillPricingVol3m, today.open, marketSplitFactors(today.date));
          const closeComm = optCommission(1 + (collar.shortPutStrike ? 1 : 0) + (collar.callStrike ? 1 : 0), collar.quantity);
          const closeImp = closeImpactDollars(leveragedSymbol, leveragedOpenPrice, collar.putStrike, collar.quantity, fillVix, collar.putContractMultiplier, splitFactorFor(collar.putUnderlying ?? leveragedSymbol, today.date));
          const { chosen, effect } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closeV2CollarAtMark(collar, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, leveragedSymbol, pc.reason, pricing, pc.signalPricingVol3m, pc.signalQqq ?? pc.signalUnderlying, marketSplitFactors(pc.signalDate)), commission: closeComm, impact: closeImp });
          applyOverlayEffect(effect, 'collar');
          recordCollarClose(collar, today.date, leveragedOpenPrice, effect.cashDelta, effect.pnl, pc.reason, false);
          tradeLog.push({
            signalDate: pc.signalDate,
            date: today.date,
            expiry: collar.expiry,
            symbol: collarName(leveragedSymbol),
            side: 'BUY',
            quantity: collar.quantity,
            fillPrice: 0,
            cashImpact: effect.cashDelta,
            rationale: chosen.note,
            action: 'CLOSE',
            strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR,
            pnl: effect.pnl,
            executionReason: '提前平仓',
            outcomeReason: pc.reason,
            outcomeReasonKey: getOptionOutcomeReasonKey(pc.reason, false),
          });
          pendingCollars.removeAt(idx);
        } else if (pc.kind === 'CS') {
          const idx = pendingCSes.findIndex(item => item === pc.cs);
          if (idx === -1) continue;
          const cs = pc.cs!;

          const nextOpenRes = closeCallCreditSpreadAtMark(cs, today.date, today.open, fillPricingVol, pc.reason, pricing, fillPricingVol3m);
          const closeComm = optCommission(2, cs.quantity);
          const closeImp = closeImpactDollars('QQQ', today.open, cs.shortStrike, cs.quantity, fillVix);
          const { chosen, effect, netPnl } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closeCallCreditSpreadAtMark(cs, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, pc.reason, pricing, pc.signalPricingVol3m), commission: closeComm, impact: closeImp });
          if (cs.route !== 'secondary_budget') {
        csBreachState = updateCSBreachStateOnClose(csBreachState, { pnl: netPnl, shortStrike: cs.shortStrike, date: today.date, qqqClose: today.close });
        updateWr89AfterPrimaryClose(netPnl);
          }
          const totalCost = chosen.costPerShare * 100 * cs.quantity;
          const note = `提前平仓 Call Spread [${pc.reason}]，回购成本 $${totalCost.toFixed(0)}，净 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`;
          if (!independentCS) applyOverlayEffect(effect);
          tradeLog.push(buildCallCreditSpreadCloseTrade({
            position: cs,
            kind: 'CS',
            signalDate: pc.signalDate,
            date: today.date,
            fillPrice: chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale: `${note} [${callSpreadLayerLabel(cs)}]`,
            pnl: effect.pnl,
            outcomeReason: pc.reason,
          }));
          pendingCSes.removeAt(idx);
        } else if (pc.kind === 'BEAR_CS') {
          const idx = pendingBearCSes.findIndex(item => item === pc.bearCS);
          if (idx === -1) continue;
          const bcs = pc.bearCS!;

          const nextOpenRes = closeCallCreditSpreadAtMark(bcs, today.date, today.open, fillPricingVol, pc.reason, pricing, fillPricingVol3m, 'Bear Call Spread');
          const closeComm = optCommission(2, bcs.quantity);
          const closeImp = closeImpactDollars('QQQ', today.open, bcs.shortStrike, bcs.quantity, fillVix);
          const { chosen, effect, netPnl } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closeCallCreditSpreadAtMark(bcs, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, pc.reason, pricing, pc.signalPricingVol3m, 'Bear Call Spread'), commission: closeComm, impact: closeImp });
          csBreachState = updateCSBreachStateOnClose(csBreachState, { pnl: netPnl, shortStrike: bcs.shortStrike, date: today.date, qqqClose: today.close });
          const totalCloseCost = chosen.costPerShare * 100 * bcs.quantity;
          const note = `提前平仓 Bear Call Spread [${pc.reason}]，回购成本 $${totalCloseCost.toFixed(0)}，净 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`;
          if (!independentBearCS) applyOverlayEffect(effect);
          tradeLog.push(buildCallCreditSpreadCloseTrade({
            position: bcs,
            kind: 'BEAR_CS',
            signalDate: pc.signalDate,
            date: today.date,
            fillPrice: chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale: note,
            pnl: effect.pnl,
            outcomeReason: pc.reason,
          }));
          pendingBearCSes.removeAt(idx);
        } else if (pc.kind === 'PCS') {
          const idx = pendingPCSes.findIndex(item => item === pc.pcs);
          if (idx === -1) continue;
          const pcsPos = pc.pcs!;

          const nextOpenRes = closePutCreditSpreadAtMark(pcsPos, today.date, today.open, fillPricingVol, pc.reason, pricing, fillPricingVol3m);
          const closeComm = optCommission(2, pcsPos.quantity);
          const closeImp = closeImpactDollars(proxySymbol, today.open, pcsPos.shortStrike, pcsPos.quantity, fillVix);
          const { chosen, effect, netPnl } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closePutCreditSpreadAtMark(pcsPos, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, pc.reason, pricing, pc.signalPricingVol3m), commission: closeComm, impact: closeImp });
      pcsStreakState = updatePcsStreakStateOnClose(pcsStreakState, { pnl: netPnl, closeDate: today.date, cooldownTradingDays: config.strategyParams?.pcsStreakCooldownTradingDays ?? 0, tradingDayCalendar: tradingDayDates });
          pcsResearchP1LastSettledPnl = netPnl;
          execution.pcsDynamicEntryProfile?.onClose?.({ signalDate: pc.signalDate, closeDate: today.date, pnl: netPnl });
          const totalCloseCost = chosen.costPerShare * 100 * pcsPos.quantity;
          const note = `提前平仓 Put Credit Spread [${pc.reason}]，回购成本 $${totalCloseCost.toFixed(0)}，净 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`;
          if (!independentPCS) applyOverlayEffect(effect);
          if (pcsPos.pathDiagnostic) {
            pcsPos.pathDiagnostic.closeDate = today.date;
            pcsPos.pathDiagnostic.closeAction = 'CLOSE';
            pcsPos.pathDiagnostic.realizedPnl = effect.pnl;
          }
          tradeLog.push({
            signalDate: pc.signalDate,
            date: today.date,
            expiry: pcsPos.expiry,
            symbol: putCreditSpreadTradeMeta('PCS', pcsPos.longStrike, pcsPos.shortStrike, proxySymbol).symbol,
            side: 'BUY',
            quantity: pcsPos.quantity,
            fillPrice: chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale: note,
            action: 'CLOSE',
            strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD,
            pnl: effect.pnl,
            executionReason: '提前平仓',
            outcomeReason: pc.reason,
            outcomeReasonKey: getOptionOutcomeReasonKey(pc.reason, false),
          });
          pendingPCSes.removeAt(idx);
        } else if (pc.kind === 'EQUITY_BOOST') {
          const idx = pendingEquityBoosts.findIndex(item => item === pc.equityBoost);
          if (idx === -1) continue;
          const ebPos = pc.equityBoost!;

          const nextOpenRes = closePutCreditSpreadAtMark(ebPos, today.date, today.open, fillPricingVol, pc.reason, pricing, fillPricingVol3m);
          const closeComm = optCommission(2, ebPos.quantity);
          const closeImp = closeImpactDollars('QQQ', today.open, ebPos.shortStrike, ebPos.quantity, fillVix);
          const { chosen, effect: rawEffect } = executeScheduledOptionClose({ mode: exitFillMode, nextOpen: nextOpenRes, signalClose: closePutCreditSpreadAtMark(ebPos, pc.signalDate, pc.signalUnderlying, pc.signalPricingVol, pc.reason, pricing, pc.signalPricingVol3m), commission: closeComm, impact: closeImp });
          const effect = scaleIndependentEquityBoostEffect(rawEffect, ebPos);
          const netPnl = effect.pnl;
          recordEquityBoostCandidate6Close(netPnl);
          const totalCloseCost = chosen.costPerShare * 100 * ebPos.quantity;
          const note = `提前平仓 Equity Boost Put Spread [${pc.reason}]，回购成本 $${totalCloseCost.toFixed(0)}，净 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`;
          if (!independentEquityBoost) applyOverlayEffect(effect);
          tradeLog.push({
            signalDate: pc.signalDate,
            date: today.date,
            expiry: ebPos.expiry,
            symbol: putCreditSpreadTradeMeta('EQUITY_BOOST', ebPos.longStrike, ebPos.shortStrike, proxySymbol).symbol,
            side: 'BUY',
            quantity: ebPos.quantity,
            fillPrice: chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale: note,
            action: 'CLOSE',
            strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD,
            pnl: effect.pnl,
            executionReason: '提前平仓',
            outcomeReason: pc.reason,
            outcomeReasonKey: getOptionOutcomeReasonKey(pc.reason, false),
          });
          pendingEquityBoosts.removeAt(idx);
        }
      }
    }
    profRecord('execution', __tExecA);

    // 只在实际启用的结构需要时构建完整合成链；Overlay 本身仍需要 QQQ spot，空链即可。
    // 提前平仓估值继续直接用 bs()，不需要链。
    const __tChainA = profMark();
    const buildDecisionChains = useMockOptions && isDecisionBar;
    const lazyMockChains = execution.lazyMockChains !== false;
    const params = config.strategyParams;
    // 2026-07-22 研究 opt-in（未采纳，禁止设为 preset 默认）：tailRiskCollarOverride 触发期间需要
    // 临时开启 Collar 的期权链需求（否则下方 needsLeveragedOptionChain 判定仍按静态 enableCollar=false
    // 计算，导致 pipeline.ts 内部覆盖 enableCollar=true 后 Collar 想开仓却拿不到 TQQQ 期权链——
    // 2026-07-22 diagnose：collar_triggered 为 true 但 tradeLog 里 Collar 相关条目=0 的根因）。
    // updateTailRiskState 是纯函数、无副作用，这里与 pipeline.ts 内部再算一次完全等价、确定性一致。
    const tailRiskTriggerForChainGate = config.tailRiskTriggerByDate?.[today.date] === true;
    const tailRiskStateForChainGate = params?.tailRiskCollarOverride
      ? updateTailRiskState(decisionMemory.tailRiskState, tailRiskTriggerForChainGate, params, today.date)
      : undefined;
    const chainGateParams: typeof params = tailRiskStateForChainGate?.active
      ? { ...params!, enableCollar: true, collarMode: params!.tailRiskCollarOverride!.collarMode ?? 'always', collarLegMode: params!.tailRiskCollarOverride!.legMode ?? 'both' }
      : params;
    // params 是原始（未 default 化）的 strategyParams；各 enable* 的"未设置即启用/禁用"
    // 语义由 resolveOverlayDefaults 统一裁决（与 overlay-runner.ts 消费的口径一致），
    // 这里必须复用同一份解析，不能对 === true 做本地二次定义，否则会与真实
    // 策略引擎的默认值不一致（见 2026-07 lazyMockChains 静默丢期权腿的回归）。
    const resolvedGateParams = resolveOverlayDefaults(chainGateParams);
    const collarUsesQqqPut = resolvedGateParams.enableCollar && resolvedGateParams.collarPutUnderlying === 'qqq';
    const needsQqqOptionChain = resolvedGateParams.enableIC || resolvedGateParams.enableCS || resolvedGateParams.enablePCS || resolvedGateParams.enableBearOverlay !== false || resolvedGateParams.enableEquityBoostPCS || resolvedGateParams.pcsRescueEnabled === true || collarUsesQqqPut;
    const needsLeveragedOptionChain = resolvedGateParams.enableCollar;
    // 每种选约器只会读取一个目标到期日及所需 Put/Call 侧。保留该侧的完整
    // 网格是必要的：delta 与 Equity Boost 的候选排序都依赖相邻合约，不能预先
    // 猜测单一 strike；实际成交腿在下方再压缩为精确合约。
    const qqqDecisionContracts: MockDecisionContractRequest[] = [];
    const leveragedDecisionContracts: MockDecisionContractRequest[] = [];
    const addDecisionContract = (target: MockDecisionContractRequest[], targetDte: number, types: Array<'call' | 'put'>) => {
      const prior = target.find(item => item.targetDte === targetDte);
      if (prior) prior.types.push(...types.filter(type => !prior.types.includes(type)));
      else target.push({ targetDte, types: [...types] });
    };
    if (resolvedGateParams.enableIC) addDecisionContract(qqqDecisionContracts, IC_TARGET_DTE, ['put', 'call']);
    if (resolvedGateParams.enableCS) {
      const csTargetDtes = resolvedGateParams.csSurvivalSelectionDteMode === 'dynamic_dte_v1'
        ? [21, 28, 35]
        : [resolvedGateParams.csTargetDte ?? SPREAD_TARGET_DTE];
      for (const targetDte of csTargetDtes) addDecisionContract(qqqDecisionContracts, targetDte, ['call']);
    }
    if (resolvedGateParams.enableBearOverlay !== false) addDecisionContract(qqqDecisionContracts, SPREAD_TARGET_DTE, ['call']);
    if (resolvedGateParams.enablePCS) {
      const survivalSelectionUsesDynamicDte = resolvedGateParams.pcsSurvivalPriceSelectionMode !== 'off'
        && resolvedGateParams.pcsSurvivalSelectionDteMode === 'dynamic_dte_v1';
      const pcsDtes = survivalSelectionUsesDynamicDte || usesPcsContractProfileFactor(resolvedGateParams.pcsContractProfile, 'dte')
        ? [28, 35, 42]
        : [resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE];
      for (const targetDte of pcsDtes) addDecisionContract(qqqDecisionContracts, targetDte, ['put']);
    }
    if (resolvedGateParams.pcsRescueEnabled === true) {
      addDecisionContract(qqqDecisionContracts, resolvedGateParams.pcsRescueTargetDte ?? resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE, ['put']);
    }
    if (resolvedGateParams.enableEquityBoostPCS) {
      const equityBoostDtes = resolvedGateParams.equityBoostDteMode === 'risk_adaptive_v1' || resolvedGateParams.equityBoostDteMode === 'risk_adaptive_hysteresis_v1' || resolvedGateParams.equityBoostDteMode === 'state_adaptive_sr01_v1' || resolvedGateParams.equityBoostDteMode === 'state_adaptive_bad_sr01_v1' || resolvedGateParams.equityBoostDteMode === 'price_adaptive_v1'
        ? [28, 35]
        : [resolvedGateParams.equityBoostTargetDte ?? SPREAD_TARGET_DTE];
      for (const targetDte of equityBoostDtes) addDecisionContract(qqqDecisionContracts, targetDte, ['put']);
    }
    if (resolvedGateParams.enableCollar) {
      addDecisionContract(leveragedDecisionContracts, COLLAR_TARGET_DTE, ['call']);
      addDecisionContract(collarUsesQqqPut ? qqqDecisionContracts : leveragedDecisionContracts, COLLAR_TARGET_DTE, ['put']);
    }
    const todayMockChain = buildDecisionChains && (!lazyMockChains || needsQqqOptionChain)
      ? cachedMockChain(today.date, today.close, pricingVolToday, proxySymbol, pricingVol3mToday, undefined, lazyMockChains ? qqqDecisionContracts : undefined)
      : buildDecisionChains
        ? { symbol: proxySymbol, spot: today.close, timestamp: today.date, expirations: [] }
        : undefined;
    const todayLevMockChain = buildDecisionChains && (!lazyMockChains || needsLeveragedOptionChain) && leveragedDayPrice > 0
      ? cachedMockChain(today.date, leveragedDayPrice, pricingVolToday, leveragedSymbol, pricingVol3mToday, undefined, lazyMockChains ? leveragedDecisionContracts : undefined)
      : undefined;
    const optionChains = todayMockChain
      ? lazyMockChains
        ? { [proxySymbol]: todayMockChain, ...(todayLevMockChain ? { [leveragedSymbol]: todayLevMockChain } : {}) }
        : { [proxySymbol]: todayMockChain, [leveragedSymbol]: todayLevMockChain ?? todayMockChain }
      : undefined;
    profRecord('chainLookup', __tChainA);
    (phaseProfiler as any)?.record?.('chainLookupDecision', performance.now() - __tChainA);

    // ── Settle any ICs expiring today ────────────────────────────────────────
    const __tExecB = profMark();
    const expiredICs = pendingICs.filter(ic => ic.expiry <= today.date);
    for (const ic of expiredICs) {
      const { cashImpact, pnl, note } = finalizeIronCondor({ position: ic, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0 });
      const effect = applyOptionExecution({ cashImpact, pnl });
      if (!independentIC) applyOverlayEffect(effect);
      tradeLog.push({
        signalDate: today.date,
        date: today.date,
        symbol: ironCondorName,
        side: 'BUY',
        quantity: ic.quantity,
        fillPrice: 0,
        cashImpact: effect.cashDelta,
        rationale: note,
        action: 'SETTLE',
        strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR,
        pnl: effect.pnl,
        executionReason: '到期结算',
        outcomeReason: note,
        outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
      });
    }
    for (let j = pendingICs.length - 1; j >= 0; j--) {
      if (pendingICs[j].expiry <= today.date) pendingICs.removeAt(j);
    }

    // ── IC early exit: per-mode delta / 20d range breach (with buffer) / opt-in profit-take ──
    if (checkOptionExitsThisBar && useMockOptions && pendingICs.length > 0) {
      const icMode = config.strategyParams?.icMode ?? 'standard';
      const icCfg  = IC_MODE_CONFIG[icMode];
      const icProfitTakeEnabled = config.strategyParams?.icProfitTakeEnabled ?? false;
      const icProfitTarget = config.strategyParams?.icProfitTarget ?? IC_PROFIT_TARGET_DEFAULT;
      for (let j = pendingICs.length - 1; j >= 0; j--) {
        const ic = pendingICs[j];
        if (ic.exitScheduled) continue;
        const daysLeft = Math.max(
          (new Date(ic.expiry).getTime() - todayTime) / 86400000,
          0
        );
        if (daysLeft <= 0) continue;

        const T  = Math.max(daysLeft / 365, 1 / 365);
        const r  = riskFreeRate;
        const ev = effectiveVix(pricingVolToday, pricingVol3mToday, daysLeft);
        const q  = dividendYieldForSymbol('QQQ');

        // intrabarStops: judge put-side risk off the bar low, call-side off the high.
        const lowPx  = intrabarStops ? today.low  : today.close;
        const highPx = intrabarStops ? today.high : today.close;

        const shortPutBs  = bs(lowPx,  ic.putShort,  T, r, ivAt(ev, 'QQQ', lowPx,  ic.putShort,  optionSkewSlope), q);
        const shortCallBs = bs(highPx, ic.callShort, T, r, ivAt(ev, 'QQQ', highPx, ic.callShort, optionSkewSlope), q);
        const putDelta    = Math.abs(shortPutBs.putDelta);
        const callDelta   = shortCallBs.callDelta;

        // Probe the mark-to-market P&L for the opt-in profit-take (cheap; only used if needed)
        const probe = closeIronCondorAtMark(ic, today.date, today.close, pricingVolToday, 'probe', pricing, pricingVol3mToday);
        const reason = evaluateIronCondorExit({
          expiry: ic.expiry,
          creditReceived: ic.creditReceived,
          range20dHigh: ic.range20dHigh,
          range20dLow: ic.range20dLow,
          mode: icMode,
          exitDelta: icCfg.exitDelta,
          rangeBufferPct: icCfg.rangeBufferPct,
          asOfDate: today.date,
          regime: decisionMemory.prevRegime,
          daysLeft,
          putDelta,
          callDelta,
          lowPrice: lowPx,
          highPrice: highPx,
          unrealizedPnl: probe.pnl,
          profitTakeEnabled: icProfitTakeEnabled,
          profitTarget: icProfitTarget,
        });
        if (reason === null) continue;

        ic.exitScheduled = true;
        pendingOptionCloses.push({
          kind: 'IC',
          ic,
          reason,
          signalDate: today.date,
          signalUnderlying: today.close,
          signalVix: vixToday,
          signalVix3m: vix3mToday,
          signalPricingVol: pricingVolToday,
          signalPricingVol3m: pricingVol3mToday,
        });
      }
    }

    // ── Collar: expiry settlement or early exit ──────────────────────────────
    const collarModeNow = config.strategyParams?.collarMode ?? 'reactive';
    for (let j = pendingCollars.length - 1; j >= 0; j--) {
      const collar = pendingCollars[j];
      if (collar.exitScheduled) continue;
      const daysLeft = (new Date(collar.expiry).getTime() - todayTime) / 86400000;

      if (daysLeft <= 0) {
        // At / past expiry — settle at intrinsic (leveraged ETF price, not QQQ)
        const { cashImpact, pnl, note } = finalizeCollar({ collar, asOfDate: today.date, leveragedClose: leveragedDayPrice, qqqClose: today.close, vix: pricingVolToday, leveragedSymbol, pricing, vix3m: pricingVol3mToday, commission: 0, splitAdjustmentFactors: marketSplitFactors(today.date) });
        const effect = applyOptionExecution({ cashImpact, pnl });
        applyOverlayEffect(effect, 'collar');
        recordCollarClose(collar, today.date, leveragedDayPrice, effect.cashDelta, effect.pnl, note, true);
        tradeLog.push({
          signalDate: today.date,
          date: today.date, symbol: collarName(leveragedSymbol), side: 'SELL',
          quantity: collar.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: note, action: 'SETTLE', strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, pnl: effect.pnl,
          executionReason: '到期结算', outcomeReason: note,
          outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
        });
        pendingCollars.removeAt(j);
      } else if (checkOptionExitsThisBar && useMockOptions) {
        // Early exit checks (run in priority order, only one fires per day)
        // Use leveraged ETF price for B-S since all collar legs are on the leveraged ETF
        const T  = Math.max(daysLeft / 365, 1 / 365);
        const r  = riskFreeRate;
        const ev = effectiveVix(pricingVolToday, pricingVol3mToday, daysLeft);
        const q  = dividendYieldForSymbol(leveragedSymbol);

        // intrabarStops: short call + adverse MtM are upside events (judge off the bar
        // high); long-put delta + short-put breach are downside events (off the low).
        const levHigh = intrabarStops ? leveragedBar.high : leveragedDayPrice;
        const levLow  = intrabarStops ? leveragedBar.low  : leveragedDayPrice;
        const putSymbol = collar.putUnderlying ?? leveragedSymbol;
        const putHigh = putSymbol === 'QQQ' ? (intrabarStops ? today.high : today.close) : levHigh;
        const putLow = putSymbol === 'QQQ' ? (intrabarStops ? today.low : today.close) : levLow;
        const putOpen = putSymbol === 'QQQ' ? today.open : leveragedOpenPrice;

        const callBs = collar.callStrike ? bs(levHigh, collar.callStrike, T, r, ivAt(ev, leveragedSymbol, levHigh, collar.callStrike, optionSkewSlope), q) : null;
        // Long-put delta check uses the downside extreme.
        const putBs  = collar.putStrike > 0
          ? bs(putLow, collar.putStrike, T, r, ivAt(ev, putSymbol, putLow, collar.putStrike, optionSkewSlope), dividendYieldForSymbol(putSymbol))
          : { putDelta: 0 };

        // Adverse MtM stop (upside): value all legs at the high so a short call going
        // ITM is captured even if the bar closed back down.
        const collarMtM = markCollarToMarket(collar, today.date, levHigh, pricingVolToday, leveragedSymbol, pricing, pricingVol3mToday, putHigh, marketSplitFactors(today.date));
        const mtmExtraLoss = collar.netDebit - collarMtM; // positive = cumulative additional loss vs open
        // overheat collar is specifically placed to cap a hot market — wider delta before exiting
        // (0.50 vs 0.35) lets it absorb normal continuation before we pay time value to get out.
        // MtM stop still fires so we don't ride a deep-ITM call all the way to expiry.
        const callExitDelta = collar.triggerScenario === 'overheat' ? COLLAR_CALL_EXIT_DELTA_OVERHEAT : COLLAR_CALL_EXIT_DELTA;

        // Drawdown recovery: symmetric to the 3% open trigger — if price nearly returned to 20d high,
        // the open condition is gone and protection should be removed proactively.
        // Must read the day-aggregated decisionViewState (like the v2 strategy's open-side
        // rollingHigh), not raw qqqBars — at intraday timeframes qqqBars is bar-spaced, not
        // day-spaced, so a raw 20-bar slice there is only ~3 trading days at 1h, not 20 days.
        const exitLookback = Math.min(COLLAR_DRAWDOWN_PERIOD_EXIT, decisionViewState.qqq.length);
        const exitRecentHigh = exitLookback > 0
          ? Math.max(...decisionViewState.qqq.slice(-exitLookback).map(b => b.close))
          : today.close;
        const exitDrawdownPct = exitRecentHigh > today.close
          ? (exitRecentHigh - today.close) / exitRecentHigh
          : 0;
        const exitScenario =
          collar.triggerScenario === 'overheat' ||
          collar.triggerScenario === 'weakening' ||
          collar.triggerScenario === 'drawdown' ||
          collar.triggerScenario === 'vix_spike'
            ? collar.triggerScenario
            : undefined;
        const sharedExit = evaluateExitConditions({
          type: 'collar',
          expiry: collar.expiry,
          scenario: exitScenario,
          putStrike: collar.putStrike,
          shortPutStrike: collar.shortPutStrike,
          callStrike: collar.callStrike,
        }, {
          asOfDate: today.date,
          regime: decisionMemory.prevRegime,
          vix: vixToday,
          dte: daysLeft,
          leveragedSpot: putLow,
          currentLeveragedPrice: putLow,
          shortCallDelta: callBs?.callDelta,
          longPutDelta: putBs.putDelta,
          totalCloseCost: mtmExtraLoss / Math.max(collar.quantity, 1),
        }).find(s => s.auto && s.severity === 'CLOSE');

        const collarExitProfile = config.strategyParams?.collarExitProfile ?? 'legacy';
        const exit = evaluateCollarExit({
          shortPutStrike: collar.shortPutStrike, putStrike: collar.putStrike, putSymbol, putOpen, putLow, putDelta: putBs.putDelta,
          callDelta: callBs?.callDelta, callExitDelta, mtmExtraLoss,
          stopLoss: COLLAR_STOP_PER_CONTRACT * collar.quantity, longPutExitDelta: COLLAR_LONG_PUT_EXIT_DELTA,
          sharedExitKey: sharedExit?.key, daysLeft, exitProfile: collarExitProfile, mode: collarModeNow,
          scenario: collar.triggerScenario, regime: decisionMemory.prevRegime, vix: vixToday, vixExit: COLLAR_VIX_REGIME_EXIT,
          drawdownRecovery: COLLAR_DRAWDOWN_RECOVERY, exitDrawdownPct,
        });
        const exitReason = exit.reason;
        const exitPrice = exit.exitAtOpen ? leveragedOpenPrice : leveragedDayPrice;

        if (exitReason !== null) {
          const exitState = advanceCollarExitState({ profile: collarExitProfile, reason: exitReason, previousKey: collar.exitConfirmKey, previousBars: collar.exitConfirmBars, exitAtOpen: exit.exitAtOpen });
          collar.exitConfirmKey = exitState.exitConfirmKey;
          collar.exitConfirmBars = exitState.exitConfirmBars;
          if (!exitState.shouldClose) continue;
          if (exit.exitAtOpen) {
            // Gap breach: fill immediately at current bar open, do not enqueue
            const { cashImpact, pnl, note } = closeV2CollarAtMark(collar, today.date, exitPrice, pricingVolToday, leveragedSymbol, exitReason, pricing, pricingVol3mToday, today.open, marketSplitFactors(today.date));
            const closeComm = optCommission(1 + (collar.shortPutStrike ? 1 : 0) + (collar.callStrike ? 1 : 0), collar.quantity);
            const effect = applyOptionExecution({ cashImpact, pnl }, closeComm);
            applyOverlayEffect(effect, 'collar');
            recordCollarClose(collar, today.date, exitPrice, effect.cashDelta, effect.pnl, exitReason, false);
            tradeLog.push({
              signalDate: today.date,
              date: today.date, symbol: collarName(leveragedSymbol), side: 'BUY',
              quantity: collar.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: note, action: 'CLOSE', strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, pnl: effect.pnl,
              executionReason: '提前平仓', outcomeReason: exitReason ?? undefined,
              outcomeReasonKey: getOptionOutcomeReasonKey(exitReason ?? '', false),
            });
            pendingCollars.removeAt(j);
          } else {
            // Regular early exit: decouple and enqueue for next_open
            collar.exitScheduled = exitState.scheduleNextOpen;
            pendingOptionCloses.push({
              kind: 'COLLAR',
              collar,
              reason: exitReason,
              signalDate: today.date,
              signalUnderlying: leveragedDayPrice,
              signalQqq: today.close,
              signalVix: vixToday,
              signalVix3m: vix3mToday,
              signalPricingVol: pricingVolToday,
              signalPricingVol3m: pricingVol3mToday,
            });
          }
        }
      }
    }

	    // ── Settle any Call Spreads expiring today ───────────────────────────────
    for (let j = pendingCSes.length - 1; j >= 0; j--) {
	      const cs = pendingCSes[j];
	      if (cs.expiry > today.date) continue;
	      const meta = callCreditSpreadTradeMeta('CS', cs.shortStrike, cs.longStrike, proxySymbol);
	      const { cashImpact, pnl, note } = finalizeCallCreditSpread({ position: cs, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0, label: meta.label });
      const effect = applyOptionExecution({ cashImpact, pnl });
      if (!independentCS) applyOverlayEffect(effect);
      if (cs.route !== 'secondary_budget') {
              csBreachState = updateCSBreachStateOnClose(csBreachState, { pnl, shortStrike: cs.shortStrike, date: today.date, qqqClose: today.close });
              updateWr89AfterPrimaryClose(pnl);
	      }
	      tradeLog.push({
	        signalDate: today.date,
	        date: today.date, symbol: meta.symbol, side: 'BUY',
	        quantity: cs.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `${note} [${callSpreadLayerLabel(cs)}]`, action: 'SETTLE', strategyTag: meta.strategyTag, pnl: effect.pnl,
	        executionReason: '到期结算', outcomeReason: note,
	        outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
	      });
      pendingCSes.removeAt(j);
    }

    for (let j = pendingPCSes.length - 1; j >= 0; j--) {
      const pcs = pendingPCSes[j];
      if (pcs.expiry > today.date) continue;
      const { cashImpact, pnl, note } = finalizePutCreditSpread({ position: pcs, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0 });
      const effect = applyOptionExecution({ cashImpact, pnl });
      if (!independentPCS) applyOverlayEffect(effect);
      pcsStreakState = updatePcsStreakStateOnClose(pcsStreakState, { pnl: effect.pnl, closeDate: today.date, cooldownTradingDays: config.strategyParams?.pcsStreakCooldownTradingDays ?? 0, tradingDayCalendar: tradingDayDates });
      pcsResearchP1LastSettledPnl = effect.pnl;
      execution.pcsDynamicEntryProfile?.onClose?.({ signalDate: pcs.openedAt ?? today.date, closeDate: today.date, pnl: effect.pnl });
      if (pcs.pathDiagnostic) {
        pcs.pathDiagnostic.closeDate = today.date;
        pcs.pathDiagnostic.closeAction = 'SETTLE';
        pcs.pathDiagnostic.realizedPnl = effect.pnl;
      }
        tradeLog.push({ signalDate: today.date, date: today.date, expiry: pcs.expiry, symbol: putCreditSpreadTradeMeta('PCS', pcs.longStrike, pcs.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: pcs.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `${note}，exp ${pcs.expiry}`, action: 'SETTLE', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, pnl: effect.pnl, executionReason: '到期结算', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, true) });
      pendingPCSes.removeAt(j);
    }

    // PCS_RESCUE 独立账本到期/终局结算；不写入主 optionCash，因此不会改变主 PCS 基线曲线。
    for (let j = pendingPCSRescues.length - 1; j >= 0; j--) {
      const rescue = pendingPCSRescues[j];
      if (rescue.expiry > today.date) continue;
      const { cashImpact, pnl, note } = finalizePutCreditSpread({ position: rescue, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0, label: 'PCS Rescue' });
      const effect = applyOptionExecution({ cashImpact, pnl });
      tradeLog.push({ signalDate: rescue.openedAt, date: today.date, expiry: rescue.expiry, symbol: putCreditSpreadTradeMeta('PCS_RESCUE', rescue.longStrike, rescue.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: rescue.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `${note.replace('Put Credit Spread', 'PCS Rescue')}，exp ${rescue.expiry}`, action: 'SETTLE', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE, pnl: effect.pnl, executionReason: '到期结算', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, true) });
      pendingPCSRescues.removeAt(j);
    }

    for (let j = pendingEquityBoosts.length - 1; j >= 0; j--) {
      const eb = pendingEquityBoosts[j];
      if (eb.expiry > today.date) continue;
      const { cashImpact, pnl, note } = finalizePutCreditSpread({ position: eb, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0 });
      const effect = scaleIndependentEquityBoostEffect(applyOptionExecution({ cashImpact, pnl }), eb);
      recordEquityBoostCandidate6Close(effect.pnl);
      if (!independentEquityBoost) applyOverlayEffect(effect);
        tradeLog.push({ signalDate: today.date, date: today.date, expiry: eb.expiry, symbol: putCreditSpreadTradeMeta('EQUITY_BOOST', eb.longStrike, eb.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: eb.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `${note.replace('Put Credit Spread', 'Equity Boost Put Spread')}，exp ${eb.expiry}`, action: 'SETTLE', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, pnl: effect.pnl, executionReason: '到期结算', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, true) });
      pendingEquityBoosts.removeAt(j);
    }

    // ── Equity Boost early exit: forced close on regime flip into BEAR/CRISIS/crisis PENDING/CONFIRMED,
    // or opt-in profit-target take (no delta-stop — the long OTM put already defines the loss cap) ──
    if (checkOptionExitsThisBar && useMockOptions && pendingEquityBoosts.length > 0) {
      const ebProfitTakeEnabled = config.strategyParams?.equityBoostProfitTarget != null;
      const ebProfitTarget = config.strategyParams?.equityBoostProfitTarget ?? 0.5;
      const ebProfitTargetMode = config.strategyParams?.equityBoostProfitTargetMode ?? 'fixed';
      const ebProfitTargetPriceThreshold = config.strategyParams?.equityBoostProfitTargetPriceThresholdPct ?? .10;
      const ebForceCloseRegime = decisionMemory.prevRegime === 'BEAR' || decisionMemory.prevRegime === 'CRISIS' ||
        crisisState.phase === 'PENDING' || crisisState.phase === 'CONFIRMED';
      for (let j = pendingEquityBoosts.length - 1; j >= 0; j--) {
        const eb = pendingEquityBoosts[j];
        if (eb.exitScheduled) continue;
        const daysLeft = Math.max((new Date(eb.expiry).getTime() - todayTime) / 86400000, 0);
        if (daysLeft <= 0) continue;

        const { pnl } = closePutCreditSpreadAtMark(eb, today.date, today.close, pricingVolToday, 'mark', pricing, pricingVol3mToday);

        let reason: string | null = null;
        const entryPriceVsSma200Pct = eb.marketContext?.priceVsSma200Pct;
        const entryProfitTakeAllowed = ebProfitTargetMode === 'entry_price_adaptive_v1'
          ? (typeof entryPriceVsSma200Pct === 'number' && Number.isFinite(entryPriceVsSma200Pct) && entryPriceVsSma200Pct < ebProfitTargetPriceThreshold)
          : ebProfitTargetMode === 'entry_bad_sr01_adaptive_v1'
            ? eb.marketContext?.slowSubregime === 'SR01' && (eb.marketContext?.regime === 'BULL' || eb.marketContext?.regime === 'RISK_ON_WEAKENING')
            : true;
        if (ebForceCloseRegime) {
          reason = `regime=${decisionMemory.prevRegime}/crisisPhase=${crisisState.phase} 触发次日强制平仓`;
        } else if (ebProfitTakeEnabled && entryProfitTakeAllowed && pnl >= eb.creditReceived * ebProfitTarget) {
          reason = `提前止盈（达到 credit 的 ${(ebProfitTarget * 100).toFixed(0)}%）`;
        }
        if (reason === null) continue;

        eb.exitScheduled = true;
        pendingOptionCloses.push({
          kind: 'EQUITY_BOOST',
          equityBoost: eb,
          reason,
          signalDate: today.date,
          signalUnderlying: today.close,
          signalVix: vixToday,
          signalVix3m: vix3mToday,
          signalPricingVol: pricingVolToday,
          signalPricingVol3m: pricingVol3mToday,
        });
      }
    }

    // ── PCS early exit: short put delta stop, or profit-target take (both opt-in switches) ──
    if (checkOptionExitsThisBar && useMockOptions && pendingPCSes.length > 0) {
      const pcsDeltaStopEnabled = config.strategyParams?.pcsDeltaStopEnabled ?? false;
      const pcsDeltaStopThreshold = config.strategyParams?.pcsDeltaStopThreshold ?? PCS_DELTA_STOP_DEFAULT;
      const pcsProfitTakeEnabled = config.strategyParams?.pcsProfitTakeEnabled ?? false;
      const pcsProfitTarget = config.strategyParams?.pcsProfitTarget ?? PCS_PROFIT_TARGET_DEFAULT;
      const probabilityReferenceExitMode = config.strategyParams?.pcsProbabilityReferenceExitMode ?? 'hold_to_expiry';
      for (let j = pendingPCSes.length - 1; j >= 0; j--) {
        const pcs = pendingPCSes[j];
        recordPcsPathBar(pcs, today);
        if (pcs.exitScheduled) continue;
        const daysLeft = Math.max(
          (new Date(pcs.expiry).getTime() - todayTime) / 86400000,
          0
        );
        if (daysLeft <= 0) continue;

        const T  = Math.max(daysLeft / 365, 1 / 365);
        const r  = riskFreeRate;
        const ev = effectiveVix(pricingVolToday, pricingVol3mToday, daysLeft);
        const q  = dividendYieldForSymbol('QQQ');
        // Short-put breach is a downside event → judge off the bar low when enabled.
        const lowPx = intrabarStops ? today.low : today.close;

        const shortPutBs = bs(lowPx, pcs.shortStrike, T, r, ivAt(ev, 'QQQ', lowPx, pcs.shortStrike, optionSkewSlope), q);
        const { cashImpact, pnl, costPerShare } = closePutCreditSpreadAtMark(pcs, today.date, today.close, pricingVolToday, 'mark', pricing, pricingVol3mToday);
        const existingReason = evaluatePutCreditSpreadExit({
          expiry: pcs.expiry, creditReceived: pcs.creditReceived, asOfDate: today.date, regime: decisionMemory.prevRegime,
          daysLeft, shortPutDelta: shortPutBs.putDelta, lowPrice: lowPx, unrealizedPnl: pnl,
          deltaStopEnabled: pcsDeltaStopEnabled, deltaStopThreshold: pcsDeltaStopThreshold,
          profitTakeEnabled: pcsProfitTakeEnabled, profitTarget: pcsProfitTarget,
        });
        // 开仓发生于 openedAt 的开盘；当日 high/low 尚不可用于该头寸，最早下一根日线判定。
        const probabilityReason = (pcs.openedAt == null || pcs.openedAt < today.date)
          ? probabilityReferenceExitReason(probabilityReferenceExitMode, pcs, today.low, today.high)
          : null;
        const pathEligible = pcs.openedAt == null || pcs.openedAt < today.date;
        const survivalEnabledForProbability = pcsSurvivalExitMode === 'probability' || pcsSurvivalExitMode === 'both';
        const survival = survivalEnabledForProbability && pathEligible
          ? survivalAtAsOf(today.date, today.close, pcs.shortStrike, tradingSessionsRemaining(today.date, pcs.expiry), decisionViewState.qqq)
          : null;
        const currentNoTouch = survival?.noTouch.value ?? null;
        const openNoTouch = pcs.pathDiagnostic?.openNoTouchSurvival ?? null;
        const probabilitySurvivalReason = currentNoTouch != null && currentNoTouch <= pcsSurvivalFloor
          ? `生存率退出：条件化 no-touch ${((currentNoTouch) * 100).toFixed(1)}% ≤ 下限 ${(pcsSurvivalFloor * 100).toFixed(0)}%`
          : currentNoTouch != null && openNoTouch != null && openNoTouch - currentNoTouch >= pcsSurvivalDrop
            ? `生存率退出：no-touch 从 ${(openNoTouch * 100).toFixed(1)}% 降至 ${(currentNoTouch * 100).toFixed(1)}%，下降 ${( (openNoTouch - currentNoTouch) * 100).toFixed(1)}pp`
            : null;
        const openVix = pcs.marketContext?.vix;
        const touchVixEligible = pcsSurvivalTouchVixThreshold === undefined
          ? true
          : typeof openVix === 'number' && openVix < pcsSurvivalTouchVixThreshold;
        const touchReason = (pcsSurvivalExitMode === 'touch' || pcsSurvivalExitMode === 'both') && touchVixEligible
          ? pcsSurvivalTouchExitReason({
            confirmation: pcsSurvivalTouchConfirmation,
            openedAt: pcs.openedAt ?? '',
            shortStrike: pcs.shortStrike,
            current: today,
            previous: qqqBars[i - 1],
            bufferPct: pcsSurvivalTouchBufferPct,
          })
          : null;
        const survivalReason = probabilitySurvivalReason ?? touchReason;
        if (survivalReason && pcs.pathDiagnostic) {
          pcs.pathDiagnostic.survivalExitSignalDate = today.date;
          pcs.pathDiagnostic.survivalExitReason = survivalReason;
        }
        const reason = survivalReason ?? probabilityReason ?? existingReason;
        if (reason === null) continue;

        pcs.exitScheduled = true;
        pendingOptionCloses.push({
          kind: 'PCS',
          pcs,
          reason,
          signalDate: today.date,
          signalUnderlying: today.close,
          signalVix: vixToday,
          signalVix3m: vix3mToday,
          signalPricingVol: pricingVolToday,
          signalPricingVol3m: pricingVol3mToday,
        });
      }
    }

    // ── CS early exit: short call delta > 0.35, or profit-target take (opt-in switch) ──
    if (checkOptionExitsThisBar && useMockOptions && pendingCSes.length > 0) {
      const csProfitTakeEnabled = config.strategyParams?.csProfitTakeEnabled ?? false;
      const csProfitTarget = config.strategyParams?.csProfitTarget ?? CS_PROFIT_TARGET_DEFAULT;
      const csProfitTakeMode = config.strategyParams?.csProfitTakeMode ?? 'fixed';
      const csConditionalProfitTakeMaxDte = config.strategyParams?.csConditionalProfitTakeMaxDte ?? 14;
      const csSlowTrendProfitTarget = config.strategyParams?.csSlowTrendProfitTarget;
      const csSlowTrendConditionalPtMaxDte = config.strategyParams?.csSlowTrendConditionalPtMaxDte;
      const csDeltaStopMode = config.strategyParams?.csDeltaStopMode ?? 'fixed';
      const csDeltaStopBaseThreshold = config.strategyParams?.csDeltaStopThreshold ?? CS_EARLY_EXIT_DELTA;
      const csDeltaStopCalmVix = config.strategyParams?.csDeltaStopCalmVix ?? 18;
      const csDeltaStopRiskVix = config.strategyParams?.csDeltaStopRiskVix ?? 20;
      const csDeltaStopCalmRoc20 = config.strategyParams?.csDeltaStopCalmRoc20 ?? .20;
      const csDeltaStopCalmThreshold = config.strategyParams?.csDeltaStopCalmThreshold ?? .40;
      const csDeltaStopRiskThreshold = config.strategyParams?.csDeltaStopRiskThreshold ?? .30;
      const csSlowTrendExitMode = config.strategyParams?.csSlowTrendExitMode ?? 'off';
      const csSlowTrendVixMax = config.strategyParams?.csSlowTrendVixMax ?? 20;
      const csSlowTrendSlopeMinPct = config.strategyParams?.csSlowTrendSlopeMinPct ?? 0;
      const csSlowTrendQqqRoc20Min = config.strategyParams?.csSlowTrendQqqRoc20Min ?? 0;
      const csSlowTrendQqqRoc5Max = config.strategyParams?.csSlowTrendQqqRoc5Max ?? .04;
      const csSlowTrendDeltaStopThreshold = config.strategyParams?.csSlowTrendDeltaStopThreshold ?? .35;
      const csSlowTrendDeltaStopHysteresis = config.strategyParams?.csSlowTrendDeltaStopHysteresis ?? .03;
      const csSlowTrendFastAccelerationRoc5 = config.strategyParams?.csSlowTrendFastAccelerationRoc5 ?? .04;
      const csSlowTrendFastAccelerationSlopePct = config.strategyParams?.csSlowTrendFastAccelerationSlopePct ?? .015;
      const csSlowTrendFastAccelerationDeltaStopThreshold = config.strategyParams?.csSlowTrendFastAccelerationDeltaStopThreshold ?? .30;
      const csSlowTrendFastAccelerationEmergency = config.strategyParams?.csSlowTrendFastAccelerationEmergency ?? false;
  const csDeltaAccelerationThreshold = config.strategyParams?.csDeltaAccelerationThreshold;
      const csSlowTrendBlockExtended = config.strategyParams?.csSlowTrendBlockExtended ?? false;
      const csSlowTrendExtendedTqqqRoc20Min = config.strategyParams?.csSlowTrendExtendedTqqqRoc20Min ?? .20;
      const csExtendedLowVixDeltaCap = config.strategyParams?.csExtendedLowVixDeltaCap;
      const csExtendedLowVixVixMax = config.strategyParams?.csExtendedLowVixVixMax ?? 18;
      const csExtendedLowVixTqqqRoc20Min = config.strategyParams?.csExtendedLowVixTqqqRoc20Min ?? .20;
      const csExtendedLowVixImmediateClose = config.strategyParams?.csExtendedLowVixImmediateClose ?? false;
      const csExtendedLowVixImmediateCloseMode = config.strategyParams?.csExtendedLowVixImmediateCloseMode ?? 'signal_close';
      const needsCurrentExtendedState = csSlowTrendBlockExtended
        || csExtendedLowVixDeltaCap !== undefined
        || config.strategyParams?.csTransitionExitMode !== undefined && config.strategyParams.csTransitionExitMode !== 'off';
      // Exit management must use the last complete TQQQ day; current-day bars may only be partial
      // when intrabarStops is enabled and must not decide whether a 40% threshold is allowed.
      const priorLeveragedBars = decisionViewState.leveraged.filter((bar) => bar.date < today.date);
      const tqqqRoc20AtPriorClose = priorLeveragedBars.length > 20 ? rocAtEnd(priorLeveragedBars, 20) : undefined;
      for (let j = pendingCSes.length - 1; j >= 0; j--) {
        const cs = pendingCSes[j];
        if (cs.exitScheduled) continue;
        const coverageExitProfile = cs.exitProfile;
        const coverageExitActive = coverageExitProfile !== undefined;
        const daysLeft = Math.max(
          (new Date(cs.expiry).getTime() - todayTime) / 86400000,
          0
        );
        if (daysLeft <= 0) continue;

        const T  = Math.max(daysLeft / 365, 1 / 365);
        const r  = riskFreeRate;
        const ev = effectiveVix(pricingVolToday, pricingVol3mToday, daysLeft);
        const q  = dividendYieldForSymbol('QQQ');
        // Short-call breach is an upside event → judge off the bar high when enabled.
        const highPx = intrabarStops ? today.high : today.close;

        const shortCallBs = bs(highPx, cs.shortStrike, T, r, ivAt(ev, 'QQQ', highPx, cs.shortStrike, optionSkewSlope), q);
        const closeCallBs = bs(today.close, cs.shortStrike, T, r, ivAt(ev, 'QQQ', today.close, cs.shortStrike, optionSkewSlope), q);
        const priorBar = i > 0 ? qqqBars[i - 1] : undefined;
        const priorDaysLeft = priorBar
          ? Math.max((new Date(cs.expiry).getTime() - new Date(priorBar.date).getTime()) / 86400000, 0)
          : 0;
        const priorPricingVol = priorBar ? resolvePricingVolAt(priorBar.date, vixPrev) : undefined;
        const priorPricingVol3m = priorBar && priorPricingVol !== undefined
          ? resolvePricingVol3mAt(priorBar.date, vixPrev, priorPricingVol)
          : undefined;
        const priorT = Math.max(priorDaysLeft / 365, 1 / 365);
        const priorEv = priorPricingVol !== undefined ? effectiveVix(priorPricingVol, priorPricingVol3m, priorDaysLeft) : undefined;
        const previousCloseDelta = priorBar && priorEv !== undefined
          ? bs(priorBar.close, cs.shortStrike, priorT, r, ivAt(priorEv, 'QQQ', priorBar.close, cs.shortStrike, optionSkewSlope), q).callDelta
          : undefined;
        const qqqRoc5AtClose = qqqRolling.rocAt(i, 5);
        const qqqRoc20AtClose = qqqRolling.rocAt(i, 20);
        const sma20AtClose = qqqRolling.smaAt(i, 20);
        const sma20FiveBarsAgo = i >= 5 ? qqqRolling.smaAt(i - 5, 20) : 0;
        const sma20SlopePctAtClose = sma20FiveBarsAgo > 0 ? (sma20AtClose - sma20FiveBarsAgo) / sma20FiveBarsAgo : undefined;
        const currentRiskOnExtended = needsCurrentExtendedState
          ? isCallCreditSpreadRiskOnExtended({
              price: today.close,
              sma20: sma20AtClose,
              sma50: qqqRolling.smaAt(i, 50),
              sma200: qqqRolling.smaAt(i, 200),
              rsi14: qqqRolling.rsiAt(i, 14),
              priceExtensionAtr: (() => {
                const atr14 = qqqRolling.atrAt(i, 14);
                return atr14 > 0 && sma20AtClose > 0 ? (today.close - sma20AtClose) / atr14 : 0;
              })(),
              vix: pricingVolToday,
            })
          : false;
        const transitionRescueActive = config.strategyParams?.csTransitionExitMode === 'rescue_extended_transition'
          && currentRiskOnExtended
          && (decisionMemory.prevRegime === 'BULL' || decisionMemory.prevRegime === 'RANGE_BOUND');
        const transitionExitActive = (config.strategyParams?.csTransitionExitMode === 'confirm_extended_transition' || transitionRescueActive)
          && currentRiskOnExtended
          && (decisionMemory.prevRegime === 'BULL' || decisionMemory.prevRegime === 'RANGE_BOUND');
        const slowTrend = transitionExitActive || isCallCreditSpreadSlowTrend({
          regime: decisionMemory.prevRegime,
          vix: pricingVolToday,
          vix3m: pricingVol3mToday,
          tqqqRoc20: tqqqRoc20AtPriorClose,
          riskOnExtended: currentRiskOnExtended,
          sma20SlopePct: sma20SlopePctAtClose,
          qqqRoc5: qqqRoc5AtClose,
          qqqRoc20: qqqRoc20AtClose,
          vixMax: csSlowTrendVixMax,
          slopeMinPct: csSlowTrendSlopeMinPct,
          qqqRoc20Min: csSlowTrendQqqRoc20Min,
          qqqRoc5Max: csSlowTrendQqqRoc5Max,
          blockExtended: csSlowTrendBlockExtended,
          extendedTqqqRoc20Min: csSlowTrendExtendedTqqqRoc20Min,
        });
        const fastAcceleration = isCallCreditSpreadFastAcceleration({
          regime: decisionMemory.prevRegime,
          sma20SlopePct: sma20SlopePctAtClose,
          qqqRoc5: qqqRoc5AtClose,
          qqqRoc20: qqqRoc20AtClose,
          roc5Min: csSlowTrendFastAccelerationRoc5,
          slopeMinPct: csSlowTrendFastAccelerationSlopePct,
        });
        const extendedLowVixCapActive = csExtendedLowVixDeltaCap !== undefined
          && isCallCreditSpreadExtendedLowVix({
            regime: decisionMemory.prevRegime,
            riskOnExtended: currentRiskOnExtended,
            vix: pricingVolToday,
            tqqqRoc20: tqqqRoc20AtPriorClose,
            qqqRoc20: qqqRoc20AtClose,
            vixMax: csExtendedLowVixVixMax,
            tqqqRoc20Min: csExtendedLowVixTqqqRoc20Min,
          });
        const csResearchDaysHeldRiskThreshold = resolveCallCreditSpreadDaysHeldRiskThreshold({
          mode: config.strategyParams?.csResearchDaysHeldExitMode,
          openDate: cs.openDate,
          asOfDate: today.date,
          minDays: config.strategyParams?.csResearchDaysHeldExitMin,
          maxDays: config.strategyParams?.csResearchDaysHeldExitMax,
          riskThreshold: config.strategyParams?.csResearchDaysHeldRiskThreshold,
          regime: decisionMemory.prevRegime,
          regimeScope: config.strategyParams?.csResearchDaysHeldExitRegimeScope,
        });
        const { cashImpact, pnl, costPerShare } = closeCallCreditSpreadAtMark(cs, today.date, today.close, pricingVolToday, 'mark', pricing, pricingVol3mToday);
        const csMfeKey = `${cs.openDate ?? cs.expiry}|${cs.expiry}|${cs.shortStrike}|${cs.longStrike}|${cs.quantity}`;
        const priorMfe = csMfeByPosition.get(csMfeKey);
        const maxFavorablePnl = Math.max(priorMfe ?? pnl, pnl);
        csMfeByPosition.set(csMfeKey, maxFavorablePnl);
        const csDeltaStopThreshold = coverageExitActive
          ? coverageExitProfile.deltaStopThreshold
          : resolveCallCreditSpreadDeltaStopThreshold({
          mode: csDeltaStopMode,
          regime: decisionMemory.prevRegime,
          vix: pricingVolToday,
          vix3m: pricingVol3mToday,
          tqqqRoc20: tqqqRoc20AtPriorClose,
          qqqRoc5: qqqRoc5AtClose,
          qqqRoc20: qqqRoc20AtClose,
          sma20SlopePct: sma20SlopePctAtClose,
          fixedThreshold: csDeltaStopBaseThreshold,
          wideThreshold: config.strategyParams?.csDeltaStopWideThreshold,
          wideRegime: config.strategyParams?.csDeltaStopWideRegime,
          wideTqqqRoc20Min: config.strategyParams?.csDeltaStopWideTqqqRoc20Min,
          calmVix: csDeltaStopCalmVix,
          riskVix: csDeltaStopRiskVix,
          calmRoc20: csDeltaStopCalmRoc20,
          calmThreshold: csDeltaStopCalmThreshold,
          riskThreshold: csResearchDaysHeldRiskThreshold ?? csDeltaStopRiskThreshold,
          riskGuardMode: config.strategyParams?.csResearchRiskGuardMode,
          riskGuardVixChange5d: csResearchVixChange5d,
          riskGuardThreshold: csResearchDaysHeldRiskThreshold ?? config.strategyParams?.csResearchRiskGuardThreshold,
          slowTrendExitMode: csSlowTrendExitMode,
          slowTrendVixMax: csSlowTrendVixMax,
          slowTrendSlopeMinPct: csSlowTrendSlopeMinPct,
          slowTrendQqqRoc20Min: csSlowTrendQqqRoc20Min,
          slowTrendQqqRoc5Max: csSlowTrendQqqRoc5Max,
          slowTrendBlockExtended: csSlowTrendBlockExtended,
          slowTrendExtendedTqqqRoc20Min: csSlowTrendExtendedTqqqRoc20Min,
          slowTrendThreshold: csSlowTrendDeltaStopThreshold,
          slowTrendHysteresis: csSlowTrendDeltaStopHysteresis,
          fastAcceleration,
          fastAccelerationEmergency: csSlowTrendFastAccelerationEmergency,
          fastAccelerationThreshold: csSlowTrendFastAccelerationDeltaStopThreshold,
          riskOnExtended: currentRiskOnExtended,
          extendedLowVixDeltaCap: csExtendedLowVixDeltaCap,
          extendedLowVixVixMax: csExtendedLowVixVixMax,
          extendedLowVixTqqqRoc20Min: csExtendedLowVixTqqqRoc20Min,
        });
      const deltaStopTriggered = shouldTriggerCallCreditSpreadDeltaStop({
          // Coverage exits are intentionally stateless: no slow-trend delay, and the
          // short leg is judged immediately against its position-level threshold.
          slowTrend: coverageExitActive ? false : slowTrend,
          fastAcceleration: coverageExitActive ? false : fastAcceleration,
          fastAccelerationEmergency: coverageExitActive ? false : csSlowTrendFastAccelerationEmergency,
          immediateDeltaStop: coverageExitActive || extendedLowVixCapActive,
          mode: coverageExitActive ? 'off' : csSlowTrendExitMode,
          intradayDelta: shortCallBs.callDelta,
          closeDelta: closeCallBs.callDelta,
          previousCloseDelta,
          threshold: csDeltaStopThreshold,
        });
      const deltaAccelerationTriggered = isCallCreditSpreadDeltaAcceleration({
          previousCloseDelta,
          currentDelta: shortCallBs.callDelta,
          threshold: csDeltaAccelerationThreshold,
        });
      const useCloseDeltaForSlowConfirmation = !coverageExitActive && slowTrend && (csSlowTrendExitMode === 'confirm2' || csSlowTrendExitMode === 'confirm2_hysteresis');
        const wr89RescueActive = !coverageExitActive && deltaStopTriggered
          && (config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_falling_weak'
            || config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_falling_nonpositive'
            || config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_nonrising_weak'
            || config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_falling_only')
          && daysLeft >= (config.strategyParams?.csResearchDeltaStopRescueMinDaysLeft ?? 14)
          && (config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_falling_only'
            ? true
            : config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_nonrising_weak'
            ? (csResearchVixChange5d ?? 0) <= 0
            : (csResearchVixChange5d ?? 0) < 0)
          && (config.strategyParams?.csResearchDeltaStopRescueMode === 'vix_falling_nonpositive'
            ? (tqqqRoc20AtPriorClose ?? 0) <= 0
            : (tqqqRoc20AtPriorClose ?? 0) < 0);
        const mfeRescueActive = !coverageExitActive && deltaStopTriggered
          && config.strategyParams?.csMfeRescueMode === 'positive_mfe_near_stop'
          && priorMfe !== undefined
          && maxFavorablePnl >= cs.creditReceived * (config.strategyParams?.csMfeRescueMinPnlPctOfCredit ?? 0)
          && pnl >= -cs.creditReceived * (config.strategyParams?.csMfeRescueMaxCurrentLossPctOfCredit ?? .50)
          && daysLeft >= (config.strategyParams?.csMfeRescueMinDaysLeft ?? 5)
          && daysLeft <= (config.strategyParams?.csMfeRescueMaxDaysLeft ?? 14);
        if (config.strategyParams?.csMfeRescueMode === 'positive_mfe_near_stop' && deltaStopTriggered) {
          csMfeRescueDiagnostics.deltaStopTriggered++;
          if (priorMfe !== undefined) csMfeRescueDiagnostics.priorMfeAvailable++;
          if (priorMfe !== undefined && maxFavorablePnl >= cs.creditReceived * (config.strategyParams?.csMfeRescueMinPnlPctOfCredit ?? 0)) csMfeRescueDiagnostics.mfeThresholdMet++;
          if (pnl >= -cs.creditReceived * (config.strategyParams?.csMfeRescueMaxCurrentLossPctOfCredit ?? .50)) csMfeRescueDiagnostics.lossThresholdMet++;
          if (daysLeft >= (config.strategyParams?.csMfeRescueMinDaysLeft ?? 5) && daysLeft <= (config.strategyParams?.csMfeRescueMaxDaysLeft ?? 14)) csMfeRescueDiagnostics.dteWindowMet++;
          if (mfeRescueActive) csMfeRescueDiagnostics.activated++;
        }
        const reason = evaluateCallCreditSpreadExit({
          expiry: cs.expiry,
          creditReceived: cs.creditReceived,
          asOfDate: today.date,
          regime: decisionMemory.prevRegime,
          daysLeft,
          shortCallDelta: useCloseDeltaForSlowConfirmation ? closeCallBs.callDelta : shortCallBs.callDelta,
          highPrice: highPx,
          unrealizedPnl: pnl,
          profitTakeEnabled: coverageExitActive ? true : csProfitTakeEnabled,
          profitTarget: coverageExitActive ? coverageExitProfile.profitTarget : csProfitTarget,
          profitTargetRegimeMode: coverageExitActive ? undefined : config.strategyParams?.csProfitTargetRegimeMode,
          profitTargetRegimeValue: coverageExitActive ? undefined : config.strategyParams?.csProfitTargetRegimeValue,
          profitTakeMode: coverageExitActive ? 'fixed' : csProfitTakeMode,
          conditionalProfitTakeMaxDte: coverageExitActive ? undefined : csConditionalProfitTakeMaxDte,
          conditionalProfitTakeRiskMode: coverageExitActive ? undefined : config.strategyParams?.csConditionalProfitTakeRiskMode,
          conditionalProfitTakeWeakeningVixMin: coverageExitActive ? undefined : config.strategyParams?.csConditionalProfitTakeWeakeningVixMin,
          vix: pricingVolToday,
          vix3m: pricingVol3mToday,
          deltaStopThreshold: deltaAccelerationTriggered ? 0 : (deltaStopTriggered && !wr89RescueActive && !mfeRescueActive && !transitionRescueActive ? csDeltaStopThreshold : Number.POSITIVE_INFINITY),
          deltaAccelerationTriggered,
          previousCloseDelta,
          isSlowTrend: coverageExitActive ? false : slowTrend,
          slowTrendProfitTarget: coverageExitActive ? undefined : csSlowTrendProfitTarget,
          slowTrendConditionalPtMaxDte: coverageExitActive ? undefined : csSlowTrendConditionalPtMaxDte,
          maxLossDollars: coverageExitActive ? undefined : resolveCallCreditSpreadMaxLossDollars({
            absoluteCap: config.strategyParams?.csResearchMaxLossDollars,
            navPct: config.strategyParams?.csResearchMaxLossNavPct,
            nav: portfolio.leveragedShares * leveragedDayPrice + portfolio.boxxShares * boxxDayPrice + portfolio.cash,
            riskPct: config.strategyParams?.csResearchMaxLossRiskPct,
            width: cs.width,
            quantity: cs.quantity,
            creditReceived: cs.creditReceived,
          }),
        });
        if (reason === null) continue;
        const sameDayCapStop = csExtendedLowVixImmediateClose
          && extendedLowVixCapActive
          && deltaStopTriggered
          && reason.startsWith('短腿 Call');
        if (sameDayCapStop) {
          const signalClose = closeCallCreditSpreadAtMark(cs, today.date, today.close, pricingVolToday, reason, pricing, pricingVol3mToday);
          const nextDayVix = nextDay ? resolveVolAt(nextDay.date, vixByDate) : vixToday;
          const nextDayPricingVol = nextDay ? resolvePricingVolAt(nextDay.date, nextDayVix) : pricingVolToday;
          const nextDayPricingVol3m = nextDay ? resolvePricingVol3mAt(nextDay.date, nextDayVix, nextDayPricingVol) : pricingVol3mToday;
          const nextOpen = nextDay
            ? closeCallCreditSpreadAtMark(cs, nextDay.date, nextDay.open, nextDayPricingVol, reason, pricing, nextDayPricingVol3m)
            : signalClose;
          const selectedClose = csExtendedLowVixImmediateCloseMode === 'worst_of'
            ? executeScheduledOptionClose({ mode: 'worst_of', nextOpen, signalClose, commission: 0, impact: 0 })
            : { chosen: signalClose };
          const choseNextOpen = selectedClose.chosen === nextOpen && nextDay !== undefined;
          const closeComm = optCommission(2, cs.quantity);
          const closeImp = closeImpactDollars('QQQ', choseNextOpen ? nextDay.open : today.close, cs.shortStrike, cs.quantity, choseNextOpen ? nextDayVix : vixToday);
          const effect = applyOptionExecution(selectedClose.chosen, closeComm, closeImp);
          const netPnl = selectedClose.chosen.pnl - closeComm - closeImp;
          if (cs.route !== 'secondary_budget') {
          csBreachState = updateCSBreachStateOnClose(csBreachState, { pnl: netPnl, shortStrike: cs.shortStrike, date: today.date, qqqClose: today.close });
          updateWr89AfterPrimaryClose(netPnl);
          }
          const totalCost = selectedClose.chosen.costPerShare * 100 * cs.quantity;
          const executionLabel = csExtendedLowVixImmediateCloseMode === 'worst_of' ? '同日 cap worst-of 模型平仓' : '同日 cap signal-close 模型平仓';
          const note = `${executionLabel} Call Spread [${reason}]，回购成本 $${totalCost.toFixed(0)}，净 ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(0)}`;
          if (!independentCS) applyOverlayEffect(effect);
          tradeLog.push(buildCallCreditSpreadCloseTrade({
            position: cs,
            kind: 'CS',
            signalDate: today.date,
            date: today.date,
            fillPrice: selectedClose.chosen.costPerShare,
            cashImpact: effect.cashDelta,
            rationale: `${note} [${callSpreadLayerLabel(cs)}]`,
            pnl: effect.pnl,
            outcomeReason: reason,
          }));
          pendingCSes.removeAt(j);
        } else {
          cs.exitScheduled = true;
          pendingOptionCloses.push({
            kind: 'CS',
            cs,
            reason,
            signalDate: today.date,
            signalUnderlying: today.close,
            signalVix: vixToday,
            signalVix3m: vix3mToday,
            signalPricingVol: pricingVolToday,
            signalPricingVol3m: pricingVol3mToday,
          });
        }
      }
    }

    // ── Bear Call Spread: settlement and exit rules ─────────────────────────
	    for (let j = pendingBearCSes.length - 1; j >= 0; j--) {
	      const bcs = pendingBearCSes[j];
	      if (bcs.expiry > today.date) continue;
	      const meta = callCreditSpreadTradeMeta('BEAR_CS', bcs.shortStrike, bcs.longStrike, proxySymbol);
	      const { cashImpact, pnl, note } = finalizeCallCreditSpread({ position: bcs, asOfDate: today.date, qqqClose: today.close, vix: pricingVolToday, pricing, vix3m: pricingVol3mToday, commission: 0, label: meta.label });
	      const effect = applyOptionExecution({ cashImpact, pnl });
	      if (!independentBearCS) applyOverlayEffect(effect);
	      csBreachState = updateCSBreachStateOnClose(csBreachState, { pnl, shortStrike: bcs.shortStrike, date: today.date, qqqClose: today.close });
	      tradeLog.push({
	        signalDate: today.date,
	        date: today.date, symbol: meta.symbol, side: 'BUY',
	        quantity: bcs.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: note, action: 'SETTLE', strategyTag: meta.strategyTag, pnl: effect.pnl,
	        executionReason: '到期结算', outcomeReason: note,
	        outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
	      });
      pendingBearCSes.removeAt(j);
    }

    if (checkOptionExitsThisBar && useMockOptions && pendingBearCSes.length > 0) {
      for (let j = pendingBearCSes.length - 1; j >= 0; j--) {
        const bcs = pendingBearCSes[j];
        if (bcs.exitScheduled) continue;
        const daysLeft = Math.max(
          (new Date(bcs.expiry).getTime() - todayTime) / 86400000,
          0
        );
        if (daysLeft <= 0) continue;

        const T  = Math.max(daysLeft / 365, 1 / 365);
        const r  = riskFreeRate;
        const ev = effectiveVix(pricingVolToday, pricingVol3mToday, daysLeft);
        const q  = dividendYieldForSymbol('QQQ');
        // Short-call breach / stop-cost are upside events → judge off the bar high.
        const highPx = intrabarStops ? today.high : today.close;
        const shortCallBs = bs(highPx, bcs.shortStrike, T, r, ivAt(ev, 'QQQ', highPx, bcs.shortStrike, optionSkewSlope), q);
        const { cashImpact, pnl, costPerShare } = closeCallCreditSpreadAtMark(bcs, today.date, highPx, pricingVolToday, 'mark', pricing, pricingVol3mToday);
        const totalCloseCost = costPerShare * 100 * bcs.quantity;
        const sma200 = sma200For(i);
        const roc5 = roc5For(i);
        const strongUp = hasThreeStrongUpDaysFor(i);
        const stopCost = Math.min(BEAR_CS_STOP_LOSS_CREDIT_MULT * bcs.creditReceived, BEAR_CS_STOP_LOSS_MAX_LOSS_PCT * bcs.maxLoss);
        const sharedExitSignals = evaluateExitConditions({
          type: 'bear_cs',
          expiry: bcs.expiry,
          bearCredit: bcs.creditReceived,
          bearMaxLoss: bcs.maxLoss,
        }, {
          asOfDate: today.date,
          regime: decisionMemory.prevRegime,
          dte: daysLeft,
          qqqPrice: today.close,
          sma200,
          roc5,
          shortCallDelta: shortCallBs.callDelta,
          totalCloseCost,
        }).filter(s => s.auto && s.severity === 'CLOSE');
        const sharedExit = (key: typeof sharedExitSignals[number]['key']) =>
          sharedExitSignals.find(s => s.key === key);

        const bearProfitTarget = config.strategyParams?.bearProfitTarget ?? BEAR_CS_PROFIT_TARGET_DEFAULT;
        let exitReason: string | null = null;
        if (totalCloseCost <= bcs.creditReceived * (1 - bearProfitTarget)) {
          exitReason = `盈利达到 credit 的 ${(bearProfitTarget * 100).toFixed(0)}%`;
        } else if (sharedExit('delta_stop')) {
          exitReason = `short call Delta ${(shortCallBs.callDelta * 100).toFixed(0)}% > ${(BEAR_CS_DELTA_EXIT * 100).toFixed(0)}%`;
        } else if (sharedExit('sma200_reclaim')) {
          exitReason = `${proxySymbol} 收盘 ${today.close.toFixed(2)} 上穿 SMA200 ${sma200.toFixed(2)}`;
        } else if (sharedExit('roc5_exit') && (
          config.strategyParams?.bearRoc5ExitRequiresLoss !== true ||
          totalCloseCost > bcs.creditReceived
        )) {
          exitReason = `${proxySymbol} 5日涨幅 ${(roc5 * 100).toFixed(1)}% > ${(BEAR_CS_ROC5_EXIT * 100).toFixed(0)}%`;
        } else if (strongUp) {
          exitReason = `${proxySymbol} 连续 3 天强涨`;
        } else if (sharedExit('dte_exit')) {
          exitReason = `DTE=${daysLeft.toFixed(0)} < ${BEAR_CS_DTE_EXIT}`;
        } else if (sharedExit('stop_loss')) {
          exitReason = `回购成本 $${totalCloseCost.toFixed(0)} >= 止损阈值 $${stopCost.toFixed(0)}`;
        }

        if (exitReason !== null) {
          bcs.exitScheduled = true;
          pendingOptionCloses.push({
            kind: 'BEAR_CS',
            bearCS: bcs,
            reason: exitReason,
            signalDate: today.date,
            signalUnderlying: today.close,
            signalVix: vixToday,
            signalVix3m: vix3mToday,
            signalPricingVol: pricingVolToday,
            signalPricingVol3m: pricingVol3mToday,
          });
        }
      }
    }

    // ── Compute NAV after all settlements ────────────────────────────────────
    const leveragedValue = portfolio.leveragedShares * leveragedDayPrice;
    const boxxValue      = portfolio.boxxShares      * boxxDayPrice;
    const icOptionMtM = independentIC ? 0 : pendingICs.reduce((sum, ic) => sum + markICToMarket(ic, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday), 0);
    const csOptionMtM = independentCS ? 0 : pendingCSes.reduce((sum, cs) => sum + markCSToMarket(cs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday), 0);
    const pcsOptionMtM = independentPCS ? 0 : pendingPCSes.reduce((sum, pcs) => sum + markPCSToMarket(pcs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday), 0);
    const equityBoostOptionMtM = independentEquityBoost ? 0 : pendingEquityBoosts.reduce((sum, eb) => sum + markPCSToMarket(eb, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday), 0);
    const bearCSOptionMtM = independentBearCS ? 0 : pendingBearCSes.reduce((sum, bcs) => sum + markCSToMarket(bcs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday), 0);
    const collarOptionMtM = config.strategyParams?.collarCashMode === 'shadow' ? 0 : pendingCollars.reduce(
      (sum, collar) => sum + markCollarToMarket(collar, today.date, leveragedDayPrice, pricingVolToday, leveragedSymbol, pricing, pricingVol3mToday, today.close, marketSplitFactors(today.date)),
      0
    );
    const optionMtM = icOptionMtM + csOptionMtM + pcsOptionMtM + equityBoostOptionMtM + bearCSOptionMtM + collarOptionMtM;
    const stockNav = leveragedValue + boxxValue + portfolio.cash;
    const nav = stockNav + optionCash + optionMtM;
    navDrawdownPeak = Math.max(navDrawdownPeak, stockNav);
    profRecord('execution', __tExecB);

    const __tPipeline = profMark();
    const decisionViews = {
      qqq: decisionViewState.qqq,
      leveraged: decisionViewState.leveraged,
      boxx: decisionViewState.boxx,
      spy: decisionViewState.spy,
    };

    // Advance crisis state machine on the strategy decision cadence. Intraday bars keep
    // hourly NAV, but crisis confirmation/recovery remains day-based.
    if (isDecisionBar) {
      crisisState = transitionCrisis(crisisState, prevCrisisRaw, {
        ...config.strategyParams,
        crisisRecoveryBars: policyCrisisRecoveryBars ?? config.strategyParams?.crisisRecoveryBars,
      });
      if (config.strategyParams?.macroRegime) {
        const replayPhase = config.macroRegimePhaseByDate?.[today.date];
        if (config.macroRegimePhaseByDate && !replayPhase) throw new Error(`Missing precomputed macro regime phase for ${today.date}`);
        // W7/W9/W10 是日频状态机（不走 transitionMacroRegime 的周戳短路），每个 decision bar 推进一次
        macroRegimeState = replayPhase
          ? { phase: replayPhase, weekStamp: isoWeek(today.date) }
          : config.strategyParams.macroRegime.classifier === 'w10-balanced'
          ? advanceW10MacroRegime(
              macroRegimeState,
              { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined },
            )
          : config.strategyParams.macroRegime.classifier === 'w11-observe'
          ? advanceW11MacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined })
          : config.strategyParams.macroRegime.classifier === 'w9-fast'
          ? advanceW9MacroRegime(
              macroRegimeState,
              { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined },
            )
          : config.strategyParams.macroRegime.classifier === 'w7-hybrid'
          ? advanceW7MacroRegime(
              macroRegimeState,
              { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined },
            )
          : transitionMacroRegime(
              macroRegimeState,
              { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate },
              config.strategyParams.macroRegime.classifier === 'w0-week-raw' ? computeWeeklyVoteFromDailyEngine
                : config.strategyParams.macroRegime.classifier === 'w5-hybrid' ? computeHybridVote
                : undefined
            );
      }
      if (crisisState.phase === 'NONE' && prevCrisisPhaseForFastEntry === 'RECOVERY') {
        postCrisisBars = 0;
      } else if (crisisState.phase === 'NONE') {
        postCrisisBars++;
      } else {
        postCrisisBars = -1;
      }
      prevCrisisPhaseForFastEntry = crisisState.phase;
    }

    // Research-only conditional Growth ceiling. Conditions are evaluated from the
    // decision view available through today, so the 2026 low-VIX fast-drop path is
    // visible even when the crisis state machine has not entered PENDING yet.
    const conditionalGrowthCap = config.strategyParams?.conditionalGrowthCap;
    if (isDecisionBar && conditionalGrowthCap) {
      const qqqThroughToday = decisionViews.qqq;
      const qqqToday = qqqThroughToday.at(-1)?.close ?? 0;
      const qqqPrev = qqqThroughToday.at(-2)?.close ?? 0;
      const qqqOneDayReturn = qqqPrev > 0 ? (qqqToday - qqqPrev) / qqqPrev : 0;
      const vixTrigger = conditionalGrowthCap.vixMin != null
        && Number.isFinite(vixToday)
        && vixToday >= conditionalGrowthCap.vixMin;
      const priceShockTrigger = conditionalGrowthCap.qqqOneDayShockPct != null
        && qqqOneDayReturn <= conditionalGrowthCap.qqqOneDayShockPct;
      const cumulativeShockTrigger = Object.entries(conditionalGrowthCap.qqqCumulativeShockPct ?? {}).some(([lookback, threshold]) => {
        const bars = Number(lookback);
        const priorClose = qqqThroughToday.at(-(bars + 1))?.close ?? 0;
        return (bars === 2 || bars === 5)
          && typeof threshold === 'number'
          && Number.isFinite(threshold)
          && priorClose > 0
          && qqqToday / priorClose - 1 <= threshold;
      });
      const pendingTrigger = crisisState.phase === 'PENDING';
      const trigger = vixTrigger || priceShockTrigger || cumulativeShockTrigger || pendingTrigger;
      const recoveryConfirmed = crisisState.phase === 'NONE'
        && qqqThroughToday.length >= 20
        && qqqToday >= smaAtEnd(qqqThroughToday, 20)
        && rocAtEnd(qqqThroughToday, 5) >= 0;
      if (recoveryConfirmed) {
        conditionalGrowthCapReleaseBars = 0;
      } else if (trigger) {
        conditionalGrowthCapReleaseBars = Math.max(0, Math.floor(conditionalGrowthCap.releaseBars ?? 2));
      } else if (conditionalGrowthCapReleaseBars > 0) {
        conditionalGrowthCapReleaseBars--;
      }
      conditionalGrowthCapActive = trigger || conditionalGrowthCapReleaseBars > 0;
    } else if (isDecisionBar) {
      conditionalGrowthCapReleaseBars = 0;
      conditionalGrowthCapActive = false;
    }

    const optionPositions = [
      ...(independentIC ? [] : pendingICs.flatMap((ic, idx) => {
        const groupId = `backtest-ic-${idx}-${ic.expiry}`;
        const totalMtM = markICToMarket(ic, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday);
        return [
          { symbol: 'QQQ', strike: ic.putShort, expiry: ic.expiry, type: 'put' as const, quantity: -ic.quantity, marketValue: totalMtM, delta: optionDelta('QQQ', 'put', today.close, ic.putShort, ic.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, groupId, side: 'short' as const, creditReceived: ic.creditReceived },
          { symbol: 'QQQ', strike: ic.putLong, expiry: ic.expiry, type: 'put' as const, quantity: ic.quantity, marketValue: 0, delta: optionDelta('QQQ', 'put', today.close, ic.putLong, ic.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, groupId, side: 'long' as const, creditReceived: ic.creditReceived },
          { symbol: 'QQQ', strike: ic.callShort, expiry: ic.expiry, type: 'call' as const, quantity: -ic.quantity, marketValue: 0, delta: optionDelta('QQQ', 'call', today.close, ic.callShort, ic.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, groupId, side: 'short' as const, creditReceived: ic.creditReceived },
          { symbol: 'QQQ', strike: ic.callLong, expiry: ic.expiry, type: 'call' as const, quantity: ic.quantity, marketValue: 0, delta: optionDelta('QQQ', 'call', today.close, ic.callLong, ic.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, groupId, side: 'long' as const, creditReceived: ic.creditReceived },
        ];
      })),
      // Keep independent CS positions in the diagnostic trace. This array is
      // trace-only; it is not used for option cash, execution, or strategy decisions.
      ...pendingCSes.flatMap((cs, idx) => {
        const groupId = `backtest-call-spread-${idx}-${cs.expiry}`;
        const totalMtM = markCSToMarket(cs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday);
        return [
          { symbol: 'QQQ', strike: cs.shortStrike, expiry: cs.expiry, type: 'call' as const, quantity: -cs.quantity, marketValue: totalMtM, delta: optionDelta('QQQ', 'call', today.close, cs.shortStrike, cs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD, groupId, side: 'short' as const, creditReceived: cs.creditReceived },
          { symbol: 'QQQ', strike: cs.longStrike, expiry: cs.expiry, type: 'call' as const, quantity: cs.quantity, marketValue: 0, delta: optionDelta('QQQ', 'call', today.close, cs.longStrike, cs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD, groupId, side: 'long' as const, creditReceived: cs.creditReceived },
        ];
      }),
      ...(independentPCS ? [] : pendingPCSes.flatMap((pcs, idx) => {
        const groupId = `backtest-put-spread-${idx}-${pcs.expiry}`;
        const totalMtM = markPCSToMarket(pcs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday);
        return [
          { symbol: 'QQQ', strike: pcs.shortStrike, expiry: pcs.expiry, type: 'put' as const, quantity: -pcs.quantity, marketValue: totalMtM, delta: optionDelta('QQQ', 'put', today.close, pcs.shortStrike, pcs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, groupId, side: 'short' as const, creditReceived: pcs.creditReceived },
          { symbol: 'QQQ', strike: pcs.longStrike, expiry: pcs.expiry, type: 'put' as const, quantity: pcs.quantity, marketValue: 0, delta: optionDelta('QQQ', 'put', today.close, pcs.longStrike, pcs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, groupId, side: 'long' as const, creditReceived: pcs.creditReceived },
        ];
      })),
      ...(independentEquityBoost ? [] : pendingEquityBoosts.flatMap((eb, idx) => {
        const groupId = `backtest-equity-boost-${idx}-${eb.expiry}`;
        const totalMtM = markPCSToMarket(eb, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday);
        return [
          { symbol: 'QQQ', strike: eb.shortStrike, expiry: eb.expiry, type: 'put' as const, quantity: -eb.quantity, marketValue: totalMtM, delta: optionDelta('QQQ', 'put', today.close, eb.shortStrike, eb.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, groupId, side: 'short' as const, creditReceived: eb.creditReceived },
          { symbol: 'QQQ', strike: eb.longStrike, expiry: eb.expiry, type: 'put' as const, quantity: eb.quantity, marketValue: 0, delta: optionDelta('QQQ', 'put', today.close, eb.longStrike, eb.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, groupId, side: 'long' as const, creditReceived: eb.creditReceived },
        ];
      })),
      ...pendingCollars.flatMap((collar, idx) => {
        const groupId = `backtest-collar-${idx}-${collar.expiry}`;
        const totalMtM = markCollarToMarket(collar, today.date, leveragedDayPrice, pricingVolToday, leveragedSymbol, pricing, pricingVol3mToday, today.close, marketSplitFactors(today.date));
        const putSymbol = collar.putUnderlying ?? leveragedSymbol;
        const putSpot = putSymbol === 'QQQ' ? today.close : leveragedDayPrice;
        return [
          ...(collar.putStrike > 0 ? [{ symbol: putSymbol, strike: collar.putStrike, expiry: collar.expiry, type: 'put' as const, quantity: collar.putQuantity ?? collar.quantity, marketValue: totalMtM, delta: optionDelta(putSymbol, 'put', putSpot, collar.putStrike, collar.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, groupId, side: 'long' as const, contractMultiplier: collar.putContractMultiplier, splitAdjustmentFactor: collar.putSplitAdjustmentFactor }] : []),
          ...(collar.shortPutStrike ? [{ symbol: putSymbol, strike: collar.shortPutStrike, expiry: collar.expiry, type: 'put' as const, quantity: -(collar.putQuantity ?? collar.quantity), marketValue: 0, delta: optionDelta(putSymbol, 'put', putSpot, collar.shortPutStrike, collar.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, groupId, side: 'short' as const, contractMultiplier: collar.putContractMultiplier, splitAdjustmentFactor: collar.putSplitAdjustmentFactor }] : []),
          ...(collar.callStrike ? [{ symbol: leveragedSymbol, strike: collar.callStrike, expiry: collar.expiry, type: 'call' as const, quantity: -(collar.callQuantity ?? collar.quantity), marketValue: 0, delta: optionDelta(leveragedSymbol, 'call', leveragedDayPrice, collar.callStrike, collar.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, groupId, side: 'short' as const, contractMultiplier: collar.callContractMultiplier, splitAdjustmentFactor: collar.callSplitAdjustmentFactor }] : []),
        ];
      }),
      ...(independentBearCS ? [] : pendingBearCSes.flatMap((bcs, idx) => {
        const groupId = `backtest-bear-bcs-${idx}-${bcs.openedAt}`;
        const totalMtM = markCSToMarket(bcs, today.date, today.close, pricingVolToday, pricing, pricingVol3mToday);
        return [
          { symbol: 'QQQ', strike: bcs.shortStrike, expiry: bcs.expiry, type: 'call' as const, quantity: -bcs.quantity, marketValue: totalMtM, delta: optionDelta('QQQ', 'call', today.close, bcs.shortStrike, bcs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD, groupId, side: 'short' as const, openedAt: bcs.openedAt, creditReceived: bcs.creditReceived, maxLoss: bcs.maxLoss },
          { symbol: 'QQQ', strike: bcs.longStrike, expiry: bcs.expiry, type: 'call' as const, quantity: bcs.quantity, marketValue: 0, delta: optionDelta('QQQ', 'call', today.close, bcs.longStrike, bcs.expiry, today.date, pricingVolToday, pricing, optionSkewSlope, pricingVol3mToday), strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD, groupId, side: 'long' as const, openedAt: bcs.openedAt, creditReceived: bcs.creditReceived, maxLoss: bcs.maxLoss },
        ];
      })),
    ];

    if (isDecisionBar && stockNav <= 0) {
      blownUp = true;
      const previous = equityCurve.at(-1);
      if (previous) {
        equityCurve.push({
          ...previous,
          date: today.date,
          nav,
          cashValue: portfolio.cash + optionCash,
          tqqqValue: leveragedValue,
          boxxValue,
          tqqqPct: 0,
          boxxPct: 0,
          tqqqShares: portfolio.leveragedShares,
          boxxShares: portfolio.boxxShares,
          hasOpenIC: pendingICs.length > 0,
          hasOpenCollar: pendingCollars.length > 0,
          hasOpenCS: pendingCSes.length > 0,
          hasOpenBearCS: pendingBearCSes.length > 0,
          hasOpenEquityBoost: pendingEquityBoosts.length > 0,
          benchmarkPrice: today.close,
      leveragedPrice: leveragedDayPrice,
      targetVolOverride: config.targetVolByDate?.[today.date],
      sidewaysFactorOverride: config.sidewaysFactorByDate?.[today.date],
    });
      }
      if (trace?.at(-1)) trace.push({ ...trace.at(-1)!, date: today.date, nav, cash: portfolio.cash + optionCash, tqqqShares: portfolio.leveragedShares, tqqqValue: leveragedValue, boxxShares: portfolio.boxxShares, boxxValue, optionPositions });
      break;
    }

    const conditionalGrowthCapCandidates = [
      conditionalGrowthCapActive ? conditionalGrowthCap?.capPct : undefined,
      config.conditionalGrowthWarnCapPctByDate?.[today.date],
    ].filter((value): value is number => Number.isFinite(value));
    const effectiveConditionalGrowthWarnCapPct = conditionalGrowthCapCandidates.length > 0
      ? Math.min(...conditionalGrowthCapCandidates)
      : undefined;
    const marketInput = {
      date: today.date,
      equityBoostEntryGate: config.equityBoostEntryGate,
      equityBoostContractGate: config.equityBoostContractGate,
      optionUnderlyingSymbol: config.optionUnderlyingSymbol,
      leveragedSymbol,
      prevCloseNav,
      navDrawdownPeak,
      postCrisisBars,
      lastLeveragedTrade,
      crisisPhase: crisisState.phase,
      macroRegimeState: macroExecutionDriver === 'slow-macro' && config.strategyParams?.macroRegime ? macroRegimeState : undefined,
      macroExecutionDriver,
      // Research-only; derived from the immediately preceding completed bar.
      researchPreviousRegime: lastMarketContext?.regime,
      slowSubregimeFactors: slowSubregime?.factors,
      stockGrowthEligible: config.stockGrowthBlockedDates?.[today.date] !== true,
      equityBoostEntryBlocked: config.equityBoostEntryBlockedDates?.[today.date] === true,
      pcsEntryBlocked: config.pcsEntryBlockedDates?.[today.date] === true,
      pcsDynamicEntryProfile: execution.pcsDynamicEntryProfile,
      pcsDynamicMarketHistory,
      csEntryBlocked: config.csEntryBlockedDates?.[today.date] === true,
      stockRecoveryBoostPct: config.stockRecoveryBoostPctByDate?.[today.date],
      stockPostParticipationBoostPct: config.stockPostParticipationBoostPctByDate?.[today.date],
      stockPostParticipationBoostRegimes: config.stockPostParticipationBoostRegimes,
      conditionalGrowthWarnCapPct: effectiveConditionalGrowthWarnCapPct,
      hardCapRaiseOverride: config.hardCapRaiseOverrideByDate?.[today.date],
      hardCapOverride: config.researchHardCapOverrideByDate?.[today.date],
      rangeBoundCapOverride: config.rangeBoundCapOverrideByDate?.[today.date],
      regimeConfirmState: config.strategyParams?.regimeConfirmBars ? decisionMemory.regimeConfirmState : undefined,
      targetWeightSmoothingState: config.strategyParams?.targetWeightSmoothing ? decisionMemory.targetWeightSmoothingState : undefined,
      trendParticipationState: config.strategyParams?.trendParticipationRelease ? decisionMemory.trendParticipationState : undefined,
      trendBudgetRefillState: config.strategyParams?.trendParticipationRelease?.trendBudgetRefill ? decisionMemory.trendBudgetRefillState : undefined,
      flashCrashState: config.strategyParams?.flashCrashOverride ? decisionMemory.flashCrashState : undefined,
      tailRiskRawTrigger: config.tailRiskTriggerByDate?.[today.date] === true,
      tailRiskMultiplier: config.tailRiskMultiplierByDate?.[today.date],
      tailRiskState: config.strategyParams?.tailRiskOverride ? decisionMemory.tailRiskState : undefined,
      pcsPageSignalStreak: decisionMemory.pcsPageSignalStreak,
      equityBoostDteState: config.strategyParams?.equityBoostDteMode === 'risk_adaptive_hysteresis_v1' || config.strategyParams?.equityBoostDteMode === 'state_adaptive_sr01_v1' || config.strategyParams?.equityBoostDteMode === 'state_adaptive_bad_sr01_v1' || config.strategyParams?.equityBoostDteMode === 'price_adaptive_v1' ? equityBoostDteState : undefined,
      equityBoostCandidate6State: config.strategyParams?.equityBoostCandidate6Mdd === true
        ? {
          openCount: pendingEquityBoosts.length,
          realizedDrawdown: Math.max(0, equityBoostCandidate6RealizedPeak - equityBoostCandidate6RealizedPnl),
        }
        : undefined,
      sellerStatsAsOf,
      callStrikeSurvivalAsOf,
      putStrikeSurvivalAsOf,
      csBreachState,
      csEventRiskState,
      ...((csResearchEntryGate && csResearchEntryGate !== 'off') || config.strategyParams?.csValidatedSafeReleaseMode !== undefined && config.strategyParams.csValidatedSafeReleaseMode !== 'off' ? { csResearchWeakPersistenceDays } : {}),
      ...((csResearchEntryGate && csResearchEntryGate !== 'off') || config.strategyParams?.csResearchVxnRescueDelta !== undefined || config.strategyParams?.csVxnRescueSizeMultiplier !== undefined || config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union_slow_vix' ? { csResearchVixChange5d } : {}),
      ...(config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union_slow_vix' ? { csResearchVixChangePoints: (() => {
        const horizon = config.strategyParams?.csValidatedSafeVixHorizon ?? 5;
        const previous = i >= horizon ? resolveOptionalVolAt(qqqBars[i - horizon]!.date, vixByDate) : undefined;
        return typeof previous === 'number' && Number.isFinite(previous) && Number.isFinite(vixToday) ? vixToday - previous : undefined;
      })() } : {}),
      ...(config.strategyParams?.csResearchVxnRescueDelta !== undefined || config.strategyParams?.csVxnRescueSizeMultiplier !== undefined ? { csResearchVxn: vxnToday } : {}),
      csSecondaryEventRiskState,
      pcsStreakState,
      pcsResearchP1BullStressStreak,
      pcsResearchP1LastSettledPnl,
      trace: config.trace,
      targetVolOverride: config.targetVolByDate?.[today.date],
      sidewaysFactorOverride: config.sidewaysFactorByDate?.[today.date],
      intradayGateBacktestEnabled: isIntradayBacktest,
      strategyParams: { ...applyMacroBoostBlock(config.strategyParams, today.date, config.macroBoostBlockedDates), optionsBacktestPositionMode: positionMode } as NonNullable<BacktestConfig['strategyParams']>,
      account: {
        netLiquidation: stockNav,
        cash: portfolio.cash,
        positions: [
          { symbol: leveragedSymbol, quantity: portfolio.leveragedShares, marketValue: leveragedValue, averageCost: portfolio.leveragedShares > 0 ? portfolio.leveragedCostBasis / portfolio.leveragedShares : undefined },
          { symbol: 'BOXX', quantity: portfolio.boxxShares,      marketValue: boxxValue },
        ].filter(p => p.quantity > 0 || p.marketValue > 0),
        optionPositions: [],
      },
      prices: {
        QQQ:  decisionViews.qqq,
        SPY: decisionViews.spy,
        TQQQ: decisionViews.leveraged,
        BOXX: decisionViews.boxx,
      },
      currentPrices: {
        QQQ: today.close,
        leveraged: leveragedDayPrice,
        BOXX: boxxDayPrice,
      },
      macro: {
        vix: vixToday,
        prevVix: vixPrev,
        vix3m: vix3mToday,
        vix5dAgo: i >= 5 ? resolveOptionalVolAt(qqqBars[i - 5]!.date, vixByDate) : undefined,
        ...(config.strategyParams?.enablePCS === true || config.strategyParams?.csVxnRescueSizeMultiplier !== undefined || config.strategyParams?.csValidatedSafeReleaseMode === 'validated_safe_fk_union_slow_vix'
          ? { vxn: vxnToday, vxnHistory: pcsVxnHistory ?? decisionViews.qqq.map(bar => resolveOptionalVolAt(bar.date, vxnMap)).filter((value): value is number => value != null) }
          : config.strategyParams?.enableEquityBoostPCS === true
          ? { vxn: vxnToday, vxnHistory: ebVxnHistory ?? decisionViews.qqq.map(bar => resolveOptionalVolAt(bar.date, vxnMap)).filter((value): value is number => value != null) }
          : {}),
      },
      // decisionViews.qqq is index-aligned with qqqBars (== qqqBars.slice(0, i+1)) only in the
      // non-intraday case (see appendRawRange above); intraday aggregation produces a different
      // series, so omit the precomputed fast path there and let 03/04 fall back to plain calc*().
      precomputedIndicators: isIntradayBacktest ? undefined : { qqq: qqqRolling, tqqq: tqqqRolling },
      optionChains,
    };

    const output = runBacktestPipeline(marketInput, pipelineOptions ?? (execution.pipelineStageProfiler ? { profiler: execution.pipelineStageProfiler } : undefined));
    if (nativeObservation) yield nativeObservation.observe({
      asOf: today.date,
      output,qqq:decisionViews.qqq,
      stockAccount: marketInput.account,
      priorRegime: lastMarketContext?.regime,
      crisisPhase: crisisState.phase,
      prevCloseNav,
      navDrawdownPeak,
      macro: { vix: vixToday, vix3m: vix3mToday, vix5dAgo: marketInput.macro.vix5dAgo, vxn: vxnToday },
    });
    pcsDynamicMarketHistory.push(output.currentState as unknown as PcsDynamicMarketState);
    profRecord('pipeline', __tPipeline);
    const configuredRecoveryDelayBars = Math.max(0, Math.floor(config.strategyParams?.researchUpstreamRecoveryDelayBars ?? 0));
    if (configuredRecoveryDelayBars > 0 && output.proposals.some((proposal) => proposal.kind === 'equity' && proposal.symbol === leveragedSymbol && proposal.side === 'SELL' && proposal.executionReasonKey === 'upstream_block')) {
      researchUpstreamRecoveryDelayRemaining = Math.max(researchUpstreamRecoveryDelayRemaining, configuredRecoveryDelayBars + 1);
    }
    const sameDayUpstreamAllowed = config.strategyParams?.researchSameDayUpstreamBlock === true
      && (config.strategyParams?.researchSameDayUpstreamBlockMode !== 'crisis'
        || output.currentState.regime === 'CRISIS'
        || output.currentState.crisisPhase === 'PENDING'
        || output.currentState.crisisPhase === 'CONFIRMED');
    const previousEquityPoint = equityCurve.at(-1);
    const sameDayTargetDropPp = Math.max(0, config.strategyParams?.researchSameDayTargetDropPp ?? 0);
    const sameDayTargetDropMinActual = Math.max(0, config.strategyParams?.researchSameDayTargetDropMinActual ?? .70);
    const sameDayTargetDropFraction = Math.min(1, Math.max(0, config.strategyParams?.researchSameDayTargetDropFraction ?? 1));
    const sameDayTargetDropRangeBoundTerminalPct = config.strategyParams?.researchSameDayTargetDropRangeBoundTerminalPct;
    const sameDayStockDeRisk = config.strategyParams?.researchSameDayStockDeRisk === true;
    const sameDayStockDeRiskMode = config.strategyParams?.researchSameDayStockDeRiskMode ?? 'all';
    const sameDayStockDeRiskFraction = Math.min(1, Math.max(0, config.strategyParams?.researchSameDayStockDeRiskFraction ?? 1));
    const sameDayStockDeRiskStrongTrendFraction = config.strategyParams?.researchSameDayStockDeRiskStrongTrendFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockDeRiskStrongTrendFraction));
    const sameDayStockDeRiskRecoveryQualityFraction = config.strategyParams?.researchSameDayStockDeRiskRecoveryQualityFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockDeRiskRecoveryQualityFraction));
    const sameDayStockDeRiskRecoveryQualityException = config.strategyParams?.researchSameDayStockDeRiskRecoveryQualityException === true;
    const sameDayStockDeRiskRecoveryQualityScoreMin = config.strategyParams?.researchSameDayStockDeRiskRecoveryQualityScoreMin;
    const sameDayStockDeRiskMinActual = Math.max(0, config.strategyParams?.researchSameDayStockDeRiskMinActual ?? .70);
    const sameDayStockDeRiskBuyCooldownBars = Math.max(0, Math.floor(config.strategyParams?.researchSameDayStockDeRiskBuyCooldownBars ?? 0));
    const sameDayStockDeRiskRiskOnWeakMinTargetDropPp = Math.max(0, config.strategyParams?.researchSameDayStockDeRiskRiskOnWeakMinTargetDropPp ?? 0);
    const sameDayStockReRisk = config.strategyParams?.researchSameDayStockReRisk === true;
    const sameDayStockReRiskFraction = Math.min(1, Math.max(0, config.strategyParams?.researchSameDayStockReRiskFraction ?? 1));
    const sameDayStockReRiskAllowTargetJump = config.strategyParams?.researchSameDayStockReRiskAllowTargetJump === true;
    const sameDayStockReRiskCleanBudgetOnly = config.strategyParams?.researchSameDayStockReRiskCleanBudgetOnly === true;
    const sameDayStockReRiskVolTargetOnly = config.strategyParams?.researchSameDayStockReRiskVolTargetOnly === true;
    const sameDayStockReRiskAllowTrendParticipation = config.strategyParams?.researchSameDayStockReRiskAllowTrendParticipation === true;
    const sameDayStockReRiskAllowTrendDiscount = config.strategyParams?.researchSameDayStockReRiskAllowTrendDiscount === true;
    const sameDayStockReRiskRequireTrendParticipationEligible = config.strategyParams?.researchSameDayStockReRiskRequireTrendParticipationEligible === true;
    const sameDayStockReRiskTrendParticipationTargetMinPct = config.strategyParams?.researchSameDayStockReRiskTrendParticipationTargetMinPct;
    const sameDayStockReRiskTrendScoreMin = config.strategyParams?.researchSameDayStockReRiskTrendScoreMin;
    const sameDayStockReRiskRequireTrendActive = config.strategyParams?.researchSameDayStockReRiskRequireTrendActive === true;
    const sameDayStockReRiskRequireBoxxSell = config.strategyParams?.researchSameDayStockReRiskRequireBoxxSell === true;
    const sameDayStockReRiskNavDrawdownTargetCapPct = config.strategyParams?.researchSameDayStockReRiskNavDrawdownTargetCapPct;
    const navDrawdownTargetIncreaseCapPct = config.strategyParams?.researchNavDrawdownTargetIncreaseCapPct;
    const navDrawdownTargetIncreaseMinPct = config.strategyParams?.researchNavDrawdownTargetIncreaseMinPct ?? .10;
    const sameDayStockReRiskMaxTargetJumpPp = config.strategyParams?.researchSameDayStockReRiskMaxTargetJumpPp;
    const sameDayStockReRiskLowRvMaxTargetJumpPp = config.strategyParams?.researchSameDayStockReRiskLowRvMaxTargetJumpPp;
    const sameDayStockReRiskLowRvIncludeExtended = config.strategyParams?.researchSameDayStockReRiskLowRvIncludeExtended === true;
    const sameDayStockReRiskStrongTrendJumpFraction = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskStrongTrendJumpFraction));
    const sameDayStockReRiskStrongTrendJumpScoreMin = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpScoreMin ?? 5;
    const sameDayStockReRiskStrongTrendJumpPreviousTargetMinPct = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpPreviousTargetMinPct;
    const sameDayStockReRiskStrongTrendJumpMinActualPct = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpMinActualPct;
    const sameDayStockReRiskStrongTrendJumpRequireCleanShape = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpRequireCleanShape === true;
    const sameDayStockReRiskVixMax = config.strategyParams?.researchSameDayStockReRiskVixMax ?? 20;
    const sameDayStockReRiskRealizedVolMax = config.strategyParams?.researchSameDayStockReRiskRealizedVolMax ?? .70;
    const sameDayStockReRiskRiskOnRealizedVolMax = config.strategyParams?.researchSameDayStockReRiskRiskOnRealizedVolMax;
    const sameDayStockReRiskQqqReturnMin = config.strategyParams?.researchSameDayStockReRiskQqqReturnMin ?? -Infinity;
    const sameDayStockReRiskIndependentScoreAllowQqqDown = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowQqqDown === true;
    const sameDayStockReRiskIndependentScoreQqqReturnWindowBars = Math.max(0, Math.floor(config.strategyParams?.researchSameDayStockReRiskIndependentScoreQqqReturnWindowBars ?? 0));
    const sameDayStockReRiskIndependentScoreQqqReturnWindowCurrentDayFloor = config.strategyParams?.researchSameDayStockReRiskIndependentScoreQqqReturnWindowCurrentDayFloor ?? -Infinity;
    const sameDayStockReRiskIndependentScoreAllowRiskOnWeakening = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowRiskOnWeakening === true;
    const sameDayStockReRiskIndependentScoreRiskOnWeakeningTargetMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRiskOnWeakeningTargetMin ?? .75;
    const sameDayStockReRiskIndependentScoreBypassQqqDirectionGate = config.strategyParams?.researchSameDayStockReRiskIndependentScoreBypassQqqDirectionGate === true;
    const sameDayStockReRiskIndependentScoreMaxTargetJumpPp = config.strategyParams?.researchSameDayStockReRiskIndependentScoreMaxTargetJumpPp;
    const sameDayStockReRiskQueueLargeTargetJump = config.strategyParams?.researchSameDayStockReRiskQueueLargeTargetJump === true;
    const sameDayStockReRiskIndependentScoreHighQualityJumpCapPp = config.strategyParams?.researchSameDayStockReRiskIndependentScoreHighQualityJumpCapPp;
    const sameDayStockReRiskIndependentScoreHighQualityJumpFraction = config.strategyParams?.researchSameDayStockReRiskIndependentScoreHighQualityJumpFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskIndependentScoreHighQualityJumpFraction));
    const sameDayStockReRiskTargetJumpEpsilonPp = Math.max(0, config.strategyParams?.researchSameDayStockReRiskTargetJumpEpsilonPp ?? 0);
    const sameDayStockReRiskIndependentScoreUseActualForJumpCap = config.strategyParams?.researchSameDayStockReRiskIndependentScoreUseActualForJumpCap === true;
    const sameDayStockReRiskIndependentScoreUsePriorActualForJumpCap = config.strategyParams?.researchSameDayStockReRiskIndependentScoreUsePriorActualForJumpCap === true;
    const sameDayStockReRiskIndependentScorePriorActualMinPct = config.strategyParams?.researchSameDayStockReRiskIndependentScorePriorActualMinPct;
    const sameDayStockReRiskIndependentScorePartialJumpFraction = config.strategyParams?.researchSameDayStockReRiskIndependentScorePartialJumpFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskIndependentScorePartialJumpFraction));
    const sameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct = config.strategyParams?.researchSameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct;
    const sameDayStockReRiskBullOnly = config.strategyParams?.researchSameDayStockReRiskBullOnly === true;
    const sameDayStockReRiskFromActual = config.strategyParams?.researchSameDayStockReRiskFromActual === true;
    const sameDayStockReRiskMinActual = Math.max(0, config.strategyParams?.researchSameDayStockReRiskMinActual ?? 0);
    const sameDayStockReRiskUseCurrentActual = config.strategyParams?.researchSameDayStockReRiskUseCurrentActual === true;
    const sameDayStockReRiskGapVixMaxTargetJumpPp = config.strategyParams?.researchSameDayStockReRiskGapVixMaxTargetJumpPp;
    const sameDayStockReRiskErMin = config.strategyParams?.researchSameDayStockReRiskErMin ?? -Infinity;
    const sameDayStockReRiskRoc20Min = config.strategyParams?.researchSameDayStockReRiskRoc20Min ?? -Infinity;
    const sameDayStockReRiskStrongCore = config.strategyParams?.researchSameDayStockReRiskStrongCore === true;
    const sameDayStockReRiskSr02Only = config.strategyParams?.researchSameDayStockReRiskSr02Only !== false;
    const sameDayStockReRiskAllowRangeBound = config.strategyParams?.researchSameDayStockReRiskAllowRangeBound === true;
    const sameDayStockReRiskAllowRiskOnWeakening = config.strategyParams?.researchSameDayStockReRiskAllowRiskOnWeakening === true;
    const sameDayStockReRiskCrossRegimeRecovery = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecovery === true;
    const sameDayStockReRiskCrossRegimeRecoveryRegimeIn = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecoveryRegimeIn;
    const sameDayStockReRiskCrossRegimeRecoveryRealizedVolMin = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecoveryRealizedVolMin ?? -Infinity;
    const sameDayStockReRiskCrossRegimeRecoveryMaxTargetJumpPp = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecoveryMaxTargetJumpPp;
    const sameDayStockReRiskSharedRecoveryJumpCap = config.strategyParams?.researchSameDayStockReRiskSharedRecoveryJumpCap === true;
    const sameDayStockReRiskCrossRegimeRecoveryFromActual = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecoveryFromActual === true;
    const sameDayStockReRiskCrossRegimeRecoveryVixMax = config.strategyParams?.researchSameDayStockReRiskCrossRegimeRecoveryVixMax ?? 22;
    const sameDayStockReRiskCleanBullRecoveryFromActual = config.strategyParams?.researchSameDayStockReRiskCleanBullRecoveryFromActual === true;
    const sameDayStockReRiskIndependentScoreMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreMin;
    const sameDayStockReRiskIndependentScoreRiskOnWeakeningMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRiskOnWeakeningMin;
    const sameDayStockReRiskIndependentScoreVolTargetMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreVolTargetMin;
    const sameDayStockReRiskIndependentScoreVolTargetTargetMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreVolTargetTargetMin;
    const sameDayStockReRiskIndependentScoreVolTargetFraction = config.strategyParams?.researchSameDayStockReRiskIndependentScoreVolTargetFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskIndependentScoreVolTargetFraction));
const sameDayStockReRiskIndependentScoreTargetMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreTargetMin ?? .85;
const sameDayStockReRiskIndependentScoreAllowSlowBearLowTarget = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowSlowBearLowTarget === true;
    const sameDayStockReRiskIndependentScoreRequireQqqUp = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRequireQqqUp === true;
    const sameDayStockReRiskIndependentScoreAllowSlowBullVixLowTarget = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowSlowBullVixLowTarget === true;
    const sameDayStockReRiskIndependentScoreAllowSlowBullTrendLowTarget = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowSlowBullTrendLowTarget === true;
    const sameDayStockReRiskIndependentScoreAllowRangeBound = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowRangeBound === true;
    const sameDayStockReRiskIndependentScoreRangeBoundFraction = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRangeBoundFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskIndependentScoreRangeBoundFraction));
    const sameDayStockReRiskIndependentScoreRangeBoundMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRangeBoundMin;
    const sameDayStockReRiskIndependentScoreAllowSideways = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowSideways === true;
    const sameDayStockReRiskIndependentScoreErMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreErMin;
    const sameDayStockReRiskIndependentScoreRoc20Min = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRoc20Min;
    const sameDayStockReRiskIndependentScoreSma20SlopeMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreSma20SlopeMin;
    const sameDayStockReRiskIndependentScoreTrendScoreMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreTrendScoreMin;
    const sameDayStockReRiskIndependentScoreLowTrendScoreMax = config.strategyParams?.researchSameDayStockReRiskIndependentScoreLowTrendScoreMax;
    const sameDayStockReRiskIndependentScoreLowTrendFraction = config.strategyParams?.researchSameDayStockReRiskIndependentScoreLowTrendFraction == null
      ? undefined
      : Math.min(1, Math.max(0, config.strategyParams.researchSameDayStockReRiskIndependentScoreLowTrendFraction));
    const sameDayStockReRiskIndependentScorePriceVsSma200MinPct = config.strategyParams?.researchSameDayStockReRiskIndependentScorePriceVsSma200MinPct;
    const sameDayStockReRiskIndependentScoreRequireVixStable = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRequireVixStable === true;
    const sameDayStockReRiskIndependentScoreRequireCleanShape = config.strategyParams?.researchSameDayStockReRiskIndependentScoreRequireCleanShape === true;
    const sameDayStockReRiskIndependentScoreNavDrawdownMaxPct = config.strategyParams?.researchSameDayStockReRiskIndependentScoreNavDrawdownMaxPct;
    const sameDayStockReRiskIndependentScoreAllowHighErVixRise = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowHighErVixRise === true;
    const sameDayStockReRiskIndependentScoreAllowSlowSubregimePoint = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowSlowSubregimePoint === true;
    const sameDayStockReRiskIndependentScoreAllowHighVixClean = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowHighVixClean === true;
    const sameDayStockReRiskIndependentScoreAllowHighVixCleanLowTarget = config.strategyParams?.researchSameDayStockReRiskIndependentScoreAllowHighVixCleanLowTarget === true;
    const sameDayStockReRiskIndependentScoreHighVixCleanTargetMin = config.strategyParams?.researchSameDayStockReRiskIndependentScoreHighVixCleanTargetMin ?? .50;
    const sameDayStockReRiskIndependentScoreHighVixCleanPriceExtensionMax = config.strategyParams?.researchSameDayStockReRiskIndependentScoreHighVixCleanPriceExtensionMax ?? 2.65;
    const sameDayStockReRiskMinGapPp = Math.max(0, config.strategyParams?.researchSameDayStockReRiskMinGapPp ?? 0);
    const sameDayStockReRiskLocalMinGapPp = Math.max(0, config.strategyParams?.researchSameDayStockReRiskLocalMinGapPp ?? 0);
    const sameDayStockReRiskLocalMinGapMode = config.strategyParams?.researchSameDayStockReRiskLocalMinGapMode;
    const sameDayStockReRiskTqqqUp = config.strategyParams?.researchSameDayStockReRiskTqqqUp === true;
    const sameDayStockReRiskAllowBullNegativeRoc5VixFall = config.strategyParams?.researchSameDayStockReRiskAllowBullNegativeRoc5VixFall === true;
    const sameDayStockReRiskAllowHighErVixRise = config.strategyParams?.researchSameDayStockReRiskAllowHighErVixRise === true;
    const sameDayStockReRiskHighErVixRiseErMin = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseErMin ?? .30;
    const sameDayStockReRiskHighErVixRiseCleanExtension = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseCleanExtension === true;
    const sameDayStockReRiskHighErVixRiseCleanExtensionExtendedOnly = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseCleanExtensionExtendedOnly === true;
    const sameDayStockReRiskHighErVixRiseCleanExtensionExtendedVixRiseOnly = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseCleanExtensionExtendedVixRiseOnly === true;
    const sameDayStockReRiskHighErVixRiseTrendScoreMin = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseTrendScoreMin ?? -Infinity;
    const sameDayStockReRiskHighErVixRiseRequireBullTrend = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseRequireBullTrend === true;
    const sameDayStockReRiskHighErVixRiseCleanExtensionPriceExtensionMax = config.strategyParams?.researchSameDayStockReRiskHighErVixRiseCleanExtensionPriceExtensionMax ?? 2.65;
    const sameDayStockReRiskCleanBullBridge = config.strategyParams?.researchSameDayStockReRiskCleanBullBridge;
    const sameDayStockReRiskRequirePriorQqqUp = config.strategyParams?.researchSameDayStockReRiskRequirePriorQqqUp === true;
    const sameDayStockReRiskPriorQqqReturnMin = config.strategyParams?.researchSameDayStockReRiskPriorQqqReturnMin ?? -Infinity;
    const sameDayStockReRiskRequirePriorTqqqUp = config.strategyParams?.researchSameDayStockReRiskRequirePriorTqqqUp === true;
    const sameDayStockReRiskTailVeto = config.strategyParams?.researchSameDayStockReRiskTailVeto === true;
    const sameDayStockReRiskTailVetoMode = config.strategyParams?.researchSameDayStockReRiskTailVetoMode ?? (sameDayStockReRiskTailVeto ? 'both' : undefined);
    const recoveryBuyDelayBars = Math.max(0, Math.floor(config.strategyParams?.researchRecoveryBuyDelayBars ?? 0));
    const postCrisisBarsForResearch = postCrisisBars;
    const sameDayTargetDropAllowed = (proposal: typeof output.proposals[number]) => {
      if (sameDayTargetDropPp <= 0 || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'SELL') return false;
      if (config.strategyParams?.researchSameDayTargetDropSkipCrisis === true && output.currentState.regime === 'CRISIS') return false;
      if (config.strategyParams?.researchSameDayTargetDropRiskOffOnly === true && !['SIDEWAYS', 'BEAR'].includes(output.currentState.regime)) return false;
      if (config.strategyParams?.researchSameDayTargetDropRiskOnWeakeningOnly === true && output.currentState.regime !== 'RISK_ON_WEAKENING') return false;
      if ((previousEquityPoint?.tqqqPct ?? 0) < sameDayTargetDropMinActual) return false;
      const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
      const proposalTargetPct = (proposal as { targetPct?: unknown }).targetPct;
      const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
      if (sameDayTargetDropRangeBoundTerminalPct != null
        && (output.currentState.regime !== 'RANGE_BOUND'
          || targetPct == null
          || targetPct > sameDayTargetDropRangeBoundTerminalPct)) return false;
      if (config.strategyParams?.researchSameDayTargetDropRangeBoundRoc20Max != null
        && (output.currentState.roc20 ?? Infinity) > config.strategyParams.researchSameDayTargetDropRangeBoundRoc20Max) return false;
      if (config.strategyParams?.researchSameDayTargetDropRangeBoundTqqqUp === true) {
        const leveragedIndex = leveragedIdx.get(today.date) ?? -1;
        const previousLeveragedClose = leveragedIndex > 0 ? leveragedBars[leveragedIndex - 1]?.close : undefined;
        if (previousLeveragedClose == null || leveragedDayPrice / previousLeveragedClose - 1 <= 0) return false;
      }
      return previousTarget != null && targetPct != null && previousTarget - targetPct >= sameDayTargetDropPp;
    };
    const sameDayStockDeRiskAllowed = (proposal: typeof output.proposals[number]) => {
      sameDayStockDeRiskFractionOverride = undefined;
      if (!sameDayStockDeRisk || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'SELL') return false;
      if ((previousEquityPoint?.tqqqPct ?? 0) < sameDayStockDeRiskMinActual) return false;
      const proposalTargetForRecoveryQuality = (proposal as { targetPct?: unknown }).targetPct;
      const targetForRecoveryQuality = typeof proposalTargetForRecoveryQuality === 'number' ? proposalTargetForRecoveryQuality : undefined;
      const recoveryQualityQqqIndex = qqqIdx.get(today.date) ?? -1;
      const recoveryQualityQqqReturn = recoveryQualityQqqIndex > 0 && (qqqBars[recoveryQualityQqqIndex - 1]?.close ?? 0) > 0
        ? (qqqBars[recoveryQualityQqqIndex]?.close ?? 0) / (qqqBars[recoveryQualityQqqIndex - 1]?.close ?? 1) - 1
        : -Infinity;
      const recoveryQualityIndependentScore = [
        (output.currentState.vix ?? Infinity) <= 22 && (output.currentState.vixChange5d ?? Infinity) <= 0,
        (output.currentState.roc20 ?? -Infinity) >= 0,
        (output.currentState.priceVsSma200Pct ?? -Infinity) >= 0,
        (output.currentState.drawdownFromRecentHighPct ?? Infinity) < .05
          && (output.currentState.priceExtensionAtr ?? Infinity) < 2.65,
        recoveryQualityQqqReturn >= 0,
        (output.currentState.tqqqRealisedVol20d ?? Infinity) <= .90,
      ].filter(Boolean).length;
      const recoveryQualityAdmission = sameDayStockDeRiskRecoveryQualityException
        && sameDayStockDeRiskRecoveryQualityFraction != null
        && recoveryQualityQqqReturn >= 0
        && (output.currentState.vixChange5d ?? Infinity) <= 0
        && (output.currentState.roc20 ?? -Infinity) >= 0
        && (output.currentState.navDrawdownPct ?? Infinity) < .05
        && targetForRecoveryQuality != null
        && targetForRecoveryQuality >= .50
        && (sameDayStockDeRiskRecoveryQualityScoreMin == null || recoveryQualityIndependentScore >= sameDayStockDeRiskRecoveryQualityScoreMin);
      if (sameDayStockDeRiskMode === 'crisis' && output.currentState.regime !== 'CRISIS' && output.currentState.crisisPhase !== 'PENDING' && output.currentState.crisisPhase !== 'CONFIRMED') return false;
      if (sameDayStockDeRiskMode === 'high_vol' && !((output.currentState.vix ?? 0) >= 25 && (output.currentState.tqqqRealisedVol20d ?? 0) >= 0.60 && (output.currentState.roc5 ?? 0) < 0)) return false;
      if (sameDayStockDeRiskMode === 'risk_on_extended' && output.currentState.regime !== 'RISK_ON_EXTENDED') return false;
      if (sameDayStockDeRiskMode === 'risk_on_extended_weak' && (output.currentState.regime !== 'RISK_ON_EXTENDED' || (output.currentState.roc5 ?? 0) >= 0)) return false;
      if (sameDayStockDeRiskMode === 'transition_loss') {
        const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
        const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
          ? leveragedDayPrice / previousLeveragedClose - 1
          : Infinity;
        if (!['RISK_ON_WEAKENING', 'SIDEWAYS'].includes(output.currentState.regime)
          || (output.currentState.roc5 ?? 0) >= 0
          || (output.currentState.vix ?? 0) < 20
          || (output.currentState.vixChange5d ?? 0) <= 0
          || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? 0)) return false;
      }
      if (sameDayStockDeRiskMode === 'risk_on_transition_loss') {
        const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
        const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
          ? leveragedDayPrice / previousLeveragedClose - 1
          : Infinity;
        const previousRegime = previousEquityPoint?.regime ?? previousEquityPoint?.marketContext?.regime;
        const transitionRoc20Max = config.strategyParams?.researchSameDayStockDeRiskRiskOnTransitionRoc20Max;
        const transitionNavOverrideMin = config.strategyParams?.researchSameDayStockDeRiskRiskOnTransitionNavDrawdownOverrideMin;
        const transitionRoc20Blocked = transitionRoc20Max != null
          && (output.currentState.roc20 ?? Infinity) > transitionRoc20Max
          && !(transitionNavOverrideMin != null && (output.currentState.navDrawdownPct ?? 0) >= transitionNavOverrideMin);
        if (!recoveryQualityAdmission && (output.currentState.regime !== 'RISK_ON_WEAKENING'
          || !['BULL', 'RISK_ON_EXTENDED'].includes(previousRegime ?? '')
          || (output.currentState.roc5 ?? 0) >= 0
          || (output.currentState.vixChange5d ?? 0) <= 0
          || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? 0)
          || transitionRoc20Blocked)) return false;
      }
      if (sameDayStockDeRiskMode === 'bear_loss') {
        const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
        const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
          ? leveragedDayPrice / previousLeveragedClose - 1
          : Infinity;
        const target = (proposal as { targetPct?: unknown }).targetPct;
        if (output.currentState.regime !== 'BEAR'
          || typeof target !== 'number'
          || target > (config.strategyParams?.researchSameDayStockDeRiskBearTargetMax ?? 0) + 1e-9
          || (output.currentState.vix ?? 0) < 25
          || (output.currentState.roc5 ?? 0) >= 0
          || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? -.05)) return false;
      }
      if (sameDayStockDeRiskMode === 'risk_on_weak_loss') {
        const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
        const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
          ? leveragedDayPrice / previousLeveragedClose - 1
          : Infinity;
        if (output.currentState.regime !== 'RISK_ON_WEAKENING'
          || (output.currentState.roc5 ?? 0) >= 0
          || (output.currentState.vixChange5d ?? -Infinity) < (config.strategyParams?.researchSameDayStockDeRiskRiskOnWeakVixRise5dMin ?? -Infinity)
          || (output.currentState.roc20 ?? Infinity) > (config.strategyParams?.researchSameDayStockDeRiskRiskOnWeakRoc20Max ?? Infinity)
          || (output.currentState.navDrawdownPct ?? 0) < (config.strategyParams?.researchSameDayStockDeRiskRiskOnWeakNavDrawdownMin ?? -Infinity)
          || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? -.05)) return false;
        if (sameDayStockDeRiskRiskOnWeakMinTargetDropPp > 0) {
          const previousTargetForDrop = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
          const proposalTargetForDrop = (proposal as { targetPct?: unknown }).targetPct;
          if (previousTargetForDrop == null || typeof proposalTargetForDrop !== 'number'
            || previousTargetForDrop - proposalTargetForDrop < sameDayStockDeRiskRiskOnWeakMinTargetDropPp / 100) return false;
        }
      }
      const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
      const proposalTargetPct = (proposal as { targetPct?: unknown }).targetPct;
      const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
      if (previousTarget == null || targetPct == null || targetPct >= previousTarget) return false;
      const qqqIndex = qqqIdx.get(today.date) ?? -1;
      const sameDayQqqReturn = qqqIndex > 0 && (qqqBars[qqqIndex - 1]?.close ?? 0) > 0
        ? (qqqBars[qqqIndex]?.close ?? 0) / (qqqBars[qqqIndex - 1]?.close ?? 1) - 1
        : -Infinity;
      const strongTrendDeRiskState = sameDayStockDeRiskMode === 'risk_on_transition_loss'
        && sameDayQqqReturn >= 0
        && (output.currentState.vixChange5d ?? Infinity) <= 0
        && (output.currentState.tqqqRealisedVol20d ?? Infinity) <= .70
        && (output.currentState.navDrawdownPct ?? Infinity) <= .03
        && (output.currentState.drawdownFromRecentHighPct ?? Infinity) < .05
        && (output.currentState.adx14 ?? -Infinity) >= 15
        && (output.currentState.roc20 ?? -Infinity) >= 0
        && (output.currentState.sma20SlopePct ?? -Infinity) >= 0
        && (output.currentState.trendScore ?? -Infinity) >= 50;
      if (sameDayStockDeRiskStrongTrendFraction != null && strongTrendDeRiskState) {
        sameDayStockDeRiskFractionOverride = sameDayStockDeRiskStrongTrendFraction;
      }
      const recoveryQualityDeRiskState = sameDayStockDeRiskMode === 'risk_on_transition_loss'
        && sameDayQqqReturn >= 0
        && (output.currentState.vixChange5d ?? Infinity) <= 0
        && (output.currentState.roc20 ?? -Infinity) >= 0
        && (output.currentState.navDrawdownPct ?? Infinity) < .05
        && targetPct >= .50;
      if (sameDayStockDeRiskRecoveryQualityFraction != null && recoveryQualityDeRiskState) {
        sameDayStockDeRiskFractionOverride = Math.min(sameDayStockDeRiskFractionOverride ?? 1, sameDayStockDeRiskRecoveryQualityFraction);
      }
      return true;
    };
    let sameDayStockReRiskRejectReason: string | undefined;
    let sameDayStockReRiskIndependentParticipationScore: number | undefined;
    let sameDayStockReRiskIndependentScoreRecovery = false;
    let sameDayStockReRiskIndependentScoreContinuation = false;
    let sameDayStockReRiskActualRecoveryBridge = false;
    let sameDayStockReRiskFractionOverride: number | undefined;
    let sameDayStockDeRiskFractionOverride: number | undefined;
    let sameDayIndependentScoreCarrySource = false;
    const sameDayStockReRiskReject = (reason: string) => {
      sameDayStockReRiskRejectReason = reason;
      return false;
    };
    const sameDayStockReRiskAllowed = (proposal: typeof output.proposals[number]) => {
      sameDayStockReRiskRejectReason = undefined;
      sameDayStockReRiskIndependentParticipationScore = undefined;
      sameDayStockReRiskIndependentScoreRecovery = false;
      sameDayStockReRiskIndependentScoreContinuation = false;
      sameDayStockReRiskActualRecoveryBridge = false;
      sameDayStockReRiskFractionOverride = undefined;
      if (!sameDayStockReRisk || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'BUY') return sameDayStockReRiskReject('not_candidate');
      if (sameDayStockDeRiskBuyCooldownRemaining > 0) return sameDayStockReRiskReject('buy_cooldown');
      const leveragedIndex = leveragedIdx.get(today.date) ?? -1;
      const previousLeveragedClose = leveragedIndex > 0 ? leveragedBars[leveragedIndex - 1]?.close : undefined;
      const state = output.currentState;
      const sameDayQqqReturn = today.close / (qqqBars[i - 1]?.close ?? today.close) - 1;
      const independentScoreQqqWindowReturn = sameDayStockReRiskIndependentScoreQqqReturnWindowBars >= 2
        && i >= sameDayStockReRiskIndependentScoreQqqReturnWindowBars
        ? today.close / (qqqBars[i - sameDayStockReRiskIndependentScoreQqqReturnWindowBars]?.close ?? today.close) - 1
        : sameDayQqqReturn;
      const independentScoreQqqDirectionPositive = sameDayQqqReturn >= 0
        || (sameDayStockReRiskIndependentScoreAllowQqqDown
          && sameDayStockReRiskIndependentScoreQqqReturnWindowBars >= 2
          && independentScoreQqqWindowReturn >= 0
          && sameDayQqqReturn >= sameDayStockReRiskIndependentScoreQqqReturnWindowCurrentDayFloor);
      const independentScoreContinuationQqqDown = (config.strategyParams?.researchSameDayStockReRiskIndependentScoreCarryBars ?? 0) > 0
        && researchIndependentScoreCarryRemaining > 0
        && sameDayQqqReturn < 0
        && sameDayQqqReturn >= -.005
        && (state.vix ?? Infinity) <= 22
        && (state.vixChange5d ?? Infinity) <= .02
        && (state.tqqqRealisedVol20d ?? Infinity) <= .90
        && (state.navDrawdownPct ?? Infinity) <= .03
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05
        && (state.priceExtensionAtr ?? Infinity) < 2.65;
      sameDayStockReRiskIndependentScoreContinuation = independentScoreContinuationQqqDown;
      const crossRegimeRecovery = sameDayStockReRiskCrossRegimeRecovery
        && (sameDayStockReRiskCrossRegimeRecoveryRegimeIn == null
          ? ['SIDEWAYS', 'RANGE_BOUND'].includes(state.regime)
          : sameDayStockReRiskCrossRegimeRecoveryRegimeIn.includes(state.regime as 'SIDEWAYS' | 'RANGE_BOUND'))
        && (state.qqqEr20 ?? -Infinity) >= .30
        && (state.roc20 ?? -Infinity) >= 0
        && (state.vix ?? Infinity) <= sameDayStockReRiskCrossRegimeRecoveryVixMax
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.priceVsSma200Pct ?? -Infinity) >= 0
        && (state.tqqqRealisedVol20d ?? -Infinity) >= sameDayStockReRiskCrossRegimeRecoveryRealizedVolMin
        && (state.tqqqRealisedVol20d ?? Infinity) <= .90
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05
        && sameDayQqqReturn >= 0;
      const cleanBullRecovery = sameDayStockReRiskCleanBullRecoveryFromActual
        && ['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
        && (state.qqqEr20 ?? -Infinity) >= .30
        && (state.roc20 ?? -Infinity) >= 0
        && (state.vix ?? Infinity) <= 22
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.priceVsSma200Pct ?? -Infinity) >= 0
        && (state.tqqqRealisedVol20d ?? -Infinity) >= .50
        && (state.tqqqRealisedVol20d ?? Infinity) <= .90
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05
        && (state.priceExtensionAtr ?? Infinity) < 2.65
        && sameDayQqqReturn >= 0;
      const proposalTargetForBridgeRaw = (proposal as { targetPct?: unknown }).targetPct;
      const proposalTargetForBridge = typeof proposalTargetForBridgeRaw === 'number' ? proposalTargetForBridgeRaw : undefined;
      const bindingConstraint = (output.pipeline?.riskBudget as { data?: { binding_constraint?: string } } | undefined)?.data?.binding_constraint;
      const slowBullVixLowTargetBridge = sameDayStockReRiskIndependentScoreAllowSlowBullVixLowTarget
        && state.macroRegime === 'SLOW_BULL'
        && state.regime === 'BULL'
        && bindingConstraint === 'vix_gate'
        && proposalTargetForBridge != null
        && proposalTargetForBridge >= .50;
      const independentScoreHighErVixRise = sameDayStockReRiskIndependentScoreAllowHighErVixRise
        && ['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
        && (state.vix ?? Infinity) <= sameDayStockReRiskVixMax
        && (state.qqqEr20 ?? -Infinity) >= sameDayStockReRiskHighErVixRiseErMin
        && independentScoreQqqDirectionPositive
        && (state.priceExtensionAtr ?? Infinity) < 2.65
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05;
      const independentScoreHighVixClean = sameDayStockReRiskIndependentScoreAllowHighVixClean
        && ['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
        && (state.vix ?? -Infinity) > sameDayStockReRiskVixMax
        && (state.vix ?? Infinity) <= 24
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.roc20 ?? -Infinity) >= .02
        && (state.priceVsSma200Pct ?? -Infinity) >= 0
        && independentScoreQqqDirectionPositive
        && (state.priceExtensionAtr ?? Infinity) < sameDayStockReRiskIndependentScoreHighVixCleanPriceExtensionMax
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05;
      const independentScoreSlowSubregimePoint = sameDayStockReRiskIndependentScoreAllowSlowSubregimePoint
        && state.macroRegime === 'SLOW_BULL'
        && (state.slowSubregime === 'SR01' || state.slowSubregime === 'SR02')
        && state.slowSubregimeHealth !== 'STALE_OR_MISSING';
      const independentParticipationScore = [
        ((state.vix ?? Infinity) <= 22 && (state.vixChange5d ?? Infinity) <= 0) || independentScoreHighErVixRise || independentScoreHighVixClean || independentScoreSlowSubregimePoint,
        (state.roc20 ?? -Infinity) >= 0,
        (state.priceVsSma200Pct ?? -Infinity) >= 0,
        (state.drawdownFromRecentHighPct ?? Infinity) < .05
          && (state.priceExtensionAtr ?? Infinity) < (independentScoreHighVixClean ? sameDayStockReRiskIndependentScoreHighVixCleanPriceExtensionMax : 2.65),
        independentScoreQqqDirectionPositive || independentScoreContinuationQqqDown,
        (state.tqqqRealisedVol20d ?? Infinity) <= .90,
      ].filter(Boolean).length;
      const slowBullTrendLowTargetBridge = sameDayStockReRiskIndependentScoreAllowSlowBullTrendLowTarget
        && state.macroRegime === 'SLOW_BULL'
        && state.regime === 'BULL'
        && bindingConstraint === 'trend_gate'
        && proposalTargetForBridge != null
        && proposalTargetForBridge >= .50
        && independentParticipationScore >= (sameDayStockReRiskIndependentScoreMin ?? Infinity);
      const independentScoreVolTargetFallback = sameDayStockReRiskIndependentScoreVolTargetMin != null
        && bindingConstraint === 'vol_target'
        && proposalTargetForBridge != null
        && proposalTargetForBridge >= (sameDayStockReRiskIndependentScoreVolTargetTargetMin ?? Infinity);
      const independentScoreMinimum = independentScoreVolTargetFallback
        ? sameDayStockReRiskIndependentScoreVolTargetMin
        : sameDayStockReRiskIndependentScoreMin;
      const independentScoreRangeBoundMinimum = state.regime === 'RANGE_BOUND'
        ? sameDayStockReRiskIndependentScoreRangeBoundMin
        : undefined;
      const independentScoreRecovery = sameDayStockReRiskIndependentScoreMin != null
        && (['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
          || (sameDayStockReRiskIndependentScoreAllowRiskOnWeakening
            && state.regime === 'RISK_ON_WEAKENING'
            && (state.roc20 ?? -Infinity) >= 0
            && proposalTargetForBridge != null
            && proposalTargetForBridge >= sameDayStockReRiskIndependentScoreRiskOnWeakeningTargetMin)
          || (sameDayStockReRiskIndependentScoreAllowRangeBound && state.regime === 'RANGE_BOUND')
          || (sameDayStockReRiskIndependentScoreAllowSideways && state.regime === 'SIDEWAYS'))
        && proposalTargetForBridge != null
        && (proposalTargetForBridge >= sameDayStockReRiskIndependentScoreTargetMin
          || (sameDayStockReRiskIndependentScoreAllowSlowBearLowTarget
            && state.macroRegime === 'SLOW_BEAR'
            && proposalTargetForBridge >= .50)
          || slowBullVixLowTargetBridge
          || slowBullTrendLowTargetBridge
          || (sameDayStockReRiskIndependentScoreAllowRiskOnWeakening
            && state.regime === 'RISK_ON_WEAKENING'
            && (state.roc20 ?? -Infinity) >= 0
            && proposalTargetForBridge >= sameDayStockReRiskIndependentScoreRiskOnWeakeningTargetMin)
          || (sameDayStockReRiskIndependentScoreAllowHighVixCleanLowTarget
            && independentScoreHighVixClean
            && proposalTargetForBridge >= sameDayStockReRiskIndependentScoreHighVixCleanTargetMin))
        && (sameDayStockReRiskIndependentScoreErMin == null || (state.qqqEr20 ?? -Infinity) >= sameDayStockReRiskIndependentScoreErMin)
        && (sameDayStockReRiskIndependentScoreRoc20Min == null || (state.roc20 ?? -Infinity) >= sameDayStockReRiskIndependentScoreRoc20Min)
        && (sameDayStockReRiskIndependentScoreSma20SlopeMin == null || (state.sma20SlopePct ?? -Infinity) >= sameDayStockReRiskIndependentScoreSma20SlopeMin)
        && (sameDayStockReRiskIndependentScoreTrendScoreMin == null || (state.trendScore ?? -Infinity) >= sameDayStockReRiskIndependentScoreTrendScoreMin)
        && (sameDayStockReRiskIndependentScorePriceVsSma200MinPct == null || (state.priceVsSma200Pct ?? -Infinity) >= sameDayStockReRiskIndependentScorePriceVsSma200MinPct)
        && (!sameDayStockReRiskIndependentScoreRequireVixStable || ((state.vix ?? Infinity) <= 22 && (state.vixChange5d ?? Infinity) <= 0))
        && (!sameDayStockReRiskIndependentScoreRequireCleanShape || ((state.drawdownFromRecentHighPct ?? Infinity) < .05 && (state.priceExtensionAtr ?? Infinity) < 2.65))
        && (sameDayStockReRiskIndependentScoreNavDrawdownMaxPct == null
          || (state.navDrawdownPct ?? Infinity) <= sameDayStockReRiskIndependentScoreNavDrawdownMaxPct)
        && (!sameDayStockReRiskIndependentScoreRequireQqqUp || sameDayQqqReturn >= 0)
        && independentParticipationScore >= (independentScoreRangeBoundMinimum ?? (state.regime === 'RISK_ON_WEAKENING'
          && sameDayStockReRiskIndependentScoreRiskOnWeakeningMin != null
          ? sameDayStockReRiskIndependentScoreRiskOnWeakeningMin
          : independentScoreMinimum ?? Infinity));
      const actualRecoveryBridge = crossRegimeRecovery || cleanBullRecovery || independentScoreRecovery;
      sameDayStockReRiskIndependentParticipationScore = independentParticipationScore;
      sameDayStockReRiskIndependentScoreRecovery = independentScoreRecovery;
      sameDayStockReRiskActualRecoveryBridge = actualRecoveryBridge;
      const previousTargetForScope = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
      const targetJumpContext = previousTargetForScope != null && (previousEquityPoint?.tqqqPct ?? 0) >= previousTargetForScope - 1e-9;
      if (sameDayStockReRiskBullOnly && targetJumpContext && state.regime !== 'BULL') return sameDayStockReRiskReject('bull_only');
      if (!['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
        && !(sameDayStockReRiskAllowRangeBound && state.regime === 'RANGE_BOUND')
        && !(sameDayStockReRiskAllowRiskOnWeakening && state.regime === 'RISK_ON_WEAKENING')
        && !actualRecoveryBridge) return sameDayStockReRiskReject('regime');
      if (sameDayStockReRiskSr02Only && (state.slowSubregime ?? '') !== 'SR02' && !actualRecoveryBridge) return sameDayStockReRiskReject('sr02_only');
      const cleanBullBridgeBullOnly = sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull'
        || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq01'
        || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq02'
        || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_dd3'
        || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_ext20'
        || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_sr02'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m005'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m010'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m015'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_weak0'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd15'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd20'
        || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd25';
      const cleanBullBridgeExtendedOnly = sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_extended_only';
      const cleanBullBridge = sameDayStockReRiskCleanBullBridge != null
        && (cleanBullBridgeExtendedOnly
          ? state.regime === 'RISK_ON_EXTENDED'
          : cleanBullBridgeBullOnly ? state.regime === 'BULL' : ['BULL', 'RISK_ON_EXTENDED'].includes(state.regime))
        && (sameDayStockReRiskCleanBullBridge !== 'vix_all_roc_bull_sr02' || state.slowSubregime === 'SR02')
        && sameDayQqqReturn >= (sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq01' ? .001 : sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq02' ? .002 : 0)
        && (state.qqqEr20 ?? -Infinity) >= .30
        && (state.priceExtensionAtr ?? Infinity) < (sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_ext20' ? 2 : 2.65)
        && (state.drawdownFromRecentHighPct ?? Infinity) < (sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_dd3' ? .03 : sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd15' ? .015 : sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd20' ? .02 : sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd25' ? .025 : .05)
        && (sameDayStockReRiskCleanBullBridge !== 'vix_cap_roc_bull_roc5' || (state.roc5 ?? -Infinity) >= 0)
        && (sameDayStockReRiskCleanBullBridge !== 'vix_cap_roc_bull_roc5m005' || (state.roc5 ?? -Infinity) >= -.005)
        && (sameDayStockReRiskCleanBullBridge !== 'vix_cap_roc_bull_roc5m010' || (state.roc5 ?? -Infinity) >= -.01)
        && (sameDayStockReRiskCleanBullBridge !== 'vix_cap_roc_bull_roc5m015' || (state.roc5 ?? -Infinity) >= -.015)
        && (sameDayStockReRiskCleanBullBridge !== 'vix_cap_roc_bull_weak0' || (state.weakeningSignalCount ?? Number.POSITIVE_INFINITY) === 0);
      const cleanBullBridgeVixChange = cleanBullBridge;
      const cleanBullBridgeVixAll = cleanBullBridge && (sameDayStockReRiskCleanBullBridge === 'vix_all' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_extended' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq01' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq02' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_dd3' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_ext20' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_sr02');
      const cleanBullBridgeRoc = cleanBullBridge && (sameDayStockReRiskCleanBullBridge === 'vix_all_roc' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_extended' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq01' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_qqq02' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_dd3' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_ext20' || sameDayStockReRiskCleanBullBridge === 'vix_all_roc_bull_sr02' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m005' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m010' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_roc5m015' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_weak0' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd15' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd20' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_bull_dd25' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_extended' || sameDayStockReRiskCleanBullBridge === 'vix_cap_roc_extended_only');
      const allowHighErVixRise = sameDayStockReRiskAllowHighErVixRise
        && ['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
        && (state.vix ?? Infinity) <= sameDayStockReRiskVixMax
        && (state.qqqEr20 ?? -Infinity) >= sameDayStockReRiskHighErVixRiseErMin
        && (!sameDayStockReRiskHighErVixRiseRequireBullTrend || state.trend === 'BULL')
        && (state.trendScore ?? -Infinity) >= sameDayStockReRiskHighErVixRiseTrendScoreMin
        && sameDayQqqReturn >= sameDayStockReRiskQqqReturnMin
        && (!sameDayStockReRiskHighErVixRiseCleanExtension
          || (sameDayStockReRiskHighErVixRiseCleanExtensionExtendedVixRiseOnly
            && (state.regime !== 'RISK_ON_EXTENDED' || (state.vixChange5d ?? -Infinity) <= .02))
          || (sameDayStockReRiskHighErVixRiseCleanExtensionExtendedOnly && state.regime === 'BULL')
          || ((state.priceExtensionAtr ?? Infinity) < sameDayStockReRiskHighErVixRiseCleanExtensionPriceExtensionMax && (state.drawdownFromRecentHighPct ?? Infinity) < .05));
      if (((state.vix ?? Infinity) > sameDayStockReRiskVixMax && !cleanBullBridgeVixAll && !actualRecoveryBridge)
        || ((state.vixChange5d ?? Infinity) > .02 && !allowHighErVixRise && !cleanBullBridgeVixChange && !actualRecoveryBridge)) return sameDayStockReRiskReject('vix_gate');
      const allowBullNegativeRoc5VixFall = sameDayStockReRiskAllowBullNegativeRoc5VixFall
        && state.regime === 'BULL'
        && (state.roc5 ?? Infinity) < 0
        && (state.vixChange5d ?? Infinity) <= 0;
      if ((((state.roc5 ?? -Infinity) < 0 && !allowBullNegativeRoc5VixFall) || (state.priceVsSma200Pct ?? -Infinity) < 0) && !cleanBullBridgeRoc && !actualRecoveryBridge) return sameDayStockReRiskReject('trend_gate');
      if ((state.qqqEr20 ?? -Infinity) < sameDayStockReRiskErMin) return sameDayStockReRiskReject('er_min');
      if ((state.roc20 ?? -Infinity) < sameDayStockReRiskRoc20Min) return sameDayStockReRiskReject('roc20_min');
      const realizedVolMax = sameDayStockReRiskRiskOnRealizedVolMax != null
        && (state.regime === 'BULL' || state.regime === 'RISK_ON_EXTENDED')
        ? sameDayStockReRiskRiskOnRealizedVolMax
        : sameDayStockReRiskRealizedVolMax;
      if ((state.tqqqRealisedVol20d ?? Infinity) > realizedVolMax) return sameDayStockReRiskReject('realized_vol');
      if ((today.close / (qqqBars[i - 1]?.close ?? today.close) - 1) < sameDayStockReRiskQqqReturnMin
        && !(independentScoreRecovery
          && sameDayStockReRiskIndependentScoreAllowQqqDown
          && (sameDayStockReRiskIndependentScoreQqqReturnWindowBars < 2 || independentScoreQqqWindowReturn >= 0))
        && !independentScoreContinuationQqqDown) return sameDayStockReRiskReject('qqq_return_min');
      if (sameDayStockReRiskCleanBudgetOnly) {
        const riskBudgetData = (output.pipeline?.riskBudget as { data?: { trendParticipation?: { qualityOverrideClean?: boolean; conditionalCapApplied?: number } } } | undefined)?.data;
        if (state.regime !== 'BULL' || riskBudgetData?.trendParticipation?.qualityOverrideClean !== true || riskBudgetData.trendParticipation.conditionalCapApplied != null) return sameDayStockReRiskReject('clean_budget_state');
        if ((state.vix ?? Infinity) > 20 || (state.vixChange5d ?? Infinity) > 0 || (state.tqqqRealisedVol20d ?? Infinity) > .90) return sameDayStockReRiskReject('clean_budget_risk');
        if ((state.priceExtensionAtr ?? Infinity) >= 2 || (state.drawdownFromRecentHighPct ?? Infinity) >= .03) return sameDayStockReRiskReject('clean_budget_shape');
      }
      if (sameDayStockReRiskVolTargetOnly) {
        const riskBudgetData = (output.pipeline?.riskBudget as { data?: { binding_constraint?: string } } | undefined)?.data;
        const trendParticipationBindingAllowed = sameDayStockReRiskAllowTrendParticipation
          && riskBudgetData?.binding_constraint === 'trend_participation';
        const trendDiscountBindingAllowed = sameDayStockReRiskAllowTrendDiscount
          && riskBudgetData?.binding_constraint === 'trend_discount';
        const targetFloorBindingAllowed = trendParticipationBindingAllowed || trendDiscountBindingAllowed;
        if (riskBudgetData?.binding_constraint !== 'vol_target' && !targetFloorBindingAllowed && !slowBullVixLowTargetBridge && !slowBullTrendLowTargetBridge) return sameDayStockReRiskReject('binding_constraint');
        if (targetFloorBindingAllowed && sameDayStockReRiskRequireTrendParticipationEligible
          && (riskBudgetData as { trendParticipation?: { eligible?: boolean } } | undefined)?.trendParticipation?.eligible !== true) return sameDayStockReRiskReject('trend_participation_ineligible');
        if (targetFloorBindingAllowed && sameDayStockReRiskTrendParticipationTargetMinPct != null) {
          const proposalTargetPct = (proposal as { targetPct?: unknown }).targetPct;
          if (typeof proposalTargetPct !== 'number' || proposalTargetPct < sameDayStockReRiskTrendParticipationTargetMinPct) return sameDayStockReRiskReject('trend_participation_target');
        }
      }
      if (sameDayStockReRiskTrendScoreMin != null) {
        const riskBudgetData = (output.pipeline?.riskBudget as { data?: { trendParticipation?: { score?: number } } } | undefined)?.data;
        if ((riskBudgetData?.trendParticipation?.score ?? -Infinity) < sameDayStockReRiskTrendScoreMin) return sameDayStockReRiskReject('trend_score');
      }
      if (sameDayStockReRiskRequireTrendActive) {
        const riskBudgetData = (output.pipeline?.riskBudget as { data?: { trendParticipation?: { active?: boolean } } } | undefined)?.data;
        if (riskBudgetData?.trendParticipation?.active !== true) return sameDayStockReRiskReject('trend_inactive');
      }
      if (sameDayStockReRiskRequireBoxxSell
        && !output.proposals.some(proposal => proposal.kind === 'equity' && proposal.symbol === 'BOXX' && proposal.side === 'SELL')) return sameDayStockReRiskReject('boxx_sell');
      if (sameDayStockReRiskStrongCore && ((state.qqqEr20 ?? -Infinity) < .30 || (state.roc20 ?? -Infinity) < .02 || (state.sma20SlopePct ?? -Infinity) < 0 || (state.priceExtensionAtr ?? Infinity) >= 2.65 || (state.drawdownFromRecentHighPct ?? Infinity) >= .05)) return sameDayStockReRiskReject('strong_core');
      if (sameDayStockReRiskTailVetoMode
        && ((sameDayStockReRiskTailVetoMode !== 'qqq_up' && (state.vixChange5d ?? Infinity) > 0)
          || (sameDayStockReRiskTailVetoMode !== 'vix_stable'
            && (today.close / (qqqBars[i - 1]?.close ?? today.close) - 1) < 0
            && !(independentScoreRecovery
              && (sameDayStockReRiskIndependentScoreBypassQqqDirectionGate
                || (sameDayStockReRiskIndependentScoreAllowQqqDown
                  && sameDayStockReRiskIndependentScoreQqqReturnWindowBars >= 2
                  && independentScoreQqqWindowReturn >= 0)))
            && !independentScoreContinuationQqqDown))) return sameDayStockReRiskReject('tail_veto');
      const currentActual = stockNav > 0 ? leveragedValue / stockNav : (previousEquityPoint?.tqqqPct ?? 0);
      const actualForReRisk = (sameDayStockReRiskUseCurrentActual
        || (crossRegimeRecovery && sameDayStockReRiskCrossRegimeRecoveryFromActual)
        || (cleanBullRecovery && sameDayStockReRiskCleanBullRecoveryFromActual)
        || independentScoreRecovery)
        ? currentActual
        : (previousEquityPoint?.tqqqPct ?? 0);
      if (actualForReRisk < sameDayStockReRiskMinActual) return sameDayStockReRiskReject('min_actual');
      if (sameDayStockReRiskRequirePriorQqqUp && i < 2) return sameDayStockReRiskReject('prior_qqq_up_data');
      if (sameDayStockReRiskRequirePriorQqqUp && (qqqBars[i - 1]?.close ?? 0) / (qqqBars[i - 2]?.close ?? qqqBars[i - 1]?.close ?? 1) - 1 < 0) return sameDayStockReRiskReject('prior_qqq_down');
      if (sameDayStockReRiskPriorQqqReturnMin > -Infinity && i < 2) return sameDayStockReRiskReject('prior_qqq_min_data');
      if (sameDayStockReRiskPriorQqqReturnMin > -Infinity && (qqqBars[i - 1]?.close ?? 0) / (qqqBars[i - 2]?.close ?? qqqBars[i - 1]?.close ?? 1) - 1 < sameDayStockReRiskPriorQqqReturnMin) return sameDayStockReRiskReject('prior_qqq_min');
      if (sameDayStockReRiskRequirePriorTqqqUp && leveragedIndex < 2) return sameDayStockReRiskReject('prior_tqqq_up_data');
      const priorLeveragedClose = leveragedIndex > 1 ? leveragedBars[leveragedIndex - 2]?.close : undefined;
      if (sameDayStockReRiskRequirePriorTqqqUp && (previousLeveragedClose ?? 0) / (priorLeveragedClose ?? previousLeveragedClose ?? 1) - 1 < 0) return sameDayStockReRiskReject('prior_tqqq_down');
      if (sameDayStockReRiskTqqqUp && (leveragedBar?.close ?? 0) / (previousLeveragedClose ?? leveragedBar?.close ?? 1) - 1 < 0) return sameDayStockReRiskReject('tqqq_down');
      if (state.crisisPhase === 'CONFIRMED' || state.flashCrashOverrideActive === true) return sameDayStockReRiskReject('crisis');
      if (!sameDayStockReRiskAllowTargetJump && (previousEquityPoint?.tqqqPct ?? 0) >= (previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct ?? 0)) return sameDayStockReRiskReject('target_not_above_actual');
      const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
      const proposalTargetPct = (proposal as { targetPct?: unknown }).targetPct;
      const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
      if (sameDayStockReRiskNavDrawdownTargetCapPct != null
        && (previousEquityPoint?.marketContext?.navDrawdownPct ?? 0) >= .10
        && targetPct != null
        && targetPct > sameDayStockReRiskNavDrawdownTargetCapPct) return sameDayStockReRiskReject('nav_target_cap');
      const previousThreshold = sameDayStockReRiskFromActual ? actualForReRisk : previousTarget;
      const riskBudgetData = (output.pipeline?.riskBudget as { data?: { binding_constraint?: string } } | undefined)?.data;
      const localGapFloorApplies = sameDayStockReRiskLocalMinGapMode === 'clean_bull_dd1'
        && sameDayStockReRiskLocalMinGapPp > 0
        && state.regime === 'BULL'
        && riskBudgetData?.binding_constraint === 'vol_target'
        && targetPct != null
        && targetPct >= .80
        && (state.navDrawdownPct ?? Infinity) <= .01
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.tqqqRealisedVol20d ?? Infinity) <= .90
        && (state.priceExtensionAtr ?? Infinity) < 2.65;
      const effectiveMinGapPp = localGapFloorApplies ? sameDayStockReRiskLocalMinGapPp : sameDayStockReRiskMinGapPp;
      if (effectiveMinGapPp > 0 && previousThreshold != null && targetPct != null && targetPct - previousThreshold < effectiveMinGapPp) return sameDayStockReRiskReject('min_target_gap');
      const gapVixJumpState = sameDayStockReRiskGapVixMaxTargetJumpPp != null
        && targetPct != null
        && targetPct >= .60
        && targetPct - actualForReRisk >= .40
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.navDrawdownPct ?? Infinity) <= .03;
      const cleanActualJumpCapPp = config.strategyParams?.researchSameDayStockReRiskIndependentScoreCleanActualJumpCapPp;
      const independentScoreCleanActualNearTargetJump = independentScoreRecovery
        && cleanActualJumpCapPp != null
        && independentParticipationScore >= 6
        && targetPct != null
        && targetPct >= .80
        && actualForReRisk != null
        && targetPct > actualForReRisk
        && targetPct - actualForReRisk <= cleanActualJumpCapPp
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.tqqqRealisedVol20d ?? Infinity) <= .70
        && (state.navDrawdownPct ?? Infinity) <= .03;
      const strongTrendJumpCapPp = config.strategyParams?.researchSameDayStockReRiskStrongTrendJumpCapPp;
      const independentScoreStrongTrendJumpOverride = independentScoreRecovery
        && strongTrendJumpCapPp != null
        && independentParticipationScore >= sameDayStockReRiskStrongTrendJumpScoreMin
        && targetPct != null
        && targetPct >= .80
        && actualForReRisk != null
        && targetPct > actualForReRisk
        && riskBudgetData?.binding_constraint === 'vol_target'
        && sameDayQqqReturn >= 0
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.tqqqRealisedVol20d ?? Infinity) <= .70
        && (state.navDrawdownPct ?? Infinity) <= .03
        && (state.drawdownFromRecentHighPct ?? Infinity) < .05
        && (!sameDayStockReRiskStrongTrendJumpRequireCleanShape
          || (state.priceExtensionAtr ?? Infinity) < 2.65)
        && (state.adx14 ?? -Infinity) >= 15
        && (state.roc20 ?? -Infinity) >= 0
        && (state.sma20SlopePct ?? -Infinity) >= 0
        && (state.trendScore ?? -Infinity) >= 50
        && (sameDayStockReRiskStrongTrendJumpMinActualPct == null || (actualForReRisk ?? -Infinity) >= sameDayStockReRiskStrongTrendJumpMinActualPct)
        && (sameDayStockReRiskStrongTrendJumpPreviousTargetMinPct == null
          || (previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct ?? -Infinity) >= sameDayStockReRiskStrongTrendJumpPreviousTargetMinPct);
      const independentScoreJumpOverride = independentScoreRecovery
        && sameDayStockReRiskIndependentScoreMaxTargetJumpPp != null
        && (sameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct == null
          || (state.navDrawdownPct ?? Infinity) <= sameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct);
      const independentScoreHighQualityJumpOverride = independentScoreRecovery
        && sameDayStockReRiskIndependentScoreHighQualityJumpCapPp != null
        && independentParticipationScore >= 6
        && (state.regime === 'BULL' || state.regime === 'RISK_ON_EXTENDED')
        && riskBudgetData?.binding_constraint === 'vol_target'
        && sameDayQqqReturn >= 0
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.tqqqRealisedVol20d ?? Infinity) <= .70
        && (sameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct == null
          || (state.navDrawdownPct ?? Infinity) <= sameDayStockReRiskIndependentScoreJumpNavDrawdownMaxPct);
      const sharedRecoveryJumpCapPp = sameDayStockReRiskSharedRecoveryJumpCap
        && sameDayStockReRiskIndependentScoreMaxTargetJumpPp != null
        ? sameDayStockReRiskIndependentScoreMaxTargetJumpPp
        : undefined;
      const effectiveMaxTargetJumpPp = independentScoreHighQualityJumpOverride
        ? sameDayStockReRiskIndependentScoreHighQualityJumpCapPp
        : independentScoreCleanActualNearTargetJump
        ? cleanActualJumpCapPp
        : independentScoreStrongTrendJumpOverride
        ? strongTrendJumpCapPp
        : independentScoreJumpOverride
        ? sameDayStockReRiskIndependentScoreMaxTargetJumpPp
        : actualRecoveryBridge && (sharedRecoveryJumpCapPp != null || sameDayStockReRiskCrossRegimeRecoveryMaxTargetJumpPp != null)
        ? sharedRecoveryJumpCapPp ?? sameDayStockReRiskCrossRegimeRecoveryMaxTargetJumpPp
        : gapVixJumpState
        ? sameDayStockReRiskGapVixMaxTargetJumpPp
        : sameDayStockReRiskLowRvMaxTargetJumpPp != null
        && (state.regime === 'BULL' || (sameDayStockReRiskLowRvIncludeExtended && state.regime === 'RISK_ON_EXTENDED'))
        && (state.vixChange5d ?? Infinity) <= 0
        && (state.tqqqRealisedVol20d ?? Infinity) <= .70
        ? sameDayStockReRiskLowRvMaxTargetJumpPp
        : sameDayStockReRiskMaxTargetJumpPp;
      const independentScoreActualNearTargetJump = sameDayStockReRiskIndependentScoreUseActualForJumpCap
        && independentScoreJumpOverride
        && sameDayStockReRiskIndependentScoreMaxTargetJumpPp != null
        && actualForReRisk != null
        && targetPct != null
        && targetPct > actualForReRisk
        && targetPct - actualForReRisk <= sameDayStockReRiskIndependentScoreMaxTargetJumpPp;
      const priorActualForJump = previousEquityPoint?.tqqqPct;
      const independentScorePriorActualRestoreJump = sameDayStockReRiskIndependentScoreUsePriorActualForJumpCap
        && independentScoreJumpOverride
        && sameDayStockReRiskIndependentScoreMaxTargetJumpPp != null
        && priorActualForJump != null
        && actualForReRisk != null
        && priorActualForJump >= (sameDayStockReRiskIndependentScorePriorActualMinPct ?? Infinity)
        && priorActualForJump > actualForReRisk
        && previousTarget != null
        && targetPct != null
        && targetPct > previousTarget
        && targetPct > priorActualForJump
        && targetPct - priorActualForJump <= sameDayStockReRiskIndependentScoreMaxTargetJumpPp;
      const scopedHighQualityPartialJumpFraction = independentScoreHighQualityJumpOverride
        && sameDayStockReRiskIndependentScoreHighQualityJumpFraction != null
        ? sameDayStockReRiskIndependentScoreHighQualityJumpFraction
        : undefined;
      const partialJumpFraction = scopedHighQualityPartialJumpFraction
        ?? sameDayStockReRiskIndependentScorePartialJumpFraction
        ?? (independentScoreStrongTrendJumpOverride ? sameDayStockReRiskStrongTrendJumpFraction : undefined);
      if (partialJumpFraction != null
        && independentScoreJumpOverride
        && sameDayStockReRiskMaxTargetJumpPp != null
        && effectiveMaxTargetJumpPp != null
        && previousTarget != null
        && targetPct != null
        && targetPct - previousTarget > sameDayStockReRiskMaxTargetJumpPp
        && targetPct - previousTarget <= effectiveMaxTargetJumpPp) {
        sameDayStockReRiskFractionOverride = partialJumpFraction;
      }
      const queuedLargeTargetJump = sameDayStockReRiskQueueLargeTargetJump
        && sameDayStockReRiskAllowTargetJump
        && actualRecoveryBridge
        && effectiveMaxTargetJumpPp != null
        && previousTarget != null
        && targetPct != null
        && actualForReRisk != null
        && targetPct - previousTarget > effectiveMaxTargetJumpPp + sameDayStockReRiskTargetJumpEpsilonPp
        && targetPct > actualForReRisk
        && previousTarget + effectiveMaxTargetJumpPp / 100 > actualForReRisk;
      if (queuedLargeTargetJump) {
        const maxQueuedTarget = previousTarget! + effectiveMaxTargetJumpPp / 100;
        const targetGap = targetPct! - actualForReRisk!;
        const queuedGap = Math.max(0, Math.min(targetGap, maxQueuedTarget - actualForReRisk!));
        const queuedFraction = targetGap > 0 ? queuedGap / targetGap : 0;
        sameDayStockReRiskFractionOverride = Math.min(sameDayStockReRiskFractionOverride ?? 1, queuedFraction);
      }
      if (sameDayStockReRiskIndependentScoreLowTrendScoreMax != null
        && sameDayStockReRiskIndependentScoreLowTrendFraction != null
        && independentScoreRecovery
        && (state.trendScore ?? Infinity) < sameDayStockReRiskIndependentScoreLowTrendScoreMax) {
        sameDayStockReRiskFractionOverride = Math.min(sameDayStockReRiskFractionOverride ?? 1, sameDayStockReRiskIndependentScoreLowTrendFraction);
      }
      if (sameDayStockReRiskAllowTargetJump && effectiveMaxTargetJumpPp != null && previousTarget != null && targetPct != null && targetPct - previousTarget > effectiveMaxTargetJumpPp + sameDayStockReRiskTargetJumpEpsilonPp && !independentScoreActualNearTargetJump && !independentScorePriorActualRestoreJump && !queuedLargeTargetJump) return sameDayStockReRiskReject('max_target_jump');
      if (!(previousThreshold != null && targetPct != null && targetPct > previousThreshold)) return sameDayStockReRiskReject('no_actual_gap');
      if (independentScoreRecovery && !independentScoreContinuationQqqDown) sameDayIndependentScoreCarrySource = true;
      if (independentScoreRecovery
        && state.regime === 'RANGE_BOUND'
        && sameDayStockReRiskIndependentScoreRangeBoundFraction != null) {
        sameDayStockReRiskFractionOverride = Math.min(
          sameDayStockReRiskFractionOverride ?? 1,
          sameDayStockReRiskIndependentScoreRangeBoundFraction,
        );
      }
      if (independentScoreVolTargetFallback
        && independentParticipationScore < (sameDayStockReRiskIndependentScoreMin ?? Infinity)
        && sameDayStockReRiskIndependentScoreVolTargetFraction != null) {
        sameDayStockReRiskFractionOverride = sameDayStockReRiskIndependentScoreVolTargetFraction;
      }
      return true;
    };
    const navDrawdownTargetIncreaseBlocked = (proposal: typeof output.proposals[number]) => {
      if (navDrawdownTargetIncreaseCapPct == null
        || proposal.kind !== 'equity'
        || proposal.symbol !== leveragedSymbol
        || proposal.side !== 'BUY') return false;
      if ((previousEquityPoint?.marketContext?.navDrawdownPct ?? 0) < navDrawdownTargetIncreaseMinPct) return false;
      const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
      const proposalTargetPct = (proposal as { targetPct?: unknown }).targetPct;
      const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
      return previousTarget != null
        && targetPct != null
        && targetPct > previousTarget + 1e-9
        && targetPct > navDrawdownTargetIncreaseCapPct + 1e-9;
    };
    if (sameDayUpstreamAllowed || sameDayTargetDropPp > 0 || sameDayStockDeRisk || sameDayStockReRisk) {
      const sameDayStockReRiskReleaseBoxxSameDay = config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDay === true;
      const sameDayStockReRiskReleaseBoxxSameDayBullOnly = config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDayBullOnly === true;
      const sameDayStockReRiskReleaseBoxxSameDayRiskOnWeakeningOnly = config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDayRiskOnWeakeningOnly === true;
      const sameDayStockReRiskReleaseBoxxSameDayFraction = Math.min(1, Math.max(0, config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDayFraction ?? 1));
      const sameDayStockReRiskReleaseBoxxSameDayNavDrawdownMaxPct = config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDayNavDrawdownMaxPct;
      const sameDayStockReRiskReleaseBoxxSameDayVixMax = config.strategyParams?.researchSameDayStockReRiskReleaseBoxxSameDayVixMax;
      const sameDayIndependentReRiskEligible = sameDayStockReRiskReleaseBoxxSameDay
        && output.proposals.some((proposal) => proposal.kind === 'equity'
          && proposal.symbol === leveragedSymbol
          && proposal.side === 'BUY'
          && sameDayStockReRiskAllowed(proposal));
      const sameDayReRiskFundingSell = sameDayIndependentReRiskEligible
        && (!sameDayStockReRiskReleaseBoxxSameDayBullOnly || output.currentState.regime === 'BULL')
        && (!sameDayStockReRiskReleaseBoxxSameDayRiskOnWeakeningOnly || output.currentState.regime === 'RISK_ON_WEAKENING')
        && (sameDayStockReRiskReleaseBoxxSameDayNavDrawdownMaxPct == null
          || (output.currentState.navDrawdownPct ?? Infinity) <= sameDayStockReRiskReleaseBoxxSameDayNavDrawdownMaxPct)
        && (sameDayStockReRiskReleaseBoxxSameDayVixMax == null
          || (output.currentState.vix ?? Infinity) <= sameDayStockReRiskReleaseBoxxSameDayVixMax)
        && output.proposals.some((proposal) => proposal.kind === 'equity'
          && proposal.symbol === 'BOXX'
          && proposal.side === 'SELL');
      for (const proposal of output.proposals) {
        const isUpstreamBlock = proposal.kind === 'equity'
          && proposal.symbol === leveragedSymbol
          && proposal.side === 'SELL'
          && proposal.executionReasonKey === 'upstream_block';
        const isTargetDrop = sameDayTargetDropAllowed(proposal);
        const isStockDeRisk = sameDayStockDeRiskAllowed(proposal);
        const isStockReRisk = sameDayStockReRiskAllowed(proposal);
        const isSameDayReRiskFundingSell = sameDayReRiskFundingSell
          && proposal.kind === 'equity'
          && proposal.symbol === 'BOXX'
          && proposal.side === 'SELL';
        if (config.strategyParams?.researchSameDayStockDeRiskDiagnostic === true
          && proposal.kind === 'equity'
          && proposal.symbol === leveragedSymbol
          && proposal.side === 'SELL'
          && sameDayStockDeRisk) {
          const proposalTarget = (proposal as { targetPct?: unknown }).targetPct;
          const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
          const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
            ? leveragedDayPrice / previousLeveragedClose - 1
            : undefined;
          const currentActual = stockNav > 0 ? leveragedValue / stockNav : (previousEquityPoint?.tqqqPct ?? 0);
          sameDayStockDeRiskDiagnostics.push({
            date: today.date,
            targetPct: typeof proposalTarget === 'number' ? proposalTarget : undefined,
            previousActual: previousEquityPoint?.tqqqPct,
            previousTarget: previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct,
            currentActual,
            sameDayTqqqReturn,
            regime: output.currentState.regime,
            previousRegime: previousEquityPoint?.regime ?? previousEquityPoint?.marketContext?.regime,
            roc5: output.currentState.roc5,
            roc20: output.currentState.roc20,
            vix: output.currentState.vix,
            vixChange5d: output.currentState.vixChange5d,
            navDrawdownPct: output.currentState.navDrawdownPct,
            tqqqRealisedVol20d: output.currentState.tqqqRealisedVol20d,
            executionReasonKey: proposal.executionReasonKey,
            sameDayStockDeRiskMode,
            sameDayStockDeRiskFraction,
            sameDayStockDeRiskFractionOverride,
            quantity: proposal.quantity,
          });
        }
        if (config.strategyParams?.researchSameDayStockReRiskDiagnostic === true
          && proposal.kind === 'equity'
          && proposal.symbol === leveragedSymbol
          && proposal.side === 'BUY') {
          const proposalTarget = (proposal as { targetPct?: unknown }).targetPct;
          const currentActual = stockNav > 0 ? leveragedValue / stockNav : (previousEquityPoint?.tqqqPct ?? 0);
          sameDayReriskDiagnostics.push({
            date: today.date,
            allowed: isStockReRisk,
            targetPct: typeof proposalTarget === 'number' ? proposalTarget : undefined,
            previousActual: previousEquityPoint?.tqqqPct,
            previousTarget: previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct,
            currentActual,
            targetGapFromPreviousActual: typeof proposalTarget === 'number' && previousEquityPoint?.tqqqPct != null ? proposalTarget - previousEquityPoint.tqqqPct : undefined,
            sameDayQqqReturn: today.close / (qqqBars[i - 1]?.close ?? today.close) - 1,
            regime: output.currentState.regime,
            independentParticipationScore: sameDayStockReRiskIndependentParticipationScore,
            independentScoreRecovery: sameDayStockReRiskIndependentScoreRecovery,
            independentScoreContinuation: sameDayStockReRiskIndependentScoreContinuation,
            actualRecoveryBridge: sameDayStockReRiskActualRecoveryBridge,
            bindingConstraint: (output.pipeline?.riskBudget as { data?: { binding_constraint?: string } } | undefined)?.data?.binding_constraint,
            marketContext: output.currentState,
            executionReasonKey: proposal.executionReasonKey,
            rejectReason: isStockReRisk ? 'allowed' : sameDayStockReRiskRejectReason,
          });
        }
        if ((!sameDayUpstreamAllowed || !isUpstreamBlock) && !isTargetDrop && !isStockDeRisk && !isStockReRisk && !isSameDayReRiskFundingSell) continue;
        const sameDayFraction = isStockDeRisk ? (sameDayStockDeRiskFractionOverride ?? sameDayStockDeRiskFraction) : isStockReRisk ? (sameDayStockReRiskFractionOverride ?? sameDayStockReRiskFraction) : isTargetDrop ? sameDayTargetDropFraction : 1;
        const sameDayQuantity = proposal.quantity * sameDayFraction;
        const residualQuantity = proposal.quantity - sameDayQuantity;
        if (sameDayQuantity > 0 && !isSameDayReRiskFundingSell) {
          pendingEquityOrders.push({
            symbol: leveragedSymbol,
            side: proposal.side,
            quantity: sameDayQuantity,
            rationale: proposal.rationale,
            signalDate: today.date,
            signalClose: leveragedDayPrice,
            executionReason: proposal.executionReason,
            executionReasonKey: isStockDeRisk ? 'research_same_day_stock_derisk' : isStockReRisk ? 'research_same_day_stock_rerisk' : (isTargetDrop ? 'research_target_drop' : proposal.executionReasonKey),
            targetPct: 'targetPct' in proposal ? proposal.targetPct : undefined,
            marketContext: output.currentState,
          });
        }
        if (isSameDayReRiskFundingSell && proposal.quantity * sameDayStockReRiskReleaseBoxxSameDayFraction > 0) {
          pendingEquityOrders.push({
            symbol: 'BOXX',
            side: 'SELL',
            quantity: proposal.quantity * sameDayStockReRiskReleaseBoxxSameDayFraction,
            rationale: proposal.rationale,
            signalDate: today.date,
            signalClose: boxxDayPrice,
            executionReason: proposal.executionReason,
            executionReasonKey: 'research_same_day_stock_rerisk_funding_sell',
            marketContext: output.currentState,
          });
        }
        if ((isStockDeRisk || isStockReRisk) && residualQuantity > 0) {
          pendingEquityOrders.push({
            symbol: leveragedSymbol,
            side: proposal.side,
            quantity: residualQuantity,
            rationale: proposal.rationale,
            signalDate: today.date,
            signalClose: leveragedDayPrice,
            executionReason: proposal.executionReason,
            executionReasonKey: proposal.executionReasonKey,
            targetPct: 'targetPct' in proposal ? proposal.targetPct : undefined,
            marketContext: output.currentState,
          });
        }
      }
      const sameDayExecutions = executePendingEquityOrders({
        orders: pendingEquityOrders,
        portfolio,
        leveragedSymbol,
        shouldExecute: (order) => order.signalDate === today.date && (order.executionReasonKey === 'upstream_block' || order.executionReasonKey === 'research_target_drop' || order.executionReasonKey === 'research_same_day_stock_derisk' || order.executionReasonKey === 'research_same_day_stock_rerisk' || order.executionReasonKey === 'research_same_day_stock_rerisk_funding_sell'),
        sellFirst: sameDayReRiskFundingSell,
        resolveFillPrice: (order) => resolveEquityOrderFill({
          side: order.side,
          mode: 'next_open',
          signalClose: order.signalClose,
          nextOpen: order.signalClose,
          slippagePct: slippagePct * stressMult(resolveVolAt(today.date, vixByDate)),
        }),
      });
      recordEquityExecutions(sameDayExecutions);
      if (sameDayStockDeRiskBuyCooldownBars > 0 && sameDayExecutions.some(({ order }) => order.side === 'SELL' && order.symbol === leveragedSymbol)) {
        sameDayStockDeRiskBuyCooldownRemaining = Math.max(sameDayStockDeRiskBuyCooldownRemaining, sameDayStockDeRiskBuyCooldownBars + 1);
      }
    }
    const configuredIndependentScoreCarryBars = Math.max(0, Math.floor(config.strategyParams?.researchSameDayStockReRiskIndependentScoreCarryBars ?? 0));
    if (sameDayIndependentScoreCarrySource && configuredIndependentScoreCarryBars > 0) {
      researchIndependentScoreCarryRemaining = configuredIndependentScoreCarryBars;
    } else if (researchIndependentScoreCarryRemaining > 0) {
      researchIndependentScoreCarryRemaining -= 1;
    }
    const __tExecC = profMark();
    const stockPolicy = (output.pipeline as Record<string, { value?: { overrides?: { crisisRecoveryBars?: number } } }>).stockPolicy;
    policyCrisisRecoveryBars = stockPolicy?.value?.overrides?.crisisRecoveryBars;
    lastMarketContext = output.currentState;

    if (csBreachState && csBreachState.breachDate === today.date) {
      const levIdx = leveragedIdx.get(today.date) ?? -1;
      csBreachState.tqqqROC20AtBreach = levIdx >= 20
        ? (leveragedBars[levIdx].close - leveragedBars[levIdx - 20].close) / leveragedBars[levIdx - 20].close
        : 0;
      csBreachState.regimeAtBreach = output.currentState.regime;
    }

    const pipelineOverlayData = (output.pipeline as Record<string, { data?: { csBreachState?: CSBreachState; csSecondaryEventRiskState?: CSEventRiskState } }>)?.overlay?.data;
    if (pipelineOverlayData?.csBreachState !== undefined) {
      csBreachState = pipelineOverlayData.csBreachState;
    }
    if (pipelineOverlayData?.csSecondaryEventRiskState !== undefined) {
      csSecondaryEventRiskState = pipelineOverlayData.csSecondaryEventRiskState;
    }
    if (i === qqqBars.length - 1) {
      nextOpenPlan = {
        signalDate: today.date,
        systemStatus: output.systemStatus,
        marketState: output.currentState,
        currentAllocation: output.currentAllocation,
        targetAllocation: output.targetAllocation,
        proposals: output.proposals,
        overlay: output.overlay,
        blockers: output.blockers,
        warnings: output.warnings,
      };
    }

    // Backfill marketContext for any settlements/closes that occurred today before runPipeline
    for (let k = tradeLog.length - 1; k >= 0; k--) {
      const entry = tradeLog[k];
      if (entry.date !== today.date) break;
      if (!entry.marketContext) {
        entry.marketContext = output.currentState;
      }
    }

    const spyDayIdx = spyIdx && spyBars ? spyIdx.get(today.date) : undefined;
    const spyPrice = spyDayIdx !== undefined && spyBars ? spyBars[spyDayIdx]?.close : undefined;
    profRecord('execution', __tExecC);

    const liveOverlayProposals: readonly OverlayProposal[] = output.overlay.overlayProposals?.length
      ? output.overlay.overlayProposals
      : output.overlay.action !== 'NONE'
        ? [output.overlay]
        : [];
    const canonicalOverlayProposals = config.canonicalOptionSignalTape
      ? optionProposalsFromCanonicalTape(config.canonicalOptionSignalTape, today.date, config.canonicalOptionSignalDataFingerprint)
      : undefined;
    // Freeze PCS eligibility from the shared tape, but let a contract profile replace only its legs.
    const canonicalMainProposals = canonicalOverlayProposals
      ? canonicalOverlayProposals.flatMap((proposal) => {
        const pcsContractProfile = resolvedGateParams.pcsContractProfile;
        const pcsPriceSelectionMode = resolvedGateParams.pcsSurvivalPriceSelectionMode ?? 'off';
        if (proposal.action !== 'ADD_PUT_CREDIT_SPREAD' || (!pcsContractProfile && pcsPriceSelectionMode === 'off')) return [proposal];
        const profiled = liveOverlayProposals.find((candidate) => candidate.action === 'ADD_PUT_CREDIT_SPREAD');
        if (pcsPriceSelectionMode !== 'off') return profiled ? [profiled] : [];
        if (!pcsContractProfile) return [proposal];
        if (profiled || !pcsContractProfile.startsWith('dynamic-')) return [profiled ?? proposal];
        // A fixed-tape signal remains eligible, but an unbuildable dynamic contract is not a fixed-leg trade.
        // Keep the skipped signal explicit so research can measure build failures without changing economics.
        pcsProfileDiagnostics.push({
          profile: pcsContractProfile,
          signalDate: today.date,
          reason: 'DYNAMIC_CONTRACT_UNBUILDABLE',
          detail: 'live_overlay_proposal_missing',
        });
        return [];
      })
      : [];
    const overlayProposals = canonicalOverlayProposals
      ? [...canonicalMainProposals, ...liveOverlayProposals.filter((proposal) => proposal.action === 'ADD_PCS_RESCUE')]
      : liveOverlayProposals;
    const hasPortfolioOptionLedger = !(independentIC && independentCS && independentPCS && independentEquityBoost && independentBearCS);
    const optionRiskCapDollars = stockNav * (config.strategyParams?.optionMaxTotalRiskNav ?? config.strategyParams?.csMaxTotalRiskNav ?? CS_MAX_TOTAL_RISK_NAV);
    const usedOptionRiskDollars = () =>
      (independentIC ? 0 : pendingICs.reduce((sum, position) => sum + ironCondorRiskDollars(position), 0)) +
      (independentCS ? 0 : pendingCSes.reduce((sum, position) => sum + definedRiskDollars(position), 0)) +
      (independentPCS ? 0 : pendingPCSes.reduce((sum, position) => sum + definedRiskDollars(position), 0)) +
      (independentEquityBoost ? 0 : pendingEquityBoosts.reduce((sum, position) => sum + definedRiskDollars(position), 0)) +
      (independentBearCS ? 0 : pendingBearCSes.reduce((sum, position) => sum + definedRiskDollars(position), 0));
    const optionRiskBudget: OptionRiskBudgetTrace | undefined = hasPortfolioOptionLedger
      ? { capDollars: optionRiskCapDollars, usedDollars: usedOptionRiskDollars(), remainingDollars: Math.max(0, optionRiskCapDollars - usedOptionRiskDollars()), attempts: optionRiskBudgetAttemptsByDate.get(today.date) ?? [] }
      : undefined;
    const remainingOptionRiskDollars = () => optionRiskBudget ? Math.max(0, optionRiskCapDollars - usedOptionRiskDollars()) : Infinity;
    const refreshOptionRiskBudget = () => {
      if (!optionRiskBudget) return;
      optionRiskBudget.usedDollars = usedOptionRiskDollars();
      optionRiskBudget.remainingDollars = Math.max(0, optionRiskCapDollars - optionRiskBudget.usedDollars);
    };

    const snapshotLeveragedValue = portfolio.leveragedShares * leveragedDayPrice;
    const snapshotBoxxValue = portfolio.boxxShares * boxxDayPrice;
    const snapshotStockNav = snapshotLeveragedValue + snapshotBoxxValue + portfolio.cash;
    const snapshotNav = snapshotStockNav + optionCash + optionMtM;
    navDrawdownPeak = Math.max(navDrawdownPeak, snapshotStockNav);
    const __tSnapshot = profMark();
    equityCurve.push(buildEquityPoint({ date: today.date, nav: snapshotNav, allocationNav: snapshotStockNav, cash: portfolio.cash + optionCash, tqqqValue: snapshotLeveragedValue, boxxValue: snapshotBoxxValue, tqqqShares: portfolio.leveragedShares, boxxShares: portfolio.boxxShares, output, hasOpenIC: pendingICs.length > 0, hasOpenCollar: pendingCollars.length > 0, hasOpenCS: pendingCSes.length > 0, hasOpenBearCS: pendingBearCSes.length > 0, hasOpenEquityBoost: pendingEquityBoosts.length > 0, benchmarkPrice: today.close, leveragedPrice: leveragedDayPrice, spyPrice, observedMacroRegime: macroRegimeState?.phase, targetVolOverride: config.targetVolByDate?.[today.date], sidewaysFactorOverride: config.sidewaysFactorByDate?.[today.date] }));
    if (dailyAdmissions) dailyAdmissions.push({ date: today.date, marketState: output.currentState, admissions: output.overlay.strategyAdmissions ?? [] });
    if (trace) {
      trace.push(buildTraceEntry({ date: today.date, nav, cash: portfolio.cash + optionCash, tqqqShares: portfolio.leveragedShares, tqqqValue: leveragedValue, boxxShares: portfolio.boxxShares, boxxValue, optionPositions, output, optionProposals: overlayProposals, optionRiskBudget, trades: tradeLog.filter(trade => trade.date === today.date) }));
    }
    profRecord('snapshot', __tSnapshot);
    const __tExecD = profMark();
    if (!nextDay || barDateKey(nextDay.date) !== barDateKey(today.date)) {
      prevCloseNav = snapshotStockNav;
    }

    if (isDecisionBar) {
      updateDecisionMemory(decisionMemory, output, true);
    }
    if (isDecisionBar) {
      const state = output.currentState;
      const bullStress = state.regime === 'BULL'
        && state.slowSubregime === 'SR02'
        && (state.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY) >= .6
        && (state.adx14 ?? Number.POSITIVE_INFINITY) < 20;
      pcsResearchP1BullStressStreak = bullStress ? pcsResearchP1BullStressStreak + 1 : 0;
    }

    if (isDecisionBar) {
      // Compute raw crisis signal from today's decision data for the next decision bar.
      const pipelineRegimeData = (output.pipeline as Record<string, { data?: { price_vs_sma200_pct?: number; roc5?: number } }>)?.regime?.data;
      const price_vs_sma200_today = pipelineRegimeData?.price_vs_sma200_pct ?? 0;
      const roc5Today = pipelineRegimeData?.roc5 ?? 0;
      prevCrisisRaw = computeRawCrisis(vixToday, price_vs_sma200_today, vix3mToday, roc5Today, {
        vixLedExit: config.strategyParams?.vixLedCrisisExit,
      });
    }
    const canOpenOnNextBar =
      isDecisionBar &&
      nextDay != null &&
      leveragedIdx.has(nextDay.date) &&
      (!endDate || nextDay.date <= endDate);
    const twapExecutionBar = equityFillMode === 'twap'
      ? qqqBars.slice(i + 1).find(bar => barDateKey(bar.date) !== barDateKey(today.date))
      : undefined;

    for (const proposal of output.proposals) {
      if (proposal.kind !== 'equity') continue;
      if ((sameDayUpstreamAllowed && proposal.symbol === leveragedSymbol && proposal.side === 'SELL' && proposal.executionReasonKey === 'upstream_block') || sameDayTargetDropAllowed(proposal) || sameDayStockDeRiskAllowed(proposal) || sameDayStockReRiskAllowed(proposal)) continue;
      if (researchUpstreamRecoveryDelayRemaining > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY') continue;
      if (recoveryBuyDelayBars > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY' && postCrisisBarsForResearch >= 0 && postCrisisBarsForResearch < recoveryBuyDelayBars) continue;
      if (sameDayStockDeRiskBuyCooldownRemaining > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY') continue;
      if (navDrawdownTargetIncreaseBlocked(proposal)) continue;
      if (!canOpenOnNextBar) continue;
      if (equityFillMode === 'twap' && (!twapExecutionBar || !leveragedIdx.has(twapExecutionBar.date))) continue;
      const isLeveragedOrder = proposal.symbol === leveragedSymbol;
      pendingEquityOrders.push({
        symbol: isLeveragedOrder ? leveragedSymbol : 'BOXX',
        side: proposal.side,
        quantity: proposal.quantity,
        rationale: proposal.rationale,
        signalDate: today.date,
        signalClose: isLeveragedOrder ? leveragedDayPrice : boxxDayPrice,
            executionReason: proposal.executionReason,
            executionReasonKey: proposal.executionReasonKey,
          targetPct: 'targetPct' in proposal ? proposal.targetPct : undefined,
            marketContext: output.currentState,
        ...(equityFillMode === 'twap' ? { twap: { executionDate: barDateKey(twapExecutionBar!.date), barsRemaining: equityTwapBars } } : {}),
      });
    }
    if (isDecisionBar && sameDayStockDeRiskBuyCooldownRemaining > 0) sameDayStockDeRiskBuyCooldownRemaining -= 1;
    const activeCollarShortCall = pendingCollars.some(collar => collar.callStrike != null);
    const collarBlocksOtherOverlays = config.strategyParams?.collarInteractionMode !== 'non_blocking';
    profRecord('execution', __tExecD);

    // ── Next-bar option fill chains (remove the 1-day premium look-ahead) ─────
    const __tChainB = profMark();
    // Decisions (proposed strikes) use today's chain/info, but the actual fill is
    // executed and priced at NEXT bar's OPEN — consistent with how equity orders
    // fill at next-day open. Without this, opens were credited at today's close
    // prices for a position dated tomorrow, a small favorable look-ahead.
    const nextLevBar  = nextDay ? leveragedBars[leveragedIdx.get(nextDay.date) ?? -1] : undefined;
    const nextQQQOpen = nextDay?.open ?? 0;
    const nextLevOpen = nextLevBar?.open ?? nextLevBar?.close ?? 0;
    const nextVix     = nextDay ? resolveVolAt(nextDay.date, vixByDate, vixToday) : vixToday;
    const nextPricingVol = nextDay ? resolvePricingVolAt(nextDay.date, nextVix) : pricingVolToday;
    const nextPricingVol3m = nextDay ? resolvePricingVol3mAt(nextDay.date, nextVix, nextPricingVol) : pricingVol3mToday;
    const hasProposal = (action: string) => overlayProposals.some(proposal => proposal.action === action);
    const needsNextQqqChain = hasProposal('ADD_IRON_CONDOR') || hasProposal('OPEN_BEAR_CALL_SPREAD') || hasProposal('ADD_CALL_SPREAD') || hasProposal('ADD_PUT_CREDIT_SPREAD') || hasProposal('ADD_EQUITY_BOOST_PUT_SPREAD') || hasProposal('ADD_PCS_RESCUE') || (hasProposal('ADD_COLLAR') && collarUsesQqqPut);
    const needsNextLevChain = hasProposal('ADD_COLLAR');
    const qqqFillContracts: MockChainContractRequest[] = [];
    const leveragedFillContracts: MockChainContractRequest[] = [];
    const addFillContract = (target: MockChainContractRequest[], expiry: string | undefined, pricingDte: number, strikes: Array<number | undefined>, types: Array<'call' | 'put'>) => {
      const resolvedStrikes = strikes.filter((strike): strike is number => typeof strike === 'number' && Number.isFinite(strike) && strike > 0);
      if (expiry && resolvedStrikes.length) target.push({ expiry, pricingDte, strikes: resolvedStrikes, types });
    };
    for (const proposal of overlayProposals) {
      const s = proposal.proposed_strikes;
      if (!s) continue;
      if (proposal.action === 'ADD_IRON_CONDOR') addFillContract(qqqFillContracts, s.expiry, IC_TARGET_DTE, [s.ic_put_short, s.ic_put_long, s.ic_call_short, s.ic_call_long], ['put', 'call']);
      if (proposal.action === 'OPEN_BEAR_CALL_SPREAD') addFillContract(qqqFillContracts, s.expiry, SPREAD_TARGET_DTE, [s.spread_short_strike, s.spread_long_strike], ['call']);
      if (proposal.action === 'ADD_CALL_SPREAD') {
        const pricingDte = proposal.csTier !== undefined
          ? config.strategyParams?.csSecondaryCoverageTargetDte ?? resolvedGateParams.csTargetDte ?? SPREAD_TARGET_DTE
          : resolvedGateParams.csTargetDte ?? SPREAD_TARGET_DTE;
        addFillContract(qqqFillContracts, s.expiry, pricingDte, [s.spread_short_strike, s.spread_long_strike], ['call']);
      }
      if (proposal.action === 'ADD_PUT_CREDIT_SPREAD') addFillContract(qqqFillContracts, s.expiry, resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE, [s.spread_short_strike, s.spread_long_strike], ['put']);
      if (proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD') addFillContract(qqqFillContracts, s.expiry, proposal.equityBoostPutSpread?.dte ?? config.strategyParams?.equityBoostTargetDte ?? SPREAD_TARGET_DTE, [s.eb_short_strike, s.eb_long_strike], ['put']);
      if (proposal.action === 'ADD_PCS_RESCUE') addFillContract(qqqFillContracts, s.expiry, config.strategyParams?.pcsRescueTargetDte ?? resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE, [s.spread_short_strike, s.spread_long_strike], ['put']);
      if (proposal.action === 'ADD_COLLAR') {
        const target = (s.put_symbol ?? leveragedSymbol) === 'QQQ' ? qqqFillContracts : leveragedFillContracts;
        addFillContract(target, s.expiry, COLLAR_TARGET_DTE, [s.put_strike, s.put_spread_short_strike], ['put']);
        addFillContract(leveragedFillContracts, s.expiry, COLLAR_TARGET_DTE, [s.call_strike], ['call']);
      }
    }
    const buildFillChains = useMockOptions && canOpenOnNextBar;
    const directQqqFillContracts = nextDay ? directFillContracts(nextDay.date, nextQQQOpen, proxySymbol, qqqFillContracts) : [];
    const directLeveragedFillContracts = nextDay ? directFillContracts(nextDay.date, nextLevOpen, leveragedSymbol, leveragedFillContracts) : [];
    const rawNextDayMockChain = buildFillChains && (!lazyMockChains ? overlayProposals.length > 0 : needsNextQqqChain) && nextDay && nextQQQOpen > 0
      ? cachedMockChain(nextDay.date, nextQQQOpen, nextPricingVol, proxySymbol, nextPricingVol3m, execution.preciseFillMockChains === false ? undefined : directQqqFillContracts)
      : undefined;
    const rawNextDayLevMockChain = buildFillChains && (!lazyMockChains ? overlayProposals.length > 0 : needsNextLevChain) && nextDay && nextLevOpen > 0
      ? cachedMockChain(nextDay.date, nextLevOpen, nextPricingVol, leveragedSymbol, nextPricingVol3m, execution.preciseFillMockChains === false ? undefined : directLeveragedFillContracts)
      : undefined;
    const nextDayMockChain = rawNextDayMockChain;
    const nextDayLevMockChain = rawNextDayLevMockChain;
    profRecord('chainLookup', __tChainB);
    (phaseProfiler as any)?.record?.('chainLookupFill', performance.now() - __tChainB);
    (phaseProfiler as any)?.record?.('chainLookupFillRawStrikes', (rawNextDayMockChain?.expirations.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0) + (rawNextDayLevMockChain?.expirations.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0));
    (phaseProfiler as any)?.record?.('chainLookupFillKeptStrikes', (nextDayMockChain?.expirations.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0) + (nextDayLevMockChain?.expirations.reduce((s, e) => s + e.calls.length + e.puts.length, 0) ?? 0));

    // ── Iron Condor: open if ADD_IRON_CONDOR and capacity allows ────────────
    const __tExecE = profMark();
    const ironCondorProposal = findOverlayProposal(overlayProposals, 'ADD_IRON_CONDOR');
    const icMaxConcurrent = Math.max(1, Math.floor(config.strategyParams?.icMaxConcurrent ?? 1));
    const lastIcOpenIdx = pendingICs.reduce((max, ic) => Math.max(max, qqqIdx.get(ic.openedAt) ?? -Infinity), -Infinity);
    const nextDayIdx = nextDay ? qqqIdx.get(nextDay.date) ?? i + 1 : i + 1;
    const icStaggerOk = independentIC || pendingICs.length === 0 || nextDayIdx - lastIcOpenIdx >= 5;
    const pcsRescueCoreFillFallbackAllowed = output.currentState.regime === 'RANGE_BOUND'
      || output.currentState.regime === 'SIDEWAYS'
      || output.currentState.regime === 'RISK_ON_WEAKENING';
    const pcsRescueE22FillFallbackAllowed = pcsRescueCoreFillFallbackAllowed
      || (output.currentState.regime === 'BULL' && (
        (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16
        || ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 16 && (
          (output.currentState.adx14 ?? Number.POSITIVE_INFINITY) < 15
          || resolvesBullSr01FillFallbackAllowed(config.strategyParams?.pcsRescueFillFallbackBullSr01VixReplacementMax, output.currentState)
          || (output.currentState.slowSubregime === 'SR02' && (output.currentState.vixChange5d ?? Number.POSITIVE_INFINITY) <= -.02)
        ))
      ));
    const pcsRescueE23FillFallbackAllowed = pcsRescueE22FillFallbackAllowed
      || (output.currentState.regime === 'RISK_ON_EXTENDED' && (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16)
      || (output.currentState.regime === 'BULL' && output.currentState.slowSubregime === 'SR02' && (output.currentState.vix ?? Number.POSITIVE_INFINITY) < 12);
    if (
      useMockOptions &&
      canOpenOnNextBar &&
      !!ironCondorProposal &&
      (independentIC || pendingICs.length < icMaxConcurrent) &&
      icStaggerOk
    ) {
      const s = ironCondorProposal.proposed_strikes;

      if (
        s?.ic_put_short && s?.ic_put_long &&
        s?.ic_call_short && s?.ic_call_long &&
        s?.expiry
      ) {
        const putWidth  = s.ic_put_short  - s.ic_put_long;
        const callWidth = s.ic_call_long  - s.ic_call_short;
        let qty = independentIC ? 1 : ironCondorProposal.ironCondor?.quantity ?? 1;
        const requestedQuantity = qty;
        const riskAttempt = createOptionRiskBudgetAttempt(nextDay.date, today.date, independentIC, 'IC', requestedQuantity, ironCondorProposal.ironCondor?.maxLoss ?? Math.max(putWidth, callWidth) * 100);
        const riskBudgetDollars = independentIC ? Infinity : remainingOptionRiskDollars();

        const expData = qty > 0 ? fillExpiry(nextDayMockChain?.expirations, s.expiry, IC_TARGET_DTE, nextDay.date) : undefined;

        if (expData) {
          const shortPut  = findOptionContract(expData.puts,  s.ic_put_short);
          const longPut   = findOptionContract(expData.puts,  s.ic_put_long);
          const shortCall = findOptionContract(expData.calls, s.ic_call_short);
          const longCall  = findOptionContract(expData.calls, s.ic_call_long);

          // #5c: clamp opening size to the thinnest leg's liquidity (no-op when off).
          const legVol = Math.min(
            shortPut?.volume ?? Infinity, longPut?.volume ?? Infinity,
            shortCall?.volume ?? Infinity, longCall?.volume ?? Infinity,
          );
          let fill = openIronCondorFill({ requestedQuantity: qty, maxQuantity: independentIC ? 1 : liqCap(legVol), shortPutBid: shortPut?.bid, longPutAsk: longPut?.ask, shortCallBid: shortCall?.bid, longCallAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
          const quantityBeforeBudgetClamp = fill.quantity;
          if (!independentIC) {
            qty = clampDefinedRiskQuantity(fill.quantity, riskBudgetDollars, Math.max(putWidth, callWidth) * 100 - (fill.quantity > 0 ? fill.totalCredit / fill.quantity : 0));
            if (qty !== fill.quantity) fill = openIronCondorFill({ requestedQuantity: qty, maxQuantity: qty, shortPutBid: shortPut?.bid, longPutAsk: longPut?.ask, shortCallBid: shortCall?.bid, longCallAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
          }
          const netCreditPerContract = fill.creditPerContract;
          const maxLossPerContract = qty > 0 ? Math.max(putWidth, callWidth) * 100 - fill.totalCredit / qty : Infinity;
          // Open-quality gate: credit / wing width must clear the per-mode floor.
          const icOpenCfg  = IC_MODE_CONFIG[config.strategyParams?.icMode ?? 'standard'];
          const icWingWidth = Math.max(putWidth, callWidth);
          const icCreditRatio = icWingWidth > 0 ? (netCreditPerContract / 100) / icWingWidth : 0;
          if (qty > 0 && fill.totalCredit > 0 && icCreditRatio >= icOpenCfg.minCreditRatio) {
            // Net the opening commission (4 legs) into the credit so cash and pnl agree.
            const totalCredit = fill.totalCredit;
            if (!independentIC) applyOverlayEffect(applyOptionExecution({ cashImpact: totalCredit, pnl: 0 }));

            // Capture 20d range for early exit range-breach check
            const range20d = isIntradayBacktest
              ? rangeAtEnd(decisionViews.qqq, 20)
              : qqqRolling.rangeAt(i, 20);

            pendingICs.add({
              openedAt:       nextDay.date,
              expiry:         s.expiry,
              putShort:       s.ic_put_short,
              putLong:        s.ic_put_long,
              callShort:      s.ic_call_short,
              callLong:       s.ic_call_long,
              quantity:       qty,
              creditReceived: totalCredit,
              putWidth,
              callWidth,
              range20dHigh:   range20d.high,
              range20dLow:    range20d.low,
              marketContext:  output.currentState,
            });
            if (riskAttempt) {
              riskAttempt.finalQuantity = qty;
              riskAttempt.maxLossPerContract = maxLossPerContract;
              riskAttempt.riskDollars = maxLossPerContract * qty;
              riskAttempt.status = qty < quantityBeforeBudgetClamp ? 'budget_clamped' : 'opened';
            }
            refreshOptionRiskBudget();

            tradeLog.push({
              signalDate: today.date,
              date:       nextDay.date,
              symbol:     ironCondorName,
              side:       'SELL',
              quantity:   qty,
              fillPrice:  netCreditPerContract / 100,
              cashImpact: totalCredit,
              rationale:  `Iron Condor：Put@${s.ic_put_long}/${s.ic_put_short} | Call@${s.ic_call_short}/${s.ic_call_long}，exp ${s.expiry}，区间 [${range20d.low.toFixed(1)}, ${range20d.high.toFixed(1)}]`,
              action:     'OPEN',
              strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR,
              executionReason: 'Iron Condor 开仓',
              executionReasonKey: 'iron_condor_open',
              marketContext: output.currentState,
            });
          } else if (riskAttempt && quantityBeforeBudgetClamp > 0 && qty === 0) {
            riskAttempt.status = 'budget_rejected';
          }
        }
      }
    }

    // ── Bear Call Spread: open from Bear Overlay proposal ──────────────────
    const bearCallSpreadProposal = findOverlayProposal(overlayProposals, 'OPEN_BEAR_CALL_SPREAD');
    if (
      useMockOptions &&
      canOpenOnNextBar &&
      !!bearCallSpreadProposal
    ) {
      const s = bearCallSpreadProposal.proposed_strikes;
      const bcs = bearCallSpreadProposal.bearCallSpread;
      if (s?.spread_short_strike && s?.spread_long_strike && s?.expiry) {
        const width = s.spread_long_strike - s.spread_short_strike;
        if (width > 0) {
          let qty = independentBearCS ? 1 : bcs?.quantity ?? 1;
          const requestedQuantity = qty;
          const riskAttempt = createOptionRiskBudgetAttempt(nextDay.date, today.date, independentBearCS, 'BEAR_CS', requestedQuantity, bcs?.maxLoss ?? width * 100);
          const riskBudgetDollars = independentBearCS ? Infinity : remainingOptionRiskDollars();
          const expData = fillExpiry(nextDayMockChain?.expirations, s.expiry, SPREAD_TARGET_DTE, nextDay.date);

          if (qty > 0 && expData) {
            const shortCall = findOptionContract(expData.calls, s.spread_short_strike);
            const longCall  = findOptionContract(expData.calls, s.spread_long_strike);
            // #5c: clamp opening size to the thinnest leg's liquidity (no-op when off).
            const legVol = Math.min(shortCall?.volume ?? Infinity, longCall?.volume ?? Infinity);
            let fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: independentBearCS ? 1 : liqCap(legVol), shortBid: shortCall?.bid, longAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
            const quantityBeforeBudgetClamp = fill.quantity;
            if (!independentBearCS) {
              qty = clampDefinedRiskQuantity(fill.quantity, riskBudgetDollars, width * 100 - (fill.quantity > 0 ? fill.totalCredit / fill.quantity : 0));
              if (qty !== fill.quantity) fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: qty, shortBid: shortCall?.bid, longAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
            }
            const netCreditPerContract = fill.creditPerContract;
            const maxLossPerContract = qty > 0 ? width * 100 - fill.totalCredit / qty : Infinity;

            if (qty > 0 && fill.totalCredit > 0 && maxLossPerContract > 0) {
              const totalCredit = fill.totalCredit;
              if (!independentBearCS) applyOverlayEffect(applyOptionExecution({ cashImpact: totalCredit, pnl: 0 }));
              pendingBearCSes.add({
                underlying: proxySymbol,
                expiry: s.expiry,
                shortStrike: s.spread_short_strike,
                longStrike: s.spread_long_strike,
                quantity: qty,
                creditReceived: totalCredit,
                width,
                openedAt: nextDay.date,
                maxLoss: maxLossPerContract * qty,
                marketContext: output.currentState,
              });
              if (riskAttempt) {
                riskAttempt.finalQuantity = qty;
                riskAttempt.maxLossPerContract = maxLossPerContract;
                riskAttempt.riskDollars = maxLossPerContract * qty;
                riskAttempt.status = qty < quantityBeforeBudgetClamp ? 'budget_clamped' : 'opened';
              }
              refreshOptionRiskBudget();
              tradeLog.push({
                signalDate: today.date,
                date:       nextDay.date,
                symbol:     callCreditSpreadTradeMeta('BEAR_CS', s.spread_short_strike, s.spread_long_strike, proxySymbol).symbol,
                side:       'SELL',
                quantity:   qty,
                fillPrice:  netCreditPerContract / 100,
                cashImpact: totalCredit,
                rationale:  `${bcs?.reason ?? 'QQQ Bear Call Spread'}：@${s.spread_short_strike}/${s.spread_long_strike}，exp ${s.expiry}`,
                action:     'OPEN',
                strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD,
                executionReason: bcs?.reason ?? 'Bear Call Spread 开仓',
                executionReasonKey: 'bear_call_spread_open',
                marketContext: output.currentState,
              });
            } else if (riskAttempt && quantityBeforeBudgetClamp > 0 && qty === 0) {
              riskAttempt.status = 'budget_rejected';
            }
          }
        }
      }
    }

    // ── Call Spread: open if ADD_CALL_SPREAD and no existing CS ────────────
    const callSpreadProposal = findOverlayProposal(overlayProposals, 'ADD_CALL_SPREAD');
    let wr89EntryBlocked = false;
    let wr90EntryBlocked = false;
    let wr89NextCooldownRemaining = wr89CooldownRemaining;
    if (config.strategyParams?.csTransitionConditionalGate === true && callSpreadProposal) {
      const proposalCredit = callSpreadProposal.callCreditSpread?.credit;
      const gateEligible = canOpenOnNextBar
        && callSpreadProposal.csRoute !== 'secondary_budget'
        && (independentCS || pendingCSes.length === 0)
        && (!activeCollarShortCall || !collarBlocksOtherOverlays);
      if (!gateEligible) {
        csConditionalGateTrace.push({
          date: today.date,
          credit: proposalCredit === undefined ? undefined : proposalCredit * 100,
          realisedVol20d: output.currentState.tqqqRealisedVol20d,
          regime: output.currentState.regime,
          slowSubregime: output.currentState.slowSubregime,
          route: callSpreadProposal.csRoute,
          evaluated: false,
          reason: proposalCredit === undefined ? 'missing_credit' : 'not_eligible',
        });
      }
    }
    if (config.strategyParams?.csTransitionConditionalGate === true
        && canOpenOnNextBar
        && callSpreadProposal?.csRoute !== 'secondary_budget'
        && callSpreadProposal?.callCreditSpread?.credit !== undefined
        && (independentCS || pendingCSes.length === 0)
        && (!activeCollarShortCall || !collarBlocksOtherOverlays)) {
      wr90EntryBlocked = isWr90ConditionalBlock({
        regime: output.currentState.regime,
        credit: callSpreadProposal.callCreditSpread.credit * 100,
        realisedVol20d: output.currentState.tqqqRealisedVol20d,
        termSlope: output.currentState.vixTermStructureSlope,
      }, {
            creditMax: config.strategyParams.csTransitionConditionalCreditMax,
            rvMin: config.strategyParams.csTransitionConditionalRvMin,
            rvMax: config.strategyParams.csTransitionConditionalRvMax,
            termSlopeMax: config.strategyParams.csTransitionConditionalTermSlopeMax,
            termSlopeReleaseRegime: config.strategyParams.csTransitionConditionalTermSlopeReleaseRegime,
      });
      csConditionalGateTrace.push({
        date: today.date,
        credit: callSpreadProposal.callCreditSpread.credit * 100,
        realisedVol20d: output.currentState.tqqqRealisedVol20d,
        regime: output.currentState.regime,
        slowSubregime: output.currentState.slowSubregime,
        route: callSpreadProposal.csRoute,
        evaluated: true,
        allowed: !wr90EntryBlocked,
        reason: wr90EntryBlocked ? 'conditional_block' : 'conditional_allow',
      });
    }
    if (config.strategyParams?.csWr89CompactController === true
        && canOpenOnNextBar
        && callSpreadProposal?.csRoute !== 'secondary_budget'
        && callSpreadProposal?.callCreditSpread?.credit !== undefined
        && (independentCS || pendingCSes.length === 0)
        && (!activeCollarShortCall || !collarBlocksOtherOverlays)) {
      const wr89EntryDecision = evaluateWr89Entry({ ...(csBreachState ?? {}), wr89CooldownRemaining } as CSBreachState, {
        regime: output.currentState.regime,
        slowSubregime: output.currentState.slowSubregime,
        credit: callSpreadProposal.callCreditSpread.credit * 100,
        vix: pricingVolToday,
        realisedVol20d: output.currentState.tqqqRealisedVol20d,
        termSlope: output.currentState.vixTermStructureSlope,
      }, true, config.strategyParams?.csWr89CooldownRescueMode);
      wr89EntryBlocked = !wr89EntryDecision.allowed;
      wr89NextCooldownRemaining = wr89EntryDecision.state?.wr89CooldownRemaining ?? wr89CooldownRemaining;
      if (wr89EntryBlocked) {
        csConditionalGateTrace.push({
          date: today.date,
          nextOpenDate: nextDay.date,
          credit: callSpreadProposal.callCreditSpread.credit * 100,
          vix: pricingVolToday,
          realisedVol20d: output.currentState.tqqqRealisedVol20d,
          termSlope: output.currentState.vixTermStructureSlope,
          regime: output.currentState.regime,
          slowSubregime: output.currentState.slowSubregime,
          route: callSpreadProposal.csRoute,
          evaluated: true,
          allowed: false,
          reason: wr89EntryDecision.reason ?? 'wr89_block',
        });
      }
      if (wr89EntryBlocked) wr89CooldownRemaining = wr89NextCooldownRemaining;
    }
    if (
      useMockOptions &&
      canOpenOnNextBar &&
      !!callSpreadProposal &&
      !wr89EntryBlocked &&
      !wr90EntryBlocked &&
      (independentCS || pendingCSes.length === 0) &&
      (!activeCollarShortCall || !collarBlocksOtherOverlays)
    ) {
      const s = callSpreadProposal.proposed_strikes;
      if (s?.spread_short_strike && s?.spread_long_strike && s?.expiry) {
        const width = s.spread_long_strike - s.spread_short_strike;
        if (width > 0) {
          const csVxnRescueSizeMultiplier = independentCS ? (callSpreadProposal.csVxnRescueSizeMultiplier ?? 1) : 1;
          let qty = independentCS ? csVxnRescueSizeMultiplier : callSpreadProposal.callCreditSpread?.quantity ?? 1;
          const requestedQuantity = qty;
          const riskAttempt = createOptionRiskBudgetAttempt(nextDay.date, today.date, independentCS, 'CS', requestedQuantity, callSpreadProposal.callCreditSpread?.maxLoss ?? width * 100);
          const riskBudgetDollars = independentCS ? Infinity : remainingOptionRiskDollars();

          const pricingDte = callSpreadProposal.csTier !== undefined
            ? config.strategyParams?.csSecondaryCoverageTargetDte ?? resolvedGateParams.csTargetDte ?? SPREAD_TARGET_DTE
            : resolvedGateParams.csTargetDte ?? SPREAD_TARGET_DTE;
          const expData = qty > 0 ? fillExpiry(nextDayMockChain?.expirations, s.expiry, pricingDte, nextDay.date) : undefined;

          if (expData) {
            const shortCall = findOptionContract(expData.calls, s.spread_short_strike);
            const longCall  = findOptionContract(expData.calls, s.spread_long_strike);
            // #5c: clamp opening size to the thinnest leg's liquidity (no-op when off).
            const legVol = Math.min(shortCall?.volume ?? Infinity, longCall?.volume ?? Infinity);
            let fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: independentCS ? csVxnRescueSizeMultiplier : liqCap(legVol), shortBid: shortCall?.bid, longAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
            const quantityBeforeBudgetClamp = fill.quantity;
            if (!independentCS) {
              qty = clampDefinedRiskQuantity(fill.quantity, riskBudgetDollars, width * 100 - (fill.quantity > 0 ? fill.totalCredit / fill.quantity : 0));
              if (qty !== fill.quantity) fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: qty, shortBid: shortCall?.bid, longAsk: longCall?.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
            }
      const netCreditPerContract = fill.creditPerContract;
      const maxLossPerContract = qty > 0 ? width * 100 - fill.totalCredit / qty : Infinity;
      let fillConditionalGateBlocked = false;
      if (config.strategyParams?.csTransitionConditionalGate === true) {
        fillConditionalGateBlocked = isWr90ConditionalBlock({
          regime: output.currentState.regime,
          credit: fill.creditPerContract,
          realisedVol20d: output.currentState.tqqqRealisedVol20d,
          termSlope: output.currentState.vixTermStructureSlope,
        }, {
            creditMax: config.strategyParams.csTransitionConditionalCreditMax,
            rvMin: config.strategyParams.csTransitionConditionalRvMin,
            rvMax: config.strategyParams.csTransitionConditionalRvMax,
            termSlopeMax: config.strategyParams.csTransitionConditionalTermSlopeMax,
            termSlopeReleaseRegime: config.strategyParams.csTransitionConditionalTermSlopeReleaseRegime,
        });
        if (fillConditionalGateBlocked) {
          csConditionalGateTrace.push({
            date: nextDay.date,
            credit: fill.creditPerContract,
            realisedVol20d: output.currentState.tqqqRealisedVol20d,
            regime: output.currentState.regime,
            slowSubregime: output.currentState.slowSubregime,
            route: callSpreadProposal.csRoute,
            evaluated: true,
            allowed: false,
            reason: 'fill_conditional_block',
          });
          if (riskAttempt) riskAttempt.status = 'strategy_rejected';
        }
      }
      if (qty > 0 && fill.totalCredit > 0 && !fillConditionalGateBlocked) {
              const totalCredit = fill.totalCredit;
              wr89CooldownRemaining = wr89NextCooldownRemaining;
              if (!independentCS) applyOverlayEffect(applyOptionExecution({ cashImpact: totalCredit, pnl: 0 }));
              const csRoute = callSpreadProposal.csRoute ?? callSpreadProposal.csPriceSelection?.route ?? 'primary';
            pendingCSes.add({
                underlying: proxySymbol,
                openDate: nextDay.date,
                expiry: s.expiry,
                shortStrike: s.spread_short_strike,
                longStrike:  s.spread_long_strike,
                quantity: qty,
                creditReceived: totalCredit,
                width,
                route: csRoute === 'secondary_budget' ? 'secondary_budget' : 'primary',
                tier: callSpreadProposal.csTier,
                exitProfile: callSpreadProposal.csExitProfile,
                marketContext: output.currentState,
              });
              if (riskAttempt) {
                riskAttempt.finalQuantity = qty;
                riskAttempt.maxLossPerContract = maxLossPerContract;
                riskAttempt.riskDollars = maxLossPerContract * qty;
                riskAttempt.status = qty < quantityBeforeBudgetClamp ? 'budget_clamped' : 'opened';
              }
              refreshOptionRiskBudget();
              const csRouteLabel = csRoute === 'secondary_budget'
                ? callSpreadProposal.csTier === 'pre_crisis_coverage'
                  ? '独立副层·预危机覆盖层'
                  : callSpreadProposal.csTier === 'normal_coverage' ? '独立副层·普通覆盖层' : '独立副层'
                : csRoute === 'conservative_fallback' ? '保守 fallback' : '主策略';
              tradeLog.push({
                signalDate: today.date,
                date:       nextDay.date,
                symbol:     callCreditSpreadTradeMeta('CS', s.spread_short_strike, s.spread_long_strike, proxySymbol).symbol,
                side:       'SELL',
                quantity:   qty,
                fillPrice:  netCreditPerContract / 100,
                cashImpact: totalCredit,
                rationale:  `Call Spread [${csRouteLabel}]：@${s.spread_short_strike}/${s.spread_long_strike}，exp ${s.expiry}，VIX 低位 + TQQQ 超买`,
                action:     'OPEN',
                strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD,
                executionReason: csRoute === 'secondary_budget'
                  ? 'Call Spread 独立副层开仓'
                  : csRoute === 'conservative_fallback' ? 'Call Spread 保守 fallback 开仓' : 'Call Spread 开仓',
                executionReasonKey: 'call_credit_spread_open',
                marketContext: output.currentState,
              });
              const eventRiskScopeInput = {
                preCrisisActive: output.currentState.csPreCrisisActive === true,
                regime: output.currentState.regime,
                slowSubregime: output.currentState.slowSubregime,
              };
              if (csRoute === 'secondary_budget') {
                recordCsSecondaryOpen(today.date, isCallCreditSpreadEventRiskScoped({
                  ...eventRiskScopeInput,
                  scope: config.strategyParams?.csSecondaryEventRiskScope,
                  requirePreCrisis: config.strategyParams?.csSecondary2AllowOutsidePreCrisis !== true,
                }), callSpreadProposal.csTier === 'normal_coverage' || callSpreadProposal.csTier === 'pre_crisis_coverage');
              } else {
                recordCsPreCrisisOpen(today.date, isCallCreditSpreadEventRiskScoped({
                  ...eventRiskScopeInput,
                  scope: config.strategyParams?.csPreCrisisEventScope,
                }));
              }
            } else if (riskAttempt && quantityBeforeBudgetClamp > 0 && qty === 0) {
              riskAttempt.status = 'budget_rejected';
            }
            if (riskAttempt && riskAttempt.status === 'not_opened') {
              riskAttempt.executionDiagnostic = !shortCall || !longCall
                ? 'missing_contract'
                : shortCall.bid == null || longCall.ask == null
                  ? 'missing_quote'
                  : quantityBeforeBudgetClamp <= 0
                    ? 'zero_liquidity_capacity'
                    : qty <= 0
                      ? 'zero_quantity_after_budget'
                      : fill.totalCredit <= 0
                        ? 'nonpositive_net_credit'
                        : 'unclassified';
              riskAttempt.executionDiagnosticDetails = {
                requestedQuantity,
                preBudgetFillQuantity: quantityBeforeBudgetClamp,
                finalQuantity: qty,
                shortBid: shortCall?.bid ?? null,
                longAsk: longCall?.ask ?? null,
                grossCreditPerContract: shortCall?.bid != null && longCall?.ask != null
                  ? (shortCall.bid - longCall.ask) * 100
                  : 0,
                afterImpactCreditPerContract: fill.creditPerContract,
                totalCreditAfterFees: fill.totalCredit,
                commissionDollars: Math.max(0, qty) * 2 * commissionPerContract,
                shortVolume: shortCall?.volume ?? null,
                longVolume: longCall?.volume ?? null,
                vix: nextVix,
              };
            }
          } else if (riskAttempt) {
            riskAttempt.executionDiagnostic = 'missing_expiry';
          }
        }
      }
    }

    const putSpreadProposal = findOverlayProposal(overlayProposals, 'ADD_PUT_CREDIT_SPREAD');
    // 历史回放继续使用次日开盘成交；仅独立 PCS 的末根 bar 可以显式选择按当日
    // 收盘模拟开仓，使当前资格产生的引擎交易与历史 T+1 样本严格分开。
    const openPcsOnTerminalBar = config.appendTerminalPcsOpen === true
      && independentPCS
      && isDecisionBar
      && !canOpenOnNextBar;
    const canOpenPcs = canOpenOnNextBar || openPcsOnTerminalBar;
    const pcsFillDate = openPcsOnTerminalBar ? today.date : nextDay?.date;
    const pcsFillSpot = openPcsOnTerminalBar ? today.close : nextDay?.open;
    const pcsFillVix = openPcsOnTerminalBar ? vixToday : nextVix;
    const pcsFillPricingVol = openPcsOnTerminalBar ? pricingVolToday : nextPricingVol;
    const pcsFillPricingVol3m = openPcsOnTerminalBar ? pricingVol3mToday : nextPricingVol3m;
    const pcsFillChain = openPcsOnTerminalBar ? todayMockChain : nextDayMockChain;
    if (useMockOptions && canOpenPcs && pcsFillDate && pcsFillSpot && putSpreadProposal && (independentPCS || pendingPCSes.length === 0) && (!activeCollarShortCall || !collarBlocksOtherOverlays)) {
      const s = putSpreadProposal.proposed_strikes;
      if (s?.spread_short_strike && s?.spread_long_strike && s.expiry) {
        const width = s.spread_short_strike - s.spread_long_strike;
        const expData = fillExpiry(pcsFillChain?.expirations, s.expiry, resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE, pcsFillDate);
        let qty = independentPCS ? 1 : putSpreadProposal.putCreditSpread?.quantity ?? 1;
        const requestedQuantity = qty;
        const riskAttempt = createOptionRiskBudgetAttempt(pcsFillDate, today.date, independentPCS, 'PCS', requestedQuantity, putSpreadProposal.putCreditSpread?.maxLoss ?? width * 100);
        const riskBudgetDollars = independentPCS ? Infinity : remainingOptionRiskDollars();
        const shortPut = findOptionContract(expData?.puts, s.spread_short_strike);
        const longPut = findOptionContract(expData?.puts, s.spread_long_strike);
        const legVol = Math.min(shortPut?.volume ?? Infinity, longPut?.volume ?? Infinity);
        let fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: independentPCS ? 1 : liqCap(legVol), shortBid: shortPut?.bid, longAsk: longPut?.ask, strikeVolume: legVol, vix: pcsFillVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
        const quantityBeforeBudgetClamp = fill.quantity;
        if (!independentPCS) {
          qty = clampDefinedRiskQuantity(fill.quantity, riskBudgetDollars, width * 100 - (fill.quantity > 0 ? fill.totalCredit / fill.quantity : 0));
          if (qty !== fill.quantity) fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: qty, shortBid: shortPut?.bid, longAsk: longPut?.ask, strikeVolume: legVol, vix: pcsFillVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
        }
        if (width > 0 && qty > 0 && fill.totalCredit > 0) {
          const totalCredit = fill.totalCredit;
          const maxLossPerContract = width * 100 - totalCredit / qty;
          if (!independentPCS) applyOverlayEffect(applyOptionExecution({ cashImpact: totalCredit, pnl: 0 }));
          const daysToExpiry = Math.max((Date.parse(`${s.expiry}T00:00:00Z`) - Date.parse(`${pcsFillDate}T00:00:00Z`)) / 86400000, 1);
          const probabilityReferences = probabilityReferenceLevels({
            spot: pcsFillSpot,
            shortStrike: s.spread_short_strike,
            longStrike: s.spread_long_strike,
            creditPerShare: totalCredit / qty / 100,
            daysToExpiry,
            annualVol: ivAt(effectiveVix(pcsFillPricingVol, pcsFillPricingVol3m, daysToExpiry), proxySymbol, pcsFillSpot, s.spread_short_strike, optionSkewSlope),
            riskFreeRate,
          });
          const openHorizonTradingDays = tradingSessionsRemaining(pcsFillDate, s.expiry);
          // 研究预测严格 as-of signalDate：使用 today.close，而不是未来的 nextDay.open，避免把实际成交价带入预测。
          const openSurvival = pcsSurvivalExitMode !== 'off' && openHorizonTradingDays > 0
            ? survivalAtAsOf(today.date, today.close, s.spread_short_strike, openHorizonTradingDays, decisionViews.qqq)
            : null;
          const pathDiagnostic: PcsPathDiagnostic = {
            signalDate: today.date,
            openDate: pcsFillDate,
            expiry: s.expiry,
            shortStrike: s.spread_short_strike,
            longStrike: s.spread_long_strike,
            quantity: qty,
            width,
            openSpot: pcsFillSpot,
            openCredit: totalCredit,
            ...(putSpreadProposal.pcsPriceSelection ? { priceSelection: putSpreadProposal.pcsPriceSelection } : {}),
            ...(openSurvival ? {
              openSigmaDist: openSurvival.sigmaDist,
              openHorizonTradingDays: openSurvival.horizonDays,
              openCloseSurvival: openSurvival.close.value,
              openNoTouchSurvival: openSurvival.noTouch.value,
            } : {}),
          };
          pcsPathDiagnostics.push(pathDiagnostic);
          pendingPCSes.add({ underlying: proxySymbol, expiry: s.expiry, shortStrike: s.spread_short_strike, longStrike: s.spread_long_strike, quantity: qty, creditReceived: totalCredit, width, openedAt: pcsFillDate, probabilityReferences, pathDiagnostic, marketContext: output.currentState });
          if (riskAttempt) {
            riskAttempt.finalQuantity = qty;
            riskAttempt.maxLossPerContract = maxLossPerContract;
            riskAttempt.riskDollars = maxLossPerContract * qty;
            riskAttempt.status = qty < quantityBeforeBudgetClamp ? 'budget_clamped' : 'opened';
          }
          refreshOptionRiskBudget();
          tradeLog.push({ signalDate: today.date, date: pcsFillDate, expiry: s.expiry, symbol: putCreditSpreadTradeMeta('PCS', s.spread_long_strike, s.spread_short_strike, proxySymbol).symbol, side: 'SELL', quantity: qty, fillPrice: totalCredit / qty / 100, cashImpact: totalCredit, rationale: `Put Credit Spread：@${s.spread_long_strike}/${s.spread_short_strike}，exp ${s.expiry}`, action: 'OPEN', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, executionReason: openPcsOnTerminalBar ? 'Put Credit Spread 当日模拟开仓' : 'Put Credit Spread 开仓', executionReasonKey: openPcsOnTerminalBar ? 'terminal_same_day_simulated_open' : 'put_credit_spread_open', marketContext: output.currentState });
        } else if (riskAttempt && quantityBeforeBudgetClamp > 0 && qty === 0) {
          riskAttempt.status = 'budget_rejected';
        }
      }
    }

    // ── PCS_RESCUE: independent one-contract PCS fallback ────────────────
    // It shares the safety gate but has its own action, tag and ledger. The
    // rescue layer intentionally holds to expiry in the first research pass;
    // main PCS exit switches must not silently change its measured economics.
    const pcsRescueOverlayProposal = findOverlayProposal(overlayProposals, 'ADD_PCS_RESCUE');
    const pcsRescueExecution = {
      proposalBuilt: !!pcsRescueOverlayProposal,
      attempted: false,
      opened: false,
      reason: pcsRescueOverlayProposal ? 'not_evaluated' : 'no_proposal',
      shortPutFound: undefined as boolean | undefined,
      longPutFound: undefined as boolean | undefined,
      fillQuantity: undefined as number | undefined,
      totalCredit: undefined as number | undefined,
      pairSearchUsed: pcsRescueOverlayProposal?.pcsRescuePutSpread?.pairSearchUsed === true,
      fallbackQuoteSource: undefined as string | undefined,
      fallbackMaxLoss: undefined as number | undefined,
      fallbackRiskPct: undefined as number | undefined,
      fallbackPairSearchUsed: undefined as boolean | undefined,
      fallbackAttempted: false,
      fallbackBuilt: false,
      fallbackCredit: undefined as number | undefined,
      fallbackWarning: undefined as string | undefined,
      fallbackRiskWithinCap: undefined as boolean | undefined,
      fallbackRecoveryAttempted: false,
      fallbackRecoveryBuilt: false,
      fallbackRecoveryWarning: undefined as string | undefined,
    };
    if (useMockOptions && canOpenPcs && pcsFillDate && pcsFillSpot && pcsRescueOverlayProposal && (!activeCollarShortCall || !collarBlocksOtherOverlays)) {
      pcsRescueExecution.attempted = true;
      const s = pcsRescueOverlayProposal.proposed_strikes;
      if (s?.spread_short_strike && s?.spread_long_strike && s.expiry) {
        const width = s.spread_short_strike - s.spread_long_strike;
        const expData = fillExpiry(pcsFillChain?.expirations, s.expiry, config.strategyParams?.pcsRescueTargetDte ?? resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE, pcsFillDate);
        const shortPut = findOptionContract(expData?.puts, s.spread_short_strike);
        const longPut = findOptionContract(expData?.puts, s.spread_long_strike);
        pcsRescueExecution.shortPutFound = !!shortPut;
        pcsRescueExecution.longPutFound = !!longPut;
        const legVol = Math.min(shortPut?.volume ?? Infinity, longPut?.volume ?? Infinity);
        const fill = openCreditSpreadFill({ requestedQuantity: 1, maxQuantity: 1, shortBid: shortPut?.bid, longAsk: longPut?.ask, strikeVolume: legVol, vix: pcsFillVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
        pcsRescueExecution.fillQuantity = fill.quantity;
        pcsRescueExecution.totalCredit = fill.totalCredit;
        if (width > 0 && fill.quantity === 1 && fill.totalCredit > 0) {
          const totalCredit = fill.totalCredit;
          pendingPCSRescues.add({ underlying: proxySymbol, expiry: s.expiry, shortStrike: s.spread_short_strike, longStrike: s.spread_long_strike, quantity: 1, creditReceived: totalCredit, width, openedAt: pcsFillDate, marketContext: output.currentState });
          tradeLog.push({ signalDate: today.date, date: pcsFillDate, expiry: s.expiry, symbol: putCreditSpreadTradeMeta('PCS_RESCUE', s.spread_long_strike, s.spread_short_strike, proxySymbol).symbol, side: 'SELL', quantity: 1, fillPrice: totalCredit / 100, cashImpact: totalCredit, rationale: `PCS_RESCUE：@${s.spread_long_strike}/${s.spread_short_strike}，exp ${s.expiry}，Delta≈${((pcsRescueOverlayProposal.pcsRescueShortDelta ?? 0) * 100).toFixed(1)}%`, action: 'OPEN', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE, executionReason: openPcsOnTerminalBar ? 'PCS_RESCUE 当日模拟开仓' : 'PCS_RESCUE 开仓', executionReasonKey: openPcsOnTerminalBar ? 'pcs_rescue_terminal_same_day_simulated_open' : 'pcs_rescue_open', marketContext: output.currentState });
          pcsRescueExecution.opened = true;
          pcsRescueExecution.reason = pcsRescueExecution.pairSearchUsed ? 'opened_pair_search' : 'opened';
        } else if (width <= 0) {
          pcsRescueExecution.reason = 'invalid_width';
        } else if (!shortPut || !longPut) {
          pcsRescueExecution.reason = 'missing_fill_leg';
        } else if (fill.quantity !== 1) {
          pcsRescueExecution.reason = 'fill_quantity';
        } else {
          pcsRescueExecution.reason = 'nonpositive_credit';
        }
      } else {
        pcsRescueExecution.reason = 'missing_proposal_strikes';
      }
    } else if (pcsRescueOverlayProposal && !canOpenPcs) {
      pcsRescueExecution.reason = 'not_openable_next_bar';
    } else if (pcsRescueOverlayProposal && (!pcsFillDate || !pcsFillSpot)) {
      pcsRescueExecution.reason = 'missing_fill_context';
    } else if (pcsRescueOverlayProposal && activeCollarShortCall && collarBlocksOtherOverlays) {
      pcsRescueExecution.reason = 'collar_short_call_block';
    }
    if (
      !pcsRescueExecution.opened
      && pcsRescueExecution.attempted
      && (
        config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_v1'
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS' || output.currentState.regime === 'RISK_ON_WEAKENING'))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS' || output.currentState.regime === 'RISK_ON_WEAKENING'
            || (output.currentState.regime === 'BULL' && (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS' || output.currentState.regime === 'RISK_ON_WEAKENING'
            || (output.currentState.regime === 'BULL' && ((output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16
              || ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 16 && (output.currentState.adx14 ?? Number.POSITIVE_INFINITY) < 15)))))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS' || output.currentState.regime === 'RISK_ON_WEAKENING'
            || (output.currentState.regime === 'BULL' && ((output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16
              || ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 16 && ((output.currentState.adx14 ?? Number.POSITIVE_INFINITY) < 15
                || (output.currentState.slowSubregime === 'SR01' && (output.currentState.vixChange5d ?? Number.POSITIVE_INFINITY) < 0)))))))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS' || output.currentState.regime === 'RISK_ON_WEAKENING'
            || (output.currentState.regime === 'BULL' && ((output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16
              || ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 16 && ((output.currentState.adx14 ?? Number.POSITIVE_INFINITY) < 15
                || (output.currentState.slowSubregime === 'SR01' && (output.currentState.vixChange5d ?? Number.POSITIVE_INFINITY) < 0)
                || (output.currentState.slowSubregime === 'SR02' && (output.currentState.vixChange5d ?? Number.POSITIVE_INFINITY) <= -.02)))))))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_v1'
          && (pcsRescueE22FillFallbackAllowed
            || (output.currentState.regime === 'RISK_ON_EXTENDED' && (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 16)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_bull_sr02_vixlt12_v1'
          && (pcsRescueE22FillFallbackAllowed
            || (output.currentState.regime === 'BULL'
              && output.currentState.slowSubregime === 'SR02'
              && (output.currentState.vix ?? Number.POSITIVE_INFINITY) < 12)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_or_bull_sr02_vixlt12_v1'
          && pcsRescueE23FillFallbackAllowed)
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_v1'
          && (pcsRescueE23FillFallbackAllowed || output.currentState.regime === 'RISK_ON_EXTENDED'))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_bull_sr02_vixrise_v1'
          && (pcsRescueE23FillFallbackAllowed
            || (output.currentState.regime === 'BULL' && output.currentState.slowSubregime === 'SR02' && (output.currentState.vixChange5d ?? Number.NEGATIVE_INFINITY) >= 0)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_or_bull_sr02_vixrise_v1'
          && (pcsRescueE23FillFallbackAllowed
            || output.currentState.regime === 'RISK_ON_EXTENDED'
            || (output.currentState.regime === 'BULL' && output.currentState.slowSubregime === 'SR02' && (output.currentState.vixChange5d ?? Number.NEGATIVE_INFINITY) >= 0)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_simplified_v1'
          && (pcsRescueE22FillFallbackAllowed
            || output.currentState.regime === 'RISK_ON_EXTENDED'
            || (output.currentState.regime === 'BULL'
              && output.currentState.slowSubregime === 'SR02'
              && ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 12
                || (output.currentState.vixChange5d ?? Number.NEGATIVE_INFINITY) >= 0))))
        || (String(config.strategyParams?.pcsRescueFillFallbackMode) === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_or_bull_sr02_vixge13_5_v1'
          && (pcsRescueE23FillFallbackAllowed
            || output.currentState.regime === 'RISK_ON_EXTENDED'
            || (output.currentState.regime === 'BULL'
              && output.currentState.slowSubregime === 'SR02'
              && ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 12
                || (output.currentState.vixChange5d ?? Number.NEGATIVE_INFINITY) >= 0
                || (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 13.5))))
        || (String(config.strategyParams?.pcsRescueFillFallbackMode) === 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_any_or_bull_sr02_vixge13_5_or_bull_sr01_vix15_16_atrge0_weaklt2_v1'
          && (pcsRescueE23FillFallbackAllowed
            || output.currentState.regime === 'RISK_ON_EXTENDED'
            || (output.currentState.regime === 'BULL'
              && output.currentState.slowSubregime === 'SR02'
              && ((output.currentState.vix ?? Number.POSITIVE_INFINITY) < 12
                || (output.currentState.vixChange5d ?? Number.NEGATIVE_INFINITY) >= 0
                || (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 13.5))
            || (output.currentState.regime === 'BULL'
              && output.currentState.slowSubregime === 'SR01'
              && (output.currentState.vix ?? Number.NEGATIVE_INFINITY) >= 15
              && (output.currentState.vix ?? Number.POSITIVE_INFINITY) < 16
              && (output.currentState.priceExtensionAtr ?? Number.NEGATIVE_INFINITY) >= 0
              && (output.currentState.weakeningSignalCount ?? Number.POSITIVE_INFINITY) < 2)))
        || (config.strategyParams?.pcsRescueFillFallbackMode === 'next_chain_delta_calm_v1'
          && (output.currentState.regime === 'RANGE_BOUND' || output.currentState.regime === 'SIDEWAYS'))
        || (Number.isFinite(config.strategyParams?.pcsRescueFillFallbackAnyStateAdxMin)
          && Number.isFinite(output.currentState.adx14)
          && output.currentState.adx14! >= config.strategyParams!.pcsRescueFillFallbackAnyStateAdxMin!)
        || (Number.isFinite(config.strategyParams?.pcsRescueFillFallbackAnyStateRoc5Max)
          && Number.isFinite(output.currentState.roc5)
          && output.currentState.roc5! <= config.strategyParams!.pcsRescueFillFallbackAnyStateRoc5Max!)
        || (Number.isFinite(config.strategyParams?.pcsRescueFillFallbackBullSr02VixMin)
          && output.currentState.regime === 'BULL'
          && output.currentState.slowSubregime === 'SR02'
          && Number.isFinite(output.currentState.vix)
          && output.currentState.vix! >= config.strategyParams!.pcsRescueFillFallbackBullSr02VixMin!)
        || (Number.isFinite(config.strategyParams?.pcsRescueFillFallbackAnyStateTrendScoreMin)
          && Number.isFinite(output.currentState.trendScore)
          && output.currentState.trendScore! >= config.strategyParams!.pcsRescueFillFallbackAnyStateTrendScoreMin!)
        || passesBullSr01VixFallbackRelease(config.strategyParams?.pcsRescueFillFallbackBullSr01VixMax, output.currentState)
      )
      && pcsRescueOverlayProposal
      && pcsFillChain
      && pcsFillDate
      && pcsFillSpot
    ) {
      const s = pcsRescueOverlayProposal.proposed_strikes;
      const baseWidth = s?.spread_short_strike && s?.spread_long_strike ? s.spread_short_strike - s.spread_long_strike : undefined;
      if (s?.expiry && baseWidth && baseWidth > 0) {
        const expirySearchMode = config.strategyParams?.pcsRescueFillFallbackExpirySearchMode;
        const buildExpandedFallbackChain = () => {
            const base = Date.parse(`${pcsFillDate!.slice(0, 10)}T00:00:00Z`);
            const expirations = realExpiryCalendar
              ? listedExpiries(pcsFillDate!, 75, proxySymbol).map(date => ({ date, pricingDte: Math.round((Date.parse(`${date}T00:00:00Z`) - base) / 86400000) })).filter(item => item.pricingDte > 0)
              : [28, 37, 45].map(pricingDte => ({ date: new Date(base + pricingDte * 86400000).toISOString().slice(0, 10), pricingDte }));
            const splitFactor = splitFactorFor(proxySymbol, pcsFillDate!);
            const strikes = strikesFor(proxySymbol, pcsFillSpot! * splitFactor, realStrikeGrid).map(strike => strike / splitFactor);
            const contracts = expirations.map(item => ({ expiry: item.date, pricingDte: item.pricingDte, strikes, types: ['put'] as Array<'call' | 'put'> }));
            return cachedMockChain(pcsFillDate!, pcsFillSpot!, pcsFillPricingVol, proxySymbol, pcsFillPricingVol3m, contracts);
        };
        const fallbackInput = {
          chain: pcsFillChain,
          date: pcsFillDate,
          targetDte: config.strategyParams?.pcsRescueFillFallbackDteMode === 'expiry28_v1'
            ? 28
            : config.strategyParams?.pcsRescueFillFallbackDteMode === 'expiry42_v1'
              ? 42
              : config.strategyParams?.pcsRescueTargetDte ?? resolvedGateParams.pcsTargetDte ?? SPREAD_TARGET_DTE,
          widthPct: config.strategyParams?.pcsRescueFillFallbackWidthPct ?? baseWidth / pcsFillSpot,
          nav: stockNav,
          riskBudget: config.strategyParams?.pcsRescueRiskBudgetNav ?? .005,
          forceMinimumContract: config.strategyParams?.pcsRescueFillFallbackForceMinimumContract === true,
          shortDelta: (pcsRescueOverlayProposal.pcsRescueShortDelta ?? .075) + (config.strategyParams?.pcsRescueFillFallbackShortDeltaUplift ?? 0),
          underlying: proxySymbol,
          pairSearchMinCreditWidthRatio: config.strategyParams?.pcsRescueFillFallbackMinCreditWidthRatio,
          pairSearchMode: resolvePcsFillFallbackPairSearchMode({
            configuredMode: config.strategyParams?.pcsRescueFillFallbackPairSearchMode,
            quoteOnlyWidth: config.strategyParams?.pcsRescueFillFallbackQuoteOnlyWidth,
            regime: output.currentState.regime,
            slowSubregime: output.currentState.slowSubregime,
            rv20: output.currentState.tqqqRealisedVol20d,
            quoteOnlyBullSr01Rv20Min: config.strategyParams?.pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Min,
            quoteOnlyBullSr01Rv20Max: config.strategyParams?.pcsRescueFillFallbackQuoteOnlyBullSr01Rv20Max,
          }),
        };
        const buildExpandedFallback = (order: 'target_nearest' | 'shortest_dte' = 'target_nearest') => buildPutCreditSpreadOpenNearestFeasibleExpiry({
          ...fallbackInput,
          chain: buildExpandedFallbackChain(),
          widthPct: config.strategyParams?.pcsRescueFillFallbackExpandedChainWidthPct ?? fallbackInput.widthPct,
          shortDelta: config.strategyParams?.pcsRescueFillFallbackExpandedChainShortDelta ?? fallbackInput.shortDelta,
        }, order);
        const expandedChainGate = config.strategyParams?.pcsRescueFillFallbackExpandedChainGate;
        const expandedChainAllowed = expandedChainGate === undefined
          || (expandedChainGate !== 'roc5_nonnegative_v1' || (output.currentState.roc5 ?? Number.NEGATIVE_INFINITY) >= 0)
            && (expandedChainGate !== 'er20_at_least_015_v1' || (output.currentState.qqqEr20 ?? Number.NEGATIVE_INFINITY) >= .15)
            && (expandedChainGate !== 'roc5_nonnegative_and_er20_at_least_015_v1'
              || ((output.currentState.roc5 ?? Number.NEGATIVE_INFINITY) >= 0 && (output.currentState.qqqEr20 ?? Number.NEGATIVE_INFINITY) >= .15))
            && (!Number.isFinite(config.strategyParams?.pcsRescueFillFallbackExpandedChainVixMax)
              || (Number.isFinite(output.currentState.vix) && output.currentState.vix! <= config.strategyParams!.pcsRescueFillFallbackExpandedChainVixMax!));
        const expandedChainRoc5Min = config.strategyParams?.pcsRescueFillFallbackExpandedChainRoc5Min;
        const expandedChainPassesRoc5 = !Number.isFinite(expandedChainRoc5Min)
          || (Number.isFinite(output.currentState.roc5) && output.currentState.roc5! >= expandedChainRoc5Min!);
        const expandedChainReleaseMode = config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseMode;
        const expandedChainReleaseRoc5Min = config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseRoc5Min ?? .03;
        const expandedChainReleaseEr20Min = config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseEr20Min ?? .15;
        const expandedChainRoc5 = output.currentState.roc5;
        const expandedChainEr20 = output.currentState.qqqEr20;
        const expandedChainVix = output.currentState.vix;
        const expandedChainRoc20 = output.currentState.roc20;
        const expandedChainBaseReleaseModes = new Set<string>([
          'roc5_ge03_or_roc5nonneg_er20ge015_vixle175_v1',
          'roc5_ge03_or_er20ge015_vixle175_v1',
          'roc5_ge03_or_roc5nonneg_vixle175_v1',
          'roc5_ge03_or_roc5nonneg_er20ge015_v1',
        ]);
        const expandedChainBaseRelease = expandedChainBaseReleaseModes.has(expandedChainReleaseMode ?? '')
          && Number.isFinite(expandedChainRoc5)
          && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
            || ((expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_er20ge015_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_er20ge015_v1')
              ? expandedChainRoc5! >= 0 : true)
            && ((expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_er20ge015_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_er20ge015_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_er20ge015_v1')
              ? Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min : true)
            && ((expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_er20ge015_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_er20ge015_vixle175_v1'
              || expandedChainReleaseMode === 'roc5_ge03_or_roc5nonneg_vixle175_v1')
              ? Number.isFinite(expandedChainVix) && expandedChainVix! <= 17.5 : true));
        const expandedChainPassesRelease = [
          expandedChainBaseRelease,
          expandedChainReleaseMode === 'roc5_nonnegative_only_v1'
            && Number.isFinite(expandedChainRoc5)
            && expandedChainRoc5! >= 0,
          expandedChainReleaseMode === 'roc5ge03_or_roc5nonneg_erband_vixguard_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0
                && Number.isFinite(expandedChainEr20)
                && expandedChainEr20! >= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakEr20Min ?? .1)
                && (expandedChainEr20! >= expandedChainReleaseEr20Min
                  || (Number.isFinite(expandedChainVix)
                    && expandedChainVix! <= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakVixMax ?? 17.5))))),
          expandedChainReleaseMode === 'roc5ge03_or_roc5nonneg_er15_or_vixlow_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0
                && ((Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
                  || (Number.isFinite(expandedChainVix)
                    && expandedChainVix! <= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakVixMax ?? 17.5))))),
          expandedChainReleaseMode === 'e182_or_weakroc_vixlow_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0
                && ((Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
                  || (Number.isFinite(expandedChainVix) && expandedChainVix! <= 16)))
              || (expandedChainRoc5! >= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakRoc5Min ?? 0)
                && Number.isFinite(expandedChainVix)
                && expandedChainVix! <= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakVixMax ?? 16))),
          expandedChainReleaseMode === 'e182_or_weakroc_roc20positive_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0
                && ((Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
                  || (Number.isFinite(expandedChainVix) && expandedChainVix! <= 16)))
              || (expandedChainRoc5! >= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakRoc5Min ?? 0)
                && Number.isFinite(expandedChainRoc20)
                && expandedChainRoc20! >= 0)),
          expandedChainReleaseMode === 'e182_or_roc5nonneg_roc20positive_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0
                && ((Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
                  || (Number.isFinite(expandedChainVix) && expandedChainVix! <= 16)
                  || (Number.isFinite(expandedChainRoc20) && expandedChainRoc20! >= 0)))),
          expandedChainReleaseMode === 'vixle175_and_roc5_or_roc5nonneg_er20_v1'
            && Number.isFinite(expandedChainRoc5) && Number.isFinite(expandedChainVix)
            && expandedChainVix! <= 17.5
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)),
          expandedChainReleaseMode === 'roc5ge03_or_roc5ge0275_er15_or_roc5nonneg_er15_vix175_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= .0275 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
              || (expandedChainRoc5! >= 0 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min
                && Number.isFinite(expandedChainVix) && expandedChainVix! <= 17.5)),
          expandedChainReleaseMode === 'roc5ge03_or_roc5nonneg_er15_or_weakroc_er_vix_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
              || (expandedChainRoc5! >= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakRoc5Min ?? 0)
                && Number.isFinite(expandedChainEr20)
                && expandedChainEr20! >= (config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakEr20Min ?? .25)
                && (!Number.isFinite(config.strategyParams?.pcsRescueFillFallbackExpandedChainReleaseWeakVixMax)
                  || (Number.isFinite(expandedChainVix) && expandedChainVix! <= config.strategyParams!.pcsRescueFillFallbackExpandedChainReleaseWeakVixMax!)))),
          expandedChainReleaseMode === 'roc5ge03_or_roc5nonneg_er15_or_trendscore70_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
              || (expandedChainRoc5! >= 0 && Number.isFinite(output.currentState.trendScore) && output.currentState.trendScore! >= 70)),
          expandedChainReleaseMode === 'roc5ge03_or_roc5nonneg_er15_or_adx24_v1'
            && Number.isFinite(expandedChainRoc5)
            && (expandedChainRoc5! >= expandedChainReleaseRoc5Min
              || (expandedChainRoc5! >= 0 && Number.isFinite(expandedChainEr20) && expandedChainEr20! >= expandedChainReleaseEr20Min)
              || (expandedChainRoc5! >= 0 && Number.isFinite(output.currentState.adx14) && output.currentState.adx14! >= 24)),
        ].some(Boolean);
        const expandedChainPassesGate = expandedChainReleaseMode === undefined
          ? expandedChainAllowed && expandedChainPassesRoc5
          : expandedChainPassesRelease;
        let fallbackBuilt = expirySearchMode === 'nearest_feasible_full_chain_parent_preserving_v1'
          ? (() => {
            const baseline = buildPutCreditSpreadOpen(fallbackInput);
            return baseline.open || !expandedChainPassesGate ? baseline : buildExpandedFallback();
          })()
          : expirySearchMode === 'shortest_feasible_full_chain_parent_preserving_v1'
            ? (() => {
              const baseline = buildPutCreditSpreadOpen(fallbackInput);
              return baseline.open || !expandedChainPassesGate ? baseline : buildExpandedFallback('shortest_dte');
            })()
          : expirySearchMode === 'nearest_feasible_full_chain_v1'
            ? buildPutCreditSpreadOpenNearestFeasibleExpiry({ ...fallbackInput, chain: buildExpandedFallbackChain() })
            : expirySearchMode === 'nearest_feasible_v1'
              ? buildPutCreditSpreadOpenNearestFeasibleExpiry(fallbackInput)
              : buildPutCreditSpreadOpen(fallbackInput);
        const fallbackRecoveryPairSearchMode = config.strategyParams?.pcsRescueFillFallbackRecoveryPairSearchMode;
        if (!fallbackBuilt.open && fallbackRecoveryPairSearchMode === 'nearest_valid_all_pairs_v1'
          && fallbackInput.pairSearchMode !== fallbackRecoveryPairSearchMode) {
          pcsRescueExecution.fallbackRecoveryAttempted = true;
          const recovered = buildPutCreditSpreadOpen({ ...fallbackInput, pairSearchMode: fallbackRecoveryPairSearchMode });
          pcsRescueExecution.fallbackRecoveryBuilt = !!recovered.open;
          pcsRescueExecution.fallbackRecoveryWarning = recovered.warning;
          if (recovered.open) fallbackBuilt = recovered;
        }
        const fallbackCredit = fallbackBuilt.open?.credit;
        const fallbackOpen = fallbackBuilt.open;
        const fallbackRiskCap = config.strategyParams?.pcsRescueFillFallbackMaxRiskPct;
        const fallbackRiskWithinCap = fallbackRiskCap == null
          || (fallbackOpen?.riskBudgetUsed != null && fallbackOpen.riskBudgetUsed <= fallbackRiskCap + 1e-12);
        pcsRescueExecution.fallbackAttempted = true;
        pcsRescueExecution.fallbackBuilt = !!fallbackOpen;
        pcsRescueExecution.fallbackCredit = fallbackCredit;
        pcsRescueExecution.fallbackWarning = fallbackBuilt.warning;
        pcsRescueExecution.fallbackRiskWithinCap = fallbackRiskWithinCap;
        if (fallbackOpen && fallbackOpen.quantity >= 1 && fallbackCredit != null && fallbackCredit > 0 && fallbackRiskWithinCap) {
          const totalCredit = fallbackCredit * 100;
          const fallbackWidth = fallbackOpen.shortStrike - fallbackOpen.longStrike;
          pendingPCSRescues.add({ underlying: proxySymbol, expiry: fallbackOpen.expiry, shortStrike: fallbackOpen.shortStrike, longStrike: fallbackOpen.longStrike, quantity: 1, creditReceived: totalCredit, width: fallbackWidth, openedAt: pcsFillDate, marketContext: output.currentState });
          tradeLog.push({ signalDate: today.date, date: pcsFillDate, expiry: fallbackOpen.expiry, symbol: putCreditSpreadTradeMeta('PCS_RESCUE', fallbackOpen.longStrike, fallbackOpen.shortStrike, proxySymbol).symbol, side: 'SELL', quantity: 1, fillPrice: totalCredit / 100, cashImpact: totalCredit, rationale: `PCS_RESCUE fill fallback：@${fallbackOpen.longStrike}/${fallbackOpen.shortStrike}，exp ${fallbackOpen.expiry}，Delta≈${((pcsRescueOverlayProposal.pcsRescueShortDelta ?? 0) * 100).toFixed(1)}%`, action: 'OPEN', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE, executionReason: 'PCS_RESCUE fill fallback 开仓', executionReasonKey: 'pcs_rescue_fill_fallback_open', marketContext: output.currentState });
          pcsRescueExecution.opened = true;
          pcsRescueExecution.reason = 'opened_fill_fallback';
          pcsRescueExecution.shortPutFound = true;
          pcsRescueExecution.longPutFound = true;
          pcsRescueExecution.fillQuantity = 1;
          pcsRescueExecution.totalCredit = totalCredit;
          pcsRescueExecution.fallbackQuoteSource = fallbackOpen.quoteSource;
          pcsRescueExecution.fallbackMaxLoss = fallbackOpen.maxLoss;
          pcsRescueExecution.fallbackRiskPct = fallbackOpen.riskBudgetUsed;
          pcsRescueExecution.fallbackPairSearchUsed = fallbackOpen.pairSearchUsed === true;
        }
      }
    }
    if (trace && trace.length > 0 && pcsRescueOverlayProposal) {
      trace[trace.length - 1] = { ...trace[trace.length - 1], pcsRescueExecution };
    }

    // ── Equity Boost Put Spread: open if triggered, no existing position (single concurrent) ──
    const equityBoostProposal = findOverlayProposal(overlayProposals, 'ADD_EQUITY_BOOST_PUT_SPREAD');
    if (useMockOptions && canOpenOnNextBar && equityBoostProposal && (independentEquityBoost || pendingEquityBoosts.length === 0) && (!activeCollarShortCall || !collarBlocksOtherOverlays)) {
      const s = equityBoostProposal.proposed_strikes;
      if (s?.eb_short_strike && s?.eb_long_strike && s.expiry) {
        const width = s.eb_short_strike - s.eb_long_strike;
        const expData = fillExpiry(nextDayMockChain?.expirations, s.expiry, equityBoostProposal.equityBoostPutSpread?.dte ?? config.strategyParams?.equityBoostTargetDte ?? SPREAD_TARGET_DTE, nextDay.date);
        const shortPut = findOptionContract(expData?.puts, s.eb_short_strike);
        const longPut = findOptionContract(expData?.puts, s.eb_long_strike);
        // Recompute credit/maxLoss/ratio at actual next-day-open fill prices, and shrink
        // quantity until the 0.8-1.2 ratio holds; skip entirely (never Math.max(1,...)) if it
        // never fits even at 1 contract.
        let qty = independentEquityBoost ? 1 : equityBoostProposal.equityBoostPutSpread?.quantity ?? 1;
        const requestedQuantity = qty;
        const riskAttempt = createOptionRiskBudgetAttempt(nextDay.date, today.date, independentEquityBoost, 'EQUITY_BOOST', requestedQuantity, equityBoostProposal.equityBoostPutSpread?.maxLoss ?? width * 100);
        const riskBudgetDollars = independentEquityBoost ? Infinity : remainingOptionRiskDollars();
        const ratioMin = config.strategyParams?.equityBoostRatioMin ?? EQUITY_BOOST_RATIO_MIN;
        const ratioMax = config.strategyParams?.equityBoostRatioMax ?? EQUITY_BOOST_RATIO_MAX;
        let budgetLimited = false;
        while (qty > 0 && shortPut && longPut) {
          const legVol = Math.min(shortPut.volume ?? Infinity, longPut.volume ?? Infinity);
          const fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: independentEquityBoost ? 1 : liqCap(legVol), shortBid: shortPut.bid, longAsk: longPut.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
          const cappedQty = fill.quantity;
          if (cappedQty <= 0) { qty = 0; break; }
          const economics = equityBoostFillEconomics(width, fill.totalCredit, cappedQty);
          if (!economics) { qty = 0; break; }
          if (!independentEquityBoost) {
            const riskQty = clampDefinedRiskQuantity(cappedQty, riskBudgetDollars, economics.maxLossPerContract);
            if (riskQty < cappedQty) { budgetLimited = true; qty = riskQty; continue; }
          }
          if (economics.creditToMaxLoss >= ratioMin && economics.creditToMaxLoss <= ratioMax) { qty = cappedQty; break; }
          qty -= 1;
        }
        if (qty > 0 && shortPut && longPut) {
          const legVol = Math.min(shortPut.volume ?? Infinity, longPut.volume ?? Infinity);
          const fill = openCreditSpreadFill({ requestedQuantity: qty, maxQuantity: independentEquityBoost ? 1 : liqCap(legVol), shortBid: shortPut.bid, longAsk: longPut.ask, strikeVolume: legVol, vix: nextVix, impactEnabled: slippageModel === 'impact', commissionPerContract });
          const economics = equityBoostFillEconomics(width, fill.totalCredit, fill.quantity);
          if (width > 0 && fill.quantity === qty && economics && economics.creditToMaxLoss >= ratioMin && economics.creditToMaxLoss <= ratioMax) {
            const totalCredit = fill.totalCredit;
            if (!independentEquityBoost) applyOverlayEffect(applyOptionExecution({ cashImpact: totalCredit, pnl: 0 }));
            pendingEquityBoosts.add({ underlying: proxySymbol, expiry: s.expiry, shortStrike: s.eb_short_strike, longStrike: s.eb_long_strike, quantity: qty, creditReceived: totalCredit, width, marketContext: output.currentState, riskMultiplier: equityBoostProposal.equityBoostPutSpread?.riskMultiplier });
            if (riskAttempt) {
              riskAttempt.finalQuantity = qty;
              riskAttempt.maxLossPerContract = economics.maxLossPerContract;
              riskAttempt.riskDollars = economics.maxLossPerContract * qty;
              riskAttempt.status = budgetLimited ? 'budget_clamped' : 'opened';
            }
            refreshOptionRiskBudget();
            tradeLog.push({ signalDate: today.date, date: nextDay.date, expiry: s.expiry, symbol: putCreditSpreadTradeMeta('EQUITY_BOOST', s.eb_long_strike, s.eb_short_strike, proxySymbol).symbol, side: 'SELL', quantity: qty, riskMultiplier: equityBoostProposal.equityBoostPutSpread?.riskMultiplier, fillPrice: economics.netCreditPerContract / 100, cashImpact: totalCredit, rationale: `Equity Boost Put Spread：@${s.eb_long_strike}/${s.eb_short_strike}，exp ${s.expiry}`, action: 'OPEN', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, executionReason: 'Equity Boost Put Spread 开仓', executionReasonKey: 'equity_boost_put_spread_open', marketContext: output.currentState });
          }
        } else if (riskAttempt && budgetLimited) {
          riskAttempt.status = 'budget_rejected';
        }
      }
    }

    // ── Collar: open if ADD_COLLAR and no existing collar ────────────────────
    const collarProposal = findOverlayProposal(overlayProposals, 'ADD_COLLAR');
    const collarScenario = output.overlay.collarEligibility?.scenario;
    // overheat collar: blocked if already used this streak, OR if entered RISK_ON_EXTENDED from a
    // bear/crisis recovery (V-shaped rally has escape velocity — short call gets run over immediately)
    const blockedByOverheat = shouldBlockOverheatCollar({
      scenario: collarScenario,
      usedThisStreak: decisionMemory.overheatCollarUsedThisStreak,
      streakEntryRegime: decisionMemory.overheatStreakEntryRegime,
      daysSinceLastBearExit: decisionMemory.daysSinceLastBearExit,
      minPostBearDays: MIN_POST_BEAR_DAYS,
    });
    if (
      useMockOptions &&
      canOpenOnNextBar &&
      !!collarProposal &&
      pendingCollars.length === 0 &&
      portfolio.leveragedShares >= 100 * splitFactorFor(leveragedSymbol, nextDay?.date ?? today.date) &&
      !blockedByOverheat
    ) {
      const s = collarProposal.proposed_strikes;
      if (s?.expiry && (s.put_strike || s.call_strike)) {
        const putSymbol = s.put_symbol ?? leveragedSymbol;
        const putChainForFill = putSymbol === 'QQQ' ? nextDayMockChain : nextDayLevMockChain;
        const callChainForFill = nextDayLevMockChain;
        const putQtyRequested = s.put_quantity ?? Math.max(1, Math.floor(portfolio.leveragedShares / 100));
        let callQtyRequested = s.call_quantity ?? Math.max(1, Math.floor(portfolio.leveragedShares / 100));
        let qty = s.put_strike ? Math.max(1, putQtyRequested) : 0;
        const expData = s.put_strike ? fillExpiry(putChainForFill?.expirations, s.expiry, COLLAR_TARGET_DTE, nextDay.date) : undefined;
        const callExpData = s.call_strike ? fillExpiry(callChainForFill?.expirations, s.expiry, COLLAR_TARGET_DTE, nextDay.date) : undefined;
        if ((!s.put_strike || expData) && (!s.call_strike || callExpData)) {
            const put      = s.put_strike ? findOptionContract(expData!.puts, s.put_strike) : undefined;
            const shortPut = s.put_spread_short_strike ? findOptionContract(expData!.puts, s.put_spread_short_strike) : undefined;
            const call     = s.call_strike ? findOptionContract(callExpData!.calls, s.call_strike) : undefined;
            // #5c: clamp collar size to the thinnest leg's liquidity (no-op when off).
            // Under-hedging is the realistic outcome when the option is too thin to fill.
            const legVol = Math.min(put?.volume ?? Infinity, shortPut?.volume ?? Infinity, call?.volume ?? Infinity);
            qty = s.put_strike ? Math.min(qty, liqCap(legVol)) : 0;
            callQtyRequested = Math.min(callQtyRequested, liqCap(legVol));
            const collarLegs = (put ? 1 : 0) + (shortPut ? 1 : 0) + (call ? 1 : 0);
            const putContractMultiplier = put?.contractMultiplier ?? 100;
            const callContractMultiplier = call?.contractMultiplier ?? 100;
            const { netDebitPerContract, totalNetDebit } = calculateCollarOpen({
              putAsk: put?.ask,
              shortPutBid: shortPut?.bid,
              callBid: call?.bid,
              putQuantity: qty,
              callQuantity: callQtyRequested,
              impactPerShare: optionExecutionImpact({ enabled: slippageModel === 'impact', contracts: Math.max(qty, callQtyRequested), strikeVolume: legVol, vix: nextVix }) / (put?.splitAdjustmentFactor ?? call?.splitAdjustmentFactor ?? 1),
              commission: optCommission(collarLegs, Math.max(qty, callQtyRequested)),
              putContractMultiplier,
              callContractMultiplier,
            });
            const validStructure = s.put_strike ? put != null && shortPut != null && shortPut.strike < put.strike && (!s.call_strike || call != null) : call != null;
            const debitLimit = config.strategyParams?.collarMaxDebitPct;
            const withinDebitLimit = debitLimit == null || totalNetDebit <= Math.max(0, portfolio.leveragedShares * nextLevOpen) * debitLimit;
            if ((qty > 0 || callQtyRequested > 0) && validStructure && Number.isFinite(totalNetDebit) && withinDebitLimit) {
            applyOverlayEffect(applyOptionExecution({ cashImpact: -totalNetDebit, pnl: 0 }), 'collar');

            if (collarScenario === 'overheat') decisionMemory.overheatCollarUsedThisStreak = true;

            const openSpot = nextLevOpen || leveragedDayPrice;
            const rvPct = annualizedRvPct(decisionViews.qqq);
            const debugId = collarLifecycles.length;
            collarLifecycles.push({
              openDate: nextDay.date,
              triggerScenario: collarScenario,
              openVix: nextVix,
              openVixRvRatio: rvPct && rvPct > 0 ? nextVix / rvPct : undefined,
              openQqqDrawdownFrom20dHighPct: drawdownFromHighPct(decisionViews.qqq, 20, nextQQQOpen || today.close),
              openSpot,
              strikes: {
                longPut: s.put_strike ?? 0,
                shortPut: s.put_spread_short_strike,
                call: s.call_strike,
              },
              strikeDistanceFromOpenSpotPct: {
                longPut: openSpot > 0 && s.put_strike ? (s.put_strike - openSpot) / openSpot : 0,
                shortPut: openSpot > 0 && s.put_spread_short_strike ? (s.put_spread_short_strike - openSpot) / openSpot : undefined,
                call: openSpot > 0 && s.call_strike ? (s.call_strike - openSpot) / openSpot : undefined,
              },
              netDebit: totalNetDebit,
            });

            pendingCollars.add(buildCollarLifecyclePosition({
              debugId, expiry: s.expiry, putUnderlying: putSymbol, leveragedSymbol,
              putStrike: s.put_strike ?? 0, shortPutStrike: s.put_spread_short_strike,
              callStrike: s.call_strike, putQuantity: qty, callQuantity: callQtyRequested,
              netDebit: totalNetDebit, triggerScenario: collarScenario, marketContext: output.currentState,
              putContractMultiplier, callContractMultiplier,
              putSplitAdjustmentFactor: put?.splitAdjustmentFactor,
              callSplitAdjustmentFactor: call?.splitAdjustmentFactor,
            }));
            const callLabel = s.call_strike ? `Covered Call@${s.call_strike}` : '无 Call 腿';
            const shortPutLabel = s.put_spread_short_strike ? ` + Short Put@${s.put_spread_short_strike}` : '';
            const strategyLabel = s.put_strike ? s.call_strike ? 'Put Spread Collar' : 'Put Spread Protection' : 'Covered Call';
            tradeLog.push({
              signalDate: today.date,
              date:       nextDay.date,
              symbol:     collarName(leveragedSymbol),
              side:       'BUY',
              quantity:   Math.max(qty, callQtyRequested),
              fillPrice:  Math.abs(netDebitPerContract / (put?.contractMultiplier ?? call?.contractMultiplier ?? 100)),
              cashImpact: -totalNetDebit,
              rationale:  s.put_strike ? `${strategyLabel}（${leveragedSymbol}）：${callLabel} | Long Put@${s.put_strike}${shortPutLabel}，exp ${s.expiry}，持仓 ${portfolio.leveragedShares} 股` : `${strategyLabel}（${leveragedSymbol}）：${callLabel}，exp ${s.expiry}，持仓 ${portfolio.leveragedShares} 股`,
              action:     'OPEN',
              strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR,
              executionReason: `${strategyLabel}开仓（${collarScenario === 'overheat' ? '过热保护' : collarScenario === 'drawdown' ? '回撤保护' : collarScenario === 'vix_spike' ? 'VIX突刺保护' : collarScenario === 'weakening' ? '转弱保护' : '主动保护'}）`,
              executionReasonKey: collarOpenReasonKey(collarScenario),
              marketContext: output.currentState,
            });
          }
        }
      }
    }
    profRecord('execution', __tExecE);
  }

  // Close or settle open option positions at the final equity date, never beyond config.endDate.
  // Terminal-mark runs keep open positions valued at the final bar instead.
  const lastDate = equityCurve.at(-1)?.date ?? '';
  const lastQQQIndex = lastDate ? qqqIdx.get(lastDate) : undefined;
  const lastLevIndex = lastDate ? leveragedIdx.get(lastDate) : undefined;
  const lastQQQClose = lastQQQIndex != null ? qqqBars[lastQQQIndex]?.close ?? 0 : 0;
  const lastLevClose = lastLevIndex != null ? leveragedBars[lastLevIndex]?.close ?? 0 : 0;
  const lastVix = lastDate ? resolveVolAt(lastDate, vixByDate) : VIX_FALLBACK;
  const lastPricingVol = lastDate ? resolvePricingVolAt(lastDate, lastVix) : lastVix;
  const lastPricingVol3m = lastDate ? resolvePricingVol3mAt(lastDate, lastVix, lastPricingVol) : undefined;

  if (lastDate && !blownUp && !includeTerminalMarkOnly) {
    for (const ic of pendingICs.drain()) {
      const { cashImpact, pnl, note, settled, costPerShare } = finalizeIronCondor({ position: ic, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(4, ic.quantity) });
      if (settled) {
        const effect = applyOptionExecution({ cashImpact, pnl });
        if (!independentIC) applyOverlayEffect(effect);
        tradeLog.push({
          signalDate: lastDate,
          date: lastDate, symbol: ironCondorName, side: 'BUY',
          quantity: ic.quantity, fillPrice: 0, cashImpact: effect.cashDelta,
          rationale: `[回测结束结算] ${note}`, action: 'SETTLE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, pnl: effect.pnl,
          executionReason: '到期结算', outcomeReason: `[回测结束结算] ${note}`,
          outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
          marketContext: lastMarketContext,
        });
      } else {
        const effect = applyOptionExecution({ cashImpact, pnl });
        if (!independentIC) applyOverlayEffect(effect);
        tradeLog.push({
          signalDate: lastDate,
          date: lastDate, symbol: ironCondorName, side: 'BUY',
          quantity: ic.quantity, fillPrice: costPerShare ?? 0, cashImpact: effect.cashDelta,
          rationale: `[回测结束强制平仓] ${note}`, action: 'CLOSE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR, pnl: effect.pnl,
          executionReason: '提前平仓', outcomeReason: `[回测结束强制平仓] ${note}`,
          outcomeReasonKey: getOptionOutcomeReasonKey('回测结束', false),
          marketContext: lastMarketContext,
        });
      }
	    }
	    for (const cs of pendingCSes.drain()) {
	      const meta = callCreditSpreadTradeMeta('CS', cs.shortStrike, cs.longStrike, proxySymbol);
	      const { cashImpact, pnl, note, settled, costPerShare } = finalizeCallCreditSpread({ position: cs, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(2, cs.quantity), label: meta.label });
	      if (settled) {
	        const effect = applyOptionExecution({ cashImpact, pnl });
	        if (!independentCS) applyOverlayEffect(effect);
	        tradeLog.push({
	          signalDate: lastDate,
	          date: lastDate, symbol: meta.symbol, side: 'BUY',
	          quantity: cs.quantity, fillPrice: 0, cashImpact: effect.cashDelta,
	          rationale: `[回测结束结算] [${callSpreadLayerLabel(cs)}] ${note}`, action: 'SETTLE' as const, strategyTag: meta.strategyTag, pnl: effect.pnl,
	          executionReason: '到期结算', outcomeReason: `[回测结束结算] ${note}`,
	          outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
	          marketContext: lastMarketContext,
	        });
	      } else {
	        const effect = applyOptionExecution({ cashImpact, pnl });
	        if (!independentCS) applyOverlayEffect(effect);
	        tradeLog.push(buildCallCreditSpreadCloseTrade({
	          position: cs,
	          kind: 'CS',
	          signalDate: lastDate,
	          date: lastDate,
	          fillPrice: costPerShare ?? 0,
	          cashImpact: effect.cashDelta,
	          rationale: `[回测结束强制平仓] [${callSpreadLayerLabel(cs)}] ${note}`,
	          pnl: effect.pnl,
	          outcomeReason: `[回测结束强制平仓] ${note}`,
	          marketContext: lastMarketContext,
	        }));
	      }
	    }
	    for (const pcs of pendingPCSes.drain()) {
	      const { cashImpact, pnl, note, settled } = finalizePutCreditSpread({ position: pcs, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(2, pcs.quantity) });
	      const effect = applyOptionExecution({ cashImpact, pnl });
	      if (!independentPCS) applyOverlayEffect(effect);
      pcsStreakState = updatePcsStreakStateOnClose(pcsStreakState, { pnl: effect.pnl, closeDate: lastDate, cooldownTradingDays: config.strategyParams?.pcsStreakCooldownTradingDays ?? 0, tradingDayCalendar: tradingDayDates });
      pcsResearchP1LastSettledPnl = effect.pnl;
      execution.pcsDynamicEntryProfile?.onClose?.({ signalDate: pcs.openedAt ?? lastDate, closeDate: lastDate, pnl: effect.pnl });
	      if (pcs.pathDiagnostic) {
	        pcs.pathDiagnostic.closeDate = lastDate;
	        pcs.pathDiagnostic.closeAction = settled ? 'SETTLE' : 'CLOSE';
	        pcs.pathDiagnostic.realizedPnl = effect.pnl;
	      }
	      tradeLog.push({ signalDate: lastDate, date: lastDate, expiry: pcs.expiry, symbol: putCreditSpreadTradeMeta('PCS', pcs.longStrike, pcs.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: pcs.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `[回测结束${settled ? '结算' : '强制平仓'}] ${note}，exp ${pcs.expiry}`, action: settled ? 'SETTLE' as const : 'CLOSE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, pnl: effect.pnl, executionReason: settled ? '到期结算' : '提前平仓', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, settled), marketContext: lastMarketContext });
	    }
	    for (const rescue of pendingPCSRescues.drain()) {
	      const { cashImpact, pnl, note, settled } = finalizePutCreditSpread({ position: rescue, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(2, rescue.quantity), label: 'PCS Rescue' });
	      const effect = applyOptionExecution({ cashImpact, pnl });
	      tradeLog.push({ signalDate: rescue.openedAt, date: lastDate, expiry: rescue.expiry, symbol: putCreditSpreadTradeMeta('PCS_RESCUE', rescue.longStrike, rescue.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: rescue.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `[回测结束${settled ? '结算' : '强制平仓'}] ${note.replace('Put Credit Spread', 'PCS Rescue')}，exp ${rescue.expiry}`, action: settled ? 'SETTLE' as const : 'CLOSE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE, pnl: effect.pnl, executionReason: settled ? '到期结算' : '提前平仓', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, settled), marketContext: lastMarketContext });
	    }
	    for (const eb of pendingEquityBoosts.drain()) {
	      const { cashImpact, pnl, note, settled } = finalizePutCreditSpread({ position: eb, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(2, eb.quantity), label: 'Equity Boost Put Spread' });
      const effect = scaleIndependentEquityBoostEffect(applyOptionExecution({ cashImpact, pnl }), eb);
      recordEquityBoostCandidate6Close(effect.pnl);
      if (!independentEquityBoost) applyOverlayEffect(effect);
      tradeLog.push({ signalDate: lastDate, date: lastDate, expiry: eb.expiry, symbol: putCreditSpreadTradeMeta('EQUITY_BOOST', eb.longStrike, eb.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: eb.quantity, fillPrice: 0, cashImpact: effect.cashDelta, rationale: `[回测结束${settled ? '结算' : '强制平仓'}] ${note}，exp ${eb.expiry}`, action: settled ? 'SETTLE' as const : 'CLOSE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, pnl: effect.pnl, executionReason: settled ? '到期结算' : '提前平仓', outcomeReason: note, outcomeReasonKey: getOptionOutcomeReasonKey(note, settled), marketContext: lastMarketContext });
	    }
	    for (const bcs of pendingBearCSes.drain()) {
	      const meta = callCreditSpreadTradeMeta('BEAR_CS', bcs.shortStrike, bcs.longStrike, proxySymbol);
	      const { cashImpact, pnl, note, settled, costPerShare } = finalizeCallCreditSpread({ position: bcs, asOfDate: lastDate, qqqClose: lastQQQClose, vix: lastPricingVol, pricing, vix3m: lastPricingVol3m, commission: optCommission(2, bcs.quantity), label: meta.label });
	      if (settled) {
	        const effect = applyOptionExecution({ cashImpact, pnl });
	        if (!independentBearCS) applyOverlayEffect(effect);
	        tradeLog.push({
	          signalDate: lastDate,
	          date: lastDate, symbol: meta.symbol, side: 'BUY',
	          quantity: bcs.quantity, fillPrice: 0, cashImpact: effect.cashDelta,
	          rationale: `[回测结束结算] ${note}`, action: 'SETTLE' as const, strategyTag: meta.strategyTag, pnl: effect.pnl,
	          executionReason: '到期结算', outcomeReason: `[回测结束结算] ${note}`,
	          outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
	          marketContext: lastMarketContext,
	        });
	      } else {
	        const effect = applyOptionExecution({ cashImpact, pnl });
	        const netPnl = effect.pnl;
	        if (!independentBearCS) applyOverlayEffect(effect);
	        tradeLog.push(buildCallCreditSpreadCloseTrade({
	          position: bcs,
	          kind: 'BEAR_CS',
	          signalDate: lastDate,
	          date: lastDate,
	          fillPrice: costPerShare ?? 0,
	          cashImpact: effect.cashDelta,
	          rationale: `[回测结束强制平仓] ${note}`,
	          pnl: netPnl,
	          outcomeReason: `[回测结束强制平仓] ${note}`,
	          marketContext: lastMarketContext,
	        }));
	      }
	    }
    for (const collar of pendingCollars.drain()) {
      const { cashImpact, pnl, note, settled, grossCashImpact } = finalizeCollar({ collar, asOfDate: lastDate, leveragedClose: lastLevClose, qqqClose: lastQQQClose, vix: lastPricingVol, leveragedSymbol, pricing, vix3m: lastPricingVol3m, commission: optCommission(1 + (collar.shortPutStrike ? 1 : 0) + (collar.callStrike ? 1 : 0), collar.quantity), splitAdjustmentFactors: marketSplitFactors(lastDate) });
      if (settled) {
        const effect = applyOptionExecution({ cashImpact, pnl });
        applyOverlayEffect(effect, 'collar');
        recordCollarClose(collar, lastDate, lastLevClose, effect.cashDelta, effect.pnl, note, true);
        tradeLog.push({
          signalDate: lastDate,
          date: lastDate, symbol: collarName(leveragedSymbol), side: 'SELL',
          quantity: collar.quantity, fillPrice: 0, cashImpact: effect.cashDelta,
          rationale: `[回测结束结算] ${note}`, action: 'SETTLE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, pnl: effect.pnl,
          executionReason: '到期结算', outcomeReason: `[回测结束结算] ${note}`,
          outcomeReasonKey: getOptionOutcomeReasonKey(note, true),
          marketContext: lastMarketContext,
        });
      } else {
        const effect = applyOptionExecution({ cashImpact, pnl });
        applyOverlayEffect(effect, 'collar');
        recordCollarClose(collar, lastDate, lastLevClose, effect.cashDelta, effect.pnl, '回测结束', false);
        tradeLog.push({
          signalDate: lastDate,
          date: lastDate, symbol: collarName(leveragedSymbol), side: grossCashImpact >= 0 ? 'SELL' : 'BUY',
          quantity: collar.quantity, fillPrice: Math.abs(grossCashImpact / (100 * collar.quantity)), cashImpact: effect.cashDelta,
          rationale: `[回测结束强制平仓] ${note}`, action: 'CLOSE' as const, strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR, pnl: effect.pnl,
          executionReason: '提前平仓', outcomeReason: `[回测结束强制平仓] ${note}`,
          outcomeReasonKey: getOptionOutcomeReasonKey('回测结束', false),
          marketContext: lastMarketContext,
        });
      }
    }

    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) {
      const finalLeveragedValue = portfolio.leveragedShares * lastLevClose;
      const finalBoxxValue = portfolio.boxxShares * boxxPrices.close(lastDate, lastQQQIndex ?? qqqBars.length - 1);
      const finalNav = finalLeveragedValue + finalBoxxValue + portfolio.cash + optionCash;
      lastPoint.nav = finalNav;
      lastPoint.tqqqValue = finalLeveragedValue;
      lastPoint.boxxValue = finalBoxxValue;
      lastPoint.cashValue = portfolio.cash + optionCash;
      lastPoint.tqqqPct = finalNav > 0 ? finalLeveragedValue / finalNav : 0;
      lastPoint.boxxPct = finalNav > 0 ? finalBoxxValue / finalNav : 0;
      lastPoint.tqqqShares = portfolio.leveragedShares;
      lastPoint.boxxShares = portfolio.boxxShares;
      lastPoint.hasOpenIC = false;
      lastPoint.hasOpenCS = false;
      lastPoint.hasOpenBearCS = false;
      lastPoint.hasOpenCollar = false;
    }
  } else if (lastDate && !blownUp && includeTerminalMarkOnly) {
    // 独立样本保留仓位；这条记录只披露期末按同一 B-S/报价模型估出的未实现 P&L。
    for (const pcs of pendingPCSes) {
      const marked = closePutCreditSpreadAtMark(pcs, lastDate, lastQQQClose, lastPricingVol, '期末模型标记', pricing, lastPricingVol3m);
      if (pcs.pathDiagnostic) {
        pcs.pathDiagnostic.closeDate = lastDate;
        pcs.pathDiagnostic.closeAction = 'MARK';
        pcs.pathDiagnostic.realizedPnl = marked.pnl;
      }
      tradeLog.push({ signalDate: pcs.openedAt, date: lastDate, expiry: pcs.expiry, symbol: putCreditSpreadTradeMeta('PCS', pcs.longStrike, pcs.shortStrike, proxySymbol).symbol, side: 'BUY', quantity: pcs.quantity, fillPrice: marked.costPerShare, cashImpact: 0, rationale: `[期末模型标记] ${marked.note}`, action: 'MARK', strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, pnl: marked.pnl, outcomeReason: '期末模型标记', outcomeReasonKey: 'terminal_model_mark', marketContext: lastMarketContext });
    }
  }

  // 每个 PCS 路径都保留一条到期反事实：即使实际路径已经提前平仓，也用
  // 同一信用金和到期日 QQQ 收盘价结算。未到期的期末标记不纳入持有到期胜率。
  const pathCutoffDate = lastDate;
  for (const path of pcsPathDiagnostics) {
    const expiryBar = qqqBars.find((bar) => bar.date >= path.expiry);
    if (!expiryBar || !pathCutoffDate || expiryBar.date > pathCutoffDate) continue;
    const settled = settlePutCreditSpread({
      underlying: proxySymbol,
      expiry: path.expiry,
      quantity: path.quantity,
      shortStrike: path.shortStrike,
      longStrike: path.longStrike,
      width: path.width,
      creditReceived: path.openCredit,
    }, expiryBar.close);
    path.holdToExpiryDate = expiryBar.date;
    path.holdToExpiryPnl = settled.pnl;
  }

  const metrics = computeMetrics(equityCurve, config.riskFreeRate ?? 0.045, config.timeframe ?? '1d');
  metrics.totalTrades = tradeLog.length;
  Object.assign(metrics, computeEquityWhipsawMetrics(
    tradeLog,
    metrics.startNAV,
    (config.leveragedSymbol ?? 'TQQQ').toUpperCase(),
    buildTradingDayDateIndex(equityCurve.map(point => point.date))
  ));

  return {
    config,
    ...(slowSubregimeDiagnostics ? { slowSubregimeDiagnostics } : {}),
    ...((config.timeframe === '1d' || config.timeframe === undefined) && slowSubregimeDiagnostics ? { stateGridAudit: buildStateGridAudit(equityCurve, slowSubregimeDiagnostics) } : {}),
    equityCurve,
    ...(config.strategyParams?.researchSameDayStockReRiskDiagnostic === true ? { sameDayReriskDiagnostics } : {}),
    ...(config.strategyParams?.researchSameDayStockDeRiskDiagnostic === true ? { sameDayStockDeRiskDiagnostics } : {}),
    tradeLog,
    metrics,
    nextOpenPlan,
    ...(blownUp ? { blownUp: true as const } : {}),
    debug: {
      collarLifecycles,
      optionCycles: computeOptionCycleDebug(tradeLog),
      pcsPathDiagnostics,
      shadowCollarCash: config.strategyParams?.collarCashMode === 'shadow' ? shadowCollarCash : undefined,
      trace,
      dailyAdmissions,
      pcsProfileDiagnostics,
      csConditionalGateTrace,
      csMfeRescueDiagnostics,
    } as BacktestResult['debug'] & { pcsProfileDiagnostics: PcsProfileDiagnostic[] },
    csBreachState,
    csSecondaryEventRiskState,
  };
}
