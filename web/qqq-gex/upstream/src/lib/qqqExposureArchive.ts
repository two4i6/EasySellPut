import { qqqMarketDateBounds } from './qqqMarketDate';
import type { SourceManifest } from './qqqVersionedHistoryStore';
import type { ExposureBar } from './qqqExposureWorkbench';

export type ExposureArchiveManifest = {
  date: string; revision: string; observedAt: string;
  windows: Array<{ from: string; to: string; profiles: boolean; version: string }>;
  /** v2 consolidates price-only windows; v1 remains supported. */
  bars?: ExposureBar[];
  expiries?: string[];
};
export const EXPOSURE_CHUNK_MS = 60 * 60_000;

/** Include only non-empty windows; load the latest option observations first. */
export async function exposureArchiveManifest(date: string, source: SourceManifest, observedAt = new Date().toISOString(), bars?: ExposureBar[]): Promise<ExposureArchiveManifest> {
  const bounds = qqqMarketDateBounds(date), start = Date.parse(bounds.from), end = Math.min(Date.parse(bounds.to), Date.parse(observedAt));
  const windows = new Map<number, boolean>();
  for (const row of [...source.items, ...source.bars]) {
    const profile = 'captured_at' in row;
    const at = Date.parse(profile ? row.captured_at : row.bar_at);
    if (at < start || at >= end) continue;
    const index = Math.floor((at - start) / EXPOSURE_CHUNK_MS);
    windows.set(index, profile || windows.get(index) === true);
  }
  const parts = await Promise.all([...windows].filter(([,profiles])=>bars===undefined||profiles).map(async ([index, profiles]) => {
    const from = start + index * EXPOSURE_CHUNK_MS, to = Math.min(end, from + EXPOSURE_CHUNK_MS);
    const inside = (at: string) => Date.parse(at) >= from && Date.parse(at) < to;
    return { version: await exposureWindowVersion({ items: source.items.filter(row => inside(row.captured_at)), bars: source.bars.filter(row => inside(row.bar_at)) }),
    from: new Date(start + index * EXPOSURE_CHUNK_MS).toISOString(),
    to: new Date(Math.min(end, start + (index + 1) * EXPOSURE_CHUNK_MS)).toISOString(), profiles };
  }));
  return { date, observedAt, revision: 'scoped:' + source.revision, windows: parts.sort((a, b) => Number(b.profiles) - Number(a.profiles) || Date.parse(b.from) - Date.parse(a.from)),
    ...(bars===undefined?{}:{bars:bars.filter(bar=>Date.parse(bar.timestamp)>=start&&Date.parse(bar.timestamp)+120_000<=end),expiries:[...new Set(source.items.map(row=>row.expiry_date))].sort()}) };
}

export function exposureArchiveWindow(date: string, from: string | null, to: string | null) {
  if (from === null && to === null) return undefined;
  const bounds = qqqMarketDateBounds(date), start = Date.parse(from ?? ''), end = Date.parse(to ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.parse(bounds.from) || end > Date.parse(bounds.to) || end <= start || end - start > EXPOSURE_CHUNK_MS) throw Error('Invalid exposure window');
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

/** The exact row versions bind each independently cacheable chunk to its manifest. */
export async function exposureWindowVersion(source: Pick<SourceManifest, 'items' | 'bars'>) {
  const keys = [...source.items.map(row => ['profile', row.captured_at, row.expiry_date, row.version]), ...source.bars.map(row => ['bar', row.bar_at, row.version])];
  keys.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(keys)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
