import {gzipSync,gunzipSync} from 'node:zlib';
import type {ChartArchiveIndex} from './qqqChartArchiveCodec';

export type SourceKey={captured_at:string;expiry_date:string;version:string};
export type CandleKey={bar_at:string;version:string};
export type SourceManifest={revision:string;items:SourceKey[];bars:CandleKey[];archive?:ChartArchiveIndex};
export type SourceRow=SourceKey&{dte:number;spot:number;profile:Record<string,unknown>[]};
export type CandleRow=CandleKey&{open:number;high:number;low:number;close:number;volume:number};
const key=(row:SourceKey|CandleKey)=>'captured_at' in row?`${Date.parse(row.captured_at)}:${row.expiry_date}`:`bar:${Date.parse(row.bar_at)}`;
function validSourceRow(row:SourceRow|CandleRow,kind:'profile'|'candle'){
 if(kind==='profile'){
  const p=row as SourceRow;
  return Number.isFinite(p.spot)&&p.spot>0&&Number.isFinite(p.dte)&&p.dte>=0&&Array.isArray(p.profile)&&p.profile.every(point=>point&&typeof point==='object'&&Number.isFinite(point.strike)&&Number(point.strike)>0);
 }
 const c=row as CandleRow;return [c.open,c.high,c.low,c.close].every(value=>Number.isFinite(value)&&value>0)&&Number.isFinite(c.volume)&&c.volume>=0;
}

/** Shared exact source rows across chart modes/scopes. Never persists derivatives in DB. */
export function createQqqVersionedHistoryStore(ports:{manifest:(scope:string,force?:boolean)=>Promise<SourceManifest>;profiles:(keys:SourceKey[])=>Promise<SourceRow[]>;candles:(keys:CandleKey[])=>Promise<CandleRow[]>;combined?:(profiles:SourceKey[],candles:CandleKey[])=>Promise<{profiles:SourceRow[];candles:CandleRow[]}>;archive?:(scope:string,manifest:SourceManifest,schedule:<T>(fetch:()=>Promise<T>)=>Promise<T>)=>Promise<{profiles:SourceRow[];candles:CandleRow[]}>;coalesceKinds?:boolean;shared?:{get:(keys:string[])=>Promise<Array<Buffer|null>>;set:(values:Array<{key:string;body:Buffer}>)=>Promise<unknown>}},maxBytes=64*1024*1024,concurrency=2) {
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('Invalid chart source concurrency');
 const rows=new Map<string,{version:string;body:Buffer}>(),pending=new Map<string,Promise<{manifest:SourceManifest;rows:SourceRow[];bars:CandleRow[]}>>();
 let bytes=0;const metrics={profileRows:0,candleRows:0,profileBatches:0,candleBatches:0,manifestReads:0,sourceBytes:0,physicalBatches:0,archiveChunks:0,archiveFallbacks:0,compressionMs:0,sharedReadMs:0,sharedWriteMs:0};
 const scopes=new Map<string,SourceManifest>();
 const transfers=new Map<string,Promise<SourceRow|CandleRow|null>>();
 let active=0;const activeKinds={profile:0,candle:0};
 const waiters:Array<{kind:'profile'|'candle';pair:()=>boolean;resolve:()=>void}>=[];
 const drain=()=>{while(active<concurrency){const index=waiters.findIndex(task=>!task.pair()||activeKinds[task.kind]===0);if(index<0)break;const task=waiters.splice(index,1)[0]!;active++;activeKinds[task.kind]++;task.resolve();}};
 const bounded=async<T>(fetch:()=>Promise<T>,kind:'profile'|'candle',pair:()=>boolean)=>{
  await new Promise<void>(resolve=>{waiters.push({kind,pair,resolve});drain();});
  try{return await fetch();}finally{active--;activeKinds[kind]--;drain();}
 };
 const remember=(id:string,row:SourceRow|CandleRow,remote=true,existingBody?:Buffer)=>{
  const compressionStart=performance.now();
  const json=existingBody?null:JSON.stringify(row),body=existingBody??gzipSync(json!,{level:1});metrics.compressionMs+=performance.now()-compressionStart;if(remote)metrics.sourceBytes+=Buffer.byteLength(json!);
  const old=rows.get(id);if(old)bytes-=old.body.length;rows.delete(id);
  if(body.length>maxBytes)return body;
  rows.set(id,{version:row.version,body});bytes+=body.length;
  while(bytes>maxBytes||rows.size>32768){const first=rows.keys().next().value!;bytes-=rows.get(first)!.body.length;rows.delete(first);}
  return body;
 };
 const read=async(scope:string)=>{
  for(let attempt=0;attempt<2;attempt++) {
   metrics.manifestReads++;const sourceManifest=await ports.manifest(scope,attempt>0);
   const {archive,...manifest}=sourceManifest;
   if(!manifest?.revision||!Array.isArray(manifest.items)||!Array.isArray(manifest.bars)||manifest.items.length>16384||manifest.bars.length>1000)throw Error('Invalid chart source manifest');
   const all=[...manifest.items,...manifest.bars];
   if(new Set(all.map(key)).size!==all.length||all.some(k=>!k.version||!Number.isFinite(Date.parse('captured_at' in k?k.captured_at:k.bar_at))))throw Error('Duplicate/invalid chart source identity');
   const result=new Map<string,SourceRow|CandleRow>();
   for(const row of all){const id=key(row),cached=rows.get(id);if(cached?.version===row.version){result.set(id,JSON.parse(gunzipSync(cached.body).toString('utf8')));rows.delete(id);rows.set(id,cached);}}
   // Derived archive is optional. Validate the complete frozen manifest before
   // publishing any row; source versions and the closing check remain authoritative.
   if(archive&&ports.archive&&result.size<all.length){
    try{
     const value=await ports.archive(scope,sourceManifest,fetch=>bounded(()=>{metrics.archiveChunks++;return fetch();},'profile',()=>false));
     const received=[...value.profiles,...value.candles],expected=new Map(all.map(row=>[key(row),row.version]));
     if(value.profiles.length!==manifest.items.length||value.candles.length!==manifest.bars.length||new Set(received.map(key)).size!==all.length||received.some(row=>expected.get(key(row))!==row.version)||value.profiles.some(row=>!validSourceRow(row,'profile'))||value.candles.some(row=>!validSourceRow(row,'candle')))throw Error('Incomplete chart archive');
     for(const row of received){remember(key(row),row);result.set(key(row),row);}
    }catch{metrics.archiveFallbacks++;/* Invalid or unavailable archive: authoritative RPC fallback. */}
   }
   let pair=ports.coalesceKinds===true&&manifest.items.some(row=>!result.has(key(row)))&&manifest.bars.some(row=>!result.has(key(row)));
   const load=async<T extends SourceKey|CandleKey,R extends SourceRow|CandleRow>(keys:T[],fetch:(keys:T[])=>Promise<R[]>,kind:'profile'|'candle')=>{
    const missing=keys.filter(row=>!result.has(key(row)));
    // Keep a small lookahead queue so a slow batch does not leave the other
    // bounded slot idle. Network concurrency remains unchanged.
    const windows:Array<Promise<{ok:boolean;error?:unknown}>>=[];
    const consume=async()=>{
     const outcome=await windows.shift()!;
     if(outcome.error!==undefined){await Promise.all(windows);throw outcome.error;}
     if(!outcome.ok){await Promise.all(windows);return false;}
     return true;
    };
    for(let offset=0;offset<missing.length;offset+=128*concurrency){
     const window=missing.slice(offset,offset+128*concurrency),transferId=(row:T)=>`${key(row)}|${row.version}`;
     for(const row of window){const cached=rows.get(key(row));if(cached?.version===row.version)result.set(key(row),JSON.parse(gunzipSync(cached.body).toString('utf8')));}
     if(ports.shared){
      const candidates=window.filter(row=>!result.has(key(row))&&!transfers.has(transferId(row)));
      try{const sharedStart=performance.now();const shared=await ports.shared.get(candidates.map(transferId));metrics.sharedReadMs+=performance.now()-sharedStart;
       for(let i=0;i<candidates.length;i++){const body=shared[i];if(!body||body.length>4*1024*1024)continue;
        try{const row=JSON.parse(gunzipSync(body,{maxOutputLength:16*1024*1024}).toString('utf8')) as R;
         if(key(row)!==key(candidates[i])||row.version!==candidates[i].version)continue;
         if(!validSourceRow(row,kind))continue;
         remember(key(row),row,false,body);result.set(key(row),row);
        }catch{/* Corrupt disposable cache: reload the authoritative version. */}
       }
      }catch{/* Redis is optional; source fallback is unchanged. */}
      // Another scope can finish its transfer while the Redis read is pending.
      for(const row of window){const cached=rows.get(key(row));if(cached?.version===row.version)result.set(key(row),JSON.parse(gunzipSync(cached.body).toString('utf8')));}
     }
     const owned=window.filter(row=>!result.has(key(row))&&!transfers.has(transferId(row)));
     for(let index=0;index<owned.length;index+=128){
      const batch=owned.slice(index,index+128);
      const task=bounded(()=>{metrics.physicalBatches++;return fetch(batch);},kind,()=>pair).then(async received=>{
       const expected=new Map(batch.map(row=>[key(row),row.version]));
       if(received.length!==batch.length||new Set(received.map(key)).size!==batch.length||received.some(row=>expected.get(key(row))!==row.version))return null;
       if(received.some(row=>!validSourceRow(row,kind)))throw Error('Invalid chart source rows');
       metrics[kind==='profile'?'profileRows':'candleRows']+=received.length;metrics[kind==='profile'?'profileBatches':'candleBatches']++;
       const sharedValues=received.map(row=>({key:`${key(row)}|${row.version}`,body:remember(key(row),row)}));
       if(ports.shared)try{const sharedStart=performance.now();await ports.shared.set(sharedValues);metrics.sharedWriteMs+=performance.now()-sharedStart;}catch{/* Cache writes cannot fail a complete source read. */}
       return new Map(received.map(row=>[key(row),row]));
      });
      for(const row of batch){const id=transferId(row),promise=task.then(received=>received?.get(key(row))??null);transfers.set(id,promise);void promise.finally(()=>{if(transfers.get(id)===promise)transfers.delete(id);}).catch(()=>{});}
     }
     windows.push(Promise.all(window.map(row=>result.get(key(row))??transfers.get(transferId(row))!)).then(fetched=>{
      if(fetched.some(row=>!row))return {ok:false};
      for(const row of fetched)result.set(key(row!),row!);
      return {ok:true};
     },error=>({ok:false,error})));
     if(windows.length>=3&&!await consume())return false;
    }
    while(windows.length)if(!await consume())return false;
    return true;
   };
   const loadPhysicalCombined=async()=>{
    const identity=(row:SourceKey|CandleKey)=>`${key(row)}|${row.version}`;
    // Probe disposable row cache in bounded groups before planning physical RPCs.
    if(ports.shared){
     const missing=all.filter(row=>!result.has(key(row))&&!transfers.has(identity(row)));
     for(let offset=0;offset<missing.length;offset+=128*concurrency){
      const candidates=missing.slice(offset,offset+128*concurrency);
      try{
       const started=performance.now(),cached=await ports.shared.get(candidates.map(identity));metrics.sharedReadMs+=performance.now()-started;
       candidates.forEach((expected,i)=>{
        const body=cached[i];if(!body||body.length>4*1024*1024)return;
        try{
         const row=JSON.parse(gunzipSync(body,{maxOutputLength:16*1024*1024}).toString('utf8')) as SourceRow|CandleRow;
         if(key(row)!==key(expected)||row.version!==expected.version||!validSourceRow(row,'captured_at' in expected?'profile':'candle'))return;
         remember(key(row),row,false,body);result.set(key(row),row);
        }catch{/* Invalid optional row cache is replaced from the source. */}
       });
      }catch{/* The authoritative read works without Redis. */}
     }
    }
    for(const expected of all){const cached=rows.get(key(expected));if(!result.has(key(expected))&&cached?.version===expected.version)result.set(key(expected),JSON.parse(gunzipSync(cached.body).toString('utf8')));}
    const profiles=manifest.items.filter(row=>!result.has(key(row))&&!transfers.has(identity(row)));
    const candles=manifest.bars.filter(row=>!result.has(key(row))&&!transfers.has(identity(row)));
    for(let offset=0;offset<Math.max(profiles.length,candles.length);offset+=128){
     const p=profiles.slice(offset,offset+128),c=candles.slice(offset,offset+128),expected=[...p,...c];
     const task=bounded(async()=>{
      metrics.physicalBatches++;
      // One combined RPC is one physical slot, even when both row kinds exist.
      const value=p.length&&c.length?await ports.combined!(p,c):p.length?{profiles:await ports.profiles(p),candles:[]}:{profiles:[],candles:await ports.candles(c)};
      const received=[...value.profiles,...value.candles],versions=new Map(expected.map(row=>[key(row),row.version]));
      if(received.length!==expected.length||new Set(received.map(key)).size!==expected.length||received.some(row=>versions.get(key(row))!==row.version))return null;
      if(value.profiles.some(row=>!validSourceRow(row,'profile'))||value.candles.some(row=>!validSourceRow(row,'candle')))throw Error('Invalid combined chart source rows');
      metrics.profileRows+=value.profiles.length;metrics.candleRows+=value.candles.length;
      if(p.length)metrics.profileBatches++;if(c.length)metrics.candleBatches++;
      const cached=received.map(row=>({key:identity(row),body:remember(key(row),row)}));
      if(ports.shared)try{const started=performance.now();await ports.shared.set(cached);metrics.sharedWriteMs+=performance.now()-started;}catch{/* Optional shared cache. */}
      return new Map(received.map(row=>[key(row),row]));
     },'profile',()=>false);
     for(const row of expected){const id=identity(row),promise=task.then(value=>value?.get(key(row))??null);transfers.set(id,promise);void promise.finally(()=>{if(transfers.get(id)===promise)transfers.delete(id);}).catch(()=>{});}
    }
    const outcomes=await Promise.allSettled(all.map(row=>result.get(key(row))??transfers.get(identity(row))!));
    const failure=outcomes.find(value=>value.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
    if(outcomes.some(value=>value.status==='fulfilled'&&!value.value))return false;
    for(const value of outcomes)if(value.status==='fulfilled')result.set(key(value.value!),value.value!);
    return true;
   };
   const releasePair=()=>{pair=false;drain();};
   const ok=ports.combined?[await loadPhysicalCombined()]:await Promise.all([load(manifest.items,ports.profiles,'profile').finally(releasePair),load(manifest.bars,ports.candles,'candle').finally(releasePair)]);
   // Warm row hits still need an authoritative closing check: an independent
   // source correction need not notify this process's metadata TTL cache.
   metrics.manifestReads++;const after=await ports.manifest(scope,true);
   if(ok.every(Boolean)&&after.revision===manifest.revision){scopes.delete(scope);scopes.set(scope,manifest);while(scopes.size>16)scopes.delete(scopes.keys().next().value!);return {manifest,rows:manifest.items.map(row=>result.get(key(row)) as SourceRow),bars:manifest.bars.map(row=>result.get(key(row)) as CandleRow)};}
  }
  throw Error('Chart source changed during read; retry');
 };
 return {metrics,retainedBytes:()=>bytes,hasScope(scope:string){const manifest=scopes.get(scope);return !!manifest&&[...manifest.items,...manifest.bars].every(row=>rows.get(key(row))?.version===row.version);},read(scope:string){const active=pending.get(scope);if(active)return active;if(pending.size>=4)return Promise.reject(Error('Chart source is busy; retry'));const task=read(scope);pending.set(scope,task);void task.finally(()=>{if(pending.get(scope)===task)pending.delete(scope);}).catch(()=>{});return task;}};
}
