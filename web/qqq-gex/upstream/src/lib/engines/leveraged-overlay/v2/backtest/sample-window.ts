import type { MarketDataSet } from './fixtures';
import type { ResolvedBacktestRunSpec } from './run-spec';
import { getOverlayUniverse } from '../../universe';

/** Resolve a data-relative request against a complete snapshot, keeping all warm-up history. */
export function resolveSampleWindow(spec: ResolvedBacktestRunSpec, data: MarketDataSet): ResolvedBacktestRunSpec {
  const params = spec.dataParams;
  if (!params) return spec;
  if (!Number.isSafeInteger(params.sampleCount) || params.sampleCount < 1) {
    throw new Error('dataParams.sampleCount 必须是正整数');
  }
  if (!Number.isSafeInteger(spec.config.minBarHistory) || (spec.config.minBarHistory ?? 0) < 0) {
    throw new Error('config.minBarHistory 必须是非负整数');
  }
  if (params.asOfDate !== undefined && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(params.asOfDate)) {
    throw new Error('dataParams.asOfDate 必须是 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm');
  }
  if (params.asOfDate !== undefined) {
    const day = params.asOfDate.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00Z`);
    const hour = params.asOfDate.length > 10 ? Number(params.asOfDate.slice(11, 13)) : 0;
    const minute = params.asOfDate.length > 10 ? Number(params.asOfDate.slice(14, 16)) : 0;
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day || hour > 23 || minute > 59) {
      throw new Error('dataParams.asOfDate 不是有效的日历时间');
    }
  }
  if (spec.resolvedDataWindow) {
    if (spec.resolvedDataWindow.dataFingerprint !== data.fingerprint) throw new Error('样本窗口的数据指纹与当前快照不一致');
    if (spec.config.startDate !== spec.resolvedDataWindow.startDate || spec.config.endDate !== spec.resolvedDataWindow.endDate
      || params.sampleCount !== spec.resolvedDataWindow.sampleCount) throw new Error('已解析样本窗口与回测参数不一致');
    return spec;
  }
  if (spec.config.startDate !== undefined || spec.config.endDate !== undefined) {
    throw new Error('dataParams.sampleCount 不能与 config.startDate/endDate 同时使用');
  }
  const universe = getOverlayUniverse(spec.universeId);
  const signalSymbol = spec.signalSymbol ?? universe.signalSymbol;
  const signalBars = data.barsBySymbol?.[signalSymbol] ?? (signalSymbol === 'SPY' ? data.spyBars : data.qqqBars) ?? data.qqqBars;
  const leveragedBars = data.barsBySymbol?.[universe.leveragedSymbol] ?? data.tqqqBars;
  const minBarHistory = spec.config.minBarHistory ?? 200;
  const lastExecutableIndex = signalBars.length - (spec.config.includeTerminalMarkOnly ? 1 : 2);
  let endIndex = lastExecutableIndex;
  if (params.asOfDate) {
    const cutoff = spec.config.timeframe !== '1d' && params.asOfDate.length === 10 ? `${params.asOfDate}T23:59` : params.asOfDate;
    while (endIndex >= minBarHistory && signalBars[endIndex]!.date > cutoff) endIndex--;
  }
  const startIndex = endIndex - params.sampleCount + 1;
  if (startIndex < minBarHistory) {
    throw new Error(`样本历史不足：请求 ${params.sampleCount} 根，预热 ${minBarHistory} 根后仅有 ${Math.max(0, endIndex - minBarHistory + 1)} 根`);
  }
  const selected = signalBars.slice(startIndex, endIndex + 1);
  const leveragedDates = new Set(leveragedBars.map(bar => bar.date));
  const missingLeveraged = selected.filter(bar => !leveragedDates.has(bar.date)).map(bar => bar.date);
  const riskVol = spec.config.riskVolIndex === 'VXN' && Object.keys(data.vxnByDate).length > 0 ? data.vxnByDate : data.vixByDate;
  const missingRiskVol = selected.filter(bar => riskVol[bar.date] === undefined && riskVol[bar.date.slice(0, 10)] === undefined).map(bar => bar.date);
  if (missingLeveraged.length || missingRiskVol.length) {
    throw new Error(`样本数据缺口：${universe.leveragedSymbol} ${missingLeveraged.slice(0, 3).join(',') || '无'}；风控波动率 ${missingRiskVol.slice(0, 3).join(',') || '无'}`);
  }
  const startDate = selected[0]!.date;
  const endDate = selected.at(-1)!.date;
  return {
    ...spec,
    config: { ...spec.config, startDate, endDate },
    resolvedDataWindow: { sampleCount: params.sampleCount, startDate, endDate, dataFingerprint: data.fingerprint },
  };
}
