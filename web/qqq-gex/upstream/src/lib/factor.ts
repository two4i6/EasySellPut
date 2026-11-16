import {
  FactorId,
  FactorMap,
  FinancialFactor,
  DerivedSource,
  FactorValueById,
  KnownFactorId,
} from "../types/factor";

// ─── Pipeline Debug Utility ─────────────────────────────────────────────────
// Set DEBUG_PIPELINE=1 in env to enable verbose execution trace.
const _DP = typeof process !== 'undefined' && process.env.DEBUG_PIPELINE === '1';
function _dbg(tag: string, ...args: unknown[]) {
  if (_DP) console.log(`[${tag}]`, ...args);
}
// ────────────────────────────────────────────────────────────────────────────

export type IVState = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
export type VolPremiumState = 'RICH' | 'NORMAL' | 'CHEAP';

export type FactorFallbackFactory<K extends KnownFactorId> = (
  factorId: K,
) => FactorValueById[K];

export const DEFAULT_REQUIRED_FACTOR_IDS = [
  'underlying_price',
  'iv_rank',
  'vol_premium',
  'vix_term_ratio',
  'real_risk',
] as const satisfies readonly KnownFactorId[];

export function isFinancialFactor(value: unknown): value is FinancialFactor<unknown> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FinancialFactor<unknown>>;
  if (!('value' in candidate) || typeof candidate.confidence !== 'number') return false;
  const source = candidate.source as { type?: unknown } | undefined;
  return !!source && (
    source.type === 'raw' ||
    source.type === 'derived' ||
    source.type === 'manual' ||
    source.type === 'fallback'
  );
}

export function getFactorValue<K extends KnownFactorId>(
  factors: FactorMap,
  factorId: K,
): FactorValueById[K] | undefined;
export function getFactorValue<T = unknown>(
  factors: FactorMap,
  factorId: string,
): T | undefined;
export function getFactorValue<T = unknown>(
  factors: FactorMap,
  factorId: string,
): T | undefined {
  const factor = factors[factorId];
  return isFinancialFactor(factor) ? factor.value as T : undefined;
}

export function requireFactor<K extends KnownFactorId>(
  factors: FactorMap,
  factorId: K,
): FinancialFactor<FactorValueById[K]>;
export function requireFactor<T = unknown>(
  factors: FactorMap,
  factorId: string,
): FinancialFactor<T>;
export function requireFactor<T = unknown>(
  factors: FactorMap,
  factorId: string,
): FinancialFactor<T> {
  const factor = factors[factorId];
  if (!isFinancialFactor(factor)) {
    throw new Error(`缺失因子: ${factorId}`);
  }
  return factor as FinancialFactor<T>;
}

export function fallbackFactor<T>(value: T, reason: string, logicReason?: string): FinancialFactor<T> {
  return { value, confidence: 0, source: { type: 'fallback', reason }, logicReason };
}

/** 原始市场输入必须先通过有效性校验，不能以 raw 形式传播无效值。 */
export function createRawFactor<T>(
  value: T,
  validate: (value: T) => boolean,
  api: string,
  logicReason?: string,
  fallbackValue: T = value,
): FinancialFactor<T> {
  return validate(value)
    ? { value, confidence: 10, source: { type: 'raw', api }, logicReason }
    : fallbackFactor(fallbackValue, `${api} 返回无效原始数据`, logicReason);
}

function defaultRequiredFallback<K extends KnownFactorId>(factorId: K): FactorValueById[K] {
  const values: Partial<FactorValueById> = {
    underlying_price: 0,
    iv_rank: 50,
    vol_premium: 1,
    vix_term_ratio: 1,
    real_risk: 100,
  };
  if (!(factorId in values)) {
    throw new Error(`缺少 ${factorId} 的标准 fallback 值`);
  }
  return values[factorId] as FactorValueById[K];
}

export function assertRequiredFactors(
  factors: FactorMap,
  requiredFactorIds: readonly string[],
): void {
  const invalid = requiredFactorIds.filter((factorId) => !isFinancialFactor(factors[factorId]));
  if (invalid.length > 0) {
    throw new Error(`缺失必需因子: ${invalid.join(', ')}`);
  }
}

export function normalizeRequiredFactors<K extends KnownFactorId = typeof DEFAULT_REQUIRED_FACTOR_IDS[number]>(
  factors: FactorMap,
  requiredFactorIds?: readonly K[],
  createFallbackValue: FactorFallbackFactory<K> = defaultRequiredFallback as FactorFallbackFactory<K>,
): FactorMap {
  const normalized: FactorMap = { ...factors };
  const required = requiredFactorIds ?? (DEFAULT_REQUIRED_FACTOR_IDS as unknown as readonly K[]);
  const missing = required.filter((factorId) => !isFinancialFactor(normalized[factorId]));

  if (missing.length === 0) return normalized;

  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`缺失必需因子: ${missing.join(', ')}`);
  }

  for (const factorId of missing) {
    normalized[factorId as string] = fallbackFactor(
      createFallbackValue(factorId),
      `生产环境响应契约补齐缺失因子: ${factorId}`,
    );
  }

  return normalized;
}

/**
 * 校验 inputs 权重之和是否为 1.0
 */
export function validateWeights(inputs: DerivedSource["inputs"]): void {
  const total = inputs.reduce((sum, i) => sum + i.weight, 0);
  if (Math.abs(total - 1.0) > 1e-9) {
    throw new Error(`inputs weight 之和必须为 1.0，当前为 ${total}`);
  }
}

/**
 * 计算派生因子置信度 (原则 II.2 & II.3)
 * 规则：confidence = min(inputs.confidence) * 衰减系数 (0.9)
 * 任何 input confidence 为 0，则结果必须为 0
 */
export function calcConfidence(inputs: DerivedSource["inputs"], factors: FactorMap): number {
  if (inputs.length === 0) return 0;

  let minConf = 10;
  let missingAny = false;
  let bottleneckId = '';

  _dbg('CALC_CONFIDENCE', 'inputs:', inputs.map(i => i.factorId).join(', '));

  for (const i of inputs) {
    const inputFactor = factors[i.factorId];
    if (!inputFactor) {
      missingAny = true;
      minConf = 0;
      _dbg('ERROR', `calcConfidence: factor "${i.factorId}" is MISSING from FactorMap → confidence forced to 0`);
      break;
    }
    _dbg('CHECK', `  ${i.factorId} → conf=${inputFactor.confidence.toFixed(2)}, source=${JSON.stringify(inputFactor.source)}`);
    if (inputFactor.confidence === 0) {
      _dbg('WARN', `  ${i.factorId} has confidence=0 → this will zero out the derived factor`);
    }
    if (inputFactor.confidence < minConf) {
      minConf = inputFactor.confidence;
      bottleneckId = i.factorId;
    }
  }

  if (minConf === 0) {
    _dbg('ERROR', `calcConfidence result=0 (bottleneck: ${bottleneckId || 'missing factor'})`);
    return 0;
  }

  const decayed = minConf * 0.9;
  const result = missingAny ? Math.min(decayed, 3) : decayed;
  _dbg('CONFIDENCE', `calcConfidence: min="${bottleneckId}"=${minConf.toFixed(2)} → *0.9 → ${result.toFixed(2)}${missingAny ? ' [capped at 3: missing inputs]' : ''}`);
  return result;
}

/**
 * 数据有效性校验函数
 */
export const isValidPrice = (v: number) => typeof v === 'number' && v > 0;
export const isValidVix = (v: number) => typeof v === 'number' && v > 5 && v < 150;
export const isValidRate = (v: number) => typeof v === 'number' && v >= 0 && v < 30;
export const isValidRSI = (v: number) => typeof v === 'number' && v > 0 && v <= 100;
export const isValidMA = (v: number) => typeof v === 'number' && v > 0;
export const isValidATR = (v: number) => typeof v === 'number' && v > 0;
export const isValidROC = (v: number) => typeof v === 'number';
export const isValidPriceSeries = (value: unknown): value is Array<{ date: string; close: number }> =>
  Array.isArray(value) && value.length > 0 && value.every(
    (bar) => !!bar && typeof bar === 'object' && typeof bar.date === 'string' && isValidPrice(bar.close),
  );

/**
 * 创建派生因子，确保 weight 校验和 confidence 计算始终执行
 */
export function createDerivedFactor<T>(
  value: T,
  inputs: DerivedSource["inputs"],
  factors: FactorMap,
): FinancialFactor<T> {
  validateWeights(inputs);
  return {
    value,
    confidence: calcConfidence(inputs, factors),
    source: { type: "derived", inputs },
  };
}

/**
 * 统计 FactorMap 中关键因子的置信度
 * 返回低置信度因子占比、关键决策因子中 proxy (confidence < 7) 的数量
 */
export function auditConfidence(
  factors: FactorMap,
  criticalFactorIds: string[]
): {
  lowConfidenceCount: number;
  totalCount: number;
  lowConfidenceRatio: number;
  lowConfidenceFactors: string[];
} {
  _dbg('STAGE', 'auditConfidence');
  _dbg('INPUT', 'criticalFactorIds:', criticalFactorIds.join(', '));

  const criticals = criticalFactorIds.filter(id => factors[id]);
  const missing = criticalFactorIds.filter(id => !factors[id]);

  if (missing.length > 0) {
    _dbg('ERROR', `auditConfidence: factors MISSING from map → ${missing.join(', ')}`);
    _dbg('WARN', 'Missing factors will be treated as confidence=0 in avgConfidence calculation');
  }

  _dbg('CHECK', 'Per-factor confidence audit:');
  criticals.forEach(id => {
    const conf = factors[id]?.confidence ?? 0;
    const src = JSON.stringify(factors[id]?.source);
    const level = conf < 4 ? '[CRITICAL <4]' : conf < 7 ? '[LOW <7]' : '[OK]';
    _dbg('CHECK', `  ${id}: conf=${conf.toFixed(2)} ${level} source=${src}`);
  });

  const lowConfidence = criticals.filter(id => (factors[id]?.confidence ?? 0) < 7);
  const criticallyLow = criticals.filter(id => (factors[id]?.confidence ?? 0) < 4);

  if (criticallyLow.length > 0) {
    _dbg('ERROR', `auditConfidence: factors with conf<4 (will trigger CONFIDENCE_GATE): ${criticallyLow.join(', ')}`);
  }

  const result = {
    lowConfidenceCount: lowConfidence.length,
    totalCount: criticals.length,
    lowConfidenceRatio: criticals.length > 0 ? lowConfidence.length / criticals.length : 0,
    lowConfidenceFactors: lowConfidence,
  };

  _dbg('OUTPUT', `audit result: lowCount=${result.lowConfidenceCount}/${result.totalCount} ratio=${result.lowConfidenceRatio.toFixed(2)} lowFactors=[${result.lowConfidenceFactors.join(', ')}]`);
  return result;
}
