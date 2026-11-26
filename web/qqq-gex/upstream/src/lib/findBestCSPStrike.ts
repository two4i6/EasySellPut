import { IVPoint, OptionContract } from '../types/ivCurve';
import { calculateCSPAPR } from './apr';
import { type CSPSettings, DEFAULT_CSP_SETTINGS } from '../store/useCSPStore';
import { resolveOptionQuote, type ResolvedOptionQuote, type OptionQuoteSource } from './optionQuote';

export interface SmileModel {
  evaluate(K: number): number;
  atmVol: number;
  curvature: number;   // ∂²σ/∂k² at k=0, vol-of-vol proxy
  skewSlope: number;   // ∂σ/∂k at k=0, negative = normal put skew
  valid: boolean;
}

export interface IVSurface {
  evaluate(K: number, T: number): number; // σ(K,T) via cross-expiration interpolation
  xi: number;       // vol-of-vol, annualized (e.g. 0.8 = 80%)
  rho: number;      // skew-vol correlation, typically negative
  lambda_v: number; // vol risk price = VRP / max(xi, 0.1)
}

export interface CSPStrikeResult {
  strike: number;
  expiry: string;
  dte: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  premiumPrice: number;
  breakeven: number;
  lastPrice?: number | null;
  quoteSource: OptionQuoteSource;
  quoteAsOf: number | null;
  quoteHaircut: number;
  iv: number;
  delta: number;
  theta?: number;
  openInterest?: number;
  volume?: number;

  // New decision metrics
  expectedReturn: number;
  executionCost: number;
  cvar: number;
  rm: number;
  rv: number;
  rr: number;
  netScore: number;

  // Legacy for screener compatibility
  apr: number;
  distancePct: number;
  smileVol: number;
  vrp: number;
  svAdjFactor: number;
  winProb: number;
  conditionalLoss: number;
  xi: number;
  rho: number;
  rawScore: number;

  // New Tooltip Reasoning
  breakdown?: {
    rar: number;
    deltaPreference: number;
    strikeBonus: number;
    reliability: number;
  };
}

export interface DTERange {
  min: number;
  max: number;
  label: string;
}

export const DTE_RANGES: DTERange[] = [
  { min: 0,  max: 1,  label: '0-1'   },
  { min: 1,  max: 7,  label: '1-7'   },
  { min: 7,  max: 14, label: '7-14'  },
  { min: 14, max: 21, label: '14-21' },
  { min: 21, max: 35, label: '21-35' },
  { min: 35, max: 50, label: '35-50' },
  { min: 50, max: 70, label: '50-70' },
];

// --- Math utils ---

function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function blackScholesPut(S: number, K: number, T: number, sigma: number, r: number) {
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const N_neg_d1 = normCDF(-d1);
  const N_neg_d2 = normCDF(-d2);
  const putValue = K * Math.exp(-r * T) * N_neg_d2 - S * N_neg_d1;
  return { putValue, d1, d2, N_neg_d1, N_neg_d2 };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function passesLiquidityFilter(put: OptionContract, currentPrice: number, settings: CSPSettings): boolean {
  if (put.strike >= currentPrice) return false;
  if (put.inTheMoney) return false;
  const quote = resolveOptionQuote(put, settings.maxSpreadPct);
  if (!quote || quote.sell < settings.minBid) return false;

  if (put.delta === undefined) return false;
  if (put.delta > settings.maxDelta || put.delta < settings.minDelta) return false;
  return true;
}

// --- Smile fitting (per-expiration, unchanged) ---

export function fitSmile(point: IVPoint, currentPrice: number): SmileModel {
  const S = currentPrice;
  const T = Math.max(point.daysToExpiration, 1) / 365;
  const puts = point.contracts?.puts ?? [];

  const data: { k: number; w: number; weight: number }[] = [];
  for (const p of puts) {
    if (p.strike <= 0 || p.iv <= 0.01 || p.iv > 3.0) continue;
    if ((p.openInterest ?? 0) < 10) continue;
    const quote = resolveOptionQuote(p);
    if (!quote) continue;
    const spread = quote.source === 'market' ? (quote.ask! - quote.bid!) / quote.mid : quote.haircut * 2;
    if (spread > 0.5) continue;
    data.push({
      k: Math.log(p.strike / S),
      w: p.iv * p.iv * T,
      weight: Math.sqrt(p.openInterest ?? 1) / (spread + 0.01)
    });
  }

  const fallback: SmileModel = {
    evaluate: () => point.atmIV,
    atmVol: point.atmIV,
    curvature: 0,
    skewSlope: 0,
    valid: false,
  };
  if (data.length < 4) return fallback;

  let S0=0, S1=0, S2=0, S3=0, S4=0, Y0=0, Y1=0, Y2=0;
  for (const d of data) {
    const { k, w, weight: wt } = d;
    S0 += wt; S1 += wt*k; S2 += wt*k*k; S3 += wt*k*k*k; S4 += wt*k*k*k*k;
    Y0 += wt*w; Y1 += wt*k*w; Y2 += wt*k*k*w;
  }

  const M = [[S0,S1,S2],[S1,S2,S3],[S2,S3,S4]];
  const det = (
    M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) -
    M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) +
    M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0])
  );
  if (Math.abs(det) < 1e-12) return fallback;

  const inv = [
    [(M[1][1]*M[2][2]-M[1][2]*M[2][1])/det, (M[0][2]*M[2][1]-M[0][1]*M[2][2])/det, (M[0][1]*M[1][2]-M[0][2]*M[1][1])/det],
    [(M[1][2]*M[2][0]-M[1][0]*M[2][2])/det, (M[0][0]*M[2][2]-M[0][2]*M[2][0])/det, (M[0][2]*M[1][0]-M[0][0]*M[1][2])/det],
    [(M[1][0]*M[2][1]-M[1][1]*M[2][0])/det, (M[0][1]*M[2][0]-M[0][0]*M[2][1])/det, (M[0][0]*M[1][1]-M[0][1]*M[1][0])/det],
  ];
  const Y = [Y0, Y1, Y2];
  const a = inv[0][0]*Y[0] + inv[0][1]*Y[1] + inv[0][2]*Y[2];
  const b = inv[1][0]*Y[0] + inv[1][1]*Y[1] + inv[1][2]*Y[2];
  const c = inv[2][0]*Y[0] + inv[2][1]*Y[1] + inv[2][2]*Y[2];

  const evaluate = (K: number): number => {
    const k = Math.log(Math.max(K, 0.01) / S);
    const w_K = a + b * k + c * k * k;
    return Math.max(0.01, Math.min(Math.sqrt(Math.max(w_K / T, 0.0001)), 5.0));
  };

  return {
    evaluate,
    atmVol: evaluate(S),
    curvature: 2 * c / T,
    skewSlope: b / (T * evaluate(S) + 1e-9),
    valid: true,
  };
}

// --- VRP estimation (unchanged) ---

export function estimateVRP(points: IVPoint[], hv30 = 0): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.daysToExpiration - b.daysToExpiration);

  let atm30 = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1];
    if (lo.daysToExpiration <= 30 && hi.daysToExpiration >= 30) {
      const t = (30 - lo.daysToExpiration) / (hi.daysToExpiration - lo.daysToExpiration);
      atm30 = lo.atmIV + t * (hi.atmIV - lo.atmIV);
      break;
    }
  }
  if (atm30 === 0) atm30 = sorted[0].atmIV;

  if (hv30 > 0) return atm30 - hv30;

  const short = sorted.filter(p => p.daysToExpiration <= 30).map(p => p.atmIV);
  const long  = sorted.filter(p => p.daysToExpiration > 30).map(p => p.atmIV);
  if (short.length === 0 || long.length === 0) return 0;
  return short.reduce((s, v) => s + v, 0) / short.length -
         long.reduce((s, v) => s + v, 0) / long.length;
}

// --- IV Surface: aggregates per-expiration smiles, extracts SV params ---

export function buildIVSurface(
  points: IVPoint[],
  currentPrice: number,
  vrp: number
): IVSurface {
  // Fit smile per expiration, keep only valid ones
  const smiles: Array<{ dte: number; T: number; smile: SmileModel }> = [];
  for (const point of points) {
    const smile = fitSmile(point, currentPrice);
    if (smile.valid) {
      smiles.push({ dte: point.daysToExpiration, T: point.daysToExpiration / 365, smile });
    }
  }

  // Sort by DTE ascending
  smiles.sort((a, b) => a.dte - b.dte);

  // Calibrate ξ (vol-of-vol) from per-T curvature
  // Heston approx: curvature(T) = 2c/T ≈ ξ²/2 → ξ ≈ sqrt(2 × curvature)
  const xiArr = smiles
    .map(s => 2 * Math.sqrt(Math.max(0, s.smile.curvature)))
    .filter(v => v > 0);
  const xi = Math.min(Math.max(xiArr.length > 0 ? median(xiArr) : 0.5, 0.1), 3.0);

  // Calibrate ρ from skew slope
  // Heston: skewSlope ≈ ρ × ξ / (2 × atmVol)
  // → ρ ≈ skewSlope × 2 × atmVol / ξ
  const rhoArr = smiles
    .map(s => s.smile.skewSlope * 2 * s.smile.atmVol / xi)
    .filter(v => isFinite(v));
  const rho = Math.min(Math.max(rhoArr.length > 0 ? median(rhoArr) : -0.5, -0.99), 0);

  // Vol risk price from VRP / ξ
  const lambda_v = Math.min(Math.max(vrp / xi, -2), 2);

  // Surface evaluate: bilinear interpolation in vol space across DTE
  const evaluate = (K: number, T: number): number => {
    if (smiles.length === 0) return 0.25; // fallback

    // Extrapolate below/above range
    if (smiles.length === 1 || T <= smiles[0].T) return smiles[0].smile.evaluate(K);
    if (T >= smiles[smiles.length - 1].T) return smiles[smiles.length - 1].smile.evaluate(K);

    // Find bracketing smiles
    let lo = smiles[0], hi = smiles[smiles.length - 1];
    for (let i = 0; i < smiles.length - 1; i++) {
      if (smiles[i].T <= T && smiles[i + 1].T >= T) {
        lo = smiles[i];
        hi = smiles[i + 1];
        break;
      }
    }

    const t = (T - lo.T) / (hi.T - lo.T);
    const sigma_lo = lo.smile.evaluate(K);
    const sigma_hi = hi.smile.evaluate(K);
    return sigma_lo + t * (sigma_hi - sigma_lo);
  };

  return { evaluate, xi, rho, lambda_v };
}

// --- Strike scoring under real-world P-measure ---

interface StrikeScoreResult {
  expectedReturn: number;
  executionCost: number;
  cvar: number;
  rm: number;
  rv: number;
  rr: number;
  netScore: number;
  // Legacy for screener
  winProb: number;
  conditionalLoss: number;
  apr: number;
  rawScore: number;
  svAdjFactor: number;
  smileVol: number;
  vrp: number;
  
  // Scoring Breakdown for Tooltips
  breakdown: {
    rar: number;             // Risk Adjusted Return ratio
    deltaPreference: number; // 0-1
    strikeBonus: number;     // 1.0-1.05
    reliability: number;     // e^-M
  };
}

function scoreStrike(
  put: import('../types/ivCurve').OptionContract,
  dte: number,
  currentPrice: number,
  surface: import('./findBestCSPStrike').IVSurface,
  vrp: number,
  quote: ResolvedOptionQuote,
  settings: CSPSettings = DEFAULT_CSP_SETTINGS
): StrikeScoreResult {
  const S   = currentPrice;
  const K   = put.strike;
  const T   = Math.max(dte, 1) / 365;
  const mid = quote.sell;
  const sqrt_T = Math.sqrt(T);

  // Step 1: σ(K,T) from unified surface
  const sigma_K = surface.evaluate(K, T);

  // Step 2: Risk-neutral BS
  const bs_Q = blackScholesPut(S, K, T, sigma_K, settings.riskFreeRate);

  // Step 3: Fundamental Regime-Switching Model (P-Measure Generative Model)
  // We model the real-world P-measure distribution as a mixture of two fundamental regimes.
  // IV and VRP are observable consequences of this structural risk, not inputs to the probability.
  
  // Baseline P-measure volatility (approximate from ATM IV stripped of volatility risk premium)
  const atmIV = surface.evaluate(S, T);
  const sigma_base = Math.max(atmIV - vrp, 0.10);
  
  // P-measure probability of a stress event (fat tail prior)
  // Base chance of crash, slightly elevated if market skew (xi) is structurally high
  const p_stress = settings.stressProbability + Math.max(0, surface.xi - 1.0) * 0.05;
  const p_normal = 1 - p_stress;

  // --- State 1: Normal Regime ---
  const sigma_normal = sigma_base;
  const drift_normal = settings.equityPremium; // e.g., 0.06
  
  const d1_normal = (Math.log(S / K) + (drift_normal + 0.5 * sigma_normal * sigma_normal) * T) / (sigma_normal * sqrt_T);
  const d2_normal = d1_normal - sigma_normal * sqrt_T;
  const lossProb_normal = normCDF(-d2_normal);
  // Present value of P-measure expected payoff
  const pvPayoff_normal = Math.exp(-settings.riskFreeRate * T) * (K * lossProb_normal - S * Math.exp(drift_normal * T) * normCDF(-d1_normal));

  // --- State 2: Stressed Regime (Crash) ---
  const sigma_stress = sigma_base * 1.5 + 0.15; // Volatility spike
  const drift_stress = -0.30; // 30% annualized crash drift
  
  const d1_stress = (Math.log(S / K) + (drift_stress + 0.5 * sigma_stress * sigma_stress) * T) / (sigma_stress * sqrt_T);
  const d2_stress = d1_stress - sigma_stress * sqrt_T;
  const lossProb_stress = normCDF(-d2_stress);
  const pvPayoff_stress = Math.exp(-settings.riskFreeRate * T) * (K * lossProb_stress - S * Math.exp(drift_stress * T) * normCDF(-d1_stress));

  // Step 4: Posterior Distribution Fusion (Generative PnL Distribution)
  const lossProb_P = p_normal * lossProb_normal + p_stress * lossProb_stress;
  const expectedPayoff_P = p_normal * pvPayoff_normal + p_stress * pvPayoff_stress;
  const winProb_P  = 1 - lossProb_P;

  // Step 5: Tail Risk (CVaR)
  // The mixture model explicitly generates the fat tail. Base conditional loss is sufficient.
  const baseConditionalLoss = lossProb_P > 1e-6 ? expectedPayoff_P / lossProb_P : Math.max(K - S * 0.99, 0.01);
  const cvar = baseConditionalLoss;

  // Step 6: Expected Net Return
  const expectedReturn = mid - expectedPayoff_P;

  // Step 7: Execution Cost & Information Reliability (Orthogonalization)
  const spread = quote.source === 'market' ? quote.ask! - quote.bid! : 0;
  const executionCost = quote.source === 'market' ? spread / 2 : 0;
  const edge = expectedReturn - executionCost;

  // Microstructure risk penalty (M) - The ONLY exogenous uncertainty discount
  const spreadPct = quote.source === 'market' ? spread / quote.mid : quote.haircut * 2;
  const alpha_m = settings.spreadPenalty; // e.g. 2.0
  const M = alpha_m * spreadPct;

  // Total reliability discount factor (Pure Microstructure Information Loss)
  const reliability = Math.exp(-M);

  // For UI tracking/diagnostics
  const rm = reliability;
  const rv = p_normal; 
  const rr = p_stress; 

  // Step 8: Ratio-based Risk-Adjusted Return & Constraints
  const GAMMA_OFFSET = 0.02; // 平滑常量防止除零

  // 1. Risk Normalization (cvarNorm)
  const cvarNorm = cvar / S;

  // 2. 比率型风险收益核心 (Risk-Adjusted Return Ratio)
  const riskAdjustedReturn = (edge / (cvarNorm + GAMMA_OFFSET)) * reliability;

  // 3. Delta 次级偏好函数 (Delta Preference - Quadratic Decay)
  const targetDelta = settings.targetDelta || -0.20;
  const deltaDiff = Math.abs((put.delta || 0) - targetDelta);
  const deltaBand = settings.deltaBand ?? 0.10; 
  const deltaPenaltyAlpha = settings.deltaPenaltyAlpha ?? 0.15;
  const deltaPreference = 1 - deltaPenaltyAlpha * Math.pow(deltaDiff / deltaBand, 2);

  // 4. 执行价聚类平滑 (Strike Clustering Bonus)
  let strikeBonus = 1.00;
  if (K % 5 === 0) strikeBonus = settings.strikeBonusFive ?? 1.05;
  else if (K % 1 === 0) strikeBonus = settings.strikeBonusInteger ?? 1.02;

  // 5. 最终效用函数 (Final Utility)
  // 仅在 RAR 为正时应用偏好加权，避免负分被缩小
  const netScore = riskAdjustedReturn > 0 
    ? riskAdjustedReturn * deltaPreference * strikeBonus
    : riskAdjustedReturn;

  // Legacy metrics for UI / Screener backward compatibility
  const rawScore = cvar > 0 ? expectedReturn / cvar : -1;
  const apr = calculateCSPAPR(mid, K, Math.max(dte, 1));

  return {
    expectedReturn, executionCost, cvar, rm, rv, rr, netScore,
    winProb: winProb_P, conditionalLoss: cvar, apr, rawScore,
    svAdjFactor: 1.0, smileVol: sigma_K, vrp,
    breakdown: {
      rar: riskAdjustedReturn,
      deltaPreference,
      strikeBonus,
      reliability
    }
  };
}

// --- Public API ---

export interface CSPConstraints {
  dteRange: import('./findBestCSPStrike').DTERange;
  maxStrikeMap?: Record<number, number>; // DTE -> effectiveLower
  cvarLimit?: number; // Account-level max CVaR limit
  /** 只供测试/排障：记录每个候选在各轮筛选中的去留，不参与选约。 */
  diagnostics?: CSPCandidateDiagnostic[];
  /** 只供诊断显示的 30D 全局下界，不参与选约。 */
  globalLower?: number;
}

export interface CSPCandidateDiagnostic {
  expiry: string;
  dte: number;
  attempt: number;
  strike: number;
  delta: number | null;
  effectiveLower: number;
  globalLower: number | null;
  iv: number;
  netScore: number | null;
  status: 'eligible' | 'winner' | 'rejected';
  reason: string;
}

/**
 * Global API for screener, retaining backwards compatibility but using new scoring under the hood.
 */
export function findBestCSPStrike(
  points: import('../types/ivCurve').IVPoint[],
  dteRange: import('./findBestCSPStrike').DTERange,
  currentPrice: number,
  hv30 = 0,
  settings: CSPSettings = DEFAULT_CSP_SETTINGS
): CSPStrikeResult | null {
  const result = getExpiryBestCSPStrikes(points, currentPrice, { dteRange }, hv30, settings);
  let best: CSPStrikeResult | null = null;
  for (const exp of Object.values(result)) {
    if (!best || exp.netScore > best.netScore) {
      best = exp;
    }
  }
  return best;
}

/**
 * 纯数学截面极值引擎 (Independent Cross-Sectional Optimization)
 * 绝对禁止跨期依赖、锚点或平滑。
 */
export function getExpiryBestCSPStrikes(
  points: import('../types/ivCurve').IVPoint[],
  currentPrice: number,
  constraints: CSPConstraints,
  hv30 = 0,
  settings: CSPSettings = DEFAULT_CSP_SETTINGS
): Record<string, CSPStrikeResult> {
  const { dteRange, maxStrikeMap, cvarLimit } = constraints;
  const result: Record<string, CSPStrikeResult> = {};

  const filtered = points.filter(
    p => p.daysToExpiration >= dteRange.min && p.daysToExpiration <= dteRange.max
  );
  if (!filtered.length) return result;

  const vrp     = estimateVRP(points, hv30);
  const surface = buildIVSurface(filtered, currentPrice, vrp);

  // 市场状态感知 (Regime Awareness)
  // 基于 VRP (Volatility Risk Premium) 简单判定恐慌程度
  const isPanic = vrp > 0.10; // VRP > 10% 视为极端恐慌
  const baseTargetDelta = settings.targetDelta || -0.20;
  
  // 恐慌时收紧 Delta 并下移目标
  const targetDelta = isPanic ? Math.max(baseTargetDelta + 0.05, -0.12) : baseTargetDelta;
  const baseDeltaBand = isPanic ? 0.05 : 0.08;
  const maxCVaRNorm = isPanic ? 0.08 : 0.12; // 恐慌时下调最大风险上限

  for (const point of filtered) {
  const dte = point.daysToExpiration;
  const maxStrike = maxStrikeMap ? (maxStrikeMap[dte] ?? Infinity) : Infinity;

  let bestForExpiry: CSPStrikeResult | null = null;
  let candidates: Array<{ put: OptionContract; quote: ResolvedOptionQuote; score: StrikeScoreResult }> = [];
  let selectedAttempt: number | null = null;

  // 只允许一次有限放宽；再放宽会把约 -0.05 的远 OTM 合约伪装成目标 -0.20 候选。
  for (let attempt = 0; attempt < 2; attempt++) {
    const currentDeltaBand = baseDeltaBand * Math.pow(1.5, attempt);
    const currentMaxCVaRNorm = maxCVaRNorm * Math.pow(1.5, attempt);

    // 仅测试/排障路径；与下方生产筛选使用相同条件，且结果不回写策略输入。
    if (constraints.diagnostics) for (const put of point.contracts?.puts ?? []) {
      const diagnostic = (reason: string, score?: StrikeScoreResult) => constraints.diagnostics!.push({
        expiry: point.expiration, dte, attempt, strike: put.strike, delta: put.delta ?? null,
        effectiveLower: maxStrike, globalLower: constraints.globalLower ?? null, iv: put.iv,
        netScore: score?.netScore ?? null, status: reason === 'eligible' ? 'eligible' : 'rejected', reason,
      });
      if (put.strike >= currentPrice) { diagnostic('strike_not_otm'); continue; }
      if (put.inTheMoney) { diagnostic('in_the_money'); continue; }
      const quote = resolveOptionQuote(put, settings.maxSpreadPct);
      if (!quote) { diagnostic('quote_unusable'); continue; }
      if (quote.sell < settings.minBid) { diagnostic('bid_below_minimum'); continue; }
      if (put.delta === undefined) { diagnostic('delta_missing'); continue; }
      if (put.delta > settings.maxDelta || put.delta < settings.minDelta) { diagnostic('outside_global_delta_range'); continue; }
      if (put.strike > maxStrike) { diagnostic('above_effective_lower'); continue; }
      if (Math.abs(put.delta - targetDelta) > currentDeltaBand) { diagnostic('outside_attempt_delta_band'); continue; }
      const score = scoreStrike(put, dte, currentPrice, surface, vrp, quote, settings);
      if (cvarLimit !== undefined && score.cvar > cvarLimit) { diagnostic('above_account_cvar_limit', score); continue; }
      if (score.cvar / currentPrice > currentMaxCVaRNorm) { diagnostic('above_attempt_cvar_limit', score); continue; }
      diagnostic('eligible', score);
    }

    candidates = (point.contracts?.puts ?? [])
      .filter(put => {
        if (!passesLiquidityFilter(put, currentPrice, settings)) return false;
        if (put.strike > maxStrike) return false;

        // Delta 硬约束
        const deltaDiff = Math.abs((put.delta || 0) - targetDelta);
        if (deltaDiff > currentDeltaBand) return false;

        return true;
      })
      .map(put => {
        const quote = resolveOptionQuote(put, settings.maxSpreadPct)!;
        const score = scoreStrike(put, dte, currentPrice, surface, vrp, quote, settings);
        return { put, quote, score };
      })
      .filter(item => {
        // CVaR Limit Check
        if (cvarLimit !== undefined && item.score.cvar > cvarLimit) return false;

        // 风险上限硬约束 (CVaR / S)
        if (item.score.cvar / currentPrice > currentMaxCVaRNorm) return false;

        return true;
      });
      if (candidates.length > 0) {
        selectedAttempt = attempt;
        break;
      }
    }

    if (candidates.length > 0) {
      // 在候选集中选取最高分
      candidates.sort((a, b) => b.score.netScore - a.score.netScore);
      const { put, quote, score } = candidates[0];
      const winner = constraints.diagnostics?.findLast(row =>
        row.expiry === point.expiration && row.attempt === selectedAttempt && row.strike === put.strike && row.status === 'eligible'
      );
      if (winner) winner.status = 'winner';
      
      bestForExpiry = {
        strike:          put.strike,
        expiry:          point.expiration,
        dte,
        bid:             put.bid,
        ask:             put.ask,
        mid:             quote.source === 'market' ? quote.mid : null,
        premiumPrice:    quote.sell,
        breakeven:       put.strike - quote.sell,
        lastPrice:       put.lastPrice,
        quoteSource:     quote.source,
        quoteAsOf:       quote.asOf,
        quoteHaircut:    quote.haircut,
        iv:              put.iv,
        delta:           put.delta!,
        theta:           put.theta,
        openInterest:    put.openInterest,
        volume:          put.volume,
        expectedReturn:  score.expectedReturn,
        executionCost:   score.executionCost,
        cvar:            score.cvar,
        rm:              score.rm,
        rv:              score.rv,
        rr:              score.rr,
        netScore:        score.netScore,
        // Legacy
        distancePct:     ((currentPrice - put.strike) / currentPrice) * 100,
        apr:             score.apr,
        smileVol:        score.smileVol,
        vrp:             score.vrp,
        svAdjFactor:     score.svAdjFactor,
        winProb:         score.winProb,
        conditionalLoss: score.conditionalLoss,
        xi:              surface.xi,
        rho:             surface.rho,
        rawScore:        score.rawScore,
        breakdown:       score.breakdown,
      };
    }
    
    if (bestForExpiry) {
      result[point.expiration] = bestForExpiry;
    }
  }

  return result;
}

export function getAllCSPStrikes(
  points: import('../types/ivCurve').IVPoint[],
  dteRange: import('./findBestCSPStrike').DTERange,
  currentPrice: number,
  hv30 = 0,
  settings: CSPSettings = DEFAULT_CSP_SETTINGS
): Array<{ expiry: string; dte: number; strikes: CSPStrikeResult[] }> {
  const filtered = points.filter(
    p => p.daysToExpiration >= dteRange.min && p.daysToExpiration <= dteRange.max
  );
  if (!filtered.length) return [];

  const vrp     = estimateVRP(points, hv30);
  const surface = buildIVSurface(filtered, currentPrice, vrp);

  return filtered.map(point => {
    const dte    = point.daysToExpiration;
    const puts   = point.contracts?.puts ?? [];
    const strikes = puts
      .filter(p => passesLiquidityFilter(p, currentPrice, settings))
      .map(p => {
        const quote = resolveOptionQuote(p, settings.maxSpreadPct)!;
        const score = scoreStrike(p, dte, currentPrice, surface, vrp, quote, settings);
        return {
          strike:          p.strike,
          expiry:          point.expiration,
          dte,
          bid:             p.bid,
          ask:             p.ask,
          mid:             quote.source === 'market' ? quote.mid : null,
          premiumPrice:    quote.sell,
          breakeven:       p.strike - quote.sell,
          lastPrice:       p.lastPrice,
          quoteSource:     quote.source,
          quoteAsOf:       quote.asOf,
          quoteHaircut:    quote.haircut,
          iv:              p.iv,
          delta:           p.delta!,
          theta:           p.theta,
          openInterest:    p.openInterest,
          volume:          p.volume,
          expectedReturn:  score.expectedReturn,
          executionCost:   score.executionCost,
          cvar:            score.cvar,
          rm:              score.rm,
          rv:              score.rv,
          rr:              score.rr,
          netScore:        score.netScore,
          distancePct:     ((currentPrice - p.strike) / currentPrice) * 100,
          apr:             score.apr,
          smileVol:        score.smileVol,
          vrp:             score.vrp,
          svAdjFactor:     score.svAdjFactor,
          winProb:         score.winProb,
          conditionalLoss: score.conditionalLoss,
          xi:              surface.xi,
          rho:             surface.rho,
          rawScore:        score.rawScore,
          breakdown:       score.breakdown,
        };
      })
      .sort((a, b) => b.netScore - a.netScore); // Sort by netScore

    return { expiry: point.expiration, dte: point.daysToExpiration, strikes };
  }).filter(e => e.strikes.length > 0);
}
