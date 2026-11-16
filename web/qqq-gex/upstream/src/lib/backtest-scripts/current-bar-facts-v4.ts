/** Pure bounded history facts. Membership and thresholds belong to the strategy. */
type MarketState={regime?:string|null;slowSubregime?:string|null};
export function trailingStateRun(history:readonly MarketState[],current:MarketState){
  let count=0;for(let i=history.length-1;i>=0;i--){const state=history[i]!;
    if(state.regime!==current.regime||state.slowSubregime!==current.slowSubregime)break;count++;}return count;
}
export function lastThreeStateSequence(history:readonly MarketState[],current:MarketState){
  const key=(value:MarketState|undefined)=>`${value?.regime??'NA'}/${value?.slowSubregime??'NA'}`;
  return history.length>=3?[history[history.length-3],history[history.length-2],current].map(key).join(' -> '):'NA';
}
/** A fresh evaluation-local memo, never a date cache or a strategy-global state. */
export function createDecisionMemo(){
  const values=new Map<string,unknown>();
  return <T>(key:string,compute:()=>T):T=>{
    if(values.has(key))return values.get(key) as T;
    const value=compute();values.set(key,value);return value;
  };
}
