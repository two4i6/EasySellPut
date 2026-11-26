import { FactorEngine } from '../../FactorEngine';
import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { blackScholesEngine } from '../pricing/BlackScholesEngine';
import { PreTradeGate } from '../gates/PreTradeGate';
import { gexStructureEngine } from '../structure/GEXStructureEngine';
import { recommendationEngine } from '../recommendation/RecommendationEngine';
import { stockEngine } from '../analysis/StockEngine';
import { sellerEdgeTierFor } from '../analysis/SellerEdgeScoreEngine';
import { DEFAULT_SELLER_OPPORTUNITY_POLICY, type SellerOpportunityPolicy } from '../analysis/SellerOpportunityPolicy';
import type { OptionChain } from '../pricing/OptionChainEngine';
import { getFactorValue as getFV } from '../../factor';
import { getLeveragedOverlayStockPolicy, type LeveragedOverlayStockPolicy } from '../leveraged-overlay/stock-policy';
import {
  QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF,
  QQQ_INTRADAY_DIRECTIONAL_POLICY,
  qqqDirectionalDataBlockers,
  qqqDirectionalDataQuality,
  qqqDirectionalFactorValue,
  qqqDirectionalRoundPrice,
  type QqqIntradayDirectionalDecision,
  type QqqIntradayDirectionalVerdict,
} from '../analysis/QqqIntradayDirectional';

// ─── Pipeline Debug Utility ─────────────────────────────────────────────────
const _DP = typeof process !== 'undefined' && process.env.DEBUG_PIPELINE === '1';
function _dbg(tag: string, ...args: unknown[]) {
  if (_DP) console.log(`[${tag}]`, ...args);
}
// ────────────────────────────────────────────────────────────────────────────
import { ivSuitabilityEngine } from '../analysis/IVSuitabilityEngine';
import {
  verdictEngine,
  type VerdictAction,
  type StrategyType,
  type TriggerState,
  type GlobalVerdict,
  type VerdictTrigger,
} from './VerdictEngine';
import type { UnifiedRegime } from '../regime/UnifiedRegimeEngine';
import type {
  MacroDecisionValue,
  MacroRecommendationValue,
  MacroDecisionSystem,
  StockDecisionAnalysis,
  StockDecisionSystem,
  StockFinalAction,
  StrategyExecutionTrace,
} from '../../../types/macro';

type RecommendationBuildResult = {
  value: MacroRecommendationValue;
  description: string;
};

export type { DecisionPolicy, LeveragedOverlayStockPolicyId, LeveragedOverlayStockOverrides, LeveragedOverlayStockPolicy } from '../leveraged-overlay/stock-policy';

function triggerLabel(trigger: VerdictTrigger): string {
  return typeof trigger === 'string' ? trigger : trigger.id;
}

function toRiskLevel(level: string): MacroDecisionValue['riskLevel'] {
  const normalized = level.toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'extreme') {
    return normalized;
  }
  return 'medium';
}

export function computeMacroScore(global: {
  regime?: string;
  timing?: { score: number };
  riskScore: number;
  action: string;
  triggers?: any[];
}): number {
  const regime = global.regime;
  const timingScore = global.timing?.score ?? 50;
  const riskScore = global.riskScore;
  const regimeBase: Record<string, number> = {
    BULL: 55,
    SIDEWAYS_STRONG: 50,
    SIDEWAYS_WEAK: 40,
    BEAR: 15,
    CRISIS: 0,
  };
  const base = regime ? (regimeBase[regime] ?? 40) : 40;
  let raw = base + 0.45 * timingScore - 0.5 * Math.max(0, riskScore - 40);
  raw = Math.max(0, Math.min(100, raw));

  const blockers = (global.triggers || []).map(t => typeof t === 'string' ? t : (t?.id || ''));

  let limit = 100;
  for (const b of blockers) {
    if (b === 'CONFIDENCE_GATE') {
      limit = Math.min(limit, 35);
    } else if (b === 'VOL_SHOCK') {
      limit = Math.min(limit, 45);
    } else if (b === 'BEARISH_DIVERGENCE' || b === 'MACD_DIVERGENCE_PENALTY' || b === 'IV_RECOVERY') {
      limit = Math.min(limit, 55);
    }
  }

  raw = Math.min(raw, limit);

  if (global.action === 'TRADE') {
    raw = Math.max(raw, 70);
  }

  return Math.round(raw);
}

export type SellerEdgeThresholds = { watchThreshold: number; openThreshold: number };

export type SellerOpportunityDecision = {
  baseAction: StockFinalAction;
  finalAction: StockFinalAction;
  promotionSource: 'BASE' | 'WATCH_TRIGGER' | 'OPEN_TRIGGER' | 'CARRY_OPEN' | null;
  selectedSigma: 1 | 1.5 | 2 | 2.5 | null;
  watchCondition: boolean;
  openCondition: boolean;
  watchStreak: number;
  openStreak: number;
  blockedBy: string[];
};

export function executionAuthorizationFor(action: StockFinalAction): { allowed: boolean; status: 'TRADE' | 'WAIT' | 'BLOCK' } {
  return action === 'OPEN' ? { allowed: true, status: 'TRADE' }
    : action === 'BLOCK' ? { allowed: false, status: 'BLOCK' }
      : { allowed: false, status: 'WAIT' };
}

function usableNumber(factors: FactorMap, id: string): number | null {
  const factor = factors[id];
  return factor && factor.confidence > 0 && typeof factor.value === 'number' && Number.isFinite(factor.value) ? factor.value : null;
}

export function evaluateSellerTriggerConditions(
  factors: FactorMap,
  policy: SellerOpportunityPolicy = DEFAULT_SELLER_OPPORTUNITY_POLICY,
): { watchCondition: boolean; openCondition: boolean } {
  const sigma20 = usableNumber(factors, 'seller_sigma_20');
  const todayReturn = usableNumber(factors, 'seller_today_log_return');
  const edgeScore = usableNumber(factors, 'seller_edge_score');
  const premiumScore = usableNumber(factors, 'seller_premium_score');
  return {
    watchCondition: sigma20 != null && sigma20 > 0 && todayReturn != null && todayReturn <= -policy.watchSigma * sigma20,
    openCondition: sigma20 != null && sigma20 > 0 && todayReturn != null && edgeScore != null && premiumScore != null
      && todayReturn <= -policy.openSigma * sigma20
      && edgeScore >= policy.edgeOpenThreshold
      && premiumScore >= policy.premiumMinimum,
  };
}

/** API 生命周期只调用此函数推进 streak，避免复制政策阈值。 */
export function advanceSellerTriggerStreaks(
  factors: FactorMap,
  previous: { watchStreak: number; openStreak: number } | null,
  eligibleSnapshot: boolean,
  policy: SellerOpportunityPolicy = DEFAULT_SELLER_OPPORTUNITY_POLICY,
) {
  const conditions = evaluateSellerTriggerConditions(factors, policy);
  const prior = previous ?? { watchStreak: 0, openStreak: 0 };
  return {
    ...conditions,
    watchStreak: conditions.watchCondition ? prior.watchStreak + (eligibleSnapshot ? 1 : 0) : 0,
    openStreak: conditions.openCondition ? prior.openStreak + (eligibleSnapshot ? 1 : 0) : 0,
  };
}

/** 唯一卖方许可函数。GEX、偏斜、期限结构和流量不在输入集合内。 */
export function decideSellerOpportunity(
  factors: FactorMap,
  risk: { preTradeBlocked: boolean; hardGate?: string; globalAction: VerdictAction; riskScore: number },
  policy: SellerOpportunityPolicy = DEFAULT_SELLER_OPPORTUNITY_POLICY,
  legacyScoreOnlyThresholds?: SellerEdgeThresholds,
): SellerOpportunityDecision {
  const eventScore = usableNumber(factors, 'seller_event_score');
  const premiumScore = usableNumber(factors, 'seller_premium_score');
  const edgeScore = usableNumber(factors, 'seller_edge_score');
  const selectedSigmaValue = usableNumber(factors, 'seller_csp_carry_selected_sigma');
  const selectedSigma = selectedSigmaValue === 1 || selectedSigmaValue === 1.5 || selectedSigmaValue === 2 || selectedSigmaValue === 2.5 ? selectedSigmaValue : null;
  const carryEligible = selectedSigma !== null;
  const shockWeight = getFV<number>(factors, 'atr_shock_weight') ?? 0;
  const hardBlockedBy = [
    ...(risk.preTradeBlocked ? [risk.hardGate ?? 'PRE_TRADE_GATE'] : []),
    ...(risk.globalAction === 'EXIT' || risk.globalAction === 'REDUCE' ? [`VERDICT_${risk.globalAction}`] : []),
    ...(shockWeight >= .8 ? ['ATR_SHOCK'] : []),
  ];
  const approvalPending = policy.manualOpenOverride ? null
    : !policy.calibrationPassed ? 'CALIBRATION_PENDING'
    : !policy.validationPassed ? 'VALIDATION_PENDING'
      : null;
  const blockedBy = [...hardBlockedBy, ...(approvalPending ? [approvalPending] : [])];

  let baseAction: StockFinalAction;
  if (hardBlockedBy.length) baseAction = 'BLOCK';
  // 仅供历史 QQQ 代理回测复放 2026-07 前的 50/70 Edge 口径；实时调用不传此参数。
  else if (legacyScoreOnlyThresholds) baseAction = edgeScore != null && edgeScore >= legacyScoreOnlyThresholds.openThreshold ? 'OPEN'
    : edgeScore != null && edgeScore >= legacyScoreOnlyThresholds.watchThreshold ? 'WATCH' : 'WAIT';
  else if (carryEligible) baseAction = approvalPending ? 'WATCH' : 'OPEN';
  else if (eventScore != null && premiumScore != null && edgeScore != null
    && eventScore >= policy.eventOpenThreshold
    && premiumScore >= policy.premiumMinimum
    && edgeScore >= policy.edgeOpenThreshold) baseAction = approvalPending ? 'WATCH' : 'OPEN';
  else if (eventScore != null && edgeScore != null
    && eventScore >= policy.eventWatchThreshold
    && edgeScore >= policy.edgeWatchThreshold) baseAction = 'WATCH';
  else baseAction = 'WAIT';

  const { watchCondition, openCondition } = legacyScoreOnlyThresholds
    ? { watchCondition: false, openCondition: false }
    : evaluateSellerTriggerConditions(factors, policy);
  const watchStreak = watchCondition ? Math.max(0, Math.floor(usableNumber(factors, 'seller_watch_trigger_streak') ?? 0)) : 0;
  const openStreak = openCondition ? Math.max(0, Math.floor(usableNumber(factors, 'seller_open_trigger_streak') ?? 0)) : 0;

  let finalAction = baseAction;
  let promotionSource: SellerOpportunityDecision['promotionSource'] = !legacyScoreOnlyThresholds && carryEligible && !approvalPending && baseAction === 'OPEN' ? 'CARRY_OPEN' : baseAction === 'OPEN' || baseAction === 'WATCH' ? 'BASE' : null;
  if (!legacyScoreOnlyThresholds && baseAction === 'WAIT' && watchCondition && watchStreak >= policy.confirmationSnapshots) {
    finalAction = 'WATCH';
    promotionSource = 'WATCH_TRIGGER';
  } else if (!legacyScoreOnlyThresholds && !approvalPending && baseAction === 'WATCH' && openCondition && openStreak >= policy.confirmationSnapshots) {
    finalAction = 'OPEN';
    promotionSource = 'OPEN_TRIGGER';
  }
  return { baseAction, finalAction, promotionSource, selectedSigma, watchCondition, openCondition, watchStreak, openStreak, blockedBy };
}

export function stockActionReason(
  finalAction: StockFinalAction,
  sellerEdgeScore: number,
  options: { hardGate?: string; globalAction?: string; riskScore?: number; thresholds?: SellerEdgeThresholds } = {},
) {
  const thresholds = options.thresholds ?? { watchThreshold: 80, openThreshold: 120 };
  if (finalAction === 'OPEN') return `Seller Edge ${sellerEdgeScore.toFixed(0)} ≥ OPEN 阈值 ${thresholds.openThreshold} → OPEN`;
  if (finalAction === 'WATCH') return `Seller Edge ${sellerEdgeScore.toFixed(0)} ≥ WATCH 阈值 ${thresholds.watchThreshold} → WATCH`;
  if (finalAction === 'WAIT') return `Seller Edge ${sellerEdgeScore.toFixed(0)} < WATCH 阈值 ${thresholds.watchThreshold} → WAIT`;
  if (options.hardGate) return `交易前硬门控 → BLOCK：${options.hardGate}`;
  if (options.globalAction === 'EXIT') return '全局决策 EXIT → BLOCK';
  if (options.globalAction === 'REDUCE') return `Real Risk ${(options.riskScore ?? 0).toFixed(0)} · 超出风控阈值 → BLOCK`;
  return '极高波动冲击 → BLOCK';
}

export class DecisionEngine extends FactorEngine {
  public getQqqIntradayDirectionalDecision(
    factors: FactorMap,
    directionalVerdict?: FinancialFactor<QqqIntradayDirectionalVerdict>,
  ): FinancialFactor<QqqIntradayDirectionalDecision> {
    const verdict = directionalVerdict ?? verdictEngine.getQqqIntradayDirectionalVerdict(factors);
    factors.qqq_dir_directional_verdict = verdict;
    const dataQuality = qqqDirectionalDataQuality(factors);
    const dataBlockers = qqqDirectionalDataBlockers(factors);
    const atr = qqqDirectionalFactorValue(factors, QDF.atr, 0);
    const callWall = qqqDirectionalFactorValue(factors, QDF.callWall, 0);
    const putWall = qqqDirectionalFactorValue(factors, QDF.putWall, 0);
    const gammaFlip = qqqDirectionalFactorValue(factors, QDF.flip, 0);
    const structureContext = atr > 0 && callWall > 0 && putWall > 0 && gammaFlip > 0
      ? {
          atr: qqqDirectionalRoundPrice(atr),
          callWall: qqqDirectionalRoundPrice(callWall),
          putWall: qqqDirectionalRoundPrice(putWall),
          gammaFlip: qqqDirectionalRoundPrice(gammaFlip),
        }
      : null;
    const base = {
      policyVersion: QQQ_INTRADAY_DIRECTIONAL_POLICY.id,
      signalId: null,
      structureId: null,
      alertType: null,
      direction: verdict.value.direction,
      regime: verdict.value.regime,
      playbook: verdict.value.playbook,
      grade: verdict.value.grade,
      intent: verdict.value.intent,
      stage: verdict.value.stage,
      riskPlan: null,
      structureContext,
      anchorBar: factors[QDF.anchor]?.confidence ? new Date(qqqDirectionalFactorValue(factors, QDF.anchor, 0)).toISOString() : null,
      entryZone: null,
      invalidation: null,
      targets: null,
      validUntil: null,
      planExpiresAt: null,
      reasonCodes: verdict.value.reasonCodes,
      blockers: dataBlockers,
      dataQuality,
      researchStatus: QQQ_INTRADAY_DIRECTIONAL_POLICY.researchStatus,
    } satisfies Omit<QqqIntradayDirectionalDecision, 'status'>;
    const wrap = (value: QqqIntradayDirectionalDecision, ids: string[] = []) => {
      const inputIds = ['qqq_dir_directional_verdict', ...ids].filter((id) => factors[id]);
      return this.derived(
        value,
        inputIds.map((factorId) => ({ factorId, weight: 1 / inputIds.length })),
        factors,
        '方向提醒只输出 QQQ 价格与条件式 R 计划；下午为人工风险提示，不推断成交、仓位或真实平仓',
      );
    };

    const stableId = (prefix: 'dir' | 'structure', parts: Array<string | null>) => {
      const stableKey = parts.join('|');
      let hash = 2166136261;
      for (let index = 0; index < stableKey.length; index += 1) {
        hash ^= stableKey.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `qqq-${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    };
    const anchorMs = qqqDirectionalFactorValue(factors, QDF.anchor, 0);
    const anchorCloseMs = anchorMs + QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000;
    const sessionDate = qqqDirectionalFactorValue(factors, QDF.sessionDate, 'unknown-date');
    const etMinute = qqqDirectionalFactorValue(factors, QDF.etMinute, 0);
    const millisecondsUntilClose = Math.max(0, QQQ_INTRADAY_DIRECTIONAL_POLICY.marketCloseEtMinutes - etMinute) * 60_000;
    const signalValidDuration = Math.min(
      QQQ_INTRADAY_DIRECTIONAL_POLICY.validBars * QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000,
      millisecondsUntilClose,
    );

    if (verdict.value.status === 'BLOCKED') {
      const status = dataBlockers.length > 0 ? 'INSUFFICIENT_DATA' : 'NO_SIGNAL';
      return wrap({ ...base, status });
    }

    if (verdict.value.intent === 'RISK_CUE' && verdict.value.direction && verdict.value.riskSide && verdict.value.stage) {
      const long = verdict.value.direction === 'LONG';
      const zoneLowId = long ? QDF.resistanceLow : QDF.supportLow;
      const zoneHighId = long ? QDF.resistanceHigh : QDF.supportHigh;
      const zoneLow = qqqDirectionalFactorValue(factors, zoneLowId, 0);
      const zoneHigh = qqqDirectionalFactorValue(factors, zoneHighId, 0);
      if (!(zoneLow > 0) || !(zoneHigh >= zoneLow)) return wrap({ ...base, status: 'WATCH' }, [zoneLowId, zoneHighId]);
      const triggered = verdict.value.stage === 'STOP_RISK' && (verdict.value.status === 'LONG' || verdict.value.status === 'SHORT');
      if (triggered && qqqDirectionalFactorValue(factors, QDF.rearmSuppressed, false)) {
        return wrap({ ...base, status: 'WATCH', reasonCodes: ['REARM_NOT_READY'] }, [QDF.rearmSuppressed]);
      }
      if (triggered && qqqDirectionalFactorValue(factors, QDF.duplicateSuppressed, false)) {
        return wrap({ ...base, status: 'WATCH', reasonCodes: ['DUPLICATE_SIGNAL'] }, [QDF.duplicateSuppressed]);
      }
      const riskPlan = {
        atRisk: verdict.value.riskSide,
        severity: triggered ? 'STOP' as const : 'ELEVATED' as const,
        triggerZone: { low: qqqDirectionalRoundPrice(zoneLow), high: qqqDirectionalRoundPrice(zoneHigh) },
        recoveryLevel: qqqDirectionalRoundPrice(long ? zoneLow : zoneHigh),
      };
      const structureId = triggered ? stableId('structure', [
        QQQ_INTRADAY_DIRECTIONAL_POLICY.id, sessionDate, verdict.value.direction,
        verdict.value.playbook, verdict.value.riskSide, new Date(anchorMs).toISOString(),
      ]) : null;
      const signalId = triggered ? stableId('dir', [
        QQQ_INTRADAY_DIRECTIONAL_POLICY.id, sessionDate, verdict.value.direction,
        verdict.value.playbook, verdict.value.stage, verdict.value.riskSide, new Date(anchorMs).toISOString(),
      ]) : null;
      return wrap({
        ...base,
        status: triggered ? long ? 'ALERT_LONG' : 'ALERT_SHORT' : 'WATCH',
        signalId,
        structureId,
        alertType: triggered ? 'RISK' : null,
        riskPlan,
        validUntil: triggered ? new Date(anchorCloseMs + signalValidDuration).toISOString() : null,
        planExpiresAt: new Date(anchorCloseMs + Math.min(QQQ_INTRADAY_DIRECTIONAL_POLICY.maxPlanMinutes * 60_000, millisecondsUntilClose)).toISOString(),
      }, [zoneLowId, zoneHighId, QDF.anchor, QDF.sessionDate]);
    }

    if (!verdict.value.direction || !verdict.value.stage) return wrap({ ...base, status: 'WATCH' });

    const long = verdict.value.direction === 'LONG';
    const direction = verdict.value.direction;
    const momentumOpportunity = verdict.value.grade === 'C' && verdict.value.playbook === 'DIRECTIONAL_WATCH';
    const zoneLowId = momentumOpportunity ? QDF.momentumLow : long ? QDF.supportLow : QDF.resistanceLow;
    const zoneHighId = momentumOpportunity ? QDF.momentumHigh : long ? QDF.supportHigh : QDF.resistanceHigh;
    const invalidationId = momentumOpportunity ? long ? QDF.momentumLongInvalidation : QDF.momentumShortInvalidation : long ? QDF.longInvalidation : QDF.shortInvalidation;
    const targetId = momentumOpportunity ? long ? QDF.momentumLongTarget : QDF.momentumShortTarget : long ? QDF.longTarget : QDF.shortTarget;
    const structureRId = momentumOpportunity ? long ? QDF.momentumLongStructureR : QDF.momentumShortStructureR : long ? QDF.longStructureR : QDF.shortStructureR;
    const zoneLow = qqqDirectionalFactorValue(factors, zoneLowId, 0);
    const zoneHigh = qqqDirectionalFactorValue(factors, zoneHighId, 0);
    const invalidation = qqqDirectionalFactorValue(factors, invalidationId, 0);
    const rawStructureTarget = qqqDirectionalFactorValue(factors, targetId, 0);
    const rawStructureR = qqqDirectionalFactorValue(factors, structureRId, 0);
    const alertCandidate = verdict.value.stage === 'SETUP' || verdict.value.stage === 'ARMED' || verdict.value.stage === 'TRIGGERED';
    if (alertCandidate && qqqDirectionalFactorValue(factors, QDF.rearmSuppressed, false)) {
      return wrap({
        ...base,
        status: 'WATCH',
        reasonCodes: ['REARM_NOT_READY'],
      }, [QDF.rearmSuppressed]);
    }
    if (alertCandidate && qqqDirectionalFactorValue(factors, QDF.duplicateSuppressed, false)) {
      return wrap({
        ...base,
        status: 'WATCH',
        reasonCodes: ['DUPLICATE_SIGNAL'],
      }, [QDF.duplicateSuppressed]);
    }
    const entry = (zoneLow + zoneHigh) / 2;
    const risk = long ? entry - invalidation : invalidation - entry;
    const minimumStructureR = verdict.value.grade === 'A'
      ? QQQ_INTRADAY_DIRECTIONAL_POLICY.minimumStructureR
      : verdict.value.grade === 'B'
        ? QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeBMinimumStructureR
        : QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCMinimumStructureR;
    const structureReason = verdict.value.grade === 'A'
      ? 'STRUCTURE_TARGET_BELOW_1_5R' as const
      : verdict.value.grade === 'B'
        ? 'STRUCTURE_TARGET_BELOW_1_25R' as const
        : 'STRUCTURE_TARGET_BELOW_1R' as const;
    if (
      !Number.isFinite(entry) || !Number.isFinite(risk) || risk <= 0
      || rawStructureR < minimumStructureR
      || (long ? rawStructureTarget <= entry : rawStructureTarget >= entry)
    ) {
      return wrap({
        ...base,
        status: 'WATCH',
        reasonCodes: [...new Set<QqqIntradayDirectionalDecision['reasonCodes'][number]>([...base.reasonCodes, structureReason])],
      }, [zoneLowId, zoneHighId, invalidationId, targetId, structureRId]);
    }

    const oneR = entry + (long ? risk : -risk);
    const displayedStructureR = Math.min(rawStructureR, QQQ_INTRADAY_DIRECTIONAL_POLICY.maximumDisplayedTargetR);
    const structure = entry + (long ? risk * displayedStructureR : -risk * displayedStructureR);
    const lifecycleAnchorMs = qqqDirectionalFactorValue(factors, QDF.lifecycleAnchor, anchorMs);
    const carriedStructureId = qqqDirectionalFactorValue<string>(factors, QDF.lifecycleStructureId, '');
    const structureId = carriedStructureId || stableId('structure', [
      QQQ_INTRADAY_DIRECTIONAL_POLICY.id, sessionDate, direction, verdict.value.playbook,
      verdict.value.intent, new Date(lifecycleAnchorMs).toISOString(),
    ]);
    const signalId = stableId('dir', [structureId, verdict.value.stage, new Date(anchorMs).toISOString()]);
    const confirmed = verdict.value.stage === 'TRIGGERED';
    const entryValidDuration = verdict.value.stage === 'SETUP'
      ? Math.min(QQQ_INTRADAY_DIRECTIONAL_POLICY.maxPlanMinutes * 60_000, millisecondsUntilClose)
      : signalValidDuration;
    const decision: QqqIntradayDirectionalDecision = {
      ...base,
      status: long ? 'ALERT_LONG' : 'ALERT_SHORT',
      signalId,
      structureId,
      alertType: confirmed ? 'CONFIRMED' : 'OPPORTUNITY',
      direction,
      entryZone: { low: qqqDirectionalRoundPrice(zoneLow), high: qqqDirectionalRoundPrice(zoneHigh) },
      invalidation: qqqDirectionalRoundPrice(invalidation),
      targets: {
        oneR: qqqDirectionalRoundPrice(oneR),
        structure: qqqDirectionalRoundPrice(structure),
        structureR: Number(displayedStructureR.toFixed(2)),
      },
      validUntil: new Date(anchorCloseMs + entryValidDuration).toISOString(),
      planExpiresAt: new Date(anchorCloseMs + Math.min(QQQ_INTRADAY_DIRECTIONAL_POLICY.maxPlanMinutes * 60_000, millisecondsUntilClose)).toISOString(),
    };
    return wrap(decision, [zoneLowId, zoneHighId, invalidationId, targetId, structureRId, QDF.anchor, QDF.sessionDate, QDF.lifecycleStructureId, QDF.lifecycleAnchor]);
  }

  public getLeveragedOverlayStockPolicy(factors: FactorMap): FinancialFactor<LeveragedOverlayStockPolicy> {
    return getLeveragedOverlayStockPolicy(factors, verdictEngine.getLeveragedOverlayRisk(factors));
  }
  private sigmoid(x: number, k: number, x0: number): number {
    return 1 / (1 + Math.exp(-k * (x - x0)));
  }

  private getColorForAction(action: VerdictAction): string {
    switch (action) {
      case 'TRADE':
        return '#10b981';
      case 'WAIT':
        return '#f59e0b';
      case 'REDUCE':
        return '#f43f5e';
      case 'EXIT':
        return '#ef4444';
      default:
        return '#94a3b8';
    }
  }

  private calcStrategyParams(
    strategy: StrategyType,
    regime: UnifiedRegime,
    ivOpportunity: 'RICH' | 'FAIR' | 'CHEAP',
    riskScore: number,
    vix: number,
    spxPrice: number,
    strikeRoundUnit: number = 5,
  ): { delta: number; dte: number; width: number } {
    let dte = 45;
    if (ivOpportunity === 'RICH' && riskScore < 50) dte = 35;
    else if (ivOpportunity === 'RICH' && riskScore >= 50) dte = 30;
    else if (riskScore > 60) dte = 21;

    let delta = 0.10;
    if (strategy === 'CashSecuredPut') {
      delta = riskScore < 50 ? 0.18 : 0.14;
    } else if (regime === 'BULL' && riskScore < 40) {
      delta = strategy === 'PutCreditSpread' ? 0.20 : 0.15;
    } else if (regime === 'BULL' && riskScore < 60) {
      delta = strategy === 'PutCreditSpread' ? 0.15 : 0.12;
    } else {
      delta = strategy === 'CallCreditSpread' ? 0.12 : 0.08;
    }

    let width = 0;
    if (strategy === 'PutCreditSpread' || strategy === 'IronCondor' || strategy === 'CallCreditSpread') {
      const vixMultiplier = vix > 25 ? 1.5 : vix > 20 ? 1.2 : 1.0;
      const rawWidth = spxPrice * 0.0075 * vixMultiplier;
      width = Math.max(
        strikeRoundUnit,
        Math.round(rawWidth / strikeRoundUnit) * strikeRoundUnit,
      );
    }

    return { delta, dte, width };
  }

  private formatFactorEvidence(label: string, value: number): string {
    const normalized = Number.isInteger(value) ? value.toString() : value.toFixed(2);
    return `${label}=${normalized}`;
  }

  private calcPositionSizing(
    riskAdjustedSize: number,
    volPremium: number,
    entryScore: number,
    regime: string,
  ): { size: number } {
    if (riskAdjustedSize <= 0) return { size: 0 };

    const rawEdge = volPremium - 1.0;
    const timingQuality = entryScore / 100;
    const marginalUtility = rawEdge * timingQuality;
    const targetEdge = 0.30;
    const rawSize = marginalUtility / targetEdge;

    const regimeParams: Record<string, { k: number; x0: number }> = {
      BULL:            { k: 10, x0: 0.15 },
      SIDEWAYS_STRONG: { k: 8,  x0: 0.20 },
      SIDEWAYS_WEAK:   { k: 7,  x0: 0.25 },
      BEAR:            { k: 5,  x0: 0.40 },
      CRISIS:          { k: 3,  x0: 0.60 },
    };

    const { k, x0 } = regimeParams[regime] ?? { k: 7, x0: 0.25 };
    const adjusted = this.sigmoid(rawSize, k, x0);
    return { size: Math.round(riskAdjustedSize * adjusted * 100) / 100 };
  }

  private buildRecommendation(
    factors: FactorMap,
    verdict: FinancialFactor<GlobalVerdict>,
  ): RecommendationBuildResult {
    const v = verdict.value;
    const action = v.action;
    const riskScore = v.riskScore;
    const timing = v.timing;
    
    const regime = v.regime;
    const price = getFV<number>(factors, 'underlying_price') ?? 0;
    const vix = getFV<number>(factors, 'vix_price') ?? 20;
    const strikeRoundUnit = getFV<number>(factors, 'strike_round_unit') ?? 5;
    const timingScore = timing.score;

    const ivResult = ivSuitabilityEngine.analyze(factors);
    const ivOpportunity = ivResult.level;

    if (action === 'WAIT' || action === 'EXIT' || action === 'REDUCE') {
      const isBlocked = action === 'EXIT' || (action === 'WAIT' && riskScore >= 60);
      const blockedBy = v.triggers.map(triggerLabel);
      
      return {
        value: {
          strategy: 'No New Positions',
          reason: 'Global verdict: ' + action,
          reasonEn: 'Strategic hold or reduction active.',
          triggerFactors: [
            this.formatFactorEvidence('real_risk', riskScore),
            this.formatFactorEvidence('timing_score', timingScore)
          ].slice(0, 3),
          blockedBy,
          setup: { delta: 0, dte: 45, width: 0 },
          financials: { credit: 0, maxRisk: 0, returnOnRisk: '0%' },
          holding: 'N/A',
          ivOpportunity: ivOpportunity,
          tradability: isBlocked ? 'BLOCKED' : 'RESTRICTED',
          recoveryConditions: [],
          confidence: verdict.confidence,
          edgeConfidence: v.confidence,
          hmmRegime: v.hmmRegime,
          dataQuality: 'high',
          tradeStructureAvailable: false,
        },
        description: 'Global verdict: ' + action,
      };
    }

    const strategy: StrategyType = regime === 'BULL' ? (riskScore < 30 ? 'CashSecuredPut' : 'PutCreditSpread') : (regime === 'BEAR' ? 'CallCreditSpread' : 'IronCondor');
    const { delta, dte, width } = this.calcStrategyParams(strategy, regime, ivOpportunity, riskScore, vix, price, strikeRoundUnit);

    const irx = getFV<number>(factors, 'irx_price') ?? 0;
    const rfRate = irx > 0 ? irx / 100 : 0.04;
    
    const ivOverride = (factors.iv_override?.confidence ?? 0) > 0 ? getFV<number>(factors, 'iv_override') : null;
    const impliedIV  = (factors.implied_volatility?.confidence ?? 0) > 0 ? getFV<number>(factors, 'implied_volatility') : null;
    const iv = ivOverride !== null && ivOverride !== undefined
      ? ivOverride / 100          
      : impliedIV !== null && impliedIV !== undefined
      ? impliedIV                 
      : vix / 100;                

    let setup = { delta, dte, width };
    let financials = { credit: 0, maxRisk: 0, returnOnRisk: '0%' };
    let holding = 'N/A';

    try {
      if (strategy === 'PutCreditSpread') {
        const priced = blackScholesEngine.pricePutCreditSpread(price, dte, rfRate, iv, delta, width);
        setup = { delta: Math.abs(priced.delta), dte, width };
        financials = { credit: priced.creditPerContract, maxRisk: priced.maxRisk, returnOnRisk: priced.returnOnRisk };
        holding = priced.holding;
      } else if (strategy === 'CashSecuredPut') {
        const priced = blackScholesEngine.priceCashSecuredPut(price, dte, rfRate, iv, delta);
        setup = { delta: Math.abs(priced.delta), dte, width: 0 };
        financials = { credit: priced.premiumPerContract, maxRisk: priced.maxRisk, returnOnRisk: priced.returnOnRisk };
        holding = priced.holding;
      } else if (strategy === 'CallCreditSpread') {
        const priced = blackScholesEngine.priceCallCreditSpread(price, dte, rfRate, iv, delta, width);
        setup = { delta: Math.abs(priced.delta), dte, width };
        financials = { credit: priced.creditPerContract, maxRisk: priced.maxRisk, returnOnRisk: priced.returnOnRisk };
        holding = priced.holding;
      } else if (strategy === 'IronCondor') {
        const priced = blackScholesEngine.priceIronCondor(price, dte, rfRate, iv, delta, width);
        setup = { delta: Math.abs(priced.delta), dte, width };
        financials = { credit: priced.creditPerContract, maxRisk: priced.maxRisk, returnOnRisk: priced.returnOnRisk };
        holding = priced.holding;
      }
    } catch (error) {
      console.error('BlackScholes Pricing Error:', error);
    }

    return {
      value: {
        strategy,
        reason: 'Global verdict TRADE',
        reasonEn: 'Strategic recommendation based on market conditions.',
        triggerFactors: [],
        blockedBy: [],
        setup,
        financials,
        holding,
        ivOpportunity: ivOpportunity,
        tradability: 'ALLOWED',
        confidence: verdict.confidence,
        edgeConfidence: v.confidence,
        hmmRegime: v.hmmRegime,
        positionSizeMultiplier: v.riskAdjustedSize,
        dataQuality: 'high',
        tradeStructureAvailable: true,
      },
      description: 'Global verdict TRADE'};
  }

  public getDecisionSystem(
    factors: FactorMap,
    prevAction?: VerdictAction,
    stableFor = 0,
    triggerState: TriggerState = {},
    thresholds?: SellerEdgeThresholds,
  ): MacroDecisionSystem {
    const verdict = verdictEngine.getVerdict(factors, prevAction, stableFor, triggerState);
    const v = verdict.value;

    const ivResult = ivSuitabilityEngine.analyze(factors);
    const ivOpportunity = ivResult.level;
    const ivScore = ivResult.score;

    const decisionValue: MacroDecisionValue = {
      action: v.action,
      strategy: null,
      color: this.getColorForAction(v.action),
      positionSize: v.riskAdjustedSize,
      sizeLabel: `${(v.riskAdjustedSize * 100).toFixed(2)}%`,
      reason: 'Global verdict: ' + v.action,
      reasonKeys: [],
      triggerConditions: [],
      regime: v.regime,
      hmmRegime: v.hmmRegime,
      confidence: verdict.confidence,
      edgeConfidence: v.confidence,
      riskScore: v.riskScore,
      realRisk: v.riskScore,
      marketLabels: v.triggers.map(triggerLabel),
      priceExtension: v.timing.details.priceExtension,
      trendQuality: v.timing.details.trendQuality,
      triggerState: {},
      ivOpportunity: ivOpportunity,
      ivScore: ivScore,
      timingState: v.timing.state,
      riskLevel: toRiskLevel(v.risk.level),
      triggers: v.triggers.map(triggerLabel),
      timing: v.timing,
      risk: v.risk,
      market_regime: v.market_regime,
      volatility_state: v.volatility_state,
      overall_bias: v.overall_bias,
      market_quality: v.market_quality,
      analysisReasons: {
        iv: [],
        timing: v.timing.reasons,
        risk: v.risk.reasons,
        conflict: []
      },
      reduceSpec: undefined };

    const decision = this.derived(
      decisionValue,
      [
        { factorId: 'real_risk', weight: 1.0 },
      ],
      factors,
      'Global Decision'
    );

    const recommendationBuild = this.buildRecommendation(factors, verdict);
    const recommendation = this.manual(recommendationBuild.value, recommendationBuild.description);

    const hasLiquidity = (factors.atm_bid_ask_spread?.confidence ?? 0) > 0;
    const opportunityInputs = hasLiquidity
      ? [
          { factorId: 'iv_rank', weight: 0.33 },
          { factorId: 'iv_percentile', weight: 0.17 },
          { factorId: 'iv_hv_ratio', weight: 0.22 },
          { factorId: 'vix_term_ratio', weight: 0.13 },
          { factorId: 'atm_bid_ask_spread', weight: 0.15 },
        ]
      : [
          { factorId: 'iv_rank', weight: 0.40 },
          { factorId: 'iv_percentile', weight: 0.20 },
          { factorId: 'iv_hv_ratio', weight: 0.25 },
          { factorId: 'vix_term_ratio', weight: 0.15 },
        ];

    const spreadValue = getFV<number>(factors, 'atm_bid_ask_spread') ?? 0;
    const liquidityPenalty = hasLiquidity && spreadValue > 0.1 ? ' [Low Liquidity]' : '';
    const liquidityScorePenalty = (hasLiquidity && spreadValue > 0.2) ? 20 : (hasLiquidity && spreadValue > 0.1) ? 10 : 0;

    const baseOpportunityScore = getFV<number>(factors, 'opportunity_score') ?? ivScore;
    const opportunityScore = Math.max(0, baseOpportunityScore - liquidityScorePenalty);

    const opportunityLabel =
      opportunityScore >= 65 ? 'Excellent' :
      opportunityScore >= 35 ? 'Good' :
      opportunityScore >= 15 ? 'Fair' :
      'Poor';

    const breakdown = {
      ivRank:        { value: getFV<number>(factors, 'iv_rank') || 50,     score: 50 },
      volPremium:    { value: getFV<number>(factors, 'vol_premium') || 1.0, score: 50 },
      termStructure: { value: getFV<number>(factors, 'vix_term_ratio') || 1.0, score: 50 },
    };

    const opportunity = this.derived(
      {
        score: opportunityScore,
        label: opportunityLabel + liquidityPenalty,
        breakdown,
      },
      opportunityInputs,
      factors,
      'Opportunity analysis'
    );

    const timing = this.derived(
      {
        score: v.timing.score,
        state: v.timing.state,
        explanation: v.timing.reasons[0] || 'Timing analysis available'
      },
      [
        { factorId: 'underlying_price', weight: 0.5 },
        { factorId: 'rsi', weight: 0.5 },
      ],
      factors,
      v.timing.reasons.join(', ')
    );

    const step5Reason = v.action === 'TRADE'
      ? `${ivOpportunity} IV + ${v.timing.state} timing under ${v.regime} regime`
      : v.action === 'REDUCE'
      ? (v.risk.reasons[0] ?? `${v.risk.level} risk level, reduce exposure`)
      : (v.triggers[0] ? triggerLabel(v.triggers[0]) : v.risk.reasons[0] ?? `${v.action}: conditions not met`);

    const trace: MacroDecisionSystem['decisionTrace'] = {
      step1_regime: {
        regime: v.regime,
        score: getFV<number>(factors, 'regime_score') ?? 50,
        conclusion: v.regime === 'BULL' ? '价格在MA200上方，多头排列' :
                    v.regime === 'SIDEWAYS_STRONG' ? '震荡偏强，MA200支撑' :
                    v.regime === 'SIDEWAYS_WEAK' ? '震荡偏弱，方向不明' :
                    v.regime === 'BEAR' ? '价格跌破MA200，空头确认' :
                    'VIX极端或深度超跌，危机模式'
      },
      step2_iv: {
        opportunity: ivOpportunity,
        score: ivScore,
        conclusion: ivOpportunity === 'RICH' ? '隐含波动率高于历史均值，期权溢价丰富' :
                    ivOpportunity === 'CHEAP' ? '隐含波动率偏低，卖方优势不足' :
                    '隐含波动率处于合理区间'
      },
      step3_timing: {
        state: v.timing.state,
        score: v.timing.score,
        conclusion: v.timing.reasons[0] ?? `Timing ${v.timing.state}`
      },
      step4_risk: {
        level: v.risk.level,
        score: v.risk.score,
        conclusion: v.risk.reasons[0] ?? `风险等级 ${v.risk.level}`
      },
      step5_verdict: {
        action: v.action,
        reason: step5Reason,
        mainBlocker: v.triggers[0] ? triggerLabel(v.triggers[0]) : null
      },
      step6_structure: v.action === 'TRADE'
        ? {
            available: true,
            strategy: undefined,
            edgeSource: `${ivOpportunity} IV + ${v.timing.state} Timing`,
          }
        : {
            available: false,
            alternative: undefined,
            nextTrigger: undefined,
          }
    };

    const yieldSpread = getFV<number>(factors, 'yield_spread') ?? 0;
    const tnx = getFV<number>(factors, 'tnx_price') ?? 4;
    const macroScore = getFV<number>(factors, 'macro_score') ?? 50;
    const macroMagi =
      macroScore >= 55
        ? `Macro Support: Yield Curve ${yieldSpread > 0 ? 'Normal' : 'Flat'}, 10Y ${tnx.toFixed(2)}%`
        : macroScore >= 30
        ? `Macro Neutral: Monitor Rate Environment (10Y ${tnx.toFixed(2)}%)`
        : `Macro Headwind: Rate Pressure / Curve Inversion (Spread ${yieldSpread.toFixed(2)}%)`;

    const scientistMagi = ivOpportunity === 'RICH' ? 'IV Rich' : 'IV Fair/Cheap';
    let opportunistMagi = 'Hold: No Clear Edge';
    if (recommendation.value.tradability === 'ALLOWED') {
      opportunistMagi = `Rule Match: ${recommendation.value.strategy}`;
    } else if (v.action === 'REDUCE') {
      opportunistMagi = `Reduce Exposure: Risk Management`;
    } else if (v.action === 'EXIT') {
      opportunistMagi = 'Exit All: Capital Protection Mode';
    } else if (recommendation.value.blockedBy.length > 0) {
      opportunistMagi = `Blocked: ${recommendation.value.blockedBy.join(', ')}`;
    }

    const warningText =
      v.risk.level === 'extreme' || v.risk.level === 'high'
        ? `${v.risk.level.toUpperCase()} RISK: ${v.risk.reasons[0] || ''}`
        : null;

    return {
      decision,
      riskWarning: this.derived(
        warningText,
        [
          { factorId: 'real_risk', weight: 1.0 },
        ],
        factors,
      ),
      recommendation,
      metrics: { opportunity, timing },
      exitRules: this.calcExitRules(v.regime, ivOpportunity, v.riskScore, factors),
      magi: {
        scientist: this.derived(
          scientistMagi,
          [
            { factorId: 'iv_rank', weight: 0.40 },
            { factorId: 'iv_percentile', weight: 0.20 },
            { factorId: 'iv_hv_ratio', weight: 0.25 },
            { factorId: 'vix_term_ratio', weight: 0.15 },
          ],
          factors,
        ),
        macro: this.derived(
          macroMagi,
          [
            { factorId: 'macro_score', weight: 0.50 },
            { factorId: 'yield_spread', weight: 0.30 },
            { factorId: 'tnx_price', weight: 0.20 },
          ],
          factors,
        ),
        opportunist: this.derived(
          opportunistMagi,
          [
            { factorId: 'real_risk', weight: 1.0 },
          ],
          factors,
        ),
      },
      decisionTrace: trace,
    };
  }

  public getStockDecisionSystem(
    factors: FactorMap,
    chain: OptionChain,
    timestamps: Record<string, number> = {},
    enablePanicIntervention: boolean = true,
    userSettings: Partial<import('../../../store/useCSPStore').CSPSettings> = {},
    targetStrike?: number,
    targetExpiry?: string,
    prevAction?: VerdictAction,
    stableFor = 0,
    triggerState: TriggerState = {},
    thresholds?: SellerEdgeThresholds,
    sellerPolicy?: SellerOpportunityPolicy,
  ): StockDecisionSystem {
    const system = this.getDecisionSystem(factors, prevAction, stableFor, triggerState);
    const global = system.decision.value;

    const preTradeGate = PreTradeGate.evaluate(factors, chain, timestamps);
    const gexStructure = gexStructureEngine.analyze(factors);
    const ivOpportunity = ivSuitabilityEngine.analyze(factors);
    const expectedMoveAnalysis = stockEngine.buildExpectedMoveAnalysis(factors, gexStructure);

    const matrixRows = expectedMoveAnalysis.matrix.value;
    const globalLower = expectedMoveAnalysis.expectedMove.value.band68.lower;
    const currentPrice = getFV<number>(factors, 'underlying_price') || getFV<number>(factors, 'price') || 0;

    const entryRecommendation = recommendationEngine.recommend({
      factors,
      chain,
      lowerBound: globalLower,
      currentPrice,
      matrixRows,
      timestamps,
      enablePanicIntervention,
      userSettings,
      targetStrike,
      targetExpiry
    });

    const shockWeight = getFV<number>(factors, 'atr_shock_weight') || 0;
    const finalReasons: string[] = [...entryRecommendation.risk_warnings];

    const sellerEdgeScore = getFV<number>(factors, 'seller_edge_score') ?? 0;
    const policy = sellerPolicy ?? DEFAULT_SELLER_OPPORTUNITY_POLICY;
    const sellerDecision = decideSellerOpportunity(factors, {
      preTradeBlocked: preTradeGate.blocked,
      hardGate: preTradeGate.hard_gates[0],
      globalAction: global.action,
      riskScore: global.riskScore,
    }, policy, thresholds);
    const { finalAction } = sellerDecision;
    const actionReason = thresholds
      ? stockActionReason(finalAction, sellerEdgeScore, { hardGate: preTradeGate.hard_gates[0], globalAction: global.action, riskScore: global.riskScore, thresholds })
      : policy.manualOpenOverride && (!policy.calibrationPassed || !policy.validationPassed)
      ? 'MANUAL_OPEN_OVERRIDE：校准/稳健性验证尚未通过，按人工策略放行 OPEN'
      : sellerDecision.blockedBy.includes('CALIBRATION_PENDING')
      ? 'CALIBRATION_PENDING：主许可 walk-forward 尚未通过，最多 WATCH'
      : sellerDecision.blockedBy.includes('VALIDATION_PENDING')
        ? 'VALIDATION_PENDING：SPY 稳健性验证尚未通过，最多 WATCH'
      : finalAction === 'BLOCK'
      ? stockActionReason(finalAction, sellerEdgeScore, { hardGate: preTradeGate.hard_gates[0], globalAction: global.action, riskScore: global.riskScore, thresholds })
      : sellerDecision.promotionSource === 'WATCH_TRIGGER'
        ? `连续 ${sellerDecision.watchStreak}/2 个快照满足 WATCH 回撤触发 → WATCH`
      : sellerDecision.promotionSource === 'OPEN_TRIGGER'
          ? `连续 ${sellerDecision.openStreak}/2 个快照满足 OPEN 回撤触发 → OPEN`
          : sellerDecision.promotionSource === 'CARRY_OPEN'
            ? `CSP carry ${sellerDecision.selectedSigma ?? '--'}σ 评分 ${sellerDecision.selectedSigma ? getFV<number>(factors, `seller_csp_carry_${String(sellerDecision.selectedSigma).replace('.', '_')}_score`)?.toFixed(0) ?? '--' : '--'} 达标 → OPEN`
          : `事件分 ${getFV<number>(factors, 'seller_event_score')?.toFixed(0) ?? '--'} · 溢价分 ${getFV<number>(factors, 'seller_premium_score')?.toFixed(0) ?? '--'} · Seller Edge ${sellerEdgeScore.toFixed(0)} → ${finalAction}`;
    finalReasons.unshift(actionReason);

    const ivRank = getFV<number>(factors, 'iv_rank');
    const ivRankStr = ivRank != null ? ivRank.toFixed(0) : '--';

    let overallConfidence = (global.confidence + ivOpportunity.confidence) / 2;
    if (shockWeight > 0.5) {
      overallConfidence *= (1 - (shockWeight - 0.5));
    }


    const positionSizing = this.calcPositionSizing(
      global.positionSize,
      getFV<number>(factors, 'vol_premium') ?? 1.0,
      entryRecommendation.entry_score,
      global.regime,
    );

    const { allowed, status: traceStatus } = executionAuthorizationFor(finalAction);

    const execution_trace: StrategyExecutionTrace = {
      stage1_authorization: {
        allowed,
        status: traceStatus,
        reason: finalReasons[0] || '环境符合策略规范',
      },
      stage2_boundaries: {
        putWall: (factors.put_wall?.value as number) || 0,
        expectedMoveLower: globalLower,
        kcLower: entryRecommendation.kc_lower,
        effectiveLower: entryRecommendation.strike_recommendation?.strike || globalLower,
      },
      stage3_targeting: entryRecommendation.strike_recommendation
        ? {
            strike: entryRecommendation.strike_recommendation.strike,
            expiry: entryRecommendation.strike_recommendation.expiry,
            dte: entryRecommendation.strike_recommendation.dte,
            delta: entryRecommendation.strike_recommendation.delta,
            apr: entryRecommendation.strike_recommendation.apr,
            winProb: entryRecommendation.strike_recommendation.winProb ?? 0,
            premium: entryRecommendation.strike_recommendation.premiumPrice,
            score: entryRecommendation.strike_recommendation.rawScore ?? 0,
          }
        : null,
      stage4_sizing: {
        size: positionSizing.size,
        unit: 'Portfolio %',
        logic: `基于 ${global.regime} 环境与 ${entryRecommendation.entry_score} 入场评分动态分配`,
      },
    };

    const analysis: StockDecisionAnalysis = {
      preTradeGate,
      gexStructure,
      ivOpportunity,
      entryRecommendation,
      expectedMoveAnalysis,
      finalAction,
      baseAction: sellerDecision.baseAction,
      promotionSource: sellerDecision.promotionSource,
      selectedSigma: sellerDecision.selectedSigma,
      triggerState: {
        watchCondition: sellerDecision.watchCondition,
        openCondition: sellerDecision.openCondition,
        watchStreak: sellerDecision.watchStreak,
        openStreak: sellerDecision.openStreak,
      },
      tier: sellerEdgeTierFor(sellerEdgeScore)[0],
      conditionScores: {
        macro: {
          score: sellerEdgeScore,
          label: global.action === 'TRADE' ? '市场环境良好' : global.action === 'WAIT' ? '市场观望' : '风险过高',
          detail: `${global.regime} · 风险 ${global.riskScore.toFixed(0)}/100`,
        },
        iv: {
          score: ivOpportunity.score,
          label: ivOpportunity.level === 'RICH' ? '权利金丰厚' : ivOpportunity.level === 'FAIR' ? '权利金适中' : '权利金偏低',
          detail: `IV Rank ${ivRankStr} · ${ivOpportunity.level}`,
        },
        entry: {
          score: entryRecommendation.entry_score,
          label: entryRecommendation.entry_score >= 65 ? '处于支撑区' :
                 entryRecommendation.entry_score >= 40 ? '通道中段' : '偏离支撑',
          detail: `KC ${(entryRecommendation.kc_position * 100).toFixed(0)}% · 下轨 $${entryRecommendation.kc_lower.toFixed(1)}`,
        },
      },
      finalReasons,
      overallConfidence,
      csp_recommendation: entryRecommendation, // 降级兼容
      execution_trace,
      positionSizing,
    };

    return {
      ...system,
      analysis,
    };
  }

  private calcExitRules(
    regime: UnifiedRegime,
    ivOpportunity: 'RICH' | 'FAIR' | 'CHEAP',
    riskScore: number,
    factors: FactorMap,
  ): FinancialFactor<{ type: string; rule: string }[]> {
    const ivRank = getFV<number>(factors, 'iv_rank') ?? 0;
    const atrRatio = getFV<number>(factors, 'atr_ratio') ?? 1.0;
    const vix = getFV<number>(factors, 'iv_override') ?? getFV<number>(factors, 'vix_price') ?? 20;
    const hardRegime = regime === 'BEAR' || regime === 'CRISIS';

    const stopLossMultiplier =
      hardRegime ? 1.5 :
      atrRatio > 1.5 ? 1.5 :
      atrRatio > 1.2 ? 1.75 :
      riskScore > 70 ? 1.5 :
      ivRank > 80 ? 1.75 :
      2.0;

    const profitTarget = (hardRegime || ivRank > 80) ? '40%' : '50%';
    const dteTrigger = vix > 30 ? 28 : vix > 25 ? 25 : 21;

    const regimeExitRule = hardRegime
      ? `Regime Shift: Close 50% high risk pos, clear all within 48h. regime=${regime}`
      : `Hold: ${regime} environment allows holding to target`;

    return this.derived(
      [
        { type: 'Profit', rule: `${profitTarget} Profit Target${ivOpportunity === 'RICH' ? ' (Premium Rich priority)' : ''}` },
        { type: 'Loss', rule: `${stopLossMultiplier}x Premium Stop Loss (ATR_ratio=${atrRatio.toFixed(2)})` },
        { type: 'DTE', rule: `Assess roll or close ${dteTrigger} days before expiry` },
        { type: 'Regime', rule: regimeExitRule },
      ],
      [
        { factorId: 'real_risk', weight: 1.0 },
      ],
      factors,
    );
  }
}

export const decisionEngine = new DecisionEngine();
