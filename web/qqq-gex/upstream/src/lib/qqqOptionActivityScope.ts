import type { PcsGexExpiry } from '@/types/qqqGex';

/** Keep expiry contracts separate so missing inputs retain their original coverage. */
export function aggregateQqqOptionActivity(expiries: readonly PcsGexExpiry[], asOf: string, missing: readonly string[] = []): PcsGexExpiry | null {
  if (!expiries.length || missing.length || expiries.some(expiry => !expiry.fullGexProfile.length)) return null;
  const rows=expiries.flatMap(expiry => expiry.fullGexProfile);
  const identified=rows.every(point=>Boolean(point.calculationVersion&&point.gexUnit));
  return { ...expiries[0], expiryDate: 'all', dte: 0, asOf,
    fullGexProfile: identified ? rows : rows.map(point=>({...point,callGex:NaN,putGex:NaN,totalGex:NaN})),
    fullGexProfileHistory: [], gexProfile: [], gexProfileHistory: [], gex: [], wallHistory: [], gexSummary: null, terminal: undefined, research: null };
}
