import type { PipelineContext, EngineResult, ExecutionGuardData } from '../types/pipeline';
import type { OptionPosition } from '../types/input';
import { isUpstreamBlocked } from '../types/pipeline';
import { leveragedDeadbandPctForTrade, MIN_BUY_DELTA_PCT } from '../constants';

const DTE_EXPIRY_WARN_DAYS = 3;

export function runExecutionGuard(ctx: PipelineContext): EngineResult<ExecutionGuardData> {
  const { account, date: systemDate } = ctx.input;
  const warnings: string[] = [];
  const blockers: string[] = [];
  const rejectionReasons: string[] = [];

  const nav = account.netLiquidation;
  const optionPositions: OptionPosition[] = account.optionPositions ?? [];

  // Check pending expirations
  const pending: OptionPosition[] = optionPositions.filter(op => {
    const daysToExpiry =
      (new Date(op.expiry).getTime() - new Date(systemDate).getTime()) / 86400000;
    return daysToExpiry <= DTE_EXPIRY_WARN_DAYS;
  });
  if (pending.length > 0) {
    const symbols = pending.map(p => `${p.symbol} ${p.type.toUpperCase()} ${p.strike} exp ${p.expiry}`).join(', ');
    warnings.push(`有即将到期期权仓位（≤${DTE_EXPIRY_WARN_DAYS}天）：${symbols}`);
  }

  // Check if allocation change is large enough to trade
  const finalTqqqPct = ctx.results.riskBudget?.data.final_tqqq_pct ?? 0;
  const finalBoxxPct = ctx.results.riskBudget?.data.final_boxx_pct ?? 0;
  const regime = ctx.results.regime?.data.regime ?? 'SIDEWAYS';

  const leveragedSym = ctx.input.leveragedSymbol ?? 'TQQQ';
  const tqqqPos = account.positions.find(p => p.symbol === leveragedSym);
  const boxxPos = account.positions.find(p => p.symbol === 'BOXX');
  const currentTqqqPct = nav > 0 ? (tqqqPos?.marketValue ?? 0) / nav : 0;
  const currentBoxxPct = nav > 0 ? (boxxPos?.marketValue ?? 0) / nav : 0;

  // Use the same directional floors as 10-order-proposal so the guard never approves
  // an 'equity' trade that the order engine would then silently drop (5% buy / 10% sell
  // for the leveraged ETF; BOXX uses the buy floor in both directions, matching order-proposal).
  const tqqqDelta = Math.abs(finalTqqqPct - currentTqqqPct);
  const boxxDelta = Math.abs(finalBoxxPct - currentBoxxPct);
  const tqqqSide = finalTqqqPct - currentTqqqPct > 0 ? 'BUY' : 'SELL';
  const bindingConstraint = ctx.results.riskBudget?.data.binding_constraint;
  const tqqqFloor = leveragedDeadbandPctForTrade({
    side: tqqqSide,
    regime,
    params: ctx.input.strategyParams,
    postCrisisBars: ctx.input.postCrisisBars,
    qqqBars: ctx.input.prices.QQQ,
    lastLeveragedTrade: ctx.input.lastLeveragedTrade,
    riskSellExempt: tqqqSide === 'SELL' && (isUpstreamBlocked(ctx) || bindingConstraint === 'hard_risk' || regime === 'BEAR' || regime === 'CRISIS'),
    postCrisisFastEntry: ctx.stockPolicy?.value.overrides.postCrisisFastEntry,
    actualTqqqPct: currentTqqqPct,
    targetTqqqPct: finalTqqqPct,
  });
  const boxxFloor = MIN_BUY_DELTA_PCT;
  const trade_delta_too_small = tqqqDelta < tqqqFloor && boxxDelta < boxxFloor;

  if (trade_delta_too_small) {
    rejectionReasons.push(
      `仓位变动过小（TQQQ Δ=${(tqqqDelta * 100).toFixed(1)}% < ${(tqqqFloor * 100).toFixed(0)}%, BOXX Δ=${(boxxDelta * 100).toFixed(1)}% < ${(boxxFloor * 100).toFixed(0)}%），跳过交易`
    );
    warnings.push(rejectionReasons.at(-1)!);
  }

  // Overlay viability check
  const overlay = ctx.results.overlay?.data;
  const overlayAction = overlay?.action ?? 'NONE';
  const overlayProposals = overlay?.overlayProposals?.length
    ? overlay.overlayProposals
    : overlay && overlayAction !== 'NONE'
      ? [overlay]
      : [];
  const leveragedSymbol = ctx.input.leveragedSymbol ?? 'TQQQ';
  const hasChain = overlayProposals.length === 0 || overlayProposals.some(proposal =>
    proposal.action === 'ADD_COLLAR'
      ? !!ctx.input.optionChains?.[leveragedSymbol]
      : !!ctx.input.optionChains?.QQQ
  );
  const approvedTypes: ('equity' | 'option')[] = [];

  for (const proposal of overlayProposals) {
    if (proposal.action === 'ADD_COLLAR' && proposal.collar && proposal.collar.underlying !== leveragedSymbol) {
      rejectionReasons.push(`${proposal.collar.underlying} short call is not covered by ${leveragedSymbol} shares`);
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_COLLAR' && proposal.collar && proposal.collar.quantity <= 0) {
      rejectionReasons.push(`${leveragedSymbol} shares are insufficient to cover short call`);
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_CALL_SPREAD' && !proposal.callCreditSpread?.definedRisk) {
      rejectionReasons.push('QQQ Call Credit Spread requires defined-risk long call leg');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_PUT_CREDIT_SPREAD' && !proposal.putCreditSpread?.definedRisk) {
      rejectionReasons.push('QQQ Put Credit Spread requires defined-risk long put leg');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_PCS_RESCUE' && !proposal.pcsRescuePutSpread?.definedRisk) {
      rejectionReasons.push('QQQ PCS Rescue requires defined-risk long put leg');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_IRON_CONDOR' && !proposal.ironCondor?.definedRisk) {
      rejectionReasons.push('QQQ Iron Condor requires both defined-risk spreads');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD' && !proposal.equityBoostPutSpread?.definedRisk) {
      rejectionReasons.push('QQQ Equity Boost Put Spread requires defined-risk long put leg');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (
      proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD' &&
      proposal.equityBoostPutSpread &&
      (proposal.equityBoostPutSpread.quantity == null || proposal.equityBoostPutSpread.quantity <= 0)
    ) {
      rejectionReasons.push('QQQ Equity Boost Put Spread sizing degraded to zero contracts');
      blockers.push(rejectionReasons.at(-1)!);
    }
    if (proposal.action === 'OPEN_BEAR_CALL_SPREAD' && proposal.bearCallSpread && proposal.bearCallSpread.definedRisk !== true) {
      rejectionReasons.push('QQQ Bear Call Spread requires defined-risk long call leg');
      blockers.push(rejectionReasons.at(-1)!);
    }
  }

  if (!trade_delta_too_small) approvedTypes.push('equity');
  if (overlayProposals.length > 0 && hasChain && blockers.length === 0) approvedTypes.push('option');
  if (overlayProposals.length > 0 && !hasChain) {
    rejectionReasons.push('期权 Overlay 建议存在，但期权链数据缺失，跳过期权订单');
    warnings.push(rejectionReasons.at(-1)!);
  }

  const approved = blockers.length === 0 && !trade_delta_too_small;

  const status = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'ExecutionGuard',
    status,
    data: {
      approved,
      requires_margin_check: overlayProposals.length > 0,
      pending_expirations: pending,
      trade_delta_too_small,
      approved_proposal_types: approvedTypes,
      rejection_reasons: rejectionReasons,
    },
    warnings,
    blockers,
  };
}
