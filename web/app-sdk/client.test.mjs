import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppClient } from './client.mjs';
const page={href:'http://127.0.0.1:12345/'+'A'.repeat(64)+'/nested/index.html'};
test('client uses tokenized app-scoped endpoints without credentials or external redirects',async()=>{
 const previous=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({success:true,data:{price:123.4567,missing:null}}));};
 try{
  const client=createAppClient(page);await client.list();const result=await client.call('get_qqq_gex_retained_summary');
  assert.equal(result.data.price,123.4567);assert.equal(result.data.missing,null);
  assert.equal(calls[0].url,'http://127.0.0.1:12345/'+'A'.repeat(64)+'/host/catalog');
  assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[1].options.body),{operation:'get_qqq_gex_retained_summary',arguments:{}});
 }finally{globalThis.fetch=previous;}
 assert.throws(()=>createAppClient({href:'https://foreign.invalid/'+ 'A'.repeat(64)+'/index.html'}));
});
test('caller cancellation reaches the request and does not create a background timer',async()=>{
 const previous=globalThis.fetch;let aborted=false;
 globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true}));
 try{await assert.rejects(createAppClient(page).list({timeout:10}),{name:'AbortError'});assert.equal(aborted,true);}
 finally{globalThis.fetch=previous;}
});
