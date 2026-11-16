import type { MarketEnvironmentSnapshot } from '../../types/output';
import { OverlayBook } from '../book';
import type { PortfolioState } from './execution-state';

export type PendingEquityOrder = {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  rationale: string;
  signalDate: string;
  signalClose: number;
  executionReason?: string;
  executionReasonKey?: string;
  targetPct?: number;
  marketContext?: MarketEnvironmentSnapshot;
  twap?: { executionDate: string; barsRemaining: number };
};

export type EquityExecution = {
  quantity: number;
  shares: number;
  costBasis: number;
  cash: number;
  cashImpact: number;
  pnl?: number;
};

export type PendingEquityOrderExecution = {
  order: PendingEquityOrder;
  isLeveraged: boolean;
  fillPrice: number;
  fill: EquityExecution;
};

/** 次日股票订单的统一填价；冲击系数由日循环根据 ADV/VIX 预先计算。 */
export function resolveEquityOrderFill(input: {
  side: 'BUY' | 'SELL';
  mode: 'next_open' | 'mid' | 'worst_of';
  signalClose: number;
  nextOpen: number;
  slippagePct: number;
}): number {
  let rawPrice = input.nextOpen;
  if (input.signalClose > 0 && input.mode !== 'next_open') {
    rawPrice = input.mode === 'mid'
      ? (input.signalClose + input.nextOpen) / 2
      : input.side === 'BUY'
        ? Math.max(input.signalClose, input.nextOpen)
        : Math.min(input.signalClose, input.nextOpen);
  }
  return input.side === 'BUY' ? rawPrice * (1 + input.slippagePct) : rawPrice * (1 - input.slippagePct);
}

/** 股票与 BOXX 共用的平均成本成交；调用方负责滑点、账本字段映射和日志。 */
export function executeEquityFill(input: {
  side: 'BUY' | 'SELL';
  requestedQuantity: number;
  fillPrice: number;
  cash: number;
  shares: number;
  costBasis: number;
}): EquityExecution {
  if (input.side === 'BUY') {
    const quantity = Math.min(input.requestedQuantity, Math.floor(input.cash / input.fillPrice));
    const cost = quantity * input.fillPrice;
    return { quantity, shares: input.shares + quantity, costBasis: input.costBasis + cost, cash: input.cash - cost, cashImpact: -cost };
  }
  const quantity = Math.min(input.requestedQuantity, input.shares);
  const proceeds = quantity * input.fillPrice;
  const averageCost = input.shares > 0 ? input.costBasis / input.shares : 0;
  return {
    quantity,
    shares: input.shares - quantity,
    costBasis: Math.max(0, input.costBasis - averageCost * quantity),
    cash: input.cash + proceeds,
    cashImpact: proceeds,
    pnl: proceeds - averageCost * quantity,
  };
}

/** 消费日初订单队列；调用方仅负责按成交结果记录日志。 */
export function executePendingEquityOrders(input: {
  orders: OverlayBook<PendingEquityOrder>;
  portfolio: PortfolioState;
  leveragedSymbol: string;
  resolveFillPrice: (order: PendingEquityOrder) => number;
  shouldExecute?: (order: PendingEquityOrder) => boolean;
  requestedQuantityForOrder?: (order: PendingEquityOrder) => number;
  sellFirst?: boolean;
  afterExecution?: (order: PendingEquityOrder, execution: PendingEquityOrderExecution) => PendingEquityOrder | undefined;
}): PendingEquityOrderExecution[] {
  const executions: PendingEquityOrderExecution[] = [];
  const deferred: PendingEquityOrder[] = [];
  const pending = input.orders.drain();
  const ordered = input.sellFirst
    ? pending.sort((a, b) => Number(a.side === 'BUY') - Number(b.side === 'BUY'))
    : pending;
  for (const order of ordered) {
    if (input.shouldExecute && !input.shouldExecute(order)) {
      deferred.push(order);
      continue;
    }
    const fillPrice = input.resolveFillPrice(order);
    if (fillPrice <= 0) continue;
    const isLeveraged = order.symbol === input.leveragedSymbol;
    const shares = isLeveraged ? input.portfolio.leveragedShares : input.portfolio.boxxShares;
    const costBasis = isLeveraged ? input.portfolio.leveragedCostBasis : input.portfolio.boxxCostBasis;
    const fill = executeEquityFill({ side: order.side, requestedQuantity: input.requestedQuantityForOrder?.(order) ?? order.quantity, fillPrice, cash: input.portfolio.cash, shares, costBasis });
    if (fill.quantity <= 0) continue;
    input.portfolio.cash = fill.cash;
    if (isLeveraged) {
      input.portfolio.leveragedShares = fill.shares;
      input.portfolio.leveragedCostBasis = fill.costBasis;
    } else {
      input.portfolio.boxxShares = fill.shares;
      input.portfolio.boxxCostBasis = fill.costBasis;
    }
    const execution = { order, isLeveraged, fillPrice, fill };
    executions.push(execution);
    const remaining = input.afterExecution?.(order, execution);
    if (remaining) deferred.push(remaining);
  }
  input.orders.push(...deferred);
  return executions;
}
