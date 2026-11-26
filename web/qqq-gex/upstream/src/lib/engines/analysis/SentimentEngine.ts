import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { IVCurveValue, OptionContract } from '../../../types/ivCurve';
import { GEXTopology } from '../structure/GEXEngine';
import {
  getFactorValue as getFV,
  isFinancialFactor,
  fallbackFactor,
  createDerivedFactor,
} from '../../factor';

// ─── Public Types ─────────────────────────────────────────────────────────────

export type SentimentTag =
  | 'PCR_EXTREME_FEAR'
  | 'PCR_EXTREME_GREED'
  | 'SKEW_ELEVATED'
  | 'SKEW_INVERTED'
  | 'GEX_UNSTABLE'
  | 'NEAR_MAX_PAIN'
  | 'MAX_PAIN_GRAVITY_DOWN'
  | 'MAX_PAIN_GRAVITY_UP'
  | 'TERM_INVERTED'
  | 'PANIC_OVERRIDE'
  | 'LOW_DATA_QUALITY';

/**
 * 卖方偏见——用于策略层快速判断。
 * AVOID_SELLING 优先级最高，始终覆盖其他偏见。
 */
export type SellerBias =
  | 'PREMIUM_RICH_STABLE'  // 机会高 + 压力低 → 主动寻找裸卖/CSP
  | 'PREMIUM_RICH_RISKY'   // 机会高 + 压力高 → 只做 defined-risk，缩仓
  | 'FAIR'                 // 普通环境
  | 'PREMIUM_CHEAP'        // 权利金不足 → 不适合卖
  | 'AVOID_SELLING';       // 压力过高 → 不适合任何裸卖

export type DataQuality = 'FULL' | 'PARTIAL' | 'MINIMAL';

export interface DirectionalSentiment {
  score: number;    // -100 to +100，负数偏 bearish，正数偏 bullish
  contributors: {
    pcrContrarian: number;   // PCR 反向指标（高 PCR = 潜在看涨）
    skewPressure: number;    // IV skew（正 skew = bearish 期望）
    maxPainGravity: number;  // 价格偏离 Max Pain 方向引力
    termStructure: number;   // VIX 期限结构方向信号
  };
}

export interface SellerOpportunitySentiment {
  score: number;    // 0 to 100
  contributors: {
    premiumRichness: number;   // PCR 驱动的权利金厚度
    skewEdge: number;          // skew 带来的 put 端定价优势
    gexPin: number;            // GEX 结构稳定性（正 GEX 有利卖方）
    maxPainProximity: number;  // 接近 Max Pain = 价格易被 pin
    termEnvironment: number;   // contango = 平静 = 卖方环境
  };
}

export interface MarketStressSentiment {
  score: number;    // 0 to 100
  contributors: {
    pcrPanic: number;         // 极高 PCR 的恐慌信号
    skewStress: number;       // 高 put skew = 尾部风险焦虑
    gexAmplification: number; // 负 GEX + NEAR_FLIP = 波动放大
    termInversion: number;    // VIX 倒挂 = 近期恐慌
    panicPenalty: number;     // PanicTriggerEngine 的额外惩罚
  };
}

export interface SentimentResult {
  directional: FinancialFactor<DirectionalSentiment>;
  sellerOpportunity: FinancialFactor<SellerOpportunitySentiment>;
  marketStress: FinancialFactor<MarketStressSentiment>;
  sellerBias: SellerBias;
  tags: SentimentTag[];
  maxPainLevel: number | null;
  dataQuality: DataQuality;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class SentimentEngine extends FactorEngine {
  public analyze(factors: FactorMap): SentimentResult {
    const tags: SentimentTag[] = [];
    // Zero-confidence sentinels are unknown inputs, not neutral observations.
    const originalFactors = factors;
    factors = Object.fromEntries(Object.entries(factors).filter(([, factor]) => isFinancialFactor(factor) && factor.confidence > 0 && (typeof factor.value !== 'number' || Number.isFinite(factor.value))));


    // ── Extract raw values ──────────────────────────────────────────────────
    const price      = getFV<number>(factors, 'underlying_price') ?? 0;
    const pcr        = getFV<number>(factors, 'pcr') ?? 1.0;
    const ivSkew     = getFV<number>(factors, 'iv_skew') ?? 0;
    const termRatio  = getFV<number>(factors, 'vix_term_ratio') ?? 1.0;
    const ivCurve    = getFV<IVCurveValue>(originalFactors, 'iv_curve');
    const pain = this.computeMaxPain(ivCurve, price);
    if (pain) factors.sentiment_max_pain_oi = { value: pain.level, confidence: pain.partial ? 5 : 9, source: { type: 'raw', api: 'iv_curve.contracts.valid_oi' } };
    const gexTopo    = getFV<GEXTopology>(factors, 'gex_topology');
    const panicLevel = getFV<string>(factors, 'panic_level') ?? 'NONE';

    // ── Data Quality ────────────────────────────────────────────────────────
    const hasChain = pain !== null;
    const hasPCR   = isFinancialFactor(factors['pcr']);
    const hasSkew  = isFinancialFactor(factors['iv_skew']);
    const hasGEX   = isFinancialFactor(factors['gex_topology']);
    const hasTerm  = isFinancialFactor(factors['vix_term_ratio']);

    const qualityScore = [hasPCR, hasSkew, hasGEX, hasTerm, hasChain].filter(Boolean).length;
    let dataQuality: DataQuality;
    if (qualityScore >= 4 && !pain?.partial && !['pcr', 'iv_skew', 'gex_topology'].some(id => factors[id] && factors[id].confidence <= 5)) dataQuality = 'FULL';
    else if (qualityScore >= 2) dataQuality = 'PARTIAL';
    else { dataQuality = 'MINIMAL'; tags.push('LOW_DATA_QUALITY'); }

    // ── Max Pain ────────────────────────────────────────────────────────────
    const maxPainLevel = pain?.level ?? null;
    const maxPainDist  = maxPainLevel && price > 0
      ? (price - maxPainLevel) / maxPainLevel
      : 0;

    if (maxPainLevel) {
      if (Math.abs(maxPainDist) <= 0.02)  tags.push('NEAR_MAX_PAIN');
      else if (maxPainDist >  0.05)        tags.push('MAX_PAIN_GRAVITY_DOWN');
      else if (maxPainDist < -0.05)        tags.push('MAX_PAIN_GRAVITY_UP');
    }

    // ── Signal Tags ─────────────────────────────────────────────────────────
    if (hasPCR && pcr > 2.0)      tags.push('PCR_EXTREME_FEAR');
    if (hasPCR && pcr < 0.5)      tags.push('PCR_EXTREME_GREED');
    if (hasSkew && ivSkew > 0.08)  tags.push('SKEW_ELEVATED');
    if (hasSkew && ivSkew < -0.02) tags.push('SKEW_INVERTED');
    if (gexTopo?.flipPosition === 'NEAR_FLIP') tags.push('GEX_UNSTABLE');
    if (hasTerm && termRatio > 1.0) tags.push('TERM_INVERTED');

    // ════════════════════════════════════════════════════════════════════════
    // DIRECTIONAL SCORE  (-100 → +100)
    // ════════════════════════════════════════════════════════════════════════
    const pcrContrarian  = hasPCR ? this.pcrDirectional(pcr) : 0;
    const skewPressure   = hasSkew ? this.skewDirectional(ivSkew) : 0;
    const maxPainGravity = this.maxPainDirectional(maxPainDist, maxPainLevel);
    const termDir        = hasTerm ? this.termDirectional(termRatio) : 0;

    const directionalScore = clamp(Math.round(
      pcrContrarian  * 0.20 +
      skewPressure   * 0.35 +
      maxPainGravity * 0.30 +
      termDir        * 0.15
    ), -100, 100);

    // ════════════════════════════════════════════════════════════════════════
    // SELLER OPPORTUNITY SCORE  (0 → 100)
    // ════════════════════════════════════════════════════════════════════════
    const premiumRichness   = hasPCR ? this.pcrOpportunity(pcr) : 0;
    const skewEdge          = hasSkew ? this.skewOpportunity(ivSkew) : 0;
    const gexPin            = hasGEX ? this.gexOpportunity(gexTopo) : 0;
    const maxPainProximity  = this.maxPainOpportunity(maxPainDist, maxPainLevel);
    const termEnvironment   = hasTerm ? this.termOpportunity(termRatio) : 0;

    const rawOpportunity = (
      premiumRichness  * 0.30 +
      skewEdge         * 0.15 +
      gexPin           * 0.30 +
      maxPainProximity * 0.15 +
      termEnvironment  * 0.10
    );

    // ════════════════════════════════════════════════════════════════════════
    // MARKET STRESS SCORE  (0 → 100)
    // ════════════════════════════════════════════════════════════════════════
    const pcrPanic         = hasPCR ? this.pcrStress(pcr) : 0;
    const skewStress       = hasSkew ? this.skewStress(ivSkew) : 0;
    const gexAmplification = hasGEX ? this.gexStress(gexTopo) : 0;
    const termInversion    = hasTerm ? this.termStress(termRatio) : 0;

    const rawStress = (
      pcrPanic         * 0.10 +
      skewStress       * 0.20 +
      gexAmplification * 0.35 +
      termInversion    * 0.35
    );

    // Panic: additive penalty, not multiplier ──────────────────────────────
    let panicStress = 0, panicOpCut = 0;
    if (panicLevel === 'WEAK') {
      panicStress = 10; panicOpCut = 5;
    } else if (panicLevel === 'STRONG') {
      panicStress = 25; panicOpCut = 15;
      tags.push('PANIC_OVERRIDE');
    } else if (panicLevel === 'EXTREME') {
      panicStress = 40; panicOpCut = 35;
      tags.push('PANIC_OVERRIDE');
    }

    const marketStressScore    = clamp(Math.round(rawStress + panicStress), 0, 100);
    const sellerOpportunityScore = clamp(Math.round(rawOpportunity - panicOpCut), 0, 100);

    // ── SellerBias ──────────────────────────────────────────────────────────
    const sellerBias = this.deriveSellerBias(sellerOpportunityScore, marketStressScore);

    // ── Confidence ──────────────────────────────────────────────────────────
    const qualityMult = dataQuality === 'FULL' ? 1.0
      : dataQuality === 'PARTIAL' ? 0.85 : 0.60;

    const directionalConf  = this.weightedConf(factors,
      [['pcr', 0.20], ['iv_skew', 0.35], ['sentiment_max_pain_oi', 0.30], ['vix_term_ratio', 0.15]]
    ) * qualityMult;

    const opportunityConf  = this.weightedConf(factors,
      [['pcr', 0.30], ['iv_skew', 0.15], ['gex_topology', 0.30], ['sentiment_max_pain_oi', 0.15], ['vix_term_ratio', 0.10]]
    ) * qualityMult;

    const stressConf = this.weightedConf(factors,
      [['pcr', 0.10], ['iv_skew', 0.20], ['gex_topology', 0.35], ['vix_term_ratio', 0.35]]
    ) * qualityMult;

    // ── Build FinancialFactor via normalized inputs ──────────────────────────
    const directionalFactor = this.buildFactor<DirectionalSentiment>(
      {
        score: directionalScore,
        contributors: { pcrContrarian, skewPressure, maxPainGravity, termStructure: termDir },
      },
      directionalConf,
      factors,
      [['pcr', 0.20], ['iv_skew', 0.35], ['sentiment_max_pain_oi', 0.30], ['vix_term_ratio', 0.15]],
      `方向情绪: ${scoreLabel(directionalScore, [-20, 20])} (${directionalScore})`,
    );

    const opportunityFactor = this.buildFactor<SellerOpportunitySentiment>(
      {
        score: sellerOpportunityScore,
        contributors: { premiumRichness, skewEdge, gexPin, maxPainProximity, termEnvironment },
      },
      opportunityConf,
      factors,
      [['pcr', 0.30], ['iv_skew', 0.15], ['gex_topology', 0.30], ['sentiment_max_pain_oi', 0.15], ['vix_term_ratio', 0.10]],
      `卖方机会: ${sellerOpportunityScore >= 65 ? '丰厚' : sellerOpportunityScore >= 35 ? '一般' : '不足'} (${sellerOpportunityScore})`,
    );

    const stressFactor = this.buildFactor<MarketStressSentiment>(
      {
        score: marketStressScore,
        contributors: { pcrPanic, skewStress, gexAmplification, termInversion, panicPenalty: panicStress },
      },
      stressConf,
      factors,
      [['pcr', 0.10], ['iv_skew', 0.20], ['gex_topology', 0.35], ['vix_term_ratio', 0.35]],
      `市场压力: ${marketStressScore >= 70 ? '高' : marketStressScore >= 40 ? '中' : '低'} (${marketStressScore})`,
    );

    return {
      directional:       directionalFactor,
      sellerOpportunity: opportunityFactor,
      marketStress:      stressFactor,
      sellerBias,
      tags,
      maxPainLevel,
      dataQuality,
    };
  }

  // ─── Max Pain ─────────────────────────────────────────────────────────────

  /**
   * 正确公式：
   *   callPayout = Σ callOI × max(testPrice − callStrike, 0) × 100
   *   putPayout  = Σ putOI  × max(putStrike  − testPrice,  0) × 100
   *   maxPain    = argmin(callPayout + putPayout)
   *
   * 只使用最近 ≤35 DTE 且有完整 contracts 的到期日（最多 2 个）。
   */
  private computeMaxPain(ivCurve: IVCurveValue | undefined, price: number): {level:number;partial:boolean} | null {
    if (!ivCurve?.points || price <= 0) return null;

    const validPoints = ivCurve.points
      .filter(p => p.daysToExpiration <= 35 && p.contracts)
      .sort((a, b) => a.daysToExpiration - b.daysToExpiration)
      .slice(0, 2);

    if (validPoints.length === 0) return null;

    const contracts = validPoints.flatMap(point => [...point.contracts!.calls, ...point.contracts!.puts]);
    const validOi = (contract: OptionContract) => Number.isFinite(contract.strike) && contract.strike > 0 && Number.isFinite(contract.openInterest) && contract.openInterest! >= 0;
    const partial = contracts.some(contract => !validOi(contract));
    const allCalls: OptionContract[] = [];
    const allPuts:  OptionContract[] = [];
    for (const p of validPoints) {
      if (p.contracts) {
        allCalls.push(...p.contracts.calls.filter(c => validOi(c) && c.openInterest! > 0));
        allPuts.push( ...p.contracts.puts.filter(c => validOi(c) && c.openInterest! > 0));
      }
    }

    const totalOI = allCalls.reduce((s, c) => s + (c.openInterest ?? 0), 0)
                  + allPuts.reduce( (s, c) => s + (c.openInterest ?? 0), 0);
    if (totalOI < 500 || !allCalls.length || !allPuts.length) return null;

    const strikes = new Set<number>();
    allCalls.forEach(c => strikes.add(c.strike));
    allPuts.forEach( c => strikes.add(c.strike));

    let minPayout = Infinity;
    let maxPain: number | null = null;

    for (const testPrice of strikes) {
      const callPayout = allCalls.reduce(
        (s, c) => s + (c.openInterest ?? 0) * Math.max(testPrice - c.strike, 0) * 100, 0);
      const putPayout  = allPuts.reduce(
        (s, c) => s + (c.openInterest ?? 0) * Math.max(c.strike - testPrice,  0) * 100, 0);
      const total = callPayout + putPayout;
      if (total < minPayout) { minPayout = total; maxPain = testPrice; }
    }

    return maxPain === null ? null : {level:maxPain,partial};
  }

  // ─── Directional Scoring ──────────────────────────────────────────────────

  // 反向指标：高 PCR = 市场恐惧 = 潜在底部 = slight bullish
  private pcrDirectional(pcr: number): number {
    if (pcr > 2.0) return  40;
    if (pcr > 1.5) return  25;
    if (pcr > 1.0) return  10;
    if (pcr > 0.7) return   0;
    if (pcr > 0.5) return -15;
    return -30;
  }

  // 正 skew = puts 更贵 = 市场预期下行 = bearish
  private skewDirectional(skew: number): number {
    if (skew > 0.15) return -70;
    if (skew > 0.10) return -45;
    if (skew > 0.05) return -20;
    if (skew > 0.00) return   0;
    return 20; // inverted = calls expensive = bullish sentiment
  }

  // 价格偏离 Max Pain 提供引力方向
  private maxPainDirectional(dist: number, maxPain: number | null): number {
    if (!maxPain) return 0;
    if (dist >  0.08) return -40;
    if (dist >  0.04) return -20;
    if (dist >  0.02) return -10;
    if (dist > -0.02) return   0;
    if (dist > -0.05) return  15;
    if (dist > -0.08) return  25;
    return 35;
  }

  // backwardation = 短端恐慌 = slight bearish
  private termDirectional(ratio: number): number {
    if (ratio > 1.20) return -40;
    if (ratio > 1.00) return -20;
    if (ratio > 0.85) return   0;
    return 15; // deep contango = fear subsided
  }

  // ─── Seller Opportunity Scoring ───────────────────────────────────────────

  // 高 PCR = put buyers 多 = put 权利金丰厚
  private pcrOpportunity(pcr: number): number {
    if (pcr > 2.0) return 90;
    if (pcr > 1.5) return 75;
    if (pcr > 1.0) return 58;
    if (pcr > 0.7) return 42;
    if (pcr > 0.5) return 25;
    return 15;
  }

  // 适度正 skew = put 端有溢价优势；极高 skew = 危险地带，机会降低
  private skewOpportunity(skew: number): number {
    if (skew > 0.12) return 50; // 极高 skew，市场非常恐惧，裸卖风险上升
    if (skew > 0.07) return 72; // 最优区间：put 端溢价高但未失控
    if (skew > 0.03) return 60;
    if (skew > 0.00) return 45;
    return 30; // inverted skew，put 端溢价不足
  }

  // 正 GEX = 做市商 long gamma = 价格被 pin = 卖方有利
  private gexOpportunity(topo: GEXTopology | undefined): number {
    if (!topo) return 40; // neutral fallback
    let score = topo.netGamma === 'POSITIVE' ? 65 : 25;
    if (topo.structure === 'HEAVY_BOTTOM') score += 15;
    if (topo.structure === 'CLUSTERED')    score += 10;
    if (topo.structure === 'HEAVY_TOP')    score +=  5;
    if (topo.flipPosition === 'NEAR_FLIP') score  = Math.floor(score * 0.5); // 不稳定
    return clamp(score, 0, 100);
  }

  // 接近 Max Pain = 价格易被 pin = theta 衰减高效区
  private maxPainOpportunity(dist: number, maxPain: number | null): number {
    if (!maxPain) return 50; // 无数据时中性
    const absDist = Math.abs(dist);
    if (absDist <= 0.02) return 80;
    if (absDist <= 0.05) return 60;
    if (absDist <= 0.08) return 45;
    return 35;
  }

  // deep contango = 平静环境 = 卖方友好
  private termOpportunity(ratio: number): number {
    if (ratio > 1.10) return 50;
    if (ratio > 1.00) return 55;
    if (ratio > 0.85) return 65;
    return 75; // deep contango
  }

  // ─── Market Stress Scoring ────────────────────────────────────────────────

  // 极高 PCR = 恐慌买入 = stress
  private pcrStress(pcr: number): number {
    if (pcr > 2.0) return 60;
    if (pcr > 1.5) return 35;
    if (pcr > 1.0) return 15;
    if (pcr > 0.7) return  5;
    return 0;
  }

  // 高 put skew = 尾部风险焦虑
  private skewStress(skew: number): number {
    if (skew > 0.15) return 75;
    if (skew > 0.10) return 55;
    if (skew > 0.08) return 40;
    if (skew > 0.05) return 25;
    if (skew > 0.00) return 10;
    return 15; // inverted skew 也是异常
  }

  // 负 GEX = 波动放大；NEAR_FLIP = 结构不稳
  private gexStress(topo: GEXTopology | undefined): number {
    if (!topo) return 25; // conservative fallback
    let score = topo.netGamma === 'NEGATIVE' ? 45 : 10;
    if (topo.flipPosition === 'NEAR_FLIP') score += 20;
    if (topo.crowding === 'HIGH')          score += 10;
    if (topo.crowding === 'MEDIUM')        score +=  5;
    return clamp(score, 0, 100);
  }

  // VIX 倒挂 = 近端恐慌压力
  private termStress(ratio: number): number {
    if (ratio > 1.20) return 70;
    if (ratio > 1.10) return 50;
    if (ratio > 1.00) return 30;
    if (ratio > 0.85) return 10;
    return 0;
  }

  // ─── SellerBias Derivation ────────────────────────────────────────────────

  private deriveSellerBias(opportunity: number, stress: number): SellerBias {
    if (stress > 70)                          return 'AVOID_SELLING';
    if (opportunity >= 65 && stress <= 35)    return 'PREMIUM_RICH_STABLE';
    if (opportunity >= 65)                    return 'PREMIUM_RICH_RISKY';
    if (opportunity < 35)                     return 'PREMIUM_CHEAP';
    return 'FAIR';
  }

  // ─── Confidence Helpers ───────────────────────────────────────────────────

  /**
   * 加权平均置信度：只统计 FactorMap 中实际存在的因子，
   * 缺失因子对置信度无贡献（降低总权重分母）。
   * min → × 0.9 衰减，与 calcConfidence 一致。
   */
  private weightedConf(
    factors: FactorMap,
    entries: [string, number][],
  ): number {
    const available = entries.filter(([id]) => isFinancialFactor(factors[id]));
    if (available.length === 0) return 0;
    const min = Math.min(...available.map(([id]) => factors[id].confidence));
    if (min === 0) return 0;
    return min * 0.9;
  }

  /**
   * 构造 FinancialFactor，使用归一化后的 inputs（剔除 FactorMap 中缺失的）。
   * 如果所有依赖都缺失，退化为 fallback。
   */
  private buildFactor<T>(
    value: T,
    confidence: number,
    factors: FactorMap,
    rawInputs: [string, number][],
    logicReason: string,
  ): FinancialFactor<T> {
    const available = rawInputs.filter(([id]) => isFinancialFactor(factors[id]));
    if (available.length === 0) {
      return { ...fallbackFactor(value, '缺少所有依赖因子'), logicReason };
    }
    const totalW = available.reduce((s, [, w]) => s + w, 0);
    const inputs = available.map(([factorId, w]) => ({
      factorId,
      weight: w / totalW,
    }));
    const factor = createDerivedFactor(value, inputs, factors);
    // 用我们自己计算的置信度（带数据质量衰减），而不是 createDerivedFactor 的 min×0.9
    factor.confidence = Math.max(0, Math.min(10, confidence));
    factor.logicReason = logicReason;
    return factor;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreLabel(score: number, [lo, hi]: [number, number]): string {
  if (score > hi)  return '偏多';
  if (score < lo)  return '偏空';
  return '中性';
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const sentimentEngine = new SentimentEngine();
export default SentimentEngine;
