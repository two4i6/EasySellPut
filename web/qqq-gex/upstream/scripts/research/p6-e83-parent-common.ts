/** P6.E83 shared parent: E73 plus the independently audited RANGE pressure branch and width. */
import type { QqqP4DynamicRow } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { p6e73Options } from './p6-e73-parent-common';

export const p6e83RangePressure = (row: QqqP4DynamicRow) =>
  row.market.regime === 'RANGE_BOUND'
  && row.market.slowSubregime === 'SR01'
  && Number.isFinite(row.market.vix)
  && row.market.vix! >= 20.5
  && Number.isFinite(row.market.roc5)
  && row.market.roc5! < 0;

export const p6e83Options = {
  ...p6e73Options,
  contractOverrides: {
    ...p6e73Options.contractOverrides,
    pcsSpreadWidthPct: .0442,
  },
  additionalReject: (row: QqqP4DynamicRow) =>
    p6e73Options.additionalReject?.(row) === true || p6e83RangePressure(row),
};
