import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { qqqGexDisplayStrikeValid } from './qqqGexInputQuality';
import { qqqDirectionalGexTime } from './qqqDirectionalGexTime';
import type { GammaModelStrike } from './qqqGammaModel';

import { qqqStrikeIvUsable } from './qqqIvQuality';

/** Include unchanged full expiries in the aggregate coverage denominator. */
export function qqqGammaObservationCoverage(data: QqqPcsApiResponse, coverage: ReadonlyMap<string,{valid:number;total:number}>, expiry: string | undefined, aggregate: boolean) {
  return (data.intraday?.gexExpiries ?? []).filter(point => aggregate || point.expiryDate === expiry)
    .reduce((result, point) => {
      const counts = coverage.get(point.expiryDate);
      return {valid:result.valid+(counts?.valid ?? point.fullGexProfile.length),total:result.total+(counts?.total ?? point.fullGexProfile.length)};
    },{valid:0,total:0});
}

/** Preserve receipt time of the full capture, including excluded contracts. */
export function prepareQqqPartialGammaInput<T extends GammaModelStrike>(asOf: string, source: readonly T[]) {
  if (!source.some(point => point.inputComplete === false || !qqqStrikeIvUsable(point))) return null;
  const valid = source.filter(point => qqqGexDisplayStrikeValid(point) && qqqStrikeIvUsable(point));
  const available = Math.max(Date.parse(asOf), Date.parse(qqqDirectionalGexTime(asOf, null, source)));
  const unique = new Set(valid.map(point => point.strike)).size === valid.length;
  return { coverage: { valid: valid.length, total: source.length },
    asOf: Number.isFinite(available) ? new Date(available).toISOString() : asOf,
    strikes: unique && Number.isFinite(available) ? valid.map(point => ({ ...point, inputComplete: true })) : [] };
}

/** Observation-only subset. Never writes back to capture data or decision models. */
export function qqqGammaObservationInput(data: QqqPcsApiResponse) {
  const coverage = new Map<string, { valid: number; total: number }>();
  const expiries = data.intraday?.gexExpiries?.map(expiry => {
    const source = expiry.fullGexProfile as Array<typeof expiry.fullGexProfile[number] & GammaModelStrike>;
    const prepared = prepareQqqPartialGammaInput(expiry.asOf, source);
    if (!prepared) return expiry;
    coverage.set(expiry.expiryDate, prepared.coverage);
    return { ...expiry, asOf: prepared.asOf, fullGexProfile: prepared.strikes };
  });
  return { coverage, data: coverage.size && data.intraday ? {
    ...data, intraday: { ...data.intraday, gexExpiries: expiries, gammaModels: undefined },
  } : data };
}
