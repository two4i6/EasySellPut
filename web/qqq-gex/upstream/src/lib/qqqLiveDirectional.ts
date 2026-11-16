import type { FactorMap } from '@/types/factor';
import { createRawFactor } from './factor';
import { decisionEngine } from './engines/core/DecisionEngine';
import { qqqMarketSession } from './qqqMarketSession';
import { QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF, QQQ_INTRADAY_DIRECTIONAL_POLICY, qqqDirectionalSameStructure, qqqDirectionalCanRearm, type QqqIntradayDirectionalDecision, type QqqIntradayBar } from './engines/analysis/QqqIntradayDirectional';

/** Live adapters share the regular-session input used by the PCS decision path. */
export function qqqDirectionalRegularBars(bars: readonly QqqIntradayBar[]) {
  return bars.filter(bar => Number.isFinite(Date.parse(bar.timestamp)) && qqqMarketSession(new Date(bar.timestamp)).stocksOpen);
}

/** Same canonical live lifecycle used by the page and scheduled capture. Never runs a historical replay. */
export function evaluateQqqDirectionalWithHistory(factors: FactorMap, bars: readonly QqqIntradayBar[], directionalSignals: readonly QqqIntradayDirectionalDecision[]) {
  let directionalDecision = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
  if (directionalDecision.signalId && directionalDecision.direction && directionalDecision.playbook && directionalDecision.anchorBar && directionalDecision.stage) {
      const previous = [...directionalSignals].reverse().find((signal) => signal.signalId !== directionalDecision.signalId
        && qqqDirectionalSameStructure(factors, directionalDecision, signal));
      const canRearm = previous ? qqqDirectionalCanRearm({
        factors: factors,
        current: directionalDecision,
        previous,
        bars: bars,
      }) : true;
      const rank = (stage: string | null) => stage === 'SETUP' || stage === 'RISK_ELEVATED' ? 1
        : stage === 'ARMED' || stage === 'STOP_RISK' ? 2 : stage === 'TRIGGERED' ? 3 : 0;
      if (previous && !canRearm && rank(directionalDecision.stage) > rank(previous.stage)) {
        const first = directionalSignals.find((signal) => signal.structureId === previous.structureId) ?? previous;
        factors[QDF.lifecycleStructureId] = createRawFactor(previous.structureId!, (value) => typeof value === 'string' && value.length > 0, 'engine_signal_run.lifecycle');
        factors[QDF.lifecycleAnchor] = createRawFactor(Date.parse(first.anchorBar!), Number.isFinite, 'engine_signal_run.lifecycle');
      } else if (previous && !canRearm) {
        const suppressFactor = rank(directionalDecision.stage) === rank(previous.stage) ? QDF.duplicateSuppressed : QDF.rearmSuppressed;
        factors[suppressFactor] = createRawFactor(true, (value) => value === true, 'engine_signal_run.lifecycle');
      } else {
        const entryStructures = new Set(directionalSignals.filter((signal) => signal.intent === 'ENTRY').map((signal) => signal.structureId)).size;
        const riskStructures = new Set(directionalSignals.filter((signal) => signal.intent === 'RISK_CUE').map((signal) => signal.structureId)).size;
        if (directionalDecision.intent === 'ENTRY' && entryStructures >= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxEntrySignalsPerDay) {
          factors[QDF.entryBudgetReached] = createRawFactor(true, (value) => value === true, 'engine_signal_run');
        }
        if (directionalDecision.intent === 'RISK_CUE' && riskStructures >= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxRiskCuesPerDay) {
          factors[QDF.riskCueBudgetReached] = createRawFactor(true, (value) => value === true, 'engine_signal_run');
        }
      }
      directionalDecision = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
    }
  return directionalDecision;
}
