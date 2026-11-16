import { EQUITY_BOOST_MONEYNESS_MIN, EQUITY_BOOST_MONEYNESS_MAX, EQUITY_BOOST_RATIO_MIN, EQUITY_BOOST_RATIO_MAX, EQUITY_BOOST_MELTUP_DRAWDOWN_MAX, EQUITY_BOOST_MELTUP_VIX_CEILING, EQUITY_BOOST_MELTUP_ROC20_MIN } from '../../constants';
import { findNearestExpiry } from '../../utils';

export type EquityBoostContract = { strike: number; bid: number; ask: number; delta: number; openInterest: number; volume: number };
export type EquityBoostExpiration = { date: string; puts: EquityBoostContract[] };
export type EquityBoostChain = { spot: number; expirations: EquityBoostExpiration[] };
export type EquityBoostCandidate = { expiry: string; shortStrike: number; longStrike: number; shortBid: number; shortAsk: number; longBid: number; longAsk: number; shortVolume: number; longVolume: number; netCreditPerContract: number; maxLossPerContract: number; creditToMaxLoss: number; breakEven: number };
export type EquityBoostFillEconomics = { netCreditPerContract: number; maxLossPerContract: number; creditToMaxLoss: number };
export type EquityBoostDteMode = 'fixed' | 'risk_adaptive_v1' | 'risk_adaptive_hysteresis_v1' | 'state_adaptive_sr01_v1' | 'state_adaptive_bad_sr01_v1' | 'price_adaptive_v1';
export type EquityBoostWidthMode = 'fixed' | 'fixed_target_v1' | 'risk_adaptive_v1' | 'price_adaptive_v1';
export type EquityBoostDteHysteresisState = { riskState: 'low' | 'high'; highRiskTradingDays: number };

const valid = (c: EquityBoostContract) => Number.isFinite(c.strike) && c.strike > 0 && Number.isFinite(c.bid) && c.bid > 0 && Number.isFinite(c.ask) && c.ask >= c.bid && Number.isFinite(c.delta) && Number.isFinite(c.openInterest) && c.openInterest > 0 && Number.isFinite(c.volume) && c.volume >= 0;
const compare = (a: readonly number[], b: readonly number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export function selectEquityBoostLegsForExpiration(expData: EquityBoostExpiration, spot: number, bounds?: { min?: number; max?: number }, targetWidthPct?: number, ratioSelectionTarget?: number, selectionPriority?: 'width_first' | 'ratio_first'): EquityBoostCandidate | undefined {
  if (!(spot > 0)) return undefined;
  const min = bounds?.min ?? EQUITY_BOOST_RATIO_MIN, max = bounds?.max ?? EQUITY_BOOST_RATIO_MAX;
  const puts = expData.puts.filter(valid);
  const shorts = puts.filter(p => { const x = (p.strike - spot) / spot; return x >= EQUITY_BOOST_MONEYNESS_MIN && x <= EQUITY_BOOST_MONEYNESS_MAX; });
  const longs = puts.filter(p => { const x = (spot - p.strike) / spot; return x >= EQUITY_BOOST_MONEYNESS_MIN && x <= EQUITY_BOOST_MONEYNESS_MAX; });
  let best: EquityBoostCandidate | undefined, score: readonly number[] | undefined;
  for (const short of shorts) for (const long of longs) {
    if (!(short.strike > spot && spot > long.strike)) continue;
    const credit = (short.bid - long.ask) * 100, loss = (short.strike - long.strike) * 100 - credit;
    if (!(credit > 0 && loss > 0)) continue;
    const ratio = credit / loss;
    if (ratio < min || ratio > max) continue;
    const widthPct = (short.strike - long.strike) / spot;
    const ratioTarget = ratioSelectionTarget ?? 1;
    const next: readonly number[] = targetWidthPct == null || selectionPriority === 'ratio_first'
      ? targetWidthPct == null
        ? [Math.abs(ratio - ratioTarget), -Math.min(short.volume, long.volume), (short.ask - short.bid) + (long.ask - long.bid), Math.abs(short.strike - spot) + Math.abs(spot - long.strike)]
        : [Math.abs(ratio - ratioTarget), Math.abs(widthPct - targetWidthPct), -Math.min(short.volume, long.volume), (short.ask - short.bid) + (long.ask - long.bid), Math.abs(short.strike - spot) + Math.abs(spot - long.strike)]
      : [Math.abs(widthPct - targetWidthPct), Math.abs(ratio - ratioTarget), -Math.min(short.volume, long.volume), (short.ask - short.bid) + (long.ask - long.bid), Math.abs(short.strike - spot) + Math.abs(spot - long.strike)];
    if (score && compare(next, score) >= 0) continue;
    score = next; best = { expiry: expData.date, shortStrike: short.strike, longStrike: long.strike, shortBid: short.bid, shortAsk: short.ask, longBid: long.bid, longAsk: long.ask, shortVolume: short.volume, longVolume: long.volume, netCreditPerContract: credit, maxLossPerContract: loss, creditToMaxLoss: ratio, breakEven: short.strike - credit / 100 };
  }
  return best;
}

export function selectEquityBoostCandidate(chain: EquityBoostChain, date: string, targetDte: number, bounds?: { min?: number; max?: number }, targetWidthPct?: number, ratioSelectionTarget?: number, selectionPriority?: 'width_first' | 'ratio_first'): EquityBoostCandidate | undefined {
  const expiry = findNearestExpiry(chain.expirations, date, targetDte);
  const data = chain.expirations.find(item => item.date === expiry);
  return data ? selectEquityBoostLegsForExpiration(data, chain.spot, bounds, targetWidthPct, ratioSelectionTarget, selectionPriority) : undefined;
}

export function createEquityBoostDteHysteresisState(): EquityBoostDteHysteresisState {
  return { riskState: 'low', highRiskTradingDays: 0 };
}

export function updateEquityBoostDteHysteresisState(
  state: EquityBoostDteHysteresisState | undefined,
  vxn: number | undefined,
  input: { vxnThreshold?: number; recoveryVxnThreshold?: number; minHighRiskDays?: number } = {},
): EquityBoostDteHysteresisState {
  const current = state ?? createEquityBoostDteHysteresisState();
  if (typeof vxn !== 'number' || !Number.isFinite(vxn)) return current;
  const entryThreshold = input.vxnThreshold ?? 22;
  const recoveryThreshold = input.recoveryVxnThreshold ?? 21;
  const minHighRiskDays = Math.max(1, Math.floor(input.minHighRiskDays ?? 5));
  if (current.riskState === 'low') {
    return vxn >= entryThreshold ? { riskState: 'high', highRiskTradingDays: 1 } : current;
  }
  const highRiskTradingDays = Math.max(1, current.highRiskTradingDays) + 1;
  if (vxn <= recoveryThreshold && highRiskTradingDays >= minHighRiskDays) {
    return { riskState: 'low', highRiskTradingDays: 0 };
  }
  return { riskState: 'high', highRiskTradingDays };
}

export function resolveEquityBoostTargetDte(input: { mode?: EquityBoostDteMode; fixedDte?: 21 | 28 | 35 | 42; vxn?: number; vxnThreshold?: number; hysteresisState?: EquityBoostDteHysteresisState; regime?: string; slowSubregime?: string; priceVsSma200Pct?: number; priceThresholdPct?: number }): 21 | 28 | 35 | 42 {
  const fixedDte = input.fixedDte ?? 28;
  const useHysteresis = () => {
    if (input.hysteresisState) return input.hysteresisState.riskState === 'high' ? 28 : 35;
    return typeof input.vxn === 'number' && input.vxn >= (input.vxnThreshold ?? 22) ? 28 : 35;
  };
  if (input.mode === 'state_adaptive_sr01_v1' && input.slowSubregime === 'SR01') return 28;
  if (input.mode === 'state_adaptive_bad_sr01_v1' && input.slowSubregime === 'SR01' && (input.regime === 'BULL' || input.regime === 'RISK_ON_WEAKENING')) return 28;
  if (input.mode === 'price_adaptive_v1' && typeof input.priceVsSma200Pct === 'number' && Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct < (input.priceThresholdPct ?? .07)) return 28;
  if (input.mode === 'risk_adaptive_hysteresis_v1') {
    return useHysteresis();
  }
  if (input.mode === 'state_adaptive_sr01_v1' || input.mode === 'state_adaptive_bad_sr01_v1' || input.mode === 'price_adaptive_v1') return useHysteresis();
  if (input.mode !== 'risk_adaptive_v1') return fixedDte;
  return typeof input.vxn === 'number' && input.vxn >= (input.vxnThreshold ?? 23) ? 28 : 35;
}

export function resolveEquityBoostWidthTargetPct(input: { mode?: EquityBoostWidthMode; vxn?: number; vxnThreshold?: number; lowVxnTargetPct?: number; highVxnTargetPct?: number; priceVsSma200Pct?: number; priceThresholdPct?: number; lowPriceTargetPct?: number }): number | undefined {
  if (input.mode === 'fixed_target_v1') return input.lowVxnTargetPct ?? .03;
  if (input.mode !== 'risk_adaptive_v1' && input.mode !== 'price_adaptive_v1') return undefined;
  const low = input.lowVxnTargetPct ?? .03;
  const high = input.highVxnTargetPct ?? .015;
  if (input.mode === 'price_adaptive_v1' && typeof input.priceVsSma200Pct === 'number' && Number.isFinite(input.priceVsSma200Pct) && input.priceVsSma200Pct < (input.priceThresholdPct ?? .07)) {
    return input.lowPriceTargetPct ?? low;
  }
  return typeof input.vxn === 'number' && input.vxn >= (input.vxnThreshold ?? 23) ? high : low;
}

export function evaluateEquityBoostTrigger(input: { enableEquityBoostPCS: boolean; entryMode: 'continuous' | 'post_pullback' | 'melt_up' | 'post_pullback_or'; regime: string; crisisPhase?: string; backwardation: boolean; qqqROC5: number; qqqROC20?: number; qqqDrawdownFromHigh?: number; vix: number; dataConfidenceOk: boolean; hasOpenEquityBoost: boolean; hasCompetingQQQBullishPutPosition: boolean; pullbackRocCeiling?: number; pullbackVixFloor?: number; meltUpDrawdownMax?: number; meltUpVixCeiling?: number; meltUpRoc20Min?: number }): boolean {
  if (!input.enableEquityBoostPCS || !input.dataConfidenceOk || input.hasOpenEquityBoost || input.hasCompetingQQQBullishPutPosition || input.backwardation || input.regime === 'BEAR' || input.regime === 'CRISIS' || input.crisisPhase === 'PENDING' || input.crisisPhase === 'CONFIRMED') return false;
  const roc = input.pullbackRocCeiling ?? -0.03, vix = input.pullbackVixFloor ?? 20;
  if (input.entryMode === 'post_pullback') return input.qqqROC5 <= roc && input.vix >= vix;
  if (input.entryMode === 'post_pullback_or') return input.qqqROC5 <= roc || input.vix >= vix;
  if (input.entryMode === 'melt_up') return input.qqqROC20 != null && input.qqqDrawdownFromHigh != null && input.qqqDrawdownFromHigh <= (input.meltUpDrawdownMax ?? EQUITY_BOOST_MELTUP_DRAWDOWN_MAX) && input.vix <= (input.meltUpVixCeiling ?? EQUITY_BOOST_MELTUP_VIX_CEILING) && input.qqqROC20 > (input.meltUpRoc20Min ?? EQUITY_BOOST_MELTUP_ROC20_MIN);
  return true;
}

export type EquityBoostBass221VixReboundGateInput = {
  enabled: boolean;
  regime?: string;
  slowSubregime?: string;
  qqqRoc20?: number;
  qqqRoc5?: number;
  qqqRoc5Slope?: number;
  drawdownFromRecentHighPct?: number;
  vix?: number;
  vix5dAgo?: number;
  drawdownMin?: number;
  vixChange5dMin?: number;
};

/** 2.2.1 候选 EB：只拦截 VIX 仍上升、ROC5 仍为负但短期转强的慢反转窗口。 */
export function isEquityBoostBass221VixReboundGateBlocked(input: EquityBoostBass221VixReboundGateInput): boolean {
  if (!input.enabled || input.regime !== 'RANGE_BOUND' || input.slowSubregime !== 'SR01') return false;
  const values = [input.qqqRoc20, input.qqqRoc5, input.qqqRoc5Slope, input.drawdownFromRecentHighPct, input.vix, input.vix5dAgo];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value)) || input.vix5dAgo! <= 0) return true;
  const vixChange5d = (input.vix! - input.vix5dAgo!) / input.vix5dAgo!;
  return input.qqqRoc20! < 0
    && input.qqqRoc5! < 0
    && input.qqqRoc5Slope! > 0
    && input.drawdownFromRecentHighPct! >= (input.drawdownMin ?? .02)
    && vixChange5d >= (input.vixChange5dMin ?? .03);
}

export type EquityBoostBass221SeverityInput = {
  regime?: string;
  slowSubregime?: string;
  qqqRoc20?: number;
  qqqRoc5?: number;
  drawdownFromRecentHighPct?: number;
  tqqqRealisedVol20d?: number;
  range20dPct?: number;
};

/** 2.2.1 严重度：沿用报告60的 RV20≥50% + 20日区间≥6.5% 条件。 */
export function isEquityBoostBass221SeverityActive(input: EquityBoostBass221SeverityInput): boolean {
  return input.regime === 'RANGE_BOUND'
    && input.slowSubregime === 'SR01'
    && (input.qqqRoc20 ?? Infinity) < 0
    && (input.qqqRoc5 ?? Infinity) <= 0
    && (input.drawdownFromRecentHighPct ?? 0) >= .03
    && (input.tqqqRealisedVol20d ?? 0) >= .50
    && (input.range20dPct ?? 0) >= .065;
}

/**
 * EB 风险闸：只对 RISK_ON_WEAKENING/SR01 生效。
 * 该函数只消费 as-of 数据；启用的条件无法计算时返回 true（禁止新开）。
 */
export function equityBoostRiskOnWeakeningSr01VolGateBlocked(input: {
  regime: string;
  slowSubregime?: string;
  vix?: number;
  vxn?: number;
  vxnHistory?: number[];
  ratioCeiling?: number;
  requireVxn10dRising?: boolean;
}): boolean {
  if (input.regime !== 'RISK_ON_WEAKENING' || input.slowSubregime !== 'SR01') return false;
  const ratioEnabled = input.ratioCeiling !== undefined;
  const risingEnabled = input.requireVxn10dRising === true;
  if (!ratioEnabled && !risingEnabled) return false;

  let ratioRisk = true;
  if (ratioEnabled) {
    const vix = input.vix;
    const vxn = input.vxn;
    const ratio = typeof vix === 'number' && typeof vxn === 'number' && vix > 0 ? vxn / vix : Number.NaN;
    if (!Number.isFinite(ratio)) return true;
    ratioRisk = ratio >= input.ratioCeiling!;
  }

  let risingRisk = true;
  if (risingEnabled) {
    const history = input.vxnHistory;
    const current = history?.at(-1);
    const tenTradingDaysAgo = history?.at(-11);
    if (!history || history.length < 11 || !Number.isFinite(current) || !Number.isFinite(tenTradingDaysAgo)) return true;
    risingRisk = current! > tenTradingDaysAgo!;
  }

  // 研究候选是“高 Ratio 且 VXN 上升”的联合风险条件；两项均启用时不能变成 OR。
  return ratioRisk && risingRisk;
}

export function sizeEquityBoostQuantity(nav: number, maxLossPerContract: number, maxRiskNav: number): number { return nav > 0 && maxLossPerContract > 0 && maxRiskNav > 0 ? Math.floor(nav * maxRiskNav / maxLossPerContract) : 0; }

/** 实际成交后的 1:1 口径：分子与最大损失都使用扣除冲击和佣金后的净入账保费。 */
export function equityBoostFillEconomics(width: number, totalCredit: number, quantity: number): EquityBoostFillEconomics | undefined {
  if (!(width > 0) || !(quantity > 0) || !(totalCredit > 0)) return undefined;
  const netCreditPerContract = totalCredit / quantity;
  const maxLossPerContract = width * 100 - netCreditPerContract;
  if (!(maxLossPerContract > 0) || !Number.isFinite(maxLossPerContract)) return undefined;
  return { netCreditPerContract, maxLossPerContract, creditToMaxLoss: netCreditPerContract / maxLossPerContract };
}

/** Equity Boost proposal 的候选、仓位与展示字段统一从 v2 策略生成。 */
export function buildEquityBoostProposal(input: { chain: EquityBoostChain; date: string; targetDte: number; nav: number; maxRiskNav: number; forceMinimumContract?: boolean; independent?: boolean; ratioBounds?: { min?: number; max?: number }; targetWidthPct?: number; ratioSelectionTarget?: number; selectionPriority?: 'width_first' | 'ratio_first'; riskMultiplier?: number }) {
  const candidate = selectEquityBoostCandidate(input.chain, input.date, input.targetDte, input.ratioBounds, input.targetWidthPct, input.ratioSelectionTarget, input.selectionPriority);
  if (!candidate) return {};
  let quantity = sizeEquityBoostQuantity(input.nav, candidate.maxLossPerContract, input.maxRiskNav);
  if (quantity <= 0) {
    if (!input.forceMinimumContract) return { warning: `Equity Boost Put Spread：NAV 预算不足以开 1 张（maxLoss/张=$${candidate.maxLossPerContract.toFixed(0)}, 预算=${(input.maxRiskNav * 100).toFixed(1)}% NAV），跳过` };
    quantity = 1;
    const riskBudgetUsed = input.nav > 0 ? quantity * candidate.maxLossPerContract / input.nav : undefined;
    return { proposal: { proposedStrikes: { eb_short_strike: candidate.shortStrike, eb_long_strike: candidate.longStrike, expiry: candidate.expiry }, premiumEstimate: candidate.netCreditPerContract / 100, maxRiskPct: riskBudgetUsed, metadata: { strategyName: `QQQ Equity Boost Put Spread @${candidate.longStrike}/${candidate.shortStrike}`, underlying: 'QQQ' as const, shortPutStrike: candidate.shortStrike, longPutStrike: candidate.longStrike, credit: candidate.netCreditPerContract / 100, maxLoss: candidate.maxLossPerContract, buyingPowerImpact: candidate.maxLossPerContract, quantity, riskBudgetUsed, creditToMaxLoss: candidate.creditToMaxLoss, breakEven: candidate.breakEven, dte: input.targetDte, ...(input.riskMultiplier !== undefined ? { riskMultiplier: input.riskMultiplier } : {}), definedRisk: true as const, proxyOverlay: true as const, notCoveredOverlay: true as const } }, warning: `Equity Boost Put Spread：NAV 预算不足以开 1 张（maxLoss/张=$${candidate.maxLossPerContract.toFixed(0)}, 预算=${(input.maxRiskNav * 100).toFixed(1)}% NAV），[FMQ0]强制开1张，超预算${(candidate.maxLossPerContract / (input.nav * input.maxRiskNav) * 100).toFixed(0)}%` };
  }
  const riskBudgetUsed = input.nav > 0 ? quantity * candidate.maxLossPerContract / input.nav : undefined;
  return { proposal: {
    proposedStrikes: { eb_short_strike: candidate.shortStrike, eb_long_strike: candidate.longStrike, expiry: candidate.expiry }, premiumEstimate: candidate.netCreditPerContract / 100, maxRiskPct: riskBudgetUsed,
    metadata: { strategyName: `QQQ Equity Boost Put Spread @${candidate.longStrike}/${candidate.shortStrike}`, underlying: 'QQQ' as const, shortPutStrike: candidate.shortStrike, longPutStrike: candidate.longStrike, credit: candidate.netCreditPerContract / 100, maxLoss: candidate.maxLossPerContract, buyingPowerImpact: candidate.maxLossPerContract, quantity, riskBudgetUsed, creditToMaxLoss: candidate.creditToMaxLoss, breakEven: candidate.breakEven, dte: input.targetDte, ...(input.riskMultiplier !== undefined ? { riskMultiplier: input.riskMultiplier } : {}), definedRisk: true as const, proxyOverlay: true as const, notCoveredOverlay: true as const },
  } };
}
