/** EB7.E16 research-only ultrafine defensive coefficient child of EB7.E15. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E15DynamicReplayWithData,
  QQQ_EB7_E15_REPLAY_VERSION,
  type QqqEb7E15DynamicReplay,
} from './QqqEb7E15DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E16_REPLAY_VERSION = 'eb7-e16-macro-defensive-coefficient-0p935-current-bar-v1' as const;
export const EB7_E16_MACRO_RULE = 'E15 rule unchanged; favorable: regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; upMultiplier=1.041; downMultiplier=0.935' as const;

const E16_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.041,
    equityBoostMacroRiskDownMultiplier: .935,
  },
} as const;

export type QqqEb7E16DynamicReplay = Omit<QqqEb7E15DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E16';
  parentId: 'EB7.E15';
  replayVersion: typeof QQQ_EB7_E16_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E15_REPLAY_VERSION;
  macroOptions: typeof E16_OPTIONS;
  audit: Omit<QqqEb7E15DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E15DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E16_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E16DynamicReplayOptions = Readonly<{
  referenceCooldownMode?: QqqEb7DynamicReplayOptions['referenceCooldownMode'];
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  ratioMin?: number;
  ratioMax?: number;
  unifiedVixMultiplier?: QqqEb7DynamicReplayOptions['unifiedVixMultiplier'];
  lowVixOnlyMultiplier?: QqqEb7DynamicReplayOptions['lowVixOnlyMultiplier'];
  excludedPreE235RuleIds?: QqqEb7DynamicReplayOptions['excludedPreE235RuleIds'];
  dteMode?: QqqEb7DynamicReplayOptions['dteMode'];
  widthMode?: QqqEb7DynamicReplayOptions['widthMode'];
  widthVxnThreshold?: number;
  widthLowVxnTargetPct?: number;
  widthHighVxnTargetPct?: number;
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
  canonicalOptionSignalStartDate?: QqqEb7DynamicReplayOptions['canonicalOptionSignalStartDate'];
  canonicalOptionSignalTapeShared?: QqqEb7DynamicReplayOptions['canonicalOptionSignalTapeShared'];
}>;

export async function buildQqqEb7E16DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E16DynamicReplayOptions = {},
): Promise<QqqEb7E16DynamicReplay> {
  const parent = await buildQqqEb7E15DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E16_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E16',
    parentId: 'EB7.E15',
    replayVersion: QQQ_EB7_E16_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E15_REPLAY_VERSION,
    macroOptions: E16_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E15DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E16_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
