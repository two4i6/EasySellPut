/** P6.E284: simplified E246/E252 rules, 6.61% base width, and current-bar SR01 width 8.00%. */
import { p6e252Options } from './p6-e252-parent-common';

export const p6e284Sr01WidthPct = .08;
export const p6e284Options = {
  ...p6e252Options,
  widthBySlowSubregime: { SR01: p6e284Sr01WidthPct },
};
