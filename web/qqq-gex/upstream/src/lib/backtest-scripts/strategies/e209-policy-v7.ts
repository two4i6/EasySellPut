/** Effective current E209 policy leaf. Historical migration registration is not a runtime dependency. */
import {freezeStrategyData,type StrategyObject} from '../strategy-module-v2';
export const E209_V2_CONTRACT = freezeStrategyData({
  ratioMin: .325, ratioMax: 1.425, widthTargetPct: .0625, profitTarget: .225,
  vixMultiplier: 2.85, upMultiplier: 2.196, rangeMultiplier: 1.5, downMultiplier: .63455,
  bullNeutralSr01Multiplier: .7403, bullNeutralSr02Multiplier: 2.055, bullSr02BullTrendMultiplier: 1.4,
  recoveryVxnThreshold: 22.4,
} as const);

export const E209_PARAMS = freezeStrategyData({ ...E209_V2_CONTRACT, parent: 'EB7.E207', source: 'EB7.E209' });
/** Fixed migration contract: never silently accept an override the rule kernel ignores. */
export function assertE209Params(params: Readonly<StrategyObject>) {
  if (Object.keys(params).length !== Object.keys(E209_PARAMS).length
    || Object.entries(E209_PARAMS).some(([key, value]) => params[key] !== value)) {
    throw new Error('E209 migration requires the pinned parameter contract');
  }
}

/** Exact effective E148+E209 macro coefficients, with low-VIX overrides removed by E209. */
export function e209RiskMultiplier(context: Readonly<StrategyObject>): number {
  const { regime, trend, slowSubregime } = context;
  let macro = 1;
  if (regime === 'BULL' && trend === 'NEUTRAL' && slowSubregime === 'SR01') macro = E209_V2_CONTRACT.bullNeutralSr01Multiplier;
  else if (regime === 'BULL' && trend === 'NEUTRAL' && slowSubregime === 'SR02') macro = E209_V2_CONTRACT.bullNeutralSr02Multiplier;
  else if (regime === 'BULL' && slowSubregime === 'SR02' && (trend === 'BULL' || trend === 'STRONG_BULL')) macro = E209_V2_CONTRACT.bullSr02BullTrendMultiplier;
  else if (regime === 'RANGE_BOUND' && trend === 'NEUTRAL') macro = E209_V2_CONTRACT.rangeMultiplier;
  else if ((trend === 'BEAR' && slowSubregime === 'SR01')
    || (regime === 'RISK_ON_WEAKENING' && trend === 'NEUTRAL' && slowSubregime === 'CURRENT')) macro = E209_V2_CONTRACT.downMultiplier;
  else if ((regime === 'BULL' || regime === 'RISK_ON_WEAKENING') && trend === 'NEUTRAL') macro = E209_V2_CONTRACT.upMultiplier;
  return macro * E209_V2_CONTRACT.vixMultiplier;
}

/** Close policy preserves native prior-regime precedence over the .225 credit target. */
export function e209ExitReason(input: { priorRegime: string; crisisPhase: string; unweightedPnl: number; creditReceived: number }): string | null {
  if (input.priorRegime === 'BEAR' || input.priorRegime === 'CRISIS'
    || input.crisisPhase === 'PENDING' || input.crisisPhase === 'CONFIRMED') return 'regime-or-crisis';
  return input.unweightedPnl >= input.creditReceived * E209_V2_CONTRACT.profitTarget ? 'profit-target' : null;
}


export {E209_SOURCE_BOOKS,E209_NATIVE_SOURCE_CONTRACT,e209NativeSourcePolicy} from './e209-source-contract-v1';

/** Effective book policy. Portfolio geometry/exits belong to the portfolio,
 * even when its native observation belongs to a narrow entry source. */
export function e209SourceContract(source: string, vxn: unknown = NaN) {
  const rolling = source.startsWith('rolling-');
  const small = source.endsWith('screen') || rolling;
  return {
    candidate6: small, broad: small ? false : !source.endsWith('raw'),
    riskSource: source === 'rolling-base' ? 'rolling-raw' : source,
    dte: { vxnThreshold: 24, recoveryVxnThreshold: small ? 21 : E209_V2_CONTRACT.recoveryVxnThreshold,
      minHighRiskDays: small ? 5 : source.startsWith('low-') ? 2 : 3 },
    highRiskDte: 28 as const, normalDte: 35 as const,
    widthTargetPct: small ? Number(vxn) >= 22 ? .045 : rolling ? .055 : .05 : E209_V2_CONTRACT.widthTargetPct,
    ratioMin: small ? .6 : E209_V2_CONTRACT.ratioMin,
    ratioMax: small ? 1.4 : E209_V2_CONTRACT.ratioMax,
    profitTargetExit: !small,
  };
}
