import type { PipelineContext, EngineResult, RegimeData } from '../types/pipeline';
import type { BearMarketPhase, MarketRegime } from '../types/output';
import { calcLatestBarROC, calcLatestBarSMA, calcSMA, calcRSI, calc20dRange, calcADX, calcATR, closes } from '../utils';
import { CRISIS_PRICE_PCT, VIX_CRISIS, VIX_FALLBACK } from '../constants';
import { DEFAULT_STRATEGY_PARAMS } from '../types/params';

const VIX_BEAR = 25;
const VIX_BULL_MAX = 25;

// RANGE_BOUND thresholds — calibrated for QQQ historical data
// QQQ 20d high/low range is typically 8-15%，so 14% is the practical ceiling
const RANGE_VIX_MIN = 13;
const RANGE_VIX_MAX = 27;
const RANGE_RSI_MIN = 35;
const RANGE_RSI_MAX = 62;          // was 65 — RSI 63-65 is normal bull pullback, not oscillation
const RANGE_20D_PCT_MAX = 0.14;    // 20d high-low range < 14%
const RANGE_MA50_SLOPE_MAX = 0.02; // was 0.03 — bull MA50 naturally slopes 2-3%, require truly flat
const RANGE_ADX_MAX = 20;          // was 25 — ADX 20-25 = weakening trend, not true oscillation
const RISK_ON_EXTENDED_RSI = 65;
const RISK_ON_EXTENDED_ATR = 1.5;  // price extension above SMA20, in ATR units
const RISK_ON_WEAKENING_MIN_SIGNALS = 3; // raised from 2 — avoid false triggers on normal consolidation

const regimeRiskRank = (regime: MarketRegime): number => {
  switch (regime) {
    case 'CRISIS': return 0;
    case 'BEAR': return 1;
    case 'RANGE_BOUND': return 2;
    case 'SIDEWAYS': return 3;
    case 'RISK_ON_WEAKENING': return 4;
    case 'BULL':
    case 'RISK_ON_EXTENDED':
      return 5;
  }
};

export function runMarketRegime(ctx: PipelineContext): EngineResult<RegimeData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const { prices, macro } = ctx.input;
  const blockers: string[] = [];
  const warnings: string[] = [];

  const qqqBars   = prices.QQQ;
  const idx = qqqBars.length - 1;
  const rolling = ctx.input.precomputedIndicators?.qqq;
  const price  = qqqBars.at(-1)?.close ?? 0;
  const sma20  = calcLatestBarSMA(qqqBars, 20);
  const sma50  = calcLatestBarSMA(qqqBars, 50);
  const sma200 = calcLatestBarSMA(qqqBars, 200);
  const vix    = macro.vix ?? VIX_FALLBACK;

  if (macro.vix == null) {
    warnings.push(`VIX 缺失，使用默认值 ${VIX_FALLBACK}`);
  }

  const price_vs_sma200_pct = sma200 > 0 ? (price - sma200) / sma200 : 0;
  const distanceToSma20Pct = sma20 > 0 ? (price - sma20) / sma20 : 0;
  const distanceToSma50Pct = sma50 > 0 ? (price - sma50) / sma50 : 0;
  const roc5 = rolling ? rolling.rocAt(idx, 5) : (calcLatestBarROC(qqqBars, 5) ?? 0);

  // --- auxiliary indicators for RANGE_BOUND ---
  // rsi14/adx14 are Wilder-smoothed (recursive over the whole history), so a plain recompute is
  // O(n) per call; `rolling` (built once over the full backtest series) gives O(1) lookups here.
  const rsi14       = rolling ? rolling.rsiAt(idx, 14) : calcRSI(closes(qqqBars), 14);
  const adx14       = rolling ? rolling.adxAt(idx, 14) : calcADX(qqqBars, 14);
  const range20d    = rolling ? rolling.rangeAt(idx, 20) : calc20dRange(qqqBars);
  const recentLow20d = range20d.low;
  const sma50_prev  = qqqBars.length >= 70
    ? (rolling ? rolling.smaAt(idx - 20, 50) : calcSMA(closes(qqqBars).slice(0, -20), 50))
    : 0;
  const ma50SlopeSignedPct = sma50_prev > 0 ? (sma50 - sma50_prev) / sma50_prev : 0;
  const ma50SlopePct = sma50_prev > 0 ? Math.abs(ma50SlopeSignedPct) : 1;

  // Extra indicators for RISK_ON_EXTENDED / RISK_ON_WEAKENING
  const sma20_prev = qqqBars.length >= 25
    ? (rolling ? rolling.smaAt(idx - 5, 20) : calcSMA(closes(qqqBars).slice(0, -5), 20))
    : 0;
  const sma20SlopePct = sma20_prev > 0 ? (sma20 - sma20_prev) / sma20_prev : 0;
  const recentHigh60d = qqqBars.length > 0
    ? (rolling ? rolling.highAt(idx, 60) : Math.max(...qqqBars.slice(-60).map(b => b.high)))
    : price;
  const drawdownFromRecentHighPct = recentHigh60d > price ? (recentHigh60d - price) / recentHigh60d : 0;
  const atr14 = rolling ? rolling.atrAt(idx, 14) : calcATR(qqqBars, 14);
  const priceExtensionAtr = atr14 > 0 && sma20 > 0 ? (price - sma20) / atr14 : 0;
  const vixBase = macro.prevVix ?? vix;
  const vixChange5d = vixBase > 0 ? (vix - vixBase) / vixBase : 0;

  // RISK_ON_EXTENDED: hot bull — price extended above SMA20, RSI overbought, low VIX
  const riskOnExtended =
    price > sma200 &&
    price > sma20 &&
    rsi14 >= RISK_ON_EXTENDED_RSI &&
    priceExtensionAtr >= RISK_ON_EXTENDED_ATR &&
    vix < VIX_BULL_MAX;

  // RISK_ON_WEAKENING: still above SMA200, VIX still in bull range, but short-term momentum weakening.
  // Requires VIX < VIX_BULL_MAX to prevent stealing genuine SIDEWAYS days (VIX >= 25, price > SMA200).
  // Signals (need 3+): price < SMA20, SMA20 slope negative, 5d momentum negative,
  //                    VIX 1d spike >= 15%, drawdown from 60d high >= 3%
  const weakeningSignals = [
    sma20 > 0 && price < sma20,        // below short-term MA
    sma20SlopePct < 0,                  // SMA20 turning down
    roc5 < 0,                           // 5-day momentum negative
    vixChange5d > 0.15,                 // VIX 1-day spike 15%+ (prevVix is yesterday, not 5d ago)
    drawdownFromRecentHighPct >= 0.03,  // pulled back 3%+ from 60d high
  ];
  const weakeningSignalCount = weakeningSignals.filter(Boolean).length;
  const weakeningMinSignals = Math.max(2, Math.min(5, Math.trunc(p.riskOnWeakeningMinSignals ?? RISK_ON_WEAKENING_MIN_SIGNALS)));
  const riskOnWeakeningVixMax = Math.max(VIX_BULL_MAX, Math.min(35, p.riskOnWeakeningVixMax ?? VIX_BULL_MAX));
  const riskOnWeakening =
    price > sma200 &&
    vix < riskOnWeakeningVixMax &&     // research-only ceiling; baseline remains the bull-VIX ceiling
    weakeningSignalCount >= weakeningMinSignals;

  // SMA50 direction: positive = turning up (recovery signal)
  const sma50Ascending = sma50_prev > 0 && sma50 > sma50_prev;

  // ADX surrogate when data is insufficient
  const isLowTrend = adx14 > 0 ? adx14 < RANGE_ADX_MAX : (ma50SlopePct < 0.008 && range20d.pct < 0.06);

  let regime: MarketRegime;
  let bearMarketPhase: BearMarketPhase | undefined;
  let confidence: number;

  const vixBackwardationCrash =
    macro.vix3m != null &&
    vix / macro.vix3m >= 1.05 &&
    roc5 <= -0.06;
  const bearRally =
    price < sma200 * 0.98 &&
    (sma50 < sma200 || ma50SlopeSignedPct <= 0) &&
    (Math.abs(distanceToSma20Pct) <= 0.03 || Math.abs(distanceToSma50Pct) <= 0.03) &&
    rsi14 >= 45 && rsi14 <= 60 &&
    vix >= 18 && vix < VIX_CRISIS &&
    roc5 <= 0.08;
  const bearAcceleration =
    price < sma200 &&
    (distanceToSma20Pct <= -0.05 || distanceToSma50Pct <= -0.08) &&
    (price <= recentLow20d || (macro.prevVix != null && vix > macro.prevVix)) &&
    (rsi14 < 40 || roc5 <= -0.06);

  if (vix >= VIX_CRISIS || price_vs_sma200_pct <= CRISIS_PRICE_PCT || vixBackwardationCrash) {
    regime = 'CRISIS';
    bearMarketPhase = 'CRISIS';
    confidence = 9;
    blockers.push(`市场进入危机状态：VIX=${vix.toFixed(1)}, 价格相对SMA200=${(price_vs_sma200_pct * 100).toFixed(1)}%`);
  } else if (bearAcceleration) {
    regime = 'BEAR';
    bearMarketPhase = 'BEAR_ACCELERATION';
    confidence = 8;
    warnings.push(
      `熊市加速：QQQ 距SMA20 ${(distanceToSma20Pct * 100).toFixed(1)}%，距SMA50 ${(distanceToSma50Pct * 100).toFixed(1)}%，RSI14=${rsi14.toFixed(1)}, ROC5=${(roc5 * 100).toFixed(1)}%`
    );
  } else if (bearRally) {
    regime = 'BEAR';
    bearMarketPhase = 'BEAR_RALLY';
    confidence = 8;
    warnings.push(
      `熊市反弹：QQQ 低于SMA200且接近SMA20/SMA50阻力，RSI14=${rsi14.toFixed(1)}, VIX=${vix.toFixed(1)}, ROC5=${(roc5 * 100).toFixed(1)}%`
    );
  } else if (price < sma200 && vix >= VIX_BEAR) {
    regime = 'BEAR';
    bearMarketPhase = 'BEAR_TREND';
    confidence = 8;
  } else if (
    price > sma200 &&
    vix >= RANGE_VIX_MIN && vix <= RANGE_VIX_MAX &&
    rsi14 >= RANGE_RSI_MIN && rsi14 <= RANGE_RSI_MAX &&
    range20d.pct < RANGE_20D_PCT_MAX &&
    ma50SlopePct < RANGE_MA50_SLOPE_MAX &&
    isLowTrend
  ) {
    // RANGE_BOUND must be checked before BULL sub-states to prevent RISK_ON_WEAKENING
    // from stealing oscillating-range days (flat MA50, low ADX, RSI mid-range)
    regime = 'RANGE_BOUND';
    confidence = 7;
    warnings.push(
      `震荡区间识别：VIX=${vix.toFixed(1)}, RSI14=${rsi14.toFixed(1)}, 20日幅度=${(range20d.pct * 100).toFixed(1)}%, ADX=${adx14.toFixed(1)}`
    );
  } else if (price > sma200 && sma50 > sma200 && (vix < VIX_BULL_MAX || riskOnWeakening)) {
    // Full bull (golden cross) — check sub-states first
    if (riskOnExtended) {
      regime = 'RISK_ON_EXTENDED';
      confidence = 8;
      warnings.push(`RISK_ON_EXTENDED：QQQ 过热，RSI14=${rsi14.toFixed(1)}，价格延伸=${priceExtensionAtr.toFixed(1)} ATR`);
    } else if (riskOnWeakening) {
      regime = 'RISK_ON_WEAKENING';
      confidence = 7;
      warnings.push(
        `RISK_ON_WEAKENING（牛市转弱）：${weakeningSignalCount}/5 信号 — 距高点-${(drawdownFromRecentHighPct * 100).toFixed(1)}%，SMA20斜率${(sma20SlopePct * 100).toFixed(2)}%，ROC5=${(roc5 * 100).toFixed(1)}%`
      );
    } else {
      regime = 'BULL';
      confidence = 8;
    }
  } else if (price > sma200 && sma50Ascending && price > sma50 && (vix < VIX_BULL_MAX || riskOnWeakening)) {
    // Nascent bull (SMA50 turning up, not yet golden cross) — check weakening sub-state
    if (riskOnWeakening) {
      regime = 'RISK_ON_WEAKENING';
      confidence = 6;
      warnings.push(
        `RISK_ON_WEAKENING（初期牛市转弱）：${weakeningSignalCount}/5 信号`
      );
    } else {
      regime = 'BULL';
      confidence = 7;
      warnings.push('初期牛市（SMA50 仍在 SMA200 之下，但斜率向上），降置信度至 7');
    }
  } else {
    regime = 'SIDEWAYS';
    confidence = 6;
    if (price > sma200 && vix >= VIX_BULL_MAX) {
      warnings.push('价格在 SMA200 之上但 VIX 偏高，归类为 SIDEWAYS');
    } else if (price < sma200 && vix < VIX_BEAR) {
      warnings.push('价格在 SMA200 之下但 VIX 尚低，归类为 SIDEWAYS');
    }
  }

  const rawRegime = regime;
  let nextConfirmState = ctx.input.regimeConfirmState;
  const confirmBars = p.regimeConfirmBars ?? 0;
  const confirmEnabled = confirmBars > 1 && !!nextConfirmState;
  if (confirmEnabled) {
    const state = nextConfirmState!;
    const previous = state.confirmedRegime;
    if (rawRegime === previous) {
      nextConfirmState = { confirmedRegime: rawRegime };
    } else if (rawRegime !== 'CRISIS' && regimeRiskRank(rawRegime) < regimeRiskRank(previous)) {
      const candidateBars = state.candidateRegime === rawRegime
        ? (state.candidateBars ?? 0) + 1
        : 1;
      if (candidateBars >= confirmBars) {
        nextConfirmState = { confirmedRegime: rawRegime };
      } else {
        regime = previous;
        bearMarketPhase = previous === 'BEAR' ? bearMarketPhase : undefined;
        nextConfirmState = { confirmedRegime: previous, candidateRegime: rawRegime, candidateBars };
        warnings.push(`Regime 降档待确认：${previous} → ${rawRegime}（${candidateBars}/${confirmBars}）`);
      }
    } else {
      nextConfirmState = { confirmedRegime: rawRegime };
    }
  }

  const status = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'MarketRegime',
    status,
    data: {
      regime,
      ...(confirmEnabled ? { rawRegime, regimeConfirmState: nextConfirmState } : {}),
      bearMarketPhase,
      crisisPhase: ctx.input.crisisPhase,
      sma20,
      sma50,
      sma200,
      price_vs_sma200_pct,
      roc5,
      distanceToSma20Pct,
      distanceToSma50Pct,
      vix: macro.vix ?? null,
      confidence,
      rsi14,
      adx14,
      range20d_pct: range20d.pct,
      ma50_slope_pct: ma50SlopePct,
      sma20_slope_pct: sma20SlopePct,
      vix_change_5d: vixChange5d,
      drawdown_from_recent_high_pct: drawdownFromRecentHighPct,
      price_extension_atr: priceExtensionAtr,
      weakening_signal_count: weakeningSignalCount,
    },
    warnings,
    blockers,
  };
}
