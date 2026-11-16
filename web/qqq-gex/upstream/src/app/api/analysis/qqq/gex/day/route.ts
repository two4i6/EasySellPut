import {qqqSourceMetadataCache} from '@/lib/qqqSourceMetadataCache';
import {readQqqGexDisplayDay} from '@/lib/qqqGexDisplayDay';
import {canonicalJsonRequestKey,createResponseCache} from '@/lib/responseCache';
import {readQqqChartWindowRevision,isChartSourceRolloutMissing} from '@/lib/qqqChartSource';
import {redisResponseCachePort} from '@/lib/embeddedRedisCache';
const responses=createResponseCache({generation:qqqSourceMetadataCache.generation,shared:redisResponseCachePort('qqq-day-http-v1'),maxEntries:16,maxBytes:8*1024*1024,revalidate:async(key,headers)=>{
 const input=JSON.parse(key);
 // Day replies include other latest expiries and an aggregate Gamma model.
 return headers.get('x-qqq-day-revision')===await readQqqChartWindowRevision(input.from,input.to,null);
}});
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  const input={from:params.get('from')??'',to:params.get('to')??'',expiryDate:params.get('expiryDate')};
  const span=Date.parse(input.to)-Date.parse(input.from);
  if(!Number.isFinite(span)||span<=0||span>25*3600000||input.expiryDate&&!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate))return Response.json({error:'需要完整且不超过 25 小时的历史窗口'},{status:400});
  return responses.run(canonicalJsonRequestKey(input),async()=>{
    try{const timings:string[]=[];
      let revision:string|undefined;try{revision=await readQqqChartWindowRevision(input.from,input.to,null);}catch(error){if(!isChartSourceRolloutMissing(error))throw error;}
      const data=await readQqqGexDisplayDay(input,(stage,ms)=>timings.push(`${stage};dur=${ms.toFixed(1)}`),revision);
      if(revision&&revision!==await readQqqChartWindowRevision(input.from,input.to,null))throw Error('Day source changed during read');
      return Response.json(data,{headers:{'Server-Timing':timings.join(', '),...(revision?{'x-qqq-day-revision':revision}:{})}});}
    catch{return Response.json({error:'历史展示暂不可用，请重试'},{status:503});}
  },30000,request.headers.get('if-none-match'),false,request.headers.get('accept-encoding'));
}
