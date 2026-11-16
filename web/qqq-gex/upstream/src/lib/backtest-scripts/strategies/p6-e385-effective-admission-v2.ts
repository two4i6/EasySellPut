/** Pure effective P6.E385 evaluator. The reachable admission helpers retain exact
 * historical operand/default/memo ordering. Settlement and diagnostic history
 * belong to the caller and are not dependencies of this leaf. Deep boolean
 * consolidation is deferred: every historical admission declaration is reachable. */
import type {PcsDynamicEntryContext} from '../../engines/leveraged-overlay/types/input';
import { p6ContextRow, p6CurrentBlock, p6PriceSmaBlock, p6CurrentArm, p6P1Block,
  p6CandidateA, p6Rules, p6FinalReject, p6ResearchReject, p6ExtraAdmission,
  p6E307, p6E348, p6E354, p6ProtectionBypass, p6RejectQualityGuard } from './p6-e385-admission-v1';


/** Exact E385 effective profile, independent of historical builder closures. */
export function evaluateP6E385Admission(context: PcsDynamicEntryContext, state: Readonly<{lastSettledPnl:number|null}>, rules:typeof p6Rules=p6Rules) {
  const row = p6ContextRow(context);
  const m = row.market;
  const reject = (reason: string) => ({ allowed: false, reason });
  if (p6CurrentBlock(m) || p6PriceSmaBlock(m)) return reject('P4_CURRENT_STATE_BLOCK');
  const currentArm = p6CurrentArm(context, row);
  if (p6P1Block(row) || (m.regime === 'RANGE_BOUND' && m.slowSubregime === 'SR01'
    && (m.vix ?? Infinity) >= 15 && (m.vix ?? Infinity) < 20
    && (m.tqqqRealisedVol20d ?? -Infinity) >= .5 && (m.tqqqRealisedVol20d ?? -Infinity) < .6
    && (m.priceExtensionAtr ?? -Infinity) >= .75)) return reject('P3_BASE_COMPACT_OR_RANGE_BLOCK');
  if (m.regime === 'RISK_ON_WEAKENING' && m.slowSubregime === 'SR02'
    && (m.adx14 ?? Infinity) < 15 && (m.rsi14 ?? Infinity) < 35
    && state.lastSettledPnl !== null && state.lastSettledPnl <= 0) return reject('P3_PRIOR_SETTLED_LOSS_BLOCK');
  // E385 replaces the ancestor veto with E369; obsolete veto layers are NOT added again.
  const inheritedRejectBypass = m.regime === 'RISK_ON_EXTENDED' && m.slowSubregime === 'SR02'
    && Number.isFinite(m.roc5) && m.roc5! >= .0044
    && Number.isFinite(m.range20dPct) && m.range20dPct! >= .0651
    && p6RejectQualityGuard(row);
  if (p6ResearchReject(row) && !inheritedRejectBypass) return reject('P4_RESEARCH_ADDITIONAL_REJECT');
  const candidateA = p6CandidateA(m), rule = rules.find(([, predicate]) => predicate(row));
  const additional = p6E307(row) || p6E348(row) || p6E354(row) || p6ExtraAdmission(row);
  const finalReject = p6FinalReject(row, !p6ProtectionBypass(row));
  if (finalReject) return reject(finalReject);
  if (currentArm || candidateA || rule || additional) return { allowed: true,
    reason: rule?.[0] ?? (additional ? 'P4_CURRENT_ADDITIONAL_RULE' : candidateA ? 'P4_PARENT_OR_RULE_RELEASE' : 'P4_NORMAL_GATE') };
  return reject('P4_NO_PARENT_OR_RULE_MATCH');
}
