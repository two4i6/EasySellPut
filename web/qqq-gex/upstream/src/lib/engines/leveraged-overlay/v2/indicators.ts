import { createDerivedFactor, createRawFactor, fallbackFactor } from '../../../factor';
import type { FactorMap, FinancialFactor } from '../../../../types/factor';
import type { OHLCV } from '../types/input';
import { calc20dRange, calcROC, calcRealizedVol, type RollingIndicators } from '../utils';

export type OverlayIndicatorId =
  | 'qqq_price' | 'tqqq_price' | 'vix' | 'vix3m'
  | 'qqq_history' | 'tqqq_history'
  | 'qqq_roc5' | 'qqq_roc20' | 'tqqq_roc20' | 'qqq_range5' | 'qqq_range20' | 'qqq_drawdown5' | 'qqq_drawdown20' | 'qqq_close_high5' | 'qqq_close_high20' | 'qqq_close_high60' | 'qqq_close_drawdown5' | 'qqq_close_drawdown20' | 'qqq_rv20' | 'vix_backwardation';

export type OverlayIndicatorInput = {
  qqqBars: readonly OHLCV[];
  tqqqBars: readonly OHLCV[];
  signalSymbol?: string;
  leveragedSymbol?: string;
  primaryVolatility?: 'VIX' | 'VXN';
  vix?: number;
  vix3m?: number;
  /** Batch-only immutable market cache; live callers omit it and keep the old formulas. */
  precomputed?: { qqq?: RollingIndicators; tqqq?: RollingIndicators };
};

const validBars = (bars: readonly OHLCV[]) => bars.length > 0 && bars.every((bar) => Number.isFinite(bar.close) && bar.close > 0 && Number.isFinite(bar.high) && Number.isFinite(bar.low));
const validVix = (value: number | undefined): value is number => typeof value === 'number' && value > 5 && value < 150;

/** 单个决策日独占；不得跨回测、arm 或请求复用。 */
export class OverlayIndicatorCatalog {
  readonly factors: FactorMap = {};

  constructor(private readonly input: OverlayIndicatorInput) {}

  prewarm(ids: readonly OverlayIndicatorId[]): void {
    ids.forEach((id) => this.require(id));
  }

  require<T>(id: OverlayIndicatorId): FinancialFactor<T> {
    const existing = this.factors[id];
    if (existing) return existing as FinancialFactor<T>;
    const factor = this.create(id);
    this.factors[id] = factor;
    return factor as FinancialFactor<T>;
  }

  private create(id: OverlayIndicatorId): FinancialFactor<unknown> {
    const signalSymbol = this.input.signalSymbol ?? 'QQQ';
    const leveragedSymbol = this.input.leveragedSymbol ?? 'TQQQ';
    const volatilitySymbol = this.input.primaryVolatility ?? 'VIX';
    const qqqHistory = () => createRawFactor(this.input.qqqBars, this.input.precomputed?.qqq ? () => this.input.precomputed!.qqq!.historyValidAt(this.input.qqqBars.length - 1) : validBars, 'overlay-market-data', `${signalSymbol} 历史行情`);
    const tqqqHistory = () => createRawFactor(this.input.tqqqBars, this.input.precomputed?.tqqq ? () => this.input.precomputed!.tqqq!.historyValidAt(this.input.tqqqBars.length - 1) : validBars, 'overlay-market-data', `${leveragedSymbol} 历史行情`);
    const price = (bars: readonly OHLCV[], symbol: string) => createRawFactor(bars.at(-1)?.close ?? 0, (value) => value > 0, 'overlay-market-data', `${symbol} 收盘价`);
    const vix = (value: number | undefined, name: string) => createRawFactor(value ?? 0, validVix, 'overlay-market-data', name);
    if (id === 'qqq_history') return qqqHistory();
    if (id === 'tqqq_history') return tqqqHistory();
    if (id === 'qqq_price') return price(this.input.qqqBars, signalSymbol);
    if (id === 'tqqq_price') return price(this.input.tqqqBars, leveragedSymbol);
    if (id === 'vix') return vix(this.input.vix, volatilitySymbol);
    if (id === 'vix3m') return vix(this.input.vix3m, 'VIX3M');

    if (id === 'vix_backwardation') {
      const current = this.require<number>('vix');
      const deferred = this.require<number>('vix3m');
      if (current.confidence === 0 || deferred.confidence === 0) return fallbackFactor(false, 'VIX 或 VIX3M 缺失，无法派生期限结构');
      return createDerivedFactor(current.value > deferred.value, [{ factorId: 'vix', weight: 0.5 }, { factorId: 'vix3m', weight: 0.5 }], this.factors);
    }

    const historyId = id === 'tqqq_roc20' ? 'tqqq_history' : 'qqq_history';
    const history = this.require<readonly OHLCV[]>(historyId);
    const rolling = historyId === 'tqqq_history' ? this.input.precomputed?.tqqq : this.input.precomputed?.qqq;
    const index = history.value.length - 1;
    const period = id === 'qqq_roc5' || id === 'qqq_drawdown5' || id === 'qqq_close_high5' || id === 'qqq_close_drawdown5'
      ? 5
      : id === 'qqq_close_high60' ? 60 : 20;
    const permitsPartialHistory = id === 'qqq_close_high5' || id === 'qqq_close_high20' || id === 'qqq_close_high60';
    if (history.confidence === 0 || (!permitsPartialHistory && history.value.length <= period)) return fallbackFactor(0, `${historyId} 历史不足 ${period + 1} 根`);
    let closeValues: number[] | undefined;
    const closes = () => closeValues ??= history.value.map((bar) => bar.close);
    if (id === 'qqq_roc5' || id === 'qqq_roc20' || id === 'tqqq_roc20') {
      return createDerivedFactor(rolling?.rocAt(index, period) ?? calcROC(closes(), period), [{ factorId: historyId, weight: 1 }], this.factors);
    }
    if (id === 'qqq_range20') return createDerivedFactor(rolling?.rangeAt(index, 20) ?? calc20dRange(history.value as OHLCV[]), [{ factorId: historyId, weight: 1 }], this.factors);
    if (id === 'qqq_range5') {
      const range = index + 1 >= 5 ? rolling?.rangeAt(index, 5) : undefined;
      if (range) return createDerivedFactor(range, [{ factorId: historyId, weight: 1 }], this.factors);
      const bars = (history.value as OHLCV[]).slice(-5);
      const high = Math.max(...bars.map(bar => bar.high));
      const low = Math.min(...bars.map(bar => bar.low));
      return createDerivedFactor({ pct: (high - low) / ((high + low) / 2), high, low }, [{ factorId: historyId, weight: 1 }], this.factors);
    }
    if (id === 'qqq_rv20') return createDerivedFactor(rolling?.realizedVolAt(index, 20) ?? calcRealizedVol(closes(), 20), [{ factorId: historyId, weight: 1 }], this.factors);
    if (id === 'qqq_close_high5' || id === 'qqq_close_high20' || id === 'qqq_close_high60') return createDerivedFactor(rolling?.closeHighAt(index, period) ?? Math.max(...closes().slice(-period)), [{ factorId: historyId, weight: 1 }], this.factors);
    if (id === 'qqq_close_drawdown5' || id === 'qqq_close_drawdown20') {
      const high = this.require<number>(id === 'qqq_close_drawdown5' ? 'qqq_close_high5' : 'qqq_close_high20');
      if (high.confidence === 0) return fallbackFactor(0, 'QQQ 收盘高点无效，无法派生回撤');
      return createDerivedFactor(Math.max(0, (high.value - history.value.at(-1)!.close) / high.value), [{ factorId: id === 'qqq_close_drawdown5' ? 'qqq_close_high5' : 'qqq_close_high20', weight: 0.5 }, { factorId: historyId, weight: 0.5 }], this.factors);
    }
    const range = this.require<{ high: number }>(id === 'qqq_drawdown5' ? 'qqq_range5' : 'qqq_range20');
    const current = this.require<number>('qqq_price');
    if (range.confidence === 0 || current.confidence === 0 || range.value.high <= 0) return fallbackFactor(0, 'QQQ 区间或价格无效，无法派生回撤');
    return createDerivedFactor(Math.max(0, (range.value.high - current.value) / range.value.high), [{ factorId: 'qqq_range20', weight: 0.5 }, { factorId: 'qqq_price', weight: 0.5 }], this.factors);
  }
}
