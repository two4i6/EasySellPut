/** Request-owned source/input transport. No providers, filesystem paths, socket or polling loop. */
import {createHash} from 'node:crypto';
const maximum=128*1024*1024,chunkSize=1048576;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
export async function readSnapshotReceipt(engine,receipt){
 if(!receipt||!Number.isInteger(receipt.size)||receipt.size<0||receipt.size>maximum||typeof receipt.receipt!=='string'||receipt.receipt.length>64||typeof receipt.sha256!=='string'||!/^[0-9a-fA-F]{64}$/.test(receipt.sha256))throw Error('Invalid source receipt');
 const chunks=[];let offset=0;
 while(offset<receipt.size){
  const part=await engine.call('read_market_snapshot',{receipt:receipt.receipt,offset,length:chunkSize});
  if(typeof part.bodyBase64!=='string')throw Error('Invalid source chunk');
  const chunk=Buffer.from(part.bodyBase64,'base64'),next=offset+chunk.length;
  if(part.offset!==offset||chunk.length!==part.chunkBytes||part.totalBytes!==receipt.size||chunk.length<1||chunk.length>chunkSize||next>receipt.size||part.nextOffset!==(next<receipt.size?next:null))throw Error('Invalid source chunk sequence');
  chunks.push(chunk);offset=next;
 }
 const bytes=Buffer.concat(chunks,offset);if(hash(bytes)!==receipt.sha256.toUpperCase())throw Error('Source snapshot hash mismatch');return bytes;
}
export async function openMarketSnapshot(engine,arguments_){
 const opened=await engine.call('open_market_snapshot',arguments_);
 const body=await readSnapshotReceipt(engine,opened);
 return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),raw:opened.raw};
}
export async function publishAppInput(engine,value){
 if(!engine.request.context.allowWrites){const error=Error('Explicit write permission required');error.code='permission_denied';throw error;}
 const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);
 if(bytes.length<1||bytes.length>maximum)throw Error('App input exceeds bounds');
 const sha256=hash(bytes);
 for(let offset=0;offset<bytes.length;){
  const next=Math.min(bytes.length,offset+chunkSize),final=next===bytes.length;
  const reply=await engine.call('write_app_input',{offset,totalBytes:bytes.length,sha256,bodyBase64:bytes.subarray(offset,next).toString('base64'),final});
  if(reply.committed!==final||(!final&&reply.nextOffset!==next)||(final&&(reply.bytes!==bytes.length||reply.sha256?.toUpperCase()!==sha256)))throw Error('Invalid input publication acknowledgement');
  offset=next;
 }
 return {bytes:bytes.length,sha256};
}
