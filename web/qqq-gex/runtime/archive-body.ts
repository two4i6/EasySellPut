import {gzipSync,gunzipSync,brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {createHash,timingSafeEqual} from 'node:crypto';

// Opt-in prototype. Default writes remain readable by old clients. Readers accept
// legacy TEXT/gzip and v2 independently of this write setting.
const magic=Buffer.from('QGEX');
const headerBytes=48;
export function archiveWriteCodec(codec=process.env.MEILI_GEX_ARCHIVE_CODEC??'gzip-v1'){
 if(codec!=='gzip-v1'&&codec!=='brotli-v2')throw Error('Unsupported GEX write codec');
 return codec;
}
export function archiveEncoding(bytes:Uint8Array){return Buffer.from(bytes).subarray(0,4).equals(magic)?'brotli-v2':'gzip-v1';}
export function encodeArchiveBytes(body:Uint8Array,codec?:string){
 if(body.byteLength>128*1024*1024)throw Error('Archive body exceeds decoded limit');
 const raw=Buffer.from(body);
 if(archiveWriteCodec(codec)==='gzip-v1')return gzipSync(raw,{level:3});
 const compressed=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_LGWIN]:22}});
 const header=Buffer.alloc(headerBytes);magic.copy(header);header[4]=2;header[5]=1;
 header.writeUInt32LE(raw.length,8);header.writeUInt32LE(compressed.length,12);
 createHash('sha256').update(raw).digest().copy(header,16);
 return Buffer.concat([header,compressed]);
}
export const encodeArchiveBody=(body:string,codec?:string)=>encodeArchiveBytes(Buffer.from(body),codec);
export function decodeArchiveBytes(value:unknown,maxBytes=128*1024*1024):Buffer{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>128*1024*1024)throw Error('Invalid archive decoded limit');
 if(typeof value==='string'){if(Buffer.byteLength(value)>maxBytes)throw Error('Archive body exceeds decoded limit');return Buffer.from(value);}
 if(!(value instanceof Uint8Array))throw Error('Unsupported archive body encoding');
 if(value.byteLength>maxBytes+65536+headerBytes)throw Error('Archive encoded body exceeds limit');
 const bytes=Buffer.from(value);
 if(bytes.subarray(0,4).equals(magic)){
  if(bytes.length<headerBytes||bytes.length>maxBytes+65536+headerBytes||bytes[4]!==2||bytes[5]!==1||bytes[6]!==0||bytes[7]!==0)throw Error('Invalid GEX v2 archive header');
  const length=bytes.readUInt32LE(8),encoded=bytes.readUInt32LE(12);
  if(length>maxBytes||encoded!==bytes.length-headerBytes)throw Error('GEX v2 archive length mismatch');
  const info=brotliDecompressSync(bytes.subarray(headerBytes),{info:true,maxOutputLength:Math.max(1,length)});
  const decoded=info.buffer;
  if(decoded.length!==length||!timingSafeEqual(createHash('sha256').update(decoded).digest(),bytes.subarray(16,48)))throw Error('GEX v2 archive integrity failed');
  // Node's Brotli convenience decoder accepts trailing bytes. The envelope's
  // encoded length and hash alone cannot detect them; require consumed length.
  if(info.engine.bytesWritten!==encoded)throw Error('GEX v2 archive has trailing bytes');
  return decoded;
 }
 if(bytes.length>maxBytes+65536||bytes.length<2||bytes[0]!==31||bytes[1]!==139)throw Error('Unsupported archive body encoding');
 const decoded=gunzipSync(bytes,{maxOutputLength:Math.max(1,maxBytes)});
 if(decoded.length>maxBytes)throw Error('Archive body exceeds decoded limit');return decoded;
}
export const decodeArchiveBody=(value:unknown,maxBytes=128*1024*1024)=>decodeArchiveBytes(value,maxBytes).toString('utf8');
