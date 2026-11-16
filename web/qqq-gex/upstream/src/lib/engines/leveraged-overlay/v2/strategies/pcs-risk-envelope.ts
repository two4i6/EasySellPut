/**
 * PCS 候选4风险包络（研究模式）。
 *
 * 这里把候选4的两个有效 weakening 分支表达成数据，而不是彼此独立的 if。默认不消费；
 * 调用方必须显式打开研究模式，并继续检查候选是否真的可构建。
 */

export type PcsRiskEnvelopeBand = 'BLOCK' | 'HALF' | 'FULL';
export type PcsRiskEnvelopeProfile =
  | 'candidate4_v1'
  | 'candidate4_full_v1'
  | 'candidate4_full_only_v1'
  | 'candidate4_weakening_full_only_v1'
  | 'candidate4_merged_bull_strict_v1'
  | 'candidate4_merged_bull_broad_v1'
  | 'candidate4_weakening_only_v1';

export type PcsRiskEnvelopeInput = {
  regime?: string;
  slowSubregime?: string;
  vix?: number;
  rv20?: number;
  priceVsSma200Pct?: number;
  drawdownFromRecentHighPct?: number;
  adx14?: number;
  roc20?: number;
};

export type PcsRiskEnvelopeResult = {
  band: PcsRiskEnvelopeBand;
  multiplier: 0 | .5 | 1;
  fullMatches: string[];
  boundaryMatches: string[];
};

type NumericRange = {
  min?: number;
  max?: number;
  tolerance: number;
};

type PcsRiskEnvelopeBranch = {
  id: string;
  regimes: readonly string[];
  slowSubregimes?: readonly string[];
  vix: NumericRange;
  rv20?: NumericRange;
  priceVsSma200Pct?: NumericRange;
  drawdownFromRecentHighPct?: NumericRange;
  adx14: NumericRange;
  roc20: NumericRange;
};

type NumericInputKey = Exclude<keyof PcsRiskEnvelopeInput, 'regime' | 'slowSubregime'>;

const BULL_LOW_VOL_TREND: PcsRiskEnvelopeBranch = {
  id: 'BULL_LOW_VOL_TREND',
  regimes: ['BULL'],
  vix: { min: 14, max: 16, tolerance: 1 },
  rv20: { max: .65, tolerance: .05 },
  priceVsSma200Pct: { max: .10, tolerance: .02 },
  drawdownFromRecentHighPct: { max: .05, tolerance: .01 },
  adx14: { min: 12, max: 30, tolerance: 3 },
  roc20: { min: 0, tolerance: .02 },
};

const BULL_MID_VOL_TREND: PcsRiskEnvelopeBranch = {
  id: 'BULL_MID_VOL_TREND',
  regimes: ['BULL'],
  vix: { min: 16, max: 18, tolerance: 1 },
  rv20: { max: .60, tolerance: .05 },
  priceVsSma200Pct: { min: .08, max: .10, tolerance: .02 },
  drawdownFromRecentHighPct: { max: .07, tolerance: .01 },
  adx14: { min: 12, max: 30, tolerance: 3 },
  roc20: { min: -.03, tolerance: .02 },
};

const WEAKENING_SR02_RECOVERY: PcsRiskEnvelopeBranch = {
  id: 'WEAKENING_SR02_RECOVERY',
  regimes: ['RISK_ON_WEAKENING'],
  slowSubregimes: ['SR02'],
  vix: { min: 18, max: 26, tolerance: 1 },
  priceVsSma200Pct: { min: .12, max: .18, tolerance: .02 },
  drawdownFromRecentHighPct: { max: .05, tolerance: .01 },
  adx14: { max: 20, tolerance: 3 },
  roc20: { min: -.02, tolerance: .02 },
};

const WEAKENING_SR01_HIGH_ADX: PcsRiskEnvelopeBranch = {
  id: 'WEAKENING_SR01_HIGH_ADX',
  regimes: ['RISK_ON_WEAKENING'],
  slowSubregimes: ['SR01'],
  vix: { min: 14, max: 17, tolerance: 1 },
  rv20: { min: .55, max: .75, tolerance: .05 },
  priceVsSma200Pct: { max: .06, tolerance: .02 },
  drawdownFromRecentHighPct: { min: .05, max: .08, tolerance: .01 },
  adx14: { min: 20, max: 30, tolerance: 3 },
  roc20: { max: -.02, tolerance: .02 },
};

// 共同边界优先于原始矩形；这是“合并”研究臂，不是默认扩大规则。
const MERGED_BULL_STRICT: PcsRiskEnvelopeBranch = {
  id: 'BULL_MERGED_STRICT',
  regimes: ['BULL'],
  vix: { min: 14, max: 18, tolerance: 1 },
  rv20: { max: .60, tolerance: .05 },
  priceVsSma200Pct: { min: .08, max: .10, tolerance: .02 },
  drawdownFromRecentHighPct: { max: .05, tolerance: .01 },
  adx14: { min: 12, max: 30, tolerance: 3 },
  roc20: { min: 0, tolerance: .02 },
};

const MERGED_BULL_BROAD: PcsRiskEnvelopeBranch = {
  id: 'BULL_MERGED_BROAD',
  regimes: ['BULL'],
  vix: { min: 14, max: 18, tolerance: 1 },
  rv20: { max: .65, tolerance: .05 },
  priceVsSma200Pct: { max: .10, tolerance: .02 },
  drawdownFromRecentHighPct: { max: .07, tolerance: .01 },
  adx14: { min: 12, max: 30, tolerance: 3 },
  roc20: { min: -.03, tolerance: .02 },
};

const CANDIDATE4_FULL_BRANCHES: readonly PcsRiskEnvelopeBranch[] = [
  BULL_LOW_VOL_TREND,
  WEAKENING_SR02_RECOVERY,
  BULL_MID_VOL_TREND,
  WEAKENING_SR01_HIGH_ADX,
];

function exactBranch(branch: PcsRiskEnvelopeBranch): PcsRiskEnvelopeBranch {
  const exactRange = (range: NumericRange): NumericRange => ({ ...range, tolerance: 0 });
  return {
    ...branch,
    vix: exactRange(branch.vix),
    rv20: branch.rv20 ? exactRange(branch.rv20) : undefined,
    priceVsSma200Pct: branch.priceVsSma200Pct ? exactRange(branch.priceVsSma200Pct) : undefined,
    drawdownFromRecentHighPct: branch.drawdownFromRecentHighPct ? exactRange(branch.drawdownFromRecentHighPct) : undefined,
    adx14: exactRange(branch.adx14),
    roc20: exactRange(branch.roc20),
  };
}

const CANDIDATE4_FULL_ONLY_BRANCHES: readonly PcsRiskEnvelopeBranch[] = CANDIDATE4_FULL_BRANCHES.map(exactBranch);

// 冻结窗口验证：BULL 两分支没有带来候选4的增量成交；canonical 候选4只保留 weakening 两分支。
const CANDIDATE4_BRANCHES: readonly PcsRiskEnvelopeBranch[] = [
  WEAKENING_SR02_RECOVERY,
  WEAKENING_SR01_HIGH_ADX,
];

const CANDIDATE4_WEAKENING_FULL_ONLY_BRANCHES: readonly PcsRiskEnvelopeBranch[] = CANDIDATE4_BRANCHES.map(exactBranch);

const PROFILE_BRANCHES: Record<PcsRiskEnvelopeProfile, readonly PcsRiskEnvelopeBranch[]> = {
  candidate4_v1: CANDIDATE4_BRANCHES,
  candidate4_full_v1: CANDIDATE4_FULL_BRANCHES,
  candidate4_full_only_v1: CANDIDATE4_FULL_ONLY_BRANCHES,
  candidate4_weakening_full_only_v1: CANDIDATE4_WEAKENING_FULL_ONLY_BRANCHES,
  candidate4_merged_bull_strict_v1: [MERGED_BULL_STRICT, WEAKENING_SR02_RECOVERY, WEAKENING_SR01_HIGH_ADX],
  candidate4_merged_bull_broad_v1: [MERGED_BULL_BROAD, WEAKENING_SR02_RECOVERY, WEAKENING_SR01_HIGH_ADX],
  candidate4_weakening_only_v1: CANDIDATE4_BRANCHES,
};

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function inRange(value: number | undefined, range: NumericRange, tolerance = 0): boolean {
  if (!finite(value)) return false;
  if (range.min !== undefined && value < range.min - tolerance) return false;
  if (range.max !== undefined && value >= range.max + tolerance) return false;
  return true;
}

function rangeFields(branch: PcsRiskEnvelopeBranch): Array<[NumericInputKey, NumericRange]> {
  return [
    ['vix', branch.vix],
    ...(branch.rv20 ? [['rv20', branch.rv20] as [NumericInputKey, NumericRange]] : []),
    ...(branch.priceVsSma200Pct ? [['priceVsSma200Pct', branch.priceVsSma200Pct] as [NumericInputKey, NumericRange]] : []),
    ...(branch.drawdownFromRecentHighPct ? [['drawdownFromRecentHighPct', branch.drawdownFromRecentHighPct] as [NumericInputKey, NumericRange]] : []),
    ['adx14', branch.adx14],
    ['roc20', branch.roc20],
  ];
}

function numericValue(input: PcsRiskEnvelopeInput, key: NumericInputKey): number | undefined {
  return input[key];
}

function matchesCategories(input: PcsRiskEnvelopeInput, branch: PcsRiskEnvelopeBranch): boolean {
  return branch.regimes.includes(input.regime ?? '')
    && (branch.slowSubregimes === undefined || branch.slowSubregimes.includes(input.slowSubregime ?? ''));
}

function isFullMatch(input: PcsRiskEnvelopeInput, branch: PcsRiskEnvelopeBranch): boolean {
  return matchesCategories(input, branch)
    && rangeFields(branch).every(([key, range]) => inRange(numericValue(input, key), range));
}

function isBoundaryMatch(input: PcsRiskEnvelopeInput, branch: PcsRiskEnvelopeBranch): boolean {
  if (!matchesCategories(input, branch)) return false;
  const fields = rangeFields(branch);
  const fullFieldCount = fields.filter(([key, range]) => inRange(numericValue(input, key), range)).length;
  if (fullFieldCount !== fields.length - 1) return false;
  return fields.some(([key, range]) => !inRange(numericValue(input, key), range) && inRange(numericValue(input, key), range, range.tolerance));
}

/**
 * 返回最宽松的可执行档位：命中任意窄分支即 FULL，只有一个连续因子越过边界
 * 且仍在该因子容差内才给 HALF；缺失因子一律 BLOCK。
 */
export function evaluatePcsRiskEnvelope(input: PcsRiskEnvelopeInput, profile: PcsRiskEnvelopeProfile = 'candidate4_v1'): PcsRiskEnvelopeResult {
  const branches = PROFILE_BRANCHES[profile];
  const fullMatches = branches.filter(branch => isFullMatch(input, branch)).map(branch => branch.id);
  if (fullMatches.length) return { band: 'FULL', multiplier: 1, fullMatches, boundaryMatches: [] };

  const boundaryMatches = branches.filter(branch => isBoundaryMatch(input, branch)).map(branch => branch.id);
  if (boundaryMatches.length) return { band: 'HALF', multiplier: .5, fullMatches: [], boundaryMatches };

  return { band: 'BLOCK', multiplier: 0, fullMatches: [], boundaryMatches: [] };
}
