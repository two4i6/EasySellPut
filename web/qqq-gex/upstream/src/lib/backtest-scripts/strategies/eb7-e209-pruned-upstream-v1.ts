/** Effective E76/E44 upstream on one observation, retaining selected-source identity. */
import { buildQqqEb2E44CurrentBarLayers } from '../../engines/analysis/QqqEb2E44Fused';
import { buildQqqEb3CurrentBarRules } from '../../engines/analysis/QqqEb3E12';
import { e209E45CurrentBarVeto, type E209E0Arm, type E209Proposal } from './eb7-e209-pruned-merge-v1';

const e44 = buildQqqEb2E44CurrentBarLayers().filter(rule => !['E3', 'E4', 'E5', 'E31', 'E34'].includes(rule.name));
const e3 = buildQqqEb3CurrentBarRules('rule2-tqqqroc05-slow-confidence');
const n = (p: E209Proposal, key: string) => Number(p.context[key]);
const quality = (p: E209Proposal | null) => p && !(p.context.slowSubregimeHealth === 'STALE_OR_MISSING'
  && n(p, 'tqqqRealisedVol20d') >= .6) ? p : null;
const releaseRaw = (p: E209Proposal | null) => p && e3.some(rule => rule.predicate(p.context)) ? p : null;
function releaseC4(p: E209Proposal | null) {
  if (!p) return null;
  const width = Number(p.contract.shortStrike) - Number(p.contract.longStrike);
  if (!Number.isFinite(width) || width <= 0) throw new Error('Current selected C4 contract strikes required');
  return e44.some(rule => rule.predicate({ marketContext: p.context, width })) ? p : null;
}

/**
 * Caller generates raw/E1/C4 proposals causally and advances their own books.
 * c4Parent already applies its current-bar screen/re-admission. No source P&L,
 * future fills, completed trades or date collections are accepted here.
 */
export function deriveE209E0CurrentBarArm(input: {
  rawE1: E209Proposal | null; e1: E209Proposal | null;
  rawC4: E209Proposal | null; c4Parent: E209Proposal | null;
}): E209E0Arm {
  const { rawE1, e1, rawC4, c4Parent: c4 } = input;
  const originalEb3 = e1 ?? releaseC4(c4) ?? releaseRaw(rawE1);
  const originalGated = quality(originalEb3);
  const replacement = !originalGated && rawE1 && n(rawE1, 'tqqqRealisedVol20d') >= .6
    && n(rawE1, 'tqqqRealisedVol20d') < .7 && rawE1.context.trend === 'BEAR' ? rawE1 : null;
  const beforeVeto = originalGated ?? replacement;
  const researchVetoed = beforeVeto && e209E45CurrentBarVeto(beforeVeto) ? beforeVeto : null;
  const originalFinal = researchVetoed ? null : beforeVeto;
  const blocked = rawC4 && !c4 && !originalFinal ? rawC4 : null;
  const adxRelease = blocked && n(blocked, 'adx14') >= 20 && n(blocked, 'adx14') < 32
    && n(blocked, 'tqqqRealisedVol20d') >= 0 && n(blocked, 'tqqqRealisedVol20d') < .3
    && n(blocked, 'weakeningSignalCount') >= 1 ? blocked : null;
  const gated = quality(e1 ?? releaseC4(c4 ?? adxRelease) ?? releaseRaw(rawE1));
  return { rawE1, e1, c4, blocked, gated,
    qualityExcluded: originalEb3 && !originalFinal ? originalEb3 : null, researchVetoed };
}
