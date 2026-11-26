import { expect, test } from 'bun:test';
import { calculateRSI } from './indicators/indicators/momentum';
import { IndicatorEngine } from './engines/indicators/IndicatorEngine';
import { qqqSessionVwap } from './qqqSessionVwap';
import { qqqAtmIvObservation, qqqSnapshotAtmIv } from './qqqAtmIvObservation';
import { heatmapNetDelta, heatmapDisplayNetDelta } from './qqqHeatmapOverlays';
import { exposureValues, prepareAggregateGammaFrames, type ExposureFrame } from './qqqExposureWorkbench';
import { buildQqqIntradayDirectionalFactors, QQQ_INTRADAY_DIRECTIONAL_FACTORS as keys } from './engines/analysis/QqqIntradayDirectional';
import { buildQqqGammaModel } from './qqqGammaModel';
import { buildQqqGexResearchSurface, deriveWallConfirmation, type QqqGexResearchExpiry } from './engines/analysis/QqqGexResearch';
import { buildQqqPcsIntradayChartData } from '../components/Strategy/qqq/QqqPcsIntradayChart.shared';
import { GEXEngine } from './engines/structure/GEXEngine';
import type { PcsGexExpiry } from '../types/qqqGex';

const time=Date.parse('2026-10-09T14:00:00Z');
const iso=(t:number)=>new Date(t).toISOString();
const bar=(t=time-120000,close=100)=>({timestamp:iso(t),open:close,high:close+2,low:close-1,close,volume:100});
const row=(strike=100)=>({strike,callOi:100,putOi:50,callIv:.2,putIv:.25,callGex:10,putGex:5,totalGex:5,inputComplete:true,calculationVersion:'qqq-gex-full-1pct-usable-iv-v4',gexUnit:'per-1pct',isCallWall:false,isPutWall:false,isGammaFlip:false});
const expiry={expiryDate:'2026-10-12',dte:3,asOf:iso(time),fullGexProfile:[row(99),row(101)],fullGexProfileHistory:[]} as unknown as PcsGexExpiry;
const readRsi=(closes:number[])=>calculateRSI(closes,closes.map((_,i)=>i),14);
const factor=(value:number[],confidence=10)=>({value,confidence,source:{type:'raw' as const,api:'test'}});

test('Wilder published seed example and exact boundary values, not an approximate RS cap',()=>{
 const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
 expect(readRsi(prices).at(-1)?.value).toBeCloseTo(70.4641,4);
 expect(readRsi(Array.from({length:30},(_,i)=>100+i)).at(-1)?.value).toBe(100);
 expect(readRsi(Array.from({length:30},(_,i)=>100-i)).at(-1)?.value).toBe(0);
 expect(readRsi(Array(30).fill(100)).at(-1)?.value).toBe(50);
 expect(readRsi(prices.slice(0,14)).every(point=>point.value===null)).toBe(true);
});
test('invalid RSI observations reset warmup and never fabricate neutral/overbought readings',()=>{
 const series=calculateRSI([100,101,102,NaN,100,101,102,103],[0,1,2,3,4,5,6,7],3);
 expect(series.slice(0,7).every(point=>point.value===null)).toBe(true);
 expect(series[7].value).toBe(100);
 expect(calculateRSI([100,101],[0,1],0).every(point=>point.value===null)).toBe(true);
});
test('chart/monitor Wilder RSI matches at every prefix and future bars cannot change it',()=>{
 const closes=Array.from({length:70},(_,i)=>100+Math.sin(i/4)+i/20);
 const start=Date.parse('2026-10-09T13:30:00Z'), bars=closes.map((c,i)=>bar(start+i*120000,c));
 for(let n=15;n<=bars.length;n++){
  const asOf=iso(Date.parse(bars[n-1].timestamp)+120000);
  const prefix=buildQqqIntradayDirectionalFactors({asOf,bars:bars.slice(0,n),expiries:[]});
  expect(prefix.factors[keys.rsi].value).toBe(readRsi(closes.slice(0,n)).at(-1)!.value);
  expect(buildQqqIntradayDirectionalFactors({asOf,bars,expiries:[]}).factors).toEqual(prefix.factors);
 }
});
test('HV distinguishes missing, actual zero, arbitrary period, and invalid-window recovery',()=>{
 const e=new IndicatorEngine();
 expect(e.calculateHV(factor([100,101]),20)).toBeNull();
 expect(e.calculateHV(factor(Array(50).fill(100)),20)).toBe(0);
 expect(e.calculateHV(factor(Array(50).fill(100),0),20)).toBeNull();
 expect(e.calculateHV(factor([100,101,NaN,102]),2)).toBeNull();
 expect(e.calculateHV(factor([NaN,100,101,103]),2)).toBeGreaterThan(0);
 const history=e.calculateHVHistory(factor(Array(50).fill(100)),20);
 expect(history.slice(0,20).every(Number.isNaN)).toBe(true);
 expect(history.slice(20)).toEqual(Array(30).fill(0));
 expect(e.calculateIVRankFromHVProxy(.2,history).percentile).toBe(100);
});
test('zero HV cannot produce Infinity or a usable IV/HV factor',()=>{
 const e=new IndicatorEngine(), number=(value:number)=>({value,confidence:10,source:{type:'raw' as const,api:'test'}});
 const result=e.calculateVolatilityFactors(number(.2),number(0),factor([]));
 expect(result.iv_hv_ratio.value).toBeNull();expect(result.iv_hv_ratio.confidence).toBe(0);
});
test('VWAP unknown volume poisons only that session; true zero volume is not missing',()=>{
 const first=bar(), gap={...bar(time),volume:NaN}, after=bar(time+120000,110);
 const next=bar(Date.parse('2026-10-12T13:30:00Z'),120);
 const points=qqqSessionVwap([first,gap,after,next]);
 expect(points[0].value).toBeCloseTo(100+1/3,12);
 expect(points.slice(1,3).map(point=>point.value)).toEqual([null,null]);
 expect(points[3].value).toBeCloseTo(120+1/3,12);
 expect(qqqSessionVwap([first,{...gap,volume:0},after]).at(-1)?.value).toBeCloseTo(105+1/3,12);
});
test('ATM requires bilateral brackets and respects receipt/computation availability at every boundary',()=>{
 expect(qqqSnapshotAtmIv([row(80)],100)).toBe(0);
 expect(qqqSnapshotAtmIv([{...row(99),putIv:undefined},{...row(101),putIv:undefined}],100)).toBe(0);
 const delayed={...expiry,fullGexProfile:expiry.fullGexProfile.map(s=>({...s,computedAt:iso(time+120000),callReceivedAt:iso(time+60000)}))};
 for(const cutoff of [time,time+60000,time+119999])expect(qqqAtmIvObservation([delayed],[],[bar()],cutoff,'2026-10-09')[0].history).toEqual([]);
 expect(qqqAtmIvObservation([delayed],[],[bar()],time+120000,'2026-10-09')[0].history[0].time).toBe(time+120000);
});
test('strict and display Delta share freshness boundaries',()=>{
 const frame:ExposureFrame={time,missing:[],profiles:[{expiry:expiry.expiryDate,time:time-300000,strikes:expiry.fullGexProfile}]};
 expect(heatmapNetDelta(frame,100)).not.toBeNull();
 const stale={...frame,profiles:frame.profiles.map(p=>({...p,time:time-300001}))};
 expect(heatmapNetDelta(stale,100)).toBeNull();expect(heatmapDisplayNetDelta(stale,100).value).toBeNull();
});
test('5m aggregation is chronological, immutable and source corrections replace instead of double counting',()=>{
 const a=bar(time,100), b=bar(time+120000,110), corrected={...a,volume:150};
 const input=[b,a,corrected], saved=JSON.stringify(input);
 const result=buildQqqPcsIntradayChartData(input,[],undefined,undefined,[],'5m').normalizedBars[0];
 expect(result).toEqual({time:time/1000,open:100,high:112,low:99,close:110,volume:250});
 expect(JSON.stringify(input)).toBe(saved);
 const bad=buildQqqPcsIntradayChartData([a,{...b,volume:NaN}],[],undefined,undefined,[],'5m');
 expect(Number.isNaN(bad.normalizedBars[0].volume)).toBe(true);expect(bad.vwap).toEqual([]);
});
test('no zero-GEX side is promoted to a wall',()=>{
 const zero=[{strike:100,iv:.2,openInterest:0,gamma:0,bid:0,ask:0,mid:0,inTheMoney:false}];
 const result=GEXEngine.calculate(zero,zero,100,20,1,{scope:'full-chain',unit:'per-1pct',gammaFlipPrice:null});
 expect(result.callWallPrice).toBeNull();expect(result.putWallPrice).toBeNull();
 expect(result.points.every(point=>!point.isCallWall&&!point.isPutWall)).toBe(true);
});
test('same-version asynchronous aggregate is repriced at a common spot/time without modifying sources',async()=>{
 const frame:ExposureFrame={time,missing:[],profiles:[{expiry:expiry.expiryDate,time:time-120000,strikes:expiry.fullGexProfile},{expiry:'2026-10-13',time,strikes:expiry.fullGexProfile}]};
 const before=JSON.stringify(frame),signal=new AbortController().signal;
 const result=(await prepareAggregateGammaFrames([frame],()=>100,signal,async()=>{}))[0];
 const model=buildQqqGammaModel(frame.profiles.map(p=>({expiryDate:p.expiry,asOf:iso(p.time!),fullGexProfile:p.strikes})),100,iso(time),{includeSensitivity:false});
 const total=[...exposureValues(result,'gamma',100).values()].reduce<number>((sum,value)=>sum+value!,0);
 expect(total).toBeCloseTo(model.spotGamma!,6);expect(JSON.stringify(frame)).toBe(before);
 expect((await prepareAggregateGammaFrames([frame],()=>100,signal,async()=>{}))[0]).toBe(result);
 const stop=new AbortController();stop.abort();await expect(prepareAggregateGammaFrames([frame],()=>100,stop.signal,async()=>{})).rejects.toThrow();
});
test('aggregate missing Call keeps valid Put Gamma instead of fabricating zero',async()=>{
 const frame:ExposureFrame={time,missing:[],profiles:[{expiry:expiry.expiryDate,time,strikes:[{...row(),callIv:undefined,inputComplete:false}]},{expiry:'2026-10-13',time,strikes:[row()]}]};
 const result=(await prepareAggregateGammaFrames([frame],()=>100,new AbortController().signal,async()=>{}))[0];
 expect(result.profiles[0].strikes[0].putGex).toBeGreaterThan(0);
 expect(result.profiles[0].strikes[0].inputComplete).toBe(false);
 expect(result.profiles[0].strikes[0].putInputComplete).toBe(true);
 expect([...exposureValues(result,'gamma-put',100).values()][0]).toBeLessThan(0);
 expect([...exposureValues(result,'gamma',100).values()]).toEqual([null]);
});
test('touch candle extremes are excluded and never produce negative rejection',()=>{
 const bars=[{...bar(time),high:110,low:99,close:99},bar(time+120000,99),bar(time+240000,99),bar(time+360000,99)];
 expect(deriveWallConfirmation('put',100,bars).rejection5m).toBe(1);
 expect(deriveWallConfirmation('put',110,bars).rejection5m).toBe(0);
 expect(deriveWallConfirmation('put',100,bars.slice(0,2)).rejection5m).toBeNull();
});
test('market Flip is a shared spot-model root, independent of historical seller-label time',()=>{
 const profile=[{...row(90),callIv:.2,putIv:.2,callOi:0,putOi:100,callGex:0,putGex:100,totalGex:-100},{...row(110),callIv:.2,putIv:.2,callOi:100,putOi:0,callGex:100,putGex:0,totalGex:100}];
 const e={expiryDate:expiry.expiryDate,dte:3,spot:100,expectedMove:5,netGex:0,gammaFlip:null,callWallPrice:110,putWallPrice:90,callWallMagnitude:100,putWallMagnitude:100,profile,history:[]} as QqqGexResearchExpiry;
 const build=(labelAt?:string)=>buildQqqGexResearchSurface({expiries:[e],selectedExpiryDate:e.expiryDate,bars:[bar()],asOf:iso(time),labelAt,sessionClosed:false})!;
 const root=buildQqqGammaModel([{expiryDate:e.expiryDate,asOf:iso(time),fullGexProfile:profile}],100,iso(time),{includeSensitivity:false}).levels.zeroGamma;
 expect(build().market.factors.qqq_gex_market_flip.value).toBe(root);
 expect(build(iso(time-3600000)).market.factors.qqq_gex_market_flip.value).toBe(root);
 expect(build().market.factors.qqq_gex_market_strike_crossing.value).toBe(100);
 const missing={...e,profile:profile.map(point=>({...point,callIv:undefined,putIv:undefined}))};
 expect(buildQqqGexResearchSurface({expiries:[missing],selectedExpiryDate:e.expiryDate,bars:[bar()],asOf:iso(time),sessionClosed:false})!.market.factors.qqq_gex_market_flip.confidence).toBe(0);
});


test('single-expiry saved GEX is preserved independently of aggregate repricing',async()=>{
 const frame:ExposureFrame={time,missing:[],profiles:[{expiry:expiry.expiryDate,time,strikes:expiry.fullGexProfile}]};
 expect((await prepareAggregateGammaFrames([frame],()=>100,new AbortController().signal,async()=>{},true))[0]).toBe(frame);
});


test('monitor retains price samples with missing volume and fails closed for VWAP/volume confirmation',()=>{
 const start=Date.parse('2026-10-09T13:30:00Z');
 const bars=Array.from({length:25},(_,i)=>bar(start+i*120000,100+Math.sin(i/3)));
 bars[18]={...bars[18],volume:NaN};
 const result=buildQqqIntradayDirectionalFactors({asOf:iso(start+25*120000),bars,expiries:[]});
 expect(result.closedBars).toHaveLength(25);
 expect(result.factors[keys.rsi].value).toBe(readRsi(bars.map(bar=>bar.close)).at(-1)!.value);
 expect(result.factors[keys.vwap].confidence).toBe(0);
 expect(result.factors[keys.volumeRatio].confidence).toBe(0);
 expect(result.factors[keys.longVolumeOk].confidence).toBe(0);
 const corrected=buildQqqIntradayDirectionalFactors({asOf:iso(start+25*120000),bars:[...bars,{...bars[18],volume:100}],expiries:[]});
 expect(corrected.closedBars).toHaveLength(25);expect(corrected.factors[keys.vwap].confidence).toBeGreaterThan(0);
});


test('aggregate model cannot backdate computed sides before availability',async()=>{
 const frame:ExposureFrame={time,missing:[],profiles:[{expiry:expiry.expiryDate,time,strikes:[{...row(),computedAt:iso(time+1)}]},{expiry:'2026-10-13',time,strikes:[row()]}]};
 const result=(await prepareAggregateGammaFrames([frame],()=>100,new AbortController().signal,async()=>{}))[0];
 expect(result.profiles[0].strikes[0].callInputComplete).toBe(false);
 expect([...exposureValues(result,'gamma-call',100).values()]).toEqual([null]);
});


test('wall stability changes do not reset or conceal incomplete session VWAP',()=>{
 const bars=[bar(time-240000,90),bar(time-120000,100),bar(time,110),bar(time+120000,111)];
 const session=qqqSessionVwap(bars).at(-1)!.value!;
 expect(deriveWallConfirmation('put',100,bars,iso(time)).vwapDeviation).toBeCloseTo(111-session,12);
 expect(deriveWallConfirmation('put',100,[{...bars[0],volume:NaN},...bars.slice(1)],iso(time)).vwapDeviation).toBeNull();
});
