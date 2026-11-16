'use client';
import { withQqqDisplayEvidence, type QqqDisplayEvidence } from '@/lib/qqqDisplayEvidence';
import { parseQqqGexDateMode, resolveQqqGexDateSelection } from '@/lib/qqqGexDateSelection';
import { qqqSessionForDate } from '@/lib/qqqMarketSession';
import { qqqShareValue } from '@/lib/qqqTimelineMerge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqDirectionalReplayApiResponse } from '@/types/qqqGex';
import { qqqEasternDateKey as easternDateKey } from '@/lib/qqqMarketDate';
import { preloadQqqExposureArchive } from '@/lib/qqqExposureArchiveClient';
import type { ExposureHistoryDay } from '@/lib/qqqExposureHistoryModel';
import { createQqqHistoryClient, readQqqHistoryClient } from '@/lib/qqqHistoryClient';
import { GEX_LOAD_WINDOW_MS, qqqGexDateBounds, qqqGexRefreshInterval, canReuseClosedGexExpiry, mergeGexWindows, missingGexProfileWindow, historicalGexDisplayPayload, buildHistoricalGexExpiries, type HistoricalGexRow } from '@/lib/qqqGexDisplayState';
import { startQqqRefreshLoop } from '@/lib/qqqRefreshLoop';
import { useStoredPreference } from './useStoredPreference';
import { parseQqqGexDatePreference } from '@/lib/qqqGexSelection';

// Keep lightweight polling and complete archives in separate bounded caches.
const readGexDisplayClient = createQqqHistoryClient();
const CLOSED_HISTORY_TTL_MS = 15 * 60_000;
const historyOptions = (date: string) => ({ ttlMs: date < easternDateKey(new Date()) ? CLOSED_HISTORY_TTL_MS : 30_000 });
const timestamp = (point: { time?: string; timestamp?: string; date?: string }) => Date.parse(point.time ?? point.timestamp ?? point.date ?? '');
const hasIntradayBars = (data: QqqPcsApiResponse) => Boolean(data.intraday?.granularity === '2m' && data.intraday.bars.length);

/** Owns display request lifecycle; pure projections remain in lib. */
export function useQqqGexDisplayData(selectedExpiry: string | null, setSelectedExpiry: (expiry: string | null) => void, chartMode: 'candles' | 'matrix' | 'heatmap' | null) {
  const [conditionsRequested,setConditionsRequested]=useState(false);
  const [conditionsLoading,setConditionsLoading]=useState(false);
  const [conditionsError,setConditionsError]=useState<string | null>(null);
  const [conditionsRetry,setConditionsRetry]=useState(0);
  const [evidenceRetryAttempt,setEvidenceRetryAttempt]=useState(0);
  const conditionsRetryConsumed = useRef(0);
  const [windowLoading,setWindowLoading]=useState(false);
  const [windowError,setWindowError]=useState<{from:number;to:number;message:string}|null>(null);
  const [historyStartReached,setHistoryStartReached]=useState(false);
  const [replayLoading,setReplayLoading]=useState(false);
  const [replayError,setReplayError]=useState<string|null>(null);
  const [replayRetry,setReplayRetry]=useState(0);
  const [conditionsData,setConditionsData]=useState<QqqPcsApiResponse|null>(null);
  const [monitorEvidence,setMonitorEvidence]=useState<QqqDisplayEvidence|null>(null);
  const [evidenceLoading,setEvidenceLoading]=useState(false);
  const [evidenceError,setEvidenceError]=useState<string|null>(null);
  const detailRetryConsumed=useRef(0);
  const [evidenceScope, setEvidenceScope] = useState<string | null>(null);
  const requestConditions=useCallback(()=>setConditionsRequested(true),[]);
  const closeConditions=useCallback(()=>setConditionsRequested(false),[]);
  const [cachedData, setCachedData] = useState<QqqPcsApiResponse | null>(null);
  const [gexDates, setGexDates] = useState<string[]>([]);
  const [selectedGexDate, setSelectedGexDate, datePreferenceReady] = useStoredPreference<string | null>('qqq-gex:snapshot-date:v1', null, parseQqqGexDatePreference);
  const [dateMode, setDateMode, dateModeReady] = useStoredPreference<'follow' | 'fixed' | null>('qqq-gex:date-mode:v1', null, parseQqqGexDateMode);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const selectGexDate = useCallback((date: string | null) => {
    setDateMode(!date || date === (cachedData?.view.date ?? gexDates.at(-1)) ? 'follow' : 'fixed');
    if (date === selectedGexDate) return;
    // A DTE choice belongs to its session. Reset it atomically with the day,
    // rather than requesting an expired contract in the new session.
    setSelectedExpiry(null);
    setSelectedGexDate(date);
  }, [selectedGexDate, setSelectedExpiry, cachedData?.view.date, gexDates, setDateMode, setSelectedGexDate]);
  const [historicalData, setHistoricalData] = useState<QqqPcsApiResponse | null>(null);
  const [historicalReplay, setHistoricalReplay] = useState<QqqDirectionalReplayApiResponse | null>(null);
  const [discoveryReplay, setDiscoveryReplay] = useState<QqqDirectionalReplayApiResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [latestRefreshing, setLatestRefreshing] = useState(false);
  const [latestLoading, setLatestLoading] = useState(true);
  const [datesLoading, setDatesLoading] = useState(true);
  const [researchRequested, setResearchRequested] = useState(false);
  const requestResearch = useCallback(() => setResearchRequested(true), []);
  const [discoveryReplayLoading, setDiscoveryReplayLoading] = useState(false);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const loadedWindows = useRef(new Map<string, number>());
  const cachedDataRef = useRef<QqqPcsApiResponse | null>(null);
  useEffect(() => { cachedDataRef.current = cachedData; }, [cachedData]);
  const discoveryReplayRequestedRef = useRef(false);
  const legacyFallbacks = useRef(new Set<string>());
  const historicalArchiveWarm = useRef<ExposureHistoryDay|null>(null);
  const chartModeRef = useRef(chartMode);
  useEffect(()=>{chartModeRef.current=chartMode;},[chartMode]);
  const historicalRequest = useRef(0);
  const historicalAbort=useRef<AbortController|null>(null);
  const latestInFlight = useRef<{expiry:string|null;pending:boolean}>({expiry:null,pending:false});
  const latestRequest = useRef(0);
  const latestAbort = useRef<AbortController | null>(null);
  const liveSelection = useRef<string | null>(null);
  const windowAborts = useRef(new Map<string, AbortController>());
  const loadWindowRef = useRef<(from: number, to: number, replace?: boolean) => Promise<void>>(async () => undefined);
  const loadWindow = useCallback(async (from: number, to: number, replace = false) => {
    if (!navigator.onLine) return;
    const expiry = selectedExpiry ? `&gexExpiry=${encodeURIComponent(selectedExpiry)}` : '';
    const key = `${selectedExpiry ?? 'default'}:${from}:${to}`;
    if (inFlight.current.has(key) || (!replace && (loadedWindows.current.get(key) ?? 0) > Date.now())) return;
    inFlight.current.add(key);
    setWindowLoading(true); setWindowError(null);
    const controller = new AbortController();
    windowAborts.current.set(key, controller);
    try {
      const payload = await readGexDisplayClient<QqqPcsApiResponse>(`/api/analysis/qqq/pcs?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}&gexDisplay=1&gexOverview=1${expiry}`, { ttlMs: CLOSED_HISTORY_TTL_MS, signal: controller.signal, force: replace });
      if (liveSelection.current !== selectedExpiry) return;
      loadedWindows.current.set(key, Date.now() + CLOSED_HISTORY_TTL_MS);
      while (loadedWindows.current.size > 32) loadedWindows.current.delete(loadedWindows.current.keys().next().value!);
      setCachedData((current) => {
        const next = mergeGexWindows(current, payload, selectedExpiry);
        return qqqShareValue(current, next);
      });
    } catch (error) { if (!controller.signal.aborted) setWindowError({from,to,message:error instanceof Error ? error.message : '历史补载失败'}); }
    finally { inFlight.current.delete(key); windowAborts.current.delete(key); setWindowLoading(inFlight.current.size > 0); }
  }, [selectedExpiry]);
  const loadLatestWindow = useCallback(async (replace = false, force = false) => {
    if(!force&&canReuseClosedGexExpiry(cachedDataRef.current,selectedExpiry)){
      latestAbort.current?.abort();latestRequest.current++;
      latestInFlight.current={expiry:selectedExpiry,pending:false};
      setLatestLoading(false);setLatestRefreshing(false);setLatestError(null);return;
    }
    if (!force && latestInFlight.current.pending && latestInFlight.current.expiry === selectedExpiry && !latestAbort.current?.signal.aborted) return;
    latestInFlight.current = {expiry:selectedExpiry,pending:true};
    const expiry = selectedExpiry ? `&gexExpiry=${encodeURIComponent(selectedExpiry)}` : '';
    const token = ++latestRequest.current;
    latestAbort.current?.abort();
    const controller = new AbortController();
    latestAbort.current = controller;
    setLatestRefreshing(true);
    if (replace || cachedDataRef.current === null) setLatestLoading(true);
    try {
      const ttlMs = qqqGexRefreshInterval() || 5 * 60_000;
      let payload = await readGexDisplayClient<QqqPcsApiResponse>(`/api/analysis/qqq/pcs?gexWindow=latest&gexDisplay=1&gexOverview=1${expiry}`, { ttlMs, signal: controller.signal, force });
      if (token !== latestRequest.current) return;
      // 某些盘中 Yahoo 桶尚未同步而 GEX 快照已存在时，窗口裁切会得到空 bar。
      // 这时只回退一次既有接口，优先保证图表可用；正常路径仍保持小窗口传输。
      const fallbackKey = `${easternDateKey(new Date().toISOString())}:${selectedExpiry ?? 'default'}`;
      if (!hasIntradayBars(payload) && !legacyFallbacks.current.has(fallbackKey)) {
        legacyFallbacks.current.add(fallbackKey);
        if (legacyFallbacks.current.size > 32) legacyFallbacks.current.delete(legacyFallbacks.current.values().next().value!);
        const legacyPayload = await readGexDisplayClient<QqqPcsApiResponse>(`/api/analysis/qqq/pcs?gexDisplay=1&gexOverview=1${expiry}`, { ttlMs, signal: controller.signal, force });
        if (hasIntradayBars(legacyPayload)) payload = legacyPayload;
      }
      if (token !== latestRequest.current) return;
      setCachedData((current) => {
        const next = mergeGexWindows(current, payload, selectedExpiry);
        return qqqShareValue(current, next);
      });
      setLatestError(null);
    } catch (error) {
      if (token === latestRequest.current) setLatestError(error instanceof Error ? error.message : '最新 GEX 加载失败');
    } finally { if (token === latestRequest.current) { latestInFlight.current.pending=false; setLatestLoading(false); setLatestRefreshing(false); } }
  }, [selectedExpiry]);
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const now = new Date();
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - 10);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setUTCDate(to.getUTCDate() + 30);
    to.setUTCHours(0, 0, 0, 0);
    setDatesLoading(true);
    const load = async (attempt: number) => {
      try {
        const payload = await readQqqHistoryClient<{ dates?: string[] }>(`/api/analysis/qqq/pcs/backtest?stream=dates&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&page=1&pageSize=1`, { ttlMs: 5 * 60_000, signal: controller.signal });
        if (!controller.signal.aborted) { setGexDates(current => [...new Set([...current, ...(payload.dates ?? [])])].sort()); setDatesLoaded(true); setDatesLoading(false); }
      } catch {
        if (controller.signal.aborted) return;
        if (attempt < 2) retryTimer = setTimeout(() => void load(attempt + 1), 2000 * (attempt + 1));
        else setDatesLoading(false);
      }
    };
    void load(0);
    return () => { controller.abort(); if (retryTimer) clearTimeout(retryTimer); };
  }, []);
  useEffect(() => {
    const date = cachedData?.view.date;
    if (!date || !cachedData?.intraday?.gexExpiries?.some(expiry => expiry.fullGexProfile?.length)) return;
    setGexDates(current => current.includes(date) ? current : [...current, date].sort());
  }, [cachedData]);
  useEffect(() => {
    if (!datePreferenceReady || !gexDates.length || !cachedData?.view.date || discoveryReplayRequestedRef.current) return;
    discoveryReplayRequestedRef.current = true;
    setSelectedGexDate((current) => current ?? cachedData.view.date);
  }, [datePreferenceReady, gexDates, cachedData?.view.date, setSelectedGexDate]);
  useEffect(() => {
    const latestDate = cachedData?.view.date;
    if (!datePreferenceReady || !dateModeReady || !latestDate) return;
    const next = resolveQqqGexDateSelection(dateMode, selectedGexDate, latestDate);
    if (dateMode !== next.mode) setDateMode(next.mode);
    if (next.resetExpiry) { setSelectedExpiry(null); setSelectedGexDate(next.date); }
  }, [cachedData?.view.date, datePreferenceReady, dateModeReady, dateMode, selectedGexDate, setDateMode, setSelectedExpiry, setSelectedGexDate]);
  useEffect(() => {
    // Validate only against a successfully loaded index; an index request
    // failure must not erase a saved historical selection.
    if (!datePreferenceReady || !datesLoaded || !selectedGexDate || selectedGexDate === cachedData?.view.date || gexDates.includes(selectedGexDate)) return;
    selectGexDate(cachedData?.view.date ?? gexDates.at(-1) ?? null);
  }, [datePreferenceReady, datesLoaded, selectedGexDate, cachedData?.view.date, gexDates, selectGexDate]);
  useEffect(() => {
    if (!researchRequested || !gexDates.length) return;
    // Research summaries are server-materialized after 32 calendar days. Keep
    // the live console on a bounded rolling window; the date rail remains full.
    const researchStartDate = gexDates[Math.max(0, gexDates.length - 32)]!;
    const first = qqqGexDateBounds(researchStartDate).from;
    const last = qqqGexDateBounds(gexDates.at(-1)!).to;
    const controller = new AbortController();
    setDiscoveryReplayLoading(true);
    void readQqqHistoryClient<QqqDirectionalReplayApiResponse>(`/api/analysis/qqq/pcs/backtest?stream=signals&from=${encodeURIComponent(first)}&to=${encodeURIComponent(last)}&page=1&pageSize=200`, { ttlMs: 5 * 60_000, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDiscoveryReplay(value); })
      .catch(() => { if (!controller.signal.aborted) setDiscoveryReplay(null); })
      .finally(() => { if (!controller.signal.aborted) setDiscoveryReplayLoading(false); });
    return () => controller.abort();
  }, [gexDates, researchRequested]);
  const loadHistoricalDate = useCallback(async (date: string, force = false) => {
    const base = cachedDataRef.current;
    historicalAbort.current?.abort();
    const controller=new AbortController(); historicalAbort.current=controller;
    const token = ++historicalRequest.current;
    historicalArchiveWarm.current=null;
    setHistoricalLoading(true);
    setHistoricalError(null); setReplayError(null);
    try {
      const { from, to } = qqqGexDateBounds(date);
      const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=1&pageSize=200`;
      const options = {...historyOptions(date),signal:controller.signal,force};
      const dayPromise = readQqqHistoryClient<{items:HistoricalGexRow[];expiries:HistoricalGexRow[];bars:NonNullable<QqqPcsApiResponse['intraday']>['bars'];selectedExpiry:string;gammaModels?:NonNullable<QqqPcsApiResponse['intraday']>['gammaModels'];gammaPositionHistory?:NonNullable<QqqPcsApiResponse['intraday']>['gammaPositionHistory']}>(`/api/analysis/qqq/gex/day?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${selectedExpiry?`&expiryDate=${encodeURIComponent(selectedExpiry)}`:''}`, options);
      // Bootstrap only the cheap guide/prices in parallel. Heavy profile reads
      // wait for the day request so they cannot starve its short DB deadlines.
      void preloadQqqExposureArchive(date,selectedExpiry,chartModeRef.current==='matrix',readQqqHistoryClient,{...options,beforeProfiles:()=>dayPromise}).then(day=>{
        if(token===historicalRequest.current&&!controller.signal.aborted)historicalArchiveWarm.current=day;
      },()=>{});
      setReplayLoading(true);
      const signalsPromise = readQqqHistoryClient<QqqDirectionalReplayApiResponse>(`/api/analysis/qqq/pcs/backtest?stream=signals&${query}`, options).catch(() => null);
      setHistoricalReplay(null);
      const day = await dayPromise;
      if (token !== historicalRequest.current) return;
      const expiry=day.selectedExpiry;
      if (!expiry) throw new Error('该日期缺少可用 GEX');
      const gexPayload={items:day.items};
      const index={items:day.expiries};
      const barsPayload={bars:day.bars};
      const rows = ((gexPayload.items ?? []) as HistoricalGexRow[]).filter((row) => easternDateKey(row.capturedAt) === date);
      const detailed = buildHistoricalGexExpiries(rows);
      const summaries = buildHistoricalGexExpiries(index.items);
      const expiries = summaries.map(summary => detailed.find(item => item.expiryDate === summary.expiryDate) ?? summary);
      const bars = (barsPayload.bars ?? []).filter((bar: { timestamp: string }) => easternDateKey(bar.timestamp) === date);
      const historicalPayload = historicalGexDisplayPayload(base, date, expiries, bars, expiry);
      if (historicalPayload.intraday) { historicalPayload.intraday.gammaModels = day.gammaModels; historicalPayload.intraday.gammaPositionHistory = day.gammaPositionHistory; }
      setHistoricalData(historicalPayload);
      void signalsPromise.then(signalsPayload => {
        if (token !== historicalRequest.current) return;
        setReplayLoading(false); setHistoricalReplay(signalsPayload);
        if (!signalsPayload) setReplayError('该日期方向回放不可用，当前仅展示已保存的 GEX 与 K 线');
      });
    } catch (error) {
      if (token !== historicalRequest.current) return;
      setHistoricalData(current => current?.view.date === date ? current : null);
      setHistoricalReplay(null); setReplayLoading(false);
      setHistoricalError(error instanceof Error ? error.message : '历史日期回放加载失败');
    } finally {
      if (token === historicalRequest.current) setHistoricalLoading(false);
    }
  }, [selectedExpiry]);
  useEffect(() => {
    if (!datePreferenceReady || !dateModeReady || !selectedGexDate || dateMode === 'follow' || dateMode !== 'fixed' && (!cachedData?.view.date || selectedGexDate === cachedData.view.date)) { historicalRequest.current++; historicalArchiveWarm.current=null; setHistoricalData(null); setHistoricalReplay(null); setReplayLoading(false); setReplayError(null); setHistoricalLoading(false); setHistoricalError(null); return; }
    const requestVersion=historicalRequest; const abortRef=historicalAbort; const warmRef=historicalArchiveWarm;
    void loadHistoricalDate(selectedGexDate);
    return ()=>{requestVersion.current++;abortRef.current?.abort();warmRef.current=null;};
  }, [cachedData?.view.date, datePreferenceReady, dateModeReady, dateMode, loadHistoricalDate, selectedGexDate]);
  const historicalView = Boolean(selectedGexDate && (dateMode === 'fixed' || dateMode !== 'follow' && cachedData?.view.date && selectedGexDate !== cachedData.view.date));
  useEffect(() => {
    const controllers = windowAborts.current;
    return () => { for (const controller of controllers.values()) controller.abort(); };
  }, [selectedExpiry, historicalView]);
  useEffect(() => {
    // 到期日切换时保留当前图表实例，等新快照完整替换后再更新，避免 KLine
    // 被卸载重建导致时间轴/价格轴丢失、四个副图闪烁和 overlay 短暂消失。
    const requestVersion = latestRequest;
    const abortRef = latestAbort;
    liveSelection.current = historicalView ? 'historical' : selectedExpiry;
    if (!datePreferenceReady || !dateModeReady) return;
    if (historicalView) { latestRequest.current++; latestAbort.current?.abort(); setLatestLoading(false); return; }
    void loadLatestWindow(cachedDataRef.current === null);
    const stop=startQqqRefreshLoop(()=>loadLatestWindow(),qqqGexRefreshInterval);
    return () => { stop(); requestVersion.current++; abortRef.current?.abort(); };
  }, [loadLatestWindow, historicalView, selectedExpiry, datePreferenceReady, dateModeReady]);
  useEffect(() => { loadWindowRef.current = loadWindow; }, [loadWindow]);
  useEffect(() => {
    if (historicalView || !cachedData || chartMode!=='candles') return;
    const missing = missingGexProfileWindow(cachedData, selectedExpiry);
    if (missing) void loadWindow(missing.from, missing.to);
  }, [cachedData, historicalView, loadWindow, selectedExpiry,chartMode]);
  const onVisibleTimeRangeChange = useCallback((range: { from: number; to: number }) => {
    if (historicalView || chartMode!=='candles') return;
    const cached = cachedDataRef.current;
    const earliest = cached?.intraday?.bars[0] ? timestamp(cached.intraday.bars[0]) : NaN;
    const regularOpen = Date.parse(qqqGexDateBounds(cached?.view.date ?? easternDateKey(new Date().toISOString())).from) + 240 * 60_000;
    if (earliest <= regularOpen && range.from <= earliest + 15 * 60_000) setHistoryStartReached(true);
    if (Number.isFinite(earliest) && range.from <= earliest + 15 * 60_000 && earliest > regularOpen) void loadWindowRef.current(Math.max(regularOpen, earliest - GEX_LOAD_WINDOW_MS), earliest - 1);
  }, [historicalView,chartMode]);
  const selectExpiry = useCallback((expiry: string) => {
    const active = selectedExpiry ?? (historicalView ? historicalData : cachedData)?.intraday?.gexExpiries?.[0]?.expiryDate;
    if (expiry !== active) {
      const first = (historicalView ? historicalData : cachedData)?.intraday?.gexExpiries?.[0]?.expiryDate;
      setSelectedExpiry(expiry === first ? null : expiry);
    }
  }, [selectedExpiry, setSelectedExpiry, historicalView, historicalData, cachedData]);
  const displayError = historicalView ? historicalError : latestError;
  const displayData = useMemo(() => historicalView ? historicalData : withQqqDisplayEvidence(cachedData, evidenceScope === (selectedExpiry ?? 'default') ? monitorEvidence : null), [historicalView, historicalData, cachedData, evidenceScope, selectedExpiry, monitorEvidence]);
  useEffect(()=>{
    if(historicalView || !cachedData?.asOf)return;
    let active=true;
    const controller = new AbortController();
    const expiry=selectedExpiry?`&gexExpiry=${encodeURIComponent(selectedExpiry)}`:'';
    // An explicit retry bypasses cache once. Later live snapshots and DTE
    // switches must return to normal reuse instead of forcing every request.
    const force = conditionsRetry > conditionsRetryConsumed.current;
    conditionsRetryConsumed.current = conditionsRetry;
    setEvidenceLoading(true); setEvidenceError(null);
    void readGexDisplayClient<QqqDisplayEvidence>(`/api/analysis/qqq/pcs?gexDisplay=1&gexEvidence=1&gexWindow=latest${expiry}`,{ttlMs:qqqGexRefreshInterval()||300000, signal:controller.signal, force})
      .then(value=>{if(active){setMonitorEvidence(value);setEvidenceScope(selectedExpiry ?? 'default');}})
      .catch(()=>{if(active && !controller.signal.aborted)setEvidenceError('条件详情暂不可用，其余图表可继续查看。');})
      .finally(()=>{if(active)setEvidenceLoading(false);});
    return()=>{active=false;controller.abort();};
  },[historicalView,selectedExpiry,cachedData?.asOf,conditionsRetry]);
  useEffect(()=>{
    if(!conditionsRequested || historicalView || !cachedData?.asOf){setConditionsLoading(false);return;}
    const controller=new AbortController();
    const force=conditionsRetry>detailRetryConsumed.current;detailRetryConsumed.current=conditionsRetry;
    const expiry=selectedExpiry?`&gexExpiry=${encodeURIComponent(selectedExpiry)}`:'';
    setConditionsLoading(true);setConditionsError(null);
    void readGexDisplayClient<QqqPcsApiResponse>(`/api/analysis/qqq/pcs?gexDisplay=1&gexWindow=latest${expiry}`,{ttlMs:qqqGexRefreshInterval()||300000,signal:controller.signal,force})
      .then(value=>{if(!controller.signal.aborted)setConditionsData(value);})
      .catch(()=>{if(!controller.signal.aborted)setConditionsError('条件详情暂不可用，其余图表可继续查看。');})
      .finally(()=>{if(!controller.signal.aborted)setConditionsLoading(false);});
    return()=>controller.abort();
  },[conditionsRequested,historicalView,selectedExpiry,cachedData?.asOf,conditionsRetry]);
  useEffect(()=>{setEvidenceRetryAttempt(0);},[selectedExpiry,selectedGexDate,cachedData?.asOf]);
  useEffect(()=>{
    if(!evidenceError||evidenceLoading||offline||historicalView||evidenceRetryAttempt>=3)return;
    const timer=setTimeout(()=>{
      setEvidenceRetryAttempt(attempt=>attempt+1);
      setConditionsRetry(retry=>retry+1);
    },[3000,8000,20000][evidenceRetryAttempt]);
    return()=>clearTimeout(timer);
  },[evidenceError,evidenceLoading,offline,historicalView,evidenceRetryAttempt]);
  useEffect(() => { setConditionsData(null); setConditionsError(null); setWindowError(null); setHistoryStartReached(false); }, [selectedExpiry, selectedGexDate]);
  useEffect(() => {
    if (!replayRetry || !historicalView || !selectedGexDate) return;
    const controller = new AbortController(); setReplayLoading(true); const {from,to}=qqqGexDateBounds(selectedGexDate);
    void readQqqHistoryClient<QqqDirectionalReplayApiResponse>(`/api/analysis/qqq/pcs/backtest?stream=signals&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=1&pageSize=200`,{signal:controller.signal,force:true})
      .then(value=>{if(!controller.signal.aborted){setHistoricalReplay(value);setReplayError(null);}}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setReplayLoading(false);});
    return()=>controller.abort();
  },[replayRetry,historicalView,selectedGexDate]);
  const pendingDisplay = historicalView ? historicalLoading : latestRefreshing;
  const retryDisplay = useCallback(() => {
    if (historicalView && selectedGexDate) void loadHistoricalDate(selectedGexDate, true);
    else void loadLatestWindow(false, true);
  }, [historicalView, selectedGexDate, loadHistoricalDate, loadLatestWindow]);
  const retryRef = useRef(retryDisplay);
  retryRef.current = retryDisplay;
  useEffect(() => {
    setOffline(!navigator.onLine);
    const disconnected = () => setOffline(true);
    const connected = () => { setOffline(false); setRetryAttempt(0); retryRef.current(); };
    window.addEventListener('offline', disconnected); window.addEventListener('online', connected);
    return () => { window.removeEventListener('offline', disconnected); window.removeEventListener('online', connected); };
  }, []);
  useEffect(() => { setRetryAttempt(0); }, [selectedGexDate, selectedExpiry]);
  useEffect(() => {
    if (!displayError) { if (!pendingDisplay) setRetryAttempt(0); return; }
    if (offline || pendingDisplay || retryAttempt >= 3 || displayError.includes('方向回放不可用')) return;
    const timer = setTimeout(() => { setRetryAttempt(value => value + 1); retryRef.current(); }, [3000, 8000, 20000][retryAttempt]);
    return () => clearTimeout(timer);
  }, [displayError, offline, pendingDisplay, retryAttempt]);
  const loadHeatmapHistory = useCallback(async () => {
    const day = displayData?.view.date;
    if (!day || historicalView) return;
    const start = Date.parse(qqqGexDateBounds(day).from) + 570 * 60_000;
    const end = Math.min(start + (qqqSessionForDate(day).optionCloseMinute - 570) * 60_000, Date.parse(displayData.observedAt ?? displayData.asOf));
    for (let from = start; from <= end; from += GEX_LOAD_WINDOW_MS) {
      if (liveSelection.current !== selectedExpiry) break;
      await loadWindow(from, Math.min(end, from + GEX_LOAD_WINDOW_MS - 1));
    }
  }, [displayData, historicalView, selectedExpiry, loadWindow]);
  return { conditionsLoading:conditionsLoading||evidenceLoading, conditionsError:conditionsError??evidenceError, setConditionsRetry, requestConditions, closeConditions, conditionsData, windowLoading, windowError, historyStartReached, replayLoading, replayError, setReplayRetry, gexDates, selectedGexDate, setSelectedGexDate: selectGexDate, historicalReplay, discoveryReplay, offline, retryAttempt, setRetryAttempt, latestLoading, datesLoading, requestResearch, discoveryReplayLoading, historicalLoading, latestError, historicalView, displayError, displayData, pendingDisplay, retryDisplay, loadWindow, onVisibleTimeRangeChange, selectExpiry, loadHeatmapHistory };
}
