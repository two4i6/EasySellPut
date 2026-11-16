import { expect, test } from 'bun:test';
import { prepareQqqMaxPain, qqqMaxPain, qqqMaxPainAt } from './qqqMaxPain';
import { qqqAtmIvObservationCutoff } from './qqqAtmIvObservation';
import type { PcsFullGexProfile, PcsGexExpiry } from '@/types/qqqGex';

const strike = (price: number, callOi: number, putOi: number): PcsFullGexProfile => ({
  strike: price, callOi, putOi, callGex: 0, putGex: 0, totalGex: 0,
  calculationVersion: 'qqq-gex-full-1pct-usable-iv-v4', gexUnit: 'per-1pct',
  inputComplete: false, isCallWall: false, isPutWall: false, isGammaFlip: false,
});
const profile = [strike(100, 10, 1), strike(105, 20, 20), strike(110, 1, 10)];
const time = Date.parse('2026-10-16T14:00:00Z');
const expiry = (overrides: Partial<PcsGexExpiry> = {}): PcsGexExpiry => ({
  expiryDate: '2026-10-19', asOf: new Date(time).toISOString(), dte: 3,
  fullGexProfile: profile, fullGexProfileHistory: [], gex: [], gexProfile: [], gexProfileHistory: [], gexSummary: null, wallHistory: [], ...overrides,
});
const prepare = (expiries: PcsGexExpiry[]) => prepareQqqMaxPain(expiries, [], '2026-10-16', new AbortController().signal, async () => {});

test('Max Pain minimizes actual option intrinsic payouts independently of IV and Gamma', () => {
  expect(qqqMaxPain(profile)).toEqual({ level: 105, totalOi: 62, reason: null });
  expect(qqqMaxPain(profile.map(row => ({ ...row, callIv: NaN, putIv: undefined, callGex: NaN })))).toEqual(qqqMaxPain(profile));
  expect(qqqMaxPain([strike(100, 1, 0), strike(110, 0, 1)]).level).toBe(100);
});

test('convex-payout minimum matches a brute-force payout oracle across asymmetric chains', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rows = Array.from({ length: 30 }, (_, index) => strike(500 + index * 2.5, (seed * 17 + index * 23) % 137, (seed * 31 + index * 11) % 193));
    const brute = rows.map(row => ({ strike: row.strike, payout: rows.reduce((sum, contract) => sum + contract.callOi! * Math.max(0, row.strike - contract.strike) + contract.putOi! * Math.max(0, contract.strike - row.strike), 0) }))
      .sort((a, b) => a.payout - b.payout || a.strike - b.strike)[0];
    expect(qqqMaxPain([...rows].reverse()).level).toBe(brute.strike);
  }
});

test('ties at large strikes and OI do not suffer cancellation or an arbitrary epsilon', () => {
  const rows = [strike(1e12, 1e9, 0), strike(1e12 + 1, 0, 1e9)];
  expect(qqqMaxPain(rows).level).toBe(1e12);
  expect(qqqMaxPain([strike(100, 0, 0), strike(110, 1, 0)]).level).toBe(100);
  expect(qqqMaxPain([strike(100, 0, 1), strike(110, 0, 0)]).level).toBe(100);
  expect(qqqMaxPain([strike(100, .5, 1)]).level).toBeNull();
  expect(qqqMaxPain([strike(100, Number.MAX_SAFE_INTEGER, 1)]).level).toBeNull();
});

test('missing, negative, nonfinite, duplicate and ambiguous legacy OI remain unavailable', () => {
  for (const rows of [[], [strike(100, 0, 0)], [...profile, profile[0]],
    profile.map(row => ({ ...row, callOi: undefined })), profile.map(row => ({ ...row, putOi: -1 })),
    profile.map(row => ({ ...row, putOi: Infinity })), profile.map(row => ({ ...row, strike: NaN })),
    profile.map(row => ({ ...row, calculationVersion: undefined }))]) {
    expect(qqqMaxPain(rows).level).toBeNull();
    expect(qqqMaxPain(rows).reason).toBeTruthy();
  }
});

test('replay excludes later receipts, preserves invalid latest samples and isolates the ET trading day', async () => {
  const tracks = await prepare([expiry({ fullGexProfileHistory: [
    { time: new Date(time - 86400000).toISOString(), strikes: [strike(90, 1, 1)] },
    { time: new Date(time + 60000).toISOString(), strikes: profile.map(row => ({ ...row, computedAt: new Date(time + 120000).toISOString(), callOi: undefined })) },
    { time: new Date(time + 180000).toISOString(), strikes: [] },
  ] })]);
  expect(tracks[0].history.map(point => point.time)).toEqual([time, time + 120000, time + 180000]);
  expect(qqqMaxPainAt(tracks, time)[0].latest?.level).toBe(105);
  expect(qqqMaxPainAt(tracks, time + 119999)[0].latest?.level).toBe(105);
  expect(qqqMaxPainAt(tracks, time + 120000)[0].latest?.level).toBeNull();
  expect(qqqMaxPainAt(tracks, time + 180000)[0].latest?.level).toBeNull();
  expect(qqqMaxPainAt(tracks, -Infinity)[0].latest).toBeNull();
});

test('latest batch and manual replay use the same causal cutoff as ATM IV', async () => {
  const late = expiry({ expiryDate: '2026-10-20', asOf: new Date(time + 2000).toISOString() });
  const frame = { time, profiles: [{ expiry: '2026-10-19', time, strikes: profile }], missing: [] };
  const tracks = await prepareQqqMaxPain([late], [frame], '2026-10-16', new AbortController().signal, async () => {});
  const read = (followingLatest: boolean) => qqqMaxPainAt(tracks, qqqAtmIvObservationCutoff(time + 5000, { followingLatest, frame }));
  expect(read(true).map(track => track.latest?.level)).toEqual([105, 105]);
  expect(read(false).map(track => track.latest?.level ?? null)).toEqual([105, null]);
});

test('preparation yields and supports cancellation without mutating saved profiles', async () => {
  const before = JSON.stringify(profile);
  const controller = new AbortController();
  await expect(prepareQqqMaxPain([expiry()], [], '2026-10-16', controller.signal, async () => { controller.abort(); })).rejects.toThrow();
  expect(JSON.stringify(profile)).toBe(before);
});
