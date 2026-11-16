/** EB8.412: EB8.411 geometry/exits, original EB8 signal-time weights. Research only. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategySnapshot,type StrategyObject} from '../strategy-module-v2';
import {eb8StandaloneV1 as eb8} from './eb8-standalone-v1';
import {eb8411StandaloneV1 as parent,selectEb8411Entry,eb8411Exits} from './eb8-411-standalone-v1';
export const EB8412_PARAMS=freezeStrategyData({...parent.params,parent:'EB8.411',source:'EB8.412',
 lineage:[...(parent.params.lineage as string[]),'EB8.412'],sourceVersion:parent.manifest.version,multiplier:'original-eb8-signal'});
type Open=Extract<StrategyIntent,{kind:'open-spread'}>;
export function weightedEntry(intent:Open,snapshot:Readonly<StrategySnapshot>,commission:number):Open|null{
 const selected=selectEb8411Entry(intent,snapshot,commission);
 if(!selected||intent.risk.sourceAccount!=='portfolio')return selected;
 const weight=Number(intent.risk.multiplier);
 if(!Number.isFinite(weight)||weight<=0||Number(intent.contract.multiplier)!==weight)throw Error('Invalid original EB8 signal weight');
 return {...selected,contract:{...selected.contract,multiplier:weight},risk:{...selected.risk,quantity:1,multiplier:weight}};
}
export const eb8412StandaloneV1:BarStrategyModule={
 ...parent,manifest:{...parent.manifest,id:'EB8.412',version:'eb8-412-original-signal-weight-v1'},
 params:EB8412_PARAMS,
 initialize(params){assertFixedStrategyParams(params,EB8412_PARAMS);return parent.initialize(parent.params);},
 onFeedback(input){assertFixedStrategyParams(input.params,EB8412_PARAMS);return parent.onFeedback!({...input,params:parent.params});},
 onBar(input){
  assertFixedStrategyParams(input.params,EB8412_PARAMS);
  const capabilities=input.snapshot.market.executionCapabilities as StrategyObject|undefined;
  if(typeof capabilities?.commissionPerContract!=='number')throw Error('Current commission required');
  const step=eb8.onBar({...input,params:eb8.params}),owned=new Set(input.snapshot.positions.map(p=>String(p.id)));
  const intents=step.intents.flatMap<StrategyIntent>(i=>{
   if(i.kind==='close-position')return owned.has(i.positionId)?[]:[i];
   const selected=weightedEntry(i,input.snapshot,capabilities.commissionPerContract as number);return selected?[selected]:[];
  });
  return {...step,intents:[...eb8411Exits(input.snapshot),...intents]};
 },
};
