import type { FinancialFactor } from './factor';
import type { SigmaBucket } from '@/lib/engines/analysis/SellerStatsEngine';
import type { IntradayBonusValue } from '@/lib/engines/analysis/IntradayBonusEngine';

export type SellerOpportunityAction = 'OPEN' | 'WATCH' | 'WAIT' | 'BLOCK';
export type SellerOpportunityTier = 'OBSERVE' | 'WATCH' | 'PRIME' | 'EXTREME';
export type OpportunityTag = { label: string; tooltip: string };
export type PcsLifecycleContract =
  | { status: 'READY'; expiry: string; daysToExpiration: number; sigma: number; shortStrike: number; longStrike: number; netCredit: number; annualizedReturn: number }
  | { status: 'UNAVAILABLE'; reason: string };

export interface OpportunityStat extends FinancialFactor<number | null> {
  n: number;
  windowDays: number;
  formulaKey: string;
}

export interface OpportunityExpectedMoveRow {
  expiration: string | null;
  dte: FinancialFactor<number | null>;
  expectedMove: FinancialFactor<number | null>;
  expectedMovePercent: FinancialFactor<number | null>;
  effectiveLower: FinancialFactor<number | null>;
  lower2Sigma: FinancialFactor<number | null>;
  iv: FinancialFactor<number | null>;
}

/**
 * 仅供 QQQ GEX Terminal 回放的、到期日级别聚合。所有方向性结论均是
 * option-chain 模型推断，不代表可观察的逐笔成交或 dealer 实际仓位。
 */
export interface InferredOptionsFlowSnapshot {
  label: 'INFERRED_NOT_TAPE';
  callPremium: FinancialFactor<number>;
  putPremium: FinancialFactor<number>;
  netPremium: FinancialFactor<number>;
  callVolume: FinancialFactor<number>;
  putVolume: FinancialFactor<number>;
  bias: 'CALL_BUYING' | 'CALL_SELLING' | 'PUT_BUYING' | 'PUT_SELLING' | 'MIXED' | 'UNAVAILABLE';
  confidence: FinancialFactor<number>;
}

/** 可选的到期日级 Terminal 聚合；老快照缺失时保持可读。 */
export interface GexExpiryTerminalSnapshot {
  atmIv?: FinancialFactor<number>;
  expectedMove?: FinancialFactor<number>;
  spot?: FinancialFactor<number>;
  netGamma?: FinancialFactor<number>;
  crowding?: FinancialFactor<number>;
  flipPosition?: FinancialFactor<number>;
  topology?: string | null;
  inferredFlow?: InferredOptionsFlowSnapshot;
}

/** 全量逐价位 GEX；OI/volume 是原始 call/put 侧贡献，缺历史字段时可选。 */
export interface GexStrikeProfilePoint {
  strike: FinancialFactor<number>;
  callGex: FinancialFactor<number>;
  putGex: FinancialFactor<number>;
  totalGex: FinancialFactor<number>;
  callOi?: FinancialFactor<number>;
  putOi?: FinancialFactor<number>;
  callVolume?: FinancialFactor<number>;
  putVolume?: FinancialFactor<number>;
  isCallWall: boolean;
  isPutWall: boolean;
  isGammaFlip: boolean;
}

export interface GexExpirySnapshot extends GexExpiryTerminalSnapshot {
  expiryDate: string;
  /** DTE 是当前采样的显示值；跨时间连接必须使用 expiryDate。 */
  dte: number;
  totalGex: FinancialFactor<number>;
  gammaFlipLevel: FinancialFactor<number>;
  callWallPrice: FinancialFactor<number>;
  putWallPrice: FinancialFactor<number>;
  callWallMagnitude: FinancialFactor<number>;
  putWallMagnitude: FinancialFactor<number>;
  callTotalGex: FinancialFactor<number>;
  putTotalGex: FinancialFactor<number>;
  kingStrike: FinancialFactor<number>;
  kingMagnitude: FinancialFactor<number>;
  kingSide: 'call' | 'put' | null;
  gexProfile: GexStrikeProfilePoint[];
  gexTopologyStructure: string | null;
}

export interface SellerOpportunityLifecyclePoint {
  time: string;
  policyId: string;
  edgeScore: FinancialFactor<number>;
  eventScore: FinancialFactor<number>;
  premiumScore: FinancialFactor<number>;
  tier: SellerOpportunityTier;
  baseAction: SellerOpportunityAction;
  finalAction: SellerOpportunityAction;
  watchCondition: boolean;
  openCondition: boolean;
  watchStreak: number;
  openStreak: number;
  /** v3 起记录；旧记录缺失时 UI 只展示当前值。 */
  dayChange?: FinancialFactor<number>;
  downsideSigma?: FinancialFactor<number>;
  ivRank?: FinancialFactor<number>;
  rsi?: FinancialFactor<number | null>;
  /** 日内层（IntradayBonusEngine，实验性）所需的今日轮询路径字段；旧记录缺失时该点不参与日内层计算。 */
  price?: FinancialFactor<number>;
  totalGex?: FinancialFactor<number>;
  gammaFlipLevel?: FinancialFactor<number>;
  sellerIntradayPosition?: FinancialFactor<number>;
  /** QQQ PCS 日内快照冻结的真实链候选；不参与个股 Seller Edge 计算。 */
  pcsContract?: PcsLifecycleContract;
  /** QQQ PCS GEX 墙位/期限结构快照；旧记录缺失时该点不参与分段墙位重建。 */
  callWallPrice?: FinancialFactor<number>;
  putWallPrice?: FinancialFactor<number>;
  callWallMagnitude?: FinancialFactor<number>;
  putWallMagnitude?: FinancialFactor<number>;
  callTotalGex?: FinancialFactor<number>;
  putTotalGex?: FinancialFactor<number>;
  kingStrike?: FinancialFactor<number>;
  kingMagnitude?: FinancialFactor<number>;
  kingSide?: 'call' | 'put';
  /** 每次轮询的 Top-N GEX strike；仅供 QQQ GEX 图回放，不参与任何决策。 */
  gexProfile?: Array<{ strike: FinancialFactor<number>; magnitude: FinancialFactor<number>; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean }>;
  /** 同一 5 分钟快照的多到期日 GEX；以 expiryDate 作为稳定键，dte 仅是该时刻的显示值。 */
  gexByExpiry?: GexExpirySnapshot[];
  gexTopologyStructure?: string;
  vixTermRatio?: FinancialFactor<number>;
}

export interface SellerOpportunitySnapshot {
  schemaVersion: 3;
  policy: {
    id: string;
    calibrationPassed: boolean;
    validationPassed: boolean;
    manualOpenOverride: boolean;
    calibratedOn: 'QQQ' | null;
    validatedOn: 'SPY' | null;
    transferred: boolean;
    refreshMinutes: 5;
  };
  header: {
    symbol: string;
    price: FinancialFactor<number>;
    dayChange: FinancialFactor<number>;
    dataGrade: 'A' | 'B' | 'C' | 'D';
    updatedAt: string;
    updateCount: number;
  };
  verdict: {
    baseAction: SellerOpportunityAction;
    finalAction: SellerOpportunityAction;
    promotionSource: 'BASE' | 'WATCH_TRIGGER' | 'OPEN_TRIGGER' | 'CARRY_OPEN' | null;
    selectedSigma: 1 | 1.5 | 2 | 2.5 | null;
    tier: SellerOpportunityTier;
    edgeScore: FinancialFactor<number>;
    eventScore: FinancialFactor<number>;
    premiumScore: FinancialFactor<number>;
    reasons: string[];
    tags: OpportunityTag[];
    nextTier: { tier: SellerOpportunityTier; threshold: number; pointsAway: FinancialFactor<number> } | null;
    policyId: string;
  };
  probabilityAdvantage: {
    strike: FinancialFactor<number | null>;
    expiry: string | null;
    dte: FinancialFactor<number | null>;
    distancePct: FinancialFactor<number | null>;
    sigmaDistance: FinancialFactor<number | null>;
    survival5d: OpportunityStat;
    survival5dInGrid: boolean;
    carryMatchesCandidate: FinancialFactor<boolean>;
    carryRelation: FinancialFactor<string>;
    approximationNote: string;
  };
  signals: {
    dayChange: FinancialFactor<number>;
    dayLow: FinancialFactor<number | null>;
    dayHigh: FinancialFactor<number | null>;
    distanceFromDayLow: FinancialFactor<number | null>;
    distanceFromDayHigh: FinancialFactor<number | null>;
    downsideSigma: FinancialFactor<number>;
    ivRank: FinancialFactor<number>;
    rsi: FinancialFactor<number | null>;
    edgeScore: FinancialFactor<number>;
    intradayPosition: FinancialFactor<number>;
  };
  structureEvidence: {
    gammaFlip: FinancialFactor<number | null>;
    putWall: FinancialFactor<number | null>;
    callWall: FinancialFactor<number | null>;
    termSlope: FinancialFactor<number | null>;
    putSkew: FinancialFactor<number | null>;
    flowPutBias: FinancialFactor<boolean | null>;
    pcr: FinancialFactor<number | null>;
    earningsDate: FinancialFactor<string | null>;
    earningsDays: FinancialFactor<number | null>;
  };
  /** 日内层加分（IntradayBonusEngine）：2026-07-20 起计入 seller_edge_score/verdict.edgeScore，见 SellerOpportunityPolicy.intraday.enabled。 */
  intradayBonus: FinancialFactor<IntradayBonusValue>;
  lifecycle: { available: boolean; points: SellerOpportunityLifecyclePoint[] };
  putEvidence: {
    currentBucket: SigmaBucket | null;
    buckets: Array<{ bucket: SigmaBucket; noBreach: OpportunityStat; nextDayNoLoss: OpportunityStat; nextDayRebound: OpportunityStat; sameDayFade: OpportunityStat; weekNoLoss: OpportunityStat }>;
  };
  swingEvidence: {
    lookbackDays: 37;
    currentDistance: FinancialFactor<number>;
    bounceProbability10d: OpportunityStat;
    medianBounceMagnitude: OpportunityStat;
  };
  manageability: Record<string, OpportunityStat>;
  anchoredManageability: {
    available: boolean;
    bucket: SigmaBucket | '0.5-1.0' | null;
    anchor: FinancialFactor<number>;
    /** 锚来自本轮首次 ≥0.5σ 的持久化日内快照；无快照时才临时使用当前价。 */
    anchorSource: 'snapshot' | 'current_fallback';
    anchorTime: string | null;
    halfRetraceTarget: FinancialFactor<number | null>;
    repairTarget: FinancialFactor<number | null>;
    stats: Record<string, OpportunityStat>;
  };
  strikeSurvival: {
    available: boolean;
    horizons: Array<{
      days: 3 | 5 | 10;
      expiry: FinancialFactor<string | null>;
      dte: FinancialFactor<number | null>;
      rows: Array<{
        sigmaDistance: FinancialFactor<number>;
        strike: FinancialFactor<number | null>;
        distancePct: FinancialFactor<number | null>;
        survival: OpportunityStat;
      }>;
    }>;
    note: string;
  };
  cspCarry: {
    coreSigma: 1.5;
    minimumScore: number;
    note: string;
    rows: Array<{
      sigma: 1 | 1.5 | 2 | 2.5;
      minimumScore: number;
      selected: boolean;
      score: FinancialFactor<number>;
      eligible: FinancialFactor<boolean>;
      reason: FinancialFactor<string>;
    }>;
  };
  lifecyclePlan: {
    available: boolean;
    riskReferenceUnderlying: FinancialFactor<number | null>;
    realizationReferenceUnderlying: FinancialFactor<number | null>;
    expectedMove: FinancialFactor<number | null>;
    reason: string;
  };
  operationWindow: {
    watch: { condition: boolean; streak: number; requiredStreak: 2; distance: FinancialFactor<number | null> };
    open: { condition: boolean; streak: number; requiredStreak: 2; distance: FinancialFactor<number | null> };
  };
  /** 操作窗口触发器：仅展示推荐观察/管理窗口，不接入账户、持仓、成本价或自动交易。 */
  operationTrigger: {
    downTrigger: FinancialFactor<number | null>;
    upTrigger: FinancialFactor<number | null>;
    upTriggerSource: 'lifecycle_plan' | 'breakeven_expected_move';
    isAfterClose: FinancialFactor<boolean>;
  };
  /** QQQ PCS production policy；所有 gate 都来自同一扁平 FactorMap。 */
  pcs: {
    policyId: 'pcs-reactive-v1';
    mode: 'off' | 'reactive-v1';
    finalAction: SellerOpportunityAction;
    gates: Record<string, FinancialFactor<boolean>>;
    reasons: string[];
  };
  strategies: Array<{
    kind: 'CSP' | 'PCS';
    status: 'AUTHORIZED' | 'RESEARCH_ONLY' | 'UNAVAILABLE';
    strike: FinancialFactor<number | null>;
    expiry: string | null;
    dte: FinancialFactor<number | null>;
    delta: FinancialFactor<number | null>;
    bid: FinancialFactor<number | null>;
    ask: FinancialFactor<number | null>;
    mid: FinancialFactor<number | null>;
    premiumPrice: FinancialFactor<number | null>;
    lastPrice: FinancialFactor<number | null>;
    quoteSource: FinancialFactor<'market' | 'last_trade' | null>;
    quoteAsOf: FinancialFactor<number | null>;
    quoteHaircut: FinancialFactor<number | null>;
    winProbability: FinancialFactor<number | null>;
    apr: FinancialFactor<number | null>;
    breakeven: FinancialFactor<number | null>;
    warnings: string[];
  }>;
  disclosure: {
    statsScope: string;
    calibration: string;
    lifecycle: string;
    dataAsOf: string;
    beijingTime: string;
  };
  detail: { expectedMoveMatrix: OpportunityExpectedMoveRow[] };
}
