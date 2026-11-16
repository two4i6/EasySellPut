import { qqqGammaExpiryTime } from '@/lib/qqqGammaModel';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import { createDerivedFactor, fallbackFactor } from '@/lib/factor';

/** Analysis-only dealer model. It describes a conditional hedge response, not an observable dealer position. */
export type GammaRegime = 'POSITIVE_GAMMA' | 'NEGATIVE_GAMMA' | 'TRANSITION' | 'PINNING' | 'UNAVAILABLE';
export type HedgeDirection = 'BUY' | 'SELL' | 'BALANCED' | 'UNCERTAIN';
export type ExpectedMoveState = 'INSIDE_RANGE' | 'NEAR_LOWER_BOUND' | 'NEAR_UPPER_BOUND' | 'OUTSIDE_LOWER' | 'OUTSIDE_UPPER' | 'UNAVAILABLE';
export type FlipTrend = 'IMPROVING' | 'DETERIORATING' | 'STABLE' | 'INSUFFICIENT_HISTORY';
export type PrimaryRisk = 'DOWNSIDE_ACCELERATION' | 'UPSIDE_ACCELERATION' | 'MEAN_REVERSION' | 'RANGE_COMPRESSION' | 'UNCERTAIN';
export type VolatilityEdge = 'RICH' | 'FAIR' | 'CHEAP' | 'UNAVAILABLE';
export type TradeEligibilityStatus = 'ELIGIBLE' | 'CONDITIONAL' | 'BLOCKED' | 'UNAVAILABLE';
export type TerminalFactorSource = 'REAL' | 'DERIVED' | 'INFERRED' | 'PROXY' | 'STALE' | 'UNAVAILABLE';
export type FlowBias = 'CALL_BUYING_INFERRED' | 'PUT_BUYING_INFERRED' | 'PUT_SELLING_INFERRED' | 'CALL_SELLING_INFERRED' | 'MIXED' | 'UNAVAILABLE';

export type TerminalStrike = {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callOi?: number;
  putOi?: number;
  callVolume?: number;
  putVolume?: number;
  callMid?: number | null;
  putMid?: number | null;
  callLast?: number | null;
  putLast?: number | null;
  callIv?: number | null;
  putIv?: number | null;
};

export type TerminalHistoryPoint = {
  time: string | number;
  spot: number;
  gammaFlip: number | null;
  callWall?: number | null;
  putWall?: number | null;
  netGex?: number;
};

export type TerminalInput = {
  asOf: string;
  spot: number;
  dte: number;
  expiryDate?: string;
  netGex: number;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  topology?: { crowding?: 'LOW' | 'MEDIUM' | 'HIGH'; structure?: string; flipPosition?: 'ABOVE_FLIP' | 'BELOW_FLIP' | 'NEAR_FLIP' };
  strikes: TerminalStrike[];
  priceHistory?: Array<{ time: string | number; close: number }>;
  gammaHistory?: TerminalHistoryPoint[];
  /** Optional what-if reference; live remaining-move estimates use current spot. Not a full-day opening range. */
  expectedMoveReference?: number | null;
  atmIv?: number | null; // decimal, e.g. .24
  hv20?: number | null; // decimal, e.g. .18
  ivHistory?: number[];
  factors?: FactorMap;
};

export type DealerPressure = {
  regime: GammaRegime;
  direction: HedgeDirection;
  intensity: number;
  confidence: number;
  source: 'INFERRED' | 'UNAVAILABLE';
  factors: { netGexContribution: number | null; flipDistanceContribution: number | null; priceVelocityContribution: number | null; gammaConcentrationContribution: number | null };
  explanation: string[];
  analysisOnly: true;
};

export type ExpectedMove = {
  value: number | null;
  lower: number | null;
  upper: number | null;
  rangePositionPct: number | null;
  downsideMoveUsedPct: number | null;
  upsideMoveUsedPct: number | null;
  distanceToLower: number | null;
  distanceToUpper: number | null;
  state: ExpectedMoveState;
  method: 'ATM_STRADDLE' | 'IV_1SIGMA' | 'UNAVAILABLE';
  sellerImplication: string;
  factor: FinancialFactor<number | null>;
};

export type IvPremiumView = {
  currentIv: number | null;
  hv20: number | null;
  vrp: number | null;
  ivHvRatio: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  sampleSize: number;
  historyStatus?: 'MISSING' | 'INSUFFICIENT' | 'CONSTANT' | 'AVAILABLE';
  historyReason?: string;
  environment: VolatilityEdge;
  confidence: number;
  source: 'REAL' | 'PROXY' | 'UNAVAILABLE';
  factor: FinancialFactor<number | null>;
};

export type FlipVelocity = { change: number | null; pointsPerHour: number | null; trend: FlipTrend; sampleSize: number; reason: string };
export type WallQuality = {
  strike: number | null; side: 'CALL' | 'PUT'; score: number | null; confidence: number;
  classification: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNCONFIRMED';
  factors: { gexConcentration: number | null; oiConcentration: number | null; stability: number | null; distanceRelevance: number | null; priceReaction: number | null; flowConfirmation: number | null };
  strengths: string[]; weaknesses: string[]; source: 'DERIVED' | 'UNAVAILABLE';
};
export type GammaClock = { intensity: number | null; level: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNAVAILABLE'; reason: string };
export type InferredFlow = { label: 'INFERRED_NOT_TAPE'; bias: FlowBias; callPremium: number; putPremium: number; confidence: number; notableStrikes: Array<{ strike: number; side: 'CALL' | 'PUT'; premium: number }>; reason: string };

export type TerminalAnalysis = {
  asOf: string;
  dealer: DealerPressure;
  expectedMove: ExpectedMove;
  iv: IvPremiumView;
  premiumScore: { total: number | null; status: 'GOOD_FOR_CREDIT' | 'CAUTION' | 'UNAVAILABLE'; components: Record<string, number> };
  flipVelocity: FlipVelocity;
  callWallQuality: WallQuality;
  putWallQuality: WallQuality;
  decision: {
    regime: GammaRegime; primaryRisk: PrimaryRisk; premiumEdge: VolatilityEdge;
    keyLevel: { type: 'PUT_WALL' | 'CALL_WALL' | 'GAMMA_FLIP' | 'NONE'; value: number | null };
    sellerAction: 'ELIGIBLE' | 'CONDITIONAL' | 'WAIT' | 'DEFINED_RISK_ONLY' | 'BLOCKED';
    confidence: number; dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'PARTIAL';
    reasons: string[]; transition: string[]; playbook: string[];
  };
  gammaClock: GammaClock;
  flow: InferredFlow;
  analysisOnly: true;
  modelLabels: readonly ['INFERRED', 'PROXY', 'INFERRED_NOT_TAPE'];
};

/** API-safe terminal projection: every financial value retains source/confidence instead of crossing the route as a bare number. */
export type TerminalFactorView = {
  asOf: string;
  analysisOnly: true;
  modelLabels: readonly ['INFERRED', 'PROXY', 'INFERRED_NOT_TAPE'];
  dealer: Omit<DealerPressure, 'intensity' | 'confidence'> & { intensity: FinancialFactor<number | null>; confidence: FinancialFactor<number | null> };
  expectedMove: Omit<ExpectedMove, 'value' | 'lower' | 'upper' | 'rangePositionPct' | 'downsideMoveUsedPct' | 'upsideMoveUsedPct' | 'distanceToLower' | 'distanceToUpper'> & { value: FinancialFactor<number | null>; lower: FinancialFactor<number | null>; upper: FinancialFactor<number | null>; rangePositionPct: FinancialFactor<number | null>; downsideMoveUsedPct: FinancialFactor<number | null>; upsideMoveUsedPct: FinancialFactor<number | null>; distanceToLower: FinancialFactor<number | null>; distanceToUpper: FinancialFactor<number | null> };
  iv: Omit<IvPremiumView, 'currentIv' | 'hv20' | 'vrp' | 'ivHvRatio' | 'ivRank' | 'ivPercentile' | 'confidence'> & { currentIv: FinancialFactor<number | null>; hv20: FinancialFactor<number | null>; vrp: FinancialFactor<number | null>; ivHvRatio: FinancialFactor<number | null>; ivRank: FinancialFactor<number | null>; ivPercentile: FinancialFactor<number | null>; confidence: FinancialFactor<number | null> };
  premiumScore: Omit<TerminalAnalysis['premiumScore'], 'total' | 'components'> & { total: FinancialFactor<number | null>; components: Record<string, FinancialFactor<number>> };
  flipVelocity: Omit<FlipVelocity, 'change' | 'pointsPerHour'> & { change: FinancialFactor<number | null>; pointsPerHour: FinancialFactor<number | null> };
  callWallQuality: Omit<WallQuality, 'score' | 'confidence'> & { score: FinancialFactor<number | null>; confidence: FinancialFactor<number | null> };
  putWallQuality: Omit<WallQuality, 'score' | 'confidence'> & { score: FinancialFactor<number | null>; confidence: FinancialFactor<number | null> };
  decision: Omit<TerminalAnalysis['decision'], 'confidence'> & { confidence: FinancialFactor<number | null> };
  gammaClock: Omit<GammaClock, 'intensity'> & { intensity: FinancialFactor<number | null> };
  flow: Omit<InferredFlow, 'callPremium' | 'putPremium' | 'confidence' | 'notableStrikes'> & { callPremium: FinancialFactor<number>; putPremium: FinancialFactor<number>; confidence: FinancialFactor<number>; notableStrikes: Array<{ strike: FinancialFactor<number>; side: 'CALL' | 'PUT'; premium: FinancialFactor<number> }> };
};

const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const time = (value: string | number) => typeof value === 'number' ? value : Date.parse(value);
const nearest = (strikes: TerminalStrike[], spot: number) => strikes.reduce<TerminalStrike | null>((best, point) => !best || Math.abs(point.strike - spot) < Math.abs(best.strike - spot) ? point : best, null);

function derivedOrFallback<T>(value: T, factorIds: string[], factors: FactorMap | undefined, reason: string): FinancialFactor<T> {
  if (!factors || factorIds.some((id) => !factors[id])) return fallbackFactor(value, reason);
  return createDerivedFactor(value, factorIds.map((factorId) => ({ factorId, weight: 1 / factorIds.length })), factors);
}

export function classifyGammaRegime(input: Pick<TerminalInput, 'spot' | 'netGex' | 'gammaFlip' | 'topology' | 'strikes'>): GammaRegime {
  if (!valid(input.spot) || !Number.isFinite(input.netGex) || input.strikes.length === 0 || input.strikes.some(p => !Number.isFinite(p.netGex))) return 'UNAVAILABLE';
  const absTotal = input.strikes.reduce((sum, point) => sum + Math.abs(point.netGex), 0);
  if (!(absTotal > 0)) return 'UNAVAILABLE';
  const flipDistance = valid(input.gammaFlip) ? Math.abs(input.spot - input.gammaFlip) / input.spot : Infinity;
  if (input.netGex === 0 || flipDistance <= .0025) return 'TRANSITION';
  if (absTotal > 0 && input.netGex > 0 && input.topology?.crowding === 'HIGH' && flipDistance <= .01) return 'PINNING';
  return input.netGex >= 0 ? 'POSITIVE_GAMMA' : 'NEGATIVE_GAMMA';
}

function priceVelocity(history: TerminalInput['priceHistory']): number | null {
  if (!history || history.length < 2) return null;
  const first = history.at(-2)!;
  const last = history.at(-1)!;
  if (!valid(first.close) || !valid(last.close)) return null;
  const elapsedMinutes = (time(last.time) - time(first.time)) / 60_000;
  return elapsedMinutes > 0 && Number.isFinite(elapsedMinutes) ? (last.close - first.close) / elapsedMinutes * 5 : null;
}

export function calculateDealerPressure(input: TerminalInput): DealerPressure {
  const regime = classifyGammaRegime(input);
  const velocity = priceVelocity(input.priceHistory);
  const totalAbsGex = input.strikes.reduce((sum, item) => sum + Math.abs(item.netGex), 0);
  const concentration = totalAbsGex > 0 ? input.strikes.map(p => Math.abs(p.netGex)).sort((a,b) => b-a).slice(0,3).reduce((s,v) => s+v,0) / totalAbsGex : null;
  const flipDistance = valid(input.gammaFlip) ? Math.abs(input.spot - input.gammaFlip) / input.spot : null;
  const unavailable = velocity === null || regime === 'UNAVAILABLE';
  const netGexContribution = Number.isFinite(input.netGex) ? clamp(Math.abs(input.netGex) / Math.max(totalAbsGex, 1) * 100) : null;
  const flipDistanceContribution = flipDistance === null ? null : clamp((1 - Math.min(flipDistance / .01, 1)) * 100);
  const priceVelocityContribution = velocity === null ? null : clamp(Math.abs(velocity) / Math.max(input.spot * .002, .01) * 100);
  const gammaConcentrationContribution = concentration === null ? null : clamp(concentration * 100);
  if (unavailable) return { regime, direction: 'UNCERTAIN', intensity: 0, confidence: 0, source: 'UNAVAILABLE', factors: { netGexContribution, flipDistanceContribution, priceVelocityContribution, gammaConcentrationContribution }, explanation: ['缺少有效的近期价格速度或 Gamma 结构，无法推断对冲压力。'], analysisOnly: true };
  const amplifies = regime === 'NEGATIVE_GAMMA';
  const followsMove = amplifies ? velocity : -velocity;
  const direction = regime === 'TRANSITION' ? 'UNCERTAIN' : Math.abs(followsMove) < input.spot * .00005 ? 'BALANCED' : followsMove > 0 ? 'BUY' : 'SELL';
  const weighted = [[netGexContribution,.35],[flipDistanceContribution,.2],[priceVelocityContribution,.3],[gammaConcentrationContribution,.15]] as const;
  const availableWeight = weighted.reduce((s,[v,w]) => v === null ? s : s+w,0);
  const intensity = availableWeight > 0 ? clamp(weighted.reduce((s,[v,w]) => v === null ? s : s+v*w,0)/availableWeight) : 0;
  const confidence = clamp((valid(input.gammaFlip) ? 25 : 0) + (input.strikes.length >= 5 ? 25 : 0) + (velocity !== null ? 25 : 0) + (concentration !== null ? 25 : 0));
  return {
    regime, direction, intensity, confidence, source: 'INFERRED',
    factors: { netGexContribution, flipDistanceContribution, priceVelocityContribution, gammaConcentrationContribution },
    explanation: [
      `${regime} 是由净 GEX 与 Flip 相对位置推导，不代表可观察的 dealer 持仓。`,
      `近期价格速度 ${velocity >= 0 ? '+' : ''}${velocity.toFixed(2)}；模型${amplifies ? '按顺势' : '按逆势'}推断对冲敏感度。`,
      valid(input.gammaFlip) ? `距 Gamma Flip ${(flipDistance! * 100).toFixed(2)}%。` : 'Gamma Flip 不可用，已降低置信度。',
    ], analysisOnly: true,
  };
}

export function calculateExpectedMove(input: TerminalInput): ExpectedMove {
  const unavailable = { value: null, lower: null, upper: null, rangePositionPct: null, downsideMoveUsedPct: null, upsideMoveUsedPct: null, distanceToLower: null, distanceToUpper: null, state: 'UNAVAILABLE' as const, method: 'UNAVAILABLE' as const, sellerImplication: '缺少有效现价或期权定价，不能评估预期波动区间。', factor: fallbackFactor(null, 'spot 不可用') };
  if (!valid(input.spot)) return unavailable;
  const atm = nearest(input.strikes, input.spot);
  const straddle = atm && valid(atm.callMid) && valid(atm.putMid) ? atm.callMid + atm.putMid : null;
  const asOf = Date.parse(input.asOf);
  const expiryDate = input.expiryDate ?? (Number.isFinite(asOf) && Number.isInteger(input.dte) && input.dte >= 0 ? new Date(Date.parse(qqqMarketSession(new Date(asOf)).date + 'T00:00:00Z') + input.dte * 86400000).toISOString().slice(0,10) : '');
  const remainingYears = (qqqGammaExpiryTime(expiryDate) - asOf) / (365 * 86400000);
  if (!(remainingYears > 0)) return unavailable;
  const fallback = valid(input.atmIv) ? input.spot * input.atmIv * Math.sqrt(remainingYears) : null;
  const value = straddle ?? fallback;
  const method = straddle !== null ? 'ATM_STRADDLE' : fallback !== null ? 'IV_1SIGMA' : 'UNAVAILABLE';
  const factor = value === null ? fallbackFactor(null, 'ATM straddle 与 ATM IV 均不可用') : derivedOrFallback(value, ['underlying_price', 'iv_atm'], input.factors, method === 'ATM_STRADDLE' ? 'ATM straddle 直接报价未进入 FactorMap' : 'ATM IV 或 spot 未进入 FactorMap');
  const reference = valid(input.expectedMoveReference) ? input.expectedMoveReference : input.spot;
  const lower = value === null ? null : reference - value;
  const upper = value === null ? null : reference + value;
  const distance = value === null ? null : Math.abs(input.spot - reference);
  if (value === null || lower === null || upper === null) return { ...unavailable, method, factor };
  const rangeWidth = upper - lower;
  const rangePositionPct = clamp((input.spot - lower) / rangeWidth * 100);
  const downsideMoveUsedPct = clamp((reference - input.spot) / value * 100, 0, 100);
  const upsideMoveUsedPct = clamp((input.spot - reference) / value * 100, 0, 100);
  const state: ExpectedMoveState = input.spot < lower ? 'OUTSIDE_LOWER' : input.spot > upper ? 'OUTSIDE_UPPER' : rangePositionPct <= 20 ? 'NEAR_LOWER_BOUND' : rangePositionPct >= 80 ? 'NEAR_UPPER_BOUND' : 'INSIDE_RANGE';
  const sellerImplication = valid(input.expectedMoveReference)
    ? '当前剩余波动幅度在指定参考价上的情景区间；不能据此判断全天波动已消耗。'
    : '以现价为中心估算至到期的剩余波动；区间会随价格与权利金更新，不代表支撑阻力。';
  return { value, lower, upper, rangePositionPct, downsideMoveUsedPct, upsideMoveUsedPct, distanceToLower: input.spot - lower, distanceToUpper: upper - input.spot, state, method, sellerImplication, factor };
}

export function calculateIvPremium(input: TerminalInput): IvPremiumView {
  const currentIv = valid(input.atmIv) ? input.atmIv : null;
  const hv20 = typeof input.hv20 === 'number' && Number.isFinite(input.hv20) && input.hv20 >= 0 ? input.hv20 : null;
  const samples = (input.ivHistory ?? []).filter(valid);
  const vrp = currentIv !== null && hv20 !== null ? currentIv - hv20 : null;
  const ivHvRatio = currentIv !== null && hv20 !== null && hv20 > 0 ? currentIv / hv20 : null;
  const hasHistory = samples.length >= 20 && currentIv !== null;
  const historyRange = samples.length>=20 ? Math.max(...samples) - Math.min(...samples) : 0;
  const ivRank = hasHistory && historyRange > 0 ? clamp((currentIv - Math.min(...samples)) / historyRange * 100) : null;
  const ivPercentile = hasHistory ? samples.filter((item) => item <= currentIv!).length / samples.length * 100 : null;
  const environment: VolatilityEdge = currentIv === null || hv20 === null ? 'UNAVAILABLE' : vrp! >= .05 && (ivRank ?? 0) >= 60 ? 'RICH' : vrp! >= 0 && (ivRank === null || ivRank >= 30) ? 'FAIR' : 'CHEAP';
  const historyStatus=samples.length===0?'MISSING':samples.length<20?'INSUFFICIENT':historyRange===0?'CONSTANT':'AVAILABLE';
  const historyReason=historyStatus==='MISSING'?'尚无可比 IV 历史，不生成 Rank 或 Percentile':historyStatus==='INSUFFICIENT'?`可比有效样本 ${samples.length}/20`:historyStatus==='CONSTANT'?'历史 IV 无变化，Rank 分母为零；Percentile 可单独观察':'按调用方提供的可比历史样本计算；不是预测胜率';
  const confidence = clamp((currentIv !== null ? 35 : 0) + (hv20 !== null ? 30 : 0) + (hasHistory ? 25 : 0) + (samples.length ? 10 : 0));
  return { currentIv, hv20, vrp, ivHvRatio, ivRank, ivPercentile, sampleSize: samples.length, historyStatus,historyReason,environment, confidence, source: currentIv === null ? 'UNAVAILABLE' : hasHistory ? 'REAL' : 'PROXY', factor: currentIv === null ? fallbackFactor(null, 'ATM IV 不可用') : derivedOrFallback(currentIv, ['iv_atm'], input.factors, 'ATM IV 不在 FactorMap') };
}

export function calculateFlipVelocity(history: TerminalHistoryPoint[] | undefined): FlipVelocity {
  const usable = (history ?? []).filter((point) => valid(point.gammaFlip)).sort((a, b) => time(a.time) - time(b.time));
  if (usable.length < 3) return { change: null, pointsPerHour: null, trend: 'INSUFFICIENT_HISTORY', sampleSize: usable.length, reason: '至少需要 3 个有效 Gamma Flip 快照' };
  const first = usable[0]; const last = usable.at(-1)!;
  const elapsedHours = (time(last.time) - time(first.time)) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < 1 / 6) return { change: null, pointsPerHour: null, trend: 'INSUFFICIENT_HISTORY', sampleSize: usable.length, reason: '有效样本覆盖不足 10 分钟' };
  const change = last.gammaFlip! - first.gammaFlip!;
  const pointsPerHour = change / elapsedHours;
  return { change, pointsPerHour, trend: Math.abs(change) < .25 ? 'STABLE' : change > 0 ? 'IMPROVING' : 'DETERIORATING', sampleSize: usable.length, reason: `覆盖 ${Math.round(elapsedHours * 60)} 分钟的 ${usable.length} 个快照` };
}

export function calculateWallQuality(input: TerminalInput, side: 'CALL' | 'PUT'): WallQuality {
  const wall = side === 'CALL' ? input.callWall : input.putWall;
  const point = input.strikes.find((item) => item.strike === wall);
  const oi = point && (side === 'CALL' ? point.callOi : point.putOi);
  const ownGex = point && Math.abs(side === 'CALL' ? point.callGex : point.putGex);
  const allGex = input.strikes.reduce((sum, item) => sum + Math.abs(side === 'CALL' ? item.callGex : item.putGex), 0);
  const allOi = input.strikes.reduce((sum, item) => sum + (side === 'CALL' ? item.callOi ?? 0 : item.putOi ?? 0), 0);
  const history = input.gammaHistory ?? [];
  const stableObservations = history.filter((item) => (side === 'CALL' ? item.callWall : item.putWall) === wall).length;
  const gexConcentration = valid(ownGex) && allGex > 0 ? clamp(ownGex / allGex) : null;
  const oiConcentration = valid(oi) && allOi > 0 ? clamp(oi / allOi) : null;
  const stability = history.length >= 3 ? clamp(stableObservations / history.length) : null;
  const distance = valid(wall) ? Math.abs(input.spot - wall) / input.spot : Infinity;
  const distanceRelevance = valid(wall) && valid(input.spot) ? clamp(1 - distance / .03) : null;
  // 仅有快照 GEX/OI，尚无可验证的价格拒绝或逐笔 flow；明确保留为缺失项。
  const priceReaction = null;
  const flowConfirmation = null;
  const weighted = [[gexConcentration, .30], [oiConcentration, .15], [stability, .20], [distanceRelevance, .15], [priceReaction, .10], [flowConfirmation, .10]] as const;
  const availableWeight = weighted.reduce((sum, [value, weight]) => value === null ? sum : sum + weight, 0);
  if (!valid(wall) || !point || gexConcentration === null || availableWeight === 0) return { strike: wall, side, score: null, confidence: 0, classification: 'UNCONFIRMED', factors: { gexConcentration, oiConcentration, stability, distanceRelevance, priceReaction, flowConfirmation }, strengths: [], weaknesses: ['墙位、同侧 GEX 或 OI 数据不可用。'], source: 'UNAVAILABLE' };
  const normalized = weighted.reduce((sum, [value, weight]) => value === null ? sum : sum + value * weight, 0) / availableWeight;
  const score = clamp(normalized * 10, 0, 10);
  const confidence = clamp(availableWeight * 100);
  const strengths = [gexConcentration !== null && gexConcentration >= .2 ? `同侧 GEX 集中度 ${(gexConcentration * 100).toFixed(0)}%。` : null, oiConcentration !== null && oiConcentration >= .2 ? `OI 集中度 ${(oiConcentration * 100).toFixed(0)}%。` : null, stability !== null && stability >= .67 ? `墙位在 ${stableObservations}/${history.length} 个快照保持。` : null, distanceRelevance !== null && distanceRelevance >= .7 ? `距现价 ${(distance * 100).toFixed(2)}%，相关性高。` : null].filter((value): value is string => value !== null);
  const weaknesses = [oiConcentration === null ? '缺少 OI 集中度。' : null, stability === null ? '至少需 3 个有效快照才评估稳定性。' : null, '尚无确认的价格拒绝数据。', 'Options flow 仅为推断，未作为确认项。'].filter((value): value is string => value !== null);
  return { strike: wall, side, score: Math.round(score * 10) / 10, confidence, classification: score >= 7 && confidence >= 60 ? 'STRONG' : score >= 4 ? 'MODERATE' : 'WEAK', factors: { gexConcentration, oiConcentration, stability, distanceRelevance, priceReaction, flowConfirmation }, strengths, weaknesses, source: 'DERIVED' };
}

export function calculateGammaClock(input: TerminalInput): GammaClock {
  if (!valid(input.spot) || input.strikes.length === 0 || input.strikes.some(p => !valid(p.strike) || !Number.isFinite(p.netGex))) return { intensity: null, level: 'UNAVAILABLE', reason: '缺少有效 spot 或 strike GEX' };
  const near = input.strikes.filter((point) => Math.abs(point.strike - input.spot) / input.spot <= .01).reduce((sum, point) => sum + Math.abs(point.netGex), 0);
  const total = input.strikes.reduce((sum, point) => sum + Math.abs(point.netGex), 0);
  if (total <= 0) return { intensity: null, level: 'UNAVAILABLE', reason: '有效 GEX 为零' };
  const intensity = near / total * 100;
  return { intensity, level: intensity >= 45 ? 'HIGH' : intensity >= 20 ? 'MEDIUM' : 'LOW', reason: '基于现价 ±1% 的实际 Gamma 占全链 Gamma 的比例' };
}

export function inferOptionsFlow(input: Pick<TerminalInput, 'strikes'>): InferredFlow {
  const rows = input.strikes.flatMap((point) => ([
    { strike: point.strike, side: 'CALL' as const, premium: (point.callVolume ?? 0) * (point.callMid ?? point.callLast ?? 0) * 100 },
    { strike: point.strike, side: 'PUT' as const, premium: (point.putVolume ?? 0) * (point.putMid ?? point.putLast ?? 0) * 100 },
  ])).filter((row) => row.premium > 0);
  const callPremium = rows.filter((row) => row.side === 'CALL').reduce((sum, row) => sum + row.premium, 0);
  const putPremium = rows.filter((row) => row.side === 'PUT').reduce((sum, row) => sum + row.premium, 0);
  if (callPremium + putPremium <= 0) return { label: 'INFERRED_NOT_TAPE', bias: 'UNAVAILABLE', callPremium, putPremium, confidence: 0, notableStrikes: [], reason: '缺少成交量与 mid/last，不能推断 flow' };
  return { label: 'INFERRED_NOT_TAPE', bias: 'MIXED', callPremium, putPremium, confidence: clamp(3 + Math.min(4, rows.length / 4), 0, 7), notableStrikes: rows.sort((a, b) => b.premium - a.premium).slice(0, 5), reason: '由 volume × mid/last 估算 Call/Put activity premium；不是逐笔成交，缺少连续 OI 变化，不推断买入或卖出' };
}

export function buildDecision(input: TerminalInput, dealer: DealerPressure, iv: IvPremiumView, expectedMove: ExpectedMove, putWall: WallQuality, callWall: WallQuality): TerminalAnalysis['decision'] {
  const regime = dealer.regime;
  const primaryRisk: PrimaryRisk = regime === 'NEGATIVE_GAMMA' && dealer.direction === 'SELL' ? 'DOWNSIDE_ACCELERATION' : regime === 'NEGATIVE_GAMMA' && dealer.direction === 'BUY' ? 'UPSIDE_ACCELERATION' : regime === 'POSITIVE_GAMMA' ? 'MEAN_REVERSION' : regime === 'PINNING' ? 'RANGE_COMPRESSION' : 'UNCERTAIN';
  const keyLevel = primaryRisk === 'DOWNSIDE_ACCELERATION' && valid(input.putWall) ? { type: 'PUT_WALL' as const, value: input.putWall } : primaryRisk === 'UPSIDE_ACCELERATION' && valid(input.callWall) ? { type: 'CALL_WALL' as const, value: input.callWall } : valid(input.gammaFlip) ? { type: 'GAMMA_FLIP' as const, value: input.gammaFlip } : { type: 'NONE' as const, value: null };
  const insufficientHistory = (input.gammaHistory?.length ?? 0) < 3;
  const action = dealer.source === 'UNAVAILABLE' || regime === 'UNAVAILABLE' || iv.environment === 'UNAVAILABLE' ? 'BLOCKED' : iv.environment === 'CHEAP' || primaryRisk === 'DOWNSIDE_ACCELERATION' ? 'WAIT' : insufficientHistory ? 'CONDITIONAL' : regime === 'NEGATIVE_GAMMA' ? 'DEFINED_RISK_ONLY' : 'ELIGIBLE';
  const confidence = clamp((dealer.confidence * .35) + (iv.confidence * .25) + ((putWall.confidence + callWall.confidence) / 2 * .2) + (insufficientHistory ? 5 : 20));
  const dataQuality: TerminalAnalysis['decision']['dataQuality'] = confidence >= 75 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : confidence >= 25 ? 'LOW' : 'PARTIAL';
  const reasons = [
    `Net GEX ${input.netGex >= 0 ? '为正' : '为负'}，Market Regime 为 ${regime}。`,
    valid(input.gammaFlip) ? `现价相对 Gamma Flip ${(input.spot - input.gammaFlip).toFixed(2)}。` : 'Gamma Flip 不可用。',
    `Volatility Edge 为 ${iv.environment}${iv.vrp === null ? '（VRP 不可用）' : `，VRP ${(iv.vrp * 100).toFixed(1)}%`}。`,
    insufficientHistory ? '历史快照少于 3 个，稳定性与趋势仅作低置信度观察。' : null,
  ].filter((value): value is string => value !== null);
  const transition = [
    valid(input.gammaFlip) ? `稳定条件：现价连续两个快照回到 ${input.gammaFlip.toFixed(2)} 附近。` : '稳定条件：补齐 Gamma Flip 数据。',
    valid(input.putWall) ? `下行延续：价格有效跌破 Put Wall ${input.putWall.toFixed(2)}。` : '下行延续：补齐 Put Wall 数据。',
    iv.environment === 'CHEAP' ? '卖方条件改善：VRP 转正并达到配置阈值。' : '卖方条件失效：VRP 转负或 Gamma 结构恶化。',
  ];
  const playbook = action === 'ELIGIBLE' ? ['仅评估已有资格策略；仍需执行层确认。'] : action === 'DEFINED_RISK_ONLY' ? ['只考虑限定风险结构；避免裸卖期权。'] : ['等待结构、VRP 和墙位稳定性确认；不生成具体开仓价位。'];
  return { regime, primaryRisk, premiumEdge: iv.environment, keyLevel, sellerAction: action, confidence, dataQuality, reasons, transition, playbook };
}

export class QqqGexTerminalEngine {
  static analyze(input: TerminalInput): TerminalAnalysis {
    const dealer = calculateDealerPressure(input);
    const expectedMove = calculateExpectedMove(input);
    const iv = calculateIvPremium(input);
    const flipVelocity = calculateFlipVelocity(input.gammaHistory);
    const callWallQuality = calculateWallQuality(input, 'CALL');
    const putWallQuality = calculateWallQuality(input, 'PUT');
    const gammaClock = calculateGammaClock(input);
    const flow = inferOptionsFlow(input);
    const gexScore = dealer.regime === 'POSITIVE_GAMMA' ? 8 : dealer.regime === 'TRANSITION' ? 5 : 3;
    const ivScore = iv.environment === 'RICH' ? 9 : iv.environment === 'FAIR' ? 6 : iv.environment === 'CHEAP' ? 3 : 0;
    const wallQualityScore = Math.max(callWallQuality.score ?? 0, putWallQuality.score ?? 0);
    const total = dealer.source !== 'UNAVAILABLE' && dealer.regime !== 'UNAVAILABLE' && ivScore && wallQualityScore ? Math.round((ivScore + gexScore + wallQualityScore) / 3 * 10) / 10 : null;
    return { asOf: input.asOf, dealer, expectedMove, iv, premiumScore: { total, status: total === null ? 'UNAVAILABLE' : total >= 7 ? 'GOOD_FOR_CREDIT' : 'CAUTION', components: { iv: ivScore, gex: gexScore, wallQuality: wallQualityScore } }, flipVelocity, callWallQuality, putWallQuality, decision: buildDecision(input, dealer, iv, expectedMove, putWallQuality, callWallQuality), gammaClock, flow, analysisOnly: true, modelLabels: ['INFERRED', 'PROXY', 'INFERRED_NOT_TAPE'] };
  }
}
