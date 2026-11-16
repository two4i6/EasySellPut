'use client';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQqqExposureChartProjection } from '@/hooks/useQqqExposureChartProjection';
import { useStoredPreference } from '@/hooks/useStoredPreference';
import { resolveSelectedGexExpiry, qqqGexSessionDte, qqqGexExpiriesForSession } from '@/lib/qqqGexSelection';
import { matchingExposureReplay, type QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { exposureReplayMatrixExpiries } from '@/lib/qqqExposureChartReplay';
import { exposureSpotIndex } from '@/lib/qqqExposureWorkbench';
import { buildQqqPartialGammaPositionHistory } from '@/lib/qqqGammaPosition';
import { emptyDirectionalChartSignals, type DirectionalChartSignal } from './qqqDirectionalChartMarkers';
import { qqqPcsDefaultExtendedHoursVisible } from './QqqPcsIntradayChart.shared';
import QqqScrollRail from './QqqScrollRail';
import { Maximize2 } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
const QqqGexMatrix = dynamic(() => import('./QqqGexMatrix'));
const QqqExposureWorkbench = dynamic(() => import('./QqqExposureWorkbench'));
const IntradayChart = dynamic(() => import('./QqqPcsIntradayChart'));
const RetainedIntradayChart = memo(IntradayChart, (previous, next) => previous.active === false && next.active === false);

// 独立 GEX 页大图：只留价格/VWAP/GEX（时序线 + 逐 strike wall），去掉 score/confirmation/daily 参考线，
// 更宽的画布让 wall 线宽/透明度差异可辨；不复用小图默认视图，避免拥挤问题重演。
type GexViewMode = 'candles' | 'matrix' | 'heatmap';
const parseGexViewMode = (raw: string | null): GexViewMode => raw === 'matrix' || raw === 'heatmap' ? raw : 'candles';


export function QqqPcsGexChart({ activityResponseTarget, activityHistoryTarget, indicatorObservationTarget, distributionTarget, activityInSidebar=false, onReplayChange, onViewModeChange, onLoadHeatmapHistory, data, standalone = false, selectedExpiry: selectedExpiryProp, onSelectedExpiryChange, onVisibleTimeRangeChange, showGexTable = !standalone, structureObservationTarget, snapshotTableTarget, chartLegendTarget, directionalSignals, renderer = 'lightweight' }: { indicatorObservationTarget?:HTMLElement|null; activityResponseTarget?:HTMLElement|null; activityHistoryTarget?:HTMLElement|null; distributionTarget?:HTMLElement|null; activityInSidebar?:boolean; onReplayChange?:(context:QqqExposureReplayContext|null)=>void; onViewModeChange?:(mode: 'candles' | 'matrix' | 'heatmap')=>void; onLoadHeatmapHistory?:()=>Promise<void>; data: QqqPcsApiResponse | null; standalone?: boolean; selectedExpiry?: string | null; onSelectedExpiryChange?: (expiryDate: string) => void; onVisibleTimeRangeChange?: (range: { from: number; to: number }) => void; showGexTable?: boolean; snapshotTableTarget?: HTMLElement | null; structureObservationTarget?: HTMLElement | null; chartLegendTarget?: HTMLElement | null; directionalSignals?: readonly DirectionalChartSignal[]; renderer?: 'lightweight' | 'kline' }) {
  const [viewMode, setViewMode, viewModeReady] = useStoredPreference<GexViewMode>('qqq-pcs:gex-view-mode:v1', 'candles', parseGexViewMode);
  useEffect(()=>{if(viewModeReady)onViewModeChange?.(viewMode);},[viewModeReady,viewMode,onViewModeChange]);
  const changeViewMode = setViewMode;
  const [matrixControlsTarget,setMatrixControlsTarget]=useState<HTMLDivElement|null>(null);
  const [controlsTarget,setControlsTarget]=useState<HTMLDivElement|null>(null);
  const [replayContext,setReplayContext]=useState<QqqExposureReplayContext|null>(null);
  const receiveReplay=useCallback((context:QqqExposureReplayContext|null)=>{setReplayContext(context);onReplayChange?.(context);},[onReplayChange]);
  const [heatmapSelectionToken,setHeatmapSelectionToken]=useState(0);
  const premarket = data?.intraday?.session === 'PREMARKET';
  const [internalSelectedExpiry, setInternalSelectedExpiry] = useState<string | null>(null);
  const [showExtendedHours, setShowExtendedHours] = useState(() => qqqPcsDefaultExtendedHoursVisible(premarket));
  useEffect(() => {
    setShowExtendedHours(qqqPcsDefaultExtendedHoursVisible(premarket));
  }, [data?.intradaySessionAsOf, premarket]);
  const requestedExpiry=selectedExpiryProp!==undefined?selectedExpiryProp:internalSelectedExpiry;
  const sessionExpiries=useMemo(()=>qqqGexExpiriesForSession(data?.intraday?.gexExpiries??[],data?.view.date),[data?.intraday?.gexExpiries,data?.view.date]);
  const sourceExpiry=requestedExpiry??sessionExpiries[0]?.expiryDate??null;
  const replay=matchingExposureReplay(replayContext,data?.view.date,sourceExpiry);
  const {chartData,loading:projectionLoading,error:projectionError}=useQqqExposureChartProjection(data,replay,viewMode==='candles'?'chart':viewMode==='matrix'?'snapshot':'none');
  const matrixDate=data?.view.date;
  const matrixExpiries=useMemo(()=>viewMode==='matrix'&&replay?exposureReplayMatrixExpiries(data?.intraday?.gexExpiries??[],chartData?.intraday?.gexExpiries??[],matrixDate):data?.intraday?.gexExpiries??[],[data?.intraday?.gexExpiries,chartData?.intraday?.gexExpiries,matrixDate,replay,viewMode]);
  const displayGammaHistory=useMemo(()=>{
    const history=chartData?.intraday?.gammaPositionHistory??[];
    if(viewMode!=='candles'||replay?.scope==='all')return history;
    const expiry=resolveSelectedGexExpiry(chartData?.intraday?.gexExpiries,replay?.scope==='0dte'?replay.date:sourceExpiry);
    if(!expiry)return history;
    const spotAt=exposureSpotIndex(chartData?.intraday?.bars??[]);
    const cutoff=replay?.frame?.time??Date.parse(data?.observedAt??data?.asOf??'');
    const snapshots=expiry.fullGexProfileHistory.filter(p=>p.strikeCoverage!=='top8'&&Date.parse(p.time)<=cutoff).flatMap(p=>{
      const spot=spotAt(Date.parse(p.time));return spot===null?[]:[{time:p.time,spot,strikes:p.strikes}];
    });
    const partial=buildQqqPartialGammaPositionHistory(expiry.expiryDate,snapshots).filter(p=>Date.parse(p.time)<=cutoff);
    const times=new Set(partial.map(p=>p.time));
    return [...history.filter(p=>!times.has(p.time)),...partial].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  },[chartData?.intraday?.gammaPositionHistory,chartData?.intraday?.gexExpiries,chartData?.intraday?.bars,sourceExpiry,replay,viewMode,data?.observedAt,data?.asOf]);
  if (!data?.intraday) return <p style={{ color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', margin: '1rem' }}>当日 2 分钟行情暂不可用，正在自动重试；不会用历史日线替代。</p>;
  const selectedExpiry = selectedExpiryProp !== undefined ? selectedExpiryProp : internalSelectedExpiry;
  const expiries = sessionExpiries;
  const activeExpiry = resolveSelectedGexExpiry(expiries, selectedExpiry) ?? null;
  const projectedExpiry=resolveSelectedGexExpiry(chartData?.intraday?.gexExpiries,replay?.scope==='0dte'?replay.date:selectedExpiry);
  const selectedDisplay = replay?.scope==='all'?chartData?.intraday:projectedExpiry ?? (selectedExpiry === null ? chartData?.intraday : null);
  const selectedDate = selectedExpiry ?? activeExpiry?.expiryDate ?? null;
  const storedModel = chartData?.intraday?.gammaModels?.selected;
  const selectedModel = storedModel && (!selectedDate || storedModel.expiries.length === 1 && storedModel.expiries[0] === selectedDate) ? storedModel : null;
  const hasExtendedHours = Boolean(data.intraday.extendedHoursBars && data.intraday.extendedHoursBars.length > data.intraday.bars.length);
  return <div style={standalone ? { display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0, width: '100%' } : undefined}>
    {!standalone && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}><a aria-label="在独立页面查看 GEX 图表" href="/analysis/qqq/gex" style={{ alignItems: 'center', border: '1px solid rgba(129,140,248,.35)', borderRadius: 5, color: '#c7d2fe', display: 'inline-flex', padding: 4 }} title="独立页面查看" ><Maximize2 size={13} /></a></div>}
    {(expiries.length > 0 || hasExtendedHours) && <div className={standalone ? 'qqq-gex-view-toolbar' : undefined} style={{ alignItems: 'center', display: 'flex', flex: '0 0 auto', gap: 8, justifyContent: 'space-between', marginBottom: 4, minWidth: 0 }}>
      {standalone && viewMode==='matrix' && <div ref={setMatrixControlsTarget} style={{minWidth:0,overflowX:'auto'}} />}
      {viewMode!=='matrix'&&replay?.scope!=='all'&&<QqqScrollRail label="GEX 到期日">
        {!standalone && premarket && data.intradaySessionAsOf && <span style={{ border: '1px solid rgba(52,211,153,.3)', borderRadius: 5, color: '#6ee7b7', fontFamily: 'var(--font-mono)', fontSize: '0.58rem', padding: '3px 6px' }}>{data.intradaySessionAsOf.slice(5)} · 当日盘前</span>}
        {expiries.map((expiry) => <button key={expiry.expiryDate} onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })} onClick={() => {setHeatmapSelectionToken(value=>value+1);if(onSelectedExpiryChange)onSelectedExpiryChange(expiry.expiryDate);else setInternalSelectedExpiry(expiry.expiryDate);}} style={{ background: activeExpiry?.expiryDate === expiry.expiryDate ? 'rgba(129,140,248,.2)' : 'transparent', border: '1px solid rgba(129,140,248,.35)', borderRadius: 5, color: '#c7d2fe', cursor: 'pointer', flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontSize: '0.58rem', padding: '3px 6px' }} type="button">{qqqGexSessionDte(expiry.expiryDate,data.view.date,expiry.dte)}D · {expiry.expiryDate.slice(5)}</button>)}
      </QqqScrollRail>}
      {standalone && <div role="group" aria-label="图表模式" style={{ display: 'flex', flex: '0 0 auto', gap: 3, marginLeft: 'auto', order: 2 }}>{(['candles', 'matrix', 'heatmap'] as const).map(mode => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => changeViewMode(mode)} style={{ background: viewMode === mode ? 'var(--bg-secondary)' : 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 4, color: viewMode === mode ? 'var(--accent-primary)' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '.6rem', padding: '4px 7px', cursor: 'pointer' }}>{mode === 'candles' ? 'K线' : mode==='matrix'?'GEX矩阵':'Heatmap'}</button>)}</div>}
      {hasExtendedHours && viewMode!=='matrix' && <button onClick={() => setShowExtendedHours((value) => !value)} style={{ background: showExtendedHours ? 'rgba(56,189,248,.12)' : 'transparent', border: '1px solid rgba(56,189,248,.35)', borderRadius: 4, color: '#bae6fd', cursor: 'pointer', flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontSize: '0.58rem', padding: '3px 6px' }} type="button">EXT {showExtendedHours ? 'ON' : 'OFF'} · {premarket ? (showExtendedHours ? '昨日+当日' : '当日') : '盘前/盘后'}</button>}
    </div>}
    <div style={{ position: 'relative', display: 'flex', flex: standalone ? 1 : undefined, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
    <div aria-hidden={standalone && viewMode !== 'candles' ? true : undefined} inert={standalone && viewMode !== 'candles' ? true : undefined} style={standalone && viewMode !== 'candles' ? { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none', display: 'flex', flexDirection: 'column' } : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <RetainedIntradayChart
      active={!standalone || viewMode === 'candles'}
      bars={chartData!.intraday!.bars}
      extendedHoursBars={chartData!.intraday!.extendedHoursBars}
      extendedHoursVisible={showExtendedHours}
      onExtendedHoursVisibleChange={setShowExtendedHours}
      onVisibleTimeRangeChange={replay&&!replay.followingLatest?undefined:onVisibleTimeRangeChange}
      scores={chartData!.intraday!.scoreSeries}
      gex={selectedDisplay?.gex}
      gexProfile={selectedDisplay?.gexProfile}
      gexProfileHistory={selectedDisplay?.gexProfileHistory}
      gexObservationHistory={selectedDisplay && 'fullGexProfileHistory' in selectedDisplay ? selectedDisplay.fullGexProfileHistory : undefined}
      gexSummary={selectedDisplay?.gexSummary ?? null}
      wallHistory={selectedDisplay?.wallHistory}
      gexInsights={selectedDisplay ? chartData?.intraday?.gexInsights ?? null : null}
      gammaModel={selectedModel}
      gammaExpiryDate={(replay?.scope==='0dte'?replay.date:selectedDate) ?? undefined}
      gammaPositionHistory={displayGammaHistory}
      snapshotAsOf={projectedExpiry?.asOf ?? chartData?.intraday?.gexAsOf ?? data.asOf}
      gexDte={projectedExpiry?.dte??activeExpiry?.dte??0}
      granularity={data.intraday.granularity}
      historical={data.view.mode === 'historical'||Boolean(replay&&!replay.followingLatest)}
      premarket={premarket}
      showGex
      // GEX 独立页的 KLineCharts renderer 需要保留 RSI / 执行分副图，
      // 与 Lightweight parity，也让到期日切换时四个 pane 一起刷新。
      showAuxSeries={true}
      showGexTable={showGexTable}
      structureObservationTarget={structureObservationTarget}
      snapshotTableTarget={standalone?null:snapshotTableTarget}
      chartLegendTarget={!standalone || viewMode === 'candles' ? chartLegendTarget : null}
      directionalSignals={replay&&!replay.followingLatest?emptyDirectionalChartSignals:directionalSignals ?? data.intraday.directional?.signals ?? emptyDirectionalChartSignals}
      fillHeight={standalone}
      height={standalone ? 520 : 520}
      renderer={renderer}
    />
    </div>
    {standalone && viewMode === 'matrix' && <QqqGexMatrix controlsTarget={matrixControlsTarget} activityInSidebar={activityInSidebar} settingsTarget={chartLegendTarget ?? null} tradingDate={data.view.date ?? data.asOf.slice(0, 10)} historical={data.view.mode === 'historical'||Boolean(replay&&!replay.followingLatest)} expiries={matrixExpiries} frame={replay?.scope==='all'?replay.frame:null} bars={replay?.bars??[]} spot={chartData!.intraday!.bars.at(-1)?.close ?? null} />}
    {standalone&&<QqqExposureWorkbench activityResponseTarget={activityResponseTarget} activityHistoryTarget={activityHistoryTarget} indicatorObservationTarget={indicatorObservationTarget} distributionTarget={distributionTarget} allExpiries={viewMode==='matrix'} projectionLoading={projectionLoading} projectionError={projectionError} controlsTarget={controlsTarget} onReplayChange={receiveReplay} snapshotTableTarget={snapshotTableTarget} active={viewMode==='heatmap'} selectionToken={heatmapSelectionToken} onLoadHistory={onLoadHeatmapHistory} data={data} selectedExpiry={selectedDate} settingsTarget={chartLegendTarget??null} />}
    </div>
    {standalone&&<div ref={setControlsTarget} style={{flex:"0 0 auto",minWidth:0}}/>}
    {!standalone && activeExpiry?.fullGexProfile.length ? <Accordion style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, marginTop: 8, padding: '0.55rem 0.65rem' }}>
      <summary style={{ color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>全量 Strike GEX · {activeExpiry.fullGexProfile.length} 档（Call / Put / Net）</summary>
      <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', width: '100%' }}>
          <thead style={{ color: 'var(--text-tertiary)', position: 'sticky', top: 0, background: 'var(--card-bg, #0b1020)' }}><tr><th align="left">Strike</th><th align="right">Call GEX</th><th align="right">Put GEX (−)</th><th align="right">Net GEX</th></tr></thead>
          <tbody>{activeExpiry.fullGexProfile.map((point) => <tr key={point.strike} style={{ borderTop: '1px solid var(--border-subtle)', color: point.isCallWall || point.isPutWall ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            <td>{point.strike.toFixed(2)}{point.isCallWall ? ' · Call Wall' : point.isPutWall ? ' · Put Wall' : ''}</td><td align="right">${(point.callGex / 1e6).toFixed(1)}M</td><td align="right">−${(point.putGex / 1e6).toFixed(1)}M</td><td align="right">{point.totalGex < 0 ? '−' : ''}${(Math.abs(point.totalGex) / 1e6).toFixed(1)}M</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Accordion> : null}
  </div>;
}
