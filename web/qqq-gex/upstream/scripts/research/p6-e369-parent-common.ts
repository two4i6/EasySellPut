/** P6.E369 canonical current-bar veto and parameters for follow-up research. */
import type { QqqP4DynamicRow } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { isQqqP4E68MergedCurrentBarReject, isQqqP4E104RecoveryCurrentBar } from '../../src/lib/engines/analysis/QqqP4DynamicReplay';
import { p6e84BullQualityVeto } from './p6-e84-parent-common';
import { p6e122PositiveGuard } from './p6-e132-parent-common';
import { p6e222RangeFloor } from './p6-e222-parent-common';
import { f, type Row } from './p4-e370-research-common';
import { p6e284Options } from './p6-e284-parent-common';

const e369RangeSr01NegativeRoc = (row: Row) => row.market.regime === 'RANGE_BOUND'
  && row.market.slowSubregime === 'SR01' && Number.isFinite(row.market.roc5) && f(row.market.roc5) < 0;

export const p6e369RangePressureReject = (row: Row) => {
  if (!e369RangeSr01NegativeRoc(row) || !Number.isFinite(row.market.vix)) return false;
  const vix = f(row.market.vix), extension = f(row.market.priceExtensionAtr), term = f(row.market.vixTermStructureSlope);
  if (vix >= 26) return true;
  if (vix < 20.75) return false;
  if (vix < 22.5) return !Number.isFinite(extension) || (extension >= 0 && (!Number.isFinite(term) || term < 1));
  return !Number.isFinite(extension) || !Number.isFinite(term) || extension >= .5 || term < 1;
};

export const p6e369Reject = (row: QqqP4DynamicRow) =>
  (isQqqP4E68MergedCurrentBarReject(row) && !isQqqP4E104RecoveryCurrentBar(row))
  || p6e84BullQualityVeto(row)
  || p6e369RangePressureReject(row)
  || (p6e122PositiveGuard(row) && f(row.market.vixTermStructureSlope) >= 3)
  || (f(row.market.roc5) < 0 && f(row.market.range20dPct) >= p6e222RangeFloor && f(row.market.vix) <= 22.25);

export const p6e369Options = {
  ...p6e284Options,
  widthBySlowSubregime: { SR01: .08197, SR02: .0661 },
  selectionOverrides: { ...p6e284Options.selectionOverrides,
    pcsSurvivalSelectionSurvivalWeight: .803, pcsSurvivalSelectionWilsonWeight: .075 },
  additionalReject: p6e369Reject,
};
