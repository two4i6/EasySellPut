import { createDerivedFactor, fallbackFactor, getFactorValue } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import type { SellerOpportunityLifecyclePoint } from '@/types/sellerOpportunity';
import { bucketFor, type SellerStats } from './SellerStatsEngine';
import { computeIntradayBonus, type IntradayBonusValue } from './IntradayBonusEngine';
import type { IntradayBar } from '@/lib/engines/intraday-ladder/types';

export type SellerEdgeTier = 'OBSERVE' | 'WATCH' | 'PRIME' | 'EXTREME';
export type SellerEdgeTriggerTag = 'PUT_SKEW_EXTREME' | 'IV_PREMIUM_RICH' | 'SIGMA_SHOCK' | 'SWEET_SPOT_37D' | 'WALL_SUPPORT' | 'EARNINGS_NEAR';
export type ScoreReason = { key: string; labelZh: string; points: number; detail: string };

export type SellerEdgeStructure = {
  gexAnchors: { gammaFlipPctFromSpot: number | null; callWallPctFromSpot: number | null; putWallPctFromSpot: number | null };
  termStructure: Array<{ expiry: string; dte: number; atmIV: number }>;
  slope: number;
  vrp: { atmIV: number; hv20: number; ratio: number };
  putSkewByExpiry: Array<{ expiry: string; skewVolPts: number }>;
  earnings: { date: string | null; daysUntil: number | null };
  flowPutBiased: boolean;
  skew3yP90?: number;
  /** QQQ only: VXN 可用时为 raw/10，否则为 HV 日线代理。 */
  volSource?: 'VXN' | 'HV_PROXY';
};

export type SellerEdgeScore = {
  score: number; tier: SellerEdgeTier; tierLabelZh: string; triggerTags: SellerEdgeTriggerTag[];
  eventScore: number; premiumScore: number;
  reasons: ScoreReason[]; topReasons: ScoreReason[];
  eventFactor: FinancialFactor<number>; premiumFactor: FinancialFactor<number>; factor: FinancialFactor<number>;
  /** 日内层加分（实验性）；始终计算，是否计入 score/factor 由 intradayEnabled 决定。默认不计入。 */
  intradayBonus: FinancialFactor<IntradayBonusValue>;
};

export const sellerEdgeTierFor = (score: number): [SellerEdgeTier, string] => score >= 160 ? ['EXTREME', '极端机会'] : score >= 120 ? ['PRIME', '高概率观察区'] : score >= 80 ? ['WATCH', '重点关注'] : ['OBSERVE', '常规观察'];
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
/** 线性 ramp：x≤x0→0，x≥x1→max，中间线性插值。悬崖阈值的替代。 */
const ramp = (x: number, x0: number, x1: number, max: number) => clamp((x - x0) / (x1 - x0) * max, max);

const EVENT_DEPENDENCIES = [
  'seller_downside_z_1d', 'seller_downside_z_3d', 'seller_downside_z_5d',
  'seller_intraday_position', 'seller_distance_from_37d_high', 'seller_sweet_spot_active',
  'seller_stat_manage_recover_5d', 'seller_stat_manage_repair_success_15d',
  'seller_stat_manage_continue_drop_5d', 'seller_stat_manage_worst_5d_drop',
] as const;

export const sellerPutNoBreachFactorId = (bucket: string) => `seller_stat_put_no_breach_${bucket.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`;

function derivedOrFallback(value: number, ids: readonly string[], factors: FactorMap, reason: string) {
  if (ids.some(id => !factors[id] || factors[id].confidence === 0)) return fallbackFactor(value, reason);
  return createDerivedFactor(value, ids.map(factorId => ({ factorId, weight: 1 / ids.length })), factors);
}

/**
 * 生产评分入口：只读扁平 FactorMap；结构/GEX/流量不进入分数。
 * 例外（2026-07 用户已裁决、范围受限）：todayLifecycle 非空且 intradayEnabled=true 时，
 * 今日轮询快照路径 + 真分钟线衍生的小额日内加分（0-21，见 IntradayBonusEngine）会叠加进 score。默认关闭，零回归。
 */
export function computeSellerEdgeFactors(
  factors: FactorMap,
  todayLifecycle: SellerOpportunityLifecyclePoint[] = [],
  intradayEnabled: boolean = false,
  intradayBars?: IntradayBar[],
  /** todayLifecycle 是否确实来自当前交易日；周末/非交易时段用 route.ts 回看的上一交易日数据时传 false。 */
  isLiveSession: boolean = true,
): SellerEdgeScore {
  const ivRank = getFactorValue<number>(factors, 'iv_rank') ?? 0;
  const ivrPoints = clamp(ivRank, 100) * 0.25;
  const ratio = getFactorValue<number>(factors, 'vol_premium') ?? 0;
  let vrpPoints = 0;
  if (ratio >= 2) vrpPoints = 25;
  else if (ratio > 1.5) vrpPoints = 18 + (ratio - 1.5) * 14;
  else if (ratio > 1) vrpPoints = (ratio - 1) * 36;
  const premiumScore = Math.round(clamp(ivrPoints + vrpPoints, 50) * 2);

  const z = Math.max(
    getFactorValue<number>(factors, 'seller_downside_z_1d') ?? 0,
    getFactorValue<number>(factors, 'seller_downside_z_3d') ?? 0,
    getFactorValue<number>(factors, 'seller_downside_z_5d') ?? 0,
  );
  const sigmaPoints = z >= 2.5 ? 25 : z >= 2 ? 20 : z >= 1.5 ? 14 : z >= 1 ? 8 : z >= 0.75 ? 4 : 0;
  const intradayPosition = getFactorValue<number>(factors, 'seller_intraday_position') ?? 0.5;
  const intradayPoints = ramp(0.5 - intradayPosition, 0, 0.45, 10);
  const sweetSpotPoints = getFactorValue<boolean>(factors, 'seller_sweet_spot_active') === true ? 10 : 0;
  const entrySigma = sigmaPoints + intradayPoints + sweetSpotPoints;
  const putBucket = bucketFor(z);
  const putFactorId = putBucket ? sellerPutNoBreachFactorId(putBucket) : null;
  const putRate = putFactorId ? getFactorValue<number>(factors, putFactorId) : undefined;
  const putPoints = putRate == null ? 0 : ramp(putRate * 100, 80, 95, 25);
  const recover = (getFactorValue<number>(factors, 'seller_stat_manage_recover_5d') ?? 0) * 100;
  const repair = (getFactorValue<number>(factors, 'seller_stat_manage_repair_success_15d') ?? 0) * 100;
  const continueDrop = (getFactorValue<number>(factors, 'seller_stat_manage_continue_drop_5d') ?? 1) * 100;
  const worstDrop = Math.abs((getFactorValue<number>(factors, 'seller_stat_manage_worst_5d_drop') ?? -.2) * 100);
  const manageability = ramp(recover, 40, 70, 10) + ramp(repair, 50, 85, 10)
    + (5 - ramp(continueDrop, 20, 50, 5)) + (5 - ramp(worstDrop, 3, 10, 5));
  const eventScore = Math.round(clamp(entrySigma + putPoints + manageability, 100));
  const intradayBonus = computeIntradayBonus(factors, todayLifecycle, intradayBars, isLiveSession);
  const score = eventScore + premiumScore + (intradayEnabled ? Math.round(intradayBonus.value.bonus) : 0);
  const reasons: ScoreReason[] = [
    { key: 'ivRichness', labelZh: '波动率溢价', points: premiumScore, detail: `IVR ${ivRank.toFixed(0)}，VRP ${ratio.toFixed(2)}` },
    { key: 'entrySigma', labelZh: '入场偏离', points: entrySigma, detail: `多周期负向 z ${z.toFixed(2)}，日内位置 ${(intradayPosition * 100).toFixed(0)}%` },
    ...(putRate == null ? [] : [{ key: 'winRateEdge', labelZh: '当前 PUT 桶不击穿', points: putPoints, detail: `${(putRate * 100).toFixed(0)}%` }]),
    { key: 'manageability', labelZh: '可管理性', points: manageability, detail: `5日修复 ${recover.toFixed(0)}%，修复成功 ${repair.toFixed(0)}%` },
  ].sort((a, b) => b.points - a.points);
  const [tier, tierLabelZh] = sellerEdgeTierFor(score);
  const triggerTags: SellerEdgeTriggerTag[] = [
    ...(premiumScore >= 70 ? ['IV_PREMIUM_RICH' as const] : []),
    ...(entrySigma >= 31.5 ? ['SIGMA_SHOCK' as const] : []), ...(sweetSpotPoints > 0 && entrySigma >= 31.5 ? ['SWEET_SPOT_37D' as const] : []),
  ];
  const eventIds = [...EVENT_DEPENDENCIES, ...(putFactorId ? [putFactorId] : [])];
  const eventFactor = derivedOrFallback(eventScore, eventIds, factors, putFactorId ? '卖方事件统计依赖缺失' : '当前无有效 PUT σ 桶');
  const premiumFactor = derivedOrFallback(premiumScore, ['iv_rank', 'vol_premium'], factors, 'IV/波动率溢价依赖缺失');
  const scoreFactors = { ...factors, seller_event_score: eventFactor, seller_premium_score: premiumFactor };
  const factor = derivedOrFallback(score, ['seller_event_score', 'seller_premium_score'], scoreFactors, '事件分或溢价分不可用');
  return { score, eventScore, premiumScore, tier, tierLabelZh, triggerTags, reasons, topReasons: reasons.slice(0, 3), eventFactor, premiumFactor, factor, intradayBonus };
}

/** 旧统计对象适配器；生产调用方应先把 SellerStats 展平进 FactorMap。 */
export function computeSellerEdgeScore(factors: FactorMap, stats: SellerStats, structure: SellerEdgeStructure): SellerEdgeScore {
  const z = Math.max(stats.downsideShock.oneDay, stats.downsideShock.threeDay, stats.downsideShock.fiveDay);
  const bucket = bucketFor(z);
  const current = bucket ? stats.sellPutNoBreach.find(item => item.bucket === bucket) : undefined;
  const adapted: FactorMap = {
    ...factors,
    seller_downside_z_1d: factors.seller_downside_z_1d ?? fallbackFactor(stats.downsideShock.oneDay, '旧 SellerStats 适配'),
    seller_downside_z_3d: factors.seller_downside_z_3d ?? fallbackFactor(stats.downsideShock.threeDay, '旧 SellerStats 适配'),
    seller_downside_z_5d: factors.seller_downside_z_5d ?? fallbackFactor(stats.downsideShock.fiveDay, '旧 SellerStats 适配'),
    seller_distance_from_37d_high: factors.seller_distance_from_37d_high ?? fallbackFactor(stats.distanceFromHigh.distPct37d, '旧 SellerStats 适配'),
    seller_sweet_spot_active: factors.seller_sweet_spot_active ?? fallbackFactor(!!stats.swingSweetSpot.band && stats.swingSweetSpot.currentDistPct >= stats.swingSweetSpot.band[0] && stats.swingSweetSpot.currentDistPct <= stats.swingSweetSpot.band[1] && (stats.swingSweetSpot.bounceProb10d.value ?? 0) >= .6, '旧 SellerStats 适配'),
    seller_stat_manage_recover_5d: factors.seller_stat_manage_recover_5d ?? fallbackFactor(stats.manageability.recover5d.value ?? 0, '旧 SellerStats 适配'),
    seller_stat_manage_repair_success_15d: factors.seller_stat_manage_repair_success_15d ?? fallbackFactor(stats.manageability.repairSuccess.value ?? 0, '旧 SellerStats 适配'),
    seller_stat_manage_continue_drop_5d: factors.seller_stat_manage_continue_drop_5d ?? fallbackFactor(stats.manageability.continueDrop5d.value ?? 1, '旧 SellerStats 适配'),
    seller_stat_manage_worst_5d_drop: factors.seller_stat_manage_worst_5d_drop ?? fallbackFactor(stats.manageability.worstCase5dDropPct.value ?? -.2, '旧 SellerStats 适配'),
    ...(bucket && current?.value != null ? { [sellerPutNoBreachFactorId(bucket)]: factors[sellerPutNoBreachFactorId(bucket)] ?? fallbackFactor(current.value, '旧 SellerStats 适配') } : {}),
  };
  return computeSellerEdgeFactors(adapted);
}
