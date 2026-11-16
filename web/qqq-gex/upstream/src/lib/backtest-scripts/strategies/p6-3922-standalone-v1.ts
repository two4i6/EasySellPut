/** P6.3922: fixed no-money-cap management and geometry, ported from the frozen research. */
import assert from 'node:assert/strict';
import {freezeStrategyData,assertFixedStrategyParams,type BarStrategyModule} from '../strategy-module-v2';
import {resolveOptionQuote} from '../../optionQuote';
import {p6E385StandaloneV3} from './p6-e385-standalone-v3';
import {decideP6E385CurrentBar} from './p6-e385-standalone-v2';
import {withP6V3M95} from './p6-e385-standalone-v3-m-95';
import {evaluateP63922Admission} from './p6-3922-admission-v1';
export const P6_3922_VERSION='p6-3922-standalone-v1';
export const P6_3922_POLICY=freezeStrategyData({deltaFactor:1,dte:35,widthFraction:.95,extraTarget:.35,
 adaptive:{trigger:'term-inverted',fraction:.15,scope:'all'},
 geometryWhen:{guard:'term-flat',widthFraction:.9,deltaFactor:1.05,dte:35}});
export const P6_3922_PARAMETERS=freezeStrategyData({lineage:['P6.1549','P6.2508','P6.2518','P6.3820','P6.3922'],
 policy:P6_3922_POLICY,capitalLimits:'none',maximumQuantity:2,sourceExtraCounts:{SR01:4,SR02:4,other:2},
 extraProfitFraction:.35,extraStrikeGuard:'SR02 third-plus not above lowest held extra short',probeQuantityIsAdvisory:true});
function guard(name:string,c:any){assert.equal(name,'term-flat');return Number(c.vixTermStructureSlope)<=1;}
export function withP63922Management(base:BarStrategyModule):BarStrategyModule{
 const defaults=P6_3922_PARAMETERS,policy=P6_3922_POLICY;
 const checked=(params:any)=>assertFixedStrategyParams(params,defaults),extra=(id:any)=>String(id).endsWith(':research-extra');
 return {...base,manifest:{...base.manifest,version:P6_3922_VERSION},params:defaults,
  initialize(params:any){checked(params);return base.initialize(base.params);},
  planObservations:base.planObservations?(input:any)=>{checked(input.params);return base.planObservations!({...input,params:base.params});}:undefined,
  onFeedback(input:any){checked(input.params);if(extra(input.feedback.payload.positionId??input.feedback.payload.key))return input.state;const next=base.onFeedback?.({...input,params:base.params})??input.state;return next;},
  onBar(input:any){checked(input.params);const step=base.onBar({...input,params:base.params}),s=input.snapshot,positions=s.positions.filter((p:any)=>extra(p.id)),existing=positions.reduce((n:number,p:any)=>n+Number(p.quantity),0),slow=s.market.nativeState?.marketContext?.slowSubregime,maxExtras=['SR01','SR02'].includes(slow)?4:2,lowest=positions.length?Math.min(...positions.map((p:any)=>Number(p.shortStrike))):0;
   const extraTarget=policy.extraTarget;
   const closes:any[]=[];if(s.market.sampleTerminal!==true)for(const p of positions){const credit=Number(p.creditReceived),mark=Number(p.markPnl);assert(credit>0&&Number.isFinite(mark));if(mark>=credit*extraTarget)closes.push({kind:'close-position',key:`extra-release:${String(p.id)}:${s.asOf}`,positionId:String(p.id),reason:'research-extra-profit-release',minimumUnweightedPnl:credit*extraTarget});}
   let outgoing=[...step.intents.filter((i:any)=>i.kind!=='close-position'||!extra(i.positionId)),...closes];
   if(s.market.sampleTerminal!==true){
    const context=s.market.nativeState?.marketContext??{},weak=Number(context.vixTermStructureSlope)<=0;
    if(weak){const eligible=s.positions.filter((p:any)=>Number(p.markPnl)>=Number(p.creditReceived)*policy.adaptive.fraction),ids=new Set(eligible.map((p:any)=>p.id));outgoing=outgoing.filter((i:any)=>i.kind!=='close-position'||!ids.has(i.positionId));for(const p of eligible)outgoing.push({kind:'close-position',key:`p6-native-release:${String(p.id)}:${s.asOf}`,positionId:String(p.id),reason:'native-state-positive-profit-release',minimumUnweightedPnl:0});}
   }
   const intents=outgoing.flatMap((i:any)=>{
    if(i.kind!=='open-spread')return [i];const allowed=slow!=='SR02'||existing<2||Number(i.contract.shortStrike)<=lowest,quantity=allowed?Math.min(2,1+Math.max(0,maxExtras-existing)):1;
    const risk={...i.risk,quantity:1,researchSleeve:'base',researchCombinedQuantity:quantity,researchMaximumQuantity:2,researchMaximumExtraUnits:maxExtras,researchExistingExtraUnits:existing,researchExtraGuardAllowed:allowed};
    const first={...i,risk};return quantity===1?[first]:[first,{...i,key:i.key+':research-extra',risk:{...risk,researchSleeve:'extra'}}];
   });return {...step,intents};
  }
 };
}
function geometry(step:any,s:any,policy:any){
 // Warm-up may contain exit intents without a native market context.
 if(!step.intents.some((i:any)=>i.kind==='open-spread'))return step;
 if(policy.geometryWhen&&guard(policy.geometryWhen.guard,s.market.nativeState.marketContext))policy={...policy,...policy.geometryWhen};
 if(policy.deltaFactor===1&&policy.dte===35&&policy.widthFraction===1)return step;
 return {...step,intents:step.intents.map((i:any)=>{
  if(i.kind!=='open-spread')return i;const old=i.contract,chain=s.market.chain,referenceExpiry=chain.expirations.find((e:any)=>e.date===old.expiry),original=referenceExpiry?.puts.find((q:any)=>q.strike===old.shortStrike);if(!original||!Number.isFinite(original.delta))return i;
  const targetDelta=Math.max(.01,Math.min(.5,Math.abs(original.delta)*policy.deltaFactor)),widthTarget=(Number(old.shortStrike)-Number(old.longStrike))*policy.widthFraction,fee=Number(s.market.executionCapabilities.commissionPerContract),stamp=Date.parse(chain.timestamp)/1000;
  const expiry=[...chain.expirations].filter((e:any)=>e.date>s.asOf).sort((a:any,b:any)=>Math.abs((Date.parse(a.date)-Date.parse(s.asOf))/86400000-policy.dte)-Math.abs((Date.parse(b.date)-Date.parse(s.asOf))/86400000-policy.dte)||a.date.localeCompare(b.date))[0];if(!expiry)return i;
  const valid=(q:any)=>q.strike>0&&q.delta<=0&&Number.isFinite(q.delta)&&q.openInterest>0&&q.volume>=0;
  const shorts=expiry.puts.filter(valid).flatMap((q:any)=>{const quote=resolveOptionQuote(q,.5,stamp);return quote?.source==='market'?[{q,quote}]:[];}).sort((a:any,b:any)=>Math.abs(Math.abs(a.q.delta)-targetDelta)-Math.abs(Math.abs(b.q.delta)-targetDelta)||a.q.strike-b.q.strike);
  for(const short of shorts){const longs=expiry.puts.filter((q:any)=>valid(q)&&q.strike<short.q.strike).sort((a:any,b:any)=>Math.abs(short.q.strike-a.strike-widthTarget)-Math.abs(short.q.strike-b.strike-widthTarget)||a.strike-b.strike);
   for(const long of longs.slice(0,3)){const quote=resolveOptionQuote(long,2,stamp);if(quote?.source!=='market')continue;const credit=(short.quote.sell-quote.buy)*100-2*fee,width=short.q.strike-long.strike;if(!(credit>0&&width>0&&width*100-credit>0))continue;
    return {...i,contract:{...old,shortStrike:short.q.strike,longStrike:long.strike,expiry:expiry.date,targetDte:policy.dte},risk:{...i.risk,longProtectionFallback:{maximumWidth:width}}};
   }
  }return i;
 })};
}

const admitted={...p6E385StandaloneV3,onBar(input:Parameters<BarStrategyModule['onBar']>[0]){
 return decideP6E385CurrentBar(input,evaluateP63922Admission);
}};
const managed=withP6V3M95(admitted);
export const p63922StandaloneV1:BarStrategyModule=withP63922Management({...managed,onBar(input){
 return geometry(managed.onBar(input),input.snapshot,P6_3922_POLICY);
}});
