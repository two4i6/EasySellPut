'use client';
import { QqqObservationHeading, QqqObservationEmpty, QqqObservationToolbar } from './terminal/QqqObservationUi';
import { useQqqExposureFrames } from '@/hooks/useQqqExposureFrames';
import { mergeExposureBars } from '@/lib/qqqExposureBars';
import {useQqqAggregateExposureFrames} from '@/hooks/useQqqAggregateExposureFrames';
import useQqqLiveTick from '@/hooks/useQqqLiveTick';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { preparedExposureReplayRows } from '@/lib/qqqExposureChartReplay';

import { useStoredPreference } from '@/hooks/useStoredPreference';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QqqPcsApiResponse, PcsGexExpiry } from '@/types/qqqGex';
import { exposureActivity, exposureConcentrationLevels, exposureGexUnit, exposureSpotIndex, exposureStrikeMetric, exposureVolatility, type ExposureStrikeComparison, type ExposureMode, type ExposureBar } from '@/lib/qqqExposureWorkbench';
import { dayScenarioCoverageLabel, dayScenarioInput, dayScenarioSessionBounds, type DayScenarioMode } from '@/lib/qqqDayScenario';
import { useQqqDayScenario } from '@/hooks/useQqqDayScenario';
import { useQqqExposureField } from '@/hooks/useQqqExposureField';
import { formatQqqMatrixGex } from './qqqGexMatrixModel';
import settingsStyles from './QqqChartSettings.module.css';
import styles from './QqqExposureWorkbench.module.css';
import QqqExposureCanvas from './QqqExposureCanvas';
import QqqHeatmapInspector from './QqqHeatmapInspector';
import { heatmapChartSize } from './qqqHeatmapInteraction';
import QqqHeatmapDataStatus from './QqqHeatmapDataStatus';
import {heatmapCoverage,heatmapDefinition,heatmapLegendValue,parseHeatmapContrast,type HeatmapContrast} from '@/lib/qqqHeatmapPresentation';
import QqqReplaySlider from './QqqReplaySlider';
import QqqInfoTooltip from './QqqInfoTooltip';
import QqqExposureSnapshotTable from './QqqExposureSnapshotTable';
import { exposureReplayTableRows, type QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { exposureMagnitudeIndex, exposurePriceFallback, exposurePriceDisplay, updateExposureQuoteBars, exposureStrikeUniverseIndex } from './qqqExposureRenderModel';
import { useQqqExposureHistory } from '@/hooks/useQqqExposureHistory';
import { mergeExposureHistory } from '@/lib/qqqExposureHistoryModel';
import { useQqqHeatmapOverlays } from '@/hooks/useQqqHeatmapOverlays';
import QqqHeatmapOverlayLines from './QqqHeatmapOverlayLines';
import { heatmapOverlayAxes, type HeatmapOverlayFlags } from '@/lib/qqqHeatmapOverlays';
import QqqHeatmapPriceReactions, {type HeatmapReactionFlags} from './QqqHeatmapPriceReactions';
import QqqHedgeObservationPanels, { type HedgePanelFlags } from './QqqHedgeObservationPanels';
import { useQqqHedgeObservations } from '@/hooks/useQqqHedgeObservations';
import { useQqqHeatmapDiscovery } from '@/hooks/useQqqHeatmapDiscovery';
import { discoveryDefaults, scenarioExpectedBandsFromInput, type DiscoveryFlags } from '@/lib/qqqHeatmapDiscovery';
import DiscoveryPanels, { DiscoveryLayers, DiscoverySkewLine } from './QqqHeatmapDiscovery';

const timeFormatter = new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const timeLabel = (time:number) => timeFormatter.format(time);
const quoteTimeFormatter = new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const modeLabels = { gamma: '净 Gamma 暴露', 'gamma-call':'Call Gamma · 有效侧', 'gamma-put':'Put Gamma · 有效侧（负号）', delta: 'Delta 存量估算', charm: 'Charm 每分钟变化' };
const emptyExpiries:PcsGexExpiry[]=[],emptyBars:ExposureBar[]=[],emptyHeatTiles:import('./qqqExposureRenderModel').ExposureTile[]=[];
const historyColors:Record<number,string>={10:'#f3f4f6',30:'#facc15',60:'#22d3ee'};

const emptyGammaHistory:NonNullable<NonNullable<QqqPcsApiResponse['intraday']>['gammaPositionHistory']>=[];
const parseDiscoveryPreferences=(raw:string|null)=>{
  const saved=JSON.parse(raw??'null');
  return Object.fromEntries(Object.entries(discoveryDefaults).map(([key,value])=>[key,typeof saved?.[key]==='boolean'?saved[key]:value])) as DiscoveryFlags;
};
const strikeDefaults = { historyMarks: true, dayRange: true };
const overlayDefaults:HeatmapOverlayFlags={vwap:true,delta:true,iv:true,putCall:true};
const reactionDefaults:HeatmapReactionFlags={markers:true,low:true,high:true};
const observationPanelFlags:HedgePanelFlags={activity:true,hedge:true,response:true};
const observationDiscoveryFlags:DiscoveryFlags={...discoveryDefaults,changes:true,events:true};
const parseReactionPreferences=(raw:string|null)=>{
  const saved=JSON.parse(raw??'null');
  return Object.fromEntries(Object.entries(reactionDefaults).map(([key,value])=>[key,typeof saved?.[key]==='boolean'?saved[key]:value])) as HeatmapReactionFlags;
};
const parseOverlayPreferences=(raw:string|null)=>{
  const saved=JSON.parse(raw??'null');
  return Object.fromEntries(Object.entries(overlayDefaults).map(([key,value])=>[key,typeof saved?.[key]==='boolean'?saved[key]:value])) as HeatmapOverlayFlags;
};
const parseStrikePreferences = (raw: string | null) => {
  const saved = JSON.parse(raw ?? 'null');
  return { historyMarks: typeof saved?.historyMarks === 'boolean' ? saved.historyMarks : true, dayRange: typeof saved?.dayRange === 'boolean' ? saved.dayRange : true };
};

function QqqExposureWorkbench({activityResponseTarget,activityHistoryTarget,indicatorObservationTarget,data,selectedExpiry,active,allExpiries=false,selectionToken=0,settingsTarget,onLoadHistory,onReplayChange,snapshotTableTarget,distributionTarget,controlsTarget,projectionLoading=false,projectionError}:{indicatorObservationTarget?:HTMLElement|null;activityResponseTarget?:HTMLElement|null;activityHistoryTarget?:HTMLElement|null;distributionTarget?:HTMLElement|null;allExpiries?:boolean;projectionLoading?:boolean;projectionError?:string|null;controlsTarget?:HTMLElement|null;onReplayChange?:(context:QqqExposureReplayContext|null)=>void;snapshotTableTarget?:HTMLElement|null;active:boolean;selectionToken?:number;onLoadHistory?:()=>Promise<void>;data:QqqPcsApiResponse;selectedExpiry:string|null;settingsTarget:HTMLElement|null}) {
  const timelineActive=active||Boolean(controlsTarget);
  const renderExposure=active||Boolean(distributionTarget)||Boolean(activityHistoryTarget);
  const [preferredScope,setScope]=useState<'selected'|'all'>('selected');
  const scope=allExpiries?'all':preferredScope;
  useEffect(()=>{if(selectionToken>0)setScope('selected');},[selectionToken]);
  const [heatmapView,setHeatmapView]=useState<'history'|'scenario'>('history');
  const scenarioView=heatmapView==='scenario';
  const [mode,setMode]=useState<ExposureMode>('gamma'),[metric,setMetric]=useState<'gex'|'oi'|'volume'>('gex');
  const replayKey=`${data.view.date}:${scope}:${selectedExpiry??''}`;
  const [selectionCursor,setSelectionCursor]=useState<{key:string;time:number|null}>({key:replayKey,time:null});
  const cursor=selectionCursor.key===replayKey?selectionCursor.time:null;
  const setCursor=useCallback((value:number|null|((previous:number|null)=>number|null))=>setSelectionCursor(previous=>({key:replayKey,time:typeof value==='function'?value(previous.key===replayKey?previous.time:null):value})),[replayKey]);
  const [playing,setPlaying]=useState(false);
  const [playbackSpeed,setPlaybackSpeed]=useState(1);
  const [radius,setRadius]=useState(10),[gain,setGain]=useState(1),[keys,setKeys]=useState(true),[heat,setHeat]=useState(true);
  const [{ historyMarks, dayRange }, setStrikePreferences] = useStoredPreference('qqq-pcs:heatmap-strike-display:v1', strikeDefaults, parseStrikePreferences);
  const setHistoryMarks = (historyMarks: boolean) => setStrikePreferences(previous => ({ ...previous, historyMarks }));
  const setDayRange = (dayRange: boolean) => setStrikePreferences(previous => ({ ...previous, dayRange }));
  const [overlays,setOverlays]=useStoredPreference('qqq-pcs:heatmap-overlays:v1',overlayDefaults,parseOverlayPreferences);
  const [reactions,setReactions]=useStoredPreference('qqq-pcs:heatmap-price-reactions:v1',reactionDefaults,parseReactionPreferences);
  const [discovery,setDiscovery]=useStoredPreference('qqq-pcs:heatmap-discovery:v1',discoveryDefaults,parseDiscoveryPreferences);
  const [changeMinutes,setChangeMinutes]=useState(10);
  const [focusedStrike,setFocusedStrike]=useState<number|null>(null);
  const [observationMinutes,setObservationMinutes]=useState(10);
  const [strikeHover,setStrikeHover]=useState<{strike:number;x:number;y:number}|null>(null);
  const [inverted,setInverted]=useState(false),[smooth,setSmooth]=useState(0),[barZoom,setBarZoom]=useState(1);
  const [contrast,setContrast]=useStoredPreference<HeatmapContrast>('qqq-pcs:heatmap-contrast:v1','enhanced',parseHeatmapContrast);
  const [historyLoading,setHistoryLoading]=useState(false);
  const chartViewport=useRef<HTMLDivElement>(null);
  const [viewportSize,setViewportSize]=useState({width:1000,height:500});
  const axisCount=heatmapOverlayAxes(overlays).length+(discovery.skew?1:0);
  const chartSize=useMemo(()=>heatmapChartSize(viewportSize.width,viewportSize.height,axisCount),[viewportSize,axisCount]);
  const originalExpiries=data.intraday?.gexExpiries??emptyExpiries;
  const archiveExpiry=scope==='selected'?selectedExpiry:null;
  const { archived, archiveLoading, archiveError, retryArchive } = useQqqExposureHistory(data.view.date, archiveExpiry, timelineActive);
  const expiries=useMemo(()=>mergeExposureHistory(archived,originalExpiries,data.view.date??''),[archived,originalExpiries,data.view.date]);
  const bars=useMemo(()=>mergeExposureBars(archived?.bars??emptyBars,data.intraday?.bars??emptyBars),[archived?.bars,data.intraday?.bars]);
  const livePriceEnabled=active&&cursor===null&&data.view.mode==='live'&&data.view.date===qqqEasternDateKey(new Date());
  const liveTick=useQqqLiveTick(livePriceEnabled);
  const [quoteHistory,setQuoteHistory]=useState<{date:string|null;bars:readonly ExposureBar[];time:number|null}>({date:null,bars:[],time:null});
  useEffect(()=>{
    if(!livePriceEnabled||!liveTick)return;
    setQuoteHistory(previous=>{
      const prior=previous.date===data.view.date?previous.bars:emptyBars;
      const next=updateExposureQuoteBars(prior,liveTick,data.view.date,bars);
      return next===prior?previous:{date:data.view.date,bars:next,time:liveTick.time*1000};
    });
  },[livePriceEnabled,liveTick,data.view.date,bars]);
  const observedAt=archived&&Date.parse(archived.observedAt)>Date.parse(data.observedAt??data.asOf)?archived.observedAt:data.observedAt??data.asOf;
  const frameInput=useMemo(()=>({frames:expiries,bars:expiries,cutoff:Date.parse(observedAt),scope,selected:selectedExpiry,sessionDate:data.view.date??undefined}),[expiries,observedAt,scope,selectedExpiry,data.view.date]);
  const {frames:rawFrames,loading:framesLoading,error:framesError}=useQqqExposureFrames(frameInput,timelineActive||renderExposure);
  const spotAt=useMemo(()=>exposureSpotIndex(bars),[bars]);
  const aggregateInput=useMemo(()=>({frames:rawFrames,spotAt,aggregate:scope==='all'}),[rawFrames,spotAt,scope]);
  const {frames,loading:aggregateLoading,error:aggregateError}=useQqqAggregateExposureFrames(aggregateInput);
  const seekDiscovery=useCallback((time:number,strike?:number)=>{
    const next=frames.findIndex(frame=>frame.time>=time);
    setPlaying(false);setCursor(frames[next<0?frames.length-1:next]?.time??time);setFocusedStrike(strike??null);
    chartViewport.current?.scrollIntoView({block:'nearest'});
  },[setCursor,frames]);
  const requestedIndex=cursor===null?frames.length-1:frames.findLastIndex(f=>f.time<=cursor);
  const index=requestedIndex,frame=frames[index];
  useEffect(()=>{
    if(!timelineActive)return;
    // The slider already coalesces frames; a transition can starve linked views during dragging.
    onReplayChange?.({date:data.view.date??'',selectedExpiry,scope,followingLatest:cursor===null,frame:frame??null,bars,frames,rawFrames});
  },[timelineActive,onReplayChange,data.view.date,selectedExpiry,scope,cursor,frame,bars,frames,rawFrames]);
  const fallbackReplayRows=useMemo(()=>snapshotTableTarget&&!controlsTarget?exposureReplayTableRows(frames,bars):[],[snapshotTableTarget,controlsTarget,frames,bars]);
  // Preparation publishes into a shared WeakMap without changing frame identity.
  // Read the cache on each render so a memoized cold miss cannot hide ready rows.
  const replayRows=snapshotTableTarget?(controlsTarget?preparedExposureReplayRows(frames,bars)??[]:fallbackReplayRows):[];

  const gexUnit=exposureGexUnit(frame);
  const modelGamma=frame?.profiles.some(p=>p.strikes.some(s=>(s as typeof s & {calculationVersion?:string}).calculationVersion==='qqq-exposure-gamma-model-v1'));
  const gexUnitLabel=modelGamma?'模型 GEX · $ / 1% 变动':gexUnit==='per-1pct'?'$ / 1% 变动':gexUnit==='per-point'?'$ / 1 点变动':'旧 GEX · 口径未记录';
  // Display switches must not invalidate prepared series or erase the other
  // curves while an asynchronous calculation restarts.
  const overlayInput=useMemo(()=>({frames,bars,date:data.view.date??'',expiry:selectedExpiry,scope,flags:overlayDefaults}),[frames,bars,data.view.date,scope,selectedExpiry]);
  const overlayResult=useQqqHeatmapOverlays(overlayInput,active);
  const hedgeInput=useMemo(()=>({frames,bars}),[frames,bars]);
  const hedgeResult=useQqqHedgeObservations(hedgeInput,timelineActive&&Boolean(activityResponseTarget));
  const discoveryInput=useMemo(()=>({frames,bars,expiry:selectedExpiry,scope}),[frames,bars,selectedExpiry,scope]);
  const discoveryResult=useQqqHeatmapDiscovery(discoveryInput,active||Boolean(indicatorObservationTarget));
  const gammaHistory=data.intraday?.gammaPositionHistory??emptyGammaHistory;
  const reactionInput=useMemo(()=>({data,frames,bars,date:data.view.date??'',scope,expiry:selectedExpiry}),[data,frames,bars,scope,selectedExpiry]);
  const priceFallback=useMemo(()=>exposurePriceFallback(bars,data.view.date,observedAt),[bars,data.view.date,observedAt]);
  const frameTimes=useMemo(()=>frames.map(f=>f.time),[frames]);
  // The subscription emits null when the quote expires. Retained quote OHLC
  // must then stop advertising LIVE even if no archive/bar dependency changed.
  const displayQuoteTime=livePriceEnabled&&liveTick&&quoteHistory.date===data.view.date?quoteHistory.time:null;
  const priceDisplay=useMemo(()=>exposurePriceDisplay(bars,displayQuoteTime!==null?quoteHistory.bars:emptyBars,data.view.date,frameTimes,cursor!==null?frame?.time??cursor:data.view.mode==='historical'?frame?.time??Date.parse(observedAt):null,displayQuoteTime),[bars,displayQuoteTime,quoteHistory,data.view.date,data.view.mode,frameTimes,cursor,frame,observedAt]);
  const cutoff=frame?.time??priceFallback.cutoff,spot=spotAt(cutoff)??(!frame?priceFallback.anchor:null);
  const scenarioFrame=rawFrames.findLast(f=>f.time<=cutoff);
  const scenarioInput=useMemo(()=>dayScenarioInput(scenarioFrame,data.view.date??'',scenarioFrame?spotAt(scenarioFrame.time):null),[scenarioFrame,data.view.date,spotAt]);
  const scenarioMode:DayScenarioMode=mode.startsWith('gamma')?mode as DayScenarioMode:'gamma';
  const scenario=useQqqDayScenario(scenarioInput,scenarioMode,active&&scenarioView,'partial',replayKey);
  const scenarioField=scenario.field;
  const scenarioDisplayedAt=scenarioField?.observationAt??scenarioInput.observationAt;
  const scenarioBands=useMemo(()=>scenarioExpectedBandsFromInput(
    scenario.input,scenarioField?.times??[],selectedExpiry,scope
  ),[scenarioField,scenario.input,selectedExpiry,scope]);
  const indicatorCutoff=cutoff;
  const expiryScopeLabel=scope==='all'?'可用合计':'所选到期日';
  const observedIndicatorLabel=scenarioView?'历史观察':'历史快照';
  const scenarioBounds=useMemo(()=>{try{return dayScenarioSessionBounds(data.view.date??'');}catch{return null;}},[data.view.date]);

  const visibleFrames=useMemo(()=>frames.slice(0,index+1),[frames,index]);
  const universeAt=useMemo(()=>exposureStrikeUniverseIndex(frames),[frames]);
  const fieldAnchor=useMemo(()=>{
    const all=universeAt(frames.length-1);
    return Math.round(spotAt(frames[0]?.time??0)??all[Math.floor(all.length/2)]??0);
  },[universeAt,frames,spotAt]);
  const rangeAnchor=priceDisplay.anchor??spot??fieldAnchor;
  // Prepare the strike universe independently of the moving current price.
  // Quotes and wheel updates only change geometry, never restart preparation.
  const fieldStrikes=useMemo(()=>{
    const all=universeAt(frames.length-1);
    return all.sort((a,b)=>b-a);
  },[universeAt,frames]);
  const strikes=useMemo(()=>{
    const ticks=fieldStrikes.length?fieldStrikes:Array.from({length:Math.ceil(radius)*2+1},(_,i)=>Math.round(rangeAnchor)+Math.ceil(radius)-i);
    return ticks.filter(s=>Math.abs(s-rangeAnchor)<=radius+.5);
  },[fieldStrikes,rangeAnchor,radius]);
  const strikeKey=fieldStrikes.join(',');
  const selectedStrikes=useMemo(()=>new Set(strikeKey?strikeKey.split(',').map(Number):[]),[strikeKey]);
  const metrics=useMemo(()=>renderExposure&&frame?exposureStrikeMetric(frame,metric,selectedStrikes):new Map<number,number|null>(),[renderExposure,frame,metric,selectedStrikes]);
  const fieldInput=useMemo(()=>({frames,mode,metric,spotAt,selectedStrikes,comparisons:historyMarks||dayRange,activity:true}),[frames,mode,metric,spotAt,selectedStrikes,historyMarks,dayRange]);
  const {field,loading:fieldLoading,error:fieldError}=useQqqExposureField(fieldInput,renderExposure);
  const distributionCoverage=useMemo(()=>heatmapCoverage(frame,strikes,metrics),[frame,strikes,metrics]);
  const definition=useMemo(()=>heatmapDefinition(frame,rawFrames[index]),[frame,rawFrames,index]);
  const historyStatus=archiveError?'error':archiveLoading?'loading':archived?'complete':'partial';
  const comparisonAt=field?.comparisonAt;
  const comparisons=useMemo(()=>distributionTarget&&comparisonAt&&frame?comparisonAt(frame,selectedStrikes):new Map<number,ExposureStrikeComparison>(),[distributionTarget,comparisonAt,frame,selectedStrikes]);
  const hasHistoricalMarkers=historyMarks&&[...comparisons.values()].some(comparison=>comparison.history.some(mark=>mark.value!==null));
  const hasObservedRange=dayRange&&[...comparisons.values()].some(comparison=>comparison.range!==null);
  const cells=useMemo(()=>field?.cells.slice(0,index+1)??[],[field,index]);
  const chartCoverage=useMemo(()=>heatmapCoverage(frame,strikes,field?.cells[index]?.values??null,mode==='gamma-call'?'call':mode==='gamma-put'?'put':undefined),[frame,strikes,field,index,mode]);
  const magnitudeAt=useMemo(()=>exposureMagnitudeIndex(field?.cells??[],fieldStrikes),[field,fieldStrikes]);
  const historyMagnitude=magnitudeAt(index);
  const max=scenarioView?Math.max(1,scenarioField?.maximum??0):historyMagnitude.maximum;
  const validCells=scenarioView?(scenarioField?.reason?0:scenarioField?.values.length??0):historyMagnitude.count;
  const barMax=useMemo(()=>Math.max(1,...strikes.flatMap(s=>{
    const c=comparisons.get(s);
    return [Math.abs(metrics.get(s)??0),...(historyMarks?c?.history.map((h:{value:number|null})=>Math.abs(h.value??0))??[]:[]),...(dayRange&&c?.range?[Math.abs(c.range.min),Math.abs(c.range.max)]:[])];
  })),[strikes,comparisons,metrics,historyMarks,dayRange]);
  const increment=useMemo(()=>frame?exposureActivity(frames[index-1],frame):null,[frame,frames,index]);
  const volatility=useMemo(()=>active?exposureVolatility(bars,cutoff):null,[active,bars,cutoff]);
  const activitySeries=useMemo(()=>field?.activity.slice(0,index+1)??[],[field,index]);
  const activityMax=Math.ceil(Math.max(1,...activitySeries.map(p=>p.value?.total??0))/2)*2;
  useEffect(()=>{setCursor(null);setPlaying(false);},[scope,selectedExpiry,data.view.date,setCursor]);
  useEffect(()=>{setStrikeHover(null);},[scope,selectedExpiry,data.view.date,cursor,metric,mode,active]);
  useEffect(()=>{
    if(!playing||!timelineActive)return;
    const timer=setInterval(()=>setCursor(value=>{const next=frames.findIndex(f=>f.time>(value??-Infinity));if(next<0||next>=frames.length-1){setPlaying(false);return frames.at(-1)?.time??null;}return frames[next]!.time;}),1200/playbackSpeed);
    return()=>clearInterval(timer);
  },[playing,timelineActive,frames,setCursor,playbackSpeed]);
  const low=rangeAnchor-radius-.5,high=rangeAnchor+radius+.5;
  const hasFrame=Boolean(frame);
  const hasChart=hasFrame||priceDisplay.candles.length>0;
  useEffect(()=>{
    const viewport=chartViewport.current;
    if(!active||!hasChart||!viewport)return;
    let accumulated=0,animation=0;
    const flush=()=>{
      animation=0;
      const delta=accumulated;accumulated=0;
      setRadius(previous=>Math.max(5,Math.min(40,previous*Math.exp(delta*.0015))));
    };
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||event.metaKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.deltaY)return;
      event.preventDefault();
      accumulated+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1);
      if(!animation)animation=requestAnimationFrame(flush);
    };
    viewport.addEventListener('wheel',wheel,{passive:false});
    return ()=>{viewport.removeEventListener('wheel',wheel);if(animation)cancelAnimationFrame(animation);};
  },[active,hasChart]);
  useEffect(()=>{
    const viewport=chartViewport.current;
    if(!viewport)return;
    const observer=new ResizeObserver(([entry])=>{
      const width=Math.round(entry.contentRect.width),height=Math.round(entry.contentRect.height);
      if(width<=0||height<=0)return;
      setViewportSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});
    });
    observer.observe(viewport);
    return()=>observer.disconnect();
  },[active,hasChart]);
  const [distributionSize,setDistributionSize]=useState({width:300,height:400});
  useEffect(()=>{
    if(!distributionTarget)return;
    const panel=distributionTarget.closest<HTMLElement>('[role="tabpanel"]')??distributionTarget;
    const observer=new ResizeObserver(()=>{
      const width=Math.round(distributionTarget.clientWidth),height=Math.max(180,Math.min(520,Math.round(panel.clientHeight)-110));
      if(width>0&&height>0)setDistributionSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});
    });
    observer.observe(panel);
    return()=>observer.disconnect();
  },[distributionTarget]);
  const distributionWidth=distributionSize.width;
  const distributionHeight=distributionSize.height;
  const distributionAnchor=spot??((strikes[0]??0)+(strikes.at(-1)??0))/2;
  const distributionRadius=Math.max(1,...strikes.map(strike=>Math.abs(strike-distributionAnchor)+.5));
  const distributionPlotHeight=Math.max(1,distributionHeight-100);
  const distributionY=(price:number)=>distributionHeight/2+(distributionAnchor-price)/distributionRadius*distributionPlotHeight/2;
  // Compact only enabled axes; prepared series remain independent of switches.
  const standardOverlayAxisWidth=heatmapOverlayAxes(overlays).length*68;
  const overlayAxisWidth=standardOverlayAxisWidth+(discovery.skew?68:0);
  const plotLeft=58,plotRight=chartSize.width-100-overlayAxisWidth;
  const exposureScaleX=plotRight+12+overlayAxisWidth;
  const plotWidth=plotRight-plotLeft,plotHeight=Math.max(1,chartSize.height-74);
  const canvasPlot=useMemo(()=>({left:plotLeft,top:24,width:plotWidth,height:plotHeight}),[plotLeft,plotWidth,plotHeight]);
  const barCenter=(distributionWidth-50)/2,barExtent=Math.max(1,barCenter-22);
  const barX=useCallback((value:number)=>barCenter+Math.max(-barExtent,Math.min(barExtent,value/barMax*barExtent*barZoom)),[barCenter,barExtent,barMax,barZoom]);
  const metricValue=useCallback((value:number|null|undefined)=>value==null?'无有效快照':metric==='gex'?formatQqqMatrixGex(value):value.toLocaleString(undefined,{maximumFractionDigits:0})+' 张',[metric]);
  const hoveredComparison=strikeHover?comparisons.get(strikeHover.strike):null;
  const keyBoxHeight=Math.min(30,plotHeight/(high-low)*.85);
  const y=useCallback((price:number)=>24+(high-price)/(high-low)*plotHeight,[high,low,plotHeight]);
  const start=scenarioView&&scenarioBounds?scenarioBounds.start:priceDisplay.start,end=scenarioView&&scenarioBounds?scenarioBounds.end:priceDisplay.end,x=useCallback((time:number)=>plotLeft+(time-start)/(end-start)*plotWidth,[plotLeft,start,end,plotWidth]);
  const rowHeight=plotHeight/(high-low);
  // A display kernel only: numeric values and hover hit boxes remain the raw
  // snapshot cells. A separate time mask prevents halos bridging missing runs.
  // Make the heat field read as one continuous exposure cloud instead of
  // individually blurred tiles. Keep the source fills untouched; only the
  // display kernel and the crisp-edge contribution change.
  const blurX=Math.max(2,Math.min(10,plotWidth/Math.max(1,visibleFrames.length)*1.2));
  const blurY=Math.max(2,rowHeight*.62);
  // Geometry is independent of the cursor. Reuse old tile objects when moving
  // the cutoff; only the last snapshot's duration needs the causal end cap.
  const tileRows=useMemo(()=>active&&heat&&!scenarioView?(field?.cells??[]).map((c,i)=>strikes.flatMap(s=>{
    const value=c.values.get(s)??null;
    const next=frames[i+1]?.time??c.frame.time+120_000;
    return [{time:c.frame.time,strike:s,value,top:24+(high-s)/(high-low)*plotHeight-rowHeight/2,left:plotLeft+(c.frame.time-start)/(end-start)*plotWidth,width:Math.max(.5,(Math.min(next,c.frame.time+300_000)-c.frame.time)/(end-start)*plotWidth)}];
  })):[],[active,heat,scenarioView,field,strikes,frames,high,low,plotHeight,rowHeight,plotLeft,start,end,plotWidth]);
  const historyHeatTiles=useMemo(()=>{
    const prefix=tileRows.slice(0,Math.max(0,index)).flat();
    const last=tileRows[index]??[];
    const width=Math.max(.5,120_000/(end-start)*plotWidth);
    return prefix.concat(last.map(tile=>({...tile,width})));
  },[tileRows,index,end,start,plotWidth]);
  const heatTiles=scenarioView?emptyHeatTiles:historyHeatTiles;
  const scenarioRaster=useMemo(()=>scenarioView&&heat&&scenarioField&&!scenarioField.reason?{field:scenarioField,low,high}:undefined,[scenarioView,heat,scenarioField,low,high]);
  const chartPrices=useMemo(()=>scenarioView?Array.from({length:Math.floor(high-low)+1},(_,i)=>Math.ceil(low)+i).filter(p=>p<=high).reverse():strikes,[scenarioView,low,high,strikes]);
  const timeCoverage=useMemo(()=>cells.reduce<Array<{from:number;to:number}>>((runs,c,i)=>{
    if(!strikes.some(s=>c.values.get(s)!=null))return runs;
    const to=Math.min(visibleFrames[i+1]?.time??c.frame.time+120_000,c.frame.time+300_000);
    const previous=runs.at(-1);
    if(previous&&c.frame.time<=previous.to)previous.to=Math.max(previous.to,to);
    else runs.push({from:c.frame.time,to});
    return runs;
  },[]),[cells,strikes,visibleFrames]);
  const historyCanvasCoverage=useMemo(()=>timeCoverage.map(run=>({left:plotLeft+(run.from-start)/(end-start)*plotWidth,width:Math.max(.5,(run.to-run.from)/(end-start)*plotWidth)})),[timeCoverage,plotLeft,start,end,plotWidth]);
  const scenarioCanvasCoverage=useMemo(()=>scenarioField&&!scenarioField.reason?[{left:plotLeft,width:plotWidth}]:[],[scenarioField,plotLeft,plotWidth]);
  const canvasCoverage=scenarioView?scenarioCanvasCoverage:historyCanvasCoverage;
  const candles=useMemo(()=>priceDisplay.candles.filter(c=>c.bar.close>=low&&c.bar.close<=high),[priceDisplay.candles,low,high]);
  const levels=useMemo(()=>renderExposure&&frame?exposureConcentrationLevels(frame):[],[renderExposure,frame]);
  // Keep SVG element creation out of urgent slider and tooltip-only updates.
  useEffect(()=>setFocusedStrike(null),[scope,selectedExpiry,data.view.date]);
  const chartSvg=useMemo(()=>active&&hasChart?<svg className={styles.chart} viewBox={`0 0 ${chartSize.width} ${chartSize.height}`} role="group" aria-label="QQQ 行权价暴露热力图与价格回放" aria-busy={scenarioView&&scenario.loading} style={{width:chartSize.width,height:chartSize.height}}>
          <defs>
            <clipPath id="qqq-exposure-clip"><rect x={plotLeft} y="24" width={plotWidth} height={plotHeight}/></clipPath>
            <linearGradient id="qqq-exposure-scale" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={inverted?'#fb923c':'#60a5fa'}/><stop offset="0.5" stopColor="#05070b"/><stop offset="1" stopColor={inverted?'#60a5fa':'#fb923c'}/></linearGradient>

          </defs>
          <rect x={plotLeft} y="24" width={plotWidth} height={plotHeight} fill="#05070b"/>
          {chartPrices.map((strike,i)=>i%Math.max(1,Math.ceil(chartPrices.length/14))===0?<text key={strike} x={plotLeft-9} textAnchor="end" y={y(strike)+4} fill="#9ca3af">{strike}</text>:null)}
          <g clipPath="url(#qqq-exposure-clip)">
            <foreignObject x="0" y="0" width={chartSize.width} height={chartSize.height} pointerEvents="none">
              <QqqExposureCanvas tiles={heatTiles} rowHeight={rowHeight} size={chartSize} plot={canvasPlot} coverage={canvasCoverage} maximum={max} gain={gain} contrast={contrast} inverted={inverted} smooth={smooth} blurX={blurX} blurY={blurY} raster={scenarioRaster}/>
            </foreignObject>
          <QqqHeatmapInspector tiles={heatTiles} rowHeight={rowHeight} width={chartSize.width} height={chartSize.height} plot={canvasPlot} label={scenarioView?`${scenarioMode==='gamma'?'Gamma 贡献合计':modeLabels[scenarioMode]} · 输入 ${Number.isFinite(scenarioDisplayedAt)?timeLabel(scenarioDisplayedAt):'—'} ET`:modeLabels[mode]} priceAxis={scenarioView} scenario={scenarioRaster} frames={frames} mode={mode}/>
          {!scenarioView&&keys&&[...new Set(levels)].map(s=><line key={s} x1={plotLeft} x2={plotRight} y1={y(s)} y2={y(s)} stroke="#d4b16a" strokeDasharray="5 5" opacity=".7"/>)}
          {scenarioView&&scenarioField&&!scenarioField.reason&&<g pointerEvents="none" aria-label="情景输入截至时间">
            <line x1={x(Math.max(start,scenarioField.observationAt))} x2={x(Math.max(start,scenarioField.observationAt))} y1="24" y2={24+plotHeight} stroke="#c4a5ff" strokeDasharray="4 4"/>
            <text x={Math.min(plotRight-130,Math.max(plotLeft+4,x(scenarioField.observationAt)+5))} y="38" fill="#c4a5ff" fontSize="10">输入截至 {timeLabel(scenarioField.observationAt)} ET</text>
          </g>}
          {candles.map(({bar:b,time,provisional})=>{const px=x(time),up=b.close>=(b.open??b.close);return <g key={b.timestamp} aria-hidden="true" aria-label={provisional?'形成中 K 线 · 实时报价':'已收盘 K 线'} opacity={provisional?.75:1} pointerEvents="none"><line x1={px} x2={px} y1={y(b.high??b.close)} y2={y(b.low??b.close)} stroke={up?'#16e0a0':'#ff6b6b'}/><rect x={px-Math.max(1,Math.min(4,plotWidth*120_000/(end-start)*.65))/2} y={Math.min(y(b.open??b.close),y(b.close))} width={Math.max(1,Math.min(4,plotWidth*120_000/(end-start)*.65))} height={Math.max(1,Math.abs(y(b.open??b.close)-y(b.close)))} fill={up?'#16e0a0':'#ff6b6b'} stroke={up?'#16e0a0':'#ff6b6b'}/></g>;})}
          {priceDisplay.anchor!==null&&<g aria-label={`${priceDisplay.live?'LIVE':'价格'} ${priceDisplay.anchor.toFixed(2)}`} pointerEvents="none">
            <line x1={plotLeft} x2={plotRight} y1={y(priceDisplay.anchor)} y2={y(priceDisplay.anchor)} stroke={priceDisplay.live?'#67e8f9':'#dce1ee'} strokeDasharray="4 4" opacity=".65"/>
            <circle cx={x(priceDisplay.markerTime)} cy={y(priceDisplay.anchor)} r="2" fill={priceDisplay.live?'#67e8f9':'#dce1ee'}/>
          </g>}</g>
          {priceDisplay.anchor!==null&&<g pointerEvents="none"><rect x={plotRight-86} y="3" width="86" height="18" rx="3" fill={priceDisplay.live?'#12313b':'#202630'}/><text x={plotRight-5} y="16" textAnchor="end" fill={priceDisplay.live?'#67e8f9':'#dce1ee'} fontSize="10">{priceDisplay.live?'LIVE':'价格'} {priceDisplay.anchor.toFixed(2)}</text></g>}
          {hasFrame&&validCells>0&&<rect x={exposureScaleX} y="24" width="18" height={plotHeight} fill="url(#qqq-exposure-scale)"/>}
          {hasFrame&&validCells>0&&[1,.5,0,-.5,-1].map(n=><text key={n} x={exposureScaleX+24} y={24+(1-n)/2*plotHeight+4} fill="#9b9ca4" fontSize="10">{formatQqqMatrixGex(heatmapLegendValue(inverted?-n:n,max,contrast))}</text>)}
          <DiscoveryLayers scenarioBands={scenarioView?scenarioBands:undefined} bandEnd={scenarioView?end:undefined} series={discoveryResult.series} flags={discovery} cutoff={indicatorCutoff} start={start} x={x} y={y} left={plotLeft} right={plotRight} height={plotHeight} gammaHistory={gammaHistory} expiry={selectedExpiry} scope={scope}/>
          {focusedStrike!==null&&<g clipPath="url(#qqq-exposure-clip)" pointerEvents="none"><line x1={plotLeft} x2={plotRight} y1={y(focusedStrike)} y2={y(focusedStrike)} stroke="#f8fafc" strokeDasharray="2 3"/><text x={plotLeft+6} y={y(focusedStrike)-5} fill="#f8fafc" fontSize="10">观察 {focusedStrike.toFixed(2)}</text></g>}
          <QqqHeatmapOverlayLines series={overlayResult.series} flags={overlays} cutoff={indicatorCutoff} start={start} x={x} priceY={y} plotLeft={plotLeft} plotRight={plotRight} plotHeight={plotHeight} expiry={overlayInput.expiry} scope={scope} error={overlayResult.error}/>
          {discovery.skew&&<DiscoverySkewLine series={discoveryResult.series} cutoff={indicatorCutoff} start={start} x={x} left={plotLeft} right={plotRight} height={plotHeight} axisOffset={standardOverlayAxisWidth} scope={scope}/>}
          <QqqHeatmapPriceReactions input={reactionInput} flags={reactions} cutoff={indicatorCutoff} start={start} end={end} x={x} y={y} plotLeft={plotLeft} plotRight={plotRight}/>
          {[0,.25,.5,.75,1].map(n=><text key={n} x={plotLeft+n*plotWidth} y={chartSize.height-32} fill="#9ca3af" fontSize="11" textAnchor="middle">{timeLabel(start+n*(end-start))}</text>)}
          <text x={plotLeft+5} y={chartSize.height-7} fill="#9ca3af" fontSize="10">{data.view.date} · 美东时间 · {scenarioView?`日内情景推演 · 有效合约 · 输入 ${Number.isFinite(scenarioDisplayedAt)?timeLabel(scenarioDisplayedAt):'—'} · 非历史实测`:frame?`热图快照 ${timeLabel(frame.time)} · 每2分钟采集`:'价格行情'}{priceDisplay.live?` · 股票报价 ${quoteTimeFormatter.format(priceDisplay.markerTime)}`:candles.some(c=>c.provisional)?' · 当前 K 线形成中（实时报价）':''}</text>
        </svg>:null,[scenario.loading,indicatorCutoff,scenarioBands,scenarioRaster,scenarioView,scenarioMode,scenarioField,scenarioDisplayedAt,chartPrices,active,mode,hasFrame,hasChart,chartSize,plotLeft,plotRight,plotWidth,plotHeight,exposureScaleX,canvasPlot,y,rowHeight,heatTiles,canvasCoverage,max,validCells,gain,contrast,inverted,smooth,blurX,blurY,keys,levels,candles,x,end,start,priceDisplay.anchor,priceDisplay.live,priceDisplay.markerTime,frame,frames,data.view.date,overlayResult.series,overlayResult.error,overlays,overlayInput.expiry,scope,reactionInput,reactions,discoveryResult.series,discovery,gammaHistory,selectedExpiry,focusedStrike,standardOverlayAxisWidth]);
  const distributionSvg=distributionTarget?(hasFrame?<svg viewBox={`0 0 ${distributionWidth} ${distributionHeight}`} style={{width:'100%',height:distributionHeight,display:'block'}} role="img" aria-label="行权价分布与历史标记">          <line x1={barCenter} x2={barCenter} y1="50" y2={distributionHeight-50} stroke="#52586a"/>
          <text x="12" y="13" fill="#9ca3af" fontSize="10">{hasHistoricalMarkers?'历史：':historyMarks&&!fieldLoading&&metric==='gex'&&gexUnit==='unknown'?'历史不可比 · 旧 GEX':''}</text>
          {hasHistoricalMarkers&&[10,30,60].map((minutes,i)=><g key={minutes}><circle cx={56+i*48} cy="10" r="3.5" fill={historyColors[minutes]}/><text x={62+i*48} y="13" fill="#9ca3af" fontSize="10">{minutes}m</text></g>)}
          {hasObservedRange&&<text x={hasHistoricalMarkers?204:12} y="13" fill="#9ca3af" fontSize="10">━ 当日范围</text>}
          {strikes.map((s,si)=>{
            const v=metrics.get(s),comparison=comparisons.get(s),width=Math.abs(barX(v??0)-barCenter);
            const label=`行权价 ${s}，当前 ${metricValue(v)}。悬停或聚焦查看历史与当日范围`;
            return <g key={s}><title>{`${label} · ${comparison?.history.map(h=>`${h.minutes}分钟前 ${metricValue(h.value)}`).join(" · ")??""} · 当日范围 ${metricValue(comparison?.range?.min)} – ${metricValue(comparison?.range?.max)}`}</title>
              {(si%Math.max(1,Math.ceil(strikes.length*16/distributionPlotHeight))===0)&&<text x={distributionWidth-9} textAnchor="end" y={distributionY(s)+4} fill="#9ca3af" fontSize="10">{s.toFixed(0)}</text>}
              {dayRange&&comparison?.range&&<g stroke="#9ca3af" opacity=".45" pointerEvents="none">
                <line x1={barX(comparison.range.min)} x2={barX(comparison.range.max)} y1={distributionY(s)} y2={distributionY(s)} strokeWidth="3"/>
                {[comparison.range.min,comparison.range.max].map((value,i)=><line key={i} x1={barX(value)} x2={barX(value)} y1={distributionY(s)-3} y2={distributionY(s)+3}/>)}
              </g>}
              {v!=null&&<rect x={Math.min(barCenter,barX(v))} y={distributionY(s)-2} width={width} height="4" fill={v>=0?'#60a5fa':'#fb923c'} pointerEvents="none"/>}
              {historyMarks&&comparison?.history.map(h=>h.value!=null?<circle key={h.minutes} data-history-minutes={h.minutes} cx={barX(h.value)} cy={distributionY(s)} r="4" fill={historyColors[h.minutes]} stroke="#05070b" strokeWidth="1" pointerEvents="none"/>:null)}

            </g>;
          })}
          {keys&&[...new Set(levels)].filter(s=>s>=low&&s<=high).map(s=><g key={s} pointerEvents="none"><rect x="12" y={distributionY(s)-Math.min(24,distributionPlotHeight/(distributionRadius*2)*.85)/2} width={Math.max(40,distributionWidth-65)} height={Math.min(24,distributionPlotHeight/(distributionRadius*2)*.85)} rx="8" fill="none" stroke="#d4b16a" strokeWidth="1.5"/><text x={distributionWidth-65} y={distributionY(s)+5} textAnchor="end" fill="#d4b16a" fontSize="10" fontWeight="700">{s.toFixed(0)}</text></g>)}
          {spot!=null&&<g><line x1="12" x2={distributionWidth-48} y1={distributionHeight/2} y2={distributionHeight/2} stroke="#dce1ee" strokeDasharray="3 4"/><text x={distributionWidth-9} y={distributionHeight/2-5} textAnchor="end" fill="#dce1ee" fontSize="10">现价 {spot.toFixed(2)}</text></g>}
          <text x={barCenter} y={distributionHeight-8} fill="#9ca3af" textAnchor="middle" fontSize="10">{metric==='oi'?'Call OI − Put OI':metric==='volume'?'成交量 / 张':gexUnitLabel}</text>
          {[-1,0,1].map(n=><text key={n} x={barCenter+n*barExtent} y={distributionHeight-30} fill="#9ca3af" textAnchor="middle" fontSize="10">{metric==='gex'?formatQqqMatrixGex(n*barMax/barZoom):(n*barMax/barZoom).toLocaleString(undefined,{maximumFractionDigits:0,notation:'compact'})}</text>)}
</svg>:<QqqObservationEmpty>等待当日行权价快照，更新后显示分布。</QqqObservationEmpty>):null;
  const settings=<section className={settingsStyles.panel} aria-label="热力图设置">
    <fieldset className={settingsStyles.section}>
      <legend>热力图</legend>
      <label className={settingsStyles.row}>显示模式<select aria-label="热力图显示模式" value={heatmapView} onChange={e=>setHeatmapView(e.target.value as 'history'|'scenario')}><option value="history">历史快照</option><option value="scenario">日内情景推演</option></select></label>
      <label className={settingsStyles.row}>暴露类型<select aria-label="热力图" value={scenarioView?scenarioMode:mode} onChange={e=>setMode(e.target.value as ExposureMode)}>{Object.entries(modeLabels).map(([key,label])=><option key={key} value={key} disabled={scenarioView&&!key.startsWith('gamma')}>{scenarioView&&key==='gamma'?'Gamma 贡献合计':label}</option>)}</select></label>
      <small>{scenarioView?'自动合计有效合约侧，缺失贡献未知，不填零、不补 IV。固定 OI / IV，r=q=0，Call 正 / Put 负，不代表真实做市商账本。':'净 Gamma 需要两侧有效；Call / Put 独立展示有效侧。缺失留空，悬停区分未知、零值和极小值。'}</small>
      {scenarioView&&scenarioField&&!scenarioField.reason&&<small>显示输入 {timeLabel(scenarioDisplayedAt)} ET · {expiryScopeLabel} · 纳入 {scenarioField.included.length} 个到期日 <QqqInfoTooltip label="情景输入与覆盖说明" content={dayScenarioCoverageLabel(scenarioField.coverage)}/></small>}
      <label><input type="checkbox" checked={heat} onChange={e=>setHeat(e.target.checked)}/>暴露热力图</label>
      <label><input aria-label="关键价位" type="checkbox" disabled={scenarioView} checked={keys} onChange={e=>setKeys(e.target.checked)}/>Call / Put 集中价位{scenarioView&&<small className={settingsStyles.scopeChip}>仅历史快照</small>}</label>
    </fieldset>
    <fieldset className={settingsStyles.section}>
      <legend>显示效果</legend>
      <label className={settingsStyles.row}>对比度<select aria-label="热力图对比度" value={contrast} onChange={e=>setContrast(e.target.value as HeatmapContrast)}><option value="enhanced">增强弱值（对数）</option><option value="absolute">线性绝对值</option></select></label>
      <small>两种色阶使用同一模式最大值；仅改变明暗，金额、正负与缺失格子保持真实。</small>
      <label className={settingsStyles.slider}>价格范围<input aria-label="热力图价格范围" type="range" min="5" max="40" step="0.1" value={radius} onChange={e=>setRadius(Number(e.target.value))}/><output>±{Number(radius.toFixed(1))}档</output></label>
      <label className={settingsStyles.slider}>颜色强度<input aria-label="热力图颜色强度" type="range" min="0.5" max="3" step="0.25" value={gain} onChange={e=>setGain(Number(e.target.value))}/><output>{gain.toFixed(2)}×</output></label>
      <label className={settingsStyles.slider}>渐变<input aria-label="热力图渐变强度" type="range" min="0" max="100" step="5" value={smooth} onChange={e=>setSmooth(Number(e.target.value))}/><output>{smooth}%</output></label>
      <div className={settingsStyles.toggles}>
        <label><input type="checkbox" checked={inverted} onChange={e=>setInverted(e.target.checked)}/>反转颜色</label>
      </div>
    </fieldset>
    <fieldset className={settingsStyles.section}>
      <legend>指标与事件 <QqqInfoTooltip label="结构变化与事件说明" content="复用已保存快照，无新增行情请求。最大变化比较同口径净 GEX；轨迹显示集中位及已有的所选到期日模型零点（合计不拼接单日零点）。事件基于已知关键位与已收盘价格；点击可回放。偏斜为 25Δ Put IV − Call IV；合计按 OI 加权。波动带随显示模式和到期日范围切换：历史模式使用各时刻快照；情景模式同时展示回放时刻之前各历史快照的波动带（实线）及该时刻快照向未来展开的预测带（虚线）。历史上下沿使用各自当时的价格与 ATM IV，不用当前输入回填。合计为仍未到期合约的各到期日波动带最外侧包络，不是合计置信区间。关键位轨迹、事件与 IV 偏斜仍为历史观察，不作为情景推演结果。偏斜使用虚值 Put / Call 的同快照价格、IV 和剩余期限重算 Delta（r=q=0），25Δ 两侧报价按方差插值。历史波动带为当时价格 ± 当时价格 × ATM IV × √剩余到期年限；情景预测带为输入价格 ± 输入价格 × ATM IV × √从输入时刻起的预测年限。两者均按 365 天年化，止于对应到期日的 QQQ 最后交易时间；不是价格目标或保证区间。缺失数据留空，均不代表开仓信号。"/></legend>
      <small>{scenarioView?'实线为回放时刻之前各快照的历史波动带；虚线与热图使用同一份输入向未来展开 1SD 预测。拖动计算中暂保留同一份已完成情景。':'波动带为各历史快照的剩余到期 1SD 范围；指标跟随历史快照与到期日范围。'}{scenarioView&&discovery.bands&&!scenario.loading&&!scenarioBands.rows.length?' 波动带缺少有效价格、ATM IV 或到期时间，暂不显示。':''}</small>
      {([['tracks','关键位历史轨迹','#c4a5ff'],['events','关键位事件标记','#fb923c'],['skew','IV 偏斜','#f472b6'],['bands','预期波动带','#d6e3f5']] as const).map(([key,label,color])=><label key={key}><input type="checkbox" checked={discovery[key]} onChange={e=>{const checked=e.currentTarget.checked;setDiscovery(previous=>({...previous,[key]:checked}));}}/><span className={settingsStyles.name}><i style={{background:color}} aria-hidden="true"/>{label}</span><small className={settingsStyles.scopeChip}>{key==='bands'?`${scenarioView?'历史变化 + 当前预测':'历史快照'} · ${scope==='all'?'可用合计 · 外侧包络':'所选到期日'}`:`${observedIndicatorLabel} · ${expiryScopeLabel}`}</small></label>)}
    </fieldset>
    <fieldset className={settingsStyles.section}>
      <legend>价格反应观察 <QqqInfoTooltip label="价格反应观察说明" content={<>复用 K 线观察规则，仅使用当时已收盘价格和可用快照；随回放更新。情景模式下仍为历史观察；观察区与标记不代表开仓信号。</>}/></legend>
      <small>{observedIndicatorLabel} · {expiryScopeLabel}</small>
      <label><input aria-label="结构观察 · 低点与反转标记" type="checkbox" checked={reactions.markers} onChange={e=>{const checked=e.currentTarget.checked;setReactions(previous=>({...previous,markers:checked}));}}/><span className={settingsStyles.name}><i style={{background:'#d4b16a'}} aria-hidden="true"/>结构标记</span></label>
      <label><input type="checkbox" checked={reactions.low} onChange={e=>{const checked=e.currentTarget.checked;setReactions(previous=>({...previous,low:checked}));}}/>支撑观察区</label>
      <label><input type="checkbox" checked={reactions.high} onChange={e=>{const checked=e.currentTarget.checked;setReactions(previous=>({...previous,high:checked}));}}/>阻力观察区</label>
    </fieldset>
    <fieldset className={settingsStyles.section}>
      <legend>叠加曲线 <QqqInfoTooltip label="Heatmap 叠加曲线说明" content={<>IV 仅使用现价两侧有效报价，缺少 ATM 报价时留空；合计使用各到期日 ATM IV 按全链 OI 加权平均。粉：Put / Call 为所选范围全行权价累计 Put 成交量 / Call 成交量，1 表示两侧相等；缺失、Call 为零或累计成交量回退时留空，不跨异常点连线。黄：VWAP（价格轴） · 紫：Delta（美元轴） · 青：IV（年化百分比轴）。跟随到期日范围与统一回放；情景模式下这些曲线仍为历史观察，不外推未来成交、价格或 IV。VWAP 仅使用标的成交，与到期日范围无关。缺失留空。Delta 为持仓模型，不是成交方向或 HIRO。VWAP 使用已收盘 K 线的典型价 × 成交量估算。</>}/></legend>
      <label><input aria-label="VWAP · 日内成交均价" type="checkbox" checked={overlays.vwap} onChange={e=>{const checked=e.currentTarget.checked;setOverlays(previous=>({...previous,vwap:checked}));}}/><span className={settingsStyles.name}><i style={{background:'#facc15'}} aria-hidden="true"/>VWAP</span><small className={settingsStyles.scopeChip}>{observedIndicatorLabel} · 标的成交</small></label>
      <label><input aria-label="模型净 Delta 暴露" type="checkbox" checked={overlays.delta} onChange={e=>{const checked=e.currentTarget.checked;setOverlays(previous=>({...previous,delta:checked}));}}/><span className={settingsStyles.name}><i style={{background:'#c4a5ff'}} aria-hidden="true"/>模型 Delta</span><small className={settingsStyles.scopeChip}>{observedIndicatorLabel} · {expiryScopeLabel}</small></label>
      <label><input aria-label={"ATM IV · "+(scope==='all'?'合计范围（OI 加权）':'所选到期日')} type="checkbox" checked={overlays.iv} onChange={e=>{const checked=e.currentTarget.checked;setOverlays(previous=>({...previous,iv:checked}));}}/><span className={settingsStyles.name}><i style={{background:'#2dd4bf'}} aria-hidden="true"/>ATM IV</span><small className={settingsStyles.scopeChip}>{observedIndicatorLabel} · {scope==='all'?'可用合计 · OI 加权':'所选到期日'}</small></label>
      <label><input aria-label={"Put / Call 成交比 · "+(scope==='all'?'合计范围':'所选到期日')} type="checkbox" checked={overlays.putCall} onChange={e=>{const checked=e.currentTarget.checked;setOverlays(previous=>({...previous,putCall:checked}));}}/><span className={settingsStyles.name}><i style={{background:'#f472b6'}} aria-hidden="true"/>Put / Call</span><small className={settingsStyles.scopeChip}>{observedIndicatorLabel} · {expiryScopeLabel}</small></label>
    </fieldset>
  </section>;
  const seekReplay=useCallback((next:number)=>{setPlaying(false);setCursor(frames[next]?.time??null);},[frames,setCursor]);
  const [observationWidth,setObservationWidth]=useState(320);
  const observationTarget=activityResponseTarget??activityHistoryTarget??indicatorObservationTarget;
  useEffect(()=>{
    if(!observationTarget)return;
    const observer=new ResizeObserver(([entry])=>{const width=Math.round(entry.contentRect.width);if(width>0)setObservationWidth(previous=>previous===width?previous:width);});
    observer.observe(observationTarget);return()=>observer.disconnect();
  },[observationTarget]);
  const observationLeft=40,observationRight=Math.max(50,observationWidth-65);
  const observationX=useCallback((time:number)=>observationLeft+(time-start)/(end-start)*(observationRight-observationLeft),[start,end,observationRight]);
  const structureObservations=<div className={styles.sidebarIndicators} aria-label="结构事件观察">
        <QqqObservationToolbar><label>比较窗口<select aria-label="最大变化行权价窗口" value={changeMinutes} onChange={e=>setChangeMinutes(Number(e.target.value))}>{[2,10,30].map(minutes=><option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label></QqqObservationToolbar>
        <DiscoveryPanels series={discoveryResult.series} flags={observationDiscoveryFlags} cutoff={cutoff} minutes={changeMinutes} onSeek={seekDiscovery} scope={scope} error={discoveryResult.error}/>
  </div>;
  const activityResponses=<div className={styles.sidebarIndicators} aria-label="活动响应观察">
        <QqqObservationToolbar><label>观察窗口<select aria-label="活动与再对冲观察窗口" value={observationMinutes} onChange={e=>setObservationMinutes(Number(e.target.value))}>{[2,10,30].map(minutes=><option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label></QqqObservationToolbar>
        <QqqHedgeObservationPanels series={hedgeResult.series} cutoff={cutoff} minutes={observationMinutes} flags={observationPanelFlags} width={observationWidth} plotLeft={observationLeft} plotRight={observationRight} x={observationX} loading={!hedgeResult.series&&!hedgeResult.error} error={hedgeResult.error} scopeLabel={scope==='all'?'可用到期日合计':selectedExpiry??'所选到期日'}/>
  </div>;
  const activityHistory=<section className={styles.sidebarIndicators} aria-label="成交活跃度历史"><QqqObservationHeading title="成交活跃度" meta="相邻快照新增成交 · 张"/>
        {activitySeries.some(point=>point.value)?<><svg viewBox={`0 0 ${observationWidth} 65`} className={styles.activityChart} role="img" aria-label="相邻快照成交活跃度">
          <text x={observationLeft} y="11" fill="#929cab" fontSize="10">新增成交（张）</text>
          <text x={observationLeft+100} y="11" fill="#60a5fa" fontSize="10">Call</text><text x={observationLeft+133} y="11" fill="#fb923c" fontSize="10">Put</text>
          <g aria-label="成交活跃度 Y 轴（张）">
            <line x1={observationRight} x2={observationRight} y1="15" y2="60" stroke="#52586a"/>
            {[0,.5,1].map(ratio=>{const tickY=60-ratio*45,value=activityMax*ratio;return <g key={ratio}>
              <line x1={observationLeft} x2={observationRight} y1={tickY} y2={tickY} stroke="#52586a" opacity={ratio===0?.5:.2} strokeDasharray={ratio===0?undefined:'3 4'}/>
              <line x1={observationRight} x2={observationRight+4} y1={tickY} y2={tickY} stroke="#929cab"/>
              <text x={observationRight+8} y={tickY+3} fill="#9ca3af" fontSize="9">{value>=1000?`${(value/1000).toFixed(1)}K`:value.toLocaleString()}</text>
            </g>;})}
          </g>
          {activitySeries.map(p=>p.value?<g key={p.time}><rect x={observationX(p.time)-2} y={60-p.value.call/activityMax*45} width="4" height={p.value.call/activityMax*45} fill="#60a5fa"/><rect x={observationX(p.time)+2} y={60-p.value.put/activityMax*45} width="4" height={p.value.put/activityMax*45} fill="#fb923c"/><title>{`${timeLabel(p.time)} ET · Call ${p.value.call} / Put ${p.value.put}`}</title></g>:null)}
        </svg><div className={styles.activity}><span>相邻快照新增成交 <b>{increment?increment.total.toLocaleString()+' 张':'数据不足'}</b></span>{increment&&<><div className={styles.activityBar}><i style={{width:increment.total?`${increment.call/increment.total*100}%`:'50%'}}/></div><span>Call {increment.call} / Put {increment.put}</span></>}<QqqInfoTooltip label="新增成交说明" content="相邻快照累计成交量之差；成交活跃度不代表买卖方向或新增持仓。缺失与成交量回退留空。"/></div></>:<QqqObservationEmpty>等待相邻快照中的有效成交记录。</QqqObservationEmpty>}

      <div className={styles.dataStrip}><span>{frames.length.toLocaleString()} 快照</span><span>振幅 <b>{volatility?volatility.rangePct.toFixed(2)+'%':'—'}</b></span><span>路径效率 <b>{volatility?(volatility.efficiency*100).toFixed(0)+'%':'—'}</b></span>{frame?.missing.length?<span className={styles.warningChip}>缺少 {frame.missing.length} 个到期日</span>:null}<QqqInfoTooltip label="快照与计算口径说明" content={<><p>观察所选范围的持仓集中位置，再看价格到达后的停留、拒绝或突破。Gamma 使用 Call 正、Put 负的持仓假设；Delta 与 Charm 沿用该假设，均不代表真实做市商账本。</p><p>柔化模式用双层渐变光带显示已有快照，不改变暴露数值，也不生成额外快照；光带边缘不代表新增持仓。关闭柔化可查看原始色块。没有快照的时间段保留空白。热力图展示各快照时保存的行权价暴露，不是未来价格情景投影；完整历史直接读取保存的全量行权价；口径或单位未知的旧 GEX 不参与历史比较。合计每轮采集仅在所需快照接收完成后发布一次，缺失到期日另行标记。旧 GEX 未记录口径时，使用已保存 OI / IV 在统一现价和时刻按 Call 正、Put 负模型重算为每 1% 价格变动美元暴露；不直接相加旧口径。OI 接收时间不等于持仓更新时间。白／黄／青标记分别为 10／30／60 分钟前最近的快照（只向前查找，最多相差五分钟，悬停显示实际时间）；缺失则不画。灰线为所选美东日期截至回放时刻、相同到期日覆盖、相同计算版本与单位下已记录的最小／最大值（至少两个快照），不代表连续全日极值。回放同步 K 线、矩阵、热力图、Gamma 地图、成交持仓和底部快照表；条件与提醒为独立复核，并标注参考时间。</p><p>近十分钟振幅和路径效率描述已发生的波动，不是未来稳定度概率。Yahoo 缺少逐笔成交、同期报价及参与者分类，因此不提供 HIRO、真实净持仓或做市商／客户切换。</p></>}/>{onLoadHistory&&<button type="button" disabled={historyLoading} onClick={()=>{setHistoryLoading(true);void onLoadHistory().finally(()=>setHistoryLoading(false));}}>{historyLoading?'正在补载…':'补载盘中快照'}</button>}</div>
  </section>;
  const replayControls=<div className={styles.replay} aria-label="到期日范围与快照回放"><label>到期日范围 <select aria-label="到期日范围" value={scope} disabled={allExpiries} title={allExpiries ? 'GEX 矩阵固定展示全部到期日' : undefined} onChange={e=>setScope(e.target.value as typeof scope)}>{!allExpiries&&<><option value="selected">所选到期日</option></>}<option value="all">{allExpiries ? '全部到期日' : '可用合计'}</option></select></label><span role="status">{archiveLoading?'读取历史… · ':framesLoading?'整理快照… · ':framesError?'快照整理失败 · ':aggregateLoading?'整理合计… · ':aggregateError?'合计整理失败 · ':archiveError?'历史不完整 · ':projectionLoading?'整理图表… · ':projectionError?projectionError+' · ':''}{cursor===null?(data.view.mode==='historical'||data.view.date!==qqqEasternDateKey(new Date())?'历史末帧':'跟随最新快照'):'历史回放'}</span>{archiveError&&<button type="button" onClick={retryArchive}>重试历史</button>}<button type="button" aria-label="回到首个快照" disabled={!frames.length} onClick={()=>{setCursor(frames[0]?.time??null);setPlaying(false);}}>◀◀</button><button type="button" disabled={frames.length<2} onClick={()=>{if(index===frames.length-1)setCursor(frames[0]?.time??null);setPlaying(p=>!p);}} aria-label={playing?'暂停回放':'播放回放'}>{playing?'Ⅱ':'▶'}</button><QqqReplaySlider resetKey={replayKey} max={Math.max(0,frames.length-1)} value={Math.max(0,requestedIndex)} onChange={seekReplay} formatValue={value=>frames[value]?`${data.view.date} ${timeLabel(frames[value]!.time)} 美东时间，第 ${value+1} / ${frames.length} 个快照`:'暂无快照'}/><button type="button" className={styles.latestButton} aria-pressed={cursor===null} title={cursor===null?'显示所选日期最后收到的快照':'退出回放，返回所选日期最后收到的快照'} onClick={()=>{setCursor(null);setPlaying(false);}}>最新</button><span>{frame?timeLabel(frame.time)+' ET':'—'}</span><select aria-label="播放速度" title="播放速度" value={playbackSpeed} onChange={event=>setPlaybackSpeed(Number(event.target.value))}>{[0.5,1,2,4,8].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></div>;
  return <div className={styles.root} aria-busy={archiveLoading||framesLoading||aggregateLoading||fieldLoading||scenario.loading} style={{display:active?'flex':'none'}}>
    {controlsTarget&&createPortal(replayControls,controlsTarget)}
    {distributionTarget&&createPortal(<section className={styles.sidebarIndicators}>
      <QqqObservationHeading title={metric==='gex'?'暴露分布':metric==='oi'?'持仓分布':'成交分布'} meta={scope==='all'?'可用到期日合计':'所选到期日'}/>
      <fieldset className={styles.distributionControls} aria-label="行权价分布显示设置">
        <legend>分布显示</legend>
        <label className={`${settingsStyles.slider} ${styles.settingSlider}`}>横条缩放<input aria-label="行权价横条缩放" type="range" min="0.5" max="2" step="0.1" value={barZoom} onChange={e=>setBarZoom(Number(e.target.value))}/><output>{barZoom.toFixed(1)}×</output></label>
        <label><input type="checkbox" checked={historyMarks} onChange={e=>setHistoryMarks(e.target.checked)}/>历史标记 · 10 / 30 / 60 分钟</label>
        <label><input type="checkbox" checked={dayRange} onChange={e=>setDayRange(e.target.checked)}/>当日已观察范围</label>
      </fieldset>
      <QqqHeatmapDataStatus coverage={distributionCoverage} definition={definition} history={historyStatus}/>
      {distributionSvg}
      <QqqObservationToolbar><label>统计指标<select aria-label="行权价分布统计指标" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="gex">净 GEX</option><option value="oi">Call OI − Put OI</option><option value="volume">成交量</option></select></label></QqqObservationToolbar>
    </section>,distributionTarget)}
    {timelineActive&&snapshotTableTarget&&<QqqExposureSnapshotTable rows={replayRows} index={index} target={snapshotTableTarget} followingLatest={cursor===null}/>}
    {active&&settingsTarget&&createPortal(settings,settingsTarget)}
    {timelineActive&&indicatorObservationTarget&&createPortal(structureObservations,indicatorObservationTarget)}
    {timelineActive&&activityResponseTarget&&createPortal(activityResponses,activityResponseTarget)}
    {timelineActive&&activityHistoryTarget&&createPortal(activityHistory,activityHistoryTarget)}
    {active&&<div className={styles.workbench}>
      <div className={styles.tabs} role="group" aria-label="Heatmap 模式">
        <button type="button" aria-pressed={!scenarioView} onClick={()=>setHeatmapView('history')}>历史快照</button>
        <button type="button" aria-pressed={scenarioView} onClick={()=>setHeatmapView('scenario')}>日内情景推演</button>
        <select aria-label="热图显示口径" value={scenarioView?scenarioMode:mode} onChange={e=>setMode(e.target.value as ExposureMode)}>{Object.entries(modeLabels).map(([key,label])=><option key={key} value={key} disabled={scenarioView&&!key.startsWith('gamma')}>{scenarioView&&key==='gamma'?'Gamma 贡献合计':label}</option>)}</select>
        <QqqInfoTooltip label="日内情景推演说明" content="“日内”指所选交易日的时间范围；纳入哪些合约由“到期日范围”决定。“可用合计”汇总可用到期日，不保证覆盖全部到期日；链覆盖状态显示数据完整程度。使用所选快照已知的固定 OI 与行权价 IV，在日内不同价格与时刻重新估值。输入截止之前的颜色同样为该快照推演的假设值；查看当时实际记录请切换“历史快照”。r=q=0，Call 正 / Put 负，不代表真实做市商账本。期权报价时间与 OI 结算日期尚未验证。回放切换输入快照，最新回到最后收到的快照；LIVE 价格只移动价格线，不重新估算持仓。"/>
      </div>
      {scenarioView&&!scenario.loading&&(scenario.error||scenarioField?.reason)&&<div className={styles.loadStatus} role="status">{scenario.error??scenarioField?.reason}{scenario.error&&<button type="button" onClick={scenario.retry}>重试情景</button>}</div>}
      {(archiveLoading||archiveError||(!scenarioView&&(fieldLoading||fieldError)))&&<div className={styles.loadStatus} role="status" aria-live="polite">{archiveLoading?<><span className={styles.spinner} aria-hidden="true"/>正在读取 {data.view.date} · {archiveExpiry??'全部到期日'} 的完整历史…</>:archiveError?<>{archiveError}<button type="button" onClick={()=>retryArchive()}>重试</button></>:fieldError??<><span className={styles.spinner} aria-hidden="true"/>{fieldLoading?'正在整理可见行权价…':'正在绘制回放…'}</>}</div>}
      {!hasChart?<div className={styles.empty} role="status">{archiveLoading?'正在读取所选日期与到期日存档…':archiveError??'所选范围没有行权价快照。等待采集或选择其他到期日。'}</div>:<>
        <div ref={chartViewport} className={styles.chartViewport} tabIndex={chartSize.width>viewportSize.width?0:undefined} aria-label={chartSize.width>viewportSize.width?'图表可横向滚动，查看完整指标刻度':undefined}>{chartSvg}
          {strikeHover&&hoveredComparison&&<div className={styles.strikeTooltip} role="tooltip" style={{left:Math.max(8,Math.min(chartSize.width-Math.min(290,chartSize.width-16)-8,strikeHover.x+14)),top:Math.max(8,Math.min(chartSize.height-240,strikeHover.y+12))}}>
            <strong>行权价 {strikeHover.strike} · {metric==='gex'?'净 GEX':metric==='oi'?'Call OI − Put OI':'成交量'}</strong>
            <small>{data.view.date} · {scope==='all'?'可用到期日合计':selectedExpiry+' 到期'}</small>
            <div><span>当前 · {timeLabel(cutoff)} ET</span><b>{metricValue(hoveredComparison.current)}</b></div>
            {historyMarks&&hoveredComparison.history.map(h=><div key={h.minutes}><span><i style={{background:historyColors[h.minutes]}}/>{h.minutes} 分钟前{h.value!=null&&h.time!=null?` · ${timeLabel(h.time)}`:''}</span><b>{metricValue(h.value)}</b></div>)}
            {dayRange&&<><div><span>当日最小</span><b>{metricValue(hoveredComparison.range?.min)}</b></div><div><span>当日最大</span><b>{metricValue(hoveredComparison.range?.max)}</b></div><small>{hoveredComparison.range?`${timeLabel(hoveredComparison.range.from)}–${timeLabel(hoveredComparison.range.to)} ET · ${hoveredComparison.range.count} 个有效快照`:'至少需要两个同口径有效快照'}</small></>}
            {metric==='gex'&&gexUnit==='unknown'&&<small>旧记录未注明 GEX 口径，历史点与范围暂不比较</small>}
            <small>截至回放时刻的已观察值{barZoom>1?' · 超出缩放范围的标记位于边缘':''}</small>
          </div>}
        </div>
        <div className={styles.hover} aria-live="polite">{scenarioView?<span>{scenario.loading?(scenario.retained?`显示输入 ${timeLabel(scenarioDisplayedAt)} ET · 等待 ${timeLabel(scenarioInput.observationAt)} ET 情景`:'正在推演日内情景…'):(scenario.error||scenarioField?.reason)?null:<span className={styles.visualLegend}>输入有效 {scenarioField?.coverage.validSides??0}/{scenarioField?.coverage.totalSides??0} 侧{scenarioField?.coverage.partial?' · 缺失贡献未知':''} <QqqInfoTooltip label="情景输入与覆盖说明" content={scenarioField?dayScenarioCoverageLabel(scenarioField.coverage)+'。固定所选快照的 OI / IV，整日颜色为假设情景，非历史实测；不补造缺失输入，接收时间不等于期权报价时间。':'等待有效快照'}/></span>}</span>:fieldLoading?'正在整理可见行权价…':fieldError??(!hasFrame?'当日 GEX 快照待更新，已显示价格行情。':!validCells?'当前模式没有可验证的暴露值；可查看有效分侧或其他到期日。':<span className={styles.visualLegend}><span><i style={{background:inverted?'#fb923c':'#60a5fa'}}/>正暴露</span><span><i style={{background:inverted?'#60a5fa':'#fb923c'}}/>负暴露</span>{chartCoverage&&<span>当前有效 {chartCoverage.valid}/{chartCoverage.total} · 缺失留空</span>}<QqqInfoTooltip label="暴露图例说明" content={mode.startsWith('gamma')?'缺失区域留空，零值与极小值同样接近底色，悬停或用方向键查看原始数值与缺失原因。Call / Put 视图独立展示有效侧，净 Gamma 需要两侧有效。快照接收时间不等于期权报价时间。Gamma 使用 Call 正 / Put 负持仓假设。':mode==='delta'?'Delta 存量估算，固定 OI / IV。':'Charm 固定价格、OI / IV，估算一分钟 Delta 变化。'}/></span>)}</div>
        {!controlsTarget&&replayControls}
      </>}

    </div>}
  </div>;
}

export default memo(QqqExposureWorkbench);
