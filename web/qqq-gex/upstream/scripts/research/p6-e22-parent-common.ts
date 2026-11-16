/** P6.E22 shared parent: P6.E17 with an exact-parity simplified objective scope. */
import { p6e17Options } from './p6-e17-parent-common';

export const p6e22Options = {
  ...p6e17Options,
  selectionOverrides: {
    ...p6e17Options.selectionOverrides,
    pcsSurvivalSelectionObjective: 'risk_efficiency' as const,
    pcsSurvivalSelectionObjectiveRegime: 'BULL' as const,
    pcsSurvivalSelectionObjectiveSlowSubregime: 'SR01' as const,
    pcsSurvivalSelectionObjectiveAdxMin: undefined,
    pcsSurvivalSelectionObjectiveRv20Min: .45,
  },
};
