import type { CompactGexStrike } from './qqqGexHistory';
import type { GEXPoint } from './engines/structure/GEXEngine';
import type { OptionContract } from '@/types/ivCurve';

const validIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function lastTradeAt(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value < 1e12 ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** One persisted profile schema for both page and scheduler writers. */
export function buildFullGexProfile(points: readonly GEXPoint[], chain?: { calls: OptionContract[]; puts: OptionContract[] }): CompactGexStrike[] {
  const calls = new Map(chain?.calls.map(option => [option.strike, option]) ?? []);
  const puts = new Map(chain?.puts.map(option => [option.strike, option]) ?? []);
  const optionalNumber = (key: string, value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
  return [...points]
    .filter(point => Number.isFinite(point.strike) && point.strike > 0 && Number.isFinite(point.callGEX) && Number.isFinite(point.putGEX) && Number.isFinite(point.totalGEX))
    .sort((a, b) => a.strike - b.strike)
    .map(point => {
      const call = calls.get(point.strike); const put = puts.get(point.strike);
      const callLastTradeAt = lastTradeAt(call?.lastTradeDate); const putLastTradeAt = lastTradeAt(put?.lastTradeDate);
      return {
        strike: point.strike, callGex: point.callGEX, putGex: point.putGEX, totalGex: point.totalGEX,
        callOi: chain ? call?.openInterest : point.callOI, putOi: chain ? put?.openInterest : point.putOI,
        ...optionalNumber('callVolume', chain ? call?.volume : point.callVol), ...optionalNumber('putVolume', chain ? put?.volume : point.putVol),
        ...optionalNumber('callBid', call?.bid), ...optionalNumber('callAsk', call?.ask), ...optionalNumber('callMid', call?.mid),
        ...optionalNumber('callLast', call?.lastPrice), ...optionalNumber('callIv', call?.iv), ...optionalNumber('callDelta', call?.delta), ...optionalNumber('callGamma', call?.gamma),
        ...optionalNumber('callTheta', call?.theta), ...optionalNumber('callVega', call?.vega),
        ...optionalNumber('putBid', put?.bid), ...optionalNumber('putAsk', put?.ask), ...optionalNumber('putMid', put?.mid),
        ...optionalNumber('putLast', put?.lastPrice), ...optionalNumber('putIv', put?.iv), ...optionalNumber('putDelta', put?.delta), ...optionalNumber('putGamma', put?.gamma),
        ...optionalNumber('putTheta', put?.theta), ...optionalNumber('putVega', put?.vega),
        ...(validIso(call?.receivedAt) ? { callReceivedAt: call.receivedAt } : {}),
        ...(validIso(put?.receivedAt) ? { putReceivedAt: put.receivedAt } : {}),
        ...(call?.oiProvenance ? {callOiProvenance:call.oiProvenance} : {}), ...(put?.oiProvenance ? {putOiProvenance:put.oiProvenance} : {}),
        ...(callLastTradeAt ? { callLastTradeAt } : {}), ...(putLastTradeAt ? { putLastTradeAt } : {}),
        isCallWall: point.isCallWall, isPutWall: point.isPutWall, isGammaFlip: point.isGammaFlip,
      };
    });
}
