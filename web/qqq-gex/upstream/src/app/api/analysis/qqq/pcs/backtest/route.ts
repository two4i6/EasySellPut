import { NextResponse } from 'next/server';
import {createResponseCache} from '@/lib/responseCache';
import { readQqqGexBacktestHistoryPage, readQqqGexCaptureDateIndex, readQqqGexExpiryIndex } from '@/lib/qqqGexBacktestHistory';
import { readQqqIntradayBacktestHistoryPage } from '@/lib/qqqIntradayBacktestHistory';
import { validateQqqIntradayDirectional } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import { readQqqIntradayDirectionalReplay } from '@/lib/qqqIntradayDirectionalReplayHistory';
import { aggregateQqqIntradayDirectionalDailySummaries, readQqqIntradayDirectionalDailySummaries } from '@/lib/qqqIntradayDirectionalSummary';

export const runtime='nodejs';
export const maxDuration=300;
export {POST,DELETE} from '../../backtest/route';
const QQQ_GEX_BACKTEST_POLICY = 'qqq-pcs-intraday-v1';
const QQQ_GEX_BACKTEST_DEFAULT_PAGE_SIZE = 100;
const QQQ_GEX_BACKTEST_MAX_PAGE_SIZE = 200;

export type QqqGexBacktestHistoryOptions = {
  stream: 'gex' | 'bars' | 'dates' | 'signals' | 'expiries';
  policyId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  expiryDate?: string;
  includeProfile: boolean;
  displayOnly?: boolean;
};

export function parseQqqGexBacktestHistoryOptions(url: string | URL): { ok: true; value: QqqGexBacktestHistoryOptions } | { ok: false; error: string } {
  const params = new URL(url).searchParams;
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  if (!rawFrom || !rawTo) return { ok: false, error: 'from 和 to 为必填 ISO 时间' };
  const fromDate = new Date(rawFrom);
  const toDate = new Date(rawTo);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return { ok: false, error: 'from 或 to 不是有效时间' };
  if (fromDate.getTime() >= toDate.getTime()) return { ok: false, error: 'from 必须早于 to；区间采用 [from, to)' };
  const rawPage = params.get('page');
  const rawPageSize = params.get('pageSize');
  const rawStream = params.get('stream');
  if (rawStream !== null && rawStream !== 'gex' && rawStream !== 'bars' && rawStream !== 'dates' && rawStream !== 'signals' && rawStream !== 'expiries') return { ok: false, error: 'stream 只能是 gex、bars、dates、signals 或 expiries' };
  const page = rawPage === null ? 1 : Number(rawPage);
  const pageSize = rawPageSize === null ? QQQ_GEX_BACKTEST_DEFAULT_PAGE_SIZE : Number(rawPageSize);
  if (!Number.isInteger(page) || page < 1) return { ok: false, error: 'page 必须是从 1 开始的整数' };
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > QQQ_GEX_BACKTEST_MAX_PAGE_SIZE) return { ok: false, error: `pageSize 必须是 1–${QQQ_GEX_BACKTEST_MAX_PAGE_SIZE} 的整数` };
  const expiryDate = params.get('expiryDate') ?? undefined;
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return { ok: false, error: 'expiryDate 必须是 YYYY-MM-DD' };
  return {
    ok: true,
    value: {
      stream: rawStream === 'bars' ? 'bars' : rawStream === 'dates' ? 'dates' : rawStream === 'signals' ? 'signals' : rawStream === 'expiries' ? 'expiries' : 'gex',
      policyId: QQQ_GEX_BACKTEST_POLICY,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      page,
      pageSize,
      ...(expiryDate ? { expiryDate } : {}),
      includeProfile: params.get('includeProfile') === '1' || params.get('includeProfile') === 'true',
      ...(params.get('displayOnly') === '1' ? {displayOnly:true} : {}),
    },
  };
}

/** 正式回测历史数据页；与 PCS 盘前/盘中/盘后 GET 路径完全隔离。 */
const historyResponseCache = createResponseCache();
export async function GET(request: Request) {
  const parsed = parseQqqGexBacktestHistoryOptions(request.url);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  // Use normalized query values, never the raw URL/parameter ordering.
  const key = JSON.stringify(parsed.value);
  return historyResponseCache.run(key, () => runHistoryGet(request), 30_000, request.headers.get('if-none-match'), false, request.headers.get('accept-encoding'));
}

async function runHistoryGet(request: Request) {
  const parsed = parseQqqGexBacktestHistoryOptions(request.url);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.value.stream === 'expiries') {
    const index = await readQqqGexExpiryIndex(parsed.value);
    if (!index) return NextResponse.json({ error: '历史到期日索引不可用' }, { status: 503 });
    return NextResponse.json(index);
  }
  if (parsed.value.stream === 'dates') {
    const dates = await readQqqGexCaptureDateIndex(parsed.value);
    if (!dates) return NextResponse.json({ error: 'GEX 日期索引不可用' }, { status: 503 });
    return NextResponse.json(dates, { headers: { 'cache-control': 'no-store' } });
  }
  if (parsed.value.stream === 'bars') {
    const barsPage = await readQqqIntradayBacktestHistoryPage(parsed.value);
    if (!barsPage) return NextResponse.json({ error: '历史 K 线缓存不可用，正式回测不得回退到实时数据' }, { status: 503 });
    return NextResponse.json(barsPage, { headers: { 'cache-control': 'no-store' } });
  }
  if (parsed.value.stream === 'signals') {
    const spanMs = Date.parse(parsed.value.to) - Date.parse(parsed.value.from);
    let result: Awaited<ReturnType<typeof readQqqIntradayDirectionalReplay>>;
    if (spanMs <= 32 * 24 * 60 * 60_000) {
      result = await readQqqIntradayDirectionalReplay(parsed.value);
    } else {
      const summaries = await readQqqIntradayDirectionalDailySummaries({ policyId: QQQ_GEX_BACKTEST_POLICY, from: parsed.value.from.slice(0, 10), to: parsed.value.to.slice(0, 10) });
      const replay = summaries ? aggregateQqqIntradayDirectionalDailySummaries(summaries) : null;
      result = replay ? { replay, repeatedFingerprint: replay.fingerprint } : null;
    }
    if (!result) return NextResponse.json({ error: spanMs > 32 * 24 * 60 * 60_000 ? '历史方向摘要尚未由盘后 cron 完成，暂不能扩展到 32 天以上' : '方向信号原始数据不可用；禁止用实时或未来数据回填' }, { status: 503 });
    const validation = validateQqqIntradayDirectional(result.replay, result.repeatedFingerprint);
    const offset = (parsed.value.page - 1) * parsed.value.pageSize;
    const items = result.replay.signals.slice(offset, offset + parsed.value.pageSize);
    return NextResponse.json({
      available: true,
      range: { from: parsed.value.from, to: parsed.value.to, toExclusive: true },
      policyVersion: result.replay.policyVersion,
      discovery: true,
      source: spanMs > 32 * 24 * 60 * 60_000 ? 'DAILY_SUMMARY' : 'RAW_REPLAY',
      fingerprint: result.replay.fingerprint,
      repeatedFingerprint: result.repeatedFingerprint,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
      hasMore: offset + parsed.value.pageSize < result.replay.signals.length,
      totalSignals: result.replay.signals.length,
      completeDays: result.replay.completeDays,
      signalDays: result.replay.signalDays,
      dailyCoverageRate: result.replay.dailyCoverageRate,
      gradeStats: result.replay.gradeStats,
      opportunityStats: result.replay.opportunityStats,
      lifecycleStats: result.replay.lifecycleStats,
      groupedStats: result.replay.groupedStats,
      riskStats: result.replay.riskStats,
      sessionStats: result.replay.sessionStats,
      funnel: result.replay.funnel,
      dailyStats: result.replay.dailyStats,
      validation,
      items,
    }, { headers: { 'cache-control': 'no-store' } });
  }
  const page = await readQqqGexBacktestHistoryPage(parsed.value);
  if (!page) return NextResponse.json({ error: '历史 GEX/K 线缓存不可用，正式回测不得回退到未来或实时数据' }, { status: 503 });
  return NextResponse.json(page, { headers: { 'cache-control': 'no-store' } });
}
