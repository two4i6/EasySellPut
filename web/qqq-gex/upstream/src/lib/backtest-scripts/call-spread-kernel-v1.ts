/** Pure call construction, checked against the unchanged legacy implementation. */
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import type {OverlayOpenResult,OverlayPosition} from '../engines/leveraged-overlay/v2/base';
import {findContractByDelta,findNearestExpiry} from '../engines/leveraged-overlay/utils';
import {validateCallCreditSpread} from '../engines/leveraged-overlay/overlayValidation';

export type CallCreditSpreadOpen = OverlayPosition & { shortStrike: number; longStrike: number; credit?: number; maxLoss: number; riskBudgetUsed?: number };

type CallCreditSpreadOpenInput = { chain: OptionChain; date: string; targetDte: number; widthPct: number; nav: number; riskBudget: number; shortDelta?: number; shortStrikeSigma?: number; dailySigma20?: number; forceMinimumContract?: boolean; independent?: boolean; underlying?: string };

/** One synchronous evaluation of an unchanged chain/date/DTE; recreate after any chain mutation. */
export function createCallCreditSpreadPreparation(input: Pick<CallCreditSpreadOpenInput, 'chain' | 'date' | 'targetDte'>) {
  const {chain,date,targetDte}=input;
  const prepare=()=>{
    const expiry=findNearestExpiry(chain.expirations,date,targetDte);
    const expiration=chain.expirations.find(item=>item.date===expiry);
    if(!expiry||!expiration)return null;
    let calls:typeof expiration.calls|undefined;
    const pool=()=>calls??=expiration.calls;
    const deltas=new Map<number,ReturnType<typeof findContractByDelta>>();
    const sigmas=new Map<number,typeof expiration.calls[number]|undefined>();
    const longs=new Map<number,Map<number,number|undefined>>();
    const mids=new Map<number|undefined,typeof expiration.calls[number]|undefined>();
    return {
      expiry,
      short(delta:number,targetStrike:number|undefined){
        if(targetStrike===undefined){
          if(!deltas.has(delta))deltas.set(delta,findContractByDelta(pool(),delta));
          return deltas.get(delta);
        }
        if(!sigmas.has(targetStrike))sigmas.set(targetStrike,pool().filter(call=>call.strike>chain.spot)
          .sort((left,right)=>Math.abs(left.strike-targetStrike)-Math.abs(right.strike-targetStrike))[0]);
        return sigmas.get(targetStrike);
      },
      long(shortStrike:number,targetStrike:number){
        let targets=longs.get(shortStrike);
        if(!targets){targets=new Map();longs.set(shortStrike,targets);}
        if(!targets.has(targetStrike))targets.set(targetStrike,pool().filter(call=>call.strike>shortStrike)
          .sort((a,b)=>Math.abs(a.strike-targetStrike)-Math.abs(b.strike-targetStrike))[0]?.strike);
        return targets.get(targetStrike);
      },
      mid(strike:number|undefined){
        if(!mids.has(strike))mids.set(strike,pool().find(call=>call.strike===strike));
        return mids.get(strike);
      },
    };
  };
  let prepared:ReturnType<typeof prepare>|undefined;
  return (current:Pick<CallCreditSpreadOpenInput,'chain'|'date'|'targetDte'>)=>{
    if(current.chain!==chain||current.date!==date||current.targetDte!==targetDte)
      throw new Error('CCS preparation coordinates changed');
    return prepared===undefined?prepared=prepare():prepared;
  };
}

export function buildCallCreditSpreadOpen(input: CallCreditSpreadOpenInput,
  preparation?:ReturnType<typeof createCallCreditSpreadPreparation>): OverlayOpenResult<CallCreditSpreadOpen> {
  const prepared=(preparation??createCallCreditSpreadPreparation(input))(input);
  if (!prepared) return {};
  const {expiry}=prepared;
  if (input.shortStrikeSigma !== undefined && (!(input.dailySigma20 && input.dailySigma20 > 0) || !Number.isFinite(input.dailySigma20) || !(input.shortStrikeSigma > 0) || !Number.isFinite(input.shortStrikeSigma))) {
    return { warning: 'Call Credit Spread：日频 σ20 不可用，无法按距离选取短 Call' };
  }
  const targetShortStrike = input.shortStrikeSigma === undefined
    ? undefined
    : input.chain.spot * (1 + input.shortStrikeSigma * input.dailySigma20!);
  const shortCall = prepared.short(input.shortDelta ?? 0.20,targetShortStrike);
  const shortStrike = shortCall?.strike ?? input.chain.spot * 1.05;
  const targetLongStrike = shortStrike + Math.round(input.chain.spot * input.widthPct / 5) * 5;
  const longStrike = prepared.long(shortStrike,targetLongStrike);
  const underlying = input.underlying ?? 'QQQ';
  const validation = validateCallCreditSpread({ underlying, shortCallStrike: shortStrike, longCallStrike: longStrike });
  if (!validation.ok || longStrike === undefined) return { warning: validation.reason };
  const shortMid = prepared.mid(shortCall?.strike);
  const longMid = prepared.mid(longStrike);
  const credit = shortMid && longMid ? (shortMid.bid + shortMid.ask) / 2 - (longMid.bid + longMid.ask) / 2 : undefined;
  const maxLoss = Math.max(1, (longStrike - shortStrike) * 100 - (credit ?? 0) * 100);
  let quantity = Math.floor(input.nav * input.riskBudget / maxLoss);
  if (quantity < 1) {
    if (!input.forceMinimumContract) return { warning: `Call Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），跳过` };
    quantity = 1;
    return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined }, warning: `Call Credit Spread：NAV 预算不足以开 1 张（maxLoss/张=$${maxLoss.toFixed(0)}），[FMQ0]强制开1张，超预算${(maxLoss / (input.nav * input.riskBudget) * 100).toFixed(0)}%` };
  }
  return { open: { shortStrike, longStrike, expiry, credit, maxLoss, quantity, underlying, riskBudgetUsed: input.nav > 0 ? quantity * maxLoss / input.nav : undefined } };
}
