import { createHash } from 'node:crypto';
import { decisionEngine } from '@/lib/engines/core/DecisionEngine';
import {
  QQQ_INTRADAY_DIRECTIONAL_POLICY,
  QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF,
  buildQqqIntradayDirectionalFactors,
  qqqDirectionalCanRearm,
  qqqDirectionalFactorValue,
  qqqDirectionalSameStructure,
  type QqqIntradayBar,
  type QqqIntradayDirectionalDecision,
  type QqqIntradayDirection,
  type QqqIntradayGexExpiry,
  type QqqIntradaySignalGrade,
  type QqqIntradaySignalIntent,
  type QqqIntradaySignalStage,
} from './QqqIntradayDirectional';

export type QqqIntradayDirectionalReplayDay = {
  date: string;
  bars: QqqIntradayBar[];
  expiries: QqqIntradayGexExpiry[];
  complete: boolean;
};

export type QqqIntradayDirectionalReplaySignal = {
  signalId: string;
  structureId: string;
  alertType: NonNullable<QqqIntradayDirectionalDecision['alertType']>;
  date: string;
  direction: QqqIntradayDirection;
  grade: QqqIntradaySignalGrade | null;
  intent: QqqIntradaySignalIntent;
  stage: QqqIntradaySignalStage;
  regime: QqqIntradayDirectionalDecision['regime'];
  playbook: NonNullable<QqqIntradayDirectionalDecision['playbook']>;
  anchorBar: string;
  entryZone: { low: number; high: number } | null;
  invalidation: number | null;
  targets: NonNullable<QqqIntradayDirectionalDecision['targets']> | null;
  riskPlan: NonNullable<QqqIntradayDirectionalDecision['riskPlan']> | null;
  validUntil: string;
  planExpiresAt: string;
  fill: { time: string; price: number } | null;
  outcome: 'PENDING' | 'ZONE_REACHED' | 'ZONE_NOT_REACHED' | 'NOT_FILLED' | 'TARGET_1R' | 'INVALIDATION' | 'TIMEOUT' | 'RISK_CUE';
  exit: { time: string; price: number } | null;
  netR: number | null;
  mfeR: number | null;
  maeR: number | null;
  reachedHalfRBeforeInvalidation: boolean;
  opportunityEvaluation: {
    zoneReachedWithin30m: boolean | null;
    minutesToZone: number | null;
    reachedHalfRWithin30m: boolean | null;
    reachedHalfRBeforeInvalidation: boolean | null;
    invalidatedBeforeHalfR: boolean | null;
    mfeR: number | null;
    maeR: number | null;
  } | null;
  riskEvaluation: {
    adverseMove10mAtr: number | null;
    adverseMove20mAtr: number | null;
    adverseMove30mAtr: number | null;
    recoveredWithin30m: boolean | null;
    classification: 'PENDING' | 'CONFIRMED_RISK' | 'FALSE_STOP' | 'NEUTRAL';
  } | null;
};

export type QqqIntradayDirectionalGroupStats = {
  count: number;
  evaluated: number;
  successes: number;
  successRate: number | null;
  averageNetR: number | null;
  profitFactor: number | null;
  averageMfeR: number | null;
  averageMaeR: number | null;
};

export type QqqIntradayDirectionalGroupedStats = {
  direction: Record<string, QqqIntradayDirectionalGroupStats>;
  regime: Record<string, QqqIntradayDirectionalGroupStats>;
  timeBucket: Record<string, QqqIntradayDirectionalGroupStats>;
  playbook: Record<string, QqqIntradayDirectionalGroupStats>;
};

export type QqqIntradayDirectionalReplayResult = {
  policyVersion: typeof QQQ_INTRADAY_DIRECTIONAL_POLICY.id;
  discovery: true;
  days: number;
  completeDays: number;
  completeDayDates: string[];
  signalDays: number;
  dailyCoverageRate: number | null;
  gradeStats: QqqIntradayDirectionalGradeStats;
  opportunityStats: {
    signals: number;
    evaluated: number;
    halfRSuccessRate: number | null;
    invalidatedBeforeHalfRRate: number | null;
    averageMfeR: number | null;
    averageMaeR: number | null;
  };
  lifecycleStats: {
    opportunityStructures: number;
    confirmedSignals: number;
    confirmedUpgrades: number;
    directConfirmed: number;
    confirmedUpgradeRate: number | null;
  };
  groupedStats: {
    opportunity: QqqIntradayDirectionalGroupedStats;
    confirmed: QqqIntradayDirectionalGroupedStats;
  };
  riskStats: {
    elevated: number;
    stopCandidates: number;
    emitted: number;
    evaluated: number;
    confirmedRisk: number;
    falseStop: number;
    neutral: number;
    pending: number;
    confirmedRiskRate: number | null;
    falseStopRate: number | null;
    averageAdverseMove30mAtr: number | null;
  };
  sessionStats: {
    entrySignals: number;
    confirmedEntrySignals: number;
    entryLifecycleEvents: number;
    riskCues: number;
    entrySignalDays: number;
    dataCompleteDays: number;
    dataCompleteSignalDays: number;
    dataCompleteCoverageRate: number | null;
    riskCueDays: number;
    longEntrySignals: number;
    shortEntrySignals: number;
    averageEntrySignalsPerCompleteDay: number | null;
    averageEntrySignalsPerEntryDay: number | null;
    averageEntrySignalsPerDataCompleteDay: number | null;
    averageRiskCuesPerCompleteDay: number | null;
  };
  funnel: {
    evaluatedBars: number;
    alertWindowBars: number;
    dataReadyWindowBars: number;
    insufficientDataBars: number;
    entry: { evaluatedBars: number; setups: number; armed: number; triggerCandidates: number; emitted: number; confirmed: number; rearmBlocked: number; budgetBlocked: number };
    risk: { evaluatedBars: number; elevated: number; stopCandidates: number; emitted: number; rearmBlocked: number; budgetBlocked: number };
    noSignalDates: string[];
    topBlockers: Array<{ reason: string; count: number }>;
  };
  dailyStats: Array<{
    date: string;
    complete: boolean;
    alertWindowBars: number;
    dataReadyWindowBars: number;
    opportunitySignals: number;
    confirmedSignals: number;
    riskCues: number;
  }>;
  signals: QqqIntradayDirectionalReplaySignal[];
  fingerprint: string;
};

export type QqqIntradayDirectionalGradeStats = Record<QqqIntradaySignalGrade, {
  signals: number;
  filled: number;
  signalDays: number;
  winRate: number | null;
  averageNetR: number | null;
  profitFactor: number | null;
}>;

export type QqqIntradayDirectionalValidation = {
  status: 'DISCOVERY' | 'VALIDATION_FAIL' | 'VALIDATED';
  researchStatus: 'EXPERIMENTAL' | 'VALIDATION_FAIL' | 'VALIDATED';
  reasons: string[];
  metrics: {
    completeDays: number;
    filledSignals: number;
    longSignals: number;
    shortSignals: number;
    averageNetR: number | null;
    profitFactor: number | null;
    earlyInvalidationRate: number | null;
    maximumDayContribution: number | null;
    worstRollingTenR: number | null;
    reproducible: boolean;
  };
  progress: {
    startDate: string;
    completeDays: number;
    requiredCompleteDays: number;
    filledSignals: number;
    requiredFilledSignals: number;
    longSignals: number;
    requiredLongSignals: number;
    shortSignals: number;
    requiredShortSignals: number;
  };
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');

const barHigh = (bar: QqqIntradayBar) => typeof bar.high === 'number' && Number.isFinite(bar.high) ? bar.high : Math.max(bar.open ?? bar.close, bar.close);
const barLow = (bar: QqqIntradayBar) => typeof bar.low === 'number' && Number.isFinite(bar.low) ? bar.low : Math.min(bar.open ?? bar.close, bar.close);
const entryPrice = (bar: QqqIntradayBar) => typeof bar.open === 'number' && Number.isFinite(bar.open) && bar.open > 0 ? bar.open : bar.close;
const easternMinute = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
};
const signalTimeBucket = (value: string) => {
  const minute = easternMinute(value);
  if (minute < 11 * 60) return '10:00–11:00';
  if (minute < 12 * 60) return '11:00–12:00';
  if (minute < 13 * 60) return '12:00–13:00';
  return '13:00–16:00';
};

const emptyGroupStats = (): QqqIntradayDirectionalGroupStats => ({
  count: 0, evaluated: 0, successes: 0, successRate: null,
  averageNetR: null, profitFactor: null, averageMfeR: null, averageMaeR: null,
});

function summarizeGroupSignals(
  signals: QqqIntradayDirectionalReplaySignal[],
  mode: 'opportunity' | 'confirmed',
): QqqIntradayDirectionalGroupStats {
  const result = emptyGroupStats();
  result.count = signals.length;
  if (mode === 'opportunity') {
    const evaluated = signals.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation !== null);
    result.evaluated = evaluated.length;
    result.successes = evaluated.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation === true).length;
    result.successRate = result.evaluated ? result.successes / result.evaluated : null;
    const mfe = evaluated.flatMap((signal) => signal.opportunityEvaluation?.mfeR == null ? [] : [signal.opportunityEvaluation.mfeR]);
    const mae = evaluated.flatMap((signal) => signal.opportunityEvaluation?.maeR == null ? [] : [signal.opportunityEvaluation.maeR]);
    result.averageMfeR = mfe.length ? mfe.reduce((sum, value) => sum + value, 0) / mfe.length : null;
    result.averageMaeR = mae.length ? mae.reduce((sum, value) => sum + value, 0) / mae.length : null;
    return result;
  }
  const filled = signals.filter((signal) => signal.netR !== null);
  result.evaluated = filled.length;
  result.successes = filled.filter((signal) => signal.netR! > 0).length;
  result.successRate = result.evaluated ? result.successes / result.evaluated : null;
  if (filled.length) {
    result.averageNetR = filled.reduce((sum, signal) => sum + signal.netR!, 0) / filled.length;
    const grossProfit = filled.filter((signal) => signal.netR! > 0).reduce((sum, signal) => sum + signal.netR!, 0);
    const grossLoss = Math.abs(filled.filter((signal) => signal.netR! < 0).reduce((sum, signal) => sum + signal.netR!, 0));
    result.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  }
  return result;
}

function groupSignals(
  signals: QqqIntradayDirectionalReplaySignal[],
  mode: 'opportunity' | 'confirmed',
  key: (signal: QqqIntradayDirectionalReplaySignal) => string,
): Record<string, QqqIntradayDirectionalGroupStats> {
  const groups = new Map<string, QqqIntradayDirectionalReplaySignal[]>();
  for (const signal of signals) groups.set(key(signal), [...(groups.get(key(signal)) ?? []), signal]);
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, values]) => [name, summarizeGroupSignals(values, mode)]));
}

export function groupedSignals(
  signals: QqqIntradayDirectionalReplaySignal[],
  mode: 'opportunity' | 'confirmed',
): QqqIntradayDirectionalGroupedStats {
  return {
    direction: groupSignals(signals, mode, (signal) => signal.direction),
    regime: groupSignals(signals, mode, (signal) => signal.regime),
    timeBucket: groupSignals(signals, mode, (signal) => signalTimeBucket(signal.anchorBar)),
    playbook: groupSignals(signals, mode, (signal) => signal.playbook),
  };
}

export const simulateQqqIntradayDirectionalSignal = (
  decision: QqqIntradayDirectionalDecision,
  bars: QqqIntradayBar[],
  anchorIndex: number,
): QqqIntradayDirectionalReplaySignal => {
  const direction = decision.direction!;
  const next = bars[anchorIndex + 1];
  const base = {
    signalId: decision.signalId!,
    structureId: decision.structureId!,
    alertType: decision.alertType!,
    date: decision.anchorBar!.slice(0, 10),
    direction,
    grade: decision.grade,
    intent: decision.intent!,
    stage: decision.stage!,
    regime: decision.regime,
    playbook: decision.playbook!,
    anchorBar: decision.anchorBar!,
    entryZone: decision.entryZone,
    invalidation: decision.invalidation,
    targets: decision.targets,
    riskPlan: decision.riskPlan,
    validUntil: decision.validUntil!,
    planExpiresAt: decision.planExpiresAt!,
  };
  if (decision.intent === 'RISK_CUE') {
    const atr = decision.structureContext?.atr ?? 0;
    const anchorPrice = bars[anchorIndex]?.close ?? 0;
    const horizon = bars.slice(anchorIndex + 1, anchorIndex + 16);
    const adverseAt = (minutes: 10 | 20 | 30) => {
      const selected = horizon.slice(0, minutes / QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes);
      if (!(atr > 0) || !selected.length || !(anchorPrice > 0)) return null;
      const adverse = decision.riskPlan?.atRisk === 'SC'
        ? Math.max(...selected.map(barHigh)) - anchorPrice
        : anchorPrice - Math.min(...selected.map(barLow));
      return Number((Math.max(0, adverse) / atr).toFixed(6));
    };
    const recoveredWithin30m = decision.riskPlan && horizon.length
      ? horizon.some((bar) => decision.riskPlan!.atRisk === 'SC'
        ? bar.close <= decision.riskPlan!.recoveryLevel
        : bar.close >= decision.riskPlan!.recoveryLevel)
      : null;
    const adverseMove30mAtr = adverseAt(30);
    const classification = adverseMove30mAtr === null || horizon.length < 15
      ? 'PENDING' as const
      : adverseMove30mAtr >= 0.5
        ? 'CONFIRMED_RISK' as const
        : recoveredWithin30m && adverseMove30mAtr < 0.25
          ? 'FALSE_STOP' as const
          : 'NEUTRAL' as const;
    return {
      ...base, fill: null, outcome: 'RISK_CUE', exit: null, netR: null, mfeR: null, maeR: null,
      reachedHalfRBeforeInvalidation: false, opportunityEvaluation: null,
      riskEvaluation: {
        adverseMove10mAtr: adverseAt(10),
        adverseMove20mAtr: adverseAt(20),
        adverseMove30mAtr,
        recoveredWithin30m,
        classification,
      },
    };
  }
  const entryZone = decision.entryZone!;
  const targets = decision.targets!;
  if (decision.stage === 'SETUP' || decision.stage === 'ARMED') {
    const horizon = bars.slice(anchorIndex + 1, anchorIndex + 16);
    const touchIndex = horizon.findIndex((bar) => barHigh(bar) >= entryZone.low && barLow(bar) <= entryZone.high);
    const zoneReached = touchIndex >= 0;
    const assumedEntry = (entryZone.low + entryZone.high) / 2;
    const risk = direction === 'LONG' ? assumedEntry - decision.invalidation! : decision.invalidation! - assumedEntry;
    const postTouchHorizon = zoneReached ? horizon.slice(touchIndex) : [];
    let reachedHalfR = false;
    let invalidatedBeforeHalfR = false;
    let maximumFavorable = 0;
    let maximumAdverse = 0;
    if (risk > 0) {
      const halfRTarget = assumedEntry + (direction === 'LONG' ? risk * 0.5 : -risk * 0.5);
      for (const bar of postTouchHorizon) {
        const favorable = direction === 'LONG' ? barHigh(bar) - assumedEntry : assumedEntry - barLow(bar);
        const adverse = direction === 'LONG' ? assumedEntry - barLow(bar) : barHigh(bar) - assumedEntry;
        maximumFavorable = Math.max(maximumFavorable, favorable);
        maximumAdverse = Math.max(maximumAdverse, adverse);
        if (direction === 'LONG' ? barLow(bar) <= decision.invalidation! : barHigh(bar) >= decision.invalidation!) {
          invalidatedBeforeHalfR = !reachedHalfR;
          break;
        }
        if (direction === 'LONG' ? barHigh(bar) >= halfRTarget : barLow(bar) <= halfRTarget) {
          reachedHalfR = true;
          break;
        }
      }
    }
    const pending = !zoneReached && horizon.length < 15;
    return {
      ...base,
      fill: null,
      outcome: pending ? 'PENDING' : zoneReached ? 'ZONE_REACHED' : 'ZONE_NOT_REACHED',
      exit: null,
      netR: null,
      mfeR: null,
      maeR: null,
      reachedHalfRBeforeInvalidation: false,
      opportunityEvaluation: {
        zoneReachedWithin30m: pending ? null : zoneReached,
        minutesToZone: zoneReached ? (touchIndex + 1) * QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes : null,
        reachedHalfRWithin30m: horizon.length < 15 && !reachedHalfR && !invalidatedBeforeHalfR ? null : zoneReached ? reachedHalfR : null,
        reachedHalfRBeforeInvalidation: horizon.length < 15 && !reachedHalfR && !invalidatedBeforeHalfR ? null : zoneReached ? reachedHalfR : null,
        invalidatedBeforeHalfR: horizon.length < 15 && !reachedHalfR && !invalidatedBeforeHalfR ? null : zoneReached ? invalidatedBeforeHalfR : null,
        mfeR: risk > 0 && postTouchHorizon.length ? Number((maximumFavorable / risk).toFixed(6)) : null,
        maeR: risk > 0 && postTouchHorizon.length ? Number((maximumAdverse / risk).toFixed(6)) : null,
      },
      riskEvaluation: null,
    };
  }
  if (!next) return {
    ...base, fill: null, outcome: 'PENDING', exit: null, netR: null, mfeR: null, maeR: null,
    reachedHalfRBeforeInvalidation: false, opportunityEvaluation: null, riskEvaluation: null,
  };
  const fillPrice = entryPrice(next);
  if (fillPrice < entryZone.low || fillPrice > entryZone.high || Date.parse(next.timestamp) > Date.parse(decision.validUntil!)) {
    return {
      ...base, fill: null, outcome: 'NOT_FILLED', exit: null, netR: null, mfeR: null, maeR: null,
      reachedHalfRBeforeInvalidation: false, opportunityEvaluation: null, riskEvaluation: null,
    };
  }

  const risk = direction === 'LONG' ? fillPrice - decision.invalidation! : decision.invalidation! - fillPrice;
  if (!(risk > 0)) return {
    ...base, fill: null, outcome: 'NOT_FILLED', exit: null, netR: null, mfeR: null, maeR: null,
    reachedHalfRBeforeInvalidation: false, opportunityEvaluation: null, riskEvaluation: null,
  };
  const oneRTarget = direction === 'LONG' ? fillPrice + risk : fillPrice - risk;
  const halfRTarget = direction === 'LONG' ? fillPrice + risk * 0.5 : fillPrice - risk * 0.5;
  const horizon = bars.slice(anchorIndex + 1, anchorIndex + 1 + QQQ_INTRADAY_DIRECTIONAL_POLICY.maxPlanMinutes / QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes);
  let maximumFavorable = 0;
  let maximumAdverse = 0;
  let reachedHalfR = false;
  let outcome: QqqIntradayDirectionalReplaySignal['outcome'] = 'TIMEOUT';
  let exit = horizon.at(-1) ? { time: horizon.at(-1)!.timestamp, price: horizon.at(-1)!.close } : null;

  for (const bar of horizon) {
    const high = barHigh(bar);
    const low = barLow(bar);
    const favorable = direction === 'LONG' ? high - fillPrice : fillPrice - low;
    const adverse = direction === 'LONG' ? fillPrice - low : high - fillPrice;
    maximumFavorable = Math.max(maximumFavorable, favorable);
    maximumAdverse = Math.max(maximumAdverse, adverse);
    if (direction === 'LONG' ? high >= halfRTarget : low <= halfRTarget) reachedHalfR = true;
    // 同一根 K 线目标与失效同时触及时按失效处理，避免乐观的盘中路径假设。
    if (direction === 'LONG' ? low <= decision.invalidation! : high >= decision.invalidation!) {
      outcome = 'INVALIDATION';
      exit = { time: bar.timestamp, price: decision.invalidation! };
      break;
    }
    if (direction === 'LONG' ? high >= oneRTarget : low <= oneRTarget) {
      outcome = 'TARGET_1R';
      exit = { time: bar.timestamp, price: oneRTarget };
      break;
    }
  }

  const exitPrice = exit?.price ?? fillPrice;
  const grossR = (direction === 'LONG' ? exitPrice - fillPrice : fillPrice - exitPrice) / risk;
  const frictionR = fillPrice * 0.0002 / risk;
  return {
    ...base,
    fill: { time: next.timestamp, price: Number(fillPrice.toFixed(4)) },
    outcome,
    exit: exit ? { time: exit.time, price: Number(exit.price.toFixed(4)) } : null,
    netR: Number((grossR - frictionR).toFixed(6)),
    mfeR: Number((maximumFavorable / risk).toFixed(6)),
    maeR: Number((maximumAdverse / risk).toFixed(6)),
    reachedHalfRBeforeInvalidation: reachedHalfR,
    opportunityEvaluation: null,
    riskEvaluation: null,
  };
};

export function summarizeQqqIntradayDirectionalGrades(signals: readonly QqqIntradayDirectionalReplaySignal[]): QqqIntradayDirectionalGradeStats {
  const summarize = (grade: QqqIntradaySignalGrade) => {
    const selected = signals.filter((signal) => signal.intent === 'ENTRY' && signal.stage === 'TRIGGERED' && signal.grade === grade);
    const filled = selected.filter((signal) => signal.netR !== null);
    const values = filled.map((signal) => signal.netR!);
    const grossProfit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    return {
      signals: selected.length,
      filled: filled.length,
      signalDays: new Set(selected.map((signal) => signal.date)).size,
      winRate: filled.length ? filled.filter((signal) => signal.netR! > 0).length / filled.length : null,
      averageNetR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
    };
  };
  return { A: summarize('A'), B: summarize('B'), C: summarize('C') };
}

export function replayQqqIntradayDirectional(days: QqqIntradayDirectionalReplayDay[]): QqqIntradayDirectionalReplayResult {
  const signals: QqqIntradayDirectionalReplaySignal[] = [];
  const blockerCounts = new Map<string, number>();
  const dailyWindowStats = new Map(days.map((day) => [day.date, { alertWindowBars: 0, dataReadyWindowBars: 0 }]));
  const funnel: QqqIntradayDirectionalReplayResult['funnel'] = {
    evaluatedBars: 0,
    alertWindowBars: 0,
    dataReadyWindowBars: 0,
    insufficientDataBars: 0,
    entry: { evaluatedBars: 0, setups: 0, armed: 0, triggerCandidates: 0, emitted: 0, confirmed: 0, rearmBlocked: 0, budgetBlocked: 0 },
    risk: { evaluatedBars: 0, elevated: 0, stopCandidates: 0, emitted: 0, rearmBlocked: 0, budgetBlocked: 0 },
    noSignalDates: [],
    topBlockers: [],
  };
  for (const day of [...days].sort((left, right) => left.date.localeCompare(right.date))) {
    const bars = [...day.bars].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    const emitted: Array<{ index: number; decision: QqqIntradayDirectionalDecision }> = [];
    const stageRank = (stage: QqqIntradaySignalStage | null) => stage === 'SETUP' || stage === 'RISK_ELEVATED' ? 1
      : stage === 'ARMED' || stage === 'STOP_RISK' ? 2 : stage === 'TRIGGERED' ? 3 : 0;
    for (let index = 0; index < bars.length; index += 1) {
      const asOf = new Date(Date.parse(bars[index]!.timestamp) + QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000).toISOString();
      const { factors } = buildQqqIntradayDirectionalFactors({ asOf, bars: bars.slice(0, index + 1), expiries: day.expiries });
      const preview = decisionEngine.getQqqIntradayDirectionalDecision(factors).value;
      funnel.evaluatedBars += 1;
      const inWindow = qqqDirectionalFactorValue(factors, QDF.alertWindow, false);
      if (!inWindow) continue;
      funnel.alertWindowBars += 1;
      const dayWindow = dailyWindowStats.get(day.date)!;
      dayWindow.alertWindowBars += 1;
      if (qqqDirectionalFactorValue(factors, QDF.dataReady, false)) {
        funnel.dataReadyWindowBars += 1;
        dayWindow.dataReadyWindowBars += 1;
      }
      if (preview.status === 'INSUFFICIENT_DATA') funnel.insufficientDataBars += 1;
      if (preview.intent === 'ENTRY') {
        funnel.entry.evaluatedBars += 1;
        if (preview.stage === 'SETUP') funnel.entry.setups += 1;
        if (preview.stage === 'ARMED') funnel.entry.armed += 1;
        if (preview.stage === 'TRIGGERED') funnel.entry.triggerCandidates += 1;
        if (preview.reasonCodes.includes('ENTRY_SIGNAL_BUDGET_REACHED')) funnel.entry.budgetBlocked += 1;
      } else if (preview.intent === 'RISK_CUE') {
        funnel.risk.evaluatedBars += 1;
        if (preview.stage === 'RISK_ELEVATED') funnel.risk.elevated += 1;
        if (preview.stage === 'STOP_RISK') funnel.risk.stopCandidates += 1;
        if (preview.reasonCodes.includes('RISK_CUE_BUDGET_REACHED')) funnel.risk.budgetBlocked += 1;
      }
      if (!preview.signalId) {
        for (const reason of preview.reasonCodes) blockerCounts.set(reason, (blockerCounts.get(reason) ?? 0) + 1);
      }

      if (preview.signalId && preview.direction && preview.playbook && preview.anchorBar && preview.stage) {
        const previous = [...emitted].reverse().find((item) => qqqDirectionalSameStructure(factors, preview, item.decision));
        const canRearm = previous ? qqqDirectionalCanRearm({ factors, current: preview, previous: previous.decision, bars }) : true;
        if (previous && !canRearm && stageRank(preview.stage) > stageRank(previous.decision.stage)) {
          const first = emitted.find((item) => item.decision.structureId === previous.decision.structureId) ?? previous;
          factors[QDF.lifecycleStructureId] = { value: previous.decision.structureId!, confidence: 10, source: { type: 'raw', api: 'replay.lifecycle' } };
          factors[QDF.lifecycleAnchor] = { value: Date.parse(first.decision.anchorBar!), confidence: 10, source: { type: 'raw', api: 'replay.lifecycle' } };
        } else if (previous && !canRearm) {
          const suppressFactor = stageRank(preview.stage) === stageRank(previous.decision.stage) ? QDF.duplicateSuppressed : QDF.rearmSuppressed;
          factors[suppressFactor] = { value: true, confidence: 10, source: { type: 'raw', api: 'replay.lifecycle' } };
        } else {
          const entryStructures = new Set(emitted.filter((item) => item.decision.intent === 'ENTRY').map((item) => item.decision.structureId)).size;
          const riskStructures = new Set(emitted.filter((item) => item.decision.intent === 'RISK_CUE').map((item) => item.decision.structureId)).size;
          if (preview.intent === 'ENTRY' && entryStructures >= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxEntrySignalsPerDay) {
            factors[QDF.entryBudgetReached] = { value: true, confidence: 10, source: { type: 'raw', api: 'replay.emittedSignals' } };
          }
          if (preview.intent === 'RISK_CUE' && riskStructures >= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxRiskCuesPerDay) {
            factors[QDF.riskCueBudgetReached] = { value: true, confidence: 10, source: { type: 'raw', api: 'replay.emittedSignals' } };
          }
        }
      }
      const decision = factors[QDF.lifecycleStructureId] || factors[QDF.duplicateSuppressed] || factors[QDF.rearmSuppressed] || factors[QDF.entryBudgetReached] || factors[QDF.riskCueBudgetReached]
        ? decisionEngine.getQqqIntradayDirectionalDecision(factors).value
        : preview;
      if (decision.reasonCodes.includes('REARM_NOT_READY')) {
        if (decision.intent === 'ENTRY') funnel.entry.rearmBlocked += 1;
        if (decision.intent === 'RISK_CUE') funnel.risk.rearmBlocked += 1;
        blockerCounts.set('REARM_NOT_READY', (blockerCounts.get('REARM_NOT_READY') ?? 0) + 1);
      }
      if (!decision.signalId || !decision.structureId || !decision.alertType || !decision.direction || !decision.playbook || !decision.validUntil || !decision.anchorBar || !decision.stage) continue;
      const entryReady = decision.intent === 'ENTRY'
        && decision.grade && decision.entryZone && decision.targets && decision.invalidation !== null;
      const riskReady = decision.intent === 'RISK_CUE' && decision.riskPlan && decision.structureContext;
      if (!entryReady && !riskReady) continue;
      emitted.push({ index, decision });
      signals.push(simulateQqqIntradayDirectionalSignal(decision, bars, index));
    }
  }
  const completeDayDates = days.filter((day) => day.complete).map((day) => day.date).sort();
  const completeDaySet = new Set(completeDayDates);
  const completeSignals = signals.filter((signal) => completeDaySet.has(signal.date));
  const entryLifecycleEvents = completeSignals.filter((signal) => signal.intent === 'ENTRY');
  const entryStructures = [...new Map(entryLifecycleEvents.map((signal) => [signal.structureId, signal])).values()];
  const confirmedEntrySignals = entryLifecycleEvents.filter((signal) => signal.stage === 'TRIGGERED');
  const riskCues = completeSignals.filter((signal) => signal.intent === 'RISK_CUE');
  const opportunitySignals = completeSignals.filter((signal) => signal.intent === 'ENTRY' && signal.alertType === 'OPPORTUNITY');
  const evaluatedOpportunities = opportunitySignals.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation !== null);
  const opportunityMfe = evaluatedOpportunities.flatMap((signal) => signal.opportunityEvaluation?.mfeR == null ? [] : [signal.opportunityEvaluation.mfeR]);
  const opportunityMae = evaluatedOpportunities.flatMap((signal) => signal.opportunityEvaluation?.maeR == null ? [] : [signal.opportunityEvaluation.maeR]);
  const entrySignalDays = new Set(entryStructures.map((signal) => signal.date)).size;
  const signalDays = entrySignalDays;
  funnel.entry.emitted = entryStructures.length;
  funnel.entry.confirmed = confirmedEntrySignals.length;
  funnel.risk.emitted = riskCues.length;
  funnel.noSignalDates = completeDayDates.filter((date) => !entryStructures.some((signal) => signal.date === date));
  funnel.topBlockers = [...blockerCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
  const opportunityStats = {
    signals: opportunitySignals.length,
    evaluated: evaluatedOpportunities.length,
    halfRSuccessRate: evaluatedOpportunities.length
      ? evaluatedOpportunities.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation === true).length / evaluatedOpportunities.length
      : null,
    invalidatedBeforeHalfRRate: evaluatedOpportunities.length
      ? evaluatedOpportunities.filter((signal) => signal.opportunityEvaluation?.invalidatedBeforeHalfR === true).length / evaluatedOpportunities.length
      : null,
    averageMfeR: opportunityMfe.length ? opportunityMfe.reduce((sum, value) => sum + value, 0) / opportunityMfe.length : null,
    averageMaeR: opportunityMae.length ? opportunityMae.reduce((sum, value) => sum + value, 0) / opportunityMae.length : null,
  };
  const confirmedUpgrades = confirmedEntrySignals.filter((signal) => opportunitySignals.some((opportunity) => opportunity.structureId === signal.structureId));
  const lifecycleStats = {
    opportunityStructures: new Set(opportunitySignals.map((signal) => signal.structureId)).size,
    confirmedSignals: confirmedEntrySignals.length,
    confirmedUpgrades: confirmedUpgrades.length,
    directConfirmed: confirmedEntrySignals.length - confirmedUpgrades.length,
    confirmedUpgradeRate: opportunitySignals.length
      ? confirmedUpgrades.length / new Set(opportunitySignals.map((signal) => signal.structureId)).size
      : null,
  };
  const riskEvaluations = riskCues.flatMap((signal) => signal.riskEvaluation ? [signal.riskEvaluation] : []);
  const evaluatedRisks = riskEvaluations.filter((evaluation) => evaluation.classification !== 'PENDING');
  const adverse30m = riskEvaluations.flatMap((evaluation) => evaluation.adverseMove30mAtr == null ? [] : [evaluation.adverseMove30mAtr]);
  const riskStats = {
    elevated: funnel.risk.elevated,
    stopCandidates: funnel.risk.stopCandidates,
    emitted: riskCues.length,
    evaluated: evaluatedRisks.length,
    confirmedRisk: evaluatedRisks.filter((evaluation) => evaluation.classification === 'CONFIRMED_RISK').length,
    falseStop: evaluatedRisks.filter((evaluation) => evaluation.classification === 'FALSE_STOP').length,
    neutral: evaluatedRisks.filter((evaluation) => evaluation.classification === 'NEUTRAL').length,
    pending: riskEvaluations.filter((evaluation) => evaluation.classification === 'PENDING').length,
    confirmedRiskRate: evaluatedRisks.length
      ? evaluatedRisks.filter((evaluation) => evaluation.classification === 'CONFIRMED_RISK').length / evaluatedRisks.length
      : null,
    falseStopRate: evaluatedRisks.length
      ? evaluatedRisks.filter((evaluation) => evaluation.classification === 'FALSE_STOP').length / evaluatedRisks.length
      : null,
    averageAdverseMove30mAtr: adverse30m.length ? adverse30m.reduce((sum, value) => sum + value, 0) / adverse30m.length : null,
  };
  const groupedStats = {
    opportunity: groupedSignals(opportunitySignals, 'opportunity'),
    confirmed: groupedSignals(confirmedEntrySignals, 'confirmed'),
  };
  const dailyStats = [...days].sort((left, right) => left.date.localeCompare(right.date)).map((day) => {
    const window = dailyWindowStats.get(day.date) ?? { alertWindowBars: 0, dataReadyWindowBars: 0 };
    const dayEntryEvents = signals.filter((signal) => signal.date === day.date && signal.intent === 'ENTRY');
    return {
      date: day.date,
      complete: day.complete,
      ...window,
      opportunitySignals: new Set(dayEntryEvents.map((signal) => signal.structureId)).size,
      confirmedSignals: dayEntryEvents.filter((signal) => signal.stage === 'TRIGGERED').length,
      riskCues: signals.filter((signal) => signal.date === day.date && signal.intent === 'RISK_CUE').length,
    };
  });
  const dataCompleteDailyStats = dailyStats.filter((day) => day.complete && day.alertWindowBars > 0
    && day.dataReadyWindowBars / day.alertWindowBars >= QQQ_INTRADAY_DIRECTIONAL_POLICY.completeDayDataCoverageRatio);
  const dataCompleteSignalDays = dataCompleteDailyStats.filter((day) => day.opportunitySignals > 0).length;
  const payload = {
    policyVersion: QQQ_INTRADAY_DIRECTIONAL_POLICY.id,
    discovery: true as const,
    days: days.length,
    completeDays: completeDayDates.length,
    completeDayDates,
    signalDays,
    dailyCoverageRate: completeDayDates.length ? signalDays / completeDayDates.length : null,
    gradeStats: summarizeQqqIntradayDirectionalGrades(signals),
    opportunityStats,
    lifecycleStats,
    groupedStats,
    riskStats,
    sessionStats: {
      entrySignals: entryStructures.length,
      confirmedEntrySignals: confirmedEntrySignals.length,
      entryLifecycleEvents: entryLifecycleEvents.length,
      riskCues: riskCues.length,
      entrySignalDays,
      dataCompleteDays: dataCompleteDailyStats.length,
      dataCompleteSignalDays,
      dataCompleteCoverageRate: dataCompleteDailyStats.length ? dataCompleteSignalDays / dataCompleteDailyStats.length : null,
      riskCueDays: new Set(riskCues.map((signal) => signal.date)).size,
      longEntrySignals: entryStructures.filter((signal) => signal.direction === 'LONG').length,
      shortEntrySignals: entryStructures.filter((signal) => signal.direction === 'SHORT').length,
      averageEntrySignalsPerCompleteDay: completeDayDates.length ? entryStructures.length / completeDayDates.length : null,
      averageEntrySignalsPerEntryDay: entrySignalDays ? entryStructures.length / entrySignalDays : null,
      averageEntrySignalsPerDataCompleteDay: dataCompleteDailyStats.length
        ? dataCompleteDailyStats.reduce((sum, day) => sum + day.opportunitySignals, 0) / dataCompleteDailyStats.length
        : null,
      averageRiskCuesPerCompleteDay: completeDayDates.length ? riskCues.length / completeDayDates.length : null,
    },
    funnel,
    dailyStats,
    signals,
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

export function validateQqqIntradayDirectional(
  replay: QqqIntradayDirectionalReplayResult,
  repeatedFingerprint: string,
): QqqIntradayDirectionalValidation {
  // C 级只解决人工观察覆盖率，不参与正式准入，防止用更宽松候选稀释门槛。
  const forwardSignals = replay.signals.filter((signal) => signal.intent === 'ENTRY' && signal.stage === 'TRIGGERED' && signal.grade !== 'C' && signal.date >= QQQ_INTRADAY_DIRECTIONAL_POLICY.forwardWindowStartDate);
  const filled = forwardSignals.filter((signal) => signal.netR !== null);
  const forwardCompleteDays = replay.completeDayDates.filter((date) => date >= QQQ_INTRADAY_DIRECTIONAL_POLICY.forwardWindowStartDate).length;
  const longSignals = filled.filter((signal) => signal.direction === 'LONG').length;
  const shortSignals = filled.filter((signal) => signal.direction === 'SHORT').length;
  const netValues = filled.map((signal) => signal.netR!);
  const totalNet = netValues.reduce((sum, value) => sum + value, 0);
  const averageNetR = netValues.length ? totalNet / netValues.length : null;
  const grossProfit = netValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(netValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
  const invalidations = filled.filter((signal) => signal.outcome === 'INVALIDATION');
  const earlyInvalidationRate = filled.length
    ? invalidations.filter((signal) => !signal.reachedHalfRBeforeInvalidation).length / filled.length
    : null;
  const dailyNet = new Map<string, number>();
  for (const signal of filled) dailyNet.set(signal.date, (dailyNet.get(signal.date) ?? 0) + signal.netR!);
  const maximumDayContribution = totalNet > 0 && dailyNet.size
    ? Math.max(...dailyNet.values()) / totalNet
    : null;
  let worstRollingTenR: number | null = null;
  for (let index = 0; index + 10 <= netValues.length; index += 1) {
    const value = netValues.slice(index, index + 10).reduce((sum, item) => sum + item, 0);
    worstRollingTenR = worstRollingTenR === null ? value : Math.min(worstRollingTenR, value);
  }
  const reproducible = replay.fingerprint === repeatedFingerprint;
  const metrics = {
    completeDays: forwardCompleteDays,
    filledSignals: filled.length,
    longSignals,
    shortSignals,
    averageNetR,
    profitFactor,
    earlyInvalidationRate,
    maximumDayContribution,
    worstRollingTenR,
    reproducible,
  };
  const progress = {
    startDate: QQQ_INTRADAY_DIRECTIONAL_POLICY.forwardWindowStartDate,
    completeDays: forwardCompleteDays,
    requiredCompleteDays: 20,
    filledSignals: filled.length,
    requiredFilledSignals: 40,
    longSignals,
    requiredLongSignals: 15,
    shortSignals,
    requiredShortSignals: 15,
  };
  const insufficient = forwardCompleteDays < 20 || filled.length < 40 || longSignals < 15 || shortSignals < 15;
  if (insufficient) return {
    status: 'DISCOVERY',
    researchStatus: 'EXPERIMENTAL',
    reasons: [
      `冻结后完整交易日 ${forwardCompleteDays}/20`,
      `非重叠成交信号 ${filled.length}/40`,
      `多头 ${longSignals}/15，空头 ${shortSignals}/15`,
    ],
    metrics,
    progress,
  };
  const reasons: string[] = [];
  if ((averageNetR ?? Number.NEGATIVE_INFINITY) < 0.10) reasons.push('扣除 2bp 后平均收益低于 0.10R');
  if ((profitFactor ?? 0) < 1.25) reasons.push('Profit Factor 低于 1.25');
  if ((earlyInvalidationRate ?? 1) > 0.45) reasons.push('未达到 +0.5R 前先失效比例高于 45%');
  if ((maximumDayContribution ?? Number.POSITIVE_INFINITY) > 0.30) reasons.push('单日贡献高于总净收益 30%');
  if ((worstRollingTenR ?? Number.NEGATIVE_INFINITY) < -4) reasons.push('最差连续十个信号低于 -4R');
  if (!reproducible) reasons.push('相同冻结输入双跑 SHA-256 不一致');
  return reasons.length
    ? { status: 'VALIDATION_FAIL', researchStatus: 'VALIDATION_FAIL', reasons, metrics, progress }
    : { status: 'VALIDATED', researchStatus: 'VALIDATED', reasons: [], metrics, progress };
}
