import type { PcsGexExpiry } from '@/types/qqqGex';
import type { ExposureFrame } from './qqqExposureWorkbench';
import { prepareQqqOptionObservations, qqqObservationPrefix } from './qqqOptionObservationHistory';
import { qqqLosslessGexDefinitionSupported } from './qqqGexInputQuality';

type Strike = PcsGexExpiry['fullGexProfile'][number];
export type QqqMaxPain = { level: number | null; totalOi: number; reason: string | null };
const cache = new WeakMap<readonly Strike[], QqqMaxPain>();
const validOi = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Minimize sum(OI * intrinsic value) over listed strikes. IV is irrelevant.
 * All contracts have the same multiplier, so it cannot change the minimizer.
 * A flat minimum uses its lowest listed strike; absent OI is never zero-filled.
 */
export function qqqMaxPain(strikes: readonly Strike[]): QqqMaxPain {
  const cached = cache.get(strikes);
  if (cached) return cached;
  const unavailable = (reason: string): QqqMaxPain => ({ level: null, totalOi: 0, reason });
  let result: QqqMaxPain;
  if (!strikes.length) result = unavailable('没有已加载的期权链');
  else if (strikes.some(row => !qqqLosslessGexDefinitionSupported(row))) result = unavailable('旧版快照无法确认缺失 OI，等待保留原始 OI 的快照');
  else if (strikes.some(row => !Number.isFinite(row.strike) || row.strike <= 0 || !validOi(row.callOi) || !validOi(row.putOi)) || new Set(strikes.map(row => row.strike)).size !== strikes.length) result = unavailable('行权价或双边 OI 缺失、无效或重复');
  else {
    const rows = [...strikes].sort((a, b) => a.strike - b.strike);
    const putTotal = rows.reduce((sum, row) => sum + row.putOi!, 0);
    const totalOi = putTotal + rows.reduce((sum, row) => sum + row.callOi!, 0);
    // The payout derivative starts at -totalPutOi and increases by
    // callOi + putOi at each strike. Its first nonnegative point minimizes
    // the convex payout. This avoids cancellation of large strike × OI sums.
    let accumulated = 0, level: number | null = null;
    if (Number.isSafeInteger(totalOi) && totalOi > 0) for (const row of rows) {
      accumulated += row.callOi! + row.putOi!;
      if (accumulated >= putTotal) { level = row.strike; break; }
    }
    result = level !== null ? { level, totalOi, reason: null } : unavailable('没有有效的非零持仓量或 OI 超出精确计数范围');
  }
  cache.set(strikes, result);
  return result;
}

export type QqqMaxPainTrack = { expiry: string; history: Array<QqqMaxPain & { time: number }> };

/** Retain missing observations as gaps and use receipt/computation availability.
 * Archive preparation is independent of the cursor; rendering slices its prefix.
 */
export async function prepareQqqMaxPain(
  expiries: readonly PcsGexExpiry[], frames: readonly ExposureFrame[], date: string,
  signal: AbortSignal, schedule: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<QqqMaxPainTrack[]> {
  return prepareQqqOptionObservations(expiries, frames, date, signal, qqqMaxPain, schedule);
}

export function qqqMaxPainAt(tracks: readonly QqqMaxPainTrack[], cutoff: number) {
  return tracks.map(track => {
    const history = qqqObservationPrefix(track.history, cutoff);
    return { ...track, history, latest: history.at(-1) ?? null };
  });
}
