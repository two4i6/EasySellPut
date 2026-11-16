/** P6.E84 shared parent: simplified E83 veto, verified exact ledger parity. */
import type { QqqP4DynamicRow } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e83Options, p6e83RangePressure } from './p6-e83-parent-common';
import { f, type Row } from './p4-e370-research-common';

export const p6e84BullQualityVeto = (row: Row) =>
  row.market.slowSubregime === 'SR01'
  && row.market.regime === 'BULL'
  && f(row.market.adx14) < 15
  && f(row.market.roc20) < 0
  && f(row.market.tqqqRealisedVol20d) >= .43
  && f(row.market.tqqqRealisedVol20d) < .60;

export const p6e84Options = {
  ...p6e83Options,
  additionalReject: (row: QqqP4DynamicRow) =>
    p6e0Options.additionalReject?.(row) === true
    || p6e84BullQualityVeto(row)
    || p6e83RangePressure(row),
};
