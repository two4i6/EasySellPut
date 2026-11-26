import {expect,test} from 'bun:test';
import {encodeExposureWire,decodeExposureWire,serializeExposureWire,parseExposureWire} from './qqqExposureWire';
import type {ExposureHistoryDay} from './qqqExposureHistoryModel';
const day={date:'2026-10-09',observedAt:'2026-10-10T01:00:00Z',revision:'exact-r1',bars:[],items:[{
 capturedAt:'2026-10-09T13:30:00Z',expiryDate:'2026-10-12',dte:3,profile:[
 {strike:750,callGex:1.234567891234567,putGex:1e-78,totalGex:-1e100,callOi:0,isCallWall:false,isPutWall:false,isGammaFlip:false,callIv:0.123456789},
 {strike:751,callGex:0,putGex:1,totalGex:-1,isCallWall:false,isPutWall:false,isGammaFlip:false,putReceivedAt:'2026-10-09T13:30:02.546Z',inputComplete:false},
 ]}]} satisfies ExposureHistoryDay;
test('negotiated rows survive JSON exactly, including optional fields and metadata',async()=>{
 const serialized=JSON.stringify(encodeExposureWire(day));
 const restored=await decodeExposureWire(JSON.parse(serialized));
 expect(restored).toEqual(day);expect(restored.items[0].profile[0]).not.toHaveProperty('putIv');
 expect(day.items[0].profile[0].callGex).toBe(1.234567891234567);
});
test('ordinary JSON remains backward compatible and malformed row schemas fail closed',async()=>{
 expect(await decodeExposureWire(day)).toBe(day);
 for(const mutate of [(wire:any)=>wire.exposureFormat='rows-v2',(wire:any)=>wire.schemas[0].push('strike'),(wire:any)=>wire.items[0].profile[0].pop(),(wire:any)=>wire.schemas[0][0]='__proto__']){
  const wire=encodeExposureWire(day);mutate(wire);await expect(decodeExposureWire(wire)).rejects.toThrow('Invalid exposure');
 }
});
test('large hydration yields and cancellation never returns a partial day',async()=>{
 const wire=encodeExposureWire({...day,items:Array.from({length:1500},()=>day.items[0])});
 const controller=new AbortController();let yields=0;
 await expect(decodeExposureWire(wire,controller.signal,async()=>{yields++;controller.abort();})).rejects.toThrow();
 expect(yields).toBe(1);
});
test('line transport is lossless, handles empty days and rejects incomplete final rows',async()=>{
 expect(await parseExposureWire(serializeExposureWire(day))).toEqual(day);
 const empty={...day,items:[]};expect(await parseExposureWire(serializeExposureWire(empty))).toEqual(empty);
 const lines=serializeExposureWire(day);await expect(parseExposureWire(lines.slice(0,-1))).rejects.toThrow();
 const controller=new AbortController();
 await expect(parseExposureWire(lines,controller.signal,async()=>controller.abort())).rejects.toThrow();
});

test('dictionary lines intern metadata and omit constants without losing values or optional fields',async()=>{
 const source:ExposureHistoryDay={...day,items:[{...day.items[0],profile:Array.from({length:200},(_,i)=>({...day.items[0].profile[i%2],strike:700+i,calculationVersion:'qqq-gex-full-1pct-usable-iv-v4',gexUnit:'per-1pct',computedAt:'2026-10-09T13:30:03.123Z'}))}]};
 const legacy=serializeExposureWire(source),compact=serializeExposureWire(source,true);
 expect(compact.length).toBeLessThan(legacy.length*.65);
 const restored=await parseExposureWire(compact);
 expect(restored).toEqual(source);
 expect(restored.items[0].profile[0]).not.toHaveProperty('putIv');
 expect(restored).not.toHaveProperty('strings');expect(restored.items[0]).not.toHaveProperty('constants');
 const lines=compact.split('\n').map(line=>JSON.parse(line));
 lines[0].strings=[];
 await expect(parseExposureWire(lines.map(line=>JSON.stringify(line)).join('\n'))).rejects.toThrow('Invalid exposure string');
 const valid=compact.split('\n').map(line=>JSON.parse(line));
 valid[1].constants[0][1].push(valid[1].constants[0][1][0]);
 await expect(parseExposureWire(valid.map(line=>JSON.stringify(line)).join('\n'))).rejects.toThrow('Invalid exposure constants');
});
