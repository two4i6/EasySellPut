import { expect, test } from 'bun:test';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import { decisionEngine } from '@/lib/engines/core/DecisionEngine';
import { verdictEngine } from '@/lib/engines/core/VerdictEngine';
import {
  QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF,
  QQQ_INTRADAY_DIRECTIONAL_POLICY,
  buildQqqIntradayDirectionalFactors,
  qqqDirectionalCanRearm,
  qqqDirectionalDataBlockers,
  qqqDirectionalDataQuality,
  qqqDirectionalFactorValue,
  qqqDirectionalSameStructure,
  type QqqIntradayBar,
  type QqqIntradayDirectionalDecision,
  type QqqIntradayGexExpiry,
  type QqqIntradayRegime,
} from './QqqIntradayDirectional';
import { groupedSignals, simulateQqqIntradayDirectionalSignal, summarizeQqqIntradayDirectionalGrades, validateQqqIntradayDirectional, type QqqIntradayDirectionalReplaySignal } from './QqqIntradayDirectionalReplay';

const raw = <T>(value: T): FinancialFactor<T> => ({ value, confidence: 10, source: { type: 'raw', api: 'test' } });

const bars = (): QqqIntradayBar[] => Array.from({ length: 20 }, (_, index) => ({
  timestamp: new Date(Date.parse('2026-08-07T13:30:00.000Z') + index * 120_000).toISOString(),
  open: 100 + index * 0.08,
  high: 100.14 + index * 0.08,
  low: 99.94 + index * 0.08,
  close: 100.08 + index * 0.08,
  volume: 1_000 + index,
}));

const expiries = (): QqqIntradayGexExpiry[] => [0, 1, 2, 3].map((dte) => ({
  expiryDate: `2026-08-${String(7 + dte).padStart(2, '0')}`,
  dte,
  snapshots: [
    { time: '2026-08-07T14:07:00.000Z', netGex: 100 + dte, gammaFlip: 101.4, callWallPrice: 104, putWallPrice: 99 },
    { time: '2026-08-07T14:09:00.000Z', netGex: 110 + dte, gammaFlip: 101.4, callWallPrice: 104, putWallPrice: 99 },
  ],
}));

test('partial current-schema profiles preserve direction factors and unknown changes never confirm both sides',()=>{
 const row={strike:101,callOi:100,putOi:50,callIv:.2,putIv:.3,callGex:20,putGex:-10,totalGex:10,inputComplete:false,calculationVersion:'qqq-gex-full-1pct-v3',gexUnit:'per-1pct'};
 const input=expiries().map(e=>({...e,snapshots:e.snapshots.map((s,i)=>({...s,inputComplete:false,calculationVersion:row.calculationVersion,profile:[{...row,totalGex:i?15:10},{...row,strike:i?103:102,totalGex:9999}]}))}));
 const built=buildQqqIntradayDirectionalFactors({asOf:'2026-08-07T14:10:00Z',bars:bars(),expiries:input});
 expect(built.factors[QDF.gexDelta]!.value).toBe(5);
 expect(qqqDirectionalDataQuality(built.factors).partialGex).toBeTrue();
 expect(qqqDirectionalDataBlockers(built.factors)).toContain('PARTIAL_GEX_INPUT');
 expect(built.factors[QDF.dataReady]!.value).toBeFalse();
 expect(built.factors[QDF.gexDelta]!.confidence).toBeGreaterThan(0);
 const noPrevious=buildQqqIntradayDirectionalFactors({asOf:'2026-08-07T14:10:00Z',bars:bars(),expiries:expiries().map(e=>({...e,snapshots:e.snapshots.slice(1)}))});
 expect(noPrevious.factors[QDF.gexDelta]!.confidence).toBe(0);
 expect(noPrevious.factors[QDF.longGexOk]!.value).toBeFalse();
 expect(noPrevious.factors[QDF.shortGexOk]!.value).toBeFalse();
});

test('特征只读取已收盘当日 K 线与 anchor 之前的 GEX', () => {
  const baseBars = bars();
  const baseExpiries = expiries();
  const baseline = buildQqqIntradayDirectionalFactors({ asOf: '2026-08-07T14:10:00.000Z', bars: baseBars, expiries: baseExpiries });
  const withFuture = buildQqqIntradayDirectionalFactors({
    asOf: '2026-08-07T14:10:00.000Z',
    bars: [
      { ...baseBars[0]!, timestamp: '2026-08-06T14:00:00.000Z', close: 1 },
      ...baseBars,
      { ...baseBars.at(-1)!, timestamp: '2026-08-07T14:10:00.000Z', close: 999 },
    ],
    expiries: baseExpiries.map((expiry) => ({
      ...expiry,
      snapshots: [...expiry.snapshots, { ...expiry.snapshots.at(-1)!, time: '2026-08-07T14:11:00.000Z', netGex: -999_999 }],
    })),
  });
  expect(qqqDirectionalFactorValue(withFuture.factors, QDF.barCount, 0)).toBe(20);
  expect(qqqDirectionalFactorValue(withFuture.factors, QDF.price, 0)).toBe(qqqDirectionalFactorValue(baseline.factors, QDF.price, 0));
  expect(qqqDirectionalFactorValue(withFuture.factors, QDF.gexBalance, 0)).toBe(qqqDirectionalFactorValue(baseline.factors, QDF.gexBalance, 0));
});

test('多期限共识顺序无关，页面 expiry 选择不进入信号输入', () => {
  const input = { asOf: '2026-08-07T14:10:00.000Z', bars: bars(), expiries: expiries() };
  const left = buildQqqIntradayDirectionalFactors({ ...input, expiries: [...input.expiries].reverse(), selectedExpiry: '2026-08-10' } as typeof input);
  const right = buildQqqIntradayDirectionalFactors({ ...input, selectedExpiry: '2026-08-07' } as typeof input);
  expect(qqqDirectionalFactorValue(left.factors, QDF.selectedExpiries, '')).toBe('2026-08-07,2026-08-08,2026-08-09');
  expect(qqqDirectionalFactorValue(left.factors, QDF.gexBalance, 0)).toBe(qqqDirectionalFactorValue(right.factors, QDF.gexBalance, 0));
  expect(qqqDirectionalFactorValue(left.factors, QDF.regime, 'UNAVAILABLE')).toBe(qqqDirectionalFactorValue(right.factors, QDF.regime, 'UNAVAILABLE'));
});

const directionalFactors = (regime: QqqIntradayRegime): FactorMap => ({
  [QDF.dataReady]: raw(true),
  [QDF.alertWindow]: raw(true),
  [QDF.sessionIntent]: raw('ENTRY'),
  [QDF.etMinute]: raw(11 * 60),
  [QDF.regime]: raw(regime),
  [QDF.directionalBias]: raw(regime === 'TREND_DOWN' ? 'SHORT' : 'LONG'),
  [QDF.barCount]: raw(30),
  [QDF.expiryCount]: raw(3),
  [QDF.barAge]: raw(0),
  [QDF.gexAge]: raw(0),
  [QDF.selectedExpiries]: raw('2026-08-07,2026-08-08,2026-08-09'),
  [QDF.quoteAvailable]: raw(0),
  [QDF.quoteTotal]: raw(0),
  [QDF.atr]: raw(0.5),
  [QDF.putWall]: raw(98),
  [QDF.callWall]: raw(102),
  [QDF.flip]: raw(100),
  [QDF.supportCount]: raw(2),
  [QDF.resistanceCount]: raw(2),
  [QDF.supportLow]: raw(99),
  [QDF.supportHigh]: raw(100),
  [QDF.resistanceLow]: raw(100),
  [QDF.resistanceHigh]: raw(101),
  [QDF.momentumLow]: raw(99),
  [QDF.momentumHigh]: raw(100),
  [QDF.momentumCount]: raw(2),
  [QDF.momentumDistanceAtr]: raw(0),
  [QDF.momentumLongConfirm]: raw(true),
  [QDF.momentumShortConfirm]: raw(true),
  [QDF.longReclaim]: raw(true),
  [QDF.shortReclaim]: raw(true),
  [QDF.longSweepReclaim]: raw(true),
  [QDF.shortSweepReclaim]: raw(true),
  [QDF.rsiLongTurn]: raw(true),
  [QDF.rsiShortTurn]: raw(true),
  [QDF.rsiLongStep]: raw(true),
  [QDF.rsiShortStep]: raw(true),
  [QDF.volumeRatio]: raw(1),
  [QDF.volumeBreakout]: raw(false),
  [QDF.longVolumeOk]: raw(true),
  [QDF.shortVolumeOk]: raw(true),
  [QDF.longGexOk]: raw(true),
  [QDF.shortGexOk]: raw(true),
  [QDF.longWallOk]: raw(true),
  [QDF.shortWallOk]: raw(true),
  [QDF.longInvalidation]: raw(98),
  [QDF.shortInvalidation]: raw(102),
  [QDF.longTarget]: raw(104),
  [QDF.shortTarget]: raw(96),
  [QDF.longStructureR]: raw(3),
  [QDF.shortStructureR]: raw(3),
  [QDF.momentumLongInvalidation]: raw(98),
  [QDF.momentumShortInvalidation]: raw(101),
  [QDF.momentumLongTarget]: raw(104),
  [QDF.momentumShortTarget]: raw(96),
  [QDF.momentumLongStructureR]: raw(3),
  [QDF.momentumShortStructureR]: raw(3),
  [QDF.longZoneDistanceAtr]: raw(0),
  [QDF.shortZoneDistanceAtr]: raw(0),
  [QDF.scRiskElevated]: raw(false),
  [QDF.spRiskElevated]: raw(false),
  [QDF.scStopRisk]: raw(false),
  [QDF.spStopRisk]: raw(false),
  [QDF.anchor]: raw(Date.parse('2026-08-07T14:00:00.000Z')),
  [QDF.sessionDate]: raw('2026-08-07'),
});

test('缺 GEX/Wall 时 fail-closed，趋势只允许顺势方向', () => {
  const missing = directionalFactors('RANGE');
  missing[QDF.putWall] = { value: 0, confidence: 0, source: { type: 'fallback', reason: 'missing' } };
  expect(verdictEngine.getQqqIntradayDirectionalVerdict(missing).value.status).toBe('BLOCKED');
  expect(decisionEngine.getQqqIntradayDirectionalDecision(missing).value.status).toBe('INSUFFICIENT_DATA');

  const uptrend = directionalFactors('TREND_UP');
  uptrend[QDF.longReclaim] = raw(false);
  uptrend[QDF.directionalBias] = raw('SHORT');
  uptrend[QDF.etMinute] = raw(10 * 60 + 10);
  const verdict = verdictEngine.getQqqIntradayDirectionalVerdict(uptrend).value;
  expect(verdict.status).toBe('WATCH');
  expect(verdict.reasonCodes).toContain('COUNTER_TREND_BLOCKED');
});

test('多空对称地产生共享 DecisionEngine 提醒和稳定 signalId', () => {
  const longFactors = directionalFactors('TREND_UP');
  const shortFactors = directionalFactors('TREND_DOWN');
  const long = decisionEngine.getQqqIntradayDirectionalDecision(longFactors).value;
  const sameLong = decisionEngine.getQqqIntradayDirectionalDecision(longFactors).value;
  const short = decisionEngine.getQqqIntradayDirectionalDecision(shortFactors).value;
  expect(long.status).toBe('ALERT_LONG');
  expect(short.status).toBe('ALERT_SHORT');
  expect(long.grade).toBe('A');
  expect(short.grade).toBe('A');
  expect(long.signalId).toBe(sameLong.signalId);
  expect(long.signalId).not.toBe(short.signalId);
  expect(Date.parse(long.validUntil!) - Date.parse(long.anchorBar!)).toBe(8 * 60_000);
  expect(Date.parse(long.planExpiresAt!) - Date.parse(long.anchorBar!)).toBe(32 * 60_000);
  expect(long.targets?.structureR).toBe(2);
});

test('A/B/C 逐级放宽，C 必须依次经过候选、武装和触发', () => {
  const gradeBFactors = directionalFactors('TREND_UP');
  gradeBFactors[QDF.longStructureR] = raw(1.3);
  const gradeB = decisionEngine.getQqqIntradayDirectionalDecision(gradeBFactors).value;
  expect(gradeB.status).toBe('ALERT_LONG');
  expect(gradeB.grade).toBe('B');
  expect(gradeB.targets?.structureR).toBe(1.3);

  const gradeCFactors = directionalFactors('TRANSITION');
  gradeCFactors[QDF.longStructureR] = raw(1.1);
  gradeCFactors[QDF.shortStructureR] = raw(0.5);
  gradeCFactors[QDF.directionalBias] = raw('LONG');
  gradeCFactors[QDF.momentumDistanceAtr] = raw(0.5);
  const setup = decisionEngine.getQqqIntradayDirectionalDecision(gradeCFactors).value;
  expect(setup).toMatchObject({ status: 'ALERT_LONG', grade: 'C', stage: 'SETUP', direction: 'LONG', alertType: 'OPPORTUNITY' });
  expect(setup.signalId).not.toBeNull();

  gradeCFactors[QDF.momentumDistanceAtr] = raw(0.1);
  gradeCFactors[QDF.momentumLongConfirm] = raw(false);
  gradeCFactors[QDF.lifecycleStructureId] = raw(setup.structureId!);
  gradeCFactors[QDF.lifecycleAnchor] = raw(Date.parse(setup.anchorBar!));
  const armed = decisionEngine.getQqqIntradayDirectionalDecision(gradeCFactors).value;
  expect(armed).toMatchObject({ status: 'ALERT_LONG', grade: 'C', stage: 'ARMED', direction: 'LONG', alertType: 'OPPORTUNITY' });
  expect(armed.structureId).toBe(setup.structureId);
  expect(armed.signalId).not.toBe(setup.signalId);
  expect(armed.reasonCodes).toContain('C_TRIGGER_NOT_CONFIRMED');

  gradeCFactors[QDF.momentumLongConfirm] = raw(true);
  const gradeC = decisionEngine.getQqqIntradayDirectionalDecision(gradeCFactors).value;
  expect(gradeC.status).toBe('ALERT_LONG');
  expect(gradeC.grade).toBe('C');
  expect(gradeC.stage).toBe('TRIGGERED');
  expect(gradeC.alertType).toBe('CONFIRMED');
  expect(gradeC.playbook).toBe('DIRECTIONAL_WATCH');

  gradeCFactors[QDF.entryBudgetReached] = raw(true);
  const suppressed = decisionEngine.getQqqIntradayDirectionalDecision(gradeCFactors).value;
  expect(suppressed.status).toBe('WATCH');
  expect(suppressed.reasonCodes).toContain('ENTRY_SIGNAL_BUDGET_REACHED');
});

test('13:00 后风险先升高再确认结构止损，且不模拟新成交或真实平仓', () => {
  const factors = directionalFactors('TREND_DOWN');
  factors[QDF.etMinute] = raw(14 * 60);
  factors[QDF.sessionIntent] = raw('RISK_CUE');
  factors[QDF.spRiskElevated] = raw(true);
  factors[QDF.spStopRisk] = raw(false);
  const elevated = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
  expect(elevated).toMatchObject({ status: 'WATCH', stage: 'RISK_ELEVATED', riskPlan: { atRisk: 'SP', severity: 'ELEVATED' } });
  expect(elevated.signalId).toBeNull();

  factors[QDF.spStopRisk] = raw(true);
  const cue = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
  expect(cue.status).toBe('ALERT_SHORT');
  expect(cue.intent).toBe('RISK_CUE');
  expect(cue.stage).toBe('STOP_RISK');
  expect(cue.riskPlan).toMatchObject({ atRisk: 'SP', severity: 'STOP' });
  expect(cue.reasonCodes).toContain('AFTERNOON_RISK_CUE');
  const simulated = simulateQqqIntradayDirectionalSignal(cue, [], 0);
  expect(simulated).toMatchObject({ intent: 'RISK_CUE', outcome: 'RISK_CUE', fill: null, exit: null, netR: null });

  factors[QDF.riskCueBudgetReached] = raw(true);
  expect(decisionEngine.getQqqIntradayDirectionalDecision(factors).value.reasonCodes).toContain('RISK_CUE_BUDGET_REACHED');
});

test('提醒时间截止与 8 根同结构去重固定为非提醒', () => {
  const outside = directionalFactors('TREND_UP');
  outside[QDF.alertWindow] = raw(false);
  expect(decisionEngine.getQqqIntradayDirectionalDecision(outside).value.status).toBe('NO_SIGNAL');

  const duplicate = directionalFactors('TREND_UP');
  duplicate[QDF.duplicateSuppressed] = raw(true);
  const decision = decisionEngine.getQqqIntradayDirectionalDecision(duplicate).value;
  expect(decision.status).toBe('WATCH');
  expect(decision.signalId).toBeNull();
  expect(decision.reasonCodes).toEqual(['DUPLICATE_SIGNAL']);

  const baseFactors = directionalFactors('TREND_UP');
  const first = decisionEngine.getQqqIntradayDirectionalDecision(baseFactors).value;
  const drifted = { ...first, entryZone: { low: first.entryZone!.low + 0.03, high: first.entryZone!.high + 0.03 } };
  const moved = { ...first, entryZone: { low: first.entryZone!.low + 2, high: first.entryZone!.high + 2 } };
  expect(qqqDirectionalSameStructure(baseFactors, first, drifted)).toBe(true);
  expect(qqqDirectionalSameStructure(baseFactors, first, moved)).toBe(false);
});

test('同结构提醒必须满足独立重新武装，计划到期后才可再次发出', () => {
  const baseFactors = directionalFactors('TREND_UP');
  const first = decisionEngine.getQqqIntradayDirectionalDecision(baseFactors).value;
  const beforeExpiry = {
    ...first,
    signalId: 'second',
    anchorBar: '2026-08-07T14:18:00.000Z',
    validUntil: '2026-08-07T14:26:00.000Z',
    planExpiresAt: '2026-08-07T14:50:00.000Z',
  };
  expect(qqqDirectionalCanRearm({ factors: baseFactors, current: beforeExpiry, previous: first, bars: [] })).toBe(false);
  const afterExpiry = { ...beforeExpiry, anchorBar: '2026-08-07T14:34:00.000Z' };
  expect(qqqDirectionalCanRearm({ factors: baseFactors, current: afterExpiry, previous: first, bars: [] })).toBe(true);
  expect(QQQ_INTRADAY_DIRECTIONAL_POLICY.dedupeBars).toBe(8);
});

test('因果回放只在下一根开盘仍位于 entry zone 时模拟成交，并扣 2bp', () => {
  const decision = decisionEngine.getQqqIntradayDirectionalDecision(directionalFactors('TREND_UP')).value as QqqIntradayDirectionalDecision;
  const replayBars: QqqIntradayBar[] = [
    { timestamp: decision.anchorBar!, open: 99.5, high: 100, low: 99, close: 99.5, volume: 1_000 },
    { timestamp: '2026-08-07T14:02:00.000Z', open: 99.5, high: 101.2, low: 99.4, close: 101, volume: 1_000 },
  ];
  const filled = simulateQqqIntradayDirectionalSignal(decision, replayBars, 0);
  expect(filled.outcome).toBe('TARGET_1R');
  expect(filled.netR).toBeLessThan(1);
  const missed = simulateQqqIntradayDirectionalSignal(decision, [{ ...replayBars[0]! }, { ...replayBars[1]!, open: 100.5 }], 0);
  expect(missed.outcome).toBe('NOT_FILLED');
});

test('低等级机会只评估 30 分钟内先到 +0.5R 还是先失效，不伪装成成交', () => {
  const factors = directionalFactors('TRANSITION');
  factors[QDF.directionalBias] = raw('LONG');
  factors[QDF.longStructureR] = raw(0.5);
  factors[QDF.shortStructureR] = raw(0.5);
  factors[QDF.momentumDistanceAtr] = raw(0.1);
  factors[QDF.momentumLongConfirm] = raw(false);
  const opportunity = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
  expect(opportunity).toMatchObject({ stage: 'ARMED', alertType: 'OPPORTUNITY' });
  const replayBars: QqqIntradayBar[] = [
    { timestamp: opportunity.anchorBar!, open: 99.5, high: 99.8, low: 99.2, close: 99.5, volume: 1_000 },
    ...Array.from({ length: 15 }, (_, index) => ({
      timestamp: new Date(Date.parse(opportunity.anchorBar!) + (index + 1) * 120_000).toISOString(),
      open: 99.6, high: index === 0 ? 100.4 : 100, low: 99.3, close: 99.8, volume: 1_000,
    })),
  ];
  const replay = simulateQqqIntradayDirectionalSignal(opportunity, replayBars, 0);
  expect(replay.fill).toBeNull();
  expect(replay.netR).toBeNull();
  expect(replay.opportunityEvaluation).toMatchObject({ reachedHalfRWithin30m: true, reachedHalfRBeforeInvalidation: true, invalidatedBeforeHalfR: false });
});

test('准入只统计冻结后的前向窗口，并严格执行全部门槛', () => {
  const completeDayDates = Array.from({ length: 20 }, (_, index) => `2026-08-${String(10 + index).padStart(2, '0')}`);
  const signals: QqqIntradayDirectionalReplaySignal[] = Array.from({ length: 40 }, (_, index) => {
    const date = completeDayDates[Math.floor(index / 2)]!;
    const direction = index % 2 ? 'SHORT' as const : 'LONG' as const;
    return {
      signalId: `signal-${index}`, structureId: `structure-${index}`, alertType: 'CONFIRMED', date, direction, grade: index % 4 < 2 ? 'A' : 'B', intent: 'ENTRY', regime: direction === 'LONG' ? 'TREND_UP' : 'TREND_DOWN', playbook: index % 4 < 2 ? 'TREND_PULLBACK' : 'RANGE_REVERSAL',
      stage: 'TRIGGERED',
      anchorBar: `${date}T14:00:00.000Z`, entryZone: { low: 99, high: 100 }, invalidation: direction === 'LONG' ? 98 : 101,
      targets: { oneR: direction === 'LONG' ? 101 : 98, structure: direction === 'LONG' ? 102 : 97, structureR: 2 },
      riskPlan: null,
      validUntil: `${date}T14:08:00.000Z`, fill: { time: `${date}T14:02:00.000Z`, price: 99.5 },
      planExpiresAt: `${date}T14:32:00.000Z`,
      outcome: 'TARGET_1R', exit: { time: `${date}T14:04:00.000Z`, price: direction === 'LONG' ? 101 : 98 },
      netR: 0.2, mfeR: 1, maeR: 0.1, reachedHalfRBeforeInvalidation: true, opportunityEvaluation: null, riskEvaluation: null,
    };
  });
  const gradeStats = summarizeQqqIntradayDirectionalGrades(signals);
  const grouped = groupedSignals(signals.slice(0, 2), 'confirmed');
  expect(grouped.direction.LONG?.evaluated).toBe(1);
  expect(grouped.direction.SHORT?.evaluated).toBe(1);
  const cCandidate = { ...signals[0]!, signalId: 'c-candidate-not-for-admission', structureId: 'c-structure', alertType: 'OPPORTUNITY' as const, stage: 'SETUP' as const, grade: 'C' as const, netR: -100 };
  const riskCue = { ...signals[0]!, signalId: 'risk-cue-not-for-admission', structureId: 'risk-structure', alertType: 'RISK' as const, stage: 'STOP_RISK' as const, intent: 'RISK_CUE' as const, netR: -100, outcome: 'RISK_CUE' as const, fill: null, exit: null };
  const replay = {
    policyVersion: 'qqq-directional-intraday-v7' as const,
    discovery: true as const,
    days: 30,
    completeDays: 30,
    completeDayDates: ['2026-07-27', ...completeDayDates],
    signalDays: 20,
    dailyCoverageRate: 20 / 30,
    gradeStats,
    opportunityStats: { signals: 0, evaluated: 0, halfRSuccessRate: null, invalidatedBeforeHalfRRate: null, averageMfeR: null, averageMaeR: null },
    lifecycleStats: { opportunityStructures: 0, confirmedSignals: 40, confirmedUpgrades: 0, directConfirmed: 40, confirmedUpgradeRate: null },
    groupedStats: { opportunity: { direction: {}, regime: {}, timeBucket: {}, playbook: {} }, confirmed: { direction: {}, regime: {}, timeBucket: {}, playbook: {} } },
    riskStats: { elevated: 0, stopCandidates: 0, emitted: 1, evaluated: 0, confirmedRisk: 0, falseStop: 0, neutral: 0, pending: 0, confirmedRiskRate: null, falseStopRate: null, averageAdverseMove30mAtr: null },
    sessionStats: { entrySignals: 40, confirmedEntrySignals: 40, entryLifecycleEvents: 40, riskCues: 1, entrySignalDays: 20, dataCompleteDays: 20, dataCompleteSignalDays: 20, dataCompleteCoverageRate: 1, riskCueDays: 1, longEntrySignals: 20, shortEntrySignals: 20, averageEntrySignalsPerCompleteDay: 2, averageEntrySignalsPerEntryDay: 2, averageEntrySignalsPerDataCompleteDay: 2, averageRiskCuesPerCompleteDay: 0.05 },
    funnel: { evaluatedBars: 0, alertWindowBars: 0, dataReadyWindowBars: 0, insufficientDataBars: 0, entry: { evaluatedBars: 0, setups: 0, armed: 0, triggerCandidates: 0, emitted: 0, confirmed: 0, rearmBlocked: 0, budgetBlocked: 0 }, risk: { evaluatedBars: 0, elevated: 0, stopCandidates: 0, emitted: 0, rearmBlocked: 0, budgetBlocked: 0 }, noSignalDates: [], topBlockers: [] },
    dailyStats: [],
    signals: [{ ...signals[0]!, signalId: 'discovery-only', date: '2026-08-07', netR: -10 }, cCandidate, riskCue, ...signals],
    fingerprint: 'same-sha',
  };
  expect(validateQqqIntradayDirectional(replay, 'same-sha')).toMatchObject({
    status: 'VALIDATED',
    metrics: { completeDays: 20, filledSignals: 40, longSignals: 20, shortSignals: 20, reproducible: true },
  });
  expect(validateQqqIntradayDirectional(replay, 'different-sha')).toMatchObject({ status: 'VALIDATION_FAIL', researchStatus: 'VALIDATION_FAIL' });
});


test('new units cannot mix with legacy expiries and incomplete latest data blocks', () => {
 const inputs=expiries().map((e,i)=>({...e,snapshots:e.snapshots.map((p,j)=>({...p,calculationVersion:i===0 && j===1 ? 'v2' : 'legacy',inputComplete:true}))}));
 const result=buildQqqIntradayDirectionalFactors({asOf:'2026-08-07T14:10:00Z',bars:bars(),expiries:inputs});
 expect(qqqDirectionalFactorValue(result.factors,QDF.expiryCount,0)).toBe(1);
 const broken=expiries().map(e=>({...e,snapshots:e.snapshots.map((p,j)=>({...p,inputComplete:j===0}))}));
 expect(qqqDirectionalFactorValue(buildQqqIntradayDirectionalFactors({asOf:'2026-08-07T14:10:00Z',bars:bars(),expiries:broken}).factors,QDF.expiryCount,0)).toBe(0);
});
