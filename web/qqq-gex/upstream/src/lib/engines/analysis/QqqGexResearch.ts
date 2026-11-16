import { qqqSessionVwap } from '@/lib/qqqSessionVwap';
import { buildQqqGammaModel } from '@/lib/qqqGammaModel';
import { createDerivedFactor, createRawFactor, fallbackFactor } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';

/**
 * Research-only GEX surface. This module deliberately produces no entry score,
 * eligibility, contract selection, or order instruction. It is a frozen
 * feature/label layer for evaluating incremental value before any factor is
 * admitted to the existing decision chain.
 */
export type QqqGexResearchBar = {
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume: number;
};

export type QqqGexResearchStrike = {
  strike: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  callIv?: number;
  putIv?: number;
  inputComplete?: boolean;
  computedAt?: string;
  callReceivedAt?: string;
  putReceivedAt?: string;
  callOi?: number;
  putOi?: number;
  callVolume?: number;
  putVolume?: number;
  callBid?: number;
  callAsk?: number;
  callMid?: number;
  putBid?: number;
  putAsk?: number;
  putMid?: number;
  isCallWall: boolean;
  isPutWall: boolean;
  isGammaFlip: boolean;
};

export type QqqGexResearchSnapshot = {
  time: string;
  spot: number;
  netGex: number;
  gammaFlip: number | null;
  callWallPrice: number | null;
  callWallMagnitude: number | null;
  putWallPrice: number | null;
  putWallMagnitude: number | null;
  profile?: readonly QqqGexResearchStrike[];
};

export type QqqGexResearchSpread = {
  shortStrike: number;
  longStrike: number;
  entryCredit?: number | null;
  definedRisk?: number | null;
};

export type QqqGexResearchExpiry = {
  expiryDate: string;
  dte: number;
  spot: number;
  expectedMove: number | null;
  netGex: number;
  gammaFlip: number | null;
  callWallPrice: number | null;
  callWallMagnitude: number | null;
  putWallPrice: number | null;
  putWallMagnitude: number | null;
  profile: readonly QqqGexResearchStrike[];
  history: readonly QqqGexResearchSnapshot[];
};

export type QqqWallConfirmation = {
  side: 'put' | 'call';
  wall: number | null;
  firstTouchAt: string | null;
  rejection5m: number | null;
  rejection15m: number | null;
  timeBeyondWallMinutes: number | null;
  touchVolumeRatio: number | null;
  vwapDeviation: number | null;
  localRvBps: number | null;
  rvExpansion: number | null;
  limitations: string[];
};

export type QqqSellerOutcomeLabel = {
  side: 'PCS' | 'CCS';
  shortStrike: number | null;
  touch30m: boolean | null;
  touch60m: boolean | null;
  touchByClose: boolean | null;
  maePoints: number | null;
  wallBroken: boolean | null;
  wallRecovered: boolean | null;
  wallBreakThenRecover: boolean | null;
  spreadMidPnl: number | null;
  slippage: number | null;
  maxLossUtilization: number | null;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  limitations: string[];
};

export type QqqGexResearchSurface = {
  researchOnly: true;
  market: {
    expiryCount: number;
    factors: FactorMap;
  };
  contract: {
    expiryDate: string;
    dte: number;
    factors: FactorMap;
    putWallConfirmation: QqqWallConfirmation;
    callWallConfirmation: QqqWallConfirmation;
  };
  labels: {
    asOf: string | null;
    pcs: QqqSellerOutcomeLabel;
    ccs: QqqSellerOutcomeLabel;
  };
  limitations: string[];
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const timeOf = (value: string) => Date.parse(value);
const minutesBetween = (from: string, to: string) => (timeOf(to) - timeOf(from)) / 60_000;

function rawNumber(value: number | null, api: string): FinancialFactor<number | null> {
  return value === null || !finite(value)
    ? fallbackFactor(null, `${api}不可用`)
    : createRawFactor(value, Number.isFinite, api, undefined, null);
}

function derivedNumber(
  value: number | null,
  inputs: string[],
  factors: FactorMap,
  reason: string,
): FinancialFactor<number | null> {
  if (value === null || !finite(value) || inputs.some((input) => !factors[input] || factors[input]!.confidence === 0)) {
    return fallbackFactor(null, reason);
  }
  return createDerivedFactor(value, inputs.map((input) => ({ factorId: input, weight: 1 / inputs.length })), factors);
}

function sortedBars(bars: readonly QqqGexResearchBar[]) {
  return bars.filter((bar) => positive(bar.close) && finite(timeOf(bar.timestamp))).slice().sort((left, right) => timeOf(left.timestamp) - timeOf(right.timestamp));
}

function midpointWindow(bars: readonly QqqGexResearchBar[], after: string, minutes: number) {
  const start = timeOf(after);
  return bars.filter((bar) => {
    const at = timeOf(bar.timestamp);
    return at >= start && at <= start + minutes * 60_000;
  });
}

function vwap(bars: readonly QqqGexResearchBar[]): number | null {
  return qqqSessionVwap(bars).at(-1)?.value ?? null;
}

function rmsReturnBps(bars: readonly QqqGexResearchBar[]): number | null {
  if (bars.length < 2) return null;
  const returns = bars.slice(1).flatMap((bar, index) => {
    const previous = bars[index]!.close;
    return positive(previous) && positive(bar.close) ? [Math.log(bar.close / previous)] : [];
  });
  if (!returns.length) return null;
  return Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) * 10_000;
}

function wallSegment(history: readonly QqqGexResearchSnapshot[], side: 'put' | 'call') {
  const sorted = history.filter((point) => finite(timeOf(point.time))).slice().sort((left, right) => timeOf(left.time) - timeOf(right.time));
  const latest = sorted.at(-1);
  const latestWall = latest ? (side === 'put' ? latest.putWallPrice : latest.callWallPrice) : null;
  if (!latest || !positive(latestWall)) return { latest, points: [] as QqqGexResearchSnapshot[] };
  const points: QqqGexResearchSnapshot[] = [latest];
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const point = sorted[index]!;
    const wall = side === 'put' ? point.putWallPrice : point.callWallPrice;
    const next = points[0]!;
    if (wall !== latestWall || minutesBetween(point.time, next.time) > 5) break;
    points.unshift(point);
  }
  return { latest, points };
}

function wallMagnitudeChange(history: readonly QqqGexResearchSnapshot[], side: 'put' | 'call', lookbackMinutes: number): number | null {
  const sorted = history.filter((point) => finite(timeOf(point.time))).slice().sort((left, right) => timeOf(left.time) - timeOf(right.time));
  const current = sorted.at(-1);
  if (!current) return null;
  const currentMagnitude = Math.abs(side === 'put' ? current.putWallMagnitude ?? NaN : current.callWallMagnitude ?? NaN);
  if (!positive(currentMagnitude)) return null;
  const target = timeOf(current.time) - lookbackMinutes * 60_000;
  const prior = sorted.filter((point) => timeOf(point.time) <= target).at(-1);
  const priorMagnitude = Math.abs(side === 'put' ? prior?.putWallMagnitude ?? NaN : prior?.callWallMagnitude ?? NaN);
  return positive(priorMagnitude) ? currentMagnitude / priorMagnitude - 1 : null;
}

export function deriveWallConfirmation(
  side: 'put' | 'call',
  wall: number | null,
  barsInput: readonly QqqGexResearchBar[],
  since: string | null = null,
): QqqWallConfirmation {
  const sinceTime = since === null ? null : timeOf(since);
  const bars = sortedBars(barsInput).filter((bar) => sinceTime === null || timeOf(bar.timestamp) >= sinceTime);
  const limitations: string[] = ['无逐笔期权成交/NBBO，不能确认主动买卖方向。', '触墙当根的极值顺序未知，拒绝幅度仅使用之后完整 K 线。'];
  if (!positive(wall) || !bars.length) return { side, wall, firstTouchAt: null, rejection5m: null, rejection15m: null, timeBeyondWallMinutes: null, touchVolumeRatio: null, vwapDeviation: null, localRvBps: null, rvExpansion: null, limitations: [...limitations, '缺少墙位或同期标的 K 线。'] };
  const firstTouchIndex = bars.findIndex((bar) => {
    const low = positive(bar.low) ? bar.low : bar.close;
    const high = positive(bar.high) ? bar.high : bar.close;
    return low <= wall && high >= wall;
  });
  const latest = bars.at(-1)!;
  // Wall stability limits touch observations, not the session VWAP anchor.
  const currentVwap = vwap(sortedBars(barsInput));
  const local = bars.slice(-4);
  const prior = bars.slice(-12, -4);
  const localRvBps = rmsReturnBps(local);
  const priorRvBps = rmsReturnBps(prior);
  const rvExpansion = localRvBps !== null && priorRvBps !== null && priorRvBps > 0 ? localRvBps / priorRvBps : null;
  if (firstTouchIndex < 0) return {
    side, wall, firstTouchAt: null, rejection5m: null, rejection15m: null, timeBeyondWallMinutes: 0,
    touchVolumeRatio: null, vwapDeviation: currentVwap === null ? null : latest.close - currentVwap,
    localRvBps, rvExpansion, limitations: [...limitations, '当前稳定墙位尚未被触及，拒绝幅度不可用。'],
  };
  const firstTouch = bars[firstTouchIndex]!;
  const afterTouch = bars.slice(firstTouchIndex);
  const rejection = (minutes: number) => {
    const window = midpointWindow(afterTouch.slice(1), firstTouch.timestamp, minutes)
      .filter(bar => timeOf(bar.timestamp) + 120_000 <= timeOf(firstTouch.timestamp) + minutes * 60_000);
    if (!window.length || minutesBetween(firstTouch.timestamp, latest.timestamp) < minutes) return null;
    return Math.max(0, side === 'put'
      ? Math.max(...window.map((bar) => positive(bar.high) ? bar.high : bar.close)) - wall
      : wall - Math.min(...window.map((bar) => positive(bar.low) ? bar.low : bar.close)));
  };
  const beyond = afterTouch.slice(1).reduce((sum, bar, index) => {
    const previous = afterTouch[index]!;
    const duration = Math.min(5, Math.max(0, minutesBetween(previous.timestamp, bar.timestamp)));
    const beyondWall = side === 'put' ? bar.close < wall : bar.close > wall;
    return sum + (beyondWall ? duration : 0);
  }, 0);
  const priorVolumes = bars.slice(Math.max(0, firstTouchIndex - 10), firstTouchIndex).map((bar) => bar.volume).filter((value) => finite(value) && value > 0).sort((left, right) => left - right);
  const medianVolume = priorVolumes.length ? priorVolumes[Math.floor(priorVolumes.length / 2)]! : null;
  return {
    side, wall, firstTouchAt: firstTouch.timestamp, rejection5m: rejection(5), rejection15m: rejection(15), timeBeyondWallMinutes: beyond,
    touchVolumeRatio: positive(medianVolume) && positive(firstTouch.volume) ? firstTouch.volume / medianVolume : null,
    vwapDeviation: currentVwap === null ? null : latest.close - currentVwap, localRvBps, rvExpansion,
    limitations,
  };
}

function deriveSellerLabel(input: {
  side: 'PCS' | 'CCS';
  entryTime: string;
  entrySpot: number;
  spread: QqqGexResearchSpread | null | undefined;
  wall: number | null;
  bars: readonly QqqGexResearchBar[];
  quoteHistory: readonly QqqGexResearchSnapshot[];
  sessionClosed: boolean;
}): QqqSellerOutcomeLabel {
  const direction = input.side === 'PCS' ? 'down' : 'up';
  const shortStrike = input.spread?.shortStrike ?? null;
  const longStrike = input.spread?.longStrike ?? null;
  const limitations: string[] = [];
  if (!positive(shortStrike) || !positive(longStrike) || !positive(input.entrySpot) || !finite(timeOf(input.entryTime))) return {
    side: input.side, shortStrike, touch30m: null, touch60m: null, touchByClose: null, maePoints: null,
    wallBroken: null, wallRecovered: null, wallBreakThenRecover: null, spreadMidPnl: null, slippage: null, maxLossUtilization: null,
    status: 'UNAVAILABLE', limitations: ['缺少完整双腿、入场现价或入场时间。'],
  };
  const future = sortedBars(input.bars).filter((bar) => timeOf(bar.timestamp) > timeOf(input.entryTime));
  if (!future.length) return {
    side: input.side, shortStrike, touch30m: null, touch60m: null, touchByClose: null, maePoints: null,
    wallBroken: null, wallRecovered: null, wallBreakThenRecover: null, spreadMidPnl: null, slippage: null, maxLossUtilization: null,
    status: 'UNAVAILABLE', limitations: [...limitations, '没有入场后的标的路径。'],
  };
  const touched = (bars: readonly QqqGexResearchBar[]) => bars.some((bar) => direction === 'down'
    ? (positive(bar.low) ? bar.low : bar.close) <= shortStrike
    : (positive(bar.high) ? bar.high : bar.close) >= shortStrike);
  const within = (minutes: number) => {
    const window = midpointWindow(future, input.entryTime, minutes);
    return future.length && minutesBetween(input.entryTime, future.at(-1)!.timestamp) >= minutes ? touched(window) : null;
  };
  const adverse = direction === 'down'
    ? Math.max(0, input.entrySpot - Math.min(...future.map((bar) => positive(bar.low) ? bar.low : bar.close)))
    : Math.max(0, Math.max(...future.map((bar) => positive(bar.high) ? bar.high : bar.close)) - input.entrySpot);
  const wallBroken = positive(input.wall) ? future.some((bar) => direction === 'down'
    ? (positive(bar.low) ? bar.low : bar.close) < input.wall!
    : (positive(bar.high) ? bar.high : bar.close) > input.wall!) : null;
  const firstBreak = positive(input.wall) ? future.findIndex((bar) => direction === 'down'
    ? (positive(bar.low) ? bar.low : bar.close) < input.wall!
    : (positive(bar.high) ? bar.high : bar.close) > input.wall!) : -1;
  const wallRecovered = firstBreak >= 0 && positive(input.wall)
    ? future.slice(firstBreak + 1).some((bar) => direction === 'down' ? bar.close >= input.wall! : bar.close <= input.wall!)
    : wallBroken === false ? false : null;
  const quoteValue = (snapshot: QqqGexResearchSnapshot, executable: boolean): number | null => {
    const short = snapshot.profile?.find((point) => point.strike === shortStrike);
    const long = snapshot.profile?.find((point) => point.strike === longStrike);
    if (!short || !long) return null;
    if (input.side === 'PCS') {
      const shortValue = executable ? short.putBid : short.putMid;
      const longValue = executable ? long.putAsk : long.putMid;
      return positive(shortValue) && finite(longValue) ? shortValue - longValue : null;
    }
    const shortValue = executable ? short.callBid : short.callMid;
    const longValue = executable ? long.callAsk : long.callMid;
    return positive(shortValue) && finite(longValue) ? shortValue - longValue : null;
  };
  const entryQuote = input.quoteHistory.find((point) => point.time === input.entryTime) ?? input.quoteHistory.filter((point) => timeOf(point.time) <= timeOf(input.entryTime)).at(-1) ?? null;
  const latestQuote = input.quoteHistory.filter((point) => timeOf(point.time) > timeOf(input.entryTime)).at(-1) ?? null;
  const entryMid = entryQuote ? quoteValue(entryQuote, false) : null;
  const executableCredit = entryQuote ? quoteValue(entryQuote, true) : null;
  const entryCredit = positive(input.spread?.entryCredit) ? input.spread!.entryCredit! : entryMid;
  const latestDebit = latestQuote ? quoteValue(latestQuote, false) : null;
  const spreadMidPnl = positive(entryCredit) && latestDebit !== null ? entryCredit - latestDebit : null;
  const slippage = entryMid !== null && executableCredit !== null ? entryMid - executableCredit : null;
  const maxLossUtilization = spreadMidPnl !== null && positive(input.spread?.definedRisk)
    ? Math.max(0, -spreadMidPnl) / input.spread!.definedRisk!
    : null;
  if (entryQuote === null || latestQuote === null || entryMid === null || latestDebit === null) limitations.push('缺少入场或后续双腿 mid 报价，真实价差 P&L 保持不可用。');
  if (slippage === null) limitations.push('缺少入场双腿 bid/ask，滑点保持不可用。');
  return {
    side: input.side, shortStrike, touch30m: within(30), touch60m: within(60), touchByClose: input.sessionClosed ? touched(future) : null,
    maePoints: adverse, wallBroken, wallRecovered, wallBreakThenRecover: wallBroken === true && wallRecovered === true,
    spreadMidPnl, slippage, maxLossUtilization,
    status: spreadMidPnl === null ? 'PARTIAL' : 'AVAILABLE', limitations,
  };
}

function profileTotals(profile: readonly QqqGexResearchStrike[]) {
  const valid = profile.filter((point) => positive(point.strike) && finite(point.callGex) && finite(point.putGex) && finite(point.totalGex));
  return {
    netGex: valid.reduce((sum, point) => sum + point.totalGex, 0),
    absoluteGex: valid.reduce((sum, point) => sum + Math.abs(point.totalGex), 0),
    top3AbsoluteGex: valid.slice().sort((left, right) => Math.abs(right.totalGex) - Math.abs(left.totalGex)).slice(0, 3).reduce((sum, point) => sum + Math.abs(point.totalGex), 0),
  };
}

function aggregateMarket(expiries: readonly QqqGexResearchExpiry[]) {
  const strikes = new Map<number, QqqGexResearchStrike>();
  let weightedExpectedMove = 0;
  let weight = 0;
  for (const expiry of expiries) {
    const totals = profileTotals(expiry.profile);
    const expiryWeight = totals.absoluteGex;
    if (positive(expiry.expectedMove) && expiryWeight > 0) {
      weightedExpectedMove += expiry.expectedMove * expiryWeight;
      weight += expiryWeight;
    }
    for (const point of expiry.profile) {
      if (!positive(point.strike) || !finite(point.callGex) || !finite(point.putGex) || !finite(point.totalGex)) continue;
      const previous = strikes.get(point.strike) ?? { ...point, callGex: 0, putGex: 0, totalGex: 0, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0, isCallWall: false, isPutWall: false, isGammaFlip: false };
      strikes.set(point.strike, {
        ...previous,
        callGex: previous.callGex + point.callGex,
        putGex: previous.putGex + point.putGex,
        totalGex: previous.totalGex + point.totalGex,
        callOi: (previous.callOi ?? 0) + (point.callOi ?? 0),
        putOi: (previous.putOi ?? 0) + (point.putOi ?? 0),
        callVolume: (previous.callVolume ?? 0) + (point.callVolume ?? 0),
        putVolume: (previous.putVolume ?? 0) + (point.putVolume ?? 0),
      });
    }
  }
  const profile = Array.from(strikes.values()).sort((left, right) => left.strike - right.strike);
  const totals = profileTotals(profile);
  const expectedMove = weight > 0 ? weightedExpectedMove / weight : null;
  const crossings = profile.slice(1).flatMap((point, index) => {
    const previous = profile[index]!;
    const signChanged = (previous.totalGex <= 0 && point.totalGex > 0) || (previous.totalGex >= 0 && point.totalGex < 0);
    return signChanged ? [{ level: (previous.strike + point.strike) / 2, slope: Math.abs(point.totalGex - previous.totalGex) / Math.max(point.strike - previous.strike, 1e-9) }] : [];
  });
  const gammaFlip = crossings.sort((left, right) => right.slope - left.slope)[0]?.level ?? null;
  return { profile, totals, expectedMove, gammaFlip };
}

function buildFactors(prefix: string, spot: number, expectedMove: number | null, totals: ReturnType<typeof profileTotals>, gammaFlip: number | null, putWall: number | null, callWall: number | null, history: readonly QqqGexResearchSnapshot[]) {
  const factors: FactorMap = {};
  factors[`${prefix}_spot`] = rawNumber(positive(spot) ? spot : null, 'QQQ GEX snapshot spot');
  factors[`${prefix}_expected_move`] = rawNumber(expectedMove, 'QQQ option-chain expected move');
  factors[`${prefix}_net_gex`] = rawNumber(totals.netGex, 'QQQ GEX profile');
  factors[`${prefix}_abs_gex`] = rawNumber(totals.absoluteGex, 'QQQ GEX profile');
  factors[`${prefix}_top3_abs_gex`] = rawNumber(totals.top3AbsoluteGex, 'QQQ GEX profile');
  factors[`${prefix}_flip`] = rawNumber(gammaFlip, 'QQQ GEX gamma flip');
  factors[`${prefix}_put_wall`] = rawNumber(putWall, 'QQQ GEX put wall');
  factors[`${prefix}_call_wall`] = rawNumber(callWall, 'QQQ GEX call wall');
  // The current Yahoo chain has cumulative volume but no trade tape/NBBO. Keep
  // this explicit fallback in the research factor surface instead of implying
  // that volume × mid identifies buyer/seller initiation.
  factors[`${prefix}_flow_tape_available`] = fallbackFactor(false, '缺少逐笔期权成交与 NBBO，不能判定主动买卖方向');
  factors[`${prefix}_flow_aggressor_bias`] = fallbackFactor<string | null>(null, '缺少逐笔期权成交与 NBBO，不能判定主动买卖方向');
  const balance = totals.absoluteGex > 0 ? totals.netGex / totals.absoluteGex : null;
  const top3Concentration = totals.absoluteGex > 0 ? totals.top3AbsoluteGex / totals.absoluteGex : null;
  const flipZ = positive(expectedMove) && positive(spot) && positive(gammaFlip) ? (spot - gammaFlip) / expectedMove : null;
  const putWallZ = positive(expectedMove) && positive(spot) && positive(putWall) ? (spot - putWall) / expectedMove : null;
  const callWallZ = positive(expectedMove) && positive(spot) && positive(callWall) ? (callWall - spot) / expectedMove : null;
  factors[`${prefix}_gex_balance`] = derivedNumber(balance, [`${prefix}_net_gex`, `${prefix}_abs_gex`], factors, '净 GEX 或绝对 GEX 不可用');
  factors[`${prefix}_top3_concentration`] = derivedNumber(top3Concentration, [`${prefix}_top3_abs_gex`, `${prefix}_abs_gex`], factors, 'Top-3 或总 GEX 不可用');
  factors[`${prefix}_flip_z`] = derivedNumber(flipZ, [`${prefix}_spot`, `${prefix}_flip`, `${prefix}_expected_move`], factors, 'Spot、Flip 或预期波动不可用');
  factors[`${prefix}_put_wall_z`] = derivedNumber(putWallZ, [`${prefix}_spot`, `${prefix}_put_wall`, `${prefix}_expected_move`], factors, 'Spot、Put Wall 或预期波动不可用');
  factors[`${prefix}_call_wall_z`] = derivedNumber(callWallZ, [`${prefix}_spot`, `${prefix}_call_wall`, `${prefix}_expected_move`], factors, 'Spot、Call Wall 或预期波动不可用');
  for (const side of ['put', 'call'] as const) {
    const segment = wallSegment(history, side);
    const currentSegmentMinutes = segment.points.length >= 2 ? minutesBetween(segment.points[0]!.time, segment.points.at(-1)!.time) : null;
    const magnitude10m = wallMagnitudeChange(history, side, 10);
    const magnitude20m = wallMagnitudeChange(history, side, 20);
    factors[`${prefix}_${side}_wall_hold_minutes`] = rawNumber(currentSegmentMinutes, `QQQ ${side} wall continuity`);
    factors[`${prefix}_${side}_wall_magnitude_change_10m`] = rawNumber(magnitude10m, `QQQ ${side} wall magnitude 10m change`);
    factors[`${prefix}_${side}_wall_magnitude_change_20m`] = rawNumber(magnitude20m, `QQQ ${side} wall magnitude 20m change`);
  }
  return factors;
}

function appendWallConfirmationFactors(factors: FactorMap, prefix: string, confirmation: QqqWallConfirmation, barCount: number) {
  const wallId = `${prefix}_wall`;
  const pathId = `${prefix}_bar_path_count`;
  factors[wallId] = rawNumber(confirmation.wall, `QQQ ${prefix} wall`);
  factors[pathId] = createRawFactor(barCount, (value) => Number.isInteger(value) && value > 0, `QQQ ${prefix} 2m bar path`, undefined, 0);
  const add = (name: string, value: number | null, reason: string) => {
    factors[`${prefix}_${name}`] = derivedNumber(value, [wallId, pathId], factors, reason);
  };
  add('rejection_5m', confirmation.rejection5m, '墙位尚未触及或 5 分钟路径不足');
  add('rejection_15m', confirmation.rejection15m, '墙位尚未触及或 15 分钟路径不足');
  add('time_beyond_minutes', confirmation.timeBeyondWallMinutes, '墙位或同期路径不足');
  add('touch_volume_ratio', confirmation.touchVolumeRatio, '触墙前成交量基线不足');
  add('vwap_deviation', confirmation.vwapDeviation, '成交量或路径不足，无法计算 VWAP 偏离');
  add('local_rv_bps', confirmation.localRvBps, '局部路径不足，无法计算 RV');
  add('rv_expansion', confirmation.rvExpansion, '局部或前序 RV 不足，无法计算扩张');
}

export function buildQqqGexResearchSurface(input: {
  expiries: readonly QqqGexResearchExpiry[];
  selectedExpiryDate: string;
  bars: readonly QqqGexResearchBar[];
  pcsSpread?: QqqGexResearchSpread | null;
  ccsSpread?: QqqGexResearchSpread | null;
  labelAt?: string | null;
  asOf?: string;
  sessionClosed: boolean;
}): QqqGexResearchSurface | null {
  const contract = input.expiries.find((expiry) => expiry.expiryDate === input.selectedExpiryDate);
  if (!contract) return null;
  const market = aggregateMarket(input.expiries);
  const valuationAt = input.asOf ?? contract.history.at(-1)?.time;
  // A strike-distribution crossing is not a spot-repriced Gamma zero.
  // Without a valuation time or complete IV/OI, the model remains unavailable.
  const model = valuationAt ? buildQqqGammaModel(input.expiries.map(expiry => ({
    expiryDate: expiry.expiryDate, asOf: expiry.history.at(-1)?.time ?? valuationAt,
    fullGexProfile: expiry.profile,
  })), contract.spot, valuationAt, {includeSensitivity:false}) : null;
  const gammaFlip = model && !model.excluded.length ? model.levels.zeroGamma : null;
  const marketFactors = buildFactors('qqq_gex_market', contract.spot, market.expectedMove, market.totals, gammaFlip, null, null, []);
  marketFactors.qqq_gex_market_strike_crossing = rawNumber(market.gammaFlip, 'QQQ GEX strike-distribution crossing; not a Gamma spot root');
  const history = contract.history.length ? contract.history : [{
    time: input.bars.at(-1)?.timestamp ?? new Date(0).toISOString(), spot: contract.spot, netGex: contract.netGex,
    gammaFlip: contract.gammaFlip, callWallPrice: contract.callWallPrice, callWallMagnitude: contract.callWallMagnitude,
    putWallPrice: contract.putWallPrice, putWallMagnitude: contract.putWallMagnitude,
  }];
  const totals = profileTotals(contract.profile);
  const contractFactors = buildFactors('qqq_gex_contract', contract.spot, contract.expectedMove, totals, contract.gammaFlip, contract.putWallPrice, contract.callWallPrice, history);
  const latestTime = input.labelAt ?? history.at(-1)?.time ?? input.bars.at(-1)?.timestamp ?? new Date(0).toISOString();
  const entrySnapshot = history.find((point) => point.time === latestTime) ?? null;
  const entrySpot = entrySnapshot?.spot ?? contract.spot;
  const putSegment = wallSegment(history, 'put');
  const callSegment = wallSegment(history, 'call');
  const putWallConfirmation = deriveWallConfirmation('put', contract.putWallPrice, input.bars, putSegment.points[0]?.time ?? null);
  const callWallConfirmation = deriveWallConfirmation('call', contract.callWallPrice, input.bars, callSegment.points[0]?.time ?? null);
  appendWallConfirmationFactors(contractFactors, 'qqq_gex_contract_put_wall', putWallConfirmation, input.bars.length);
  appendWallConfirmationFactors(contractFactors, 'qqq_gex_contract_call_wall', callWallConfirmation, input.bars.length);
  const labels = {
    asOf: history.some((point) => point.time === latestTime) ? latestTime : null,
    pcs: deriveSellerLabel({ side: 'PCS', entryTime: latestTime, entrySpot, spread: input.pcsSpread, wall: entrySnapshot?.putWallPrice ?? contract.putWallPrice, bars: input.bars, quoteHistory: history, sessionClosed: input.sessionClosed }),
    ccs: deriveSellerLabel({ side: 'CCS', entryTime: latestTime, entrySpot, spread: input.ccsSpread, wall: entrySnapshot?.callWallPrice ?? contract.callWallPrice, bars: input.bars, quoteHistory: history, sessionClosed: input.sessionClosed }),
  };
  return {
    researchOnly: true,
    market: { expiryCount: input.expiries.length, factors: marketFactors },
    contract: { expiryDate: contract.expiryDate, dte: contract.dte, factors: contractFactors, putWallConfirmation, callWallConfirmation },
    labels,
    limitations: [
      'GEX 为 OI/Greeks 推导的结构代理，不代表可观测的 dealer 实际净仓位。',
      '当前没有逐笔成交相对 NBBO 的主动买卖分类。',
      '逐快照双腿报价开始保存在 GEX profile；历史快照尚未积累到双腿报价时，真实价差 P&L、滑点和最大亏损占用保持不可用。',
    ],
  };
}
