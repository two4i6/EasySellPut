/** Research-only daily native stock observation core. Retained equity/NAV/crisis/macro/slow-state
 * statements keep their chronological order; option lifecycles/terminal reports are absent.
 * Derived and checked by native-stock-extraction-v2.test-helper.ts, never generated at runtime. */
// v2 日循环实现；旧路径仅作兼容再导出。
import { performance } from 'node:perf_hooks';
import { createNativeDecisionObservationEngine, type NativeDecisionObservation } from './native-decision-observation-v1';
export type { NativeDecisionObservation } from './native-decision-observation-v1';
import type { OHLCV, CSBreachState, CSEventRiskState, OptionChain, PcsDynamicEntryProfile, PcsDynamicMarketState, PcsStreakState, SplitEvent } from '../../types/input';
import type { FinancialFactor } from '../../../../../types/factor';
import type { MarketEnvironmentSnapshot } from '../../types/output';
import { createRollingIndicators } from '../../utils';
import { computeRawCrisis, transitionCrisis, updateTailRiskState, type CrisisState } from '../../engines/crisis-state-machine';
import { createWeeklyVoteDetailsCache, advanceW7MacroRegime, advanceW9MacroRegime, advanceW10MacroRegime, advanceW11MacroRegime, computeWeeklyVoteFromDailyEngine, computeHybridVote, isoWeek, transitionMacroRegime, type W9MacroRegimeState } from '../../engines/macro-regime-state';
import { buildMockOptionChain, bs, normalizeVolIndexForMockOptions } from '../../backtest/mockOptions';
import { MOCK_OPTION_CALIBRATION } from '../../backtest/mockOptionCalibration';
import { createEquityBoostDteHysteresisState, updateEquityBoostDteHysteresisState } from '../strategies/equity-boost-put-spread';
import { OverlayBook } from '../book';
import { executePendingEquityOrders, resolveEquityOrderFill, type PendingEquityOrder } from './equity-execution';
import { createPortfolioState, type PortfolioState } from './execution-state';
import { advanceDecisionView, barDateKey, createDecisionViewState, isDailyDecisionBar, resolvePrevVix, rocAtEnd, smaAtEnd } from './decision-view';
import { applyMacroBoostBlock, runBacktestPipeline } from './native-stock-pipeline-v3';
import { buildEquityPoint } from './snapshot';
import { optionProposalsFromCanonicalTape } from './canonical-option-signal-tape';
import { createDecisionMemoryState, updateDecisionMemory } from './decision-memory';
import { buildBoxxPriceResolver } from './boxx-price';
import { CallStrikeSurvivalAsOf, PutStrikeSurvivalAsOf } from '../../../analysis/SellerStatsEngine';
import { getOverlayUniverse } from '../../universe';
import { resolveOverlayDefaults } from '../defaults';
import type { BacktestConfig, BacktestResult, BacktestTraceEntry, EquityPoint, SlowSubregimeDiagnostic, TradeEntry } from '../../backtest/types';
import type { MacroExecutionDriver, PCSSurvivalExitMode } from '../../types/params';
import type { OverlayProposal } from '../../types/pipeline';
import { resolveSlowSubregimeDiagnostic } from '../../slow-subregime-runtime';
import { VIX_FALLBACK } from '../../constants';
type PcsProfileDiagnostic = {
    profile: string;
    signalDate: string;
    reason: 'DYNAMIC_CONTRACT_UNBUILDABLE';
    detail: 'live_overlay_proposal_missing';
};
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
type IncrementalWeeklyBar = OHLCV & {
    vix?: number;
    vix3m?: number;
};
/** 与 resampleBars(daily, 'week') 等价，但当前周只累积到已见的日 bar。 */
function appendWeeklyBar(weekly: IncrementalWeeklyBar[], bar: OHLCV, latest: {
    vix?: number;
    vix3m?: number;
}, vixByDate: Record<string, number>, vix3mByDate: Record<string, number>) {
    if (vixByDate[bar.date] != null)
        latest.vix = vixByDate[bar.date];
    if (vix3mByDate[bar.date] != null)
        latest.vix3m = vix3mByDate[bar.date];
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
function appendWeeklyLastBar(weekly: IncrementalWeeklyBar[], bar: OHLCV, latest: {
    vix?: number;
    vix3m?: number;
}) {
    const prior = weekly[weekly.length - 1];
    const next = { ...bar, vix: latest.vix, vix3m: latest.vix3m };
    if (!prior || isoWeek(prior.date) !== isoWeek(bar.date))
        weekly.push(next);
    else
        weekly[weekly.length - 1] = next;
}
/**
 * 日循环阶段耗时分桶——纯测量用途，不影响任何回测行为/输出。
 * pipeline 桶覆盖 crisis/宏观状态推进 + FactorMap + VerdictEngine/DecisionEngine/coordinator
 * (runBacktestPipeline 单次调用)；v2 架构把 factor 计算与决策引擎调用融合进同一次
 * runPipeline 调用（src/lib/engines/leveraged-overlay/pipeline.ts，live 交易共用），
 * 日循环层面无法再细分，故不单列 factorCompute/decisionEngine 两桶。
 */
export type BacktestProfilePhase = 'decisionView' | 'chainLookup' | 'pipeline' | 'execution' | 'snapshot';
export type BacktestPhaseProfiler = {
    record: (phase: BacktestProfilePhase, ms: number) => void;
};
export type BacktestExecutionContext = {
    /** Research SDK only: pause the same chronological loop at its as-of observation seam. */
    yieldDecisionObservations?: boolean;
    /** Synchronous owning snapshot at the existing yield seam; never seal native state. */
    snapshotObservation?: (value: NativeDecisionObservation) => NativeDecisionObservation;
    /** Batch 内按同一数据坐标共享；只含输入派生索引，绝不含策略/账本状态。 */
    marketPrecompute?: ReadonlyMarketPrecompute;
    /** Parity diagnostic for the old full-history validation path. */
    appendOnlyPriceSeriesValidationCache?: boolean;
    /** 可选：逐日阶段耗时分析器。缺省时不产生任何 performance.now() 调用（零开销）。 */
    phaseProfiler?: BacktestPhaseProfiler;
    /** Research-only detailed pipeline profiling. */
    pipelineStageProfiler?: {
        record: (phase: string, ms: number) => void;
    };
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
type MockChainContractRequest = {
    expiry: string;
    pricingDte: number;
    strikes: number[];
    types: Array<'call' | 'put'>;
};
type MockDecisionContractRequest = {
    targetDte: number;
    types: Array<'call' | 'put'>;
};
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
    if (!(spot > 0 && width > 0 && creditPerShare > 0 && maxLoss > 0 && expectedMove > 0 && denominator > 0))
        return undefined;
    return {
        risk: breakeven - expectedMove * expectedLoss / denominator,
        realization: breakeven + expectedMove * expectedPremium / denominator,
    };
}
function isIntradayTimeframe(config: BacktestConfig): boolean {
    return config.timeframe != null && config.timeframe !== '1d';
}
// prevVix feeds "single-day VIX spike" checks (03-market-regime.ts, v2 coordinator) — must be
// the last COMPLETED day's VIX, not literally the previous bar. At intraday timeframes, bars[i-1]
// is the previous bar (e.g. previous hour), which would turn a 20%/day threshold into a 20%/bar
// one and fire on ordinary intrabar VIX noise. Exported for direct unit testing.
export { resolvePrevVix } from './decision-view';
export { applyMacroBoostBlock } from './native-stock-pipeline-v3';
/** Compatibility exhausts the identical loop; no change to default execution or orders. */
export function* iterateNativeStockState(qqqBars: OHLCV[], leveragedBars: OHLCV[], boxxBars: OHLCV[] | undefined, vixByDate: Record<string, number>, config: BacktestConfig, spyBars?: OHLCV[], vix3mByDate: Record<string, number> = {}, pricingVolByDate?: Record<string, number>, vxnByDate?: Record<string, number>, splitEventsBySymbol: Record<string, FinancialFactor<SplitEvent[]>> = {}, execution: BacktestExecutionContext = {}): Generator<NativeDecisionObservation, void, void> {
    if (config.timeframe !== '1d' || config.trace === true || config.strategyParams?.tailRiskCollarOverride
        || ['enablePCS', 'enableEquityBoostPCS', 'enableCS', 'enableIC', 'enableCollar', 'enableBearOverlay', 'pcsRescueEnabled']
            .some(key => (config.strategyParams as Record<string, unknown> | undefined)?.[key] !== false))
        throw new Error('Unsupported native stock observation contract');
    if (config.strategyParams?.enablePCS === false) {
        const { enablePCS: _enablePCS, ...strategyParams } = config.strategyParams;
        config = { ...config, strategyParams };
    }
    if (config.strategyParams?.enableEquityBoostPCS === false) {
        const { enableEquityBoostPCS: _enableEquityBoostPCS, ...strategyParams } = config.strategyParams;
        config = { ...config, strategyParams };
    }
    const { initialCapital, slippagePct = 0.001, minBarHistory = 200, useMockOptions = false, includeTerminalMarkOnly = false, optionSpreadMultiplier = 1, } = config;
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
    const realStrikeGrid = config.realStrikeGrid ?? false;
    const liquidityModel = config.liquidityModel ?? false;
    const slippageModel = config.slippageModel ?? 'flat';
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
        if (cached)
            return cached;
        const chain = buildMockOptionChain(date, spot, vol, symbol, optionSpreadMultiplier, optionSkewSlope, { vix3m, riskFreeRate, ...chainOpts, splitEvents, contracts, decisionContracts });
        execution.mockOptionChainCache?.set(key, chain);
        return chain;
    };
    // #6 slippage: square-root market impact + VIX stress, both opt-in via
    // slippageModel='impact'. stressMult is 1.0 at VIX 20, ~2.0 by VIX 60 (capped).
    const IMPACT_K = 0.1;
    const STRESS_CAP = 1.0;
    const stressMult = (vix: number) => 1 + Math.min(STRESS_CAP, Math.max(0, (vix - 20) / 40));
    // 20-bar rolling ADV from the given series; 0 when unavailable → impact term 0.
    const advFromBars = (bars: OHLCV[] | undefined, idxMap: Map<string, number> | null, date: string): number => {
        if (!bars || !idxMap)
            return 0;
        const j = idxMap.get(date);
        if (j == null)
            return 0;
        let sum = 0, n = 0;
        for (let k = Math.max(0, j - 19); k <= j; k++) {
            const v = bars[k]?.volume;
            if (v && v > 0) {
                sum += v;
                n++;
            }
        }
        return n > 0 ? sum / n : 0;
    };
    // Per-contract one-way commission. Charged on opens and real closes (early exits +
    // end-of-backtest forced closes); expiry settlement is free (worthless legs cost
    // nothing; broker exercise/assignment fees are ~0). Total $ for an N-leg trade.
    const commissionPerContract = config.commissionPerContract ?? 0.65;
    const splitEventsFor = (symbol: string) => splitEventsBySymbol[symbol]?.confidence ? splitEventsBySymbol[symbol].value : [];
    const qqqIdx = buildDateIndex(qqqBars);
    const leveragedIdx = buildDateIndex(leveragedBars);
    const boxxIdx = boxxBars ? buildDateIndex(boxxBars) : null;
    const spyIdx = spyBars ? buildDateIndex(spyBars) : null;
    const isIntradayBacktest = isIntradayTimeframe(config);
    const resolveVolAt = (date: string, map: Record<string, number>, fallback = VIX_FALLBACK): number => (isIntradayBacktest ? map[date] : undefined) ?? map[barDateKey(date)] ?? fallback;
    const resolveOptionalVolAt = (date: string, map: Record<string, number>): number | undefined => (isIntradayBacktest ? map[date] : undefined) ?? map[barDateKey(date)];
    const nativeObservation = execution.yieldDecisionObservations === true
        ? createNativeDecisionObservationEngine(date => resolveOptionalVolAt(date, vxnByDate ?? {}), !isIntradayBacktest, execution.snapshotObservation) : undefined;
    const resolvePricingVolAt = (date: string, vix: number): number => normalizeVolIndexForMockOptions(pricingVolByDate ? resolveVolAt(date, pricingVolByDate, vix) : vix, config.volIndex);
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
    const tradeLog: TradeEntry[] = [];
    const csMfeRescueDiagnostics = { deltaStopTriggered: 0, priorMfeAvailable: 0, mfeThresholdMet: 0, lossThresholdMet: 0, dteWindowMet: 0, activated: 0 };
    const pendingEquityOrders = new OverlayBook<PendingEquityOrder>();
    const dailyAdmissions: NonNullable<NonNullable<BacktestResult['debug']>['dailyAdmissions']> | undefined = config.admissionDiagnostics ? [] : undefined;
    const trace: BacktestTraceEntry[] | undefined = config.trace ? [] : undefined;
    const pcsProfileDiagnostics: PcsProfileDiagnostic[] = [];
    const pcsSurvivalExitMode: PCSSurvivalExitMode = config.strategyParams?.pcsSurvivalExitMode ?? 'off';
    const pcsSurvivalFloor = Math.min(1, Math.max(0, config.strategyParams?.pcsSurvivalFloor ?? 0.4));
    const pcsSurvivalDrop = Math.min(1, Math.max(0, config.strategyParams?.pcsSurvivalDrop ?? 0.2));
    const pcsSurvivalTouchConfirmation = config.strategyParams?.pcsSurvivalTouchConfirmation ?? 'intraday_touch';
    const pcsSurvivalTouchBufferPct = Math.min(.2, Math.max(0, config.strategyParams?.pcsSurvivalTouchBufferPct ?? .005));
    const pcsSurvivalTouchVixThreshold = typeof config.strategyParams?.pcsSurvivalTouchVixThreshold === 'number' && Number.isFinite(config.strategyParams.pcsSurvivalTouchVixThreshold)
        ? Math.max(0, config.strategyParams.pcsSurvivalTouchVixThreshold)
        : undefined;
    const putStrikeSurvivalAsOf = !isIntradayBacktest && execution.incrementalPutSurvival !== false && config.strategyParams?.enablePCS === true
        ? execution.marketPrecompute?.putStrikeSurvivalAsOf ?? new PutStrikeSurvivalAsOf(qqqBars)
        : undefined;
    const exitFillMode = config.exitFillMode ?? 'next_open';
    const equityFillMode = config.equityFillMode ?? 'next_open';
    const equityTwapBars = config.equityTwapBars ?? 1;
    if (equityFillMode === 'twap' && (!isIntradayBacktest || !Number.isInteger(equityTwapBars) || equityTwapBars < 1)) {
        throw new Error('equityFillMode=twap 需要日内数据和正整数 equityTwapBars');
    }
    let portfolio: PortfolioState = createPortfolioState(initialCapital);
    let optionCash = 0;
    let equityBoostCandidate6RealizedPnl = 0;
    let equityBoostCandidate6RealizedPeak = 0;
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
    let lastLeveragedTrade: {
        side: 'BUY' | 'SELL';
        date: string;
    } | undefined;
    let prevCrisisPhaseForFastEntry = crisisState.phase;
    let postCrisisBars = 999;
    let macroRegimeState: W9MacroRegimeState | undefined;
    let csBreachState: CSBreachState | undefined;
    let researchUpstreamRecoveryDelayRemaining = 0;
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
        if (from == null || to == null)
            return 0;
        return Math.max(0, to - from);
    };
    const decisionViewState = createDecisionViewState({ qqqBars, boxxBars, spyBars, minBarHistory, intraday: isIntradayBacktest });
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
    const nativeWeeklyVoteCache = createWeeklyVoteDetailsCache();
    const incrementalWeeklyLatest: {
        vix?: number;
        vix3m?: number;
    } = {};
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
        appendOnlyPriceSeriesValidationCache: new WeakMap<OHLCV[], {
            length: number;
            valid: boolean;
        }>(),
        profiler: execution.pipelineStageProfiler,
    };
    const profMark = (): number => (phaseProfiler ? performance.now() : 0);
    const profRecord = (phase: BacktestProfilePhase, t0: number): void => {
        if (phaseProfiler)
            phaseProfiler.record(phase, performance.now() - t0);
    };
    for (let i = minBarHistory; i < loopEndExclusive; i++) {
        const today = qqqBars[i];
        const nextDay = qqqBars[i + 1];
        if (csSecondaryEventRiskState?.lastOpenDate !== undefined
            && tradingSessionsRemaining(csSecondaryEventRiskState.lastOpenDate, today.date)
                > Math.max(1, Math.floor(config.strategyParams?.csSecondaryWindowTradingDays ?? 5))) {
            const coverageStillLive = csSecondaryEventRiskState.coverageLastOpenDate !== undefined
                && tradingSessionsRemaining(csSecondaryEventRiskState.coverageLastOpenDate, today.date)
                    <= Math.max(1, Math.floor(config.strategyParams?.csSecondaryCoverageWindowTradingDays ?? 5));
            if (!coverageStillLive)
                csSecondaryEventRiskState = undefined;
            else
                csSecondaryEventRiskState = {
                    entriesInWindow: 0,
                    lastOpenDate: undefined,
                    coverageEntriesInWindow: csSecondaryEventRiskState.coverageEntriesInWindow,
                    coverageLastOpenDate: csSecondaryEventRiskState.coverageLastOpenDate,
                };
        }
        else if (csSecondaryEventRiskState?.coverageLastOpenDate !== undefined
            && tradingSessionsRemaining(csSecondaryEventRiskState.coverageLastOpenDate, today.date)
                > Math.max(1, Math.floor(config.strategyParams?.csSecondaryCoverageWindowTradingDays ?? 5))) {
            if (config.strategyParams?.csSecondaryMaxEntriesInWindow === undefined)
                csSecondaryEventRiskState = undefined;
            else
                csSecondaryEventRiskState = {
                    entriesInWindow: csSecondaryEventRiskState.entriesInWindow,
                    lastOpenDate: csSecondaryEventRiskState.lastOpenDate,
                    coverageEntriesInWindow: 0,
                    coverageLastOpenDate: undefined,
                };
        }
        const isDecisionBar = isDailyDecisionBar(qqqBars, i, isIntradayBacktest);
        if (isDecisionBar && researchUpstreamRecoveryDelayRemaining > 0)
            researchUpstreamRecoveryDelayRemaining -= 1;
        const checkOptionExitsThisBar = !isIntradayBacktest || isDecisionBar || intrabarStops;
        const viewLeveragedSliceEnd = leveragedIdx.has(today.date)
            ? leveragedIdx.get(today.date)! + 1
            : 0;
        const viewBoxxSliceEnd = boxxBars && boxxIdx && boxxIdx.has(today.date)
            ? boxxIdx.get(today.date)! + 1
            : undefined;
        while (spyBars?.[spySliceEnd] && spyBars[spySliceEnd]!.date <= today.date)
            spySliceEnd++;
        const viewSpySliceEnd = spyBars ? spySliceEnd : undefined;
        const __tDecisionView = profMark();
        advanceDecisionView(decisionViewState, { today, intraday: isIntradayBacktest, leveragedBars, leveragedSliceEnd: viewLeveragedSliceEnd, boxxBars, boxxSliceEnd: viewBoxxSliceEnd, spyBars, spySliceEnd: viewSpySliceEnd });
        const vxnToday = resolveOptionalVolAt(today.date, vxnMap);
        if (csResearchVxnHistory && vxnToday != null && csResearchVxnHistory.length >= 5) {
            const vxnFiveBarsAgo = csResearchVxnHistory[csResearchVxnHistory.length - 5]!;
            csResearchVixChange5d = vxnFiveBarsAgo > 0 ? (vxnToday - vxnFiveBarsAgo) / vxnFiveBarsAgo : undefined;
        }
        else {
            csResearchVixChange5d = undefined;
        }
        if (vxnToday != null)
            csResearchVxnHistory?.push(vxnToday);
        if (vxnToday != null)
            pcsVxnHistory?.push(vxnToday);
        if (vxnToday != null)
            ebVxnHistory?.push(vxnToday);
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
        if (today.date < startDate)
            continue;
        if (endDate && today.date > endDate)
            break;
        const slowSubregime = slowSubregimeDiagnostics || macroExecutionDriver === 'slow-subregime' || slowSubregimeGateEnabled
            ? execution.slowSubregimeByDate?.[today.date.slice(0, 10)] ?? resolveSlowSubregimeDiagnostic(today.date)
            : undefined;
        if (isDecisionBar && slowSubregimeDiagnostics && slowSubregime)
            slowSubregimeDiagnostics.push(slowSubregime);
        const csResearchEntryGate = config.strategyParams?.csResearchEntryGate;
        if (csResearchEntryGate && csResearchEntryGate !== 'off') {
            const qqqRoc20 = qqqRolling.rocAt(i, 20);
            const sma20 = qqqRolling.smaAt(i, 20);
            const sma20FiveBarsAgo = i >= 5 ? qqqRolling.smaAt(i - 5, 20) : 0;
            const sma20SlopePct = sma20FiveBarsAgo > 0 ? (sma20 - sma20FiveBarsAgo) / sma20FiveBarsAgo : undefined;
            csResearchWeakPersistenceDays = qqqRoc20 != null && sma20SlopePct != null && qqqRoc20 < 0 && sma20SlopePct < 0
                ? csResearchWeakPersistenceDays + 1
                : 0;
        }
        else {
            csResearchWeakPersistenceDays = 0;
        }
        const todayTime = new Date(today.date).getTime();
        const leveragedBar = leveragedBars[leveragedIdx.get(today.date) ?? -1];
        const boxxDayPrice = boxxPrices.close(today.date, i);
        const leveragedDayPrice = leveragedBar?.close ?? 0;
        const leveragedOpenPrice = leveragedBar?.open ?? leveragedDayPrice;
        if (!leveragedBar || leveragedDayPrice <= 0)
            continue;
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
                    }
                    else {
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
                }
                else if (order.side === 'BUY') {
                    tradeLog.push({ signalDate: order.signalDate, date: today.date, symbol: 'BOXX', side: 'BUY', quantity: qty, fillPrice, cashImpact: fill.cashImpact, rationale: order.rationale, executionReason: order.executionReason ?? order.rationale, executionReasonKey: order.executionReasonKey, marketContext: order.marketContext });
                }
                else {
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
                || (queueQuality && queueSignalContext?.regime === 'BULL' && ((sellFirstMode === 'target80_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.80))
                    || (sellFirstMode === 'target85_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.85))
                    || (sellFirstMode === 'target90_high_gap' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) >= 0.90))
                    || (sellFirstMode === 'target90_vol_resize' && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && order.executionReasonKey === 'vol_target_resize' && (order.targetPct ?? -Infinity) >= 0.90))));
            const sellFirst = (config.strategyParams?.researchEquitySellFirst === true
                || config.researchEquitySellFirstByDate?.[today.date] === true)
                && queueQualityGate
                && (!sellFirstTargetIncreaseOnly || (pendingEquityOrders.some(order => order.symbol === 'BOXX' && order.side === 'SELL')
                    && pendingEquityOrders.some(order => order.symbol === leveragedSymbol && order.side === 'BUY' && (order.targetPct ?? -Infinity) > currentActualPct + sellFirstMinGapPp / 100 + 1e-9)));
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
                if (pendingEquityOrders[k]!.twap!.executionDate < executionDate)
                    pendingEquityOrders.removeAt(k);
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
        const todayMockChain = buildDecisionChains && (!lazyMockChains || needsQqqOptionChain)
            ? cachedMockChain(today.date, today.close, pricingVolToday, proxySymbol, pricingVol3mToday)
            : buildDecisionChains
                ? { symbol: proxySymbol, spot: today.close, timestamp: today.date, expirations: [] }
                : undefined;
        const todayLevMockChain = buildDecisionChains && (!lazyMockChains || needsLeveragedOptionChain) && leveragedDayPrice > 0
            ? cachedMockChain(today.date, leveragedDayPrice, pricingVolToday, leveragedSymbol, pricingVol3mToday)
            : undefined;
        const optionChains = todayMockChain
            ? lazyMockChains
                ? { [proxySymbol]: todayMockChain, ...(todayLevMockChain ? { [leveragedSymbol]: todayLevMockChain } : {}) }
                : { [proxySymbol]: todayMockChain, [leveragedSymbol]: todayLevMockChain ?? todayMockChain }
            : undefined;
        profRecord('chainLookup', __tChainA);
        (phaseProfiler as any)?.record?.('chainLookupDecision', performance.now() - __tChainA);
        const __tExecB = profMark();
        // ── Compute NAV after all settlements ────────────────────────────────────
        const leveragedValue = portfolio.leveragedShares * leveragedDayPrice;
        const boxxValue = portfolio.boxxShares * boxxDayPrice;
        const optionMtM = 0;
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
                if (config.macroRegimePhaseByDate && !replayPhase)
                    throw new Error(`Missing precomputed macro regime phase for ${today.date}`);
                // W7/W9/W10 是日频状态机（不走 transitionMacroRegime 的周戳短路），每个 decision bar 推进一次
                macroRegimeState = replayPhase
                    ? { phase: replayPhase, weekStamp: isoWeek(today.date) }
                    : config.strategyParams.macroRegime.classifier === 'w10-balanced'
                        ? advanceW10MacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, weeklyVoteCache: useIncrementalWeeklyMacro ? nativeWeeklyVoteCache : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined })
                        : config.strategyParams.macroRegime.classifier === 'w11-observe'
                            ? advanceW11MacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, weeklyVoteCache: useIncrementalWeeklyMacro ? nativeWeeklyVoteCache : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined })
                            : config.strategyParams.macroRegime.classifier === 'w9-fast'
                                ? advanceW9MacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, weeklyVoteCache: useIncrementalWeeklyMacro ? nativeWeeklyVoteCache : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined })
                                : config.strategyParams.macroRegime.classifier === 'w7-hybrid'
                                    ? advanceW7MacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate, weeklyAggregateBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyBars : undefined, weeklyBarsThroughToday: useIncrementalWeeklyMacro ? incrementalWeeklyLastBars : undefined, weeklyVoteCache: useIncrementalWeeklyMacro ? nativeWeeklyVoteCache : undefined, latestVix: useIncrementalWeeklyMacro ? incrementalWeeklyLatest.vix : undefined })
                                    : transitionMacroRegime(macroRegimeState, { date: today.date, qqqBarsThroughToday: decisionViews.qqq, vixByDate, vix3mByDate }, config.strategyParams.macroRegime.classifier === 'w0-week-raw' ? computeWeeklyVoteFromDailyEngine
                                        : config.strategyParams.macroRegime.classifier === 'w5-hybrid' ? computeHybridVote
                                            : undefined);
            }
            if (crisisState.phase === 'NONE' && prevCrisisPhaseForFastEntry === 'RECOVERY') {
                postCrisisBars = 0;
            }
            else if (crisisState.phase === 'NONE') {
                postCrisisBars++;
            }
            else {
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
            }
            else if (trigger) {
                conditionalGrowthCapReleaseBars = Math.max(0, Math.floor(conditionalGrowthCap.releaseBars ?? 2));
            }
            else if (conditionalGrowthCapReleaseBars > 0) {
                conditionalGrowthCapReleaseBars--;
            }
            conditionalGrowthCapActive = trigger || conditionalGrowthCapReleaseBars > 0;
        }
        else if (isDecisionBar) {
            conditionalGrowthCapReleaseBars = 0;
            conditionalGrowthCapActive = false;
        }
        const optionPositions: [
        ] = [];
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
                    hasOpenIC: false,
                    hasOpenCollar: false,
                    hasOpenCS: false,
                    hasOpenBearCS: false,
                    hasOpenEquityBoost: false,
                    benchmarkPrice: today.close,
                    leveragedPrice: leveragedDayPrice,
                    targetVolOverride: config.targetVolByDate?.[today.date],
                    sidewaysFactorOverride: config.sidewaysFactorByDate?.[today.date],
                });
            }
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
                    openCount: 0,
                    realizedDrawdown: Math.max(0, equityBoostCandidate6RealizedPeak - equityBoostCandidate6RealizedPnl),
                }
                : undefined,
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
                    { symbol: 'BOXX', quantity: portfolio.boxxShares, marketValue: boxxValue },
                ].filter(p => p.quantity > 0 || p.marketValue > 0),
                optionPositions: [],
            },
            prices: {
                QQQ: decisionViews.qqq,
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
        if (nativeObservation)
            yield nativeObservation.observe({
                asOf: today.date,
                output, qqq: decisionViews.qqq,
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
            if (sameDayTargetDropPp <= 0 || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'SELL')
                return false;
            if (config.strategyParams?.researchSameDayTargetDropSkipCrisis === true && output.currentState.regime === 'CRISIS')
                return false;
            if (config.strategyParams?.researchSameDayTargetDropRiskOffOnly === true && !['SIDEWAYS', 'BEAR'].includes(output.currentState.regime))
                return false;
            if (config.strategyParams?.researchSameDayTargetDropRiskOnWeakeningOnly === true && output.currentState.regime !== 'RISK_ON_WEAKENING')
                return false;
            if ((previousEquityPoint?.tqqqPct ?? 0) < sameDayTargetDropMinActual)
                return false;
            const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
            const proposalTargetPct = (proposal as {
                targetPct?: unknown;
            }).targetPct;
            const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
            if (sameDayTargetDropRangeBoundTerminalPct != null
                && (output.currentState.regime !== 'RANGE_BOUND'
                    || targetPct == null
                    || targetPct > sameDayTargetDropRangeBoundTerminalPct))
                return false;
            if (config.strategyParams?.researchSameDayTargetDropRangeBoundRoc20Max != null
                && (output.currentState.roc20 ?? Infinity) > config.strategyParams.researchSameDayTargetDropRangeBoundRoc20Max)
                return false;
            if (config.strategyParams?.researchSameDayTargetDropRangeBoundTqqqUp === true) {
                const leveragedIndex = leveragedIdx.get(today.date) ?? -1;
                const previousLeveragedClose = leveragedIndex > 0 ? leveragedBars[leveragedIndex - 1]?.close : undefined;
                if (previousLeveragedClose == null || leveragedDayPrice / previousLeveragedClose - 1 <= 0)
                    return false;
            }
            return previousTarget != null && targetPct != null && previousTarget - targetPct >= sameDayTargetDropPp;
        };
        const sameDayStockDeRiskAllowed = (proposal: typeof output.proposals[number]) => {
            sameDayStockDeRiskFractionOverride = undefined;
            if (!sameDayStockDeRisk || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'SELL')
                return false;
            if ((previousEquityPoint?.tqqqPct ?? 0) < sameDayStockDeRiskMinActual)
                return false;
            const proposalTargetForRecoveryQuality = (proposal as {
                targetPct?: unknown;
            }).targetPct;
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
            if (sameDayStockDeRiskMode === 'crisis' && output.currentState.regime !== 'CRISIS' && output.currentState.crisisPhase !== 'PENDING' && output.currentState.crisisPhase !== 'CONFIRMED')
                return false;
            if (sameDayStockDeRiskMode === 'high_vol' && !((output.currentState.vix ?? 0) >= 25 && (output.currentState.tqqqRealisedVol20d ?? 0) >= 0.60 && (output.currentState.roc5 ?? 0) < 0))
                return false;
            if (sameDayStockDeRiskMode === 'risk_on_extended' && output.currentState.regime !== 'RISK_ON_EXTENDED')
                return false;
            if (sameDayStockDeRiskMode === 'risk_on_extended_weak' && (output.currentState.regime !== 'RISK_ON_EXTENDED' || (output.currentState.roc5 ?? 0) >= 0))
                return false;
            if (sameDayStockDeRiskMode === 'transition_loss') {
                const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
                const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
                    ? leveragedDayPrice / previousLeveragedClose - 1
                    : Infinity;
                if (!['RISK_ON_WEAKENING', 'SIDEWAYS'].includes(output.currentState.regime)
                    || (output.currentState.roc5 ?? 0) >= 0
                    || (output.currentState.vix ?? 0) < 20
                    || (output.currentState.vixChange5d ?? 0) <= 0
                    || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? 0))
                    return false;
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
                    || transitionRoc20Blocked))
                    return false;
            }
            if (sameDayStockDeRiskMode === 'bear_loss') {
                const previousLeveragedClose = leveragedBars[(leveragedIdx.get(today.date) ?? -1) - 1]?.close;
                const sameDayTqqqReturn = previousLeveragedClose != null && previousLeveragedClose > 0
                    ? leveragedDayPrice / previousLeveragedClose - 1
                    : Infinity;
                const target = (proposal as {
                    targetPct?: unknown;
                }).targetPct;
                if (output.currentState.regime !== 'BEAR'
                    || typeof target !== 'number'
                    || target > (config.strategyParams?.researchSameDayStockDeRiskBearTargetMax ?? 0) + 1e-9
                    || (output.currentState.vix ?? 0) < 25
                    || (output.currentState.roc5 ?? 0) >= 0
                    || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? -.05))
                    return false;
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
                    || sameDayTqqqReturn > (config.strategyParams?.researchSameDayStockDeRiskTqqqReturnMax ?? -.05))
                    return false;
                if (sameDayStockDeRiskRiskOnWeakMinTargetDropPp > 0) {
                    const previousTargetForDrop = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
                    const proposalTargetForDrop = (proposal as {
                        targetPct?: unknown;
                    }).targetPct;
                    if (previousTargetForDrop == null || typeof proposalTargetForDrop !== 'number'
                        || previousTargetForDrop - proposalTargetForDrop < sameDayStockDeRiskRiskOnWeakMinTargetDropPp / 100)
                        return false;
                }
            }
            const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
            const proposalTargetPct = (proposal as {
                targetPct?: unknown;
            }).targetPct;
            const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
            if (previousTarget == null || targetPct == null || targetPct >= previousTarget)
                return false;
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
            if (!sameDayStockReRisk || proposal.kind !== 'equity' || proposal.symbol !== leveragedSymbol || proposal.side !== 'BUY')
                return sameDayStockReRiskReject('not_candidate');
            if (sameDayStockDeRiskBuyCooldownRemaining > 0)
                return sameDayStockReRiskReject('buy_cooldown');
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
            const proposalTargetForBridgeRaw = (proposal as {
                targetPct?: unknown;
            }).targetPct;
            const proposalTargetForBridge = typeof proposalTargetForBridgeRaw === 'number' ? proposalTargetForBridgeRaw : undefined;
            const bindingConstraint = (output.pipeline?.riskBudget as {
                data?: {
                    binding_constraint?: string;
                };
            } | undefined)?.data?.binding_constraint;
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
            if (sameDayStockReRiskBullOnly && targetJumpContext && state.regime !== 'BULL')
                return sameDayStockReRiskReject('bull_only');
            if (!['BULL', 'RISK_ON_EXTENDED'].includes(state.regime)
                && !(sameDayStockReRiskAllowRangeBound && state.regime === 'RANGE_BOUND')
                && !(sameDayStockReRiskAllowRiskOnWeakening && state.regime === 'RISK_ON_WEAKENING')
                && !actualRecoveryBridge)
                return sameDayStockReRiskReject('regime');
            if (sameDayStockReRiskSr02Only && (state.slowSubregime ?? '') !== 'SR02' && !actualRecoveryBridge)
                return sameDayStockReRiskReject('sr02_only');
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
                || ((state.vixChange5d ?? Infinity) > .02 && !allowHighErVixRise && !cleanBullBridgeVixChange && !actualRecoveryBridge))
                return sameDayStockReRiskReject('vix_gate');
            const allowBullNegativeRoc5VixFall = sameDayStockReRiskAllowBullNegativeRoc5VixFall
                && state.regime === 'BULL'
                && (state.roc5 ?? Infinity) < 0
                && (state.vixChange5d ?? Infinity) <= 0;
            if ((((state.roc5 ?? -Infinity) < 0 && !allowBullNegativeRoc5VixFall) || (state.priceVsSma200Pct ?? -Infinity) < 0) && !cleanBullBridgeRoc && !actualRecoveryBridge)
                return sameDayStockReRiskReject('trend_gate');
            if ((state.qqqEr20 ?? -Infinity) < sameDayStockReRiskErMin)
                return sameDayStockReRiskReject('er_min');
            if ((state.roc20 ?? -Infinity) < sameDayStockReRiskRoc20Min)
                return sameDayStockReRiskReject('roc20_min');
            const realizedVolMax = sameDayStockReRiskRiskOnRealizedVolMax != null
                && (state.regime === 'BULL' || state.regime === 'RISK_ON_EXTENDED')
                ? sameDayStockReRiskRiskOnRealizedVolMax
                : sameDayStockReRiskRealizedVolMax;
            if ((state.tqqqRealisedVol20d ?? Infinity) > realizedVolMax)
                return sameDayStockReRiskReject('realized_vol');
            if ((today.close / (qqqBars[i - 1]?.close ?? today.close) - 1) < sameDayStockReRiskQqqReturnMin
                && !(independentScoreRecovery
                    && sameDayStockReRiskIndependentScoreAllowQqqDown
                    && (sameDayStockReRiskIndependentScoreQqqReturnWindowBars < 2 || independentScoreQqqWindowReturn >= 0))
                && !independentScoreContinuationQqqDown)
                return sameDayStockReRiskReject('qqq_return_min');
            if (sameDayStockReRiskCleanBudgetOnly) {
                const riskBudgetData = (output.pipeline?.riskBudget as {
                    data?: {
                        trendParticipation?: {
                            qualityOverrideClean?: boolean;
                            conditionalCapApplied?: number;
                        };
                    };
                } | undefined)?.data;
                if (state.regime !== 'BULL' || riskBudgetData?.trendParticipation?.qualityOverrideClean !== true || riskBudgetData.trendParticipation.conditionalCapApplied != null)
                    return sameDayStockReRiskReject('clean_budget_state');
                if ((state.vix ?? Infinity) > 20 || (state.vixChange5d ?? Infinity) > 0 || (state.tqqqRealisedVol20d ?? Infinity) > .90)
                    return sameDayStockReRiskReject('clean_budget_risk');
                if ((state.priceExtensionAtr ?? Infinity) >= 2 || (state.drawdownFromRecentHighPct ?? Infinity) >= .03)
                    return sameDayStockReRiskReject('clean_budget_shape');
            }
            if (sameDayStockReRiskVolTargetOnly) {
                const riskBudgetData = (output.pipeline?.riskBudget as {
                    data?: {
                        binding_constraint?: string;
                    };
                } | undefined)?.data;
                const trendParticipationBindingAllowed = sameDayStockReRiskAllowTrendParticipation
                    && riskBudgetData?.binding_constraint === 'trend_participation';
                const trendDiscountBindingAllowed = sameDayStockReRiskAllowTrendDiscount
                    && riskBudgetData?.binding_constraint === 'trend_discount';
                const targetFloorBindingAllowed = trendParticipationBindingAllowed || trendDiscountBindingAllowed;
                if (riskBudgetData?.binding_constraint !== 'vol_target' && !targetFloorBindingAllowed && !slowBullVixLowTargetBridge && !slowBullTrendLowTargetBridge)
                    return sameDayStockReRiskReject('binding_constraint');
                if (targetFloorBindingAllowed && sameDayStockReRiskRequireTrendParticipationEligible
                    && (riskBudgetData as {
                        trendParticipation?: {
                            eligible?: boolean;
                        };
                    } | undefined)?.trendParticipation?.eligible !== true)
                    return sameDayStockReRiskReject('trend_participation_ineligible');
                if (targetFloorBindingAllowed && sameDayStockReRiskTrendParticipationTargetMinPct != null) {
                    const proposalTargetPct = (proposal as {
                        targetPct?: unknown;
                    }).targetPct;
                    if (typeof proposalTargetPct !== 'number' || proposalTargetPct < sameDayStockReRiskTrendParticipationTargetMinPct)
                        return sameDayStockReRiskReject('trend_participation_target');
                }
            }
            if (sameDayStockReRiskTrendScoreMin != null) {
                const riskBudgetData = (output.pipeline?.riskBudget as {
                    data?: {
                        trendParticipation?: {
                            score?: number;
                        };
                    };
                } | undefined)?.data;
                if ((riskBudgetData?.trendParticipation?.score ?? -Infinity) < sameDayStockReRiskTrendScoreMin)
                    return sameDayStockReRiskReject('trend_score');
            }
            if (sameDayStockReRiskRequireTrendActive) {
                const riskBudgetData = (output.pipeline?.riskBudget as {
                    data?: {
                        trendParticipation?: {
                            active?: boolean;
                        };
                    };
                } | undefined)?.data;
                if (riskBudgetData?.trendParticipation?.active !== true)
                    return sameDayStockReRiskReject('trend_inactive');
            }
            if (sameDayStockReRiskRequireBoxxSell
                && !output.proposals.some(proposal => proposal.kind === 'equity' && proposal.symbol === 'BOXX' && proposal.side === 'SELL'))
                return sameDayStockReRiskReject('boxx_sell');
            if (sameDayStockReRiskStrongCore && ((state.qqqEr20 ?? -Infinity) < .30 || (state.roc20 ?? -Infinity) < .02 || (state.sma20SlopePct ?? -Infinity) < 0 || (state.priceExtensionAtr ?? Infinity) >= 2.65 || (state.drawdownFromRecentHighPct ?? Infinity) >= .05))
                return sameDayStockReRiskReject('strong_core');
            if (sameDayStockReRiskTailVetoMode
                && ((sameDayStockReRiskTailVetoMode !== 'qqq_up' && (state.vixChange5d ?? Infinity) > 0)
                    || (sameDayStockReRiskTailVetoMode !== 'vix_stable'
                        && (today.close / (qqqBars[i - 1]?.close ?? today.close) - 1) < 0
                        && !(independentScoreRecovery
                            && (sameDayStockReRiskIndependentScoreBypassQqqDirectionGate
                                || (sameDayStockReRiskIndependentScoreAllowQqqDown
                                    && sameDayStockReRiskIndependentScoreQqqReturnWindowBars >= 2
                                    && independentScoreQqqWindowReturn >= 0)))
                        && !independentScoreContinuationQqqDown)))
                return sameDayStockReRiskReject('tail_veto');
            const currentActual = stockNav > 0 ? leveragedValue / stockNav : (previousEquityPoint?.tqqqPct ?? 0);
            const actualForReRisk = (sameDayStockReRiskUseCurrentActual
                || (crossRegimeRecovery && sameDayStockReRiskCrossRegimeRecoveryFromActual)
                || (cleanBullRecovery && sameDayStockReRiskCleanBullRecoveryFromActual)
                || independentScoreRecovery)
                ? currentActual
                : (previousEquityPoint?.tqqqPct ?? 0);
            if (actualForReRisk < sameDayStockReRiskMinActual)
                return sameDayStockReRiskReject('min_actual');
            if (sameDayStockReRiskRequirePriorQqqUp && i < 2)
                return sameDayStockReRiskReject('prior_qqq_up_data');
            if (sameDayStockReRiskRequirePriorQqqUp && (qqqBars[i - 1]?.close ?? 0) / (qqqBars[i - 2]?.close ?? qqqBars[i - 1]?.close ?? 1) - 1 < 0)
                return sameDayStockReRiskReject('prior_qqq_down');
            if (sameDayStockReRiskPriorQqqReturnMin > -Infinity && i < 2)
                return sameDayStockReRiskReject('prior_qqq_min_data');
            if (sameDayStockReRiskPriorQqqReturnMin > -Infinity && (qqqBars[i - 1]?.close ?? 0) / (qqqBars[i - 2]?.close ?? qqqBars[i - 1]?.close ?? 1) - 1 < sameDayStockReRiskPriorQqqReturnMin)
                return sameDayStockReRiskReject('prior_qqq_min');
            if (sameDayStockReRiskRequirePriorTqqqUp && leveragedIndex < 2)
                return sameDayStockReRiskReject('prior_tqqq_up_data');
            const priorLeveragedClose = leveragedIndex > 1 ? leveragedBars[leveragedIndex - 2]?.close : undefined;
            if (sameDayStockReRiskRequirePriorTqqqUp && (previousLeveragedClose ?? 0) / (priorLeveragedClose ?? previousLeveragedClose ?? 1) - 1 < 0)
                return sameDayStockReRiskReject('prior_tqqq_down');
            if (sameDayStockReRiskTqqqUp && (leveragedBar?.close ?? 0) / (previousLeveragedClose ?? leveragedBar?.close ?? 1) - 1 < 0)
                return sameDayStockReRiskReject('tqqq_down');
            if (state.crisisPhase === 'CONFIRMED' || state.flashCrashOverrideActive === true)
                return sameDayStockReRiskReject('crisis');
            if (!sameDayStockReRiskAllowTargetJump && (previousEquityPoint?.tqqqPct ?? 0) >= (previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct ?? 0))
                return sameDayStockReRiskReject('target_not_above_actual');
            const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
            const proposalTargetPct = (proposal as {
                targetPct?: unknown;
            }).targetPct;
            const targetPct = typeof proposalTargetPct === 'number' ? proposalTargetPct : undefined;
            if (sameDayStockReRiskNavDrawdownTargetCapPct != null
                && (previousEquityPoint?.marketContext?.navDrawdownPct ?? 0) >= .10
                && targetPct != null
                && targetPct > sameDayStockReRiskNavDrawdownTargetCapPct)
                return sameDayStockReRiskReject('nav_target_cap');
            const previousThreshold = sameDayStockReRiskFromActual ? actualForReRisk : previousTarget;
            const riskBudgetData = (output.pipeline?.riskBudget as {
                data?: {
                    binding_constraint?: string;
                };
            } | undefined)?.data;
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
            if (effectiveMinGapPp > 0 && previousThreshold != null && targetPct != null && targetPct - previousThreshold < effectiveMinGapPp)
                return sameDayStockReRiskReject('min_target_gap');
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
            if (sameDayStockReRiskAllowTargetJump && effectiveMaxTargetJumpPp != null && previousTarget != null && targetPct != null && targetPct - previousTarget > effectiveMaxTargetJumpPp + sameDayStockReRiskTargetJumpEpsilonPp && !independentScoreActualNearTargetJump && !independentScorePriorActualRestoreJump && !queuedLargeTargetJump)
                return sameDayStockReRiskReject('max_target_jump');
            if (!(previousThreshold != null && targetPct != null && targetPct > previousThreshold))
                return sameDayStockReRiskReject('no_actual_gap');
            if (independentScoreRecovery && !independentScoreContinuationQqqDown)
                sameDayIndependentScoreCarrySource = true;
            if (independentScoreRecovery
                && state.regime === 'RANGE_BOUND'
                && sameDayStockReRiskIndependentScoreRangeBoundFraction != null) {
                sameDayStockReRiskFractionOverride = Math.min(sameDayStockReRiskFractionOverride ?? 1, sameDayStockReRiskIndependentScoreRangeBoundFraction);
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
                || proposal.side !== 'BUY')
                return false;
            if ((previousEquityPoint?.marketContext?.navDrawdownPct ?? 0) < navDrawdownTargetIncreaseMinPct)
                return false;
            const previousTarget = previousEquityPoint?.targetTqqqPct ?? previousEquityPoint?.tqqqPct;
            const proposalTargetPct = (proposal as {
                targetPct?: unknown;
            }).targetPct;
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
                    const proposalTarget = (proposal as {
                        targetPct?: unknown;
                    }).targetPct;
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
                    const proposalTarget = (proposal as {
                        targetPct?: unknown;
                    }).targetPct;
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
                        bindingConstraint: (output.pipeline?.riskBudget as {
                            data?: {
                                binding_constraint?: string;
                            };
                        } | undefined)?.data?.binding_constraint,
                        marketContext: output.currentState,
                        executionReasonKey: proposal.executionReasonKey,
                        rejectReason: isStockReRisk ? 'allowed' : sameDayStockReRiskRejectReason,
                    });
                }
                if ((!sameDayUpstreamAllowed || !isUpstreamBlock) && !isTargetDrop && !isStockDeRisk && !isStockReRisk && !isSameDayReRiskFundingSell)
                    continue;
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
        }
        else if (researchIndependentScoreCarryRemaining > 0) {
            researchIndependentScoreCarryRemaining -= 1;
        }
        const __tExecC = profMark();
        const stockPolicy = (output.pipeline as Record<string, {
            value?: {
                overrides?: {
                    crisisRecoveryBars?: number;
                };
            };
        }>).stockPolicy;
        policyCrisisRecoveryBars = stockPolicy?.value?.overrides?.crisisRecoveryBars;
        lastMarketContext = output.currentState;
        if (csBreachState && csBreachState.breachDate === today.date) {
            const levIdx = leveragedIdx.get(today.date) ?? -1;
            csBreachState.tqqqROC20AtBreach = levIdx >= 20
                ? (leveragedBars[levIdx].close - leveragedBars[levIdx - 20].close) / leveragedBars[levIdx - 20].close
                : 0;
            csBreachState.regimeAtBreach = output.currentState.regime;
        }
        const pipelineOverlayData = (output.pipeline as Record<string, {
            data?: {
                csBreachState?: CSBreachState;
                csSecondaryEventRiskState?: CSEventRiskState;
            };
        }>)?.overlay?.data;
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
            if (entry.date !== today.date)
                break;
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
                if (proposal.action !== 'ADD_PUT_CREDIT_SPREAD' || (!pcsContractProfile && pcsPriceSelectionMode === 'off'))
                    return [proposal];
                const profiled = liveOverlayProposals.find((candidate) => candidate.action === 'ADD_PUT_CREDIT_SPREAD');
                if (pcsPriceSelectionMode !== 'off')
                    return profiled ? [profiled] : [];
                if (!pcsContractProfile)
                    return [proposal];
                if (profiled || !pcsContractProfile.startsWith('dynamic-'))
                    return [profiled ?? proposal];
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
        const snapshotLeveragedValue = portfolio.leveragedShares * leveragedDayPrice;
        const snapshotBoxxValue = portfolio.boxxShares * boxxDayPrice;
        const snapshotStockNav = snapshotLeveragedValue + snapshotBoxxValue + portfolio.cash;
        const snapshotNav = snapshotStockNav + optionCash + optionMtM;
        navDrawdownPeak = Math.max(navDrawdownPeak, snapshotStockNav);
        const __tSnapshot = profMark();
        equityCurve.push(buildEquityPoint({ date: today.date, nav: snapshotNav, allocationNav: snapshotStockNav, cash: portfolio.cash + optionCash, tqqqValue: snapshotLeveragedValue, boxxValue: snapshotBoxxValue, tqqqShares: portfolio.leveragedShares, boxxShares: portfolio.boxxShares, output, hasOpenIC: false, hasOpenCollar: false, hasOpenCS: false, hasOpenBearCS: false, hasOpenEquityBoost: false, benchmarkPrice: today.close, leveragedPrice: leveragedDayPrice, spyPrice, observedMacroRegime: macroRegimeState?.phase, targetVolOverride: config.targetVolByDate?.[today.date], sidewaysFactorOverride: config.sidewaysFactorByDate?.[today.date] }));
        if (dailyAdmissions)
            dailyAdmissions.push({ date: today.date, marketState: output.currentState, admissions: output.overlay.strategyAdmissions ?? [] });
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
            const pipelineRegimeData = (output.pipeline as Record<string, {
                data?: {
                    price_vs_sma200_pct?: number;
                    roc5?: number;
                };
            }>)?.regime?.data;
            const price_vs_sma200_today = pipelineRegimeData?.price_vs_sma200_pct ?? 0;
            const roc5Today = pipelineRegimeData?.roc5 ?? 0;
            prevCrisisRaw = computeRawCrisis(vixToday, price_vs_sma200_today, vix3mToday, roc5Today, {
                vixLedExit: config.strategyParams?.vixLedCrisisExit,
            });
        }
        const canOpenOnNextBar = isDecisionBar &&
            nextDay != null &&
            leveragedIdx.has(nextDay.date) &&
            (!endDate || nextDay.date <= endDate);
        const twapExecutionBar = equityFillMode === 'twap'
            ? qqqBars.slice(i + 1).find(bar => barDateKey(bar.date) !== barDateKey(today.date))
            : undefined;
        for (const proposal of output.proposals) {
            if (proposal.kind !== 'equity')
                continue;
            if ((sameDayUpstreamAllowed && proposal.symbol === leveragedSymbol && proposal.side === 'SELL' && proposal.executionReasonKey === 'upstream_block') || sameDayTargetDropAllowed(proposal) || sameDayStockDeRiskAllowed(proposal) || sameDayStockReRiskAllowed(proposal))
                continue;
            if (researchUpstreamRecoveryDelayRemaining > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY')
                continue;
            if (recoveryBuyDelayBars > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY' && postCrisisBarsForResearch >= 0 && postCrisisBarsForResearch < recoveryBuyDelayBars)
                continue;
            if (sameDayStockDeRiskBuyCooldownRemaining > 0 && proposal.symbol === leveragedSymbol && proposal.side === 'BUY')
                continue;
            if (navDrawdownTargetIncreaseBlocked(proposal))
                continue;
            if (!canOpenOnNextBar)
                continue;
            if (equityFillMode === 'twap' && (!twapExecutionBar || !leveragedIdx.has(twapExecutionBar.date)))
                continue;
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
        if (isDecisionBar && sameDayStockDeRiskBuyCooldownRemaining > 0)
            sameDayStockDeRiskBuyCooldownRemaining -= 1;
        profRecord('execution', __tExecD);
    }
}
