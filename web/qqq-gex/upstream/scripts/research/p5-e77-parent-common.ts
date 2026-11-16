/** Shared research-only P5.E77 parent with its profitable replacement seam. */
import { admission, childOptions, f, type Row } from './p4-e370-research-common';
import { p5e74Parent } from './p5-e74-parent-common';

const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3 ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ') : 'NA';
export const p5e77Sequence = 'RISK_ON_EXTENDED/SR01 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02';
export const p5e77Parent = (row: Row) => p5e74Parent(row) || (sequence(row) === p5e77Sequence && f(row.market.vix) < 14);
export const p5e77Options = { ...childOptions, additionalAdmission: admission(p5e77Parent) };
