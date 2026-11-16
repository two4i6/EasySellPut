/** Shared research-only P5.E74 parent. */
import { admission, childOptions, f, type Row } from './p4-e370-research-common';
import { p5e71Parent } from './p5-e71-parent-common';

const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3
  ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ')
  : 'NA';
const exact = (name: string, guard: (row: Row) => boolean) => (row: Row) => sequence(row) === name && guard(row);
const adx12 = (row: Row) => f(row.market.adx14) < 12;
const vixChangeUp = (row: Row) => f(row.market.vixChange5d) >= 0;
const rsi50 = (row: Row) => f(row.market.rsi14) >= 50;
const rv50 = (row: Row) => f(row.market.tqqqRealisedVol20d) >= .5;
const roc5neg = (row: Row) => f(row.market.roc5) < 0;

export const p5e74Pockets = [
  exact('RANGE_BOUND/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02', rsi50),
  exact('BULL/SR01 -> BULL/SR01 -> BULL/SR02', vixChangeUp),
  exact('BULL/SR01 -> BULL/SR01 -> RISK_ON_EXTENDED/SR01', rv50),
  exact('BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02', roc5neg),
  exact('BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> BULL/SR02', adx12),
  exact('RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02 -> BULL/SR02', adx12),
  exact('RANGE_BOUND/SR02 -> BULL/SR02 -> BULL/SR02', vixChangeUp),
  exact('RANGE_BOUND/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02', adx12),
];

export const p5e74Parent = (row: Row) => p5e71Parent(row) || p5e74Pockets.some(test => test(row));
export const p5e74Options = { ...childOptions, additionalAdmission: admission(p5e74Parent) };
