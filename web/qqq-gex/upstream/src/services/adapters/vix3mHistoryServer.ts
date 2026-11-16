import { fetchCboeVix3mByDate } from './cboeVix3mServer';
import { fetchFredVix3mByDate } from './fredVix3mServer';
import type { FinancialFactor } from '@/types/factor';

export type Vix3mHistoryCoverage = {
  byDate: Record<string, number>;
  yahooRefreshCount: number;
  cboeSameDayCount: number;
  fredSameDayCount: number;
  missingDates: string[];
};

type Vix3mSourceLoader = () => Promise<FinancialFactor<Record<string, number>>>;

function uniqueDates(dates: readonly string[]) {
  return [...new Set(dates.map((date) => date.slice(0, 10)))];
}

function missingDates(requiredDates: readonly string[], values: Record<string, number>) {
  return uniqueDates(requiredDates).filter((date) => values[date] === undefined);
}

function mergeMissing(
  primary: Record<string, number>,
  fallback: Record<string, number>,
  dates: readonly string[],
) {
  const merged = { ...primary };
  for (const date of dates) {
    const value = fallback[date];
    if (merged[date] === undefined && Number.isFinite(value) && value > 0) merged[date] = value;
  }
  return merged;
}

/**
 * 完成日线 VIX3M 历史：Yahoo 主源，CBOE 官方 CSV，FRED VXVCLS。
 * 补源只接受同一交易日 close，不前填、不后填、不覆盖主源已有值。
 */
export async function completeVix3mByDate(input: {
  primaryByDate: Record<string, number>;
  requiredDates: readonly string[];
  refreshYahoo?: () => Promise<Record<string, number>>;
  sourceLoaders?: { cboe?: Vix3mSourceLoader; fred?: Vix3mSourceLoader };
}): Promise<Vix3mHistoryCoverage> {
  const required = uniqueDates(input.requiredDates);
  let byDate = { ...input.primaryByDate };
  const initialMissing = missingDates(required, byDate);
  let yahooRefreshCount = 0;
  let cboeSameDayCount = 0;
  let fredSameDayCount = 0;

  if (initialMissing.length > 0 && input.refreshYahoo) {
    try {
      const refreshedYahoo = await input.refreshYahoo();
      const merged = mergeMissing(byDate, refreshedYahoo, initialMissing);
      yahooRefreshCount = initialMissing.filter((date) => byDate[date] === undefined && merged[date] !== undefined).length;
      byDate = merged;
    } catch {
      // Yahoo refresh is opportunistic; CBOE/FRED remain authoritative fallbacks.
    }
  }

  const stillMissingAfterYahoo = missingDates(required, byDate);
  if (stillMissingAfterYahoo.length > 0) {
    const cboe = await (input.sourceLoaders?.cboe ?? fetchCboeVix3mByDate)();
    const cboeMerged = mergeMissing(byDate, cboe.value, stillMissingAfterYahoo);
    cboeSameDayCount = stillMissingAfterYahoo.filter((date) => byDate[date] === undefined && cboeMerged[date] !== undefined).length;
    byDate = cboeMerged;

    const stillMissingAfterCboe = missingDates(required, byDate);
    if (stillMissingAfterCboe.length > 0) {
      const fred = await (input.sourceLoaders?.fred ?? fetchFredVix3mByDate)();
      const fredMerged = mergeMissing(byDate, fred.value, stillMissingAfterCboe);
      fredSameDayCount = stillMissingAfterCboe.filter((date) => byDate[date] === undefined && fredMerged[date] !== undefined).length;
      byDate = fredMerged;
    }
  }

  return {
    byDate,
    yahooRefreshCount,
    cboeSameDayCount,
    fredSameDayCount,
    missingDates: missingDates(required, byDate),
  };
}
