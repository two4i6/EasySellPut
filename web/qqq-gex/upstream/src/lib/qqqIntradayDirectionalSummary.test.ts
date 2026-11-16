import { expect, test } from 'bun:test';
import type { QqqIntradayDirectionalReplayResult, QqqIntradayDirectionalReplaySignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import {
  aggregateQqqIntradayDirectionalDailySummaries,
  previousQqqTradingDate,
  qqqIntradayDirectionalDayBounds,
  type QqqIntradayDirectionalDailySummary,
} from './qqqIntradayDirectionalSummary';

const signal = (overrides: Partial<QqqIntradayDirectionalReplaySignal> = {}): QqqIntradayDirectionalReplaySignal => ({
  signalId: 'signal-1', structureId: 'structure-1', alertType: 'CONFIRMED', date: '2026-08-07', direction: 'LONG', grade: 'A', intent: 'ENTRY', stage: 'TRIGGERED', regime: 'RANGE', playbook: 'RANGE_REVERSAL', anchorBar: '2026-08-07T14:00:00.000Z', entryZone: { low: 99, high: 100 }, invalidation: 98, targets: { oneR: 101, structure: 102, structureR: 2 }, riskPlan: null, validUntil: '2026-08-07T14:06:00.000Z', planExpiresAt: '2026-08-07T14:32:00.000Z', fill: { time: '2026-08-07T14:02:00.000Z', price: 99.5 }, outcome: 'TARGET_1R', exit: { time: '2026-08-07T14:10:00.000Z', price: 101 }, netR: 0.8, mfeR: 1, maeR: 0.2, reachedHalfRBeforeInvalidation: true, opportunityEvaluation: null, riskEvaluation: null, ...overrides,
});

const emptyReplay = (signals: QqqIntradayDirectionalReplaySignal[]): QqqIntradayDirectionalReplayResult => ({
  policyVersion: 'qqq-directional-intraday-v7', discovery: true, days: 1, completeDays: 1, completeDayDates: ['2026-08-07'], signalDays: 1, dailyCoverageRate: 1,
  gradeStats: { A: { signals: 1, filled: 1, signalDays: 1, winRate: 1, averageNetR: 0.8, profitFactor: null }, B: { signals: 0, filled: 0, signalDays: 0, winRate: null, averageNetR: null, profitFactor: null }, C: { signals: 0, filled: 0, signalDays: 0, winRate: null, averageNetR: null, profitFactor: null } },
  opportunityStats: { signals: 0, evaluated: 0, halfRSuccessRate: null, invalidatedBeforeHalfRRate: null, averageMfeR: null, averageMaeR: null },
  lifecycleStats: { opportunityStructures: 0, confirmedSignals: 1, confirmedUpgrades: 0, directConfirmed: 1, confirmedUpgradeRate: null },
  groupedStats: { opportunity: { direction: {}, regime: {}, timeBucket: {}, playbook: {} }, confirmed: { direction: {}, regime: {}, timeBucket: {}, playbook: {} } },
  riskStats: { elevated: 0, stopCandidates: 0, emitted: 0, evaluated: 0, confirmedRisk: 0, falseStop: 0, neutral: 0, pending: 0, confirmedRiskRate: null, falseStopRate: null, averageAdverseMove30mAtr: null },
  sessionStats: { entrySignals: 1, confirmedEntrySignals: 1, entryLifecycleEvents: 1, riskCues: 0, entrySignalDays: 1, dataCompleteDays: 1, dataCompleteSignalDays: 1, dataCompleteCoverageRate: 1, riskCueDays: 0, longEntrySignals: 1, shortEntrySignals: 0, averageEntrySignalsPerCompleteDay: 1, averageEntrySignalsPerEntryDay: 1, averageEntrySignalsPerDataCompleteDay: 1, averageRiskCuesPerCompleteDay: 0 },
  funnel: { evaluatedBars: 1, alertWindowBars: 1, dataReadyWindowBars: 1, insufficientDataBars: 0, entry: { evaluatedBars: 1, setups: 0, armed: 0, triggerCandidates: 1, emitted: 1, confirmed: 1, rearmBlocked: 0, budgetBlocked: 0 }, risk: { evaluatedBars: 0, elevated: 0, stopCandidates: 0, emitted: 0, rearmBlocked: 0, budgetBlocked: 0 }, noSignalDates: [], topBlockers: [] },
  dailyStats: [{ date: '2026-08-07', complete: true, alertWindowBars: 1, dataReadyWindowBars: 1, opportunitySignals: 1, confirmedSignals: 1, riskCues: 0 }], signals, fingerprint: 'fixture',
});

const daily = (sessionDate: string, signals: QqqIntradayDirectionalReplaySignal[]): QqqIntradayDirectionalDailySummary => ({
  policyId: 'qqq-pcs-intraday-v1', sessionDate, computedAt: `${sessionDate}T21:00:00.000Z`, complete: true,
  dataQuality: { alertWindowBars: 180, dataReadyWindowBars: 180, coverageRatio: 1 }, summary: emptyReplay(signals), fingerprint: `fingerprint-${sessionDate}`,
});

test('QQQ directional day bounds use Eastern midnight and next-day isolation', () => {
  expect(qqqIntradayDirectionalDayBounds('2026-08-07')).toEqual({ from: '2026-08-07T04:00:00.000Z', to: '2026-08-08T04:00:00.000Z' });
});

test('previous QQQ trading date skips weekends', () => {
  expect(previousQqqTradingDate(new Date('2026-08-10T12:00:00.000Z'))).toBe('2026-08-07');
});

test('daily summary aggregation separates upgrades, direct confirmations, risk quality and groups', () => {
  const opportunity = signal({ signalId: 'opportunity', structureId: 'structure-upgrade', alertType: 'OPPORTUNITY', stage: 'ARMED', grade: 'C', netR: null, fill: null, outcome: 'ZONE_REACHED', opportunityEvaluation: { zoneReachedWithin30m: true, minutesToZone: 2, reachedHalfRWithin30m: true, reachedHalfRBeforeInvalidation: true, invalidatedBeforeHalfR: false, mfeR: 1.1, maeR: 0.2 } });
  const upgrade = signal({ signalId: 'upgrade', structureId: 'structure-upgrade', stage: 'TRIGGERED', grade: 'C', netR: 0.4 });
  const direct = signal({ signalId: 'direct', structureId: 'structure-direct', direction: 'SHORT', grade: 'B', netR: -0.3, outcome: 'INVALIDATION' });
  const risk = signal({ signalId: 'risk', structureId: 'risk-1', intent: 'RISK_CUE', alertType: 'RISK', stage: 'STOP_RISK', grade: null, direction: 'SHORT', playbook: 'DIRECTIONAL_WATCH', riskPlan: { atRisk: 'SP', severity: 'STOP', triggerZone: { low: 100, high: 101 }, recoveryLevel: 101 }, entryZone: null, invalidation: null, targets: null, fill: null, exit: null, netR: null, outcome: 'RISK_CUE', riskEvaluation: { adverseMove10mAtr: 1, adverseMove20mAtr: 2, adverseMove30mAtr: 2.5, recoveredWithin30m: false, classification: 'CONFIRMED_RISK' } });
  const result = aggregateQqqIntradayDirectionalDailySummaries([daily('2026-08-07', [opportunity, upgrade, direct, risk])]);
  expect(result?.lifecycleStats).toMatchObject({ opportunityStructures: 1, confirmedSignals: 2, confirmedUpgrades: 1, directConfirmed: 1, confirmedUpgradeRate: 1 });
  expect(result?.riskStats).toMatchObject({ emitted: 1, evaluated: 1, confirmedRisk: 1, confirmedRiskRate: 1 });
  expect(result?.groupedStats.confirmed.direction.LONG).toMatchObject({ evaluated: 1, successes: 1 });
  expect(result?.groupedStats.confirmed.direction.SHORT).toMatchObject({ evaluated: 1, successes: 0 });
  expect(result?.groupedStats.opportunity.direction.LONG).toMatchObject({ evaluated: 1, successes: 1 });
});
