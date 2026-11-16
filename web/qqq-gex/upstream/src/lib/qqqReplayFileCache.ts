import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress=promisify(gzip),decompress=promisify(gunzip);
const MAX_COMPRESSED=4*1024*1024,MAX_RAW=16*1024*1024;

/** Disposable, private same-host reuse across production workers/restarts.
 * It never replaces a source revision check and may be absent on any host. */
export function createQqqReplayFileCache(directory:string) {
  let writes=0;
  const file=(key:string)=>join(directory,createHash('sha256').update(key).digest('hex')+'.gz');
  return {
    async get<T>(key:string):Promise<{data:T;expiresAt:number}|null>{
      let handle;
      try{
        handle=await open(file(key),constants.O_RDONLY|constants.O_NOFOLLOW);
        const info=await handle.stat();
        if(!info.isFile()||info.size>MAX_COMPRESSED)return null;
        const decoded=JSON.parse((await decompress(await handle.readFile(),{maxOutputLength:MAX_RAW})).toString('utf8'));
        if(decoded.key!==key||!Number.isFinite(decoded.expiresAt)||decoded.expiresAt<=Date.now()||decoded.expiresAt>Date.now()+86400_000)return null;
        return {data:decoded.data as T,expiresAt:decoded.expiresAt};
      }catch{return null;}finally{await handle?.close().catch(()=>{});}
    },
    async set<T>(key:string,data:T,expiresAt:number){
      if(writes>=4||expiresAt<=Date.now()||expiresAt>Date.now()+86400_000)return;
      writes++;let temporary:string|undefined;
      try{
        const body=JSON.stringify({key,data,expiresAt});
        if(Buffer.byteLength(body)>MAX_RAW)return;
        const packed=await compress(body,{level:1});if(packed.length>MAX_COMPRESSED)return;
        await mkdir(directory,{recursive:true,mode:0o700});
        temporary=join(directory,randomUUID()+'.tmp');
        await writeFile(temporary,packed,{flag:'wx',mode:0o600});
        await rename(temporary,file(key));temporary=undefined;
        const entries=await readdir(directory);
        const files=await Promise.all(entries.filter(name=>/^[a-f0-9]{64}\.gz$/.test(name)).map(async name=>({path:join(directory,name),time:(await stat(join(directory,name)).catch(()=>({mtimeMs:0}))).mtimeMs})));
        files.sort((a,b)=>b.time-a.time);
        await Promise.all(files.slice(16).map(entry=>unlink(entry.path).catch(()=>{})));
      }catch{/* Optional cache errors cannot affect replay availability. */}
      finally{if(temporary)await unlink(temporary).catch(()=>{});writes--;}
    },
  };
}

const namespace=createHash('sha256').update(JSON.stringify([process.getuid?.(),process.env.NODE_ENV,process.env.SUPABASE_URL_SERVER??process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??'local'])).digest('hex').slice(0,20);
const cache=createQqqReplayFileCache(join(tmpdir(),'option-qqq-replay-v1-'+namespace));
export const qqqReplayFileCache={
  get:<T>(key:string)=>process.env.NODE_ENV==='production'?cache.get<T>(key):Promise.resolve(null),
  set:<T>(key:string,data:T,expiresAt:number)=>process.env.NODE_ENV==='production'?cache.set(key,data,expiresAt):Promise.resolve(),
};
