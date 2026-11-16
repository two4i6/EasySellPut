/** EB8.1298: original weighted 940 geometry with account-local closing-profit protection. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyJson,type StrategyObject,type StrategySnapshot,type StrategyIntent} from '../strategy-module-v2';
import {eb8StandaloneV1 as source} from './eb8-standalone-v1';
import {eb8940StandaloneV1 as parent,selectEb8940Entry} from './eb8-940-standalone-v1';
export const EB81298_PARAMS=freezeStrategyData({...parent.params,parent:'EB8.940',source:'EB8.1298',
 lineage:[...(parent.params.lineage as string[]),'EB8.1298'],sourceVersion:parent.manifest.version,
 profitTarget:.255,extendedProfitTarget:.45,protectionArm:.255,profitGiveback:.075,minimumExtendedDte:7});
type State={source:StrategyJson;profitPeaks:Record<string,number>};
function readState(value:StrategyJson):State{
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'source'))throw Error('Invalid EB8.1298 source state');
 const peaks=value.profitPeaks;
 if(!peaks||typeof peaks!=='object'||Array.isArray(peaks)||Object.values(peaks).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid EB8.1298 profit state');
 return value as State;
}
export function eb81298Protection(snapshot:Readonly<StrategySnapshot>,previous:Readonly<Record<string,number>>){
 const peaks=new Map(Object.entries(previous)),live=new Set(snapshot.positions.map(p=>String(p.id)));
 for(const id of peaks.keys())if(!live.has(id))peaks.delete(id);
 const intents=snapshot.positions.flatMap<StrategyIntent>(position=>{
  const credit=Number(position.creditReceived),profit=Number(position.markPnl),id=String(position.id);
  if(!(credit>0&&Number.isFinite(profit)))throw Error('Invalid current EB8.1298 profit observation');
  const ratio=profit/credit,peak=Math.max(peaks.get(id)??-Infinity,ratio);peaks.set(id,peak);
  const dte=(Date.parse(String(position.expiry))-Date.parse(snapshot.asOf))/86400000;
  const eligible=Number((snapshot.market.qqq as StrategyObject).close)>=Number(position.shortStrike)&&dte>EB81298_PARAMS.minimumExtendedDte;
  const target=eligible?EB81298_PARAMS.extendedProfitTarget:EB81298_PARAMS.profitTarget;
  const protect=peak>=EB81298_PARAMS.protectionArm&&ratio<=peak-EB81298_PARAMS.profitGiveback;
  if(ratio<target&&!protect)return [];
  return [{kind:'close-position',key:`close:portfolio:${id}:${snapshot.asOf}`,positionId:id,reason:'profit-target',minimumUnweightedPnl:0}];
 });
 return {state:Object.fromEntries(peaks),intents};
}
export const eb81298StandaloneV1:BarStrategyModule={
 manifest:{sdkVersion:2,id:'EB8.1298',version:'eb8-1298-guarded45-profit-protection-v1',researchOnly:true,migration:{complete:true,missing:[]}},params:EB81298_PARAMS,
 initialize(params){assertFixedStrategyParams(params,EB81298_PARAMS);return {source:source.initialize(source.params),profitPeaks:{}};},
 onFeedback(input){assertFixedStrategyParams(input.params,EB81298_PARAMS);const state=readState(input.state);return {...state,source:source.onFeedback!({...input,state:state.source,params:source.params})};},
 onBar(input){
  assertFixedStrategyParams(input.params,EB81298_PARAMS);const state=readState(input.state);
  const capabilities=input.snapshot.market.executionCapabilities as StrategyObject|undefined;
  if(typeof capabilities?.commissionPerContract!=='number')throw Error('EB8.1298 requires current execution commission');
  const step=source.onBar({...input,state:state.source,params:source.params}),owned=new Set(input.snapshot.positions.map(p=>String(p.id)));
  const intents=step.intents.flatMap<StrategyIntent>(intent=>{
   if(intent.kind==='close-position')return owned.has(intent.positionId)?[]:[intent];
   const selected=selectEb8940Entry(intent,input.snapshot,capabilities.commissionPerContract as number);return selected?[selected]:[];
  });
  const protection=eb81298Protection(input.snapshot,state.profitPeaks);
  return {...step,state:{source:step.state,profitPeaks:protection.state},intents:[...protection.intents,...intents]};
 },
};
