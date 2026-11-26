import { qqqIvUsable } from './qqqIvQuality';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { qqqGammaExpiryTime } from './qqqGammaModel';
import { qqqEasternDateKey } from './qqqMarketDate';
import { exposureSpotIndex, type ExposureBar, type ExposureFrame } from './qqqExposureWorkbench';
import { heatmapSessionVwap } from './qqqHeatmapOverlays';

export type HedgeActivity = { call: number; put: number; total: number; contracts: number };
export type HedgeChange = { price: number; time: number; iv: number; total: number; shares: number };
export type HedgeObservation = {
  from: number; time: number; activity: HedgeActivity | null; hedge: HedgeChange | null;
  activityReason: string | null; hedgeReason: string | null;
  spot: number | null; fromSpot: number | null; vwap: number | null;
  activityRatio: number | null;
  hedgePartial?: boolean; hedgeCoverage?: string;
  activityPartial?: boolean; activityCoverage?: string;
  activityByContract?: ReadonlyMap<string, HedgeActivity>;
  hedgeByContract?: ReadonlyMap<string, HedgeChange>;
};
export type HedgeObservationInput = { frames: readonly ExposureFrame[]; bars: readonly ExposureBar[] };
type Strike = ExposureFrame['profiles'][number]['strikes'][number];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const year = 365 * 86400_000;
const maxGap = 300_000;
const expiryTimes = new Map<string, number>();
function expiryAt(expiry: string) {
  let time = expiryTimes.get(expiry);
  if (time === undefined) { time = qqqGammaExpiryTime(expiry); expiryTimes.set(expiry, time); }
  while (expiryTimes.size > 128) expiryTimes.delete(expiryTimes.keys().next().value!);
  return time;
}
function contracts(frame: ExposureFrame): Map<string, { strike: Strike; expiry: string }> | null {
  if (frame.missing.length || !frame.profiles.length) return null;
  const result = new Map<string, { strike: Strike; expiry: string }>();
  for (const profile of frame.profiles) {
    const at = profile.time ?? frame.time;
    if (!profile.strikes.length || at > frame.time || frame.time - at > maxGap) return null;
    for (const strike of profile.strikes) {
      const key = `${profile.expiry}:${strike.strike}`;
      if (!(strike.strike > 0) || !finite(strike.strike) || result.has(key)) return null;
      result.set(key, { strike, expiry: profile.expiry });
    }
  }
  return result;
}
function delta(spot: number, strike: number, remaining: number, iv: number, side: 'call' | 'put') {
  return blackScholesEngine.price({ S: spot, K: strike, T: remaining / year, sigma: iv, r: 0, type: side }).delta;
}

const sumActivity = (values: readonly HedgeActivity[]): HedgeActivity => values.reduce((a, b) => ({
  call: a.call + b.call, put: a.put + b.put, total: a.total + b.total, contracts: a.contracts + b.contracts
}), {call: 0, put: 0, total: 0, contracts: 0});
const sumHedge = (values: readonly HedgeChange[]): HedgeChange => values.reduce((a, b) => ({
  price: a.price + b.price, time: a.time + b.time, iv: a.iv + b.iv, total: a.total + b.total, shares: a.shares + b.shares
}), {price: 0, time: 0, iv: 0, total: 0, shares: 0});
// Compare the same contracts across intervals; missing values are never zero-filled.
function comparableValues<T>(points: readonly {value: T | null; byContract?: ReadonlyMap<string, T>; coverage?: string}[], sum: (values: T[]) => T) {
  if (!points.length || points.some(point => point.value === null)) return null;
  if (points.every(point => point.byContract)) {
    const keys = [...points[0]!.byContract!.keys()].filter(key => points.every(point => point.byContract!.has(key)));
    return keys.length ? {values: points.map(point => sum(keys.map(key => point.byContract!.get(key)!))),
      partial: points.some(point => point.byContract!.size !== keys.length)} : null;
  }
  return new Set(points.map(point => point.coverage)).size <= 1 ? {values: points.map(point => point.value!), partial: false} : null;
}
const comparableActivity = (points: readonly HedgeObservation[]) => comparableValues(points.map(point => ({
  value: point.activity, byContract: point.activityByContract, coverage: point.activityCoverage
})), sumActivity);
const comparableHedge = (points: readonly HedgeObservation[]) => comparableValues(points.map(point => ({
  value: point.hedge, byContract: point.hedgeByContract, coverage: point.hedgeCoverage
})), sumHedge);
function activityIntensity(points: readonly HedgeObservation[], history: readonly HedgeObservation[]) {
  const common = comparableActivity([...points, ...history]);
  if (!common || history.length < 5) return null;
  const elapsed = points.reduce((sum, point) => sum + (point.time - point.from) / 60_000, 0);
  const rates = history.map((point, i) => common.values[points.length + i]!.total / ((point.time - point.from) / 60_000)).sort((a, b) => a - b);
  const median = (rates[Math.floor((rates.length - 1) / 2)]! + rates[Math.floor(rates.length / 2)]!) / 2;
  return elapsed > 0 && median > 0 ? sumActivity(common.values.slice(0, points.length)).total / elapsed / median : null;
}

/** Unsigned activity and hypothetical rehedging are deliberately separate.
 * Fix PRIOR interval OI; decompose price -> elapsed time -> IV (order-dependent,
 * exact telescoping). Hedge shares = minus change in model inventory delta.
 * Only then convert shares at the current spot; no delta-dollar differencing.
 * Inventory follows the existing Call + / Put - hypothesis, r=q=0, 100 shares.
 */
export async function prepareHedgeObservations(input: HedgeObservationInput, signal: AbortSignal,
  schedule = () => new Promise<void>(resolve => setTimeout(resolve, 0))): Promise<HedgeObservation[]> {
  const spotAt = exposureSpotIndex(input.bars), result: HedgeObservation[] = [];
  const date = input.frames[0] ? qqqEasternDateKey(input.frames[0].time) : '';
  const vwap = heatmapSessionVwap(input.bars, date);
  let vwapCursor = -1, previous: ExposureFrame | undefined;
  let priorContracts: ReturnType<typeof contracts> = null, started = performance.now();
  await schedule(); signal.throwIfAborted();
  for (const frame of input.frames) {
    signal.throwIfAborted();
    const spot = spotAt(frame.time), fromSpot = previous ? spotAt(previous.time) : null;
    while (vwapCursor + 1 < vwap.length && vwap[vwapCursor + 1]!.time <= frame.time) vwapCursor++;
    const vwapPoint = vwap[vwapCursor];
    const reading: HedgeObservation = { from: previous?.time ?? frame.time, time: frame.time, activity: null, hedge: null,
      activityReason: null, hedgeReason: null, spot, fromSpot, activityRatio: null,
      vwap: vwapPoint && frame.time - vwapPoint.time <= maxGap ? vwapPoint.value : null };
    const currentContracts = contracts(frame);
    const gap = previous ? frame.time - previous.time : 0;
    const problem = !previous ? '需要前一快照' : gap <= 0 || gap > maxGap || qqqEasternDateKey(previous.time) !== qqqEasternDateKey(frame.time) ? '快照时间不连续'
      : !currentContracts || !priorContracts ? '到期日或行权价覆盖不完整'
      : currentContracts.size !== priorContracts.size || [...currentContracts.keys()].some(key => !priorContracts!.has(key)) ? '合约范围发生变化'
      : spot === null || fromSpot === null ? '缺少当时已收盘价格' : null;
    if (problem) { reading.activityReason = problem; reading.hedgeReason = problem; }
    else {
      let invalidActiveIv = false;
      const activityByContract = new Map<string, HedgeActivity>();
      const hedgeByContract = new Map<string, HedgeChange>();
      for (const [key, current] of currentContracts!) {
        if (performance.now() - started >= 6) { await schedule(); signal.throwIfAborted(); started = performance.now(); }
        const prior = priorContracts!.get(key)!.strike, strike = current.strike;
        const remaining0 = expiryAt(current.expiry) - previous!.time, remaining1 = expiryAt(current.expiry) - frame.time;
        if (!(remaining0 > 0 && remaining1 > 0)) {
          reading.activityReason ??= '合约已到期'; reading.hedgeReason ??= '合约已到期'; continue;
        }
        for (const side of ['call', 'put'] as const) {
          const volume0 = prior[side === 'call' ? 'callVolume' : 'putVolume'];
          const volume1 = strike[side === 'call' ? 'callVolume' : 'putVolume'];
          const iv0 = prior[side === 'call' ? 'callIv' : 'putIv'];
          const iv1 = strike[side === 'call' ? 'callIv' : 'putIv'];
          const oi = prior[side === 'call' ? 'callOi' : 'putOi'];
          const contractKey = `${key}:${side}`;
          let d1: number | null = null;
          if (!finite(volume0) || !finite(volume1) || volume0 < 0 || volume1 < 0) reading.activityPartial = true;
          else if (volume1 < volume0) reading.activityReason ??= '累计成交量回退';
          else if (volume1 > volume0) {
            if (!qqqIvUsable(iv1)) { reading.activityPartial = true; invalidActiveIv = true; }
            else {
              d1 = delta(spot!, strike.strike, remaining1, iv1, side);
              const notional = (volume1 - volume0) * Math.abs(d1) * 100 * spot!;
              activityByContract.set(contractKey, {call: side === 'call' ? notional : 0,
                put: side === 'put' ? notional : 0, total: notional, contracts: volume1 - volume0});
            }
          } else activityByContract.set(contractKey, {call: 0, put: 0, total: 0, contracts: 0});
          if (!finite(oi) || oi < 0) reading.hedgePartial = true;
          else if (oi === 0) hedgeByContract.set(contractKey, {price: 0, time: 0, iv: 0, total: 0, shares: 0});
          else if (oi > 0) {
            if (!qqqIvUsable(iv0) || !qqqIvUsable(iv1)) reading.hedgePartial = true;
            else {
              const d0 = delta(fromSpot!, strike.strike, remaining0, iv0, side);
              const dp = delta(spot!, strike.strike, remaining0, iv0, side);
              const dt = delta(spot!, strike.strike, remaining1, iv0, side);
              d1 ??= delta(spot!, strike.strike, remaining1, iv1, side);
              const weight = -(side === 'call' ? 1 : -1) * oi * 100;
              hedgeByContract.set(contractKey, {price: weight * (dp - d0) * spot!, time: weight * (dt - dp) * spot!,
                iv: weight * (d1 - dt) * spot!, total: weight * (d1 - d0) * spot!, shares: weight * (d1 - d0)});
            }
          }
        }
      }
      const activity = sumActivity([...activityByContract.values()]);
      reading.activityByContract = activityByContract;
      reading.activityCoverage = JSON.stringify([...activityByContract.keys()].sort());
      if (!activityByContract.size || invalidActiveIv && activity.contracts === 0) reading.activityReason ??= '缺少有效成交量或 IV';
      const hedge = sumHedge([...hedgeByContract.values()]);
      reading.hedgeByContract = hedgeByContract;
      reading.hedgeCoverage = JSON.stringify([...hedgeByContract.keys()].sort());
      if (!hedgeByContract.size) reading.hedgeReason ??= '缺少有效前一快照持仓量';
      if (!reading.activityReason && Object.values(activity).every(finite)) reading.activity = activity;
      else reading.activityReason ??= '活动计算无效';
      if (!reading.hedgeReason && Object.values(hedge).every(finite)) reading.hedge = hedge;
      else reading.hedgeReason ??= '模型计算无效';
    }
    const history = result.slice(-20).filter(point => point.activity && point.time > point.from && frame.time - point.time <= 3600_000);
    if (gap > 0) reading.activityRatio = activityIntensity([reading], history);
    result.push(reading); previous = frame; priorContracts = currentContracts;
    if (performance.now() - started >= 6) { await schedule(); signal.throwIfAborted(); started = performance.now(); }
  }
  signal.throwIfAborted(); return result;
}

export type HedgeWindow = ReturnType<typeof hedgeObservationWindow>;
/** Prefer the nearest observation within 30 seconds of the target to absorb
 * receipt jitter. Otherwise use the previous observation (at most two minutes
 * earlier). All observations are still at/before the replay cutoff.
 * Any missing/reset interval invalidates that metric throughout the window.
 */
export function hedgeObservationWindow(series: readonly HedgeObservation[], cutoff: number, minutes: number) {
  const end = series.findLastIndex(point => point.time <= cutoff), last = series[end];
  const target = (last?.time ?? cutoff) - minutes * 60_000;
  let baseline = series.findLastIndex(point => point.time <= target);
  const after = series[baseline + 1];
  if (baseline + 1 < end && after && Math.abs(after.time - target) <= 30_000
    && (baseline < 0 || Math.abs(after.time - target) < Math.abs(series[baseline]!.time - target))) baseline++;
  const first = series[baseline];
  const valid = first && last && target - first.time <= 120_000 && first.time - target <= 30_000 && baseline < end;
  const points = valid ? series.slice(baseline + 1, end + 1) : [];
  const contiguous = points.length > 0 && points.every((point, i) => point.from === (i ? points[i - 1]!.time : first!.time));
  const commonActivity = contiguous ? comparableActivity(points) : null;
  const activity = commonActivity ? sumActivity(commonActivity.values) : null;
  const commonHedge = contiguous ? comparableHedge(points) : null;
  const hedge = commonHedge ? sumHedge(commonHedge.values) : null;
  const pricePct = valid && first.spot !== null && last.spot !== null ? (last.spot / first.spot - 1) * 100 : null;
  const elapsed = valid ? (last.time - first.time) / 60_000 : null;
  // Prior observations only; never include the current window in its baseline.
  const history = valid ? series.slice(Math.max(0, baseline - 20), baseline + 1).filter(point =>
    point.activity && point.time > point.from && last.time - point.time <= 3600_000) : [];
  const intensity = activity ? activityIntensity(points, history) : null;
  const response = pricePct === null ? '价格数据不足' : activity === null ? '活动数据不足' : intensity === null ? '活动基线不足' : intensity >= 1.5
    ? Math.abs(pricePct) < .05 ? '活动放大 · 价格停滞' : `活动放大 · 价格${pricePct > 0 ? '上涨' : '下跌'}` : '活动未明显放大';
  const alignment = pricePct === null ? '价格数据不足' : hedge === null ? '模型数据不足'
    : Math.abs(pricePct) < .05 ? '价格变动不足 0.05%' : Math.abs(hedge.total) <= 1 ? '模型净调整接近零'
    : hedge.total * pricePct > 0 ? '价格与模型同向' : '价格与模型背离';
  return { activity, activityPartial:commonActivity?.partial || points.some(point=>point.activityPartial), hedge, hedgePartial: commonHedge?.partial || points.some(point=>point.hedgePartial), pricePct, elapsed, intensity, response, alignment, last,
    activityReason: activity ? null : points.find(point => point.activityReason)?.activityReason ?? (contiguous ? '窗口内无共同有效活动合约' : '窗口内数据不足'),
    hedgeReason: hedge ? null : points.find(point => point.hedgeReason)?.hedgeReason ?? (contiguous ? '窗口内无共同有效持仓合约' : '窗口内数据不足') };
}
