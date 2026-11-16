/** Quote search mechanics only. The caller owns all bounds, expiry and risk policy. */
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import {resolveOptionQuote} from '../optionQuote';
import type {PutCreditSpreadOpen} from './put-spread-kernel-v6';
export type PutSpreadBounds={maximumShortDelta:number;maximumWidth:number;minimumNetCredit:number;commissionPerContract:number;maximumRelativeSpread?:number;targetShortDelta?:number};
export function assertPutSpreadBounds(value:unknown):asserts value is PutSpreadBounds{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid put spread bounds');
  const b=value as PutSpreadBounds;
  if(Object.keys(b).some(k=>!['maximumShortDelta','maximumWidth','minimumNetCredit','commissionPerContract','maximumRelativeSpread','targetShortDelta'].includes(k))
    ||!Number.isFinite(b.maximumShortDelta)||b.maximumShortDelta<=0||b.maximumShortDelta>1
    ||!Number.isFinite(b.maximumWidth)||b.maximumWidth<=0
    ||!Number.isFinite(b.minimumNetCredit)||b.minimumNetCredit<0
    ||!Number.isFinite(b.commissionPerContract)||b.commissionPerContract<0
    ||(b.maximumRelativeSpread!==undefined&&(!Number.isFinite(b.maximumRelativeSpread)||b.maximumRelativeSpread<=0||b.maximumRelativeSpread>2))
    ||(b.targetShortDelta!==undefined&&(!Number.isFinite(b.targetShortDelta)||b.targetShortDelta<=0||b.targetShortDelta>b.maximumShortDelta)))throw Error('Invalid put spread bounds');
}
export function selectBoundedPutSpread(chain:OptionChain,asOf:string,targetDte:number,bounds:PutSpreadBounds,expanded=false):PutCreditSpreadOpen|undefined{
  assertPutSpreadBounds(bounds);
  const expiries=[...chain.expirations].filter(e=>e.date>asOf).sort((a,b)=>
    Math.abs((Date.parse(a.date)-Date.parse(asOf))/86400000-targetDte)-Math.abs((Date.parse(b.date)-Date.parse(asOf))/86400000-targetDte)||a.date.localeCompare(b.date));
  for(const expiry of expanded?expiries:expiries.slice(0,1)){
    const puts=expiry.puts.filter(p=>Number.isFinite(p.strike)&&p.strike>0&&Number.isFinite(p.delta)&&p.delta<=0
      &&Math.abs(p.delta)<=bounds.maximumShortDelta&&Number.isFinite(p.openInterest)&&p.openInterest>0&&Number.isFinite(p.volume)&&p.volume>=0)
      .flatMap(p=>{const quote=resolveOptionQuote(p,bounds.maximumRelativeSpread??.5);return quote?[{put:p,quote}]:[];});
    const choices=puts.flatMap(short=>puts.flatMap(long=>{
      const width=short.put.strike-long.put.strike,credit=short.quote.sell-long.quote.buy,maxLoss=width*100-credit*100;
      if(width<=0||width>bounds.maximumWidth||credit*100-2*bounds.commissionPerContract<bounds.minimumNetCredit||credit<=0||maxLoss<=0)return [];
      return [{short,long,credit,maxLoss}];
    })).sort((a,b)=>(bounds.targetShortDelta===undefined?Math.abs(b.short.put.delta)-Math.abs(a.short.put.delta)
      :Math.abs(Math.abs(a.short.put.delta)-bounds.targetShortDelta)-Math.abs(Math.abs(b.short.put.delta)-bounds.targetShortDelta))||b.credit-a.credit||a.maxLoss-b.maxLoss||a.long.put.strike-b.long.put.strike);
    const best=choices[0];
    if(best)return {underlying:'QQQ',expiry:expiry.date,shortStrike:best.short.put.strike,longStrike:best.long.put.strike,
      quantity:1,credit:best.credit,maxLoss:best.maxLoss,pairSearchUsed:true};
  }
  return undefined;
}
