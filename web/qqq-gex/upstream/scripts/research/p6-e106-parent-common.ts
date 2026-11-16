/** P6.E106 shared research parent: E84 compact rule with audited width/VIX floor. */
import type { QqqP4DynamicRow } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e84BullQualityVeto, p6e84Options } from './p6-e84-parent-common';

export const p6e106RangePressure = (row: QqqP4DynamicRow) =>
  row.market.regime === 'RANGE_BOUND'
  && row.market.slowSubregime === 'SR01'
  && Number.isFinite(row.market.vix)
  && row.market.vix! >= 20.75
  && Number.isFinite(row.market.roc5)
  && row.market.roc5! < 0;

export const p6e106Options = {
  ...p6e84Options,
  contractOverrides: {
    ...p6e84Options.contractOverrides,
    pcsSpreadWidthPct: .0479,
  },
  additionalReject: (row: QqqP4DynamicRow) =>
    p6e0Options.additionalReject?.(row) === true
    || p6e84BullQualityVeto(row)
    || p6e106RangePressure(row),
};
