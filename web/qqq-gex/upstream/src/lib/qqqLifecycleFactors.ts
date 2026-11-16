import type { FactorMap } from '@/types/factor';
import { QQQ_PCS_VWAP_SCORE_MAX_PCT } from './engines/analysis/QqqPcsEntrySnapshot';

export type QqqLifecycleFactor = { label: string; value: string; passed: boolean | null };
export function snapshotQqqLifecycleFactors(strategy: 'PCS' | 'CS', factors: FactorMap): QqqLifecycleFactor[] {
  const value = (id: string) => {
    const factor = factors[id];
    return factor && factor.confidence > 0 && factor.source.type !== 'fallback' ? factor.value : null;
  };
  const tag = (label: string, id: string, check: (value: unknown) => boolean): QqqLifecycleFactor => {
    const raw = value(id);
    return { label, value: raw === null ? '未记录' : String(raw), passed: raw === null ? null : check(raw) };
  };
  if (strategy === 'CS') return [
    tag('报价有效', 'qqq_intraday_price', raw => typeof raw === 'number' && Number.isFinite(raw) && raw > 0),
    tag('实时数据', 'cs_intraday_data_ready', raw => raw === true),
    tag('VWAP 未追高', 'cs_intraday_vwap_ok', raw => raw === true),
    tag('日内高位', 'cs_intraday_range_ok', raw => raw === true),
    tag('RSI14', 'cs_intraday_rsi_ok', raw => raw === true),
  ];
  const price = value('qqq_intraday_price');
  const vwap = value('qqq_intraday_vwap');
  const extension = typeof price === 'number' && typeof vwap === 'number' && vwap > 0 ? (price / vwap - 1) * 100 : null;
  return [
    tag('实时数据', 'qqq_intraday_data_fresh', raw => raw === true),
    { label: 'VWAP 偏离', value: extension === null ? '未记录' : `${extension.toFixed(2)}%`, passed: extension === null ? null : extension <= QQQ_PCS_VWAP_SCORE_MAX_PCT },
    tag('2 分钟 RSI14', 'qqq_intraday_rsi_14', raw => typeof raw === 'number' && raw <= 65),
    tag('VXN 跳升过滤', 'vxn_change_1d', raw => typeof raw === 'number' && raw <= 5),
    tag('IV/HV 溢价', 'vol_premium', raw => typeof raw === 'number' && raw >= 1),
  ];
}
