/** Stored dates must be real calendar days; malformed preferences use the default. */
export function parseQqqGexDatePreference(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const time = Date.parse(`${raw}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw ? raw : null;
}

/** Prior-close snapshots may include contracts already expired for this session. */
export function qqqGexExpiriesForSession<T extends { expiryDate: string }>(expiries: readonly T[], date: string | null | undefined): readonly T[] {
  return date && parseQqqGexDatePreference(date) ? expiries.filter(expiry => expiry.expiryDate >= date) : expiries;
}

/** Only an absent selection uses the default. Missing explicit DTE stays missing. */
export function resolveSelectedGexExpiry<T extends { expiryDate: string }>(expiries: readonly T[] | undefined, selected: string | null): T | undefined {
  return selected === null ? expiries?.[0] : expiries?.find(e => e.expiryDate === selected);
}
/** Display DTE relative to the selected session, never the browser's next calendar day. */
export function qqqGexSessionDte(expiry: string, date: string | null | undefined, fallback: number) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return fallback;
  const difference = Date.parse(expiry) - Date.parse(date);
  return Number.isFinite(difference) ? Math.round(difference / 86400000) : fallback;
}
