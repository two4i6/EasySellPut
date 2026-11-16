/** Shared research-only P5.E123 parent: P5.E94 plus the minimal selector relaxation. */
import { admission, childOptions, type Row } from './p4-e370-research-common';
import { p5e94Parent } from './p5-e94-parent-common';

export const P5_E123_TAIL_VETO_RATIO = .762 as const;
export const p5e123Parent = p5e94Parent;
export const p5e123Options = {
  ...childOptions,
  additionalAdmission: admission(p5e123Parent),
  selectionOverrides: { pcsSurvivalSelectionStressTailVetoRatio: P5_E123_TAIL_VETO_RATIO },
};
export const p5e123Admission = (extra: (row: Row) => boolean) => admission(row => p5e123Parent(row) || extra(row));
