import type { PipelineContext, EngineResult, HardRiskData } from '../types/pipeline';
import { DEFAULT_STRATEGY_PARAMS } from '../types/params';

export function runHardRiskRules(ctx: PipelineContext): EngineResult<HardRiskData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;

  const { account } = ctx.input;
  const { netLiquidation, positions } = account;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const constraints: string[] = [];

  const nav = netLiquidation;

  const leveragedSym = ctx.input.leveragedSymbol ?? 'TQQQ';
  const tqqqPos = positions.find(p => p.symbol === leveragedSym);
  const tqqqValue = tqqqPos?.marketValue ?? 0;
  const tqqq_current_pct = nav > 0 ? tqqqValue / nav : 0;
  const regime = ctx.results.regime?.data.regime;
  const baseHardCap = regime ? p.hardCapByRegime?.[regime] ?? p.maxTqqqHardPct : p.maxTqqqHardPct;
  const conditionalHardCapRaise = p.conditionalHardCapRaise;
  const cleanGrowthScore = [
    (ctx.results.regime?.data.roc5 ?? -Infinity) >= (conditionalHardCapRaise?.roc5Min ?? 0),
    (ctx.results.regime?.data.sma20_slope_pct ?? -Infinity) >= (conditionalHardCapRaise?.sma20SlopeMin ?? 0),
    (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= (conditionalHardCapRaise?.priceVsSma200Min ?? 0),
  ].filter(Boolean).length;
  const canRaiseCleanGrowthCap = conditionalHardCapRaise != null
    && (conditionalHardCapRaise.requireActive !== true || ctx.input.trendParticipationState?.active === true)
    && (!conditionalHardCapRaise.regimeIn || conditionalHardCapRaise.regimeIn.includes(regime ?? ''))
    && cleanGrowthScore >= Math.max(1, Math.floor(conditionalHardCapRaise.scoreMin ?? 4))
    && (ctx.results.regime?.data.vix ?? Infinity) <= (conditionalHardCapRaise.vixMax ?? 24)
    && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= (conditionalHardCapRaise.vixRise5dMax ?? .02)
    && (ctx.results.regime?.data.price_vs_sma200_pct ?? -Infinity) >= (conditionalHardCapRaise.priceVsSma200Min ?? 0)
    && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) <= (conditionalHardCapRaise.drawdownMax ?? .05)
    && (ctx.results.regime?.data.price_extension_atr ?? Infinity) <= (conditionalHardCapRaise.priceExtensionMax ?? 2.5)
    && ctx.results.regime?.data.crisisPhase !== 'CONFIRMED'
    && ctx.currentFlashCrashState?.active !== true;
  const raisedHardCap = Number.isFinite(ctx.input.hardCapRaiseOverride)
    ? Math.max(baseHardCap, ctx.input.hardCapRaiseOverride!)
    : canRaiseCleanGrowthCap
      ? Math.max(baseHardCap, Math.min(1.25, conditionalHardCapRaise!.capPct))
      : baseHardCap;
  const researchHardCap = Number.isFinite(ctx.input.hardCapOverride)
    ? Math.min(raisedHardCap, Math.max(0, ctx.input.hardCapOverride!))
    : raisedHardCap;
  // G1: double-gate on fast regime too — bare SLOW_BEAR alone false-positives on ordinary bull-market
  // V-dips (see g0 report); requiring the fast layer to also confirm BEAR/CRISIS mirrors the only
  // proven-effective precedent (crisisPhaseSellExempt gates on crisisPhase, not bare phase).
  let effectiveHardCap = p.slowBearTargetVol?.hardCapPct != null
    && ctx.input.macroRegimeState?.phase === 'SLOW_BEAR'
    && (regime === 'BEAR' || regime === 'CRISIS')
    ? p.slowBearTargetVol.hardCapPct
    : researchHardCap;
  effectiveHardCap = Math.min(effectiveHardCap, researchHardCap);
  const growthOverrides = ctx.stockPolicy?.value.id === 'SLOW_BULL_GROWTH'
    ? ctx.stockPolicy.value.overrides
    : {};
  const conditionalCapApplies = ctx.stockPolicy?.value.id === 'SLOW_BULL_GROWTH'
    || ctx.input.crisisPhase === 'PENDING';
  const conditionalGrowthCapPct = conditionalCapApplies
    && Number.isFinite(ctx.input.conditionalGrowthWarnCapPct)
    ? Math.min(effectiveHardCap, Math.max(0, ctx.input.conditionalGrowthWarnCapPct!))
    : undefined;
  // Growth overrides may only relax existing soft constraints and never the hard cap.
  const maxTqqqWarnPct = Math.min(
    effectiveHardCap,
    Math.max(p.maxTqqqWarnPct, growthOverrides.maxTqqqWarnPct ?? p.maxTqqqWarnPct, canRaiseCleanGrowthCap ? conditionalHardCapRaise!.capPct : 0),
    conditionalGrowthCapPct ?? effectiveHardCap,
  );
  const costBasisDrawdownCapPct = Math.min(
    maxTqqqWarnPct,
    Math.max(0.25, growthOverrides.costBasisDrawdownCapPct ?? 0.25),
  );

  const deltaExposureForOption = (op: NonNullable<typeof account.optionPositions>[number]): number => {
    const underPrice = op.symbol === leveragedSym
      ? ctx.input.currentPrices?.leveraged ?? ctx.input.prices.TQQQ.at(-1)?.close ?? 0
      : op.symbol === 'QQQ'
        ? ctx.input.currentPrices?.QQQ ?? ctx.input.prices.QQQ.at(-1)?.close ?? 0
        : 0;
    const beta = op.symbol === leveragedSym ? 3 : op.symbol === 'QQQ' ? 1 : 0;
    return (op.delta ?? 0) * op.quantity * 100 * underPrice * beta;
  };
  // Equity Boost Put Spread's net delta always counts toward leverage, even when the global
  // includeOptionDeltaInLeverage switch is off — per spec, this new strategy's risk must never
  // be invisible to the hard-risk gate. Other legs keep the existing opt-in gating semantics.
  const equityBoostDeltaExposure = (account.optionPositions ?? [])
    .filter(op => op.strategyTag === 'QQQ_EQUITY_BOOST_PUT_SPREAD')
    .reduce((sum, op) => sum + deltaExposureForOption(op), 0);
  const otherOptionDeltaExposure = p.includeOptionDeltaInLeverage === true
    ? (account.optionPositions ?? [])
      .filter(op => op.strategyTag !== 'QQQ_EQUITY_BOOST_PUT_SPREAD')
      .reduce((sum, op) => sum + deltaExposureForOption(op), 0)
    : 0;
  const optionDeltaExposure = equityBoostDeltaExposure + otherOptionDeltaExposure;
  const leverage_ratio = nav > 0 ? Math.max(0, (tqqqValue * 3 + optionDeltaExposure) / nav) : 0;

  const tqqqCost = tqqqPos?.averageCost ?? 0;
  const tqqqQty = tqqqPos?.quantity ?? 0;
  const tqqqCostBasis = tqqqCost * tqqqQty;
  const in_drawdown = tqqqCostBasis > 0 && tqqqValue < tqqqCostBasis;
  const drawdown_pct = in_drawdown && tqqqCostBasis > 0
    ? (tqqqCostBasis - tqqqValue) / tqqqCostBasis
    : 0;

  const boxxValue = positions.find(p => p.symbol === 'BOXX')?.marketValue ?? 0;
  const liquidPct = nav > 0 ? (boxxValue + account.cash) / nav : 0;

  const prevCloseNav = ctx.input.prevCloseNav;
  const daily_loss_pct = prevCloseNav && prevCloseNav > 0
    ? Math.min(0, (nav - prevCloseNav) / prevCloseNav)
    : 0;

  if (tqqq_current_pct > effectiveHardCap) {
    blockers.push(`TQQQ 仓位过重：当前 ${(tqqq_current_pct * 100).toFixed(1)}%，上限 ${(effectiveHardCap * 100).toFixed(0)}%，需立即减仓`);
  }
  if (leverage_ratio > p.maxLeverage) {
    blockers.push(`有效杠杆过高：${leverage_ratio.toFixed(2)}x，上限 ${p.maxLeverage}x`);
  }
  if (Math.abs(daily_loss_pct) > p.maxDailyLossPct) {
    blockers.push(`日内亏损超限：${(Math.abs(daily_loss_pct) * 100).toFixed(1)}%，上限 ${(p.maxDailyLossPct * 100).toFixed(0)}%`);
  }

  let max_tqqq_allowed_pct = effectiveHardCap;

  if (conditionalGrowthCapPct !== undefined) {
    // Unlike the legacy warn line, a conditional cap must also constrain a target
    // while current exposure is still below the cap; otherwise it is only a warning.
    constraints.push(`条件化 Growth 上限 ${(conditionalGrowthCapPct * 100).toFixed(0)}%`);
    max_tqqq_allowed_pct = Math.min(max_tqqq_allowed_pct, conditionalGrowthCapPct);
  }

  if (tqqq_current_pct > maxTqqqWarnPct) {
    warnings.push(`TQQQ 仓位接近警戒线：${(tqqq_current_pct * 100).toFixed(1)}%`);
    constraints.push(`TQQQ 软上限 ${(maxTqqqWarnPct * 100).toFixed(0)}%`);
    max_tqqq_allowed_pct = Math.min(max_tqqq_allowed_pct, maxTqqqWarnPct);
  }
  if (liquidPct < p.minLiquidPct) {
    warnings.push(`流动性不足：BOXX+cash 仅占 ${(liquidPct * 100).toFixed(1)}%，建议 ≥ ${(p.minLiquidPct * 100).toFixed(0)}%`);
    constraints.push('流动性不足，限制新建仓');
    max_tqqq_allowed_pct = Math.min(max_tqqq_allowed_pct, tqqq_current_pct);
  }
  if (in_drawdown && drawdown_pct > p.drawdownWarnPct) {
    warnings.push(`TQQQ 回撤 ${(drawdown_pct * 100).toFixed(1)}%，触发减仓约束`);
    constraints.push(`回撤超 ${(p.drawdownWarnPct * 100).toFixed(0)}%，TQQQ 上限降至 ${(costBasisDrawdownCapPct * 100).toFixed(0)}%`);
    max_tqqq_allowed_pct = Math.min(max_tqqq_allowed_pct, costBasisDrawdownCapPct);
  }

  const status = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'HardRiskRules',
    status,
    data: {
      tqqq_current_pct,
      max_tqqq_allowed_pct,
      leverage_ratio,
      in_drawdown,
      drawdown_pct,
      constraints,
    },
    warnings,
    blockers,
  };
}
