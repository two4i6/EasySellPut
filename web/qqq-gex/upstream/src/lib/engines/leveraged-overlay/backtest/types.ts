import type { CrisisPhase, MarketRegime, TrendSignal, MarketEnvironmentSnapshot, OrderProposal, SystemOutput } from '../types/output';
import type { CSBreachState, CSEventRiskState, OptionPosition } from '../types/input';
export type { MarketEnvironmentSnapshot };
import type { PCSPressureSizingMode, PCSSurvivalSelectionDteMode, PCSSurvivalSelectionObjective, PCSSurvivalSelectionSigmaMode, PCSSurvivalSelectionWidthMode, StrategyParams } from '../types/params';
import type { OverlayStrategyTag } from '../constants';
import type { OverlayProposal } from '../types/pipeline';
import type { FactorMap } from '../../../../types/factor';
import type { OverlayUniverseId } from '../universe';
import type { OverlaySignalSymbol } from '../universe';
import type { CanonicalOptionSignalTape } from '../v2/backtest/canonical-option-signal-tape';

export type BacktestTimeframe = '1d' | '4h' | '2h' | '1h' | '6h';

export type BacktestConfig = {
  initialCapital: number;
  startDate?: string;         // ISO "YYYY-MM-DD"，省略则从第 200 根 K 线开始
  endDate?: string;
  timeframe?: BacktestTimeframe; // 回测 K 线周期，默认日线
  slippagePct?: number;       // 成交滑点，默认 0.001 (0.1%)
  minBarHistory?: number;     // pipeline 所需最少历史棒数，默认 200
  strategyParams?: StrategyParams;
  universeId?: OverlayUniverseId;
  signalSymbol?: OverlaySignalSymbol;
  /** 卖方机会快速回测专用：以页面标的生成日线与合成期权链；省略保持既有 universe 期权标的。 */
  optionUnderlyingSymbol?: string;
  /** 卖方机会快速回测研究口径：各腿独立样本固定一张，忽略资金/仓位占用。 */
  optionsBacktestPositionMode?: Partial<Record<'cs' | 'ic' | 'eb' | 'pcs' | 'bearCs', 'portfolio' | 'independent'>>;
  /** @deprecated 请改用 optionsBacktestPositionMode.pcs；保留一个版本用于兼容已有 PCS 调用方。 */
  pcsBacktestPositionMode?: 'portfolio' | 'independent';
  // Research-only oracle: dates whose close-time decision must suppress macro boost.
  // Used to measure the best-case lead time; never populated by live callers.
  macroBoostBlockedDates?: Readonly<Record<string, true>>;
  // Research-only replay: dates whose stock Growth policy is ineligible.
  // Omitted by every live/API caller and intentionally not part of RunSpec.
  stockGrowthBlockedDates?: Readonly<Record<string, true>>;
  // Research-only replay: suppress EB entries on selected dates; never populated by live/API callers.
  equityBoostEntryBlockedDates?: Readonly<Record<string, true>>;
  /** Research-only dynamic EB gate; never serialize or use in live/API paths. */
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
  // Research-only replay: suppress PCS entries on selected dates; never populated by live/API callers.
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
  pcsEntryBlockedDates?: Readonly<Record<string, true>>;
  // Research-only replay: suppress CCS entries on selected dates; never populated by live/API callers.
  csEntryBlockedDates?: Readonly<Record<string, true>>;
  // Research-only replay: bounded CURRENT target increment. Never part of RunSpec/API/UI.
  stockRecoveryBoostPctByDate?: Readonly<Record<string, number>>;
  // Research-only replay: bounded target increment after trend participation. Never part of RunSpec/API/UI.
  stockPostParticipationBoostPctByDate?: Readonly<Record<string, number>>;
  // Research-only replay: states allowed to receive the post-participation target increment.
  // Omitted in live/API callers; the engine default remains BULL only.
  stockPostParticipationBoostRegimes?: readonly MarketRegime[];
  /** 研究专用：逐日覆盖 RANGE_BOUND 帽；仅本地回测脚本使用，绝不进入 RunSpec/API/UI。 */
  rangeBoundCapOverrideByDate?: Readonly<Record<string, 'scaled' | number>>;
  /** 研究专用：按已冻结的状态轨迹临时覆盖 Growth 上限；仅本地回测使用。 */
  conditionalGrowthWarnCapPctByDate?: Readonly<Record<string, number>>;
  /** 研究专用：逐日抬高状态 hard cap；仅本地回测使用，绝不进入 RunSpec/API/UI。 */
  hardCapRaiseOverrideByDate?: Readonly<Record<string, number>>;
  /** 研究专用：逐日覆盖基础 TQQQ hard cap；仅本地回测使用。 */
  researchHardCapOverrideByDate?: Readonly<Record<string, number>>;
  /** 研究专用：仅本地回测按日期覆盖基础 targetVol；默认不生效，绝不进入 RunSpec/API/UI。 */
  targetVolByDate?: Readonly<Record<string, number>>;
  /** 研究专用：仅本地回测在指定日期启用先卖后买；默认不生效，绝不进入 RunSpec/API/UI。 */
  researchEquitySellFirstByDate?: Readonly<Record<string, true>>;
  /** 研究专用：仅本地回测按日期覆盖 SIDEWAYS 仓位折扣；默认不生效，绝不进入 RunSpec/API/UI。 */
  sidewaysFactorByDate?: Readonly<Record<string, number>>;
  // Research-only replay: reuse a previously computed classifier timeline across policy candidates.
  macroRegimePhaseByDate?: Readonly<Record<string, 'SLOW_BULL' | 'SLOW_BEAR'>>;
  // 2026-07-22 研究专用 replay：TQQQ 闪崩提前预警（信用线/Topping 线，见 tail-risk-signals.ts）
  // 逐日预计算的触发布尔值；驱动 strategyParams.tailRiskOverride。绝不进入 RunSpec/API/UI。
  tailRiskTriggerByDate?: Readonly<Record<string, boolean>>;
  /**
   * 研究专用：在 tailRiskOverride 已激活的日期覆写其仓位乘数。
   * 仅本地历史回放的 config 消费，绝不进入 RunSpec/API/UI；缺省时逐位保持
   * tailRiskOverride.multiplier 的既有行为。
   */
  tailRiskMultiplierByDate?: Readonly<Record<string, number>>;
  leveragedSymbol?: string;   // 杠杆 ETF 标的，默认 'TQQQ'
  useMockOptions?: boolean;   // 用 B-S 合成期权链，启用 Iron Condor 回测
  volIndex?: 'VIX' | 'VXN';   // 仅影响 mock 期权定价 IV；市场机制门槛仍使用 VIX
  riskVolIndex?: 'VIX' | 'VXN'; // 风控机制使用的波动率源
  includeTerminalMarkOnly?: boolean; // 包含最后一根行情作为只读状态点，不在该点生成次日新开仓
  /** PCS 独立回放专用：末根日线按当日收盘模拟开仓；不改变历史 T+1 成交。 */
  appendTerminalPcsOpen?: boolean;
  optionSpreadMultiplier?: number;   // 期权买卖价差压力系数，默认 1（基础价差按标的分档 3%/5%/8%）
  riskFreeRate?: number;             // 年化无风险利率，用于 Sharpe 超额收益与期权 B-S 定价，默认 0.045
  commissionPerContract?: number;    // 每张合约单边佣金，默认 0.65（开仓与真实平仓计费，到期作废免佣）
  optionSkewSlope?: number;          // 波动率偏斜斜率，默认 2.8（0 = 扁平 IV；按当前 QQQ 21D 曲面校准）
  exitFillMode?: 'next_open' | 'mid' | 'worst_of'; // 期权自主平仓成交时点，默认 next_open；mid 取信号日收盘/次日开盘中点；worst_of 取更不利者（压力测试）
  equityFillMode?: 'next_open' | 'mid' | 'worst_of' | 'twap'; // 股票（杠杆 ETF / BOXX）成交时点；twap 仅日内回测，将 T+1 的前 N 根 bar 等量拆单
  equityTwapBars?: number; // twap 的 T+1 执行窗口（根数），默认 1；日线不支持
  intrabarStops?: boolean;           // 默认 false。开启后价格型止损/突破/delta 判定改用当根 bar 的不利极值（下行用 low、上行用 high）而非收盘，捕捉盘中被击穿、收盘又收回的止损；成交仍按 exitFillMode 在次日开盘（保守成交可叠加 worst_of）
  // 以下四项为真实性旋钮，全部 opt-in，默认关 ⇒ 与历史回测逐字节一致：
  realExpiryCalendar?: boolean;      // #5a 默认 false。开启后合成期权链按标的挂牌节奏出到期日：QQQ/SPY 逐交易日、TQQQ 每周五（遇休市前移）；替代固定 +28/37/45 自然日偏移
  realStrikeGrid?: boolean;          // #5b 默认 false。开启后行权价用真实挂牌网格（QQQ/SPY ATM $1、TQQQ ATM $0.50、远翼 $5），替代统一 $5/$2.5
  liquidityModel?: boolean;          // #5c 默认 false。开启后 OI/成交量随价值度衰减（ATM 厚、远翼薄），并按成交量百分比裁剪开仓张数（仅约束开仓，不卡平仓）
  slippageModel?: 'flat' | 'impact'; // #6 默认 'flat'（现状扁平滑点）。'impact' 下股票滑点随 订单规模/ADV（平方根冲击）与 VIX 压力放大，期权在穿价之上叠加 张数/成交量 相关的市场冲击
  // 研究专用：记录每日决策与账本快照；省略时不分配 trace，也不影响回测路径。
  trace?: boolean;
  /** Read-only, compact admission output; does not retain portfolio traces. */
  admissionDiagnostics?: boolean;
  /** v2 runner 内部注入；失效时不得按当前 preset 重建期权信号。 */
  canonicalOptionSignalTape?: CanonicalOptionSignalTape;
  canonicalOptionSignalDataFingerprint?: string;
  /** 研究专用：固定 canonical tape 的 PCS 候选2底层门，仅用于区分信号池与执行层。 */
  canonicalPcsCandidate2Gate?: boolean;
};

export type TradeEntry = {
  signalDate?: string;
  date: string;
  expiry?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Research-only independent EB risk scaling carried into MTM attribution. */
  riskMultiplier?: number;
  fillPrice: number;
  cashImpact: number;       // 正 = 收入（卖出），负 = 支出（买入）
  rationale: string;
  action?: 'OPEN' | 'CLOSE' | 'SETTLE' | 'MARK'; // MARK 仅为期末模型估值，不产生现金流
  strategyTag?: OverlayStrategyTag;
  pnl?: number;             // 已实现盈亏/利润
  executionReason?: string;
  /** Effective executable TQQQ target carried by a stock order, when available. */
  targetPct?: number;
  outcomeReason?: string;
  marketContext?: MarketEnvironmentSnapshot;
  executionReasonKey?: string;
  outcomeReasonKey?: string;
};

export type EquityPoint = {
  date: string;
  nav: number;
  tqqqValue: number;
  boxxValue: number;
  cashValue: number;
  tqqqPct: number;
  targetTqqqPct?: number;
  boxxPct: number;
  tqqqShares?: number;
  boxxShares?: number;
  regime: MarketRegime;
  crisisPhase?: CrisisPhase;
  trend: TrendSignal;
  systemStatus: string;
  hasOpenIC?: boolean;
  hasOpenCollar?: boolean;
  hasOpenCS?: boolean;
  hasOpenBearCS?: boolean;
  hasOpenEquityBoost?: boolean;
  benchmarkPrice?: number;
  leveragedPrice?: number;
  qqqPrice?: number;
  spyPrice?: number;
  stockPolicyId?: SystemOutput['stockPolicyId'];
  stockPolicyActive?: boolean;
  // Live intraday projection appended on top of the historical backtest curve
  // (NAV estimated from the leveraged sleeve's intraday move). Not a settled bar.
  provisional?: boolean;
  marketContext?: MarketEnvironmentSnapshot;
  /** Research-only pipeline snapshot for binding attribution; never consumed by strategy decisions. */
  pipeline?: Record<string, { data?: Record<string, unknown> }>;
  /** Research-only stock proposal snapshot for execution-bridge attribution; never consumed by strategy decisions. */
  researchEquityProposals?: Array<{
    symbol?: string;
    side?: string;
    quantity?: number;
    targetPct?: number;
    executionReasonKey?: string;
  }>;
  /** Research-only first-failure counts for same-day TQQQ re-risk eligibility. */
  researchSameDayReriskGateAudit?: Record<string, number>;
  bindingConstraint?: string;
  regAdjWt?: number;
  recoveryBoostAppliedPct?: number;
  /** 研究专用：逐日记录 targetVol 覆盖是否进入执行路径。 */
  targetVolOverride?: number;
  sidewaysFactorOverride?: number;
};

export type PerformanceMetrics = {
  totalReturnPct: number;
  cagr: number;
  sharpeRatio: number;       // annualised excess return / vol (risk-free rate default 4.5%)
  maxDrawdownPct: number;
  calmarRatio: number;       // CAGR / maxDrawdown
  totalTrades: number;
  equityFlipCount: number;   // TQQQ BUY/SELL direction flips paired within 10 trading days
  whipsawCostPct: number;    // paired flip P&L / start NAV
  tradingDays: number;
  startNAV: number;
  endNAV: number;
  startDate: string;
  endDate: string;
};

export type BacktestResult = {
  config: BacktestConfig;
  equityCurve: EquityPoint[];
  tradeLog: TradeEntry[];
  metrics: PerformanceMetrics;
  /** Research-only: same-day stock de-risk proposal diagnostics. */
  sameDayStockDeRiskDiagnostics?: Array<Record<string, unknown>>;
  slowSubregimeDiagnostics?: SlowSubregimeDiagnostic[];
  /** 日线回测的只读状态格审计；不参与任何策略决策。 */
  stateGridAudit?: StateGridAudit;
  blownUp?: true;
  /**
   * 数据集最后一根 bar 的信号只能在此处出现，不会写入 tradeLog；任何展示型下游都必须消费它，
   * 否则会静默丢失最新信号日。
   */
  nextOpenPlan?: {
    signalDate: string;
    systemStatus: SystemOutput['systemStatus'];
    marketState: MarketEnvironmentSnapshot;
    currentAllocation: SystemOutput['currentAllocation'];
    targetAllocation: SystemOutput['targetAllocation'];
    proposals: OrderProposal[];
    overlay: SystemOutput['overlay'];
    blockers: string[];
    warnings: string[];
  };
  warnings?: string[];
  /** 回测输入覆盖审计；只读展示，不参与策略决策。 */
  dataCoverage?: {
    status: 'READY' | 'INCOMPLETE' | 'ALIGNED_INTRADAY';
    timeframe: BacktestTimeframe;
    window: { startDate: string | null; endDate: string | null; signalLastDate: string | null };
    vix: { missingDates: string[]; yahooRefreshCount: number };
    vix3m: { missingDates: string[]; yahooRefreshCount: number; cboeSameDayCount: number; fredSameDayCount: number };
  };
  debug?: {
    collarLifecycles?: CollarLifecycleDebug[];
    optionCycles?: OptionCycleDebug[];
    pcsPathDiagnostics?: PcsPathDiagnostic[];
    csConditionalGateTrace?: CSConditionalGateTrace[];
    shadowCollarCash?: number;
    trace?: BacktestTraceEntry[];
    dailyAdmissions?: Array<{ date: string; marketState: MarketEnvironmentSnapshot; admissions: NonNullable<SystemOutput['overlay']['strategyAdmissions']> }>;
    csMfeRescueDiagnostics?: { deltaStopTriggered: number; priorMfeAvailable: number; mfeThresholdMet: number; lossThresholdMet: number; dteWindowMet: number; activated: number };
  };
  csBreachState?: CSBreachState;
  csSecondaryEventRiskState?: CSEventRiskState;
};

export type ForwardReturnProfile = {
  samples: number;
  meanPct: number;
  medianPct: number;
  winRate: number;
  p10Pct: number;
};

export type StateGridAuditCell = {
  key: string;
  fastRegime: MarketRegime;
  crisisPhase: CrisisPhase;
  w7Phase: 'SLOW_BULL' | 'SLOW_BEAR' | 'UNKNOWN';
  slowSubregime: 'SR01' | 'SR02' | 'UNKNOWN';
  posteriorBucket: 'p<50' | 'p50-89' | 'p90+' | 'unknown';
  days: number;
  share: number;
  avgTargetTqqqPct: number;
  stockPolicies: { id: string; days: number }[];
  forward: Record<1 | 5 | 20, { qqq: ForwardReturnProfile; leveraged: ForwardReturnProfile }>;
  /** 样本足够且相对全样本呈现“低配 / 强前瞻画像”；仅供研究筛选。 */
  discountedStrong: boolean;
};

export type StateGridAudit = {
  minDays: number;
  totalDays: number;
  cells: StateGridAuditCell[];
};

export type SlowSubregimeDiagnostic = {
  date: string;
  effectiveDate?: string;
  observationCutoff?: string;
  modelChecksum: string;
  factors: FactorMap;
};

export type OptionRiskBudgetAttempt = {
  /** proposal 生成日；与 canonical option tape 的日期一致。 */
  signalDate: string;
  /** 实际尝试成交日；预算在 next-open 时按真实 fill 评估。 */
  fillDate: string;
  strategy: 'IC' | 'BEAR_CS' | 'CS' | 'PCS' | 'EQUITY_BOOST';
  requestedQuantity: number;
  finalQuantity: number;
  maxLossPerContract: number;
  riskDollars: number;
  status: 'opened' | 'budget_clamped' | 'budget_rejected' | 'strategy_rejected' | 'not_opened';
  reason: 'shared_option_risk_budget';
  /** Trace-only execution outcome for diagnosing a proposal that did not reach an OPEN trade. */
  executionDiagnostic?: 'missing_expiry' | 'missing_contract' | 'missing_quote' | 'zero_liquidity_capacity' | 'nonpositive_net_credit' | 'zero_quantity_after_budget' | 'unclassified';
  /** Read-only fill economics for research diagnosis; never read by order or sizing logic. */
  executionDiagnosticDetails?: {
    requestedQuantity: number;
    preBudgetFillQuantity: number;
    finalQuantity: number;
    shortBid: number | null;
    longAsk: number | null;
    grossCreditPerContract: number;
    afterImpactCreditPerContract: number;
    totalCreditAfterFees: number;
    commissionDollars: number;
    shortVolume: number | null;
    longVolume: number | null;
    vix?: number;
  };
};

export type OptionRiskBudgetTrace = {
  capDollars: number;
  usedDollars: number;
  remainingDollars: number;
  attempts: readonly OptionRiskBudgetAttempt[];
};

/** 可选的逐日审计记录；因子仍保留 FinancialFactor 元数据，禁止降级为裸值。 */
export type BacktestTraceEntry = {
  date: string;
  nav: number;
  cash: number;
  tqqqShares: number;
  tqqqValue: number;
  boxxShares: number;
  boxxValue: number;
  optionPositions: OptionPosition[];
  factors?: FactorMap;
  marketState: MarketEnvironmentSnapshot;
  overlay: SystemOutput['overlay'];
  /** 实际送入期权执行层的 proposals；canonical replay 的唯一信号来源。 */
  optionProposals: readonly OverlayProposal[];
  /** 组合账本的共享定义风险预算；independent 回放不记录也不消耗。 */
  optionRiskBudget?: OptionRiskBudgetTrace;
  candidateActions: string[];
  blockers: string[];
  warnings: string[];
  trades: TradeEntry[];
  /** PCS_RESCUE proposal 到次日成交的只读执行诊断；不参与策略行为。 */
  pcsRescueExecution?: {
    proposalBuilt: boolean;
    attempted: boolean;
    opened: boolean;
    reason: string;
    shortPutFound?: boolean;
    longPutFound?: boolean;
    fillQuantity?: number;
    totalCredit?: number;
    pairSearchUsed?: boolean;
    fallbackQuoteSource?: string;
    fallbackMaxLoss?: number;
    fallbackRiskPct?: number;
    fallbackPairSearchUsed?: boolean;
    fallbackAttempted?: boolean;
    fallbackBuilt?: boolean;
    fallbackCredit?: number;
    fallbackWarning?: string;
    fallbackRiskWithinCap?: boolean;
  };
};

export type OptionCycleDebug = {
  kind: 'CS' | 'IC' | 'PCS' | 'EB' | 'PCS_RESCUE';
  openDate: string;
  closeDate: string;
  regimeAtOpen?: MarketRegime | 'unknown';
  regimeAtClose?: MarketRegime | 'unknown';
  exitKey: string;
  priceExtensionAtr?: number;
  vix?: number;
  qqqEr20?: number;
  credit?: number;
  pnl: number;
};

export type CSConditionalGateTrace = {
  date: string;
  /** Research diagnostic: the next session that would have opened the spread. */
  nextOpenDate?: string;
  credit?: number;
  vix?: number;
  realisedVol20d?: number;
  termSlope?: number;
  regime?: string;
  slowSubregime?: string;
  route?: string;
  evaluated: boolean;
  allowed?: boolean;
  reason: string;
};

export type PcsPathDiagnostic = {
  signalDate: string;
  openDate: string;
  expiry: string;
  shortStrike: number;
  longStrike: number;
  quantity: number;
  width: number;
  openSpot: number;
  openCredit: number;
  openSigmaDist?: number;
  openHorizonTradingDays?: number;
  openCloseSurvival?: number | null;
  openNoTouchSurvival?: number | null;
  priceSelection?: {
    mode: 'survival_only' | 'dynamic_v1_survival';
    objective: PCSSurvivalSelectionObjective;
    survivalWeight: number;
    wilsonWeight: number;
    conditionalLossCapRatio: number | null;
    tailVetoRatio: number | null;
    dteMode?: PCSSurvivalSelectionDteMode;
    targetDte?: number;
    widthMode?: PCSSurvivalSelectionWidthMode;
    widthPct?: number;
    dynamicWidthPct?: number;
    widthBlend?: number;
    widthSwitchMargin?: number;
    widthFallbackUsed?: boolean;
    widthState?: 'stressed' | 'medium' | 'calm';
    sigmaMode?: PCSSurvivalSelectionSigmaMode;
    dynamicSigmaActive?: boolean;
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
    widthSwitchBaselineScore?: number | null;
    widthSwitchCandidateScore?: number | null;
    widthSwitchScoreDelta?: number | null;
    widthSwitchScoreRatio?: number | null;
    widthSwitchAccepted?: boolean;
    pressureSizingMode?: PCSPressureSizingMode;
    pressureSizingMultiplier?: number;
    pressureSizingState?: 'stressed' | 'medium' | 'calm';
  };
  firstTouchDate?: string;
  firstCloseBreachDate?: string;
  survivalExitSignalDate?: string;
  survivalExitReason?: string;
  holdToExpiryDate?: string;
  holdToExpiryPnl?: number;
  closeDate?: string;
  closeAction?: 'CLOSE' | 'SETTLE' | 'MARK';
  realizedPnl?: number;
};

export type CollarLifecycleDebug = {
  openDate: string;
  closeDate?: string;
  triggerScenario?: string;
  exitKey?: string;
  openVix?: number;
  openVixRvRatio?: number;
  openQqqDrawdownFrom20dHighPct?: number;
  openSpot: number;
  closeSpot?: number;
  strikes: {
    longPut: number;
    shortPut?: number;
    call?: number;
  };
  strikeDistanceFromOpenSpotPct: {
    longPut: number;
    shortPut?: number;
    call?: number;
  };
  netDebit: number;
  closeCashImpact?: number;
  pnl?: number;
  pnlBreakdown?: {
    intrinsicPnl: number;
    residualTimeValuePnl: number;
  };
  regimeFlipRoundTrip?: boolean;
};
