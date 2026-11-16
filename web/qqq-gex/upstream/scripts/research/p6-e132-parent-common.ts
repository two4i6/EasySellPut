/** Shared research parents for the P6.E122 → P6.E132 selector-weight branch. */
import { p6e106Options } from './p6-e106-parent-common';
import { f, type Row } from './p4-e370-research-common';

export const p6e122PositiveGuard = (row: Row) =>
  f(row.market.tqqqRealisedVol20d) >= .95
  && f(row.market.roc20) >= .04
  && f(row.market.range20dPct) >= .13;

export const p6e122Options = {
  ...p6e106Options,
  contractOverrides: { ...p6e106Options.contractOverrides, pcsSpreadWidthPct: .0487 },
  additionalReject: (row: Row) => p6e106Options.additionalReject?.(row) === true || p6e122PositiveGuard(row),
};

export const p6e132Options = {
  ...p6e122Options,
  selectionOverrides: {
    ...p6e122Options.selectionOverrides,
    pcsSurvivalSelectionSurvivalWeight: .81,
    pcsSurvivalSelectionWilsonWeight: .2,
  },
};
