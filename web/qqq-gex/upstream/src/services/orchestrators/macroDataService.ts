/**
 * 卖方期权决策系统 - 核心逻辑引擎
 */

import { indicatorEngine, decisionEngine, UnifiedRegime, unifiedRegimeEngine, hmmRegimeEngine } from '../../lib/engines';
import { FactorMap, FinancialFactor } from '../../types/factor';
import { createDerivedFactor, fallbackFactor, isValidPrice, isValidVix, isValidRate, isValidMA, isValidATR, IVState, VolPremiumState } from '../../lib/factor';
import { type HistoricalData as MarketHistoricalData } from '../adapters/marketDataService';
import { 
  MacroDecisionSystem, 
  MacroDecisionValue, 
  MacroRecommendationValue, 
  MacroData, 
  HistoricalData as MacroHistoricalData,
  FeatureInternalValues
} from '../../types/macro';

export type { MacroData, FeatureInternalValues, MacroDecisionSystem, MacroDecisionValue, MacroRecommendationValue };
export type HistoricalData = MacroHistoricalData;

export interface FetchMacroDataOptions {
  includeOptionsIV?: boolean;
}

import { apiManager } from '../adapters/apiManager';
import { fetchHistoricalDataCore, getOptionChainsWithin60Days, YahooFinanceResponse } from '../adapters/yahooFinance';

// ─── Pipeline Debug Utility ─────────────────────────────────────────────────
const _DP = typeof process !== 'undefined' && process.env.DEBUG_PIPELINE === '1';
function _dbg(tag: string, ...args: unknown[]) {
  if (_DP) console.log(`[${tag}]`, ...args);
}
// ────────────────────────────────────────────────────────────────────────────

export class MacroDataService {
  private createFallbackFactor<T>(value: T, reason: string): FinancialFactor<T> {
    return fallbackFactor(value, reason);
  }

  private calculateProxyRank(current: number, history: number[]): number {
    if (history.length === 0) return 50;
    const min = Math.min(...history);
    const max = Math.max(...history);
    if (max === min) return 50;
    const rank = ((current - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, rank));
  }

  private calculateProxyPercentile(current: number, history: number[]): number {
    if (history.length === 0) return 50;
    const count = history.filter(v => v < current).length;
    return (count / history.length) * 100;
  }

  private buildFeatureFactors(
    spxCloses: number[],
    vixCloses: number[],
    spxHistoricalItems: MarketHistoricalData[],
    rawFactors: FactorMap
  ): { factors: FactorMap; internal: FeatureInternalValues } {
    _dbg('STAGE', 'buildFeatureFactors');
    _dbg('INPUT', `spxCloses.length=${spxCloses.length} vixCloses.length=${vixCloses.length} spxHistoricalItems.length=${spxHistoricalItems.length}`);

    if (spxHistoricalItems.length <= 14) {
      _dbg('ERROR', `spxHistoricalItems.length=${spxHistoricalItems.length} ≤ 14 → atr/atr_ratio/price_extension will NOT be computed → these factors remain UNDEFINED in FactorMap`);
    } else if (spxHistoricalItems.length < 74) {
      _dbg('WARN', `spxHistoricalItems.length=${spxHistoricalItems.length} < 74 → atr_mean_60 will use HARDCODED fallback (value=85, confidence=3) → atr_ratio.confidence will be capped at 3*0.9=2.7 → CONFIDENCE_GATE likely`);
    } else {
      _dbg('CHECK', `spxHistoricalItems.length=${spxHistoricalItems.length} ≥ 74 → atr_mean_60 computed from real data`);
    }

    const factors: FactorMap = { ...rawFactors };
    const vixPrice = (factors.vix_price?.value as number) || 20;
    const tnxPrice = (factors.tnx_price?.value as number) || 4.0;
    const irxPrice = (factors.irx_price?.value as number) || 4.5;
    const vix3mPrice = (factors.vix3m_price?.value as number) || 0;
    const spxPrice = (factors.underlying_price?.value as number) || 0;

    _dbg('INPUT', `vixPrice=${vixPrice} vix3mPrice=${vix3mPrice} spxPrice=${spxPrice} tnxPrice=${tnxPrice} irxPrice=${irxPrice}`);
    _dbg('CHECK', `vix_price: conf=${factors.vix_price?.confidence ?? 'MISSING'} source=${JSON.stringify(factors.vix_price?.source)}`);
    _dbg('CHECK', `vix3m_price: conf=${factors.vix3m_price?.confidence ?? 'MISSING'} source=${JSON.stringify(factors.vix3m_price?.source)}`);
    if ((factors.vix3m_price?.confidence ?? 0) < 10) {
      _dbg('WARN', `vix3m_price confidence=${factors.vix3m_price?.confidence} < 10 → iv_atm proxy will be degraded`);
    }

    let historicalVolatility = 0.15;
    let ma7 = 0;
    if (spxCloses.length > 0) {
      const priceFactor: FinancialFactor<number[]> = { value: spxCloses, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
      Object.assign(factors, indicatorEngine.calculateMovingAverages(priceFactor));
      Object.assign(factors, indicatorEngine.calculateRSIFactors(priceFactor));
      
      ma7 = factors.ma7?.value as number ?? 0;

      // 计算历史波动率 HV20
      const hv20 = indicatorEngine.calculateHV(priceFactor, 20);
      historicalVolatility = hv20 ?? 0;

      _dbg('CHECK', `hv20 raw value=${hv20} isValid=${hv20 !== null && Number.isFinite(hv20)}`);
      factors.hv20 = hv20 !== null && Number.isFinite(hv20) && hv20 >= 0
        ? createDerivedFactor(Math.round(historicalVolatility * 10000) / 10000, [{ factorId: 'spx_price', weight: 1.0 }], factors)
        : this.createFallbackFactor(0.15, 'HV20 计算无效');
      _dbg('OUTPUT', `hv20: value=${factors.hv20.value} conf=${factors.hv20.confidence} source=${JSON.stringify(factors.hv20.source)}`);
      if (factors.hv20.confidence === 0) _dbg('ERROR', 'hv20.confidence=0 → iv_atm proxy will propagate zero confidence');

      if (spxHistoricalItems.length > 14) {
        const historicalDataFactor: FinancialFactor<MarketHistoricalData[]> = {
          value: spxHistoricalItems,
          confidence: 10,
          source: { type: 'raw', api: 'Yahoo History' },
        };
        Object.assign(factors, indicatorEngine.calculateATRFactors(historicalDataFactor));
        _dbg('CHECK', `atr: value=${factors['atr']?.value ?? 'MISSING'} conf=${factors['atr']?.confidence ?? 'MISSING'} source=${JSON.stringify(factors['atr']?.source)}`);
        if (!factors['atr'] || factors['atr'].confidence === 0) {
          _dbg('ERROR', 'atr factor is MISSING or conf=0 → atr_ratio/price_extension will have confidence=0');
        }

        const atrMean60Value = spxHistoricalItems.length >= 74
          ? indicatorEngine.calculateATRMean60(historicalDataFactor)
          : 85;

        _dbg('STAGE', 'atr_mean_60 computation');
        if (spxHistoricalItems.length < 74) {
          _dbg('WARN', `spxHistoricalItems.length=${spxHistoricalItems.length} < 74 → atr_mean_60 FALLBACK: value=85 (hardcoded), confidence=3`);
          _dbg('ERROR', 'atr_mean_60.confidence=3 → atr_ratio.confidence will be capped at min(atr.conf,3)*0.9 ≤ 2.7 → BELOW GATE THRESHOLD of 4');
        }
        factors.atr_mean_60 = spxHistoricalItems.length >= 74
          ? createDerivedFactor(atrMean60Value, [{ factorId: 'atr', weight: 1.0 }], factors)
          : this.createFallbackFactor(atrMean60Value, '历史数据不足60天');
        _dbg('OUTPUT', `atr_mean_60: value=${factors.atr_mean_60.value} conf=${factors.atr_mean_60.confidence} source=${JSON.stringify(factors.atr_mean_60.source)}`);

        const atr14 = factors.atr?.value as number ?? 0;
        const atrMean60 = (factors.atr_mean_60?.value as number) || 85;

        _dbg('STAGE', 'atr_ratio computation');
        _dbg('INPUT', `atr14=${atr14} atrMean60=${atrMean60} ratio=${atr14 > 0 ? (atr14/atrMean60).toFixed(4) : 1}`);
        factors.atr_ratio = createDerivedFactor(
          Math.round((atr14 > 0 ? atr14 / atrMean60 : 1) * 100) / 100,
          [
            { factorId: 'atr', weight: 0.5 },
            { factorId: 'atr_mean_60', weight: 0.5 },
          ],
          factors,
        );
        _dbg('OUTPUT', `atr_ratio: value=${factors.atr_ratio.value} conf=${factors.atr_ratio.confidence.toFixed(2)}`);
        if (factors.atr_ratio.confidence < 4) {
          _dbg('ERROR', `atr_ratio.confidence=${factors.atr_ratio.confidence.toFixed(2)} < 4 → WILL trigger CONFIDENCE_GATE second condition`);
        } else if (factors.atr_ratio.confidence < 7) {
          _dbg('WARN', `atr_ratio.confidence=${factors.atr_ratio.confidence.toFixed(2)} < 7 → flagged as low-confidence in audit`);
        }

        factors.atr_ratio_prev = factors.atr_ratio;

        // price_extension
        _dbg('STAGE', 'price_extension computation');
        _dbg('INPUT', `spxPrice=${spxPrice} ma7=${ma7} atr14=${atr14} validPrice=${isValidPrice(spxPrice)} validMA=${isValidMA(ma7)} validATR=${isValidATR(atr14)}`);
        if (isValidPrice(spxPrice) && isValidMA(ma7) && isValidATR(atr14)) {
          factors.price_extension = createDerivedFactor(
            (spxPrice - ma7) / atr14,
            [
              { factorId: 'underlying_price', weight: 0.5 },
              { factorId: 'ma7', weight: 0.25 },
              { factorId: 'atr', weight: 0.25 },
            ],
            factors
          );
          _dbg('OUTPUT', `price_extension: value=${(factors.price_extension.value as number).toFixed(4)} conf=${factors.price_extension.confidence.toFixed(2)}`);
        } else {
          factors.price_extension = this.createFallbackFactor(0, '无法计算 price_extension');
          _dbg('WARN', `price_extension: FALLBACK used (value=0, conf=5) because validPrice=${isValidPrice(spxPrice)} validMA=${isValidMA(ma7)} validATR=${isValidATR(atr14)}`);
        }
      }

      // Price ROC 因子 - 增加有效性拦截 (原则 VI.1)
      if (spxCloses.length > 20) {
        const rocPriceFactor: FinancialFactor<number[]> = { value: spxCloses, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
        Object.assign(factors, indicatorEngine.calculateROCFactors(rocPriceFactor, [5, 10, 20]));

        if (spxCloses.length >= 40) {
          Object.assign(factors, indicatorEngine.calculateRSISlopeFactor(rocPriceFactor));
          Object.assign(factors, indicatorEngine.calculateMACDMomentumFactor(rocPriceFactor));
        } else {
          factors.rsi_slope = { value: 0, confidence: 0, source: { type: 'fallback' as const, reason: '数据不足' } };
          factors.macd_momentum_strength = { value: 0, confidence: 0, source: { type: 'fallback' as const, reason: '数据不足' } };
        }
      } else {
        factors.price_roc_5d = this.createFallbackFactor(0, '数据不足');
        factors.price_roc_20d = this.createFallbackFactor(0, '数据不足');
        factors.rsi_slope = { value: 0, confidence: 0, source: { type: 'fallback' as const, reason: '数据不足' } };
        factors.macd_momentum_strength = { value: 0, confidence: 0, source: { type: 'fallback' as const, reason: '数据不足' } };
      }
    }

    // 5. vix_term_ratio
    _dbg('STAGE', 'vix_term_ratio computation');
    _dbg('INPUT', `vixPrice=${vixPrice} vix3mPrice=${vix3mPrice} ratio=${vix3mPrice > 0 ? (vixPrice/vix3mPrice).toFixed(4) : '1.0 (vix3m=0 fallback)'}`);
    factors.vix_term_ratio = createDerivedFactor(
      vix3mPrice > 0 ? vixPrice / vix3mPrice : 1.0,
      [{ factorId: 'vix_price', weight: 0.5 }, { factorId: 'vix3m_price', weight: 0.5 }],
      factors
    );
    _dbg('OUTPUT', `vix_term_ratio: value=${factors.vix_term_ratio.value} conf=${factors.vix_term_ratio.confidence.toFixed(2)}`);
    {
      const vtr = factors.vix_term_ratio.value as number;
      if (vtr >= 1.0) {
        _dbg('WARN', `vix_term_ratio=${vtr.toFixed(4)} ≥ 1.0 → termStructureScore=0 in IVSuitabilityEngine (no opportunity points)`);
      }
      if (vtr > 1.05) {
        _dbg('ERROR', `vix_term_ratio=${vtr.toFixed(4)} > 1.05 → TERM_STRUCTURE_INVERTED blocker will activate in getVerdict`);
      }
    }

    // 6. trend_quality
    _dbg('STAGE', 'trend_quality computation');
    _dbg('WARN', 'trend_quality value is HARDCODED to 50 — it does not reflect actual trend direction');
    _dbg('INPUT', `atr_ratio.conf=${factors.atr_ratio?.confidence?.toFixed(2) ?? 'MISSING'} vix_term_ratio.conf=${factors.vix_term_ratio.confidence.toFixed(2)}`);
    factors.trend_quality = createDerivedFactor(
      50,
      [{ factorId: 'atr_ratio', weight: 0.5 }, { factorId: 'vix_term_ratio', weight: 0.5 }],
      factors
    );
    _dbg('OUTPUT', `trend_quality: value=${factors.trend_quality.value} conf=${factors.trend_quality.confidence.toFixed(2)}`);
    if (factors.trend_quality.confidence < 4) {
      _dbg('ERROR', `trend_quality.confidence=${factors.trend_quality.confidence.toFixed(2)} < 4 → will pull real_risk.confidence below gate threshold`);
    }

    // 7. macro_score
    factors.macro_score = createDerivedFactor(
      50,
      [{ factorId: 'yield_spread', weight: 0.5 }, { factorId: 'tnx_price', weight: 0.5 }],
      factors
    );

    // risk_score：基于 VIX 水平的简化风险评分（供 VerdictEngine 使用）
    const vixRiskScore = vixPrice > 40 ? 80 : vixPrice > 30 ? 65 : vixPrice > 25 ? 50 : vixPrice > 18 ? 30 : 10;
    factors.risk_score = createDerivedFactor(
      vixRiskScore,
      [{ factorId: 'vix_price', weight: 1.0 }],
      factors
    );

    return { factors, internal: { historicalVolatility, ivRank: 50, ivPercentile: 50, ivHvRatio: 1.0, yieldSpread: 0, vixTermRatio: 1.0 } };
  }

  public async fetchMacroData(specificSymbol?: string, { includeOptionsIV = true }: FetchMacroDataOptions = {}): Promise<MacroData> {
    const baseSymbols = ['^GSPC', '^VIX', '^VIX3M', '^TNX', '^IRX', 'CL=F', 'GC=F', 'DX-Y.NYB', 'SPY'];
    const fetchSymbols = specificSymbol ? [...baseSymbols, specificSymbol.toUpperCase()] : baseSymbols;
    
    const isServer = typeof window === 'undefined';
    let quoteResults: Record<string, FinancialFactor<YahooFinanceResponse>> = {};
    
    if (isServer) {
      const { yahooFinanceServer } = await import('../adapters/yahooFinanceServer');
      quoteResults = await yahooFinanceServer.getQuote(fetchSymbols);
    } else {
      const promises = fetchSymbols.map(async (s) => {
        const data = await apiManager.fetchYahooFinanceData(s);
        if (data) quoteResults[s] = data;
      });
      await Promise.all(promises);
    }

    _dbg('STAGE', 'RAW_DATA_INGESTION');
    const factors: FactorMap = {};

    // 基础因子 - 强制对象化
    const spxPrice = quoteResults['^GSPC']?.value?.price || 0;
    factors.spx_price = isValidPrice(spxPrice)
      ? { value: spxPrice, confidence: 10, source: { type: 'raw', api: 'Yahoo' } }
      : this.createFallbackFactor(0, '无效价格');
    factors.underlying_price = factors.spx_price;
    _dbg('CHECK', `spx_price: value=${spxPrice} conf=${factors.spx_price.confidence} isValid=${isValidPrice(spxPrice)}`);
    if (!isValidPrice(spxPrice)) _dbg('ERROR', 'spx_price invalid → underlying_price fallback conf=5 → ALL downstream price-derived factors degraded');

    const vixPrice = quoteResults['^VIX']?.value?.price || 0;
    factors.vix_price = isValidVix(vixPrice)
      ? { value: vixPrice, confidence: 10, source: { type: 'raw', api: 'Yahoo' } }
      : this.createFallbackFactor(20, '无效VIX');
    _dbg('CHECK', `vix_price: value=${vixPrice} conf=${factors.vix_price.confidence} isValid=${isValidVix(vixPrice)}`);
    if (!isValidVix(vixPrice)) _dbg('WARN', 'vix_price fallback (20) → risk_score hardcoded, iv_atm proxy degraded');

    const vix3mPrice = quoteResults['^VIX3M']?.value?.price || 0;
    factors.vix3m_price = isValidVix(vix3mPrice)
      ? { value: vix3mPrice, confidence: 10, source: { type: 'raw', api: 'Yahoo' } }
      : this.createFallbackFactor(22, '无效VIX3M');
    _dbg('CHECK', `vix3m_price: value=${vix3mPrice} conf=${factors.vix3m_price.confidence} isValid=${isValidVix(vix3mPrice)}`);
    if (!isValidVix(vix3mPrice)) _dbg('WARN', 'vix3m_price fallback (22, conf=5) → iv_atm proxy uses 3-factor formula with degraded vix3m → iv_atm.conf will be capped lower');
    _dbg('WARN', 'hv_30: NOT a named factor in this pipeline — only hv20 is computed. Any reference to hv_30 will be undefined.');
    _dbg('WARN', 'atm_bid_ask_spread: NEVER computed in macro pipeline → liquidity scoring is permanently disabled (hasLiquidity=false in DecisionEngine)');

    factors.tnx_price = { value: quoteResults['^TNX']?.value?.price || 4.0, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.irx_price = { value: quoteResults['^IRX']?.value?.price || 4.5, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.oil_price = { value: quoteResults['CL=F']?.value?.price || 80, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.gold_price = { value: quoteResults['GC=F']?.value?.price || 2000, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.dxy_price = { value: quoteResults['DX-Y.NYB']?.value?.price || 104, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };

    factors.yield_spread = createDerivedFactor(
      Math.round(((factors.tnx_price.value as number) - (factors.irx_price.value as number)) * 100) / 100,
      [{ factorId: 'tnx_price', weight: 0.5 }, { factorId: 'irx_price', weight: 0.5 }],
      factors
    );

    // 注入涨跌幅因子 (用于 MAGI 面板展示)
    factors.spx_change = { value: quoteResults['^GSPC']?.value?.changePercent || 0, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.vix_change = { value: quoteResults['^VIX']?.value?.changePercent || 0, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };
    factors.tnx_change = { value: quoteResults['^TNX']?.value?.changePercent || 0, confidence: 10, source: { type: 'raw', api: 'Yahoo' } };

    // 技术因子
    let parsedSPXHistory = { closes: [spxPrice], items: [] as MarketHistoricalData[] };
    let parsedVIXHistory = { closes: [vixPrice], items: [] as MarketHistoricalData[] };
    try {
      if (isServer) {
        const { yahooFinanceServer } = await import('../adapters/yahooFinanceServer');
        const [spxHist, vixHist] = await Promise.all([
          yahooFinanceServer.getHistorical('^GSPC', '1y'),
          yahooFinanceServer.getHistorical('^VIX', '1y')
        ]);
        if (spxHist && spxHist.value) parsedSPXHistory = this.parseHistoryPayload(spxHist.value);
        if (vixHist && vixHist.value) parsedVIXHistory = this.parseHistoryPayload(vixHist.value);
      }
    } catch (e) {
      console.warn('Failed to fetch history:', e);
    }

    const { factors: enrichedFactors } = this.buildFeatureFactors(parsedSPXHistory.closes, parsedVIXHistory.closes, parsedSPXHistory.items, factors);
    
    // --- HMM Regime Inference (Option A: Coexistence Layer) ---
    _dbg('STAGE', 'HMM_REGIME_INFERENCE');
    const hmmResult = hmmRegimeEngine.analyze(parsedSPXHistory.closes);
    enrichedFactors.hmm_regime = { 
      value: hmmResult, 
      confidence: 8, 
      source: { type: 'manual', description: 'Hidden Markov Model Regime Inference' } 
    };
    _dbg('OUTPUT', `hmm_regime: state=${hmmResult.state} p_bear=${hmmResult.p_bear.toFixed(4)} p_bull=${hmmResult.p_bull.toFixed(4)} logScore=${hmmResult.logScore.toFixed(4)}`);

    // --- 统一 IV 因子生成流 (原则 III.1) ---
    _dbg('STAGE', 'IV_FACTOR_PIPELINE');

    // 1. iv_atm (Real or Proxy)
    _dbg('STAGE', 'iv_atm acquisition');
    try {
      const { fetchATMIVCurve } = await import('../adapters/yahooFinance');
      const spyPrice = quoteResults['SPY']?.value?.price || 0;
      _dbg('INPUT', `SPY price=${spyPrice}`);
      const spyPriceFactor: FinancialFactor<number> = spyPrice > 0
        ? { value: spyPrice, confidence: 10, source: { type: 'raw', api: 'Yahoo' } }
        : this.createFallbackFactor(Number(enrichedFactors.spx_price.value) / 12.6, 'SPY quote unavailable, using SPX/12.6');
      if (spyPrice <= 0) _dbg('WARN', 'SPY price unavailable → using SPX/12.6 proxy as spyPrice (conf=5)');

      const ivCurve = includeOptionsIV
        ? await fetchATMIVCurve('SPY', spyPriceFactor, {
            minDTE: 14,
            maxDTE: 60,
            maxExpirations: 5,
            concurrency: 4,
          })
        : null;

      _dbg('CHECK', `ivCurve: source.type=${ivCurve?.source.type ?? 'skipped'} iv30=${ivCurve?.value?.iv30} confidence=${ivCurve?.confidence ?? 0}`);
      if (ivCurve?.source.type === 'raw' && ivCurve.value.iv30 >= 0.01) {
        enrichedFactors.iv_atm = {
          value: ivCurve.value.iv30,
          confidence: ivCurve.confidence,
          source: { type: 'raw', api: 'Yahoo Finance Options (IV30)' },
        };
        _dbg('OUTPUT', `iv_atm: SOURCE=REAL value=${ivCurve.value.iv30.toFixed(4)} conf=${ivCurve.confidence}`);
      } else {
        _dbg('WARN', `iv_atm real fetch FAILED or iv30 < 0.01 → switching to PROXY formula`);
        // 构造 iv_atm_proxy (原则 I)
        const hasVix3m = (enrichedFactors.vix3m_price?.confidence ?? 0) > 0;
        const vixVal = (Number(enrichedFactors.vix_price.value) || 20) / 100;
        const vix3mVal = (Number(enrichedFactors.vix3m_price?.value) || 22) / 100;
        const hv20Val = Number(enrichedFactors.hv20?.value) || 0.20;

        _dbg('INPUT', `proxy inputs: vixVal=${vixVal.toFixed(4)} vix3mVal=${vix3mVal.toFixed(4)} hv20Val=${hv20Val.toFixed(4)} hasVix3m=${hasVix3m}`);

        if (hasVix3m) {
          const proxyVal = 0.5 * vixVal + 0.2 * vix3mVal + 0.3 * hv20Val;
          enrichedFactors.iv_atm = createDerivedFactor(
            proxyVal,
            [
              { factorId: 'vix_price', weight: 0.5 },
              { factorId: 'vix3m_price', weight: 0.2 },
              { factorId: 'hv20', weight: 0.3 }
            ],
            enrichedFactors
          );
          const beforeCap = enrichedFactors.iv_atm.confidence;
          enrichedFactors.iv_atm.confidence = Math.min(enrichedFactors.iv_atm.confidence, 7.0);
          _dbg('OUTPUT', `iv_atm: SOURCE=PROXY(3-factor) value=${proxyVal.toFixed(4)} conf=${beforeCap.toFixed(2)}→capped at 7.0→${enrichedFactors.iv_atm.confidence.toFixed(2)}`);
        } else {
          const proxyVal = 0.7 * vixVal + 0.3 * hv20Val;
          enrichedFactors.iv_atm = createDerivedFactor(
            proxyVal,
            [
              { factorId: 'vix_price', weight: 0.7 },
              { factorId: 'hv20', weight: 0.3 }
            ],
            enrichedFactors
          );
          const beforeCap = enrichedFactors.iv_atm.confidence;
          enrichedFactors.iv_atm.confidence = Math.min(enrichedFactors.iv_atm.confidence, 6.5);
          _dbg('OUTPUT', `iv_atm: SOURCE=PROXY(2-factor, no vix3m) value=${proxyVal.toFixed(4)} conf=${beforeCap.toFixed(2)}→capped at 6.5→${enrichedFactors.iv_atm.confidence.toFixed(2)}`);
          _dbg('WARN', 'iv_atm proxy without VIX3M → confidence capped at 6.5 (lower quality)');
        }
      }
    } catch (e) {
      console.warn('iv_atm calculation failed, using legacy fallback:', e);
      enrichedFactors.iv_atm = this.createFallbackFactor(0.2, 'IV获取失败');
      _dbg('ERROR', `iv_atm EXCEPTION fallback: value=0.2 conf=5 error=${e}`);
    }

    // 2. iv_rank / iv_percentile (分层代理, 原则 II)
    _dbg('STAGE', 'iv_rank / iv_percentile computation');
    const historyLen = parsedVIXHistory.closes.length;
    const ivAtmRaw = Number(enrichedFactors.iv_atm?.value);
    const ivAtmVal = (isFinite(ivAtmRaw) && ivAtmRaw > 0)
      ? ivAtmRaw
      : (Number(enrichedFactors.vix_price?.value) || 20) / 100;

    _dbg('INPUT', `historyLen(VIX)=${historyLen} ivAtmRaw=${ivAtmRaw} ivAtmVal=${ivAtmVal.toFixed(4)}`);
    if (!isFinite(ivAtmRaw) || ivAtmRaw <= 0) {
      _dbg('WARN', `iv_atm value invalid (${ivAtmRaw}) → falling back to vix/100 for rank computation`);
    }

    if (historyLen >= 63) {
      const windowSize = historyLen >= 252 ? 252 : historyLen >= 126 ? 126 : 63;
      const historyWindow = parsedVIXHistory.closes.slice(-windowSize);

      // 基础 Cap: 252=8.0, 126=7.0, 63=6.0
      let confCap = windowSize === 252 ? 8.0 : windowSize === 126 ? 7.0 : 6.0;
      _dbg('CHECK', `VIX history window=${windowSize}d → base confCap=${confCap}`);

      const vixPriceNum = Number(enrichedFactors.vix_price?.value) || 20;
      const ivVixDiff = Math.abs(ivAtmVal * 100 - vixPriceNum);
      if (ivVixDiff < 1.0) { confCap += 1.5; _dbg('CHECK', `consistency boost +1.5 (|ivAtm*100-vix|=${ivVixDiff.toFixed(2)} < 1.0) → confCap=${confCap}`); }
      else if (ivVixDiff < 2.0) { confCap += 0.5; _dbg('CHECK', `consistency boost +0.5 (|ivAtm*100-vix|=${ivVixDiff.toFixed(2)} < 2.0) → confCap=${confCap}`); }
      else { _dbg('WARN', `no consistency boost (|ivAtm*100-vix|=${ivVixDiff.toFixed(2)} ≥ 2.0) → confCap stays ${confCap}`); }

      const rankVal = this.calculateProxyRank(ivAtmVal * 100, historyWindow);
      enrichedFactors.iv_rank = createDerivedFactor(
        rankVal,
        [{ factorId: 'iv_atm', weight: 0.8 }, { factorId: 'vix_price', weight: 0.2 }],
        enrichedFactors
      );
      const beforeCapRank = enrichedFactors.iv_rank.confidence;
      enrichedFactors.iv_rank.confidence = Math.min(enrichedFactors.iv_rank.confidence, confCap);
      _dbg('OUTPUT', `iv_rank: value=${rankVal.toFixed(2)} conf_before_cap=${beforeCapRank.toFixed(2)} conf_after_cap=${enrichedFactors.iv_rank.confidence.toFixed(2)}`);

      const pctVal = this.calculateProxyPercentile(ivAtmVal * 100, historyWindow);
      enrichedFactors.iv_percentile = createDerivedFactor(
        pctVal,
        [{ factorId: 'iv_atm', weight: 0.8 }, { factorId: 'vix_price', weight: 0.2 }],
        enrichedFactors
      );
      enrichedFactors.iv_percentile.confidence = Math.min(enrichedFactors.iv_percentile.confidence, confCap);
      _dbg('OUTPUT', `iv_percentile: value=${pctVal.toFixed(2)} conf=${enrichedFactors.iv_percentile.confidence.toFixed(2)}`);
    } else {
      _dbg('ERROR', `VIX historyLen=${historyLen} < 63 → iv_rank/iv_percentile FALLBACK: value=50, conf=5`);
      enrichedFactors.iv_rank = this.createFallbackFactor(50, 'VIX历史数据不足');
      enrichedFactors.iv_percentile = this.createFallbackFactor(50, 'VIX历史数据不足');
    }

    // 3. vol_premium & iv_hv_ratio & vol_premium_state
    _dbg('STAGE', 'vol_premium computation');
    const hv20Val = Number(enrichedFactors.hv20?.value) || 0.20;
    const volPremiumValue = hv20Val > 0 ? ivAtmVal / hv20Val : 1.0;
    _dbg('INPUT', `ivAtmVal=${ivAtmVal.toFixed(4)} hv20Val=${hv20Val.toFixed(4)} iv_atm.conf=${enrichedFactors.iv_atm?.confidence?.toFixed(2)} hv20.conf=${enrichedFactors.hv20?.confidence?.toFixed(2)}`);
    _dbg('CHECK', `volPremiumValue=${volPremiumValue.toFixed(4)} → ${volPremiumValue > 1.4 ? 'RICH(+50pts)' : volPremiumValue > 1.2 ? 'RICH(+35pts)' : volPremiumValue > 1.0 ? 'FAIR(+15pts)' : 'CHEAP(0pts)'}`);

    enrichedFactors.vol_premium = createDerivedFactor(
      Math.round(volPremiumValue * 100) / 100,
      [{ factorId: 'iv_atm', weight: 0.5 }, { factorId: 'hv20', weight: 0.5 }],
      enrichedFactors
    );
    _dbg('OUTPUT', `vol_premium: value=${enrichedFactors.vol_premium.value} conf=${enrichedFactors.vol_premium.confidence.toFixed(2)}`);
    if (enrichedFactors.vol_premium.confidence === 0) {
      _dbg('ERROR', 'vol_premium.confidence=0 → iv_hv_ratio.confidence=0 → opportunity.confidence=0 in DecisionEngine');
    }

    enrichedFactors.vol_premium_state = createDerivedFactor(
      (volPremiumValue > 1.2 ? 'RICH' : volPremiumValue >= 0.9 ? 'NORMAL' : 'CHEAP') as VolPremiumState,
      [{ factorId: 'vol_premium', weight: 1.0 }],
      enrichedFactors
    );

    enrichedFactors.iv_hv_ratio = enrichedFactors.vol_premium;
    _dbg('CHECK', `iv_hv_ratio aliased to vol_premium: conf=${enrichedFactors.iv_hv_ratio.confidence.toFixed(2)}`);

    // 最终回填
    const marketRegime = unifiedRegimeEngine.getRegime(enrichedFactors).value;
    enrichedFactors.regime_score = { value: marketRegime.score, confidence: 7, source: { type: 'manual', description: 'Regime Override' } };

    // 提取个股基本信息 (如果有 specificSymbol)
    let specificStock = undefined;
    if (specificSymbol && quoteResults[specificSymbol.toUpperCase()]) {
      const q = quoteResults[specificSymbol.toUpperCase()].value;
      const m = q.meta || {};
      specificStock = {
        symbol: specificSymbol.toUpperCase(),
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        open: m.regularMarketOpen ?? m.open ?? q.price,
        high: m.regularMarketDayHigh ?? m.high ?? q.price,
        low: m.regularMarketDayLow ?? m.low ?? q.price,
        volume: m.regularMarketVolume ?? m.volume ?? 0,
        timestamp: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : new Date().toISOString()
      };
    }

    return {
      status: 'real', confidence: 100, timestamp: new Date().toISOString(), factors: enrichedFactors,
      specificStock,
      marketState: quoteResults['^GSPC']?.value?.marketState || 'REGULAR',
      vix: { value: enrichedFactors.vix_price.value, termStructure: 'Contango', status: 'real' } as any,
      interestRates: { treasury_10y: { value: enrichedFactors.tnx_price.value } } as any,
      spxVolatility: {
        underlyingPrice: enrichedFactors.spx_price?.value,
        impliedVolatility: enrichedFactors.iv_atm?.value,
        historicalVolatility: enrichedFactors.hv20?.value,
        ivRank: enrichedFactors.iv_rank?.value,
        ivPercentile: enrichedFactors.iv_percentile?.value,
        ivHvRatio: enrichedFactors.iv_hv_ratio?.value,
        status: 'real',
      } as any,
      marketRegime: { regime: marketRegime.regime, score: marketRegime.score } as any
    } as MacroData;
  }

  private parseHistoryPayload(payload: any): { closes: number[], items: MarketHistoricalData[] } {
    const result = payload?.chart?.result?.[0];
    const quotes = result?.indicators?.quote?.[0] || {};
    const closes = (quotes.close || []).filter((c: any) => c !== null) as number[];
    const highs = (quotes.high || []) as number[];
    const lows = (quotes.low || []) as number[];
    const opens = (quotes.open || []) as number[];
    const volumes = (quotes.volume || []) as number[];
    const timestamps = (result?.timestamp || []) as number[];

    const items: MarketHistoricalData[] = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString(),
      open: opens[i] || 0,
      high: highs[i] || 0,
      low: lows[i] || 0,
      close: closes[i] || 0,
      volume: volumes[i] || 0
    })).filter(item => item.close > 0);

    return { closes, items };
  }

  public getDecisionSystem(data: MacroData): MacroDecisionSystem { return decisionEngine.getDecisionSystem(data.factors); }
  public getThreeModuleScores(data: MacroData) {
    return {
      marketRegime: { score: 50, level: 'neutral' },
      opportunityScore: { score: 50 },
      riskScore: { score: 50, level: 'low' }
    };
  }
}

export const macroDataService = new MacroDataService();
