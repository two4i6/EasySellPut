import {gzipSync,gunzipSync} from 'node:zlib';
/** v1: SQLite TEXT is legacy UTF-8 JSON; BLOB is bounded gzip of the identical bytes. */
export const encodeArchiveBody=(body:string)=>gzipSync(body,{level:3});
export function decodeArchiveBody(value:unknown,maxBytes=128*1024*1024):string{
 if(typeof value==='string'){if(Buffer.byteLength(value)>maxBytes)throw Error('Archive body exceeds decoded limit');return value;}
 if(!(value instanceof Uint8Array)||value.byteLength>maxBytes||value[0]!==31||value[1]!==139)throw Error('Unsupported archive body encoding');
 return gunzipSync(value,{maxOutputLength:maxBytes}).toString('utf8');
}
