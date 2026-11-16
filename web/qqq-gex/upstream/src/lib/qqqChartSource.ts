import {supabaseAdmin} from './supabase';
import {qqqMarketDateBounds} from './qqqMarketDate';
import {createQqqVersionedHistoryStore,type SourceManifest,type SourceRow,type CandleRow} from './qqqVersionedHistoryStore';
import {embeddedRedisCache} from './embeddedRedisCache';
import {qqqSourceMetadataCache} from './qqqSourceMetadataCache';
import {decodeQqqChartProfile,QQQ_CHART_PROFILE_FIELDS,QQQ_MODEL_PROFILE_FIELDS} from './qqqChartProfileTransport';
import {decodeQqqChartCombined} from './qqqChartCombinedTransport';
import {createQqqChartArchiveReader} from './qqqChartArchive';
import {createQqqChartRpc} from './qqqChartRpc';
const policy='qqq-pcs-intraday-v1';
const rpc=createQqqChartRpc({request:async(name,args,signal)=>await supabaseAdmin.rpc(name,args).abortSignal(signal),
 observe:event=>{if(event.reason)console.warn('QQQ chart source read attempt failed',event);else if(process.env.QQQ_SOURCE_DIAGNOSTICS==='1')console.info('QQQ chart source read timing',event);},
});
function args(date:string,expiryDate:string|null){const {from,to}=qqqMarketDateBounds(date);return {p_policy_id:policy,p_from:from,p_to:to,p_expiry_date:expiryDate};}
export function isChartSourceRolloutMissing(error:unknown){return ['PGRST202','42883'].includes((error as {code?:string})?.code??'');}
async function profiles(kind:'profile'|'model',keys:unknown):Promise<SourceRow[]>{
 const input={p_policy_id:policy,p_keys:keys};
 let rows:Array<Omit<SourceRow,'profile'>&{packed_profile:unknown}>;
 try{rows=await rpc(kind==='profile'?'qqq_chart_profile_batch_v3':`qqq_chart_${kind}_batch_v2`,input);}
 catch(error){if(isChartSourceRolloutMissing(error)){if(kind==='profile')try{rows=await rpc('qqq_chart_profile_batch_v2',input);}catch(fallbackError){ if(!isChartSourceRolloutMissing(fallbackError))throw fallbackError;return rpc(`qqq_chart_${kind}_batch`,input); }else return rpc(`qqq_chart_${kind}_batch`,input);}else throw error;}
 return rows.map(({packed_profile,...row})=>({...row,profile:decodeQqqChartProfile(packed_profile,kind==='profile'?QQQ_CHART_PROFILE_FIELDS:QQQ_MODEL_PROFILE_FIELDS)}));
}
export async function readQqqChartSourceRevision(date:string,expiryDate:string|null,force=false){return 'scoped:'+await revision(args(date,expiryDate),force);}
export async function readQqqChartWindowRevision(from:string,to:string,expiryDate:string|null,force=false){return 'scoped:'+await revision({p_policy_id:policy,p_from:from,p_to:to,p_expiry_date:expiryDate},force);}
function revision(input:Record<string,unknown>,force=false){return qqqSourceMetadataCache.read('revision',input,()=>rpc<string>('qqq_chart_source_revision',input),force);}
export function readQqqChartWindowManifest(from:string,to:string,force=false){const input={p_policy_id:policy,p_from:from,p_to:to,p_expiry_date:null};return qqqSourceMetadataCache.read('manifest',input,()=>rpc<SourceManifest>('qqq_chart_source_manifest',input),force);}
function manifest(scope:string,force=false){const {date,expiryDate,from,to}=JSON.parse(scope),input=from&&to?{p_policy_id:policy,p_from:from,p_to:to,p_expiry_date:expiryDate}:args(date,expiryDate);return qqqSourceMetadataCache.read('manifest',input,async()=>{try{return await rpc<SourceManifest>('qqq_chart_source_manifest_v2',input);}catch(error){if(!isChartSourceRolloutMissing(error))throw error;return rpc<SourceManifest>('qqq_chart_source_manifest',input);}},force);}
export const readQqqExposureManifest = (date:string,expiryDate:string|null) => manifest(JSON.stringify({date,expiryDate}),true);
const store=createQqqVersionedHistoryStore({
 shared:{get:keys=>embeddedRedisCache.getMany('qqq-chart-rows-v1',keys),set:values=>embeddedRedisCache.setMany('qqq-chart-rows-v1',values,86400_000)},
 manifest,
 profiles:keys=>profiles('profile',keys),
 candles:keys=>rpc<CandleRow[]>('qqq_chart_candle_batch',{p_keys:keys}),
 combined:async(profileKeys,candleKeys)=>{
  try{return decodeQqqChartCombined(await rpc('qqq_chart_data_batch_v3',{p_policy_id:policy,p_profile_keys:profileKeys,p_candle_keys:candleKeys}));}
  catch(error){
   if(!isChartSourceRolloutMissing(error))throw error;
   // Sequential fallback keeps one physical scheduler slot within its budget.
   const p=await profiles('profile',profileKeys),c=await rpc<CandleRow[]>('qqq_chart_candle_batch',{p_keys:candleKeys});
   return {profiles:p,candles:c};
  }
 },
 archive:createQqqChartArchiveReader((name,args)=>rpc(name,args,AbortSignal.timeout(8_000))),
});
export const qqqChartSourceMetrics=store.metrics;
export const readQqqChartSource=(date:string,expiryDate:string|null)=>store.read(JSON.stringify({date,expiryDate}));
/** Window scopes reuse exact cached rows with full-day/DTE readers. */
export const readQqqChartWindowSource=(date:string,expiryDate:string|null,from:string,to:string)=>store.read(JSON.stringify({date,expiryDate,from,to}));
// Reuse exact candle row versions without hydrating full option profiles just
// to bootstrap prices. The original manifest revision still closes the read.
const prices=createQqqVersionedHistoryStore({
 manifest:async(scope,force)=>{const source=await manifest(scope,force);return {revision:source.revision,items:[],bars:source.bars};},
 profiles:async()=>[],candles:keys=>rpc<CandleRow[]>('qqq_chart_candle_batch',{p_keys:keys}),
 shared:{get:keys=>embeddedRedisCache.getMany('qqq-chart-rows-v1',keys),set:values=>embeddedRedisCache.setMany('qqq-chart-rows-v1',values,86400_000)},
},2*1024*1024);
export const readQqqExposurePrices=(date:string,expiryDate:string|null)=>prices.read(JSON.stringify({date,expiryDate}));
const models=createQqqVersionedHistoryStore({
 shared:{get:async keys=>{
  // Full chart rows are valid model inputs. Never publish model-only rows into
  // the chart namespace: they do not carry every replay field.
  const full=await embeddedRedisCache.getMany('qqq-chart-rows-v1',keys),missing=keys.filter((_,i)=>!full[i]);
  const partial=missing.length?await embeddedRedisCache.getMany('qqq-model-rows-v1',missing):[],byKey=new Map(missing.map((key,i)=>[key,partial[i]]));
  return keys.map((key,i)=>full[i]??byKey.get(key)??null);
 },set:values=>embeddedRedisCache.setMany('qqq-model-rows-v1',values,86400_000)},
 manifest:async(scope,force)=>{const source=await manifest(scope,force);return {...source,bars:[]};},
 profiles:keys=>profiles('model',keys),candles:async()=>[],
},8*1024*1024);
export const qqqModelSourceMetrics=models.metrics;
export function readQqqGammaSource(date:string,expiryDate:string){const scope=JSON.stringify({date,expiryDate});return store.hasScope(scope)?store.read(scope):models.read(scope);}
