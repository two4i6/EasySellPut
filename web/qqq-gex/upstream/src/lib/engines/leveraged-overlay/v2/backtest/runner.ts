import type { BacktestResult, BacktestTraceEntry, OptionCycleDebug, TradeEntry } from '../../backtest/types';
import type { StrategyParams } from '../../types/params';
import type { MarketDataSet } from './fixtures';
import {loadRunData} from './load-run-data';
export {loadRunData};
import { createMarketPrecompute, executeResolvedBacktest } from './execution-adapter';
import { resolveRunSpec, type BacktestBatchRunSpec, type BacktestRunSpec, type ResolvedBacktestRunSpec } from './run-spec';
import { OVERLAY_PRODUCTION_DEFAULTS } from './production-defaults';
import { getOverlayUniverse } from '../../universe';
import { d1RecoveryBoostDates } from './experiments/d1-recovery-binding-aware';
import { buildCanonicalOptionSignalTape, CANONICAL_OPTION_SIGNAL_ANCHOR, type CanonicalOptionSignalTape } from './canonical-option-signal-tape';
import { resolveSampleWindow } from './sample-window';

export type V2BacktestResult = BacktestResult & { resolvedSpec: ResolvedBacktestRunSpec; dataFingerprint: string };
export type V2BatchBacktestResult = { mode: 'batch'; results: V2BacktestResult[]; dataFingerprint: string };

type RunnerExecutionContext = Parameters<typeof executeResolvedBacktest>[2] & {
  canonicalOptionSignalTapeCache?: Map<string, CanonicalOptionSignalTape>;
  onCanonicalOptionSignalTapeGenerated?: (cacheKey: string) => void;
  skipHistoricalCandidateAResearch?: boolean;
  researchCandidateAContract?: { targetDte?: number; widthPct?: number };
};

const MAX_CANONICAL_TAPE_CACHE_ENTRIES = 8;
const processCanonicalTapeCache = new Map<string, CanonicalOptionSignalTape>();

type CandidateAResearchRow = {
  cycle: OptionCycleDebug;
  signalDate: string;
  market: BacktestTraceEntry['marketState'];
  gate?: NonNullable<NonNullable<BacktestTraceEntry['overlay']>['pcsGateDiagnostics']>;
  firstBlock: 'safety' | 'reactive' | 'v121' | 'v123' | 'other';
};

function candidateAResearchDay(value: string | undefined): string {
  return (value ?? '').slice(0, 10);
}

function candidateAResearchRows(result: V2BacktestResult, traceByDate: Map<string, BacktestTraceEntry>): CandidateAResearchRow[] {
  const openByDate = new Map<TradeEntry, string>();
  for (const open of result.tradeLog.filter((trade) => trade.action === 'OPEN' && trade.strategyTag === 'QQQ_PUT_CREDIT_SPREAD')) {
    openByDate.set(open, candidateAResearchDay(open.date));
  }
  const signalByOpenDate = new Map<string, TradeEntry>();
  for (const open of openByDate.keys()) signalByOpenDate.set(openByDate.get(open)!, open);
  return (result.debug?.optionCycles ?? [])
    .filter((cycle) => cycle.kind === 'PCS' && Number.isFinite(cycle.pnl))
    .map((cycle) => {
      const open = signalByOpenDate.get(candidateAResearchDay(cycle.openDate));
      const signalDate = candidateAResearchDay(open?.signalDate);
      const entry = traceByDate.get(signalDate);
      const gate = entry?.overlay?.pcsGateDiagnostics;
      let firstBlock: CandidateAResearchRow['firstBlock'] = 'other';
      if (!gate?.safetyPassed) firstBlock = 'safety';
      else if (gate.reactiveTimingPassed === false) firstBlock = 'reactive';
      else if (gate.v121StateBlocked || gate.variantBlockers?.some((reason) => reason.includes('V1.2.1'))) firstBlock = 'v121';
      else if ((gate.v123BlockedBy?.length ?? 0) > 0 || gate.variantBlockers?.some((reason) => reason.includes('V1.2.3'))) firstBlock = 'v123';
      return { cycle, signalDate, market: entry?.marketState ?? ({} as BacktestTraceEntry['marketState']), gate, firstBlock };
    });
}

/** v1.2.7b/P0：Candidate A 保守组合 + 动态 BACKWARDATED_TERM rescue。 */
export function runCandidateAResearchWithData(
  resolvedSpec: ResolvedBacktestRunSpec,
  data: MarketDataSet,
  productionDefaults: Partial<StrategyParams>,
  execution: RunnerExecutionContext,
): V2BacktestResult {
  type ResearchStrategyOverrides = ResolvedBacktestRunSpec['strategyOverrides'];
  // Candidate A derives its admissible signal set from an unfiltered reference
  // replay.  Preserve an explicitly supplied research blocklist and apply it
  // only to the final replay; otherwise the internal computed blocklist would
  // silently replace it and an entry-gate experiment would be a no-op.
  const callerBlockedDates = resolvedSpec.config.pcsEntryBlockedDates ?? {};
  const researchConfig: ResolvedBacktestRunSpec['config'] = { ...resolvedSpec.config, pcsEntryBlockedDates: undefined };
  // Candidate-A keeps its historical 35-DTE/3.00% default.  Contract changes
  // are opt-in through an explicit research-only execution context so normal
  // callers and production-compatible replays remain byte-identical.
  const researchTargetDte = execution.researchCandidateAContract?.targetDte ?? 35;
  const researchWidthPct = execution.researchCandidateAContract?.widthPct ?? .03;
  const baseStrategyOverrides: ResearchStrategyOverrides = {
    ...resolvedSpec.strategyOverrides,
    enablePCS: true,
    enableEquityBoostPCS: false,
    pcsTargetDte: researchTargetDte,
    pcsSpreadWidthPct: researchWidthPct,
    pcsExcludeRiskOnWeakening: false,
    pcsBass221Gate: false,
    pcsV11Gate: false,
    pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20',
    pcsV12Gate: false,
    pcsV121Gate: true,
    pcsV122Gate: false,
    pcsV123Gate: true,
    pcsV123B30ReleaseLower: .38,
    pcsBass232Candidate2Gate: false,
    pcsBass232Candidate3Gate: false,
    pcsResearchProfile: 'candidate3',
    pcsCandidate3ExtraRelease: 'bull_sr02_rv_adx',
    pcsRiskEnvelopeMode: undefined,
    pcsRiskEnvelopeProfile: undefined,
    pcsResearchSafetyOverride: undefined,
    pcsRescueEnabled: false,
  };
  const researchExecution = { ...execution, skipHistoricalCandidateAResearch: true };
  const runResearchArm = (strategyOverrides: ResearchStrategyOverrides, config: ResolvedBacktestRunSpec['config'] = researchConfig) => runWithData({ ...resolvedSpec, strategyOverrides, config }, data, productionDefaults, researchExecution);
  const exact = runResearchArm(baseStrategyOverrides);
  const traceByDate = new Map((exact.debug?.trace ?? []).map((entry) => [candidateAResearchDay(entry.date), entry] as const));
  const currentBlock = (market: BacktestTraceEntry['marketState']) => (
    market.regime === 'BULL' && market.slowSubregime === 'SR01' && (market.priceExtensionAtr ?? Number.NEGATIVE_INFINITY) >= 2 && (market.adx14 ?? Number.NEGATIVE_INFINITY) >= 29
  ) || (
    market.regime === 'BULL' && market.slowSubregime === 'SR02' && (market.vix ?? Number.NEGATIVE_INFINITY) >= 15 && (market.vix ?? Number.POSITIVE_INFINITY) < 18 && (market.adx14 ?? Number.NEGATIVE_INFINITY) >= 40
  ) || (
    market.regime === 'RISK_ON_WEAKENING' && market.slowSubregime === 'SR01' && (market.adx14 ?? Number.POSITIVE_INFINITY) < 12
  );
  const priceSmaBlock = (market: BacktestTraceEntry['marketState']) => market.regime === 'BULL'
    && market.slowSubregime === 'SR01'
    && (market.adx14 ?? Number.POSITIVE_INFINITY) < 18
    && (market.tqqqRealisedVol20d ?? Number.NEGATIVE_INFINITY) >= .60
    && (market.priceVsSma200Pct ?? Number.NEGATIVE_INFINITY) >= .10;
  const currentBlockedDates = Object.fromEntries((exact.debug?.trace ?? [])
    .filter((entry) => currentBlock(entry.marketState) || priceSmaBlock(entry.marketState))
    .map((entry) => [candidateAResearchDay(entry.date), true] as const));
  const current = runResearchArm({
    ...baseStrategyOverrides,
    pcsRiskEnvelopeMode: 'candidate4_v1',
    pcsRiskEnvelopeProfile: 'candidate4_full_only_v1',
    pcsResearchSafetyOverride: 'allow_backwardation_only',
  }, { ...researchConfig, pcsEntryBlockedDates: currentBlockedDates });
  const currentRows = candidateAResearchRows(current, traceByDate);
  const currentOpenDates = new Set(currentRows.map((row) => candidateAResearchDay(row.cycle.openDate)));
  const currentKeepSignalDates = new Set(currentRows.map((row) => row.signalDate));
  const pool = runResearchArm({
    ...baseStrategyOverrides,
    pcsV121Gate: false,
    pcsV123Gate: false,
    pcsResearchTimingOverride: 'allow',
    pcsRiskEnvelopeMode: 'candidate4_v1',
    pcsRiskEnvelopeProfile: 'candidate4_full_only_v1',
    pcsResearchSafetyOverride: 'allow_backwardation_only',
  });
  const poolRows = candidateAResearchRows(pool, traceByDate).filter((row) => !currentOpenDates.has(candidateAResearchDay(row.cycle.openDate)) && (row.firstBlock === 'reactive' || row.firstBlock === 'v121' || row.firstBlock === 'v123'));
  const isCandidateAState = (row: CandidateAResearchRow) => {
    const vix = row.market.vix ?? Number.NaN;
    const adx14 = row.market.adx14 ?? Number.NaN;
    return (row.market.regime === 'SIDEWAYS' && (adx14 < 12 || (vix > 30 && adx14 >= 20 && adx14 < 30) || (vix >= 28 && vix <= 30 && adx14 >= 12 && adx14 < 20)))
      || (row.market.regime === 'BULL' && row.market.slowSubregime === 'SR01' && vix < 12 && adx14 < 12)
      || ((row.market.regime === 'BULL' || row.market.regime === 'RISK_ON_WEAKENING') && vix < 12 && adx14 >= 30)
      || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && vix >= 12 && vix < 14 && adx14 >= 12 && adx14 < 20);
  };
  const extension = poolRows.filter((row) => !currentKeepSignalDates.has(row.signalDate) && !currentBlock(row.market) && !priceSmaBlock(row.market) && isCandidateAState(row));
  const candidateABackwardationSignalDates = new Set((exact.debug?.trace ?? [])
    .filter((entry) => {
      const blockers = entry.overlay?.pcsGateDiagnostics?.safetyBlockers ?? [];
      return blockers.length === 1 && blockers[0] === 'BACKWARDATED_TERM';
    })
    .filter((entry) => isCandidateAState({ market: entry.marketState } as CandidateAResearchRow))
    .map((entry) => candidateAResearchDay(entry.date)));
  const allowedSignalDates = new Set([
    ...currentKeepSignalDates,
    ...extension.map((row) => row.signalDate),
    ...candidateABackwardationSignalDates,
  ]);
  const blockedDates = Object.fromEntries((exact.debug?.trace ?? [])
    .filter((entry) => !allowedSignalDates.has(candidateAResearchDay(entry.date)))
    .map((entry) => [candidateAResearchDay(entry.date), true] as const));
  return runResearchArm({
    ...baseStrategyOverrides,
    pcsV121Gate: false,
    pcsV123Gate: false,
    pcsResearchTimingOverride: 'allow',
    pcsResearchProfile: 'candidateAResearch',
    pcsRiskEnvelopeMode: 'candidate4_v1',
    pcsRiskEnvelopeProfile: 'candidate4_full_only_v1',
    pcsResearchSafetyOverride: 'allow_backwardation_only',
  }, { ...researchConfig, pcsEntryBlockedDates: { ...callerBlockedDates, ...blockedDates } });
}

function canonicalTapeCacheKey(spec: ResolvedBacktestRunSpec, dataFingerprint: string): string {
  return JSON.stringify({ dataFingerprint, spec });
}

function readCanonicalTape(cacheKey: string, localCache?: Map<string, CanonicalOptionSignalTape>): CanonicalOptionSignalTape | undefined {
  const local = localCache?.get(cacheKey);
  if (local) return local;
  const cached = processCanonicalTapeCache.get(cacheKey);
  if (!cached) return undefined;
  processCanonicalTapeCache.delete(cacheKey);
  processCanonicalTapeCache.set(cacheKey, cached);
  return cached;
}

function writeCanonicalTape(cacheKey: string, tape: CanonicalOptionSignalTape, localCache?: Map<string, CanonicalOptionSignalTape>): void {
  localCache?.set(cacheKey, tape);
  processCanonicalTapeCache.delete(cacheKey);
  processCanonicalTapeCache.set(cacheKey, tape);
  while (processCanonicalTapeCache.size > MAX_CANONICAL_TAPE_CACHE_ENTRIES) {
    const oldest = processCanonicalTapeCache.keys().next().value;
    if (oldest === undefined) break;
    processCanonicalTapeCache.delete(oldest);
  }
}


export function runWithData(
  spec: BacktestRunSpec | ResolvedBacktestRunSpec,
  data: MarketDataSet,
  productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS,
  execution: RunnerExecutionContext = {},
): V2BacktestResult {
  const resolvedSpec = resolveSampleWindow(resolveRunSpec(spec, productionDefaults), data);
  if ((resolvedSpec.strategyOverrides.pcsResearchProfile === 'candidateAResearch'
    || resolvedSpec.strategyOverrides.pcsResearchProfile === 'candidateARescue')
    && !execution.skipHistoricalCandidateAResearch) {
    return runCandidateAResearchWithData(resolvedSpec, data, productionDefaults, execution);
  }
  const {
    pcsContractProfile: _pcsContractProfile,
    pcsSurvivalPriceSelectionMode: _pcsSurvivalPriceSelectionMode,
    pcsSurvivalSelectionFloor: _pcsSurvivalSelectionFloor,
    pcsSurvivalSelectionStressFloor: _pcsSurvivalSelectionStressFloor,
    pcsSurvivalSelectionObjective: _pcsSurvivalSelectionObjective,
    pcsSurvivalSelectionObjectiveRegime: _pcsSurvivalSelectionObjectiveRegime,
    pcsSurvivalSelectionObjectiveSlowSubregime: _pcsSurvivalSelectionObjectiveSlowSubregime,
    pcsSurvivalSelectionObjectiveAdxMin: _pcsSurvivalSelectionObjectiveAdxMin,
    pcsSurvivalSelectionObjectiveRv20Min: _pcsSurvivalSelectionObjectiveRv20Min,
    pcsSurvivalSelectionSurvivalWeight: _pcsSurvivalSelectionSurvivalWeight,
    pcsSurvivalSelectionWilsonWeight: _pcsSurvivalSelectionWilsonWeight,
    pcsSurvivalSelectionMaxConditionalLossRatio: _pcsSurvivalSelectionMaxConditionalLossRatio,
    pcsSurvivalSelectionStressTailVetoRatio: _pcsSurvivalSelectionStressTailVetoRatio,
    pcsSurvivalSelectionStressTailVetoRegime: _pcsSurvivalSelectionStressTailVetoRegime,
    pcsSurvivalSelectionStressTailVetoSlowSubregime: _pcsSurvivalSelectionStressTailVetoSlowSubregime,
    pcsSurvivalSelectionStressTailVetoRv20Max: _pcsSurvivalSelectionStressTailVetoRv20Max,
    pcsSurvivalSelectionTailWidthTriggerRatio: _pcsSurvivalSelectionTailWidthTriggerRatio,
    pcsSurvivalSelectionStressWeight: _pcsSurvivalSelectionStressWeight,
    pcsSurvivalSelectionDteMode: _pcsSurvivalSelectionDteMode,
    pcsSurvivalSelectionWidthMode: _pcsSurvivalSelectionWidthMode,
    pcsSurvivalSelectionWidthBlend: _pcsSurvivalSelectionWidthBlend,
    pcsSurvivalSelectionWidthConfirmDays: _pcsSurvivalSelectionWidthConfirmDays,
    pcsSurvivalSelectionWidthSwitchMargin: _pcsSurvivalSelectionWidthSwitchMargin,
    pcsSurvivalSelectionWidthDeltaPnlFloor: _pcsSurvivalSelectionWidthDeltaPnlFloor,
    pcsSurvivalSelectionWidthTailImprovementMargin: _pcsSurvivalSelectionWidthTailImprovementMargin,
    pcsSurvivalSelectionCreditRetentionFloor: _pcsSurvivalSelectionCreditRetentionFloor,
    pcsSurvivalSelectionSigmaMode: _pcsSurvivalSelectionSigmaMode,
    pcsProbabilityReferenceExitMode: _pcsProbabilityReferenceExitMode,
    pcsSurvivalExitMode: _pcsSurvivalExitMode,
    pcsSurvivalFloor: _pcsSurvivalFloor,
    pcsSurvivalDrop: _pcsSurvivalDrop,
    pcsSurvivalTouchConfirmation: _pcsSurvivalTouchConfirmation,
    pcsSurvivalTouchBufferPct: _pcsSurvivalTouchBufferPct,
    pcsSurvivalTouchVixThreshold: _pcsSurvivalTouchVixThreshold,
    pcsDeltaStopEnabled: _pcsDeltaStopEnabled,
    pcsDeltaStopThreshold: _pcsDeltaStopThreshold,
    pcsProfitTakeEnabled: _pcsProfitTakeEnabled,
    pcsProfitTarget: _pcsProfitTarget,
    pcsPressureSizingMode: _pcsPressureSizingMode,
    pcsPressureSizingMediumMultiplier: _pcsPressureSizingMediumMultiplier,
    pcsPressureSizingStressedMultiplier: _pcsPressureSizingStressedMultiplier,
    ...canonicalStrategyOverrides
  } = resolvedSpec.strategyOverrides;
  // V1.2.1/V1.2.3/V1.2.4/V1.2.5 的释放条件必须在选腿后执行；共享信号带只负责保留完整的
  // V1.1 入口，不能在生成 canonical tape 时提前应用选腿后闸门。
  const shareCanonicalTape = resolvedSpec.scenarioOptions?.canonicalOptionSignalTapeShared === true;
  const canonicalTapeStrategyOverrides = canonicalStrategyOverrides.pcsV121Gate === true || canonicalStrategyOverrides.pcsV123Gate === true || resolvedSpec.config.canonicalPcsCandidate2Gate !== undefined
    ? {
      ...canonicalStrategyOverrides,
      ...(shareCanonicalTape ? { equityBoostDynamicDteMinHighRiskDays: undefined } : {}),
      pcsV121Gate: false,
      pcsV123Gate: false,
      ...(resolvedSpec.config.canonicalPcsCandidate2Gate !== undefined
        ? { pcsBass232Candidate2Gate: resolvedSpec.config.canonicalPcsCandidate2Gate }
        : {}),
    }
    : shareCanonicalTape
      ? { ...canonicalStrategyOverrides, equityBoostDynamicDteMinHighRiskDays: undefined }
      : canonicalStrategyOverrides;
  const existingTape = resolvedSpec.config.canonicalOptionSignalTape;
  const tape = existingTape ?? (resolvedSpec.scenarioOptions?.canonicalOptionSignalTapeMode === 'skip' ? undefined : (() => {
    const canonicalSpec = resolveRunSpec({
      ...resolvedSpec,
      preset: 'neutral',
      config: {
        ...resolvedSpec.config,
        initialCapital: 100_000,
        startDate: resolvedSpec.scenarioOptions?.canonicalOptionSignalStartDate ?? CANONICAL_OPTION_SIGNAL_ANCHOR,
        endDate: resolvedSpec.config.endDate,
        trace: true,
        optionsBacktestPositionMode: { cs: 'independent', ic: 'independent', eb: 'independent', pcs: 'independent', bearCs: 'independent' },
        canonicalOptionSignalTape: undefined,
        canonicalOptionSignalDataFingerprint: undefined,
      },
      // Contract profiles select legs only; eligibility must come from one shared frozen signal tape.
      strategyOverrides: canonicalTapeStrategyOverrides,
    }, productionDefaults);
    const cacheKey = canonicalTapeCacheKey(canonicalSpec, data.fingerprint);
    const cached = readCanonicalTape(cacheKey, execution.canonicalOptionSignalTapeCache);
    if (cached) return cached;
    // A dynamic entry profile belongs to the executable replay, not to the
    // shared canonical eligibility tape. Including it here makes the first
    // dynamic run poison the process tape cache with an already-admitted
    // subset, so later runs silently depend on call order. Canonical tape
    // generation must stay independent of caller-owned admission state.
    const canonicalExecution = { ...execution, pcsDynamicEntryProfile: undefined };
    const generated = buildCanonicalOptionSignalTape(executeResolvedBacktest(canonicalSpec, data, canonicalExecution), data.fingerprint);
    writeCanonicalTape(cacheKey, generated, execution.canonicalOptionSignalTapeCache);
    execution.onCanonicalOptionSignalTapeGenerated?.(cacheKey);
    return generated;
  })());
  const executableSpec: ResolvedBacktestRunSpec = {
    ...resolvedSpec,
    config: tape
      ? { ...resolvedSpec.config, canonicalOptionSignalTape: tape, canonicalOptionSignalDataFingerprint: data.fingerprint }
      : resolvedSpec.config,
  };
  const baseline = executeResolvedBacktest(executableSpec, data, execution);
  let result = baseline;
  if (resolvedSpec.scenarioOptions?.recoveryExperiment === 'd1-binding-aware') {
    let boostDates = d1RecoveryBoostDates(baseline, baseline, data);
    for (let iteration = 0; iteration < 5; iteration++) {
      result = executeResolvedBacktest({ ...executableSpec, config: { ...executableSpec.config, stockRecoveryBoostPctByDate: boostDates } }, data, execution);
      const next = d1RecoveryBoostDates(baseline, result, data);
      if (JSON.stringify(next) === JSON.stringify(boostDates)) break;
      if (iteration === 4) throw new Error('D1 Recovery replay did not converge');
      boostDates = next;
    }
  }
  return { ...result, resolvedSpec, dataFingerprint: data.fingerprint };
}

function batchCoordinate(spec: ResolvedBacktestRunSpec) {
  const { config } = spec;
  return JSON.stringify({ dataSource: spec.dataSource, universeId: spec.universeId, signalSymbol: spec.signalSymbol, historyAnchorStart: spec.historyAnchorStart, dataParams: spec.dataParams, startDate: config.startDate, endDate: config.endDate, timeframe: config.timeframe, minBarHistory: config.minBarHistory, includeTerminalMarkOnly: config.includeTerminalMarkOnly });
}

/** Market-derived resources shared by ordinary and composite replays on one snapshot. */
export function createBacktestSharedResourcesWithData(spec: ResolvedBacktestRunSpec, data: MarketDataSet) {
  return {
    marketPrecompute: createMarketPrecompute(spec, data),
    mockOptionChainCache: new Map<string, import('../../types/input').OptionChain>(),
    canonicalOptionSignalTapeCache: new Map<string, CanonicalOptionSignalTape>(),
  };
}

/** Shared execution boundary for CLI, API, research and batch runs on one immutable snapshot. */
export function createBacktestSessionWithData(
  base: BacktestRunSpec,
  data: MarketDataSet,
  productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS,
) {
  const resolvedSpec = resolveSampleWindow(resolveRunSpec(base, productionDefaults), data);
  const coordinate = batchCoordinate(resolvedSpec);
  const execution: RunnerExecutionContext = createBacktestSharedResourcesWithData(resolvedSpec, data);
  const runSpec = (spec: BacktestRunSpec): V2BacktestResult => {
    const resolved = resolveSampleWindow(resolveRunSpec(spec, productionDefaults), data);
    if (batchCoordinate(resolved) !== coordinate) throw new Error('回测会话中的方案必须使用相同的数据坐标');
    return runWithData(resolved, data, productionDefaults, execution);
  };
  const runArm = (strategyOverrides: Partial<StrategyParams> = {}): V2BacktestResult => runSpec({
    ...base,
    strategyOverrides: { ...base.strategyOverrides, ...strategyOverrides },
  });
  return { resolvedSpec, dataFingerprint: data.fingerprint, runSpec, runArm };
}

/** Batch 只共享市场只读派生物；每个 arm 仍创建独立账本、DecisionMemory 与仓位。 */
export function runBatchWithData(
  batch: BacktestBatchRunSpec,
  data: MarketDataSet,
  productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS,
): V2BatchBacktestResult {
  if (batch.arms.length < 1 || batch.arms.length > 4) throw new Error('batch arms 必须为 1 至 4 个');
  const specs = batch.arms.map(arm => resolveSampleWindow(resolveRunSpec({ ...arm, mode: 'single' }, productionDefaults), data));
  const coordinate = batchCoordinate(specs[0]!);
  if (specs.some(spec => batchCoordinate(spec) !== coordinate)) throw new Error('batch arms 必须使用相同的数据坐标');
  const session = createBacktestSessionWithData(batch.arms[0]!, data, productionDefaults);
  // 不缓存 arm 产生的宏观轨迹：爆仓会截断曲线，复用会污染下一条策略。
  const results = batch.arms.map(arm => session.runSpec(arm));
  return { mode: 'batch', results, dataFingerprint: data.fingerprint };
}

export async function runBatch(batch: BacktestBatchRunSpec, productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS): Promise<V2BatchBacktestResult> {
  if (batch.arms.length < 1 || batch.arms.length > 4) throw new Error('batch arms 必须为 1 至 4 个');
  const first = resolveRunSpec(batch.arms[0]!, productionDefaults);
  return runBatchWithData(batch, await loadRunData(first), productionDefaults);
}

export async function run(spec: BacktestRunSpec, productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS): Promise<V2BacktestResult> {
  const resolvedSpec = resolveRunSpec(spec, productionDefaults);
  return createBacktestSessionWithData(spec, await loadRunData(resolvedSpec), productionDefaults).runSpec(spec);
}
