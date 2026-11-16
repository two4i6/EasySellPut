/** Causal source-overlap entry protection on user-selected E10467; no capital budget. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule}from '../../strategy-module-v2';
import {e10467StandaloneV1 as owned}from '../e10467-standalone-v1';
const parent={...owned};
const p={id:'E10495',scope:'high-e1',mode:'stress'}as const;
export function createSelectedStrategy():BarStrategyModule{
 const params=freezeStrategyData({parent:'E10467',profile:p,quantity:1,multiplier:1,commission:0,capitalLimits:'none'});
 return{...parent,manifest:{...parent.manifest,id:p.id,version:p.id+'-source-overlap-protection-v1'},params,
 initialize(a){assertFixedStrategyParams(a,params);return parent.initialize(parent.params);},
 onFeedback(i){assertFixedStrategyParams(i.params,params);return parent.onFeedback!({...i,params:parent.params});},
 onBar(i){assertFixedStrategyParams(i.params,params);const r=parent.onBar({...i,params:parent.params}),m=i.snapshot.market as any,f=m.extremePathResearch,t=m.restorationResearch;
 const weak=p.mode==='trend'?Number(m.qqq.close)<Number(t.sma20)&&Number(f.roc5)<0:Number(f.drawdown20)>=Number(f.rv20)/Math.sqrt(252)&&Number(f.roc5)<0;
 let blocked=0;const intents=r.intents.filter(o=>{if(o.kind!=='open-spread'||o.risk.sourceAccount!=='portfolio'||p.scope==='none'||p.scope!=='all'&&o.risk.entrySource!==p.scope||!weak)return true;
 const overlap=i.snapshot.positions.some(q=>q.entrySource===o.risk.entrySource&&Number(q.markPnl)<0);
 if(overlap){blocked++;return false;}return true;});return{...r,intents,plots:{...r.plots,research:{id:p.id,blocked,changed:blocked}}};}
 };
}

export const selectedNativeStrategy=createSelectedStrategy();
