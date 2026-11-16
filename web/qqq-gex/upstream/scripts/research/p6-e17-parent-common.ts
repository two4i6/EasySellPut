/** P6.E17 shared parent: P6.E15 with the wider exact-parity RV band [0.43, 0.60). */
import { f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e15Options } from './p6-e15-parent-common';

export const p6e17RvBandVeto = (row: Row) => row.market.regime === 'BULL'
  && row.market.slowSubregime === 'SR01'
  && f(row.market.adx14) < 15
  && f(row.market.roc20) < 0
  && f(row.market.tqqqRealisedVol20d) >= .43
  && f(row.market.tqqqRealisedVol20d) < .60;

const inheritedReject = p6e0Options.additionalReject;
export const p6e17Options = {
  ...p6e15Options,
  additionalReject: (row: Row) => inheritedReject?.(row) === true || p6e17RvBandVeto(row),
};
