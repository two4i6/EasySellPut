import type { PipelineContext, EngineResult, TrendData } from '../types/pipeline';
import type { TrendSignal } from '../types/output';
import { calcEMA, calcLatestBarROC, calcADX, closes } from '../utils';

export function runTrendFollowing(ctx: PipelineContext): EngineResult<TrendData> {
  const { prices } = ctx.input;
  const warnings: string[] = [];
  const blockers: string[] = [];

  const idx = prices.QQQ.length - 1;
  const rolling = ctx.input.precomputedIndicators?.qqq;
  // ema*/adx are Wilder/EMA-recursive over the whole history (O(n) per plain call); `rolling`
  // (built once over the full backtest series) gives O(1) lookups here — see utils.ts.
  const qqqCloses = rolling ? undefined : closes(prices.QQQ);
  const ema20 = rolling ? rolling.emaAt(idx, 20) : calcEMA(qqqCloses!, 20);
  const ema50 = rolling ? rolling.emaAt(idx, 50) : calcEMA(qqqCloses!, 50);
  const ema200 = rolling ? rolling.emaAt(idx, 200) : calcEMA(qqqCloses!, 200);
  const roc20 = calcLatestBarROC(prices.QQQ, 20) ?? 0;
  const adx = rolling ? rolling.adxAt(idx, 14) : calcADX(prices.QQQ, 14);

  let score = 0;

  if (ema20 > ema50) score += 20;
  if (ema50 > ema200) score += 20;
  if (roc20 > 0) score += 15;
  if (roc20 > 0.05) score += 15;  // extra if >5%
  if (adx > 25) score += 15;
  if (adx > 40) score += 15;      // extra bonus for strong trend

  let signal: TrendSignal;
  if (score >= 85) signal = 'STRONG_BULL';
  else if (score >= 60) signal = 'BULL';
  else if (score >= 40) signal = 'NEUTRAL';
  else if (score >= 20) signal = 'BEAR';
  else signal = 'STRONG_BEAR';

  // Dual confirmation block: STRONG_BEAR + regime not BULL
  const regime = ctx.results.regime?.data.regime;
  if (signal === 'STRONG_BEAR' && regime !== 'BULL') {
    // Opt-in (softenStrongBearBlock): in recovery regimes the EMA structure can lag a turning
    // tape, so a stale STRONG_BEAR score would otherwise hard-block all re-entry. Downgrade to a
    // warning there (the STRONG_BEAR ×0.5 trend discount in RiskBudget still applies); keep the
    // hard block in BEAR/CRISIS where a confirmed downtrend warrants zero offensive exposure.
    const recoveryRegime =
      regime === 'SIDEWAYS' || regime === 'RANGE_BOUND' ||
      regime === 'RISK_ON_WEAKENING' || regime === 'RISK_ON_EXTENDED';
    const softenStrongBearBlock = ctx.stockPolicy?.value.overrides.softenStrongBearBlock
      ?? ctx.input.strategyParams?.softenStrongBearBlock
      ?? false;
    if (softenStrongBearBlock && recoveryRegime) {
      warnings.push(`趋势 STRONG_BEAR（score=${score}）但 Regime=${regime} 处于恢复区间，降级为折扣而非阻断（softenStrongBearBlock）`);
    } else {
      blockers.push(`趋势确认 STRONG_BEAR（score=${score}），当前 Regime=${regime ?? 'unknown'}，拒绝进攻型开仓`);
    }
  }

  if (adx < 20) {
    warnings.push(`ADX=${adx.toFixed(1)} < 20，当前无明显方向性趋势`);
  }

  const status = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'TrendFollowing',
    status,
    data: { signal, score, ema20, ema50, ema200, roc20, adx },
    warnings,
    blockers,
  };
}
