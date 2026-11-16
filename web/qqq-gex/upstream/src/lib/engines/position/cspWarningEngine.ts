import { StrategyWithLegs, TradeWarning, PriceData } from "../../../types/strategy";
import { FactorMap } from "../../../types/factor";
import { calculateOptionGreeks, calculateDTE } from "../../../utils/calculations";
import { CSPTradeAdapter } from "../../../types/csp";
import { isITM, isNearITM, calcProfitRatio, getDTERiskLevel, getDeltaRiskLevel } from "../shared/tradeUtils";
import { DTE, DELTA, PROFIT, IV_EXPANSION } from "../shared/constants";

/**
 * CSP 风险预警引擎
 * 用于实时计算交易风险提示
 */
export function computeWarnings(
  trade: CSPTradeAdapter,
  currentPrice: number,
  currentFactors?: FactorMap | PriceData
): TradeWarning[] {
  const warnings: TradeWarning[] = [];
  const now = new Date();
  const timestamp = now.toISOString();

  // 如果已平仓，不计算风险
  if (trade.isClosed) return [];

  const leg = trade.legs?.[0];
  const strike = leg?.strike || trade.strike || 0;
  const expDate = leg?.expiry || trade.expDate;
  const dte = expDate ? calculateDTE(expDate) : trade.duration;
  
  // 容错：如果行权价或当前价无效，直接返回
  if (!strike || currentPrice <= 0) return [];

  // 获取当前 IV, Regime, KC
  let currentIV: number | null = null;
  let regime: string | null = null;
  let kcLower: number | null = null;

  if (currentFactors) {
    if ('price' in currentFactors && 'change' in currentFactors) {
      const pd = currentFactors as PriceData;
      currentIV = pd.iv ?? null;
    } else {
      const fm = currentFactors as any;
      currentIV = fm.iv?.value ?? fm.iv ?? fm.iv_atm?.value ?? fm.iv_atm ?? null;
      regime = fm.market_regime?.value ?? fm.market_regime ?? fm.trend_label?.value ?? fm.trend_label ?? null;
      kcLower = fm.kc_lower?.value ?? fm.kc_lower ?? null;
    }
  }

  // 1. ITM 风险 (价格跌破行权价)
  if (isITM(currentPrice, strike)) {
    warnings.push({
      type: "ITM_RISK",
      label: "price",
      level: "high",
      message: "标的价格已跌破行权价，存在接盘风险",
      triggerValue: currentPrice,
      timestamp,
    });
  } 
  // 2. 接近 ITM
  else if (isNearITM(currentPrice, strike)) {
    warnings.push({
      type: "NEAR_ITM",
      label: "price",
      level: "medium",
      message: "价格接近行权价，建议关注或准备 roll",
      triggerValue: currentPrice,
      timestamp,
    });
  }

  // 3. 时间风险
  if (dte !== undefined && dte >= 0) {
    const dteRisk = getDTERiskLevel(dte);
    if (dteRisk === 'critical') {
      warnings.push({
        type: "EXPIRATION_RISK",
        label: "time",
        level: "high",
        message: `临近到期 (DTE: ${dte})，Gamma 风险极高，建议尽快处理`,
        triggerValue: dte,
        timestamp,
      });
    } else if (dteRisk === 'medium' || dteRisk === 'warning') {
      warnings.push({
        type: "EXPIRATION_RISK",
        label: "time",
        level: "medium",
        message: `距离到期仅剩 ${dte} 天，时间价值衰减加速`,
        triggerValue: dte,
        timestamp,
      });
    }
  }

  // 4. Delta 风险 (基于实时计算)
  if (currentIV && currentPrice > 0 && dte !== undefined && dte > 0) {
    // 保持使用日历日 365 而非交易日 252 计算
    const currentGreeks = calculateOptionGreeks(
      currentPrice,
      strike,
      dte / 365,
      currentIV,
      0.045,
      'Put'
    );
    const absDelta = Math.abs(currentGreeks.delta);
    const deltaRisk = getDeltaRiskLevel(absDelta);
    
    if (deltaRisk === 'critical') {
      warnings.push({
        type: "DELTA_RISK",
        label: "greeks",
        level: "high",
        message: `Delta 升至 ${absDelta.toFixed(2)}，持仓风险显著增加`,
        triggerValue: absDelta,
        timestamp,
      });
    } else if (deltaRisk === 'watch' || deltaRisk === 'warning') {
      warnings.push({
        type: "DELTA_RISK",
        label: "greeks",
        level: "medium",
        message: `Delta 升至 ${absDelta.toFixed(2)}，建议关注`,
        triggerValue: absDelta,
        timestamp,
      });
    }
  }

  // 5. 盈利提醒 (止盈)
  const premiumTotal = trade.premiumTotal || (leg?.entryPrice * leg?.quantity * 100) || 0;
  const actualPnL = trade.actualPnL !== undefined ? trade.actualPnL : trade.realizedPnL;
  
  if (actualPnL !== undefined && premiumTotal > 0) {
    const profitRatio = calcProfitRatio(actualPnL, premiumTotal);
    if (profitRatio >= PROFIT.CLOSE_HIGH) {
      warnings.push({
        type: "TAKE_PROFIT",
        label: "profit",
        level: "low",
        message: `盈利已达 ${(profitRatio * 100).toFixed(0)}%，达到 ${(PROFIT.CLOSE_HIGH * 100).toFixed(0)}% 目标，建议平仓`,
        triggerValue: profitRatio,
        timestamp,
      });
    } else if (profitRatio >= PROFIT.CLOSE_MID) {
      warnings.push({
        type: "TAKE_PROFIT",
        label: "profit",
        level: "low",
        message: `盈利已达 ${(profitRatio * 100).toFixed(0)}%，可以考虑止盈`,
        triggerValue: profitRatio,
        timestamp,
      });
    }
  }

  // 6. 波动率风险 (IV 较开仓上升)
  const openIV = trade.openSnapshot?.ivAtm;
  if (currentIV && openIV) {
    if (currentIV > openIV * IV_EXPANSION.HIGH) {
      warnings.push({
        type: "IV_EXPANSION",
        label: "volatility",
        level: "high",
        message: `波动率急剧上升 (>${(IV_EXPANSION.HIGH - 1) * 100}%)，期权价格可能剧烈波动`,
        triggerValue: currentIV,
        timestamp,
      });
    } else if (currentIV > openIV * IV_EXPANSION.MEDIUM) {
      warnings.push({
        type: "IV_EXPANSION",
        label: "volatility",
        level: "medium",
        message: `波动率显著上升 (>${Math.round((IV_EXPANSION.MEDIUM - 1) * 100)}%)，持仓压力增大`,
        triggerValue: currentIV,
        timestamp,
      });
    }
  }

  // 7. 趋势反转风险
  if (regime === 'BEAR' || regime === 'CRISIS') {
    warnings.push({
      type: "TREND_REVERSAL",
      label: "regime",
      level: "high",
      message: `市场进入 ${regime} 环境，趋势已反转，建议考虑离场`,
      triggerValue: 0,
      timestamp,
    });
  }

  // 8. 价格跌破支撑位 (Breakdown)
  if (kcLower && currentPrice < kcLower) {
    warnings.push({
      type: "BREAKDOWN",
      label: "price",
      level: "high",
      message: "价格已跌破支撑位 (KC Lower)，下行空间增大",
      triggerValue: currentPrice,
      timestamp,
    });
  }

  return warnings;
}
