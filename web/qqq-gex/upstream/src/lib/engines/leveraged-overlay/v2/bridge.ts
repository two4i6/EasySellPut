import type { PipelineContext } from '../types/pipeline';
import { createDerivedFactor, createRawFactor } from '../../../factor';
import type { FactorMap, FinancialFactor } from '../../../../types/factor';
import { OverlayIndicatorCatalog } from './indicators';
import { getOverlayUniverse } from '../universe';

/** 旧 Pipeline 接入 v2 指标目录的窄桥；策略决策仍由原唯一主链执行。 */
export function createOverlayIndicatorCatalog(ctx: PipelineContext): OverlayIndicatorCatalog {
  const universe = getOverlayUniverse(ctx.input.universeId);
  return new OverlayIndicatorCatalog({
    qqqBars: ctx.input.prices.QQQ,
    tqqqBars: ctx.input.prices.TQQQ,
    signalSymbol: universe.signalSymbol,
    leveragedSymbol: universe.leveragedSymbol,
    primaryVolatility: universe.primaryVolatility,
    vix: universe.primaryVolatility === 'VXN' ? (ctx.input.macro.vxn ?? ctx.input.macro.vix) : ctx.input.macro.vix,
    vix3m: ctx.input.macro.vix3m,
    precomputed: ctx.input.precomputedIndicators,
  });
}

/** Trace 只暴露当前日期的扁平 FactorMap，不在 bridge 保存跨日状态。 */
export function createOverlayTraceData(ctx: PipelineContext, indicators: OverlayIndicatorCatalog): { indicatorFactors?: FactorMap } {
  if (!ctx.input.trace) return {};
  indicators.prewarm(['qqq_price', 'tqqq_price', 'qqq_roc5', 'tqqq_roc20', 'qqq_rv20', 'vix', 'vix3m']);
  // NASDAQ Overlay 的主波动率是 VXN；PCS reactive-v1 则明确使用 VIX/VIX3M。
  // 因此 trace 需要保留这两个原始输入，历史资格不能借用主波动率代理。
  return {
    indicatorFactors: {
      ...indicators.factors,
      pcs_replay_vix: createRawFactor(ctx.input.macro.vix ?? 0, (value) => Number.isFinite(value) && value > 0, 'overlay-market-data', 'PCS reactive VIX'),
      pcs_replay_vix3m: createRawFactor(ctx.input.macro.vix3m ?? 0, (value) => Number.isFinite(value) && value > 0, 'overlay-market-data', 'PCS reactive VIX3M'),
    },
  };
}

export type OverlayExposure = {
  leveragedSymbol: string;
  factors: FactorMap;
  nav: FinancialFactor<number>;
  actualLeveragedValue: FinancialFactor<number>;
  targetLeveragedPct: FinancialFactor<number>;
  actualLeveragedPct: FinancialFactor<number>;
  effectiveLeveragedPct: FinancialFactor<number>;
};

/** 账户暴露在 bridge 中一次性转为扁平因子；不保存跨请求状态。 */
export function createOverlayExposure(ctx: PipelineContext): OverlayExposure {
  const leveragedSymbol = ctx.input.leveragedSymbol ?? 'TQQQ';
  const actualPosition = ctx.input.account.positions.find((position) => position.symbol === leveragedSymbol);
  const factors: FactorMap = {
    overlay_nav: createRawFactor(ctx.input.account.netLiquidation, (value) => Number.isFinite(value) && value >= 0, 'overlay-account', '账户 NAV'),
    overlay_actual_leveraged_value: createRawFactor(actualPosition?.marketValue ?? 0, (value) => Number.isFinite(value) && value >= 0, 'overlay-account', '杠杆标的市值'),
    overlay_target_leveraged_pct: createRawFactor(ctx.results.riskBudget?.data.final_tqqq_pct ?? 0, (value) => Number.isFinite(value) && value >= 0, 'risk-budget', '目标杠杆权重'),
  };
  const nav = factors.overlay_nav as FinancialFactor<number>;
  const actualLeveragedValue = factors.overlay_actual_leveraged_value as FinancialFactor<number>;
  const targetLeveragedPct = factors.overlay_target_leveraged_pct as FinancialFactor<number>;
  const actualLeveragedPct = createDerivedFactor(nav.value > 0 ? actualLeveragedValue.value / nav.value : 0, [{ factorId: 'overlay_nav', weight: .5 }, { factorId: 'overlay_actual_leveraged_value', weight: .5 }], factors);
  factors.overlay_actual_leveraged_pct = actualLeveragedPct;
  const effectiveLeveragedPct = createDerivedFactor(Math.max(targetLeveragedPct.value, actualLeveragedPct.value), [{ factorId: 'overlay_target_leveraged_pct', weight: .5 }, { factorId: 'overlay_actual_leveraged_pct', weight: .5 }], factors);
  factors.overlay_effective_leveraged_pct = effectiveLeveragedPct;
  return { leveragedSymbol, factors, nav, actualLeveragedValue, targetLeveragedPct, actualLeveragedPct, effectiveLeveragedPct };
}
