// 2026-07-22 研究模块（未采纳，禁止进入生产 preset 默认）：TQQQ 闪崩提前预警仓位治理。
// 结构完全模仿 06a-drawdown-governor.ts：读取 riskBudget.final_tqqq_pct，命中时乘以 factor，
// 释放的仓位平分给 cash/boxx。触发条件来自 ctx.currentTailRiskState.active（由
// crisis-state-machine.ts:updateTailRiskState 维护，纯日历/交易日倒计时解除，不做交易计数）。
import type { EngineResult, PipelineContext, TailRiskGovernorData } from '../types/pipeline';

export function runTailRiskGovernor(ctx: PipelineContext): EngineResult<TailRiskGovernorData> {
  const config = ctx.input.strategyParams?.tailRiskOverride;
  const budget = ctx.results.riskBudget?.data;
  const state = ctx.currentTailRiskState;

  const inert = (reason: string): EngineResult<TailRiskGovernorData> => ({
    engineId: 'TailRiskGovernor',
    status: 'PASS',
    data: {
      triggered: false,
      reason,
      factor: 1,
      preTailRiskTqqqPct: budget?.final_tqqq_pct,
      tailRiskActive: state?.active === true,
      tailRiskCooldownBars: state?.cooldownBars,
      tailRiskTriggerDate: state?.triggerDate,
    },
    warnings: [],
    blockers: [],
  });

  if (!config) return inert('disabled');
  if (!budget) return inert('no_budget');
  if (!state?.active) return inert('not_active');

  // 仅本地回测可传逐日乘数，支持已冻结的多状态仓位研究；live/API 不会提供它。
  // 无逐日值时保持既有 config.multiplier 的逐位行为。
  const configuredFactor = ctx.input.tailRiskMultiplier ?? config.multiplier;
  const factor = Math.max(0, Math.min(1, configuredFactor));
  const pre = budget.final_tqqq_pct;
  const adjusted = Math.max(0, pre * factor);
  const freed = Math.max(0, pre - adjusted);
  if (freed <= 0) return inert('already_within_cap');

  budget.final_tqqq_pct = adjusted;
  budget.final_cash_pct += freed / 2;
  budget.final_boxx_pct += freed / 2;

  return {
    engineId: 'TailRiskGovernor',
    status: 'WARN',
    data: {
      triggered: true,
      reason: 'tail_risk_active',
      factor,
      preTailRiskTqqqPct: pre,
      tailRiskActive: true,
      tailRiskCooldownBars: state.cooldownBars,
      tailRiskTriggerDate: state.triggerDate,
    },
    warnings: [
      `Tail-risk 早期预警：TQQQ 目标 ×${factor.toFixed(2)}（${(pre * 100).toFixed(1)}% → ${(adjusted * 100).toFixed(1)}%），触发日 ${state.triggerDate ?? '?'}，剩余 ${state.cooldownBars} 个交易日解除`,
    ],
    blockers: [],
  };
}
