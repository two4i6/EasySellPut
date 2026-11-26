import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readRequest, writeResult } from './engine.mjs';
const request={protocol:1,operation:'get_qqq_gex_retained_summary',arguments:{},context:{dataDirectory:'/fixture/中文 data',appVersion:'1.0.0'}};
test('exact UTF-8 and financial values survive the shared engine boundary',async()=>{
 const actual=await readRequest(Readable.from([Buffer.from(JSON.stringify(request))]));assert.deepEqual(actual,request);
 let output='';writeResult({price:123.4567,source:'fixture',asOf:'2026-01-02T16:00:00Z',missing:null},{write:b=>output+=b});
 assert.deepEqual(JSON.parse(output),{price:123.4567,source:'fixture',asOf:'2026-01-02T16:00:00Z',missing:null});
});
test('missing protocol context, oversized input/output and invalid UTF-8 fail closed',async()=>{
 await assert.rejects(readRequest(Readable.from([Buffer.from('{}')])));
 await assert.rejects(readRequest(Readable.from([Buffer.alloc(1048577)])));
 await assert.rejects(readRequest(Readable.from([Buffer.from([0xff])])));
 assert.throws(()=>writeResult('x'.repeat(17*1024*1024)));
});
