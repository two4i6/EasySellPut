/** Current-bar raw source proposal; strategy-side rules only, no completed replay. */
import type { StrategyObject } from '../strategy-module-v2';
import { evaluateEquityBoostTrigger, equityBoostRiskOnWeakeningSr01VolGateBlocked,
  isEquityBoostBass221VixReboundGateBlocked, isEquityBoostBass221SeverityActive,
  selectEquityBoostCandidate, type EquityBoostChain } from '../../engines/leveraged-overlay/v2/strategies/equity-boost-put-spread';
import { isEquityBoostBass221GateBlocked, isEquityBoostCandidate6GateBlocked,
  equityBoostCandidate6RiskMultiplier } from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { resolveOverlayUpstreamGate } from '../../engines/leveraged-overlay/v2/coordinator';
import {isObservationBackwardation} from '../market-coordinates-v3';
import {projectNativeMarketFacts} from '../native-market-facts-v7';
import type { E209Proposal } from './eb7-e209-e0-merge-v2';
import {createAdmissionTrace,type StrategyAdmissionGate} from '../strategy-admission-v1';

export type E209SourcePolicy = {
  broad: boolean; candidate6: boolean; targetDte: 28 | 35; widthTargetPct: number;
  ratioMin: number; ratioMax: number; macroMultiplier: number; collarMode: string;
  positionMode?: 'independent' | 'single';
};
/** These are actual source-book observations, never final-portfolio cumulative P&L. */
export type E209SourceRiskState = { openCount: number; realizedDrawdown: number };
const optionalNumber = (c: Readonly<StrategyObject>, key: string) => typeof c[key] === 'number' ? c[key] as number : undefined;

export function proposeE209SourceCurrentBar(input: {
  source: string; native: Readonly<StrategyObject>; chain: EquityBoostChain;
  asOf: string; policy: E209SourcePolicy; riskState: E209SourceRiskState;
}): { proposal: E209Proposal | null; reason: string;gates:StrategyAdmissionGate[] } {
  const { native, policy, riskState } = input;
  const trace=createAdmissionTrace(['上游与波动率','策略信号','变体风险闸','候选合约','组合准入']);
  if (native.asOf !== input.asOf) throw new Error('Source observation must match current bar');
  if (native.available === false) return { proposal: null, reason: 'native-unavailable',gates:trace.gates };
  const c = native.marketContext as StrategyObject, macro = native.macro as StrategyObject;
  const statuses = native.upstreamStatuses as StrategyObject;
  if (!c || !macro || !statuses || !Object.keys(statuses).length) throw new Error('Complete native source observation required');
  if (!Number.isInteger(riskState.openCount) || riskState.openCount < 0 || !Number.isFinite(riskState.realizedDrawdown)
    || riskState.realizedDrawdown < 0 || !Number.isFinite(policy.macroMultiplier) || policy.macroMultiplier <= 0) throw new Error('Invalid source risk state/policy');
  const regime = String(c.regime), slowSubregime = typeof c.slowSubregime === 'string' ? c.slowSubregime : undefined;
  const facts = projectNativeMarketFacts(c, optionalNumber);
  const vix = facts.vix, vxn = optionalNumber(macro, 'vxn');
  const shared = { regime, slowSubregime, vix, adx14: facts.adx14,
    priceVsSma200Pct: facts.priceVsSma200Pct, tqqqRealisedVol20d: facts.tqqqRealisedVol20d,
    tqqqRoc20: facts.tqqqRoc20, drawdownFromRecentHighPct: facts.drawdownFromRecentHighPct,
    roc5: facts.roc5, ...riskState };
  const blocked = (reason: string,index=2) => {trace.check(index,false,reason);return { proposal: null, reason,gates:trace.gates };};
  if (resolveOverlayUpstreamGate({ hasUpstreamBlock: Object.values(statuses).some(status => status === 'BLOCK' || status === 'ERROR'),
    collarMode: policy.collarMode, regime }) !== 'continue') return blocked('upstream',0);
  if (!Number.isFinite(vix)) return blocked('volatility-unavailable',0);
  trace.check(0,true,'上游检查与波动率观测可用');
  if (!evaluateEquityBoostTrigger({ enableEquityBoostPCS: true, entryMode: 'continuous', regime,
    crisisPhase: typeof c.crisisPhase === 'string' ? c.crisisPhase : undefined,
    backwardation: isObservationBackwardation(vix!, optionalNumber(macro, 'vix3m')),
    qqqROC5: facts.roc5 ?? 0, vix: vix!,
    // Native independent EB books retain overlapping positions for feedback and
    // sizing, but omit them from the trigger's single-position exclusion.
    dataConfidenceOk: true, hasOpenEquityBoost: policy.positionMode !== 'independent' && riskState.openCount > 0,
    hasCompetingQQQBullishPutPosition: false })) return blocked('trigger',1);
  trace.check(1,true,'当前来源时机信号通过');
  if (equityBoostRiskOnWeakeningSr01VolGateBlocked({ regime, slowSubregime,
    vix: optionalNumber(macro, 'vix'), vxn, vxnHistory: macro.vxnHistory as number[],
    ratioCeiling: 1.3, requireVxn10dRising: true })) return blocked('weakening-volatility');
  if (!policy.broad) {
    if ((regime === 'RANGE_BOUND' && slowSubregime === 'SR02')
      || (regime === 'RISK_ON_EXTENDED' && slowSubregime === 'SR01')
      || (regime === 'SIDEWAYS' && slowSubregime === 'SR01')
      || (shared.priceVsSma200Pct ?? 0) > .1275 || (vxn ?? 0) > 24) return blocked('narrow-state');
    if (isEquityBoostBass221GateBlocked({ ...shared, enabled: true, roc20: shared.tqqqRoc20,
      range20dPct: facts.range20dPct, priceExtensionAtr: facts.priceExtensionAtr,
      rsi14: facts.rsi14 })) return blocked('bass221');
    if (isEquityBoostBass221VixReboundGateBlocked({ ...shared, enabled: true,
      qqqRoc20: facts.roc20, qqqRoc5: shared.roc5,
      qqqRoc5Slope: optionalNumber(native, 'qqqRoc5Slope'), vix5dAgo: optionalNumber(macro, 'vix5dAgo') })) return blocked('vix-rebound');
  }
  if (policy.candidate6 && isEquityBoostCandidate6GateBlocked(shared)) return blocked('candidate6');
  trace.check(2,true,'当前来源变体、波动率与风险检查通过');
  const selected = selectEquityBoostCandidate(input.chain, input.asOf, policy.targetDte,
    { min: policy.ratioMin, max: policy.ratioMax }, policy.widthTargetPct, 1, 'width_first');
  if (!selected) return blocked('contract-unavailable',3);
  trace.check(3,true,`${selected.shortStrike}/${selected.longStrike} · ${selected.expiry}`);
  const severity = isEquityBoostBass221SeverityActive({ ...shared, qqqRoc20: facts.roc20,
    qqqRoc5: shared.roc5, range20dPct: facts.range20dPct }) ? .5 : 1;
  const multiplier = Math.min(policy.candidate6 ? equityBoostCandidate6RiskMultiplier(shared) : 1, severity) * policy.macroMultiplier;
  return { reason: 'current-source-proposal',gates:trace.gates, proposal: { source: input.source, context: c,
    contract: { symbol: `QQQ@${selected.longStrike}/${selected.shortStrike}`, expiry: selected.expiry,
      shortStrike: selected.shortStrike, longStrike: selected.longStrike, targetDte: policy.targetDte, multiplier } } };
}
