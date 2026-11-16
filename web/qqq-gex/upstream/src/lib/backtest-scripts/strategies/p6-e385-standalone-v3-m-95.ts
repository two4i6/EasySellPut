/** P6 v3-m-95: fixed $40 wing cap and next-open, net-profit-limited exits. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategyObject} from '../strategy-module-v2';
import {p6E385StandaloneV3} from './p6-e385-standalone-v3';

export const P6_V3_M_95_VERSION='p6-e385-standalone-v3-m-95';
export const P6_V3_M_95_MANAGEMENT=freezeStrategyData({maximumSpreadWidth:40,takeProfitFraction:.95,
  lastWeekCalendarDte:7,lastWeekProfitFraction:.5,execution:'next-open-net-profit-limit',
  unfilled:'retain-position',terminal:'mark-only',longProtectionFallback:'same-short-expiry-within-declared-width'});

/** Base owns entry eligibility, analytics, feedback and settlement state. */
export function withP6V3M95(base:BarStrategyModule):BarStrategyModule{
  const management=P6_V3_M_95_MANAGEMENT;
  const defaults=freezeStrategyData({...base.params,exitMode:'profit-limited',management});
  const checked=(params:Readonly<StrategyObject>)=>assertFixedStrategyParams(params,defaults);
  return {
    manifest:{...base.manifest,version:P6_V3_M_95_VERSION},params:defaults,
    initialize(params){checked(params);return base.initialize(base.params);},
    planObservations:base.planObservations?input=>{checked(input.params);
      return base.planObservations!({...input,params:base.params});}:undefined,
    onFeedback:base.onFeedback?input=>{checked(input.params);
      return base.onFeedback!({...input,params:base.params});}:undefined,
    onBar(input){
      checked(input.params);
      const step=base.onBar({...input,params:base.params});
      let changed=0,unavailable=0;
      const entries:StrategyIntent[]=step.intents.flatMap<StrategyIntent>(intent=>{
        if(intent.kind!=='open-spread')return [intent];
        const c=intent.contract,short=Number(c.shortStrike),originalLong=Number(c.longStrike);
        const maximumWidth=Math.min(short-originalLong,management.maximumSpreadWidth);
        let longStrike=originalLong;
        if(short-originalLong>maximumWidth){
          const chain=input.snapshot.market.chain as StrategyObject;
          if(!chain||!Array.isArray(chain.expirations))throw Error('Missing current P6 chain');
          const expiry=(chain.expirations as StrategyObject[]).find(e=>e.date===c.expiry);
          const long=Array.isArray(expiry?.puts)?(expiry.puts as StrategyObject[])
            .filter(p=>Number(p.strike)>=short-maximumWidth&&Number(p.strike)>=originalLong&&Number(p.strike)<short)
            .sort((a,b)=>Number(a.strike)-Number(b.strike))[0]:undefined;
          if(!long){unavailable++;return [];}
          longStrike=Number(long.strike);if(longStrike>originalLong)changed++;
        }
        return [{...intent,contract:{...c,longStrike},risk:{...intent.risk,longProtectionFallback:{maximumWidth}}}];
      });
      const exits:StrategyIntent[]=[];
      if(input.snapshot.market.sampleTerminal!==true)for(const p of input.snapshot.positions){
        if(p.entrySource!=='p6-e385')continue;
        const credit=Number(p.creditReceived),mark=Number(p.markPnl);
        const dte=(Date.parse(String(p.expiry))-Date.parse(input.snapshot.asOf))/86400000;
        if(!(credit>0)||!Number.isFinite(mark)||!Number.isFinite(dte))throw Error('Missing P6 close economics');
        let floor:number|undefined,reason='last-week-positive-release';
        if(dte<=management.lastWeekCalendarDte&&mark>=credit*management.lastWeekProfitFraction)
          floor=credit*management.lastWeekProfitFraction;
        if(mark>=credit*management.takeProfitFraction){
          floor=Math.min(floor??Infinity,credit*management.takeProfitFraction);reason='early-profit-release';
        }
        if(floor!==undefined)exits.push({kind:'close-position',key:`p6-capital-close:${String(p.id)}:${input.snapshot.asOf}`,
          positionId:String(p.id),reason,minimumUnweightedPnl:floor});
      }
      return {...step,intents:[...exits,...entries],plots:{...step.plots,management:'v3-m-95',profitLimitCloses:exits.length,
        widthChanged:changed,widthUnavailable:unavailable}};
    },
  };
}
export const p6E385StandaloneV3M95=withP6V3M95(p6E385StandaloneV3);
