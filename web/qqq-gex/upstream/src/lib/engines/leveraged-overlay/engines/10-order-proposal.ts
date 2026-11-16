import type { PipelineContext, EngineResult } from '../types/pipeline';
import type { OrderProposal, EquityOrder, OptionOrder } from '../types/output';
import { isUpstreamBlocked } from '../types/pipeline';
import { validateCallCreditSpread, validatePutCreditSpread, validateCoveredShortCall, validateIronCondor } from '../overlayValidation';
import type { OverlayProposal } from '../types/pipeline';
import { leveragedDeadbandPctForTrade, MIN_BUY_DELTA_PCT, OVERLAY_STRATEGY_TAGS } from '../constants';
import { reasonLabel, type ExecutionReasonKey } from '../reasonLabels';
import { updateFlashCrashState } from './crisis-state-machine';

type OrderProposalData = {
  proposals: OrderProposal[];
  flashCrashState?: {
    active: boolean;
    cooldownBars: number;
    triggerDate?: string;
  };
};

const MIN_ORDER_SHARES = 1;

export function runOrderProposal(ctx: PipelineContext): EngineResult<OrderProposalData> {
  const { account } = ctx.input;
  const nav = account.netLiquidation;
  const proposals: OrderProposal[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const currentFlashCrashState = ctx.currentFlashCrashState ?? updateFlashCrashState(
    ctx.input.flashCrashState,
    ctx.input.prices.QQQ,
    ctx.input.macro.vix,
    ctx.input.macro.vix3m,
    ctx.input.strategyParams as any,
    ctx.input.date,
  );
  if (ctx.input.strategyParams?.flashCrashOverride &&
    (!Number.isFinite(ctx.input.macro.vix) || !Number.isFinite(ctx.input.macro.vix3m) || (ctx.input.macro.vix3m ?? 0) <= 0)) {
    warnings.push('flashCrashOverride 未推进：VIX/VIX3M 数据缺失');
  }

  const upstream_blocked = isUpstreamBlocked(ctx);
  const guard = ctx.results.executionGuard?.data;
  const approvedTypes = guard?.approved_proposal_types ?? [];

  // ── Equity orders ──────────────────────────────────────────────────────────
  const regime = ctx.results.regime?.data.regime ?? 'SIDEWAYS';
  const trend = ctx.results.trend?.data.signal ?? 'NEUTRAL';
  const vix = ctx.input.macro.vix ?? 20;
  const rv20d = ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? 0;
  const riskBudgetData = ctx.results.riskBudget?.data;
  const volTargetData = ctx.results.volTarget?.data;
  const bindingConstraint = riskBudgetData?.binding_constraint ?? 'none';
  const upstreamBlocked = isUpstreamBlocked(ctx);

  let executionKey: ExecutionReasonKey = 'target_rebalance';

  if (upstreamBlocked) {
    executionKey = 'upstream_block';
  } else if (ctx.results.intradayGate?.data?.triggered) {
    executionKey = 'intraday_derisk';
  } else if (bindingConstraint === 'hard_risk') {
    executionKey = 'hard_risk_cap';
  } else if (bindingConstraint === 'trend_discount') {
    executionKey = 'trend_discount';
  } else if (bindingConstraint === 'vol_target') {
    if (volTargetData && volTargetData.regime_adjusted_weight < volTargetData.capped_weight) {
      executionKey = 'regime_adjustment';
    } else {
      executionKey = 'vol_target_resize';
    }
  }
  const constraintLabel = executionKey === 'target_rebalance' ? '无（目标调仓）' : reasonLabel(executionKey);

  // ── Equity orders ──────────────────────────────────────────────────────────
  if (approvedTypes.includes('equity') && !upstream_blocked) {
    const finalTqqqPct = ctx.results.riskBudget?.data.final_tqqq_pct ?? 0;
    const finalBoxxPct = ctx.results.riskBudget?.data.final_boxx_pct ?? 0;

    const leveragedSym = ctx.input.leveragedSymbol ?? 'TQQQ';
    const tqqqPos = account.positions.find(p => p.symbol === leveragedSym);
    const boxxPos = account.positions.find(p => p.symbol === 'BOXX');
    const tqqqPrice = ctx.input.prices.TQQQ.at(-1)?.close ?? 0;
    const cleanBullBoxxSizing = regime === 'BULL'
      && bindingConstraint === 'vol_target'
      && (ctx.results.regime?.data.roc5 ?? -Infinity) >= 0
      && (ctx.results.regime?.data.vix ?? Infinity) <= 20
      && (ctx.results.regime?.data.vix_change_5d ?? Infinity) <= 0
      && (ctx.results.volTarget?.data.qqq_er20 ?? -Infinity) >= 0.30
      && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= 0.90
      && (ctx.results.regime?.data.price_extension_atr ?? Infinity) < 2.65
      && (ctx.results.regime?.data.drawdown_from_recent_high_pct ?? Infinity) < 0.03;
    const tqqqCurrentValue = tqqqPos?.marketValue ?? 0;
    const boxxCurrentValue = boxxPos?.marketValue ?? 0;

    const tqqqTargetValue = nav * finalTqqqPct;
    const boxxTargetValue = nav * finalBoxxPct;

    const tqqqDeltaValue = tqqqTargetValue - tqqqCurrentValue;
    const boxxDeltaValue = boxxTargetValue - boxxCurrentValue;

    const boxxSizingMode = ctx.input.strategyParams?.researchBoxxOrderSizingMode;
    const largeTqqqRecoveryGap = nav > 0 && finalTqqqPct - (tqqqCurrentValue / nav) >= 0.20;
    const boxxSaleFundsLargeTqqqRecovery = boxxDeltaValue < 0 && largeTqqqRecoveryGap;
    const slowBullLowVolGap = ctx.input.macroRegimeState?.phase === 'SLOW_BULL'
      && ctx.stockPolicy?.value.id === 'SLOW_BULL_GROWTH'
      && (ctx.results.volTarget?.data.tqqq_realized_vol_20d ?? Infinity) <= 0.70
      && boxxSaleFundsLargeTqqqRecovery;
    const useCurrentBoxxSizing = ctx.input.strategyParams?.researchBoxxOrderSizingAtCurrentPrice === true
      && (boxxSizingMode === 'clean_bull'
        ? cleanBullBoxxSizing
        : boxxSizingMode === 'clean_bull_gap'
          ? cleanBullBoxxSizing && boxxSaleFundsLargeTqqqRecovery
          : boxxSizingMode === 'slow_bull_gap'
            ? slowBullLowVolGap
            : true);
    const historicalBoxxPrice = ctx.input.prices.BOXX?.at(-1)?.close ?? 100;
    const currentBoxxPrice = ctx.input.currentPrices?.BOXX ?? historicalBoxxPrice;
    const sizingFraction = Number.isFinite(ctx.input.strategyParams?.researchBoxxOrderSizingCurrentPriceFraction)
      ? Math.max(0, Math.min(1, ctx.input.strategyParams!.researchBoxxOrderSizingCurrentPriceFraction!))
      : 1;
    const boxxPrice = useCurrentBoxxSizing
      ? historicalBoxxPrice + (currentBoxxPrice - historicalBoxxPrice) * sizingFraction
      : historicalBoxxPrice;

    const tqqqSide = tqqqDeltaValue > 0 ? 'BUY' : 'SELL';
    // F4/F5/F6 opt-in: regime flips noisily between CRISIS/SIDEWAYS mid-crash (known daily-engine
    // whipsaw), so the maxSellPerBarPct ramp cap can throttle liquidation on days the crisis
    // state machine is still CONFIRMED but regime's label happens to read something else that
    // day — see docs/overlay-tuning/f3-boost-roc-damping-2026-07.md for the diagnosis. F4 exempted
    // CONFIRMED/RECOVERY unconditionally: fixed 2020 (fast crash out of a confirmed slow bull) but
    // regressed 2022 (a slow grind where CONFIRMED also triggers, and unramped selling into a slow
    // bear is actively harmful — F5 showed excluding RECOVERY alone doesn't fix this). F6 instead
    // scopes the exemption to only the SLOW_BULL macro phase (`macroRegimeState`, already wired via
    // the `macroRegime` opt-in classifier, M0b's ~80-day bull->bear lag): this is exactly the "slow
    // state gates fast-layer execution" pattern this exemption should have used from the start — a
    // sudden crisis while the slow classifier still reads SLOW_BULL is the 2020 pattern (unramp);
    // once the slow classifier has caught up to SLOW_BEAR, a CONFIRMED crisis is the 2022 pattern
    // (keep the ramp). Only meaningful when `macroRegime` is configured (SLOW_BULL/SLOW_BEAR state
    // is otherwise never computed) — i.e., this only ever fires alongside the boost, which is when
    // the extra unwind risk was introduced in the first place.
    const crisisPhase = ctx.results.regime?.data.crisisPhase;
    const crisisPhaseExempt = ctx.input.strategyParams?.crisisPhaseSellExempt === true
      && crisisPhase === 'CONFIRMED'
      && ctx.input.macroRegimeState?.phase === 'SLOW_BULL';
    const riskSellExempt = tqqqSide === 'SELL'
      && (bindingConstraint === 'hard_risk' || regime === 'BEAR' || regime === 'CRISIS' || executionKey === 'intraday_derisk' || crisisPhaseExempt);
    const configuredDeadband = ctx.input.strategyParams?.orderDeadbandPct;
    const orderDeadbandPct = typeof configuredDeadband === 'number' && Number.isFinite(configuredDeadband)
      ? Math.max(0, Math.min(1, configuredDeadband)) : 0;
    const orderDeadbandExempt = crisisPhase === 'PENDING' || crisisPhase === 'CONFIRMED' || crisisPhase === 'RECOVERY'
      || regime === 'BEAR' || regime === 'CRISIS' || currentFlashCrashState.active || bindingConstraint === 'hard_risk'
      || (upstreamBlocked && tqqqSide === 'SELL');
    const tqqqThreshold = leveragedDeadbandPctForTrade({
      side: tqqqSide,
      regime,
      params: ctx.input.strategyParams,
      postCrisisBars: ctx.input.postCrisisBars,
      qqqBars: ctx.input.prices.QQQ,
      lastLeveragedTrade: ctx.input.lastLeveragedTrade,
      riskSellExempt,
      postCrisisFastEntry: ctx.stockPolicy?.value.overrides.postCrisisFastEntry,
      leveragedBars: ctx.input.prices.TQQQ,
      actualTqqqPct: tqqqCurrentValue / nav,
      targetTqqqPct: tqqqTargetValue / nav,
    });
    if (tqqqPrice > 0 && Math.abs(tqqqDeltaValue / nav) >= tqqqThreshold
      && (orderDeadbandExempt || Math.abs(tqqqDeltaValue / nav) >= orderDeadbandPct)) {
      // ponytail: 限速只 clamp 执行规模；deadband 仍按全额差值判断是否交易，
      // 否则 ramp 会把剩余差额压到 sell floor 以下而停在残尾——这是接受的行为。
      let sellExecValue = Math.abs(tqqqDeltaValue);
      const capMultiplier = ctx.stockPolicy?.value.overrides.maxSellPerBarPctMultiplier;
      const baseRampCap = ctx.input.strategyParams?.maxSellPerBarPct;
      let rampCap = capMultiplier === null ? undefined : baseRampCap == null ? undefined : baseRampCap * (capMultiplier ?? 1);
      const overweightSell = ctx.input.strategyParams?.researchRiskOnWeakeningOverweightMaxSellPerBar;
      if (tqqqSide === 'SELL' && regime === 'RISK_ON_WEAKENING' && overweightSell != null
        && tqqqCurrentValue / nav - tqqqTargetValue / nav >= overweightSell.minGapPp / 100) {
        rampCap = Math.max(rampCap ?? 0, Math.max(0, overweightSell.maxSellPerBarPct));
      }
      if (tqqqSide === 'SELL' && rampCap != null && !riskSellExempt) {
        sellExecValue = Math.min(sellExecValue, nav * rampCap);
      }
      const qty = Math.floor(sellExecValue / tqqqPrice);
      if (qty >= MIN_ORDER_SHARES) {
        const tqqqCurrentPct = tqqqCurrentValue / nav;
        const tqqqDeltaPct = tqqqDeltaValue / nav;
        const execReason = `TQQQ 调仓 [${constraintLabel}]: Regime=${regime}, Trend=${trend}, VIX=${vix.toFixed(1)}, RV20d=${(rv20d * 100).toFixed(1)}%, 目标=${(finalTqqqPct * 100).toFixed(1)}%, 当前=${(tqqqCurrentPct * 100).toFixed(1)}%, 差值=${(tqqqDeltaPct * 100).toFixed(1)}%`;
        proposals.push({
          kind: 'equity',
          symbol: leveragedSym,
          side: tqqqSide,
          quantity: qty,
          orderType: 'LIMIT',
          limitPrice: tqqqPrice,
          urgency: 'SAME_DAY',
            rationale: `目标仓位 ${(finalTqqqPct * 100).toFixed(1)}%，当前 ${((tqqqCurrentValue / nav) * 100).toFixed(1)}%，差值 ${(tqqqDeltaValue / nav * 100).toFixed(1)}%`,
            executionReason: execReason,
            executionReasonKey: executionKey,
            targetPct: finalTqqqPct,
          } satisfies EquityOrder);
      }
    }

    if (boxxPrice > 0 && Math.abs(boxxDeltaValue / nav) >= MIN_BUY_DELTA_PCT
      && (orderDeadbandExempt || Math.abs(boxxDeltaValue / nav) >= orderDeadbandPct)) {
      const qty = Math.floor(Math.abs(boxxDeltaValue) / boxxPrice);
      if (qty >= MIN_ORDER_SHARES) {
        const boxxCurrentPct = boxxCurrentValue / nav;
        const boxxDeltaPct = boxxDeltaValue / nav;
        const execReason = `BOXX 调仓 [${constraintLabel}]: Regime=${regime}, Trend=${trend}, VIX=${vix.toFixed(1)}, RV20d=${(rv20d * 100).toFixed(1)}%, 目标=${(finalBoxxPct * 100).toFixed(1)}%, 当前=${(boxxCurrentPct * 100).toFixed(1)}%, 差值=${(boxxDeltaPct * 100).toFixed(1)}%`;
        proposals.push({
          kind: 'equity',
          symbol: 'BOXX',
          side: boxxDeltaValue > 0 ? 'BUY' : 'SELL',
          quantity: qty,
          orderType: 'LIMIT',
          limitPrice: boxxPrice,
          urgency: 'SAME_DAY',
          rationale: `目标仓位 ${(finalBoxxPct * 100).toFixed(1)}%，当前 ${((boxxCurrentValue / nav) * 100).toFixed(1)}%，差值 ${(boxxDeltaValue / nav * 100).toFixed(1)}%`,
          executionReason: execReason,
          executionReasonKey: executionKey,
        } satisfies EquityOrder);
      }
    }
  } else if (upstream_blocked) {
    // Upstream blocked: only allow defensive reduction of the leveraged ETF
    const leveragedSym = ctx.input.leveragedSymbol ?? 'TQQQ';
    const tqqqPos = account.positions.find(p => p.symbol === leveragedSym);
    const tqqqPrice = ctx.input.prices.TQQQ.at(-1)?.close ?? 0;
    const tqqqValue = tqqqPos?.marketValue ?? 0;
    if (tqqqValue > 0 && tqqqPrice > 0) {
      const hardMax = ctx.results.hardRisk?.data.max_tqqq_allowed_pct ?? 0;
      const finalTqqqPct = ctx.results.riskBudget?.data.final_tqqq_pct ?? hardMax;
      // 'target' (default): sell down to min(hardMax, risk-budget target) — belt-and-braces,
      // best in 2018-style fast declines. 'hardmax': sell only to the hardMax ratchet
      // (drawdown constraint still caps it at 25%) and let the position ride V-recoveries —
      // robustness: 2020 ultra CAGR 31%→52%, 2025 +7pp, at +2.5pp MDD in 2018.
      const isBearRegime = regime === 'BEAR' || regime === 'CRISIS';
      let blockSellMode = isBearRegime
        ? (ctx.input.strategyParams?.upstreamBlockSellMode ?? 'target')
        : (ctx.input.strategyParams?.upstreamBlockSellModeChop ?? ctx.input.strategyParams?.upstreamBlockSellMode ?? 'target');
      blockSellMode = ctx.stockPolicy?.value.overrides.upstreamBlockSellMode ?? blockSellMode;
      if (currentFlashCrashState.active) {
        blockSellMode = 'hardmax';
      }
      const targetModePct = Math.min(hardMax, finalTqqqPct);
      const targetPct = blockSellMode === 'hardmax'
        ? hardMax
        : blockSellMode === 'blend'
          ? hardMax + (targetModePct - hardMax) * (ctx.input.strategyParams?.upstreamBlockSellBlendWeight ?? 0.5)
          : targetModePct;
      const targetValue = nav * targetPct;
      if (tqqqValue > targetValue * 1.02) {
        let sellValue = tqqqValue - targetValue;
        if (blockSellMode === 'ramp') {
          const capMultiplier = ctx.stockPolicy?.value.overrides.maxSellPerBarPctMultiplier;
          const baseCap = ctx.input.strategyParams?.maxSellPerBarPct;
          const cap = capMultiplier === null ? 1 : baseCap == null ? 1 : baseCap * (capMultiplier ?? 1);
          sellValue = Math.min(sellValue, nav * cap);
        }
        const qty = Math.floor(sellValue / tqqqPrice);
        if (qty >= MIN_ORDER_SHARES) {
          const tqqqCurrentPct = tqqqValue / nav;
          const sellPct = tqqqCurrentPct - targetPct;
          const execReason = `TQQQ 强制减仓 [上游阻断]: Regime=${regime}, Trend=${trend}, VIX=${vix.toFixed(1)}, RV20d=${(rv20d * 100).toFixed(1)}%, 目标=${(targetPct * 100).toFixed(1)}%, 当前=${(tqqqCurrentPct * 100).toFixed(1)}%, 差值=-${(sellPct * 100).toFixed(1)}%`;
          proposals.push({
            kind: 'equity',
            symbol: leveragedSym,
            side: 'SELL',
            quantity: qty,
            orderType: 'MARKET',
            urgency: 'IMMEDIATE',
            rationale: `上游风控 BLOCK：强制减仓 ${leveragedSym} 至目标 ${(targetPct * 100).toFixed(1)}%`,
            executionReason: execReason,
            executionReasonKey: 'upstream_block',
            targetPct,
          } satisfies EquityOrder);
        }
      }
    }
    warnings.push('上游 BLOCK：仅生成防守型减仓指令');
  }

  // ── Option overlay orders ──────────────────────────────────────────────────
  if (approvedTypes.includes('option') && !upstream_blocked) {
    const overlay = ctx.results.overlay?.data;
    const leveragedSymbol = ctx.input.leveragedSymbol ?? 'TQQQ';
    const leveragedShares = account.positions.find(p => p.symbol === leveragedSymbol)?.quantity ?? 0;
    const hasAnyRequiredChain = !!ctx.input.optionChains?.QQQ || !!ctx.input.optionChains?.[leveragedSymbol];

    if (overlay && hasAnyRequiredChain) {
      const overlayProposals: OverlayProposal[] = overlay.overlayProposals?.length
        ? overlay.overlayProposals
        : overlay.action !== 'NONE'
          ? [overlay]
          : [];

      for (const proposal of overlayProposals) {
      const strikes = proposal.proposed_strikes;

      if (proposal.action === 'ADD_COLLAR' && strikes) {
        const collarUnderlying = strikes.call_symbol ?? leveragedSymbol;
        const putUnderlying = strikes.put_symbol ?? collarUnderlying;
        const covered = validateCoveredShortCall({
          underlying: collarUnderlying,
          leveragedSymbol,
          requestedQuantity: proposal.collar?.quantity ?? Math.max(1, Math.floor(leveragedShares / 100)),
          leveragedSymbolShares: leveragedShares,
        });
        if (!covered.ok) {
          warnings.push(covered.reason ?? `${leveragedSymbol} shares are insufficient to cover short call`);
          continue;
        }
        if (!ctx.input.optionChains?.[collarUnderlying] || !ctx.input.optionChains?.[putUnderlying]) {
          warnings.push(`${putUnderlying}/${collarUnderlying} 期权链缺失，跳过 ${proposal.action} 订单`);
          continue;
        }
        const groupId = `collar-${collarUnderlying}-${strikes.expiry}-${strikes.call_strike ?? strikes.put_strike}`;
        const strategyName = proposal.collar?.strategyName ?? (strikes.call_strike ? `${leveragedSymbol} Put Spread Collar` : `${leveragedSymbol} Put Spread Protection`);
        const putQuantity = strikes.put_quantity ?? covered.quantity;
        const callQuantity = strikes.call_quantity ?? covered.quantity;
        if (strikes.put_strike && strikes.expiry) {
          proposals.push({
            kind: 'option',
            symbol: putUnderlying,
            strike: strikes.put_strike,
            expiry: strikes.expiry,
            optionType: 'put',
            side: 'BUY',
            quantity: putQuantity,
            urgency: 'SAME_DAY',
            rationale: `${strategyName} 保护腿：买入 Put Delta≈-0.25，行权价 ${strikes.put_strike}，到期 ${strikes.expiry}`,
            strategyName,
            strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR,
            groupId,
            legRole: 'long_put',
            coveredByShares: true,
            coveredSharesRequired: covered.coveredSharesRequired,
            currentShares: covered.currentShares,
            uncoveredQuantity: covered.uncoveredQuantity,
          } satisfies OptionOrder);
        }
        if (strikes.put_spread_short_strike && strikes.expiry) {
          proposals.push({
            kind: 'option',
            symbol: putUnderlying,
            strike: strikes.put_spread_short_strike,
            expiry: strikes.expiry,
            optionType: 'put',
            side: 'SELL',
            quantity: putQuantity,
            urgency: 'SAME_DAY',
            rationale: `${strategyName} 融资腿：卖出下方 Put ${strikes.put_spread_short_strike}，到期 ${strikes.expiry}`,
            strategyName,
            strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR,
            groupId,
            legRole: 'short_put',
            definedRisk: true,
            coveredByShares: true,
            coveredSharesRequired: covered.coveredSharesRequired,
            currentShares: covered.currentShares,
            uncoveredQuantity: covered.uncoveredQuantity,
          } satisfies OptionOrder);
        }
        if (strikes.call_strike && strikes.expiry) {
          proposals.push({
            kind: 'option',
            symbol: collarUnderlying,
            strike: strikes.call_strike,
            expiry: strikes.expiry,
            optionType: 'call',
            side: 'SELL',
            quantity: callQuantity,
            urgency: 'SAME_DAY',
            rationale: `${strategyName} Covered Call：卖出 Call Delta≈0.15，行权价 ${strikes.call_strike}，到期 ${strikes.expiry}`,
            strategyName,
            strategyTag: OVERLAY_STRATEGY_TAGS.LEVERAGED_COLLAR,
            groupId,
            legRole: 'short_call',
            coveredByShares: true,
            coveredSharesRequired: covered.coveredSharesRequired,
            currentShares: covered.currentShares,
            uncoveredQuantity: covered.uncoveredQuantity,
          } satisfies OptionOrder);
        }
      } else if ((proposal.action === 'ADD_PUT_CREDIT_SPREAD' || proposal.action === 'ADD_PCS_RESCUE') && strikes) {
        const validation = validatePutCreditSpread({ underlying: 'QQQ', shortPutStrike: strikes.spread_short_strike, longPutStrike: strikes.spread_long_strike });
        if (!validation.ok) warnings.push(validation.reason!);
        else if (strikes.spread_short_strike && strikes.spread_long_strike && strikes.expiry) {
          const rescue = proposal.action === 'ADD_PCS_RESCUE';
          const pcs = rescue ? proposal.pcsRescuePutSpread : proposal.putCreditSpread;
          const strategyName = pcs?.strategyName ?? (rescue ? `QQQ PCS Rescue @${strikes.spread_long_strike}/${strikes.spread_short_strike}` : `QQQ Put Credit Spread @${strikes.spread_long_strike}/${strikes.spread_short_strike}`);
          const groupId = `${rescue ? 'pcs-rescue' : 'put-credit-spread'}-${strikes.expiry}-${strikes.spread_long_strike}-${strikes.spread_short_strike}`;
          for (const [strike, side, legRole] of [[strikes.spread_short_strike, 'SELL', 'short_put'], [strikes.spread_long_strike, 'BUY', 'long_put']] as const) {
            proposals.push({ kind: 'option', symbol: 'QQQ', strike, expiry: strikes.expiry, optionType: 'put', side, quantity: pcs?.quantity ?? 1, urgency: 'SAME_DAY', rationale: `${strategyName}：${side === 'SELL' ? '卖出' : '买入'} Put ${strike}`, strategyName, strategyTag: rescue ? OVERLAY_STRATEGY_TAGS.QQQ_PCS_RESCUE : OVERLAY_STRATEGY_TAGS.QQQ_PUT_CREDIT_SPREAD, groupId, legRole, definedRisk: true, proxyOverlay: true, notCoveredOverlay: true, maxLoss: pcs?.maxLoss, buyingPowerImpact: pcs?.buyingPowerImpact, riskBudgetUsed: pcs?.riskBudgetUsed, credit: pcs?.credit } satisfies OptionOrder);
          }
        }
      } else if ((proposal.action === 'ADD_CALL_SPREAD' || proposal.action === 'OPEN_BEAR_CALL_SPREAD') && strikes) {
        if (!ctx.input.optionChains?.QQQ) {
          warnings.push(`QQQ 期权链缺失，跳过 ${proposal.action} 订单`);
          continue;
        }
        const isBearSpread = proposal.action === 'OPEN_BEAR_CALL_SPREAD';
        const spreadValidation = validateCallCreditSpread({
          underlying: 'QQQ',
          shortCallStrike: strikes.spread_short_strike,
          longCallStrike: strikes.spread_long_strike,
        });
        if (!spreadValidation.ok) {
          warnings.push(spreadValidation.reason!);
        } else if (strikes.spread_short_strike && strikes.spread_long_strike && strikes.expiry) {
          const strategyName = isBearSpread
            ? `QQQ Bear Call Spread @${strikes.spread_short_strike}/${strikes.spread_long_strike}`
            : proposal.callCreditSpread?.strategyName ?? `QQQ Call Credit Spread @${strikes.spread_short_strike}/${strikes.spread_long_strike}`;
          const maxLoss = isBearSpread
            ? proposal.bearCallSpread?.maxLoss
            : proposal.callCreditSpread?.maxLoss;
          const riskBudgetUsed = isBearSpread
            ? proposal.bearCallSpread?.riskBudgetUsed
            : proposal.callCreditSpread?.riskBudgetUsed;
          const credit = isBearSpread
            ? proposal.bearCallSpread?.credit
            : proposal.callCreditSpread?.credit;
          const groupId = `${isBearSpread ? 'bear-call-spread' : 'call-credit-spread'}-${strikes.expiry}-${strikes.spread_short_strike}-${strikes.spread_long_strike}`;
          proposals.push({
            kind: 'option',
            symbol: 'QQQ',
            strike: strikes.spread_short_strike,
            expiry: strikes.expiry,
            optionType: 'call',
            side: 'SELL',
            quantity: isBearSpread ? proposal.bearCallSpread?.quantity ?? 1 : proposal.callCreditSpread?.quantity ?? 1,
            urgency: 'SAME_DAY',
            rationale: `${strategyName} 短腿：卖出 Call ${strikes.spread_short_strike}，到期 ${strikes.expiry}`,
            strategyName,
            strategyTag: isBearSpread ? OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD : OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD,
            groupId,
            legRole: 'short_call',
            definedRisk: true,
            proxyOverlay: true,
            notCoveredOverlay: true,
            maxLoss,
            buyingPowerImpact: maxLoss,
            riskBudgetUsed,
            credit,
          } satisfies OptionOrder);
          proposals.push({
            kind: 'option',
            symbol: 'QQQ',
            strike: strikes.spread_long_strike,
            expiry: strikes.expiry,
            optionType: 'call',
            side: 'BUY',
            quantity: isBearSpread ? proposal.bearCallSpread?.quantity ?? 1 : proposal.callCreditSpread?.quantity ?? 1,
            urgency: 'SAME_DAY',
            rationale: `${strategyName} 长腿：买入 Call ${strikes.spread_long_strike}（定义风险保护），到期 ${strikes.expiry}`,
            strategyName,
            strategyTag: isBearSpread ? OVERLAY_STRATEGY_TAGS.QQQ_BEAR_CALL_SPREAD : OVERLAY_STRATEGY_TAGS.QQQ_CALL_CREDIT_SPREAD,
            groupId,
            legRole: 'long_call',
            definedRisk: true,
            proxyOverlay: true,
            notCoveredOverlay: true,
            maxLoss,
            buyingPowerImpact: maxLoss,
            riskBudgetUsed,
            credit,
          } satisfies OptionOrder);
        }
      } else if (proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD' && strikes) {
        const validation = validatePutCreditSpread({ underlying: 'QQQ', shortPutStrike: strikes.eb_short_strike, longPutStrike: strikes.eb_long_strike });
        if (!validation.ok) warnings.push(validation.reason!);
        else if (strikes.eb_short_strike && strikes.eb_long_strike && strikes.expiry) {
          const eb = proposal.equityBoostPutSpread;
          const strategyName = eb?.strategyName ?? `QQQ Equity Boost Put Spread @${strikes.eb_long_strike}/${strikes.eb_short_strike}`;
          const groupId = `equity-boost-put-spread-${strikes.expiry}-${strikes.eb_long_strike}-${strikes.eb_short_strike}`;
          for (const [strike, side, legRole] of [[strikes.eb_short_strike, 'SELL', 'short_put'], [strikes.eb_long_strike, 'BUY', 'long_put']] as const) {
            proposals.push({ kind: 'option', symbol: 'QQQ', strike, expiry: strikes.expiry, optionType: 'put', side, quantity: eb?.quantity ?? 1, urgency: 'SAME_DAY', rationale: `${strategyName}：${side === 'SELL' ? '卖出' : '买入'} Put ${strike}`, strategyName, strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_EQUITY_BOOST_PUT_SPREAD, groupId, legRole, definedRisk: true, proxyOverlay: true, notCoveredOverlay: true, maxLoss: eb?.maxLoss, buyingPowerImpact: eb?.buyingPowerImpact, riskBudgetUsed: eb?.riskBudgetUsed, credit: eb?.credit } satisfies OptionOrder);
          }
        }
      } else if (proposal.action === 'ADD_IRON_CONDOR' && strikes) {
        if (!ctx.input.optionChains?.QQQ) {
          warnings.push(`QQQ 期权链缺失，跳过 ${proposal.action} 订单`);
          continue;
        }
        const icValidation = validateIronCondor({
          putLongStrike: strikes.ic_put_long,
          putShortStrike: strikes.ic_put_short,
          callShortStrike: strikes.ic_call_short,
          callLongStrike: strikes.ic_call_long,
        });
        if (!icValidation.ok) warnings.push(icValidation.reason!);
        else if (strikes.ic_put_long && strikes.ic_put_short && strikes.ic_call_short && strikes.ic_call_long && strikes.expiry) {
          const quantity = proposal.ironCondor?.quantity ?? 1;
          const strategyName = proposal.ironCondor?.strategyName ?? `QQQ Iron Condor @${strikes.ic_put_long}/${strikes.ic_put_short}/${strikes.ic_call_short}/${strikes.ic_call_long}`;
          const groupId = `iron-condor-${strikes.expiry}-${strikes.ic_put_long}-${strikes.ic_put_short}-${strikes.ic_call_short}-${strikes.ic_call_long}`;
          const maxLoss = proposal.ironCondor?.maxLoss;
          const credit = proposal.ironCondor?.totalCredit;
          const riskBudgetUsed = proposal.ironCondor?.riskBudgetUsed;
          const common = {
            kind: 'option' as const,
            symbol: 'QQQ',
            expiry: strikes.expiry,
            quantity,
            urgency: 'SAME_DAY' as const,
            strategyName,
            strategyTag: OVERLAY_STRATEGY_TAGS.QQQ_IRON_CONDOR,
            groupId,
            definedRisk: true,
            proxyOverlay: true,
            notCoveredOverlay: true,
            maxLoss,
            buyingPowerImpact: maxLoss,
            riskBudgetUsed,
            credit,
          };
          proposals.push(
            {
              ...common,
              strike: strikes.ic_put_long,
              optionType: 'put',
              side: 'BUY',
              rationale: `${strategyName} Put 保护腿：买入 Put ${strikes.ic_put_long}，到期 ${strikes.expiry}`,
              legRole: 'long_put',
            } satisfies OptionOrder,
            {
              ...common,
              strike: strikes.ic_put_short,
              optionType: 'put',
              side: 'SELL',
              rationale: `${strategyName} Put 收益腿：卖出 Put ${strikes.ic_put_short}，到期 ${strikes.expiry}`,
              legRole: 'short_put',
            } satisfies OptionOrder,
            {
              ...common,
              strike: strikes.ic_call_short,
              optionType: 'call',
              side: 'SELL',
              rationale: `${strategyName} Call 收益腿：卖出 Call ${strikes.ic_call_short}，到期 ${strikes.expiry}`,
              legRole: 'short_call',
            } satisfies OptionOrder,
            {
              ...common,
              strike: strikes.ic_call_long,
              optionType: 'call',
              side: 'BUY',
              rationale: `${strategyName} Call 保护腿：买入 Call ${strikes.ic_call_long}，到期 ${strikes.expiry}`,
              legRole: 'long_call',
            } satisfies OptionOrder,
          );
        }
      }
      }
    }
  }

  const status = warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'OrderProposal',
    status,
    data: {
      proposals,
      flashCrashState: currentFlashCrashState,
    },
    warnings,
    blockers,
  };
}
