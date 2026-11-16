import {researchIdentifier,researchProfile,researchSelector} from '../p-research-identifiers';
/** Research-only local cover; fixed parent in defaults. No date or money gates. */
import { admissionRiskFacts as base, admissionGrantFacts as grantApi, admissionCoreResearchFacts as coreResearch, admissionExtraResearchFacts as extraResearch, admissionDeepResearchFacts as deepResearch } from './p6-9496-opening-facts-v1';
import { createDecisionMemo } from '../current-bar-facts-v4';
const recoveries = [base.isQqqP4E56RecoveryCurrentBar_db5cca, base.isQqqP4E57RecoveryCurrentBar_db5cca, base.isQqqP4E58RecoveryCurrentBar_db5cca, base.isQqqP4E59RecoveryCurrentBar_db5cca, base.isQqqP4E61RecoveryCurrentBar_db5cca, base.isQqqP4E62RecoveryCurrentBar_db5cca, base.isQqqP4E63RecoveryCurrentBar_db5cca, base.isQqqP4E65RecoveryCurrentBar_db5cca, base.isQqqP4E66RecoveryCurrentBar_db5cca, base.isQqqP4E67RecoveryCurrentBar_db5cca, base.isQqqP4E68RecoveryCurrentBar_db5cca, base.isQqqP4E104RecoveryCurrentBar_db5cca];
const finite = (v: any) => Number.isFinite(v) ? v : NaN;
function roleRow(row: any) { const r = { ...row }; Object.defineProperty(r, 'evaluationMemo', { value: createDecisionMemo(), enumerable: false }); return r; }
function e307Admission(row:any, policy:string){
    if(policy==='legacy')return grantApi.p6E307(row);
    const m=row.market,core=coreResearch.e307Core(row);
    if(core)return true;
    const bare=policy.startsWith('bare-prefix-'),capacity=bare?Number(policy.slice(12)):Number(policy.slice(7));
    if((bare||policy.startsWith('prefix-'))&&coreResearch.e307Leaves.slice(0,capacity).some(fn=>fn(row)))return true;
    if(policy==='core'||bare)return false;

    const term=finite(m.vixTermStructureSlope)<0&&finite(m.distanceToSma20Pct)>=-.02&&finite(m.distanceToSma20Pct)<0;
    if((policy==='core-term'||policy==='core-fringes'||policy.startsWith('prefix-'))&&term)return true;
    return (policy==='core-fringes'||policy.startsWith('prefix-'))&&finite(m.adx14)>=10&&finite(m.adx14)<12&&finite(m.priceExtensionAtr)>=2&&finite(m.priceExtensionAtr)<3;
}
function extraAdmission(row:any,omit:number,sequenceDrop=false){
    if(omit<0&&!sequenceDrop)return grantApi.p6ExtraAdmission(row);
    assert(Number.isInteger(omit)&&omit<extraResearch.groups.length,'Invalid fixed extra group');
    return extraResearch.groups.some((fn,i)=>i!==omit&&(!sequenceDrop||i===0||i===7)&&fn(row));
}
function e348Admission(row:any,policy:string){return policy==='core'?deepResearch.e348Core(row):grantApi.p6E348(row);}
function evaluateAdmission(context: any, state: any, MERGED_RULES: ReadonlyArray<readonly [
    string,
    (r: any) => boolean
]>, model = 'legacy', omit = 'none', replacement = 'none', dropE354 = false, e307Policy = 'legacy', researchPrune = 'none', extraGroupOmit = -1, openingPrune = 'none', e348Policy = 'legacy', extraSequenceDrop = false) {
    if(model==='source-only')return {allowed:true,reason:'P_SIMPLE_SOURCE_PROPOSAL'};
    const original = base.p6ContextRow(context);
    if(model==='coarse-positive'){const m=original.market;return {allowed:Number.isFinite(m.roc5)&&Number.isFinite(m.roc20)&&(m.roc5!>=0||m.roc20!>=0),reason:'P_SIMPLE_POSITIVE_MOMENTUM'};}
    const keepResearch=!['drop-research','core-grants'].includes(model),keepLocal=!['drop-local','core-grants'].includes(model),keepExtra=model!=='core-grants';
    const hard = base, risk = base, grant = grantApi, authority = base;
    const h = roleRow(original), r = roleRow(original), g = roleRow(original), a = roleRow(original), m = original.market;
    const reject = (reason: string) => ({ allowed: false, reason });
    if (hard.p6CurrentBlock(m) || hard.p6PriceSmaBlock(m))
        return reject('P4_CURRENT_STATE_BLOCK');
    if (hard.p6P1Block(h) || m.regime === 'RANGE_BOUND' && m.slowSubregime === 'SR01' && (m.vix ?? Infinity) >= 15 && (m.vix ?? Infinity) < 20 && (m.tqqqRealisedVol20d ?? -Infinity) >= 0.5 && (m.tqqqRealisedVol20d ?? -Infinity) < 0.6 && (m.priceExtensionAtr ?? -Infinity) >= 0.75)
        return reject('P3_BASE_COMPACT_OR_RANGE_BLOCK');
    let researchRisk=false,authorized=false;
    if(keepResearch){
    const residual = researchPrune!=='residual' && risk.isQqqP4E54FlatMergedCurrentBarReject_db5cca(r) && !recoveries.some(fn => fn(r));
    const bull = researchPrune!=='bull' && m.slowSubregime === 'SR01' && m.regime === 'BULL' && finite(m.adx14) < 15 && finite(m.roc20) < 0 && finite(m.tqqqRealisedVol20d) >= 0.45 && finite(m.tqqqRealisedVol20d) < 0.6;
    let range = false;
    if (researchPrune!=='range' && m.regime === 'RANGE_BOUND' && m.slowSubregime === 'SR01' && Number.isFinite(m.roc5) && finite(m.roc5) < 0 && Number.isFinite(m.vix)) {
        const vix = finite(m.vix), extension = finite(m.priceExtensionAtr), term = finite(m.vixTermStructureSlope);
        range = vix >= 26 ? true : vix < 20.5 ? false : vix < 23 ? !Number.isFinite(extension) || extension >= 0 && (!Number.isFinite(term) || term < 0) : !Number.isFinite(extension) || !Number.isFinite(term) || extension >= 0.5 || term < 0;
    }
    const volatile = researchPrune!=='volatile' && finite(m.tqqqRealisedVol20d) >= 1 && finite(m.roc20) >= 0.02 && finite(m.range20dPct) >= 0.13 && finite(m.vixTermStructureSlope) >= 3;
    const negative = researchPrune!=='negative' && finite(m.roc5) < 0 && finite(m.range20dPct) >= 0.15 && finite(m.vix) <= 22;
    researchRisk = residual || bull || range || volatile || negative;
    authorized = researchPrune!=='authorization' && m.regime === 'RISK_ON_EXTENDED' && m.slowSubregime === 'SR02' && Number.isFinite(m.roc5) && m.roc5! >= 0.0044 && Number.isFinite(m.range20dPct) && m.range20dPct! >= 0.0651 && authority.p6RejectQualityGuard(a);
    if (researchRisk && !authorized)
        return reject('P4_RESEARCH_ADDITIONAL_REJECT');
    }
    const normal = openingPrune!=='normal' && !authorized && grant.p6CurrentArm(context, g), market = openingPrune!=='candidate' && !authorized && grant.p6CandidateA(m), rule = keepLocal && !authorized && MERGED_RULES.some(([, fn]: any) => fn(g));
    const additional = authorized || keepExtra&&((omit!=='e307'&&e307Admission(g,e307Policy)) || (omit!=='e348'&&e348Admission(g,e348Policy)) || (omit!=='e354'&&!dropE354&&grant.p6E354(g)) || (omit!=='extra'&&extraAdmission(g,extraGroupOmit,extraSequenceDrop)) || (replacement==='both-positive'&&Number.isFinite(m.roc5)&&Number.isFinite(m.roc20)&&m.roc5!>=0&&m.roc20!>=0) || (replacement==='positive20'&&Number.isFinite(m.roc20)&&m.roc20!>=0));
    const final = hard.p6FinalReject(h, !hard.p6ProtectionBypass(h));
    if (final)
        return reject(final);
    const allowed = authorized || !researchRisk && (normal || market || rule || additional);
    return { allowed, reason: allowed ? 'P6_NET_SCOPED_ADMISSION' : 'P4_NO_PARENT_OR_RULE_MATCH' };
}
import assert from 'node:assert/strict';
import { freezeStrategyData, assertFixedStrategyParams, type BarStrategyModule } from '../strategy-module-v2';
import { P6_3922_POLICY, withP63922Management } from './p6-3922-standalone-v1';
import { p6E385StandaloneV3 } from './p6-e385-standalone-v3';
import { decideP6E385CurrentBar } from './p6-e385-standalone-v2';
import { withP6V3M95 } from './p6-e385-standalone-v3-m-95';
import { resolveOptionQuote } from '../../optionQuote';
export const P6_LOCAL_SPECS=freezeStrategyData([
 {
  "number": 9496,
  "id": "P6.9496",
  "parent": "P6.8891",
  "family": "combined-functions-and-boundaries",
  "overrides": {
   "isQqqP4E63RecoveryCurrentBar_db5cca": false,
   "leaf_isQqqP4E205RecoveryCurrentBar_db5cca": false,
   "leaf_isQqqP4E211RecoveryCurrentBar_db5cca": false,
   "currentAdxBelow_db5cca": true
  },
  "replacements": {
   "priceExtensionAtr:-2.3": -1.5,
   "priceExtensionAtr:0.3": 0,
   "vix:30": 33
  },
  "sourceProfileNumbers": [
   9104,
   8937,
   9117,
   9241,
   8997,
   9001,
   8966
  ],
  "parentSourceSha256": "ecb3d78efcab3df24976bbf2e342a108e853984654b6b5a504ac0821e8ed386e",
  "parentFactsSha256": "a70e16e2a2e1924393ba289b588cabee2401d60195cfd2899c7e2d02ee22596a",
  "formula": [
   0,
   1,
   2,
   3,
   4,
   5,
   6,
   7,
   8,
   9,
   10,
   11,
   12,
   13,
   14,
   15,
   16,
   17,
   18,
   19,
   20,
   21,
   22,
   23,
   24,
   25
  ],
  "tableRules": 26,
  "tableComparisons": 104,
  "comparisonReferencesBefore": 1121,
  "thresholdClassesBefore": 109,
  "retainedParentClauses": [
   0,
   1,
   2,
   3,
   4,
   5,
   6,
   7,
   8,
   9,
   10,
   11,
   12,
   13,
   14,
   15,
   16,
   17,
   18,
   19,
   20,
   21,
   22,
   23,
   24,
   25
  ],
  "emptyClauses": 0,
  "absorbedClauses": 0,
  "factsSourceSha256": "eebf7128fd5f4227f407c44be370c92db3f83f52e2b9a000531a1270331a218d",
  "comparisonReferencesAfter": 1108,
  "thresholdClassesAfter": 106,
  "constantApi": {
   "isQqqP4E63RecoveryCurrentBar_db5cca": false
  },
  "removedReferences": 13
 }
]);
const boxes: ReadonlyArray<(r: any) => boolean> = [
    (r: any) => ((r.market.adx14 ?? Infinity) >= 30 && (r.market.tqqqRealisedVol20d ?? -Infinity) < 0.4 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.35 && (r.selection?.selectedSigma ?? NaN) === 2),
    (r: any) => ((r.market.adx14 ?? Infinity) >= 30 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.35 && (r.selection?.selectedSigma ?? NaN) === 2),
    (r: any) => ((r.market.adx14 ?? Infinity) >= 30 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.4 && (r.selection?.selectedSigma ?? NaN) === 2.5),
    (r: any) => ((r.market.adx14 ?? NaN) < 12 && (r.market.tqqqRealisedVol20d ?? Infinity) >= 0.5 && (r.selection?.selectedNoTouchLower ?? NaN) < 0.4 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.35 && r.market.regime === "RANGE_BOUND"),
    (r: any) => ((r.market.adx14 ?? NaN) < 12 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.35 && (r.selection?.selectedSigma ?? NaN) === 2 && r.market.regime === "BULL"),
    (r: any) => ((r.market.adx14 ?? NaN) < 20 && (r.market.adx14 ?? NaN) >= 12 && (r.market.tqqqRealisedVol20d ?? NaN) < 0.5 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && r.market.regime === "RISK_ON_EXTENDED" && r.market.slowSubregime === "SR02"),
    (r: any) => ((r.market.adx14 ?? NaN) < 20 && (r.market.adx14 ?? NaN) >= 12 && r.market.regime === "BULL" && r.market.slowSubregime === "SR01"),
    (r: any) => ((r.market.adx14 ?? NaN) < 25 && (r.market.adx14 ?? NaN) >= 20 && (r.market.tqqqRealisedVol20d ?? -Infinity) < 0.4 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.35 && r.market.slowSubregime === "SR02"),
    (r: any) => ((r.market.adx14 ?? NaN) < 25 && (r.market.adx14 ?? NaN) >= 20 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && (r.selection?.selectedNoTouchLower ?? NaN) < 0.4 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.35 && r.market.regime === "RISK_ON_EXTENDED"),
    (r: any) => ((r.market.adx14 ?? NaN) < 30 && (r.market.adx14 ?? NaN) >= 20 && (r.market.vix ?? Infinity) >= 25),
    (r: any) => ((r.market.adx14 ?? NaN) < 30 && (r.market.adx14 ?? NaN) >= 25 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.67 && (r.market.vix ?? Infinity) >= 20 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.45),
    (r: any) => ((r.market.adx14 ?? NaN) < 30 && (r.market.adx14 ?? NaN) >= 25 && (r.market.vix ?? NaN) < 20 && (r.market.vix ?? NaN) >= 17),
    (r: any) => ((r.market.adx14 ?? NaN) >= 12 && (r.market.tqqqRealisedVol20d ?? NaN) < 0.6 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.5 && (r.market.vix ?? NaN) < 17 && (r.selection?.selectedSigma ?? NaN) === 2.5),
    (r: any) => ((r.market.tqqqRealisedVol20d ?? NaN) < 0.5 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.49),
    (r: any) => ((r.market.tqqqRealisedVol20d ?? NaN) >= 0.4 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.4 && (r.selection?.selectedSigma ?? NaN) === 2.5 && r.market.regime === "BULL" && r.market.slowSubregime === "SR02"),
    (r: any) => ((r.market.tqqqRealisedVol20d ?? NaN) >= 0.67 && r.market.regime === "RANGE_BOUND"),
    (r: any) => ((r.selection?.selectedNoTouchLower ?? -Infinity) < 0.35 && (r.selection?.selectedSigma ?? NaN) === 2 && r.market.regime === "RANGE_BOUND" && r.market.slowSubregime === "SR01"),
    (r: any) => (r.market.regime === "SIDEWAYS" && r.market.slowSubregime === "CURRENT"),
    (r: any) => ((r.market.adx14 ?? NaN) < 12 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.6 && (r.selection?.selectedNoTouchLower ?? NaN) < 0.45 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.4),
    (r: any) => ((r.market.adx14 ?? NaN) >= 12 && (r.market.vix ?? NaN) >= 20 && r.market.regime === "RISK_ON_EXTENDED"),
    (r: any) => ((r.market.vix ?? NaN) >= 20 && r.market.regime === "RANGE_BOUND"),
    (r: any) => ((r.market.tqqqRealisedVol20d ?? NaN) >= 0.67 && (r.market.vix ?? Infinity) >= 25 && (r.selection?.selectedNoTouchLower ?? NaN) < 0.49),
    (r: any) => ((r.market.adx14 ?? NaN) >= 20 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.6 && (r.selection?.selectedSigma ?? NaN) === 1.5 && r.market.slowSubregime === "SR02"),
    (r: any) => ((r.market.tqqqRealisedVol20d ?? NaN) < 0.6 && (r.market.tqqqRealisedVol20d ?? NaN) >= 0.5 && (r.market.vix ?? NaN) < 17 && (r.selection?.selectedNoTouchLower ?? NaN) >= 0.4 && (r.selection?.selectedSigma ?? NaN) === 2 && r.market.regime === "RANGE_BOUND"),
    (r: any) => ((r.market.adx14 ?? NaN) >= 12 && (r.market.tqqqRealisedVol20d ?? NaN) < 0.5 && r.market.regime === "RANGE_BOUND" && r.market.slowSubregime === "SR01"),
    (r: any) => ((r.market.adx14 ?? NaN) < 12 && (r.selection?.selectedNoTouchLower ?? -Infinity) < 0.35 && (r.selection?.selectedSigma ?? NaN) === 2.5)
];
Object.freeze(boxes);
function geometry(step: any, s: any, policy: any) {
    // Warm-up may contain exit intents without a native market context.
    if (!step.intents.some((i: any) => i.kind === 'open-spread'))
        return step;
    if (policy.geometryWhen && Number(s.market.nativeState.marketContext.vixTermStructureSlope) <= 1)
        policy = { ...policy, ...policy.geometryWhen };
    if (policy.deltaFactor === 1 && policy.dte === 35 && policy.widthFraction === 1)
        return step;
    return { ...step, intents: step.intents.map((i: any) => {
            if (i.kind !== 'open-spread')
                return i;
            const old = i.contract, chain = s.market.chain, referenceExpiry = chain.expirations.find((e: any) => e.date === old.expiry), original = referenceExpiry?.puts.find((q: any) => q.strike === old.shortStrike);
            if (!original || !Number.isFinite(original.delta))
                return policy.absoluteWidthPoints>0?null:i;
            const targetDelta = Math.max(.01, Math.min(.5, Math.abs(original.delta) * policy.deltaFactor)), widthTarget = policy.absoluteWidthPoints>0?Math.min(Number(old.shortStrike)-Number(old.longStrike),policy.absoluteWidthPoints):(Number(old.shortStrike) - Number(old.longStrike)) * policy.widthFraction, fee = Number(s.market.executionCapabilities.commissionPerContract), stamp = Date.parse(chain.timestamp) / 1000;
            const expiry = [...chain.expirations].filter((e: any) => e.date > s.asOf).sort((a: any, b: any) => Math.abs((Date.parse(a.date) - Date.parse(s.asOf)) / 86400000 - policy.dte) - Math.abs((Date.parse(b.date) - Date.parse(s.asOf)) / 86400000 - policy.dte) || a.date.localeCompare(b.date))[0];
            if (!expiry)
                return policy.absoluteWidthPoints>0?null:i;
            const valid = (q: any) => q.strike > 0 && q.delta <= 0 && Number.isFinite(q.delta) && q.openInterest > 0 && q.volume >= 0;
            const shorts = expiry.puts.filter(valid).flatMap((q: any) => { const quote = resolveOptionQuote(q, .5, stamp); return quote?.source === 'market' ? [{ q, quote }] : []; }).sort((a: any, b: any) => Math.abs(Math.abs(a.q.delta) - targetDelta) - Math.abs(Math.abs(b.q.delta) - targetDelta) || a.q.strike - b.q.strike);
            for (const short of shorts) {
                const longs = expiry.puts.filter((q: any) => valid(q) && q.strike < short.q.strike && (!(policy.absoluteWidthPoints>0)||short.q.strike-q.strike<=widthTarget+1e-8)).sort((a: any, b: any) => Math.abs(short.q.strike - a.strike - widthTarget) - Math.abs(short.q.strike - b.strike - widthTarget) || a.strike - b.strike);
                for (const long of longs.slice(0, 3)) {
                    const quote = resolveOptionQuote(long, 2, stamp);
                    if (quote?.source !== 'market')
                        continue;
                    const credit = (short.quote.sell - quote.buy) * 100 - 2 * fee, width = short.q.strike - long.strike;
                    if (!(credit > 0 && width > 0 && width * 100 - credit > 0))
                        continue;
                    return { ...i, contract: { ...old, shortStrike: short.q.strike, longStrike: long.strike, expiry: expiry.date, targetDte: policy.dte }, risk: { ...i.risk, longProtectionFallback: { maximumWidth: width } } };
                }
            }
            return policy.absoluteWidthPoints>0?null:i;
        }).filter(Boolean) };
}
/** Complete research SDK2 artifact; inherits P9775 admission and exits.
 * One unit, fee0 and no money admission gates. The explicit grid changes geometry;
 * the credit-retention rule remains90% of the adjusted signal spread credit.
 */
function weakTwentyDay(m:any){
    assert(Number.isFinite(m.roc20),'Missing causal ROC20');return m.roc20<0;
}
// P9789-P9792: final predeclared smaller doses on the SAME range/ROC20 condition.
// No additional market feature, date gate or pricing fit is introduced.
// P9793-P9801: contract-width5/10 points x target DTE14/21/35, plus lower Delta5-point cases.
// Same complete daily market/chain and parent admission/exits; no funds or occupancy caps.
// Missing valid contracts fail closed; no fallback to a wider spread.
// P9802/P9803: only change positive profit capture relative to P9801.
// Frozen P9804-P9807: wider protection with lower Delta and moderate profit capture.
// P9816/P9817: market-signal admission changes only, no account-size gates.
// P9828/P9829: faster causal momentum admission, same P9805 contracts/exits.
// Relax P9829 only for mild/potentially recoverable early reversals.
// P9848-P9851: isolate falling weak-state entries; preserve P9840 contracts/exits.
// P9852/P9853: preserve weak-rebound filter, adjust only nonweak entry contracts.
// P9854-P9856: fixed midpoint doses after the 1.0/1.2 credit endpoints.
// P9857-P9860: conditional positive-profit protection, same P9854 opening contracts.
// P9861/P9862: retain a little more profit only while both momenta are nonnegative.
// P9871-P9874: lower short risk for wins, compensate income only in strong momentum.
// P9875-P9878: compensate income using narrower/lower-risk weak entries.
// P9879-P9882: preserve weak short Delta; narrow protection or accelerate weak-state profits.
// P9895-P9898: normal high-ADX rapid-rise entries, not weak-entry rejection.
// P9899-P9902: narrower rapid-rise scope, milder Delta/width combinations.
// P9903-P9906: P9900 openings, small strong-state profit capture increments.
// P9907-P9910: retain P9905 income, release small positive aged positions.
// P9912-P9915: P9911 exits, opening efficiency within its same impulse cohort.
// P9922/P9923: only weaken the aged positive-profit floor when momentum deteriorates.
// P9924-P9927: separate profit-signal activation from positive next-open fill floor.
// P9928-P9931: native profit-fill isolation versus lower-risk opening combinations.
// Frozen multi-axis protocol: market-conditioned contracts, expiry, opportunity coverage, causal exit retries.
// Frozen 1000-config factorial protocol: 5 parents × 5 admission scopes ×
// 5 contract geometries × 4 profit-management rules × 2 normal expiries.
// No result-dependent reselection, monetary budgets, date lists, or weights.
export const THOUSAND_PROTOCOL = Array.from({length:1000},(_,i)=>{
    const parentIndex=Math.floor(i/200),admissionIndex=Math.floor(i/40)%5;
    const geometryIndex=Math.floor(i/8)%5,exitIndex=Math.floor(i/2)%4;
    const parents=['P9911','P9923','P9930','P9932','P9947'];
    return {selector:`study-${9952+i}`,base:parentIndex===0?'P9911':parentIndex===2?'P9930':'P9923',
        studyParent:parents[parentIndex],flatRisk:parentIndex>=3,
        premiumMode:parentIndex===4?'healthy':'none',premiumDelta:1.2,premiumWidth:8,premiumExtensionLimit:parentIndex===4?1.5:0,
        restoreMode:['none','mild-early','mild-rebound','both','both'][admissionIndex],
        restoreExtension:admissionIndex===4?1:1.5,
        studyGeometry:['none','normal09','normal08','weak065','impulse075'][geometryIndex],
        studyExit:['none','aged21-45','calm35','falling21-35'][exitIndex],normalDte:i%2===0?35:28};
});
// Frozen full-history recovery-book protocol: scopes × geometry/expiry packages × original-entry quality.
export const RECOVERY_BOOK_PROTOCOL=Array.from({length:64},(_,i)=>{
    const pack=[{dte:35,width:8,delta:.8,capture:.35},{dte:21,width:6,delta:.7,capture:.35},{dte:14,width:5,delta:.7,capture:.25},{dte:28,width:7,delta:.8,capture:.45}][Math.floor(i/4)%4];
    return {...THOUSAND_PROTOCOL[912],selector:`recovery-book-${10991+i}`,premiumDelta:1.3,studyParent:'P10990',guardRelax:'all',
        restoreScope:['all','normal-term','moderate-vol','one-positive'][Math.floor(i/16)],oldQuality:['intact','flat-low','weak-low','both-low'][i%4],
        restoredDte:pack.dte,restoredWidth:pack.width,restoredDelta:pack.delta,recoveredCapture:pack.capture};
});
function p10954MarketBlocked(m:any){
    if(!m)return false;
    const heat=m.priceExtensionAtr>=2&&m.adx14<20,weak=m.regime==='RISK_ON_WEAKENING'&&m.roc5<0&&m.roc20<0;
    const early=m.roc5<0&&m.roc20>=0&&m.adx14<20;
    const rebound=m.roc20<0&&m.roc5>=0&&m.adx14>=25&&!(m.roc20>=-.02&&m.roc5>=.01&&m.priceExtensionAtr<1.5);
    return heat||weak||early||rebound;
}
function recoveryScopeAllowed(scope:string,m:any,turnReady=true){
    return (scope==='momentum-turn'&&turnReady&&!(m?.priceExtensionAtr>=2&&m?.adx14<20))||scope==='all'||scope==='none'||(scope==='normal-term'&&Number.isFinite(m?.vixTermStructureSlope)&&m.vixTermStructureSlope>=0)
        ||(scope==='moderate-vol'&&Number.isFinite(m?.vix)&&m.vix<25)||(scope==='one-positive'&&(m?.roc5>=0||m?.roc20>=0));
}
// Frozen repair protocol: preserve all original admissions; change only original nonweak contracts.
export const CORE_REPAIR_PROTOCOL=Array.from({length:16},(_,i)=>{
    const pack=[{delta:.9,width:8},{delta:.8,width:7},{delta:.7,width:6},{delta:.6,width:5}][Math.floor(i/2)%4];
    return {...THOUSAND_PROTOCOL[912],selector:`core-repair-${11083+i}`,premiumDelta:1.3,studyParent:i%2===0?'P11067':'P11068',
        guardRelax:'all',restoreScope:'momentum-turn',turnGate:i%2===0?'one-step':'two-step',oldQuality:'intact',
        restoredDte:35,restoredWidth:8,restoredDelta:.8,recoveredCapture:.35,restoredNativeCap:true,
        coreRepair:i<8?'low-vix-nonweak':'all-nonweak',coreDelta:pack.delta,coreWidth:pack.width};
});
// Narrow repair scopes and native positive-fill isolation; native trigger and priority unchanged.
export const TARGETED_REPAIR_PROTOCOL=Array.from({length:16},(_,i)=>({...CORE_REPAIR_PROTOCOL[i%2],
    selector:`targeted-repair-${11099+i}`,coreRepair:i<8?'saturated-low':'extended-low',
    coreDelta:Math.floor(i/4)%2===0?.8:.6,coreWidth:Math.floor(i/4)%2===0?7:5,
    relaxNativeFill:Math.floor(i/2)%2===1,nativePositiveFloor:.35}));
// Income-first duration/capture protocol; recovered-only management remains unchanged.
export const INCOME_DURATION_PROTOCOL=Array.from({length:16},(_,i)=>({...CORE_REPAIR_PROTOCOL[i%2],
    selector:`income-duration-${11115+i}`,normalDte:i<8?28:21,normalProfitCapture:Math.floor(i/4)%2===0?.55:.65,
    coreRepair:Math.floor(i/2)%2===0?'none':'all-nonweak',coreDelta:.9,coreWidth:8}));
// Preserve expiry/short-strike geometry; pair quote-valid protection narrowing with income retention.
export const INCOME_PROTECTION_PROTOCOL=Array.from({length:8},(_,i)=>({
    ...(i<4?{...THOUSAND_PROTOCOL[912],premiumDelta:1.3,guardRelax:'all',recoveredCapture:.25}:{...CORE_REPAIR_PROTOCOL[0],coreRepair:'none'}),
    selector:`income-protection-${11131+i}`,studyParent:i<4?'P10990':'P11067',normalDte:35,
    normalProfitCapture:Math.floor(i/2)%2===0?.55:.65,creditRetain:i%2===0?.8:.85}));
// P11138 causal original-book profit protection; preserve every opening contract rule.
export const ORIGINAL_RELEASE_PROTOCOL=Array.from({length:8},(_,i)=>({...INCOME_PROTECTION_PROTOCOL[7],
    selector:`original-release-${11139+i}`,studyParent:'P11138',originalReleaseMode:i<4?'falling5':'turn-down',
    originalReleaseAge:Math.floor(i/2)%2===0?14:21,originalReleaseCapture:i%2===0?.5:.55}));
// Stress-conditioned original-book releases; prices/momentum and stress all known at decision time.
export const STRESS_RELEASE_PROTOCOL=Array.from({length:8},(_,i)=>({...ORIGINAL_RELEASE_PROTOCOL[4],
    selector:`stress-release-${11147+i}`,originalReleaseStress:i<4?'vix20':'backwardation',
    originalReleaseAge:Math.floor(i/2)%2===0?14:21,originalReleaseCapture:i%2===0?.5:.55}));
// Frozen structural ablations, ranked by complexity rather than best historical P/L.
export const SIMPLIFY_PROTOCOL=Array.from({length:10},(_,i)=>({...ORIGINAL_RELEASE_PROTOCOL[5],
    selector:`simplify-${11155+i}`,studyParent:'P11144',admissionModel:['drop-local','drop-research','core-grants','coarse-positive','source-only'][Math.floor(i/2)],
    compactProfits:i%2===1,normalProfitCapture:i%2===1?.6:.65,originalReleaseCapture:i%2===1?.5:.55,recoveredCapture:i%2===1?.3:.35}));
// Stage2 structural deletions on the frozen drop-local center; never drop by losing dates.
export const GRANT_PRUNE_PROTOCOL=Array.from({length:4},(_,i)=>({...SIMPLIFY_PROTOCOL[0],
    selector:`grant-prune-${11165+i}`,studyParent:'P11155',admissionOmit:['e307','e348','e354','extra'][i]}));
// Two prespecified coarse replacements for the large E307 grant; retain all risk filters.
export const COARSE_GRANT_PROTOCOL=Array.from({length:2},(_,i)=>({...SIMPLIFY_PROTOCOL[0],
    selector:`coarse-grant-${11169+i}`,studyParent:'P11155',admissionOmit:'e307',dropE354:true,admissionReplacement:i===0?'both-positive':'positive20'}));
// Sensitivity checks only: fixed single-coordinate perturbations; never reselect a winner.
export const SIMPLIFY_NEIGHBOR_PROTOCOL=Array.from({length:10},(_,i)=>{
    const field=['normalProfitCapture','creditRetain','originalReleaseAge','originalReleaseCapture','recoveredCapture'][Math.floor(i/2)];
    const center:any=GRANT_PRUNE_PROTOCOL[2],dose=field==='originalReleaseAge'?7:.05,delta=i%2===0?-dose:dose;
    return {...center,selector:`simplify-neighbor-${11171+i}`,studyParent:'P11167',sensitivityOnly:true,sensitivityField:field,sensitivityDelta:delta,
        [field]:Math.round((Number(center[field])+delta)*100)/100};
});
// Structural rollback of E307's appended leaves, with no new thresholds or date exceptions.
export const E307_CORE_PROTOCOL=Array.from({length:3},(_,i)=>({...GRANT_PRUNE_PROTOCOL[2],
    selector:`e307-core-${11181+i}`,studyParent:'P11167',e307Policy:['core','core-term','core-fringes'][i]}));
// Prespecified structural capacity budgets, in original source-growth order, never return-ranked.
export const E307_CAPACITY_PROTOCOL=Array.from({length:3},(_,i)=>({...GRANT_PRUNE_PROTOCOL[2],
    selector:`e307-capacity-${11184+i}`,studyParent:'P11167',e307Policy:`prefix-${[8,16,24][i]}`}));
// Recover income without restoring pruned entry leaves, fine thresholds or quantity changes.
export const PRUNED_INCOME_PROTOCOL=[
    {normalProfitCapture:.70,unifyAgedProfits:false},{normalProfitCapture:.70,unifyAgedProfits:true},
    {normalProfitCapture:.75,unifyAgedProfits:false},{normalProfitCapture:.75,unifyAgedProfits:true},
    {normalProfitCapture:.65,unifyAgedProfits:true}
].map((pack,i)=>({...E307_CAPACITY_PROTOCOL[2],...pack,selector:`pruned-income-${11187+i}`,studyParent:'P11186'}));
// Frozen six-coordinate risk/capital study; no admission additions or monetary caps.
export const PRUNED_RISK_PROTOCOL=[
    {creditRetain:.80},{creditRetain:.75},{normalDte:28},
    {originalReleaseAge:7},{recoveredCapture:.30},{creditRetain:.80,originalReleaseAge:7}
].map((pack,i)=>({...PRUNED_INCOME_PROTOCOL[2],...pack,selector:`pruned-risk-${11192+i}`,studyParent:'P11189'}));
// Follow-up: existing coarse geometry roles, fixed four mechanisms, no date fitting.
export const PRUNED_DELTA_PROTOCOL=[
    {studyGeometry:'normal09'},{studyGeometry:'normal08'},
    {studyGeometry:'weak065'},{studyGeometry:'impulse075'}
].map((pack,i)=>({...PRUNED_INCOME_PROTOCOL[2],...pack,selector:`pruned-delta-${11198+i}`,studyParent:'P11189'}));
// Original-book release study following reconciled drawdown attribution; fixed six variants.
export const ORIGINAL_EXIT_PROTOCOL=[
    {originalReleaseAge:14,originalReleaseCapture:.50},
    {originalReleaseAge:14,originalReleaseCapture:.45},
    {originalReleaseAge:7,originalReleaseCapture:.50},
    {originalReleaseAge:7,originalReleaseCapture:.45},
    {originalReleaseMode:'falling5'},
    {originalReleaseAge:0}
].map((pack,i)=>({...PRUNED_RISK_PROTOCOL[4],...pack,selector:`original-exit-${11202+i}`,studyParent:'P11196'}));
// Occupancy study: isolate quote geometry by actual entry role and holding time.
export const OCCUPANCY_PROTOCOL=[
    {protectionScope:'recovery',scopedCreditRetain:.80},
    {protectionScope:'recovery',scopedCreditRetain:.75},
    {protectionScope:'original',scopedCreditRetain:.80},
    {restoredDte:28},
    {recoveredCapture:.25},
    {normalProfitCapture:.70}
].map((pack,i)=>({...PRUNED_RISK_PROTOCOL[4],...pack,selector:`occupancy-${11208+i}`,studyParent:'P11196'}));
// P11209 follow-up: coarse original-book geometry and existing exit modules only.
export const ROLE_EFFICIENCY_PROTOCOL=[
    {originalProtectionCondition:'falling5',originalCreditRetain:.80},
    {originalProtectionCondition:'weak20',originalCreditRetain:.80},
    {normalProfitCapture:.70},
    {recoveredCapture:.25},
    {agedExitDays:21},
    {originalReleaseMode:'falling5',normalProfitCapture:.70}
].map((pack,i)=>({...OCCUPANCY_PROTOCOL[1],...pack,selector:`role-efficiency-${11214+i}`,studyParent:'P11209'}));
// P11219 continuation: coarse causal original-entry confirmation and exit execution.
export const CONFIRM_EXECUTION_PROTOCOL=[
    {originalEntryConfirmation:'falling5'},
    {originalEntryConfirmation:'weak20'},
    {originalEntryConfirmation:'all'},
    {originalReleaseAge:7},
    {recoveredCapture:.25},
    {originalNativePositiveFloor:.35}
].map((pack,i)=>({...ROLE_EFFICIENCY_PROTOCOL[5],...pack,selector:`confirm-execution-${11220+i}`,studyParent:'P11219'}));
// Broad geometry mechanisms on P11219; width thresholds reuse native 8/10-point tiers.
export const GEOMETRY_EFFICIENCY_PROTOCOL=[
    {wideProtectionTrigger:8,wideProtectionRetain:.80},
    {wideProtectionTrigger:10,wideProtectionRetain:.80},
    {normalDte:28,normalDteMode:'low-vix'},
    {normalDte:28,normalDteMode:'high-vix'},
    {weakOptimizeDelta:.75},
    {weakOptimizeWidth:8}
].map((pack,i)=>({...ROLE_EFFICIENCY_PROTOCOL[5],...pack,selector:`geometry-efficiency-${11226+i}`,studyParent:'P11219'}));
// Complete the previously omitted native-width fallback; old IDs retain their exact rules.
export const WIDE_FALLBACK_PROTOCOL=[8,10].map((width,i)=>({...ROLE_EFFICIENCY_PROTOCOL[5],wideProtectionTrigger:width,wideProtectionRetain:.80,wideFallbackEnabled:true,
    selector:`wide-fallback-${11232+i}`,studyParent:'P11219'}));
// Isolate widths above the existing normal eight-point geometry; no new admission filter.
export const ABOVE_NORMAL_WIDTH_PROTOCOL=[.80,.75,.70].map((retention,i)=>({...ROLE_EFFICIENCY_PROTOCOL[5],wideProtectionTrigger:8,
    wideProtectionRetain:retention,wideFallbackEnabled:true,wideStrictAbove:true,selector:`above-normal-width-${11234+i}`,studyParent:'P11219'}));
// Structural deletions on fixed P11219: no new thresholds or return-ranked leaf subsets.
export const P11219_SIMPLIFY_PROTOCOL=[
    {admissionOmit:'e348',dropE354:true},
    {admissionOmit:'extra',dropE354:true},
    {e307Policy:'prefix-16'},
    {e307Policy:'bare-prefix-24'},
    {agedExitDays:0},
    {originalReleaseMode:'none'}
].map((pack,i)=>({...ROLE_EFFICIENCY_PROTOCOL[5],...pack,selector:`p11219-simplify-${11237+i}`,studyParent:'P11219'}));
// Continue fixed P11240's structural deletion; no admission or contract changes.
export const P11240_EXIT_PROTOCOL=[
    {weakProfitCeiling:.45},{weakProfitCeiling:.35},
    {originalReleaseCapture:.50},{originalReleaseAge:7},
    {recoveredCapture:.25},{wideAgedCapture:.55}
].map((pack,i)=>({...P11219_SIMPLIFY_PROTOCOL[3],...pack,selector:`p11240-exit-${11243+i}`,studyParent:'P11240'}));
// Distinct risk-exit stage: observed contract barriers, no calibrated percentage stop.
export const CONTRACT_BARRIER_PROTOCOL=['short','long'].map((barrier,i)=>({...P11219_SIMPLIFY_PROTOCOL[3],contractBarrier:barrier,
    selector:`contract-barrier-${11249+i}`,studyParent:'P11240'}));
// One whole additional-research branch removed per profile; hard/core risk remains.
export const ADDITIONAL_PRUNE_PROTOCOL=['authorization','residual','bull','range','volatile','negative'].map((prune,i)=>({
    ...P11219_SIMPLIFY_PROTOCOL[3],researchPrune:prune,selector:`additional-prune-${11251+i}`,studyParent:'P11240'}));
// Original eight-group OR structure, one group removed per fixed profile, never P&L-ranked.
export const EXTRA_GROUP_PRUNE_PROTOCOL=Array.from({length:8},(_,i)=>({...ADDITIONAL_PRUNE_PROTOCOL[0],extraGroupOmit:i,
    selector:`extra-group-prune-${11257+i}`,studyParent:'P11251'}));
// Whole opening-path ablations on P11262, with no replacement conditions or tuned thresholds.
export const DEEP_OPENING_PRUNE_PROTOCOL=[
    {openingPrune:'normal'},{openingPrune:'candidate'},{e348Policy:'core'},
    {e307Policy:'bare-prefix-16'},{e307Policy:'core'},{extraSequenceDrop:true}
].map((pack,i)=>({...EXTRA_GROUP_PRUNE_PROTOCOL[5],...pack,selector:`deep-opening-${11265+i}`,studyParent:'P11262'}));
export const CONTRACT_GRID = freezeStrategyData([
    ...DEEP_OPENING_PRUNE_PROTOCOL,
    ...EXTRA_GROUP_PRUNE_PROTOCOL,
    ...ADDITIONAL_PRUNE_PROTOCOL,
    ...CONTRACT_BARRIER_PROTOCOL,
    ...P11240_EXIT_PROTOCOL,
    ...P11219_SIMPLIFY_PROTOCOL,
    ...ABOVE_NORMAL_WIDTH_PROTOCOL,
    ...WIDE_FALLBACK_PROTOCOL,
    ...GEOMETRY_EFFICIENCY_PROTOCOL,
    ...CONFIRM_EXECUTION_PROTOCOL,
    ...ROLE_EFFICIENCY_PROTOCOL,
    ...OCCUPANCY_PROTOCOL,
    ...ORIGINAL_EXIT_PROTOCOL,
    ...PRUNED_DELTA_PROTOCOL,
    ...PRUNED_RISK_PROTOCOL,
    ...PRUNED_INCOME_PROTOCOL,
    ...E307_CAPACITY_PROTOCOL,
    ...E307_CORE_PROTOCOL,
    ...SIMPLIFY_NEIGHBOR_PROTOCOL,
    ...COARSE_GRANT_PROTOCOL,
    ...GRANT_PRUNE_PROTOCOL,
    ...SIMPLIFY_PROTOCOL,
    ...STRESS_RELEASE_PROTOCOL,
    ...ORIGINAL_RELEASE_PROTOCOL,
    ...INCOME_PROTECTION_PROTOCOL,
    ...INCOME_DURATION_PROTOCOL,
    ...TARGETED_REPAIR_PROTOCOL,
    ...CORE_REPAIR_PROTOCOL,
    ...RECOVERY_BOOK_PROTOCOL,
    ...Array.from({length:16},(_,i)=>({...THOUSAND_PROTOCOL[912],selector:`momentum-recovery-${11067+i}`,premiumDelta:1.3,studyParent:'P10990',guardRelax:'all',restoreScope:'momentum-turn',
        oldQuality:['intact','saturated-low','both-low','both-low-saturated'][Math.floor(i/4)],turnGate:i%2===0?'one-step':'two-step',
        restoredDte:Math.floor(i/2)%2===0?35:28,restoredWidth:Math.floor(i/2)%2===0?8:7,restoredDelta:.8,recoveredCapture:Math.floor(i/2)%2===0?.35:.45,restoredNativeCap:true})),
    ...Array.from({length:4},(_,i)=>({...RECOVERY_BOOK_PROTOCOL[11],selector:`short-quoted-edge-${11063+i}`,studyParent:'P11002',minIvRv:i<2?1.1:1.25,minCreditFraction:i%2===0?.10:.15,restoredNativeCap:true})),
    ...Array.from({length:8},(_,i)=>({...THOUSAND_PROTOCOL[912],selector:`quoted-edge-${11055+i}`,premiumDelta:1.3,studyParent:'P10990',guardRelax:'all',restoreScope:'all',
        oldQuality:i%2===0?'intact':'saturated-low',restoredDte:i<4?35:21,restoredWidth:i<4?8:7,restoredDelta:.8,recoveredCapture:.35,
        minIvRv:Math.floor(i/2)%2===0?1.1:1.25,minCreditFraction:Math.floor(i/2)%2===0?.10:.15})),
    ...THOUSAND_PROTOCOL,
    ...[
        {selector:'recovered-selected-early35',guardRelax:'selected-early',recoveredCapture:.35,premiumDelta:1.3,studyParent:'P10976'},
        {selector:'recovered-selected-early45',guardRelax:'selected-early',recoveredCapture:.45,premiumDelta:1.3,studyParent:'P10976'},
        {selector:'recovered-selected-weak35',guardRelax:'selected-weak',recoveredCapture:.35,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'recovered-selected-both-width8-35',guardRelax:'selected-both',weakOptimizeWidth:8,recoveredCapture:.35,premiumDelta:1.3,studyParent:'P10982'},
        {selector:'recovered-all25',guardRelax:'all',recoveredCapture:.25,premiumDelta:1.3,studyParent:'P10968'},
        {selector:'geometry-selected-weak-width8',guardRelax:'selected-weak',weakOptimizeWidth:8,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'geometry-selected-weak-delta07-width8',guardRelax:'selected-weak',weakOptimizeDelta:.7,weakOptimizeWidth:8,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'geometry-selected-both-width8',guardRelax:'selected-both',weakOptimizeWidth:8,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'geometry-selected-both-delta07-width8',guardRelax:'selected-both',weakOptimizeDelta:.7,weakOptimizeWidth:8,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'geometry-selected-both-delta07-width7',guardRelax:'selected-both',weakOptimizeDelta:.7,weakOptimizeWidth:7,premiumDelta:1.3,studyParent:'P10978'},
        {selector:'geometry-no-restoration-delta07-width8',weakOptimizeDelta:.7,weakOptimizeWidth:8,premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-mildweak-aged21',guardRelax:'mild-weakening',studyExit:'aged21-45',premiumDelta:1.3,studyParent:'P10969'},
        {selector:'efficiency-mildweak-falling21',guardRelax:'mild-weakening',studyExit:'falling21-35',premiumDelta:1.3,studyParent:'P10969'},
        {selector:'efficiency-selected-rebound',guardRelax:'selected-rebound',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-selected-rebound-aged21',guardRelax:'selected-rebound',studyExit:'aged21-45',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-selected-early',guardRelax:'selected-early',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-selected-early-aged21',guardRelax:'selected-early',studyExit:'aged21-45',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-selected-weak',guardRelax:'selected-weak',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'efficiency-selected-weak-aged21',guardRelax:'selected-weak',studyExit:'aged21-45',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'guard-mild-weakening',guardRelax:'mild-weakening',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'guard-mild-early',restoreMode:'both',premiumDelta:1.3,studyParent:'P10954'},
        {selector:'guard-mild-rebound',guardRelax:'mild-rebound',premiumDelta:1.3,studyParent:'P10954'},
        ...['heat','weakening','early','rebound','all'].map(guardRelax=>({selector:`guard-relax-${guardRelax}`,guardRelax,premiumDelta:1.3,studyParent:'P10954'})),
        {selector:'follow-premium16',premiumDelta:1.6,studyParent:'P10954'},
        {selector:'follow-premium16-defence09-width8',premiumDelta:1.6,followDefence:'other-normal',followDefenceDelta:.9,followDefenceWidth:8,studyParent:'P10954'},
        {selector:'follow-premium16-defence08-width8',premiumDelta:1.6,followDefence:'other-normal',followDefenceDelta:.8,followDefenceWidth:8,studyParent:'P10954'},
        {selector:'follow-premium16-defence105-width7',premiumDelta:1.6,followDefence:'other-normal',followDefenceDelta:1.05,followDefenceWidth:7,studyParent:'P10954'},
        {selector:'follow-impulse-width7',followImpulse:'width7'},
        {selector:'follow-impulse-delta08',followImpulse:'delta08'},
        {selector:'follow-premium13',premiumDelta:1.3},
        {selector:'follow-premium-width7',premiumWidth:7},
        {selector:'follow-lowvix-normal',followDefence:'other-normal'},
        {selector:'follow-lowvix-nonweak',followDefence:'nonweak'},
        {selector:'follow-premium13-lowvix-normal',premiumDelta:1.3,followDefence:'other-normal'},
        {selector:'follow-premium13-lowvix-nonweak',premiumDelta:1.3,followDefence:'nonweak'}
    ].map(p=>({...THOUSAND_PROTOCOL[912],...p,studyParent:(p as any).studyParent??'P10864'})),
    {selector:'restore-both-low-risk',base:'P9930',restoreMode:'both'},
    {selector:'restore-both-p9911',base:'P9911',restoreMode:'both'},
    {selector:'restore-both-flat-defence',base:'P9923',flatRisk:true,restoreMode:'both'},
    {selector:'restore-both-cool-premium',base:'P9923',flatRisk:true,premiumMode:'healthy',premiumDelta:1.2,premiumWidth:8,premiumExtensionLimit:1.5,restoreMode:'both'},
    {selector:'control',base:'P9854'},
    {selector:'control-p9911',base:'P9911'},
    {selector:'control-p9930',base:'P9930'},
    {selector:'control-p9932',base:'P9923',flatRisk:true},
    {selector:'premium-highvol',base:'P9930',premiumMode:'high-vol',premiumDelta:1.4},
    {selector:'premium-healthy-trend',base:'P9930',premiumMode:'healthy',premiumDelta:1.2},
    {selector:'normal-dte28',base:'P9911',normalDte:28},
    {selector:'normal-dte42',base:'P9911',normalDte:42},
    {selector:'restore-mild-early',base:'P9930',restoreMode:'mild-early'},
    {selector:'restore-mild-rebound',base:'P9930',restoreMode:'mild-rebound'},
    {selector:'retry-owned-profit',base:'P9911',latchMode:'own'},
    {selector:'retry-all-profit',base:'P9911',latchMode:'all'},
    {selector:'flat-defence-healthy-premium',base:'P9923',flatRisk:true,premiumMode:'healthy',premiumDelta:1.2,premiumWidth:8},
    {selector:'flat-defence-cool-premium',base:'P9923',flatRisk:true,premiumMode:'healthy',premiumDelta:1.2,premiumWidth:8,premiumExtensionLimit:1.5}
].map(p=>({...p,id:researchIdentifier('multiAxis',p.selector),
    entryAction:p.base==='P9854'?'none':'geometry',impulseDelta:p.base==='P9854'?1.05:p.base==='P9911'?.9:.85,
    strongCapture:(p as any).normalProfitCapture??(p.base==='P9854'?.5:.5075),ageDays:p.base==='P9854'?0:((p as any).agedExitDays??28),agedCapture:((p as any).compactProfits||(p as any).unifyAgedProfits)?.5:(p.base==='P9854'?.5:.475),
    extraMode:p.base==='P9930'||p.base==='P9923'?'falling5':'none',opportunityMode:'none',opportunityCapture:.5,relaxFill:false,relaxNativeFill:(p as any).relaxNativeFill??false,
    normalRiskScope:p.base==='P9930'?'all':'none',normalRiskDelta:.8,normalRiskWidth:7,
    premiumMode:(p as any).premiumMode??'none',premiumDelta:(p as any).premiumDelta??1.2,premiumWidth:(p as any).premiumWidth??10,flatRisk:(p as any).flatRisk??false,premiumExtensionLimit:(p as any).premiumExtensionLimit??0,
    openingPrune:(p as any).openingPrune??'none',e348Policy:(p as any).e348Policy??'legacy',extraSequenceDrop:(p as any).extraSequenceDrop??false,
    extraGroupOmit:(p as any).extraGroupOmit??-1,
    researchPrune:(p as any).researchPrune??'none',
    contractBarrier:(p as any).contractBarrier??'none',
    weakProfitCeiling:(p as any).weakProfitCeiling??0,wideAgedCapture:(p as any).wideAgedCapture??0,
    wideStrictAbove:(p as any).wideStrictAbove??false,wideFallbackEnabled:(p as any).wideFallbackEnabled??false,wideProtectionTrigger:(p as any).wideProtectionTrigger??0,wideProtectionRetain:(p as any).wideProtectionRetain??0,normalDteMode:(p as any).normalDteMode??'all',
    originalEntryConfirmation:(p as any).originalEntryConfirmation??'none',originalNativePositiveFloor:(p as any).originalNativePositiveFloor??0,
    originalProtectionCondition:(p as any).originalProtectionCondition??'none',originalCreditRetain:(p as any).originalCreditRetain??0,
    protectionScope:(p as any).protectionScope??'all',scopedCreditRetain:(p as any).scopedCreditRetain??0,
    e307Policy:(p as any).e307Policy??'legacy',admissionReplacement:(p as any).admissionReplacement??'none',dropE354:(p as any).dropE354??false,admissionOmit:(p as any).admissionOmit??'none',admissionModel:(p as any).admissionModel??'legacy',originalReleaseStress:(p as any).originalReleaseStress??'none',originalReleaseMode:(p as any).originalReleaseMode??'none',originalReleaseAge:(p as any).originalReleaseAge??0,originalReleaseCapture:(p as any).originalReleaseCapture??0,nativePositiveFloor:(p as any).nativePositiveFloor??.05,coreRepair:(p as any).coreRepair??'none',coreDelta:(p as any).coreDelta??0,coreWidth:(p as any).coreWidth??0,
    turnGate:(p as any).turnGate??'none',restoredNativeCap:(p as any).restoredNativeCap??false,minIvRv:(p as any).minIvRv??0,minCreditFraction:(p as any).minCreditFraction??0,restoreScope:(p as any).restoreScope??'none',oldQuality:(p as any).oldQuality??'intact',restoredDte:(p as any).restoredDte??0,restoredWidth:(p as any).restoredWidth??0,restoredDelta:(p as any).restoredDelta??0,recoveredCapture:(p as any).recoveredCapture??0,weakOptimizeDelta:(p as any).weakOptimizeDelta??0,weakOptimizeWidth:(p as any).weakOptimizeWidth??0,guardRelax:(p as any).guardRelax??'none',followImpulse:(p as any).followImpulse??'none',followDefence:(p as any).followDefence??'none',followDefenceDelta:(p as any).followDefenceDelta??.8,followDefenceWidth:(p as any).followDefenceWidth??7,studyParent:(p as any).studyParent??null,studyGeometry:(p as any).studyGeometry??'none',studyExit:(p as any).studyExit??'none',restoreExtension:(p as any).restoreExtension??1.5,normalDte:(p as any).normalDte??35,restoreMode:(p as any).restoreMode??'none',latchMode:(p as any).latchMode??'none',
    extraCapture:((p as any).compactProfits||(p as any).unifyAgedProfits)?.5:.45,impulseWidth:p.base==='P9854'?8:7,impulseRetain:(p as any).creditRetain??.9,normalWidth:8,normalDelta:1.05,
    weakWidth:10,weakDelta:.8,weakCapture:.5,weakRule:'rebound-trend',mode:'adx',absoluteWidthPoints:10,
    lowerDelta:true,capture:(p as any).normalProfitCapture??.5,dte:35,focus:'all',focusDelta:.8,focusWidth:.65,deltaFactor:.8,
    widthFraction:.9,stressDelta:.8,stressWidth:.75,retain:(p as any).creditRetain??.9,action:'geometry'})));
export function createContractResearch(requestedId = 'control'): BarStrategyModule {
    const profile=(CONTRACT_GRID as any[]).find(p=>p.id===requestedId||p.selector===requestedId);
    assert(profile,'Unknown frozen contract profile');
    const researchId=profile.id;
    const retain=profile.retain;
    const index = 0;
    const spec: any = P6_LOCAL_SPECS[index];
    if (!spec)
        throw Error('Unknown frozen P6 table simplification');
    const table: ReadonlyArray<readonly [
        string,
        (r: any) => boolean
    ]> = [['LOCAL-COVER', (r: any) => spec.formula.some((i: number) => boxes[i](r))]];
    const core = { ...p6E385StandaloneV3,
        initialize(params: any) { p6E385StandaloneV3.initialize(params); return { history: [] }; },
        onFeedback(input: any) { assertFixedStrategyParams(input.params, p6E385StandaloneV3.params); return input.state; },
        onBar(input: Parameters<BarStrategyModule['onBar']>[0]) { const step = decideP6E385CurrentBar(input, (context, state) => evaluateAdmission(context, state, table,profile.admissionModel,profile.admissionOmit,profile.admissionReplacement,profile.dropE354,profile.e307Policy,profile.researchPrune,profile.extraGroupOmit,profile.openingPrune,profile.e348Policy,profile.extraSequenceDrop)); return { ...step, state: { history: (step.state as any).history.map((s: any) => ({ regime: s.regime, ...(s.slowSubregime === undefined ? {} : { slowSubregime: s.slowSubregime }) })) } }; }
    };
    const exits = withP6V3M95(core), managed = withP63922Management({ ...exits, onBar(input) { return geometry(exits.onBar(input), input.snapshot, P6_3922_POLICY); } });
    const params = freezeStrategyData({ ...managed.params, simplification: spec, protectionResearch: {parent:researchProfile('multiAxis',researchId).parent, retain, profile, quantity:1, extra:false, capitalLimits:'none', schemaVersion:profile.turnGate!=='none'?3:profile.latchMode==='none'?1:2, researchId} }), check = (p: any) => assertFixedStrategyParams(p, params);
    return { ...managed, manifest: { ...managed.manifest, id:researchId, version:researchId }, params,
        initialize(p) {check(p);const native=managed.initialize(managed.params) as any;
            if(profile.turnGate!=='none'){assert.equal(profile.latchMode,'none');return {...native,recoveryTrend:[]};}
            return profile.latchMode==='none'?native:{...native,profitExitLatches:{}};
        },
        planObservations: managed.planObservations ? input => {check(input.params);return managed.planObservations!({...input,params:managed.params});} : undefined,
        onFeedback: input => {
            check(input.params);
            if(profile.turnGate!=='none'){
                const {recoveryTrend,...nativeState}=input.state as any;
                const next=managed.onFeedback?.({...input,state:nativeState,params:managed.params})??nativeState;
                return {...next,recoveryTrend};
            }
            if(profile.latchMode==='none')return managed.onFeedback?.({...input,params:managed.params})??input.state;
            const {profitExitLatches:stored,...nativeState}=input.state as any;
            const next=managed.onFeedback?.({...input,state:nativeState,params:managed.params})??nativeState;
            const latches:Record<string,boolean>={...(stored??{})},event=input.feedback,payload=event.payload;
            if(String(payload.sourceAccount??'portfolio')==='portfolio'){
                const positionId=String(payload.positionId??'');
                if(event.kind==='close'||event.kind==='settle')delete latches[positionId];
                if(event.kind==='reject'&&payload.reason==='profit-close-limit-unmet'&&positionId
                    &&(profile.latchMode==='all'||String(payload.key??'').startsWith('capital-release:')))latches[positionId]=true;
            }
            return {...next,profitExitLatches:latches};
        },
        onBar(input) {
            check(input.params);
            const s = input.snapshot;
            const {profitExitLatches:storedLatches,recoveryTrend:storedTrend,...inheritedState}=input.state as any;
            const planned=managed.onBar({...input,state:profile.latchMode==='none'&&profile.turnGate==='none'?input.state:inheritedState,params:managed.params});
            const latches:Record<string,boolean>={...(storedLatches??{})};
            const held=new Set(s.positions.map((p:any)=>String(p.id)));
            for(const key of Object.keys(latches))if(!held.has(key))delete latches[key];
            const m=(s.market.nativeState as any)?.marketContext;
            const trend:Array<{roc5:number;roc20:number;close:number}>=storedTrend??[];
            if(profile.turnGate!=='none')assert(Array.isArray(trend)&&trend.length<=3&&trend.every(p=>[p.roc5,p.roc20,p.close].every(Number.isFinite)&&p.close>0),'Invalid bounded recovery trend');
            const close=Number((s.market.qqq as any)?.close),previous=trend.at(-1),beforePrevious=trend.at(-2);
            const observed=Number.isFinite(m?.roc5)&&Number.isFinite(m?.roc20)&&Number.isFinite(close)&&close>0;
            const improving=!!(observed&&previous&&close>previous.close&&m.roc5>=previous.roc5&&m.roc20>=previous.roc20);
            const twice=!!(improving&&beforePrevious&&previous!.close>beforePrevious.close&&previous!.roc5>=beforePrevious.roc5&&previous!.roc20>=beforePrevious.roc20);
            const turnAllowed=profile.turnGate==='none'||(profile.turnGate==='one-step'?improving:twice);
            const nextTrend=observed?[...trend.slice(-2),{roc5:Number(m.roc5),roc20:Number(m.roc20),close}]:[];
            const stress=planned.intents.some((o:any)=>o.kind==='open-spread')&&weakTwentyDay(m);
            const impulse=m?.roc20>=0&&m?.roc5>=.03&&m?.adx14>=25;
            let geometryProfile=impulse&&profile.entryAction==='geometry'?{...profile,absoluteWidthPoints:profile.impulseWidth,deltaFactor:profile.impulseDelta}:stress?{...profile,absoluteWidthPoints:profile.weakWidth,deltaFactor:profile.weakDelta}:{...profile,absoluteWidthPoints:profile.normalWidth,deltaFactor:profile.normalDelta};
            if(profile.normalRiskScope==='low-vix'&&planned.intents.some((o:any)=>o.kind==='open-spread'))assert(Number.isFinite(m?.vix),'Missing entry VIX');
            const lowerNormal=!stress&&(profile.normalRiskScope==='all'||(profile.normalRiskScope==='low-vix'&&m?.vix<15));
            if(lowerNormal)geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,profile.normalRiskDelta),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,profile.normalRiskWidth)};
            if(profile.flatRisk&&m?.roc20>=0&&m?.roc20<.02&&m?.adx14<20)geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,.8),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,7)};
            const premium=m?.roc20>=0&&m?.roc5>=0&&((profile.premiumMode==='high-vol'&&m?.vix>=20)
                ||(profile.premiumMode==='healthy'&&m?.vix>=15&&m?.roc20>=.02&&m?.adx14<20))
                &&(!(profile.premiumExtensionLimit>0)||m?.priceExtensionAtr<profile.premiumExtensionLimit);
            if(premium)geometryProfile={...geometryProfile,absoluteWidthPoints:profile.premiumWidth,deltaFactor:profile.premiumDelta};
            if(m?.roc20>=0&&profile.studyGeometry==='normal09')geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,.9),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,8)};
            if(m?.roc20>=0&&profile.studyGeometry==='normal08')geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,.8),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,7)};
            if(m?.roc20<0&&profile.studyGeometry==='weak065')geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,.65),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,8)};
            if(impulse&&profile.studyGeometry==='impulse075')geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,.75),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,6)};
            if(impulse&&profile.followImpulse==='width7')geometryProfile={...geometryProfile,deltaFactor:.75,absoluteWidthPoints:7};
            if(impulse&&profile.followImpulse==='delta08')geometryProfile={...geometryProfile,deltaFactor:.8,absoluteWidthPoints:6};
            const otherNormal=m?.roc20>=0&&m?.roc5>=0&&!impulse&&!(m?.roc20<.02&&m?.adx14<20);
            const defendLowVix=m?.roc20>=0&&m?.vix<15&&(profile.followDefence==='nonweak'||(profile.followDefence==='other-normal'&&otherNormal));
            if(defendLowVix)geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,profile.followDefenceDelta),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,profile.followDefenceWidth)};
            if(m?.roc20<0&&profile.weakOptimizeWidth>0)geometryProfile={...geometryProfile,absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,profile.weakOptimizeWidth)};
            if(m?.roc20<0&&profile.weakOptimizeDelta>0)geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,profile.weakOptimizeDelta)};
            if(m?.roc20>=0){
                const custom=profile.normalDteMode==='all'||(profile.normalDteMode==='low-vix'&&m.vix<15)||(profile.normalDteMode==='high-vix'&&m.vix>=20);
                geometryProfile={...geometryProfile,dte:custom?profile.normalDte:35};
            }
            const repairOriginal=!p10954MarketBlocked(m)&&Number.isFinite(m?.roc20)&&m.roc20>=0
                &&(profile.coreRepair==='all-nonweak'||(profile.coreRepair==='low-vix-nonweak'&&Number.isFinite(m?.vix)&&m.vix<15)
                    ||(profile.coreRepair==='saturated-low'&&m.vix<15&&m.roc5>=0&&m.roc20>=.05&&m.adx14>=35&&m.priceExtensionAtr>=2)
                    ||(profile.coreRepair==='extended-low'&&m.vix<15&&m.roc5>=0&&m.adx14>=25&&m.priceExtensionAtr>=1.5));
            if(repairOriginal)geometryProfile={...geometryProfile,deltaFactor:Math.min(geometryProfile.deltaFactor,profile.coreDelta),absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,profile.coreWidth)};
            if(profile.restoredDte>0&&p10954MarketBlocked(m)&&recoveryScopeAllowed(profile.restoreScope,m,turnAllowed)){
                geometryProfile={...geometryProfile,dte:profile.restoredDte,absoluteWidthPoints:Math.min(geometryProfile.absoluteWidthPoints,profile.restoredWidth),deltaFactor:Math.min(geometryProfile.deltaFactor,profile.restoredDelta)};
            }
            const step = geometry(planned, s, geometryProfile);
            let changed=0,suppressed=0,restored=0,retries=0,barrierIntents=0;
            // Observation only: disjoint first-block reasons; never changes intents/state.
            const openingStages={plannedBase:planned.intents.filter((o:any)=>o.kind==='open-spread'&&o.risk.researchSleeve!=='extra').length,
                geometryBase:step.intents.filter((o:any)=>o.kind==='open-spread'&&o.risk.researchSleeve!=='extra').length,
                extraSuppressed:0,scopeRejected:0,qualityRejected:0,confirmationRejected:0,wideRetightened:0,quoteEdgeRejected:0,stress:0,heat:0,weakening:0,early:0,weakRebound:0,impulse:0,finalBase:0};
            let intents = step.intents.flatMap((o: any) => {
                if (o.kind !== 'open-spread') return [o];
                if (o.risk.researchSleeve === 'extra') { suppressed++; openingStages.extraSuppressed++; return []; }
                if(stress&&profile.action==='block'){openingStages.stress++;return [];}
                // Folded P9764 parent guard: preserve its two effective rules exactly.
                const context=(s.market.nativeState as any)?.marketContext;
                assert(context&&typeof context.regime==='string','Missing causal native state');
                assert(Number.isFinite(context.priceExtensionAtr)&&Number.isFinite(context.adx14),'Missing parent heat inputs');
                const originallyRejected=p10954MarketBlocked(context);
                if(originallyRejected&&!recoveryScopeAllowed(profile.restoreScope,context,turnAllowed)){openingStages.scopeRejected++;return [];}
                const flatLow=context.vix<15&&context.roc20>=0&&context.roc20<.02&&context.roc5>=0&&context.adx14<20;
                const weakLow=context.vix<15&&context.roc20<0;
                const saturatedLow=context.vix<15&&context.roc5>=0&&context.roc20>=.05&&context.adx14>=35&&context.priceExtensionAtr>=2;
                const skipOriginal=!originallyRejected&&((['flat-low','both-low','both-low-saturated'].includes(profile.oldQuality)&&flatLow)||(['weak-low','both-low','both-low-saturated'].includes(profile.oldQuality)&&weakLow)||(['saturated-low','both-low-saturated'].includes(profile.oldQuality)&&saturatedLow));
                if(skipOriginal){openingStages.qualityRejected++;return [];}
                const relaxWeakening=['weakening','all'].includes(profile.guardRelax)||(profile.guardRelax==='mild-weakening'&&context.roc5>=-.01&&context.roc20>=-.02&&context.adx14<20)||(['selected-weak','selected-both'].includes(profile.guardRelax)&&context.roc5>=-.02&&context.roc20>=-.05&&context.adx14<20);
                const heatBlocked=context.priceExtensionAtr>=2&&context.adx14<20&&!['heat','all'].includes(profile.guardRelax);
                let blocked=heatBlocked;
                if(context.regime==='RISK_ON_WEAKENING'){
                    assert(Number.isFinite(context.roc5)&&Number.isFinite(context.roc20),'Missing parent momentum inputs');
                    blocked=blocked||(context.roc5<0&&context.roc20<0&&!relaxWeakening);
                }
                assert(Number.isFinite(context.roc5)&&Number.isFinite(context.roc20),'Missing causal admission momentum');
                const early=context.roc5<0&&context.roc20>=0;
                const severe=profile.mode==='all'||(profile.mode==='drop1'&&context.roc5<-.01)
                    ||(profile.mode==='drop2'&&context.roc5<-.02)||(profile.mode==='adx'&&context.adx14<20)
                    ||(profile.mode==='extension'&&context.priceExtensionAtr>=1);
                const allowEarly=(['mild-early','both'].includes(profile.restoreMode)&&early&&context.roc5>=-.005&&context.roc20>=.02&&context.adx14<20&&context.priceExtensionAtr<profile.restoreExtension)||(['selected-early','selected-both'].includes(profile.guardRelax)&&early&&context.roc5>=-.01&&context.roc20>=.02&&context.adx14>=15&&context.adx14<20&&context.priceExtensionAtr<1.5);
                const earlyBlocked=early&&severe&&!allowEarly&&!['early','all'].includes(profile.guardRelax);
                blocked=blocked||earlyBlocked;
                const negative=context.roc20<0,falling=context.roc5<0,rebound=context.roc5>=0;
                const weakBlocked=negative&&((profile.weakRule==='falling'&&falling)
                    ||(profile.weakRule==='trend'&&falling&&context.adx14>=25)
                    ||(profile.weakRule==='rebound-mild'&&rebound&&context.roc5<.01)
                    ||(profile.weakRule==='rebound-trend'&&rebound&&context.adx14>=25));
                const allowRebound=(['mild-rebound','both'].includes(profile.restoreMode)&&negative&&rebound&&context.roc20>=-.02&&context.roc5>=.01&&context.adx14>=25&&context.priceExtensionAtr<profile.restoreExtension)||(profile.guardRelax==='mild-rebound'&&negative&&context.roc20>=-.02&&context.roc5>=.005&&context.adx14>=25&&context.priceExtensionAtr<1)||(profile.guardRelax==='selected-rebound'&&negative&&context.roc20>=-.05&&context.roc5>=.01&&context.adx14>=25&&context.priceExtensionAtr<1.5);
                const reboundBlocked=weakBlocked&&!allowRebound&&!['rebound','all'].includes(profile.guardRelax);
                if(blocked||reboundBlocked||(impulse&&profile.entryAction==='reject')){
                    if(heatBlocked)openingStages.heat++;
                    else if(context.regime==='RISK_ON_WEAKENING'&&context.roc5<0&&context.roc20<0&&!relaxWeakening)openingStages.weakening++;
                    else if(earlyBlocked)openingStages.early++;
                    else if(reboundBlocked)openingStages.weakRebound++;
                    else openingStages.impulse++;
                    return [];
                }
                openingStages.finalBase++;
                if((early&&severe&&allowEarly)||(weakBlocked&&allowRebound))restored++;
                // Tag only actually recovered entries, using current market predicates.
                // The marker follows the real order/position ID; no date ledger or new quantity.
                const baselineRebound=negative&&rebound&&context.roc20>=-.02&&context.roc5>=.01&&context.adx14>=25&&context.priceExtensionAtr<1.5;
                const baselineRejected=(context.priceExtensionAtr>=2&&context.adx14<20)
                    ||(context.regime==='RISK_ON_WEAKENING'&&context.roc5<0&&context.roc20<0)
                    ||(early&&severe)||(weakBlocked&&!baselineRebound);
                const recoveredKey=profile.recoveredCapture>0&&baselineRejected?o.key+':recovered-entry':o.key;
                if(profile.originalEntryConfirmation!=='none'&&!String(recoveredKey).endsWith(':recovered-entry')){
                    assert(profile.turnGate==='one-step','Confirmation requires existing bounded causal trend');
                    const needs=profile.originalEntryConfirmation==='all'||(profile.originalEntryConfirmation==='falling5'&&context.roc5<0)||(profile.originalEntryConfirmation==='weak20'&&context.roc20<0);
                    if(needs&&!improving){openingStages.confirmationRejected++;openingStages.finalBase--;return [];}
                }
                const unit = {...o,key:recoveredKey, contract:{...o.contract,multiplier:1}, risk:{...o.risk,quantity:1,multiplier:1,researchCombinedQuantity:1}};
                const chain = s.market.chain as any;
                const expiry = chain.expirations.find((e:any)=>e.date===o.contract.expiry);
                const short = expiry?.puts.find((q:any)=>q.strike===o.contract.shortStrike);
                const oldLong = expiry?.puts.find((q:any)=>q.strike===o.contract.longStrike);
                if (!short || !oldLong) return [unit];
                const stamp = Date.parse(chain.timestamp)/1000;
                const fee = Number((s.market.executionCapabilities as any).commissionPerContract);
                const sq = resolveOptionQuote(short,.5,stamp), lq = resolveOptionQuote(oldLong,2,stamp);
                if(sq?.source!=='market'||lq?.source!=='market') return [unit];
                const credit = 100*(sq.sell-lq.buy)-2*fee;
                if (!(credit>0)) return [unit];
                const longs = expiry.puts.filter((q:any)=>q.strike>Number(o.contract.longStrike)&&q.strike<Number(o.contract.shortStrike)&&q.openInterest>0&&q.volume>=0).sort((a:any,b:any)=>b.strike-a.strike);
                for(const long of longs){
                    const q=resolveOptionQuote(long,2,stamp);
                    if(q?.source!=='market') continue;
                    const next=100*(sq.sell-q.buy)-2*fee, width=Number(o.contract.shortStrike)-long.strike;
                    const scoped=profile.scopedCreditRetain>0&&((profile.protectionScope==='recovery')===String(unit.key).endsWith(':recovered-entry'));
                    const originalNarrow=profile.originalCreditRetain>0&&!String(unit.key).endsWith(':recovered-entry')
                        &&((profile.originalProtectionCondition==='falling5'&&context.roc5<0)||(profile.originalProtectionCondition==='weak20'&&context.roc20<0));
                    const requiredRetain=originalNarrow?profile.originalCreditRetain:scoped?profile.scopedCreditRetain:impulse&&profile.entryAction==='geometry'?profile.impulseRetain:retain;
                    if(!(next>=requiredRetain*credit-1e-8&&next>0&&width*100>next)) continue;
                    changed++;
                    if(profile.wideProtectionTrigger>0&&!String(unit.key).endsWith(':recovered-entry')&&(profile.wideStrictAbove?width>profile.normalWidth:width>=profile.wideProtectionTrigger)){
                        for(const tighter of longs){
                            if(!(tighter.strike>long.strike))continue;
                            const tq=resolveOptionQuote(tighter,2,stamp);if(tq?.source!=='market')continue;
                            const tightCredit=100*(sq.sell-tq.buy)-2*fee,tightWidth=Number(o.contract.shortStrike)-tighter.strike;
                            if(!(tightCredit>0&&tightCredit>=profile.wideProtectionRetain*credit-1e-8&&100*tightWidth>tightCredit))continue;
                            openingStages.wideRetightened++;
                            return [{...unit,contract:{...unit.contract,longStrike:tighter.strike},risk:{...unit.risk,longProtectionFallback:{maximumWidth:tightWidth}}}];
                        }
                    }
                    return [{...unit,contract:{...unit.contract,longStrike:long.strike},risk:{...unit.risk,longProtectionFallback:{maximumWidth:width}}}];
                }
                if(profile.wideFallbackEnabled&&!String(unit.key).endsWith(':recovered-entry')&&(profile.wideStrictAbove?Number(o.contract.shortStrike)-Number(o.contract.longStrike)>profile.normalWidth:Number(o.contract.shortStrike)-Number(o.contract.longStrike)>=profile.wideProtectionTrigger)){
                    for(const tighter of longs){
                        const tq=resolveOptionQuote(tighter,2,stamp);if(tq?.source!=='market')continue;
                        const tightCredit=100*(sq.sell-tq.buy)-2*fee,tightWidth=Number(o.contract.shortStrike)-tighter.strike;
                        if(!(tightCredit>0&&tightCredit>=profile.wideProtectionRetain*credit-1e-8&&100*tightWidth>tightCredit))continue;
                        changed++;openingStages.wideRetightened++;
                        return [{...unit,contract:{...unit.contract,longStrike:tighter.strike},risk:{...unit.risk,longProtectionFallback:{maximumWidth:tightWidth}}}];
                    }
                }
                return [unit];
            });
            if(profile.minIvRv>0||profile.minCreditFraction>0){
                const rv=Number((s.market.pcsAnalytics as any)?.annualizedQqqRv20),chain=s.market.chain as any,stamp=Date.parse(chain.timestamp)/1000;
                intents=intents.filter((o:any)=>{
                    if(o.kind!=='open-spread'||!String(o.key).endsWith(':recovered-entry'))return true;
                    const expiry=chain.expirations.find((e:any)=>e.date===o.contract.expiry),short=expiry?.puts.find((q:any)=>q.strike===o.contract.shortStrike),long=expiry?.puts.find((q:any)=>q.strike===o.contract.longStrike);
                    const sq=short&&resolveOptionQuote(short,.5,stamp),lq=long&&resolveOptionQuote(long,2,stamp),width=Number(o.contract.shortStrike)-Number(o.contract.longStrike),iv=Number(short?.iv);
                    const credit=sq?.source==='market'&&lq?.source==='market'?100*(sq.sell-lq.buy)-2*Number((s.market.executionCapabilities as any).commissionPerContract):NaN;
                    const pass=Number.isFinite(rv)&&rv>0&&Number.isFinite(iv)&&iv/rv>=profile.minIvRv&&Number.isFinite(credit)&&credit/(100*width)>=profile.minCreditFraction;
                    if(!pass){openingStages.quoteEdgeRejected++;openingStages.finalBase--;}
                    return pass;
                });
            }
            const context=(s.market.nativeState as any)?.marketContext;
            if(s.positions.length)assert(Number.isFinite(context?.roc5)&&Number.isFinite(context?.roc20),'Missing causal release momentum');
            const strong=context?.roc5>=0&&context?.roc20>=0;
            if(profile.relaxNativeFill||profile.restoredNativeCap||profile.originalNativePositiveFloor>0)for(let i=0;i<intents.length;i++){
                const intent=intents[i];
                if(intent.kind==='close-position'&&intent.reason!=='capital-positive-release'&&typeof intent.minimumUnweightedPnl==='number'&&intent.minimumUnweightedPnl>0&&(profile.relaxNativeFill||(profile.restoredNativeCap&&String(intent.positionId).endsWith(':recovered-entry'))||(profile.originalNativePositiveFloor>0&&!String(intent.positionId).endsWith(':recovered-entry')))){
                    const p=s.positions.find((p:any)=>String(p.id)===String(intent.positionId));
                    const fraction=profile.relaxNativeFill?profile.nativePositiveFloor:profile.originalNativePositiveFloor>0&&!String(intent.positionId).endsWith(':recovered-entry')?profile.originalNativePositiveFloor:profile.recoveredCapture;assert(fraction>0);
                    if(p&&Number(p.creditReceived)>0)intents[i]={...intent,minimumUnweightedPnl:Math.min(intent.minimumUnweightedPnl,fraction*Number(p.creditReceived))};
                }
            }
            const regularCapture=context?.roc20<0?profile.weakCapture:strong?profile.strongCapture:profile.capture;
            if(regularCapture>0&&s.market.sampleTerminal!==true){
                const already=new Set(intents.filter((o:any)=>o.kind==='close-position').map((o:any)=>String(o.positionId)));
                for(const p of s.positions){
                    const age=(Date.parse(s.asOf)-Date.parse(String(p.openDate)))/86400000;
                    assert(Number.isFinite(age)&&age>=0,'Missing actual open date');
                    const deteriorating=(profile.extraMode==='weak20'&&context.roc20<0)||(profile.extraMode==='falling5'&&context.roc5<0);
                    const agedCapture=deteriorating?profile.extraCapture:profile.agedCapture;
                    const ordinaryCapture=profile.ageDays>0&&age>=profile.ageDays?agedCapture:regularCapture;
                    if(profile.opportunityMode==='calm35')assert(Number.isFinite(context.adx14),'Missing causal ADX');
                    const opportunity=profile.opportunityMode==='all25'||(profile.opportunityMode==='strong25'&&strong)
                        ||(profile.opportunityMode==='calm35'&&strong&&context.adx14<20);
                    let capture=opportunity?Math.min(profile.opportunityCapture,ordinaryCapture):ordinaryCapture;
                    if(profile.studyExit==='aged21-45'&&age>=21)capture=Math.min(capture,.45);
                    if(profile.studyExit==='calm35'&&strong&&context.adx14<20)capture=Math.min(capture,.35);
                    if(profile.studyExit==='falling21-35'&&age>=21&&context.roc5<0)capture=Math.min(capture,.35);
                    const originalRelease=profile.originalReleaseMode!=='none'&&!String(p.id).endsWith(':recovered-entry')&&age>=profile.originalReleaseAge
                        &&(profile.originalReleaseMode==='falling5'?context.roc5<0:!!(observed&&previous&&close<previous.close&&context.roc5<previous.roc5));
                    const releaseStress=profile.originalReleaseStress==='none'||(profile.originalReleaseStress==='vix20'&&Number.isFinite(context.vix)&&context.vix>=20)
                        ||(profile.originalReleaseStress==='backwardation'&&Number.isFinite(context.vixTermStructureSlope)&&context.vixTermStructureSlope<0);
                    if(originalRelease&&releaseStress)capture=Math.min(capture,profile.originalReleaseCapture);
                    if(profile.weakProfitCeiling>0&&context.roc20<0)capture=Math.min(capture,profile.weakProfitCeiling);
                    if(profile.wideAgedCapture>0&&!String(p.id).endsWith(':recovered-entry')&&age>=profile.originalReleaseAge&&Number((p as any).shortStrike)-Number((p as any).longStrike)>profile.normalWidth)capture=Math.min(capture,profile.wideAgedCapture);
                    if(profile.recoveredCapture>0&&String(p.id).endsWith(':recovered-entry'))capture=Math.min(capture,profile.recoveredCapture);
                    const executionCapture=profile.relaxFill?Math.min(.05,capture):capture;
                    const credit=Number(p.creditReceived),mark=Number(p.markPnl);
                    if(credit>0&&Number.isFinite(mark)&&mark>=credit*capture&&!already.has(String(p.id))){
                        intents.push({kind:'close-position',key:`capital-release:${p.id}:${s.asOf}`,
                            positionId:String(p.id),reason:'capital-positive-release',minimumUnweightedPnl:credit*executionCapture});
                    }
                }
            }
            if(profile.latchMode!=='none'&&s.market.sampleTerminal!==true){
                for(let i=0;i<intents.length;i++){
                    const o=intents[i];
                    if(o.kind==='close-position'&&latches[String(o.positionId)]&&typeof o.minimumUnweightedPnl==='number'&&o.minimumUnweightedPnl>0){
                        const p=s.positions.find((p:any)=>String(p.id)===String(o.positionId));
                        if(p&&Number(p.creditReceived)>0)intents[i]={...o,minimumUnweightedPnl:Math.min(o.minimumUnweightedPnl,.05*Number(p.creditReceived))};
                    }
                }
                const closing=new Set(intents.filter((o:any)=>o.kind==='close-position').map((o:any)=>String(o.positionId)));
                for(const p of s.positions){
                    const credit=Number(p.creditReceived),mark=Number(p.markPnl),key=String(p.id);
                    if(latches[key]&&!closing.has(key)&&credit>0&&Number.isFinite(mark)&&mark>=.05*credit){
                        intents.push({kind:'close-position',key:`profit-retry:${key}:${s.asOf}`,positionId:key,reason:'profit-latched-release',minimumUnweightedPnl:.05*credit});retries++;
                    }
                }
            }
            if(profile.contractBarrier!=='none'&&s.market.sampleTerminal!==true&&observed&&previous){
                assert(profile.turnGate==='one-step','Barrier requires the existing bounded observed trend');
                for(const p of s.positions){
                    if(String(p.id).endsWith(':recovered-entry')||!(Date.parse(String(p.openDate))<Date.parse(s.asOf))||!(Number(p.markPnl)<0))continue;
                    const barrier=Number(profile.contractBarrier==='short'?(p as any).shortStrike:(p as any).longStrike);
                    if(!(Number.isFinite(barrier)&&close<barrier&&previous.close<barrier))continue;
                    const unconditional=intents.some((o:any)=>o.kind==='close-position'&&String(o.positionId)===String(p.id)&&(typeof o.minimumUnweightedPnl!=='number'||o.minimumUnweightedPnl<=0));
                    if(unconditional)continue;
                    // Preserve existing native/profit intent priority; this market exit is a fallback.
                    intents.push({kind:'close-position',key:`contract-barrier:${p.id}:${s.asOf}`,positionId:String(p.id),reason:'contract-barrier-release'});barrierIntents++;
                }
            }
            const quoteDrops=planned.intents.filter((o:any)=>o.kind==='open-spread'&&o.risk.researchSleeve!=='extra').length-step.intents.filter((o:any)=>o.kind==='open-spread'&&o.risk.researchSleeve!=='extra').length;
            const nativeNext=profile.latchMode==='none'?step.state:{...step.state,profitExitLatches:latches};
            return {...step,intents,state:profile.turnGate==='none'?nativeNext:{...nativeNext,recoveryTrend:nextTrend},
                plots:{...step.plots,protectionResearch:{changed,suppressed},multiAxisAudit:{restored,retries,quoteDrops,barrierIntents,openingStages,activeLatches:Object.keys(latches).length}}};
        } };
}
export default createContractResearch('P9854');
