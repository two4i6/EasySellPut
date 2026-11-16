import type { PcsDynamicMarketState } from '../../types/input';

/** Research-only parent-preserving fallback release; omitted thresholds never release a market state. */
export function passesBullSr01VixFallbackRelease(
  maxVix: number | undefined,
  market: Pick<PcsDynamicMarketState, 'regime' | 'slowSubregime' | 'vix'>,
): boolean {
  return Number.isFinite(maxVix)
    && market.regime === 'BULL'
    && market.slowSubregime === 'SR01'
    && Number.isFinite(market.vix)
    && market.vix! <= maxVix!;
}

/** Replace only the legacy BULL/SR01 VIX-falling subcondition when a ceiling is supplied. */
export function resolvesBullSr01FillFallbackAllowed(
  replacementVixMax: number | undefined,
  market: Pick<PcsDynamicMarketState, 'regime' | 'slowSubregime' | 'vix' | 'vixChange5d'>,
): boolean {
  if (market.regime !== 'BULL' || market.slowSubregime !== 'SR01') return false;
  if (Number.isFinite(replacementVixMax)) return Number.isFinite(market.vix) && market.vix! <= replacementVixMax!;
  return Number.isFinite(market.vixChange5d) && market.vixChange5d! < 0;
}
