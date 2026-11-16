/** Shared research-only P5.E82 parent, simplified RANGE/SR01 pocket. */
import { admission, childOptions, f, type Row } from './p4-e370-research-common';
import { p5e77Parent } from './p5-e77-parent-common';

export const p5e82Parent = (row: Row) => p5e77Parent(row) || (row.market.regime === 'RANGE_BOUND' && row.market.slowSubregime === 'SR01' && f(row.market.adx14) < 15 && f(row.market.tqqqRealisedVol20d) >= .5);
export const p5e82Options = { ...childOptions, additionalAdmission: admission(p5e82Parent) };
