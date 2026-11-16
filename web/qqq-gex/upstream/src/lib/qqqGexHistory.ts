import type { QqqLifecycleFactor } from './qqqLifecycleFactors';
import { supabaseAdmin } from './supabase';
import { createSuccessfulWriteCache } from './successfulWriteCache';
import { qqqStoredGexTiming, QQQ_GEX_TIMING_SELECT } from './qqqDirectionalGexTime';
import { qqqSessionForDate } from './qqqMarketSession';
import { decodeQqqDirectionalGexProfile } from './qqqDirectionalGexTransport';
import { readConsistentQqqGex,type QqqReadRpc } from './qqqGexReadConsistency';
import { decodeQqqLatestSnapshotProfile } from './qqqLatestSnapshotTransport';
import { easternDayStartUtc } from './engineTimeline';
import { qqqEasternDateKey as easternDateKey } from './qqqMarketDate';

const QQQ_GEX_HISTORY_TIMEOUT_MS = 4_000;
const QQQ_GEX_DEBUG = process.env.QQQ_GEX_DEBUG === '1';
const writeGexSnapshots = createSuccessfulWriteCache();
const writeLifecycleSnapshots = createSuccessfulWriteCache({ maxEntries: 2048, ttlMs: 5 * 60_000 });
const retainedLifecycleHistories = new Map<string, QqqPcsLifecycleHistory<unknown>>();

function qqqGexDebug(event: string, details: Record<string, unknown>) {
  if (QQQ_GEX_DEBUG) console.info('[DEBUG-QQQ-GEX-SUPABASE]', event, details);
}

function qqqGexError(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined) {
  return error ? { code: error.code ?? null, message: error.message ?? 'unknown', details: error.details ?? null, hint: error.hint ?? null } : null;
}

function qqqGexException(error: unknown) {
  return { name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : 'unknown' };
}

export type CompactGexStrike = {
  quoteTiming?: ReturnType<typeof import('./qqqQuoteTiming').qqqQuoteTiming>;
  calculationVersion?: string;
  gexUnit?: 'per-point' | 'per-1pct';
  inputComplete?: boolean;
  computedAt?: string;
  sourceAsOf?: string;
  strike: number;
  callGex: number;
  putGex: number;
  totalGex: number;
  callOiProvenance?: import('@/types/ivCurve').OptionContract['oiProvenance'];
  putOiProvenance?: import('@/types/ivCurve').OptionContract['oiProvenance'];
  callOi?: number;
  putOi?: number;
  callVolume?: number;
  putVolume?: number;
  callBid?: number;
  callAsk?: number;
  callMid?: number;
  callLast?: number;
  callIv?: number;
  callDelta?: number;
  callGamma?: number;
  callTheta?: number;
  callVega?: number;
  putBid?: number;
  putAsk?: number;
  putMid?: number;
  putLast?: number;
  putIv?: number;
  putDelta?: number;
  putGamma?: number;
  putTheta?: number;
  putVega?: number;
  callReceivedAt?: string;
  putReceivedAt?: string;
  callLastTradeAt?: string;
  putLastTradeAt?: string;
  isCallWall: boolean;
  isPutWall: boolean;
  isGammaFlip: boolean;
};

export type CompactGexExpirySnapshot = {
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

type StoredRow = {
  computed_at?: string | null;
  source_as_of?: string | null;
  calculation_version?: string | null;
  input_complete?: boolean | string | null;
  captured_at: string;
  received_at?: string | null;
  put_received_at?: string | null;
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
  packed_profile?: unknown;
};

export type QqqGexExpiryHistory = {
  summary: Array<Omit<CompactGexExpirySnapshot, 'profile'> & { profile?:CompactGexStrike[]; time: string; availableAt?: string; sourceAsOf?: string; calculationVersion?: string; inputComplete?: boolean }>;
  profiles: Array<{ time: string; strikes: CompactGexStrike[]; strikeCoverage?: 'full' | 'top8' }>;
};

/** One immutable capture bucket across all tracked expiries. */
export type QqqLatestGexExpirySnapshot = Omit<CompactGexExpirySnapshot, 'profile'> & {
  capturedAt: string;
  profile: CompactGexStrike[];
};

export type QqqPcsLifecycleHistory<Contract = { status: 'READY'; expiry: string; daysToExpiration: number; sigma: number; shortStrike: number; longStrike: number; netCredit: number; annualizedReturn: number } | { status: 'UNAVAILABLE'; reason: string } | null> = {
  available: boolean;
  points: Array<{
    time: string;
    score: number;
    timing: 'NOW' | 'WAIT_PULLBACK' | 'WAIT_CONFIRM' | 'NO_ENTRY_SIGNAL' | 'INSUFFICIENT_DATA';
    contract: Contract;
    executionFactors?: QqqLifecycleFactor[];
  }>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const easternCalendarParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value])) as Record<string, string>;

const shiftCalendarDate = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const easternLocalTimeUtc = (dateKey: string, hour: number, minute = 0) => {
  const targetParts = dateKey.split('-').map(Number);
  const targetPseudoUtc = Date.UTC(targetParts[0]!, targetParts[1]! - 1, targetParts[2]!, hour, minute);
  let utc = targetPseudoUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = easternCalendarParts(new Date(utc));
    const representedPseudoUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    utc += targetPseudoUtc - representedPseudoUtc;
  }
  return new Date(utc);
};

/** Upper bound for frozen reads: never let a closed-session capture outrank the last completed regular close. */
export function latestCompletedQqqRegularClose(now: Date) {
  const parts = easternCalendarParts(now);
  let dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const clock = Number(parts.hour) * 60 + Number(parts.minute);
  const today = qqqSessionForDate(dateKey);
  if (!today.trading || clock < today.stockCloseMinute) dateKey = shiftCalendarDate(dateKey, -1);
  while (!qqqSessionForDate(dateKey).trading) dateKey = shiftCalendarDate(dateKey, -1);
  const close = qqqSessionForDate(dateKey).stockCloseMinute;
  return easternLocalTimeUtc(dateKey, Math.floor(close / 60), close % 60);
}

/** Calendar DTE belongs to the viewing date; the GEX values remain frozen at captured_at. */
export function qqqSnapshotDteAt(expiryDate: string, now: Date) {
  const parts = easternCalendarParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const expiry = Date.parse(`${expiryDate}T00:00:00.000Z`);
  const current = Date.parse(`${today}T00:00:00.000Z`);
  return Number.isFinite(expiry) && Number.isFinite(current) ? Math.round((expiry - current) / 86_400_000) : Number.NaN;
}

/** Reject Yahoo option snapshots whose persisted strike distribution is entirely zero. */
export function usableStoredGexSnapshot(row: StoredRow) {
  const profile = compactGexProfile(Array.isArray(row.profile) ? row.profile : []);
  return typeof row.captured_at === 'string'
    && typeof row.expiry_date === 'string'
    && isFiniteNumber(row.dte)
    && isFiniteNumber(row.spot) && row.spot > 0
    && isFiniteNumber(row.net_gex)
    && profile.some((point) => Math.abs(point.totalGex) > 1e-9);
}

export function compactGexProfile(profile: CompactGexStrike[]): CompactGexStrike[] {
  return profile.flatMap((point) => isFiniteNumber(point.strike) && point.strike > 0
    && [point.callGex, point.putGex, point.totalGex].every(isFiniteNumber)
    ? [{
        ...(typeof point.calculationVersion === 'string' ? { calculationVersion: point.calculationVersion } : {}),
        ...(point.gexUnit === 'per-1pct' || point.gexUnit === 'per-point' ? { gexUnit: point.gexUnit } : {}),
        ...(typeof point.inputComplete === 'boolean' ? { inputComplete: point.inputComplete } : {}),
        strike: point.strike, callGex: point.callGex, putGex: point.putGex, totalGex: point.totalGex,
        ...(point.quoteTiming?.policy==='qqq-quote-timing-v1'?{quoteTiming:point.quoteTiming}:{}),
        ...(isFiniteNumber(point.callOi) ? { callOi: point.callOi } : {}),
        ...(isFiniteNumber(point.putOi) ? { putOi: point.putOi } : {}),
        ...(isFiniteNumber(point.callVolume) ? { callVolume: point.callVolume } : {}),
        ...(isFiniteNumber(point.putVolume) ? { putVolume: point.putVolume } : {}),
        ...(isFiniteNumber(point.callBid) ? { callBid: point.callBid } : {}),
        ...(isFiniteNumber(point.callAsk) ? { callAsk: point.callAsk } : {}),
        ...(isFiniteNumber(point.callMid) ? { callMid: point.callMid } : {}),
        ...(isFiniteNumber(point.callLast) ? { callLast: point.callLast } : {}),
        ...(isFiniteNumber(point.callIv) ? { callIv: point.callIv } : {}),
        ...(isFiniteNumber(point.callDelta) ? { callDelta: point.callDelta } : {}),
        ...(isFiniteNumber(point.callGamma) ? { callGamma: point.callGamma } : {}),
        ...(isFiniteNumber(point.callTheta) ? { callTheta: point.callTheta } : {}),
        ...(isFiniteNumber(point.callVega) ? { callVega: point.callVega } : {}),
        ...(isFiniteNumber(point.putBid) ? { putBid: point.putBid } : {}),
        ...(isFiniteNumber(point.putAsk) ? { putAsk: point.putAsk } : {}),
        ...(isFiniteNumber(point.putMid) ? { putMid: point.putMid } : {}),
        ...(isFiniteNumber(point.putLast) ? { putLast: point.putLast } : {}),
        ...(isFiniteNumber(point.putIv) ? { putIv: point.putIv } : {}),
        ...(isFiniteNumber(point.putDelta) ? { putDelta: point.putDelta } : {}),
        ...(isFiniteNumber(point.putGamma) ? { putGamma: point.putGamma } : {}),
        ...(isFiniteNumber(point.putTheta) ? { putTheta: point.putTheta } : {}),
        ...(isFiniteNumber(point.putVega) ? { putVega: point.putVega } : {}),
        ...(point.callOiProvenance ? {callOiProvenance:point.callOiProvenance} : {}),
        ...(point.putOiProvenance ? {putOiProvenance:point.putOiProvenance} : {}),
        ...Object.fromEntries(['callReceivedAt', 'putReceivedAt', 'callLastTradeAt', 'putLastTradeAt', 'computedAt', 'sourceAsOf'].flatMap(key => {
          const value = (point as unknown as Record<string, unknown>)[key];
          return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? [[key, value]] : [];
        })),
        isCallWall: point.isCallWall === true, isPutWall: point.isPutWall === true, isGammaFlip: point.isGammaFlip === true,
      }]
    : []);
}

/**
 * GEX profiles are display-only history. They deliberately bypass
 * engine_minute_bar so PCS lifecycle reads never deserialize every strike.
 */
export async function appendQqqGexExpirySnapshots(input: {
  policyId: string;
  capturedAt: string;
  expiries: CompactGexExpirySnapshot[];
}): Promise<boolean> {
  if (!input.expiries.length) return true;
  return writeGexSnapshots(input.expiries, expiry => `${input.policyId}|${input.capturedAt}|${expiry.expiryDate}`,
    expiries => persistQqqGexExpirySnapshots({ ...input, expiries }));
}

async function persistQqqGexExpirySnapshots(input: {
  policyId: string; capturedAt: string; expiries: CompactGexExpirySnapshot[];
}): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_HISTORY_TIMEOUT_MS);
  try {
    const rows = input.expiries.map((expiry) => ({
      symbol: 'QQQ', policy_id: input.policyId, captured_at: input.capturedAt,
      expiry_date: expiry.expiryDate, dte: expiry.dte, spot: expiry.spot,
      net_gex: expiry.netGex, gamma_flip: expiry.gammaFlip,
      call_wall_price: expiry.callWallPrice, call_wall_magnitude: expiry.callWallMagnitude,
      put_wall_price: expiry.putWallPrice, put_wall_magnitude: expiry.putWallMagnitude,
      king_strike: expiry.kingStrike, king_magnitude: expiry.kingMagnitude, king_side: expiry.kingSide,
      profile: compactGexProfile(expiry.profile),
    }));
    const { error } = await supabaseAdmin.from('qqq_gex_expiry_snapshot')
      .upsert(rows, { onConflict: 'symbol,policy_id,captured_at,expiry_date', ignoreDuplicates: true })
      .abortSignal(controller.signal);
    if (error) {
      console.warn('[QqqGexHistory] snapshot write unavailable', { ...qqqGexError(error), policyId: input.policyId, capturedAt: input.capturedAt, expiryCount: rows.length });
      return false;
    }
    qqqGexDebug('snapshot_write_ok', { policyId: input.policyId, capturedAt: input.capturedAt, expiryCount: rows.length, profilePoints: rows.reduce((sum, row) => sum + row.profile.length, 0) });
    return true;
  } catch (error) {
    console.warn('[QqqGexHistory] snapshot write aborted', { ...qqqGexException(error), policyId: input.policyId, capturedAt: input.capturedAt, expiryCount: input.expiries.length });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readQqqGexExpiryHistory(input: {
  policyId: string;
  expiryDate: string;
  from: string;
  profileFrom: string;
  to?: string;
  displayOnly?: boolean;
}): Promise<QqqGexExpiryHistory | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_HISTORY_TIMEOUT_MS);
  try {
    qqqGexDebug('history_read_start', { policyId: input.policyId, expiryDate: input.expiryDate, from: input.from, profileFrom: input.profileFrom });
    const windowArgs = {
      p_policy_id: input.policyId, p_expiry_date: input.expiryDate, p_from: input.from,
      p_profile_from: input.profileFrom, p_to: input.to ?? 'infinity', p_display_only: input.displayOnly === true,
    };
    let combined = await supabaseAdmin.rpc('qqq_gex_history_window_v2',windowArgs).abortSignal(controller.signal);
    if(combined.error && ['PGRST202','42883'].includes(combined.error.code))combined=await supabaseAdmin.rpc('qqq_gex_history_window',windowArgs).abortSignal(controller.signal);
    let summaryResult: {data: unknown; error: any}, profileResult: {data: unknown; error: any};
    if (!combined.error && combined.data && Array.isArray(combined.data.summary) && Array.isArray(combined.data.profiles)) {
      summaryResult = {data: combined.data.summary, error: null}; profileResult = {data: combined.data.profiles, error: null};
    } else if (combined.error?.code === 'PGRST202' || combined.error?.code === '42883') {
    const compatibilityRpc:QqqReadRpc=async(name,args)=>{
      const result=await supabaseAdmin.rpc(name,args).abortSignal(controller.signal);
      if(result.error)throw Error('History compatibility revision unavailable');return result.data;
    };
    const fallback=await readConsistentQqqGex(compatibilityRpc,{
      policyId:input.policyId,expiryDates:[input.expiryDate],
      from:new Date(Math.min(Date.parse(input.from),Date.parse(input.profileFrom))).toISOString(),
      to:input.to?new Date(Date.parse(input.to)+1).toISOString():'infinity',
    },async()=>{
      const read=async(kind:'summary'|'profile')=>{
        const rows:StoredRow[]=[];let after:string|null=null;
        for(;;){
          let query=supabaseAdmin.from('qqq_gex_expiry_snapshot')
            .select(kind==='summary'?`captured_at,expiry_date,dte,spot,net_gex,gamma_flip,call_wall_price,call_wall_magnitude,put_wall_price,put_wall_magnitude,king_strike,king_magnitude,king_side,${QQQ_GEX_TIMING_SELECT}`:'captured_at,profile')
            .setHeader('cache-control','no-cache').eq('symbol','QQQ').eq('policy_id',input.policyId).eq('expiry_date',input.expiryDate)
            .gte('captured_at',kind==='summary'?input.from:input.profileFrom);
          if(input.to)query=query.lte('captured_at',input.to);if(after)query=query.gt('captured_at',after);
          const result=await query.order('captured_at',{ascending:true}).limit(32).abortSignal(controller.signal);
          if(result.error||!Array.isArray(result.data)||result.data.length>32)throw Error('History compatibility page unavailable');
          for(const row of result.data as unknown as StoredRow[]){
            if(!row||typeof row.captured_at!=='string'||!Number.isFinite(Date.parse(row.captured_at))||(after!==null&&Date.parse(row.captured_at)<=Date.parse(after)))throw Error('Invalid history compatibility cursor');
            after=row.captured_at;rows.push(row);
          }
          if(result.data.length<32)return rows;
        }
      };
      const [summary,profiles]=await Promise.all([read('summary'),read('profile')]);return {summary,profiles};
    },controller.signal);
    summaryResult={data:fallback.summary,error:null};profileResult={data:fallback.profiles,error:null};
    } else {
      console.warn('[QqqGexHistory] window RPC unavailable', qqqGexError(combined.error));
      return null;
    }
    if (summaryResult.error || profileResult.error) {
      console.warn('[QqqGexHistory] history read unavailable', {
        policyId: input.policyId,
        expiryDate: input.expiryDate,
        summaryError: qqqGexError(summaryResult.error),
        profileError: qqqGexError(profileResult.error),
      });
      return null;
    }
    const summary = ((summaryResult.data ?? []) as StoredRow[]).flatMap((row) => isFiniteNumber(row.net_gex)
      ? [{ ...qqqStoredGexTiming(row), availableAt: qqqStoredGexTiming(row).time, time: row.captured_at, expiryDate: row.expiry_date, dte: row.dte, spot: row.spot, netGex: row.net_gex, gammaFlip: row.gamma_flip, callWallPrice: row.call_wall_price, callWallMagnitude: row.call_wall_magnitude, putWallPrice: row.put_wall_price, putWallMagnitude: row.put_wall_magnitude, kingStrike: row.king_strike, kingMagnitude: row.king_magnitude, kingSide: row.king_side }]
      : []);
    const profiles = ((profileResult.data ?? []) as StoredRow[]).map((row) => ({ time: row.captured_at, strikes: compactGexProfile(Array.isArray(row.profile) ? row.profile : []) }));
    if (!summary.length && !profiles.length) console.warn('[QqqGexHistory] history read returned no rows', { policyId: input.policyId, expiryDate: input.expiryDate, from: input.from, profileFrom: input.profileFrom });
    qqqGexDebug('history_read_ok', { policyId: input.policyId, expiryDate: input.expiryDate, summaryRows: summary.length, profileRows: profiles.length, profilePoints: profiles.reduce((sum, row) => sum + row.strikes.length, 0) });
    return { summary, profiles };
  } catch (error) {
    console.warn('[QqqGexHistory] history read aborted', { ...qqqGexException(error), policyId: input.policyId, expiryDate: input.expiryDate });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const QQQ_GEX_SUMMARY_PAGE_SIZE = 32;
// Full-day evidence is independent of the first screen. Its bounded pages need
// enough transport time on a cold connection; cap parallel expiry scans at two.
const QQQ_GEX_SUMMARY_TIMEOUT_MS = 8_000;
const QQQ_GEX_SUMMARY_SELECT = 'captured_at,expiry_date,dte,spot,net_gex,gamma_flip,call_wall_price,call_wall_magnitude,put_wall_price,put_wall_magnitude,king_strike,king_magnitude,king_side,profile';

/** Drain both workers even when one expiry fails; never leak sibling rejections. */
async function readQqqSummaryExpiries<T>(expiries: string[], read: (expiry: string) => Promise<T>, onFailure: () => void): Promise<T[]> {
  const values: T[] = new Array(expiries.length);
  let cursor = 0;
  let failure: unknown;
  let failed = false;
  const workers = Array.from({ length: Math.min(2, expiries.length) }, async () => {
    while (!failed && cursor < expiries.length) {
      const index = cursor++;
      try { values[index] = await read(expiries[index]!); }
      catch (error) { failed = true; failure = error; onFailure(); }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
  return values;
}

/** Indexed pages retain every causal bucket and its full strike distribution. */
export async function readQqqGexExpirySummaries(input: {
  policyId: string;
  expiryDates: string[];
  from: string;
  to?: string;
}): Promise<Map<string, QqqGexExpiryHistory['summary']> | null> {
  const expiryDates = [...new Set(input.expiryDates)].slice(0, 4);
  if (!expiryDates.length) return new Map();
  const controller = new AbortController();
  try {
    const revisionRpc:QqqReadRpc=async(name,args,signal)=>{
      const result=await supabaseAdmin.rpc(name,args).abortSignal(AbortSignal.any([controller.signal,signal??controller.signal,AbortSignal.timeout(QQQ_GEX_SUMMARY_TIMEOUT_MS)]));
      if(result.error)throw Object.assign(Error('GEX revision unavailable'),{code:result.error.code});return result.data;
    };
    const entries = await readConsistentQqqGex(revisionRpc,{policyId:input.policyId,from:input.from,to:input.to??'infinity',expiryDates},()=>readQqqSummaryExpiries(expiryDates, async expiryDate => {
      const history: QqqGexExpiryHistory['summary'] = [];
      let after: string | null = null;
      let rpcAvailable = true;
      let singleScan=true;
      let readthrough=input.policyId==='qqq-pcs-intraday-v1';
      for (;;) {
        controller.signal.throwIfAborted();
        // A deadline belongs to a bounded page, not the entire complete day.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(QQQ_GEX_SUMMARY_TIMEOUT_MS)]);
        let result = rpcAvailable ? await supabaseAdmin.rpc(singleScan?(input.policyId==='qqq-pcs-intraday-v1'?'qqq_gex_directional_summary_page_v6':'qqq_gex_directional_summary_page_v4'):'qqq_gex_directional_summary_page_v3', {
          p_policy_id: input.policyId, p_expiry_date: expiryDate, p_from: input.from,
          p_to: input.to ?? 'infinity', p_after: after, p_limit: singleScan?128:QQQ_GEX_SUMMARY_PAGE_SIZE,
        }).abortSignal(signal) : null;
        if(singleScan&&input.policyId==='qqq-pcs-intraday-v1'&&result?.error&&['PGRST202','42883'].includes(result.error.code)){readthrough=false;result=await supabaseAdmin.rpc('qqq_gex_directional_summary_page_v4',{p_policy_id:input.policyId,p_expiry_date:expiryDate,p_from:input.from,p_to:input.to??'infinity',p_after:after,p_limit:128}).abortSignal(signal);}
        if(singleScan&&result?.error&&['PGRST202','42883'].includes(result.error.code)){singleScan=false;result=await supabaseAdmin.rpc('qqq_gex_directional_summary_page_v3',{p_policy_id:input.policyId,p_expiry_date:expiryDate,p_from:input.from,p_to:input.to??'infinity',p_after:after,p_limit:QQQ_GEX_SUMMARY_PAGE_SIZE}).abortSignal(signal);}
        if (result?.error && ['PGRST202','42883'].includes(result.error.code)) result=await supabaseAdmin.rpc('qqq_gex_directional_summary_page_v2',{
          p_policy_id:input.policyId,p_expiry_date:expiryDate,p_from:input.from,p_to:input.to??'infinity',p_after:after,p_limit:QQQ_GEX_SUMMARY_PAGE_SIZE,
        }).abortSignal(signal);
        if (result?.error?.code === 'PGRST202' || result?.error?.code === '42883') rpcAvailable = false;
        if (!rpcAvailable) {
          // Compatibility until the additive RPC migration is installed.
          // Metadata is already in profile; repeated JSON extraction in SQL
          // needlessly detoasts the same large distribution several times.
          let query = supabaseAdmin.from('qqq_gex_expiry_snapshot').select(QQQ_GEX_SUMMARY_SELECT).setHeader('cache-control','no-cache')
            .eq('symbol', 'QQQ').eq('policy_id', input.policyId).eq('expiry_date', expiryDate)
            .gte('captured_at', input.from);
          if (input.to) query = query.lt('captured_at', input.to);
          if (after) query = query.gt('captured_at', after);
          result = await query.order('captured_at', { ascending: true }).limit(QQQ_GEX_SUMMARY_PAGE_SIZE).abortSignal(signal);
        }
        if (!result || result.error) {
          console.warn('[QqqGexHistory] multi-expiry summary read unavailable', {
            ...qqqGexError(result?.error), policyId: input.policyId, expiryDate, after,
          });
          throw Error('GEX summary page unavailable');
        }
        if (!Array.isArray(result.data)||result.data.length>(singleScan?128:QQQ_GEX_SUMMARY_PAGE_SIZE)) throw Error('Invalid GEX summary page');
        const rows = result.data as StoredRow[];
        for (const row of rows) {
          if (row.packed_profile !== undefined) row.profile = decodeQqqDirectionalGexProfile(row.packed_profile);
          if (row.expiry_date !== expiryDate || !Number.isFinite(Date.parse(row.captured_at))
            || (after !== null && Date.parse(row.captured_at) <= Date.parse(after))) throw Error('Invalid GEX summary cursor');
          after = row.captured_at;
          if (!isFiniteNumber(row.net_gex)) continue;
          const timing = qqqStoredGexTiming(row);
          history.push({
            ...timing, time: row.captured_at, availableAt: timing.time, expiryDate: row.expiry_date,
            dte: row.dte, spot: row.spot, netGex: row.net_gex,
            gammaFlip: row.gamma_flip, callWallPrice: row.call_wall_price, callWallMagnitude: row.call_wall_magnitude,
            putWallPrice: row.put_wall_price, putWallMagnitude: row.put_wall_magnitude,
            kingStrike: row.king_strike, kingMagnitude: row.king_magnitude, kingSide: row.king_side,
            profile: row.profile ? compactGexProfile(row.profile) : undefined,
          });
        }
        // A cold readthrough page can contain32; only an empty page ends that cursor.
        if (readthrough ? rows.length===0 : rows.length < (singleScan?128:QQQ_GEX_SUMMARY_PAGE_SIZE)) break;
      }
      return [expiryDate, history] as const;
    }, () => controller.abort()),controller.signal);
    return new Map(entries.filter(([, history]) => history.length));
  } catch (error) {
    controller.abort(); // Cancel sibling expiry reads; never return partial evidence.
    console.warn('[QqqGexHistory] multi-expiry summary read aborted', { ...qqqGexException(error), policyId: input.policyId, expiryDates });
    return null;
  }
}

/**
 * Returns the last complete persisted GEX capture, rather than selecting an
 * expiry from a potentially stale live option chain.  This is the authority
 * for display; explicit live reads include today's captures up to now, while
 * the default remains the pre-market/closed bound. Never recalculates Greeks.
 */
/** Frozen option reads include the entire option session, including the cash-close tail. */
export function latestCompletedQqqOptionClose(now: Date) {
  const parts = easternCalendarParts(now);
  let dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const clock = Number(parts.hour) * 60 + Number(parts.minute);
  if (!qqqSessionForDate(dateKey).trading || clock < qqqSessionForDate(dateKey).optionCloseMinute) dateKey = shiftCalendarDate(dateKey, -1);
  while (!qqqSessionForDate(dateKey).trading) dateKey = shiftCalendarDate(dateKey, -1);
  const close = qqqSessionForDate(dateKey).optionCloseMinute;
  return easternLocalTimeUtc(dateKey, Math.floor(close / 60), close % 60);
}

export async function readLatestQqqGexExpirySnapshots(input: {
  policyId: string;
  from: string;
  now?: Date;
  mode?: 'live' | 'frozen';
}): Promise<QqqLatestGexExpirySnapshot[] | null> {
  const controller = new AbortController();
  // Complete latest capture transport can exceed the history-page deadline on
  // a cold connection. Keep a separate bounded budget; never substitute stale
  // rows or turn a transport failure into an empty/complete chain.
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const readNow = input.now ?? new Date();
    const upperBound = input.mode === 'live' ? readNow.toISOString() : latestCompletedQqqOptionClose(readNow).toISOString();
    qqqGexDebug('latest_read_start', { policyId: input.policyId, from: input.from, upperBound });
    const args = { p_policy_id: input.policyId, p_from: input.from, p_to: upperBound };
    let combined = await supabaseAdmin.rpc('qqq_gex_latest_snapshot_v2', args).abortSignal(controller.signal);
    // One idempotent retry within the same total deadline. Never cache a
    // statement timeout as an empty chain or substitute a different bucket.
    if(combined.error?.code==='57014'&&!controller.signal.aborted)
      combined=await supabaseAdmin.rpc('qqq_gex_latest_snapshot_v2',args).abortSignal(controller.signal);
    if (!combined.error && Array.isArray(combined.data)) {
      combined = { ...combined, data: combined.data.map(({packed_profile, ...row}) => ({ ...row, profile: decodeQqqLatestSnapshotProfile(packed_profile) })) };
    } else if (combined.error?.code === 'PGRST202' || combined.error?.code === '42883') {
      combined = await supabaseAdmin.rpc('qqq_gex_latest_snapshot', args).abortSignal(controller.signal);
    }
    let result: {data: any[] | null; error: any};
    if (!combined.error && Array.isArray(combined.data)) result = {data: combined.data, error: null};
    else if (combined.error?.code === 'PGRST202' || combined.error?.code === '42883') {
    const latest = await supabaseAdmin.from('qqq_gex_expiry_snapshot')
      .select('captured_at')
      .eq('symbol', 'QQQ').eq('policy_id', input.policyId)
      .gte('captured_at', input.from)
      .lte('captured_at', upperBound)
      .neq('net_gex', 0)
      .order('captured_at', { ascending: false }).limit(1)
      .abortSignal(controller.signal);
    if (latest.error) {
      console.warn('[QqqGexHistory] latest snapshot lookup unavailable', { ...qqqGexError(latest.error), policyId: input.policyId, from: input.from });
      return null;
    }
    const capturedAt = (latest.data?.[0] as Pick<StoredRow, 'captured_at'> | undefined)?.captured_at;
    if (typeof capturedAt !== 'string') {
      console.warn('[QqqGexHistory] latest snapshot lookup returned no rows', { policyId: input.policyId, from: input.from });
      return [];
    }
    result = await supabaseAdmin.from('qqq_gex_expiry_snapshot')
      .select('captured_at, expiry_date, dte, spot, net_gex, gamma_flip, call_wall_price, call_wall_magnitude, put_wall_price, put_wall_magnitude, king_strike, king_magnitude, king_side, profile')
      .eq('symbol', 'QQQ').eq('policy_id', input.policyId).eq('captured_at', capturedAt)
      .order('expiry_date', { ascending: true }).abortSignal(controller.signal);
    } else { console.warn('[QqqGexHistory] latest RPC unavailable', qqqGexError(combined.error)); return null; }
    const capturedAt = result.data?.[0]?.captured_at;
    if (result.error) {
      console.warn('[QqqGexHistory] latest snapshot read unavailable', { ...qqqGexError(result.error), policyId: input.policyId, capturedAt });
      return null;
    }
    const rows = (result.data ?? []) as StoredRow[];
    const close = new Date(upperBound), sessionDate = easternDateKey(close);
    // The final collection bucket can omit 0DTE. Keep its own last saved
    // capture for closed-session replay, without claiming a newer timestamp.
    if(input.mode!=='live'&&rows.some(row=>easternDateKey(new Date(row.captured_at))===sessionDate)
      &&!rows.some(row=>row.expiry_date===sessionDate&&usableStoredGexSnapshot(row))){
      const from=new Date(Math.max(Date.parse(input.from),easternDayStartUtc(close).getTime())).toISOString();
      const saved=await supabaseAdmin.from('qqq_gex_expiry_snapshot').select(QQQ_GEX_SUMMARY_SELECT)
        .eq('symbol','QQQ').eq('policy_id',input.policyId).eq('expiry_date',sessionDate)
        .gte('captured_at',from).lte('captured_at',upperBound).neq('net_gex',0)
        .order('captured_at',{ascending:false}).limit(1).abortSignal(controller.signal);
      if(saved.error)throw Error('Closed-session 0DTE snapshot unavailable');
      const row=saved.data?.[0] as StoredRow|undefined;
      if(row&&row.expiry_date===sessionDate&&Date.parse(row.captured_at)>=Date.parse(from)
        &&Date.parse(row.captured_at)<=close.getTime()&&usableStoredGexSnapshot(row)){
        result={...result,data:[...rows.filter(value=>value.expiry_date!==sessionDate),row].sort((a,b)=>a.expiry_date.localeCompare(b.expiry_date))};
      }
    }
    const snapshots = ((result.data ?? []) as StoredRow[]).flatMap((row) => {
      // Frozen display belongs to the saved trading session, including its
      // 0DTE contracts. Only live reads apply today's expiration boundary.
      const dteAsOf = input.mode === 'live' ? readNow : new Date(row.captured_at);
      const currentDte = qqqSnapshotDteAt(row.expiry_date, dteAsOf);
      return usableStoredGexSnapshot(row) && currentDte >= 0
        ? [{
            capturedAt: row.captured_at, expiryDate: row.expiry_date, dte: currentDte, spot: row.spot,
            netGex: row.net_gex, gammaFlip: row.gamma_flip,
            callWallPrice: row.call_wall_price, callWallMagnitude: row.call_wall_magnitude,
            putWallPrice: row.put_wall_price, putWallMagnitude: row.put_wall_magnitude,
            kingStrike: row.king_strike, kingMagnitude: row.king_magnitude,
            kingSide: row.king_side === 'call' || row.king_side === 'put' ? row.king_side : null,
            profile: compactGexProfile(Array.isArray(row.profile) ? row.profile : []),
          }]
        : [];
    });
    qqqGexDebug('latest_read_ok', { policyId: input.policyId, capturedAt, rawRows: result.data?.length ?? 0, usableRows: snapshots.length });
    return snapshots;
  } catch (error) {
    console.warn('[QqqGexHistory] latest snapshot read aborted', { ...qqqGexException(error), policyId: input.policyId, from: input.from });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function appendQqqPcsLifecycleSnapshot<Contract = QqqPcsLifecycleHistory['points'][number]['contract']>(input: QqqPcsLifecycleHistory<Contract>['points'][number] & { policyId: string }): Promise<boolean> {
  return writeLifecycleSnapshots([input], point => `${point.policyId}:${point.time}`, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QQQ_GEX_HISTORY_TIMEOUT_MS);
    try {
      const { error } = await supabaseAdmin.from('qqq_pcs_lifecycle_snapshot').upsert({
        symbol: 'QQQ', policy_id: input.policyId, captured_at: input.time, score: input.score, timing: input.timing, contract: input.contract && input.executionFactors ? { ...input.contract, executionFactors: input.executionFactors } : input.contract,
      }, { onConflict: 'symbol,policy_id,captured_at', ignoreDuplicates: true }).abortSignal(controller.signal);
      if (error) console.warn('[QqqLifecycle] snapshot write failed', { policyId: input.policyId, error: qqqGexError(error) });
      return !error;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function readQqqPcsLifecycleHistory<Contract = QqqPcsLifecycleHistory['points'][number]['contract']>(input: { policyId: string; from: string; to?: string }): Promise<QqqPcsLifecycleHistory<Contract>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QQQ_GEX_HISTORY_TIMEOUT_MS);
  try {
    let query = supabaseAdmin.from('qqq_pcs_lifecycle_snapshot')
      .select('captured_at, score, timing, contract').eq('symbol', 'QQQ').eq('policy_id', input.policyId)
      .gte('captured_at', input.from);
    if (input.to) query = query.lte('captured_at', input.to);
    const { data, error } = await query.order('captured_at', { ascending: true }).abortSignal(controller.signal);
    if (error) {
      console.warn('[QqqLifecycle] snapshot read failed', { policyId: input.policyId, error: qqqGexError(error) });
      return { available: false, points: [] };
    }
    const points = (data ?? []).flatMap((row: any) => isFiniteNumber(row.score) && typeof row.captured_at === 'string' && ['NOW', 'WAIT_PULLBACK', 'WAIT_CONFIRM', 'NO_ENTRY_SIGNAL', 'INSUFFICIENT_DATA'].includes(row.timing)
      ? [{ time: row.captured_at, score: row.score, timing: row.timing, contract: row.contract ?? null, executionFactors: row.contract?.executionFactors }]
      : []);
    return { available: true, points };
  } catch {
    return { available: false, points: [] };
  } finally {
    clearTimeout(timeout);
  }
}

// Both strategies retain observed decisions in the existing snapshot store,
// isolated by policy. Never reconstruct historical decisions from current inputs.
export async function readTodayQqqLifecycle<Contract>(input: {
  policyId: string;
  now: Date;
  current: QqqPcsLifecycleHistory<Contract>['points'][number] | null;
}): Promise<QqqPcsLifecycleHistory<Contract>> {
  const from = easternDayStartUtc(input.now).toISOString();
  // Appending and reading independent observations can run together. Merge
  // the acknowledged current point if the read completed before its insert.
  const [saved, history] = await Promise.all([
    input.current ? appendQqqPcsLifecycleSnapshot({ ...input.current, policyId: input.policyId }) : Promise.resolve(false),
    readQqqPcsLifecycleHistory<Contract>({ policyId: input.policyId, from, to: input.now.toISOString() }),
  ]);
  const historyKey = `${input.policyId}:${from}`;
  const retained = retainedLifecycleHistories.get(historyKey);
  const points = new Map<number, QqqPcsLifecycleHistory<Contract>['points'][number]>();
  for (const point of [...(retained?.points ?? []), ...history.points]) {
    const time = Date.parse(point.time);
    if (time >= Date.parse(from) && time <= input.now.getTime()) points.set(time, point as QqqPcsLifecycleHistory<Contract>['points'][number]);
  }
  history.points = [...points.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  // A successful append is a real observation even if the following read
  // fails. Never turn it into an empty lifecycle response.
  if (saved && input.current && !history.points.some(point => new Date(point.time).getTime() === new Date(input.current!.time).getTime())) {
    history.points.push(input.current);
    history.points.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  }
  if (history.points.length) {
    retainedLifecycleHistories.delete(historyKey);
    retainedLifecycleHistories.set(historyKey, history);
    while (retainedLifecycleHistories.size > 8) retainedLifecycleHistories.delete(retainedLifecycleHistories.keys().next().value!);
  }
  return history;
}
