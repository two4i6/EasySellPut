import { expect, test, spyOn } from 'bun:test';
import { calculateQqqGex, normalizeQqqGexOption } from './qqqGexCalculation';
import { qqqAtmIv } from './qqqAtmIv';
import { GEXEngine } from './engines/structure/GEXEngine';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { buildQqqGexCapture } from './qqqGexCaptureBuilder';
import { compactGexProfile } from './qqqGexHistory';

const valuationAt = '2026-10-09T14:00:00Z';
const contract = {strike: 750, iv: .2, bid: null, ask: null, mid: null, inTheMoney: false};
const chain = { calls: [{ ...contract, openInterest: 100 }], puts: [{ ...contract, openInterest: 10 }] };

test('two-minute capture preserves zero bids, asks, receipt and last trade through profile compaction', () => {
  const receivedAt = '2026-10-09T14:00:02.123Z', lastTradeDate = Date.parse('2026-10-09T13:58:30Z') / 1000;
  const raw = { strike: 750, bid: 0, ask: .123456789, impliedVolatility: .2, openInterest: 100, volume: 7, lastTradeDate };
  const snapshot = buildQqqGexCapture(new Date(valuationAt), Date.parse('2026-10-12') / 1000,
    { receivedAt, options: [{ calls: [raw], puts: [raw] }] }, 750)!;
  expect(compactGexProfile(JSON.parse(JSON.stringify(snapshot.profile)))[0]).toMatchObject({ callBid: 0, callAsk: .123456789, putBid: 0, putAsk: .123456789,
    callReceivedAt: receivedAt, putReceivedAt: receivedAt, callLastTradeAt: '2026-10-09T13:58:30.000Z' });
});

test('QQQ normalization rejects coerced booleans, arrays and blank strings', () => {
  for (const value of [true, false, [], [100], '   ']) {
    const row = normalizeQqqGexOption({strike: 750, impliedVolatility: .2, openInterest: value}, {expiry: Date.parse('2026-10-09') / 1000, now: new Date(valuationAt), spot: 750, type: 'call'});
    expect(row.openInterest).toBeUndefined();
  }
});

test('nonfinite spot is rejected and invalid IV cannot poison finite displayed metrics', () => {
  expect(calculateQqqGex(chain, Infinity, '2026-10-09', valuationAt)).toBeNull();
  const result = calculateQqqGex({...chain, calls: [{...chain.calls[0]!, iv: Infinity}]}, 750, '2026-10-09', valuationAt)!;
  expect(result.complete).toBe(false);
  expect(Number.isFinite(result.atmIv)).toBe(true);
  expect(Number.isFinite(result.metrics.totalGexValue)).toBe(true);
  expect(result.model.points).toHaveLength(0);
});

test('ATM IV is invariant to tied-distance order and interpolates strike-level variance', () => {
  const calls = [{...contract, strike:750,iv:.2,openInterest:1000},{...contract,strike:749,iv:.4,openInterest:1000}];
  const puts = [{...contract,strike:750,iv:.3,openInterest:1000},{...contract,strike:749,iv:.1,openInterest:1000},{...contract,strike:751,iv:.9,openInterest:1000}];
  const a=calculateQqqGex({calls,puts},750,'2026-10-09',valuationAt)!;
  const b=calculateQqqGex({calls,puts:[puts[0]!,puts[2]!,puts[1]!]},750,'2026-10-09',valuationAt)!;
  expect(a.atmIv).toBe(b.atmIv);
  expect(a.atmIv).toBeCloseTo(Math.sqrt((.2**2+.3**2)/2),12);
});

test('ATM interpolation uses log strike, keeps missing IV unavailable and avoids zero-side dilution',()=>{
 const value=qqqAtmIv([{strike:100,iv:.2},{strike:110,iv:.4}],[],105);
 const weight=Math.log(105/100)/Math.log(110/100);
 expect(value).toBeCloseTo(Math.sqrt(.2**2*(1-weight)+.4**2*weight),12);
 expect(qqqAtmIv([{strike:100,iv:NaN}],[],100)).toBe(0);
 expect(qqqAtmIv([{strike:100,iv:.2}],[],100)).toBe(.2);
});

test('single-pass aggregation and continuous-root attachment match a full recomputation',()=>{
 const c=calculateQqqGex(chain,750,'2026-10-09',valuationAt)!;
 const recomputed=GEXEngine.calculate(c.calls,c.puts,750,c.atmIv*100, (Date.parse('2026-10-09T20:15:00Z')-Date.parse(valuationAt))/86400000,{scope:'full-chain',unit:'per-1pct',gammaFlipPrice:c.model.levels.zeroGamma});
 expect(c.metrics).toEqual(recomputed);
});

test('capture reuses base Greeks, prices only one forward Charm valuation per contract and aggregates GEX once',()=>{
 const pricing=spyOn(blackScholesEngine,'price'),aggregation=spyOn(GEXEngine,'calculate');
 try{
  const row={strike:750,impliedVolatility:.2,openInterest:100};
  const capture=buildQqqGexCapture(new Date(valuationAt),Date.parse('2026-10-09')/1000,{receivedAt:valuationAt,options:[{calls:[row],puts:[{...row,openInterest:10}]}]},750)!;
  expect(capture.inputComplete).toBeTrue();expect(pricing).toHaveBeenCalledTimes(4);expect(aggregation).toHaveBeenCalledTimes(1);
 }finally{pricing.mockRestore();aggregation.mockRestore();}
});
