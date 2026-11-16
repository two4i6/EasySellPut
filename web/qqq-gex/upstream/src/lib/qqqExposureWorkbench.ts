import { createQqqSharedPreparation } from './qqqSharedPreparation';
import { qqqIvUsable } from './qqqIvQuality';
import type { PcsGexExpiry, QqqPcsApiResponse } from '@/types/qqqGex';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { qqqGammaExpiryTime } from './qqqGammaModel';
import { qqqImmutableDirectionalGexTime } from './qqqDirectionalGexTime';
import { qqqGexDisplayStrikeValid,qqqGexDisplaySideValid } from './qqqGexInputQuality';

export type ExposureMode = 'gamma' | 'gamma-call' | 'gamma-put' | 'delta' | 'charm';
export type ExposureBar = NonNullable<QqqPcsApiResponse['intraday']>['bars'][number];
type Strike = PcsGexExpiry['fullGexProfile'][number];
export type ExposureFrame = { time: number; profiles: Array<{ expiry: string; time?: number; strikes: Strike[] }>; missing: string[] };
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
// Snapshot arrays are immutable. Preserve source order and duplicate contracts;
// indexing must not change floating-point aggregation or coverage checks.
const strikeIndexes = new WeakMap<readonly Strike[], Map<number, Array<{point:Strike;index:number}>>>();
function selectedProfileStrikes(profile:readonly Strike[],selected?:ReadonlySet<number>):readonly Strike[] {
  if(!selected)return profile;
  let index=strikeIndexes.get(profile);
  if(!index){index=new Map();profile.forEach((point,i)=>{
    const entries=index!.get(point.strike)??[];entries.push({point,index:i});index!.set(point.strike,entries);
  });strikeIndexes.set(profile,index);}
  return [...selected].flatMap(strike=>index!.get(strike)??[]).sort((a,b)=>a.index-b.index).map(entry=>entry.point);
}
import { qqqEasternDateKey as dateET } from './qqqMarketDate';
const calculationKey=(strike:Strike)=>{
  const s=strike as Strike & {calculationVersion?:string;gexUnit?:string};
  return s.calculationVersion&&s.gexUnit?`${s.calculationVersion}:${s.gexUnit}`:null;
};
export function exposureGexUnit(frame:ExposureFrame|undefined) {
  const units=new Set(frame?.profiles.flatMap(p=>p.strikes.map(s=>(s as Strike & {gexUnit?:string}).gexUnit??'unknown')));
  return units.size===1?[...units][0]:'unknown';
}

/** Never backdate the latest profile or use snapshots beyond the observation cutoff. */
const immutableFrames = new WeakSet<ExposureFrame>();
export const immutableExposureFrame = (frame:ExposureFrame) => immutableFrames.has(frame);
const frameIndexes=new WeakMap<readonly PcsGexExpiry[],Map<string,ExposureFrame[]>>();
type FrameInput = { frames: readonly PcsGexExpiry[]; bars: readonly PcsGexExpiry[]; cutoff: number; scope: 'selected' | '0dte' | 'all'; selected: string | null; sessionDate?: string };
const frameKey = (input: FrameInput) => JSON.stringify([input.cutoff,input.scope,input.scope==='selected'?input.selected:null,input.scope==='0dte'?input.sessionDate:null]);
export function cachedExposureFrames(input: FrameInput) { return frameIndexes.get(input.frames)?.get(frameKey(input)); }
function rememberFrames(input: FrameInput, result: ExposureFrame[]) {
  const cache = frameIndexes.get(input.frames) ?? new Map<string, ExposureFrame[]>();
  cache.set(frameKey(input), result);
  while (cache.size > 12) cache.delete(cache.keys().next().value!);
  frameIndexes.set(input.frames, cache); return result;
}
function* indexExposureFrames(input: FrameInput): Generator<void, ExposureFrame[]> {
  const { frames: expiries, cutoff, scope, selected, sessionDate } = input;
  if (!finite(cutoff)) return [];
  const included = expiries.filter(e => scope === 'all' || (scope === '0dte' ? e.expiryDate === (sessionDate ?? dateET(cutoff)) : e.expiryDate === (selected ?? expiries[0]?.expiryDate)));
  const cycles = new Map<number, number>();
  const histories: Array<{ expiry: string; points: Array<[number, Strike[]]> }> = [];
  for (const e of included) {
    const byTime = new Map<number, Strike[]>();
    const append = (time: string, strikes: Strike[]) => {
      const available = Date.parse(qqqImmutableDirectionalGexTime(time, strikes)), captured = Date.parse(time);
      if (strikes.length && finite(captured) && finite(available)) {
        cycles.set(captured, Math.max(cycles.get(captured) ?? -Infinity, available));
        if (available <= cutoff) byTime.set(available, strikes);
      }
    };
    for (const p of e.fullGexProfileHistory) { if(p.strikeCoverage!=='top8')append(p.time, p.strikes); yield; }
    append(e.asOf, e.fullGexProfile);
    histories.push({ expiry: e.expiryDate, points: [...byTime].sort((a,b) => a[0]-b[0]) });
    yield;
  }
  const times = [...new Set(scope==='all' ? [...cycles.values()].filter(time=>time<=cutoff) : histories.flatMap(e=>e.points.map(p=>p[0])))].sort((a,b)=>a-b);
  const cursors = histories.map(() => -1), dayCache = new Map<number,string>();
  const dayAt = (time:number) => { let day=dayCache.get(time); if(day===undefined){day=dateET(time);dayCache.set(time,day);}return day; };
  const days = histories.map(h=>h.points.map(p=>dayAt(p[0]))), result: ExposureFrame[] = [];
  for (const time of times) {
    const profiles: ExposureFrame['profiles'] = [], missing: string[] = [], day = dayAt(time);
    for (let i=0;i<histories.length;i++) {
      const h=histories[i]!; let cursor=cursors[i]!;
      while(cursor+1<h.points.length && h.points[cursor+1]![0]<=time) cursor++;
      cursors[i]=cursor; const p=h.points[cursor];
      if(!p || time-p[0]>300_000 || days[i]![cursor]!==day) missing.push(h.expiry);
      else profiles.push({expiry:h.expiry,time:p[0],strikes:p[1]});
    }
    const frame={time,profiles,missing};immutableFrames.add(frame);result.push(frame); yield;
  }
  return result;
}
export function exposureFrames(expiries: readonly PcsGexExpiry[], cutoff: number, scope: 'selected'|'0dte'|'all', selected: string|null, sessionDate?:string) {
  const input={frames:expiries,bars:expiries,cutoff,scope,selected,sessionDate}, cached=cachedExposureFrames(input);
  if(cached)return cached;
  const iterator=indexExposureFrames(input);let step=iterator.next();
  while(!step.done)step=iterator.next();
  return rememberFrames(input,step.value);
}
export const acquireExposureFrames = createQqqSharedPreparation<FrameInput, ExposureFrame[]>(frameKey, async(input,signal)=>{
  const cached=cachedExposureFrames(input);if(cached)return cached;
  const iterator=indexExposureFrames(input);let started=performance.now(),step=iterator.next();
  while(!step.done){
    signal.throwIfAborted();
    if(performance.now()-started>=6){await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();started=performance.now();}
    step=iterator.next();
  }
  signal.throwIfAborted();return rememberFrames(input,step.value);
});

export { qqqMarketDateBounds as exposureDayBounds } from './qqqMarketDate';

export function exposureSpot(bars: readonly ExposureBar[], time: number) {
  // Bars are stamped at their opening time. Only a closed 2-minute candle is causal.
  return bars.filter(b => Date.parse(b.timestamp) + 120_000 <= time && time - Date.parse(b.timestamp) <= 420_000 && finite(b.close) && b.close > 0).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).at(-1)?.close ?? null;
}

/** One sort and binary search per frame instead of repeatedly sorting candles. */
const stableSpotIndexes = new WeakSet<(time:number)=>number|null>();
const spotIndexes = new WeakMap<readonly ExposureBar[], (time: number) => number | null>();
export function exposureSpotIndex(bars: readonly ExposureBar[]) {
  const cached = spotIndexes.get(bars);
  if (cached) return cached;
  const sorted=bars.flatMap(b=>finite(Date.parse(b.timestamp))&&finite(b.close)&&b.close>0?[{time:Date.parse(b.timestamp),close:b.close}]:[]).sort((a,b)=>a.time-b.time);
  const lookup = (time:number) => {
    if (!finite(time)) return null;
    let low=0,high=sorted.length;
    while(low<high) {const mid=(low+high)>>>1;if(sorted[mid]!.time+120_000<=time)low=mid+1;else high=mid;}
    const bar=sorted[low-1];
    return bar&&time-bar.time<=420_000?bar.close:null;
  };
  stableSpotIndexes.add(lookup);spotIndexes.set(bars, lookup);
  return lookup;
}

export function exposureValues(frame: ExposureFrame, mode: ExposureMode, spot: number | null, selectedStrikes?: ReadonlySet<number>, capturedDelta?: (strike:Strike,side:'call'|'put')=>number|undefined) {
  const result = new Map<number, number | null>();
  const calculations=new Map<number,string|null>();
  const side=mode==='gamma-call'?'call':mode==='gamma-put'?'put':null;
  const savedGamma=mode==='gamma'||side!==null;
  // Expiry/calendar conversion is shared by every strike of that expiry.
  const remainingByExpiry = savedGamma ? null : new Map(frame.profiles.map(p => [p.expiry, qqqGammaExpiryTime(p.expiry) - frame.time]));
  for (const p of frame.profiles) for (const s of selectedProfileStrikes(p.strikes,selectedStrikes)) {
    if (!finite(s.strike) || s.strike <= 0) continue;
    const complete=qqqGexDisplayStrikeValid(s);
    let value: number | null = mode === 'gamma' ? finite(s.totalGex)&&complete ? s.totalGex : null : 0;
    if(side)value=qqqGexDisplaySideValid(s,side)?side==='call'?s.callGex:-s.putGex:null;
    if (!savedGamma) {
      const remaining = remainingByExpiry!.get(p.expiry)!;
      if (!finite(spot) || spot <= 0 || !finite(remaining) || remaining <= 0 || (mode === 'charm' && remaining <= 60_000) || !complete) value = null;
      else for (const side of ['call','put'] as const) {
        const oi = side === 'call' ? s.callOi : s.putOi, iv = side === 'call' ? s.callIv : s.putIv;
        if (!finite(oi) || oi < 0 || (oi > 0 && !qqqIvUsable(iv))) { value = null; break; }
        if (!oi) continue;
        const args = { S: spot, K: s.strike, T: remaining / (365*86400_000), r: 0, sigma: iv!, type: side };
        // Capture may reuse Greeks priced at precisely this frame's spot/time.
        // Display/replay callers always reprice their chosen scenario normally.
        const saved=capturedDelta?.(s,side);
        const delta = finite(saved)?saved:blackScholesEngine.price(args).delta;
        // Same signed inventory hypothesis as the Gamma display: Call +, Put -.
        const sign = side === 'call' ? 1 : -1;
        const shift = 60_000;
        const change = mode === 'delta' ? delta : (blackScholesEngine.price({...args,T:(remaining-shift)/(365*86400_000)}).delta-delta)*60_000/shift;
        value! += sign * oi * 100 * spot * change;
      }
    }
    if (value !== null && !finite(value)) value = null;
    if(savedGamma) {
      const key=calculationKey(s);
      if(calculations.has(s.strike)&&(!key||calculations.get(s.strike)!==key))value=null;
      calculations.set(s.strike,key);
    }
    result.set(s.strike, result.has(s.strike) && result.get(s.strike) === null || value === null ? null : (result.get(s.strike) ?? 0) + value!);
  }
  return result;
}

/** Call OI - Put OI is a contract-count comparison, never dealer net positioning. */
export function exposureStrikeMetric(frame: ExposureFrame, metric: 'gex' | 'oi' | 'volume', selectedStrikes?: ReadonlySet<number>) {
  const values = new Map<number, number | null>();
  const calculations=new Map<number,string|null>();
  for (const p of frame.profiles) for (const s of selectedProfileStrikes(p.strikes,selectedStrikes)) {
    const a = metric === 'gex' ? s.totalGex : metric === 'oi' ? s.callOi : s.callVolume;
    const b = metric === 'gex' ? 0 : metric === 'oi' ? s.putOi : s.putVolume;
    let value = finite(a) && finite(b) && (metric !== 'gex' || qqqGexDisplayStrikeValid(s)) && (metric === 'gex' || a >= 0 && b >= 0) ? metric === 'volume' ? a+b : a-b : null;
    if(metric==='gex') {
      const key=calculationKey(s);
      if(calculations.has(s.strike)&&(!key||calculations.get(s.strike)!==key))value=null;
      calculations.set(s.strike,key);
    }
    values.set(s.strike, value === null || values.has(s.strike) && values.get(s.strike) === null ? null : (values.get(s.strike) ?? 0)+value!);
  }
  return values;
}

const concentrationCache = new WeakMap<ExposureFrame, number[]>();
/** Immutable capture levels: linear scan once, reused when replay revisits it. */
export function exposureConcentrationLevels(frame: ExposureFrame) {
  const cached=concentrationCache.get(frame);if(cached)return cached;
  const levels:number[]=[];
  for(const profile of frame.profiles){
    let call:typeof profile.strikes[number]|undefined,put:typeof call;
    for(const point of profile.strikes){
      if(!finite(point.callGex)||!finite(point.putGex))continue;
      if(!call||Math.abs(point.callGex)>Math.abs(call.callGex))call=point;
      if(!put||Math.abs(point.putGex)>Math.abs(put.putGex))put=point;
    }
    if(call)levels.push(call.strike);if(put)levels.push(put.strike);
  }
  concentrationCache.set(frame,levels);return levels;
}

export const exposureLookbacks = [10, 30, 60] as const;
/** Unknown metadata is not evidence of compatibility. OI/volume use contracts. */
function strikeCalculationSignatures(f: ExposureFrame, selectedStrikes?: ReadonlySet<number>) {
  const keys=new Map<number,string[]>();
  for(const p of f.profiles)for(const s of selectedProfileStrikes(p.strikes,selectedStrikes)) {
    const metadata=s as Strike & {calculationVersion?:string;gexUnit?:string};
    if(!metadata.calculationVersion || !metadata.gexUnit) { keys.set(s.strike,['unknown']); continue; }
    const prior=keys.get(s.strike)??[];
    if(!prior.includes('unknown'))keys.set(s.strike,[...prior,`${p.expiry}:${metadata.calculationVersion}:${metadata.gexUnit}`]);
  }
  return new Map([...keys].map(([strike,values])=>[strike,values.includes('unknown')?null:values.sort().join('|')]));
}
export type ExposureStrikeComparison = {
  current: number | null;
  history: Array<{ minutes: number; time: number | null; value: number | null }>;
  range: { min: number; max: number; count: number; from: number; to: number } | null;
};

/** Compare like-for-like expiry coverage, same ET day, and only observed frames.
 * Historical readings use the last snapshot BEFORE the target (at most 5 min old).
 * Missing contracts/expiries are never interpreted as zero or interpolated. */
export function exposureStrikeComparisons(frames: readonly ExposureFrame[], current: ExposureFrame, metric: 'gex' | 'oi' | 'volume', selectedStrikes?: ReadonlySet<number>) {
  const result = new Map<number, ExposureStrikeComparison>();
  const signature = (f: ExposureFrame) => f.profiles.map(p=>p.expiry).sort().join('|');
  const expected = signature(current), currentValues = exposureStrikeMetric(current, metric, selectedStrikes);
  const strikeCoverage = (f: ExposureFrame) => {
    const coverage = new Map<number,string[]>();
    for (const p of f.profiles) for (const s of selectedProfileStrikes(p.strikes,selectedStrikes)) coverage.set(s.strike,[...(coverage.get(s.strike)??[]),p.expiry]);
    return new Map([...coverage].map(([strike,expiries])=>[strike,expiries.sort().join('|')]));
  };
  const expectedStrikes = strikeCoverage(current);
  const expectedCalculations = strikeCalculationSignatures(current,selectedStrikes);
  const dayFrames = frames.filter(f=>finite(f.time) && f.time <= current.time && dateET(f.time) === dateET(current.time)).sort((a,b)=>a.time-b.time);
  const comparable = (f: ExposureFrame) => !current.missing.length && !f.missing.length && signature(f) === expected;
  const readings = dayFrames.map(f=>{
    const values=comparable(f)?exposureStrikeMetric(f,metric,selectedStrikes):new Map<number,number|null>();
    const coverage=strikeCoverage(f);
    const calculations=metric==='gex'?strikeCalculationSignatures(f,selectedStrikes):null;
    for(const strike of values.keys())if(coverage.get(strike)!==expectedStrikes.get(strike)
      || calculations && (!expectedCalculations.get(strike)||calculations.get(strike)!==expectedCalculations.get(strike)))values.set(strike,null);
    return {frame:f,values};
  });
  const history = exposureLookbacks.map(minutes=>{
    const target=current.time-minutes*60_000;
    // Select the actual preceding frame first: do not skip a missing frame to
    // resurrect an older good reading when collection/coverage changed.
    const reading=readings.findLast(r=>r.frame.time<=target);
    return {minutes,reading:reading && target-reading.frame.time<=300_000?reading:null};
  });
  for (const [strike,value] of currentValues) {
    const samples=readings.flatMap(r=>{const v=r.values.get(strike);return v!=null?[{time:r.frame.time,value:v}]:[];});
    result.set(strike,{
      current:value,
      history:history.map(h=>({minutes:h.minutes,time:h.reading?.frame.time??null,value:h.reading?.values.get(strike)??null})),
      range:samples.length>=2?{min:Math.min(...samples.map(s=>s.value)),max:Math.max(...samples.map(s=>s.value)),count:samples.length,from:samples[0]!.time,to:samples.at(-1)!.time}:null,
    });
  }
  return result;
}

/** Immutable history index for replay: prepare profile metadata once, then
 * query only the observed prefix. Keep the reference comparison above for parity. */
function exposureComparisonRow(frame:ExposureFrame,metric:'gex'|'oi'|'volume',selectedStrikes?:ReadonlySet<number>) {
    const coverage=new Map<number,string[]>();
    for(const p of frame.profiles)for(const s of selectedProfileStrikes(p.strikes,selectedStrikes)) {
      const values=coverage.get(s.strike)??[];values.push(p.expiry);coverage.set(s.strike,values);
    }
    return {frame,day:dateET(frame.time),signature:frame.profiles.map(p=>p.expiry).sort().join('|'),
      coverage:new Map([...coverage].map(([strike,values])=>[strike,values.sort().join('|')])),
      calculations:metric==='gex'?strikeCalculationSignatures(frame,selectedStrikes):null,
      values:exposureStrikeMetric(frame,metric,selectedStrikes)};
}
type ComparisonRow=ReturnType<typeof exposureComparisonRow>;
function comparisonLookup(frames:readonly ExposureFrame[],metric:'gex'|'oi'|'volume',selectedStrikes:ReadonlySet<number>|undefined,rows:ComparisonRow[]) {
  rows.sort((a,b)=>a.frame.time-b.frame.time);
  const byFrame=new Map(rows.map(r=>[r.frame,r]));
  return (current:ExposureFrame, queryStrikes?:ReadonlySet<number>)=>{
    const expected=byFrame.get(current);
    if(!expected)return exposureStrikeComparisons(frames,current,metric,queryStrikes??selectedStrikes);
    const readings=rows.filter(r=>r.frame.time<=current.time&&r.day===expected.day);
    const valueAt=(r:typeof expected,strike:number)=>{
      if(current.missing.length||r.frame.missing.length||r.signature!==expected.signature
        ||r.coverage.get(strike)!==expected.coverage.get(strike)
        ||r.calculations&&(!expected.calculations?.get(strike)||r.calculations.get(strike)!==expected.calculations.get(strike)))return null;
      return r.values.get(strike)??null;
    };
    const history=exposureLookbacks.map(minutes=>{
      const target=current.time-minutes*60_000,reading=readings.findLast(r=>r.frame.time<=target);
      return {minutes,reading:reading&&target-reading.frame.time<=300_000?reading:null};
    });
    const result=new Map<number,ExposureStrikeComparison>();
    for(const [strike,currentValue] of expected.values) {
      if(queryStrikes&&!queryStrikes.has(strike))continue;
      let min=Infinity,max=-Infinity,count=0,from=0,to=0;
      for(const r of readings) { const value=valueAt(r,strike);if(value===null)continue;
        min=Math.min(min,value);max=Math.max(max,value);if(!count)from=r.frame.time;to=r.frame.time;count++;
      }
      result.set(strike,{current:currentValue,history:history.map(h=>({minutes:h.minutes,time:h.reading?.frame.time??null,value:h.reading?valueAt(h.reading,strike):null})),range:count>=2?{min,max,count,from,to}:null});
    }
    return result;
  };
}

export function createExposureComparisonIndex(frames: readonly ExposureFrame[], metric: 'gex' | 'oi' | 'volume', selectedStrikes?: ReadonlySet<number>) {
  return comparisonLookup(frames,metric,selectedStrikes,frames.filter(f=>finite(f.time)).map(frame=>exposureComparisonRow(frame,metric,selectedStrikes)));
}

/** Shared kernels for visible heat cells and history marks. Yield between small
 * batches; cancelled preparations cannot publish a partly prepared field. */
export async function prepareExposureField(input:{frames:readonly ExposureFrame[];mode:ExposureMode;metric:'gex'|'oi'|'volume';spotAt:(time:number)=>number|null;selectedStrikes:ReadonlySet<number>;comparisons:boolean;activity:boolean},signal:AbortSignal,
  scheduler:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,0))) {
  const cells:Array<{frame:ExposureFrame;values:Map<number,number|null>}>=[],rows:ComparisonRow[]=[],activity:Array<{time:number;value:ReturnType<typeof exposureActivity>}>=[];
  let started=performance.now();
  for(let i=0;i<input.frames.length;i++){
    signal.throwIfAborted();const frame=input.frames[i]!;
    cells.push({frame,values:exposureValues(frame,input.mode,input.spotAt(frame.time),input.selectedStrikes)});
    if(input.comparisons&&finite(frame.time))rows.push(exposureComparisonRow(frame,input.metric,input.selectedStrikes));
    if(input.activity)activity.push({time:frame.time,value:exposureActivity(input.frames[i-1],frame)});
    if(performance.now()-started>=6){await scheduler();started=performance.now();}
  }
  signal.throwIfAborted();
  return {cells,activity,comparisonAt:input.comparisons?comparisonLookup(input.frames,input.metric,input.selectedStrikes,rows):null};
}

export function exposureActivity(previous: ExposureFrame | undefined, current: ExposureFrame) {
  if (!previous || !finite(current.time) || !finite(previous.time) || current.time <= previous.time || current.time-previous.time > 300_000 || dateET(previous.time) !== dateET(current.time) || current.missing.length || previous.missing.length) return null;
  const before = new Map(previous.profiles.flatMap(p=>p.strikes.map(s=>[`${p.expiry}:${s.strike}`,s] as const)));
  let call=0,put=0,count=0;
  for (const p of current.profiles) for (const s of p.strikes) {
    const old = before.get(`${p.expiry}:${s.strike}`);
    if (!old) return null;
    for (const side of ['call','put'] as const) {
      const a=side==='call'?old.callVolume:old.putVolume,b=side==='call'?s.callVolume:s.putVolume;
      if (!finite(a)||!finite(b)||a<0||b<a) return null;
      if(side==='call')call+=b-a;else put+=b-a;
    }
    count++;
  }
  if(count !== before.size || !count)return null;
  return {call,put,total:call+put};
}

/** Describes the trailing window only. No predictive probability or invented score. */
export function exposureVolatility(bars: readonly ExposureBar[], cutoff: number) {
  const window = bars.filter(b => Date.parse(b.timestamp)+120_000 <= cutoff && Date.parse(b.timestamp) >= cutoff-720_000).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).slice(-5);
  if(window.length !== 5 || cutoff-(Date.parse(window.at(-1)!.timestamp)+120_000)>120_000 || window.some((b,i)=>!finite(b.close)||b.close<=0||!finite(b.high)||!finite(b.low)||b.high!<b.low!||(i>0&&Date.parse(b.timestamp)-Date.parse(window[i-1]!.timestamp)!==120_000)))return null;
  const first=window[0]!.close, last=window.at(-1)!.close;
  const range=(Math.max(...window.map(b=>b.high!))-Math.min(...window.map(b=>b.low!)))/first*100;
  const travel=window.slice(1).reduce((sum,b,i)=>sum+Math.abs(b.close-window[i]!.close),0);
  return {rangePct:range,movePct:(last/first-1)*100,efficiency:travel>0?Math.abs(last-first)/travel:0};
}

const aggregateGammaArrays = new WeakMap<readonly ExposureFrame[], WeakMap<(time:number)=>number|null, Map<boolean,ExposureFrame[]>>>();
const aggregateGammaCache=new WeakMap<ExposureFrame,Map<number|null,ExposureFrame>>();
const normalizedGammaSpots=new WeakMap<ExposureFrame,number|null>();
const gammaExpiryTimes=new Map<string,number>();
function expiryTime(expiry:string){
  let time=gammaExpiryTimes.get(expiry);
  if(time===undefined){time=qqqGammaExpiryTime(expiry);gammaExpiryTimes.set(expiry,time);}
  return time;
}
/** Unknown saved units cannot be added. Reprice aggregate chains at one common
 * spot/time under the existing signed inventory model (r=q=0, $ per 1%). */
export async function prepareAggregateGammaFrames(frames:readonly ExposureFrame[],spotAt:(time:number)=>number|null,signal:AbortSignal,schedule=()=>new Promise<void>(resolve=>setTimeout(resolve,0)),normalizeSingle=false) {
  signal.throwIfAborted();
  const stable=stableSpotIndexes.has(spotAt)&&frames.every(immutableExposureFrame);
  let bySpot = stable?aggregateGammaArrays.get(frames):undefined;
  let modes = bySpot?.get(spotAt);
  const known = modes?.get(normalizeSingle);
  if (known) return known;
  const result:ExposureFrame[]=[];let started=performance.now();
  for(const frame of frames){
    signal.throwIfAborted();
    // Cached/compatible frames must obey the same cooperative work budget.
    if(performance.now()-started>=6){await schedule();started=performance.now();signal.throwIfAborted();}
    if(frame.profiles.length<2&&!normalizeSingle){result.push(frame);continue;}
    // A known single-expiry capture has no asynchronous aggregation problem.
    // Preserve its saved values; opt-in conversion still handles unknown units.
    if(frame.profiles.length===1){
      const savedKeys=new Set(frame.profiles[0]!.strikes.map(calculationKey));
      if(savedKeys.size===1&&!savedKeys.has(null)){result.push(frame);continue;}
    }
    const spot=spotAt(frame.time),cache=aggregateGammaCache.get(frame);
    if(normalizedGammaSpots.has(frame)&&normalizedGammaSpots.get(frame)===spot){result.push(frame);continue;}
    const cached=cache?.get(spot);
    if(cached){result.push(cached);continue;}
    // Saved version tags cannot establish valuation parity; only our own immutable output can.
    const profiles=frame.profiles.map(profile=>{
      const t=(expiryTime(profile.expiry)-frame.time)/(365*86400_000);
      const profileTime=profile.time??frame.time;
      const availableAt=finite(profileTime)?Date.parse(qqqImmutableDirectionalGexTime(new Date(profileTime).toISOString(),profile.strikes)):NaN;
      const valuationValid=finite(spot)&&spot>0&&t>0&&availableAt<=frame.time&&frame.time-profileTime<=300_000;
      return {...profile,strikes:profile.strikes.map(strike=>{
        let complete=!frame.missing.length&&valuationValid&&qqqGexDisplayStrikeValid(strike);
        const values={call:0,put:0};
        const sideComplete={call:valuationValid,put:valuationValid};
        for(const side of ['call','put'] as const){
          const oi=side==='call'?strike.callOi:strike.putOi,iv=side==='call'?strike.callIv:strike.putIv;
          if(!finite(oi)||oi<0||oi>0&&!qqqIvUsable(iv)){complete=false;sideComplete[side]=false;continue;}
          if(valuationValid&&oi>0){
            const gamma=blackScholesEngine.price({S:spot!,K:strike.strike,T:t,r:0,sigma:iv!,type:side}).gamma;
            values[side]=gamma*oi*spot!*spot!;
            if(!finite(values[side])){complete=false;sideComplete[side]=false;}
          }
        }
        return {...strike,callGex:values.call,putGex:values.put,totalGex:values.call-values.put,
          calculationVersion:'qqq-exposure-gamma-model-v1',gexUnit:'per-1pct' as const,inputComplete:complete,callInputComplete:sideComplete.call,putInputComplete:sideComplete.put};
      })};
    });
    const normalized={...frame,profiles};
    if(immutableExposureFrame(frame))immutableFrames.add(normalized);
    normalizedGammaSpots.set(normalized,spot);
    const entries=cache??new Map<number|null,ExposureFrame>();entries.set(spot,normalized);
    while(entries.size>2)entries.delete(entries.keys().next().value!);
    aggregateGammaCache.set(frame,entries);result.push(normalized);
    if(performance.now()-started>=6){await schedule();started=performance.now();}
  }
  signal.throwIfAborted();
  if(stable){
    if (!bySpot) { bySpot = new WeakMap(); aggregateGammaArrays.set(frames, bySpot); }
    if (!modes) { modes = new Map(); bySpot.set(spotAt, modes); }
    modes.set(normalizeSingle, result);
  }
  return result;
}
