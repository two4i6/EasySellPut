/**
 * Shared thresholds for the v2 overlay runner, backtest day loop,
 * and position exit monitor.
 *
 * Single source of truth: change a value here and all layers stay in sync.
 */

import { calcEfficiencyRatio, closes } from './utils';
import type { OHLCV } from './types/input';
import type { ICMode, StrategyParams } from './types/params';
import type { MarketRegime } from './types/output';

export const OVERLAY_STRATEGY_TAGS = {
  QQQ_CALL_CREDIT_SPREAD: 'QQQ_CALL_CREDIT_SPREAD',
  QQQ_PUT_CREDIT_SPREAD: 'QQQ_PUT_CREDIT_SPREAD',
  QQQ_BEAR_CALL_SPREAD: 'QQQ_BEAR_CALL_SPREAD',
  QQQ_IRON_CONDOR: 'QQQ_IRON_CONDOR',
  LEVERAGED_COLLAR: 'LEVERAGED_COLLAR',
  QQQ_EQUITY_BOOST_PUT_SPREAD: 'QQQ_EQUITY_BOOST_PUT_SPREAD',
  QQQ_PCS_RESCUE: 'QQQ_PCS_RESCUE',
} as const;

export type OverlayStrategyTag = typeof OVERLAY_STRATEGY_TAGS[keyof typeof OVERLAY_STRATEGY_TAGS];

export const VIX_CRISIS = 35;
export const CRISIS_PRICE_PCT = -0.20;

// ── Equity rebalance trade thresholds ──────────────────────────────────────────
// Shared by 10-order-proposal (decides whether to emit an order) and
// 09-execution-guard (decides whether to approve the 'equity' proposal type).
// Keeping them in sync prevents the guard from approving a trade the order engine
// then silently drops (e.g. a 3% re-entry that clears the guard's old 2% floor but
// not the 5% buy floor).
export const MIN_BUY_DELTA_PCT  = 0.05;  // 5%  NAV target increase before buying（积极加仓）
export const MIN_SELL_DELTA_PCT = 0.10;  // 10% NAV target decrease before selling（避免下跌中恐慌减仓）
export const POST_CRISIS_FAST_ENTRY_DAYS = 10;
export const POST_CRISIS_FAST_ENTRY_BUY_DELTA_PCT = 0.02;

export function buyDeltaPctForPostCrisis(params?: StrategyParams, postCrisisBars?: number, force = false): number {
  const cfg = force ? true : params?.postCrisisFastEntry;
  if (!cfg || postCrisisBars == null || postCrisisBars < 0) return MIN_BUY_DELTA_PCT;
  const days = typeof cfg === 'object' ? cfg.days ?? POST_CRISIS_FAST_ENTRY_DAYS : POST_CRISIS_FAST_ENTRY_DAYS;
  if (postCrisisBars >= days) return MIN_BUY_DELTA_PCT;
  const floor = typeof cfg === 'object' ? cfg.minBuyDeltaPct ?? POST_CRISIS_FAST_ENTRY_BUY_DELTA_PCT : POST_CRISIS_FAST_ENTRY_BUY_DELTA_PCT;
  return Math.max(0, Math.min(MIN_BUY_DELTA_PCT, floor));
}

export function sellDeltaPctForRegime(regime: MarketRegime, params?: StrategyParams): number {
  const value = params?.sellDeltaByRegime?.[regime];
  return typeof value === 'number' && value >= 0 ? value : MIN_SELL_DELTA_PCT;
}

const CHOP_DAMPENER_REGIMES = new Set<MarketRegime>(['SIDEWAYS', 'RANGE_BOUND', 'RISK_ON_WEAKENING']);
const SELL_DELTA_ER_GATED_REGIMES = CHOP_DAMPENER_REGIMES;

function barsSince(date: string, bars: OHLCV[]): number {
  return bars.filter(b => b.date > date).length;
}

export function leveragedDeadbandPctForTrade(args: {
  side: 'BUY' | 'SELL';
  regime: MarketRegime;
  params?: StrategyParams;
  postCrisisBars?: number;
  qqqBars: OHLCV[];
  lastLeveragedTrade?: { side: 'BUY' | 'SELL'; date: string };
  riskSellExempt?: boolean;
  postCrisisFastEntry?: boolean;
  leveragedBars?: OHLCV[];
  actualTqqqPct?: number;
  targetTqqqPct?: number;
}): number {
  const { side, regime, params } = args;
  let er20: number | undefined;
  const qqqEr20 = () => er20 ??= calcEfficiencyRatio(closes(args.qqqBars), 20);
  let floor = side === 'BUY'
    ? buyDeltaPctForPostCrisis(params, args.postCrisisBars, args.postCrisisFastEntry)
    : sellDeltaPctForRegime(regime, params);

  if (
    side === 'SELL' &&
    params?.sellDeltaErThreshold !== undefined &&
    SELL_DELTA_ER_GATED_REGIMES.has(regime) &&
    qqqEr20() < params.sellDeltaErThreshold
  ) {
    floor = MIN_SELL_DELTA_PCT;
  }

  const overweightSell = params?.researchRiskOnWeakeningOverweightSellDelta;
  if (side === 'SELL' && regime === 'RISK_ON_WEAKENING' && overweightSell != null
    && Number.isFinite(args.actualTqqqPct) && Number.isFinite(args.targetTqqqPct)
    && args.actualTqqqPct! - args.targetTqqqPct! >= overweightSell.minGapPp / 100) {
    floor = Math.min(floor, Math.max(0, overweightSell.sellDeltaPp / 100));
  }

  const lossSell = params?.researchRiskOnWeakeningLossSellDelta;
  const leveragedOneDayReturn = args.leveragedBars && args.leveragedBars.length >= 2
    ? args.leveragedBars.at(-1)!.close / args.leveragedBars.at(-2)!.close - 1
    : undefined;
  if (side === 'SELL' && regime === 'RISK_ON_WEAKENING' && lossSell != null
    && Number.isFinite(leveragedOneDayReturn)
    && leveragedOneDayReturn! <= (lossSell.tqqqReturnMax ?? 0)) {
    floor = Math.min(floor, Math.max(0, lossSell.sellDeltaPp / 100));
  }

  const chop = params?.chopDampener;
  if (chop && CHOP_DAMPENER_REGIMES.has(regime)) {
    const threshold = chop.erThreshold ?? 0.25;
    const er = qqqEr20();
    if (threshold > 0 && er < threshold) floor *= chop.deadbandMult ?? 1.5;
  }

  const cooldown = params?.flipCooldownDays;
  const last = args.lastLeveragedTrade;
  if (
    cooldown != null &&
    cooldown > 0 &&
    last &&
    last.side !== side &&
    !args.riskSellExempt &&
    barsSince(last.date, args.qqqBars) < cooldown
  ) {
    floor *= 2;
  }

  const weakeningBuyCooldown = params?.researchRiskOnWeakeningBuyCooldownDays;
  if (
    side === 'BUY' &&
    regime === 'RISK_ON_WEAKENING' &&
    weakeningBuyCooldown != null &&
    weakeningBuyCooldown > 0 &&
    last?.side === 'SELL' &&
    barsSince(last.date, args.qqqBars) < weakeningBuyCooldown
  ) {
    floor *= 2;
  }

  return floor;
}

// ── Open eligibility ──────────────────────────────────────────────────────────

export const TQQQ_LARGE_POSITION_PCT       = 0.30;
export const VIX_FALLBACK                  = 20;
export const VIX_LOW_THRESHOLD             = 15;
export const CS_SP_LIKE_VIX_LOW            = 14;
export const CS_SP_LIKE_VIX_HIGH_DEFAULT   = 20;
export const CS_SP_LIKE_EXTENSION_GATE     = 2;
export const TQQQ_OVERBOUGHT_ROC           = 0.20;  // 20% in 20 trading days
export const TQQQ_RECOVERY_ROC20           = 0.10;  // strict_recovery: avoid selling calls after full momentum loss
export const QQQ_RECOVERY_ROC5             = 0.00;  // strict_recovery: require short-term repair after weakening
export const SELL_ALTERNATIVE_EXCESS_THRESHOLD = 0.03; // 3% overweight vs target
export const MIN_POST_BEAR_DAYS            = 40;    // suppress overheat collar after BEAR/CRISIS exit

// pcsMode='post_pullback': sell PCS after a real pullback/fear spike shows up, instead of during
// calm complacency. See docs/overlay-tuning/pcs-alternative-entry-research-2026-07.md.
export const PCS_PULLBACK_ROC5_CEILING     = -0.03; // QQQ 5-day ROC must be <= this (a real pullback happened)
export const PCS_PULLBACK_VIX_FLOOR        = 20;    // VIX must be >= this (elevated, richer premium)

// Target DTE when opening new positions
export const COLLAR_TARGET_DTE             = 37;    // collar: aim for 30-45 DTE cycle
export const SPREAD_TARGET_DTE             = 28;    // call credit spread
export const IC_TARGET_DTE                 = 37;    // iron condor

// Put Spread Collar delta targets for opening legs
export const COLLAR_SHORT_CALL_DELTA       = 0.15;  // short call (covered, capped upside)
export const COLLAR_LONG_PUT_DELTA         = 0.25;  // long put (protection floor)
export const COLLAR_SHORT_PUT_DELTA        = 0.10;  // short lower put (tail cut-off, spread leg)

// Call Credit Spread budget
// 10% of NAV total CS exposure. Calibrated 2026-07 via compare-window + robustness:
// 0.05 left return on the table (2025 ultra CAGR 31.9%→35.7% at 0.10, MDD unchanged;
// 2018 improved both), while the original 0.215 was the single largest MDD driver
// (user-window MDD 16.7%→23.6%). 0.10 dominates or ties 0.05 on every slice tested.
export const CS_MAX_TOTAL_RISK_NAV         = 0.10;
export const CS_SPREAD_WIDTH_PCT           = 0.02;  // long strike offset from short strike, as % of spot (narrower → smaller maxLoss/contract → more contracts fit budget)

// Collar drawdown trigger thresholds (when to open)
export const COLLAR_DRAWDOWN_PERIOD        = 20;    // look-back window (non-BULL regimes, trading days)
export const COLLAR_DRAWDOWN_PERIOD_BULL   = 5;     // shorter in BULL to avoid false triggers at ATH
export const COLLAR_DRAWDOWN_TRIGGER       = 0.03;  // 3% pullback → open collar (non-BULL)
export const COLLAR_DRAWDOWN_TRIGGER_BULL  = 0.02;  // 2% pullback → open collar (BULL, 5d window)

// VIX single-day spike trigger
export const COLLAR_VIX_SPIKE_PCT          = 0.20;  // 20% intraday VIX jump → open collar
export const COLLAR_VIX_SPIKE_FLOOR        = 18;    // absolute VIX floor required after spike

// Single-position risk budget for iron condor (only one IC open at a time, gated by
// the v2 strategy coordinator), so this also acts as IC's total exposure cap.
// Bump this to scale all three tiers' maxRiskPct together without touching their ratios.
export const IC_RISK_PCT_MULTIPLIER       = 5;

// Iron Condor per-mode parameters
//   exitDelta       — short-leg delta that forces an early close (per-mode; relaxed/aggressive
//                     sell closer to ATM so they need more room before stopping out).
//   rangeBufferPct  — 20d range-breach tolerance: only close when price exceeds the open-time
//                     edge by this fraction (standard 0 = legacy "first-touch" behavior).
//   minCreditRatio  — open-eligibility floor on credit / wingWidth; rejects low-credit, negative
//                     -expectancy condors instead of opening on any netCredit > 0.
export const IC_MODE_CONFIG: Record<ICMode, {
  regimes: string[];
  delta: number;
  wingPct: number;
  vixMin: number;
  vixMax: number;
  edgePct: number;
  maxRiskPct: number;
  exitDelta: number;
  rangeBufferPct: number;
  minCreditRatio: number;
}> = {
  standard:   { regimes: ['RANGE_BOUND'],                                        delta: 0.15, wingPct: 0.03, vixMin: 14, vixMax: 28, edgePct: 0.03, maxRiskPct: 0.03 * IC_RISK_PCT_MULTIPLIER, exitDelta: 0.35, rangeBufferPct: 0,     minCreditRatio: 0.15 },
  relaxed:    { regimes: ['RANGE_BOUND', 'SIDEWAYS'],                            delta: 0.20, wingPct: 0.04, vixMin: 14, vixMax: 32, edgePct: 0.02, maxRiskPct: 0.04 * IC_RISK_PCT_MULTIPLIER, exitDelta: 0.40, rangeBufferPct: 0.015, minCreditRatio: 0.15 },
  aggressive: { regimes: ['RANGE_BOUND', 'SIDEWAYS', 'RISK_ON_WEAKENING'],       delta: 0.22, wingPct: 0.05, vixMin: 12, vixMax: 35, edgePct: 0.01, maxRiskPct: 0.05 * IC_RISK_PCT_MULTIPLIER, exitDelta: 0.45, rangeBufferPct: 0.025, minCreditRatio: 0.12 },
};

// ── Collar exit thresholds ────────────────────────────────────────────────────

export const COLLAR_EXIT_DTE                 = 3;    // close within 3 DTE to avoid pin risk
export const COLLAR_CALL_EXIT_DELTA          = 0.35; // short call forced close (normal regimes)
export const COLLAR_CALL_EXIT_DELTA_OVERHEAT = 0.50; // wider threshold in overheat mode
export const COLLAR_LONG_PUT_EXIT_DELTA      = 0.50; // long put deep ITM: cash out gains
export const COLLAR_STOP_PER_CONTRACT        = 500;  // $500 MtM loss/contract → stop-loss
export const COLLAR_VIX_REGIME_EXIT          = 22;   // VIX normalises below this → exit spike collar
export const COLLAR_DRAWDOWN_RECOVERY        = 0.01; // <1% drawdown from 20d high → exit recovery collar
export const COLLAR_DRAWDOWN_PERIOD_EXIT     = 20;   // look-back window for recovery check

// ── Call Credit Spread exit ───────────────────────────────────────────────────

export const CS_EARLY_EXIT_DELTA             = 0.35; // short call delta → forced close
export const CS_PROFIT_TARGET_DEFAULT         = 0.6;  // opt-in: close once profit reaches this % of credit, freeing the slot for re-entry (dead-cat-bounce)

// ── Put Credit Spread exit ────────────────────────────────────────────────────
// Both opt-in (default off — see StrategyParams.pcsDeltaStopEnabled/pcsProfitTakeEnabled).
// Naively reusing CS_EARLY_EXIT_DELTA's 0.35 threshold made aggregate PCS PnL WORSE in
// backtest (see docs/overlay-tuning/pcs-exit-management-research-2026-07.md) — these are
// just fallback defaults for when the feature is enabled without an explicit threshold;
// PT2/PE2's grid scan determines the actual adoptable value, if any.

export const PCS_DELTA_STOP_DEFAULT          = 0.35; // short put delta → forced close, if pcsDeltaStopEnabled and no explicit pcsDeltaStopThreshold
export const PCS_PROFIT_TARGET_DEFAULT       = 0.6;  // opt-in: close once profit reaches this % of credit, if pcsProfitTakeEnabled and no explicit pcsProfitTarget

// ── Equity Boost Put Spread (QQQ 1:1 defined-risk credit spread) ─────────────
// Independent strategy: short ITM put + long OTM put, same expiry/quantity, targeting
// ~1:1 net credit : max loss. Fixed strategy constants (not UI params) per spec — do not
// expose ratio tolerance or moneyness range as tunable StrategyParams fields.
export const EQUITY_BOOST_MONEYNESS_MIN       = 0.005; // 0.5% ITM/OTM floor for both legs
export const EQUITY_BOOST_MONEYNESS_MAX       = 0.03;  // 3% ITM/OTM ceiling for both legs
export const EQUITY_BOOST_RATIO_MIN           = 0.8;   // netCredit / maxLoss lower bound
export const EQUITY_BOOST_RATIO_MAX           = 1.2;   // netCredit / maxLoss upper bound
export const EQUITY_BOOST_CANDIDATE_DTES      = [21, 28, 35, 42] as const;
export const EQUITY_BOOST_DEFAULT_TARGET_DTE  = 28;
export const EQUITY_BOOST_DEFAULT_MAX_RISK_NAV = 0.02; // 2% NAV max loss per position, single concurrent position

// ── EB2 research iteration: melt_up entry mode (low-VIX, near-highs, positive momentum) ──
export const EQUITY_BOOST_MELTUP_LOOKBACK      = 60;   // trading days, rolling-high window (fixed, regime-independent)
export const EQUITY_BOOST_MELTUP_DRAWDOWN_MAX  = 0.02; // must be within 2% of the 60d rolling high
export const EQUITY_BOOST_MELTUP_VIX_CEILING   = 15;   // VIX must be <= this (quiet-market gate)
export const EQUITY_BOOST_MELTUP_ROC20_MIN     = 0;    // QQQ 20d ROC must be > this (positive momentum, no dip required)

// ── Iron Condor exit ──────────────────────────────────────────────────────────

export const IC_EARLY_EXIT_DELTA             = 0.35; // legacy default; live exit uses IC_MODE_CONFIG[mode].exitDelta
export const IC_PROFIT_TARGET_DEFAULT        = 0.5;  // opt-in: close once profit reaches this % of credit, freeing the slot for re-entry

// ── Bear Call Spread (open) ───────────────────────────────────────────────────

export const BEAR_DTE_MIN                    = 21;
export const BEAR_DTE_MAX                    = 45;
export const BEAR_DTE_TARGET                 = 32;
export const BEAR_SHORT_DELTA_MIN            = 0.25;
export const BEAR_SHORT_DELTA_MAX            = 0.40;
export const BEAR_SHORT_DELTA_TARGET         = 0.32;
export const BEAR_WIDTH_MIN                  = 5;    // spread width in points
export const BEAR_WIDTH_MAX                  = 10;
export const BEAR_MIN_CREDIT_TO_MAX_LOSS     = 0.22; // minimum credit/maxLoss ratio
export const BEAR_MAX_SINGLE_RISK            = 0.02; // 2% NAV per spread
export const BEAR_MAX_TOTAL_RISK             = 0.12; // 12% NAV total
export const BEAR_MAX_OPEN_SPREADS           = 6;
export const BEAR_COOLDOWN_AFTER_OPEN_DAYS   = 3;
export const BEAR_COOLDOWN_AFTER_LOSS_DAYS   = 10;

// ── Bear Call Spread (exit) ───────────────────────────────────────────────────

export const BEAR_CS_DTE_EXIT                = 7;    // close when DTE < 7
export const BEAR_CS_DELTA_EXIT              = 0.45; // short call delta → close/review
export const BEAR_CS_ROC5_EXIT               = 0.08; // QQQ 5-day ROC > 8% → strong rally, close
export const BEAR_CS_PROFIT_TARGET_DEFAULT   = 0.60; // take profit at 60% of credit received
export const BEAR_CS_STOP_LOSS_CREDIT_MULT   = 2.0;  // stop = min(2×credit, 70%×maxLoss)
export const BEAR_CS_STOP_LOSS_MAX_LOSS_PCT  = 0.70;
