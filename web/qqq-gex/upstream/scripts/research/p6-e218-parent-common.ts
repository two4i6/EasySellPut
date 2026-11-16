/** P6.E218: E210 behavior-preserving compression of reject inheritance and stable floor. */
import { admission, f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e11Parent } from './p6-e11-parent-common';
import { p6e84BullQualityVeto } from './p6-e84-parent-common';
import { p6e106RangePressure } from './p6-e106-parent-common';
import { p6e122PositiveGuard, p6e132Options } from './p6-e132-parent-common';

/** E212 showed .14–.1545 produce E210's exact ledger; use the round .14 boundary. */
export const P6_E218_RANGE20_FLOOR = .14;
export const p6e218E200Veto = (row: Row) =>
  f(row.market.roc5) < 0
  && f(row.market.range20dPct) >= P6_E218_RANGE20_FLOOR
  && f(row.market.vix) <= 22.25;

/** Collapse the inherited veto chain into one current-bar predicate, preserving its clauses. */
export const p6e218UnifiedReject = (row: Row) =>
  p6e0Options.additionalReject?.(row) === true
  || p6e84BullQualityVeto(row)
  || p6e106RangePressure(row)
  || p6e122PositiveGuard(row)
  || p6e218E200Veto(row);

/** Keep the complete E210 admission union; only its historical option layers are flattened. */
export const p6e218Options = {
  ...p6e132Options,
  contractOverrides: { ...p6e132Options.contractOverrides, pcsSpreadWidthPct: .05 },
  selectionOverrides: {
    ...p6e132Options.selectionOverrides,
    pcsSurvivalSelectionSurvivalWeight: .81,
    pcsSurvivalSelectionWilsonWeight: .075,
  },
  additionalAdmission: admission(p6e11Parent),
  additionalReject: p6e218UnifiedReject,
};
