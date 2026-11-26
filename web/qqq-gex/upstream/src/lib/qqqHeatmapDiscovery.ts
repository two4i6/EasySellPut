import { createQqqSharedPreparation, awaitQqqPreparation } from './qqqSharedPreparation';
import { qqqSnapshotAtmIv } from './qqqAtmIvObservation';
import type { GammaModelStrike } from './qqqGammaModel';
import type { DayScenarioInput } from './qqqDayScenario';
import { qqqIvUsable } from './qqqIvQuality';
import { exposureGexUnit, exposureSpotIndex, exposureStrikeMetric, prepareAggregateGammaFrames, type ExposureBar, type ExposureFrame } from './qqqExposureWorkbench';
import { heatmapScopedAtmIv } from './qqqHeatmapOverlays';
import { qqqGammaExpiryTime } from './qqqGammaModel';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { qqqEasternDateKey } from './qqqMarketDate';
import { qqqGexDisplayStrikeValid, qqqLosslessGexDefinitionSupported } from './qqqGexInputQuality';

export const discoveryWindows = [2, 10, 30] as const;
export type DiscoveryFlags = { changes: boolean; tracks: boolean; events: boolean; skew: boolean; bands: boolean };
export const discoveryDefaults: DiscoveryFlags = { changes: true, tracks: false, events: true, skew: false, bands: false };
export type StrikeChange = { strike: number; value: number; before: number; current: number };
export type DiscoveryRow = { time: number; call: number | null; put: number | null; skew: number | null; lower: number | null; upper: number | null; changes: Record<number, StrikeChange[]>; comparedAt: Record<number, number | null>; partial?: boolean };
export type DiscoveryEvent = { time: number; kind: 'touch' | 'migration'; side: 'call' | 'put'; price: number; from?: number; partial?: boolean };
export type DiscoverySeries = { rows: DiscoveryRow[]; events: DiscoveryEvent[]; unit: string };
export type DiscoveryInput = { frames: readonly ExposureFrame[]; bars: readonly ExposureBar[]; expiry: string | null; scope: 'selected' | 'all' };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const year = 365 * 86400_000;

/** 25-delta variance interpolation. Recompute delta from the same snapshot IV,
 * spot and remaining maturity; never clamp to an unbracketed boundary quote. */
export function snapshot25DeltaSkew(profile: ExposureFrame['profiles'][number], spot: number, time: number): number | null {
  const t = (qqqGammaExpiryTime(profile.expiry) - time) / year;
  if (!(spot > 0 && t > 0)) return null;
  const ivAt = (side: 'call' | 'put') => {
    const points = profile.strikes.flatMap(s => {
      const iv = side === 'call' ? s.callIv : s.putIv;
      if (!qqqIvUsable(iv) || !(s.strike > 0) || (side === 'call' ? s.strike < spot : s.strike > spot)) return [];
      const delta = Math.abs(blackScholesEngine.price({ S: spot, K: s.strike, T: t, r: 0, sigma: iv, type: side }).delta);
      return finite(delta) ? [{ delta, iv }] : [];
    }).sort((a, b) => a.delta - b.delta);
    const exact = points.find(p => Math.abs(p.delta - .25) < 1e-8);
    if (exact) return exact.iv;
    const right = points.findIndex(p => p.delta > .25);
    if (right <= 0) return null;
    const a = points[right - 1], b = points[right], w = (.25 - a.delta) / (b.delta - a.delta);
    return Math.sqrt(a.iv * a.iv * (1 - w) + b.iv * b.iv * w);
  };
  const call = ivAt('call'), put = ivAt('put');
  return call === null || put === null ? null : put - call;
}

/** Bind each forecast to its source snapshot's exact price and IV inputs. */
export function scenarioExpectedBandsFromInput(input: DayScenarioInput | null, times: readonly number[], expiry: string | null, scope: 'selected' | 'all') {
  const frame: ScenarioBandFrame | undefined = input ? {
    time: input.observationAt, missing: [...input.missing], profiles: input.expiries.map(p => ({expiry:p.expiryDate,time:Date.parse(p.asOf),strikes:p.fullGexProfile}))
  } : undefined;
  return scenarioExpectedBands(frame,input?.spot??null,times,expiry,scope);
}

type ScenarioBandFrame = {time:number;missing:readonly string[];profiles:readonly {expiry:string;time?:number;strikes:readonly GammaModelStrike[]}[]};

/** Forward 1SD projection from the snapshot; no hindsight band before its anchor. */
export function scenarioExpectedBands(frame: ScenarioBandFrame | undefined, spot: number | null, times: readonly number[], expiry: string | null, scope: 'selected' | 'all'): DiscoverySeries {
  const empty: DiscoverySeries = {rows: [], events: [], unit: 'per-1pct'};
  if (!frame || !finite(frame.time) || !valid(frame) || !finite(spot) || !(spot > 0)) return empty;
  const profiles = scope === 'all' ? frame.profiles : frame.profiles.filter(p => p.expiry === expiry);
  if (!profiles.length || new Set(profiles.map(p=>p.expiry)).size!==profiles.length || profiles.some(p=>new Set(p.strikes.map(s=>s.strike)).size!==p.strikes.length)) return empty;
  const inputs = profiles.map(profile => {
    const strikes = profile.strikes.map(strike => {
      const available = (value: unknown) => value === undefined || typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= frame.time;
      const computed = available(strike.computedAt);
      return {...strike, callIv: computed && available(strike.callReceivedAt) ? strike.callIv : undefined, putIv: computed && available(strike.putReceivedAt) ? strike.putIv : undefined};
    });
    const observedIv = qqqSnapshotAtmIv(strikes, spot);
    const iv = observedIv>0?observedIv:null;
    return {iv, end: qqqGammaExpiryTime(profile.expiry)};
  });
  if (inputs.some(p => p.iv === null || !finite(p.end) || p.end <= frame.time)) return empty;
  return {...empty, rows: times.map(time => {
    const widths = inputs.filter(p => time >= frame.time && time <= p.end).map(p => spot * p.iv! * Math.sqrt((time - frame.time) / year));
    const width = widths.length ? Math.max(...widths) : null;
    return {time, lower: width === null ? null : spot - width, upper: width === null ? null : spot + width, call: null, put: null, skew: null, changes: {}, comparedAt: {}};
  })};
}

function valid(frame: ScenarioBandFrame) {
  return !frame.missing.length && frame.profiles.length > 0 && frame.profiles.every(p => p.strikes.length > 0 && (p.time ?? frame.time) <= frame.time && frame.time - (p.time ?? frame.time) <= 300_000);
}
const partialFrame=(frame:ExposureFrame)=>frame.profiles.some(p=>p.strikes.some(s=>(s as typeof s & {inputComplete?:boolean}).inputComplete===false||!usable(s)));
function signature(frame: ExposureFrame) {
  return [...new Set(frame.profiles.flatMap(p => p.strikes.map(s => {
    const m = s as typeof s & { calculationVersion?: string; gexUnit?: string; inputComplete?: boolean };
    return m.calculationVersion && m.gexUnit ? `${p.expiry}:${m.calculationVersion}:${m.gexUnit}` : null;
  })))].sort().join('|')+(partialFrame(frame)?'|partial':'|complete');
}
const usable = (s: ExposureFrame['profiles'][number]['strikes'][number]) => qqqGexDisplayStrikeValid(s) && finite(s.callGex) && finite(s.putGex) && finite(s.totalGex);
function known(frame: ExposureFrame) {
  return valid(frame) && frame.profiles.every(p => p.strikes.some(usable) && new Set(p.strikes.map(s=>s.strike)).size===p.strikes.length && p.strikes.every(s => {
    const m = s as typeof s & { calculationVersion?: string; gexUnit?: string; inputComplete?: boolean };
    return Boolean(m.calculationVersion && m.gexUnit && (m.inputComplete===false||!usable(s) ? qqqLosslessGexDefinitionSupported(m) : true));
  }));
}
export function discoveryIndexAt(rows: readonly {time: number}[], cutoff: number) {
  let low = 0, high = rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].time <= cutoff) low = mid + 1; else high = mid; }
  return low - 1;
}

/** Cursor and display flags are deliberately absent. One bounded preparation
 * serves every replay position and all switches; no network access. */
export async function prepareHeatmapDiscovery(input: DiscoveryInput, schedule = () => new Promise<void>(resolve => setTimeout(resolve, 0)), signal: AbortSignal = new AbortController().signal): Promise<DiscoverySeries> {
  signal.throwIfAborted();
  const pause=async()=>{await schedule();signal.throwIfAborted();};
  const rows: DiscoveryRow[] = [], events: DiscoveryEvent[] = [];
  const readings: Array<{ time: number; signature: string | null; values: Map<number, number | null>; coverage: Map<number, string>; coverageKey:string }> = [];
  const spotAt = exposureSpotIndex(input.bars);
  const bars = input.bars.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  let barIndex = 0, started = performance.now();
  const cooldown = new Map<string, number>();
  const emit = (event: DiscoveryEvent) => {
    const key = `${event.kind}:${event.side}:${event.price}`;
    if (event.time - (cooldown.get(key) ?? -Infinity) < 600_000) return;
    cooldown.set(key, event.time); events.push(event);
  };
  await pause();
  // Reuse the existing normalized-frame WeakMap for legacy units, including a
  // single expiry. Saved OI / IV define the same Call+ / Put- model; never add
  // undocumented legacy GEX numbers.
  const frames = await prepareAggregateGammaFrames(input.frames, spotAt, signal, pause, true);
  for (const frame of frames) {
    signal.throwIfAborted();
    const row: DiscoveryRow = { time: frame.time, call: null, put: null, skew: null, lower: null, upper: null, changes: {}, comparedAt: {} };
    const compatible = known(frame), sig = compatible ? signature(frame) : null;
    const partial=partialFrame(frame);
    row.partial=partial;
    const profiles=frame.profiles.map(p=>({...p,strikes:p.strikes.filter(usable)}));
    const values = compatible ? exposureStrikeMetric({...frame,profiles}, 'gex') : new Map<number, number | null>();
    const groups = new Map<number, string[]>();
    for (const p of profiles) for (const s of p.strikes) groups.set(s.strike, [...(groups.get(s.strike) ?? []), p.expiry]);
    const coverage = new Map([...groups].map(([strike, names]) => [strike, names.sort().join('|')]));
    const coverageKey=JSON.stringify([...coverage].sort((a,b)=>a[0]-b[0]));
    const reading = { time: frame.time, signature: sig, values, coverage, coverageKey };
    const sides = new Map<number, {call: number; put: number}>();
    if (compatible) for (const profile of profiles) for (const s of profile.strikes) {
      const sum = sides.get(s.strike) ?? {call: 0, put: 0};
      sum.call += Math.abs(s.callGex); sum.put += Math.abs(s.putGex); sides.set(s.strike, sum);
    }
    let callMax = 0, putMax = 0;
    for (const [strike, value] of sides) {
      if (value.call > callMax) { callMax = value.call; row.call = strike; }
      if (value.put > putMax) { putMax = value.put; row.put = strike; }
    }
    for (const minutes of discoveryWindows) {
      const target = frame.time - minutes * 60_000, prior = readings[discoveryIndexAt(readings, target)];
      row.changes[minutes] = []; row.comparedAt[minutes] = null;
      if (!sig || !prior || prior.signature !== sig || target - prior.time > 150_000 || qqqEasternDateKey(prior.time) !== qqqEasternDateKey(frame.time)) continue;
      // A missing or incompatible capture anywhere inside the interval breaks comparison.
      const priorIndex = discoveryIndexAt(readings, prior.time), window = readings.slice(priorIndex);
      if (window.some((r, i, arr) => r.signature !== sig || i > 0 && r.time - arr[i - 1].time > 300_000) || frame.time - readings.at(-1)!.time > 300_000) continue;
      row.comparedAt[minutes] = prior.time;
      row.changes[minutes] = [...values].flatMap(([strike, current]) => {
        const before = prior.values.get(strike);
        return finite(current) && finite(before) && prior.coverage.get(strike) === coverage.get(strike) && window.every(r => r.coverage.get(strike) === coverage.get(strike)) ? [{strike, value: current - before, before, current}] : [];
      }).sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.strike - b.strike).slice(0, 6);
    }
    const spot = spotAt(frame.time);
    if (valid(frame) && spot !== null) {
      let weighted = 0, weights = 0, complete = true;
      const widths: number[] = [];
      for (const profile of frame.profiles) {
        const skew = snapshot25DeltaSkew(profile, spot, frame.time);
        const iv = heatmapScopedAtmIv({...frame, profiles: [profile], missing: []}, spot, profile.expiry, 'selected');
        const t = (qqqGammaExpiryTime(profile.expiry) - frame.time) / year;
        if (iv !== null && t > 0) widths.push(spot * iv * Math.sqrt(t));
        let weight = 1;
        if (input.scope === 'all') {
          weight = 0;
          for (const s of profile.strikes) {
            for(const oi of [s.callOi,s.putOi]){
              if(finite(oi)&&oi>=0)weight+=oi;
              else row.partial=true;
            }
          }
        }
        if (skew === null) complete = false;
        else { weighted += skew * weight; weights += weight; }
        if (performance.now() - started >= 6) { await pause(); started = performance.now(); }
      }
      if (complete && weights > 0) row.skew = weighted / weights;
      // All scope is the outer envelope of individually calculated expiry bands,
      // never an averaged DTE or a probabilistic confidence interval for the sum.
      if (widths.length === frame.profiles.length) {
        const width = Math.max(...widths); row.lower = spot - width; row.upper = spot + width;
      }
    }
    const previous = rows.at(-1);
    if (previous && sig && readings.at(-1)?.signature === sig && frame.time - previous.time <= 300_000 && qqqEasternDateKey(previous.time) === qqqEasternDateKey(frame.time)) for (const side of ['call', 'put'] as const) {
      const currentLevel=row[side],priorLevel=previous[side],priorCoverage=readings.at(-1)!.coverage;
      // Both winning levels must remain observed in the same expiry scope on
      // both sides. Losing a winner or admitting a new one is not migration.
      const continuouslyObserved=currentLevel!==null&&priorLevel!==null&&[currentLevel,priorLevel].every(level=>coverage.has(level)&&priorCoverage.get(level)===coverage.get(level));
      if (continuouslyObserved && currentLevel!==priorLevel) emit({time: frame.time, kind: 'migration', side, price: currentLevel!, from: priorLevel!,partial:partial||readings.at(-1)!.coverageKey!==coverageKey});
    }
    // Touch detection freezes the level known at candle OPEN and publishes only
    // at candle CLOSE. A newly arrived level cannot backfill the preceding range.
    while (barIndex < bars.length && Date.parse(bars[barIndex].timestamp) + 120_000 <= frame.time) {
      const bar = bars[barIndex++], opened = Date.parse(bar.timestamp), closed = opened + 120_000;
      const prior = rows[discoveryIndexAt(rows, opened)];
      if (!prior || opened - prior.time > 300_000 || qqqEasternDateKey(opened) !== qqqEasternDateKey(prior.time) || !finite(bar.high) || !finite(bar.low)) continue;
      for (const side of ['call', 'put'] as const) if (prior[side] !== null && bar.low <= prior[side]! && bar.high >= prior[side]!) emit({time: closed, kind: 'touch', side, price: prior[side]!,partial:prior.partial});
    }
    rows.push(row); readings.push(reading);
    // Only 30-minute comparisons need the heavy per-strike maps. Preserve
    // complete output rows/events while releasing expired comparison state.
    const oldest=frame.time-Math.max(...discoveryWindows)*60_000-150_000;
    while(readings.length>1&&readings[0]!.time<oldest)readings.shift();
    if (performance.now() - started >= 6) { await pause(); started = performance.now(); }
  }
  events.sort((a, b) => a.time - b.time);
  return {rows, events, unit: exposureGexUnit(frames.at(-1))};
}

export const acquireHeatmapDiscovery = createQqqSharedPreparation<DiscoveryInput, DiscoverySeries>(
  input => `${input.scope}:${input.scope==='selected'?input.expiry??'':''}`,
  (input, signal) => prepareHeatmapDiscovery(input, undefined, signal),
);
export function cachedHeatmapDiscovery(input: DiscoveryInput) {
  return awaitQqqPreparation(acquireHeatmapDiscovery(input));
}
