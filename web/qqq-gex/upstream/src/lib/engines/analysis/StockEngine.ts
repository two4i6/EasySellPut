import { FactorEngine } from '../../FactorEngine';
import { FactorMap, FinancialFactor } from '../../../types/factor';
import { MacroDecisionSystem } from '../../../types/macro';
import type { IVCurveValue, OptionContract } from '../../../types/ivCurve';
import { GEXEngine } from '../structure/GEXEngine';
import { getFactorValue as getFV } from '../../factor';

const IV_STRADDLE_SCALE = 0.85;

export interface StockStrategy {
  type: 'PUT_SPREAD' | 'CALL_SPREAD' | 'IRON_CONDOR' | 'CASH_SECURED_PUT' | 'WAIT';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  tradability: MacroDecisionSystem['recommendation']['value']['tradability'];
  confidence: number;
  dataQuality: 'high' | 'medium' | 'low';
  
  triggerFactors: string[];
  blockedBy: string[];
  strikes: {
    sell: number;
    buy: number;
    sellPut?: number;
    buyPut?: number;
    sellCall?: number;
    buyCall?: number;
  };
  financials: {
    credit: number;
    maxRisk: number;
    returnOnRisk: number;
  };
  dte: number;
  reason: string;
}

export interface ExpectedMoveAnalysis {
  timestamp: string;
  expectedMove: FinancialFactor<{
    straddlePrice: number;
    expectedMove: number;
    expectedMovePercent: number;
    expectedMoveHV: number;
    hvDeviation: number;
    band68: { upper: number; lower: number };
    band95: { upper: number; lower: number };
    bandHorizonDays: number;
    termStructure: 'contango' | 'backwardation' | 'flat';
    termStructureSlope: number;
  }>;
  matrix: FinancialFactor<Array<{
    days: number;
    move: number;
    percent: number;
    upper: number;
    lower: number;          // = effectiveLower（全系统唯一下界）
    /** 纯 IV/straddle 统计 1σ，专供展示，不含风险或结构修正。 */
    bandUpper: number;
    bandLower: number;
    effectiveLower: number; // 显式字段：globalLower + DTE scaling + GEX/Skew correction
    lower2Sigma: number;    // 以最终 effectiveLower 的下行距离等比扩展到 2σ
    globalLower: number;    // 30D 结构基线（所有 DTE 共享同一 baseline）
    iv: number;
    ivInterpolated: boolean;
    expiration?: string;
    skew?: number;
    put25IV?: number;
    volume?: number;
    openInterest?: number;
    contracts?: {
      calls: import('../../../types/ivCurve').OptionContract[];
      puts: import('../../../types/ivCurve').OptionContract[];
    };
    gexAdjustment?: {
      putWallActive: boolean;
      callWallActive: boolean;
      putWallPrice: number;
      callWallPrice: number;
      gammaFlipPrice: number;
      lowerCompression: number;
      upperCompression: number;
    };
    skewAdjustment?: {
      active: boolean;
      skewValue: number;
      direction: 'bearish' | 'bullish' | 'none';
      lowerBias: number;
    };
    gexSummary?: {
      totalNetGEX: number;
      pcrDeltaWeighted: number;
      topology: import('../structure/GEXEngine').GEXTopology;
    };
    flow: {
      callVolume: number;
      putVolume: number;
      callOI: number;
      putOI: number;
    };
    gexLevels: {
      putWall: number | null;
      callWall: number | null;
      gammaFlip: number | null;
      netGEX: number;
    };
  }>>;
  unusualActivity: Array<{
    strike: number;
    dte: number;
    expiration: string;
    type: 'call' | 'put';
    volume: number;
    openInterest: number;
    voi: number;
  }>;
}

export class StockEngine extends FactorEngine {
  private roundToStrike(value: number): number {
    return Math.round(value / 5) * 5;
  }

  public buildExpectedMoveAnalysis(
    factors: FactorMap,
    gex: import('../structure/GEXStructureEngine').GEXStructure
  ): ExpectedMoveAnalysis {
    const expectedMove = this.calculateExpectedMove(factors);
    // 30D 结构基线：所有 DTE 的 effectiveLower 从此派生
    const globalLower = expectedMove.value.band68.lower;
    const matrix = this.calculateExpectedMoveMatrix(factors, expectedMove.value.expectedMove, gex, globalLower);
    const unusualActivity = matrix.value.flatMap((row) => [
      ...(row.contracts?.calls ?? []).map((contract) => ({ contract, type: 'call' as const, dte: row.days, expiration: row.expiration })),
      ...(row.contracts?.puts ?? []).map((contract) => ({ contract, type: 'put' as const, dte: row.days, expiration: row.expiration })),
    ])
      .filter(({ contract }) => (contract.openInterest ?? 0) >= 10 && (contract.volume ?? 0) > 0)
      .map(({ contract, type, dte, expiration }) => ({
        strike: contract.strike,
        dte,
        expiration: expiration ?? '',
        type,
        volume: contract.volume ?? 0,
        openInterest: contract.openInterest ?? 0,
        voi: (contract.volume ?? 0) / (contract.openInterest ?? 0),
      }))
      .sort((a, b) => b.voi - a.voi)
      .slice(0, 5);

    return {
      timestamp: new Date().toISOString(),
      expectedMove,
      matrix,
      unusualActivity,
    };
  }

  public calculateExpectedMove(
    factors: FactorMap,
  ): FinancialFactor<{
    straddlePrice: number;
    expectedMove: number;
    expectedMovePercent: number;
    expectedMoveHV: number;
    hvDeviation: number;
    band68: { upper: number; lower: number };
    band95: { upper: number; lower: number };
    bandHorizonDays: number;
    termStructure: 'contango' | 'backwardation' | 'flat';
    termStructureSlope: number;
  }> {
    const price = getFV<number>(factors, 'underlying_price') ?? getFV<number>(factors, 'price') ?? 0;
    const atmCall = getFV<number>(factors, 'atmCall') ?? 0;
    const atmPut = getFV<number>(factors, 'atmPut') ?? 0;
    const straddlePrice = atmCall + atmPut;
    const expectedMove = straddlePrice * IV_STRADDLE_SCALE;  // IV-based（主参考）

    const regimeScore = getFV<number>(factors, 'regime_score') ?? 50;
    const riskScore   = getFV<number>(factors, 'risk_score')  ?? 50;

    // regime/risk 扩展系数（BEAR/高风险环境下置信区间更宽）
    const bandExpansion =
      regimeScore < 40 ? 1.3 :
      regimeScore < 55 ? 1.15 :
      riskScore > 70 ? 1.2 :
      1.0;

    // HV-based 补充参考，使用 hv_30 或 implied_volatility 降级
    const hvAnnual = getFV<number>(factors, 'hv_30') ?? getFV<number>(factors, 'implied_volatility') ?? 0.2;
    const dte = 30; // 标准化到 30 天，与主参考对齐
    const expectedMoveHV = price * hvAnnual * Math.sqrt(dte / 365) * IV_STRADDLE_SCALE;

    // IV / HV deviation（正值表示 IV 溢价）
    const ivAnnual = getFV<number>(factors, 'implied_volatility') ?? 0.2;
    const hvDeviation = hvAnnual > 0 ? (ivAnnual - hvAnnual) / hvAnnual : 0;

    const hvBandFactor =
      hvDeviation > 0.5 ? 1.2 :
      hvDeviation > 0.3 ? 1.1 :
      1.0;

    // IV 期限结构形态检测：比较短端与长端的平均 IV
    const ivCurvePoints = (factors.iv_curve?.value as IVCurveValue | undefined)?.points ?? [];
    let termStructure: 'contango' | 'backwardation' | 'flat' = 'flat';
    let termStructureSlope = 0;
    if (ivCurvePoints.length >= 2) {
      const sortedPoints = [...ivCurvePoints].sort((a, b) => a.daysToExpiration - b.daysToExpiration);
      
      // 优先尝试固定区间，若缺失则取首尾
      let shortEnd = sortedPoints.filter(p => p.daysToExpiration >= 1 && p.daysToExpiration <= 21).map(p => p.atmIV);
      let longEnd = sortedPoints.filter(p => p.daysToExpiration >= 40).map(p => p.atmIV);
      
      if (shortEnd.length === 0) shortEnd = [sortedPoints[0].atmIV];
      if (longEnd.length === 0) longEnd = [sortedPoints[sortedPoints.length - 1].atmIV];

      const avgShort = shortEnd.reduce((s, v) => s + v, 0) / shortEnd.length;
      const avgLong = longEnd.reduce((s, v) => s + v, 0) / longEnd.length;
      
      // 斜率计算：(短端 - 远端) / 远端。正值代表 Backwardation (近期贵)
      termStructureSlope = avgLong > 0 ? (avgShort - avgLong) / avgLong : 0;
      termStructure = termStructureSlope > 0.10 ? 'backwardation' :
                      termStructureSlope < -0.05 ? 'contango' : 'flat';
    }

    // 期限结构修正：backwardation 表示近期事件风险，扩大置信区间
    const termStructureFactor =
      termStructure === 'backwardation' ? 1.15 :
      termStructure === 'contango' ? 0.95 :
      1.0;

    // KC Squeeze 乘数：压缩期后惯性爆发，期望移动扩大
    const kcSqueeze = getFV<boolean>(factors, 'kc_squeeze') ?? false;
    const kcSqueezeFactor = kcSqueeze ? 1.10 : 1.0;

    // VWAP 偏离乘数：远离 VWAP 说明趋势已延伸，期望均值回归幅度更大
    const vwapDev = Math.abs(getFV<number>(factors, 'vwap_deviation') ?? 0);
    const vwapFactor = vwapDev > 0.05 ? 1.08 : vwapDev > 0.03 ? 1.04 : 1.0;

    // 1σ 统计区间（30d horizon）。标签承诺的是标准差区间，不能混入
    // regime / GEX / skew 等风险调整；这些只服务于独立的候选安全边界。
    const downBias = riskScore > 70 ? 1.2 : 1.0;
    const rawExpanded = expectedMove > 0
      ? expectedMove * bandExpansion * hvBandFactor * termStructureFactor * kcSqueezeFactor * vwapFactor
      : price * ivAnnual * Math.sqrt(30 / 365) * IV_STRADDLE_SCALE * bandExpansion * hvBandFactor * termStructureFactor * kcSqueezeFactor * vwapFactor;

    const expandedMove = Math.min(rawExpanded, price * 0.35); // 期望移动最多为价格的 35%

    const oneSigmaMove = expectedMove > 0
      ? expectedMove
      : price * ivAnnual * Math.sqrt(30 / 365) * IV_STRADDLE_SCALE;
    const band68 = {
      upper: price + oneSigmaMove,
      lower: price - oneSigmaMove,
    };
    const band95 = { 
      upper: price + expandedMove * 2, 
      lower: price - expandedMove * 2 * downBias 
    };

    const hasHV = (factors.hv_30?.confidence ?? 0) > 0;
    const hasIVCurve = ivCurvePoints.length >= 2;

    // 权重分配逻辑
    let baseInputs: Array<{ factorId: string; weight: number }> = [];

    if (hasHV && hasIVCurve) {
      baseInputs = [
        { factorId: 'price',              weight: 0.22 },
        { factorId: 'atmCall',            weight: 0.16 },
        { factorId: 'atmPut',             weight: 0.16 },
        { factorId: 'implied_volatility', weight: 0.12 },
        { factorId: 'hv_30',              weight: 0.10 },
        { factorId: 'iv_curve',           weight: 0.08 },
        { factorId: 'vol_price_regime',   weight: 0.06 },
        { factorId: 'kc_squeeze',         weight: 0.05 },
        { factorId: 'vwap_deviation',     weight: 0.05 },
      ];
    } else if (hasHV && !hasIVCurve) {
      baseInputs = [
        { factorId: 'price',              weight: 0.26 },
        { factorId: 'atmCall',            weight: 0.20 },
        { factorId: 'atmPut',             weight: 0.20 },
        { factorId: 'implied_volatility', weight: 0.13 },
        { factorId: 'hv_30',              weight: 0.11 },
        { factorId: 'vol_price_regime',   weight: 0.05 },
        { factorId: 'kc_squeeze',         weight: 0.05 },
      ];
    } else {
      baseInputs = [
        { factorId: 'price',   weight: 0.34 },
        { factorId: 'atmCall', weight: 0.33 },
        { factorId: 'atmPut',  weight: 0.33 },
      ];
    }

    // 过滤缺失因子并归一化权重
    const validInputs = baseInputs.filter(i => factors[i.factorId] && factors[i.factorId].value !== null);
    const totalWeight = validInputs.reduce((sum, i) => sum + i.weight, 0);
    const inputs = totalWeight > 0 
      ? validInputs.map(i => ({ ...i, weight: i.weight / totalWeight })) 
      : baseInputs.slice(0, 3).map(i => ({ ...i, weight: i.weight / baseInputs.slice(0,3).reduce((s, x) => s + x.weight, 0) }));

    const moveReasons: string[] = [];
    if (termStructure === 'backwardation') moveReasons.push('Backwardation: Short-term risk elevated');
    if (regimeScore < 40) moveReasons.push('Bearish regime: Widening bands');
    if (riskScore > 70) moveReasons.push('High risk score: Increasing move expectation');
    if (hvDeviation > 0.3) moveReasons.push('IV/HV Premium: IV pricing in higher moves');
    if (kcSqueeze) moveReasons.push('KC Squeeze: Volatility compression detected, breakout risk elevated');
    if (vwapDev > 0.03) moveReasons.push('Extended VWAP deviation: Mean-reversion pressure increasing');

    return this.derived(
      { straddlePrice, expectedMove, expectedMovePercent: price > 0 ? (expectedMove / price) * 100 : 0,
        expectedMoveHV, hvDeviation, band68, band95, bandHorizonDays: 30,
        termStructure, termStructureSlope },
      inputs,
      factors,
      moveReasons.join(', ') || 'Standard IV-based expected move'
    );
  }

  public calculateExpectedMoveMatrix(
    factors: FactorMap,
    anchorMove30d?: number,  // 由 buildExpectedMoveAnalysis 传入 expectedMove.value.expectedMove
    gex?: import('../structure/GEXStructureEngine').GEXStructure,
    globalLower?: number     // 30D 结构基线：effectiveLower 的单一来源
  ): FinancialFactor<Array<{
    days: number;
    move: number;
    percent: number;
    upper: number;
    lower: number;
    /** Pure IV/straddle one-sigma bounds for display; never risk-adjusted. */
    bandUpper: number;
    bandLower: number;
    effectiveLower: number;
    lower2Sigma: number;
    globalLower: number;
    iv: number;
    ivInterpolated: boolean;
    expiration?: string;
    skew?: number;
    put25IV?: number;
    volume?: number;
    openInterest?: number;
    contracts?: {
      calls: import('../../../types/ivCurve').OptionContract[];
      puts: import('../../../types/ivCurve').OptionContract[];
    };
    gexAdjustment?: {
      putWallActive: boolean;
      callWallActive: boolean;
      putWallPrice: number;
      callWallPrice: number;
      gammaFlipPrice: number;
      lowerCompression: number;
      upperCompression: number;
    };
    skewAdjustment?: {
      active: boolean;
      skewValue: number;
      direction: 'bearish' | 'bullish' | 'none';
      lowerBias: number;
    };
    gexSummary?: {
      totalNetGEX: number;
      pcrDeltaWeighted: number;
      topology: import('../structure/GEXEngine').GEXTopology;
    };
    flow: {
      callVolume: number;
      putVolume: number;
      callOI: number;
      putOI: number;
    };
    gexLevels: {
      putWall: number | null;
      callWall: number | null;
      gammaFlip: number | null;
      netGEX: number;
    };
  }>> {
    const price = getFV<number>(factors, 'underlying_price') ?? getFV<number>(factors, 'price') ?? 0;
    const iv = getFV<number>(factors, 'implied_volatility') ?? 0.2;
    const regimeScore = getFV<number>(factors, 'regime_score') ?? 50;
    const riskScore = getFV<number>(factors, 'risk_score') ?? 50;
    const vix = getFV<number>(factors, 'iv_override') ?? getFV<number>(factors, 'vix_price') ?? 20;

    const ivCurvePoints = (factors.iv_curve?.value as IVCurveValue | undefined)?.points ?? [];
    const hasIVCurve = ivCurvePoints.length >= 2;

    // regime_score 放大系数
    const regimeMultiplier =
      regimeScore < 40 ? 1.3 :
      regimeScore < 55 ? 1.15 :
      1.0;

    // VIX 极端事件系数
    const extremeMultiplier =
      vix > 30 ? 1.4 :
      vix > 25 ? 1.2 :
      1.0;

    // HV 偏离修正：IV 显著溢价时扩大区间
    const hvAnnual = getFV<number>(factors, 'hv_30') ?? getFV<number>(factors, 'implied_volatility') ?? iv;
    const hvDeviation = hvAnnual > 0 ? (iv - hvAnnual) / hvAnnual : 0;
    const hvBiasMultiplier =
      hvDeviation > 0.5 ? 1.25 :
      hvDeviation > 0.3 ? 1.15 :
      hvDeviation > 0.15 ? 1.07 :
      1.0;

    const buildRow = (days: number, rowIV: number, expiration?: string, usedAnchor?: boolean, contracts?: { calls: OptionContract[]; puts: OptionContract[] }) => {
      let baseMove: number;
      if (usedAnchor && anchorMove30d !== undefined && anchorMove30d > 0) {
        baseMove = anchorMove30d;  // 最近30d到期日用 straddle 锚点（市场定价最准确）
      } else {
        baseMove = price * rowIV * Math.sqrt(days / 365) * IV_STRADDLE_SCALE;
      }

      // 短期风险放大系数（DTE ≤ 14 专属）
      const shortTermRisk = days <= 7  ? regimeMultiplier * extremeMultiplier :
                            days <= 14 ? 1 + (regimeMultiplier * extremeMultiplier - 1) * 0.5 :
                            1.0;
      const downBiasMultiplier = riskScore > 70 ? 1.2 : 1.0;
      const riskAdjustedMove = baseMove * shortTermRisk * hvBiasMultiplier;

      // ── effectiveLower 计算 ───────────────────────────────────────────────
      // 架构：globalLower（30D 结构基线）→ √T 缩放 → DTE 修正（GEX / Skew）
      // 若 globalLower 未提供则回退为旧逻辑（兼容独立调用场景）
      const hasGlobalLower = globalLower !== undefined && globalLower > 0 && price > globalLower;
      let effectiveLower: number;
      if (hasGlobalLower) {
        // Step A: 30D 基线距离按 √(DTE/30) 缩放
        const baselineDistance = price - globalLower!;
        const scaledDistance   = baselineDistance * Math.sqrt(days / 30);
        // Step B: DTE 短期风险扩张（不改变 globalLower 本身，只扩大当期距离）
        effectiveLower = price - scaledDistance * shortTermRisk;
      } else {
        effectiveLower = price - riskAdjustedMove * downBiasMultiplier;
      }

      // 计算 Skew, Volume, OI
      let skew: number | undefined;
      let put25IV: number | undefined;
      let volume: number | undefined;
      let openInterest: number | undefined;
      let flow = { callVolume: 0, putVolume: 0, callOI: 0, putOI: 0 };
      const usableContractOI = Boolean(contracts && GEXEngine.hasUsableOpenInterest(contracts.calls, contracts.puts));

      if (contracts) {
        const { calls, puts } = contracts;
        
        // Optimized combined traversal for Skew, Volume & OI
        let v = 0, oi = 0;
        let callVolume = 0, putVolume = 0, callOI = 0, putOI = 0;
        let put25 = puts.length > 0 ? puts[0] : null;
        let call25 = calls.length > 0 ? calls[0] : null;

        for (const c of calls) {
          const contractVolume = c.volume ?? 0;
          const contractOI = c.openInterest ?? 0;
          v += contractVolume;
          oi += contractOI;
          callVolume += contractVolume;
          callOI += contractOI;
          if (call25 && Math.abs((c.delta || 0) - 0.25) < Math.abs((call25.delta || 0) - 0.25)) {
            call25 = c;
          }
        }
        for (const p of puts) {
          const contractVolume = p.volume ?? 0;
          const contractOI = p.openInterest ?? 0;
          v += contractVolume;
          oi += contractOI;
          putVolume += contractVolume;
          putOI += contractOI;
          if (put25 && Math.abs((p.delta || 0) + 0.25) < Math.abs((put25.delta || 0) + 0.25)) {
            put25 = p;
          }
        }
        
        volume = v;
        openInterest = oi;
        flow = { callVolume, putVolume, callOI, putOI };
        if (!usableContractOI) {
          openInterest = undefined;
          flow = { callVolume, putVolume, callOI: 0, putOI: 0 };
        }
        if (put25 && call25 && put25.iv > 0 && call25.iv > 0) {
          skew = put25.iv - call25.iv;
          put25IV = put25.iv;
        }
      }

      const bandUpper = price + baseMove;
      const bandLower = Math.max(0, price - baseMove);
      let upper = price + riskAdjustedMove;

      // GEX Metrics for this specific DTE
      let dteGEX = null;
      if (contracts && usableContractOI) {
        dteGEX = GEXEngine.calculate(contracts.calls, contracts.puts, price, rowIV * 100, days);
      }

      // Tracking variables for adjustments
      let putWallActive = false;
      let callWallActive = false;
      let lowerCompression = 0;
      let upperCompression = 0;

      // Use specific DTE GEX prices if available, otherwise fallback to global
      const putWallPriceUsed = dteGEX?.putWallPrice ?? gex?.put_wall?.value ?? getFV<number>(factors, 'gex_put_wall') ?? 0;
      const callWallPriceUsed = dteGEX?.callWallPrice ?? gex?.call_wall?.value ?? getFV<number>(factors, 'gex_call_wall') ?? 0;
      const gammaFlipPriceUsed = dteGEX?.gammaFlipPrice ?? gex?.gamma_flip_level?.value ?? getFV<number>(factors, 'gamma_flip_level') ?? price;

      // ── Delta Corrections 作用于 effectiveLower ──────────────────────────
      // 1. GEX Topology 结构化修正
      const topology = dteGEX?.topology;
      if (topology) {
        // Gamma 翻转临界区：增加 5% 风险缓冲区
        if (topology.flipPosition === 'NEAR_FLIP') {
          effectiveLower *= 0.95;
        }
        // 下方支撑沉重：收窄 3% 安全边际 (APR 增强)
        if (topology.structure === 'HEAVY_BOTTOM' && topology.netGamma === 'POSITIVE') {
          effectiveLower *= 1.03;
        }
        // 拥挤度极高：增加 2% 风险缓冲区 (流动性风险)
        if (topology.crowding === 'HIGH') {
          effectiveLower *= 0.98;
        }
      }

      // 2. GEX Put Wall 支撑：price 接近 put wall 时 effectiveLower 向上收缩
      if (putWallPriceUsed > 0 && price > 0) {
        const putWallDistance = (price - putWallPriceUsed) / price;
        if (putWallDistance > 0 && putWallDistance < 0.10) {
          const compression = Math.min(0.08, putWallDistance * 0.5);
          effectiveLower = effectiveLower * (1 + compression);
          putWallActive = true;
          lowerCompression = compression;
        }
      }
      // Call Wall 对 upper 的阻力（upper 不变，保持原有逻辑）
      if (callWallPriceUsed > 0 && price > 0) {
        const callWallDistance = (callWallPriceUsed - price) / price;
        if (callWallDistance > 0 && callWallDistance < 0.10) {
          const compression = Math.min(0.08, callWallDistance * 0.5);
          upper = upper * (1 - compression);
          callWallActive = true;
          upperCompression = compression;
        }
      }

      let skewActive = false;
      let skewDirection: 'bearish' | 'bullish' | 'none' = 'none';
      let appliedLowerBias = 0;

      // Skew Delta Correction：市场 skew 偏向表达为对 effectiveLower 的调整
      if (skew !== undefined && skew > 0.02) {
        // 正 skew（put 溢价）：下行风险被定价，effectiveLower 向下扩张
        const skewBias = Math.min(0.12, skew * 1.5);
        // 只扩张 spot 到下界的风险距离，不能对整个价格折扣。
        // 否则 $700 的下界会被 skew 再压低几十美元，远超实际偏斜含义。
        effectiveLower = price - (price - effectiveLower) * (1 + skewBias);
        skewActive = true;
        skewDirection = 'bearish';
        appliedLowerBias = skewBias;
      }
      if (skew !== undefined && skew < -0.02) {
        // 负 skew（call 溢价）：effectiveLower 向上收缩，upper 小幅扩张
        const skewBias = Math.min(0.06, Math.abs(skew) * 1.0);
        effectiveLower = price - (price - effectiveLower) * (1 - skewBias);
        upper = upper * (1 + skewBias * 0.5);
        skewActive = true;
        skewDirection = 'bullish';
        appliedLowerBias = -skewBias;
      }

      const lower2Sigma = Math.max(0, price - 2 * (price - effectiveLower));

      return {
        days,
        move: baseMove,
        percent: price > 0 ? (baseMove / price) * 100 : 0,
        upper,
        lower: effectiveLower,          // 全系统唯一下界
        bandUpper,
        bandLower,
        effectiveLower,                  // 显式字段，便于调试和 UI 展示
        lower2Sigma,
        globalLower: globalLower ?? 0,  // 30D 结构基线（透明存储）
        iv: rowIV,
        ivInterpolated: hasIVCurve,
        skew,
        put25IV,
        volume,
        openInterest,
        ...(expiration !== undefined ? { expiration } : {}),
        ...(contracts !== undefined ? { contracts } : {}),
        gexAdjustment: {
          putWallActive,
          callWallActive,
          putWallPrice: putWallPriceUsed,
          callWallPrice: callWallPriceUsed,
          gammaFlipPrice: gammaFlipPriceUsed,
          lowerCompression,
          upperCompression
        },
        skewAdjustment: (skew !== undefined) ? {
          active: skewActive,
          skewValue: skew,
          direction: skewDirection,
          lowerBias: appliedLowerBias
        } : undefined,
        gexSummary: dteGEX ? {
          totalNetGEX: dteGEX.totalGexValue,
          pcrDeltaWeighted: dteGEX.pcrDeltaWeighted,
          topology: dteGEX.topology
        } : undefined,
        flow,
        gexLevels: {
          putWall: dteGEX?.putWallPrice ?? null,
          callWall: dteGEX?.callWallPrice ?? null,
          gammaFlip: dteGEX?.gammaFlipPrice ?? null,
          netGEX: dteGEX?.totalGexValue ?? 0,
        },
      };
    };

    let value: ReturnType<typeof buildRow>[];

    if (hasIVCurve) {
      // 主路径：用真实 IV curve 到期日作为矩阵行（无需插值）
      // 找最接近 30d 的到期日作为 straddle 锚点行
      const sorted = [...ivCurvePoints].sort((a, b) => a.daysToExpiration - b.daysToExpiration);
      const anchor = sorted.reduce((prev, cur) =>
        Math.abs(cur.daysToExpiration - 30) < Math.abs(prev.daysToExpiration - 30) ? cur : prev
      );

      value = sorted.map(p => buildRow(
        p.daysToExpiration,
        p.atmIV,
        p.expiration,
        p === anchor,  // 最近30d行用 straddle 锚点
        p.contracts
      ));
    } else {
      // 降级路径：合成地平线 + √T 扩展
      const horizons = [1, 3, 7, 14, 30, 60];
      value = horizons.map((days) => {
        let usedIV = iv;
        let usedAnchor = false;
        if (days === 30 && anchorMove30d !== undefined && anchorMove30d > 0) {
          usedAnchor = true;
        }
        return buildRow(days, usedIV, undefined, usedAnchor);
      });
    }

    const matrixReasons: string[] = [];
    if (hasIVCurve) matrixReasons.push('Using real IV curve for precise expiration expectations');
    if (vix > 25) matrixReasons.push('VIX elevated: Widening volatility bands');
    if (hvDeviation > 0.15) matrixReasons.push('Significant IV/HV premium detected');

    return this.derived(
      value,
      [
        { factorId: 'price', weight: 0.30 },
        { factorId: 'implied_volatility', weight: 0.25 },
        ...(hasIVCurve ? [{ factorId: 'iv_curve', weight: 0.15 }] : []),
        { factorId: 'regime_score', weight: hasIVCurve ? 0.15 : 0.20 },
        { factorId: 'risk_score', weight: hasIVCurve ? 0.10 : 0.15 },
        { factorId: 'vix_price', weight: hasIVCurve ? 0.05 : 0.10 },
      ],
      factors,
      matrixReasons.join(', ') || 'Standard √T volatility matrix'
    );
  }
}

export const stockEngine = new StockEngine();
