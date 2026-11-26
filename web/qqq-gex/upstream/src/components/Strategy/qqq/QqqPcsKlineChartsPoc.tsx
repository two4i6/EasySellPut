'use client';
import { qqqGexPriceRangeStorageKey as QQQ_GEX_PRICE_RANGE_KEY, qqqGexTimeRangeStorageKey as QQQ_GEX_TIME_RANGE_KEY, readQqqChartRange, persistQqqChartRange } from './qqqChartDisplayPreferences';

import type { QqqGammaPositionPoint } from '@/lib/qqqGammaPosition';
import { useEffect, useMemo, useRef, useState } from 'react';

type PocBar = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
type PocProfilePoint = { strike: number; magnitude: number; isCallWall?: boolean; isPutWall?: boolean; isGammaFlip?: boolean };
type PocProfileSnapshot = PocTimed & { time: string; strikes: PocProfilePoint[] };
type PocWallSnapshot = PocTimed & { time: string; callWallPrice: number | null; putWallPrice: number | null; callWallMagnitude?: number | null; putWallMagnitude?: number | null; kingStrike?: number | null; kingMagnitude?: number | null; kingSide?: 'call' | 'put' | null };
type PocLine = { label: string; price: number; color: string; dashed?: boolean };
type PocTimed = { timeMs?: number };
export type PocProfileSegment = { fromTime: string; toTime: string; fromStrike: number; toStrike: number; magnitude: number; color: string; isCallWall?: boolean; isPutWall?: boolean; isGammaFlip?: boolean; isKing?: boolean; kingMaxAbs?: number; regularMaxAbs?: number; fromMs?: number; toMs?: number };
export type PocWallSegment = { fromTime: string; toTime: string; fromPrice: number; toPrice: number; color: string; side: 'call' | 'put'; isKing?: boolean; width?: number; fromMs?: number; toMs?: number };
type PocProfileBucket = { color: string; alpha: number; lineWidth: number; segments: readonly PocProfileSegment[] };
type PocVwapPoint = PocTimed & { time: string; value: number };
type PocSeriesPoint = PocTimed & { time: string; value: number };
type PocMarker = PocTimed & { time: string; price: number; color: string; text: string; shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square' };
type PocShadePoint = PocTimed & { time: string; shade: 'pre' | 'post' | null };
type PocKcPoint = PocTimed & { time: string; basis: number; lower: number; upper: number; connect: boolean };
type PocTradeBand = PocTimed & { time: string; lowLower: number; lowUpper: number; highLower: number; highUpper: number; activeSide: 'LOW' | 'HIGH' | null; showLow?: boolean; showHigh?: boolean };
type PocLiveMarker = PocTimed & { time: string; price: number; color: string };
type PocTrendPoint = PocTimed & { time: string; label: string };
type PocCandle = Pick<PocBar, 'open' | 'high' | 'low' | 'close'>;
type PocCrosshair = { timestamp: number; x: number; y: number; dataIndex?: number; candle?: PocCandle } | null;
type PocViewport = { visibleFrom: number; visibleTo: number; dataList: readonly any[] };
type PocModel = {
  profileHistory: readonly PocProfileSnapshot[];
  wallHistory: readonly PocWallSnapshot[];
  vwap: readonly PocVwapPoint[];
  kc: readonly PocKcPoint[];
  lines: readonly PocLine[];
  labels: readonly PocProfilePoint[];
  profileSegments: readonly PocProfileSegment[];
  profileBuckets: readonly PocProfileBucket[];
  wallSegments: readonly PocWallSegment[];
  rsi: readonly PocSeriesPoint[];
  netGex: readonly PocSeriesPoint[];
  gammaPosition: readonly (QqqGammaPositionPoint & PocTimed)[];
  score: readonly PocSeriesPoint[];
  markers: readonly PocMarker[];
  sessionShade: readonly PocShadePoint[];
  tradeBands: readonly PocTradeBand[];
  liveMarker: PocLiveMarker | null;
  hiddenLegends: readonly string[];
  trends: readonly PocTrendPoint[];
  rsiByTime: ReadonlyMap<number, number>;
  netGexByTime: ReadonlyMap<number, number>;
  scoreByTime: ReadonlyMap<number, number>;
  crosshair: PocCrosshair;
};

const POC_INDICATOR_NAME = 'QQQ_GEX_RENDERER_POC';
const POC_RSI_INDICATOR_NAME = 'QQQ_RSI_RENDERER_POC';
const POC_GEX_INDICATOR_NAME = 'QQQ_NET_GEX_RENDERER_POC';
const POC_GAMMA_POSITION_NAME = 'QQQ_GAMMA_POSITION_POC';
const POC_SCORE_INDICATOR_NAME = 'QQQ_SCORE_RENDERER_POC';
const NET_GEX_MILLION = 1_000_000;
const QQQ_GEX_KLINE_BAR_SPACE_KEY = 'qqq-pcs:gex-kline-bar-space:v1';
let pocIndicatorRegistered = false;
const pocSubModels = new Map<string, PocModel>();
const pocViewportCache = new WeakMap<object, PocViewport>();
let pocBenchmarkContainer: HTMLElement | null = null;
const pocBenchmarkDrawStats: Record<string, { count: number; total: number; max: number }> = {};
let pocBenchmarkDrawCount = 0;

export function pocSubIndicatorLegendKey(name: string) {
  return name === POC_GEX_INDICATOR_NAME ? 'net_gex' : name === POC_RSI_INDICATOR_NAME ? 'rsi' : 'score';
}

function pocPerfStart() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function pocPerfEnd(kind: string, startedAt: number) {
  if (typeof window === 'undefined' || !window.location.pathname.endsWith('/benchmark')) return;
  const elapsed = Math.max(0, pocPerfStart() - startedAt);
  const state = (window as typeof window & { __qqqKlinePerf?: Record<string, { count: number; total: number; max: number }> }).__qqqKlinePerf;
  if (state) {
    const current = state[kind] ?? { count: 0, total: 0, max: 0 };
    current.count += 1;
    current.total += elapsed;
    current.max = Math.max(current.max, elapsed);
    state[kind] = current;
  }
  const drawStats = pocBenchmarkDrawStats[kind] ?? { count: 0, total: 0, max: 0 };
  drawStats.count += 1;
  drawStats.total += elapsed;
  drawStats.max = Math.max(drawStats.max, elapsed);
  pocBenchmarkDrawStats[kind] = drawStats;
  pocBenchmarkDrawCount += 1;
  if (pocBenchmarkContainer && pocBenchmarkDrawCount % 30 === 0) pocBenchmarkContainer.dataset.drawStats = JSON.stringify(pocBenchmarkDrawStats);
}

function chartTime(value: string) {
  const cached = chartTimeCache.get(value);
  if (cached !== undefined) return cached;
  const timestamp = Date.parse(value);
  const result = Number.isFinite(timestamp) ? timestamp : NaN;
  chartTimeCache.set(value, result);
  return result;
}

const chartTimeCache = new Map<string, number>();

function normalizeChartTimestamp(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

/** KLineCharts 的原生 wheel scale 对不同鼠标/触控板 delta 差异过于敏感，统一成温和的 4% 步进。 */
export function pocWheelZoomFactor(deltaY: number, deltaMode = 0) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const modeMultiplier = deltaMode === 1 ? 32 : deltaMode === 2 ? 120 : 1;
  const steps = Math.max(-4, Math.min(4, (deltaY * modeMultiplier) / 100));
  return Math.pow(1.04, -steps);
}

export function netGexInMillions(value: number) {
  return Number.isFinite(value) ? value / NET_GEX_MILLION : NaN;
}

function storedRange(key: string) {
  const range = readQqqChartRange(key);
  return range && range.from < range.to ? range : null;
}

function persistRange(key: string, range: {from:number;to:number}) {
  if (range.from < range.to) persistQqqChartRange(key, range);
}

function compactGex(value: number) {
  return `${value < 0 ? '-' : ''}$${pocNumberFormatter.format(Math.abs(value))}`;
}

function timeMs(value: PocTimed & { time: string }) {
  return value.timeMs ?? chartTime(value.time);
}

function lowerBound<T>(values: readonly T[], target: number, getTime: (value: T) => number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getTime(values[middle]!) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound<T>(values: readonly T[], target: number, getTime: (value: T) => number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getTime(values[middle]!) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function visibleBounds<T>(values: readonly T[], from: number, to: number, getTime: (value: T) => number, padding = 0): [number, number] {
  if (!values.length || !Number.isFinite(from) || !Number.isFinite(to)) return [0, values.length];
  const start = Math.max(0, lowerBound(values, from, getTime) - padding);
  const end = Math.min(values.length, upperBound(values, to, getTime) + padding);
  return [start, end];
}

function getPocViewport(chart: any): PocViewport {
  const cached = pocViewportCache.get(chart);
  if (cached) return cached;
  const range = chart.getVisibleRange();
  const dataList = chart.getDataList();
  const fromIndex = Math.max(0, Math.floor(range.from));
  const toIndex = Math.min(dataList.length - 1, Math.ceil(range.to));
  const viewport = {
    visibleFrom: dataList[fromIndex]?.timestamp ?? -Infinity,
    visibleTo: dataList[toIndex]?.timestamp ?? Infinity,
    dataList,
  };
  pocViewportCache.set(chart, viewport);
  return viewport;
}

function latestAtOrBefore<T>(values: readonly T[], timestamp: number, getTime: (value: T) => number) {
  const end = upperBound(values, timestamp, getTime);
  return end > 0 ? values[end - 1] : null;
}

function nearestByTime<T>(values: readonly T[], timestamp: number, getTime: (value: T) => number) {
  const insertion = lowerBound(values, timestamp, getTime);
  const before = insertion > 0 ? values[insertion - 1] : null;
  const after = insertion < values.length ? values[insertion] : null;
  if (!before) return after;
  if (!after) return before;
  return Math.abs(getTime(before) - timestamp) <= Math.abs(getTime(after) - timestamp) ? before : after;
}

function tryIncrementalKlineUpdate(chart: any, bars: readonly PocBar[]) {
  const updateData = chart && typeof chart.updateData === 'function' ? chart.updateData.bind(chart) : null;
  if (!updateData || !bars.length) return false;
  const current = typeof chart.getDataList === 'function' ? chart.getDataList() : [];
  const start = Math.max(0, current.length - 1);
  for (let index = start; index < bars.length; index += 1) {
    updateData({ ...bars[index], timestamp: Date.parse(bars[index]!.timestamp) });
  }
  return true;
}

export function sameBarTimestamps(current: readonly any[], next: readonly PocBar[]) {
  if (!current.length || next.length < current.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (Number(current[index]?.timestamp) !== Date.parse(next[index]!.timestamp)) return false;
  }
  return true;
}

export function incrementalBarStart(current: readonly any[], next: readonly PocBar[]) {
  return sameBarTimestamps(current, next) ? Math.max(0, current.length - 1) : null;
}

function toKlineBar(bar: PocBar) {
  return { ...bar, timestamp: Date.parse(bar.timestamp) };
}

function barDataSignature(bars: readonly PocBar[]) {
  let hash = 2166136261;
  for (const bar of bars) {
    const values = [
      Date.parse(bar.timestamp),
      Math.round(bar.open * 100),
      Math.round(bar.high * 100),
      Math.round(bar.low * 100),
      Math.round(bar.close * 100),
      Math.round(bar.volume),
    ];
    for (const value of values) hash = Math.imul(hash ^ (Number.isFinite(value) ? value : 0), 16777619);
  }
  return `${bars.length}:${hash >>> 0}`;
}

export function pocProfileSegmentHidden(segment: PocProfileSegment, hiddenLegends: readonly string[]) {
  if (segment.isKing) return hiddenLegends.includes('king');
  return (
    (segment.isGammaFlip && hiddenLegends.includes('gamma_flip'))
    || (segment.isCallWall && hiddenLegends.includes('call_wall'))
    || (segment.isPutWall && hiddenLegends.includes('put_wall'))
    || (!segment.isCallWall && !segment.isPutWall && !segment.isGammaFlip && !segment.isKing
      && segment.magnitude >= 0 && hiddenLegends.includes('gex_positive'))
    || (!segment.isCallWall && !segment.isPutWall && !segment.isGammaFlip && !segment.isKing
      && segment.magnitude < 0 && hiddenLegends.includes('gex_negative'))
  );
}

export function pocProfileStroke(segment: PocProfileSegment, kingMaxAbs: number, regularMaxAbs: number) {
  const maxAbs = segment.isKing ? kingMaxAbs : regularMaxAbs;
  const ratio = Math.min(1, Math.abs(segment.magnitude) / Math.max(maxAbs, 1e-9));
  return {
    color: segment.isGammaFlip ? '#67e8f9' : segment.isKing ? '#e2e8f0' : segment.color,
    alpha: segment.isKing ? 0.72 + ratio * 0.2 : 0.16 + ratio * 0.64,
    lineWidth: segment.isKing ? 2.25 : Math.max(0.75, 0.7 + ratio * 1.5),
  };
}

const pocNumberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function preparePocModel(input: Pick<PocModel, 'profileHistory' | 'wallHistory' | 'vwap' | 'lines' | 'rsi' | 'netGex' | 'score' | 'markers' | 'sessionShade' | 'tradeBands' | 'liveMarker' | 'hiddenLegends' | 'trends'> & { kc?: readonly PocKcPoint[]; gammaPosition?: readonly QqqGammaPositionPoint[] }): PocModel {
  const latest = input.profileHistory.at(-1)?.strikes ?? [];
  const profileHistory = input.profileHistory.map((snapshot) => ({ ...snapshot, timeMs: chartTime(snapshot.time) }));
  const wallHistory = input.wallHistory.map((snapshot) => ({ ...snapshot, timeMs: chartTime(snapshot.time) }));
  const kingByTime = new Map(wallHistory.map((snapshot) => [snapshot.timeMs ?? chartTime(snapshot.time), snapshot.kingStrike]));
  const profileSegments: PocProfileSegment[] = [];
  for (let index = 0; index < input.profileHistory.length - 1; index += 1) {
    const current = input.profileHistory[index]!;
    const next = input.profileHistory[index + 1]!;
    const currentKingStrike = kingByTime.get(chartTime(current.time));
    const kingMaxAbs = current.strikes.reduce((max, point) => point.strike === currentKingStrike ? Math.max(max, Math.abs(point.magnitude)) : max, 1e-9);
    const regularMaxAbs = current.strikes.reduce((max, point) => point.strike === currentKingStrike ? max : Math.max(max, Math.abs(point.magnitude)), 1e-9);
    const nextByStrike = new Map(next.strikes.map((point) => [point.strike, point]));
    for (const strike of current.strikes) {
      const nextStrike = nextByStrike.get(strike.strike);
      if (!nextStrike) continue;
      profileSegments.push({
        fromTime: current.time, toTime: next.time, fromStrike: strike.strike, toStrike: nextStrike.strike,
        color: strike.isCallWall ? '#38bdf8' : strike.isPutWall ? '#f472b6' : strike.magnitude >= 0 ? '#818cf8' : '#a78bfa',
        magnitude: strike.magnitude,
        isCallWall: strike.isCallWall,
        isPutWall: strike.isPutWall,
        isGammaFlip: strike.isGammaFlip,
        isKing: currentKingStrike === strike.strike,
        kingMaxAbs,
        regularMaxAbs,
        fromMs: chartTime(current.time), toMs: chartTime(next.time),
      });
    }
  }
  const wallSegments: PocWallSegment[] = [];
  for (let index = 0; index < input.wallHistory.length - 1; index += 1) {
    const current = input.wallHistory[index]!;
    const next = input.wallHistory[index + 1]!;
    for (const [fromPrice, toPrice, color, side] of [
      [current.callWallPrice, next.callWallPrice, '#38bdf8', 'call'],
      [current.putWallPrice, next.putWallPrice, '#f472b6', 'put'],
    ] as const) {
      if (typeof fromPrice === 'number' && typeof toPrice === 'number' && Number.isFinite(fromPrice) && Number.isFinite(toPrice)) {
        const magnitude = color === '#38bdf8' ? current.callWallMagnitude : current.putWallMagnitude;
        const isKing = current.kingStrike === fromPrice;
        wallSegments.push({ fromTime: current.time, toTime: next.time, fromPrice, toPrice, color: isKing ? '#e2e8f0' : color, side, isKing, fromMs: chartTime(current.time), toMs: chartTime(next.time), width: Math.max(isKing ? 2.25 : 1.5, typeof magnitude === 'number' && Number.isFinite(magnitude) ? Math.min(4, 1.5 + Math.log10(Math.abs(magnitude) + 1) * .35) : 2) });
      }
    }
  }
  const profileBucketMap = new Map<string, { color: string; alpha: number; lineWidth: number; segments: PocProfileSegment[] }>();
  for (const segment of profileSegments) {
    const stroke = pocProfileStroke(segment, segment.kingMaxAbs ?? 1e-9, segment.regularMaxAbs ?? 1e-9);
    const key = `${stroke.color}:${stroke.alpha.toFixed(3)}:${stroke.lineWidth.toFixed(2)}`;
    const bucket = profileBucketMap.get(key) ?? { ...stroke, segments: [] };
    bucket.segments.push(segment);
    profileBucketMap.set(key, bucket);
  }
  return {
    ...input,
    profileHistory,
    gammaPosition: (input.gammaPosition ?? []).map(p => ({ ...p, timeMs: chartTime(p.time) })),
    wallHistory,
    kc: (input.kc ?? []).map(point => ({ ...point, timeMs: chartTime(point.time) })),
    vwap: input.vwap.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    rsi: input.rsi.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    netGex: input.netGex.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    score: input.score.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    markers: input.markers.map((point) => ({ ...point, timeMs: chartTime(point.time) })).sort((left, right) => timeMs(left) - timeMs(right)),
    sessionShade: input.sessionShade.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    tradeBands: input.tradeBands.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    liveMarker: input.liveMarker ? { ...input.liveMarker, timeMs: chartTime(input.liveMarker.time) } : null,
    trends: input.trends.map((point) => ({ ...point, timeMs: chartTime(point.time) })),
    labels: latest.slice().sort((left, right) => right.strike - left.strike),
    profileSegments,
    profileBuckets: [...profileBucketMap.values()],
    wallSegments,
    rsiByTime: new Map(input.rsi.map((point) => [chartTime(point.time), point.value])),
    netGexByTime: new Map(input.netGex.map((point) => [chartTime(point.time), point.value])),
    scoreByTime: new Map(input.score.map((point) => [chartTime(point.time), point.value])),
    crosshair: null,
  };
}

function registerPocIndicator(registerIndicator: (indicator: any) => void) {
  if (pocIndicatorRegistered) return;
  registerIndicator({
    name: POC_INDICATOR_NAME,
    shortName: 'QQQ GEX',
    series: 'price',
    shouldOhlc: true,
    shouldFormatBigNumber: false,
    // A row per candle keeps the indicator in the price-pane render pass;
    // the actual overlay model lives in extendData and is not recalculated.
    calc: (dataList: unknown[]) => dataList.map(() => ({})),
    figures: [],
    draw: ({ ctx, chart, indicator, xAxis, yAxis }: any) => {
      const perfStart = pocPerfStart();
      const model = indicator.extendData as PocModel | null;
      if (!model) { pocPerfEnd('price', perfStart); return false; }
      const canvasWidth = ctx.canvas.clientWidth || ctx.canvas.width;
      let visibleFrom = -Infinity;
      let visibleTo = Infinity;
      try {
        const viewport = getPocViewport(chart);
        visibleFrom = viewport.visibleFrom;
        visibleTo = viewport.visibleTo;
      } catch {
        // Keep the full model as a safe fallback during the first layout pass.
      }
      const isVisible = (from: number, to: number) => {
        return to >= visibleFrom && from <= visibleTo;
      };
      const convertX = (timestamp: number) => xAxis.convertTimestampToPixel(timestamp);
      const convertY = (price: number | null | undefined) => typeof price === 'number' && Number.isFinite(price) ? yAxis.convertToPixel(price) : NaN;
      ctx.save();

      if (!model.hiddenLegends.includes('trade_low') || !model.hiddenLegends.includes('trade_high')) {
        const [bandFrom, bandTo] = visibleBounds(model.tradeBands, visibleFrom, visibleTo, (point) => timeMs(point), 1);
        for (let index = bandFrom; index < bandTo - 1; index += 1) {
          const current = model.tradeBands[index]!; const next = model.tradeBands[index + 1]!;
          const currentMs = timeMs(current); const nextMs = timeMs(next);
          const x1 = convertX(currentMs); const x2 = convertX(nextMs);
          if (!Number.isFinite(x1) || !Number.isFinite(x2) || !isVisible(currentMs, nextMs) || nextMs-currentMs>300000) continue;
          const drawBand = (lower: number, upper: number, color: string, enabled: boolean) => {
            if (!enabled || !Number.isFinite(lower) || !Number.isFinite(upper)) return;
            const y1 = convertY(upper); const y2 = convertY(lower);
            if (!Number.isFinite(y1) || !Number.isFinite(y2)) return;
            ctx.fillStyle = color; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) + 1, Math.abs(y2 - y1));
          };
          drawBand(current.lowLower, current.lowUpper, 'rgba(34,201,151,.10)', !model.hiddenLegends.includes('trade_low') && current.showLow !== false);
          drawBand(current.highLower, current.highUpper, 'rgba(251,113,133,.10)', !model.hiddenLegends.includes('trade_high') && current.showHigh !== false);
        }
      }

      // Session 背景直接画在价格 pane 的 canvas 上，拖拽时由 KLineCharts 自己重绘。
      if (!model.hiddenLegends.includes('session_shade')) {
        const [shadeFrom, shadeTo] = visibleBounds(model.sessionShade, visibleFrom, visibleTo, (point) => timeMs(point), 1);
        for (let index = shadeFrom; index < shadeTo - 1; index += 1) {
          const current = model.sessionShade[index]!;
          const next = model.sessionShade[index + 1]!;
          const currentMs = timeMs(current); const nextMs = timeMs(next);
          if (!current.shade || !isVisible(currentMs, nextMs)) continue;
          const startX = convertX(currentMs);
          const endX = convertX(nextMs);
          if (!Number.isFinite(startX) || !Number.isFinite(endX)) continue;
          ctx.fillStyle = current.shade === 'pre' ? 'rgba(56,189,248,.07)' : 'rgba(167,139,250,.07)';
          ctx.fillRect(Math.min(startX, endX), 0, Math.abs(endX - startX) + 1, ctx.canvas.height);
        }
      }

      // Ribbon: precomputed tracks, with visible-range strength normalization.
      // The expensive topology work happens in prepareModel; a drag only maps
      // the already visible segments to pixels.
      for (const bucket of model.profileBuckets) {
        const [profileFrom, profileTo] = visibleBounds(bucket.segments, visibleFrom, visibleTo, (segment) => segment.fromMs ?? chartTime(segment.fromTime), 1);
        ctx.globalAlpha = bucket.alpha;
        ctx.lineWidth = bucket.lineWidth;
        ctx.strokeStyle = bucket.color;
        ctx.beginPath();
        let hasPath = false;
        for (let index = profileFrom; index < profileTo; index += 1) {
          const segment = bucket.segments[index]!;
          if (pocProfileSegmentHidden(segment, model.hiddenLegends)) continue;
          const startX = convertX(segment.fromMs ?? chartTime(segment.fromTime));
          const endX = convertX(segment.toMs ?? chartTime(segment.toTime));
          if (!Number.isFinite(startX) || !Number.isFinite(endX)) continue;
          const startY = convertY(segment.fromStrike);
          const endY = convertY(segment.toStrike);
          if (!Number.isFinite(startY) || !Number.isFinite(endY)) continue;
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          hasPath = true;
        }
        if (hasPath) ctx.stroke();
      }

      // VWAP and key levels share the same native canvas, keeping coordinate sync exact.
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      const drawLine = (points: readonly PocVwapPoint[], color: string) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        let started = false;
        const [pointFrom, pointTo] = visibleBounds(points, visibleFrom, visibleTo, (point) => timeMs(point), 1);
        for (let index = pointFrom; index < pointTo; index += 1) {
          const point = points[index]!;
          const x = convertX(timeMs(point));
          const y = convertY(point.value);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      };
      if (!model.hiddenLegends.includes('vwap')) drawLine(model.vwap, '#fbbf24');
      if (!model.hiddenLegends.includes('kc')) {
        for (const field of ['upper', 'lower', 'basis'] as const) {
          ctx.strokeStyle = field === 'basis' ? '#d4b16a' : '#a5b4fc';
          ctx.setLineDash(field === 'basis' ? [4, 3] : []); ctx.beginPath(); let started = false;
          const [from, to] = visibleBounds(model.kc, visibleFrom, visibleTo, point => timeMs(point), 1);
          for (let i = from; i < to; i++) { const point = model.kc[i]!; const x = convertX(timeMs(point)), y = convertY(point[field]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
            if (!started || !point.connect) ctx.moveTo(x, y); else ctx.lineTo(x, y); started = true;
          }
          ctx.stroke();
        }
      }

      for (const line of model.lines) {
        const y = convertY(line.price);
        if (!Number.isFinite(y)) continue;
        ctx.strokeStyle = line.color;
        ctx.setLineDash(line.dashed ? [4, 3] : [2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '800 9px monospace';
        ctx.fillStyle = line.color;
        ctx.fillText(`${line.label} ${line.price.toFixed(2)}`, Math.max(4, canvasWidth - 118), Math.max(12, y - 4));
      }

      // Wall history is a stepped path; only the canvas is touched while dragging.
      ctx.globalAlpha = 0.86;
      const [wallFrom, wallTo] = visibleBounds(model.wallSegments, visibleFrom, visibleTo, (segment) => segment.fromMs ?? chartTime(segment.fromTime), 1);
      for (let index = wallFrom; index < wallTo; index += 1) {
        const segment = model.wallSegments[index]!;
        if (model.hiddenLegends.includes('wall_history') || (segment.isKing ? model.hiddenLegends.includes('king') : model.hiddenLegends.includes(segment.side === 'call' ? 'call_wall' : 'put_wall'))) continue;
        ctx.strokeStyle = segment.color;
        ctx.lineWidth = segment.width ?? 2;
        ctx.setLineDash([]);
        const startX = convertX(segment.fromMs ?? chartTime(segment.fromTime));
        const endX = convertX(segment.toMs ?? chartTime(segment.toTime));
        const startY = convertY(segment.fromPrice);
        const endY = convertY(segment.toPrice);
        if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(startY) || !Number.isFinite(endY)) continue;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      const latestTime = model.profileHistory.at(-1)?.time ?? model.wallHistory.at(-1)?.time;
      const labelX = latestTime ? convertX(chartTime(latestTime)) + 8 : 8;
      ctx.font = '800 8px monospace';
      ctx.setLineDash([]);
      const kingStrike = model.lines.find((line) => line.label === 'King')?.price ?? null;
      const occupiedLabels: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      for (const strike of model.labels) {
        const y = convertY(strike.strike);
        if (!Number.isFinite(y)) continue;
        const isKing = kingStrike !== null && strike.strike === kingStrike;
        if (strike.isGammaFlip && model.hiddenLegends.includes('gamma_flip')) continue;
        if (isKing && model.hiddenLegends.includes('king')) continue;
        if (!isKing && strike.isCallWall && model.hiddenLegends.includes('call_wall')) continue;
        if (!isKing && strike.isPutWall && model.hiddenLegends.includes('put_wall')) continue;
        if (!strike.isCallWall && !strike.isPutWall && !strike.isGammaFlip && !isKing
          && strike.magnitude >= 0 && model.hiddenLegends.includes('gex_positive')) continue;
        if (!strike.isCallWall && !strike.isPutWall && !strike.isGammaFlip && !isKing
          && strike.magnitude < 0 && model.hiddenLegends.includes('gex_negative')) continue;
        const color = strike.isGammaFlip ? '#67e8f9' : isKing ? '#e2e8f0' : strike.isCallWall ? '#38bdf8' : strike.isPutWall ? '#f472b6' : strike.magnitude >= 0 ? '#818cf8' : '#a78bfa';
        const label = `${strike.isGammaFlip ? 'GF' : isKing ? 'King' : strike.isCallWall ? 'Call' : strike.isPutWall ? 'Put' : ''} ${strike.strike.toFixed(2)} ${compactGex(strike.magnitude)}`.trim();
        const width = ctx.measureText(label).width + 8;
        const left = Math.min(Math.max(4, labelX), Math.max(4, canvasWidth - width - 4));
        let labelY = y;
        let attempts = 0;
        while (attempts < 32 && occupiedLabels.some((box) => left < box.right && left + width > box.left && labelY + 8 >= box.top && labelY - 8 <= box.bottom)) {
          labelY += labelY >= y ? 16 : -16;
          attempts += 1;
        }
        labelY = Math.max(10, Math.min(ctx.canvas.height - 10, labelY));
        occupiedLabels.push({ left, right: left + width, top: labelY - 8, bottom: labelY + 8 });
        ctx.fillStyle = 'rgba(6,8,12,.84)';
        ctx.fillRect(left, labelY - 8, width, 15);
        ctx.strokeStyle = `${color}88`;
        ctx.strokeRect(left, labelY - 8, width, 15);
        ctx.fillStyle = color;
        ctx.fillText(label, left + 4, labelY + 3);
      }
      if (!model.hiddenLegends.includes('markers')) {
        const [markerFrom, markerTo] = visibleBounds(model.markers, visibleFrom, visibleTo, (marker) => timeMs(marker), 2);
        for (let index = markerFrom; index < markerTo; index += 1) {
          const marker = model.markers[index]!;
          const x = convertX(timeMs(marker));
          const y = convertY(marker.price);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < -80 || x > canvasWidth + 80) continue;
          const direction = marker.shape === 'arrowDown' ? -1 : 1;
          let labelY = y - direction * 18;
          ctx.font = '800 8px monospace';
          const width = ctx.measureText(marker.text).width + 8;
          const left = Math.max(4, Math.min(canvasWidth - width - 4, x - width / 2));
          let attempts = 0;
          while (attempts < 32 && occupiedLabels.some((box) => left < box.right && left + width > box.left && labelY + 8 >= box.top && labelY - 8 <= box.bottom)) {
            labelY -= direction * 16;
            attempts += 1;
          }
          labelY = Math.max(10, Math.min(ctx.canvas.height - 10, labelY));
          occupiedLabels.push({ left, right: left + width, top: labelY - 8, bottom: labelY + 8 });
          ctx.strokeStyle = marker.color;
          ctx.fillStyle = marker.color;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, labelY + direction * 7);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(6,8,12,.84)';
          ctx.fillRect(left, labelY - 8, width, 15);
          ctx.fillStyle = marker.color;
          ctx.fillText(marker.text, left + 4, labelY + 3);
        }
      }
      if (model.liveMarker && !model.hiddenLegends.includes('live')) {
        const y = convertY(model.liveMarker.price);
        if (Number.isFinite(y)) {
          ctx.strokeStyle = model.liveMarker.color;
          ctx.globalAlpha = .72;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (model.crosshair && Number.isFinite(model.crosshair.x)) {
        ctx.globalAlpha = .95;
        const crosshair = model.crosshair;
        const candle = crosshair.candle;
        const point = latestAtOrBefore(model.netGex, crosshair.timestamp, (item) => timeMs(item));
        const wall = latestAtOrBefore(model.wallHistory, crosshair.timestamp, (item) => timeMs(item));
        const label = point ? `Net GEX ${compactGex(point.value)}` : 'Net GEX —';
        const trend = latestAtOrBefore(model.trends, crosshair.timestamp, (item) => timeMs(item));
        const rsi = latestAtOrBefore(model.rsi, crosshair.timestamp, (item) => timeMs(item));
        const score = latestAtOrBefore(model.score, crosshair.timestamp, (item) => timeMs(item));
        const profile = latestAtOrBefore(model.profileHistory, crosshair.timestamp, (item) => timeMs(item));
        const gammaFlip = profile?.strikes.find((strike) => strike.isGammaFlip)?.strike ?? model.lines.find((line) => line.label === 'GF')?.price ?? null;
        const nearestEvent = nearestByTime(model.markers, crosshair.timestamp, (marker) => timeMs(marker));
        const event = nearestEvent && Math.abs(timeMs(nearestEvent) - crosshair.timestamp) <= 120_000 ? nearestEvent : null;
        const wallLabel = wall
          ? `Call ${wall.callWallPrice?.toFixed(2) ?? '—'} ${wall.callWallMagnitude === null || wall.callWallMagnitude === undefined ? '' : compactGex(wall.callWallMagnitude)} · Put ${wall.putWallPrice?.toFixed(2) ?? '—'} ${wall.putWallMagnitude === null || wall.putWallMagnitude === undefined ? '' : compactGex(wall.putWallMagnitude)} · King ${wall.kingStrike?.toFixed(2) ?? '—'}${wall.kingMagnitude === null || wall.kingMagnitude === undefined ? '' : ` ${compactGex(wall.kingMagnitude)}`}`
          : 'Wall —';
        const trendLabel = trend ? `Trend ${trend.label}` : 'Trend —';
        const indicatorLabel = `RSI ${rsi?.value.toFixed(1) ?? '—'} Score ${score?.value.toFixed(2) ?? '—'} GF ${gammaFlip?.toFixed(2) ?? '—'}`;
        const eventLabel = event ? `Event ${event.text}` : 'Event —';
        ctx.font = '800 9px monospace';
        const text = `${candle ? `O ${Number(candle.open).toFixed(2)} H ${Number(candle.high).toFixed(2)} L ${Number(candle.low).toFixed(2)} C ${Number(candle.close).toFixed(2)}` : 'OHLC —'} · ${label} · ${wallLabel} · ${indicatorLabel} · ${trendLabel} · ${eventLabel}`;
        const width = Math.min(canvasWidth - 8, ctx.measureText(text).width + 10);
        const left = Math.max(4, Math.min(canvasWidth - width - 4, crosshair.x + 8));
        ctx.fillStyle = 'rgba(6,8,12,.9)'; ctx.fillRect(left, 5, width, 18);
        ctx.fillStyle = '#e2e8f0'; ctx.fillText(text.slice(0, 180), left + 5, 17);
      }
      ctx.restore();
      pocPerfEnd('price', perfStart);
      return true;
    },
  });
  const registerSubIndicator = (name: string, color: string, title: string, min: number | null = null, max: number | null = null) => registerIndicator({
      name, shortName: title, series: 'line', calc: (dataList: any[]) => {
      const model = pocSubModels.get(name);
      const key = name === POC_RSI_INDICATOR_NAME ? 'rsi' : name === POC_GEX_INDICATOR_NAME ? 'netGex' : 'score';
      const legendKey = pocSubIndicatorLegendKey(name);
      if (!model || model.hiddenLegends.includes(legendKey)) return dataList.map(() => ({ value: null }));
      const points = model?.[key] as readonly PocSeriesPoint[] | undefined;
      const byTime = name === POC_RSI_INDICATOR_NAME ? model.rsiByTime : name === POC_GEX_INDICATOR_NAME ? model.netGexByTime : model.scoreByTime;
      return dataList.map((item) => {
        const timestamp = normalizeChartTimestamp(item.timestamp);
        const exact = byTime.get(timestamp);
        const fallback = points ? latestAtOrBefore(points, timestamp, (point) => timeMs(point))?.value ?? null : null;
        const value = exact ?? fallback;
        return { value: name === POC_GEX_INDICATOR_NAME && typeof value === 'number' ? netGexInMillions(value) : value };
      });
    },
    figures: [{ key: 'value', title: `${title}${name === POC_GEX_INDICATOR_NAME ? ' (M)' : ''}: `, type: 'line', color }],
    minValue: min,
    maxValue: max,
    draw: ({ ctx, chart, indicator, xAxis, yAxis }: any) => {
      const perfStart = pocPerfStart();
      const model = indicator.extendData as PocModel | null; if (!model) { pocPerfEnd(name === POC_RSI_INDICATOR_NAME ? 'rsi' : name === POC_GEX_INDICATOR_NAME ? 'netGex' : 'score', perfStart); return false; }
      const key = name === POC_RSI_INDICATOR_NAME ? 'rsi' : name === POC_GEX_INDICATOR_NAME ? 'netGex' : 'score';
      const legendKey = pocSubIndicatorLegendKey(name);
      if (model.hiddenLegends.includes(legendKey)) { pocPerfEnd(key, perfStart); return true; }
      const points = model[key] as readonly PocSeriesPoint[];
      const viewport = getPocViewport(chart);
      const from = viewport.visibleFrom;
      const to = viewport.visibleTo;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); let started = false;
      const [pointFrom, pointTo] = visibleBounds(points, Number(from), Number(to), (point) => timeMs(point), 1);
      for (let index = pointFrom; index < pointTo; index += 1) { const point = points[index]!; const t = timeMs(point); const x = xAxis.convertTimestampToPixel(t); const y = yAxis.convertToPixel(name === POC_GEX_INDICATOR_NAME ? netGexInMillions(point.value) : point.value); if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      if (started) ctx.stroke();
      if (min !== null && max !== null) { for (const value of [min, max]) { const y = yAxis.convertToPixel(value); if (!Number.isFinite(y)) continue; ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(ctx.canvas.width,y); ctx.stroke(); ctx.setLineDash([]); } }
      ctx.restore(); pocPerfEnd(key, perfStart); return true;
    },
  });
  registerSubIndicator(POC_RSI_INDICATOR_NAME, '#fbbf24', 'RSI14', 30, 70);
  registerSubIndicator(POC_GEX_INDICATOR_NAME, '#f472b6', 'Net GEX');
  registerSubIndicator(POC_SCORE_INDICATOR_NAME, '#a78bfa', 'Score');
  registerIndicator({
    name: POC_GAMMA_POSITION_NAME, shortName: 'Gamma 位置 (%)', series: 'line', precision: 2,
    calc: (bars: any[]) => {
      const model = pocSubModels.get(POC_GAMMA_POSITION_NAME);
      const byTime = new Map(model?.gammaPosition.map(p => [timeMs(p), p]) ?? []);
      return bars.map(bar => {
        const point = byTime.get(normalizeChartTimestamp(bar.timestamp));
        return { zeroGamma: point?.zeroGamma ?? null, volatilityTrigger: point?.volatilityTrigger ?? null, baseline: 0 };
      });
    },
    figures: [
      { key: 'zeroGamma', title: '零交点: ', type: 'line', styles: () => ({ color: '#b7a5ef' }) },
      { key: 'volatilityTrigger', title: 'VT 下沿: ', type: 'line', styles: () => ({ color: '#a5d66f' }) },
      { key: 'baseline', title: '', type: 'line', styles: () => ({ color: 'rgba(226,232,240,.4)' }) },
    ],
    minValue: -.05, maxValue: .05,
    draw: ({ ctx, indicator, xAxis, yAxis }: any) => {
      const model = indicator.extendData as PocModel | null;
      if (!model) return false;
      ctx.save();
      const zero = yAxis.convertToPixel(0);
      ctx.strokeStyle = 'rgba(226,232,240,.45)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(ctx.canvas.width, zero); ctx.stroke(); ctx.setLineDash([]);
      for (const [key, color] of [['zeroGamma','#b7a5ef'],['volatilityTrigger','#a5d66f']] as const) {
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
        ctx.beginPath(); let started = false;
        for (const point of model.gammaPosition) {
          const value = point[key];
          if (value === null) { started = false; continue; }
          const x = xAxis.convertTimestampToPixel(timeMs(point)), y = yAxis.convertToPixel(value);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
          if (!started) ctx.moveTo(x,y); else ctx.lineTo(x,y);
          started = true;
        }
        ctx.stroke();
        // Capture start may yield only one point; it should still be visible.
        for (const point of model.gammaPosition) {
          if (point[key] === null) continue;
          const x = xAxis.convertTimestampToPixel(timeMs(point)), y = yAxis.convertToPixel(point[key]);
          if (Number.isFinite(x) && Number.isFinite(y)) { ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); }
        }
      }
      ctx.font = '11px monospace';
      ctx.fillStyle = '#b7a5ef'; ctx.fillText('零交点', 8, 16);
      ctx.fillStyle = '#a5d66f'; ctx.fillText('VT 下沿', 68, 16);
      ctx.fillStyle = '#94a3b8'; ctx.fillText('上方 + / 下方 −', 145, 16);
      ctx.restore(); return true;
    },
  });
  pocIndicatorRegistered = true;
}

export default function QqqPcsKlineChartsPoc({ bars, extendedHoursBars, extendedHoursVisible = false, onVisibleTimeRangeChange, profileHistory, wallHistory, kc = [], vwap = [], lines = [], rsi = [], netGex = [], gammaPosition = [], score = [], markers = [], sessionShade = [], tradeBands = [], liveMarker = null, hiddenLegends = [], trends = [], onCrosshair, showGex = true, showAuxSeries = true, fillHeight = false, granularity = '2m' }: { bars: readonly PocBar[]; extendedHoursBars?: readonly PocBar[]; extendedHoursVisible?: boolean; onVisibleTimeRangeChange?: (range: { from: number; to: number }) => void; profileHistory: readonly PocProfileSnapshot[]; wallHistory: readonly PocWallSnapshot[]; kc?: readonly PocKcPoint[]; vwap?: readonly PocVwapPoint[]; lines?: readonly PocLine[]; rsi?: readonly PocSeriesPoint[]; netGex?: readonly PocSeriesPoint[]; gammaPosition?: readonly QqqGammaPositionPoint[]; score?: readonly PocSeriesPoint[]; markers?: readonly PocMarker[]; sessionShade?: readonly PocShadePoint[]; tradeBands?: readonly PocTradeBand[]; liveMarker?: PocLiveMarker | null; hiddenLegends?: readonly string[]; trends?: readonly PocTrendPoint[]; onCrosshair?: (timestamp: number) => void; showGex?: boolean; showAuxSeries?: boolean; fillHeight?: boolean; granularity?: '2m' | '5m' | '1d' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const gammaPaneRef = useRef<string | null>(null);
  const [readyVersion, setReadyVersion] = useState(0);
  const priceRangeRef = useRef<any>(null);
  const displayBars = useMemo(() => extendedHoursVisible && extendedHoursBars && extendedHoursBars.length > bars.length ? extendedHoursBars : bars, [bars, extendedHoursBars, extendedHoursVisible]);
  const model = useMemo(() => preparePocModel({ profileHistory, wallHistory, kc, vwap, lines, rsi, netGex, gammaPosition, score, markers, sessionShade, tradeBands, liveMarker, hiddenLegends, trends }), [gammaPosition, hiddenLegends, lines, liveMarker, markers, netGex, profileHistory, rsi, score, sessionShade, tradeBands, trends, vwap, wallHistory, kc]);
  pocSubModels.set(POC_RSI_INDICATOR_NAME, model);
  pocSubModels.set(POC_GEX_INDICATOR_NAME, model);
  pocSubModels.set(POC_SCORE_INDICATOR_NAME, model);
  pocSubModels.set(POC_GAMMA_POSITION_NAME, model);
  const barsSignature = useMemo(() => barDataSignature(displayBars), [displayBars]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const crosshairRef = useRef<PocCrosshair>(null);
  const visibleRangeCallbackRef = useRef(onVisibleTimeRangeChange);
  visibleRangeCallbackRef.current = onVisibleTimeRangeChange;
  const crosshairCallbackRef = useRef(onCrosshair);
  crosshairCallbackRef.current = onCrosshair;
  const barsRef = useRef(displayBars);
  barsRef.current = displayBars;
  const barSubscriptionRef = useRef<((bar: any) => void) | null>(null);
  const showRsiPane = showAuxSeries && granularity !== '1d' && !hiddenLegends.includes('rsi');
  const showGammaPane = showGex && granularity === '2m' && !hiddenLegends.includes('gamma_position');
  const showGexPane = showGex && !hiddenLegends.includes('net_gex');
  const showScorePane = showAuxSeries && granularity !== '1d' && !hiddenLegends.includes('score');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import('klinecharts').then(({ dispose, init, registerIndicator }) => {
      if (cancelled) return;
      registerPocIndicator(registerIndicator);
      const chart = init(container, { locale: 'zh-CN', styles: 'dark', zoomAnchor: 'cursor' });
      if (!chart) return;
      const isBenchmark = typeof window !== 'undefined' && window.location.pathname.endsWith('/benchmark');
      if (isBenchmark) {
        pocBenchmarkContainer = container;
        for (const key of Object.keys(pocBenchmarkDrawStats)) delete pocBenchmarkDrawStats[key];
        pocBenchmarkDrawCount = 0;
        container.dataset.klineReady = 'true';
        container.dataset.netGexUnit = 'M';
        container.dataset.crosshairEvents = '0';
        container.dataset.lastUpdateMode = 'initial';
        (window as typeof window & { __qqqKlinePerf?: Record<string, unknown>; __qqqKlineChart?: any }).__qqqKlinePerf = {};
        (window as typeof window & { __qqqKlinePerf?: Record<string, unknown>; __qqqKlineChart?: any }).__qqqKlineChart = chart;
      }
      chart.setSymbol({ ticker: 'QQQ-GEX-POC', pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod({ span: 1, type: 'minute' });
      chart.setDataLoader({
        getBars: ({ callback }) => callback(barsRef.current.map(toKlineBar), false),
        // KLineCharts calls this callback through its internal _addData path.
        // That path replaces/appends only the last candle and recalculates
        // indicators without tearing down the time/price range.
        subscribeBar: ({ callback }) => {
          barSubscriptionRef.current = callback;
        },
        unsubscribeBar: () => {
          barSubscriptionRef.current = null;
        },
      });
      // Explicitly reuse the candle pane's y-axis; a separate indicator axis
      // would normalize 685 to an unrelated 0-1 range and hide price overlays.
      const persistedPriceRange = storedRange(QQQ_GEX_PRICE_RANGE_KEY);
      if (persistedPriceRange) priceRangeRef.current = persistedPriceRange;
      const priceAxis = chart.getYAxes({ paneId: 'candle_pane' })[0];
      priceAxis?.override({ createRange: ({ defaultRange }: any) => priceRangeRef.current ? { ...defaultRange, ...priceRangeRef.current } : defaultRange });
      chart.createIndicator({ name: POC_INDICATOR_NAME, paneId: 'candle_pane', yAxisId: priceAxis?.id }, true);
      chart.overrideIndicator({ name: POC_INDICATOR_NAME, extendData: modelRef.current });
      const rsiPane = showRsiPane ? chart.createIndicator({ name: POC_RSI_INDICATOR_NAME }, true) : null;
      const gexPane = showGexPane ? chart.createIndicator({ name: POC_GEX_INDICATOR_NAME }, true) : null;
      const scorePane = showScorePane ? chart.createIndicator({ name: POC_SCORE_INDICATOR_NAME }, true) : null;
      if (rsiPane) chart.overrideIndicator({ name: POC_RSI_INDICATOR_NAME, paneId: rsiPane, extendData: modelRef.current });
      if (gexPane) chart.overrideIndicator({ name: POC_GEX_INDICATOR_NAME, paneId: gexPane, extendData: modelRef.current });
      if (scorePane) chart.overrideIndicator({ name: POC_SCORE_INDICATOR_NAME, paneId: scorePane, extendData: modelRef.current });
      chartRef.current = chart;
      gammaPaneRef.current = null;
      setReadyVersion(value => value + 1);
      const persistedTimeRange = storedRange(QQQ_GEX_TIME_RANGE_KEY);
      const persistedBarSpace = typeof window === 'undefined' ? NaN : Number(window.localStorage.getItem(QQQ_GEX_KLINE_BAR_SPACE_KEY));
      if (persistedTimeRange || Number.isFinite(persistedBarSpace)) {
        requestAnimationFrame(() => {
          if (Number.isFinite(persistedBarSpace) && persistedBarSpace > 0) chart.setBarSpace(persistedBarSpace);
          if (persistedTimeRange && persistedTimeRange.to > 1e12) chart.scrollToTimestamp(persistedTimeRange.to, 0);
          if (isBenchmark) container.dataset.barSpace = String(chart.getBarSpace()?.bar ?? '');
        });
      } else if (isBenchmark) {
        container.dataset.barSpace = String(chart.getBarSpace()?.bar ?? '');
      }
      let visibleRangeTimer: ReturnType<typeof setTimeout> | null = null;
      const invalidateViewport = () => { pocViewportCache.delete(chart); };
      const handleVisibleRangeChange = () => {
        invalidateViewport();
        const viewport = getPocViewport(chart);
        const from = viewport.visibleFrom;
        const to = viewport.visibleTo;
        if (typeof from !== 'number' || typeof to !== 'number') return;
        persistRange(QQQ_GEX_TIME_RANGE_KEY, { from, to });
        const bar = chart.getBarSpace()?.bar;
        if (typeof bar === 'number' && Number.isFinite(bar)) {
          try { window.localStorage.setItem(QQQ_GEX_KLINE_BAR_SPACE_KEY, String(bar)); } catch { /* storage may be unavailable */ }
        }
        if (isBenchmark) container.dataset.visibleRange = `${from}:${to}`;
        if (!visibleRangeCallbackRef.current) return;
        if (visibleRangeTimer !== null) clearTimeout(visibleRangeTimer);
        visibleRangeTimer = setTimeout(() => {
          visibleRangeTimer = null;
          visibleRangeCallbackRef.current?.({ from, to });
        }, 120);
      };
      chart.subscribeAction('onVisibleRangeChange', handleVisibleRangeChange);
      const capturePriceRange = () => {
        const range = chart.getYAxes({ paneId: 'candle_pane' })[0]?.getRange();
        if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.from !== range.to) {
          priceRangeRef.current = range;
          persistRange(QQQ_GEX_PRICE_RANGE_KEY, { from: range.from, to: range.to });
        }
        const bar = chart.getBarSpace()?.bar;
        if (typeof bar === 'number' && Number.isFinite(bar)) {
          try { window.localStorage.setItem(QQQ_GEX_KLINE_BAR_SPACE_KEY, String(bar)); } catch { /* storage may be unavailable */ }
        }
        if (isBenchmark) container.dataset.barSpace = String(chart.getBarSpace()?.bar ?? '');
      };
      chart.subscribeAction('onZoom', capturePriceRange);
      chart.subscribeAction('onPaneDrag', capturePriceRange);
      chart.subscribeAction('onScroll', invalidateViewport);
      chart.subscribeAction('onZoom', invalidateViewport);
      chart.subscribeAction('onPaneDrag', invalidateViewport);
      let crosshairFrame: number | null = null;
      let pendingCrosshair: PocCrosshair = null;
      const flushCrosshair = () => {
        crosshairFrame = null;
        const nextModel = { ...modelRef.current, crosshair: pendingCrosshair };
        crosshairRef.current = pendingCrosshair;
        modelRef.current = nextModel;
        if (typeof window !== 'undefined' && window.location.pathname.endsWith('/benchmark')) {
          (window as typeof window & { __qqqKlineCrosshair?: PocCrosshair }).__qqqKlineCrosshair = pendingCrosshair;
          container.dataset.crosshairTimestamp = pendingCrosshair?.timestamp ? String(pendingCrosshair.timestamp) : '';
        }
        chart.overrideIndicator({ name: POC_INDICATOR_NAME, extendData: nextModel });
      };
      const queueCrosshair = (x: number, y: number) => {
        const convertedResult: any = typeof chart.convertFromPixel === 'function'
          ? chart.convertFromPixel([{ x, y }], { paneId: 'candle_pane' })
          : null;
        const converted = Array.isArray(convertedResult) ? convertedResult[0] : convertedResult;
        const timestamp = normalizeChartTimestamp(converted?.timestamp);
        if (!Number.isFinite(timestamp)) return;
        const dataIndex = converted?.dataIndex;
        const sourceCandle = Number.isFinite(dataIndex) ? chart.getDataList()[Math.max(0, Math.round(dataIndex))] : undefined;
        const candle = sourceCandle && [sourceCandle.open, sourceCandle.high, sourceCandle.low, sourceCandle.close].every((item: unknown) => Number.isFinite(Number(item)))
          ? { open: Number(sourceCandle.open), high: Number(sourceCandle.high), low: Number(sourceCandle.low), close: Number(sourceCandle.close) }
          : undefined;
        pendingCrosshair = { timestamp, x, y, dataIndex: Number.isFinite(dataIndex) ? dataIndex : undefined, candle };
        if (crosshairFrame === null) crosshairFrame = requestAnimationFrame(() => {
          const next = pendingCrosshair;
          flushCrosshair();
          if (next) crosshairCallbackRef.current?.(next.timestamp);
        });
      };
      const handleCrosshairChange = (value?: any) => {
        if (isBenchmark) container.dataset.crosshairEvents = String(Number(container.dataset.crosshairEvents ?? 0) + 1);
        if (!value || typeof value.x !== 'number') {
          pendingCrosshair = null;
          if (crosshairFrame === null) crosshairFrame = requestAnimationFrame(flushCrosshair);
          return;
        }
        // KLineCharts 10 dispatches the original { x, y, paneId } payload for
        // onCrosshairChange; timestamp/kLineData are present in the store but
        // are not copied into the action argument. Convert once at the chart
        // boundary instead of doing a linear scan on every pointer event.
        queueCrosshair(Number(value.x), Number(value.y ?? 0));
      };
      const handlePointerMove = (event: PointerEvent) => {
        const bounds = container.getBoundingClientRect();
        queueCrosshair(event.clientX - bounds.left, event.clientY - bounds.top);
      };
      const handlePointerLeave = () => {
        pendingCrosshair = null;
        if (crosshairFrame === null) crosshairFrame = requestAnimationFrame(flushCrosshair);
      };
      const handleWheel = (event: WheelEvent) => {
        if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = container.getBoundingClientRect();
        chart.zoomAtCoordinate(pocWheelZoomFactor(event.deltaY, event.deltaMode), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }, 0);
      };
      chart.subscribeAction('onCrosshairChange', handleCrosshairChange);
      container.addEventListener('pointermove', handlePointerMove, { passive: true });
      container.addEventListener('pointerleave', handlePointerLeave, { passive: true });
      container.addEventListener('wheel', handleWheel, { capture: true, passive: false });
      const resizeObserver = new ResizeObserver(() => {
        const paneHeight = Math.max(40, Math.min(100, container.clientHeight * .18));
        for (const id of [rsiPane, gexPane, scorePane]) if (id) chart.setPaneOptions({ id, height: paneHeight, minHeight: 40 });
        chart.resize();
      });
      resizeObserver.observe(container);
      cleanup = () => { resizeObserver.disconnect(); container.removeEventListener('pointermove', handlePointerMove); container.removeEventListener('pointerleave', handlePointerLeave); container.removeEventListener('wheel', handleWheel, { capture: true }); if (visibleRangeTimer !== null) clearTimeout(visibleRangeTimer); if (crosshairFrame !== null) cancelAnimationFrame(crosshairFrame); if (isBenchmark) { if (pocBenchmarkContainer === container) pocBenchmarkContainer = null; delete container.dataset.klineReady; delete container.dataset.netGexUnit; delete container.dataset.crosshairEvents; delete container.dataset.crosshairTimestamp; delete container.dataset.visibleRange; delete container.dataset.lastUpdateMode; delete container.dataset.drawStats; delete container.dataset.barSpace; } if (typeof window !== 'undefined') { delete (window as typeof window & { __qqqKlineChart?: any }).__qqqKlineChart; delete (window as typeof window & { __qqqKlineCrosshair?: PocCrosshair }).__qqqKlineCrosshair; } chart.unsubscribeAction('onVisibleRangeChange', handleVisibleRangeChange); chart.unsubscribeAction('onZoom', capturePriceRange); chart.unsubscribeAction('onPaneDrag', capturePriceRange); chart.unsubscribeAction('onScroll', invalidateViewport); chart.unsubscribeAction('onCrosshairChange', handleCrosshairChange); pocViewportCache.delete(chart); dispose(chart); chartRef.current = null; };
    });
    return () => { cancelled = true; cleanup?.(); };
  }, [granularity, showRsiPane, showGexPane, showScorePane]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    pocViewportCache.delete(chart);
    // KLineCharts 10 has no public updateData method. Use it when a newer
    // runtime exposes one; otherwise resetData is the documented fallback.
    // The chart itself is still created once and the current range is restored.
    const currentData = typeof chart.getDataList === 'function' ? chart.getDataList() : [];
    const barCallback = barSubscriptionRef.current;
    let incrementallyUpdated = false;
    const incrementalStart = incrementalBarStart(currentData, displayBars);
    if (barCallback && incrementalStart !== null) {
      // Re-send the current tail because its OHLC can change, then append
      // any newly arrived bars. KLineCharts deduplicates equal timestamps.
      for (let index = incrementalStart; index < displayBars.length; index += 1) barCallback(toKlineBar(displayBars[index]!));
      incrementallyUpdated = true;
    }
    if (!incrementallyUpdated) incrementallyUpdated = tryIncrementalKlineUpdate(chart, displayBars);
    if (!incrementallyUpdated) {
      const visibleRange = chart.getVisibleRange();
      const targetData = currentData[Math.min(currentData.length - 1, Math.max(0, Math.ceil(visibleRange.to)))];
      const targetTimestamp = typeof targetData?.timestamp === 'number' ? targetData.timestamp : null;
      const barSpace = chart.getBarSpace()?.bar;
      chart.resetData();
      if (typeof barSpace === 'number' && Number.isFinite(barSpace)) chart.setBarSpace(barSpace);
      const targetIndex = Number.isFinite(visibleRange?.to) ? Math.round(visibleRange.to) : null;
      if (targetTimestamp !== null) requestAnimationFrame(() => chart.scrollToTimestamp(targetTimestamp, 0));
      else if (targetIndex !== null) requestAnimationFrame(() => chart.scrollToDataIndex(Math.min(displayBars.length - 1, Math.max(0, targetIndex)), 0));
    }
    if (typeof window !== 'undefined' && window.location.pathname.endsWith('/benchmark')) {
      const container = containerRef.current;
      if (container) container.dataset.lastUpdateMode = incrementallyUpdated ? 'incremental' : 'reset';
    }
    const renderModel = crosshairRef.current ? { ...model, crosshair: crosshairRef.current } : model;
    modelRef.current = renderModel;
    chart.overrideIndicator({ name: POC_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_RSI_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_GEX_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_SCORE_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_GAMMA_POSITION_NAME, extendData: renderModel });
  }, [barsSignature, displayBars, displayBars.length, model]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const renderModel = crosshairRef.current ? { ...model, crosshair: crosshairRef.current } : model;
    modelRef.current = renderModel;
    chart.overrideIndicator({ name: POC_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_RSI_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_GEX_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_SCORE_INDICATOR_NAME, extendData: renderModel });
    chart.overrideIndicator({ name: POC_GAMMA_POSITION_NAME, extendData: renderModel });
  }, [model]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (showGammaPane && !gammaPaneRef.current) {
      gammaPaneRef.current = chart.createIndicator({ name: POC_GAMMA_POSITION_NAME }, true);
    } else if (!showGammaPane && gammaPaneRef.current) {
      chart.removeIndicator({ paneId: gammaPaneRef.current, name: POC_GAMMA_POSITION_NAME });
      gammaPaneRef.current = null;
    }
    if (gammaPaneRef.current) chart.overrideIndicator({ name: POC_GAMMA_POSITION_NAME, paneId: gammaPaneRef.current, extendData: modelRef.current });
  }, [showGammaPane, readyVersion]);

  return <div ref={containerRef} aria-label="QQQ GEX KLineCharts PoC" style={{ height: fillHeight ? '100%' : 520, width: '100%' }} />;
}
