export interface OHLCBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SellerStat {
  value: number | null;
  n: number;
  windowDays: number;
  formulaKey: string;
  confidence: number;
  interval?: {
    lower: number;
    upper: number;
    effectiveN: number;
    method: 'wilson-effective-n' | 'conditional-shrinkage-wilson';
  };
  sampleMode?: 'global' | 'conditional-shrunk';
}

export type StrikeSurvivalBarrier = 'close' | 'intraday';

export interface StrikeSurvivalCondition {
  currentSigma: number;
  currentDrawdown20Pct: number;
  currentTrend20Sigma: number;
}

export type SigmaBucket = '1.0-1.5' | '1.5-2.0' | '2.0-2.5' | '>=2.5';
type AnchoredSigmaBucket = '0.5-1.0' | SigmaBucket;

export interface SellerStats {
  sellPutNextDayNoLoss: Array<{ bucket: SigmaBucket } & SellerStat>;
  /** 次日严格反涨（close_{t+1} > close_t），区别于「不输」（含平盘），用于「次日视角」不输% vs 反涨% 对比。 */
  sellPutNextDayRebound: Array<{ bucket: SigmaBucket } & SellerStat>;
  /** 行权价相对口径：次日没有再跌超一个 σ（OTM put 卖方的真实输面），close-to-close 版本仅作参考。 */
  sellPutNoBreach: Array<{ bucket: SigmaBucket } & SellerStat>;
  /** 对称于 sellCallNoLoss 的当日/本周两档，沿用 sellPutNextDayNoLoss 同款 4 档 σ 分桶（而非 CALL 侧单一 z≥1 门槛），保持与 nextDay 口径一致。 */
  sellPutNoLoss: { sameDayFade: Array<{ bucket: SigmaBucket } & SellerStat>; week: Array<{ bucket: SigmaBucket } & SellerStat> };
  sellCallNoLoss: { nextDay: SellerStat; sameDayFade: SellerStat; week: SellerStat };
  /** 行权价相对口径：没有再涨超一个 σ。 */
  sellCallNoBreach: { nextDay: SellerStat; week: SellerStat };
  swingSweetSpot: { lookbackDays: 37; currentDistPct: number; bounceProb10d: SellerStat; medianBounceMagPct: SellerStat; band: [number, number] | null };
  manageability: {
    recover5d: SellerStat; halfRetrace10d: SellerStat; repairSuccess: SellerStat;
    continueDrop5d: SellerStat; worstCase5dDropPct: SellerStat; medianRepairDays: SellerStat;
  };
  /** 当前下行压力日的现价锚定路径；仅供解释，不参与卖方决策评分。 */
  anchoredManageability: {
    bucket: AnchoredSigmaBucket | null;
    recover5d: SellerStat; halfRetrace10d: SellerStat; repairSuccess: SellerStat;
    continueDrop5d: SellerStat; worstCase5dDropPct: SellerStat; medianRepairDays: SellerStat;
  };
  distanceFromHigh: { high52w: number; distPct52w: number; high37d: number; distPct37d: number };
  todayMove: { returnPct: number; sigma20: number; zScore: number; bucket: SigmaBucket | null; direction: 'up' | 'down' | 'flat' };
  /** 当日 as-of 的负向标准化冲击；多周期研究只消费这里，避免再读未来价格。 */
  downsideShock: { oneDay: number; threeDay: number; fiveDay: number };
  /** 今日之前四个交易日的累计对数收益与标准化幅度；历史不足时为 null。 */
  prior4dReturnPct: number | null;
  prior4dSigma: number | null;
  expectedMoveContainment?: SellerStat;
  /** 继续下跌升级概率梯：条件同 sellPutNoLoss（r_t<0 且分桶），胜=后续 h 日内日内低点再跌破 close_t×(1−k×σ20_t)；用 low 而非 close，衡量"盘中继续跌"而非收盘口径。 */
  sellPutEscalation: Array<{ bucket: SigmaBucket; day1Half: SellerStat; day1Full: SellerStat; day2Half: SellerStat; day2Full: SellerStat }>;
  /** 多周期 Strike 生存曲线：无条件全窗口，胜=未来 h 日内收盘从未跌破 close_t×(1−d×σ20_t)；用于把行权价距离折算成生存率。 */
  strikeSurvival: Array<{ sigmaDist: number; d3: SellerStat; d5: SellerStat; d10: SellerStat }>;
}

export const FORMULA_DOCS: Record<string, { zh: string; en: string }> = {
  sellPutNextDayNoLoss: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：close_{t+1} ≥ close_t；σ20 为逐日 as-of 的 r_{t-19..t} 标准差。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: close_{t+1} ≥ close_t; σ20 is the as-of stdev of r_{t-19..t}.' },
  sellPutNextDayRebound: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：close_{t+1} > close_t（严格反涨，平盘不计），区别于「不输」含平盘的口径。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: close_{t+1} > close_t (strictly higher, flat does not count), distinct from the "no-loss" measure which includes flat closes.' },
  sellPutSameDayFade: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：close_t > low_t × (1 + 0.25×σ20_t)，即当日收盘已从日内低点回补；以日线口径替代小时级日内回补统计。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: close_t > low_t × (1 + 0.25×σ20_t), i.e. the close already recovered off the intraday low; daily-bar proxy replacing hourly intraday-recovery statistics.' },
  sellPutWeekNoLoss: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：close_{t+5} ≥ close_t。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: close_{t+5} ≥ close_t.' },
  sellPutNoBreach: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：close_{t+1} ≥ close_t × (1 − σ20_t)，即次日没有再跌超一个 σ；对应卖出 ≈1σ OTM put 的不击穿率。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: close_{t+1} ≥ close_t × (1 − σ20_t), i.e. no further one-sigma drop; proxies the no-breach rate of selling a ≈1σ OTM put.' },
  sellCallNextDayNoLoss: { zh: '条件：r_t > 0 且 z_t ≥ 1.0；胜：close_{t+1} ≤ close_t。', en: 'Condition: r_t > 0 and z_t ≥ 1.0; win: close_{t+1} ≤ close_t.' },
  sellCallNextDayNoBreach: { zh: '条件：r_t > 0 且 z_t ≥ 1.0；胜：close_{t+1} ≤ close_t × (1 + σ20_t)，即次日没有再涨超一个 σ。', en: 'Condition: r_t > 0 and z_t ≥ 1.0; win: close_{t+1} ≤ close_t × (1 + σ20_t), i.e. no further one-sigma rise.' },
  sellCallWeekNoBreach: { zh: '条件：r_t > 0 且 z_t ≥ 1.0；胜：close_{t+5} ≤ close_t × (1 + σ20_t)。', en: 'Condition: r_t > 0 and z_t ≥ 1.0; win: close_{t+5} ≤ close_t × (1 + σ20_t).' },
  sellCallSameDayFade: { zh: '条件：r_t > 0 且 z_t ≥ 1.0；胜：close_t < high_t × (1 − 0.25×σ20_t)；以日线口径替代小时级日内回落统计。', en: 'Condition: r_t > 0 and z_t ≥ 1.0; win: close_t < high_t × (1 − 0.25×σ20_t); daily-bar proxy replacing hourly intraday-fade statistics.' },
  sellCallWeekNoLoss: { zh: '条件：r_t > 0 且 z_t ≥ 1.0；胜：close_{t+5} ≤ close_t。', en: 'Condition: r_t > 0 and z_t ≥ 1.0; win: close_{t+5} ≤ close_t.' },
  swingBounceProb10d: { zh: '条件：37 日 dist_t 与当前 dist 相差不超过 2 个百分点；胜：max(close_{t+1..t+10}) ≥ 1.03×close_t。', en: 'Condition: 37-day dist_t is within 2 percentage points of current dist; win: max(close_{t+1..t+10}) ≥ 1.03×close_t.' },
  swingMedianBounceMagPct: { zh: '条件：37 日 dist_t 与当前 dist 相差不超过 2 个百分点；值：max(close_{t+1..t+10})/close_t − 1 的中位数。', en: 'Condition: 37-day dist_t is within 2 percentage points of current dist; value: median of max(close_{t+1..t+10})/close_t − 1.' },
  manageRecover5d: { zh: '事件：r_t ≤ −1.5×σ20_t；胜：close_{t+5} ≥ close_t。', en: 'Event: r_t ≤ −1.5×σ20_t; win: close_{t+5} ≥ close_t.' },
  manageHalfRetrace10d: { zh: '事件：r_t ≤ −1.5×σ20_t；胜：max(close_{t+1..t+10}) ≥ close_t + 0.5×(close_{t-1}−close_t)。', en: 'Event: r_t ≤ −1.5×σ20_t; win: max(close_{t+1..t+10}) ≥ close_t + 0.5×(close_{t-1}−close_t).' },
  manageRepairSuccess: { zh: '事件：r_t ≤ −1.5×σ20_t；胜：15 个交易日内 close 收复 close_{t-1}。', en: 'Event: r_t ≤ −1.5×σ20_t; win: close recovers close_{t-1} within 15 trading days.' },
  manageContinueDrop5d: { zh: '事件：r_t ≤ −1.5×σ20_t；胜：min(close_{t+1..t+5}) ≤ close_t×(1−σ20_t)。', en: 'Event: r_t ≤ −1.5×σ20_t; win: min(close_{t+1..t+5}) ≤ close_t×(1−σ20_t).' },
  manageWorstCase5dDropPct: { zh: '事件：r_t ≤ −1.5×σ20_t；值：min(close_{t+1..t+5})/close_t−1 的第 5 百分位。', en: 'Event: r_t ≤ −1.5×σ20_t; value: 5th percentile of min(close_{t+1..t+5})/close_t−1.' },
  manageMedianRepairDays: { zh: '事件：r_t ≤ −1.5×σ20_t；值：15 日内修复成功样本的收复交易日数中位数。', en: 'Event: r_t ≤ −1.5×σ20_t; value: median trading days to recovery among repairs completed within 15 days.' },
  manageAnchoredRecover5d: { zh: '条件：当前为至少 0.5σ 的下行日，按当前 σ 桶匹配历史下行日；胜：未来 5 日内任一收盘 ≥ 该历史日收盘锚。', en: 'Condition: current day is a downside move of at least 0.5σ; match historical downside days in its sigma bucket; win: any close within 5 days reaches that event close anchor.' },
  manageAnchoredHalfRetrace10d: { zh: '条件：同当前 σ 桶下行日；胜：未来 10 日内任一收盘 ≥ 历史事件锚与前一日收盘的半程。', en: 'Condition: downside days in the current sigma bucket; win: any close within 10 days reaches halfway between the event anchor and prior close.' },
  manageAnchoredRepairSuccess: { zh: '条件：同当前 σ 桶下行日；胜：未来 15 日内任一收盘 ≥ 该事件前一日收盘。', en: 'Condition: downside days in the current sigma bucket; win: any close within 15 days reaches the prior close.' },
  manageAnchoredContinueDrop5d: { zh: '条件：同当前 σ 桶下行日；胜：未来 5 日内任一收盘 ≤ 事件锚×(1−当日σ20)。', en: 'Condition: downside days in the current sigma bucket; win: any close within 5 days falls another one daily sigma below the event anchor.' },
  manageAnchoredWorstCase5dDropPct: { zh: '条件：同当前 σ 桶下行日；值：未来 5 日最低收盘相对事件锚收益的第 5 百分位。', en: 'Condition: downside days in the current sigma bucket; value: 5th percentile of the minimum 5-day close return relative to the event anchor.' },
  manageAnchoredMedianRepairDays: { zh: '条件：同当前 σ 桶下行日；值：15 日内回到事件前一日收盘的成功样本所需交易日数中位数。', en: 'Condition: downside days in the current sigma bucket; value: median trading days among successful 15-day repairs to the prior close.' },
  sellPutEscalationD1K05: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：low_{t+1} ≤ close_t × (1 − 0.5×σ20_t)，即次日日内再跌半个 σ；相对口径，非累计跌幅。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: low_{t+1} ≤ close_t × (1 − 0.5×σ20_t), i.e. next-day intraday drop of another half-sigma; relative, not cumulative.' },
  sellPutEscalationD1K10: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：low_{t+1} ≤ close_t × (1 − 1.0×σ20_t)，即次日日内再跌整个 σ。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: low_{t+1} ≤ close_t × (1 − 1.0×σ20_t), i.e. next-day intraday drop of another full sigma.' },
  sellPutEscalationD2K05: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：min(low_{t+1..t+2}) ≤ close_t × (1 − 0.5×σ20_t)，即两日内日内再跌半个 σ。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: min(low_{t+1..t+2}) ≤ close_t × (1 − 0.5×σ20_t), i.e. another half-sigma drop within two days.' },
  sellPutEscalationD2K10: { zh: '条件：r_t < 0 且 z_t 落入指定桶；胜：min(low_{t+1..t+2}) ≤ close_t × (1 − 1.0×σ20_t)，即两日内日内再跌整个 σ。', en: 'Condition: r_t < 0 and z_t is in the bucket; win: min(low_{t+1..t+2}) ≤ close_t × (1 − 1.0×σ20_t), i.e. another full-sigma drop within two days.' },
  sellPutStrikeSurvival: { zh: '无条件全窗口；胜：未来 h 个交易日内收盘从未跌破 close_t × (1 − d×σ20_t)；d/h 为网格点，行权价按 σ 网格近似折算，非精确行权价回放。', en: 'Unconditional, all windows; win: close never drops below close_t × (1 − d×σ20_t) within the next h trading days; d/h are grid points, strike distance is approximated to the sigma grid, not an exact strike replay.' },
  sellPutStrikeSurvivalDte: { zh: '无条件全窗口；胜：未来 h 个交易日内收盘从未跌破 close_t × (1 − d×σ20_t)；d 为当前 short strike 的精确 σ 距离。', en: 'Unconditional, all windows; win: close never drops below close_t × (1 − d×σ20_t) within the next h trading days; d is the exact current short-strike sigma distance.' },
  sellPutStrikeNoTouchDte: { zh: '无条件全窗口；胜：未来 h 个交易日内日内最低价从未跌破 close_t × (1 − d×σ20_t)；这是盘中不触碰率，不是收盘生存率。', en: 'Unconditional, all windows; win: intraday low never drops below close_t × (1 − d×σ20_t) within the next h trading days; this is a no-touch rate, not close-survival.' },
  sellPutStrikeSurvivalConditional: { zh: '按当前 σ、20 日回撤和 20 日趋势匹配历史路径，并以全样本先验收缩；胜：未来 h 个交易日收盘从未跌破阈值。', en: 'Matches historical paths by current volatility, 20-day drawdown, and 20-day trend, then shrinks toward the full-sample prior; win means no close breach within h trading days.' },
  sellPutStrikeNoTouchConditional: { zh: '按当前 σ、20 日回撤和 20 日趋势匹配历史路径，并以全样本先验收缩；胜：未来 h 个交易日日内最低价从未跌破阈值。', en: 'Matches historical paths by current volatility, 20-day drawdown, and 20-day trend, then shrinks toward the full-sample prior; win means no intraday-low breach within h trading days.' },
  sellPutStrikeConditionalLossDte: { zh: '条件：未来 h 个交易日日内最低价击穿精确短腿；结果：按当前价差 credit/宽度映射后的平均每张条件损失，并在保护腿处封顶。', en: 'Condition: the future intraday low breaches the exact short strike within h trading days; result: average conditional loss per contract mapped to the current credit/width and capped by the long put.' },
  sellPutStrikeConditionalLossP75Dte: { zh: '条件：未来 h 个交易日日内最低价击穿精确短腿；结果：条件损失的加权第 75 百分位。', en: 'Condition: the future intraday low breaches the exact short strike within h trading days; result: weighted 75th percentile of conditional loss.' },
  sellPutStrikeConditionalLossCvar75Dte: { zh: '条件：未来 h 个交易日日内最低价击穿精确短腿；结果：超过 P75 的最差 25% 条件损失加权均值。', en: 'Condition: the future intraday low breaches the exact short strike within h trading days; result: weighted mean conditional loss in the worst 25% beyond P75.' },
  sellPutStrikeConditionalDropPctDte: { zh: '条件：未来 h 个交易日日内最低价击穿精确短腿；结果：从 as-of 收盘到未来最低价的条件平均跌幅。', en: 'Condition: the future intraday low breaches the exact short strike within h trading days; result: conditional average drawdown from the as-of close to the future minimum low.' },
  sellCallStrikeSurvivalDte: { zh: '无条件全窗口；胜：未来 h 个交易日内收盘从未上穿 close_t × (1 + d×σ20_t)；用于 Call 短腿生存率。', en: 'Unconditional, all windows; win: close never rises above close_t × (1 + d×σ20_t) within the next h trading days; used for short-call survival.' },
  sellCallStrikeNoTouchDte: { zh: '无条件全窗口；胜：未来 h 个交易日内日内最高价从未触碰 close_t × (1 + d×σ20_t)；用于 Call 短腿盘中不触碰率。', en: 'Unconditional, all windows; win: intraday high never touches close_t × (1 + d×σ20_t) within the next h trading days; used for short-call no-touch rate.' },
  sellCallStrikeConditionalLossDte: { zh: '条件：未来 h 个交易日日内最高价击穿精确短腿；结果：按当前价差 credit/宽度映射后的平均每张条件损失，并在保护腿处封顶。', en: 'Condition: the future intraday high breaches the exact short strike within h trading days; result: average conditional loss per contract mapped to the current credit/width and capped by the long call.' },
  sellCallStrikeConditionalLossP75Dte: { zh: '条件：未来 h 个交易日日内最高价击穿精确短腿；结果：条件损失的加权第 75 百分位。', en: 'Condition: the future intraday high breaches the exact short strike within h trading days; result: weighted 75th percentile of conditional loss.' },
  sellCallStrikeConditionalLossCvar75Dte: { zh: '条件：未来 h 个交易日日内最高价击穿精确短腿；结果：超过 P75 的最差 25% 条件损失加权均值。', en: 'Condition: the future intraday high breaches the exact short strike within h trading days; result: weighted mean conditional loss in the worst 25% beyond P75.' },
  sellCallStrikeConditionalRisePctDte: { zh: '条件：未来 h 个交易日日内最高价击穿精确短腿；结果：从 as-of 收盘到未来最高价的条件平均涨幅。', en: 'Condition: the future intraday high breaches the exact short strike within h trading days; result: conditional average rise from the as-of close to the future maximum high.' },
};

const BUCKETS: SigmaBucket[] = ['1.0-1.5', '1.5-2.0', '2.0-2.5', '>=2.5'];

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const stdev = (values: number[]) => values.length < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / (values.length - 1));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};
const maxClose = (bars: OHLCBar[], from: number, to: number) => Math.max(...bars.slice(from, to + 1).map(({ close }) => close));
const minClose = (bars: OHLCBar[], from: number, to: number) => Math.min(...bars.slice(from, to + 1).map(({ close }) => close));
const minLow = (bars: OHLCBar[], from: number, to: number) => Math.min(...bars.slice(from, to + 1).map(({ low }) => low));

/** Future extrema for a fixed horizon; each horizon/barrier is built once with a monotonic deque. */
function buildForwardExtrema(
  bars: OHLCBar[],
  horizonDays: number,
  mode: 'minClose' | 'minLow' | 'maxClose' | 'maxHigh',
): number[] {
  const values = bars.map((bar) => mode === 'minClose' || mode === 'maxClose' ? bar.close : mode === 'minLow' ? bar.low : bar.high);
  const pastExtrema = new Array<number>(bars.length).fill(Number.NaN);
  const deque: number[] = [];
  let head = 0;
  const isMin = mode === 'minClose' || mode === 'minLow';
  for (let end = 0; end < values.length; end++) {
    while (head < deque.length && deque[head]! <= end - horizonDays) head++;
    while (deque.length > head) {
      const tail = deque[deque.length - 1]!;
      if (isMin ? values[tail]! >= values[end]! : values[tail]! <= values[end]!) deque.pop();
      else break;
    }
    deque.push(end);
    pastExtrema[end] = values[deque[head]!]!;
  }
  return bars.map((_, index) => index + horizonDays < bars.length ? pastExtrema[index + horizonDays]! : Number.NaN);
}

function upperBoundByIndex(samples: Array<{ index: number }>, maxIndex: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle]!.index <= maxIndex) low = middle + 1;
    else high = middle;
  }
  return low;
}

type SampleWindow<T> = { samples: T[]; count: number };
const SURVIVAL_D = [0.5, 1.0, 1.5, 2.0, 2.5] as const;
const SURVIVAL_H = [3, 5, 10] as const;
const ANCHORED_BUCKETS: AnchoredSigmaBucket[] = ['0.5-1.0', ...BUCKETS];
export const bucketFor = (z: number): SigmaBucket | null => z >= 2.5 ? '>=2.5' : z >= 2 ? '2.0-2.5' : z >= 1.5 ? '1.5-2.0' : z >= 1 ? '1.0-1.5' : null;
const anchoredBucketFor = (z: number): AnchoredSigmaBucket | null => z >= 1 ? bucketFor(z) : z >= .5 ? '0.5-1.0' : null;
const confidenceFor = (n: number) => n < 8 ? 2 : n < 20 ? 5 : n < 50 ? 7 : 9;
const stat = (values: number[], windowDays: number, formulaKey: string, aggregate = mean): SellerStat => ({
  value: values.length < 8 ? null : aggregate(values), n: values.length, windowDays, formulaKey, confidence: confidenceFor(values.length),
});

function effectiveSampleSize(values: number[], windowDays: number): number {
  if (values.length < 2) return values.length;
  const average = mean(values);
  const variance = mean(values.map(value => (value - average) ** 2));
  if (!(variance > 0)) return values.length;
  const maxLag = Math.min(Math.max(windowDays - 1, 1), 30, values.length - 1);
  let autocorrelationSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let covariance = 0;
    for (let index = lag; index < values.length; index++) {
      covariance += (values[index]! - average) * (values[index - lag]! - average);
    }
    const correlation = covariance / ((values.length - lag) * variance);
    if (!(correlation > 0)) break;
    autocorrelationSum += (1 - lag / values.length) * correlation;
  }
  return Math.max(1, Math.min(values.length, values.length / (1 + 2 * autocorrelationSum)));
}

function wilsonInterval(value: number, effectiveN: number): { lower: number; upper: number } {
  const n = Math.max(1, effectiveN);
  const p = Math.min(1, Math.max(0, value));
  const z = 1.959963984540054;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const halfWidth = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denominator;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}

const survivalStat = (values: number[], windowDays: number, formulaKey: string): SellerStat => {
  const base = stat(values, windowDays, formulaKey);
  if (base.value === null) return base;
  const effectiveN = effectiveSampleSize(values, windowDays);
  const interval = wilsonInterval(base.value, effectiveN);
  return { ...base, interval: { ...interval, effectiveN, method: 'wilson-effective-n' }, sampleMode: 'global' };
};

function anchoredManageability(bars: OHLCBar[], returns: Array<number | null>, sigmas: Array<number | null>, zScores: Array<number | null>): SellerStats['anchoredManageability'] {
  const last = bars.length - 1;
  const currentBucket = last >= 0 && (returns[last] ?? 0) < 0 && zScores[last] !== null ? anchoredBucketFor(zScores[last]!) : null;
  const recover5: number[] = [], halfRetrace10: number[] = [], repairSuccess: number[] = [], continueDrop5: number[] = [], worstDrop5: number[] = [], repairDays: number[] = [];
  if (currentBucket) for (let i = 20; i < last; i++) {
    const sigma = sigmas[i], z = zScores[i], r = returns[i];
    if (!sigma || z === null || !r || r >= 0 || anchoredBucketFor(z) !== currentBucket) continue;
    const anchor = bars[i]!.close;
    const priorClose = bars[i - 1]!.close;
    if (i + 5 <= last) {
      const futureMax = maxClose(bars, i + 1, i + 5);
      const futureMin = minClose(bars, i + 1, i + 5);
      recover5.push(futureMax >= anchor ? 1 : 0);
      continueDrop5.push(futureMin <= anchor * (1 - sigma) ? 1 : 0);
      worstDrop5.push(futureMin / anchor - 1);
    }
    if (i + 10 <= last) halfRetrace10.push(maxClose(bars, i + 1, i + 10) >= (anchor + priorClose) / 2 ? 1 : 0);
    if (i + 15 <= last) {
      const repair = Array.from({ length: 15 }, (_, offset) => i + offset + 1).find(day => bars[day]!.close >= priorClose);
      repairSuccess.push(repair === undefined ? 0 : 1);
      if (repair !== undefined) repairDays.push(repair - i);
    }
  }
  return {
    bucket: currentBucket,
    recover5d: stat(recover5, 5, 'manageAnchoredRecover5d'),
    halfRetrace10d: stat(halfRetrace10, 10, 'manageAnchoredHalfRetrace10d'),
    repairSuccess: stat(repairSuccess, 15, 'manageAnchoredRepairSuccess'),
    continueDrop5d: stat(continueDrop5, 5, 'manageAnchoredContinueDrop5d'),
    worstCase5dDropPct: stat(worstDrop5, 5, 'manageAnchoredWorstCase5dDropPct', values => percentile(values, .05)),
    medianRepairDays: stat(repairDays, 15, 'manageAnchoredMedianRepairDays', median),
  };
}

function computeReturnsAndSigmas(bars: OHLCBar[]): { returns: Array<number | null>; sigmas: Array<number | null> } {
  const returns = bars.map((bar, index) => index ? Math.log(bar.close / bars[index - 1].close) : null);
  const sigmas = returns.map((_, index) => index >= 20 ? stdev(returns.slice(index - 19, index + 1) as number[]) : null);
  return { returns, sigmas };
}

function strikeSurvivalFormulaKey(barrier: StrikeSurvivalBarrier, conditional: boolean): string {
  if (barrier === 'intraday') return conditional ? 'sellPutStrikeNoTouchConditional' : 'sellPutStrikeNoTouchDte';
  return conditional ? 'sellPutStrikeSurvivalConditional' : 'sellPutStrikeSurvivalDte';
}

type StrikeSurvivalSample = {
  outcome: number;
  sigma: number;
  drawdown20Pct: number;
  trend20Sigma: number;
};

function strikeConditionalWeight(sample: Omit<StrikeSurvivalSample, 'outcome'>, condition: StrikeSurvivalCondition): number {
  const volatilityDistance = Math.log(sample.sigma / condition.currentSigma) / 0.35;
  const drawdownDistance = (sample.drawdown20Pct - condition.currentDrawdown20Pct) / 0.08;
  const trendDistance = (sample.trend20Sigma - condition.currentTrend20Sigma) / 1.0;
  return Math.exp(-0.5 * (volatilityDistance ** 2 + drawdownDistance ** 2 + trendDistance ** 2));
}

type StrikeSurvivalBaseSample = Omit<StrikeSurvivalSample, 'outcome'> & { futureMinRatio: number };
type StrikeSurvivalBaseCache = { samples: StrikeSurvivalBaseSample[]; computedThrough: number };
const strikeSurvivalBaseCache = new WeakMap<object, Map<string, StrikeSurvivalBaseCache>>();
const strikeSurvivalFeatureCache = new WeakMap<object, Map<number, Omit<StrikeSurvivalSample, 'outcome'>>>();

function strikeSurvivalFeatures(bars: OHLCBar[], sigmas: Array<number | null>, index: number): Omit<StrikeSurvivalSample, 'outcome'> | null {
  const sigma = sigmas[index];
  if (!(sigma && sigma > 0) || index < 20) return null;
  const close = bars[index]?.close;
  const priorClose = bars[index - 20]?.close;
  if (!(close && close > 0) || !(priorClose && priorClose > 0)) return null;
  const high20 = Math.max(...bars.slice(index - 20, index + 1).map(({ high }) => high));
  if (!(high20 > 0)) return null;
  return {
    sigma,
    drawdown20Pct: close / high20 - 1,
    trend20Sigma: Math.log(close / priorClose) / (sigma * Math.sqrt(20)),
  };
}

function cachedStrikeSurvivalFeatures(bars: OHLCBar[], index: number): Omit<StrikeSurvivalSample, 'outcome'> | null {
  let cache = strikeSurvivalFeatureCache.get(bars);
  if (!cache) {
    cache = new Map();
    strikeSurvivalFeatureCache.set(bars, cache);
  }
  if (cache.has(index)) return cache.get(index)!;
  const returns: number[] = [];
  for (let cursor = index - 19; cursor <= index; cursor++) {
    const prior = bars[cursor - 1]?.close;
    const current = bars[cursor]?.close;
    if (!(prior && current)) return null;
    returns.push(Math.log(current / prior));
  }
  const sigma = stdev(returns);
  const close = bars[index]?.close;
  const priorClose = bars[index - 20]?.close;
  if (!(sigma > 0) || !(close && close > 0) || !(priorClose && priorClose > 0)) return null;
  const high20 = Math.max(...bars.slice(index - 20, index + 1).map(({ high }) => high));
  if (!(high20 > 0)) return null;
  const result = { sigma, drawdown20Pct: close / high20 - 1, trend20Sigma: Math.log(close / priorClose) / (sigma * Math.sqrt(20)) };
  cache.set(index, result);
  return result;
}

function collectStrikeSurvivalBaseSamples(
  bars: OHLCBar[],
  horizonDays: number,
  barrier: StrikeSurvivalBarrier,
): StrikeSurvivalBaseSample[] {
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) return [];
  let byHorizon = strikeSurvivalBaseCache.get(bars);
  if (!byHorizon) {
    byHorizon = new Map();
    strikeSurvivalBaseCache.set(bars, byHorizon);
  }
  const cacheKey = `${horizonDays}|${barrier}`;
  let cache = byHorizon.get(cacheKey);
  if (!cache) {
    cache = { samples: [], computedThrough: 19 };
    byHorizon.set(cacheKey, cache);
  }
  const lastMaturedIndex = bars.length - 1 - horizonDays;
  for (let index = cache.computedThrough + 1; index <= lastMaturedIndex; index++) {
    const features = cachedStrikeSurvivalFeatures(bars, index);
    if (!features) continue;
    const futureMin = barrier === 'intraday'
      ? minLow(bars, index + 1, index + horizonDays)
      : minClose(bars, index + 1, index + horizonDays);
    cache.samples.push({ ...features, futureMinRatio: futureMin / bars[index]!.close });
  }
  cache.computedThrough = Math.max(cache.computedThrough, lastMaturedIndex);
  return cache.samples;
}

function collectStrikeSurvivalSamples(
  bars: OHLCBar[],
  sigmaDist: number,
  horizonDays: number,
  barrier: StrikeSurvivalBarrier,
): StrikeSurvivalSample[] {
  if (!Number.isFinite(sigmaDist) || !Number.isInteger(horizonDays) || horizonDays <= 0) return [];
  return collectStrikeSurvivalBaseSamples(bars, horizonDays, barrier).map(({ futureMinRatio, sigma, drawdown20Pct, trend20Sigma }) => ({
    sigma,
    drawdown20Pct,
    trend20Sigma,
    outcome: futureMinRatio >= 1 - sigmaDist * sigma ? 1 : 0,
  }));
}

/**
 * strikeSurvival 的通用 horizon 版本：按任意 sigmaDist/horizonDays 算生存率，
 * 供期权到期日匹配场景使用（computeSellerStats 的 strikeSurvival 固定在 3/5/10 交易日网格，不适配任意 DTE）。
 */
export function computeStrikeSurvivalForHorizon(
  bars: OHLCBar[],
  sigmaDist: number,
  horizonDays: number,
  barrier: StrikeSurvivalBarrier = 'close',
): SellerStat {
  const samples = collectStrikeSurvivalSamples(bars, sigmaDist, horizonDays, barrier);
  return survivalStat(samples.map(({ outcome }) => outcome), horizonDays, strikeSurvivalFormulaKey(barrier, false));
}

function strikeSurvivalConditionAtIndex(
  bars: OHLCBar[],
  asOfIndex: number,
  currentSigma: number,
): StrikeSurvivalCondition | null {
  if (asOfIndex < 20 || !(currentSigma > 0) || !Number.isFinite(currentSigma)) return null;
  const close = bars[asOfIndex]?.close;
  const priorClose = bars[asOfIndex - 20]?.close;
  if (!(close && close > 0) || !(priorClose && priorClose > 0)) return null;
  const high20 = Math.max(...bars.slice(asOfIndex - 20, asOfIndex + 1).map(({ high }) => high));
  if (!(high20 > 0)) return null;
  return {
    currentSigma,
    currentDrawdown20Pct: close / high20 - 1,
    currentTrend20Sigma: Math.log(close / priorClose) / (currentSigma * Math.sqrt(20)),
  };
}

export function buildStrikeSurvivalCondition(bars: OHLCBar[], currentSigma: number): StrikeSurvivalCondition | null {
  return strikeSurvivalConditionAtIndex(bars, bars.length - 1, currentSigma);
}

/**
 * 条件化生存率：以当前波动、20 日回撤和 20 日标准化趋势匹配历史路径，
 * 再用全样本均值做 20 个有效样本的收缩先验，防止条件样本过少时过拟合。
 */
export function computeConditionalStrikeSurvivalForHorizon(
  bars: OHLCBar[],
  sigmaDist: number,
  horizonDays: number,
  condition: StrikeSurvivalCondition,
  barrier: StrikeSurvivalBarrier = 'close',
): SellerStat {
  const samples = collectStrikeSurvivalSamples(bars, sigmaDist, horizonDays, barrier);
  const formulaKey = strikeSurvivalFormulaKey(barrier, true);
  if (samples.length < 8) return { ...survivalStat(samples.map(({ outcome }) => outcome), horizonDays, formulaKey), sampleMode: 'conditional-shrunk' };

  const globalRate = mean(samples.map(({ outcome }) => outcome));
  const weighted = samples.map((sample) => {
    const weight = strikeConditionalWeight(sample, condition);
    return { outcome: sample.outcome, weight };
  });
  const totalWeight = weighted.reduce((sum, sample) => sum + sample.weight, 0);
  const squaredWeight = weighted.reduce((sum, sample) => sum + sample.weight ** 2, 0);
  if (!(totalWeight > 0) || !(squaredWeight > 0)) return { ...survivalStat(samples.map(({ outcome }) => outcome), horizonDays, formulaKey), sampleMode: 'conditional-shrunk' };
  const conditionalRate = weighted.reduce((sum, sample) => sum + sample.outcome * sample.weight, 0) / totalWeight;
  const conditionalEffectiveN = (totalWeight ** 2) / squaredWeight;
  const priorEffectiveN = 20;
  const value = (conditionalEffectiveN * conditionalRate + priorEffectiveN * globalRate) / (conditionalEffectiveN + priorEffectiveN);
  const effectiveN = conditionalEffectiveN + priorEffectiveN;
  const interval = wilsonInterval(value, effectiveN);
  return {
    value,
    n: samples.length,
    windowDays: horizonDays,
    formulaKey,
    confidence: confidenceFor(samples.length),
    interval: { ...interval, effectiveN, method: 'conditional-shrinkage-wilson' },
    sampleMode: 'conditional-shrunk',
  };
}

export type StrikeSurvivalAsOf = {
  sigmaDist: number;
  horizonDays: number;
  close: SellerStat;
  noTouch: SellerStat;
};

/**
 * 用当前 as-of 价格、日频 sigma 和 short strike 计算精确行权价的路径生存率。
 * bars 必须只包含观察截止日之前的数据；函数不会读取未来 bar。
 */
export function computeStrikeSurvivalAtAsOf(
  bars: OHLCBar[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
): StrikeSurvivalAsOf | null {
  if (!(spot > 0) || !(shortStrike > 0) || !(shortStrike < spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays) || horizonDays <= 0) return null;
  const sigmaDist = (spot - shortStrike) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const condition = buildStrikeSurvivalCondition(bars, currentSigma);
  const compute = (barrier: StrikeSurvivalBarrier) => condition
    ? computeConditionalStrikeSurvivalForHorizon(bars, sigmaDist, horizonDays, condition, barrier)
    : computeStrikeSurvivalForHorizon(bars, sigmaDist, horizonDays, barrier);
  return { sigmaDist, horizonDays, close: compute('close'), noTouch: compute('intraday') };
}

function computeStrikeSurvivalStatFromSamples(
  samples: StrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  condition: StrikeSurvivalCondition | null,
  barrier: StrikeSurvivalBarrier,
  sampleLimit = samples.length,
  cachedWeights?: StrikeConditionalWeights,
): SellerStat {
  const sigmaDist = (spot - shortStrike) / spot / currentSigma;
  const limit = Math.min(sampleLimit, samples.length);
  const outcomes: number[] = [];
  let outcomeSum = 0;
  for (let index = 0; index < limit; index++) {
    const sample = samples[index]!;
    const outcome = sample.futureMinRatio >= 1 - sigmaDist * sample.sigma ? 1 : 0;
    outcomes.push(outcome);
    outcomeSum += outcome;
  }
  const formulaKey = strikeSurvivalFormulaKey(barrier, Boolean(condition));
  return conditionalSurvivalStat(outcomes,samples,condition,horizonDays,formulaKey,cachedWeights,outcomeSum);
}

/** Direction, maturity and formula labels stay with the caller; ordered estimation is shared. */
function conditionalSurvivalStat(outcomes:number[],samples:readonly Omit<StrikeSurvivalSample,'outcome'>[],
  condition:StrikeSurvivalCondition|null,horizonDays:number,formulaKey:string,
  cachedWeights?:StrikeConditionalWeights,outcomeSum?:number):SellerStat {
  if (!condition || outcomes.length < 8) return survivalStat(outcomes, horizonDays, formulaKey);

  const globalRate = outcomeSum===undefined?mean(outcomes):outcomeSum/outcomes.length;
  let totalWeight = 0, squaredWeight = 0, weightedOutcomeSum = 0;
  if(cachedWeights&&cachedWeights.values.length===outcomes.length){
    // Moments use the identical mature sample order, once per as-of cohort.
    totalWeight=cachedWeights.totalWeight;squaredWeight=cachedWeights.squaredWeight;
    for(let index=0;index<outcomes.length;index++)weightedOutcomeSum+=outcomes[index]!*cachedWeights.values[index]!;
  }else{
    for (let index = 0; index < outcomes.length; index++) {
      const weight = cachedWeights?.values[index] ?? strikeConditionalWeight(samples[index]!, condition);
      totalWeight += weight;squaredWeight += weight ** 2;weightedOutcomeSum += outcomes[index]! * weight;
    }
  }
  if (!(totalWeight > 0) || !(squaredWeight > 0)) return survivalStat(outcomes, horizonDays, formulaKey);
  const conditionalRate = weightedOutcomeSum / totalWeight;
  const conditionalEffectiveN = (totalWeight ** 2) / squaredWeight;
  const priorEffectiveN = 20;
  const value = (conditionalEffectiveN * conditionalRate + priorEffectiveN * globalRate) / (conditionalEffectiveN + priorEffectiveN);
  const effectiveN = conditionalEffectiveN + priorEffectiveN;
  const interval = wilsonInterval(value, effectiveN);
  return {
    value,
    n: outcomes.length,
    windowDays: horizonDays,
    formulaKey,
    confidence: confidenceFor(outcomes.length),
    interval: { ...interval, effectiveN, method: 'conditional-shrinkage-wilson' },
    sampleMode: 'conditional-shrunk',
  };
}

function computeStrikeSurvivalFromSamples(
  closeSamples: StrikeSurvivalBaseSample[],
  noTouchSamples: StrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  condition: StrikeSurvivalCondition | null,
  closeSampleLimit = closeSamples.length,
  noTouchSampleLimit = noTouchSamples.length,
  closeWeights?: StrikeConditionalWeights,
  noTouchWeights?: StrikeConditionalWeights,
): StrikeSurvivalAsOf | null {
  const sigmaDist = (spot - shortStrike) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  return {
    sigmaDist,
    horizonDays,
    close: computeStrikeSurvivalStatFromSamples(closeSamples, spot, shortStrike, currentSigma, horizonDays, condition, 'close', closeSampleLimit, closeWeights),
    noTouch: computeStrikeSurvivalStatFromSamples(noTouchSamples, spot, shortStrike, currentSigma, horizonDays, condition, 'intraday', noTouchSampleLimit, noTouchWeights),
  };
}

type CallStrikeSurvivalBaseSample = Omit<StrikeSurvivalSample, 'outcome'> & { futureMaxRatio: number };
type CallStrikeSurvivalBaseCache = { samples: CallStrikeSurvivalBaseSample[]; computedThrough: number };
const callStrikeSurvivalBaseCache = new WeakMap<object, Map<string, CallStrikeSurvivalBaseCache>>();

function collectCallStrikeSurvivalBaseSamples(
  bars: OHLCBar[],
  horizonDays: number,
  barrier: StrikeSurvivalBarrier,
): CallStrikeSurvivalBaseSample[] {
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) return [];
  let byHorizon = callStrikeSurvivalBaseCache.get(bars);
  if (!byHorizon) {
    byHorizon = new Map();
    callStrikeSurvivalBaseCache.set(bars, byHorizon);
  }
  const cacheKey = `${horizonDays}|${barrier}`;
  let cache = byHorizon.get(cacheKey);
  if (!cache) {
    cache = { samples: [], computedThrough: 19 };
    byHorizon.set(cacheKey, cache);
  }
  const lastMaturedIndex = bars.length - 1 - horizonDays;
  for (let index = cache.computedThrough + 1; index <= lastMaturedIndex; index++) {
    const features = cachedStrikeSurvivalFeatures(bars, index);
    if (!features) continue;
    const futureMax = barrier === 'intraday'
      ? Math.max(...bars.slice(index + 1, index + horizonDays + 1).map(({ high }) => high))
      : maxClose(bars, index + 1, index + horizonDays);
    cache.samples.push({ ...features, futureMaxRatio: futureMax / bars[index]!.close });
  }
  cache.computedThrough = Math.max(cache.computedThrough, lastMaturedIndex);
  return cache.samples;
}

function collectCallStrikeSurvivalSamples(
  bars: OHLCBar[],
  sigmaDist: number,
  horizonDays: number,
  barrier: StrikeSurvivalBarrier,
): StrikeSurvivalSample[] {
  if (!Number.isFinite(sigmaDist) || !Number.isInteger(horizonDays) || horizonDays <= 0) return [];
  return collectCallStrikeSurvivalBaseSamples(bars, horizonDays, barrier).map(({ futureMaxRatio, sigma, drawdown20Pct, trend20Sigma }) => ({
    sigma,
    drawdown20Pct,
    trend20Sigma,
    outcome: futureMaxRatio <= 1 + sigmaDist * sigma ? 1 : 0,
  }));
}

function callStrikeSurvivalConditionAtAsOf(
  bars: OHLCBar[],
  asOfIndex: number,
  currentSigma: number,
): StrikeSurvivalCondition | null {
  if (asOfIndex < 20 || !(currentSigma > 0) || !Number.isFinite(currentSigma)) return null;
  const close = bars[asOfIndex]?.close;
  const priorClose = bars[asOfIndex - 20]?.close;
  if (!(close && close > 0) || !(priorClose && priorClose > 0)) return null;
  const high20 = Math.max(...bars.slice(asOfIndex - 20, asOfIndex + 1).map(({ high }) => high));
  if (!(high20 > 0)) return null;
  return {
    currentSigma,
    currentDrawdown20Pct: close / high20 - 1,
    currentTrend20Sigma: Math.log(close / priorClose) / (currentSigma * Math.sqrt(20)),
  };
}

function computeCallStrikeSurvivalStat(
  samples: CallStrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  condition: StrikeSurvivalCondition | null,
  barrier: StrikeSurvivalBarrier,
  sampleLimit = samples.length,
  conditionalWeights?: StrikeConditionalWeights,
): SellerStat {
  const sigmaDist = (shortStrike - spot) / spot / currentSigma;
  const limit = Math.min(sampleLimit, samples.length);
  const outcomes:number[] = [];
  for (let index = 0; index < limit; index++) {
    const sample = samples[index]!;
    outcomes.push(sample.futureMaxRatio <= 1 + sigmaDist * sample.sigma ? 1 : 0);
  }
  const formulaKey = barrier === 'intraday' ? 'sellCallStrikeNoTouchDte' : 'sellCallStrikeSurvivalDte';
  return conditionalSurvivalStat(outcomes,samples,condition,horizonDays,formulaKey,conditionalWeights);
}

function computeCallStrikeSurvivalFromSamples(
  closeSamples: CallStrikeSurvivalBaseSample[],
  noTouchSamples: CallStrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  condition: StrikeSurvivalCondition | null,
  closeSampleLimit = closeSamples.length,
  noTouchSampleLimit = noTouchSamples.length,
  closeWeights?: StrikeConditionalWeights,
  noTouchWeights?: StrikeConditionalWeights,
): StrikeSurvivalAsOf | null {
  const sigmaDist = (shortStrike - spot) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  return {
    sigmaDist,
    horizonDays,
    close: computeCallStrikeSurvivalStat(closeSamples, spot, shortStrike, currentSigma, horizonDays, condition, 'close', closeSampleLimit, closeWeights),
    noTouch: computeCallStrikeSurvivalStat(noTouchSamples, spot, shortStrike, currentSigma, horizonDays, condition, 'intraday', noTouchSampleLimit, noTouchWeights),
  };
}

type CallStrikeSurvivalBaseSampleCache = { samples: CallStrikeSurvivalBaseSample[]; computedThrough: number };

/**
 * 增量维护 Call 侧 as-of 历史样本。每个回测 arm 独立持有，绝不跨策略共享账本或决策状态。
 * 只缓存已成熟的历史路径，计算结果与逐日 prefix 全量重算保持一致。
 */
export class CallStrikeSurvivalAsOf {
  private readonly dateIndex = new Map<string, number>();
  private readonly baseSamples = new Map<string, {
    samples: Array<CallStrikeSurvivalBaseSample & { index: number }>;
    computedThrough: number;
  }>();
  private readonly survivalCache = new Map<string, StrikeSurvivalAsOf | null>();
  private readonly tailCache = new Map<string, CallStrikeTailLossAtAsOf | null>();
  private readonly tailCohortCache = new Map<string,CallTailCohort>();
  private readonly futureMaxCache = new Map<string, number[]>();
  private readonly conditionalWeightCache = new Map<string, StrikeConditionalWeights>();
  private weightedAsOfIndex = -1;

  private resultAsOfIndex = -1;
  constructor(private readonly bars: OHLCBar[], private readonly options: {resultCache?:'current-bar'} = {}) {
    bars.forEach((bar, index) => this.dateIndex.set(bar.date, index));
  }

  /** Opt-in bounded replay cache; mature historical samples remain independently indexed. */
  private prepareResultCache(asOfIndex:number) {
    if(this.options.resultCache==='current-bar'&&this.resultAsOfIndex!==asOfIndex){
      this.survivalCache.clear();this.tailCache.clear();this.tailCohortCache.clear();this.resultAsOfIndex=asOfIndex;
    }
  }

  private futureMax(horizonDays: number, barrier: StrikeSurvivalBarrier): number[] {
    const key = `${horizonDays}|${barrier}`;
    const cached = this.futureMaxCache.get(key);
    if (cached) return cached;
    const values = buildForwardExtrema(this.bars, horizonDays, barrier === 'intraday' ? 'maxHigh' : 'maxClose');
    this.futureMaxCache.set(key, values);
    return values;
  }

  private collectBaseSamples(asOfIndex: number, horizonDays: number, barrier: StrikeSurvivalBarrier): SampleWindow<CallStrikeSurvivalBaseSample> {
    const cacheKey = `${horizonDays}|${barrier}`;
    let cache = this.baseSamples.get(cacheKey);
    if (!cache) {
      cache = { samples: [], computedThrough: 19 };
      this.baseSamples.set(cacheKey, cache);
    }
    const lastMaturedIndex = asOfIndex - horizonDays;
    for (let index = cache.computedThrough + 1; index <= lastMaturedIndex; index++) {
      const features = cachedStrikeSurvivalFeatures(this.bars, index);
      if (!features) continue;
      const futureMax = this.futureMax(horizonDays, barrier)[index]!;
      cache.samples.push({ ...features, futureMaxRatio: futureMax / this.bars[index]!.close, index });
    }
    cache.computedThrough = Math.max(cache.computedThrough, lastMaturedIndex);
    return { samples: cache.samples, count: upperBoundByIndex(cache.samples, lastMaturedIndex) };
  }

  private weights(asOfIndex:number,horizonDays:number,barrier:StrikeSurvivalBarrier,currentSigma:number,
    window:SampleWindow<CallStrikeSurvivalBaseSample>,condition:StrikeSurvivalCondition|null):StrikeConditionalWeights|undefined {
    if(this.options.resultCache!=='current-bar'||!condition)return undefined;
    if(this.weightedAsOfIndex!==asOfIndex){this.conditionalWeightCache.clear();this.weightedAsOfIndex=asOfIndex;}
    const key=`${horizonDays}|${barrier}|${currentSigma}`;
    let weights=this.conditionalWeightCache.get(key);
    if(!weights){weights=strikeConditionalWeights(window.samples,window.count,condition);this.conditionalWeightCache.set(key,weights);}
    return weights;
  }

  compute(
    asOfDate: string,
    spot: number,
    shortStrike: number,
    currentSigma: number,
    horizonDays: number,
  ): StrikeSurvivalAsOf | null {
    const asOfIndex = this.dateIndex.get(asOfDate);
    if (asOfIndex === undefined || !(spot > 0) || !(shortStrike > spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays) || horizonDays <= 0) return null;
    this.prepareResultCache(asOfIndex);
    const cacheKey = `${asOfIndex}|${spot}|${shortStrike}|${currentSigma}|${horizonDays}`;
    if (this.survivalCache.has(cacheKey)) return this.survivalCache.get(cacheKey)!;
    const condition = callStrikeSurvivalConditionAtAsOf(this.bars, asOfIndex, currentSigma);
    const closeSamples = this.collectBaseSamples(asOfIndex, horizonDays, 'close');
    const noTouchSamples = this.collectBaseSamples(asOfIndex, horizonDays, 'intraday');
    const result = computeCallStrikeSurvivalFromSamples(
      closeSamples.samples,
      noTouchSamples.samples,
      spot,
      shortStrike,
      currentSigma,
      horizonDays,
      condition,
      closeSamples.count,
      noTouchSamples.count,
      this.weights(asOfIndex,horizonDays,'close',currentSigma,closeSamples,condition),
      this.weights(asOfIndex,horizonDays,'intraday',currentSigma,noTouchSamples,condition),
    );
    this.survivalCache.set(cacheKey, result);
    return result;
  }

  computeTail(
    asOfDate: string,
    spot: number,
    shortStrike: number,
    currentSigma: number,
    horizonDays: number,
    widthPct: number,
    credit: number,
    maxLoss: number,
  ): CallStrikeTailLossAtAsOf | null {
    const asOfIndex = this.dateIndex.get(asOfDate);
    if (asOfIndex === undefined || !(spot > 0) || !(shortStrike > spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma)
      || !Number.isInteger(horizonDays) || horizonDays <= 0 || !(widthPct > 0) || !(credit > 0) || !(maxLoss > 0)) return null;
    this.prepareResultCache(asOfIndex);
    const cacheKey = `${asOfIndex}|${spot}|${shortStrike}|${currentSigma}|${horizonDays}|${widthPct}|${credit}|${maxLoss}`;
    if (this.tailCache.has(cacheKey)) return this.tailCache.get(cacheKey)!;
    const samples = this.collectBaseSamples(asOfIndex, horizonDays, 'intraday');
    const condition=callStrikeSurvivalConditionAtAsOf(this.bars,asOfIndex,currentSigma);
    const weights=this.weights(asOfIndex,horizonDays,'intraday',currentSigma,samples,condition);
    const cohortKey=`${spot}|${shortStrike}|${currentSigma}|${horizonDays}`;
    let cohort=this.tailCohortCache.get(cohortKey);
    if(this.options.resultCache==='current-bar'&&!cohort){
      cohort=collectCallTailCohort(samples.samples,(shortStrike-spot)/spot/currentSigma,condition,samples.count,weights);
      this.tailCohortCache.set(cohortKey,cohort);
    }
    const result = computeCallStrikeTailLossFromSamples(
      samples.samples,
      spot,
      shortStrike,
      currentSigma,
      horizonDays,
      widthPct,
      credit,
      maxLoss,
      condition,
      samples.count,
      weights,
      cohort,
    );
    this.tailCache.set(cacheKey, result);
    return result;
  }
}

/**
 * Call 侧对称的路径生存率：以当前 spot 上方的 short call 为 barrier，
 * 统计未来窗口内收盘/盘中高点从未触碰该 barrier 的比例。
 * bars 只允许包含 as-of 之前的数据，避免把未来信息带入选价。
 */
export function computeCallStrikeSurvivalAtAsOf(
  bars: OHLCBar[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
): StrikeSurvivalAsOf | null {
  if (!(spot > 0) || !(shortStrike > spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays) || horizonDays <= 0) return null;
  const sigmaDist = (shortStrike - spot) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const condition = buildStrikeSurvivalCondition(bars, currentSigma);
  return computeCallStrikeSurvivalFromSamples(
    collectCallStrikeSurvivalBaseSamples(bars, horizonDays, 'close'),
    collectCallStrikeSurvivalBaseSamples(bars, horizonDays, 'intraday'),
    spot,
    shortStrike,
    currentSigma,
    horizonDays,
    condition,
  );
}

/**
 * PCS-CS 组合选约研究代理：在历史 as-of 路径上同时使用未来最低/最高价，
 * 估算一组 PCS 与一组 CS 的到期内定义风险 P&L。它只用于候选排序，不代表
 * 真实成交组合或实时风险预算；当前 bars 必须只包含 as-of 之前的数据。
 */
type PairPathSample = {
  futureMinRatio: number;
  futureMaxRatio: number;
  sigma: number;
  drawdown20Pct: number;
  trend20Sigma: number;
};

const pairPathCache = new WeakMap<object, Map<number, PairPathSample[]>>();

function collectPairPathSamples(bars: OHLCBar[], horizonDays: number): PairPathSample[] {
  let byHorizon = pairPathCache.get(bars);
  if (!byHorizon) {
    byHorizon = new Map();
    pairPathCache.set(bars, byHorizon);
  }
  const cached = byHorizon.get(horizonDays);
  if (cached) return cached;
  const samples: PairPathSample[] = [];
  const lastMaturedIndex = bars.length - 1 - horizonDays;
  for (let index = 20; index <= lastMaturedIndex; index++) {
    const asOf = bars[index];
    const features = cachedStrikeSurvivalFeatures(bars, index);
    if (!asOf || !features) continue;
    const futureBars = bars.slice(index + 1, index + horizonDays + 1);
    if (futureBars.length < horizonDays) continue;
    samples.push({
      futureMinRatio: Math.min(...futureBars.map(({ low }) => low)) / asOf.close,
      futureMaxRatio: Math.max(...futureBars.map(({ high }) => high)) / asOf.close,
      sigma: features.sigma,
      drawdown20Pct: features.drawdown20Pct,
      trend20Sigma: features.trend20Sigma,
    });
  }
  byHorizon.set(horizonDays, samples);
  return samples;
}

export function computePcsCsPairExpectedPnlAtAsOf(
  bars: OHLCBar[],
  spot: number,
  currentSigma: number,
  horizonDays: number,
  pcsShortStrike: number,
  pcsLongStrike: number,
  pcsCredit: number,
  csShortStrike: number,
  csLongStrike: number,
  csCredit: number,
): number | null {
  if (!(spot > 0) || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays) || horizonDays <= 0
    || !(pcsShortStrike > pcsLongStrike) || !(pcsCredit > 0) || !(csLongStrike > csShortStrike) || !(csCredit > 0)
    || bars.length <= horizonDays + 20) return null;
  const condition = buildStrikeSurvivalCondition(bars, currentSigma);
  const pathSamples = collectPairPathSamples(bars, horizonDays);
  let weightedPnl = 0;
  let totalWeight = 0;
  for (const sample of pathSamples) {
    const weight = condition
      ? strikeConditionalWeight(sample, condition)
      : 1;
    if (!(weight > 0) || !Number.isFinite(weight)) continue;
    const futureLow = spot * sample.futureMinRatio;
    const futureHigh = spot * sample.futureMaxRatio;
    const pcsIntrinsicLoss = Math.min(Math.max(pcsShortStrike - futureLow, 0), pcsShortStrike - pcsLongStrike) * 100;
    const csIntrinsicLoss = Math.min(Math.max(futureHigh - csShortStrike, 0), csLongStrike - csShortStrike) * 100;
    const pairPnl = pcsCredit * 100 - pcsIntrinsicLoss + csCredit * 100 - csIntrinsicLoss;
    weightedPnl += pairPnl * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 && Number.isFinite(weightedPnl / totalWeight) ? weightedPnl / totalWeight : null;
}

export type CallStrikeTailLossAtAsOf = {
  sigmaDist: number;
  horizonDays: number;
  conditionalLoss: SellerStat;
  conditionalLossP75: SellerStat;
  conditionalLossCvar75: SellerStat;
  conditionalRisePct: SellerStat;
};

type CallTailCohort={excessRatios:number[];riseValues:number[];weights:number[];
  lossOrder?:number[];totalWeight?:number;effectiveN?:number;riseStat?:SellerStat};
function collectCallTailCohort(samples:CallStrikeSurvivalBaseSample[],sigmaDist:number,
  condition:StrikeSurvivalCondition|null,sampleLimit:number,conditionalWeights?:StrikeConditionalWeights):CallTailCohort {
  const excessRatios:number[]=[],riseValues:number[]=[],weights:number[]=[];
  for(let index=0;index<Math.min(sampleLimit,samples.length);index++){
    const sample=samples[index]!,thresholdRatio=1+sigmaDist*sample.sigma;
    if(!(sample.futureMaxRatio>thresholdRatio))continue;
    const weight=condition?conditionalWeights?.values[index]??strikeConditionalWeight(sample,condition):1;
    if(!(weight>0)||!Number.isFinite(weight))continue;
    excessRatios.push(sample.futureMaxRatio-thresholdRatio);
    riseValues.push(Math.max(0,sample.futureMaxRatio-1)*100);weights.push(weight);
  }
  return {excessRatios,riseValues,weights};
}
function computeCallStrikeTailLossFromSamples(
  samples: CallStrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  widthPct: number,
  credit: number,
  maxLoss: number,
  condition: StrikeSurvivalCondition | null,
  sampleLimit = samples.length,
  conditionalWeights?: StrikeConditionalWeights,
  cohort?:CallTailCohort,
): CallStrikeTailLossAtAsOf | null {
  const sigmaDist = (shortStrike - spot) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const lossValues: number[] = [];
  const sampleCohort=cohort??collectCallTailCohort(samples,sigmaDist,condition,sampleLimit,conditionalWeights);
  const {excessRatios,riseValues,weights}=sampleCohort;
  const creditRatio = credit / spot;
  let weightedLossSum=0;
  for (let index=0;index<excessRatios.length;index++) {
    const excess=excessRatios[index]!;
    const intrinsicRatio = Math.min(Math.max(excess, 0), widthPct);
    const loss = Math.min(maxLoss, Math.max(0, (intrinsicRatio - creditRatio) * spot * 100));
    lossValues.push(loss);
    weightedLossSum+=loss*weights[index]!;
  }
  let quantile:number|null|undefined;
  const lossP75=()=>{
    sampleCohort.lossOrder??=excessRatios.map((_,i)=>i).sort((a,b)=>excessRatios[a]!-excessRatios[b]!);
    return quantile===undefined?(quantile=weightedQuantile(lossValues,weights,.75,maxLoss,sampleCohort.lossOrder)):quantile;
  };
  const totalWeight=sampleCohort.totalWeight??=weights.reduce((sum,weight)=>sum+weight,0);
  const effectiveN=sampleCohort.effectiveN??=weightedEffectiveSampleSize(weights);
  sampleCohort.riseStat??=weightedConditionalStat(riseValues,weights,horizonDays,'sellCallStrikeConditionalRisePctDte',totalWeight);
  return {
    sigmaDist,
    horizonDays,
    conditionalLoss: weightedConditionalStat(lossValues, weights, horizonDays, 'sellCallStrikeConditionalLossDte',totalWeight,weightedLossSum),
    conditionalLossP75: weightedTailStat(lossValues, weights, horizonDays, 'sellCallStrikeConditionalLossP75Dte', 12, 8, lossP75,effectiveN),
    conditionalLossCvar75: weightedTailStat(lossValues, weights, horizonDays, 'sellCallStrikeConditionalLossCvar75Dte', 20, 10, (values, sampleWeights) => weightedTailMean(values, sampleWeights, .75,lossP75()),effectiveN),
    conditionalRisePct: {...sampleCohort.riseStat},
  };
}

/** Call 侧对称尾损：仅在未来盘中高点触碰 short call 后，按当前价差映射条件损失。 */
export function computeCallStrikeTailLossAtAsOf(
  bars: OHLCBar[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  widthPct: number,
  credit: number,
  maxLoss: number,
): CallStrikeTailLossAtAsOf | null {
  if (!(spot > 0) || !(shortStrike > spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma)
    || !Number.isInteger(horizonDays) || horizonDays <= 0 || !(widthPct > 0) || !(credit > 0) || !(maxLoss > 0)) return null;
  const sigmaDist = (shortStrike - spot) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const samples = collectCallStrikeSurvivalBaseSamples(bars, horizonDays, 'intraday');
  const condition = buildStrikeSurvivalCondition(bars, currentSigma);
  return computeCallStrikeTailLossFromSamples(samples, spot, shortStrike, currentSigma, horizonDays, widthPct, credit, maxLoss, condition);
}

export type StrikeTailLossAtAsOf = {
  sigmaDist: number;
  horizonDays: number;
  /** 仅在历史击穿样本内，按当前价差结构映射的平均每张条件损失。 */
  conditionalLoss: SellerStat;
  /** 击穿样本内，条件损失的加权第 75 百分位。 */
  conditionalLossP75: SellerStat;
  /** 击穿样本内，超过 P75 的最差 25% 条件损失加权均值。 */
  conditionalLossCvar75: SellerStat;
  /** 仅在历史击穿样本内，从 as-of 收盘到未来最低价的平均跌幅（正数百分比）。 */
  conditionalDropPct: SellerStat;
};

function computeStrikeTailLossFromSamples(
  samples: StrikeSurvivalBaseSample[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  widthPct: number,
  credit: number,
  maxLoss: number,
  condition: StrikeSurvivalCondition | null,
  sampleLimit = samples.length,
  cachedWeights?: StrikeConditionalWeights,
): StrikeTailLossAtAsOf | null {
  const sigmaDist = (spot - shortStrike) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const lossValues: number[] = [];
  const dropValues: number[] = [];
  const weights: number[] = [];
  const creditRatio = credit / spot;
  let totalWeight=0,weightedLossSum=0,weightedDropSum=0;

  for (let index = 0; index < Math.min(sampleLimit, samples.length); index++) {
    const sample = samples[index]!;
    const thresholdRatio = 1 - sigmaDist * sample.sigma;
    if (!(sample.futureMinRatio < thresholdRatio)) continue;
    const weight = condition
      ? cachedWeights?.values[index] ?? strikeConditionalWeight(sample, condition)
      : 1;
    if (!(weight > 0) || !Number.isFinite(weight)) continue;
    const intrinsicRatio = Math.min(Math.max(thresholdRatio - sample.futureMinRatio, 0), widthPct);
    const loss = Math.min(maxLoss, Math.max(0, (intrinsicRatio - creditRatio) * spot * 100));
    lossValues.push(loss);
    const drop=Math.max(0, 1 - sample.futureMinRatio) * 100;
    dropValues.push(drop);
    weights.push(weight);
    totalWeight+=weight;weightedLossSum+=loss*weight;weightedDropSum+=drop*weight;
  }

  let quantile:number|null|undefined;
  const lossP75=()=>quantile===undefined?(quantile=weightedQuantile(lossValues,weights,.75,maxLoss)):quantile;
  const effectiveN=weightedEffectiveSampleSize(weights);
  return {
    sigmaDist,
    horizonDays,
    conditionalLoss: weightedConditionalStat(lossValues, weights, horizonDays, 'sellPutStrikeConditionalLossDte',totalWeight,weightedLossSum),
    conditionalLossP75: weightedTailStat(lossValues, weights, horizonDays, 'sellPutStrikeConditionalLossP75Dte', 12, 8, lossP75,effectiveN),
    conditionalLossCvar75: weightedTailStat(lossValues, weights, horizonDays, 'sellPutStrikeConditionalLossCvar75Dte', 20, 10, (values, sampleWeights) => weightedTailMean(values, sampleWeights, .75,lossP75()),effectiveN),
    conditionalDropPct: weightedConditionalStat(lossValues.length ? dropValues : [], weights, horizonDays, 'sellPutStrikeConditionalDropPctDte',totalWeight,weightedDropSum),
  };
}

function weightedConditionalStat(
  values: number[],
  weights: number[],
  windowDays: number,
  formulaKey: string,
  totalWeight=weights.reduce((sum,weight)=>sum+weight,0),
  weightedSum?:number,
): SellerStat {
  const value = values.length < 8 || !(totalWeight > 0)
    ? null
    : (weightedSum??values.reduce((sum, item, index) => sum + item * weights[index]!, 0)) / totalWeight;
  return { value, n: values.length, windowDays, formulaKey, confidence: confidenceFor(values.length) };
}

function weightedEffectiveSampleSize(weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const squared = weights.reduce((sum, weight) => sum + weight ** 2, 0);
  return squared > 0 ? (total ** 2) / squared : 0;
}

function weightedQuantile(values: number[], weights: number[], probability: number,ceiling=Infinity,
  monotoneOrder?:readonly number[]): number | null {
  if (!values.length) return null;
  const zero:number[]=[],middle:number[]=[],capped:number[]=[];
  let bounded=true;
  for(let i=0;i<values.length;i++){
    if(!(values[i]!>=0&&values[i]!<=ceiling))bounded=false;
    if(values[i]===0)zero.push(i);
    else if(values[i]===ceiling)capped.push(i);
    else if(!monotoneOrder)middle.push(i);
  }
  if(monotoneOrder&&bounded){
    for(const i of monotoneOrder)if(values[i]!==0&&values[i]!==ceiling)middle.push(i);
    // Monotone clipping/rounding can create NEW ties: restore original sample order.
    for(let from=0;from<middle.length;){
      let to=from+1;
      while(to<middle.length&&values[middle[to]!]===values[middle[from]!])to++;
      if(to-from>1){const ties=middle.slice(from,to).sort((a,b)=>a-b);for(let i=from;i<to;i++)middle[i]=ties[i-from]!;}
      from=to;
    }
  }else middle.sort((a,b)=>values[a]!-values[b]!);
  // Losses are clipped to [0, ceiling]; keep original tie order and sorted weight summation.
  const order=bounded?zero.concat(middle,capped):values.map((_,index)=>index).sort((a,b)=>values[a]!-values[b]!);
  const totalWeight = order.reduce((sum,index) => sum + weights[index]!, 0);
  if (!(totalWeight > 0)) return null;
  const target = totalWeight * Math.min(1, Math.max(0, probability));
  let cumulative = 0;
  for (const index of order) {
    cumulative += weights[index]!;
    if (cumulative >= target) return values[index]!;
  }
  return values[order.at(-1)!]!;
}

function weightedTailMean(values: number[], weights: number[], probability: number,
  threshold=weightedQuantile(values,weights,probability)): number | null {
  if (threshold === null) return null;
  let totalWeight=0,weightedValue=0;
  values.forEach((value, index) => {
    if (value >= threshold) {
      totalWeight+=weights[index]!;
      weightedValue+=value*weights[index]!;
    }
  });
  return totalWeight > 0 ? weightedValue / totalWeight : null;
}

function weightedTailStat(
  values: number[],
  weights: number[],
  windowDays: number,
  formulaKey: string,
  minimumRawN: number,
  minimumEffectiveN: number,
  aggregate: (values: number[], weights: number[]) => number | null,
  effectiveN = weightedEffectiveSampleSize(weights),
): SellerStat {
  const value = values.length < minimumRawN || effectiveN < minimumEffectiveN ? null : aggregate(values, weights);
  return { value, n: values.length, windowDays, formulaKey, confidence: confidenceFor(values.length) };
}

/**
 * 计算精确短腿在历史击穿后的条件损失，而不是把每次击穿都粗略记成 maxLoss。
 *
 * 历史路径仍只使用 bars 截止日以前的数据；未来窗口用日内 low 观察首次触碰/穿透。
 * threshold 以上的跌幅按当前价差的宽度和 credit 映射到每张合约损失，并在保护腿处封顶。
 */
export function computeStrikeTailLossAtAsOf(
  bars: OHLCBar[],
  spot: number,
  shortStrike: number,
  currentSigma: number,
  horizonDays: number,
  widthPct: number,
  credit: number,
  maxLoss: number,
): StrikeTailLossAtAsOf | null {
  if (!(spot > 0) || !(shortStrike > 0) || !(shortStrike < spot) || !(currentSigma > 0) || !Number.isFinite(currentSigma)
    || !Number.isInteger(horizonDays) || horizonDays <= 0 || !(widthPct > 0) || !(credit > 0) || !(maxLoss > 0)) return null;
  const sigmaDist = (spot - shortStrike) / spot / currentSigma;
  if (!(sigmaDist > 0) || !Number.isFinite(sigmaDist)) return null;
  const samples = collectStrikeSurvivalBaseSamples(bars, horizonDays, 'intraday');
  const condition = buildStrikeSurvivalCondition(bars, currentSigma);
  return computeStrikeTailLossFromSamples(samples, spot, shortStrike, currentSigma, horizonDays, widthPct, credit, maxLoss, condition);
}

type PutStrikeSurvivalBaseSample = StrikeSurvivalBaseSample & { index: number };
type PutStrikeSurvivalBaseSampleCache = {
  samples: PutStrikeSurvivalBaseSample[];
  computedThrough: number;
};

/**
 * 增量维护 Put 侧精确行权价生存率。只缓存市场路径样本，不包含任何 arm 状态。
 * 查询按 as-of index 截断，确保共享预计算不会引入未来数据。
 */
type StrikeConditionalWeights={values:readonly number[];totalWeight:number;squaredWeight:number};
function strikeConditionalWeights(samples: ReadonlyArray<Pick<StrikeSurvivalBaseSample, 'sigma' | 'drawdown20Pct' | 'trend20Sigma'>>, count: number, condition: StrikeSurvivalCondition): StrikeConditionalWeights {
  const weights: number[] = [];
  let totalWeight=0,squaredWeight=0;
  for (let index = 0; index < count; index++) {
    const source = samples[index]!;
    const weight=strikeConditionalWeight(source, condition);
    weights.push(weight);totalWeight+=weight;squaredWeight+=weight**2;
  }
  return {values:weights,totalWeight,squaredWeight};
}

export class PutStrikeSurvivalAsOf {
  private readonly dateIndex = new Map<string, number>();
  private readonly baseSamples = new Map<string, PutStrikeSurvivalBaseSampleCache>();
  private readonly survivalCache = new Map<string, StrikeSurvivalAsOf | null>();
  private readonly tailCache = new Map<string, StrikeTailLossAtAsOf | null>();
  private readonly futureMinCache = new Map<string, number[]>();
  private weightedAsOfIndex = -1;
  private readonly conditionalWeightCache = new Map<string, StrikeConditionalWeights>();

  private resultAsOfIndex = -1;
  constructor(private readonly bars: OHLCBar[], private readonly options: {resultCache?:'current-bar'} = {}) {
    bars.forEach((bar, index) => this.dateIndex.set(bar.date, index));
  }

  /** Opt-in bounded replay cache; mature historical samples remain independently indexed. */
  private prepareResultCache(asOfIndex:number) {
    if(this.options.resultCache==='current-bar'&&this.resultAsOfIndex!==asOfIndex){
      this.survivalCache.clear();this.tailCache.clear();this.resultAsOfIndex=asOfIndex;
    }
  }

  private futureMin(horizonDays: number, barrier: StrikeSurvivalBarrier): number[] {
    const key = `${horizonDays}|${barrier}`;
    const cached = this.futureMinCache.get(key);
    if (cached) return cached;
    const values = buildForwardExtrema(this.bars, horizonDays, barrier === 'intraday' ? 'minLow' : 'minClose');
    this.futureMinCache.set(key, values);
    return values;
  }

  private collectBaseSamples(asOfIndex: number, horizonDays: number, barrier: StrikeSurvivalBarrier): SampleWindow<StrikeSurvivalBaseSample> {
    const cacheKey = `${horizonDays}|${barrier}`;
    let cache = this.baseSamples.get(cacheKey);
    if (!cache) {
      cache = { samples: [], computedThrough: 19 };
      this.baseSamples.set(cacheKey, cache);
    }
    const lastMaturedIndex = asOfIndex - horizonDays;
    for (let index = cache.computedThrough + 1; index <= lastMaturedIndex; index++) {
      const features = cachedStrikeSurvivalFeatures(this.bars, index);
      if (!features) continue;
      const futureMin = this.futureMin(horizonDays, barrier)[index]!;
      cache.samples.push({ ...features, futureMinRatio: futureMin / this.bars[index]!.close, index });
    }
    cache.computedThrough = Math.max(cache.computedThrough, lastMaturedIndex);
    return { samples: cache.samples, count: upperBoundByIndex(cache.samples, lastMaturedIndex) };
  }

  private weights(asOfIndex: number, horizonDays: number, barrier: StrikeSurvivalBarrier, currentSigma: number, window: SampleWindow<StrikeSurvivalBaseSample>, condition: StrikeSurvivalCondition): StrikeConditionalWeights {
    if (this.weightedAsOfIndex !== asOfIndex) {
      this.conditionalWeightCache.clear();
      this.weightedAsOfIndex = asOfIndex;
    }
    const key = `${horizonDays}|${barrier}|${currentSigma}`;
    let weights = this.conditionalWeightCache.get(key);
    if (!weights) {
      weights = strikeConditionalWeights(window.samples, window.count, condition);
      this.conditionalWeightCache.set(key, weights);
    }
    return weights;
  }

  compute(
    asOfDate: string,
    spot: number,
    shortStrike: number,
    currentSigma: number,
    horizonDays: number,
  ): StrikeSurvivalAsOf | null {
    const asOfIndex = this.dateIndex.get(asOfDate);
    if (asOfIndex === undefined || !(spot > 0) || !(shortStrike > 0) || !(shortStrike < spot)
      || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays) || horizonDays <= 0) return null;
    this.prepareResultCache(asOfIndex);
    const cacheKey = `${asOfIndex}|${spot}|${shortStrike}|${currentSigma}|${horizonDays}`;
    if (this.survivalCache.has(cacheKey)) return this.survivalCache.get(cacheKey)!;
    const condition = strikeSurvivalConditionAtIndex(this.bars, asOfIndex, currentSigma);
    const closeSamples = this.collectBaseSamples(asOfIndex, horizonDays, 'close');
    const noTouchSamples = this.collectBaseSamples(asOfIndex, horizonDays, 'intraday');
    const closeWeights = condition && closeSamples.count >= 8 ? this.weights(asOfIndex, horizonDays, 'close', currentSigma, closeSamples, condition) : undefined;
    const noTouchWeights = condition && noTouchSamples.count >= 8 ? this.weights(asOfIndex, horizonDays, 'intraday', currentSigma, noTouchSamples, condition) : undefined;
    const result = computeStrikeSurvivalFromSamples(
      closeSamples.samples,
      noTouchSamples.samples,
      spot,
      shortStrike,
      currentSigma,
      horizonDays,
      condition,
      closeSamples.count,
      noTouchSamples.count,
      closeWeights,
      noTouchWeights,
    );
    this.survivalCache.set(cacheKey, result);
    return result;
  }

  computeTail(
    asOfDate: string,
    spot: number,
    shortStrike: number,
    currentSigma: number,
    horizonDays: number,
    widthPct: number,
    credit: number,
    maxLoss: number,
  ): StrikeTailLossAtAsOf | null {
    const asOfIndex = this.dateIndex.get(asOfDate);
    if (asOfIndex === undefined || !(spot > 0) || !(shortStrike > 0) || !(shortStrike < spot)
      || !(currentSigma > 0) || !Number.isFinite(currentSigma) || !Number.isInteger(horizonDays)
      || horizonDays <= 0 || !(widthPct > 0) || !(credit > 0) || !(maxLoss > 0)) return null;
    this.prepareResultCache(asOfIndex);
    const cacheKey = `${asOfIndex}|${spot}|${shortStrike}|${currentSigma}|${horizonDays}|${widthPct}|${credit}|${maxLoss}`;
    if (this.tailCache.has(cacheKey)) return this.tailCache.get(cacheKey)!;
    const samples = this.collectBaseSamples(asOfIndex, horizonDays, 'intraday');
    const condition = strikeSurvivalConditionAtIndex(this.bars, asOfIndex, currentSigma);
    const result = computeStrikeTailLossFromSamples(
      samples.samples,
      spot,
      shortStrike,
      currentSigma,
      horizonDays,
      widthPct,
      credit,
      maxLoss,
      condition,
      samples.count,
      condition ? this.weights(asOfIndex, horizonDays, 'intraday', currentSigma, samples, condition) : undefined,
    );
    this.tailCache.set(cacheKey, result);
    return result;
  }
}

export function computeSellerStats(bars: OHLCBar[]): SellerStats {
  const last = bars.length - 1;
  const { returns, sigmas } = computeReturnsAndSigmas(bars);
  const zScores = returns.map((value, index) => value === null || !sigmas[index] ? null : Math.abs(value) / sigmas[index]!);
  const current = bars[last];
  const currentDistPct = current ? current.close / Math.max(...bars.slice(Math.max(0, last - 36)).map(({ high }) => high)) - 1 : 0;
  const putWins: Record<SigmaBucket, number[]> = { '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': [] };
  const putRebound: Record<SigmaBucket, number[]> = { '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': [] };
  const putNoBreach: Record<SigmaBucket, number[]> = { '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': [] };
  const putFade: Record<SigmaBucket, number[]> = { '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': [] };
  const putWeek: Record<SigmaBucket, number[]> = { '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': [] };
  const callNext: number[] = [], callFade: number[] = [], callWeek: number[] = [];
  const callNextNoBreach: number[] = [], callWeekNoBreach: number[] = [];
  const swingWins: number[] = [], swingMagnitudes: number[] = [], swingDists: number[] = [];
  const recover5: number[] = [], halfRetrace10: number[] = [], repairSuccess: number[] = [], continueDrop5: number[] = [], worstDrop5: number[] = [], repairDays: number[] = [];
  const escalation: Record<SigmaBucket, { day1Half: number[]; day1Full: number[]; day2Half: number[]; day2Full: number[] }> = {
    '1.0-1.5': { day1Half: [], day1Full: [], day2Half: [], day2Full: [] },
    '1.5-2.0': { day1Half: [], day1Full: [], day2Half: [], day2Full: [] },
    '2.0-2.5': { day1Half: [], day1Full: [], day2Half: [], day2Full: [] },
    '>=2.5': { day1Half: [], day1Full: [], day2Half: [], day2Full: [] },
  };
  const survival: Record<number, { d3: number[]; d5: number[]; d10: number[] }> = Object.fromEntries(
    SURVIVAL_D.map(d => [d, { d3: [], d5: [], d10: [] }])
  );

  for (let i = 20; i < bars.length; i++) {
    const sigma = sigmas[i]!;
    const z = zScores[i]!;
    const r = returns[i]!;
    if (!sigma || z === null) continue;
    const bucket = bucketFor(z);
    if (r < 0 && bucket) {
      if (i + 1 <= last) {
        putWins[bucket].push(bars[i + 1].close >= bars[i].close ? 1 : 0);
        putRebound[bucket].push(bars[i + 1].close > bars[i].close ? 1 : 0);
        putNoBreach[bucket].push(bars[i + 1].close >= bars[i].close * (1 - sigma) ? 1 : 0);
      }
      putFade[bucket].push(bars[i].close > bars[i].low * (1 + 0.25 * sigma) ? 1 : 0);
      if (i + 5 <= last) putWeek[bucket].push(bars[i + 5].close >= bars[i].close ? 1 : 0);
      if (i + 1 <= last) {
        const low1 = minLow(bars, i + 1, i + 1);
        escalation[bucket].day1Half.push(low1 <= bars[i].close * (1 - 0.5 * sigma) ? 1 : 0);
        escalation[bucket].day1Full.push(low1 <= bars[i].close * (1 - 1.0 * sigma) ? 1 : 0);
      }
      if (i + 2 <= last) {
        const low2 = minLow(bars, i + 1, i + 2);
        escalation[bucket].day2Half.push(low2 <= bars[i].close * (1 - 0.5 * sigma) ? 1 : 0);
        escalation[bucket].day2Full.push(low2 <= bars[i].close * (1 - 1.0 * sigma) ? 1 : 0);
      }
    }
    for (const d of SURVIVAL_D) {
      for (const h of SURVIVAL_H) {
        if (i + h > last) continue;
        const survived = minClose(bars, i + 1, i + h) >= bars[i].close * (1 - d * sigma) ? 1 : 0;
        const key = h === 3 ? 'd3' : h === 5 ? 'd5' : 'd10';
        survival[d][key].push(survived);
      }
    }
    if (r > 0 && z >= 1) {
      if (i + 1 <= last) {
        callNext.push(bars[i + 1].close <= bars[i].close ? 1 : 0);
        callNextNoBreach.push(bars[i + 1].close <= bars[i].close * (1 + sigma) ? 1 : 0);
      }
      callFade.push(bars[i].close < bars[i].high * (1 - 0.25 * sigma) ? 1 : 0);
      if (i + 5 <= last) {
        callWeek.push(bars[i + 5].close <= bars[i].close ? 1 : 0);
        callWeekNoBreach.push(bars[i + 5].close <= bars[i].close * (1 + sigma) ? 1 : 0);
      }
    }
    if (r <= -1.5 * sigma) {
      if (i + 5 <= last) {
        const low = minClose(bars, i + 1, i + 5);
        recover5.push(bars[i + 5].close >= bars[i].close ? 1 : 0);
        continueDrop5.push(low <= bars[i].close * (1 - sigma) ? 1 : 0);
        worstDrop5.push(low / bars[i].close - 1);
      }
      if (i + 10 <= last) halfRetrace10.push(maxClose(bars, i + 1, i + 10) >= bars[i].close + 0.5 * (bars[i - 1].close - bars[i].close) ? 1 : 0);
      if (i + 15 <= last) {
        const repair = Array.from({ length: 15 }, (_, offset) => i + offset + 1).find(day => bars[day].close >= bars[i - 1].close);
        repairSuccess.push(repair === undefined ? 0 : 1);
        if (repair !== undefined) repairDays.push(repair - i);
      }
    }
    if (i >= 36 && i + 10 <= last) {
      const dist = bars[i].close / Math.max(...bars.slice(i - 36, i + 1).map(({ high }) => high)) - 1;
      if (Math.abs(dist - currentDistPct) <= 0.02) {
        const futureHigh = maxClose(bars, i + 1, i + 10);
        swingWins.push(futureHigh >= 1.03 * bars[i].close ? 1 : 0);
        swingMagnitudes.push(futureHigh / bars[i].close - 1);
        swingDists.push(dist);
      }
    }
  }

  const highs52w = current ? bars.slice(Math.max(0, last - 251)).map(({ high }) => high) : [0];
  const highs37d = current ? bars.slice(Math.max(0, last - 36)).map(({ high }) => high) : [0];
  const high52w = Math.max(...highs52w), high37d = Math.max(...highs37d);
  const todayReturn = returns[last] ?? 0, todaySigma = sigmas[last] ?? 0, todayZ = todaySigma ? Math.abs(todayReturn) / todaySigma : 0;
  const prior4dReturnPct = last >= 5 ? Math.log(bars[last - 1].close / bars[last - 5].close) : null;
  const priorSigma20 = last >= 1 ? sigmas[last - 1] : null;
  const prior4dSigma = prior4dReturnPct !== null && priorSigma20
    ? Math.abs(prior4dReturnPct) / (priorSigma20 * Math.sqrt(4))
    : null;
  const downsideShock = (days: number) => {
    if (!todaySigma || last < days) return 0;
    return Math.max(0, -Math.log(bars[last].close / bars[last - days].close) / (todaySigma * Math.sqrt(days)));
  };
  return {
    sellPutNextDayNoLoss: BUCKETS.map(bucket => ({ bucket, ...stat(putWins[bucket], 20, 'sellPutNextDayNoLoss') })),
    sellPutNextDayRebound: BUCKETS.map(bucket => ({ bucket, ...stat(putRebound[bucket], 20, 'sellPutNextDayRebound') })),
    sellPutNoBreach: BUCKETS.map(bucket => ({ bucket, ...stat(putNoBreach[bucket], 20, 'sellPutNoBreach') })),
    sellPutNoLoss: {
      sameDayFade: BUCKETS.map(bucket => ({ bucket, ...stat(putFade[bucket], 20, 'sellPutSameDayFade') })),
      week: BUCKETS.map(bucket => ({ bucket, ...stat(putWeek[bucket], 20, 'sellPutWeekNoLoss') })),
    },
    sellCallNoLoss: { nextDay: stat(callNext, 20, 'sellCallNextDayNoLoss'), sameDayFade: stat(callFade, 20, 'sellCallSameDayFade'), week: stat(callWeek, 20, 'sellCallWeekNoLoss') },
    sellCallNoBreach: { nextDay: stat(callNextNoBreach, 20, 'sellCallNextDayNoBreach'), week: stat(callWeekNoBreach, 20, 'sellCallWeekNoBreach') },
    swingSweetSpot: { lookbackDays: 37, currentDistPct, bounceProb10d: stat(swingWins, 37, 'swingBounceProb10d'), medianBounceMagPct: stat(swingMagnitudes, 37, 'swingMedianBounceMagPct', median), band: swingDists.length >= 8 ? [Math.min(...swingDists), Math.max(...swingDists)] : null },
    manageability: { recover5d: stat(recover5, 20, 'manageRecover5d'), halfRetrace10d: stat(halfRetrace10, 20, 'manageHalfRetrace10d'), repairSuccess: stat(repairSuccess, 20, 'manageRepairSuccess'), continueDrop5d: stat(continueDrop5, 20, 'manageContinueDrop5d'), worstCase5dDropPct: stat(worstDrop5, 20, 'manageWorstCase5dDropPct', values => percentile(values, 0.05)), medianRepairDays: stat(repairDays, 20, 'manageMedianRepairDays', median) },
    anchoredManageability: anchoredManageability(bars, returns, sigmas, zScores),
    distanceFromHigh: { high52w, distPct52w: current ? current.close / high52w - 1 : 0, high37d, distPct37d: current ? current.close / high37d - 1 : 0 },
    todayMove: { returnPct: todayReturn, sigma20: todaySigma, zScore: todayZ, bucket: bucketFor(todayZ), direction: todayReturn > 0 ? 'up' : todayReturn < 0 ? 'down' : 'flat' },
    downsideShock: { oneDay: downsideShock(1), threeDay: downsideShock(3), fiveDay: downsideShock(5) },
    prior4dReturnPct,
    prior4dSigma,
    sellPutEscalation: BUCKETS.map(bucket => ({
      bucket,
      day1Half: stat(escalation[bucket].day1Half, 1, 'sellPutEscalationD1K05'),
      day1Full: stat(escalation[bucket].day1Full, 1, 'sellPutEscalationD1K10'),
      day2Half: stat(escalation[bucket].day2Half, 2, 'sellPutEscalationD2K05'),
      day2Full: stat(escalation[bucket].day2Full, 2, 'sellPutEscalationD2K10'),
    })),
    strikeSurvival: SURVIVAL_D.map(sigmaDist => ({
      sigmaDist,
      d3: survivalStat(survival[sigmaDist].d3, 3, 'sellPutStrikeSurvival'),
      d5: survivalStat(survival[sigmaDist].d5, 5, 'sellPutStrikeSurvival'),
      d10: survivalStat(survival[sigmaDist].d10, 10, 'sellPutStrikeSurvival'),
    })),
  };
}

type BucketAggregates = Record<SigmaBucket, RunningValues>;
type AnchoredAggregate = { recover5: RunningValues; halfRetrace10: RunningValues; repairSuccess: RunningValues; continueDrop5: RunningValues; worstDrop5: RunningValues; repairDays: RunningValues };
type AnchoredAggregates = Record<AnchoredSigmaBucket, AnchoredAggregate>;

class RunningValues {
  private readonly sorted: number[] = [];
  private readonly values: number[] = [];
  private sum = 0;

  add(value: number) {
    this.values.push(value);
    this.sum += value;
    let low = 0, high = this.sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.sorted[middle]! <= value) low = middle + 1;
      else high = middle;
    }
    this.sorted.splice(low, 0, value);
  }

  asStat(windowDays: number, formulaKey: string, aggregate: 'mean' | 'median' | 'p05' = 'mean'): SellerStat {
    const n = this.sorted.length;
    const value = n < 8 ? null
      : aggregate === 'mean' ? this.sum / n
      : aggregate === 'median' ? (n % 2 ? this.sorted[Math.floor(n / 2)]! : (this.sorted[n / 2 - 1]! + this.sorted[n / 2]!) / 2)
      : (() => {
          const index = (n - 1) * .05;
          const lower = Math.floor(index), upper = Math.ceil(index);
          return this.sorted[lower]! + (this.sorted[upper]! - this.sorted[lower]!) * (index - lower);
        })();
    return { value, n, windowDays, formulaKey, confidence: confidenceFor(n) };
  }

  asSurvivalStat(windowDays: number, formulaKey: string): SellerStat {
    return survivalStat(this.values, windowDays, formulaKey);
  }
}

const bucketAggregates = (): BucketAggregates => ({
  '1.0-1.5': new RunningValues(), '1.5-2.0': new RunningValues(), '2.0-2.5': new RunningValues(), '>=2.5': new RunningValues(),
});
const anchoredAggregates = (): AnchoredAggregates => Object.fromEntries(ANCHORED_BUCKETS.map(bucket => [bucket, {
  recover5: new RunningValues(), halfRetrace10: new RunningValues(), repairSuccess: new RunningValues(),
  continueDrop5: new RunningValues(), worstDrop5: new RunningValues(), repairDays: new RunningValues(),
}])) as AnchoredAggregates;

type MatureEvent = { sigma: number; bucket: SigmaBucket | null; anchoredBucket: AnchoredSigmaBucket | null; put: boolean; call: boolean; manage: boolean };
type SwingSample = { dist: number; win: number; magnitude: number };

/**
 * 逐 bar 推进的 SellerStats。只在未来窗口成熟时写入样本，因此 snapshot 永远只读 as-of 数据。
 * 该状态只能沿同一时间序列 append；回测 arm 必须各自持有实例。
 */
export class SellerStatsAsOf {
  private readonly bars: OHLCBar[] = [];
  private readonly returns: Array<number | null> = [];
  private readonly sigmas: Array<number | null> = [];
  private readonly events = new Map<number, MatureEvent>();
  private readonly putWins = bucketAggregates();
  private readonly putRebound = bucketAggregates();
  private readonly putNoBreach = bucketAggregates();
  private readonly putFade = bucketAggregates();
  private readonly putWeek = bucketAggregates();
  private readonly callNext = new RunningValues();
  private readonly callFade = new RunningValues();
  private readonly callWeek = new RunningValues();
  private readonly callNextNoBreach = new RunningValues();
  private readonly callWeekNoBreach = new RunningValues();
  private readonly recover5 = new RunningValues();
  private readonly halfRetrace10 = new RunningValues();
  private readonly repairSuccess = new RunningValues();
  private readonly continueDrop5 = new RunningValues();
  private readonly worstDrop5 = new RunningValues();
  private readonly repairDays = new RunningValues();
  private readonly anchored = anchoredAggregates();
  private readonly noValues = new RunningValues();
  private readonly escalation: Record<SigmaBucket, { day1Half: RunningValues; day1Full: RunningValues; day2Half: RunningValues; day2Full: RunningValues }> = Object.fromEntries(
    BUCKETS.map(bucket => [bucket, { day1Half: new RunningValues(), day1Full: new RunningValues(), day2Half: new RunningValues(), day2Full: new RunningValues() }]),
  ) as Record<SigmaBucket, { day1Half: RunningValues; day1Full: RunningValues; day2Half: RunningValues; day2Full: RunningValues }>;
  private readonly survival: Record<number, { d3: RunningValues; d5: RunningValues; d10: RunningValues }> = Object.fromEntries(
    SURVIVAL_D.map(distance => [distance, { d3: new RunningValues(), d5: new RunningValues(), d10: new RunningValues() }]),
  );
  private readonly swing: SwingSample[] = [];

  constructor(bars: OHLCBar[] = []) {
    for (const bar of bars) this.append(bar);
  }

  append(bar: OHLCBar) {
    const index = this.bars.length;
    this.bars.push(bar);
    const currentReturn = index ? Math.log(bar.close / this.bars[index - 1]!.close) : null;
    this.returns.push(currentReturn);
    const sigma = index >= 20 ? stdev(this.returns.slice(index - 19, index + 1) as number[]) : null;
    this.sigmas.push(sigma);
    if (index >= 20 && sigma && currentReturn !== null) {
      const z = Math.abs(currentReturn) / sigma;
      const bucket = bucketFor(z);
      const put = currentReturn < 0 && bucket !== null;
      const call = currentReturn > 0 && z >= 1;
      const manage = currentReturn <= -1.5 * sigma;
      const anchoredBucket = currentReturn < 0 ? anchoredBucketFor(z) : null;
      this.events.set(index, { sigma, bucket, anchoredBucket, put, call, manage });
      if (put) this.putFade[bucket!].add(bar.close > bar.low * (1 + .25 * sigma) ? 1 : 0);
      if (call) this.callFade.add(bar.close < bar.high * (1 - .25 * sigma) ? 1 : 0);
    }
    this.mature(index, 1);
    this.mature(index, 2);
    this.mature(index, 3);
    this.mature(index, 5);
    this.mature(index, 10);
    this.mature(index, 15);
  }

  private mature(last: number, horizon: 1 | 2 | 3 | 5 | 10 | 15) {
    const index = last - horizon;
    const event = this.events.get(index);
    if (!event) return;
    const start = this.bars[index]!;
    const end = this.bars[last]!;
    const lows = () => minLow(this.bars, index + 1, last);
    const closes = () => minClose(this.bars, index + 1, last);
    if (event.put && event.bucket) {
      const target = this.escalation[event.bucket];
      if (horizon === 1) {
        this.putWins[event.bucket].add(end.close >= start.close ? 1 : 0);
        this.putRebound[event.bucket].add(end.close > start.close ? 1 : 0);
        this.putNoBreach[event.bucket].add(end.close >= start.close * (1 - event.sigma) ? 1 : 0);
        const low = lows();
        target.day1Half.add(low <= start.close * (1 - .5 * event.sigma) ? 1 : 0);
        target.day1Full.add(low <= start.close * (1 - event.sigma) ? 1 : 0);
      }
      if (horizon === 2) {
        const low = lows();
        target.day2Half.add(low <= start.close * (1 - .5 * event.sigma) ? 1 : 0);
        target.day2Full.add(low <= start.close * (1 - event.sigma) ? 1 : 0);
      }
      if (horizon === 5) this.putWeek[event.bucket].add(end.close >= start.close ? 1 : 0);
    }
    if (event.call) {
      if (horizon === 1) {
        this.callNext.add(end.close <= start.close ? 1 : 0);
        this.callNextNoBreach.add(end.close <= start.close * (1 + event.sigma) ? 1 : 0);
      }
      if (horizon === 5) {
        this.callWeek.add(end.close <= start.close ? 1 : 0);
        this.callWeekNoBreach.add(end.close <= start.close * (1 + event.sigma) ? 1 : 0);
      }
    }
    if (horizon === 3 || horizon === 5 || horizon === 10) {
      for (const distance of SURVIVAL_D) {
        const survived = closes() >= start.close * (1 - distance * event.sigma) ? 1 : 0;
        this.survival[distance][horizon === 3 ? 'd3' : horizon === 5 ? 'd5' : 'd10'].add(survived);
      }
    }
    if (event.manage) {
      if (horizon === 5) {
        const low = closes();
        this.recover5.add(end.close >= start.close ? 1 : 0);
        this.continueDrop5.add(low <= start.close * (1 - event.sigma) ? 1 : 0);
        this.worstDrop5.add(low / start.close - 1);
      }
      if (horizon === 10) {
        this.halfRetrace10.add(maxClose(this.bars, index + 1, last) >= start.close + .5 * (this.bars[index - 1]!.close - start.close) ? 1 : 0);
      }
      if (horizon === 15) {
        const repair = Array.from({ length: 15 }, (_, offset) => index + offset + 1).find(day => this.bars[day]!.close >= this.bars[index - 1]!.close);
        this.repairSuccess.add(repair === undefined ? 0 : 1);
        if (repair !== undefined) this.repairDays.add(repair - index);
      }
    }
    if (event.anchoredBucket) {
      const target = this.anchored[event.anchoredBucket];
      if (horizon === 5) {
        const futureMin = closes();
        target.recover5.add(maxClose(this.bars, index + 1, last) >= start.close ? 1 : 0);
        target.continueDrop5.add(futureMin <= start.close * (1 - event.sigma) ? 1 : 0);
        target.worstDrop5.add(futureMin / start.close - 1);
      }
      if (horizon === 10) target.halfRetrace10.add(maxClose(this.bars, index + 1, last) >= (start.close + this.bars[index - 1]!.close) / 2 ? 1 : 0);
      if (horizon === 15) {
        const repair = Array.from({ length: 15 }, (_, offset) => index + offset + 1).find(day => this.bars[day]!.close >= this.bars[index - 1]!.close);
        target.repairSuccess.add(repair === undefined ? 0 : 1);
        if (repair !== undefined) target.repairDays.add(repair - index);
      }
    }
    if (horizon === 10 && index >= 36) {
      const dist = start.close / Math.max(...this.bars.slice(index - 36, index + 1).map(candidate => candidate.high)) - 1;
      const futureHigh = maxClose(this.bars, index + 1, last);
      this.swing.push({ dist, win: futureHigh >= 1.03 * start.close ? 1 : 0, magnitude: futureHigh / start.close - 1 });
    }
  }

  snapshot(): SellerStats {
    const last = this.bars.length - 1;
    const current = this.bars[last];
    const currentDistPct = current ? current.close / Math.max(...this.bars.slice(Math.max(0, last - 36)).map(bar => bar.high)) - 1 : 0;
    // swing 的筛选阈值随当日距离改变；其余样本都已在成熟时固定归档。
    const swing = this.swing.filter(sample => Math.abs(sample.dist - currentDistPct) <= .02);
    const highs52w = current ? this.bars.slice(Math.max(0, last - 251)).map(bar => bar.high) : [0];
    const highs37d = current ? this.bars.slice(Math.max(0, last - 36)).map(bar => bar.high) : [0];
    const high52w = Math.max(...highs52w), high37d = Math.max(...highs37d);
    const todayReturn = this.returns[last] ?? 0, todaySigma = this.sigmas[last] ?? 0, todayZ = todaySigma ? Math.abs(todayReturn) / todaySigma : 0;
    const anchoredBucket = todayReturn < 0 ? anchoredBucketFor(todayZ) : null;
    const anchored = anchoredBucket ? this.anchored[anchoredBucket] : undefined;
    const prior4dReturnPct = last >= 5 ? Math.log(this.bars[last - 1]!.close / this.bars[last - 5]!.close) : null;
    const priorSigma20 = last >= 1 ? this.sigmas[last - 1] : null;
    const prior4dSigma = prior4dReturnPct !== null && priorSigma20 ? Math.abs(prior4dReturnPct) / (priorSigma20 * Math.sqrt(4)) : null;
    const downsideShock = (days: number) => !todaySigma || last < days ? 0 : Math.max(0, -Math.log(this.bars[last]!.close / this.bars[last - days]!.close) / (todaySigma * Math.sqrt(days)));
    return {
      sellPutNextDayNoLoss: BUCKETS.map(bucket => ({ bucket, ...this.putWins[bucket].asStat(20, 'sellPutNextDayNoLoss') })),
      sellPutNextDayRebound: BUCKETS.map(bucket => ({ bucket, ...this.putRebound[bucket].asStat(20, 'sellPutNextDayRebound') })),
      sellPutNoBreach: BUCKETS.map(bucket => ({ bucket, ...this.putNoBreach[bucket].asStat(20, 'sellPutNoBreach') })),
      sellPutNoLoss: { sameDayFade: BUCKETS.map(bucket => ({ bucket, ...this.putFade[bucket].asStat(20, 'sellPutSameDayFade') })), week: BUCKETS.map(bucket => ({ bucket, ...this.putWeek[bucket].asStat(20, 'sellPutWeekNoLoss') })) },
      sellCallNoLoss: { nextDay: this.callNext.asStat(20, 'sellCallNextDayNoLoss'), sameDayFade: this.callFade.asStat(20, 'sellCallSameDayFade'), week: this.callWeek.asStat(20, 'sellCallWeekNoLoss') },
      sellCallNoBreach: { nextDay: this.callNextNoBreach.asStat(20, 'sellCallNextDayNoBreach'), week: this.callWeekNoBreach.asStat(20, 'sellCallWeekNoBreach') },
      swingSweetSpot: { lookbackDays: 37, currentDistPct, bounceProb10d: stat(swing.map(sample => sample.win), 37, 'swingBounceProb10d'), medianBounceMagPct: stat(swing.map(sample => sample.magnitude), 37, 'swingMedianBounceMagPct', median), band: swing.length >= 8 ? [Math.min(...swing.map(sample => sample.dist)), Math.max(...swing.map(sample => sample.dist))] : null },
      manageability: { recover5d: this.recover5.asStat(20, 'manageRecover5d'), halfRetrace10d: this.halfRetrace10.asStat(20, 'manageHalfRetrace10d'), repairSuccess: this.repairSuccess.asStat(20, 'manageRepairSuccess'), continueDrop5d: this.continueDrop5.asStat(20, 'manageContinueDrop5d'), worstCase5dDropPct: this.worstDrop5.asStat(20, 'manageWorstCase5dDropPct', 'p05'), medianRepairDays: this.repairDays.asStat(20, 'manageMedianRepairDays', 'median') },
      anchoredManageability: {
        bucket: anchoredBucket,
        recover5d: (anchored?.recover5 ?? this.noValues).asStat(5, 'manageAnchoredRecover5d'),
        halfRetrace10d: (anchored?.halfRetrace10 ?? this.noValues).asStat(10, 'manageAnchoredHalfRetrace10d'),
        repairSuccess: (anchored?.repairSuccess ?? this.noValues).asStat(15, 'manageAnchoredRepairSuccess'),
        continueDrop5d: (anchored?.continueDrop5 ?? this.noValues).asStat(5, 'manageAnchoredContinueDrop5d'),
        worstCase5dDropPct: (anchored?.worstDrop5 ?? this.noValues).asStat(5, 'manageAnchoredWorstCase5dDropPct', 'p05'),
        medianRepairDays: (anchored?.repairDays ?? this.noValues).asStat(15, 'manageAnchoredMedianRepairDays', 'median'),
      },
      distanceFromHigh: { high52w, distPct52w: current ? current.close / high52w - 1 : 0, high37d, distPct37d: current ? current.close / high37d - 1 : 0 },
      todayMove: { returnPct: todayReturn, sigma20: todaySigma, zScore: todayZ, bucket: bucketFor(todayZ), direction: todayReturn > 0 ? 'up' : todayReturn < 0 ? 'down' : 'flat' },
      downsideShock: { oneDay: downsideShock(1), threeDay: downsideShock(3), fiveDay: downsideShock(5) },
      prior4dReturnPct,
      prior4dSigma,
      sellPutEscalation: BUCKETS.map(bucket => ({ bucket, day1Half: this.escalation[bucket].day1Half.asStat(1, 'sellPutEscalationD1K05'), day1Full: this.escalation[bucket].day1Full.asStat(1, 'sellPutEscalationD1K10'), day2Half: this.escalation[bucket].day2Half.asStat(2, 'sellPutEscalationD2K05'), day2Full: this.escalation[bucket].day2Full.asStat(2, 'sellPutEscalationD2K10') })),
      strikeSurvival: SURVIVAL_D.map(sigmaDist => ({ sigmaDist, d3: this.survival[sigmaDist].d3.asSurvivalStat(3, 'sellPutStrikeSurvival'), d5: this.survival[sigmaDist].d5.asSurvivalStat(5, 'sellPutStrikeSurvival'), d10: this.survival[sigmaDist].d10.asSurvivalStat(10, 'sellPutStrikeSurvival') })),
    };
  }
}
