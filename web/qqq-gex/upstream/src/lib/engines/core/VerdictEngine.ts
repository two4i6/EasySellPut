import { FactorEngine } from '../../FactorEngine';
import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { type UnifiedRegime, unifiedRegimeEngine } from '../regime/UnifiedRegimeEngine';
import { getLeveragedOverlayRisk, type LeveragedOverlayRiskInterpretation } from '../leveraged-overlay/stock-policy';
import type { HMMResult } from '../regime/HMMRegimeEngine';
import { gexStructureEngine } from '../structure/GEXStructureEngine';
export { type UnifiedRegime };
import { createDerivedFactor, auditConfidence, getFactorValue as getFV } from '../../factor';
import type { UnifiedScore } from '../../../types/score';
import {
  QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF,
  QQQ_INTRADAY_DIRECTIONAL_POLICY,
  qqqDirectionalClampConfidence,
  qqqDirectionalDataBlockers,
  qqqDirectionalFactorValue,
  type QqqIntradayPlaybook,
  type QqqIntradayDirectionalReasonCode,
  type QqqIntradayDirectionalVerdict,
  type QqqIntradaySignalIntent,
  type QqqIntradayRegime,
} from '../analysis/QqqIntradayDirectional';


// ─── Pipeline Debug Utility ─────────────────────────────────────────────────
const _DP = typeof process !== 'undefined' && process.env.DEBUG_PIPELINE === '1';
function _dbg(tag: string, ...args: unknown[]) {
  if (_DP) console.log(`[${tag}]`, ...args);
}
// ────────────────────────────────────────────────────────────────────────────

// --- Base Type Definitions ---
export type VerdictAction = 'TRADE' | 'WAIT' | 'REDUCE' | 'EXIT';
export type StrategyType = 'PutCreditSpread' | 'CashSecuredPut' | 'IronCondor' | 'CallCreditSpread';

export interface TriggerLeaf {
  id: string;
  factorId: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | 'crossAbove' | 'crossBelow';
  targetValue: number;
  targetFactorId?: string;
  description: string;
  minConfirmBars: number;
}

export interface TriggerGroup {
  id: string;
  logic: 'AND' | 'OR';
  conditions: TriggerCondition[];
  description: string;
  minConfirmBars: number;
}

export type TriggerCondition = TriggerLeaf | TriggerGroup;

export function isTriggerGroup(c: TriggerCondition): c is TriggerGroup {
  return 'logic' in c;
}

export function isTriggerLeaf(c: TriggerCondition): c is TriggerLeaf {
  return 'operator' in c;
}

export type EnrichedTrigger = TriggerCondition & {
  currentValue: number;
  progress: number;      // 0.0 - 1.0
  remainingBars: number; // bars remaining for confirmation
  isMet: boolean;
};

export type TriggerState = Record<string, { satisfiedBars: number; met: boolean }>;
export type VerdictTrigger = string | EnrichedTrigger;

export interface AlternativeAdvice {
  sellerEdge: 'yes' | 'no';
  buyerEdge: 'yes' | 'no';
  note?: string;
}

export interface StrategyNarrative {
  sellSide: string;
  buySide: string;
  bias: string;
}

export type { LeveragedOverlayRiskInterpretation } from '../leveraged-overlay/stock-policy';

// --- Analysis Layer Interfaces (Explain Layer) ---
export type TimingTag = 
  | 'TREND_BULL' | 'TREND_BEAR' | 'TREND_WEAK'
  | 'OVEREXTENDED_UP' | 'OVEREXTENDED_DOWN'
  | 'VWAP_LOST' | 'VWAP_HELD'
  | 'VOLUME_DUMP' | 'VOLUME_EXPANSION' | 'WEAK_RALLY' | 'SELLING_EXHAUSTION'
  | 'BB_EXTREME_HIGH' | 'BB_EXTREME_LOW';

export type RiskTag = 
  | 'VIX_HIGH' | 'VIX_EXTREME'
  | 'VOL_EXPANSION' | 'VOL_SHOCK'
  | 'EXTREME_EXTENSION' | 'HIGH_EXTENSION'
  | 'TREND_BREAKDOWN'
  | 'SYSTEMIC_SELLING'
  | 'RISK_SPIKE' | 'CRASH_RISK' | 'SYSTEMIC_RISK'
  | 'NEGATIVE_GAMMA' | 'FLIP_ZONE' | 'BELOW_GAMMA_FLIP' | 'GEX_INVERSION';

export type TimingState = 'STRONG' | 'NEUTRAL' | 'WEAK' | 'BEARISH';
export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface TimingAnalysis extends UnifiedScore<TimingTag> {
  state: TimingState;
  details: {
    rsi: number;
    priceExtension: number;
    roc5d: number;
    trendQuality: number;
  };
  reasons: string[];
}

export interface RiskContributor {
  score: number;
  weight: number;
  impact: number;
}

export interface RiskAnalysis extends UnifiedScore<RiskTag> {
  contributors: {
    system: RiskContributor;
    volatility: RiskContributor;
    extension: RiskContributor;
    regime: RiskContributor;
  };
  details: {
    vix: number;
    atrRatio: number;
    riskDelta: number;
    isVolShock: boolean;
    isRegimeShift: boolean;
    gexState: 'positive' | 'negative' | 'flip_zone';
    priceVsFlip: 'above' | 'below' | 'at';
    inversion: boolean;
  };
  reasons: string[];
}

// --- Final Output Structure (GlobalVerdict) ---
export interface GlobalVerdict {
  action: 'TRADE' | 'WAIT' | 'REDUCE' | 'EXIT';
  regime: UnifiedRegime;
  market_regime: 'range' | 'trend' | 'volatile' | 'compressed';
  volatility_state: 'low' | 'normal' | 'high';
  overall_bias: 'bullish' | 'bearish' | 'neutral';
  tradability: 'allowed' | 'restricted' | 'avoid';
  market_quality: 'high' | 'medium' | 'low';
  riskAdjustedSize: number;         // 0–1, 纯风险维度，不含 IV 调整
  riskScore: number;                // 0–100
  hmmRegime?: {
    p_bull: number;
    p_neutral: number;
    p_bear: number;
    logScore: number;
    state: 'BULL' | 'NEUTRAL' | 'BEAR';
  };
  triggers: VerdictTrigger[];       // CONFIDENCE_GATE, VOL_SHOCK, enriched recovery triggers, etc.
  confidence: number;               // 0–10
  timing: TimingAnalysis;
  risk: RiskAnalysis;
  alternativeAdvice?: AlternativeAdvice;
  strategyNarrative?: StrategyNarrative;
  edgeConfidence?: number;
  triggerState: TriggerState;
}

// Old VerdictValue is deprecated and replaced by GlobalVerdict in the refactor plan.
// We keep some internal analysis types for the implementation of getVerdict.

export const STRATEGY_PERMISSION: Record<UnifiedRegime, StrategyType[]> = {
  BULL:            ['PutCreditSpread', 'CashSecuredPut'],
  SIDEWAYS_STRONG: ['PutCreditSpread', 'IronCondor', 'CashSecuredPut'],
  SIDEWAYS_WEAK:   ['IronCondor', 'CallCreditSpread'],
  BEAR:            ['CallCreditSpread'],
  CRISIS:          [],
};

const ALL_RECOVERY_TRIGGERS: Record<string, TriggerCondition> = {
  'confidence_recovery': {
    id: 'confidence_recovery',
    logic: 'AND',
    description: 'Waiting for data confidence recovery (iv_rank / vol_premium / atr_ratio / price_ext confidence ≥ 4)',
    minConfirmBars: 1,
    conditions: [
      { id: 'iv_rank_confidence', factorId: 'iv_rank', operator: '>=', targetValue: 4, description: 'IV Rank confidence ≥ 4', minConfirmBars: 1 },
      { id: 'vol_premium_confidence', factorId: 'vol_premium', operator: '>=', targetValue: 4, description: 'Vol Premium confidence ≥ 4', minConfirmBars: 1 },
      { id: 'atr_ratio_confidence', factorId: 'atr_ratio', operator: '>=', targetValue: 4, description: 'ATR Ratio confidence ≥ 4', minConfirmBars: 1 },
      { id: 'price_ext_confidence', factorId: 'price_extension', operator: '>=', targetValue: 4, description: 'Price Extension confidence ≥ 4', minConfirmBars: 1 }
    ]
  },
  'critical_recovery': {
    id: 'critical_recovery',
    logic: 'AND',
    description: 'Waiting for critical risk resolution (VIX < 45 + Risk < 70 + Extension < 1.8σ)',
    minConfirmBars: 3,
    conditions: [
      { id: 'vix_critical_recovery', factorId: 'vix_price', operator: '<', targetValue: 45, description: 'VIX below 45', minConfirmBars: 3 },
      { id: 'real_risk_critical_recovery', factorId: 'real_risk', operator: '<', targetValue: 70, description: 'Risk score below 70', minConfirmBars: 3 },
      { id: 'price_ext_critical_recovery', factorId: 'price_extension', operator: '<', targetValue: 1.8, description: 'Price extension below 1.8σ', minConfirmBars: 3 }
    ]
  },
  'vol_recovery': { id: 'vol_recovery', factorId: 'atr_ratio', operator: '<', targetValue: 1.1, description: 'Waiting for volatility convergence', minConfirmBars: 3 },
  'risk_recovery': { id: 'risk_recovery', factorId: 'real_risk', operator: '<', targetValue: 55, description: 'Waiting for risk reduction', minConfirmBars: 2 },
  'divergence_recovery': {
    id: 'divergence_recovery',
    factorId: 'rsi_7',
    operator: '>=',
    targetValue: 0,
    targetFactorId: 'rsi_21',
    description: 'Waiting for RSI realignment (Short-term RSI above Medium-term)',
    minConfirmBars: 1,
  },
  'macd_recovery': {
    id: 'macd_recovery',
    factorId: 'macd_momentum_strength',
    operator: '>=',
    targetValue: 0,
    description: 'Waiting for MACD momentum recovery (Continuous expansion)',
    minConfirmBars: 2,
  },
  'iv_recovery': {
    id: 'iv_recovery',
    factorId: 'vol_premium',
    operator: '>=' as const,
    targetValue: 1.0,
    description: 'Waiting for IV expansion (vol_premium ≥ 1.0)',
    minConfirmBars: 2,
  },
  'regime_shift_recovery': {
    id: 'regime_shift_recovery',
    logic: 'AND' as const,
    description: 'Waiting for regime stabilization (VIX term ratio recovery + Risk reduction)',
    minConfirmBars: 3,
    conditions: [
      {
        id: 'term_structure_recovery',
        factorId: 'vix_term_ratio',
        operator: '>=' as const,
        targetValue: 0.95,
        description: 'VIX term ratio recovery (≥ 0.95)',
        minConfirmBars: 3,
      },
      {
        id: 'risk_stabilize',
        factorId: 'real_risk',
        operator: '<' as const,
        targetValue: 55,
        description: 'Risk score below 55',
        minConfirmBars: 3,
      },
    ],
  }
};

export class VerdictEngine extends FactorEngine {
  public getQqqIntradayDirectionalVerdict(factors: FactorMap): FinancialFactor<QqqIntradayDirectionalVerdict> {
    const regime = qqqDirectionalFactorValue<QqqIntradayRegime>(factors, QDF.regime, 'UNAVAILABLE');
    const dataBlockers = qqqDirectionalDataBlockers(factors);
    const inWindow = qqqDirectionalFactorValue(factors, QDF.alertWindow, false);
    const intent = qqqDirectionalFactorValue<QqqIntradaySignalIntent>(factors, QDF.sessionIntent, 'ENTRY');
    const base = (
      status: QqqIntradayDirectionalVerdict['status'],
      playbook: QqqIntradayPlaybook | null,
      grade: QqqIntradayDirectionalVerdict['grade'],
      signalIntent: QqqIntradaySignalIntent | null,
      direction: QqqIntradayDirectionalVerdict['direction'],
      stage: QqqIntradayDirectionalVerdict['stage'],
      riskSide: QqqIntradayDirectionalVerdict['riskSide'],
      reasonCodes: QqqIntradayDirectionalReasonCode[],
      confidence: number,
    ): QqqIntradayDirectionalVerdict => ({
      status,
      regime,
      playbook,
      grade,
      intent: signalIntent,
      direction,
      stage,
      riskSide,
      confidence: qqqDirectionalClampConfidence(confidence),
      reasonCodes,
    });
    const inputs = [
      QDF.dataReady, QDF.alertWindow, QDF.sessionIntent, QDF.regime, QDF.etMinute, QDF.directionalBias,
      QDF.supportCount, QDF.resistanceCount, QDF.longReclaim, QDF.shortReclaim,
      QDF.longSweepReclaim, QDF.shortSweepReclaim, QDF.rsiLongTurn, QDF.rsiShortTurn,
      QDF.rsiLongStep, QDF.rsiShortStep, QDF.volumeRatio, QDF.volumeBreakout,
      QDF.longVolumeOk, QDF.shortVolumeOk, QDF.longGexOk, QDF.shortGexOk,
      QDF.longWallOk, QDF.shortWallOk, QDF.longStructureR, QDF.shortStructureR,
      QDF.longZoneDistanceAtr, QDF.shortZoneDistanceAtr,
      QDF.momentumCount, QDF.momentumDistanceAtr, QDF.momentumLongConfirm, QDF.momentumShortConfirm,
      QDF.momentumLongStructureR, QDF.momentumShortStructureR,
      QDF.scRiskElevated, QDF.spRiskElevated, QDF.scStopRisk, QDF.spStopRisk,
      QDF.entryBudgetReached, QDF.riskCueBudgetReached, QDF.rearmSuppressed,
    ].filter((id) => factors[id]?.confidence && factors[id]!.confidence > 0);
    const wrap = (value: QqqIntradayDirectionalVerdict) => this.derived(
      value,
      inputs.map((factorId) => ({ factorId, weight: 1 / inputs.length })),
      factors,
      '冻结 qqq-directional-intraday-v5 分级机会与确认裁决；下午只输出条件式人工风险提示，不推断持仓或平仓',
    );

    if (dataBlockers.length > 0) return wrap(base('BLOCKED', null, null, intent, null, null, null, dataBlockers, 0));
    if (!inWindow) return wrap(base('BLOCKED', null, null, intent, null, null, null, ['OUTSIDE_ALERT_WINDOW'], 0));
    if (intent === 'ENTRY' && qqqDirectionalFactorValue(factors, QDF.entryBudgetReached, false)) {
      return wrap(base('WATCH', null, null, intent, null, null, null, ['ENTRY_SIGNAL_BUDGET_REACHED'], 2));
    }
    if (intent === 'RISK_CUE' && qqqDirectionalFactorValue(factors, QDF.riskCueBudgetReached, false)) {
      return wrap(base('WATCH', null, null, intent, null, null, null, ['RISK_CUE_BUDGET_REACHED'], 2));
    }
    if (regime === 'UNAVAILABLE') return wrap(base('WATCH', null, null, intent, null, null, null, ['TRANSITION_REGIME'], 2));

    const bias = qqqDirectionalFactorValue<'LONG' | 'SHORT' | 'NEUTRAL'>(factors, QDF.directionalBias, 'NEUTRAL');
    if (intent === 'RISK_CUE') {
      const scStop = qqqDirectionalFactorValue(factors, QDF.scStopRisk, false);
      const spStop = qqqDirectionalFactorValue(factors, QDF.spStopRisk, false);
      const scElevated = qqqDirectionalFactorValue(factors, QDF.scRiskElevated, false);
      const spElevated = qqqDirectionalFactorValue(factors, QDF.spRiskElevated, false);
      const chooseSc = (sc: boolean, sp: boolean) => sc && (!sp || bias !== 'SHORT');
      if (scStop || spStop) {
        const sc = chooseSc(scStop, spStop);
        return wrap(base(
          sc ? 'LONG' : 'SHORT', 'DIRECTIONAL_WATCH', null, intent,
          sc ? 'LONG' : 'SHORT', 'STOP_RISK', sc ? 'SC' : 'SP',
          ['AFTERNOON_RISK_CUE', 'RISK_ELEVATED', 'STOP_RISK_CONFIRMED'], 7,
        ));
      }
      if (scElevated || spElevated) {
        const sc = chooseSc(scElevated, spElevated);
        return wrap(base(
          'WATCH', 'DIRECTIONAL_WATCH', null, intent,
          sc ? 'LONG' : 'SHORT', 'RISK_ELEVATED', sc ? 'SC' : 'SP',
          ['AFTERNOON_RISK_CUE', 'RISK_ELEVATED'], 4.5,
        ));
      }
      return wrap(base('WATCH', 'DIRECTIONAL_WATCH', null, intent, null, null, null, ['NO_RISK_STRUCTURE'], 3));
    }

    const range = regime === 'RANGE';
    const playbook: QqqIntradayPlaybook = range ? 'RANGE_REVERSAL' : 'TREND_PULLBACK';
    const evaluate = (direction: 'LONG' | 'SHORT', grade: 'A' | 'B') => {
      const long = direction === 'LONG';
      const reasons: QqqIntradayDirectionalReasonCode[] = [];
      const trendAligned = range || (long ? regime === 'TREND_UP' : regime === 'TREND_DOWN');
      if (!trendAligned) reasons.push('COUNTER_TREND_BLOCKED');
      const confluence = qqqDirectionalFactorValue(factors, long ? QDF.supportCount : QDF.resistanceCount, 0);
      if (confluence < 2) reasons.push('NO_CONFLUENT_ZONE');
      const reclaimed = qqqDirectionalFactorValue(
        factors,
        range
          ? long ? QDF.longSweepReclaim : QDF.shortSweepReclaim
          : long ? QDF.longReclaim : QDF.shortReclaim,
        false,
      );
      if (!reclaimed) reasons.push(range ? 'NO_SWEEP_RECLAIM' : 'NO_TREND_RECLAIM');
      const rsiId = grade === 'A'
        ? long ? QDF.rsiLongTurn : QDF.rsiShortTurn
        : long ? QDF.rsiLongStep : QDF.rsiShortStep;
      if (range && !qqqDirectionalFactorValue(factors, rsiId, false)) reasons.push('RSI_NOT_TURNING');
      const volumeOk = range
        ? grade === 'A'
          ? !qqqDirectionalFactorValue(factors, QDF.volumeBreakout, true)
          : qqqDirectionalFactorValue(factors, QDF.volumeRatio, Number.POSITIVE_INFINITY) < QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeBRangeVolumeRatio
        : qqqDirectionalFactorValue(factors, long ? QDF.longVolumeOk : QDF.shortVolumeOk, false);
      if (!volumeOk) reasons.push('VOLUME_CONFIRMS_BREAKOUT');
      if (!qqqDirectionalFactorValue(factors, long ? QDF.longGexOk : QDF.shortGexOk, false)) reasons.push('GEX_WORSENING');
      if (!qqqDirectionalFactorValue(factors, long ? QDF.longWallOk : QDF.shortWallOk, false)) reasons.push('WALL_BREACHED');
      const minimumR = grade === 'A'
        ? QQQ_INTRADAY_DIRECTIONAL_POLICY.minimumStructureR
        : QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeBMinimumStructureR;
      if (qqqDirectionalFactorValue(factors, long ? QDF.longStructureR : QDF.shortStructureR, 0) < minimumR) {
        reasons.push(grade === 'A' ? 'STRUCTURE_TARGET_BELOW_1_5R' : 'STRUCTURE_TARGET_BELOW_1_25R');
      }
      return { ready: reasons.length === 0, reasons };
    };

    const readyReasons = (grade: 'A' | 'B' | 'C', direction: 'LONG' | 'SHORT'): QqqIntradayDirectionalReasonCode[] => [
      grade === 'A' ? 'GRADE_A_SETUP_READY' : grade === 'B' ? 'GRADE_B_SETUP_READY' : 'GRADE_C_CONTEXT_READY',
      direction === 'LONG' ? 'LONG_SETUP_READY' : 'SHORT_SETUP_READY',
    ];
    const selectReady = (grade: 'A' | 'B', long: ReturnType<typeof evaluate>, short: ReturnType<typeof evaluate>) => {
      if (long.ready && (!short.ready || bias === 'LONG')) return base('LONG', playbook, grade, intent, 'LONG', 'TRIGGERED', null, readyReasons(grade, 'LONG'), grade === 'A' ? 8 : 6.5);
      if (short.ready && (!long.ready || bias === 'SHORT')) return base('SHORT', playbook, grade, intent, 'SHORT', 'TRIGGERED', null, readyReasons(grade, 'SHORT'), grade === 'A' ? 8 : 6.5);
      return null;
    };
    const gradeALong = evaluate('LONG', 'A');
    const gradeAShort = evaluate('SHORT', 'A');
    const gradeA = selectReady('A', gradeALong, gradeAShort);
    if (gradeA) return wrap(gradeA);

    const gradeBLong = evaluate('LONG', 'B');
    const gradeBShort = evaluate('SHORT', 'B');
    const gradeB = selectReady('B', gradeBLong, gradeBShort);
    if (gradeB) return wrap(gradeB);

    const cReasons: QqqIntradayDirectionalReasonCode[] = [];
    const etMinute = qqqDirectionalFactorValue(factors, QDF.etMinute, 0);
    if (intent === 'ENTRY' && etMinute < QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCEarliestEtMinutes) cReasons.push('CANDIDATE_WINDOW_NOT_OPEN');
    if (bias === 'NEUTRAL') cReasons.push('NO_DIRECTIONAL_BIAS');
    if (bias !== 'NEUTRAL') {
      const long = bias === 'LONG';
      if ((regime === 'TREND_UP' && !long) || (regime === 'TREND_DOWN' && long)) cReasons.push('COUNTER_TREND_BLOCKED');
      if (qqqDirectionalFactorValue(factors, QDF.momentumCount, 0) < 2) cReasons.push('NO_CONFLUENT_ZONE');
      if (!qqqDirectionalFactorValue(factors, long ? QDF.longVolumeOk : QDF.shortVolumeOk, false)) cReasons.push('VOLUME_CONFIRMS_BREAKOUT');
      if (!qqqDirectionalFactorValue(factors, long ? QDF.longWallOk : QDF.shortWallOk, false)) cReasons.push('WALL_BREACHED');
      if (qqqDirectionalFactorValue(factors, long ? QDF.momentumLongStructureR : QDF.momentumShortStructureR, 0) < QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCMinimumStructureR) {
        cReasons.push('STRUCTURE_TARGET_BELOW_1R');
      }
    }
    if (cReasons.length === 0 && bias !== 'NEUTRAL') {
      const long = bias === 'LONG';
      const distance = qqqDirectionalFactorValue(
        factors,
        QDF.momentumDistanceAtr,
        Number.POSITIVE_INFINITY,
      );
      const reclaimed = qqqDirectionalFactorValue(
        factors,
        long ? QDF.momentumLongConfirm : QDF.momentumShortConfirm,
        false,
      );
      if (distance > QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCArmDistanceAtr) {
        return wrap(base('WATCH', 'DIRECTIONAL_WATCH', 'C', intent, bias, 'SETUP', null, [
          ...readyReasons('C', bias), 'C_SETUP_READY',
        ], 3.5));
      }
      if (!reclaimed) {
        return wrap(base('WATCH', 'DIRECTIONAL_WATCH', 'C', intent, bias, 'ARMED', null, [
          ...readyReasons('C', bias), 'C_SETUP_READY', 'C_ARMED', 'C_TRIGGER_NOT_CONFIRMED',
        ], 4));
      }
      return wrap(base(bias, 'DIRECTIONAL_WATCH', 'C', intent, bias, 'TRIGGERED', null, [
        ...readyReasons('C', bias), 'C_SETUP_READY', 'C_ARMED',
      ], 5));
    }

    const reasons = [...new Set([
      ...gradeALong.reasons, ...gradeAShort.reasons,
      ...gradeBLong.reasons, ...gradeBShort.reasons,
      ...(regime === 'TRANSITION' ? ['TRANSITION_REGIME' as const] : []),
      ...cReasons,
    ])];
    return wrap(base('WATCH', null, null, intent, null, null, null, reasons.length ? reasons : ['TRANSITION_REGIME'], 3.5));
  }

  public getLeveragedOverlayRisk(factors: FactorMap): FinancialFactor<LeveragedOverlayRiskInterpretation> {
    return getLeveragedOverlayRisk(factors);
  }
  
  
  private analyzeTiming(factors: FactorMap, regime?: UnifiedRegime): TimingAnalysis {
    const rsi     = getFV<number>(factors, 'rsi') ?? 50;
    const priceExt = getFV<number>(factors, 'price_extension') ?? 0;
    const roc5d   = ((factors.price_roc_5d?.confidence ?? 0) > 0 ? getFV<number>(factors, 'price_roc_5d') : 0) ?? 0;
    const trendQual = getFV<number>(factors, 'trend_quality') ?? 50;
    const bbPercentB = getFV<number>(factors, 'bb_percent_b') ?? 0.5;
    const price     = getFV<number>(factors, 'underlying_price') ?? 0;
    const ma200Conf = (factors.ma200?.confidence ?? 0);
    const ma200     = ma200Conf > 0 ? getFV<number>(factors, 'ma200')! : price;
    const ma30Conf  = (factors.ma30?.confidence ?? 0);
    const ma30      = ma30Conf > 0 ? getFV<number>(factors, 'ma30')! : price;
    
    // New indicators for behavior
    const kcUpper = getFV<number>(factors, 'kc_upper') ?? price * 1.05;
    const kcLower = getFV<number>(factors, 'kc_lower') ?? price * 0.95;
    const vwap = getFV<number>(factors, 'vwap') ?? price;
    
    const volume = getFV<number>(factors, 'volume') ?? 0;
    const volumeMa = getFV<number>(factors, 'volume_ma20') ?? volume;
    const isHighVolume = volume > 0 && volumeMa > 0 && (volume > volumeMa * 1.5);
    const isLowVolume = volume > 0 && volumeMa > 0 && (volume < volumeMa * 0.7);
    const priceChange = getFV<number>(factors, 'underlying_change') ?? 0;

    const flags: Partial<Record<TimingTag, boolean>> = {};
    const tags: TimingTag[] = [];
    const addTag = (tag: TimingTag) => { flags[tag] = true; tags.push(tag); };

    // 1) trend_score
    let trend_score = 50 + (rsi - 50) * 0.5 + Math.max(-20, Math.min(20, roc5d * 5));
    if (price > ma200 && ma30 > ma200) { 
      trend_score += 15; 
      addTag('TREND_BULL');
    } else if (price < ma200) { 
      trend_score -= 20; 
      addTag('TREND_BEAR');
    } else {
      addTag('TREND_WEAK');
    }
    
    if (trendQual < 40) {
      trend_score -= 10;
      if (!flags.TREND_BEAR) addTag('TREND_WEAK');
    }

    // 2) behavior_score
    let behavior_score = 50;
    if (price > kcUpper) {
      addTag('OVEREXTENDED_UP');
    } else if (price < kcLower) {
      behavior_score += 10;
      addTag('OVEREXTENDED_DOWN');
    }

    if (price < vwap) {
      behavior_score -= 10;
      addTag('VWAP_LOST');
    } else {
      behavior_score += 5;
      addTag('VWAP_HELD');
    }

    if (priceChange < 0 && isHighVolume) {
      behavior_score -= 20;
      addTag('VOLUME_DUMP');
    } else if (priceChange > 0 && isHighVolume) {
      behavior_score += 15;
      addTag('VOLUME_EXPANSION');
    } else if (priceChange > 0 && isLowVolume) {
      behavior_score -= 10;
      addTag('WEAK_RALLY');
    } else if (priceChange < 0 && isLowVolume) {
      behavior_score += 10;
      addTag('SELLING_EXHAUSTION');
    }

    if (bbPercentB > 0.9) {
      behavior_score -= 10;
      addTag('BB_EXTREME_HIGH');
    } else if (bbPercentB < 0.1) {
      behavior_score += 10;
      addTag('BB_EXTREME_LOW');
    }

    let score = 0.6 * trend_score + 0.4 * behavior_score;

    // Force rules
    if (flags.VOLUME_DUMP) score = Math.min(score, 39);
    if (flags.VWAP_LOST && (flags.TREND_WEAK || flags.TREND_BEAR)) score = Math.min(score, 39);
    if (flags.OVEREXTENDED_UP) score -= 15; // penalty

    score = Math.round(Math.max(0, Math.min(100, score)));
    let state: TimingState = score > 65 ? 'STRONG' : score > 50 ? 'NEUTRAL' : score > 35 ? 'WEAK' : 'BEARISH';
    
    // Level formatting for UnifiedScore
    let level = score > 65 ? 'HIGH' : score > 50 ? 'MEDIUM' : 'LOW';

    const reasons: string[] = [];
    if (flags.VOLUME_DUMP) reasons.push('Volume dumping detected');
    if (flags.VWAP_LOST) reasons.push('Lost VWAP support');
    if (flags.OVEREXTENDED_UP) reasons.push('Overextended upwards');

    // Simple confidence avg
    const confIds = ['rsi', 'price_roc_5d', 'trend_quality'];
    const confs = confIds.map(id => factors[id]?.confidence ?? 0).filter(c => c > 0);
    const confidence = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 5;

    return {
      state,
      score,
      level,
      flags: flags as Record<TimingTag, boolean>,
      confidence,
      tags,
      details: { rsi, priceExtension: priceExt, roc5d, trendQuality: trendQual },
      reasons
    };
  }


  private evaluateCondition(
    cond: TriggerCondition,
    factors: FactorMap,
    prevState: TriggerState
  ): { isSatisfied: boolean; satisfiedBars: number; isMet: boolean } {
    if (isTriggerGroup(cond)) {
      const results = cond.conditions.map(c => this.evaluateCondition(c, factors, prevState));
      const isSatisfied = cond.logic === 'AND'
        ? results.every(r => r.isSatisfied)
        : results.some(r => r.isSatisfied);

      const prevSatisfiedBars = prevState[cond.id]?.satisfiedBars ?? 0;
      const currentSatisfiedBars = isSatisfied ? prevSatisfiedBars + 1 : 0;
      const isMet = currentSatisfiedBars >= cond.minConfirmBars;

      return { isSatisfied, satisfiedBars: currentSatisfiedBars, isMet };
    } else {
      const factor = factors[cond.factorId];
      if (!factor) return { isSatisfied: false, satisfiedBars: 0, isMet: false };

      let val = factor.value as number;
      if (cond.id.endsWith('_confidence')) {
        val = factor.confidence ?? 0;
      }
      
      let targetVal = cond.targetValue;
      if (cond.targetFactorId && factors[cond.targetFactorId]) {
        targetVal = factors[cond.targetFactorId]!.value as number;
      }

      let isSatisfied = false;
      switch (cond.operator) {
        case '>':  isSatisfied = val > targetVal; break;
        case '<':  isSatisfied = val < targetVal; break;
        case '>=': isSatisfied = val >= targetVal; break;
        case '<=': isSatisfied = val <= targetVal; break;
        case '==': isSatisfied = val === targetVal; break;
      }

      const prevSatisfiedBars = prevState[cond.id]?.satisfiedBars ?? 0;
      const currentSatisfiedBars = isSatisfied ? prevSatisfiedBars + 1 : 0;
      const isMet = currentSatisfiedBars >= cond.minConfirmBars;

      return { isSatisfied, satisfiedBars: currentSatisfiedBars, isMet };
    }
  }

  private updateTriggerState(
    activeConditions: TriggerCondition[],
    factors: FactorMap,
    prevState: TriggerState
  ): { newState: TriggerState; enriched: EnrichedTrigger[] } {
    const newState: TriggerState = { ...prevState };
    const enriched: EnrichedTrigger[] = [];

    // Track which IDs we've already processed
    const processedIds = new Set<string>();

    // 1. Process explicitly active conditions
    for (const cond of activeConditions) {
      this.processOneTrigger(cond, factors, prevState, newState, enriched, processedIds);
    }

    // 2. Process everything else that was in prevState to keep it updated
    for (const id in prevState) {
      if (!processedIds.has(id)) {
        const cond = ALL_RECOVERY_TRIGGERS[id];
        if (cond) {
          this.processOneTrigger(cond, factors, prevState, newState, enriched, processedIds);
        }
      }
    }

    return { newState, enriched };
  }

  private processOneTrigger(
    cond: TriggerCondition,
    factors: FactorMap,
    prevState: TriggerState,
    newState: TriggerState,
    enriched: EnrichedTrigger[],
    processedIds: Set<string>
  ) {
    if (processedIds.has(cond.id)) return;
    processedIds.add(cond.id);

    const result = this.evaluateCondition(cond, factors, prevState);
    newState[cond.id] = { satisfiedBars: result.satisfiedBars, met: result.isMet };

    if (isTriggerGroup(cond)) {
      this.populateSubTriggerState(cond, factors, prevState, newState);
    }

    enriched.push({
      ...cond,
      currentValue: isTriggerLeaf(cond) ? (factors[cond.factorId]?.value as number ?? 0) : 0,
      progress: Math.min(1, result.satisfiedBars / (cond.minConfirmBars || 1)),
      remainingBars: Math.max(0, (cond.minConfirmBars || 1) - result.satisfiedBars),
      isMet: result.isMet
    });
  }

  private populateSubTriggerState(group: TriggerGroup, factors: FactorMap, prevState: TriggerState, newState: TriggerState) {
    for (const cond of group.conditions) {
      const result = this.evaluateCondition(cond, factors, prevState);
      newState[cond.id] = { satisfiedBars: result.satisfiedBars, met: result.isMet };
      if (isTriggerGroup(cond)) {
        this.populateSubTriggerState(cond, factors, prevState, newState);
      }
    }
  }

  private calculateEdge(factors: FactorMap, action: VerdictAction, regime: UnifiedRegime) {
    const ivRank = (factors.iv_rank?.value as number) ?? 0;
    const volPremium = (factors.vol_premium?.value as number) ?? 1.0;
    const rsi = (factors.rsi?.value as number) ?? 50;

    const sellerEdge: AlternativeAdvice['sellerEdge'] = (ivRank > 40 || volPremium > 1.1) ? 'yes' : 'no';
    const buyerEdge: AlternativeAdvice['buyerEdge'] = (ivRank < 15 || volPremium < 0.85) ? 'yes' : 'no';

    const alternativeAdvice = {
      sellerEdge,
      buyerEdge,
      note: action === 'WAIT' ? 'Waiting for better IV/Price setup' : undefined
    };

    const strategyNarrative = {
      sellSide: ivRank < 20 ? 'IV low, limited premium' : 'Attractive premium available',
      buySide: rsi < 35 ? 'Oversold, potential bounce' : 'Neutral setup',
      bias: regime === 'BULL' ? 'Bullish bias, prefer put selling' : 'Neutral bias'
    };

    const edgeConfidence = action === 'TRADE' ? 
      ((factors.iv_rank?.confidence ?? 5) + (factors.vol_premium?.confidence ?? 5)) / 2 : 
      2;

    return { alternativeAdvice, strategyNarrative, edgeConfidence };
  }


  public getVerdict(
    factors: FactorMap,
    previousAction?: VerdictAction,
    stableFor: number = 0,
    previousTriggerState: TriggerState = {}
  ): FinancialFactor<GlobalVerdict> {
    _dbg('STAGE', 'getVerdict — GLOBAL VERDICT ONLY');
    const blockedBy: string[] = [];
    const activeConditions: TriggerCondition[] = [];

    // --- 1. Core Factor Extraction ---
    const vix = getFV<number>(factors, 'vix_price') ?? 20;
    const atrRatio = getFV<number>(factors, 'atr_ratio') ?? 1.0;
    const atrPrev = getFV<number>(factors, 'atr_ratio_prev') ?? 1.0;
    const priceExt = getFV<number>(factors, 'price_extension') ?? 0;
    const trendQual = getFV<number>(factors, 'trend_quality') ?? 50;
    const vixTerm = getFV<number>(factors, 'vix_term_ratio') ?? 1.0;
    const vixTermPrev = getFV<number>(factors, 'vix_term_ratio_prev') ?? 1.0;
    const realRiskPrevRaw = getFV<number>(factors, 'real_risk_prev');
    const riskScoreRaw = getFV<number>(factors, 'risk_score') ?? 40;
    const regime = unifiedRegimeEngine.getRegime(factors).value.regime;
    const gexStructure = gexStructureEngine.analyze(factors);

    _dbg('STAGE', 'REAL_RISK_ENGINE');
    
    // --- 2. Risk Model ---
    // GEX 微观结构不进 real_risk（gex-degate 决策）：GEX 历史 OI 不可得，任何进入
    // realRisk≥60/80 硬门的 GEX 分量都会造成 live 与回测裁决分布脱节。GEX 仅作信息展示。
    const weights = { system: 0.38, vol: 0.26, ext: 0.21, trend: 0.15 };

    const rawScores = {
      system: riskScoreRaw,
      vol: atrRatio > 1.4 ? 100 : atrRatio > 1.2 ? 80 : 30,
      ext: Math.abs(priceExt) > 1.8 ? 100 : Math.abs(priceExt) > 1.5 ? 80 : 30,
      trend: trendQual < 40 ? 80 : 30,
    };

    let baseRisk =
      (rawScores.system * weights.system) +
      (rawScores.vol * weights.vol) +
      (rawScores.ext * weights.ext) +
      (rawScores.trend * weights.trend);
    const riskDelta = realRiskPrevRaw !== undefined ? (baseRisk - realRiskPrevRaw) : 0;
    if (riskDelta > 10) { baseRisk = Math.min(100, baseRisk + 15); }
    const realRiskValue = Math.min(100, baseRisk);

    // trend_quality 不作为置信度依赖：个股路径无人生产该因子（缺失会被强制 conf=0，
    // 拖垮 real_risk 触发 CONFIDENCE_GATE），宏观路径也只是硬编码 50 的占位值。
    factors.real_risk = createDerivedFactor(
      realRiskValue,
      [
        { factorId: 'risk_score', weight: 0.45 },
        { factorId: 'atr_ratio', weight: 0.30 },
        { factorId: 'price_extension', weight: 0.25 }
      ],
      factors
    );

    // --- 4. Verdict Logic ---
    const CORE_IDS = ['iv_rank', 'vol_premium', 'atr_ratio', 'price_extension', 'real_risk'];
    const confAudit = auditConfidence(factors, CORE_IDS);
    const avgConfidence = CORE_IDS.reduce((s, id) => s + (factors[id]?.confidence ?? 0), 0) / CORE_IDS.length;

    const shockWeight = (factors.atr_shock_weight?.value as number) || 0;
    const isVolShock = (atrRatio > 1.35 && atrRatio > atrPrev) || shockWeight > 0.6;
    const isRegimeShift = (vixTermPrev > 1 && vixTerm < 0.95);

    let proposedAction: VerdictAction = 'WAIT';
    let riskAdjustedSize = 0;

    const timing = this.analyzeTiming(factors, regime);

    const gateCondA = avgConfidence < 5;
    const gateCondB = confAudit.lowConfidenceFactors.some(id => (factors[id]?.confidence ?? 0) < 4);

    const rsiSlopeValue = (factors.rsi_slope?.value as number) ?? 0;
    const rsiSlopeConf = (factors.rsi_slope?.confidence ?? 0);
    const macdStrengthValue = (factors.macd_momentum_strength?.value as number) ?? 0;
    const macdStrengthConf = (factors.macd_momentum_strength?.confidence ?? 0);

    const volPremium = (factors.vol_premium?.value as number) ?? 1.0;
    // QQQ 日线研究：下行超卖本身不是系统性退出。仍由 VIX、CRISIS、realRisk 等硬条件裁决。
    const qqqRecoveryExtension = getFV<string>(factors, 'symbol') === 'QQQ'
      && getFV<boolean>(factors, 'qqq_daily_model') === true
      && (getFV<number>(factors, 'seller_edge_score') ?? 0) >= 55
      && priceExt < -2
      && factors.vxn_price?.source.type === 'raw'
      && factors.vxn_price.confidence === 10;

    // Gate 1: Confidence Gate
    if (gateCondA || gateCondB) {
      proposedAction = 'WAIT';
      blockedBy.push('CONFIDENCE_GATE');
      activeConditions.push(ALL_RECOVERY_TRIGGERS['confidence_recovery']);
    } 
    // Gate 2: Critical Condition Gate
    // priceExt 只在下行超卖方向触发 EXIT：上行过热对卖方不是系统性退出信号，降级为 Gate 2.5 的 WAIT
    else if (
      vix > 50 ||
      realRiskValue >= 80 ||
      regime === 'CRISIS' ||
      (priceExt < -2.0 && !qqqRecoveryExtension)
    ) {
      proposedAction = 'EXIT';
      blockedBy.push('CRITICAL_BLOCK');
      activeConditions.push(ALL_RECOVERY_TRIGGERS['critical_recovery']);
    }
    // Gate 2.5: 上行过度扩张 —— 追高开 CSP 风险高，观望但不强制清仓
    else if (priceExt > 2.0) {
      proposedAction = 'WAIT';
      blockedBy.push('UPSIDE_EXTENSION');
    }
    // Gate 3: Volatility Shock Lock
    else if (isVolShock) {
      proposedAction = 'WAIT';
      blockedBy.push('VOL_SHOCK');
      activeConditions.push(ALL_RECOVERY_TRIGGERS['vol_recovery']);
    }
    // Gate 4: Risk Control / Regime Shift
    // GEX 状态不参与许可门控也不进 real_risk（不可回测，见 gex-degate 决策）：仅作 risk.tags/details 信息展示
    else if (realRiskValue >= 60 || isRegimeShift) {
      proposedAction = 'REDUCE';
      blockedBy.push('RISK_CONTROL');
      if (realRiskValue >= 60) activeConditions.push(ALL_RECOVERY_TRIGGERS['risk_recovery']);
      if (isRegimeShift) activeConditions.push(ALL_RECOVERY_TRIGGERS['regime_shift_recovery']);
    }
    else {
      // Momentum Factor Extraction
      const rsi7   = (factors.rsi_7?.value as number) ?? 50;
      const rsi14  = (factors.rsi?.value as number) ?? 50;
      const rsi21  = (factors.rsi_21?.value as number) ?? 50;

      // RSI Bearish Divergence
      const isBearishDivergence = regime === 'BULL' && rsi7 < rsi14 && rsi14 < rsi21;
      const isMacdDivergence = (regime === 'SIDEWAYS_STRONG' || regime === 'SIDEWAYS_WEAK') && macdStrengthValue < -0.3;

      if (isBearishDivergence) {
        proposedAction = 'WAIT';
        blockedBy.push('BEARISH_DIVERGENCE');
        activeConditions.push(ALL_RECOVERY_TRIGGERS['divergence_recovery']);
      } else if (isMacdDivergence) {
        proposedAction = 'WAIT';
        blockedBy.push('MACD_DIVERGENCE_PENALTY');
        activeConditions.push(ALL_RECOVERY_TRIGGERS['macd_recovery']);
      } else if (volPremium < 0.9) {
        proposedAction = 'WAIT';
        blockedBy.push('IV_RECOVERY');
        activeConditions.push(ALL_RECOVERY_TRIGGERS['iv_recovery']);
      } else {
        // Global regime/timing based TRADE/WAIT/REDUCE
        if (timing.score >= 60 && (regime === 'BULL' || regime === 'SIDEWAYS_STRONG')) {
          proposedAction = 'TRADE';
          riskAdjustedSize = 0.6; // BULL/SIDEWAYS_STRONG + timing≥60 的基准仓位上限，后续由风险clamp连乘收缩
          
          if (rsiSlopeConf >= 5 && rsiSlopeValue > 0.5 && macdStrengthConf >= 5 && macdStrengthValue > 0.2) {
            blockedBy.push('MOMENTUM_BOOST');
          } else if (rsiSlopeConf >= 5 && rsiSlopeValue < -0.5) {
            blockedBy.push('RSI_SLOPE_WARN');
            riskAdjustedSize *= 0.5;
          }
        } else if (timing.score < 35 || regime === 'BEAR') {
          proposedAction = 'WAIT';
        } else {
          proposedAction = 'WAIT';
          if (volPremium < 1.0) {
             activeConditions.push(ALL_RECOVERY_TRIGGERS['iv_recovery']);
          }
        }
      }
    }

    if (riskDelta > 10 && realRiskPrevRaw !== undefined && proposedAction !== 'EXIT') {
      blockedBy.push('RISK_ACCEL');
      proposedAction = 'REDUCE';
    }

    // --- 5. Debounce Control ---
    let action = proposedAction;
    if (previousAction && action !== previousAction && action !== 'EXIT' && stableFor < 2) {
      action = previousAction;
    }

    // --- 6. Risk Adjusted Size Calculation ---
    if (action === 'TRADE') {
      const clampSize = (v: number, min: number, max: number) => (v <= min ? 1 : v >= max ? 0 : (max - v) / (max - min));
      const volPremium = (factors.vol_premium?.value as number) ?? 1.0;
      
      // HMM Confidence Layer (Option A: Coexistence)
      const hmmResult = factors.hmm_regime?.value as HMMResult | undefined;
      let hmmConfidence = 1.0;
      if (hmmResult) {
        if (regime === 'BULL' && hmmResult.p_bull < 0.3) {
          hmmConfidence = 0.5;
          _dbg('HMM', 'BULL regime but HMM p_bull < 0.3 -> size reduced 50%');
        } else if ((regime === 'SIDEWAYS_STRONG' || regime === 'SIDEWAYS_WEAK') && hmmResult.p_bull > 0.6) {
          hmmConfidence = 1.2;
          _dbg('HMM', 'SIDEWAYS regime but HMM p_bull > 0.6 -> size boosted 20%');
        }
      }

      riskAdjustedSize *=
        clampSize(realRiskValue, 30, 80) *
        clampSize(Math.abs(priceExt), 0.8, 1.8) *
        clampSize(atrRatio, 1.0, 1.4) *
        Math.min(1, volPremium / 1.2) *
        hmmConfidence;
    } else if (action === 'REDUCE') {
      riskAdjustedSize = 0.3;
    } else {
      riskAdjustedSize = 0;
    }
    riskAdjustedSize = Math.max(0, Math.min(1, Math.round(riskAdjustedSize * 100) / 100));

    // Mapping new fields
    let market_regime: GlobalVerdict['market_regime'] = 'range';
    if (atrRatio > 1.5 && regime !== 'CRISIS') market_regime = 'volatile';
    else if (timing.state === 'STRONG' && trendQual > 60) market_regime = 'trend';
    else if (atrRatio < 0.7) market_regime = 'compressed';

    let volatility_state: GlobalVerdict['volatility_state'] = 'normal';
    if (vix > 25) volatility_state = 'high';
    else if (vix < 15) volatility_state = 'low';

    let overall_bias: GlobalVerdict['overall_bias'] = 'neutral';
    if (timing.score > 60) overall_bias = 'bullish';
    else if (timing.score < 40) overall_bias = 'bearish';

    let tradability: GlobalVerdict['tradability'] = 'avoid';
    if (action === 'TRADE') tradability = 'allowed';
    else if (action === 'WAIT') tradability = 'restricted';

    let market_quality: GlobalVerdict['market_quality'] = 'medium';
    if (avgConfidence > 7 && timing.state === 'STRONG') market_quality = 'high';
    else if (avgConfidence < 5 || timing.state === 'BEARISH') market_quality = 'low';

    
    const riskFlags: Partial<Record<RiskTag, boolean>> = {};
    const riskTags: RiskTag[] = [];
    const addRiskTag = (tag: RiskTag) => { riskFlags[tag] = true; riskTags.push(tag); };

    if (vix > 40) addRiskTag('VIX_EXTREME');
    else if (vix > 30) addRiskTag('VIX_HIGH');

    if (atrRatio > 1.4) addRiskTag('VOL_SHOCK');
    else if (atrRatio > 1.2) addRiskTag('VOL_EXPANSION');

    if (Math.abs(priceExt) > 1.8) addRiskTag('EXTREME_EXTENSION');
    else if (Math.abs(priceExt) > 1.5) addRiskTag('HIGH_EXTENSION');

    if (trendQual < 40) addRiskTag('TREND_BREAKDOWN');
    if (timing.tags.includes('VOLUME_DUMP')) addRiskTag('SYSTEMIC_SELLING');
    if (riskDelta > 10) addRiskTag('RISK_SPIKE');
    if (gexStructure.gamma_state === 'negative') addRiskTag('NEGATIVE_GAMMA');
    if (gexStructure.gamma_state === 'flip_zone') addRiskTag('FLIP_ZONE');
    if (gexStructure.price_vs_flip === 'below') addRiskTag('BELOW_GAMMA_FLIP');
    if (gexStructure.inversion) addRiskTag('GEX_INVERSION');

    if (riskFlags.VOL_SHOCK && riskFlags.SYSTEMIC_SELLING) addRiskTag('CRASH_RISK');
    if (riskFlags.VIX_EXTREME) addRiskTag('SYSTEMIC_RISK');

    // Trigger Processing
    const { newState, enriched } = this.updateTriggerState(activeConditions, factors, previousTriggerState);

    const { alternativeAdvice, strategyNarrative, edgeConfidence } = this.calculateEdge(factors, action, regime);

    const finalReasons = blockedBy.map(b => {
      if (b === 'CONFIDENCE_GATE') return '数据置信度不足';
      if (b === 'VOL_SHOCK') return 'Volatility shock lock triggered';
      if (b === 'UPSIDE_EXTENSION') return '上行过度扩张，追高开仓风险高';
      if (b === 'BEARISH_DIVERGENCE') return 'bearish divergence';
      if (b === 'MOMENTUM_BOOST') return 'Momentum Accelerating';
      return b;
    });

    const combinedTriggers = [...blockedBy, ...enriched];

    const value: GlobalVerdict = {
      action,
      regime,
      market_regime,
      volatility_state,
      overall_bias,
      tradability,
      market_quality,
      riskAdjustedSize,
      riskScore: realRiskValue,
      hmmRegime: factors.hmm_regime?.value,
      triggers: combinedTriggers,
      confidence: avgConfidence,
      timing,
      risk: {
        level: realRiskValue >= 80 ? 'extreme' : realRiskValue >= 60 ? 'high' : realRiskValue >= 30 ? 'medium' : 'low',
      score: realRiskValue,
      flags: riskFlags as Record<RiskTag, boolean>,
      tags: riskTags,
      confidence: avgConfidence,
        contributors: {
          system: { score: rawScores.system, weight: weights.system, impact: rawScores.system * weights.system },
          volatility: { score: rawScores.vol, weight: weights.vol, impact: rawScores.vol * weights.vol },
          extension: { score: rawScores.ext, weight: weights.ext, impact: rawScores.ext * weights.ext },
          regime: { score: rawScores.trend, weight: weights.trend, impact: rawScores.trend * weights.trend }
        },
        details: {
          vix,
          atrRatio,
          riskDelta,
          isVolShock,
          isRegimeShift,
          gexState: gexStructure.gamma_state,
          priceVsFlip: gexStructure.price_vs_flip,
          inversion: gexStructure.inversion,
        },
        reasons: finalReasons
      },
      alternativeAdvice,
      strategyNarrative,
      edgeConfidence,
      triggerState: newState
    };

    return this.derived(value, [{ factorId: 'real_risk', weight: 1.0 }], factors);
  }

}

export const verdictEngine = new VerdictEngine();
