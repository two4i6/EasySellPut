/** EB7.E156: one fixed macro-budget transfer selected from the E155 frontier. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E148DynamicReplayWithData,
  QQQ_EB7_E148_REPLAY_VERSION,
  type QqqEb7E148DynamicReplay,
  type QqqEb7E148DynamicReplayOptions,
} from './QqqEb7E148DynamicReplay';

export const QQQ_EB7_E156_REPLAY_VERSION = 'eb7-e156-e148-fixed-19-to-1-macro-transfer-0p036-current-bar-v1' as const;
export const EB7_E156_PARENT = 'EB7.E148' as const;
export const EB7_E156_DOSE = .036 as const;
export const EB7_E156_MAINUP_MULTIPLIER = 2.196 as const;
export const EB7_E156_NEUTRAL_SR02_MID_VIX_MULTIPLIER = 2.055 as const;
export const EB7_E156_MACRO_RULE =
  'Keep E148 current-bar admission and other macro coefficients unchanged; transfer one fixed scalar dose .036 at 19:1 from BULL/NEUTRAL/SR02 non-low-VIX (2.091→2.055) to main-up (1.512→2.196).' as const;

const E156_OVERRIDES = {
  equityBoostMacroRiskUpMultiplier: EB7_E156_MAINUP_MULTIPLIER,
  equityBoostMacroRiskBullNeutralSr02Multiplier: EB7_E156_NEUTRAL_SR02_MID_VIX_MULTIPLIER,
} as const;

export type QqqEb7E156DynamicReplay = Omit<
  QqqEb7E148DynamicReplay,
  'candidateId' | 'parentId' | 'parentReplayVersion' | 'replayVersion' | 'macroOptions' | 'audit'
> & {
  candidateId: 'EB7.E156';
  parentId: typeof EB7_E156_PARENT;
  parentReplayVersion: typeof QQQ_EB7_E148_REPLAY_VERSION;
  replayVersion: typeof QQQ_EB7_E156_REPLAY_VERSION;
  macroOptions: { executionOverrides: typeof E156_OVERRIDES };
  audit: Omit<QqqEb7E148DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E148DynamicReplayWithData';
    macroCurrentBar: true;
    macroRule: typeof EB7_E156_MACRO_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E156DynamicReplayOptions = Omit<QqqEb7E148DynamicReplayOptions, 'executionOverrides'>;

export async function buildQqqEb7E156DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E156DynamicReplayOptions = {},
): Promise<QqqEb7E156DynamicReplay> {
  const replay = await buildQqqEb7E148DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    executionOverrides: E156_OVERRIDES,
  });
  return {
    ...replay,
    candidateId: 'EB7.E156',
    parentId: EB7_E156_PARENT,
    parentReplayVersion: QQQ_EB7_E148_REPLAY_VERSION,
    replayVersion: QQQ_EB7_E156_REPLAY_VERSION,
    macroOptions: { executionOverrides: E156_OVERRIDES },
    audit: {
      ...replay.audit,
      parentBuilder: 'buildQqqEb7E148DynamicReplayWithData',
      macroCurrentBar: true,
      macroRule: EB7_E156_MACRO_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
