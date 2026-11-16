import type { OrderProposal } from './types/output';

export type CoveredShortCallValidation = {
  ok: boolean;
  quantity: number;
  coveredByShares: boolean;
  coveredSharesRequired: number;
  currentShares: number;
  uncoveredQuantity: number;
  reason?: string;
};

export function validateCoveredShortCall(input: {
  underlying: string;
  leveragedSymbol: string;
  requestedQuantity: number;
  leveragedSymbolShares: number;
  contractMultiplier?: number;
}): CoveredShortCallValidation {
  const currentShares = Math.max(0, Math.floor(input.leveragedSymbolShares));
  if (input.underlying !== input.leveragedSymbol) {
    return {
      ok: false,
      quantity: 0,
      coveredByShares: false,
      coveredSharesRequired: Math.max(0, input.requestedQuantity) * (input.contractMultiplier ?? 100),
      currentShares,
      uncoveredQuantity: Math.max(0, input.requestedQuantity),
      reason: `${input.underlying} short call is not covered by ${input.leveragedSymbol} shares`,
    };
  }

  const multiplier = input.contractMultiplier ?? 100;
  const maxCoveredQuantity = Math.floor(currentShares / multiplier);
  const quantity = Math.min(Math.max(0, Math.floor(input.requestedQuantity)), maxCoveredQuantity);
  const uncoveredQuantity = Math.max(0, Math.floor(input.requestedQuantity) - quantity);

  return {
    ok: quantity > 0,
    quantity,
    coveredByShares: quantity > 0 && uncoveredQuantity === 0,
    coveredSharesRequired: quantity * multiplier,
    currentShares,
    uncoveredQuantity,
    reason: quantity > 0 ? undefined : `${input.leveragedSymbol} shares are insufficient to cover short call`,
  };
}

export function validateCollarPutSpread(input: { longPutStrike?: number; shortPutStrike?: number }): { ok: boolean; reason?: string } {
  if (input.longPutStrike == null || input.shortPutStrike == null) return { ok: false, reason: 'Collar Put Spread requires long put and lower short put' };
  return input.shortPutStrike < input.longPutStrike
    ? { ok: true }
    : { ok: false, reason: 'Collar short put must be below long put' };
}

export function validateCallCreditSpread(input: {
  underlying: string;
  shortCallStrike?: number;
  longCallStrike?: number;
}): { ok: boolean; reason?: string } {
  if (input.underlying !== 'QQQ') {
    return { ok: false, reason: 'Call Credit Spread must use QQQ' };
  }
  if (input.shortCallStrike == null || input.longCallStrike == null) {
    return { ok: false, reason: 'QQQ Call Credit Spread requires short call and higher long call' };
  }
  if (input.longCallStrike <= input.shortCallStrike) {
    return { ok: false, reason: 'QQQ Call Credit Spread long call must be above short call' };
  }
  return { ok: true };
}

export function validatePutCreditSpread(input: {
  underlying: string;
  shortPutStrike?: number;
  longPutStrike?: number;
}): { ok: boolean; reason?: string } {
  if (input.underlying !== 'QQQ') {
    return { ok: false, reason: 'Put Credit Spread must use QQQ' };
  }
  if (input.shortPutStrike == null || input.longPutStrike == null) {
    return { ok: false, reason: 'QQQ Put Credit Spread requires short put and lower long put' };
  }
  if (input.longPutStrike >= input.shortPutStrike) {
    return { ok: false, reason: 'QQQ Put Credit Spread long put must be below short put' };
  }
  return { ok: true };
}

export function validateIronCondor(input: {
  putLongStrike?: number;
  putShortStrike?: number;
  callShortStrike?: number;
  callLongStrike?: number;
}): { ok: boolean; reason?: string } {
  const hasPutSpread = input.putLongStrike != null && input.putShortStrike != null && input.putLongStrike < input.putShortStrike;
  const hasCallSpread = input.callShortStrike != null && input.callLongStrike != null && input.callShortStrike < input.callLongStrike;
  if (!hasPutSpread || !hasCallSpread) {
    return { ok: false, reason: 'QQQ Iron Condor requires both put spread and call spread' };
  }
  return { ok: true };
}

export function isDefinedRiskProxyOrder(order: OrderProposal): boolean {
  return order.kind === 'option' && order.definedRisk === true && order.proxyOverlay === true;
}
