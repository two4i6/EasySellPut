import type { PipelineContext, EngineResult, ConflictData } from '../types/pipeline';

export function runConflictResolver(ctx: PipelineContext): EngineResult<ConflictData> {
  const { results } = ctx;
  const conflicts: ConflictData['conflicts'] = [];
  const warnings: string[] = [];

  // Conflict 1: Trend=BULL but Regime=BEAR/SIDEWAYS
  const trend = results.trend?.data.signal;
  const regime = results.regime?.data.regime;
  if ((trend === 'BULL' || trend === 'STRONG_BULL') && (regime === 'BEAR' || regime === 'SIDEWAYS')) {
    conflicts.push({
      field: 'market_direction',
      engine_a: 'TrendFollowing',
      value_a: trend,
      engine_b: 'MarketRegime',
      value_b: regime,
      resolution: `以 Regime(${regime}) 为主，降低进攻性`,
    });
    warnings.push(`趋势信号(${trend})与市场机制(${regime})矛盾，保守处理`);
  }

  // Conflict 2: VolTarget and RiskBudget diverge significantly
  const volWeight = results.volTarget?.data.regime_adjusted_weight ?? 0;
  const budgetWeight = results.riskBudget?.data.final_tqqq_pct ?? 0;
  if (Math.abs(volWeight - budgetWeight) > 0.10) {
    conflicts.push({
      field: 'tqqq_allocation',
      engine_a: 'VolatilityTarget',
      value_a: `${(volWeight * 100).toFixed(1)}%`,
      engine_b: 'RiskBudget',
      value_b: `${(budgetWeight * 100).toFixed(1)}%`,
      resolution: `采用 RiskBudget 保守值 ${(budgetWeight * 100).toFixed(1)}%`,
    });
    warnings.push(`VolTarget(${(volWeight * 100).toFixed(1)}%) 与 RiskBudget(${(budgetWeight * 100).toFixed(1)}%) 差异超 10%`);
  }

  // Conflict 3: VIX spike not reflected in regime
  const vix = ctx.input.macro.vix;
  if (vix != null && vix > 30 && (regime === 'BULL' || regime === 'RISK_ON_EXTENDED' || regime === 'RISK_ON_WEAKENING')) {
    conflicts.push({
      field: 'volatility_regime',
      engine_a: 'MarketRegime',
      value_a: 'BULL',
      engine_b: 'VIX',
      value_b: `VIX=${vix.toFixed(1)}`,
      resolution: '忽略 BULL 信号，进入 WARN 状态，限制加仓',
    });
    warnings.push(`Regime=BULL 但 VIX=${vix.toFixed(1)} > 30，潜在风险高估`);
  }

  const status = warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'ConflictResolver',
    status,
    data: {
      conflicts,
      any_conflict: conflicts.length > 0,
    },
    warnings,
    blockers: [],
  };
}
