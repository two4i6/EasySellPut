/** EB7.E175: collapse E172's VXN width split into one VXN-independent target. */
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import {
  buildQqqEb7E172DynamicReplayWithData,
  QQQ_EB7_E172_REPLAY_VERSION,
  type QqqEb7E172DynamicReplay,
  type QqqEb7E172DynamicReplayOptions,
} from './QqqEb7E172DynamicReplay';

export const QQQ_EB7_E175_REPLAY_VERSION = 'eb7-e175-e172-fixed-width-target-0p0625-current-bar-v1' as const;
export const EB7_E175_PARENT = 'EB7.E172' as const;
export const EB7_E175_WIDTH_TARGET_PCT = .0625 as const;
export const EB7_E175_SIMPLIFICATION = 'Replace risk_adaptive_v1 low/high VXN width selection with fixed_target_v1 at 6.25%; all other E172 logic unchanged.' as const;

export type QqqEb7E175DynamicReplay = Omit<
  QqqEb7E172DynamicReplay,
  'candidateId' | 'parentId' | 'parentReplayVersion' | 'replayVersion' | 'audit'
> & {
  candidateId: 'EB7.E175';
  parentId: typeof EB7_E175_PARENT;
  parentReplayVersion: typeof QQQ_EB7_E172_REPLAY_VERSION;
  replayVersion: typeof QQQ_EB7_E175_REPLAY_VERSION;
  audit: Omit<QqqEb7E172DynamicReplay['audit'], 'parentBuilder' | 'macroRule'> & {
    parentBuilder: 'buildQqqEb7E172DynamicReplayWithData';
    macroRule: typeof EB7_E175_SIMPLIFICATION;
    widthTargetIndependentOfVxn: true;
    admissionUnchanged: true;
    noDateWhitelist: true;
    noFrozenTape: true;
    noWrapperTimeGate: true;
  };
};

export type QqqEb7E175DynamicReplayOptions = Omit<
  QqqEb7E172DynamicReplayOptions,
  'widthMode' | 'widthVxnThreshold' | 'widthLowVxnTargetPct' | 'widthHighVxnTargetPct'
>;

export async function buildQqqEb7E175DynamicReplayWithData(
  startDate: string,
  endDate: string,
  data: MarketDataSet,
  options: QqqEb7E175DynamicReplayOptions = {},
): Promise<QqqEb7E175DynamicReplay> {
  const replay = await buildQqqEb7E172DynamicReplayWithData(startDate, endDate, data, {
    ...options,
    widthMode: 'fixed_target_v1',
    widthLowVxnTargetPct: EB7_E175_WIDTH_TARGET_PCT,
  });
  return {
    ...replay,
    candidateId: 'EB7.E175',
    parentId: EB7_E175_PARENT,
    parentReplayVersion: QQQ_EB7_E172_REPLAY_VERSION,
    replayVersion: QQQ_EB7_E175_REPLAY_VERSION,
    audit: {
      ...replay.audit,
      parentBuilder: 'buildQqqEb7E172DynamicReplayWithData',
      macroRule: EB7_E175_SIMPLIFICATION,
      widthTargetIndependentOfVxn: true,
      admissionUnchanged: true,
      noDateWhitelist: true,
      noFrozenTape: true,
      noWrapperTimeGate: true,
    },
  };
}
