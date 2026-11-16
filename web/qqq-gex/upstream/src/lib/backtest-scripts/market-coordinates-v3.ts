/** Pure as-of observation arithmetic. No admission, volatility thresholds or data loading. */
import type {StrategyObject} from './strategy-module-v2';
export const observationNumber=(o:Readonly<StrategyObject>,key:string)=>typeof o[key]==='number'?Number(o[key]):undefined;
/** Exact inherited raw-term comparison; no additional finite/positive coercion. */
export function isObservationBackwardation(primary:number,term?:number):boolean{return term!=null&&term<primary;}
/** Multiplication order is a versioned numerical contract; do not algebraically reorder. */
export function scalePrimaryVolatilityTerm(primary:number,vix:number,rawTerm:number){return primary*rawTerm/vix;}
export function relativeObservationChange(current:number|undefined,previous:number|undefined){
  return current!==undefined&&previous!==undefined&&previous>0?(current-previous)/previous:undefined;
}
export function resolveVolatilityCoordinates(macro:Readonly<StrategyObject>,policy:{positiveVixRequired:boolean;rawTermFallback:boolean;coerceVix?:boolean}){
  const vix=policy.coerceVix?Number(macro.vix):observationNumber(macro,'vix');
  const primaryVol=observationNumber(macro,'vxn')??vix;
  const rawTerm=observationNumber(macro,'vix3m');
  const primaryVol3m=primaryVol!==undefined&&vix!==undefined&&rawTerm!==undefined&&(!policy.positiveVixRequired||vix>0)
    ?scalePrimaryVolatilityTerm(primaryVol,vix,rawTerm):policy.rawTermFallback?rawTerm:undefined;
  const history=macro.vxnHistory as number[]|undefined;
  const previous=history&&history.length>=6?history.at(-6):undefined;
  const change=previous!==undefined&&previous>0?relativeObservationChange(history!.at(-1),previous)
    :relativeObservationChange(primaryVol,observationNumber(macro,'vix5dAgo'));
  return {primaryVol,primaryVol3m,primaryTermSlope:primaryVol!==undefined&&primaryVol3m!==undefined?primaryVol3m-primaryVol:undefined,
    primaryChange5d:change};
}
