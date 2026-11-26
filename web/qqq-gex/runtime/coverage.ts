import {qqqRegularBarIndex} from '../upstream/src/lib/qqqIntradayIndicators';
import {qqqMarketSession} from '../upstream/src/lib/qqqMarketSession';
/** Describe observed gaps only; no inference of a missing historical snapshot's values. */
export function archiveCoverage(date:string,rows:any[],bars:any[],input:any){
 const times=qqqRegularBarIndex(bars,date).map(b=>b.openedAt).sort((a,b)=>a-b),have=new Set(times),missingBarBuckets:string[]=[];
 if(times.length)for(let at=times[0]!;at<=times.at(-1)!;at+=120000)if(qqqMarketSession(new Date(at)).stocksOpen&&!have.has(at))missingBarBuckets.push(new Date(at).toISOString());
 const snapshotIntervals:any[]=[];for(const expiry of [...new Set(rows.map(r=>r.expiryDate))]){const captures=[...new Set(rows.filter(r=>r.expiryDate===expiry).map(r=>Date.parse(r.capturedAt)))].sort((a,b)=>a-b);for(let i=1;i<captures.length;i++)if(captures[i]!-captures[i-1]!>180000)snapshotIntervals.push({expiry,after:new Date(captures[i-1]!).toISOString(),before:new Date(captures[i]!).toISOString(),seconds:(captures[i]!-captures[i-1]!)/1000});}
 return {version:'qqq-observed-coverage-v1',date,fullDayCertified:false,observedCaptures:rows.length,observedExpiries:[...new Set(rows.map(r=>r.expiryDate))].sort(),requestedExpiries:input.expectedExpiries??null,missingSourceExpiries:input.missingExpiries??[],firstRegularBar:times.length?new Date(times[0]!).toISOString():null,lastRegularBar:times.length?new Date(times.at(-1)!).toISOString():null,missingBarBucketsWithinObservedSpan:missingBarBuckets,unobservedSnapshotIntervals:snapshotIntervals,issues:['Only supplied observations are covered; intervals outside the observed span and missing external blobs remain unknown','Snapshot gaps describe unavailable observations, not fabricated timestamps or values']};
}
