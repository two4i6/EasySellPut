/** Shared research-only P5.E87 parent: E86 plus the three E85 transition pockets. */
import { f, type Row } from './p4-e370-research-common';
import { p5e86Parent } from './p5-e86-parent-common';

const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3 ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ') : 'NA';
const bullToExtended = 'BULL/SR02 -> BULL/SR02 -> RISK_ON_EXTENDED/SR02';
const bullToRange = 'BULL/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02';
const extendedToBull = 'RISK_ON_EXTENDED/SR02 -> BULL/SR02 -> BULL/SR02';

export const p5e87Pocket2 = (row: Row) => sequence(row) === bullToExtended && f(row.market.priceExtensionAtr) >= 2 && f(row.market.vixChange5d) < 0;
export const p5e87Pocket4 = (row: Row) => sequence(row) === bullToRange && f(row.market.adx14) < 12 && f(row.market.vix) < 14;
export const p5e87Pocket6 = (row: Row) => sequence(row) === extendedToBull && f(row.market.adx14) < 12 && f(row.market.vix) < 14;
export const p5e87Parent = (row: Row) => p5e86Parent(row) || p5e87Pocket2(row) || p5e87Pocket4(row) || p5e87Pocket6(row);
