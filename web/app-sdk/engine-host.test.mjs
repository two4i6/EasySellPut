import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createHostEngine} from './engine-host.mjs';
const initial={protocol:1,framing:'host-jsonl-v1',operation:'app_fixture',arguments:{},context:{hostOperations:['get_quotes']}};
test('typed host calls preserve provenance, enforce declaration and finish once',async()=>{
 const input=new PassThrough();input.write(JSON.stringify(initial)+'\n');const frames=[];
 const output={write(line){const frame=JSON.parse(line);frames.push(frame);if(frame.type==='hostCall')input.write(JSON.stringify({type:'hostResult',id:frame.id,result:{success:true,data:{price:123.45,source:'fixture',asOf:null,delayMinutes:15}}})+'\n');}};
 const engine=await createHostEngine(input,output);
 try{
  const quote=await engine.call('get_quotes',{symbols:['QQQ']});assert.deepEqual(quote,{price:123.45,source:'fixture',asOf:null,delayMinutes:15});
  await assert.rejects(engine.call('clear_cache',{}),/Undeclared/);
  engine.finish(quote);assert.throws(()=>engine.finish(quote));
  assert.equal(frames.length,2);assert.deepEqual(frames[0].arguments,{symbols:['QQQ']});assert.equal(frames[1].result.delayMinutes,15);
 }finally{engine.close();input.destroy();}
});
test('mismatched replies and concurrent calls fail rather than corrupting the request',async()=>{
 const input=new PassThrough();input.write(JSON.stringify(initial)+'\n');let sent;
 const engine=await createHostEngine(input,{write(line){sent=JSON.parse(line);}});
 try{
  const pending=engine.call('get_quotes',{});await assert.rejects(engine.call('get_quotes',{}),/concurrent/);
  input.write(JSON.stringify({type:'hostResult',id:sent.id+1,result:{success:true,data:{}}})+'\n');
  await assert.rejects(pending,/Mismatched/);
 }finally{engine.close();input.destroy();}
});


test('source receipts preserve binary bytes and reject changed chunks; publication requires complete acknowledged writes',async()=>{
 const {readSnapshotReceipt,publishAppInput}=await import('./market.mjs');const {createHash}=await import('node:crypto');
 const bytes=Buffer.alloc(1048583);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
 const sha256=createHash('sha256').update(bytes).digest('hex'),receipt={receipt:'request-only',size:bytes.length,sha256};
 const chunks=[];let received=0;
 const engine={request:{context:{allowWrites:true}},async call(operation,args){
  if(operation==='read_market_snapshot'){const end=Math.min(args.offset+args.length,bytes.length);return {offset:args.offset,totalBytes:bytes.length,chunkBytes:end-args.offset,bodyBase64:bytes.subarray(args.offset,end).toString('base64'),nextOffset:end<bytes.length?end:null};}
  assert.equal(operation,'write_app_input');assert.equal(args.offset,received);const chunk=Buffer.from(args.bodyBase64,'base64');chunks.push(chunk);received+=chunk.length;
  return args.final?{committed:true,bytes:received,sha256:args.sha256}:{committed:false,nextOffset:received};
 }};
 assert.deepEqual(await readSnapshotReceipt(engine,receipt),bytes);
 await assert.rejects(readSnapshotReceipt(engine,{...receipt,sha256:'0'.repeat(64)}),/hash mismatch/);
 const published=await publishAppInput(engine,bytes);assert.equal(published.bytes,bytes.length);assert.deepEqual(Buffer.concat(chunks),bytes);
 await assert.rejects(publishAppInput({request:{context:{allowWrites:false}},call(){throw Error('Must not send');}},bytes),/write permission/);
 await assert.rejects(publishAppInput({request:{context:{allowWrites:true}},async call(){return {committed:false,nextOffset:-1};}},bytes),/acknowledgement/);
 await assert.rejects(readSnapshotReceipt({async call(){return {offset:0,totalBytes:1,chunkBytes:0,bodyBase64:'',nextOffset:0};}},{...receipt,size:1}),/sequence/);
});
