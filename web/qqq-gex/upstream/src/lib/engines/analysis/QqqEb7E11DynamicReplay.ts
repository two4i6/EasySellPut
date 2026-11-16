/** EB7.E11 research-only macro child of EB7.E10. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E10DynamicReplayWithData,
  QQQ_EB7_E10_REPLAY_VERSION,
  type QqqEb7E10DynamicReplay,
} from './QqqEb7E10DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E11_REPLAY_VERSION = 'eb7-e11-macro-bull-lowvix-weakening-neutral-tilt-current-bar-v1' as const;
export const EB7_E11_MACRO_RULE = 'favorable: (regime=BULL AND VIX<22) OR (regime=RISK_ON_WEAKENING AND trend=NEUTRAL), except defensive CURRENT; defensive: regime=RISK_ON_WEAKENING AND trend=NEUTRAL AND slowSubregime=CURRENT' as const;

const E11_OPTIONS = {
  executionOverrides: {
    equityBoostMacroRiskMode: 'macro_bull_lowvix_weakening_neutral_tilt_v1' as const,
    equityBoostMacroRiskUpMultiplier: 1.04,
    equityBoostMacroRiskDownMultiplier: .75,
  },
} as const;

export type QqqEb7E11DynamicReplay = Omit<QqqEb7E10DynamicReplay, 'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'audit'> & {
  candidateId: 'EB7.E11';
  parentId: 'EB7.E10';
  replayVersion: typeof QQQ_EB7_E11_REPLAY_VERSION;
  parentReplayVersion: typeof QQQ_EB7_E10_REPLAY_VERSION;
  macroOptions: typeof E11_OPTIONS;
  audit: Omit<QqqEb7E10DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E10DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E11_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E11DynamicReplayOptions = Readonly<{
  executionOverrides?: QqqEb7DynamicReplayOptions['executionOverrides'];
  execution?: QqqEb7DynamicReplayOptions['execution'];
  profiler?: QqqEb7DynamicReplayOptions['profiler'];
  highRecoveryTrace?: boolean;
  lowRecoveryTrace?: boolean;
  intermediateRecoveryTrace?: boolean;
  skipIntermediateMtm?: boolean;
}>;

/**
 * Replays the registered EB7.E10 chain and changes only its macro risk
 * surface. Admission, cycle construction, settlement, and MTM accounting
 * remain inherited from the current-bar parent.
 */
export async function buildQqqEb7E11DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E11DynamicReplayOptions = {},
): Promise<QqqEb7E11DynamicReplay> {
  const parent = await buildQqqEb7E10DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: {
      ...E11_OPTIONS.executionOverrides,
      ...options.executionOverrides,
    },
  });
  return {
    ...parent,
    candidateId: 'EB7.E11',
    parentId: 'EB7.E10',
    replayVersion: QQQ_EB7_E11_REPLAY_VERSION,
    parentReplayVersion: QQQ_EB7_E10_REPLAY_VERSION,
    macroOptions: E11_OPTIONS,
    audit: {
      ...parent.audit,
      parentBuilder: 'buildQqqEb7E10DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E11_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
