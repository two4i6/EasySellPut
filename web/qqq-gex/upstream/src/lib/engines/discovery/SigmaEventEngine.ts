import { FactorMap } from '../../../types/factor';

export type FragilityLevel = 'WATCH' | 'WARNING' | 'ALERT' | 'CRITICAL';

export type SigmaTag =
  | 'EXTREME_ZSCORE'      // |z| > 3
  | 'BB_SQUEEZE_ACTIVE'   // 当前处于 BB 挤压状态
  | 'MOMENTUM_EXHAUSTION' // 价格动量 vs RSI 背离
  | 'PARABOLIC_SLOPE'     // 对数斜率加速（双向）
  | 'FAT_TAIL_RISK'       // kurtosis > 4
  | 'IV_SKEW_ELEVATED'    // put skew 高于正常
  | 'GAMMA_UNSTABLE';     // GEX 处于不稳定区

export interface SigmaEventOutput {
  fragility_level: FragilityLevel | null;
  fragility_score: number;    // 0-100
  zscore: number;
  price_percentile: number;   // 0-100
  kurtosis: number;
  sigma_tags: SigmaTag[];
  confidence: number;         // 0-10，反映数据 tier 覆盖度
  regime_adjusted: boolean;   // 是否已做制度调节
  factors: Record<string, any>; // 原始因子透传（供调试）
}

export class SigmaEventEngine {
  public analyze(factors: FactorMap): SigmaEventOutput {
    let fragility_score = 0;
    const sigma_tags: SigmaTag[] = [];
    
    // --- Data Extraction ---
    // Tier 1 (100% confidence contribution)
    const z_score_20 = (factors['z_score_20']?.value as number) ?? 0;
    const bb_squeeze = (factors['bb_squeeze']?.value as boolean) ?? false;
    const rsi_slope = (factors['rsi_slope']?.value as number) ?? 0;
    const hv = (factors['hv_20']?.value as number) ?? 0; // standard indicator

    const price_percentile = (factors['price_percentile_rank']?.value as number) ?? 50;
    const bb_width_rank = (factors['bb_width_rank']?.value as number) ?? 50;
    const log_slope_10 = (factors['log_slope_10']?.value as number) ?? 0;
    const log_slope_acceleration = (factors['log_slope_acceleration']?.value as number) ?? 0;
    const kurtosis_20 = (factors['kurtosis_20']?.value as number) ?? 0;
    
    const roc_20d = (factors['price_roc_20d']?.value as number) ?? 0; // from roc
    const bb_percent_b = (factors['bb_percent_b']?.value as number) ?? 0.5;

    // Tier 2 (70% confidence contribution)
    const iv_skew = factors['iv_skew']?.value as number | undefined;
    const iv_rank = factors['iv_rank']?.value as number | undefined;
    const gamma_unstable = factors['gamma_unstable']?.value as boolean | undefined;

    // Tier 3 (40% confidence contribution)
    const oi_change_pct = factors['oi_change_pct']?.value as number | undefined;
    const vix_9d_ratio = factors['vix_9d_ratio']?.value as number | undefined;

    // Regime Score (optional)
    const regime_score = factors['regime_score']?.value as number | undefined;
    
    // --- Tag Evaluation & Base Score ---
    let leadScore = 0;
    let statScore = 0;
    let momScore = 0;

    // 1. Statistical Deviation (max 100)
    // Z-Score
    let zDeviation = Math.min(Math.abs(z_score_20), 4) / 4 * 100; // cap at z=4
    if (Math.abs(z_score_20) > 3) {
      sigma_tags.push('EXTREME_ZSCORE');
      zDeviation = 100; // force max if > 3
    }
    // Kurtosis
    if (kurtosis_20 > 4) {
      sigma_tags.push('FAT_TAIL_RISK');
    }
    // Percent B and width rank
    let widthScore = (100 - bb_width_rank); // tighter = more dangerous for explosion
    let pbDeviation = Math.abs(bb_percent_b - 0.5) * 200; // (0.5 to 1.0 is +100)
    statScore = (zDeviation * 0.4) + (Math.min(kurtosis_20 * 10, 100) * 0.2) + (widthScore * 0.2) + (Math.min(pbDeviation, 100) * 0.2);

    // 2. Momentum Exhaustion (max 100)
    if (log_slope_10 > 0 && rsi_slope < 0 && roc_20d > 0) {
      sigma_tags.push('MOMENTUM_EXHAUSTION');
      momScore += 60;
    }
    if (Math.abs(log_slope_acceleration) > 0.05) {
      sigma_tags.push('PARABOLIC_SLOPE');
      momScore += 40;
    }

    // 3. Leading Indicators (max 100)
    if (bb_squeeze) {
      sigma_tags.push('BB_SQUEEZE_ACTIVE');
      leadScore += 30;
    }
    if (iv_skew !== undefined && iv_skew > 0.05) {
      sigma_tags.push('IV_SKEW_ELEVATED');
      leadScore += 30;
    }
    if (gamma_unstable) {
      sigma_tags.push('GAMMA_UNSTABLE');
      leadScore += 20;
    }
    if (vix_9d_ratio !== undefined && vix_9d_ratio > 1.0) {
      leadScore += 20;
    }

    // Aggregate Score
    fragility_score = (leadScore * 0.45) + (statScore * 0.35) + (momScore * 0.20);

    // --- Data Confidence Calculation ---
    // Tier 1 is always present (if lengths >= 20)
    let confScore = 1.0; 
    let maxConf = 1.0;

    // Tier 2 check
    maxConf += 0.7;
    if (iv_skew !== undefined || iv_rank !== undefined || gamma_unstable !== undefined) {
      confScore += 0.7;
    }

    // Tier 3 check
    maxConf += 0.4;
    if (oi_change_pct !== undefined || vix_9d_ratio !== undefined) {
      confScore += 0.4;
    }

    const confidence = Math.round((confScore / maxConf) * 10);

    // --- Regime Conditioning ---
    let regime_adjusted = false;
    if (regime_score !== undefined) {
      regime_adjusted = true;
      // In CRISIS (regime_score ~10-20), fragility score gets boosted
      // In BULL (regime_score ~80-100), fragility is dampened slightly
      if (regime_score < 30) {
        fragility_score *= 1.2; // Crisis: higher sensitivity
      } else if (regime_score > 70) {
        fragility_score *= 0.8; // Bull: lower sensitivity
      }
    }

    fragility_score = Math.min(100, Math.max(0, fragility_score));

    // --- Fragility Level ---
    let fragility_level: FragilityLevel | null = null;
    if (fragility_score >= 85) {
      fragility_level = 'CRITICAL';
    } else if (fragility_score >= 70) {
      fragility_level = 'ALERT';
    } else if (fragility_score >= 50) {
      fragility_level = 'WARNING';
    } else if (fragility_score >= 30) {
      fragility_level = 'WATCH';
    }

    return {
      fragility_level,
      fragility_score: Math.round(fragility_score * 100) / 100,
      zscore: Math.round(z_score_20 * 100) / 100,
      price_percentile: Math.round(price_percentile * 100) / 100,
      kurtosis: Math.round(kurtosis_20 * 100) / 100,
      sigma_tags,
      confidence,
      regime_adjusted,
      factors: {
        z_score_20: factors['z_score_20'],
        bb_squeeze: factors['bb_squeeze'],
        rsi_slope: factors['rsi_slope'],
        price_percentile_rank: factors['price_percentile_rank'],
        kurtosis_20: factors['kurtosis_20']
      }
    };
  }
}

export const sigmaEventEngine = new SigmaEventEngine();
