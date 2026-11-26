import {createCacheGeneration} from './cacheGeneration';
import {createHash} from 'node:crypto';
import {embeddedRedisCache} from './embeddedRedisCache';
import {qqqSourceMetadataCache} from './qqqSourceMetadataCache';

// Source stores already cache immutable row versions and bounded metadata.
// Their verification RPCs must remain authoritative (no nested freshness TTL).
const sourceRpcs=new Set(['qqq_chart_source_revision','qqq_chart_source_manifest','qqq_chart_source_manifest_v2','qqq_chart_data_batch_v3','qqq_chart_archive_chunk_v1','qqq_chart_archive_chunk_batch_v1','qqq_chart_profile_batch','qqq_chart_profile_batch_v2','qqq_chart_profile_batch_v3','qqq_chart_candle_batch','qqq_chart_model_batch','qqq_chart_model_batch_v2','qqq_gex_latest_snapshot_v2','qqq_candle_latest_session_v1','qqq_chart_data_batch_v1','qqq_chart_data_batch_v2','qqq_gex_read_revision_v1','qqq_gex_history_window_v2','qqq_gex_expiry_summary_page','qqq_gex_directional_summary_page_v2','qqq_gex_directional_summary_page_v3','qqq_gex_directional_summary_page_v4','qqq_gex_directional_summary_page_v6','qqq_gex_directional_replay_page','qqq_gex_collector_history_page_v1']);
const readRpcs=new Set(['qqq_gex_capture_dates','qqq_gex_expiry_index','qqq_gex_chart_page','qqq_gamma_position_history','qqq_gex_display_day','qqq_gex_history_window','qqq_gex_latest_snapshot','qqq_gex_expiry_summary_page','qqq_gex_directional_replay_page','qqq_gex_directional_summary_page_v2','qqq_gex_collector_history_page_v1']);
type Envelope={status:number;headers:Array<[string,string]>;body:string};
type CachePort={initialize?:(space:string,key:string,value:string,expiresAt:number)=>Promise<unknown>;get:<T>(space:string,key:string)=>Promise<{data:T;expiresAt:number}|null>;set:<T>(space:string,key:string,data:T,expiresAt:number)=>Promise<unknown>;delete:(space:string,key:string)=>Promise<unknown>};
async function boundedRequestText(request:Request,maxBytes:number){
 const reader=request.clone().body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
  if(bytes>maxBytes){void reader.cancel().catch(()=>{});return null;}chunks.push(next.value);
 }return Buffer.concat(chunks).toString('utf8');}finally{reader.releaseLock();}
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const supabaseCacheMetrics={hits:0,misses:0,coalesced:0,writes:0,bypassed:0};

/** One transport shell, not a replacement Supabase query builder. Auth, schema,
 * filters, ranges and count preferences are part of each exact request key. */
export function createSupabaseCachedFetch(options:{fetch:typeof fetch;cache:CachePort;now?:()=>number;enabled?:()=>boolean;afterWrite?:(resource:string)=>Promise<unknown>}){
 const now=options.now??Date.now,pending=new Map<string,Promise<Envelope>>();let stages=0;
 const safeGet=async<T>(space:string,key:string)=>{try{return await options.cache.get<T>(space,key);}catch{return null;}};
 const safeSet=async<T>(space:string,key:string,data:T,until:number)=>{try{await options.cache.set(space,key,data,until);}catch{}};
 const token=createCacheGeneration({get:(space,key)=>options.cache.get<string>(space,key),set:options.cache.set,initialize:options.cache.initialize,space:'supabase-generation-v1',key:'all',now});
 const generation=token.read,invalidate=token.invalidate;
 const reply=(value:Envelope)=>new Response([204,205,304].includes(value.status)?null:value.body,{status:value.status,headers:value.headers});
 return (async(input,init)=>{
  if(options.enabled&&!options.enabled())return options.fetch(input,{...init,cache:'no-store'});
  const request=new Request(input,init),url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
  const rest=parts[0]==='rest'&&parts[1]==='v1';
  const edge=parts[0]==='functions'&&parts[1]==='v1'&&parts[2]==='qqq-market-pipeline';
  let action:string|undefined;
  if(edge&&request.method==='POST')try{action=JSON.parse(await request.clone().text()).action;}catch{}
  const edgeRead=edge&&['chain','health'].includes(action??'');
  if(!rest&&!edgeRead){supabaseCacheMetrics.bypassed++;return options.fetch(input,init);}
  const resource=parts[2]??'',rpc=rest&&resource==='rpc',name=rpc?parts[3]:resource;
  // Lifecycle snapshots are small, live observations. Avoid global Redis
  // generation work on every append and read: it can consume their deadline
  // before PostgREST is reached. They do not change chart source metadata.
  if(resource==='qqq_pcs_lifecycle_snapshot'){
   supabaseCacheMetrics.bypassed++;
   return options.fetch(input,{...init,cache:'no-store'});
  }
  if(request.method==='HEAD'||resource==='qqq_gex_display_revision'||rpc&&sourceRpcs.has(name)){
   supabaseCacheMetrics.bypassed++;
   // Bypass Next's fetch data cache too, not only this Redis facade. Exact
   // revision reads must never inherit a framework cache or its body cloning.
   return options.fetch(input,{...init,cache:'no-store'});
  }
  const reading=edgeRead||request.method==='GET'||(request.method==='POST'&&rpc&&readRpcs.has(name));
  if(!reading){
   // Never publish pending data as a durable row. Unknown RPCs are treated as
   // mutations; lock/admission requests are never cached or deduplicated.
   const operation=crypto.randomUUID();
   let staged=false;const reserved=stages<4;if(reserved)stages++;
   if(reserved)try{const body=await boundedRequestText(request,4*1024*1024);if(body!==null){await safeSet('supabase-pending-v1',operation,{method:request.method,path:url.pathname,body},now()+60000);staged=true;}}catch{}
   await invalidate(); // Prevent readers from retaining a pre-write generation.
   try{
    const response=await options.fetch(input,init);
    await invalidate(); // Includes failure: an RPC may have partially committed.
    if(options.afterWrite)try{await options.afterWrite(rpc?'rpc':resource);}catch{}
    if(response.ok)supabaseCacheMetrics.writes++;
    return response;
   }catch(error){await invalidate();if(options.afterWrite)try{await options.afterWrite(rpc?'rpc':resource);}catch{}throw error;}
   finally{if(reserved)stages--;if(staged)try{await options.cache.delete('supabase-pending-v1',operation);}catch{}}
  }
  request.signal.throwIfAborted();
  if(['no-store','reload','no-cache'].includes(request.cache)||/no-store|no-cache/i.test(request.headers.get('cache-control')??'')){supabaseCacheMetrics.bypassed++;return options.fetch(input,init);}
  const accept=request.headers.get('accept');
  if(accept&&!accept.toLowerCase().includes('json')){supabaseCacheMetrics.bypassed++;return options.fetch(input,init);}
  // api_cache already has deadline-aware L1/L2; avoid retaining its filtered
  // time-dependent rows again or creating keys from gt(expires_at, now).
  if(resource==='api_cache'){supabaseCacheMetrics.bypassed++;return options.fetch(input,init);}
  url.searchParams.sort();
  const body=request.method==='POST'?await request.clone().text():'';
  const identity=digest(JSON.stringify([url.toString(),request.method,[...request.headers.entries()].sort(),body]));
  const epoch=await generation(),key=epoch+':'+identity;
  const cached=await safeGet<Envelope>('supabase-reads-v1',key);
  request.signal.throwIfAborted();
  if(cached&&cached.expiresAt>now()&&cached.data&&typeof cached.data==='object'&&cached.data.status===200&&Array.isArray(cached.data.headers)&&cached.data.headers.every(header=>Array.isArray(header)&&header.length===2&&header.every(value=>typeof value==='string'))&&typeof cached.data.body==='string'){
   try{const response=reply(cached.data);supabaseCacheMetrics.hits++;return response;}catch{/* Malformed disposable envelope: reload source instead of failing the API. */}
  }
  // A caller's abort belongs to its source request. Only callers without an
  // explicit signal share a load, so one cancellation cannot cancel another.
  const share=!(input instanceof Request)&&!init?.signal;
  const existing=share?pending.get(key):undefined;
  if(existing){supabaseCacheMetrics.coalesced++;return reply(await existing);}
  supabaseCacheMetrics.misses++;
  if(pending.size>=32)return options.fetch(input,init);
  const load=(async()=>{
   const started=now(),response=await options.fetch(input,init),text=await response.text();
   const value:Envelope={status:response.status,headers:[...response.headers.entries()].filter(([name])=>!['content-length','content-encoding','transfer-encoding'].includes(name)),body:text};
   // Fixed short TTL: independent writers/Edge Functions cannot notify this
   // private cache. Explicit source consistency remains in the source store.
   if(response.status===200&&Buffer.byteLength(text)<=4*1024*1024&&await generation()===epoch&&now()<started+5000)await safeSet('supabase-reads-v1',key,value,started+5000);
   return value;
  })();
  if(share)pending.set(key,load);
  try{return reply(await load);}finally{if(pending.get(key)===load)pending.delete(key);}
 }) as typeof fetch;
}
export const supabaseCachedFetch=createSupabaseCachedFetch({
 enabled:()=>embeddedRedisCache.configured(),fetch:(...args)=>fetch(...args),cache:{initialize:(space,key,value,until)=>embeddedRedisCache.setJson(space,key,value,until,true),get:<T>(space:string,key:string)=>embeddedRedisCache.getJson<T>(space,key),set:<T>(space:string,key:string,data:T,until:number)=>embeddedRedisCache.setJson(space,key,data,until),delete:(space,key)=>embeddedRedisCache.delete(space,key)},
 afterWrite:async(resource)=>{if(['rpc','qqq_gex_expiry_snapshot','qqq_intraday_candle','qqq_option_chain_snapshot','engine_minute_bar','qqq_pcs_lifecycle_snapshot'].includes(resource))await qqqSourceMetadataCache.invalidate();},
});
