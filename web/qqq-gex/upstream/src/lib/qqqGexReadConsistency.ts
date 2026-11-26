export type QqqGexReadScope={policyId:string;from:string;to:string;expiryDates?:string[];includeCandles?:boolean};
export type QqqReadRpc=(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>Promise<unknown>;
export async function readQqqGexScopeRevision(rpc:QqqReadRpc,input:QqqGexReadScope,signal?:AbortSignal){
 signal?.throwIfAborted();
 const value=await rpc('qqq_gex_read_revision_v1',{p_policy_id:input.policyId,p_from:input.from,p_to:input.to,p_expiry_dates:input.expiryDates??null,p_include_candles:input.includeCandles===true},signal);
 if(typeof value!=='string'||!value.length)throw Error('Invalid GEX source revision');return value;
}
/** Retry the entire read once; never join pages from different source versions. */
export async function readConsistentQqqGex<T>(rpc:QqqReadRpc,input:QqqGexReadScope,load:()=>Promise<T>,signal?:AbortSignal){
 for(let attempt=0;attempt<2;attempt++){
  const before=await readQqqGexScopeRevision(rpc,input,signal),value=await load();
  if(await readQqqGexScopeRevision(rpc,input,signal)===before)return value;
 }
 throw Error('GEX source changed during paginated read');
}
