/** Fixed E9332-native-cut-sharing-v1 live formula set; disabled stage formulas cannot be silently restored. */
import{ATOMS,PROGRAMS,type Context,type Env}from'./program-v1';
export type Tree={readonly id:string;readonly k:'atom';readonly code:string}|{readonly id:string;readonly k:'and'|'or';readonly children:readonly Tree[]}|{readonly id:string;readonly k:'not';readonly child:Tree}|{readonly id:string;readonly k:'atLeast';readonly children:readonly Tree[];readonly minimum:number};
export type LogicEdit={formula:string;removeNode:string};
const emptyEnv:Env=Object.freeze({width:NaN,vxn:NaN,vixLower:NaN});
export function compileLogic(edits:readonly LogicEdit[]=[],design='E9332-native-cut-sharing-v1'){
 if(edits.length||design!=='E9332-native-cut-sharing-v1')throw Error('Only the fixed E9332-native-cut-sharing-v1 program is supported');
 const source=PROGRAMS as unknown as Readonly<Record<string,Tree>>,trees:Record<string,Tree>={},evaluate:Record<string,(c:Context,e:Env)=>boolean>={};
 function freeze(t:Tree):Tree{if(t.k==='atom')return Object.freeze({...t});if(t.k==='not')return Object.freeze({...t,child:freeze(t.child)});return Object.freeze({...t,children:Object.freeze(t.children.map(freeze))});}
 function build(t:Tree):(c:Context,e:Env)=>boolean{
  if(t.k==='atom'){const f=ATOMS[t.id];if(!f)throw Error('Unknown atom reference');return f;}
  if(t.k==='not'){const f=build(t.child);return(c,e)=>!f(c,e);}
  if(!t.children.length)throw Error('Empty logical group');const fs=t.children.map(build);
  if(t.k==='and')return(c,e)=>{for(const f of fs)if(!f(c,e))return false;return true;};
  if(t.k==='or')return(c,e)=>{for(const f of fs)if(f(c,e))return true;return false;};
  const k=(t as Extract<Tree,{k:'atLeast'}>).minimum;if(!Number.isInteger(k)||k<1||k>fs.length)throw Error('Invalid fixed vote');
  return(c,e)=>{let votes=0;for(let i=0;i<fs.length;i++){if(fs[i]!(c,e))votes++;if(votes>=k)return true;if(votes+fs.length-i-1<k)return false;}return false;};
 }
 for(const[id,t]of Object.entries(source)){trees[id]=freeze(t);evaluate[id]=build(trees[id]!);}
 return Object.freeze({trees:Object.freeze(trees),evaluate:Object.freeze(evaluate)});
}
export type Logic=ReturnType<typeof compileLogic>;
export function evaluateLogic(p:Logic,id:string,c:Context,env:Env=emptyEnv){const f=p.evaluate[id];if(!f)throw Error('Unknown formula');return f(c,env);}
export function logicCost(p:Logic){let atoms=0,andNodes=0,orNodes=0,orArms=0,voteNodes=0,maxDepth=0;const ids=new Set<string>();function walk(t:Tree,d:number){maxDepth=Math.max(maxDepth,d);if(t.k==='atom'){atoms++;ids.add(t.id);}else if(t.k==='not')walk(t.child,d+1);else{if(t.k==='and')andNodes++;else if(t.k==='or'){orNodes++;orArms+=t.children.length;}else voteNodes++;t.children.forEach(c=>walk(c,d+1));}}Object.values(p.trees).forEach(t=>walk(t,1));return{formulas:Object.keys(p.trees).length,atomOccurrences:atoms,sharedAtomDefinitions:ids.size,andNodes,orNodes,orArms,voteNodes,maxDepth};}
