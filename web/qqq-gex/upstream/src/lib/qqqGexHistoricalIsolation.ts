import type { QqqPcsApiResponse } from '@/types/qqqGex';

/** Shared isolation boundary for saved snapshots and causal replay. */
export function isolateHistoricalGexDecision(base: QqqPcsApiResponse, reason: string, asOf: string) {
  const unavailable = <T,>(value: T) => ({ value, confidence: 0, source: { type: 'fallback' as const, reason } });
  return {
    factors: {}, candidate: { status: 'UNAVAILABLE' as const, reason }, syntheticCandidate: null, probabilityContext: undefined,
    timing: unavailable('INSUFFICIENT_DATA' as const), lifecycle: { available: false, points: [] },
    regime: { ...base.regime, unified: null, overlay: null, disagreement: false },
    daily: { ...base.daily, eligibility: unavailable('UNAVAILABLE' as const), confirmation: unavailable(0), reasons: [reason], asOf },
  } satisfies Partial<QqqPcsApiResponse>;
}
