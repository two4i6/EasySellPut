import {qqqGexObservationStrikeValid,qqqLosslessGexDefinitionSupported} from './qqqGexInputQuality';
import {qqqEasternDateKey} from './qqqMarketDate';
export type GexObservationStrike={expiry?:string;strike:number;callOi?:number;putOi?:number;callIv?:number;putIv?:number;callGex?:number;putGex?:number;totalGex?:number;calculationVersion?:string;gexUnit?:string;inputComplete?:boolean;computedAt?:string;callReceivedAt?:string;putReceivedAt?:string};
export type GexObservationSnapshot={time:string;netGex:number;calculationVersion?:string;inputComplete?:boolean;profile?:readonly GexObservationStrike[];comparisonKey?:string|null;definitionKey?:string|null};
/** Saved observations and normalized replay models retain distinct definitions. */
export function qqqGexProfileObservation<T extends GexObservationStrike>(profile: readonly T[]) {
 const supported=profile.length>0&&profile.every(p=>qqqLosslessGexDefinitionSupported(p)||p.calculationVersion==='qqq-exposure-gamma-model-v1'&&p.gexUnit==='per-1pct');
 const definitions=new Set(profile.map(p=>`${p.calculationVersion}:${p.gexUnit}`));
 const unique=new Set(profile.map(p=>p.expiry?`${p.expiry}:${p.strike}`:p.strike)).size===profile.length;
 const valid=profile.filter(p=>p.strike>0&&Number.isFinite(p.strike)&&qqqGexObservationStrikeValid(p)&&[p.callGex,p.putGex,p.totalGex].every(Number.isFinite));
 return {valid,unique,supported:supported&&definitions.size===1};
}
type ProfileReading<T>={valid:T[];unique:boolean;supported:boolean};
const archiveReadings=new WeakMap<readonly GexObservationStrike[],ProfileReading<GexObservationStrike>>();
/** Opt-in only for owned immutable archive profiles. Generic capture readers
 * continue to observe corrections made while their inputs are constructed. */
export function qqqImmutableGexProfileObservation<T extends GexObservationStrike>(profile:readonly T[]):ProfileReading<T>{
 let reading=archiveReadings.get(profile);
 if(!reading){reading=qqqGexProfileObservation(profile);archiveReadings.set(profile,reading);}
 return reading as ProfileReading<T>;
}
export function qqqGexTimesComparable(now:number,before:number) {
 return Number.isFinite(now)&&Number.isFinite(before)&&now>before&&now-before<=300000&&qqqEasternDateKey(now)===qqqEasternDateKey(before);
}
/** Sum both observations over exactly the same contracts. */
export function compareQqqGexValueMaps<K>(current:ReadonlyMap<K,number>,previous:ReadonlyMap<K,number>) {
 let currentNet=0,previousNet=0,count=0;
 for(const [key,value] of current){const prior=previous.get(key);if(prior!==undefined){currentNet+=value;previousNet+=prior;count++;}}
 return count?{delta:currentNet-previousNet,currentNet,previousNet,comparedStrikes:count,commonCoverage:count!==current.size||count!==previous.size}:null;
}
/** Reconstruct supported saved or normalized observations without inventing missing inputs. */
export function qqqGexObservation(snapshot:GexObservationSnapshot){
 return readObservation(snapshot,false);
}
export function qqqImmutableGexObservation(snapshot:GexObservationSnapshot){
 return readObservation(snapshot,true);
}
function readObservation(snapshot:GexObservationSnapshot,immutable:boolean){
 const profile=snapshot.profile;
 const reading=immutable?qqqImmutableGexProfileObservation(profile??[]):qqqGexProfileObservation(profile??[]);
 const supported=reading.supported;
 if(!supported)return snapshot.inputComplete===false || profile?.some(p=>p.inputComplete===false||p.calculationVersion==='qqq-exposure-gamma-model-v1'||qqqLosslessGexDefinitionSupported({...p,gexUnit:'per-1pct'}))?null:{net:snapshot.netGex,partial:false,values:null,version:snapshot.calculationVersion??'legacy'};
 if(!reading.unique)return null;
 const valid=reading.valid;
 if(!valid.length)return null;
 return {net:valid.reduce((sum,p)=>sum+p.totalGex!,0),partial:snapshot.inputComplete===false||profile!.some(p=>p.inputComplete===false)||valid.length!==profile!.length,
  values:new Map<string|number,number>(valid.map(p=>[p.expiry?`${p.expiry}:${p.strike}`:p.strike,p.totalGex!])),version:profile![0].calculationVersion!};
}
/** No cross-day, stale, unknown-definition or unequal-coverage subtraction. */
export function compareQqqGexObservations(current:GexObservationSnapshot,previous?:GexObservationSnapshot|null){
 if(!previous)return null;
 const now=Date.parse(current.time),before=Date.parse(previous.time);
 if(!qqqGexTimesComparable(now,before))return null;
 const a=qqqGexObservation(current),b=qqqGexObservation(previous);
 if(!a||!b||a.version!==b.version)return null;
 if(a.values&&b.values){
  const compared=compareQqqGexValueMaps(a.values,b.values);
  return compared?{delta:compared.delta,currentNet:compared.currentNet,previousNet:compared.previousNet,comparedStrikes:compared.comparedStrikes,partial:a.partial||b.partial||compared.commonCoverage}:null;
 }
 return !a.partial&&!b.partial&&Number.isFinite(a.net)&&Number.isFinite(b.net)?{delta:a.net-b.net,currentNet:a.net,previousNet:b.net,comparedStrikes:null,partial:false}:null;
}

/** Display comparisons retain coverage-mode and expiry guards without changing engine compatibility. */
export function compareQqqGexDisplayObservations(current:GexObservationSnapshot,previous?:GexObservationSnapshot|null) {
 if(!previous)return null;
 const a=qqqGexObservation(current),b=qqqGexObservation(previous);
 if(!a||!b)return null;
 if(current.comparisonKey!==undefined||previous.comparisonKey!==undefined){
  if(current.comparisonKey==null||previous.comparisonKey==null)return null;
  if(current.comparisonKey!==previous.comparisonKey&&(!a.partial||!b.partial||current.definitionKey!==previous.definitionKey))return null;
 }else if(a.partial!==b.partial)return null;
 return compareQqqGexObservations(current,previous);
}
