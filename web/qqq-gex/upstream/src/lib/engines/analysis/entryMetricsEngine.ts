import { FactorMap } from '../../../types/factor';
import { EntryMetrics, MarketSnapshot } from '../../../types/strategy';
import { blackScholesEngine } from '../pricing/BlackScholesEngine';
import { getFactorValue as getFV } from '../../factor';

/**
 * 从 FactorMap 创建市场快照
 */
export function createMarketSnapshot(factors: FactorMap): MarketSnapshot {
  const now = new Date().toISOString();
  const price = getFV<number>(factors, 'underlying_price') ?? 0;

  return {
    underlyingPrice: price,
    ma7: getFV<number>(factors, 'ma7'),
    ma30: getFV<number>(factors, 'ma30'),
    ma200: getFV<number>(factors, 'ma200'),
    hv20: getFV<number>(factors, 'hv_20'),
    ivAtm: getFV<number>(factors, 'iv_atm') ?? getFV<number>(factors, 'maxATMIV'),
    ivScore: getFV<number>(factors, 'iv_score') ?? getFV<number>(factors, 'iv_percentile'),
    ivRank: getFV<number>(factors, 'iv_rank'),
    vix: getFV<number>(factors, 'vix_price'),
    vixTerm: getFV<number>(factors, 'vix_term_ratio'),
    rsi: getFV<number>(factors, 'rsi') ?? getFV<number>(factors, 'rsi_14'),
    rsi7: getFV<number>(factors, 'rsi_7'),
    rsi21: getFV<number>(factors, 'rsi_21'),
    macdMomentumStrength: getFV<number>(factors, 'macd_momentum_strength'),
    kcUpper: getFV<number>(factors, 'kc_upper'),
    kcLower: getFV<number>(factors, 'kc_lower'),
    kcMiddle: getFV<number>(factors, 'kc_middle'),
    atr: getFV<number>(factors, 'atr'),
    macd: getFV<number>(factors, 'macd_line') !== undefined && getFV<number>(factors, 'macd_signal') !== undefined
      ? {
          line:      getFV<number>(factors, 'macd_line')!,
          signal:    getFV<number>(factors, 'macd_signal')!,
          histogram: getFV<number>(factors, 'macd_histogram') ?? 0,
        }
      : undefined,
    bbWidth: getFV<number>(factors, 'bb_width'),
    trend: getFV<string>(factors, 'trend_label'),
    regime: getFV<number>(factors, 'regime_score')?.toString() ?? '50',
    timestamp: now,
  };
}

/**
 * 计算开仓时的关键指标快照
 */
export function computeEntryMetrics(
  strike: number,
  premium: number,
  openDate: string,
  expDate: string,
  factors: FactorMap
): EntryMetrics {
  const underlyingPrice = getFV<number>(factors, 'underlying_price') ?? 0;
  
  // 1. DTE 精确计算 (美东时间 16:00 到期)
  // 获取美东时间的 offset (北京时间是 +8, 美东是 -5/-4)
  // 为简化，直接通过字符串构造 ISO 格式来锁定时间
  const getTimestamp = (dateStr: string, timeStr: string) => {
    // 假设服务器/客户端环境处理 "-05:00" 为美东标准时间
    // 虽然不完美（没处理 DST），但在 DTE 计算中误差极小（1/24天以内）
    return new Date(`${dateStr}T${timeStr}:00-05:00`).getTime();
  };

  const expiryTs = getTimestamp(expDate, "16:00");
  const todayStr = new Date().toISOString().split('T')[0];
  
  // 如果是今天开仓，使用当前实时时间；否则使用开盘时间 09:30
  const startTs = (openDate === todayStr) 
    ? Date.now() 
    : getTimestamp(openDate, "09:30");

  let dte = (expiryTs - startTs) / 86400000;
  
  if (dte < 1 && dte > 0) {
    // 不足 1 天，保留两位小数 (体现小时计算)
    dte = Math.round(dte * 100) / 100;
  } else {
    // 超过 1 天，向上取整
    dte = Math.max(0.01, Math.ceil(dte));
  }
  
  // 2. IV ATM (小数形式，如 0.25)
  const ivAtm = getFV<number>(factors, 'iv_atm') ?? getFV<number>(factors, 'maxATMIV');
  
  // 3. OTM% (正值 = OTM，负值 = ITM)
  const otmPct = underlyingPrice > 0 ? (strike - underlyingPrice) / underlyingPrice : undefined;
  
  // 8. Distance to Strike
  const distanceToStrike = underlyingPrice > 0 ? underlyingPrice - strike : undefined;
  
  // 9. Delta 计算：优先使用 Black-Scholes 精确值，fallback 使用修正线性近似
  let delta: number | undefined = undefined;
  if (ivAtm && dte && underlyingPrice > 0 && strike > 0) {
    // BS 精确计算：put delta 为负值，取绝对值作为 CSP 展示惯例
    const bs = blackScholesEngine.price({
      S: underlyingPrice,
      K: strike,
      T: dte / 365,
      r: 0.04,
      sigma: ivAtm,
      type: 'put',
    });
    delta = Math.abs(bs.delta);
  } else if (otmPct !== undefined) {
    // Fallback 线性近似（无 IV 时）
    // otmPct 对 OTM put 为负值，delta 应随距离增大而减小
    // 0% OTM → 0.5；4% OTM → 0.30；10% OTM → 0.01（接近 0）
    delta = Math.max(0.01, Math.min(0.49, 0.5 + otmPct * 5));
  }
  
  // 10. Prob ITM / OTM
  const probITM = delta;
  const probOTM = delta !== undefined ? 1 - delta : undefined;
  
  // 12. Expected Move
  const expectedMove = (ivAtm && dte && underlyingPrice > 0) 
    ? underlyingPrice * ivAtm * Math.sqrt(dte / 365) 
    : undefined;
    
  // 13. Premium Yield
  const premiumYield = strike > 0 ? premium / strike : undefined;
  
  // 14. Risk/Reward Ratio
  const riskRewardRatio = (distanceToStrike !== undefined && distanceToStrike > 0) 
    ? premium / distanceToStrike 
    : undefined;

  return {
    delta,
    dte,
    otmPct,
    probITM,
    probOTM,
    expectedMove,
    premiumYield,
    riskRewardRatio,
    distanceToStrike,
  };
}
