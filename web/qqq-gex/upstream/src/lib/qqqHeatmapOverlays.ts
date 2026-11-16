import { qqqOptionOverview } from './qqqOptionObservation';
import { createQqqSharedPreparation, awaitQqqPreparation } from './qqqSharedPreparation';
import { qqqEasternDateKey } from './qqqMarketDate';
import { qqqSessionVwap } from './qqqSessionVwap';
import { exposureSpotIndex, exposureValues, type ExposureBar, type ExposureFrame } from './qqqExposureWorkbench';
import { qqqSnapshotAtmIv } from './qqqAtmIvObservation';
import { qqqGexDisplayStrikeValid } from './qqqGexInputQuality';

export type HeatmapLinePoint = { time: number; value: number | null; partial?: boolean; coverage?: string; breakBefore?: boolean };
export type HeatmapOverlayFlags = { vwap: boolean; delta: boolean; iv: boolean; putCall: boolean };
export type HeatmapOverlayInput = { frames: readonly ExposureFrame[]; bars: readonly ExposureBar[]; date: string; expiry: string | null; scope?: 'selected' | 'all'; flags: HeatmapOverlayFlags };
export type HeatmapOverlaySeries = Record<keyof HeatmapOverlayFlags, HeatmapLinePoint[]>;
/** VWAP uses the price axis. Only enabled independent axes occupy columns. */
export function heatmapOverlayAxes(flags: HeatmapOverlayFlags) {
  return (['delta','iv','putCall'] as const).filter(key=>flags[key]);
}
const deltaCache = new WeakMap<ExposureFrame, Map<number, number | null>>();

/** Session VWAP from closed two-minute OHLCV bars, using typical price. */
export function heatmapSessionVwap(bars: readonly ExposureBar[], date: string): HeatmapLinePoint[] {
  return qqqSessionVwap(bars).filter(point=>point.date===date).map(point=>({time:point.availableAt,value:point.value}));
}

/** Full-chain model, independent of the visible strike zoom. Missing coverage
 * remains a gap; Call + / Put - is an inventory assumption, not trade flow. */
export function heatmapNetDelta(frame: ExposureFrame, spot: number | null): number | null {
  if (spot === null || frame.missing.length || !frame.profiles.length || frame.profiles.some(p => !p.strikes.length || (p.time??frame.time)>frame.time || frame.time-(p.time??frame.time)>300_000)) return null;
  let cache = deltaCache.get(frame);
  if (cache?.has(spot)) return cache.get(spot)!;
  const values = [...exposureValues(frame,'delta',spot).values()];
  const value = values.length && values.every(v=>v!==null) ? values.reduce<number>((sum,v)=>sum+v!,0) : null;
  if (!cache) { cache=new Map(); deltaCache.set(frame,cache); }
  cache.set(spot,value); while(cache.size>2)cache.delete(cache.keys().next().value!);
  return value;
}

/** Observation-only sum of usable strikes. Unknown contracts stay excluded;
 * the strict full-chain function above remains available to decision callers. */
export function heatmapDisplayNetDelta(frame: ExposureFrame, spot: number | null) {
  const strict=heatmapNetDelta(frame,spot);
  if(strict!==null)return {value:strict,partial:frame.profiles.some(p=>p.strikes.some(s=>(s as typeof s & {inputComplete?:boolean}).inputComplete===false))};
  if(spot===null||frame.missing.length||!frame.profiles.length||frame.profiles.some(p=>!p.strikes.length||(p.time??frame.time)>frame.time||frame.time-(p.time??frame.time)>300_000))return {value:null,partial:false};
  const values=[...exposureValues(frame,'delta',spot).values()].filter((v):v is number=>v!==null&&Number.isFinite(v));
  return {value:values.length?values.reduce((sum,v)=>sum+v,0):null,partial:true};
}

/** Resolve full scope coverage before calculating independent overlays. */
function scopedProfiles(frame: ExposureFrame, expiry: string | null, scope: 'selected' | 'all') {
  const profiles=scope==='all'?frame.profiles:frame.profiles.filter(p=>p.expiry===expiry);
  if((scope==='all'&&frame.missing.length)||!profiles.length||profiles.some(p=>!p.strikes.length||(p.time??frame.time)>frame.time||frame.time-(p.time??frame.time)>300_000))return null;
  return profiles;
}

/** Ratio of summed cumulative Put and Call volume over the selected scope. */
export function heatmapPutCallRatio(frame: ExposureFrame, expiry: string | null, scope: 'selected' | 'all' = 'selected'): number | null {
  return heatmapDisplayPutCallRatio(frame,expiry,scope).value;
}

/** Independent observed side totals, with contract coverage retained for line breaks. */
export function heatmapDisplayPutCallRatio(frame: ExposureFrame, expiry: string | null, scope: 'selected' | 'all' = 'selected') {
  const profiles = scopedProfiles(frame, expiry, scope);
  if (!profiles) return { value: null, partial: false, callVolume: null, putVolume: null, coverage: undefined };
  const reading = qqqOptionOverview(profiles.flatMap(profile => profile.strikes));
  const coverage = profiles.flatMap(profile => profile.strikes.flatMap(strike =>
    (['call', 'put'] as const).filter(side => typeof strike[`${side}Volume`] === 'number' && Number.isFinite(strike[`${side}Volume`]) && strike[`${side}Volume`]! >= 0)
      .map(side => `${profile.expiry}:${strike.strike}:${side}`))).sort();
  return { value: reading.putCallRatio, callVolume: reading.call.volume, putVolume: reading.put.volume,
    ...(!reading.completeVolume ? { partial: true } : {}), coverage: JSON.stringify(coverage) };
}

/** IV is not additive: aggregate expiry ATM readings by known OI weight.
 * Missing weights are excluded; no zero or historical OI is imputed. */
export function heatmapScopedAtmIv(frame: ExposureFrame, spot: number | null, expiry: string | null, scope: 'selected' | 'all' = 'selected'): number | null {
  const profiles=scopedProfiles(frame,expiry,scope);
  if(!profiles)return null;
  let weightedIv=0,totalWeight=0;
  for(const profile of profiles){
    if(spot===null)return null;
    const iv=qqqSnapshotAtmIv(profile.strikes,spot);
    if(!(iv>0))return null;
    if(scope==='selected')return iv;
    let weight=0;
    for(const strike of profile.strikes){
      for(const oi of [strike.callOi,strike.putOi])if(typeof oi==='number'&&Number.isFinite(oi)&&oi>=0)weight+=oi;
    }
    weightedIv+=iv*weight;totalWeight+=weight;
  }
  return totalWeight>0?weightedIv/totalWeight:null;
}

/** Preparation excludes the replay cursor. Dragging only clips these cached
 * series; yield between frames so a cold history cannot monopolize input. */
export async function prepareHeatmapOverlays(input: HeatmapOverlayInput, signal: AbortSignal, schedule=()=>new Promise<void>(resolve=>setTimeout(resolve,0))): Promise<HeatmapOverlaySeries> {
  signal.throwIfAborted();
  const result: HeatmapOverlaySeries = {vwap:[],delta:[],iv:[],putCall:[]};
  await schedule(); signal.throwIfAborted();
  if(input.flags.vwap)result.vwap=heatmapSessionVwap(input.bars,input.date);
  const spotAt=exposureSpotIndex(input.bars);
  let previousVolume: { time: number; call: number; put: number; coverage: string | undefined } | null = null;
  let yieldedAt=performance.now();
  for(let i=0;i<input.frames.length;i++) {
    signal.throwIfAborted();
    if(i===0||performance.now()-yieldedAt>=6){await schedule();signal.throwIfAborted();yieldedAt=performance.now();}
    const frame=input.frames[i],spot=spotAt(frame.time);
    if(input.flags.delta){
      const coverage=JSON.stringify(frame.profiles.flatMap(p=>p.strikes.filter(qqqGexDisplayStrikeValid).map(s=>`${p.expiry}:${s.strike}`)).sort());
      result.delta.push({time:frame.time,...heatmapDisplayNetDelta(frame,spot),coverage});
    }
    if(input.flags.putCall){
      const { callVolume, putVolume, ...reading } = heatmapDisplayPutCallRatio(frame, input.expiry, input.scope);
      // Small provider corrections remain continuous. A bilateral majority
      // reset on the same contracts changes the cumulative counting basis;
      // retain the readings, but never draw that boundary as a market trend.
      const reset = previousVolume !== null && reading.coverage === previousVolume.coverage
        && qqqEasternDateKey(frame.time) === qqqEasternDateKey(previousVolume.time)
        && callVolume !== null && putVolume !== null
        && callVolume < previousVolume.call * .5 && putVolume < previousVolume.put * .5;
      result.putCall.push({ time: frame.time, ...reading, ...(reset ? { breakBefore: true } : {}) });
      previousVolume = reading.value !== null && callVolume !== null && putVolume !== null
        ? { time: frame.time, call: callVolume, put: putVolume, coverage: reading.coverage } : null;
    }
    if(input.flags.iv){
      const partial=input.scope==='all'&&frame.profiles.some(p=>p.strikes.some(s=>[s.callOi,s.putOi].some(oi=>typeof oi!=='number'||!Number.isFinite(oi)||oi<0)));
      const coverage=input.scope==='all'?JSON.stringify(frame.profiles.flatMap(p=>p.strikes.flatMap(s=>['call','put'].flatMap(side=>{
        const oi=s[side==='call'?'callOi':'putOi'];return typeof oi==='number'&&Number.isFinite(oi)&&oi>=0?[`${p.expiry}:${s.strike}:${side}`]:[];
      }))).sort()):undefined;
      result.iv.push({time:frame.time,value:heatmapScopedAtmIv(frame,spot,input.expiry,input.scope),...(partial?{partial:true}:{}),...(coverage?{coverage}:{})});
    }
  }
  signal.throwIfAborted(); return result;
}

export const acquireHeatmapOverlays = createQqqSharedPreparation<HeatmapOverlayInput, HeatmapOverlaySeries>(
  input => JSON.stringify([input.date,input.scope??'selected',(input.scope??'selected')==='selected'?input.expiry:null,input.flags.vwap,input.flags.delta,input.flags.iv,input.flags.putCall]),
  (input, signal) => prepareHeatmapOverlays(input, signal),
);
export function cachedHeatmapOverlays(input: HeatmapOverlayInput) {
  return awaitQqqPreparation(acquireHeatmapOverlays(input));
}

export function heatmapLinePath(points: readonly HeatmapLinePoint[], cutoff: number, x:(time:number)=>number, y:(value:number)=>number) {
  let path='',previous:HeatmapLinePoint|null=null;
  for(const point of points){
    if(point.time>cutoff)break;
    if(point.value===null||!Number.isFinite(point.value)){previous=null;continue;}
    const px=x(point.time),py=y(point.value);
    path+=`${previous&&!point.breakBefore&&point.time>previous.time&&point.time-previous.time<=300_000&&qqqEasternDateKey(point.time)===qqqEasternDateKey(previous.time)&&point.coverage===previous.coverage?'L':'M'}${px.toFixed(2)},${py.toFixed(2)}`;
    previous=point;
  }
  return path;
}

/** Known endpoints stay visually connected when coverage changes. A dashed
 * transition distinguishes changing totals from a comparable trend; no unknown
 * reading or long gap is interpolated and no stored value is changed. */
export function heatmapLinePaths(points: readonly HeatmapLinePoint[], cutoff: number, x: (time: number) => number, y: (value: number) => number) {
  let transitions = '', previous: HeatmapLinePoint | null = null;
  for (const point of points) {
    if (point.time > cutoff) break;
    if (point.value === null || !Number.isFinite(point.value)) { previous = null; continue; }
    if (previous && !point.breakBefore && point.coverage !== previous.coverage && comparableEdge(previous, point) && point.time > previous.time && point.time - previous.time <= 300_000 && qqqEasternDateKey(point.time) === qqqEasternDateKey(previous.time)) {
      transitions += `M${x(previous.time).toFixed(2)},${y(previous.value!).toFixed(2)}L${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`;
    }
    previous = point;
  }
  return { solid: heatmapLinePath(points, cutoff, x, y), transitions };
}

/** Only bridge small coverage revisions. A large expansion at provider
 * bootstrap is a different subtotal, even when both endpoints are known.
 * Opaque legacy keys retain their existing transition behaviour. */
const coverageEdges = new WeakMap<HeatmapLinePoint, { previous: HeatmapLinePoint; before?: string; after?: string; value: boolean }>();
function comparableEdge(previous: HeatmapLinePoint, point: HeatmapLinePoint) {
  const cached = coverageEdges.get(point);
  if (cached?.previous === previous && cached.before === previous.coverage && cached.after === point.coverage) return cached.value;
  const value = comparableCoverage(previous.coverage, point.coverage);
  coverageEdges.set(point, { previous, before: previous.coverage, after: point.coverage, value });
  return value;
}
const coverageSets = new Map<string, Set<unknown> | null>();
let coverageCharacters = 0;
function coverageSet(key: string) {
  if (coverageSets.has(key)) return coverageSets.get(key)!;
  const parsed: unknown = JSON.parse(key);
  const result = Array.isArray(parsed) ? new Set(parsed) : null;
  if (key.length <= 262144) {
    coverageSets.set(key, result); coverageCharacters += key.length;
    while (coverageSets.size > 64 || coverageCharacters > 262144) {
      const first = coverageSets.keys().next().value!;
      coverageCharacters -= first.length; coverageSets.delete(first);
    }
  }
  return result;
}
function comparableCoverage(before: string | undefined, after: string | undefined): boolean {
  if (!before || !after) return true;
  try {
    const left = coverageSet(before), right = coverageSet(after);
    if (!left || !right) return true;
    let common = 0;
    for (const key of left) if (right.has(key)) common++;
    const union = left.size + right.size - common;
    return union === 0 || common / union >= .75;
  } catch { return true; }
}
