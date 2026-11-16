import type { BacktestConfig, BacktestTimeframe } from '../../backtest/types';
import { STRATEGY_PRESETS, type MacroExecutionDriver, type StrategyParams, type StrategyPreset } from '../../types/params';
import { OVERLAY_PRODUCTION_DEFAULTS } from './production-defaults';
import { getOverlayUniverse, type OverlaySignalSymbol, type OverlayUniverseId } from '../../universe';

export type RegisteredFixtureId = 'market-2026-10-29-15y-vxn' | 'market-2026-10-23-15y-vxn' | 'market-2026-07-03' | 'market-2026-07-03-vxn' | 'market-2026-07-21-vxn' | 'market-2026-07-31-vxn' | 'market-2026-09-09-vxn';

export type BacktestDataParams = { sampleCount: number; asOfDate?: string };

export type BacktestRunSpec = {
  version: 1;
  mode?: 'single';
  preset: StrategyPreset;
  dataSource: { kind: 'live' } | { kind: 'fixture'; fixtureId: RegisteredFixtureId };
  /** Count executable signal bars backwards from the latest available bar (or asOfDate). */
  dataParams?: BacktestDataParams;
  /** 仅回测数据加载：固定评分历史起点，避免扩张统计随观察窗口漂移。 */
  historyAnchorStart?: string;
  /** Public contract. Omitted only for legacy internal specs; resolves to NASDAQ/TQQQ. */
  universeId?: OverlayUniverseId;
  signalSymbol?: OverlaySignalSymbol;
  config?: Partial<Omit<BacktestConfig, 'strategyParams'>>;
  strategyOverrides?: Partial<StrategyParams>;
  scenarioOptions?: {
    trace?: boolean;
    macroExecutionDriver?: MacroExecutionDriver;
    slowSubregimeDiagnostics?: boolean;
    /** 仅对已证明不需要冻结期权信号的独立回放跳过重复 canonical tape。 */
    canonicalOptionSignalTapeMode?: 'required' | 'skip';
    /** Data-relative warm-up start for canonical tape generation; never a date whitelist. */
    canonicalOptionSignalStartDate?: string;
    /** Internal composite optimization: share the execution-independent EB7 canonical tape. */
    canonicalOptionSignalTapeShared?: boolean;
    /** 回测实验；省略时不改变任何生产或回测默认。 */
    recoveryExperiment?: 'd1-binding-aware';
    flashCrashOverrideEnabled?: boolean;
  };
};

/** 同一行情坐标下的独立策略 arm；不汇总资金曲线或组合回撤。 */
export type BacktestBatchRunSpec = {
  version: 1;
  mode: 'batch';
  arms: readonly BacktestRunSpec[];
};

export function isBacktestBatchRunSpec(value: unknown): value is BacktestBatchRunSpec {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { version?: unknown; mode?: unknown; arms?: unknown };
  return candidate.version === 1 && candidate.mode === 'batch' && Array.isArray(candidate.arms);
}

export type ResolvedBacktestRunSpec = Omit<BacktestRunSpec, 'config' | 'strategyOverrides' | 'mode'> & {
  mode: 'single';
  config: BacktestConfig;
  strategyOverrides: Partial<StrategyParams>;
  macroExecutionDriver: MacroExecutionDriver;
  resolvedDataWindow?: { sampleCount: number; startDate: string; endDate: string; dataFingerprint: string };
};

/** UI、CLI 与研究脚本唯一的 preset/override 合并点。 */
export function resolveRunSpec(
  spec: BacktestRunSpec,
  productionDefaults: Partial<StrategyParams> = OVERLAY_PRODUCTION_DEFAULTS,
): ResolvedBacktestRunSpec {
  const config = spec.config ?? {};
  const universe = getOverlayUniverse(spec.universeId);
  const signalSymbol = spec.signalSymbol ?? config.signalSymbol ?? universe.signalSymbol;
  const macroExecutionDriver = spec.scenarioOptions?.macroExecutionDriver ?? 'slow-macro';
  if (macroExecutionDriver === 'slow-subregime' && (universe.leveragedSymbol !== 'TQQQ' || spec.preset !== 'ultra')) {
    throw new Error('slow-subregime 首版仅支持 TQQQ + Ultra');
  }
  const strategyParams = {
    ...STRATEGY_PRESETS[spec.preset].params,
    ...productionDefaults,
    ...spec.strategyOverrides,
  };
  // A directly supplied legacy contract profile is an explicit old-style
  // selection request. Do not silently combine it with the new production
  // survival selector unless the caller also opts into a price-selection mode.
  if (spec.strategyOverrides?.pcsContractProfile !== undefined
    && (spec.strategyOverrides.pcsSurvivalPriceSelectionMode === undefined
      || spec.strategyOverrides.pcsSurvivalPriceSelectionMode === 'off')) {
    strategyParams.pcsSurvivalPriceSelectionMode = 'off';
    // Explicit legacy profiles retain the pre-candidate DTE default. Width is
    // also left to resolveOverlayDefaults so the historical constant remains
    // authoritative instead of inheriting the candidate's 35-DTE setting.
    strategyParams.pcsTargetDte = undefined;
    strategyParams.pcsSpreadWidthPct = undefined;
  }
  // 旧 UI 对未单独校准的 preset 固定使用 21.5% Call Spread 风险预算。
  // 保留 conservative 自己的 5% 上限，避免 v2 spec 重放时悄然缩小其余 preset 的仓位。
  strategyParams.csMaxTotalRiskNav ??= 0.215;
  return {
    ...spec,
    mode: 'single',
    strategyOverrides: spec.strategyOverrides ?? {},
    universeId: universe.id,
    signalSymbol,
    macroExecutionDriver,
    config: {
      initialCapital: config.initialCapital ?? 100_000,
      minBarHistory: config.minBarHistory ?? 200,
      ...config,
      leveragedSymbol: universe.leveragedSymbol,
      universeId: universe.id,
      signalSymbol,
      volIndex: config.volIndex ?? universe.primaryVolatility,
      riskVolIndex: config.riskVolIndex ?? 'VIX',
      useMockOptions: config.useMockOptions ?? true,
      includeTerminalMarkOnly: config.includeTerminalMarkOnly ?? true,
      realExpiryCalendar: config.realExpiryCalendar ?? true,
      realStrikeGrid: config.realStrikeGrid ?? true,
      timeframe: config.timeframe ?? ('1d' as BacktestTimeframe),
      trace: spec.scenarioOptions?.trace ?? config.trace,
      strategyParams,
    },
  };
}
