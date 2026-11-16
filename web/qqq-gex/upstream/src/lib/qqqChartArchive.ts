import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validQqqChartArchiveIndex,QQQ_CHART_ARCHIVE_RAW_LIMIT,type ChartArchiveReference} from './qqqChartArchiveCodec';
import {decodeQqqChartProfile,QQQ_CHART_PROFILE_FIELDS} from './qqqChartProfileTransport';
import type {SourceManifest,SourceRow,CandleRow} from './qqqVersionedHistoryStore';
type Chunk={sha256:string;rawBytes:number;compressedBytes:number;gzip:string};
function decodeChunk(raw:Chunk,part:ChartArchiveReference){
 if(!raw||raw.sha256!==part.sha256||raw.rawBytes!==part.rawBytes||raw.compressedBytes!==part.compressedBytes||typeof raw.gzip!=='string'||raw.gzip.length>5_700_000)throw Error('Invalid chart archive chunk');
 const base64=raw.gzip.replace(/\s/g,'');
 const padding=base64.indexOf('=');
 if(base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(base64)||!/^={0,2}$/.test(base64.slice(padding<0?base64.length:padding)))throw Error('Invalid archive encoding');
 const compressed=Buffer.from(base64,'base64');if(compressed.length!==part.compressedBytes)throw Error('Archive compressed size mismatch');
 const body=gunzipSync(compressed,{maxOutputLength:QQQ_CHART_ARCHIVE_RAW_LIMIT});
 if(body.length!==part.rawBytes||createHash('sha256').update(body).digest('hex')!==part.sha256)throw Error('Archive integrity mismatch');
 const value=JSON.parse(body.toString('utf8'));
 if(value.version!==1||!Array.isArray(value.profiles)||!Array.isArray(value.candles)||value.profiles.length!==part.profileCount||value.candles.length!==part.candleCount)throw Error('Invalid archive rows');
 const profiles=value.profiles.map(({packed_profile,...row}:Omit<SourceRow,'profile'>&{packed_profile:unknown})=>({...row,profile:decodeQqqChartProfile(packed_profile,QQQ_CHART_PROFILE_FIELDS)}));
 if(profiles.some((row:SourceRow)=>row.expiry_date!==part.expiryDate))throw Error('Wrong archive expiry');
 return {profiles,candles:value.candles as CandleRow[]};
}
export function createQqqChartArchiveReader(rpc:<T>(name:string,args:Record<string,unknown>)=>Promise<T>,batch=true){
 const pending=new Map<string,Promise<{profiles:SourceRow[];candles:CandleRow[]}>>();
 return async(scope:string,manifest:SourceManifest,schedule:<T>(fetch:()=>Promise<T>)=>Promise<T>)=>{
  const index=manifest.archive;
  if(!validQqqChartArchiveIndex(index)||index.parts.reduce((n,p)=>n+p.profileCount,0)!==manifest.items.length||index.parts.reduce((n,p)=>n+p.candleCount,0)!==manifest.bars.length)throw Error('Invalid chart archive index');
  const {date}=JSON.parse(scope);
  const groups:ChartArchiveReference[][]=[];
  for(let i=0;i<index.parts.length;i+=batch?2:1)groups.push(index.parts.slice(i,i+(batch?2:1)));
  const results:Array<{profiles:SourceRow[];candles:CandleRow[]}> = [];
  // Two bounded physical RPCs; each includes at most two compressed chunks.
  let next=0;
  const workers=Array.from({length:Math.min(2,groups.length)},async()=>{
   while(next<groups.length){const position=next++,parts=groups[position];
    const id=(part:ChartArchiveReference)=>`${date}:${index.revision}:${part.index}:${part.sha256}`;
    const owned=parts.filter(part=>!pending.has(id(part)));
    if(owned.length){
     const task=schedule(async()=>{
     const args={p_policy_id:'qqq-pcs-intraday-v1',p_date:date,p_revision:index.revision};
     let chunks:Chunk[];
     if(batch){
      const rows=await rpc<Array<{part_index:number;sha256:string;raw_bytes:number;gzip_bytes:number;gzip:string}>>('qqq_chart_archive_chunk_batch_v1',{...args,p_indices:owned.map(p=>p.index)});
      if(!Array.isArray(rows)||rows.length!==owned.length||new Set(rows.map(row=>row.part_index)).size!==owned.length)throw Error('Incomplete archive chunk batch');
      chunks=owned.map(part=>{const row=rows.find(row=>row.part_index===part.index);if(!row)throw Error('Wrong archive part');return {sha256:row.sha256,rawBytes:row.raw_bytes,compressedBytes:row.gzip_bytes,gzip:row.gzip};});
     }else chunks=[await rpc<Chunk>('qqq_chart_archive_chunk_v1',{...args,p_index:owned[0].index})];
     const values=owned.map((part,i)=>decodeChunk(chunks[i],part));
     return values;
     });
     owned.forEach((part,i)=>{const key=id(part),value=task.then(rows=>rows[i]);pending.set(key,value);void value.finally(()=>{if(pending.get(key)===value)pending.delete(key);}).catch(()=>{});});
    }
    const values=await Promise.all(parts.map(part=>pending.get(id(part))!));
    results[position]={profiles:values.flatMap(value=>value.profiles),candles:values.flatMap(value=>value.candles)};
   }
  });
  const settled=await Promise.allSettled(workers),failure=settled.find(value=>value.status==='rejected');
  if(failure?.status==='rejected')throw failure.reason;
  return {profiles:results.flatMap(value=>value.profiles),candles:results.flatMap(value=>value.candles)};
 };
}
