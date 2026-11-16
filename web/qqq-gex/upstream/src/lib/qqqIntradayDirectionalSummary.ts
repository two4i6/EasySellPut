import { easternDayStartUtc } from './engineTimeline';
import { createHash } from 'node:crypto';
import { groupedSignals, type QqqIntradayDirectionalReplayResult, type QqqIntradayDirectionalReplaySignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import { QQQ_INTRADAY_DIRECTIONAL_POLICY } from '@/lib/engines/analysis/QqqIntradayDirectional';
import { readQqqIntradayDirectionalReplay } from './qqqIntradayDirectionalReplayHistory';
import { supabaseAdmin } from './supabase';

const SUMMARY_TIMEOUT_MS = 8_000;

export type QqqIntradayDirectionalDailySummary = {
  policyId: string;
  sessionDate: string;
  computedAt: string;
  complete: boolean;
  dataQuality: {
    alertWindowBars: number;
    dataReadyWindowBars: number;
    coverageRatio: number | null;
  };
  summary: QqqIntradayDirectionalReplayResult;
  fingerprint: string;
};

const nextDate = (date: string) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

export function qqqIntradayDirectionalDayBounds(sessionDate: string) {
  const from = easternDayStartUtc(new Date(`${sessionDate}T12:00:00.000Z`));
  const to = easternDayStartUtc(new Date(`${nextDate(sessionDate)}T12:00:00.000Z`));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function buildQqqIntradayDirectionalDailySummary(
  policyId: string,
  sessionDate: string,
  replay: QqqIntradayDirectionalReplayResult,
): QqqIntradayDirectionalDailySummary | null {
  const day = replay.dailyStats.find((item) => item.date === sessionDate);
  if (!day) return null;
  const coverageRatio = day.alertWindowBars ? day.dataReadyWindowBars / day.alertWindowBars : null;
  return {
    policyId,
    sessionDate,
    computedAt: new Date().toISOString(),
    complete: day.complete && coverageRatio !== null && coverageRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.completeDayDataCoverageRatio,
    dataQuality: { alertWindowBars: day.alertWindowBars, dataReadyWindowBars: day.dataReadyWindowBars, coverageRatio },
    summary: replay,
    fingerprint: replay.fingerprint,
  };
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
};

const fingerprint = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');

function aggregateSignals(signals: QqqIntradayDirectionalReplaySignal[]) {
  const entries = signals.filter((signal) => signal.intent === 'ENTRY');
  const structures = new Set(entries.map((signal) => signal.structureId));
  const confirmed = entries.filter((signal) => signal.stage === 'TRIGGERED');
  const opportunities = entries.filter((signal) => signal.alertType === 'OPPORTUNITY');
  const evaluatedOpportunities = opportunities.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation !== null);
  const netValues = confirmed.flatMap((signal) => signal.netR == null ? [] : [signal.netR]);
  const opportunityMfe = evaluatedOpportunities.flatMap((signal) => signal.opportunityEvaluation?.mfeR == null ? [] : [signal.opportunityEvaluation.mfeR]);
  const opportunityMae = evaluatedOpportunities.flatMap((signal) => signal.opportunityEvaluation?.maeR == null ? [] : [signal.opportunityEvaluation.maeR]);
  const riskEvaluations = signals.filter((signal) => signal.intent === 'RISK_CUE').flatMap((signal) => signal.riskEvaluation ? [signal.riskEvaluation] : []);
  const evaluatedRisks = riskEvaluations.filter((evaluation) => evaluation.classification !== 'PENDING');
  const riskAdverse = riskEvaluations.flatMap((evaluation) => evaluation.adverseMove30mAtr == null ? [] : [evaluation.adverseMove30mAtr]);
  const grossProfit = netValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(netValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const dailyStats = [...new Set(signals.map((signal) => signal.date))].sort().map((date) => {
    const daySignals = signals.filter((signal) => signal.date === date);
    const entriesForDay = daySignals.filter((signal) => signal.intent === 'ENTRY');
    return { date, complete: true, alertWindowBars: 0, dataReadyWindowBars: 0, opportunitySignals: new Set(entriesForDay.map((signal) => signal.structureId)).size, confirmedSignals: entriesForDay.filter((signal) => signal.stage === 'TRIGGERED').length, riskCues: daySignals.filter((signal) => signal.intent === 'RISK_CUE').length };
  });
  const opportunityStructures = new Set(opportunities.map((signal) => signal.structureId));
  const confirmedUpgrades = confirmed.filter((signal) => opportunityStructures.has(signal.structureId));
  return {
    entries,
    structures,
    confirmed,
    opportunities,
    evaluatedOpportunities,
    netValues,
    opportunityMfe,
    opportunityMae,
    riskEvaluations,
    evaluatedRisks,
    riskAdverse,
    dailyStats,
    opportunityStructures,
    confirmedUpgrades,
    grossProfit,
    grossLoss,
  };
}

export function aggregateQqqIntradayDirectionalDailySummaries(summaries: QqqIntradayDirectionalDailySummary[]) {
  const ordered = summaries.slice().sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
  const usable = ordered.filter((summary) => summary.complete);
  const signals = usable.flatMap((summary) => summary.summary.signals);
  const aggregate = aggregateSignals(signals);
  const riskSignals = signals.filter((signal) => signal.intent === 'RISK_CUE');
  const completeDays = usable.length;
  const signalDays = new Set(aggregate.entries.map((signal) => signal.date)).size;
  const grades = (['A', 'B', 'C'] as const).reduce((result, grade) => {
    const rows = aggregate.confirmed.filter((signal) => signal.grade === grade && signal.netR !== null);
    const grossProfit = rows.filter((signal) => signal.netR! > 0).reduce((sum, signal) => sum + signal.netR!, 0);
    const grossLoss = Math.abs(rows.filter((signal) => signal.netR! < 0).reduce((sum, signal) => sum + signal.netR!, 0));
    result[grade] = {
      signals: aggregate.confirmed.filter((signal) => signal.grade === grade).length,
      filled: rows.length,
      signalDays: new Set(rows.map((signal) => signal.date)).size,
      winRate: rows.length ? rows.filter((signal) => signal.netR! > 0).length / rows.length : null,
      averageNetR: rows.length ? rows.reduce((sum, signal) => sum + signal.netR!, 0) / rows.length : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    };
    return result;
  }, {} as QqqIntradayDirectionalReplayResult['gradeStats']);
  const summaryBase = ordered[0]?.summary;
  if (!summaryBase) return null;
  const dailyStats = ordered.flatMap((summary) => summary.summary.dailyStats).sort((left, right) => left.date.localeCompare(right.date));
  const dataCompleteDailyStats = dailyStats.filter((day) => day.complete && day.alertWindowBars > 0 && day.dataReadyWindowBars / day.alertWindowBars >= QQQ_INTRADAY_DIRECTIONAL_POLICY.completeDayDataCoverageRatio);
  const aggregatedFunnel = usable.reduce((total, summary) => ({
    evaluatedBars: total.evaluatedBars + summary.summary.funnel.evaluatedBars,
    alertWindowBars: total.alertWindowBars + summary.summary.funnel.alertWindowBars,
    dataReadyWindowBars: total.dataReadyWindowBars + summary.summary.funnel.dataReadyWindowBars,
    insufficientDataBars: total.insufficientDataBars + summary.summary.funnel.insufficientDataBars,
    entry: {
      evaluatedBars: total.entry.evaluatedBars + summary.summary.funnel.entry.evaluatedBars,
      setups: total.entry.setups + summary.summary.funnel.entry.setups,
      armed: total.entry.armed + summary.summary.funnel.entry.armed,
      triggerCandidates: total.entry.triggerCandidates + summary.summary.funnel.entry.triggerCandidates,
      emitted: total.entry.emitted + summary.summary.funnel.entry.emitted,
      confirmed: total.entry.confirmed + summary.summary.funnel.entry.confirmed,
      rearmBlocked: total.entry.rearmBlocked + summary.summary.funnel.entry.rearmBlocked,
      budgetBlocked: total.entry.budgetBlocked + summary.summary.funnel.entry.budgetBlocked,
    },
    risk: {
      evaluatedBars: total.risk.evaluatedBars + summary.summary.funnel.risk.evaluatedBars,
      elevated: total.risk.elevated + summary.summary.funnel.risk.elevated,
      stopCandidates: total.risk.stopCandidates + summary.summary.funnel.risk.stopCandidates,
      emitted: total.risk.emitted + summary.summary.funnel.risk.emitted,
      rearmBlocked: total.risk.rearmBlocked + summary.summary.funnel.risk.rearmBlocked,
      budgetBlocked: total.risk.budgetBlocked + summary.summary.funnel.risk.budgetBlocked,
    },
    noSignalDates: [...total.noSignalDates, ...summary.summary.funnel.noSignalDates],
    topBlockers: total.topBlockers,
  }), { evaluatedBars: 0, alertWindowBars: 0, dataReadyWindowBars: 0, insufficientDataBars: 0, entry: { evaluatedBars: 0, setups: 0, armed: 0, triggerCandidates: 0, emitted: 0, confirmed: 0, rearmBlocked: 0, budgetBlocked: 0 }, risk: { evaluatedBars: 0, elevated: 0, stopCandidates: 0, emitted: 0, rearmBlocked: 0, budgetBlocked: 0 }, noSignalDates: [] as string[], topBlockers: [] as Array<{ reason: string; count: number }> });
  const blockerCounts = new Map<string, number>();
  for (const summary of usable) for (const blocker of summary.summary.funnel.topBlockers) blockerCounts.set(blocker.reason, (blockerCounts.get(blocker.reason) ?? 0) + blocker.count);
  aggregatedFunnel.topBlockers = [...blockerCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([reason, count]) => ({ reason, count }));
  const replayWithoutFingerprint = {
    ...summaryBase,
    days: ordered.length,
    completeDays,
    completeDayDates: ordered.filter((summary) => summary.complete).map((summary) => summary.sessionDate),
    signalDays,
    dailyCoverageRate: completeDays ? signalDays / completeDays : null,
    gradeStats: grades,
    opportunityStats: {
      signals: aggregate.opportunities.length,
      evaluated: aggregate.evaluatedOpportunities.length,
      halfRSuccessRate: aggregate.evaluatedOpportunities.length ? aggregate.evaluatedOpportunities.filter((signal) => signal.opportunityEvaluation?.reachedHalfRBeforeInvalidation === true).length / aggregate.evaluatedOpportunities.length : null,
      invalidatedBeforeHalfRRate: aggregate.evaluatedOpportunities.length ? aggregate.evaluatedOpportunities.filter((signal) => signal.opportunityEvaluation?.invalidatedBeforeHalfR === true).length / aggregate.evaluatedOpportunities.length : null,
      averageMfeR: aggregate.opportunityMfe.length ? aggregate.opportunityMfe.reduce((sum, value) => sum + value, 0) / aggregate.opportunityMfe.length : null,
      averageMaeR: aggregate.opportunityMae.length ? aggregate.opportunityMae.reduce((sum, value) => sum + value, 0) / aggregate.opportunityMae.length : null,
    },
    lifecycleStats: {
      opportunityStructures: aggregate.opportunityStructures.size,
      confirmedSignals: aggregate.confirmed.length,
      confirmedUpgrades: aggregate.confirmedUpgrades.length,
      directConfirmed: aggregate.confirmed.length - aggregate.confirmedUpgrades.length,
      confirmedUpgradeRate: aggregate.opportunityStructures.size ? aggregate.confirmedUpgrades.length / aggregate.opportunityStructures.size : null,
    },
    groupedStats: {
      opportunity: groupedSignals(aggregate.opportunities, 'opportunity'),
      confirmed: groupedSignals(aggregate.confirmed, 'confirmed'),
    },
    riskStats: {
      elevated: usable.reduce((sum, summary) => sum + summary.summary.riskStats.elevated, 0),
      stopCandidates: usable.reduce((sum, summary) => sum + summary.summary.riskStats.stopCandidates, 0),
      emitted: aggregate.riskEvaluations.length,
      evaluated: aggregate.evaluatedRisks.length,
      confirmedRisk: aggregate.evaluatedRisks.filter((evaluation) => evaluation.classification === 'CONFIRMED_RISK').length,
      falseStop: aggregate.evaluatedRisks.filter((evaluation) => evaluation.classification === 'FALSE_STOP').length,
      neutral: aggregate.evaluatedRisks.filter((evaluation) => evaluation.classification === 'NEUTRAL').length,
      pending: aggregate.riskEvaluations.filter((evaluation) => evaluation.classification === 'PENDING').length,
      confirmedRiskRate: aggregate.evaluatedRisks.length ? aggregate.evaluatedRisks.filter((evaluation) => evaluation.classification === 'CONFIRMED_RISK').length / aggregate.evaluatedRisks.length : null,
      falseStopRate: aggregate.evaluatedRisks.length ? aggregate.evaluatedRisks.filter((evaluation) => evaluation.classification === 'FALSE_STOP').length / aggregate.evaluatedRisks.length : null,
      averageAdverseMove30mAtr: aggregate.riskAdverse.length ? aggregate.riskAdverse.reduce((sum, value) => sum + value, 0) / aggregate.riskAdverse.length : null,
    },
    sessionStats: {
      entrySignals: aggregate.structures.size,
      confirmedEntrySignals: aggregate.confirmed.length,
      entryLifecycleEvents: aggregate.entries.length,
      riskCues: aggregate.riskEvaluations.length,
      entrySignalDays: signalDays,
      dataCompleteDays: dataCompleteDailyStats.length,
      dataCompleteSignalDays: dataCompleteDailyStats.filter((day) => day.opportunitySignals > 0).length,
      dataCompleteCoverageRate: dataCompleteDailyStats.length ? dataCompleteDailyStats.filter((day) => day.opportunitySignals > 0).length / dataCompleteDailyStats.length : null,
      riskCueDays: new Set(riskSignals.map((signal) => signal.date)).size,
      longEntrySignals: [...aggregate.structures].filter((structureId) => aggregate.entries.find((signal) => signal.structureId === structureId)?.direction === 'LONG').length,
      shortEntrySignals: [...aggregate.structures].filter((structureId) => aggregate.entries.find((signal) => signal.structureId === structureId)?.direction === 'SHORT').length,
      averageEntrySignalsPerCompleteDay: completeDays ? aggregate.structures.size / completeDays : null,
      averageEntrySignalsPerEntryDay: signalDays ? aggregate.structures.size / signalDays : null,
      averageEntrySignalsPerDataCompleteDay: dataCompleteDailyStats.length ? dataCompleteDailyStats.reduce((sum, day) => sum + day.opportunitySignals, 0) / dataCompleteDailyStats.length : null,
      averageRiskCuesPerCompleteDay: completeDays ? aggregate.riskEvaluations.length / completeDays : null,
    },
    dailyStats,
    funnel: aggregatedFunnel,
    signals,
  } as QqqIntradayDirectionalReplayResult;
  return { ...replayWithoutFingerprint, fingerprint: fingerprint(replayWithoutFingerprint) };
}

export async function computeQqqIntradayDirectionalDailySummary(
  sessionDate: string,
  policyId = 'qqq-pcs-intraday-v1',
) {
  const bounds = qqqIntradayDirectionalDayBounds(sessionDate);
  const result = await readQqqIntradayDirectionalReplay({ policyId, from: bounds.from, to: bounds.to });
  return result ? buildQqqIntradayDirectionalDailySummary(policyId, sessionDate, result.replay) : null;
}

export async function persistQqqIntradayDirectionalDailySummary(summary: QqqIntradayDirectionalDailySummary) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const { error } = await supabaseAdmin.from('qqq_intraday_directional_daily_summary').upsert({
      policy_id: summary.policyId,
      session_date: summary.sessionDate,
      computed_at: summary.computedAt,
      complete: summary.complete,
      data_quality: summary.dataQuality,
      summary: summary.summary,
      fingerprint: summary.fingerprint,
    }, { onConflict: 'policy_id,session_date' }).abortSignal(controller.signal);
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readQqqIntradayDirectionalDailySummaries(input: {
  policyId?: string;
  from: string;
  to: string;
}): Promise<QqqIntradayDirectionalDailySummary[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const result = await supabaseAdmin.from('qqq_intraday_directional_daily_summary')
      .select('policy_id, session_date, computed_at, complete, data_quality, summary, fingerprint')
      .eq('policy_id', input.policyId ?? 'qqq-pcs-intraday-v1')
      .gte('session_date', input.from)
      .lt('session_date', input.to)
      .order('session_date', { ascending: true })
      .abortSignal(controller.signal);
    if (result.error) return null;
    return (result.data ?? []).flatMap((row: any) => typeof row.session_date === 'string' && typeof row.fingerprint === 'string'
      ? [{
          policyId: row.policy_id,
          sessionDate: row.session_date,
          computedAt: row.computed_at,
          complete: row.complete === true,
          dataQuality: row.data_quality,
          summary: row.summary,
          fingerprint: row.fingerprint,
        } as QqqIntradayDirectionalDailySummary]
      : []);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function previousQqqTradingDate(now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 1);
  for (let attempts = 0; attempts < 7; attempts += 1) {
    const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(date);
    if (eastern !== 'Sat' && eastern !== 'Sun') return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return null;
}

export function mergeQqqIntradayDirectionalDailySummaries(summaries: QqqIntradayDirectionalDailySummary[]) {
  return summaries.reduce((latest, current) => Date.parse(current.computedAt) > Date.parse(latest.computedAt) ? current : latest, summaries[0] ?? null);
}
