/** Shared research-only P5.E86 parent: P5.E82 plus the E85/E86 RW continuation pocket. */
import { admission, childOptions, f, type Row } from './p4-e370-research-common';
import { p5e82Parent } from './p5-e82-parent-common';

const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3 ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ') : 'NA';
const rwSequence = 'RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02';

export const p5e86RwPocket = (row: Row) => sequence(row) === rwSequence && f(row.market.vix) >= 16 && f(row.market.vixTermStructureSlope) < 3;
export const p5e86Parent = (row: Row) => p5e82Parent(row) || p5e86RwPocket(row);
export const p5e86Options = { ...childOptions, additionalAdmission: admission(p5e86Parent) };
