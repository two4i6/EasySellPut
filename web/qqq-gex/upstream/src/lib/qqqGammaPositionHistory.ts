import { supabaseAdmin } from './supabase';
import { buildQqqGammaPositionHistory } from './qqqGammaPosition';
import type { QqqGammaPositionLevel } from './qqqGammaPosition';
import type { GammaModelStrike } from './qqqGammaModel';
import { QQQ_GAMMA_INPUT_VERSION, QQQ_VOLATILITY_TRIGGER_POLICY } from './qqqGammaModel';
import { easternDayStartUtc } from './engineTimeline';
import { qqqMarketSession } from './qqqMarketSession';
import {readQqqGammaSource,isChartSourceRolloutMissing} from './qqqChartSource';
import {qqqMarketDateBounds} from './qqqMarketDate';

const sessions = new Map<string, QqqGammaPositionLevel[]>();
type Row = { captured_at: string; spot: number; profile: GammaModelStrike[] };

/** Revisions invalidate the full session, including corrected earlier captures.
 * The changing request cutoff is not a DB revision and must not defeat reuse. */
export async function readQqqGammaPositionHistory(input: { expiryDate: string; from: string; to: string; policyId: string; revision?: string }) {
  const cutoff = Date.parse(input.to);
  if(!Number.isFinite(cutoff)||!Number.isFinite(Date.parse(input.from)))throw Error('Gamma 历史时间范围无效');
  // `to` is an exclusive DB bound. Midnight belongs to the previous
  // requested session, not the following day's full history.
  const day=qqqMarketSession(new Date(cutoff-1)).date;
  const readTo=easternDayStartUtc(new Date(Date.parse(day+'T12:00:00Z')+86400000)).toISOString();
  const key = `${QQQ_GAMMA_INPUT_VERSION}:${QQQ_VOLATILITY_TRIGGER_POLICY.version}:${input.policyId}:${input.expiryDate}:${input.from}:${readTo}:${input.revision}`;
  const cached = input.revision !== undefined ? sessions.get(key) : undefined;
  if (cached) return cached.filter(point => Date.parse(point.time) <= cutoff);
  if(input.policyId==='qqq-pcs-intraday-v1'&&Date.parse(input.from)>=Date.parse(qqqMarketDateBounds(day).from)){
    try {
      const source=await readQqqGammaSource(day,input.expiryDate);
      const points=buildQqqGammaPositionHistory(input.expiryDate,source.rows.filter(row=>Date.parse(row.captured_at)>=Date.parse(input.from)).map(row=>({time:row.captured_at,spot:row.spot,strikes:row.profile as GammaModelStrike[]})));
      if(input.revision!==undefined)sessions.set(key,points);
      while(sessions.size>8)sessions.delete(sessions.keys().next().value!);
      return points.filter(point=>Date.parse(point.time)<=cutoff);
    }catch(error){if(!isChartSourceRolloutMissing(error))throw error;}
  }
  const result = await supabaseAdmin.rpc('qqq_gamma_position_history', {
    p_policy_id: input.policyId, p_expiry_date: input.expiryDate, p_from: input.from, p_to: readTo,
  }).abortSignal(AbortSignal.timeout(10_000));
  let rows: Row[];
  if (!result.error && Array.isArray(result.data)) rows = result.data;
  else if (result.error?.code === 'PGRST202' || result.error?.code === '42883') {
    // Compatibility during rollout; this avoids the known heavy aggregate RPC.
    const fallback = await supabaseAdmin.from('qqq_gex_expiry_snapshot').select('captured_at,spot,profile')
      .eq('symbol','QQQ').eq('policy_id',input.policyId).eq('expiry_date',input.expiryDate)
      .gte('captured_at',input.from).lt('captured_at',readTo).order('captured_at')
      .abortSignal(AbortSignal.timeout(10_000));
    if (fallback.error) throw Error('Gamma 历史读取失败，保留已加载曲线');
    rows = (fallback.data ?? []) as Row[];
  } else throw Error('Gamma 历史读取失败，保留已加载曲线');
  const points = buildQqqGammaPositionHistory(input.expiryDate, rows.map(row => ({
    time: row.captured_at, spot: row.spot, strikes: Array.isArray(row.profile) ? row.profile : [],
  })));
  // Never cache a failure as successful empty history.
  if (input.revision !== undefined) sessions.set(key, points);
  while (sessions.size > 8) sessions.delete(sessions.keys().next().value!);
  return points.filter(point => Date.parse(point.time) <= cutoff);
}
