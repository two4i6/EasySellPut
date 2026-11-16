import {qqqClosedExposureConditional,qqqExposureEtag,qqqExposureRequestValidator} from '@/lib/qqqExposureValidator';
import {qqqSourceMetadataCache} from '@/lib/qqqSourceMetadataCache';
import { readQqqExposureHistory, readQqqExposureRevision } from '@/lib/qqqExposureHistory';
import { qqqMarketDateBounds as exposureDayBounds } from '@/lib/qqqMarketDate';
import { canonicalJsonRequestKey, createResponseCache } from '@/lib/responseCache';
import {readQqqChartSourceRevision,readQqqChartWindowRevision,readQqqExposureManifest,readQqqExposurePrices} from '@/lib/qqqChartSource';
import {redisResponseCachePort} from '@/lib/embeddedRedisCache';
import {encodeExposureWire,serializeExposureWire} from '@/lib/qqqExposureWire';
import { exposureArchiveManifest, exposureArchiveWindow } from '@/lib/qqqExposureArchive';
import {exposureReadFailure} from '@/lib/qqqChartRpc';

// Full all-expiry days exceed 32 MB uncompressed. Retain only losslessly
// compressed envelopes within a fixed process budget, never duplicate DB rows.
const responses=createResponseCache({generation:qqqSourceMetadataCache.generation,shared:redisResponseCachePort('qqq-exposure-http-v1',128*1024*1024),validateFresh:true,maxEntries:16,maxBytes:32*1024*1024,maxEntryBytes:24*1024*1024,maxBodyBytes:128*1024*1024,
  revalidate:async(key,headers)=>{
    const previous=headers.get('x-qqq-exposure-revision');
    if(previous?.startsWith('scoped:')){const {date,expiryDate,window}=JSON.parse(key);return previous===await (window?readQqqChartWindowRevision(window.from,window.to,expiryDate,true):readQqqChartSourceRevision(date,expiryDate,true));}
    return previous!==null&&await readQqqExposureRevision(AbortSignal.timeout(3000))===previous;
  }});
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams,date=params.get('date')??'',expiryDate=params.get('expiryDate'),format=params.get('format');
  if(format!==null&&!['rows-v1','lines-v1','lines-v2','manifest-v1','manifest-v2'].includes(format))return Response.json({error:'Unsupported exposure format'},{status:400});
  let end:number,window:(NonNullable<ReturnType<typeof exposureArchiveWindow>> & {version?:string})|undefined;
  try {
    end=Date.parse(exposureDayBounds(date).to);
    if(expiryDate)exposureDayBounds(expiryDate);
    window=exposureArchiveWindow(date,params.get('from'),params.get('to'));
    if(params.has('source')){const version=params.get('source')!;if(!window||!/^([a-f0-9]{64})$/.test(version))throw Error('Invalid source version');window.version=version;}
  } catch { return Response.json({error:'请选择有效日期与到期日'},{status:400}); }
  if(format==='manifest-v1'||format==='manifest-v2'){
    if(window)return Response.json({error:'Manifest requires a full date'},{status:400});
    try{
      const source=await readQqqExposureManifest(date,expiryDate);
      let bars;
      if(format==='manifest-v2'){
        const prices=await readQqqExposurePrices(date,expiryDate);
        if(prices.manifest.revision!==source.revision)throw Error('Source changed during price bootstrap');
        bars=prices.bars.map(bar=>{
          if(![bar.open,bar.high,bar.low,bar.close].every(n=>Number.isFinite(n)&&n>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close)||!Number.isFinite(Number(bar.volume))||Number(bar.volume)<0)throw Error('Invalid exposure candle');
          return {timestamp:bar.bar_at,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:Number(bar.volume)};
        });
      }
      return Response.json(await exposureArchiveManifest(date,source,undefined,bars),{headers:{'cache-control':'no-store'}});
    }
    catch(error){const failure=exposureReadFailure(error);return Response.json({error:'历史索引暂不可用，请重试',code:failure.code},{status:503});}
  }
  const closed=end<Date.now()-3600_000,ttl=closed?900_000:15_000;
  const scope={date,expiryDate,format,...(window?{window}:{})},condition=qqqExposureRequestValidator(request.headers);
  try {const conditional=await qqqClosedExposureConditional({closed,scope,header:condition,revision:()=>window?readQqqChartWindowRevision(window.from,window.to,expiryDate,true):readQqqChartSourceRevision(date,expiryDate,true)});if(conditional)return conditional;}catch(error){console.warn('QQQ source conditional validation failed',{code:exposureReadFailure(error).code});}
  return responses.run(canonicalJsonRequestKey({...scope,validatorVersion:3}),async()=>{
    try { const timings:string[]=[];const data=await readQqqExposureHistory(date,expiryDate,(stage,ms)=>timings.push(`${stage};dur=${ms.toFixed(1)}`),expiryDate?1:2,window);const headers={'Server-Timing':timings.join(', '),'x-qqq-exposure-revision':data.revision,...(closed?{etag:qqqExposureEtag(scope,data.revision)}:{})};return format?.startsWith('lines-')?new Response(serializeExposureWire(data,format==='lines-v2'),{headers:{...headers,'content-type':'application/x-ndjson; charset=utf-8'}}):Response.json(format==='rows-v1'?encodeExposureWire(data):data,{headers}); }
    catch(error) {
      const failure=exposureReadFailure(error);
      console.warn('QQQ exposure history read failed',{date,expiryDate,...failure,message:error instanceof Error?error.message:'Unknown read failure'});
      return Response.json({error:'完整行权价历史暂不可用，请重试',code:failure.code},{status:503,headers:{'x-qqq-exposure-error':failure.code,'x-qqq-exposure-stage':failure.stage,...(failure.retryable?{'retry-after':'2'}:{})}});
    }
  },ttl,condition,false,request.headers.get('accept-encoding'));
}
