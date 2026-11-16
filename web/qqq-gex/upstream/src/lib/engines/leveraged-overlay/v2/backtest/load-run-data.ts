/** Complete market data loading shared by legacy references and standalone SDK v2. */
import {loadBars} from '../../backtest/helpers';
import {createHash} from 'node:crypto';
import {loadFixture,type MarketDataSet} from './fixtures';
import type {ResolvedBacktestRunSpec} from './run-spec';
import {getOverlayUniverse} from '../../universe';
import {loadLiveSlowSubregimeDiagnostics} from '../../slow-subregime-live.server';
import {dailyHistoryRangeForStart} from './history-range';
import {loadBuiltHistoryDelta,mergeBuiltHistory,readBuiltHistory} from './build-history';

export async function loadRunData(spec: ResolvedBacktestRunSpec): Promise<MarketDataSet> {
  if (spec.config.timeframe !== '1d') throw new Error('CLI/fixture 回测仅支持日线；小时线请使用 API');
  if (spec.dataSource.kind === 'fixture') return loadFixture(spec.dataSource.fixtureId);
  const historyRange = spec.dataParams ? 'max' : dailyHistoryRangeForStart(spec.config.startDate, spec.historyAnchorStart);
  const universe = getOverlayUniverse(spec.universeId);
  const underlying = spec.config.optionUnderlyingSymbol ?? 'QQQ';
  const availableBuilt = universe.signalSymbol === 'QQQ' && underlying === 'QQQ' ? await readBuiltHistory() : null;
  const built = availableBuilt?.symbols[universe.leveragedSymbol] ? availableBuilt : null;
  const useBuilt = built;
  const delta = useBuilt
    ? await loadBuiltHistoryDelta(built, universe.id, underlying)
    : await loadBars(universe, true, spec.config.optionUnderlyingSymbol, historyRange);
  const data = useBuilt ? mergeBuiltHistory(built, delta, universe.id, underlying) : delta;
  const splitEvents = data.splitEventsBySymbol?.[getOverlayUniverse(spec.universeId).leveragedSymbol]?.value ?? [];
  let slowSubregimeByDate: MarketDataSet['slowSubregimeByDate'];
  const loadWarnings: string[] = [];
  if (spec.macroExecutionDriver === 'slow-subregime' || spec.scenarioOptions?.slowSubregimeDiagnostics) {
    try { slowSubregimeByDate = await loadLiveSlowSubregimeDiagnostics(); }
    catch (error) { loadWarnings.push(`SR 官方数据不完整，已按 fallback/0 使用 CURRENT：${error instanceof Error ? error.message : '未知错误'}`); }
  }
  return {
    ...data,
    snapshotMetadata: useBuilt ? { createdAt: new Date().toISOString(), source: `${built.source}; frozen at ${built.createdAt}; runtime delta since ${built.buildDate}` } : undefined,
    slowSubregimeByDate,
    loadWarnings,
    dataLoadCoverage: {
      vixFallbackCount: data.vixFallbackCount,
      vix3mYahooRefreshCount: data.vix3mCoverage.yahooRefreshCount,
      vix3mCboeSameDayCount: data.vix3mCoverage.cboeSameDayCount,
      vix3mFredSameDayCount: data.vix3mCoverage.fredSameDayCount,
    },
    fingerprint: `live:sha256:${createHash('sha256').update(JSON.stringify({
      universeId: spec.universeId,
      signalSymbol: spec.signalSymbol,
      optionUnderlyingSymbol: spec.config.optionUnderlyingSymbol,
      qqqBars: data.qqqBars,
      spyBars: data.spyBars,
      tqqqBars: data.tqqqBars,
      boxxBars: data.boxxBars,
      vixByDate: data.vixByDate,
      vix3mByDate: data.vix3mByDate,
      vxnByDate: data.vxnByDate,
      splitEvents,
      slowSubregimeByDate,
    })).digest('hex')}`,
  };
}
