import Redis from 'ioredis';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {ResponseCacheEntry} from './responseCache';

// Cache only. Source writes and capture claims always remain in Supabase.
const MAX_VALUE=4*1024*1024,MAX_JSON=16*1024*1024,MAX_TRANSFER=8*1024*1024,MAX_KEYS=256;
const ARCHIVE_TRANSFER=24*1024*1024,MAX_READ_BYTES=64*1024*1024,MAX_WRITE_BYTES=32*1024*1024;
type TransferBudget={maxValue:number;maxTransfer:number};
const archiveBudget:TransferBudget={maxValue:ARCHIVE_TRANSFER,maxTransfer:ARCHIVE_TRANSFER};
function limits(budget?:TransferBudget){
 if(!budget)return {maxValue:MAX_VALUE,maxTransfer:MAX_TRANSFER};
 if(!Number.isSafeInteger(budget.maxValue)||!Number.isSafeInteger(budget.maxTransfer)||budget.maxValue<1||budget.maxTransfer<budget.maxValue||budget.maxTransfer>ARCHIVE_TRANSFER)throw Error('Invalid cache transfer budget');
 return budget;
}
const writes=new Map<string,Promise<boolean>>();let writingBytes=0;
const reads=new Map<string,Promise<Array<Buffer|null>>>();
let readingBytes=0;
const boundedRead=`local out={} local total=0 for i,k in ipairs(KEYS) do local n=redis.call('STRLEN',k) if n>0 and n<=tonumber(ARGV[1]) and total+n<=tonumber(ARGV[2]) then out[i]=redis.call('GET',k) total=total+n else out[i]=false end end return out`;
let client:Redis|undefined,connection:Promise<boolean>|undefined,retryAt=0;
export const embeddedRedisMetrics={hits:0,misses:0,errors:0,writes:0,coalescedReads:0,coalescedWrites:0};
function config(){
 const url=process.env.REDIS_URL?.trim();if(!url||process.env.EMBEDDED_REDIS_DISABLED==='1')return null;
 try{const parsed=new URL(url);if(parsed.protocol!=='redis:'||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))return null;
  const database=process.env.SUPABASE_URL_SERVER||process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'http://localhost';
  return {url,prefix:`option-seller:cache:v1:${process.env.NODE_ENV??'development'}:${createHash('sha256').update(database).digest('hex').slice(0,16)}`};
 }catch{return null;}
}
function degraded(){embeddedRedisMetrics.errors++;retryAt=Date.now()+5000;}
async function ready(){
 const settings=config();if(!settings||Date.now()<retryAt)return null;
 if(!client){client=new Redis(settings.url,{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:0,connectTimeout:150,commandTimeout:150,retryStrategy:()=>null,autoResendUnfulfilledCommands:false});client.on('error',()=>{});}
 if(client.status==='ready')return client;
 if(!connection){const current=client;connection=current.connect().then(()=>true).catch(()=>{embeddedRedisMetrics.errors++;current.disconnect();if(client===current)client=undefined;retryAt=Date.now()+5000;return false;}).finally(()=>{connection=undefined;});}
 return await connection?client??null:null;
}
function key(space:string,value:string){return `${config()!.prefix}:${space}:${createHash('sha256').update(value).digest('hex')}`;}
export const embeddedRedisCache={
 configured:()=>config()!==null,
 async getMany(space:string,keys:string[],budget?:TransferBudget):Promise<Array<Buffer|null>>{
  if(!keys.length)return [];if(keys.length>MAX_KEYS||!config())return keys.map(()=>null);
  const bound=limits(budget);
  const canonical=[...new Set(keys)].sort(),id=createHash('sha256').update(JSON.stringify([space,canonical,bound])).digest('hex');
  let task=reads.get(id);
  if(task)embeddedRedisMetrics.coalescedReads++;
  else{
   if(reads.size>=8||readingBytes+bound.maxTransfer>MAX_READ_BYTES)return keys.map(()=>null);
   readingBytes+=bound.maxTransfer;
   task=(async()=>{const redis=await ready();if(!redis)return canonical.map(()=>null);
    try{const values=await redis.callBuffer('EVAL',boundedRead,canonical.length,...canonical.map(value=>key(space,value)),bound.maxValue,bound.maxTransfer) as Array<Buffer|null>;
     return values.map(value=>{if(value&&value.length<=bound.maxValue){embeddedRedisMetrics.hits++;return value;}embeddedRedisMetrics.misses++;return null;});
    }catch{degraded();return canonical.map(()=>null);}
   })();reads.set(id,task);const pending=task;void pending.finally(()=>{readingBytes-=bound.maxTransfer;if(reads.get(id)===pending)reads.delete(id);}).catch(()=>{});
  }
  const values=await task,byKey=new Map(canonical.map((key,index)=>[key,values[index]]));return keys.map(key=>byKey.get(key)??null);
 },
 async setMany(space:string,values:Array<{key:string;body:Buffer}>,ttlMs:number,onlyIfMissing=false,budget?:TransferBudget){
  if(!Number.isFinite(ttlMs)||ttlMs<=0||!config())return false;
  const bound=limits(budget);
  const unique=new Map(values.slice(0,MAX_KEYS).map(value=>[value.key,value])),bounded:Array<{key:string;body:Buffer}>=[];let bytes=0;
  for(const value of unique.values())if(value.body.length<=bound.maxValue&&bytes+value.body.length<=bound.maxTransfer){bounded.push(value);bytes+=value.body.length;}
  if(!bounded.length)return false;
  const ttl=Math.min(86400_000,Math.ceil(ttlMs)),hash=createHash('sha256').update(JSON.stringify([space,ttl,onlyIfMissing]));
  for(const value of bounded)hash.update(JSON.stringify([value.key,value.body.length])).update(value.body);
  const id=hash.digest('hex'),existing=writes.get(id);if(existing){embeddedRedisMetrics.coalescedWrites++;return existing;}
  // Drop optional cache writes rather than accumulating a queue during bursts.
  if(writes.size>=4||writingBytes+bytes>MAX_WRITE_BYTES)return false;
  writingBytes+=bytes;
  const task=(async()=>{const redis=await ready();if(!redis)return false;
   try{const pipeline=redis.pipeline();for(const value of bounded){if(onlyIfMissing)pipeline.set(key(space,value.key),value.body,'PX',ttl,'NX');else pipeline.set(key(space,value.key),value.body,'PX',ttl);}const result=await pipeline.exec();if(!result||result.some(([error])=>error))throw Error('Cache write failed');const written=result.filter(([,value])=>value==='OK').length;embeddedRedisMetrics.writes+=written;return written>0;}
   catch{degraded();return false;}
  })();writes.set(id,task);
  try{return await task;}finally{if(writes.get(id)===task)writes.delete(id);writingBytes-=bytes;}

 },
 async delete(space:string,value:string){const redis=await ready();if(!redis)return;try{await redis.del(key(space,value));}catch{degraded();}},
 async getJson<T>(space:string,value:string):Promise<{data:T;expiresAt:number}|null>{
  const body=(await this.getMany(space,[value]))[0];if(!body)return null;
  try{const decoded=JSON.parse(gunzipSync(body,{maxOutputLength:MAX_JSON}).toString('utf8'));if(!Number.isFinite(decoded.expiresAt)||decoded.expiresAt<=Date.now())return null;return decoded;}
  catch{await this.delete(space,value);return null;}
 },
 async setJson<T>(space:string,key:string,data:T,expiresAt:number,onlyIfMissing=false){
  try{const json=JSON.stringify({data,expiresAt});if(Buffer.byteLength(json)>MAX_JSON)return false;return this.setMany(space,[{key,body:gzipSync(json,{level:1})}],expiresAt-Date.now(),onlyIfMissing);}catch{return false;}
 },
 disconnect(){client?.disconnect();client=undefined;connection=undefined;retryAt=0;reads.clear();},
 health:()=>({configured:config()!==null,status:client?.status??'not-connected',cooldownMs:Math.max(0,retryAt-Date.now()),readingBytes,writingBytes,...embeddedRedisMetrics}),
};

/** Shared HTTP candidates retain their original freshness deadline. Expired
 * candidates still require the route's DB revision check before any response. */
export function redisResponseCachePort(space:string,maxOutputLength=32*1024*1024){return {
 async get(key:string):Promise<ResponseCacheEntry|null>{
  const buffer=(await embeddedRedisCache.getMany(space,[key],archiveBudget))[0];if(!buffer)return null;
  try{const split=buffer.indexOf(10);if(split<0||split>16384)return null;
   const meta=JSON.parse(buffer.subarray(0,split).toString('utf8'));
   if(!Number.isFinite(meta.expiresAt)||!Number.isFinite(meta.bytes)||meta.bytes<0||meta.status!==200||!Array.isArray(meta.headers)||meta.headers.some((header:unknown)=>!Array.isArray(header)||header.length!==2||header.some(value=>typeof value!=='string')))return null;
   const body=buffer.subarray(split+1);if(!body.length)return null;
   // Verify CRC and bounded decoded length before trusting the cached envelope.
   gunzipSync(body,{maxOutputLength});
   return {expiresAt:meta.expiresAt,value:{body,status:meta.status,headers:meta.headers,bytes:body.length+JSON.stringify(meta.headers).length*2}};
  }catch{return null;}
 },
 async set(key:string,entry:ResponseCacheEntry){
  const {value,expiresAt}=entry;const body=typeof value.body==='string'?gzipSync(value.body,{level:1}):value.body;
  const meta=JSON.stringify({status:value.status,headers:value.headers,bytes:value.bytes,expiresAt});
  return embeddedRedisCache.setMany(space,[{key,body:Buffer.concat([Buffer.from(meta+'\n'),body])}],86400_000,false,archiveBudget);
 },
};}
