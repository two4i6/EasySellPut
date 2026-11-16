import {expect,test} from 'bun:test';
import {heatmapCellInputStatus,heatmapCoverage,heatmapDefinition,heatmapIntensity,heatmapLegendValue,parseHeatmapContrast} from './qqqHeatmapPresentation';
import {exposureValues,type ExposureFrame} from './qqqExposureWorkbench';
const point=(strike:number,overrides:Record<string,unknown>={})=>({strike,callGex:12,putGex:5,totalGex:7,callOi:1,putOi:2,callIv:.2,putIv:.3,calculationVersion:'qqq-gex-full-1pct-usable-iv-v4',gexUnit:'per-1pct',inputComplete:false,...overrides});
const frame=(points:any[],missing:string[]=[]):ExposureFrame=>({time:Date.parse('2026-10-12T19:44:00Z'),profiles:[{expiry:'2026-10-12',strikes:points}],missing});
test('contrast preference reads the plain string written by stored preferences and older JSON strings',()=>{
 for(const raw of ['absolute','"absolute"'])expect(parseHeatmapContrast(raw)).toBe('absolute');
 for(const raw of [null,'enhanced','invalid'])expect(parseHeatmapContrast(raw)).toBe('enhanced');
});
test('inspection explains the selected sides without repairing missing inputs or rejecting zero OI',()=>{
 const f=frame([point(745,{putIv:1e-5}),point(746,{callOi:0,callIv:undefined,putOi:undefined})],['2026-10-13']),before=JSON.stringify(f);
 expect(heatmapCellInputStatus(f,745,'gamma')).toBe('Call OI / IV 有效 · Put IV 无效（下限值） · 缺少 1 个到期日');
 expect(heatmapCellInputStatus(f,745,'gamma-call')).toBe('Call OI / IV 有效 · 缺少 1 个到期日');
 expect(heatmapCellInputStatus(f,746,'gamma')).toBe('Call OI / IV 有效 · Put 持仓量缺失 · 缺少 1 个到期日');
 expect(heatmapCellInputStatus(f,747,'gamma-put')).toContain('Put 未返回该行权价');
 expect(heatmapCellInputStatus(undefined,745,'gamma')).toContain('没有可用');
 expect(JSON.stringify(f)).toBe(before);
});
test('coverage follows actual visible field values, keeps valid zero, and does not recover invalid IV',()=>{
 const f=frame([point(745,{callIv:1e-5}),point(746,{totalGex:0}),point(747,{callOi:undefined}),point(748),point(900,{putIv:0})],['2026-10-13']);
 const values=exposureValues(f,'gamma',745);
 expect(heatmapCoverage(f,[745,746,747,748,749],values)).toEqual({total:5,valid:2,unavailable:3,missingOi:1,invalidIv:1,unrecordedSide:0,missingExpiries:1});
 expect(values.get(745)).toBeNull();expect(values.get(746)).toBe(0);expect(heatmapCoverage(f,[745],null)).toBeNull();
});
test('legacy saved zero/missing side stays visibly unknown and never implies full input quality',()=>{
 const f=frame([point(750,{calculationVersion:undefined,gexUnit:undefined,putOi:0,putIv:undefined,inputComplete:undefined})]);
 expect(heatmapCoverage(f,[750],exposureValues(f,'gamma',750))?.unrecordedSide).toBe(1);
 expect(heatmapDefinition(f).label).toContain('历史旧口径');
 const normalized=frame([point(750,{calculationVersion:'qqq-exposure-gamma-model-v1'})]);
 expect(heatmapDefinition(normalized,f).legacy).toBe(true);expect(heatmapDefinition(normalized,f).detail).toContain('无法恢复');
 expect(heatmapDefinition(frame([point(750)])).label).toBe('实际剩余期限 · 每1%变动');
 expect(heatmapDefinition(frame([point(750,{calculationVersion:'other'})])).label).toContain('不可直接比较');
});
test('enhanced display reveals weak signed values without changing raw values, zeros, invalid cells or legend units',()=>{
 const maximum=11_646_214_314,value=10_000_000;
 expect(heatmapIntensity(value,maximum,'enhanced')).toBeGreaterThan(heatmapIntensity(value,maximum,'absolute'));
 for(const mode of ['absolute','enhanced'] as const)for(const v of [-maximum,-value,-1,0,1,value,maximum]){
  const strength=Math.sign(v)*heatmapIntensity(v,maximum,mode);
  expect(heatmapLegendValue(strength,maximum,mode)).toBeCloseTo(v,3);
 }
 expect(heatmapIntensity(0,maximum,'enhanced')).toBe(0);expect(heatmapIntensity(NaN,maximum,'enhanced')).toBe(0);
 const f=frame([point(745,{callIv:1e-5}),point(746,{totalGex:-value})]),before=JSON.stringify(f);
 const values=exposureValues(f,'gamma',745);for(const v of values.values())if(v!==null)heatmapIntensity(v,maximum,'enhanced');
 expect(values.get(745)).toBeNull();expect(values.get(746)).toBe(-value);expect(JSON.stringify(f)).toBe(before);
});
