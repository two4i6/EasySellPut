import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { createDerivedFactor, fallbackFactor, isFinancialFactor } from '../../factor';
import type { QqqStrategyEligibility, QqqStrategyTiming } from './QqqStrategyAnalysis';

export const QQQ_CS_VWAP_SCORE_MAX_PCT = 0.25;
export const QQQ_CS_INTRADAY_RANGE_MAX_POSITION_PCT = 75;
export const QQQ_CS_RSI_MAX = 65;

const scoreInputIds = [
  'qqq_intraday_bars_valid',
  'qqq_intraday_regular_session',
  'qqq_intraday_data_fresh',
  'cs_intraday_vwap_ok',
  'cs_intraday_range_ok',
  'cs_intraday_rsi_ok',
] as const;

const timingInputIds = [...scoreInputIds, 'cs_intraday_execution_score'] as const;

export type QqqCsEntryFactorMap = FactorMap & {
  cs_daily_eligibility: FinancialFactor<QqqStrategyEligibility>;
  qqq_intraday_bars_valid: FinancialFactor<boolean>;
  qqq_intraday_regular_session: FinancialFactor<boolean>;
  qqq_intraday_data_fresh: FinancialFactor<boolean>;
  qqq_intraday_vwap: FinancialFactor<number>;
  qqq_intraday_price: FinancialFactor<number>;
  qqq_intraday_low: FinancialFactor<number>;
  qqq_intraday_high: FinancialFactor<number>;
  qqq_intraday_rsi_14: FinancialFactor<number>;
};

export interface QqqCsEntrySnapshot {
  factors: FactorMap;
  dailyEligibility: FinancialFactor<QqqStrategyEligibility>;
  intradayTiming: FinancialFactor<QqqStrategyTiming>;
}

function usable<T>(factor: unknown, valid: (value: T) => boolean): factor is FinancialFactor<T> {
  return isFinancialFactor(factor)
    && factor.confidence > 0
    && factor.source.type !== 'fallback'
    && valid(factor.value as T);
}

function unavailable(reason: string): FinancialFactor<QqqStrategyTiming> {
  return fallbackFactor('INSUFFICIENT_DATA', reason);
}

function derivedTiming(value: Exclude<QqqStrategyTiming, 'INSUFFICIENT_DATA'>, factors: FactorMap, inputIds: readonly string[] = timingInputIds): FinancialFactor<QqqStrategyTiming> {
  return createDerivedFactor(value, inputIds.map((factorId) => ({ factorId, weight: 1 / inputIds.length })), factors);
}

function deriveScoreFactors(factors: FactorMap) {
  const baseIntradayIds = [
    'qqq_intraday_bars_valid',
    'qqq_intraday_regular_session',
    'qqq_intraday_data_fresh',
    'qqq_intraday_vwap',
    'qqq_intraday_price',
    'qqq_intraday_low',
    'qqq_intraday_high',
    'qqq_intraday_rsi_14',
  ] as const;
  const intradayReady = [
    usable<boolean>(factors.qqq_intraday_bars_valid, (value) => value === true),
    usable<boolean>(factors.qqq_intraday_regular_session, (value) => value === true),
    usable<boolean>(factors.qqq_intraday_data_fresh, (value) => value === true),
    usable<number>(factors.qqq_intraday_vwap, (value) => Number.isFinite(value) && value > 0),
    usable<number>(factors.qqq_intraday_price, (value) => Number.isFinite(value) && value > 0),
    usable<number>(factors.qqq_intraday_low, (value) => Number.isFinite(value) && value > 0),
    usable<number>(factors.qqq_intraday_high, (value) => Number.isFinite(value) && value > 0),
    usable<number>(factors.qqq_intraday_rsi_14, (value) => Number.isFinite(value) && value >= 0 && value <= 100),
  ].every(Boolean);
  factors.cs_intraday_data_ready = intradayReady
    ? createDerivedFactor(true, baseIntradayIds.map((factorId) => ({ factorId, weight: 1 / baseIntradayIds.length })), factors)
    : fallbackFactor(false, 'CS 盘中评分缺少有效分钟线、VWAP、日内区间或 RSI');

  const price = usable<number>(factors.qqq_intraday_price, (value) => Number.isFinite(value) && value > 0) ? Number(factors.qqq_intraday_price.value) : null;
  const vwap = usable<number>(factors.qqq_intraday_vwap, (value) => Number.isFinite(value) && value > 0) ? Number(factors.qqq_intraday_vwap.value) : null;
  const low = usable<number>(factors.qqq_intraday_low, (value) => Number.isFinite(value) && value > 0) ? Number(factors.qqq_intraday_low.value) : null;
  const high = usable<number>(factors.qqq_intraday_high, (value) => Number.isFinite(value) && value > 0) ? Number(factors.qqq_intraday_high.value) : null;
  const rsi = usable<number>(factors.qqq_intraday_rsi_14, (value) => Number.isFinite(value) && value >= 0 && value <= 100) ? Number(factors.qqq_intraday_rsi_14.value) : null;
  const vwapExtensionPct = price !== null && vwap !== null ? (price / vwap - 1) * 100 : null;
  const rangePositionPct = price !== null && low !== null && high !== null && high > low
    ? ((price - low) / (high - low)) * 100
    : null;
  const rawInputIds = (['qqq_intraday_price', 'qqq_intraday_vwap'] as const).map((factorId) => ({ factorId, weight: .5 }));
  factors.cs_intraday_vwap_extension_pct = vwapExtensionPct === null
    ? fallbackFactor(0, 'CS 盘中 VWAP 偏离不可用')
    : createDerivedFactor(vwapExtensionPct, rawInputIds, factors);
  factors.cs_intraday_range_position_pct = rangePositionPct === null
    ? fallbackFactor(0, 'CS 盘中日内区间不可用')
    : createDerivedFactor(rangePositionPct, ([
        ['qqq_intraday_price', .34],
        ['qqq_intraday_low', .33],
        ['qqq_intraday_high', .33],
      ] as const).map(([factorId, weight]) => ({ factorId, weight })), factors);
  factors.cs_intraday_vwap_ok = vwapExtensionPct === null
    ? fallbackFactor(false, 'CS 盘中 VWAP 偏离不可用')
    : createDerivedFactor(vwapExtensionPct <= QQQ_CS_VWAP_SCORE_MAX_PCT, [{ factorId: 'cs_intraday_vwap_extension_pct', weight: 1 }], factors);
  factors.cs_intraday_range_ok = rangePositionPct === null
    ? fallbackFactor(false, 'CS 盘中日内区间不可用')
    : createDerivedFactor(rangePositionPct <= QQQ_CS_INTRADAY_RANGE_MAX_POSITION_PCT, [{ factorId: 'cs_intraday_range_position_pct', weight: 1 }], factors);
  factors.cs_intraday_rsi_ok = rsi === null
    ? fallbackFactor(false, 'CS 盘中 RSI14 不可用')
    : createDerivedFactor(rsi <= QQQ_CS_RSI_MAX, [{ factorId: 'qqq_intraday_rsi_14', weight: 1 }], factors);

  const scoreAvailable = intradayReady && vwapExtensionPct !== null && rangePositionPct !== null && rsi !== null;
  factors.cs_intraday_execution_score = scoreAvailable
    ? createDerivedFactor([
        1,
        intradayReady ? 1 : 0,
        vwapExtensionPct <= QQQ_CS_VWAP_SCORE_MAX_PCT ? 1 : 0,
        rangePositionPct <= QQQ_CS_INTRADAY_RANGE_MAX_POSITION_PCT ? 1 : 0,
        rsi <= QQQ_CS_RSI_MAX ? 1 : 0,
      ].reduce((total, point) => total + point, 0), scoreInputIds.map((factorId) => ({ factorId, weight: 1 / scoreInputIds.length })), factors)
    : fallbackFactor(0, 'CS 盘中执行分输入不可用');
}

export function evaluateQqqCsIntradayTiming(factors: FactorMap): FinancialFactor<QqqStrategyTiming> {
  const daily = factors.cs_daily_eligibility;
  deriveScoreFactors(factors);
  const score = factors.cs_intraday_execution_score;
  const reference = score.confidence > 0 && score.source.type !== 'fallback'
    ? derivedTiming(Number(factors.cs_intraday_vwap_extension_pct.value) > QQQ_CS_VWAP_SCORE_MAX_PCT ? 'WAIT_PULLBACK' : Number(score.value) >= 4 ? 'NOW' : 'WAIT_CONFIRM', factors)
    : unavailable('CS 盘中评分输入不可用');
  factors.cs_intraday_execution_timing = reference;
  if (!usable<QqqStrategyEligibility>(daily, (value) => value === 'OPEN' || value === 'WATCH' || value === 'BLOCK' || value === 'UNAVAILABLE')) {
    return unavailable('缺少有效 CS 日线资格');
  }

  if (daily.value === 'UNAVAILABLE') return unavailable('CS 日线资格不可评估');
  if (daily.value === 'BLOCK') return derivedTiming('NO_ENTRY_SIGNAL', factors, ['cs_daily_eligibility']);
  if (factors.cs_intraday_data_ready?.confidence === 0 || factors.cs_intraday_vwap_ok?.confidence === 0 || factors.cs_intraday_range_ok?.confidence === 0 || factors.cs_intraday_rsi_ok?.confidence === 0) {
    return unavailable('缺少或陈旧的 CS 盘中评分输入，已按 fail closed 处理');
  }

  const vwapExtensionPct = Number(factors.cs_intraday_vwap_extension_pct.value);
  const executionScore = Number(factors.cs_intraday_execution_score.value);
  if (vwapExtensionPct > QQQ_CS_VWAP_SCORE_MAX_PCT) return derivedTiming('WAIT_PULLBACK', factors);
  return derivedTiming(executionScore >= 4 ? 'NOW' : 'WAIT_CONFIRM', factors);
}

export function buildQqqCsEntrySnapshot(factors: QqqCsEntryFactorMap): QqqCsEntrySnapshot {
  const intradayTiming = evaluateQqqCsIntradayTiming(factors);
  return {
    factors: { ...factors, cs_intraday_timing: intradayTiming },
    dailyEligibility: factors.cs_daily_eligibility,
    intradayTiming,
  };
}
