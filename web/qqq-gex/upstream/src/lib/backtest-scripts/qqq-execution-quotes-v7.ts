/** Scheduled-execution market computation; no fills, sizing, admission or account state. */
import {buildMockOptionChain} from '../engines/leveraged-overlay/backtest/mockOptions';
import type {OptionPricing} from '../engines/leveraged-overlay/v2/options';
import type {StrategyObject} from './strategy-module-v2';
import {createQqqMarketContext,type QqqMarketContext} from './qqq-market-context-v5';
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';

export function createQqqExecutionQuotes(data:MarketDataSet,input:{
  pricing:OptionPricing;realStrikeGrid:boolean;liquidityModel:boolean;putMaturityMode?:'extended-365-v1'},market?:QqqMarketContext){
  market?.assertData(data);
  const computation=market??createQqqMarketContext(data,false),coordinates=computation.data;
  const {pricing,realStrikeGrid,liquidityModel}=input;
  if(input.putMaturityMode!==undefined&&input.putMaturityMode!=='extended-365-v1')throw Error('Invalid execution put maturity mode');
  const maximumDte=input.putMaturityMode?365:75;
  // Keep date indexes run-local even when cross-book chain sharing is disabled.
  const forSession=(asOf:string,role:'next-open'|'terminal-close')=>{
  if(role!=='next-open'&&role!=='terminal-close')throw Error('Unsupported execution quote role');
  const index=coordinates.indexOf(data.qqqBars,asOf);
  if(index===undefined)throw Error(`Execution quote requires actual session: ${asOf}`);
  const bar=data.qqqBars[index]!;
  const quoteAsOf=role==='terminal-close'?asOf:coordinates.previousSession(asOf);
  const {vix,pricingVol,pricingVol3m}=coordinates.executionVolatility(quoteAsOf);
  const spot=role==='terminal-close'?bar.close:bar.open;
  const grid=computation.executionGrid(role,quoteAsOf,asOf,spot,realStrikeGrid,maximumDte),{expiries}=grid;
  type Options=NonNullable<Parameters<typeof buildMockOptionChain>[6]>;
  const build=(contracts:Pick<Options,'contracts'|'decisionContracts'>)=>{
    const args:Parameters<typeof buildMockOptionChain>=[asOf,spot,pricingVol,'QQQ',pricing.spreadMultiplier,pricing.skewSlope,{
      vix3m:pricingVol3m,riskFreeRate:pricing.riskFreeRate,expiryCalendar:true,realStrikeGrid,liquidityModel,...(input.putMaturityMode?{expiryHorizonDays:365 as const}:{}),...contracts}];
    return market?market.executionChain(role,quoteAsOf,args):buildMockOptionChain(...args);
  };
  const sourceExpiry=(expiry:string,targetDte:number)=>expiries.includes(expiry)?expiry:expiries.reduce((best,candidate)=>
    Math.abs((Date.parse(candidate)-Date.parse(asOf))/86400000-targetDte)
      <Math.abs((Date.parse(best)-Date.parse(asOf))/86400000-targetDte)?candidate:best);
  return {
    coordinates:Object.freeze({quoteAsOf,spot,vix,pricingVol,pricingVol3m}),
    parentChain(contracts:readonly StrategyObject[]){
      const grouped=new Map<string,{expiry:string;pricingDte:number;strikes:number[];types:['put']}>();
      for(const c of contracts){
        const expiry=String(c.expiry),targetDte=Number(c.targetDte);
        const prior=grouped.get(expiry)??{expiry,pricingDte:(Date.parse(sourceExpiry(expiry,targetDte))-Date.parse(asOf))/86400000,strikes:[],types:['put']};
        for(const strike of [Number(c.shortStrike),Number(c.longStrike)])if(grid.hasStrike(strike)&&!prior.strikes.includes(strike))prior.strikes.push(strike);
        grouped.set(expiry,prior);
      }
      return build({contracts:[...grouped.values()]});
    },
    quote(contract:StrategyObject){
      const expiry=String(contract.expiry),targetDte=Number(contract.targetDte),shortStrike=Number(contract.shortStrike),longStrike=Number(contract.longStrike);
      const type=contract.type==='call'?'call':'put';
      const chain=build({contracts:[{expiry,pricingDte:(Date.parse(sourceExpiry(expiry,targetDte))-Date.parse(asOf))/86400000,
        strikes:[shortStrike,longStrike].filter(strike=>grid.hasStrike(strike)),types:[type]}]});
      const legs=type==='call'?chain.expirations[0]!.calls:chain.expirations[0]!.puts;
      return {short:legs.find(leg=>leg.strike===shortStrike),long:legs.find(leg=>leg.strike===longStrike)};
    },
    retryChain(targetDte:number,expanded:boolean){
      return build(expanded?{contracts:expiries.map(expiry=>({expiry,pricingDte:(Date.parse(expiry)-Date.parse(asOf))/86400000,
        strikes:[...grid.strikes],types:['put'] as const}))}:{decisionContracts:[{targetDte,types:['put'] as const}]});
    },
  };
  };
  return {forSession};
}
