import type { OverlayProposal } from './pipeline';
import type { OverlayStrategyTag } from '../constants';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'VWAP';
export type Urgency = 'IMMEDIATE' | 'SAME_DAY' | 'NEXT_SESSION';

export type MarketEnvironmentSnapshot = {
  regime: MarketRegime;
  /** Research diagnostics: raw classifier output before confirmation. */
  rawRegime?: MarketRegime;
  /** Research diagnostics: pending regime candidate and its confirmation streak. */
  candidateRegime?: MarketRegime;
  candidateBars?: number;
  bearMarketPhase?: BearMarketPhase;
  crisisPhase?: CrisisPhase;
  trend: TrendSignal;
  macroRegime?: string;
  slowSubregime?: string;
  slowSubregimePosterior?: number;
  slowSubregimeHealth?: string;
  flashCrashOverrideActive?: boolean;
  vix?: number;
  vixTermStructureSlope?: number;
  tqqqRealisedVol20d: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  roc5?: number;
  distanceToSma20Pct?: number;
  distanceToSma50Pct?: number;

  // Extended indicators
  rsi14?: number;
  adx14?: number;
  range20dPct?: number;
  priceVsSma200Pct?: number;
  ma50SlopePct?: number;
  sma20SlopePct?: number;
  vixChange5d?: number;
  drawdownFromRecentHighPct?: number;
  priceExtensionAtr?: number;
  qqqEr20?: number;
  weakeningSignalCount?: number;
  roc20?: number;
  /** TQQQ 20 日动量；CS 状态化退出使用，和 QQQ trend.roc20 分开。 */
  tqqqRoc20?: number;
  /** CS 研究诊断：低 VIX、高 TQQQ realized vol 的预危机窗口。 */
  csPreCrisisActive?: boolean;
  /** CS 研究诊断：预危机窗口实际使用的风险缩放倍数。 */
  csEventRiskMultiplier?: number;
  trendScore?: number;

  navDrawdownGovernorTriggered?: boolean;
  navDrawdownGovernorFactor?: number;
  navDrawdownPct?: number;

  // Intraday signals
  intradayReturnPct?: number;
  intradayDeRiskTriggered?: boolean;
  intradayDeRiskFactor?: number;
  intradayMatchedDropPct?: number;
};

export type EquityOrder = {
  kind: 'equity';
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  limitPrice?: number;
  urgency: Urgency;
  rationale: string;
  executionReason?: string;
  executionReasonKey?: string;
  /** Effective executable target after upstream block / hard-risk override. */
  targetPct?: number;
};

export type OptionOrder = {
  kind: 'option';
  symbol: string;
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  side: OrderSide;
  quantity: number;
  limitPrice?: number;
  urgency: Urgency;
  rationale: string;
  strategyName?: string;
  strategyTag?: OverlayStrategyTag;
  groupId?: string;
  legRole?: 'long_put' | 'short_put' | 'short_call' | 'long_call';
  definedRisk?: boolean;
  proxyOverlay?: boolean;
  notCoveredOverlay?: boolean;
  coveredByShares?: boolean;
  coveredSharesRequired?: number;
  currentShares?: number;
  uncoveredQuantity?: number;
  maxLoss?: number;
  buyingPowerImpact?: number;
  riskBudgetUsed?: number;
  credit?: number;
  executionReason?: string;
  executionReasonKey?: string;
  outcomeReason?: string;
  outcomeReasonKey?: string;
};

export type OrderProposal = EquityOrder | OptionOrder;

export type CrisisPhase = 'NONE' | 'PENDING' | 'CONFIRMED' | 'RECOVERY';
export type MarketRegime = 'BULL' | 'RISK_ON_EXTENDED' | 'RISK_ON_WEAKENING' | 'SIDEWAYS' | 'BEAR' | 'CRISIS' | 'RANGE_BOUND';
export type BearMarketPhase = 'BEAR_TREND' | 'BEAR_RALLY' | 'BEAR_ACCELERATION' | 'CRISIS';
export type TrendSignal = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
export type OverlayAction =
  | 'NONE'
  | 'ADD_COLLAR'
  | 'ADD_CALL_SPREAD'
  | 'ADD_PUT_CREDIT_SPREAD'
  | 'REDUCE_EXISTING'
  | 'ADD_IRON_CONDOR'
  | 'OPEN_BEAR_CALL_SPREAD'
  | 'CLOSE_BEAR_CALL_SPREAD'
  | 'SKIP_BEAR_CALL_SPREAD'
  | 'REVIEW_BEAR_CALL_SPREAD'
  | 'ADD_EQUITY_BOOST_PUT_SPREAD'
  | 'ADD_PCS_RESCUE';

type SystemOverlayOutput = Pick<OverlayProposal,
  | 'action'
  | 'overlay_type'
  | 'proposed_strikes'
  | 'premium_estimate'
  | 'iron_condor_max_risk_pct'
  | 'cs_max_risk_pct'
  | 'collar'
  | 'callCreditSpread'
  | 'putCreditSpread'
  | 'pcsRescuePutSpread'
  | 'ironCondor'
  | 'bearCallSpread'
  | 'pcsPriceSelection'
  | 'equityBoostPutSpread'
> & {
  pcsGateDiagnostics?: {
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
  description?: string;
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
  overlayProposals?: OverlayProposal[];
  strategyAdmissions?: import('./pipeline').OverlayData['strategyAdmissions'];
  preferredAction?: string;
  alternativeAction?: string;
};

export type SystemOutput = {
  timestamp: string;
  decisionDate?: string; // API route 的决策日期；引擎本身不生成该字段
  priceDate?: string;   // last bar date of QQQ price data (may lag by 1 day on weekends/pre-market)
  systemStatus: 'ACTIVE' | 'DEGRADED' | 'RISK_OFF' | 'DATA_ERROR';
  stockPolicyId?: import('../stock-policy').LeveragedOverlayStockPolicyId;
  reasonKeys?: string[];
  macroClassifier?: import('./params').MacroRegimeClassifier;
  bindingConstraint?: import('./pipeline').RiskBudgetData['binding_constraint'];

  currentState: MarketEnvironmentSnapshot & {
    leveragedSpot?: number;
    currentLeveragedPrice?: number;
  };

  targetAllocation: {
    boxxPct: number;
    tqqqPct: number;
    cashPct: number;
  };

  currentAllocation: {
    boxxPct: number;
    tqqqPct: number;
    cashPct: number;
  };

  proposals: OrderProposal[];

  overlay: SystemOverlayOutput;

  pipeline: Record<string, unknown>;
  blockers: string[];
  warnings: string[];
};
