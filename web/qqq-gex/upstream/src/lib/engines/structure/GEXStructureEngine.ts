import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { UnifiedScore } from '../../../types/score';

import { OptionChain } from '../pricing/OptionChainEngine';
import { GEXPoint } from './GEXEngine';

export type GEXTag = 
  | 'GAMMA_POSITIVE' | 'GAMMA_NEGATIVE' | 'GAMMA_FLIP_NEAR'
  | 'BELOW_FLIP' | 'ABOVE_FLIP'
  | 'NEGATIVE_FLOW_RISK' | 'CHOPPY_ZONE'
  | 'HEAVY_TOP' | 'HEAVY_BOTTOM' | 'CLUSTERED';

export interface GEXStructure extends UnifiedScore<GEXTag> {
  // 基础数据
  total_gex: FinancialFactor<number>;
  positive_gamma: FinancialFactor<number>;
  negative_gamma: FinancialFactor<number>;
  gamma_flip_level: FinancialFactor<number | undefined>;
  call_wall: FinancialFactor<number>;
  put_wall: FinancialFactor<number>;
  price_vs_flip: 'above' | 'below' | 'at';

  // 结构分析
  gamma_state: 'positive' | 'negative' | 'flip_zone';
  gamma_concentration: 'concentrated' | 'distributed';
  inversion: boolean;
  crowding: 'low' | 'medium' | 'high';

  // 结构标签
  structure_label: 'gamma_pin' | 'gamma_expansion' | 'unstable_zone' | 'neutral_zone' | 'inversion_risk';

  timestamp: number;
}

export class GEXStructureEngine extends FactorEngine {
  public analyze(factors: FactorMap): GEXStructure {
    const price = factors.underlying_price?.value ?? 0;
    const gexTopology = factors.gex_topology?.value as any; // From GEXEngine V3
    
    // Attempt to get base data from FactorMap or defaults
    const gamma_flip = factors.gamma_flip_level as FinancialFactor<number | undefined> ?? { value: undefined, confidence: 0, source: { type: 'fallback', reason: 'missing' } };
    const call_wall = factors.call_wall as FinancialFactor<number> ?? { value: price * 1.1, confidence: 0, source: { type: 'fallback', reason: 'missing' } };
    const put_wall = factors.put_wall as FinancialFactor<number> ?? { value: price * 0.9, confidence: 0, source: { type: 'fallback', reason: 'missing' } };
    const total_gex = factors.total_gex as FinancialFactor<number> ?? { value: 0, confidence: 0, source: { type: 'fallback', reason: 'missing' } };
    const gexPoints = (factors.gex_points?.value as GEXPoint[]) ?? [];
    
    // 1. Derive or use pre-calculated topology
    let gamma_state: GEXStructure['gamma_state'] = 'flip_zone';
    let price_vs_flip: GEXStructure['price_vs_flip'] = 'at';
    let crowding: 'low' | 'medium' | 'high' = 'low';
    let gamma_concentration: 'concentrated' | 'distributed' = 'distributed';
    let structure_label: GEXStructure['structure_label'] = 'neutral_zone';

    if (gexTopology) {
      // Use V3 Topology
      gamma_state = gexTopology.netGamma === 'POSITIVE' ? 'positive' : 'negative';
      if (gexTopology.flipPosition === 'NEAR_FLIP') gamma_state = 'flip_zone';
      
      price_vs_flip = gexTopology.flipPosition === 'ABOVE_FLIP' ? 'above' : gexTopology.flipPosition === 'BELOW_FLIP' ? 'below' : 'at';
      crowding = gexTopology.crowding.toLowerCase() as any;
      gamma_concentration = gexTopology.structure === 'CLUSTERED' ? 'concentrated' : 'distributed';
      
      // Structure label map
      if (gexTopology.structure === 'HEAVY_BOTTOM' && gexTopology.netGamma === 'NEGATIVE') structure_label = 'gamma_expansion';
      else if (gexTopology.flipPosition === 'NEAR_FLIP') structure_label = 'unstable_zone';
      else if (gexTopology.structure === 'HEAVY_TOP' && gexTopology.netGamma === 'POSITIVE') structure_label = 'gamma_pin';
      else structure_label = 'neutral_zone';

    } else {
      // Fallback to legacy inference
      // total_gex 已经是美元价值，此处 normalizedGex 含义：单位价格对应的对冲压力美元价值
      const normalizedGex = price > 0 ? total_gex.value / price : 0;
      if (normalizedGex > 10) gamma_state = 'positive';
      else if (normalizedGex < -10) gamma_state = 'negative';

      const flip_threshold = price * 0.005;
      if (gamma_flip.value !== undefined) {
        if (price > gamma_flip.value + flip_threshold) price_vs_flip = 'above';
        else if (price < gamma_flip.value - flip_threshold) price_vs_flip = 'below';
      }

      if (gexPoints.length >= 8) {
        const totalAbsGex = gexPoints.reduce((s, p) => s + Math.abs(p.effectiveGEX), 0);
        const hhi = gexPoints.reduce((s, p) => s + Math.pow(Math.abs(p.effectiveGEX) / (totalAbsGex || 1), 2), 0);
        if (hhi > 0.4) { crowding = 'high'; gamma_concentration = 'concentrated'; }
        else if (hhi > 0.2) crowding = 'medium';
      }
      
      if (gamma_state === 'negative') structure_label = 'gamma_expansion';
      else if (gamma_state === 'flip_zone') structure_label = 'unstable_zone';
    }

    const inversion = call_wall.value < put_wall.value;
    if (inversion) structure_label = 'inversion_risk';

    // 2. Build Tags & Score
    const flags: Partial<Record<GEXTag, boolean>> = {};
    const tags: GEXTag[] = [];
    const addTag = (tag: GEXTag) => { flags[tag] = true; tags.push(tag); };

    if (gamma_state === 'positive') addTag('GAMMA_POSITIVE');
    else if (gamma_state === 'negative') addTag('GAMMA_NEGATIVE');
    else { addTag('GAMMA_FLIP_NEAR'); addTag('CHOPPY_ZONE'); }

    if (price_vs_flip === 'above') addTag('ABOVE_FLIP');
    else if (price_vs_flip === 'below') addTag('BELOW_FLIP');
    
    if (gexTopology) {
        if (gexTopology.structure === 'HEAVY_TOP') addTag('HEAVY_TOP');
        if (gexTopology.structure === 'HEAVY_BOTTOM') addTag('HEAVY_BOTTOM');
        if (gexTopology.structure === 'CLUSTERED') addTag('CLUSTERED');
    }

    if (flags.GAMMA_NEGATIVE && flags.BELOW_FLIP) addTag('NEGATIVE_FLOW_RISK');

    let score = 0;
    if (gamma_state === 'positive') score += 40;
    else if (gamma_state === 'flip_zone') score += 15;
    if (price_vs_flip === 'above') score += 35;
    if (crowding === 'low') score += 25;
    
    score = Math.min(score, 100);

    const confidence = (total_gex.confidence + gamma_flip.confidence) / 2;

    return {
      score,
      level: score > 60 ? 'HIGH' : score < 40 ? 'LOW' : 'MEDIUM',
      flags: flags as Record<GEXTag, boolean>,
      confidence,
      tags,
      total_gex,
      positive_gamma: factors.positive_gamma as any ?? { value: Math.max(0, total_gex.value) },
      negative_gamma: factors.negative_gamma as any ?? { value: Math.min(0, total_gex.value) },
      gamma_flip_level: gamma_flip,
      call_wall,
      put_wall,
      price_vs_flip,
      gamma_state,
      gamma_concentration,
      inversion,
      crowding,
      structure_label,
      timestamp: Date.now()
    };
  }
}

export const gexStructureEngine = new GEXStructureEngine();
