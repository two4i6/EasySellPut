import type { MacroExecutionDriver, StrategyParams } from './params';
import type { FactorMap } from '../../../../types/factor';
import type { CrisisPhase, MarketRegime } from './output';
import type { RollingIndicators } from '../utils';
import type { MacroRegimeState } from '../engines/macro-regime-state';
import type { OverlayUniverseId } from '../universe';
import type { CallStrikeSurvivalAsOf, PutStrikeSurvivalAsOf, SellerStatsAsOf } from '../../analysis/SellerStatsEngine';

export type OHLCV = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SplitEvent = {
  date: string;
  numerator: number;
  denominator: number;
  ratio: number;
};

export type OptionContract = {
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  openInterest: number;
  volume: number;
  lastPrice?: number;
  lastTradeDate?: number;
  quoteSource?: 'market' | 'last_trade';
  /** 复权坐标下一张历史合约代表的当前股数。 */
  contractMultiplier?: number;
  /** 开仓日之后的累计拆股因子。 */
  splitAdjustmentFactor?: number;
};

export type OptionChain = {
  symbol: string;
  spot: number;
  timestamp: string;
  expirations: Array<{
    date: string;
    calls: OptionContract[];
    puts: OptionContract[];
  }>;
};

export type OptionPosition = {
  symbol: string;
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  quantity: number;
  marketValue: number;
  delta?: number;
  unrealizedPnl?: number;
  strategyTag?: string;
  groupId?: string;
  side?: 'long' | 'short';
  openedAt?: string;
  creditReceived?: number;
  maxLoss?: number;
  contractMultiplier?: number;
  splitAdjustmentFactor?: number;
};

export type PcsDynamicMarketState = {
  date?: string;
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  vxn?: number;
  tqqqRealisedVol20d?: number;
  qqqROC20?: number;
  qqqROC5?: number;
  vixTermStructureSlope?: number;
  vixChange5d?: number;
  range20dPct?: number;
  ma50SlopePct?: number;
  sma20SlopePct?: number;
  distanceToSma20Pct?: number;
  trendScore?: number;
  priceVsSma200Pct?: number;
  priceExtensionAtr?: number;
  adx14?: number;
  rsi14?: number;
  weakeningSignalCount?: number;
  drawdownFromRecentHighPct?: number;
};

export type PcsDynamicEntryContext = PcsDynamicMarketState & {
  date: string;
  history: readonly PcsDynamicMarketState[];
  selectedNoTouchLower?: number | null;
  selectedSigma?: 1 | 1.5 | 2 | 2.5;
  openCredit?: number;
  shortStrike?: number;
  longStrike?: number;
  expiry?: string;
  hasOpenPcs: boolean;
  lastSettledPnl?: number;
  /** Current-run safety state supplied by the engine; never derived from future bars. */
  safetyConditionsMet?: boolean;
  streakCooldownBlocked?: boolean;
  normalP4GatePassed?: boolean;
  normalP4SignalPassed?: boolean;
  dynamicExtensionEligible?: boolean;
  backwardationOnly?: boolean;
};

export type PcsDynamicEntryDecision = {
  allowed: boolean;
  reason?: string;
};

/** Explicit PCS admission seam. Never serialized; callers own as-of state and activation. */
export type PcsDynamicEntryProfile = {
  evaluate: (context: PcsDynamicEntryContext) => PcsDynamicEntryDecision;
  onClose?: (context: { signalDate: string; closeDate: string; pnl: number }) => void;
};

export type MarketInput = {
  date: string;
  universeId?: OverlayUniverseId;
  /** 快速回测的页面期权标的；生产 Overlay 省略。 */
  optionUnderlyingSymbol?: string;
  dataIssues?: string[];
  leveragedSymbol?: string;   // which leveraged ETF is being tracked (default 'TQQQ'); prices.TQQQ slot holds this symbol's data
  prevCloseNav?: number;      // previous completed day NAV for daily-loss risk checks
  navDrawdownPeak?: number;   // rolling peak NAV for opt-in 06a NAV drawdown governor
  postCrisisBars?: number;    // decision bars since crisis RECOVERY cleared; undefined = unknown
  lastLeveragedTrade?: { side: 'BUY' | 'SELL'; date: string };

  crisisPhase?: CrisisPhase;  // externally-managed crisis state machine phase (undefined = legacy single-bar CRISIS behavior)
  macroRegimeState?: MacroRegimeState;
  macroExecutionDriver?: MacroExecutionDriver;
  /** Research-only as-of state: the immediately preceding classified market regime. */
  researchPreviousRegime?: MarketRegime;
  slowSubregimeFactors?: FactorMap;
  /** 回测研究专用；false 仅阻断 SLOW_BULL_GROWTH。 */
  stockGrowthEligible?: boolean;
  /** 回测研究专用；逐日阻断 Equity Boost 新开仓，生产调用始终省略。 */
  equityBoostEntryBlocked?: boolean;
  /** Research-only dynamic EB gate; omitted by live/API callers. */
  equityBoostEntryGate?: (context: {
    date: string;
    regime?: string;
    slowSubregime?: string;
    vix?: number;
    vxn?: number;
    tqqqRealisedVol20d?: number;
    qqqROC20?: number;
    qqqROC5?: number;
    drawdownFromRecentHighPct?: number;
    priceVsSma200Pct?: number;
    adx14?: number;
    widthPct?: number;
    rawSignal?: boolean;
    priceExtensionAtr?: number;
    vixChange5d?: number;
  }) => boolean;
  /** 回测研究专用；逐日阻断 PCS 新开仓，生产调用始终省略。 */
  /** Explicit P4 PCS admission profile; evaluated after contract selection. Omitted by default. */
  pcsDynamicEntryProfile?: PcsDynamicEntryProfile;
  /** Current-bar history owned by the caller; production owners must provide only as-of state. */
  pcsDynamicMarketHistory?: readonly PcsDynamicMarketState[];
  /** Research-only post-selection EB contract gate; omitted live/API callers. */
  equityBoostContractGate?: (context: {
    date: string;
    regime?: string;
    slowSubregime?: string;
    vix?: number;
    vxn?: number;
    tqqqRealisedVol20d?: number;
    qqqROC20?: number;
    qqqROC5?: number;
    drawdownFromRecentHighPct?: number;
    priceVsSma200Pct?: number;
    adx14?: number;
    widthPct?: number;
    priceExtensionAtr?: number;
    vixChange5d?: number;
    shortStrike: number;
    longStrike: number;
    expiry: string;
    targetDte: number;
  }) => boolean;
  pcsEntryBlocked?: boolean;
  /** 研究专用：当前日之前连续满足 P1-Compact BULL/SR02 压力条件的已知状态日数。 */
  pcsResearchP1BullStressStreak?: number;
  /** 研究专用：最近一笔已结算主 PCS 的实际盈亏；未结算时保持 undefined。 */
  pcsResearchP1LastSettledPnl?: number;
  /** 回测研究专用；逐日阻断 CCS 新开仓，生产调用始终省略。 */
  csEntryBlocked?: boolean;
  /** 回测研究专用；由日期 replay 提供，进入 FactorMap 后仅能经 DecisionEngine 形成有界仓位增益。 */
  stockRecoveryBoostPct?: number;
  /** 回测研究专用；在既有 trend participation 后应用有界目标仓位增益。 */
  stockPostParticipationBoostPct?: number;
  /** 回测研究专用；允许 post-participation boost 作用的状态，生产调用始终省略。 */
  stockPostParticipationBoostRegimes?: readonly MarketRegime[];
  /** 回测研究专用；按日期覆盖基础 targetVol，生产调用始终省略。 */
  targetVolOverride?: number;
  /** 回测研究专用；逐日只允许抬高状态 hard cap，生产调用始终省略。 */
  hardCapRaiseOverride?: number;
  /** Research-only direct hard-cap override; never populated by live/API callers. */
  hardCapOverride?: number;
  /** 回测研究专用；按日期覆盖 SIDEWAYS 仓位折扣，生产调用始终省略。 */
  sidewaysFactorOverride?: number;
  /** 回测研究专用：条件化 Growth 临时目标上限；live 调用始终省略。 */
  conditionalGrowthWarnCapPct?: number;
  /** 回测研究专用：逐日覆盖 RANGE_BOUND 帽；生产调用始终省略。 */
  rangeBoundCapOverride?: 'scaled' | number;
  regimeConfirmState?: {
    confirmedRegime: MarketRegime;
    candidateRegime?: MarketRegime;
    candidateBars?: number;
  };
  targetWeightSmoothingState?: {
    smoothedTqqqPct: number;
  };
  /** Research-only state for current-bar trend participation confirmation. */
  trendParticipationState?: {
    eligibleStreak: number;
    active: boolean;
    activeBars?: number;
    strongEligibleStreak?: number;
    strongPartialEligibleStreak?: number;
    recoveryEligibleStreak?: number;
  };
  /** Research-only state for the TQ2 state-gated volatility-budget refill. */
  trendBudgetRefillState?: {
    eligibleStreak: number;
    active: boolean;
  };
  flashCrashState?: {
    active: boolean;
    cooldownBars: number;
    triggerDate?: string;
  };
  // 研究专用（2026-07-22 tail-risk-early-warning）：由 tailRiskTriggerByDate replay 提供，
  // 生产调用始终省略；驱动 updateTailRiskState/06c-tail-risk-governor。
  tailRiskRawTrigger?: boolean;
  /** 仅回测研究：覆盖当日 tail-risk 仓位乘数；生产调用始终省略。 */
  tailRiskMultiplier?: number;
  tailRiskState?: {
    active: boolean;
    cooldownBars: number;
    triggerDate?: string;
  };
  /** EB 研究专用：逐日维护的 DTE 滞回状态；生产调用省略。 */
  equityBoostDteState?: {
    riskState: 'low' | 'high';
    highRiskTradingDays: number;
  };
  /** 候选6-MDD历史回放专用；生产调用省略。 */
  equityBoostCandidate6State?: {
    openCount: number;
    realizedDrawdown: number;
  };
  pcsPageSignalStreak?: number; // 截至昨日的连续 raw 页面 PCS 信号天数，simulator 维护（persist 研究用）
  csBreachState?: CSBreachState;
  /** CS 研究专用：预危机窗口内已开的独立 CS 数量；生产 live 未提供时保持关闭。 */
  csEventRiskState?: CSEventRiskState;
  /** CS 研究专用：截至当日的连续 QQQ 弱势天数；生产 live 始终省略。 */
  csResearchWeakPersistenceDays?: number;
  /** CS 研究专用：截至当日的 VXN 5 日变化；生产 live 始终省略。 */
  csResearchVixChange5d?: number;
  /** CCS v2.4 研究专用：按 Slow-VIX horizon 计算的 VIX 绝对点差。 */
  csResearchVixChangePoints?: number;
  /** CS 研究专用：截至当日的 QQQ VXN；不替换独立 CS 当前主波动率口径。 */
  csResearchVxn?: number;
  /** CS 研究专用：独立副层自己的事件预算状态，不消费主层 cap1 ledger。 */
  csSecondaryEventRiskState?: CSEventRiskState;
  /** PCS 连败冷静期（按交易日过期）：simulator 维护，跨 bar 传递；live 无历史时等效关闭（undefined）。 */
  pcsStreakState?: PcsStreakState;
  /** 回测日循环专用的无前视卖方统计状态；调用方不得跨 arm 共享。 */
  sellerStatsAsOf?: SellerStatsAsOf;
  /** 回测日循环专用的 Call 生存率 as-of 状态；调用方不得跨 arm 共享。 */
  callStrikeSurvivalAsOf?: CallStrikeSurvivalAsOf;
  /** 回测日循环专用的 Put 生存率市场索引；只含行情派生物，可在 batch arm 间共享。 */
  putStrikeSurvivalAsOf?: PutStrikeSurvivalAsOf;
  // 'backtest' disables live-only logic (e.g. the intraday de-risk gate, which would
  // otherwise read the daily close as an intraday move). Undefined ⇒ live.
  mode?: 'live' | 'backtest';
  // Narrow opt-in: lets the intraday de-risk gate (06b) run even though mode === 'backtest',
  // so its tier thresholds can be calibrated against history. Set only by the backtest
  // simulator when replaying an intraday-granularity run; ignored when mode !== 'backtest'.
  intradayGateBacktestEnabled?: boolean;
  // 仅供回测审计输出使用；不得参与任何策略判断。
  trace?: boolean;

  account: {
    netLiquidation: number;
    cash: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      marketValue: number;
      averageCost?: number;
      unrealizedPnl?: number;
    }>;
    optionPositions?: OptionPosition[];
  };

  prices: {
    QQQ: OHLCV[];
    SPY?: OHLCV[];
    TQQQ: OHLCV[];
    BOXX?: OHLCV[];
  };

  currentPrices?: {
    QQQ?: number;
    leveraged?: number;
    BOXX?: number;
  };

  macro: {
    vix?: number;
    vix3m?: number;
    vxn?: number;
    vxnHistory?: number[];
    prevVix?: number;   // prior-day VIX, used to detect single-day spikes
    vix5dAgo?: number;
  };

  optionChains?: {
    QQQ?: OptionChain;
    TQQQ?: OptionChain;
    [symbol: string]: OptionChain | undefined;
  };

  strategyParams?: StrategyParams;

  // Perf-only fast path: the backtest simulator builds this once per run (over the full
  // historical QQQ series) so engines can do O(1) indexed lookups instead of rescanning
  // `prices.QQQ` from scratch on every simulated bar. Absent for live/one-shot callers, who
  // fall back to the plain calc*() functions in ./utils — must produce identical results either way.
  precomputedIndicators?: {
    qqq?: RollingIndicators;
    tqqq?: RollingIndicators;
  };
};

export interface CSBreachState {
  breachedShortStrike: number;   // short strike of the CS that was closed at a loss
  breachDate: string;            // ISO date of the losing close
  qqqCloseAtBreach: number;      // QQQ close on breachDate
  tqqqROC20AtBreach: number;     // TQQQ 20-bar ROC on breachDate
  regimeAtBreach: MarketRegime;  // regime on breachDate
  active: boolean;               // true until a release condition (implemented in G2) clears it
  cleanClosesSinceBreach?: number; // GS1: consecutive profitable CS/BearCS closes since the breach (ramp counter)
  /** WR-89 controller state; maintained separately from generic breach release. */
  wr89CooldownRemaining?: number;
}

export interface CSEventRiskState {
  entriesInWindow: number;
  lastOpenDate?: string;
  /** Research-only secondary coverage occupancy ledger; omitted preserves prior behavior. */
  coverageEntriesInWindow?: number;
  coverageLastOpenDate?: string;
}

export interface PcsStreakState {
  /** 冷静期解除日期（交易日字符串，含当天起可以再开仓）；undefined = 当前无冷静期。 */
  cooldownUntilDate?: string;
}
