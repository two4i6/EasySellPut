import { computeSellerEdgeFactors } from '../../../analysis/SellerEdgeScoreEngine';
import { computeSellerStats, type OHLCBar, type SellerStatsAsOf } from '../../../analysis/SellerStatsEngine';
import { addSellerOpportunityFactors } from '../../../analysis/SellerOpportunityFactors';
import { RESEARCH_OPEN_70_POLICY } from '../../../analysis/SellerOpportunityPolicy';
import { decisionEngine } from '../../../core/DecisionEngine';
import { createDerivedFactor, fallbackFactor, isValidPrice, isValidVix } from '../../../../factor';
import type { FactorMap } from '../../../../../types/factor';
import type { OptionChain } from '../../types/input';

export type PCSPageDecisionMode = 'watch_open' | 'open' | 'historical_38_open' | 'research_open_70' | 'legacy_open' | 'carry';
type DailyBar = OHLCBar & { volume: number };
export type PCSStockDecisionFilterResult = { available: boolean; finalAction?: 'OPEN' | 'WATCH' | 'WAIT' | 'BLOCK'; promotionSource?: 'BASE' | 'WATCH_TRIGGER' | 'OPEN_TRIGGER' | 'CARRY_OPEN' | null; selectedSigma?: 1 | 1.5 | 2 | 2.5 | null; allowed: boolean; vetoed?: 'ma200' | 'vol_confirm' };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const average = (values: number[]) => values.length ? mean(values) : 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const stdev = (values: number[]) => values.length < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / (values.length - 1));
const raw = <T>(value: T, api: string) => ({ value, confidence: 10, source: { type: 'raw' as const, api } });

/** QQQ 的 IV rank 使用同标的波动率指数 VXN，不用已实现波动率伪装 IV。 */
export function vxnRankForHistory(vxnHistory: number[]): number {
  const currentVxn = vxnHistory.at(-1)!;
  return vxnHistory.length < 2 ? 50 : clamp((currentVxn - Math.min(...vxnHistory)) / (Math.max(...vxnHistory) - Math.min(...vxnHistory) || 1) * 100, 0, 100);
}

/** 冻结的历史 QQQ 代理基线；只由快速回测的 legacy_open 模式传入。 */
export const QQQ_PROXY_DECISION_THRESHOLDS = { watchThreshold: 50, openThreshold: 70 } as const;

function rsi(closes: number[]): number {
  const moves = closes.slice(-15).slice(1).map((close, index) => close - closes[closes.length - 15 + index]);
  const gains = average(moves.map(value => Math.max(0, value)));
  const losses = average(moves.map(value => Math.max(0, -value)));
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}

function toDecisionChain(chain: OptionChain, date: string) {
  return {
    date,
    underlyingPrice: chain.spot,
    expirations: chain.expirations.map(exp => ({
      expiryDate: exp.date,
      dte: Math.round((Date.parse(`${exp.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000),
      options: [...exp.calls, ...exp.puts].map(option => ({ ...option, mid: (option.bid + option.ask) / 2, dte: 0, type: option.type === 'call' ? 'Call' as const : 'Put' as const })),
    })),
  };
}

function factorsFor(bars: DailyBar[], vix: number, vix3m: number, vxnHistory: number[]): FactorMap {
  const current = bars.at(-1)!;
  const closes = bars.map(bar => bar.close);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const hv = stdev(returns.slice(-20)) * Math.sqrt(252);
  const ma30 = average(closes.slice(-30));
  const ma200 = average(closes.slice(-200));
  const trueRanges = bars.slice(-20).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[Math.max(0, bars.length - 20 + index - 1)].close), Math.abs(bar.low - bars[Math.max(0, bars.length - 20 + index - 1)].close)));
  const atr = average(trueRanges.slice(-14));
  const atrRatio = atr / (average(trueRanges) || 1);
  const extension = atr ? (current.close - ma30) / atr : 0;
  const trendQuality = current.close > ma30 && ma30 > ma200 ? 70 : current.close < ma30 && ma30 < ma200 ? 30 : 50;
  const currentVxn = vxnHistory.at(-1)!;
  const vxnRank = vxnRankForHistory(vxnHistory);
  const factors: FactorMap = {
    symbol: { value: 'QQQ', confidence: 7, source: { type: 'manual', description: 'QQQ PCS 日线过滤' } },
    daily_closes: raw(closes, 'QQQ OHLCV'), underlying_price: raw(current.close, 'QQQ OHLCV'), price: raw(current.close, 'QQQ OHLCV'),
    underlying_change: raw((current.close / bars.at(-2)!.close - 1) * 100, 'QQQ OHLCV'), volume: raw(current.volume, 'QQQ OHLCV'),
    vix_price: raw(vix, '^VIX'), vix3m_price: raw(vix3m, '^VIX3M'), vxn_price: raw(currentVxn, '^VXN'), vxn_history: raw(vxnHistory, '^VXN'),
    seller_intraday_position: raw(current.high === current.low ? .5 : (current.close - current.low) / (current.high - current.low), 'QQQ OHLCV'),
  };
  factors.historical_volatility = createDerivedFactor(hv, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.hv_20 = createDerivedFactor(hv, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.hv_30 = createDerivedFactor(hv, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.iv_rank = createDerivedFactor(vxnRank, [{ factorId: 'vxn_history', weight: 1 }], factors);
  factors.vol_premium = createDerivedFactor((currentVxn / 100) / (hv || 1), [{ factorId: 'vxn_price', weight: .5 }, { factorId: 'historical_volatility', weight: .5 }], factors);
  factors.implied_volatility = createDerivedFactor(currentVxn / 100, [{ factorId: 'vxn_price', weight: 1 }], factors);
  factors.iv_atm = createDerivedFactor(currentVxn / 100, [{ factorId: 'vxn_price', weight: 1 }], factors);
  factors.vix_term_ratio = createDerivedFactor(vix / vix3m, [{ factorId: 'vix_price', weight: .5 }, { factorId: 'vix3m_price', weight: .5 }], factors);
  factors.atr = createDerivedFactor(atr, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.atr_ratio = createDerivedFactor(atrRatio, [{ factorId: 'atr', weight: 1 }], factors);
  factors.atr_shock_weight = createDerivedFactor(clamp((atrRatio - 1) / .4, 0, 1), [{ factorId: 'atr_ratio', weight: 1 }], factors);
  factors.ma30 = createDerivedFactor(ma30, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.ma200 = createDerivedFactor(ma200, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.price_extension = createDerivedFactor(extension, [{ factorId: 'underlying_price', weight: .5 }, { factorId: 'ma30', weight: .25 }, { factorId: 'atr', weight: .25 }], factors);
  factors.trend_quality = createDerivedFactor(trendQuality, [{ factorId: 'underlying_price', weight: .5 }, { factorId: 'ma30', weight: .25 }, { factorId: 'ma200', weight: .25 }], factors);
  factors.rsi = createDerivedFactor(rsi(closes), [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.price_roc_5d = createDerivedFactor((current.close / closes.at(-6)! - 1) * 100, [{ factorId: 'daily_closes', weight: 1 }], factors);
  factors.risk_score = createDerivedFactor(clamp(35 + Math.max(0, atrRatio - 1) * 80 + Math.abs(extension) * 10, 0, 100), [{ factorId: 'atr_ratio', weight: .5 }, { factorId: 'price_extension', weight: .5 }], factors);
  factors.atm_bid_ask_spread = createDerivedFactor(0, [{ factorId: 'historical_volatility', weight: 1 }], factors);
  factors.total_gex = createDerivedFactor(0, [{ factorId: 'historical_volatility', weight: 1 }], factors);
  factors.iv_curve = fallbackFactor({ points: [], iv30: 0 }, '过滤器不重建历史 IV 期限结构');
  factors.earnings_date = fallbackFactor(null, '过滤器不提供 point-in-time 财报日期');
  factors.vxn_rank = createDerivedFactor(vxnRank, [{ factorId: 'vxn_history', weight: 1 }], factors);
  factors.vxn_hv_ratio = createDerivedFactor((currentVxn / 100) / (hv || 1), [{ factorId: 'vxn_price', weight: .5 }, { factorId: 'historical_volatility', weight: .5 }], factors);
  factors.vxn_roc_5d = createDerivedFactor((currentVxn / vxnHistory.at(-6)! - 1) * 100, [{ factorId: 'vxn_price', weight: .5 }, { factorId: 'vxn_history', weight: .5 }], factors);
  return factors;
}

export function isPCSStockDecisionAllowed(mode: PCSPageDecisionMode, action?: PCSStockDecisionFilterResult['finalAction'], promotionSource?: PCSStockDecisionFilterResult['promotionSource']) {
  if (mode === 'carry') return action === 'OPEN' && promotionSource === 'CARRY_OPEN';
  if (promotionSource === 'CARRY_OPEN') return false;
  return mode === 'watch_open' ? action === 'OPEN' || action === 'WATCH' : action === 'OPEN';
}

export function evaluatePCSStockDecisionFilter(input: { mode: PCSPageDecisionMode; bars: DailyBar[]; vix?: number; vix3m?: number; vxnHistory?: number[]; optionChain?: OptionChain; bearVeto?: 'off' | 'ma200'; volConfirmDays?: number; sellerStatsAsOf?: SellerStatsAsOf }): PCSStockDecisionFilterResult {
  const { bars, vix, vix3m, vxnHistory, optionChain } = input;
  const validBars = bars.length >= 200 && bars.every(bar => isValidPrice(bar.open) && isValidPrice(bar.high) && isValidPrice(bar.low) && isValidPrice(bar.close) && Number.isFinite(bar.volume) && bar.volume >= 0);
  const validChain = optionChain?.expirations.some(exp => [...exp.calls, ...exp.puts].some(option => isValidPrice(option.strike) && isValidPrice(option.bid) && isValidPrice(option.ask) && Number.isFinite(option.iv) && Number.isFinite(option.delta))) === true;
  if (!validBars || !isValidVix(vix ?? NaN) || !isValidVix(vix3m ?? NaN) || !vxnHistory || vxnHistory.length < 6 || !vxnHistory.every(isValidVix) || !optionChain || !isValidPrice(optionChain.spot) || !validChain) return { available: false, allowed: false };
  // 熊市否决先于评分：安全门(backwardation/BEAR regime)拦不住的下跌中继日，高分是事件强度非安全度
  if (input.bearVeto === 'ma200' && bars.at(-1)!.close < average(bars.slice(-200).map(bar => bar.close))) {
    return { available: true, allowed: false, vetoed: 'ma200' };
  }
  // 时机闸：评分在冲击日最高（接刀），要求 VXN 已连续回落 K 日（冲击衰减确认）再放行
  const volConfirmDays = input.volConfirmDays ?? 0;
  for (let k = 1; k <= volConfirmDays; k++) {
    if (vxnHistory.at(-k)! >= vxnHistory.at(-k - 1)!) return { available: true, allowed: false, vetoed: 'vol_confirm' };
  }
  let factors = factorsFor(bars, vix!, vix3m!, vxnHistory);
  factors = addSellerOpportunityFactors(factors, input.sellerStatsAsOf?.snapshot() ?? computeSellerStats(bars), bars.at(-1)!.date);
  const sellerEdge = computeSellerEdgeFactors(factors);
  factors.seller_edge_score = sellerEdge.factor;
  factors.seller_event_score = sellerEdge.eventFactor;
  factors.seller_premium_score = sellerEdge.premiumFactor;
  const isolatedHistoricalOpen = input.mode === 'historical_38_open' || input.mode === 'research_open_70';
  // 38/120 原版没有 Carry 分支；研究复刻也保持同一事件归因，不能由新 Carry 因子抢占。
  if (isolatedHistoricalOpen) factors.seller_csp_carry_selected_sigma = fallbackFactor(0, '历史 OPEN 复刻不使用 CSP carry');
  // ponytail: 固定 21:00Z ≈ 美东收盘（冬令时准确，夏令时偏后 1h），仅喂 staleness 检查，无需真时区换算
  const evaluationMs = Date.parse(`${bars.at(-1)!.date}T21:00:00Z`);
  const analysis = decisionEngine.getStockDecisionSystem(
    factors,
    toDecisionChain(optionChain, bars.at(-1)!.date),
    { factors: evaluationMs, history: evaluationMs, evaluatedAt: evaluationMs },
    true,
    {},
    undefined,
    undefined,
    undefined,
    0,
    {},
    input.mode === 'legacy_open' ? QQQ_PROXY_DECISION_THRESHOLDS : undefined,
    input.mode === 'research_open_70' ? RESEARCH_OPEN_70_POLICY : undefined,
  ).analysis;
  const finalAction = analysis.finalAction;
  const promotionSource = analysis.promotionSource;
  const allowed = isPCSStockDecisionAllowed(input.mode, finalAction, promotionSource);
  return { available: true, finalAction, promotionSource, selectedSigma: analysis.selectedSigma, allowed };
}
