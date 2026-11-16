import type { FinancialFactor } from '@/types/factor';
import { marketDataProxyHeaders, marketDataProxyUrl } from './yahooProxyFetch';

const CBOE_VIX3M_URL = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv';
const CACHE_TTL_MS = 5 * 60_000;
let cached: { value: FinancialFactor<Record<string, number>>; at: number } | null = null;

function toIsoDate(value: string) {
  const [month, day, year] = value.split('/').map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;
}

export function parseCboeVix3mCsv(csv: string): Record<string, number> {
  return Object.fromEntries(csv.split(/\r?\n/).flatMap((line) => {
    const [date, , , , close] = line.split(',');
    const isoDate = toIsoDate(date ?? '');
    const value = Number(close);
    return isoDate && Number.isFinite(value) && value > 0 ? [[isoDate, value]] : [];
  }));
}

export async function fetchCboeVix3mByDate(): Promise<FinancialFactor<Record<string, number>>> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const url = marketDataProxyUrl(CBOE_VIX3M_URL);
    const response = await fetch(url, {
      headers: marketDataProxyHeaders(url),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = parseCboeVix3mCsv(await response.text());
    if (Object.keys(value).length === 0) throw new Error('empty VIX3M CSV');
    const factor: FinancialFactor<Record<string, number>> = {
      value,
      confidence: 10,
      source: { type: 'raw', api: 'Cboe VIX3M daily prices' },
    };
    cached = { value: factor, at: Date.now() };
    return factor;
  } catch (error) {
    return {
      value: {},
      confidence: 0,
      source: { type: 'fallback', reason: `Cboe VIX3M unavailable: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}
