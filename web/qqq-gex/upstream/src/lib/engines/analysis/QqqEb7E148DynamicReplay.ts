/** EB7.E148: replace the E147 receiver boost with one main-up bucket coefficient. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E16DynamicReplayWithData,
  type QqqEb7E16DynamicReplay,
  type QqqEb7E16DynamicReplayOptions,
} from './QqqEb7E16DynamicReplay';
import { computeQqqEb7MtmMdd } from './QqqEb7DynamicReplay';

export const QQQ_EB7_E148_REPLAY_VERSION = 'eb7-e148-e147-mainup-single-bucket-1p512-current-bar-v1' as const;
export const EB7_E148_PARENT = 'EB7.E147' as const;
export const EB7_E148_SOURCE = 'EB7.E145→E146→E147→E148' as const;
export const EB7_E148_DOSE = .18 as const;
export const EB7_E148_MAINUP_MULTIPLIER = 1.512 as const;
export const EB7_E148_MACRO_RULE =
  'Keep E135 admission and every E135 macro multiplier unchanged except main-up multiplier=1.332+.18=1.512; replace E147 low-VIX neutral receiver boost with this single current-bar coefficient.' as const;

const E148_OVERRIDES = {
  equityBoostMacroRiskMode: 'macro_bull_neutral_weakening_range_neutral_bear_sr01_split_budget_v1' as const,
  equityBoostMacroRiskUpMultiplier: EB7_E148_MAINUP_MULTIPLIER,
  equityBoostMacroRiskRangeMultiplier: 1.5,
  equityBoostMacroRiskDownMultiplier: .63455,
  equityBoostMacroRiskBullNeutralSr01Multiplier: .7403,
  equityBoostMacroRiskBullNeutralSr02Multiplier: 2.091,
  equityBoostMacroRiskBullNeutralSr02LowVixMultiplier: 3.1507,
  equityBoostMacroRiskBullSr02BullTrendMultiplier: 1.4,
  equityBoostMacroRiskVixLowMultiplier: 3.197,
  equityBoostMacroRiskExtendedSr02LowVixMultiplier: 2.937,
  equityBoostMacroRiskVixMidMultiplier: .3409,
  equityBoostMacroRiskVixHighMultiplier: 1,
} as const;

export type QqqEb7E148DynamicReplay = Omit<
  QqqEb7E16DynamicReplay,
  'candidateId' | 'parentId' | 'replayVersion' | 'parentReplayVersion' | 'macroOptions' | 'metrics' | 'audit'
> & {
  candidateId: 'EB7.E148';
  parentId: typeof EB7_E148_PARENT;
  replayVersion: typeof QQQ_EB7_E148_REPLAY_VERSION;
  macroOptions: { executionOverrides: typeof E148_OVERRIDES };
  metrics: QqqEb7E16DynamicReplay['metrics'];
  audit: Omit<QqqEb7E16DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E16DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E148_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E148DynamicReplayOptions = Omit<QqqEb7E16DynamicReplayOptions, 'executionOverrides'> & {
  /** Research-only child seam; omitted overrides preserve the registered E148 coefficients exactly. */
  executionOverrides?: QqqEb7E16DynamicReplayOptions['executionOverrides'];
};

export async function buildQqqEb7E148DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E148DynamicReplayOptions = {},
): Promise<QqqEb7E148DynamicReplay> {
  const replay = await buildQqqEb7E16DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: { ...E148_OVERRIDES, ...options.executionOverrides },
  });
  const mtmMdd = computeQqqEb7MtmMdd(replay.cycles, data, startDate, replay.resolvedEndDate, { applyRiskMultiplierToMtm: true });
  return {
    ...replay,
    candidateId: 'EB7.E148',
    parentId: EB7_E148_PARENT,
    replayVersion: QQQ_EB7_E148_REPLAY_VERSION,
    macroOptions: { executionOverrides: E148_OVERRIDES },
    metrics: { ...replay.metrics, mtmMdd },
    audit: {
      ...replay.audit,
      parentBuilder: 'buildQqqEb7E16DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E148_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
