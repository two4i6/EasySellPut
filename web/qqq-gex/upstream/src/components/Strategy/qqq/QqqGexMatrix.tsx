'use client';
import { exposureStrikeMetric, type ExposureFrame, type ExposureBar } from '@/lib/qqqExposureWorkbench';
import { exposureReplayTableRows } from '@/lib/qqqExposureReplay';
import { QqqOptionActivityObservation } from './terminal/QqqOptionActivityObservation';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualTableViewport } from '@/hooks/useVirtualTableViewport';
import { useStoredPreference } from '@/hooks/useStoredPreference';
import { matrixRowWindow } from './qqqExposureRenderModel';
import type { PcsGexExpiry } from '@/types/qqqGex';
import { buildQqqGexMatrixIndex, formatQqqMatrixGex, nearestQqqMatrixStrike, qqqMatrixNearbyStrikes, qqqMatrixBarPercent, qqqMatrixOptionOverview, qqqMatrixPointValue } from './qqqGexMatrixModel';
import styles from './QqqGexMatrix.module.css';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const snapshotTime = (asOf: string) => Number.isFinite(Date.parse(asOf)) ? `${timeFormat.format(new Date(asOf))} ET` : '时间未知';
const MatrixCell = memo(function MatrixCell({ point, maximum, selected, asOf, stale }: { point?: PcsGexExpiry['fullGexProfile'][number]; maximum: number; selected: boolean; asOf: string; stale: boolean }) {
  const value = qqqMatrixPointValue(point);
  const valid = value !== null;
  return <td data-stale={stale} data-selected={selected} title={point ? `Call ${formatQqqMatrixGex(qqqMatrixPointValue(point,'callGex'))} / Put ${formatQqqMatrixGex(qqqMatrixPointValue(point,'putGex'))} / 净 ${formatQqqMatrixGex(value)} · ${asOf}` : '该到期日此行权价无数据'}>
    {valid && <span className={`${styles.bar} ${value >= 0 ? styles.positive : styles.negative}`} style={{ width: `${qqqMatrixBarPercent(value, maximum)}%` }} />}
    <span className={styles.value} data-sign={valid ? value >= 0 ? 'positive' : 'negative' : 'missing'}>{formatQqqMatrixGex(value)}</span>
  </td>;
});

type MatrixPreferences = { range: 'nearby' | 'all'; scale: 'shared' | 'column'; overviewVisible: boolean; summaryVisible: boolean; distributionVisible: boolean };
const matrixDefaults: MatrixPreferences = { range: 'nearby', scale: 'shared', overviewVisible: false, summaryVisible: true, distributionVisible: true };
const parseMatrixPreferences = (raw: string | null): MatrixPreferences => {
  const saved = JSON.parse(raw ?? '{}');
  return { range: saved?.range === 'all' ? 'all' : 'nearby', scale: saved?.scale === 'column' ? 'column' : 'shared',
    overviewVisible: typeof saved?.overviewVisible === 'boolean' ? saved.overviewVisible : false,
    summaryVisible: typeof saved?.summaryVisible === 'boolean' ? saved.summaryVisible : true,
    distributionVisible: typeof saved?.distributionVisible === 'boolean' ? saved.distributionVisible : true };
};

function QqqGexMatrix({ activityInSidebar=false, expiries, frame, bars, spot, tradingDate, historical = false, settingsTarget = null, controlsTarget = null }: { activityInSidebar?:boolean; expiries: readonly PcsGexExpiry[]; frame: ExposureFrame | null; bars: readonly ExposureBar[]; spot: number | null; tradingDate: string; historical?: boolean; settingsTarget?: HTMLElement | null; controlsTarget?: HTMLElement | null }) {
  const model = useMemo(() => buildQqqGexMatrixIndex([...expiries].sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate))), [expiries]);
  const nearestStrike = useMemo(() => nearestQqqMatrixStrike(model.strikes, spot), [model.strikes, spot]);
  const distribution = useMemo(() => frame && !frame.missing.length ? exposureStrikeMetric(frame, 'gex') : new Map<number, number | null>(), [frame]);
  const summary = useMemo(() => frame && !frame.missing.length && frame.profiles.length===model.columns.length ? exposureReplayTableRows([frame], bars)[0] ?? null : null, [frame, bars, model.columns.length]);
  const net=summary?.displayNet??null;
  const distributionMaximum = useMemo(() => Math.max(0, ...[...distribution.values()].map(value => Math.abs(value ?? 0))), [distribution]);
  const [{ range, scale, overviewVisible, summaryVisible, distributionVisible }, setPreferences, preferencesReady] = useStoredPreference('qqq-pcs:gex-matrix-preferences:v1', matrixDefaults, parseMatrixPreferences);
  const needsOverview = !activityInSidebar && (overviewVisible || summaryVisible);
  const overviewProfile = useMemo(() => needsOverview ? frame?.profiles.filter(profile=>(profile.time??frame.time)<=frame.time).flatMap(profile => profile.strikes) ?? [] : [], [frame, needsOverview]);
  const overview = useMemo(() => qqqMatrixOptionOverview(overviewProfile), [overviewProfile]);
  const aggregateExpiry = useMemo(() => expiries[0] && frame ? { ...expiries[0], asOf: new Date(frame.time).toISOString(), fullGexProfile: overviewProfile } : null, [expiries, frame, overviewProfile]);
  const setRange = (range: MatrixPreferences['range']) => setPreferences(previous => ({ ...previous, range }));
  const setScale = (scale: MatrixPreferences['scale']) => setPreferences(previous => ({ ...previous, scale }));
  const [anchor, setAnchor] = useState<number | null>(nearestStrike);
  const [now, setNow] = useState(() => Date.now());
  const [centerRequest, setCenterRequest] = useState(0);
  const setOverviewVisible = (update: boolean | ((previous: boolean) => boolean)) => setPreferences(previous => ({ ...previous, overviewVisible: typeof update === 'function' ? update(previous.overviewVisible) : update }));
  const setSummaryVisible = (update: boolean | ((previous: boolean) => boolean)) => setPreferences(previous => ({ ...previous, summaryVisible: typeof update === 'function' ? update(previous.summaryVisible) : update }));
  const setDistributionVisible = (update: boolean | ((previous: boolean) => boolean)) => setPreferences(previous => ({ ...previous, distributionVisible: typeof update === 'function' ? update(previous.distributionVisible) : update }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useVirtualTableViewport(scrollRef, { initialHeight: 600, revision: model.strikes.length > 0 });

  useEffect(() => { if (historical) return; const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [historical]);
  // Price updates must not move the user's viewport. Re-anchor only for a new day or explicit request.
  const dayRef = useRef(tradingDate);
  useEffect(() => { if (dayRef.current !== tradingDate || anchor === null && nearestStrike !== null) { dayRef.current = tradingDate; setAnchor(nearestStrike); setCenterRequest(value => value + 1); } }, [tradingDate, anchor, nearestStrike]);
  const visibleStrikes = useMemo(() => range === 'all' ? model.strikes : qqqMatrixNearbyStrikes(model.strikes, anchor), [range, model.strikes, anchor]);
  const centeredRequest = useRef('');
  useEffect(() => {
    const requestKey = `${centerRequest}:${range}:${preferencesReady}`;
    if (centeredRequest.current === requestKey) return;
    centeredRequest.current = requestKey;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = Math.max(0, visibleStrikes.indexOf(anchor ?? nearestStrike ?? 0) * 32 + 48 - scroller.clientHeight / 2);
  }, [centerRequest, range, preferencesReady, visibleStrikes, anchor, nearestStrike]);
  const windowRows = matrixRowWindow(visibleStrikes.length, viewport.top, viewport.height);
  const renderedStrikes = visibleStrikes.slice(windowRows.start, windowRows.end);
  const returnToSpot = () => { setAnchor(nearestStrike); setCenterRequest(value => value + 1); };
  const matrixControls = <div className={styles.controls} style={controlsTarget ? { marginLeft: 0, flexWrap: 'nowrap' } : undefined}>
        <select aria-label="矩阵行权价范围" value={range} onChange={event => setRange(event.target.value as 'nearby' | 'all')}><option value="nearby">现价附近 41 档</option><option value="all">全部行权价</option></select>
        <select aria-label="GEX 条宽比例" value={scale} onChange={event => setScale(event.target.value as 'shared' | 'column')}><option value="shared">跨到期日比较</option><option value="column">各列强弱</option></select>
        <button type="button" onClick={returnToSpot} disabled={nearestStrike === null}>回到现价</button>
      </div>;
  if (!model.strikes.length) return <div className={styles.empty}>当前快照没有全量行权价数据，暂无法展示矩阵。</div>;
  return <section className={styles.panel} aria-label="GEX 行权价矩阵">
    {settingsTarget && createPortal(<section className={styles.settings} aria-label="GEX 矩阵显示"><strong>GEX 矩阵</strong>{!activityInSidebar&&<label><input type="checkbox" checked={summaryVisible} onChange={e=>setSummaryVisible(e.target.checked)}/>市场摘要</label>}{!activityInSidebar&&<label><input type="checkbox" checked={overviewVisible} onChange={e=>setOverviewVisible(e.target.checked)}/>期权成交与持仓概览</label>}<label><input type="checkbox" checked={distributionVisible} onChange={e=>setDistributionVisible(e.target.checked)}/>全部到期日 GEX 分布</label></section>, settingsTarget)}
    {controlsTarget ? createPortal(matrixControls, controlsTarget) : <div className={styles.summary}>{matrixControls}</div>}
    {summaryVisible&&!activityInSidebar&&<div className={styles.metrics} aria-label="全部到期日市场摘要">
      <div><small>现价 SPOT</small><strong>{spot?.toFixed(2) ?? '—'}</strong></div>
      <div><small>Call GEX 绝对量{overview.call.gexCoverage<overview.strikes?'（部分）':''}</small><strong className={styles.blueText}>{formatQqqMatrixGex(overview.call.absoluteGex)}</strong></div>
      <div><small>Put GEX 绝对量{overview.put.gexCoverage<overview.strikes?'（部分）':''}</small><strong className={styles.orangeText}>{formatQqqMatrixGex(overview.put.absoluteGex)}</strong></div>
      <div><small>Gamma 状态{summary?.partial?'（部分）':''}</small><strong>{net===null?'—':net>0?'正 Gamma':net<0?'负 Gamma':'中性'}</strong></div>
      <div><small>快照覆盖</small><strong>{frame?.profiles.length??0} / {model.columns.length} 个到期日</strong></div>
    </div>}
    <div className={styles.matrixBody}>
      {overviewVisible&&!activityInSidebar&&<aside className={styles.flow}><QqqOptionActivityObservation hideTitle expiry={aggregateExpiry} scopeLabel="全部到期日 · 已有快照"/></aside>}
      <div className={styles.matrixMain}>
    <div className={styles.legend}><i className={styles.positive} />正向 <i className={styles.negative} />负向 <span>{scale === 'shared' ? '所有列统一比例，可比较金额' : '每列独立比例，条宽仅表示该列内强弱'}</span><span className={styles.count}>{visibleStrikes.length} / {model.strikes.length} 档{historical ? ' · 历史快照' : ''}</span></div>
    <div ref={scrollRef} className={styles.scroll} tabIndex={0} aria-label="左右及上下滚动查看 GEX 矩阵">
      <table aria-rowcount={visibleStrikes.length+1} className={styles.table} style={{ minWidth: 96 + (distributionVisible ? 250 : 0) + model.columns.length * 112 }}>
        <thead><tr><th className={styles.strike}>行权价</th>{model.columns.map(({ expiry }) => {
          const age = Math.max(0, (now - Date.parse(expiry.asOf)) / 60_000);
          const stale = !historical && Number.isFinite(age) && age > 5;
          return <th key={expiry.expiryDate} data-stale={stale} title={`快照时间：${expiry.asOf}`}>{expiry.dte}D · {expiry.expiryDate.slice(5)}<small>{!expiry.fullGexProfile.length ? '无逐档数据' : `${snapshotTime(expiry.asOf)}${stale ? ` · ${Math.floor(age)}分钟前` : ''}`}</small></th>;
        })}{distributionVisible&&<th className={styles.structure} title="仅合并同口径、同单位且覆盖完整的到期日；缺失或不兼容时不汇总">全部到期日 · GEX 分布<small>与统一回放时刻同步</small></th>}</tr></thead>
        <tbody>{windowRows.before>0&&<tr aria-hidden="true" className={styles.spacer}><td colSpan={model.columns.length+1+(distributionVisible?1:0)} style={{height:windowRows.before}}/></tr>}{renderedStrikes.map((strike, rowIndex) => {
          const current = distribution.get(strike);
          const near = strike === nearestStrike;

          return <tr key={strike} aria-rowindex={windowRows.start+rowIndex+2} data-near={near}>
            <th className={styles.strike}>{strike.toFixed(2)}{near && <small>现价附近</small>}</th>
            {model.columns.map(({ expiry, strikes, maximum }) => <MatrixCell key={expiry.expiryDate} point={strikes.get(strike)} maximum={scale === 'shared' ? model.maximum : maximum} selected={false} asOf={expiry.asOf} stale={!historical && now - Date.parse(expiry.asOf) > 5 * 60_000} />)}
            {distributionVisible&&<td className={styles.structure}><div className={styles.distribution}><span className={styles.distributionStrike}>{strike.toFixed(2)}</span><span className={styles.distributionTrack}>{current!=null && Number.isFinite(current) && <i style={{ width: `${qqqMatrixBarPercent(current, distributionMaximum)}%`, background: current >= 0 ? '#60a5fa' : '#fb923c' }} />}</span><span className={current!=null && current<0 ? styles.orangeText : styles.blueText}>{formatQqqMatrixGex(current)}</span></div></td>}
          </tr>;
        })}{windowRows.after>0&&<tr aria-hidden="true" className={styles.spacer}><td colSpan={model.columns.length+1+(distributionVisible?1:0)} style={{height:windowRows.after}}/></tr>}</tbody>
      </table>
    </div>
      </div>
    </div>
    <div className={styles.footer}>各列标注实际快照时间；固定展示全部到期日，并与统一回放同步。未纳入或缺失列保持空白。悬停查看 Call / Put 明细；缺失为 —，零值为 $0。</div>
  </section>;
}

export default memo(QqqGexMatrix);
