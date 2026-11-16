import type { BacktestResult } from '../leveraged-overlay/backtest/types';
import type { QqqPcsReplayDailySignal } from './QqqPcsHistoricalBacktest';
import type { QqqEb2Cycle } from './QqqEb2E44Fused';

/** Preserve engine admission gates and add the dynamic arm's final selection. */
export function qqqEbDailyAdmissions(raw: Pick<BacktestResult, 'debug'>, cycles: readonly QqqEb2Cycle[]): QqqPcsReplayDailySignal[] {
  const selected = new Set(cycles.map(cycle => (cycle.open.signalDate ?? cycle.open.date).slice(0, 10)));
  const entries = raw.debug?.dailyAdmissions ?? (raw.debug?.trace ?? []).map(entry => ({ date: entry.date, admissions: entry.overlay.strategyAdmissions ?? [] }));
  return entries.flatMap(entry => {
    const admission = entry.admissions.find(item => item.strategyTag === 'QQQ_EQUITY_BOOST_PUT_SPREAD');
    if (!admission) return [];
    const date = entry.date.slice(0, 10);
    const finalSelected = selected.has(date);
    // Final dynamic selection is an additional requirement, never a replacement
    // for the original safety/signal gates. Keep all five recorded engine gates.
    return [{ date, strategy: 'EB' as const, eligibility: finalSelected ? 'OPEN' as const : 'BLOCK' as const,
      reasons: [...admission.reasons, finalSelected ? '动态 EB 层保留该信号候选' : '动态 EB 层未保留该信号候选'],
      gates: admission.gates.map((gate, index) => index === admission.gates.length - 1 ? { ...gate, status: finalSelected ? 'PASS' as const : 'BLOCK' as const, detail: `${gate.detail}；动态 EB 最终候选${finalSelected ? '保留' : '未保留'}` } : gate) }];
  });
}

export function qqqEbAdmissionSnapshot(raw: BacktestResult): Pick<BacktestResult, 'debug'> {
  return { debug: { dailyAdmissions: raw.debug?.dailyAdmissions ?? (raw.debug?.trace ?? []).map(entry => ({ date: entry.date, marketState: entry.marketState, admissions: entry.overlay.strategyAdmissions ?? [] })) } };
}
