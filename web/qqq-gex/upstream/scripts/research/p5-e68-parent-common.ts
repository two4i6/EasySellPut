/** Shared research-only P5.E68 parent: P5.E65 plus the validated three-pocket union. */
import { admission, childOptions, type Row } from './p4-e370-research-common';
import { p5e65Parent } from './p5-e65-parent-common';

const stateIs = (row: Row, regime: string, slow: string) => row.market.regime === regime && row.market.slowSubregime === slow;
const previous = (row: Row) => row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
export const p5e68Union = (row: Row) => {
  const prev = previous(row);
  return (prev?.regime === 'BULL' && prev?.slowSubregime === 'SR02' && stateIs(row, 'RISK_ON_EXTENDED', 'SR02') && (row.market.adx14 ?? Number.POSITIVE_INFINITY) < 12)
    || (prev?.regime === 'RISK_ON_EXTENDED' && prev?.slowSubregime === 'CURRENT' && stateIs(row, 'RISK_ON_EXTENDED', 'SR02') && (row.market.vix ?? Number.POSITIVE_INFINITY) < 14)
    || (prev?.regime === 'RANGE_BOUND' && prev?.slowSubregime === 'SR01' && stateIs(row, 'RANGE_BOUND', 'SR02') && (row.market.adx14 ?? Number.POSITIVE_INFINITY) < 12);
};
export const p5e68Parent = (row: Row) => p5e65Parent(row) || p5e68Union(row);
export const p5e68Options = { ...childOptions, additionalAdmission: admission(p5e68Parent) };
