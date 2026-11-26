'use client';
import { useEffect, useState } from 'react';
import type { PcsFullGexProfile } from '@/types/qqqGex';
import { readQqqHistoryClient } from '@/lib/qqqHistoryClient';
type Quote = { date: string; expiry: string; cutoff: number; time: number | null; profile: PcsFullGexProfile[] };
export function useQqqSpreadQuote(date: string, expiry: string | null, at: number, short: number | null, long: number | null, enabled: boolean) {
  const key = JSON.stringify([date, expiry, at, short, long]);
  const [saved, setSaved] = useState<{ key: string; quote: Quote } | null>(null), [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !expiry || !Number.isFinite(at) || short === null || long === null || short === long) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void readQqqHistoryClient<Quote>(`/api/analysis/qqq/gex/spread-quote?date=${date}&expiry=${expiry}&at=${encodeURIComponent(new Date(at).toISOString())}&short=${short}&long=${long}`, { signal: controller.signal, ttlMs: 300_000 }).then(quote => {
        if (quote.date !== date || quote.expiry !== expiry || quote.cutoff !== at || !Array.isArray(quote.profile) || quote.time !== null && (quote.time > at || at - quote.time > 300_000) || quote.profile.some(row => row.strike !== short && row.strike !== long)) throw Error('双腿报价范围不匹配');
        if (!controller.signal.aborted) { setSaved({ key, quote }); setFailure(null); }
      }).catch(() => { if (!controller.signal.aborted) setFailure(key); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [date, expiry, at, short, long, key, enabled]);
  return { quote: saved?.key === key ? saved.quote : null, loading: enabled && saved?.key !== key && failure !== key, error: failure === key ? '双腿报价读取失败，未替换为模型报价。' : null };
}
