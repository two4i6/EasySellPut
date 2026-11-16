/** P6.E6 research parent: survival-adjusted objective with one broad current-bar RV quality veto. */
import { f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';

/**
 * Keep the quality veto broad and state-local. It is evaluated on the current
 * bar and composes with the inherited P6.E0 reject; it never uses dates or
 * realized future outcomes.
 */
export const p6e6RvBandVeto = (row: Row) => row.market.regime === 'BULL'
  && row.market.slowSubregime === 'SR01'
  && f(row.market.adx14) < 15
  && f(row.market.roc20) < 0
  && f(row.market.tqqqRealisedVol20d) >= .45
  && f(row.market.tqqqRealisedVol20d) < .55;

const inheritedReject = p6e0Options.additionalReject;
export const p6e6Options = {
  ...p6e0Options,
  selectionOverrides: {
    ...p6e0Options.selectionOverrides,
    pcsSurvivalSelectionObjective: 'survival_adjusted_expected_pnl' as const,
  },
  additionalReject: (row: Row) => inheritedReject?.(row) === true || p6e6RvBandVeto(row),
};
