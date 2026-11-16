/** P6.E222: E220 exact-ledger parent with the simplest tested E200 floor (.15). */
import { admission, f, type Row } from './p4-e370-research-common';
import { p6e0Options } from './p6-e0-parent-common';
import { p6e84BullQualityVeto } from './p6-e84-parent-common';
import { p6e106RangePressure } from './p6-e106-parent-common';
import { p6e122PositiveGuard } from './p6-e132-parent-common';
import { p6e220Admission, p6e220Options } from './p6-e220-parent-common';

export const p6e222RangeFloor = .15;

/** Keep E0/E84/E106/E122 protection and canonicalize E200's range20d floor. */
export const p6e222UnifiedReject = (row: Row) =>
  p6e0Options.additionalReject?.(row) === true
  || p6e84BullQualityVeto(row)
  || p6e106RangePressure(row)
  || p6e122PositiveGuard(row)
  || (f(row.market.roc5) < 0 && f(row.market.range20dPct) >= p6e222RangeFloor && f(row.market.vix) <= 22.25);

export const p6e222Options = {
  ...p6e220Options,
  additionalAdmission: admission(p6e220Admission),
  additionalReject: p6e222UnifiedReject,
};
