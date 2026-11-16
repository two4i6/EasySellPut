/** Pure call valuation; no admission, account state or execution quote cache. */
import {closeOptionPosition,createLegacyOptionMarket,settleOptionPosition,type OptionPricing} from '../engines/leveraged-overlay/v2/options';
import {dividendYieldForSymbol,effectiveVix,quoteOptionStrike} from '../engines/leveraged-overlay/backtest/mockOptions';
import type {CallCreditSpreadPosition} from '../engines/leveraged-overlay/v2/strategies/call-credit-spread';

export function closeCallSpreadAtMark(position:CallCreditSpreadPosition,asOf:string,spot:number,vol:number,
  _reason:string,pricing:OptionPricing,vol3m?:number){
  const symbol=position.underlying??'QQQ';
  const closed=closeOptionPosition({openingCashImpact:position.creditReceived,legs:[
    {symbol,type:'call',side:'short',strike:position.shortStrike,expiry:position.expiry,quantity:position.quantity},
    {symbol,type:'call',side:'long',strike:position.longStrike,expiry:position.expiry,quantity:position.quantity},
  ]},createLegacyOptionMarket({asOfDate:asOf,prices:{[symbol]:spot},vix:vol,vix3m:vol3m}),pricing);
  const [short,long]=closed.legQuotes;
  const costPerShare=short&&long?Math.max(0,short.ask-long.bid):0;
  const cashImpact=-costPerShare*100*position.quantity;
  return {cashImpact,pnl:position.creditReceived+cashImpact,costPerShare};
}

export function finalizeCallSpread(input:{position:CallCreditSpreadPosition;asOfDate:string;qqqClose:number;
  vix:number;vix3m?:number;pricing:OptionPricing;commission:number}){
  const {position,asOfDate,qqqClose,vix,vix3m,pricing,commission}=input;
  if(position.expiry<=asOfDate){
    const symbol=position.underlying??'QQQ';
    return {...settleOptionPosition({openingCashImpact:position.creditReceived,legs:[
      {symbol,type:'call',side:'short',strike:position.shortStrike,expiry:'',quantity:position.quantity},
      {symbol,type:'call',side:'long',strike:position.longStrike,expiry:'',quantity:position.quantity},
    ]},createLegacyOptionMarket({asOfDate:'',prices:{[symbol]:qqqClose},vix:20})),settled:true};
  }
  const marked=closeCallSpreadAtMark(position,asOfDate,qqqClose,vix,'terminal',pricing,vix3m);
  const cashImpact=marked.cashImpact-commission;
  return {cashImpact,pnl:position.creditReceived+cashImpact,costPerShare:marked.costPerShare,settled:false};
}

/** Same one-day minimum and term arithmetic as native marking, not a fill quote. */
export function callSpreadShortDelta(position:CallCreditSpreadPosition,asOf:string,spot:number,vol:number,
  pricing:OptionPricing,vol3m?:number){
  const days=Math.max(0,(Date.parse(position.expiry)-Date.parse(asOf))/86400000),symbol=position.underlying??'QQQ';
  return quoteOptionStrike({symbol,rawSpot:spot,rawStrike:position.shortStrike,pricingYears:Math.max(days/365,1/365),
    effectiveVol:effectiveVix(vol,vol3m,days),riskFreeRate:pricing.riskFreeRate,skewSlope:pricing.skewSlope,
    spreadMultiplier:pricing.spreadMultiplier,dividendYield:dividendYieldForSymbol(symbol)}).callDelta;
}
