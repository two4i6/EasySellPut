'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { qqqLiveQuoteUsable, qqqMarketSession } from '@/lib/qqqMarketSession';
import { qqqQuoteEnvelope, type QqqQuoteRange } from '@/lib/qqqQuoteEnvelope';
import { createQqqFramePublisher } from '@/lib/qqqFramePublisher';

export type QqqLiveTick = QqqQuoteRange & { change?: number; changePercent?: number; marketHours?: number };

let source: EventSource | null = null;
let currentTick: QqqLiveTick | null = null;
export type QqqLiveConnection = 'connecting' | 'live' | 'reconnecting' | 'stale' | 'offline' | 'paused';
let connection: QqqLiveConnection = 'connecting';
let receivedAt = 0;
let sourceStartedAt = 0;
let healthTimer: ReturnType<typeof setInterval> | null = null;
const connectionListeners = new Set<() => void>();
function setConnection(next: QqqLiveConnection) { if (connection !== next) { connection = next; for (const notify of connectionListeners) notify(); } }
export function useQqqLiveConnection() {
 return useSyncExternalStore(callback => { connectionListeners.add(callback); return () => { connectionListeners.delete(callback); }; }, () => connection, () => 'connecting' as QqqLiveConnection);
}
export const getQqqLiveConnection = () => connection;
export const getQqqLiveQuoteTime = () => currentTick?.time ?? null;
export const qqqLiveConnectionLabel = (state: QqqLiveConnection) => ({ live: '实时', connecting: '连接中', reconnecting: '重连中', stale: '报价延迟', offline: '已断开', paused: '已暂停' })[state];
const listeners = new Set<(tick: QqqLiveTick | null) => void>();

function emit(tick: QqqLiveTick | null) {
  currentTick = tick;
  for (const listener of listeners) {
    listener(tick);
  }
}

function ensureConnected() {
  if (source || document.visibilityState === 'hidden') return;
  if (!navigator.onLine) { setConnection('offline'); return; }
  setConnection('connecting');

  const activeSource = new EventSource('/api/proxy/yahoo/quote-stream?symbol=QQQ');
  source = activeSource;
  sourceStartedAt = Date.now();
  receivedAt = 0;
  source.addEventListener('tick', (event: MessageEvent) => {
    if (source !== activeSource) return;
    let tick: QqqLiveTick;
    try { tick = JSON.parse(event.data) as QqqLiveTick; } catch { return; }
    if (!qqqLiveQuoteUsable(tick)) { setConnection('stale'); return; }
    if (currentTick?.price === tick.price && currentTick?.time === tick.time) return;
    if (currentTick && tick.time < currentTick.time) return;
    receivedAt = Date.now();
    setConnection(Date.now() / 1000 - tick.time > 45 ? 'stale' : 'live');
    emit(tick);
  });
  source.addEventListener('error', () => {
    if (source !== activeSource) return;
    setConnection(navigator.onLine ? 'reconnecting' : 'offline');
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  });
}

function syncVisibility() {
  if (document.visibilityState === 'hidden') { source?.close(); source = null; setConnection('paused'); }
  else if (listeners.size) ensureConnected();
}

export function reconnectQqqLiveQuote() { if (!navigator.onLine) return; source?.close(); source=null; if(listeners.size)ensureConnected(); }

function syncNetwork() { source?.close(); source = null; if (navigator.onLine && listeners.size) ensureConnected(); else setConnection('offline'); }

export function subscribeQqqLiveTick(listener: (tick: QqqLiveTick | null) => void) {
  if (!listeners.size) {
    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('online', syncNetwork); window.addEventListener('offline', syncNetwork);
    healthTimer = setInterval(() => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      const now = Date.now();
      if (currentTick && (!qqqLiveQuoteUsable(currentTick, now) || now - receivedAt > 45_000)) { setConnection('stale'); emit(null); }
      // EventSource only retries on errors. A silent open connection (including
      // one which never delivered its first quote) needs a bounded fresh start.
      if (qqqMarketSession(new Date(now)).stockAcquisitionOpen && now - Math.max(receivedAt, sourceStartedAt) > 45_000) reconnectQqqLiveQuote();
    }, 5000);
  }
  listeners.add(listener);
  listener(qqqLiveQuoteUsable(currentTick) ? currentTick : null);
  ensureConnected();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('online', syncNetwork); window.removeEventListener('offline', syncNetwork);
      if (healthTimer) clearInterval(healthTimer); healthTimer = null; setConnection('paused');
      source?.close();
      source = null;
    }
  };
}

export default function useQqqLiveTick(enabled: boolean) {
  const [tick, setTick] = useState<QqqLiveTick | null>(() => (enabled && qqqLiveQuoteUsable(currentTick) ? currentTick : null));

  useEffect(() => {
    if (!enabled) {
      setTick(null);
      return;
    }
    const publisher = createQqqFramePublisher(setTick, requestAnimationFrame, cancelAnimationFrame);
    let envelope: QqqLiveTick | null = null;
    const unsubscribe = subscribeQqqLiveTick(tick => {
      envelope = tick ? qqqQuoteEnvelope(envelope, tick) : null;
      publisher.push(envelope);
    });
    return () => { unsubscribe(); publisher.stop(); };
  }, [enabled]);

  return enabled ? tick : null;
}

/** Imperative consumers share the same SSE connection without rendering on every tick. */
export function useQqqLiveTickEffect(enabled: boolean, onTick: (tick: QqqLiveTick | null) => void) {
  const callback = useRef(onTick);
  useEffect(() => { callback.current = onTick; });
  useEffect(() => {
    if (!enabled) return;
    return subscribeQqqLiveTick((tick) => callback.current(tick));
  }, [enabled]);
}
