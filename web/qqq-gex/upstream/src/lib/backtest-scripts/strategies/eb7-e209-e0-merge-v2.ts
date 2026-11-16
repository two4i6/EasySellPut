/** E0 source priority on ONE current bar. No dates, completed trades or ledger inputs. */
import type { StrategyObject } from '../strategy-module-v2';
import { EB7_PRE_E235_RULES, EB7_E235_BRANCHES } from '../../engines/analysis/QqqEb7E235Rules';

export type E209Proposal = { source: string; context: Readonly<StrategyObject>; contract: Readonly<StrategyObject> };
type OptionalProposal = E209Proposal | null;
export type E209E0Arm = {
  rawE1: OptionalProposal; e1: OptionalProposal; c4: OptionalProposal;
  blocked: OptionalProposal; gated: OptionalProposal; qualityExcluded: OptionalProposal; researchVetoed: OptionalProposal;
};
const n = (p: E209Proposal, key: string) => Number(p.context[key]);
const eq = (p: E209Proposal, key: string, value: string) => String(p.context[key]) === value;
const first = (proposals: readonly OptionalProposal[]) => proposals.find((p): p is E209Proposal => p !== null) ?? null;
export const e209E45CurrentBarVeto = (p: E209Proposal) => n(p, 'navDrawdownPct') >= .02 && n(p, 'navDrawdownPct') < .06
  && n(p, 'trendScore') >= 0 && n(p, 'trendScore') < 35 && n(p, 'priceVsSma200Pct') >= .05
  && n(p, 'priceVsSma200Pct') < .08 && n(p, 'tqqqRealisedVol20d') >= .5 && n(p, 'tqqqRealisedVol20d') < .65;

function releaseArm(arm: E209E0Arm, vxn: number, vixLower: number) {
  const replacement = !arm.gated && arm.rawE1 && n(arm.rawE1, 'tqqqRealisedVol20d') >= .6 && n(arm.rawE1, 'tqqqRealisedVol20d') < .7
    && (eq(arm.rawE1, 'trend', 'BEAR') || (n(arm.rawE1, 'vix') >= 11 && n(arm.rawE1, 'vix') < 16 && n(arm.rawE1, 'adx14') >= 15))
    ? arm.rawE1 : null;
  const base = arm.gated ?? replacement, p = arm.blocked;
  const release = !base && p && ((n(p, 'vix') >= vixLower && n(p, 'priceVsSma200Pct') >= .05 && n(p, 'priceVsSma200Pct') < .08 && n(p, 'tqqqRealisedVol20d') < .7)
    || (n(p, 'range20dPct') >= 0 && n(p, 'range20dPct') < .03 && n(p, 'weakeningSignalCount') >= 1 && n(p, 'weakeningSignalCount') < 3)
    || (n(p, 'tqqqRoc20') >= .05 && n(p, 'tqqqRoc20') < .1 && n(p, 'priceVsSma200Pct') < 0)
    || (vxn >= 17.5 && vxn < 20.5 && n(p, 'trendScore') < 25)) ? p : null;
  const pre = base ?? release;
  const vetoed = pre && e209E45CurrentBarVeto(pre) ? pre : null;
  const post = pre && !vetoed && !(n(pre, 'roc20') >= -.05 && n(pre, 'roc20') < 0 && n(pre, 'priceExtensionAtr') >= 2) ? pre : null;
  return { replacement, release, vetoed, post };
}
// Ordered E64 union; first-hit provenance is retained without accumulating layers.
const e64 = (p: E209Proposal) => [
  n(p, 'vix') >= 22 && n(p, 'tqqqRealisedVol20d') < .4,
  (eq(p, 'regime', 'RISK_ON_EXTENDED') && n(p, 'tqqqRealisedVol20d') >= .7) || (n(p, 'roc20') < -.05 && n(p, 'trendScore') >= 55) || (eq(p, 'regime', 'RANGE_BOUND') && n(p, 'drawdownFromRecentHighPct') >= .08) || (n(p, 'vix') < 14 && n(p, 'tqqqRealisedVol20d') >= .6) || (n(p, 'tqqqRealisedVol20d') < .6 && n(p, 'range20dPct') >= .15),
  n(p, 'priceVsSma200Pct') >= .1 && n(p, 'drawdownFromRecentHighPct') >= .1,
  n(p, 'tqqqRealisedVol20d') >= 1.2 && n(p, 'adx14') < 20,
  n(p, 'adx14') < 15 && n(p, 'priceExtensionAtr') >= 3,
  eq(p, 'regime', 'RISK_ON_EXTENDED') && n(p, 'drawdownFromRecentHighPct') >= .02,
  n(p, 'tqqqRealisedVol20d') < .4 && n(p, 'priceVsSma200Pct') >= .2,
  n(p, 'tqqqRealisedVol20d') >= .8 && n(p, 'rsi14') >= 70,
  n(p, 'priceExtensionAtr') >= 1 && n(p, 'drawdownFromRecentHighPct') >= .1,
  n(p, 'tqqqRealisedVol20d') < .6 && n(p, 'drawdownFromRecentHighPct') >= .1,
  n(p, 'vix') >= 18 && n(p, 'range20dPct') < .03,
  n(p, 'vix') >= 30 && n(p, 'tqqqRealisedVol20d') < .6,
  n(p, 'roc20') >= .05 && eq(p, 'regime', 'RISK_ON_WEAKENING'),
  n(p, 'priceVsSma200Pct') >= .2 && n(p, 'range20dPct') >= .15,
  n(p, 'adx14') >= 10 && n(p, 'priceVsSma200Pct') < -.1,
  n(p, 'adx14') < 10 && n(p, 'trendScore') < 25,
  n(p, 'priceVsSma200Pct') >= .2 && eq(p, 'regime', 'RANGE_BOUND'),
  n(p, 'priceExtensionAtr') < 1 && n(p, 'roc20') >= .1,
  n(p, 'vix') < 12 && n(p, 'priceExtensionAtr') < -1,
  n(p, 'rsi14') >= 80 && eq(p, 'slowSubregime', 'SR01'),
].findIndex(Boolean);
const e27Keep = (p: E209Proposal) => !(
  (eq(p, 'slowSubregime', 'SR01') && n(p, 'vix') < 14 && n(p, 'adx14') >= 25 && n(p, 'priceExtensionAtr') >= 1.18)
  || (n(p, 'tqqqRealisedVol20d') >= .7 && n(p, 'range20dPct') < .06)
  || (n(p, 'adx14') >= 15 && n(p, 'range20dPct') < .03 && n(p, 'trendScore') < 50)
  || (n(p, 'adx14') < 10 && n(p, 'priceExtensionAtr') >= 3 && n(p, 'range20dPct') < .06)
  || (n(p, 'vix') < 12 && n(p, 'adx14') >= 50 && n(p, 'weakeningSignalCount') >= 1)
  || (n(p, 'tqqqRealisedVol20d') < .6 && n(p, 'priceExtensionAtr') >= -1 && n(p, 'roc20') < -.05)
  || (n(p, 'tqqqRealisedVol20d') >= .3 && n(p, 'priceExtensionAtr') >= 3 && n(p, 'range20dPct') < .05));
const e27Rescue = (p: E209Proposal) =>
  (eq(p, 'regime', 'RANGE_BOUND') && n(p, 'tqqqRealisedVol20d') >= .7)
  || (n(p, 'tqqqRealisedVol20d') < .6 && n(p, 'drawdownFromRecentHighPct') >= .08)
  || (n(p, 'tqqqRealisedVol20d') >= 1 && n(p, 'drawdownFromRecentHighPct') >= .1)
  || (n(p, 'vix') < 14 && n(p, 'range20dPct') >= .1)
  || (n(p, 'vix') >= 22 && n(p, 'tqqqRealisedVol20d') < .4)
  || (n(p, 'vix') >= 30 && n(p, 'priceVsSma200Pct') >= .1)
  || (eq(p, 'slowSubregime', 'SR01') && n(p, 'vix') < 12)
  || (n(p, 'adx14') < 15 && n(p, 'priceExtensionAtr') >= 3)
  || (eq(p, 'regime', 'RISK_ON_EXTENDED') && n(p, 'tqqqRealisedVol20d') >= .7)
  || (n(p, 'roc20') < -.05 && n(p, 'trendScore') >= 55)
  || (eq(p, 'regime', 'RANGE_BOUND') && n(p, 'drawdownFromRecentHighPct') >= .08)
  || (eq(p, 'regime', 'RISK_ON_EXTENDED') && n(p, 'drawdownFromRecentHighPct') >= .02)
  || (n(p, 'tqqqRealisedVol20d') < .4 && n(p, 'priceVsSma200Pct') >= .2)
  || (n(p, 'adx14') < 10 && n(p, 'priceVsSma200Pct') < 0)
  || (n(p, 'adx14') >= 50 && n(p, 'vixTermStructureSlope') >= 2.5)
  || n(p, 'priceVsSma200Pct') < -.1 || (n(p, 'rsi14') >= 75 && n(p, 'trendScore') < 60)
  || (n(p, 'vix') < 14 && n(p, 'tqqqRealisedVol20d') >= .6)
  || (n(p, 'tqqqRealisedVol20d') < .6 && n(p, 'range20dPct') >= .15)
  || (n(p, 'vix') < 17 && n(p, 'priceVsSma200Pct') < 0);

export function mergeE209E0CurrentBar(input: { high: E209E0Arm; low: E209E0Arm; vxn: number }) {
  const { high: h, low: l, vxn } = input;
  if (!Number.isFinite(vxn) || vxn <= 0) throw new Error('Current VXN required for E0');
  const hs = releaseArm(h, vxn, 22.4), ls = releaseArm(l, vxn, 22.4);
  const hp = releaseArm(h, vxn, 22), lp = releaseArm(l, vxn, 22);
  const core = ls.post ? n(ls.post, 'trendScore') >= 50 ? ls.post : hs.post ?? ls.post : null;
  const probe = lp.post ? n(lp.post, 'trendScore') >= 50 ? lp.post : hp.post ?? lp.post : null;
  const e218 = !core && probe && n(probe, 'priceVsSma200Pct') >= .05 && n(probe, 'priceVsSma200Pct') < .06 ? probe : null;
  const base = core ?? e218;
  const selected = (proposal: E209Proposal, reason: string) => ({ proposal, reason, residual: null });
  if (base) return selected(base, core ? 'core-arm-selection' : 'E218-probe');
  // Deduplicate FIRST, then screen the chosen source. No fallback on a failed predicate.
  const e64Pool = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, h.blocked]);
  if (e64Pool && e64(e64Pool) >= 0) return selected(e64Pool, `E64:${e64(e64Pool)}`);
  // E27 alone filters keep before deduplication; preserve this different scope.
  const rescue = first([h.rawE1, h.e1, h.c4, h.blocked, h.qualityExcluded, h.researchVetoed]
    .map(p => p && e27Keep(p) ? p : null));
  if (rescue && e27Rescue(rescue)) {
    const rule = EB7_PRE_E235_RULES.slice(0, 26).find(rule => rule.acceptContext(rescue.context));
    if (rule) return selected(rescue, `rescue:${rule.id}`);
  }
  const highStages = [h.blocked, h.gated, hs.replacement, hs.release, hs.vetoed];
  const lowStages = [l.blocked, l.gated, ls.replacement, ls.release, ls.vetoed];
  const broad = first([h.rawE1, h.e1, h.c4, ...highStages, ...lowStages, e218]);
  const broadRule = broad && EB7_PRE_E235_RULES.slice(26).find(rule => rule.acceptContext(broad.context));
  if (broad && broadRule) return selected(broad, `broad:${broadRule.id}`);
  const residual = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, ...highStages, ...lowStages, e218]);
  const branch = residual && EB7_E235_BRANCHES.find(rule => rule.acceptContext(residual.context));
  if (residual && branch) return selected(residual, `score>=1:${branch.id}`);
  return { proposal: null, reason: 'E0-no-match', residual };
}
