/** Shared research-only P5.E65 parent admission. */
import { admission, childOptions, f, type Row } from './p4-e370-research-common';

const stateIs = (row: Row, regime: string, slow: string) => row.market.regime === regime && row.market.slowSubregime === slow;
const p5e31 = (row: Row) => {
  if (stateIs(row, 'RISK_ON_EXTENDED', 'SR02')) return (f(row.market.adx14) < 30 && f(row.market.roc5) < .0044 && f(row.market.vix) < 17) || (f(row.market.vix) < 12 && f(row.market.roc5) < .01 && f(row.market.adx14) >= 25) || (f(row.market.adx14) >= 40 && f(row.market.drawdownFromRecentHighPct) >= .01 && f(row.market.vix) < 15) || (f(row.market.priceExtensionAtr) < 2.5 && f(row.market.roc5) >= .018 && f(row.market.tqqqRealisedVol20d) < .3);
  if (stateIs(row, 'BULL', 'SR02')) return f(row.market.priceExtensionAtr) < 1 && f(row.market.rsi14) >= 60 && (f(row.market.adx14) >= 20 || f(row.market.range20dPct) >= .06);
  if (stateIs(row, 'RANGE_BOUND', 'SR01')) return f(row.market.roc20) >= -.02 && f(row.market.sma20SlopePct) < 0 && f(row.market.vix) < 17;
  if (stateIs(row, 'SIDEWAYS', 'SR01')) return (f(row.market.roc20) >= .02 && ((f(row.market.vixTermStructureSlope) < 2.5 && f(row.market.distanceToSma20Pct) < .05) || (f(row.market.priceExtensionAtr) < 1.5 && f(row.market.vixChange5d) < 0))) || (f(row.market.vixChange5d) >= 0 && ((f(row.market.roc20) >= -.05 && f(row.market.vixTermStructureSlope) < 1) || (f(row.market.priceExtensionAtr) < 0 && f(row.market.distanceToSma20Pct) >= -.02))) || (f(row.market.tqqqRealisedVol20d) >= .67 && f(row.market.range20dPct) < .12 && f(row.market.ma50SlopePct) < .02) || (f(row.market.adx14) < 20 && f(row.market.roc5) >= .01 && f(row.market.distanceToSma20Pct) < .05);
  if (stateIs(row, 'RISK_ON_EXTENDED', 'SR01')) return f(row.market.vix) < 15 && f(row.market.priceExtensionAtr) >= 3 && f(row.market.adx14) < 35;
  if (stateIs(row, 'RANGE_BOUND', 'SR02')) return (f(row.market.adx14) >= 15 && ((f(row.market.sma20SlopePct) < 0 && f(row.market.vixChange5d) < .05) || (f(row.market.roc5) >= 0 && f(row.market.drawdownFromRecentHighPct) >= .01))) || (f(row.market.roc20) < 0 && f(row.market.vixChange5d) >= .05 && f(row.market.rsi14) >= 50);
  if (stateIs(row, 'RISK_ON_EXTENDED', 'CURRENT')) return true;
  return stateIs(row, 'BULL', 'SR01') && f(row.market.vix) < 14 && f(row.market.priceExtensionAtr) >= 0;
};
const e33 = (row: Row) => stateIs(row, 'RISK_ON_WEAKENING', 'SR02') && f(row.market.roc5) < 0 && f(row.market.rsi14) >= 50;
const e38 = (row: Row) => stateIs(row, 'RISK_ON_WEAKENING', 'SR01') && f(row.market.adx14) >= 25 && f(row.market.vixChange5d) < 0;
const e40 = (row: Row) => (stateIs(row, 'RISK_ON_WEAKENING', 'CURRENT') || stateIs(row, 'SIDEWAYS', 'SR02')) && f(row.market.range20dPct) >= .06 && f(row.market.sma20SlopePct) < 0;
const e44 = (row: Row) => stateIs(row, 'BULL', 'CURRENT') && f(row.market.adx14) >= 15;
const e48 = (row: Row) => stateIs(row, 'RANGE_BOUND', 'SR01') && f(row.market.adx14) < 15 && f(row.market.range20dPct) >= .06;
const e50 = (row: Row) => stateIs(row, 'RANGE_BOUND', 'SR01') && f(row.market.roc5) >= .01 && f(row.market.roc20) < 0;
const e51 = (row: Row) => stateIs(row, 'BULL', 'SR02') && f(row.market.adx14) >= 25 && f(row.market.priceExtensionAtr) < 0;
const e53 = (row: Row) => stateIs(row, 'RANGE_BOUND', 'SR02') && f(row.market.priceExtensionAtr) >= 2 && f(row.market.roc20) >= .02;
const e57 = (row: Row) => stateIs(row, 'SIDEWAYS', 'SR01') && f(row.market.vix) >= 16 && f(row.market.tqqqRealisedVol20d) < .5;
const e60 = (row: Row) => stateIs(row, 'SIDEWAYS', 'SR01') && f(row.market.adx14) < 15 && f(row.market.vixTermStructureSlope) < 3;
const e65 = (row: Row) => { const previous = row.history.length >= 2 ? row.history[row.history.length - 2] : undefined; return previous?.regime === 'BULL' && previous?.slowSubregime === 'SR01' && stateIs(row, 'RISK_ON_EXTENDED', 'SR02'); };

export const p5e65Parent = (row: Row) => p5e31(row) || e33(row) || e38(row) || e40(row) || e44(row) || e48(row) || e50(row) || e51(row) || e53(row) || e57(row) || e60(row) || e65(row);
export const p5e65Options = { ...childOptions, additionalAdmission: admission(p5e65Parent) };
