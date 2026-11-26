import { expect, test } from 'bun:test';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { buildQqqGammaModel, deriveQqqVolatilityTrigger, qqqGammaExpiryTime } from './qqqGammaModel';

const asOf = '2026-10-09T14:00:00Z';
test('numerically unrepresentable contracts do not publish NaN or infinite gamma levels',()=>{
 for(const bad of [{callIv:1e-320},{callOi:Number.MAX_VALUE}]) {
  const e={expiryDate:'2026-10-09',asOf,fullGexProfile:[{strike:600,callOi:100,putOi:0,callIv:.2,...bad}]};
  const model=buildQqqGammaModel([e],600,asOf);
  expect(model.points).toEqual([]);
  expect(model.spotGamma).toBeNull();
  expect(model.excluded).toEqual(['2026-10-09']);
 }
});
const expiry = (date = '2026-10-09') => ({ expiryDate: date, asOf, fullGexProfile: [
  { strike: 590, callOi: 10, putOi: 1000, callIv: .25, putIv: .25 },
  { strike: 600, callOi: 2000, putOi: 1900, callIv: .25, putIv: .25 },
  { strike: 610, callOi: 1000, putOi: 10, callIv: .25, putIv: .25 },
] });

test('scenario gamma agrees with independent pricing engine and absolute gamma uses both sides before netting', () => {
  const model = buildQqqGammaModel([expiry()], 600, asOf);
  const t = (qqqGammaExpiryTime('2026-10-09') - Date.parse(asOf)) / (365 * 86400_000);
  const reference = expiry().fullGexProfile.reduce((sum, p) => sum + blackScholesEngine.price({ S: 600, K: p.strike, T: t, r: 0, sigma: .25, type: 'call' }).gamma * (p.callOi - p.putOi) * 100 * 600 ** 2 * .01, 0);
  expect(model.spotGamma!).toBeCloseTo(reference, 5);
  expect(model.levels.absoluteGamma).toBe(600);
  expect(model.levels.zeroGamma).not.toBeNull();
  expect(model.levels.absoluteGamma).not.toBe(model.levels.zeroGamma);
  expect(model.points.every(p => p.exNearest === null)).toBeTrue();
});

test('remaining curve removes exactly the earliest expiry at the same valuation time', () => {
  const later = expiry('2026-10-12');
  const combined = buildQqqGammaModel([later, expiry()], 600, asOf);
  expect(combined.nearestExpiry).toBe('2026-10-09');
  expect(combined.points.find(p => p.price === 600)?.exNearest).toBeCloseTo(buildQqqGammaModel([later], 600, asOf).spotGamma!, 5);
});

test('OI or IV gaps, future snapshots and expired contracts never receive fabricated parameters', () => {
  const incomplete = { ...expiry(), fullGexProfile: [{ strike: 600, callOi: 20, putOi: 0 }] };
  expect(buildQqqGammaModel([incomplete], 600, asOf).points).toEqual([]);
  expect(buildQqqGammaModel([{ ...expiry(), asOf: '2026-10-09T14:01:00Z' }], 600, asOf).points).toEqual([]);
  const delayed = { ...expiry(), fullGexProfile: expiry().fullGexProfile.map(p=>({...p,callReceivedAt:'2026-10-09T14:00:03Z'})) };
  expect(buildQqqGammaModel([delayed],600,asOf).points).toEqual([]);
  expect(buildQqqGammaModel([delayed],600,'2026-10-09T14:00:03Z').points.length).toBeGreaterThan(100);
  expect(buildQqqGammaModel([expiry()], 600, '2026-10-09T20:15:00Z').points).toEqual([]);
  expect(buildQqqGammaModel([incomplete, expiry('2026-10-12')], 600, asOf).excluded).toEqual(['2026-10-09']);
});

test('expiry clock respects DST, early close and nontrading days without a half-day 0DTE floor', () => {
  expect(new Date(qqqGammaExpiryTime('2026-10-09')).toISOString()).toBe('2026-10-09T20:15:00.000Z');
  expect(new Date(qqqGammaExpiryTime('2026-11-27')).toISOString()).toBe('2026-11-27T18:15:00.000Z');
  expect(Number.isNaN(qqqGammaExpiryTime('2026-10-10'))).toBeTrue();
  const justBefore = buildQqqGammaModel([expiry()], 600, '2026-10-09T19:59:00Z');
  expect(justBefore.spotGamma!).toBeGreaterThan(buildQqqGammaModel([expiry()], 600, asOf).spotGamma!);
});

test('trigger is a sustained material positive cushion, distinct from zero gamma', () => {
  const points = [0, 1, 2, 3, 4, 5].map(i => ({ price: 98 + i, gamma: [-20, 0, 20, 40, 60, 80][i]!, grossGamma: 100 }));
  const trigger = deriveQqqVolatilityTrigger(points, 100);
  expect(trigger.price).toBeCloseTo(99.5, 8);
  expect(trigger.version).toBe('net-gamma-cushion-v3');
  expect(trigger.price).not.toBe(99);
});

test('trigger rejects all-negative curves, boundary-only support and very narrow positive spikes', () => {
  const negative = [98, 99, 100, 101].map(price => ({ price, gamma: -10, grossGamma: 100 }));
  expect(deriveQqqVolatilityTrigger(negative, 100).price).toBeNull();
  expect(deriveQqqVolatilityTrigger(negative.map(p => ({ ...p, gamma: 20 })), 100).price).toBeNull();
  expect(deriveQqqVolatilityTrigger([{ price: 99.9, gamma: -20, grossGamma: 100 }, { price: 100, gamma: 20, grossGamma: 100 }, { price: 100.1, gamma: -20, grossGamma: 100 }], 100).price).toBeNull();
});

test('trigger requires net/gross strength even with a large positive gross concentration', () => {
  const points = [98, 99, 100, 101, 102].map((price, i) => ({ price, gamma: [-1, 1, 5, 5, 5][i]!, grossGamma: 100 }));
  expect(deriveQqqVolatilityTrigger(points, 100).price).toBeNull();
});

test('tail numerical zeros do not fabricate a gamma flip in a call-only book', () => {
  const model=buildQqqGammaModel([{expiryDate:'2026-10-09',asOf,fullGexProfile:[{strike:600,callOi:1000,putOi:0,callIv:.05}]}],650,'2026-10-09T19:59:59Z');
  expect(model.points.some(p=>p.gamma===0)).toBeTrue();
  expect(model.levels.zeroGamma).toBeNull();
});

test('trigger entry satisfies both interpolated constraints when the limiting inequality changes', () => {
  const points=[{price:98,gamma:-20,grossGamma:2000},{price:100,gamma:200,grossGamma:300},{price:102,gamma:1000,grossGamma:1000}];
  const result=deriveQqqVolatilityTrigger(points,100);
  // Net/gross crosses later than the peak constraint: -220 + 390*f >= 0.
  expect(result.price).toBeCloseTo(98+2*220/390,8);
  expect(result.bandEnd).toBeNull();
});

test('fresh put receipt cannot hide a stale call receipt in source freshness', () => {
  const model=buildQqqGammaModel([{...expiry(),fullGexProfile:expiry().fullGexProfile.map(p=>({...p,callReceivedAt:'2026-10-09T13:50:00Z',putReceivedAt:asOf}))}],600,asOf);
  expect(model.sourceAsOf).toBe('2026-10-09T13:50:00Z');
});


test('a right-censored qualifying VT band has an unknown upper edge', () => {
  const trigger = deriveQqqVolatilityTrigger([{price:90,gamma:-100,grossGamma:200},{price:100,gamma:20,grossGamma:100},{price:110,gamma:100,grossGamma:100}],100);
  expect(trigger.price).not.toBeNull();
  expect(trigger.bandEnd).toBeNull();
});


test('near-expiry secondary narrow exposure islands are sampled before solving roots', () => {
 const asOf='2026-10-09T20:14:59Z';
 const model=buildQqqGammaModel([{expiryDate:'2026-10-09',asOf,fullGexProfile:[{strike:750,callOi:10000,putOi:1000,callIv:.1,putIv:.1},{strike:750.2,callOi:1,putOi:10,callIv:.1,putIv:.1},{strike:750.4,callOi:1,putOi:0,callIv:.1,putIv:.1}]}],750,asOf);
 expect(model.levels.zeroGamma).not.toBeNull();
 expect(model.levels.zeroGamma!).toBeGreaterThan(750);
 expect(model.levels.zeroGamma!).toBeLessThan(750.2);
});


test('QQQ 0DTE remains modelable after stock close until its option trading cutoff', () => {
 expect(buildQqqGammaModel([expiry()],600,'2026-10-09T20:05:00Z').points.length).toBeGreaterThan(0);
});

test('VT lower and upper boundaries satisfy continuous exposure constraints on seeded near-expiry chains', () => {
 let seed=20261010;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const time='2026-10-09T19:55:00Z',t=(qqqGammaExpiryTime('2026-10-09')-Date.parse(time))/(365*86400000);
 for(let n=0;n<30;n++) {
  const rows=Array.from({length:31},(_,i)=>({strike:735+i,callOi:Math.floor(random()*10000),putOi:Math.floor(random()*10000),callIv:.05+random()*.6,putIv:.05+random()*.6}));
  const m=buildQqqGammaModel([{expiryDate:'2026-10-09',asOf:time,fullGexProfile:rows}],750,time);
  const peak=Math.max(...m.points.map(p=>p.gamma));
  for(const s of [m.volatilityTrigger.price,m.volatilityTrigger.bandEnd])if(typeof s==='number'){
   let net=0,gross=0;
   for(const p of rows)for(const [oi,iv,sign]of [[p.callOi,p.callIv,1],[p.putOi,p.putIv,-1]]){
    const g=blackScholesEngine.price({S:s,K:p.strike,T:t,r:0,sigma:iv!,type:'call'}).gamma*oi!*100*s*s*.01;
    net+=sign!*g;gross+=g;
   }
   expect(Math.min(net-peak*.1,net-gross*.1)/Math.max(1,gross)).toBeGreaterThanOrEqual(-1e-8);
  }
 }
});

test('data receipts never invent an OI date and sensitivity includes missing scenarios at expiry',()=>{
 const time='2026-10-09T20:14:30Z';
 const m=buildQqqGammaModel([{...expiry(),asOf:time}],600,time,{includeSensitivity:true});
 expect(m.dataTimes?.valuationAt).toBe(time);
 expect(m.dataTimes?.quoteAsOf).toBeNull();expect(m.dataTimes?.oiAsOf).toBeNull();
 expect(m.sensitivity?.zeroGamma.missingScenarios).toBeGreaterThanOrEqual(1);
 expect(m.sensitivity?.volatilityTrigger.missingScenarios).toBeGreaterThanOrEqual(1);
});
