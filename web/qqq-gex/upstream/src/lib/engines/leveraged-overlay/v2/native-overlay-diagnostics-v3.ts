/** Research-only disabled-option diagnostics. Current-bar warnings and state carry are
 * lossless; option candidate construction is intentionally outside this Interface.
 * Mechanically checked against the retained runner; never generated at runtime. */
// v2 Overlay 编排；旧路径仅作 Pipeline 兼容入口。
import type { PipelineContext, EngineResult, OverlayData } from '../types/pipeline';
import { createOverlayExposure, createOverlayIndicatorCatalog, createOverlayTraceData } from './bridge';
import { resolveOverlayDefaults, resolveOverlayMarketDefaults } from './defaults';
import { coordinateBearCallSpread, finalizeOverlayCoordination, resolveCollarProxyExclusions, resolveOverlayActionPriority, resolveOverlayUpstreamGate, resolvePutStrategyPriority } from './coordinator';
import type { PCSResearchEntryFilter, PCSV11ReleaseMode } from '../types/params';
import { explainReactivePcsTiming } from '../../analysis/PcsReactiveRule';
import { allowCollarShortCall, evaluateCollarAlternativeToSell, evaluateCollarEligibility, evaluateCollarVixSpike, getOpenOverlayPositionFlags, hasCollarLargePosition, isCollarBackwardation } from './strategies/collar';
import { evaluateBearMarketOverlay } from './strategies/bear-call-spread';
import { getOverlayUniverse } from '../universe';
import { equityBoostRiskOnWeakeningSr01VolGateBlocked, isEquityBoostBass221SeverityActive, isEquityBoostBass221VixReboundGateBlocked } from './strategies/equity-boost-put-spread';
import { TQQQ_LARGE_POSITION_PCT, IC_MODE_CONFIG, COLLAR_DRAWDOWN_PERIOD, COLLAR_DRAWDOWN_PERIOD_BULL, COLLAR_DRAWDOWN_TRIGGER, COLLAR_DRAWDOWN_TRIGGER_BULL, COLLAR_VIX_SPIKE_PCT, COLLAR_VIX_SPIKE_FLOOR, SELL_ALTERNATIVE_EXCESS_THRESHOLD } from '../constants';
import { isPcsChopVixGateBlocked, isPcsBass221GateBlocked, isPcsV11GateBlocked, isPcsBass232Candidate2GateBlocked, isPcsBass232Candidate3GateBlocked, isEquityBoostCandidate6GateBlocked, isPcsV12GateBlocked, isEquityBoostBass221GateBlocked, isCallCreditSpreadEventRiskScoped, isCallCreditSpreadExtensionBlocked, isCallCreditSpreadPreCrisis, releaseCallCreditSpreadBreach, resolveCallCreditSpreadExtensionGate, evaluatePcsStreakCooldownBlocked } from './strategies/standalone-policy-gates-v1';
type PcsChopVixGateInput = {
    enabled: boolean;
    vix?: number;
    adx14?: number;
    range20dPct?: number;
    priceExtensionAtr?: number;
    roc20?: number;
};
/** v1.2.7b/P0 候选 A 的状态与基础质量门输入。 */
type PcsCandidateAInput = PcsBass221GateInput;
/** P0 基础风险盾牌：保留研究中验证过的三条 currentBlock 与 price/SMA200 质量门。 */
function isPcsCandidateAEntryBlocked(input: PcsCandidateAInput): boolean {
    if (!input.enabled)
        return false;
    const vix = input.vix ?? Number.NaN;
    const adx14 = input.adx14 ?? Number.NaN;
    const priceExtensionAtr = input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY;
    const realisedVol20d = input.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY;
    const priceVsSma200Pct = input.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY;
    const currentBlock = (input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && priceExtensionAtr >= 2
        && adx14 >= 29) || (input.regime === 'BULL'
        && input.slowSubregime === 'SR02'
        && vix >= 15
        && vix < 18
        && adx14 >= 40) || (input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR01'
        && adx14 < 12);
    const priceSma200Block = input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && adx14 < 18
        && realisedVol20d >= .60
        && priceVsSma200Pct >= .10;
    return currentBlock || priceSma200Block;
}
/** bass2.1.2：低 ADX、高区间、价格扩张且低 VIX 时阻断 PCS 新开。 */
type PcsNativeP1R1Input = PcsCandidateAInput & {
    priorBullStressStreak?: number;
    lastSettledPnl?: number;
    scope?: 'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20';
    scopes?: Array<'all' | 'aCompact' | 'pressureEnvelope' | 'weakeningPressure' | 'correctedW20'>;
};
function isPcsNativeP1R1CorrectedW20Blocked(input: PcsNativeP1R1Input): boolean {
    return input.lastSettledPnl !== undefined
        && input.lastSettledPnl <= 0
        && input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR02'
        && (input.adx14 ?? Number.NaN) < 20;
}
/** Research-only formal P1 gate. The P1R1 symbol is retained as a compatibility alias; it evaluates today's state plus causal prior state, never dates. */
function isPcsNativeP1R1EntryBlocked(input: PcsNativeP1R1Input): boolean {
    if (!input.enabled)
        return false;
    const activeScopes = new Set(input.scopes ?? (input.scope === undefined ? ['all'] : [input.scope]));
    const hasScope = (scope: NonNullable<PcsNativeP1R1Input['scope']>) => activeScopes.has('all') || activeScopes.has(scope);
    const vix = input.vix ?? Number.NaN;
    const adx14 = input.adx14 ?? Number.NaN;
    const rv20 = input.tqqqRealisedVol20d ?? Number.NaN;
    const extensionAtr = input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY;
    const aCompact = input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && vix < 17
        && extensionAtr >= 2.5
        && adx14 < 21
        && (rv20 < .5 || rv20 >= .6);
    const pressureEnvelope = input.slowSubregime === 'SR02'
        && rv20 >= .6
        && adx14 < 20
        && ((input.regime === 'RISK_ON_EXTENDED' && vix >= 20)
            || (input.regime === 'BULL' && (input.priorBullStressStreak ?? 0) >= 2));
    const weakeningPressure = input.regime === 'RISK_ON_WEAKENING'
        && input.slowSubregime === 'SR01'
        && vix >= 20
        && adx14 < 15;
    const correctedW20 = isPcsNativeP1R1CorrectedW20Blocked(input);
    const p1Compact = (hasScope('aCompact') && aCompact)
        || (hasScope('pressureEnvelope') && pressureEnvelope)
        || (hasScope('weakeningPressure') && weakeningPressure);
    return p1Compact || (hasScope('correctedW20') && correctedW20);
}
/** Research-only residual-loss filter; no dates or outcome-derived admission. */
function isPcsNativeP1ResidualFilterBlocked(input: PcsCandidateAInput): boolean {
    if (!input.enabled)
        return false;
    return input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && (input.adx14 ?? Number.POSITIVE_INFINITY) >= 25
        && (input.tqqqRealisedVol20d ?? Number.POSITIVE_INFINITY) < .45;
}
type PcsBass221GateInput = PcsChopVixGateInput & {
    regime?: string;
    slowSubregime?: string;
    tqqqRealisedVol20d?: number;
    drawdownFromRecentHighPct?: number;
    rsi14?: number;
    roc5?: number;
    priceVsSma200Pct?: number;
    weakeningSignalCount?: number;
    v11ReleaseMode?: PCSV11ReleaseMode;
};
/** 研究专用：过滤已验证的 BULL/SR01 价格过度延伸新开仓，默认不消费。 */
function isPcsResearchEntryFilterBlocked(input: PcsBass221GateInput, filter: PCSResearchEntryFilter = 'off'): boolean {
    return filter === 'block_bull_sr01_extension2_v1'
        && input.regime === 'BULL'
        && input.slowSubregime === 'SR01'
        && (input.priceExtensionAtr ?? Number.NEGATIVE_INFINITY) >= 2;
}
export function runNativeStockOverlayDiagnostics(ctx: PipelineContext): EngineResult<OverlayData> {
const p=ctx.input.strategyParams;
if(ctx.input.mode!=='backtest'||ctx.input.trace||(ctx.input.account.optionPositions?.length??0)!==0
 ||p?.tailRiskCollarOverride||p?.enablePCS===true||p?.enableEquityBoostPCS===true
 ||p?.pcsRescueEnabled===true||['enableCollar','enableCS','enableIC','enableBearOverlay'].some(k=>(p as Record<string,unknown>|undefined)?.[k]!==false))
 throw Error('Unsupported native Overlay diagnostic contract');
const { macro, optionChains, prices, account } = ctx.input;
const warnings: string[] = [];
const blockers: string[] = [];
const bearOverlay = evaluateBearMarketOverlay(ctx);
const indicators = createOverlayIndicatorCatalog(ctx);
const traceFactors = createOverlayTraceData(ctx, indicators);
const params = resolveOverlayDefaults(ctx.input.strategyParams);
let csBreachState = ctx.input.csBreachState;
const pcsStreakState = ctx.input.pcsStreakState;
const pcsStreakCooldownTradingDays = params.pcsStreakCooldownTradingDays ?? 0;
const pcsStreakCooldownBlocked = evaluatePcsStreakCooldownBlocked(pcsStreakState, pcsStreakCooldownTradingDays, ctx.input.date);
// If upstream is blocked, skip overlay — UNLESS collarMode forces protection
const collarModeEarly = params.collarMode;
const anyUpstreamBlock = Object.values(ctx.results).some(r => r?.status === 'BLOCK' || r?.status === 'ERROR');
const upstreamGate = resolveOverlayUpstreamGate({ hasUpstreamBlock: anyUpstreamBlock, collarMode: collarModeEarly, regime: ctx.results.regime?.data.regime });
if (upstreamGate !== 'continue') {
    if (upstreamGate === 'crisis') {
        return finalizeOverlayCoordination({
            status: 'WARN',
            data: {
                action: bearOverlay.action,
                collar_triggered: false,
                call_spread_triggered: false,
                iron_condor_triggered: false,
                bear_call_spread_triggered: false,
                bearCallSpread: bearOverlay.bearCallSpread,
                bearFactors: bearOverlay.factors,
                ...traceFactors,
                csBreachState,
            },
            warnings: [...bearOverlay.warnings, '上游 CRISIS BLOCK，Overlay 禁止新开卖方期权结构'],
            blockers: [],
        });
    }
    return finalizeOverlayCoordination({
        status: 'PASS',
        data: { action: 'NONE', collar_triggered: false, call_spread_triggered: false, iron_condor_triggered: false, bear_call_spread_triggered: false, ...traceFactors, csBreachState },
        warnings: ['上游有 BLOCK，Overlay 跳过'],
        blockers: [],
    });
}
const universe = getOverlayUniverse(ctx.input.universeId);
const proxySymbol = ctx.input.optionUnderlyingSymbol ?? universe.optionSymbol;
// No option chains available
if (!optionChains?.[proxySymbol]) {
    return finalizeOverlayCoordination({
        status: 'WARN',
        data: { action: 'NONE', collar_triggered: false, call_spread_triggered: false, iron_condor_triggered: false, bear_call_spread_triggered: false, ...traceFactors, csBreachState },
        warnings: [`${proxySymbol} 期权链缺失，无法评估 Overlay 策略`],
        blockers: [],
    });
}
const useVixForPageUnderlying = ctx.input.optionUnderlyingSymbol !== undefined && ctx.input.optionUnderlyingSymbol !== 'QQQ';
// QQQ 独立 CS 回放沿用历史 VIX 主口径；VXN 只作为 V2.1.1 rescue 的附加条件，不能因为被加载就改写主波动率。
const independentCallSpreadBacktest = ctx.input.strategyParams?.optionsBacktestPositionMode?.cs === 'independent';
const useVxnAsPrimaryVol = !useVixForPageUnderlying && !independentCallSpreadBacktest && universe.primaryVolatility === 'VXN';
const primaryVol = useVxnAsPrimaryVol ? (macro.vxn ?? macro.vix) : macro.vix;
const primaryVol3m = useVxnAsPrimaryVol && Number.isFinite(macro.vxn) && Number.isFinite(macro.vix) && macro.vix! > 0 && Number.isFinite(macro.vix3m)
    ? macro.vxn! * (macro.vix3m! / macro.vix!)
    : macro.vix3m;
const { vix, vix3m, regime } = resolveOverlayMarketDefaults({ vix: primaryVol, vix3m: primaryVol3m, regime: ctx.results.regime?.data.regime });
const regimeData = ctx.results.regime?.data;
// Actual position pct uses max(target, actual) so transition days are covered.
const exposure = createOverlayExposure(ctx);
const leveragedSymbol = exposure.leveragedSymbol;
const final_tqqq_pct = exposure.targetLeveragedPct.value;
const actualLevPct = exposure.actualLeveragedPct.value;
const effectiveLevPct = exposure.effectiveLeveragedPct.value;
const { collarMode, enableCollar, enableCS, enableIC, csMode } = params;
const extremeCallSpreadMode = false;
const chain = optionChains[proxySymbol]!;
const spot = chain.spot;
// ── Drawdown-from-high signal ─────────────────────────────────────────────
// In BULL regime: use 5d window so normal ATH consolidation (~1-2% below recent peak)
// doesn't trigger collar every day — only catch genuine short-term reversals
// RISK_ON_EXTENDED is still a bull market (just overheated) — use short window to avoid false triggers
const isBullLike = regime === 'BULL' || regime === 'RISK_ON_EXTENDED';
const collarWindow = isBullLike ? COLLAR_DRAWDOWN_PERIOD_BULL : COLLAR_DRAWDOWN_PERIOD;
const rollingHigh = indicators.require<number>(isBullLike ? 'qqq_close_high5' : 'qqq_close_high20').value;
const drawdownPct = rollingHigh > spot ? (rollingHigh - spot) / rollingHigh : 0;
const drawdownTrigger = isBullLike ? COLLAR_DRAWDOWN_TRIGGER_BULL : COLLAR_DRAWDOWN_TRIGGER;
const highDrawdown = drawdownPct >= drawdownTrigger;
// ── VIX single-day spike signal ───────────────────────────────────────────
const { prevVix, pct: vixSpikePct, spiked: vixSpiked } = evaluateCollarVixSpike({ vix, prevVix: macro.prevVix, spikePct: COLLAR_VIX_SPIKE_PCT, spikeFloor: COLLAR_VIX_SPIKE_FLOOR });
// ── Collar trigger ────────────────────────────────────────────────────────
const leveragedShares = account.positions.find(p => p.symbol === leveragedSymbol)?.quantity ?? 0;
const { hasOpenCollar, hasOpenCollarShortCall, hasOpenQQQCallSpread, hasOpenQQQPutSpread, hasOpenEquityBoost, openICCount } = getOpenOverlayPositionFlags({ leveragedSymbol, positions: ctx.input.account.positions, optionPositions: ctx.input.account.optionPositions ?? [] });
const backwardation = isCollarBackwardation(vix, vix3m);
const tqqq_threshold = params.maxTqqqWarnPct;
// Use effectiveLevPct (max of target vs actual) so the collar opens during de-risking transitions
const hasLargePosition = hasCollarLargePosition(effectiveLevPct, TQQQ_LARGE_POSITION_PCT);
// ── Alternative-to-sell scenario (opt-in) ────────────────────────────────
// When actual TQQQ weight exceeds target by > 3%, use collar to hedge the excess
// instead of immediately selling (preserves upside optionality while limiting downside).
// Only in bull-territory regimes — no point hedging during bear (just reduce).
const allowCollarAsAlternativeToSell = params.allowCollarAsAlternativeToSell === true;
const sellAlternativeScenario = evaluateCollarAlternativeToSell({
    enabled: enableCollar && allowCollarAsAlternativeToSell,
    hasOpenCollar,
    hasOpenCallSpread: hasOpenQQQCallSpread,
    leveragedShares,
    regime,
    actualLeveragedPct: actualLevPct,
    targetLeveragedPct: final_tqqq_pct,
    excessThreshold: SELL_ALTERNATIVE_EXCESS_THRESHOLD,
});
const collarRenewalInBear = params.collarRenewalInBear === true;
const collarEligibilityEvaluation = evaluateCollarEligibility({
    enabled: enableCollar,
    sellAlternativeScenario,
    mode: collarMode,
    hasLargePosition,
    regime,
    highDrawdown,
    vixSpiked,
    backwardation,
    extremeCallSpreadMode,
    vix,
    hasOpenCollar,
    hasOpenCallSpread: hasOpenQQQCallSpread,
    effectiveLevPct,
    tqqqThreshold: tqqq_threshold,
    renewalEnabled: collarRenewalInBear,
    leveragedShares,
    qqqRv20: indicators.require<number>('qqq_rv20').value,
    ivGate: params.collarIvGate,
});
let collar_triggered = false;
// Bear renewal override: bypass the 30% position-size gate in BEAR/CRISIS so the
// collar re-opens immediately after a deep-ITM exit or settlement, even when TQQQ
// has been de-risked below the large-position threshold.
if (collarEligibilityEvaluation.renewed) {
    warnings.push(`熊市续期：${regime} 机制下强制续开 Collar（跳过仓位阈值检查，leveragedShares=${leveragedShares}）`);
}
if (collarEligibilityEvaluation.ivRejected) {
    warnings.push(collarEligibilityEvaluation.ivRejectionReason!);
}
if (backwardation) {
    warnings.push(`VIX 期限倒挂：VIX=${vix.toFixed(1)}, VIX3M=${vix3m!.toFixed(1)}，建议 Collar 保护`);
}
if (highDrawdown) {
    warnings.push(`QQQ 距${collarWindow}日高点回撤 ${(drawdownPct * 100).toFixed(1)}%（高点 $${rollingHigh.toFixed(2)}），触发 Collar 保护`);
}
if (vixSpiked) {
    warnings.push(`VIX 单日跳升 ${(vixSpikePct * 100).toFixed(1)}%（${prevVix.toFixed(1)} → ${vix.toFixed(1)}），触发 Collar 保护`);
}
const collarLegMode = params.collarLegMode ?? 'both';
const allowShortCall = collarLegMode === 'callOnly' || (collarLegMode !== 'putOnly' && allowCollarShortCall({ collarTriggered: collar_triggered, regime, highDrawdown, vixSpiked, backwardation, sellAlternativeScenario, mode: collarMode }));
// ── Call Credit Spread trigger ────────────────────────────────────────────
// Rule 4: CS fires in BULL/RISK_ON_EXTENDED; also in RANGE_BOUND when golden cross
//         confirms bull context (price consolidating above SMA200 with SMA50 > SMA200).
// Rule 6: block if existing Collar short call already caps upside (duplicate selling)
// Rule 7: CRISIS/BEAR naturally excluded by requiring regime in bull-family
const tqqqROC20 = indicators.require<number>('tqqq_roc20').value;
const tqqqRealisedVol20d = ctx.results.volTarget?.data.tqqq_realized_vol_20d;
const csPreCrisisActive = isCallCreditSpreadPreCrisis({
    regime,
    vix,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
    tqqqRoc20: tqqqROC20,
    vixMax: params.csPreCrisisVixMax,
    tqqqRealisedVol20dMin: params.csPreCrisisTqqqRv20Min,
    tqqqRoc20Max: params.csPreCrisisTqqqRoc20Max,
});
const slowSubregimeState = ctx.input.slowSubregimeFactors?.slow_subregime_state?.value;
const csEventRiskScoped = isCallCreditSpreadEventRiskScoped({
    preCrisisActive: csPreCrisisActive,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    scope: params.csPreCrisisEventScope,
});
const qqqROC5ForCapRelease = indicators.require<number>('qqq_roc5').value;
const capReleasePosterior = slowSubregimeState === 'SR01'
    ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr01?.value
    : slowSubregimeState === 'SR02'
        ? ctx.input.slowSubregimeFactors?.slow_subregime_posterior_sr02?.value
        : undefined;
const capReleaseMinVix = params.csPreCrisisCapReleaseMinVix ?? 15;
const capReleaseMinQqqRoc5 = params.csPreCrisisCapReleaseMinQqqRoc5 ?? 0;
const capReleaseMinPosterior = params.csPreCrisisCapReleaseMinPosterior;
const csPreCrisisCapQualityReleased = csEventRiskScoped
    && params.csPreCrisisCapReleaseMode === 'second_entry_quality_v1'
    && params.csPreCrisisMaxEntriesInWindow === 1
    && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) === 1
    && ((slowSubregimeState === 'SR01' && regime === 'RISK_ON_WEAKENING' && vix >= capReleaseMinVix
        && (capReleaseMinPosterior === undefined || (typeof capReleasePosterior === 'number' && capReleasePosterior >= capReleaseMinPosterior)))
        || (slowSubregimeState === 'SR02' && regime === 'BULL' && qqqROC5ForCapRelease >= capReleaseMinQqqRoc5));
const csEventRiskBlocked = csEventRiskScoped
    && params.csPreCrisisMaxEntriesInWindow !== undefined
    && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) >= params.csPreCrisisMaxEntriesInWindow
    && !csPreCrisisCapQualityReleased;
const csSecondaryEventRiskScoped = isCallCreditSpreadEventRiskScoped({
    preCrisisActive: csPreCrisisActive,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    scope: params.csSecondaryEventRiskScope ?? 'all',
});
const csSecondaryRiskBlocked = csSecondaryEventRiskScoped
    && params.csSecondaryMaxEntriesInWindow !== undefined
    && (ctx.input.csSecondaryEventRiskState?.entriesInWindow ?? 0) >= params.csSecondaryMaxEntriesInWindow;
const qqqROC5 = indicators.require<number>('qqq_roc5').value;
const qqqROC5Previous = prices.QQQ.length >= 7
    ? prices.QQQ.at(-2)!.close / prices.QQQ.at(-7)!.close - 1
    : undefined;
const qqqROC5Slope = Number.isFinite(qqqROC5Previous) ? qqqROC5 - qqqROC5Previous! : undefined;
// EB2 melt_up entry mode: fixed 60d window, regime-independent (unlike the collar's drawdownPct above).
// Keep the legacy chain spot denominator; it can differ from the latest QQQ close.
const qqqROC20 = indicators.require<number>('qqq_roc20').value;
const csSecondaryQqqRoc20Blocked = params.csSecondaryQqqRoc20Max !== undefined
    && Number.isFinite(params.csSecondaryQqqRoc20Max)
    && qqqROC20 > params.csSecondaryQqqRoc20Max;
const csBreachGate = params.csBreachGate;
if (csBreachState && csBreachState.active) {
    csBreachState = releaseCallCreditSpreadBreach(csBreachState, csBreachGate, spot, qqqROC5, tqqqROC20);
}
const collarBlocksOtherOverlays = params.collarInteractionMode !== 'non_blocking';
const { pendingCollarHasShortCall, hasOnlyPutSpreadProtection, pendingPutSpreadProtection } = resolveCollarProxyExclusions({
    collarTriggered: collar_triggered,
    allowShortCall,
    hasOpenCollar,
    hasOpenCollarShortCall,
    blocksOtherOverlays: collarBlocksOtherOverlays,
});
const raw_call_spread_triggered = false;
const csExtensionGate = resolveCallCreditSpreadExtensionGate({ mode: csMode, regime, vix, tqqqRoc20: tqqqROC20, explicitGate: params.csExtensionGate, baseGate: params.csSpLikeExtensionGate, dynamicCalmVix: params.csSpLikeDynamicCalmVix, dynamicCalmRoc20: params.csSpLikeDynamicCalmRoc20, dynamicCalmGate: params.csSpLikeDynamicCalmExtensionGate });
const priceExtensionAtr = regimeData?.price_extension_atr;
const csExtensionBlocked = isCallCreditSpreadExtensionBlocked(raw_call_spread_triggered, priceExtensionAtr, csExtensionGate);
const csEntryBlocked = ctx.input.csEntryBlocked === true;
const csValidatedSafeReleased = false;
const csExtensionFinalBlocked = csExtensionBlocked && !csValidatedSafeReleased;
const call_spread_triggered = false;
// 旧独立副层只补主层预危机 cap1 的阻断日；保留兼容，不作为新方案主体。
const call_spread_secondary_triggered = false;
let call_spread_coverage_triggered = false;
if (csExtensionFinalBlocked) {
    warnings.push(`CS extension gate：priceExtensionAtr=${priceExtensionAtr!.toFixed(2)} >= ${csExtensionGate!.toFixed(2)}，跳过新开 Call Spread`);
}
if (csEntryBlocked) {
    warnings.push('CS 研究回放闸：逐日阻断新开 Call Spread');
}
if (csSecondaryQqqRoc20Blocked) {
    warnings.push(`CS 独立副层 QQQ ROC20 闸：${(qqqROC20 * 100).toFixed(1)}% > ${((params.csSecondaryQqqRoc20Max ?? 0) * 100).toFixed(1)}%，跳过副层新开`);
}
if (csEventRiskBlocked) {
    warnings.push(call_spread_secondary_triggered
        ? `CS 主层预危机 cap1：窗口内已开 ${ctx.input.csEventRiskState?.entriesInWindow ?? 0} 笔，转交独立副层`
        : `CS 预危机事件缩放：窗口内已开 ${ctx.input.csEventRiskState?.entriesInWindow ?? 0} 笔，达到上限 ${params.csPreCrisisMaxEntriesInWindow}，跳过新开`);
}
if (csPreCrisisCapQualityReleased && (ctx.input.csEventRiskState?.entriesInWindow ?? 0) >= 1) {
    warnings.push(`CS 预危机 cap1 质量释放：regime=${regime}，SR=${slowSubregimeState ?? 'n/a'}，VIX=${vix.toFixed(1)}，ROC5=${(qqqROC5ForCapRelease * 100).toFixed(1)}%`);
}
const pcsSafetyConditionsMet = false;
const pcsReactiveV1Backtest = params.pcsStockDecisionFilterMode === 'reactive_pcs_v1';
const pcsReactiveTiming = pcsReactiveV1Backtest
    ? explainReactivePcsTiming({
        symbol: proxySymbol,
        regime,
        vix: macro.vix ?? Number.NaN,
        crisisPhase: regimeData?.crisisPhase,
        vix3m: macro.vix3m ?? Number.NaN,
    })
    : undefined;
const pcsResearchProfile = params.pcsResearchProfile;
const isCandidateARescueProfile = pcsResearchProfile === 'candidateARescue';
const isCandidateAProfile = pcsResearchProfile === 'candidateA' || isCandidateARescueProfile;
const pcsOriginalSignal = false;
// persist 门：raw 信号已连续出现 N 日（streak 不含当日）才放行——评分事件驱动，冲击日首日不接
const { raw: pcsPageSignalRaw, triggered: pcsPageSignal } = { raw: false, triggered: false };
const pcsExcludedByRiskOnWeakening = params.pcsExcludeRiskOnWeakening === true && regime === 'RISK_ON_WEAKENING';
const pcsChopVixBlocked = isPcsChopVixGateBlocked({
    enabled: params.pcsChopVixGate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
});
const pcsBass221Blocked = isPcsBass221GateBlocked({
    enabled: params.pcsBass221Gate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
});
const pcsV11Blocked = isPcsV11GateBlocked({
    enabled: params.pcsV11Gate === true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
});
const pcsV12Blocked = isPcsV12GateBlocked({
    enabled: params.pcsV12Gate === true,
    v11ReleaseMode: params.pcsV11ReleaseMode,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
});
const pcsBass232Candidate2Blocked = isPcsBass232Candidate2GateBlocked({
    enabled: params.pcsBass232Candidate2Gate === true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
});
const pcsBass232Candidate3Blocked = isPcsBass232Candidate3GateBlocked({
    enabled: params.pcsBass232Candidate3Gate === true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
});
const pcsEntryBlocked = ctx.input.pcsEntryBlocked === true;
const pcsNativeP1R1EntryBlocked = params.pcsNativeCandidateP1R1 === true && isPcsNativeP1R1EntryBlocked({
    enabled: true,
    regime,
    slowSubregime: slowSubregimeState,
    vix: regimeData?.vix ?? undefined,
    adx14: regimeData?.adx14 ?? undefined,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
    priceExtensionAtr: priceExtensionAtr ?? undefined,
    priorBullStressStreak: ctx.input.pcsResearchP1BullStressStreak,
    lastSettledPnl: ctx.input.pcsResearchP1LastSettledPnl,
    scope: params.pcsNativeP1R1Scope,
    scopes: params.pcsNativeP1R1Scopes,
});
const pcsNativeP1ResidualFilterBlocked = params.pcsNativeP1ResidualFilter === 'bullSr01HighAdxLowRv' && isPcsNativeP1ResidualFilterBlocked({
    enabled: true,
    regime,
    slowSubregime: slowSubregimeState,
    adx14: regimeData?.adx14,
    tqqqRealisedVol20d: tqqqRealisedVol20d ?? undefined,
});
const pcsCandidateAEntryBlocked = isCandidateAProfile && isPcsCandidateAEntryBlocked({
    enabled: true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
});
const pcsResearchEntryFilter = params.pcsResearchEntryFilter ?? 'off';
const pcsResearchEntryFilterBlocked = isPcsResearchEntryFilterBlocked({
    enabled: true,
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
}, pcsResearchEntryFilter);
const pcsV121StateBlocked = isPcsV12GateBlocked({
    enabled: params.pcsV121Gate === true,
    v11ReleaseMode: params.pcsV11ReleaseMode,
    // V1.2.1 的简化5研究口径使用状态引擎 VIX；独立 PCS 的本地 `vix` 可能是 VXN。
    vix: regimeData?.vix ?? vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: qqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
    roc5: qqqROC5,
    priceVsSma200Pct: regimeData?.price_vs_sma200_pct,
    weakeningSignalCount: regimeData?.weakening_signal_count,
});
// An explicitly supplied P4 profile is also callable from production.
// Defaults remain unchanged because production callers omit this field.
// The profile owner is responsible for carrying current-bar history and
// invoking its settlement callback after a real close.
const pcsDynamicEntryProfile = ctx.input.pcsDynamicEntryProfile;
const pcs_triggered = pcsDynamicEntryProfile
    ? !pcsEntryBlocked && pcsSafetyConditionsMet && !pcsStreakCooldownBlocked && (pcsOriginalSignal || pcsPageSignal || pcsReactiveTiming?.eligible === false || pcsV121StateBlocked)
    : !pcsExcludedByRiskOnWeakening && !pcsChopVixBlocked && !pcsBass221Blocked && !pcsV11Blocked && !pcsBass232Candidate2Blocked && !pcsBass232Candidate3Blocked && !pcsV12Blocked && !pcsEntryBlocked && !pcsNativeP1R1EntryBlocked && !pcsNativeP1ResidualFilterBlocked && !pcsCandidateAEntryBlocked && !pcsResearchEntryFilterBlocked && (pcsOriginalSignal || pcsPageSignal);
if (pcsExcludedByRiskOnWeakening) {
    warnings.push('PCS 研究闸：RISK_ON_WEAKENING 禁止新开');
}
if (pcsChopVixBlocked) {
    warnings.push('PCS 2.1.2 chop/VIX 闸：低 ADX + 高区间 + 价格扩张且 VIX<19，跳过新开');
}
if (pcsBass221Blocked) {
    warnings.push('PCS 2.2.1 研究闸：SR01/SR02/2018 型风险状态，跳过新开');
}
if (pcsV11Blocked) {
    warnings.push('PCS V1.1 闸：RISK_ON_WEAKENING 且回撤≥5%、ROC20<0，跳过新开');
}
if (pcsBass232Candidate2Blocked) {
    warnings.push('PCS 候选2闸：A-lite/B-lite/顶端延伸状态，跳过新开');
}
if (pcsBass232Candidate3Blocked) {
    warnings.push('PCS bass2.3.2 候选3闸：合并 SR01 趋势风险/B-lite/顶端延伸状态，跳过新开');
}
if (pcsV12Blocked) {
    warnings.push('PCS V1.2 Balanced-Tail 闸：L1/冲击/弱化尾部状态，跳过新开');
}
if (pcsEntryBlocked) {
    warnings.push('PCS 研究闸：逐日配置禁止新开');
}
if (pcsCandidateAEntryBlocked) {
    warnings.push('PCS v1.2.7b/P0 候选 A 基础风险盾牌阻断新开');
}
if (pcsResearchEntryFilterBlocked) {
    warnings.push(`PCS 研究胜率过滤闸：${pcsResearchEntryFilter} 阻断新开`);
}
if (csSecondaryRiskBlocked) {
    warnings.push(`CS 独立副层事件预算：窗口内已开 ${ctx.input.csSecondaryEventRiskState?.entriesInWindow ?? 0} 笔，达到上限 ${params.csSecondaryMaxEntriesInWindow}，跳过副层新开`);
}
const ebPriceVsSma200Pct = ctx.results.regime?.data.price_vs_sma200_pct;
const ebRiskOnWeakeningSr01VolGateBlocked = equityBoostRiskOnWeakeningSr01VolGateBlocked({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix: macro.vix,
    vxn: macro.vxn,
    vxnHistory: macro.vxnHistory,
    ratioCeiling: params.equityBoostRiskOnWeakeningSr01VxnVixRatioCeiling,
    requireVxn10dRising: params.equityBoostRiskOnWeakeningSr01RequireVxn10dRising,
});
const equityBoostBass221Blocked = params.equityBoostBass221Gate === true && isEquityBoostBass221GateBlocked({
    enabled: true,
    vix,
    adx14: regimeData?.adx14,
    range20dPct: regimeData?.range20d_pct,
    priceExtensionAtr,
    roc20: tqqqROC20,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    tqqqRealisedVol20d,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    rsi14: regimeData?.rsi14,
});
const equityBoostBass221VixReboundBlocked = isEquityBoostBass221VixReboundGateBlocked({
    enabled: params.equityBoostBass221VixReboundGate === true,
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    qqqRoc20: qqqROC20,
    qqqRoc5: qqqROC5,
    qqqRoc5Slope: qqqROC5Slope,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    vix,
    vix5dAgo: macro.vix5dAgo,
});
const equityBoostBass221SeverityActive = params.equityBoostBass221SeverityMultiplier !== undefined && isEquityBoostBass221SeverityActive({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    qqqRoc20: qqqROC20,
    qqqRoc5: qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    tqqqRealisedVol20d,
    range20dPct: regimeData?.range20d_pct,
});
const equityBoostCandidate6GateBlocked = params.equityBoostCandidate6Mdd === true && isEquityBoostCandidate6GateBlocked({
    regime,
    slowSubregime: typeof slowSubregimeState === 'string' ? slowSubregimeState : undefined,
    vix,
    adx14: regimeData?.adx14,
    priceVsSma200Pct: ebPriceVsSma200Pct,
    tqqqRealisedVol20d,
    tqqqRoc20: tqqqROC20,
    roc5: qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
});
const equityBoostRawSignal = false;
const equityBoostEntryGateBlocked = ctx.input.equityBoostEntryGate?.({
    date: ctx.input.date,
    regime,
    slowSubregime: slowSubregimeState,
    vix: macro.vix,
    vxn: macro.vxn,
    tqqqRealisedVol20d,
    qqqROC20: tqqqROC20,
    qqqROC5,
    drawdownFromRecentHighPct: regimeData?.drawdown_from_recent_high_pct,
    priceVsSma200Pct: ebPriceVsSma200Pct,
    adx14: regimeData?.adx14,
    priceExtensionAtr,
    vixChange5d: macro.vix5dAgo == null || macro.vix == null ? undefined : macro.vix - macro.vix5dAgo,
    rawSignal: equityBoostRawSignal,
}) ?? false;
const equity_boost_triggered = false;
// Mutual exclusion / new-strategy-priority: the new strategy blocks a fresh legacy PCS open
// the same bar it wants to open (handled by pcs_triggered reading hasOpenQQQPutSpread only —
// add the explicit "new strategy priority" suppression here so both can never fire together).
const { pcsTriggered: pcs_triggered_final } = resolvePutStrategyPriority(pcs_triggered, equity_boost_triggered);
const pcsRescueSourceActive = false;
if (equityBoostBass221Blocked) {
    warnings.push('Equity Boost 2.2.1 研究闸：BULL/SR01/SR02 + VIX/RV20/回撤/ROC20 条件，跳过新开');
}
if (equityBoostBass221VixReboundBlocked) {
    warnings.push('Equity Boost 2.2.1 候选闸：RANGE_BOUND/SR01 + VIX五日上涨 + ROC5短期转强，跳过新开');
}
if (equityBoostCandidate6GateBlocked) {
    warnings.push('Equity Boost 候选6-MDD核心闸：严格 B / micro / 高 VIX / 高位弱趋势状态，跳过新开');
}
if (equityBoostBass221SeverityActive) {
    warnings.push(`Equity Boost 2.2.1 严重度：RV20≥50%且20日区间≥6.5%，风险预算缩放${((params.equityBoostBass221SeverityMultiplier ?? 1) * 100).toFixed(0)}%`);
}
if (ebRiskOnWeakeningSr01VolGateBlocked) {
    warnings.push('QQQ Equity Boost：RISK_ON_WEAKENING/SR01 的 VXN/VIX 或 VXN 10 日上升闸未通过，跳过新开');
}
if (sellAlternativeScenario) {
    warnings.push(`${leveragedSymbol} 超仓 ${((actualLevPct - final_tqqq_pct) * 100).toFixed(1)}pp（实际 ${(actualLevPct * 100).toFixed(1)}% vs 目标 ${(final_tqqq_pct * 100).toFixed(1)}%），建议优先减仓；Collar 作为替代保护`);
}
if (pcs_triggered_final) {
    warnings.push(`TQQQ 近20天涨幅 ${(tqqqROC20 * 100).toFixed(1)}%，VIX=${vix.toFixed(1)}，${regime}，开 QQQ Put Credit Spread（proxyOverlay）`);
}
// ── Iron Condor trigger ───────────────────────────────────────────────────
const icMode = params.icMode;
const icCfg = IC_MODE_CONFIG[icMode];
const range20d = indicators.require<{
    high: number;
    low: number;
}>('qqq_range20').value;
const distToHigh = range20d.high > 0 ? (range20d.high - spot) / spot : 1;
const distToLow = range20d.low > 0 ? (spot - range20d.low) / spot : 1;
const tooCloseToTop = distToHigh < icCfg.edgePct;
const tooCloseToBottom = distToLow < icCfg.edgePct;
// SIDEWAYS only allowed when price is above SMA200 (avoid below-SMA200 SIDEWAYS)
const price_vs_sma200_pct = ctx.results.regime?.data.price_vs_sma200_pct ?? 0;
const iron_condor_triggered = false;
if (icCfg.regimes.includes(regime) && (tooCloseToTop || tooCloseToBottom)) {
    warnings.push(`${regime} 但 QQQ 距20日区间${tooCloseToTop ? '上沿' : '下沿'}仅 ${((tooCloseToTop ? distToHigh : distToLow) * 100).toFixed(1)}%，暂缓开 Iron Condor`);
}
// ── Bear Market Overlay trigger (BEAR_RALLY plus opt-in alternate modes) ─
// Priority: CRISIS/DataQuality/Regime gates → RiskBudget → Collar → RANGE_BOUND IC
// → BearCS → BULL overheat CS.
const bearCallCoordination = coordinateBearCallSpread({
    pendingCollarHasShortCall,
    hasOpenCollarShortCall,
    ironCondorTriggered: iron_condor_triggered,
    bearAction: bearOverlay.action,
});
if (bearCallCoordination.propagateWarnings) {
    warnings.push(...bearOverlay.warnings);
}
const bear_call_spread_triggered = bearCallCoordination.triggered;
const primaryAction = resolveOverlayActionPriority({
    collarTriggered: collar_triggered,
    ironCondorTriggered: iron_condor_triggered,
    bearCallSpreadTriggered: bear_call_spread_triggered,
    bearAction: bearOverlay.action,
    bearSkipEligible: ctx.results.regime?.data.bearMarketPhase === 'CRISIS',
    callSpreadTriggered: call_spread_triggered || call_spread_coverage_triggered,
    equityBoostTriggered: equity_boost_triggered,
    putSpreadTriggered: pcs_triggered_final,
    pcsRescueTriggered: pcsRescueSourceActive,
});
if (primaryAction === 'SKIP_BEAR_CALL_SPREAD')
    warnings.push(...bearOverlay.warnings);
if (pcsV121StateBlocked)
    warnings.push('PCS V1.2.1 简化5族闸：选腿后的生存率下限/Sigma未满足释放条件，跳过新开');
return finalizeOverlayCoordination({ data: { action: primaryAction, collar_triggered: false, call_spread_triggered: false,
        iron_condor_triggered: false, bear_call_spread_triggered: false, equity_boost_triggered: false,
        bearCallSpread: primaryAction === 'SKIP_BEAR_CALL_SPREAD' ? bearOverlay.bearCallSpread : undefined,
        csBreachState, csSecondaryEventRiskState: ctx.input.csSecondaryEventRiskState, pcsPageSignalRaw: false }, warnings, blockers });
}
