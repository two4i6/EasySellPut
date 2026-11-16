/** Positive-profit raw-source exits under negative63d momentum; no loss crystallization caps. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent}from '../../strategy-module-v2';
import {selectedNativeStrategy as parent}from './e10548';
const p={id:'E10572',mode:'adaptive'}as const;
export function createSelectedStrategy():BarStrategyModule{
 const params=freezeStrategyData({parent:'E10548',profile:p,quantity:1,multiplier:1,commission:0,capitalLimits:'none'});
 return{...parent,manifest:{...parent.manifest,id:p.id,version:p.id+'-raw-profit-protection-v1'},params,
 initialize(a){assertFixedStrategyParams(a,params);return parent.initialize(parent.params);},onFeedback(i){assertFixedStrategyParams(i.params,params);return parent.onFeedback!({...i,params:parent.params});},
 onBar(i){assertFixedStrategyParams(i.params,params);const r=parent.onBar({...i,params:parent.params}),f=i.snapshot.market.extremePathResearch as any;let changed=0;const floors=new Map<string,number>();
 const group=i.snapshot.positions.filter(q=>q.entrySource==='high-raw'),trigger=.255*Math.min(1,Number(f.rv20)/Number(f.rv63));
 if(Number(f.roc63)<0)for(const q of group){const credit=Number(q.creditReceived);if(credit>0&&Number(q.markPnl)>=trigger*credit)floors.set(String(q.id),Math.max(.01,Math.min(.1,trigger)*credit));}

 const intents=r.intents.map(o=>{if(o.kind!=='close-position'||!floors.has(o.positionId))return o;const floor=floors.get(o.positionId)!;floors.delete(o.positionId);if(Number(o.minimumUnweightedPnl??0)>floor){changed++;return{...o,minimumUnweightedPnl:floor};}return o;});
 const extra:StrategyIntent[]=[...floors].map(([id,floor])=>({kind:'close-position',key:`close:raw-profit:${id}:${i.snapshot.asOf}`,positionId:id,reason:'profit-target',minimumUnweightedPnl:floor}));changed+=extra.length;
 return{...r,intents:[...extra,...intents],plots:{...r.plots,research:{id:p.id,changed,blocked:0}}};}
 };
}

export const selectedNativeStrategy=createSelectedStrategy();
