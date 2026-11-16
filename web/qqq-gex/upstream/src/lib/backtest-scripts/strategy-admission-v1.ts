import type {StrategyObject} from './strategy-module-v2';

export type StrategyAdmissionGate=StrategyObject&{label:string;status:'PASS'|'BLOCK'|'UNAVAILABLE';detail:string};
/** Record checks where the strategy executes them; never reevaluate policy in a client. */
export function createAdmissionTrace(labels:readonly [string,string,string,string,string]){
  const gates:StrategyAdmissionGate[]=labels.map(label=>({label,status:'UNAVAILABLE',detail:'前置阶段未通过，尚未评估'}));
  return {gates,check(index:number,passed:boolean,detail:string){
    if(!gates[index])throw Error('Invalid admission stage');
    gates[index]={label:gates[index]!.label,status:passed?'PASS':'BLOCK',detail};
  }};
}
export function readAdmissionGates(value:unknown):StrategyAdmissionGate[]|null{
  if(!Array.isArray(value)||value.length!==5||new Set(value.map(g=>g?.label)).size!==5)return null;
  return value.every(g=>g&&typeof g.label==='string'&&g.label.length>0&&typeof g.detail==='string'
    &&['PASS','BLOCK','UNAVAILABLE'].includes(g.status))?value:null;
}
