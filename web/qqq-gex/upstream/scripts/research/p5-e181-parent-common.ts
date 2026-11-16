/** Shared research-only P5.E181 parent: P5.E173 with one global Wilson weight. */
import { p5e173Options } from './p5-e173-parent-common';

export const P5_E181_WILSON_WEIGHT = .15 as const;
export const p5e181Parent = p5e173Options;
export const p5e181Options = {
  ...p5e173Options,
  selectionOverrides: {
    ...p5e173Options.selectionOverrides,
    pcsSurvivalSelectionSurvivalWeight: .825,
    pcsSurvivalSelectionWilsonWeight: P5_E181_WILSON_WEIGHT,
  },
};
