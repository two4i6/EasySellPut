/** Pruned E209 admission. Fixed rule removal; no date or outcome inputs. */
import type { StrategyObject } from '../strategy-module-v2';
import { E209_PRUNED_RESCUE_RULES, E209_PRUNED_BROAD_RULES, E209_PRUNED_SCORE_RULES, E209_PRUNED_E64_RULES } from './e209-pruned-rules-v1';
export type E209Proposal = {
    source: string;
    context: Readonly<StrategyObject>;
    contract: Readonly<StrategyObject>;
};
type OptionalProposal = E209Proposal | null;
export type E209E0Arm = {
    rawE1: OptionalProposal;
    e1: OptionalProposal;
    c4: OptionalProposal;
    blocked: OptionalProposal;
    gated: OptionalProposal;
    qualityExcluded: OptionalProposal;
    researchVetoed: OptionalProposal;
};
const n = (p: E209Proposal, key: string) => Number(p.context[key]);
const eq = (p: E209Proposal, key: string, value: string) => String(p.context[key]) === value;
const first = (proposals: readonly OptionalProposal[]) => proposals.find((p): p is E209Proposal => p !== null) ?? null;
export const e209E45CurrentBarVeto = (p: E209Proposal) => (n(p, 'navDrawdownPct') >= .02 && n(p, 'navDrawdownPct') < .06
    && n(p, 'trendScore') >= 0 && n(p, 'trendScore') < 35 && n(p, 'priceVsSma200Pct') >= .05
    && n(p, 'priceVsSma200Pct') < .08 && n(p, 'tqqqRealisedVol20d') >= .5 && n(p, 'tqqqRealisedVol20d') < .65);
function releaseArm(arm: E209E0Arm, vxn: number, vixLower: number) {
    const replacement = (!arm.gated && arm.rawE1 && n(arm.rawE1, 'tqqqRealisedVol20d') >= .6 && n(arm.rawE1, 'tqqqRealisedVol20d') < .7
        && (eq(arm.rawE1, 'trend', 'BEAR') || (n(arm.rawE1, 'vix') >= 11 && n(arm.rawE1, 'vix') < 16 && n(arm.rawE1, 'adx14') >= 15)))
        ? arm.rawE1 : null;
    const base = arm.gated ?? replacement, p = arm.blocked;
    const release = !base && p && ((n(p, 'vix') >= vixLower && n(p, 'priceVsSma200Pct') >= .05 && n(p, 'priceVsSma200Pct') < .08 && n(p, 'tqqqRealisedVol20d') < .7)
        || (n(p, 'range20dPct') >= 0 && n(p, 'range20dPct') < .03 && n(p, 'weakeningSignalCount') >= 1 && n(p, 'weakeningSignalCount') < 3)
        || (n(p, 'tqqqRoc20') >= .05 && n(p, 'tqqqRoc20') < .1 && n(p, 'priceVsSma200Pct') < 0)
        || (vxn >= 17.5 && vxn < 20.5 && n(p, 'trendScore') < 25)) ? p : null;
    const pre = base ?? release;
    const vetoed = pre && e209E45CurrentBarVeto(pre) ? pre : null;
    const post = pre && !vetoed ? pre : null;
    return { replacement, release, vetoed, post };
}
const e27Keep = (p: E209Proposal) => !((eq(p, 'slowSubregime', 'SR01') && n(p, 'vix') < 14 && n(p, 'adx14') >= 25 && n(p, 'priceExtensionAtr') >= 1.18)
    || (n(p, 'tqqqRealisedVol20d') >= .7 && n(p, 'range20dPct') < .06));
/** Three shared market conditions replace repeated cross-products; admission is equivalent. */
export const e209MergedRescueMarket = (p: E209Proposal) => (n(p, 'tqqqRealisedVol20d') >= .7
        && (eq(p, 'regime', 'RANGE_BOUND') || eq(p, 'regime', 'RISK_ON_EXTENDED')))
    || (n(p, 'tqqqRealisedVol20d') < .6
        && (n(p, 'drawdownFromRecentHighPct') >= .08 || n(p, 'range20dPct') >= .15))
    || (n(p, 'tqqqRealisedVol20d') >= 1 && n(p, 'drawdownFromRecentHighPct') >= .1)
    || (n(p, 'vix') < 14 && n(p, 'range20dPct') >= .1)
    || (n(p, 'vix') >= 30 && n(p, 'priceVsSma200Pct') >= .1)
    || (eq(p, 'slowSubregime', 'SR01') && n(p, 'vix') < 12)
    || (n(p, 'adx14') < 15 && n(p, 'priceExtensionAtr') >= 3)
    || (n(p, 'roc20') < -.05 && n(p, 'trendScore') >= 55)
    || (n(p, 'priceVsSma200Pct') < 0
        && (n(p, 'adx14') < 10 || n(p, 'vix') < 17 || n(p, 'priceVsSma200Pct') < -.1))
    || (n(p, 'adx14') >= 50 && n(p, 'vixTermStructureSlope') >= 2.5)
    || (n(p, 'rsi14') >= 75 && n(p, 'trendScore') < 60);
export function mergeE209PrunedCurrentBar(input: {
    high: E209E0Arm;
    low: E209E0Arm;
    vxn: number;
}) {
    const { high: h, low: l, vxn } = input;
    if (!Number.isFinite(vxn) || vxn <= 0)
        throw new Error('Current VXN required for E0');
    const hs = releaseArm(h, vxn, 22.4), ls = releaseArm(l, vxn, 22.4);
    const hp = releaseArm(h, vxn, 22), lp = releaseArm(l, vxn, 22);
    const core = ls.post ? n(ls.post, 'trendScore') >= 50 ? ls.post : hs.post ?? ls.post : null;
    const probe = lp.post ? n(lp.post, 'trendScore') >= 50 ? lp.post : hp.post ?? lp.post : null;
    const e218 = !core && probe && n(probe, 'priceVsSma200Pct') >= .05 && n(probe, 'priceVsSma200Pct') < .06 ? probe : null;
    const base = core ?? e218;
    const selected = (proposal: E209Proposal, reason: string) => ({ proposal, reason, residual: null });
    if (base)
        return selected(base, core ? 'core-arm-selection' : 'E218-probe');
    const e64Pool = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, h.blocked]);
    const e64Rule = e64Pool && E209_PRUNED_E64_RULES.find(rule => rule.acceptContext(e64Pool.context));
    if (e64Pool && e64Rule)
        return selected(e64Pool, e64Rule.id);
    const rescue = first([h.rawE1, h.e1, h.c4, h.blocked, h.qualityExcluded, h.researchVetoed]
        .map(p => p && e27Keep(p) ? p : null));
    if (rescue && e209MergedRescueMarket(rescue)) {
        const rule = E209_PRUNED_RESCUE_RULES.find(rule => rule.acceptContext(rescue.context));
        if (rule)
            return selected(rescue, `rescue:${rule.id}`);
    }
    const highStages = [h.blocked, h.gated, hs.replacement, hs.release, hs.vetoed];
    const lowStages = [l.blocked, l.gated, ls.replacement, ls.release, ls.vetoed];
    const broad = first([h.rawE1, h.e1, h.c4, ...highStages, ...lowStages, e218]);
    const broadRule = broad && E209_PRUNED_BROAD_RULES.find(rule => rule.acceptContext(broad.context));
    if (broad && broadRule)
        return selected(broad, `broad:${broadRule.id}`);
    const residual = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, ...highStages, ...lowStages, e218]);
    const branch = residual && E209_PRUNED_SCORE_RULES.find(rule => rule.acceptContext(residual.context));
    if (residual && branch)
        return selected(residual, `score>=1:${branch.id}`);
    return { proposal: null, reason: 'E0-no-match', residual };
}
