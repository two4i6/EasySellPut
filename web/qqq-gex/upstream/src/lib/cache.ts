import { supabaseAdmin } from './supabase';
import {gzipSync,gunzipSync} from 'node:zlib';
import {embeddedRedisCache} from './embeddedRedisCache';

export interface CacheEntry<T> {
  key: string;
  data: T;
  expires_at: string;
}

const CACHE_TIMEOUT_MS = 2_000;
const MAX_MEMORY_CACHE_ENTRIES = 64;
const MAX_MEMORY_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_MEMORY_ENTRY_BYTES = 4 * 1024 * 1024;
const LARGE_REPLAY_PREFIXES = ['qqq_combined_backtest:', 'qqq_cs_backtest:', 'qqq_pcs_backtest:'];
const memoryCache = new Map<string, { data?: unknown; compressed?: Buffer; expiresAt: number; bytes: number }>();
let memoryBytes = 0;
const sharedReads = new Map<string, Promise<unknown | null>>();

function removeMemoryCache(key: string): void {
  const entry = memoryCache.get(key);
  if (entry) memoryBytes -= entry.bytes;
  memoryCache.delete(key);
}

function pruneMemoryCache(now: number): void {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) removeMemoryCache(key);
  }
  while (memoryCache.size > MAX_MEMORY_CACHE_ENTRIES || memoryBytes > MAX_MEMORY_CACHE_BYTES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    removeMemoryCache(oldest);
  }
}

function readMemoryCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    removeMemoryCache(key);
    return null;
  }
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return (entry.compressed ? JSON.parse(gunzipSync(entry.compressed).toString('utf8')) : entry.data) as T;
}

function writeMemoryCache<T>(key: string, data: T, expiresAt: number): void {
  const now = Date.now();
  pruneMemoryCache(now);
  // Full backtest responses already live in the shared cache. The combined
  // route also has its own small process cache, so retaining another copy here
  // needlessly keeps large historical replay payloads in RAM for hours.
  if (expiresAt <= now || LARGE_REPLAY_PREFIXES.some(prefix => key.startsWith(prefix))) {
    removeMemoryCache(key);
    return;
  }
  // Conservative parsed-object estimate; large replies use their route cache.
  let bytes: number,json: string;
  try { json=JSON.stringify(data)??'null';bytes = json.length * 4; }
  catch { removeMemoryCache(key); return; }
  removeMemoryCache(key);
  if (bytes > MAX_MEMORY_ENTRY_BYTES) {
    // These are JSON HTTP results, not arbitrary typed engine values. Bound
    // decompression as well as retained bytes; no duplicate DB cache writes.
    if(!key.startsWith('stock_analysis_')||Buffer.byteLength(json)>16*1024*1024)return;
    const compressed=gzipSync(json,{level:1});bytes=compressed.byteLength;
    if(bytes>MAX_MEMORY_ENTRY_BYTES)return;
    memoryCache.set(key,{compressed,expiresAt,bytes});
  } else memoryCache.set(key, { data, expiresAt, bytes });
  memoryBytes += bytes;
  pruneMemoryCache(now);
}

// 派生回放的引擎口径或数据补源改变时，只改这里，所有使用该入口的回放缓存一起失效。
export const DERIVED_REPLAY_CACHE_VERSION = 'yahoo-exact-daily-vol-v6';

export function replayCacheKey(namespace: string, parts: readonly (string | number | boolean | undefined)[]): string {
  return `${namespace}:${parts.map((part) => part ?? 'default').join(':')}:replay-${DERIVED_REPLAY_CACHE_VERSION}`;
}

async function readSharedCache<T>(key: string, isCurrent: () => boolean): Promise<T | null> {
  if(embeddedRedisCache.configured()){
    const cached=await embeddedRedisCache.getJson<T>('api-json-v1',key);
    if(!isCurrent())return readMemoryCache<T>(key);
    if(cached){writeMemoryCache(key,cached.data,cached.expiresAt);return cached.data;}
  }
  // Disposable QQQ bundles use bounded L1/Redis only, including on serverless.
  if(key.startsWith('stock_analysis_QQQ_'))return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);
  try {
    const { data, error } = await supabaseAdmin.from('api_cache')
      .select('data, expires_at').eq('key', key)
      .gt('expires_at', new Date().toISOString()).abortSignal(controller.signal).single();
    if (error || !data) return null;
    if (!isCurrent()) return readMemoryCache<T>(key);
    const expiresAt = Date.parse(data.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const cached = data.data as T;
    writeMemoryCache(key, cached, expiresAt);
    // A delayed database backfill must not replace a newer shared value.
    if(embeddedRedisCache.configured())await embeddedRedisCache.setJson('api-json-v1',key,cached,expiresAt,true);
    return cached;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

export const apiCache = {
  async get<T>(key: string, readShared = true): Promise<T | null> {
    const inMemory = readMemoryCache<T>(key);
    if (inMemory !== null) return inMemory;
    if (!readShared) return null;
    const pending = sharedReads.get(key);
    if (pending) return pending as Promise<T | null>;
    const load: Promise<T | null> = readSharedCache<T>(key, () => sharedReads.get(key) === load);
    sharedReads.set(key, load);
    try { return await load; }
    finally { if (sharedReads.get(key) === load) sharedReads.delete(key); }
  },

  async set<T>(key: string, data: T, ttlSeconds: number, replicate = true): Promise<void> {
    sharedReads.delete(key);
    const expires_at = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    // Supabase is a cross-process cache, not a prerequisite for serving live
    // option data. Keep the fresh bundle locally before attempting its write.
    writeMemoryCache(key, data, Date.parse(expires_at));
    if (!replicate) return;
    // Disposable analysis bundles use built-in Redis instead of another large
    // database row. Miss/outage regenerates from origin; raw history is separate.
    if(key.startsWith('stock_analysis_QQQ_')){
      if(embeddedRedisCache.configured())await embeddedRedisCache.setJson('api-json-v1',key,data,Date.parse(expires_at));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);
    try {
      const { error } = await supabaseAdmin
        .from('api_cache')
        .upsert(
          { key, data, expires_at },
          { onConflict: 'key' }
        )
        .abortSignal(controller.signal);

      if (error) {
        console.error(`[Cache] Error setting key ${key}:`, error);
      }else if(embeddedRedisCache.configured()){
        await embeddedRedisCache.setJson('api-json-v1',key,data,Date.parse(expires_at));
      }
    } catch (err) {
      console.error(`[Cache] Error setting key ${key}:`, err);
    } finally {
      clearTimeout(timeout);
    }
  },

  async delete(key: string): Promise<void> {
    sharedReads.delete(key);
    removeMemoryCache(key);
    if(embeddedRedisCache.configured())await embeddedRedisCache.delete('api-json-v1',key);
    if(key.startsWith('stock_analysis_QQQ_'))return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);
    try {
      await supabaseAdmin
        .from('api_cache')
        .delete()
        .eq('key', key)
        .abortSignal(controller.signal);
    } catch {
      // swallow: caller doesn't handle rejection
    } finally {
      clearTimeout(timeout);
    }
  },

  async clearExpired(): Promise<void> {
    pruneMemoryCache(Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);
    try {
      await supabaseAdmin
        .from('api_cache')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .abortSignal(controller.signal);
    } catch {
      // swallow: caller doesn't handle rejection
    } finally {
      clearTimeout(timeout);
    }
  }
};
