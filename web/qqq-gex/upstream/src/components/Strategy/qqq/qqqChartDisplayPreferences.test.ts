import { parseStoredPriceRange, parseStoredTimeRange } from './qqqChartDisplayPreferences';
import { expect, test } from 'bun:test';
import { parseQqqChartDisplayPreferences, qqqChartPreset } from './qqqChartDisplayPreferences';
test('restores both hidden and visible settings without losing defaults', () => {
 expect(parseQqqChartDisplayPreferences('{"rsi":true,"vwap":false}')).toEqual({ confirmation:true,trade_low:true,trade_high:true,markers:true,kc:true,rsi:true,vwap:false });
});
test('invalid storage cannot inject unknown settings or break chart initialization', () => {
 for (const value of [null, '{', '[]', 'null', '42']) expect(parseQqqChartDisplayPreferences(value)).toEqual(qqqChartPreset('simple'));
 expect(parseQqqChartDisplayPreferences('{"rsi":"false","unknown":true,"confirmation":false}')).toEqual({confirmation:false,trade_low:true,trade_high:true,markers:true,kc:true,rsi:true});
});

test('KC and structural zone preferences preserve explicit user choices',()=>{
 expect(parseQqqChartDisplayPreferences('{\"kc\":true,\"trade_low\":false}')).toMatchObject({kc:true,trade_low:false,trade_high:true,markers:true,rsi:true});
});

test('Gamma position persists one switch and migrates old individual flags',()=>{
 expect(parseQqqChartDisplayPreferences('{"gamma_position":true}')).toMatchObject({gamma_position:true});
 expect(parseQqqChartDisplayPreferences('{"model_zero_gamma":false,"volatility_trigger":true}')).toMatchObject({gamma_position:false});
 expect(parseQqqChartDisplayPreferences('{"model_zero_gamma":true,"volatility_trigger":true}')).toMatchObject({gamma_position:true});
 expect(parseQqqChartDisplayPreferences('{"gamma_position":false,"model_zero_gamma":true,"volatility_trigger":true}')).toMatchObject({gamma_position:false});
 expect(parseQqqChartDisplayPreferences('{"model_zero_gamma":true}')).not.toHaveProperty('model_zero_gamma');
});

test('display presets keep price/live and hide removed execution indicators', async () => {
 const { qqqChartPreset } = await import('./qqqChartDisplayPreferences');
 expect(qqqChartPreset('simple')).toMatchObject({price:false,live:false,directional_markers:false,gex_positive:true});
 expect(qqqChartPreset('structure')).toMatchObject({net_gex:false,gamma_flip:false,gex_positive:false,gex_negative:false,score:true});
 expect(qqqChartPreset('full').score).toBe(true);
});

test('overlapping wall switches merge only at the identical known price',async()=>{
 const {groupQqqChartDisplayItems}=await import('./qqqChartDisplayPreferences');
 const groups=groupQqqChartDisplayItems([
 {key:'king',label:'持仓集中位',value:'750',price:750,color:'blue'},
 {key:'call_wall',label:'看涨集中位',value:'750',price:750,color:'blue'},
 {key:'put_wall',label:'看跌集中位',value:'—',color:'orange'},
 {key:'gex_positive',label:'正',value:'1',color:'blue'},
 {key:'gex_negative',label:'负',value:'2',color:'orange'}]);
 expect(groups.map(g=>g.keys)).toEqual([['king','call_wall'],['put_wall'],['gex_positive','gex_negative']]);
 expect(groups[2]!.label).toBe('Call / Put 暴露');
});

test('fresh workspace uses simple defaults while existing explicit choices win',()=>{
 expect(parseQqqChartDisplayPreferences(null)).toMatchObject({vwap:false,price:false,king:false,call_wall:false,put_wall:false,gamma_position:false,rsi:true,kc:true,markers:true,gex_positive:true,gex_negative:true,net_gex:true});
 expect(parseQqqChartDisplayPreferences('{"rsi":false,"gex_positive":false}')).toMatchObject({rsi:false,gex_positive:false});
});

test('legacy saved combinations retain visible omitted flags instead of receiving new defaults',()=>{
 expect(parseQqqChartDisplayPreferences('{"vwap":false}')).not.toHaveProperty('net_gex');
 expect(parseQqqChartDisplayPreferences('{"vwap":false}')).not.toHaveProperty('gex_positive');
});

test('both renderers share strict numeric range parsing and retain inverted native price scales',()=>{
 expect(parseStoredPriceRange('{"from":750,"to":730}')).toEqual({from:750,to:730});
 expect(parseStoredTimeRange('{"from":750,"to":730}')).toBeNull();
 for(const raw of ['{"from":null,"to":730}','{"from":"700","to":730}','{"from":730,"to":730}','bad',null]){
  expect(parseStoredPriceRange(raw)).toBeNull();expect(parseStoredTimeRange(raw)).toBeNull();
 }
});
