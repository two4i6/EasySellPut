import type { FactorMap, FinancialFactor } from '../../../../../types/factor';
import { createDerivedFactor, createRawFactor, fallbackFactor, isValidMA, isValidPrice, isValidROC, isValidRSI, isValidVix } from '../../../../factor';
import type { OptionContract, OptionPosition } from '../../types/input';
import type { OverlayData, PipelineContext } from '../../types/pipeline';
import {
  BEAR_DTE_MIN,
  BEAR_DTE_MAX,
  BEAR_DTE_TARGET,
  BEAR_SHORT_DELTA_MIN,
  BEAR_SHORT_DELTA_MAX,
  BEAR_SHORT_DELTA_TARGET,
  BEAR_WIDTH_MIN,
  BEAR_WIDTH_MAX,
  BEAR_MIN_CREDIT_TO_MAX_LOSS,
  BEAR_MAX_SINGLE_RISK,
  BEAR_MAX_TOTAL_RISK,
  BEAR_MAX_OPEN_SPREADS,
  BEAR_COOLDOWN_AFTER_OPEN_DAYS,
  BEAR_COOLDOWN_AFTER_LOSS_DAYS,
  BEAR_CS_DTE_EXIT,
  BEAR_CS_DELTA_EXIT,
  BEAR_CS_ROC5_EXIT,
  BEAR_CS_PROFIT_TARGET_DEFAULT,
  BEAR_CS_STOP_LOSS_CREDIT_MULT,
  BEAR_CS_STOP_LOSS_MAX_LOSS_PCT,
  OVERLAY_STRATEGY_TAGS,
} from '../../constants';

const BEAR_SPREAD_TAG = OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD;

const EXIT_RULES = [
  '盈利达到 credit 的 60% 平仓',
  'short call delta > 0.45 时 close/review',
  'QQQ 收盘上 SMA200 时 close/review',
  '5 日涨幅 > 8% 或连续 3 天强涨时 close/review',
  'DTE < 7 时 close/review',
  '回购成本 >= min(2 × credit, 70% maxLoss) 时 close/review',
];

type BearOverlayResult = {
  action: OverlayData['action'];
  triggered: boolean;
  bearCallSpread?: OverlayData['bearCallSpread'];
  proposed_strikes?: OverlayData['proposed_strikes'];
  premium_estimate?: number;
  max_risk_pct?: number;
  warnings: string[];
  factors: FactorMap;
};

type Expiration = {
  date: string;
  calls: OptionContract[];
};

function rawFactor<T>(value: T, api: string, logicReason?: string): FinancialFactor<T> {
  return createRawFactor(
    value,
    candidate => candidate != null && (typeof candidate !== 'number' || Number.isFinite(candidate)),
    api,
    logicReason,
  );
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000);
}

function pctDistance(price: number | undefined, ma: number | undefined): number {
  return price != null && ma != null && ma > 0 ? (price - ma) / ma : 0;
}

function buildBearFactors(ctx: PipelineContext, allowed: boolean, usedRiskPct: number): FactorMap {
  const regime = ctx.results.regime?.data;
  const price = ctx.input.prices.QQQ.at(-1)?.close;
  const phase = regime?.bearMarketPhase ?? 'BEAR_TREND';
  const factors: FactorMap = {};

  factors.bear_phase = rawFactor(phase, 'leveraged-overlay/regime');
  factors.bear_rally_signal = rawFactor(phase === 'BEAR_RALLY', 'leveraged-overlay/regime');

  if (isValidPrice(price ?? 0)) {
    factors.qqq_price = rawFactor(price, 'leveraged-overlay/prices.QQQ');
  }
  if (isValidMA(regime?.sma20 ?? 0)) {
    factors.qqq_sma20 = rawFactor(regime!.sma20, 'leveraged-overlay/regime.sma20');
  }
  if (isValidMA(regime?.sma50 ?? 0)) {
    factors.qqq_sma50 = rawFactor(regime!.sma50, 'leveraged-overlay/regime.sma50');
  }
  if (isValidMA(regime?.sma200 ?? 0)) {
    factors.qqq_sma200 = rawFactor(regime!.sma200, 'leveraged-overlay/regime.sma200');
  }
  if (isValidROC(regime?.roc5 ?? Number.NaN)) {
    factors.qqq_roc5 = rawFactor(regime!.roc5, 'leveraged-overlay/regime.roc5');
  }
  if (isValidRSI(regime?.rsi14 ?? Number.NaN)) {
    factors.qqq_rsi14 = rawFactor(regime!.rsi14, 'leveraged-overlay/regime.rsi14');
  }
  if (isValidVix(ctx.input.macro.vix ?? Number.NaN)) {
    factors.vix_price = rawFactor(ctx.input.macro.vix, 'leveraged-overlay/macro.vix');
  }

  factors.bear_overlay_allowed = deriveBearOverlayAllowed(factors, allowed, [{ factorId: 'bear_rally_signal', weight: 1 }]);
  factors.bear_overlay_used_risk_pct = rawFactor(usedRiskPct, 'leveraged-overlay/account.optionPositions');

  return factors;
}

function deriveBearOverlayAllowed(
  factors: FactorMap,
  allowed: boolean,
  inputs: Array<{ factorId: string; weight: number }>,
): FinancialFactor<boolean> {
  const missing = inputs.filter(input => !factors[input.factorId]).map(input => input.factorId);
  return missing.length === 0
    ? createDerivedFactor(allowed, inputs, factors)
    : fallbackFactor(false, `${missing.join(', ')} 缺失，无法派生 Bear Overlay 许可`);
}

function activeBearGroups(optionPositions: OptionPosition[]): Array<{
  groupId: string;
  openedAt?: string;
  maxLoss: number;
  unrealizedPnl: number;
}> {
  const groups = new Map<string, { groupId: string; openedAt?: string; maxLoss: number; unrealizedPnl: number }>();
  for (const pos of optionPositions) {
    if (pos.strategyTag !== BEAR_SPREAD_TAG) continue;
    const groupId = pos.groupId ?? `${pos.symbol}-${pos.expiry}-${pos.strike}`;
    const existing = groups.get(groupId);
    groups.set(groupId, {
      groupId,
      openedAt: existing?.openedAt ?? pos.openedAt,
      maxLoss: Math.max(existing?.maxLoss ?? 0, pos.maxLoss ?? 0),
      unrealizedPnl: (existing?.unrealizedPnl ?? 0) + (pos.unrealizedPnl ?? 0),
    });
  }
  return [...groups.values()];
}

function hasUnclassifiedQqqCallSpreadRisk(optionPositions: OptionPosition[]): boolean {
  return optionPositions.some(pos =>
    pos.symbol === 'QQQ' &&
    pos.type === 'call' &&
    pos.strategyTag == null &&
    pos.quantity !== 0
  );
}

function currentCooldown(
  groups: ReturnType<typeof activeBearGroups>,
  today: string,
  openDays: number,
  lossDays: number,
): NonNullable<NonNullable<OverlayData['bearCallSpread']>['cooldown']> {
  let maxRemaining = 0;
  let reason: string | undefined;

  for (const group of groups) {
    if (!group.openedAt) continue;
    const age = Math.max(0, daysBetween(group.openedAt, today));
    const afterOpenRemaining = Math.max(0, openDays - age);
    if (afterOpenRemaining > maxRemaining) {
      maxRemaining = afterOpenRemaining;
      reason = 'recent_open';
    }
    if (group.unrealizedPnl < 0) {
      const afterLossRemaining = Math.max(0, lossDays - age);
      if (afterLossRemaining > maxRemaining) {
        maxRemaining = afterLossRemaining;
        reason = 'recent_loss';
      }
    }
  }

  return { active: maxRemaining > 0, daysRemaining: maxRemaining, reason };
}

function findBearExpiry(expirations: Expiration[], fromDate: string): Expiration | undefined {
  return expirations
    .map(exp => ({ exp, dte: daysBetween(fromDate, exp.date) }))
    .filter(item => item.dte >= BEAR_DTE_MIN && item.dte <= BEAR_DTE_MAX)
    .sort((a, b) => Math.abs(a.dte - BEAR_DTE_TARGET) - Math.abs(b.dte - BEAR_DTE_TARGET))[0]?.exp;
}

function mid(contract: OptionContract | undefined): number {
  return contract ? (contract.bid + contract.ask) / 2 : 0;
}

function selectBearCallSpread(exp: Expiration, spot: number): {
  shortCall: OptionContract;
  longCall: OptionContract;
  credit: number;
  maxLoss: number;
  creditToMaxLoss: number;
} | null {
  const shortCandidates = exp.calls
    .filter(c => c.delta >= BEAR_SHORT_DELTA_MIN && c.delta <= BEAR_SHORT_DELTA_MAX && c.strike > spot)
    .sort((a, b) => Math.abs(a.delta - BEAR_SHORT_DELTA_TARGET) - Math.abs(b.delta - BEAR_SHORT_DELTA_TARGET));

  for (const shortCall of shortCandidates) {
    const longCandidates = exp.calls
      .filter(c => c.strike > shortCall.strike && c.strike - shortCall.strike >= BEAR_WIDTH_MIN && c.strike - shortCall.strike <= BEAR_WIDTH_MAX)
      .sort((a, b) => Math.abs((a.strike - shortCall.strike) - BEAR_WIDTH_MIN) - Math.abs((b.strike - shortCall.strike) - BEAR_WIDTH_MIN));

    for (const longCall of longCandidates) {
      const width = longCall.strike - shortCall.strike;
      const credit = mid(shortCall) - mid(longCall);
      const maxLoss = width * 100 - credit * 100;
      const creditToMaxLoss = maxLoss > 0 ? (credit * 100) / maxLoss : 0;
      if (credit > 0 && maxLoss > 0 && creditToMaxLoss >= BEAR_MIN_CREDIT_TO_MAX_LOSS) {
        return { shortCall, longCall, credit, maxLoss, creditToMaxLoss };
      }
    }
  }

  return null;
}

function skipped(reason: string, warnings: string[], factors: FactorMap): BearOverlayResult {
  return {
    action: 'SKIP_BEAR_CALL_SPREAD',
    triggered: false,
    warnings,
    factors,
    bearCallSpread: {
      underlying: 'QQQ',
      proxyOverlay: true,
      requireDefinedRisk: true,
      notCoveredOverlay: true,
      definedRisk: true,
      reason,
      warnings,
      exitRules: EXIT_RULES,
    },
  };
}

export function evaluateBearMarketOverlay(ctx: PipelineContext): BearOverlayResult {
  const warnings: string[] = [];
  const params = ctx.input.strategyParams;
  const enabled = params?.enableBearOverlay !== false;
  const regime = ctx.results.regime?.data;
  const phase = regime?.bearMarketPhase;
  const optionPositions = ctx.input.account.optionPositions ?? [];
  const groups = activeBearGroups(optionPositions);
  const usedRiskPct = ctx.input.account.netLiquidation > 0
    ? groups.reduce((sum, group) => sum + group.maxLoss, 0) / ctx.input.account.netLiquidation
    : 0;
  const factors = buildBearFactors(ctx, enabled && phase === 'BEAR_RALLY', usedRiskPct);

  if (!enabled) {
    return skipped('Bear Overlay 已关闭', warnings, factors);
  }
  if (phase === 'CRISIS' || regime?.regime === 'CRISIS') {
    warnings.push('CRISIS 禁止新开含卖方腿的期权结构，仅允许减风险或复核已有仓位');
    return skipped('CRISIS 禁止新开 Bear Call Spread', warnings, factors);
  }

  const bearOverlayMode = params?.bearOverlayMode ?? 'strict';
  const qqqPrice = ctx.input.prices.QQQ.at(-1)?.close ?? 0;
  const vixNow = ctx.input.macro.vix ?? 0;
  const sma20Now = regime?.sma20 ?? 0;
  const sma50Now = regime?.sma50 ?? 0;
  const sma200Now = regime?.sma200 ?? 0;
  const rsi14Now = regime?.rsi14 ?? 0;
  const roc5Now = regime?.roc5 ?? 0;

  const relaxedBearRally = bearOverlayMode === 'relaxed' && (() => {
    if (sma200Now <= 0 || qqqPrice <= 0) return false;
    const distSma20 = sma20Now > 0 ? Math.abs((qqqPrice - sma20Now) / sma20Now) : 1;
    const distSma50 = sma50Now > 0 ? Math.abs((qqqPrice - sma50Now) / sma50Now) : 1;
    return (
      qqqPrice < sma200Now * 0.98 &&
      rsi14Now >= 40 && rsi14Now <= 65 &&
      (distSma20 <= 0.05 || distSma50 <= 0.05) &&
      vixNow >= 16
    );
  })();

  // 'early' mode: catch bear rally at its start via roc5 > 0, no MA proximity required
  const earlyBearEntry = bearOverlayMode === 'early' && (() => {
    if (sma200Now <= 0 || qqqPrice <= 0) return false;
    return (
      qqqPrice < sma200Now * 0.95 &&   // solidly in bear territory
      rsi14Now >= 32 && rsi14Now <= 58 &&  // recovering from oversold, not yet extended
      roc5Now > 0 &&                     // 5-day bounce confirmed
      vixNow >= 14
    );
  })();

  // 'overbought' mode: bear-market bounce into SMA20 resistance while still below SMA200.
  const overboughtBearEntry = bearOverlayMode === 'overbought' && (() => {
    if (sma200Now <= 0 || sma20Now <= 0 || qqqPrice <= 0) return false;
    return (
      qqqPrice < sma200Now &&
      rsi14Now >= 58 && rsi14Now <= 72 &&
      qqqPrice >= sma20Now &&
      vixNow < 35
    );
  })();

  const altBearFire = relaxedBearRally || earlyBearEntry || overboughtBearEntry;
  const allowedInputs = altBearFire
    ? [
      { factorId: 'qqq_price', weight: 0.25 },
      { factorId: 'qqq_sma20', weight: 0.25 },
      { factorId: 'qqq_sma200', weight: 0.25 },
      { factorId: 'qqq_rsi14', weight: 0.15 },
      { factorId: 'vix_price', weight: 0.10 },
    ]
    : [{ factorId: 'bear_rally_signal', weight: 1 }];
  factors.bear_overlay_allowed = deriveBearOverlayAllowed(factors, phase === 'BEAR_RALLY' || altBearFire, allowedInputs);

  if (!factors.bear_overlay_allowed.value) {
    return skipped(`当前熊市阶段 ${phase ?? 'NONE'}，仅 BEAR_RALLY 或 BearCS 放宽触发允许新开 QQQ Bear Call Spread`, warnings, factors);
  }
  if (relaxedBearRally && phase !== 'BEAR_RALLY') {
    warnings.push('放宽触发：RSI 40-65 + MA 距离 ≤5% + VIX ≥16，未达到严格 BEAR_RALLY 但满足放宽条件');
  }
  if (earlyBearEntry && phase !== 'BEAR_RALLY') {
    warnings.push(`提前入场：价格低于 SMA200 ${((1 - qqqPrice / sma200Now) * 100).toFixed(1)}%，RSI14=${rsi14Now.toFixed(1)}，5日涨幅 ${(roc5Now * 100).toFixed(1)}% > 0，反弹初期入场`);
  }
  if (overboughtBearEntry && phase !== 'BEAR_RALLY') {
    warnings.push(`超买衰竭触发：RSI14=${rsi14Now.toFixed(1)}，QQQ/SMA20=${(qqqPrice / sma20Now).toFixed(3)}，QQQ/SMA200=${(qqqPrice / sma200Now).toFixed(3)}，VIX=${vixNow.toFixed(1)}`);
  }
  if (hasUnclassifiedQqqCallSpreadRisk(optionPositions)) {
    warnings.push('存在缺少 strategyTag/groupId 的 QQQ Call 期权仓位，无法可靠判断是否已有 Bear Call Spread');
    return {
      action: 'REVIEW_BEAR_CALL_SPREAD',
      triggered: false,
      warnings,
      factors,
      bearCallSpread: {
        underlying: 'QQQ',
        proxyOverlay: true,
        requireDefinedRisk: true,
        notCoveredOverlay: true,
        definedRisk: true,
        reason: '已有 QQQ Call 仓位缺少 metadata，需人工复核',
        warnings,
        exitRules: EXIT_RULES,
      },
    };
  }

  const maxOpen = params?.maxOpenBearSpreads ?? BEAR_MAX_OPEN_SPREADS;
  if (groups.length >= maxOpen) {
    warnings.push(`Bear Overlay 已有 ${groups.length} 组，达到上限 ${maxOpen}`);
    return skipped('Bear Overlay 数量达到上限', warnings, factors);
  }

  const cooldown = currentCooldown(
    groups,
    ctx.input.date,
    params?.cooldownAfterOpenDays ?? BEAR_COOLDOWN_AFTER_OPEN_DAYS,
    params?.cooldownAfterLossDays ?? BEAR_COOLDOWN_AFTER_LOSS_DAYS,
  );
  if (cooldown.active) {
    warnings.push(`Bear Overlay 冷却中，剩余 ${cooldown.daysRemaining} 天`);
    const result = skipped('Bear Overlay 冷却期内', warnings, factors);
    result.bearCallSpread!.cooldown = cooldown;
    return result;
  }

  const qqqChain = ctx.input.optionChains?.QQQ;
  if (!qqqChain) {
    warnings.push('QQQ 期权链缺失，无法构建 Bear Call Spread');
    return skipped('QQQ 期权链缺失', warnings, factors);
  }

  const exp = findBearExpiry(qqqChain.expirations, ctx.input.date);
  if (!exp) {
    warnings.push('没有 21-45 DTE 的 QQQ 期权到期日');
    return skipped('缺少合格 DTE', warnings, factors);
  }

  const selected = selectBearCallSpread(exp, qqqChain.spot);
  if (!selected) {
    warnings.push(`没有满足 delta ${BEAR_SHORT_DELTA_MIN}-${BEAR_SHORT_DELTA_MAX}、宽度 ${BEAR_WIDTH_MIN}-${BEAR_WIDTH_MAX}、credit/maxLoss >= ${BEAR_MIN_CREDIT_TO_MAX_LOSS} 的 Bear Call Spread`);
    return skipped('缺少合格 Bear Call Spread 期权腿', warnings, factors);
  }

  const nav = ctx.input.account.netLiquidation;
  const maxSingleRisk = params?.maxSingleBearSpreadRisk ?? BEAR_MAX_SINGLE_RISK;
  const maxTotalRisk = params?.maxTotalBearOverlayRisk ?? BEAR_MAX_TOTAL_RISK;
  const maxSingleDollars = nav * maxSingleRisk;
  const remainingTotalDollars = Math.max(0, nav * maxTotalRisk - usedRiskPct * nav);
  const riskBudgetDollars = Math.min(maxSingleDollars, remainingTotalDollars);

  let quantity = Math.floor(riskBudgetDollars / selected.maxLoss);
  if (quantity < 1) {
    if (!params?.forceMinimumContract) {
      warnings.push(`1 张 Bear Call Spread 最大风险 $${selected.maxLoss.toFixed(0)} 超过剩余预算 $${riskBudgetDollars.toFixed(0)}`);
      return skipped('单张 Bear Call Spread 超预算', warnings, factors);
    }
    quantity = 1;
    warnings.push(`1 张 Bear Call Spread 最大风险 $${selected.maxLoss.toFixed(0)} 超过剩余预算 $${riskBudgetDollars.toFixed(0)}，[FMQ0]强制开1张，超预算${(selected.maxLoss / riskBudgetDollars * 100).toFixed(0)}%`);
  }

  const newRiskPct = quantity * selected.maxLoss / nav;
  const totalAfterRiskPct = usedRiskPct + newRiskPct;
  const dte = daysBetween(ctx.input.date, exp.date);

  const triggerLabel = overboughtBearEntry
    ? '超买衰竭'
    : earlyBearEntry
      ? '提前反弹'
      : relaxedBearRally
        ? '放宽反弹'
        : 'BEAR_RALLY';
  const triggerReason = overboughtBearEntry
    ? '超买衰竭：QQQ 仍低于 SMA200，反弹至 SMA20 上方且 RSI 进入 58-72 阻力区，使用定义风险 QQQ Bear Call Spread'
    : earlyBearEntry
      ? '提前反弹：QQQ 低于 SMA200 且 ROC5 转正，使用定义风险 QQQ Bear Call Spread'
      : relaxedBearRally
        ? '放宽反弹：QQQ 低于 SMA200 且接近 SMA20/SMA50 阻力区，使用定义风险 QQQ Bear Call Spread'
        : 'BEAR_RALLY：QQQ 低于 SMA200 且反弹至 SMA20/SMA50 阻力区，使用定义风险 QQQ Bear Call Spread';

  warnings.push(
    `QQQ Bear Call Spread（${triggerLabel}）：Short Call@${selected.shortCall.strike} / Long Call@${selected.longCall.strike}，DTE=${dte}，credit/maxLoss=${selected.creditToMaxLoss.toFixed(2)}`
  );

  return {
    action: 'OPEN_BEAR_CALL_SPREAD',
    triggered: true,
    proposed_strikes: {
      spread_short_strike: selected.shortCall.strike,
      spread_long_strike: selected.longCall.strike,
      expiry: exp.date,
    },
    premium_estimate: selected.credit,
    max_risk_pct: newRiskPct,
    warnings,
    factors,
    bearCallSpread: {
      underlying: 'QQQ',
      proxyOverlay: true,
      requireDefinedRisk: true,
      notCoveredOverlay: true,
      definedRisk: true,
      expiry: exp.date,
      shortCallStrike: selected.shortCall.strike,
      longCallStrike: selected.longCall.strike,
      credit: selected.credit,
      maxLoss: selected.maxLoss,
      buyingPowerImpact: selected.maxLoss,
      riskBudgetUsed: newRiskPct,
      creditToMaxLoss: selected.creditToMaxLoss,
      dte,
      shortCallDelta: selected.shortCall.delta,
      quantity,
      usedRiskPct,
      newRiskPct,
      totalAfterRiskPct,
      cooldown,
      reason: triggerReason,
      warnings,
      exitRules: EXIT_RULES,
    },
  };
}

export const QQQ_BEAR_CALL_SPREAD_TAG = BEAR_SPREAD_TAG;
