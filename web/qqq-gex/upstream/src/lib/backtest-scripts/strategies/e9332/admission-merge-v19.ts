import{evaluateLogic}from'./boolean-runtime-v14';
/** Pruned E209 admission. Fixed rule removal; no date or outcome inputs. */
import type { CompiledAdmission } from './admission-policy-v19';
import type { StrategyObject } from '../../strategy-module-v2';
import { E209_PRUNED_RESCUE_RULES, E209_PRUNED_BROAD_RULES, E209_PRUNED_SCORE_RULES, E209_PRUNED_E64_RULES } from '../e209-pruned-rules-v1';
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
export const e209E45CurrentBarVeto=(p:E209Proposal,compiled:CompiledAdmission)=>evaluateLogic(compiled.logic,'merge.veto',p.context);
function releaseArm(arm: E209E0Arm, vxn: number, vixLower: number, enabled:boolean,vetoEnabled:boolean,compiled:CompiledAdmission) {
    const replacement=enabled&&!arm.gated&&arm.rawE1&&evaluateLogic(compiled.logic,'merge.replacement',arm.rawE1.context,{vxn,vixLower,width:NaN})?arm.rawE1:null;
    const base = arm.gated ?? replacement, p = arm.blocked;
    const release=enabled&&!base&&p&&evaluateLogic(compiled.logic,'merge.release',p.context,{vxn,vixLower,width:NaN})?p:null;
    const pre = base ?? release;
    const vetoed = vetoEnabled && pre && e209E45CurrentBarVeto(pre,compiled) ? pre : null;
    const post = pre && !vetoed ? pre : null;
    return { replacement, release, vetoed, post };
}
const e27Keep=(p:E209Proposal,compiled:CompiledAdmission)=>evaluateLogic(compiled.logic,'merge.e27Keep',p.context);
export const e209MergedRescueMarket=(p:E209Proposal,compiled:CompiledAdmission)=>evaluateLogic(compiled.logic,'merge.rescueMarket',p.context);
export function mergeE209PrunedCurrentBar(input: {
    high: E209E0Arm;
    low: E209E0Arm;
    vxn: number;
}, compiled:CompiledAdmission) {
    const { high: h, low: l, vxn } = input;
    if (!Number.isFinite(vxn) || vxn <= 0)
        throw new Error('Current VXN required for E0');
    const hs = releaseArm(h, vxn, 22.4,compiled.policy.armRelease,compiled.policy.mergeVeto,compiled), ls = releaseArm(l, vxn, 22.4,compiled.policy.armRelease,compiled.policy.mergeVeto,compiled);
    const hp = releaseArm(h, vxn, 22,compiled.policy.armRelease,compiled.policy.mergeVeto,compiled), lp = releaseArm(l, vxn, 22,compiled.policy.armRelease,compiled.policy.mergeVeto,compiled);
    const core = ls.post ? n(ls.post, 'trendScore') >= 50 ? ls.post : hs.post ?? ls.post : null;
    const probe = lp.post ? n(lp.post, 'trendScore') >= 50 ? lp.post : hp.post ?? lp.post : null;
    const e218 = compiled.policy.probe && !core && probe && n(probe, 'priceVsSma200Pct') >= .05 && n(probe, 'priceVsSma200Pct') < .06 ? probe : null;
    const base = core ?? e218;
    const selected = (proposal: E209Proposal, reason: string) => ({ proposal, reason, residual: null });
    if (base)
        return selected(base, core ? 'core-arm-selection' : 'E218-probe');
    const e64Pool = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, h.blocked]);
    const e64Rule = e64Pool && compiled.e64.find(rule => rule.acceptContext(e64Pool.context));
    if (e64Pool && e64Rule)
        return selected(e64Pool, e64Rule.id);
    const rescue = first([h.rawE1, h.e1, h.c4, h.blocked, h.qualityExcluded, h.researchVetoed]
        .map(p => p && e27Keep(p,compiled) ? p : null));
    if (rescue && e209MergedRescueMarket(rescue,compiled)) {
        const rule = compiled.rescue.find(rule => rule.acceptContext(rescue.context));
        if (rule)
            return selected(rescue, `rescue:${rule.id}`);
    }
    const highStages = [h.blocked, h.gated, hs.replacement, hs.release, hs.vetoed];
    const lowStages = [l.blocked, l.gated, ls.replacement, ls.release, ls.vetoed];
    const broad = first([h.rawE1, h.e1, h.c4, ...highStages, ...lowStages, e218]);
    const broadRule = broad && compiled.broad.find(rule => rule.acceptContext(broad.context));
    if (broad && broadRule)
        return selected(broad, `broad:${broadRule.id}`);
    const residual = first([h.rawE1, h.e1, h.c4, h.qualityExcluded, h.researchVetoed, ...highStages, ...lowStages, e218]);
    const branch = residual && compiled.score.find(rule => rule.acceptContext(residual.context));
    if (residual && branch)
        return selected(residual, `score>=1:${branch.id}`);
    return { proposal: null, reason: 'E0-no-match', residual };
}
