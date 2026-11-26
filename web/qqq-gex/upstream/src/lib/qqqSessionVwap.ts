import { qqqMarketSession } from './qqqMarketSession';

export const QQQ_SESSION_VWAP_VERSION = 'qqq-regular-typical-volume-v3';
type Bar = { timestamp: string; close: number; volume: number; high?: number; low?: number };
/** Same input/price/reset policy for all charts. Open is the plot coordinate;
 * availableAt is the causal analytical coordinate. No quote volume is invented. */
export function qqqSessionVwap(bars: readonly Bar[], intervalSeconds = 120) {
  let date = '', volume = 0, notional = 0, incomplete = false;
  const unique = new Map<number, Bar>();
  for (const bar of bars) if (Number.isFinite(Date.parse(bar.timestamp))) unique.set(Date.parse(bar.timestamp), bar);
  return [...unique].sort((a,b)=>a[0]-b[0]).flatMap(([openedAt, bar]) => {
    const session = qqqMarketSession(new Date(openedAt));
    if (!session.stocksOpen || session.minute + intervalSeconds / 60 > session.stockCloseMinute) return [];
    if (session.date !== date) { date = session.date; volume = 0; notional = 0; incomplete = false; }
    const availableAt = openedAt + intervalSeconds * 1000;
    if (!Number.isFinite(bar.volume) || bar.volume < 0 || !Number.isFinite(bar.close) || bar.close <= 0) { incomplete = true; return [{ openedAt, availableAt, value: null, date }]; }
    const hasRange = typeof bar.high === 'number' && typeof bar.low === 'number' && Number.isFinite(bar.high) && Number.isFinite(bar.low) && bar.high >= bar.low && bar.low > 0;
    const price = hasRange ? (bar.high! + bar.low! + bar.close) / 3 : bar.close;
    volume += bar.volume; notional += price * bar.volume;
    return [{ openedAt, availableAt, value: !incomplete && volume > 0 ? notional / volume : null, date }];
  });
}
