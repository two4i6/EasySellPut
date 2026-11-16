import {
  buildSellerOpportunityBacktestSpec,
  type SellerOpportunityBacktestExitMode,
  type SellerOpportunityBacktestStrikeMode,
  type SellerOpportunityBacktestStrategyTagFilter,
} from './SellerOpportunityBacktest';
import type { PcsContractProfileId } from '../leveraged-overlay/v2/strategies/pcs-contract-profile';
import type { PCSPressureSizingMode, PCSSurvivalExitMode, PCSSurvivalPriceSelectionMode, PCSSurvivalSelectionDteMode, PCSSurvivalSelectionObjective, PCSSurvivalSelectionSigmaMode, PCSSurvivalSelectionWidthMode, PCSSurvivalTouchConfirmation } from '../leveraged-overlay/types/params';
import type { BacktestResult, BacktestTraceEntry } from '../leveraged-overlay/backtest/types';
import type { BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import { explainReactivePcsTiming, type ReactivePcsReasonCode } from './PcsReactiveRule';
import type { QqqReplayDailySnapshot } from './QqqReplaySnapshot';
import type { QqqE1P0R2SharedBreakdown } from './QqqE1P0R2Replay';
import type { QqqEb2P2R5SharedBreakdown } from './QqqEb2P2R5Replay';
import type { QqqEb6P4E0R7ReplayResult } from './QqqEb6P4E0R7Replay';
import type { buildQqqEb7P5R8ReplayWithData } from './QqqEb7P5R8Replay';
import type { buildQqqEb7P6R9ReplayWithData } from './QqqEb7P6R9Replay';
import type { QqqEb6P6R9ReplayResult } from './QqqEb6E209P6E385R9E226Replay';
import type { QqqEb7E209P6R9ReplayResult } from './QqqEb7E209P6E385R9E226Replay';

export const QQQ_PCS_HISTORICAL_BACKTEST_YEARS = 5;
export const QQQ_PCS_HISTORICAL_BACKTEST_YEAR_OPTIONS = [1, 3, 5] as const;
export type QqqPcsHistoricalBacktestYears = typeof QQQ_PCS_HISTORICAL_BACKTEST_YEAR_OPTIONS[number];
/** PCS 独立历史回放的可选口径；v1_2_7 保留为旧请求兼容别名。 */
export type QqqPcsHistoricalReplayVariant = 'dynamic_v1' | 'survival_only' | 'v1_1' | 'v1_2' | 'v1_2_1' | 'v1_2_2' | 'v1_2_3' | 'v1_2_4' | 'v1_2_5' | 'v1_2_6' | 'v1_2_6_r' | 'v1_2_7_a' | 'v1_2_7_b' | 'v1_2_7' | 'bass2_1_1' | 'bass2_1_2' | 'bass2_2_1' | 'bass2_3_1' | 'bass2_3_2' | 'bass2_3_2_candidate3' | 'bass2_3_3' | 'e1_p0_r2' | 'eb2_p2_r5' | 'eb6_p4e0_r7' | 'eb6_p6_r9' | 'eb7_p5_r8' | 'eb7_p6_r9' | 'eb7_e209_p6_e385_r9_e226';
export const QQQ_V1_2_7A_CODENAME = 'P0-legacy' as const;
export const QQQ_V1_2_7B_CODENAME = 'P0' as const;
/** v1_2_7 是旧客户端对 v1_2_7_a 的兼容别名。 */
export const QQQ_V1_2_7_CODENAME = QQQ_V1_2_7A_CODENAME;
export const QQQ_BASS2_1_1_REPLAY_TAGS = ['QQQ_PUT_CREDIT_SPREAD', 'QQQ_EQUITY_BOOST_PUT_SPREAD'] as const;
export const QQQ_BASS2_1_2_REPLAY_TAGS = QQQ_BASS2_1_1_REPLAY_TAGS;
export const QQQ_BASS2_2_1_REPLAY_TAGS = QQQ_BASS2_1_1_REPLAY_TAGS;
export const QQQ_BASS2_3_1_REPLAY_TAGS = QQQ_BASS2_1_1_REPLAY_TAGS;
export const QQQ_BASS2_3_2_REPLAY_TAGS = QQQ_BASS2_3_1_REPLAY_TAGS;
export const QQQ_BASS2_3_2_CANDIDATE3_REPLAY_TAGS = QQQ_BASS2_3_2_REPLAY_TAGS;
export const QQQ_BASS2_3_3_REPLAY_TAGS = QQQ_BASS2_3_2_REPLAY_TAGS;
export const QQQ_E1_P0_R2_REPLAY_TAGS = [...QQQ_BASS2_3_3_REPLAY_TAGS, 'QQQ_PCS_RESCUE'] as const;
export const QQQ_EB6_P4_E0_R7_REPLAY_TAGS = ['QQQ_EQUITY_BOOST_PUT_SPREAD', 'QQQ_PUT_CREDIT_SPREAD', 'QQQ_PCS_RESCUE'] as const;
export const QQQ_EB7_P5_R8_REPLAY_TAGS = ['QQQ_EQUITY_BOOST_PUT_SPREAD', 'QQQ_PUT_CREDIT_SPREAD', 'QQQ_PCS_RESCUE'] as const;
export const QQQ_EB7_P6_R9_REPLAY_TAGS = QQQ_EB7_P5_R8_REPLAY_TAGS;
export const QQQ_EB6_P6_R9_REPLAY_TAGS = QQQ_EB7_P5_R8_REPLAY_TAGS;
export const QQQ_EB7_E209_P6_R9_REPLAY_TAGS = QQQ_EB7_P5_R8_REPLAY_TAGS;
export { QQQ_BASS2_1_1_PCS_WIDTH_PCT, QQQ_BASS2_1_2_PCS_WIDTH_PCT, QQQ_BASS2_2_1_PCS_WIDTH_PCT, QQQ_BASS2_3_1_PCS_WIDTH_PCT, QQQ_BASS2_3_2_PCS_WIDTH_PCT, QQQ_BASS2_3_3_PCS_WIDTH_PCT, QQQ_V1_1_PCS_WIDTH_PCT, QQQ_V1_2_PCS_WIDTH_PCT, QQQ_V1_2_3_PCS_WIDTH_PCT, QQQ_V1_2_4_PCS_WIDTH_PCT, QQQ_V1_2_5_PCS_WIDTH_PCT, QQQ_V1_2_6_PCS_WIDTH_PCT } from './QqqPcsBacktestSpec';

export function qqqPcsReplayStrategyTags(replayVariant: QqqPcsHistoricalReplayVariant): SellerOpportunityBacktestStrategyTagFilter {
  return replayVariant === 'bass2_1_1' ? QQQ_BASS2_1_1_REPLAY_TAGS
    : replayVariant === 'bass2_1_2' ? QQQ_BASS2_1_2_REPLAY_TAGS
      : replayVariant === 'bass2_2_1' ? QQQ_BASS2_2_1_REPLAY_TAGS
      : replayVariant === 'bass2_3_1' ? QQQ_BASS2_3_1_REPLAY_TAGS
      : replayVariant === 'bass2_3_2' ? QQQ_BASS2_3_2_REPLAY_TAGS
      : replayVariant === 'bass2_3_2_candidate3' ? QQQ_BASS2_3_2_CANDIDATE3_REPLAY_TAGS
      : replayVariant === 'bass2_3_3' ? QQQ_BASS2_3_3_REPLAY_TAGS
      : replayVariant === 'e1_p0_r2' ? QQQ_E1_P0_R2_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb2_p2_r5' ? ['QQQ_PUT_CREDIT_SPREAD', 'QQQ_EQUITY_BOOST_PUT_SPREAD', 'QQQ_PCS_RESCUE'] as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb6_p4e0_r7' ? QQQ_EB6_P4_E0_R7_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb6_p6_r9' ? QQQ_EB6_P6_R9_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb7_p5_r8' ? QQQ_EB7_P5_R8_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb7_p6_r9' ? QQQ_EB7_P6_R9_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : replayVariant === 'eb7_e209_p6_e385_r9_e226' ? QQQ_EB7_E209_P6_R9_REPLAY_TAGS as unknown as SellerOpportunityBacktestStrategyTagFilter
      : 'QQQ_PUT_CREDIT_SPREAD';
}
export type QqqPcsConcurrencyGate = 'off' | 'maxOpen1' | 'cooldownDays';
export type QqqPcsCooldownTradingDays = 3 | 5 | 10;

export type QqqPcsHistoricalBacktestOptions = {
  startDate: string;
  endDate: string;
  replayVariant?: QqqPcsHistoricalReplayVariant;
  strikeMode: SellerOpportunityBacktestStrikeMode;
  exitMode: SellerOpportunityBacktestExitMode;
  contractProfile?: PcsContractProfileId;
  /** 研究专用：不由展示页/API 传入，默认保持独立单笔回放。 */
  pcsConcurrencyGate?: QqqPcsConcurrencyGate;
  pcsCooldownTradingDays?: QqqPcsCooldownTradingDays;
  /** 研究专用：生存率/首次触碰退出臂；默认 off。 */
  survivalExitMode?: PCSSurvivalExitMode;
  survivalFloor?: number;
  survivalDrop?: number;
  survivalTouchConfirmation?: PCSSurvivalTouchConfirmation;
  survivalTouchBufferPct?: number;
  survivalTouchVixThreshold?: number;
  /** 按 as-of no-touch 生存率选择短腿；默认使用当前 PCS 候选。 */
  priceSelectionMode?: PCSSurvivalPriceSelectionMode;
  survivalSelectionFloor?: number;
  survivalSelectionStressFloor?: number;
  survivalSelectionObjective?: PCSSurvivalSelectionObjective;
  survivalSelectionSurvivalWeight?: number;
  survivalSelectionWilsonWeight?: number;
  survivalSelectionMaxConditionalLossRatio?: number;
  survivalSelectionStressTailVetoRatio?: number;
  survivalSelectionTailWidthTriggerRatio?: number;
  survivalSelectionWidthBlend?: number;
  survivalSelectionWidthConfirmDays?: number;
  survivalSelectionWidthSwitchMargin?: number;
  survivalSelectionWidthDeltaPnlFloor?: number;
  survivalSelectionWidthTailImprovementMargin?: number;
  survivalSelectionCreditRetentionFloor?: number;
  survivalSelectionStressWeight?: number;
  survivalSelectionDteMode?: PCSSurvivalSelectionDteMode;
  survivalSelectionWidthMode?: PCSSurvivalSelectionWidthMode;
  survivalSelectionSigmaMode?: PCSSurvivalSelectionSigmaMode;
  pressureSizingMode?: PCSPressureSizingMode;
  pressureSizingMediumMultiplier?: number;
  pressureSizingStressedMultiplier?: number;
};

/** 历史日期轴使用独立回放 trace 中的同源 Reactive PCS 日线资格，避免与单日展示接口混用。 */
export type QqqPcsReplayDailySignal = {
  date: string;
  /** bass 回放合并 PCS + EB；标签必须来自引擎准入投影，禁止页面猜测。 */
  strategy?: 'PCS' | 'EB' | 'PCS_RESCUE';
  eligibility: 'OPEN' | 'BLOCK' | 'UNAVAILABLE';
  reasons: string[];
  gates: Array<{
    label: string;
    status: 'PASS' | 'BLOCK' | 'UNAVAILABLE';
    detail: string;
  }>;
};

export type QqqPcsHistoricalReplayResult = BacktestResult & {
  dataFingerprint?: string;
  pcsDailySignalHistory: QqqPcsReplayDailySignal[];
  pcsDailyReplaySnapshots: QqqReplayDailySnapshot[];
  qqqE1P0R2?: QqqE1P0R2SharedBreakdown;
  qqqEb2P2R5?: QqqEb2P2R5SharedBreakdown;
  qqqEb6P4E0R7?: QqqEb6P4E0R7ReplayResult;
  qqqEb6P6R9?: QqqEb6P6R9ReplayResult;
  qqqEb7P5R8?: Awaited<ReturnType<typeof buildQqqEb7P5R8ReplayWithData>>;
  qqqEb7P6R9?: Awaited<ReturnType<typeof buildQqqEb7P6R9ReplayWithData>>;
};

type QqqPcsHistoricalBacktestSpec = BacktestRunSpec
  & Required<Pick<BacktestRunSpec, 'config' | 'strategyOverrides'>>;

const replayReasonText: Record<ReactivePcsReasonCode, string> = {
  NON_QQQ: '仅支持 QQQ',
  VIX_OUT_OF_RANGE: 'VIX 不在 14–28',
  REGIME_DISALLOWED: '市场状态不满足 Reactive PCS',
  CRISIS_PHASE: '危机阶段阻断',
  MISSING_VIX: '回放 VIX 输入不可用',
  MISSING_TERM_RATIO: '回放 VIX3M 输入不可用',
  BACKWARDATED_TERM: 'VIX 期限结构倒挂',
};

function traceNumber(entry: BacktestTraceEntry, id: string): number | null {
  const value = entry.factors?.[id]?.value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function hasReplayCandidate(entry: BacktestTraceEntry, strategyTag: SellerOpportunityBacktestStrategyTagFilter): boolean {
  const tags = (Array.isArray(strategyTag) ? strategyTag : [strategyTag]) as readonly string[];
  const proposalStrategyTag = (proposal: BacktestTraceEntry['optionProposals'][number]) => {
    const value = (proposal as unknown as { strategyTag?: unknown }).strategyTag;
    return typeof value === 'string' ? value : undefined;
  };
  return (entry.candidateActions ?? []).some((action) => tags.includes(action))
    || (entry.optionProposals ?? []).some((proposal) => {
      const strategy = proposalStrategyTag(proposal);
      return strategy !== undefined && tags.includes(strategy);
    })
    || (entry.trades ?? []).some((trade) => trade.action === 'OPEN' && trade.strategyTag !== undefined && tags.includes(trade.strategyTag));
}

export function buildQqqPcsReplayDailySignalHistory(
  trace: readonly BacktestTraceEntry[] | undefined,
  replayVariant: QqqPcsHistoricalReplayVariant = 'v1_2_6_r',
  strategyTagOverride?: SellerOpportunityBacktestStrategyTagFilter,
): QqqPcsReplayDailySignal[] {
  const strategyTag = strategyTagOverride ?? qqqPcsReplayStrategyTags(replayVariant);
  return (trace ?? []).map((entry) => {
    const tags = Array.isArray(strategyTag) ? strategyTag : [strategyTag];
    const admission = entry.overlay?.strategyAdmissions
      ?.filter((candidate) => tags.includes(candidate.strategyTag))
      .sort((left, right) => Number(right.eligibility === 'OPEN') - Number(left.eligibility === 'OPEN'))[0];
    if (admission) {
      return {
        date: entry.date,
        strategy: admission.strategyLabel,
        eligibility: admission.eligibility,
        reasons: admission.reasons,
        gates: admission.gates,
      };
    }
    const vix = traceNumber(entry, 'pcs_replay_vix');
    const vix3m = traceNumber(entry, 'pcs_replay_vix3m');
    const evaluation = explainReactivePcsTiming({
      symbol: 'QQQ', regime: entry.marketState.regime, crisisPhase: entry.marketState.crisisPhase, vix, vix3m,
    });
    const missing = [vix === null ? 'VIX' : null, vix3m === null ? 'VIX3M' : null].filter(Boolean).join(' / ');
    const gates: QqqPcsReplayDailySignal['gates'] = [
      { label: '标的范围', status: 'PASS', detail: 'QQQ（独立 PCS 回放固定标的）' },
      { label: 'VIX 区间', status: vix === null ? 'UNAVAILABLE' : evaluation.reasonCodes.includes('VIX_OUT_OF_RANGE') ? 'BLOCK' : 'PASS', detail: vix === null ? '同日 VIX 缺失' : `VIX ${vix.toFixed(2)}（要求 14–28）` },
      { label: '风险偏好', status: evaluation.reasonCodes.includes('REGIME_DISALLOWED') ? 'BLOCK' : 'PASS', detail: `市场状态 ${entry.marketState.regime}` },
      { label: '危机过滤', status: evaluation.reasonCodes.includes('CRISIS_PHASE') ? 'BLOCK' : 'PASS', detail: `危机阶段 ${entry.marketState.crisisPhase ?? 'NONE'}` },
      { label: '期限结构', status: vix === null || vix3m === null ? 'UNAVAILABLE' : evaluation.reasonCodes.includes('BACKWARDATED_TERM') ? 'BLOCK' : 'PASS', detail: vix === null || vix3m === null ? '同日 VIX / VIX3M 缺失' : `VIX / VIX3M ${(vix / vix3m).toFixed(3)}（要求 < 1）` },
    ];
    if (vix === null || vix3m === null) return { date: entry.date, eligibility: 'UNAVAILABLE', reasons: [`回测 trace 缺少 Reactive PCS 的 ${missing} 同日收盘`], gates };
    if (!evaluation.eligible) {
      return {
        date: entry.date,
        eligibility: 'BLOCK',
        reasons: evaluation.reasonCodes.map((code) => replayReasonText[code]),
        gates,
      };
    }
    if (!hasReplayCandidate(entry, strategyTag)) {
      return { date: entry.date, eligibility: 'BLOCK', reasons: ['回测 trace 未记录所选 PCS 配置的候选'], gates };
    }
    return {
      date: entry.date,
      eligibility: 'OPEN',
      reasons: ['回测 trace 记录所选 PCS 配置的候选；按下一交易日执行。'],
      gates,
    };
  });
}

export { buildQqqPcsHistoricalBacktestSpec } from './QqqPcsBacktestSpec';
