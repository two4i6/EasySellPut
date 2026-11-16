/**
 * Research reference projection ONLY, not a standalone admission implementation.
 * Replays accepted-source close/settle events in actual-date order. The SDK
 * strategy uses the same pure state transitions with live execution feedback.
 */
import type { QqqEb2Cycle } from './QqqEb2E44Fused';
import type { StrategyObject } from '../../backtest-scripts/strategy-module-v2';
import { applyE209CooldownSettlement, decideE209Cooldown, initializeE209Cooldown } from '../../backtest-scripts/strategies/eb7-e209-sources-v2';

export const E1_SETTLEMENT_COOLDOWN_REFERENCE_VERSION = 'e1-settlement-feedback-reference-v1';
export function projectE1SettlementCooldownReference(base: readonly QqqEb2Cycle[]) {
  let state = initializeE209Cooldown();
  const kept: QqqEb2Cycle[] = [], cooldownBlocked: QqqEb2Cycle[] = [];
  const pending: QqqEb2Cycle[] = [], feedback: Array<{ asOf: string; signalDate: string; pnl: number }> = [];
  for (const cycle of base) {
    const asOf = cycle.open.signalDate ?? cycle.open.date;
    // Only positions actually accepted by this source can generate its cooldown.
    // Never update from the current proposal's future pnl or its future close date.
    const closed = pending.filter(position => position.close.date <= asOf)
      .sort((a, b) => a.close.date.localeCompare(b.close.date));
    for (const position of closed) {
      state = applyE209CooldownSettlement(state, position.close.date, position.pnl);
      feedback.push({ asOf: position.close.date, signalDate: position.open.signalDate ?? position.open.date, pnl: position.pnl });
      pending.splice(pending.indexOf(position), 1);
    }
    const step = decideE209Cooldown(state, asOf, (cycle.open.marketContext ?? {}) as unknown as StrategyObject);
    state = step.state;
    if (!step.admitted) { cooldownBlocked.push(cycle); continue; }
    kept.push(cycle); pending.push(cycle);
  }
  return { kept, cooldownBlocked, feedback, state, version: E1_SETTLEMENT_COOLDOWN_REFERENCE_VERSION };
}
