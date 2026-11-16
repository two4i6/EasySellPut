import { expect, test } from 'bun:test';
import { buildQqqChartObservationBands as build } from './qqqChartObservationBands';
const start=Date.parse('2026-10-08T13:30:00Z')/1000;
const bars=(n=40)=>Array.from({length:n},(_,i)=>({time:start+i*120,close:100,high:100.3,low:99.7,volume:100}));
const input=(n=40)=>({bars:bars(n),vwap:[],wallHistory:[{time:start,putWallPrice:99.8,callWallPrice:100.3}],gammaFlip:[],asOf:start+n*120});
test('KC warms up for 20 complete bars, yields known envelope, and excludes unfinished bars',()=>{
 const full=build(input());expect(full.channel).toHaveLength(21);
 expect(full.channel[0]!.basis).toBe(100);expect(full.channel[0]!.lower).toBeCloseTo(98.8);expect(full.channel[0]!.upper).toBeCloseTo(101.2);
 expect(full.channel[0]!.connect).toBe(false);
 const pending=build({...input(),asOf:start+19*120+119});expect(pending.channel).toHaveLength(0);
});
test('source changes require two complete bars; expired walls disappear immediately',()=>{
 const result=build(input());expect(result.zones[0]!.low).toBeNull();
 expect(result.zones[1]!.low?.source).toBe('Put墙');
 const expired=result.zones.find(p=>p.time===start+6*120)!;
 expect(expired.gexStale).toBe(true);expect(expired.low).toBeNull();
 expect(result.zones.find(p=>p.time===start+7*120)!.low?.source).toBe('日内低');
});
test('future snapshots and bars never rewrite a causal prefix',()=>{
 const fullInput={...input(),wallHistory:[...input().wallHistory,{time:start+25*120,putWallPrice:99.9,callWallPrice:100.3}]};
 const full=build(fullInput);const cutoff=start+21*120;
 const prefix=build({...fullInput,asOf:cutoff+120});
 expect(prefix.channel).toEqual(full.channel.filter(p=>p.time<=cutoff));expect(prefix.zones).toEqual(full.zones.filter(p=>p.time<=cutoff));
});
test('price invalidation removes the held zone without waiting for another source',()=>{
 const b=bars(8);b[4]={...b[4]!,close:98.8,high:99.1,low:98.7};
 const result=build({...input(8),bars:b});expect(result.zones.find(p=>p.time===b[4]!.time)!.low).toBeNull();
});
test('new session and price gaps reset confirmation/channel, without connecting across gaps',()=>{
 const a=input(30);const second=bars(22).map(b=>({...b,time:b.time+86400}));
 const result=build({...a,bars:[...a.bars,...second],asOf:start+86400+22*120});
 expect(result.channel.find(p=>p.time===second[19]!.time)!.connect).toBe(false);
 expect(result.zones.find(p=>p.time===second[2]!.time)!.low).toBeNull();
 const gap=build({...input(60),bars:bars(60).filter((_,i)=>i<25||i>29)});
 expect(gap.channel.find(p=>p.time===start+49*120)!.connect).toBe(false);
});


test('overlapping held zones are hidden instead of presenting an actionable interval',()=>{
 const source=input(8);const result=build({...source,wallHistory:[...source.wallHistory,{time:start+4*120,putWallPrice:100.08,callWallPrice:100.3}]});
 const point=result.zones.find(p=>p.time===start+4*120)!;
 expect(point.reason).toBe('OVERLAP');expect(point.low).toBeNull();expect(point.high).toBeNull();
});

test('partial live windows label local extrema honestly instead of claiming full-session levels',()=>{
 const result=build({...input(),bars:bars().map(b=>({...b,time:b.time+3600})),wallHistory:[],asOf:start+3600+40*120});
 expect(result.zones.some(p=>p.low?.source==='窗口低')).toBe(true);
 expect(result.zones.some(p=>p.low?.source==='日内低'||p.high?.source==='日内高')).toBe(false);
});
