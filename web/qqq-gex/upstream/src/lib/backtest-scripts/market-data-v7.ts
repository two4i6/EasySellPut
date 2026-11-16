/** Immutable run-local market coordinates. No strategy admission or account state. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import {calcRealizedVol,createRollingIndicators} from '../engines/leveraged-overlay/utils';
import {normalizeVolIndexForMockOptions} from '../engines/leveraged-overlay/backtest/mockOptions';

export function createMarketDataModule(data:MarketDataSet){
  const indexes=new WeakMap<object,Map<string,number>>();
  let lastRv:{asOf:string;value:number}|undefined;
  let horizonDate:string|undefined;
  const horizons=new Map<string,number>();
  let qqqIndicators:ReturnType<typeof createRollingIndicators>|undefined;
  const indexOf=(bars:MarketDataSet['qqqBars'],asOf:string)=>{
    let index=indexes.get(bars);
    if(!index){index=new Map(bars.map((bar,i)=>[bar.date,i]));indexes.set(bars,index);}
    return index.get(asOf);
  };
  return {
    assertData(actual:MarketDataSet){if(actual!==data)throw Error('Market data module belongs to another data instance');},
    indexOf,
    /** Current QQQ close and strictly preceding TQQQ session; no strategy thresholds. */
    callExitFacts(asOf:string){
      const i=indexOf(data.qqqBars,asOf);
      if(i===undefined)throw Error('Call exit observation requires actual QQQ session');
      const rolling=qqqIndicators??=createRollingIndicators(data.qqqBars);
      let lo=0,hi=data.tqqqBars.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(data.tqqqBars[mid]!.date<asOf)lo=mid+1;else hi=mid;}
      const prior=lo-1,previousTqqq=prior>=20?data.tqqqBars[prior-20]!.close:0;
      const sma20=rolling.smaAt(i,20),previousSma20=i>=5?rolling.smaAt(i-5,20):0;
      const {pricingVol,pricingVol3m}=this.executionVolatility(asOf);
      return {pricingVol,pricingVol3m:pricingVol3m??null,
        priorTqqqRoc20:prior>=20&&previousTqqq!==0?(data.tqqqBars[prior]!.close-previousTqqq)/previousTqqq:null,
        qqqRoc5:rolling.rocAt(i,5),qqqRoc20:rolling.rocAt(i,20),
        sma20SlopePct:previousSma20>0?(sma20-previousSma20)/previousSma20:null,highPrice:data.qqqBars[i]!.close};
    },
    previousSession(asOf:string){
      let lo=0,hi=data.qqqBars.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(data.qqqBars[mid]!.date<asOf)lo=mid+1;else hi=mid;}
      if(!lo)throw Error(`Opening execution requires preceding session: ${asOf}`);
      return data.qqqBars[lo-1]!.date;
    },
    replayBars(startDate:string,endDate:string){
      const availableEnd=[data.qqqBars.at(-1)!.date,data.tqqqBars.at(-1)!.date,endDate].sort()[0]!;
      return data.qqqBars.filter(bar=>bar.date>=startDate&&bar.date<=availableEnd);
    },
    annualizedQqqRv20(asOf:string){
      if(lastRv?.asOf===asOf)return lastRv.value;
      const index=indexOf(data.qqqBars,asOf);
      if(index===undefined)throw Error('PCS analytics missing as-of bar');
      const value=calcRealizedVol(data.qqqBars.slice(Math.max(0,index-20),index+1).map(b=>b.close),20);
      lastRv={asOf,value};return value;
    },
    /** Inherited weekday horizon, NOT exchange sessions or calendar-day DTE. */
    weekdayHorizon(asOf:string,expiry:string){
      if(horizonDate!==asOf){horizons.clear();horizonDate=asOf;}
      const cached=horizons.get(expiry);if(cached!==undefined)return cached;
      let horizon=0;
      const cursor=new Date(`${asOf}T00:00:00Z`),end=Date.parse(`${expiry}T00:00:00Z`);
      while(cursor.getTime()<end){cursor.setUTCDate(cursor.getUTCDate()+1);if(cursor.getUTCDay()%6!==0)horizon++;}
      if(horizons.size>=128)horizons.delete(horizons.keys().next().value!);
      horizons.set(expiry,horizon);return horizon;
    },
    /** Execution normalization differs from strategy raw-volatility coordinates. */
    executionVolatility(asOf:string){
      const vix=data.vixByDate[asOf];
      if(!Number.isFinite(vix)||!(vix>0))throw Error(`Missing as-of VIX: ${asOf}`);
      const vxn=data.vxnByDate[asOf];
      const pricingVol=vxn===undefined?vix:normalizeVolIndexForMockOptions(vxn,'VXN');
      if(!Number.isFinite(pricingVol)||pricingVol<=0)throw Error(`Invalid as-of VXN: ${asOf}`);
      const term=data.vix3mByDate[asOf];
      const pricingVol3m=term===undefined?undefined:term*(pricingVol/vix);
      if(pricingVol3m!==undefined&&(!Number.isFinite(pricingVol3m)||pricingVol3m<=0))throw Error(`Invalid as-of VIX3M: ${asOf}`);
      return {vix,pricingVol,pricingVol3m};
    },
  };
}
export type MarketDataModule=ReturnType<typeof createMarketDataModule>;
