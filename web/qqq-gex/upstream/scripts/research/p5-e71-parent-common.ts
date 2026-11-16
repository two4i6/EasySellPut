/** Shared research-only P5.E71 parent. */
import { admission, childOptions, type Row } from './p4-e370-research-common';
import { p5e68Parent } from './p5-e68-parent-common';

const stateName = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
export const p5e71Sequence = (row: Row) => row.history.length >= 3 ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(stateName).join(' -> ') : 'NA';
export const p5e71Parent = (row: Row) => p5e68Parent(row) || p5e71Sequence(row) === 'RISK_ON_EXTENDED/CURRENT -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02' || p5e71Sequence(row) === 'RANGE_BOUND/SR01 -> RANGE_BOUND/SR01 -> RISK_ON_WEAKENING/SR01';
export const p5e71Options = { ...childOptions, additionalAdmission: admission(p5e71Parent) };
