/** Pure projection of one as-of native context. Readers retain strategy coercion policy. */
import type { StrategyObject } from './strategy-module-v2';

export type NativeMarketNumberReader = (context: Readonly<StrategyObject>, key: string) => number | undefined;

/** No defaults, volatility substitution, admission, accounts or mutable state. */
export function projectNativeMarketFacts(context: Readonly<StrategyObject>, read: NativeMarketNumberReader) {
  return {
    vix: read(context, 'vix'),
    adx14: read(context, 'adx14'),
    priceVsSma200Pct: read(context, 'priceVsSma200Pct'),
    tqqqRealisedVol20d: read(context, 'tqqqRealisedVol20d'),
    tqqqRoc20: read(context, 'tqqqRoc20'),
    drawdownFromRecentHighPct: read(context, 'drawdownFromRecentHighPct'),
    roc5: read(context, 'roc5'),
    roc20: read(context, 'roc20'),
    range20dPct: read(context, 'range20dPct'),
    priceExtensionAtr: read(context, 'priceExtensionAtr'),
    rsi14: read(context, 'rsi14'),
    trendScore: read(context, 'trendScore'),
    qqqEr20: read(context, 'qqqEr20'),
    weakeningSignalCount: read(context, 'weakeningSignalCount'),
    ma50SlopePct: read(context, 'ma50SlopePct'),
    vixChange5d: read(context, 'vixChange5d'),
  };
}
export type NativeMarketFacts = ReturnType<typeof projectNativeMarketFacts>;

/** PCS keeps every raw field, including existing aliases and their insertion order. */
export function projectNativePcsMarketContext(market: Readonly<StrategyObject>, primaryVol: number, primaryVol3m: number | undefined) {
  return { ...market, qqqROC5: market.roc5, qqqROC20: market.roc20,
    vixTermStructureSlope: primaryVol3m === undefined ? undefined : primaryVol3m - primaryVol };
}
