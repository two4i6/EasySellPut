/** Versioned research execution scenarios. These are not broker or NBBO attestations. */
import type { QqqSpreadAdapterConfig } from './qqq-spread-adapter-v2';

import {SPREAD_EXECUTION_PROFILES,type SpreadExecutionProfile} from './spread-execution-profile-names-v4';
export {SPREAD_EXECUTION_PROFILES,type SpreadExecutionProfile} from './spread-execution-profile-names-v4';
export type FundedSpreadExecution = {
  version: 'funded-spread-v1'; maxContractsPerOrder: number; participationRate: number;
  maxOrderRiskFraction: number; slippagePerLeg: number;
  liquidityEvidence: 'synthetic-not-observed';
};
export function resolveSpreadExecutionProfile(base: QqqSpreadAdapterConfig, profile: SpreadExecutionProfile): QqqSpreadAdapterConfig {
  if (profile === 'weighted-reference') return { ...base };
  if (!SPREAD_EXECUTION_PROFILES.includes(profile)) throw new Error('Unknown execution profile');
  const stress = profile === 'funded-stress-v1';
  return { ...base, liquidityModel: true, commissionPerContract: stress ? 1.30 : base.commissionPerContract,
    funded: { version: 'funded-spread-v1', maxContractsPerOrder: 25, participationRate: stress ? .005 : .01,
      maxOrderRiskFraction: .05, slippagePerLeg: stress ? .05 : .02, liquidityEvidence: 'synthetic-not-observed' } };
}
