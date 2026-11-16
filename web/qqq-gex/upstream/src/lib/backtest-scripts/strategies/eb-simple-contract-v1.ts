/** Untuned baseline: one source, one integer spread, no regime-specific sizing. */
import {freezeStrategyData} from '../strategy-module-v2';
export const EB_SIMPLE_NATIVE_POLICY=freezeStrategyData({replayVariant:'v1_2_6' as const});
export const EB_SIMPLE_PARAMS=freezeStrategyData({
  lineage:['EB.SIMPLE'],targetDte:35,widthTargetPct:.03,maxShortDistancePct:.005,
  quantity:1,maxOpenPositions:1,profitTarget:.5,stopLossCreditMultiple:1,
});
