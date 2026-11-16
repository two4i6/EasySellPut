import artifactJson from './artifacts/slow-subregime-sr-v1.json';
import { createDerivedFactor, fallbackFactor } from '../../factor';
import type { FactorMap } from '../../../types/factor';
import type { SlowSubregimeArtifact } from './backtest/slow-subregime-model';
import type { SlowSubregimeDiagnostic } from './backtest/types';
import { advanceStudentTHsmmFilter } from './backtest/generalized-hsmm';

const artifact = artifactJson as unknown as SlowSubregimeArtifact;
const { checksum } = artifact;
if (checksum !== '4c9f977dde18bbb1738cf3433b2f844d478658c851366a36e3e2a47e77706c00') throw new Error('slow-subregime artifact checksum mismatch');
const history = new Map(artifact.history.map(row => [row.effectiveDate, row]));

export const SLOW_SUBREGIME_ARTIFACT_CHECKSUM = checksum;

function healthyDiagnostic(date: string, observationCutoff: string, state: 'SR01' | 'SR02', posterior: readonly [number, number]): SlowSubregimeDiagnostic {
  const factors: FactorMap = {
    slow_subregime_model: { value: artifact.modelVersion, confidence: 7, source: { type: 'manual', description: `冻结 artifact ${checksum}` } },
  };
  const input = [{ factorId: 'slow_subregime_model', weight: 1 }];
  factors.slow_subregime_state = createDerivedFactor(state, input, factors);
  factors.slow_subregime_semantic = createDerivedFactor(state === 'SR02' ? '趋势扩张' : '防御压力', input, factors);
  factors.slow_subregime_posterior_sr01 = createDerivedFactor(posterior[0], input, factors);
  factors.slow_subregime_posterior_sr02 = createDerivedFactor(posterior[1], input, factors);
  factors.slow_subregime_data_health = createDerivedFactor('HEALTHY', input, factors);
  return { date, effectiveDate: date.slice(0, 10), observationCutoff, modelChecksum: checksum, factors };
}

export function resolveSlowSubregimeDiagnostic(date: string): SlowSubregimeDiagnostic {
  const day = date.slice(0, 10), row = history.get(day);
  const factors: FactorMap = {
    slow_subregime_model: { value: artifact.modelVersion, confidence: 7, source: { type: 'manual', description: `冻结 artifact ${checksum}` } },
  };
  if (!row) {
    const reason = `SR 数据在 ${day} 缺失、未发布或 stale；禁止前向填充`;
    factors.slow_subregime_state = fallbackFactor('CURRENT', reason);
    factors.slow_subregime_semantic = fallbackFactor('数据不可用', reason);
    factors.slow_subregime_posterior_sr01 = fallbackFactor(0, reason);
    factors.slow_subregime_posterior_sr02 = fallbackFactor(0, reason);
    factors.slow_subregime_data_health = fallbackFactor('STALE_OR_MISSING', reason);
    return { date, modelChecksum: checksum, factors };
  }
  return healthyDiagnostic(date, row.observationCutoff, row.state, row.posterior);
}

export function extendSlowSubregimeDiagnostics(rows: readonly { date: string; observationCutoff: string; values: number[] }[]) {
  let filter = artifact.terminalFilter;
  return rows.map(row => {
    const step = advanceStudentTHsmmFilter(artifact.profile, row.values, filter);
    filter = step.filter;
    return healthyDiagnostic(row.date, row.observationCutoff, step.filter.state === 1 ? 'SR02' : 'SR01', step.posterior as [number, number]);
  });
}

export const SLOW_SUBREGIME_FROZEN_MODEL = {
  terminalDate: artifact.history.at(-1)!.effectiveDate,
  featureIds: artifact.featureIds,
  normalization: artifact.normalization,
} as const;
