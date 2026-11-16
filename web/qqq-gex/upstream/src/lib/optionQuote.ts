export type OptionQuoteSource = 'market' | 'last_trade';

export type ResolvedOptionQuote = {
  bid: number | null;
  ask: number | null;
  mid: number;
  sell: number;
  buy: number;
  source: OptionQuoteSource;
  confidence: 10 | 5;
  asOf: number | null;
  haircut: number;
};

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function resolveOptionQuote(
  quote: { bid?: number | null; ask?: number | null; lastPrice?: number | null; lastTradeDate?: number | null },
  maxSpreadPct = 0.2,
  nowSeconds = Date.now() / 1000,
  maxLastTradeAgeSeconds = 7 * 86400,
  lastTradeHaircut = 0.05,
): ResolvedOptionQuote | null {
  if (positive(quote.bid) && positive(quote.ask)) {
    if (quote.ask < quote.bid) return null;
    const mid = (quote.bid + quote.ask) / 2;
    if ((quote.ask - quote.bid) / mid > maxSpreadPct) return null;
    return { bid: quote.bid, ask: quote.ask, mid, sell: quote.bid, buy: quote.ask, source: 'market', confidence: 10, asOf: null, haircut: 0 };
  }
  const asOf = positive(quote.lastTradeDate) ? quote.lastTradeDate : null;
  if (!positive(quote.lastPrice) || asOf === null || nowSeconds - asOf > maxLastTradeAgeSeconds || asOf > nowSeconds + 300) return null;
  return {
    bid: null,
    ask: null,
    mid: quote.lastPrice,
    sell: quote.lastPrice * (1 - lastTradeHaircut),
    buy: quote.lastPrice * (1 + lastTradeHaircut),
    source: 'last_trade',
    confidence: 5,
    asOf,
    haircut: lastTradeHaircut,
  };
}
