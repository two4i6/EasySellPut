/** Shared pure spec factory. Moved unchanged from QqqPcsHistoricalBacktest;
 * diagnostics and live GEX are not runtime dependencies of a source contract.
 */
import { buildSellerOpportunityBacktestSpec } from './SellerOpportunityBacktest';
import type { QqqPcsHistoricalBacktestOptions } from './QqqPcsHistoricalBacktest';
import type { BacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
type QqqPcsHistoricalBacktestSpec = BacktestRunSpec
  & Required<Pick<BacktestRunSpec, 'config' | 'strategyOverrides'>>;

export const QQQ_BASS2_1_1_PCS_WIDTH_PCT = 0.0275;
export const QQQ_BASS2_1_2_PCS_WIDTH_PCT = 0.03;
export const QQQ_BASS2_2_1_PCS_WIDTH_PCT = 0.03;
export const QQQ_BASS2_3_1_PCS_WIDTH_PCT = 0.03;
export const QQQ_BASS2_3_2_PCS_WIDTH_PCT = QQQ_BASS2_3_1_PCS_WIDTH_PCT;
export const QQQ_BASS2_3_3_PCS_WIDTH_PCT = QQQ_BASS2_3_2_PCS_WIDTH_PCT;
export const QQQ_V1_1_PCS_WIDTH_PCT = 0.0225;
export const QQQ_V1_2_PCS_WIDTH_PCT = QQQ_V1_1_PCS_WIDTH_PCT;
export const QQQ_V1_2_3_PCS_WIDTH_PCT = 0.025;
export const QQQ_V1_2_4_PCS_WIDTH_PCT = 0.03;
export const QQQ_V1_2_5_PCS_WIDTH_PCT = QQQ_V1_2_4_PCS_WIDTH_PCT;
export const QQQ_V1_2_6_PCS_WIDTH_PCT = QQQ_V1_2_5_PCS_WIDTH_PCT;

/** 固定 QQQ PCS 的独立单笔研究口径；不接受 symbol、gate 或仓位模式。 */
export function buildQqqPcsHistoricalBacktestSpec(options: QqqPcsHistoricalBacktestOptions): QqqPcsHistoricalBacktestSpec {
  if (options.replayVariant === 'e1_p0_r2') {
    throw new Error('e1_p0_r2 必须使用 QqqE1P0R2Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb2_p2_r5') {
    throw new Error('eb2_p2_r5 必须使用 QqqEb2P2R5Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb6_p4e0_r7') {
    throw new Error('eb6_p4e0_r7 必须使用 QqqEb6P4E0R7Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb7_p5_r8') {
    throw new Error('eb7_p5_r8 必须使用 QqqEb7P5R8Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb7_p6_r9') {
    throw new Error('eb7_p6_r9 必须使用 QqqEb7P6R9Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb6_p6_r9') {
    throw new Error('eb6_p6_r9 必须使用 QqqEb6E209P6E385R9E226Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  if (options.replayVariant === 'eb7_e209_p6_e385_r9_e226') {
    throw new Error('eb7_e209_p6_e385_r9_e226 必须使用 QqqEb7E209P6E385R9E226Replay 专用共享执行器，不能作为单 spec 历史回放构建。');
  }
  const spec = buildSellerOpportunityBacktestSpec(
    'QQQ',
    'reactive_pcs_v1',
    options.startDate,
    options.endDate,
    options.strikeMode,
    options.exitMode,
    'independent',
    'QQQ_PUT_CREDIT_SPREAD',
    undefined,
    'QQQ',
  );
  const config = spec.config ?? {};
  // Public PCS defaults are selected at the API/UI boundaries; direct
  // research callers may still omit the variant intentionally.
  const replayVariant = options.replayVariant;
  const gate = options.pcsConcurrencyGate ?? 'off';
  const cooldownDays = options.pcsCooldownTradingDays ?? 3;
  const isBass211 = replayVariant === 'bass2_1_1';
  const isBass212 = replayVariant === 'bass2_1_2';
  const isBass221 = replayVariant === 'bass2_2_1';
  const isBass231 = replayVariant === 'bass2_3_1';
  const isBass232 = replayVariant === 'bass2_3_2';
  const isBass232Candidate3 = replayVariant === 'bass2_3_2_candidate3';
  const isBass233 = replayVariant === 'bass2_3_3';
  const isBass23Replay = isBass231 || isBass232 || isBass232Candidate3 || isBass233;
  const isV11 = replayVariant === 'v1_1';
  const isV12 = replayVariant === 'v1_2';
  const isV121 = replayVariant === 'v1_2_1';
  const isV122 = replayVariant === 'v1_2_2';
  const isV123 = replayVariant === 'v1_2_3';
  const isV124 = replayVariant === 'v1_2_4';
  const isV125 = replayVariant === 'v1_2_5';
  const isV126R = replayVariant === 'v1_2_6_r';
  const isV126 = replayVariant === 'v1_2_6' || isV126R;
  const isV127A = replayVariant === 'v1_2_7_a' || replayVariant === 'v1_2_7';
  const isV127B = replayVariant === 'v1_2_7_b';
  const isV127 = isV127A || isV127B;
  const isSimple5Replay = isV121 || isV122;
  const isBassReplay = isBass211 || isBass212 || isBass221 || isBass23Replay;
  const priceSelectionMode = isBassReplay
    ? 'survival_only' as const
    : isV11 || isV12 || isSimple5Replay || isV123 || isV124 || isV125 || isV126 || isV127
      ? 'survival_only' as const
    : replayVariant === 'dynamic_v1'
      ? 'off' as const
      : replayVariant === 'survival_only'
        ? 'survival_only' as const
        : options.priceSelectionMode ?? 'survival_only';
  const isManagedReplay = isBassReplay || isV11 || isV12 || isSimple5Replay || isV123 || isV124 || isV125 || isV126 || isV127;
  const selectionFloor = isManagedReplay ? 0.30 : options.survivalSelectionFloor ?? 0.4;
  const selectionObjective = isManagedReplay ? 'survival_adjusted_expected_pnl' as const : options.survivalSelectionObjective ?? 'survival_adjusted_expected_pnl';
  const selectionSurvivalWeight = isManagedReplay ? 0.75 : options.survivalSelectionSurvivalWeight ?? 1;
  const selectionWilsonWeight = isManagedReplay ? 0.50 : options.survivalSelectionWilsonWeight ?? 0.5;
  const selectionDteMode = isManagedReplay ? 'fixed' as const : options.survivalSelectionDteMode ?? 'fixed';
  const selectionWidthMode = isManagedReplay ? 'fixed' as const : options.survivalSelectionWidthMode ?? 'fixed';
  const selectionSigmaMode = isManagedReplay ? 'stress_only_dynamic_v1' as const : options.survivalSelectionSigmaMode ?? (priceSelectionMode === 'dynamic_v1_survival' ? 'dynamic_v1' : 'full');
  return {
    ...spec,
    config: {
      ...config,
      trace: true,
      ...(isV125 || isV126 || isV127 ? { canonicalPcsCandidate2Gate: true } : {}),
      optionsBacktestPositionMode: { ...config.optionsBacktestPositionMode, pcs: 'independent', ...(isBassReplay ? { eb: 'independent' as const } : {}) },
    },
    strategyOverrides: {
      ...spec.strategyOverrides,
      ...(isBassReplay ? {
        enablePCS: true,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: isBass212 || isBass221 || isBass23Replay ? QQQ_BASS2_1_2_PCS_WIDTH_PCT : QQQ_BASS2_1_1_PCS_WIDTH_PCT,
        pcsExcludeRiskOnWeakening: true,
        ...(isBass212 ? { pcsChopVixGate: true } : {}),
        ...(isBass221 || isBass23Replay ? { pcsBass221Gate: true } : {}),
        ...(isBass221 || isBass23Replay ? { equityBoostBass221Gate: true } : {}),
        ...(isBass221 || isBass23Replay ? {
          equityBoostBass221VixReboundGate: true,
          equityBoostBass221SeverityMultiplier: .5,
        } : {}),
        ...(isBass231 ? {
          // bass2.3.1 专属 PCS：沿用当前 v1.2.2 的 A9+B30+C10 链，
          // 仅保留 bass 的 3.00% 宽度；压力分层仓位在选价配置末端固定。
          pcsExcludeRiskOnWeakening: false,
          pcsV11Gate: true,
        } : {}),
        ...(isBass232 || isBass232Candidate3 || isBass233 ? {
          // bass2.3.2/2.3.3：候选2/候选3 PCS；保留 bass2.3.1 的 EB 候选6-MDD规则。
          pcsExcludeRiskOnWeakening: false,
          pcsBass221Gate: false,
          pcsV11Gate: false,
          pcsBass232Candidate2Gate: isBass232,
          pcsBass232Candidate3Gate: isBass232Candidate3 || isBass233,
          ...(isBass233 ? { pcsV11ReleaseMode: 'sr02_adx20' as const } : {}),
        } : {}),
        enableEquityBoostPCS: true,
        equityBoostEntryMode: 'continuous' as const,
        equityBoostDteMode: 'risk_adaptive_hysteresis_v1' as const,
        equityBoostTargetDte: 35 as const,
        equityBoostDynamicDteVxnThreshold: 22,
        equityBoostDynamicDteRecoveryVxnThreshold: 21,
        equityBoostDynamicDteMinHighRiskDays: 5,
        equityBoostExcludeRangeBoundSr02: true,
        equityBoostExcludeRiskOnExtendedSr01: true,
        equityBoostExcludeSidewaysSr01: true,
        equityBoostPriceVsSma200Ceiling: 0.1275,
        equityBoostVxnCeiling: 24,
        equityBoostRiskOnWeakeningSr01VxnVixRatioCeiling: 1.30,
        equityBoostRiskOnWeakeningSr01RequireVxn10dRising: true,
        ...(isBass23Replay ? {
          // 候选6-MDD：在候选6-R1-40-lite的 EB 规则上，增加
          // “已实现回撤>$9k 且 RV20≥50% 时降至40%”的外层预算。
          equityBoostCandidate6Mdd: true,
          equityBoostWidthMode: 'risk_adaptive_v1' as const,
          equityBoostDynamicDteVxnThreshold: 24,
          equityBoostDynamicDteRecoveryVxnThreshold: 21,
          equityBoostDynamicWidthVxnThreshold: 24,
          equityBoostDynamicWidthLowVxnTargetPct: .04,
          equityBoostDynamicWidthHighVxnTargetPct: .04,
          equityBoostRatioMin: .6,
          equityBoostRatioMax: 1.4,
        } : {}),
      } : {}),
      ...(isV11 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_1_PCS_WIDTH_PCT,
        pcsExcludeRiskOnWeakening: false,
        pcsBass221Gate: true,
        pcsV11Gate: true,
      } : {}),
      ...(isV12 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_PCS_WIDTH_PCT,
      } : {}),
      ...(isSimple5Replay ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_PCS_WIDTH_PCT,
        pcsBass221Gate: true,
        pcsV11Gate: true,
      } : {}),
      ...(isV123 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_3_PCS_WIDTH_PCT,
        pcsBass221Gate: false,
        pcsV11Gate: false,
      } : {}),
      ...(isV124 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_4_PCS_WIDTH_PCT,
        pcsBass221Gate: false,
        pcsV11Gate: false,
        pcsBass232Candidate2Gate: true,
      } : {}),
      ...(isV125 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_5_PCS_WIDTH_PCT,
        pcsExcludeRiskOnWeakening: false,
        pcsBass221Gate: false,
        pcsV11Gate: false,
        pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' as const,
        pcsV12Gate: false,
        pcsV121Gate: true,
        pcsV122Gate: false,
        pcsV123Gate: true,
        pcsV123B30ReleaseLower: .38,
        pcsBass232Candidate2Gate: false,
        pcsBass232Candidate3Gate: false,
      } : {}),
      ...(isV126 ? {
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_6_PCS_WIDTH_PCT,
        pcsExcludeRiskOnWeakening: false,
        pcsBass221Gate: false,
        pcsV11Gate: false,
        pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' as const,
        pcsV12Gate: false,
        pcsV121Gate: true,
        pcsV122Gate: false,
        pcsV123Gate: true,
        pcsV123B30ReleaseLower: .38,
        pcsBass232Candidate2Gate: false,
        pcsBass232Candidate3Gate: false,
        pcsResearchProfile: 'candidate3' as const,
        pcsCandidate3ExtraRelease: 'bull_sr02_rv_adx' as const,
      } : {}),
      ...(isV127 ? {
        // v1.2.7a 保留旧 P0；v1.2.7b/P0 使用单次 Candidate A + 倒挂 rescue 准入。
        enablePCS: true,
        enableEquityBoostPCS: false,
        pcsTargetDte: 35,
        pcsSpreadWidthPct: QQQ_V1_2_6_PCS_WIDTH_PCT,
        pcsExcludeRiskOnWeakening: false,
        pcsBass221Gate: false,
        pcsV11Gate: false,
        pcsV11ReleaseMode: 'rv20_lt_067_or_sr02_adx20' as const,
        pcsV12Gate: false,
        pcsV121Gate: true,
        pcsV122Gate: false,
        pcsV123Gate: true,
        pcsV123B30ReleaseLower: .38,
        pcsBass232Candidate2Gate: false,
        pcsBass232Candidate3Gate: false,
        pcsResearchProfile: isV127B ? 'candidateARescue' as const : 'candidateA' as const,
        pcsCandidate3ExtraRelease: isV127B ? 'off' as const : 'bull_sr02_rv_adx' as const,
        pcsRiskEnvelopeMode: 'candidate4_v1' as const,
        pcsRiskEnvelopeProfile: 'candidate4_full_only_v1' as const,
        pcsResearchSafetyOverride: 'allow_backwardation_only' as const,
      } : {}),
      ...(isV126R ? {
        // V1.2.6-R：保留已验证的 v14-W3.25 PCS_RESCUE；不启用 EB。
        pcsRescueEnabled: true,
        pcsRescueEntryMode: 'reactive_soft_pool' as const,
        pcsRescueRegimeScope: 'selective_quality_v14' as const,
        pcsRescueDeltaMode: 'state_adaptive_quality_v5' as const,
        pcsRescueExtremeDelta: .2425,
        pcsRescueExtremeBaseDelta: .20,
        pcsRescueExtremeFallbackDelta: .18,
        pcsRescueNormalDelta: .075,
        pcsRescueCalmDelta: .10,
        pcsRescuePressureDelta: .025,
        pcsRescueWidthPct: .02,
        pcsRescueExtremeWidthPct: .0325,
        pcsRescueTargetDte: 35,
        pcsRescueRiskBudgetNav: .005,
      } : {}),
      // Explicitly pin every historical variant so adding the production V1.2.7b/P0
      // default cannot silently change legacy replay results.
      pcsV12Gate: isV12,
      pcsV121Gate: isSimple5Replay || isV123 || isV124 || isV125 || isV126 || isV127 || isBass231 || isBass232 || isBass232Candidate3 || isBass233,
      pcsV122Gate: isV122 || isBass231,
      pcsV123Gate: isV123 || isV124 || isV125 || isV126 || isV127 || isBass232 || isBass232Candidate3 || isBass233,
      pcsRescueEnabled: isV126R,
      ...(options.contractProfile ? { pcsContractProfile: options.contractProfile } : {}),
      // Make the historical replay explicit so an intentional legacy `off`
      // request overrides the shared production candidate.
      pcsSurvivalPriceSelectionMode: priceSelectionMode,
      ...(gate === 'maxOpen1' ? { pcsMaxOpenPositions: 1 } : {}),
      ...(gate === 'cooldownDays' ? { pcsStreakCooldownTradingDays: cooldownDays } : {}),
      ...(options.survivalExitMode && options.survivalExitMode !== 'off'
        ? {
          // 生存率臂必须与原有概率参考线退出解耦，避免结果无法归因。
          pcsProbabilityReferenceExitMode: 'hold_to_expiry' as const,
          pcsSurvivalExitMode: options.survivalExitMode,
          pcsSurvivalFloor: options.survivalFloor ?? 0.4,
          pcsSurvivalDrop: options.survivalDrop ?? 0.2,
          pcsSurvivalTouchConfirmation: options.survivalTouchConfirmation ?? 'intraday_touch',
          pcsSurvivalTouchBufferPct: options.survivalTouchBufferPct ?? .005,
          ...(options.survivalTouchVixThreshold != null ? { pcsSurvivalTouchVixThreshold: options.survivalTouchVixThreshold } : {}),
        }
        : {}),
      ...(priceSelectionMode !== 'off'
        ? {
          // 选价实验必须隔离路径退出；否则无法判断收益来自更远短腿还是提前平仓。
          pcsProbabilityReferenceExitMode: 'hold_to_expiry' as const,
          pcsSurvivalExitMode: 'off' as const,
          pcsSurvivalPriceSelectionMode: priceSelectionMode,
          pcsSurvivalSelectionFloor: selectionFloor,
          ...(options.survivalSelectionStressFloor !== undefined ? { pcsSurvivalSelectionStressFloor: options.survivalSelectionStressFloor } : {}),
          pcsSurvivalSelectionObjective: selectionObjective,
          pcsSurvivalSelectionSurvivalWeight: selectionSurvivalWeight,
          pcsSurvivalSelectionWilsonWeight: selectionWilsonWeight,
          pcsSurvivalSelectionMaxConditionalLossRatio: options.survivalSelectionMaxConditionalLossRatio,
          pcsSurvivalSelectionStressTailVetoRatio: options.survivalSelectionStressTailVetoRatio,
          pcsSurvivalSelectionTailWidthTriggerRatio: options.survivalSelectionTailWidthTriggerRatio,
          pcsSurvivalSelectionWidthBlend: options.survivalSelectionWidthBlend,
          pcsSurvivalSelectionWidthConfirmDays: options.survivalSelectionWidthConfirmDays,
          pcsSurvivalSelectionWidthSwitchMargin: options.survivalSelectionWidthSwitchMargin,
          pcsSurvivalSelectionWidthDeltaPnlFloor: options.survivalSelectionWidthDeltaPnlFloor,
          pcsSurvivalSelectionWidthTailImprovementMargin: options.survivalSelectionWidthTailImprovementMargin,
          pcsSurvivalSelectionCreditRetentionFloor: options.survivalSelectionCreditRetentionFloor,
          ...(options.survivalSelectionStressWeight !== undefined ? { pcsSurvivalSelectionStressWeight: options.survivalSelectionStressWeight } : {}),
          pcsSurvivalSelectionDteMode: selectionDteMode,
          pcsSurvivalSelectionWidthMode: selectionWidthMode,
          pcsSurvivalSelectionSigmaMode: selectionSigmaMode,
          pcsPressureSizingMode: isBass231 ? 'state_v1' as const : isBass232 ? 'off' as const : options.pressureSizingMode ?? 'off',
          pcsPressureSizingMediumMultiplier: isBass231 ? .75 : options.pressureSizingMediumMultiplier,
          pcsPressureSizingStressedMultiplier: isBass231 ? .50 : options.pressureSizingStressedMultiplier,
          pcsContractProfile: priceSelectionMode === 'dynamic_v1_survival' ? 'dynamic-v1' as const : undefined,
        }
        : {}),
    },
  };
}

