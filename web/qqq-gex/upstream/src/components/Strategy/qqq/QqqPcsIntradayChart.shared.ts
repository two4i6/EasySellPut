import type { QqqShortTermReversalObservation } from '@/lib/qqqIntradaySetup';
import type { Time } from 'lightweight-charts';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import { qqqSessionVwap } from '@/lib/qqqSessionVwap';

export type PcsIntradayChartBar = { timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number };
export type PcsIntradayScorePoint = { time: string; score: number };
export type PcsDailyGexPoint = { date: string; totalGex: number; gammaFlipLevel: number | null };
export type PcsIntradayGexPoint = { time: string; totalGex: number; gammaFlipLevel: number | null };
export type PcsGexPoint = PcsDailyGexPoint | PcsIntradayGexPoint;
export type PcsChartGranularity = '2m' | '5m' | '1d';
export const isIntradayGranularity = (granularity: PcsChartGranularity) => granularity !== '1d';
export const intradayBucketSeconds = (granularity: PcsChartGranularity) => granularity === '2m' ? 120 : 300;

type PcsNormalizedBar = { time: Time; close: number; volume: number; open?: number; high?: number; low?: number };

const chartTime = (value: string) => Math.floor(new Date(value).getTime() / 1000) as Time;
const chartTimeForGranularity = (value: string, granularity: PcsChartGranularity) => {
  const time = Number(chartTime(value));
  if (!Number.isFinite(time)) return NaN as Time;
  return (isIntradayGranularity(granularity) ? Math.floor(time / intradayBucketSeconds(granularity)) * intradayBucketSeconds(granularity) : time) as Time;
};

export function qqqPcsSessionWindow(time: Time, premarket: boolean) {
  const session = qqqMarketSession(new Date(Number(time) * 1000));
  const format = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const [start, end, name] = !session.trading ? [session.openMinute, session.stockCloseMinute, '休市']
    : premarket || session.premarket ? [240, session.openMinute, '盘前']
    : session.minute < session.stockCloseMinute ? [session.openMinute, session.stockCloseMinute, '盘中']
    : [session.stockCloseMinute, session.stockAcquisitionCloseMinute, '盘后'];
  const offset = Number(time) - Number(time) % 60 - session.minute * 60;
  return { from: (offset + start * 60) as Time, label: `${name} · ${format(start)}–${format(end)} ET`, to: (offset + end * 60) as Time };
}

/** 盘前先展示当日 04:00 起的 bars；跨日连续走势只在用户主动打开 EXT 后展示。 */
export const qqqPcsDefaultExtendedHoursVisible = (premarket: boolean) => !premarket;

export const qqqPcsSessionAnchor = (sessionWindow: { from: Time; to: Time } | null, lastRealBarTime?: Time | null, bucketSeconds = 300) => {
  if (!sessionWindow) return [];
  const from = Number(lastRealBarTime ?? sessionWindow.from);
  const to = Number(sessionWindow.to);
  const points: Array<{ time: Time; value: number }> = [];
  for (let time = from; time < to; time += bucketSeconds) points.push({ time: time as Time, value: 0 });
  points.push({ time: to as Time, value: 0 });
  return points;
};

const formatEasternTimeLabel = (time: Time) => `${new Date(Number(time) * 1000).toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  timeZone: 'America/New_York',
})} ET`;

export function qqqPcsDescribeIntradayDelay(lastBarTime?: Time | null, nowMs = Date.now()) {
  if (typeof lastBarTime !== 'number' || !Number.isFinite(lastBarTime)) {
    return { isStale: false, lastBarLabel: null, liveStreamEnabled: qqqMarketSession(new Date(nowMs)).stockAcquisitionOpen, minutesLate: null as number | null };
  }
  const delaySeconds = Math.max(0, Math.floor(nowMs / 1000 - Number(lastBarTime)));
  return {
    isStale: delaySeconds > 900,
    lastBarLabel: formatEasternTimeLabel(lastBarTime),
    liveStreamEnabled: qqqMarketSession(new Date(nowMs)).stockAcquisitionOpen,
    minutesLate: Math.floor(delaySeconds / 60),
  };
}

export function buildQqqPcsIntradayChartData(bars: readonly PcsIntradayChartBar[], scores: readonly PcsIntradayScorePoint[], dailyScore?: number, confirmation?: number, gex: readonly PcsGexPoint[] = [], granularity: PcsChartGranularity = '5m') {
  const price: Array<{ time: Time; value: number }> = [];
  const vwap: Array<{ time: Time; value: number }> = [];
  const candles: Array<{ time: Time; open: number; high: number; low: number; close: number }> = [];
  const barsByTime = new Map<number, PcsNormalizedBar>();
  // Replace corrections at an identical source timestamp before aggregating.
  const source = new Map<number, PcsIntradayChartBar>();
  for (const bar of bars) if (Number.isFinite(Date.parse(bar.timestamp))) source.set(Date.parse(bar.timestamp), bar);
  for (const [, bar] of [...source].sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    const time = chartTimeForGranularity(bar.timestamp, granularity);
    if (!Number.isFinite(Number(time))) continue;
    const hasOhlc = [bar.open, bar.high, bar.low].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const previous = barsByTime.get(Number(time));
    const full = hasOhlc && (!previous || previous.open !== undefined && previous.high !== undefined && previous.low !== undefined);
    barsByTime.set(Number(time), { time, close: bar.close,
      volume: Number.isFinite(bar.volume) && bar.volume >= 0 && (!previous || Number.isFinite(previous.volume) && previous.volume >= 0)
        ? (previous?.volume ?? 0) + bar.volume : NaN,
      ...(full ? { open: previous?.open ?? bar.open, high: Math.max(previous?.high ?? bar.high!, bar.high!), low: Math.min(previous?.low ?? bar.low!, bar.low!) } : {}) });
  }
  for (const bar of [...barsByTime.values()].sort((left, right) => Number(left.time) - Number(right.time))) {
    price.push({ time: bar.time, value: bar.close });
    if (bar.open !== undefined && bar.high !== undefined && bar.low !== undefined) {
      candles.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    }
  }
  if (granularity !== '1d') for (const point of qqqSessionVwap([...barsByTime.values()].map(bar=>({...bar,timestamp:new Date(Number(bar.time)*1000).toISOString()})), intradayBucketSeconds(granularity))) {
    if (point.value !== null) vwap.push({time: point.openedAt / 1000 as Time, value: point.value});
  }
  const hasFullOhlc = candles.length === price.length && price.length > 0;
  const scoresByTime = new Map<number, { time: Time; value: number }>();
  for (const point of scores) {
    const time = chartTimeForGranularity(point.time, granularity);
    if (Number.isFinite(point.score) && Number.isFinite(Number(time))) scoresByTime.set(Number(time), { time, value: point.score });
  }
  const gexTotal: Array<{ time: Time; value: number }> = [];
  const gammaFlip: Array<{ time: Time; value: number }> = [];
  for (const point of gex) {
    if (!Number.isFinite(point.totalGex)) continue;
    const time = chartTime('date' in point ? `${point.date}T16:00:00.000Z` : point.time);
    if (!Number.isFinite(Number(time))) continue;
    gexTotal.push({ time, value: point.totalGex });
    if (point.gammaFlipLevel !== null && Number.isFinite(point.gammaFlipLevel)) gammaFlip.push({ time, value: point.gammaFlipLevel });
  }
  gexTotal.sort((left, right) => Number(left.time) - Number(right.time));
  gammaFlip.sort((left, right) => Number(left.time) - Number(right.time));
  return {
    price,
    vwap,
    candles: hasFullOhlc ? candles : [],
    scores: [...scoresByTime.values()].sort((left, right) => Number(left.time) - Number(right.time)),
    normalizedBars: [...barsByTime.values()].sort((left, right) => Number(left.time) - Number(right.time)),
    dailyScore: Number.isFinite(dailyScore) ? price.map((point) => ({ time: point.time, value: Math.max(0, Math.min(5, Number(dailyScore))) })) : [],
    confirmation: Number.isFinite(confirmation) ? price.map((point) => ({ time: point.time, value: Math.max(0, Math.min(100, Number(confirmation))) })) : [],
    gexTotal,
    gammaFlip,
  };
}

export const resolveLiveBucketTime = (tickTime: number, previousBucketTime: number, bucketSeconds = 300) => {
  // Yahoo 分钟线和图表历史数据都以 bucket 起点标时；实时 tick 必须使用同一口径。
  // 向上取整会在 10:50:01 提前创建 10:52 bar，SWR 重建后留下 10:50 空槽。
  const rawBucketTime = Math.floor(tickTime / bucketSeconds) * bucketSeconds;
  if (!Number.isFinite(rawBucketTime)) return previousBucketTime;
  if (!Number.isFinite(previousBucketTime) || previousBucketTime <= 0) return rawBucketTime;
  if (rawBucketTime <= previousBucketTime) return previousBucketTime;
  return rawBucketTime;
};

export function qqqPcsLivePricePoint(tick: { time: number; price: number }, lastTime: number, bucketSeconds: number) {
  if (!Number.isFinite(tick.time) || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(lastTime)) return null;
  const time = Math.floor(tick.time / bucketSeconds) * bucketSeconds;
  if (time < lastTime || qqqMarketSession(new Date(time * 1000)).date !== qqqMarketSession(new Date(lastTime * 1000)).date) return null;
  return { time: time as Time, value: tick.price };
}

// 只标记截至当前已观测到的最低值：不使用右侧未来 K 线确认，因此绝不把“当前低点”包装成已见底。
export function buildObservedPriceLowMarkers(points: readonly { time: Time; close: number; low?: number }[]) {
  const lowest = points.reduce<{ time: Time; value: number } | null>((current, point) => {
    const value = Number.isFinite(point.low) && point.low! > 0 ? point.low! : point.close;
    if (!Number.isFinite(value) || value <= 0 || (current !== null && value >= current.value)) return current;
    return { time: point.time, value };
  }, null);
  return lowest === null ? [] : [{ color: '#fbbf24', position: 'atPriceBottom' as const, price: lowest.value, shape: 'arrowUp' as const, size: 1, text: `价格低点 ${lowest.value.toFixed(2)}`, time: lowest.time }];
}


export function buildShortTermReversalMarkers(
  observations: readonly QqqShortTermReversalObservation[],
) {
  return observations.map((signal) => {
    const bottom = signal.kind === 'BOTTOM';
    const color = signal.state === 'CONFIRMED' ? (bottom ? '#34d399' : '#fb7185') : signal.state === 'PRICE_CONFIRMED' ? (bottom ? '#2dd4bf' : '#c4b5fd') : signal.state === 'INVALIDATED' ? '#64748b' : (bottom ? '#fbbf24' : '#f59e0b');
    const prefix = bottom ? '低位观察' : '高位观察';
    const suffix = signal.state === 'INVALIDATED' ? '失效' : String(signal.level ?? (signal.state === 'CONFIRMED' ? 3 : signal.state === 'PRICE_CONFIRMED' ? 2 : 1));
    // Native bar-relative layout keeps spacing in pixels, never fabricated prices.
    return {
      color,
      position: bottom ? 'belowBar' as const : 'aboveBar' as const,
      price: signal.price,
      shape: signal.state === 'WATCH' ? 'circle' as const : bottom ? 'arrowUp' as const : 'arrowDown' as const,
      size: signal.state === 'CONFIRMED' || signal.state === 'PRICE_CONFIRMED' ? 2 : 1,
      text: signal.state === 'INVALIDATED' ? '× 观察失效' : `${prefix}${suffix}`,
      time: signal.time as Time,
    };
  });
}
