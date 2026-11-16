import type { MarketInput, OptionPosition, CSBreachState, CSEventRiskState } from './input';
import type { BearMarketPhase, CrisisPhase, MarketRegime, OverlayAction, TrendSignal } from './output';
import type { FactorMap } from '../../../../types/factor';
import type { FinancialFactor } from '../../../../types/factor';
import type { LeveragedOverlayStockPolicy } from '../stock-policy';
import type { CSSurvivalPriceSelectionMode, CSSurvivalSelectionDistanceMode, CSSurvivalSelectionStateMode, CSSurvivalSelectionWidthMode, CSSecondaryCoverageExitProfile, CSSecondaryCoverageTier, PCSPressureSizingMode, PCSSurvivalPriceSelectionMode, PCSSurvivalSelectionDteMode, PCSSurvivalSelectionObjective, PCSSurvivalSelectionSigmaMode, PCSSurvivalSelectionWidthMode } from './params';

export type EngineStatus = 'PASS' | 'WARN' | 'BLOCK' | 'ERROR';

export type EngineResult<T> = {
  engineId: string;
  status: EngineStatus;
  data: T;
  warnings: string[];
  blockers: string[];
};

// ── per-engine data shapes ──────────────────────────────────────────────────

export type DataQualityData = {
  qqq_bars: number;
  tqqq_bars: number;
  latest_date: string;
  missing_fields: string[];
  fallbacks_applied: string[];
};

export type HardRiskData = {
  tqqq_current_pct: number;
  max_tqqq_allowed_pct: number;
  leverage_ratio: number;
  in_drawdown: boolean;
  drawdown_pct: number;
  constraints: string[];
};

export type RegimeData = {
  regime: MarketRegime;
  rawRegime?: MarketRegime;
  regimeConfirmState?: {
    confirmedRegime: MarketRegime;
    candidateRegime?: MarketRegime;
    candidateBars?: number;
  };
  bearMarketPhase?: BearMarketPhase;
  crisisPhase?: CrisisPhase;
  sma20?: number;
  sma50: number;
  sma200: number;
  price_vs_sma200_pct: number;
  roc5?: number;
  distanceToSma20Pct?: number;
  distanceToSma50Pct?: number;
  vix: number | null;
  confidence: number;
  rsi14?: number;
  adx14?: number;
  range20d_pct?: number;
  ma50_slope_pct?: number;
  sma20_slope_pct?: number;
  vix_change_5d?: number;
  drawdown_from_recent_high_pct?: number;
  price_extension_atr?: number;
  weakening_signal_count?: number;
};

export type TrendData = {
  signal: TrendSignal;
  score: number;
  ema20: number;
  ema50: number;
  ema200: number;
  roc20: number;
  adx: number;
};

export type VolTargetData = {
  tqqq_realized_vol_20d: number;
  /** Research observability: the three window estimates used by the frozen estimator. */
  tqqq_realized_vol_10d?: number;
  tqqq_realized_vol_5d?: number;
  window_vol?: number;
  active_vol?: number;
  effective_vol?: number;
  qqq_er20?: number;
  target_vol: number;
  raw_weight: number;
  capped_weight: number;
  regime_adjusted_weight: number;
};

export type TrendParticipationData = {
  enabled: boolean;
  eligible: boolean;
  qualityOverrideClean?: boolean;
  partialEligible?: boolean;
  partialConfirmed?: boolean;
  partialActive?: boolean;
  confirmed: boolean;
  active: boolean;
  score: number;
  requiredScore: number;
  eligibleStreak: number;
  capacityPct?: number;
  stateCapPct?: number;
  qualityCapPct?: number;
  volTargetPct?: number;
  trendDiscountPct?: number;
  releaseSource?: 'strong' | 'partial_strong' | 'recovery' | 'none';
  baseTargetPct: number;
  releasedTargetPct: number;
  releaseFraction?: number;
  bindingReason: string;
  vetoReason?: string;
  conditionalCapApplied?: number;
  budgetRefillEligible?: boolean;
  budgetRefillActive?: boolean;
  budgetRefillConfiguredPct?: number;
  budgetRefillPreConfirmActive?: boolean;
  budgetRefillPreConfirmConfiguredPct?: number;
  budgetRefillPhase?: 'pre_confirm' | 'confirmed';
  budgetRefillAppliedPct?: number;
  budgetRefillBindingReason?: string;
  budgetRefillNextState?: {
    eligibleStreak: number;
    active: boolean;
  };
  nextState: {
    eligibleStreak: number;
    active: boolean;
    activeBars?: number;
    strongEligibleStreak?: number;
    strongPartialEligibleStreak?: number;
    recoveryEligibleStreak?: number;
  };
};
export type RiskBudgetData = {
  final_tqqq_pct: number;
  final_boxx_pct: number;
  final_cash_pct: number;
  binding_constraint: 'hard_risk' | 'vol_target' | 'trend_discount' | 'trend_participation' | 'conditional_cap' | 'none';
  targetWeightSmoothingState?: {
    smoothedTqqqPct: number;
  };
  pre_smoothing_tqqq_pct?: number;
  // Set by the intraday de-risk gate (06b) when it scales down final_tqqq_pct;
  // preserves the close-based target for UI before/after display.
  pre_gate_tqqq_pct?: number;
  pre_drawdown_governor_tqqq_pct?: number;
  recoveryBoostAppliedPct?: number;
  researchPostParticipationBoostPct?: number;
  researchPostParticipationBoostAllowed?: boolean;
  researchPostParticipationBoostAppliedPct?: number;
  researchStrongGapReleaseAppliedPct?: number;
  researchIndependentTargetBoostAppliedPct?: number;
  trendParticipation?: TrendParticipationData;
};

export type DrawdownGovernorData = {
  triggered: boolean;
  reason: string;
  nav?: number;
  peakNav?: number;
  drawdownPct?: number;
  factor: number;
  matchedDdPct?: number;
  preGovernorTqqqPct?: number;
};

// 2026-07-22 研究专用：tail-risk-early-warning governor（06c），与 DrawdownGovernorData 同构。
export type TailRiskGovernorData = {
  triggered: boolean;
  reason: string;
  factor: number;
  preTailRiskTqqqPct?: number;
  tailRiskActive: boolean;
  tailRiskCooldownBars?: number;
  tailRiskTriggerDate?: string;
};

export type IntradayGateData = {
  triggered: boolean;
  reason: string;                 // why the gate did/didn't fire (diagnostics)
  intradayReturnPct?: number;     // (live - lastCompletedClose) / lastCompletedClose
  keepFactor: number;             // multiplier applied to TQQQ target (1 = untouched)
  matchedDropPct?: number;        // which tier threshold was hit
  preGateTqqqPct?: number;        // close-based TQQQ target before the gate
  refClose?: number;              // last completed daily close used as reference
  livePrice?: number;             // real-time leveraged price
  suggestHedge?: boolean;         // deepest tier hit → recommend adding a hedge
};

export type OverlayProposal = {
  action: OverlayAction;
  /** V2.1.1：当前 CS 是否命中 VXN rescue，以及实际采用的名义仓位倍率。 */
  csVxnRescueSizeMultiplier?: number;
  /** CS 研究路由；secondary_budget 不消费主层 survival/cap 选约。 */
  csRoute?: 'primary' | 'conservative_fallback' | 'secondary_budget';
  /** 高胜率独立覆盖层的 tier；主层 proposal 不设置。 */
  csTier?: CSSecondaryCoverageTier;
  /** 持仓创建时锁定的副层平仓规则；主层不设置。 */
  csExitProfile?: CSSecondaryCoverageExitProfile;
  /** PCS_RESCUE 研究层的实际短腿 Delta 与来源；主 PCS 不设置。 */
  pcsRescueShortDelta?: number;
  pcsRescueDeltaMode?: import('./params').PCSRescueDeltaMode;
  pcsRescueSource?: 'reactive_soft_pool' | 'main_blocked';
  // coveredOverlay: Collar short call is covered by leveraged ETF holdings (no margin)
  // proxyOverlay:   IC / CS are defined-risk spreads on QQQ (independent, no holding required)
  overlay_type?: 'coveredOverlay' | 'proxyOverlay';
  proposed_strikes?: {
    // Collar legs
    put_strike?: number;               // long put (protection top) — leveraged ETF
    put_spread_short_strike?: number;  // short lower put (tail cut-off) — leveraged ETF, 3rd leg
    call_strike?: number;              // short call (upside cap) — leveraged ETF (covered)
    call_symbol?: string;              // which leveraged ETF the call is on (e.g. 'TQQQ')
    put_symbol?: string;               // which symbol put legs use (leveraged ETF or QQQ)
    put_quantity?: number;
    call_quantity?: number;
    // Call credit spread legs (always QQQ)
    spread_short_strike?: number;
    spread_long_strike?: number;
    // Iron Condor legs (always QQQ)
    ic_call_short?: number;
    ic_call_long?: number;
    ic_put_short?: number;
    ic_put_long?: number;
    // Equity Boost Put Spread legs (QQQ, always independent of PCS's spread_* fields)
    eb_short_strike?: number;
    eb_long_strike?: number;
    expiry?: string;
  };
  premium_estimate?: number;          // net debit(-)/credit(+) per contract across all legs
  iron_condor_max_risk_pct?: number;  // IC independent risk budget (not netted against collar)
  cs_max_risk_pct?: number;           // CS independent risk budget (not netted against collar)
  pcsPriceSelection?: {
    mode: Exclude<PCSSurvivalPriceSelectionMode, 'off'>;
    objective: PCSSurvivalSelectionObjective;
    survivalWeight: number;
    wilsonWeight: number;
    conditionalLossCapRatio: number | null;
    tailVetoRatio: number | null;
    dteMode: PCSSurvivalSelectionDteMode;
    targetDte: number;
    widthMode: PCSSurvivalSelectionWidthMode;
    widthPct: number;
    dynamicWidthPct?: number;
    widthBlend?: number;
    widthSwitchMargin?: number;
    widthFallbackUsed?: boolean;
    widthState?: 'stressed' | 'medium' | 'calm';
    sigmaMode: PCSSurvivalSelectionSigmaMode;
    dynamicSigmaActive: boolean;
    floor: number;
    candidateCount: number;
    eligibleCandidates: number;
    tailVetoedCandidates: number;
    creditRetentionFloor?: number | null;
    creditVetoedCandidates?: number;
    selectedSigma: 1 | 1.5 | 2 | 2.5;
    selectedWidthPct?: number | null;
    selectedNoTouch: number | null;
    selectedNoTouchLower: number | null;
    selectedSurvivalForRanking: number | null;
    selectedConditionalTailLoss: number | null;
    selectedConditionalTailLossP75: number | null;
    selectedConditionalTailLossCvar75: number | null;
    selectedConditionalTailLossRatio: number | null;
    selectedConditionalTailDropPct: number | null;
    selectedObjectiveScore: number;
    /** 同一 Sigma 下，动态宽度相对固定宽度的排序分数诊断。 */
    widthSwitchBaselineScore?: number | null;
    widthSwitchCandidateScore?: number | null;
    widthSwitchScoreDelta?: number | null;
    widthSwitchScoreRatio?: number | null;
    widthSwitchAccepted?: boolean;
    pressureSizingMode?: PCSPressureSizingMode;
    pressureSizingMultiplier?: number;
    pressureSizingState?: 'stressed' | 'medium' | 'calm';
  };
  csPriceSelection?: {
    mode: Exclude<CSSurvivalPriceSelectionMode, 'off'>;
    /** 研究路由：主策略选价或非阻断日的保守 fallback。 */
    route?: 'primary' | 'conservative_fallback' | 'secondary_budget';
    fallbackReason?: 'primary_selection_rejected';
    objective: PCSSurvivalSelectionObjective;
    survivalWeight: number;
    wilsonWeight: number;
    floor: number;
    widthMode: CSSurvivalSelectionWidthMode;
    stateMode: CSSurvivalSelectionStateMode;
    stateActive: boolean;
    preCrisisActive?: boolean;
    riskMultiplier?: number;
    candidateCount: number;
    eligibleCandidates: number;
    tailVetoRatio: number | null;
    tailVetoedCandidates: number;
    creditRetentionFloor: number | null;
    creditVetoedCandidates: number;
    distanceMode: CSSurvivalSelectionDistanceMode;
    distanceProfileSigma?: 1.5 | 2 | 2.5;
    switchMargin: number | null;
    minSurvivalLift: number | null;
    switchGuardFallback: boolean;
    selectedDistanceSigma: number;
    selectedShortDelta: number;
    selectedWidthPct: number;
    selectedNoTouch: number | null;
    selectedNoTouchLower: number | null;
    selectedSurvivalForRanking: number | null;
    selectedConditionalTailLoss: number | null;
    selectedConditionalTailLossP75: number | null;
    selectedConditionalTailLossCvar75: number | null;
    selectedObjectiveScore: number;
  };
  collar?: {
    strategyName: string;
    underlying: string;
    quantity: number;
    coveredByShares: boolean;
    coveredSharesRequired: number;
    currentShares: number;
    uncoveredQuantity: number;
  };
  callCreditSpread?: {
    strategyName: string;
    underlying: 'QQQ';
    shortCallStrike: number;
    longCallStrike: number;
    credit?: number;
    maxLoss: number;
    buyingPowerImpact: number;
    riskBudgetUsed?: number;
    quantity?: number;
    vxnRescueSizeMultiplier?: number;
    definedRisk: true;
    proxyOverlay: true;
    notCoveredOverlay: true;
  };
  putCreditSpread?: {
    strategyName: string;
    underlying: 'QQQ';
    shortPutStrike: number;
    longPutStrike: number;
    credit?: number;
    maxLoss: number;
    buyingPowerImpact: number;
    riskBudgetUsed?: number;
    quantity?: number;
    definedRisk: true;
    proxyOverlay: true;
    notCoveredOverlay: true;
  };
  pcsRescuePutSpread?: {
    strategyName: string;
    underlying: 'QQQ';
    shortPutStrike: number;
    longPutStrike: number;
    credit?: number;
    maxLoss: number;
    buyingPowerImpact: number;
    riskBudgetUsed?: number;
    quantity?: number;
    pairSearchUsed?: boolean;
    definedRisk: true;
    proxyOverlay: true;
    notCoveredOverlay: true;
  };
  ironCondor?: {
    strategyName: string;
    underlying: 'QQQ';
    putLongStrike: number;
    putShortStrike: number;
    callShortStrike: number;
    callLongStrike: number;
    totalCredit?: number;
    maxLoss: number;
    buyingPowerImpact: number;
    quantity?: number;
    riskBudgetUsed?: number;
    definedRisk: true;
    proxyOverlay: true;
    notCoveredOverlay: true;
  };
  bearCallSpread?: {
    underlying: 'QQQ';
    proxyOverlay: true;
    requireDefinedRisk: true;
    notCoveredOverlay: true;
    expiry?: string;
    shortCallStrike?: number;
    longCallStrike?: number;
    credit?: number;
    maxLoss?: number;
    buyingPowerImpact?: number;
    riskBudgetUsed?: number;
    definedRisk?: true;
    creditToMaxLoss?: number;
    dte?: number;
    shortCallDelta?: number;
    quantity?: number;
    usedRiskPct?: number;
    newRiskPct?: number;
    totalAfterRiskPct?: number;
    cooldown?: {
      active: boolean;
      daysRemaining: number;
      reason?: string;
    };
    reason: string;
    warnings: string[];
    exitRules: string[];
  };
  bearFactors?: FactorMap;
  equityBoostPutSpread?: {
    strategyName: string;
    underlying: 'QQQ';
    shortPutStrike: number;
    longPutStrike: number;
    credit?: number;
    maxLoss: number;
    buyingPowerImpact: number;
    riskBudgetUsed?: number;
    quantity?: number;
    creditToMaxLoss?: number;
    breakEven?: number;
    dte?: number;
    /** 独立历史回放可用的反事实风险缩放；组合模式通过实际风险预算体现。 */
    riskMultiplier?: number;
    definedRisk: true;
    proxyOverlay: true;
    notCoveredOverlay: true;
  };
};

export type OverlayData = OverlayProposal & {
  /** 回测研究专用：记录 PCS 在选腿后各释放阶段的诊断，不参与交易决策。 */
  pcsGateDiagnostics?: {
    /** 回测研究专用：完整 PCS 准入漏斗，不参与任何交易决策。 */
    safetyPassed?: boolean;
    /** 回测研究专用：安全闸未通过时的可重复子原因。 */
    safetyBlockers?: string[];
    reactiveTimingPassed?: boolean;
    reactiveTimingReasons?: string[];
    originalSignalTriggered?: boolean;
    pageSignalTriggered?: boolean;
    variantBlockers?: string[];
    priorityPassed?: boolean;
    candidateBuildAttempted?: boolean;
    candidateBuilt?: boolean;
    v121StateBlocked: boolean;
    v121SimpleRelease: boolean;
    v121Released: boolean;
    v123BlockedBy?: Array<'A9' | 'B30' | 'C10'>;
    riskEnvelopeBand?: 'FULL' | 'HALF' | 'BLOCK';
    selectedNoTouchLower?: number | null;
    selectedSigma?: 1 | 1.5 | 2 | 2.5;
    pcsRescueEligible?: boolean;
    pcsRescueSource?: import('./params').PCSRescueEntryMode;
    pcsRescueShortDelta?: number;
    pcsRescueShadowP3Path?: { active: boolean; allowed: boolean; probeBuilt: boolean; lower?: number | null; shortStrike?: number; expiry?: string };
  };
  collar_triggered: boolean;
  call_spread_triggered: boolean;
  /** CS 独立副层是否因主层预危机 cap1 阻断而触发。 */
  call_spread_secondary_triggered?: boolean;
  /** 新高胜率覆盖层是否形成候选。 */
  call_spread_coverage_triggered?: boolean;
  /** CS 研究专用：SR 路径风险闸是否阻断新开。 */
  cs_research_entry_gate_blocked?: boolean;
  /** CS 独立副层自己的事件预算状态。 */
  csSecondaryEventRiskState?: CSEventRiskState;
  put_spread_triggered?: boolean;
  /** PCS_RESCUE 独立补位层的来源资格；不代表已实际成交。 */
  pcs_rescue_triggered?: boolean;
  iron_condor_triggered: boolean;
  bear_call_spread_triggered?: boolean;
  equity_boost_triggered?: boolean;
  equity_boost_force_close?: boolean;
  pcsPageSignalRaw?: boolean; // 当日 raw 页面 PCS 信号（persist 门前），simulator 读取以维护 streak
  /** 回测日线准入的唯一事实来源；页面不得据市场状态重新拼出资格分。 */
  strategyAdmissions?: Array<{
    strategyTag: 'QQQ_PUT_CREDIT_SPREAD' | 'QQQ_EQUITY_BOOST_PUT_SPREAD' | 'QQQ_PCS_RESCUE';
    strategyLabel: 'PCS' | 'EB' | 'PCS_RESCUE';
    eligibility: 'OPEN' | 'BLOCK';
    reasons: string[];
    gates: Array<{
      label: '安全闸' | '策略信号' | '变体专属闸' | '同日优先级' | '候选可构建';
      status: 'PASS' | 'BLOCK' | 'UNAVAILABLE';
      detail: string;
    }>;
  }>;
  overlayProposals?: OverlayProposal[];
  collarEligibility?: {
    eligible: boolean;
    reason: string;
    scenario?: 'overheat' | 'weakening' | 'alternative_to_sell' | 'drawdown' | 'vix_spike' | 'backwardation';
    currentLeveragedWeight: number;
    targetLeveragedWeight: number;
    hasActiveCollar: boolean;
    hasActiveCollarProtection?: boolean;
    hasActiveCollarShortCall?: boolean;
    hasActiveQQQCallSpread: boolean;
  };
  preferredAction?: string;   // 'SELL_TQQQ' — suggested primary action when collar is alternative
  alternativeAction?: string; // 'OPEN_PUT_SPREAD_COLLAR' — collar as secondary option
  csBreachState?: CSBreachState;
};

export type ConflictData = {
  conflicts: Array<{
    field: string;
    engine_a: string;
    value_a: string;
    engine_b: string;
    value_b: string;
    resolution: string;
  }>;
  any_conflict: boolean;
};

export type ExecutionGuardData = {
  approved: boolean;
  requires_margin_check: boolean;
  pending_expirations: OptionPosition[];
  trade_delta_too_small: boolean;
  approved_proposal_types: ('equity' | 'option')[];
  rejection_reasons: string[];
};

// ── pipeline context ────────────────────────────────────────────────────────

export type PipelineContext = {
  input: MarketInput;
  currentFlashCrashState?: NonNullable<MarketInput['flashCrashState']>;
  // 2026-07-22 研究专用 tail-risk-early-warning state（见 crisis-state-machine.ts updateTailRiskState）
  currentTailRiskState?: NonNullable<MarketInput['tailRiskState']>;
  stockPolicy?: FinancialFactor<LeveragedOverlayStockPolicy>;
  results: {
    dataQuality?:    EngineResult<DataQualityData>;
    hardRisk?:       EngineResult<HardRiskData>;
    regime?:         EngineResult<RegimeData>;
    trend?:          EngineResult<TrendData>;
    volTarget?:      EngineResult<VolTargetData>;
    riskBudget?:     EngineResult<RiskBudgetData>;
    drawdownGovernor?: EngineResult<DrawdownGovernorData>;
    tailRiskGovernor?: EngineResult<TailRiskGovernorData>;
    intradayGate?:   EngineResult<IntradayGateData>;
    overlay?:        EngineResult<OverlayData>;
    conflicts?:      EngineResult<ConflictData>;
    executionGuard?: EngineResult<ExecutionGuardData>;
  };
};

export function isUpstreamBlocked(ctx: PipelineContext): boolean {
  return Object.values(ctx.results).some(
    r => r?.status === 'BLOCK' || r?.status === 'ERROR'
  );
}
