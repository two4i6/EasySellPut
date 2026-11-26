import {exposureReplayTableRows as originalRows} from '../upstream/src/lib/qqqExposureReplay';
import {exposureSpotIndex,type ExposureFrame} from '../upstream/src/lib/qqqExposureWorkbench';
export * from '../upstream/src/lib/qqqExposureReplay';
/** A presentation column, not the original spot input to any financial kernel. */
export function exposureReplayTableRows(frames:readonly ExposureFrame[],bars:readonly any[]){
 const original=originalRows(frames,bars),lookup=exposureSpotIndex(bars);
 const sorted=bars.filter(b=>Number.isFinite(Date.parse(b.timestamp))&&Number.isFinite(b.close)&&b.close>0).slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 return original.map((row,index)=>{
  const frame=frames[index],times=new Set(frame.profiles.flatMap(p=>p.strikes.map((s:any)=>s.computedAt).filter((time:any)=>typeof time==='string'&&Number.isFinite(Date.parse(time)))).map(Date.parse));
  const model=times.size===1?[...times][0]:null,legacy=times.size===0;
  const cutoff=legacy?frame.time:model;
  const usable=cutoff!==null&&cutoff<=frame.time;
  const price=usable?lookup(cutoff):null;
  const bar=price===null?null:sorted.filter(b=>Date.parse(b.timestamp)+120000<=cutoff!).at(-1);
  return {...row,valuationReference:{price,valuationAt:cutoff===null?null:new Date(cutoff).toISOString(),barOpenedAt:bar?.timestamp??null,barClosedAt:bar?new Date(Date.parse(bar.timestamp)+120000).toISOString():null,availableAt:new Date(frame.time).toISOString(),basis:legacy?'legacy-availability-closed-stock-bar':'model-time-closed-stock-bar',optionQuoteAt:null,reason:!usable?'missing-or-mixed-model-times':price===null?'missing-or-stale-valuation-bar':null}};
 });
}
