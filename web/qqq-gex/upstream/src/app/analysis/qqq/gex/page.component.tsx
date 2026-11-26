'use client';
import { qqqGexInputQuality } from '@/lib/qqqGexInputQuality';
import type { QqqPcsApiResponse } from '@/types/qqqGex';

import { aggregateQqqOptionActivity } from '@/lib/qqqOptionActivityScope';
import { resolveSelectedGexExpiry } from '@/lib/qqqGexSelection';
import { useQqqGexDisplayData } from '@/hooks/useQqqGexDisplayData';
import { memo, useEffect, useMemo, useState } from 'react';
import { QqqPcsGexChart } from '@/components/Strategy/qqq/QqqPcsGexChart';
import QqqNextActionCard from '@/components/Strategy/qqq/QqqNextActionCard';
import { QqqTerminalWorkspace, QqqTerminalPanel } from '@/components/Strategy/qqq/QqqTerminalWorkspace';
import QqqGexDateRail from '@/components/Strategy/qqq/QqqGexDateRail';
import { QqqGexTerminal, type QqqGexTerminalViewModel } from '@/components/Strategy/qqq/terminal/QqqGexTerminal';
import { QqqDirectionalSignalConsole } from '@/components/Strategy/qqq/terminal/QqqDirectionalSignalConsole';
import QqqAtmIvCard from '@/components/Strategy/qqq/terminal/QqqAtmIvCard';
import QqqMaxPainCard from '@/components/Strategy/qqq/terminal/QqqMaxPainCard';
import QqqIntradayPulseCard from '@/components/Strategy/qqq/terminal/QqqIntradayPulseCard';
import QqqSpreadStudyCard from '@/components/Strategy/qqq/terminal/QqqSpreadStudyCard';
import QqqWallTouchStatsCard from '@/components/Strategy/qqq/terminal/QqqWallTouchStatsCard';
import QqqGammaObservation from '@/components/Strategy/qqq/terminal/QqqGammaObservation';
export { buildDisplayGammaModels } from '@/lib/qqqDisplayGammaModels';
import { matchingExposureReplay, exposureReplayDisplayPayload, type QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import QqqGexRequestFeedback from '@/components/Strategy/qqq/QqqGexRequestFeedback';
import QqqGexLoadingSkeleton from '@/components/Strategy/qqq/QqqGexLoadingSkeleton';

const MemoGexChart = memo(QqqPcsGexChart);

export { mergeGexProfileHistory, mergeGammaPositionHistory, mergeGexReminderHistory, missingGexProfileWindow, canReuseClosedGexExpiry, buildHistoricalGexExpiries, historicalGexDisplayPayload, mergeGexWindows, qqqGexRefreshInterval, qqqGexDateBounds } from '@/lib/qqqGexDisplayState';

const money = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`;
const pct = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '积累中' : `${(value * 100).toFixed(1)}%`;
const millions = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value / 1e6).toFixed(1)}M`;
const factorValue = (factor: { value: number | null; confidence: number; source: { type: string } } | undefined) => factor && factor.confidence > 0 && factor.source.type !== 'fallback' ? factor.value : null;

export function buildTerminalView(data: QqqPcsApiResponse, selectedExpiry: string | null): QqqGexTerminalViewModel {
  const expiry = resolveSelectedGexExpiry(data.intraday?.gexExpiries, selectedExpiry);
  const terminal = expiry?.terminal ?? (!selectedExpiry || data.intraday?.gexExpiries?.[0]?.expiryDate===selectedExpiry ? data.intraday?.terminal : null);
  const candidate = data.candidate;
  const rawEligibility = candidate.status === 'READY' && data.daily.eligibility.value === 'OPEN' && data.timing.value === 'NOW';
  const eligibilityStatus = terminal?.decision.sellerAction === 'BLOCKED' || terminal?.decision.sellerAction === 'WAIT'
    ? 'BLOCKED' as const
    : rawEligibility && terminal?.decision.sellerAction === 'ELIGIBLE'
      ? 'ELIGIBLE' as const
      : candidate.status === 'READY' ? 'CONDITIONAL' as const : 'UNAVAILABLE' as const;
  const blockingReasons = [
    ...(candidate.status !== 'READY' ? [candidate.reason] : []),
    ...(data.daily.eligibility.value !== 'OPEN' ? data.daily.reasons : []),
    ...(data.timing.value !== 'NOW' ? [`盘中时机：${data.timing.value}`] : []),
    ...(terminal?.decision.sellerAction === 'WAIT' ? ['当前 Gamma / 波动率结构不支持卖方入场。'] : []),
  ];
  const wall = (kind: 'CALL' | 'PUT') => {
    const quality = kind === 'CALL' ? terminal?.callWallQuality : terminal?.putWallQuality;
    const summary = kind === 'CALL' ? expiry?.gexSummary?.callWall : expiry?.gexSummary?.putWall;
    const qualityScore = factorValue(quality?.score);
    return { kind, strike: summary ? summary.strike.toFixed(2) : '—', quality: qualityScore === null ? '积累中' : `${qualityScore.toFixed(1)}/10`, confidence: factorValue(quality?.confidence) === null ? 'Confidence LOW' : `Confidence ${Math.round(factorValue(quality?.confidence)!)}%`, distance: summary && data.intraday?.bars.at(-1) ? `${((summary.strike / data.intraday.bars.at(-1)!.close - 1) * 100).toFixed(2)}%` : '—', classification: quality?.classification ?? 'UNCONFIRMED', strengths: quality?.strengths ?? [], weaknesses: quality?.weaknesses ?? [] };
  };
  const decisionConfidence = factorValue(terminal?.decision.confidence);
  const spot = data.intraday?.bars.at(-1)?.close ?? null;
  const expectedMove = terminal?.expectedMove;

  return {
    asOf: data.asOf, dataStatus: data.dataStatus,
    optionActivityExpiry: expiry ?? null,
    structureScopeLabel: expiry?.expiryDate,
    decision: terminal ? { regime: terminal.decision.regime, primaryRisk: terminal.decision.primaryRisk, premiumEdge: terminal.decision.premiumEdge, keyLevel: terminal.decision.keyLevel.value === null ? '—' : `${terminal.decision.keyLevel.type} ${terminal.decision.keyLevel.value.toFixed(2)}`, action: terminal.decision.sellerAction, confidence: decisionConfidence, dataQuality: terminal.decision.dataQuality, reasons: terminal.decision.reasons, transition: terminal.decision.transition, playbook: terminal.decision.playbook } : null,
    structure: expiry?.gexSummary ? { gammaState:expiry.gexSummary.netGex>0?'正 GEX':expiry.gexSummary.netGex<0?'负 GEX':'零 GEX', netGex: millions(expiry?.gexSummary?.netGex), spotVsFlip: spot !== null && expiry?.gexSummary?.gammaFlip !== null && expiry?.gexSummary?.gammaFlip !== undefined ? `${(spot - expiry.gexSummary.gammaFlip).toFixed(2)} vs ${expiry.gexSummary.gammaFlip.toFixed(2)}` : '—', dealerBias: terminal?.dealer.direction ?? '—', dealerIntensity: `${factorValue(terminal?.dealer.intensity) === null ? '—' : `${Math.round(factorValue(terminal?.dealer.intensity)!)} / 100`}`, dealerConfidence: factorValue(terminal?.dealer.confidence) } : null,
    volatility: terminal ? { currentIv: pct(factorValue(terminal.iv.currentIv)), hv20: pct(factorValue(terminal.iv.hv20)), vrp: pct(factorValue(terminal.iv.vrp)), ivRank: factorValue(terminal.iv.ivRank) === null ? `积累中 (${terminal.iv.sampleSize}/20)` : `${factorValue(terminal.iv.ivRank)!.toFixed(0)}`, environment: terminal.iv.environment, confidence: factorValue(terminal.iv.confidence) } : null,
    expectedMove: terminal && expectedMove ? { range: `${money(factorValue(expectedMove.value))} · ${money(factorValue(expectedMove.lower))} — ${money(factorValue(expectedMove.upper))}`, position: factorValue(expectedMove.rangePositionPct) === null ? '—' : `${factorValue(expectedMove.rangePositionPct)!.toFixed(1)}% of range`, lowerRoom: money(factorValue(expectedMove.distanceToLower)), upperRoom: money(factorValue(expectedMove.distanceToUpper)), status: expectedMove.state, implication: expectedMove.sellerImplication, source: expectedMove.method === 'ATM_STRADDLE' ? 'DERIVED' : expectedMove.method === 'IV_1SIGMA' ? 'PROXY' : 'UNAVAILABLE' } : null,
    walls: [wall('CALL'), wall('PUT')],
    eligibility: { status: eligibilityStatus, blockingReasons: blockingReasons.length ? blockingReasons : ['无阻断项；仍需执行层最终确认。'], requiredConditions: terminal?.decision.transition ?? [], confidence: decisionConfidence },
    history: terminal ? { snapshotCount: expiry?.gex?.length ?? 0, summary: `Net GEX ${millions(expiry?.gexSummary?.netGex)} · ${expiry?.gex?.length ?? 0} valid snapshots` } : null,
  };
}

export function QqqPcsGexStandaloneContent() {
  const [indicatorObservationTarget,setIndicatorObservationTarget]=useState<HTMLDivElement|null>(null);
  const [activityResponseTarget,setActivityResponseTarget]=useState<HTMLDivElement|null>(null);
  const [activityHistoryTarget,setActivityHistoryTarget]=useState<HTMLDivElement|null>(null);
  const [snapshotTableTarget, setSnapshotTableTarget] = useState<HTMLDivElement | null>(null);
  const [chartLegendTarget, setChartLegendTarget] = useState<HTMLDivElement | null>(null);
  const [structureObservationTarget, setStructureObservationTarget] = useState<HTMLDivElement | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null);
  const [exposureReplay,setExposureReplay]=useState<QqqExposureReplayContext|null>(null);
  const [chartMode,setChartMode]=useState<'candles'|'matrix'|'heatmap'|null>(null);
  const [rendererPoc, setRendererPoc] = useState(false);
  const [detailTab, setDetailTab] = useState('监控');
  const [distributionTarget,setDistributionTarget]=useState<HTMLDivElement|null>(null);
  const [leftDataTab,setLeftDataTab]=useState('Gamma 地图');
  useEffect(() => { setRendererPoc(new URLSearchParams(window.location.search).get('renderer') === 'kline'); }, []);
  const { conditionsLoading, conditionsError, setConditionsRetry, requestConditions, closeConditions, conditionsData, windowLoading, windowError, historyStartReached, replayLoading, replayError, setReplayRetry, gexDates, selectedGexDate, setSelectedGexDate, historicalReplay, offline, retryAttempt, setRetryAttempt, latestLoading, datesLoading, historicalLoading, latestError, historicalView, displayError, displayData, pendingDisplay, retryDisplay, loadWindow, onVisibleTimeRangeChange, selectExpiry, loadHeatmapHistory } = useQqqGexDisplayData(selectedExpiry, setSelectedExpiry, chartMode);
  const requestFeedback = <><QqqGexRequestFeedback pending={pendingDisplay} blocking={!displayData || historicalLoading || latestLoading} offline={offline} error={displayError} label={historicalLoading ? `正在读取 ${selectedGexDate} 的历史数据` : '正在更新行情与 GEX'} asOf={displayData?.intraday?.gexAsOf ?? displayData?.asOf} retryAttempt={retryAttempt} onRetry={() => {setRetryAttempt(0); retryDisplay();}} />
    {!historicalView && (windowLoading || windowError || historyStartReached) && <div role="status" style={{position:'absolute',bottom:28,left:8,zIndex:6,background:'var(--bg-card)',padding:'4px 6px',fontSize:'.6rem',borderRadius:4}}>{windowLoading ? '正在补载更早数据…' : windowError ? <>{windowError.message} <button type="button" onClick={()=>void loadWindow(windowError.from,windowError.to,true)}>重试补载</button></> : '已到开盘记录'} </div>}
  </>;
  const terminalView = useMemo(() => displayData ? buildTerminalView(conditionsData && !historicalView ? conditionsData : displayData, selectedExpiry) : null, [displayData, selectedExpiry, conditionsData, historicalView]);
  const activeReplay = matchingExposureReplay(exposureReplay,displayData?.view.date,selectedExpiry??displayData?.intraday?.gexExpiries?.[0]?.expiryDate??null);
  // Distribution and IV consume the shared frame directly. Their cursor must
  // not also rebuild the hidden Gamma/activity terminal and historical payload.
  const needsObservation=leftDataTab==='Gamma 地图'||leftDataTab==='成交持仓';
  const observationData=useMemo(()=>needsObservation&&displayData&&activeReplay?exposureReplayDisplayPayload(displayData,activeReplay):displayData,[displayData,activeReplay,needsObservation]);
  const observationExpiry=activeReplay?.scope==='0dte'?activeReplay.date:selectedExpiry;
  const observationTerminal=useMemo(()=>{
    if(!needsObservation)return terminalView;
    if (!observationData) return null;
    const view=buildTerminalView(observationData,observationExpiry);
    if (activeReplay?.scope!=='all' || leftDataTab !== '成交持仓') return view;
    const expiries=observationData.intraday?.gexExpiries??[];
    return {...view,optionActivityExpiry:aggregateQqqOptionActivity(expiries,observationData.observedAt??observationData.asOf,activeReplay.frame?.missing??[]),optionActivityLabel:`合计 · ${expiries.length} 个到期日`};
  },[observationData,observationExpiry,activeReplay,leftDataTab,needsObservation,terminalView]);
  const observationHistorical=historicalView || Boolean(activeReplay&&!activeReplay.followingLatest);
  const referenceLabel=`${historicalView?'所选日期':'最新参考'} · ${displayData?new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(displayData.observedAt??displayData.asOf)):'—'} ET`;

  if (!displayData || !terminalView) return <QqqTerminalWorkspace header={<QqqNextActionCard compact scope="gex" marketQuote showCompactLinks={false} fallbackPrice={!historicalView ? displayData?.intraday?.bars.at(-1)?.close : null} historicalDate={historicalView ? selectedGexDate : null} loading={latestLoading || historicalLoading} error={Boolean(displayError)} />} headerRight={<QqqGexDateRail compact dates={gexDates} selectedDate={selectedGexDate} onDateSelect={setSelectedGexDate} loading={historicalLoading} indexLoading={datesLoading} premarketAsOf={displayData?.intraday?.session === 'PREMARKET' ? displayData.intradaySessionAsOf : null} />} showFocusButton={false} main={<div style={{position:"relative",display:"flex",flex:1,minHeight:0}}><QqqGexLoadingSkeleton />{requestFeedback}</div>} aside={<QqqTerminalPanel title="数据状态" fill>{displayError ? <div role="alert">{displayError}</div> : <p style={{ fontSize: '.75rem' }}>正在读取行情和条件，数据就绪后会自动显示。</p>}</QqqTerminalPanel>} />;
  const qualityProfiles=activeReplay?(activeReplay.frame?.profiles??[]):(displayData.intraday?.gexExpiries??[]).filter(expiry=>expiry.expiryDate===(selectedExpiry??displayData.intraday?.gexExpiries?.[0]?.expiryDate)).map(expiry=>({strikes:expiry.fullGexProfile,time:Date.parse(expiry.asOf)}));
  const inputQuality=qqqGexInputQuality(qualityProfiles,activeReplay?.frame?.time??Date.parse(displayData.observedAt??displayData.asOf));
  const chart = <div style={{display:'flex',flex:1,minHeight:0,minWidth:0,flexDirection:'column'}}><MemoGexChart activityResponseTarget={activityResponseTarget} activityHistoryTarget={activityHistoryTarget} indicatorObservationTarget={indicatorObservationTarget} distributionTarget={distributionTarget} activityInSidebar onReplayChange={setExposureReplay} onViewModeChange={setChartMode} onLoadHeatmapHistory={historicalView?undefined:loadHeatmapHistory} directionalSignals={historicalReplay?.items ?? displayData.intraday?.directional?.signals} snapshotTableTarget={snapshotTableTarget} chartLegendTarget={chartLegendTarget} structureObservationTarget={structureObservationTarget} data={displayData} standalone selectedExpiry={selectedExpiry} onSelectedExpiryChange={selectExpiry} onVisibleTimeRangeChange={onVisibleTimeRangeChange} showGexTable renderer={rendererPoc ? 'kline' : 'lightweight'} /></div>;
  return <QqqGexTerminal activityResponseRef={setActivityResponseTarget} activityHistoryRef={setActivityHistoryTarget} indicatorObservationRef={setIndicatorObservationTarget} intradayPulseContent={<QqqIntradayPulseCard data={displayData} replay={activeReplay} selectedExpiry={selectedExpiry} />} spreadStudyContent={<QqqSpreadStudyCard data={displayData} replay={activeReplay} selectedExpiry={selectedExpiry} />} wallStatsContent={<QqqWallTouchStatsCard data={displayData} replay={activeReplay} selectedExpiry={selectedExpiry} />} maxPainContent={<QqqMaxPainCard data={displayData} replay={activeReplay} selectedExpiry={selectedExpiry} onSelectExpiry={selectExpiry} />} atmIvContent={<QqqAtmIvCard data={displayData} replay={activeReplay} selectedExpiry={selectedExpiry} />} distributionRef={setDistributionTarget} onDataTabChange={setLeftDataTab} referenceTerminal={terminalView} referenceLabel={referenceLabel} observationLabel={activeReplay?`${activeReplay.followingLatest?'最新快照':'回放'} · ${activeReplay.frame?new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(activeReplay.frame.time):'等待快照'} ET${activeReplay.frame?.missing.length?` · 缺 ${activeReplay.frame.missing.length} 个到期日`:activeReplay.scope==='all'?' · 合计范围':''}`:undefined} conditionsError={conditionsError} onConditionsRetry={() => setConditionsRetry(value=>value+1)} requestFeedback={requestFeedback} leftContent={<><QqqGammaObservation replay={activeReplay} data={observationData??displayData} selectedExpiry={observationExpiry} lockedScope={activeReplay?(activeReplay.scope==='all'?'available':'selected'):undefined} historical={observationHistorical} loading={historicalLoading || latestLoading} /></>} conditionsLoading={!historicalView && conditionsLoading} onConditionsOpen={historicalView ? undefined : requestConditions} onConditionsClose={closeConditions} onActiveTabChange={setDetailTab} snapshotTableRef={setSnapshotTableTarget} chartLegendRef={setChartLegendTarget} structureObservationRef={setStructureObservationTarget} terminal={observationTerminal??terminalView} topContent={<QqqNextActionCard inputQuality={inputQuality} endControls={<QqqGexDateRail compact dates={gexDates} selectedDate={selectedGexDate} onDateSelect={setSelectedGexDate} loading={historicalLoading} indexLoading={datesLoading} premarketAsOf={displayData?.intraday?.session === 'PREMARKET' ? displayData.intradaySessionAsOf : null} />} compact scope="gex" marketQuote showCompactLinks={false} fallbackPrice={!historicalView ? displayData.intraday?.bars.at(-1)?.close : null} historicalDate={historicalView ? selectedGexDate : null} signal={displayData.intraday?.directional?.current} loading={latestLoading} error={Boolean(latestError)} />} sideContent={<><QqqDirectionalSignalConsole historicalDate={historicalView ? selectedGexDate : null} replayLoading={replayLoading} flat visible={detailTab === '监控'} directional={displayData.intraday?.directional} replay={historicalReplay} />{replayError && <div role="status">{replayError} <button type="button" disabled={replayLoading} onClick={()=>setReplayRetry(value=>value+1)}>{replayLoading?'正在读取提醒…':'重试提醒'}</button></div>}</>} chart={chart} chartLoading={historicalLoading || latestLoading} chartLoadingLabel={historicalLoading ? `正在切换到 ${selectedGexDate ?? '所选日期'} 的历史 GEX` : '正在更新最新 GEX'} />;
}
