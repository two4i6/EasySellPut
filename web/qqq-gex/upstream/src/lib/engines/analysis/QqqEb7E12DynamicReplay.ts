/** EB7.E12 research-only macro simplification child of EB7.E11. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E11DynamicReplayWithData,
  QQQ_EB7_E11_REPLAY_VERSION,
  type QqqEb7E11DynamicReplay,
} from './QqqEb7E11DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E12_REPLAY_VERSION = 'eb7-e12-macro-bull-weakening-neutral-tilt-current-bar-v1' as const;
export const EB7_E12_MACRO_RULE = 'favorable: regime=BULL OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; defensive: regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT' as const;

const E12_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.04,
    equityBoostMacroRiskDownMultiplier: .75,
  },
} as const;

export type QqqEb7E12DynamicReplay = Omit<QqqEb7E11DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E12';
  parentId: 'EB7.E11';
  replayVersion: typeof QQQ_EB7_E12_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E11_REPLAY_VERSION;
  macroOptions: typeof E12_OPTIONS;
  audit: Omit<QqqEb7E11DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E11DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E12_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E12DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

export async function buildQqqEb7E12DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E12DynamicReplayOptions = {},
): Promise<QqqEb7E12DynamicReplay> {
  const parent = await buildQqqEb7E11DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E12_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E12',
    parentId: 'EB7.E11',
    replayVersion: QQQ_EB7_E12_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E11_REPLAY_VERSION,
    macroOptions: E12_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E11DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E12_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
