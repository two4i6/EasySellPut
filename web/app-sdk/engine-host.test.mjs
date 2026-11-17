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
