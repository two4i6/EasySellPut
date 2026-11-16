/**
 * Black-Scholes 期权定价引擎
 *
 * 支持：欧式 Call/Put 定价、Greeks、目标 delta 反推行权价、
 * Cash Secured Put 和 Put Credit Spread 完整策略定价。
 *
 * 仅含纯数学计算，无 I/O，可在客户端/服务端通用。
 */

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export interface BSInputs {
  S: number;       // 标的价格
  K: number;       // 行权价
  T: number;       // 到期时间（年）
  r: number;       // 无风险利率（年化小数，如 0.04）
  sigma: number;   // 隐含波动率（年化小数，如 0.25）
  dividendYield?: number; // 连续股息率，默认 0
  type: 'call' | 'put';
}

export interface BSGreeks {
  price: number;   // 期权价格（美元/股）
  delta: number;   // delta（put 为负）
  gamma: number;
  theta: number;   // 每日 theta（美元/股）
  vega: number;    // 每 1% IV 变动的价格变化（美元/股）
  rho: number;
}

export interface BSChainGreeks {
  delta: number;
  gamma: number;
  theta: number;
}

export interface SpreadSetup {
  shortStrike: number;
  longStrike: number;
  credit: number;        // 每股信用权利金（美元）
  creditPerContract: number; // 每张合约（× 100）
  maxRisk: number;           // 每张合约最大亏损
  returnOnRisk: string;      // 百分比字符串
  breakeven: number;
  dte: number;
  delta: number;
  thetaPerDay: number;       // 每日 theta（每张合约）
  holding: string;
}

export interface IronCondorSetup {
  putShortStrike: number;
  putLongStrike: number;
  callShortStrike: number;
  callLongStrike: number;
  credit: number;
  creditPerContract: number;
  maxRisk: number;
  returnOnRisk: string;
  breakevenLow: number;
  breakevenHigh: number;
  dte: number;
  delta: number;
  thetaPerDay: number;
  holding: string;
}

export interface CSPSetup {
  strike: number;
  premium: number;           // 每股权利金
  premiumPerContract: number;
  maxRisk: number;           // 每张合约（strike × 100 - premium）
  returnOnRisk: string;
  breakeven: number;
  dte: number;
  delta: number;
  thetaPerDay: number;
  holding: string;
}

// ─── 数学工具 ────────────────────────────────────────────────────────────────

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** 标准正态分布 PDF */
function npdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * 标准正态分布 CDF（Hart 近似，精度 ~1e-7）
 */
function ncdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 =  0.319381530;
  const a2 = -0.356563782;
  const a3 =  1.781477937;
  const a4 = -1.821255978;
  const a5 =  1.330274429;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  const cdf = 1 - npdf(x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * 标准正态分布逆 CDF（Beasley-Springer-Moro 近似）
 * 用于由目标 delta 反推 d1
 */
function ncdfinv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e+01,  2.209460984245205e+02,
    -2.759285104469687e+02,  1.383577518672690e+02,
    -3.066479806614716e+01,  2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,  1.615858368580409e+02,
    -1.556989798598866e+02,  6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,  3.224671290700398e-01,
    2.445134137142996e+00,  3.754408661907416e+00,
  ];
  const pLow  = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ─── 引擎主体 ────────────────────────────────────────────────────────────────

export class BlackScholesEngine {

  /** 计算 d1、d2 */
  private d1d2(S: number, K: number, T: number, r: number, sigma: number, q = 0): [number, number] {
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return [0, 0];
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return [d1, d2];
  }

  /** 期权链筛选和 GEX 只消费 Delta/Gamma/Theta，避免为每张合约计算价格、Vega 与 Rho。 */
  public chainGreeks(inputs: BSInputs): BSChainGreeks {
    const { S, K, T, r, sigma, type } = inputs;
    const q = inputs.dividendYield ?? 0;
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { delta: 0, gamma: 0, theta: 0 };

    const [d1, d2] = this.d1d2(S, K, T, r, sigma, q);
    const sqrtT = Math.sqrt(T);
    const discount = Math.exp(-r * T);
    const dividendDiscount = Math.exp(-q * T);
    const thetaAnnual = type === 'call'
      ? (-S * dividendDiscount * npdf(d1) * sigma / (2 * sqrtT) - r * K * discount * ncdf(d2) + q * S * dividendDiscount * ncdf(d1))
      : (-S * dividendDiscount * npdf(d1) * sigma / (2 * sqrtT) + r * K * discount * ncdf(-d2) - q * S * dividendDiscount * ncdf(-d1));

    return {
      delta: type === 'call' ? dividendDiscount * ncdf(d1) : dividendDiscount * (ncdf(d1) - 1),
      gamma: dividendDiscount * npdf(d1) / (S * sigma * sqrtT),
      theta: thetaAnnual / 365,
    };
  }

  /**
   * 完整 Black-Scholes 定价 + Greeks
   */
  public price(inputs: BSInputs): BSGreeks {
    const { S, K, T, r, sigma, type } = inputs;
    const q = inputs.dividendYield ?? 0;
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
      return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    }

    const [d1, d2] = this.d1d2(S, K, T, r, sigma, q);
    const sqrtT = Math.sqrt(T);
    const discount = Math.exp(-r * T);
    const dividendDiscount = Math.exp(-q * T);

    let optPrice: number;
    let delta: number;
    let rho: number;

    if (type === 'call') {
      optPrice = S * dividendDiscount * ncdf(d1) - K * discount * ncdf(d2);
      delta    = dividendDiscount * ncdf(d1);
      rho      = K * T * discount * ncdf(d2) / 100;
    } else {
      optPrice = K * discount * ncdf(-d2) - S * dividendDiscount * ncdf(-d1);
      delta    = dividendDiscount * (ncdf(d1) - 1);   // 负值
      rho      = -K * T * discount * ncdf(-d2) / 100;
    }

    const gamma  = dividendDiscount * npdf(d1) / (S * sigma * sqrtT);
    // theta: 每日衰减（取负号表示亏损方向）
    const thetaAnnual =
      type === 'call'
        ? (-S * dividendDiscount * npdf(d1) * sigma / (2 * sqrtT) - r * K * discount * ncdf(d2) + q * S * dividendDiscount * ncdf(d1))
        : (-S * dividendDiscount * npdf(d1) * sigma / (2 * sqrtT) + r * K * discount * ncdf(-d2) - q * S * dividendDiscount * ncdf(-d1));
    const theta = thetaAnnual / 365;

    const vega = S * dividendDiscount * npdf(d1) * sqrtT / 100; // 每 1% IV 变化

    return {
      price: Math.max(0, optPrice),
      delta,
      gamma,
      theta,
      vega,
      rho,
    };
  }

  /**
   * 由目标 delta（正数，0~1）反推行权价
   * 当 T <= 0 或输入不合法时，返回 S * 0.9 作为 Fallback 安全值。
   * @param targetDelta 0.15 表示 put delta = -0.15
   */
  public strikeFromDelta(
    S: number,
    T: number,
    r: number,
    sigma: number,
    targetDelta: number,
    type: 'call' | 'put' = 'put',
  ): number {
    if (T <= 0 || sigma <= 0 || S <= 0) return S * 0.9;

    // put delta = N(d1) - 1 = -targetDelta  →  N(d1) = 1 - targetDelta
    // call delta = N(d1) = targetDelta
    const Nd1 = type === 'put' ? 1 - targetDelta : targetDelta;
    const d1  = ncdfinv(Nd1);
    const K   = S * Math.exp(-(d1 * sigma * Math.sqrt(T) - (r + 0.5 * sigma * sigma) * T));
    return Math.round(K / 5) * 5; // 取整到最近 5 点
  }

  /**
   * Cash Secured Put 完整定价
   * @param S        标的现价
   * @param dte      到期天数
   * @param r        无风险利率（小数）
   * @param sigma    年化 IV（小数）
   * @param targetDelta 目标 delta 绝对值（如 0.15）
   */
  public priceCashSecuredPut(
    S: number,
    dte: number,
    r: number,
    sigma: number,
    targetDelta: number = 0.15,
  ): CSPSetup {
    const T = dte / 365;
    const strike = this.strikeFromDelta(S, T, r, sigma, targetDelta, 'put');
    const greeks = this.price({ S, K: strike, T, r, sigma, type: 'put' });

    const premium            = greeks.price;
    const premiumPerContract = Math.round(premium * 100);
    const maxRiskPerContract = Math.round(strike * 100 - premiumPerContract);
    const breakeven          = strike - premium;
    const ror                = premiumPerContract / maxRiskPerContract;
    const holdDays           = Math.round(dte * 0.5); // 50% profit = ~0.5 × DTE

    return {
      strike,
      premium: round2(premium),
      premiumPerContract,
      maxRisk: maxRiskPerContract,
      returnOnRisk: `${(ror * 100).toFixed(2)}%`,
      breakeven: round2(breakeven),
      dte,
      delta: round2(greeks.delta),
      thetaPerDay: round2(greeks.theta * 100),
      holding: `${holdDays} Days`,
    };
  }

  private _priceSpread(
    type: 'call' | 'put',
    S: number,
    dte: number,
    r: number,
    sigma: number,
    targetDelta: number,
    width: number
  ): SpreadSetup {
    if (width <= 0) throw new Error(`Spread width must be positive, got ${width}`);
    const T = dte / 365;
    const shortStrike = this.strikeFromDelta(S, T, r, sigma, targetDelta, type);
    const longStrike  = type === 'put' ? shortStrike - width : shortStrike + width;

    const shortGreeks = this.price({ S, K: shortStrike, T, r, sigma, type });
    const longGreeks  = this.price({ S, K: longStrike,  T, r, sigma, type });

    const creditPerShare     = shortGreeks.price - longGreeks.price;
    const creditPerContract  = Math.round(creditPerShare * 100);
    const maxRiskPerContract = Math.round((width - creditPerShare) * 100);
    const breakeven          = type === 'put' ? shortStrike - creditPerShare : shortStrike + creditPerShare;
    const ror                = creditPerContract / maxRiskPerContract;
    const thetaPerDay        = round2((shortGreeks.theta - longGreeks.theta) * 100);
    const holdDays           = Math.round(dte * 0.5);

    return {
      shortStrike,
      longStrike,
      credit: round2(creditPerShare),
      creditPerContract,
      maxRisk: maxRiskPerContract,
      returnOnRisk: `${(ror * 100).toFixed(2)}%`,
      breakeven: round2(breakeven),
      dte,
      delta: round2(shortGreeks.delta),
      thetaPerDay,
      holding: `${holdDays} Days`,
    };
  }

  /**
   * Put Credit Spread 完整定价
   * @param width  翼展点数（如 50 = 50pt spread for SPX）
   */
  public pricePutCreditSpread(
    S: number,
    dte: number,
    r: number,
    sigma: number,
    targetDelta: number = 0.15,
    width: number = 50,
  ): SpreadSetup {
    return this._priceSpread('put', S, dte, r, sigma, targetDelta, width);
  }

  public priceCallCreditSpread(
    S: number,
    dte: number,
    r: number,
    sigma: number,
    targetDelta: number = 0.15,
    width: number = 50,
  ): SpreadSetup {
    return this._priceSpread('call', S, dte, r, sigma, targetDelta, width);
  }

  public priceIronCondor(
    S: number,
    dte: number,
    r: number,
    sigma: number,
    targetDelta: number = 0.12,
    width: number = 50,
  ): IronCondorSetup {
    const putSpread = this.pricePutCreditSpread(S, dte, r, sigma, targetDelta, width);
    const callSpread = this.priceCallCreditSpread(S, dte, r, sigma, targetDelta, width);
    const totalCredit = putSpread.credit + callSpread.credit;
    const creditPerContract = putSpread.creditPerContract + callSpread.creditPerContract;
    // Iron Condor 最大亏损为最大单边宽度减去总信用金
    const maxRisk = Math.round((width - totalCredit) * 100);
    const ror = creditPerContract / maxRisk;

    return {
      putShortStrike: putSpread.shortStrike,
      putLongStrike: putSpread.longStrike,
      callShortStrike: callSpread.shortStrike,
      callLongStrike: callSpread.longStrike,
      credit: round2(totalCredit),
      creditPerContract,
      maxRisk,
      returnOnRisk: `${(ror * 100).toFixed(2)}%`,
      breakevenLow: round2(putSpread.shortStrike - totalCredit),
      breakevenHigh: round2(callSpread.shortStrike + totalCredit),
      dte,
      delta: round2(putSpread.delta + callSpread.delta),
      thetaPerDay: round2(putSpread.thetaPerDay + callSpread.thetaPerDay),
      holding: putSpread.holding,
    };
  }

  /**
   * ATM Straddle 价格（call + put，相同行权价 = 现价）
   */
  public straddlePrice(S: number, dte: number, r: number, sigma: number): number {
    const T = dte / 365;
    const call = this.price({ S, K: S, T, r, sigma, type: 'call' });
    const put  = this.price({ S, K: S, T, r, sigma, type: 'put'  });
    return call.price + put.price;
  }

  /**
   * 快速估算：仅用 VIX 和标的价格，返回目标 delta 对应的期权概览
   * 适用于没有完整市场数据时的近似计算
   */
  public quickEstimate(params: {
    S: number;
    vix: number;        // VIX 值（如 23.87）
    riskFreeRate: number; // 无风险利率（如 0.036）
    dte?: number;
    targetDelta?: number;
    strategy: 'csp' | 'pcs';
    spreadWidth?: number;
  }): SpreadSetup | CSPSetup {
    const { S, vix, riskFreeRate, dte = 45, targetDelta = 0.15, strategy, spreadWidth = 50 } = params;
    const sigma = vix / 100;

    if (strategy === 'csp') {
      return this.priceCashSecuredPut(S, dte, riskFreeRate, sigma, targetDelta);
    } else {
      return this.pricePutCreditSpread(S, dte, riskFreeRate, sigma, targetDelta, spreadWidth);
    }
  }
}

export const blackScholesEngine = new BlackScholesEngine();
