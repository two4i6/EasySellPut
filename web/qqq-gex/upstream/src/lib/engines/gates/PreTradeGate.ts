import { FactorMap } from '../../../types/factor';
import { OptionChain } from '../pricing/OptionChainEngine';
import { resolveOptionQuote } from '../../optionQuote';

export type PreTradeHardGate =
  | 'DATA_QUALITY_LOW'      // IV confidence < 3
  | 'LIQUIDITY_INSUFFICIENT' // volume < MIN_VOLUME
  | 'SPREAD_TOO_WIDE'       // bid/ask spread > MAX_SPREAD
  | 'DATA_STALE'            // 数据超过 5 分钟
  | 'CHAIN_MISSING'         // 无可用期权链

export interface PreTradeGateDecision {
  blocked: boolean;                   // 任意 hard_gate 触发 → true → 立即短路
  hard_gates: PreTradeHardGate[];
  data_quality: 'high' | 'medium' | 'low';
  timestamp_valid: boolean;
}

const MAX_SPREAD = 2.0; // placeholder for bid/ask spread threshold
const MIN_VOLUME = 1000; // placeholder for volume threshold
const DATA_FRESHNESS_MS = 5 * 60 * 1000;

export class PreTradeGate {
  public static evaluate(factors: FactorMap, chain?: OptionChain, timestamps: Record<string, number> = {}): PreTradeGateDecision {
    const hard_gates: PreTradeHardGate[] = [];
    
    // 1. Data Stale Check
    const factorsTimestamp = timestamps.factors ?? 0;
    const evaluatedAt = timestamps.evaluatedAt ?? Date.now();
    if (evaluatedAt - factorsTimestamp > DATA_FRESHNESS_MS) {
      hard_gates.push('DATA_STALE');
    }

    // 2. Chain Missing Check
    const hasChain = !!chain?.expirations?.length;
    if (!hasChain) {
      hard_gates.push('CHAIN_MISSING');
    }

    const putQuotes = hasChain
      ? chain!.expirations.flatMap(expiration => expiration.options ?? [])
        .filter(option => option.type === 'Put')
        .map(option => resolveOptionQuote(option, 0.2, evaluatedAt / 1000))
        .filter((quote): quote is NonNullable<typeof quote> => quote !== null)
      : [];
    if (hasChain && putQuotes.length === 0) hard_gates.push('LIQUIDITY_INSUFFICIENT');

    // 3. Data Quality Check
    const ivConf = factors.iv_rank?.confidence ?? 0;
    if (ivConf < 3) {
      hard_gates.push('DATA_QUALITY_LOW');
    }

    // 4. Liquidity & Spread Check
    const spread = factors.atm_bid_ask_spread?.value ?? 0;
    if (spread > MAX_SPREAD) {
      hard_gates.push('SPREAD_TOO_WIDE');
    }

    const volume = factors.volume?.value ?? 0;
    if (volume > 0 && volume < MIN_VOLUME) { 
       // simplified, only check if volume is present and too low
       hard_gates.push('LIQUIDITY_INSUFFICIENT');
    }

    // confidence < 3 = 低质量，< 7 = 中等，>= 7 = 高质量
    const onlyLastTrade = putQuotes.length > 0 && putQuotes.every(quote => quote.source === 'last_trade');
    const data_quality = ivConf >= 7 && !onlyLastTrade ? 'high' : ivConf >= 3 ? 'medium' : 'low';

    return {
      blocked: hard_gates.length > 0,
      hard_gates,
      data_quality,
      timestamp_valid: !hard_gates.includes('DATA_STALE')
    };
  }
}
