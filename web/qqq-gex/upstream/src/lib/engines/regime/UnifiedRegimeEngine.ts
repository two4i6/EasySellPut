import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { createDerivedFactor, getFactorValue as getFV } from '../../factor';
import { UnifiedScore } from '../../../types/score';

export type UnifiedRegime = 'BULL' | 'SIDEWAYS_STRONG' | 'SIDEWAYS_WEAK' | 'BEAR' | 'CRISIS';

export type MacroTag =
  | 'BULL_REGIME' | 'BEAR_REGIME' | 'SIDEWAYS_REGIME'
  | 'HIGH_VOL_REGIME'
  | 'NO_SELL_ENV' | 'IDEAL_SELL_ENV';

export interface UnifiedRegimeValue extends UnifiedScore<MacroTag> {
  regime: UnifiedRegime;
  // 内部 sub-signals，供 UI 展示溯源，不参与决策
  signals: {
    aboveMA200: boolean;
    aboveMA30: boolean;
    rsiLevel: 'oversold' | 'neutral' | 'overbought';
    vixLevel: 'low' | 'normal' | 'elevated' | 'extreme';
    maAlignment: 'bullish' | 'mixed' | 'bearish'; // price>ma30>ma200 / 其他 / price<ma30<ma200
  };
}

export class UnifiedRegimeEngine extends FactorEngine {
  public getRegime(factors: FactorMap): FinancialFactor<UnifiedRegimeValue> {
    const vix = getFV<number>(factors, 'vix_price');
    const spxPrice = getFV<number>(factors, 'underlying_price');
    const ma200 = getFV<number>(factors, 'ma200');
    const ma30 = getFV<number>(factors, 'ma30');
    const rsi = getFV<number>(factors, 'rsi');

    const hasAllFactors = 
      vix !== undefined && 
      spxPrice !== undefined && 
      ma200 !== undefined && 
      ma30 !== undefined && 
      rsi !== undefined;

    if (!hasAllFactors) {
      return this.fallback({
        regime: 'SIDEWAYS_WEAK',
        score: 40,
        level: 'MEDIUM',
        flags: { SIDEWAYS_REGIME: true } as Record<MacroTag, boolean>,
        confidence: 0,
        tags: ['SIDEWAYS_REGIME'],
        signals: {
          aboveMA200: false,
          aboveMA30: false,
          rsiLevel: 'neutral',
          vixLevel: 'normal',
          maAlignment: 'mixed'
        }
      }, '缺少必要因子，回退至 SIDEWAYS');
    }

    // 子因子 1: price_vs_ma200_score (0~40)
    const priceMa200Ratio = ma200 > 0 ? (spxPrice - ma200) / ma200 : 0;
    const priceMa200Score = Math.min(40, Math.max(0,
      priceMa200Ratio >= 0.05 ? 40 :
      priceMa200Ratio >= 0    ? 20 + priceMa200Ratio * 400 :
      priceMa200Ratio >= -0.03 ? 20 + priceMa200Ratio * 400 :
      0
    ));
    factors.price_vs_ma200_score = createDerivedFactor(
      priceMa200Score,
      [
        { factorId: 'underlying_price', weight: 0.5 },
        { factorId: 'ma200', weight: 0.5 },
      ],
      factors,
    );

    // 子因子 2: ma_alignment_score (0~35)
    // 5 段式评分：明确区分空头排列 (death cross) 与仅价格跌破 MA200
    const maAlignmentScore =
      (spxPrice > ma30 && ma30 > ma200)   ? 35 : // 多头排列（不变）
      (spxPrice > ma200)                  ? 20 : // 仅价格在 MA200 上方（不变）
      (spxPrice < ma200 && ma30 >= ma200) ? 22 : // 价格跌破 MA200，但 MA30 仍在上（"初跌"，偏弱但未确认）
      (spxPrice < ma200 && rsi >= 35)     ? 12 : // 价格和 MA30 均在 MA200 下方，rsi 尚可（偏弱趋势）
      5;                                         // 完全空头排列 + rsi 极弱
    factors.ma_alignment_score = createDerivedFactor(
      maAlignmentScore,
      [
        { factorId: 'underlying_price', weight: 0.25 },
        { factorId: 'ma30', weight: 0.25 },
        { factorId: 'ma200', weight: 0.25 },
        { factorId: 'rsi', weight: 0.25 },
      ],
      factors,
    );

    // 子因子 3: vix_level_score (0~25)
    const vixLevelScore =
      vix < 15 ? 25 :
      vix < 20 ? 22 :
      vix < 25 ? 16 :
      vix < 30 ? 8  :
      vix < 35 ? 3  : 0;
    factors.vix_level_score = createDerivedFactor(
      vixLevelScore,
      [{ factorId: 'vix_price', weight: 1.0 }],
      factors,
    );

    // 合成 regime_score (0~100)
    const regimeScoreValue = Math.round(priceMa200Score + maAlignmentScore + vixLevelScore);
    factors.regime_score = createDerivedFactor(
      regimeScoreValue,
      [
        { factorId: 'price_vs_ma200_score', weight: 0.40 },
        { factorId: 'ma_alignment_score',   weight: 0.35 },
        { factorId: 'vix_level_score',      weight: 0.25 }
      ],
      factors
    );

    // --- 由 regime_score 派生 regime ---
    // 保留 judge() 的逻辑核心用于 CRISIS 判定（极端情况）
    const crisisOverride = vix! > 40 || (spxPrice! < ma200! * 0.93 && rsi! < 35);

    // BEAR 确认条件：价格偏离 MA200 须 > 2%，或 MA200 已转为下行斜率
    // 防止价格仅轻微跌破 MA200（1-2%）时被误判为强 BEAR
    const ma200Prev = getFV<number>(factors, 'ma200_prev') ?? ma200!;
    const ma200Declining = ma200! < ma200Prev;
    const priceBelowMa200Pct = ma200! > 0 ? (ma200! - spxPrice!) / ma200! * 100 : 0;
    const bearConfirmed = priceBelowMa200Pct > 2.0 || (spxPrice! < ma200! && ma200Declining);

    // 从因子读取中期动量
    const roc10d = getFV<number>(factors, 'price_roc_10d') ?? -1;
    const aboveMA200 = spxPrice! > ma200!;

    let regime: UnifiedRegime;
    if (crisisOverride) {
      regime = 'CRISIS';
    } else if (regimeScoreValue >= 60) {
      regime = 'BULL';
    } else if (regimeScoreValue >= 40) {
      if (aboveMA200 && roc10d >= 0) {
        regime = 'SIDEWAYS_STRONG';
      } else {
        regime = 'SIDEWAYS_WEAK';
      }
    } else if (regimeScoreValue >= 20 && bearConfirmed) {
      regime = 'BEAR';
    } else if (regimeScoreValue >= 20) {
      // 评分处于 BEAR 区间但未满足确认条件（偏离不足且斜率未向下）→ 降级为 SIDEWAYS_WEAK
      regime = 'SIDEWAYS_WEAK';
    } else {
      regime = 'CRISIS';
    }

    const signals: UnifiedRegimeValue['signals'] = {
      aboveMA200: spxPrice! > ma200!,
      aboveMA30: spxPrice! > ma30!,
      rsiLevel: rsi! < 35 ? 'oversold' : rsi! > 65 ? 'overbought' : 'neutral',
      vixLevel: vix! < 15 ? 'low' : vix! < 25 ? 'normal' : vix! < 35 ? 'elevated' : 'extreme',
      maAlignment: (spxPrice! > ma30! && ma30! > ma200!) ? 'bullish' : (spxPrice! < ma30! && ma30! < ma200!) ? 'bearish' : 'mixed'
    };

    const flags: Partial<Record<MacroTag, boolean>> = {};
    const tags: MacroTag[] = [];
    const addTag = (tag: MacroTag) => { flags[tag] = true; tags.push(tag); };

    if (regime === 'BULL') addTag('BULL_REGIME');
    else if (regime === 'BEAR' || regime === 'CRISIS') addTag('BEAR_REGIME');
    else addTag('SIDEWAYS_REGIME');

    if (vix > 25) addTag('HIGH_VOL_REGIME');

    if (flags.BEAR_REGIME && flags.HIGH_VOL_REGIME) {
      addTag('NO_SELL_ENV');
    }
    if (flags.SIDEWAYS_REGIME && vix <= 20) {
      addTag('IDEAL_SELL_ENV');
    }

    let level: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (regimeScoreValue >= 60) level = 'HIGH';
    else if (regimeScoreValue < 40) level = 'LOW';

    const confidence = (
      (factors.vix_price?.confidence        ?? 0) +
      (factors.underlying_price?.confidence ?? 0) +
      (factors.ma200?.confidence            ?? 0) +
      (factors.ma30?.confidence             ?? 0) +
      (factors.rsi?.confidence              ?? 0)
    ) / 5;

    return this.derived(
      { 
        regime, 
        score: regimeScoreValue, 
        level,
        flags: flags as Record<MacroTag, boolean>,
        confidence,
        tags,
        signals 
      },
      [
        { factorId: 'underlying_price', weight: 0.2 },
        { factorId: 'ma200', weight: 0.2 },
        { factorId: 'ma30', weight: 0.2 },
        { factorId: 'vix_price', weight: 0.2 },
        { factorId: 'rsi', weight: 0.2 }
      ],
      factors
    );
  }
}

export const unifiedRegimeEngine = new UnifiedRegimeEngine();
