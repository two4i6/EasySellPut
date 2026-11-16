/** P6.E73 parent: P6.E61 with the exact-audited RV20 selector boundary at .38. */
import { p6e61Options } from './p6-e61-parent-common';

export const p6e73Options = {
  ...p6e61Options,
  selectionOverrides: {
    ...p6e61Options.selectionOverrides,
    pcsSurvivalSelectionObjectiveRv20Min: .38,
  },
};
