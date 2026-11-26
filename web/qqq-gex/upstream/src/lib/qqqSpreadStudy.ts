import type { PcsFullGexProfile } from '@/types/qqqGex';
import { blackScholesEngine } from './engines/pricing/BlackScholesEngine';
import { qqqGammaExpiryTime } from './qqqGammaModel';
import { qqqIvUsable } from './qqqIvQuality';
export type SpreadSide = 'put' | 'call';
export type StudyQuoteTiming = { optionQuoteAt?: string | null; receivedAt?: string | null };
type StudyStrike = PcsFullGexProfile & { quoteTiming?: StudyQuoteTiming };
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function studyLegQuote(row: StudyStrike | undefined, side: SpreadSide, cutoff: number) {
  if (!row) return { valid: false as const, reason: '所选行权价不在当前快照中' };
  const bid = row[side === 'call' ? 'callBid' : 'putBid'], ask = row[side === 'call' ? 'callAsk' : 'putAsk'];
  const received = Date.parse(row[side === 'call' ? 'callReceivedAt' : 'putReceivedAt'] ?? row.quoteTiming?.receivedAt ?? '');
  const quoted = Date.parse(row.quoteTiming?.optionQuoteAt ?? '');
  const computed = Date.parse(row.computedAt ?? '');
  if (!nonnegative(bid) || !nonnegative(ask) || ask <= 0 || ask < bid) return { valid: false as const, reason: '缺少有效 bid/ask，或买卖价交叉' };
  if (Number.isFinite(received) && received > cutoff || Number.isFinite(quoted) && quoted > cutoff || Number.isFinite(computed) && computed > cutoff) return { valid: false as const, reason: '报价、计算或接收时间晚于回放游标' };
  const mid = (bid + ask) / 2, sourceAge = Number.isFinite(quoted) ? cutoff - quoted : null, receiptAge = Number.isFinite(received) ? cutoff - received : null;
  return { valid: true as const, bid, ask, mid, width: ask - bid, relativeWidth: mid > 0 ? (ask - bid) / mid : null,
    sourceAge, receiptAge, fresh: sourceAge !== null && sourceAge <= 30_000 && receiptAge !== null && receiptAge <= 30_000,
    iv: row[side === 'call' ? 'callIv' : 'putIv'], oi: row[side === 'call' ? 'callOi' : 'putOi'], volume: row[side === 'call' ? 'callVolume' : 'putVolume'] };
}
type ValidStudyLeg = Extract<ReturnType<typeof studyLegQuote>, { valid: true }>;
type SpreadQuoteSummary = { short: ValidStudyLeg; long: ValidStudyLeg; width: number; midCredit: number; conservativeCredit: number; closeDebit: number; liquid: boolean; roundTripFriction: number; midSlippage: number };

export function qqqSpreadStudy(input: { profile: readonly StudyStrike[]; expiry: string; at: number; cutoff: number; spot: number | null; side: SpreadSide; shortStrike: number; longStrike: number; ivShockPp: number; fees: number; basis: 'bidAsk' | 'mid'; manualCredit: number | null }) {
  const { profile, side, shortStrike, longStrike, cutoff, at } = input;
  const unavailable = (reason: string, quoteSummary: SpreadQuoteSummary | null = null) => ({ available: false as const, reason, quoteSummary });
  if (!Number.isFinite(at) || !Number.isFinite(cutoff) || at > cutoff || cutoff - at > 300_000) return unavailable('当前快照超过五分钟，或尚未到达观察点');
  if (!Number.isFinite(shortStrike) || !Number.isFinite(longStrike) || (side === 'put' ? shortStrike <= longStrike : shortStrike >= longStrike)) return unavailable('PCS 需短腿高于长腿；CCS 需短腿低于长腿');
  if (new Set(profile.map(row => row.strike)).size !== profile.length) return unavailable('快照包含重复行权价');
  const short = studyLegQuote(profile.find(row => row.strike === shortStrike), side, cutoff), long = studyLegQuote(profile.find(row => row.strike === longStrike), side, cutoff);
  if (!short.valid || !long.valid) return unavailable(!short.valid ? `短腿：${short.reason}` : !long.valid ? `长腿：${long.reason}` : '报价缺失');
  const width = Math.abs(shortStrike - longStrike), midCredit = short.mid - long.mid, conservativeCredit = short.bid - long.ask, closeDebit = short.ask - long.bid;
  const quoteSummary = { short, long, width, midCredit, conservativeCredit, closeDebit,
    liquid: short.fresh && long.fresh && Math.abs((short.sourceAge ?? 0) - (long.sourceAge ?? 0)) <= 2000,
    roundTripFriction: Math.max(0, closeDebit - conservativeCredit) * 100, midSlippage: Math.max(0, midCredit - conservativeCredit) * 100 };
  const credit = input.manualCredit ?? (input.basis === 'bidAsk' ? conservativeCredit : midCredit);
  if (!nonnegative(input.fees) || !Number.isFinite(input.ivShockPp) || Math.abs(input.ivShockPp) > 50 || !nonnegative(credit) || credit >= width || midCredit < 0 || midCredit > width) return unavailable('权利金、手续费或价差报价不满足垂直价差边界；仍可查看双腿成本。', quoteSummary);
  const expiryAt = qqqGammaExpiryTime(input.expiry), remaining = expiryAt - cutoff;
  if (!(remaining > 0)) return unavailable('所选期权已到期；以下双腿成本为保存快照。', quoteSummary);
  const summary = { ...quoteSummary, credit,
    maxProfit: credit * 100 - input.fees, maxLoss: (width - credit) * 100 + input.fees,
    breakeven: input.fees > credit * 100 ? null : side === 'put' ? shortStrike - credit + input.fees / 100 : shortStrike + credit - input.fees / 100 };
  const spot = input.spot;
  if (spot === null || !Number.isFinite(spot) || spot <= 0 || !qqqIvUsable(short.iv) || !qqqIvUsable(long.iv) || !qqqIvUsable(short.iv + input.ivShockPp / 100) || !qqqIvUsable(long.iv + input.ivShockPp / 100)) return { available: true as const, ...summary, scenarios: null, greeks: null, scenarioReason: '缺少同期现价或有效双腿 IV，流动性仍可观察' };
  const price = (s: number, strike: number, iv: number, ms: number) => blackScholesEngine.price({ S: s, K: strike, sigma: iv, T: Math.max(0, ms) / (365 * 86400_000), r: 0, type: side });
  const shortNow = price(spot, shortStrike, short.iv, remaining), longNow = price(spot, longStrike, long.iv, remaining), baseDebit = shortNow.price - longNow.price;
  const scenarios = [-1, -.5, 0, .5, 1].map(move => ({ move, cells: [0, 15, 30].map(minutes => {
    const s = spot * (1 + move / 100), ms = remaining - minutes * 60_000;
    const intrinsic = (strike: number) => Math.max(0, side === 'call' ? s - strike : strike - s);
    const modeledDebit = ms <= 0 ? intrinsic(shortStrike) - intrinsic(longStrike) : price(s, shortStrike, short.iv! + input.ivShockPp / 100, ms).price - price(s, longStrike, long.iv! + input.ivShockPp / 100, ms).price;
    const debit = Math.max(0, Math.min(width, ms <= 0 ? modeledDebit : midCredit + modeledDebit - baseDebit));
    return { minutes, settled: ms <= 0, debit, pnl: (credit - debit) * 100 - input.fees };
  }) }));
  return { available: true as const, ...summary, scenarios, scenarioReason: null,
    greeks: { delta: (longNow.delta - shortNow.delta) * 100, gamma: (longNow.gamma - shortNow.gamma) * 100, theta: (longNow.theta - shortNow.theta) * 100, vega: (longNow.vega - shortNow.vega) * 100 } };
}
