'use client';
import { useCallback, useEffect, useState } from 'react';
import type { IntradayContext } from '@/lib/qqqIntradayIndicators';
import { readQqqHistoryClient } from '@/lib/qqqHistoryClient';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { startQqqRefreshLoop } from '@/lib/qqqRefreshLoop';

export function useQqqIntradayContext(date: string, dte: number, enabled: boolean, include: 'all' | 'volume' = 'all') {
  const key = `${date}:${dte}:${include}`;
  const [saved, setSaved] = useState<{ key: string; value: IntradayContext } | null>(null);
  const [status, setStatus] = useState<{ key: string; loading: boolean; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled || !date || !Number.isInteger(dte) || dte < 0 || dte > 60) return;
    const controller = new AbortController();
    const load = async () => {
      setStatus({ key, loading: true, error: null });
      try {
        const value = await readQqqHistoryClient<IntradayContext>(`/api/analysis/qqq/gex/intraday-context?date=${date}&dte=${dte}&include=${include}`, { signal: controller.signal, ttlMs: date < qqqEasternDateKey(Date.now()) ? 900_000 : 30_000, force: attempt > 0 });
        if (value.date !== date || value.dte !== dte || !Array.isArray(value.days) || !Array.isArray(value.currentBars)) throw Error('历史参考范围不匹配');
        if (!controller.signal.aborted) { setSaved(previous => previous?.key === key && previous.value === value ? previous : { key, value }); setStatus({ key, loading: false, error: null }); }
      } catch { if (!controller.signal.aborted) setStatus({ key, loading: false, error: '历史参考读取失败；可继续查看当前已加载数据。' }); }
    };
    void load();
    const stop = date === qqqEasternDateKey(Date.now()) ? startQqqRefreshLoop(load, () => 30_000) : () => {};
    return () => { controller.abort(); stop(); };
  }, [date, dte, key, enabled, attempt, include]);
  return { data: saved?.key === key ? saved.value : null, loading: enabled && (status?.key !== key || status.loading), error: status?.key === key ? status.error : null, retry };
}
