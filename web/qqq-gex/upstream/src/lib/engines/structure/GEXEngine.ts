import { OptionContract } from '../../../types/ivCurve';

/**
 * GEX (Gamma Exposure) 结构化风险拓扑系统 - V3 Professional
 * 
 * 核心升级：
 * 1. GEX Structure (分布结构分析)
 * 2. Flip Zone (动态价格位置判定)
 * 3. GEX Crowding (拥挤度/集中度分析)
 */

export type GEXTopologyStructure = 'DISTRIBUTED' | 'CLUSTERED' | 'HEAVY_TOP' | 'HEAVY_BOTTOM';
export type FlipPosition = 'ABOVE_FLIP' | 'BELOW_FLIP' | 'NEAR_FLIP';
export type GEXCrowding = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GEXTopology {
  structure: GEXTopologyStructure;
  flipPosition: FlipPosition;
  crowding: GEXCrowding;
  netGamma: 'POSITIVE' | 'NEGATIVE';
}

export interface GEXPoint {
  strike: number;
  /** 同一 strike 的 Call 原始 GEX 合计（未与 Put 抵消）。 */
  callGEX: number;
  /** 同一 strike 的 Put 原始 GEX 合计（未与 Call 抵消）。 */
  putGEX: number;
  totalGEX: number;
  effectiveGEX: number; // 距离加权后的对冲压力
  rawPCR: number;
  deltaWeightedPCR: number;
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
  isGammaFlip: boolean;
  isCallWall: boolean;
  isPutWall: boolean;
}

export interface GEXMetrics {
  points: GEXPoint[];
  /** 全部 option-chain strike 的未裁剪分布；`points` 仍是墙位/拓扑使用的预期波动窗口。 */
  allPoints: GEXPoint[];
  expectedMove: number;
  gammaFlipPrice: number | null;
  callWallPrice: number | null;
  putWallPrice: number | null;
  pcrDeltaWeighted: number; 
  pcrRaw: number;
  totalGexValue: number;
  topology: GEXTopology;
}

export type GEXCalculationOptions = { scope?: 'window' | 'full-chain'; unit?: 'per-point' | 'per-1pct'; gammaFlipPrice?: number | null };

export class GEXEngine {
  /** Reuse aggregation when the QQQ continuous root becomes available. */
  public static withGammaFlip(metrics: GEXMetrics, spot: number, flip: number | null): GEXMetrics {
    const points = metrics.points.map(p=>({...p,isGammaFlip:flip!==null && p.strike===flip}));
    return {...metrics,points,allPoints:metrics.allPoints.map(p=>({...p,isGammaFlip:flip!==null && p.strike===flip})),gammaFlipPrice:flip,
      topology:this.analyzeTopology(points,spot,metrics.expectedMove,flip,metrics.totalGexValue)};
  }
  /** Yahoo 闭市链经常把绝大多数 OI 置零；稀疏残留不能冒充完整 GEX snapshot。 */
  public static hasUsableOpenInterest(calls: OptionContract[], puts: OptionContract[]): boolean {
    const usableSide = (contracts: OptionContract[]) => {
      if (!contracts.length) return false;
      const positive = contracts.filter((option) => Number.isFinite(option.openInterest) && Number(option.openInterest) > 0).length;
      const minimum = contracts.length === 1 ? 1 : Math.max(2, Math.ceil(contracts.length * .10));
      return positive >= minimum;
    };
    return usableSide(calls) && usableSide(puts);
  }

  /**
   * 核心计算逻辑
   */
  public static calculate(
    calls: OptionContract[],
    puts: OptionContract[],
    spotPrice: number,
    vix: number, // 或者使用当前标的的 ATM IV
    dte: number,
    options: GEXCalculationOptions = {},
  ): GEXMetrics {
    // 1. 计算 Expected Move (1 Standard Deviation)
    const iv = vix / 100;
    const t = Math.max(dte, options.scope === 'full-chain' ? 0 : 0.5) / 365;
    const em = spotPrice * iv * Math.sqrt(t);
    const safEm = Math.max(em, 1e-6);
    
    // 动态分析范围：1.5x EM
    const analysisWindow = safEm * 1.5;
    const minStrike = spotPrice - analysisWindow;
    const maxStrike = spotPrice + analysisWindow;

    const gexMap = new Map<number, { 
      c_gex: number; p_gex: number; 
      c_oi: number; p_oi: number;
      c_vol: number; p_vol: number;
      c_delta_vol: number; p_delta_vol: number;
    }>();

    let totalRawCallOI = 0;
    let totalRawPutOI = 0;
    let totalDeltaCallOI = 0;
    let totalDeltaPutOI = 0;
    let totalGexValue = 0;

    const allOptions = [...calls.map(c => ({...c, type: 'Call' as const})), ...puts.map(p => ({...p, type: 'Put' as const}))];
    
    allOptions.forEach(opt => {
      const inAnalysisWindow = options.scope === 'full-chain' || opt.strike >= minStrike && opt.strike <= maxStrike;
      
      const gamma = opt.gamma || 0;
      const oi = opt.openInterest || 0;
      const vol = opt.volume || 0;
      const delta = Math.abs(opt.delta || 0);
      
      // 标准 GEX = gamma * oi * 合约乘数(100) * spotPrice
      // 单位: 美元 (代表标的价格每变动1点，做市商需要买卖的标的资产美元价值)
      const gex = gamma * oi * 100 * spotPrice * (options.unit === 'per-1pct' ? spotPrice * .01 : 1);
      
      const existing = gexMap.get(opt.strike) || { c_gex: 0, p_gex: 0, c_oi: 0, p_oi: 0, c_vol: 0, p_vol: 0, c_delta_vol: 0, p_delta_vol: 0 };
      
      if (opt.type === 'Call') {
        existing.c_gex += gex;
        existing.c_oi += oi;
        existing.c_vol += vol;
        existing.c_delta_vol += oi * delta;
        if (inAnalysisWindow) {
          totalRawCallOI += oi;
          totalDeltaCallOI += oi * delta;
        }
      } else {
        existing.p_gex += gex;
        existing.p_oi += oi;
        existing.p_vol += vol;
        existing.p_delta_vol += oi * delta;
        if (inAnalysisWindow) {
          totalRawPutOI += oi;
          totalDeltaPutOI += oi * delta;
        }
      }
      gexMap.set(opt.strike, existing);
    });

    const allStrikes = Array.from(gexMap.keys()).sort((a, b) => a - b);
    const toPoint = (strike: number): GEXPoint => {
      const data = gexMap.get(strike)!;
      const dist = Math.abs(strike - spotPrice);
      const weight = Math.exp(-(Math.pow(dist, 2)) / (2 * Math.pow(safEm, 2)));
      const netGEX = data.c_gex - data.p_gex;
      return {
        strike,
        callGEX: data.c_gex,
        putGEX: data.p_gex,
        totalGEX: netGEX,
        effectiveGEX: netGEX * weight,
        rawPCR: data.c_oi > 0 ? data.p_oi / data.c_oi : 0,
        deltaWeightedPCR: data.c_delta_vol > 0 ? data.p_delta_vol / data.c_delta_vol : 0,
        callOI: data.c_oi,
        putOI: data.p_oi,
        callVol: data.c_vol,
        putVol: data.p_vol,
        isGammaFlip: false,
        isCallWall: false,
        isPutWall: false
      };
    };
    const sortedStrikes = allStrikes.filter((strike) => strike >= minStrike && strike <= maxStrike);
    let points: GEXPoint[] = (options.scope === 'full-chain' ? allStrikes : sortedStrikes).map(toPoint);
    const allPoints = allStrikes.map(toPoint);
    totalGexValue = points.reduce((sum, point) => sum + point.totalGEX, 0);

    // 2. 结构分析逻辑
    const flipPrice = Object.prototype.hasOwnProperty.call(options, 'gammaFlipPrice') ? options.gammaFlipPrice ?? null : this.findFlipPrice(points);
    const topology = this.analyzeTopology(points, spotPrice, safEm, flipPrice, totalGexValue);

    // 标注 Wall
    let callWallPoint = points.length > 0 ? points[0] : null;
    let putWallPoint = points.length > 0 ? points[0] : null;

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const strikeData = gexMap.get(p.strike)!;
      const bestCallData = gexMap.get(callWallPoint!.strike)!;
      const bestPutData = gexMap.get(putWallPoint!.strike)!;

      if (strikeData.c_gex > bestCallData.c_gex) callWallPoint = p;
      if (strikeData.p_gex > bestPutData.p_gex) putWallPoint = p;
    }

    if (callWallPoint && !(gexMap.get(callWallPoint.strike)!.c_gex > 0)) callWallPoint = null;
    if (putWallPoint && !(gexMap.get(putWallPoint.strike)!.p_gex > 0)) putWallPoint = null;
    if (callWallPoint) callWallPoint.isCallWall = true;
    if (putWallPoint) putWallPoint.isPutWall = true;
    const analysisPointByStrike = new Map(points.map((point) => [point.strike, point]));
    for (const point of allPoints) {
      const analysisPoint = analysisPointByStrike.get(point.strike);
      if (!analysisPoint) continue;
      point.isCallWall = analysisPoint.isCallWall;
      point.isPutWall = analysisPoint.isPutWall;
      point.isGammaFlip = analysisPoint.isGammaFlip;
    }

    return {
      points,
      allPoints,
      expectedMove: safEm,
      gammaFlipPrice: flipPrice,
      callWallPrice: callWallPoint?.strike || null,
      putWallPrice: putWallPoint?.strike || null,
      pcrDeltaWeighted: totalDeltaCallOI > 0 ? totalDeltaPutOI / totalDeltaCallOI : 0,
      pcrRaw: totalRawCallOI > 0 ? totalRawPutOI / totalRawCallOI : 0,
      totalGexValue,
      topology
    };
  }

  /**
   * 带回退逻辑的计算
   */
  public static calculateWithFallback(
    calls: OptionContract[],
    puts: OptionContract[],
    spotPrice: number,
    iv: number,
    fallbackIv: number,
    dte: number
  ): GEXMetrics | null {
    const effectiveIv = iv > 0 ? iv : (fallbackIv || 0);
    if (effectiveIv <= 0) return null;
    
    return this.calculate(calls, puts, spotPrice, effectiveIv * 100, dte);
  }

  private static findFlipPrice(points: GEXPoint[]): number | null {
    if (points.length < 2) return null;
    const smoothed = points.map((p, i, arr) => {
      if (i === 0 || i === arr.length - 1) return p.totalGEX;
      return arr[i-1].totalGEX * 0.25 + p.totalGEX * 0.5 + arr[i+1].totalGEX * 0.25;
    });

    let flipPrice: number | null = null;
    let maxSlope = -1;
    let flipIdx = -1;

    for (let i = 0; i < smoothed.length - 1; i++) {
      if ((smoothed[i] <= 0 && smoothed[i+1] > 0) || (smoothed[i] >= 0 && smoothed[i+1] < 0)) {
        const strikeMid = (points[i].strike + points[i+1].strike) / 2;
        // 统一使用平滑值计算斜率
        const slope = Math.abs(smoothed[i+1] - smoothed[i]) / (points[i+1].strike - points[i].strike);
        if (slope > maxSlope) {
          maxSlope = slope;
          flipPrice = strikeMid;
          flipIdx = i;
        }
      }
    }

    if (flipIdx !== -1) {
      points.forEach(p => p.isGammaFlip = false);
      points[flipIdx].isGammaFlip = true;
    }

    return flipPrice;
  }

  private static analyzeTopology(points: GEXPoint[], spot: number, em: number, flip: number | null, totalGex: number): GEXTopology {
    // 1. Flip Position (阈值: 0.15 * EM)
    let flipPos: FlipPosition = 'ABOVE_FLIP';
    if (flip != null) {
      const threshold = em * 0.15;
      const dist = spot - flip;
      if (Math.abs(dist) < threshold) flipPos = 'NEAR_FLIP';
      else flipPos = dist > 0 ? 'ABOVE_FLIP' : 'BELOW_FLIP';
    }

    // 2. Crowding (Top 3 Strikes 占比)
    const sortedByAbsGex = [...points].sort((a, b) => Math.abs(b.totalGEX) - Math.abs(a.totalGEX));
    const totalAbsGex = points.reduce((s, p) => s + Math.abs(p.totalGEX), 0);
    const top3AbsGex = sortedByAbsGex.slice(0, 3).reduce((s, p) => s + Math.abs(p.totalGEX), 0);
    const crowdingRatio = totalAbsGex > 0 ? top3AbsGex / totalAbsGex : 0;
    let crowding: GEXCrowding = 'LOW';
    if (crowdingRatio > 0.6) crowding = 'HIGH';
    else if (crowdingRatio > 0.35) crowding = 'MEDIUM';

    // 3. Structure (分布重心与偏度)
    // 计算重心偏差
    const topGex = points.filter(p => p.strike > spot).reduce((s, p) => s + Math.abs(p.totalGEX), 0);
    const bottomGex = points.filter(p => p.strike < spot).reduce((s, p) => s + Math.abs(p.totalGEX), 0);
    
    let structure: GEXTopologyStructure = 'DISTRIBUTED';
    const totalSides = topGex + bottomGex;
    const skewRatio = totalSides > 0 ? (topGex - bottomGex) / totalSides : 0;
    
    if (crowding === 'HIGH') structure = 'CLUSTERED';
    else if (skewRatio > 0.4) structure = 'HEAVY_TOP';
    else if (skewRatio < -0.4) structure = 'HEAVY_BOTTOM';

    return {
      structure,
      flipPosition: flipPos,
      crowding,
      netGamma: totalGex >= 0 ? 'POSITIVE' : 'NEGATIVE'
    };
  }
}
