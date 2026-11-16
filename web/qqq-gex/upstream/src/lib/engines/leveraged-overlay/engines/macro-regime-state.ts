import type { OHLCV } from '../types/input';
import { computeResampledVote, resampleBars } from '../backtest/resampled-regime-classifier';
import { calcSMA,calcLatestBarSMA } from '../utils';
import { VIX_CRISIS, CRISIS_PRICE_PCT } from '../constants';

export type MacroPhase = 'SLOW_BULL' | 'SLOW_BEAR';
export type MacroRegimeState = { phase: MacroPhase; weekStamp: string };
export type WeeklyVote = 'BULLISH_MAJORITY' | 'BEARISH_MAJORITY' | 'NO_MAJORITY';

type WeeklyBar = OHLCV & { vix?: number; vix3m?: number };
type MacroRegimeToday = {
  date: string;
  qqqBarsThroughToday: OHLCV[];
  vixByDate: Record<string, number>;
  vix3mByDate: Record<string, number>;
  /** 日线回测增量周桶：只包含截至当天的 bar，和 resampleBars 逐日结果等价。 */
  weeklyAggregateBarsThroughToday?: OHLCV[];
  /** 周内最后可得日 bar（与 weeklyBars 的替换语义一致）。 */
  weeklyBarsThroughToday?: WeeklyBar[];
  /** Only the native replay's owned append-only weekly series may reuse this scratch state. */
  weeklyVoteCache?:ReturnType<typeof createWeeklyVoteDetailsCache>;
  latestVix?: number;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export function isoWeek(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return `${year}-W${String(Math.ceil((((d.getTime() - first.getTime()) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function weeklyBars(qqqBars: OHLCV[], vixByDate: Record<string, number>, vix3mByDate: Record<string, number>): WeeklyBar[] {
  const bars: WeeklyBar[] = [];
  let bucket = '', latestVix: number | undefined, latestVix3m: number | undefined;
  for (const bar of qqqBars) {
    if (vixByDate[bar.date] != null) latestVix = vixByDate[bar.date];
    if (vix3mByDate[bar.date] != null) latestVix3m = vix3mByDate[bar.date];
    const week = isoWeek(bar.date);
    if (week !== bucket) { bars.push({ ...bar, vix: latestVix, vix3m: latestVix3m }); bucket = week; }
    else bars[bars.length - 1] = { ...bar, vix: latestVix, vix3m: latestVix3m };
  }
  return bars;
}

// Frozen verbatim from M0b: weekly last-available bars only; all indicators use current/past data.
export function computeWeeklyVote(qqqBarsThroughToday: OHLCV[], vixByDate: Record<string, number>, vix3mByDate: Record<string, number>): WeeklyVote {
  const bars = weeklyBars(qqqBarsThroughToday, vixByDate, vix3mByDate);
  const closes = bars.map(bar => bar.close), ema: number[] = [], atr: number[] = [], vix3ms: number[] = [];
  let ath = -Infinity;
  let bullish = 0, bearish = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    ath = Math.max(ath, bar.close);
    ema[i] = i ? ema[i - 1]! + (2 / 21) * (bar.close - ema[i - 1]!) : bar.close;
    const tr = i ? Math.max(bar.high - bar.low, Math.abs(bar.high - closes[i - 1]!), Math.abs(bar.low - closes[i - 1]!)) : bar.high - bar.low;
    atr.push(tr);
    if (bar.vix3m != null) vix3ms.push(bar.vix3m);
    if (i !== bars.length - 1) continue;
    const sma = (length: number) => i >= length - 1 ? mean(closes.slice(i - length + 1, i + 1)) : undefined;
    const sma10 = sma(10), sma40 = sma(40), sma80 = sma(80);
    const votes = [
      sma10 != null && sma40 != null && sma80 != null && sma10 > sma40 && sma40 > sma80 ? 1 : sma10 != null && sma40 != null && sma80 != null && sma10 < sma40 && sma40 < sma80 ? -1 : 0,
      i >= 52 && closes[i]! / closes[i - 52]! - 1 > 0 ? 1 : i >= 52 && closes[i]! / closes[i - 52]! - 1 < -0.05 ? -1 : 0,
      sma40 != null && (bar.close - sma40) / sma40 >= 0.02 ? 1 : sma40 != null && (bar.close - sma40) / sma40 <= -0.05 ? -1 : 0,
      1 - bar.close / ath <= 0.10 ? 1 : 1 - bar.close / ath >= 0.20 ? -1 : 0,
      bar.vix != null && bar.vix3m != null && bar.vix3m < bar.vix ? -1 : bar.vix != null && bar.vix3m != null && vix3ms.length >= 52 && bar.vix3m > bar.vix && bar.vix3m <= median(vix3ms.slice(-52)) ? 1 : 0,
      i >= 19 && bar.close > ema[i]! ? 1 : i >= 19 && bar.close < ema[i]! - 2 * mean(atr.slice(i - 19, i + 1)) ? -1 : 0,
    ];
    bullish = votes.filter(vote => vote === 1).length;
    bearish = votes.filter(vote => vote === -1).length;
  }
  return bullish >= 4 ? 'BULLISH_MAJORITY' : bearish >= 4 ? 'BEARISH_MAJORITY' : 'NO_MAJORITY';
}

export function computeWeeklyVoteFromDailyEngine(qqqBarsThroughToday: OHLCV[], vixByDate: Record<string, number>, vix3mByDate: Record<string, number>): WeeklyVote {
  return computeResampledVote('week', qqqBarsThroughToday, vixByDate, vix3mByDate);
}

export function transitionMacroRegime(prev: MacroRegimeState | undefined, today: MacroRegimeToday, voteFn: (qqqBarsThroughToday: OHLCV[], vixByDate: Record<string, number>, vix3mByDate: Record<string, number>) => WeeklyVote = computeWeeklyVote): MacroRegimeState {
  const weekStamp = isoWeek(today.date);
  if (prev?.weekStamp === weekStamp) return prev;
  const phase = prev?.phase ?? 'SLOW_BULL';
  const vote = voteFn(today.qqqBarsThroughToday, today.vixByDate, today.vix3mByDate);
  return { phase: vote === 'BULLISH_MAJORITY' ? 'SLOW_BULL' : vote === 'BEARISH_MAJORITY' ? 'SLOW_BEAR' : phase, weekStamp };
}

export function computeHybridVote(
  qqqBarsThroughToday: OHLCV[],
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
  holdWeeks = 2
): WeeklyVote {
  const weeklyBars = resampleBars(qqqBarsThroughToday, 'week');
  if (weeklyBars.length === 0) return 'NO_MAJORITY';

  // Walk backward from the last week to count consecutive non-crisis weeks.
  let consecutiveNonCrisis = 0;
  for (let k = weeklyBars.length - 1; k >= 0; k--) {
    const weeklyClosesUpToK = weeklyBars.slice(0, k + 1).map(bar => bar.close);
    const sma200 = calcSMA(weeklyClosesUpToK, 200);

    const cutoffDate = weeklyBars[k].date;
    let vixAtWeek: number | undefined = undefined;
    for (let i = qqqBarsThroughToday.length - 1; i >= 0; i--) {
      const date = qqqBarsThroughToday[i].date;
      if (date <= cutoffDate) {
        if (vixByDate[date] !== undefined && vixByDate[date] !== null) {
          vixAtWeek = vixByDate[date];
          break;
        }
      }
    }

    const isCrisis =
      (vixAtWeek !== undefined && vixAtWeek >= VIX_CRISIS) ||
      (sma200 > 0 && (weeklyBars[k].close - sma200) / sma200 <= CRISIS_PRICE_PCT);

    if (isCrisis) {
      break;
    }
    consecutiveNonCrisis++;
    if (consecutiveNonCrisis > holdWeeks) {
      break; // no need to look back further
    }
  }

  if (consecutiveNonCrisis <= holdWeeks) {
    return 'BEARISH_MAJORITY'; // in crisis, or still within the hold
  }
  return computeWeeklyVote(qqqBarsThroughToday, vixByDate, vix3mByDate); // M0b's real committee, unmodified
}

export function createWeeklyVoteDetailsCache(){
  return {bars:undefined as WeeklyBar[]|undefined,length:0,completedTail:undefined as WeeklyBar|undefined,
    closes:[] as number[],ema:[] as number[],atr:[] as number[],vix3ms:[] as number[],
    peaks:[] as number[],vixCounts:[] as number[]};
}

export function computeWeeklyVoteDetails(
  qqqBarsThroughToday: OHLCV[],
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
  bearEnterVotes = 4,
  bullExitVotes = 4,
  weeklyBarsThroughToday?: WeeklyBar[],
  cache?:ReturnType<typeof createWeeklyVoteDetailsCache>,
): WeeklyVote {
  const bars = weeklyBarsThroughToday ?? weeklyBars(qqqBarsThroughToday, vixByDate, vix3mByDate);
  const reusable=cache&&cache.bars===bars&&bars.length>=cache.length
    &&cache.completedTail===bars[cache.length-2];
  const start=reusable?Math.max(0,cache.length-1):0;
  const closes=cache?.closes??bars.map(bar=>bar.close),ema=cache?.ema??[],atr=cache?.atr??[],vix3ms=cache?.vix3ms??[];
  if(cache){closes.length=start;ema.length=start;atr.length=start;vix3ms.length=start?cache.vixCounts[start-1]!:0;}
  let ath = start?cache!.peaks[start-1]!:-Infinity;
  let bullish = 0, bearish = 0;
  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]!;
    closes[i]=bar.close;
    ath = Math.max(ath, bar.close);
    ema[i] = i ? ema[i - 1]! + (2 / 21) * (bar.close - ema[i - 1]!) : bar.close;
    const tr = i ? Math.max(bar.high - bar.low, Math.abs(bar.high - closes[i - 1]!), Math.abs(bar.low - closes[i - 1]!)) : bar.high - bar.low;
    atr.push(tr);
    if (bar.vix3m != null) vix3ms.push(bar.vix3m);
    if(cache){cache.peaks[i]=ath;cache.vixCounts[i]=vix3ms.length;}
    if (i !== bars.length - 1) continue;
    const sma = (length: number) => i >= length - 1 ? mean(closes.slice(i - length + 1, i + 1)) : undefined;
    const sma10 = sma(10), sma40 = sma(40), sma80 = sma(80);
    const votes = [
      sma10 != null && sma40 != null && sma80 != null && sma10 > sma40 && sma40 > sma80 ? 1 : sma10 != null && sma40 != null && sma80 != null && sma10 < sma40 && sma40 < sma80 ? -1 : 0,
      i >= 52 && closes[i]! / closes[i - 52]! - 1 > 0 ? 1 : i >= 52 && closes[i]! / closes[i - 52]! - 1 < -0.05 ? -1 : 0,
      sma40 != null && (bar.close - sma40) / sma40 >= 0.02 ? 1 : sma40 != null && (bar.close - sma40) / sma40 <= -0.05 ? -1 : 0,
      1 - bar.close / ath <= 0.10 ? 1 : 1 - bar.close / ath >= 0.20 ? -1 : 0,
      bar.vix != null && bar.vix3m != null && bar.vix3m < bar.vix ? -1 : bar.vix != null && bar.vix3m != null && vix3ms.length >= 52 && bar.vix3m > bar.vix && bar.vix3m <= median(vix3ms.slice(-52)) ? 1 : 0,
      i >= 19 && bar.close > ema[i]! ? 1 : i >= 19 && bar.close < ema[i]! - 2 * mean(atr.slice(i - 19, i + 1)) ? -1 : 0,
    ];
    bullish = votes.filter(vote => vote === 1).length;
    bearish = votes.filter(vote => vote === -1).length;
  }
  if(cache){cache.bars=bars;cache.length=bars.length;cache.completedTail=bars[bars.length-2];
    cache.peaks.length=bars.length;cache.vixCounts.length=bars.length;}
  return bullish >= bullExitVotes ? 'BULLISH_MAJORITY' : bearish >= bearEnterVotes ? 'BEARISH_MAJORITY' : 'NO_MAJORITY';
}

// W7-1R winner cell (docs/overlay-tuning/w7-hybrid-grid-2026-07.md): 进熊 79(58/13/79)、
// 退出 28(28/25) vs W5 基线 44、翻转 14 vs 22、覆盖 94.8%/97.8%。
export const W7_WINNER_OPTIONS: W7VoteOptions = {
  cadence: 'daily',
  confirmDays: 2,
  crisisConfirm: 2,
  crisisExitHoldWeeks: 0,
  bearEnterVotes: 4,
  bullExitVotes: 3,
};

export type W7MacroRegimeState = MacroRegimeState & {
  w7?: {
    pendingPhase: MacroPhase | null;
    pendingCount: number;
    // null = 尚未见过危机（等价于网格实现里的 Infinity；用 null 保 JSON round-trip）
    daysSinceCrisisCleared: number | null;
    lastIsCrisis: boolean;
    lastDecisionDate?: string;
  };
};

// 日频增量版 W7 状态机：单步语义与 w7-hybrid-grid.ts runTimeline 的 daily 分支逐位一致
// （等价性已按 winner cell 六项指标全量校验）。day-loop 每个 decision bar 调一次，
// 状态跨日携带，避免整段历史重放。
// ponytail: 只实现 daily cadence（winner 是 daily）；要跑 weekly 用 transitionMacroRegime。
export function advanceW7MacroRegime(
  prev: W7MacroRegimeState | undefined,
  today: MacroRegimeToday,
  options: W7VoteOptions = W7_WINNER_OPTIONS,
): W7MacroRegimeState {
  if (options.cadence !== 'daily') throw new Error('advanceW7MacroRegime only supports daily cadence');
  if (prev?.w7?.lastDecisionDate === today.date) return prev;
  let phase: MacroPhase = prev?.phase ?? 'SLOW_BULL';
  let pendingPhase = prev?.w7?.pendingPhase ?? null;
  let pendingCount = prev?.w7?.pendingCount ?? 0;
  let daysSinceCrisisCleared = prev?.w7?.daysSinceCrisisCleared ?? null;
  const holdDays = options.crisisExitHoldWeeks * 5;

  const weekly = today.weeklyAggregateBarsThroughToday ?? resampleBars(today.qqqBarsThroughToday, 'week');
  if (weekly.length === 0) return { phase, weekStamp: isoWeek(today.date), w7: { pendingPhase, pendingCount, daysSinceCrisisCleared, lastIsCrisis: prev?.w7?.lastIsCrisis ?? false, lastDecisionDate: today.date } };

  let latestVix = today.latestVix;
  if (latestVix == null) {
    for (let i = today.qqqBarsThroughToday.length - 1; i >= 0; i--) {
      const vix = today.vixByDate[today.qqqBarsThroughToday[i]!.date];
      if (vix != null) { latestVix = vix; break; }
    }
  }
  const lastClose = weekly[weekly.length - 1]!.close;
  const sma200 = calcLatestBarSMA(weekly, 200);
  const isCrisis = (latestVix !== undefined && latestVix >= VIX_CRISIS)
    || (sma200 > 0 && (lastClose - sma200) / sma200 <= CRISIS_PRICE_PCT);
  const triggerCrisis = options.crisisConfirm === 2 ? (isCrisis && (prev?.w7?.lastIsCrisis ?? false)) : isCrisis;

  let tempPhase: MacroPhase = phase;
  if (triggerCrisis) {
    tempPhase = 'SLOW_BEAR';
    daysSinceCrisisCleared = 0;
  } else {
    daysSinceCrisisCleared = daysSinceCrisisCleared === null ? null : daysSinceCrisisCleared + 1;
    if (daysSinceCrisisCleared === null || daysSinceCrisisCleared > holdDays) {
      const vote = computeWeeklyVoteDetails(today.qqqBarsThroughToday, today.vixByDate, today.vix3mByDate, options.bearEnterVotes, options.bullExitVotes, today.weeklyBarsThroughToday,today.weeklyVoteCache);
      if (vote === 'BULLISH_MAJORITY') tempPhase = 'SLOW_BULL';
      else if (vote === 'BEARISH_MAJORITY') tempPhase = 'SLOW_BEAR';
    } else {
      tempPhase = 'SLOW_BEAR';
    }
  }

  if (tempPhase === phase) {
    pendingPhase = null;
    pendingCount = 0;
  } else {
    if (tempPhase === pendingPhase) pendingCount++;
    else { pendingPhase = tempPhase; pendingCount = 1; }
    if (pendingCount >= options.confirmDays) {
      phase = tempPhase;
      pendingPhase = null;
      pendingCount = 0;
    }
  }

  return { phase, weekStamp: isoWeek(today.date), w7: { pendingPhase, pendingCount, daysSinceCrisisCleared, lastIsCrisis: isCrisis, lastDecisionDate: today.date } };
}

// ── W9-fast：进出双快 + 最小驻留 ────────────────────────────────────────────
// w7 内核之上叠加：快进通道（252日回撤 ≤ ddEnterPct ∨ 期限倒挂∧VIX≥backwVixMin，
// 连续 enterConfirmDays 天）、快出通道（收盘 > SMA20 连续 exitConfirmDays 天，且当日
// 快进条件为假）、最小驻留 dwellBars（任何翻转后锁定，不采纳内核/通道的反向信号）。
// 2026-07-17 原型扫描（scratchpad w9/w9b）：极速档 进 14(8/4/14)/出 23(17/23)/翻转 44/
// 短命段(<21d) 1/覆盖 87.6/86.8；对照 w7 纯净 进 79/出 28/翻转 14。
export interface W9FastOptions {
  w7: W7VoteOptions;
  ddEnterPct: number;        // 252日高点回撤进入阈值（负数）
  backwVixMin: number;       // 倒挂通道的 VIX 下限
  enterConfirmDays: number;
  exitConfirmDays: number;
  dwellBars: number;         // 最小驻留（交易日）
}

export const W9_FAST_OPTIONS: W9FastOptions = {
  w7: W7_WINNER_OPTIONS,
  ddEnterPct: -0.12,
  backwVixMin: 22,
  enterConfirmDays: 2,
  exitConfirmDays: 3,
  dwellBars: 21,
};

export type W9MacroRegimeState = W7MacroRegimeState & {
  w9?: {
    enterStreak: number;
    exitStreak: number;
    // null = 从未翻转过（等价于 Infinity，可立即翻转）；保 JSON round-trip
    barsSinceFlip: number | null;
  };
};

export function advanceW9MacroRegime(
  prev: W9MacroRegimeState | undefined,
  today: MacroRegimeToday,
  options: W9FastOptions = W9_FAST_OPTIONS,
): W9MacroRegimeState {
  if (prev?.w7?.lastDecisionDate === today.date) return prev;
  const bars = today.qqqBarsThroughToday;
  const core = advanceW7MacroRegime(prev, today, options.w7);

  let latestVix: number | undefined, latestVix3m: number | undefined;
  for (let i = bars.length - 1; i >= 0 && (latestVix === undefined || latestVix3m === undefined); i--) {
    const date = bars[i]!.date;
    if (latestVix === undefined && today.vixByDate[date] != null) latestVix = today.vixByDate[date];
    if (latestVix3m === undefined && today.vix3mByDate[date] != null) latestVix3m = today.vix3mByDate[date];
  }
  let high252 = -Infinity;
  for (let i = Math.max(0, bars.length - 252); i < bars.length; i++) high252 = Math.max(high252, bars[i]!.close);
  const close = bars[bars.length - 1]!.close;
  const drawdown = high252 > 0 ? close / high252 - 1 : 0;
  const backwardation = latestVix !== undefined && latestVix3m !== undefined && latestVix3m < latestVix;
  const enterCond = drawdown <= options.ddEnterPct || (backwardation && latestVix! >= options.backwVixMin);
  const exitCond = bars.length >= 20 && close > calcSMA(bars.slice(-20).map(bar => bar.close), 20);

  const enterStreak = enterCond ? (prev?.w9?.enterStreak ?? 0) + 1 : 0;
  const exitStreak = exitCond ? (prev?.w9?.exitStreak ?? 0) + 1 : 0;
  const prevPhase: MacroPhase = prev?.phase ?? 'SLOW_BULL';
  const barsSinceFlipPrev = prev?.w9?.barsSinceFlip ?? null;
  const canFlip = barsSinceFlipPrev === null || barsSinceFlipPrev >= options.dwellBars;

  let phase: MacroPhase = prevPhase;
  if (canFlip) {
    phase = core.phase; // w7 内核意见
    if (prevPhase === 'SLOW_BULL' && enterStreak >= options.enterConfirmDays) phase = 'SLOW_BEAR';
    else if (prevPhase === 'SLOW_BEAR' && exitStreak >= options.exitConfirmDays && !enterCond) phase = 'SLOW_BULL';
  }

  const flipped = phase !== prevPhase;
  const barsSinceFlip = flipped ? 1 : barsSinceFlipPrev === null ? null : barsSinceFlipPrev + 1;
  // 有效 phase 与内核意见不一致时同步内核（清 pending），下一步内核从有效状态出发
  const w7inner = phase !== core.phase
    ? { ...core.w7!, pendingPhase: null, pendingCount: 0 }
    : core.w7!;
  return { phase, weekStamp: core.weekStamp, w7: w7inner, w9: { enterStreak, exitStreak, barsSinceFlip } };
}

// W10-balanced：沿用 W9 信号，只把最小驻留改为非对称；回牛后 38 日抑制假进熊，
// 进熊后 14 日即可回牛。冻结值来自 2026-07-18 事件准确性扫描。
export const W10_BALANCED_OPTIONS = { ...W9_FAST_OPTIONS, bullDwellBars: 38, bearDwellBars: 14 };

export function advanceW10MacroRegime(
  prev: W9MacroRegimeState | undefined,
  today: MacroRegimeToday,
): W9MacroRegimeState {
  const dwellBars = (prev?.phase ?? 'SLOW_BULL') === 'SLOW_BULL'
    ? W10_BALANCED_OPTIONS.bullDwellBars
    : W10_BALANCED_OPTIONS.bearDwellBars;
  return advanceW9MacroRegime(prev, today, { ...W10_BALANCED_OPTIONS, dwellBars });
}

// W11 is observation-only: one-day fast bear entry, but five confirmed calm recovery days.
export function advanceW11MacroRegime(prev: W9MacroRegimeState | undefined, today: MacroRegimeToday): W9MacroRegimeState {
  return advanceW9MacroRegime(prev, today, { ...W9_FAST_OPTIONS, enterConfirmDays: 1, exitConfirmDays: 5, dwellBars: 5 });
}

export interface W7VoteOptions {
  cadence: 'weekly' | 'daily';
  confirmDays: number;
  crisisConfirm: 1 | 2;
  crisisExitHoldWeeks: 0 | 1 | 2;
  bearEnterVotes: 3 | 4;
  bullExitVotes: 3 | 4;
}

function getLatestVixInternal(qqqBarsThroughToday: OHLCV[], vixByDate: Record<string, number>): number | undefined {
  for (let i = qqqBarsThroughToday.length - 1; i >= 0; i--) {
    const date = qqqBarsThroughToday[i].date;
    if (vixByDate[date] !== undefined && vixByDate[date] !== null) {
      return vixByDate[date];
    }
  }
  return undefined;
}

export function computeW7Vote(
  qqqBarsThroughToday: OHLCV[],
  vixByDate: Record<string, number>,
  vix3mByDate: Record<string, number>,
  options: W7VoteOptions
): WeeklyVote {
  let state: MacroPhase = 'SLOW_BULL';
  let previousStamp = '';
  let weeksSinceCrisisCleared = Infinity;
  let daysSinceCrisisCleared = Infinity;
  let lastIsCrisis = false;

  let pendingState: MacroPhase | null = null;
  let pendingCount = 0;

  let lastState: MacroPhase = state;

  const holdWeeks = options.crisisExitHoldWeeks;
  const holdDays = holdWeeks === 2 ? 10 : holdWeeks === 1 ? 5 : 0;

  for (let index = 0; index < qqqBarsThroughToday.length; index++) {
    const bar = qqqBarsThroughToday[index]!;
    const qqqBarsUpToI = qqqBarsThroughToday.slice(0, index + 1);

    lastState = state;

    if (options.cadence === 'weekly') {
      const nextStamp = isoWeek(bar.date);
      if (nextStamp !== previousStamp) {
        const weeklyBars = resampleBars(qqqBarsUpToI, 'week');
        if (weeklyBars.length > 0) {
          const latestVix = getLatestVixInternal(qqqBarsUpToI, vixByDate);
          const lastWeeklyBar = weeklyBars[weeklyBars.length - 1]!;
          const lastClose = lastWeeklyBar.close;
          const weeklyCloses = weeklyBars.map(b => b.close);
          const sma200 = calcSMA(weeklyCloses, 200);

          const isVixCrisis = latestVix !== undefined && latestVix >= VIX_CRISIS;
          const isPriceCrisis = sma200 > 0 && (lastClose - sma200) / sma200 <= CRISIS_PRICE_PCT;
          const isCrisis = isVixCrisis || isPriceCrisis;

          const triggerCrisis = options.crisisConfirm === 2 ? (isCrisis && lastIsCrisis) : isCrisis;

          if (triggerCrisis) {
            state = 'SLOW_BEAR';
            weeksSinceCrisisCleared = 0;
          } else {
            weeksSinceCrisisCleared++;
            if (weeksSinceCrisisCleared > holdWeeks) {
              const vote = computeWeeklyVoteDetails(
                qqqBarsUpToI,
                vixByDate,
                vix3mByDate,
                options.bearEnterVotes,
                options.bullExitVotes
              );
              if (vote === 'BULLISH_MAJORITY') {
                state = 'SLOW_BULL';
              } else if (vote === 'BEARISH_MAJORITY') {
                state = 'SLOW_BEAR';
              }
            } else {
              state = 'SLOW_BEAR';
            }
          }
          lastIsCrisis = isCrisis;
        }
        previousStamp = nextStamp;
      }
    } else {
      // daily
      const weeklyBars = resampleBars(qqqBarsUpToI, 'week');
      if (weeklyBars.length > 0) {
        const latestVix = getLatestVixInternal(qqqBarsUpToI, vixByDate);
        const lastWeeklyBar = weeklyBars[weeklyBars.length - 1]!;
        const lastClose = lastWeeklyBar.close;
        const weeklyCloses = weeklyBars.map(b => b.close);
        const sma200 = calcSMA(weeklyCloses, 200);

        const isVixCrisis = latestVix !== undefined && latestVix >= VIX_CRISIS;
        const isPriceCrisis = sma200 > 0 && (lastClose - sma200) / sma200 <= CRISIS_PRICE_PCT;
        const isCrisis = isVixCrisis || isPriceCrisis;

        const triggerCrisis = options.crisisConfirm === 2 ? (isCrisis && lastIsCrisis) : isCrisis;

        let tempState: MacroPhase = state;
        if (triggerCrisis) {
          tempState = 'SLOW_BEAR';
          daysSinceCrisisCleared = 0;
        } else {
          daysSinceCrisisCleared++;
          if (daysSinceCrisisCleared > holdDays) {
            const vote = computeWeeklyVoteDetails(
              qqqBarsUpToI,
              vixByDate,
              vix3mByDate,
              options.bearEnterVotes,
              options.bullExitVotes
            );
            if (vote === 'BULLISH_MAJORITY') {
              tempState = 'SLOW_BULL';
            } else if (vote === 'BEARISH_MAJORITY') {
              tempState = 'SLOW_BEAR';
            }
          } else {
            tempState = 'SLOW_BEAR';
          }
        }
        lastIsCrisis = isCrisis;

        if (tempState === state) {
          pendingState = null;
          pendingCount = 0;
        } else {
          if (tempState === pendingState) {
            pendingCount++;
          } else {
            pendingState = tempState;
            pendingCount = 1;
          }

          if (pendingCount >= options.confirmDays) {
            state = tempState;
            pendingState = null;
            pendingCount = 0;
          }
        }
      }
    }
  }

  if (state === lastState) {
    return 'NO_MAJORITY';
  } else {
    return state === 'SLOW_BULL' ? 'BULLISH_MAJORITY' : 'BEARISH_MAJORITY';
  }
}
