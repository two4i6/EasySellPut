/** EB7.E13 research-only single-parameter child of EB7.E12. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E12DynamicReplayWithData,
  QQQ_EB7_E12_REPLAY_VERSION,
  type QqqEb7E12DynamicReplay,
} from './QqqEb7E12DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E13_REPLAY_VERSION = 'eb7-e13-macro-coefficient-1p041-current-bar-v1' as const;
export const EB7_E13_MACRO_RULE = 'E12 rule unchanged; favorable: regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; upMultiplier=1.041; downMultiplier=0.75' as const;

const E13_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.041,
    equityBoostMacroRiskDownMultiplier: .75,
  },
} as const;

export type QqqEb7E13DynamicReplay = Omit<QqqEb7E12DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E13';
  parentId: 'EB7.E12';
  replayVersion: typeof QQQ_EB7_E13_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E12_REPLAY_VERSION;
  macroOptions: typeof E13_OPTIONS;
  audit: Omit<QqqEb7E12DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E12DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E13_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E13DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

export async function buildQqqEb7E13DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E13DynamicReplayOptions = {},
): Promise<QqqEb7E13DynamicReplay> {
  const parent = await buildQqqEb7E12DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E13_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E13',
    parentId: 'EB7.E12',
    replayVersion: QQQ_EB7_E13_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E12_REPLAY_VERSION,
    macroOptions: E13_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E12DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E13_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
