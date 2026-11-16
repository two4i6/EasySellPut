import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { UnifiedScore } from '../../../types/score';
import { getFactorValue as getFV, isFinancialFactor, fallbackFactor } from '../../factor';


export interface IVOpportunity {
  level: 'RICH' | 'FAIR' | 'CHEAP';
  score: number;                     // 0–100
  confidence: number;                // 0–10
  vol_premium: FinancialFactor<number>;
  iv_rank: FinancialFactor<number>;
  vix_term_ratio: FinancialFactor<number>;
  term_structure: 'normal' | 'inverted' | 'flat';
  triggers: string[];                // IV_CHEAP, TERM_INVERTED, IV_EXPANSION
}

export class IVSuitabilityEngine extends FactorEngine {
  public analyze(factors: FactorMap): IVOpportunity {
    const vol_premium = isFinancialFactor(factors.vol_premium) ? factors.vol_premium as FinancialFactor<number> : fallbackFactor(1.0, 'missing');
    const iv_rank = isFinancialFactor(factors.iv_rank) ? factors.iv_rank as FinancialFactor<number> : fallbackFactor(50, 'missing');
    const vix_term_ratio = isFinancialFactor(factors.vix_term_ratio) ? factors.vix_term_ratio as FinancialFactor<number> : fallbackFactor(1.0, 'missing');

    const triggers: string[] = [];
    
    // vol_premium scoring (0-100)
    let vpScore = 0;
    if (vol_premium.value > 1.25) vpScore = 80 + (vol_premium.value - 1.25) * 40;
    else if (vol_premium.value >= 1.0) vpScore = 40 + (vol_premium.value - 1.0) * 160;
    else vpScore = Math.max(0, vol_premium.value * 40);
    vpScore = Math.min(100, vpScore);

    if (vol_premium.value < 0.9) triggers.push('IV_CHEAP');

    // iv_rank scoring
    let irScore = Math.min(100, Math.max(0, iv_rank.value));
    if (iv_rank.value < 20) triggers.push('IV_RANK_LOW');

    // term structure
    let term_structure: 'normal' | 'inverted' | 'flat' = 'normal';
    if (vix_term_ratio.value > 1.0) {
      term_structure = 'inverted';
      triggers.push('TERM_INVERTED');
    } else if (vix_term_ratio.value > 0.95) {
      term_structure = 'flat';
    }

    // Combined score
    const score = Math.round(vpScore * 0.6 + irScore * 0.4);

    // level determination
    let level: IVOpportunity['level'] = 'FAIR';
    if (score >= 70) level = 'RICH';
    else if (score <= 30) level = 'CHEAP';

    // confidence calculation
    const confidence = (vol_premium.confidence + iv_rank.confidence + vix_term_ratio.confidence) / 3;

    return {
      level,
      score,
      confidence,
      vol_premium,
      iv_rank,
      vix_term_ratio,
      term_structure,
      triggers
    };
  }
}

export const ivSuitabilityEngine = new IVSuitabilityEngine();
