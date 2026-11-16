'use client';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { useQqqIntradayStudy } from '@/hooks/useQqqIntradayStudy';
import { prepareRvolBaseline, qqqPulseSeries, qqqRegularBarIndex, qqqRvolFromBaseline, qqqWindowVolatility, type PulsePoint, type RvolBaseline } from '@/lib/qqqIntradayIndicators';
import { qqqObservationPrefix } from '@/lib/qqqOptionObservationHistory';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
import { QqqObservationEmpty, QqqObservationHeading } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';
const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : value.toFixed(digits);
const money = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(2)}`;
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function IntradayPulsePlot({ points }: { points: readonly PulsePoint[] }) {
  if (!points.length) return <QqqObservationEmpty>等待所选日期已收盘的常规时段 K 线。</QqqObservationEmpty>;
  const values = points.flatMap(p => [p.close, ...(p.vwap === null || p.deviation === null ? [] : [p.vwap - 2 * p.deviation, p.vwap + 2 * p.deviation]), ...(p.openingHigh === null ? [] : [p.openingHigh, p.openingLow!])]);
  const low = Math.min(...values), high = Math.max(...values), pad = Math.max(.1, (high - low) * .1), first = points[0].time, last = points.at(-1)!.time;
  const x = (at: number) => first === last ? 196 : 53 + (at - first) / (last - first) * 291, y = (price: number) => 16 + (high + pad - price) / (high - low + pad * 2) * 132;
  const path = (value: (p: PulsePoint) => number | null) => { let segment = false; return points.map((p, i) => { const v = value(p); if (v === null) { segment = false; return ''; } const command = segment && p.openedAt === points[i - 1]?.time ? 'L' : 'M'; segment = true; return `${command}${x(p.time)},${y(v)}`; }).join(' '); };
  return <svg viewBox="0 0 360 178" width="100%" role="img" aria-label="QQQ 价格、VWAP 偏离带与开盘三十分钟区间">
    {[low, (low + high) / 2, high].map((v, i) => <g key={i}><line x1="53" x2="344" y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" /><text x="48" y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--text-tertiary)">{money(v)}</text></g>)}
    {[-2, -1, 1, 2].map(band => <path key={band} d={path(p => p.vwap === null || p.deviation === null ? null : p.vwap + band * p.deviation)} stroke="#a78bfa" opacity={Math.abs(band) === 2 ? .45 : .75} strokeDasharray="3 3" fill="none" />)}
    <path d={path(p => p.vwap)} stroke="#fbbf24" fill="none" strokeWidth="1.5" />
    <path d={path(p => p.openingHigh)} stroke="#2dd4bf" fill="none" strokeDasharray="5 3" /><path d={path(p => p.openingLow)} stroke="#fb7185" fill="none" strokeDasharray="5 3" />
    <path d={path(p => p.close)} stroke="#60a5fa" fill="none" strokeWidth="1.6" />
    <text x="53" y="169" fontSize="10" fill="var(--text-tertiary)">{time.format(first)} ET</text><text x="344" y="169" textAnchor="end" fontSize="10" fill="var(--text-tertiary)">{time.format(last)} ET</text>
  </svg>;
}

export default function QqqIntradayPulseCard({ data, replay, selectedExpiry }: { data: QqqPcsApiResponse; replay: QqqExposureReplayContext | null; selectedExpiry: string | null }) {
  const visible = useQqqTerminalTabVisible(), study = useQqqIntradayStudy(data, replay, selectedExpiry, visible, true, true);
  const index = useMemo(() => qqqRegularBarIndex(study.bars, study.date), [study.bars, study.date]);
  const series = useMemo(() => qqqPulseSeries(index), [index]);
  const points = useMemo(() => qqqObservationPrefix(series, study.cutoff), [series, study.cutoff]), latest = points.at(-1);
  const volatility = useMemo(() => [10, 30].map(minutes => qqqWindowVolatility(index, study.cutoff, minutes as 10 | 30, study.iv, study.ivAt, study.expiry)), [index, study.cutoff, study.iv, study.ivAt, study.expiry]);
  const reference = study.context.data;
  const [baseline, setBaseline] = useState<{ reference: typeof reference; value: RvolBaseline } | null>(null);
  const [baselineFailure, setBaselineFailure] = useState<typeof reference | null>(null);
  const baselineReady = baseline?.reference === reference && reference !== null;
  useEffect(() => {
    if (!visible || !reference || baselineReady) return;
    const controller = new AbortController();
    void prepareRvolBaseline(reference.days, reference.date, controller.signal).then(value => { if (!controller.signal.aborted) { setBaseline({ reference, value }); setBaselineFailure(null); } }).catch(() => { if (!controller.signal.aborted) setBaselineFailure(reference); });
    return () => controller.abort();
  }, [visible, reference, baselineReady]);
  const rvol = useMemo(() => qqqRvolFromBaseline(latest, baselineReady ? baseline!.value : [], study.cutoff), [latest, baselineReady, baseline, study.cutoff]);
  const z = latest?.vwap != null && latest.deviation != null && latest.deviation > 0 ? (latest.close - latest.vwap) / latest.deviation : null;
  return <div>
    <p className={styles.meta}>{study.date} · {study.expiry ?? '待到期日'} · {Number.isFinite(study.cutoff) ? time.format(study.cutoff) + ' ET' : '等待回放帧'}{study.cutoff < study.observationCutoff ? ' · 常规时段收盘参考' : ''}</p>
    <section className={styles.card} aria-label="短窗 RV 与 IV 比较">
      <QqqObservationHeading title="实际波动 RV / IV" info="RV 为连续 2 分钟收盘对数收益平方和的平方根；IV 按 365 日日历年缩放到同一个 10／30 分钟窗口，以当前价格换算美元波动。比较过去 RV 与冻结期限 IV 的同窗模型尺度，不代表未来波动或卖方优势。到期不足窗口、价格断档、IV 快照超过 5 分钟时不计算比值。" />
      <table className={styles.observationTable}><thead><tr><th>窗口</th><th>实际 RV</th><th>IV 同窗</th><th>IV/RV</th></tr></thead><tbody>{volatility.map(value => <tr key={value.minutes} title={value.reason ?? undefined}><td>{value.minutes}m</td><td>{money(value.realizedPoints)}</td><td>{money(value.impliedPoints)}</td><td>{number(value.ratio)}{value.ratio !== null ? '×' : ''}</td></tr>)}</tbody></table>
      <svg viewBox="0 0 330 66" width="100%" role="img" aria-label="十分钟和三十分钟 RV 与同窗 IV 波动比较">{volatility.map((value, i) => { const max = Math.max(...volatility.flatMap(v => [v.realizedPoints ?? 0, v.impliedPoints ?? 0]), .01); return <g key={value.minutes}><text x="0" y={i * 30 + 15} fill="var(--text-tertiary)" fontSize="10">{value.minutes}m</text>{value.realizedPoints !== null && <rect x="32" y={i * 30 + 3} width={value.realizedPoints / max * 260} height="7" fill="#60a5fa" />}{value.impliedPoints !== null && <rect x="32" y={i * 30 + 13} width={value.impliedPoints / max * 260} height="7" fill="#c084fc" />}</g>; })}</svg>
      <p className={styles.meta}>蓝色 RV · 紫色 IV 模型尺度{study.preparing ? ' · 正在整理 IV…' : ''}</p>
      {volatility.filter(value => value.reason).map(value => <p key={value.minutes} role="status" className={styles.meta}>{value.minutes}m：{value.reason}</p>)}
    </section>
    <section className={styles.card} aria-label="VWAP 偏离带与开盘区间">
      <QqqObservationHeading title="VWAP 偏离 / OR30" info="VWAP 与成交量加权标准差使用常规时段每根 K 线的 (高＋低＋收)/3，是 2 分钟近似，不是逐笔 VWAP。偏离带为 ±1／2 倍标准差，不是置信区间。OR30 在 10:00 ET、完整开盘 15 根 K 线收盘后固定；缺开盘或中间 K 线时不冒充完整时段统计。" />
      <IntradayPulsePlot points={points} />
      <div className={styles.studyMetrics}><span>VWAP <strong>{money(latest?.vwap)}</strong></span><span>偏离 <strong>{number(z)}{z === null ? '' : ' σ'}</strong></span><span>OR 上沿 <strong>{money(latest?.openingHigh)}</strong></span><span>OR 下沿 <strong>{money(latest?.openingLow)}</strong></span></div>
      <p className={styles.meta}>蓝色价格 · 黄色 VWAP · 紫色偏离带 · 绿／红色 OR30</p>
      {latest?.vwap === null && <QqqObservationEmpty>开盘起点或连续 K 线不完整；保留价格线，等待完整时段记录。</QqqObservationEmpty>}
    </section>
    <section className={styles.card} aria-label="同时间段相对成交量 RVOL">
      <QqqObservationHeading title="同期 RVOL" value={rvol.value === null ? '—' : `${rvol.value.toFixed(2)}×`} info="当日从 09:30 到游标前最后一根已收盘 K 线的累计成交量，除以前 20 个交易日同一时段累计量的中位数。只纳入该时段完整的历史日；不足 5 日或基线为零时不输出倍数。半日市不贡献其收盘之后的基线。" />
      {rvol.value !== null && <div className={styles.rvolTrack} role="img" aria-label={`同期成交量 ${rvol.value.toFixed(2)} 倍，基线一倍`}><span style={{ width: `${Math.min(100, rvol.value / Math.max(3, rvol.value) * 100)}%` }} /><i style={{ left: `${100 / Math.max(3, rvol.value)}%` }} /></div>}
      <div className={styles.studyMetrics}><span>当前累计 <strong>{number(rvol.current, 0)}</strong></span><span>同期中位数 <strong>{number(rvol.baseline, 0)}</strong></span></div>
      <p className={styles.meta}>有效基线 {rvol.sampleDays}/20 日 · 少于 5 日不显示倍数</p>
      {rvol.value === null && reference && baselineReady && <p role="status" className={styles.meta}>{!latest || latest.cumulativeVolume === null ? '当前常规时段 K 线不完整，无法累计成交量。' : study.cutoff - latest.time > 300_000 ? '同期价格已超过五分钟未更新，RVOL 暂不可用。' : rvol.sampleDays < 5 ? '同期完整历史日不足五日，等待基线积累。' : '同期成交量基线为零，无法计算倍数。'}</p>}
      {study.context.loading && <QqqObservationEmpty>正在读取完整 K 线与同期成交量基线…</QqqObservationEmpty>}
      {reference && !baselineReady && baselineFailure !== reference && <QqqObservationEmpty>正在整理同期成交量基线…</QqqObservationEmpty>}
      {reference && baselineFailure === reference && <QqqObservationEmpty>同期成交量基线整理失败，请重试读取历史。</QqqObservationEmpty>}
      {study.context.error && <p role="status" className={styles.meta}>{study.context.error} <button type="button" onClick={study.context.retry}>重试</button></p>}
      {study.context.data?.issues?.map(issue => <p role="status" key={issue} className={styles.meta}>{issue} <button type="button" onClick={study.context.retry}>重试</button></p>)}
      {study.preparationError && <QqqObservationEmpty>{study.preparationError}</QqqObservationEmpty>}
    </section>
  </div>;
}
