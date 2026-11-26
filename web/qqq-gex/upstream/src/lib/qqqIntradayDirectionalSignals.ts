import type { FactorMap } from '@/types/factor';
import { QQQ_INTRADAY_DIRECTIONAL_POLICY, type QqqIntradayDirectionalDecision } from '@/lib/engines/analysis/QqqIntradayDirectional';
import { supabaseAdmin } from './supabase';
import { confirmQqqDirectionalWrite } from './qqqDirectionalPersistence';

const ENGINE = 'qqq_intraday_directional';
const TIMEOUT_MS = 4_000;

const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isDecision = (value: unknown): value is QqqIntradayDirectionalDecision => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<QqqIntradayDirectionalDecision>;
  return candidate.policyVersion === QQQ_INTRADAY_DIRECTIONAL_POLICY.id
    && typeof candidate.status === 'string'
    && typeof candidate.structureId === 'string'
    && typeof candidate.alertType === 'string'
    && ('signalId' in candidate);
};

export async function readQqqIntradayDirectionalSignals(input: { from: string; to: string }): Promise<QqqIntradayDirectionalDecision[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const rows: Array<{ output?: unknown }> = [];
    for (let page = 0; ; page += 1) {
      const result = await supabaseAdmin.from('engine_signal_run')
        .select('bar_at, output')
        .eq('engine', ENGINE)
        .gte('bar_at', input.from).lt('bar_at', input.to)
        .order('bar_at', { ascending: true })
        .range(page * 1_000, (page + 1) * 1_000 - 1)
        .abortSignal(controller.signal);
      if (result.error) return null;
      rows.push(...((result.data ?? []) as Array<{ output?: unknown }>));
      if ((result.data ?? []).length < 1_000) break;
    }
    return rows.flatMap((row) => isDecision(row.output) ? [row.output] : []);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function appendQqqIntradayDirectionalSignal(input: {
  decision: QqqIntradayDirectionalDecision;
  factors: FactorMap;
}): Promise<boolean> {
  if (!input.decision.signalId || !input.decision.structureId || !input.decision.alertType || !input.decision.anchorBar || !['ALERT_LONG', 'ALERT_SHORT'].includes(input.decision.status)) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const directionalFactors = Object.fromEntries(Object.entries(input.factors).filter(([id]) => id.startsWith('qqq_dir_')));
    const result = await supabaseAdmin.from('engine_signal_run').upsert({
      engine: ENGINE,
      bar_at: input.decision.anchorBar,
      factors: jsonSafe(directionalFactors),
      output: jsonSafe(input.decision),
      blocked: false,
      reasons: input.decision.reasonCodes,
    }, { onConflict: 'engine,bar_at', ignoreDuplicates: true }).select('output').abortSignal(controller.signal);
    if (result.error) return false;
    return await confirmQqqDirectionalWrite(input.decision.signalId,result.data,async()=>{
      const existing=await supabaseAdmin.from('engine_signal_run').select('output').eq('engine',ENGINE)
        .eq('bar_at',input.decision.anchorBar!).limit(1).abortSignal(controller.signal);
      if(existing.error)throw Error('Directional write verification unavailable');
      return existing.data;
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
