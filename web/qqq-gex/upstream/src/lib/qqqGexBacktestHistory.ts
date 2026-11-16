import { compactGexProfile, type CompactGexStrike } from './qqqGexHistory';
import type { QqqIntradayCandle } from './qqqIntradayCandles';
import { supabaseAdmin } from './supabase';

const QQQ_GEX_BACKTEST_TIMEOUT_MS = 8_000;

type StoredGexBacktestRow = {
  captured_at: string;
  expiry_date: string;
  dte: number;
  spot: number;
  net_gex: number;
  gamma_flip: number | null;
  call_wall_price: number | null;
  call_wall_magnitude: number | null;
  put_wall_price: number | null;
  put_wall_magnitude: number | null;
  king_strike: number | null;
  king_magnitude: number | null;
  king_side: 'call' | 'put' | null;
  profile?: CompactGexStrike[];
};

type StoredCandleRow = {
  bar_at: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | string;
};

export type QqqGexBacktestSnapshot = {
  capturedAt: string;
  expiryDate: string;
  dte: number;
  spot: number;
  netGex: number;
  gammaFlip: number | null;
  callWallPrice: number | null;
  callWallMagnitude: number | null;
  putWallPrice: number | null;
  putWallMagnitude: number | null;
  kingStrike: number | null;
  kingMagnitude: number | null;
  kingSide: 'call' | 'put' | null;
  profile: CompactGexStrike[];
};

export type QqqGexBacktestSnapshotWithBar = QqqGexBacktestSnapshot & {
  /** 最近一根已知 K 线；始终满足 timestamp + 2分钟 <= capturedAt。缺失时保持 null，禁止向未来补值。 */
  bar: QqqIntradayCandle | null;
};

export type QqqGexBacktestHistoryPage = {
  available: true;
  range: { from: string; to: string; toExclusive: true };
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
  rejectedRows: number;
  rejectedBars: number;
  items: QqqGexBacktestSnapshotWithBar[];
};

export type QqqGexCaptureDateIndex = {
  available: true;
  range: { from: string; to: string; toExclusive: true };
  dates: string[];
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableFinite = (value: unknown): number | null => finite(value) ? value : null;

const easternDateKey = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

/** Read the complete persisted capture-date index, including future rows. */
export async function readQqqGexCaptureDateIndex(input: { policyId: string; from: string; to: string }): Promise<QqqGexCaptureDateIndex | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_BACKTEST_TIMEOUT_MS);
  try {
    const aggregate = await supabaseAdmin.rpc('qqq_gex_capture_dates', {
      p_policy_id: input.policyId, p_from: input.from, p_to: input.to,
    }).range(0, 999).abortSignal(controller.signal);
    if (!aggregate.error) {
      const dates = (aggregate.data ?? []).map((row: { capture_date: string }) => row.capture_date);
      for (let offset = 1000; dates.length === offset; offset += 1000) {
        const page = await supabaseAdmin.rpc('qqq_gex_capture_dates', {
          p_policy_id: input.policyId, p_from: input.from, p_to: input.to,
        }).range(offset, offset + 999).abortSignal(controller.signal);
        if (page.error) return null;
        dates.push(...(page.data ?? []).map((row: { capture_date: string }) => row.capture_date));
      }
      return { available: true, range: { from: input.from, to: input.to, toExclusive: true }, dates };
    }
    // Compatibility only while the read-only migration rolls out. Keep full
    // pagination rather than silently truncating the index to a row limit.
    if (aggregate.error.code !== 'PGRST202' && aggregate.error.code !== '42883') return null;
    const rows: Array<{ captured_at: unknown }> = [];
    const pageSize = 1_000;
    for (let firstPage = 0; ; firstPage += 5) {
      const results = await Promise.all(Array.from({ length: 5 }, (_, offset) => {
        const page = firstPage + offset;
        return supabaseAdmin.from('qqq_gex_expiry_snapshot')
          .select('captured_at')
          .eq('symbol', 'QQQ').eq('policy_id', input.policyId)
          .gte('captured_at', input.from).lt('captured_at', input.to)
          .order('captured_at', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .abortSignal(controller.signal);
      }));
      if (results.some((result) => result.error)) return null;
      const batches = results.map((result) => result.data ?? []);
      for (const batch of batches) rows.push(...batch);
      if (batches.some((batch) => batch.length < pageSize)) break;
    }
    const dates = [...new Set(rows.flatMap((row) => typeof row.captured_at === 'string' ? [easternDateKey(row.captured_at)] : []))];
    return { available: true, range: { from: input.from, to: input.to, toExclusive: true }, dates };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseStoredSnapshot(row: StoredGexBacktestRow, includeProfile: boolean): QqqGexBacktestSnapshot | null {
  if (!validIso(row.captured_at) || typeof row.expiry_date !== 'string' || !row.expiry_date
    || !finite(row.dte) || !finite(row.spot) || row.spot <= 0 || !finite(row.net_gex)) return null;
  return {
    capturedAt: row.captured_at,
    expiryDate: row.expiry_date,
    dte: row.dte,
    spot: row.spot,
    netGex: row.net_gex,
    gammaFlip: nullableFinite(row.gamma_flip),
    callWallPrice: nullableFinite(row.call_wall_price),
    callWallMagnitude: nullableFinite(row.call_wall_magnitude),
    putWallPrice: nullableFinite(row.put_wall_price),
    putWallMagnitude: nullableFinite(row.put_wall_magnitude),
    kingStrike: nullableFinite(row.king_strike),
    kingMagnitude: nullableFinite(row.king_magnitude),
    kingSide: row.king_side === 'call' || row.king_side === 'put' ? row.king_side : null,
    profile: includeProfile ? compactGexProfile(Array.isArray(row.profile) ? row.profile : []) : [],
  };
}

/** Lightweight selector metadata, separated from selected-expiry profile history. */
export async function readQqqGexExpiryIndex(input: { policyId: string; from: string; to: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_BACKTEST_TIMEOUT_MS);
  try {
    const result = await supabaseAdmin.rpc('qqq_gex_expiry_index', {
      p_policy_id: input.policyId, p_from: input.from, p_to: input.to,
    }).abortSignal(controller.signal);
    if (result.error || !Array.isArray(result.data)) return null;
    const items = (result.data as StoredGexBacktestRow[]).flatMap(row => {
      const snapshot = parseStoredSnapshot(row, false); return snapshot ? [snapshot] : [];
    });
    return { available: true, range: { from: input.from, to: input.to, toExclusive: true }, items };
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

function parseStoredCandle(row: StoredCandleRow): QqqIntradayCandle | null {
  const volume = Number(row.volume);
  if (!validIso(row.bar_at) || ![row.open, row.high, row.low, row.close].every((value) => finite(value) && value > 0)
    || !Number.isFinite(volume) || volume < 0) return null;
  return { timestamp: row.bar_at, open: row.open, high: row.high, low: row.low, close: row.close, volume };
}

/**
 * 因果 as-of join：对每个 GEX capturedAt，只取当时已经存在的最近 K 线。
 * 输入可以乱序；输出按 capturedAt、expiryDate 稳定升序，绝不使用 bar_at > captured_at。
 */
export function associateQqqGexSnapshotsWithCausalBars(
  snapshots: readonly QqqGexBacktestSnapshot[],
  bars: readonly QqqIntradayCandle[],
): QqqGexBacktestSnapshotWithBar[] {
  const sortedSnapshots = snapshots.slice().sort((left, right) => (
    Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.expiryDate.localeCompare(right.expiryDate)
  ));
  const sortedBars = bars
    .filter((bar) => validIso(bar.timestamp))
    .slice()
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  let barIndex = 0;
  let latestBar: QqqIntradayCandle | null = null;
  return sortedSnapshots.map((snapshot) => {
    const capturedAt = Date.parse(snapshot.capturedAt);
    while (barIndex < sortedBars.length && Date.parse(sortedBars[barIndex]!.timestamp) + 120000 <= capturedAt) {
      latestBar = sortedBars[barIndex]!;
      barIndex += 1;
    }
    return { ...snapshot, bar: latestBar };
  });
}

/** 正式回测专用读取；不参与盘前、盘中、盘后实时路径。区间语义为 [from, to)。 */
export async function readQqqGexBacktestHistoryPage(input: {
  policyId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  expiryDate?: string;
  includeProfile?: boolean;
  displayOnly?: boolean;
}): Promise<QqqGexBacktestHistoryPage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_BACKTEST_TIMEOUT_MS);
  try {
    const select = `captured_at, expiry_date, dte, spot, net_gex, gamma_flip, call_wall_price, call_wall_magnitude, put_wall_price, put_wall_magnitude, king_strike, king_magnitude, king_side${input.includeProfile ? ', profile' : ''}`;
    const offset = (input.page - 1) * input.pageSize;
    let snapshotQuery = supabaseAdmin.from('qqq_gex_expiry_snapshot')
      .select(select)
      .eq('symbol', 'QQQ')
      .eq('policy_id', input.policyId)
      .gte('captured_at', input.from)
      .lt('captured_at', input.to);
    if (input.expiryDate) snapshotQuery = snapshotQuery.eq('expiry_date', input.expiryDate);
    const snapshotResult = input.displayOnly && input.includeProfile
      ? await supabaseAdmin.rpc('qqq_gex_chart_page', {p_policy_id:input.policyId,p_from:input.from,p_to:input.to,
          p_expiry_date:input.expiryDate ?? null,p_offset:offset,p_limit:input.pageSize+1}).abortSignal(controller.signal)
      : await snapshotQuery
      .order('captured_at', { ascending: true })
      .order('expiry_date', { ascending: true })
      .range(offset, offset + input.pageSize)
      .abortSignal(controller.signal);
    if (snapshotResult.error) return null;

    const rawRows = (snapshotResult.data ?? []) as unknown as StoredGexBacktestRow[];
    const hasMore = rawRows.length > input.pageSize;
    const pageRows = rawRows.slice(0, input.pageSize);
    const snapshots = pageRows.flatMap((row) => {
      const parsed = parseStoredSnapshot(row, input.includeProfile === true);
      return parsed ? [parsed] : [];
    });
    if (!snapshots.length) return {
      available: true,
      range: { from: input.from, to: input.to, toExclusive: true },
      page: input.page,
      pageSize: input.pageSize,
      hasMore,
      nextPage: hasMore ? input.page + 1 : null,
      rejectedRows: pageRows.length,
      rejectedBars: 0,
      items: [],
    };

    const firstCapturedAt = snapshots[0]!.capturedAt;
    const lastCapturedAt = snapshots.at(-1)!.capturedAt;
    const candleSelect = 'bar_at, open, high, low, close, volume';
    const [windowBarsResult, predecessorResult] = await Promise.all([
      supabaseAdmin.from('qqq_intraday_candle').select(candleSelect)
        .eq('symbol', 'QQQ').eq('interval_seconds', 120)
        .gte('bar_at', firstCapturedAt).lte('bar_at', lastCapturedAt)
        .order('bar_at', { ascending: true }).abortSignal(controller.signal),
      supabaseAdmin.from('qqq_intraday_candle').select(candleSelect)
        .eq('symbol', 'QQQ').eq('interval_seconds', 120)
        .lt('bar_at', firstCapturedAt).order('bar_at', { ascending: false })
        .limit(1).abortSignal(controller.signal),
    ]);
    if (windowBarsResult.error || predecessorResult.error) return null;
    const rawBars = [
      ...((predecessorResult.data ?? []) as StoredCandleRow[]),
      ...((windowBarsResult.data ?? []) as StoredCandleRow[]),
    ];
    const bars = rawBars.flatMap((row) => {
      const parsed = parseStoredCandle(row);
      return parsed ? [parsed] : [];
    });
    return {
      available: true,
      range: { from: input.from, to: input.to, toExclusive: true },
      page: input.page,
      pageSize: input.pageSize,
      hasMore,
      nextPage: hasMore ? input.page + 1 : null,
      rejectedRows: pageRows.length - snapshots.length,
      rejectedBars: rawBars.length - bars.length,
      items: associateQqqGexSnapshotsWithCausalBars(snapshots, bars),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
