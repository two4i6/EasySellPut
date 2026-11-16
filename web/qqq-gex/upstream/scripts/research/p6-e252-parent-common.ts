/** P6.E252: best discovered admissible global-width child, based on simplified E246. */
import { p6e246Options } from './p6-e246-parent-common';
export const p6e252WidthPct=.0661;
export const p6e252Options={...p6e246Options,contractOverrides:{...p6e246Options.contractOverrides,pcsSpreadWidthPct:p6e252WidthPct}};
