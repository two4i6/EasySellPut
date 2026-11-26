import { qqqGexProfileObservation, qqqImmutableGexProfileObservation, qqqGexTimesComparable, compareQqqGexValueMaps, type GexObservationSnapshot } from './qqqGexObservationComparison';
import { qqqGexInputQuality, qqqGexDisplayStrikeValid } from './qqqGexInputQuality';
import { qqqNetGexKing } from './qqqGexSummary';
import { isolateHistoricalGexDecision } from './qqqGexHistoricalIsolation';
import type { PcsGexExpiry, QqqPcsApiResponse } from '@/types/qqqGex';
import type { ExposureBar, ExposureFrame } from './qqqExposureWorkbench';
import type { QqqGammaModel } from './qqqGammaModel';
import { exposureGexUnit, exposureSpotIndex, immutableExposureFrame } from './qqqExposureWorkbench';

export type QqqExposureReplayContext = {
  date: string; selectedExpiry: string | null; scope: 'selected' | '0dte' | 'all';
  followingLatest: boolean; frame: ExposureFrame | null; bars: readonly ExposureBar[];
  frames?: readonly ExposureFrame[];
  /** Original OI provenance, before Gamma repricing replaces version metadata. */
  rawFrames?: readonly ExposureFrame[];
};

/** A common-time model may replace an incompatible saved aggregate only when
 * it covers every requested expiry. Never sum unknown legacy definitions. */
export function exposureReplayModelTotals(frame: ExposureFrame, model?: QqqGammaModel) {
  if (!model || frame.missing.length || model.excluded.length || Date.parse(model.asOf) !== frame.time || !frame.profiles.length) return null;
  const wanted = new Set(frame.profiles.map(profile => profile.expiry));
  if (wanted.size !== model.expiries.length || !model.expiries.every(expiry => wanted.has(expiry))) return null;
  const point = model.points.find(point => point.price === model.spot);
  if (!point || !Number.isFinite(point.gamma) || !Number.isFinite(point.grossGamma) || point.grossGamma < Math.abs(point.gamma)) return null;
  return { net: point.gamma, call: (point.grossGamma + point.gamma) / 2, put: (point.grossGamma - point.gamma) / 2 };
}

export function matchingExposureReplay(replay: QqqExposureReplayContext | null, date: string | null | undefined, expiry: string | null) {
  return replay && replay.date === date && replay.selectedExpiry === expiry ? replay : null;
}

const replayDateFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'});

const expiryReadings = new WeakMap<ExposureFrame, PcsGexExpiry[]>();

/** Display saved exposures only. Never inherit the newest decision or research labels. */
export function exposureReplayExpiries(frame: ExposureFrame): PcsGexExpiry[] {
  const cached = immutableExposureFrame(frame)?expiryReadings.get(frame):undefined;
  if (cached) return cached.slice();
  const day=Number.isFinite(frame.time)?Date.parse(replayDateFormatter.format(frame.time)):NaN;
  const result = frame.profiles.filter(profile=>(profile.time??frame.time)<=frame.time).map(profile => {
    const strikes = profile.strikes;
    const asOf = new Date(profile.time ?? frame.time).toISOString();
    const observation=immutableExposureFrame(frame)?qqqImmutableGexProfileObservation(strikes):qqqGexProfileObservation(strikes);
    let version: string | undefined, complete=strikes.length>0&&observation.unique&&observation.valid.length===strikes.length, netGex=0, callTotal=0, putTotal=0;
    let callWall: {strike:number;magnitude:number}|null=null, putWall: {strike:number;magnitude:number}|null=null, gammaFlip:number|null=null;
    for(const p of strikes) {
      const row=p as typeof p & {calculationVersion?:string;gexUnit?:string;inputComplete?:boolean};
      const key=`${row.calculationVersion??'legacy'}:${row.gexUnit??'unknown'}`;
      if(version===undefined)version=key;else if(version!==key)complete=false;
      if(row.inputComplete===false||!qqqGexDisplayStrikeValid(p)||!Number.isFinite(p.callGex)||!Number.isFinite(p.putGex)||!Number.isFinite(p.totalGex))complete=false;
      netGex+=p.totalGex;callTotal+=Math.max(0,p.totalGex);putTotal+=Math.min(0,p.totalGex);
      if(!callWall&&p.isCallWall)callWall={strike:p.strike,magnitude:Math.abs(p.callGex)};
      if(!putWall&&p.isPutWall)putWall={strike:p.strike,magnitude:Math.abs(p.putGex)};
      if(gammaFlip===null&&p.isGammaFlip)gammaFlip=p.strike;
    }
    const king = qqqNetGexKing(strikes, point => point.totalGex);
    const metadata = strikes[0] as typeof strikes[number] & { calculationVersion?: string; gexUnit?: string } | undefined;
    const summary = complete ? {
      netGex, callTotal, putTotal, callWall, putWall, king, gammaFlip,
      calculationVersion:metadata?.calculationVersion, gexUnit:metadata?.gexUnit,
    } : null;
    return { asOf, expiryDate:profile.expiry, dte:Math.round((Date.parse(profile.expiry)-day)/86400000), fullGexProfile:strikes,
      fullGexProfileHistory:[{time:asOf,strikes}], gexProfile:[], gexProfileHistory:[],
      gex:summary?[{time:asOf,totalGex:summary.netGex,gammaFlipLevel:summary.gammaFlip}]:[],
      gexSummary:summary, wallHistory:[], terminal:undefined, research:null };
  });
  if(immutableExposureFrame(frame))expiryReadings.set(frame, result);
  return result.slice();
}

export function exposureReplayDisplayPayload(base: QqqPcsApiResponse, replay: QqqExposureReplayContext): QqqPcsApiResponse {
  const time = replay.frame?.time;
  const asOf = time === undefined ? base.observedAt ?? base.asOf : new Date(time).toISOString();
  const expiries = replay.frame ? exposureReplayExpiries(replay.frame) : [];
  // Missing selected coverage must remain empty rather than borrow another DTE.
  const wanted = replay.scope === '0dte' ? replay.date : replay.selectedExpiry;
  if (wanted && !expiries.some(e=>e.expiryDate===wanted)) expiries.unshift({asOf,expiryDate:wanted,dte:0,gex:[],gexProfile:[],gexProfileHistory:[],fullGexProfile:[],fullGexProfileHistory:[],gexSummary:null,wallHistory:[]});
  const bars = time === undefined || exposureSpotIndex(replay.bars)(time)===null ? [] : replay.bars.filter(b=>Date.parse(b.timestamp)+120_000<=time);
  const reason='回放观察不携带最新交易资格';
  return { ...base, ...isolateHistoricalGexDecision(base, reason, asOf), asOf, observedAt:asOf, view:{mode:'historical',date:replay.date},
    intradaySessionAsOf:bars.at(-1)?.timestamp??null,
    intraday:base.intraday ? {...base.intraday,bars,extendedHoursBars:[],gexExpiries:expiries,
      gexAsOf:asOf,scoreSeries:[],gammaModels:undefined,gammaPositionHistory:[],terminal:null,directional:undefined,gexSummary:null,gex:[],gexProfile:[],gexProfileHistory:[],wallHistory:[],gexInsights:null} : null };
}

type ReplayRow = ReturnType<typeof exposureReplayTableRow>;
const replayRows = new WeakMap<ExposureFrame, Map<number | null, ReplayRow>>();

/** Precomputed once per archive, then replay just slices the causal prefix. */
export function exposureReplayTableRows(frames: readonly ExposureFrame[], bars: readonly ExposureBar[]) {
  const spotAt=exposureSpotIndex(bars);
  return frames.map(frame => {
    const spot = spotAt(frame.time);
    const immutable=immutableExposureFrame(frame);
    let readings = immutable?replayRows.get(frame):undefined;
    const cached = readings?.get(spot);
    if (cached) return cached;
    const row = exposureReplayTableRow(frame, spot);
    if(!immutable)return row;
    if (!readings) { readings = new Map(); replayRows.set(frame, readings); }
    readings.set(spot, row);
    while (readings.size > 2) readings.delete(readings.keys().next().value!);
    return row;
  });
}

function exposureReplayTableRow(frame: ExposureFrame, spot: number | null) {
    const expiries=exposureReplayExpiries(frame);
    const unit=exposureGexUnit(frame);
    const versions=new Set(expiries.map(e=>(e.gexSummary as (NonNullable<PcsGexExpiry['gexSummary']>&{calculationVersion?:string})|null)?.calculationVersion??'legacy'));
    const summaries=expiries.map(e=>e.gexSummary);
    const comparable=versions.size===1 && !versions.has('legacy') && (unit==='per-1pct'||unit==='per-point') && !frame.missing.length;
    const net=summaries.length&&summaries.every(Boolean)&&versions.size===1&&(expiries.length===1||comparable) ? summaries.reduce((sum,s)=>sum+s!.netGex,0) : null;
    const saved=frame.profiles.filter(p=>(p.time??frame.time)<=frame.time).flatMap(p=>p.strikes);
    const keys=new Set(saved.map(p=>{const metadata=p as typeof p & {calculationVersion?:string;gexUnit?:string};return `${metadata.calculationVersion}:${metadata.gexUnit}`;}));
    const observations=frame.profiles.filter(p=>(p.time??frame.time)<=frame.time).map(profile=>({profile,reading:immutableExposureFrame(frame)?qqqImmutableGexProfileObservation(profile.strikes):qqqGexProfileObservation(profile.strikes)}));
    const valid=observations.flatMap(p=>p.reading.valid);
    const partial=net===null&&valid.length>0&&keys.size===1&&observations.every(p=>p.reading.supported&&p.reading.unique);
    const coverage=observations.flatMap(({profile,reading})=>reading.valid.map(s=>`${profile.expiry}:${s.strike}`)).sort();
    const displayComparisonKey=(partial||net!==null&&comparable)&&!frame.missing.length&&coverage.length>0&&new Set(coverage).size===coverage.length
      ? JSON.stringify([partial?'partial':'complete',unit,[...keys].sort(),coverage]) : null;
    const displayDefinitionKey=displayComparisonKey===null?null:JSON.stringify([partial?'partial':'complete',unit,[...keys].sort(),frame.profiles.map(p=>p.expiry).sort()]);
    const displayValues=new Map(observations.flatMap(({profile,reading})=>reading.valid.map(s=>[`${profile.expiry}:${s.strike}`,s.totalGex] as const)));
    const strongest=(side:'callGex'|'putGex')=>valid.reduce<typeof valid[number]|null>((best,p)=>Math.abs(p[side])>Math.abs(best?.[side]??0)?p:best,null)?.strike??null;
    const displayNet=net??(partial?valid.reduce((sum,p)=>sum+p.totalGex,0):null);
    // Tables use precomputed scalar/coverage maps. Materialize a second copy
    // of full strike metadata only when a chart/export asks for observations.
    let observedProfile:GexObservationSnapshot['profile'];
    const observation:GexObservationSnapshot={time:new Date(frame.time).toISOString(),netGex:displayNet??NaN,inputComplete:!partial,comparisonKey:displayComparisonKey,definitionKey:displayDefinitionKey,
      get profile(){return observedProfile??=observations.flatMap(({profile})=>profile.strikes.map(s=>({...s,expiry:profile.expiry})));}};
    return {observation,displayComparisonKey,displayDefinitionKey,displayValues,displayNet,partial,validStrikes:valid.length,totalStrikes:saved.length,
      displayCall:expiries.length===1?(summaries[0]?.callWall?.strike??(partial?strongest('callGex'):null)):null,
      displayPut:expiries.length===1?(summaries[0]?.putWall?.strike??(partial?strongest('putGex'):null)):null,
      quality:qqqGexInputQuality(frame.profiles,frame.time),time:frame.time,spot,net,unit,comparisonKey:comparable?`${unit}:${[...versions].sort().join(',')}:${expiries.map(e=>e.expiryDate).sort().join(',')}`:null,expiries:expiries.map(e=>e.expiryDate),missing:frame.missing,
      call:expiries.length===1?summaries[0]?.callWall?.strike??null:null,
      put:expiries.length===1?summaries[0]?.putWall?.strike??null:null};
}

/** Adjacent same-session observations. Changing partial coverage compares only
 * common valid expiry/strike pairs, never the difference of unequal totals. */
export function exposureReplayDisplayDeltaDetails(row: ReturnType<typeof exposureReplayTableRows>[number], previous?: ReturnType<typeof exposureReplayTableRows>[number]) {
  const unavailable=(reason:string)=>({value:null as number|null,comparedStrikes:0,commonCoverage:false,reason});
  if(!previous)return unavailable('没有前一快照');
  if(!qqqGexTimesComparable(row.time,previous.time))return unavailable('快照间隔过长或不在同一交易日');
  if(row.displayComparisonKey===null||previous.displayComparisonKey===null||row.displayNet===null||previous.displayNet===null)return unavailable('缺少有效输入或到期日覆盖');
  const equalCoverage=row.displayComparisonKey===previous.displayComparisonKey;
  if(!equalCoverage&&(!row.partial||!previous.partial||row.displayDefinitionKey!==previous.displayDefinitionKey))return unavailable('计算口径或到期日范围发生变化');
  const compared=compareQqqGexValueMaps(row.displayValues,previous.displayValues);
  return compared?{value:compared.delta,comparedStrikes:compared.comparedStrikes,commonCoverage:!equalCoverage,reason:null}:unavailable('没有共同有效的行权价');
}

export function exposureReplayDisplayDelta(row: ReturnType<typeof exposureReplayTableRows>[number], previous?: ReturnType<typeof exposureReplayTableRows>[number]): number | null {
  return exposureReplayDisplayDeltaDetails(row,previous).value;
}
