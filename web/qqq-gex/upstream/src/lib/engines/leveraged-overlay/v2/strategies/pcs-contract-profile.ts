import type { StrategyParams } from '../../types/params';

export type PcsContractProfileId = NonNullable<StrategyParams['pcsContractProfile']>
  | 'dynamic-sigma-dte-v1'
  | 'dynamic-sigma-width-v1'
  | 'dynamic-dte-width-v1';
export type PcsContractProfileFactor = 'sigma' | 'dte' | 'width';

export type PcsContractProfile = {
  id: PcsContractProfileId;
  shortStrikeSigma: 1.5 | 2 | 2.5;
  targetDte: 28 | 35 | 42;
  widthPct: number;
  reason: string;
};

export type PcsContractProfileInput = {
  regime: string | undefined;
  vix: number | undefined;
  vix3m: number | undefined;
  annualizedRv20: number | undefined;
};

export function isPcsContractProfileStressed(input: PcsContractProfileInput): boolean {
  const { regime, vix, vix3m, annualizedRv20 } = input;
  return Boolean(regime && Number.isFinite(vix) && Number.isFinite(vix3m) && Number.isFinite(annualizedRv20)
    && vix! > 0 && vix3m! > 0 && annualizedRv20! > 0
    && (regime === 'CRISIS' || vix! >= 22 || vix! / vix3m! >= .95 || annualizedRv20! >= .28));
}

/**
 * Frozen daily inputs only: this is intentionally a profile selector, not a
 * contract-chain ranker. The execution path still selects actual legs.
 */
export function usesPcsContractProfileFactor(id: PcsContractProfileId | undefined, factor: PcsContractProfileFactor): boolean {
  // DTE and width are retired from the active profile pending separate evidence.
  if (id === 'dynamic-v1') return factor === 'sigma';
  if (id === `dynamic-${factor}-v1`) return true;
  return (id === 'dynamic-sigma-dte-v1' && (factor === 'sigma' || factor === 'dte'))
    || (id === 'dynamic-sigma-width-v1' && (factor === 'sigma' || factor === 'width'))
    || (id === 'dynamic-dte-width-v1' && (factor === 'dte' || factor === 'width'));
}

export function selectPcsContractProfile(input: PcsContractProfileInput, id: PcsContractProfileId = 'dynamic-v1'): PcsContractProfile | undefined {
  const { regime, vix, vix3m, annualizedRv20 } = input;
  if (!regime || !Number.isFinite(vix) || !Number.isFinite(vix3m) || !Number.isFinite(annualizedRv20)
    || vix! <= 0 || vix3m! <= 0 || annualizedRv20! <= 0) return undefined;

  const stressed = isPcsContractProfileStressed(input);
  if (stressed) return { id, shortStrikeSigma: 2.5, targetDte: 28, widthPct: .015, reason: '高波动或期限结构压力：加宽安全边际并缩短期限' };
  if (vix! >= 18 || annualizedRv20! >= .20) return { id, shortStrikeSigma: 2, targetDte: 35, widthPct: .015, reason: '中等波动：采用中性距离、期限与宽度' };
  return { id, shortStrikeSigma: 1.5, targetDte: 42, widthPct: .02, reason: '低波动且期限结构正常：保留较长期限与标准宽度' };
}
