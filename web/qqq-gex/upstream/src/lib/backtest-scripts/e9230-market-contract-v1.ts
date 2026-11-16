/** Exact causal feature/quote surface used in recovered E9230 validation. E book only. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {StrategySnapshot,StrategyObject} from './strategy-module-v2';
import type {QqqSpreadAdapterConfig} from './qqq-spread-adapter-v2';
import {createQqqMarketContext} from './qqq-market-context-v5';
export const E9230_PUT_DTES=[7,14,21,28,35,49] as const;
export function createE9230SnapshotMapper(data:MarketDataSet,config:QqqSpreadAdapterConfig){
 const market=createQqqMarketContext(data),features=new Map<string,StrategyObject>();
 for(let j=63;j<data.qqqBars.length;j++){
  const bars=data.qqqBars.slice(0,j+1),close=bars.at(-1)!.close,tail=bars.slice(-63),tail20=bars.slice(-20),returns=bars.slice(-64).slice(1).map((b,k)=>Math.log(b.close/bars[j-63+k]!.close)),rv=(r:number[])=>{const mean=r.reduce((a,b)=>a+b,0)/r.length;return Math.sqrt(r.reduce((a,b)=>a+(b-mean)**2,0)/r.length*252);};
  features.set(bars.at(-1)!.date,{roc63:close/bars.at(-64)!.close-1,roc5:close/bars.at(-6)!.close-1,range63:Math.max(...tail.map(b=>b.high))/Math.min(...tail.map(b=>b.low))-1,drawdown20:1-close/Math.max(...tail20.map(b=>b.high)),rv20:rv(returns.slice(-20)),rv63:rv(returns),latestObservation:bars.at(-1)!.date});
 }
 return (snapshot:StrategySnapshot):StrategySnapshot=>{
  const sources=snapshot.market.sourceAccounts as any,book=sources?.e209;if(!book)throw Error('E9230 requires E source book');
  const asOf=snapshot.asOf,bar=book.market.qqq,close=Number(bar.close),{pricingVol,pricingVol3m}=market.data.executionVolatility(asOf),bars=data.qqqBars.filter(b=>b.date<=asOf),extreme=features.get(asOf);if(!extreme)throw Error('E9230 requires63-day warmup');
  const eMarket={...book.market,chain:market.decisionChain(asOf,close,pricingVol,pricingVol3m,config.pricing,config.realStrikeGrid,config.liquidityModel),extremePathResearch:extreme,maturityExtension:market.decisionChain(asOf,close,pricingVol,pricingVol3m,config.pricing,config.realStrikeGrid,config.liquidityModel,[{targetDte:14,types:['put']},{targetDte:21,types:['put']}]),restorationResearch:{close,sma20:bars.slice(-20).reduce((a,b)=>a+b.close,0)/20,sma50:bars.slice(-50).reduce((a,b)=>a+b.close,0)/50,roc20:close/bars.at(-21)!.close-1,roc5:close/bars.at(-6)!.close-1}};
  return {...snapshot,market:{...snapshot.market,sourceAccounts:{...sources,e209:{...book,market:eMarket}} as unknown as StrategyObject}};
 };
}
