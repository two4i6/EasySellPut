'use client';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { useQqqIntradayContext } from '@/hooks/useQqqIntradayContext';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { prepareWallTouchEvents, summarizeWallTouches, type WallTouchEvent } from '@/lib/qqqWallTouchStats';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
import { QqqObservationEmpty, QqqObservationHeading } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';
const pct = (value: number | null) => value === null ? '样本不足' : `${(value * 100).toFixed(1)}%`;
const points = (value: number | null) => value === null ? '—' : value.toFixed(2);
const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function WallOutcomeHistogram({ events }: { events: readonly WallTouchEvent[] }) {
  if (!events.length) return <QqqObservationEmpty>筛选范围内暂无完整观察样本。</QqqObservationEmpty>;
  const values = events.map(event => event.endingMove), low = Math.min(0, ...values), high = Math.max(0, ...values), span = Math.max(.01, high - low), bins = Array.from({ length: 10 }, () => 0);
  for (const value of values) bins[Math.min(9, Math.floor((value - low) / span * 10))]++;
  const max = Math.max(1, ...bins);
  return <svg viewBox="0 0 340 120" width="100%" role="img" aria-label="触位后窗末价格相对墙位的有利方向位移分布">
    {bins.map((count, index) => <rect key={index} x={25 + index * 29} y={92 - count / max * 75} width="24" height={count / max * 75} fill={low + (index + .5) / 10 * span >= 0 ? '#2dd4bf' : '#fb7185'}><title>{`${(low + index / 10 * span).toFixed(2)} 至 ${(low + (index + 1) / 10 * span).toFixed(2)} 点：${count} 次`}</title></rect>)}
    <line x1={25 + (0 - low) / span * 290} x2={25 + (0 - low) / span * 290} y1="12" y2="94" stroke="var(--text-secondary)" strokeDasharray="3 3" />
    <text x="25" y="112" fill="var(--text-tertiary)" fontSize="10">{low.toFixed(2)} 点</text><text x="315" y="112" textAnchor="end" fill="var(--text-tertiary)" fontSize="10">{(low + span).toFixed(2)} 点</text>
  </svg>;
}

export default function QqqWallTouchStatsCard({ data, replay, selectedExpiry }: { data: QqqPcsApiResponse; replay: QqqExposureReplayContext | null; selectedExpiry: string | null }) {
  const visible = useQqqTerminalTabVisible(), date = data.view.date ?? qqqEasternDateKey(data.asOf);
  const expiry = selectedExpiry ?? replay?.selectedExpiry ?? data.intraday?.gexExpiries?.[0]?.expiryDate;
  const dte = expiry ? Math.round((Date.parse(expiry) - Date.parse(date)) / 86400_000) : 0;
  const context = useQqqIntradayContext(date, dte, visible);
  const input = context.data;
  const [prepared, setPrepared] = useState<{ input: typeof input; events: WallTouchEvent[] } | null>(null), [failed, setFailed] = useState<typeof input | null>(null);
  const ready = prepared?.input === input && input !== null;
  useEffect(() => {
    if (!visible || !input || ready) return;
    const controller = new AbortController();
    void prepareWallTouchEvents(input.days, input.date, controller.signal).then(events => { if (!controller.signal.aborted) { setPrepared({ input, events }); setFailed(null); } }).catch(() => { if (!controller.signal.aborted) setFailed(input); });
    return () => controller.abort();
  }, [visible, input, ready]);
  const [gamma, setGamma] = useState('all'), [period, setPeriod] = useState('all'), [side, setSide] = useState('all'), [horizon, setHorizon] = useState(30);
  const statsKnown = ready && input?.referenceComplete !== false && !context.error;
  const events = useMemo(() => statsKnown ? prepared!.events.filter(event => event.dte === dte && event.horizon === horizon && (gamma === 'all' || event.gamma === gamma) && (period === 'all' || event.period === period) && (side === 'all' || event.side === side)) : [], [statsKnown, prepared, dte, horizon, gamma, period, side]);
  const stats = useMemo(() => summarizeWallTouches(events), [events]);
  return <div>
    <QqqObservationHeading title="历史首次可验证触位结果" meta={`截至 ${date} 之前 · 同 ${dte} DTE · 最多前 20 个交易日`} info="每个交易日／到期日／方向只保留记录内首次可验证触墙，不保证缺失记录期间没有更早触及。墙位须在触及 K 线开盘前已知，且不超过 5 分钟。时段按触及 K 线开盘归类，事件时间显示收盘确认时刻。触及当根不计入有利或不利波动，必须有随后连续完整的 10／30 分钟价格。回到内侧指窗末收盘回到 Put 墙上方／Call 墙下方；确认突破指连续两根收盘在外侧。只使用完整输入的已保存结构代理，不代表真实做市商仓位。" />
    <div className={styles.studyControls}>
      <label>观察窗口<select aria-label="触位观察窗口" value={horizon} onChange={event => setHorizon(Number(event.target.value))}><option value="10">10 分钟</option><option value="30">30 分钟</option></select></label>
      <label>Gamma 状态<select aria-label="触位 Gamma 状态" value={gamma} onChange={event => setGamma(event.target.value)}><option value="all">全部</option><option value="positive">正 Gamma</option><option value="negative">负 Gamma</option><option value="zero">零 Gamma</option></select></label>
      <label>首次触位时段<select aria-label="触位时段" value={period} onChange={event => setPeriod(event.target.value)}><option value="all">全部</option><option value="open">开盘首小时</option><option value="middle">10:30–15:00 ET</option><option value="late">15:00 ET 后</option></select></label>
      <label>墙位方向<select aria-label="触位方向" value={side} onChange={event => setSide(event.target.value)}><option value="all">全部</option><option value="put">Put 墙</option><option value="call">Call 墙</option></select></label>
    </div>
    {context.loading && <QqqObservationEmpty>正在读取历史价格与结构摘要…</QqqObservationEmpty>}
    {context.error && <p role="status">{context.error} <button type="button" onClick={context.retry}>重试</button></p>}
    {context.data?.issues?.map(issue => <p role="status" key={issue} className={styles.meta}>{issue} <button type="button" onClick={context.retry}>重试</button></p>)}
    {input && !ready && failed !== input && <QqqObservationEmpty>正在整理完整触位路径…</QqqObservationEmpty>}
    {failed && failed === input && <QqqObservationEmpty>触位路径整理失败，请重试读取历史。</QqqObservationEmpty>}
    <section className={styles.card} aria-label="触位样本统计">
      <div className={styles.studyMetrics}><span>完整事件 / 交易日<strong>{statsKnown ? `${stats.count} / ${stats.days}` : '— / —'}</strong></span><span>窗末回到内侧<strong>{statsKnown ? pct(stats.rate) : '统计未就绪'}</strong></span><span>曾确认突破<strong>{statsKnown ? pct(stats.breakRate) : '统计未就绪'}</strong></span><span>回到内侧比例区间<strong>{stats.interval ? `${pct(stats.interval[0])}–${pct(stats.interval[1])}` : '—'}</strong></span></div>
      <p className={styles.meta}>少于 5 次不输出比例；{stats.count < 20 ? '当前样本较少，' : ''}区间为事件级 Wilson 95% 区间，同日事件可能相关，均不是未来胜率。</p>
      {statsKnown ? <WallOutcomeHistogram events={events} /> : <QqqObservationEmpty>历史参考尚未完整读取，暂不输出事件数与比例。</QqqObservationEmpty>}
      <p className={styles.meta}>横轴为窗末相对墙位的点数；正值表示回到内侧方向，纵轴为次数。</p>
      <div className={styles.studyMetrics}><span>最大有利波动中位数<strong>{points(stats.favorableMedian)} 点</strong></span><span>最大不利波动中位数<strong>{points(stats.adverseMedian)} 点</strong></span><span>最大不利波动 P90<strong>{points(stats.adverseP90)} 点</strong></span><span>窗末位移中位数<strong>{points(stats.endingQuantiles[2])} 点</strong></span></div>
    </section>
    <section className={styles.card} aria-label="近期完整触位样本"><QqqObservationHeading title="最近完整样本" />
      <table className={styles.observationTable}><thead><tr><th>日期 ET</th><th>方向 / 墙</th><th>窗末位移</th><th>不利波动</th></tr></thead><tbody>{events.slice(-8).reverse().map(event => <tr key={`${event.date}:${event.expiry}:${event.side}`}><td>{event.date.slice(5)} {formatter.format(event.time)}</td><td>{event.side} {event.wall}</td><td>{event.endingMove.toFixed(2)}</td><td>{event.adverse.toFixed(2)}</td></tr>)}</tbody></table>
      <p className={styles.meta}>历史保留期、缺失报价或不完整路径都会减少有效样本；不使用所选日及之后的数据。</p>
    </section>
  </div>;
}
