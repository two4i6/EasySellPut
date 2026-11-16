/** Shared research-only P5.E173 parent: P5.E123 with one global main-PCS width. */
import { p5e123Options } from './p5-e123-parent-common';

export const P5_E173_SPREAD_WIDTH_PCT = .04303 as const;
export const p5e173Parent = p5e123Options;
export const p5e173Options = {
  ...p5e123Options,
  contractOverrides: {
    pcsTargetDte: 35,
    pcsSpreadWidthPct: P5_E173_SPREAD_WIDTH_PCT,
  },
};
