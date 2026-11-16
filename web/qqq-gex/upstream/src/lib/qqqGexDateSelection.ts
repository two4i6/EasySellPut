export type QqqGexDateMode = 'follow' | 'fixed' | null;
export const parseQqqGexDateMode = (value: string | null): QqqGexDateMode => value === 'follow' || value === 'fixed' ? value : null;

/** Persist user intent independently of the latest source date. Legacy saved
 * historical dates stay fixed; following rolls the date and clears its DTE. */
export function resolveQqqGexDateSelection(mode: QqqGexDateMode, selected: string | null, latest: string) {
  const resolved = mode ?? (!selected || selected === latest ? 'follow' : 'fixed');
  const date = resolved === 'follow' ? latest : selected;
  return { mode: resolved, date, resetExpiry: date !== selected };
}
