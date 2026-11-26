import { prepareQqqPartialGammaInput } from './qqqGammaObservationInput';
import { buildQqqGammaModel, type GammaModelStrike, type QqqGammaModel } from './qqqGammaModel';
import { qqqDirectionalGexTime } from './qqqDirectionalGexTime';
import { qqqFrozenReferenceUsable } from './qqqMarketSession';

export type QqqGammaPositionLevel = { time: string; sourceAsOf: string | null; expiryDate: string; spot?: number; zeroGamma: number | null; volatilityTrigger: number | null; partial?: boolean };
export type QqqGammaPositionPoint = { time: string; zeroGamma: number | null; volatilityTrigger: number | null; reference?: boolean; sourceAsOf?: string | null };

export function qqqGammaPositionLevel(model: QqqGammaModel, expiryDate: string): QqqGammaPositionLevel {
  return { time: model.asOf, sourceAsOf: model.sourceAsOf, expiryDate, spot: model.spot, zeroGamma: model.levels.zeroGamma, volatilityTrigger: model.volatilityTrigger.price };
}

// Immutable snapshot arrays own their model; moving the cursor must not reprice history.
const partialLevels = new WeakMap<readonly GammaModelStrike[], { expiryDate: string; time: string; spot: number; level: QqqGammaPositionLevel }>();

/** Separate observation-only reconstruction. Never replaces full-chain models or persisted history. */
export function buildQqqPartialGammaPositionHistory(expiryDate: string, snapshots: readonly { time: string; spot: number; strikes: readonly GammaModelStrike[] }[]): QqqGammaPositionLevel[] {
  return snapshots.flatMap(snapshot => {
    const cached = partialLevels.get(snapshot.strikes);
    if (cached && cached.expiryDate === expiryDate && cached.time === snapshot.time && cached.spot === snapshot.spot) return [cached.level];
    const prepared=prepareQqqPartialGammaInput(snapshot.time,snapshot.strikes);
    if (!prepared?.strikes.length) return [];
    const model=buildQqqGammaModel([{expiryDate,asOf:prepared.asOf,fullGexProfile:prepared.strikes}],snapshot.spot,prepared.asOf,{includeSensitivity:false});
    if (!model.expiries.length) return [];
    const level = {...qqqGammaPositionLevel(model,expiryDate),partial:true};
    partialLevels.set(snapshot.strikes,{expiryDate,time:snapshot.time,spot:snapshot.spot,level});
    return [level];
  });
}

/** Reconstruct each capture from its own OI/IV and spot, before display projection removes IV. */
export function buildQqqGammaPositionHistory(expiryDate: string, snapshots: readonly { time: string; spot: number; strikes: readonly GammaModelStrike[] }[]): QqqGammaPositionLevel[] {
  return snapshots.flatMap(snapshot => {
    const available = Math.max(Date.parse(snapshot.time), Date.parse(qqqDirectionalGexTime(snapshot.time, null, snapshot.strikes)));
    if (!Number.isFinite(available)) return [];
    const model = buildQqqGammaModel([{ expiryDate, asOf: snapshot.time, fullGexProfile: snapshot.strikes }], snapshot.spot, new Date(available).toISOString());
    return [qqqGammaPositionLevel(model, expiryDate)];
  }).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Causal, unsmoothed percent distances. Nulls break missing/stale periods; no future levels backfill candles. */
export function buildQqqGammaPositionSeries(bars: readonly { timestamp: string; close: number }[], history: readonly QqqGammaPositionLevel[], expiryDate: string, options: { asOf?: string | number; barMinutes?: number; frozenReference?: boolean } = {}): QqqGammaPositionPoint[] {
  const levels = history.filter(p => p.expiryDate === expiryDate && Number.isFinite(Date.parse(p.time))).slice().sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
  let index = -1;
  // Archive sources can contain multiple revisions of the same candle, including
  // equivalent ISO spellings. Match the price chart's last-record convention;
  // duplicate times are rejected by the chart library. Source bars stay intact.
  const uniqueBars = new Map(bars.map(bar => [Date.parse(bar.timestamp), bar]));
  return [...uniqueBars.values()].sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp)).flatMap(bar => {
    const openedAt = Date.parse(bar.timestamp);
    const asOf = typeof options.asOf === 'string' ? Date.parse(options.asOf) : options.asOf ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(openedAt) || Number.isNaN(asOf) || openedAt > asOf) return [];
    const time = Math.min(openedAt + (options.barMinutes ?? 2) * 60_000, asOf);
    while (index + 1 < levels.length && Date.parse(levels[index + 1]!.time) <= time) index++;
    const level = levels[index];
    const fresh = level && level.sourceAsOf !== null && time - Date.parse(level.time) <= 240_000 && time - Date.parse(level.sourceAsOf) <= 360_000 && Date.parse(level.sourceAsOf) <= time;
    const reference = Boolean(options.frozenReference && level && qqqFrozenReferenceUsable(level.sourceAsOf, time, expiryDate));
    const distance = (value: number | null | undefined) => (fresh || reference) && Number.isFinite(bar.close) && bar.close > 0 && typeof value === 'number' && Number.isFinite(value) && value > 0 ? (bar.close - value) / bar.close * 100 : null;
    return [{ time: bar.timestamp, zeroGamma: distance(level?.zeroGamma), volatilityTrigger: distance(level?.volatilityTrigger), ...(reference ? {reference:true,sourceAsOf:level?.sourceAsOf} : {}) }];
  });
}


/** A received model may arrive after the latest candle closes. Show it at its own time,
 * using its own reference spot, never by backfilling an earlier candle. */
export function buildQqqGammaPositionDisplaySeries(bars: readonly { timestamp: string; close: number }[], history: readonly QqqGammaPositionLevel[], expiryDate: string, options: { asOf?: string | number; barMinutes?: number; frozenReference?: boolean } = {}) {
  const series = buildQqqGammaPositionSeries(bars, history, expiryDate, options);
  const lastTime = series.at(-1)?.time;
  const last = lastTime ? {timestamp:lastTime} : null;
  if (!last) return series;
  const closedAt = Date.parse(last.timestamp) + (options.barMinutes ?? 2) * 60_000;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const observations = history.filter(level => level.expiryDate === expiryDate && Number.isFinite(Date.parse(level.time)) && Date.parse(level.time) > closedAt && date.format(new Date(level.time)) === date.format(new Date(last.timestamp)) && Number.isFinite(level.spot) && level.spot! > 0);
  const uniqueObservations = [...new Map(observations.map(level => [Date.parse(level.time), level])).values()];
  const points = uniqueObservations.flatMap(level => buildQqqGammaPositionSeries([{ timestamp: level.time, close: level.spot! }], [level], expiryDate, { ...options, barMinutes: 0 }));
  return [...series, ...points].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
