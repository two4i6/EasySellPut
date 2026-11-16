'use client';

import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { EMPTY_OBSERVATION_EXPIRIES, EMPTY_OBSERVATION_FRAMES, EMPTY_OBSERVATION_BARS, qqqObservationSpotIndex, qqqOptionObservationCutoff } from '@/lib/qqqOptionObservationHistory';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
import { prepareQqqMaxPain, qqqMaxPainAt, type QqqMaxPainTrack } from '@/lib/qqqMaxPain';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { QqqObservationEmpty, QqqObservationHeading } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';

const money = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(2)}`;
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeLabel = (time: number) => timeFormatter.format(time);
type PlotPoint = { x: number; value: number | null; label: string };

export function QqqMaxPainPlot({ points, spot, history = false }: { points: PlotPoint[]; spot: number | null; history?: boolean }) {
  const values = points.flatMap(point => point.value === null ? [] : [point.value]);
  if (!values.length) return <QqqObservationEmpty>等待完整双边 OI，缺失数据不计算 Max Pain。</QqqObservationEmpty>;
  const extent = spot === null ? values : [...values, spot];
  const low = Math.min(...extent), high = Math.max(...extent), pad = Math.max(1, (high - low) * .15);
  const from = points[0].x, to = points.at(-1)!.x;
  const x = (value: number) => from === to ? 203 : 58 + (value - from) / (to - from) * 290;
  const y = (value: number) => 20 + (high + pad - value) / (high - low + pad * 2) * 135;
  let lastLabel = -Infinity;
  const labels = points.filter((point, index) => {
    const position = x(point.x);
    if (index === points.length - 1) return position - lastLabel >= 40;
    if (position - lastLabel >= 55 && x(to) - position >= 45) { lastLabel = position; return true; }
    return false;
  });
  return <svg width="100%" viewBox="0 0 360 190" role="img" aria-label={history ? '所选到期日 Max Pain 历史变化' : '各到期日 Max Pain 与 QQQ 现价'}>
    {[low - pad, (low + high) / 2, high + pad].map((value, index) => <g key={index}>
      <line x1="58" x2="348" y1={y(value)} y2={y(value)} stroke="var(--border-subtle)" />
      <text x="53" y={y(value) + 4} textAnchor="end" fill="var(--text-tertiary)" fontSize="10">{money(value)}</text>
    </g>)}
    {spot !== null && <line x1="58" x2="348" y1={y(spot)} y2={y(spot)} stroke="var(--text-secondary)" strokeDasharray="5 4"><title>{`QQQ 同期参考价 ${money(spot)}`}</title></line>}
    {points.map((point, index) => {
      if (point.value === null) return null;
      const previous = points[index - 1];
      return <g key={point.x}>
        {previous?.value != null && (!history || point.x - previous.x <= 300_000) && <line x1={x(previous.x)} y1={y(previous.value)} x2={x(point.x)} y2={y(point.value)} stroke="#38bdf8" strokeWidth="2" />}
        <circle cx={x(point.x)} cy={y(point.value)} r={history ? 2 : 3} fill="#38bdf8"><title>{`${point.label} · Max Pain ${money(point.value)}`}</title></circle>
        {!history && points.length <= 5 && <text x={x(point.x)} y={y(point.value) - 8} textAnchor="middle" fill="var(--text-primary)" fontSize="10">{money(point.value)}</text>}
      </g>;
    })}
    {labels.map(point => <text key={point.x} x={x(point.x)} y="182" textAnchor="middle" fill="var(--text-tertiary)" fontSize="10">{point.label}</text>)}
  </svg>;
}

export default function QqqMaxPainCard({ data, replay, selectedExpiry, onSelectExpiry }: {
  data: QqqPcsApiResponse; replay: QqqExposureReplayContext | null; selectedExpiry: string | null; onSelectExpiry: (expiry: string) => void;
}) {
  const visible = useQqqTerminalTabVisible();
  const cutoff = qqqOptionObservationCutoff(Date.parse(data.observedAt ?? data.asOf), replay);
  const expiries = data.intraday?.gexExpiries ?? EMPTY_OBSERVATION_EXPIRIES;
  const frames = replay?.rawFrames ?? replay?.frames ?? EMPTY_OBSERVATION_FRAMES;
  const date = data.view.date ?? qqqEasternDateKey(data.asOf);
  const input = useMemo(() => ({ expiries, frames, date }), [expiries, frames, date]);
  const [prepared, setPrepared] = useState<{ input: typeof input; tracks: QqqMaxPainTrack[] } | null>(null);
  const [failure, setFailure] = useState<typeof input | null>(null);
  const ready = prepared?.input === input;
  useEffect(() => {
    if (!visible || ready) return;
    const controller = new AbortController();
    void prepareQqqMaxPain(input.expiries, input.frames, input.date, controller.signal).then(tracks => {
      if (!controller.signal.aborted) { setPrepared({ input, tracks }); setFailure(null); }
    }).catch(() => { if (!controller.signal.aborted) setFailure(input); });
    return () => controller.abort();
  }, [input, visible, ready]);
  const tracks = useMemo(() => qqqMaxPainAt(prepared?.input === input ? prepared.tracks : [], cutoff), [prepared, input, cutoff]);
  const bars = replay?.bars ?? data.intraday?.bars ?? EMPTY_OBSERVATION_BARS;
  const spotAt = useMemo(() => qqqObservationSpotIndex(bars, date), [bars, date]);
  const spot = Number.isFinite(cutoff) ? spotAt(cutoff) : null;
  const expiry = selectedExpiry ?? replay?.selectedExpiry ?? data.intraday?.gexExpiries?.[0]?.expiryDate;
  const selected = tracks.find(track => track.expiry === expiry);
  const points = tracks.map(track => ({ x: Date.parse(track.expiry), value: track.latest?.level ?? null, label: track.expiry.slice(5) }));
  if (prepared?.input !== input) return <QqqObservationEmpty>{failure === input ? 'Max Pain 整理失败，请重新选择日期或到期日。' : '正在整理 Max Pain 曲线…'}</QqqObservationEmpty>;
  return <div>
    <section className={styles.card} aria-label="Max Pain 到期日曲线">
      <QqqObservationHeading title="Max Pain / Time · QQQ" meta={`${replay && !replay.followingLatest ? '回放' : '所选日期'} · ${input.date}`} info="横轴是到期日。按各行权价 Call / Put 持仓量计算，使到期总内在价值最小的行权价；并列取最低行权价。仅使用已加载期权链，各到期日快照可能不同步。OI 通常为日级数据，Max Pain 不是价格预测。" />
      <div className={styles.footer}><span style={{ color: '#38bdf8' }}>● Max Pain</span><span>虚线 · QQQ {money(spot)}</span></div>
      <QqqMaxPainPlot points={points} spot={spot} />
      <table className={styles.observationTable}>
        <thead><tr><th>到期日</th><th>Max Pain</th><th>快照 ET</th></tr></thead>
        <tbody>{tracks.map(track => <tr key={track.expiry}>
          <td><button type="button" aria-pressed={track.expiry === expiry} onClick={() => onSelectExpiry(track.expiry)}>{track.expiry.slice(5)}</button></td>
          <td title={track.latest?.reason ?? undefined}>{money(track.latest?.level)}</td>
          <td>{track.latest ? timeLabel(track.latest.time) : '—'}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <section className={styles.card} aria-label="Max Pain 历史变化">
      <QqqObservationHeading title="Max Pain 历史变化" meta={expiry ?? '未选择到期日'} value={money(selected?.latest?.level)} />
      {selected?.latest?.reason && <QqqObservationEmpty>{selected.latest.reason}</QqqObservationEmpty>}
      <QqqMaxPainPlot history points={selected?.history.map(point => ({ x: point.time, value: point.level, label: timeLabel(point.time) })) ?? []} spot={spot} />
      <p className={styles.meta}>仅显示所选交易日已加载的快照；跟随统一回放，缺失处留空。虚线为游标时点 QQQ 参考价。</p>
    </section>
  </div>;
}
