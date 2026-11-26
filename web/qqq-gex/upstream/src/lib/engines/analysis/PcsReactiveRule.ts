export const REACTIVE_PCS_ALLOWED_REGIMES = ['BULL', 'RISK_ON_EXTENDED', 'RISK_ON_WEAKENING'] as const;

export type ReactivePcsReasonCode =
  | 'NON_QQQ'
  | 'VIX_OUT_OF_RANGE'
  | 'REGIME_DISALLOWED'
  | 'CRISIS_PHASE'
  | 'MISSING_VIX'
  | 'MISSING_TERM_RATIO'
  | 'BACKWARDATED_TERM';

export interface ReactivePcsTimingInput {
  symbol: string;
  regime: string | null | undefined;
  vix: number | null | undefined;
  crisisPhase?: string | null;
  vix3m?: number | null;
  termRatio?: number | null;
}

export interface ReactivePcsTimingEvaluation {
  eligible: boolean;
  termRatio: number | null;
  reasonCodes: ReactivePcsReasonCode[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeRatio(vix: unknown, vix3m: unknown): number | null {
  if (!isFiniteNumber(vix) || !isFiniteNumber(vix3m) || vix3m === 0) return null;
  return vix / vix3m;
}

export function explainReactivePcsTiming(input: ReactivePcsTimingInput): ReactivePcsTimingEvaluation {
  const reasonCodes: ReactivePcsReasonCode[] = [];
  const regime = input.regime ?? null;
  const vix = isFiniteNumber(input.vix) ? input.vix : null;
  const ratio =
    isFiniteNumber(input.termRatio) && input.termRatio !== null
      ? input.termRatio!
      : safeRatio(input.vix, input.vix3m);













  if (input.symbol !== 'QQQ') {
    reasonCodes.push('NON_QQQ');
  }

  if (!isFiniteNumber(vix)) {
    reasonCodes.push('MISSING_VIX');
  } else if (vix < 14 || vix > 28) {
    reasonCodes.push('VIX_OUT_OF_RANGE');
  }

  if (!REACTIVE_PCS_ALLOWED_REGIMES.includes(regime as (typeof REACTIVE_PCS_ALLOWED_REGIMES)[number])) {
    reasonCodes.push('REGIME_DISALLOWED');
  }

  if (input.crisisPhase === 'CONFIRMED' || input.crisisPhase === 'PENDING') {
    reasonCodes.push('CRISIS_PHASE');
  }

  if (!isFiniteNumber(ratio)) {
    reasonCodes.push('MISSING_TERM_RATIO');
  } else if (ratio >= 1) {
    reasonCodes.push('BACKWARDATED_TERM');
  }

  const uniqueReasons = Array.from(new Set(reasonCodes)).sort();
  return {
    eligible: uniqueReasons.length === 0,
    termRatio: isFiniteNumber(ratio) ? ratio! : null,
    reasonCodes: uniqueReasons,
  };
}

export const evaluateReactivePcsTiming = explainReactivePcsTiming;

export function isReactivePcsTiming(
  symbol: string,
  regime: string,
  vix: number,
  crisisPhase: string | undefined,
  vix3m: number,
) {
  return explainReactivePcsTiming({ symbol, regime, vix, crisisPhase, vix3m }).eligible;
}
