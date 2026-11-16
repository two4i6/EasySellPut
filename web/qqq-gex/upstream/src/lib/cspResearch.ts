import type { CSPSettings } from '@/store/useCSPStore';
import { DTE_RANGES, type DTERange } from '@/lib/findBestCSPStrike';

export type CspPosture = 'DEFENSIVE' | 'BALANCED' | 'AGGRESSIVE';
export type CspDteRange = '0-1' | '1-7' | '7-14' | '14-21' | '21-35' | '35-50' | '50-70';

export const CSP_POSTURES: Record<CspPosture, Partial<CSPSettings>> = {
  DEFENSIVE: { safetyEnabled: true, targetDelta: -0.12, minDelta: -0.25, maxDelta: -0.05, lossAversion: 0.50, stressProbability: 0.08, spreadPenalty: 3.5, deltaBand: 0.05, deltaPenaltyAlpha: 0.30, techTrendFocus: 'LONG' },
  BALANCED: { safetyEnabled: true, targetDelta: -0.20, minDelta: -0.40, maxDelta: -0.05, lossAversion: 0.15, stressProbability: 0.05, spreadPenalty: 2.0, deltaBand: 0.10, deltaPenaltyAlpha: 0.15, techTrendFocus: 'BALANCED' },
  AGGRESSIVE: { safetyEnabled: false, targetDelta: -0.35, minDelta: -0.60, maxDelta: -0.15, lossAversion: 0.05, stressProbability: 0.02, spreadPenalty: 1.0, deltaBand: 0.15, deltaPenaltyAlpha: 0.05, techTrendFocus: 'SHORT' },
};

export function cspPostureSettings(posture: CspPosture = 'BALANCED') {
  return CSP_POSTURES[posture];
}

export function cspDteRange(label: CspDteRange = '7-14'): DTERange {
  return DTE_RANGES.find(range => range.label === label) ?? DTE_RANGES[2];
}

const percentile = (values: number[], value: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  const lower = sorted.findIndex(item => item >= value);
  const upper = sorted.findLastIndex(item => item <= value);
  return ((lower < 0 ? sorted.length : (lower + upper + 1) / 2) / sorted.length) * 100;
};

export function addCspEdgeScores<T extends { rawScore?: number | null; sellerEdgeScore?: number | null; winProb?: number | null; svAdjFactor?: number | null }>(candidates: T[]): Array<T & { edgeScore: number | null }> {
  if (candidates.length < 5) return candidates.map(candidate => ({ ...candidate, edgeScore: null }));
  const rawScores = candidates.map(candidate => candidate.rawScore).filter((value): value is number => Number.isFinite(value));
  const sellerEdgeScores = candidates.map(candidate => candidate.sellerEdgeScore).filter((value): value is number => Number.isFinite(value));
  return candidates.map(candidate => {
    if (!Number.isFinite(candidate.rawScore) || !sellerEdgeScores.length) return { ...candidate, edgeScore: null };
    const rawPct = percentile(rawScores, candidate.rawScore!);
    const sellerEdgePct = percentile(sellerEdgeScores, candidate.sellerEdgeScore ?? 0);
    const sellerEdgeFactor = 0.6 + 0.4 * Math.sqrt(sellerEdgePct / 100);
    const winProb = candidate.winProb ?? 0.85;
    const winPenalty = winProb >= 0.88 ? 1 : Math.max(0.6, Math.exp((winProb - 0.88) * 5));
    const tailPenalty = 1 / Math.min(candidate.svAdjFactor ?? 1, 1.5);
    return { ...candidate, edgeScore: rawPct * Math.max(0.35, sellerEdgeFactor * winPenalty * tailPenalty) };
  });
}
