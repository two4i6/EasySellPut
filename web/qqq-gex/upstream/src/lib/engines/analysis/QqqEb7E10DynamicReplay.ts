/** EB7.E10 research-only macro current-bar child builder. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E8DynamicReplayWithData,
  QQQ_EB7_E8_REPLAY_VERSION,
  type QqqEb7E8DynamicReplay,
} from './QqqEb7E8DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E10_REPLAY_VERSION = 'eb7-e10-macro-bull-lowvix-weakening-tilt-current-bar-v1' as const;
export const EB7_E10_MACRO_RULE = 'favorable: regime=BULL AND VIX<22; defensive: regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT' as const;

const E10_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_lowvix_weakening_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.04,
    equityBoostMacroRiskDownMultiplier: .75,
  },
} as const;

export type QqqEb7E10DynamicReplay = Omit<QqqEb7E8DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'audit'> & {
  candidateId: 'EB7.E10';
  parentId: 'EB7.E8';
  replayVersion: typeof QQQ_EB7_E10_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E8_REPLAY_VERSION;
  macroOptions: typeof E10_OPTIONS;
  audit: Omit<QqqEb7E8DynamicReplay['audit'], 'parentBuilder'> & {
    parentBuilder: 'buildQqqEb7E8DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E10_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E10DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

/**
 * Replays the full EB7.E8 current-bar chain, then applies only E10's
 * current-bar macro risk tilt through the shared dynamic execution seam.
 * The default production/research parent is never mutated.
 */
export async function buildQqqEb7E10DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E10DynamicReplayOptions = {},
): Promise<QqqEb7E10DynamicReplay> {
  const parent = await buildQqqEb7E8DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E10_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E10',
    parentId: 'EB7.E8',
    replayVersion: QQQ_EB7_E10_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E8_REPLAY_VERSION,
    macroOptions: E10_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E8DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E10_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
