import {createCacheGeneration} from './cacheGeneration';
import {embeddedRedisCache} from './embeddedRedisCache';
import {canonicalJsonRequestKey} from './responseCache';

/** Disposable source metadata, never a substitute for durable capture writes.
 * The fixed 30s deadline also bounds changes made outside this app's collector. */
export function createQqqSourceMetadataCache(ports:{
 get:<T>(space:string,key:string)=>Promise<{data:T;expiresAt:number}|null>;
 set:<T>(space:string,key:string,data:T,expiresAt:number)=>Promise<unknown>;
 initialize?:(space:string,key:string,value:string,expiresAt:number)=>Promise<unknown>;
 validate?:(kind:'manifest'|'revision',value:unknown)=>boolean;
 now?:()=>number;
}){
 const now=ports.now??Date.now,pending=new Map<string,Promise<unknown>>();
 const token=createCacheGeneration({get:(space,key)=>ports.get<string>(space,key),set:ports.set,initialize:ports.initialize,space:'qqq-source-generation-v1',key:'current',now});
 const epoch=token.read;
 return {
  generation:epoch,
  invalidate:token.invalidate,
  async read<T>(kind:'manifest'|'revision',identity:unknown,load:()=>Promise<T>,force=false):Promise<T>{
   for(let attempt=0;attempt<2;attempt++){
    const generation=await epoch(),key=canonicalJsonRequestKey({kind,identity,generation});
    if(!force)try{const cached=await ports.get<T>('qqq-source-metadata-v1',key);if(cached&&cached.expiresAt>now()&&(!ports.validate||ports.validate(kind,cached.data)))return cached.data;}catch{}
    const id=key+(force?':verify':':read'),existing=pending.get(id);if(existing){try{return await existing as T;}catch(error){if(error instanceof Error&&error.message==='QQQ source generation changed during metadata load'&&attempt===0)continue;throw error;}}
    // Overflow may skip retention/deduplication, never source validation.
    const retain=pending.size<32;
    const task=(async()=>{
     const started=now(),value=await load();
     if(ports.validate&&!ports.validate(kind,value))throw Error('Invalid QQQ source metadata');
     if(await epoch()!==generation)return {changed:true as const};
     if(retain&&now()<started+30_000)try{
      await ports.set('qqq-source-metadata-v1',key,value,started+30_000);
      // A manifest already contains the exact revision for this identity.
      // Publish with the same generation/deadline; forced reads still reload.
      const manifestRevision=value&&typeof value==='object'?(value as {revision?:unknown}).revision:undefined;
      if(kind==='manifest'&&typeof manifestRevision==='string'){
       const revisionKey=canonicalJsonRequestKey({kind:'revision',identity,generation});
       await ports.set('qqq-source-metadata-v1',revisionKey,manifestRevision,started+30_000);
      }
     }catch{}
     return {changed:false as const,value};
    })();
    // Pending callers share both the authoritative load and generation check.
    const resolved=task.then(result=>{if(result.changed)throw Error('QQQ source generation changed during metadata load');return result.value;});
    if(retain)pending.set(id,resolved);
    try{return await resolved;}catch(error){if(error instanceof Error&&error.message==='QQQ source generation changed during metadata load'&&attempt===0)continue;throw error;}
    finally{if(pending.get(id)===resolved)pending.delete(id);}
   }
   throw Error('QQQ source changed during metadata read; retry');
  },
 };
}
export const qqqSourceMetadataCache=createQqqSourceMetadataCache({
 validate:(kind,value)=>kind==='revision'?typeof value==='string'&&value.length>0:!!value&&typeof value==='object'&&typeof (value as {revision?:unknown}).revision==='string'&&Array.isArray((value as {items?:unknown}).items)&&Array.isArray((value as {bars?:unknown}).bars),
 initialize:(space,key,value,expiresAt)=>embeddedRedisCache.setJson(space,key,value,expiresAt,true),
 get:<T>(space:string,key:string)=>embeddedRedisCache.getJson<T>(space,key),
 set:<T>(space:string,key:string,data:T,expiresAt:number)=>embeddedRedisCache.setJson(space,key,data,expiresAt),
});
