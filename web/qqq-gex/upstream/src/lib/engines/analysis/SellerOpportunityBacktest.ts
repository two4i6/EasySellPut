import type { BacktestResult } from '../leveraged-overlay/backtest/types';
import type { BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { OverlaySignalSymbol } from '../leveraged-overlay/universe';
import type { OverlayStrategyTag } from '../leveraged-overlay/constants';
import type { BearOverlayMode, CSDeltaStopMode, CSMode, CSProfitTakeMode, ICMode } from '../leveraged-overlay/types/params';
import type { OptionOrder } from '../leveraged-overlay/types/output';

export type SellerOpportunityBacktestGate =
  | 'reactive_pcs'
  | 'reactive_pcs_v1'
  | 'reactive_pcs_v1_cooldown_10d'
  | 'post_pullback_pcs'
  | 'historical_38_open'
  | 'research_open_70'
  | 'legacy_open'
  | 'watch_open'
  | 'open'
  | 'carry';

export type SellerOpportunityBacktestStrikeMode = 'delta' | 1 | 1.5 | 2 | 2.5;
export type SellerOpportunityBacktestExitMode = 'hold_to_expiry' | 'risk_reference' | 'realization_reference' | 'both_references';
export type SellerOpportunityBacktestPositionMode = 'portfolio' | 'independent';
export type SellerOpportunityBacktestLeg = 'cs' | 'ic' | 'eb' | 'pcs' | 'bearCs';
export type SellerOpportunityBacktestStrategyTag = Extract<
  OverlayStrategyTag,
  'QQQ_CALL_CREDIT_SPREAD' | 'QQQ_IRON_CONDOR' | 'QQQ_EQUITY_BOOST_PUT_SPREAD' | 'QQQ_PUT_CREDIT_SPREAD' | 'QQQ_BEAR_CALL_SPREAD' | 'QQQ_PCS_RESCUE'
>;
export type SellerOpportunityBacktestStrategyTagFilter = SellerOpportunityBacktestStrategyTag | readonly SellerOpportunityBacktestStrategyTag[];
export type SellerOpportunityBacktestStrategyMode = CSMode | BearOverlayMode | ICMode;

export const SELLER_OPPORTUNITY_BACKTEST_YEAR_OPTIONS = [1, 3, 5, 10, 20] as const;
export const SELLER_OPPORTUNITY_BACKTEST_HISTORY_ANCHOR_START = '2010-02-11';

const LEG_BY_STRATEGY_TAG: Record<SellerOpportunityBacktestStrategyTag, SellerOpportunityBacktestLeg> = {
  QQQ_CALL_CREDIT_SPREAD: 'cs',
  QQQ_IRON_CONDOR: 'ic',
  QQQ_EQUITY_BOOST_PUT_SPREAD: 'eb',
  QQQ_PUT_CREDIT_SPREAD: 'pcs',
  QQQ_BEAR_CALL_SPREAD: 'bearCs',
  QQQ_PCS_RESCUE: 'pcs',
};

export type SellerOpportunityBacktestStrategyDisplay = {
  tag: SellerOpportunityBacktestStrategyTag;
  title: string;
  summaryLabel: string;
  timelineMarker: string;
  cycleTooltipPrefix: string;
  showsLegDetails: boolean;
  defaultMode?: SellerOpportunityBacktestStrategyMode;
  takeProfit?: {
    defaultEnabled: boolean;
    defaultTarget: number;
    options: readonly number[];
  };
};

export const SELLER_OPPORTUNITY_BACKTEST_STRATEGY_META: Record<SellerOpportunityBacktestStrategyTag, SellerOpportunityBacktestStrategyDisplay> = {
  QQQ_PUT_CREDIT_SPREAD: {
    tag: 'QQQ_PUT_CREDIT_SPREAD',
    title: 'PCS',
    summaryLabel: 'PCS',
    timelineMarker: 'PCS',
    cycleTooltipPrefix: 'PCS',
    showsLegDetails: true,
  },
  QQQ_PCS_RESCUE: {
    tag: 'QQQ_PCS_RESCUE',
    title: 'QQQ PCS Rescue',
    summaryLabel: 'PCS Rescue',
    timelineMarker: 'PCS Rescue',
    cycleTooltipPrefix: 'PCS Rescue',
    showsLegDetails: true,
  },
  QQQ_CALL_CREDIT_SPREAD: {
    tag: 'QQQ_CALL_CREDIT_SPREAD',
    title: 'Call Credit Spread',
    summaryLabel: 'CS',
    timelineMarker: 'CS',
    cycleTooltipPrefix: 'Call Credit Spread',
    showsLegDetails: true,
    defaultMode: 'reactive',
    takeProfit: {
      defaultEnabled: false,
      defaultTarget: 0.6,
      options: [0.5, 0.6, 0.75],
    },
  },
  QQQ_BEAR_CALL_SPREAD: {
    tag: 'QQQ_BEAR_CALL_SPREAD',
    title: 'Bear Call Spread',
    summaryLabel: 'Bear CS',
    timelineMarker: 'Bear CS',
    cycleTooltipPrefix: 'Bear Call Spread',
    showsLegDetails: true,
    defaultMode: 'strict',
    takeProfit: {
      defaultEnabled: false,
      defaultTarget: 0.6,
      options: [0.5, 0.6, 0.75],
    },
  },
  QQQ_IRON_CONDOR: {
    tag: 'QQQ_IRON_CONDOR',
    title: 'Iron Condor',
    summaryLabel: 'IC',
    timelineMarker: 'IC',
    cycleTooltipPrefix: 'Iron Condor',
    showsLegDetails: false,
    defaultMode: 'standard',
    takeProfit: {
      defaultEnabled: false,
      defaultTarget: 0.5,
      options: [0.45, 0.5, 0.6],
    },
  },
  QQQ_EQUITY_BOOST_PUT_SPREAD: {
    tag: 'QQQ_EQUITY_BOOST_PUT_SPREAD',
    title: 'EQ Boost PCS',
    summaryLabel: 'EB',
    timelineMarker: 'EB',
    cycleTooltipPrefix: 'EQ Boost PCS',
    showsLegDetails: false,
    takeProfit: {
      defaultEnabled: false,
      defaultTarget: 0.5,
      options: [0.5, 0.75],
    },
  },
};

/** 回测的信号覆盖范围；仅供披露，不参与任何评分或决策。 */
export const SELLER_OPPORTUNITY_BACKTEST_SIGNAL_COVERAGE = {
  historical: '价格、VXN/VIX3M：历史行情',
  excluded: '期权链、OI、GEX、Skew、Flow：缺失，未进入 OPEN / Carry',
  modeled: '报价点差、到期/行权价、IV 曲面：基于历史价格与波动率的 B-S 合成模型',
} as const;

export function buildSellerOpportunityBacktestSpec(
  signalSymbol: OverlaySignalSymbol,
  gate: SellerOpportunityBacktestGate,
  startDate: string,
  endDate: string,
  strikeMode: SellerOpportunityBacktestStrikeMode = 'delta',
  exitMode: SellerOpportunityBacktestExitMode = 'hold_to_expiry',
  positionMode: SellerOpportunityBacktestPositionMode = 'portfolio',
  strategyTag: SellerOpportunityBacktestStrategyTag = 'QQQ_PUT_CREDIT_SPREAD',
  strategyMode?: SellerOpportunityBacktestStrategyMode,
  underlyingSymbol = 'QQQ',
  takeProfitEnabled?: boolean,
  takeProfitTarget?: number,
  takeProfitMode?: CSProfitTakeMode,
  csTargetDte?: number,
  csSpreadWidthPct?: number,
  csDeltaStopThreshold?: number,
  csDeltaStopMode?: CSDeltaStopMode,
  csDeltaStopCalmVix?: number,
  csDeltaStopRiskVix?: number,
  csDeltaStopCalmRoc20?: number,
  csDeltaStopCalmThreshold?: number,
  csDeltaStopRiskThreshold?: number,
  csSpLikeDynamicCalmVix?: number,
  csSpLikeDynamicCalmRoc20?: number,
  csSpLikeDynamicCalmExtensionGate?: number,
): BacktestRunSpec {
  const leg = LEG_BY_STRATEGY_TAG[strategyTag];
  const isPCS = leg === 'pcs';
  const isReactivePcs = gate === 'reactive_pcs';
  const isReactivePcsV1 = gate === 'reactive_pcs_v1' || gate === 'reactive_pcs_v1_cooldown_10d';
  const isPostPullbackPcs = gate === 'post_pullback_pcs';
  const pcsStreakCooldownTradingDays =
    gate === 'reactive_pcs_v1_cooldown_10d' ? 10
    : gate === 'reactive_pcs' ? 0
    : undefined;
  const resolvedStrategyMode =
    strategyMode
    ?? (leg === 'cs' ? 'reactive' : leg === 'bearCs' ? 'strict' : leg === 'ic' ? 'standard' : undefined);
  const strategyMeta = SELLER_OPPORTUNITY_BACKTEST_STRATEGY_META[strategyTag];
  const resolvedTakeProfitEnabled = (takeProfitEnabled ?? strategyMeta.takeProfit?.defaultEnabled) ?? false;
  const resolvedTakeProfitTarget = takeProfitTarget ?? strategyMeta.takeProfit?.defaultTarget;

  return {
    version: 1,
    preset: 'neutral',
    universeId: 'nasdaq-tqqq',
    signalSymbol,
    dataSource: { kind: 'live' },
    ...(isPCS && !(isReactivePcs || isReactivePcsV1 || isPostPullbackPcs) ? { historyAnchorStart: SELLER_OPPORTUNITY_BACKTEST_HISTORY_ANCHOR_START } : {}),
    config: {
      initialCapital: 100_000,
      startDate,
      endDate,
      timeframe: '1d',
      useMockOptions: true,
      includeTerminalMarkOnly: true,
      ...(isPCS && positionMode === 'independent' ? { appendTerminalPcsOpen: true } : {}),
      realExpiryCalendar: true,
      realStrikeGrid: true,
      optionUnderlyingSymbol: underlyingSymbol,
      ...(underlyingSymbol === 'QQQ' ? {} : { volIndex: 'VIX' as const, riskVolIndex: 'VIX' as const }),
      optionsBacktestPositionMode: { [leg]: positionMode },
    },
    strategyOverrides: {
      enablePCS: isPCS,
      ...(isPCS
        ? {
          pcsMode: isReactivePcs || isReactivePcsV1 ? 'reactive' : isPostPullbackPcs ? 'post_pullback' : 'off',
          pcsStockDecisionFilterMode:
            isReactivePcs || isPostPullbackPcs
              ? 'off'
              : isReactivePcsV1
                ? 'reactive_pcs_v1'
                : gate,
          ...(pcsStreakCooldownTradingDays === undefined ? {} : { pcsStreakCooldownTradingDays }),
          ...(strikeMode === 'delta' ? {} : { pcsShortStrikeSigma: strikeMode }),
          pcsProbabilityReferenceExitMode: exitMode,
        }
        : {}),
      enableCollar: false,
      enableCS: leg === 'cs',
      ...(leg === 'cs'
        ? {
          csMode: resolvedStrategyMode as CSMode,
          ...(resolvedStrategyMode === 'sp_like_dynamic' ? {
            csSpLikeDynamicRequireTermStructure: false,
            csSpLikeDynamicCalmVix: csSpLikeDynamicCalmVix ?? 18,
            csSpLikeDynamicCalmRoc20: csSpLikeDynamicCalmRoc20 ?? .20,
            csSpLikeDynamicCalmExtensionGate: csSpLikeDynamicCalmExtensionGate ?? 3,
          } : {}),
          ...(resolvedTakeProfitEnabled && resolvedTakeProfitTarget !== undefined ? { csProfitTakeEnabled: true, csProfitTarget: resolvedTakeProfitTarget, ...(takeProfitMode ? { csProfitTakeMode: takeProfitMode } : {}) } : {}),
          ...(csTargetDte !== undefined ? { csTargetDte } : {}),
          ...(csSpreadWidthPct !== undefined ? { csSpreadWidthPct } : {}),
          ...(csDeltaStopThreshold !== undefined ? { csDeltaStopThreshold } : {}),
          ...(csDeltaStopMode !== undefined ? { csDeltaStopMode } : {}),
          ...(csDeltaStopCalmVix !== undefined ? { csDeltaStopCalmVix } : {}),
          ...(csDeltaStopRiskVix !== undefined ? { csDeltaStopRiskVix } : {}),
          ...(csDeltaStopCalmRoc20 !== undefined ? { csDeltaStopCalmRoc20 } : {}),
          ...(csDeltaStopCalmThreshold !== undefined ? { csDeltaStopCalmThreshold } : {}),
          ...(csDeltaStopRiskThreshold !== undefined ? { csDeltaStopRiskThreshold } : {}),
        }
        : {}),
      enableIC: leg === 'ic',
      ...(leg === 'ic'
        ? {
          icMode: resolvedStrategyMode as ICMode,
          ...(resolvedTakeProfitEnabled && resolvedTakeProfitTarget !== undefined ? { icProfitTakeEnabled: true, icProfitTarget: resolvedTakeProfitTarget } : {}),
        }
        : {}),
      enableBearOverlay: leg === 'bearCs',
      ...(leg === 'bearCs'
        ? {
          bearOverlayMode: resolvedStrategyMode as BearOverlayMode,
          ...(resolvedTakeProfitEnabled && resolvedTakeProfitTarget !== undefined ? { bearProfitTarget: resolvedTakeProfitTarget } : {}),
        }
        : {}),
      enableEquityBoostPCS: leg === 'eb',
      ...(leg === 'eb'
        ? (resolvedTakeProfitEnabled && resolvedTakeProfitTarget !== undefined ? { equityBoostProfitTarget: resolvedTakeProfitTarget as 0.5 | 0.75 } : {})
        : {}),
    },
    // CS/PCS seller backtests need the same as-of slow-subregime artifact as the
    // live state snapshot so state attribution never falls back to UNKNOWN.
    // This only records the point-in-time diagnostic; the execution driver stays
    // slow-macro and does not switch the production decision path.
    scenarioOptions: { macroExecutionDriver: 'slow-macro', slowSubregimeDiagnostics: true },
  };
}

export function summarizeSellerOpportunityBacktest(
  result: Pick<BacktestResult, 'tradeLog' | 'metrics'> & { debug?: BacktestResult['debug'] },
  strategyTag: SellerOpportunityBacktestStrategyTagFilter = 'QQQ_PUT_CREDIT_SPREAD',
) {
  const strategyTags = Array.isArray(strategyTag) ? strategyTag : [strategyTag];
  const trades = result.tradeLog.filter((trade) => trade.strategyTag !== undefined && strategyTags.includes(trade.strategyTag as SellerOpportunityBacktestStrategyTag));
  const completed = trades.filter((trade) => (trade.action === 'CLOSE' || trade.action === 'SETTLE') && Number.isFinite(trade.pnl));
  const terminalMarks = trades.filter((trade) => trade.action === 'MARK' && Number.isFinite(trade.pnl));
  const pnl = completed.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const pathWins = completed.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const pcsHoldToExpiry = strategyTags.includes('QQQ_PUT_CREDIT_SPREAD')
    ? (result.debug?.pcsPathDiagnostics ?? []).filter((path) => Number.isFinite(path.holdToExpiryPnl))
    : [];
  const holdToExpiryPnl = pcsHoldToExpiry.reduce((sum, path) => sum + (path.holdToExpiryPnl ?? 0), 0);
  const holdToExpiryWins = pcsHoldToExpiry.filter((path) => (path.holdToExpiryPnl ?? 0) > 0).length;
  const opensBySymbol = new Map<string, typeof trades>();
  const holdingDays: number[] = [];

  for (const trade of trades) {
    if (trade.action === 'OPEN') {
      const opens = opensBySymbol.get(trade.symbol) ?? [];
      opens.push(trade);
      opensBySymbol.set(trade.symbol, opens);
      continue;
    }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    const open = opensBySymbol.get(trade.symbol)?.shift();
    const days =
      open &&
      (Date.parse(`${trade.date}T00:00:00Z`) - Date.parse(`${open.date}T00:00:00Z`)) /
      86400000;
    if (typeof days === 'number' && Number.isFinite(days) && days >= 0) holdingDays.push(days);
  }
  const openPositions = terminalMarks.length || Array.from(opensBySymbol.values()).reduce((count, opens) => count + opens.length, 0);

  const exitReasons = completed.reduce<Record<string, number>>((counts, trade) => {
    const reason =
      trade.outcomeReasonKey === 'probability_risk_reference'
        ? '风险参考线'
        : trade.outcomeReasonKey === 'probability_realization_reference'
          ? '兑现参考线'
          : trade.action === 'SETTLE'
            ? '到期结算'
            : '其他平仓';
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});

  return {
    opened: trades.filter((trade) => trade.action === 'OPEN').length,
    completed: completed.length,
    openPositions,
    pnl,
    unrealizedPnl: terminalMarks.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0),
    winRate: completed.length ? pathWins / completed.length : null,
    /** 实际执行了路径退出后的胜率；保留 winRate 作为兼容别名。 */
    pathWinRate: completed.length ? pathWins / completed.length : null,
    pathWins,
    pathLosses: completed.length - pathWins,
    /** 同一批已成熟样本若持有至到期的反事实胜率，不含期末尚未到期的 OPEN/MARK。 */
    holdToExpiryCompleted: pcsHoldToExpiry.length,
    holdToExpiryWins,
    holdToExpiryLosses: pcsHoldToExpiry.length - holdToExpiryWins,
    holdToExpiryWinRate: pcsHoldToExpiry.length ? holdToExpiryWins / pcsHoldToExpiry.length : null,
    holdToExpiryPnl,
    worstPnl: completed.length ? Math.min(...completed.map((trade) => trade.pnl ?? 0)) : null,
    probabilityRiskExits: completed.filter((trade) => trade.outcomeReasonKey === 'probability_risk_reference').length,
    probabilityRealizationExits: completed.filter((trade) => trade.outcomeReasonKey === 'probability_realization_reference').length,
    averageHoldingDays: holdingDays.length ? holdingDays.reduce((sum, days) => sum + days, 0) / holdingDays.length : null,
    exitReasons,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
  };
}

function sellerTradeExpiry(trade: BacktestResult['tradeLog'][number]) {
  if (trade.expiry) return trade.expiry;
  const expiry = trade.rationale?.match(/\bexp\s+(\d{4}-\d{2}-\d{2})(?![\d-])/i)?.[1];
  if (!expiry) return undefined;
  const parsed = new Date(`${expiry}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === expiry ? expiry : undefined;
}
function sellerTradeStrikes(trade: BacktestResult['tradeLog'][number]) {
  const strikes = trade.symbol?.match(/@?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/)?.slice(1).map(Number) ?? [];
  return trade.strategyTag === 'QQQ_CALL_CREDIT_SPREAD' ? [strikes[1], strikes[0]] : strikes;
}
export function buildSellerOpportunityBacktestTimeline(result: Pick<BacktestResult, 'tradeLog' | 'equityCurve' | 'nextOpenPlan'>, strategyTag: SellerOpportunityBacktestStrategyTagFilter = 'QQQ_PUT_CREDIT_SPREAD', includeOpen = false) {
  const strategyTags = Array.isArray(strategyTag) ? strategyTag : [strategyTag];
  const prices = result.equityCurve.flatMap((point) =>
    typeof point.qqqPrice === 'number' && Number.isFinite(point.qqqPrice)
      ? [{ date: point.date, value: point.qqqPrice }]
      : [],
  );
  const indexByDate = new Map(prices.map((point, index) => [point.date, index]));
  const openQueueBySymbol = new Map<string, BacktestResult['tradeLog']>();
  const terminalMarksBySymbol = new Map<string, BacktestResult['tradeLog']>();
  const cycles: {
    openDate: string;
    closeDate: string;
    pnl: number;
    holdingDays: number;
    open?: boolean;
    pending?: boolean;
    executionReasonKey?: string;
    outcomeReason?: string;
    outcomeReasonKey?: string;
    signalDate?: string;
    expiry?: string;
    quantity?: number;
    longStrike?: number;
    shortStrike?: number;
    creditPerContract?: number;
    maxLossPerContract?: number;
    unrealizedPnl?: number;
    strategyTag?: SellerOpportunityBacktestStrategyTag;
  }[] = [];

  for (const trade of result.tradeLog) {
    if (trade.strategyTag === undefined || !strategyTags.includes(trade.strategyTag as SellerOpportunityBacktestStrategyTag)) continue;
    if (trade.action === 'MARK') {
      const marks = terminalMarksBySymbol.get(trade.symbol) ?? [];
      marks.push(trade);
      terminalMarksBySymbol.set(trade.symbol, marks);
      continue;
    }
    if (trade.action === 'OPEN') {
      const opens = openQueueBySymbol.get(trade.symbol) ?? [];
      opens.push(trade);
      openQueueBySymbol.set(trade.symbol, opens);
      continue;
    }
    if (trade.action !== 'CLOSE' && trade.action !== 'SETTLE') continue;
    const open = openQueueBySymbol.get(trade.symbol)?.shift();
    const openIndex = open && indexByDate.get(open.date);
    const closeIndex = indexByDate.get(trade.date);
    if (!open || openIndex === undefined || closeIndex === undefined || closeIndex < openIndex || !Number.isFinite(trade.pnl)) continue;

    const [longStrike, shortStrike] = sellerTradeStrikes(open);
    const creditPerContract = Number.isFinite(open.fillPrice) ? open.fillPrice * 100 : undefined;
    const maxLossPerContract =
      longStrike !== undefined && shortStrike !== undefined && creditPerContract !== undefined
        ? Math.abs(shortStrike - longStrike) * 100 - creditPerContract
        : undefined;

    cycles.push({
      openDate: open.date,
      closeDate: trade.date,
      pnl: trade.pnl!,
      holdingDays: closeIndex - openIndex,
      outcomeReason: trade.outcomeReason,
      outcomeReasonKey: trade.outcomeReasonKey,
      executionReasonKey: open.executionReasonKey,
      signalDate: open.signalDate,
      expiry: sellerTradeExpiry(open) ?? sellerTradeExpiry(trade),
      quantity: open.quantity,
      longStrike,
      shortStrike,
      creditPerContract,
      maxLossPerContract,
      strategyTag: open.strategyTag as SellerOpportunityBacktestStrategyTag | undefined,
    });
  }

  if (includeOpen) {
    const lastDate = prices.at(-1)?.date;
    for (const opens of openQueueBySymbol.values()) {
      for (const open of opens) {
        const mark = terminalMarksBySymbol.get(open.symbol)?.shift();
        const [longStrike, shortStrike] = sellerTradeStrikes(open);
        const creditPerContract = Number.isFinite(open.fillPrice) ? open.fillPrice * 100 : undefined;
        const maxLossPerContract =
          longStrike !== undefined && shortStrike !== undefined && creditPerContract !== undefined
            ? Math.abs(shortStrike - longStrike) * 100 - creditPerContract
            : undefined;
        cycles.push({
          openDate: open.date,
          closeDate: lastDate ?? open.date,
          pnl: 0,
          holdingDays: lastDate ? Math.max(0, (Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${open.date}T00:00:00Z`)) / 86400000) : 0,
          open: true,
          executionReasonKey: open.executionReasonKey,
          signalDate: open.signalDate,
          expiry: sellerTradeExpiry(open) ?? (mark ? sellerTradeExpiry(mark) : undefined),
          quantity: open.quantity,
          longStrike,
          shortStrike,
          creditPerContract,
          maxLossPerContract,
          unrealizedPnl: mark?.pnl,
          strategyTag: open.strategyTag as SellerOpportunityBacktestStrategyTag | undefined,
        });
      }
    }

    const plan = result.nextOpenPlan;
    if (plan && plan.blockers.length === 0) {
      const alreadyOpenedSameDay = result.tradeLog.some(
        (trade) => trade.strategyTag !== undefined && strategyTags.includes(trade.strategyTag as SellerOpportunityBacktestStrategyTag) && trade.action === 'OPEN' && trade.signalDate === plan.signalDate,
      );
      const proposals = alreadyOpenedSameDay
        ? []
        : plan.proposals.filter((proposal): proposal is OptionOrder => proposal.kind === 'option' && proposal.strategyTag !== undefined && strategyTags.includes(proposal.strategyTag as SellerOpportunityBacktestStrategyTag));
      if (proposals.length > 0) {
        const optionType = strategyTags.every((tag) => tag === 'QQQ_CALL_CREDIT_SPREAD' || tag === 'QQQ_BEAR_CALL_SPREAD') ? 'call' : 'put';
        const short = proposals.find((proposal) => proposal.optionType === optionType && (proposal.legRole === 'short_put' || proposal.legRole === 'short_call'));
        const long = proposals.find((proposal) => proposal.optionType === optionType && (proposal.legRole === 'long_put' || proposal.legRole === 'long_call'));
        const creditPerContract = typeof short?.credit === 'number' && Number.isFinite(short.credit) ? short.credit * 100 : undefined;
        const maxLossPerContract = short?.maxLoss ?? (
          short && long && creditPerContract !== undefined
            ? Math.abs(short.strike - long.strike) * 100 - creditPerContract
            : undefined
        );
        cycles.push({
          openDate: plan.signalDate,
          closeDate: plan.signalDate,
          pnl: 0,
          holdingDays: 0,
          pending: true,
          signalDate: plan.signalDate,
          expiry: short?.expiry ?? long?.expiry,
          longStrike: long?.strike,
          shortStrike: short?.strike,
          creditPerContract,
          maxLossPerContract,
          strategyTag: short?.strategyTag as SellerOpportunityBacktestStrategyTag | undefined,
        });
      }
    }
  }

  cycles.sort((left, right) => (right.signalDate ?? right.openDate).localeCompare(left.signalDate ?? left.openDate));

  return { prices, cycles };
}

export type SellerOpportunityBacktestTimelineCycle = ReturnType<typeof buildSellerOpportunityBacktestTimeline>['cycles'][number];

/**
 * 按持有期加权的平均保证金占用。
 * 价差的保证金以「最大亏损/张 × 数量」计；同日开平按 1 个交易日计入，
 * 未平仓与待开仓周期不计入，保持与已完成交易的平均持有期口径一致。
 */
export function calculateSellerOpportunityAverageMarginOccupancy(
  cycles: readonly SellerOpportunityBacktestTimelineCycle[],
): number | null {
  let weightedMarginDays = 0;
  let holdingDayWeight = 0;

  for (const cycle of cycles) {
    if (cycle.open || cycle.pending) continue;
    if (!Number.isFinite(cycle.maxLossPerContract) || !Number.isFinite(cycle.quantity)) continue;

    const margin = Math.max(0, (cycle.maxLossPerContract ?? 0) * (cycle.quantity ?? 0));
    const holdingDays = Math.max(1, cycle.holdingDays);
    weightedMarginDays += margin * holdingDays;
    holdingDayWeight += holdingDays;
  }

  return holdingDayWeight > 0 ? weightedMarginDays / holdingDayWeight : null;
}
