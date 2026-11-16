/** P6.E220: E218 exact-ledger child with one empirically redundant E65 leaf term removed. */
import { admission, f, type Row } from './p4-e370-research-common';
import {
  p5e213E65Grouped, p5e213E68Grouped, p5e213E71, p5e213E74Grouped,
  p5e213E77, p5e213E86, p5e213E87Grouped, p5e213E94,
} from './p5-e213-semantic-compact-parent-common';
import { p6e218Options } from './p6-e218-parent-common';

/** Remove only RANGE_BOUND/SR01's `ADX<15 && RV20>=.5` OR term. */
export const p6e220E65Grouped = (row: Row) => {
  if (row.market.regime !== 'RANGE_BOUND' || row.market.slowSubregime !== 'SR01') return p5e213E65Grouped(row);
  const roc20 = f(row.market.roc20);
  const slope20 = f(row.market.sma20SlopePct);
  const vix = f(row.market.vix);
  const adx = f(row.market.adx14);
  const range20 = f(row.market.range20dPct);
  const roc5 = f(row.market.roc5);
  return (roc20 >= -.02 && slope20 < 0 && vix < 17)
    || (adx < 15 && range20 >= .06)
    || (roc5 >= .01 && roc20 < 0);
};

export const p6e220Admission = (row: Row) => p6e220E65Grouped(row)
  || p5e213E68Grouped(row)
  || p5e213E71(row)
  || p5e213E74Grouped(row)
  || p5e213E77(row)
  || p5e213E86(row)
  || p5e213E87Grouped(row)
  || p5e213E94(row);

export const p6e220Options = {
  ...p6e218Options,
  additionalAdmission: admission(p6e220Admission),
};
