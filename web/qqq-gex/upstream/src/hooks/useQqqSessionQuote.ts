'use client';
import useAppSWR from './useAppSWR';
import { readQqqHistoryClient } from '@/lib/qqqHistoryClient';
import { parseQqqSessionQuote, type QqqSessionQuote } from '@/lib/qqqSessionQuote';

/** The loading shell and terminal header own the same dated quote resource. */
export function useQqqSessionQuote(date: string | null) {
  return useAppSWR<QqqSessionQuote>(date ? ['qqq-session-quote-v1', date] : null, async () => {
    const payload = await readQqqHistoryClient('/api/proxy/yahoo?symbol=QQQ', { ttlMs: 60_000 });
    const quote = date ? parseQqqSessionQuote(payload, date) : null;
    if (!quote) throw new Error('最近交易时段行情暂不可用');
    return quote;
  }, { refreshInterval: 300_000, dedupingInterval: 300_000, revalidateOnFocus: false,
    revalidateOnReconnect: false, refreshWhenHidden: false, errorRetryInterval: 60_000,
    errorRetryCount: 3, showErrorToast: false }).data;
}
