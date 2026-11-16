import type { FinancialFactor } from '@/types/factor';
import { marketDataProxyHeaders, marketDataProxyUrl } from './yahooProxyFetch';

const FRED_VIX3M_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VXVCLS&cos=Close';
const CACHE_TTL_MS = 5 * 60_000;
let cached: { value: FinancialFactor<Record<string, number>>; at: number } | null = null;

export function parseFredVix3mCsv(csv: string): Record<string, number> {
  return Object.fromEntries(csv.split(/\r?\n/).flatMap((line) => {
    const [date, close] = line.split(',');
    const value = Number(close);
    return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(value) && value > 0 ? [[date, value]] : [];
  }));
}

export async function fetchFredVix3mByDate(): Promise<FinancialFactor<Record<string, number>>> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const url = marketDataProxyUrl(FRED_VIX3M_URL);
    const response = await fetch(url, {
      headers: marketDataProxyHeaders(url),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = parseFredVix3mCsv(await response.text());
    if (Object.keys(value).length === 0) throw new Error('empty VXVCLS CSV');
    const factor: FinancialFactor<Record<string, number>> = {
      value,
      confidence: 10,
      source: { type: 'raw', api: 'FRED VXVCLS (Cboe VIX3M)' },
    };
    cached = { value: factor, at: Date.now() };
    return factor;
  } catch (error) {
    return {
      value: {},
      confidence: 0,
      source: { type: 'fallback', reason: `FRED VXVCLS unavailable: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}
