import type { PipelineContext, EngineResult, DataQualityData } from '../types/pipeline';

const MIN_QQQ_BARS = 200;
const MIN_TQQQ_BARS = 60;
const MAX_STALE_DAYS = 3;

export function runDataQualityGate(ctx: PipelineContext): EngineResult<DataQualityData> {
  const { prices, macro } = ctx.input;
  const missing: string[] = [];
  const fallbacks: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  const qqq_bars = prices.QQQ?.length ?? 0;
  const tqqq_bars = prices.TQQQ?.length ?? 0;

  if (qqq_bars < MIN_QQQ_BARS) {
    blockers.push(`QQQ 历史不足：需要 ${MIN_QQQ_BARS} 根，实际 ${qqq_bars} 根`);
  }
  if (tqqq_bars < MIN_TQQQ_BARS) {
    blockers.push(`TQQQ 历史不足：需要 ${MIN_TQQQ_BARS} 根，实际 ${tqqq_bars} 根`);
  }

  // Data freshness check
  const latestQQQ = prices.QQQ?.at(-1)?.date ?? '';
  if (latestQQQ) {
    const staleDays = (new Date(ctx.input.date).getTime() - new Date(latestQQQ).getTime()) / 86400000;
    if (staleDays > MAX_STALE_DAYS) {
      blockers.push(`QQQ 数据陈旧：最新日期 ${latestQQQ}，系统日期 ${ctx.input.date}，间隔 ${staleDays.toFixed(0)} 天`);
    }
  } else {
    blockers.push('QQQ 价格数组为空');
  }

  // NaN/zero check on last 5 bars
  for (const bar of (prices.QQQ ?? []).slice(-5)) {
    if (!bar.close || isNaN(bar.close) || bar.close <= 0) {
      blockers.push(`QQQ 价格数据异常：date=${bar.date}, close=${bar.close}`);
      break;
    }
  }
  for (const bar of (prices.TQQQ ?? []).slice(-5)) {
    if (!bar.close || isNaN(bar.close) || bar.close <= 0) {
      blockers.push(`TQQQ 价格数据异常：date=${bar.date}, close=${bar.close}`);
      break;
    }
  }

  // Integrate new data issues validator
  if (ctx.input.dataIssues && ctx.input.dataIssues.length > 0) {
    blockers.push(...ctx.input.dataIssues);
  }

  // Optional field warnings
  if (!prices.BOXX || prices.BOXX.length === 0) {
    missing.push('BOXX');
    fallbacks.push('BOXX 缺失，底仓将以 cash 比例估算');
    warnings.push('BOXX 价格数据缺失，降级使用 cash 计算');
  }
  if (!ctx.input.optionChains?.QQQ) {
    missing.push('optionChains.QQQ');
    warnings.push('QQQ 期权链缺失，Overlay Engine 将返回 NONE');
  }
  if (macro.vix == null) {
    missing.push('macro.vix');
    fallbacks.push('VIX 缺失，使用默认值 20 作为 fallback');
    warnings.push('VIX 缺失，使用默认值 20');
  }

  const status = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';

  return {
    engineId: 'DataQualityGate',
    status,
    data: {
      qqq_bars,
      tqqq_bars,
      latest_date: latestQQQ,
      missing_fields: missing,
      fallbacks_applied: fallbacks,
    },
    warnings,
    blockers,
  };
}
