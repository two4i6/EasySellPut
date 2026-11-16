import { FactorMap, FinancialFactor } from '../../../types/factor';
import { OptionChain, OptionContract } from '../pricing/OptionChainEngine';
import { PreTradeGate } from '../gates/PreTradeGate';
import { ivSuitabilityEngine } from '../analysis/IVSuitabilityEngine';
import { unifiedRegimeEngine } from '../regime/UnifiedRegimeEngine';
import { getExpiryBestCSPStrikes, CSPStrikeResult, getAllCSPStrikes } from '../../findBestCSPStrike';
import { DEFAULT_CSP_SETTINGS } from '../../../store/useCSPStore';
import { TECHNICAL } from '../shared/constants';
import type { OptionQuoteSource } from '../../optionQuote';
import { getFactorValue as getFV, requireFactor, isFinancialFactor } from '../../factor';

// ---- RecommendationParams ----
const RecommendationParams = {
  OVERSHOOT_BUFFER_BULL: 0.015, // 牛市允许 1.5% 的价格突破（追涨动能）
  OVERSHOOT_BUFFER_NORMAL: 0.005, // 正常环境仅允许 0.5%
  ENTRY_SCORE: {
    OPTIMAL: 65,
    ACCEPTABLE_BULL: 25,
    ACCEPTABLE_NORMAL: 40,
    EXTREME_BULL: 20,
    EXTREME_NORMAL: 30,
    STRONG_NORMAL: 30
  },
  TARGET_IV_RANK: {
    DEFAULT: 50,
    EXTREME: 35,
    STRONG: 45
  },
  REAL_RISK_SAFE: 60
};

// 卖方机会卡以 5 日生存率和短期日内信号为核心：有合格短期期权时，不让远期合约跨期胜出。
// 短期链完全不可用时才回退到全期限，避免把临时链缺口误报成“无候选”。
const PREFERRED_CSP_DTE_RANGE = { min: 3, max: 14, label: '3-14' };
const ALL_CSP_DTE_RANGE = { min: 0, max: 365, label: 'All' };

// ---- Math Helpers ----
function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function lerp(start: number, end: number, amt: number): number {
  return (1 - amt) * start + amt * end;
}

// 输入
export interface CSPRecommendationInput {
  factors: FactorMap;
  chain: OptionChain;
  lowerBound: number;         // 30D 全局基线（fallback）
  currentPrice: number;
  matrixRows?: Array<{ days: number; lower: number; effectiveLower?: number }>; // per-DTE effectiveLower
  timestamps?: Record<string, number>;
  enablePanicIntervention?: boolean; // 恐慌干预机制开关
  userSettings?: Partial<import('../../../store/useCSPStore').CSPSettings>; // 用户自定义设置
  targetStrike?: number;      // 用户手动指定的行权价
  targetExpiry?: string;      // 用户手动指定的到期日
}

// 输出 action
export type CSPAction = 'SELL_PUT' | 'ROLL' | 'CLOSE' | 'FORCE_EXIT' | 'WAIT';

// 推荐的单个合约
export interface CSPStrikeRecommendation {
  strike: number;
  delta: number;
  mid: number | null;
  premiumPrice: number;
  breakeven: number;
  bid: number | null;
  ask: number | null;
  lastPrice?: number | null;
  quoteSource: OptionQuoteSource;
  quoteAsOf: number | null;
  quoteHaircut: number;
  iv: number;
  theta: number;
  openInterest: number;
  apr: number;              // (mid / (strike - mid)) * (365 / dte) * 100
  distancePct: number;      // (currentPrice - strike) / currentPrice * 100
  expiry: string;
  dte: number;
  winProb?: number;
  expectedReturn?: number;
  cvar?: number;            // 每股条件尾部损失（美元）
  vrp?: number;
  conditionalLoss?: number; // Condition Loss ES
  xi?: number;              // Vol-of-vol
  rho?: number;             // Skew-vol correlation
  svAdjFactor?: number;     // Tail risk adjustment factor
  rawScore?: number;        // Underlying raw score
  edgeScore?: number;       // Final edge score
  volume?: number;          // Contract volume
  breakdown?: {
    rar: number;
    deltaPreference: number;
    strikeBonus: number;
    reliability: number;
  };
}

// 完整推荐输出
export interface CSPRecommendation {
  action: CSPAction;
  blocked: boolean;
  hard_gates: string[];     // PreTradeGate 触发的门槛
  iv_level: 'RICH' | 'FAIR' | 'CHEAP';
  iv_score: number;         // 0–100
  kc_lower: number;         // Keltner Channel 下轨
  kc_upper: number;         // Keltner Channel 上轨
  kc_position: number;      // 价格在通道中的相对位置 0=下轨 1=上轨
  entry_score: number;      // 入场时机评分 0–100，100=最优（价格处于下轨）
  strike_recommendation: CSPStrikeRecommendation | null;  // 始终尝试推荐，即使是 WAIT
  champ_math_optimal: CSPStrikeRecommendation | null;      // 纯数学最优冠军合约（不受安全边界限制）
  perExpiryRecommendations: Record<string, CSPStrikeResult>; // 受边界限制的所有有效到期日推荐
  perExpiryMathOptimal: Record<string, CSPStrikeResult>;      // 不受边界限制的所有到期日数学最优解
  risk_warnings: string[];  // 条件不满足时的风险警告（始终推荐，但标记风险）
  reasoning: string[];      // 人类可读的理由列表
  confidence: number;       // 0–10
  data_quality: 'high' | 'medium' | 'low';
}

// Legacy types for compatibility
export type OptionsStrategyType = 
  | 'PUT_SPREAD' | 'CALL_SPREAD' | 'IRON_CONDOR' | 'CASH_SECURED_PUT' | 'WAIT'
  | 'PutCreditSpread' | 'CallCreditSpread' | 'IronCondor' | 'CashSecuredPut';

export interface StrategyRecommendation {
  strategy: OptionsStrategyType;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string[];
  confidence: number;
  positionSize: number;
  dte_target?: number;
}

export class RecommendationEngine {
  /**
   * 计算肯特纳通道 (Keltner Channels) 上下轨
   */
  private computeKCBand(factors: FactorMap, direction: 'lower' | 'upper'): { value: number; confidence: number } {
    const key = direction === 'lower' ? 'kc_lower' : 'kc_upper';
    const factor = factors[key];
    if (isFinancialFactor(factor) && factor.confidence > 0) {
      return { value: factor.value as number, confidence: factor.confidence };
    }

    // 回退逻辑：手动根据 MA20 和 ATR 计算
    const ma20 = getFV<number>(factors, 'ma20') || getFV<number>(factors, 'ma30');
    const atr = getFV<number>(factors, 'atr');

    if (ma20 && atr) {
      const val = direction === 'lower' ? ma20 - TECHNICAL.KC_MULTIPLIER * atr : ma20 + TECHNICAL.KC_MULTIPLIER * atr;
      const conf = Math.min(factors.ma20?.confidence ?? 10, factors.atr?.confidence ?? 10);
      return { value: val, confidence: conf };
    }

    return { value: 0, confidence: 0 };
  }

  private mapStrikeResultToRec(foundTarget: CSPStrikeResult): CSPStrikeRecommendation {
    return {
      strike: foundTarget.strike,
      delta: foundTarget.delta ?? 0,
      mid: foundTarget.mid,
      premiumPrice: foundTarget.premiumPrice,
      breakeven: foundTarget.breakeven,
      bid: foundTarget.bid,
      ask: foundTarget.ask,
      lastPrice: foundTarget.lastPrice,
      quoteSource: foundTarget.quoteSource,
      quoteAsOf: foundTarget.quoteAsOf,
      quoteHaircut: foundTarget.quoteHaircut,
      iv: foundTarget.iv,
      theta: foundTarget.theta ?? 0,
      openInterest: foundTarget.openInterest ?? 0,
      apr: foundTarget.apr ?? 0,
      distancePct: foundTarget.distancePct ?? 0,
      expiry: foundTarget.expiry,
      dte: foundTarget.dte,
      winProb: foundTarget.winProb,
      expectedReturn: foundTarget.expectedReturn,
      cvar: foundTarget.cvar,
      vrp: foundTarget.vrp,
      conditionalLoss: foundTarget.conditionalLoss,
      xi: foundTarget.xi,
      rho: foundTarget.rho,
      svAdjFactor: foundTarget.svAdjFactor,
      rawScore: foundTarget.rawScore,
      edgeScore: foundTarget.netScore,
      volume: foundTarget.volume,
      breakdown: foundTarget.breakdown,
    };
  }

  private buildEarlyReturn(
    action: CSPAction,
    reasoning: string[],
    ivOpportunity: { level: 'RICH' | 'FAIR' | 'CHEAP'; score: number; confidence: number },
    kc: { value: number; confidence: number },
    kcUpper: { value: number; confidence: number },
    dataQuality: 'high' | 'medium' | 'low',
    riskWarnings: string[] = []
  ): CSPRecommendation {
    return {
      action,
      blocked: false,
      hard_gates: [],
      iv_level: ivOpportunity.level,
      iv_score: ivOpportunity.score,
      kc_lower: kc.value,
      kc_upper: kcUpper.value,
      kc_position: 0.5,
      entry_score: 0,
      strike_recommendation: null,
      champ_math_optimal: null,
      perExpiryRecommendations: {},
      perExpiryMathOptimal: {},
      risk_warnings: riskWarnings,
      reasoning,
      confidence: Math.min(ivOpportunity.confidence, kc.confidence),
      data_quality: dataQuality
    };
  }

  public recommend(input: CSPRecommendationInput): CSPRecommendation {
    const { 
      factors, 
      chain, 
      lowerBound, 
      currentPrice, 
      matrixRows = [], 
      timestamps = {}, 
      enablePanicIntervention = true, 
      userSettings = {},
      targetStrike,
      targetExpiry
    } = input;
    const reasoning: string[] = [];

    // Step 0: PreTradeGate — 硬门槛
    const gateResult = PreTradeGate.evaluate(factors, chain, timestamps);
    if (gateResult.blocked) {
      return {
        action: 'WAIT',
        blocked: true,
        hard_gates: gateResult.hard_gates,
        iv_level: 'FAIR',
        iv_score: 0,
        kc_lower: 0,
        kc_upper: 0,
        kc_position: 0.5,
        entry_score: 0,
        strike_recommendation: null,
        champ_math_optimal: null,
        perExpiryRecommendations: {},
        perExpiryMathOptimal: {},
        risk_warnings: [`数据门槛未通过: ${gateResult.hard_gates.join(', ')}`],
        reasoning: ['数据质量不足，无法生成推荐'],
        confidence: 0,
        data_quality: gateResult.data_quality
      };
    }

    // Step 1: IV 评估
    const ivOpportunity = ivSuitabilityEngine.analyze(factors);
    if (ivOpportunity.level === 'CHEAP') {
      reasoning.push("IV过低，权利金回报不足");
    }

    // Step 2: KC 通道
    const kc = this.computeKCBand(factors, 'lower');
    const kcUpper = this.computeKCBand(factors, 'upper');
    if (kc.confidence === 0) {
      reasoning.push("技术数据不足 (KC/MA20/ATR)");
    }

    // Step 3: 持仓管理检查
    const currentStrike = getFV<number>(factors, 'current_strike');
    const dte = getFV<number>(factors, 'dte') ?? 999;
    const profitProgress = getFV<number>(factors, 'profit_progress') ?? 0;

    if (currentStrike) {
      if (dte <= 5) {
        return this.buildEarlyReturn(
          'FORCE_EXIT',
          ["到期临近（DTE ≤ 5），强制平仓"],
          ivOpportunity,
          kc,
          kcUpper,
          gateResult.data_quality
        );
      }
      if (profitProgress >= 0.5) {
        return this.buildEarlyReturn(
          'CLOSE',
          ["已达 50% 止盈目标，建议平仓"],
          ivOpportunity,
          kc,
          kcUpper,
          gateResult.data_quality
        );
      }
      if (currentPrice <= currentStrike * 1.02) {
        return this.buildEarlyReturn(
          'ROLL',
          ["价格逼近行权价（≤ Strike × 1.02），建议展期"],
          ivOpportunity,
          kc,
          kcUpper,
          gateResult.data_quality
        );
      }
    }

    // Step 4: 入场时机评分（连续评分取代二元判断）
    const kcLower = kc.value;
    const kcUpperVal = kcUpper.value;
    const kcRange = kcUpperVal - kcLower;
    
    // 获取市场环境与恐慌状态
    const regime = unifiedRegimeEngine.getRegime(factors).value.regime;
    const isBull = regime === 'BULL' || regime === 'SIDEWAYS_STRONG';
    const panicLevel = getFV<string>(factors, 'panic_level') || 'NONE';

    let kc_position: number;
    let entry_score: number;
    if (kcRange > 0 && currentPrice > 0) {
      kc_position = (currentPrice - kcLower) / kcRange; // 0=下轨 1=上轨
      
      if (isBull && kc_position > 1.0) {
        // 牛市超买软着陆：1.0处给35分，1.2处给0分（线性插值）
        const amt = clamp((kc_position - 1.0) / 0.2, 0, 1);
        entry_score = Math.round(lerp(35, 0, amt));
      } else {
        entry_score = Math.max(0, Math.min(100, Math.round((1 - kc_position) * 100)));
      }
    } else {
      kc_position = 0.5;
      entry_score = 50;
    }

    // ── 动态门槛与风险调整 (Dynamic Panic Intervention) ──────────────────
    let acceptableThreshold = isBull ? RecommendationParams.ENTRY_SCORE.ACCEPTABLE_BULL : RecommendationParams.ENTRY_SCORE.ACCEPTABLE_NORMAL;
    let targetIvRank = RecommendationParams.TARGET_IV_RANK.DEFAULT;
    let lambdaMultiplier = 1.0;

    if (enablePanicIntervention) {
      if (panicLevel === 'EXTREME') {
        acceptableThreshold = isBull ? RecommendationParams.ENTRY_SCORE.EXTREME_BULL : RecommendationParams.ENTRY_SCORE.EXTREME_NORMAL;
        targetIvRank = RecommendationParams.TARGET_IV_RANK.EXTREME;
        lambdaMultiplier = 0.75;
      } else if (panicLevel === 'STRONG') {
        acceptableThreshold = RecommendationParams.ENTRY_SCORE.STRONG_NORMAL;
        targetIvRank = RecommendationParams.TARGET_IV_RANK.STRONG;
        lambdaMultiplier = 0.90;
      } else if (panicLevel === 'WEAK') {
        lambdaMultiplier = 1.15;
      }
    }

    const isEntryOptimal     = entry_score >= RecommendationParams.ENTRY_SCORE.OPTIMAL;
    const isEntryAcceptable  = entry_score >= acceptableThreshold;
    
    // 超买判定：牛市中允许更大的宽限，追涨动能更强
    const overshootBuffer    = isBull ? RecommendationParams.OVERSHOOT_BUFFER_BULL : RecommendationParams.OVERSHOOT_BUFFER_NORMAL;
    const isOverbought       = kcUpperVal > 0 && currentPrice > kcUpperVal * (1 + overshootBuffer);
    
    const ivRank = getFV<number>(factors, 'iv_rank');
    const isIVHigh = 
      (ivOpportunity.score >= 50 && ivOpportunity.level !== 'CHEAP') || 
      (enablePanicIntervention && ivRank != null && ivRank >= targetIvRank && ivOpportunity.level !== 'CHEAP');
      
    const realRisk           = getFV<number>(factors, 'real_risk') ?? 100;
    const isRiskSafe         = realRisk < RecommendationParams.REAL_RISK_SAFE;

    // 目标入场区（下轨 +3% 缓冲）
    const targetEntry = kcLower > 0 ? kcLower * 1.03 : 0;

    const risk_warnings: string[] = [];
    let action: CSPAction = 'WAIT';

    if (!currentStrike) {
      if (isEntryAcceptable && isIVHigh && isRiskSafe) {
        action = 'SELL_PUT';
        if (isEntryOptimal) {
          reasoning.push("三项条件均满足，最优入场时机");
        } else {
          reasoning.push("价格处于通道中段，条件基本满足，可小仓参考");
        }
      } else {
        // 生成可执行的风险警告
        if (isOverbought && kcUpperVal > 0) {
          const overshootPct = ((currentPrice - kcUpperVal) / kcUpperVal * 100).toFixed(1);
          risk_warnings.push(`当前 $${currentPrice.toFixed(1)} 突破 KC 上轨 $${kcUpperVal.toFixed(1)}（超出 +${overshootPct}%），等待回调`);
        } else if (!isEntryAcceptable && kcLower > 0) {
          const devPct = ((currentPrice - kcLower) / kcLower * 100).toFixed(1);
          risk_warnings.push(`当前 $${currentPrice.toFixed(1)} · KC下轨 $${kcLower.toFixed(1)} · 偏离 +${devPct}%`);
        } else if (!isEntryOptimal && kcLower > 0) {
          const devPct = ((currentPrice - kcLower) / kcLower * 100).toFixed(1);
          risk_warnings.push(`通道中段，距 KC 下轨 $${kcLower.toFixed(1)} 偏离 +${devPct}%，等待回调`);
        }
        if (!isIVHigh) {
          risk_warnings.push(`IV Rank ${ivRank != null ? ivRank.toFixed(0) : '--'} · 目标 ≥ ${targetIvRank} · 等待权利金扩张`);
        }
        if (!isRiskSafe) {
          risk_warnings.push(`Real Risk ${realRisk.toFixed(0)} · 阈值 ${RecommendationParams.REAL_RISK_SAFE} · 超出 +${(realRisk - RecommendationParams.REAL_RISK_SAFE).toFixed(0)} 点`);
        }
        action = 'WAIT';
        const met: string[] = [];
        const pending: string[] = [];
        if (isEntryAcceptable) met.push('入场时机'); else pending.push(targetEntry > 0 ? `价格回调至 $${targetEntry.toFixed(1)}` : '价格回调');
        if (isIVHigh) met.push('权利金'); else pending.push(`IV 扩张 ≥ ${targetIvRank}`);
        if (isRiskSafe) met.push('风险可控'); else pending.push(`风险降至 <${RecommendationParams.REAL_RISK_SAFE}（当前 ${realRisk.toFixed(0)}）`);
        const metStr = met.length > 0 ? `${met.join('、')}已就绪` : '无条件就绪';
        reasoning.push(`${metStr}；待：${pending.join('、')}`);
      }
    }

    // Step 5: Strike 选择
    let strikeRec: CSPStrikeRecommendation | null = null;
    let champ_math_optimal: CSPStrikeRecommendation | null = null;
    let perExpiryRecommendations: Record<string, CSPStrikeResult> = {};
    let perExpiryMathOptimal: Record<string, CSPStrikeResult> = {};
    const validExpirations = chain.expirations?.filter(e => e.options && e.options.length > 0) ?? [];

    if (validExpirations.length > 0) {
      // 构造 points 数组
      const points = validExpirations.map(exp => {
        const dte = exp.dte;
        const puts = (exp.options ?? []).filter(o => (o as any).type === 'Put').map(o => ({
          strike: o.strike,
          bid: o.bid,
          ask: o.ask,
          mid: o.mid,
          lastPrice: o.lastPrice,
          lastTradeDate: o.lastTradeDate,
          iv: o.iv,
          delta: (o as any).delta,
          theta: (o as any).theta,
          openInterest: (o as any).openInterest,
          inTheMoney: o.strike >= currentPrice
        }));
        return {
          daysToExpiration: dte,
          expiration: (exp as any).expiryDate ?? (exp as any).expiry ?? '',
          atmIV: (exp as any).atmIV ?? 0,
          contracts: { puts, calls: [] }
        };
      }) as any;

      const maxStrikeMap: Record<number, number> = {};
      for (const exp of validExpirations) {
        const matrixRow = matrixRows.length > 0
          ? matrixRows.reduce((prev, curr) => Math.abs(curr.days - exp.dte) < Math.abs(prev.days - exp.dte) ? curr : prev)
          : null;
        maxStrikeMap[exp.dte] = matrixRow ? (matrixRow.effectiveLower ?? matrixRow.lower) : lowerBound;
      }

      // 融合用户自定义设置
      const customSettings = {
        ...DEFAULT_CSP_SETTINGS,
        ...Object.fromEntries(Object.entries(userSettings).filter(([, value]) => value !== undefined)),
        lossAversion: (userSettings.lossAversion ?? DEFAULT_CSP_SETTINGS.lossAversion) * lambdaMultiplier,
        enablePanicIntervention
      };

      // 1. 获取受边界限制的所有到期日最佳推荐
      perExpiryRecommendations = getExpiryBestCSPStrikes(
        points,
        currentPrice,
        {
          dteRange: PREFERRED_CSP_DTE_RANGE,
          maxStrikeMap,
          globalLower: lowerBound,
        },
        getFV<number>(factors, 'hv_30') ?? 0,
        customSettings
      );
      if (Object.keys(perExpiryRecommendations).length === 0) {
        perExpiryRecommendations = getExpiryBestCSPStrikes(
          points,
          currentPrice,
          { dteRange: ALL_CSP_DTE_RANGE, maxStrikeMap, globalLower: lowerBound },
          getFV<number>(factors, 'hv_30') ?? 0,
          customSettings
        );
      }

      // 2. 获取不受边界限制的所有到期日数学最优解 (Math Optimal)
      perExpiryMathOptimal = getExpiryBestCSPStrikes(
        points,
        currentPrice,
        {
          dteRange: ALL_CSP_DTE_RANGE
          // 不传 maxStrikeMap 即为无边界限制
        },
        getFV<number>(factors, 'hv_30') ?? 0,
        customSettings
      );

      // 3. 决策优先权：如果有手动指定的 targetStrike 和 targetExpiry，优先分析并返回它
      if (targetStrike && targetExpiry) {
        const targetExp = validExpirations.find(e => (e as any).expiryDate === targetExpiry || (e as any).expiry === targetExpiry);
        if (targetExp) {
          const allStrikes = getAllCSPStrikes(points, { min: targetExp.dte, max: targetExp.dte, label: 'Target' }, currentPrice, getFV<number>(factors, 'hv_30') ?? 0, customSettings);
          const foundTarget = allStrikes[0]?.strikes.find(s => Math.abs(s.strike - targetStrike) < 0.01);
          
          if (foundTarget) {
            strikeRec = this.mapStrikeResultToRec(foundTarget);
          }
        }
      }

      // 4. 如果没有手动指定或没找到，则从 perExpiryRecommendations 中选择全局冠军
      if (!strikeRec) {
        let bestGlobal: CSPStrikeResult | null = null;
        for (const k in perExpiryRecommendations) {
          if (!bestGlobal || perExpiryRecommendations[k].netScore > bestGlobal.netScore) {
            bestGlobal = perExpiryRecommendations[k];
          }
        }

        if (bestGlobal) {
          strikeRec = this.mapStrikeResultToRec(bestGlobal);
        }
      }

      // 5. 选择数学最优冠军 (Math Optimal Champ)
      let bestMathGlobal: CSPStrikeResult | null = null;
      for (const k in perExpiryMathOptimal) {
        if (!bestMathGlobal || perExpiryMathOptimal[k].netScore > bestMathGlobal.netScore) {
          bestMathGlobal = perExpiryMathOptimal[k];
        }
      }
      if (bestMathGlobal) {
        champ_math_optimal = this.mapStrikeResultToRec(bestMathGlobal);
      }
    }

    if (strikeRec?.quoteSource === 'last_trade') {
      const quoteTime = strikeRec.quoteAsOf ? new Date(strikeRec.quoteAsOf * 1000).toISOString() : '时间未知';
      risk_warnings.push(`最后成交价代理（${quoteTime}，买卖各加 5% 保守折扣），非实时盘口`);
    }

    return {
      action,
      blocked: false,
      hard_gates: [],
      iv_level: ivOpportunity.level,
      iv_score: ivOpportunity.score,
      kc_lower: kcLower,
      kc_upper: kcUpperVal,
      kc_position,
      entry_score,
      strike_recommendation: strikeRec,
      champ_math_optimal,
      perExpiryRecommendations,
      perExpiryMathOptimal,
      risk_warnings,
      reasoning,
      confidence: Math.min(ivOpportunity.confidence, kc.confidence, factors.underlying_price?.confidence ?? 0),
      data_quality: gateResult.data_quality
    };
  }
}

export const recommendationEngine = new RecommendationEngine();
