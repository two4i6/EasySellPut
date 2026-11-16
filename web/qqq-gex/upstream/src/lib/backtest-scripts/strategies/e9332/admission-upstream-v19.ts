import{evaluateLogic}from'./boolean-runtime-v14';
import type{CompiledAdmission}from'./admission-policy-v19';
/** Effective E76/E44 upstream on one observation, retaining selected-source identity. */
import { buildQqqEb2E44CurrentBarLayers } from '../../../engines/analysis/QqqEb2E44Fused';
import { buildQqqEb3CurrentBarRules } from '../../../engines/analysis/QqqEb3E12';
import { type E209E0Arm, type E209Proposal } from './admission-merge-v19';

const e44 = buildQqqEb2E44CurrentBarLayers().filter(rule => !['E3', 'E4', 'E5', 'E31', 'E34'].includes(rule.name));
const e3 = buildQqqEb3CurrentBarRules('rule2-tqqqroc05-slow-confidence');
const n = (p: E209Proposal, key: string) => Number(p.context[key]);
const quality=(p:E209Proposal|null,enabled:boolean,compiled:CompiledAdmission)=>p&&(!enabled||evaluateLogic(compiled.logic,'upstream.quality',p.context))?p:null;
const releaseRaw=(p:E209Proposal|null,enabled:boolean,compiled:CompiledAdmission)=>enabled&&p&&e3.some((_,i)=>evaluateLogic(compiled.logic,'upstream.raw.'+String(i).padStart(2,'0'),p.context))?p:null;
function releaseC4(p:E209Proposal|null,enabled:boolean,compiled:CompiledAdmission){
 if(!enabled||!p)return null;const width=Number(p.contract.shortStrike)-Number(p.contract.longStrike);if(!Number.isFinite(width)||width<=0)throw Error('Current selected C4 contract strikes required');
 return e44.some((_,i)=>evaluateLogic(compiled.logic,'upstream.c4.'+String(i).padStart(2,'0'),p.context,{width,vxn:NaN,vixLower:NaN}))?p:null;
}

/**
 * Caller generates raw/E1/C4 proposals causally and advances their own books.
 * c4Parent already applies its current-bar screen/re-admission. No source P&L,
 * future fills, completed trades or date collections are accepted here.
 */
export function deriveE209E0CurrentBarArm(input: {
  rawE1: E209Proposal | null; e1: E209Proposal | null;
  rawC4: E209Proposal | null; c4Parent: E209Proposal | null;
},compiled:CompiledAdmission): E209E0Arm {
  const { rawE1, e1, rawC4, c4Parent: c4 } = input;
  const originalEb3 = e1 ?? releaseC4(c4,compiled.policy.upstreamC4Release,compiled) ?? releaseRaw(rawE1,compiled.policy.upstreamRawRelease,compiled);
  const originalGated = quality(originalEb3,compiled.policy.upstreamQuality,compiled);
  // whole7229 fixes upstreamReplacement/upstreamVeto=false; mergeVeto and quality remain enabled.
  const originalFinal=originalGated;
  const researchVetoed=null;
  const blocked = rawC4 && !c4 && !originalFinal ? rawC4 : null;
  const adxRelease=compiled.policy.upstreamAdxRelease&&blocked&&evaluateLogic(compiled.logic,'upstream.adxRelease',blocked.context)?blocked:null;
  const gated = quality(e1 ?? releaseC4(c4 ?? adxRelease,compiled.policy.upstreamC4Release,compiled) ?? releaseRaw(rawE1,compiled.policy.upstreamRawRelease,compiled),compiled.policy.upstreamQuality,compiled);
  return { rawE1, e1, c4, blocked, gated,
    qualityExcluded: originalEb3 && !originalFinal ? originalEb3 : null, researchVetoed };
}
