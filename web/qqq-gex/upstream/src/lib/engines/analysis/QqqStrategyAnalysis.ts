import type { CSMode } from '../leveraged-overlay/types/params';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import type { SellerStat } from './SellerStatsEngine';

export type QqqStrategyKind = 'pcs' | 'cs';

/** 独立 QQQ CS 页面固定使用当前上线候选，不提供 CS 模式选择。 */
export const QQQ_CS_PAGE_MODE = 'sp_like_dynamic' as const;
export const QQQ_CS_MODE_OPTIONS = [QQQ_CS_PAGE_MODE] as const satisfies readonly CSMode[];
/** 底层仍保留旧模式，供历史 RunSpec、旧 URL 和兼容性回放使用；不进入页面下拉。 */
export const QQQ_CS_ALL_MODE_OPTIONS = ['reactive', 'sp_like', 'sp_like_dynamic', 'bull', 'overbought', 'strict_recovery', 'extreme'] as const satisfies readonly CSMode[];
export type QqqCsMode = typeof QQQ_CS_ALL_MODE_OPTIONS[number];

export type QqqStrategyTiming = 'NOW' | 'WAIT_PULLBACK' | 'WAIT_CONFIRM' | 'NO_ENTRY_SIGNAL' | 'INSUFFICIENT_DATA';
export type QqqStrategyEligibility = 'OPEN' | 'WATCH' | 'BLOCK' | 'UNAVAILABLE';

export type QqqStrategyCandidate =
  | {
      status: 'READY';
      source: 'live_chain' | 'historical_model';
      optionType: 'call' | 'put';
      expiry: string;
      daysToExpiration: number;
      shortStrike: number;
      longStrike: number;
      width: number;
      netCredit: number;
      definedRisk: number;
      annualizedReturn: number;
      quantity?: number;
      maxRiskPct?: number;
      model?: { expiry: string; daysToExpiration: number; shortStrike: number; longStrike: number };
    }
  | { status: 'UNAVAILABLE'; reason: string };

export type QqqStrategyProbabilityContext = {
  strikeSurvival: {
    shortStrike: number;
    sigmaDist: number;
    d3: SellerStat;
    d5: SellerStat;
    d10: SellerStat;
    d3NoTouch: SellerStat;
    d5NoTouch: SellerStat;
    d10NoTouch: SellerStat;
    dte: { horizonDays: number; calendarDays: number; tradingDays: number; stat: SellerStat; noTouch: SellerStat } | null;
  } | null;
  anchoredManageability?: {
    recover5d: SellerStat;
    halfRetrace10d: SellerStat;
    repairSuccess: SellerStat;
    continueDrop5d: SellerStat;
    worstCase5dDropPct: SellerStat;
    medianRepairDays: SellerStat;
  } | null;
};

export type QqqStrategyReplaySignal = {
  date: string;
  eligibility: QqqStrategyEligibility;
  reasons: string[];
  gates: Array<{
    label: string;
    status: 'PASS' | 'BLOCK' | 'UNAVAILABLE';
    detail: string;
  }>;
};

export type QqqStrategyApiResponse = {
  strategy: QqqStrategyKind;
  strategyMode?: QqqCsMode;
  symbol: 'QQQ';
  asOf: string;
  view: { mode: 'live' | 'historical'; date: string | null };
  intraday: {
    granularity: '2m' | '1d';
    session: 'PREMARKET' | 'REGULAR' | 'DAILY';
    bars: Array<{ timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number }>;
    extendedHoursBars?: Array<{ timestamp: string; close: number; volume: number; open?: number; high?: number; low?: number }>;
    scoreSeries: Array<{ time: string; score: number }>;
  } | null;
  intradaySessionAsOf: string | null;
  dataStatus: 'LIVE' | 'STALE' | 'INSUFFICIENT';
  dataIssues: string[];
  daily: {
    eligibility: FinancialFactor<QqqStrategyEligibility>;
    reasons: string[];
    phase: 'PREMARKET' | 'PRELIMINARY' | 'CLOSED';
    asOf: string | null;
    confirmation: FinancialFactor<number>;
  };
  regime: {
    mode: 'unified' | 'overlay' | 'compare';
    selectedEngine: 'unified' | 'overlay';
    unified: string | null;
    overlay: string | null;
    disagreement: boolean;
  };
  timing: FinancialFactor<QqqStrategyTiming>;
  factors: FactorMap;
  gates: Array<{ id: string; label: string; status: 'PASS' | 'BLOCK' | 'UNAVAILABLE'; detail: string; factor?: FinancialFactor<unknown> }>;
  probabilityContext?: QqqStrategyProbabilityContext;
  lifecycle: {
    available: boolean;
    points: Array<{
      time: string;
      score: number;
      timing: QqqStrategyTiming;
      contract: QqqStrategyCandidate;
    }>;
  };
  candidate: QqqStrategyCandidate;
};
