import {supabaseCachedFetch} from '@/lib/supabaseCachedFetch';
import { qqqMarketSession } from './qqqMarketSession';
import type { FinancialFactor } from '@/types/factor';

const pending = new Map<number, Promise<FinancialFactor<any>>>();
const cache = new Map<number, { value: FinancialFactor<any>; until: number }>();
const metrics = { reads: 0, hits: 0, shared: 0, unavailable: 0, blockedUpstream: 0 };
export const qqqChainReadMetrics = () => ({ ...metrics, entries: cache.size });
/** Every QQQ page consumer is cache-only, including explicit refresh and cold starts. */
export async function readSharedQqqOptionChain(expiry = 0, now = new Date()): Promise<FinancialFactor<any>> {
  metrics.blockedUpstream++;
  const session = qqqMarketSession(now);
  const existing = cache.get(expiry);
  if (existing && existing.until > now.getTime() && existing.value.value?.optionChain?.result?.[0]?.frozen === !session.optionsOpen) { metrics.hits++; return existing.value; }
  const inFlight = pending.get(expiry); if (inFlight) { metrics.shared++; return inFlight; }
  const task = (async () => {
    metrics.reads++;
    const fallback = (reason: string): FinancialFactor<any> => ({ value: null, confidence: 0, source: { type: 'fallback', reason } });
    try {
      const url = process.env.SUPABASE_URL_SERVER || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const secret = process.env.QQQ_COLLECTOR_SECRET;
      if (!url || !secret) return fallback('QQQ Supabase 共享采集连接未配置');
      const response = await supabaseCachedFetch(`${url}/functions/v1/qqq-market-pipeline`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},
        body:JSON.stringify({action:'chain',expiry}),signal:AbortSignal.timeout(7000)});
      const data = response.ok ? await response.json() : null;
      const error = !response.ok;
      const row = data?.[0], received = Date.parse(row?.received_at);
      const age = now.getTime() - received;
      if (error || !row || !Number.isFinite(age) || age < 0 || age > (session.optionsOpen ? 5 * 60000 : 8 * 86400000)) {
        metrics.unavailable++; return fallback('QQQ 统一采集数据缺失或过旧；页面不会自行读取新期权链');
      }
      const root = row.payload?.optionChain?.result?.[0];
      if (!root) { metrics.unavailable++; return fallback('QQQ 共享期权链格式不可用'); }
      const value: FinancialFactor<any> = { value: { ...row.payload, optionChain: { ...row.payload.optionChain, result: [{ ...root,
        receivedAt: row.received_at, sharedCapture: true, frozen: !session.optionsOpen, dataAsOf: row.received_at }] } },
        confidence: 10, source: { type: 'raw', api: session.optionsOpen ? 'QQQ shared Yahoo capture' : 'QQQ frozen last successful Yahoo capture' } };
      cache.delete(expiry); cache.set(expiry, { value, until: now.getTime() + (session.optionsOpen ? 20000 : 60000) });
      while (cache.size > 48) cache.delete(cache.keys().next().value!);
      return value;
    } catch { metrics.unavailable++; return fallback('QQQ 共享期权链读取失败；保留缺失状态'); }
  })();
  pending.set(expiry, task);
  try { return await task; } finally { if (pending.get(expiry) === task) pending.delete(expiry); }
}
