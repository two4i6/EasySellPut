'use client';

import { useEffect, useMemo, useState } from 'react';
import Tooltip from '@/components/Tooltip';
import type { QqqLifecycleFactor } from '@/lib/qqqLifecycleFactors';
import type { QqqIntradayExecutionScoreFactor } from './QqqIntradayExecutionScoreCard';

export type QqqLifecycleContract = {
  status: 'READY';
  expiry: string;
  daysToExpiration: number;
  shortStrike: number;
  longStrike: number;
  netCredit: number;
  annualizedReturn: number;
  optionType?: 'call' | 'put';
} | { status: 'UNAVAILABLE'; reason: string };

export type QqqLifecyclePoint = {
  time: string;
  score: number;
  timing: 'NOW' | 'WAIT_PULLBACK' | 'WAIT_CONFIRM' | 'NO_ENTRY_SIGNAL' | 'INSUFFICIENT_DATA';
  contract: QqqLifecycleContract | null;
  executionFactors?: QqqLifecycleFactor[];
};

type LifecycleMinutePoint = { first: QqqLifecyclePoint; last: QqqLifecyclePoint };
type LifecycleRun = LifecycleMinutePoint & { points: LifecycleMinutePoint[] };

export const collapseLifecyclePointsByMinute = (points: QqqLifecyclePoint[]): LifecycleMinutePoint[] => points.reduce<LifecycleMinutePoint[]>((minutes, point) => {
  const minute = new Date(point.time).toLocaleTimeString('en-CA', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  const previous = minutes.at(-1);
  if (previous && new Date(previous.last.time).toLocaleTimeString('en-CA', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }) === minute) previous.last = point;
  else minutes.push({ first: point, last: point });
  return minutes;
}, []);

export const collapseLifecycleRuns = (points: QqqLifecyclePoint[]): LifecycleRun[] => collapseLifecyclePointsByMinute(points).reduce<LifecycleRun[]>((runs, point) => {
  const previous = runs.at(-1);
  if (previous && previous.last.score === point.last.score) {
    previous.last = point.last;
    previous.points.push(point);
  } else runs.push({ ...point, points: [point] });
  return runs;
}, []);

const timingColor = (timing: QqqLifecyclePoint['timing']) => timing === 'NOW' ? 'var(--accent-success)' : timing === 'NO_ENTRY_SIGNAL' || timing === 'INSUFFICIENT_DATA' ? 'var(--accent-danger)' : 'var(--accent-warning)';
const lifecycleLabel = (score: number) => score >= 5 ? '条件齐全' : score >= 4 ? '条件较好' : score >= 3 ? '等待确认' : score >= 2 ? '等待回落' : '初始观察';
const etTime = (time: string) => new Date(time).toLocaleTimeString('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const lifecycleTimeLabel = (first: QqqLifecyclePoint, last: QqqLifecyclePoint) => `${etTime(first.time)}${first.time === last.time ? '' : `–${etTime(last.time)}`} ET`;
const contractLabel = (contract: QqqLifecycleContract | null, strategy: 'PCS' | 'CS') => !contract ? '链未记录' : contract.status === 'READY' ? `${contract.shortStrike}/${contract.longStrike}${contract.optionType === 'call' || strategy === 'CS' ? 'C' : 'P'}` : '链不可用';

export default function QqqIntradayLifecycle({ strategy, points, timing, executionScore, currentContract, currentFactors = [], historyKey = strategy, closed = false }: { strategy: 'PCS' | 'CS'; points: QqqLifecyclePoint[]; timing: QqqLifecyclePoint['timing']; executionScore: number | null; currentContract: QqqLifecycleContract | null; currentFactors?: QqqIntradayExecutionScoreFactor[]; historyKey?: string; closed?: boolean }) {
  const currentTags: QqqLifecycleFactor[] = currentFactors.map(factor => ({ label: factor.label, value: factor.value, passed: factor.factor && factor.factor.confidence > 0 && factor.factor.source.type !== 'fallback' ? factor.passed : null }));
  const renderTags = (recorded?: QqqLifecycleFactor[]) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{(recorded ?? currentTags.map(tag => ({ ...tag, value: '未记录', passed: null }))).map(tag => {
    const color = tag.passed === null ? 'var(--text-tertiary)' : tag.passed ? 'var(--accent-success)' : 'var(--accent-danger)';
    return <Tooltip key={tag.label} content={`${tag.label}：${tag.value} · ${tag.passed === null ? '未记录' : tag.passed ? '通过' : '未通过'}`}><span style={{ border: `1px solid ${color}`, borderRadius: 4, color, display: 'inline-block', fontSize: '0.6rem', padding: '2px 4px' }}>{tag.label}</span></Tooltip>;
  })}</div>;
  const [expandedLifecycleKey, setExpandedLifecycleKey] = useState<string | null>(null);
  const [retainedHistory, setRetainedHistory] = useState<{ key: string; points: QqqLifecyclePoint[] }>({ key: historyKey, points: [] });
  const mergedPoints = useMemo(() => {
    const byTime = new Map((retainedHistory.key === historyKey ? retainedHistory.points : []).map(point => [point.time, point]));
    for (const point of points) byTime.set(point.time, point);
    return [...byTime.values()].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  }, [historyKey, points, retainedHistory]);
  useEffect(() => {
    setRetainedHistory(previous => {
      if (previous.key === historyKey && previous.points.length === mergedPoints.length && previous.points.every((point, index) => point === mergedPoints[index])) return previous;
      return { key: historyKey, points: mergedPoints };
    });
  }, [historyKey, mergedPoints]);
  const lifecycleRuns = useMemo(() => closed ? [] : collapseLifecycleRuns(mergedPoints), [closed, mergedPoints]);
  const currentMissing = executionScore === null;
  const currentColor = currentMissing ? '#fff' : timingColor(timing);
  const lastSnapshot = mergedPoints.at(-1);
  const displayRuns: LifecycleRun[] = closed
    ? lastSnapshot ? [{ first: lastSnapshot, last: lastSnapshot, points: [{ first: lastSnapshot, last: lastSnapshot }] }] : []
    : [...lifecycleRuns].reverse();
  const expandedLifecycleRun = displayRuns.find(({ first }) => first.time === expandedLifecycleKey) ?? null;
  const lifecycleDetail = (first: QqqLifecyclePoint, last: QqqLifecyclePoint) => <>
    <strong>{lifecycleLabel(last.score)}</strong><br />执行分 {last.score}/5<br />状态 {last.timing}<br />
    {contractLabel(first.contract, strategy) !== contractLabel(last.contract, strategy) && <>合约更新：{contractLabel(first.contract, strategy)} → {contractLabel(last.contract, strategy)}<br /></>}
    {last.contract?.status === 'READY' ? <>真实链 SELL {last.contract.shortStrike}{last.contract.optionType === 'call' || strategy === 'CS' ? 'C' : 'P'} / BUY {last.contract.longStrike}{last.contract.optionType === 'call' || strategy === 'CS' ? 'C' : 'P'} · {last.contract.expiry}<br />{last.contract.daysToExpiration} DTE · 净权利金 ${last.contract.netCredit.toFixed(2)} · 风险资本简单年化 {last.contract.annualizedReturn.toFixed(1)}%</> : last.contract?.status === 'UNAVAILABLE' ? `真实链：${last.contract.reason}` : '真实链：该节点尚未记录'}<br />{lifecycleTimeLabel(first, last)}
  </>;

  return <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '0.65rem', paddingTop: '0.65rem' }}>
    <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
      <strong style={{ fontSize: '0.78rem' }}>盘中状态生命周期{closed ? '（已收盘）' : '（今日）'}</strong>
      <Tooltip content={displayRuns.length ? undefined : closed ? '当天没有可用的盘中快照。' : '当天历史快照为空或暂未加载；下方当前状态来自本次响应，不代表历史记录。'}><span style={{ color: 'var(--text-tertiary)', cursor: displayRuns.length ? undefined : 'help', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{closed ? displayRuns.length ? '最后盘中快照 · 点击展开' : '当日快照暂无' : lifecycleRuns.length ? `${lifecycleRuns.length} 个状态段 · 点击展开` : '历史快照暂无 · 显示当前状态'}</span></Tooltip>
    </div>
    <div aria-label={`今日 ${strategy} 盘中状态生命周期`} style={{ display: 'flex', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain', padding: '0.55rem 0 0.35rem', scrollSnapType: 'x proximity', scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch' }}>
        {!closed && <div style={{ display: 'grid', position: 'relative', flex: '0 0 144px', gap: 4, minWidth: 144, scrollSnapAlign: 'start' }}><i aria-hidden="true" style={{ background: currentColor, display: displayRuns.length ? 'block' : 'none', height: 3, left: 38, position: 'absolute', right: 0, top: 16 }} /><div style={{ alignItems: 'center', background: currentMissing ? 'transparent' : currentColor, border: `2px solid ${currentColor}`, borderRadius: 8, color: currentMissing ? currentColor : 'var(--bg-card)', display: 'grid', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 900, height: 34, placeItems: 'center', width: 34 }}>{executionScore ?? '—'}</div><strong style={{ color: currentColor, fontSize: '0.7rem' }}>目前</strong><small style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', whiteSpace: 'nowrap' }}>{contractLabel(currentContract, strategy)}{timing !== 'INSUFFICIENT_DATA' && ` · ${timing}`}</small></div>}
        {displayRuns.map(({ first, last }, index) => <Tooltip key={first.time} style={{ display: 'block', flex: '0 0 144px', minWidth: 144, width: 144, scrollSnapAlign: 'start' }} maxWidth="220px" content={<div>{lifecycleDetail(first, last)}</div>}><button type="button" aria-expanded={expandedLifecycleKey === first.time} aria-label={`展开 ${lifecycleTimeLabel(first, last)} 的状态详情`} onClick={() => setExpandedLifecycleKey((key) => key === first.time ? null : first.time)} style={{ appearance: 'none', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', display: 'block', font: 'inherit', padding: 0, textAlign: 'left', width: '100%' }}><div style={{ color: 'var(--text-secondary)', display: 'grid', gap: 4, paddingRight: 10, position: 'relative' }}><i aria-hidden="true" style={{ background: timingColor(last.timing), display: index < displayRuns.length - 1 ? 'block' : 'none', height: 3, left: 38, position: 'absolute', right: 0, top: 16 }} /><div style={{ alignItems: 'center', background: expandedLifecycleKey === first.time ? `color-mix(in srgb, ${timingColor(last.timing)} 18%, var(--bg-card))` : 'var(--bg-card)', border: `2px solid ${timingColor(last.timing)}`, borderRadius: 8, color: timingColor(last.timing), display: 'grid', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 900, height: 34, placeItems: 'center', width: 34 }}>{last.score}</div><strong style={{ color: 'var(--text-primary)', fontSize: '0.7rem' }}>{lifecycleLabel(last.score)}</strong><small style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', whiteSpace: 'nowrap' }}>{lifecycleTimeLabel(first, last)}</small></div></button></Tooltip>)}
    </div>
    {expandedLifecycleRun && <div style={{ background: 'var(--bg-secondary)', border: `1px solid color-mix(in srgb, ${timingColor(expandedLifecycleRun.last.timing)} 35%, var(--border-subtle))`, borderRadius: 8, color: 'var(--text-secondary)', marginTop: 6, padding: '0.65rem 0.75rem' }}><div style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 800, marginBottom: 7 }}>该状态段详情</div><div style={{ display: 'grid', gap: 6 }}>{[...expandedLifecycleRun.points].reverse().map(({ first, last }) => <div key={first.time} style={{ alignItems: 'center', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', gap: 8, justifyContent: 'space-between', paddingTop: 6 }}><span style={{ color: timingColor(last.timing), fontWeight: 900 }}>{last.score}/5 · {lifecycleLabel(last.score)} · {last.timing}</span><span style={{ color: 'var(--text-secondary)' }}>{contractLabel(last.contract, strategy)} · {lifecycleTimeLabel(first, last)}</span><div style={{ flexBasis: '100%' }}>{renderTags(last.executionFactors)}</div></div>)}</div></div>}
  </div>;
}
