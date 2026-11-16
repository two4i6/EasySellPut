import type { ExposureBar } from './qqqExposureWorkbench';
import type { CompactGexStrike } from './qqqGexHistory';
import { qqqChartProfile } from './qqqChartProfile';
import type { PcsGexExpiry } from '@/types/qqqGex';

export type ExposureHistoryRow = { captured_at: string; expiry_date: string; dte: number; profile: CompactGexStrike[] };
export type ExposureHistoryDay = {
  date: string; observedAt: string; revision: string;
  items: Array<{ capturedAt: string; expiryDate: string; dte: number; profile: CompactGexStrike[] }>;
  bars: ExposureBar[];
};

const etDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'});
type Merged=PcsGexExpiry[];
const mergedDays=new WeakMap<ExposureHistoryDay,WeakMap<readonly PcsGexExpiry[],Map<string,Merged>>>();
const mergedLive=new WeakMap<readonly PcsGexExpiry[],Map<string,Merged>>();

/** Full history wins same-bucket ties; newer live captures remain visible. */
export function mergeExposureHistory(day:ExposureHistoryDay|null,live:readonly PcsGexExpiry[],date:string) {
  let owners=day?mergedDays.get(day):null;
  if(day&&!owners){owners=new WeakMap();mergedDays.set(day,owners);}
  const owner=owners??mergedLive;
  let dates=owner.get(live);
  const cached=dates?.get(date);if(cached)return cached;
  const belongs=(time:string)=>etDateFormatter.format(new Date(time))===date;
  const groups=new Map<string,Map<string,PcsGexExpiry['fullGexProfile']>>();
  const append=(expiry:string,time:string,profile:PcsGexExpiry['fullGexProfile'],overwrite=false)=>{
    if(!Number.isFinite(Date.parse(time))||!belongs(time)||!profile.length)return;
    const points=groups.get(expiry)??new Map();
    const key=new Date(time).toISOString();
    if(overwrite||!points.has(key))points.set(key,profile);
    groups.set(expiry,points);
  };
  for(const e of live) {
    for(const p of e.fullGexProfileHistory)if(p.strikeCoverage!=='top8')append(e.expiryDate,p.time,p.strikes);
    append(e.expiryDate,e.asOf,e.fullGexProfile,true);
  }
  for(const row of day?.date===date?day.items:[])append(row.expiryDate,row.capturedAt,row.profile,true);
  const result=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([expiryDate,points]):PcsGexExpiry=>{
    const history=[...points].sort(([a],[b])=>Date.parse(a)-Date.parse(b)).map(([time,strikes])=>({time,strikes}));
    const latest=history.at(-1)!;
    return {expiryDate,asOf:latest.time,dte:live.find(e=>e.expiryDate===expiryDate)?.dte??Math.round((Date.parse(expiryDate)-Date.parse(date))/86400_000),
      fullGexProfile:latest.strikes,fullGexProfileHistory:history,gex:[],gexProfile:[],gexProfileHistory:[],wallHistory:[],gexSummary:null};
  });
  dates??=new Map();dates.set(date,result);while(dates.size>4)dates.delete(dates.keys().next().value!);owner.set(live,dates);
  return result;
}

/** Full strike coverage, lossless values, no guessed version/IV/receipt metadata. */
export function projectExposureHistory(rows: readonly ExposureHistoryRow[], from: string, to: string) {
  const start = Date.parse(from), end = Date.parse(to);
  const seen = new Set<string>();
  return rows.map(row => {
    const time = Date.parse(row.captured_at), key = `${row.captured_at}:${row.expiry_date}`;
    if (!Number.isFinite(time) || time < start || time >= end || !/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date)
      || !Number.isFinite(row.dte) || !Array.isArray(row.profile) || seen.has(key)) throw new Error('Invalid/duplicate exposure snapshot');
    seen.add(key);
    if (row.profile.some(s => !Number.isFinite(s.strike) || s.strike <= 0 || ![s.callGex,s.putGex,s.totalGex].every(Number.isFinite))
      || new Set(row.profile.map(s=>s.strike)).size !== row.profile.length) throw new Error('Invalid/duplicate exposure strike');
    return { capturedAt: row.captured_at, expiryDate: row.expiry_date, dte: row.dte, profile: qqqChartProfile(row.profile) };
  }).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.expiryDate.localeCompare(b.expiryDate));
}

/** A changing multi-page read is retried as a whole, never published partially. */
export async function readConsistentExposureRows(
  loadPage: (offset:number) => Promise<ExposureHistoryRow[]>,
  readRevision: () => Promise<string>,
  pageSize = 128,
  concurrency = 1,
) {
  if(!Number.isSafeInteger(pageSize)||pageSize<1||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('Invalid exposure pagination budget');
  for (let attempt=0; attempt<2; attempt++) {
    const before=await readRevision(), rows:ExposureHistoryRow[]=[];
    for (let offset=0; ; offset+=pageSize*concurrency) {
      if(offset>=16_384)throw new Error('Exposure day exceeds bounded read budget');
      const offsets=Array.from({length:concurrency},(_,i)=>offset+i*pageSize).filter(i=>i<16_384);
      const results=await Promise.allSettled(offsets.map(loadPage));
      const failure=results.find(r=>r.status==='rejected');
      if(failure?.status==='rejected')throw failure.reason;
      const pages=results.map(r=>r.status==='fulfilled'?r.value:[]);
      let ended=false;
      for(const page of pages) {
        if(page.length>pageSize||ended&&page.length)throw new Error('Unexpected/noncontiguous exposure page size');
        rows.push(...page);if(page.length<pageSize)ended=true;
      }
      if(ended)break;
    }
    const after=await readRevision();
    if(before===after)return {rows,revision:after};
  }
  throw new Error('Exposure history changed during read; retry');
}
