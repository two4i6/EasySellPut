import type { BacktestTraceEntry, EquityPoint, PcsPathDiagnostic, TradeEntry } from '../leveraged-overlay/backtest/types';
import type { MarketEnvironmentSnapshot } from '../leveraged-overlay/types/output';

export type QqqReplaySnapshotStrategy = 'pcs' | 'cs';
export type QqqReplayCandidateStrategyTag = 'QQQ_PUT_CREDIT_SPREAD' | 'QQQ_EQUITY_BOOST_PUT_SPREAD';
// v7: retain the actual PCS/EB strategy tag so replay cards identify EB opens.
export const QQQ_REPLAY_SNAPSHOT_VERSION = 'replay-snapshot-v11';

/** 日期轴回放只需要这些日线状态；完整 MarketEnvironmentSnapshot 留在服务端 trace。 */
export type QqqReplayMarketState = Pick<MarketEnvironmentSnapshot, 'regime' | 'bearMarketPhase' | 'crisisPhase' | 'macroRegime' | 'slowSubregime' | 'slowSubregimePosterior' | 'slowSubregimeHealth' | 'flashCrashOverrideActive' | 'vix' | 'roc5' | 'roc20' | 'tqqqRoc20' | 'priceExtensionAtr'>;

/** 历史回放面板使用的最小候选结构；不携带完整 optionProposals/optionPositions。 */
export type QqqReplayCandidate = {
  status: 'READY' | 'UNAVAILABLE';
  source: 'historical_model';
  strategyTag?: QqqReplayCandidateStrategyTag;
  optionType: 'put' | 'call';
  expiry?: string;
  exitDate?: string;
  exitAction?: 'CLOSE' | 'SETTLE';
  daysToExpiration?: number;
  sigma?: number;
  sigmaReason?: string;
  shortStrike?: number;
  longStrike?: number;
  width?: number;
  netCredit?: number;
  slippage?: number;
  definedRisk?: number;
  annualizedReturn?: number;
  minOpenInterest?: number;
  minVolume?: number;
  model?: { expiry: string; daysToExpiration: number; shortStrike: number; longStrike: number };
  reason?: string;
};

export type QqqReplayDailySnapshot = {
  date: string;
  marketState: QqqReplayMarketState;
  candidate: QqqReplayCandidate;
};

/** 配置切换后定位到最近一个已闭合回放日；实时当天不属于历史回放。 */
export function latestHistoricalReplaySnapshotDate(snapshots: readonly QqqReplayDailySnapshot[], liveDate: string): string | null {
  return snapshots
    .map((snapshot) => snapshot.date)
    .filter((date) => date !== liveDate)
    .sort()
    .at(-1) ?? null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dateDiffDays(from: string, to: string): number | undefined {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function proposalMetadata(proposal: BacktestTraceEntry['optionProposals'][number] | undefined, strategy: QqqReplaySnapshotStrategy) {
  return strategy === 'pcs'
    ? (proposal as unknown as { putCreditSpread?: Record<string, unknown>; equityBoostPutSpread?: Record<string, unknown> } | undefined)?.putCreditSpread
      ?? (proposal as unknown as { equityBoostPutSpread?: Record<string, unknown> } | undefined)?.equityBoostPutSpread
    : (proposal as unknown as { callCreditSpread?: Record<string, unknown> } | undefined)?.callCreditSpread;
}

function replayMarketState(state: MarketEnvironmentSnapshot): QqqReplayMarketState {
  return {
    regime: state.regime,
    bearMarketPhase: state.bearMarketPhase,
    crisisPhase: state.crisisPhase,
    macroRegime: state.macroRegime,
    slowSubregime: state.slowSubregime,
    slowSubregimePosterior: state.slowSubregimePosterior,
    slowSubregimeHealth: state.slowSubregimeHealth,
    flashCrashOverrideActive: state.flashCrashOverrideActive,
    vix: state.vix,
    roc5: state.roc5,
    roc20: state.roc20,
    tqqqRoc20: state.tqqqRoc20,
    priceExtensionAtr: state.priceExtensionAtr,
  };
}

function unavailableCandidate(strategy: QqqReplaySnapshotStrategy, reason = `回放当日未记录 ${strategy === 'pcs' ? 'PCS' : 'CS'} 候选结构`): QqqReplayCandidate {
  const optionType = strategy === 'pcs' ? 'put' : 'call';
  return { status: 'UNAVAILABLE', source: 'historical_model', optionType, reason };
}

function replayCandidateStrategyTag(trade: TradeEntry | undefined): QqqReplayCandidateStrategyTag | undefined {
  return trade?.strategyTag === 'QQQ_PUT_CREDIT_SPREAD' || trade?.strategyTag === 'QQQ_EQUITY_BOOST_PUT_SPREAD'
    ? trade.strategyTag
    : undefined;
}

export type QqqReplaySnapshotContext = {
  equityCurve?: readonly Pick<EquityPoint, 'date' | 'qqqPrice'>[];
  pcsPathDiagnostics?: readonly PcsPathDiagnostic[];
};

function factorNumber(entry: BacktestTraceEntry | undefined, ids: readonly string[]): number | undefined {
  for (const id of ids) {
    const value = finiteNumber(entry?.factors?.[id]?.value);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function actualOpenSigma(
  entry: BacktestTraceEntry,
  strategy: QqqReplaySnapshotStrategy,
  trade: TradeEntry | undefined,
  shortStrike: number,
  traceByDate: ReadonlyMap<string, BacktestTraceEntry>,
  context: QqqReplaySnapshotContext,
): number | undefined {
  const openDate = trade?.date;
  if (openDate === undefined) return undefined;
  const signalDate = trade?.signalDate ?? entry.date;

  const openTrace = traceByDate.get(openDate);
  const path = strategy === 'pcs'
    ? context.pcsPathDiagnostics?.find((item) => item.signalDate === signalDate
      && item.openDate === openDate
      && item.shortStrike === shortStrike)
    : undefined;
  const spot = finiteNumber(path?.openSpot)
    ?? finiteNumber(context.equityCurve?.find((point) => point.date === openDate)?.qqqPrice);
  const annualizedRv20 = factorNumber(openTrace, ['qqq_rv20', 'historical_volatility', 'seller_sigma_20']);
  if (spot === undefined || spot <= 0 || annualizedRv20 === undefined || annualizedRv20 <= 0) return undefined;

  const dailySigma = annualizedRv20 / Math.sqrt(252);
  const distance = strategy === 'pcs' ? (spot - shortStrike) / spot : (shortStrike - spot) / spot;
  return Number.isFinite(distance / dailySigma) && distance > 0 ? distance / dailySigma : undefined;
}

function candidateFromTrade(
  entry: BacktestTraceEntry,
  strategy: QqqReplaySnapshotStrategy,
  trade: TradeEntry | undefined,
  exitTrade: TradeEntry | undefined,
  traceByDate: ReadonlyMap<string, BacktestTraceEntry>,
  context: QqqReplaySnapshotContext,
): QqqReplayCandidate {
  const optionType = strategy === 'pcs' ? 'put' : 'call';
  const strikes = trade?.symbol.match(/@(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
  const firstStrike = strikes?.[1] === undefined ? undefined : finiteNumber(Number(strikes[1]));
  const secondStrike = strikes?.[2] === undefined ? undefined : finiteNumber(Number(strikes[2]));
  const expiry = typeof trade?.expiry === 'string' ? trade.expiry : undefined;
  if (trade === undefined || firstStrike === undefined || secondStrike === undefined || expiry === undefined) {
    return unavailableCandidate(strategy);
  }

  const shortStrike = strategy === 'pcs' ? secondStrike : firstStrike;
  const longStrike = strategy === 'pcs' ? firstStrike : secondStrike;
  const netCredit = finiteNumber(trade.fillPrice);
  const width = Math.abs(shortStrike - longStrike);
  const definedRisk = netCredit !== undefined ? Math.max(0, width * 100 - netCredit * 100) : undefined;
  const daysToExpiration = dateDiffDays(entry.date, expiry);
  const annualizedReturn = netCredit !== undefined && definedRisk !== undefined && definedRisk > 0 && daysToExpiration !== undefined && daysToExpiration > 0
    ? (netCredit * 100 / definedRisk) * 365 / daysToExpiration * 100
    : undefined;
  const sigma = actualOpenSigma(entry, strategy, trade, shortStrike, traceByDate, context);
  return {
    status: 'READY',
    source: 'historical_model',
    strategyTag: replayCandidateStrategyTag(trade),
    optionType,
    expiry,
    exitDate: exitTrade?.date,
    exitAction: exitTrade?.action === 'CLOSE' || exitTrade?.action === 'SETTLE' ? exitTrade.action : undefined,
    daysToExpiration,
    shortStrike,
    longStrike,
    width,
    netCredit,
    definedRisk,
    annualizedReturn,
    sigma,
    sigmaReason: sigma === undefined
      ? '回测实际开仓日缺少 QQQ 现价或 RV20，无法计算实际距离。'
      : `按实际开仓日 ${trade.date} 的 QQQ 现价与 RV20 计算；不是信号日模型档位。`,
    model: daysToExpiration === undefined ? undefined : { expiry, daysToExpiration, shortStrike, longStrike },
  };
}

function candidateFromTrace(
  entry: BacktestTraceEntry,
  strategy: QqqReplaySnapshotStrategy,
  fallbackTrade: TradeEntry | undefined,
  exitTrade: TradeEntry | undefined,
  traceByDate: ReadonlyMap<string, BacktestTraceEntry>,
  context: QqqReplaySnapshotContext,
): QqqReplayCandidate {
  const optionType = strategy === 'pcs' ? 'put' : 'call';
  const proposal = entry.optionProposals.find((item) => strategy === 'pcs'
    ? item.action === 'ADD_PUT_CREDIT_SPREAD' || item.action === 'ADD_EQUITY_BOOST_PUT_SPREAD'
    : item.action === 'ADD_CALL_SPREAD');
  const strikes = proposal?.proposed_strikes;
  const shortStrike = finiteNumber(strikes?.spread_short_strike);
  const longStrike = finiteNumber(strikes?.spread_long_strike);
  const expiry = typeof strikes?.expiry === 'string' ? strikes.expiry : undefined;
  if (proposal === undefined || shortStrike === undefined || longStrike === undefined || expiry === undefined) {
    return candidateFromTrade(entry, strategy, fallbackTrade, exitTrade, traceByDate, context);
  }

  const metadata = proposalMetadata(proposal, strategy);
  const netCredit = finiteNumber(proposal.premium_estimate) ?? finiteNumber(metadata?.credit);
  const definedRisk = finiteNumber(metadata?.maxLoss)
    ?? (netCredit !== undefined ? Math.max(0, Math.abs(shortStrike - longStrike) * 100 - netCredit * 100) : undefined);
  const daysToExpiration = dateDiffDays(entry.date, expiry);
  const width = Math.abs(shortStrike - longStrike);
  const annualizedReturn = netCredit !== undefined && definedRisk !== undefined && definedRisk > 0 && daysToExpiration !== undefined && daysToExpiration > 0
    ? (netCredit * 100 / definedRisk) * 365 / daysToExpiration * 100
    : undefined;
  const actualSigma = actualOpenSigma(entry, strategy, fallbackTrade, shortStrike, traceByDate, context);
  const modelSigma = finiteNumber(metadata?.shortPutSigma) ?? finiteNumber(metadata?.shortCallSigma);
  return {
    status: 'READY',
    source: 'historical_model',
    strategyTag: replayCandidateStrategyTag(fallbackTrade),
    optionType,
    expiry,
    exitDate: exitTrade?.date,
    exitAction: exitTrade?.action === 'CLOSE' || exitTrade?.action === 'SETTLE' ? exitTrade.action : undefined,
    daysToExpiration,
    shortStrike,
    longStrike,
    width,
    netCredit,
    definedRisk,
    annualizedReturn,
    sigma: actualSigma ?? modelSigma,
    sigmaReason: actualSigma === undefined
      ? '来自回测当日候选结构；不是实时真实链报价。'
      : `按实际开仓日 ${fallbackTrade?.date ?? entry.date} 的 QQQ 现价与 RV20 计算；不是信号日模型档位。`,
    model: daysToExpiration === undefined ? undefined : { expiry, daysToExpiration, shortStrike, longStrike },
  };
}

export function buildQqqReplayDailySnapshots(
  trace: readonly BacktestTraceEntry[] | undefined,
  strategy: QqqReplaySnapshotStrategy,
  tradeLog: readonly TradeEntry[] = [],
  context: QqqReplaySnapshotContext = {},
): QqqReplayDailySnapshot[] {
  const traceByDate = new Map((trace ?? []).map((entry) => [entry.date, entry]));
  return (trace ?? []).map((entry) => {
    const hasTraceProposal = entry.optionProposals.some((proposal) => strategy === 'pcs'
      ? proposal.action === 'ADD_PUT_CREDIT_SPREAD' || proposal.action === 'ADD_EQUITY_BOOST_PUT_SPREAD'
      : proposal.action === 'ADD_CALL_SPREAD');
    const openingTrade = tradeLog.find((trade) => (
      trade.action === 'OPEN'
      && trade.signalDate === entry.date
      && (strategy === 'pcs'
        ? trade.strategyTag === 'QQQ_PUT_CREDIT_SPREAD' || trade.strategyTag === 'QQQ_EQUITY_BOOST_PUT_SPREAD'
        : trade.strategyTag === 'QQQ_CALL_CREDIT_SPREAD')));
    const exitTrade = openingTrade ? tradeLog.find((trade) => (
      (trade.action === 'CLOSE' || trade.action === 'SETTLE')
      && trade.symbol === openingTrade.symbol
      && trade.date >= openingTrade.date
      && (trade.strategyTag === undefined || openingTrade.strategyTag === undefined || trade.strategyTag === openingTrade.strategyTag)
    )) : undefined;
    return {
      date: entry.date,
      marketState: replayMarketState(entry.marketState),
      // 日线资格可以在 signalDate 通过，但只有真实 OPEN 才能成为回放候选。
      candidate: openingTrade
        ? candidateFromTrace(entry, strategy, openingTrade, exitTrade, traceByDate, context)
        : unavailableCandidate(strategy, hasTraceProposal ? `回放当日无实际开仓，不返回可执行 ${strategy === 'pcs' ? 'PCS' : 'CS'} 合约候选` : undefined),
    };
  });
}
