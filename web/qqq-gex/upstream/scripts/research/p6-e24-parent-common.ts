/** P6.E24 shared parent: P6.E22 with the objective RV scope aligned to .43. */
import { p6e22Options } from './p6-e22-parent-common';

export const p6e24Options = {
  ...p6e22Options,
  selectionOverrides: {
    ...p6e22Options.selectionOverrides,
    pcsSurvivalSelectionObjectiveRv20Min: .43,
  },
};
