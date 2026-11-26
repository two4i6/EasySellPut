import { supabaseAdmin } from './supabase';
import type { FinancialFactor } from '@/types/factor';
import type { GexExpirySnapshot, InferredOptionsFlowSnapshot, SellerOpportunityLifecyclePoint, SellerOpportunityAction, SellerOpportunityTier } from '@/types/sellerOpportunity';

export const TIMELINE_SCHEMA_VERSION = 3;

export interface TimelineSnapshotInput {
  policyId: string;
  dataAsOf: string;
  edgeScore: FinancialFactor<number>;
  eventScore: FinancialFactor<number>;
  premiumScore: FinancialFactor<number>;
  tier: SellerOpportunityTier;
  baseAction: SellerOpportunityAction;
  finalAction: SellerOpportunityAction;
  watchCondition: boolean;
  openCondition: boolean;
  watchStreak: number;
  openStreak: number;
  dayChange: FinancialFactor<number>;
  downsideSigma: FinancialFactor<number>;
  ivRank: FinancialFactor<number>;
  rsi: FinancialFactor<number | null>;
  /** 日内层（IntradayBonusEngine）所需的今日轮询路径字段。 */
  price: FinancialFactor<number>;
  totalGex?: FinancialFactor<number>;
  gammaFlipLevel?: FinancialFactor<number>;
  sellerIntradayPosition: FinancialFactor<number>;
  pcsContract?: SellerOpportunityLifecyclePoint['pcsContract'];
  /** schema v3 内追加的可选字段；QQQ PCS GEX 墙位/期限结构快照，旧记录缺失时该点不参与分段墙位重建。不触发 schemaVersion 提升（向后兼容，可选字段）。 */
  callWallPrice?: FinancialFactor<number>;
  putWallPrice?: FinancialFactor<number>;
  callWallMagnitude?: FinancialFactor<number>;
  putWallMagnitude?: FinancialFactor<number>;
  callTotalGex?: FinancialFactor<number>;
  putTotalGex?: FinancialFactor<number>;
  kingStrike?: FinancialFactor<number>;
  kingMagnitude?: FinancialFactor<number>;
  kingSide?: 'call' | 'put';
  gexProfile?: Array<{ strike: FinancialFactor<number>; magnitude: FinancialFactor<number>; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean }>;
  gexByExpiry?: GexExpirySnapshot[];
  gexTopologyStructure?: string;
  vixTermRatio?: FinancialFactor<number>;
}

type TimelineRow = { bar_at: string; factors: unknown };
const TIMELINE_DEDUPLICATE_MS = 30 * 60_000;
// 全量 GEX profile 使单条 factors JSON 显著变大；2 秒会把正常的远端响应误判为失败。
const TIMELINE_TIMEOUT_MS = 8_000;
const TODAY_TIMELINE_CACHE_TTL_MS = 15_000;
const DAILY_TIMELINE_CACHE_TTL_MS = 60_000;
type TimelineReadResult = { available: boolean; points: SellerOpportunityLifecyclePoint[] };
const timelineReadCache = new Map<string, { expiresAt: number; value: TimelineReadResult; bytes: number }>();
const timelineReads = new Map<string, Promise<TimelineReadResult>>();
let timelineBytes = 0;

function cachedTimeline(key: string): TimelineReadResult | null {
  const cached = timelineReadCache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.value : null;
}

function retainTimeline(key: string, ttlMs: number, value: TimelineReadResult) {
  const bytes = JSON.stringify(value).length * 4;
  const previous = timelineReadCache.get(key);
  if (previous) timelineBytes -= previous.bytes;
  timelineReadCache.delete(key);
  if (bytes > 4 * 1024 * 1024) return value;
  timelineReadCache.set(key, { expiresAt: Date.now() + ttlMs, value, bytes });
  timelineBytes += bytes;
  while (timelineReadCache.size > 64 || timelineBytes > 16 * 1024 * 1024) {
    const oldest = timelineReadCache.keys().next().value!;
    timelineBytes -= timelineReadCache.get(oldest)!.bytes;
    timelineReadCache.delete(oldest);
  }
  return value;
}

async function shareTimelineRead(key: string, load: () => Promise<TimelineReadResult>) {
  const cached = cachedTimeline(key);
  if (cached) return cached;
  const pending = timelineReads.get(key);
  if (pending) return pending;
  const request = load(); timelineReads.set(key, request);
  try { return await request; }
  finally { if (timelineReads.get(key) === request) timelineReads.delete(key); }
}

export const fiveMinuteBucket = (date = new Date()): Date => new Date(Math.floor(date.getTime() / 300_000) * 300_000);
export const twoMinuteBucket = (date = new Date()): Date => new Date(Math.floor(date.getTime() / 120_000) * 120_000);

export function shouldAppendTimelineSnapshot(latest: TimelineRow | null, payload: TimelineSnapshotInput, now = new Date()) {
  if (!latest) return true;
  const age = now.getTime() - new Date(latest.bar_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age >= TIMELINE_DEDUPLICATE_MS) return true;
  const { dataAsOf: _currentAsOf, ...current } = payload;
  const { dataAsOf: _latestAsOf, schemaVersion: _schemaVersion, ...previous } = (latest.factors ?? {}) as Partial<TimelineSnapshotInput> & { schemaVersion?: number };
  return JSON.stringify(current) !== JSON.stringify(previous);
}

export function resolveTimelinePredecessor(points: SellerOpportunityLifecyclePoint[], policyId: string, now = new Date()) {
  const latest = points.at(-1) ?? null;
  if (!latest || latest.policyId !== policyId) return { prior: null, alreadyRecorded: false };
  const latestBucket = fiveMinuteBucket(new Date(latest.time)).getTime();
  const currentBucket = fiveMinuteBucket(now).getTime();
  if (latestBucket === currentBucket) return { prior: latest, alreadyRecorded: true };
  return { prior: latestBucket === currentBucket - 300_000 ? latest : null, alreadyRecorded: false };
}

function zonedParts(date: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)])) as Record<string, number>;
}

function easternCalendarStartUtc(year: number, month: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 5));
  const guessLocal = zonedParts(guess, 'America/New_York');
  const offset = Date.UTC(guessLocal.year, guessLocal.month - 1, guessLocal.day, guessLocal.hour, guessLocal.minute, guessLocal.second) - guess.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offset);
}

/** 当前 America/New_York 日历日的 UTC 起点，覆盖 EST/EDT。 */
export function easternDayStartUtc(date = new Date()): Date {
  const local = zonedParts(date, 'America/New_York');
  return easternCalendarStartUtc(local.year, local.month, local.day);
}

export function easternNextDayStartUtc(date = new Date()): Date {
  const local = zonedParts(date, 'America/New_York');
  const tomorrow = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return easternCalendarStartUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
}

/** 只保留美东正常交易时段（周一至周五 09:30–16:00）的快照，避免周末/盘后轮询伪装成日内路径。 */
export function isRegularTradingSessionPoint(time: string): boolean {
  const date = new Date(time);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const { hour, minute } = zonedParts(date, 'America/New_York');
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

function isFactor(value: unknown): value is FinancialFactor<number> {
  return !!value && typeof value === 'object' && typeof (value as any).value === 'number' && typeof (value as any).confidence === 'number' && !!(value as any).source;
}

function isNullableFactor(value: unknown): value is FinancialFactor<number | null> {
  return !!value && typeof value === 'object' && ((value as any).value === null || typeof (value as any).value === 'number') && typeof (value as any).confidence === 'number' && !!(value as any).source;
}

function isPcsLifecycleContract(value: unknown): value is NonNullable<SellerOpportunityLifecyclePoint['pcsContract']> {
  if (!value || typeof value !== 'object') return false;
  if ((value as any).status === 'UNAVAILABLE') return typeof (value as any).reason === 'string';
  return (value as any).status === 'READY'
    && typeof (value as any).expiry === 'string'
    && ['daysToExpiration', 'sigma', 'shortStrike', 'longStrike', 'netCredit', 'annualizedReturn'].every((key) => Number.isFinite((value as any)[key]));
}

function isGexProfile(value: unknown): value is NonNullable<TimelineSnapshotInput['gexProfile']> {
  return Array.isArray(value) && value.length <= 8 && value.every((point) =>
    !!point
    && typeof point === 'object'
    && isFactor((point as any).strike)
    && isFactor((point as any).magnitude)
    && typeof (point as any).isCallWall === 'boolean'
    && typeof (point as any).isPutWall === 'boolean'
    && typeof (point as any).isGammaFlip === 'boolean'
  );
}

function isFullGexProfile(value: unknown): value is NonNullable<GexExpirySnapshot['gexProfile']> {
  return Array.isArray(value) && value.length <= 500 && value.every((point) =>
    !!point && typeof point === 'object'
    && isFactor((point as any).strike)
    && isFactor((point as any).callGex)
    && isFactor((point as any).putGex)
    && isFactor((point as any).totalGex)
    && ((point as any).callOi === undefined || isFactor((point as any).callOi))
    && ((point as any).putOi === undefined || isFactor((point as any).putOi))
    && ((point as any).callVolume === undefined || isFactor((point as any).callVolume))
    && ((point as any).putVolume === undefined || isFactor((point as any).putVolume))
    && typeof (point as any).isCallWall === 'boolean'
    && typeof (point as any).isPutWall === 'boolean'
    && typeof (point as any).isGammaFlip === 'boolean'
  );
}

function isInferredOptionsFlowSnapshot(value: unknown): value is InferredOptionsFlowSnapshot {
  if (!value || typeof value !== 'object' || (value as any).label !== 'INFERRED_NOT_TAPE') return false;
  return ['callPremium', 'putPremium', 'netPremium', 'callVolume', 'putVolume', 'confidence'].every((key) => isFactor((value as any)[key]))
    && ['CALL_BUYING', 'CALL_SELLING', 'PUT_BUYING', 'PUT_SELLING', 'MIXED', 'UNAVAILABLE'].includes((value as any).bias);
}

function hasValidOptionalTerminalFields(value: Record<string, unknown>): boolean {
  return ['atmIv', 'expectedMove', 'spot', 'netGamma', 'crowding', 'flipPosition'].every((key) => value[key] === undefined || isFactor(value[key]))
    && (value.topology === undefined || value.topology === null || typeof value.topology === 'string')
    && (value.inferredFlow === undefined || isInferredOptionsFlowSnapshot(value.inferredFlow));
}

function isGexExpirySnapshot(value: unknown): value is GexExpirySnapshot {
  if (!value || typeof value !== 'object' || typeof (value as any).expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test((value as any).expiryDate) || !Number.isInteger((value as any).dte) || (value as any).dte < 0) return false;
  return ['totalGex', 'gammaFlipLevel', 'callWallPrice', 'putWallPrice', 'callWallMagnitude', 'putWallMagnitude', 'callTotalGex', 'putTotalGex', 'kingStrike', 'kingMagnitude'].every((key) => isFactor((value as any)[key]))
    && ((value as any).kingSide === 'call' || (value as any).kingSide === 'put' || (value as any).kingSide === null)
    && isFullGexProfile((value as any).gexProfile)
    && ((value as any).gexTopologyStructure === null || typeof (value as any).gexTopologyStructure === 'string')
    && hasValidOptionalTerminalFields(value as Record<string, unknown>);
}

export function parseTimelineRow(row: TimelineRow): SellerOpportunityLifecyclePoint | null {
  const value = row.factors as Partial<TimelineSnapshotInput> & { schemaVersion?: number } | null;
  if (!value || ![2, TIMELINE_SCHEMA_VERSION].includes(value.schemaVersion ?? 0) || typeof value.policyId !== 'string' || !isFactor(value.edgeScore) || !isFactor(value.eventScore) || !isFactor(value.premiumScore)) return null;
  if (!['OPEN', 'WATCH', 'WAIT', 'BLOCK'].includes(value.baseAction ?? '') || !['OPEN', 'WATCH', 'WAIT', 'BLOCK'].includes(value.finalAction ?? '')) return null;
  return {
    time: row.bar_at,
    policyId: value.policyId,
    edgeScore: value.edgeScore,
    eventScore: value.eventScore,
    premiumScore: value.premiumScore,
    tier: value.tier ?? 'OBSERVE',
    baseAction: value.baseAction!,
    finalAction: value.finalAction!,
    watchCondition: !!value.watchCondition,
    openCondition: !!value.openCondition,
    watchStreak: value.watchStreak ?? 0,
    openStreak: value.openStreak ?? 0,
    ...(isFactor(value.dayChange) ? { dayChange: value.dayChange } : {}),
    ...(isFactor(value.downsideSigma) ? { downsideSigma: value.downsideSigma } : {}),
    ...(isFactor(value.ivRank) ? { ivRank: value.ivRank } : {}),
    ...(isNullableFactor(value.rsi) ? { rsi: value.rsi } : {}),
    ...(isFactor(value.price) ? { price: value.price } : {}),
    ...(isFactor(value.totalGex) ? { totalGex: value.totalGex } : {}),
    ...(isFactor(value.gammaFlipLevel) ? { gammaFlipLevel: value.gammaFlipLevel } : {}),
    ...(isFactor(value.sellerIntradayPosition) ? { sellerIntradayPosition: value.sellerIntradayPosition } : {}),
    ...(isPcsLifecycleContract(value.pcsContract) ? { pcsContract: value.pcsContract } : {}),
    ...(isFactor(value.callWallPrice) ? { callWallPrice: value.callWallPrice } : {}),
    ...(isFactor(value.putWallPrice) ? { putWallPrice: value.putWallPrice } : {}),
    ...(isFactor(value.callWallMagnitude) ? { callWallMagnitude: value.callWallMagnitude } : {}),
    ...(isFactor(value.putWallMagnitude) ? { putWallMagnitude: value.putWallMagnitude } : {}),
    ...(isFactor(value.callTotalGex) ? { callTotalGex: value.callTotalGex } : {}),
    ...(isFactor(value.putTotalGex) ? { putTotalGex: value.putTotalGex } : {}),
    ...(isFactor(value.kingStrike) ? { kingStrike: value.kingStrike } : {}),
    ...(isFactor(value.kingMagnitude) ? { kingMagnitude: value.kingMagnitude } : {}),
    ...((value.kingSide === 'call' || value.kingSide === 'put') ? { kingSide: value.kingSide } : {}),
    ...(isGexProfile(value.gexProfile) ? { gexProfile: value.gexProfile } : {}),
    ...(Array.isArray(value.gexByExpiry) && value.gexByExpiry.length <= 32 && value.gexByExpiry.every(isGexExpirySnapshot) ? { gexByExpiry: value.gexByExpiry } : {}),
    ...(typeof value.gexTopologyStructure === 'string' ? { gexTopologyStructure: value.gexTopologyStructure } : {}),
    ...(isFactor(value.vixTermRatio) ? { vixTermRatio: value.vixTermRatio } : {}),
  };
}

/** 同一标的、同一 5 分钟桶只保留一份真实分析。 */
export async function appendMinuteBar(symbol: string, factors: TimelineSnapshotInput, now = new Date()): Promise<boolean> {
  const latestController = new AbortController();
  const latestTimeout = setTimeout(() => latestController.abort(), TIMELINE_TIMEOUT_MS);
  let latestRows: TimelineRow[] | null | undefined;
  let latestError: unknown = null;
  try {
    const result = await supabaseAdmin.from('engine_minute_bar')
      .select('bar_at, factors')
      .eq('symbol', symbol)
      .order('bar_at', { ascending: false })
      .limit(1)
      .abortSignal(latestController.signal);
    latestRows = result.data as TimelineRow[] | null | undefined;
    latestError = result.error;
  } catch (err) {
    latestError = err;
  } finally {
    clearTimeout(latestTimeout);
  }
  const latest = (latestRows?.[0] as TimelineRow | undefined) ?? null;
  if (latestError) console.error(`[EngineTimeline] Error reading latest minute bar for ${symbol}:`, latestError);
  else if (!shouldAppendTimelineSnapshot(latest, factors, now)) return true;

  const latestBucket = latest ? fiveMinuteBucket(new Date(latest.bar_at)).getTime() : null;
  const currentBucket = fiveMinuteBucket(now).getTime();
  const previousFactors = latestBucket === currentBucket && latest?.factors && typeof latest.factors === 'object'
    ? latest.factors as Record<string, unknown>
    : null;
  const payload = { schemaVersion: TIMELINE_SCHEMA_VERSION, ...(previousFactors ?? {}), ...factors };

  const upsertController = new AbortController();
  const upsertTimeout = setTimeout(() => upsertController.abort(), TIMELINE_TIMEOUT_MS);
  let error: unknown = null;
  try {
    const result = await supabaseAdmin.from('engine_minute_bar').upsert(
      { symbol, bar_at: fiveMinuteBucket(now).toISOString(), factors: payload },
      { onConflict: 'symbol,bar_at' },
    ).abortSignal(upsertController.signal);
    error = result.error;
  } catch (err) {
    error = err;
  } finally {
    clearTimeout(upsertTimeout);
  }
  if (error) {
    console.error(`[EngineTimeline] Error appending minute bar for ${symbol}:`, error);
    return false;
  }
  return true;
}

export async function readTodayTimeline(symbol: string, now = new Date()): Promise<{ available: boolean; points: SellerOpportunityLifecyclePoint[] }> {
  return shareTimelineRead(`today:${symbol}:${easternDayStartUtc(now).toISOString()}`, () => fetchTodayTimeline(symbol, now));
}

async function fetchTodayTimeline(symbol: string, now: Date): Promise<TimelineReadResult> {
  const cacheKey = `today:${symbol}:${easternDayStartUtc(now).toISOString()}`;
  const cached = cachedTimeline(cacheKey);
  if (cached) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMELINE_TIMEOUT_MS);
  let data: unknown;
  let error: unknown = null;
  try {
    const result = await supabaseAdmin
      .from('engine_minute_bar')
      .select('bar_at, factors')
      .eq('symbol', symbol)
      .gte('bar_at', easternDayStartUtc(now).toISOString())
      .lt('bar_at', easternNextDayStartUtc(now).toISOString())
      .order('bar_at', { ascending: true })
      .abortSignal(controller.signal);
    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  } finally {
    clearTimeout(timeout);
  }
  if (error || !data) {
    if (error) console.error(`[EngineTimeline] Error reading minute bars for ${symbol}:`, error);
    // 读失败不能把已展示的路径降级成“没有历史”；优先保留最近成功快照。
    return timelineReadCache.get(cacheKey)?.value ?? { available: false, points: [] };
  }
  return retainTimeline(cacheKey, TODAY_TIMELINE_CACHE_TTL_MS, { available: true, points: (data as TimelineRow[]).map(parseTimelineRow).filter((point): point is SellerOpportunityLifecyclePoint => point !== null) });
}

export async function getTodayMinuteBars(symbol: string): Promise<SellerOpportunityLifecyclePoint[]> {
  return (await readTodayTimeline(symbol)).points;
}

function easternDateKey(date: Date): string {
  const { year, month, day } = zonedParts(date, 'America/New_York');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 近 N 个日历日、每日最后一条快照，供日线图表（如 GEX overlay）读取，不做跨天聚合。 */
export async function readDailyTimelineRange(symbol: string, days: number, now = new Date()): Promise<{ available: boolean; points: SellerOpportunityLifecyclePoint[] }> {
  return shareTimelineRead(`daily:${symbol}:${days}:${easternDayStartUtc(now).toISOString()}`, () => fetchDailyTimelineRange(symbol, days, now));
}

async function fetchDailyTimelineRange(symbol: string, days: number, now: Date): Promise<TimelineReadResult> {
  const cacheKey = `daily:${symbol}:${days}:${easternDayStartUtc(now).toISOString()}`;
  const cached = cachedTimeline(cacheKey);
  if (cached) return cached;
  const rangeStart = new Date(now.getTime() - days * 24 * 3600_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMELINE_TIMEOUT_MS);
  let data: unknown;
  let error: unknown = null;
  try {
    const result = await supabaseAdmin
      .from('engine_minute_bar')
      .select('bar_at, factors')
      .eq('symbol', symbol)
      .gte('bar_at', easternDayStartUtc(rangeStart).toISOString())
      .lt('bar_at', easternNextDayStartUtc(now).toISOString())
      .order('bar_at', { ascending: true })
      .abortSignal(controller.signal);
    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  } finally {
    clearTimeout(timeout);
  }
  if (error || !data) {
    if (error) console.error(`[EngineTimeline] Error reading daily timeline range for ${symbol}:`, error);
    return timelineReadCache.get(cacheKey)?.value ?? { available: false, points: [] };
  }
  const lastPerDay = new Map<string, TimelineRow>();
  for (const row of data as TimelineRow[]) lastPerDay.set(easternDateKey(new Date(row.bar_at)), row);
  return retainTimeline(cacheKey, DAILY_TIMELINE_CACHE_TTL_MS, {
    available: true,
    points: Array.from(lastPerDay.values()).map(parseTimelineRow).filter((point): point is SellerOpportunityLifecyclePoint => point !== null),
  });
}
