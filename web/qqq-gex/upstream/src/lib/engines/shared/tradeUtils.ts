import { PRICE_PROXIMITY, DTE, DELTA } from './constants';

/** 判断是否 ITM (Short Put 视域: currentPrice < strike 为 ITM) */
export function isITM(currentPrice: number, strike: number): boolean {
  return currentPrice < strike;
}

/** 判断是否接近 ITM（默认 2%） */
export function isNearITM(currentPrice: number, strike: number, pct = PRICE_PROXIMITY.NEAR_ITM): boolean {
  return currentPrice < strike * (1 + pct);
}

/** 盈利比率（结果是 0-1 小数） */
export function calcProfitRatio(pnl: number, totalPremium: number): number {
  if (totalPremium === 0) return 0;
  return pnl / totalPremium;
}

/** DTE 风险等级 */
export function getDTERiskLevel(dte: number): 'critical' | 'warning' | 'medium' | 'normal' {
  if (dte <= DTE.CRITICAL) return 'critical';
  if (dte <= DTE.WARNING) return 'warning';
  if (dte <= DTE.MEDIUM) return 'medium';
  return 'normal';
}

/** Delta 风险等级 */
export function getDeltaRiskLevel(absDelta: number): 'critical' | 'warning' | 'watch' | 'normal' {
  if (absDelta >= DELTA.HIGH_RISK) return 'critical';  // >= 0.45: CSP 高风险预警
  if (absDelta >= DELTA.EXECUTION) return 'warning';  // >= 0.40: 执行/换仓警告
  if (absDelta >= DELTA.WATCH) return 'watch';        // >= 0.30: 中等风险监控
  return 'normal';
}
