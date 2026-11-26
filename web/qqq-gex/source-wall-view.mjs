import {readFile} from 'node:fs/promises';import path from 'node:path';
// Original UI presentation expressions; source changes fail extraction rather than silently diverge.
export async function sourceWallView(root){
 const text=await readFile(path.join(root,'upstream/src/components/Strategy/qqq/terminal/QqqWallTouchStatsCard.tsx'),'utf8');
 const filter=text.match(/prepared!\.events\.filter\((event => event\.dte[\s\S]*?)\) : \[\],/)?.[1];
 const histogram=text.match(/  const values = events\.map\(event => event\.endingMove\)[\s\S]*?(?=  const max =)/)?.[0];
 if(!filter||!histogram)throw Error('Pinned wall-touch UI projection extraction failed');
 return {loader:'ts',resolveDir:root,contents:`import {summarizeWallTouches} from './upstream/src/lib/qqqWallTouchStats';
 export function wallTouchView(source:any[],dte:number,horizon:number,gamma:string,period:string,side:string,statsKnown:boolean){
 const events=statsKnown?source.filter(${filter}):[];const summary=statsKnown?summarizeWallTouches(events):null;let histogram=null;
 if(events.length){${histogram} histogram={values,low,high,span,bins};}
 return {statsKnown,filters:{dte,horizon,gamma,period,side},events,summary,histogram,table:events.slice(-8).reverse(),tableDisplayLimit:8,allFilteredEventsRetained:true};}`};
}
