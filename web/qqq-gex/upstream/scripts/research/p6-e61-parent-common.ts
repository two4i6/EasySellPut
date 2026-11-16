/** P6.E61 shared parent: exact-parity unified SR01 quality/pressure veto. */
import { f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e24Options } from './p6-e24-parent-common';

/** One current-bar veto replaces two repeated SR01 layers without changing behavior. */
export const p6e61UnifiedVeto = (row: Row) => {
  if (row.market.slowSubregime !== 'SR01') return false;
  if (row.market.regime === 'BULL') {
    return f(row.market.adx14) < 15
      && f(row.market.roc20) < 0
      && f(row.market.tqqqRealisedVol20d) >= .43
      && f(row.market.tqqqRealisedVol20d) < .60;
  }
  return row.market.regime === 'RANGE_BOUND'
    && f(row.market.vix) >= 22
    && f(row.market.vixTermStructureSlope) < 0;
};

const inheritedReject = p6e0Options.additionalReject;
export const p6e61Options = {
  ...p6e24Options,
  contractOverrides: {
    ...(p6e24Options.contractOverrides ?? {}),
    pcsSpreadWidthPct: .04342,
  },
  additionalReject: (row: Row) => inheritedReject?.(row) === true || p6e61UnifiedVeto(row),
};
