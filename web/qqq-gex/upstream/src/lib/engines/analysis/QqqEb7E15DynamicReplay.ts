/** EB7.E15 research-only fine defensive coefficient child of EB7.E14. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E14DynamicReplayWithData,
  QQQ_EB7_E14_REPLAY_VERSION,
  type QqqEb7E14DynamicReplay,
} from './QqqEb7E14DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E15_REPLAY_VERSION = 'eb7-e15-macro-defensive-coefficient-0p93-current-bar-v1' as const;
export const EB7_E15_MACRO_RULE = 'E14 rule unchanged; favorable: regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; upMultiplier=1.041; downMultiplier=0.93' as const;

const E15_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.041,
    equityBoostMacroRiskDownMultiplier: .93,
  },
} as const;

export type QqqEb7E15DynamicReplay = Omit<QqqEb7E14DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E15';
  parentId: 'EB7.E14';
  replayVersion: typeof QQQ_EB7_E15_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E14_REPLAY_VERSION;
  macroOptions: typeof E15_OPTIONS;
  audit: Omit<QqqEb7E14DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E14DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E15_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E15DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

export async function buildQqqEb7E15DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E15DynamicReplayOptions = {},
): Promise<QqqEb7E15DynamicReplay> {
  const parent = await buildQqqEb7E14DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E15_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E15',
    parentId: 'EB7.E14',
    replayVersion: QQQ_EB7_E15_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E14_REPLAY_VERSION,
    macroOptions: E15_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E14DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E15_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
