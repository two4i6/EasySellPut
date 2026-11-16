/** Strategy-neutral current-quote pair search with independently declared protection quote tolerance. */
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import {resolveOptionQuote} from '../optionQuote';
import {assertPutSpreadBounds,type PutSpreadBounds} from './bounded-put-spread-selection-v1';
import type {PutCreditSpreadOpen} from './put-spread-kernel-v6';
export function selectAsymmetricPutSpread(chain:OptionChain,asOf:string,targetDte:number,bounds:PutSpreadBounds,maximumProtectionSpread:number):PutCreditSpreadOpen|undefined{
  assertPutSpreadBounds(bounds);
  if(!Number.isFinite(maximumProtectionSpread)||maximumProtectionSpread<=0||maximumProtectionSpread>2)throw Error('Invalid protection quote tolerance');
  const expiry=[...chain.expirations].filter(e=>e.date>asOf).sort((a,b)=>
    Math.abs((Date.parse(a.date)-Date.parse(asOf))/86400000-targetDte)-Math.abs((Date.parse(b.date)-Date.parse(asOf))/86400000-targetDte)||a.date.localeCompare(b.date))[0];
  if(!expiry)return undefined;
  const eligible=expiry.puts.filter(p=>Number.isFinite(p.strike)&&p.strike>0&&Number.isFinite(p.delta)&&p.delta<=0
    &&Math.abs(p.delta)<=bounds.maximumShortDelta&&Number.isFinite(p.openInterest)&&p.openInterest>0&&Number.isFinite(p.volume)&&p.volume>=0);
  const quoted=(tolerance:number)=>eligible.flatMap(p=>{const quote=resolveOptionQuote(p,tolerance);return quote?[{put:p,quote}]:[];});
  const shorts=quoted(bounds.maximumRelativeSpread??.5),longs=quoted(maximumProtectionSpread);
  const choices=shorts.flatMap(short=>longs.flatMap(long=>{
    const width=short.put.strike-long.put.strike,credit=short.quote.sell-long.quote.buy,maxLoss=width*100-credit*100;
    if(width<=0||width>bounds.maximumWidth||credit*100-2*bounds.commissionPerContract<bounds.minimumNetCredit||credit<=0||maxLoss<=0)return [];
    return [{short,long,credit,maxLoss}];
  })).sort((a,b)=>(bounds.targetShortDelta===undefined?Math.abs(b.short.put.delta)-Math.abs(a.short.put.delta)
    :Math.abs(Math.abs(a.short.put.delta)-bounds.targetShortDelta)-Math.abs(Math.abs(b.short.put.delta)-bounds.targetShortDelta))
    ||b.credit-a.credit||a.maxLoss-b.maxLoss||a.long.put.strike-b.long.put.strike);
  const best=choices[0];
  return best?{underlying:'QQQ',expiry:expiry.date,shortStrike:best.short.put.strike,longStrike:best.long.put.strike,
    quantity:1,credit:best.credit,maxLoss:best.maxLoss,pairSearchUsed:true}:undefined;
}
