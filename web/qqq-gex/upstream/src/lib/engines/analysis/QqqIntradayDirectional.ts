import { qqqSessionVwap } from '../../qqqSessionVwap';
import { calculateRSI } from '../../indicators/indicators/momentum';
import { qqqMarketSession } from '../../qqqMarketSession';
import { createDerivedFactor, createRawFactor, fallbackFactor } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import {qqqGexObservation,compareQqqGexObservations,type GexObservationStrike} from '@/lib/qqqGexObservationComparison';
import {qqqGexDisplayStrikeValid} from '@/lib/qqqGexInputQuality';

export const QQQ_INTRADAY_DIRECTIONAL_POLICY = {
  id: 'qqq-directional-intraday-v7',
  sessionInputVersion: 'qqq-normal-session-closed-bars-v2',
  barMinutes: 2,
  alertStartEtMinutes: 10 * 60,
  entryEndEtMinutes: 13 * 60,
  alertEndEtMinutes: 15 * 60 + 58,
  marketCloseEtMinutes: 16 * 60,
  maxEntrySignalsPerDay: 3,
  maxRiskCuesPerDay: 3,
  maxBarAgeSeconds: 4 * 60,
  maxGexAgeSeconds: 6 * 60,
  minBars: 15,
  expiryLimit: 3,
  minExpiries: 2,
  completeDayDataCoverageRatio: 0.80,
  trendSlopeAtr: 0.25,
  rangeSlopeAtr: 0.10,
  confluenceDistanceAtr: 0.30,
  zoneHalfWidthAtr: 0.20,
  zoneHalfWidthSpotPct: 0.0012,
  invalidationBufferAtr: 0.15,
  breakoutVolumeRatio: 1.5,
  gradeBRangeVolumeRatio: 1.8,
  gradeCEarliestEtMinutes: 10 * 60,
  gradeCTransitionBiasAtr: 0.10,
  gradeCArmDistanceAtr: 0.30,
  rearmExcursionAtr: 0.50,
  rearmStructureChangeAtr: 0.30,
  riskConfirmationVolumeRatio: 1.5,
  validBars: 3,
  dedupeBars: 8,
  maxPlanMinutes: 30,
  minimumStructureR: 1.5,
  gradeBMinimumStructureR: 1.25,
  gradeCMinimumStructureR: 1.0,
  maximumDisplayedTargetR: 2,
  researchStatus: 'EXPERIMENTAL' as const,
  forwardWindowStartDate: '2026-08-10',
} as const;

export type QqqIntradayRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'TRANSITION' | 'UNAVAILABLE';
export type QqqIntradayDirection = 'LONG' | 'SHORT';
export type QqqIntradaySignalGrade = 'A' | 'B' | 'C';
export type QqqIntradaySignalIntent = 'ENTRY' | 'RISK_CUE';
export type QqqIntradaySignalStage = 'SETUP' | 'ARMED' | 'TRIGGERED' | 'RISK_ELEVATED' | 'STOP_RISK';
export type QqqIntradayAlertType = 'OPPORTUNITY' | 'CONFIRMED' | 'RISK';
export type QqqIntradayRiskSide = 'SC' | 'SP';
export type QqqIntradayPlaybook = 'TREND_PULLBACK' | 'RANGE_REVERSAL' | 'DIRECTIONAL_WATCH';

export type QqqIntradayDirectionalReasonCode =
  | 'OUTSIDE_ALERT_WINDOW'
  | 'BAR_DATA_STALE'
  | 'GEX_DATA_STALE'
  | 'NOT_ENOUGH_BARS'
  | 'NOT_ENOUGH_EXPIRIES'
  | 'PARTIAL_GEX_INPUT'
  | 'MISSING_GEX_STRUCTURE'
  | 'TRANSITION_REGIME'
  | 'NO_CONFLUENT_ZONE'
  | 'NO_SWEEP_RECLAIM'
  | 'NO_TREND_RECLAIM'
  | 'RSI_NOT_TURNING'
  | 'VOLUME_CONFIRMS_BREAKOUT'
  | 'GEX_WORSENING'
  | 'WALL_BREACHED'
  | 'COUNTER_TREND_BLOCKED'
  | 'DUPLICATE_SIGNAL'
  | 'ENTRY_SIGNAL_BUDGET_REACHED'
  | 'RISK_CUE_BUDGET_REACHED'
  | 'AFTERNOON_RISK_CUE'
  | 'C_SETUP_READY'
  | 'C_ARMED'
  | 'C_TRIGGER_NOT_CONFIRMED'
  | 'RISK_ELEVATED'
  | 'STOP_RISK_CONFIRMED'
  | 'NO_RISK_STRUCTURE'
  | 'REARM_NOT_READY'
  | 'CANDIDATE_WINDOW_NOT_OPEN'
  | 'NO_DIRECTIONAL_BIAS'
  | 'STRUCTURE_TARGET_BELOW_1_5R'
  | 'STRUCTURE_TARGET_BELOW_1_25R'
  | 'STRUCTURE_TARGET_BELOW_1R'
  | 'GRADE_A_SETUP_READY'
  | 'GRADE_B_SETUP_READY'
  | 'GRADE_C_CONTEXT_READY'
  | 'LONG_SETUP_READY'
  | 'SHORT_SETUP_READY';

export type QqqIntradayDirectionalVerdict = {
  status: 'BLOCKED' | 'WATCH' | 'LONG' | 'SHORT';
  regime: QqqIntradayRegime;
  playbook: QqqIntradayPlaybook | null;
  grade: QqqIntradaySignalGrade | null;
  intent: QqqIntradaySignalIntent | null;
  direction: QqqIntradayDirection | null;
  stage: QqqIntradaySignalStage | null;
  riskSide: QqqIntradayRiskSide | null;
  confidence: number;
  reasonCodes: QqqIntradayDirectionalReasonCode[];
};

export type QqqIntradayDirectionalDecision = {
  policyVersion: typeof QQQ_INTRADAY_DIRECTIONAL_POLICY.id;
  status: 'INSUFFICIENT_DATA' | 'NO_SIGNAL' | 'WATCH' | 'ALERT_LONG' | 'ALERT_SHORT';
  signalId: string | null;
  structureId: string | null;
  alertType: QqqIntradayAlertType | null;
  direction: QqqIntradayDirection | null;
  regime: QqqIntradayRegime;
  playbook: QqqIntradayPlaybook | null;
  grade: QqqIntradaySignalGrade | null;
  intent: QqqIntradaySignalIntent | null;
  stage: QqqIntradaySignalStage | null;
  riskPlan: {
    atRisk: QqqIntradayRiskSide;
    severity: 'ELEVATED' | 'STOP';
    triggerZone: { low: number; high: number };
    recoveryLevel: number;
  } | null;
  structureContext: {
    atr: number;
    callWall: number;
    putWall: number;
    gammaFlip: number;
  } | null;
  anchorBar: string | null;
  entryZone: { low: number; high: number } | null;
  invalidation: number | null;
  targets: { oneR: number; structure: number; structureR: number } | null;
  validUntil: string | null;
  planExpiresAt: string | null;
  reasonCodes: QqqIntradayDirectionalReasonCode[];
  blockers: QqqIntradayDirectionalReasonCode[];
  dataQuality: {
    evaluatedAt?: string;
    barAgeSeconds: number | null;
    gexAgeSeconds: number | null;
    barCount: number;
    validExpiries: number;
    partialGex?: boolean;
    selectedExpiries: string[];
    quoteCoverage: { available: number; total: number; ratio: number | null };
  };
  researchStatus: 'EXPERIMENTAL' | 'VALIDATION_FAIL' | 'VALIDATED';
};

export type QqqIntradayBar = {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume: number;
};

export type QqqIntradayGexStrike = GexObservationStrike & {
  strike: number;
  callReceivedAt?: string;
  putReceivedAt?: string;
  callGex?: number;
  putGex?: number;
  totalGex?: number;
  callBid?: number;
  callAsk?: number;
  callMid?: number;
  callIv?: number;
  callDelta?: number;
  callGamma?: number;
  putBid?: number;
  putAsk?: number;
  putMid?: number;
  putIv?: number;
  putDelta?: number;
  putGamma?: number;
};

export type QqqIntradayGexSnapshot = {
  sourceAsOf?: string;
  calculationVersion?: string;
  inputComplete?: boolean;
  time: string;
  netGex: number;
  gammaFlip: number | null;
  callWallPrice: number | null;
  putWallPrice: number | null;
  profile?: QqqIntradayGexStrike[];
};

export type QqqIntradayGexExpiry = {
  expiryDate: string;
  dte: number;
  snapshots: QqqIntradayGexSnapshot[];
};

export type BuildQqqIntradayDirectionalFactorsInput = {
  asOf: string;
  bars: readonly QqqIntradayBar[];
  expiries: readonly QqqIntradayGexExpiry[];
};

export type QqqIntradayDirectionalFactorBuild = {
  factors: FactorMap;
  closedBars: QqqIntradayBar[];
};

const FACTOR = {
  policy: 'qqq_dir_policy_version',
  sessionContract: 'qqq_dir_session_input_version',
  asOf: 'qqq_dir_as_of_ms',
  anchor: 'qqq_dir_anchor_bar_ms',
  sessionDate: 'qqq_dir_session_date',
  etMinute: 'qqq_dir_et_minute',
  price: 'qqq_dir_price',
  barCount: 'qqq_dir_bar_count',
  barAge: 'qqq_dir_bar_age_seconds',
  gexAge: 'qqq_dir_gex_age_seconds',
  expiryCount: 'qqq_dir_expiry_count',
  selectedExpiries: 'qqq_dir_selected_expiries',
  quoteAvailable: 'qqq_dir_quote_available',
  quoteTotal: 'qqq_dir_quote_total',
  dataReady: 'qqq_dir_data_ready',
  alertWindow: 'qqq_dir_alert_window',
  sessionIntent: 'qqq_dir_session_intent',
  atr: 'qqq_dir_atr10',
  vwap: 'qqq_dir_vwap',
  ema20: 'qqq_dir_ema20',
  vwapSlope: 'qqq_dir_vwap_slope_atr_10m',
  emaSlope: 'qqq_dir_ema20_slope_atr_10m',
  regime: 'qqq_dir_regime',
  orHigh: 'qqq_dir_or15_high',
  orLow: 'qqq_dir_or15_low',
  rsi: 'qqq_dir_rsi14',
  rsiLongTurn: 'qqq_dir_rsi_long_turn',
  rsiShortTurn: 'qqq_dir_rsi_short_turn',
  rsiLongStep: 'qqq_dir_rsi_long_step',
  rsiShortStep: 'qqq_dir_rsi_short_step',
  priceVsVwapAtr: 'qqq_dir_price_vs_vwap_atr',
  directionalBias: 'qqq_dir_directional_bias',
  longZoneDistanceAtr: 'qqq_dir_long_zone_distance_atr',
  shortZoneDistanceAtr: 'qqq_dir_short_zone_distance_atr',
  volumeRatio: 'qqq_dir_volume_ratio',
  volumeBreakout: 'qqq_dir_volume_breakout',
  gexBalance: 'qqq_dir_gex_balance',
  gexDelta: 'qqq_dir_gex_balance_delta',
  partialGex: 'qqq_dir_partial_gex',
  putWall: 'qqq_dir_put_wall',
  callWall: 'qqq_dir_call_wall',
  flip: 'qqq_dir_gamma_flip',
  supportLow: 'qqq_dir_support_zone_low',
  supportHigh: 'qqq_dir_support_zone_high',
  supportCount: 'qqq_dir_support_confluence_count',
  resistanceLow: 'qqq_dir_resistance_zone_low',
  resistanceHigh: 'qqq_dir_resistance_zone_high',
  resistanceCount: 'qqq_dir_resistance_confluence_count',
  momentumLow: 'qqq_dir_momentum_zone_low',
  momentumHigh: 'qqq_dir_momentum_zone_high',
  momentumCount: 'qqq_dir_momentum_confluence_count',
  momentumDistanceAtr: 'qqq_dir_momentum_zone_distance_atr',
  momentumLongConfirm: 'qqq_dir_momentum_long_confirm',
  momentumShortConfirm: 'qqq_dir_momentum_short_confirm',
  longReclaim: 'qqq_dir_long_reclaim',
  shortReclaim: 'qqq_dir_short_reclaim',
  longSweepReclaim: 'qqq_dir_long_sweep_reclaim',
  shortSweepReclaim: 'qqq_dir_short_sweep_reclaim',
  longVolumeOk: 'qqq_dir_long_volume_ok',
  shortVolumeOk: 'qqq_dir_short_volume_ok',
  longSweepExtreme: 'qqq_dir_long_sweep_extreme',
  shortSweepExtreme: 'qqq_dir_short_sweep_extreme',
  longGexOk: 'qqq_dir_long_gex_ok',
  shortGexOk: 'qqq_dir_short_gex_ok',
  longWallOk: 'qqq_dir_long_wall_ok',
  shortWallOk: 'qqq_dir_short_wall_ok',
  longInvalidation: 'qqq_dir_long_invalidation',
  shortInvalidation: 'qqq_dir_short_invalidation',
  longTarget: 'qqq_dir_long_structure_target',
  shortTarget: 'qqq_dir_short_structure_target',
  longStructureR: 'qqq_dir_long_structure_r',
  shortStructureR: 'qqq_dir_short_structure_r',
  momentumLongInvalidation: 'qqq_dir_momentum_long_invalidation',
  momentumShortInvalidation: 'qqq_dir_momentum_short_invalidation',
  momentumLongTarget: 'qqq_dir_momentum_long_target',
  momentumShortTarget: 'qqq_dir_momentum_short_target',
  momentumLongStructureR: 'qqq_dir_momentum_long_structure_r',
  momentumShortStructureR: 'qqq_dir_momentum_short_structure_r',
  lifecycleStructureId: 'qqq_dir_lifecycle_structure_id',
  lifecycleAnchor: 'qqq_dir_lifecycle_anchor_ms',
  duplicateSuppressed: 'qqq_dir_duplicate_suppressed',
  rearmSuppressed: 'qqq_dir_rearm_suppressed',
  entryBudgetReached: 'qqq_dir_entry_budget_reached',
  riskCueBudgetReached: 'qqq_dir_risk_cue_budget_reached',
  scRiskElevated: 'qqq_dir_sc_risk_elevated',
  spRiskElevated: 'qqq_dir_sp_risk_elevated',
  scStopRisk: 'qqq_dir_sc_stop_risk',
  spStopRisk: 'qqq_dir_sp_stop_risk',
} as const;

export const QQQ_INTRADAY_DIRECTIONAL_FACTORS = FACTOR;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const ET_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const ET_PARTS_CACHE = new Map<number, { date: string; minute: number }>();
const etParts = (date: Date) => {
  const timestamp = date.getTime();
  const cached = ET_PARTS_CACHE.get(timestamp);
  if (cached) return cached;
  const parts = ET_FORMATTER.formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const hour = Number(parts.hour) % 24;
  const result = {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: hour * 60 + Number(parts.minute),
  };
  if (ET_PARTS_CACHE.size >= 20_000) ET_PARTS_CACHE.clear();
  ET_PARTS_CACHE.set(timestamp, result);
  return result;
};

const emaSeries = (values: number[], period: number) => {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const result = [values[0]!];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index]! * alpha + result[index - 1]! * (1 - alpha));
  }
  return result;
};

// Wilder RSI14, shared with the chart; v7 invalidates older monitor evidence.
const rsiSeries = (values: number[], period = 14) =>
  calculateRSI(values, values.map((_, index) => index), period).map(point => point.value);

const atr10 = (bars: QqqIntradayBar[]) => {
  if (bars.length < 11) return null;
  const ranges = bars.slice(-10).map((bar, index, selected) => {
    const globalIndex = bars.length - selected.length + index;
    const previousClose = bars[globalIndex - 1]?.close ?? bar.close;
    const high = positive(bar.high) ? bar.high : Math.max(bar.close, positive(bar.open) ? bar.open : bar.close);
    const low = positive(bar.low) ? bar.low : Math.min(bar.close, positive(bar.open) ? bar.open : bar.close);
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  });
  return mean(ranges);
};

const vwapSeries = (bars: QqqIntradayBar[]) => {
  const points = new Map(qqqSessionVwap(bars).map(point => [point.openedAt, point.value]));
  return bars.map(bar => points.get(Date.parse(bar.timestamp)) ?? null);
};

const rawNumber = (value: number, api: string, fallbackValue = 0) => createRawFactor(
  value,
  finite,
  api,
  undefined,
  fallbackValue,
);
const rawPositive = (value: number, api: string) => createRawFactor(value, positive, api, undefined, 0);
const rawString = (value: string, api: string) => createRawFactor(value, (candidate) => candidate.length > 0, api, undefined, '');
const manual = <T>(value: T, description: string): FinancialFactor<T> => ({
  value, confidence: 7, source: { type: 'manual', description },
});
const derived = <T>(factors: FactorMap, id: string, value: T, dependencies: string[]) => {
  if (!dependencies.length || dependencies.some((dependency) => !factors[dependency] || factors[dependency]!.confidence === 0)) {
    factors[id] = fallbackFactor(value, `缺失派生依赖: ${dependencies.filter((dependency) => !factors[dependency] || factors[dependency]!.confidence === 0).join(', ')}`);
    return;
  }
  factors[id] = createDerivedFactor(
    value,
    dependencies.map((factorId) => ({ factorId, weight: 1 / dependencies.length })),
    factors,
  );
};

const densestCluster = (values: number[], maximumDistance: number) => {
  const sorted = values.filter(positive).sort((a, b) => a - b);
  let best: number[] = [];
  for (let start = 0; start < sorted.length; start += 1) {
    const cluster = sorted.slice(start).filter((value) => value - sorted[start]! <= maximumDistance);
    if (cluster.length > best.length) best = cluster;
  }
  return { center: median(best), count: best.length };
};

const quoteCoverage = (snapshots: QqqIntradayGexSnapshot[]) => {
  const strikes = snapshots.flatMap((snapshot) => snapshot.profile ?? []);
  const keys: Array<keyof QqqIntradayGexStrike> = [
    'callBid', 'callAsk', 'callMid', 'callIv', 'callDelta', 'callGamma',
    'putBid', 'putAsk', 'putMid', 'putIv', 'putDelta', 'putGamma',
  ];
  const total = strikes.length * keys.length;
  const available = strikes.reduce((count, strike) => count + keys.filter((key) => finite(strike[key])).length, 0);
  return { total, available };
};

export function buildQqqIntradayDirectionalFactors(input: BuildQqqIntradayDirectionalFactorsInput): QqqIntradayDirectionalFactorBuild {
  const factors: FactorMap = {};
  const asOfMs = Date.parse(input.asOf);
  const validAsOfMs = finite(asOfMs) ? asOfMs : 0;
  const asOfDate = new Date(validAsOfMs);
  const session = etParts(asOfDate);
  const sourceBars = new Map(input.bars.map(bar => [Date.parse(bar.timestamp), bar]));
  const closedBars = [...sourceBars.values()]
    .filter((bar) => positive(bar.close) && Date.parse(bar.timestamp) + QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000 <= validAsOfMs)
    .filter((bar) => etParts(new Date(bar.timestamp)).date === session.date && qqqMarketSession(new Date(bar.timestamp)).stocksOpen)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const latestBar = closedBars.at(-1) ?? null;
  const anchorMs = latestBar ? Date.parse(latestBar.timestamp) : 0;
  const anchorCloseMs = anchorMs + QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000;

  factors[FACTOR.policy] = manual(QQQ_INTRADAY_DIRECTIONAL_POLICY.id, '冻结方向策略版本');
  factors[FACTOR.sessionContract] = manual(QQQ_INTRADAY_DIRECTIONAL_POLICY.sessionInputVersion, '正常盘已完成 K 线输入契约');
  factors[FACTOR.asOf] = rawNumber(validAsOfMs, 'request.asOf');
  factors[FACTOR.sessionDate] = rawString(session.date, 'request.asOf');
  factors[FACTOR.etMinute] = rawNumber(session.minute, 'request.asOf');
  factors[FACTOR.barCount] = rawNumber(closedBars.length, 'qqq.2m.closedBars');
  factors[FACTOR.anchor] = latestBar ? rawNumber(anchorMs, 'qqq.2m.closedBars') : fallbackFactor(0, '没有已收盘 2 分钟 K 线');
  factors[FACTOR.price] = latestBar ? rawPositive(latestBar.close, 'qqq.2m.closedBars') : fallbackFactor(0, '没有已收盘 2 分钟 K 线');
  factors[FACTOR.barAge] = latestBar ? rawNumber(Math.max(0, (validAsOfMs - anchorCloseMs) / 1000), 'qqq.2m.closedBars') : fallbackFactor(Number.POSITIVE_INFINITY, '没有已收盘 2 分钟 K 线');

  const selectedCandidates = input.expiries
    .filter((expiry) => Number.isInteger(expiry.dte) && expiry.dte >= 0 && expiry.expiryDate.length > 0)
    .sort((left, right) => left.dte - right.dte || left.expiryDate.localeCompare(right.expiryDate))
    .map((expiry) => {
      const available = expiry.snapshots.filter(snapshot=>Date.parse(snapshot.time)<=anchorCloseMs).map(snapshot=>{
        const observation=qqqGexObservation(snapshot);
        if(!observation||!finite(observation.net))return {...snapshot,observation:null};
        const valid=snapshot.profile?.filter(p=>(!observation.values || observation.values.has(p.strike))&&qqqGexDisplayStrikeValid(p)&&finite(p.callGex)&&finite(p.putGex)&&finite(p.totalGex))??[];
        const strongest=(side:'callGex'|'putGex')=>valid.reduce<QqqIntradayGexStrike|null>((best,p)=>Math.abs(p[side]!)>Math.abs(best?.[side]??0)?p:best,null)?.strike??null;
        return {...snapshot,netGex:observation.net,observation,
          ...(observation.partial?{callWallPrice:strongest('callGex'),putWallPrice:strongest('putGex'),gammaFlip:null}:{})};
      });
      const newestVersion = available.slice().sort((a,b) => Date.parse(b.time)-Date.parse(a.time))[0]?.calculationVersion;
      const causal = available
        .filter(snapshot => snapshot.calculationVersion === newestVersion)
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
      return { expiry, causal, current: causal.at(-1) ?? null, previous: causal.at(-2) ?? null };
    })
    .filter((item) => item.current)
    .slice(0, QQQ_INTRADAY_DIRECTIONAL_POLICY.expiryLimit);
  const newestCalculationVersion = selectedCandidates.slice().sort((a,b) => Date.parse(b.current!.time)-Date.parse(a.current!.time))[0]?.current?.calculationVersion;
  const selected = selectedCandidates.filter((item) => (
    item.current!.observation!==null && item.current!.calculationVersion === newestCalculationVersion &&
    validAsOfMs - Date.parse(item.current!.sourceAsOf ?? item.current!.time) <= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds * 1_000
    && Date.parse(item.current!.sourceAsOf ?? item.current!.time) <= validAsOfMs
  ));
  const validSnapshots = selected.map((item) => item.current!);
  const gexReferenceMs = validSnapshots.length
    ? Math.min(...validSnapshots.map((snapshot) => Date.parse(snapshot.sourceAsOf ?? snapshot.time)))
    : selectedCandidates.length
      ? Math.max(...selectedCandidates.map((item) => Date.parse(item.current!.time)))
      : 0;
  const gexAge = gexReferenceMs > 0 ? Math.max(0, (validAsOfMs - gexReferenceMs) / 1000) : Number.POSITIVE_INFINITY;
  const coverage = quoteCoverage(validSnapshots);
  const partialGex=validSnapshots.some(s=>s.observation!.partial);
  factors[FACTOR.partialGex]=rawNumber(partialGex?1:0,'qqq.gex.valid-subset');

  factors[FACTOR.expiryCount] = rawNumber(selected.length, 'qqq.gex.expiries');
  factors[FACTOR.selectedExpiries] = selected.length
    ? rawString(selected.map((item) => item.expiry.expiryDate).join(','), 'qqq.gex.expiries')
    : fallbackFactor('', '没有有效 GEX 到期日');
  factors[FACTOR.gexAge] = gexReferenceMs > 0 ? rawNumber(gexAge, 'qqq.gex.history') : fallbackFactor(Number.POSITIVE_INFINITY, '没有因果 GEX 快照');
  factors[FACTOR.quoteAvailable] = rawNumber(coverage.available, 'qqq.gex.profile');
  factors[FACTOR.quoteTotal] = rawNumber(coverage.total, 'qqq.gex.profile');

  const dataReady = Boolean(
    latestBar
    && closedBars.length >= QQQ_INTRADAY_DIRECTIONAL_POLICY.minBars
    && selected.length >= QQQ_INTRADAY_DIRECTIONAL_POLICY.minExpiries
    && !partialGex
    && (factors[FACTOR.barAge]!.value as number) <= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxBarAgeSeconds
    && gexAge <= QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds,
  );
  derived(factors, FACTOR.dataReady, dataReady, [FACTOR.barCount, FACTOR.barAge, FACTOR.expiryCount, FACTOR.gexAge]);
  derived(
    factors,
    FACTOR.alertWindow,
    qqqMarketSession(new Date(validAsOfMs)).stocksOpen && session.minute >= QQQ_INTRADAY_DIRECTIONAL_POLICY.alertStartEtMinutes && session.minute <= QQQ_INTRADAY_DIRECTIONAL_POLICY.alertEndEtMinutes,
    [FACTOR.etMinute],
  );
  derived(
    factors,
    FACTOR.sessionIntent,
    session.minute <= QQQ_INTRADAY_DIRECTIONAL_POLICY.entryEndEtMinutes ? 'ENTRY' as const : 'RISK_CUE' as const,
    [FACTOR.etMinute],
  );

  if (!latestBar || closedBars.length < 11) {
    for (const id of Object.values(FACTOR).slice(Object.values(FACTOR).indexOf(FACTOR.atr))) {
      if (!factors[id]) factors[id] = fallbackFactor(0, 'K 线不足，无法构建方向特征');
    }
    return { factors, closedBars };
  }

  const closes = closedBars.map((bar) => bar.close);
  const vwaps = vwapSeries(closedBars);
  const emas = emaSeries(closes, 20);
  const atr = atr10(closedBars) ?? 0;
  const currentVwap = vwaps.at(-1) ?? 0;
  const currentEma = emas.at(-1) ?? 0;
  factors[FACTOR.atr] = rawPositive(atr, 'qqq.2m.closedBars.atr10');
  factors[FACTOR.vwap] = rawPositive(currentVwap, 'qqq.2m.closedBars.vwap');
  factors[FACTOR.ema20] = rawPositive(currentEma, 'qqq.2m.closedBars.ema20');

  const vwapSlope = atr > 0 && finite(vwaps.at(-6)) ? (currentVwap - vwaps.at(-6)!) / atr : 0;
  const emaSlope = atr > 0 && emas.length >= 6 ? (currentEma - emas.at(-6)!) / atr : 0;
  derived(factors, FACTOR.vwapSlope, vwapSlope, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.emaSlope, emaSlope, [FACTOR.ema20, FACTOR.atr]);
  const regime: QqqIntradayRegime = vwapSlope >= QQQ_INTRADAY_DIRECTIONAL_POLICY.trendSlopeAtr && emaSlope >= QQQ_INTRADAY_DIRECTIONAL_POLICY.trendSlopeAtr
    ? 'TREND_UP'
    : vwapSlope <= -QQQ_INTRADAY_DIRECTIONAL_POLICY.trendSlopeAtr && emaSlope <= -QQQ_INTRADAY_DIRECTIONAL_POLICY.trendSlopeAtr
      ? 'TREND_DOWN'
      : Math.abs(vwapSlope) <= QQQ_INTRADAY_DIRECTIONAL_POLICY.rangeSlopeAtr && Math.abs(emaSlope) <= QQQ_INTRADAY_DIRECTIONAL_POLICY.rangeSlopeAtr
        ? 'RANGE'
        : 'TRANSITION';
  derived(factors, FACTOR.regime, regime, [FACTOR.vwapSlope, FACTOR.emaSlope]);

  const openingBars = closedBars.filter((bar) => {
    const minute = etParts(new Date(bar.timestamp)).minute;
    return minute >= 9 * 60 + 30 && minute < 9 * 60 + 45;
  });
  const orHigh = openingBars.length ? Math.max(...openingBars.map((bar) => positive(bar.high) ? bar.high : bar.close)) : 0;
  const orLow = openingBars.length ? Math.min(...openingBars.map((bar) => positive(bar.low) ? bar.low : bar.close)) : 0;
  factors[FACTOR.orHigh] = orHigh > 0 ? rawPositive(orHigh, 'qqq.2m.openingRange15') : fallbackFactor(0, '缺少开盘 15 分钟 K 线');
  factors[FACTOR.orLow] = orLow > 0 ? rawPositive(orLow, 'qqq.2m.openingRange15') : fallbackFactor(0, '缺少开盘 15 分钟 K 线');

  const rsis = rsiSeries(closes);
  const latestRsis = rsis.filter(finite).slice(-3);
  const currentRsi = rsis.at(-1);
  factors[FACTOR.rsi] = finite(currentRsi) ? rawNumber(currentRsi, 'qqq.2m.closedBars.rsi14') : fallbackFactor(50, 'RSI14 样本不足');
  const rsiLongTurn = latestRsis.length === 3 && latestRsis[2]! > latestRsis[1]! && latestRsis[1]! >= latestRsis[0]!;
  const rsiShortTurn = latestRsis.length === 3 && latestRsis[2]! < latestRsis[1]! && latestRsis[1]! <= latestRsis[0]!;
  const rsiLongStep = latestRsis.length >= 2 && latestRsis.at(-1)! > latestRsis.at(-2)!;
  const rsiShortStep = latestRsis.length >= 2 && latestRsis.at(-1)! < latestRsis.at(-2)!;
  derived(factors, FACTOR.rsiLongTurn, rsiLongTurn, [FACTOR.rsi]);
  derived(factors, FACTOR.rsiShortTurn, rsiShortTurn, [FACTOR.rsi]);
  derived(factors, FACTOR.rsiLongStep, rsiLongStep, [FACTOR.rsi]);
  derived(factors, FACTOR.rsiShortStep, rsiShortStep, [FACTOR.rsi]);

  const priceVsVwapAtr = atr > 0 ? (latestBar.close - currentVwap) / atr : 0;
  derived(factors, FACTOR.priceVsVwapAtr, priceVsVwapAtr, [FACTOR.price, FACTOR.vwap, FACTOR.atr]);
  const transitionSlope = (vwapSlope + emaSlope) / 2;
  const directionalBias: QqqIntradayDirection | 'NEUTRAL' = regime === 'TREND_UP'
    ? 'LONG'
    : regime === 'TREND_DOWN'
      ? 'SHORT'
      : regime === 'RANGE'
        ? priceVsVwapAtr < 0 ? 'LONG' : priceVsVwapAtr > 0 ? 'SHORT' : 'NEUTRAL'
        : transitionSlope >= QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCTransitionBiasAtr && priceVsVwapAtr >= 0
          ? 'LONG'
          : transitionSlope <= -QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCTransitionBiasAtr && priceVsVwapAtr <= 0
            ? 'SHORT'
            : 'NEUTRAL';
  derived(factors, FACTOR.directionalBias, directionalBias, [FACTOR.regime, FACTOR.vwapSlope, FACTOR.emaSlope, FACTOR.priceVsVwapAtr]);

  const previousVolumes = closedBars.slice(-11, -1).map((bar) => bar.volume);
  const volumeComplete = previousVolumes.length === 10 && previousVolumes.every(value => finite(value) && value >= 0) && finite(latestBar.volume) && latestBar.volume >= 0;
  const volumeMedian = volumeComplete ? median(previousVolumes) ?? 0 : 0;
  const volumeRatio = volumeMedian > 0 ? latestBar.volume / volumeMedian : 0;
  factors[FACTOR.volumeRatio] = volumeComplete && volumeMedian > 0 ? rawNumber(volumeRatio, 'qqq.2m.closedBars.volume') : fallbackFactor(0, '成交量覆盖不足或基准为零，量比不可用');
  derived(factors, FACTOR.volumeBreakout, volumeRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.breakoutVolumeRatio, [FACTOR.volumeRatio]);

  const balances = validSnapshots.map((snapshot) => snapshot.netGex);
  const balance = median(balances) ?? 0;
  const comparisons = selected.flatMap(item => {
    const compared = compareQqqGexObservations(item.current!, item.previous);
    return compared ? [compared] : [];
  });
  const balanceDeltas = comparisons.map(comparison => comparison.delta);
  const partialDelta = comparisons.some(comparison => comparison.partial);
  const balanceDelta = median(balanceDeltas);
  const putWall = median(validSnapshots.map((snapshot) => snapshot.putWallPrice).filter(positive)) ?? 0;
  const callWall = median(validSnapshots.map((snapshot) => snapshot.callWallPrice).filter(positive)) ?? 0;
  const gammaFlip = median(validSnapshots.map((snapshot) => snapshot.gammaFlip).filter(positive)) ?? 0;
  factors[FACTOR.gexBalance] = selected.length >= QQQ_INTRADAY_DIRECTIONAL_POLICY.minExpiries ? rawNumber(balance, 'qqq.gex.multiexpiry') : fallbackFactor(0, '有效到期日不足');
  factors[FACTOR.gexDelta] = balanceDeltas.length >= QQQ_INTRADAY_DIRECTIONAL_POLICY.minExpiries && balanceDelta!==null ? rawNumber(balanceDelta,partialDelta?'qqq.gex.common-valid-strikes':'qqq.gex.multiexpiry') : fallbackFactor(null, '没有足够的可比前后快照');
  if (partialGex) factors[FACTOR.gexBalance]!.confidence = Math.min(5, factors[FACTOR.gexBalance]!.confidence);
  if (partialDelta) factors[FACTOR.gexDelta]!.confidence = Math.min(5, factors[FACTOR.gexDelta]!.confidence);
  factors[FACTOR.putWall] = putWall > 0 ? rawPositive(putWall, 'qqq.gex.multiexpiry') : fallbackFactor(0, 'Put Wall 不可用');
  factors[FACTOR.callWall] = callWall > 0 ? rawPositive(callWall, 'qqq.gex.multiexpiry') : fallbackFactor(0, 'Call Wall 不可用');
  factors[FACTOR.flip] = gammaFlip > 0 ? rawPositive(gammaFlip, 'qqq.gex.multiexpiry') : fallbackFactor(0, 'Gamma Flip 不可用');

  const maximumClusterDistance = atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.confluenceDistanceAtr;
  const support = densestCluster([currentVwap, orLow, putWall, gammaFlip], maximumClusterDistance);
  const resistance = densestCluster([currentVwap, orHigh, callWall, gammaFlip], maximumClusterDistance);
  const halfWidth = Math.min(atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.zoneHalfWidthAtr, latestBar.close * QQQ_INTRADAY_DIRECTIONAL_POLICY.zoneHalfWidthSpotPct);
  const supportLow = support.center ? support.center - halfWidth : 0;
  const supportHigh = support.center ? support.center + halfWidth : 0;
  const resistanceLow = resistance.center ? resistance.center - halfWidth : 0;
  const resistanceHigh = resistance.center ? resistance.center + halfWidth : 0;
  const momentumReferences = [latestBar.close, currentVwap, currentEma]
    .filter((value) => positive(value) && Math.abs(value - latestBar.close) <= maximumClusterDistance);
  const momentumCenter = momentumReferences.length >= 2 ? median(momentumReferences) ?? 0 : 0;
  const momentumLow = momentumCenter > 0 ? momentumCenter - halfWidth : 0;
  const momentumHigh = momentumCenter > 0 ? momentumCenter + halfWidth : 0;
  derived(factors, FACTOR.supportCount, support.count, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.resistanceCount, resistance.count, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.supportLow, supportLow, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.supportHigh, supportHigh, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.resistanceLow, resistanceLow, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.resistanceHigh, resistanceHigh, [FACTOR.vwap, FACTOR.atr]);
  derived(factors, FACTOR.momentumCount, momentumReferences.length, [FACTOR.price, FACTOR.vwap, FACTOR.ema20, FACTOR.atr]);
  derived(factors, FACTOR.momentumLow, momentumLow, [FACTOR.price, FACTOR.vwap, FACTOR.ema20, FACTOR.atr]);
  derived(factors, FACTOR.momentumHigh, momentumHigh, [FACTOR.price, FACTOR.vwap, FACTOR.ema20, FACTOR.atr]);

  const zoneDistanceAtr = (low: number, high: number) => {
    if (!(atr > 0) || !(low > 0) || !(high >= low)) return Number.POSITIVE_INFINITY;
    if (latestBar.close < low) return (low - latestBar.close) / atr;
    if (latestBar.close > high) return (latestBar.close - high) / atr;
    return 0;
  };
  derived(factors, FACTOR.longZoneDistanceAtr, zoneDistanceAtr(supportLow, supportHigh), [FACTOR.price, FACTOR.supportLow, FACTOR.supportHigh, FACTOR.atr]);
  derived(factors, FACTOR.shortZoneDistanceAtr, zoneDistanceAtr(resistanceLow, resistanceHigh), [FACTOR.price, FACTOR.resistanceLow, FACTOR.resistanceHigh, FACTOR.atr]);
  derived(factors, FACTOR.momentumDistanceAtr, zoneDistanceAtr(momentumLow, momentumHigh), [FACTOR.price, FACTOR.momentumLow, FACTOR.momentumHigh, FACTOR.atr]);

  const recent = closedBars.slice(-3);
  const recentLow = Math.min(...recent.map((bar) => positive(bar.low) ? bar.low : bar.close));
  const recentHigh = Math.max(...recent.map((bar) => positive(bar.high) ? bar.high : bar.close));
  const longReclaim = support.count >= 2 && recentLow <= supportHigh && latestBar.close >= supportLow;
  const shortReclaim = resistance.count >= 2 && recentHigh >= resistanceLow && latestBar.close <= resistanceHigh;
  const longSweepReclaim = support.count >= 2 && recentLow < supportLow && latestBar.close >= supportLow;
  const shortSweepReclaim = resistance.count >= 2 && recentHigh > resistanceHigh && latestBar.close <= resistanceHigh;
  const previousClose = closedBars.at(-2)?.close ?? latestBar.close;
  const longVolumeOk = !(volumeRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.breakoutVolumeRatio && latestBar.close < previousClose && latestBar.close < supportHigh);
  const shortVolumeOk = !(volumeRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.breakoutVolumeRatio && latestBar.close > previousClose && latestBar.close > resistanceLow);
  const momentumLongConfirm = momentumReferences.length >= 2 && latestBar.close >= currentEma && latestBar.close > previousClose && rsiLongStep;
  const momentumShortConfirm = momentumReferences.length >= 2 && latestBar.close <= currentEma && latestBar.close < previousClose && rsiShortStep;
  derived(factors, FACTOR.longReclaim, longReclaim, [FACTOR.supportCount, FACTOR.supportLow, FACTOR.supportHigh, FACTOR.price]);
  derived(factors, FACTOR.shortReclaim, shortReclaim, [FACTOR.resistanceCount, FACTOR.resistanceLow, FACTOR.resistanceHigh, FACTOR.price]);
  derived(factors, FACTOR.longSweepReclaim, longSweepReclaim, [FACTOR.supportCount, FACTOR.supportLow, FACTOR.price]);
  derived(factors, FACTOR.shortSweepReclaim, shortSweepReclaim, [FACTOR.resistanceCount, FACTOR.resistanceHigh, FACTOR.price]);
  derived(factors, FACTOR.longVolumeOk, longVolumeOk, [FACTOR.volumeRatio, FACTOR.supportHigh, FACTOR.price]);
  derived(factors, FACTOR.shortVolumeOk, shortVolumeOk, [FACTOR.volumeRatio, FACTOR.resistanceLow, FACTOR.price]);
  derived(factors, FACTOR.momentumLongConfirm, momentumLongConfirm, [FACTOR.momentumCount, FACTOR.price, FACTOR.ema20, FACTOR.rsiLongStep]);
  derived(factors, FACTOR.momentumShortConfirm, momentumShortConfirm, [FACTOR.momentumCount, FACTOR.price, FACTOR.ema20, FACTOR.rsiShortStep]);
  derived(factors, FACTOR.longSweepExtreme, recentLow, [FACTOR.price]);
  derived(factors, FACTOR.shortSweepExtreme, recentHigh, [FACTOR.price]);
  derived(factors, FACTOR.longGexOk, factors[FACTOR.gexDelta]!.confidence>0 && balanceDelta!==null && balanceDelta >= 0, [FACTOR.gexDelta]);
  derived(factors, FACTOR.shortGexOk, factors[FACTOR.gexDelta]!.confidence>0 && balanceDelta!==null && balanceDelta <= 0, [FACTOR.gexDelta]);
  derived(factors, FACTOR.longWallOk, putWall > 0 && latestBar.close >= putWall, [FACTOR.putWall, FACTOR.price]);
  derived(factors, FACTOR.shortWallOk, callWall > 0 && latestBar.close <= callWall, [FACTOR.callWall, FACTOR.price]);

  const scRiskElevated = resistance.count >= 2
    && directionalBias === 'LONG'
    && (regime === 'TREND_UP' || latestBar.close >= resistanceLow);
  const spRiskElevated = support.count >= 2
    && directionalBias === 'SHORT'
    && (regime === 'TREND_DOWN' || latestBar.close <= supportHigh);
  const scStopRisk = scRiskElevated && (
    (callWall > 0 && latestBar.close > callWall)
    || (latestBar.close > resistanceHigh
      && volumeRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.riskConfirmationVolumeRatio
      && factors[FACTOR.gexDelta]!.confidence>0 && balanceDelta!==null && balanceDelta >= 0)
  );
  const spStopRisk = spRiskElevated && (
    (putWall > 0 && latestBar.close < putWall)
    || (latestBar.close < supportLow
      && volumeRatio >= QQQ_INTRADAY_DIRECTIONAL_POLICY.riskConfirmationVolumeRatio
      && factors[FACTOR.gexDelta]!.confidence>0 && balanceDelta!==null && balanceDelta <= 0)
  );
  derived(factors, FACTOR.scRiskElevated, scRiskElevated, [FACTOR.directionalBias, FACTOR.regime, FACTOR.resistanceCount, FACTOR.resistanceLow, FACTOR.price]);
  derived(factors, FACTOR.spRiskElevated, spRiskElevated, [FACTOR.directionalBias, FACTOR.regime, FACTOR.supportCount, FACTOR.supportHigh, FACTOR.price]);
  derived(factors, FACTOR.scStopRisk, scStopRisk, [FACTOR.scRiskElevated, FACTOR.callWall, FACTOR.resistanceHigh, FACTOR.volumeRatio, FACTOR.gexDelta, FACTOR.price]);
  derived(factors, FACTOR.spStopRisk, spStopRisk, [FACTOR.spRiskElevated, FACTOR.putWall, FACTOR.supportLow, FACTOR.volumeRatio, FACTOR.gexDelta, FACTOR.price]);

  const longInvalidation = Math.min(recentLow, supportLow) - atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.invalidationBufferAtr;
  const shortInvalidation = Math.max(recentHigh, resistanceHigh) + atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.invalidationBufferAtr;
  const longEntry = (supportLow + supportHigh) / 2;
  const shortEntry = (resistanceLow + resistanceHigh) / 2;
  const longCandidates = [resistance.center, orHigh, callWall, gammaFlip].filter((value): value is number => positive(value) && value > longEntry);
  const shortCandidates = [support.center, orLow, putWall, gammaFlip].filter((value): value is number => positive(value) && value < shortEntry);
  const longTarget = longCandidates.length ? Math.min(...longCandidates) : 0;
  const shortTarget = shortCandidates.length ? Math.max(...shortCandidates) : 0;
  const longRisk = longEntry - longInvalidation;
  const shortRisk = shortInvalidation - shortEntry;
  const longStructureR = longRisk > 0 && longTarget > longEntry ? (longTarget - longEntry) / longRisk : 0;
  const shortStructureR = shortRisk > 0 && shortTarget < shortEntry ? (shortEntry - shortTarget) / shortRisk : 0;
  const momentumEntry = (momentumLow + momentumHigh) / 2;
  const momentumLongInvalidation = Math.min(recentLow, momentumLow) - atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.invalidationBufferAtr;
  const momentumShortInvalidation = Math.max(recentHigh, momentumHigh) + atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.invalidationBufferAtr;
  const momentumLongCandidates = [resistance.center, orHigh, callWall, gammaFlip].filter((value): value is number => positive(value) && value > momentumEntry);
  const momentumShortCandidates = [support.center, orLow, putWall, gammaFlip].filter((value): value is number => positive(value) && value < momentumEntry);
  const momentumLongTarget = momentumLongCandidates.length ? Math.min(...momentumLongCandidates) : 0;
  const momentumShortTarget = momentumShortCandidates.length ? Math.max(...momentumShortCandidates) : 0;
  const momentumLongRisk = momentumEntry - momentumLongInvalidation;
  const momentumShortRisk = momentumShortInvalidation - momentumEntry;
  const momentumLongStructureR = momentumLongRisk > 0 && momentumLongTarget > momentumEntry ? (momentumLongTarget - momentumEntry) / momentumLongRisk : 0;
  const momentumShortStructureR = momentumShortRisk > 0 && momentumShortTarget < momentumEntry ? (momentumEntry - momentumShortTarget) / momentumShortRisk : 0;
  derived(factors, FACTOR.longInvalidation, longInvalidation, [FACTOR.supportLow, FACTOR.atr, FACTOR.longSweepExtreme]);
  derived(factors, FACTOR.shortInvalidation, shortInvalidation, [FACTOR.resistanceHigh, FACTOR.atr, FACTOR.shortSweepExtreme]);
  derived(factors, FACTOR.longTarget, longTarget, [FACTOR.resistanceCount, FACTOR.price]);
  derived(factors, FACTOR.shortTarget, shortTarget, [FACTOR.supportCount, FACTOR.price]);
  derived(factors, FACTOR.longStructureR, longStructureR, [FACTOR.longTarget, FACTOR.longInvalidation, FACTOR.supportLow, FACTOR.supportHigh]);
  derived(factors, FACTOR.shortStructureR, shortStructureR, [FACTOR.shortTarget, FACTOR.shortInvalidation, FACTOR.resistanceLow, FACTOR.resistanceHigh]);
  derived(factors, FACTOR.momentumLongInvalidation, momentumLongInvalidation, [FACTOR.momentumLow, FACTOR.atr, FACTOR.longSweepExtreme]);
  derived(factors, FACTOR.momentumShortInvalidation, momentumShortInvalidation, [FACTOR.momentumHigh, FACTOR.atr, FACTOR.shortSweepExtreme]);
  derived(factors, FACTOR.momentumLongTarget, momentumLongTarget, [FACTOR.resistanceCount, FACTOR.price]);
  derived(factors, FACTOR.momentumShortTarget, momentumShortTarget, [FACTOR.supportCount, FACTOR.price]);
  derived(factors, FACTOR.momentumLongStructureR, momentumLongStructureR, [FACTOR.momentumLongTarget, FACTOR.momentumLongInvalidation, FACTOR.momentumLow, FACTOR.momentumHigh]);
  derived(factors, FACTOR.momentumShortStructureR, momentumShortStructureR, [FACTOR.momentumShortTarget, FACTOR.momentumShortInvalidation, FACTOR.momentumLow, FACTOR.momentumHigh]);

  return { factors, closedBars };
}

export const qqqDirectionalFactorValue = <T>(factors: FactorMap, id: string, fallback: T): T => {
  const factor = factors[id];
  return factor && factor.confidence > 0 ? factor.value as T : fallback;
};

export const qqqDirectionalDataQuality = (factors: FactorMap): QqqIntradayDirectionalDecision['dataQuality'] => {
  const quoteAvailable = qqqDirectionalFactorValue(factors, FACTOR.quoteAvailable, 0);
  const quoteTotal = qqqDirectionalFactorValue(factors, FACTOR.quoteTotal, 0);
  const selectedExpiries = qqqDirectionalFactorValue<string>(factors, FACTOR.selectedExpiries, '');
  const evaluatedAt = qqqDirectionalFactorValue(factors, FACTOR.asOf, Number.NaN);
  return {
    ...(Number.isFinite(evaluatedAt) ? {evaluatedAt:new Date(evaluatedAt).toISOString()} : {}),
    barAgeSeconds: factors[FACTOR.barAge]?.confidence ? qqqDirectionalFactorValue(factors, FACTOR.barAge, null) : null,
    gexAgeSeconds: factors[FACTOR.gexAge]?.confidence ? qqqDirectionalFactorValue(factors, FACTOR.gexAge, null) : null,
    barCount: qqqDirectionalFactorValue(factors, FACTOR.barCount, 0),
    validExpiries: qqqDirectionalFactorValue(factors, FACTOR.expiryCount, 0),
    partialGex:qqqDirectionalFactorValue(factors,FACTOR.partialGex,0)>0,
    selectedExpiries: selectedExpiries ? selectedExpiries.split(',') : [],
    quoteCoverage: { available: quoteAvailable, total: quoteTotal, ratio: quoteTotal > 0 ? quoteAvailable / quoteTotal : null },
  };
};

export const qqqDirectionalDataBlockers = (factors: FactorMap): QqqIntradayDirectionalReasonCode[] => {
  const blockers: QqqIntradayDirectionalReasonCode[] = [];
  if(qqqDirectionalFactorValue(factors,FACTOR.partialGex,0)>0)blockers.push('PARTIAL_GEX_INPUT');
  if (qqqDirectionalFactorValue(factors, FACTOR.barCount, 0) < QQQ_INTRADAY_DIRECTIONAL_POLICY.minBars) blockers.push('NOT_ENOUGH_BARS');
  if (qqqDirectionalFactorValue(factors, FACTOR.expiryCount, 0) < QQQ_INTRADAY_DIRECTIONAL_POLICY.minExpiries) blockers.push('NOT_ENOUGH_EXPIRIES');
  if (qqqDirectionalFactorValue(factors, FACTOR.barAge, Number.POSITIVE_INFINITY) > QQQ_INTRADAY_DIRECTIONAL_POLICY.maxBarAgeSeconds) blockers.push('BAR_DATA_STALE');
  if (qqqDirectionalFactorValue(factors, FACTOR.gexAge, Number.POSITIVE_INFINITY) > QQQ_INTRADAY_DIRECTIONAL_POLICY.maxGexAgeSeconds) blockers.push('GEX_DATA_STALE');
  if (
    factors[FACTOR.putWall]?.confidence === 0
    || factors[FACTOR.callWall]?.confidence === 0
    || factors[FACTOR.flip]?.confidence === 0
  ) blockers.push('MISSING_GEX_STRUCTURE');
  return blockers;
};

export const qqqDirectionalRoundPrice = (value: number) => Number(value.toFixed(2));
export const qqqDirectionalClampConfidence = (value: number) => clamp(value, 0, 10);

export const qqqDirectionalSameStructure = (
  factors: FactorMap,
  current: Pick<QqqIntradayDirectionalDecision, 'direction' | 'intent' | 'playbook' | 'entryZone' | 'riskPlan'>,
  previous: Pick<QqqIntradayDirectionalDecision, 'direction' | 'intent' | 'playbook' | 'entryZone' | 'riskPlan'>,
) => {
  const currentZone = current.entryZone ?? current.riskPlan?.triggerZone ?? null;
  const previousZone = previous.entryZone ?? previous.riskPlan?.triggerZone ?? null;
  if (!current.direction || !currentZone || !previous.direction || !previousZone) return false;
  if (current.direction !== previous.direction || current.intent !== previous.intent) return false;
  const currentCenter = (currentZone.low + currentZone.high) / 2;
  const previousCenter = (previousZone.low + previousZone.high) / 2;
  const currentWidth = Math.max(0, currentZone.high - currentZone.low);
  const previousWidth = Math.max(0, previousZone.high - previousZone.low);
  const atr = qqqDirectionalFactorValue(factors, FACTOR.atr, 0);
  const directionalWatch = current.playbook === 'DIRECTIONAL_WATCH' && previous.playbook === 'DIRECTIONAL_WATCH';
  const tolerance = Math.max(
    currentWidth,
    previousWidth,
    atr * (directionalWatch ? QQQ_INTRADAY_DIRECTIONAL_POLICY.rearmExcursionAtr : QQQ_INTRADAY_DIRECTIONAL_POLICY.confluenceDistanceAtr),
  );
  return Number.isFinite(currentCenter) && Number.isFinite(previousCenter) && Math.abs(currentCenter - previousCenter) <= tolerance;
};

export const qqqDirectionalCanRearm = (input: {
  factors: FactorMap;
  current: QqqIntradayDirectionalDecision;
  previous: QqqIntradayDirectionalDecision;
  bars: readonly QqqIntradayBar[];
}) => {
  if (!qqqDirectionalSameStructure(input.factors, input.current, input.previous)) return true;
  if (!input.current.anchorBar || !input.previous.anchorBar) return false;
  const currentMs = Date.parse(input.current.anchorBar);
  const previousMs = Date.parse(input.previous.anchorBar);
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs) || currentMs <= previousMs) return false;
  if (currentMs - previousMs < QQQ_INTRADAY_DIRECTIONAL_POLICY.dedupeBars * QQQ_INTRADAY_DIRECTIONAL_POLICY.barMinutes * 60_000) return false;
  if (input.current.regime !== input.previous.regime) return true;

  const atr = input.previous.structureContext?.atr || input.current.structureContext?.atr || qqqDirectionalFactorValue(input.factors, FACTOR.atr, 0);
  const structureMove = atr > 0 && input.current.structureContext && input.previous.structureContext
    ? [
        Math.abs(input.current.structureContext.callWall - input.previous.structureContext.callWall),
        Math.abs(input.current.structureContext.putWall - input.previous.structureContext.putWall),
        Math.abs(input.current.structureContext.gammaFlip - input.previous.structureContext.gammaFlip),
      ].some((distance) => distance >= atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.rearmStructureChangeAtr)
    : false;
  if (structureMove) return true;
  if (input.previous.planExpiresAt && currentMs >= Date.parse(input.previous.planExpiresAt)) return true;

  const intervening = input.bars.filter((bar) => {
    const timestamp = Date.parse(bar.timestamp);
    return timestamp > previousMs && timestamp <= currentMs;
  });
  if (input.previous.invalidation !== null && input.previous.direction) {
    const invalidated = intervening.some((bar) => input.previous.direction === 'LONG'
      ? (positive(bar.low) ? bar.low : bar.close) <= input.previous.invalidation!
      : (positive(bar.high) ? bar.high : bar.close) >= input.previous.invalidation!);
    if (invalidated) return true;
  }

  if (!(atr > 0) || !input.previous.entryZone || !input.current.direction) return false;
  const previousCenter = (input.previous.entryZone.low + input.previous.entryZone.high) / 2;
  const excursion = intervening.some((bar) => Math.max(
    Math.abs((positive(bar.high) ? bar.high : bar.close) - previousCenter),
    Math.abs((positive(bar.low) ? bar.low : bar.close) - previousCenter),
  ) >= atr * QQQ_INTRADAY_DIRECTIONAL_POLICY.rearmExcursionAtr);
  const currentDistance = qqqDirectionalFactorValue(
    input.factors,
    input.current.playbook === 'DIRECTIONAL_WATCH'
      ? FACTOR.momentumDistanceAtr
      : input.current.direction === 'LONG' ? FACTOR.longZoneDistanceAtr : FACTOR.shortZoneDistanceAtr,
    Number.POSITIVE_INFINITY,
  );
  return excursion && currentDistance <= QQQ_INTRADAY_DIRECTIONAL_POLICY.gradeCArmDistanceAtr;
};
