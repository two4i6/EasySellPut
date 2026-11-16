/** Single-bar source graph. Inputs are current proposals, never replay cycles or future fills. */
import { matchesQqqC4CurrentBarReAdmission } from '../../engines/analysis/QqqC4CurrentBarRules';
import { deriveE209E0CurrentBarArm } from './eb7-e209-e0-upstream-v2';
import { mergeE209E0CurrentBar, type E209Proposal } from './eb7-e209-e0-merge-v2';
import { decideE209Rolling, type E209RollingState } from './eb7-e209-rolling-rules-v2';
import { evaluateE209E1Screen, evaluateE209C4WithScreen } from './eb7-e209-sources-v2';
import { evaluateE209ResidualStage } from './eb7-e209-residual-v2';

type Proposal = E209Proposal | null;
export type E209CurrentSourceArm = { rawE1: Proposal; e1: Proposal; rawC4: Proposal };
export type E209CurrentSourceGraphInput = {
  asOf: string; vxn: number; rollingState: E209RollingState; actualRollingBaseOverlap: number;
  rolling: Proposal;
  // These can have DIFFERENT initialization windows and native stock NAVs.
  e1Screen: Proposal; c4Screen: Proposal;
  high: E209CurrentSourceArm; low: E209CurrentSourceArm;
};
function observation(proposal: Proposal) {
  if (!proposal) return { available: false, context: {}, width: 0 };
  const width = Number(proposal.contract.shortStrike) - Number(proposal.contract.longStrike);
  if (!Number.isFinite(width) || width <= 0) throw new Error('Current source contract strikes required');
  return { available: true, context: proposal.context, width };
}

/** Flat effective E1 -> C4/E76 -> E235 -> E2-E8 graph; no retrospective recovery. */
export function decideE209CurrentSourceGraph(input: E209CurrentSourceGraphInput) {
  const rolling = decideE209Rolling(input.rollingState, input.asOf, observation(input.rolling), input.actualRollingBaseOverlap);
  const rollingObservation = { ...observation(input.rolling), admitted: rolling.admitted };
  const e1Screen = evaluateE209E1Screen(observation(input.e1Screen), rollingObservation);
  const c4Screen = evaluateE209E1Screen(observation(input.c4Screen), rollingObservation);
  function arm(current: E209CurrentSourceArm) {
    const c4Decision = evaluateE209C4WithScreen(observation(current.rawC4), c4Screen);
    const readmitted = current.rawC4 && matchesQqqC4CurrentBarReAdmission(current.rawC4.context,
      'e56-plus-adx-lowvol-weakening');
    const c4 = current.rawC4 && (c4Decision.admitted || readmitted) ? current.rawC4 : null;
    return { effective: deriveE209E0CurrentBarArm({ ...current, e1: e1Screen.admitted ? current.e1 : null, c4Parent: c4 }),
      c4Reason: c4Decision.admitted ? c4Decision.reason : readmitted ? 'E56-readmission' : c4Decision.reason };
  }
  const high = arm(input.high), low = arm(input.low);
  const e0 = mergeE209E0CurrentBar({ high: high.effective, low: low.effective, vxn: input.vxn });
  const candidate = e0.proposal ?? e0.residual;
  const final = evaluateE209ResidualStage({ context: candidate?.context ?? {},
    e0Admitted: !!e0.proposal, residualEligible: !!e0.residual });
  // The raw C4 book ALWAYS executes its raw admission; parent membership is only
  // a current selection condition. The gated E1 book executes only screen passes.
  const sourceAdmissions = [
    rolling.baseAdmitted ? input.rolling : null,
    input.e1Screen, input.c4Screen,
    input.high.rawE1, e1Screen.admitted ? input.high.e1 : null, input.high.rawC4,
    input.low.rawE1, e1Screen.admitted ? input.low.e1 : null, input.low.rawC4,
  ].filter((proposal): proposal is E209Proposal => proposal !== null);
  if (new Set(sourceAdmissions.map(proposal => proposal.source)).size !== sourceAdmissions.length) {
    throw new Error('Source graph requires distinct execution books');
  }
  return { rollingState: rolling.state, sourceAdmissions, proposal: final.admitted ? candidate : null,candidateSource:candidate?.source??null,
    audit: { rolling: rolling.reason, e1Screen: e1Screen.reason, c4Screen: c4Screen.reason,
      highC4: high.c4Reason, lowC4: low.c4Reason, e0: e0.reason, final: final.reason },
    arms: { high: high.effective, low: low.effective } };
}
