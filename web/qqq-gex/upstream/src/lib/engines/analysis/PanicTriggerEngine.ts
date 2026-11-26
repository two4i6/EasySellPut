import { FactorEngine } from '../../FactorEngine';
import { FactorMap } from '../../../types/factor';
import { OHLCVBar, IVDataPoint, computeIndicators, toFactorMap } from '../../indicators';
import { UnifiedRegime } from '../regime/UnifiedRegimeEngine';
import { getFactorValue as getFV } from '../../factor';

export interface PanicTriggerInput {
  bars: OHLCVBar[];
  ivData: IVDataPoint[];
  marketRegime: UnifiedRegime;
}

/**
 * PanicTriggerEngine
 * 
 * Classifies panic conditions for short-volatility strategies based on 
 * price action, volume, and implied volatility percentile.
 */
export class PanicTriggerEngine extends FactorEngine {
  /**
   * Evaluate panic trigger and return a FactorMap
   */
  public evaluate(input: PanicTriggerInput): FactorMap {
    const { bars, ivData, marketRegime } = input;
    
    // Minimum data requirement: 20 days for Volume MA
    if (!bars || bars.length < 20) {
      return this.generateEmptyMap('Insufficient historical data (min 20 bars)');
    }

    const indicatorResult = computeIndicators(bars, ivData);
    const factors = toFactorMap(indicatorResult);

    // --- 1. Variable Preparation ---
    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2]; // length >= 20 保证存在
    const prevPrevBar = bars[bars.length - 3] || prevBar;
    const barMinus3 = bars[bars.length - 4] || bars[0];

    const ivPercentile = getFV<number>(factors, 'iv_percentile') ?? 0;
    const currentIv = getFV<number>(factors, 'iv') ?? 0;
    const prevIv = indicatorResult.iv.length >= 2 ? indicatorResult.iv[indicatorResult.iv.length - 2].value : currentIv;
    const ivChange1d = currentIv - (prevIv ?? currentIv);

    const priceChange1d = prevBar.close > 0 ? (lastBar.close / prevBar.close) - 1 : 0;
    const priceChange3d = barMinus3.close > 0 ? (lastBar.close / barMinus3.close) - 1 : 0;
    const prevPriceChange1d = prevPrevBar.close > 0 ? (prevBar.close / prevPrevBar.close) - 1 : 0;

    const volumeMA20 = getFV<number>(factors, 'volume_ma_20') ?? 0;
    const volumeRatio = volumeMA20 > 0 ? lastBar.volume / volumeMA20 : 0;

    const sellingPressureDecreasing = priceChange1d > prevPriceChange1d;
    const todayLow = lastBar.low;
    const yesterdayLow = prevBar.low;

    // --- 2. Step 1: Market Filter ---
    const allowedTrading = marketRegime === 'BULL' || marketRegime === 'SIDEWAYS_STRONG';

    // --- 3. Step 2: Exhaustion ---
    const isExhaustion = ivChange1d <= 0 || sellingPressureDecreasing;

    // --- 4. Step 3: Exhaustion Confirmation ---
    const exhaustionConfirmed = isExhaustion && todayLow >= yesterdayLow;

    // --- 5. Step 4: Panic Level Classification ---
    let panicLevel: 'NONE' | 'WEAK' | 'STRONG' | 'EXTREME' = 'NONE';
    
    if (ivPercentile >= 90 && priceChange3d <= -0.08 && volumeRatio >= 2.0 && exhaustionConfirmed) {
      panicLevel = 'EXTREME';
    } else if (ivPercentile >= 80 && (priceChange1d <= -0.02 || priceChange3d <= -0.05) && volumeRatio >= 1.5 && exhaustionConfirmed) {
      panicLevel = 'STRONG';
    } else if (ivPercentile >= 70 && priceChange1d <= -0.015 && volumeRatio >= 1.2) {
      panicLevel = 'WEAK';
    } else {
      panicLevel = 'NONE';
    }

    // --- 6. Step 5: Final Trigger ---
    // Panic trigger reflects signal strength only; regime filtering is handled by the caller
    const triggerValue = panicLevel === 'STRONG' || panicLevel === 'EXTREME';

    // --- 8. Confidence Scoring (0 - 1) ---
    let confidenceBase = 0.5;
    if (ivPercentile >= 90) confidenceBase += 0.2;
    if (volumeRatio >= 2.0) confidenceBase += 0.1;
    if (priceChange3d <= -0.08) confidenceBase += 0.1;

    if (marketRegime === 'SIDEWAYS_WEAK') confidenceBase -= 0.2;
    if (marketRegime === 'BEAR' || marketRegime === 'CRISIS') confidenceBase -= 0.3;

    const confidence = Math.max(0, Math.min(1, confidenceBase));

    // --- 8. Step 7: Build final FactorMap ---
    const result: FactorMap = {
      ...factors,
    };

    result.market_regime = {
      value: marketRegime,
      confidence: 10,
      source: { type: 'raw', api: 'UnifiedRegimeEngine' }
    };

    result.allowed_trading = this.derived(
      allowedTrading,
      [{ factorId: 'market_regime', weight: 1.0 }],
      result,
      `Regime: ${marketRegime}`
    );

    result.panic_state = this.derived(
      panicLevel !== 'NONE',
      [
        { factorId: 'iv_percentile', weight: 0.4 },
        { factorId: 'volume_ma_20', weight: 0.3 },
        { factorId: 'roc_5d', weight: 0.3 }
      ],
      result,
      `Level=${panicLevel}, IVP=${ivPercentile.toFixed(0)}, Δ1d=${(priceChange1d * 100).toFixed(1)}%, VolRatio=${volumeRatio.toFixed(2)}`
    );

    result.exhaustion_state = this.derived(
      isExhaustion,
      [
        { factorId: 'iv', weight: 0.5 },
        { factorId: 'ma_7', weight: 0.5 }
      ],
      result,
      `ΔIV=${(ivChange1d * 100).toFixed(2)}%, SellPressDecr=${sellingPressureDecreasing}`
    );

    result.exhaustion_confirmed = this.derived(
      exhaustionConfirmed,
      [{ factorId: 'exhaustion_state', weight: 1.0 }],
      result,
      `Exh=${isExhaustion}, LowConf=${todayLow >= yesterdayLow}`
    );

    result.panic_level = this.derived(
      panicLevel,
      [{ factorId: 'panic_state', weight: 0.5 }, { factorId: 'exhaustion_confirmed', weight: 0.5 }],
      result,
      `Classification: ${panicLevel}`
    );

    result.panic_trigger = this.derived(
      triggerValue,
      [{ factorId: 'panic_level', weight: 1.0 }],
      result,
      `Level: ${panicLevel}`
    );

    // Set confidence (mapped 0-1 to 0-10)
    result.panic_trigger.confidence = confidence * 10;

    return result;
  }

  public generateEmptyMap(reason: string = 'initial'): FactorMap {
    return {
      panic_state: this.fallback(false, reason),
      exhaustion_state: this.fallback(false, reason),
      exhaustion_confirmed: this.fallback(false, reason),
      panic_trigger: this.fallback(false, reason),
      allowed_trading: this.fallback(false, reason),
      panic_level: this.fallback('NONE', reason)
    };
  }
}

export const panicTriggerEngine = new PanicTriggerEngine();
export default PanicTriggerEngine;
