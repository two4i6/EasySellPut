import {expect,test} from 'bun:test';
import {exposureValues,prepareExposureField,type ExposureFrame} from './qqqExposureWorkbench';
import {heatmapCoverage} from './qqqHeatmapPresentation';
const point={isCallWall:false,isPutWall:false,isGammaFlip:false,strike:745,callOi:10,putOi:20,callIv:.000010000000000000003,putIv:.2,callGex:0,putGex:123.456789,totalGex:-123.456789,inputComplete:false,calculationVersion:'qqq-gex-full-1pct-usable-iv-v4',gexUnit:'per-1pct'};
const frame:ExposureFrame={time:Date.parse('2026-10-12T19:44:00Z'),missing:[],profiles:[{expiry:'2026-10-12',strikes:[point]}]};
test('a valid Put remains visible independently while Call and net stay unknown; raw inputs never change',async()=>{
 const before=JSON.stringify(frame);
 expect(exposureValues(frame,'gamma',745).get(745)).toBeNull();
 expect(exposureValues(frame,'gamma-call',745).get(745)).toBeNull();
 const put=exposureValues(frame,'gamma-put',745);expect(put.get(745)).toBe(-123.456789);
 expect(heatmapCoverage(frame,[745],put,'put')?.invalidIv).toBe(0);
 const field=await prepareExposureField({frames:[frame],mode:'gamma-put',metric:'gex',spotAt:()=>745,selectedStrikes:new Set([745]),comparisons:false,activity:false},new AbortController().signal);
 expect([...field.cells[0]!.values]).toEqual([...put]);expect(JSON.stringify(frame)).toBe(before);
});
test('side display rejects unknown legacy units, invalid OI, negative saved magnitude and mixed definitions',()=>{
 for(const override of [{calculationVersion:undefined},{gexUnit:undefined},{putOi:undefined},{putOi:-1},{putIv:undefined},{putGex:-2},{putGex:Infinity}]){
  const f={...frame,profiles:[{expiry:'2026-10-12',strikes:[{...point,...override}]}]};
  expect(exposureValues(f,'gamma-put',745).get(745)).toBeNull();
 }
 const f={...frame,profiles:[...frame.profiles,{expiry:'2026-10-13',strikes:[{...point,calculationVersion:'qqq-gex-full-1pct-v3'}]}]};
 expect(exposureValues(f,'gamma-put',745).get(745)).toBeNull();
 const zero={...frame,profiles:[{expiry:'2026-10-12',strikes:[{...point,putOi:0,putIv:undefined,putGex:0}]}]};
 expect(exposureValues(zero,'gamma-put',745).get(745)).toBe(0);
 const normalized={...frame,profiles:[{expiry:'2026-10-12',strikes:[{...point,callIv:.2,inputComplete:true,calculationVersion:'qqq-exposure-gamma-model-v1'}]}]};
 expect(exposureValues(normalized,'gamma-put',745).get(745)).toBe(-123.456789);
 normalized.profiles[0]!.strikes[0]!.inputComplete=false;
 expect(exposureValues(normalized,'gamma-put',745).get(745)).toBeNull();
});
