/** P5.E213 research-only semantic grouping: fewer predicates, identical effective union. */
import { admission, f, type Row } from './p4-e370-research-common';
import { p5e181Options } from './p5-e181-parent-common';
import { p5e86RwPocket } from './p5-e86-parent-common';
import { p5e94Pockets } from './p5-e94-parent-common';

const stateIs = (row: Row, regime: string, slow: string) => row.market.regime === regime && row.market.slowSubregime === slow;
const previous = (row: Row) => row.history.length >= 2 ? row.history[row.history.length - 2] : undefined;
const state = (value: { regime?: string | null; slowSubregime?: string | null } | undefined) => `${value?.regime ?? 'NA'}/${value?.slowSubregime ?? 'NA'}`;
const sequence = (row: Row) => row.history.length >= 3
  ? [row.history[row.history.length - 3], row.history[row.history.length - 2], row.market].map(state).join(' -> ')
  : 'NA';

/** E65's state-local leaves, grouped by current state without changing any boundary. */
export const p5e213E65Grouped = (row: Row) => {
  const adx = f(row.market.adx14);
  const roc5 = f(row.market.roc5);
  const roc20 = f(row.market.roc20);
  const vix = f(row.market.vix);
  const extension = f(row.market.priceExtensionAtr);
  const range20 = f(row.market.range20dPct);
  const vixChange = f(row.market.vixChange5d);
  const rv20 = f(row.market.tqqqRealisedVol20d);
  const termSlope = f(row.market.vixTermStructureSlope);
  const distance = f(row.market.distanceToSma20Pct);
  const rsi = f(row.market.rsi14);
  const slope20 = f(row.market.sma20SlopePct);
  const ma50Slope = f(row.market.ma50SlopePct);
  const drawdown = f(row.market.drawdownFromRecentHighPct);

  if (stateIs(row, 'RISK_ON_EXTENDED', 'SR02')) return (adx < 30 && roc5 < .0044 && vix < 17) || (vix < 12 && roc5 < .01 && adx >= 25) || (adx >= 40 && drawdown >= .01 && vix < 15) || (extension < 2.5 && roc5 >= .018 && rv20 < .3);
  if (stateIs(row, 'BULL', 'SR02')) return (extension < 1 && rsi >= 60 && (adx >= 20 || range20 >= .06)) || (adx >= 25 && extension < 0);
  if (stateIs(row, 'RANGE_BOUND', 'SR01')) return (roc20 >= -.02 && slope20 < 0 && vix < 17) || (adx < 15 && range20 >= .06) || (roc5 >= .01 && roc20 < 0) || (adx < 15 && rv20 >= .5);
  if (stateIs(row, 'SIDEWAYS', 'SR01')) return (roc20 >= .02 && ((termSlope < 2.5 && distance < .05) || (extension < 1.5 && vixChange < 0))) || (vixChange >= 0 && ((roc20 >= -.05 && termSlope < 1) || (extension < 0 && distance >= -.02))) || (rv20 >= .67 && range20 < .12 && ma50Slope < .02) || (adx < 20 && roc5 >= .01 && distance < .05) || (vix >= 16 && rv20 < .5) || (adx < 15 && termSlope < 3);
  if (stateIs(row, 'RISK_ON_EXTENDED', 'SR01')) return vix < 15 && extension >= 3 && adx < 35;
  if (stateIs(row, 'RANGE_BOUND', 'SR02')) return (adx >= 15 && ((slope20 < 0 && vixChange < .05) || (roc5 >= 0 && drawdown >= .01))) || (roc20 < 0 && vixChange >= .05 && rsi >= 50) || (extension >= 2 && roc20 >= .02);
  if (stateIs(row, 'RISK_ON_EXTENDED', 'CURRENT')) return true;
  if (stateIs(row, 'BULL', 'SR01')) return vix < 14 && extension >= 0;
  if (stateIs(row, 'RISK_ON_WEAKENING', 'SR02')) return roc5 < 0 && rsi >= 50;
  if (stateIs(row, 'RISK_ON_WEAKENING', 'SR01')) return adx >= 25 && vixChange < 0;
  if (stateIs(row, 'RISK_ON_WEAKENING', 'CURRENT') || stateIs(row, 'SIDEWAYS', 'SR02')) return range20 >= .06 && slope20 < 0;
  if (stateIs(row, 'BULL', 'CURRENT')) return adx >= 15;
  return false;
};

/** E65/E68 transition leaves grouped by target state and shared historical predecessor. */
export const p5e213E68Grouped = (row: Row) => {
  const prev = previous(row);
  if (stateIs(row, 'RISK_ON_EXTENDED', 'SR02')) return (prev?.regime === 'BULL' && prev?.slowSubregime === 'SR01') || (prev?.regime === 'BULL' && prev?.slowSubregime === 'SR02' && f(row.market.adx14) < 12) || (prev?.regime === 'RISK_ON_EXTENDED' && prev?.slowSubregime === 'CURRENT' && f(row.market.vix) < 14);
  if (stateIs(row, 'RANGE_BOUND', 'SR02')) return prev?.regime === 'RANGE_BOUND' && prev?.slowSubregime === 'SR01' && f(row.market.adx14) < 12;
  return false;
};

export const p5e213E74Grouped = (row: Row) => {
  const seq = sequence(row);
  const adx12 = f(row.market.adx14) < 12;
  const vixChangeUp = f(row.market.vixChange5d) >= 0;
  if (seq === 'RANGE_BOUND/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02') return f(row.market.rsi14) >= 50 || adx12;
  if (seq === 'BULL/SR01 -> BULL/SR01 -> BULL/SR02') return vixChangeUp;
  if (seq === 'BULL/SR01 -> BULL/SR01 -> RISK_ON_EXTENDED/SR01') return f(row.market.tqqqRealisedVol20d) >= .5;
  if (seq === 'BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02') return f(row.market.roc5) < 0;
  if (seq === 'BULL/SR02 -> RISK_ON_EXTENDED/SR02 -> BULL/SR02' || seq === 'RISK_ON_WEAKENING/SR02 -> RISK_ON_WEAKENING/SR02 -> BULL/SR02') return adx12;
  if (seq === 'RANGE_BOUND/SR02 -> BULL/SR02 -> BULL/SR02') return vixChangeUp;
  return false;
};

export const p5e213E87Grouped = (row: Row) => {
  const seq = sequence(row);
  const transition = seq === 'RISK_ON_EXTENDED/SR02 -> BULL/SR02 -> BULL/SR02' || seq === 'BULL/SR02 -> BULL/SR02 -> RANGE_BOUND/SR02';
  return (seq === 'BULL/SR02 -> BULL/SR02 -> RISK_ON_EXTENDED/SR02' && f(row.market.priceExtensionAtr) >= 2 && f(row.market.vixChange5d) < 0)
    || (transition && f(row.market.adx14) < 12 && f(row.market.vix) < 14);
};

export const p5e213CompactParent = (row: Row) => {
  const e71 = p5e213E71(row);
  const e77 = p5e213E77(row);
  const e86 = p5e213E86(row);
  const e94 = p5e213E94(row);
  return p5e213E65Grouped(row) || p5e213E68Grouped(row) || e71 || p5e213E74Grouped(row) || e77 || p5e213RangePocket(row) || e86 || p5e213E87Grouped(row) || e94;
};

export const p5e213E71 = (row: Row) => sequence(row) === 'RISK_ON_EXTENDED/CURRENT -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02'
  || sequence(row) === 'RANGE_BOUND/SR01 -> RANGE_BOUND/SR01 -> RISK_ON_WEAKENING/SR01';
export const p5e213E77 = (row: Row) => sequence(row) === 'RISK_ON_EXTENDED/SR01 -> RISK_ON_EXTENDED/SR02 -> RISK_ON_EXTENDED/SR02' && f(row.market.vix) < 14;
export const p5e213RangePocket = (row: Row) => stateIs(row, 'RANGE_BOUND', 'SR01') && f(row.market.adx14) < 15 && f(row.market.tqqqRealisedVol20d) >= .5;
export const p5e213E86 = p5e86RwPocket;
export const p5e213E94 = (row: Row) => p5e94Pockets.extPocket(row) || p5e94Pockets.crisisPocket(row) || p5e94Pockets.rangePocket(row);

export const p5e213Options = {
  ...p5e181Options,
  additionalAdmission: admission(p5e213CompactParent),
};
