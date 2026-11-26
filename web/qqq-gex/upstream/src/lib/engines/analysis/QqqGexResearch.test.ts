import { expect, test } from 'bun:test';
import { buildQqqGexResearchSurface, deriveWallConfirmation } from './QqqGexResearch';

const bars = [
  { timestamp: '2026-07-28T14:00:00.000Z', open: 100, high: 101, low: 99.8, close: 100.5, volume: 100 },
  { timestamp: '2026-07-28T14:02:00.000Z', open: 100.5, high: 100.8, low: 99.9, close: 100.1, volume: 110 },
  { timestamp: '2026-07-28T14:04:00.000Z', open: 100.1, high: 101.3, low: 100, close: 101.1, volume: 220 },
  { timestamp: '2026-07-28T14:06:00.000Z', open: 101.1, high: 101.8, low: 100.9, close: 101.6, volume: 160 },
  { timestamp: '2026-07-28T14:08:00.000Z', open: 101.6, high: 101.9, low: 101.2, close: 101.5, volume: 130 },
];

test('derives touch rejection, time beyond a put wall, VWAP and local RV without inventing trade tape', () => {
  const confirmation = deriveWallConfirmation('put', 100, bars);
  expect(confirmation.firstTouchAt).toBe('2026-07-28T14:00:00.000Z');
  expect(confirmation.rejection5m).toBeGreaterThan(0);
  expect(confirmation.timeBeyondWallMinutes).toBe(0);
  expect(confirmation.vwapDeviation).not.toBeNull();
  expect(confirmation.limitations.some((value) => value.includes('NBBO'))).toBe(true);
});

test('separates aggregated market GEX from selected-expiry contract GEX and keeps seller labels research-only', () => {
  const surface = buildQqqGexResearchSurface({
    selectedExpiryDate: '2026-07-31', bars,
    pcsSpread: { shortStrike: 99.5, longStrike: 98.5, entryCredit: 0.4, definedRisk: 1.1 },
    ccsSpread: { shortStrike: 102, longStrike: 103, entryCredit: 0.35, definedRisk: 0.65 },
    sessionClosed: false,
    expiries: [
      {
        expiryDate: '2026-07-31', dte: 3, spot: 101.5, expectedMove: 2, netGex: -40, gammaFlip: 102,
        putWallPrice: 100, putWallMagnitude: -60, callWallPrice: 104, callWallMagnitude: 30,
        profile: [
          { strike: 100, callGex: 10, putGex: 70, totalGex: -60, isCallWall: false, isPutWall: true, isGammaFlip: false },
          { strike: 102, callGex: 40, putGex: 10, totalGex: 30, isCallWall: false, isPutWall: false, isGammaFlip: true },
          { strike: 104, callGex: 10, putGex: 0, totalGex: 10, isCallWall: true, isPutWall: false, isGammaFlip: false },
        ],
        history: [
          { time: '2026-07-28T13:48:00.000Z', spot: 100.4, netGex: -30, gammaFlip: 101.5, putWallPrice: 100, putWallMagnitude: -50, callWallPrice: 104, callWallMagnitude: 25 },
          { time: '2026-07-28T14:00:00.000Z', spot: 101.5, netGex: -40, gammaFlip: 102, putWallPrice: 100, putWallMagnitude: -60, callWallPrice: 104, callWallMagnitude: 30 },
        ],
      },
      {
        expiryDate: '2026-08-07', dte: 10, spot: 101.5, expectedMove: 3, netGex: 100, gammaFlip: 101,
        putWallPrice: 98, putWallMagnitude: -10, callWallPrice: 105, callWallMagnitude: 110,
        profile: [
          { strike: 98, callGex: 5, putGex: 15, totalGex: -10, isCallWall: false, isPutWall: true, isGammaFlip: false },
          { strike: 101, callGex: 70, putGex: 0, totalGex: 70, isCallWall: false, isPutWall: false, isGammaFlip: true },
          { strike: 105, callGex: 40, putGex: 0, totalGex: 40, isCallWall: true, isPutWall: false, isGammaFlip: false },
        ],
        history: [],
      },
    ],
  });
  expect(surface).not.toBeNull();
  expect(surface!.researchOnly).toBe(true);
  expect(surface!.market.expiryCount).toBe(2);
  expect(surface!.market.factors.qqq_gex_market_gex_balance.value).toBeGreaterThan(0);
  expect(surface!.contract.factors.qqq_gex_contract_gex_balance.value).toBeLessThan(0);
  expect(surface!.contract.factors.qqq_gex_contract_flip_z.value).toBeCloseTo(-0.25);
  expect(surface!.contract.factors.qqq_gex_contract_put_wall_z.value).toBeCloseTo(0.75);
  expect(surface!.contract.factors.qqq_gex_contract_put_wall_time_beyond_minutes.source.type).toBe('derived');
  expect(surface!.contract.factors.qqq_gex_contract_flow_tape_available.source.type).toBe('fallback');
  expect(surface!.labels.pcs.spreadMidPnl).toBeNull();
  expect(surface!.labels.ccs.shortStrike).toBe(102);
});

test('labels PCS and CCS with future two-leg mids, executable-credit slippage and loss utilization when quote snapshots exist', () => {
  const profile = (putShort: number, putLong: number, callShort: number, callLong: number) => [
    { strike: 98, callGex: 5, putGex: 25, totalGex: -20, putMid: putLong, putBid: putLong - .02, putAsk: putLong + .02, isCallWall: false, isPutWall: true, isGammaFlip: false },
    { strike: 99, callGex: 5, putGex: 35, totalGex: -30, putMid: putShort, putBid: putShort - .05, putAsk: putShort + .05, isCallWall: false, isPutWall: false, isGammaFlip: true },
    { strike: 102, callGex: 40, putGex: 0, totalGex: 40, callMid: callShort, callBid: callShort - .05, callAsk: callShort + .05, isCallWall: true, isPutWall: false, isGammaFlip: false },
    { strike: 103, callGex: 20, putGex: 0, totalGex: 20, callMid: callLong, callBid: callLong - .02, callAsk: callLong + .02, isCallWall: false, isPutWall: false, isGammaFlip: false },
  ];
  const surface = buildQqqGexResearchSurface({
    selectedExpiryDate: '2026-07-31', bars, labelAt: '2026-07-28T14:00:00.000Z', sessionClosed: false,
    pcsSpread: { shortStrike: 99, longStrike: 98, entryCredit: .5, definedRisk: 1 },
    ccsSpread: { shortStrike: 102, longStrike: 103, entryCredit: .5, definedRisk: 1 },
    expiries: [{
      expiryDate: '2026-07-31', dte: 3, spot: 100.5, expectedMove: 2, netGex: 10, gammaFlip: 99,
      putWallPrice: 98, putWallMagnitude: -25, callWallPrice: 102, callWallMagnitude: 40, profile: profile(.8, .2, .9, .3),
      history: [
        { time: '2026-07-28T14:00:00.000Z', spot: 100.5, netGex: 10, gammaFlip: 99, putWallPrice: 98, putWallMagnitude: -25, callWallPrice: 102, callWallMagnitude: 40, profile: profile(.7, .2, .8, .3) },
        { time: '2026-07-28T14:06:00.000Z', spot: 101.6, netGex: 10, gammaFlip: 99, putWallPrice: 98, putWallMagnitude: -25, callWallPrice: 102, callWallMagnitude: 40, profile: profile(.8, .2, .7, .2) },
      ],
    }],
  });
  expect(surface!.labels.pcs.spreadMidPnl).toBeCloseTo(-.1);
  expect(surface!.labels.pcs.slippage).toBeCloseTo(.07);
  expect(surface!.labels.pcs.maxLossUtilization).toBeCloseTo(.1);
  expect(surface!.labels.ccs.spreadMidPnl).toBeCloseTo(0);
  expect(surface!.labels.ccs.slippage).toBeCloseTo(.07);
});
