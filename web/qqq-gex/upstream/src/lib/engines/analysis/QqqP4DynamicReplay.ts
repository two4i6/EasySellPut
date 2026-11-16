import type { QqqPcsReplayDailySignal } from './QqqPcsHistoricalBacktest';
import { buildQqqPcsHistoricalBacktestSpec, type QqqPcsConcurrencyGate, type QqqPcsCooldownTradingDays } from './QqqPcsHistoricalBacktest';
import type { BacktestTraceEntry, OptionCycleDebug, PcsPathDiagnostic, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { PcsDynamicEntryContext, PcsDynamicEntryProfile } from '../leveraged-overlay/types/input';
import { OVERLAY_PRODUCTION_DEFAULTS } from '../leveraged-overlay/v2/backtest/production-defaults';
import { runWithData, type V2BacktestResult } from '../leveraged-overlay/v2/backtest/runner';
import { resolveRunSpec, type BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import { evaluatePcsV123Gate, isPcsCandidate3ExtraRelease, isPcsV12GateBlocked, isPcsV121Simple5Release } from '../leveraged-overlay/v2/overlay-runner';
import { evaluatePcsRiskEnvelope } from '../leveraged-overlay/v2/strategies/pcs-risk-envelope';
import type { StrategyParams } from '../leveraged-overlay/types/params';
import type { PcsResearchWidthBySlowSubregime, PcsResearchWidthByVix } from '../leveraged-overlay/v2/strategies/pcs-research-width';
import type { QqqCompositeReplayExecution } from './QqqCompositeReplaySession';
import { CANONICAL_OPTION_SIGNAL_ANCHOR } from '../leveraged-overlay/v2/backtest/canonical-option-signal-tape';

/** P4 = E674 的当前引擎动态回放；研究-only，不是生产默认。 */
export const QQQ_P4_E674_ID = 'P4=E674' as const;
export const QQQ_P4_E674_WIDTH_PCT = 0.03925;
export const QQQ_P4_E674_TARGET_DTE = 35;

type State = BacktestTraceEntry['marketState'];
type Result = V2BacktestResult & { debug?: { trace?: BacktestTraceEntry[]; optionCycles?: OptionCycleDebug[]; pcsPathDiagnostics?: PcsPathDiagnostic[] } };
export type QqqP4DynamicRow = {
  signalDate: string;
  openDate: string;
  expiry: string;
  pnl: number;
  /** Last PCS settlement known at this current-bar decision; undefined before the first settlement. */
  lastSettledPnl?: number;
  /** Research-only causal settlement history from this replay; never loaded from a date ledger. */
  settledPnlHistory?: readonly number[];
  market: State;
  history: State[];
  path?: PcsPathDiagnostic;
};
export type QqqP4DynamicMetrics = {
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  cvar5: number;
  worst: number;
  mdd: number;
};
export type QqqP4DynamicReplay = {
  dailySignals: QqqPcsReplayDailySignal[];
  id: typeof QQQ_P4_E674_ID;
  raw: V2BacktestResult;
  rows: QqqP4DynamicRow[];
  tradeLog: TradeEntry[];
  metrics: QqqP4DynamicMetrics;
  dataFingerprint: string;
  audit: {
    source: 'current-engine-runWithData';
    singleReplay: boolean;
    currentBarFeatures: true;
    postSelectionAdmission: true;
    settledPnlStateUpdates: boolean;
    retrospectiveSelection: false;
    noDateWhitelist: true;
    noPersistedDateAdmission: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
    rawPoolRows: number;
    currentRows: number;
    selectedRows: number;
    rejectedRows: number;
    profileEvaluations: number;
    admissionReasons: Readonly<Record<string, number>>;
    admissionDecisions: readonly { date: string; allowed: boolean; reason: string; openCredit?: number; lower?: number; sigma?: number }[];
    currentArmDecisions: readonly { date: string; value: boolean }[];
    activeRuleIds: readonly string[];
  };
};
export type QqqP4DynamicReplayOptions = {
  /** Composite replay session resources; never contains strategy state. */
  execution?: QqqCompositeReplayExecution;
  /** Research-only phase timing; omitted on the normal path. */
  profiler?: { record: (stage: string, milliseconds: number) => void };
  /** Keep the full trace for research/UI replay; composite adapters may disable it when only tradeLog is consumed. */
  trace?: boolean;
  /** Research-only data-relative warm-up start for the canonical tape. */
  canonicalOptionSignalStartDate?: string;
  /** Research-only exit comparison; omitted production behavior remains hold_to_expiry. */
  exitMode?: 'hold_to_expiry' | 'risk_reference';
  /** Research-only capacity comparison; omitted keeps the independent PCS ledger. */
  pcsConcurrencyGate?: QqqPcsConcurrencyGate;
  pcsCooldownTradingDays?: QqqPcsCooldownTradingDays;
  /** Research-only accounting comparison; omitted preserves the one-contract independent ledger. */
  pcsPositionModeOverride?: 'independent' | 'portfolio';
  additionalAdmission?: (row: QqqP4DynamicRow) => boolean;
  /** Research-only current-bar veto; omitted by the normal P4 builder. */
  additionalReject?: (row: QqqP4DynamicRow) => boolean;
  /** Research-only targeted bypass for the inherited research veto; omitted by the normal P4 builder. */
  additionalRejectBypass?: (row: QqqP4DynamicRow) => boolean;
  /** Research-only targeted bypass for the E2 current-bar protection; omitted by the normal P4 builder. */
  additionalProtectionBypass?: (row: QqqP4DynamicRow) => boolean;
  /** Research-only targeted bypass for the merged P4/P3 base protection; omitted by the normal P4 builder. */
  additionalBaseProtectionBypass?: (row: QqqP4DynamicRow) => boolean;
  /** Research-only: replay an E1 parent without the promoted E2 protection. */
  disableP4E2Protection?: boolean;
  /** Research-only: restore the P4.E0 E674 boundary before the E1 ADX merge. */
  disableP4E1AdxMerge?: boolean;
  /** Research-only selector experiment; production P4 keeps the registered selector contract. */
  selectionOverrides?: Partial<Pick<StrategyParams,
    | 'pcsSurvivalSelectionFloor'
    | 'pcsSurvivalSelectionVolatilityScale'
    | 'pcsSurvivalSelectionStressFloor'
    | 'pcsSurvivalSelectionObjective'
    | 'pcsSurvivalSelectionObjectiveRegime'
    | 'pcsSurvivalSelectionObjectiveSlowSubregime'
    | 'pcsSurvivalSelectionObjectiveAdxMin'
    | 'pcsSurvivalSelectionObjectiveRv20Min'
    | 'pcsSurvivalSelectionSurvivalWeight'
    | 'pcsSurvivalSelectionWilsonWeight'
    | 'pcsSurvivalSelectionMaxConditionalLossRatio'
    | 'pcsSurvivalSelectionStressTailVetoRatio'
    | 'pcsSurvivalSelectionStressTailVetoRegime'
    | 'pcsSurvivalSelectionStressTailVetoSlowSubregime'
    | 'pcsSurvivalSelectionStressTailVetoRv20Max'
    | 'pcsSurvivalSelectionStressWeight'
    | 'pcsSurvivalSelectionDteMode'
    | 'pcsSurvivalSelectionWidthMode'
    | 'pcsSurvivalSelectionWidthBlend'
    | 'pcsSurvivalSelectionWidthConfirmDays'
    | 'pcsSurvivalSelectionWidthSwitchMargin'
    | 'pcsSurvivalSelectionWidthDeltaPnlFloor'
    | 'pcsSurvivalSelectionWidthTailImprovementMargin'
    | 'pcsSurvivalSelectionCreditRetentionFloor'
    | 'pcsSurvivalSelectionTailWidthTriggerRatio'
    | 'pcsSurvivalSelectionSigmaMode'
    | 'pcsSurvivalSelectionCandidateSigmas'
    | 'pcsPressureSizingMode'
    | 'pcsPressureSizingMediumMultiplier'
    | 'pcsPressureSizingStressedMultiplier'>>;
  /** Research-only PCS exit experiment; omitted preserves hold-to-expiry behavior. */
  exitOverrides?: Partial<Pick<StrategyParams, 'pcsProfitTakeEnabled' | 'pcsProfitTarget' | 'pcsDeltaStopEnabled' | 'pcsDeltaStopThreshold'>>;
  /** Research-only PCS budget sizing experiment; omitted preserves the registered P4 budget. */
  riskOverrides?: Partial<Pick<StrategyParams, 'pcsRiskBudgetMultiplier' | 'pcsMaxRiskNav' | 'optionMaxTotalRiskNav' | 'forceMinimumContract'>>;
  /** Research-only contract geometry experiment; production P4 keeps 3.925% / 35 DTE. */
  contractOverrides?: Partial<Pick<StrategyParams, 'pcsTargetDte' | 'pcsSpreadWidthPct' | 'pcsShortStrikeSigma' | 'pcsShortDelta'>>;
  /** Research-only current-bar width variation by broad slow-subregime; unspecified states use the base width. */
  widthBySlowSubregime?: PcsResearchWidthBySlowSubregime;
  /** Research-only current-bar width override for bars whose observed VIX is at or below the threshold. */
  widthByVix?: PcsResearchWidthByVix;
  /** Research-only entry-timing experiment; omitted preserves the current P4 allow-timing pool. */
  timingOverrides?: Partial<Pick<StrategyParams, 'pcsMode' | 'pcsResearchTimingOverride'>>;
  /** Research-only independent PCS_RESCUE experiment; omitted keeps P5's main-PCS-only ledger. */
  rescueOverrides?: Partial<Pick<StrategyParams, 'pcsRescueEnabled' | 'pcsRescueEntryMode' | 'pcsRescueRegimeScope'>>;
};

type P4AdmissionStats = {
  evaluated: number;
  allowed: number;
  reasons: Record<string, number>;
  decisions: Array<{ date: string; allowed: boolean; reason: string; openCredit?: number; lower?: number; sigma?: number }>;
  currentArm: Array<{ date: string; value: boolean }>;
};

const day = (value: string | undefined) => (value ?? '').slice(0, 10);
const finite = (value: number | null | undefined, fallback: number) => value ?? fallback;

/**
 * Canonical tape warm-up is data-relative, not an admission date filter. The
 * executable replay still evaluates every requested bar; this only avoids
 * rebuilding canonical proposals that cannot be consumed before startDate.
 */
export function qqqCanonicalOptionSignalWarmupStartDate(startDate: string, warmupCalendarDays = 120): string {
  const parsed = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return CANONICAL_OPTION_SIGNAL_ANCHOR;
  parsed.setUTCDate(parsed.getUTCDate() - Math.max(0, Math.floor(warmupCalendarDays)));
  const candidate = parsed.toISOString().slice(0, 10);
  return candidate < CANONICAL_OPTION_SIGNAL_ANCHOR ? CANONICAL_OPTION_SIGNAL_ANCHOR : candidate;
}
const lower = (row: QqqP4DynamicRow) => finite(row.path?.priceSelection?.selectedNoTouchLower, Number.NEGATIVE_INFINITY);
const sigma = (row: QqqP4DynamicRow) => row.path?.priceSelection?.selectedSigma;
const rv = (row: QqqP4DynamicRow) => finite(row.market.tqqqRealisedVol20d, Number.NEGATIVE_INFINITY);
const adx = (row: QqqP4DynamicRow) => finite(row.market.adx14, Number.POSITIVE_INFINITY);
const vix = (row: QqqP4DynamicRow) => finite(row.market.vix, Number.POSITIVE_INFINITY);

function pairRows(result: Result): QqqP4DynamicRow[] {
  const opens = new Map<string, { signalDate: string; expiry: string }>();
  for (const trade of result.tradeLog ?? []) {
    if (trade.action === 'OPEN' && trade.strategyTag === 'QQQ_PUT_CREDIT_SPREAD') {
      opens.set(day(trade.date), { signalDate: day(trade.signalDate), expiry: day(trade.expiry) });
    }
  }
  const trace = [...(result.debug?.trace ?? [])].sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const byDate = new Map(trace.map((entry) => [day(entry.date), entry] as const));
  const bySignal = new Map((result.debug?.pcsPathDiagnostics ?? []).map((path) => [day(path.signalDate), path] as const));
  const byOpen = new Map((result.debug?.pcsPathDiagnostics ?? []).map((path) => [day(path.openDate), path] as const));
  return (result.debug?.optionCycles ?? [])
    .filter((cycle) => cycle.kind === 'PCS' && Number.isFinite(cycle.pnl))
    .sort((a, b) => day(a.openDate).localeCompare(day(b.openDate)))
    .map((cycle) => {
      const open = opens.get(day(cycle.openDate));
      const signalDate = open?.signalDate || day(cycle.openDate);
      const index = trace.findIndex((entry) => day(entry.date) === signalDate);
      return {
        signalDate,
        openDate: day(cycle.openDate),
        expiry: open?.expiry ?? '',
        pnl: cycle.pnl,
        market: byDate.get(signalDate)?.marketState ?? ({} as State),
        history: index >= 0 ? trace.slice(0, index + 1).map((entry) => entry.marketState) : [],
        path: bySignal.get(signalDate) ?? byOpen.get(day(cycle.openDate)),
      };
    });
}

function currentBlock(market: State): boolean {
  return (market.regime === 'BULL' && market.slowSubregime === 'SR01' && finite(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2 && finite(market.adx14, Number.NEGATIVE_INFINITY) >= 29)
    || (market.regime === 'BULL' && market.slowSubregime === 'SR02' && vix({ market } as QqqP4DynamicRow) >= 15 && vix({ market } as QqqP4DynamicRow) < 18 && finite(market.adx14, Number.NEGATIVE_INFINITY) >= 40)
    || (market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR01' && finite(market.adx14, Number.POSITIVE_INFINITY) < 12);
}

function priceSmaBlock(market: State): boolean {
  return market.regime === 'BULL' && market.slowSubregime === 'SR01' && finite(market.adx14, Number.POSITIVE_INFINITY) < 18 && rv({ market } as QqqP4DynamicRow) >= .6 && finite(market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= .1;
}

function candidateAState(market: State): boolean {
  const a = finite(market.adx14, Number.POSITIVE_INFINITY);
  const x = vix({ market } as QqqP4DynamicRow);
  return (market.regime === 'SIDEWAYS' && (a < 12 || (x > 30 && a >= 20 && a < 30) || (x >= 28 && x <= 30 && a >= 12 && a < 20)))
    || (market.regime === 'BULL' && market.slowSubregime === 'SR01' && x < 12 && a < 12)
    || ((market.regime === 'BULL' || market.regime === 'RISK_ON_WEAKENING') && x < 12 && a >= 30)
    || (market.regime === 'RANGE_BOUND' && market.slowSubregime === 'SR01' && x >= 12 && x < 14 && a >= 12 && a < 20);
}

function p1Compact(row: QqqP4DynamicRow): boolean {
  const x = vix(row);
  return (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && x < 17 && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5 && adx(row) < 21 && (rv(row) < .5 || rv(row) >= .6))
    || (row.market.slowSubregime === 'SR02' && rv(row) >= .6 && adx(row) < 20 && ((row.market.regime === 'RISK_ON_EXTENDED' && x >= 20) || (row.market.regime === 'BULL' && row.history.slice(-3).length === 3 && row.history.slice(-3).every((state) => state.regime === 'BULL' && state.slowSubregime === 'SR02' && finite(state.tqqqRealisedVol20d, Number.NEGATIVE_INFINITY) >= .6 && finite(state.adx14, Number.POSITIVE_INFINITY) < 20))))
    || (row.market.regime === 'RISK_ON_WEAKENING' && row.market.slowSubregime === 'SR01' && x >= 20 && adx(row) < 15);
}
type Rule = readonly [string, (row: QqqP4DynamicRow) => boolean];
const band = (value: number, min?: number, max?: number) => (min === undefined || value >= min) && (max === undefined || value < max);
const rules: readonly Rule[] = [
  ['E322', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 20, 25) && band(finite(r.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY), .05, .1) && rv(r) >= .5 && finite(r.market.roc20, Number.POSITIVE_INFINITY) <= -.02 && finite(r.market.weakeningSignalCount, 0) >= 2 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E326', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'CURRENT' && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E329', r => r.market.regime === 'SIDEWAYS' && vix(r) >= 25 && band(adx(r), 20, 30) && sigma(r) === 2.5],
  ['E334', r => band(vix(r), 17, 20) && band(adx(r), 25, 30) && sigma(r) === 2.5],
  ['E338', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'CURRENT' && sigma(r) === 2.5],
  ['E352', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'CURRENT' && sigma(r) === 2.5],
  ['E355', r => band(rv(r), .5, .6) && band(lower(r), .35, .4) && sigma(r) === 2.5],
  ['E359', r => band(rv(r), .4, .5) && lower(r) >= .49 && sigma(r) === 2.5],
  ['E363', r => band(rv(r), .6, .67) && band(lower(r), .35, .4) && band(sigma(r) ?? Number.NEGATIVE_INFINITY, 2, 3)],
  ['E367', r => rv(r) >= .6 && lower(r) < .35 && sigma(r) === 2],
  ['E371', r => band(rv(r), .4, .6) && lower(r) < .35 && sigma(r) === 2.5],
  ['E381', r => band(vix(r), 17, 20) && band(adx(r), 25, 30) && band(sigma(r) ?? Number.NEGATIVE_INFINITY, 2, 3)],
  ['E388', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'CURRENT' && band(sigma(r) ?? Number.NEGATIVE_INFINITY, 2, 3)],
  ['E392', r => band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 1.5],
  ['E396', r => rv(r) < .4 && lower(r) < .35 && sigma(r) === 1.5],
  ['E400', r => rv(r) >= .67 && band(lower(r), .35, .4) && sigma(r) === 2 && vix(r) < 20],
  ['E403', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 20, 25) && rv(r) >= .67 && band(lower(r), .4, .45) && sigma(r) === 2],
  ['E411', r => r.market.regime === 'BULL' && vix(r) < 17 && band(adx(r), 12, 20) && rv(r) < .4 && band(lower(r), .4, .45)],
  ['E415', r => r.market.regime === 'BULL' && adx(r) < 12 && band(rv(r), .4, .5) && lower(r) < .35 && sigma(r) === 2],
  ['E418', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && band(adx(r), 20, 25) && lower(r) < .35 && sigma(r) === 2.5],
  ['E421', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx(r) < 12 && rv(r) < .4 && lower(r) < .35 && sigma(r) === 2.5],
  ['E424', r => r.market.regime === 'RISK_ON_EXTENDED' && adx(r) >= 30 && band(rv(r), .4, .5) && lower(r) < .35 && sigma(r) === 2],
  ['E427', r => r.market.regime === 'RANGE_BOUND' && rv(r) >= .67],
  ['E430', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && band(adx(r), 12, 20) && sigma(r) === 2.5],
  ['P4E0_BULL_SR01_RV40_50_SIGMA2', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && band(adx(r), 12, 20) && band(rv(r), .4, .5) && lower(r) < .4 && sigma(r) === 2],
  ['P4E0_WEAKENING_SR01_RV58_70_SIGMA15', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 20, 30) && band(rv(r), .58, .7) && lower(r) < .4 && sigma(r) === 1.5],
  ['E433', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && band(adx(r), 12, 20) && band(rv(r), .4, .5)],
  ['E436', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && adx(r) < 12 && band(rv(r), .5, .6)],
  ['E439', r => vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .5, .6) && sigma(r) === 2.5],
  ['E442', r => vix(r) >= 25 && rv(r) >= .67 && band(lower(r), .4, .45)],
  ['E445', r => r.market.slowSubregime === 'SR02' && band(adx(r), 20, 25) && rv(r) < .4 && lower(r) < .35],
  ['E448', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && adx(r) < 12 && rv(r) < .4 && band(lower(r), .35, .4)],
  ['E454', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && band(adx(r), 20, 25) && band(rv(r), .4, .5) && band(lower(r), .35, .4)],
  ['E460', r => vix(r) >= 25 && adx(r) >= 30 && band(lower(r), .45, .49)],
  ['E464', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E468', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E471', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) < 12 && band(rv(r), .5, .6) && band(lower(r), .4, .45) && sigma(r) === 2],
  ['E474', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && band(vix(r), 17, 20) && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 2],
  ['E477', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && band(vix(r), 20, 25) && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E480', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .4, .45) && sigma(r) === 2],
  ['E483', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix(r) >= 25 && band(adx(r), 12, 20) && rv(r) >= .67 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E486', r => r.market.regime === 'RISK_ON_WEAKENING' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 25, 30) && rv(r) >= .67 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E489', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && band(vix(r), 17, 20) && band(adx(r), 12, 20) && band(rv(r), .6, .67) && lower(r) >= .49 && sigma(r) === 2.5],
  ['E492', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && band(adx(r), 20, 25) && band(rv(r), .6, .67) && lower(r) < .35 && sigma(r) === 1.5],
  ['E495', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) >= 30 && rv(r) < .4 && band(lower(r), .35, .4) && sigma(r) === 2],
  ['E498', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) < 12 && rv(r) >= .67 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E501', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && band(vix(r), 20, 25) && band(adx(r), 25, 30) && rv(r) >= .67 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E504', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && adx(r) < 12 && band(rv(r), .4, .5) && lower(r) < .35 && sigma(r) === 1.5],
  ['E507', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 2.5],
  ['E510', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) < 12 && rv(r) < .4 && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E513', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) < 12 && rv(r) < .4 && lower(r) < .35 && sigma(r) === 2.5],
  ['E516', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) >= 30 && band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 2.5],
  ['E522', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 2],
  ['E526', r => r.market.regime === 'RANGE_BOUND' && (r.market.slowSubregime === 'SR01' || adx(r) >= 12) && lower(r) < .35 && sigma(r) === 2],
  ['E530', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && band(rv(r), .4, .5) && band(lower(r), .35, .4) && sigma(r) === 2.5],
  ['E533', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && band(adx(r), 25, 30) && rv(r) < .4 && band(lower(r), .35, .4)],
  ['E537', r => r.market.regime === 'SIDEWAYS' && vix(r) < 17 && band(rv(r), .5, .6)],
  ['E541', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && band(vix(r), 17, 20) && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E547', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && band(vix(r), 20, 25) && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E551', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR01' && vix(r) >= 25 && band(adx(r), 12, 20) && band(rv(r), .4, .5) && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E557', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) >= 30 && band(rv(r), .5, .6) && lower(r) < .35 && sigma(r) === 1.5],
  ['E561', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && vix(r) < 17 && adx(r) < 12 && rv(r) < .4 && lower(r) < .35 && sigma(r) === 2.5],
  ['E565', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && band(vix(r), 17, 20) && adx(r) < 12 && rv(r) < .4 && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E569', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix(r) >= 25 && band(adx(r), 12, 20) && rv(r) < .4 && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E575', r => r.market.regime === 'BULL' && band(adx(r), 25, 30) && band(rv(r), .5, .6) && lower(r) < .35 && sigma(r) === 1.5],
  ['E585', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx(r) >= 30 && rv(r) < .4 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E590', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx(r) >= 30 && rv(r) < .4 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E596', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx(r) < 12 && band(rv(r), .6, .67) && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E601', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR01' && band(vix(r), 17, 20) && adx(r) >= 30 && rv(r) < .4 && lower(r) < .35 && sigma(r) === 2.5],
  ['E611', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && band(vix(r), 17, 20) && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .4, .45) && sigma(r) === 2],
  ['E614', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && band(adx(r), 12, 20) && band(rv(r), .5, .6) && band(lower(r), .4, .45) && sigma(r) === 2],
  ['E619', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && vix(r) >= 25 && adx(r) >= 30 && rv(r) >= .67 && lower(r) >= .49 && sigma(r) === 2.5],
  ['E622', r => r.market.regime === 'SIDEWAYS' && r.market.slowSubregime === 'SR02' && adx(r) >= 30 && rv(r) >= .67 && lower(r) >= .49 && sigma(r) === 2.5],
  ['E630', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) >= 30 && band(rv(r), .4, .5) && lower(r) < .35 && sigma(r) === 2],
  ['E638', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR02' && adx(r) < 12 && band(rv(r), .5, .6) && band(lower(r), .35, .4) && sigma(r) === 2],
  ['E646', r => r.market.regime === 'RISK_ON_EXTENDED' && r.market.slowSubregime === 'SR02' && vix(r) < 17 && adx(r) < 12 && rv(r) < .4 && lower(r) < .35 && sigma(r) === 2],
  ['E656', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR02' && adx(r) < 12 && rv(r) < .4 && band(lower(r), .45, .49) && sigma(r) === 2.5],
  ['E665', r => r.market.regime === 'RANGE_BOUND' && r.market.slowSubregime === 'SR01' && adx(r) < 12 && band(rv(r), .6, .67) && band(lower(r), .4, .45) && sigma(r) === 2.5],
  ['E671', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && band(vix(r), 20, 25) && adx(r) >= 30 && rv(r) >= .67 && band(lower(r), .35, .4) && sigma(r) === 2.5],
  // P4.E1: merge the adjacent ADX 25-30 slice into the registered E674
  // branch instead of adding another rule layer. All other E674 conditions
  // remain unchanged.
  ['E674', r => r.market.regime === 'BULL' && r.market.slowSubregime === 'SR01' && adx(r) >= 25 && rv(r) >= .67 && band(lower(r), .35, .4) && sigma(r) === 2.5],
];

type PcsDynamicEntryContextWithSettlementHistory = PcsDynamicEntryContext & {
  settledPnlHistory?: readonly number[];
};

function contextRow(context: PcsDynamicEntryContextWithSettlementHistory): QqqP4DynamicRow {
  const market = {
    ...context,
    // BacktestTraceEntry uses the shorter state names; the public dynamic
    // seam uses symbol-qualified names to avoid ambiguity with TQQQ.
    roc20: context.qqqROC20,
    roc5: context.qqqROC5,
  } as unknown as State;
  return {
    signalDate: context.date,
    openDate: context.date,
    expiry: context.expiry ?? '',
    pnl: 0,
    lastSettledPnl: context.lastSettledPnl,
    settledPnlHistory: context.settledPnlHistory ? [...context.settledPnlHistory] : [],
    market,
    history: context.history.map((state) => ({
      ...state,
      roc20: state.qqqROC20,
      roc5: state.qqqROC5,
    })) as State[],
    path: {
      priceSelection: {
        selectedNoTouchLower: context.selectedNoTouchLower,
        selectedSigma: context.selectedSigma,
      },
      openCredit: context.openCredit,
    } as unknown as PcsPathDiagnostic,
  };
}

function candidate3ResearchRescue(market: State): boolean {
  const vixValue = vix({ market } as QqqP4DynamicRow);
  const adxValue = adx({ market } as QqqP4DynamicRow);
  const candidate1 = (
    (market.regime === 'SIDEWAYS' && vixValue >= 14 && vixValue < 18)
    || (market.regime === 'RANGE_BOUND' && vixValue >= 18 && vixValue < 28)
  ) && adxValue >= 12 && adxValue <= 30;
  const lowVix = (
    (market.regime === 'BULL' && vixValue < 10 && adxValue >= 12 && adxValue <= 30)
    || (market.regime === 'BULL' && vixValue >= 10 && vixValue < 12 && adxValue >= 20 && adxValue <= 30)
    || (market.regime === 'RISK_ON_WEAKENING' && vixValue >= 10 && vixValue < 12 && adxValue >= 12 && adxValue <= 30)
    || (market.regime === 'RISK_ON_EXTENDED' && vixValue >= 10 && vixValue < 12 && adxValue >= 12 && adxValue <= 20)
  );
  return candidate1 || lowVix;
}

function currentArmEquivalent(context: PcsDynamicEntryContext, row: QqqP4DynamicRow): boolean {
  if (context.safetyConditionsMet === false || context.streakCooldownBlocked === true) return false;
  const currentSignal = context.normalP4SignalPassed ?? context.normalP4GatePassed ?? false;
  if (!currentSignal && !candidate3ResearchRescue(row.market)) return false;
  const input = {
    enabled: true,
    regime: row.market.regime,
    slowSubregime: row.market.slowSubregime,
    vix: row.market.vix,
    adx14: row.market.adx14,
    priceExtensionAtr: row.market.priceExtensionAtr,
    priceVsSma200Pct: row.market.priceVsSma200Pct,
    tqqqRealisedVol20d: row.market.tqqqRealisedVol20d,
    roc20: row.market.roc20,
    roc5: row.market.roc5,
    rsi14: row.market.rsi14,
    weakeningSignalCount: row.market.weakeningSignalCount,
    drawdownFromRecentHighPct: row.market.drawdownFromRecentHighPct,
    selectedNoTouchLower: row.path?.priceSelection?.selectedNoTouchLower,
    selectedSigma: row.path?.priceSelection?.selectedSigma,
  };
  const extra = isPcsCandidate3ExtraRelease(input, 'bull_sr02_rv_adx');
  const v121Blocked = isPcsV12GateBlocked({ ...input, v11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' });
  const v121Released = !v121Blocked
    || isPcsV121Simple5Release(input)
    || extra
    || evaluatePcsRiskEnvelope(input, 'candidate4_full_only_v1').band !== 'BLOCK';
  const v123 = evaluatePcsV123Gate({ ...input, b30ReleaseLower: .38 });
  const v123Released = v123.blockedBy.length === 0
    || evaluatePcsRiskEnvelope(input, 'candidate4_full_v1').band === 'FULL'
    || extra;
  return v121Released && v123Released;
}

function finalCurrentBarReject(row: QqqP4DynamicRow, includeP4E2Protection = true): string | undefined {
  const market = row.market;
  const currentVix = vix(row);
  const currentRv = rv(row);
  const currentAdx = adx(row);
  // E222 was historically applied only when the separate base arm produced
  // the same date. A current-bar profile has no base-arm membership signal;
  // applying it to every contract path incorrectly vetoes valid pool rows, so
  // the merged current-bar builder intentionally omits that cross-arm veto.
  const extended = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR01' && currentVix < 20 && band(currentRv, .5, .6) && band(currentAdx, 20, 30);
  const bullPe21 = market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 15 && band(currentRv, .5, .6) && band(currentAdx, 20, 30) && finite(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
  const extendedSr02 = market.regime === 'RISK_ON_EXTENDED' && market.slowSubregime === 'SR02' && currentVix < 18 && band(currentRv, .45, .55) && currentAdx < 12 && finite(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.1;
  const weakeningCompact = market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR02' && currentVix < 17 && band(currentAdx, 12, 17) && currentRv < .4;
  const bullSr01TrendExtension = market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 18 && band(currentAdx, 20, 30) && band(currentRv, .5, .6) && finite(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2.5;
  // P4.E3 replaces the broader E2 protection with the narrower boundary
  // that preserves most profitable trades while retaining its loss filter.
  const bullSr02LowRvTrend = includeP4E2Protection && market.regime === 'BULL' && market.slowSubregime === 'SR02' && currentVix < 17 && currentAdx >= 35 && currentRv < .3;
  if (extended || bullPe21 || extendedSr02) return 'P4_E234_STRESS_STATE';
  if (weakeningCompact) return 'P4_COMPACT_WEAKENING_STATE';
  if (bullSr02LowRvTrend) return 'P4_E3_BULL_SR02_LOW_RV_TREND';
  if (bullSr01TrendExtension) return 'P4_E222_TREND_EXTENSION';
  if (market.regime === 'BULL' && market.slowSubregime === 'SR01' && currentVix < 15 && currentRv < .4 && currentAdx >= 25) return 'P4_E277_LOW_RV_TREND';
  return undefined;
}

/** P4.E3.A research-only loss-cluster veto; the normal P4 builder omits it. */
export function isQqqP4E3ACurrentBarReject(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 18)
    && band(currentAdx, 12, 20)
    && band(currentRv, .4, .5)
    && extension >= 1.5;
}

/** Canonical sequential P4.E3 name; the historical E3.A alias remains for replay compatibility. */
export const isQqqP4E3CurrentBarReject = isQqqP4E3ACurrentBarReject;

/**
 * P4/E674 的单次 replay admission profile。
 * 状态只属于本次 replay；它不产生日期集合，也不读取未来交易结果。
 */
export function createQqqP4E674DynamicProfile(
  additionalAdmission?: QqqP4DynamicReplayOptions['additionalAdmission'],
  stats?: P4AdmissionStats,
  additionalReject?: QqqP4DynamicReplayOptions['additionalReject'],
  disableP4E2Protection = false,
  disableP4E1AdxMerge = false,
  additionalProtectionBypass?: QqqP4DynamicReplayOptions['additionalProtectionBypass'],
  additionalBaseProtectionBypass?: QqqP4DynamicReplayOptions['additionalBaseProtectionBypass'],
  additionalRejectBypass?: QqqP4DynamicReplayOptions['additionalRejectBypass'],
): PcsDynamicEntryProfile {
  let lastSettledPnl: number | undefined;
  const settledPnlHistory: number[] = [];
  return {
    evaluate(context) {
      if (stats) stats.evaluated += 1;
      const reject = (reason: string) => {
        if (stats) stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
        if (stats) stats.decisions.push({ date: context.date, allowed: false, reason, openCredit: context.openCredit ?? undefined, lower: context.selectedNoTouchLower ?? undefined, sigma: context.selectedSigma ?? undefined });
        return { allowed: false, reason };
      };
      const allow = (reason: string) => {
        if (stats) {
          stats.allowed += 1;
          stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
          stats.decisions.push({ date: context.date, allowed: true, reason, openCredit: context.openCredit ?? undefined, lower: context.selectedNoTouchLower ?? undefined, sigma: context.selectedSigma ?? undefined });
        }
        return { allowed: true, reason };
      };
      const row = contextRow({
        ...context,
        lastSettledPnl: lastSettledPnl ?? context.lastSettledPnl,
        settledPnlHistory,
      });
      const market = row.market;
      const currentBlocked = currentBlock(market) || priceSmaBlock(market);
      const baseProtectionBypass = additionalBaseProtectionBypass?.(row) === true;
      if (currentBlocked && !baseProtectionBypass) return reject('P4_CURRENT_STATE_BLOCK');
      const currentArm = currentArmEquivalent(context, row);
      if (stats) stats.currentArm.push({ date: context.date, value: currentArm });
      // Re-evaluate the P3 parent protections from the current bar/history;
      // the dynamic seam never imports the old date blocklist. The loss
      // release uses only the last real settlement supplied by onClose.
      const p1Blocked = p1Compact(row)
        || (market.regime === 'RANGE_BOUND' && market.slowSubregime === 'SR01' && vix(row) >= 15 && vix(row) < 20 && rv(row) >= .5 && rv(row) < .6 && finite(market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= .75);
      // Preserve the P3 protection as a current-bar rule. It is evaluated
      // from the current market/history and never imports a date ledger.
      if (p1Blocked && !baseProtectionBypass) return reject('P3_BASE_COMPACT_OR_RANGE_BLOCK');
      const compactRelease = market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR02' && adx(row) < 15 && finite(market.rsi14, Number.POSITIVE_INFINITY) < 35;
      if (compactRelease && (lastSettledPnl ?? context.lastSettledPnl) !== undefined && (lastSettledPnl ?? context.lastSettledPnl)! <= 0) {
        return reject('P3_PRIOR_SETTLED_LOSS_BLOCK');
      }
      if (additionalReject?.(row) === true && additionalRejectBypass?.(row) !== true) return reject('P4_RESEARCH_ADDITIONAL_REJECT');
      const candidateA = candidateAState(market);
      const matchedRule = rules.find(([id, predicate]) => predicate(row));
      const rule = disableP4E1AdxMerge
        && matchedRule?.[0] === 'E674'
        && adx(row) < 30
        ? undefined
        : matchedRule;
      const additionalRule = additionalAdmission?.(row) === true;
      const rejection = finalCurrentBarReject(row, !(disableP4E2Protection || additionalProtectionBypass?.(row) === true));
      if (rejection) return reject(rejection);
      // A registered lineage rule is itself a current-bar release condition.
      // Requiring the separate reactive/V1.2 extension flag as well made the
      // dynamic seam stricter than the cumulative E674 parent, dropping valid
      // rule-matched entries whose ordinary signal was unavailable.
      if (currentArm || context.backwardationOnly && candidateA || candidateA || rule || additionalRule) {
        return allow(rule?.[0] ?? (additionalRule ? 'P4_CURRENT_ADDITIONAL_RULE' : candidateA ? 'P4_PARENT_OR_RULE_RELEASE' : 'P4_NORMAL_GATE'));
      }
      return reject('P4_NO_PARENT_OR_RULE_MATCH');
    },
    onClose(context) {
      lastSettledPnl = context.pnl;
      settledPnlHistory.push(context.pnl);
      if (settledPnlHistory.length > 32) settledPnlHistory.shift();
    },
  };
}

const p4Overrides: NonNullable<BacktestRunSpec['strategyOverrides']> = {
  enablePCS: true, enableEquityBoostPCS: false, pcsTargetDte: QQQ_P4_E674_TARGET_DTE, pcsSpreadWidthPct: QQQ_P4_E674_WIDTH_PCT,
  pcsExcludeRiskOnWeakening: false, pcsBass221Gate: false, pcsV11Gate: false, pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20',
  pcsV12Gate: false, pcsV121Gate: true, pcsV122Gate: false, pcsV123Gate: true, pcsV123B30ReleaseLower: .38,
  pcsBass232Candidate2Gate: false, pcsBass232Candidate3Gate: false, pcsResearchProfile: 'candidate3', pcsCandidate3ExtraRelease: 'bull_sr02_rv_adx',
  pcsRiskEnvelopeMode: undefined, pcsRiskEnvelopeProfile: undefined, pcsResearchSafetyOverride: undefined, pcsRescueEnabled: false,
  pcsSurvivalSelectionFloor: .3, pcsSurvivalSelectionSurvivalWeight: .825, pcsSurvivalSelectionWilsonWeight: .3,
  pcsSurvivalSelectionStressTailVetoRatio: .76, pcsSurvivalSelectionStressTailVetoRegime: 'RANGE_BOUND', pcsSurvivalSelectionStressTailVetoSlowSubregime: 'SR01', pcsSurvivalSelectionStressTailVetoRv20Max: .57,
  pcsSurvivalSelectionObjective: 'tail_aware_expected_pnl', pcsSurvivalSelectionObjectiveRegime: 'BULL', pcsSurvivalSelectionObjectiveSlowSubregime: 'SR01', pcsSurvivalSelectionObjectiveAdxMin: 10, pcsSurvivalSelectionObjectiveRv20Min: .45,
};

/** Shared P4 research contract for focused current-arm diagnostics. */
export const QQQ_P4_E674_OVERRIDES = p4Overrides;

function metrics(rows: readonly QqqP4DynamicRow[]): QqqP4DynamicMetrics {
  const pnls = rows.map((row) => row.pnl);
  const sorted = [...pnls].sort((a, b) => a - b);
  const tail = Math.max(1, Math.ceil(pnls.length * .05));
  let curve = 0; let peak = 0; let mdd = 0;
  for (const pnl of pnls) { curve += pnl; peak = Math.max(peak, curve); mdd = Math.min(mdd, curve - peak); }
  const wins = pnls.filter((pnl) => pnl > 0).length;
  return { n: pnls.length, wins, losses: pnls.length - wins, winRate: pnls.length ? wins / pnls.length : 0, pnl: pnls.reduce((sum, pnl) => sum + pnl, 0), cvar5: sorted.slice(0, tail).reduce((sum, pnl) => sum + pnl, 0) / tail, worst: sorted[0] ?? 0, mdd };
}

/**
 * Named P4 research replay. This is one chronological current-bar run over
 * the supplied MarketDataSet. Backup1884 remains a historical benchmark and
 * is intentionally not used as an admission source here.
 */
export async function buildQqqP4DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet, options: QqqP4DynamicReplayOptions = {}): Promise<QqqP4DynamicReplay> {
  const baseSpec = buildQqqPcsHistoricalBacktestSpec({ startDate, endDate, replayVariant: 'v1_2_7_b', strikeMode: 'delta', exitMode: options.exitMode ?? 'hold_to_expiry', ...(options.pcsConcurrencyGate ? { pcsConcurrencyGate: options.pcsConcurrencyGate, ...(options.pcsCooldownTradingDays ? { pcsCooldownTradingDays: options.pcsCooldownTradingDays } : {}) } : {}) });
  const admissionStats: P4AdmissionStats = { evaluated: 0, allowed: 0, reasons: {}, decisions: [], currentArm: [] };
  const result = runWithData(resolveRunSpec({
    ...baseSpec,
    config: {
      ...baseSpec.config,
      trace: options.trace ?? true,
      admissionDiagnostics: options.trace === false,
      ...(options.pcsPositionModeOverride
        ? { optionsBacktestPositionMode: { ...baseSpec.config.optionsBacktestPositionMode, pcs: options.pcsPositionModeOverride } }
        : {}),
    },
    ...(options.canonicalOptionSignalStartDate ? {
      scenarioOptions: { ...baseSpec.scenarioOptions, canonicalOptionSignalStartDate: options.canonicalOptionSignalStartDate },
    } : {}),
    strategyOverrides: {
      ...baseSpec.strategyOverrides,
      ...p4Overrides,
      ...options.selectionOverrides,
      ...options.contractOverrides,
      ...(options.widthBySlowSubregime ? { pcsResearchSpreadWidthBySlowSubregime: options.widthBySlowSubregime } : {}),
      ...(options.widthByVix ? { pcsResearchSpreadWidthByVix: options.widthByVix } : {}),
      ...options.exitOverrides,
      ...options.timingOverrides,
      ...options.rescueOverrides,
      ...options.riskOverrides,
      // Build the complete same-bar contract pool first. The dynamic profile
      // below is the only P4 admission point; keeping these upstream pool
      // switches open is required to let it evaluate bars that ordinary
      // V1.2.1/V1.2.3 would reject before reaching the profile seam.
      pcsV121Gate: false,
      pcsV123Gate: false,
      // Keep the current P4 pool by default. An explicit own-property with
      // undefined is reserved for research that wants the normal engine timing
      // evaluator; production/default callers never use this escape hatch.
      pcsResearchTimingOverride: options.timingOverrides && Object.prototype.hasOwnProperty.call(options.timingOverrides, 'pcsResearchTimingOverride')
        ? options.timingOverrides.pcsResearchTimingOverride
        : 'allow',
      pcsResearchProfile: 'candidateAResearch',
      pcsRiskEnvelopeMode: 'candidate4_v1',
      pcsRiskEnvelopeProfile: 'candidate4_full_only_v1',
      pcsResearchSafetyOverride: 'allow_backwardation_only',
    },
  }), data, OVERLAY_PRODUCTION_DEFAULTS, {
    skipHistoricalCandidateAResearch: true,
    ...options.execution,
    ...(options.profiler ? { phaseProfiler: { record: (phase: string, milliseconds: number) => options.profiler!.record(`P6 phase ${phase}`, milliseconds) } } : {}),
    pcsDynamicEntryProfile: createQqqP4E674DynamicProfile(options.additionalAdmission, admissionStats, options.additionalReject, options.disableP4E2Protection, options.disableP4E1AdxMerge, options.additionalProtectionBypass, options.additionalBaseProtectionBypass, options.additionalRejectBypass),
  }) as Result;
  const rows = pairRows(result);
  return {
    id: QQQ_P4_E674_ID,
    raw: result,
    dailySignals: (result.debug?.dailyAdmissions ?? (result.debug?.trace ?? []).map(entry => ({ date: entry.date, admissions: entry.overlay?.strategyAdmissions ?? [] }))).flatMap(entry => {
      const admission = entry.admissions.find(item => item.strategyTag === 'QQQ_PUT_CREDIT_SPREAD');
      return admission ? [{ date: day(entry.date), strategy: admission.strategyLabel, eligibility: admission.eligibility, reasons: admission.reasons, gates: admission.gates }] : [];
    }),
    rows,
    tradeLog: result.tradeLog,
    metrics: metrics(rows),
    dataFingerprint: result.dataFingerprint,
    audit: {
      source: 'current-engine-runWithData',
      singleReplay: true,
      currentBarFeatures: true,
      postSelectionAdmission: true,
      settledPnlStateUpdates: true,
      retrospectiveSelection: false,
      noDateWhitelist: true,
      noPersistedDateAdmission: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
      rawPoolRows: admissionStats.evaluated,
      currentRows: rows.length,
      selectedRows: rows.length,
      rejectedRows: Math.max(0, admissionStats.evaluated - admissionStats.allowed),
      profileEvaluations: admissionStats.evaluated,
      admissionReasons: admissionStats.reasons,
      admissionDecisions: admissionStats.decisions,
      currentArmDecisions: admissionStats.currentArm,
      activeRuleIds: rules.map(([id]) => id),
    },
  };
}

/**
 * P4.E0 research baseline: current-bar P4 before the E1 ADX-boundary merge
 * and before the later R6 protection. The normal P4 builder is unchanged.
 */
export async function buildQqqP4E0DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { disableP4E1AdxMerge: true, disableP4E2Protection: true });
}

/** P4.E1 research parent: keep the E1 ADX merge, excluding the later R6 branch. */
export async function buildQqqP4E1DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { disableP4E2Protection: true });
}

/** P4.E3.A research candidate: E2.NarrowR6 plus one merged current-bar veto. */
export async function buildQqqP4E3ADynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E3ACurrentBarReject });
}

/** Canonical sequential P4.E3 research builder. */
export async function buildQqqP4E3DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E3CurrentBarReject });
}

/** Canonical sequential P4.E4 research candidate: simplify E3's VIX band. */
export function isQqqP4E4CurrentBarReject(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 15, 18)
    && band(currentAdx, 12, 20)
    && band(currentRv, .4, .5)
    && extension >= 1.5;
}

export async function buildQqqP4E4DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E4CurrentBarReject });
}

/** Canonical sequential P4.E5 research candidate: one merged SIDEWAYS guard. */
export function isQqqP4E5CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && vix(row) >= 25
    && adx(row) < 12
    && rv(row) >= .6
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5;
}

export async function buildQqqP4E5DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: row => isQqqP4E4CurrentBarReject(row) || isQqqP4E5CurrentBarReject(row) });
}

/** Canonical sequential P4.E6 research candidate: one merged BULL/SR01 guard. */
export function isQqqP4E6CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 17, 21)
    && adx(row) < 22
    && band(rv(row), .45, .6)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2;
}

export async function buildQqqP4E6DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: row => isQqqP4E4CurrentBarReject(row) || isQqqP4E5CurrentBarReject(row) || isQqqP4E6CurrentBarReject(row) });
}

/** Canonical sequential P4.E7 research candidate: merge one BULL/SR01 high-VIX guard. */
export function isQqqP4E7CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && vix(row) >= 19
    && adx(row) < 20
    && band(rv(row), .4, .6)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5;
}

export async function buildQqqP4E7DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: row => isQqqP4E4CurrentBarReject(row) || isQqqP4E5CurrentBarReject(row) || isQqqP4E6CurrentBarReject(row) || isQqqP4E7CurrentBarReject(row) });
}

/** Canonical sequential P4.E8 research candidate: merge E7's wider ADX boundary. */
export function isQqqP4E8CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && vix(row) >= 19
    && adx(row) < 22
    && band(rv(row), .4, .6)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5;
}

export async function buildQqqP4E8DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  // E8 subsumes E7's ADX<20 branch, so the merged protection is E4 ∨ E5 ∨ E6 ∨ E8.
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: row => isQqqP4E4CurrentBarReject(row) || isQqqP4E5CurrentBarReject(row) || isQqqP4E6CurrentBarReject(row) || isQqqP4E8CurrentBarReject(row) });
}

/** Canonical sequential P4.E9 research candidate: merge the residual EXTENDED/SR02 low-RV guard. */
export function isQqqP4E9CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 16)
    && adx(row) >= 30
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5;
}

/**
 * P4.E9 simplified admission: three direct current-bar guards.
 *
 * The historical E4/E5/E6/E8/E9 predicates remain exported for lineage and
 * parity tests, but the active E9 path no longer nests those old layers.
 * Each guard below is the exact union of its corresponding historical
 * branches, so this is a structural simplification rather than a broader
 * admission rule.
 */
export function isQqqP4E9MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && currentAdx < 22
    && band(currentRv, .4, .6)
    && extension >= 1.5
    && (currentVix >= 19 || (band(currentVix, 17, 19) && currentRv >= .45 && extension >= 2));
  const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && extension >= 1.5
    && ((band(currentVix, 15, 18) && band(currentAdx, 12, 20) && band(currentRv, .4, .5))
      || (band(currentVix, 14, 16) && currentAdx >= 30 && band(currentRv, .3, .4)));
  const sidewaysSr01 = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && currentVix >= 25
    && currentAdx < 12
    && currentRv >= .6
    && extension >= 1.5;
  return bullSr01 || extendedSr02 || sidewaysSr01;
}

export async function buildQqqP4E9DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E9MergedCurrentBarReject });
}

/** Canonical sequential P4.E10 research candidate: extend the merged BULL/SR01 guard to the low-extension residual. */
export function isQqqP4E10CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 14, 19)
    && adx(row) < 20
    && band(rv(row), .4, .6)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 1;
}

export function isQqqP4E10MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E9MergedCurrentBarReject(row) || isQqqP4E10CurrentBarReject(row);
}

export async function buildQqqP4E10DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E10MergedCurrentBarReject });
}

/** Canonical sequential P4.E11 research candidate: add the residual BULL/SR02 low-VIX guard. */
export function isQqqP4E11CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 17)
    && band(adx(row), 15, 25)
    && band(rv(row), .2, .4)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 1;
}

export function isQqqP4E11MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E10MergedCurrentBarReject(row) || isQqqP4E11CurrentBarReject(row);
}

export async function buildQqqP4E11DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E11MergedCurrentBarReject });
}

/** Canonical sequential P4.E12 research candidate: add the residual WEAKENING/SR02 guard. */
export function isQqqP4E12CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && vix(row) >= 19
    && adx(row) >= 25
    && band(rv(row), .3, .6)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E12MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E11MergedCurrentBarReject(row) || isQqqP4E12CurrentBarReject(row);
}

export async function buildQqqP4E12DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E12MergedCurrentBarReject });
}

/** Canonical sequential P4.E13 research candidate: add the SIDEWAYS/E5 lower-VIX boundary. */
export function isQqqP4E13CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 22, 25)
    && adx(row) < 12
    && band(rv(row), .6, .8)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5;
}

/** Exact E5 ∨ E13 merge: one SIDEWAYS/SR01 guard with the lower VIX floor. */
export function isQqqP4E13SidewaysMergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && adx(row) < 12
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 1.5
    && ((vix(row) >= 25 && rv(row) >= .6) || (band(vix(row), 22, 25) && band(rv(row), .6, .8)));
}

export function isQqqP4E13MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Reuse the exact E9 three-guard union; only the later residual layers
  // remain here. This keeps the active lineage shallow without changing the
  // E13 trade set.
  return isQqqP4E9MergedCurrentBarReject(row)
    || isQqqP4E10CurrentBarReject(row)
    || isQqqP4E11CurrentBarReject(row)
    || isQqqP4E12CurrentBarReject(row)
    || isQqqP4E13SidewaysMergedCurrentBarReject(row);
}

export async function buildQqqP4E13DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E13MergedCurrentBarReject });
}

/** Canonical sequential P4.E14 research candidate: remove the small BULL/SR02 residual loss cluster. */
export function isQqqP4E14CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 17)
    && band(adx(row), 10, 20)
    && band(rv(row), .3, .4)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 1, 2);
}

export function isQqqP4E14MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E13MergedCurrentBarReject(row) || isQqqP4E14CurrentBarReject(row);
}

export async function buildQqqP4E14DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E14MergedCurrentBarReject });
}

/** Canonical sequential P4.E15 research candidate: merge the BULL/SR02 negative-extension residual. */
export function isQqqP4E15CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 17)
    && band(adx(row), 20, 35)
    && band(rv(row), .3, .45)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0;
}

export function isQqqP4E15MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E14MergedCurrentBarReject(row) || isQqqP4E15CurrentBarReject(row);
}

export async function buildQqqP4E15DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E15MergedCurrentBarReject });
}

/** Canonical sequential P4.E16 research candidate: merge the WEAKENING/SR02 low-RV residual. */
export function isQqqP4E16CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 16, 19)
    && band(adx(row), 10, 20)
    && band(rv(row), .4, .6)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0;
}

export function isQqqP4E16MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E15MergedCurrentBarReject(row) || isQqqP4E16CurrentBarReject(row);
}

export async function buildQqqP4E16DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E16MergedCurrentBarReject });
}

/** Canonical sequential P4.E17 research candidate: merge the BULL/SR01 positive-extension residual. */
export function isQqqP4E17CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 14, 17)
    && band(adx(row), 30, 35)
    && band(rv(row), .35, .45)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 1);
}

export function isQqqP4E17MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E16MergedCurrentBarReject(row) || isQqqP4E17CurrentBarReject(row);
}

export async function buildQqqP4E17DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E17MergedCurrentBarReject });
}

/** Canonical sequential P4.E18 research candidate: merge the SIDEWAYS/SR01 high-VIX residual. */
export function isQqqP4E18CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && vix(row) >= 30
    && adx(row) < 10
    && rv(row) >= .8
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0;
}

export function isQqqP4E18MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E17MergedCurrentBarReject(row) || isQqqP4E18CurrentBarReject(row);
}

export async function buildQqqP4E18DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E18MergedCurrentBarReject });
}

/** Canonical sequential P4.E19 research candidate: merge the BULL/SR02 low-ADX positive-extension residual. */
export function isQqqP4E19CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 17)
    && adx(row) < 15
    && band(rv(row), .4, .5)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 1.5);
}

export function isQqqP4E19MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E18MergedCurrentBarReject(row) || isQqqP4E19CurrentBarReject(row);
}

export async function buildQqqP4E19DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E19MergedCurrentBarReject });
}

/** Canonical sequential P4.E20 research candidate: merge the BULL/SR02 high-ADX positive-extension residual. */
export function isQqqP4E20CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 17)
    && band(adx(row), 30, 40)
    && band(rv(row), .3, .45)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 2);
}

export function isQqqP4E20MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E19MergedCurrentBarReject(row) || isQqqP4E20CurrentBarReject(row);
}

export async function buildQqqP4E20DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E20MergedCurrentBarReject });
}

/**
 * P4.E21 structural simplification: flatten the complete E20 research
 * protection into one current-bar predicate. This intentionally preserves the
 * E20 trade set; it removes the nested E9 -> E20 wrapper chain before any new
 * admission rule is considered.
 */
export function isQqqP4E21FlatMergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const regime = row.market.regime;
  const slowSubregime = row.market.slowSubregime;

  const bullSr01 = regime === 'BULL' && slowSubregime === 'SR01'
    && currentAdx < 22 && band(currentRv, .4, .6) && extension >= 1.5
    && (currentVix >= 19 || (band(currentVix, 17, 19) && currentRv >= .45 && extension >= 2));
  const extendedSr02 = regime === 'RISK_ON_EXTENDED' && slowSubregime === 'SR02'
    && extension >= 1.5
    && ((band(currentVix, 15, 18) && band(currentAdx, 12, 20) && band(currentRv, .4, .5))
      || (band(currentVix, 14, 16) && currentAdx >= 30 && band(currentRv, .3, .4)));
  const sidewaysSr01 = regime === 'SIDEWAYS' && slowSubregime === 'SR01'
    && currentVix >= 25 && currentAdx < 12 && currentRv >= .6 && extension >= 1.5;
  const bullSr01LowExtension = regime === 'BULL' && slowSubregime === 'SR01'
    && band(currentVix, 14, 19) && currentAdx < 20 && band(currentRv, .4, .6) && extension < 1;
  const bullSr02LowVix = regime === 'BULL' && slowSubregime === 'SR02'
    && band(currentVix, 14, 17) && band(currentAdx, 15, 25) && band(currentRv, .2, .4) && extension < 1;
  const weakeningSr02 = regime === 'RISK_ON_WEAKENING' && slowSubregime === 'SR02'
    && currentVix >= 19 && currentAdx >= 25 && band(currentRv, .3, .6) && extension < 0;
  const sidewaysSr01LowerVix = regime === 'SIDEWAYS' && slowSubregime === 'SR01'
    && currentAdx < 12 && extension >= 1.5
    && ((currentVix >= 25 && currentRv >= .6) || (band(currentVix, 22, 25) && band(currentRv, .6, .8)));
  const bullSr02Positive = regime === 'BULL' && slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && ((band(currentAdx, 10, 20) && band(currentRv, .3, .4) && band(extension, 1, 2))
      || (band(currentAdx, 20, 35) && band(currentRv, .3, .45) && extension < 0)
      || (currentAdx < 15 && band(currentRv, .4, .5) && band(extension, .5, 1.5))
      || (band(currentAdx, 30, 40) && band(currentRv, .3, .45) && band(extension, .5, 2)));
  const weakeningSr02Negative = regime === 'RISK_ON_WEAKENING' && slowSubregime === 'SR02'
    && band(currentVix, 16, 19) && band(currentAdx, 10, 20) && band(currentRv, .4, .6) && extension < 0;
  const bullSr01Positive = regime === 'BULL' && slowSubregime === 'SR01'
    && band(currentVix, 14, 17) && band(currentAdx, 30, 35) && band(currentRv, .35, .45) && band(extension, .5, 1);
  const sidewaysSr01HighVix = regime === 'SIDEWAYS' && slowSubregime === 'SR01'
    && currentVix >= 30 && currentAdx < 10 && currentRv >= .8 && extension >= 0;

  return bullSr01 || extendedSr02 || sidewaysSr01 || bullSr01LowExtension || bullSr02LowVix
    || weakeningSr02 || sidewaysSr01LowerVix || bullSr02Positive || weakeningSr02Negative
    || bullSr01Positive || sidewaysSr01HighVix;
}

export async function buildQqqP4E21DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E21FlatMergedCurrentBarReject });
}

/** Canonical sequential P4.E22 research candidate: one compact BULL/SR02 mid-VIX veto. */
export function isQqqP4E22CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 17, 20)
    && band(adx(row), 15, 30)
    && band(rv(row), .3, .6)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E22MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E21FlatMergedCurrentBarReject(row) || isQqqP4E22CurrentBarReject(row);
}

export async function buildQqqP4E22DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E22MergedCurrentBarReject });
}

/** Canonical sequential P4.E23 research candidate: compact SIDEWAYS/CURRENT high-VIX veto. */
export function isQqqP4E23CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'CURRENT'
    && vix(row) >= 25
    && adx(row) < 10
    && rv(row) >= .7;
}

export function isQqqP4E23MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E22MergedCurrentBarReject(row) || isQqqP4E23CurrentBarReject(row);
}

export async function buildQqqP4E23DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E23MergedCurrentBarReject });
}

/** Canonical sequential P4.E24 research candidate: compact RANGE/SR01 residual veto. */
export function isQqqP4E24CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 24, 26)
    && band(adx(row), 10, 18)
    && band(rv(row), .5, .7)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E24MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E23MergedCurrentBarReject(row) || isQqqP4E24CurrentBarReject(row);
}

export async function buildQqqP4E24DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E24MergedCurrentBarReject });
}

/** Canonical sequential P4.E25 research candidate: compact WEAKENING/SR01 RV45 veto. */
export function isQqqP4E25CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 16, 19)
    && band(adx(row), 15, 20)
    && band(rv(row), .45, .6)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E25MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E24MergedCurrentBarReject(row) || isQqqP4E25CurrentBarReject(row);
}

export async function buildQqqP4E25DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E25MergedCurrentBarReject });
}

/** Canonical sequential P4.E26 research candidate: compact BULL/SR01 high-ADX veto. */
export function isQqqP4E26CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 16, 17)
    && band(adx(row), 40, 45)
    && band(rv(row), .9, 1.1)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 0;
}

export function isQqqP4E26MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E25MergedCurrentBarReject(row) || isQqqP4E26CurrentBarReject(row);
}

export async function buildQqqP4E26DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E26MergedCurrentBarReject });
}

/** Canonical sequential P4.E27 research candidate: compact RANGE/SR01 VIX18 residual veto. */
export function isQqqP4E27CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 18, 18.5)
    && band(adx(row), 10, 15)
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E27MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E26MergedCurrentBarReject(row) || isQqqP4E27CurrentBarReject(row);
}

export async function buildQqqP4E27DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E27MergedCurrentBarReject });
}

/** Canonical sequential P4.E28 research candidate: compact BULL/CURRENT veto. */
export function isQqqP4E28CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'CURRENT'
    && band(vix(row), 19, 21)
    && band(adx(row), 25, 35)
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E28MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E27MergedCurrentBarReject(row) || isQqqP4E28CurrentBarReject(row);
}

export async function buildQqqP4E28DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E28MergedCurrentBarReject });
}

/** Canonical sequential P4.E29 research candidate: compact WEAKENING/SR01 high-VIX veto. */
export function isQqqP4E29CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 21, 22)
    && band(adx(row), 15, 22)
    && band(rv(row), .5, .7)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E29MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E28MergedCurrentBarReject(row) || isQqqP4E29CurrentBarReject(row);
}

export async function buildQqqP4E29DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E29MergedCurrentBarReject });
}

/** Canonical sequential P4.E30 research candidate: compact WEAKENING/SR01 mid-VIX veto. */
export function isQqqP4E30CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 18, 19)
    && band(adx(row), 30, 40)
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E30MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E29MergedCurrentBarReject(row) || isQqqP4E30CurrentBarReject(row);
}

export async function buildQqqP4E30DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E30MergedCurrentBarReject });
}

/** Canonical sequential P4.E31 research candidate: compact WEAKENING/SR02 low-VIX veto. */
export function isQqqP4E31CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 15, 16)
    && band(adx(row), 10, 15)
    && band(rv(row), .3, .45)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E31MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E30MergedCurrentBarReject(row) || isQqqP4E31CurrentBarReject(row);
}

export async function buildQqqP4E31DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E31MergedCurrentBarReject });
}

/** Canonical sequential P4.E32 research candidate: compact BULL/SR02 positive-extension veto. */
export function isQqqP4E32CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 18, 19)
    && band(adx(row), 15, 22)
    && band(rv(row), .3, .4)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 1.5, 2);
}

export function isQqqP4E32MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E31MergedCurrentBarReject(row) || isQqqP4E32CurrentBarReject(row);
}

export async function buildQqqP4E32DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E32MergedCurrentBarReject });
}

/** Canonical sequential P4.E33 research candidate: compact EXTENDED/SR01 tight veto. */
export function isQqqP4E33CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 14, 16)
    && band(adx(row), 18, 21)
    && band(rv(row), .3, .35)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 2, 2.5);
}

export function isQqqP4E33MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E32MergedCurrentBarReject(row) || isQqqP4E33CurrentBarReject(row);
}

export async function buildQqqP4E33DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E33MergedCurrentBarReject });
}

/** Canonical sequential P4.E34 research candidate: compact RANGE/SR02 tight veto. */
export function isQqqP4E34CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 18, 18.5)
    && band(adx(row), 16, 21)
    && band(rv(row), .3, .45)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 1);
}

export function isQqqP4E34MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E33MergedCurrentBarReject(row) || isQqqP4E34CurrentBarReject(row);
}

export async function buildQqqP4E34DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E34MergedCurrentBarReject });
}

/** Canonical sequential P4.E35 research candidate: compact WEAKENING/CURRENT veto. */
export function isQqqP4E35CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'CURRENT'
    && band(vix(row), 16, 17)
    && band(adx(row), 10, 15)
    && band(rv(row), .3, .45)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E35MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E34MergedCurrentBarReject(row) || isQqqP4E35CurrentBarReject(row);
}

export async function buildQqqP4E35DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E35MergedCurrentBarReject });
}

/** Canonical sequential P4.E36 research candidate: compact BULL/SR02 high-ADX negative-extension veto. */
export function isQqqP4E36CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 18, 19)
    && band(adx(row), 30, 40)
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E36MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E35MergedCurrentBarReject(row) || isQqqP4E36CurrentBarReject(row);
}

export async function buildQqqP4E36DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E36MergedCurrentBarReject });
}

/** Canonical sequential P4.E37 research candidate: compact BULL/SR02 high-RV veto. */
export function isQqqP4E37CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 19, 20)
    && band(adx(row), 15, 20)
    && band(rv(row), .8, 1)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 1);
}

export function isQqqP4E37MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E36MergedCurrentBarReject(row) || isQqqP4E37CurrentBarReject(row);
}

export async function buildQqqP4E37DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E37MergedCurrentBarReject });
}

/** Canonical sequential P4.E38 research candidate: compact RANGE/SR01 low-VIX veto. */
export function isQqqP4E38CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 13, 14)
    && band(adx(row), 15, 16)
    && band(rv(row), .4, .45)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 0, .3);
}

export function isQqqP4E38MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E37MergedCurrentBarReject(row) || isQqqP4E38CurrentBarReject(row);
}

export async function buildQqqP4E38DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E38MergedCurrentBarReject });
}

/** Canonical sequential P4.E39 research candidate: compact BULL/SR02 high-ADX veto. */
export function isQqqP4E39CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 15)
    && band(adx(row), 30, 40)
    && band(rv(row), .4, .5)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2;
}

export function isQqqP4E39MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E38MergedCurrentBarReject(row) || isQqqP4E39CurrentBarReject(row);
}

export async function buildQqqP4E39DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E39MergedCurrentBarReject });
}

/** Canonical sequential P4.E40 research candidate: compact BULL/SR01 low-ADX veto. */
export function isQqqP4E40CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 14, 15)
    && band(adx(row), 0, 12)
    && band(rv(row), .3, .45)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 1, 1.5);
}

export function isQqqP4E40MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E39MergedCurrentBarReject(row) || isQqqP4E40CurrentBarReject(row);
}

export async function buildQqqP4E40DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E40MergedCurrentBarReject });
}

/** Canonical sequential P4.E41 research candidate: compact BULL/SR02 mid-VIX veto. */
export function isQqqP4E41CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 15, 16)
    && band(adx(row), 20, 25)
    && band(rv(row), .5, .6)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 0, .5);
}

export function isQqqP4E41MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E40MergedCurrentBarReject(row) || isQqqP4E41CurrentBarReject(row);
}

export async function buildQqqP4E41DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E41MergedCurrentBarReject });
}

/** Canonical sequential P4.E42 research candidate: compact BULL/SR02 low-ADX veto. */
export function isQqqP4E42CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 15)
    && band(adx(row), 12, 15)
    && band(rv(row), .4, .5)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 0, .5);
}

export function isQqqP4E42MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E41MergedCurrentBarReject(row) || isQqqP4E42CurrentBarReject(row);
}

export async function buildQqqP4E42DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E42MergedCurrentBarReject });
}

/** Canonical sequential P4.E43 research candidate: compact BULL/SR02 low-VIX extension veto. */
export function isQqqP4E43CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 15)
    && band(adx(row), 18, 20)
    && band(rv(row), .4, .5)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) >= 2;
}

export function isQqqP4E43MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E42MergedCurrentBarReject(row) || isQqqP4E43CurrentBarReject(row);
}

export async function buildQqqP4E43DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E43MergedCurrentBarReject });
}

/** Canonical sequential P4.E44 research candidate: compact BULL/SR02 low-RV veto. */
export function isQqqP4E44CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 15)
    && band(adx(row), 24, 27)
    && band(rv(row), .2, .3)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < 0;
}

export function isQqqP4E44MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E43MergedCurrentBarReject(row) || isQqqP4E44CurrentBarReject(row);
}

export async function buildQqqP4E44DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E44MergedCurrentBarReject });
}

/** Canonical sequential P4.E45 research candidate: compact WEAKENING/SR02 mid-ADX veto. */
export function isQqqP4E45CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 16, 17)
    && band(adx(row), 30, 32)
    && band(rv(row), .35, .45)
    && finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0;
}

export function isQqqP4E45MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E44MergedCurrentBarReject(row) || isQqqP4E45CurrentBarReject(row);
}

export async function buildQqqP4E45DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E45MergedCurrentBarReject });
}

/** Canonical sequential P4.E46 research candidate: compact BULL/SR02 high-VIX veto. */
export function isQqqP4E46CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 22, 23)
    && band(adx(row), 28, 30)
    && band(rv(row), .6, .7)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), 1.5, 2.2);
}

export function isQqqP4E46MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E45MergedCurrentBarReject(row) || isQqqP4E46CurrentBarReject(row);
}

export async function buildQqqP4E46DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E46MergedCurrentBarReject });
}

/** Canonical sequential P4.E47 research candidate: compact RANGE/SR02 low-RV veto. */
export function isQqqP4E47CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 18, 19)
    && band(adx(row), 16, 18)
    && band(rv(row), .35, .45)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < -1;
}

export function isQqqP4E47MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E46MergedCurrentBarReject(row) || isQqqP4E47CurrentBarReject(row);
}

export async function buildQqqP4E47DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E47MergedCurrentBarReject });
}

/** Canonical sequential P4.E48 research candidate: compact WEAKENING/SR02 tail veto. */
export function isQqqP4E48CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 22, 23)
    && band(adx(row), 15, 16)
    && band(rv(row), .5, .6)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), -1.3, -.8);
}

export function isQqqP4E48MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E47MergedCurrentBarReject(row) || isQqqP4E48CurrentBarReject(row);
}

export async function buildQqqP4E48DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E48MergedCurrentBarReject });
}

/** Canonical sequential P4.E49 research candidate: compact BULL/SR02 100%-WR tail veto. */
export function isQqqP4E49CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 16, 17)
    && band(adx(row), 15, 17)
    && band(rv(row), .5, .6)
    && band(finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY), .5, 1);
}

export function isQqqP4E49MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E48MergedCurrentBarReject(row) || isQqqP4E49CurrentBarReject(row);
}

export async function buildQqqP4E49DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E49MergedCurrentBarReject });
}

/** Canonical sequential P4.E50 research candidate: compact SIDEWAYS/SR01 stress veto. */
export function isQqqP4E50CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 33, 36)
    && band(adx(row), 10, 20)
    && band(rv(row), .7, 1)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) > 0;
}

export function isQqqP4E50MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E49MergedCurrentBarReject(row) || isQqqP4E50CurrentBarReject(row);
}

export async function buildQqqP4E50DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E50MergedCurrentBarReject });
}

/** Canonical sequential P4.E51 research candidate: simplified SIDEWAYS/SR01 veto. */
export function isQqqP4E51CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(vix(row), 33, 36)
    && band(adx(row), 10, 20);
}

export function isQqqP4E51MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E49MergedCurrentBarReject(row) || isQqqP4E51CurrentBarReject(row);
}

export async function buildQqqP4E51DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E51MergedCurrentBarReject });
}

/** Canonical sequential P4.E52 research candidate: minimal SR01/VIX/ADX veto. */
export function isQqqP4E52CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.slowSubregime === 'SR01'
    && band(vix(row), 33, 36)
    && band(adx(row), 10, 20);
}

export function isQqqP4E52MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E49MergedCurrentBarReject(row) || isQqqP4E52CurrentBarReject(row);
}

export async function buildQqqP4E52DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E52MergedCurrentBarReject });
}

/** Canonical sequential P4.E53 research candidate: generalized SR01/VIX-floor/ADX veto. */
export function isQqqP4E53CurrentBarReject(row: QqqP4DynamicRow): boolean {
  return row.market.slowSubregime === 'SR01'
    && finite(row.market.vix, Number.NEGATIVE_INFINITY) >= 33
    && band(adx(row), 10, 20);
}

export function isQqqP4E53MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E49MergedCurrentBarReject(row) || isQqqP4E53CurrentBarReject(row);
}

export async function buildQqqP4E53DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E53MergedCurrentBarReject });
}

/**
 * Canonical sequential P4.E54 structural candidate: flatten the E53
 * historical chain into one direct current-bar union. The individual
 * predicates remain named for lineage, while admission no longer traverses
 * E49 -> E48 -> ... wrappers at runtime.
 */
const qqqP4E54FlatRejectors: Array<(row: QqqP4DynamicRow) => boolean> = [
  isQqqP4E21FlatMergedCurrentBarReject,
  isQqqP4E22CurrentBarReject,
  isQqqP4E23CurrentBarReject,
  isQqqP4E24CurrentBarReject,
  isQqqP4E25CurrentBarReject,
  isQqqP4E26CurrentBarReject,
  isQqqP4E27CurrentBarReject,
  isQqqP4E28CurrentBarReject,
  isQqqP4E29CurrentBarReject,
  isQqqP4E30CurrentBarReject,
  isQqqP4E31CurrentBarReject,
  isQqqP4E32CurrentBarReject,
  isQqqP4E33CurrentBarReject,
  isQqqP4E34CurrentBarReject,
  isQqqP4E35CurrentBarReject,
  isQqqP4E36CurrentBarReject,
  isQqqP4E37CurrentBarReject,
  isQqqP4E38CurrentBarReject,
  isQqqP4E39CurrentBarReject,
  isQqqP4E40CurrentBarReject,
  isQqqP4E41CurrentBarReject,
  isQqqP4E42CurrentBarReject,
  isQqqP4E43CurrentBarReject,
  isQqqP4E44CurrentBarReject,
  isQqqP4E45CurrentBarReject,
  isQqqP4E46CurrentBarReject,
  isQqqP4E47CurrentBarReject,
  isQqqP4E48CurrentBarReject,
  isQqqP4E49CurrentBarReject,
  isQqqP4E53CurrentBarReject,
];

export function isQqqP4E54FlatMergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return qqqP4E54FlatRejectors.some((reject) => reject(row));
}

export async function buildQqqP4E54DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E54FlatMergedCurrentBarReject });
}

/**
 * Canonical sequential P4.E56 recovery candidate: recover four narrow
 * current-bar subclusters from E54 while retaining the surrounding E54
 * protection. The branches are merged by regime/subregime and never use
 * dates, accepted-date artifacts, or future settlement information.
 */
export function isQqqP4E56RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && currentVix >= 21
    && currentAdx < 22
    && band(currentRv, .4, .6)
    && extension >= 1.5;
  const bullSr02LowAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentAdx < 18
    && ((band(currentVix, 14, 17) && band(currentAdx, 10, 20) && band(currentRv, .3, .4) && band(extension, 1, 2))
      || (band(currentVix, 17, 20) && band(currentAdx, 15, 30) && band(currentRv, .3, .6) && extension < 0));
  const weakeningSr02LowVix = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 17.5
    && band(currentVix, 16, 19)
    && band(currentAdx, 10, 20)
    && band(currentRv, .4, .6)
    && extension < 0;
  return bullSr01 || bullSr02LowAdx || weakeningSr02LowVix;
}

export function isQqqP4E56MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E54FlatMergedCurrentBarReject(row) && !isQqqP4E56RecoveryCurrentBar(row);
}

export async function buildQqqP4E56DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E56MergedCurrentBarReject });
}

/** Canonical sequential P4.E57 recovery candidate: four merged E56 boundary recoveries. */
export function isQqqP4E57RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 14, 19)
    && currentVix >= 15
    && currentAdx < 20
    && band(currentRv, .4, .6)
    && currentRv < .5
    && extension < 1
    && extension >= 0;
  const bullSr02E11 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 15, 25)
    && band(currentRv, .2, .4)
    && extension < 1
    && currentAdx >= 22;
  const bullSr02E15 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 20, 35)
    && band(currentRv, .3, .45)
    && extension < 0
    && currentVix >= 15.5
    && extension > -.6;
  const bullSr02E20 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 30, 40)
    && band(currentRv, .3, .45)
    && band(extension, .5, 2)
    && currentVix >= 15;
  return bullSr01 || bullSr02E11 || bullSr02E15 || bullSr02E20;
}

export function isQqqP4E57MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E56MergedCurrentBarReject(row) && !isQqqP4E57RecoveryCurrentBar(row);
}

export async function buildQqqP4E57DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E57MergedCurrentBarReject });
}

/** Canonical sequential P4.E58 recovery candidate: eight safe E57 residual branches. */
export function isQqqP4E58RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 14, 19)
    && currentVix >= 17.5
    && currentAdx < 20
    && band(rv(row), .4, .6)
    && extension < 1
    && extension >= 0;
  const bullSr02E11 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 15, 25)
    && band(rv(row), .2, .4)
    && extension < 1
    && currentVix >= 15.5
    && currentAdx >= 19;
  const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentVix >= 17
    && band(currentVix, 15, 18)
    && currentAdx >= 12
    && currentAdx < 20
    && band(rv(row), .4, .5)
    && extension >= 1.5;
  const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentVix >= 22
    && currentVix >= 19
    && currentAdx >= 25
    && band(rv(row), .3, .6)
    && extension < 0;
  const sidewaysHighVix = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && currentVix >= 30
    && currentAdx < 10
    && rv(row) >= .8
    && extension >= 0
    && extension >= .3
    && extension < 0.5;
  const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 16, 19)
    && currentVix >= 18.4
    && band(currentAdx, 15, 20)
    && band(rv(row), .45, .6)
    && extension < 0;
  const weakeningSr01Tail = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 21, 22)
    && band(currentAdx, 15, 22)
    && band(rv(row), .5, .7)
    && extension < -1;
  const rangeSr02 = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 18, 18.5)
    && band(currentAdx, 16, 21)
    && band(rv(row), .3, .45)
    && extension >= .5
    && extension < 1
    && currentVix < 18.2;
  return bullSr01 || bullSr02E11 || extendedSr02 || weakeningSr02 || sidewaysHighVix || weakeningSr01 || weakeningSr01Tail || rangeSr02;
}

export function isQqqP4E58MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E57MergedCurrentBarReject(row) && !isQqqP4E58RecoveryCurrentBar(row);
}

export async function buildQqqP4E58DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E58MergedCurrentBarReject });
}

/** Canonical sequential P4.E59 recovery candidate: six merged E58 residual branches. */
export function isQqqP4E59RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 14, 19)
    && currentVix >= 17.25
    && currentAdx < 20
    && band(currentRv, .4, .6)
    && extension < 1
    && extension >= 0;
  const bullSr02LowAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 15, 25)
    && band(currentRv, .2, .4)
    && extension < 1
    && currentVix >= 15;
  const weakeningSr02Vix = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentVix >= 19
    && currentAdx >= 25
    && band(currentRv, .3, .6)
    && extension < 0
    && currentVix >= 20.5;
  const weakeningSr02Tail = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 16, 19)
    && band(currentAdx, 10, 20)
    && band(currentRv, .4, .6)
    && extension < 0
    && currentVix >= 18
    && extension < -1.5;
  const bullSr02HighAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 30, 40)
    && band(currentRv, .3, .45)
    && band(extension, .5, 2)
    && currentVix >= 14.3;
  const bullSr02MidVix = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 17, 20)
    && band(currentAdx, 15, 30)
    && band(currentRv, .3, .6)
    && extension < 0
    && currentVix >= 17.5
    && currentAdx < 25
    && extension > -.35;
  return bullSr01 || bullSr02LowAdx || weakeningSr02Vix || weakeningSr02Tail || bullSr02HighAdx || bullSr02MidVix;
}

export function isQqqP4E59MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E58MergedCurrentBarReject(row) && !isQqqP4E59RecoveryCurrentBar(row);
}

export async function buildQqqP4E59DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E59MergedCurrentBarReject });
}

/** Canonical sequential P4.E60 recovery candidate: six merged E59 residual branches. */
export function isQqqP4E60RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);

  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 14, 19)
    && currentVix >= 17.25
    && currentAdx < 20
    && band(currentRv, .4, .6)
    && extension < 1
    && extension >= 0;
  const bullSr02LowAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 15, 25)
    && band(currentRv, .2, .4)
    && extension < 1
    && currentVix >= 15;
  const weakeningSr02Vix = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentVix >= 19
    && currentAdx >= 25
    && band(currentRv, .3, .6)
    && extension < 0
    && currentVix >= 20.5;
  const weakeningSr02Tail = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 16, 19)
    && band(currentAdx, 10, 20)
    && band(currentRv, .4, .6)
    && extension < 0
    && currentVix >= 18
    && extension < -1.5;
  const bullSr02HighAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 14, 17)
    && band(currentAdx, 30, 40)
    && band(currentRv, .3, .45)
    && band(extension, .5, 2)
    && currentVix >= 14.3;
  const bullSr02MidVix = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 17, 20)
    && band(currentAdx, 15, 30)
    && band(currentRv, .3, .6)
    && extension < 0
    && currentVix >= 17.5
    && currentAdx < 25
    && extension > -.35;
  return bullSr01 || bullSr02LowAdx || weakeningSr02Vix || weakeningSr02Tail || bullSr02HighAdx || bullSr02MidVix;
}

export function isQqqP4E60MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E59MergedCurrentBarReject(row) && !isQqqP4E60RecoveryCurrentBar(row);
}

export async function buildQqqP4E60DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E60MergedCurrentBarReject });
}

/** Canonical P4.E61 recovery candidate: the simplest safe E59 residual box. */
export function isQqqP4E61RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  return row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 10
    && currentAdx < 30
    && extension >= 1
    && extension < 1.5;
}

export function isQqqP4E61MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E59MergedCurrentBarReject(row) && !isQqqP4E61RecoveryCurrentBar(row);
}

export async function buildQqqP4E61DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E61MergedCurrentBarReject });
}

/** Canonical P4.E62 recovery candidate: two safe, merged E61 residual clusters. */
export function isQqqP4E62RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NaN);
  const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 15
    && currentAdx < 25
    && currentRv < .5;
  const sidewaysSr01 = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && currentRv >= .7
    && currentRv < .8
    && extension < 2;
  return weakeningSr02 || sidewaysSr01;
}

export function isQqqP4E62MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E61MergedCurrentBarReject(row) && !isQqqP4E62RecoveryCurrentBar(row);
}

export async function buildQqqP4E62DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E62MergedCurrentBarReject });
}

/** Canonical P4.E63 recovery candidate: simplified weakening residual boundary. */
export function isQqqP4E63RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const extension = finite(row.market.priceExtensionAtr, Number.NaN);
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && extension >= -2.3
    && extension < -1.5;
}

export function isQqqP4E63MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E62MergedCurrentBarReject(row) && !isQqqP4E63RecoveryCurrentBar(row);
}

export async function buildQqqP4E63DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E63MergedCurrentBarReject });
}

/** Canonical P4.E64 repair: retain both E63 winners and exclude its audited low-ADX loss. */
export function isQqqP4E64RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NaN);
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 11
    && currentRv >= .3
    && extension < -1.5;
}

export function isQqqP4E64MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E62MergedCurrentBarReject(row) && !isQqqP4E64RecoveryCurrentBar(row);
}

export async function buildQqqP4E64DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E64MergedCurrentBarReject });
}

/** Canonical P4.E65 recovery: four minimal, independently validated residual guards. */
export function isQqqP4E65RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = finite(row.market.vix, Number.NaN);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const extension = finite(row.market.priceExtensionAtr, Number.NaN);
  const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && currentRv >= .4
    && extension >= -1
    && extension < -.5;
  const bullSr01 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && currentRv >= .4
    && extension >= -.5
    && extension < 0;
  const bullSr02 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 10
    && currentAdx < 15
    && extension >= .5;
  const sidewaysSr01 = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && currentVix >= 30
    && extension >= 2;
  return weakeningSr01 || bullSr01 || bullSr02 || sidewaysSr01;
}

export function isQqqP4E65MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E63MergedCurrentBarReject(row) && !isQqqP4E65RecoveryCurrentBar(row);
}

export async function buildQqqP4E65DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E65MergedCurrentBarReject });
}

/** Canonical P4.E66 recovery: simplified orthogonal momentum/RSI pocket. */
export function isQqqP4E66RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRoc20 = finite(row.market.roc20, Number.NaN);
  const currentRsi14 = finite(row.market.rsi14, Number.NaN);
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentRoc20 >= .05
    && currentRsi14 < 70;
}

export function isQqqP4E66MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E65MergedCurrentBarReject(row) && !isQqqP4E66RecoveryCurrentBar(row);
}

export async function buildQqqP4E66DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, { additionalReject: isQqqP4E66MergedCurrentBarReject });
}

/**
 * Canonical P4.E67 recovery: merge the two validated current-bar recovery
 * pockets into one momentum rule, then retain the separate low-RV/lower-price
 * pocket. Both branches are evaluated from the current replay row only.
 */
export function isQqqP4E67RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRsi14 = finite(row.market.rsi14, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentRv20 = rv(row);
  const selectedLower = lower(row);

  const bullMomentum = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentExtension >= -1
    && currentExtension < -.5
    && (currentRsi14 >= 50 || currentRoc5 >= 0);
  const extendedRvLower = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentRv20 >= .3
    && currentRv20 < .4
    && selectedLower >= .45;
  return bullMomentum || extendedRvLower;
}

export function isQqqP4E67MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E66MergedCurrentBarReject(row) && !isQqqP4E67RecoveryCurrentBar(row);
}

export async function buildQqqP4E67DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E67MergedCurrentBarReject,
    additionalAdmission: isQqqP4E67RecoveryCurrentBar,
  });
}

/** Canonical P4.E68 recovery: a minimal weakening/SR02 pocket after E67. */
export function isQqqP4E68RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const selectedLower = lower(row);
  return row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 18
    && selectedLower >= .4
    && selectedLower < .45
    && currentExtension < -.3;
}

export function isQqqP4E68MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E67MergedCurrentBarReject(row) && !isQqqP4E68RecoveryCurrentBar(row);
}

export async function buildQqqP4E68DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E68MergedCurrentBarReject,
    additionalAdmission: isQqqP4E68RecoveryCurrentBar,
  });
}

/** Canonical P4.E69 recovery: high-ADX, low-RV trend pocket with RSI protection. */
export function isQqqP4E69RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRsi14 = finite(row.market.rsi14, Number.NaN);
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 40
    && currentRv20 < .4
    && currentExtension >= 1.5
    && currentRsi14 < 70;
}

export function isQqqP4E69MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E69RecoveryCurrentBar(row);
}

export async function buildQqqP4E69DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E69MergedCurrentBarReject,
    additionalAdmission: isQqqP4E69RecoveryCurrentBar,
  });
}

/** Canonical P4.E70 recovery: relax E69 RSI only with a positive ROC5 guard. */
export function isQqqP4E70RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRsi14 = finite(row.market.rsi14, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  return row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 40
    && currentRv20 < .4
    && currentExtension >= 1.5
    && currentRsi14 < 72
    && currentRoc5 >= .0035;
}

export function isQqqP4E70MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E70RecoveryCurrentBar(row);
}

export async function buildQqqP4E70DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E70MergedCurrentBarReject,
    additionalAdmission: isQqqP4E70RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E72 recovery: retain E70's trend branch and add only the
 * four-snapshot-safe higher-RSI / stronger-ROC5 continuation pocket.
 * The two clauses are kept in one current-bar predicate so the E70→E72
 * union does not become a separate historical or date-driven layer.
 */
export function isQqqP4E72RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRsi14 = finite(row.market.rsi14, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const trendPocket = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentAdx >= 40
    && currentRv20 < .4
    && currentExtension >= 1.5;
  return trendPocket && (
    (currentRsi14 < 72 && currentRoc5 >= .0035)
    || (currentRsi14 < 80 && currentRoc5 >= .03)
  );
}

export function isQqqP4E72MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E72RecoveryCurrentBar(row);
}

export async function buildQqqP4E72DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E72MergedCurrentBarReject,
    additionalAdmission: isQqqP4E72RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E83 recovery: a minimal BULL/SR02 raw-pool release. It keeps
 * E72's continuation pocket and adds one structural current-bar predicate;
 * no selected-contract lower/credit or retrospective outcome feature is used.
 */
export function isQqqP4E83RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const bullSr02Pocket = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 16
    && currentAdx >= 20
    && currentAdx < 25
    && currentRv20 < .5
    && currentExtension >= -.5
    && currentExtension < .5
    && currentRoc5 >= .015;
  return isQqqP4E72RecoveryCurrentBar(row) || bullSr02Pocket;
}

export function isQqqP4E83MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E83RecoveryCurrentBar(row);
}

export async function buildQqqP4E83DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E83MergedCurrentBarReject,
    additionalAdmission: isQqqP4E83RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E85 recovery: merge the E83 BULL pocket with its positive-
 * extension continuation. Positive extension needs only non-negative ROC5;
 * negative extension retains the stricter ROC5 floor. This is one segmented
 * current-bar predicate, not a date or outcome-based exception list.
 */
export function isQqqP4E85RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const bullContinuation = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 16
    && currentAdx >= 20
    && currentAdx < 25
    && currentRv20 < .5
    && currentExtension >= -.5
    && currentExtension < .5
    && ((currentExtension >= 0 && currentRoc5 >= 0) || (currentExtension < 0 && currentRoc5 >= .015));
  return isQqqP4E72RecoveryCurrentBar(row) || bullContinuation;
}

export function isQqqP4E85MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E85RecoveryCurrentBar(row);
}

export async function buildQqqP4E85DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E85MergedCurrentBarReject,
    additionalAdmission: isQqqP4E85RecoveryCurrentBar,
  });
}

/** Canonical P4.E87 recovery: merge E85's ADX expansion directly into E72. */
export function isQqqP4E87RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv20 = rv(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const expandedBullContinuation = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 16
    && currentAdx >= 20
    && currentAdx < 30
    && currentRv20 < .5
    && currentExtension >= -.5
    && currentExtension < .5
    && ((currentExtension >= 0 && currentRoc5 >= 0) || (currentExtension < 0 && currentRoc5 >= .015));
  // The ADX<30 branch subsumes E85's ADX<25 branch, so keep only the E72
  // parent plus this single expanded predicate in the canonical builder.
  return isQqqP4E72RecoveryCurrentBar(row) || expandedBullContinuation;
}

export function isQqqP4E87MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E87RecoveryCurrentBar(row);
}

export async function buildQqqP4E87DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E87MergedCurrentBarReject,
    additionalAdmission: isQqqP4E87RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E96 capacity branch: keep the validated E87 recovery and add
 * one merged BULL current-bar window. The broad branch intentionally removes
 * extension and subregime fragmentation; ROC5 is the single continuation
 * quality floor.
 */
export function isQqqP4E96RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const broadBull = row.market.regime === 'BULL'
    && (row.market.slowSubregime === 'CURRENT' || row.market.slowSubregime === 'SR01' || row.market.slowSubregime === 'SR02')
    && vix(row) < 16
    && adx(row) >= 20
    && adx(row) < 35
    && rv(row) < .67
    && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .01;
  return isQqqP4E87RecoveryCurrentBar(row) || broadBull;
}

export function isQqqP4E96MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E96RecoveryCurrentBar(row);
}

export async function buildQqqP4E96DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E96MergedCurrentBarReject,
    additionalAdmission: isQqqP4E96RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E101 quality-preserving capacity branch. It keeps E87's
 * validated recovery and adds one narrower SR02/RV60 continuation window.
 */
export function isQqqP4E101RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const qualityBullSr02 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && vix(row) < 16
    && adx(row) >= 20
    && adx(row) < 30
    && rv(row) < .6
    && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015;
  return isQqqP4E87RecoveryCurrentBar(row) || qualityBullSr02;
}

export function isQqqP4E101MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E101RecoveryCurrentBar(row);
}

export async function buildQqqP4E101DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E101MergedCurrentBarReject,
    additionalAdmission: isQqqP4E101RecoveryCurrentBar,
  });
}

/**
 * Canonical P4.E102 capacity branch: merge BULL slow-subregimes and RV<.67
 * under the same ROC5 quality floor, while retaining E87 recovery.
 */
export function isQqqP4E102RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const broadQualityBull = row.market.regime === 'BULL'
    && (row.market.slowSubregime === 'CURRENT' || row.market.slowSubregime === 'SR01' || row.market.slowSubregime === 'SR02')
    && vix(row) < 16
    && adx(row) >= 20
    && adx(row) < 30
    && rv(row) < .67
    && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015;
  return isQqqP4E87RecoveryCurrentBar(row) || broadQualityBull;
}

export function isQqqP4E102MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E102RecoveryCurrentBar(row);
}

export async function buildQqqP4E102DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E102MergedCurrentBarReject,
    additionalAdmission: isQqqP4E102RecoveryCurrentBar,
  });
}

/** Canonical P4.E103 capacity branch: lower only the BULL quality-window ADX floor. */
export function isQqqP4E103RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const broadQualityBull = row.market.regime === 'BULL'
    && ['CURRENT', 'SR01', 'SR02'].includes(row.market.slowSubregime ?? '')
    && vix(row) < 16
    && adx(row) >= 18
    && adx(row) < 30
    && rv(row) < .67
    && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015;
  return isQqqP4E102RecoveryCurrentBar(row) || broadQualityBull;
}

export function isQqqP4E103MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E103RecoveryCurrentBar(row);
}

export async function buildQqqP4E103DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E103MergedCurrentBarReject,
    additionalAdmission: isQqqP4E103RecoveryCurrentBar,
  });
}

/** Canonical P4.E104 capacity branch: extend the ADX floor and add a quality-gated high-ADX band. */
export function isQqqP4E104RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const broadQualityBull = row.market.regime === 'BULL'
    && ['CURRENT', 'SR01', 'SR02'].includes(row.market.slowSubregime ?? '')
    && vix(row) < 16
    && rv(row) < .67
    && ((adx(row) >= 17 && adx(row) < 30 && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .015)
      || (adx(row) >= 30 && adx(row) < 35 && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .02));
  return isQqqP4E103RecoveryCurrentBar(row) || broadQualityBull;
}

export function isQqqP4E104MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E104RecoveryCurrentBar(row);
}

export async function buildQqqP4E104DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E104MergedCurrentBarReject,
    additionalAdmission: isQqqP4E104RecoveryCurrentBar,
  });
}

/** Canonical P4.E109 recovery: consolidate six validated residual cells into three regime branches. */
export function isQqqP4E109RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const currentRoc = finite(row.market.roc5, Number.NEGATIVE_INFINITY);
  const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02'
    && ((band(currentVix, 12, 14) && band(currentRv, .5, .6))
      || (band(currentAdx, 20, 25) && band(currentRoc, .02, .03)));
  const rangeBound = row.market.regime === 'RANGE_BOUND'
    && ((row.market.slowSubregime === 'SR01' && band(currentAdx, 18, 20))
      || (row.market.slowSubregime === 'SR02' && band(currentVix, 12, 14) && currentRv < .3));
  const bullSr02 = row.market.regime === 'BULL' && row.market.slowSubregime === 'SR02'
    && ((currentVix < 12 && currentRv < .3)
      || (band(currentAdx, 30, 35) && band(currentRv, .4, .5)));
  return isQqqP4E104RecoveryCurrentBar(row) || extendedSr02 || rangeBound || bullSr02;
}

export function isQqqP4E109MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E109RecoveryCurrentBar(row);
}

export async function buildQqqP4E109DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E109MergedCurrentBarReject,
    additionalAdmission: isQqqP4E109RecoveryCurrentBar,
  });
}

/** Canonical P4.E112 refinement: extend only the validated EXT/SR02 VIX boundary to 15. */
export function isQqqP4E112RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const extVixRvExtension = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 12, 15)
    && band(rv(row), .5, .6);
  return isQqqP4E109RecoveryCurrentBar(row) || extVixRvExtension;
}

export function isQqqP4E112MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E112RecoveryCurrentBar(row);
}

export async function buildQqqP4E112DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E112MergedCurrentBarReject,
    additionalAdmission: isQqqP4E112RecoveryCurrentBar,
  });
}

/** Canonical P4.E114 refinement: merge three clean adjacent boundary slices. */
export function isQqqP4E114RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const extendedAdxSlice = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 25, 30)
    && band(finite(row.market.roc5, Number.NEGATIVE_INFINITY), .02, .03);
  const rangeSr01Slice = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(adx(row), 17, 18);
  const rangeSr02Slice = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 14, 15)
    && rv(row) < .3;
  return isQqqP4E112RecoveryCurrentBar(row) || extendedAdxSlice || rangeSr01Slice || rangeSr02Slice;
}

export function isQqqP4E114MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E114RecoveryCurrentBar(row);
}

export async function buildQqqP4E114DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E114MergedCurrentBarReject,
    additionalAdmission: isQqqP4E114RecoveryCurrentBar,
  });
}

/** Canonical P4.E116 refinement: add the validated residual regime families as current-bar branches. */
export function isQqqP4E116RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentAdx = adx(row);
  const currentRv = rv(row);
  const bullLowAdx = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentAdx < 16
    && currentRv < .3;
  const rangeSr02LowRv = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 12, 16)
    && currentRv < .3;
  const weakeningVix = row.market.regime === 'RISK_ON_WEAKENING'
    && band(currentVix, 12, 14);
  const rangeSr01ModerateRv = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 14, 16)
    && band(currentRv, .4, .5);
  const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && currentAdx < 12
    && band(currentRv, .4, .5);
  const extendedSr01 = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR01'
    && currentVix < 12;
  const bullModerateRv = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 12
    && band(currentRv, .4, .5);
  return isQqqP4E114RecoveryCurrentBar(row)
    || bullLowAdx
    || rangeSr02LowRv
    || weakeningVix
    || rangeSr01ModerateRv
    || weakeningSr02
    || extendedSr01
    || bullModerateRv;
}

export function isQqqP4E116MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E116RecoveryCurrentBar(row);
}

export async function buildQqqP4E116DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E116MergedCurrentBarReject,
    additionalAdmission: isQqqP4E116RecoveryCurrentBar,
  });
}

/** Canonical P4.E120 refinement: add three clean state-quality families from the E116 residual pool. */
export function isQqqP4E120RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentVix = vix(row);
  const currentRv = rv(row);
  const currentRsi = finite(row.market.rsi14, Number.NEGATIVE_INFINITY);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const bullLowRv = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 12
    && band(currentRv, .3, .4)
    && band(currentRsi, 60, 65);
  const extendedSr01 = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR01'
    && currentExtension >= 3
    && band(currentRv, .3, .4);
  const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(currentRv, .8, 1);
  return isQqqP4E116RecoveryCurrentBar(row) || bullLowRv || extendedSr01 || weakeningSr01;
}

export function isQqqP4E120MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E120RecoveryCurrentBar(row);
}

export async function buildQqqP4E120DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E120MergedCurrentBarReject,
    additionalAdmission: isQqqP4E120RecoveryCurrentBar,
  });
}

/** Canonical P4.E124 refinement: add the openDate-safe WEAKENING path-quality family. */
export function isQqqP4E124RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const weakeningPath = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(rv(row), .67, .8)
    && band(lower(row), .45, .49)
    && sigma(row) === 2.5;
  return isQqqP4E120RecoveryCurrentBar(row) || weakeningPath;
}

export function isQqqP4E124MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E124RecoveryCurrentBar(row);
}

export async function buildQqqP4E124DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E124MergedCurrentBarReject,
    additionalAdmission: isQqqP4E124RecoveryCurrentBar,
  });
}

/** Canonical P4.E127 refinement: add the large SIDEWAYS/SR01 RV recovery family with a current-bar crash guard. */
export function isQqqP4E127RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const sidewaysRvRecovery = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(rv(row), .5, .6)
    && !(adx(row) < 20 && finite(row.market.roc5, Number.POSITIVE_INFINITY) <= -.04);
  return isQqqP4E124RecoveryCurrentBar(row) || sidewaysRvRecovery;
}

export function isQqqP4E127MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E127RecoveryCurrentBar(row);
}

export async function buildQqqP4E127DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E127MergedCurrentBarReject,
    additionalAdmission: isQqqP4E127RecoveryCurrentBar,
  });
}

/** Canonical P4.E129 refinement: merge the validated high-RV SIDEWAYS pockets and positive RANGE continuation. */
export function isQqqP4E129RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const sidewaysHighRv = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && ((band(currentRv, .6, .67) && band(currentAdx, 20, 25))
      || (band(currentRv, .67, .8) && band(currentAdx, 12, 16))
      || (currentRv >= 1 && band(currentAdx, 12, 16)));
  const rangePositiveContinuation = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentRv, .6, .67)
    && band(currentRoc5, .02, .05);
  return isQqqP4E127RecoveryCurrentBar(row) || sidewaysHighRv || rangePositiveContinuation;
}

export function isQqqP4E129MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E129RecoveryCurrentBar(row);
}

export async function buildQqqP4E129DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E129MergedCurrentBarReject,
    additionalAdmission: isQqqP4E129RecoveryCurrentBar,
  });
}

/** Canonical P4.E133 refinement: add the guarded EXTENDED/SR02 positive-continuation pocket. */
export function isQqqP4E133RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const extendedPositive = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(rv(row), .3, .4)
    && band(adx(row), 20, 25)
    && finite(row.market.roc5, Number.NEGATIVE_INFINITY) >= .01;
  return isQqqP4E129RecoveryCurrentBar(row) || extendedPositive;
}

export function isQqqP4E133MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E133RecoveryCurrentBar(row);
}

export async function buildQqqP4E133DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E133MergedCurrentBarReject,
    additionalAdmission: isQqqP4E133RecoveryCurrentBar,
  });
}

/** Canonical P4.E137 refinement: add the validated BULL/CURRENT previous-state transition. */
export function isQqqP4E137RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
  const bullCurrentTransition = previous?.regime === 'BULL' && previous.slowSubregime === 'CURRENT';
  return isQqqP4E133RecoveryCurrentBar(row) || bullCurrentTransition;
}

export function isQqqP4E137MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E137RecoveryCurrentBar(row);
}

export async function buildQqqP4E137DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E137MergedCurrentBarReject,
    additionalAdmission: isQqqP4E137RecoveryCurrentBar,
  });
}

/** Canonical P4.E139 refinement: merge two validated current-bar transition recovery families. */
export function isQqqP4E139RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
  const previousState = `${previous?.regime ?? 'NA'}/${previous?.slowSubregime ?? 'NA'}`;
  const currentState = `${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`;
  const weakeningToBull = previousState === 'RISK_ON_WEAKENING/SR01'
    && currentState === 'BULL/SR01'
    && band(rv(row), .6, .67);
  const extendedToBull = previousState === 'RISK_ON_EXTENDED/SR02'
    && currentState === 'BULL/SR02'
    && band(rv(row), .3, .4)
    && band(lower(row), .35, .4)
    && sigma(row) === 2.5;
  return isQqqP4E137RecoveryCurrentBar(row) || weakeningToBull || extendedToBull;
}

export function isQqqP4E139MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E139RecoveryCurrentBar(row);
}

export async function buildQqqP4E139DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E139MergedCurrentBarReject,
    additionalAdmission: isQqqP4E139RecoveryCurrentBar,
  });
}

/** Canonical P4.E152 refinement: merge four validated no-replacement current-bar quality pockets. */
export function isQqqP4E152RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentVix = vix(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentLower = lower(row);
  const selectedSigma = sigma(row);
  const weakeningSr02 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 20, 25)
    && band(currentLower, .45, .49)
    && selectedSigma === 2.5;
  const sr01SmaQuality = row.market.slowSubregime === 'SR01'
    && band(currentSma, .05, .1)
    && ((row.market.regime === 'RANGE_BOUND' && band(currentRv, .5, .6))
      || (row.market.regime === 'RISK_ON_EXTENDED' && currentRv < .3));
  const bullSr02Sma = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentRv, .4, .5)
    && band(currentSma, 0, .05);
  return isQqqP4E139RecoveryCurrentBar(row) || weakeningSr02 || sr01SmaQuality || bullSr02Sma;
}

export function isQqqP4E152MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E152RecoveryCurrentBar(row);
}

export async function buildQqqP4E152DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E152MergedCurrentBarReject,
    additionalAdmission: isQqqP4E152RecoveryCurrentBar,
  });
}

/** Canonical P4.E153 refinement: merge five protected-seam residual quality cells. */
export function isQqqP4E153RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentVix = vix(row);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentLower = lower(row);
  const selectedSigma = sigma(row);
  const extendedSr02 = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(currentRv, .4, .5)
    && band(currentRoc5, 0, .01);
  const weakeningSr01 = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(currentVix, 20, 25)
    && band(currentLower, .4, .45)
    && selectedSigma === 2.5;
  const sidewaysQuality = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && ((band(currentVix, 25, 30) && currentLower >= .49 && selectedSigma === 2.5)
      || (band(currentRv, .3, .4) && currentExtension < 0));
  const rangeQuality = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentVix, 12, 14)
    && band(currentLower, .3, .35)
    && selectedSigma === 2.5;
  return isQqqP4E152RecoveryCurrentBar(row) || extendedSr02 || weakeningSr01 || sidewaysQuality || rangeQuality;
}

export function isQqqP4E153MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve the complete E152 protection seam while adding E153 cells.
  // Using E68 directly here would silently release an E152-vetoed bar and
  // changes the parent's settled-state path.
  return isQqqP4E152MergedCurrentBarReject(row);
}

export async function buildQqqP4E153DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E153MergedCurrentBarReject,
    additionalAdmission: isQqqP4E153RecoveryCurrentBar,
  });
}

/** Canonical P4.E155 refinement: merge the two loss-free BULL/SR01 residual cells. */
export function isQqqP4E155RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentLower = lower(row);
  const selectedSigma = sigma(row);
  const bullSr01Quality = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && ((band(currentRv, .8, 1) && band(currentSma, .1, .2))
      || (band(currentAdx, 25, 30) && band(currentLower, .45, .49) && selectedSigma === 2.5));
  return isQqqP4E153RecoveryCurrentBar(row) || bullSr01Quality;
}

export function isQqqP4E155MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E153's parent reject seam; the two E155 cells are only releases.
  return isQqqP4E153MergedCurrentBarReject(row);
}

export async function buildQqqP4E155DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E155MergedCurrentBarReject,
    additionalAdmission: isQqqP4E155RecoveryCurrentBar,
  });
}

/** Canonical P4.E160 refinement: salvage the large EXTENDED low-VIX pocket with one SMA/RV guard. */
export function isQqqP4E160RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentVix = vix(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentLower = lower(row);
  const selectedSigma = sigma(row);
  const extendedLowVixQuality = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentVix < 12
    && band(currentLower, .3, .35)
    && selectedSigma === 2.5
    && !(currentSma >= .13 && currentRv >= .28);
  return isQqqP4E155RecoveryCurrentBar(row) || extendedLowVixQuality;
}

export function isQqqP4E160MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E155's parent protection seam while releasing the guarded pocket.
  return isQqqP4E155MergedCurrentBarReject(row);
}

export async function buildQqqP4E160DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E160MergedCurrentBarReject,
    additionalAdmission: isQqqP4E160RecoveryCurrentBar,
  });
}

/** Canonical P4.E164 refinement: add the lower-safe EXTENDED low-RV/ADX pocket. */
export function isQqqP4E164RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const currentLower = lower(row);
  const extendedLowRv = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && currentRv < .3
    && band(currentAdx, 20, 25)
    && currentLower < .4;
  return isQqqP4E160RecoveryCurrentBar(row) || extendedLowRv;
}

export function isQqqP4E164MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E160's complete parent protection seam.
  return isQqqP4E160MergedCurrentBarReject(row);
}

export async function buildQqqP4E164DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E164MergedCurrentBarReject,
    additionalAdmission: isQqqP4E164RecoveryCurrentBar,
  });
}

/** Canonical P4.E170 refinement: recover a broad BULL/SR02 pocket while excluding trend-impulse mismatch. */
export function isQqqP4E170RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const currentAdx = adx(row);
  const currentRoc5 = finite(row.market.roc5, Number.POSITIVE_INFINITY);
  const currentLower = lower(row);
  const broadBullSr02 = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentExtension, 0, 1.5)
    && band(currentLower, .35, .39)
    && sigma(row) === 2.5;
  const trendImpulseMismatch = currentAdx >= 30 && currentRoc5 < -.005 && currentExtension >= .5;
  return isQqqP4E164RecoveryCurrentBar(row) || (broadBullSr02 && !trendImpulseMismatch);
}

export function isQqqP4E170MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E164's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E164MergedCurrentBarReject(row);
}

export async function buildQqqP4E170DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E170MergedCurrentBarReject,
    additionalAdmission: isQqqP4E170RecoveryCurrentBar,
  });
}

/** Canonical P4.E173 refinement: salvage a RANGE/SR02 medium-RV pocket with one extension floor. */
export function isQqqP4E173RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const rangeMediumRv = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentRv, .3, .4)
    && band(currentSma, 0, .05)
    && currentExtension >= -1.5;
  return isQqqP4E170RecoveryCurrentBar(row) || rangeMediumRv;
}

export function isQqqP4E173MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E170's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E170MergedCurrentBarReject(row);
}

export async function buildQqqP4E173DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E173MergedCurrentBarReject,
    additionalAdmission: isQqqP4E173RecoveryCurrentBar,
  });
}

/** Canonical P4.E176 refinement: add a high-RV SIDEWAYS/SR01 pocket with compact quality limits. */
export function isQqqP4E176RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const currentVix = vix(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY);
  const sidewaysHighRvQuality = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && currentRv >= 1
    && band(currentAdx, 40, 60)
    && currentVix < 30
    && currentExtension < 1.4;
  return isQqqP4E173RecoveryCurrentBar(row) || sidewaysHighRvQuality;
}

export function isQqqP4E176MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E173's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E173MergedCurrentBarReject(row);
}

export async function buildQqqP4E176DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E176MergedCurrentBarReject,
    additionalAdmission: isQqqP4E176RecoveryCurrentBar,
  });
}

/** Canonical P4.E180 refinement: salvage the BULL/SR02 medium-RV pocket below an impulse-overheat state. */
export function isQqqP4E180RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentAdx = adx(row);
  const currentRoc5 = finite(row.market.roc5, Number.POSITIVE_INFINITY);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY);
  const bullMediumRvQuality = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentRv, .3, .4)
    && band(currentSma, 0, .05)
    && !(currentAdx >= 30 && currentRoc5 > .01 && currentExtension >= 1);
  return isQqqP4E176RecoveryCurrentBar(row) || bullMediumRvQuality;
}

export function isQqqP4E180MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E176's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E176MergedCurrentBarReject(row);
}

export async function buildQqqP4E180DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E180MergedCurrentBarReject,
    additionalAdmission: isQqqP4E180RecoveryCurrentBar,
  });
}

/** Canonical P4.E183 refinement: add a low-VIX EXTENDED/SR01 residual pocket. */
export function isQqqP4E183RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRv = rv(row);
  const currentSma = finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY);
  const currentVix = vix(row);
  const extendedSr01Quality = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR01'
    && band(currentRv, .4, .5)
    && band(currentSma, .05, .1)
    && currentVix < 15;
  return isQqqP4E180RecoveryCurrentBar(row) || extendedSr01Quality;
}

export function isQqqP4E183MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E180's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E180MergedCurrentBarReject(row);
}

export async function buildQqqP4E183DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E183MergedCurrentBarReject,
    additionalAdmission: isQqqP4E183RecoveryCurrentBar,
  });
}

/** Canonical P4.E186 refinement: recover a recent RANGE/SR02 positive-extension pocket below VIX 15.4. */
export function isQqqP4E186RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentLower = lower(row);
  const currentVix = vix(row);
  const rangePositiveQuality = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentExtension, 0, 1)
    && band(currentLower, .35, .4)
    && sigma(row) === 2
    && currentVix < 15.4;
  return isQqqP4E183RecoveryCurrentBar(row) || rangePositiveQuality;
}

export function isQqqP4E186MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E183's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E183MergedCurrentBarReject(row);
}

export async function buildQqqP4E186DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E186MergedCurrentBarReject,
    additionalAdmission: isQqqP4E186RecoveryCurrentBar,
  });
}

/** Canonical P4.E191 refinement: add a guarded SIDEWAYS/SR01 negative-ROC pocket. */
export function isQqqP4E191RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentLower = lower(row);
  const sidewaysNegativeRoc = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(currentRoc5, -.02, 0)
    && currentExtension < 1.5
    && (currentExtension < .5 || currentLower >= .35);
  return isQqqP4E186RecoveryCurrentBar(row) || sidewaysNegativeRoc;
}

export function isQqqP4E191MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E186's complete parent protection seam while releasing the guarded pocket.
  return isQqqP4E186MergedCurrentBarReject(row);
}

export async function buildQqqP4E191DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E191MergedCurrentBarReject,
    additionalAdmission: isQqqP4E191RecoveryCurrentBar,
  });
}

/** Canonical P4.E196 refinement: merge three low-tail residual transition pockets. */
export function isQqqP4E196RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentState = `${row.market.regime ?? 'NA'}/${row.market.slowSubregime ?? 'NA'}`;
  const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
  const previousState = `${previous?.regime ?? 'NA'}/${previous?.slowSubregime ?? 'NA'}`;
  const currentVix = vix(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const sidewaysHighVix = currentState === 'SIDEWAYS/SR01'
    && band(currentVix, 26, 30);
  const bullContinuation = previousState === 'BULL/SR02'
    && currentState === 'BULL/SR02'
    && band(currentExtension, 2, 3);
  const rangeLowRvContinuation = previousState === 'RANGE_BOUND/SR02'
    && currentState === 'RANGE_BOUND/SR02'
    && band(rv(row), 0, .3)
    && currentExtension >= -1.3;
  return isQqqP4E191RecoveryCurrentBar(row) || sidewaysHighVix || bullContinuation || rangeLowRvContinuation;
}

export function isQqqP4E196MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E191's complete parent protection seam while releasing the guarded union.
  return isQqqP4E191MergedCurrentBarReject(row);
}

export async function buildQqqP4E196DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E196MergedCurrentBarReject,
    additionalAdmission: isQqqP4E196RecoveryCurrentBar,
  });
}

/** Canonical P4.E199 refinement: add the guarded RANGE/SR02 lower/sigma corridors. */
export function isQqqP4E199RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentLower = lower(row);
  const selectedSigma = sigma(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const rangeLowerSigma = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentLower, .3, .35)
    && band(selectedSigma ?? Number.NaN, 2, 3)
    && (currentExtension <= -.05 || band(currentExtension, .1, 1.2));
  return isQqqP4E196RecoveryCurrentBar(row) || rangeLowerSigma;
}

export function isQqqP4E199MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E196's complete parent protection seam while releasing the guarded RANGE corridors.
  return isQqqP4E196MergedCurrentBarReject(row);
}

export async function buildQqqP4E199DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E199MergedCurrentBarReject,
    additionalAdmission: isQqqP4E199RecoveryCurrentBar,
  });
}

/** Canonical P4.E202 refinement: add a guarded EXTENDED/SR02 ADX pocket. */
export function isQqqP4E202RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const extendedAdxPocket = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 16, 20);
  const lowRvHighSmaRisk = rv(row) < .31
    && finite(row.market.priceVsSma200Pct, Number.NEGATIVE_INFINITY) >= .11;
  return isQqqP4E199RecoveryCurrentBar(row) || (extendedAdxPocket && !lowRvHighSmaRisk);
}

export function isQqqP4E202MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  // Preserve E199's complete parent protection seam while releasing the guarded ADX pocket.
  return isQqqP4E199MergedCurrentBarReject(row);
}

export async function buildQqqP4E202DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E202MergedCurrentBarReject,
    additionalAdmission: isQqqP4E202RecoveryCurrentBar,
  });
}

/** Canonical P4.E205 refinement: widen SIDEWAYS/SR02 low-ADX coverage with one quality OR guard. */
export function isQqqP4E205RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const sidewaysLowAdx = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR02'
    && adx(row) < 20
    && (rv(row) < .7 || finite(row.market.priceExtensionAtr, Number.POSITIVE_INFINITY) < 0 || vix(row) >= 33);
  return isQqqP4E202RecoveryCurrentBar(row) || sidewaysLowAdx;
}

export function isQqqP4E205MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E202MergedCurrentBarReject(row);
}

export async function buildQqqP4E205DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E205MergedCurrentBarReject,
    additionalAdmission: isQqqP4E205RecoveryCurrentBar,
  });
}

/** Canonical P4.E208 refinement: merge three zero-loss residual pockets. */
export function isQqqP4E208RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const weakeningRangePocket = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR02'
    && band(lower(row), .4, .45)
    && sigma(row) === 2.5;
  const bullHighAdxPocket = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 40, 60);
  const weakeningLowAdxPocket = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(adx(row), 12, 16);
  return isQqqP4E205RecoveryCurrentBar(row) || weakeningRangePocket || bullHighAdxPocket || weakeningLowAdxPocket;
}

export function isQqqP4E208MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E205MergedCurrentBarReject(row);
}

export async function buildQqqP4E208DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E208MergedCurrentBarReject,
    additionalAdmission: isQqqP4E208RecoveryCurrentBar,
  });
}

/** Canonical P4.E211 refinement: add the compact BULL/CURRENT positive-extension pocket. */
export function isQqqP4E211RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const bullCurrentExtension = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'CURRENT'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 0, .5);
  return isQqqP4E208RecoveryCurrentBar(row) || bullCurrentExtension;
}

export function isQqqP4E211MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E208MergedCurrentBarReject(row);
}

export async function buildQqqP4E211DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E211MergedCurrentBarReject,
    additionalAdmission: isQqqP4E211RecoveryCurrentBar,
  });
}

/** Canonical P4.E213 refinement: add the bounded BULL/SR01 extension pocket. */
export function isQqqP4E213RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const bullSr01Extension = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR01'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 1.5, 2);
  return isQqqP4E211RecoveryCurrentBar(row) || bullSr01Extension;
}

export function isQqqP4E213MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E211MergedCurrentBarReject(row);
}

export async function buildQqqP4E213DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E213MergedCurrentBarReject,
    additionalAdmission: isQqqP4E213RecoveryCurrentBar,
  });
}

/** Canonical P4.E216 refinement: add the bounded RANGE/SR02 ADX-extension pocket. */
export function isQqqP4E216RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const rangeAdxExtension = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 12, 16)
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 1, 1.5);
  return isQqqP4E213RecoveryCurrentBar(row) || rangeAdxExtension;
}

export function isQqqP4E216MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E213MergedCurrentBarReject(row);
}

export async function buildQqqP4E216DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E216MergedCurrentBarReject,
    additionalAdmission: isQqqP4E216RecoveryCurrentBar,
  });
}

/** Canonical P4.E217 refinement: add the compact RANGE/SR02 RV-extension pocket. */
export function isQqqP4E217RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const rangeRvExtension = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(rv(row), .4, .5)
    && band(finite(row.market.priceExtensionAtr, Number.NaN), -1.5, -1);
  return isQqqP4E216RecoveryCurrentBar(row) || rangeRvExtension;
}

export function isQqqP4E217MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E216MergedCurrentBarReject(row);
}

export async function buildQqqP4E217DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E217MergedCurrentBarReject,
    additionalAdmission: isQqqP4E217RecoveryCurrentBar,
  });
}

/** Canonical P4.E218 refinement: add the bounded BULL/SR02 contract-extension pocket. */
export function isQqqP4E218RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const bullContractExtension = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(lower(row), .3, .35)
    && sigma(row) === 1.5
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 1.5, 2);
  return isQqqP4E217RecoveryCurrentBar(row) || bullContractExtension;
}

export function isQqqP4E218MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E217MergedCurrentBarReject(row);
}

export async function buildQqqP4E218DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E218MergedCurrentBarReject,
    additionalAdmission: isQqqP4E218RecoveryCurrentBar,
  });
}

/** Canonical P4.E221 refinement: merge two broader current-bar quality corridors. */
export function isQqqP4E221RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const sidewaysQuality = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), -1, 0)
    && band(rv(row), 0, .8)
    && (band(finite(row.market.roc5, Number.NaN), 0, .01) || band(rv(row), .67, .8));
  const rangeQuality = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 16, 20)
    && band(rv(row), .5, .67);
  return isQqqP4E218RecoveryCurrentBar(row) || sidewaysQuality || rangeQuality;
}

export function isQqqP4E221MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E218MergedCurrentBarReject(row);
}

export async function buildQqqP4E221DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E221MergedCurrentBarReject,
    additionalAdmission: isQqqP4E221RecoveryCurrentBar,
  });
}

/** Canonical P4.E223 refinement: add the clean RANGE/SR01 low-RV negative-extension pocket. */
export function isQqqP4E223RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const rangeSr01Clean = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR01'
    && band(rv(row), .3, .4)
    && finite(row.market.priceExtensionAtr, Number.NEGATIVE_INFINITY) < -1.5;
  return isQqqP4E221RecoveryCurrentBar(row) || rangeSr01Clean;
}

export function isQqqP4E223MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E221MergedCurrentBarReject(row);
}

export async function buildQqqP4E223DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E223MergedCurrentBarReject,
    additionalAdmission: isQqqP4E223RecoveryCurrentBar,
  });
}

/** Canonical P4.E225 refinement: merge three clean residual current-bar pockets. */
export function isQqqP4E225RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentLower = lower(row);
  const currentSigma = sigma(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const bullWideLower = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentLower, .45, .49)
    && currentSigma === 2.5
    && band(currentExtension, 0, .5);
  const weakeningAdxExtension = row.market.regime === 'RISK_ON_WEAKENING'
    && row.market.slowSubregime === 'SR01'
    && band(adx(row), 16, 20)
    && band(currentExtension, -1.5, -1);
  const bullMediumLower = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentLower, .4, .45)
    && currentSigma === 2.5
    && band(currentExtension, 1.5, 2);
  return isQqqP4E223RecoveryCurrentBar(row) || bullWideLower || weakeningAdxExtension || bullMediumLower;
}

export function isQqqP4E225MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E223MergedCurrentBarReject(row);
}

export async function buildQqqP4E225DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E225MergedCurrentBarReject,
    additionalAdmission: isQqqP4E225RecoveryCurrentBar,
  });
}

/** Canonical P4.E227 refinement: merge two additional clean contract corridors. */
export function isQqqP4E227RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const currentLower = lower(row);
  const currentSigma = sigma(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const extendedContract = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(currentLower, .3, .35)
    && currentSigma === 1.5
    && band(currentExtension, 2, 3);
  const bullLowSigma = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentLower, .3, .35)
    && currentSigma === 2
    && band(currentExtension, 0, .5);
  return isQqqP4E225RecoveryCurrentBar(row) || extendedContract || bullLowSigma;
}

export function isQqqP4E227MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E225MergedCurrentBarReject(row);
}

export async function buildQqqP4E227DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E227MergedCurrentBarReject,
    additionalAdmission: isQqqP4E227RecoveryCurrentBar,
  });
}

/** Canonical P4.E230 refinement: recover two clean same-state transition pockets. */
export function isQqqP4E230RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
  const sameState = (regime: string, slowSubregime: string) => previous?.regime === regime
    && previous?.slowSubregime === slowSubregime
    && row.market.regime === regime
    && row.market.slowSubregime === slowSubregime;
  const currentLower = lower(row);
  const currentSigma = sigma(row);
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const bullContractTransition = sameState('BULL', 'SR02')
    && band(currentLower, .3, .35)
    && currentSigma === 1.5
    && band(currentExtension, 1, 1.5);
  const rangeContractTransition = sameState('RANGE_BOUND', 'SR02')
    && band(currentLower, .35, .4)
    && currentSigma === 2
    && band(currentExtension, -1, 0);
  return isQqqP4E227RecoveryCurrentBar(row) || bullContractTransition || rangeContractTransition;
}

export function isQqqP4E230MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E227MergedCurrentBarReject(row);
}

export async function buildQqqP4E230DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E230MergedCurrentBarReject,
    additionalAdmission: isQqqP4E230RecoveryCurrentBar,
  });
}

/** Canonical P4.E233 refinement: merge four clean stable-state quality corridors. */
export function isQqqP4E233RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  if (stableRun < 3) return isQqqP4E230RecoveryCurrentBar(row);

  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentAdx = adx(row);
  const sideways = row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(currentExtension, -1, 0)
    && (band(currentRoc5, 0, .05) || band(currentAdx, 40, 60));
  const range = row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(currentExtension, 1.5, 2)
    && band(currentRoc5, 0, .01);
  const bull = row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentExtension, 1, 1.5)
    && band(currentRoc5, .02, .05);
  return isQqqP4E230RecoveryCurrentBar(row) || sideways || range || bull;
}

export function isQqqP4E233MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E230MergedCurrentBarReject(row);
}

export async function buildQqqP4E233DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E233MergedCurrentBarReject,
    additionalAdmission: isQqqP4E233RecoveryCurrentBar,
  });
}

/** Canonical P4.E236 refinement: add three deeper, zero-loss stable-state corridors. */
export function isQqqP4E236RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const bullDeep = stableRun >= 4
    && row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentAdx, 30, 40)
    && band(currentRv, .4, .5);
  const sidewaysDeep = stableRun >= 4
    && row.market.regime === 'SIDEWAYS'
    && row.market.slowSubregime === 'SR01'
    && band(currentAdx, 30, 40)
    && band(currentExtension, -1.5, -1);
  const rangeDeep = stableRun >= 4
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(lower(row), .45, .49)
    && sigma(row) === 2.5
    && band(currentExtension, 0, .5);
  return isQqqP4E233RecoveryCurrentBar(row) || bullDeep || sidewaysDeep || rangeDeep;
}

export function isQqqP4E236MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E233MergedCurrentBarReject(row);
}

export async function buildQqqP4E236DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E236MergedCurrentBarReject,
    additionalAdmission: isQqqP4E236RecoveryCurrentBar,
  });
}

/** Canonical P4.E238 refinement: merge four long-stable quality pockets, with BULL branches consolidated. */
export function isQqqP4E238RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentRv = rv(row);
  const currentAdx = adx(row);
  const bull = stableRun >= 5
    && row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentExtension, .5, 1)
    && (band(currentRoc5, -.02, 0)
      || (band(lower(row), .4, .45) && sigma(row) === 2.5));
  const range = stableRun >= 5
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(lower(row), .4, .45)
    && sigma(row) === 2
    && band(currentRv, .5, .67);
  const extended = stableRun >= 5
    && row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(currentAdx, 25, 30)
    && band(currentRv, .4, .5);
  return isQqqP4E236RecoveryCurrentBar(row) || bull || range || extended;
}

export function isQqqP4E238MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E236MergedCurrentBarReject(row);
}

export async function buildQqqP4E238DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E238MergedCurrentBarReject,
    additionalAdmission: isQqqP4E238RecoveryCurrentBar,
  });
}

/** Canonical P4.E241 refinement: merge three clean residual pockets into BULL and RANGE quality families. */
export function isQqqP4E241RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const currentExtension = finite(row.market.priceExtensionAtr, Number.NaN);
  const currentRoc5 = finite(row.market.roc5, Number.NaN);
  const currentRv = rv(row);
  const bull = stableRun >= 5
    && row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(currentRoc5, -.02, 0)
    && band(currentExtension, -1, 0);
  const range = stableRun >= 5
    && row.market.regime === 'RANGE_BOUND'
    && ((row.market.slowSubregime === 'SR02'
      && band(lower(row), .35, .4)
      && sigma(row) === 2.5
      && band(currentRv, .3, .4))
      || (row.market.slowSubregime === 'SR01'
        && currentAdxBelow(row, 12)
        && vix(row) < 15));
  return isQqqP4E238RecoveryCurrentBar(row) || bull || range;
}

function currentAdxBelow(row: QqqP4DynamicRow, ceiling: number): boolean {
  return adx(row) < ceiling;
}

export function isQqqP4E241MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E238MergedCurrentBarReject(row);
}

export async function buildQqqP4E241DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E241MergedCurrentBarReject,
    additionalAdmission: isQqqP4E241RecoveryCurrentBar,
  });
}

/** Canonical P4.E245 refinement: merge the clean stable EXTENDED quality surface onto E241. */
export function isQqqP4E245RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const extended = row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 2, 3)
    && ((stableRun >= 5 && band(adx(row), 40, 60))
      || (stableRun >= 3 && band(finite(row.market.roc5, Number.NaN), .01, .02) && rv(row) >= .38));
  return isQqqP4E241RecoveryCurrentBar(row) || extended;
}

export function isQqqP4E245MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E241MergedCurrentBarReject(row);
}

export async function buildQqqP4E245DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E245MergedCurrentBarReject,
    additionalAdmission: isQqqP4E245RecoveryCurrentBar,
  });
}

/** Canonical P4.E248 refinement: add the stable low-RV/low-VIX EXTENDED coverage pocket. */
export function isQqqP4E248RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const lowVolExtended = stableRun >= 5
    && row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && rv(row) < .3
    && vix(row) < 12;
  return isQqqP4E245RecoveryCurrentBar(row) || lowVolExtended;
}

export function isQqqP4E248MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E245MergedCurrentBarReject(row);
}

export async function buildQqqP4E248DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E248MergedCurrentBarReject,
    additionalAdmission: isQqqP4E248RecoveryCurrentBar,
  });
}

/** Canonical P4.E252 refinement: add the narrow stable RANGE ADX/ROC corridor. */
export function isQqqP4E252RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const rangePocket = stableRun >= 5
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 10, 12)
    && band(finite(row.market.roc5, Number.NaN), -.02, 0);
  return isQqqP4E248RecoveryCurrentBar(row) || rangePocket;
}

export function isQqqP4E252MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E248MergedCurrentBarReject(row);
}

export async function buildQqqP4E252DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E252MergedCurrentBarReject,
    additionalAdmission: isQqqP4E252RecoveryCurrentBar,
  });
}

/** Canonical P4.E255 refinement: add the guarded stable EXTENDED contract-quality corridor. */
export function isQqqP4E255RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const extendedPocket = stableRun >= 7
    && row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(lower(row), .3, .35)
    && sigma(row) === 2.5
    && band(rv(row), .25, .3);
  return isQqqP4E252RecoveryCurrentBar(row) || extendedPocket;
}

export function isQqqP4E255MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E252MergedCurrentBarReject(row);
}

export async function buildQqqP4E255DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E255MergedCurrentBarReject,
    additionalAdmission: isQqqP4E255RecoveryCurrentBar,
  });
}

/** Canonical P4.E270 refinement: merge one trend pocket with one quality-gated RANGE family. */
export function isQqqP4E270RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const selectedLower = lower(row);
  const selectedSigma = sigma(row);
  const extendedTrend = stableRun >= 7
    && row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(adx(row), 30, 40)
    && band(finite(row.market.roc20, Number.NaN), .02, .05)
    && selectedSigma === 2.5;
  const rangeQuality = finite(row.market.rsi14, Number.NEGATIVE_INFINITY) >= 60
    || finite(row.market.weakeningSignalCount, Number.NEGATIVE_INFINITY) >= 1;
  const rangeRecovery = stableRun >= 3
    && stableRun < 10
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 12, 15)
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 1, 1.5)
    && band(selectedLower, .3, .42)
    && (selectedSigma === 2 || selectedSigma === 2.5)
    && rangeQuality;
  return isQqqP4E255RecoveryCurrentBar(row) || extendedTrend || rangeRecovery;
}

export function isQqqP4E270MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E255MergedCurrentBarReject(row);
}

export async function buildQqqP4E270DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E270MergedCurrentBarReject,
    additionalAdmission: isQqqP4E270RecoveryCurrentBar,
  });
}

/** Canonical P4.E278 refinement: merge two independently validated zero-loss SR02 quality families. */
export function isQqqP4E278RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const rangeContinuation = stableRun >= 5
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(vix(row), 12, 15)
    && band(finite(row.market.roc5, Number.NaN), 0, .01);
  const bullMediumLowRv = stableRun >= 3
    && row.market.regime === 'BULL'
    && row.market.slowSubregime === 'SR02'
    && band(rv(row), .38, .4);
  return isQqqP4E270RecoveryCurrentBar(row) || rangeContinuation || bullMediumLowRv;
}

export function isQqqP4E278MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E270MergedCurrentBarReject(row);
}

export async function buildQqqP4E278DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E278MergedCurrentBarReject,
    additionalAdmission: isQqqP4E278RecoveryCurrentBar,
  });
}

/** Canonical P4.E283 refinement: repair three broad-coverage path boundaries as one quality surface. */
export function isQqqP4E283RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  let stableRun = 0;
  for (let index = row.history.length - 1; index >= 0; index -= 1) {
    const state = row.history[index];
    if (state.regime !== row.market.regime || state.slowSubregime !== row.market.slowSubregime) break;
    stableRun += 1;
  }
  const extendedLowRv = stableRun < 7
    && row.market.regime === 'RISK_ON_EXTENDED'
    && row.market.slowSubregime === 'SR02'
    && band(rv(row), 0, .25)
    && !band(adx(row), 29, 30);
  const rangeShortSigma15 = stableRun < 3
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), 1.5, 2)
    && sigma(row) === 1.5;
  const rangeStableExtension = stableRun >= 7
    && row.market.regime === 'RANGE_BOUND'
    && row.market.slowSubregime === 'SR02'
    && band(finite(row.market.priceExtensionAtr, Number.NaN), -1, -.2);
  return isQqqP4E278RecoveryCurrentBar(row) || extendedLowRv || rangeShortSigma15 || rangeStableExtension;
}

export function isQqqP4E283MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E278MergedCurrentBarReject(row);
}

export async function buildQqqP4E283DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E283MergedCurrentBarReject,
    additionalAdmission: isQqqP4E283RecoveryCurrentBar,
  });
}

/** Canonical P4.E286 refinement: merge two zero-loss residual quality surfaces. */
export function isQqqP4E286RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const label = `${row.market.regime}/${row.market.slowSubregime}`;
  const rangeSr01 = label === 'RANGE_BOUND/SR01'
    && band(vix(row), 15, 17)
    && band(finite(row.market.rsi14, Number.NaN), 35, 45);
  const extendedSr02 = label === 'RISK_ON_EXTENDED/SR02'
    && band(rv(row), .3, .38)
    && band(adx(row), 12, 16);
  return isQqqP4E283RecoveryCurrentBar(row) || rangeSr01 || extendedSr02;
}

export function isQqqP4E286MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E283MergedCurrentBarReject(row);
}

export async function buildQqqP4E286DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E286MergedCurrentBarReject,
    additionalAdmission: isQqqP4E286RecoveryCurrentBar,
  });
}

/** Canonical P4.E290 refinement: merge three additional residual zero-loss cells. */
export function isQqqP4E290RecoveryCurrentBar(row: QqqP4DynamicRow): boolean {
  const label = `${row.market.regime}/${row.market.slowSubregime}`;
  const currentLower = lower(row);
  const currentRv = rv(row);
  const bullLowerRv = label === 'BULL/SR02'
    && band(currentLower, .42, .45)
    && band(currentRv, .3, .38);
  const bullLowRv = label === 'BULL/SR02'
    && band(currentRv, .25, .3);
  const rangeRsi = label === 'RANGE_BOUND/SR02'
    && band(vix(row), 17, 20)
    && band(finite(row.market.rsi14, Number.NaN), 55, 60);
  return isQqqP4E286RecoveryCurrentBar(row) || bullLowerRv || bullLowRv || rangeRsi;
}

export function isQqqP4E290MergedCurrentBarReject(row: QqqP4DynamicRow): boolean {
  return isQqqP4E286MergedCurrentBarReject(row);
}

export async function buildQqqP4E290DynamicReplayWithData(startDate: string, endDate: string, data: MarketDataSet): Promise<QqqP4DynamicReplay> {
  return buildQqqP4DynamicReplayWithData(startDate, endDate, data, {
    additionalReject: isQqqP4E290MergedCurrentBarReject,
    additionalAdmission: isQqqP4E290RecoveryCurrentBar,
  });
}
