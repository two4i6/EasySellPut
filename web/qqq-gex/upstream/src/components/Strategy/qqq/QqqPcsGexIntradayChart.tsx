'use client';
import {qqqGexObservation,compareQqqGexDisplayObservations as compareQqqGexObservations,type GexObservationSnapshot,type GexObservationStrike} from '@/lib/qqqGexObservationComparison';
import { qqqMarketSession, qqqLiveQuoteUsable } from '@/lib/qqqMarketSession';
import { qqqDirectionalGexTime } from '@/lib/qqqDirectionalGexTime';
import { QQQ_GEX_LABELS } from '@/lib/qqqGexLabels';
import QqqVirtualTableBody from './QqqVirtualTableBody';
import { qqqReadableMarkers, qqqHoverCardPosition, qqqCursorCandleTime } from '@/lib/qqqChartReadability';
import { qqqCloseAtOrBefore } from '@/lib/qqqChartCloseIndex';
import { createQqqCausalIndex, createQqqOriginalDataCache, qqqTrackLowerBound } from '@/lib/qqqChartDataIndex';
import { qqqChartSeriesUpdate } from '@/lib/qqqChartSeriesUpdate';
import { qqqChartTimeCoordinate, qqqChartTimeGrid } from '@/lib/qqqChartTimeGrid';

import { createQqqHoverStore } from '@/lib/qqqHoverStore';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildDirectionalChartMarkers, emptyDirectionalChartSignals, type DirectionalChartSignal } from './qqqDirectionalChartMarkers';
import { qqqGexPriceRangeStorageKey as qqqPcsGexPriceScaleStorageKey, qqqGexTimeRangeStorageKey as qqqPcsGexTimeScaleStorageKey, readQqqChartRange, persistQqqChartRange, parseQqqChartDisplayPreferences, qqqChartDisplayStorageKey, type QqqChartLegendKey } from './qqqChartDisplayPreferences';
import { buildQqqChartObservationBands, type QqqObservationZone } from '@/lib/qqqChartObservationBands';
import settingsStyles from './QqqChartSettings.module.css';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { createChart, createSeriesMarkers, CandlestickSeries, LineSeries, LineType, customSeriesDefaultOptions, type AutoscaleInfo, type CustomSeriesOptions, type CustomSeriesWhitespaceData, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type ISeriesApi, type IPriceLine, type ISeriesPrimitive, type IPrimitivePaneRenderer, type MouseEventParams, type PaneRendererCustomData, type TickMarkFormatter, type Time } from 'lightweight-charts';
import { retainQqqLiveHistory, qqqLatestLogicalRange } from './qqqLiveCandle';
import { groupQqqChartDisplayItems, qqqChartPreset } from './qqqChartDisplayPreferences';
import { buildObservedPriceLowMarkers, buildShortTermReversalMarkers, buildQqqPcsIntradayChartData as sharedChartData, qqqPcsSessionWindow as sharedSessionWindow, qqqPcsDescribeIntradayDelay, resolveLiveBucketTime } from './QqqPcsIntradayChart.shared';
import useQqqLiveTick, { useQqqLiveTickEffect, useQqqLiveConnection, type QqqLiveTick } from '@/hooks/useQqqLiveTick';
import { buildQqqGammaPositionDisplaySeries, qqqGammaPositionLevel, type QqqGammaPositionLevel } from '@/lib/qqqGammaPosition';
import type { QqqGammaModel } from '@/lib/qqqGammaModel';
import Tooltip from '@/components/Tooltip';
import { calculateRSI } from '@/lib/indicators/indicators/momentum';
import {
  buildQqqIntradayRsiState,
  buildQqqIntradayTradeMap,
  buildQqqShortTermReversalObservations,
  classifyQqqIntradayVolume,
  type QqqIntradayBar,
  type QqqIntradayTradeMap,
  type QqqIntradayTradeMapSeriesPoint,
  type QqqShortTermReversalObservation,
} from '@/lib/qqqIntradaySetup';
import dynamic from 'next/dynamic';
const QqqPcsKlineChartsPoc = dynamic(() => import('./QqqPcsKlineChartsPoc'), { ssr: false });

export type PcsIntradayChartBar = { timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number };
export type PcsIntradayScorePoint = { time: string; score: number };
export type PcsDailyGexPoint = { date: string; totalGex: number; gammaFlipLevel: number | null };
export type PcsIntradayGexPoint = { time: string; totalGex: number; gammaFlipLevel: number | null; observation?: GexObservationSnapshot };
export type PcsGexPoint = PcsDailyGexPoint | PcsIntradayGexPoint;
export type PcsGexProfilePoint = { strike: number; magnitude: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean };
export type PcsGexProfileHistoryPoint = { time: string; strikes: PcsGexProfilePoint[] };
export type PcsWallHistoryPoint = {
  time: string;
  callWallPrice: number | null;
  putWallPrice: number | null;
  callWallMagnitude?: number | null;
  putWallMagnitude?: number | null;
  kingStrike?: number | null;
  kingMagnitude?: number | null;
  kingSide?: 'call' | 'put' | null;
};
export type PcsGexSummary = {
  king: { strike: number; magnitude: number; side: 'call' | 'put' } | null;
  callWall: { strike: number; magnitude: number } | null;
  putWall: { strike: number; magnitude: number } | null;
  gammaFlip: number | null;
  netGex: number;
  calculationVersion?: string;
  gexUnit?: 'per-point' | 'per-1pct';
  scope?: 'full-chain';
  windowNetGex?: number;
  callTotal: number;
  putTotal: number;
};
type PcsNormalizedBar = { time: Time; close: number; volume: number; open?: number; high?: number; low?: number };
type PcsHoverState = { time: number; snapshotTime?: number; price: number; vwap: number; score: number | null; left: number; top: number } | null;
const QqqCursorLayer = memo(function QqqCursorLayer({ store, render }: {
  store: ReturnType<typeof createQqqHoverStore<PcsHoverState>>;
  render: (hover: PcsHoverState) => ReactNode;
}) {
  const hover = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return render(hover);
});
const QqqLiveDisplaySetting = memo(function QqqLiveDisplaySetting({ enabled, hidden, ready, color, toggle }: {
  enabled: boolean; hidden: boolean; ready: boolean; color: string; toggle: () => void;
}) {
  const tick = useQqqLiveTick(enabled);
  return <label>
    <input type="checkbox" disabled={!ready} checked={!hidden} onChange={toggle} aria-label="显示实时价" />
    <span className={settingsStyles.name}><i style={{ background: color }} aria-hidden="true" />实时价</span>
    <small className={settingsStyles.scopeChip}>{tick?.price.toFixed(2) ?? '连接中'}</small>
  </label>;
});
const compactVolumeFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export type PcsChartEventTooltip = { time: Time; label: string; detail: string; color: string };
const EMPTY_GAMMA_POSITION_HISTORY: readonly QqqGammaPositionLevel[] = [];
const EMPTY_GEX_POINTS: readonly PcsGexPoint[] = [];
const EMPTY_GEX_PROFILE_POINTS: readonly PcsGexProfilePoint[] = [];
const EMPTY_GEX_PROFILE_HISTORY_POINTS: readonly PcsGexProfileHistoryPoint[] = [];
const EMPTY_WALL_HISTORY_POINTS: readonly PcsWallHistoryPoint[] = [];
// Canvas 覆盖层（墙位阶梯、价位标签）会在拖拽时做 priceToCoordinate 换算；
// 20fps 足够保持贴合，同时避免它和 Lightweight Charts 的原生 60fps 渲染抢主线程。
const GEX_OVERLAY_SYNC_INTERVAL_MS = 50;
const CROSSHAIR_HOVER_INTERVAL_MS = 16;
// 单日 2m 图有约 200 个 GEX 快照；在 1,000px 宽画布上相邻快照常落进同一像素列。
// 历史 Ribbon 仅保留等距代表点与最后一个快照，墙位变动仍由独立的阶梯轨迹完整表达。
const MAX_RENDERED_GEX_PROFILE_SNAPSHOTS = 72;
const qqqGexPaneHeightStorageKey = 'qqq-pcs:gex-pane-heights:v1';
type QqqPaneWeights = { gex?: number; rsi?: number; gamma?: number };
export function parseQqqPaneWeights(raw: string | null): QqqPaneWeights {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(['gex', 'rsi', 'gamma'].filter(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= .01 && value[key] <= 100).map(key => [key, value[key]]));
  } catch { return {}; }
}
function applyQqqPaneWeights(runtime: PcsChartRuntime, weights: QqqPaneWeights) {
  runtime.chart.panes()[0]?.setStretchFactor(1);
  runtime.netGexSeries?.getPane().setStretchFactor(weights.gex ?? 1 / (runtime.rsiLine ? 4 : 3));
  runtime.rsiLine?.getPane().setStretchFactor(weights.rsi ?? .25);
  runtime.gammaZero?.getPane().setStretchFactor(weights.gamma ?? .25);
}
const qqqGexCallColor = '#38bdf8';
const qqqGexPutColor = '#f472b6';
// 正负 GEX 使用冷暖对比，避免两种紫色在半透明 Ribbon 中混淆。
const qqqGexPositiveColor = '#60a5fa';
const qqqGexNegativeColor = '#fb923c';
type LegendKey = QqqChartLegendKey;
type PcsLiveCandle = { time: number; open: number; high: number; low: number; close: number };
type PcsChartRuntime = {
  chart: ReturnType<typeof createChart>;
  price: ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;
  vwap: ISeriesApi<'Line'> | null;
  kcUpper: ISeriesApi<'Line'> | null;
  kcLower: ISeriesApi<'Line'> | null;
  kcBasis: ISeriesApi<'Line'> | null;
  lowZonePath: ISeriesApi<'Line'> | null;
  highZonePath: ISeriesApi<'Line'> | null;
  score: ISeriesApi<'Line'> | null;
  daily: ISeriesApi<'Line'> | null;
  confirmation: ISeriesApi<'Line'> | null;
  sessionAnchor: ISeriesApi<'Line'> | null;
  netGexSeries: ISeriesApi<'Line'> | null;
  flipSeries: ISeriesApi<'Line'> | null;
  gammaZero: ISeriesApi<'Line'> | null;
  gammaVt: ISeriesApi<'Line'> | null;
  rsiLine: ISeriesApi<'Line'> | null;
  sessionShade: any;
  zoneBands: any;
  snapshots: any;
  markerPlugin: any;
  livePriceLine: IPriceLine | null;
  priceLines: any[];
  priceLineSignature: string | null;
  seriesSignatures: Map<string, string>;
  seriesRows: Map<string, readonly unknown[]>;
  firstPriceTime: Time | null;
};
function syncQqqLivePriceLabel(runtime: PcsChartRuntime, price: number | null, color: string, title = 'LIVE') {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    if (runtime.livePriceLine) runtime.price.removePriceLine(runtime.livePriceLine);
    runtime.livePriceLine = null;
    return;
  }
  const options = { price, color, axisLabelColor: color, axisLabelTextColor: '#ffffff', axisLabelVisible: true, lineStyle: 1 as const, lineWidth: 1 as const, lineVisible: true, title };
  if (runtime.livePriceLine) runtime.livePriceLine.applyOptions(options);
  else runtime.livePriceLine = runtime.price.createPriceLine(options);
}
function scrollQqqToLatest(runtime: PcsChartRuntime, time: number) {
 const scale = runtime.chart.timeScale();
 const index = scale.timeToIndex(time as Time, true);
 if (index !== null) scale.setVisibleLogicalRange(qqqLatestLogicalRange(Number(index), scale.getVisibleLogicalRange()));
}
// GEX 副图按需增删；主 K 线和 RSI 的系列实例保持不变。
function addQqqGexPane(chart: ReturnType<typeof createChart>) {
  const index = chart.panes().length;
  const pane = chart.addPane();
  pane.setStretchFactor(1);
  const netGexSeries = chart.addSeries(LineSeries, { color: '#f472b6', crosshairMarkerRadius: 3, lastValueVisible: true, lineWidth: 2, priceFormat: { type: 'custom', formatter: formatGexAxis, minMove: 1 }, priceLineVisible: false, priceScaleId: 'right', title: 'Net GEX' }, index);
  const flipSeries = chart.addSeries(LineSeries, { color: '#67e8f9', crosshairMarkerRadius: 3, lastValueVisible: true, lineWidth: 2, lineStyle: 2, priceLineVisible: false, priceScaleId: 'left', title: 'Gamma Flip' }, index);
  netGexSeries.createPriceLine({ axisLabelVisible: false, color: 'rgba(226,232,240,.58)', lineStyle: 2, lineWidth: 1, price: 0, title: '0 GEX' });
  pane.priceScale('right').applyOptions({ autoScale: true, borderColor: 'rgba(148,163,184,.12)', scaleMargins: { top: .14, bottom: .14 }, visible: true });
  pane.priceScale('left').applyOptions({ autoScale: true, scaleMargins: { top: .14, bottom: .14 }, visible: false });
  // RSI 已打开时，恢复的 GEX 仍排在主图与 RSI 之间。
  if (index > 1) chart.swapPanes(1, index);
  return { netGexSeries, flipSeries };
}
function addQqqGammaPositionPane(chart: ReturnType<typeof createChart>) {
  const index = chart.panes().length;
  const pane = chart.addPane();
  pane.setStretchFactor(.25);
  const add = (title: string, color: string) => chart.addSeries(LineSeries, {
    title, color, lineWidth: 2, pointMarkersVisible: true, pointMarkersRadius: 2,
    priceLineVisible: false, lastValueVisible: true,
    priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%`, minMove: .01 },
    autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
      const info = original();
      const extent = Math.max(.05, Math.abs(info?.priceRange?.minValue ?? 0), Math.abs(info?.priceRange?.maxValue ?? 0));
      return { priceRange: { minValue: -extent, maxValue: extent } };
    },
  }, index);
  const gammaZero = add('距模型零交点', '#b7a5ef');
  const gammaVt = add('距 VT 缓冲下沿', '#a5d66f');
  gammaZero.createPriceLine({ price: 0, color: 'rgba(226,232,240,.6)', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'Gamma 位置 · 0%' });
  pane.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: .2, bottom: .2 }, visible: true });
  return { gammaZero, gammaVt };
}
function addQqqRsiSeries(chart: ReturnType<typeof createChart>, rsiSeriesData: readonly {time: Time; value: number}[]) {
  let rsiLine: ISeriesApi<'Line'>;
  const rsiPaneIndex = chart.panes().length;
  const rsiPane = chart.addPane();
  chart.panes()[0]?.setStretchFactor(4);
  rsiPane.setStretchFactor(1);
  rsiLine = chart.addSeries(LineSeries, {
    color: '#fbbf24',
    crosshairMarkerRadius: 3,
    lastValueVisible: true,
    lineWidth: 2,
    priceLineVisible: false,
    priceScaleId: 'right',
    title: 'RSI14',
  }, rsiPaneIndex);
  rsiLine.setData([...rsiSeriesData]);
  rsiLine.createPriceLine({ axisLabelVisible: true, color: 'rgba(251,113,133,.45)', lineStyle: 2, lineWidth: 1, price: 70, title: '70' });
  rsiLine.createPriceLine({ axisLabelVisible: false, color: 'rgba(148,163,184,.28)', lineStyle: 2, lineWidth: 1, price: 50, title: '50' });
  rsiLine.createPriceLine({ axisLabelVisible: true, color: 'rgba(52,211,153,.45)', lineStyle: 2, lineWidth: 1, price: 30, title: '30' });
  chart.priceScale('right', rsiPaneIndex).applyOptions({ autoScale: false, borderColor: 'rgba(148,163,184,.12)', visible: true });
  chart.priceScale('right', rsiPaneIndex).setVisibleRange({ from: 0, to: 100 });
  return rsiLine;
}
type PcsNativeSnapshotStrike = { strike: number; magnitude: number; color: string; outlined: boolean; emphasized: boolean; track: string };
type PcsNativeSnapshotData = { time: Time; strikes: PcsNativeSnapshotStrike[] };
type PcsSnapshotTrackPoint = { barIndex: number; strike: PcsNativeSnapshotStrike };
type PcsBitmapCanvasTarget = { useBitmapCoordinateSpace(callback: (scope: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number }) => void): void };
type PcsExtendedHoursShadeData = { time: Time; price: number; shade: 'pre' | 'post' | null };
type PcsIntradayZoneBandData = {
  time: Time;
  lowLower: number;
  lowUpper: number;
  highLower: number;
  highUpper: number;
  activeSide: 'LOW' | 'HIGH' | null;
  referencePrice?: number;
  showLow?: boolean;
  showHigh?: boolean;
};
// GEX 解读：五项纯派生展示信息（gamma 机制/离墙距离/墙稳定性/候选 strike 交叉校验/topology 解读），来自 route.ts 的 buildGexInsights，纯展示不进决策。
export type PcsGexInsights = {
  gammaRegime: { label: 'positive' | 'negative'; description: string; distance: number; distancePct: number } | null;
  wallDistances: { callWall: { strike: number; distance: number; distancePct: number } | null; putWall: { strike: number; distance: number; distancePct: number } | null };
  wallStability: { callWall: { segments: number; currentSegmentMinutes: number | null; sparse: boolean; description: string } | null; putWall: { segments: number; currentSegmentMinutes: number | null; sparse: boolean; description: string } | null } | null;
  candidateProximity: { strike: number; wallStrike: number; wallSide: 'call' | 'put'; distancePoints: number; close: boolean; description: string } | null;
  topology: { structure: string; gloss: string } | null;
};

// 当前时刻逐 strike 的 gamma 分布快照（非时间序列），用横向价位线叠在价格图上；强度按 |magnitude| 归一化映射线宽/透明度。
// Gamma Flip 固定青色、King（call/put wall 里 |magnitude| 更大的那个）固定近白色，跟按正负着色的普通墙位区分开。
export function buildGexProfileLines(profile: readonly PcsGexProfilePoint[], kingStrike: number | null = null) {
  const finite = profile.filter((point) => Number.isFinite(point.strike) && point.strike > 0 && Number.isFinite(point.magnitude));
  if (!finite.length) return [];
  const scales = gexSnapshotMagnitudeScales(finite.map(point => ({ magnitude: point.magnitude, emphasized: point.strike === kingStrike })));
  return finite.map((point) => {
    const maxAbs = scales[point.strike === kingStrike ? 'king' : point.magnitude >= 0 ? 'positive' : 'negative'];
    const ratio = Math.min(1, Math.abs(point.magnitude) / maxAbs);
    const lineWidth = Math.max(1, Math.min(4, Math.round(ratio * 4))) as 1 | 2 | 3 | 4;
    const positive = point.magnitude >= 0;
    const isKing = kingStrike !== null && point.strike === kingStrike;
    // lightweight-charts 价位线宽度上限只有 4px，宽度区分度有限，靠透明度拉开更大对比（弱位 0.15 近乎隐没，强位 0.95 接近实色）
    const alpha = Number((0.15 + ratio * 0.8).toFixed(2));
    const color = point.isGammaFlip
      ? 'rgba(45, 212, 191, 0.9)'
      : isKing
        ? 'rgba(226, 232, 240, 0.95)'
        : point.isCallWall
          ? `rgba(56, 189, 248, ${alpha})`
          : point.isPutWall
            ? `rgba(244, 114, 182, ${alpha})`
            : positive ? `rgba(96, 165, 250, ${alpha})` : `rgba(251, 146, 60, ${alpha})`;
    const title = point.isGammaFlip ? 'Gamma Flip' : isKing ? `King · ${point.isCallWall ? 'Call Wall' : 'Put Wall'}` : point.isCallWall ? 'Call Wall' : point.isPutWall ? 'Put Wall' : '';
    return { price: point.strike, color, lineWidth: (isKing ? 4 : lineWidth) as 1 | 2 | 3 | 4, lineStyle: (point.isGammaFlip ? 2 : 0) as 0 | 2, title };
  });
}

// 常驻图例：不依赖 hover，列出当前实际渲染的系列，避免多线堆叠时看不出哪根是哪个。
function buildChartLegendItems(opts: { granularity: '2m' | '5m' | '1d'; showAuxSeries: boolean; showGex: boolean; isLive: boolean; hasRsi: boolean; hasGexTotal: boolean; hasGammaFlip: boolean; hasGexProfile: boolean; hasWallHistory: boolean }) {
  const items: Array<{ color: string; dash?: boolean; key: LegendKey; label: string; note?: boolean }> = [{ color: '#60a5fa', key: 'price', label: '价格' }];
  if (opts.isLive) items.push({ color: '#34d399', key: 'live', label: '实时价' });
  if (opts.granularity !== '1d') items.push({ color: '#fbbf24', dash: true, key: 'vwap', label: 'VWAP' });
  if (opts.showAuxSeries && opts.granularity !== '1d') {
    if (opts.hasRsi) items.push({ color: '#fbbf24', key: 'rsi', label: 'RSI14' });
    items.push({ color: '#a78bfa', key: 'score', label: '执行分' });
    items.push({ color: '#f472b6', dash: true, key: 'confirmation', label: '确认度' });
  }
  // GEX 总量/Gamma Flip 随时间的折线在稀疏数据下形状易误导，改用下方附表展示精确数值，图例只留一句指引。
  if (opts.showGex && (opts.hasGexTotal || opts.hasGammaFlip)) items.push({ color: '#f59e0b', key: 'gex_table', label: 'GEX 快照 / GEX 换号价见下方附表', note: true });
  if (opts.showGex && opts.hasGexProfile) {
    items.push({ color: qqqGexPositiveColor, key: 'gex_positive', label: 'GEX strike Ribbon·净正向（带越宽/越亮=强度越大）' });
    items.push({ color: qqqGexNegativeColor, key: 'gex_negative', label: 'GEX strike Ribbon·净负向' });
  }
  if (opts.showGex && opts.hasWallHistory) items.push({ color: 'rgba(148, 163, 184, 0.5)', key: 'wall_history', label: 'Call/Put Wall 快照历史·全天细线 / 当前段加粗' });
  return items;
}

// GEX 随时间快照 -> 附表行：按 date(1d)/time(5m) 两种形状统一成可排序的 ISO 字符串 key，最新的排最前面。
export function buildGexHistoryTableRows(gex: readonly PcsGexPoint[], observations:readonly {time:string;strikes:readonly GexObservationStrike[];strikeCoverage?:'full'|'top8'}[]=[]) {
  const saved = new Map<string, GexObservationSnapshot>();
  const pointsByTime = new Map(gex.map(point => [gexSnapshotIso(point), point]));
  for (const point of gex) if ('time' in point && point.observation) saved.set(point.time, point.observation);
  for (const point of observations) {
    // A wall display subset cannot replace the persisted full-chain total or
    // establish coverage for a historical change calculation.
    if(point.strikeCoverage==='top8')continue;
    const time = qqqDirectionalGexTime(point.time, null, point.strikes);
    const original = pointsByTime.get(point.time);
    const observation = { time, netGex: original?.totalGex ?? NaN, inputComplete: point.strikes.every(strike => strike.inputComplete !== false), profile: point.strikes, calculationVersion: point.strikes[0]?.calculationVersion };
    const value = qqqGexObservation(observation);
    pointsByTime.delete(point.time);
    if (!value || !Number.isFinite(value.net)) continue;
    saved.set(time, observation);
    pointsByTime.set(time, { time, totalGex: value.net, gammaFlipLevel: value.partial ? null : original?.gammaFlipLevel ?? null });
  }
  const points = [...pointsByTime.values()];
  const rows = points
    .filter((point) => Number.isFinite(point.totalGex))
    .map((point) => {
      const isDaily = 'date' in point;
      const iso = isDaily ? `${point.date}T16:00:00.000Z` : point.time;
      return {
        key: iso,
        isDaily,
        observation:saved.get(iso),
        iso,
        totalGex: point.totalGex,
        gammaFlipLevel: point.gammaFlipLevel !== null && Number.isFinite(point.gammaFlipLevel) ? point.gammaFlipLevel : null,
      };
    });
  return rows.sort((left, right) => (left.iso < right.iso ? 1 : left.iso > right.iso ? -1 : 0));
}

type GexTableRow = ReturnType<typeof buildGexHistoryTableRows>[number];

type GexSnapshotRowProps = {
  row: GexTableRow;
  previous: GexTableRow | null;
  structure: PcsGexSnapshotStructure;
  trend: PcsGexHedgeTrendDisplay;
  validation: PcsGexTrendValidation;
};

const GexSnapshotRow = memo(function GexSnapshotRow({ row, previous, structure, trend, validation }: GexSnapshotRowProps) {
  const comparison=row.observation&&previous?.observation?compareQqqGexObservations(row.observation,previous.observation):null;
  const deltaGex = row.observation || previous?.observation ? comparison?.delta ?? null : previous ? row.totalGex - previous.totalGex : null;
  const renderWall = (wall: PcsGexSnapshotStructure['callWall'], color: string) => wall === null
    ? '—'
    : <span style={{ color }}>{wall.strike.toFixed(2)} <span style={{ color: 'var(--text-tertiary)' }}>{wall.magnitude === null ? '' : formatGexMagnitude(wall.magnitude)}</span></span>;
  return <tr style={{height:32}}>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: 'var(--text-secondary)', padding: '0.3rem 0.58rem', whiteSpace: 'nowrap' }}>{row.isDaily ? new Date(row.iso).toLocaleDateString('zh-CN', { timeZone: 'America/New_York' }) : formatGexHistoryTimestamp(row.iso)}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: '#e2e8f0', padding: '0.3rem 0.58rem', textAlign: 'right' }}>{structure.spot === null ? '—' : structure.spot.toFixed(2)}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: row.totalGex >= 0 ? '#34d399' : '#f87171', padding: '0.3rem 0.58rem', textAlign: 'right' }}>{formatGexMagnitude(row.totalGex)}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: deltaGex === null ? '#64748b' : deltaGex >= 0 ? '#34d399' : '#f87171', padding: '0.3rem 0.58rem', textAlign: 'right' }}>{deltaGex === null ? '—' : `${deltaGex >= 0 ? '+' : ''}${formatGexMagnitude(deltaGex)}`}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: structure.regime === 'POSITIVE' ? '#34d399' : structure.regime === 'NEGATIVE' ? '#fb7185' : '#64748b', padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{structure.regime === 'POSITIVE' ? 'POS' : structure.regime === 'NEGATIVE' ? 'NEG' : '—'} · {row.gammaFlipLevel === null ? '—' : `${row.gammaFlipLevel.toFixed(2)} / ${structure.flipDistance === null ? '—' : `${structure.flipDistance >= 0 ? '+' : ''}${structure.flipDistance.toFixed(2)}`}`}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{renderWall(structure.callWall, qqqGexCallColor)}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{renderWall(structure.putWall, qqqGexPutColor)}</td>
    <td style={{ borderBottom: '1px solid rgba(148,163,184,.05)', padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{renderWall(structure.king, '#e2e8f0')}</td>
    <td title={`${trend.detail}${trend.confidence === null ? '' : ` · 置信度 ${trend.confidence}%`}`} style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: trend.color, padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{trend.label}{trend.confidence === null ? '' : ` · ${trend.confidence}%`}</td>
    <td title={validation.detail} style={{ borderBottom: '1px solid rgba(148,163,184,.05)', color: validation.color, padding: '0.3rem 0.58rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{validation.label}</td>
  </tr>;
}, (previous, next) => {
  const sameStructure = previous.structure.spot === next.structure.spot
    && previous.structure.flipDistance === next.structure.flipDistance
    && previous.structure.regime === next.structure.regime
    && previous.structure.callWall?.strike === next.structure.callWall?.strike
    && previous.structure.callWall?.magnitude === next.structure.callWall?.magnitude
    && previous.structure.putWall?.strike === next.structure.putWall?.strike
    && previous.structure.putWall?.magnitude === next.structure.putWall?.magnitude
    && previous.structure.king?.strike === next.structure.king?.strike
    && previous.structure.king?.magnitude === next.structure.king?.magnitude;
  return previous.row.key === next.row.key
    && previous.row.totalGex === next.row.totalGex
    && previous.row.gammaFlipLevel === next.row.gammaFlipLevel
    && previous.previous?.key === next.previous?.key
    && sameStructure
    && previous.trend.label === next.trend.label
    && previous.trend.color === next.trend.color
    && previous.trend.confidence === next.trend.confidence
    && previous.trend.detail === next.trend.detail
    && previous.validation.label === next.validation.label
    && previous.validation.color === next.validation.color
    && previous.validation.detail === next.validation.detail;
});

// Net GEX 的极低点与价格低点是两种量纲；单独标记以避免暗示二者必然同一时刻反转。
export function buildObservedGexLowMarkers(points: readonly { time: Time; value: number }[]) {
  const lowest = points.reduce<{ time: Time; value: number } | null>((current, point) => (
    !Number.isFinite(point.value) || (current !== null && point.value >= current.value) ? current : point
  ), null);
  return lowest === null ? [] : [{ color: '#fb7185', position: 'atPriceBottom' as const, price: lowest.value, shape: 'arrowUp' as const, size: 1, text: `GEX 低谷 ${formatGexMagnitude(lowest.value)}`, time: lowest.time }];
}

export type PcsShortTermReversalObservation = QqqShortTermReversalObservation;

const ema = (values: readonly number[], period: number) => {
  const alpha = 2 / (period + 1);
  let previous: number | null = null;
  return values.map((value) => {
    previous = previous === null ? value : value * alpha + previous * (1 - alpha);
    return previous;
  });
};
export function buildShortTermReversalObservations(
  inputBars: readonly { time: Time; close: number; high?: number; low?: number }[],
  gex: readonly { time: Time; value: number }[],
  wallHistory: readonly PcsWallHistoryPoint[] = [],
): PcsShortTermReversalObservation[] {
  return buildQqqShortTermReversalObservations(
    inputBars.map((bar) => ({ ...bar, time: Number(bar.time) })),
    gex.map((point) => ({ time: Number(point.time), value: point.value })),
    wallHistory.map((point) => ({ time: chartTime(point.time) as number, callWallPrice: point.callWallPrice, putWallPrice: point.putWallPrice })),
  );
}


export function buildCurrentSetupTargetMarker(input: {
  bars: readonly QqqIntradayBar[];
  tradeMap: QqqIntradayTradeMap | null;
  observations: readonly QqqShortTermReversalObservation[];
}) {
  const last = input.bars.at(-1);
  const side = input.tradeMap?.activeSide ?? null;
  const target = input.tradeMap?.target ?? null;
  if (!last || side === null || target === null) return [];
  const kind = side === 'LOW' ? 'BOTTOM' : 'TOP';
  const hasFreshConfirmation = input.observations.some((signal) => signal.kind === kind
    && signal.state === 'CONFIRMED'
    && signal.time <= last.time
    && last.time - signal.time <= 10 * 60);
  if (!hasFreshConfirmation) return [];
  const touched = side === 'LOW'
    ? (Number.isFinite(last.high) ? last.high! : last.close) >= target
    : (Number.isFinite(last.low) ? last.low! : last.close) <= target;
  if (!touched) return [];
  return [{
    color: '#67e8f9',
    position: side === 'LOW' ? 'atPriceTop' as const : 'atPriceBottom' as const,
    price: target,
    shape: 'circle' as const,
    size: 2,
    text: '◎ 到达目标',
    time: last.time as Time,
  }];
}

/** 图上的短标签只负责辨认；详细含义在同时间十字线 tooltip 中展示。 */
export function buildChartEventTooltips(
  priceMarkers: readonly { time: Time; price: number }[],
  gexMarkers: readonly { time: Time; price: number }[],
  observations: readonly PcsShortTermReversalObservation[],
): PcsChartEventTooltip[] {
  return [
    ...priceMarkers.map((marker) => ({ time: marker.time, label: '价格低点', detail: `截至当前的最低成交价：QQQ ${marker.price.toFixed(2)}。它是观测低点，不等于抄底信号。`, color: '#fbbf24' })),
    ...gexMarkers.map((marker) => ({ time: marker.time, label: 'GEX 低谷', detail: `截至当前的 Net GEX 低谷：${formatGexMagnitude(marker.price)}。它与价格低点是不同量纲。`, color: '#fb7185' })),
    ...observations.map((signal) => {
      const prefix = signal.kind === 'BOTTOM' ? '低位观察' : '高位观察';
      const suffix = signal.state === 'INVALIDATED' ? '失效' : String(signal.level ?? (signal.state === 'CONFIRMED' ? 3 : signal.state === 'PRICE_CONFIRMED' ? 2 : 1));
      const color = signal.state === 'CONFIRMED' ? (signal.kind === 'BOTTOM' ? '#34d399' : '#fb7185') : signal.state === 'PRICE_CONFIRMED' ? (signal.kind === 'BOTTOM' ? '#2dd4bf' : '#c4b5fd') : signal.state === 'INVALIDATED' ? '#94a3b8' : (signal.kind === 'BOTTOM' ? '#fbbf24' : '#f59e0b');
      return { time: signal.time as Time, label: `${prefix}${suffix}`, detail: signal.detail, color };
    }),
  ];
}

export type PcsIntradayTradeMap = QqqIntradayTradeMap;

export function buildIntradayZoneBandSeriesData(
  points: readonly QqqIntradayTradeMapSeriesPoint[],
) {
  return {
    bands: points.map(({ time, map }) => ({
      time: time as Time,
      lowLower: map.lowZone.lower,
      lowUpper: map.lowZone.upper,
      highLower: map.highZone.lower,
      highUpper: map.highZone.upper,
      activeSide: map.activeSide,
    } satisfies PcsIntradayZoneBandData)),
    low: points.map(({ time, map }) => ({
      time: time as Time,
      value: map.lowZone.anchor,
    })),
    high: points.map(({ time, map }) => ({
      time: time as Time,
      value: map.highZone.anchor,
    })),
  };
}

export function buildIntradayTradeMap(input: {
  bars: readonly { time: Time; close: number; high?: number; low?: number; volume?: number }[];
  vwap: number | null;
  putWall: number | null;
  callWall: number | null;
  gammaFlip: number | null;
  gex: readonly { time: Time; value: number }[];
  observations: readonly PcsShortTermReversalObservation[];
}): PcsIntradayTradeMap | null {
  return buildQqqIntradayTradeMap({
    ...input,
    bars: input.bars.map((bar) => ({ ...bar, time: Number(bar.time) })),
    gex: input.gex.map((point) => ({ time: Number(point.time), value: point.value })),
  });
}

export type PcsGexSnapshotStructure = {
  spot: number | null;
  flipDistance: number | null;
  regime: 'POSITIVE' | 'NEGATIVE' | 'UNAVAILABLE';
  callWall: { strike: number; magnitude: number | null } | null;
  putWall: { strike: number; magnitude: number | null } | null;
  king: { strike: number; magnitude: number | null } | null;
};

/**
 * 将同一时间点的价格与墙位并入 GEX 快照。这里只使用已落盘的历史，
 * 不把当前 wall/spot 回填到旧行，避免把“现在”伪装成“当时”。
 */
export function buildGexSnapshotStructure(
  iso: string,
  totalGex: number,
  gammaFlipLevel: number | null,
  bars: readonly PcsIntradayChartBar[],
  wallHistory: readonly PcsWallHistoryPoint[],
): PcsGexSnapshotStructure {
  const spot = closeAtOrBefore(bars, iso);
  const snapshotAt = new Date(iso).getTime();
  const wall = findLatestWallSnapshotAtTime(wallHistory, Math.floor(snapshotAt / 1000))?.current ?? null;
  const toWall = (strike: number | null, magnitude: number | null | undefined) => strike !== null && Number.isFinite(strike)
    ? { strike, magnitude: typeof magnitude === 'number' && Number.isFinite(magnitude) ? magnitude : null }
    : null;
  return {
    spot,
    flipDistance: spot !== null && gammaFlipLevel !== null ? spot - gammaFlipLevel : null,
    regime: !Number.isFinite(totalGex) || totalGex === 0 ? 'UNAVAILABLE' : totalGex > 0 ? 'POSITIVE' : 'NEGATIVE',
    callWall: wall ? toWall(wall.callWallPrice, wall.callWallMagnitude) : null,
    putWall: wall ? toWall(wall.putWallPrice, wall.putWallMagnitude) : null,
    king: wall ? toWall(wall.kingStrike ?? null, wall.kingMagnitude) : null,
  };
}

export type PcsGexHedgeTrend = {
  label: '↓ 加速风险' | '↑ 加速风险' | '钉盘增强' | '减震消失' | '结构修复' | '未确认' | '积累中';
  color: string;
  confidence: number | null;
  deltaGex: number | null;
  detail: string;
};

export type PcsGexTrendValidation = { label: '✓ 命中' | '✕ 未命中' | '待验证' | '非方向'; color: string; detail: string };
export type PcsGexTrendContext = { current: PcsGexSnapshotStructure | null; previous: PcsGexSnapshotStructure | null };
export type PcsGexHedgeTrendDisplay = Omit<PcsGexHedgeTrend, 'label'> & { label: string };

function directionalStructureEvidence(
  direction: 'down' | 'up',
  current: { gammaFlipLevel: number | null },
  previous: { gammaFlipLevel: number | null },
  context: PcsGexTrendContext | undefined,
) {
  const currentStructure = context?.current;
  const previousStructure = context?.previous;
  if (!currentStructure || !previousStructure) return { confidenceBonus: 0, detail: '墙位历史积累中' };
  const currentCall = currentStructure.callWall;
  const previousCall = previousStructure.callWall;
  const currentPut = currentStructure.putWall;
  const previousPut = previousStructure.putWall;
  const signs = direction === 'down'
    ? {
        flip: current.gammaFlipLevel !== null && previous.gammaFlipLevel !== null && current.gammaFlipLevel < previous.gammaFlipLevel,
        distance: currentStructure.flipDistance !== null && previousStructure.flipDistance !== null && currentStructure.flipDistance < previousStructure.flipDistance,
        wall: (currentCall?.strike ?? Infinity) < (previousCall?.strike ?? Infinity) || (currentPut?.strike ?? Infinity) < (previousPut?.strike ?? Infinity),
        support: currentPut !== null && previousPut !== null && currentPut.magnitude !== null && previousPut.magnitude !== null && Math.abs(currentPut.magnitude) < Math.abs(previousPut.magnitude),
      }
    : {
        flip: current.gammaFlipLevel !== null && previous.gammaFlipLevel !== null && current.gammaFlipLevel > previous.gammaFlipLevel,
        distance: currentStructure.flipDistance !== null && previousStructure.flipDistance !== null && currentStructure.flipDistance > previousStructure.flipDistance,
        wall: (currentCall?.strike ?? -Infinity) > (previousCall?.strike ?? -Infinity) || (currentPut?.strike ?? -Infinity) > (previousPut?.strike ?? -Infinity),
        support: currentCall !== null && previousCall !== null && currentCall.magnitude !== null && previousCall.magnitude !== null && Math.abs(currentCall.magnitude) > Math.abs(previousCall.magnitude),
      };
  const matched = Object.entries(signs).filter(([, value]) => value).map(([key]) => key);
  const labels: Record<string, string> = { flip: 'Flip 同向迁移', distance: 'Spot–Flip 距离扩大', wall: 'Wall 同向迁移', support: direction === 'down' ? 'Put Wall 变薄' : 'Call Wall 变厚' };
  return { confidenceBonus: Math.min(12, matched.length * 3), detail: matched.length ? matched.map((key) => labels[key]!).join(' · ') : '墙位未提供同向确认' };
}

/**
 * 这是结构状态而非方向预测：仅当 GEX 的显著变化、价格方向与 Flip 相对位置同时一致时，才标注上/下加速风险。
 * 没有 K 线确认时宁可显示“未确认”，避免把一次 OI/IV 重估误读成即时行情信号。
 */
export function deriveGexHedgeTrend(
  current: { totalGex: number; gammaFlipLevel: number | null },
  previous: { totalGex: number; gammaFlipLevel: number | null } | null,
  currentClose: number | null,
  previousClose: number | null,
  context?: PcsGexTrendContext,
): PcsGexHedgeTrend {
  if (!previous || !Number.isFinite(current.totalGex) || !Number.isFinite(previous.totalGex)) return { label: '积累中', color: '#94a3b8', confidence: null, deltaGex: null, detail: '需要上一条快照' };
  const deltaGex = current.totalGex - previous.totalGex;
  const threshold = Math.max(5_000_000, Math.abs(previous.totalGex) * 0.12);
  const material = Math.abs(deltaGex) >= threshold;
  const hasPrice = currentClose !== null && previousClose !== null && currentClose > 0 && previousClose > 0;
  const priceChange = hasPrice ? currentClose / previousClose - 1 : 0;
  const priceUp = priceChange >= 0.0005;
  const priceDown = priceChange <= -0.0005;
  const belowFlip = currentClose !== null && current.gammaFlipLevel !== null && currentClose < current.gammaFlipLevel;
  const aboveFlip = currentClose !== null && current.gammaFlipLevel !== null && currentClose > current.gammaFlipLevel;
  const baseConfidence = 45 + (material ? 20 : 0) + ((priceUp || priceDown) ? 12 : 0) + ((belowFlip || aboveFlip) ? 11 : 0);
  const downEvidence = directionalStructureEvidence('down', current, previous, context);
  const upEvidence = directionalStructureEvidence('up', current, previous, context);
  const confidence = (evidence: { confidenceBonus: number }) => Math.min(context ? 95 : 88, baseConfidence + evidence.confidenceBonus);
  if (!material) return { label: '未确认', color: '#94a3b8', confidence: hasPrice ? confidence({ confidenceBonus: 0 }) : null, deltaGex, detail: 'GEX 变化未达显著阈值' };
  if (current.totalGex < 0 && deltaGex < 0 && priceDown && belowFlip) return { label: '↓ 加速风险', color: '#fb7185', confidence: confidence(downEvidence), deltaGex, detail: `负 Gamma 扩大 · 价格在 Flip 下方 · ${downEvidence.detail}` };
  if (current.totalGex < 0 && deltaGex < 0 && priceUp && aboveFlip) return { label: '↑ 加速风险', color: '#60a5fa', confidence: confidence(upEvidence), deltaGex, detail: `负 Gamma 扩大 · 价格在 Flip 上方 · ${upEvidence.detail}` };
  if (current.totalGex > 0 && deltaGex > 0) return { label: '钉盘增强', color: '#67e8f9', confidence: hasPrice ? confidence({ confidenceBonus: 0 }) : null, deltaGex, detail: '正 Gamma 增强 · 波动减震提高' };
  if (previous.totalGex < 0 && deltaGex > 0) return { label: '结构修复', color: '#a5b4fc', confidence: hasPrice ? confidence({ confidenceBonus: 0 }) : null, deltaGex, detail: '负 Gamma 收敛 · 加速风险缓解' };
  if (previous.totalGex > 0 && deltaGex < 0) return { label: '减震消失', color: '#fbbf24', confidence: hasPrice ? confidence({ confidenceBonus: 0 }) : null, deltaGex, detail: '正 Gamma 减弱 · 突破敏感度提高' };
  return { label: '未确认', color: '#94a3b8', confidence: hasPrice ? confidence({ confidenceBonus: 0 }) : null, deltaGex, detail: hasPrice ? '价格与 Flip 未形成一致确认' : '缺少同期价格确认' };
}

/**
 * 2 分钟快照先用 EWMA(3) 平滑 Net GEX 再做趋势判断：持续变化通常只慢一根 bar，
 * 单次 IV/OI 重估更难触发趋势。原始 Net GEX/ΔGEX 保持在表中，不把平滑值冒充快照值。
 */
export function deriveObservedGexHedgeTrend(currentObservation:GexObservationSnapshot|undefined,previousObservation:GexObservationSnapshot|undefined,current:{totalGex:number;gammaFlipLevel:number|null},previous:{totalGex:number;gammaFlipLevel:number|null}|null,currentClose:number|null,previousClose:number|null,context?:PcsGexTrendContext):PcsGexHedgeTrend {
  if(!currentObservation && !previousObservation)return deriveGexHedgeTrend(current,previous,currentClose,previousClose,context);
  if(!currentObservation)return {label:'积累中',color:'#94a3b8',confidence:null,deltaGex:null,detail:'缺少同口径的共同有效快照'};
  const comparison=compareQqqGexObservations(currentObservation,previousObservation);
  if(!comparison)return {label:'积累中',color:'#94a3b8',confidence:null,deltaGex:null,detail:'缺少同交易日、同口径的共同有效快照'};
  const trend=deriveGexHedgeTrend(comparison.partial?{...current,totalGex:comparison.currentNet}:current,comparison.partial?{...previous!,totalGex:comparison.previousNet}:previous,currentClose,previousClose,context);
  return comparison.partial?{...trend,confidence:trend.confidence===null?null:Math.min(60,trend.confidence),detail:`${trend.detail} · 部分数据，共同 ${comparison.comparedStrikes} 行权价；未混合不同覆盖的平滑值`}:trend;
}

export function smoothGexTrendInputs(points: readonly { totalGex: number; gammaFlipLevel: number | null; observation?: GexObservationSnapshot }[]) {
  let previousSmooth: number | null = null;
  return points.map((point, index) => {
    const previous = points[index - 1];
    const comparison = point.observation && previous?.observation ? compareQqqGexObservations(point.observation, previous.observation) : null;
    const reset = (point.observation || previous?.observation) && (!comparison || comparison.partial);
    const totalGex = previousSmooth === null || reset ? point.totalGex : .5 * point.totalGex + .5 * previousSmooth;
    previousSmooth = totalGex;
    return { ...point, totalGex };
  });
}

/**
 * 展示去抖不改变原始趋势计算：首次触发立即显示，连续同方向压成“延续”；
 * 一根未确认 bar 仅显示“保持”，第二根才退出，避免 2 分钟级别来回闪烁。
 */
export function compactGexHedgeTrendDisplay(trends: readonly PcsGexHedgeTrend[]): PcsGexHedgeTrendDisplay[] {
  let active: '↓ 加速风险' | '↑ 加速风险' | null = null;
  let previousEvent: string | null = null;
  let neutralHoldAvailable = false;
  return trends.map((trend) => {
    const directional = trend.label === '↓ 加速风险' || trend.label === '↑ 加速风险' ? trend.label : null;
    if (directional) {
      const isContinuation = active === directional;
      active = directional;
      previousEvent = directional;
      neutralHoldAvailable = true;
      return isContinuation
        ? { ...trend, color: directional === '↓ 加速风险' ? '#fda4af' : '#93c5fd', label: directional === '↓ 加速风险' ? '↓ 延续' : '↑ 延续', detail: `${trend.detail} · ${trend.detail.includes('部分数据') ? '共同有效范围' : 'EWMA(3)'} 同向延续` }
        : { ...trend, detail: `${trend.detail} · ${trend.detail.includes('部分数据') ? '共同有效范围' : 'EWMA(3)'} 首次触发` };
    }
    if (active !== null && trend.label === '未确认' && neutralHoldAvailable) {
      neutralHoldAvailable = false;
      return { ...trend, color: active === '↓ 加速风险' ? '#cbd5e1' : '#bfdbfe', label: active === '↓ 加速风险' ? '↓ 保持' : '↑ 保持', detail: `${trend.detail} · 保持上一方向一根 2 分钟快照，等待确认或退出` };
    }
    if (trend.label === '未确认' || trend.label === '积累中') {
      active = null;
      neutralHoldAvailable = false;
      return { ...trend, color: '#64748b', label: '—', confidence: null, detail: `${trend.detail} · 噪音过滤` };
    }
    active = null;
    neutralHoldAvailable = false;
    const isRepeated = previousEvent === trend.label;
    previousEvent = trend.label;
    return isRepeated
      ? { ...trend, color: '#64748b', label: '—', confidence: null, detail: `${trend.detail} · 状态延续，已折叠` }
      : trend;
  });
}

/** 仅回看下一条已落盘的 GEX 快照，验证“加速风险”是否出现；不把非方向状态伪装成对错。 */
export function validateGexHedgeTrend(trend: PcsGexHedgeTrend, snapshotClose: number | null, futureClose: number | null): PcsGexTrendValidation {
  if (trend.label !== '↓ 加速风险' && trend.label !== '↑ 加速风险') return { label: '非方向', color: '#64748b', detail: '非方向状态不做涨跌验证' };
  if (snapshotClose === null || futureClose === null || snapshotClose <= 0 || futureClose <= 0) return { label: '待验证', color: '#94a3b8', detail: '等待下一条有效快照价格' };
  const threshold = 0.0005;
  const hit = trend.label === '↓ 加速风险'
    ? futureClose <= snapshotClose * (1 - threshold)
    : futureClose >= snapshotClose * (1 + threshold);
  return hit
    ? { label: '✓ 命中', color: '#67e8f9', detail: `下一快照价格${trend.label.startsWith('↓') ? '下行' : '上行'}至少 5bp` }
    : { label: '✕ 未命中', color: '#fbbf24', detail: '下一快照未按风险方向延续至少 5bp' };
}

const closeAtOrBefore = qqqCloseAtOrBefore;

const gexSnapshotIso = (point: PcsGexPoint) => 'date' in point ? `${point.date}T16:00:00.000Z` : point.time;
const gexSnapshotIndex = createQqqCausalIndex<PcsGexPoint>(point => Number.isFinite(point.totalGex) ? Number(chartTime(gexSnapshotIso(point))) : NaN);
const wallSnapshotIndex = createQqqCausalIndex<PcsWallHistoryPoint>(point => Number(chartTime(point.time)));
export function findLatestGexSnapshotAtTime(gex: readonly PcsGexPoint[], hoverTime: number) {
  const found = gexSnapshotIndex(gex, hoverTime)?.value;
  return found ? { totalGex: found.totalGex, gammaFlipLevel: found.gammaFlipLevel, iso: gexSnapshotIso(found) } : null;
}

export function findLatestWallSnapshotAtTime(wallHistory: readonly PcsWallHistoryPoint[], hoverTime: number) {
  const found = wallSnapshotIndex(wallHistory, hoverTime);
  if (!found) return null;
  // Preserve the previous source-row semantics, including unordered input.
  return { current: found.value, previous: found.sourceIndex > 0 ? wallHistory[found.sourceIndex - 1]! : null };
}

// 只记录真的换墙事件：空值和同价位轮询不会产生迁移标记。
export function buildWallMoves(wallHistory: readonly PcsWallHistoryPoint[]) {
  const snapshots = wallHistory
    .map((point) => ({ ...point, chartTime: chartTime(point.time) }))
    .filter((point) => Number.isFinite(Number(point.chartTime)))
    .sort((left, right) => Number(left.chartTime) - Number(right.chartTime));
  return snapshots.flatMap((current, index) => {
    const previous = snapshots[index - 1];
    if (!previous) return [];
    return (['call', 'put'] as const).flatMap((side) => {
      const previousStrike = side === 'call' ? previous.callWallPrice : previous.putWallPrice;
      const currentStrike = side === 'call' ? current.callWallPrice : current.putWallPrice;
      if (!Number.isFinite(previousStrike) || !Number.isFinite(currentStrike) || previousStrike === null || currentStrike === null || previousStrike <= 0 || currentStrike <= 0 || previousStrike === currentStrike) return [];
      return [{ key: `${side}-${previous.time}-${current.time}`, side, fromTime: previous.chartTime, fromStrike: previousStrike, toTime: current.chartTime, toStrike: currentStrike }];
    });
  });
}

/** 把离散的 wall 快照接成阶梯轨迹：横段代表保持，竖段代表换墙。 */
/** Historical paths may enter the viewport with both endpoints outside it.
 * Keep finite coordinates and let the pane's canvas clip the actual path. */
export function gexHistoryCoordinate(value: number | null) {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function buildWallStepSegments(wallHistory: readonly PcsWallHistoryPoint[]) {
  type WallStepSource = { time: Time; price: number | null; magnitude: number | null | undefined };
  const buildForSide = (side: 'call' | 'put') => wallHistory
    .map((point): WallStepSource => ({ time: chartTime(point.time), price: side === 'call' ? point.callWallPrice : point.putWallPrice, magnitude: side === 'call' ? point.callWallMagnitude : point.putWallMagnitude }))
    .filter((point): point is WallStepSource & { price: number; magnitude: number } => Number.isFinite(Number(point.time)) && typeof point.price === 'number' && Number.isFinite(point.price) && point.price > 0 && typeof point.magnitude === 'number' && Number.isFinite(point.magnitude))
    .sort((left, right) => Number(left.time) - Number(right.time))
    .flatMap((point, index, points) => {
      const next = points[index + 1];
      return next ? [{ side, startTime: point.time, endTime: next.time, startPrice: point.price, endPrice: next.price, magnitude: point.magnitude }] : [];
    });
  return [...buildForSide('call'), ...buildForSide('put')];
}

// 竖向墙位梯子每根柱子的宽度（独立于坐标转换，纯函数可测）：按 |magnitude| 归一化到 6-64px，柱子从右边缘往左长。
export function gexLadderBarWidth(magnitude: number, maxAbs: number) {
  if (!Number.isFinite(magnitude) || !Number.isFinite(maxAbs) || maxAbs <= 0) return 0;
  const ratio = Math.min(1, Math.abs(magnitude) / maxAbs);
  return Math.round(6 + ratio * 58);
}

export function gexTrailLineWidth(magnitude: number, maxAbs: number, emphasis = false) {
  if (!Number.isFinite(magnitude) || !Number.isFinite(maxAbs) || maxAbs <= 0) return emphasis ? 4 : 2;
  const ratio = Math.min(1, Math.abs(magnitude) / maxAbs);
  return Math.max(emphasis ? 4 : 2, Math.round((emphasis ? 4 : 2) + ratio * (emphasis ? 9 : 7)));
}

// 原生 CustomSeries：图表引擎负责时间/价格转换和 pane 裁剪。
// 窄亮芯与渐隐光晕表达强弱；换价或缺失快照断开，保持实际 strike 和时间。
// 正负两侧独立归一化，切换另一侧不会改变本侧的厚度和透明度。
export function gexSnapshotMagnitudeScales(strikes: readonly { magnitude: number; emphasized: boolean }[]) {
  const scales = { king: 1e-9, positive: 1e-9, negative: 1e-9 };
  for (const strike of strikes) {
    if (!Number.isFinite(strike.magnitude)) continue;
    const key = strike.emphasized ? 'king' : strike.magnitude >= 0 ? 'positive' : 'negative';
    scales[key] = Math.max(scales[key], Math.abs(strike.magnitude));
  }
  return scales;
}
// Small reusable glow textures: no per-frame blur/filter or full-canvas passes.
function createGexGlowTexture(color: string, cap: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = cap ? 64 : 2;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = cap ? ctx.createRadialGradient(32, 32, 0, 32, 32, 32) : ctx.createLinearGradient(0, 0, 0, 64);
  const withAlpha = (alpha: number) => {
    const hex = color.replace('#', '');
    const rgb = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${rgb.join(',')},${alpha})`;
  };
  // Gaussian falloff, including a wide low-opacity halo, rather than a hard
  // triangular edge. Texture is generated once per role color.
  for (let step = 0; step <= 32; step++) {
    const position = step / 32;
    const distance = cap ? position : Math.abs(position - 0.5) * 2;
    const alpha = distance >= 1 ? 0 : Math.exp(-distance * distance / (2 * 0.25 * 0.25));
    gradient.addColorStop(position, withAlpha(alpha));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
/** CSS pixel scale: narrow charts retain readable candles; zoom reveals width detail. */
export function gexSnapshotViewportScale(barSpacing: number, paneHeight: number) {
  if (!Number.isFinite(barSpacing) || !Number.isFinite(paneHeight) || barSpacing <= 0 || paneHeight <= 0) return 0.35;
  return Math.max(0.35, Math.min(1.6, barSpacing / 7, paneHeight / 360));
}
/** Scale in CSS pixels from the actual price-axis gap; widest halo stays within its strike row. */
export function gexSnapshotPriceScale(viewportScale: number, strikeGap: number | null) {
  if (strikeGap === null || !Number.isFinite(strikeGap) || strikeGap <= 0) return viewportScale;
  return Math.min(2.5, viewportScale * strikeGap / 16, strikeGap / 70);
}
/** A known snapshot occupies its time cell even if that strike drops out next. */
export function gexSnapshotSegmentEnd(x: number, time: number, next: { x: number; time: number } | null, barSpacing: number) {
  if (next && next.time > time && next.time - time <= 300) return next.x;
  return x + Math.max(1, Math.min(12, barSpacing * 0.8));
}
/** Smooth visual interpolation only; source values and hover snapshots stay exact. */
export function gexSnapshotBlend(from: number, to: number, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return from + (to - from) * t * t * (3 - 2 * t);
}
export class PcsGexSnapshotRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, PcsNativeSnapshotData> | null = null;
  private tracks: PcsSnapshotTrackPoint[][] = [];
  private scales = { king: 1e-9, positive: 1e-9, negative: 1e-9 };
  private strikeSteps = new Map<PcsNativeSnapshotStrike, number>();
  private glowTextures = new Map<string, { body: HTMLCanvasElement; cap: HTMLCanvasElement }>();
  private readonly topology = createQqqOriginalDataCache((source: readonly PcsNativeSnapshotData[]) => {
    const scales = gexSnapshotMagnitudeScales(source.flatMap(bar => bar.strikes));
    const tracks = new Map<string, PcsSnapshotTrackPoint[]>();
    const strikeSteps = new Map<PcsNativeSnapshotStrike, number>();
    for (let barIndex = 0; barIndex < source.length; barIndex += 1) {
      const sorted = [...source[barIndex]!.strikes].sort((a,b)=>a.strike-b.strike);
      for (let index=0;index<sorted.length;index++) {
        const strike=sorted[index]!;
        const gaps=[sorted[index-1] ? strike.strike-sorted[index-1]!.strike : Infinity,sorted[index+1] ? sorted[index+1]!.strike-strike.strike : Infinity].filter(gap=>gap>0&&Number.isFinite(gap));
        strikeSteps.set(strike,gaps.length ? Math.min(...gaps) : 1);
      }
      for (const strike of source[barIndex]!.strikes) {
        // The price row stays continuous when its sign or wall role changes.
        // Source role/color remain on each point; missing rows still break the run.
        const row = `strike:${strike.strike}`;
        const points = tracks.get(row) ?? [];
        points.push({ barIndex, strike });
        tracks.set(row, points);
      }
    }
    return { scales, tracks: [...tracks.values()], strikeSteps };
  });

  update(data: PaneRendererCustomData<Time, PcsNativeSnapshotData>) {
    this.data = data;
    // Lightweight Charts recreates coordinate wrappers on viewport updates.
    // Cache by immutable originalData, never by the wrapper array identity.
    const topology = this.topology(data.bars);
    this.scales = topology.scales;
    this.tracks = topology.tracks;
    this.strikeSteps = topology.strikeSteps;
  }

  draw(target: PcsBitmapCanvasTarget, priceToCoordinate: (price: number) => number | null) {
    const data = this.data;
    if (!data?.visibleRange) return;
    const from = Math.max(0, data.visibleRange.from);
    const to = Math.min(data.bars.length, data.visibleRange.to + 1);
    const maxFor = (strike: PcsNativeSnapshotStrike) => this.scales[strike.emphasized ? 'king' : strike.magnitude >= 0 ? 'positive' : 'negative'];
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const barSpacing = to - from > 1 ? Math.abs(data.bars[to - 1]!.x - data.bars[from]!.x) / (to - from - 1) : 7;
      const viewportScale = gexSnapshotViewportScale(barSpacing, context.canvas.height / verticalPixelRatio);
      for (const points of this.tracks) {
        const startIndex = qqqTrackLowerBound(points, Math.max(0, from - 1));
        for (let index = startIndex; index < points.length && points[index]!.barIndex < to; index += 1) {
          const current = points[index]!;
          const next = points[index + 1];
          const currentY = priceToCoordinate(current.strike.strike);
          if (currentY === null || !Number.isFinite(currentY)) continue;
          const neighborY = priceToCoordinate(current.strike.strike + (this.strikeSteps.get(current.strike) ?? 1));
          const priceScale = gexSnapshotPriceScale(viewportScale, neighborY === null ? null : Math.abs(neighborY-currentY));
          const metrics = gexSnapshotGlyphMetrics(current.strike.magnitude, maxFor(current.strike), current.strike.emphasized);
          const x = data.bars[current.barIndex]!.x * horizontalPixelRatio;
          const y = currentY * verticalPixelRatio;
          const adjacent = next?.barIndex === current.barIndex + 1 && next.strike.strike === current.strike.strike
            && Number(data.bars[next.barIndex]!.originalData.time) - Number(data.bars[current.barIndex]!.originalData.time) <= 300;
          const followingBar = data.bars[current.barIndex + 1];
          const nextX = gexSnapshotSegmentEnd(data.bars[current.barIndex]!.x, Number(data.bars[current.barIndex]!.originalData.time),
            followingBar ? { x: followingBar.x, time: Number(followingBar.originalData.time) } : null, barSpacing) * horizontalPixelRatio;
          const previous = points[index - 1];
          const startsRun = !previous || previous.barIndex !== current.barIndex - 1 || previous.strike.strike !== current.strike.strike
            || Number(data.bars[current.barIndex]!.originalData.time) - Number(data.bars[previous.barIndex]!.originalData.time) > 300;
          let textures = this.glowTextures.get(current.strike.color);
          if (!textures) {
            textures = { body: createGexGlowTexture(current.strike.color, false), cap: createGexGlowTexture(current.strike.color, true) };
            this.glowTextures.set(current.strike.color, textures);
          }
          // Center is sharp, halo fades into the background. Intensity, rather than
          // a tall opaque rectangle, communicates GEX strength; strike/time stay exact.
          const glowHeight = metrics.bodyHeight * priceScale * 4 * verticalPixelRatio;
          const capWidth = Math.min(Math.max(2, metrics.bodyHeight * priceScale * 0.7), Math.max(2, barSpacing * 0.4)) * horizontalPixelRatio;
          // Fill every device pixel between snapshots. Smooth thickness/brightness
          // transitions remove the candle-cell seams without bridging missing data.
          const nextMetrics = adjacent ? gexSnapshotGlyphMetrics(next!.strike.magnitude, maxFor(next!.strike), next!.strike.emphasized) : metrics;
          const nextNeighborY = adjacent ? priceToCoordinate(next!.strike.strike + (this.strikeSteps.get(next!.strike) ?? 1)) : null;
          const nextScale = adjacent ? gexSnapshotPriceScale(viewportScale, nextNeighborY === null ? null : Math.abs(nextNeighborY - currentY)) : priceScale;
          const endHeight = nextMetrics.bodyHeight * nextScale * 4 * verticalPixelRatio;
          let followingTextures = textures;
          if (adjacent && next!.strike.color !== current.strike.color) {
            const color = next!.strike.color;
            let cached = this.glowTextures.get(color);
            if (!cached) {
              cached = { body: createGexGlowTexture(color, false), cap: createGexGlowTexture(color, true) };
              this.glowTextures.set(color, cached);
            }
            followingTextures = cached;
          }
          const coreHeight = Math.max(0.5, metrics.bodyHeight * priceScale * 0.35) * verticalPixelRatio;
          const endCoreHeight = adjacent ? Math.max(0.5, nextMetrics.bodyHeight * nextScale * 0.35) * verticalPixelRatio : coreHeight;
          const span = Math.max(horizontalPixelRatio, nextX - x);
          const left = Math.max(0, Math.floor(x));
          const right = Math.min(context.canvas.width, Math.ceil(x + span));
          for (let pixel = left; pixel < right; pixel += 1) {
            const progress = (pixel + 0.5 - x) / span;
            const height = gexSnapshotBlend(glowHeight, endHeight, progress);
            const blend = gexSnapshotBlend(0, 1, progress);
            const alpha = gexSnapshotBlend(metrics.bodyAlpha, nextMetrics.bodyAlpha, progress);
            context.globalAlpha = followingTextures === textures ? alpha : alpha * (1 - blend);
            context.drawImage(textures.body, pixel, y - height / 2, 1, height);
            if (followingTextures !== textures) {
              context.globalAlpha = alpha * blend;
              context.drawImage(followingTextures.body, pixel, y - height / 2, 1, height);
            }
            // Fill the core with the same pixel boundaries as its halo. Independent
            // stroked segments can leave antialiased end seams at high zoom/DPR.
            const core = gexSnapshotBlend(coreHeight, endCoreHeight, progress);
            context.fillStyle = blend < 0.5 ? current.strike.color : (adjacent ? next!.strike.color : current.strike.color);
            context.globalAlpha = gexSnapshotBlend(metrics.wickAlpha, nextMetrics.wickAlpha, progress);
            context.fillRect(pixel, y - core / 2, 1, core);
          }
          context.globalAlpha = metrics.bodyAlpha;
          if (startsRun) context.drawImage(textures.cap, 0, 0, 32, 64, x - capWidth, y - glowHeight / 2, capWidth, glowHeight);
          if (!adjacent) context.drawImage(textures.cap, 32, 0, 32, 64, nextX, y - glowHeight / 2, capWidth, glowHeight);

        }
      }
      context.globalAlpha = 1;
    });
  }
}

/** King 与普通 strike 分组归一化后的 Ribbon 尺寸；导出以锁定“普通 strike 也能看出强弱”的回归。 */
export function gexSnapshotGlyphMetrics(magnitude: number, maxAbs: number, emphasized: boolean) {
  if (!Number.isFinite(magnitude) || !Number.isFinite(maxAbs) || maxAbs <= 0) return { bodyHeight: 0, bodyWidth: 0, wickAlpha: 0, bodyAlpha: 0 };
  const ratio = Math.min(1, Math.abs(magnitude) / maxAbs);
  return {
    bodyHeight: Number(((emphasized ? 2 : 1) + ratio * (emphasized ? 12 : 10)).toFixed(2)),
    bodyWidth: Math.round((emphasized ? 7 : 4) + ratio * (emphasized ? 5 : 8)),
    wickAlpha: Number((emphasized ? 0.55 : 0.12 + ratio * 0.38).toFixed(2)),
    // King 保留白色身份；用窄亮芯和柔和光晕避免覆盖 K 线。
    bodyAlpha: Number((emphasized ? 0.26 : 0.2 + Math.sqrt(ratio) * 0.68).toFixed(2)),
  };
}

class PcsGexSnapshotPaneView implements ICustomSeriesPaneView<Time, PcsNativeSnapshotData, CustomSeriesOptions> {
  private readonly rendererInstance = new PcsGexSnapshotRenderer();

  renderer() { return this.rendererInstance; }

  update(data: PaneRendererCustomData<Time, PcsNativeSnapshotData>) { this.rendererInstance.update(data); }

  priceValueBuilder(data: PcsNativeSnapshotData) {
    const strikes = data.strikes.map((strike) => strike.strike).filter(Number.isFinite);
    if (!strikes.length) return [0, 0, 0];
    return [Math.min(...strikes), Math.max(...strikes), strikes.at(-1)!];
  }

  isWhitespace(data: PcsNativeSnapshotData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('strikes' in data) || data.strikes.length === 0;
  }

  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions, color: 'transparent', lastValueVisible: false, priceLineVisible: false };
  }
}

class PcsExtendedHoursShadeRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, PcsExtendedHoursShadeData> | null = null;

  update(data: PaneRendererCustomData<Time, PcsExtendedHoursShadeData>) { this.data = data; }

  draw(target: PcsBitmapCanvasTarget) {
    const data = this.data;
    if (!data?.visibleRange) return;
    const from = Math.max(0, data.visibleRange.from);
    const to = Math.min(data.bars.length - 1, data.visibleRange.to);
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio }) => {
      for (let index = from; index < to; index += 1) {
        const current = data.bars[index]!;
        const next = data.bars[index + 1]!;
        const shade = current.originalData.shade;
        if (!shade) continue;
        const left = Math.round(current.x * horizontalPixelRatio);
        const right = Math.round(next.x * horizontalPixelRatio);
        context.fillStyle = shade === 'pre' ? 'rgba(37, 99, 235, .11)' : 'rgba(168, 85, 247, .11)';
        context.fillRect(left, 0, Math.max(1, right - left), context.canvas.height);
      }
    });
  }
}

class PcsExtendedHoursShadePaneView implements ICustomSeriesPaneView<Time, PcsExtendedHoursShadeData, CustomSeriesOptions> {
  private readonly rendererInstance = new PcsExtendedHoursShadeRenderer();
  renderer() { return this.rendererInstance; }
  update(data: PaneRendererCustomData<Time, PcsExtendedHoursShadeData>) { this.rendererInstance.update(data); }
  priceValueBuilder(data: PcsExtendedHoursShadeData) { return [data.price]; }
  isWhitespace(data: PcsExtendedHoursShadeData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> { return !('price' in data); }
  defaultOptions(): CustomSeriesOptions { return customSeriesDefaultOptions; }
}

// 日内交易区采用和布林带相似的双 Ribbon 表达，但含义仍是结构价带：
// 绿色为低位区、红色为高位区；进入某条带时提高该段透明度。
class PcsIntradayZoneBandRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, PcsIntradayZoneBandData> | null = null;

  update(data: PaneRendererCustomData<Time, PcsIntradayZoneBandData>) { this.data = data; }

  draw(target: PcsBitmapCanvasTarget, priceToCoordinate: (price: number) => number | null) {
    const data = this.data;
    if (!data?.visibleRange) return;
    const from = Math.max(0, data.visibleRange.from - 1);
    const to = Math.min(data.bars.length - 1, data.visibleRange.to + 1);
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      const drawBand = (
        current: PaneRendererCustomData<Time, PcsIntradayZoneBandData>['bars'][number],
        next: PaneRendererCustomData<Time, PcsIntradayZoneBandData>['bars'][number],
        side: 'LOW' | 'HIGH',
      ) => {
        const currentTime = Number(current.originalData.time);
        const nextTime = Number(next.originalData.time);
        if ((side === 'LOW' && (!current.originalData.showLow || !next.originalData.showLow)) || (side === 'HIGH' && (!current.originalData.showHigh || !next.originalData.showHigh))) return;
        // 不跨午间数据缺口或隔夜硬连，避免把两个独立交易阶段画成一整条带。
        if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime) || nextTime - currentTime > 300) return;
        const currentLower = side === 'LOW' ? current.originalData.lowLower : current.originalData.highLower;
        const currentUpper = side === 'LOW' ? current.originalData.lowUpper : current.originalData.highUpper;
        const nextLower = currentLower;
        const nextUpper = currentUpper;
        const y1Lower = priceToCoordinate(currentLower);
        const y1Upper = priceToCoordinate(currentUpper);
        const y2Lower = priceToCoordinate(nextLower);
        const y2Upper = priceToCoordinate(nextUpper);
        if ([y1Lower, y1Upper, y2Lower, y2Upper].some((value) => value === null || !Number.isFinite(value))) return;
        const x1 = Math.round(current.x * horizontalPixelRatio);
        const x2 = Math.round(next.x * horizontalPixelRatio);
        const scaleY = (value: number | null) => Math.round(Number(value) * verticalPixelRatio);
        const lower1 = scaleY(y1Lower);
        const upper1 = scaleY(y1Upper);
        const lower2 = scaleY(y2Lower);
        const upper2 = scaleY(y2Upper);
        const active = current.originalData.activeSide === side || next.originalData.activeSide === side;
        const rgb = side === 'LOW' ? '52, 211, 153' : '251, 113, 133';
        context.beginPath();
        context.moveTo(x1, upper1);
        context.lineTo(x2, upper2);
        context.lineTo(x2, lower2);
        context.lineTo(x1, lower1);
        context.closePath();
        context.fillStyle = `rgba(${rgb}, ${active ? 0.3 : 0.16})`;
        context.fill();
        context.strokeStyle = `rgba(${rgb}, ${active ? 0.98 : 0.78})`;
        context.lineWidth = Math.max(1, Math.round((active ? 2 : 1.4) * verticalPixelRatio));
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(x1, upper1);
        context.lineTo(x2, upper2);
        context.moveTo(x1, lower1);
        context.lineTo(x2, lower2);
        context.stroke();
      };
      for (let index = from; index < to; index += 1) {
        const current = data.bars[index];
        const next = data.bars[index + 1];
        if (!current || !next) continue;
        drawBand(current, next, 'LOW');
        drawBand(current, next, 'HIGH');
      }
    });
  }
}

class PcsIntradayZoneBandPaneView implements ICustomSeriesPaneView<Time, PcsIntradayZoneBandData, CustomSeriesOptions> {
  private readonly rendererInstance = new PcsIntradayZoneBandRenderer();
  renderer() { return this.rendererInstance; }
  update(data: PaneRendererCustomData<Time, PcsIntradayZoneBandData>) { this.rendererInstance.update(data); }
  priceValueBuilder(data: PcsIntradayZoneBandData) { const values = [...(data.showLow ? [data.lowLower, data.lowUpper] : []), ...(data.showHigh ? [data.highLower, data.highUpper] : [])]; return values.length ? values : [data.referencePrice ?? data.lowLower]; }
  isWhitespace(data: PcsIntradayZoneBandData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('lowLower' in data);
  }
  defaultOptions(): CustomSeriesOptions {
    return { ...customSeriesDefaultOptions, color: 'transparent', lastValueVisible: false, priceLineVisible: false };
  }
}

export function sampleGexProfileHistory<T>(snapshots: readonly T[], maxSnapshots = MAX_RENDERED_GEX_PROFILE_SNAPSHOTS): readonly T[] {
  if (snapshots.length <= maxSnapshots || maxSnapshots < 2) return snapshots;
  const indexes = new Set<number>();
  for (let slot = 0; slot < maxSnapshots; slot += 1) {
    indexes.add(Math.round(slot * (snapshots.length - 1) / (maxSnapshots - 1)));
  }
  return snapshots.filter((_, index) => indexes.has(index));
}

export function buildNativeGexSnapshotSeriesData(profileHistory: readonly PcsGexProfileHistoryPoint[], wallHistory: readonly PcsWallHistoryPoint[], hidden: { positive: boolean; negative: boolean; wallHistory: boolean; king?: boolean; callWall?: boolean; putWall?: boolean }): PcsNativeSnapshotData[] {
  const renderedProfileHistory = profileHistory;
  const kingByTime = new Map(wallHistory.map((point) => [point.time, point.kingStrike]));
  // 全部已有 profile 快照保留；仅在可见范围绘制，wall fallback 不重复追加。
  const profileTimes = new Set(profileHistory.filter((point) => point.strikes.length > 0).map((point) => point.time));
  const grouped = new Map<number, Map<number, PcsNativeSnapshotStrike>>();
  const push = (time: string, strike: number, magnitude: number, kind: 'king' | 'call' | 'put' | 'positive' | 'negative') => {
    const chartTimestamp = chartTime(time);
    if (!Number.isFinite(Number(chartTimestamp)) || !Number.isFinite(strike) || strike <= 0 || !Number.isFinite(magnitude)) return;
    if ((kind === 'positive' && hidden.positive) || (kind === 'negative' && hidden.negative) || (kind === 'king' && hidden.king) || (kind === 'call' && hidden.callWall) || (kind === 'put' && hidden.putWall)) return;
    const strikes = grouped.get(Number(chartTimestamp)) ?? new Map<number, PcsNativeSnapshotStrike>();
    const next = {
      strike,
      magnitude,
      color: kind === 'king' ? '#e2e8f0' : kind === 'call' ? qqqGexCallColor : kind === 'put' ? qqqGexPutColor : kind === 'positive' ? qqqGexPositiveColor : qqqGexNegativeColor,
      outlined: kind === 'king' || kind === 'call' || kind === 'put',
      emphasized: kind === 'king',
      // 主墙按角色跨 strike 连续；普通 profile 则按相同 strike 连续，避免把不相干的次级墙硬连起来。
      track: kind === 'king' || kind === 'call' || kind === 'put' ? kind : `strike:${kind}:${strike}`,
    };
    const current = strikes.get(strike);
    // 同一 snapshot 的 King 与同价位 Call/Put Wall 是同一流动性节点。King 优先，避免三层 glyph 叠在一起。
    if (!current || (next.emphasized && !current.emphasized)) strikes.set(strike, next);
    grouped.set(Number(chartTimestamp), strikes);
  };
  for (const snapshot of renderedProfileHistory) for (const point of snapshot.strikes) {
    const isVisibleKing = kingByTime.get(snapshot.time) === point.strike && !hidden.king;
    push(snapshot.time, point.strike, point.magnitude, isVisibleKing ? 'king' : point.isCallWall && !hidden.callWall ? 'call' : point.isPutWall && !hidden.putWall ? 'put' : point.magnitude >= 0 ? 'positive' : 'negative');
  }
  if (!hidden.wallHistory) for (const point of wallHistory) {
    if (profileTimes.has(point.time)) continue;
    if (point.callWallPrice !== null && point.callWallMagnitude !== null && point.callWallMagnitude !== undefined) push(point.time, point.callWallPrice, point.callWallMagnitude, 'call');
    if (point.putWallPrice !== null && point.putWallMagnitude !== null && point.putWallMagnitude !== undefined) push(point.time, point.putWallPrice, point.putWallMagnitude, 'put');
    if (point.kingStrike !== null && point.kingStrike !== undefined && point.kingMagnitude !== null && point.kingMagnitude !== undefined) push(point.time, point.kingStrike, point.kingMagnitude, 'king');
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([time, strikes]) => ({ time: time as Time, strikes: [...strikes.values()].sort((left, right) => left.strike - right.strike) }));
}

type HistoricalLevelPoint = { time: Time; end?: Time; price: number | null; magnitude?: number | null };
type HistoricalLevelSegment = { price: number; start: Time; end: Time; magnitude: number; width: number; widthBucket: number };

// 每个快照默认持续到下一个快照。这样某条线就算只存在一个 5m 桶，也会显示成一小段，不会因为 start=end 被吞掉。
// 合并条件是 “同价位 + 同宽度桶 + 时间连续”，既保留轨迹，也保留厚度变化。
export function buildHistoricalLevelSegments(points: ReadonlyArray<HistoricalLevelPoint>, emphasis = false): HistoricalLevelSegment[] {
  const finite = points
    .filter((point): point is HistoricalLevelPoint & { price: number; magnitude: number } =>
      Number.isFinite(Number(point.time))
      && Number.isFinite(point.price)
      && (point.price as number) > 0
      && Number.isFinite(point.magnitude)
    )
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));
  if (!finite.length) return [];
  const maxAbs = Math.max(...finite.map((point) => Math.abs(point.magnitude)), 1e-9);
  const segments: HistoricalLevelSegment[] = [];
  for (let index = 0; index < finite.length; index += 1) {
    const point = finite[index]!;
    const next = finite[index + 1];
    const width = gexTrailLineWidth(point.magnitude, maxAbs, emphasis);
    const widthBucket = Math.max(emphasis ? 4 : 2, Math.round(width / 2));
    const pointTime = Number(point.time);
    // A final observation is a point-in-time state unless the producer gives
    // it an explicit end. Extending it by an arbitrary 5 minutes makes the
    // wall history appear alive after the last snapshot and breaks the
    // interval contract used by the display layer.
    const rawEnd = point.end === undefined ? (next ? Number(next.time) : pointTime) : Number(point.end);
    const end = (rawEnd > pointTime ? rawEnd : pointTime) as Time;
    const last = segments.at(-1);
    if (last && last.price === point.price && last.widthBucket === widthBucket && Number(last.end) === pointTime) {
      last.end = end;
      last.magnitude = point.magnitude;
      last.width = width;
      continue;
    }
    segments.push({ price: point.price, start: point.time, end, magnitude: point.magnitude, width, widthBucket });
  }
  return segments;
}

// 兼容旧调用方：仅保留同价位连续段，不关心厚度。
export function groupWallSegments(points: ReadonlyArray<{ time: Time; price: number | null }>): Array<{ price: number; start: Time; end: Time }> {
  return buildHistoricalLevelSegments(points.map((point) => ({ ...point, magnitude: 1 })))
    .map((segment) => ({ price: segment.price, start: segment.start, end: segment.end }));
}

const gexMagnitudeFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const formatGexMagnitude = (value: number) => `${value < 0 ? '-' : ''}$${gexMagnitudeFormatter.format(Math.abs(value))}`;

const chartSignatureCache = new WeakMap<readonly unknown[], string>();
function chartDataSignature(value: readonly unknown[]) {
  let signature = chartSignatureCache.get(value);
  if (signature === undefined) {
    signature = JSON.stringify(value);
    chartSignatureCache.set(value, signature);
  }
  return signature;
}
const formatGexAxis = (value: number) => `${(value / 1_000_000).toFixed(1)}M`;
const formatEasternSnapshot = (value: string | null | undefined, withSeconds = true) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('zh-CN', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    month: '2-digit',
    day: '2-digit',
  });
};

const chartTime = (value: string) => Math.floor(new Date(value).getTime() / 1000) as Time;
const chartTimeForGranularity = (value: string, granularity: '2m' | '5m' | '1d') => {
  const time = Number(chartTime(value));
  if (!Number.isFinite(time)) return NaN as Time;
  const bucketSeconds = granularity === '2m' ? 120 : 300;
  return (granularity !== '1d' ? Math.floor(time / bucketSeconds) * bucketSeconds : time) as Time;
};
export { parseStoredPriceRange, parseStoredTimeRange } from './qqqChartDisplayPreferences';

/** 仅保存用户缩放/拖拽产生的有效逻辑时间窗；刷新重建时用它替代 fitContent。 */
export const validVisibleLogicalRange = (range: { from: number; to: number } | null): { from: number; to: number } | null => (
  range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from
    ? { from: range.from, to: range.to }
    : null
);

/** Keep useful data in view when a saved window belongs to a longer historical series. */
export function restoreQqqDataWindow(range: { from: number; to: number }, first: number, last: number) {
  const width = range.to - range.from;
  const overlap = Math.max(0, Math.min(range.to, last + 1) - Math.max(range.from, first));
  if (overlap >= Math.min(10, width, last - first + 1) / 2) return range;
  const restoredWidth = Math.min(Math.max(10, width), last - first + 24);
  return { from: last + 12 - restoredWidth, to: last + 12 };
}

export function shiftQqqViewportForPrepend(range: { from: number; to: number }, oldIndex: number, newIndex: number) {
  const shift = newIndex - oldIndex;
  return { from: range.from + shift, to: range.to + shift };
}

/** GEX 大图保留约 12 根 bar 的观察空白，并允许用户继续向左拖出更多空白。 */
export const qqqPcsTimeScaleNavigation = (showGex: boolean) => ({
  fixLeftEdge: true,
  fixRightEdge: false,
  rightOffset: showGex ? 12 : 0,
});
export const pickPersistedLiveCandle = (existing: PcsLiveCandle | null, latestBarTime: number, latestClose: number): PcsLiveCandle | null => {
  if (!existing || !Number.isFinite(existing.time) || existing.time < latestBarTime) return null;
  const fallback = Number.isFinite(latestClose) ? latestClose : existing.close;
  return {
    time: existing.time,
    open: Number.isFinite(existing.open) ? existing.open : fallback,
    high: Number.isFinite(existing.high) ? existing.high : Math.max(fallback, existing.close),
    low: Number.isFinite(existing.low) ? existing.low : Math.min(fallback, existing.close),
    close: Number.isFinite(existing.close) ? existing.close : fallback,
  };
};
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function cachedDateFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let formatter = dateFormatters.get(key);
  if (!formatter) { formatter = new Intl.DateTimeFormat(locale, options); dateFormatters.set(key, formatter); }
  return formatter;
}
const easternClockFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', hour12: false, minute: '2-digit', timeZone: 'America/New_York' });
const easternCalendarFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York' });
const formatEasternTime = (time: Time) => typeof time === 'number' ? easternClockFormatter.format(new Date(time * 1000)) : '';
const formatEasternDate = (time: Time) => typeof time === 'number' ? easternCalendarFormatter.format(new Date(time * 1000)) : '';
const formatEasternTick: TickMarkFormatter = formatEasternTime;
const formatEasternCrosshairLabel = (time: Time) => typeof time === 'number' ? `${formatEasternDate(time)} ${formatEasternTime(time)}` : '';
export const formatGexHistoryTimestamp = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  const parts = cachedDateFormatter('en-US', {
    day: '2-digit', hour: '2-digit', hour12: false, minute: '2-digit', month: '2-digit', timeZone: 'America/New_York',
  }).formatToParts(date);
  const value = (type: 'month' | 'day' | 'hour' | 'minute') => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
};

const gexEasternDateKey = (iso: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = cachedDateFormatter('en-US', {
    day: '2-digit', month: '2-digit', timeZone: 'America/New_York', year: 'numeric',
  }).formatToParts(date);
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** 实时表只聚焦最新美东交易日；输入数组不变，完整历史继续保留用于缓存与回测。 */
export function selectLatestEasternDayRows<T extends { iso: string }>(rows: readonly T[]): T[] {
  const latest = rows.reduce<{ row: T; time: number } | null>((current, row) => {
    const time = Date.parse(row.iso);
    return !Number.isFinite(time) || (current && current.time >= time) ? current : { row, time };
  }, null);
  const latestDate = latest ? gexEasternDateKey(latest.row.iso) : null;
  return latestDate === null ? [] : rows.filter((row) => gexEasternDateKey(row.iso) === latestDate);
}

const easternDateKeyForTime = (time: Time) => {
  const parts = cachedDateFormatter('en-US', { day: '2-digit', month: '2-digit', timeZone: 'America/New_York', year: 'numeric' }).formatToParts(new Date(Number(time) * 1000));
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** Expiry date is not the observation date. Keep old structure off today's price session. */
export function isQqqGexSnapshotInPriceSession(snapshotAt: string | null, priceAt: string | null) {
  const snapshot = snapshotAt ? Date.parse(snapshotAt) : NaN;
  const price = priceAt ? Date.parse(priceAt) : NaN;
  return Number.isFinite(snapshot) && Number.isFinite(price)
    && easternDateKeyForTime((snapshot / 1000) as Time) === easternDateKeyForTime((price / 1000) as Time);
}

export const qqqPcsSessionWindow = sharedSessionWindow;

export const qqqPcsSessionAnchor = (sessionWindow: { from: Time; to: Time } | null, lastRealBarTime?: Time | null, bucketSeconds = 300) => {
  if (!sessionWindow) return [];
  const from = Number(lastRealBarTime ?? sessionWindow.from);
  const to = Number(sessionWindow.to);
  const points: Array<{ time: Time; value: number }> = [];
  // 只从最后一根真实 bar 往后补未来空白，避免在已有 bar 区间里插入锚点，把每根蜡烛之间挤出一个“假空槽”。
  // 未来空白仍需按 bar 粒度(5min)补满，否则收盘前的空白时段会被压缩成和单根 bar 一样窄。
  for (let time = from; time < to; time += bucketSeconds) points.push({ time: time as Time, value: 0 });
  points.push({ time: to as Time, value: 0 });
  return points;
};

export { buildObservedPriceLowMarkers, buildShortTermReversalMarkers } from './QqqPcsIntradayChart.shared';
export const buildQqqPcsIntradayChartData = sharedChartData;

function extendedHoursKind(time: Time): 'pre' | 'post' | null {
  const session = qqqMarketSession(new Date(Number(time) * 1000));
  return session.premarket ? 'pre' : session.postmarket ? 'post' : null;
}

export function buildExtendedHoursShadeSeries(price: readonly { time: Time; value: number }[]): PcsExtendedHoursShadeData[] {
  return price.map((point) => ({ time: point.time, price: point.value, shade: extendedHoursKind(point.time) }));
}

export default function QqqPcsIntradayChart({ active = true, bars, extendedHoursBars, extendedHoursVisible, onExtendedHoursVisibleChange, onVisibleTimeRangeChange, scores, dailyScore, confirmation, gex, gexProfile, gexProfileHistory, gexObservationHistory, gexSummary: sourceGexSummary = null, wallHistory, gexInsights, gammaModel = null, gammaExpiryDate, gammaPositionHistory = EMPTY_GAMMA_POSITION_HISTORY, snapshotAsOf = null, gexDte = 0, granularity = '2m', historical = false, premarket = false, showGex = false, showAuxSeries = true, showGexTable = true, directionalSignals = emptyDirectionalChartSignals, chartLegendTarget, structureObservationTarget, snapshotTableTarget, fillHeight = false, height = 210, renderer = 'lightweight' }: { active?: boolean; bars: readonly PcsIntradayChartBar[]; extendedHoursBars?: readonly PcsIntradayChartBar[]; extendedHoursVisible?: boolean; onExtendedHoursVisibleChange?: (visible: boolean) => void; onVisibleTimeRangeChange?: (range: { from: number; to: number }) => void; scores: readonly PcsIntradayScorePoint[]; dailyScore?: number; confirmation?: number; gex?: readonly PcsGexPoint[]; gexProfile?: readonly PcsGexProfilePoint[]; gexProfileHistory?: readonly PcsGexProfileHistoryPoint[]; gexObservationHistory?: readonly {time:string;strikes:readonly GexObservationStrike[]}[]; gexSummary?: PcsGexSummary | null; wallHistory?: readonly PcsWallHistoryPoint[]; gexInsights?: PcsGexInsights | null; gammaModel?: QqqGammaModel | null; gammaExpiryDate?: string; gammaPositionHistory?: readonly QqqGammaPositionLevel[]; snapshotAsOf?: string | null; gexDte?: number; granularity?: '2m' | '5m' | '1d'; historical?: boolean; premarket?: boolean; showGex?: boolean; showAuxSeries?: boolean; showGexTable?: boolean; snapshotTableTarget?: HTMLElement | null; structureObservationTarget?: HTMLElement | null; chartLegendTarget?: HTMLElement | null; directionalSignals?: readonly DirectionalChartSignal[]; fillHeight?: boolean; height?: number; renderer?: 'lightweight' | 'kline' }) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const priceSessionAt = bars.at(-1)?.timestamp ?? null;
  const restrictToPriceSession = showGex && !historical && granularity !== '1d';
  const currentStructure = !restrictToPriceSession || isQqqGexSnapshotInPriceSession(snapshotAsOf, priceSessionAt);
  const gexSummary = currentStructure ? sourceGexSummary : null;

  const stableGex = useMemo(() => restrictToPriceSession ? (gex ?? EMPTY_GEX_POINTS).filter(point => isQqqGexSnapshotInPriceSession(gexSnapshotIso(point), priceSessionAt)) : gex ?? EMPTY_GEX_POINTS, [gex, restrictToPriceSession, priceSessionAt]);
  const lastGex=stableGex.at(-1);
  const observed=lastGex&&'time' in lastGex?lastGex.observation:undefined;
  const unit=gexSummary?.gexUnit??observed?.profile?.[0]?.gexUnit;
  const netGexLabel = unit === 'per-1pct' ? `净 GEX${observed?.inputComplete===false?'（部分）':''} · /1% / ${QQQ_GEX_LABELS.modelZero}` : unit==='per-point'?`窗口 GEX · /点 / ${QQQ_GEX_LABELS.distributionFlip}`:'净 GEX · 口径未记录';

  const stableGexProfile = currentStructure ? gexProfile ?? EMPTY_GEX_PROFILE_POINTS : EMPTY_GEX_PROFILE_POINTS;
  const gammaPosition = useMemo(() => {
    const expiry = gammaExpiryDate ?? gammaModel?.expiries[0] ?? gammaPositionHistory[0]?.expiryDate ?? '';
    const levels = [...gammaPositionHistory, ...(gammaModel && gammaModel.expiries.length === 1 && gammaModel.expiries[0] === expiry ? [qqqGammaPositionLevel(gammaModel, expiry)] : [])];
    return buildQqqGammaPositionDisplaySeries(bars, levels, expiry, {asOf: historical ? undefined : Date.now(), frozenReference: !historical, barMinutes: granularity === '5m' ? 5 : granularity === '1d' ? 1440 : 2});
  }, [bars, gammaModel, gammaExpiryDate, gammaPositionHistory, historical, granularity]);
  const hasGammaPositionHistory = gammaPosition.some(point => point.zeroGamma !== null || point.volatilityTrigger !== null);
  const latestGammaPosition = gammaPosition.at(-1);
  const gammaPositionCurrent = latestGammaPosition && (latestGammaPosition.zeroGamma !== null || latestGammaPosition.volatilityTrigger !== null) && (historical || Date.now() - Date.parse(latestGammaPosition.time) <= 240_000);
  const partialGammaPosition = gammaPositionHistory.some(point => point.partial);
  const gammaPositionLabel = latestGammaPosition?.reference ? `收盘参考 · 零交点 / VT · %${partialGammaPosition ? '（部分）' : ''}` : !hasGammaPositionHistory ? '暂无零交点 / VT · 副图已收起' : partialGammaPosition ? '零交点 / VT · %（部分数据）' : gammaPositionCurrent ? '零交点 / VT · %' : '历史曲线保留 · 等待更新';
  const gammaSeries = useMemo(() => ({
    zero: qqqChartTimeGrid(gammaPosition.map(p => ({ time: Date.parse(p.time) / 1000 as Time, ...(p.zeroGamma === null ? {} : { value: p.zeroGamma }) })), granularity),
    vt: qqqChartTimeGrid(gammaPosition.map(p => ({ time: Date.parse(p.time) / 1000 as Time, ...(p.volatilityTrigger === null ? {} : { value: p.volatilityTrigger }) })), granularity),
  }), [gammaPosition, granularity]);
  const stableGexProfileHistory = useMemo(() => restrictToPriceSession ? (gexProfileHistory ?? EMPTY_GEX_PROFILE_HISTORY_POINTS).filter(point => isQqqGexSnapshotInPriceSession(point.time, priceSessionAt)) : gexProfileHistory ?? EMPTY_GEX_PROFILE_HISTORY_POINTS, [gexProfileHistory, restrictToPriceSession, priceSessionAt]);
  const stableWallHistory = useMemo(() => restrictToPriceSession ? (wallHistory ?? EMPTY_WALL_HISTORY_POINTS).filter(point => isQqqGexSnapshotInPriceSession(point.time, priceSessionAt)) : wallHistory ?? EMPTY_WALL_HISTORY_POINTS, [wallHistory, restrictToPriceSession, priceSessionAt]);
  const ref = useRef<HTMLDivElement>(null);
  const drawOverlayRef = useRef<(() => void) | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  const chartRuntimeRef = useRef<PcsChartRuntime | null>(null);
  const priceAutoscaleStrikesRef = useRef<number[]>([]);
  const lastLiveTimeRef = useRef(0);
  const lastLivePriceRef = useRef<number | null>(null);
  const liveBucketTimeRef = useRef<number | null>(null);
  const liveCandlesRef = useRef(new Map<number, PcsLiveCandle>());
  const liveCandleRef = useRef<PcsLiveCandle | null>(null);
  const liveMarkerRef = useRef<{ price: number; color: string } | null>(null);
  // SWR 替换数据时用 ref 保留当前逻辑窗口；整页刷新则从 localStorage 恢复绝对时间窗口。
  const visibleLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);
  const hasExtendedHours = Boolean(showGex && extendedHoursBars && extendedHoursBars.length > bars.length);
  const [internalShowExtendedHours, setInternalShowExtendedHours] = useState(hasExtendedHours);
  const showExtendedHours = extendedHoursVisible ?? internalShowExtendedHours;
  const toggleExtendedHours = () => {
    const next = !showExtendedHours;
    if (onExtendedHoursVisibleChange) onExtendedHoursVisibleChange(next);
    else setInternalShowExtendedHours(next);
  };
  const chartBars = showExtendedHours && hasExtendedHours ? extendedHoursBars! : bars;
  const data = useMemo(() => buildQqqPcsIntradayChartData(chartBars, scores, dailyScore, confirmation, stableGex, granularity), [chartBars, confirmation, dailyScore, granularity, stableGex, scores]);
  const latestGexReferenceAt = useMemo(() => {
    const candidates = [
      ...stableWallHistory.map((point) => point.time),
      ...stableGex.flatMap((point) => 'time' in point ? [point.time] : []),
    ].filter((value) => Number.isFinite(Date.parse(value)));
    return candidates.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1) ?? null;
  }, [stableGex, stableWallHistory]);
  const premarketGexReference = premarket && latestGexReferenceAt ? formatGexHistoryTimestamp(latestGexReferenceAt) : null;
  // Setup/RSI/Volume 永远使用 API 的正常盘原 bars；extendedHoursBars 只改变画布显示。
  const regularData = useMemo(() => chartBars === bars ? data : buildQqqPcsIntradayChartData(bars, scores, dailyScore, confirmation, stableGex, granularity), [bars, chartBars, confirmation, dailyScore, data, granularity, stableGex, scores]);
  const regularSetupBars = useMemo<QqqIntradayBar[]>(() => regularData.normalizedBars.map((bar) => ({
    time: Number(bar.time), close: bar.close, high: bar.high, low: bar.low, volume: bar.volume,
  })), [regularData.normalizedBars]);
  const reversalObservations = useMemo(() => (
    showGex && granularity === '2m'
      ? buildQqqShortTermReversalObservations(
          regularSetupBars,
          regularData.gexTotal.map((point) => ({ time: Number(point.time), value: point.value })),
          stableWallHistory.map((point) => ({ time: Number(chartTime(point.time)), callWallPrice: point.callWallPrice, putWallPrice: point.putWallPrice })),
        )
      : []
  ), [granularity, regularData.gexTotal, regularSetupBars, showGex, stableWallHistory]);
  const directionalMarkers = useMemo(() => buildDirectionalChartMarkers(directionalSignals, regularSetupBars), [directionalSignals, regularSetupBars]);
  const observationBands = useMemo(() => buildQqqChartObservationBands({ extendedHours: true,
    bars: showGex && granularity === '2m' ? regularSetupBars : [],
    vwap: regularData.vwap.map(p => ({ time: Number(p.time), value: p.value })),
    wallHistory: stableWallHistory.map(p => ({ time: Number(chartTime(p.time)), callWallPrice: p.callWallPrice, putWallPrice: p.putWallPrice })),
    gammaFlip: regularData.gammaFlip.map(p => ({ time: Number(p.time), value: p.value })),
    asOf: Date.now() / 1000,
  }), [granularity, regularData.gammaFlip, regularData.vwap, regularSetupBars, showGex, stableWallHistory]);
  const observation = observationBands.zones.at(-1);
  const kc = observationBands.channel.at(-1);
  const kcSeries = useMemo(() => ({
    upper: observationBands.channel.map(p => p.connect ? { time: p.time as Time, value: p.upper } : { time: p.time as Time }),
    lower: observationBands.channel.map(p => p.connect ? { time: p.time as Time, value: p.lower } : { time: p.time as Time }),
    basis: observationBands.channel.map(p => p.connect ? { time: p.time as Time, value: p.basis } : { time: p.time as Time }),
  }), [observationBands.channel]);
  const tradeMapBandSeries = useMemo(() => {
    const path = (side: 'low' | 'high') => observationBands.zones.map((p, i) => {
      const previous = observationBands.zones[i - 1]; const zone = p[side]; const prior = previous?.[side];
      return zone && prior && zone.source === prior.source && p.time - previous!.time <= 300
        && Math.abs(zone.anchor-prior.anchor) <= Math.max(zone.upper-zone.lower, .01)
        ? { time: p.time as Time, value: zone.anchor } : { time: p.time as Time };
    });
    const closes = new Map(regularSetupBars.map(b => [b.time, b.close]));
    return { low: path('low'), high: path('high'), bands: observationBands.zones.map(p => ({
      time: p.time as Time, referencePrice: closes.get(p.time)!, lowLower: p.low?.lower ?? closes.get(p.time)!, lowUpper: p.low?.upper ?? closes.get(p.time)!,
      highLower: p.high?.lower ?? closes.get(p.time)!, highUpper: p.high?.upper ?? closes.get(p.time)!,
      activeSide: null, showLow: Boolean(p.low), showHigh: Boolean(p.high),
    } satisfies PcsIntradayZoneBandData)) };
  }, [observationBands.zones, regularSetupBars]);
  const observedPriceLowMarkers = useMemo(() => buildObservedPriceLowMarkers(data.normalizedBars), [data.normalizedBars]);
  const observedGexLowMarkers = useMemo(() => buildObservedGexLowMarkers(data.gexTotal), [data.gexTotal]);
  const chartEventTooltips = useMemo(() => (
    [...buildChartEventTooltips(observedPriceLowMarkers, observedGexLowMarkers, reversalObservations), ...directionalMarkers.map(marker => ({ time: marker.time, label: marker.text, detail: marker.detail, color: marker.color }))]
  ), [observedGexLowMarkers, observedPriceLowMarkers, reversalObservations, directionalMarkers]);
  const sessionWindow = useMemo(() => data.price.length && granularity !== '1d' && !historical ? qqqPcsSessionWindow(data.price.at(-1)!.time, premarket) : null, [data.price, granularity, historical, premarket]);
  const hoverStore = useMemo(() => createQqqHoverStore<PcsHoverState>(null), []);
  const paneWeightsRef = useRef<QqqPaneWeights>({});
  const [primaryPaneHeight, setPrimaryPaneHeight] = useState(height);
  const [tooltipDetails, setTooltipDetails] = useState(false);
  useEffect(() => { try { setTooltipDetails(window.localStorage.getItem('qqq-pcs:gex-hover-details:v1') === 'true'); } catch { /* Optional preference. */ } }, []);
  const [hoveredLegend, setHoveredLegend] = useState<LegendKey | null>(null);
  const [hiddenLegends, setHiddenLegends] = useState<Partial<Record<LegendKey, boolean>>>(() => (
    showGex
      ? parseQqqChartDisplayPreferences(null)
      : {}
  ));
  const [displayPreset,setDisplayPreset] = useState('custom');
  const [savedCombo,setSavedCombo] = useState(false);
  const [hasSavedCombo,setHasSavedCombo] = useState(false);
  const [displayPreferencesReady, setDisplayPreferencesReady] = useState(!showGex);
  useEffect(() => {
    if (!showGex) return;
    try { setHiddenLegends(parseQqqChartDisplayPreferences(window.localStorage.getItem(qqqChartDisplayStorageKey))); setHasSavedCombo(Boolean(window.localStorage.getItem('qqq-gex:custom-display:v1'))); } catch { /* Storage may be disabled; controls still work for this visit. */ }
    setDisplayPreferencesReady(true);
  }, [showGex]);
  const isLive = granularity !== '1d' && !historical;
  const [observationClock, setObservationClock] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !isLive) return;
    const timer = setInterval(() => setObservationClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [active, isLive]);
  const intradayDelay = useMemo(() => qqqPcsDescribeIntradayDelay(data.price.at(-1)?.time, observationClock), [data.price, observationClock]);
  const liveStreamEnabled = active && isLive && intradayDelay.liveStreamEnabled;
  const liveTick = useQqqLiveTick(liveStreamEnabled && (renderer === 'kline' || !showGex));
  const liveConnection = useQqqLiveConnection();
  const [followLatest, setFollowLatest] = useState(true);
  const followLatestRef = useRef(true);
  const focusSignalsRef = useRef(directionalSignals); focusSignalsRef.current = directionalSignals;
  const nativeLiveTickRef = useRef<QqqLiveTick | null>(null);
  const liveMarkerColor = showGex ? '#ff5c5c' : '#34d399';
  const isHidden = useCallback((key: LegendKey) => hiddenLegends[key === 'gamma_flip' ? 'net_gex' : key] === true, [hiddenLegends]);
  const hideCallWall = isHidden('call_wall'), hideKing = isHidden('king'), hidePositive = isHidden('gex_positive');
  const hideNegative = isHidden('gex_negative'), hideWallHistory = isHidden('wall_history'), hidePutWall = isHidden('put_wall');
  const nativeSnapshotData = useMemo(() => buildNativeGexSnapshotSeriesData(stableGexProfileHistory, stableWallHistory, {
      callWall: hideCallWall,
      king: hideKing,
      positive: hidePositive,
      negative: hideNegative,
      wallHistory: hideWallHistory,
      putWall: hidePutWall,
    }), [stableGexProfileHistory, stableWallHistory, hideCallWall, hideKing, hidePositive, hideNegative, hideWallHistory, hidePutWall]);
  const visiblePriceMarkers = useMemo(() => [
    ...(!isHidden('markers') ? [...observedPriceLowMarkers, ...buildShortTermReversalMarkers(reversalObservations)] : []),
    ...(!isHidden('directional_markers') ? directionalMarkers : []),
  ].sort((a, b) => Number(a.time) - Number(b.time)), [isHidden, observedPriceLowMarkers, reversalObservations, directionalMarkers]);
  const markerSourceRef = useRef(visiblePriceMarkers);
  const syncMarkerLabelsRef = useRef<() => void>(() => undefined);
  useEffect(() => { markerSourceRef.current = visiblePriceMarkers; syncMarkerLabelsRef.current(); }, [visiblePriceMarkers]);
  const tradeMapBandData = useMemo(() => tradeMapBandSeries.bands.map((band) => ({
    ...band,
    showHigh: band.showHigh && !isHidden('trade_high'),
    showLow: band.showLow && !isHidden('trade_low'),
  })), [isHidden, tradeMapBandSeries.bands]);
  const visibleGexProfile = useMemo(() => stableGexProfile.filter((point) => {
    if (point.isGammaFlip && isHidden('gamma_flip')) return false;
    if (point.isCallWall && isHidden('call_wall')) return false;
    if (point.isPutWall && isHidden('put_wall')) return false;
    if (point.magnitude >= 0 && isHidden('gex_positive')) return false;
    if (point.magnitude < 0 && isHidden('gex_negative')) return false;
    return true;
  }), [isHidden, stableGexProfile]);
  const overlayModel = useMemo(() => ({
    segments: buildWallStepSegments(stableWallHistory),
    moves: buildWallMoves(stableWallHistory),
    labelPoints: visibleGexProfile.slice().sort((left, right) => right.strike - left.strike),
  }), [stableWallHistory, visibleGexProfile]);
  const latestWallSnapshot = useMemo(() => stableWallHistory.at(-1) ?? null, [stableWallHistory]);
  const displayKing = useMemo(() => (
    latestWallSnapshot?.kingStrike && Number.isFinite(latestWallSnapshot.kingStrike) && latestWallSnapshot.kingStrike > 0
      ? {
          strike: latestWallSnapshot.kingStrike,
          magnitude: Number.isFinite(latestWallSnapshot.kingMagnitude) ? latestWallSnapshot.kingMagnitude! : (gexSummary?.king?.magnitude ?? 0),
          side: latestWallSnapshot.kingSide === 'call' || latestWallSnapshot.kingSide === 'put' ? latestWallSnapshot.kingSide : (gexSummary?.king?.side ?? 'call'),
        }
      : gexSummary?.king ?? null
  ), [gexSummary?.king, latestWallSnapshot]);
  const displayCallWall = useMemo(() => (
    latestWallSnapshot?.callWallPrice && Number.isFinite(latestWallSnapshot.callWallPrice) && latestWallSnapshot.callWallPrice > 0
      ? {
          strike: latestWallSnapshot.callWallPrice,
          magnitude: Number.isFinite(latestWallSnapshot.callWallMagnitude) ? latestWallSnapshot.callWallMagnitude! : (gexSummary?.callWall?.magnitude ?? 0),
        }
      : gexSummary?.callWall ?? null
  ), [gexSummary?.callWall, latestWallSnapshot]);
  const displayPutWall = useMemo(() => (
    latestWallSnapshot?.putWallPrice && Number.isFinite(latestWallSnapshot.putWallPrice) && latestWallSnapshot.putWallPrice > 0
      ? {
          strike: latestWallSnapshot.putWallPrice,
          magnitude: Number.isFinite(latestWallSnapshot.putWallMagnitude) ? latestWallSnapshot.putWallMagnitude! : (gexSummary?.putWall?.magnitude ?? 0),
        }
      : gexSummary?.putWall ?? null
  ), [gexSummary?.putWall, latestWallSnapshot]);
  const tradeMap = useMemo(() => (
    showGex && granularity === '2m'
      ? buildQqqIntradayTradeMap({
          bars: regularSetupBars,
          vwap: regularData.vwap.at(-1)?.value ?? null,
          putWall: displayPutWall?.strike ?? null,
          callWall: displayCallWall?.strike ?? null,
          gammaFlip: gexSummary?.gammaFlip ?? null,
          gex: regularData.gexTotal.map((point) => ({ time: Number(point.time), value: point.value })),
          observations: reversalObservations,
        })
      : null
  ), [displayCallWall?.strike, displayPutWall?.strike, gexSummary?.gammaFlip, granularity, regularData.gexTotal, regularData.vwap, regularSetupBars, reversalObservations, showGex]);
  const rsiState = useMemo(() => buildQqqIntradayRsiState(regularSetupBars), [regularSetupBars]);
  const volumeState = useMemo(() => classifyQqqIntradayVolume(regularSetupBars, tradeMap), [regularSetupBars, tradeMap]);
  const rsiSeriesData = useMemo(() => calculateRSI(
    regularSetupBars.map((bar) => bar.close),
    regularSetupBars.map((bar) => bar.time),
    14,
  ).flatMap((point) => point.value === null ? [] : [{ time: point.time as Time, value: point.value }]), [regularSetupBars]);
  const latestGexSnapshotLabel = useMemo(() => {
    const latestIntraday = stableGex.reduce<string | null>((latest, point) => ('time' in point && point.time && (!latest || point.time > latest) ? point.time : latest), null);
    const latestWall = stableWallHistory.reduce<string | null>((latest, point) => (point.time && (!latest || point.time > latest) ? point.time : latest), null);
    const latestDaily = stableGex.reduce<string | null>((latest, point) => ('date' in point && point.date && (!latest || point.date > latest) ? `${point.date}T16:00:00.000Z` : latest), null);
    return formatEasternSnapshot(latestIntraday ?? latestWall ?? latestDaily ?? snapshotAsOf, !historical && granularity !== '1d');
  }, [granularity, historical, snapshotAsOf, stableGex, stableWallHistory]);
  const wallsOverlap = !!displayCallWall && !!displayPutWall && displayCallWall.strike === displayPutWall.strike;
  const toggleLegend = (key: LegendKey) => { setDisplayPreset('custom'); setSavedCombo(false); setHiddenLegends((current) => {
    const mergedKey = key === 'gamma_flip' ? 'net_gex' : key;
    const next = { ...current, [mergedKey]: !current[mergedKey] };
    if (mergedKey === 'net_gex') next.gamma_flip = next.net_gex;
    if (showGex) try { window.localStorage.setItem(qqqChartDisplayStorageKey, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
    return next;
  }); };
  const cursorLookup = useMemo(() => ({
    priceByTime: new Map(data.price.map(point => [Number(point.time), point.value])),
    priceTimes: data.price.map(point => Number(point.time)),
    vwapByTime: new Map(data.vwap.map(point => [Number(point.time), point.value])),
    scoreTimes: data.scores.map(point => Number(point.time)), scores: data.scores,
  }), [data.price, data.vwap, data.scores]);
  const cursorLookupRef = useRef(cursorLookup);
  useEffect(() => { cursorLookupRef.current = cursorLookup; }, [cursorLookup]);
  const barsByTime = useMemo(() => new Map(data.normalizedBars.map((bar) => [Number(bar.time), bar])), [data.normalizedBars]);
  const renderCursor = useCallback((hover: PcsHoverState) => {
    if (!hover) return null;
    const hoverDetails = {
      bar: barsByTime.get(hover.time) ?? null,
      gexSnapshot: findLatestGexSnapshotAtTime(stableGex, hover.snapshotTime ?? hover.time),
      wallSnapshot: findLatestWallSnapshotAtTime(stableWallHistory, hover.snapshotTime ?? hover.time),
      annotations: chartEventTooltips.filter(tooltip => Number(tooltip.time) === hover.time),
    };
    const plotWidth = (ref.current?.clientWidth ?? 400) - (chartRuntimeRef.current?.chart.priceScale('right').width() ?? 0);
    const cardWidth = Math.max(100, Math.min(250, plotWidth - 16));
    const availableHeight = tooltipDetails ? ref.current?.clientHeight ?? height : primaryPaneHeight;
    const cardPosition = qqqHoverCardPosition(hover.left, hover.top, plotWidth, availableHeight, cardWidth, tooltipDetails ? 260 : 146);
    const gexAge = hoverDetails.gexSnapshot ? Math.max(0, Math.floor(((hover.snapshotTime ?? hover.time) - Date.parse(hoverDetails.gexSnapshot.iso) / 1000) / 60)) : null;
    const cardStyle = { background: 'rgba(6,8,12,.94)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 6, color: '#e5e7eb', fontFamily: 'var(--font-mono)', fontSize: '0.61rem', padding: '7px 9px', pointerEvents: 'none' as const, position: 'absolute' as const, zIndex: 4, width: cardWidth, maxHeight: Math.max(80, availableHeight - 16), overflow: 'hidden', ...cardPosition };
    return <>
      {showGex && !tooltipDetails && <div style={cardStyle} role="status" aria-label="K 线简洁信息">
        <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:4}}><strong>{granularity === '1d' ? formatEasternDate(hover.time as Time) : `${formatEasternTime(hover.time as Time)} ET`}</strong><strong>{hover.price.toFixed(2)}</strong></div>
        <div style={{color:'#94a3b8',marginBottom:3}}>高 {hoverDetails.bar?.high?.toFixed(2) ?? '—'} · 低 {hoverDetails.bar?.low?.toFixed(2) ?? '—'} · 量 {hoverDetails.bar ? compactVolumeFormatter.format(hoverDetails.bar.volume) : '—'}</div>
        <div style={{color:'#d4b16a',marginBottom:4}}>VWAP {hover.vwap.toFixed(2)}</div>
        {hoverDetails.gexSnapshot ? <><div style={{display:'flex',justifyContent:'space-between',gap:8}}><span>净 GEX</span><strong style={{color:hoverDetails.gexSnapshot.totalGex>=0?'#60a5fa':'#fb923c'}}>{formatGexMagnitude(hoverDetails.gexSnapshot.totalGex)}</strong></div><div style={{display:'flex',justifyContent:'space-between',gap:8}}><span>翻转位</span><span style={{color:'#67e8f9'}}>{hoverDetails.gexSnapshot.gammaFlipLevel?.toFixed(2) ?? '—'}</span></div><div style={{color:gexAge!==null&&gexAge>6?'#d4b16a':'#64748b',fontSize:'0.55rem',marginTop:3}}>GEX 快照 {formatEasternTime(chartTime(hoverDetails.gexSnapshot.iso))} · {gexAge===0?'同分钟':`${gexAge}分钟前`}</div></> : <div style={{color:'#64748b'}}>该时点无 GEX 快照</div>}
        {hoverDetails.annotations.length>0 && <div style={{borderTop:'1px solid rgba(148,163,184,.12)',marginTop:4,paddingTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:hoverDetails.annotations[0]!.color}}>{hoverDetails.annotations[0]!.label}{hoverDetails.annotations.length>1?` · 共 ${hoverDetails.annotations.length} 条`:''}</div>}
      </div>}
      {hover && !showGex && <div style={{ background: 'color-mix(in srgb, var(--bg-card) 94%, #000)', border: '1px solid var(--border-color)', borderRadius: 7, boxShadow: '0 6px 18px rgba(0,0,0,.26)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', left: hover.left, lineHeight: 1.55, padding: '0.45rem 0.55rem', pointerEvents: 'none', position: 'absolute', top: hover.top, zIndex: 2 }}>
        <strong>{granularity === '1d' ? formatEasternDate(hover.time as Time) : `${formatEasternTime(hover.time as Time)} ET`}</strong><br />
        QQQ ${hover.price.toFixed(2)}{granularity !== '1d' && <> · {premarket ? '盘前均价' : 'VWAP'} ${hover.vwap.toFixed(2)}<br />偏离 {((hover.price / hover.vwap - 1) * 100 >= 0 ? '+' : '')}{((hover.price / hover.vwap - 1) * 100).toFixed(2)}%{premarket ? ' · 盘前观察' : ` · ${historical ? '回放分' : '执行分'} ${hover.score ?? '—'}/5`}{data.dailyScore.length ? <><br />次日开仓资格（{historical ? '同源回放' : '当前快照'}）{data.dailyScore[0]?.value}/5</> : null}</>}
      </div>}
      {hover && showGex && tooltipDetails && hoverDetails && <div style={{ background: 'rgba(6, 8, 12, 0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.32)', color: '#e5e7eb', fontFamily: 'var(--font-mono)', fontSize: '0.63rem', left: cardPosition.left, lineHeight: 1.45, maxWidth: cardWidth, padding: '0.48rem 0.58rem', pointerEvents: 'none', position: 'absolute', top: cardPosition.top, zIndex: 4 }}>
        <div style={{ color: '#f8fafc', fontWeight: 900, marginBottom: 4 }}>{granularity === '1d' ? formatEasternDate(hover.time as Time) : `${formatEasternTime(hover.time as Time)} ET`}</div>
        {hoverDetails.bar && hoverDetails.bar.open !== undefined && hoverDetails.bar.high !== undefined && hoverDetails.bar.low !== undefined
          ? <div style={{ marginBottom: 4 }}>O {hoverDetails.bar.open.toFixed(2)} · H {hoverDetails.bar.high.toFixed(2)} · L {hoverDetails.bar.low.toFixed(2)} · C {hoverDetails.bar.close.toFixed(2)}</div>
          : <div style={{ marginBottom: 4 }}>QQQ {hover.price.toFixed(2)}</div>}
        <div style={{ color: '#cbd5e1', marginBottom: 4 }}>VWAP {hover.vwap.toFixed(2)} · 偏离 {((hover.price / hover.vwap - 1) * 100 >= 0 ? '+' : '')}{((hover.price / hover.vwap - 1) * 100).toFixed(2)}%</div>
        {hoverDetails.bar && Number.isFinite(hoverDetails.bar.volume) && <div style={{ color: '#94a3b8', marginBottom: 4 }}>Vol {compactVolumeFormatter.format(hoverDetails.bar.volume)}</div>}
        {nativeLiveTickRef.current && hover.time === (liveBucketTimeRef.current ?? -1) && <div style={{ color: '#34d399', marginBottom: 4 }}>Live {nativeLiveTickRef.current.price.toFixed(2)}</div>}
        {hoverDetails.gexSnapshot && <div style={{ borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 4, paddingTop: 4 }}>
          <div style={{ color: hoverDetails.gexSnapshot.totalGex >= 0 ? '#34d399' : '#f87171' }}>Net GEX {formatGexMagnitude(hoverDetails.gexSnapshot.totalGex)}</div>
          <div style={{ color: '#67e8f9' }}>GEX 分布换号价 {hoverDetails.gexSnapshot.gammaFlipLevel === null ? '—' : hoverDetails.gexSnapshot.gammaFlipLevel.toFixed(2)}</div>
        </div>}
        {hoverDetails.annotations.length > 0 && <div style={{ borderTop: '1px solid rgba(148,163,184,.18)', marginTop: 5, paddingTop: 5 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 900, marginBottom: 3 }}>图表标记 · 研究观察</div>
          {hoverDetails.annotations.map((annotation, index) => <div key={`${annotation.label}-${index}`} style={{ color: annotation.color, marginTop: index ? 4 : 0 }}>
            <strong>{annotation.label}</strong><span style={{ color: '#cbd5e1' }}> · {annotation.detail}</span>
          </div>)}
        </div>}
        {(gexSummary?.callWall || gexSummary?.putWall || hoverDetails.wallSnapshot) && <div style={{ borderTop: '1px solid rgba(148,163,184,.12)', marginTop: 4, paddingTop: 4 }}>
          <div style={{ color: '#f8fafc', fontWeight: 800, marginBottom: 2 }}>Wall 状态</div>
          <div style={{ color: '#34d399' }}>Call {hoverDetails.wallSnapshot?.current.callWallPrice ?? displayCallWall?.strike ?? '—'}{hoverDetails.wallSnapshot?.previous?.callWallPrice !== null && hoverDetails.wallSnapshot?.previous?.callWallPrice !== undefined && hoverDetails.wallSnapshot?.current.callWallPrice !== null ? ` · ${hoverDetails.wallSnapshot.current.callWallPrice > hoverDetails.wallSnapshot.previous.callWallPrice ? '上移' : hoverDetails.wallSnapshot.current.callWallPrice < hoverDetails.wallSnapshot.previous.callWallPrice ? '下移' : '持平'} ${Math.abs(hoverDetails.wallSnapshot.current.callWallPrice - hoverDetails.wallSnapshot.previous.callWallPrice).toFixed(2)}` : ''}{(hoverDetails.wallSnapshot?.current.callWallMagnitude ?? displayCallWall?.magnitude) !== null && (hoverDetails.wallSnapshot?.current.callWallMagnitude ?? displayCallWall?.magnitude) !== undefined ? ` · 厚度 ${formatGexMagnitude(hoverDetails.wallSnapshot?.current.callWallMagnitude ?? displayCallWall!.magnitude)}` : ''}</div>
          <div style={{ color: '#f87171' }}>Put {hoverDetails.wallSnapshot?.current.putWallPrice ?? displayPutWall?.strike ?? '—'}{hoverDetails.wallSnapshot?.previous?.putWallPrice !== null && hoverDetails.wallSnapshot?.previous?.putWallPrice !== undefined && hoverDetails.wallSnapshot?.current.putWallPrice !== null ? ` · ${hoverDetails.wallSnapshot.current.putWallPrice > hoverDetails.wallSnapshot.previous.putWallPrice ? '上移' : hoverDetails.wallSnapshot.current.putWallPrice < hoverDetails.wallSnapshot.previous.putWallPrice ? '下移' : '持平'} ${Math.abs(hoverDetails.wallSnapshot.current.putWallPrice - hoverDetails.wallSnapshot.previous.putWallPrice).toFixed(2)}` : ''}{(hoverDetails.wallSnapshot?.current.putWallMagnitude ?? displayPutWall?.magnitude) !== null && (hoverDetails.wallSnapshot?.current.putWallMagnitude ?? displayPutWall?.magnitude) !== undefined ? ` · 厚度 ${formatGexMagnitude(hoverDetails.wallSnapshot?.current.putWallMagnitude ?? displayPutWall!.magnitude)}` : ''}</div>
        </div>}
        {granularity !== '1d' && !premarket && <div style={{ color: '#94a3b8', marginTop: 4 }}>执行分 {hover.score ?? '—'}/5{data.dailyScore.length ? ` · 次日开仓资格 ${data.dailyScore[0]?.value}/5` : ''}</div>}
      </div>}
    </>;
  }, [barsByTime, chartEventTooltips, stableGex, stableWallHistory, showGex, granularity, premarket, historical, data.dailyScore, height, gexSummary, displayCallWall, displayPutWall, tooltipDetails, primaryPaneHeight]);

  const overlayState = useMemo(() => ({ isHidden, overlayModel, displayKing, latestWallSnapshot, stableGexProfileHistory, stableWallHistory, visibleGexProfile }),
    [isHidden, overlayModel, displayKing, latestWallSnapshot, stableGexProfileHistory, stableWallHistory, visibleGexProfile]);
  const overlayStateRef = useRef(overlayState);
  useEffect(() => { overlayStateRef.current = overlayState; }, [overlayState]);


  useEffect(() => {
    if (renderer === 'kline') return;
    const container = ref.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth, height,
      layout: { background: { color: '#05070b' }, textColor: '#9ca3af', fontSize: 10 },
      localization: { timeFormatter: formatEasternCrosshairLabel },
      grid: { vertLines: { color: 'rgba(148, 163, 184, 0.08)' }, horzLines: { color: 'rgba(148, 163, 184, 0.08)' } },
      rightPriceScale: { visible: showGex, scaleMargins: { top: .03, bottom: .03 }, borderColor: 'rgba(148, 163, 184, 0.12)' },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.12)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: formatEasternTick,
        barSpacing: showGex ? 10 : 7,
        ...qqqPcsTimeScaleNavigation(showGex),
      },
      handleScroll: showGex
        ? { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
        : false,
      handleScale: showGex
        ? { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: false, price: true } }
        : false,
    });
    // Call/Put Wall 有阶梯轨迹时，最后一段已是当前墙位，不再叠一条重复静态线；King、Gamma Flip 和其他 Top strike 仍保留作当前结构锚点。
    const hasWallTrajectory = granularity !== '1d' && stableWallHistory.length > 1 && !isHidden('wall_history');
    const gexLines = showGex
      ? buildGexProfileLines(visibleGexProfile, isHidden('king') ? null : displayKing?.strike ?? null).filter((line) => !hasWallTrajectory || (line.title !== 'Call Wall' && line.title !== 'Put Wall' && !line.title.startsWith('King ·')))
      : [];
    // 逐 strike 墙位价格常常落在当日实际价格波动区间之外（分析窗口是 1.5x expected move，比一天的真实振幅宽得多）；
    // lightweight-charts 的默认 autoscale 只看系列数据，不看 createPriceLine，墙位若在可见价格轴之外会被裁掉、完全不可见。
    // 用 autoscaleInfoProvider 把墙位的 strike 范围并入价格轴的自动缩放区间，保证所有画出来的墙位都落在可视区内。
    // 历史 snapshot 只作为叠层，不应永久撑开价格轴；否则滚轮/轴缩放始终被全天极值锁死。
    // 默认范围只纳入当前快照，用户缩放后历史 Ribbon 可自然进出可视区。
    const autoscaleStrikes = [
      ...gexLines.map((line) => line.price),
      ...(latestWallSnapshot
        ? [latestWallSnapshot.callWallPrice, latestWallSnapshot.putWallPrice, latestWallSnapshot.kingStrike].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
        : []),
    ];
    priceAutoscaleStrikesRef.current = autoscaleStrikes;
    const priceAutoscaleProvider = autoscaleStrikes.length
      ? (base: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const baseInfo = base();
          const minStrike = Math.min(...priceAutoscaleStrikesRef.current);
          const maxStrike = Math.max(...priceAutoscaleStrikesRef.current);
          const baseMin = baseInfo?.priceRange?.minValue ?? minStrike;
          const baseMax = baseInfo?.priceRange?.maxValue ?? maxStrike;
          return { priceRange: { minValue: Math.min(baseMin, minStrike), maxValue: Math.max(baseMax, maxStrike) }, margins: baseInfo?.margins };
        }
      : undefined;
    // 扩展时段背景是图表内部 CustomSeries，先于 K 线添加以保持在背景层；缩放、拖动和裁剪均由 chart 管理。
    let sessionShade: any = null;
    if (showExtendedHours) {
      sessionShade = chart.addCustomSeries(new PcsExtendedHoursShadePaneView(), { color: 'transparent', lastValueVisible: false, priceLineVisible: false }, 0);
      sessionShade.setData(buildExtendedHoursShadeSeries(data.price));
    }
    // 高低位交易区放在 K 线后方：每个点是当时可见的因果快照，不把最新区间画成全天静态直线。
    let zoneBands: any = null;
    if (showGex && granularity === '2m') {
      zoneBands = chart.addCustomSeries(new PcsIntradayZoneBandPaneView(), { color: 'transparent', lastValueVisible: false, priceLineVisible: false }, 0);
      zoneBands.setData(tradeMapBandData);
    }
    // 大图（showGex）且逐 bar OHLC 齐全时画正经蜡烛图；小图和数据不全时保持原折线，两者共用后续 createPriceLine/priceToCoordinate 调用。
    let price: ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;
    if (showGex && data.candles.length) {
      const candleSeries = chart.addSeries(CandlestickSeries, { upColor: '#16e0a0', downColor: '#ff6b6b', borderVisible: false, wickUpColor: '#16e0a0', wickDownColor: '#ff6b6b', lastValueVisible: !showGex, priceLineVisible: false, priceLineColor: '#e2e8f0', priceLineWidth: 1, visible: !isHidden('price'), ...(priceAutoscaleProvider ? { autoscaleInfoProvider: priceAutoscaleProvider } : {}) });
      candleSeries.setData(data.candles);
      price = candleSeries;
    } else {
      const lineSeries = chart.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 2, lastValueVisible: !showGex, priceLineVisible: false, priceLineColor: '#60a5fa', priceLineWidth: 1, visible: !isHidden('price'), ...(priceAutoscaleProvider ? { autoscaleInfoProvider: priceAutoscaleProvider } : {}) });
      lineSeries.setData(data.price);
      price = lineSeries;
    }
    const markerPlugin = showGex ? createSeriesMarkers(price, []) : null;
    // VWAP 是逐根成交量累计得到的动态路径。主图默认显示为金色弧线；静态低/高位线只是价带，不能替代 VWAP。
    const vwap = granularity !== '1d' ? chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, lineType: LineType.Curved, lineStyle: 0, lastValueVisible: true, priceLineVisible: false, title: 'VWAP', visible: !isHidden('vwap') }) : null;
    // 原生连续线保证高低位路径在密集的 GEX Ribbon 上仍清晰可辨；半透明 CustomSeries 只负责带宽填充。
    const lowZonePath = showGex && granularity === '2m'
      ? chart.addSeries(LineSeries, { visible: !isHidden('trade_low'), color: '#22c997', crosshairMarkerRadius: 3, lastValueVisible: false, lineType: LineType.WithSteps, lineWidth: 1, priceLineVisible: false })
      : null;
    const highZonePath = showGex && granularity === '2m'
      ? chart.addSeries(LineSeries, { visible: !isHidden('trade_high'), color: '#fb7185', crosshairMarkerRadius: 3, lastValueVisible: false, lineType: LineType.WithSteps, lineWidth: 1, priceLineVisible: false })
      : null;
    const addKc = (title: string, color: string, dashed = false) => showGex && granularity === '2m'
      ? chart.addSeries(LineSeries, { visible: !isHidden('kc'), color, lineWidth: 1, lineStyle: dashed ? 2 : 0, lastValueVisible: true, priceLineVisible: false, title }) : null;
    const kcUpper = addKc('KC 上沿', '#a5b4fc'), kcLower = addKc('KC 下沿', '#a5b4fc'), kcBasis = addKc('KC 中线', '#d4b16a', true);
    kcUpper?.setData(kcSeries.upper); kcLower?.setData(kcSeries.lower); kcBasis?.setData(kcSeries.basis);
    const score = granularity !== '1d' && showAuxSeries ? chart.addSeries(LineSeries, { visible: !isHidden('score'), color: '#a78bfa', lineWidth: 1, priceScaleId: 'left', priceLineVisible: false }) : null;
    const daily = granularity !== '1d' && showAuxSeries ? chart.addSeries(LineSeries, { visible: !isHidden('score'), color: '#86b98a', lineWidth: 1, lineStyle: 2, priceScaleId: 'left', priceLineVisible: false }) : null;
    const confirmationLine = granularity !== '1d' && showAuxSeries ? chart.addSeries(LineSeries, { visible: !isHidden('confirmation'), color: '#f472b6', lineWidth: 1, lineStyle: 3, priceScaleId: 'confirmation', priceLineVisible: false }) : null;
    const sessionAnchor = sessionWindow && !showGex ? chart.addSeries(LineSeries, { lastValueVisible: false, lineVisible: false, priceLineVisible: false, visible: false }) : null;
    if (score) chart.priceScale('left').applyOptions({ autoScale: true, scaleMargins: { top: .72, bottom: .08 } });
    if (confirmationLine) chart.priceScale('confirmation').applyOptions({ autoScale: true, scaleMargins: { top: .3, bottom: .35 } });
    vwap?.setData(data.vwap); lowZonePath?.setData(tradeMapBandSeries.low); highZonePath?.setData(tradeMapBandSeries.high); score?.setData(data.scores); daily?.setData(data.dailyScore); confirmationLine?.setData(data.confirmation); sessionAnchor?.setData(qqqPcsSessionAnchor(sessionWindow, data.price.at(-1)?.time ?? null, granularity === '2m' ? 120 : 300));
    // 与主 K 线共享时间轴的 GEX 子面板：左/右独立量纲，避免把“价格 Flip”错画在“金额 GEX”轴上。
    // Net GEX 围绕零轴摆动；Gamma Flip 使用独立价格轴的青色轨迹，快照未变时自然呈水平段。
    let netGexSeries: ISeriesApi<'Line'> | null = null;
    let flipSeries: ISeriesApi<'Line'> | null = null;
    if (showGex && data.gexTotal.some(point => 'value' in point && Number.isFinite(point.value)) && !isHidden('net_gex')) {
      ({ netGexSeries, flipSeries } = addQqqGexPane(chart));
      chart.panes()[0]?.setStretchFactor(3);
      netGexSeries.setData([...qqqChartTimeGrid(data.gexTotal, granularity)]);
      flipSeries.setData([...qqqChartTimeGrid(data.gammaFlip, granularity)]);
    }
    let gammaZero: ISeriesApi<'Line'> | null = null, gammaVt: ISeriesApi<'Line'> | null = null;
    if (showGex && granularity === '2m' && hasGammaPositionHistory && !isHidden('gamma_position')) {
      ({ gammaZero, gammaVt } = addQqqGammaPositionPane(chart));
      gammaZero.setData([...gammaSeries.zero]); gammaVt.setData([...gammaSeries.vt]);
    }
    let rsiLine: ISeriesApi<'Line'> | null = null;
    if (showGex && showAuxSeries && granularity === '2m' && rsiSeriesData.length && !isHidden('rsi')) {
      rsiLine = addQqqRsiSeries(chart, rsiSeriesData);
    }
    // Gamma 分布快照：横向价位线直接叠在价格线上，随 chart 一起在 effect 清理时销毁，不单独维护 ref；仅大图展示，避免小图拥挤。
    const priceLines: any[] = [];
    // 多 strike 快照用 CustomSeries 画在 pane 0，而非绝对定位 DOM。它与 K 线共用渲染循环，因此滚轮、捏合和拖拽期间逐帧对齐，且天然裁剪在主 pane。
    let snapshots: any = null;
    if (showGex && granularity !== '1d') {
      const nativeSnapshots = buildNativeGexSnapshotSeriesData(stableGexProfileHistory, stableWallHistory, {
        callWall: isHidden('call_wall'),
        king: isHidden('king'),
        positive: isHidden('gex_positive'), negative: isHidden('gex_negative'), wallHistory: isHidden('wall_history'),
        putWall: isHidden('put_wall'),
      });
      {
        snapshots = chart.addCustomSeries(new PcsGexSnapshotPaneView(), { autoscaleInfoProvider: () => null, color: 'transparent', lastValueVisible: false, priceLineVisible: false }, 0);
        snapshots.setData(qqqChartTimeGrid(nativeSnapshots, granularity));
      }
    }
    chartRuntimeRef.current = {
      chart,
      price,
      vwap,
      kcUpper, kcLower, kcBasis,
      lowZonePath,
      highZonePath,
      score,
      daily,
      confirmation: confirmationLine,
      sessionAnchor,
      netGexSeries,
      flipSeries,
      rsiLine, gammaZero, gammaVt,
      sessionShade,
      zoneBands,
      snapshots,
      markerPlugin,
      livePriceLine: null,
      priceLines,
      priceLineSignature: null,
      seriesSignatures: new Map([['price', chartDataSignature(showGex && data.candles.length ? data.candles : data.price)]]),
      seriesRows: new Map([['price', showGex && data.candles.length ? data.candles : data.price]]),
      firstPriceTime: data.price[0]?.time ?? null,
    };
    const timeCoordinate = (time: Time) => typeof time === 'number'
      ? qqqChartTimeCoordinate(time, granularity, slot => chart.timeScale().timeToCoordinate(slot as Time))
      : chart.timeScale().timeToCoordinate(time);
    syncMarkerLabelsRef.current = () => {
      if (!activeRef.current) return;
      const runtime = chartRuntimeRef.current;
      if (!runtime?.markerPlugin || runtime.chart !== chart) return;
      const markers = qqqReadableMarkers(markerSourceRef.current, marker => timeCoordinate(marker.time), container.clientWidth - chart.priceScale('right').width());
      const signature = chartDataSignature(markers);
      if (runtime.seriesSignatures.get('markers') === signature) return;
      runtime.seriesSignatures.set('markers', signature);
      runtime.markerPlugin.setMarkers(markers);
    };
    if (showGex) {
      try { paneWeightsRef.current = parseQqqPaneWeights(window.localStorage.getItem(qqqGexPaneHeightStorageKey)); } catch { /* Storage may be unavailable. */ }
      applyQqqPaneWeights(chartRuntimeRef.current!, paneWeightsRef.current);
    }
    syncQqqLivePriceLabel(chartRuntimeRef.current!, liveStreamEnabled && qqqLiveQuoteUsable(nativeLiveTickRef.current) && nativeLiveTickRef.current && !isHidden('live') ? nativeLiveTickRef.current.price : null, liveMarkerColor);
    priceSeriesRef.current = price;
    const persistPriceScaleRange = () => {
      if (!showGex || typeof window === 'undefined') return;
      const range = chart.priceScale('right').getVisibleRange();
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from === range.to) return;
      persistQqqChartRange(qqqPcsGexPriceScaleStorageKey, range);
    };
    const persistTimeScaleRange = (range: { from: number; to: number } | null = chart.timeScale().getVisibleLogicalRange()) => {
      if (!showGex || typeof window === 'undefined') return;
      const validRange = validVisibleLogicalRange(range);
      if (!validRange) return;
      persistQqqChartRange(qqqPcsGexTimeScaleStorageKey, validRange);
    };
    const paintOverlay = (context: CanvasRenderingContext2D, width: number) => {
      const { isHidden, overlayModel, displayKing, stableGexProfileHistory, stableWallHistory, visibleGexProfile } = overlayStateRef.current;
      if (!showGex) return;
      const paneHeight = chart.panes()[0]?.getHeight() ?? height;
      setPrimaryPaneHeight((current) => current === paneHeight ? current : paneHeight);
      if (granularity === '1d') return;
      context.save();
      context.beginPath();
      context.rect(0, 0, width, paneHeight);
      context.clip();
      const coordinate = (value: number | null, max: number) => value !== null && Number.isFinite(value) && value >= -8 && value <= max + 8 ? Number(value) : null;
      if (!isHidden('wall_history')) {
        const segments = overlayModel.segments;
        const maxAbs = Math.max(...segments.map((segment) => Math.abs(segment.magnitude)), 1e-9);
        for (const segment of segments) {
          const startX = gexHistoryCoordinate(timeCoordinate(segment.startTime));
          const endX = gexHistoryCoordinate(timeCoordinate(segment.endTime));
          const startY = gexHistoryCoordinate(price.priceToCoordinate(segment.startPrice));
          const endY = gexHistoryCoordinate(price.priceToCoordinate(segment.endPrice));
          if (startX === null || endX === null || startY === null || endY === null) continue;
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, startY);
          context.lineTo(endX, endY);
          context.strokeStyle = segment.side === 'call' ? qqqGexCallColor : qqqGexPutColor;
          context.globalAlpha = 0.86;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.lineWidth = Math.min(6, gexTrailLineWidth(segment.magnitude, maxAbs, true));
          context.stroke();
        }
        context.setLineDash([3, 3]);
        for (const move of overlayModel.moves) {
          const fromX = gexHistoryCoordinate(timeCoordinate(move.fromTime));
          const toX = gexHistoryCoordinate(timeCoordinate(move.toTime));
          const fromY = gexHistoryCoordinate(price.priceToCoordinate(move.fromStrike));
          const toY = gexHistoryCoordinate(price.priceToCoordinate(move.toStrike));
          if (fromX === null || toX === null || fromY === null || toY === null) continue;
          const color = move.side === 'call' ? qqqGexCallColor : qqqGexPutColor;
          context.beginPath();
          context.moveTo(fromX, fromY);
          context.lineTo(toX, toY);
          context.strokeStyle = color;
          context.lineWidth = 1.5;
          context.globalAlpha = 0.9;
          context.stroke();
          context.setLineDash([]);
          context.beginPath();
          context.arc(fromX, fromY, 3.5, 0, Math.PI * 2);
          context.fillStyle = '#05070b';
          context.fill();
          context.strokeStyle = color;
          context.stroke();
          context.fillStyle = color;
          context.fillRect(toX - 3.5, toY - 3.5, 7, 7);
          context.setLineDash([3, 3]);
        }
        context.setLineDash([]);
      }
      const latestSnapshotTime = stableGexProfileHistory.at(-1)?.time ?? stableWallHistory.at(-1)?.time;
      const snapshotX = latestSnapshotTime ? coordinate(timeCoordinate(chartTime(latestSnapshotTime)), width) : null;
      if (visibleGexProfile.length) {
        context.font = '800 10px monospace';
        for (const point of overlayModel.labelPoints) {
          const top = coordinate(price.priceToCoordinate(point.strike), paneHeight);
          if (top === null) continue;
          const isKing = !!displayKing && point.strike === displayKing.strike;
          const label = point.isGammaFlip ? 'GF' : isKing ? 'King' : point.isCallWall ? 'Call' : point.isPutWall ? 'Put' : null;
          const color = point.isGammaFlip
            ? '#67e8f9'
            : isKing
              ? 'rgba(226, 232, 240, 0.86)'
              : point.isCallWall
                ? qqqGexCallColor
                : point.isPutWall
                  ? qqqGexPutColor
                  : point.magnitude >= 0 ? qqqGexPositiveColor : qqqGexNegativeColor;
          const text = `${label ? `${label} ` : ''}${formatGexMagnitude(point.magnitude)}`;
          const textWidth = context.measureText(text).width;
          const boxWidth = textWidth + 8;
          const left = snapshotX === null ? Math.max(4, width - boxWidth - 4) : Math.min(width - boxWidth - 4, snapshotX + 11);
          const boxTop = Math.max(1, Math.min(paneHeight - 15, top - 8));
          context.globalAlpha = 1;
          context.fillStyle = 'rgba(6,8,12,0.84)';
          context.fillRect(left, boxTop, boxWidth, 15);
          context.strokeStyle = `${color}88`;
          context.strokeRect(left, boxTop, boxWidth, 15);
          context.fillStyle = color;
          context.textBaseline = 'middle';
          context.fillText(text, left + 4, boxTop + 7.5);
        }
      }
      context.restore();
    };
    // Overlay 与 GEX Ribbon 一起进入原生渲染顺序，不再用 DOM canvas 压在 K 线上。
    let requestOverlayUpdate = () => {};
    const overlayRenderer: IPrimitivePaneRenderer = {
      draw(target) {
        if (!activeRef.current) return;
        target.useMediaCoordinateSpace(({ context, mediaSize }) => paintOverlay(context, mediaSize.width));
      },
    };
    const overlayViews = [{ zOrder: () => 'normal' as const, renderer: () => overlayRenderer }];
    const overlayPrimitive: ISeriesPrimitive = {
      attached({ requestUpdate }) { requestOverlayUpdate = requestUpdate; },
      detached() { requestOverlayUpdate = () => {}; },
      paneViews: () => overlayViews,
    };
    if (showGex && snapshots) snapshots.attachPrimitive(overlayPrimitive);
    // 主价格系列最后绘制：实体、影线覆盖所有指标与墙位。
    price.setSeriesOrder(Number.MAX_SAFE_INTEGER);
    const drawOverlay = () => { if (activeRef.current) requestOverlayUpdate(); };
    drawOverlayRef.current = drawOverlay;
    // setData/autoscale 要跑完一帧布局才拿得到正确的像素坐标，下一帧再读。
    const persistedPriceRange = showGex && typeof window !== 'undefined'
      ? readQqqChartRange(qqqPcsGexPriceScaleStorageKey)
      : null;
    const persistedTimeRange = showGex && typeof window !== 'undefined'
      ? readQqqChartRange(qqqPcsGexTimeScaleStorageKey)
      : null;
    if (persistedPriceRange) chart.priceScale('right').setVisibleRange(persistedPriceRange);
    let overlayFrame: number | null = null;
    let overlayCommitFrame: number | null = null;
    let overlayTimer: ReturnType<typeof setTimeout> | null = null;
    let lastOverlaySyncAt = 0;
    const scheduleGexOverlaySync = () => {
      if (!activeRef.current) return;
      if (overlayFrame !== null || overlayCommitFrame !== null || overlayTimer !== null) return;
      const remaining = Math.max(0, GEX_OVERLAY_SYNC_INTERVAL_MS - (performance.now() - lastOverlaySyncAt));
      const start = () => {
        overlayTimer = null;
        overlayFrame = requestAnimationFrame(() => {
          overlayFrame = null;
          // lightweight-charts 在同一帧内应用缩放；下一帧读取才能和 K 线使用同一套坐标。
          overlayCommitFrame = requestAnimationFrame(() => {
            overlayCommitFrame = null;
            lastOverlaySyncAt = performance.now();
            syncMarkerLabelsRef.current();
            drawOverlay();
          });
        });
      };
      if (remaining > 0) overlayTimer = setTimeout(start, remaining);
      else start();
    };
    scheduleGexOverlaySync();
    if (data.price.length) {
      const seed = data.price.at(-1)!;
      const persistedLive = pickPersistedLiveCandle(liveCandleRef.current, Number(seed.time), data.candles.at(-1)?.close ?? seed.value);
      const nextLive = persistedLive ?? (data.candles.length
        ? (() => {
            const candle = data.candles.at(-1)!;
            return { time: Number(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close };
          })()
        : { time: Number(seed.time), open: seed.value, high: seed.value, low: seed.value, close: seed.value });
      liveCandleRef.current = nextLive;
      liveBucketTimeRef.current = nextLive.time;
      lastLiveTimeRef.current = nextLive.time;
      lastLivePriceRef.current = nextLive.close;
      if (persistedLive) {
        if (showGex && data.candles.length) {
          (price as ISeriesApi<'Candlestick'>).update({ time: nextLive.time as Time, open: nextLive.open, high: nextLive.high, low: nextLive.low, close: nextLive.close });
        } else {
          (price as ISeriesApi<'Line'>).update({ time: nextLive.time as Time, value: nextLive.close });
        }
      }
    }
    const latestScoreAtOrBefore = (time: number) => {
      const { scoreTimes, scores } = cursorLookupRef.current;
      let low = 0;
      let high = scoreTimes.length - 1;
      let match = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (scoreTimes[middle]! <= time) {
          match = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      return match >= 0 ? scores[match]?.value ?? null : null;
    };
    let hoverFrame: number | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let lastHoverCommitAt = 0;
    let pendingHover: PcsHoverState = null;
    const scheduleHover = (next: PcsHoverState) => {
      pendingHover = next;
      if (hoverFrame !== null || hoverTimer !== null) return;
      const remaining = Math.max(0, CROSSHAIR_HOVER_INTERVAL_MS - (performance.now() - lastHoverCommitAt));
      const commit = () => {
        hoverTimer = null;
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = null;
          lastHoverCommitAt = performance.now();
          hoverStore.set(pendingHover);
        });
      };
      if (remaining > 0) hoverTimer = setTimeout(commit, remaining);
      else commit();
    };
    const onCrosshairMove = (event: MouseEventParams<Time>) => {
      const snapshotTime = typeof event.time === 'number' ? event.time : NaN;
      const { priceByTime, priceTimes, vwapByTime } = cursorLookupRef.current;
      const time = qqqCursorCandleTime(priceTimes, snapshotTime, granularity === '2m' ? 120 : granularity === '5m' ? 300 : 86400) ?? NaN;
      const currentPrice = priceByTime.get(time);
      const currentVwap = vwapByTime.get(time);
      if (!Number.isFinite(time) || currentPrice === undefined || currentVwap === undefined || !event.point) {
        scheduleHover(null);
        return;
      }
      const latestScore = granularity !== '1d' ? latestScoreAtOrBefore(time) : null;
      scheduleHover({ time, snapshotTime, price: currentPrice, vwap: currentVwap, score: latestScore, left: showGex ? event.point.x : Math.max(8, Math.min(container.clientWidth - 188, event.point.x + 12)), top: showGex ? event.point.y : Math.max(8, Math.min(150, event.point.y + 12)) });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    // GEX 图表以 localStorage 为唯一跨重建恢复源，避免 Strict Mode / SWR 把内存中的默认全量窗口置于用户窗口之上。
    let restoredTimeRange = showGex ? persistedTimeRange : validVisibleLogicalRange(visibleLogicalRangeRef.current);
    const firstPriceIndex = data.price[0] ? chart.timeScale().timeToIndex(data.price[0].time) : null;
    const lastPriceIndex = data.price.at(-1) ? chart.timeScale().timeToIndex(data.price.at(-1)!.time) : null;
    // A saved logical window belongs to the old data extent; don't restore a blank chart after switching dates/windows.
    if (restoredTimeRange && firstPriceIndex !== null && lastPriceIndex !== null) restoredTimeRange = restoreQqqDataWindow(restoredTimeRange, firstPriceIndex, lastPriceIndex);
    if (restoredTimeRange) { chart.timeScale().setVisibleLogicalRange(restoredTimeRange); if(lastPriceIndex !== null && restoredTimeRange.to < lastPriceIndex) {followLatestRef.current=false;setFollowLatest(false);} }
    else if (sessionWindow && !showGex) chart.timeScale().setVisibleRange(sessionWindow);
    else chart.timeScale().fitContent();
    const restoreFrame = requestAnimationFrame(() => {
      const range = chart.timeScale().getVisibleLogicalRange();
      const first = data.price[0] ? chart.timeScale().timeToIndex(data.price[0].time) : null;
      const last = data.price.at(-1) ? chart.timeScale().timeToIndex(data.price.at(-1)!.time) : null;
      if (range && first !== null && last !== null) {
        const restored = restoreQqqDataWindow(range, first, last);
        if (restored !== range) chart.timeScale().setVisibleLogicalRange(restored);
      }
    });
    let paneResizeStart: string | null = null;
    let panePersistFrame: number | null = null;
    const paneSignature = () => JSON.stringify(chart.panes().map(pane => pane.getStretchFactor()));
    const beginPaneResize = () => { paneResizeStart = paneSignature(); };
    const finishPaneResize = () => {
      if (paneResizeStart === null) return;
      const changed = paneResizeStart !== paneSignature();
      paneResizeStart = null;
      if (!changed) return;
      panePersistFrame = requestAnimationFrame(() => {
        panePersistFrame = null;
        const runtime = chartRuntimeRef.current;
        if (!runtime || runtime.chart !== chart) return;
        const mainWeight = chart.panes()[0]?.getStretchFactor();
        if (!mainWeight || !Number.isFinite(mainWeight)) return;
        const next = { ...paneWeightsRef.current };
        if (runtime.gammaZero) next.gamma = runtime.gammaZero.getPane().getStretchFactor() / mainWeight;
        if (runtime.netGexSeries) next.gex = runtime.netGexSeries.getPane().getStretchFactor() / mainWeight;
        if (runtime.rsiLine) next.rsi = runtime.rsiLine.getPane().getStretchFactor() / mainWeight;
        paneWeightsRef.current = next;
        try { window.localStorage.setItem(qqqGexPaneHeightStorageKey, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
        scheduleGexOverlaySync();
      });
    };
    if (showGex) {
      container.addEventListener('pointerdown', beginPaneResize, true);
      window.addEventListener('pointerup', finishPaneResize);
      window.addEventListener('pointercancel', finishPaneResize);
    }
    const observer = new ResizeObserver(() => { if (!activeRef.current) return; chart.applyOptions({ width: container.clientWidth, ...(fillHeight ? { height: container.clientHeight } : {}) }); scheduleGexOverlaySync(); });
    const persistAfterFrame = () => { requestAnimationFrame(() => { persistPriceScaleRange(); persistTimeScaleRange(); }); scheduleGexOverlaySync(); };
    // Fit/restore/resize also emit range changes. Only user navigation may
    // download older windows; otherwise mounting can drain the entire session.
    let userRangeChange = false;
    const armRangeRequest = () => { userRangeChange = true; };
    const pauseFollow = () => { followLatestRef.current = false; setFollowLatest(false); };
    const pointerMoveListener = (event: PointerEvent) => { if (event.buttons) { pauseFollow(); armRangeRequest(); } };
    const wheelListener = () => { pauseFollow(); armRangeRequest(); persistAfterFrame(); };
    const mouseUpListener = () => { persistAfterFrame(); };
    const touchEndListener = () => { persistAfterFrame(); };
    const dblClickListener = () => { persistAfterFrame(); };
    if (showGex) {
      container.addEventListener('wheel', wheelListener, { passive: true });
      container.addEventListener('pointerdown', armRangeRequest);
      container.addEventListener('pointermove', pointerMoveListener);
      container.addEventListener('touchmove', armRangeRequest, { passive: true });
      container.addEventListener('mouseup', mouseUpListener);
      container.addEventListener('touchend', touchEndListener);
      container.addEventListener('dblclick', dblClickListener);
    }
    let visibleRangeTimer: ReturnType<typeof setTimeout> | null = null;
    const syncGexOverlays = (range: { from: number; to: number } | null) => {
      const validRange = validVisibleLogicalRange(range);
      if (validRange) visibleLogicalRangeRef.current = validRange;
      scheduleGexOverlaySync();
      if (!onVisibleTimeRangeChange || !validRange) return;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        if (!userRangeChange) return;
        userRangeChange = false;
        const visible = chart.timeScale().getVisibleRange();
        const first = visible?.from;
        const last = visible?.to;
        // Lightweight Charts 的 UTCTimestamp 单位为秒；独立页缓存和 API
        // 窗口统一使用 Date/Unix 毫秒，必须在边界转换一次。
        if (typeof first === 'number' && typeof last === 'number') onVisibleTimeRangeChange({ from: first * 1_000, to: last * 1_000 });
      }, 120);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncGexOverlays);
    const focusReminder = (event: { time?: Time }) => {
      const signal = focusSignalsRef.current.find(signal => Math.floor(Date.parse(signal.anchorBar ?? '') / 1000) === Number(event.time));
      if (signal) window.dispatchEvent(new CustomEvent('qqq-gex:open-reminder', { detail: signal.anchorBar }));
    };
    chart.subscribeClick(focusReminder);
    observer.observe(container);
    return () => {
      // effect 重建只保留内存窗口；localStorage 仅由真实用户交互写入，避免 Strict Mode 清理把默认全量窗口覆盖进去。
      const finalTimeRange = validVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange());
      if (finalTimeRange) visibleLogicalRangeRef.current = finalTimeRange;
      observer.disconnect();
      if (panePersistFrame !== null) cancelAnimationFrame(panePersistFrame);
      container.removeEventListener('pointerdown', beginPaneResize, true);
      window.removeEventListener('pointerup', finishPaneResize);
      window.removeEventListener('pointercancel', finishPaneResize);
      cancelAnimationFrame(restoreFrame);
      if (showGex) {
        container.removeEventListener('wheel', wheelListener);
        container.removeEventListener('pointerdown', armRangeRequest);
        container.removeEventListener('pointermove', pointerMoveListener);
        container.removeEventListener('touchmove', armRangeRequest);
        container.removeEventListener('mouseup', mouseUpListener);
        container.removeEventListener('touchend', touchEndListener);
        container.removeEventListener('dblclick', dblClickListener);
      }
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncGexOverlays);
      if (overlayFrame !== null) cancelAnimationFrame(overlayFrame);
      if (overlayCommitFrame !== null) cancelAnimationFrame(overlayCommitFrame);
      if (overlayTimer !== null) clearTimeout(overlayTimer);
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      hoverStore.set(null);
      chart.remove();
      chartRuntimeRef.current = null;
      syncMarkerLabelsRef.current = () => undefined;
      priceSeriesRef.current = null;
      drawOverlayRef.current = null;
      liveMarkerRef.current = null;
      liveBucketTimeRef.current = null;
    };
  // The chart instance is intentionally rebuilt only when its structural inputs change;
  // mutable series data is synchronized by the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.candles.length > 0, data.price.length > 0, granularity, height, fillHeight, isLive, onVisibleTimeRangeChange, renderer, showGex ? null : sessionWindow, showAuxSeries, showExtendedHours, showGex]);

  useEffect(() => {
    const runtime = chartRuntimeRef.current;
    if (!runtime || !active) return;
    const previousGexPane = runtime.netGexSeries;
    const previousRsiPane = runtime.rsiLine;
    const previousGammaPane = runtime.gammaZero;
    if (showGex && granularity === '2m' && hasGammaPositionHistory && !isHidden('gamma_position')) {
      if (!runtime.gammaZero) Object.assign(runtime, addQqqGammaPositionPane(runtime.chart));
    } else if (runtime.gammaZero || runtime.gammaVt) {
      if (runtime.gammaZero) runtime.chart.removeSeries(runtime.gammaZero);
      if (runtime.gammaVt) runtime.chart.removeSeries(runtime.gammaVt);
      runtime.gammaZero = null; runtime.gammaVt = null;
      for (const key of ['gamma-zero', 'gamma-vt']) { runtime.seriesRows.delete(key); runtime.seriesSignatures.delete(key); }
    }
    if (showGex && data.gexTotal.some(point => 'value' in point && Number.isFinite(point.value)) && !isHidden('net_gex')) {
      if (!runtime.netGexSeries) Object.assign(runtime, addQqqGexPane(runtime.chart));
    } else if (runtime.netGexSeries || runtime.flipSeries) {
      if (runtime.netGexSeries) runtime.chart.removeSeries(runtime.netGexSeries);
      if (runtime.flipSeries) runtime.chart.removeSeries(runtime.flipSeries);
      runtime.netGexSeries = null;
      runtime.flipSeries = null;
      for (const key of ['net-gex', 'gamma-flip']) {
        runtime.seriesRows.delete(key);
        runtime.seriesSignatures.delete(key);
      }
    }
    const visibility: Array<[LegendKey, { options: () => {visible: boolean}; applyOptions: (options: {visible: boolean}) => void } | null]> = [
      ['price', runtime.price], ['vwap', runtime.vwap], ['kc', runtime.kcUpper], ['kc', runtime.kcLower], ['kc', runtime.kcBasis],
      ['trade_low', runtime.lowZonePath], ['trade_high', runtime.highZonePath], ['score', runtime.score], ['score', runtime.daily],
      ['confirmation', runtime.confirmation], ['net_gex', runtime.netGexSeries], ['gamma_flip', runtime.flipSeries],
      ['session_shade', runtime.sessionShade],
    ];
    for (const [key, series] of visibility) {
      const visible = !isHidden(key);
      if (series && series.options().visible !== visible) series.applyOptions({ visible });
    }
    if (showGex && showAuxSeries && granularity === '2m' && rsiSeriesData.length && !isHidden('rsi')) {
      if (!runtime.rsiLine) runtime.rsiLine = addQqqRsiSeries(runtime.chart, rsiSeriesData);
    } else if (runtime.rsiLine) {
      runtime.chart.removeSeries(runtime.rsiLine);
      runtime.rsiLine = null;
      runtime.seriesRows.delete('rsi'); runtime.seriesSignatures.delete('rsi');
    }
    if (previousGexPane !== runtime.netGexSeries || previousRsiPane !== runtime.rsiLine || previousGammaPane !== runtime.gammaZero) applyQqqPaneWeights(runtime, paneWeightsRef.current);
    const scale = runtime.chart.timeScale();
    const prepending = runtime.firstPriceTime !== null && data.price[0] && Number(data.price[0].time) < Number(runtime.firstPriceTime);
    const previousRange = prepending ? scale.getVisibleLogicalRange() : null;
    const anchorTime = previousRange ? scale.getVisibleRange()?.from : null;
    const anchorIndex = anchorTime != null ? scale.timeToIndex(anchorTime) : null;
    const setSeriesData = (key: string, series: { setData: (value: never) => void; update?: (value: never) => void } | null, next: readonly unknown[]) => {
      if (!series || runtime.seriesRows.get(key) === next) return;
      const signature = chartDataSignature(next);
      if (runtime.seriesSignatures.get(key) === signature) return;
      runtime.seriesSignatures.set(key, signature);
      const incremental = ['price','vwap','kc-upper','kc-lower','kc-basis','net-gex','gamma-flip','rsi'].includes(key)
        ? qqqChartSeriesUpdate(runtime.seriesRows.get(key),next,key==='price'?liveBucketTimeRef.current:null) : {reset:true,points:next};
      if(!incremental.reset && series.update) for(const point of incremental.points)series.update(point as never);
      else series.setData(next as never);
      runtime.seriesRows.set(key,next);
    };
    const confirmedCandle = data.candles.at(-1);
    if (isLive && confirmedCandle && (!liveCandleRef.current || Number(confirmedCandle.time) > liveCandleRef.current.time)) {
      liveCandleRef.current = { ...confirmedCandle, time: Number(confirmedCandle.time) };
      liveBucketTimeRef.current = Number(confirmedCandle.time);
      lastLiveTimeRef.current = Number(confirmedCandle.time);
    }
    if (isLive && confirmedCandle && liveCandleRef.current?.time === Number(confirmedCandle.time)) {
      liveCandleRef.current = { ...liveCandleRef.current, open: confirmedCandle.open, high: Math.max(confirmedCandle.high, liveCandleRef.current.high), low: Math.min(confirmedCandle.low, liveCandleRef.current.low) };
    }
    const nextPriceData = showGex && data.candles.length ? (isLive ? retainQqqLiveHistory(data.candles, liveCandlesRef.current.values()) : data.candles) : data.price;
    setSeriesData('price', runtime.price, nextPriceData);
    setSeriesData('vwap', runtime.vwap, data.vwap);
    setSeriesData('kc-upper', runtime.kcUpper, kcSeries.upper);
    setSeriesData('kc-lower', runtime.kcLower, kcSeries.lower);
    setSeriesData('kc-basis', runtime.kcBasis, kcSeries.basis);
    setSeriesData('low-zone', runtime.lowZonePath, tradeMapBandSeries.low);
    setSeriesData('high-zone', runtime.highZonePath, tradeMapBandSeries.high);
    setSeriesData('score', runtime.score, data.scores);
    setSeriesData('daily', runtime.daily, data.dailyScore);
    setSeriesData('confirmation', runtime.confirmation, data.confirmation);
    setSeriesData('session-anchor', runtime.sessionAnchor, qqqPcsSessionAnchor(sessionWindow, data.price.at(-1)?.time ?? null, granularity === '2m' ? 120 : 300));
    setSeriesData('net-gex', runtime.netGexSeries, qqqChartTimeGrid(data.gexTotal, granularity));
    setSeriesData('gamma-flip', runtime.flipSeries, qqqChartTimeGrid(data.gammaFlip, granularity));
    setSeriesData('rsi', runtime.rsiLine, rsiSeriesData);
    setSeriesData('gamma-zero', runtime.gammaZero, gammaSeries.zero);
    setSeriesData('gamma-vt', runtime.gammaVt, gammaSeries.vt);
    setSeriesData('session-shade', runtime.sessionShade, !isHidden('session_shade') ? buildExtendedHoursShadeSeries(data.price) : []);
    setSeriesData('zone-bands', runtime.zoneBands, tradeMapBandData);
    setSeriesData('snapshots', runtime.snapshots, qqqChartTimeGrid(nativeSnapshotData, granularity));
    runtime.firstPriceTime = data.price[0]?.time ?? null;
    const newAnchorIndex = anchorTime != null ? scale.timeToIndex(anchorTime) : null;
    if (previousRange && anchorIndex !== null && newAnchorIndex !== null) {
      scale.setVisibleLogicalRange(shiftQqqViewportForPrepend(previousRange, anchorIndex, newAnchorIndex));
    }
    syncMarkerLabelsRef.current();
    const hasWallTrajectory = granularity !== '1d' && stableWallHistory.length > 1 && !isHidden('wall_history');
    const nextGexLines = showGex
      ? buildGexProfileLines(visibleGexProfile, isHidden('king') ? null : displayKing?.strike ?? null).filter((line) => !hasWallTrajectory || (line.title !== 'Call Wall' && line.title !== 'Put Wall' && !line.title.startsWith('King ·')))
      : [];
    priceAutoscaleStrikesRef.current = [
      ...nextGexLines.map((line) => line.price),
      ...(latestWallSnapshot ? [latestWallSnapshot.callWallPrice, latestWallSnapshot.putWallPrice, latestWallSnapshot.kingStrike].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0) : []),
    ];
    const priceLineSpecs = [
      ...nextGexLines.map((line) => ({ price: line.price, color: line.color, lineWidth: 1 as const, lineStyle: line.lineStyle, axisLabelVisible: false, title: line.title, lineVisible: true })),
    ];
    const priceLineSignature = JSON.stringify(priceLineSpecs);
    if (runtime.priceLineSignature !== priceLineSignature) {
      for (const line of runtime.priceLines) (runtime.snapshots ?? runtime.price).removePriceLine(line);
      runtime.priceLines = priceLineSpecs.map((line) => (runtime.snapshots ?? runtime.price).createPriceLine(line));
      runtime.priceLineSignature = priceLineSignature;
    }
    priceSeriesRef.current = runtime.price;
    requestAnimationFrame(() => requestAnimationFrame(() => drawOverlayRef.current?.()));
  }, [active, isLive, visiblePriceMarkers, data, displayKing, gammaSeries, gammaModel, gexSummary, granularity, isHidden, latestWallSnapshot, observedPriceLowMarkers, overlayModel, reversalObservations, rsiSeriesData, sessionWindow, showGex, showAuxSeries, stableGexProfileHistory, stableWallHistory, tradeMap, tradeMapBandData, tradeMapBandSeries, kcSeries, visibleGexProfile, nativeSnapshotData, hasGammaPositionHistory]);

  useEffect(() => {
    const runtime = chartRuntimeRef.current;
    const container = ref.current;
    if (active && runtime && container) runtime.chart.applyOptions({ width: container.clientWidth, ...(fillHeight ? { height: container.clientHeight } : {}) });
  }, [active, fillHeight]);

  const applyLiveTick = useCallback((liveTick: QqqLiveTick | null) => {
    if (!activeRef.current) return;
    if (liveTick && !qqqLiveQuoteUsable(liveTick)) liveTick = null;
    nativeLiveTickRef.current = liveTick;
    const runtime = chartRuntimeRef.current;
    if (runtime) syncQqqLivePriceLabel(runtime, liveStreamEnabled && liveTick && !isHidden('live') ? liveTick.price : null, liveMarkerColor, liveConnection === 'live' ? 'LIVE' : liveConnection === 'offline' ? '断开' : liveConnection === 'reconnecting' ? '重连' : '延迟');
    if (!liveStreamEnabled || !liveTick) {
      liveMarkerRef.current = null;
      drawOverlayRef.current?.();
      return;
    }
    if (nativeLiveTickRef.current && liveTick.time < lastLiveTimeRef.current) return;
    const previousBucketTime = liveCandleRef.current?.time ?? liveBucketTimeRef.current ?? lastLiveTimeRef.current;
    const bucketTime = resolveLiveBucketTime(liveTick.time, previousBucketTime, granularity === '2m' ? 120 : 300);
    if (bucketTime >= lastLiveTimeRef.current) {
      liveBucketTimeRef.current = bucketTime;
      if (showGex && data.candles.length) {
        const prev = liveCandleRef.current;
        const next = !prev || bucketTime > prev.time
          ? {
              time: bucketTime,
              open: prev?.close ?? liveTick.price,
              high: Math.max(prev?.close ?? liveTick.price, liveTick.price, liveTick.observedHigh ?? liveTick.price),
              low: Math.min(prev?.close ?? liveTick.price, liveTick.price, liveTick.observedLow ?? liveTick.price),
              close: liveTick.price,
            }
          : {
              time: prev.time,
              open: prev.open,
              high: Math.max(prev.high, liveTick.price, liveTick.observedHigh ?? liveTick.price),
              low: Math.min(prev.low, liveTick.price, liveTick.observedLow ?? liveTick.price),
              close: liveTick.price,
            };
        liveCandleRef.current = next;
        liveCandlesRef.current.set(next.time,next);
        while(liveCandlesRef.current.size>512)liveCandlesRef.current.delete(liveCandlesRef.current.keys().next().value!);
        (priceSeriesRef.current as ISeriesApi<'Candlestick'> | null)?.update({ time: next.time as Time, open: next.open, high: next.high, low: next.low, close: next.close });
      } else {
        (priceSeriesRef.current as ISeriesApi<'Line'> | null)?.update({ time: bucketTime as Time, value: liveTick.price });
      }
      lastLiveTimeRef.current = bucketTime;
    }
    lastLivePriceRef.current = liveTick.price;
    liveMarkerRef.current = isHidden('live') ? null : { price: liveTick.price, color: liveMarkerColor };
    if (followLatestRef.current && runtime) scrollQqqToLatest(runtime,bucketTime);
    drawOverlayRef.current?.();
  }, [data.candles.length, granularity, isHidden, liveMarkerColor, liveStreamEnabled, liveConnection, showGex]);
  useQqqLiveTickEffect(liveStreamEnabled && showGex && renderer !== 'kline', applyLiveTick);
  useEffect(() => {
    applyLiveTick(renderer === 'kline' || !showGex ? liveTick : liveStreamEnabled ? nativeLiveTickRef.current : null);
  }, [applyLiveTick, liveTick, liveStreamEnabled, renderer, showGex]);

  const legendItems = buildChartLegendItems({ granularity, showAuxSeries, showGex, isLive: liveStreamEnabled, hasRsi: showGex && granularity === '2m' && rsiSeriesData.length > 0, hasGexTotal: data.gexTotal.length > 0, hasGammaFlip: data.gammaFlip.length > 0, hasGexProfile: stableGexProfile.length > 0 || stableGexProfileHistory.length > 0, hasWallHistory: granularity !== '1d' && stableWallHistory.length > 0 });
  const compactLegendItems = legendItems.filter((item) => item.key === 'live' || item.key === 'gex_positive' || item.key === 'gex_negative' || item.key === 'wall_history');
  const gexTableRows = useMemo(() => showGex ? buildGexHistoryTableRows(stableGex, gexObservationHistory?.filter(p=>!restrictToPriceSession||isQqqGexSnapshotInPriceSession(p.time,priceSessionAt))) : [], [showGex, stableGex, gexObservationHistory,restrictToPriceSession,priceSessionAt]);
  const visibleGexTableRows = useMemo(() => !historical && granularity !== '1d' ? selectLatestEasternDayRows(gexTableRows) : gexTableRows, [gexTableRows, granularity, historical]);
  const gexStructureByKey = useMemo(() => new Map(gexTableRows.map((row) => [row.key, buildGexSnapshotStructure(row.iso, row.totalGex, row.gammaFlipLevel, bars, stableWallHistory)])), [gexTableRows, bars, stableWallHistory]);
  // 表格为最新在前，趋势序列必须反转为时间正序后再 EWMA/去抖，防止把未来快照混入当时判断。
  const chronologicalGexRows = useMemo(() => gexTableRows.slice().reverse(), [gexTableRows]);
  const smoothedGexTrendInputs = useMemo(() => smoothGexTrendInputs(chronologicalGexRows), [chronologicalGexRows]);
  const rawGexTrendSeries = useMemo(() => chronologicalGexRows.map((row, index) => (
    deriveObservedGexHedgeTrend(
      row.observation,chronologicalGexRows[index-1]?.observation,
      smoothedGexTrendInputs[index]!,
      smoothedGexTrendInputs[index - 1] ?? null,
      closeAtOrBefore(bars, row.iso),
      chronologicalGexRows[index - 1] ? closeAtOrBefore(bars, chronologicalGexRows[index - 1]!.iso) : null,
      { current: gexStructureByKey.get(row.key) ?? null, previous: chronologicalGexRows[index - 1] ? gexStructureByKey.get(chronologicalGexRows[index - 1]!.key) ?? null : null },
    )
  )), [chronologicalGexRows, smoothedGexTrendInputs, bars, gexStructureByKey]);
  const compactGexTrendSeries = useMemo(() => compactGexHedgeTrendDisplay(rawGexTrendSeries), [rawGexTrendSeries]);
  const rawGexTrendByKey = useMemo(() => new Map(chronologicalGexRows.map((row, index) => [row.key, rawGexTrendSeries[index]! ])), [chronologicalGexRows, rawGexTrendSeries]);
  const gexTrendByKey = useMemo(() => new Map(chronologicalGexRows.map((row, index) => [row.key, compactGexTrendSeries[index]! ])), [chronologicalGexRows, compactGexTrendSeries]);
  const gexValidationByKey = useMemo(() => new Map(gexTableRows.map((row, index) => {
    const futureRow = gexTableRows[index - 1] ?? null;
    return [row.key, validateGexHedgeTrend(rawGexTrendByKey.get(row.key)!, closeAtOrBefore(bars, row.iso), futureRow ? closeAtOrBefore(bars, futureRow.iso) : null)];
  })), [bars, gexTableRows, rawGexTrendByKey]);
  const rsiArrow = rsiState.slope === null ? '·' : rsiState.slope > 0 ? '↑' : rsiState.slope < 0 ? '↓' : '→';
  const volumeLabel = volumeState.state === 'ABSORPTION' ? '吸收' : volumeState.state === 'EXHAUSTION' ? '衰竭' : volumeState.state === 'BREAKOUT' ? '突破' : volumeState.state === 'NORMAL' ? '正常' : '不可用';
  const klineSessionPrice = useMemo(() => {
    if (renderer !== 'kline') return [];
    const source = showExtendedHours && extendedHoursBars && extendedHoursBars.length > bars.length ? extendedHoursBars : bars;
    return source
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .map((bar) => ({ time: chartTimeForGranularity(bar.timestamp, granularity), value: bar.close }))
      .filter((point) => Number.isFinite(Number(point.time)));
  }, [bars, extendedHoursBars, granularity, showExtendedHours, renderer]);
  const klineInput = useMemo(() => renderer !== 'kline' ? null : ({
    bars: (bars.length ? bars : liveTick ? [{timestamp:new Date(Math.floor(liveTick.time / (granularity === '2m' ? 120 : 300)) * (granularity === '2m' ? 120 : 300) * 1000).toISOString(),close:liveTick.price,volume:0}] : []).map((bar) => ({ ...bar, open: bar.open ?? bar.close, high: bar.high ?? bar.close, low: bar.low ?? bar.close })),
    profileHistory: stableGexProfileHistory.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : point.time, strikes: point.strikes })),
    vwap: data.vwap.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), value: point.value })),
    rsi: rsiSeriesData.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), value: point.value })),
    gammaPosition,
    netGex: data.gexTotal.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), value: point.value })),
    score: data.scores.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), value: point.value })),
    markers: [
      ...visiblePriceMarkers,
      ...(!isHidden('markers') ? observedGexLowMarkers : []).flatMap((marker) => {
        const markerTime = Number(marker.time);
        const bar = data.normalizedBars.reduce<typeof data.normalizedBars[number] | null>((current, point) => {
          const pointTime = Number(point.time);
          return Number.isFinite(pointTime) && pointTime <= markerTime && (!current || pointTime > Number(current.time)) ? point : current;
        }, null);
        return bar ? [{ ...marker, price: Number(bar.low ?? bar.close) }] : [];
      }),
    ].map((marker) => ({ time: typeof marker.time === 'number' ? new Date(marker.time * 1000).toISOString() : String(marker.time), price: marker.price, color: marker.color, text: marker.text ?? '' })),
    sessionShade: buildExtendedHoursShadeSeries(klineSessionPrice).map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), shade: point.shade })),
    kc: observationBands.channel.map(p => ({ ...p, time: new Date(p.time * 1000).toISOString() })),
    tradeBands: tradeMapBandData.map((point) => ({ time: typeof point.time === 'number' ? new Date(point.time * 1000).toISOString() : String(point.time), lowLower: point.lowLower, lowUpper: point.lowUpper, highLower: point.highLower, highUpper: point.highUpper, activeSide: point.activeSide, showLow: point.showLow, showHigh: point.showHigh })),
    liveMarker: liveTick ? { time: new Date(liveTick.time * 1000).toISOString(), price: liveTick.price, color: liveMarkerColor } : null,
    hiddenLegends: Object.entries(hiddenLegends).filter(([key, hidden]) => hidden && key !== 'markers').map(([key]) => key),
    trends: chronologicalGexRows.map((row) => ({ time: row.iso, label: gexTrendByKey.get(row.key)?.label ?? '—' })),
    lines: Array.from(new Map([
      ...(gexSummary?.gammaFlip !== null && gexSummary?.gammaFlip !== undefined && !hiddenLegends.gamma_flip ? [['GF', { label: 'GF', price: gexSummary.gammaFlip, color: '#67e8f9' }]] : []),
      ...(displayCallWall && !hiddenLegends.call_wall && displayCallWall.strike !== displayPutWall?.strike ? [['Call', { label: 'Call', price: displayCallWall.strike, color: '#38bdf8' }]] : []),
      ...(displayPutWall && !hiddenLegends.put_wall && displayPutWall.strike !== displayCallWall?.strike ? [['Put', { label: 'Put', price: displayPutWall.strike, color: '#f472b6' }]] : []),
      ...(displayKing && !hiddenLegends.king ? [['King', { label: 'King', price: displayKing.strike, color: '#e2e8f0' }]] : []),
    ] as Array<[string, { label: string; price: number; color: string; dashed?: boolean }]>).values()),
  }), [visiblePriceMarkers, isHidden, bars, gammaPosition, chronologicalGexRows, data, displayCallWall, displayKing, displayPutWall, gexSummary, gexTrendByKey, hiddenLegends, klineSessionPrice, liveMarkerColor, liveTick, observedGexLowMarkers, rsiSeriesData, stableGexProfileHistory, tradeMapBandData, observationBands.channel, renderer, granularity]);
  // Keep chart-derived values and visibility controls in the same chart instance when shown in the sidebar.
  const structureObservation = showGex && tradeMap && <div className={structureObservationTarget === undefined ? "qqq-trade-map" : "qqq-trade-map qqq-trade-map--inline"} style={structureObservationTarget !== undefined ? { borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '.68rem', lineHeight: 1.6, marginTop: 12, paddingTop: 10 } : { backdropFilter: 'blur(10px)', background: 'rgba(6, 8, 12, .82)', border: '1px solid rgba(148,163,184,.22)', borderRadius: 7, boxShadow: '0 4px 16px rgba(0,0,0,.22)', color: '#cbd5e1', fontFamily: 'var(--font-mono)', fontSize: '0.54rem', lineHeight: 1.3, maxWidth: 270, padding: '0.34rem 0.42rem', pointerEvents: 'auto', position: 'absolute', right: 62, top: 8, width: 'calc(100% - 86px)', zIndex: 5 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 7, justifyContent: 'space-between' }}>
          <span style={{ alignItems: 'center', display: 'inline-flex', gap: 4 }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '.68rem' }}>价格与量能观察</strong>
            <Tooltip maxWidth="230px" content="KC 使用 EMA20 ± 2×ATR10，只观察价格与波动范围。结构观察区保留真实来源，换来源需两根完成 K 线确认，失效或 GEX 超过10分钟取消其贡献；均不单独触发开仓。">
              <span aria-label="结构观察说明" style={{ alignItems: 'center', border: '1px solid var(--border-subtle)', borderRadius: 999, color: 'var(--text-secondary)', display: 'inline-flex', fontSize: '.6rem', gap: 2, padding: '1px 4px' }}><Info size={9} strokeWidth={2} />说明</span>
            </Tooltip>
          </span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 900 }}>{kc ? (tradeMap.spot > kc.upper ? '向上突破通道' : tradeMap.spot < kc.lower ? '向下突破通道' : '通道内') : 'KC 暖机中'}</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 3 }}>
          <span style={{ color: rsiState.value === null ? 'var(--text-tertiary)' : 'var(--accent-warning)' }}>RSI14 {rsiState.value?.toFixed(1) ?? '—'} {rsiArrow}</span>
          <span>量 {volumeLabel}{volumeState.ratio === null ? '' : ` ${volumeState.ratio.toFixed(1)}x`}</span>
          <span style={{ color: 'var(--text-secondary)' }}>仅供观察</span>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', display: 'grid', gap: '2px 8px', gridTemplateColumns: 'auto 1fr auto', marginTop: 4, paddingTop: 3 }}>
          <button aria-pressed={!isHidden('trade_low')} onClick={() => toggleLegend('trade_low')} style={{ background: 'transparent', border: 0, color: isHidden('trade_low') ? 'var(--text-tertiary)' : 'var(--accent-success)', cursor: 'pointer', font: 'inherit', fontWeight: 900, padding: 0, textAlign: 'left', textDecoration: isHidden('trade_low') ? 'line-through' : 'none' }} title="显示/隐藏支撑观察区" type="button">支撑</button><span style={{ color: isHidden('trade_low') ? 'var(--text-tertiary)' : undefined }}>{observation?.low ? `${observation.low.lower.toFixed(2)}–${observation.low.upper.toFixed(2)}` : '等待确认'}</span><span className="qqq-trade-map__sources" style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{observation?.low ? `${observation.low.source} · ${formatEasternSnapshot(new Date(observation.low.sourceTime*1000).toISOString(), false)}` : '—'}</span>
          <button aria-pressed={!isHidden('trade_high')} onClick={() => toggleLegend('trade_high')} style={{ background: 'transparent', border: 0, color: isHidden('trade_high') ? 'var(--text-tertiary)' : 'var(--accent-danger)', cursor: 'pointer', font: 'inherit', fontWeight: 900, padding: 0, textAlign: 'left', textDecoration: isHidden('trade_high') ? 'line-through' : 'none' }} title="显示/隐藏阻力观察区" type="button">阻力</button><span style={{ color: isHidden('trade_high') ? 'var(--text-tertiary)' : undefined }}>{observation?.high ? `${observation.high.lower.toFixed(2)}–${observation.high.upper.toFixed(2)}` : '等待确认'}</span><span className="qqq-trade-map__sources" style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{observation?.high ? `${observation.high.source} · ${formatEasternSnapshot(new Date(observation.high.sourceTime*1000).toISOString(), false)}` : '—'}</span>
        </div>
        <div style={{ color: 'var(--text-tertiary)', marginTop: 3 }}>{observation?.reason === 'OVERLAP' ? '暂无清晰区间：支撑与阻力重叠。' : observation?.gexStale ? '墙位数据缺失或过期，已取消其贡献。' : '结构观察区 · 两根确认，失效取消。'}</div>
      </div>;

  const chartLegend = showGex && gexSummary && <div style={{ backdropFilter: 'blur(10px)', background: 'rgba(6, 8, 12, 0.66)', border: '1px solid rgba(255,255,255,0.045)', borderRadius: 8, bottom: 'auto', boxShadow: '0 3px 10px rgba(0,0,0,.18)', fontFamily: 'var(--font-mono)', fontSize: '0.53rem', left: 10, lineHeight: 1.18, minWidth: 160, padding: '0.22rem 0.32rem', position: 'absolute', top: Math.max(8, primaryPaneHeight - 142), zIndex: 2 }}>
        <div style={{ alignItems: 'center', color: '#f3f4f6', display: 'flex', gap: 6, marginBottom: 3 }}>
          <strong style={{ fontWeight: 900 }}>Gamma Walls</strong>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.58rem' }}>•</span>
          <span style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, color: '#d1d5db', fontSize: '0.52rem', padding: '1px 4px' }}>{gexDte}DTE</span>
          {premarketGexReference && <span style={{ border: '1px solid rgba(251,191,36,.3)', borderRadius: 999, color: '#fbbf24', fontSize: '0.5rem', padding: '1px 4px' }}>参考 {premarketGexReference} ET</span>}
        </div>
        {liveTick && <button aria-pressed={!isHidden('live')} onClick={() => toggleLegend('live')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('live') ? 'rgba(148,163,184,0.7)' : '#34d399', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', marginBottom: 1, padding: '1px 0', textAlign: 'left', width: '100%' }} title="显示/隐藏实时价线" type="button"><span style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}><span style={{ background: isHidden('live') ? 'transparent' : '#f8fafc', border: '1px solid #f8fafc', borderRadius: 2, display: 'inline-block', height: 7, width: 7 }} /><span style={{ textDecoration: isHidden('live') ? 'line-through' : 'none' }}>Live</span></span><span>{liveTick.price.toFixed(2)}</span></button>}
        {displayKing && <button aria-pressed={!isHidden('king')} onClick={() => toggleLegend('king')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('king') ? 'rgba(148,163,184,0.7)' : '#e5e7eb', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', marginBottom: 1, padding: '1px 0', textAlign: 'left', width: '100%' }} title="显示/隐藏 K 线图上的 King 价位" type="button"><span style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}><span style={{ background: isHidden('king') ? 'transparent' : '#e5e7eb', border: '1px solid #e5e7eb', borderRadius: 2, display: 'inline-block', height: 7, width: 7 }} /><span style={{ textDecoration: isHidden('king') ? 'line-through' : 'none' }}>King</span></span><span>{displayKing.strike} {formatGexMagnitude(displayKing.magnitude)}</span></button>}
        <button
          onClick={() => toggleLegend('call_wall')}
          onMouseEnter={() => setHoveredLegend('call_wall')}
          onMouseLeave={() => setHoveredLegend((current) => (current === 'call_wall' ? null : current))}
          style={{ alignItems: 'center', animation: hoveredLegend === 'call_wall' ? 'qqqPcsLegendPulse .9s ease-in-out infinite' : 'none', background: 'transparent', border: 'none', color: isHidden('call_wall') ? 'rgba(148,163,184,0.7)' : '#34d399', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '1px 0', textAlign: 'left', width: '100%' }}
          type="button"
        >
          <span style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}>
            <span style={{ background: isHidden('call_wall') ? 'transparent' : '#34d399', border: '1px solid #34d399', borderRadius: 2, display: 'inline-block', height: 7, width: 7 }} />
            <span style={{ textDecoration: isHidden('call_wall') ? 'line-through' : 'none' }}>Call Wall</span>
          </span>
          <span>{displayCallWall ? `${displayCallWall.strike} ${formatGexMagnitude(displayCallWall.magnitude)}` : '—'}</span>
        </button>
        <button
          onClick={() => toggleLegend('put_wall')}
          onMouseEnter={() => setHoveredLegend('put_wall')}
          onMouseLeave={() => setHoveredLegend((current) => (current === 'put_wall' ? null : current))}
          style={{ alignItems: 'center', animation: hoveredLegend === 'put_wall' ? 'qqqPcsLegendPulse .9s ease-in-out infinite' : 'none', background: 'transparent', border: 'none', color: isHidden('put_wall') ? 'rgba(148,163,184,0.7)' : '#f87171', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '1px 0', textAlign: 'left', width: '100%' }}
          type="button"
        >
          <span style={{ alignItems: 'center', display: 'inline-flex', gap: 5 }}>
            <span style={{ background: isHidden('put_wall') ? 'transparent' : '#f87171', border: '1px solid #f87171', borderRadius: 2, display: 'inline-block', height: 7, width: 7 }} />
            <span style={{ textDecoration: isHidden('put_wall') ? 'line-through' : 'none' }}>Put Wall</span>
          </span>
          <span>{displayPutWall ? `${displayPutWall.strike} ${formatGexMagnitude(displayPutWall.magnitude)}` : '—'}</span>
        </button>
        <button aria-pressed={!isHidden('net_gex')} onClick={() => toggleLegend('net_gex')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('net_gex') ? 'rgba(148,163,184,0.7)' : 'rgba(255,255,255,0.82)', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏下方副图的 Net GEX" type="button"><span style={{ textDecoration: isHidden('net_gex') ? 'line-through' : 'none' }}>{netGexLabel}</span><span>{formatGexMagnitude(gexSummary.windowNetGex ?? gexSummary.netGex)} / {gexSummary.gammaFlip?.toFixed(2) ?? '—'}</span></button>
        <button aria-pressed={!isHidden('score')} onClick={() => toggleLegend('score')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('score') ? 'rgba(148,163,184,0.7)' : '#a78bfa', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏下方副图的执行分" type="button"><span style={{ textDecoration: isHidden('score') ? 'line-through' : 'none' }}>执行分</span><span>{data.scores.at(-1)?.value?.toFixed(1) ?? '—'}</span></button>
        {granularity !== '1d' && data.vwap.length > 0 && <button aria-pressed={!isHidden('vwap')} onClick={() => toggleLegend('vwap')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('vwap') ? 'rgba(148,163,184,0.7)' : '#fbbf24', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏主图 VWAP" type="button"><span style={{ textDecoration: isHidden('vwap') ? 'line-through' : 'none' }}>VWAP</span><span>{data.vwap.at(-1)?.value.toFixed(2) ?? '—'}</span></button>}
        {showGex && <button aria-pressed={!isHidden('markers')} onClick={() => toggleLegend('markers')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('markers') ? 'rgba(148,163,184,0.7)' : '#fbbf24', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏价格低点、GEX 低谷与反转观察标记" type="button"><span style={{ textDecoration: isHidden('markers') ? 'line-through' : 'none' }}>事件标记</span><span>研究观察</span></button>}
        {showGex && stableWallHistory.length > 1 && <button aria-pressed={!isHidden('wall_history')} onClick={() => toggleLegend('wall_history')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('wall_history') ? 'rgba(148,163,184,0.7)' : '#cbd5e1', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏 Call/Put Wall 历史阶梯迁移" type="button"><span style={{ textDecoration: isHidden('wall_history') ? 'line-through' : 'none' }}>Wall 历史</span><span>{stableWallHistory.length} 段</span></button>}
        {showGex && showExtendedHours && <button aria-pressed={!isHidden('session_shade')} onClick={() => toggleLegend('session_shade')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('session_shade') ? 'rgba(148,163,184,0.7)' : '#67e8f9', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏盘前盘后时段背景" type="button"><span style={{ textDecoration: isHidden('session_shade') ? 'line-through' : 'none' }}>EXT Shade</span><span>Session</span></button>}
        {showGex && granularity === '2m' && rsiSeriesData.length > 0 && <button aria-pressed={!isHidden('rsi')} onClick={() => toggleLegend('rsi')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('rsi') ? 'rgba(148,163,184,0.7)' : '#fbbf24', cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: '3px 0 0', textAlign: 'left', width: '100%' }} title="显示/隐藏下方副图的 RSI14" type="button"><span style={{ textDecoration: isHidden('rsi') ? 'line-through' : 'none' }}>RSI14</span><span>{rsiState.value?.toFixed(1) ?? '—'}</span></button>}
        <button aria-pressed={!isHidden('gex_positive')} onClick={() => toggleLegend('gex_positive')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('gex_positive') ? 'rgba(148,163,184,0.7)' : qqqGexPositiveColor, cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: 0, textAlign: 'left', width: '100%' }} title="显示/隐藏 K 线图上的净正向 GEX Ribbon" type="button"><span style={{ textDecoration: isHidden('gex_positive') ? 'line-through' : 'none' }}>净正贡献</span><span>{formatGexMagnitude(gexSummary.callTotal)}</span></button>
        <button aria-pressed={!isHidden('gex_negative')} onClick={() => toggleLegend('gex_negative')} style={{ alignItems: 'center', background: 'transparent', border: 'none', color: isHidden('gex_negative') ? 'rgba(148,163,184,0.7)' : qqqGexNegativeColor, cursor: 'pointer', display: 'flex', font: 'inherit', justifyContent: 'space-between', padding: 0, textAlign: 'left', width: '100%' }} title="显示/隐藏 K 线图上的净负向 GEX Ribbon" type="button"><span style={{ textDecoration: isHidden('gex_negative') ? 'line-through' : 'none' }}>净负贡献</span><span>{formatGexMagnitude(gexSummary.putTotal)}</span></button>
        {wallsOverlap && <div style={{ color: '#fbbf24', paddingTop: 2 }}>Wall Overlap &nbsp;{displayCallWall!.strike}</div>}
      </div>;
  const navigateChart = (action: 'all' | 'latest' | 'price') => {
    const runtime = chartRuntimeRef.current;
    if (!runtime) return;
    hoverStore.set(null);
    if (action === 'all') { followLatestRef.current = false; setFollowLatest(false); runtime.chart.timeScale().fitContent(); }
    if (action === 'latest') { followLatestRef.current = true; setFollowLatest(true); scrollQqqToLatest(runtime,liveBucketTimeRef.current ?? Number(data.price.at(-1)?.time)); }
    if (action === 'price') runtime.chart.priceScale('right').applyOptions({autoScale:true});
    try {
      const range = runtime.chart.timeScale().getVisibleLogicalRange();
      if (range) persistQqqChartRange(qqqPcsGexTimeScaleStorageKey, range);
      if (action === 'price') window.localStorage.removeItem(qqqPcsGexPriceScaleStorageKey);
    } catch { /* Navigation works when storage is disabled. */ }
    syncMarkerLabelsRef.current();
  };
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    let highlighted: IPriceLine[] = []; let highlightedRuntime: PcsChartRuntime | null = null;
    const clearHighlight = () => { if(clearTimer) clearTimeout(clearTimer); if(highlightedRuntime && chartRuntimeRef.current===highlightedRuntime) for(const line of highlighted)highlightedRuntime.price.removePriceLine(line); highlighted=[]; };
    const focus = (event: Event) => {
      const anchor = (event as CustomEvent<string>).detail;
      const runtime = chartRuntimeRef.current;
      if (!runtime) return;
      const time = Math.floor(Date.parse(anchor) / 1000);
      const index = runtime.chart.timeScale().timeToIndex(time as Time, true);
      if (index === null || !Number.isFinite(time)) return;
      followLatestRef.current = false; setFollowLatest(false);
      runtime.chart.timeScale().setVisibleLogicalRange({ from: Number(index) - 12, to: Number(index) + 12 });
      const candle = data.candles.find(point => Number(point.time) === time);
      if (candle) runtime.chart.setCrosshairPosition(candle.close, time as Time, runtime.price);
      clearHighlight(); highlightedRuntime=runtime;
      const signal=focusSignalsRef.current.find(item=>item.anchorBar===anchor);
      const zone=signal?.riskPlan?.triggerZone ?? signal?.entryZone;
      if(zone) highlighted=[zone.low,zone.high].map(price=>runtime.price.createPriceLine({price,color:'#d4b16a',lineStyle:2,lineWidth:1,axisLabelVisible:false,title:'提醒触发区'}));
      clearTimer=setTimeout(clearHighlight,8000);
    };
    window.addEventListener('qqq-gex:focus-signal', focus);
    return () => {window.removeEventListener('qqq-gex:focus-signal', focus);clearHighlight();};
  }, [data.candles]);
  const zoneRange = (zone: QqqObservationZone | null | undefined) => zone ? `${zone.lower.toFixed(2)}–${zone.upper.toFixed(2)}` : '等待确认';
  const displayItems: { key: LegendKey; label: string; value: string; color: string; price?:number }[] = [

    ...(displayKing ? [{ key: 'king' as const, price:displayKing.strike, label: '主墙 King', value: `${displayKing.strike} ${formatGexMagnitude(displayKing.magnitude)}`, color: '#e5e7eb' }] : []),
    { key: 'call_wall', price:displayCallWall?.strike, label: '看涨墙', value: displayCallWall ? `${displayCallWall.strike} ${formatGexMagnitude(displayCallWall.magnitude)}` : '—', color: '#34d399' },
    { key: 'put_wall', price:displayPutWall?.strike, label: '看跌墙', value: displayPutWall ? `${displayPutWall.strike} ${formatGexMagnitude(displayPutWall.magnitude)}` : '—', color: '#f87171' },
    ...(granularity === '2m' ? [{ key: 'gamma_position' as const, label: 'Gamma 位置副图', value: gammaPositionLabel, color: '#b7a5ef' }] : []),
    { key: 'net_gex', label: netGexLabel, value: gexSummary ? `${formatGexMagnitude(gexSummary.windowNetGex ?? gexSummary.netGex)} / ${gexSummary.gammaFlip?.toFixed(2) ?? '—'}` : '—', color: '#67e8f9' },
    ...(granularity !== '1d' && data.vwap.length ? [{ key: 'vwap' as const, label: 'VWAP 均价', value: data.vwap.at(-1)?.value.toFixed(2) ?? '—', color: '#fbbf24' }] : []),
    { key: 'directional_markers', label: '盘中提示', value: `${directionalMarkers.length} 条`, color: '#d4b16a' },
    { key: 'markers', label: '结构观察', value: '研究观察', color: '#fbbf24' },
    ...(granularity === '2m' ? [{ key: 'kc' as const, label: 'KC 波动通道', value: kc ? `${kc.lower.toFixed(2)}–${kc.upper.toFixed(2)}` : '暖机中 · 需20根', color: '#a5b4fc' }] : []),
    ...(granularity === '2m' && tradeMap ? [
      { key: 'trade_low' as const, label: '支撑观察区', value: zoneRange(observation?.low), color: '#22c997' },
      { key: 'trade_high' as const, label: '阻力观察区', value: zoneRange(observation?.high), color: '#fb7185' },
    ] : []),
    { key: 'wall_history', label: '墙位历史', value: `${stableWallHistory.length} 段`, color: '#cbd5e1' },
    ...(showExtendedHours ? [{ key: 'session_shade' as const, label: '盘前盘后底色', value: '时段背景', color: '#67e8f9' }] : []),
    ...(granularity === '2m' && rsiSeriesData.length ? [{ key: 'rsi' as const, label: 'RSI14', value: rsiState.value?.toFixed(1) ?? '—', color: '#fbbf24' }] : []),
    { key: 'gex_positive', label: '正向 GEX', value: gexSummary ? formatGexMagnitude(gexSummary.callTotal) : '—', color: qqqGexPositiveColor },
    { key: 'gex_negative', label: '负向 GEX', value: gexSummary ? formatGexMagnitude(gexSummary.putTotal) : '—', color: qqqGexNegativeColor },
  ];
  const gexStructureKeys = new Set<LegendKey>(['king', 'call_wall', 'put_wall', 'net_gex', 'wall_history', 'gex_positive', 'gex_negative']);
  const gammaModelKeys = new Set<LegendKey>(['gamma_position']);
  const advancedKeys=new Set<LegendKey>(['kc','rsi']);
  const displayGroups = [
    { label: 'GEX 结构', items: groupQqqChartDisplayItems(displayItems.filter(item => gexStructureKeys.has(item.key))) },
    { label: 'Gamma 模型', items: groupQqqChartDisplayItems(displayItems.filter(item => gammaModelKeys.has(item.key))) },
    { label: '行情与观察指标', items: groupQqqChartDisplayItems(displayItems.filter(item => !gexStructureKeys.has(item.key) && !gammaModelKeys.has(item.key) && !advancedKeys.has(item.key))) },
    { label: '高级指标', items: groupQqqChartDisplayItems(displayItems.filter(item=>advancedKeys.has(item.key))) },
  ].filter(group => group.items.length > 0 || (group.label === '行情与观察指标' && liveStreamEnabled));
  const setDisplayVisibility=(keys:readonly LegendKey[],hidden:boolean)=>{
    setDisplayPreset('custom');setSavedCombo(false);setHiddenLegends(previous=>{const next={...previous};for(const key of keys)next[key]=hidden;try{window.localStorage.setItem(qqqChartDisplayStorageKey,JSON.stringify(next));}catch{/* In-memory preferences remain usable. */}return next;});
  };
  const chartDisplay = showGex && <div className={settingsStyles.panel} aria-label="GEX 图表显示设置" data-preferences-ready={displayPreferencesReady} aria-busy={!displayPreferencesReady}>
    <div className={settingsStyles.meta}><span>{gexDte} DTE{premarketGexReference ? ` · 参考 ${premarketGexReference} ET` : ''}</span><span>自动记住显示设置</span></div>
    <fieldset className={settingsStyles.section}>
      <legend>显示方案</legend>
      <div className={settingsStyles.preset}>
        <label className={settingsStyles.row}><span>显示预设</span><select aria-label="图表显示预设" value={displayPreset} disabled={!displayPreferencesReady} onChange={event => {
          const value = event.target.value; setDisplayPreset(value); setSavedCombo(false);
          let next: Partial<Record<LegendKey,boolean>> | null = null;
          if (value === 'saved') { try { next = parseQqqChartDisplayPreferences(window.localStorage.getItem('qqq-gex:custom-display:v1')); } catch { /* Optional storage. */ } }
          else if (value !== 'custom') next = qqqChartPreset(value);
          if (next) { setHiddenLegends(next); try {window.localStorage.setItem(qqqChartDisplayStorageKey,JSON.stringify(next));} catch { /* Optional storage. */ } }
        }}><option value="custom">自定义</option><option value="simple">简洁</option><option value="structure">GEX 结构</option><option value="full">完整</option><option value="saved" disabled={!hasSavedCombo}>我的组合</option></select></label>
        <button type="button" disabled={!displayPreferencesReady} onClick={() => { try { window.localStorage.setItem('qqq-gex:custom-display:v1', JSON.stringify(hiddenLegends)); setHasSavedCombo(true); setSavedCombo(true); } catch { /* Optional storage. */ } }}>{savedCombo ? '组合已保存' : '保存组合'}</button>
      </div>
      <small className={settingsStyles.note}>KC：EMA20 · ATR10 × 2；观察区：两根确认</small>
    </fieldset>
    {displayGroups.map(group => {
      const body = <>
        {group.label === 'GEX 结构' && <label className={settingsStyles.row}>关键集中位 <select aria-label="集中位当前或历史" value={!isHidden('wall_history')?(['king','call_wall','put_wall'] as const).every(isHidden)?'history':'both':(['king','call_wall','put_wall'] as const).every(isHidden)?'none':'current'} onChange={event=>{const mode=event.target.value;setDisplayVisibility(['wall_history'],mode==='current'||mode==='none');setDisplayVisibility(['king','call_wall','put_wall'],mode==='history'||mode==='none');}}><option value="none">关闭</option><option value="current">当前</option><option value="history" disabled={stableWallHistory.length<2}>历史</option><option value="both" disabled={stableWallHistory.length<2}>当前与历史</option></select></label>}
        {group.label === '行情与观察指标' && liveStreamEnabled && <QqqLiveDisplaySetting enabled={liveStreamEnabled} hidden={isHidden('live')} ready={displayPreferencesReady} color={liveMarkerColor} toggle={() => toggleLegend('live')} />}
        {group.items.map(item => <div key={item.keys.join(':')}>
            <label data-hidden={item.keys.every(isHidden)}>
              <input type="checkbox" disabled={!displayPreferencesReady} checked={item.keys.some(key=>!isHidden(key))} onChange={event=>setDisplayVisibility(item.keys,!event.target.checked)} aria-label={`显示${item.label}`} />
              <span className={settingsStyles.name}><i style={{ background: item.color }} aria-hidden="true" />{item.label}</span>
              <small className={settingsStyles.scopeChip}>{item.value}</small>
            </label>
            {item.components.length > 1 && <details className={settingsStyles.components}>
              <summary>查看组成 · {item.components.length} 项</summary>
              <div className={settingsStyles.componentList}>{item.components.map(component => <label key={component.key} className={settingsStyles.component}>
                <input type="checkbox" disabled={!displayPreferencesReady} checked={!isHidden(component.key)} onChange={event=>setDisplayVisibility([component.key],!event.target.checked)} aria-label={`显示${component.label}`} />
                <span className={settingsStyles.componentName}><i style={{ background: component.color }} aria-hidden="true" />{component.label}</span>
                <span className={settingsStyles.componentValue}>{component.value}</span>
              </label>)}</div>
            </details>}
          </div>)}
      </>;
      return <fieldset key={group.label} className={settingsStyles.section} aria-label={group.label}><legend>{group.label}</legend>{body}</fieldset>;
    })}
  </div>;

  const previousGexRowByKey = useMemo(() => new Map(gexTableRows.map((row, index) => [row.key, gexTableRows[index + 1] ?? null])), [gexTableRows]);
  const snapshotTable = useMemo(() => showGex && showGexTable && !isHidden('gex_table') && visibleGexTableRows.length > 0 && <div style={{ display: fillHeight ? 'flex' : undefined, flex: fillHeight ? 1 : undefined, flexDirection: fillHeight ? 'column' : undefined, marginTop: 0, minHeight: fillHeight ? 0 : undefined }}>
      {showGex && !isHidden('gex_table') && visibleGexTableRows.length > 0 && <div style={{ display: fillHeight ? 'flex' : undefined, flex: fillHeight ? 1 : undefined, flexDirection: fillHeight ? 'column' : undefined, minHeight: fillHeight ? 0 : undefined, overflow: 'hidden' }}>
        <div style={{ flex: fillHeight ? 1 : undefined, maxHeight: fillHeight ? undefined : 272, minHeight: fillHeight ? 0 : undefined, overflow: 'auto' }}>
        <table aria-label="QQQ GEX 快照" className="qqq-gex-snapshot-table" style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', minWidth: 1060, width: '100%' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0 }}>
              <th style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'left' }}>{granularity === '1d' ? 'Date' : 'Date · Time ET'}</th>
              <th title="该快照时刻最后一根可用 2 分钟 K 线的收盘价" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>Spot</th>
              <th style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>Net GEX</th>
              <th title="相对上一条快照的 Net GEX 变动" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>ΔGEX</th>
              <th title="正/负 Gamma 与 Spot 相对 Gamma Flip 的距离" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>Regime · Flip</th>
              <th title="strike / 同侧 GEX" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>Call Wall</th>
              <th title="strike / 同侧 GEX" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>Put Wall</th>
              <th title="King strike / 强度" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>King</th>
              <th title="Net GEX 用 EWMA(3) 平滑；首次触发立即显示，连续同向折叠为延续，一根未确认快照保持原方向" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>对冲趋势 · 快速去抖</th>
              <th title="从该快照到下一条 GEX 快照；当前约为一根 2 分钟 K 线" style={{ background: 'rgba(8, 10, 14, .96)', borderBottom: '1px solid rgba(148,163,184,.08)', color: 'var(--text-tertiary)', fontWeight: 900, padding: '0.36rem 0.58rem', textAlign: 'right' }}>验证 · 下一快照</th>
            </tr>
          </thead>
          <QqqVirtualTableBody rows={visibleGexTableRows} columns={10} renderRow={row => <GexSnapshotRow
              key={row.key}
              row={row}
              previous={previousGexRowByKey.get(row.key) ?? null}
              structure={gexStructureByKey.get(row.key)!}
              trend={gexTrendByKey.get(row.key)!}
              validation={gexValidationByKey.get(row.key)!}
            />}/>
        </table>
        </div>
      </div>}
    </div>, [showGex, showGexTable, isHidden, visibleGexTableRows, fillHeight, granularity, previousGexRowByKey, gexStructureByKey, gexTrendByKey, gexValidationByKey]);

  if (!data.price.length && !liveStreamEnabled) return <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', margin: '0.8rem 0 0' }}>当日 2 分钟线不可用，无法绘制日内范围。</p>;
  return <div style={showGex ? { display: fillHeight ? 'flex' : undefined, flex: fillHeight ? 1 : undefined, flexDirection: fillHeight ? 'column' : undefined, marginTop: 0, minHeight: fillHeight ? 0 : undefined } : { borderTop: '1px solid var(--border-subtle)', marginTop: '0.9rem', paddingTop: '0.75rem' }}>
    <style>{`@keyframes qqqPcsLegendPulse { 0% { box-shadow: 0 0 0 rgba(255,255,255,0); opacity: .82; } 50% { box-shadow: 0 0 18px rgba(255,255,255,.16); opacity: 1; } 100% { box-shadow: 0 0 0 rgba(255,255,255,0); opacity: .82; } }.qqq-gex-snapshot-table th,.qqq-gex-snapshot-table td{border-bottom:none!important}@media(max-width:720px){.qqq-trade-map:not(.qqq-trade-map--inline){max-width:190px}.qqq-trade-map:not(.qqq-trade-map--inline) .qqq-trade-map__sources{display:none}}`}</style>
    {premarket && <div style={{ color: 'var(--accent-warning)', display: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 800, marginBottom: 6 }}>盘前 5 分钟价格 · 仅观察，不生成盘中执行分</div>}
    {showGex && <div style={{ background: 'color-mix(in srgb, var(--bg-secondary) 70%, transparent)', border: '1px solid var(--border-subtle)', borderRadius: 8, color: 'var(--text-secondary)', display: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', lineHeight: 1.6, marginBottom: 8, padding: '0.42rem 0.6rem' }}>
      <span style={{ color: '#34d399', fontWeight: 800 }}>价格</span> {liveStreamEnabled ? '实时更新' : historical ? '历史范围' : '当前图表范围'}
      <span style={{ color: 'var(--text-tertiary)' }}> · </span>
      <span style={{ color: '#f59e0b', fontWeight: 800 }}>GEX / Wall / Flip</span> {historical ? '为历史快照' : '为最近一次快照'}
      {latestGexSnapshotLabel ? <><span style={{ color: 'var(--text-tertiary)' }}> · </span>快照时间 ET {latestGexSnapshotLabel}</> : null}
      {!historical && liveStreamEnabled ? <><span style={{ color: 'var(--text-tertiary)' }}> · </span>按页面轮询刷新，不跟随每笔 tick 重算</> : null}
    </div>}
    {hasExtendedHours && !onExtendedHoursVisibleChange && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}><button onClick={toggleExtendedHours} style={{ background: showExtendedHours ? 'rgba(56,189,248,.12)' : 'transparent', border: '1px solid rgba(56,189,248,.35)', borderRadius: 4, color: '#bae6fd', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.58rem', padding: '3px 6px' }} type="button">EXT {showExtendedHours ? 'ON' : 'OFF'} · 盘前/盘后</button></div>}
    <div style={{ alignItems: 'center', color: 'var(--text-tertiary)', display: 'none', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', gap: 10, justifyContent: 'space-between', marginBottom: 6 }}>
      <span>{sessionWindow ? `${sessionWindow.label} · 后续时段留空` : historical ? '历史收盘范围' : '当日价格范围'}</span>
      {!isHidden('live') && liveTick && <span style={{ color: '#34d399' }}>实时 ${liveTick.price.toFixed(2)}</span>}
    </div>
    <div style={{ alignItems: 'center', display: 'none', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', gap: '4px 12px', marginBottom: 8 }}>
      {legendItems.map((item) => (
        <button
          key={item.label}
          onClick={() => toggleLegend(item.key)}
          onMouseEnter={() => setHoveredLegend(item.key)}
          onMouseLeave={() => setHoveredLegend((current) => (current === item.key ? null : current))}
          style={{
            alignItems: 'center',
            animation: hoveredLegend === item.key ? 'qqqPcsLegendPulse .9s ease-in-out infinite' : 'none',
            background: isHidden(item.key) ? 'transparent' : 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)',
            border: `1px solid ${hoveredLegend === item.key ? item.color : 'var(--border-subtle)'}`,
            borderRadius: 999,
            color: isHidden(item.key) ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'inline-flex',
            gap: 5,
            opacity: isHidden(item.key) ? .5 : 1,
            padding: '0.15rem 0.45rem',
          }}
          type="button"
        >
          <span style={{ background: item.dash ? 'transparent' : item.color, borderBottom: item.dash ? `2px dashed ${item.color}` : 'none', borderRadius: item.dash ? 0 : 999, display: 'inline-block', flex: '0 0 auto', height: item.dash ? 0 : 8, width: 12 }} />
          <span style={{ textDecoration: isHidden(item.key) ? 'line-through' : 'none' }}>{item.label}</span>
        </button>
      ))}
    </div>
    <div style={{ overflow: 'hidden', position: 'relative', flex: fillHeight ? 1 : undefined, minHeight: fillHeight ? 0 : undefined }}>
      {renderer === 'kline' && klineInput
        ? <QqqPcsKlineChartsPoc
            fillHeight={fillHeight}
            bars={klineInput.bars}
            extendedHoursBars={extendedHoursBars?.map((bar) => ({ ...bar, open: bar.open ?? bar.close, high: bar.high ?? bar.close, low: bar.low ?? bar.close }))}
            extendedHoursVisible={showExtendedHours}
            onVisibleTimeRangeChange={onVisibleTimeRangeChange}
            profileHistory={klineInput.profileHistory}
            wallHistory={stableWallHistory}
            vwap={klineInput.vwap}
            lines={klineInput.lines}
            rsi={klineInput.rsi}
            netGex={klineInput.netGex}
            gammaPosition={klineInput.gammaPosition}
            score={klineInput.score}
            markers={klineInput.markers}
            sessionShade={klineInput.sessionShade}
            kc={klineInput.kc}
            tradeBands={klineInput.tradeBands}
            liveMarker={klineInput.liveMarker}
            hiddenLegends={klineInput.hiddenLegends}
            trends={klineInput.trends}
            showGex={showGex}
            showAuxSeries={showAuxSeries}
            granularity={granularity}
          />
        : <div ref={ref} style={fillHeight ? { height: "100%" } : undefined} aria-label="QQQ 当日 2 分钟价格、VWAP 与 PCS 执行分变化图" />}
      {showGex && renderer !== 'kline' && <div aria-label="图表快捷操作" style={{position:'absolute',top:6,right:86,display:'flex',gap:2,zIndex:3,background:'rgba(8,10,14,.82)',border:'1px solid var(--border-subtle)',borderRadius:5,padding:2,fontSize:'0.58rem'}}>
        {([{action:'all',label:'全景',title:'显示全部已加载数据'}, {action:'latest',label:followLatest ? '跟随中' : '回到实时',title:'保持当前缩放，回到并跟随最新 K 线'}, {action:'price',label:'价格复位',title:'恢复价格轴自动缩放'}] as const).map(item => <button key={item.action} type="button" onClick={() => navigateChart(item.action)} title={item.title} aria-label={item.title} style={{background:'transparent',border:0,color:'var(--text-secondary)',cursor:'pointer',font:'inherit',padding:'3px 5px'}}>{item.label}</button>)}
        <button type="button" aria-label="显示完整悬停信息" aria-pressed={tooltipDetails} onClick={() => setTooltipDetails(current => {const next=!current;try {window.localStorage.setItem('qqq-pcs:gex-hover-details:v1',String(next));} catch { /* Optional preference. */ } return next;})} title="切换简洁 / 完整悬停信息，自动记住选择" style={{background:tooltipDetails?'rgba(212,177,106,.12)':'transparent',border:0,color:tooltipDetails?'var(--accent-warning)':'var(--text-secondary)',cursor:'pointer',font:'inherit',padding:'3px 5px'}}>详情</button>
      </div>}
      {isLive && intradayDelay.isStale && intradayDelay.lastBarLabel && <div style={{ backdropFilter: 'blur(8px)', background: 'rgba(120, 53, 15, 0.58)', border: '1px solid rgba(251, 191, 36, 0.32)', borderRadius: 4, color: '#fde68a', fontFamily: 'var(--font-mono)', fontSize: '0.56rem', fontWeight: 800, left: 8, padding: '0.2rem 0.36rem', pointerEvents: 'none', position: 'absolute', top: 8, whiteSpace: 'nowrap', zIndex: 5 }}>2m 延迟 · 到 {intradayDelay.lastBarLabel}{intradayDelay.minutesLate !== null ? ` · 晚 ${intradayDelay.minutesLate} 分钟` : ''}</div>}
      {structureObservationTarget === undefined ? structureObservation : structureObservationTarget ? createPortal(structureObservation, structureObservationTarget) : null}
      {restrictToPriceSession && !currentStructure && <div role="status" style={{ position: 'absolute', top: 38, left: 8, zIndex: 3, pointerEvents: 'none', color: 'var(--accent-warning)', background: 'rgba(8,10,14,.82)', borderRadius: 4, padding: '4px 6px', fontSize: '.62rem' }}>等待当日 GEX 更新 · 昨日快照未绘入主图</div>}
      <QqqCursorLayer store={hoverStore} render={renderCursor} />
      {chartLegendTarget === undefined ? chartLegend : chartLegendTarget ? createPortal(chartDisplay, chartLegendTarget) : null}

    </div>
    {snapshotTableTarget === undefined ? snapshotTable : snapshotTableTarget ? createPortal(snapshotTable, snapshotTableTarget) : null}
  </div>;
}
