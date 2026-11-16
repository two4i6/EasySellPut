import { replayQqqIntradayDirectional, type QqqIntradayDirectionalReplayDay } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import { supabaseAdmin } from './supabase';
import { qqqStoredGexTiming, type QqqStoredGexTiming } from './qqqDirectionalGexTime';
import {readQqqGexScopeRevision,type QqqReadRpc} from './qqqGexReadConsistency';
import { embeddedRedisCache } from './embeddedRedisCache';
import { QQQ_INTRADAY_DIRECTIONAL_POLICY } from './engines/analysis/QqqIntradayDirectional';
import { canonicalJsonRequestKey } from './responseCache';
import { readQqqChartWindowManifest, isChartSourceRolloutMissing } from './qqqChartSource';
import { qqqReplayFileCache } from './qqqReplayFileCache';
import { readQqqDirectionalReplayPages } from './qqqDirectionalReplayPages';

const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1_000;
const REPLAY_CACHE_MAX = 16;
type ReplayEvidence = { replay: ReturnType<typeof replayQqqIntradayDirectional>; repeatedFingerprint: string };
const replayCache = new Map<string, { expiresAt: number; revision:string; value: ReplayEvidence }>();
const pending = new Map<string, ReturnType<typeof loadQqqIntradayDirectionalReplay>>();
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const minuteFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });

type GexRow = {
  captured_at: unknown;
  expiry_date: unknown;
  dte: unknown;
  net_gex: unknown;
  gamma_flip: unknown;
  call_wall_price: unknown;
  put_wall_price: unknown;
};
type BarRow = { bar_at: unknown; open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const easternDate = (value: string) => dateFormatter.format(new Date(value));
const easternMinute = (value: string) => {
  const parts = minuteFormatter.formatToParts(new Date(value));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return (part('hour') % 24) * 60 + part('minute');
};

async function loadQqqIntradayDirectionalReplay(input: {
  policyId: string;
  from: string;
  to: string;
}): Promise<ReplayEvidence | null> {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs || toMs - fromMs > 32 * 24 * 60 * 60_000) return null;
  const cacheKey = `${input.policyId}|${input.from}|${input.to}`;
  const cached = replayCache.get(cacheKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let barsTask:Promise<BarRow[]|null>|undefined;
  try {
    const revisionRpc:QqqReadRpc=async(name,args)=>{
      const result=await supabaseAdmin.rpc(name,args).abortSignal(controller.signal);
      if(result.error)throw Error('Replay source revision unavailable');return result.data;
    };
    const revisionScope={...input,includeCandles:true};
    const revision=await readQqqGexScopeRevision(revisionRpc,revisionScope,controller.signal);
    if(cached&&cached.expiresAt>Date.now()&&cached.revision===revision)return cached.value;
    replayCache.delete(cacheKey);
    const sharedKey = canonicalJsonRequestKey({ input, revision, policy: QQQ_INTRADAY_DIRECTIONAL_POLICY, format: 2 });
    try {
      const shared = await embeddedRedisCache.getJson<ReplayEvidence>('qqq-directional-replay-v2', sharedKey)
        ?? (toMs<Date.now()?await qqqReplayFileCache.get<ReplayEvidence>(sharedKey):null);
      const value = shared?.data;
      if (shared && shared.expiresAt > Date.now() && value?.replay?.policyVersion === QQQ_INTRADAY_DIRECTIONAL_POLICY.id
        && value.replay.fingerprint === value.repeatedFingerprint && Array.isArray(value.replay.signals)
        && await readQqqGexScopeRevision(revisionRpc, revisionScope, controller.signal) === revision) {
        replayCache.set(cacheKey, { value, revision, expiresAt: shared.expiresAt });
        while (replayCache.size > REPLAY_CACHE_MAX) replayCache.delete(replayCache.keys().next().value!);
        return value;
      }
    } catch { /* Disposable shared evidence cannot block authoritative reads. */ }
    barsTask=(async()=>{
    const barRows: BarRow[] = [];
    let afterBar:string|null=null;
    for (;;) {
        let query = supabaseAdmin.from('qqq_intraday_candle')
          .select('bar_at, open, high, low, close, volume').setHeader('cache-control','no-cache')
          .eq('symbol', 'QQQ').eq('interval_seconds', 120)
          .gte('bar_at', input.from).lt('bar_at', input.to);
        if(afterBar)query=query.gt('bar_at',afterBar);
        const result=await query.order('bar_at',{ascending:true}).limit(PAGE_SIZE).abortSignal(controller.signal);
        if(result.error||!Array.isArray(result.data)||result.data.length>PAGE_SIZE)return null;
        const rows=result.data as BarRow[];
        for(const row of rows){
          if(typeof row.bar_at!=='string'||!Number.isFinite(Date.parse(row.bar_at))||(afterBar!==null&&Date.parse(row.bar_at)<=Date.parse(afterBar)))return null;
          afterBar=row.bar_at;barRows.push(row);
        }
        if(rows.length<PAGE_SIZE)break;
    }

    return barRows;
    })();
    void barsTask.catch(()=>{});
    const gexRows: GexRow[] = [];
    let indexed = false;
    if (input.policyId === 'qqq-pcs-intraday-v1' && toMs - fromMs <= 25 * 3600_000) {
      try {
        const manifest = await readQqqChartWindowManifest(input.from, input.to, true);
        const rows = await readQqqDirectionalReplayPages(manifest.items, async (after, limit) => {
          const result = await supabaseAdmin.rpc('qqq_gex_directional_replay_page', {
            p_policy_id: input.policyId, p_from: input.from, p_to: input.to,
            p_after: after?.captured_at ?? null, p_after_expiry: after?.expiry_date ?? null, p_limit: limit,
          }).abortSignal(controller.signal);
          if (result.error || !Array.isArray(result.data)) throw Error('Replay source page unavailable');
          return result.data as Array<GexRow & {captured_at:string;expiry_date:string}>;
        }, controller.signal, () => controller.abort());
        gexRows.push(...rows); indexed = true;
      } catch (error) { if (!isChartSourceRolloutMissing(error)) throw error; }
    }
    if (!indexed) {
    let after: string | null = null, afterExpiry: string | null = null;
    for (;;) {
      const result = await supabaseAdmin.rpc('qqq_gex_directional_replay_page', {
        p_policy_id: input.policyId, p_from: input.from, p_to: input.to,
        p_after: after, p_after_expiry: afterExpiry, p_limit: 128,
      }).abortSignal(controller.signal);
      // Missing RPC or any failed page cannot authorize incomplete replay.
      if (result.error || !Array.isArray(result.data)||result.data.length>128) return null;
      const rows = result.data as GexRow[];
      for (const row of rows) {
        if (typeof row.captured_at !== 'string' || typeof row.expiry_date !== 'string'
          || !Number.isFinite(Date.parse(row.captured_at))) return null;
        if (after !== null && (Date.parse(row.captured_at) < Date.parse(after)
          || Date.parse(row.captured_at) === Date.parse(after) && row.expiry_date <= afterExpiry!)) return null;
        after = row.captured_at; afterExpiry = row.expiry_date;
        gexRows.push(row);
      }
      if (rows.length < 128) break;
    }
    }
    const barRows=await barsTask;
    if(!barRows)return null;

    if(await readQqqGexScopeRevision(revisionRpc,revisionScope,controller.signal)!==revision)return null;
    const dates=new Map<string,string>();
    const dateAt=(time:string)=>{let date=dates.get(time);if(date===undefined){date=easternDate(time);dates.set(time,date);}return date;};
    const days = new Map<string, QqqIntradayDirectionalReplayDay>();
    for (const row of barRows) {
      if (typeof row.bar_at !== 'string' || ![row.open, row.high, row.low, row.close].every((value) => finite(value) && value > 0)) continue;
      const volume = Number(row.volume);
      if (!Number.isFinite(volume) || volume < 0) continue;
      const date = dateAt(row.bar_at);
      const day = days.get(date) ?? { date, bars: [], expiries: [], complete: false };
      day.bars.push({ timestamp: row.bar_at, open: row.open as number, high: row.high as number, low: row.low as number, close: row.close as number, volume });
      days.set(date, day);
    }
    for (const row of gexRows) {
      if (typeof row.captured_at !== 'string' || typeof row.expiry_date !== 'string' || !finite(row.dte) || !finite(row.net_gex)) continue;
      const date = dateAt(row.captured_at);
      const day = days.get(date);
      if (!day) continue;
      let expiry = day.expiries.find((item) => item.expiryDate === row.expiry_date);
      if (!expiry) {
        expiry = { expiryDate: row.expiry_date, dte: row.dte, snapshots: [] };
        day.expiries.push(expiry);
      }
      expiry.snapshots.push({
        ...qqqStoredGexTiming(row as unknown as QqqStoredGexTiming),
        netGex: row.net_gex,
        gammaFlip: finite(row.gamma_flip) ? row.gamma_flip : null,
        callWallPrice: finite(row.call_wall_price) ? row.call_wall_price : null,
        putWallPrice: finite(row.put_wall_price) ? row.put_wall_price : null,
      });
    }
    for (const day of days.values()) {
      day.bars.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      day.expiries.sort((left, right) => left.dte - right.dte || left.expiryDate.localeCompare(right.expiryDate));
      const firstMinute = day.bars[0] ? easternMinute(day.bars[0].timestamp) : Number.POSITIVE_INFINITY;
      const lastMinute = day.bars.at(-1) ? easternMinute(day.bars.at(-1)!.timestamp) : Number.NEGATIVE_INFINITY;
      day.complete = day.bars.length >= 180 && firstMinute <= 9 * 60 + 35 && lastMinute >= 15 * 60 + 55;
    }
    const replayDays = [...days.values()];
    const replay = replayQqqIntradayDirectional(replayDays);
    const value = { replay, repeatedFingerprint: replayQqqIntradayDirectional(replayDays).fingerprint };
    // Revisions, including repairs to old captures/candles, are checked above
    // on every access. A closed day need not be recalculated every ten minutes.
    const expiresAt = Date.now() + (toMs > Date.now() ? 30_000 : 86400_000);
    replayCache.set(cacheKey, { value, revision, expiresAt });
    while (replayCache.size > REPLAY_CACHE_MAX) replayCache.delete(replayCache.keys().next().value!);
    await Promise.allSettled([embeddedRedisCache.setJson('qqq-directional-replay-v2',sharedKey,value,expiresAt),
      toMs<Date.now()?qqqReplayFileCache.set(sharedKey,value,expiresAt):Promise.resolve()]);
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);controller.abort();
    await barsTask?.catch(()=>null);
  }
}

/** A burst of readers shares one consistent source scan and determinism check. */
export function readQqqIntradayDirectionalReplay(input: Parameters<typeof loadQqqIntradayDirectionalReplay>[0]) {
  // HTTP callers may also carry page/stream/display flags. Replay evidence
  // depends only on its source range and policy, including across workers.
  const source={policyId:input.policyId,from:input.from,to:input.to};
  const key = canonicalJsonRequestKey(source), existing = pending.get(key);
  if (existing) return existing;
  const task = loadQqqIntradayDirectionalReplay(source);
  if (pending.size < REPLAY_CACHE_MAX) {
    pending.set(key, task);
    void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
  }
  return task;
}
