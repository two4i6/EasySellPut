import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { createDerivedFactor, fallbackFactor, isFinancialFactor } from '../../factor';

export const QQQ_PCS_SYMBOL = 'QQQ' as const;
export const QQQ_PCS_VWAP_SCORE_MAX_PCT = 0.1;

export type PcsDailyEligibility = 'OPEN' | 'WATCH' | 'BLOCK' | 'UNAVAILABLE';

export type PcsIntradayTiming =
  | 'NOW'
  | 'WAIT_PULLBACK'
  | 'WAIT_CONFIRM'
  | 'NO_ENTRY_SIGNAL'
  | 'INSUFFICIENT_DATA';

export type QqqPcsEntryFactorMap = FactorMap & {
  pcs_daily_eligibility: FinancialFactor<PcsDailyEligibility>;
  qqq_intraday_bars_valid: FinancialFactor<boolean>;
  qqq_intraday_regular_session: FinancialFactor<boolean>;
  qqq_intraday_data_fresh: FinancialFactor<boolean>;
  qqq_intraday_vwap: FinancialFactor<number>;
  qqq_intraday_price: FinancialFactor<number>;
  qqq_intraday_rsi_14: FinancialFactor<number>;
  vxn_change_1d: FinancialFactor<number>;
  vol_premium: FinancialFactor<number>;
};

export interface QqqPcsEntrySnapshot {
  symbol: typeof QQQ_PCS_SYMBOL;
  factors: FactorMap;
  dailyEligibility: FinancialFactor<PcsDailyEligibility>;
  intradayTiming: FinancialFactor<PcsIntradayTiming>;
}

const timingInputIds = [
  'qqq_intraday_bars_valid',
  'qqq_intraday_regular_session',
  'qqq_intraday_data_fresh',
  'qqq_intraday_vwap',
  'qqq_intraday_price',
  'qqq_intraday_rsi_14',
  'vxn_change_1d',
  'vol_premium',
] as const;

function usable<T>(factor: unknown, valid: (value: T) => boolean): factor is FinancialFactor<T> {
  return isFinancialFactor(factor)
    && factor.confidence > 0
    && factor.source.type !== 'fallback'
    && valid(factor.value as T);
}

function unavailable(reason: string): FinancialFactor<PcsIntradayTiming> {
  return fallbackFactor('INSUFFICIENT_DATA', reason);
}

function derivedTiming(
  value: Exclude<PcsIntradayTiming, 'INSUFFICIENT_DATA'>,
  factors: FactorMap,
): FinancialFactor<PcsIntradayTiming> {
  const inputs = timingInputIds.map((factorId) => ({ factorId, weight: 1 / timingInputIds.length }));
  return createDerivedFactor(value, inputs, factors);
}

/**
 * Intraday execution reference. Daily eligibility remains the hard gate;
 * VWAP extension caps chasing even when the explanatory score is high.
 */
export function evaluateQqqPcsIntradayTiming(factors: FactorMap): FinancialFactor<PcsIntradayTiming> {
  // Retain the timing reference independently; only model admission can grant entry.
  factors.qqq_pcs_execution_score = fallbackFactor(0, '盘中执行分输入不可用');
  factors.qqq_pcs_execution_timing = unavailable('盘中执行分输入不可用');
  const validIntraday = [
    usable<boolean>(factors.qqq_intraday_bars_valid, (value) => value === true),
    usable<boolean>(factors.qqq_intraday_regular_session, (value) => value === true),
    usable<boolean>(factors.qqq_intraday_data_fresh, (value) => value === true),
    usable<number>(factors.qqq_intraday_vwap, (value) => Number.isFinite(value) && value > 0),
    usable<number>(factors.qqq_intraday_price, (value) => Number.isFinite(value) && value > 0),
  ].every(Boolean);
  if (!validIntraday) return unavailable('缺少或陈旧的今日分钟线、VWAP 或常规交易时段输入');

  const price = Number(factors.qqq_intraday_price.value);
  const vwap = Number(factors.qqq_intraday_vwap.value);
  const vwapExtensionPct = (price / vwap - 1) * 100;
  const rsiAvailable = usable<number>(factors.qqq_intraday_rsi_14, (value) => Number.isFinite(value) && value >= 0 && value <= 100);
  const vxnAvailable = usable<number>(factors.vxn_change_1d, (value) => Number.isFinite(value));
  const premiumAvailable = usable<number>(factors.vol_premium, (value) => Number.isFinite(value) && value > 0);
  const score = [
    1,
    vwapExtensionPct <= QQQ_PCS_VWAP_SCORE_MAX_PCT ? 1 : 0,
    rsiAvailable && Number(factors.qqq_intraday_rsi_14.value) <= 65 ? 1 : 0,
    vxnAvailable && Number(factors.vxn_change_1d.value) <= 5 ? 1 : 0,
    premiumAvailable && Number(factors.vol_premium.value) >= 1 ? 1 : 0,
  ].reduce((total, point) => total + point, 0);
  factors.qqq_pcs_execution_score = createDerivedFactor(score, timingInputIds.map((factorId) => ({ factorId, weight: 1 / timingInputIds.length })), factors);
  const reference = derivedTiming(vwapExtensionPct >= 0.25 ? 'WAIT_PULLBACK' : score >= 4 ? 'NOW' : 'WAIT_CONFIRM', factors);
  factors.qqq_pcs_execution_timing = reference;
  const daily = factors.pcs_daily_eligibility;
  if (!usable<PcsDailyEligibility>(daily, value => value === 'OPEN' || value === 'WATCH' || value === 'BLOCK' || value === 'UNAVAILABLE') || daily.value === 'UNAVAILABLE') return unavailable('PCS 日线资格不可评估');
  if (daily.value === 'BLOCK') return derivedTiming('NO_ENTRY_SIGNAL', factors);
  if (daily.value === 'WATCH') return derivedTiming('WAIT_CONFIRM', factors);
  return reference;
}

export function buildQqqPcsEntrySnapshot(factors: QqqPcsEntryFactorMap): QqqPcsEntrySnapshot {
  const intradayTiming = evaluateQqqPcsIntradayTiming(factors);
  return {
    symbol: QQQ_PCS_SYMBOL,
    factors: { ...factors, qqq_pcs_intraday_timing: intradayTiming },
    dailyEligibility: factors.pcs_daily_eligibility,
    intradayTiming,
  };
}
