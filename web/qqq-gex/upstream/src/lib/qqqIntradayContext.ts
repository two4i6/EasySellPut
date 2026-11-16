import { supabaseAdmin } from './supabase';
import { qqqMarketDateBounds, qqqEasternDateKey } from './qqqMarketDate';
import { qqqPreviousTradingDate } from './qqqMarketSession';
import { qqqStoredGexTiming, type QqqStoredGexTiming } from './qqqDirectionalGexTime';
import { qqqRegularBarIndex, type IntradayContext, type IntradayLevelSnapshot } from './qqqIntradayIndicators';
import type { ExposureBar } from './qqqExposureWorkbench';
import type { PcsFullGexProfile } from '@/types/qqqGex';

type StoredBar = { bar_at: string; open: number; high: number; low: number; close: number; volume: number | string | null };
type StoredLevel = QqqStoredGexTiming & { expiry_date: string; dte: number; net_gex: number; call_wall_price: number | null; put_wall_price: number | null; timing?: PcsFullGexProfile };
export function intradayReferenceDates(date: string) {
  const dates: string[] = []; let previous = date;
  for (let i = 0; i < 20; i++) { previous = qqqPreviousTradingDate(previous); dates.push(previous); }
  return dates.reverse();
}
export function normalizeIntradayLevels(rows: readonly StoredLevel[], from: number, to: number, dte: number): IntradayLevelSnapshot[] {
  return rows.flatMap(saved => {
    if (!Number.isFinite(Date.parse(saved.captured_at))) return [];
    const row = saved.timing ? { ...saved, received_at: saved.timing.callReceivedAt, put_received_at: saved.timing.putReceivedAt, computed_at: saved.timing.computedAt, calculation_version: saved.timing.calculationVersion, input_complete: saved.timing.inputComplete } : saved;
    if (row.dte !== dte || !['qqq-gex-full-1pct-v3', 'qqq-gex-full-1pct-usable-iv-v4'].includes(row.calculation_version ?? '') || row.input_complete !== true && row.input_complete !== 'true') return [];
    const time = Date.parse(qqqStoredGexTiming(row).time);
    if (!Number.isFinite(time) || time < from || time >= to || !Number.isFinite(row.net_gex) || !Number.isFinite(Date.parse(row.expiry_date))) return [];
    const wall = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    return [{ time, expiry: row.expiry_date, dte, netGex: row.net_gex, callWall: wall(row.call_wall_price), putWall: wall(row.put_wall_price) }];
  }).sort((a, b) => a.time - b.time);
}
export function normalizeIntradayBars(rows: readonly StoredBar[]): ExposureBar[] {
  return rows.map(row => ({ timestamp: row.bar_at, open: row.open, high: row.high, low: row.low, close: row.close,
    // A missing database value is not a real zero-volume candle.
    volume: row.volume === null || typeof row.volume === 'string' && !row.volume.trim() ? NaN : Number(row.volume) }));
}
async function readBars(from: string, to: string): Promise<ExposureBar[]> {
  const signal = AbortSignal.timeout(25_000), rows: StoredBar[] = [];
  for (let offset = 0; offset < 16000; offset += 1000) {
    const result = await supabaseAdmin.from('qqq_intraday_candle').select('bar_at,open,high,low,close,volume')
      .eq('symbol', 'QQQ').eq('interval_seconds', 120).gte('bar_at', from).lt('bar_at', to)
      .order('bar_at', { ascending: true }).range(offset, offset + 999).abortSignal(signal);
    if (result.error) throw Error('日内成交量历史读取失败');
    const page = (result.data ?? []) as StoredBar[]; rows.push(...page);
    if (page.length < 1000) return normalizeIntradayBars(rows);
  }
  throw Error('成交量历史超过有界读取范围');
}
async function readLevels(from: string, to: string, dte: number) {
  const signal = AbortSignal.timeout(40_000), rows: StoredLevel[] = [], pageSize = 64;
  const page = async (offset: number) => {
    const result = await supabaseAdmin.from('qqq_gex_expiry_snapshot')
      // One JSON extraction avoids repeatedly decompressing each large profile.
      .select('captured_at,expiry_date,dte,net_gex,call_wall_price,put_wall_price,timing:profile->0')
      .eq('symbol', 'QQQ').eq('policy_id', 'qqq-pcs-intraday-v1').eq('dte', dte).gte('captured_at', from).lt('captured_at', to)
      .order('captured_at', { ascending: true }).order('expiry_date', { ascending: true }).range(offset, offset + pageSize - 1).abortSignal(signal);
    if (result.error) throw Error('历史墙位读取失败');
    return (result.data ?? []) as unknown as StoredLevel[];
  };
  for (let offset = 0; offset < 8192; offset += pageSize * 4) {
    const pages = await Promise.all([0, 1, 2, 3].map(index => page(offset + index * pageSize)));
    let ended = false;
    for (const items of pages) {
      if (ended && items.length) throw Error('历史结构分页不连续');
      rows.push(...items); if (items.length < pageSize) ended = true;
    }
    if (ended) return normalizeIntradayLevels(rows, Date.parse(from), Date.parse(to), dte);
  }
  throw Error('历史墙位超过有界读取范围');
}

/** Closed reference days are shared for 15 minutes; current bars use the route's
 * short cache. No option profiles or live provider requests enter this path. */
const referenceCache = new Map<string, { until: number; task: Promise<{ bars: ExposureBar[]; levels: IntradayLevelSnapshot[]; issues: string[] }> }>();
export async function readQqqIntradayContext(date: string, dte: number, include: 'all' | 'volume' = 'all'): Promise<IntradayContext> {
  const dates = intradayReferenceDates(date), from = qqqMarketDateBounds(dates[0]).from, range = qqqMarketDateBounds(date);
  const key = include === 'volume' ? `${date}:volume` : `${date}:${dte}`, now = Date.now();
  let entry = referenceCache.get(key);
  if (!entry || entry.until <= now) {
    const task = Promise.allSettled([readBars(from, range.from), include === 'volume' ? Promise.resolve([]) : readLevels(from, range.from, dte)]).then(([bars, levels]) => ({
      bars: bars.status === 'fulfilled' ? bars.value as ExposureBar[] : [], levels: levels.status === 'fulfilled' ? levels.value as IntradayLevelSnapshot[] : [],
      issues: [bars.status === 'rejected' ? '历史成交量暂不可用，RVOL 基线未就绪。' : '', levels.status === 'rejected' ? '历史墙位暂不可用，触位统计未就绪。' : ''].filter(Boolean),
    }));
    entry = { until: now + 900_000, task }; referenceCache.delete(key); referenceCache.set(key, entry);
    void task.catch(() => { if (referenceCache.get(key)?.task === task) referenceCache.delete(key); });
    void task.then(value => { if (value.issues.length && referenceCache.get(key)?.task === task) referenceCache.delete(key); }, () => {});
    while (referenceCache.size > 4) referenceCache.delete(referenceCache.keys().next().value!);
  }
  const [references, current] = await Promise.allSettled([entry.task, readBars(range.from, new Date(Math.min(Date.parse(range.to), now)).toISOString())]);
  if (references.status !== 'fulfilled') throw Error('历史参考不可用');
  const { bars: referenceBars, levels: referenceLevels } = references.value;
  const issues = [...references.value.issues, ...(current.status === 'rejected' ? ['完整当日 K 线暂不可用，使用页面已加载的价格。'] : [])];
  if (references.value.issues.length === 2 && current.status === 'rejected') throw Error('历史与当前记录均不可用');
  const currentBars = current.status === 'fulfilled' ? current.value : [];
  const barsByDate = new Map<string, ExposureBar[]>(), levelsByDate = new Map<string, IntradayLevelSnapshot[]>();
  for (const bar of referenceBars) {
    if (!Number.isFinite(Date.parse(bar.timestamp))) continue;
    const day = qqqEasternDateKey(bar.timestamp), items = barsByDate.get(day) ?? []; items.push(bar); barsByDate.set(day, items);
  }
  for (const level of referenceLevels) { const day = qqqEasternDateKey(level.time), items = levelsByDate.get(day) ?? []; items.push(level); levelsByDate.set(day, items); }
  return { date, dte, asOf: new Date(now).toISOString(), requestedDays: 20, currentBars, issues, referenceComplete: references.value.issues.length === 0,
    days: dates.map(day => {
      const bars = barsByDate.get(day) ?? [], valid = new Set(qqqRegularBarIndex(bars, day).map(bar => bar.openedAt));
      return { date: day, bars: bars.filter(bar => valid.has(Date.parse(bar.timestamp))), levels: levelsByDate.get(day) ?? [] };
    }) };
}
