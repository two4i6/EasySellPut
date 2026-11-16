import type { QqqEb2Cycle } from './QqqEb2E44Fused';

export type Eb7CurrentBarPredicate = (cycle: QqqEb2Cycle) => boolean;
type ContextPredicate = (context: Readonly<Record<string, unknown>>) => boolean;

export type Eb7RuleSpec = {
  id: string;
  rule: string;
  accept: Eb7CurrentBarPredicate;
  /** Pure SDK seam: a real current observation, no synthetic/completed cycle. */
  acceptContext: ContextPredicate;
};

const context = (cycle: QqqEb2Cycle) => (cycle.open.marketContext ?? {}) as Record<string, unknown>;
const numberField = (context: Readonly<Record<string, unknown>>, key: string) => Number(context[key]);
const equals = (context: Readonly<Record<string, unknown>>, key: string, value: string) => String(context[key]) === value;
const and = (...predicates: ContextPredicate[]): ContextPredicate => context => predicates.every(predicate => predicate(context));
const or = (...predicates: ContextPredicate[]): ContextPredicate => context => predicates.some(predicate => predicate(context));
const ge = (key: string, value: number): ContextPredicate => context => numberField(context, key) >= value;
const gt = (key: string, value: number): ContextPredicate => context => numberField(context, key) > value;
const lt = (key: string, value: number): ContextPredicate => context => numberField(context, key) < value;
const range = (key: string, lower: number, upper: number): ContextPredicate => and(ge(key, lower), lt(key, upper));
const fieldEquals = (key: string, value: string): ContextPredicate => context => equals(context, key, value);

const spec = (id: string, rule: string, acceptContext: ContextPredicate): Eb7RuleSpec => ({ id, rule, acceptContext,
  accept: cycle => acceptContext(context(cycle)) });

/** The validated E67–E200 current-bar continuation, in chronological research order. */
export const EB7_PRE_E235_RULES: readonly Eb7RuleSpec[] = [
  spec('E67', 'rv>=0.80 AND sma>=0.10', and(ge('tqqqRealisedVol20d', .8), ge('priceVsSma200Pct', .1))),
  spec('E68', 'adx>=40 AND adx<50', range('adx14', 40, 50)),
  spec('E70', 'vix>=30 AND adx>=15', and(ge('vix', 30), ge('adx14', 15))),
  spec('E72', 'adx<15 AND rsi>=60', and(lt('adx14', 15), ge('rsi14', 60))),
  spec('E74', 'dd>=0.05 AND regime=RANGE_BOUND', and(ge('drawdownFromRecentHighPct', .05), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E76', 'rsi>=70 AND slow=SR01', and(ge('rsi14', 70), fieldEquals('slowSubregime', 'SR01'))),
  spec('E78', 'ext<3 AND rsi>=75', and(lt('priceExtensionAtr', 3), ge('rsi14', 75))),
  spec('E80', 'adx>=40 AND rsi<70', and(ge('adx14', 40), lt('rsi14', 70))),
  spec('E82', 'vix<14 AND ext>=4', and(lt('vix', 14), ge('priceExtensionAtr', 4))),
  spec('E84', 'sma<0 AND rsi>=60', and(lt('priceVsSma200Pct', 0), ge('rsi14', 60))),
  spec('E86', 'rv<0.40 AND ext<-1', and(lt('tqqqRealisedVol20d', .4), lt('priceExtensionAtr', -1))),
  spec('E88', 'adx<10 AND ext<1', and(lt('adx14', 10), lt('priceExtensionAtr', 1))),
  spec('E90', 'adx>=30 AND ext<0', and(ge('adx14', 30), lt('priceExtensionAtr', 0))),
  spec('E92', 'adx<10 AND roc>=0.10', and(lt('adx14', 10), ge('roc20', .1))),
  spec('E94', 'vix>=18 AND rv<0.30', and(ge('vix', 18), lt('tqqqRealisedVol20d', .3))),
  spec('E95', 'vix<20 AND roc<-0.05', and(lt('vix', 20), lt('roc20', -.05))),
  spec('E96', 'rv<0.40 AND dd>=0.05', and(lt('tqqqRealisedVol20d', .4), ge('drawdownFromRecentHighPct', .05))),
  spec('E97', 'vix<14 AND sma<0', and(lt('vix', 14), lt('priceVsSma200Pct', 0))),
  spec('E100', 'rv>=0.30 AND range<0.10 AND regime=RISK_ON_EXTENDED', and(ge('tqqqRealisedVol20d', .3), lt('range20dPct', .1), fieldEquals('regime', 'RISK_ON_EXTENDED'))),
  spec('E102', 'adx>=15 AND ext<-1 AND roc>=-0.05', and(ge('adx14', 15), lt('priceExtensionAtr', -1), ge('roc20', -.05))),
  spec('E104', 'vix<18 AND adx<10 AND ext<2', and(lt('vix', 18), lt('adx14', 10), lt('priceExtensionAtr', 2))),
  spec('E106', 'adx<20 AND ext>=3 AND rsi<80', and(lt('adx14', 20), ge('priceExtensionAtr', 3), lt('rsi14', 80))),
  spec('E108', 'adx>=15 AND ext>=1 AND trend<50', and(ge('adx14', 15), ge('priceExtensionAtr', 1), lt('trendScore', 50))),
  spec('E110', 'vix>=14 AND vix<18 AND adx>=40', and(range('vix', 14, 18), ge('adx14', 40))),
  spec('E112', 'vix<22 AND rv<0.60 AND roc<-0.05', and(lt('vix', 22), lt('tqqqRealisedVol20d', .6), lt('roc20', -.05))),
  spec('E116', 'adx>=10 AND adx<13.5', range('adx14', 10, 13.5)),
  spec('E123', 'vix<16 AND dd>=0.08', and(lt('vix', 16), ge('drawdownFromRecentHighPct', .08))),
  spec('E126', 'trend<50 AND roc<-0.10', and(lt('trendScore', 50), lt('roc20', -.1))),
  spec('E128', 'adx>=30 AND range<0.03', and(ge('adx14', 30), lt('range20dPct', .03))),
  spec('E130', 'ext<3 AND rsi>=80', and(lt('priceExtensionAtr', 3), ge('rsi14', 80))),
  spec('E132', 'rv<0.30 AND rsi<40', and(lt('tqqqRealisedVol20d', .3), lt('rsi14', 40))),
  spec('E135', 'ext<0 AND rsi>=50 AND dd>=0.05', and(lt('priceExtensionAtr', 0), ge('rsi14', 50), ge('drawdownFromRecentHighPct', .05))),
  spec('E137', 'rv>=0.80 AND sma<0.10 AND slow=SR02', and(ge('tqqqRealisedVol20d', .8), lt('priceVsSma200Pct', .1), fieldEquals('slowSubregime', 'SR02'))),
  spec('E139', 'vix<16 AND adx>=40 AND range>=0.10', and(lt('vix', 16), ge('adx14', 40), ge('range20dPct', .1))),
  spec('E140', 'vix>=22 AND adx>=30 AND regime=RISK_ON_WEAKENING', and(ge('vix', 22), ge('adx14', 30), fieldEquals('regime', 'RISK_ON_WEAKENING'))),
  spec('E141', 'rv>=0.60 AND rsi>=60 AND weak>=2', and(ge('tqqqRealisedVol20d', .6), ge('rsi14', 60), ge('weakeningSignalCount', 2))),
  spec('E142', 'vix>=22 AND rv>=0.60 AND regime=RISK_ON_EXTENDED', and(ge('vix', 22), ge('tqqqRealisedVol20d', .6), fieldEquals('regime', 'RISK_ON_EXTENDED'))),
  spec('E143', 'vix<16 AND adx>=25 AND trend<50', and(lt('vix', 16), ge('adx14', 25), lt('trendScore', 50))),
  spec('E146', 'rv<0.30 AND sma<0.10 AND slow=SR01', and(lt('tqqqRealisedVol20d', .3), lt('priceVsSma200Pct', .1), fieldEquals('slowSubregime', 'SR01'))),
  spec('E148', 'adx<25 AND sma>=0.20 AND roc>=0.10', and(lt('adx14', 25), ge('priceVsSma200Pct', .2), ge('roc20', .1))),
  spec('E149', 'vix<12 AND rsi<70 AND roc>=0.05', and(lt('vix', 12), lt('rsi14', 70), ge('roc20', .05))),
  spec('E151', 'trend<60 AND roc>=0.05 AND regime=BULL', and(lt('trendScore', 60), ge('roc20', .05), fieldEquals('regime', 'BULL'))),
  spec('E152', 'vix<18 AND sma>=0 AND dd>=0.08', and(lt('vix', 18), ge('priceVsSma200Pct', 0), ge('drawdownFromRecentHighPct', .08))),
  spec('E154', 'rv<0.60 AND adx>=30 AND roc<-0.05', and(lt('tqqqRealisedVol20d', .6), ge('adx14', 30), lt('roc20', -.05))),
  spec('E156', 'rv<0.60 AND roc>=0.10 AND weak>=1', and(lt('tqqqRealisedVol20d', .6), ge('roc20', .1), ge('weakeningSignalCount', 1))),
  spec('E158', 'vix>=18 AND adx<20 AND ext>=3', and(ge('vix', 18), lt('adx14', 20), ge('priceExtensionAtr', 3))),
  spec('E160', 'ext<1 AND rsi>=60 AND regime=RANGE_BOUND', and(lt('priceExtensionAtr', 1), ge('rsi14', 60), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E162', 'vix<14 AND ext>=2 AND rsi<60', and(lt('vix', 14), ge('priceExtensionAtr', 2), lt('rsi14', 60))),
  spec('E164', 'rv>=0.60 AND dd>=0.05 AND regime=RANGE_BOUND', and(ge('tqqqRealisedVol20d', .6), ge('drawdownFromRecentHighPct', .05), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E166', 'vix<16 AND rv>=0.60 AND trend>=60', and(lt('vix', 16), ge('tqqqRealisedVol20d', .6), ge('trendScore', 60))),
  spec('E168', 'vix>=22 AND range>=0.10 AND regime=RANGE_BOUND', and(ge('vix', 22), ge('range20dPct', .1), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E170', 'vix<20 AND ext>=1 AND weak>=3', and(lt('vix', 20), ge('priceExtensionAtr', 1), ge('weakeningSignalCount', 3))),
  spec('E172', 'vix<18 AND rsi<40 AND trend>=50', and(lt('vix', 18), lt('rsi14', 40), ge('trendScore', 50))),
  spec('E174', 'vix<14 AND rv>=0.40 AND adx>=40', and(lt('vix', 14), ge('tqqqRealisedVol20d', .4), ge('adx14', 40))),
  spec('E176', 'vix<14 AND ext>=1 AND weak>=2', and(lt('vix', 14), ge('priceExtensionAtr', 1), ge('weakeningSignalCount', 2))),
  spec('E178', 'vix<12 AND adx<15 AND rsi>=60', and(lt('vix', 12), lt('adx14', 15), ge('rsi14', 60))),
  spec('E180', 'sma>=0.10 AND dd>=0.05 AND regime=BULL', and(ge('priceVsSma200Pct', .1), ge('drawdownFromRecentHighPct', .05), fieldEquals('regime', 'BULL'))),
  spec('E182', 'adx>=40 AND range<0.05 AND roc>=0.05', and(ge('adx14', 40), lt('range20dPct', .05), ge('roc20', .05))),
  spec('E184', 'range>=0.10 AND weak>=1 AND regime=RISK_ON_EXTENDED', and(ge('range20dPct', .1), ge('weakeningSignalCount', 1), fieldEquals('regime', 'RISK_ON_EXTENDED'))),
  spec('E186', 'vix>=22 AND ext<1 AND rsi>=60', and(ge('vix', 22), lt('priceExtensionAtr', 1), ge('rsi14', 60))),
  spec('E188', 'vix>=22 AND rv>=1 AND ext<-1', and(ge('vix', 22), ge('tqqqRealisedVol20d', 1), lt('priceExtensionAtr', -1))),
  spec('E190', 'vix>=18 AND ext>=3 AND range<0.10', and(ge('vix', 18), ge('priceExtensionAtr', 3), lt('range20dPct', .1))),
  spec('E192', 'adx<20 AND trend<25 AND regime=BULL', and(lt('adx14', 20), lt('trendScore', 25), fieldEquals('regime', 'BULL'))),
  spec('E194', 'rv<1 AND sma>=0.20 AND slow=SR01', and(lt('tqqqRealisedVol20d', 1), ge('priceVsSma200Pct', .2), fieldEquals('slowSubregime', 'SR01'))),
  spec('E196', 'ext<0 AND rsi>=50 AND trend<25', and(lt('priceExtensionAtr', 0), ge('rsi14', 50), lt('trendScore', 25))),
  spec('E198', 'rv>=0.60 AND adx<10 AND sma>=0.20', and(ge('tqqqRealisedVol20d', .6), lt('adx14', 10), ge('priceVsSma200Pct', .2))),
  spec('E200', 'vix>=25 AND rv<0.60 AND roc<-0.05', and(ge('vix', 25), lt('tqqqRealisedVol20d', .6), lt('roc20', -.05))),
];

/** E234's 17 OR branches; E235 expresses their union as score >= 1. */
export const EB7_E235_BRANCHES: readonly Eb7RuleSpec[] = [
  spec('E202', 'vix>=18 AND rv<0.40 AND roc>=0.05', and(ge('vix', 18), lt('tqqqRealisedVol20d', .4), ge('roc20', .05))),
  spec('E204', 'vix>=25 AND trend>=60 AND roc<0.05', and(ge('vix', 25), ge('trendScore', 60), lt('roc20', .05))),
  spec('E206', 'adx>=40 AND sma>=0.10 AND dd>=0.02', and(ge('adx14', 40), ge('priceVsSma200Pct', .1), ge('drawdownFromRecentHighPct', .02))),
  spec('E208', 'rv>=0.80 AND adx>=15 AND sma>=0.20', and(ge('tqqqRealisedVol20d', .8), ge('adx14', 15), ge('priceVsSma200Pct', .2))),
  spec('E210', 'rv<0.40 AND trend>=60 AND regime=RANGE_BOUND', and(lt('tqqqRealisedVol20d', .4), ge('trendScore', 60), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E212', 'vix<12 AND trend<50 AND regime=BULL', and(lt('vix', 12), lt('trendScore', 50), fieldEquals('regime', 'BULL'))),
  spec('E214', 'rv>=0.60 AND adx>=30 AND sma>=0.20', and(ge('tqqqRealisedVol20d', .6), ge('adx14', 30), ge('priceVsSma200Pct', .2))),
  spec('E216', 'vix<16 AND range<0.03 AND regime=RANGE_BOUND', and(lt('vix', 16), lt('range20dPct', .03), fieldEquals('regime', 'RANGE_BOUND'))),
  spec('E218', 'adx>=15 AND ext<0 AND roc>=0.05', and(ge('adx14', 15), lt('priceExtensionAtr', 0), ge('roc20', .05))),
  spec('E220', 'vix<16 AND rv>=0.60 AND ext<0', and(lt('vix', 16), ge('tqqqRealisedVol20d', .6), lt('priceExtensionAtr', 0))),
  spec('E222', 'vix<14 AND rsi<50 AND regime=BULL', and(lt('vix', 14), lt('rsi14', 50), fieldEquals('regime', 'BULL'))),
  spec('E224', 'adx<25 AND ext<3 AND rsi>=75', and(lt('adx14', 25), lt('priceExtensionAtr', 3), ge('rsi14', 75))),
  spec('E226', 'adx<10 AND ext>=0 AND rsi<50', and(lt('adx14', 10), ge('priceExtensionAtr', 0), lt('rsi14', 50))),
  spec('E228', 'rv<0.40 AND dd>=0.05 AND slow=SR01', and(lt('tqqqRealisedVol20d', .4), ge('drawdownFromRecentHighPct', .05), fieldEquals('slowSubregime', 'SR01'))),
  spec('E230', 'ext>=3 AND range>=0.10 AND roc<0.05', and(ge('priceExtensionAtr', 3), ge('range20dPct', .1), lt('roc20', .05))),
  spec('E232', 'adx<30 AND roc<-0.05 AND regime=BULL', and(lt('adx14', 30), lt('roc20', -.05), fieldEquals('regime', 'BULL'))),
  spec('E234', 'vix<14 AND roc>=0.10 AND slow=SR01', and(lt('vix', 14), ge('roc20', .1), fieldEquals('slowSubregime', 'SR01'))),
];

export const EB7_E235_CONDITION_COUNT = 51 as const;

export function scoreEb7E235(cycle: QqqEb2Cycle): number {
  return EB7_E235_BRANCHES.reduce((score, branch) => score + (branch.accept(cycle) ? 1 : 0), 0);
}

export function admitsEb7E235(cycle: QqqEb2Cycle): boolean {
  return scoreEb7E235(cycle) >= 1;
}
