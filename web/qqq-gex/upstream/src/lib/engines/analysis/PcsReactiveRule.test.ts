import { expect, test } from 'bun:test';

import {
  evaluateReactivePcsTiming,
  isReactivePcsTiming,
  REACTIVE_PCS_ALLOWED_REGIMES,
} from './PcsReactiveRule';

test('reactive PCS shared rule allowlist and bounds', () => {
  expect(isReactivePcsTiming('QQQ', 'BULL', 14, 'NONE', 20)).toBeTrue();
  expect(isReactivePcsTiming('QQQ', 'RISK_ON_EXTENDED', 20, 'NONE', 30)).toBeTrue();
  expect(isReactivePcsTiming('QQQ', 'RISK_ON_WEAKENING', 28, 'NONE', 30)).toBeTrue();

  expect(REACTIVE_PCS_ALLOWED_REGIMES).toContain('BULL');
  expect(REACTIVE_PCS_ALLOWED_REGIMES).toContain('RISK_ON_EXTENDED');
  expect(REACTIVE_PCS_ALLOWED_REGIMES).toContain('RISK_ON_WEAKENING');
});

test('reactive PCS shared rule reject by policy boundary', () => {
  expect(isReactivePcsTiming('SPY', 'BULL', 20, 'NONE', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BEAR', 20, 'NONE', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BULL', 13.999, 'NONE', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BULL', 28.001, 'NONE', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BULL', 20, 'CONFIRMED', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BULL', 20, 'PENDING', 20)).toBeFalse();
  expect(isReactivePcsTiming('QQQ', 'BULL', 20, 'NONE', 20)).toBeFalse();
});

test('reactive PCS reason codes are fail-closed and distinct', () => {
  const nanVix = evaluateReactivePcsTiming({
    symbol: 'QQQ',
    regime: 'BULL',
    vix: Number.NaN,
    crisisPhase: 'NONE',
    vix3m: 20,
  });
  expect(nanVix.eligible).toBeFalse();
  expect(nanVix.reasonCodes).toContain('MISSING_VIX');

  const nanTerm = evaluateReactivePcsTiming({
    symbol: 'QQQ',
    regime: 'BULL',
    vix: 20,
    crisisPhase: 'NONE',
    vix3m: 0,
  });
  expect(nanTerm.eligible).toBeFalse();
  expect(nanTerm.reasonCodes).toContain('MISSING_TERM_RATIO');

  const backwardated = evaluateReactivePcsTiming({
    symbol: 'QQQ',
    regime: 'BULL',
    vix: 20,
    crisisPhase: 'NONE',
    vix3m: 19.9,
  });
  expect(backwardated.eligible).toBeFalse();
  expect(backwardated.reasonCodes).toContain('BACKWARDATED_TERM');
  expect(new Set(backwardated.reasonCodes).size).toBe(backwardated.reasonCodes.length);
});
