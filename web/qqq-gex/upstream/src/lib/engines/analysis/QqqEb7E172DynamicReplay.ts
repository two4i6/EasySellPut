/** EB7.E172: one symmetric ratio-band widening over the registered E156 execution. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E156DynamicReplayWithData,
  QQQ_EB7_E156_REPLAY_VERSION,
  type QqqEb7E156DynamicReplay,
  type QqqEb7E156DynamicReplayOptions,
} from './QqqEb7E156DynamicReplay';

export const QQQ_EB7_E172_REPLAY_VERSION = 'eb7-e172-e156-symmetric-ratio-band-0p55-current-bar-v1' as const;
export const EB7_E172_PARENT = 'EB7.E156' as const;
export const EB7_E172_RATIO_MIN = .325 as const;
export const EB7_E172_RATIO_MAX = 1.425 as const;
export const EB7_E172_RULE = 'Keep E156 admission and macro budget; set current-bar credit/max-loss ratio band to [.325,1.425] using one symmetric half-width .55 around midpoint .875.' as const;

export type QqqEb7E172DynamicReplay = Omit<
  QqqEb7E156DynamicReplay,
  'candidateId' | 'parentId' | 'parentReplayVersion' | 'replayVersion' | 'audit'
> & {
  candidateId: 'EB7.E172';
  parentId: typeof EB7_E172_PARENT;
  parentReplayVersion: typeof QQQ_EB7_E156_REPLAY_VERSION;
  replayVersion: typeof QQQ_EB7_E172_REPLAY_VERSION;
  audit: Omit<QqqEb7E156DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E156DynamicReplayWithData';
    ratioBandCurrentBar: true;
    macroRule: typeof EB7_E172_RULE;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E172DynamicReplayOptions = Omit<QqqEb7E156DynamicReplayOptions, 'ratioMin' | 'ratioMax'>;

export async function buildQqqEb7E172DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E172DynamicReplayOptions = {},
): Promise<QqqEb7E172DynamicReplay> {
  const replay = await buildQqqEb7E156DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    ratioMin: EB7_E172_RATIO_MIN,
    ratioMax: EB7_E172_RATIO_MAX,
  });
  return {
    ...replay,
    candidateId: 'EB7.E172',
    parentId: EB7_E172_PARENT,
    parentReplayVersion: QQQ_EB7_E156_REPLAY_VERSION,
    replayVersion: QQQ_EB7_E172_REPLAY_VERSION,
    audit: {
      ...replay.audit,
      parentBuilder: 'buildQqqEb7E156DynamicReplayWithData',
      ratioBandCurrentBar: true,
      macroRule: EB7_E172_RULE,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
