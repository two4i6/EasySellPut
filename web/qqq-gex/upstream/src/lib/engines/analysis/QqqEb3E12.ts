import type { QqqEb2Cycle } from './QqqEb2E44Fused';

export type QqqEb3E12Rule = {
  name: string;
  predicate: (cycle: QqqEb2Cycle) => boolean;
};

export type QqqEb3E12Result = {
  cycles: QqqEb2Cycle[];
  released: QqqEb2Cycle[];
  releasedByRule: Array<{ name: string; released: number }>;
};

export type QqqEb3QualityGate = 'none' | 'exclude-unavailable-slow-subregime' | 'exclude-unavailable-slow-subregime-high-rv' | 'exclude-unavailable-slow-subregime-high-rv-high-price';
export type QqqEb3ReplacementRule = 'none' | 'rv20-0.6-0.7-and-trend-bear' | 'rv20-0.6-0.7-and-trend-bear-or-vix-12-16' | 'rv20-0.6-0.7-and-trend-bear-or-stale-bear';
export type QqqEb3RuleVariant = 'baseline' | 'rule2-tqqqroc05' | 'rule2-tqqqroc05-slow-available' | 'rule2-tqqqroc05-slow-confidence';

const date = (cycle: QqqEb2Cycle) => cycle.open.signalDate ?? cycle.open.date ?? '';
const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const number = (cycle: QqqEb2Cycle, key: string, fallback = Number.NaN) => {
  const value = context(cycle)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const text = (cycle: QqqEb2Cycle, key: string) => String(context(cycle)[key] ?? '');

type CurrentContext = Readonly<Record<string, unknown>>;
type PureRule<T> = { name: string; predicate: (observation: T) => boolean };
function contextAccess<T>(read: (observation: T) => CurrentContext) {
  const number = (item: T, key: string, fallback = Number.NaN) => {
    const value = read(item)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const between = (item: T, key: string, lo: number, hi: number) => number(item, key) >= lo && number(item, key) < hi;
  const text = (item: T, key: string) => String(read(item)[key] ?? '');
  const state = (item: T) => `${text(item, 'regime')}|${text(item, 'slowSubregime')}`;
  return { number, between, text, state };
}

/** Final EB2.E1 → E10 branch selected by the original research lineage. */
export function buildQqqEb3PreE12Rules(): QqqEb3E12Rule[] {
  return preE12Rules(context);
}

function preE12Rules<T>(read: (observation: T) => CurrentContext): PureRule<T>[] {
  const { number, between, text, state } = contextAccess(read);
  return [
    { name: 'E1', predicate: (c) => between(c, 'vix', 19, 22) && between(c, 'distanceToSma50Pct', .05, .10) },
    { name: 'E2', predicate: (c) => between(c, 'tqqqRealisedVol20d', 0, .3) && between(c, 'priceVsSma200Pct', .05, .07) },
    { name: 'E3', predicate: (c) => (state(c) === 'BULL|SR01' && text(c, 'trend') === 'BEAR') || (between(c, 'rsi14', 50, 60) && between(c, 'ma50SlopePct', .05, .10)) },
    { name: 'E6', predicate: (c) => (between(c, 'roc20', .05, .10) && text(c, 'trend') === 'NEUTRAL') || (between(c, 'tqqqRoc20', 0, .03) && between(c, 'navDrawdownPct', .01, .02)) || (between(c, 'vixChange5d', -.1, 0) && text(c, 'trend') === 'BEAR') || (between(c, 'vix', 19, 22) && text(c, 'trend') === 'BEAR') },
    { name: 'E7', predicate: (c) => between(c, 'priceExtensionAtr', 1, 2) && between(c, 'vixTermStructureSlope', 1, 2) && between(c, 'roc20', 0, .03) },
    { name: 'E8', predicate: (c) => number(c, 'adx14', -Infinity) >= 40 && number(c, 'trendScore', -Infinity) >= 75 && between(c, 'priceVsSma200Pct', .11, .15) && between(c, 'distanceToSma50Pct', .05, .10) },
    { name: 'E9', predicate: (c) => between(c, 'tqqqRoc20', -.05, 0) && between(c, 'priceVsSma200Pct', .05, .07) && between(c, 'trendScore', 25, 50) && between(c, 'adx14', 15, 20) },
    { name: 'E10', predicate: (c) => between(c, 'vix', 19, 22) && number(c, 'priceExtensionAtr', Infinity) < -1 && between(c, 'distanceToSma50Pct', -.05, 0) && between(c, 'drawdownFromRecentHighPct', .03, .05) && number(c, 'tqqqRoc20', Infinity) < -.05 },
  ];
}

/**
 * EB3 = EB2.E12's seven compact residual-release rules.
 *
 * They are evaluated only against the remaining dynamic C4 universe and do
 * not accept a historical date list or a materialized cycle ledger.
 */
export function buildQqqEb3E12Rules(variant: QqqEb3RuleVariant = 'baseline'): QqqEb3E12Rule[] {
  return e12Rules(context, variant);
}

function e12Rules<T>(read: (observation: T) => CurrentContext, variant: QqqEb3RuleVariant): PureRule<T>[] {
  const { number, between } = contextAccess(read);
  const rules: PureRule<T>[] = [
    { name: 'RSI-60-70&ER20-0.4-0.6&VIX-0-12', predicate: (c) => between(c, 'rsi14', 60, 70) && between(c, 'qqqEr20', .4, .6) && between(c, 'vix', 0, 12) },
    { name: 'VIXTS-1-2&TQQQROC-0.1-INF&ADX-10-15', predicate: (c) => between(c, 'vixTermStructureSlope', 1, 2) && number(c, 'tqqqRoc20', -Infinity) >= .1 && between(c, 'adx14', 10, 15) },
    { name: 'DIST50-0-0.05&RSI-70-INF&NAVDD-0.05-INF', predicate: (c) => between(c, 'distanceToSma50Pct', 0, .05) && number(c, 'rsi14', -Infinity) >= 70 && number(c, 'navDrawdownPct', -Infinity) >= .05 },
    { name: 'VIXTS-0-0.5&VIX-12-16', predicate: (c) => between(c, 'vixTermStructureSlope', 0, .5) && between(c, 'vix', 12, 16) },
    { name: 'DIST20-0-0.05&VIXTS-1-2&TQQQROC--0.05-0', predicate: (c) => between(c, 'distanceToSma20Pct', 0, .05) && between(c, 'vixTermStructureSlope', 1, 2) && between(c, 'tqqqRoc20', -.05, 0) },
    { name: 'EXTATR-1-2&RV20-0-0.3&ADX-15-20', predicate: (c) => between(c, 'priceExtensionAtr', 1, 2) && between(c, 'tqqqRealisedVol20d', 0, .3) && between(c, 'adx14', 15, 20) },
    { name: 'DIST20-0-0.05&VIX-19-22&ADX-10-15', predicate: (c) => between(c, 'distanceToSma20Pct', 0, .05) && between(c, 'vix', 19, 22) && between(c, 'adx14', 10, 15) },
  ];
  if (variant === 'rule2-tqqqroc05' || variant === 'rule2-tqqqroc05-slow-available' || variant === 'rule2-tqqqroc05-slow-confidence') {
    rules[1] = {
      name: variant === 'rule2-tqqqroc05-slow-available'
        ? 'VIXTS-1-2&TQQQROC-0.05-INF&ADX-10-15&SLOW-POSTERIOR-AVAILABLE'
        : variant === 'rule2-tqqqroc05-slow-confidence'
          ? 'VIXTS-1-2&TQQQROC-0.05-INF&ADX-10-15&SLOW-POSTERIOR-GTE-0.5'
        : 'VIXTS-1-2&TQQQROC-0.05-INF&ADX-10-15',
      predicate: (c) => between(c, 'vixTermStructureSlope', 1, 2)
        && number(c, 'tqqqRoc20', -Infinity) >= .05
        && between(c, 'adx14', 10, 15)
        && (variant === 'rule2-tqqqroc05'
          || (variant === 'rule2-tqqqroc05-slow-available' && Number.isFinite(number(c, 'slowSubregimePosterior')))
          || (variant === 'rule2-tqqqroc05-slow-confidence' && number(c, 'slowSubregimePosterior', -Infinity) >= .5)),
    };
  }
  return rules;
}

export function buildQqqEb3E12FullRules(variant: QqqEb3RuleVariant = 'baseline'): QqqEb3E12Rule[] {
  return [...buildQqqEb3PreE12Rules(), ...buildQqqEb3E12Rules(variant)];
}

/** SDK strategies consume current observations, not fabricated cycles or completed ledgers. */
export function buildQqqEb3CurrentBarRules(variant: QqqEb3RuleVariant = 'baseline'): PureRule<CurrentContext>[] {
  const read = (observation: CurrentContext) => observation;
  return [...preE12Rules(read), ...e12Rules(read, variant)];
}

/** One OR predicate over the complete EB3 release bundle; cycle-set equivalent to the layered rules. */
export function buildQqqEb3FusedRules(variant: QqqEb3RuleVariant = 'baseline'): QqqEb3E12Rule[] {
  const rules = buildQqqEb3E12FullRules(variant);
  return [{ name: 'EB3-FUSED-RELEASE-OR', predicate: (cycle) => rules.some((rule) => rule.predicate(cycle)) }];
}

/** Candidate-level quality gate, kept separate from residual release rules for attribution. */
export function applyQqqEb3QualityGate(cycles: readonly QqqEb2Cycle[], gate: QqqEb3QualityGate): QqqEb2Cycle[] {
  if (gate === 'none') return [...cycles];
  if (gate === 'exclude-unavailable-slow-subregime') {
    return cycles.filter((cycle) => text(cycle, 'slowSubregimeHealth') !== 'STALE_OR_MISSING');
  }
  if (gate === 'exclude-unavailable-slow-subregime-high-rv') {
    return cycles.filter((cycle) => !(text(cycle, 'slowSubregimeHealth') === 'STALE_OR_MISSING'
      && number(cycle, 'tqqqRealisedVol20d') >= .6));
  }
  return cycles.filter((cycle) => !(text(cycle, 'slowSubregimeHealth') === 'STALE_OR_MISSING'
    && number(cycle, 'tqqqRealisedVol20d') >= .6
    && number(cycle, 'priceVsSma200Pct') >= .1));
}

export function applyQqqEb3ReplacementRule(
  cycles: readonly QqqEb2Cycle[],
  pool: readonly QqqEb2Cycle[],
  rule: QqqEb3ReplacementRule,
): QqqEb2Cycle[] {
  if (rule === 'none') return [...cycles];
  const used = new Set(cycles.map(date));
  const additions = pool.filter((cycle) => {
    if (used.has(date(cycle))) return false;
    const rvBear = number(cycle, 'tqqqRealisedVol20d') >= .6
      && number(cycle, 'tqqqRealisedVol20d') < .7
      && text(cycle, 'trend') === 'BEAR';
    const vixBand = rule === 'rv20-0.6-0.7-and-trend-bear-or-vix-12-16'
      && number(cycle, 'vix') >= 12
      && number(cycle, 'vix') < 16
      && number(cycle, 'tqqqRealisedVol20d') >= .6
      && number(cycle, 'tqqqRealisedVol20d') < .7;
    const staleBear = rule === 'rv20-0.6-0.7-and-trend-bear-or-stale-bear'
      && text(cycle, 'slowSubregimeHealth') === 'STALE_OR_MISSING'
      && text(cycle, 'trend') === 'BEAR';
    return rvBear || vixBand || staleBear;
  });
  return [...cycles, ...additions].sort((left, right) => date(left).localeCompare(date(right)));
}

export function runQqqEb3E12(
  eb2Cycles: readonly QqqEb2Cycle[],
  c4Cycles: readonly QqqEb2Cycle[],
  rules = buildQqqEb3E12FullRules(),
): QqqEb3E12Result {
  const accepted = [...new Map(eb2Cycles.map((cycle) => [date(cycle), cycle])).values()];
  const acceptedDates = new Set(accepted.map(date));
  const released: QqqEb2Cycle[] = [];
  const releasedByRule: Array<{ name: string; released: number }> = [];
  for (const rule of rules) {
    const additions = c4Cycles.filter((cycle) => !acceptedDates.has(date(cycle)) && rule.predicate(cycle));
    let releasedCount = 0;
    for (const cycle of additions) {
      if (acceptedDates.has(date(cycle))) continue;
      acceptedDates.add(date(cycle));
      accepted.push(cycle);
      released.push(cycle);
      releasedCount++;
    }
    releasedByRule.push({ name: rule.name, released: releasedCount });
  }
  accepted.sort((left, right) => date(left).localeCompare(date(right)));
  return { cycles: accepted, released, releasedByRule };
}

/**
 * Equivalent consolidated form of the release chain. All rules inspect the
 * same residual pool, so a single OR pass produces the same cycle set while
 * retaining first-match attribution for audit output.
 */
export function runQqqEb3E12Union(
  eb2Cycles: readonly QqqEb2Cycle[],
  c4Cycles: readonly QqqEb2Cycle[],
  rules = buildQqqEb3E12FullRules(),
): QqqEb3E12Result {
  const accepted = [...new Map(eb2Cycles.map((cycle) => [date(cycle), cycle])).values()];
  const acceptedDates = new Set(accepted.map(date));
  const releasedByRule = rules.map((rule) => ({ name: rule.name, released: 0 }));
  const released = c4Cycles.filter((cycle) => {
    const cycleDate = date(cycle);
    if (acceptedDates.has(cycleDate)) return false;
    const ruleIndex = rules.findIndex((rule) => rule.predicate(cycle));
    if (ruleIndex < 0) return false;
    acceptedDates.add(cycleDate);
    releasedByRule[ruleIndex]!.released += 1;
    return true;
  });
  accepted.push(...released);
  accepted.sort((left, right) => date(left).localeCompare(date(right)));
  return { cycles: accepted, released, releasedByRule };
}
