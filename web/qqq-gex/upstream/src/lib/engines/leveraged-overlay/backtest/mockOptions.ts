import type { OptionChain, OptionContract, SplitEvent } from '../types/input';
import { blackScholesEngine } from '../../pricing/BlackScholesEngine';
import { MOCK_OPTION_CALIBRATION } from './mockOptionCalibration';

// `q` = continuous dividend yield (annualized). Defaults to 0 for backward
// compatibility. With q > 0 the spot is discounted by e^(-qT): call prices fall,
// put prices rise, and deltas are scaled by e^(-qT) (Merton 1973).
export function bs(S: number, K: number, T: number, r: number, sigma: number, q = 0) {
  if (S <= 0 || K <= 0) {
    throw new Error(`Invalid Black-Scholes input: S=${S}, K=${K}`);
  }
  if (T <= 0 || sigma <= 0) {
    const intrC = Math.max(S - K, 0);
    const intrP = Math.max(K - S, 0);
    return { callPrice: intrC, putPrice: intrP, callDelta: intrC > 0 ? 1 : 0, putDelta: intrP > 0 ? -1 : 0 };
  }
  const call = blackScholesEngine.price({ S, K, T, r, sigma, dividendYield: q, type: 'call' });
  const put = blackScholesEngine.price({ S, K, T, r, sigma, dividendYield: q, type: 'put' });
  return {
    callPrice: call.price,
    putPrice: put.price,
    callDelta: call.delta,
    putDelta: put.delta,
  };
}

/**
 * Generate a synthetic QQQ option chain for a given simulation day.
 *
 * IV derivation: QQQ ATM IV ≈ VIX × 1.25; VXN is normalized separately.
 * Strike range: spot ±20%; QQQ/SPY use $1 near spot and $5 wings, leveraged
 * ETFs use $0.50 near spot and $5 wings.
 * Expirations: +28, +37, +45 calendar days from `date`.
 * Bid/ask: symbol-tiered via optionSpreadPct, $0.05 floor.
 */
// Leveraged ETF IV scales roughly with leverage factor.
// Calibrated against the live 2026-07-17 21-DTE chain using VXN→VIX-normalized
// input: QQQ ATM ≈ 25.4%, TQQQ ATM ≈ 73.4%. These remain model multipliers,
// not a substitute for a live option chain.
// 3x ETFs (TQQQ, UPRO, SOXL): ~2.9x VIX
// 2x ETFs (QLD, SSO): ~1.9x VIX
// 1x (QQQ, SPY, ...): ~1.0x normalized volatility base
const TRIPLE_LEVERAGED = new Set(['TQQQ', 'UPRO', 'SOXL', 'SPXL', 'TECL', 'TNA', 'LABU', 'FAS', 'FNGU']);
const DOUBLE_LEVERAGED = new Set(['QLD', 'SSO', 'ROM', 'USD', 'DDM', 'MVV', 'UWM', 'EET']);

export function ivForSymbol(vix: number, symbol: string): number {
  const multiplier = TRIPLE_LEVERAGED.has(symbol) ? MOCK_OPTION_CALIBRATION.ivMultiplier.tripleX
    : DOUBLE_LEVERAGED.has(symbol) ? MOCK_OPTION_CALIBRATION.ivMultiplier.doubleX
    : MOCK_OPTION_CALIBRATION.ivMultiplier.oneX;
  return Math.max(0.10, (vix / 100) * multiplier);
}

export function normalizeVolIndexForMockOptions(vol: number, volIndex: 'VIX' | 'VXN' = 'VIX'): number {
  // 2026-07-12 QQQ 5–8 DTE ATM IV was ~1.25× VIX. VXN already tracks
  // Nasdaq volatility more closely; the 2026-07-17 live chain gave QQQ ATM
  // IV ≈ VXN / 1.1.
  return volIndex === 'VXN'
    ? vol / MOCK_OPTION_CALIBRATION.vxnToQqqAtmIvDivisor
    : vol * MOCK_OPTION_CALIBRATION.vixToQqqAtmIv;
}

export function splitAdjustmentFactor(date: string, events: readonly SplitEvent[] = []): number {
  return events.reduce((factor, event) => event.date > date.slice(0, 10) ? factor * event.ratio : factor, 1);
}

/**
 * Realistic bid/ask spread as a fraction of mid, by liquidity tier.
 * The flat 2% previously used was far too tight — it understated round-trip
 * cost and exaggerated backtest returns. Leveraged-ETF options trade much
 * wider than QQQ/SPY index options.
 *   1x / index (QQQ, SPY): ~1%
 *   2x ETFs:               ~15%
 *   TQQQ:                  ~10% (2026-07-12 raw snapshot)
 *   other 3x ETFs:         ~8%
 * A $0.05 floor keeps deep-OTM wings realistically wide in relative terms.
 */
export function optionSpreadPct(symbol: string): number {
  if (symbol === 'TQQQ') return MOCK_OPTION_CALIBRATION.spreadPct.tqqq;
  if (TRIPLE_LEVERAGED.has(symbol)) return MOCK_OPTION_CALIBRATION.spreadPct.tripleX;
  if (DOUBLE_LEVERAGED.has(symbol)) return MOCK_OPTION_CALIBRATION.spreadPct.doubleX;
  return MOCK_OPTION_CALIBRATION.spreadPct.oneX;
}

/**
 * Annualized continuous dividend yield by symbol (approximate). Index ETFs pay a
 * modest yield that meaningfully tilts collar/IC pricing; leveraged ETFs pay
 * little and noisily, so they're treated as 0 (conservative). Unknown → 0.
 */
const DIVIDEND_YIELD: Record<string, number> = { QQQ: 0.006, SPY: 0.013 };
export function dividendYieldForSymbol(symbol: string): number {
  return DIVIDEND_YIELD[symbol] ?? 0;
}

/**
 * VIX term structure: VIX ≈ 30-day implied vol, VIX3M ≈ 90-day. Linearly
 * interpolate the base vol for a given expiration by its remaining DTE.
 * vix3m missing/non-positive → fall back to vix30 (the old flat behavior).
 */
export function effectiveVix(vix30: number, vix3m: number | undefined, dteDays: number): number {
  if (!vix3m || vix3m <= 0 || !isFinite(vix3m)) return vix30;
  if (dteDays <= 30) return vix30;
  if (dteDays >= 90) return vix3m;
  const w = (dteDays - 30) / 60;
  return vix30 + (vix3m - vix30) * w;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const observedHoliday = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
};
const nthWeekday = (year: number, month: number, weekday: number, nth: number) => {
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCDate(1 + (weekday - date.getUTCDay() + 7) % 7 + (nth - 1) * 7);
  return isoDate(date);
};
const lastWeekday = (year: number, month: number, weekday: number) => {
  const date = new Date(Date.UTC(year, month, 0));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - weekday + 7) % 7);
  return isoDate(date);
};
const goodFriday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, (h + l - 7 * m + 114) % 31 + 1));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return isoDate(easter);
};
const holidaysByYear = new Map<number, Set<string>>();
const marketHolidays = (year: number) => {
  let holidays = holidaysByYear.get(year);
  if (!holidays) {
    holidays = new Set([
      observedHoliday(year, 1, 1),
      nthWeekday(year, 1, 1, 3),
      nthWeekday(year, 2, 1, 3),
      goodFriday(year),
      lastWeekday(year, 5, 1),
      ...(year >= 2022 ? [observedHoliday(year, 6, 19)] : []),
      observedHoliday(year, 7, 4),
      nthWeekday(year, 9, 1, 1),
      nthWeekday(year, 11, 4, 4),
      observedHoliday(year, 12, 25),
    ]);
    holidaysByYear.set(year, holidays);
  }
  return holidays;
};
const isUsMarketHoliday = (date: Date) => {
  const year = date.getUTCFullYear();
  const key = isoDate(date);
  return [year - 1, year, year + 1].some((candidateYear) => marketHolidays(candidateYear).has(key));
};

export const QQQ_EXPIRY_CALENDAR_VERSION = 'qqq-asof-listing-v3-daily14';

/** Market sessions are independent of which option expirations are listed. */
export function marketTradingDates(fromDate: string, horizonDays: number): string[] {
  const d = new Date(`${fromDate.split('T')[0]}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 1; i <= horizonDays; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !isUsMarketHoliday(d)) out.push(isoDate(d));
  }
  return out;
}

/** Modern QQQ listing approximation, not an archival exchange chain. */
function qqqAsOfExpiries(base: Date, horizonDays: number): string[] {
  const end = new Date(base.getTime() + horizonDays * 86400000);
  const listed = new Set<string>();
  const standardMonthly = new Set<string>();
  const add = (d: Date) => { if (d > base && d <= end) listed.add(isoDate(d)); };
  const previousSession = (d: Date) => {
    const result = new Date(d);
    while (result.getUTCDay() === 0 || result.getUTCDay() === 6 || isUsMarketHoliday(result)) result.setUTCDate(result.getUTCDate() - 1);
    return result;
  };
  // Monthly and quarterly expirations do not consume weekly listing slots.
  for (let m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)); m <= end; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const monthly = previousSession(new Date(`${nthWeekday(m.getUTCFullYear(), m.getUTCMonth() + 1, 5, 3)}T00:00:00Z`));
    standardMonthly.add(isoDate(monthly));
    add(monthly);
    // QQQ also lists month-end series (quarter ends are included).
    add(previousSession(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0))));
  }
  let weeklyCount = 0;
  for (let d = new Date(base); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 5) continue;
    const expiry = previousSession(d);
    if (expiry <= base || standardMonthly.has(isoDate(expiry))) continue;
    if (weeklyCount++ < 5) add(expiry);
  }
  // Two near-term daily expirations per weekday. Monday series are introduced
  // on Friday; counting today's series avoids inventing a third forward week.
  for (const weekday of [1, 2, 3, 4]) {
    const start = new Date(base);
    if (weekday === 1) start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 2) % 7));
    let count = 0;
    for (let d = new Date(start); count < 2 && d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== weekday || isUsMarketHoliday(d)) continue;
      count++;
      add(d);
    }
  }
  // Simulation contract: preserve daily expiries through 14 calendar days.
  // These supplement the listing approximation; live provider chains remain
  // authoritative and may not yet list every modeled near-term date.
  for (const date of marketTradingDates(isoDate(base), Math.min(14, horizonDays))) listed.add(date);
  return [...listed].sort();
}

/**
 * Expirations available as of `fromDate`, strictly after it. Modern QQQ models
 * near-term daily, five weekly, monthly and quarterly series separately.
 * Pre-2023 QQQ retains the legacy approximation: archival listings and the
 * Nov/Dec 2022 transition are unavailable and remain MODEL-SENSITIVE.
 * SPY and other symbols retain their existing policies.
 */
export function listedExpiries(fromDate: string, horizonDays = 75, symbol = 'QQQ'): string[] {
  const base = new Date(`${fromDate.split('T')[0]}T00:00:00Z`);
  if (symbol === 'QQQ' && isoDate(base) >= '2023-01-01') return qqqAsOfExpiries(base, horizonDays);
  const out: string[] = [];
  const dailyExpiry = symbol === 'QQQ' || symbol === 'SPY';
  const d = new Date(base);
  for (let i = 1; i <= horizonDays; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday < 1 || weekday > 5 || isUsMarketHoliday(d)) continue;
    if (dailyExpiry || weekday === 5) out.push(isoDate(d));
    if (!dailyExpiry && weekday === 4) {
      const friday = new Date(d);
      friday.setUTCDate(friday.getUTCDate() + 1);
      if (isUsMarketHoliday(friday)) out.push(isoDate(d));
    }
  }
  return out;
}

/**
 * Listed strike grid for `symbol` at `spot`. Default (realGrid=false) keeps the
 * old uniform grid ($5, or $2.5 under $100, spot±22%). realGrid=true models the
 * real exchange grid: QQQ/SPY use $1 and TQQQ uses $0.50 near ATM; wings use
 * $5. This keeps the chain small while matching listed front-month increments.
 * while letting delta-based leg selection land on realistic strikes. The $5 wing
 * grid is a superset of the $1 ATM grid, so engine wing strikes (snapped to $5)
 * still resolve via `.find(strike===)`.
 */
export function strikesFor(symbol: string, spot: number, realGrid: boolean): number[] {
  const range = 0.22;
  const strikes: number[] = [];
  if (!realGrid) {
    const step = spot >= 100 ? 5 : 2.5;
    const lo = Math.floor(spot * (1 - range) / step) * step;
    const hi = Math.ceil (spot * (1 + range) / step) * step;
    for (let k = lo; k <= hi; k += step) {
      if (k > 0) {
        strikes.push(parseFloat(k.toFixed(2)));
      }
    }
    return strikes;
  }
  const fineStep  = TRIPLE_LEVERAGED.has(symbol) ? 0.5 : 1;
  const wideStep  = 5;
  const fineBand  = 0.10;
  const fineLo = Math.ceil (spot * (1 - fineBand) / fineStep) * fineStep;
  const fineHi = Math.floor(spot * (1 + fineBand) / fineStep) * fineStep;
  const wideLo = Math.floor(spot * (1 - range) / wideStep) * wideStep;
  const wideHi = Math.ceil (spot * (1 + range) / wideStep) * wideStep;
  const set = new Set<number>();
  for (let k = wideLo; k <= wideHi; k += wideStep) set.add(parseFloat(k.toFixed(2)));
  for (let k = fineLo; k <= fineHi; k += fineStep) set.add(parseFloat(k.toFixed(2)));
  return [...set].filter(k => k > 0).sort((a, b) => a - b);
}

/**
 * Liquidity model (opt-in). Real option liquidity peaks ATM and thins out into
 * the wings; the flat openInterest:1000/volume:500 constants let the backtest
 * fill arbitrarily large orders on deep wings for free. With liquidityModel=true,
 * OI/volume decay with |ln(K/S)| from a per-tier base (index thickest, 3x ETFs
 * thinnest), flooring at a small minimum so deep wings stay tradeable but capped.
 */
const MIN_OI = 25;
const MIN_VOL = 10;
function liquidityProfile(symbol: string): { oi: number; vol: number; oiDecay: number; volDecay: number } {
  // 2026-07-12 raw-chain medians: QQQ ATM 473 OI / 603 vol and 10% wings
  // 138 / 20; TQQQ ATM 219 / 47 and 10% wings 187 / 27.
  if (symbol === 'QQQ') return MOCK_OPTION_CALIBRATION.liquidity.qqq;
  if (symbol === 'TQQQ') return MOCK_OPTION_CALIBRATION.liquidity.tqqq;
  if (TRIPLE_LEVERAGED.has(symbol)) return { oi: 1500, vol: 800, oiDecay: 6, volDecay: 6 };
  if (DOUBLE_LEVERAGED.has(symbol)) return { oi: 4000, vol: 2000, oiDecay: 6, volDecay: 6 };
  return { oi: 20000, vol: 10000, oiDecay: 6, volDecay: 6 };
}
export function liquidityAt(symbol: string, spot: number, K: number): { oi: number; vol: number } {
  const m = spot > 0 && K > 0 ? Math.abs(Math.log(K / spot)) : 0;
  const base = liquidityProfile(symbol);
  return {
    oi:  Math.max(MIN_OI,  Math.round(base.oi  * Math.exp(-base.oiDecay * m))),
    vol: Math.max(MIN_VOL, Math.round(base.vol * Math.exp(-base.volDecay * m))),
  };
}

/** Convert a B-S mid price into a realistic bid/ask quote for `symbol`. */
export function optionQuote(mid: number, symbol: string, spreadMultiplier = 1): { bid: number; ask: number } {
  const spread = Math.max(0.05, mid * optionSpreadPct(symbol) * spreadMultiplier);
  return { bid: Math.max(0, mid - spread / 2), ask: mid + spread / 2 };
}

/**
 * Strike-dependent implied vol (equity volatility skew). Without skew the flat
 * single IV made downside puts too cheap — protective collar/IC put legs were
 * underpriced, which exaggerated backtest returns. OTM puts get a higher IV and
 * OTM calls a lower IV, tilted against log-moneyness ln(K/S).
 *   skewSlope = 0   → flat (old behavior)
 *   skewSlope = 2.8 → a 10% OTM put IV ≈ base × 1.28, matching the current
 *   QQQ 21-DTE surface calibration.
 * Clamped to [0.05, base × 3] to avoid blow-ups at far strikes.
 */
export function ivAt(vix: number, symbol: string, S: number, K: number, skewSlope = MOCK_OPTION_CALIBRATION.skewSlope): number {
  const baseIv = ivForSymbol(vix, symbol);
  if (skewSlope === 0 || S <= 0 || K <= 0) return baseIv;
  const logMoneyness = Math.log(K / S);           // < 0 for downside strikes
  const skewed = baseIv * (1 - skewSlope * logMoneyness);
  return Math.max(0.05, Math.min(skewed, baseIv * 3));
}

/** Raw split coordinates and caller-owned pricing horizon; no calendar or account state. */
export function quoteOptionStrike(input: {
  symbol: string; rawSpot: number; rawStrike: number; pricingYears: number; effectiveVol: number;
  riskFreeRate: number; skewSlope: number; spreadMultiplier: number; dividendYield: number;
}) {
  const iv = ivAt(input.effectiveVol, input.symbol, input.rawSpot, input.rawStrike, input.skewSlope);
  const theoretical = bs(input.rawSpot, input.rawStrike, input.pricingYears, input.riskFreeRate, iv, input.dividendYield);
  return { iv, callDelta: theoretical.callDelta, putDelta: theoretical.putDelta,
    call: optionQuote(theoretical.callPrice, input.symbol, input.spreadMultiplier),
    put: optionQuote(theoretical.putPrice, input.symbol, input.spreadMultiplier) };
}

export function buildMockOptionChain(
  date: string, spot: number, vix: number, symbol = 'QQQ',
  spreadMultiplier = 1, skewSlope = 0,
  opts: {
    /** Explicit longer-calendar research model; omitted preserves the 75-day calendar. */
    expiryHorizonDays?:75|365;
    vix3m?: number;
    riskFreeRate?: number;
    expiryCalendar?: boolean;   // #5a: real Friday calendar instead of fixed [28,37,45] offsets
    realStrikeGrid?: boolean;   // #5b: dense-ATM listed grid instead of uniform $5
    liquidityModel?: boolean;   // #5c: moneyness-decayed OI/volume instead of constants
    splitEvents?: readonly SplitEvent[];
    /** 次日成交链：合约标签按提案 expiry，定价期限保持旧 DTE 语义以锁定 parity。 */
    contracts?: ReadonlyArray<{ expiry: string; pricingDte: number; strikes: readonly number[]; types: readonly ('call' | 'put')[] }>;
    /**
     * 决策链只需要策略目标期限的一侧；行权价仍保留完整上市网格，避免改变
     * delta/比率选约的排序语义。成交链再由 `contracts` 收窄为实际腿。
     */
    decisionContracts?: ReadonlyArray<{ targetDte: number; types: readonly ('call' | 'put')[] }>;
  } = {},
): OptionChain {
  if(opts.expiryHorizonDays!==undefined&&![75,365].includes(opts.expiryHorizonDays))throw Error('Invalid option expiry horizon');
  const r = opts.riskFreeRate ?? 0.045;
  const q = dividendYieldForSymbol(symbol);
  const splitFactor = splitAdjustmentFactor(date, opts.splitEvents);
  const rawSpot = spot * splitFactor;

  const strikes = strikesFor(symbol, rawSpot, opts.realStrikeGrid ?? false);

  const tradeDate = date.split('T')[0];
  const baseDate = new Date(`${tradeDate}T00:00:00Z`);

  // Expiration set: symbol-specific listed calendar (#5a) or legacy offsets.
  const expiryDates: Array<{ date: string; dte: number }> = opts.expiryCalendar
    ? listedExpiries(tradeDate, opts.expiryHorizonDays??75, symbol)
        .map(d => ({ date: d, dte: Math.round((Date.parse(`${d}T00:00:00Z`) - baseDate.getTime()) / 86400000) }))
        .filter(x => x.dte > 0)
    : [28, 37, 45].map(dte => {
        const exp = new Date(baseDate);
        exp.setUTCDate(exp.getUTCDate() + dte);
        return { date: exp.toISOString().split('T')[0], dte };
      });

  const contractRequests = opts.contracts ?? opts.decisionContracts?.map(({ targetDte, types }) => {
    const selected = expiryDates.reduce((best, candidate) =>
      Math.abs(candidate.dte - targetDte) < Math.abs(best.dte - targetDte) ? candidate : best,
    );
    return { expiry: selected.date, pricingDte: selected.dte, strikes, types };
  }) ?? expiryDates.map(({ date, dte }) => ({ expiry: date, pricingDte: dte, strikes, types: ['call', 'put'] as const }));
  const expirations = contractRequests.map(({ expiry: expStr, pricingDte, strikes: requestedStrikes, types }) => {
    const T = pricingDte / 365;
    const effVix = effectiveVix(vix, opts.vix3m, pricingDte);

    const calls: OptionContract[] = [];
    const puts:  OptionContract[] = [];

    for (const requestedStrike of requestedStrikes) {
      const rawStrike = opts.contracts ? requestedStrike * splitFactor : requestedStrike;
      const {iv:ivK,callDelta,putDelta,call:cQuote,put:pQuote} = quoteOptionStrike({symbol,rawSpot,rawStrike,
        pricingYears:T,effectiveVol:effVix,riskFreeRate:r,skewSlope,spreadMultiplier,dividendYield:q});
      const { oi, vol } = opts.liquidityModel ? liquidityAt(symbol, rawSpot, rawStrike) : { oi: 1000, vol: 500 };
      const strike = rawStrike / splitFactor;
      const contractMultiplier = 100 * splitFactor;

      if (types.includes('call')) calls.push({ strike, expiry: expStr, type: 'call', bid: cQuote.bid / splitFactor, ask: cQuote.ask / splitFactor, iv: ivK, delta: callDelta, gamma: 0, theta: 0, openInterest: oi, volume: vol, contractMultiplier, splitAdjustmentFactor: splitFactor });
      if (types.includes('put')) puts.push({ strike, expiry: expStr, type: 'put', bid: pQuote.bid / splitFactor, ask: pQuote.ask / splitFactor, iv: ivK, delta: putDelta, gamma: 0, theta: 0, openInterest: oi, volume: vol, contractMultiplier, splitAdjustmentFactor: splitFactor });
    }

    return { date: expStr, calls, puts };
  });

  return { symbol, spot, timestamp: date, expirations };
}
