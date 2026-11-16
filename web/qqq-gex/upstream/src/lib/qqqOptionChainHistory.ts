import type { OptionContract } from '@/types/ivCurve';
import { supabaseAdmin } from './supabase';
import { qqqAtmIv } from './qqqAtmIv';

const QQQ_OPTION_SNAPSHOT_TIMEOUT_MS = 2_500;
export const QQQ_OPTION_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;

type StoredContract = {
  id: string;
  expiration: string;
  strike: number;
  optionType: string;
};

type StoredQuote = {
  contractId: string;
  snapshotTime: string;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
};

export type QqqStoredOptionChainSnapshot = {
  snapshotTime: string;
  underlyingPrice: number;
  expiry: number;
  expiryDate: string;
  daysToExpiration: number;
  gexDte: number;
  puts: OptionContract[];
  calls: OptionContract[];
  atmIV: number;
  source: 'stored_snapshot';
  capturedAt: string;
};

function easternDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toOptionContract(contract: StoredContract, quote: StoredQuote, spot: number): OptionContract | null {
  if (!Number.isFinite(contract.strike) || contract.strike <= 0) return null;
  const bid = finite(quote.bid);
  const ask = finite(quote.ask);
  const lastPrice = finite(quote.lastPrice);
  const mid = bid !== null && ask !== null && bid >= 0 && ask >= bid
    ? (bid + ask) / 2
    : lastPrice;
  const iv = finite(quote.impliedVolatility);
  return {
    strike: contract.strike,
    bid,
    ask,
    mid,
    lastPrice,
    quoteSource: bid !== null && ask !== null && bid >= 0 && ask >= bid ? 'market' : 'last_trade',
    iv: iv !== null && iv >= 0 ? iv : 0,
    delta: finite(quote.delta) ?? undefined,
    gamma: finite(quote.gamma) ?? undefined,
    theta: finite(quote.theta) ?? undefined,
    vega: finite(quote.vega) ?? undefined,
    volume: finite(quote.volume) ?? undefined,
    openInterest: finite(quote.openInterest) ?? undefined,
    inTheMoney: contract.optionType === 'put' ? contract.strike > spot : contract.strike < spot,
  };
}

function isOptionType(value: string): value is 'put' | 'call' {
  return value === 'put' || value === 'call';
}

export function isFreshQqqOptionSnapshot(capturedAt: string, now: Date, maxAgeMs = QQQ_OPTION_SNAPSHOT_MAX_AGE_MS) {
  const capturedMs = Date.parse(capturedAt);
  const nowMs = now.getTime();
  return Number.isFinite(capturedMs)
    && capturedMs <= nowMs
    && nowMs - capturedMs <= maxAgeMs
    && easternDateKey(new Date(capturedMs)) === easternDateKey(now);
}

export function buildQqqStoredOptionChainSnapshots(input: {
  snapshotTime: string;
  underlyingPrice: number;
  contracts: StoredContract[];
  quotes: StoredQuote[];
  asOfDate: string;
}): QqqStoredOptionChainSnapshot[] {
  const latestQuoteByContract = new Map<string, StoredQuote>();
  [...input.quotes]
    .sort((left, right) => Date.parse(right.snapshotTime) - Date.parse(left.snapshotTime))
    .forEach((quote) => {
      if (!latestQuoteByContract.has(quote.contractId)) latestQuoteByContract.set(quote.contractId, quote);
    });

  const byExpiry = new Map<string, { puts: OptionContract[]; calls: OptionContract[] }>();
  for (const contract of input.contracts) {
    if (!isOptionType(contract.optionType) || contract.expiration < input.asOfDate) continue;
    const quote = latestQuoteByContract.get(contract.id);
    if (!quote) continue;
    const option = toOptionContract(contract, quote, input.underlyingPrice);
    if (!option) continue;
    const group = byExpiry.get(contract.expiration) ?? { puts: [], calls: [] };
    group[contract.optionType === 'put' ? 'puts' : 'calls'].push(option);
    byExpiry.set(contract.expiration, group);
  }

  return [...byExpiry.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([expiryDate, group]) => {
      const expiry = Date.parse(`${expiryDate}T00:00:00.000Z`) / 1000;
      const dte = Math.round((Date.parse(`${expiryDate}T00:00:00.000Z`) - Date.parse(`${input.asOfDate}T00:00:00.000Z`)) / 86_400_000);
      return {
        snapshotTime: input.snapshotTime,
        underlyingPrice: input.underlyingPrice,
        expiry,
        expiryDate,
        daysToExpiration: Math.max(1, dte),
        gexDte: dte,
        puts: group.puts,
        calls: group.calls,
        atmIV: qqqAtmIv(group.calls,group.puts,input.underlyingPrice),
        source: 'stored_snapshot' as const,
        capturedAt: input.snapshotTime,
      };
    })
    .filter((snapshot) => snapshot.gexDte >= 0 && (snapshot.puts.length > 0 || snapshot.calls.length > 0));
}

export function mergeQqqOptionChainSnapshots<T extends { expiryDate: string }, U extends { expiryDate: string }>(primary: T[], fallback: U[]): Array<T | U> {
  const byExpiry = new Map<string, T | U>();
  fallback.forEach((snapshot) => byExpiry.set(snapshot.expiryDate, snapshot));
  primary.forEach((snapshot) => byExpiry.set(snapshot.expiryDate, snapshot));
  return [...byExpiry.values()].sort((left, right) => left.expiryDate.localeCompare(right.expiryDate));
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = QQQ_OPTION_SNAPSHOT_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    promise.then((value) => { clearTimeout(timeout); resolve(value); }, () => { clearTimeout(timeout); resolve(null); });
  });
}

/**
 * Read only a very recent same-session ingestion. This is a recovery path for
 * a failed live Yahoo chain, never a stale historical substitute.
 */
export async function loadFreshQqqOptionChainSnapshots(now: Date, maxAgeMs = QQQ_OPTION_SNAPSHOT_MAX_AGE_MS) {
  const since = new Date(now.getTime() - maxAgeMs).toISOString();
  const today = easternDateKey(now);
  const lastExpiry = shiftDateKey(today, 45);

  try {
    const snapshotResult = await withTimeout(supabaseAdmin
      .from('options_chain_snapshot')
      .select('snapshot_time, underlying_price')
      .eq('symbol', 'QQQ')
      .gte('snapshot_time', since)
      .lte('snapshot_time', now.toISOString())
      .order('snapshot_time', { ascending: false })
      .limit(1));
    const snapshot = (snapshotResult as any)?.data?.[0] as { snapshot_time?: string; underlying_price?: number } | undefined;
    if (!snapshot?.snapshot_time || !isFreshQqqOptionSnapshot(snapshot.snapshot_time, now, maxAgeMs)) return [];
    const underlyingPrice = finite(snapshot.underlying_price);
    if (underlyingPrice === null || underlyingPrice <= 0) return [];

    const contractsResult = await withTimeout(supabaseAdmin
      .from('options_contracts')
      .select('id, expiration, strike, option_type')
      .eq('symbol', 'QQQ')
      .gte('expiration', today)
      .lte('expiration', lastExpiry)
      .limit(10_000));
    const contracts = ((contractsResult as any)?.data ?? []) as Array<{ id: string; expiration: string; strike: number; option_type: string }>;
    if (!contracts.length) return [];

    const quoteResult = await withTimeout(supabaseAdmin
      .from('options_quotes')
      .select('contract_id, snapshot_time, bid, ask, last_price, volume, open_interest, implied_volatility, delta, gamma, theta, vega')
      .in('contract_id', contracts.map((contract) => contract.id))
      .lte('snapshot_time', snapshot.snapshot_time)
      .order('snapshot_time', { ascending: false })
      .limit(20_000));
    const quotes = ((quoteResult as any)?.data ?? []) as Array<Record<string, unknown>>;
    const snapshots = buildQqqStoredOptionChainSnapshots({
      snapshotTime: snapshot.snapshot_time,
      underlyingPrice,
      contracts: contracts.map((contract) => ({ id: contract.id, expiration: contract.expiration, strike: Number(contract.strike), optionType: contract.option_type })),
      quotes: quotes.flatMap((quote) => {
        const contractId = typeof quote.contract_id === 'string' ? quote.contract_id : null;
        const snapshotTime = typeof quote.snapshot_time === 'string' ? quote.snapshot_time : null;
        return contractId && snapshotTime ? [{
          contractId, snapshotTime,
          bid: finite(quote.bid), ask: finite(quote.ask), lastPrice: finite(quote.last_price),
          volume: finite(quote.volume), openInterest: finite(quote.open_interest), impliedVolatility: finite(quote.implied_volatility),
          delta: finite(quote.delta), gamma: finite(quote.gamma), theta: finite(quote.theta), vega: finite(quote.vega),
        }] : [];
      }),
      asOfDate: today,
    });
    return snapshots;
  } catch {
    return [];
  }
}
