import type { PipelineContext, EngineResult, IntradayGateData } from '../types/pipeline';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_INTRADAY_DERISK_TIERS } from '../types/params';

/**
 * E06b — Intraday De-Risk Gate (opt-in, live-only)
 *
 * The daily engines (03~06) produce a close-based TQQQ target. This gate sits on
 * top of RiskBudget and, when the real-time leveraged price has dropped intraday
 * vs the last *completed* daily close beyond a tier threshold, scales the target
 * down immediately instead of waiting for the close. Freed weight is split 50/50
 * between cash and BOXX.
 *
 * The intraday return is always computed (live data permitting) and reported for
 * diagnostics / the provisional equity point — even when the de-risk *action* is
 * disabled. Only the target mutation is gated by `intradayDeRisk`.
 *
 * Mutates ctx.results.riskBudget.data in place so every downstream consumer
 * (07~10) automatically reads the de-risked allocation.
 *
 * No-op when: backtest mode, disabled, no live quote, market effectively closed
 * (live ≈ last close), upside move, or the move doesn't reach tier 1.
 */
export function runIntradayRiskGate(ctx: PipelineContext): EngineResult<IntradayGateData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const budget = ctx.results.riskBudget?.data;

  const inert = (reason: string, extra?: Partial<IntradayGateData>): EngineResult<IntradayGateData> => ({
    engineId: 'IntradayRiskGate',
    status: 'PASS',
    data: {
      triggered: false,
      reason,
      keepFactor: 1,
      preGateTqqqPct: budget?.final_tqqq_pct,
      ...extra,
    },
    warnings: [],
    blockers: [],
  });

  if (ctx.input.mode === 'backtest' && !ctx.input.intradayGateBacktestEnabled) return inert('backtest');

  const leveragedSymbol = ctx.input.leveragedSymbol ?? 'TQQQ';
  const livePrice = ctx.input.currentPrices?.leveraged;

  // Reference = last COMPLETED daily close (skip today's forming bar so an intraday
  // bar whose close already equals the live price doesn't zero out the move). Compare
  // by day-key, not the raw date string — in a backtest replay `bars` is the day-
  // aggregated view (day-keyed dates) while `ctx.input.date` is the bar's full
  // intraday timestamp, so a raw string compare would never match "today" and would
  // wrongly pick today's own forming close as the reference.
  const bars = ctx.input.prices.TQQQ ?? [];
  const todayKey = ctx.input.date.slice(0, 10);
  let refClose: number | undefined;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date.slice(0, 10) !== todayKey) { refClose = bars[i].close; break; }
  }
  if (refClose == null) refClose = bars.at(-1)?.close; // single-bar fallback

  // Diagnostic intraday return, computed regardless of whether de-risk is applied.
  const hasLive = typeof livePrice === 'number' && livePrice > 0 && refClose != null && refClose > 0;
  const intradayReturnPct = hasLive ? (livePrice! - refClose!) / refClose! : undefined;
  const diag: Partial<IntradayGateData> = { intradayReturnPct, refClose, livePrice };

  if (!p.intradayDeRisk) return inert('disabled', diag);
  if (!budget) return inert('no_budget', diag);
  if (!hasLive) return inert(livePrice == null || livePrice <= 0 ? 'no_live_quote' : 'no_ref_close', diag);

  // Only de-risk on downside. Epsilon guards a stale quote equal to last close
  // (market closed / weekend), which would otherwise read as a 0% move.
  if (intradayReturnPct! >= -1e-4) return inert('no_downside', diag);

  const tiers = (p.intradayDeRiskTiers?.length ? p.intradayDeRiskTiers : DEFAULT_INTRADAY_DERISK_TIERS)
    .slice()
    .sort((a, b) => a.dropPct - b.dropPct);
  const drop = -intradayReturnPct!;
  let keepFactor = 1;
  let matchedDropPct: number | undefined;
  for (const t of tiers) {
    if (drop >= t.dropPct) {
      keepFactor = t.keepFactor;
      matchedDropPct = t.dropPct;
    }
  }
  if (matchedDropPct == null) return inert('below_first_tier', diag);

  const preGate = budget.final_tqqq_pct;
  if (preGate <= 0) return inert('already_flat', { ...diag, keepFactor, matchedDropPct });

  const adjusted = Math.max(0, preGate * keepFactor);
  const freed = Math.max(0, preGate - adjusted);

  // Apply: shrink TQQQ, split freed weight 50/50 cash + BOXX (sum is preserved).
  budget.pre_gate_tqqq_pct = preGate;
  budget.final_tqqq_pct = adjusted;
  budget.final_cash_pct += freed / 2;
  budget.final_boxx_pct += freed / 2;

  const deepest = tiers[tiers.length - 1];
  const suggestHedge = deepest != null && matchedDropPct === deepest.dropPct;

  const warnings: string[] = [
    `日内降险：${leveragedSymbol} ${(intradayReturnPct! * 100).toFixed(1)}% → TQQQ 目标 ×${keepFactor.toFixed(2)}（${(preGate * 100).toFixed(1)}% → ${(adjusted * 100).toFixed(1)}%）`,
  ];
  if (suggestHedge) warnings.push('日内大幅下挫，建议加对冲（Collar / Put）');

  return {
    engineId: 'IntradayRiskGate',
    status: 'WARN',
    data: {
      triggered: true,
      reason: 'tier_matched',
      intradayReturnPct,
      keepFactor,
      matchedDropPct,
      preGateTqqqPct: preGate,
      refClose,
      livePrice,
      suggestHedge,
    },
    warnings,
    blockers: [],
  };
}
