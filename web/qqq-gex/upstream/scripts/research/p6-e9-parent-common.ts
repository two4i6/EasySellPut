/** P6.E9 shared parent: P6.E6 current-bar quality veto with risk-efficiency selector. */
import { p6e6Options } from './p6-e6-parent-common';

export const p6e9Options = {
  ...p6e6Options,
  selectionOverrides: {
    ...p6e6Options.selectionOverrides,
    pcsSurvivalSelectionObjective: 'risk_efficiency' as const,
  },
};
