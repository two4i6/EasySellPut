/** P6.E11 shared parent: P6.E9 with the proven-redundant rangePocket removed. */
import { admission, type Row } from './p4-e370-research-common';
import {
  p5e213E65Grouped,
  p5e213E68Grouped,
  p5e213E71,
  p5e213E74Grouped,
  p5e213E77,
  p5e213E86,
  p5e213E87Grouped,
  p5e213E94,
} from './p5-e213-semantic-compact-parent-common';
import { p6e9Options } from './p6-e9-parent-common';

export const p6e11Parent = (row: Row) => p5e213E65Grouped(row)
  || p5e213E68Grouped(row)
  || p5e213E71(row)
  || p5e213E74Grouped(row)
  || p5e213E77(row)
  || p5e213E86(row)
  || p5e213E87Grouped(row)
  || p5e213E94(row);

export const p6e11Options = {
  ...p6e9Options,
  additionalAdmission: admission(p6e11Parent),
};
