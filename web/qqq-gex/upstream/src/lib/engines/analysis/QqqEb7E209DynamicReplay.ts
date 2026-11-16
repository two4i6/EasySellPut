/** EB7.E209: the research-validated E207/E148 current-bar child. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E148DynamicReplayWithData,
  QQQ_EB7_E148_REPLAY_VERSION,
  type QqqEb7E148DynamicReplay,
  type QqqEb7E148DynamicReplayOptions,
} from './QqqEb7E148DynamicReplay';
import type { QqqEb7DynamicReplayOptions } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E209_REPLAY_VERSION = 'eb7-e209-e207-profit-target-0p225-current-bar-v1' as const;
export const EB7_E209_PARENT = 'EB7.E207' as const;
export const EB7_E209_PROFIT_TARGET = .225 as const;
export const EB7_E209_RATIO_MIN = .325 as const;
export const EB7_E209_RATIO_MAX = 1.425 as const;
export const EB7_E209_UNIFIED_VIX_MULTIPLIER = 2.85 as const;
export const EB7_E209_WIDTH_TARGET_PCT = .0625 as const;
export const EB7_E209_MACRO_RULE =
  'Keep the E207/E148 current-bar admission and fixed 6.25% width; use ratio=[.325,1.425], unified VIX multiplier=2.85, profit target=.225, up multiplier=2.196, and bull-neutral SR02 multiplier=2.055.' as const;

const E209_OVERRIDES = {
  equityBoostMacroRiskUpMultiplier: 2.196,
  equityBoostMacroRiskBullNeutralSr02Multiplier: 2.055,
  equityBoostProfitTarget: EB7_E209_PROFIT_TARGET,
} as const;

export type QqqEb7E209DynamicReplayOptions = Omit<QqqEb7E148DynamicReplayOptions, 'executionOverrides'> & Pick<
  QqqEb7DynamicReplayOptions,
  'canonicalOptionSignalTapeMode' | 'canonicalOptionSignalStartDate' | 'canonicalOptionSignalTapeShared'
>;

export type QqqEb7E209DynamicReplay = Omit<
  QqqEb7E148DynamicReplay,
  'candidateId' | 'parentId' | 'parentReplayVersion' | 'replayVersion' | 'macroOptions' | 'audit'
> & {
  candidateId: 'EB7.E209';
  parentId: typeof EB7_E209_PARENT;
  parentReplayVersion: typeof QQQ_EB7_E148_REPLAY_VERSION;
  replayVersion: typeof QQQ_EB7_E209_REPLAY_VERSION;
  macroOptions: { executionOverrides: typeof E209_OVERRIDES };
  audit: Omit<QqqEb7E148DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E148DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E209_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

/**
 * Build the same E209 path used by the validated research replay. All
 * admission and execution decisions remain current-bar evaluations over the
 * complete supplied snapshot; no signal-date pool is projected here.
 */
export async function buildQqqEb7E209DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E209DynamicReplayOptions = {},
): Promise<QqqEb7E209DynamicReplay> {
  const replay = await buildQqqEb7E148DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    // The composite session is optimized for the newer E175 path. E209's
    // validated E148 lineage must retain its independent current-bar session;
    // passing the shared session makes an older upstream arm materialize a
    // canonical option tape and breaks the current-bar contract.
    execution: undefined,
    ratioMin: EB7_E209_RATIO_MIN,
    ratioMax: EB7_E209_RATIO_MAX,
    unifiedVixMultiplier: EB7_E209_UNIFIED_VIX_MULTIPLIER,
    widthMode: 'fixed_target_v1',
    widthLowVxnTargetPct: EB7_E209_WIDTH_TARGET_PCT,
    executionOverrides: E209_OVERRIDES,
  });
  return {
    ...replay,
    candidateId: 'EB7.E209',
    parentId: EB7_E209_PARENT,
    parentReplayVersion: QQQ_EB7_E148_REPLAY_VERSION,
    replayVersion: QQQ_EB7_E209_REPLAY_VERSION,
    macroOptions: { executionOverrides: E209_OVERRIDES },
    audit: {
      ...replay.audit,
      parentBuilder: 'buildQqqEb7E148DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E209_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
