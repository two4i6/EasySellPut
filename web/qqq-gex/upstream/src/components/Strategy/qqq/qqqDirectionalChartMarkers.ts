import type { UTCTimestamp } from 'lightweight-charts';
import type { QqqIntradayDirectionalDecision } from '@/lib/engines/analysis/QqqIntradayDirectional';
import type { QqqIntradayDirectionalReplaySignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
export type DirectionalChartSignal = QqqIntradayDirectionalDecision | QqqIntradayDirectionalReplaySignal;
export const emptyDirectionalChartSignals: readonly DirectionalChartSignal[] = [];
/** Uses emitted records only. Missing bars are never moved to another candle. */
export function buildDirectionalChartMarkers(signals: readonly DirectionalChartSignal[], bars: readonly { time: number; close: number; high?: number; low?: number }[]) {
 const barsByTime = new Map(bars.map(bar => [bar.time, bar]));
 const seen = new Set<string>();
 return signals.flatMap(signal => {
  const time = signal.anchorBar ? Date.parse(signal.anchorBar) / 1000 : NaN;
  const bar = barsByTime.get(time);
  if (!signal.signalId || seen.has(signal.signalId) || !bar || !Number.isFinite(bar.close) || bar.close <= 0) return [];
  if ('blockers' in signal && (signal.blockers.length || signal.status === 'INSUFFICIENT_DATA')) return [];
  const risk = signal.stage === 'RISK_ELEVATED' || signal.stage === 'STOP_RISK';
  const labels = { SETUP:'候选观察', ARMED:'等待确认', TRIGGERED:'机会待复核', RISK_ELEVATED:'风险升高', STOP_RISK:'风险确认' };
  if (!signal.stage || !labels[signal.stage]) return [];
  seen.add(signal.signalId);
  const side = risk ? signal.riskPlan?.atRisk ?? (signal.direction === 'LONG' ? 'SC' : 'SP') : signal.direction === 'LONG' ? 'SP' : 'SC';
  const upward = risk ? side === 'SC' : signal.direction === 'LONG';
  const text = `提示·${labels[signal.stage]} ${side === 'SP' ? '卖跌' : '卖涨'}`;
  const zone = signal.riskPlan?.triggerZone ?? signal.entryZone;
  return [{ id: signal.signalId, time: time as UTCTimestamp, position: upward ? 'atPriceBottom' as const : 'atPriceTop' as const,
   price: (upward ? bar.low ?? bar.close : bar.high ?? bar.close) + (upward ? -1 : 1) * Math.max(.5, bar.close * .0015),
   shape: risk ? 'circle' as const : upward ? 'arrowUp' as const : 'arrowDown' as const,
   color: signal.stage === 'STOP_RISK' ? '#fb7185' : risk ? '#fbbf24' : '#d4b16a', size: 2, text,
   detail: `${side === 'SP' ? '卖出看跌期权' : '卖出看涨期权'} · ${labels[signal.stage]}${zone ? ` · 价格区 ${zone.low.toFixed(2)}–${zone.high.toFixed(2)}` : ''}。这是当时发出的历史记录；当前是否有效请查看右侧盘中提示。`,
  }];
 }).sort((a,b) => Number(a.time)-Number(b.time));
}
