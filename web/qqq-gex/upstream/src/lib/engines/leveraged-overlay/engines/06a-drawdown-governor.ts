import type { DrawdownGovernorData, EngineResult, PipelineContext } from '../types/pipeline';
import { DEFAULT_STRATEGY_PARAMS, navDrawdownGovernorRegimeGated, navDrawdownGovernorTiers } from '../types/params';

export function runDrawdownGovernor(ctx: PipelineContext): EngineResult<DrawdownGovernorData> {
  const p = ctx.input.strategyParams ?? DEFAULT_STRATEGY_PARAMS;
  const budget = ctx.results.riskBudget?.data;
  const nav = ctx.input.account.netLiquidation;
  const peakNav = ctx.input.navDrawdownPeak;

  const inert = (reason: string, extra?: Partial<DrawdownGovernorData>): EngineResult<DrawdownGovernorData> => ({
    engineId: 'DrawdownGovernor',
    status: 'PASS',
    data: {
      triggered: false,
      reason,
      factor: 1,
      preGovernorTqqqPct: budget?.final_tqqq_pct,
      ...extra,
    },
    warnings: [],
    blockers: [],
  });

  const tiers = navDrawdownGovernorTiers(p.navDrawdownGovernor);
  if (tiers.length === 0) return inert('disabled');
  if (!budget) return inert('no_budget');
  if (peakNav == null || peakNav <= 0 || nav <= 0) return inert('no_peak', { nav, peakNav });

  const drawdownPct = Math.max(0, (peakNav - nav) / peakNav);
  const regime = ctx.results.regime?.data.regime;
  const recoveryTargetCap = !Array.isArray(p.navDrawdownGovernor)
    ? p.navDrawdownGovernor?.recoveryTargetCap
    : undefined;
  const recoveryCapInScope = recoveryTargetCap != null
    && drawdownPct >= recoveryTargetCap.minDrawdownPct
    && (recoveryTargetCap.regimeIn == null || recoveryTargetCap.regimeIn.includes(regime as never));
  let recoveryCapApplied = false;
  if (recoveryCapInScope && budget.final_tqqq_pct > recoveryTargetCap.maxTargetPct) {
    const beforeCap = budget.final_tqqq_pct;
    const freed = beforeCap - recoveryTargetCap.maxTargetPct;
    budget.final_tqqq_pct = recoveryTargetCap.maxTargetPct;
    budget.final_cash_pct += freed / 2;
    budget.final_boxx_pct += freed / 2;
    recoveryCapApplied = true;
  }
  const regimeIn = !Array.isArray(p.navDrawdownGovernor) ? p.navDrawdownGovernor?.regimeIn : undefined;
  if (regimeIn && !regimeIn.includes(regime as never)) {
    return inert('regime_not_in_scope', { nav, peakNav, drawdownPct });
  }
  if (!regimeIn && navDrawdownGovernorRegimeGated(p.navDrawdownGovernor) && regime !== 'BEAR' && regime !== 'CRISIS') {
    return inert('regime_not_bear_or_crisis', { nav, peakNav, drawdownPct });
  }
  const marketRiskGate = !Array.isArray(p.navDrawdownGovernor) ? p.navDrawdownGovernor?.marketRiskGate : undefined;
  if (marketRiskGate) {
    const vix = ctx.results.regime?.data.vix ?? undefined;
    const vixChange5d = ctx.results.regime?.data.vix_change_5d ?? undefined;
    const regime = ctx.results.regime?.data.regime ?? undefined;
    const roc5 = ctx.results.regime?.data.roc5 ?? undefined;
    const roc20 = ctx.results.trend?.data.roc20 ?? undefined;
    const vixOk = marketRiskGate.vixMin == null || (vix != null && vix >= marketRiskGate.vixMin);
    const vixRiseOk = marketRiskGate.vixRise5dMin == null || (vixChange5d != null && vixChange5d >= marketRiskGate.vixRise5dMin);
    const roc5Ok = marketRiskGate.roc5Max == null || (roc5 != null && roc5 <= marketRiskGate.roc5Max);
    const roc20Ok = marketRiskGate.roc20Max == null || (roc20 != null && roc20 <= marketRiskGate.roc20Max);
    if (!vixOk || !vixRiseOk || !roc5Ok || !roc20Ok) return inert('market_gate_not_met', { nav, peakNav, drawdownPct });
  }

  const sortedTiers = tiers
    .slice()
    .sort((a, b) => a.ddPct - b.ddPct);

  let factor = 1;
  let matchedDdPct: number | undefined;
  for (const t of sortedTiers) {
    if (drawdownPct >= t.ddPct) {
      factor = t.factor;
      matchedDdPct = t.ddPct;
    }
  }
  if (matchedDdPct == null) {
    if (recoveryCapApplied) {
      return {
        engineId: 'DrawdownGovernor',
        status: 'WARN',
        data: { triggered: true, reason: 'recovery_target_cap', nav, peakNav, drawdownPct, factor: 1, matchedDdPct },
        warnings: [`NAV回撤目标上限：距峰值 -${(drawdownPct * 100).toFixed(1)}% → TQQQ目标 ≤${(recoveryTargetCap!.maxTargetPct * 100).toFixed(1)}%`],
        blockers: [],
      };
    }
    return inert('below_first_tier', { nav, peakNav, drawdownPct });
  }

  const marketRecoveryRelease = !Array.isArray(p.navDrawdownGovernor)
    ? p.navDrawdownGovernor?.marketRecoveryRelease
    : undefined;
  if (marketRecoveryRelease) {
    const vix = ctx.results.regime?.data.vix ?? undefined;
    const roc5 = ctx.results.regime?.data.roc5 ?? undefined;
    const roc20 = ctx.results.trend?.data.roc20 ?? undefined;
    const roc5Ok = marketRecoveryRelease.roc5Min == null || (roc5 != null && roc5 >= marketRecoveryRelease.roc5Min);
    const roc20Ok = marketRecoveryRelease.roc20Min == null || (roc20 != null && roc20 >= marketRecoveryRelease.roc20Min);
    const vixOk = marketRecoveryRelease.vixMax == null || (vix != null && vix <= marketRecoveryRelease.vixMax);
    const regimeOk = marketRecoveryRelease.regimeIn == null || marketRecoveryRelease.regimeIn.includes(regime ?? '');
    const regimeFactor = regime == null ? undefined : marketRecoveryRelease.regimeFactors?.[regime];
    const releaseFactor = regimeFactor ?? marketRecoveryRelease.factor;
    if (roc5Ok && roc20Ok && vixOk && regimeOk && releaseFactor != null) {
      factor = Math.max(factor, Math.min(1, Math.max(0, releaseFactor)));
    }
  }

  const pre = budget.final_tqqq_pct;
  const adjusted = Math.max(0, pre * factor);
  const freed = Math.max(0, pre - adjusted);
  if (freed <= 0) {
    if (recoveryCapApplied) {
      return {
        engineId: 'DrawdownGovernor',
        status: 'WARN',
        data: { triggered: true, reason: 'recovery_target_cap', nav, peakNav, drawdownPct, factor, matchedDdPct, preGovernorTqqqPct: pre },
        warnings: [`NAV回撤目标上限：距峰值 -${(drawdownPct * 100).toFixed(1)}% → TQQQ目标 ≤${(recoveryTargetCap!.maxTargetPct * 100).toFixed(1)}%`],
        blockers: [],
      };
    }
    return inert('already_flat', { nav, peakNav, drawdownPct, factor, matchedDdPct });
  }

  budget.pre_drawdown_governor_tqqq_pct = pre;
  budget.final_tqqq_pct = adjusted;
  budget.final_cash_pct += freed / 2;
  budget.final_boxx_pct += freed / 2;

  return {
    engineId: 'DrawdownGovernor',
    status: 'WARN',
    data: {
      triggered: true,
      reason: 'tier_matched',
      nav,
      peakNav,
      drawdownPct,
      factor,
      matchedDdPct,
      preGovernorTqqqPct: pre,
    },
    warnings: [
      `NAV 回撤治理：距峰值 -${(drawdownPct * 100).toFixed(1)}% → TQQQ 目标 ×${factor.toFixed(2)}（${(pre * 100).toFixed(1)}% → ${(adjusted * 100).toFixed(1)}%）`,
    ],
    blockers: [],
  };
}
