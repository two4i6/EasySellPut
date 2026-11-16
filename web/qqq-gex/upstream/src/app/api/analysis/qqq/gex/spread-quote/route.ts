import { supabaseAdmin } from '@/lib/supabase';
import { qqqMarketDateBounds } from '@/lib/qqqMarketDate';
import { qqqDirectionalGexTime } from '@/lib/qqqDirectionalGexTime';
import { createResponseCache, canonicalJsonRequestKey } from '@/lib/responseCache';
import type { PcsFullGexProfile } from '@/types/qqqGex';
const responses = createResponseCache({ maxEntries: 64, maxBytes: 2 * 1024 * 1024 });
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, date = params.get('date') ?? '', expiry = params.get('expiry') ?? '', cutoff = Date.parse(params.get('at') ?? ''), short = Number(params.get('short')), long = Number(params.get('long'));
  let from: number, to: number;
  try { const bounds = qqqMarketDateBounds(date); from = Date.parse(bounds.from); to = Date.parse(bounds.to); qqqMarketDateBounds(expiry); } catch { return Response.json({ error: '日期无效' }, { status: 400 }); }
  if (!Number.isFinite(cutoff) || cutoff < from || cutoff >= to || cutoff > Date.now() || expiry < date || !Number.isFinite(short) || !Number.isFinite(long) || short <= 0 || long <= 0 || short === long) return Response.json({ error: '报价时间或行权价无效' }, { status: 400 });
  return responses.run(canonicalJsonRequestKey({ date, expiry, cutoff, short, long }), async () => {
    const result = await supabaseAdmin.from('qqq_gex_expiry_snapshot').select('captured_at,profile')
      .eq('symbol', 'QQQ').eq('policy_id', 'qqq-pcs-intraday-v1').eq('expiry_date', expiry)
      .gte('captured_at', new Date(Math.max(from, cutoff - 300_000)).toISOString()).lte('captured_at', new Date(cutoff).toISOString())
      .order('captured_at', { ascending: false }).limit(3).abortSignal(AbortSignal.timeout(8000));
    if (result.error) return Response.json({ error: '双腿历史报价暂不可用' }, { status: 503 });
    const candidates = (result.data ?? []).flatMap(row => {
      const profile = Array.isArray(row.profile) ? row.profile as PcsFullGexProfile[] : [];
      const time = Date.parse(qqqDirectionalGexTime(row.captured_at, null, profile));
      return time <= cutoff && time >= cutoff - 300_000 ? [{ time, profile: profile.filter(point => point.strike === short || point.strike === long) }] : [];
    }).sort((a, b) => b.time - a.time);
    return Response.json({ date, expiry, cutoff, time: candidates[0]?.time ?? null, profile: candidates[0]?.profile ?? [] });
  }, 30_000, request.headers.get('if-none-match'));
}
