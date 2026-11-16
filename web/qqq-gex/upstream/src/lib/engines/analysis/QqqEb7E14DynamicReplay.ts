/** EB7.E14 research-only defensive coefficient child of EB7.E13. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E13DynamicReplayWithData,
  QQQ_EB7_E13_REPLAY_VERSION,
  type QqqEb7E13DynamicReplay,
} from './QqqEb7E13DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E14_REPLAY_VERSION = 'eb7-e14-macro-defensive-coefficient-0p90-current-bar-v1' as const;
export const EB7_E14_MACRO_RULE = 'E13 rule unchanged; favorable: regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; upMultiplier=1.041; downMultiplier=0.90' as const;

const E14_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.041,
    equityBoostMacroRiskDownMultiplier: .90,
  },
} as const;

export type QqqEb7E14DynamicReplay = Omit<QqqEb7E13DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E14';
  parentId: 'EB7.E13';
  replayVersion: typeof QQQ_EB7_E14_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E13_REPLAY_VERSION;
  macroOptions: typeof E14_OPTIONS;
  audit: Omit<QqqEb7E13DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E13DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E14_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E14DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

export async function buildQqqEb7E14DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E14DynamicReplayOptions = {},
): Promise<QqqEb7E14DynamicReplay> {
  const parent = await buildQqqEb7E13DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E14_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E14',
    parentId: 'EB7.E13',
    replayVersion: QQQ_EB7_E14_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E13_REPLAY_VERSION,
    macroOptions: E14_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E13DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E14_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
