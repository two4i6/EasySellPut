import type { ICMode } from './types/params';
import type { MarketRegime } from './types/output';
import {
  BEAR_CS_DELTA_EXIT,
  BEAR_CS_DTE_EXIT,
  BEAR_CS_PROFIT_TARGET_DEFAULT,
  BEAR_CS_ROC5_EXIT,
  BEAR_CS_STOP_LOSS_CREDIT_MULT,
  BEAR_CS_STOP_LOSS_MAX_LOSS_PCT,
  COLLAR_CALL_EXIT_DELTA,
  COLLAR_CALL_EXIT_DELTA_OVERHEAT,
  COLLAR_EXIT_DTE,
  COLLAR_LONG_PUT_EXIT_DELTA,
  COLLAR_STOP_PER_CONTRACT,
  COLLAR_VIX_REGIME_EXIT,
  CS_EARLY_EXIT_DELTA,
  IC_MODE_CONFIG,
  IC_PROFIT_TARGET_DEFAULT,
  PCS_DELTA_STOP_DEFAULT,
  PCS_PROFIT_TARGET_DEFAULT,
} from './constants';

export type PositionType = 'collar' | 'cs' | 'ic' | 'bear_cs' | 'pcs';
export type CollarScenario = 'overheat' | 'weakening' | 'drawdown' | 'vix_spike';

export type ExitSignal = {
  severity: 'CLOSE' | 'REVIEW';
  message: string;
  auto: boolean;
  key?:
    | 'expired'
    | 'dte_exit'
    | 'short_put_breached'
    | 'long_put_active'
    | 'regime_recovered'
    | 'vix_normalized'
    | 'drawdown_recovery'
    | 'roc5_exit'
    | 'sma200_reclaim'
    | 'delta_stop'
    | 'range_breach'
    | 'profit_take'
    | 'stop_loss'
    | 'manual';
};

export type ExitPosition = {
  type: PositionType;
  expiry: string;
  scenario?: CollarScenario;
  putStrike?: number;
  shortPutStrike?: number;
  callStrike?: number;
  credit?: number;
  icMode?: ICMode;
  openRangeLow?: number;
  openRangeHigh?: number;
  bearCredit?: number;
  bearMaxLoss?: number;
};

export type ExitMarketState = {
  asOfDate?: string;
  regime: MarketRegime;
  vix?: number;
  sma200?: number;
  roc5?: number;
  qqqPrice?: number;
  leveragedSpot?: number;
  currentLeveragedPrice?: number;
  dte?: number;
  shortCallDelta?: number;
  shortPutDelta?: number;
  longPutDelta?: number;
  qqqHigh?: number;
  qqqLow?: number;
  totalCloseCost?: number;
  unrealizedPnl?: number;
  profitTakeEnabled?: boolean;
  profitTargetPct?: number;
  deltaStopEnabled?: boolean;
  deltaStopThreshold?: number;
  csDeltaStopThreshold?: number;
};

export function calcExitDTE(expiry: string, asOfDate?: string): number {
  const base = asOfDate ? new Date(`${asOfDate.split('T')[0]}T00:00:00`) : new Date();
  base.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiry}T00:00:00`);
  return Math.ceil((exp.getTime() - base.getTime()) / 86_400_000);
}

export function evaluateExitConditions(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  switch (pos.type) {
    case 'collar': return checkCollar(pos, state);
    case 'cs': return checkCS(pos, state);
    case 'ic': return checkIC(pos, state);
    case 'bear_cs': return checkBearCS(pos, state);
    case 'pcs': return checkPCS(pos, state);
  }
}

function dteFor(pos: ExitPosition, state: ExitMarketState): number {
  return state.dte ?? calcExitDTE(pos.expiry, state.asOfDate);
}

function checkCollar(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const dte = dteFor(pos, state);
  const { regime, vix } = state;
  const isOverheat = pos.scenario === 'overheat';
  const currentLeveragedPrice = state.currentLeveragedPrice ?? state.leveragedSpot;

  if (dte <= 0) signals.push({ severity: 'CLOSE', message: '已到期 — 立即平仓', auto: true, key: 'expired' });
  else if (dte <= COLLAR_EXIT_DTE) signals.push({ severity: 'CLOSE', message: `DTE=${dte}，避免 Pin Risk（≤${COLLAR_EXIT_DTE}天触发）`, auto: true, key: 'dte_exit' });

  if (typeof currentLeveragedPrice === 'number' && pos.shortPutStrike && currentLeveragedPrice <= pos.shortPutStrike) {
    signals.push({ severity: 'CLOSE', message: `当前价 $${currentLeveragedPrice.toFixed(2)} ≤ Short Put $${pos.shortPutStrike}，Put Spread 已接近/达到最大收益；Long Put $${pos.putStrike ?? '—'} / Short Put $${pos.shortPutStrike}，建议平仓锁定保护收益`, auto: true, key: 'short_put_breached' });
  } else if (typeof currentLeveragedPrice === 'number' && pos.putStrike && currentLeveragedPrice <= pos.putStrike) {
    signals.push({ severity: 'REVIEW', message: `当前价 $${currentLeveragedPrice.toFixed(2)} ≤ Long Put $${pos.putStrike}，保护已启动；Short Put ${pos.shortPutStrike ? `$${pos.shortPutStrike}` : '—'} 尚未击穿，检查是否部分/全部兑现`, auto: true, key: 'long_put_active' });
  }

  if (pos.scenario === 'weakening' && (regime === 'BULL' || regime === 'RISK_ON_EXTENDED')) {
    signals.push({ severity: 'CLOSE', message: `机制回归 ${regime}，转弱保护结束，平仓 collar`, auto: true, key: 'regime_recovered' });
  }
  if (pos.scenario === 'overheat' && regime === 'BULL' && typeof vix === 'number' && vix < COLLAR_VIX_REGIME_EXIT) {
    signals.push({ severity: 'CLOSE', message: `机制 BULL + VIX=${vix.toFixed(1)} < ${COLLAR_VIX_REGIME_EXIT}，过热状态消退，平仓`, auto: true, key: 'vix_normalized' });
  }
  if (pos.scenario === 'vix_spike' && typeof vix === 'number' && vix < COLLAR_VIX_REGIME_EXIT) {
    signals.push({ severity: 'CLOSE', message: `VIX=${vix.toFixed(1)} < ${COLLAR_VIX_REGIME_EXIT}，VIX 正常化，平仓 collar`, auto: true, key: 'vix_normalized' });
  }
  if (pos.scenario === 'drawdown' && (regime === 'BULL' || regime === 'RISK_ON_EXTENDED')) {
    signals.push({ severity: 'REVIEW', message: `机制 ${regime}，回撤保护可能已结束 — 核查 20d 回撤 < 1% 后平仓`, auto: true, key: 'drawdown_recovery' });
  }

  const callThresh = isOverheat ? COLLAR_CALL_EXIT_DELTA_OVERHEAT : COLLAR_CALL_EXIT_DELTA;
  if (typeof state.shortCallDelta === 'number' && state.shortCallDelta > callThresh) {
    signals.push({ severity: 'CLOSE', message: `Short Call Δ${(state.shortCallDelta * 100).toFixed(0)}% 超限（阈值 Δ${(callThresh * 100).toFixed(0)}%）`, auto: true, key: 'delta_stop' });
  } else if (pos.callStrike) {
    signals.push({ severity: 'REVIEW', message: `手动确认：Short Call Δ > ${callThresh.toFixed(2)} 时强制平仓`, auto: false, key: 'manual' });
  }
  if (typeof state.longPutDelta === 'number' && Math.abs(state.longPutDelta) > COLLAR_LONG_PUT_EXIT_DELTA) {
    signals.push({ severity: 'CLOSE', message: `Long Put Δ${(Math.abs(state.longPutDelta) * 100).toFixed(0)}% 深度价内，结算保护收益`, auto: true, key: 'delta_stop' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：Long Put Δ > ${COLLAR_LONG_PUT_EXIT_DELTA.toFixed(2)}（深度 ITM）时套现保护收益`, auto: false, key: 'manual' });
  }
  if (typeof state.totalCloseCost === 'number' && state.totalCloseCost > COLLAR_STOP_PER_CONTRACT) {
    signals.push({ severity: 'CLOSE', message: `MtM 亏损 > $${COLLAR_STOP_PER_CONTRACT}/合约，止损平仓`, auto: true, key: 'stop_loss' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：MtM 亏损 > $${COLLAR_STOP_PER_CONTRACT}/合约 时止损平仓`, auto: false, key: 'manual' });
  }
  if (pos.shortPutStrike) {
    signals.push({ severity: 'REVIEW', message: `手动确认：价格跌穿 Short Put $${pos.shortPutStrike} 时内涵值拿满平仓`, auto: false, key: 'manual' });
  }

  return signals;
}

function checkCS(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const dte = dteFor(pos, state);
  if (dte <= 0) signals.push({ severity: 'CLOSE', message: '已到期 — 立即平仓', auto: true, key: 'expired' });
  else if (dte <= COLLAR_EXIT_DTE) signals.push({ severity: 'REVIEW', message: `DTE=${dte}，临近到期，确认是否平仓`, auto: true, key: 'dte_exit' });
  const deltaThreshold = state.csDeltaStopThreshold ?? CS_EARLY_EXIT_DELTA;
  if (typeof state.shortCallDelta === 'number' && state.shortCallDelta > deltaThreshold) {
    signals.push({ severity: 'CLOSE', message: `Short Call Δ${(state.shortCallDelta * 100).toFixed(0)}% > ${(deltaThreshold * 100).toFixed(0)}%`, auto: true, key: 'delta_stop' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：Short Call Δ > ${deltaThreshold.toFixed(2)} 时强制平仓`, auto: false, key: 'manual' });
  }
  return signals;
}

function checkPCS(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const dte = dteFor(pos, state);
  if (dte <= 0) signals.push({ severity: 'CLOSE', message: '已到期 — 立即平仓', auto: true, key: 'expired' });
  else if (dte <= COLLAR_EXIT_DTE) signals.push({ severity: 'REVIEW', message: `DTE=${dte}，临近到期，确认是否平仓`, auto: true, key: 'dte_exit' });

  const deltaThreshold = state.deltaStopThreshold ?? PCS_DELTA_STOP_DEFAULT;
  if (state.deltaStopEnabled && typeof state.shortPutDelta === 'number' && Math.abs(state.shortPutDelta) > deltaThreshold) {
    signals.push({ severity: 'CLOSE', message: `Short Put Δ${(Math.abs(state.shortPutDelta) * 100).toFixed(0)}% > ${(deltaThreshold * 100).toFixed(0)}%`, auto: true, key: 'delta_stop' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：Short Put Δ > ${deltaThreshold.toFixed(2)} 时强制平仓`, auto: false, key: 'manual' });
  }

  if (pos.credit) {
    const target = state.profitTargetPct ?? PCS_PROFIT_TARGET_DEFAULT;
    const remainingCredit = pos.credit * (1 - target);
    if (state.profitTakeEnabled && typeof state.unrealizedPnl === 'number' && state.unrealizedPnl >= pos.credit * target) {
      signals.push({ severity: 'CLOSE', message: `提前止盈达到 credit 的 ${(target * 100).toFixed(0)}%`, auto: true, key: 'profit_take' });
    } else {
      signals.push({ severity: 'REVIEW', message: `止盈检查（如启用）：回购成本 ≤ $${remainingCredit.toFixed(0)}（剩余 ${((1 - target) * 100).toFixed(0)}% credit）时平仓`, auto: false, key: 'manual' });
    }
  }
  return signals;
}

function checkIC(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const dte = dteFor(pos, state);
  const cfg = IC_MODE_CONFIG[pos.icMode ?? 'standard'];
  const bufPct = cfg.rangeBufferPct;

  if (dte <= 0) signals.push({ severity: 'CLOSE', message: '已到期 — 立即平仓', auto: true, key: 'expired' });
  else if (dte <= COLLAR_EXIT_DTE) signals.push({ severity: 'REVIEW', message: `DTE=${dte}，临近到期`, auto: true, key: 'dte_exit' });
  if ((state.shortPutDelta != null && Math.abs(state.shortPutDelta) > cfg.exitDelta) || (state.shortCallDelta != null && state.shortCallDelta > cfg.exitDelta)) {
    signals.push({ severity: 'CLOSE', message: `Short Put/Call Δ 超过 ${cfg.exitDelta.toFixed(2)}`, auto: true, key: 'delta_stop' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：Short Put/Call Δ > ${cfg.exitDelta.toFixed(2)} 时平仓`, auto: false, key: 'manual' });
  }
  if (pos.openRangeHigh && pos.openRangeLow) {
    const hiNum = pos.openRangeHigh * (1 + bufPct);
    const loNum = pos.openRangeLow * (1 - bufPct);
    if ((state.qqqHigh != null && state.qqqHigh > hiNum) || (state.qqqLow != null && state.qqqLow < loNum)) {
      signals.push({ severity: 'CLOSE', message: `标的突破建仓时 20d 区间缓冲 $${loNum.toFixed(2)}–$${hiNum.toFixed(2)}`, auto: true, key: 'range_breach' });
    } else {
      const bufNote = bufPct > 0 ? `（含 ±${(bufPct * 100).toFixed(1)}% 缓冲 $${loNum.toFixed(2)}–$${hiNum.toFixed(2)}）` : '';
      signals.push({ severity: 'REVIEW', message: `手动确认：标的收盘突破建仓时 20d 区间 $${pos.openRangeLow}–$${pos.openRangeHigh}${bufNote} 时平仓`, auto: false, key: 'manual' });
    }
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：标的收盘突破建仓时 20d High/Low 区间（±${(bufPct * 100).toFixed(1)}% 缓冲）时平仓`, auto: false, key: 'manual' });
  }
  if (pos.credit) {
    const target = state.profitTargetPct ?? IC_PROFIT_TARGET_DEFAULT;
    const remainingCredit = pos.credit * (1 - target);
    if (state.profitTakeEnabled && typeof state.unrealizedPnl === 'number' && state.unrealizedPnl >= pos.credit * target) {
      signals.push({ severity: 'CLOSE', message: `提前止盈达到 credit 的 ${(target * 100).toFixed(0)}%`, auto: true, key: 'profit_take' });
    } else {
      signals.push({ severity: 'REVIEW', message: `止盈检查（如启用）：回购成本 ≤ $${remainingCredit.toFixed(0)}（剩余 ${((1 - target) * 100).toFixed(0)}% credit）时平仓`, auto: false, key: 'manual' });
    }
  }
  return signals;
}

function checkBearCS(pos: ExitPosition, state: ExitMarketState): ExitSignal[] {
  const signals: ExitSignal[] = [];
  const dte = dteFor(pos, state);
  const { roc5, sma200, qqqPrice } = state;

  if (dte <= 0) signals.push({ severity: 'CLOSE', message: '已到期 — 立即平仓', auto: true, key: 'expired' });
  else if (dte < BEAR_CS_DTE_EXIT) signals.push({ severity: 'CLOSE', message: `DTE=${dte} < ${BEAR_CS_DTE_EXIT}，到期平仓`, auto: true, key: 'dte_exit' });
  if (typeof roc5 === 'number' && roc5 > BEAR_CS_ROC5_EXIT) {
    signals.push({ severity: 'CLOSE', message: `标的 5日涨幅 ${(roc5 * 100).toFixed(1)}% > ${(BEAR_CS_ROC5_EXIT * 100).toFixed(0)}%，强劲反弹 — 平仓`, auto: true, key: 'roc5_exit' });
  }
  if (typeof qqqPrice === 'number' && typeof sma200 === 'number' && qqqPrice > sma200) {
    signals.push({ severity: 'CLOSE', message: `标的收盘 ${qqqPrice.toFixed(2)} 上穿 SMA200 ${sma200.toFixed(2)}`, auto: true, key: 'sma200_reclaim' });
  }
  if (typeof state.shortCallDelta === 'number' && state.shortCallDelta > BEAR_CS_DELTA_EXIT) {
    signals.push({ severity: 'CLOSE', message: `Short Call Δ${(state.shortCallDelta * 100).toFixed(0)}% > ${(BEAR_CS_DELTA_EXIT * 100).toFixed(0)}%`, auto: true, key: 'delta_stop' });
  }
  if (pos.bearCredit && pos.bearMaxLoss) {
    const stopLoss = Math.min(BEAR_CS_STOP_LOSS_CREDIT_MULT * pos.bearCredit, BEAR_CS_STOP_LOSS_MAX_LOSS_PCT * pos.bearMaxLoss);
    if (typeof state.totalCloseCost === 'number' && state.totalCloseCost >= stopLoss) {
      signals.push({ severity: 'CLOSE', message: `回购成本 $${state.totalCloseCost.toFixed(0)} >= 止损阈值 $${stopLoss.toFixed(0)}`, auto: true, key: 'stop_loss' });
    } else {
      signals.push({ severity: 'REVIEW', message: `手动确认：回购成本 ≥ min(${BEAR_CS_STOP_LOSS_CREDIT_MULT}×credit=$${(BEAR_CS_STOP_LOSS_CREDIT_MULT * pos.bearCredit).toFixed(0)}, ${(BEAR_CS_STOP_LOSS_MAX_LOSS_PCT * 100).toFixed(0)}%×maxLoss=$${(BEAR_CS_STOP_LOSS_MAX_LOSS_PCT * pos.bearMaxLoss).toFixed(0)}) = $${stopLoss.toFixed(0)} 时止损`, auto: false, key: 'manual' });
    }
    const remainingCredit = pos.bearCredit * (1 - BEAR_CS_PROFIT_TARGET_DEFAULT);
    signals.push({ severity: 'REVIEW', message: `止盈检查：回购成本 ≤ $${remainingCredit.toFixed(0)}（剩余 ${((1 - BEAR_CS_PROFIT_TARGET_DEFAULT) * 100).toFixed(0)}% credit）时平仓`, auto: false, key: 'manual' });
  } else {
    signals.push({ severity: 'REVIEW', message: `手动确认：利润达到 credit ${(BEAR_CS_PROFIT_TARGET_DEFAULT * 100).toFixed(0)}% 时止盈平仓`, auto: false, key: 'manual' });
    signals.push({ severity: 'REVIEW', message: `手动确认：回购成本 ≥ min(${BEAR_CS_STOP_LOSS_CREDIT_MULT}×credit, ${(BEAR_CS_STOP_LOSS_MAX_LOSS_PCT * 100).toFixed(0)}%×maxLoss) 时止损`, auto: false, key: 'manual' });
  }
  signals.push({ severity: 'REVIEW', message: `手动确认：Short Call Δ > ${BEAR_CS_DELTA_EXIT.toFixed(2)} 时平仓`, auto: false, key: 'manual' });
  signals.push({ severity: 'REVIEW', message: `手动确认：标的收盘上穿 SMA200${typeof sma200 === 'number' ? ` ($${sma200.toFixed(1)})` : ''} 时平仓`, auto: false, key: 'manual' });
  signals.push({ severity: 'REVIEW', message: `手动确认：连续 3 个交易日涨幅 > 1% 时平仓`, auto: false, key: 'manual' });
  return signals;
}
