import { readQqqIntradayContext } from '@/lib/qqqIntradayContext';
import { qqqEasternDateKey, qqqMarketDateBounds } from '@/lib/qqqMarketDate';
import { createResponseCache, canonicalJsonRequestKey } from '@/lib/responseCache';
const responses = createResponseCache({ maxEntries: 8, maxBytes: 8 * 1024 * 1024 });
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, date = params.get('date') ?? '', dte = Number(params.get('dte') ?? '0'), include = params.get('include') ?? 'all';
  try { qqqMarketDateBounds(date); } catch { return Response.json({ error: '请选择有效日期' }, { status: 400 }); }
  const today = qqqEasternDateKey(Date.now());
  if (date > today || !Number.isInteger(dte) || dte < 0 || dte > 60) return Response.json({ error: '日期不得晚于今天，DTE 需为 0–60 的整数' }, { status: 400 });
  if (include !== 'all' && include !== 'volume') return Response.json({ error: '无效历史参考范围' }, { status: 400 });
  return responses.run(canonicalJsonRequestKey({ date, dte, include }), async () => {
    try { return Response.json(await readQqqIntradayContext(date, dte, include)); }
    catch { return Response.json({ error: '历史参考暂不可用，请重试' }, { status: 503 }); }
  }, 30_000, request.headers.get('if-none-match'));
}
