import { snapshotQqqLifecycleFactors } from '@/lib/qqqLifecycleFactors';
import { qqqSessionVwap } from '@/lib/qqqSessionVwap';
import { loadQqqDisplayEvidence, compactQqqDisplayEvidence } from '@/lib/qqqDisplayEvidence';
import {qqqSourceMetadataCache} from '@/lib/qqqSourceMetadataCache';
import { qqqNetGexKing, qqqTopNetGexProfile } from '@/lib/qqqGexSummary';
import { calculateQqqGex, QQQ_GEX_CALCULATION_VERSION } from '@/lib/qqqGexCalculation';
import { readQqqGammaPositionHistory } from '@/lib/qqqGammaPositionHistory';
import { qqqChartProfile } from '@/lib/qqqChartProfile';
import { qqqGexExpiriesForSession, qqqGexSessionDte } from '@/lib/qqqGexSelection';
import { QQQ_GAMMA_INPUT_VERSION, qqqGammaExpiryTime, buildQqqGammaModel, type GammaModelExpiry } from '@/lib/qqqGammaModel';
import { NextResponse } from 'next/server';
import { apiCache, replayCacheKey } from '@/lib/cache';
import { createResponseCache } from '@/lib/responseCache';
import {redisResponseCachePort} from '@/lib/embeddedRedisCache';
import { buildFullGexProfile } from '@/lib/qqqGexProfile';
export { buildFullGexProfile } from '@/lib/qqqGexProfile';
import { indicatorEngine } from '@/lib/engines';
import { decisionEngine } from '@/lib/engines/core/DecisionEngine';
import {
  QQQ_INTRADAY_DIRECTIONAL_POLICY,
  QQQ_INTRADAY_DIRECTIONAL_FACTORS as QDF,
  buildQqqIntradayDirectionalFactors,
  type QqqIntradayGexExpiry,
} from '@/lib/engines/analysis/QqqIntradayDirectional';
import { simulateQqqIntradayDirectionalSignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import { addReactivePcsProductionFactors } from '@/lib/engines/analysis/SellerOpportunityFactors';
import { buildQqqPcsEntrySnapshot, QQQ_PCS_SYMBOL, type PcsDailyEligibility } from '@/lib/engines/analysis/QqqPcsEntrySnapshot';
import {
  buildStrikeSurvivalCondition,
  computeConditionalStrikeSurvivalForHorizon,
  computeSellerStats,
  computeStrikeSurvivalForHorizon,
  type SellerStat,
  type StrikeSurvivalBarrier,
} from '@/lib/engines/analysis/SellerStatsEngine';
import { blackScholesEngine } from '@/lib/engines/pricing/BlackScholesEngine';
import { createDerivedFactor, createRawFactor, fallbackFactor } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import type { OptionContract } from '@/types/ivCurve';
import { fetchHistoricalDataCore } from '@/services/adapters/yahooFinance';
import { yahooFinanceServer } from '@/services/adapters/yahooFinanceServer';
import { fetchFredVix3mByDate } from '@/services/adapters/fredVix3mServer';
import { fetchCboeVix3mByDate } from '@/services/adapters/cboeVix3mServer';
import { macroDataService, type MacroData } from '@/services/orchestrators/macroDataService';
import { selectPcsContractProfile } from '@/lib/engines/leveraged-overlay/v2/strategies/pcs-contract-profile';
import { CS_SPREAD_WIDTH_PCT, SPREAD_TARGET_DTE } from '@/lib/engines/leveraged-overlay/constants';
import { calculateGeneralAPR } from '@/lib/apr';
import { buildMockOptionChain, marketTradingDates, QQQ_EXPIRY_CALENDAR_VERSION, normalizeVolIndexForMockOptions } from '@/lib/engines/leveraged-overlay/backtest/mockOptions';
import { buildPutCreditSpreadOpen } from '@/lib/engines/leveraged-overlay/v2/strategies/put-credit-spread';
import { buildQqqDailyMarketBase } from '@/lib/engines/analysis/QqqDailyMarketBase';
import { easternDayStartUtc, twoMinuteBucket } from '@/lib/engineTimeline';
import { GEXEngine, type GEXPoint, type GEXMetrics } from '@/lib/engines/structure/GEXEngine';
import { QqqGexTerminalEngine, type TerminalAnalysis, type TerminalFactorView, type TerminalStrike } from '@/lib/engines/analysis/QqqGexTerminalEngine';
import { buildQqqGexResearchSurface, type QqqGexResearchExpiry } from '@/lib/engines/analysis/QqqGexResearch';
import { readTodayQqqLifecycle, readLatestQqqGexExpirySnapshots, readQqqGexExpiryHistory, readQqqGexExpirySummaries, type QqqGexExpiryHistory, type QqqLatestGexExpirySnapshot } from '@/lib/qqqGexHistory';
import { appendQqqClosedIntradayCandles, mergeQqqIntradayCandles, readTodayQqqIntradayCandles, readLatestQqqIntradayCandles } from '@/lib/qqqIntradayCandles';
import { appendQqqIntradayDirectionalSignal, readQqqIntradayDirectionalSignals } from '@/lib/qqqIntradayDirectionalSignals';
import {readQqqGexDisplayDay} from '@/lib/qqqGexDisplayDay';
import {qqqDisplayDecision} from '@/lib/qqqDisplayDecision';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import { qqqAtmIv } from '@/lib/qqqAtmIv';
import {createQqqVersionedSource} from '@/lib/qqqVersionedSource';
import {supabaseAdmin} from '@/lib/supabase';
import { evaluateQqqDirectionalWithHistory, qqqDirectionalRegularBars } from '@/lib/qqqLiveDirectional';
import { qqqDirectionalGexTime, qqqDirectionalGexSnapshot } from '@/lib/qqqDirectionalGexTime';
import { loadFreshQqqOptionChainSnapshots, mergeQqqOptionChainSnapshots } from '@/lib/qqqOptionChainHistory';
import type { BuiltHistory } from '@/lib/engines/leveraged-overlay/v2/backtest/build-history';

// 逐 strike gamma 快照（非时间序列）：取 |totalGEX| 最大的若干 strike，供图表画横向价位线，纯展示。
export function selectGexProfile(points: readonly GEXPoint[], limit = 8): Array<{ strike: number; magnitude: number; isCallWall: boolean; isPutWall: boolean; isGammaFlip: boolean }> {
  return qqqTopNetGexProfile(points, point => point.totalGEX, limit);
}

/** 当前 expiry 的完整逐 strike 链，供只读 Terminal 做 ATM straddle、墙质量与 Flow 推断。 */
function buildTerminalStrikes(points: readonly GEXPoint[], chain: GexOptionChainSnapshot): TerminalStrike[] {
  const calls = new Map(chain.calls.map((option) => [option.strike, option]));
  const puts = new Map(chain.puts.map((option) => [option.strike, option]));
  return points.map((point) => {
    const call = calls.get(point.strike);
    const put = puts.get(point.strike);
    return {
      strike: point.strike, callGex: point.callGEX, putGex: point.putGEX, netGex: point.totalGEX,
      callOi: point.callOI, putOi: point.putOI, callVolume: point.callVol, putVolume: point.putVol,
      callMid: call?.mid, putMid: put?.mid, callLast: call?.lastPrice, putLast: put?.lastPrice,
      callIv: call?.iv, putIv: put?.iv,
    };
  });
}

function terminalFlowBias(bias: ReturnType<typeof QqqGexTerminalEngine.analyze>['flow']['bias']) {
  if (bias === 'CALL_BUYING_INFERRED') return 'CALL_BUYING' as const;
  if (bias === 'CALL_SELLING_INFERRED') return 'CALL_SELLING' as const;
  if (bias === 'PUT_BUYING_INFERRED') return 'PUT_BUYING' as const;
  if (bias === 'PUT_SELLING_INFERRED') return 'PUT_SELLING' as const;
  return bias === 'UNAVAILABLE' ? 'UNAVAILABLE' as const : 'MIXED' as const;
}

function terminalNumberFactor(value: number | null, description: string): FinancialFactor<number | null> {
  return value === null || !Number.isFinite(value)
    ? fallbackFactor(null, `${description}不可用`)
    : createRawFactor(value, Number.isFinite, description, undefined, 0);
}

/** Route boundary: keep all terminal financial outputs as factors with source/confidence. */
function toTerminalFactorView(analysis: TerminalAnalysis): TerminalFactorView {
  const number = (value: number | null, description: string) => terminalNumberFactor(value, description);
  const score = (value: number, description: string) => createRawFactor(value, Number.isFinite, description, undefined, 0);
  return {
    asOf: analysis.asOf, analysisOnly: true, modelLabels: analysis.modelLabels,
    dealer: { ...analysis.dealer, intensity: number(analysis.dealer.intensity, 'Inferred dealer hedge pressure intensity'), confidence: number(analysis.dealer.confidence, 'Inferred dealer hedge pressure confidence') },
    expectedMove: { ...analysis.expectedMove, value: number(analysis.expectedMove.value, 'Expected move'), lower: number(analysis.expectedMove.lower, 'Expected move lower range'), upper: number(analysis.expectedMove.upper, 'Expected move upper range'), rangePositionPct: number(analysis.expectedMove.rangePositionPct, 'Expected move range position'), downsideMoveUsedPct: number(analysis.expectedMove.downsideMoveUsedPct, 'Expected move downside used'), upsideMoveUsedPct: number(analysis.expectedMove.upsideMoveUsedPct, 'Expected move upside used'), distanceToLower: number(analysis.expectedMove.distanceToLower, 'Expected move distance to lower'), distanceToUpper: number(analysis.expectedMove.distanceToUpper, 'Expected move distance to upper') },
    iv: { ...analysis.iv, currentIv: number(analysis.iv.currentIv, 'QQQ ATM IV'), hv20: number(analysis.iv.hv20, 'QQQ HV20'), vrp: number(analysis.iv.vrp, 'QQQ IV minus HV20'), ivHvRatio: number(analysis.iv.ivHvRatio, 'QQQ IV/HV ratio'), ivRank: number(analysis.iv.ivRank, 'QQQ IV rank history'), ivPercentile: number(analysis.iv.ivPercentile, 'QQQ IV percentile history'), confidence: number(analysis.iv.confidence, 'IV environment confidence') },
    premiumScore: { ...analysis.premiumScore, total: number(analysis.premiumScore.total, 'Premium selling score'), components: Object.fromEntries(Object.entries(analysis.premiumScore.components).map(([key, value]) => [key, score(value, `Premium score ${key}`)])) },
    flipVelocity: { ...analysis.flipVelocity, change: number(analysis.flipVelocity.change, 'Gamma Flip change'), pointsPerHour: number(analysis.flipVelocity.pointsPerHour, 'Gamma Flip velocity') },
    callWallQuality: { ...analysis.callWallQuality, score: number(analysis.callWallQuality.score, 'Call Wall quality'), confidence: number(analysis.callWallQuality.confidence, 'Call Wall quality confidence') },
    putWallQuality: { ...analysis.putWallQuality, score: number(analysis.putWallQuality.score, 'Put Wall quality'), confidence: number(analysis.putWallQuality.confidence, 'Put Wall quality confidence') },
    decision: { ...analysis.decision, confidence: number(analysis.decision.confidence, 'Terminal decision confidence') },
    gammaClock: { ...analysis.gammaClock, intensity: number(analysis.gammaClock.intensity, '0DTE Gamma intensity') },
    flow: { ...analysis.flow, callPremium: score(analysis.flow.callPremium, 'Inferred call activity premium'), putPremium: score(analysis.flow.putPremium, 'Inferred put activity premium'), confidence: score(analysis.flow.confidence, 'Inferred flow confidence'), notableStrikes: analysis.flow.notableStrikes.map((item) => ({ strike: score(item.strike, 'Inferred flow strike'), side: item.side, premium: score(item.premium, 'Inferred flow premium') })) },
  };
}

export type GexSummary = {
  king: { strike: number; magnitude: number; side: 'call' | 'put' } | null;
  callWall: { strike: number; magnitude: number } | null;
  putWall: { strike: number; magnitude: number } | null;
  gammaFlip: number | null;
  netGex: number;
  callTotal: number;
  putTotal: number;
  calculationVersion?: string;
  gexUnit?: 'per-point' | 'per-1pct';
  scope?: 'full-chain';
  windowNetGex?: number;
};

// 固定角标信息框：King/Call Wall/Put Wall/Gamma Flip/Net GEX/Call Total/Put Total，纯汇总展示，来自同一次 GEXEngine 计算，零新增开销。
// Call Total/Put Total 是全部 strike 里净 GEX 为正/负的贡献求和（非单腿原始 gamma），两者相加即 Net GEX，与参考指标口径一致。
export function buildGexSummary(metrics: Pick<GEXMetrics, 'points' | 'gammaFlipPrice' | 'totalGexValue'>): GexSummary | null {
  const { points, gammaFlipPrice, totalGexValue } = metrics;
  const callWallPoint = points.find((point) => point.isCallWall && point.callGEX > 0 && Number.isFinite(point.callGEX)) ?? null;
  const putWallPoint = points.find((point) => point.isPutWall && point.putGEX > 0 && Number.isFinite(point.putGEX)) ?? null;
  if (!callWallPoint && !putWallPoint) return null;
  let callTotal = 0;
  let putTotal = 0;
  for (const point of points) {
    if (!Number.isFinite(point.totalGEX)) continue;
    if (point.totalGEX >= 0) callTotal += point.totalGEX; else putTotal += point.totalGEX;
  }
  const king = qqqNetGexKing(points, point => point.totalGEX);
  return {
    king,
    callWall: callWallPoint ? { strike: callWallPoint.strike, magnitude: callWallPoint.callGEX } : null,
    putWall: putWallPoint ? { strike: putWallPoint.strike, magnitude: -putWallPoint.putGEX } : null,
    gammaFlip: Number.isFinite(gammaFlipPrice) ? gammaFlipPrice : null,
    netGex: totalGexValue,
    calculationVersion: QQQ_GEX_CALCULATION_VERSION, gexUnit: 'per-1pct', scope: 'full-chain',
    callTotal,
    putTotal,
  };
}

/** Rebuild display-only summary from an immutable persisted capture. */
export function buildPersistedGexSummary(snapshot: QqqLatestGexExpirySnapshot): GexSummary | null {
  const callPoint = snapshot.profile.find(p => p.strike === snapshot.callWallPrice);
  const putPoint = snapshot.profile.find(p => p.strike === snapshot.putWallPrice);
  const callWall = callPoint && Number.isFinite(callPoint.callGex) && callPoint.callGex > 0 ? {strike:callPoint.strike,magnitude:callPoint.callGex} : null;
  const putWall = putPoint && Number.isFinite(putPoint.putGex) && putPoint.putGex !== 0 ? {strike:putPoint.strike,magnitude:-Math.abs(putPoint.putGex)} : null;
  if (!callWall && !putWall) return null;
  const king = qqqNetGexKing(snapshot.profile, point => point.totalGex);
  return {
    king,
    callWall,
    putWall,
    gammaFlip: snapshot.gammaFlip,
    netGex: snapshot.profile.reduce((sum, point) => sum + point.totalGex, 0),
    calculationVersion: snapshot.profile[0]?.calculationVersion ?? 'qqq-gex-legacy-v1',
    gexUnit: snapshot.profile[0]?.gexUnit ?? 'per-point', scope: 'full-chain',
    ...(snapshot.profile[0]?.gexUnit !== 'per-1pct' ? {windowNetGex:snapshot.netGex} : {}),
    callTotal: snapshot.profile.filter((point) => point.totalGex >= 0).reduce((sum, point) => sum + point.totalGex, 0),
    putTotal: snapshot.profile.filter((point) => point.totalGex < 0).reduce((sum, point) => sum + point.totalGex, 0),
  };
}

// GEX 解读：五项纯派生展示信息，全部来自已计算的 gexSummary/gexTopologyStructure/wallHistory/candidate，零新增数据源。
// 不参与任何 gate/eligibility 判定，仅用于 GEX 大图的辅助解读文案。
export type GammaRegimeInsight = { label: 'positive' | 'negative'; description: string; distance: number; distancePct: number };
export type WallDistanceInsight = { strike: number; distance: number; distancePct: number };
export type WallStabilityInsight = { segments: number; currentSegmentMinutes: number | null; sparse: boolean; description: string };
export type CandidateWallProximityInsight = { strike: number; wallStrike: number; wallSide: 'call' | 'put'; distancePoints: number; close: boolean; description: string } | null;
export type TopologyInsight = { structure: string; gloss: string };
export type GexInsights = {
  gammaRegime: GammaRegimeInsight | null;
  wallDistances: { callWall: WallDistanceInsight | null; putWall: WallDistanceInsight | null };
  wallStability: { callWall: WallStabilityInsight | null; putWall: WallStabilityInsight | null } | null;
  candidateProximity: CandidateWallProximityInsight;
  topology: TopologyInsight | null;
};

// 1. Gamma 机制：现价相对 gamma flip 的位置，正 Gamma=做市商压制波动，负 Gamma=做市商放大波动。
export function deriveGammaRegime(spot: number, gammaFlip: number | null, netGex?: number): GammaRegimeInsight | null {
  if (!Number.isFinite(spot) || spot <= 0 || gammaFlip === null || !Number.isFinite(gammaFlip) || gammaFlip <= 0) return null;
  if (typeof netGex !== 'number' || !Number.isFinite(netGex)) return null;
  const distance = spot - gammaFlip;
  const distancePct = (distance / spot) * 100;
  const label: 'positive' | 'negative' = netGex >= 0 ? 'positive' : 'negative';
  const description = label === 'positive'
    ? '正 Gamma 模型（波动缓冲倾向）'
    : '负 Gamma 模型（波动放大倾向）';
  return { label, description, distance, distancePct };
}

// 2. 离最近墙距离：现价到 call/put wall 的 $ 与 % 距离。
export function deriveWallDistances(spot: number, gexSummary: GexSummary | null): { callWall: WallDistanceInsight | null; putWall: WallDistanceInsight | null } {
  const toInsight = (wall: { strike: number } | null | undefined): WallDistanceInsight | null => {
    if (!Number.isFinite(spot) || spot <= 0 || !wall || !Number.isFinite(wall.strike) || wall.strike <= 0) return null;
    const distance = wall.strike - spot;
    return { strike: wall.strike, distance, distancePct: (distance / spot) * 100 };
  };
  return { callWall: toInsight(gexSummary?.callWall), putWall: toInsight(gexSummary?.putWall) };
}

// 3. Wall 稳定性：基于今日 wallHistory 逐段合并（同价位连续快照视为一段），报告切换次数与当前段持续分钟数。
// 样本过少（<3 个有效快照）时明确标记 sparse，不假装有信心。
function countWallSegments(points: Array<{ time: string; price: number | null }>, now: Date): WallStabilityInsight | null {
  const valid = points
    .filter((p): p is { time: string; price: number } => p.price !== null && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.time.localeCompare(b.time));
  if (valid.length === 0) return null;
  if (valid.length < 3) {
    return { segments: 1, currentSegmentMinutes: null, sparse: true, description: '数据积累中' };
  }
  let segments = 1;
  let segmentStart = valid[0].time;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].price !== valid[i - 1].price) {
      segments += 1;
      segmentStart = valid[i].time;
    }
  }
  const startMs = new Date(segmentStart).getTime();
  const currentSegmentMinutes = Number.isFinite(startMs) ? Math.max(0, Math.round((now.getTime() - startMs) / 60_000)) : null;
  const description = segments <= 1
    ? `今日未切换${currentSegmentMinutes !== null ? ` · 已持续 ${currentSegmentMinutes} 分钟` : ''}`
    : `今日切换 ${segments - 1} 次 · 当前段已持续 ${currentSegmentMinutes ?? '—'} 分钟`;
  return { segments, currentSegmentMinutes, sparse: false, description };
}

export function deriveWallStability(
  wallHistory: Array<{ time: string; callWallPrice: number | null; putWallPrice: number | null }> | undefined,
  now: Date,
): { callWall: WallStabilityInsight | null; putWall: WallStabilityInsight | null } | null {
  if (!wallHistory || wallHistory.length === 0) return null;
  return {
    callWall: countWallSegments(wallHistory.map((p) => ({ time: p.time, price: p.callWallPrice })), now),
    putWall: countWallSegments(wallHistory.map((p) => ({ time: p.time, price: p.putWallPrice })), now),
  };
}

// 4. 候选 strike 与最近墙交叉校验：short strike 在现价下方比对 put wall，在上方比对 call wall（PCS 卖出腿通常在现价下方）。
// "接近"阈值取 spot 的 1%，避免过度设计门槛系统。
export function deriveCandidateWallProximity(shortStrike: number | undefined, spot: number, gexSummary: GexSummary | null): CandidateWallProximityInsight {
  if (shortStrike === undefined || !Number.isFinite(shortStrike) || !Number.isFinite(spot) || spot <= 0 || !gexSummary) return null;
  const wallSide: 'call' | 'put' = shortStrike <= spot ? 'put' : 'call';
  const wall = wallSide === 'put' ? gexSummary.putWall : gexSummary.callWall;
  if (!wall || !Number.isFinite(wall.strike) || wall.strike <= 0) return null;
  const distancePoints = Math.abs(shortStrike - wall.strike);
  const close = distancePoints <= Math.max(spot * 0.01, 1e-6);
  const wallLabel = wallSide === 'put' ? 'Put Wall' : 'Call Wall';
  const description = close
    ? `你选的 ${shortStrike} 距 ${wallLabel}(${wall.strike}) 仅 ${distancePoints.toFixed(1)} 点`
    : '无明显重叠';
  return { strike: shortStrike, wallStrike: wall.strike, wallSide, distancePoints, close, description };
}

// 5. Topology 大白话解读：口径核对自 GEXEngine.analyzeTopology —— CLUSTERED 由 crowding(top3 strike 占比>60%) 决定，
// HEAVY_TOP/HEAVY_BOTTOM 由现价上/下方 gamma 占比偏斜(|skew|>0.4)决定，DISTRIBUTED 为默认。
const GEX_TOPOLOGY_GLOSS: Record<string, string> = {
  DISTRIBUTED: 'Gamma 分散在多个 strike，无强钉住效应',
  CLUSTERED: 'Gamma 集中在少数 strike，价格容易被钉住',
  HEAVY_TOP: 'Gamma 集中在现价上方，上行阻力强',
  HEAVY_BOTTOM: 'Gamma 集中在现价下方，下行支撑强',
};

export function deriveTopologyGloss(structure: string | null): TopologyInsight | null {
  if (!structure || !(structure in GEX_TOPOLOGY_GLOSS)) return null;
  return { structure, gloss: GEX_TOPOLOGY_GLOSS[structure] };
}

export function buildGexInsights(input: {
  spot: number;
  gexSummary: GexSummary | null;
  gexTopologyStructure: string | null;
  wallHistory?: Array<{ time: string; callWallPrice: number | null; putWallPrice: number | null; callWallMagnitude?: number | null; putWallMagnitude?: number | null; kingStrike?: number | null; kingMagnitude?: number | null; kingSide?: 'call' | 'put' | null }>;
  candidateShortStrike: number | undefined;
  now: Date;
}): GexInsights {
  return {
    gammaRegime: deriveGammaRegime(input.spot, input.gexSummary?.gammaFlip ?? null, input.gexSummary?.netGex),
    wallDistances: deriveWallDistances(input.spot, input.gexSummary),
    wallStability: deriveWallStability(input.wallHistory, input.now),
    candidateProximity: deriveCandidateWallProximity(input.candidateShortStrike, input.spot, input.gexSummary),
    topology: deriveTopologyGloss(input.gexTopologyStructure),
  };
}

export const dynamic = 'force-dynamic';

const QQQ = QQQ_PCS_SYMBOL;
const QQQ_PCS_TIMELINE_POLICY = 'qqq-pcs-intraday-v1';
const QQQ_GEX_DEBUG = process.env.QQQ_GEX_DEBUG === '1';
const MAX_INTRADAY_AGE_MS = 15 * 60_000;
const EXTERNAL_REQUEST_TIMEOUT_MS = 8_000;
const PAGE_EXTERNAL_REQUEST_TIMEOUT_MS = 3_500;
const PAGE_OPTION_CHAIN_TIMEOUT_MS = 7_500;
const PCS_HELPER_REFERENCE_DTE = SPREAD_TARGET_DTE;
const PCS_HISTORICAL_CACHE_TTL_SECONDS = 6 * 60 * 60;
const PCS_LIVE_SLOW_CACHE_TTL_SECONDS = 15 * 60;
const PCS_LIVE_FAST_CACHE_TTL_SECONDS = 20;
const PCS_LIVE_RESPONSE_CACHE_TTL_SECONDS = PCS_LIVE_FAST_CACHE_TTL_SECONDS;
const GEX_HISTORY_RETENTION_DAYS = 30;
const PCS_HISTORICAL_CACHE_KEY = (regimeMode: PcsRegimeMode, historicalAsOf: string, shape: readonly (string | number | boolean | undefined)[]) =>
  replayCacheKey('qqq_pcs_historical', [QQQ_EXPIRY_CALENDAR_VERSION, historicalAsOf, regimeMode, 'shape-v2', ...shape]);
const PCS_LIVE_SLOW_CACHE_KEY = (now: Date) =>
  replayCacheKey('qqq_pcs_live_slow', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), dailyEvaluationPhase(now)]);
const PCS_LIVE_FAST_CACHE_KEY = (now: Date, livePhase: PcsDailyEvaluationPhase, includeGex = true) =>
  replayCacheKey('qqq_pcs_live_fast', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), livePhase, includeGex ? 'gex' : 'chain-only']);
const PCS_LIVE_MARKET_CACHE_KEY = (now: Date, livePhase: PcsDailyEvaluationPhase) =>
  replayCacheKey('qqq_pcs_live_market', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), livePhase]);
const PCS_LIVE_FAST_PAGE_CACHE_KEY = (now: Date, livePhase: PcsDailyEvaluationPhase, includeGex = true, optionChainTimeoutMs = PAGE_EXTERNAL_REQUEST_TIMEOUT_MS) =>
  replayCacheKey('qqq_pcs_live_fast_page', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), livePhase, includeGex ? 'gex' : 'chain-only', optionChainTimeoutMs]);
const PCS_LIVE_MARKET_PAGE_CACHE_KEY = (now: Date, livePhase: PcsDailyEvaluationPhase) =>
  replayCacheKey('qqq_pcs_live_market_page', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), livePhase]);
const PCS_LIVE_SLOW_PAGE_CACHE_KEY = (now: Date) =>
  replayCacheKey('qqq_pcs_live_slow_page', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), dailyEvaluationPhase(now)]);
type PcsRegimeMode = 'unified' | 'overlay' | 'compare';
export type PcsDailyEvaluationPhase = 'PREMARKET' | 'PRELIMINARY' | 'CLOSED';

type MinuteBar = { timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number };
type IntradaySession = { bars: MinuteBar[]; asOf: string | null };
type DailyClose = { close: number; asOf: string; source: string };

/** The build snapshot is usable only for a session it actually covers. */
export function completedVolatilityFromBuiltHistory(snapshot: Pick<BuiltHistory, 'cutoffDate' | 'vixByDate' | 'vix3mByDate'> | null, date: string | null) {
  const value = (series: Record<string, number> | undefined, label: string): DailyClose | null => {
    const close = date && snapshot && snapshot.cutoffDate >= date ? series?.[date] : undefined;
    return typeof close === 'number' && Number.isFinite(close) && close > 5 && close < 150 && date
      ? { close, asOf: date, source: `Build history ${label}` }
      : null;
  };
  const previousDate = date && snapshot?.cutoffDate && snapshot.cutoffDate >= date
    ? Object.keys(snapshot.vixByDate).filter(day => day < date).sort().at(-1) ?? null
    : null;
  const previousClose = previousDate ? snapshot?.vixByDate[previousDate] : undefined;
  const previousVix = previousDate && typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose > 5 && previousClose < 150
    ? { close: previousClose, asOf: previousDate, source: 'Build history ^VIX prior' }
    : null;
  return { vix: value(snapshot?.vixByDate, '^VIX'), vix3m: value(snapshot?.vix3mByDate, '^VIX3M'), previousVix };
}

export function requiredPcsLiveFactors(phase: PcsDailyEvaluationPhase): string[] {
  const daily = [
    'underlying_price', 'implied_volatility', 'historical_volatility', 'iv_rank', 'vol_premium',
    'vix_price', 'vix3m_price', 'pcs_market_regime', 'market_state',
  ];
  return phase === 'PRELIMINARY'
    ? [...daily, 'qqq_intraday_bars_valid', 'qqq_intraday_vwap', 'qqq_intraday_price']
    : daily;
}

export function shouldReportMissingGexSnapshot(input: { includeGex: boolean; fastPage: boolean; dailyOnly: boolean; useFrozenGexSnapshots: boolean; snapshotCount: number }): boolean {
  return input.includeGex && !input.fastPage && !input.dailyOnly && input.useFrozenGexSnapshots && input.snapshotCount === 0;
}
type DailyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type OptionQuote = { strike: number; bid?: number | null; ask?: number | null; openInterest?: number; volume?: number };
type OptionChainSnapshot = { expiry: number; daysToExpiration: number; puts: OptionContract[]; calls: OptionContract[]; atmIV: number; source?: 'yahoo_live' | 'stored_snapshot'; capturedAt?: string };
type GexOptionChainSnapshot = OptionChainSnapshot & { expiryDate: string; gexDte: number };
const GEX_MAX_DTE = 30;
const PCS_EXPIRY_LOOKAHEAD_DAYS = 10;
type CachedBundleStatus = 'HIT' | 'MISS';
const inFlightBundleLoads = new Map<string, Promise<{ value: unknown; cache: CachedBundleStatus }>>();
const pcsResponseCache = createResponseCache({generation:qqqSourceMetadataCache.generation,shared:redisResponseCachePort('qqq-pcs-http-v2-reference')});

export function pcsLiveResponseCacheKey(input: {
  now: Date;
  livePhase: PcsDailyEvaluationPhase;
  regimeMode: PcsRegimeMode;
  requestedGexExpiry: string | null;
  displayWindow: { fromMs: number; toMs: number } | null;
  latestDisplayWindow: boolean;
  fast?: boolean;
  displayOnly?: boolean;
  dailyOnly?: boolean;
  includeGex?: boolean;
}) {
  return replayCacheKey('qqq_pcs_live_response', [
    'independent-timing-v1', QQQ_EXPIRY_CALENDAR_VERSION,
    easternDateKey(input.now), input.livePhase, input.regimeMode, input.requestedGexExpiry ?? undefined,
    input.displayWindow?.fromMs, input.displayWindow?.toMs, input.latestDisplayWindow, input.fast === true ? 'fast' : 'standard',
    input.displayOnly === true, input.dailyOnly === true,
    input.includeGex !== false,
  ]);
}
type PcsLiveSlowBundle = {
  macro: MacroData | null;
  historyResult: FinancialFactor<any> | null;
  vixHistoryResult: FinancialFactor<any> | null;
  vix3mHistoryResult: FinancialFactor<any> | null;
  vxnHistoryResult: FinancialFactor<any> | null;
};
type PcsLiveMarketBundle = {
  intradayResult: FinancialFactor<any> | null;
  extendedHoursResult: FinancialFactor<any> | null;
};
type PcsLiveFastBundle = {
  intradayResult: PcsLiveMarketBundle['intradayResult'];
  extendedHoursResult: PcsLiveMarketBundle['extendedHoursResult'];
  optionSnapshot: OptionChainSnapshot | null;
  gexOptionSnapshots: GexOptionChainSnapshot[];
};
type PcsContractCandidate =
  | { status: 'READY'; source: 'live_chain' | 'historical_model'; chainSource?: 'yahoo_live' | 'stored_snapshot'; chainCapturedAt?: string; expiry: string; daysToExpiration: number; sigma: number; sigmaReason: string; shortStrike: number; longStrike: number; width: number; netCredit: number; slippage: number; definedRisk: number; annualizedReturn: number; minOpenInterest: number; minVolume: number; model: { expiry: string; daysToExpiration: number; shortStrike: number; longStrike: number } }
  | { status: 'UNAVAILABLE'; reason: string };
type PcsSyntheticResearchCandidate = Omit<Extract<PcsContractCandidate, { status: 'READY' }>, 'source'> & { source: 'synthetic_research' };
type PcsReplayModelTarget =
  | { status: 'READY'; profile: NonNullable<ReturnType<typeof selectPcsContractProfile>>; modelOpen: NonNullable<ReturnType<typeof buildPutCreditSpreadOpen>['open']> }
  | { status: 'UNAVAILABLE'; reason: string };

export function settleExternal<T>(operation: Promise<T>, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    operation.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      () => { clearTimeout(timeout); resolve(null); },
    );
  });
}

/**
 * Supabase cache replication is best-effort. A slow cache write must never
 * delay or invalidate the freshly assembled option-chain response.
 */
export function persistCacheInBackground<T>(key: string, value: T, ttlSeconds: number, replicate = true) {
  void apiCache.set(key, value, ttlSeconds, replicate);
}

async function readCachedBundle<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, replicate = true, shouldPersist: (value: T) => boolean = () => true): Promise<{ value: T; cache: CachedBundleStatus }> {
  const cached = await apiCache.get<T>(key, replicate);
  if (cached) return { value: cached, cache: 'HIT' };
  const existing = inFlightBundleLoads.get(key) as Promise<{ value: T; cache: CachedBundleStatus }> | undefined;
  if (existing) return existing;
  const sharedLoad = (async () => {
    const value = await loader();
    if (shouldPersist(value)) persistCacheInBackground(key, value, ttlSeconds, replicate);
    return { value, cache: 'MISS' as const };
  })();
  inFlightBundleLoads.set(key, sharedLoad as Promise<{ value: unknown; cache: CachedBundleStatus }>);
  try {
    return await sharedLoad;
  } finally {
    if (inFlightBundleLoads.get(key) === sharedLoad) inFlightBundleLoads.delete(key);
  }
}

const eastern = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', ...options,
}).format(date);

export function easternDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Resolve the last completed QQQ session. Yahoo may publish a partial bar for
 * the current session before the close; that bar must not become the
 * "previous-close" qualification input.
 */
export function resolveCompletedCloseDate(now: Date, bars: readonly DailyBar[], selectedAsOf?: string | null) {
  if (selectedAsOf) return selectedAsOf;
  const today = easternDateKey(now);
  return bars.filter((bar) => bar.date < today).at(-1)?.date ?? bars.at(-1)?.date ?? null;
}

function calendarDaysUntilExpiration(expirySeconds: number, now: Date) {
  const expiryDate = new Date(expirySeconds * 1000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${easternDateKey(now)}T00:00:00Z`)) / 86_400_000);
}

function calendarDaysToExpiration(expirySeconds: number, now: Date) {
  return Math.max(1, calendarDaysUntilExpiration(expirySeconds, now));
}

function isRegularSession(date: Date) {
  return qqqMarketSession(date).stocksOpen;
}

function isPremarketSession(date: Date) {
  return qqqMarketSession(date).premarket;
}

export function dailyEvaluationPhase(date: Date): PcsDailyEvaluationPhase {
  return isRegularSession(date) ? 'PRELIMINARY' : isPremarketSession(date) ? 'PREMARKET' : 'CLOSED';
}

/**
 * 盘前/休市时，实时宏观状态可能已经跨到下一个自然日；日线资格必须
 * 对齐最近完成收盘日。正常盘中才允许使用实时宏观状态。
 */
export function resolveDateAlignedLiveRegime(phase: PcsDailyEvaluationPhase, liveRegime: string | null, completedCloseRegime: string | null) {
  return phase === 'PRELIMINARY' ? liveRegime ?? completedCloseRegime : completedCloseRegime ?? liveRegime;
}

/** 正常盘的开仓候选必须继承上一交易日已确认的日线资格。 */
export function shouldEnforcePreviousClosePcsGate(phase: PcsDailyEvaluationPhase, isHistorical: boolean, previousEligibility: PcsDailyEligibility) {
  return !isHistorical && phase === 'PRELIMINARY' && previousEligibility !== 'OPEN';
}

/** API 层只在正常盘且两层日线资格都通过时暴露实时候选结构。 */
export function shouldExposeLivePcsCandidate(phase: PcsDailyEvaluationPhase, dailyEligibility: PcsDailyEligibility, previousCloseEligibility: PcsDailyEligibility) {
  return phase === 'PRELIMINARY' && dailyEligibility === 'OPEN' && previousCloseEligibility === 'OPEN';
}

export function dailySessionProgress(date: Date) {
  const session = qqqMarketSession(date);
  if (session.premarket) return 0;
  if (!session.stocksOpen) return 1;
  return (session.minute - session.openMinute) / (session.stockCloseMinute - session.openMinute);
}

/** Option markets are closed outside regular cash hours; never display a delayed chain as live GEX. */
export function shouldUsePersistedGexSnapshot(phase: PcsDailyEvaluationPhase, isHistorical: boolean, now?: Date) {
  return !isHistorical && (now ? !qqqMarketSession(now).optionsOpen : phase !== 'PRELIMINARY');
}

export function parsePremarketSessionMinutes(payload: unknown, now: Date): MinuteBar[] {
  const result = (payload as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !quote) return [];
  const today = easternDateKey(now);
  return result.timestamp.flatMap((timestamp: number, index: number) => {
    const date = new Date(timestamp * 1000);
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const hasOhlc = [open, high, low].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return easternDateKey(date) === today && isPremarketSession(date) && typeof close === 'number' && Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume >= 0
      ? [{ timestamp: date.toISOString(), close, volume, ...(hasOhlc ? { open, high, low } : {}) }]
      : [];
  });
}

/** 展示专用：QQQ ETF 的可交易扩展时段为 04:00–09:30 与 16:00–20:00 ET；20:00–04:00 没有现货夜盘。 */
export function parseMostRecentExtendedSessionMinutes(payload: unknown): IntradaySession {
  const result = (payload as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !quote) return { bars: [], asOf: null };
  const candidates = (result.timestamp.flatMap((timestamp: number, index: number) => {
    const date = new Date(timestamp * 1000);
    const [hour, minute] = eastern(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    const clock = hour * 60 + minute;
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const isTwoMinuteBoundary = date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 && date.getUTCMinutes() % 2 === 0;
    const session = qqqMarketSession(date);
    const hasOhlc = [open, high, low].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return session.stockAcquisitionOpen && isTwoMinuteBoundary
      && Number.isFinite(close) && close > 0 && Number.isFinite(volume) && volume >= 0
      ? [{ timestamp: date.toISOString(), close, volume, ...(hasOhlc ? { open, high, low } : {}), asOf: easternDateKey(date), clock }]
      : [];
  }) as Array<MinuteBar & { asOf: string; clock: number }>).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const latest = candidates.at(-1) ?? null;
  if (!latest) return { bars: [], asOf: null };
  // 盘前打开页面时，“最新日期”只有 04:00 之后几根。如果只按日期过滤，上一交易日
  // 的盘中/盘后会全部消失。展示层此时保留上一可用交易日的完整 04:00–20:00，
  // 再拼接当前盘前；进入当前日正常盘后，再自然收敛为当前交易日。
  const previousAsOf = latest.clock < 9 * 60 + 30
    ? candidates.filter((bar) => bar.asOf < latest.asOf).at(-1)?.asOf ?? null
    : null;
  const selected = candidates.filter((bar) => bar.asOf === latest.asOf || (previousAsOf !== null && bar.asOf === previousAsOf));
  return {
    bars: selected.map(({ asOf: _asOf, clock: _clock, ...bar }) => bar),
    asOf: latest.asOf,
  };
}

export function parsePremarketQuote(payload: unknown, now: Date): { close: number; asOf: string } | null {
  const latest = parsePremarketSessionMinutes(payload, now).at(-1);
  return latest ? { close: latest.close, asOf: latest.timestamp } : null;
}

export function dailyConfirmationScore(phase: PcsDailyEvaluationPhase, progress: number, intradayFresh: boolean) {
  if (phase === 'CLOSED') return 100;
  if (phase === 'PREMARKET') return intradayFresh ? 20 : 15;
  return Math.min(95, Math.round(15 + Math.max(0, Math.min(1, progress)) * 75 + (intradayFresh ? 10 : 0)));
}

export function parseRegularSessionMinutes(payload: unknown, requestedDate?: string): IntradaySession {
  const result = (payload as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !quote) return { bars: [], asOf: null };
  const candidates: Array<MinuteBar & { asOf: string }> = result.timestamp.flatMap((timestamp: number, index: number) => {
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    const date = new Date(timestamp * 1000);
    const isTwoMinuteBoundary = date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 && date.getUTCMinutes() % 2 === 0;
    if (
      !isRegularSession(date)
      || !isTwoMinuteBoundary
      || !Number.isFinite(close) || close <= 0
      || !Number.isFinite(volume) || volume < 0
    ) return [];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const hasOhlc = [open, high, low].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return [{ timestamp: date.toISOString(), close, volume, ...(hasOhlc ? { open, high, low } : {}), asOf: date.toISOString().slice(0, 10) }];
  });
  const asOf = requestedDate ?? candidates.at(-1)?.asOf ?? null;
  return { bars: asOf ? candidates.filter((bar) => bar.asOf === asOf).map(({ asOf: _asOf, ...bar }: MinuteBar & { asOf: string }) => bar) : [], asOf };
}

export function parseMostRecentRegularSessionMinutes(payload: unknown): IntradaySession {
  return parseRegularSessionMinutes(payload);
}

export function parseRegularSessionMinutesForDate(payload: unknown, date: string): IntradaySession {
  return parseRegularSessionMinutes(payload, date);
}

/**
 * 09:30 边界 Yahoo 可能尚未发布当日首根 2m bar，此时“最近常规盘”仍是上一交易日。
 * 盘中只接受美东当天的常规盘；首根到达前继续展示当天盘前，绝不把昨日常规盘冒充今日。
 */
export function selectQqqLiveIntradaySession(input: {
  now: Date;
  phase: PcsDailyEvaluationPhase;
  regularSession: IntradaySession;
  premarketBars: MinuteBar[];
}) {
  const today = easternDateKey(input.now);
  const premarketSession: IntradaySession = {
    bars: input.premarketBars,
    asOf: input.premarketBars.length ? today : null,
  };
  if (input.phase === 'PREMARKET') {
    return { session: premarketSession, displaySession: 'PREMARKET' as const, regularSessionIsCurrent: false };
  }
  const regularSessionIsCurrent = input.regularSession.asOf === today && input.regularSession.bars.length > 0;
  if (input.phase === 'PRELIMINARY') {
    if (regularSessionIsCurrent) return { session: input.regularSession, displaySession: 'REGULAR' as const, regularSessionIsCurrent: true };
    if (premarketSession.bars.length) return { session: premarketSession, displaySession: 'PREMARKET' as const, regularSessionIsCurrent: false };
    return { session: { bars: [], asOf: null }, displaySession: 'REGULAR' as const, regularSessionIsCurrent: false };
  }
  return { session: input.regularSession, displaySession: 'REGULAR' as const, regularSessionIsCurrent };
}

/** 开盘后的 EXT 只由“当日盘前/盘后 + 当日常规盘”组成；跨日连续图仅保留在盘前手动查看模式。 */
export function buildQqqExtendedHoursDisplayBars(input: {
  now: Date;
  phase: PcsDailyEvaluationPhase;
  extendedBars: MinuteBar[];
  regularBars: MinuteBar[];
}) {
  if (input.phase !== 'PRELIMINARY') return input.extendedBars;
  const today = easternDateKey(input.now);
  const todayExtended = input.extendedBars.filter((bar) => easternDateKey(new Date(bar.timestamp)) === today);
  return mergeQqqIntradayCandles(todayExtended, input.regularBars);
}

export function dailyCloses(payload: unknown): DailyClose[] {
  const result = (payload as any)?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(result?.timestamp) || !Array.isArray(closes)) return [];
  return result.timestamp.flatMap((timestamp: number, index: number) => {
    const close = closes[index];
    return typeof close === 'number' && Number.isFinite(close) && close > 0
      ? [{ close, asOf: new Date(timestamp * 1000).toISOString().slice(0, 10), source: 'Yahoo' }]
      : [];
  });
}

export function dailyCloseAt(payload: unknown, asOf: string, previous = false): DailyClose | null {
  const matches = dailyCloses(payload).filter((point) => point.asOf <= asOf);
  return matches.at(previous ? -2 : -1) ?? null;
}

export function dailyCloseOn(payload: unknown, asOf: string): DailyClose | null {
  return dailyCloses(payload).find((point) => point.asOf === asOf) ?? null;
}

export function dailyMapCloseOn(values: Record<string, number> | undefined, asOf: string | null): DailyClose | null {
  if (!asOf) return null;
  const close = values?.[asOf];
  return typeof close === 'number' && Number.isFinite(close) && close > 0 ? { close, asOf, source: '' } : null;
}

export function dailyBars(payload: unknown): DailyBar[] {
  const result = (payload as any)?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !quote) return [];
  return result.timestamp.flatMap((timestamp: number, index: number) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (![open, high, low, close].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return [];
    return [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), open, high, low, close, volume: Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : 0 }];
  });
}

export function parseRegimeMode(request: Request): PcsRegimeMode {
  const mode = new URL(request.url).searchParams.get('regimeMode');
  return mode === 'overlay' || mode === 'compare' ? mode : 'unified';
}

function historicalAsOf(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('asOf');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function selectedGexExpiry(request: Request): string | null {
  const value = new URL(request.url).searchParams.get('gexExpiry');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** 展示页专用的当日时间窗；不参与 PCS 因子、决策或快照写入。 */
export function gexDisplayWindow(request: Request, now: Date) {
  const params = new URL(request.url).searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!from && !to) return null;
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  // 只允许当前美东交易日，防止独立图表意外变成跨日历史下载接口。
  if (easternDateKey(new Date(fromMs)) !== easternDateKey(now) || easternDateKey(new Date(toMs)) !== easternDateKey(now)) return null;
  return { fromMs, toMs };
}

function requestsLatestGexDisplayWindow(request: Request) {
  return new URL(request.url).searchParams.get('gexWindow') === 'latest';
}

function isGexDisplayRequest(request: Request) {
  return new URL(request.url).searchParams.get('gexDisplay') === '1';
}

function previousWeekday(date: Date) {
  const candidate = new Date(date);
  for (let index = 0; index < 7; index += 1) {
    const weekday = eastern(candidate, { weekday: 'short' });
    if (weekday !== 'Sat' && weekday !== 'Sun') return candidate;
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return candidate;
}

function persistedProfile(point: QqqLatestGexExpirySnapshot['profile'][number]) {
  return {
    strike: point.strike,
    magnitude: point.totalGex,
    isCallWall: point.isCallWall,
    isPutWall: point.isPutWall,
    isGammaFlip: point.isGammaFlip,
  };
}

function buildFastDisplayExpiry(
  snapshot: QqqLatestGexExpirySnapshot,
  history: Awaited<ReturnType<typeof readQqqGexExpiryHistory>>,
  price: number,
  now: Date,
) {
  // The latest-window path supplies compact same-day summaries so a fresh page
  // load can immediately render the session table. The current full snapshot
  // below owns the matching bucket's profile and must win over its summary row.
  const currentVersion = snapshot.profile[0]?.calculationVersion ?? 'qqq-gex-legacy-v1';
  const profileVersions = new Map((history?.profiles ?? []).map(p => [p.time, p.strikes[0]?.calculationVersion ?? 'qqq-gex-legacy-v1']));
  const summaryPoints = (history?.summary ?? []).filter(point => point.time !== snapshot.capturedAt && (point.calculationVersion ?? profileVersions.get(point.time) ?? 'qqq-gex-legacy-v1') === currentVersion);
  const profileByTime = new Map((history?.profiles ?? []).map((point) => [point.time, point.strikes]));
  const coverageByTime = new Map((history?.profiles ?? []).map(point=>[point.time,point.strikeCoverage]));
  const points = [...summaryPoints.map((point) => ({ ...point, profile: profileByTime.get(point.time) ?? [] })), {
    time: snapshot.capturedAt,
    expiryDate: snapshot.expiryDate,
    dte: snapshot.dte,
    spot: snapshot.spot,
    netGex: snapshot.netGex,
    gammaFlip: snapshot.gammaFlip,
    callWallPrice: snapshot.callWallPrice,
    callWallMagnitude: snapshot.callWallMagnitude,
    putWallPrice: snapshot.putWallPrice,
    putWallMagnitude: snapshot.putWallMagnitude,
    kingStrike: snapshot.kingStrike,
    kingMagnitude: snapshot.kingMagnitude,
    kingSide: snapshot.kingSide,
    profile: snapshot.profile,
  }].filter((point, index, all) => all.findIndex((candidate) => candidate.time === point.time) === index)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const wallHistory = points.map((point) => ({
    time: point.time,
    callWallPrice: point.callWallPrice,
    putWallPrice: point.putWallPrice,
    callWallMagnitude: point.callWallMagnitude,
    putWallMagnitude: point.putWallMagnitude,
    kingStrike: point.kingStrike,
    kingMagnitude: point.kingMagnitude,
    kingSide: point.kingSide,
  }));
  const fullHistory = points.map((point) => ({ time: point.time, strikes: profileByTime.get(point.time) ?? point.profile,
    ...(coverageByTime.get(point.time)?{strikeCoverage:coverageByTime.get(point.time)}:{}) }));
  const topHistory = fullHistory.map((point) => ({
    time: point.time,
    strikes: point.strikes.slice().sort((left, right) => Math.abs(right.totalGex) - Math.abs(left.totalGex)).slice(0, 8).sort((left, right) => left.strike - right.strike).map(persistedProfile),
  }));
  const profile = snapshot.profile.slice().sort((left, right) => Math.abs(right.totalGex) - Math.abs(left.totalGex)).slice(0, 8).sort((left, right) => left.strike - right.strike).map(persistedProfile);
  const summary = buildPersistedGexSummary(snapshot);
  return {
    asOf: snapshot.capturedAt,
    expiryDate: snapshot.expiryDate,
    dte: snapshot.dte,
    gex: points.map((point) => ({ time: point.time, totalGex: point.netGex, gammaFlipLevel: point.gammaFlip })),
    gexProfile: profile,
    gexProfileHistory: topHistory,
    fullGexProfile: snapshot.profile,
    fullGexProfileHistory: fullHistory,
    gexSummary: summary,
    wallHistory,
    terminal: null,
    research: null,
    gexInsights: buildGexInsights({ spot: price || snapshot.spot, gexSummary: summary, gexTopologyStructure: null, wallHistory, candidateShortStrike: undefined, now }),
  };
}

/**
 * 展示页的只读快路径：盘中读最新落库 GEX，休盘读收盘快照，不触发 PCS
 * 的 slow bundle、Yahoo 2m historical 或实时期权链重试。方向提醒仍走
 * 唯一 FactorMap→VerdictEngine→DecisionEngine 主链；陈旧数据会 fail-closed。
 */
const displaySources = new Map<string, ReturnType<typeof createQqqVersionedSource<{
  candles: Awaited<ReturnType<typeof readLatestQqqIntradayCandles>>;
  snapshots: Awaited<ReturnType<typeof readLatestQqqGexExpirySnapshots>>;
  savedSignals: Awaited<ReturnType<typeof readQqqIntradayDirectionalSignals>>;
  gammaPositionHistory: Awaited<ReturnType<typeof readQqqGammaPositionHistory>>;
  directionalHistories: Awaited<ReturnType<typeof readQqqGexExpirySummaries>>;
}>>>();
// Overview, monitoring and requested-DTE evidence share the exact base revision.
const displayBaseLoads = new Map<string, {until:number;task:Promise<{
  candles: Awaited<ReturnType<typeof readLatestQqqIntradayCandles>>;
  snapshots: Awaited<ReturnType<typeof readLatestQqqGexExpirySnapshots>>;
}>}>();
async function buildQqqGexDisplayFastPayload(input: {
  now: Date;
  timelinePolicy: string;
  requestedExpiry: string | null;
  displayWindow: { fromMs: number; toMs: number } | null;
  latestDisplayWindow: boolean;
  phase: PcsDailyEvaluationPhase;
  overview: boolean;
  evidenceOnly?: boolean;
}) {
  const live = qqqMarketSession(input.now).optionsOpen;
  // Every overview reads the same complete latest capture. DTE selection is a
  // response projection, so switching it must not duplicate source transfers.
  const sourceKey = `${QQQ_GEX_CALCULATION_VERSION}:${input.timelinePolicy}:${easternDateKey(input.now)}:${live ? 'live' : 'frozen-replay-v2'}:${input.overview ? 'all' : input.requestedExpiry ?? 'default'}:${input.overview ? 'overview' : 'evidence'}`;
  let source = displaySources.get(sourceKey);
  if (!source) {
    source = createQqqVersionedSource(async () => {
      const result = await supabaseAdmin.from('qqq_gex_display_revision').select('revision').eq('id',true).abortSignal(AbortSignal.timeout(5000)).single();
      // Missing revision table never authorizes reuse of potentially stale data.
      return result.error ? `unavailable:${Date.now()}` : String(result.data.revision);
    }, async (revision) => {
      const now = new Date();
      const baseKey = JSON.stringify([input.timelinePolicy, easternDateKey(now), live, revision]);
      let base = displayBaseLoads.get(baseKey);
      if(base && base.until <= Date.now()){displayBaseLoads.delete(baseKey);base=undefined;}
      if (!base) {
        const task = Promise.all([readLatestQqqIntradayCandles(now),readLatestQqqGexExpirySnapshots({policyId:input.timelinePolicy,from:new Date(now.getTime()-GEX_HISTORY_RETENTION_DAYS*86400000).toISOString(),now,mode:live ? 'live' : 'frozen'})]).then(([candles,snapshots]) => ({candles,snapshots}));
        base={task,until:Date.now()+300_000};
        displayBaseLoads.set(baseKey, base);
        const owned = base;
        void base.task.catch(() => { if (displayBaseLoads.get(baseKey) === owned) displayBaseLoads.delete(baseKey); });
        while (displayBaseLoads.size > 3) displayBaseLoads.delete(displayBaseLoads.keys().next().value!);
      }
      const { candles, snapshots } = await base.task;
      const dayStart=easternDayStartUtc(new Date(candles.at(-1)?.timestamp ?? snapshots?.[0]?.capturedAt ?? now.toISOString()));
      const to=new Date(dayStart.getTime()+86400000).toISOString();
      const historyExpiries = input.overview ? [] : [...new Set([
        ...(snapshots ?? []).slice(0, 3).map(snapshot => snapshot.expiryDate),
        ...(input.requestedExpiry && snapshots?.some(snapshot => snapshot.expiryDate === input.requestedExpiry) ? [input.requestedExpiry] : []),
      ])].slice(0, 4);
      const modelExpiry = input.requestedExpiry && snapshots?.some(s => s.expiryDate === input.requestedExpiry) ? input.requestedExpiry : snapshots?.[0]?.expiryDate;
      if (!snapshots) throw Error('GEX 展示快照读取暂不可用');
      const evidence = await loadQqqDisplayEvidence(input.overview, {
        signals: () => input.overview ? Promise.resolve(null) : readQqqIntradayDirectionalSignals({from:dayStart.toISOString(),to}),
        histories: () => historyExpiries.length ? readQqqGexExpirySummaries({policyId:input.timelinePolicy,expiryDates:historyExpiries,from:dayStart.toISOString(),to}) : Promise.resolve(null),
        gamma: () => modelExpiry ? readQqqGammaPositionHistory({revision,policyId:input.timelinePolicy,expiryDate:modelExpiry,from:dayStart.toISOString(),to:now.toISOString()}) : Promise.resolve([]),
      });
      const savedSignals = evidence?.signals ?? null;
      const directionalHistories = evidence?.histories ?? new Map();
      const gammaPositionHistory = evidence?.gamma ?? [];
      return {candles,snapshots,savedSignals,directionalHistories,gammaPositionHistory};
    });
    displaySources.set(sourceKey,source);
    while(displaySources.size>3)displaySources.delete(displaySources.keys().next().value!);
  }
  const {candles,snapshots,savedSignals,directionalHistories,gammaPositionHistory}=await source();
  const storedDay = new Date(candles.at(-1)?.timestamp ?? snapshots?.[0]?.capturedAt ?? input.now.toISOString());
  const sessionDate = easternDateKey(storedDay);
  const sessionSnapshots = qqqGexExpiriesForSession(snapshots ?? [], sessionDate);
  const selectedExpiry = input.requestedExpiry && sessionSnapshots.some((snapshot) => snapshot.expiryDate === input.requestedExpiry)
    ? input.requestedExpiry
    : sessionSnapshots[0]?.expiryDate ?? null;
  const history = selectedExpiry && (input.displayWindow || !input.latestDisplayWindow)
    ? input.overview ? await (async()=>{
        const from=new Date(input.displayWindow?.fromMs ?? easternDayStartUtc(storedDay).getTime()).toISOString();
        const to=new Date((input.displayWindow?.toMs ?? easternDayStartUtc(storedDay).getTime()+86400000)+1).toISOString();
        const day=await readQqqGexDisplayDay({from,to,expiryDate:selectedExpiry});
        return {summary:day.items.map(row=>({...row,time:row.capturedAt})),profiles:day.items.map(row=>({time:row.capturedAt,strikes:row.profile,strikeCoverage:row.strikeCoverage}))};
      })() : await readQqqGexExpiryHistory({
        policyId: input.timelinePolicy,
        expiryDate: selectedExpiry,
        displayOnly: true,
        from: new Date(input.displayWindow?.fromMs ?? input.now.getTime() - GEX_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString(),
        profileFrom: new Date(input.displayWindow?.fromMs ?? input.now.getTime() - GEX_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString(),
        ...(input.displayWindow ? { to: new Date(input.displayWindow.toMs).toISOString() } : {}),
      })
    : null;
  const price = candles.at(-1)?.close ?? snapshots?.[0]?.spot ?? 0;
  const selectedHistory = selectedExpiry
    ? history ?? { summary: directionalHistories?.get(selectedExpiry) ?? [], profiles: [] }
    : null;
  const gexExpiries = sessionSnapshots.map((snapshot) => ({ ...buildFastDisplayExpiry(snapshot, snapshot.expiryDate === selectedExpiry ? selectedHistory : null, price, input.now), dte: qqqGexSessionDte(snapshot.expiryDate, sessionDate, snapshot.dte) }));
  const primary = gexExpiries[0] ?? null;
  // Price history is small and is also the analytical input for session VWAP,
  // Wilder RSI and EMA/ATR. Cropping it to a viewport changes those values.
  const bars = candles;
  const directionalBars = qqqDirectionalRegularBars(candles);
  const directionalBuild = buildQqqIntradayDirectionalFactors({
    asOf: input.now.toISOString(),
    bars: directionalBars,
    expiries: (input.overview ? [] : snapshots ?? []).map((snapshot) => ({
      expiryDate: snapshot.expiryDate,
      dte: snapshot.dte,
      // Keep prior causal buckets when the newest capture is after the last
      // completed price bar. Display-window cropping never limits decisions.
      snapshots: [...(directionalHistories?.get(snapshot.expiryDate) ?? []).filter(point=>point.time!==snapshot.capturedAt).map(point=>({...point,time:point.availableAt ?? point.time})), {
        ...qqqDirectionalGexSnapshot(snapshot.capturedAt,null,snapshot.profile),
        netGex: snapshot.netGex,
        gammaFlip: snapshot.gammaFlip,
        callWallPrice: snapshot.callWallPrice,
        putWallPrice: snapshot.putWallPrice,
        profile: snapshot.profile,
      }],
    })),
  });
  const computed = evaluateQqqDirectionalWithHistory(directionalBuild.factors, directionalBars, savedSignals ?? []);
  const directional = qqqDisplayDecision(computed,directionalHistories !== null ? savedSignals ?? [] : [],input.now.getTime(),directionalBars);
  const unavailable = <T,>(value: T, reason: string) => fallbackFactor(value, reason);
  const response = {
    symbol: QQQ,
    asOf: primary?.asOf ?? candles.at(-1)?.timestamp ?? input.now.toISOString(),
    observedAt: live ? input.now.toISOString() : new Date(Math.min(input.now.getTime(), gexExpiries.length ? Math.max(...gexExpiries.map(expiry=>Date.parse(qqqDirectionalGexTime(expiry.asOf,null,expiry.fullGexProfile)))) : Date.parse(candles.at(-1)?.timestamp ?? input.now.toISOString()))).toISOString(),
    view: { mode: 'live' as const, date: easternDateKey(storedDay) },
    intraday: bars.length ? {
      granularity: '2m' as const,
      session: input.phase === 'PREMARKET' ? 'PREMARKET' as const : qqqMarketSession(input.now).postmarket ? 'POSTMARKET' as const : 'REGULAR' as const,
      gammaPositionHistory,
      bars,
      extendedHoursBars: [],
      scoreSeries: [],
      gex: primary?.gex ?? [],
      gexProfile: primary?.gexProfile ?? [],
      gexProfileHistory: primary?.gexProfileHistory ?? [],
      gexSummary: primary?.gexSummary ?? null,
      wallHistory: primary?.wallHistory ?? [],
      gexInsights: primary?.gexInsights ?? null,
      gexExpiries,
      gexAsOf: primary?.asOf ?? null,
      terminal: null,
      directional: { current: directional, signals: savedSignals ?? [], liveStatus: { available: savedSignals !== null && directionalHistories !== null, reason: savedSignals === null || directionalHistories === null ? '方向证据正在独立加载。' : null } },
    } : null,
    intradaySessionAsOf: candles.length ? easternDateKey(new Date(candles.at(-1)!.timestamp)) : null,
    dataStatus: live && primary?.fullGexProfile?.every((p: {inputComplete?: boolean}) => p.inputComplete !== false) && computed.dataQuality.validExpiries >= QQQ_INTRADAY_DIRECTIONAL_POLICY.minExpiries && computed.dataQuality.barAgeSeconds !== null && computed.dataQuality.barAgeSeconds <= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxBarAgeSeconds
      && computed.dataQuality.gexAgeSeconds !== null && computed.dataQuality.gexAgeSeconds <= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds ? 'LIVE' as const : 'STALE' as const,
    dataIssues: ['展示快路径：使用最近一次已落库的 QQQ K 线与 GEX 快照。'],
    daily: {
      eligibility: unavailable('UNAVAILABLE' as const, '展示快路径不计算 PCS 日线资格'),
      reasons: ['展示快路径不执行 PCS 决策链。'],
      phase: input.phase,
      asOf: easternDateKey(storedDay),
      priceBasis: 'PREVIOUS_CLOSE' as const,
      confirmation: unavailable(0, '展示快路径不计算日线确认'),
    },
    regime: { mode: 'unified' as const, selectedEngine: 'unified' as const, unified: null, overlay: null, disagreement: false },
    timing: unavailable('INSUFFICIENT_DATA' as const, '展示快路径不计算 PCS 入场时机'),
    lifecycle: { available: false, points: [] },
    factors: directionalBuild.factors,
    candidate: { status: 'UNAVAILABLE' as const, reason: '展示快路径不计算 PCS 合约候选。' },
    syntheticCandidate: null,
    probabilityContext: { strikeSurvival: null, anchoredManageability: null },
  };
  return input.evidenceOnly ? response : projectQqqGexDisplayPayload(response, input.requestedExpiry, candles);
}

export function latestGexDisplayWindow(bars: readonly { timestamp: string }[]) {
  const latest = bars.at(-1);
  const toMs = latest ? Date.parse(latest.timestamp) : NaN;
  return Number.isFinite(toMs) ? { fromMs: toMs - 90 * 60_000, toMs } : null;
}

export function withinGexDisplayWindow<T extends { time?: string; timestamp?: string }>(items: readonly T[], window: { fromMs: number; toMs: number } | null) {
  if (!window) return items;
  return items.filter((item) => {
    const value = item.time ?? item.timestamp;
    const ms = value ? Date.parse(value) : NaN;
    return Number.isFinite(ms) && ms >= window.fromMs && ms <= window.toMs;
  });
}

/**
 * 展示接口的第二层边界：窗口裁切之后，只给当前选中的到期日发送完整
 * profile history。其它到期日仍保留摘要和最后一个快照，供到期日切换
 * 控件显示，但不把相同的 Top-N/全量 profile 历史重复塞进首屏响应。
 *
 * 这个投影只作用于 HTTP response；`payload` 本身仍由完整输入参与 PCS
 * 因子、VerdictEngine、DecisionEngine 和缓存，因而不会改变决策主链。
 */
export function projectQqqGexDisplayPayload<T extends { intraday?: unknown }>(payload: T, selectedExpiry: string | null, valuationBars?: readonly { timestamp: string; close: number }[]): T {
  const intraday = payload.intraday;
  if (!intraday || typeof intraday !== 'object' || (intraday as { granularity?: unknown }).granularity !== '2m') return payload;
  const record = intraday as Record<string, unknown>;
  const expiries = Array.isArray(record.gexExpiries) ? record.gexExpiries : [];
  if (!expiries.length) return payload;
  const activeExpiry = expiries.find((expiry) => (
    expiry && typeof expiry === 'object' && (expiry as { expiryDate?: unknown }).expiryDate === selectedExpiry
  )) ?? expiries[0];
  const modelExpiries = expiries.filter((expiry): expiry is GammaModelExpiry => Boolean(expiry && typeof expiry === 'object' &&
    typeof (expiry as GammaModelExpiry).asOf === 'string' && Array.isArray((expiry as GammaModelExpiry).fullGexProfile)));
  const bars = valuationBars ?? (Array.isArray(record.bars) ? record.bars : []);
  // Observation is set by the server/request contract, never advanced by market inputs.
  const clockPayload=payload as {observedAt?:unknown;asOf?:unknown};
  const modelAsOf=typeof clockPayload.observedAt==='string'?clockPayload.observedAt:typeof clockPayload.asOf==='string'?clockPayload.asOf:'';
  const cutoff=Date.parse(modelAsOf);
  const intervalSeconds = record.granularity === '5m' ? 300 : 120;
  const causalBars=bars.filter((b):b is {timestamp:string;close:number}=>Boolean(b&&typeof b==='object'&&typeof (b as any).timestamp==='string'&&Date.parse((b as any).timestamp)+intervalSeconds*1000<=cutoff)).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const selectedInputs=modelExpiries.filter(expiry=>expiry===activeExpiry);
  const cachedModels=record.gammaModels as {selected?:ReturnType<typeof buildQqqGammaModel>;available?:ReturnType<typeof buildQqqGammaModel>}|undefined;
  // A repeated projection may contain only the cropped chart window. Reuse
  // the already-computed causal model price only at the identical observation.
  const cachedSpot=cachedModels?.available?.asOf===modelAsOf ? cachedModels.available.spot : NaN;
  const spot=Number(causalBars.at(-1)?.close ?? cachedSpot);
  const reusable=(m:ReturnType<typeof buildQqqGammaModel>|undefined,inputs:GammaModelExpiry[])=>m&&m.asOf===modelAsOf&&m.spot===spot&&m.volatilityTrigger.version==='net-gamma-cushion-v3'&&m.inputQualityVersion===QQQ_GAMMA_INPUT_VERSION&&
    inputs.every(e=>Date.parse(e.asOf)<=cutoff&&Date.parse(qqqDirectionalGexTime(e.asOf,null,e.fullGexProfile))<=cutoff)&&
    m.expiries.every(date=>inputs.some(e=>e.expiryDate===date));
  const selected=reusable(cachedModels?.selected,selectedInputs)?cachedModels!.selected!:buildQqqGammaModel(selectedInputs,spot,modelAsOf,{includeSensitivity:true});
  const available=reusable(cachedModels?.available,modelExpiries)?cachedModels!.available!:modelExpiries.length===selectedInputs.length?selected:buildQqqGammaModel(modelExpiries,spot,modelAsOf,{includeSensitivity:true});
  const gammaModels={selected,available};
  const projectedExpiries = expiries.map((expiry) => {
    if (!expiry || typeof expiry !== 'object') return expiry;
    if (expiry === activeExpiry) {
      const active = expiry as Record<string, any>;
      return { ...active, fullGexProfile: qqqChartProfile(active.fullGexProfile ?? []),
        fullGexProfileHistory: (active.fullGexProfileHistory ?? []).map((point: any) => Array.isArray(point.strikes)? {...point,strikes:qqqChartProfile(point.strikes)}:point) };
    }
    const value = expiry as Record<string, unknown>;
    const gex = Array.isArray(value.gex) ? value.gex : [];
    const wallHistory = Array.isArray(value.wallHistory) ? value.wallHistory : [];
    return {
      ...value,
      gex: gex.slice(-1),
      gexProfile: [],
      gexProfileHistory: [],
      fullGexProfile: qqqChartProfile((value.fullGexProfile ?? []) as Parameters<typeof qqqChartProfile>[0]),
      fullGexProfileHistory: [],
      wallHistory: wallHistory.slice(-1),
    };
  });
  const displayPayload = { ...payload } as Record<string, unknown>;
  // standalone GEX 已经由 terminal/candidate/daily/timing 消费展示所需状态；
  // 完整 FactorMap 与 lifecycle 仍在服务端参与 PCS 决策，但不随图表接口
  // 重复传输。普通 `/api/analysis/qqq/pcs` 请求不经过这个投影。
  delete displayPayload.factors;
  delete displayPayload.lifecycle;
  return {
    ...displayPayload,
    intraday: {
      ...record,
      gammaModels,
      // standalone 页面从 gexExpiries 的 active bucket 读取这些字段；清掉
      // 顶层重复副本，避免同一套历史同时占用 response 和 JSON parse 时间。
      gex: [],
      gexProfile: [],
      gexProfileHistory: [],
      wallHistory: [],
      gexExpiries: projectedExpiries,
    },
  } as T;
}

function optionQuote(option: OptionQuote) {
  const bid = Number(option.bid);
  const ask = Number(option.ask);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask >= bid ? { bid, ask, mid: (bid + ask) / 2 } : null;
}

function optionIv(option: Record<string, unknown>) {
  if(typeof option.impliedVolatility!=='number' && !(typeof option.impliedVolatility==='string' && option.impliedVolatility.trim()!==''))return 0;
  const iv = Number(option.impliedVolatility);
  return Number.isFinite(iv) && iv > 0 ? iv : 0;
}

function deriveOptionGreeks(option: Record<string, unknown>, input: { spot: number; expiry: number; now: Date; type: 'call' | 'put' }) {
  const delta = Number(option.delta);
  const gamma = Number(option.gamma);
  const theta = Number(option.theta);
  const vega = Number(option.vega);
  if ([option.delta, option.gamma, option.theta, option.vega].every(value => value !== null && value !== undefined) && [delta, gamma, theta, vega].every(Number.isFinite)) {
    return { delta, gamma, theta, vega };
  }
  const iv = optionIv(option);
  const strike = Number(option.strike);
  const spot = input.spot;
  if (!(iv > 0) || !(strike > 0) || !(spot > 0)) return null;
  const t = (qqqGammaExpiryTime(new Date(input.expiry * 1000).toISOString().slice(0, 10)) - input.now.getTime()) / 31536000000;
  const greeks = blackScholesEngine.price({ S: spot, K: strike, T: t, r: 0.04, sigma: iv, type: input.type });
  return { delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega };
}

function normalizeOptionContract(option: Record<string, unknown>, input: { spot: number; expiry: number; now: Date; type: 'call' | 'put'; receivedAt?: string }): OptionContract {
  const bid = Number(option.bid);
  const ask = Number(option.ask);
  const mid = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask >= bid ? (bid + ask) / 2 : null;
  const iv = optionIv(option);
  const greeks = deriveOptionGreeks(option, input);
  return {
    strike: Number(option.strike),
    bid: Number.isFinite(bid) && bid > 0 ? bid : null,
    ask: Number.isFinite(ask) && ask > 0 ? ask : null,
    mid,
    lastPrice: Number.isFinite(Number(option.lastPrice)) && Number(option.lastPrice) > 0 ? Number(option.lastPrice) : null,
    lastTradeDate: Number.isFinite(Number(option.lastTradeDate)) ? Number(option.lastTradeDate) : null,
    receivedAt: input.receivedAt,
    iv,
    delta: greeks?.delta,
    theta: greeks?.theta,
    gamma: greeks?.gamma,
    vega: greeks?.vega,
    volume: Number.isFinite(Number(option.volume)) ? Number(option.volume) : undefined,
    openInterest: option.openInterest !== null && option.openInterest !== undefined && Number.isFinite(Number(option.openInterest)) && Number(option.openInterest) >= 0 ? Number(option.openInterest) : undefined,
    inTheMoney: option.inTheMoney === true,
  };
}

export async function loadQqqGexOptionChainSnapshots(now: Date, includeGex = true, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS): Promise<GexOptionChainSnapshot[]> {
  const initial = await settleExternal(yahooFinanceServer.getOptions(QQQ, undefined, timeoutMs), timeoutMs);
  const result = initial?.value?.optionChain?.result?.[0];
  const expirations = ((result?.expirationDates ?? []) as unknown[]).map(Number).filter((value: number) => Number.isFinite(value));
  const selected = selectQqqOptionExpirations(expirations, now, includeGex);
  const readStoredFallback = async () => (await loadFreshQqqOptionChainSnapshots(now)).map(({ underlyingPrice: _underlyingPrice, snapshotTime: _snapshotTime, ...snapshot }) => snapshot);
  if (!selected.length) return (await settleExternal(readStoredFallback(), timeoutMs)) ?? [];
  const spot = Number(initial?.value?.optionChain?.result?.[0]?.quote?.regularMarketPrice);
  const fallbackSpot = Number.isFinite(spot) && spot > 0 ? spot : Number(result?.quote?.regularMarketPrice);
  const chains = await Promise.all(selected.map((expiry) => settleExternal(yahooFinanceServer.getOptions(QQQ, expiry, timeoutMs), timeoutMs)));
  const yahooSnapshots = chains.flatMap((chain, index) => {
    const expiry = selected[index]!;
    const receivedAt = chain?.value?.optionChain?.result?.[0]?.receivedAt;
    const optionSet = chain?.value?.optionChain?.result?.[0]?.options?.[0];
    if (!optionSet) return [];
    const rawCalls = Array.isArray(optionSet.calls) ? optionSet.calls as Record<string, unknown>[] : [];
    const rawPuts = Array.isArray(optionSet.puts) ? optionSet.puts as Record<string, unknown>[] : [];
    const atmIV = qqqAtmIv(rawCalls.map(p=>({strike:Number(p.strike),iv:optionIv(p)})),rawPuts.map(p=>({strike:Number(p.strike),iv:optionIv(p)})),fallbackSpot || 0);
    return [{
      expiry, expiryDate: new Date(expiry * 1000).toISOString().slice(0, 10), gexDte: calendarDaysUntilExpiration(expiry, now),
      daysToExpiration: calendarDaysToExpiration(expiry, now),
      puts: rawPuts.map((option) => normalizeOptionContract(option, { spot: fallbackSpot || 0, expiry, now, type: 'put', receivedAt })),
      calls: rawCalls.map((option) => normalizeOptionContract(option, { spot: fallbackSpot || 0, expiry, now, type: 'call', receivedAt })),
      atmIV,
      source: chain?.value?.optionChain?.result?.[0]?.sharedCapture ? 'stored_snapshot' as const : 'yahoo_live' as const,
      capturedAt: receivedAt ?? now.toISOString(),
    }];
  });
  // QQQ adapter reads the shared latest chains. Consult derived history only
  // when that shared surface is incomplete or lacks the PCS target expiry.
  if (yahooSnapshots.length === selected.length && yahooSnapshots.some((snapshot) => snapshot.gexDte >= PCS_HELPER_REFERENCE_DTE)) return yahooSnapshots.sort((left, right) => left.gexDte - right.gexDte);
  return mergeQqqOptionChainSnapshots(yahooSnapshots, (await settleExternal(readStoredFallback(), timeoutMs)) ?? [])
    .sort((left, right) => left.gexDte - right.gexDte);
}

/** GEX needs the near-term surface, while PCS also needs the first listed expiry at or beyond its target DTE. */
export function selectQqqOptionExpirations(expirations: readonly number[], now: Date, includeGex = true) {
  const available = expirations.filter((expiry) => Number.isFinite(expiry) && calendarDaysUntilExpiration(expiry, now) >= 0).sort((left, right) => left - right);
  if (!includeGex) {
    const analysisExpiry = available.find((expiry) => calendarDaysUntilExpiration(expiry, now) >= PCS_HELPER_REFERENCE_DTE && calendarDaysUntilExpiration(expiry, now) <= PCS_HELPER_REFERENCE_DTE + PCS_EXPIRY_LOOKAHEAD_DAYS);
    return analysisExpiry === undefined ? [] : [analysisExpiry];
  }
  const gexExpirations = available.filter((expiry) => calendarDaysUntilExpiration(expiry, now) <= GEX_MAX_DTE);
  const pcsExpiry = available.find((expiry) => calendarDaysUntilExpiration(expiry, now) >= PCS_HELPER_REFERENCE_DTE && calendarDaysUntilExpiration(expiry, now) <= PCS_HELPER_REFERENCE_DTE + PCS_EXPIRY_LOOKAHEAD_DAYS);
  return [...new Set([...gexExpirations, ...(pcsExpiry === undefined ? [] : [pcsExpiry])])];
}

export async function loadQqqOptionChainSnapshot(now: Date, minDte = 25, includeGex = false, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS): Promise<OptionChainSnapshot | null> {
  return (await loadQqqGexOptionChainSnapshots(now, includeGex, timeoutMs)).find((snapshot) => snapshot.gexDte >= minDte) ?? null;
}

/** Do not freeze an outage into the same-day slow-data cache. */
export function isPcsLiveSlowBundleCacheable(bundle: PcsLiveSlowBundle) {
  return [bundle.historyResult, bundle.vixHistoryResult, bundle.vix3mHistoryResult]
    .every((factor) => (factor?.confidence ?? 0) > 0 && factor?.value != null);
}

export async function loadLiveDailyBundle(now: Date) {
  return readCachedBundle<PcsLiveSlowBundle>(replayCacheKey('qqq_pcs_live_daily_slow', [QQQ_EXPIRY_CALENDAR_VERSION, easternDateKey(now), dailyEvaluationPhase(now)]), PCS_LIVE_FAST_CACHE_TTL_SECONDS, async () => {
    const timeoutMs = PAGE_EXTERNAL_REQUEST_TIMEOUT_MS;
    const [historyResult, vixHistoryResult, vix3mHistoryResult, vxnHistoryResult] = await Promise.all([
      settleExternal(yahooFinanceServer.getHistorical(QQQ, '3y', '1d', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VIX', '5d', '1d', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VIX3M', '5d', '1d', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VXN', '5d', '1d', timeoutMs), timeoutMs),
    ]);
    return { macro: null, historyResult, vixHistoryResult, vix3mHistoryResult, vxnHistoryResult };
  }, false, isPcsLiveSlowBundleCacheable);
}

export async function loadLiveSlowBundle(now: Date, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS) {
  const cacheKey = timeoutMs === EXTERNAL_REQUEST_TIMEOUT_MS ? PCS_LIVE_SLOW_CACHE_KEY(now) : PCS_LIVE_SLOW_PAGE_CACHE_KEY(now);
  return readCachedBundle<PcsLiveSlowBundle>(cacheKey, PCS_LIVE_SLOW_CACHE_TTL_SECONDS, async () => {
    const qqqHistory = timeoutMs === EXTERNAL_REQUEST_TIMEOUT_MS
      ? fetchHistoricalDataCore(QQQ, '3y')
      : yahooFinanceServer.getHistorical(QQQ, '3y', '1d', timeoutMs);
    const [macro, historyResult, vixHistoryResult, vix3mHistoryResult, vxnHistoryResult] = await Promise.all([
      settleExternal(macroDataService.fetchMacroData(undefined, { includeOptionsIV: false }), timeoutMs),
      settleExternal(qqqHistory, timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VIX', '5d', '1d', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VIX3M', '5d', '1d', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical('^VXN', '5d', '1d', timeoutMs), timeoutMs),
    ]);
    return { macro, historyResult, vixHistoryResult, vix3mHistoryResult, vxnHistoryResult };
  }, false, isPcsLiveSlowBundleCacheable);
}

/** CS 与 PCS 同页都会读相同的 QQQ 分钟/扩展时段行情；独立缓存避免同一刷新周期重复请求。 */
export async function loadLiveMarketBundle(now: Date, livePhase: PcsDailyEvaluationPhase, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS) {
  const cacheKey = timeoutMs === EXTERNAL_REQUEST_TIMEOUT_MS ? PCS_LIVE_MARKET_CACHE_KEY(now, livePhase) : PCS_LIVE_MARKET_PAGE_CACHE_KEY(now, livePhase);
  return readCachedBundle<PcsLiveMarketBundle>(cacheKey, PCS_LIVE_FAST_CACHE_TTL_SECONDS, async () => {
    const [intradayResult, extendedHoursResult] = await Promise.all([
      settleExternal(yahooFinanceServer.getHistorical(QQQ, '5d', '2m', timeoutMs), timeoutMs),
      settleExternal(yahooFinanceServer.getHistorical(QQQ, '1d', '2m', timeoutMs, true, true), timeoutMs),
    ]);
    return { intradayResult, extendedHoursResult };
  }, false);
}

export async function loadLiveFastBundle(now: Date, livePhase: PcsDailyEvaluationPhase, includeGex = true, timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS, optionChainTimeoutMs = timeoutMs) {
  const cacheKey = timeoutMs === EXTERNAL_REQUEST_TIMEOUT_MS ? PCS_LIVE_FAST_CACHE_KEY(now, livePhase, includeGex) : PCS_LIVE_FAST_PAGE_CACHE_KEY(now, livePhase, includeGex, optionChainTimeoutMs);
  return readCachedBundle<PcsLiveFastBundle>(cacheKey, PCS_LIVE_FAST_CACHE_TTL_SECONDS, async () => {
    const [market, snapshots] = await Promise.all([
      loadLiveMarketBundle(now, livePhase, timeoutMs),
      loadQqqGexOptionChainSnapshots(now, includeGex, optionChainTimeoutMs),
    ]);
    return { ...market.value, optionSnapshot: snapshots.find((snapshot) => snapshot.gexDte >= PCS_HELPER_REFERENCE_DTE) ?? null, gexOptionSnapshots: includeGex ? snapshots.filter((snapshot) => snapshot.gexDte <= GEX_MAX_DTE) : [] };
  }, false);
}

/** Both entry strategies share the exact same market/target-chain load. */
export function loadLiveEntryFastBundle(now: Date, livePhase: PcsDailyEvaluationPhase) {
  return loadLiveFastBundle(now, livePhase, false, PAGE_EXTERNAL_REQUEST_TIMEOUT_MS, PAGE_OPTION_CHAIN_TIMEOUT_MS);
}

export function buildPcsReplayModelTarget(input: { now: Date; spot: number; regime: string; vix: number; vix3m: number; vxn: number; annualizedRv20: number }): PcsReplayModelTarget {
  const usesVxn = Number.isFinite(input.vxn) && input.vxn > 0;
  const profileVol = usesVxn ? input.vxn : input.vix;
  const profileVol3m = usesVxn && input.vix > 0
    ? input.vxn * (input.vix3m / input.vix)
    : input.vix3m;
  const profile = selectPcsContractProfile({ regime: input.regime, vix: profileVol, vix3m: profileVol3m, annualizedRv20: input.annualizedRv20 });
  if (!profile) return { status: 'UNAVAILABLE', reason: 'sigma 选约所需的日线因子不可用' };
  const modelDate = easternDateKey(input.now);
  const pricingVol = normalizeVolIndexForMockOptions(profileVol, usesVxn ? 'VXN' : 'VIX');
  const pricingVol3m = usesVxn && input.vix > 0
    ? input.vix3m * (pricingVol / input.vix)
    : input.vix3m;
  const modelOpen = buildPutCreditSpreadOpen({
    chain: buildMockOptionChain(modelDate, input.spot, pricingVol, QQQ, 1, 0, {
      vix3m: pricingVol3m,
      expiryCalendar: true,
      realStrikeGrid: true,
    }),
    date: modelDate,
    targetDte: SPREAD_TARGET_DTE,
    widthPct: CS_SPREAD_WIDTH_PCT,
    nav: 100_000,
    riskBudget: .1,
    forceMinimumContract: true,
    shortDelta: .2,
    shortStrikeSigma: profile.shortStrikeSigma,
    dailySigma20: input.annualizedRv20 / Math.sqrt(252),
  }).open;
  if (!modelOpen) return { status: 'UNAVAILABLE', reason: '回测模型链无法构造当前 sigma 目标' };
  return { status: 'READY' as const, profile, modelOpen };
}

async function buildPcsContractCandidate(input: { now: Date; spot: number; regime: string; vix: number; vix3m: number; vxn: number; annualizedRv20: number }, optionSnapshot?: OptionChainSnapshot | null): Promise<PcsContractCandidate> {
  const model = buildPcsReplayModelTarget(input);
  if (model.status === 'UNAVAILABLE') return model;
  const { profile, modelOpen } = model;
  const modelDate = easternDateKey(input.now);
  const snapshot = optionSnapshot ?? await loadQqqOptionChainSnapshot(input.now, PCS_HELPER_REFERENCE_DTE);
  if (!snapshot) return { status: 'UNAVAILABLE', reason: '真实 QQQ 期权链不可用' };
  const { expiry, daysToExpiration, puts } = snapshot;
  // Yahoo expiry timestamps represent an option-date, not a midnight execution time.
  // Use the New York calendar date so DTE and simple annualization do not drift by hour/time zone.
  // Must match buildPutCreditSpreadOpen(): contract-profile sigma uses the
  // frozen daily sigma (RV20 / sqrt(252)), not a DTE-scaled expected move.
  const targetShortStrike = input.spot * (1 - profile.shortStrikeSigma * input.annualizedRv20 / Math.sqrt(252));
  const short = puts
    .filter((option) => option.strike < input.spot && Number(option.openInterest) > 0 && Number(option.volume) >= 0 && optionQuote(option))
    .sort((a, b) => Math.abs(a.strike - targetShortStrike) - Math.abs(b.strike - targetShortStrike))[0];
  if (!short) return { status: 'UNAVAILABLE', reason: '真实链没有满足当前 sigma 距离的短 PUT' };
  const targetLongStrike = short.strike - Math.round(input.spot * CS_SPREAD_WIDTH_PCT / 5) * 5;
  const long = puts
    .filter((option) => option.strike < short.strike && Number(option.openInterest) > 0 && Number(option.volume) >= 0 && optionQuote(option))
    .sort((a, b) => Math.abs(a.strike - targetLongStrike) - Math.abs(b.strike - targetLongStrike))[0];
  if (!long) return { status: 'UNAVAILABLE', reason: '真实链没有可成交的保护 PUT' };
  const shortQuote = optionQuote(short)!;
  const longQuote = optionQuote(long)!;
  const netCredit = shortQuote.bid - longQuote.ask;
  if (!(netCredit > 0)) return { status: 'UNAVAILABLE', reason: '真实链双边报价不能构成正权利金 PCS' };
  return {
    status: 'READY',
    source: 'live_chain',
    chainSource: snapshot.source,
    chainCapturedAt: snapshot.capturedAt,
    expiry: new Date(expiry * 1000).toISOString().slice(0, 10),
    daysToExpiration,
    sigma: profile.shortStrikeSigma,
    sigmaReason: profile.shortStrikeSigma === 2
      ? `RV20 ${(input.annualizedRv20 * 100).toFixed(1)}% >= 20% 进入中档；VIX ${input.vix.toFixed(1)} < 22、VIX/VIX3M ${(input.vix / input.vix3m).toFixed(2)} < 0.95、RV20 < 28%，未触发 2.5σ 高压档。`
      : `当前市场状态与 VIX、VIX3M、RV20 共同匹配 ${profile.shortStrikeSigma.toFixed(1)}σ 档。`,
    shortStrike: short.strike,
    longStrike: long.strike,
    width: short.strike - long.strike,
    netCredit,
    slippage: (shortQuote.mid - longQuote.mid) - netCredit,
    definedRisk: (short.strike - long.strike - netCredit) * 100,
    annualizedReturn: calculateGeneralAPR(netCredit * 100, (short.strike - long.strike - netCredit) * 100, daysToExpiration),
    minOpenInterest: Math.min(Number(short.openInterest) || 0, Number(long.openInterest) || 0),
    minVolume: Math.min(Number(short.volume) || 0, Number(long.volume) || 0),
    model: {
      expiry: modelOpen.expiry,
      daysToExpiration: Math.round((Date.parse(`${modelOpen.expiry}T00:00:00Z`) - Date.parse(`${modelDate}T00:00:00Z`)) / 86400000),
      shortStrike: modelOpen.shortStrike,
      longStrike: modelOpen.longStrike,
    },
  };
}

function buildHistoricalPcsContractCandidate(input: Parameters<typeof buildPcsReplayModelTarget>[0]): PcsContractCandidate {
  const model = buildPcsReplayModelTarget(input);
  if (model.status === 'UNAVAILABLE') return model;
  const { profile, modelOpen } = model;
  const credit = modelOpen.credit ?? 0;
  const maxLoss = modelOpen.maxLoss ?? 0;
  if (!(credit > 0) || !(maxLoss > 0)) return { status: 'UNAVAILABLE', reason: '历史回放模型没有有效权利金或定义风险' };
  const daysToExpiration = Math.max(1, Math.round((Date.parse(`${modelOpen.expiry}T00:00:00Z`) - Date.parse(`${easternDateKey(input.now)}T00:00:00Z`)) / 86400000));
  return {
    status: 'READY', source: 'historical_model', expiry: modelOpen.expiry, daysToExpiration,
    sigma: profile.shortStrikeSigma, sigmaReason: '历史回放使用冻结日线 VXN、VIX3M、RV20 与市场状态选择 sigma 档。',
    shortStrike: modelOpen.shortStrike, longStrike: modelOpen.longStrike, width: modelOpen.shortStrike - modelOpen.longStrike,
    netCredit: credit, slippage: 0, definedRisk: maxLoss,
    annualizedReturn: calculateGeneralAPR(credit * 100, maxLoss, daysToExpiration),
    minOpenInterest: 0, minVolume: 0,
    model: { expiry: modelOpen.expiry, daysToExpiration, shortStrike: modelOpen.shortStrike, longStrike: modelOpen.longStrike },
  };
}

/** Research-only synthetic view for a live page with no real option chain. It never enters the execution candidate or any gate. */
export function buildSyntheticPcsResearchCandidate(input: Parameters<typeof buildPcsReplayModelTarget>[0]): PcsSyntheticResearchCandidate | null {
  const modelCandidate = buildHistoricalPcsContractCandidate(input);
  return modelCandidate.status === 'READY' ? { ...modelCandidate, source: 'synthetic_research' } : null;
}

export function intradayFactors(bars: MinuteBar[], now: Date, regularSession = isRegularSession(now)): FactorMap {
  const date = easternDateKey(now);
  bars = bars.filter(bar => Date.parse(bar.timestamp) + 120_000 <= now.getTime()
    && easternDateKey(new Date(bar.timestamp)) === date && qqqMarketSession(new Date(bar.timestamp)).stocksOpen)
    .sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const latest = bars.at(-1);
  const validBars = bars.length > 0 && latest !== undefined;
  const fresh = validBars && now.getTime() - (new Date(latest.timestamp).getTime() + 120_000) <= MAX_INTRADAY_AGE_MS;
  const vwap = qqqSessionVwap(bars).at(-1)?.value ?? NaN;
  const intradayLow = validBars ? Math.min(...bars.map((bar) => bar.close)) : NaN;
  const intradayHigh = validBars ? Math.max(...bars.map((bar) => bar.close)) : NaN;
  const vwapValid = Number.isFinite(vwap) && vwap > 0;
  const closesFactor = createRawFactor(bars.map((bar) => bar.close), (value) => value.length >= 15, 'Yahoo QQQ 1d/2m', undefined, []);
  const rsi = closesFactor.confidence > 0 ? indicatorEngine.calculateRSIFactors(closesFactor).rsi : fallbackFactor(0, 'QQQ 2 分钟线不足 15 根，无法计算 RSI14');
  return {
    qqq_intraday_bars_valid: createRawFactor(validBars, (value) => value === true, 'Yahoo QQQ 1d/2m'),
    qqq_intraday_regular_session: createRawFactor(regularSession, () => true, 'America/New_York session + current-date bars'),
    qqq_intraday_data_fresh: createRawFactor(fresh, () => true, 'Yahoo QQQ 1d/2m'),
    qqq_intraday_vwap: createRawFactor(vwap, (value) => Number.isFinite(value) && value > 0, 'Yahoo QQQ 1d/2m', undefined, 0),
    qqq_intraday_price: createRawFactor(latest?.close ?? 0, (value) => Number.isFinite(value) && value > 0, 'Yahoo QQQ 1d/2m', undefined, 0),
    qqq_intraday_low: createRawFactor(intradayLow, (value) => Number.isFinite(value) && value > 0, 'Yahoo QQQ 1d/2m', undefined, 0),
    qqq_intraday_high: createRawFactor(intradayHigh, (value) => Number.isFinite(value) && value > 0, 'Yahoo QQQ 1d/2m', undefined, 0),
    qqq_intraday_rsi_14: rsi,
  };
}

export function unavailableHistoricalIntradayFactors(): FactorMap {
  const reason = '历史回放没有可复原的 5 分钟线与盘中时机';
  return {
    qqq_intraday_bars_valid: fallbackFactor(false, reason),
    qqq_intraday_regular_session: fallbackFactor(false, reason),
    qqq_intraday_data_fresh: fallbackFactor(false, reason),
    qqq_intraday_vwap: fallbackFactor(0, reason),
    qqq_intraday_price: fallbackFactor(0, reason),
    qqq_intraday_low: fallbackFactor(0, reason),
    qqq_intraday_high: fallbackFactor(0, reason),
    qqq_intraday_rsi_14: fallbackFactor(0, reason),
  };
}

/** 图表路径复用同一 PCS 快照引擎，不在前端复制执行分规则。 */
export function buildPcsIntradayScoreSeries(factors: FactorMap, bars: MinuteBar[]) {
  // ponytail: one regular session is ~78 bars; precompute rolling inputs only if this becomes multi-day.
  return bars.flatMap((bar, index) => {
    const replay = buildQqqPcsEntrySnapshot({
      ...factors,
      ...intradayFactors(bars.slice(0, index + 1), new Date(Date.parse(bar.timestamp)+120_000)),
    } as any);
    const score = replay.factors.qqq_pcs_execution_score;
    // 历史真实 IV 不可得时，执行分仍有同一引擎的数值，但其置信度会 fail-closed 为 0。
    // 图表展示该回放路径；实际 timing 仍保留 INSUFFICIENT_DATA。
    return Number.isFinite(Number(score?.value))
      ? [{ time: bar.timestamp, score: Number(score.value) }]
      : [];
  });
}

function rawFrom<T>(factor: FinancialFactor<T> | undefined, fallback: T, reason: string): FinancialFactor<T> {
  return factor?.source.type === 'raw' && factor.confidence === 10
    ? factor
    : fallbackFactor(fallback, reason);
}

function dailyEligibility(factors: FactorMap): { value: PcsDailyEligibility; reasons: string[] } {
  if (factors.pcs_policy_enabled?.value !== true) {
    return { value: 'UNAVAILABLE', reasons: ['PCS policy 未启用/不可评估'] };
  }
  if (factors.pcs_reactive_eligible?.confidence === 0) {
    return { value: 'UNAVAILABLE', reasons: ['PCS 日线必需输入不可用'] };
  }
  if (factors.pcs_reactive_eligible?.value === true) return { value: 'OPEN', reasons: ['现有 Reactive PCS 日线资格全部满足'] };
  const failed = ['pcs_symbol_qqq', 'pcs_vix_14_28', 'pcs_risk_on', 'pcs_no_crisis', 'pcs_no_backwardation']
    .filter((id) => factors[id]?.value !== true)
    .map((id) => ({
      pcs_symbol_qqq: '仅支持 QQQ', pcs_vix_14_28: 'VIX 不在 14–28', pcs_risk_on: '市场状态不满足 Reactive PCS',
      pcs_no_crisis: '危机状态阻断', pcs_no_backwardation: '期限结构倒挂',
    })[id]!)
    .filter((reason): reason is string => Boolean(reason));
  return { value: 'BLOCK', reasons: failed.length ? failed : ['当前不具备 PCS 日线资格'] };
}

export type PcsProbabilityContext = {
  strikeSurvival: {
    shortStrike: number; sigmaDist: number;
    d3: SellerStat; d5: SellerStat; d10: SellerStat;
    d3NoTouch: SellerStat; d5NoTouch: SellerStat; d10NoTouch: SellerStat;
    dte: { horizonDays: number; calendarDays: number; tradingDays: number; stat: SellerStat; noTouch: SellerStat } | null;
  } | null;
  anchoredManageability: {
    recover5d: SellerStat; halfRetrace10d: SellerStat; repairSuccess: SellerStat;
    continueDrop5d: SellerStat; worstCase5dDropPct: SellerStat; medianRepairDays: SellerStat;
  } | null;
};

/** Count actual QQQ trading sessions after the as-of date through expiration. */
export function tradingSessionsUntilExpiration(asOfDate: string, expiryDate: string): number {
  const asOf = asOfDate.slice(0, 10);
  const expiry = expiryDate.slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const expiryMs = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(expiryMs) || expiryMs <= asOfMs) return 0;
  const calendarDays = Math.ceil((expiryMs - asOfMs) / 86_400_000);
  return marketTradingDates(asOf, calendarDays + 1).filter((date) => date <= expiry).length;
}

/** 复用 stock 页 SellerStatsEngine 的历史经验统计，纯展示，不参与 sigma 选约或开平仓门控。 */
export function buildPcsProbabilityContext(
  bars: DailyBar[],
  candidate: PcsContractCandidate,
  spot: number,
  annualizedRv20: number,
  asOfDate = bars.at(-1)?.date,
): PcsProbabilityContext {
  if (candidate.status !== 'READY' || !(spot > 0) || !(annualizedRv20 > 0) || bars.length < 40) {
    return { strikeSurvival: null, anchoredManageability: null };
  }
  const dailySigma20 = annualizedRv20 / Math.sqrt(252);
  if (!(dailySigma20 > 0)) return { strikeSurvival: null, anchoredManageability: null };
  const sigmaDist = (spot - candidate.shortStrike) / spot / dailySigma20;
  const adverse = sigmaDist <= 0.5;
  const stats = adverse ? computeSellerStats(bars) : null;
  const condition = buildStrikeSurvivalCondition(bars, dailySigma20);
  const survival = (horizonDays: number, barrier: StrikeSurvivalBarrier): SellerStat => condition
    ? computeConditionalStrikeSurvivalForHorizon(bars, sigmaDist, horizonDays, condition, barrier)
    : computeStrikeSurvivalForHorizon(bars, sigmaDist, horizonDays, barrier);
  const dteCalendarDays = candidate.daysToExpiration;
  const dteTradingDays = asOfDate && dteCalendarDays > 0
    ? tradingSessionsUntilExpiration(asOfDate, candidate.expiry)
    : 0;
  // 生存率 horizon 使用真实交易日数量；自然日 DTE 只作为合同标签展示。
  const dteHorizon = dteTradingDays > 0
    ? {
      horizonDays: dteTradingDays,
      calendarDays: dteCalendarDays,
      tradingDays: dteTradingDays,
      stat: survival(dteTradingDays, 'close'),
      noTouch: survival(dteTradingDays, 'intraday'),
    }
    : null;
  return {
    strikeSurvival: {
      shortStrike: candidate.shortStrike,
      sigmaDist,
      d3: survival(3, 'close'),
      d5: survival(5, 'close'),
      d10: survival(10, 'close'),
      d3NoTouch: survival(3, 'intraday'),
      d5NoTouch: survival(5, 'intraday'),
      d10NoTouch: survival(10, 'intraday'),
      dte: dteHorizon,
    },
    anchoredManageability: adverse ? stats!.anchoredManageability : null,
  };
}

async function runPcsGet(request: Request) {
  const now = new Date();
  const regimeMode = parseRegimeMode(request);
  const selectedAsOf = historicalAsOf(request);
  const dailyOnly = new URL(request.url).searchParams.get('dailyOnly') === '1';
  const fastPage = new URL(request.url).searchParams.get('fast') === '1';
  const includeGex = new URL(request.url).searchParams.get('includeGex') !== '0';
  const externalTimeoutMs = fastPage ? PAGE_EXTERNAL_REQUEST_TIMEOUT_MS : EXTERNAL_REQUEST_TIMEOUT_MS;
  const requestedGexExpiry = selectedGexExpiry(request);
  const displayWindow = gexDisplayWindow(request, now);
  const latestDisplayWindow = requestsLatestGexDisplayWindow(request);
  const isHistorical = selectedAsOf !== null;
  const evaluationNow = isHistorical ? new Date(`${selectedAsOf}T16:00:00.000Z`) : now;
  const livePhase = isHistorical ? 'CLOSED' : dailyEvaluationPhase(now);
  const timelinePolicy = regimeMode === 'overlay' ? `${QQQ_PCS_TIMELINE_POLICY}-overlay-research` : QQQ_PCS_TIMELINE_POLICY;
  const historicalCacheKey = isHistorical && selectedAsOf ? PCS_HISTORICAL_CACHE_KEY(regimeMode, selectedAsOf,
    [dailyOnly, fastPage, includeGex, isGexDisplayRequest(request), requestedGexExpiry ?? undefined,
      displayWindow?.fromMs, displayWindow?.toMs, latestDisplayWindow]) : null;

  if (historicalCacheKey) {
    const cached = await apiCache.get(historicalCacheKey);
    if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
  }

  try {
    const directionalCronRequest = new URL(request.url).searchParams.get('qqqDirectionalCron') === '1';
    if (isGexDisplayRequest(request) && !directionalCronRequest && !isHistorical && (livePhase !== 'PRELIMINARY' || new URL(request.url).searchParams.get('gexOverview') === '1' || new URL(request.url).searchParams.get('gexEvidence') === '1')) {
      const fastPayload = await buildQqqGexDisplayFastPayload({
        now,
        timelinePolicy,
        requestedExpiry: requestedGexExpiry,
        displayWindow,
        latestDisplayWindow: latestDisplayWindow,
        phase: livePhase,
        overview: new URL(request.url).searchParams.get('gexOverview') === '1',
        evidenceOnly: new URL(request.url).searchParams.get('gexEvidence') === '1',
      });
      const projected = new URL(request.url).searchParams.get('gexEvidence') === '1' ? fastPayload : projectQqqGexDisplayPayload(fastPayload, requestedGexExpiry);
      return NextResponse.json(new URL(request.url).searchParams.get('gexEvidence') === '1' ? compactQqqDisplayEvidence(projected) : projected, { headers: { 'x-cache': 'GEX-DISPLAY-FAST' } });
    }
    // Slow macro/history and fast option-chain loading are independent. Running
    // them serially made every SWR refresh wait through two timeout windows.
    const storedCandlesPromise = isHistorical || dailyOnly ? Promise.resolve([]) : readTodayQqqIntradayCandles(now);
    const frozenGexSnapshotsPromise = shouldUsePersistedGexSnapshot(livePhase, isHistorical, now) && includeGex && !dailyOnly && !fastPage
      ? readLatestQqqGexExpirySnapshots({
          policyId: timelinePolicy,
          from: new Date(now.getTime() - GEX_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString(),
        })
      : Promise.resolve<QqqLatestGexExpirySnapshot[] | null>([]);
    const [slowBundle, fastBundle] = isHistorical
      ? [null, null]
      : await Promise.all([
          dailyOnly ? loadLiveDailyBundle(now) : loadLiveSlowBundle(now, externalTimeoutMs),
      dailyOnly ? Promise.resolve(null) : fastPage && !includeGex ? loadLiveEntryFastBundle(now, livePhase) : loadLiveFastBundle(now, livePhase, includeGex, externalTimeoutMs, fastPage ? PAGE_OPTION_CHAIN_TIMEOUT_MS : externalTimeoutMs),
        ]);
    const [macro, historyResult, intradayResult, extendedHoursResult, optionSnapshot, gexOptionSnapshots, vixHistoryResult, vix3mHistoryResult, vxnHistoryResult] = isHistorical
      ? await Promise.all([
          Promise.resolve<MacroData | null>(null),
          settleExternal(fetchHistoricalDataCore(QQQ, '3y')),
          settleExternal(yahooFinanceServer.getHistorical(QQQ, '5d', '2m')),
          settleExternal(yahooFinanceServer.getHistorical(QQQ, '1d', '2m', EXTERNAL_REQUEST_TIMEOUT_MS, true, true)),
          Promise.resolve<OptionChainSnapshot | null>(null),
          Promise.resolve<GexOptionChainSnapshot[]>([]),
          settleExternal(fetchHistoricalDataCore('^VIX', '3y', true)),
          settleExternal(fetchHistoricalDataCore('^VIX3M', '3y', true)),
          settleExternal(fetchHistoricalDataCore('^VXN', '3y')),
        ])
      : dailyOnly
        ? [
            slowBundle!.value.macro,
            slowBundle!.value.historyResult,
            null,
            null,
            null,
            [],
            slowBundle!.value.vixHistoryResult,
            slowBundle!.value.vix3mHistoryResult,
            slowBundle!.value.vxnHistoryResult,
          ]
      : [
          slowBundle!.value.macro,
          slowBundle!.value.historyResult,
          fastBundle!.value.intradayResult,
          fastBundle!.value.extendedHoursResult,
          fastBundle!.value.optionSnapshot,
          fastBundle!.value.gexOptionSnapshots,
          slowBundle!.value.vixHistoryResult,
          slowBundle!.value.vix3mHistoryResult,
          slowBundle!.value.vxnHistoryResult,
        ];
    const qqqDailyBars = dailyBars(historyResult?.value).filter((bar) => !selectedAsOf || bar.date <= selectedAsOf);
    const completedCloseDate = resolveCompletedCloseDate(now, qqqDailyBars, selectedAsOf);
    const previousCloseQqqDailyBars = completedCloseDate ? qqqDailyBars.filter((bar) => bar.date <= completedCloseDate) : [];
    const closes = qqqDailyBars.map((bar) => bar.close);
    const premarketBars = isHistorical || dailyOnly ? [] : parsePremarketSessionMinutes(extendedHoursResult?.value, now);
    const extendedHoursSession = isHistorical || dailyOnly ? { bars: [] as MinuteBar[], asOf: null } : parseMostRecentExtendedSessionMinutes(extendedHoursResult?.value);
    const premarketQuote = premarketBars.length ? { close: premarketBars.at(-1)!.close, asOf: premarketBars.at(-1)!.timestamp } : null;
    const priorClose = qqqDailyBars.at(-1)?.close ?? 0;
    const price = isHistorical ? qqqDailyBars.at(-1)?.close ?? 0 : premarketQuote?.close ?? priorClose;
    // Terminal 的 GEX/Dealer 分析必须使用最新可用分钟价；现有 PCS 日线资格仍沿用原来的 price 基准。
    const regularSession = isHistorical ? { bars: [] as MinuteBar[], asOf: null } : parseMostRecentRegularSessionMinutes(intradayResult?.value);
    const selectedLiveSession = isHistorical || dailyOnly
      ? { session: { bars: [] as MinuteBar[], asOf: null }, displaySession: 'REGULAR' as const, regularSessionIsCurrent: false }
      : selectQqqLiveIntradaySession({ now, phase: livePhase, regularSession, premarketBars });
    const liveSession = selectedLiveSession.session;
    const storedCandles = await storedCandlesPromise;
    const session = isHistorical || selectedLiveSession.displaySession === 'PREMARKET'
      ? liveSession
      : {
          bars: mergeQqqIntradayCandles(storedCandles, liveSession.bars),
          asOf: liveSession.asOf ?? (storedCandles.length ? easternDateKey(now) : null),
        };
    const extendedHoursDisplayBars = isHistorical ? [] : buildQqqExtendedHoursDisplayBars({
      now, phase: livePhase, extendedBars: extendedHoursSession.bars, regularBars: session.bars,
    });
    if (!isHistorical && selectedLiveSession.regularSessionIsCurrent && liveSession.bars.length) {
      void appendQqqClosedIntradayCandles(liveSession.bars);
    }
    const terminalSpot = session.bars.at(-1)?.close ?? price;
    const priceFactor = createRawFactor(price, (value) => Number.isFinite(value) && value > 0, isHistorical
      ? `Yahoo QQQ close ${selectedAsOf}`
      : premarketQuote ? `Yahoo QQQ pre-market ${premarketQuote.asOf}` : livePhase === 'PREMARKET' ? `Yahoo QQQ prior close ${qqqDailyBars.at(-1)?.date ?? ''}`.trim() : 'Yahoo QQQ quote', undefined, 0);
    const closesFactor = createRawFactor(closes, (value) => value.length >= 21, 'Yahoo QQQ history', undefined, []);
    const hv20 = closesFactor.confidence > 0 ? indicatorEngine.calculateHV(closesFactor, 20) : null;
    const historyFactor = createRawFactor(closes, (value) => value.length >= 21, 'Yahoo QQQ history', undefined, []);
    const iv = optionSnapshot?.atmIV ?? 0;
    const impliedVolatility = optionSnapshot
      ? createRawFactor(iv, (value) => Number.isFinite(value) && value > 0, 'QQQ shared options', undefined, 0)
      : fallbackFactor(0, 'QQQ 目标到期日期权链未及时取得');
    const historicalVolatility = hv20 !== null && hv20 >= 0 && historyFactor.confidence > 0
      ? createDerivedFactor(hv20, [{ factorId: 'qqq_daily_closes', weight: 1 }], { qqq_daily_closes: historyFactor })
      : fallbackFactor(0, 'QQQ 日线不足，无法计算 HV20');
    // GEX：纯展示信息（图表 overlay + timeline 快照），不参与 sigma 选约或任何 gate/eligibility 判定。
    const gexExpirySnapshots = isHistorical ? [] : gexOptionSnapshots.flatMap((chain) => {
      if (!chain.calls.length || !chain.puts.length) return [];
      try {
        const calculation = calculateQqqGex(chain, terminalSpot, chain.expiryDate, evaluationNow.toISOString());
        if (!calculation) return [];
        const { metrics } = calculation;
        const summary = buildGexSummary(metrics);
        if (!summary) return [];
        const computedProfile = calculation.profile.map(p => ({ ...p, computedAt: new Date().toISOString() }));
        const repriced = { ...chain, calls: calculation.calls, puts: calculation.puts };
        return [{ expiryDate: chain.expiryDate, dte: chain.gexDte, totalGex: metrics.totalGexValue, gammaFlipLevel: metrics.gammaFlipPrice, profile: selectGexProfile(metrics.points, 8), fullProfile: computedProfile, terminalStrikes: buildTerminalStrikes(metrics.allPoints, repriced), metrics, chain: repriced, summary, topology: metrics.topology?.structure ?? null }];
      } catch (error) {
        console.warn(`[PCS GEX] ${chain.expiryDate} calculation failed:`, error);
        return [];
      }
    });
    const frozenGexSnapshots = await frozenGexSnapshotsPromise;
    const useFrozenGexSnapshots = shouldUsePersistedGexSnapshot(livePhase, isHistorical, now);
    const ivHistory = closesFactor.confidence > 0 ? indicatorEngine.calculateHVHistory(closesFactor, 20) : [];
    const { rank } = impliedVolatility.confidence > 0 && historicalVolatility.confidence > 0
      ? indicatorEngine.calculateIVRankFromHVProxy(iv, ivHistory)
      : { rank: 0 };
    // During pre-market Yahoo can publish a tentative new ^VIX daily point while
    // ^VIX3M is still on the previous close. Anchor all slow inputs to QQQ's
    // latest completed session instead of mixing calendar dates.
    const slowDailyAsOf = completedCloseDate;
    const yahooVix = slowDailyAsOf ? dailyCloseOn(vixHistoryResult?.value, slowDailyAsOf) : null;
    const yahooVix3m = slowDailyAsOf ? dailyCloseOn(vix3mHistoryResult?.value, slowDailyAsOf) : null;
    let builtVolatility: ReturnType<typeof completedVolatilityFromBuiltHistory> | null = null;
    if (fastPage && slowDailyAsOf && (!yahooVix || !yahooVix3m)) {
      try {
        const { readBuiltHistory } = await import('@/lib/engines/leveraged-overlay/v2/backtest/build-history');
        builtVolatility = completedVolatilityFromBuiltHistory(await readBuiltHistory(), slowDailyAsOf);
      } catch (error) {
        console.warn('[PCS] Build history volatility fallback unavailable:', error);
      }
    }
    const vix = yahooVix ?? builtVolatility?.vix ?? null;
    const vix3mAsOf = slowDailyAsOf;
    const cboeVix3m = !dailyOnly && !fastPage && !yahooVix3m && vix3mAsOf ? await fetchCboeVix3mByDate() : null;
    const cboeVix3mClose = dailyMapCloseOn(cboeVix3m?.value, vix3mAsOf);
    const fredVix3m = !dailyOnly && !fastPage && !yahooVix3m && !cboeVix3mClose && vix3mAsOf ? await fetchFredVix3mByDate() : null;
    const fredVix3mClose = dailyMapCloseOn(fredVix3m?.value, vix3mAsOf);
    const vix3m = yahooVix3m ?? builtVolatility?.vix3m
      ?? (cboeVix3mClose ? { ...cboeVix3mClose, source: 'Cboe VIX3M' }
        : fredVix3mClose ? { ...fredVix3mClose, source: 'FRED VXVCLS (Cboe VIX3M)' }
          : null);
    const previousVix = (slowDailyAsOf ? dailyCloseAt(vixHistoryResult?.value, slowDailyAsOf, true) : null) ?? builtVolatility?.previousVix ?? null;
    const vxnDaily = dailyCloses(vxnHistoryResult?.value).filter((point) => !slowDailyAsOf || point.asOf <= slowDailyAsOf);
    const vxn = vxnDaily.at(-1)?.close ?? 0;
    const priorVxn = vxnDaily.at(-2)?.close ?? 0;
    const alignedVix = vix && vix3m && vix.asOf === vix3m.asOf;
    const dailyMarketBase = buildQqqDailyMarketBase({
      qqqBars: qqqDailyBars,
      vix: vix?.close ?? 0,
      vix3m: vix3m?.close ?? 0,
      previousVix: previousVix?.close ?? 0,
    });
    const previousCloseMarketBase = buildQqqDailyMarketBase({
      qqqBars: previousCloseQqqDailyBars,
      vix: vix?.close ?? 0,
      vix3m: vix3m?.close ?? 0,
      previousVix: previousVix?.close ?? 0,
    });
    const dateAlignedLiveRegime = resolveDateAlignedLiveRegime(livePhase, macro?.marketRegime?.regime ?? null, dailyMarketBase.overlayRegime?.regime ?? null);
    const historicalOverlayRegime = isHistorical ? dailyMarketBase.overlayRegime?.regime ?? null : null;
    let factors: FactorMap = {
      symbol: { value: QQQ, confidence: 7, source: { type: 'manual', description: '固定 QQQ 页面' } },
      underlying_price: priceFactor,
      qqq_daily_closes: historyFactor,
      qqq_daily_bars: createRawFactor(qqqDailyBars, (value) => value.length >= 200, 'Yahoo QQQ history', undefined, []),
      implied_volatility: impliedVolatility,
      historical_volatility: historicalVolatility,
      seller_sigma_20: historicalVolatility,
      iv_rank: impliedVolatility.confidence > 0 && historicalVolatility.confidence > 0
        ? createDerivedFactor(rank, [{ factorId: 'implied_volatility', weight: .5 }, { factorId: 'historical_volatility', weight: .5 }], { implied_volatility: impliedVolatility, historical_volatility: historicalVolatility })
        : fallbackFactor(0, 'QQQ 真实 IV 或 HV20 不可用'),
      vol_premium: impliedVolatility.confidence > 0 && historicalVolatility.confidence > 0 && hv20 !== null && hv20 > 0
        ? createDerivedFactor(iv / hv20, [{ factorId: 'implied_volatility', weight: .5 }, { factorId: 'historical_volatility', weight: .5 }], { implied_volatility: impliedVolatility, historical_volatility: historicalVolatility })
        : fallbackFactor(0, 'QQQ 真实 IV 或 HV20 不可用'),
      vix_price: createRawFactor(vix?.close ?? 0, (value) => alignedVix === true && value > 5 && value < 150, `${vix?.source ?? 'Yahoo ^VIX'} ${vix?.asOf ?? ''}`.trim(), undefined, 0),
      vix3m_price: createRawFactor(vix3m?.close ?? 0, (value) => alignedVix === true && value > 5 && value < 150, `${vix3m?.source ?? 'Yahoo ^VIX3M'} ${vix3m?.asOf ?? ''}`.trim(), undefined, 0),
      vix_previous_close: createRawFactor(previousVix?.close ?? 0, (value) => value > 5 && value < 150, `${previousVix?.source ?? 'Yahoo ^VIX prior'} ${previousVix?.asOf ?? ''}`.trim(), undefined, 0),
      vxn_price: createRawFactor(vxn, (value) => Number.isFinite(value) && value > 5 && value < 150, 'Yahoo ^VXN', undefined, 0),
      vxn_previous_close: createRawFactor(priorVxn, (value) => Number.isFinite(value) && value > 5 && value < 150, 'Yahoo ^VXN prior close', undefined, 0),
      pcs_market_regime: isHistorical
        ? createRawFactor(historicalOverlayRegime ?? '', (value) => typeof value === 'string' && value.length > 0, `历史日线 Overlay ${selectedAsOf}`, undefined, '')
        : { value: dateAlignedLiveRegime ?? '', confidence: dateAlignedLiveRegime ? 7 : 0, source: dateAlignedLiveRegime ? { type: 'manual', description: livePhase === 'PRELIMINARY' ? '现有宏观日线市场状态' : '最近完成收盘日市场状态' } : { type: 'fallback', reason: '市场状态不可用' } },
      market_state: isHistorical
        ? createRawFactor(historicalOverlayRegime ?? '', (value) => typeof value === 'string' && value.length > 0, `历史日线 Overlay ${selectedAsOf}`, undefined, '')
        : createRawFactor(dateAlignedLiveRegime, (value) => typeof value === 'string' && value.length > 0, livePhase === 'PRELIMINARY' ? 'macroDataService' : '最近完成收盘日市场状态', undefined, ''),
      // This analysis-only page has no account state or order path. It must not
      // inherit the production account-capacity blocker as missing data.
      account_open_pcs_count: { value: 0, confidence: 7, source: { type: 'manual', description: 'QQQ 展示页无状态，不代表实际持仓' } },
    };
    factors.vix_term_ratio = factors.vix_price.confidence > 0 && factors.vix3m_price.confidence > 0 && Number(factors.vix3m_price.value) > 0
      ? createDerivedFactor(Number(factors.vix_price.value) / Number(factors.vix3m_price.value), [{ factorId: 'vix_price', weight: .5 }, { factorId: 'vix3m_price', weight: .5 }], factors)
      : fallbackFactor(0, 'VIX 或 VIX3M 原始数据不可用');
    factors.vxn_change_1d = factors.vxn_price.confidence > 0 && factors.vxn_previous_close.confidence > 0
      ? createDerivedFactor((Number(factors.vxn_price.value) / Number(factors.vxn_previous_close.value) - 1) * 100, [{ factorId: 'vxn_price', weight: .5 }, { factorId: 'vxn_previous_close', weight: .5 }], factors)
      : fallbackFactor(0, 'VXN 近两日收盘价不可用');
    const unifiedPcsRegime = factors.pcs_market_regime;
    const overlayPcsRegimeValue = dailyMarketBase.overlayRegime?.regime ?? null;
    const overlayPcsRegime = overlayPcsRegimeValue
      ? createDerivedFactor(overlayPcsRegimeValue, [
        { factorId: 'qqq_daily_bars', weight: .5 }, { factorId: 'vix_price', weight: .2 }, { factorId: 'vix3m_price', weight: .2 }, { factorId: 'vix_previous_close', weight: .1 },
      ], factors)
      : fallbackFactor('', 'Overlay 03-market-regime 所需 QQQ/VIX 日线输入不可用');
    if (regimeMode === 'overlay') factors = { ...factors, pcs_market_regime: overlayPcsRegime };
    const liveFactors = addReactivePcsProductionFactors(factors, 'reactive-v1');
    const previousCloseCloses = previousCloseQqqDailyBars.map((bar) => bar.close);
    const previousCloseHistory = createRawFactor(previousCloseCloses, (value) => value.length >= 21, `Yahoo QQQ history ${slowDailyAsOf ?? ''}`.trim(), undefined, []);
    const previousCloseHv20 = previousCloseHistory.confidence > 0 ? indicatorEngine.calculateHV(previousCloseHistory, 20) : null;
    const previousCloseHistoricalVolatility = previousCloseHv20 !== null && previousCloseHv20 >= 0 && previousCloseHistory.confidence > 0
      ? createDerivedFactor(previousCloseHv20, [{ factorId: 'qqq_daily_closes', weight: 1 }], { qqq_daily_closes: previousCloseHistory })
      : fallbackFactor(0, '上一收盘 QQQ 日线不足，无法计算 HV20');
    const previousCloseOverlayRegimeValue = previousCloseMarketBase.overlayRegime?.regime ?? null;
    const previousCloseRegime = previousCloseOverlayRegimeValue
      ? createRawFactor(previousCloseOverlayRegimeValue, (value) => typeof value === 'string' && value.length > 0, `上一收盘日 Overlay ${slowDailyAsOf ?? ''}`.trim(), undefined, '')
      : fallbackFactor('', '上一收盘日 Overlay 市场状态不可用');
    const previousCloseFactors = !isHistorical && livePhase === 'PRELIMINARY'
      ? addReactivePcsProductionFactors({
          ...factors,
          underlying_price: createRawFactor(previousCloseQqqDailyBars.at(-1)?.close ?? 0, (value) => Number.isFinite(value) && value > 0, `Yahoo QQQ 上一收盘 ${slowDailyAsOf ?? ''}`.trim(), undefined, 0),
          qqq_daily_closes: previousCloseHistory,
          qqq_daily_bars: createRawFactor(previousCloseQqqDailyBars, (value) => value.length >= 200, `Yahoo QQQ history ${slowDailyAsOf ?? ''}`.trim(), undefined, []),
          historical_volatility: previousCloseHistoricalVolatility,
          seller_sigma_20: previousCloseHistoricalVolatility,
          pcs_market_regime: previousCloseRegime,
          market_state: previousCloseRegime,
        }, 'reactive-v1')
      : null;
    const previousCloseDaily = previousCloseFactors ? dailyEligibility(previousCloseFactors) : null;
    const enforcePreviousCloseGate = previousCloseDaily !== null && shouldEnforcePreviousClosePcsGate(livePhase, isHistorical, previousCloseDaily.value);
    factors = enforcePreviousCloseGate && previousCloseFactors ? previousCloseFactors : liveFactors;
    const daily = enforcePreviousCloseGate && previousCloseDaily
      ? { ...previousCloseDaily, reasons: [`上一交易日 ${slowDailyAsOf ?? '最近收盘日'} PCS 日线资格未通过`, ...previousCloseDaily.reasons] }
      : dailyEligibility(factors);
    factors.pcs_daily_eligibility = daily.value === 'UNAVAILABLE'
      ? fallbackFactor(daily.value, daily.reasons.join('；'))
      : createDerivedFactor(daily.value, [{ factorId: 'pcs_reactive_eligible', weight: 1 }], factors);
    if (isHistorical) {
      const historicalSession = parseRegularSessionMinutesForDate(intradayResult?.value, selectedAsOf!);
      session.bars = historicalSession.bars;
      session.asOf = historicalSession.asOf;
    }
    factors = { ...factors, ...(isHistorical ? unavailableHistoricalIntradayFactors() : intradayFactors(session.bars, now, isRegularSession(now) && selectedLiveSession.regularSessionIsCurrent)) };
    const phase = livePhase;
    const progress = createRawFactor(isHistorical ? 1 : dailySessionProgress(now), (value) => Number.isFinite(value) && value >= 0 && value <= 1, isHistorical ? `历史收盘 ${selectedAsOf}` : 'America/New_York market clock', undefined, 1);
    factors.pcs_daily_session_progress = progress;
    factors.pcs_daily_confirmation = createDerivedFactor(
      dailyConfirmationScore(phase, Number(progress.value), factors.qqq_intraday_data_fresh.value === true),
      [{ factorId: 'pcs_daily_session_progress', weight: .6 }, { factorId: 'qqq_intraday_data_fresh', weight: .4 }],
      factors,
    );
    const snapshot = buildQqqPcsEntrySnapshot(factors as any);
    const candidateInput = {
      now: evaluationNow,
      spot: Number(priceFactor.value),
      regime: String(factors.pcs_market_regime.value),
      vix: Number(factors.vix_price.value),
      vix3m: Number(factors.vix3m_price.value),
      vxn: Number(factors.vxn_price.value),
      annualizedRv20: Number(historicalVolatility.value),
    };
    // The compact daily response is only a qualification projection. Do not
    // block it on the live option chain; details=1 owns chain/GEX loading.
    const dailyOptionSnapshot = null;
    const previousCloseEligibility = previousCloseDaily?.value ?? daily.value;
    const exposeLiveCandidate = shouldExposeLivePcsCandidate(livePhase, daily.value, previousCloseEligibility);
    const candidate = isHistorical
      ? buildHistoricalPcsContractCandidate(candidateInput)
      : dailyOnly
        ? { status: 'UNAVAILABLE' as const, reason: '日线轻量响应未加载实时期权链' }
      : exposeLiveCandidate
        ? await buildPcsContractCandidate(candidateInput, dailyOnly ? dailyOptionSnapshot : optionSnapshot)
        : { status: 'UNAVAILABLE' as const, reason: daily.value === 'OPEN' ? 'PCS 实时候选仅在正常交易时段暴露' : daily.reasons.join('；') };
    if (dailyOnly) {
      const dailyFactor = factors.pcs_daily_eligibility;
      const dailyFactors = Object.fromEntries(Object.entries(factors).filter(([id]) => (
        !id.startsWith('qqq_intraday')
        && id !== 'qqq_daily_bars'
        && id !== 'qqq_daily_closes'
      )));
      return NextResponse.json({
        strategy: 'pcs',
        symbol: QQQ,
        asOf: evaluationNow.toISOString(),
        view: { mode: isHistorical ? 'historical' : 'live', date: selectedAsOf ?? qqqDailyBars.at(-1)?.date ?? null },
        dataStatus: dailyFactor?.confidence === 0 || daily.value === 'UNAVAILABLE' ? 'INSUFFICIENT' : 'LIVE',
        dataIssues: daily.reasons,
        daily: {
          eligibility: dailyFactor,
          reasons: daily.reasons,
          phase: livePhase,
          asOf: qqqDailyBars.at(-1)?.date ?? null,
          priceBasis: premarketQuote ? 'PREMARKET' as const : 'PREVIOUS_CLOSE' as const,
          confirmation: createRawFactor(livePhase === 'CLOSED' ? 100 : 0, (value) => Number.isFinite(value), dailyOnly ? '日线轻量响应未加载盘中数据' : '日线确认度'),
        },
        regime: {
          mode: regimeMode,
          selectedEngine: regimeMode === 'overlay' ? 'overlay' : 'unified',
          unified: unifiedPcsRegime.confidence > 0 ? String(unifiedPcsRegime.value) : null,
          overlay: overlayPcsRegime.confidence > 0 ? String(overlayPcsRegime.value) : null,
          disagreement: unifiedPcsRegime.confidence > 0 && overlayPcsRegime.confidence > 0 && unifiedPcsRegime.value !== overlayPcsRegime.value,
        },
        factors: dailyFactors,
        candidate,
      });
    }
    const syntheticCandidate = !isHistorical && candidate.status === 'UNAVAILABLE' ? buildSyntheticPcsResearchCandidate(candidateInput) : null;
    const probabilityContext = buildPcsProbabilityContext(
      qqqDailyBars,
      candidate,
      price,
      Number(historicalVolatility.value),
      isHistorical ? selectedAsOf ?? qqqDailyBars.at(-1)?.date : easternDateKey(evaluationNow),
    );
    const canRecordIntraday = isRegularSession(now)
      && factors.qqq_intraday_data_fresh.value === true
      && factors.qqq_intraday_price.confidence > 0
      && factors.qqq_intraday_vwap.confidence > 0
      && factors.qqq_pcs_execution_score?.confidence > 0
      && factors.qqq_pcs_execution_score.source.type !== 'fallback'
      && Number.isFinite(factors.qqq_pcs_execution_score.value);
    const gexCaptureTime = twoMinuteBucket(now).toISOString();
    const currentLifecyclePoint = !isHistorical && canRecordIntraday ? {
      time: gexCaptureTime,
      executionFactors: snapshotQqqLifecycleFactors('PCS', factors),
      score: Number(factors.qqq_pcs_execution_score.value), timing: factors.qqq_pcs_execution_timing?.value ?? 'INSUFFICIENT_DATA',
      contract: candidate.status === 'READY'
        ? { status: 'READY' as const, expiry: candidate.expiry, daysToExpiration: candidate.daysToExpiration, sigma: candidate.sigma, shortStrike: candidate.shortStrike, longStrike: candidate.longStrike, netCredit: candidate.netCredit, annualizedReturn: candidate.annualizedReturn }
        : { status: 'UNAVAILABLE' as const, reason: candidate.reason },
    } : null;
    // Unified Supabase collector owns GEX history; pages never generate new captures.
    const activeGexExpiryDates = useFrozenGexSnapshots
      ? (frozenGexSnapshots ?? []).map((snapshot) => snapshot.expiryDate)
      : gexExpirySnapshots.map((snapshot) => snapshot.expiryDate);
    const historyExpiryDate = requestedGexExpiry && activeGexExpiryDates.includes(requestedGexExpiry)
      ? requestedGexExpiry
      : activeGexExpiryDates[0] ?? null;
    const directionalExpiryDates = activeGexExpiryDates.slice(0, 3);
    const directionalDayStart = easternDayStartUtc(evaluationNow);
    const directionalDayEnd = new Date(directionalDayStart.getTime() + 24 * 60 * 60_000);
    const storedGexHistoryPromise = !isHistorical && !fastPage && historyExpiryDate
      ? readQqqGexExpiryHistory({
          policyId: timelinePolicy, expiryDate: historyExpiryDate,
          // The standalone live GEX page only renders the current trading day.
          // Reading the full retention summary here can hit the 4s Supabase timeout
          // and silently remove the 2m GEX table/history from the response.
          from: displayWindow
            ? new Date(displayWindow.fromMs).toISOString()
            : latestDisplayWindow
              ? easternDayStartUtc(now).toISOString()
              : new Date(now.getTime() - GEX_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000).toISOString(),
          profileFrom: displayWindow
            ? new Date(displayWindow.fromMs).toISOString()
            : isGexDisplayRequest(request) && latestDisplayWindow && session.bars.length
              ? new Date(latestGexDisplayWindow(session.bars)!.fromMs).toISOString()
            : easternDayStartUtc(now).toISOString(),
          ...(displayWindow ? { to: new Date(displayWindow.toMs).toISOString() } : {}),
        })
      : Promise.resolve(null);
    const directionalGexHistoryPromise: Promise<Map<string, QqqGexExpiryHistory['summary']> | null> = !isHistorical && !fastPage && directionalExpiryDates.length
      ? readQqqGexExpirySummaries({
          policyId: timelinePolicy,
          expiryDates: directionalExpiryDates,
          from: directionalDayStart.toISOString(),
          to: directionalDayEnd.toISOString(),
        })
      : Promise.resolve(new Map<string, QqqGexExpiryHistory['summary']>());
    const storedLifecyclePromise = !isHistorical
      ? readTodayQqqLifecycle({ policyId: timelinePolicy, now, current: currentLifecyclePoint })
      : Promise.resolve({ available: false, points: [] });
    const storedDirectionalSignalsPromise = !fastPage
      ? readQqqIntradayDirectionalSignals({
          from: directionalDayStart.toISOString(),
          to: directionalDayEnd.toISOString(),
        })
      : Promise.resolve(null);
    const [storedGexHistory, directionalGexHistories, lifecycle, storedDirectionalSignals] = await Promise.all([
      storedGexHistoryPromise,
      directionalGexHistoryPromise,
      storedLifecyclePromise,
      storedDirectionalSignalsPromise,
    ]);
    const gexDailyByDate = new Map<string, { totalGex: number; gammaFlipLevel: number | null }>();
    for (const point of storedGexHistory?.summary ?? []) {
      gexDailyByDate.set(easternDateKey(new Date(point.time)), { totalGex: point.netGex, gammaFlipLevel: point.gammaFlip });
    }
    const gexSeries = Array.from(gexDailyByDate, ([date, point]) => ({ date, ...point }));
    const researchHistoryFor = (snapshot: typeof gexExpirySnapshots[number]) => {
      const stored = snapshot.expiryDate === historyExpiryDate ? (storedGexHistory?.summary ?? []).filter(p => p.calculationVersion === QQQ_GEX_CALCULATION_VERSION) : [];
      const profiles = new Map((snapshot.expiryDate === historyExpiryDate ? storedGexHistory?.profiles : [])?.map((point) => [point.time, point.strikes]));
      const current = {
        time: gexCaptureTime,
      executionFactors: snapshotQqqLifecycleFactors('PCS', factors), spot: terminalSpot, netGex: snapshot.totalGex, gammaFlip: snapshot.gammaFlipLevel,
        callWallPrice: snapshot.summary.callWall?.strike ?? null, callWallMagnitude: snapshot.summary.callWall?.magnitude ?? null,
        putWallPrice: snapshot.summary.putWall?.strike ?? null, putWallMagnitude: snapshot.summary.putWall?.magnitude ?? null,
        profile: snapshot.fullProfile,
      };
      return [...stored.map((point) => ({ ...point, profile: profiles.get(point.time) ?? [] })), current]
        .filter((point, index, all) => all.findIndex((candidate) => candidate.time === point.time) === index)
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    };
    const researchExpiries: QqqGexResearchExpiry[] = gexExpirySnapshots.map((snapshot) => ({
      expiryDate: snapshot.expiryDate, dte: snapshot.dte, spot: terminalSpot, expectedMove: snapshot.metrics.expectedMove,
      netGex: snapshot.totalGex, gammaFlip: snapshot.gammaFlipLevel,
      callWallPrice: snapshot.summary.callWall?.strike ?? null, callWallMagnitude: snapshot.summary.callWall?.magnitude ?? null,
      putWallPrice: snapshot.summary.putWall?.strike ?? null, putWallMagnitude: snapshot.summary.putWall?.magnitude ?? null,
      profile: snapshot.fullProfile, history: researchHistoryFor(snapshot),
    }));
    const gexExpiries = useFrozenGexSnapshots ? (frozenGexSnapshots ?? []).map((snapshot) => {
      const storedProfiles = new Map((snapshot.expiryDate === historyExpiryDate ? storedGexHistory?.profiles : [])?.map((point) => [point.time, point.strikes]));
      const priorHistory = snapshot.expiryDate === historyExpiryDate
        ? (storedGexHistory?.summary ?? []).filter(point => point.calculationVersion === (snapshot.profile[0]?.calculationVersion ?? 'qqq-gex-legacy-v1')).map((point) => ({ ...point, profile: storedProfiles.get(point.time) ?? [] }))
        : [];
      const history = [...priorHistory, {
        time: snapshot.capturedAt, spot: snapshot.spot, netGex: snapshot.netGex, gammaFlip: snapshot.gammaFlip,
        callWallPrice: snapshot.callWallPrice, callWallMagnitude: snapshot.callWallMagnitude,
        putWallPrice: snapshot.putWallPrice, putWallMagnitude: snapshot.putWallMagnitude,
        kingStrike: snapshot.kingStrike, kingMagnitude: snapshot.kingMagnitude, kingSide: snapshot.kingSide,
        profile: snapshot.profile,
      }].filter((point, index, all) => all.findIndex((candidate) => candidate.time === point.time) === index)
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
      const summary = buildPersistedGexSummary(snapshot);
      const wallHistory = history.map((point) => ({ time: point.time, callWallPrice: point.callWallPrice, putWallPrice: point.putWallPrice, callWallMagnitude: point.callWallMagnitude, putWallMagnitude: point.putWallMagnitude, kingStrike: point.kingStrike, kingMagnitude: point.kingMagnitude, kingSide: point.kingSide }));
      const profile = snapshot.profile
        .slice().sort((left, right) => Math.abs(right.totalGex) - Math.abs(left.totalGex)).slice(0, 8)
        .sort((left, right) => left.strike - right.strike)
        .map((point) => ({ strike: point.strike, magnitude: point.totalGex, isCallWall: point.isCallWall, isPutWall: point.isPutWall, isGammaFlip: point.isGammaFlip }));
      return {
        asOf: snapshot.capturedAt, expiryDate: snapshot.expiryDate, dte: snapshot.dte,
        gex: history.map((point) => ({ time: point.time, totalGex: point.netGex, gammaFlipLevel: point.gammaFlip })),
        gexProfile: profile,
        gexProfileHistory: history.map((point) => ({ time: point.time, strikes: point.profile
          .slice().sort((left, right) => Math.abs(right.totalGex) - Math.abs(left.totalGex)).slice(0, 8)
          .sort((left, right) => left.strike - right.strike)
          .map((strike) => ({ strike: strike.strike, magnitude: strike.totalGex, isCallWall: strike.isCallWall, isPutWall: strike.isPutWall, isGammaFlip: strike.isGammaFlip })) })),
        fullGexProfile: snapshot.profile,
        fullGexProfileHistory: history.map((point) => ({ time: point.time, strikes: point.profile })),
        gexSummary: summary,
        wallHistory,
        terminal: null,
        research: null,
        gexInsights: buildGexInsights({ spot: price, gexSummary: summary, gexTopologyStructure: null, wallHistory, candidateShortStrike: undefined, now: evaluationNow }),
      };
    }) : gexExpirySnapshots.map((snapshot) => {
      const storedProfiles = new Map((snapshot.expiryDate === historyExpiryDate ? storedGexHistory?.profiles : [])?.map((point) => [point.time, point.strikes]));
      const storedHistory = snapshot.expiryDate === historyExpiryDate
        ? (storedGexHistory?.summary ?? []).filter(point => point.calculationVersion === QQQ_GEX_CALCULATION_VERSION).map((point) => ({ ...point, profile: storedProfiles.get(point.time) ?? [] }))
        : [];
      const history = storedHistory;
      const expiryWallHistory = history.map((point) => ({ time: point.time, callWallPrice: point.callWallPrice, putWallPrice: point.putWallPrice, callWallMagnitude: point.callWallMagnitude, putWallMagnitude: point.putWallMagnitude, kingStrike: point.kingStrike, kingMagnitude: point.kingMagnitude, kingSide: point.kingSide }));
      const terminal = QqqGexTerminalEngine.analyze({
        // Current quotes estimate remaining movement from current spot. A prior-close
        // anchor requires a separately retained opening premium, not today's decaying quote.
        asOf: evaluationNow.toISOString(), spot: terminalSpot, dte: snapshot.dte, expiryDate: snapshot.expiryDate, netGex: snapshot.totalGex,
        gammaFlip: snapshot.gammaFlipLevel, callWall: snapshot.summary.callWall?.strike ?? null, putWall: snapshot.summary.putWall?.strike ?? null,
        topology: snapshot.metrics.topology, strikes: snapshot.terminalStrikes,
        priceHistory: session.bars.map((bar) => ({ time: bar.timestamp, close: bar.close })),
        gammaHistory: history.map((point) => ({ time: point.time, spot: point.spot, gammaFlip: point.gammaFlip, callWall: point.callWallPrice, putWall: point.putWallPrice, netGex: point.netGex })),
        atmIv: qqqAtmIv(snapshot.chain.calls,snapshot.chain.puts,terminalSpot), hv20, ivHistory: [], factors,
      });
      const research = buildQqqGexResearchSurface({
        asOf: evaluationNow.toISOString(),
        expiries: researchExpiries,
        selectedExpiryDate: snapshot.expiryDate,
        bars: session.bars,
        labelAt: (() => {
          const latestBarAt = session.bars.at(-1)?.timestamp;
          if (!latestBarAt) return null;
          const cutoff = Date.parse(latestBarAt) - 60 * 60_000;
          return researchHistoryFor(snapshot).filter((point) => Date.parse(point.time) <= cutoff).at(-1)?.time ?? null;
        })(),
        pcsSpread: candidate.status === 'READY' && candidate.expiry === snapshot.expiryDate
          ? { shortStrike: candidate.shortStrike, longStrike: candidate.longStrike, entryCredit: candidate.netCredit, definedRisk: candidate.definedRisk }
          : null,
        sessionClosed: livePhase === 'CLOSED',
      });
      return {
        asOf: gexCaptureTime, expiryDate: snapshot.expiryDate, dte: snapshot.dte,
        gex: history.map((point) => ({ time: point.time, totalGex: point.netGex, gammaFlipLevel: point.gammaFlip })),
        gexProfile: snapshot.profile,
        gexProfileHistory: history.map((point) => ({
          time: point.time,
          strikes: point.profile
            .map((profile) => ({ strike: profile.strike, magnitude: profile.totalGex, isCallWall: profile.isCallWall, isPutWall: profile.isPutWall, isGammaFlip: profile.isGammaFlip }))
            .sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude))
            .slice(0, 8)
            .sort((a, b) => a.strike - b.strike),
        })),
        fullGexProfile: snapshot.fullProfile,
        fullGexProfileHistory: history.map((point) => ({ time: point.time, strikes: point.profile })),
        gexSummary: snapshot.summary,
        wallHistory: expiryWallHistory,
        terminal: toTerminalFactorView(terminal),
        research,
        gexInsights: buildGexInsights({ spot: terminalSpot, gexSummary: snapshot.summary, gexTopologyStructure: snapshot.topology, wallHistory: expiryWallHistory, candidateShortStrike: undefined, now: evaluationNow }),
      };
    });
    const liveDirectionalCurrent = new Map(gexExpirySnapshots.map((snapshot) => [snapshot.expiryDate, {
      dte: snapshot.dte,
      ...qqqDirectionalGexSnapshot(gexCaptureTime,snapshot.chain.capturedAt,snapshot.fullProfile),
      netGex: snapshot.totalGex,
      gammaFlip: snapshot.gammaFlipLevel,
      callWallPrice: snapshot.summary.callWall?.strike ?? null,
      putWallPrice: snapshot.summary.putWall?.strike ?? null,
      profile: snapshot.fullProfile,
    }]));
    const frozenDirectionalCurrent = new Map((frozenGexSnapshots ?? []).map((snapshot) => [snapshot.expiryDate, {
      dte: snapshot.dte,
      ...qqqDirectionalGexSnapshot(snapshot.capturedAt,null,snapshot.profile),
      netGex: snapshot.netGex,
      gammaFlip: snapshot.gammaFlip,
      callWallPrice: snapshot.callWallPrice,
      putWallPrice: snapshot.putWallPrice,
      profile: snapshot.profile,
    }]));
    const directionalExpiries: QqqIntradayGexExpiry[] = isHistorical ? [] : directionalExpiryDates.flatMap((expiryDate) => {
      const current = (useFrozenGexSnapshots ? frozenDirectionalCurrent : liveDirectionalCurrent).get(expiryDate);
      if (!current) return [];
      const stored = directionalGexHistories?.get(expiryDate) ?? [];
      const snapshots = [...stored.map((point) => ({
        time: point.availableAt ?? point.time, sourceAsOf: point.sourceAsOf, calculationVersion: point.calculationVersion, inputComplete: point.inputComplete, profile:point.profile,
        netGex: point.netGex,
        gammaFlip: point.gammaFlip,
        callWallPrice: point.callWallPrice,
        putWallPrice: point.putWallPrice,
      })), current]
        .filter((point, index, all) => all.findIndex((candidate) => candidate.time === point.time) === index)
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
      return [{ expiryDate, dte: current.dte, snapshots }];
    });
    const directionalBuild = buildQqqIntradayDirectionalFactors({
      asOf: evaluationNow.toISOString(),
      bars: session.bars,
      expiries: directionalExpiries,
    });
    let directionalSignals = storedDirectionalSignals ?? [];
    let directionalStorageAvailable = storedDirectionalSignals !== null;
    const directionalDecision = evaluateQqqDirectionalWithHistory(directionalBuild.factors, session.bars, directionalSignals);
    if (!isHistorical && qqqMarketSession(evaluationNow).stocksOpen && directionalStorageAvailable && directionalDecision.signalId && directionalDecision.anchorBar && ['ALERT_LONG', 'ALERT_SHORT'].includes(directionalDecision.status)) {
      const alreadyStored = directionalSignals.some((signal) => signal.signalId === directionalDecision.signalId);
      if (!alreadyStored) {
        const saved = await appendQqqIntradayDirectionalSignal({ decision: directionalDecision, factors: directionalBuild.factors });
        if (saved) directionalSignals = [...directionalSignals, directionalDecision].sort((left, right) => Date.parse(left.anchorBar ?? '') - Date.parse(right.anchorBar ?? ''));
        else directionalStorageAvailable = false;
      }
    }
    const displayedDirectionalDecision = isHistorical ? directionalDecision
      : qqqDisplayDecision(directionalDecision,directionalSignals,evaluationNow.getTime(),session.bars);
    const directionalOutcomes = directionalSignals.flatMap((signal) => {
      const entryReady = signal.intent === 'ENTRY' && signal.entryZone && signal.invalidation !== null && signal.targets;
      const riskReady = signal.intent === 'RISK_CUE' && signal.riskPlan && signal.structureContext;
      if (!signal.anchorBar || !signal.validUntil || !signal.direction || !signal.playbook || !signal.signalId || (!entryReady && !riskReady)) return [];
      const anchorIndex = session.bars.findIndex((bar) => bar.timestamp === signal.anchorBar);
      return anchorIndex >= 0 ? [simulateQqqIntradayDirectionalSignal(signal, session.bars, anchorIndex)] : [];
    });
    const primaryExpiryHistory = gexExpiries[0] ?? null;
    const gexProfile = primaryExpiryHistory?.gexProfile ?? [];
    const gexSummary = primaryExpiryHistory?.gexSummary ?? null;
    const gexTopologyStructure = useFrozenGexSnapshots
      ? null
      : gexExpirySnapshots.find((snapshot) => snapshot.expiryDate === primaryExpiryHistory?.expiryDate)?.topology ?? null;
    const primaryWallHistory = primaryExpiryHistory?.wallHistory ?? [];
    const required = isHistorical ? [
      'underlying_price', 'historical_volatility', 'vix_price', 'vix3m_price', 'pcs_market_regime', 'market_state',
    ] : requiredPcsLiveFactors(livePhase);
    const missing = Array.from(new Set(required
      .filter((id) => factors[id]?.confidence === 0)
      .map((id) => factors[id]?.source.type === 'fallback' ? factors[id].source.reason : id)
      .filter((issue): issue is string => Boolean(issue))));
    const gexSnapshotUnavailable = shouldReportMissingGexSnapshot({ includeGex, fastPage, dailyOnly, useFrozenGexSnapshots, snapshotCount: frozenGexSnapshots?.length ?? 0 });
    const dataStatus = isHistorical ? 'STALE' : missing.length
      ? 'INSUFFICIENT'
      : factors.qqq_intraday_data_fresh.value === true && factors.qqq_intraday_regular_session.value === true ? 'LIVE' : 'STALE';
    const candidateShortStrike = candidate.status === 'READY' ? candidate.shortStrike : undefined;
    const gexInsightsIntraday = buildGexInsights({ spot: price, gexSummary, gexTopologyStructure, wallHistory: primaryWallHistory, candidateShortStrike, now: evaluationNow });
    const gexInsights1d = buildGexInsights({ spot: price, gexSummary, gexTopologyStructure, candidateShortStrike, now: evaluationNow });
    const payload = {
      symbol: QQQ,
      asOf: evaluationNow.toISOString(),
      observedAt: isHistorical && session.bars.length ? new Date(Date.parse(session.bars.at(-1)!.timestamp)+120_000).toISOString() : evaluationNow.toISOString(),
      view: { mode: isHistorical ? 'historical' : 'live', date: selectedAsOf ?? qqqDailyBars.at(-1)?.date ?? null },
      intraday: session.bars.length
        ? { granularity: '2m' as const, session: selectedLiveSession.displaySession, bars: session.bars, extendedHoursBars: extendedHoursDisplayBars, scoreSeries: selectedLiveSession.displaySession === 'PREMARKET' ? [] : buildPcsIntradayScoreSeries(factors, session.bars), gex: primaryExpiryHistory?.gex ?? [], gexProfile, gexProfileHistory: primaryExpiryHistory?.gexProfileHistory ?? [], gexSummary, wallHistory: primaryWallHistory, gexInsights: gexInsightsIntraday, gexExpiries, gexAsOf: primaryExpiryHistory?.asOf ?? null, terminal: primaryExpiryHistory?.terminal ?? null, directional: { current: displayedDirectionalDecision, signals: directionalSignals, outcomes: directionalOutcomes, liveStatus: { available: directionalStorageAvailable, reason: directionalStorageAvailable ? null : '实时提醒记录读取或保存失败，请检查提醒存储与盘中采集任务。' } } }
        : !isHistorical && livePhase !== 'CLOSED'
          ? null
          : { granularity: '1d' as const, session: 'DAILY' as const, bars: qqqDailyBars.slice(-21).map((bar) => ({ timestamp: `${bar.date}T16:00:00.000Z`, close: bar.close, volume: bar.volume, open: bar.open, high: bar.high, low: bar.low })), scoreSeries: [], gex: gexSeries, gexProfile, gexSummary, gexAsOf: primaryExpiryHistory?.asOf ?? null, gexInsights: gexInsights1d },
      intradaySessionAsOf: session.asOf,
      dataStatus,
      dataIssues: [...missing, ...(gexSnapshotUnavailable ? ['非交易时段 GEX 快照不可用，已拒绝使用延迟期权链'] : [])],
      daily: {
        eligibility: snapshot.dailyEligibility,
        reasons: daily.reasons,
        phase,
        asOf: qqqDailyBars.at(-1)?.date ?? null,
        priceBasis: premarketQuote ? 'PREMARKET' as const : 'PREVIOUS_CLOSE' as const,
        confirmation: factors.pcs_daily_confirmation,
      },
      regime: {
        mode: regimeMode,
        selectedEngine: regimeMode === 'overlay' ? 'overlay' : 'unified',
        unified: unifiedPcsRegime.confidence > 0 ? String(unifiedPcsRegime.value) : null,
        overlay: overlayPcsRegime.confidence > 0 ? String(overlayPcsRegime.value) : null,
        disagreement: unifiedPcsRegime.confidence > 0 && overlayPcsRegime.confidence > 0 && unifiedPcsRegime.value !== overlayPcsRegime.value,
      },
      timing: snapshot.intradayTiming,
      factors: { ...snapshot.factors, ...directionalBuild.factors },
      lifecycle,
      candidate,
      syntheticCandidate,
      probabilityContext,
    };

    // `from` / `to` is intentionally a response-only display contract for the
    // standalone GEX chart. The complete session above remains available to
    // factor construction and the PCS decision chain.
    const effectiveDisplayWindow = displayWindow ?? (latestDisplayWindow && payload.intraday?.granularity === '2m'
      ? latestGexDisplayWindow(payload.intraday.bars)
      : null);
    const windowedPayload = effectiveDisplayWindow && payload.intraday?.granularity === '2m'
      ? {
          ...payload,
          intraday: {
            ...payload.intraday,
            bars: isGexDisplayRequest(request) ? payload.intraday.bars : withinGexDisplayWindow(payload.intraday.bars, effectiveDisplayWindow),
            extendedHoursBars: isGexDisplayRequest(request) ? payload.intraday.extendedHoursBars : withinGexDisplayWindow(payload.intraday.extendedHoursBars ?? [], effectiveDisplayWindow),
            scoreSeries: withinGexDisplayWindow(payload.intraday.scoreSeries, effectiveDisplayWindow),
            gex: withinGexDisplayWindow(payload.intraday.gex ?? [], effectiveDisplayWindow),
            gexProfileHistory: withinGexDisplayWindow(payload.intraday.gexProfileHistory ?? [], effectiveDisplayWindow),
            wallHistory: withinGexDisplayWindow(payload.intraday.wallHistory ?? [], effectiveDisplayWindow),
            gexExpiries: payload.intraday.gexExpiries?.map((expiry) => ({
              ...expiry,
              gex: withinGexDisplayWindow(expiry.gex, effectiveDisplayWindow),
              gexProfileHistory: withinGexDisplayWindow(expiry.gexProfileHistory, effectiveDisplayWindow),
              fullGexProfileHistory: withinGexDisplayWindow(expiry.fullGexProfileHistory, effectiveDisplayWindow),
              wallHistory: withinGexDisplayWindow(expiry.wallHistory, effectiveDisplayWindow),
            })),
          },
        }
      : payload;
    const displayProjection = isGexDisplayRequest(request);
    const responsePayload = displayProjection
      ? projectQqqGexDisplayPayload(windowedPayload, requestedGexExpiry, payload.intraday?.granularity === '2m' ? payload.intraday.bars : undefined)
      : windowedPayload;
    if (QQQ_GEX_DEBUG) {
      const intraday = responsePayload.intraday;
      console.info('[DEBUG-QQQ-GEX-RESPONSE]', {
        request: new URL(request.url).search,
        effectiveWindow: effectiveDisplayWindow,
        displayProjection,
        raw: payload.intraday ? {
          granularity: payload.intraday.granularity,
          bars: payload.intraday.bars.length,
          gex: payload.intraday.gex?.length ?? 0,
          gexExpiries: payload.intraday.gexExpiries?.length ?? 0,
        } : null,
        returned: intraday ? {
          granularity: intraday.granularity,
          bars: intraday.bars.length,
          gex: intraday.gex?.length ?? 0,
          gexExpiries: intraday.gexExpiries?.length ?? 0,
          expiryBuckets: intraday.gexExpiries?.map((expiry) => ({
            expiryDate: expiry.expiryDate,
            gex: expiry.gex.length,
            profile: expiry.fullGexProfile.length,
            profileHistory: expiry.fullGexProfileHistory.length,
          })),
        } : null,
      });
    }
    if (historicalCacheKey) persistCacheInBackground(historicalCacheKey, responsePayload, PCS_HISTORICAL_CACHE_TTL_SECONDS);
    return NextResponse.json(responsePayload, {
      headers: historicalCacheKey
        ? { 'x-cache': 'MISS' }
        : {
            'x-cache': 'SPLIT',
            'x-slow-cache': slowBundle?.cache ?? 'MISS',
            'x-fast-cache': fastBundle?.cache ?? 'MISS',
          },
    });
  } catch (error) {
    return NextResponse.json({ error: 'QQQ PCS 数据装配失败', detail: error instanceof Error ? error.message : 'unknown error' }, { status: 503 });
  }
}

export async function GET(request: Request) {
  if(!isGexDisplayRequest(request))return Response.json({error:'Use POST /api/analysis/qqq/backtest for fixed PCS.EPR / CCS.C3.E856 SDK v2 decisions'}, {status:410});
  const now = new Date();
  const selectedAsOf = historicalAsOf(request);
  const displayRequest = isGexDisplayRequest(request);
  const searchParams = new URL(request.url).searchParams;
  const dailyOnly = searchParams.get('dailyOnly') === '1';
  const fastPage = searchParams.get('fast') === '1';
  // Collector executions must persist their own capture; never satisfy them
  // from a page response that skipped cron-only writes.
  if (selectedAsOf || searchParams.get('qqqDirectionalCron') === '1') return runPcsGet(request);

  const livePhase = dailyEvaluationPhase(now);
  const regimeMode = parseRegimeMode(request);
  const requestedGexExpiry = selectedGexExpiry(request);
  const displayWindow = gexDisplayWindow(request, now);
  const latestDisplayWindow = requestsLatestGexDisplayWindow(request);
  const cacheKey = (searchParams.get('gexEvidence')==='1' ? 'evidence:' : searchParams.get('gexOverview')==='1' ? 'overview:' : 'details:') + pcsLiveResponseCacheKey({ now, livePhase, regimeMode, requestedGexExpiry, displayWindow,
    latestDisplayWindow, fast: fastPage, displayOnly: displayRequest, dailyOnly, includeGex: searchParams.get('includeGex') !== '0' });
  return pcsResponseCache.run(cacheKey, () => runPcsGet(request), PCS_LIVE_RESPONSE_CACHE_TTL_SECONDS * 1000, displayRequest ? request.headers.get('if-none-match') : undefined,
    displayRequest && request.headers.get('x-qqq-gex-delta')==='1', request.headers.get('accept-encoding'));
}
