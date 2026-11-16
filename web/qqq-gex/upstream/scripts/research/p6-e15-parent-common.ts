/** P6.E15 shared parent: P6.E11 with a wider, exact-parity RV quality band. */
import { f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e11Options } from './p6-e11-parent-common';

export const p6e15RvBandVeto = (row: Row) => row.market.regime === 'BULL'
  && row.market.slowSubregime === 'SR01'
  && f(row.market.adx14) < 15
  && f(row.market.roc20) < 0
  && f(row.market.tqqqRealisedVol20d) >= .45
  && f(row.market.tqqqRealisedVol20d) < .60;

const inheritedReject = p6e0Options.additionalReject;
export const p6e15Options = {
  ...p6e11Options,
  additionalReject: (row: Row) => inheritedReject?.(row) === true || p6e15RvBandVeto(row),
};
