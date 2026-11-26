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
test('presentation changes use a caller-owned lifetime and cancel their pending wait',async()=>{
 const previous=globalThis.fetch;const controller=new AbortController();const urls=[];let pending;
 globalThis.fetch=(url,options)=>{
  urls.push(String(url));
  if(urls.length===1)return Promise.resolve(new Response(JSON.stringify({version:3,value:{language:'en-US',theme:{dark:true,reducedMotion:true}}})));
  return new Promise((resolve,reject)=>{pending=options.signal;options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});});
 };
 try{
  const changes=createAppClient(page).presentationChanges(controller.signal);
  const first=await changes.next();assert.equal(first.value.value.language,'en-US');assert.equal(first.value.version,3);
  const waiting=changes.next();await new Promise(resolve=>queueMicrotask(resolve));controller.abort();
  assert.equal((await waiting).done,true);assert.equal(pending.aborted,true);assert.match(urls[1],/host\/presentation\?version=3$/);
 }finally{controller.abort();globalThis.fetch=previous;}
});
