import { exposureWindowVersion } from './qqqExposureArchive';
import { supabaseAdmin } from './supabase';
import { qqqMarketDateBounds as exposureDayBounds } from './qqqMarketDate';
import { projectExposureHistory, readConsistentExposureRows, type ExposureHistoryRow, type ExposureHistoryDay } from './qqqExposureHistoryModel';
import {readQqqChartSource,readQqqChartWindowSource,isChartSourceRolloutMissing,qqqChartSourceMetrics} from './qqqChartSource';

/** Shared revision contract for full reads and inexpensive cache validation. */
export async function readQqqExposureRevision(signal:AbortSignal):Promise<string> {
  const result=await supabaseAdmin.from('qqq_gex_display_revision').select('revision').eq('id',true).abortSignal(signal).single();
  if(result.error || result.data?.revision==null)throw new Error('Exposure revision unavailable');
  return String(result.data.revision);
}

/** Dedicated full-profile path; the overview's Top-8 projection stays lightweight. */
export async function readQqqExposureHistory(date:string,expiryDate:string|null,onTiming?:(stage:string,milliseconds:number)=>void,concurrency=expiryDate?1:2,window?:{from:string;to:string;version?:string}):Promise<ExposureHistoryDay> {
 const start=performance.now();
 try {
  const source=await (window?readQqqChartWindowSource(date,expiryDate,window.from,window.to):readQqqChartSource(date,expiryDate));
  if(window?.version && await exposureWindowVersion(source.manifest)!==window.version)throw Error('Source changed during exposure read');
  if(process.env.QQQ_SOURCE_DIAGNOSTICS==='1')console.info('QQQ chart source totals',{...qqqChartSourceMetrics});
  const {from,to}=window??exposureDayBounds(date),observedAt=new Date().toISOString();
  const upper=new Date(Math.min(Date.parse(to),Date.parse(observedAt))).toISOString();
  const bars=source.bars.filter(bar=>Date.parse(bar.bar_at)+120000<=Date.parse(observedAt)).map(bar=>{
   if(![bar.open,bar.high,bar.low,bar.close].every(n=>Number.isFinite(n)&&n>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||!Number.isFinite(Number(bar.volume))||Number(bar.volume)<0)throw Error('Invalid exposure candle');
   return {timestamp:bar.bar_at,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:Number(bar.volume)};
  });
  return {date,observedAt,revision:'scoped:'+source.manifest.revision,
   items:projectExposureHistory(source.rows.filter(row=>Date.parse(row.captured_at)<Date.parse(upper)) as unknown as ExposureHistoryRow[],from,upper),bars};
 } catch(error) {if(!isChartSourceRolloutMissing(error))throw error;}
 finally {onTiming?.('incremental_source',performance.now()-start);}
 return readLegacyQqqExposureHistory(date,expiryDate,onTiming,concurrency,window);
}
export async function readLegacyQqqExposureHistory(date:string,expiryDate:string|null,onTiming?:(stage:string,milliseconds:number)=>void,concurrency=expiryDate?1:2,window?:{from:string;to:string;version?:string}):Promise<ExposureHistoryDay> {
  const {from,to}=window??exposureDayBounds(date), controller=new AbortController();
  // A complete nine-expiry day is ~100 MB before compression. Keep the read
  // bounded, but do not discard an otherwise healthy cold load near 40 s.
  const timeout=setTimeout(()=>controller.abort(),expiryDate?25_000:90_000);
  // Full archives need smaller pages: increasing these to 128 caused a real
  // cold-read failure. Bound payloads and overlap at most two profile reads.
  const pageSize=expiryDate?128:64;
  const observedAt=new Date().toISOString(), upper=new Date(Math.min(Date.parse(to),Date.parse(observedAt))).toISOString();
  try {
    const revision=()=>readQqqExposureRevision(controller.signal);
    const readCandles=async()=>{
      const start=performance.now();
      try{return await supabaseAdmin.from('qqq_intraday_candle').select('bar_at,open,high,low,close,volume')
        .eq('symbol','QQQ').eq('interval_seconds',120).gte('bar_at',from).lt('bar_at',upper)
        .order('bar_at',{ascending:true}).range(0,999).abortSignal(controller.signal);}
      finally{onTiming?.('candles_db',performance.now()-start);}
    };
    let candlesTask:ReturnType<typeof readCandles>|undefined;
    // Read narrow keys once. Profile pages seek directly to a known composite
    // key instead of repeatedly OFFSET-scanning large toasted JSON profiles.
    const readKeys=async()=>{
      const start=performance.now(),keys:Array<{captured_at:string;expiry_date:string}>=[];
      try {
        for(let offset=0;offset<16_384;offset+=1000){
          let query=supabaseAdmin.from('qqq_gex_expiry_snapshot').select('captured_at,expiry_date')
            .eq('symbol','QQQ').eq('policy_id','qqq-pcs-intraday-v1').gte('captured_at',from).lt('captured_at',upper);
          if(expiryDate)query=query.eq('expiry_date',expiryDate);
          const page=await query.order('captured_at',{ascending:true}).order('expiry_date',{ascending:true}).range(offset,Math.min(offset+999,16_383)).abortSignal(controller.signal);
          if(page.error)throw new Error('Exposure page index unavailable');
          keys.push(...(page.data??[]));
          if((page.data?.length??0)<1000)return keys;
        }
        throw new Error('Exposure day exceeds bounded read budget');
      }finally{onTiming?.('profile_index_db',performance.now()-start);}
    };
    let keysTask:ReturnType<typeof readKeys>|undefined;
    const profilesStart=performance.now();
    const result=await readConsistentExposureRows(async offset=>{
      // Page zero begins only after the opening revision. Each whole-read
      // retry gets its own candle read, under that same revision contract.
      if(offset===0){candlesTask=readCandles();void candlesTask.catch(()=>{});keysTask=readKeys();}
      const key=(await keysTask!)[offset];
      if(!key)return [];
      let query=supabaseAdmin.from('qqq_gex_expiry_snapshot').select('captured_at,expiry_date,dte,profile')
        .eq('symbol','QQQ').eq('policy_id','qqq-pcs-intraday-v1').gte('captured_at',key.captured_at).lt('captured_at',upper)
        .or(`captured_at.gt.${key.captured_at},and(captured_at.eq.${key.captured_at},expiry_date.gte.${key.expiry_date})`);
      if(expiryDate)query=query.eq('expiry_date',expiryDate);
      const page=await query.order('captured_at',{ascending:true}).order('expiry_date',{ascending:true})
        .limit(pageSize).abortSignal(controller.signal);
      if(page.error)throw new Error(`Full exposure history unavailable (${page.error.code||'transport'}, offset ${offset})`);
      return (page.data??[]) as ExposureHistoryRow[];
    },revision,pageSize,concurrency);
    onTiming?.('profiles_db',performance.now()-profilesStart);
    if(!candlesTask)throw new Error('Exposure candle read did not start');
    const candles=await candlesTask;
    if(candles.error)throw new Error('Exposure candles unavailable');
    // Include candles in the same revision contract as profiles.
    if(await revision()!==result.revision)throw new Error('Exposure prices changed during read');
    const bars=(candles.data??[]).map(b=>{
      if(!Number.isFinite(Date.parse(b.bar_at))||![b.open,b.high,b.low,b.close].every(n=>Number.isFinite(n)&&n>0)
        ||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)
        ||!Number.isFinite(Number(b.volume))||Number(b.volume)<0)throw new Error('Invalid exposure candle');
      return {timestamp:b.bar_at,open:b.open,high:b.high,low:b.low,close:b.close,volume:Number(b.volume)};
    });
    return {date,observedAt,revision:result.revision,items:projectExposureHistory(result.rows,from,upper),bars};
  } finally { clearTimeout(timeout);controller.abort(); }
}
