import type { TradeEntry } from '../leveraged-overlay/backtest/types';

/**
 * Runtime shape used by the recovered EB1.E44-FUSED research chain.
 *
 * The important part of E44 is not an OR of all predicates. Each layer is
 * evaluated against the remaining C4 universe and can only release dates
 * that were not released by an earlier layer. Keeping that operation here
 * makes the ordering explicit and prevents the old broad-union bug.
 */
export type QqqEb2Cycle = {
  open: TradeEntry;
  close: TradeEntry;
  pnl: number;
};

export type QqqEb2Layer = {
  name: string;
  predicate: (cycle: QqqEb2Cycle) => boolean;
};

export type QqqEb2LayerAudit = {
  name: string;
  before: number;
  released: number;
  after: number;
};

export type QqqEb2FusedResult = {
  cycles: QqqEb2Cycle[];
  audit: QqqEb2LayerAudit[];
  releasedByLayer: Array<{ name: string; cycles: QqqEb2Cycle[] }>;
};

const cycleDate = (cycle: QqqEb2Cycle) => cycle.open.signalDate ?? cycle.open.date ?? '';

/**
 * Replays the recovered E44 order:
 *
 *   E1 → E2 … E14 → E16 … E22 → E28 → E31 → E34 → E35/E44
 *
 * `c4Cycles` is the complete, dynamically calculated parent universe. No
 * date whitelist is accepted here. Every release is deduplicated by signal
 * date, matching the recovered script's `addRelease` behavior.
 */
export function runQqqEb2E44Fused(
  eb1Cycles: readonly QqqEb2Cycle[],
  c4Cycles: readonly QqqEb2Cycle[],
  layers: readonly QqqEb2Layer[],
): QqqEb2FusedResult {
  const result = [...new Map(eb1Cycles.map((cycle) => [cycleDate(cycle), cycle])).values()];
  const c4 = [...new Map(c4Cycles.map((cycle) => [cycleDate(cycle), cycle])).values()];
  const released = new Set(result.map(cycleDate));
  const audit: QqqEb2LayerAudit[] = [];
  const releasedByLayer: Array<{ name: string; cycles: QqqEb2Cycle[] }> = [];

  for (const layer of layers) {
    const before = result.length;
    const layerReleased: QqqEb2Cycle[] = [];
    const additions = c4.filter((cycle) => !released.has(cycleDate(cycle)) && layer.predicate(cycle));
    for (const cycle of additions) {
      const date = cycleDate(cycle);
      if (released.has(date)) continue;
      released.add(date);
      result.push(cycle);
      layerReleased.push(cycle);
    }
    result.sort((left, right) => cycleDate(left).localeCompare(cycleDate(right)));
    audit.push({ name: layer.name, before, released: result.length - before, after: result.length });
    releasedByLayer.push({ name: layer.name, cycles: layerReleased });
  }

  return { cycles: result, audit, releasedByLayer };
}

/**
 * Equivalent E44 cycle-set replay when every layer reads the same C4 pool.
 * This removes ordering/attribution scaffolding while preserving the union
 * of the current-bar predicates and the EB1 base cycles.
 */
export function runQqqEb2E44Union(
  eb1Cycles: readonly QqqEb2Cycle[],
  c4Cycles: readonly QqqEb2Cycle[],
  layers: readonly QqqEb2Layer[],
): QqqEb2FusedResult {
  const result = [...new Map(eb1Cycles.map((cycle) => [cycleDate(cycle), cycle])).values()];
  const c4 = [...new Map(c4Cycles.map((cycle) => [cycleDate(cycle), cycle])).values()];
  const released = new Set(result.map(cycleDate));
  const additions = c4.filter((cycle) => !released.has(cycleDate(cycle)) && layers.some((layer) => layer.predicate(cycle)));
  result.push(...additions);
  result.sort((left, right) => cycleDate(left).localeCompare(cycleDate(right)));
  return {
    cycles: result,
    audit: [{ name: 'E44-FUSED-OR', before: result.length - additions.length, released: additions.length, after: result.length }],
    releasedByLayer: [{ name: 'E44-FUSED-OR', cycles: additions }],
  };
}

export const QQE44_LAYER_ORDER = [
  'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E12', 'E13', 'E14',
  'E16', 'E17', 'E18', 'E19', 'E20', 'E21', 'E22', 'E28', 'E31', 'E34', 'E35',
] as const;

type Context = Record<string, unknown>;

function context(cycle: QqqEb2Cycle): Context {
  return (cycle.open.marketContext ?? {}) as Context;
}

function width(cycle: QqqEb2Cycle): number {
  const match = cycle.open.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  return match ? Number(match[2]) - Number(match[1]) : Number.NaN;
}

function pair(left: boolean, right: boolean): boolean {
  return left && right;
}

/**
 * E44's inherited release predicates, evaluated against the current bar.
 * These are deliberately data-independent functions: the returned layers are
 * recomputed for every replay and never materialized as an admission ledger.
 */
export type QqqE44CurrentBar = { marketContext: Readonly<Context>; width: number };

/** Pure current observation/selected-contract view; no trade ledger required. */
export function buildQqqEb2E44CurrentBarLayers(): Array<{ name: string; predicate: (bar: QqqE44CurrentBar) => boolean }> {
  const context = (c: QqqE44CurrentBar) => c.marketContext;
  const n = (c: QqqE44CurrentBar, key: string, fallback = Number.NaN) => {
    const value = context(c)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const b = (c: QqqE44CurrentBar, key: string, lo: number, hi: number) => n(c, key) >= lo && n(c, key) < hi;
  const state = (c: QqqE44CurrentBar) => `${context(c).regime ?? ''}|${context(c).slowSubregime ?? ''}`;
  const width = (c: QqqE44CurrentBar) => c.width;
  const cycleNumber = (c: QqqE44CurrentBar, key: string) => n(c, key);
  const layers: Array<[string, (bar: QqqE44CurrentBar) => boolean]> = [
    ['E2', (c) => (state(c) === 'RANGE_BOUND|SR01' && b(c, 'tqqqRoc20', 0, .05)) || n(c, 'tqqqRealisedVol20d', -Infinity) >= .6 || (width(c) >= 20 && width(c) < 25)],
    ['E3', (c) => (state(c) === 'RISK_ON_WEAKENING|SR01' && width(c) < 3) || (width(c) >= 5 && width(c) < 7 && b(c, 'priceVsSma200Pct', 0, .05))],
    ['E4', (c) => (state(c) === 'BULL|SR02' && b(c, 'vix', 19, 22)) || (state(c) === 'RISK_ON_EXTENDED|SR02' && b(c, 'priceVsSma200Pct', .05, .07))],
    ['E5', (c) => (state(c) === 'BULL|SR01' && b(c, 'vix', 22, 25)) || (state(c) === 'BULL|SR02' && b(c, 'vix', 0, 12))],
    ['E6', (c) => width(c) >= 25 || (state(c) === 'RISK_ON_EXTENDED|SR02' && n(c, 'adx14', Infinity) < 10)],
    ['E7', (c) => (b(c, 'adx14', 0, 10) && b(c, 'priceVsSma200Pct', .07, .11)) || (b(c, 'adx14', 10, 15) && b(c, 'tqqqRoc20', .03, .05)) || (b(c, 'adx14', 20, 25) && b(c, 'vixChange5d', .05, .1))],
    ['E8', (c) => (b(c, 'adx14', 0, 10) && b(c, 'tqqqRoc20', .05, .1)) || (b(c, 'adx14', 30, 40) && b(c, 'priceVsSma200Pct', .11, .15)) || (n(c, 'adx14', -Infinity) >= 40 && b(c, 'vix', 16, 19))],
    ['E9', (c) => (b(c, 'vix', 12, 15) && n(c, 'vixChange5d', -Infinity) >= .1) || (b(c, 'vix', 16, 19) && b(c, 'tqqqRoc20', .03, .05)) || (b(c, 'priceVsSma200Pct', .11, .15) && b(c, 'tqqqRoc20', 0, .03))],
    ['E10', (c) => (b(c, 'adx14', 10, 15) && b(c, 'tqqqRealisedVol20d', .5, .6)) || (b(c, 'priceVsSma200Pct', .05, .07) && n(c, 'tqqqRealisedVol20d', Infinity) < .3)],
    ['E12', (c) => b(c, 'distanceToSma20Pct', .05, .1) || (b(c, 'vixTermStructureSlope', 0, .5) && b(c, 'distanceToSma50Pct', 0, .05)) || (b(c, 'vixTermStructureSlope', .5, 1) && b(c, 'priceExtensionAtr', 0, 1))],
    ['E13', (c) => (b(c, 'distanceToSma50Pct', -.05, 0) && b(c, 'trendScore', 50, 75)) || (b(c, 'drawdownFromRecentHighPct', .05, .08) && n(c, 'trendScore', Infinity) < 25) || (b(c, 'priceExtensionAtr', 1, 2) && n(c, 'rsi14', -Infinity) >= 70)],
    ['E14', (c) => b(c, 'ma50SlopePct', .05, .1) || (state(c) === 'RISK_ON_WEAKENING|SR01' && b(c, 'rsi14', 30, 40))],
    ['E16', (c) => pair(b(c, 'qqqEr20', .6, .8), n(c, 'navDrawdownPct', -Infinity) >= .05) || pair(b(c, 'tqqqRealisedVol20d', .3, .5), b(c, 'slowSubregimePosterior', .99, .999)) || pair(b(c, 'navDrawdownPct', 0, .01), context(c).csPreCrisisActive === true)],
    ['E17', (c) => pair(b(c, 'vixTermStructureSlope', .5, 1), b(c, 'navDrawdownPct', 0, .01)) || pair(b(c, 'roc20', .03, .05), b(c, 'adx14', 10, 15)) || pair(cycleNumber(c, 'vixChange5d') < -.1, b(c, 'slowSubregimePosterior', .9, .99))],
    ['E18', (c) => pair(b(c, 'priceExtensionAtr', 1, 2), b(c, 'tqqqRoc20', .03, .05)) || pair(b(c, 'qqqEr20', .2, .4), context(c).slowSubregimeHealth === 'STALE_OR_MISSING') || pair(n(c, 'vixChange5d', -Infinity) >= .1, n(c, 'navDrawdownPct', -Infinity) >= .05)],
    ['E19', (c) => pair(state(c) === 'RISK_ON_EXTENDED|SR02', n(c, 'slowSubregimePosterior', Infinity) < .9) || pair(b(c, 'rsi14', 60, 70), b(c, 'vix', 0, 12)) || pair(b(c, 'roc20', 0, .03), context(c).trend === 'STRONG_BULL')],
    ['E20', (c) => pair(b(c, 'priceExtensionAtr', -1, 0), b(c, 'roc20', .03, .05)) || pair(b(c, 'adx14', 30, 40), context(c).csPreCrisisActive === true) || pair(b(c, 'adx14', 20, 25), n(c, 'navDrawdownPct', -Infinity) >= .05)],
    ['E21', (c) => pair(b(c, 'vix', 16, 19), b(c, 'navDrawdownPct', 0, .01)) || pair(b(c, 'tqqqRoc20', -.05, 0), context(c).trend === 'BULL') || pair(b(c, 'priceVsSma200Pct', .07, .11), context(c).trend === 'BEAR')],
    ['E22', (c) => pair(b(c, 'vix', 0, 12), b(c, 'tqqqRoc20', .03, .05)) || pair(b(c, 'rsi14', 30, 40), b(c, 'vix', 12, 16)) || pair(b(c, 'qqqEr20', .6, .8), b(c, 'vix', 16, 19))],
    ['E28', (c) => pair(b(c, 'tqqqRealisedVol20d', 0, .3), b(c, 'adx14', 20, 25)) && b(c, 'navDrawdownPct', .02, .05)
      || pair(b(c, 'weakeningSignalCount', 2, 4), b(c, 'vix', 16, 19)) && b(c, 'adx14', 15, 20)
      || pair(b(c, 'qqqEr20', .4, .6), b(c, 'priceVsSma200Pct', .11, .15)) && context(c).trend === 'BULL'
      || pair(b(c, 'vixTermStructureSlope', 1, 2), b(c, 'priceExtensionAtr', 1, 2)) && context(c).trend === 'NEUTRAL'
      || pair(b(c, 'vixTermStructureSlope', 1, 2), b(c, 'priceExtensionAtr', -1, 0)) && b(c, 'roc20', 0, .03)
      || pair(b(c, 'qqqEr20', .4, .6), b(c, 'vix', 16, 19)) && context(c).trend === 'BULL'
      || pair(b(c, 'qqqEr20', .6, .8), b(c, 'roc20', .05, .1)) && context(c).trend === 'BULL'
      || pair(b(c, 'drawdownFromRecentHighPct', .05, .08), b(c, 'roc20', -.05, 0)) && b(c, 'vix', 16, 19)],
    ['E31', (c) => pair(b(c, 'weakeningSignalCount', 2, 4), b(c, 'vix', 16, 19)) && b(c, 'adx14', 15, 20)],
    ['E34', (c) => b(c, 'rsi14', 60, 70) && b(c, 'roc20', .03, .05) && b(c, 'vixChange5d', -.1, 0) && b(c, 'navDrawdownPct', .02, .05)],
    ['E35', (c) => b(c, 'navDrawdownPct', .02, .05)
      && ((b(c, 'navDrawdownPct', .04, .05) && b(c, 'priceExtensionAtr', 3, 4) && b(c, 'adx14', 20, 25))
        || (b(c, 'rsi14', 60, 70) && b(c, 'roc20', .03, .05) && b(c, 'vixChange5d', -.1, 0)))],
  ];
  return layers.map(([name, predicate]) => ({ name, predicate }));
}

/** Historical compatibility uses exactly the same predicate definitions. */
export function buildQqqEb2E44Layers(): QqqEb2Layer[] {
  return buildQqqEb2E44CurrentBarLayers().map(layer => ({ name: layer.name,
    predicate: cycle => layer.predicate({ marketContext: context(cycle), width: width(cycle) }) }));
}
