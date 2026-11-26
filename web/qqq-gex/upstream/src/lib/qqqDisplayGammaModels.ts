import { QQQ_GAMMA_INPUT_VERSION, buildQqqGammaModel, type GammaModelExpiry } from './qqqGammaModel';
import { resolveSelectedGexExpiry } from './qqqGexSelection';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { qqqClosedBarPrice } from './qqqMarketSession';

/** Bounded display cache. Prices, valuation time and every immutable profile
 * identity are part of the contract; corrections and time decay invalidate it. */
export function createQqqDisplayGammaModels(build = buildQqqGammaModel, capacity = 16) {
  type Entry = { expiries: readonly GammaModelExpiry[]; spot: number; asOf: string; model: ReturnType<typeof build> };
  const entries: Entry[] = [];
  const model = (expiries: readonly GammaModelExpiry[], spot: number, asOf: string) => {
    const index = entries.findIndex(entry => Object.is(entry.spot, spot) && entry.asOf === asOf && entry.expiries.length === expiries.length && entry.expiries.every((old, i) => old.expiryDate === expiries[i]!.expiryDate && old.asOf === expiries[i]!.asOf && old.fullGexProfile === expiries[i]!.fullGexProfile));
    if (index >= 0) { const [entry] = entries.splice(index, 1); entries.push(entry!); return entry!.model; }
    const result = build(expiries, spot, asOf);
    entries.push({ expiries, spot, asOf, model: result });
    while (entries.length > capacity) entries.shift();
    return result;
  };
  return (data: QqqPcsApiResponse, selectedExpiry: string | null) => {
    const expiries = data.intraday?.gexExpiries ?? [];
    const active = resolveSelectedGexExpiry(expiries, selectedExpiry), stored = data.intraday?.gammaModels;
    const asOf = data.observedAt ?? data.asOf;
    const lastBar = qqqClosedBarPrice(data.intraday?.bars ?? [], asOf, data.intraday?.granularity === '5m' ? 300 : 120);
    const spot = lastBar?.close ?? (stored?.available.asOf === asOf ? stored.available.spot : NaN);
    if (stored && stored.selected.inputQualityVersion === QQQ_GAMMA_INPUT_VERSION && active && stored.selected.spot === spot && stored.selected.asOf === asOf && stored.selected.expiries.length === 1 && stored.selected.expiries[0] === active.expiryDate) return stored;
    const selected = model(active ? [active] : [], spot, asOf);
    const available = stored?.available.inputQualityVersion === QQQ_GAMMA_INPUT_VERSION && stored.available.asOf === asOf && stored.available.spot === spot && stored.available.points.length ? stored.available : expiries.length === 1 && active === expiries[0] ? selected : model(expiries, spot, asOf);
    return { selected, available };
  };
}

export const buildDisplayGammaModels = createQqqDisplayGammaModels();
