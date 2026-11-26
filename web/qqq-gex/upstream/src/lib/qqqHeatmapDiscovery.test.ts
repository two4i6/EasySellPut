import { expect, test } from 'bun:test';
import { acquireHeatmapDiscovery, cachedHeatmapDiscovery, discoveryIndexAt, prepareHeatmapDiscovery, scenarioExpectedBands, scenarioExpectedBandsFromInput, snapshot25DeltaSkew } from './qqqHeatmapDiscovery';
import { exposureConcentrationLevels, exposureSpotIndex, prepareAggregateGammaFrames, type ExposureFrame } from './qqqExposureWorkbench';
import { qqqGammaExpiryTime } from './qqqGammaModel';
const time = Date.parse('2026-10-09T14:00:00Z'), expiry = '2026-10-12';
const frame = (t: number, shift = 0): ExposureFrame => ({time: t, missing: [], profiles: [{expiry, time: t, strikes: Array.from({length: 101}, (_, i) => ({strike: 700 + i, callGex: i === 60 ? 100 + shift : 10, putGex: i === 40 ? 80 : 5, totalGex: (i === 60 ? 100 + shift : 10) - (i === 40 ? 80 : 5), callOi: 100, putOi: 100, callIv: .2, putIv: .3, calculationVersion: 'test-v1', gexUnit: 'per-1pct', isCallWall: false, isPutWall: false, isGammaFlip: false}))}]});
const bars = [{timestamp: new Date(time - 120_000).toISOString(), open: 750, close: 750, high: 751, low: 749, volume: 100}];
const prepare = (frames: ExposureFrame[]) => prepareHeatmapDiscovery({frames, bars, expiry, scope: 'selected'}, async () => {});
test('one IV floor in a current-schema capture does not blank structural rankings and tracks',async()=>{
 const a=frame(time),b=frame(time+120000,20);
 for(const f of [a,b]){
  f.profiles[0]!.strikes.forEach(s=>Object.assign(s,{calculationVersion:'qqq-gex-full-1pct-v3',inputComplete:true}));
  f.profiles[0]!.strikes[0]!.callIv=.00001;
 }
 const result=await prepare([a,b]);
 expect(result.rows[1]!.call).toBe(760);
 expect(result.rows[1]!.changes[2]![0]).toMatchObject({strike:760,value:20});
 expect(result.rows[1]!.partial).toBeTrue();
});

test('aggregate skew weights known OI instead of blanking all expiries for one missing weight',async()=>{
 const f=frame(time);
 delete (f.profiles[0]!.strikes[0]! as {callOi?:number}).callOi;
 const result=await prepareHeatmapDiscovery({frames:[f],bars,expiry:null,scope:'all'},async()=>{});
 expect(result.rows[0]!.skew).toBeCloseTo(.1,8);
 expect(result.rows[0]!.partial).toBeTrue();
});
test('an unrelated coverage loss does not suppress a migration between two continuously observed levels',async()=>{
 const a=frame(time),b=frame(time+120000);
 for(const f of [a,b])f.profiles[0]!.strikes.forEach(s=>Object.assign(s,{calculationVersion:'qqq-gex-full-1pct-v3',inputComplete:false}));
 Object.assign(a.profiles[0]!.strikes[0]!,{callOi:undefined});
 Object.assign(b.profiles[0]!.strikes[0]!,{callOi:undefined});
 Object.assign(b.profiles[0]!.strikes[1]!,{callOi:undefined});
 b.profiles[0]!.strikes[61]!.callGex=500;
 expect((await prepare([a,b])).events.find(e=>e.kind==='migration')).toMatchObject({from:760,price:761,partial:true});
});
test('same-scope shifts rank absolute change and compare only observations before target', async () => {
 const frames = [frame(time), frame(time + 120_000, 20), frame(time + 240_000, -40)];
 const result = await prepare(frames);
 expect(result.rows[1].changes[2][0]).toMatchObject({strike: 760, value: 20});
 expect(result.rows[2].changes[2][0].value).toBe(-60);
 expect(result.rows[2].comparedAt[2]).toBe(time + 120_000);
 expect(discoveryIndexAt(result.rows, time + 239_999)).toBe(1);
 expect(discoveryIndexAt(result.rows, time - 1)).toBe(-1);
});
test('partial saved chains compare valid strikes and emit causal partial events without imputing missing OI', async () => {
 const partial=(t:number,shift=0)=>{
  const f=frame(t,shift);
  f.profiles[0].strikes=f.profiles[0].strikes.map(s=>({...s,calculationVersion:'qqq-gex-full-1pct-v3',inputComplete:false}));
  Object.assign(f.profiles[0].strikes[0],{callOi:undefined,callGex:1e20,totalGex:1e20});
  return f;
 };
 const frames=Array.from({length:6},(_,i)=>partial(time+i*120_000,i*20));
 frames[1].profiles[0].strikes[61].callGex=500;
 const touchBars=[{timestamp:new Date(time).toISOString(),close:760,high:760.5,low:759.5,volume:1}];
 const result=await prepareHeatmapDiscovery({frames,bars:touchBars,expiry,scope:'selected'},async()=>{});
 expect(result.rows[5].changes[10][0]).toMatchObject({strike:760,value:100});
 expect(result.rows[5].changes[10].some(p=>p.strike===700)).toBe(false);
 expect(result.rows[0]).toMatchObject({call:760,partial:true});
 expect(result.events.find(e=>e.kind==='touch')).toMatchObject({time:time+120_000,price:760,partial:true});
 expect(result.events.find(e=>e.kind==='migration')).toMatchObject({price:761,partial:true});
 const interrupted=Array.from({length:6},(_,i)=>partial(time+i*120_000,i*20));
 Object.assign(interrupted[2].profiles[0].strikes[60],{callOi:undefined});
 expect((await prepare(interrupted)).rows[5].changes[10].some(p=>p.strike===760)).toBe(false);
 // Losing the strongest strike must not masquerade as a level migration.
 const before=partial(time),after=partial(time+120_000);
 Object.assign(after.profiles[0].strikes[60],{callOi:undefined});
 expect((await prepare([before,after])).events.filter(e=>e.kind==='migration')).toEqual([]);
 const unknown=partial(time+120_000);unknown.profiles[0].strikes.forEach(s=>Object.assign(s,{calculationVersion:'unknown-partial'}));
 expect((await prepare([before,unknown])).rows[1].changes[2]).toEqual([]);
});
test('unknown units, changed coverage and interior missing captures invalidate shifts and tracks', async () => {
 for (const mutate of [
  (f: ExposureFrame) => { f.missing = ['2026-10-13']; },
  (f: ExposureFrame) => { delete (f.profiles[0].strikes[0] as unknown as {gexUnit?: string}).gexUnit; },
 ]) {
  const f = frame(time + 120_000); mutate(f);
  const result = await prepare([frame(time), f, frame(time + 240_000)]);
  expect(result.rows[2].changes[2]).toEqual([]);
 }
 const frames = Array.from({length: 6}, (_, i) => frame(time + i * 120_000));
 frames[2].missing = ['2026-10-13'];
 expect((await prepare(frames)).rows[5].changes[10]).toEqual([]);
 expect((await prepare([frame(time), frame(time + 600_000)])).rows[1].changes[10]).toEqual([]);
 const before=frame(time), after=frame(time+120000,20);after.profiles[0].strikes.pop();
 expect((await prepare([before,after])).rows[1].changes[2][0]).toMatchObject({strike:760,value:20});
});
test('25-delta skew interpolates bracketed quotes and does not clamp missing or expired sides', () => {
 expect(snapshot25DeltaSkew(frame(time).profiles[0], 750, time)).toBeCloseTo(.1, 8);
 const short = {...frame(time).profiles[0], strikes: [frame(time).profiles[0].strikes[50]]};
 expect(snapshot25DeltaSkew(short, 750, time)).toBeNull();
 expect(snapshot25DeltaSkew(frame(time).profiles[0], 750, qqqGammaExpiryTime(expiry))).toBeNull();
});
test('bands use remaining expiry horizon; aggregate is outer envelope and skew uses OI weights', async () => {
 const one = frame(time), two = {...frame(time).profiles[0], expiry: '2026-10-13', strikes: frame(time).profiles[0].strikes.map(s => ({...s, callOi: 300, putOi: 300, callIv: .3, putIv: .4}))};
 const selected = await prepare([one]);
 const all = await prepareHeatmapDiscovery({frames: [{...one, profiles: [one.profiles[0], two]}], bars, expiry: null, scope: 'all'}, async () => {});
 expect(all.rows[0].skew).toBeCloseTo(.1, 8);
 expect(all.rows[0].upper!).toBeGreaterThan(selected.rows[0].upper!);
 expect(all.rows[0].lower!).toBeLessThan(selected.rows[0].lower!);
 expect((await prepare([{...one, missing: ['2026-10-13']}])).rows[0].upper).toBeNull();
});
test('touches freeze level at candle open, wait for close, and cool down repeats', async () => {
 const initial = frame(time), changed = frame(time + 120_000);
 changed.profiles[0].strikes[60].callGex = 1; changed.profiles[0].strikes[61].callGex = 200;
 const touchBars = Array.from({length: 3}, (_, i) => ({timestamp: new Date(time + i * 120_000).toISOString(), close: 760, high: 760.5, low: 759.5, volume: 1}));
 const input = {frames: [initial, changed, frame(time + 240_000), frame(time + 360_000)], bars: touchBars, expiry, scope: 'selected' as const};
 const result = await prepareHeatmapDiscovery(input, async () => {});
 expect(result.events.find(e => e.kind === 'touch')).toMatchObject({time: time + 120_000, price: 760});
 expect(result.events.filter(e => e.kind === 'touch' && e.price === 760)).toHaveLength(1);
 expect(result.events.some(e => e.kind === 'touch' && e.price === 761)).toBe(false);
 expect(result.events.some(e => e.kind === 'migration' && e.price === 761)).toBe(true);
 expect((await prepareHeatmapDiscovery({...input, frames: [initial]}, async () => {})).events).toEqual([]);
});
test('identical immutable frames/bars reuse one promise across hook remounts; preparation yields', async () => {
 const input = {frames: [frame(time)], bars, expiry, scope: 'selected' as const};
 expect(cachedHeatmapDiscovery(input)).toBe(cachedHeatmapDiscovery({...input}));
 let yields = 0;
 await prepareHeatmapDiscovery(input, async () => {yields++;});
 expect(yields).toBeGreaterThan(0);
});

test('concentration lookup preserves sort-based levels and shares identity on replay revisit',()=>{
 const f=frame(time);const levels=exposureConcentrationLevels(f);
 const reference=f.profiles.flatMap(p=>{const rows=p.strikes.filter(s=>Number.isFinite(s.callGex)&&Number.isFinite(s.putGex));return [rows.slice().sort((a,b)=>Math.abs(b.callGex)-Math.abs(a.callGex))[0].strike,rows.slice().sort((a,b)=>Math.abs(b.putGex)-Math.abs(a.putGex))[0].strike];});
 expect(levels).toEqual(reference);expect(exposureConcentrationLevels(f)).toBe(levels);
});
test('opt-in single-expiry legacy normalization reuses existing cache without changing default consumers',async()=>{
 const f=frame(time);for(const s of f.profiles[0].strikes){delete (s as unknown as {gexUnit?:string}).gexUnit;delete (s as unknown as {calculationVersion?:string}).calculationVersion;}
 const spotAt=exposureSpotIndex(bars),signal=new AbortController().signal;
 expect((await prepareAggregateGammaFrames([f],spotAt,signal,async()=>{}))[0]).toBe(f);
 const normalized=await prepareAggregateGammaFrames([f],spotAt,signal,async()=>{},true);
 expect(normalized[0]).not.toBe(f);
 expect((await prepareAggregateGammaFrames([f],spotAt,signal,async()=>{},true))[0]).toBe(normalized[0]);
 expect((await prepareAggregateGammaFrames([f],spotAt,signal,async()=>{}))[0]).toBe(f);
});


test('scenario bands expand from the snapshot with frozen IV and stop after expiry', () => {
 const f=frame(time);
 const second={...structuredClone(f.profiles[0]!),expiry:'2026-10-16',strikes:f.profiles[0]!.strikes.map(s=>({...s,callIv:.4,putIv:.5}))};
 f.profiles.push(second);
 const times=[time,time+3600000,qqqGammaExpiryTime(expiry),qqqGammaExpiryTime(second.expiry)];
 const selected=scenarioExpectedBands(f,750,times,expiry,'selected');
 const all=scenarioExpectedBands(f,750,times,expiry,'all');
 const width=750*Math.sqrt((.2**2+.3**2)/2)*Math.sqrt(3600000/(365*86400000));
 expect(selected.rows[0]).toMatchObject({lower:750,upper:750});
 expect(selected.rows[1]!.upper).toBeCloseTo(750+width,8);
 expect(selected.rows[1]!.upper!).toBeGreaterThan(selected.rows[0]!.upper!);
 expect(selected.rows[0]!.upper!+selected.rows[0]!.lower!).toBe(1500);
 expect(all.rows[1]!.upper!).toBeGreaterThan(selected.rows[1]!.upper!);
 expect(selected.rows[2]!.upper!).toBeGreaterThan(selected.rows[1]!.upper!);
 expect(selected.rows[3]!.upper).toBeNull();
 expect(all.rows[2]!.upper).not.toBeNull();
 expect(all.rows[3]!.upper).not.toBeNull();
 const future=structuredClone(f);
 future.profiles[0]!.strikes.forEach(s=>Object.assign(s,{callReceivedAt:new Date(time+1).toISOString()}));
 expect(scenarioExpectedBands(future,750,times,expiry,'selected').rows).toEqual([]);
 f.missing=['2026-10-19'];
 expect(scenarioExpectedBands(f,750,times,expiry,'all').rows).toEqual([]);
});

test('late 0DTE snapshot never backfills the morning or collapses at expiry',()=>{
 const observed=Date.parse('2026-10-13T20:12:00Z'),end=qqqGammaExpiryTime('2026-10-13');
 const input={date:'2026-10-13',observationAt:observed,spot:743.8,missing:[],expiries:[{expiryDate:'2026-10-13',asOf:new Date(observed).toISOString(),fullGexProfile:[{strike:743,callIv:.2,putIv:.2},{strike:744,callIv:.2,putIv:.2}]}]};
 const result=scenarioExpectedBandsFromInput(input,[Date.parse('2026-10-13T13:30:00Z'),observed,end-60000,end,end+1],'2026-10-13','selected');
 expect(result.rows[0]).toMatchObject({lower:null,upper:null});
 expect(result.rows[1]).toMatchObject({lower:743.8,upper:743.8});
 const width=743.8*.2*Math.sqrt((end-observed)/(365*86400000));
 expect(result.rows[3]!.upper).toBeCloseTo(743.8+width,8);
 expect(result.rows[3]!.upper!).toBeGreaterThan(result.rows[2]!.upper!);
 expect(result.rows[4]).toMatchObject({lower:null,upper:null});
 expect(scenarioExpectedBandsFromInput({...input,spot:Infinity},[observed],'2026-10-13','selected').rows).toEqual([]);
 expect(scenarioExpectedBandsFromInput({...input,expiries:[{...input.expiries[0]!,expiryDate:'bad'}]},[observed],'bad','selected').rows).toEqual([]);
});


test('source snapshot owns band anchor; duplicate constituents never inflate envelope',()=>{
 const f=frame(time);
 const input={date:'2026-10-09',observationAt:time,spot:750,missing:[],expiries:f.profiles.map(p=>({expiryDate:p.expiry,asOf:new Date(time).toISOString(),fullGexProfile:p.strikes}))};
 const old=scenarioExpectedBandsFromInput(input,[time],expiry,'selected');
 const revised=scenarioExpectedBandsFromInput({...input,spot:760},[time],expiry,'selected');
 expect(old.rows[0]!.upper!+old.rows[0]!.lower!).toBe(1500);
 expect(revised.rows[0]!.upper!+revised.rows[0]!.lower!).toBe(1520);
 expect(scenarioExpectedBandsFromInput(null,[time],expiry,'all').rows).toEqual([]);
 expect(scenarioExpectedBandsFromInput({...input,expiries:[...input.expiries,...input.expiries]},[time],expiry,'all').rows).toEqual([]);
});


test('discovery cancellation interrupts actual normalization/preparation and aborted work is restartable',async()=>{
 const controller=new AbortController();let yields=0;
 const input={frames:[frame(time),frame(time+120000)],bars,expiry,scope:'selected' as const};
 await expect(prepareHeatmapDiscovery(input,async()=>{yields++;controller.abort();},controller.signal)).rejects.toThrow();
 expect(yields).toBe(1);
 const lease=acquireHeatmapDiscovery(input);lease.release();
 await expect(lease.promise).rejects.toThrow();
 const retry=acquireHeatmapDiscovery(input);expect((await retry.promise).rows).toHaveLength(2);retry.release();
 const all=acquireHeatmapDiscovery({...input,scope:'all'}),other=acquireHeatmapDiscovery({...input,scope:'all',expiry:'2026-10-16'});
 expect(other.promise).toBe(all.promise);await all.promise;all.release();other.release();
});
