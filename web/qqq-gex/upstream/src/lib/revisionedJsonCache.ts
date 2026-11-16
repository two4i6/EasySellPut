import {embeddedRedisCache} from './embeddedRedisCache';
import {canonicalJsonRequestKey} from './responseCache';

/** Immutable evidence identity supplied by the caller, never a freshness timer.
 * Only load() verifies source consistency; errors and partial reads stay uncached. */
export function createRevisionedJsonCache<T>(space:string,validate:(value:unknown)=>value is T,ports={
 get:(key:string)=>embeddedRedisCache.getJson<T>(space,key),
 set:(key:string,value:T,expiresAt:number)=>embeddedRedisCache.setJson(space,key,value,expiresAt),
}){
 const pending=new Map<string,Promise<T>>();
 return async(identity:unknown,load:()=>Promise<T>,matches:(value:T)=>boolean=()=>true):Promise<T>=>{
  const key=canonicalJsonRequestKey(identity),existing=pending.get(key);if(existing)return existing;
  const run=async()=>{
   try{const hit=await ports.get(key);if(hit&&hit.expiresAt>Date.now()&&validate(hit.data)&&matches(hit.data))return hit.data;}catch{}
   const value=await load();if(!validate(value)||!matches(value))throw Error('Invalid revisioned cache source');
   try{await ports.set(key,value,Date.now()+86400_000);}catch{}
   return value;
  };
  if(pending.size>=16){const value=await load();if(!validate(value)||!matches(value))throw Error('Invalid revisioned cache source');return value;} // Bound optional work.
  const task=run();pending.set(key,task);
  try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
 };
}
