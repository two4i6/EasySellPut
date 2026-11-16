import { qqqTopNetGexProfile } from './qqqGexSummary';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { qqqGammaPositionLevel, type QqqGammaPositionLevel } from './qqqGammaPosition';
import { qqqGexRefreshInterval } from './qqqRefreshLoop';
import { qqqMarketSession, qqqPreviousTradingDate } from './qqqMarketSession';
export { qqqGexRefreshInterval } from './qqqRefreshLoop';
import { qqqEasternDateKey as easternDateKey } from './qqqMarketDate';
import { resolveSelectedGexExpiry } from './qqqGexSelection';
import { isolateHistoricalGexDecision } from './qqqGexHistoricalIsolation';
import { qqqMergeTimeline, qqqShareValue } from './qqqTimelineMerge';
import { qqqDirectionalGexTime } from './qqqDirectionalGexTime';
export { qqqMarketDateBounds as qqqGexDateBounds } from './qqqMarketDate';
export const GEX_LOAD_WINDOW_MS = 90 * 60_000;

const timestamp = (point: { time?: string; timestamp?: string; date?: string }) => Date.parse(point.time ?? point.timestamp ?? point.date ?? '');
const mergeByTime = qqqMergeTimeline;
// Compact polls omit historical strike details; omission must not erase a loaded profile.
export function mergeGexProfileHistory<T extends { time: string; strikes: readonly unknown[]; strikeCoverage?: 'full' | 'top8' }>(left: T[], right: readonly T[]): T[] {
  const key=(point:T)=>Number.isFinite(Date.parse(point.time))?Date.parse(point.time):point.time;
  const points=new Map(left.map(point=>[key(point),point]));
  for(const point of right){
    const previous=points.get(key(point));
    if(previous?.strikes.length&&(!point.strikes.length||previous.strikeCoverage!=='top8'&&point.strikeCoverage==='top8'))continue;
    points.set(key(point),previous?qqqShareValue(previous,point):point);
  }
  const result=[...points.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  return result.length===left.length&&result.every((point,i)=>point===left[i])?left:result;
}

// Keep received history across compact polls; newer null levels are real gaps, not omissions.
export function mergeGammaPositionHistory(left: QqqGammaPositionLevel[], right: readonly QqqGammaPositionLevel[]) {
  const points = new Map<string, QqqGammaPositionLevel>();
  for (const point of [...left, ...right]) {
    const time = Date.parse(point.time);
    if (Number.isFinite(time)) points.set(`${point.expiryDate}:${time}`, point);
  }
  const merged = [...points.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.expiryDate.localeCompare(b.expiryDate));
  return qqqShareValue(left, merged);
}

export function mergeGexReminderHistory<T extends { signalId: string | null; anchorBar: string | null }>(left: T[], right: readonly T[]) {
  const records = new Map<string, T>();
  for (const record of [...left, ...right]) {
    const key = record.signalId ?? record.anchorBar;
    if (key) records.set(key, record);
  }
  const merged = [...records.values()].sort((a,b) => Date.parse(a.anchorBar ?? '') - Date.parse(b.anchorBar ?? ''));
  return qqqShareValue(left, merged);
}

export function missingGexProfileWindow(data: QqqPcsApiResponse, expiryDate: string | null) {
  const intraday = data.intraday;
  const expiry = resolveSelectedGexExpiry(intraday?.gexExpiries, expiryDate);
  const history = expiry?.gexProfileHistory ?? (expiryDate === null ? intraday?.gexProfileHistory : undefined) ?? [];
  const date = data.view?.date;
  if (!date) return null;
  const missing = history.filter(point => !point.strikes.length && easternDateKey(point.time) === date).map(timestamp).filter(Number.isFinite);
  if (!missing.length) return null;
  const from = Math.min(...missing);
  return { from, to: Math.min(Math.max(...missing), from + GEX_LOAD_WINDOW_MS) };
}
export function canReuseClosedGexExpiry(data: QqqPcsApiResponse|null,expiryDate:string|null,now=new Date()) {
  if(!data?.view.date||qqqGexRefreshInterval(now)!==0)return false;
  const session=qqqMarketSession(now);
  const latestDate=session.trading&&session.minute>=session.stockAcquisitionCloseMinute?session.date:qqqPreviousTradingDate(session.date);
  if(data.view.date!==latestDate)return false;
  const expiry=resolveSelectedGexExpiry(data.intraday?.gexExpiries, expiryDate);
  return Boolean(expiry?.fullGexProfile?.length&&expiry.gexSummary&&Number.isFinite(Date.parse(expiry.asOf))&&easternDateKey(expiry.asOf)===data.view.date);
}


export type HistoricalGexRow = {
  strikeCoverage?: 'full' | 'top8';
  capturedAt: string; expiryDate: string; dte: number; spot: number; netGex: number; gammaFlip: number | null;
  callWallPrice: number | null; callWallMagnitude: number | null; putWallPrice: number | null; putWallMagnitude: number | null;
  kingStrike: number | null; kingMagnitude: number | null; kingSide: 'call' | 'put' | null;
  profile: Array<{ strike: number; callGex: number; putGex: number; totalGex: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean }>;
};

export function buildHistoricalGexExpiries(rows: readonly HistoricalGexRow[]) {
  const byExpiry = new Map<string, HistoricalGexRow[]>();
  for (const row of rows) {
    const group = byExpiry.get(row.expiryDate);
    if (group) group.push(row); else byExpiry.set(row.expiryDate, [row]);
  }
  return [...byExpiry.entries()].map(([expiryDate, values]) => {
    const history = values.slice().sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    const latest = history.at(-1)!;
    const topProfile = (profile: HistoricalGexRow['profile']) => qqqTopNetGexProfile(profile, point => point.totalGex);
    return {
      asOf: latest.capturedAt, expiryDate, dte: latest.dte,
      gex: history.map((point) => ({ time: point.capturedAt, totalGex: point.netGex, gammaFlipLevel: point.gammaFlip })),
      gexProfile: topProfile(latest.profile),
      gexProfileHistory: history.map((point) => ({ time: point.capturedAt, strikes: topProfile(point.profile) })),
      fullGexProfile: latest.strikeCoverage==='top8'?[]:latest.profile,
      fullGexProfileHistory: history.map(point => ({ time: point.capturedAt, strikes: point.profile, ...(point.strikeCoverage?{strikeCoverage:point.strikeCoverage}:{}) })),
      gexSummary: latest.strikeCoverage==='top8'?null:{ king: latest.kingStrike === null || latest.kingMagnitude === null || !latest.kingSide ? null : { strike: latest.kingStrike, magnitude: latest.kingMagnitude, side: latest.kingSide }, callWall: latest.callWallPrice === null ? null : { strike: latest.callWallPrice, magnitude: latest.callWallMagnitude ?? 0 }, putWall: latest.putWallPrice === null ? null : { strike: latest.putWallPrice, magnitude: latest.putWallMagnitude ?? 0 }, gammaFlip: latest.gammaFlip, netGex: latest.netGex, callTotal: latest.profile.filter((point) => point.totalGex >= 0).reduce((sum, point) => sum + point.totalGex, 0), putTotal: latest.profile.filter((point) => point.totalGex < 0).reduce((sum, point) => sum + point.totalGex, 0) },
      wallHistory: history.map((point) => ({ time: point.capturedAt, callWallPrice: point.callWallPrice, putWallPrice: point.putWallPrice, callWallMagnitude: point.callWallMagnitude, putWallMagnitude: point.putWallMagnitude, kingStrike: point.kingStrike, kingMagnitude: point.kingMagnitude, kingSide: point.kingSide })),
      terminal: undefined, research: null, gexInsights: null,
    };
  });
}

export function historicalGexDisplayPayload(base: QqqPcsApiResponse | null, date: string,
  expiries: NonNullable<NonNullable<QqqPcsApiResponse['intraday']>['gexExpiries']>,
  bars: NonNullable<QqqPcsApiResponse['intraday']>['bars'], selectedExpiry: string | null): QqqPcsApiResponse {
  const active = resolveSelectedGexExpiry(expiries, selectedExpiry);
  if (!active || !bars.length) throw new Error('该日期缺少可用 GEX 或 K 线');
  const reason = '历史原始 GEX 展示不携带实时选约或交易资格';
  // A fixed historical date is an independent resource. Its neutral envelope
  // must also work when the latest-session endpoint is slow or unavailable.
  base ??= {
    symbol: 'QQQ', asOf: active.asOf, view: { mode: 'historical', date }, intraday: null,
    intradaySessionAsOf: date, dataStatus: 'STALE', dataIssues: [], factors: {},
    regime: { mode: 'unified', selectedEngine: 'unified', unified: null, overlay: null, disagreement: false },
    daily: { eligibility: { value: 'UNAVAILABLE', confidence: 0, source: { type: 'fallback', reason } }, reasons: [reason], phase: 'CLOSED', asOf: active.asOf, priceBasis: 'PREVIOUS_CLOSE', confirmation: { value: 0, confidence: 0, source: { type: 'fallback', reason } } },
    timing: { value: 'INSUFFICIENT_DATA', confidence: 0, source: { type: 'fallback', reason } },
    candidate: { status: 'UNAVAILABLE', reason }, lifecycle: { available: false, points: [] },
  };
  const isolated = isolateHistoricalGexDecision(base, reason, date);
  const availableAt = Math.max(Date.parse(active.asOf), ...expiries.map(expiry=>Date.parse(qqqDirectionalGexTime(expiry.asOf,null,expiry.fullGexProfile))));
  const observedAt = Number.isFinite(availableAt)&&availableAt!==Date.parse(active.asOf) ? new Date(availableAt).toISOString() : active.asOf;
  return { ...base, ...isolated, asOf: active.asOf, observedAt, view: { mode: 'historical', date },
    dataStatus: 'STALE', dataIssues: [reason], daily: { ...isolated.daily, phase: 'CLOSED' },
    intradaySessionAsOf: date,
    intraday: { granularity: '2m', session: 'REGULAR', bars, extendedHoursBars: [], scoreSeries: [],
      gex: active.gex, gexProfile: active.gexProfile, gexProfileHistory: active.gexProfileHistory,
      gexSummary: active.gexSummary, wallHistory: active.wallHistory, gexExpiries: expiries,
      gexAsOf: active.asOf, terminal: null, directional: undefined },
  };
}

export function mergeGexWindows(current: QqqPcsApiResponse | null, next: QqqPcsApiResponse, selectedExpiry?: string | null) {
  if (current?.view?.date && next.view?.date && current.view.date !== next.view.date) return next;
  if (!current?.intraday || !next.intraday || next.intraday.granularity !== '2m' || current.intraday.granularity !== '2m') return next;
  const modelExpiry = selectedExpiry ?? next.intraday.gexExpiries?.[0]?.expiryDate ?? current.intraday.gammaModels?.selected.expiries[0];
  const previousModel = current.intraday.gammaModels;
  const sameModelExpiry = previousModel?.selected.expiries.length === 1 && previousModel.selected.expiries[0] === modelExpiry;
  const byExpiry = new Map(current.intraday.gexExpiries?.map((expiry) => [expiry.expiryDate, expiry]) ?? []);
  const overview = next.intraday.gexExpiries?.length ? next.intraday.gexExpiries : current.intraday.gexExpiries ?? [];
  const expiries = overview.map((expiry) => {
    const old = byExpiry.get(expiry.expiryDate);
    return old ? {
      ...expiry,
      gex: mergeByTime(old.gex, expiry.gex),
      gexProfile: expiry.gexProfile.length ? qqqShareValue(old.gexProfile, expiry.gexProfile) : old.gexProfile,
      gexProfileHistory: mergeGexProfileHistory(old.gexProfileHistory, expiry.gexProfileHistory),
      fullGexProfile: expiry.fullGexProfile.length ? qqqShareValue(old.fullGexProfile, expiry.fullGexProfile) : old.fullGexProfile,
      fullGexProfileHistory: mergeGexProfileHistory(old.fullGexProfileHistory, expiry.fullGexProfileHistory),
      wallHistory: mergeByTime(old.wallHistory, expiry.wallHistory),
      gexSummary: qqqShareValue(old.gexSummary, expiry.gexSummary ?? old.gexSummary),
      terminal: expiry.terminal ?? old.terminal,
      research: expiry.research ?? old.research,
    } : expiry;
  });
  return {
    ...next,
    intraday: {
      ...next.intraday,
      // Preserve past markers, while the current action and live availability always come from next.
      directional: next.intraday.directional ? { ...next.intraday.directional,
        signals: mergeGexReminderHistory(current.intraday.directional?.signals ?? [], next.intraday.directional.signals),
      } : undefined,
      gammaModels: next.intraday.gammaModels !== undefined ? next.intraday.gammaModels : sameModelExpiry ? previousModel : undefined,
      gexInsights: next.intraday.gexInsights !== undefined ? next.intraday.gexInsights : current.intraday.gexInsights,
      gammaPositionHistory: qqqShareValue(current.intraday.gammaPositionHistory, mergeGammaPositionHistory(
        [...(current.intraday.gammaPositionHistory ?? []), ...(current.intraday.gammaModels?.selected.expiries.length === 1 ? [qqqGammaPositionLevel(current.intraday.gammaModels.selected, current.intraday.gammaModels.selected.expiries[0]!)] : [])],
        [...(next.intraday.gammaPositionHistory ?? []), ...(next.intraday.gammaModels?.selected.expiries.length === 1 ? [qqqGammaPositionLevel(next.intraday.gammaModels.selected, next.intraday.gammaModels.selected.expiries[0]!)] : [])],
      )),
      bars: mergeByTime(current.intraday.bars, next.intraday.bars),
      extendedHoursBars: mergeByTime(current.intraday.extendedHoursBars ?? [], next.intraday.extendedHoursBars ?? []),
      scoreSeries: mergeByTime(current.intraday.scoreSeries, next.intraday.scoreSeries),
      gex: mergeByTime(current.intraday.gex ?? [], next.intraday.gex ?? []),
      gexProfile: next.intraday.gexProfile?.length ? qqqShareValue(current.intraday.gexProfile, next.intraday.gexProfile) : current.intraday.gexProfile,
      gexProfileHistory: mergeGexProfileHistory(current.intraday.gexProfileHistory ?? [], next.intraday.gexProfileHistory ?? []),
      wallHistory: mergeByTime(current.intraday.wallHistory ?? [], next.intraday.wallHistory ?? []),
      gexSummary: qqqShareValue(current.intraday.gexSummary, next.intraday.gexSummary ?? current.intraday.gexSummary),
      gexExpiries: expiries,
      gexAsOf: next.intraday.gexAsOf ?? current.intraday.gexAsOf,
    },
  };
}


