import { FinancialFactor, FactorMap, DerivedSource } from '../../../types/factor';
import { isValidVix, createDerivedFactor } from '../../factor';

// Market state types
export type MarketState = 'OPEN' | 'PREMARKET' | 'CLOSED';

// Term structure types
export type TermStructureType = 'contango' | 'backwardation' | 'flat';

// Unified Market Data Contract
export interface MarketData {
  underlying_price: number;
  atm_iv_curve: {
    dte: number;
    iv: number;
  }[];
  historical_prices: {
    timestamp: number;
    close: number;
  }[];
  market_state: MarketState;
  expected_move_percent?: number;
}

// Output interface for the volatility engine
export interface VolatilityOutput {
  iv: number;
  hv: number;
  iv_hv_ratio: number;
  volatility_score: number;
  term_structure: {
    type: TermStructureType;
    slope: number;
    curvature: number;
  };
  confidence: number;
  trace: {
    iv_source: string;
    hv_source: string;
    curve_points_used: number;
  };
}

// Debug logger class
class DebugLogger {
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  stage(message: string) {
    if (this.enabled) {
      console.log(`[STAGE] ${message}`);
    }
  }

  input(key: string, value: any) {
    if (this.enabled) {
      console.log(`[INPUT] ${key}:`, value);
    }
  }

  check(message: string) {
    if (this.enabled) {
      console.log(`[CHECK] ${message}`);
    }
  }

  warn(message: string) {
    if (this.enabled) {
      console.warn(`[WARN] ${message}`);
    }
  }

  error(message: string) {
    if (this.enabled) {
      console.error(`[ERROR] ${message}`);
    }
  }

  output(key: string, value: any) {
    if (this.enabled) {
      console.log(`[OUTPUT] ${key}:`, value);
    }
  }
}

export class VolatilityEngine {
  private logger: DebugLogger;

  constructor(debug: boolean = false) {
    this.logger = new DebugLogger(debug);
  }

  /**
   * Find the closest IV point for a given DTE
   */
  private findClosestIV(curve: MarketData['atm_iv_curve'], targetDTE: number): { iv: number; dte: number; found: boolean } {
    if (!curve || curve.length === 0) {
      return { iv: 0, dte: 0, found: false };
    }

    let closest = curve[0];
    let minDiff = Math.abs(closest.dte - targetDTE);

    for (let i = 1; i < curve.length; i++) {
      const diff = Math.abs(curve[i].dte - targetDTE);
      if (diff < minDiff) {
        minDiff = diff;
        closest = curve[i];
      }
    }

    return { iv: closest.iv, dte: closest.dte, found: true };
  }

  /**
   * Calculate historical volatility (HV) from price data
   */
  private calculateHV(historicalPrices: MarketData['historical_prices']): { hv: number; source: string } {
    this.logger.stage('Calculating HV_30');

    let prices: number[] = [];
    let source = 'UNKNOWN';

    if (historicalPrices && historicalPrices.length >= 30) {
      this.logger.input('Historical prices provided', historicalPrices.length + ' data points');
      prices = historicalPrices.map(p => p.close).slice(-30);
      source = `historical_prices[${prices.length} points]`;
    } else {
      this.logger.warn('Insufficient historical prices for HV calculation');
      return { hv: 0, source: 'INSUFFICIENT_DATA' };
    }

    // Calculate log returns
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const logReturn = Math.log(prices[i] / prices[i - 1]);
      returns.push(logReturn);
    }

    this.logger.output('Returns array', returns);

    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    this.logger.output('Standard deviation', stdDev);

    // Annualize (252 trading days)
    const hv = stdDev * Math.sqrt(252);

    this.logger.output('HV_30', hv);

    return { hv, source };
  }

  /**
   * Calculate IV from ATM IV curve
   */
  private calculateIV(curve: MarketData['atm_iv_curve']): { iv: number; source: string } {
    this.logger.stage('Calculating IV from ATM IV curve');

    if (!curve || curve.length === 0) {
      this.logger.warn('Empty ATM IV curve');
      return { iv: 0, source: 'EMPTY_CURVE' };
    }

    // Find closest to 30 DTE
    const { iv, dte, found } = this.findClosestIV(curve, 30);

    if (!found || iv <= 0) {
      this.logger.warn('No valid IV found in curve');
      return { iv: 0, source: 'NO_VALID_IV' };
    }

    const source = `atm_iv_curve[dte≈${dte}]`;
    this.logger.output('IV from curve', { iv, dte, source });

    return { iv, source };
  }

  /**
   * Calculate IV/HV ratio and validate
   */
  private calculateIVHVRatio(iv: number, hv: number): { ratio: number; isSuspicious: boolean } {
    this.logger.stage('Calculating IV/HV ratio');

    this.logger.input('IV', iv);
    this.logger.input('HV', hv);

    let ratio = 0;
    let isSuspicious = false;

    if (iv > 0 && hv > 0) {
      ratio = iv / hv;
      this.logger.output('IV/HV ratio', ratio);

      // Check for suspicious values
      if (ratio < 0.3 || ratio > 3) {
        this.logger.warn(`Suspicious IV/HV ratio: ${ratio}`);
        isSuspicious = true;
      }
    } else {
      this.logger.warn('Invalid IV or HV for ratio calculation');
      isSuspicious = true;
    }

    return { ratio, isSuspicious };
  }

  /**
   * Calculate term structure using ATM IV curve
   */
  private calculateTermStructure(curve: MarketData['atm_iv_curve']): {
    type: TermStructureType;
    slope: number;
    curvature: number;
    valid: boolean;
  } {
    this.logger.stage('Calculating term structure');

    if (!curve || curve.length < 3) {
      this.logger.warn('Insufficient IV curve data for term structure calculation');
      return { type: 'flat', slope: 0, curvature: 0, valid: false };
    }

    // Find points for term structure
    const near = this.findClosestIV(curve, 7);
    const mid = this.findClosestIV(curve, 30);
    const far = this.findClosestIV(curve, 60);

    this.logger.input('Term structure points', { near, mid, far });

    if (!near.found || !mid.found || !far.found) {
      this.logger.warn('Insufficient valid points for term structure');
      return { type: 'flat', slope: 0, curvature: 0, valid: false };
    }

    if (near.iv <= 0 || mid.iv <= 0 || far.iv <= 0) {
      this.logger.warn('Invalid IV values for term structure');
      return { type: 'flat', slope: 0, curvature: 0, valid: false };
    }

    // Calculate slope and curvature
    const slope = far.iv - near.iv;
    const curvature = mid.iv - (near.iv + far.iv) / 2;

    this.logger.output('Term structure slope', slope);
    this.logger.output('Term structure curvature', curvature);

    // Determine type
    let type: TermStructureType = 'flat';
    if (Math.abs(slope) < 0.01) {
      type = 'flat';
    } else if (slope > 0) {
      type = 'contango';
    } else {
      type = 'backwardation';
    }

    this.logger.output('Term structure type', type);

    return { type, slope, curvature, valid: true };
  }

  /**
   * Calculate volatility score as replacement for IV Percentile
   */
  private calculateVolatilityScore(iv: number, hv: number, ivHvRatio: number, termStructure: { type: TermStructureType; slope: number }, expectedMovePercent: number): number {
    this.logger.stage('Volatility Edge Calculation');

    this.logger.input('IV', iv);
    this.logger.input('HV', hv);
    this.logger.input('IV/HV ratio', ivHvRatio);
    this.logger.input('Term structure', termStructure);
    this.logger.input('Expected move percent', expectedMovePercent);

    // Initialize scores and weights
    let score = 0;
    let totalMaxScore = 0;

    // 1. IV/HV component (0-40)
    let ivHvScore = 0;
    const ivHvMax = 40;
    if (ivHvRatio > 1.3) {
      ivHvScore = 40;
      this.logger.input('IV/HV', `40 - IV/HV ratio > 1.3`);
    } else if (ivHvRatio >= 1.1 && ivHvRatio <= 1.3) {
      ivHvScore = 25;
      this.logger.input('IV/HV', `25 - IV/HV ratio 1.1-1.3`);
    } else if (ivHvRatio >= 0.9 && ivHvRatio < 1.1) {
      ivHvScore = 10;
      this.logger.input('IV/HV', `10 - IV/HV ratio 0.9-1.1`);
    } else if (ivHvRatio < 0.8) {
      ivHvScore = 0;
      this.logger.input('IV/HV', `0 - IV/HV ratio < 0.8`);
    }
    score += ivHvScore;
    totalMaxScore += ivHvMax;

    // 2. Term structure component (0-20)
    let tsScore = 0;
    const tsMax = 20;
    if (termStructure.type === 'backwardation') {
      tsScore = 20;
      this.logger.input('Term Structure', `20 - Backwardation`);
    } else if (termStructure.type === 'flat') {
      tsScore = 10;
      this.logger.input('Term Structure', `10 - Flat`);
    } else if (termStructure.type === 'contango') {
      tsScore = 5;
      this.logger.input('Term Structure', `5 - Contango`);
    }
    score += tsScore;
    totalMaxScore += tsMax;

    // 3. Expected move component (0-20)
    let emScore = 0;
    const emMax = 20;
    if (hv > 0) {
      const hv30DayPct = hv * Math.sqrt(30 / 252) * 100;  // 年化 decimal -> 30天百分比
      const emRatio = hv30DayPct > 0 ? expectedMovePercent / hv30DayPct : 0;
      
      if (emRatio > 1.2) {
        emScore = 20;
        this.logger.input('Expected Move', `20 - Expected move ratio > 1.2`);
      } else if (emRatio >= 0.9 && emRatio <= 1.2) {
        emScore = 10;
        this.logger.input('Expected Move', `10 - Expected move ratio 0.9-1.2`);
      } else if (emRatio >= 0.8) {
        emScore = 5;
        this.logger.input('Expected Move', `5 - Expected move ratio 0.8-0.9`);
      } else if (emRatio < 0.8) {
        emScore = 0;
        this.logger.input('Expected Move', `0 - Expected move ratio < 0.8`);
      }
    } else {
      this.logger.warn('Invalid HV for expected move calculation');
    }
    score += emScore;
    totalMaxScore += emMax;

    // Handle missing data - normalize only on available components
    let normalizedScore = 0;
    if (totalMaxScore > 0) {
      normalizedScore = (score / totalMaxScore) * 100;
    }

    // Ensure score is within 0-100 range
    normalizedScore = Math.max(0, Math.min(100, normalizedScore));

    this.logger.output('Raw score', score);
    this.logger.output('Normalized score', normalizedScore);

    // Add warnings for suspicious values
    if (ivHvRatio < 0.3 || ivHvRatio > 3) {
      this.logger.warn(`Suspicious IV/HV ratio: ${ivHvRatio}`);
    }

    return normalizedScore;
  }

  /**
   * Calculate confidence based on data quality
   */
  private calculateConfidence(data: MarketData, termStructureValid: boolean): number {
    this.logger.stage('Calculating confidence');

    this.logger.input('Market data quality check', {
      curveLength: data.atm_iv_curve.length,
      historicalPricesLength: data.historical_prices.length,
      termStructureValid
    });

    // Base weights
    let weights = {
      ivCurve: 0.4,
      historicalPrices: 0.3,
      termStructure: 0.3
    };

    // Calculate component confidences
    const ivCurveConfidence = data.atm_iv_curve.length >= 3 ? 1.0 : data.atm_iv_curve.length >= 1 ? 0.6 : 0;
    const historicalPricesConfidence = data.historical_prices.length >= 30 ? 1.0 : data.historical_prices.length >= 10 ? 0.6 : 0;
    const termStructureConfidence = termStructureValid ? 1.0 : 0.5;

    // Calculate weighted confidence
    let confidence = (
      ivCurveConfidence * weights.ivCurve +
      historicalPricesConfidence * weights.historicalPrices +
      termStructureConfidence * weights.termStructure
    );

    // Convert to 0-10 scale
    confidence = confidence * 10;

    this.logger.output('Confidence', confidence);

    return confidence;
  }

  /**
   * Main method to run the volatility engine (PURE FUNCTION)
   */
  run(data: MarketData): VolatilityOutput {
    this.logger.stage('Starting Volatility Engine run');
    this.logger.input('MarketData', data);

    // 1. Calculate IV from ATM IV curve
    const { iv, source: ivSource } = this.calculateIV(data.atm_iv_curve);

    // 2. Calculate HV from historical prices
    const { hv, source: hvSource } = this.calculateHV(data.historical_prices);

    // 3. Calculate IV/HV ratio
    const { ratio: ivHvRatio, isSuspicious } = this.calculateIVHVRatio(iv, hv);

    // 4. Calculate term structure
    const termStructure = this.calculateTermStructure(data.atm_iv_curve);

    // 5. Calculate volatility score
    const expectedMovePercent = data.expected_move_percent || 0;
    const volatilityScore = this.calculateVolatilityScore(iv, hv, ivHvRatio, termStructure, expectedMovePercent);

    // 6. Calculate confidence
    const confidence = this.calculateConfidence(data, termStructure.valid);

    // 7. Build output
    const output: VolatilityOutput = {
      iv,
      hv,
      iv_hv_ratio: ivHvRatio,
      volatility_score: volatilityScore,
      term_structure: {
        type: termStructure.type,
        slope: termStructure.slope,
        curvature: termStructure.curvature
      },
      confidence,
      trace: {
        iv_source: ivSource,
        hv_source: hvSource,
        curve_points_used: data.atm_iv_curve.length
      }
    };

    this.logger.stage('Volatility Engine run completed');
    this.logger.output('Final output', output);

    return output;
  }

  /**
   * Fetch volatility data and return as FactorMap
   * Note: This method now requires pre-fetched MarketData
   */
  fetchVolatilityData(data: MarketData, lightweight: boolean = false): FactorMap {
    const result = this.run(data);
    const factors: FactorMap = {};

    // volatilityScore: composite seller-edge quality metric
    // Inputs reference the MarketData contract directly rather than intermediate factors
    // to avoid polluting the FactorMap with redundant iv/hv keys
    factors.volatilityScore = {
      value: result.volatility_score,
      confidence: result.confidence,
      source: {
        type: 'derived',
        inputs: [
          { factorId: 'implied_volatility', weight: 0.5 },
          { factorId: 'hv_30', weight: 0.3 },
          { factorId: 'iv_curve', weight: 0.2 },
        ],
      },
    };

    if (!lightweight) {
      factors.termStructureType = {
        value: result.term_structure.type,
        confidence: result.confidence,
        source: { type: 'derived', inputs: [{ factorId: 'iv_curve', weight: 1.0 }] },
      };
      factors.termStructureSlope = {
        value: result.term_structure.slope,
        confidence: result.confidence,
        source: { type: 'derived', inputs: [{ factorId: 'iv_curve', weight: 1.0 }] },
      };
      factors.termStructureCurvature = {
        value: result.term_structure.curvature,
        confidence: result.confidence,
        source: { type: 'derived', inputs: [{ factorId: 'iv_curve', weight: 1.0 }] },
      };
    }

    return factors;
  }
}

export default VolatilityEngine;

// Export a singleton instance
export const volatilityEngine = new VolatilityEngine();
