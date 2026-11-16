import type { OptionContract } from '@/types/ivCurve';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { GEXEngine } from './engines/structure/GEXEngine';
import { buildFullGexProfile } from './qqqGexProfile';
import { buildQqqGammaModel, qqqGammaExpiryTime } from './qqqGammaModel';
import { qqqDirectionalGexSourceAsOf } from './qqqDirectionalGexTime';
import { qqqAtmIv, QQQ_ATM_IV_METHOD } from './qqqAtmIv';
import { qqqIvUsable } from './qqqIvQuality';

/** Persisted in profile JSON; old immutable captures retain their legacy definition. */
export const QQQ_GEX_CALCULATION_VERSION = 'qqq-gex-full-1pct-usable-iv-v4';
const numeric = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : undefined;

export function normalizeQqqGexOption(option: Record<string, unknown>, input: { expiry: number; now: Date; spot: number; type: 'call' | 'put'; receivedAt?: string }): OptionContract {
  const strike = numeric(option.strike) ?? NaN;
  const iv = numeric(option.impliedVolatility) ?? 0;
  const bid = numeric(option.bid), ask = numeric(option.ask), oi = numeric(option.openInterest);
  // The capture adapter prices once, at its authoritative valuation time.
  return { strike, iv, bid: bid !== undefined && bid >= 0 ? bid : null, ask: ask !== undefined && ask > 0 ? ask : null,
    mid: bid !== undefined && ask !== undefined && bid >= 0 && ask > 0 && ask >= bid ? (bid + ask) / 2 : null,
    lastPrice: numeric(option.lastPrice) ?? null, lastTradeDate: numeric(option.lastTradeDate) ?? null,
    receivedAt: input.receivedAt, openInterest: oi !== undefined && oi >= 0 ? oi : undefined, volume: numeric(option.volume),
    ...(option.oiProvenance && typeof option.oiProvenance==='object' ? {oiProvenance: option.oiProvenance as OptionContract['oiProvenance']} : {}), inTheMoney: option.inTheMoney === true };
}

export function calculateQqqGex(chain: { calls: OptionContract[]; puts: OptionContract[] }, spot: number, expiryDate: string, valuationAt: string, inputComplete = true) {
  const remainingDays = (qqqGammaExpiryTime(expiryDate) - Date.parse(valuationAt)) / 86400000;
  if (!(remainingDays > 0) || !Number.isFinite(remainingDays) || !(spot > 0) || !Number.isFinite(spot) || !chain.calls.length || !chain.puts.length) return null;
  const reprice = (contracts: OptionContract[], type: 'call' | 'put') => contracts.filter(c => c.strike > 0 && Number.isFinite(c.strike)).map(c => {
    const greeks = qqqIvUsable(c.iv) ? blackScholesEngine.price({ S: spot, K: c.strike, T: remainingDays / 365, r: 0, sigma: c.iv, type }) : null;
    return { ...c, openInterest: typeof c.openInterest === 'number' && Number.isFinite(c.openInterest) && c.openInterest >= 0 ? c.openInterest : undefined,
      gamma: greeks?.gamma, delta: greeks?.delta, theta: greeks?.theta, vega: greeks?.vega };
  });
  const calls = reprice(chain.calls, 'call'), puts = reprice(chain.puts, 'put');
  const unique = (rows: OptionContract[]) => new Set(rows.map(c => c.strike)).size === rows.length;
  const valid = (c: OptionContract) => typeof c.openInterest === 'number' && Number.isFinite(c.openInterest) && c.openInterest >= 0 && (c.openInterest === 0 || qqqIvUsable(c.iv)) && [c.gamma,c.delta,c.theta,c.vega].every(value=>value===undefined||Number.isFinite(value));
  const complete = inputComplete && calls.length === chain.calls.length && puts.length === chain.puts.length && unique(calls) && unique(puts) && [...calls, ...puts].every(valid);
  const atmIv = qqqAtmIv(calls,puts,spot);
  let metrics = GEXEngine.calculate(calls, puts, spot, atmIv * 100, remainingDays, { scope: 'full-chain', unit: 'per-1pct', gammaFlipPrice: null });
  const profile = buildFullGexProfile(metrics.allPoints, { calls, puts }).map(p => ({ ...p, calculationVersion: QQQ_GEX_CALCULATION_VERSION, gexUnit: 'per-1pct' as const, inputComplete: complete, computedAt: valuationAt }));
  const sourceAsOf = qqqDirectionalGexSourceAsOf(valuationAt, null, profile);
  const fullProfile = profile.map(p => ({ ...p, sourceAsOf }));
  const model = buildQqqGammaModel([{ expiryDate, asOf: valuationAt, fullGexProfile: fullProfile }], spot, valuationAt);
  metrics = GEXEngine.withGammaFlip(metrics, spot, complete ? model.levels.zeroGamma : null);
  // The continuous root is represented as a price, never snapped to a different strike.
  metrics.points.forEach(p => { p.isGammaFlip = p.strike === metrics.gammaFlipPrice; });
  return { metrics, profile: fullProfile.map(p=>({...p,isGammaFlip:p.strike===metrics.gammaFlipPrice})), calls, puts, complete, sourceAsOf, atmIv, atmIvMethod:QQQ_ATM_IV_METHOD, model };
}
