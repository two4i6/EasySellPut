/** Shared research-only P5.E94 parent, single-snapshot simplified union. */
import { f, type Row } from './p4-e370-research-common';
import { p5e87Parent } from './p5-e87-parent-common';

const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3 ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ') : 'NA';
const crisisWeakSequence = 'CRISIS/SR02 -> RISK_ON_WEAKENING/SR01 -> RISK_ON_WEAKENING/SR01';
const extPocket = (row: Row) => row.market.regime === 'RISK_ON_EXTENDED' && row.market.slowSubregime === 'SR02' && f(row.market.vix) >= 18 && f(row.market.priceExtensionAtr) >= 2 && f(row.market.vixChange5d) >= 0;
const crisisPocket = (row: Row) => sequence(row) === crisisWeakSequence;
const rangePocket = (row: Row) => row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR02' && f(row.market.adx14) < 12 && f(row.market.tqqqRealisedVol20d) < .5 && f(row.market.range20dPct) >= .06;

export const p5e94Parent = (row: Row) => p5e87Parent(row) || extPocket(row) || crisisPocket(row) || rangePocket(row);
export const p5e94Pockets = { extPocket, crisisPocket, rangePocket };
