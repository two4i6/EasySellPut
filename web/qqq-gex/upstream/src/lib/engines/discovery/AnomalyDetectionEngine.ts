import { FactorEngine } from '../../FactorEngine';
import { DiscoveryEvent, AtomicTrigger } from '../../../types/discovery';
import { FactorMap } from '../../../types/factor';

export interface AnomalyInput {
  symbol: string;
  data: FactorMap;
}

export class AnomalyDetectionEngine extends FactorEngine {
  /**
   * 异常检测算法 (Physical Anomaly Detection)
   * 
   * 1. IV 飙升检测: iv > hv * 1.4 || iv > 0.50
   * 2. 价格剧烈波动检测: priceChange < -2.5
   * 3. 极度超卖（均值回归机会）: rsi < 32
   */
  public detect(inputs: AnomalyInput[]): DiscoveryEvent[] {
    const events: DiscoveryEvent[] = [];

    inputs.forEach(({ symbol, data }) => {
      if (!data) return;

      const priceChange = (data.price_data?.value as any)?.changePercent ?? 0;
      const iv = (data.implied_volatility?.value as number) ?? 0;
      const rsi = (data.rsi?.value as number) ?? 50;
      const hv = (data.hv_20?.value as number) ?? 0;

      // 1. IV 飙升检测
      if (iv > hv * 1.4 || iv > 0.50) {
        events.push({
          eventId: `evt_${symbol.toLowerCase()}_iv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol,
          trigger: 'IV_SPIKE' as AtomicTrigger,
          observation: { value: Number((iv * 100).toFixed(1)), unit: '%' },
          timestamp: Date.now()
        });
        return; // 一个标的一轮扫描只返回一个最高优先级事件
      }

      // 2. 价格剧烈波动检测
      if (priceChange < -2.5) {
        events.push({
          eventId: `evt_${symbol.toLowerCase()}_price_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol,
          trigger: 'PRICE_DROP' as AtomicTrigger,
          observation: { value: priceChange, unit: '%' },
          timestamp: Date.now()
        });
        return;
      }

      // 3. 极度超卖（均值回归机会）
      if (rsi < 32) {
        events.push({
          eventId: `evt_${symbol.toLowerCase()}_rsi_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol,
          trigger: 'MEAN_REVERSION' as AtomicTrigger,
          observation: { value: Number(rsi.toFixed(1)), unit: 'RSI' },
          timestamp: Date.now()
        });
        return;
      }
    });

    return events;
  }
}

export const anomalyDetectionEngine = new AnomalyDetectionEngine();
