import type { CrisisPhase } from '../types/output';
import type { OHLCV } from '../types/input';
import type { StrategyParams } from '../types/params';
import { CRISIS_PRICE_PCT, VIX_CRISIS } from '../constants';

export type { CrisisPhase };

export type CrisisState = {
  phase: CrisisPhase;
  pendingBars: number;
  recoveryBars: number;
};

const VIX_ELEVATED = 25; // VIX floor for sustaining a price-driven crisis under vixLedExit

export function computeRawCrisis(
  vix: number,
  price_vs_sma200_pct: number,
  vix3m?: number,
  roc5?: number,
  opts?: { vixLedExit?: boolean },
): boolean {
  const vixBackwardation = vix3m != null && vix / vix3m >= 1.05 && (roc5 ?? 0) <= -0.06;
  const deepDrawdown = price_vs_sma200_pct <= CRISIS_PRICE_PCT;
  // SMA200 lags, so a deep price-vs-SMA200 drawdown alone keeps the machine latched in CONFIRMED
  // far into a recovery (TQQQ pinned at 0%). With vixLedExit, the price term only sustains crisis
  // while VIX is still elevated — a calm rebound (VIX < 25) exits crisis on the recovery schedule.
  const priceCrisis = opts?.vixLedExit ? deepDrawdown && vix >= VIX_ELEVATED : deepDrawdown;
  return vix >= VIX_CRISIS || priceCrisis || vixBackwardation;
}

// Threshold=1 means: first raw-crisis day → immediately CONFIRMED (old behavior).
// Threshold=N means: N consecutive raw-crisis days required before CONFIRMED.
// Hard crisis shortcuts have been removed so the threshold always applies —
// this makes crisisPendingThreshold observable in backtests even for VIX=52 events.
export function transitionCrisis(
  state: CrisisState,
  rawCrisis: boolean,
  params?: { crisisPendingThreshold?: number; crisisRecoveryBars?: number },
): CrisisState {
  const pendingThreshold = Math.max(1, params?.crisisPendingThreshold ?? 3);
  const recoveryTarget   = Math.max(1, params?.crisisRecoveryBars    ?? 5);

  if (!rawCrisis) {
    if (state.phase === 'NONE')      return state;
    if (state.phase === 'PENDING')   return { phase: 'NONE', pendingBars: 0, recoveryBars: 0 };
    if (state.phase === 'CONFIRMED') return { phase: 'RECOVERY', pendingBars: 0, recoveryBars: 1 };
    if (state.phase === 'RECOVERY') {
      const next = state.recoveryBars + 1;
      return next >= recoveryTarget
        ? { phase: 'NONE', pendingBars: 0, recoveryBars: 0 }
        : { ...state, recoveryBars: next };
    }
  } else {
    if (state.phase === 'NONE') {
      // threshold=1: first crisis day → immediately CONFIRMED; otherwise start PENDING
      return pendingThreshold <= 1
        ? { phase: 'CONFIRMED', pendingBars: 1, recoveryBars: 0 }
        : { phase: 'PENDING',   pendingBars: 1, recoveryBars: 0 };
    }
    if (state.phase === 'PENDING') {
      const next = state.pendingBars + 1;
      return next >= pendingThreshold
        ? { phase: 'CONFIRMED', pendingBars: next, recoveryBars: 0 }
        : { ...state, pendingBars: next };
    }
    if (state.phase === 'CONFIRMED') return { ...state, pendingBars: state.pendingBars + 1 };
    if (state.phase === 'RECOVERY')  return { phase: 'PENDING', pendingBars: 1, recoveryBars: 0 };
  }
  return state;
}

// ── Tail-risk early-warning override (2026-07-22 研究) ──────────────────────
// 与 FlashCrashState 同一套模式：cooldownBars 是日历/交易日倒计时，绝不是"最近 N 笔已完成
// 交易"这类交易计数式门控——2026-07-20 生产事故的教训是交易计数会被仓位变化本身反过来影响，
// 导致计数永远凑不满、门自锁死。这里的 rawTrigger 完全来自外部宏观信号（tail-risk-signals.ts
// 逐日预计算），与本策略的持仓/交易行为无任何耦合，天然不可能出现该类自锁。
export type TailRiskState = {
  active: boolean;
  cooldownBars: number;
  triggerDate?: string;
};

export function updateTailRiskState(
  currentState: TailRiskState | undefined,
  rawTrigger: boolean,
  params: StrategyParams | undefined,
  currentDate: string,
): TailRiskState {
  const config = params?.tailRiskOverride;
  if (!config) {
    return { active: false, cooldownBars: 0 };
  }
  const releaseTarget = Math.max(1, config.releaseBars ?? 10);
  const state = currentState ? { ...currentState } : { active: false, cooldownBars: 0 };

  if (rawTrigger) {
    // 触发（或在生效期内再次触发）：置位/续期倒计时到 releaseTarget。
    state.active = true;
    state.cooldownBars = releaseTarget;
    state.triggerDate = currentDate;
  } else if (state.active) {
    state.cooldownBars--;
    if (state.cooldownBars <= 0) {
      state.active = false;
      state.cooldownBars = 0;
    }
  }
  return state;
}

export type FlashCrashState = {
  active: boolean;
  cooldownBars: number;
  triggerDate?: string;
};

export function updateFlashCrashState(
  currentState: FlashCrashState | undefined,
  qqqBars: OHLCV[],
  vix: number | undefined,
  vix3m: number | undefined,
  params: StrategyParams | undefined,
  currentDate: string,
): FlashCrashState {
  const config = params?.flashCrashOverride;
  if (!config) {
    return { active: false, cooldownBars: 0 };
  }

  // 缺少任一项波动率时不能判断期限结构；保持上次状态，避免 live 数据故障
  // 把已触发的保护倒计时误推进到释放。
  if (typeof vix !== 'number' || !Number.isFinite(vix) || typeof vix3m !== 'number' || !Number.isFinite(vix3m) || vix3m <= 0) {
    return currentState ?? { active: false, cooldownBars: 0 };
  }

  const vixSpikeRatio = config.vixSpikeRatio ?? 1.05;
  const vixMin = config.vixMin ?? 24;
  const maxSpeedDays = config.maxSpeedDays ?? 50;
  const drawdownThreshold = config.drawdownThreshold ?? -0.12;
  const releaseTarget = config.releaseBars ?? 15;

  if (qqqBars.length === 0) {
    return currentState ?? { active: false, cooldownBars: 0 };
  }

  let peakPrice = -Infinity;
  let peakIndex = -1;
  for (let i = 0; i < qqqBars.length; i++) {
    const close = qqqBars[i].close;
    if (close > peakPrice) {
      peakPrice = close;
      peakIndex = i;
    }
  }

  const currentPrice = qqqBars[qqqBars.length - 1].close;
  const drawdown = peakPrice > 0 ? (currentPrice - peakPrice) / peakPrice : 0;
  const speed = qqqBars.length - 1 - peakIndex;

  const vixRatio = vix / vix3m;

  const triggerCondition = drawdown <= drawdownThreshold &&
    speed <= maxSpeedDays &&
    vixRatio >= vixSpikeRatio &&
    vix >= vixMin;

  const state = currentState ? { ...currentState } : { active: false, cooldownBars: 0 };

  if (triggerCondition && !state.active) {
    state.active = true;
    state.cooldownBars = releaseTarget;
    state.triggerDate = currentDate;
  } else if (state.active) {
    state.cooldownBars--;
    const canRelease = state.cooldownBars <= 0 || (vix < 22 && vixRatio < 0.96 && state.cooldownBars <= (releaseTarget - 5));
    if (canRelease) {
      state.active = false;
      state.cooldownBars = 0;
    }
  }

  return state;
}
