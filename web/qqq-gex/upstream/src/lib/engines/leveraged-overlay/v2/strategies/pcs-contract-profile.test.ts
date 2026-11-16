import { expect, test } from 'bun:test';
import { isPcsContractProfileStressed, selectPcsContractProfile, usesPcsContractProfileFactor } from './pcs-contract-profile';

test('PCS profile uses frozen regime and volatility inputs only', () => {
  expect(selectPcsContractProfile({ regime: 'BULL', vix: 16, vix3m: 20, annualizedRv20: .16 }))
    .toMatchObject({ shortStrikeSigma: 1.5, targetDte: 42, widthPct: .02 });
  expect(selectPcsContractProfile({ regime: 'BULL', vix: 23, vix3m: 25, annualizedRv20: .18 }))
    .toMatchObject({ shortStrikeSigma: 2.5, targetDte: 28, widthPct: .015 });
  expect(selectPcsContractProfile({ regime: 'BULL', vix: 16, vix3m: undefined, annualizedRv20: .16 })).toBeUndefined();
});

test('PCS stress-only Sigma gate matches dynamic-v1 stressed inputs', () => {
  expect(isPcsContractProfileStressed({ regime: 'BULL', vix: 22, vix3m: 25, annualizedRv20: .18 })).toBe(true);
  expect(isPcsContractProfileStressed({ regime: 'BULL', vix: 17, vix3m: 20, annualizedRv20: .18 })).toBe(false);
  expect(isPcsContractProfileStressed({ regime: 'CRISIS', vix: 17, vix3m: 20, annualizedRv20: .18 })).toBe(true);
});

test('PCS research profile combinations adjust only their named factors', () => {
  expect(['sigma', 'dte', 'width'].map(factor => usesPcsContractProfileFactor('dynamic-v1', factor as 'sigma' | 'dte' | 'width')))
    .toEqual([true, false, false]);
  expect(['sigma', 'dte', 'width'].map(factor => usesPcsContractProfileFactor('dynamic-sigma-dte-v1', factor as 'sigma' | 'dte' | 'width')))
    .toEqual([true, true, false]);
  expect(['sigma', 'dte', 'width'].map(factor => usesPcsContractProfileFactor('dynamic-sigma-width-v1', factor as 'sigma' | 'dte' | 'width')))
    .toEqual([true, false, true]);
  expect(['sigma', 'dte', 'width'].map(factor => usesPcsContractProfileFactor('dynamic-dte-width-v1', factor as 'sigma' | 'dte' | 'width')))
    .toEqual([false, true, true]);
});
