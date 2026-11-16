type Reason='SOURCE_TRANSPORT'|'SOURCE_TIMEOUT'|'SOURCE_BUSY'|'SOURCE_CHANGED'|'INVALID_SOURCE'|'SOURCE_UNAVAILABLE';
type RpcResult={data:unknown;error:{code?:string;message?:string}|null;status?:number};
type Event={stage:string;rpc:string;attempt:number;elapsedMs:number;reason:Reason|null;code:string;status:number};
const stageOf=(name:string)=>name.includes('manifest')?'manifest':name.includes('revision')?'revision':name.includes('data_batch')?'combined':name.includes('candle')?'candles':name.includes('profile')||name.includes('model')?'profiles':'source';
export class QqqChartReadError extends Error {
 constructor(public readonly rpc:string,public readonly code:string,public readonly reason:Reason,public readonly attempts:number,public readonly elapsedMs:number){
  super(`Chart source ${rpc} unavailable (${reason}, ${code||'transport'}, attempts ${attempts})`);this.name='QqqChartReadError';
 }
}
function reasonFor(error:RpcResult['error'],status:number):Reason {
 if(error?.code==='57014'||/timeout|timed out|AbortError/i.test(error?.message??''))return 'SOURCE_TIMEOUT';
 if(['PGRST000','PGRST001','PGRST002','PGRST003'].includes(error?.code??'')||[502,503,504].includes(status))return 'SOURCE_BUSY';
 if(status===0&&/fetch failed|network|ECONN|socket|TLS/i.test(error?.message??''))return 'SOURCE_TRANSPORT';
 return 'SOURCE_UNAVAILABLE';
}
const transient=(reason:Reason)=>['SOURCE_TRANSPORT','SOURCE_TIMEOUT','SOURCE_BUSY'].includes(reason);
async function pause(signal:AbortSignal){
 signal.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},150);
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
  signal.addEventListener('abort',abort,{once:true});
 });
}
/** One bounded retry of idempotent reads only; unchanged args/versions and fresh deadlines.
 * Schema/data/permission errors fail closed. Consistent publication stays in the store.
 */
export function createQqqChartRpc(ports:{request:(name:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<RpcResult>;pause?:(signal:AbortSignal)=>Promise<void>;observe?:(event:Event)=>void}){
 return async<T>(name:string,args:Record<string,unknown>,caller?:AbortSignal):Promise<T>=>{
  const started=performance.now();
  for(let attempt=1;attempt<=2;attempt++){
   caller?.throwIfAborted();
   const deadline=AbortSignal.timeout(20_000),signal=caller?AbortSignal.any([caller,deadline]):deadline;
   let result:RpcResult;
   try{result=await ports.request(name,args,signal);}catch(error){caller?.throwIfAborted();result={data:null,status:0,error:{message:error instanceof Error?`${error.name}: ${error.message}`:'Network request failed'}};}
   caller?.throwIfAborted();
   const reason=result.error?reasonFor(result.error,result.status??0):result.data==null?'INVALID_SOURCE':null;
   try{ports.observe?.({stage:stageOf(name),rpc:name,attempt,elapsedMs:performance.now()-started,reason,code:result.error?.code??'',status:result.status??0});}catch{/* Observability cannot change source correctness. */}
   if(!reason)return result.data as T;
   if(attempt===2||!transient(reason))throw new QqqChartReadError(name,result.error?.code??'',reason,attempt,performance.now()-started);
   await (ports.pause??pause)(caller??new AbortController().signal);
  }
  throw Error('Unreachable chart RPC state');
 };
}
export function exposureReadFailure(error:unknown):{code:Reason;stage:string;retryable:boolean}{
 if(error instanceof QqqChartReadError)return {code:error.reason,stage:stageOf(error.rpc),retryable:transient(error.reason)};
 const message=error instanceof Error?error.message:'';
 if(/busy/i.test(message))return {code:'SOURCE_BUSY',stage:'capacity',retryable:true};
 if(/changed during|source changed/i.test(message))return {code:'SOURCE_CHANGED',stage:'consistency',retryable:true};
 if(/invalid|duplicate|unexpected/i.test(message))return {code:'INVALID_SOURCE',stage:'validation',retryable:false};
 return {code:'SOURCE_UNAVAILABLE',stage:'source',retryable:false};
}
