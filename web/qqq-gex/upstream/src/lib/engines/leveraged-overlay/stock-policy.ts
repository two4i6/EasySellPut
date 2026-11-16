import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { createDerivedFactor, createRawFactor, fallbackFactor, getFactorValue as getFV, isValidPriceSeries, isValidVix } from '../../factor';
import { calcSMA } from './utils';
import type { OHLCV } from './types/input';
import type { PipelineContext } from './types/pipeline';
import type { StockPhasePolicyId, StockPhasePolicyOverride, StockPhasePolicyRule, StockPhaseSignalGate } from './types/params';

export type DecisionPolicy<TId extends string, TOverrides> = {
  id: TId;
  overrides: Partial<TOverrides>;
  reasonKeys: string[];
};

export type LeveragedOverlayStockPolicyId =
  | 'CURRENT'
  | 'SLOW_BULL_GROWTH'
  | 'SLOW_BULL_SHOCK'
  | 'SLOW_BEAR_DEFENSE'
  | 'SLOW_BEAR_RECOVERY'
  | 'FLASH_CRASH';
export type LeveragedOverlayStockOverrides = StockPhasePolicyOverride;
export type LeveragedOverlayStockPolicy = DecisionPolicy<LeveragedOverlayStockPolicyId, LeveragedOverlayStockOverrides>;

export type LeveragedOverlayRiskInterpretation = {
  macroPhase: 'SLOW_BULL' | 'SLOW_BEAR';
  fastRegime: string;
  crisisPhase: string;
  flashCrashActive: boolean;
  roc5?: number;
  roc20?: number;
  er20?: number;
  sma20Slope?: number;
  vix?: number;
  vixTermRatio?: number;
  relativeRoc20?: number;
  relativeRoc60?: number;
  priceVsSma20?: number;
  priceVsSma50?: number;
};

function stockPhaseGatePasses(gate: StockPhaseSignalGate | undefined, risk: LeveragedOverlayRiskInterpretation, factors: FactorMap): boolean {
  if (!gate) return true;
  const slowSubregime = factors.slow_subregime_state;
  const slowSubregimeHealth = factors.slow_subregime_data_health;
  const slowSubregimePosterior = slowSubregime?.value === 'SR01'
    ? factors.slow_subregime_posterior_sr01
    : slowSubregime?.value === 'SR02' ? factors.slow_subregime_posterior_sr02 : undefined;
  const slowSubregimeIn = gate.slowSubregimeIn;
  const slowSubregimeDataValid = slowSubregime != null
    && slowSubregime.confidence > 0
    && slowSubregimeHealth != null
    && slowSubregimeHealth.value !== 'STALE_OR_MISSING';
  const primarySlowSubregimeMatch = slowSubregimeIn == null || (
    slowSubregimeDataValid
    && Array.isArray(slowSubregimeIn)
    && slowSubregimeIn.includes(slowSubregime!.value as 'SR01' | 'SR02')
  );
  const conditionalSlowSubregimeMatch = slowSubregimeDataValid
    && gate.slowSubregimeConditionalFastRegimeIn?.[slowSubregime!.value as 'SR01' | 'SR02']?.includes(risk.fastRegime) === true;
  const conditionalGate = slowSubregime?.value == null
    ? undefined
    : gate.slowSubregimeConditionalGate?.[slowSubregime.value as 'SR01' | 'SR02'];
  return (gate.fastRegimeIn == null || gate.fastRegimeIn.includes(risk.fastRegime))
    && (conditionalGate?.roc5Min == null ? gate.roc5Min == null || (risk.roc5 != null && risk.roc5 >= gate.roc5Min) : (risk.roc5 != null && risk.roc5 >= conditionalGate.roc5Min))
    && (conditionalGate?.er20Min == null || (risk.er20 != null && risk.er20 >= conditionalGate.er20Min))
    && (gate.roc20Min == null || (risk.roc20 != null && risk.roc20 >= gate.roc20Min))
    && (conditionalGate?.sma20SlopeMin == null ? gate.sma20SlopeMin == null || (risk.sma20Slope != null && risk.sma20Slope >= gate.sma20SlopeMin) : (risk.sma20Slope != null && risk.sma20Slope >= conditionalGate.sma20SlopeMin))
    && (conditionalGate?.vixMax == null ? gate.vixMax == null || (risk.vix != null && risk.vix <= gate.vixMax) : (risk.vix != null && risk.vix <= conditionalGate.vixMax))
    && (gate.vixMin == null || (risk.vix != null && risk.vix >= gate.vixMin))
    && (gate.vixTermMin == null || (risk.vixTermRatio != null && risk.vixTermRatio >= gate.vixTermMin))
    && (gate.vixTermMax == null || (risk.vixTermRatio != null && risk.vixTermRatio <= gate.vixTermMax))
    && (gate.relativeRoc20Min == null || (risk.relativeRoc20 != null && risk.relativeRoc20 >= gate.relativeRoc20Min))
    && (gate.relativeRoc60Min == null || (risk.relativeRoc60 != null && risk.relativeRoc60 >= gate.relativeRoc60Min))
    && ((conditionalGate?.aboveSma20 ?? gate.aboveSma20) !== true || (risk.priceVsSma20 != null && risk.priceVsSma20 >= 0))
    && (conditionalGate?.aboveSma50 !== true || (risk.priceVsSma50 != null && risk.priceVsSma50 >= 0))
    && (gate.aboveSma50 !== true || (risk.priceVsSma50 != null && risk.priceVsSma50 >= 0))
    && (primarySlowSubregimeMatch || conditionalSlowSubregimeMatch)
    && (gate.slowSubregimePosteriorMin == null || (
      slowSubregime != null
      && slowSubregime.confidence > 0
      && slowSubregimeHealth != null
      && slowSubregimeHealth.value !== 'STALE_OR_MISSING'
      && slowSubregimePosterior != null
      && slowSubregimePosterior.confidence > 0
      && typeof slowSubregimePosterior.value === 'number'
      && slowSubregimePosterior.value >= gate.slowSubregimePosteriorMin
    ));
}

function stockPhaseConditionalOverrides(gate: StockPhaseSignalGate | undefined, slowSubregime: string | undefined): Partial<StockPhasePolicyOverride> {
  if (slowSubregime !== 'SR01' && slowSubregime !== 'SR02') return {};
  return gate?.slowSubregimeConditionalOverrides?.[slowSubregime] ?? {};
}

export function getLeveragedOverlayRisk(factors: FactorMap): FinancialFactor<LeveragedOverlayRiskInterpretation> {
  const macro = factors.overlay_macro_phase;
  if (!macro || macro.confidence === 0 || (macro.value !== 'SLOW_BULL' && macro.value !== 'SLOW_BEAR')) {
    return fallbackFactor(
      { macroPhase: 'SLOW_BULL', fastRegime: 'UNKNOWN', crisisPhase: 'NONE', flashCrashActive: false },
      macro?.source.type === 'fallback' ? macro.source.reason : 'macro regime 缺失或无效',
    );
  }

  const optional = (factorId: string) => factors[factorId]?.confidence > 0
    ? getFV<number>(factors, factorId)
    : undefined;
  const inputIds = [
    'overlay_macro_phase', 'overlay_fast_regime', 'overlay_crisis_phase', 'overlay_flash_crash_active',
    'overlay_qqq_roc5', 'overlay_qqq_roc20', 'overlay_qqq_sma20_slope', 'overlay_vix',
    'overlay_vix_term_ratio', 'overlay_qqq_spy_roc20', 'overlay_qqq_spy_roc60',
    'overlay_qqq_vs_sma20', 'overlay_qqq_vs_sma50',
  ].filter(id => factors[id]?.confidence > 0);
  const result = createDerivedFactor(
    {
      macroPhase: macro.value,
      fastRegime: getFV<string>(factors, 'overlay_fast_regime') ?? 'UNKNOWN',
      crisisPhase: getFV<string>(factors, 'overlay_crisis_phase') ?? 'NONE',
      flashCrashActive: getFV<boolean>(factors, 'overlay_flash_crash_active') === true,
      roc5: optional('overlay_qqq_roc5'),
      roc20: optional('overlay_qqq_roc20'),
      er20: optional('overlay_qqq_er20'),
      sma20Slope: optional('overlay_qqq_sma20_slope'),
      vix: optional('overlay_vix'),
      vixTermRatio: optional('overlay_vix_term_ratio'),
      relativeRoc20: optional('overlay_qqq_spy_roc20'),
      relativeRoc60: optional('overlay_qqq_spy_roc60'),
      priceVsSma20: optional('overlay_qqq_vs_sma20'),
      priceVsSma50: optional('overlay_qqq_vs_sma50'),
    },
    inputIds.map(factorId => ({ factorId, weight: 1 / inputIds.length })),
    factors,
  );
  result.logicReason = '解释 leveraged-overlay 慢端、快端与危机状态，不直接生成订单';
  return result;
}

export function getLeveragedOverlayStockPolicy(
  factors: FactorMap,
  risk: FinancialFactor<LeveragedOverlayRiskInterpretation> = getLeveragedOverlayRisk(factors),
): FinancialFactor<LeveragedOverlayStockPolicy> {
  factors.overlay_risk_interpretation = risk;
  const enabled = getFV<boolean>(factors, 'overlay_stock_policy_enabled') === true;
  const driver = getFV<string>(factors, 'overlay_macro_execution_driver') ?? 'slow-macro';
  const slowSubregime = getFV<string>(factors, 'slow_subregime_state');
  const profile = getFV<Partial<Record<StockPhasePolicyId, StockPhasePolicyRule>>>(factors, 'overlay_stock_phase_policy') ?? {};
  let value: LeveragedOverlayStockPolicy = {
    id: 'CURRENT',
    overrides: {},
    reasonKeys: ['stock_policy_disabled'],
  };

  if (driver === 'none') {
    value = { id: 'CURRENT', overrides: {}, reasonKeys: ['stock_policy_disabled'] };
  } else if (enabled && getFV<boolean>(factors, 'overlay_flash_crash_active') === true) {
    value = {
      id: 'FLASH_CRASH',
      // 既有 OrderProposal 已强制 hardmax；policy 只解释优先级，不改变 flash 行为。
      overrides: {},
      reasonKeys: ['flash_crash_priority'],
    };
  } else if (risk.source.type === 'fallback') {
    return fallbackFactor(
      { id: 'CURRENT', overrides: {}, reasonKeys: [driver === 'slow-subregime' ? 'sr_fallback_current' : 'macro_regime_unavailable'] },
      risk.source.reason,
    );
  } else if (enabled && driver === 'slow-subregime') {
    if (slowSubregime === 'SR02' && risk.value.fastRegime !== 'CRISIS' && risk.value.crisisPhase !== 'PENDING' && risk.value.crisisPhase !== 'CONFIRMED') {
      const rule = profile.SLOW_BULL_GROWTH;
      const pass = stockPhaseGatePasses(rule?.gate, risk.value, factors);
      value = { id: 'SLOW_BULL_GROWTH', overrides: pass ? { ...rule?.overrides, ...stockPhaseConditionalOverrides(rule?.gate, slowSubregime) } : {}, reasonKeys: [pass ? 'sr02_slow_bull_growth_active' : 'sr02_growth_gate_blocked'] };
    } else {
      value = { id: 'CURRENT', overrides: {}, reasonKeys: [slowSubregime === 'SR01' ? 'sr01_current' : 'sr02_risk_priority_current'] };
    }
  } else if (enabled) {
    const id: StockPhasePolicyId = risk.value.macroPhase === 'SLOW_BULL'
      ? (risk.value.crisisPhase === 'PENDING' || risk.value.crisisPhase === 'CONFIRMED' ? 'SLOW_BULL_SHOCK' : 'SLOW_BULL_GROWTH')
      : (risk.value.fastRegime === 'BEAR' || risk.value.fastRegime === 'CRISIS' ? 'SLOW_BEAR_DEFENSE' : 'SLOW_BEAR_RECOVERY');
    const rule = profile[id];
    const pass = stockPhaseGatePasses(rule?.gate, risk.value, factors);
    value = { id, overrides: pass ? { ...rule?.overrides, ...stockPhaseConditionalOverrides(rule?.gate, slowSubregime) } : {}, reasonKeys: [pass ? `${id.toLowerCase()}_active` : `${id.toLowerCase()}_gate_blocked`] };
  }

  if (value.id === 'SLOW_BULL_GROWTH' && getFV<boolean>(factors, 'overlay_stock_growth_eligible') === false) {
    return createDerivedFactor(
      { id: 'CURRENT', overrides: {}, reasonKeys: ['stock_growth_research_blocked'] },
      [
        { factorId: 'overlay_stock_policy_enabled', weight: 0.2 },
        { factorId: 'overlay_risk_interpretation', weight: 0.6 },
        { factorId: 'overlay_stock_growth_eligible', weight: 0.2 },
      ],
      factors,
    );
  }

  const recoveryBoostPct = getFV<number>(factors, 'overlay_stock_recovery_boost_pct') ?? 0;
  if (value.id === 'SLOW_BULL_GROWTH' && recoveryBoostPct > 0 && risk.value.crisisPhase === 'NONE' && risk.value.fastRegime !== 'BEAR' && risk.value.fastRegime !== 'CRISIS') {
    value = { ...value, overrides: { ...value.overrides, recoveryBoostPct }, reasonKeys: [...value.reasonKeys, 'recovery_bounded_boost_active'] };
  }

  return createDerivedFactor(value, [
    { factorId: 'overlay_stock_policy_enabled', weight: 0.2 },
    { factorId: 'overlay_risk_interpretation', weight: 0.7 },
    { factorId: 'overlay_stock_recovery_boost_pct', weight: 0.1 },
  ], factors);
}

const MACRO_PHASES = new Set(['SLOW_BULL', 'SLOW_BEAR']);
const FAST_REGIMES = new Set(['BULL', 'RISK_ON_EXTENDED', 'RISK_ON_WEAKENING', 'SIDEWAYS', 'BEAR', 'CRISIS', 'RANGE_BOUND']);
const CRISIS_PHASES = new Set(['NONE', 'PENDING', 'CONFIRMED', 'RECOVERY']);

export type AppendOnlyPriceSeriesValidationCache = WeakMap<OHLCV[], { length: number; valid: boolean }>;

/** Validate only the appended suffix of a replay-owned, append-only series. */
export function isValidAppendOnlyPriceSeries(
  bars: OHLCV[],
  cache: AppendOnlyPriceSeriesValidationCache,
): boolean {
  let state = cache.get(bars);
  if (!state || state.length > bars.length) state = { length: 0, valid: true };
  let valid = state.valid;
  for (let index = state.length; index < bars.length; index += 1) {
    const bar = bars[index];
    valid = valid && !!bar && typeof bar.date === 'string' && typeof bar.close === 'number' && bar.close > 0;
  }
  cache.set(bars, { length: bars.length, valid });
  return bars.length > 0 && valid;
}

const closes = (bars: OHLCV[]) => bars.map(bar => bar.close);
const roc = (bars: OHLCV[], period: number) => bars.length > period ? bars.at(-1)!.close / bars.at(-1 - period)!.close - 1 : undefined;
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator - 1 : undefined;

function derived(
  factors: FactorMap,
  factorIds: string[],
  value: () => number | boolean | undefined,
  reason: string,
): FinancialFactor<number | boolean> {
  if (factorIds.some(id => !factors[id] || factors[id]!.confidence === 0)) return fallbackFactor(0, reason);
  const result = value();
  if (result == null || !Number.isFinite(Number(result))) return fallbackFactor(0, reason);
  return createDerivedFactor(result, factorIds.map(factorId => ({ factorId, weight: 1 / factorIds.length })), factors);
}

export function buildLeveragedOverlayFactorMap(
  ctx: PipelineContext,
  validationCache?: AppendOnlyPriceSeriesValidationCache,
): FactorMap {
  const qqq = ctx.input.prices.QQQ;
  const qqqTail = qqq.slice(-205);
  const qqqTailCloses = closes(qqqTail);
  const latestQqqDate = qqq.at(-1)?.date;
  const spyInput = ctx.input.prices.SPY ?? [];
  const inputLatestSpyDate = spyInput.at(-1)?.date;
  const spy = !latestQqqDate || !inputLatestSpyDate || inputLatestSpyDate <= latestQqqDate
    ? spyInput
    : spyInput.filter(bar => bar.date <= latestQqqDate);
  const latestSpyDate = spy.at(-1)?.date;
  let spyLag = Infinity;
  if (latestSpyDate) {
    let low = 0;
    let high = qqq.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (qqq[middle]!.date <= latestSpyDate) low = middle + 1;
      else high = middle;
    }
    spyLag = qqq.length - low;
  }
  const isValidHistory = (bars: OHLCV[]) => validationCache
    ? isValidAppendOnlyPriceSeries(bars, validationCache)
    : isValidPriceSeries(bars);
  const validSpy = isValidHistory(spy) && spyLag <= 3;
  const vix = ctx.input.macro.vix;
  const vix3m = ctx.input.macro.vix3m;
  const vix5dAgo = ctx.input.macro.vix5dAgo;
  const driver = ctx.input.macroExecutionDriver ?? 'slow-macro';
  const factors: FactorMap = {
    ...(ctx.input.slowSubregimeFactors ?? {}),
    overlay_qqq_prices: createRawFactor(qqq, isValidHistory, 'leveraged-overlay:QQQ.history', undefined, []),
    overlay_spy_prices: validSpy
      ? createRawFactor(spy, isValidHistory, 'leveraged-overlay:SPY.history', undefined, [])
      : fallbackFactor([], `SPY 历史${spy.length === 0 ? '缺失' : `落后 ${spyLag} 个交易日或无效`}`),
    overlay_vix: createRawFactor(vix ?? 0, isValidVix, 'leveraged-overlay:VIX', undefined, 20),
    overlay_vix_5d_ago: createRawFactor(vix5dAgo ?? 0, isValidVix, 'leveraged-overlay:VIX[-5]', undefined, 20),
    overlay_vix3m: createRawFactor(vix3m ?? 0, isValidVix, 'leveraged-overlay:VIX3M', undefined, 20),
    overlay_stock_policy_enabled: {
      value: !!ctx.input.strategyParams?.macroRegime && ctx.input.strategyParams.stockMacroPolicyEnabled !== false,
      confidence: 7,
      source: { type: 'manual', description: '配置 Macro Regime Classifier 时启用；false 仅供研究 CURRENT 基线' },
    },
    overlay_macro_classifier: {
      value: driver === 'slow-subregime' ? 'slow-subregime' : ctx.input.strategyParams?.macroRegime?.classifier ?? 'm0b',
      confidence: 7,
      source: { type: 'manual', description: '用户选择或生产默认 macro classifier' },
    },
    overlay_macro_execution_driver: {
      value: driver,
      confidence: 7,
      source: { type: 'manual', description: '唯一允许影响执行决策的慢端 driver' },
    },
    overlay_stock_phase_policy: {
      value: ctx.input.strategyParams?.stockPhasePolicy ?? {},
      confidence: 7,
      source: { type: 'manual', description: '固定快照搜索通过后写入 preset 的 phase policy winner' },
    },
    overlay_stock_growth_eligible: {
      value: ctx.input.stockGrowthEligible !== false,
      confidence: 7,
      source: { type: 'manual', description: '研究 replay 的因果 Growth eligibility；生产固定为 true' },
    },
    overlay_stock_recovery_boost_pct: {
      value: Math.max(0, Math.min(.10, ctx.input.stockRecoveryBoostPct ?? 0)),
      confidence: 7,
      source: { type: 'manual', description: '研究 replay 的 Recovery bounded boost；省略时为 0，绝不进入生产 RunSpec' },
    },
  };

  factors.overlay_qqq_roc5 = derived(factors, ['overlay_qqq_prices'], () => roc(qqq, 5), 'QQQ ROC5 依赖不足');
  factors.overlay_qqq_roc20 = derived(factors, ['overlay_qqq_prices'], () => roc(qqq, 20), 'QQQ ROC20 依赖不足');
  factors.overlay_qqq_sma20_slope = derived(factors, ['overlay_qqq_prices'], () => {
    const now = calcSMA(qqqTailCloses, 20);
    const prior = calcSMA(qqqTailCloses.slice(0, -5), 20);
    return ratio(now, prior);
  }, 'QQQ SMA20 slope 依赖不足');
  factors.overlay_qqq_er20 = derived(factors, ['overlay_qqq_prices'], () => {
    if (qqq.length < 21) return undefined;
    const window = qqq.slice(-21);
    const path = window.slice(1).reduce((sum, bar, index) => sum + Math.abs(bar.close - window[index]!.close), 0);
    return path > 0 ? Math.abs(window.at(-1)!.close - window[0]!.close) / path : 0;
  }, 'QQQ ER20 依赖不足');
  for (const period of [20, 50, 200] as const) {
    factors[`overlay_qqq_vs_sma${period}`] = derived(factors, ['overlay_qqq_prices'], () => ratio(qqq.at(-1)?.close ?? 0, calcSMA(qqqTailCloses, period)), `QQQ SMA${period} 依赖不足`);
  }
  factors.overlay_qqq_drawdown_60d = derived(factors, ['overlay_qqq_prices'], () => {
    const window = qqq.slice(-60);
    const high = Math.max(...window.map(bar => bar.high));
    return high > 0 ? (qqq.at(-1)!.close - high) / high : undefined;
  }, 'QQQ 近期高点回撤依赖不足');
  factors.overlay_vix_change5 = derived(factors, ['overlay_vix', 'overlay_vix_5d_ago'], () => ratio(vix ?? 0, vix5dAgo ?? 0), 'VIX 5日变化依赖不足');
  factors.overlay_vix_term_ratio = derived(factors, ['overlay_vix', 'overlay_vix3m'], () => (vix3m ?? 0) > 0 ? (vix ?? 0) / vix3m! : undefined, 'VIX/VIX3M 依赖不足');
  factors.overlay_qqq_spy_roc20 = derived(factors, ['overlay_qqq_prices', 'overlay_spy_prices'], () => {
    const q = roc(qqq, 20), s = roc(spy, 20);
    return q == null || s == null ? undefined : q - s;
  }, 'QQQ/SPY ROC20 依赖缺失、无效或 stale');
  factors.overlay_qqq_spy_roc60 = derived(factors, ['overlay_qqq_prices', 'overlay_spy_prices'], () => {
    const q = roc(qqq, 60), s = roc(spy, 60);
    return q == null || s == null ? undefined : q - s;
  }, 'QQQ/SPY ROC60 依赖缺失、无效或 stale');

  const stateInputs = [{ factorId: 'overlay_qqq_prices', weight: 1 }];
  const macroPhase = ctx.input.macroRegimeState?.phase;
  const slowSubregime = factors.slow_subregime_state;
  factors.overlay_macro_phase = driver === 'slow-subregime'
    ? slowSubregime?.confidence > 0 && (slowSubregime.value === 'SR01' || slowSubregime.value === 'SR02')
      ? createDerivedFactor(slowSubregime.value === 'SR02' ? 'SLOW_BULL' : 'SLOW_BEAR', [{ factorId: 'slow_subregime_state', weight: 1 }], factors)
      : fallbackFactor('UNKNOWN', 'slow-subregime 缺失、stale 或无效')
    : MACRO_PHASES.has(macroPhase ?? '')
      ? createDerivedFactor(macroPhase, stateInputs, factors)
      : fallbackFactor('UNKNOWN', 'macro regime 缺失或无效');
  const fastRegime = ctx.results.regime?.data.regime;
  factors.overlay_fast_regime = FAST_REGIMES.has(fastRegime ?? '')
    ? createDerivedFactor(fastRegime, stateInputs, factors)
    : fallbackFactor('UNKNOWN', 'fast regime 缺失或无效');
  const crisisPhase = ctx.results.regime?.data.crisisPhase ?? ctx.input.crisisPhase ?? 'NONE';
  factors.overlay_crisis_phase = CRISIS_PHASES.has(crisisPhase)
    ? createDerivedFactor(crisisPhase, stateInputs, factors)
    : fallbackFactor('NONE', 'crisis phase 无效');
  factors.overlay_flash_crash_active = createDerivedFactor(ctx.currentFlashCrashState?.active === true, stateInputs, factors);
  return factors;
}
