import type { ExposureBar } from './qqqExposureWorkbench';

const merged = new WeakMap<readonly ExposureBar[], WeakMap<readonly ExposureBar[], ExposureBar[]>>();
const recent: Array<WeakRef<ExposureBar[]>> = [];
const sameBar = (a: ExposureBar, b: ExposureBar) => {
  const keys=Object.keys(a) as Array<keyof ExposureBar>;
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&Object.is(a[key],b[key]));
};

/** Live corrections win ties. Equal immutable candles across scopes retain the
 * same array, so changing DTE does not invalidate every price-dependent index. */
export function mergeExposureBars(archive: readonly ExposureBar[], live: readonly ExposureBar[]) {
  let byLive=merged.get(archive);
  const known=byLive?.get(live);if(known)return known;
  const byTime=new Map(archive.map(bar=>[bar.timestamp,bar]));
  for(const bar of live)byTime.set(bar.timestamp,bar);
  let result=[...byTime.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  for(let i=recent.length-1;i>=0;i--){
    const previous=recent[i]!.deref();
    if(!previous){recent.splice(i,1);continue;}
    if(previous.length===result.length&&result.every((bar,j)=>sameBar(bar,previous[j]!))){result=previous;break;}
  }
  if(!recent.some(ref=>ref.deref()===result)){recent.push(new WeakRef(result));if(recent.length>4)recent.shift();}
  if(!byLive){byLive=new WeakMap();merged.set(archive,byLive);}byLive.set(live,result);
  return result;
}
