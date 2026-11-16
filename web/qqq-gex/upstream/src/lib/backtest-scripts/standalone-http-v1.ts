/** One authenticated HTTP lifecycle for every registered standalone strategy. */
import {describeStandaloneRegistry,describeStandaloneStrategy,parseStandaloneRequest,assertStandaloneRunnable,type StandaloneId} from './standalone-registry-v2';
import {runStandaloneResearchProcess,e209ResearchCapacity,researchErrorKind} from './e209-process-v2';
import {validStandaloneJobToken,STANDALONE_REQUEST_MAX_BYTES} from './standalone-protocol-v2';
import {standaloneJobs} from './standalone-jobs-v3';
import {authorizeStandalone} from './standalone-auth-v1';
import {randomUUID} from 'node:crypto';
import {Readable,pipeline} from 'node:stream';
import {DEFAULT_STANDALONE_STRATEGY} from './standalone-strategy-catalog-v4';
import {createGzip,constants} from 'node:zlib';
const headers={'Cache-Control':'no-store'};
export function standaloneHttp(defaultStrategyId?:StandaloneId){return standaloneHttpLifecycle({
  describe:()=>({...describeStandaloneStrategy(defaultStrategyId??DEFAULT_STANDALONE_STRATEGY),...describeStandaloneRegistry()}),
  parse(decoded:unknown){
    if(defaultStrategyId){if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw Error('Invalid request');
      const input=decoded as Record<string,unknown>;
      if(input.strategyId!==undefined&&input.strategyId!==defaultStrategyId)throw Error('Strategy is fixed');input.strategyId=defaultStrategyId;}
    return parseStandaloneRequest(decoded);
  },assert:assertStandaloneRunnable,run:runStandaloneResearchProcess,
});}
/** Shared auth, body bounds, distributed capacity and child-exit cancellation. */
export function standaloneHttpLifecycle<T>(config:{authorize?:typeof authorizeStandalone;describe:()=>object;parse:(input:unknown)=>T;assert?:(input:T)=>void;
  stream?:boolean;run:(input:T,signal:AbortSignal,request:Request,onProgress?:(value:unknown)=>void)=>Promise<unknown>}){const authorize=config.authorize??authorizeStandalone;
  const failure=(error:unknown,aborted:boolean)=>{
    const kind=researchErrorKind(error),message=(error as Error).message;
    const status=kind==='capacity'?429:kind==='cancelled'||aborted?499:kind==='timeout'?504
      :/Redis|redis|ECONN|Connection|Stream isn't writeable/.test(message)?503:message==='Job token already used'?409:500;
    if(status===500)console.error('[Standalone research worker]',error);
    return {status,error:status===500?'Standalone research execution failed':status===503?'Shared job control unavailable':message,
      researchOnly:true,productionReady:false};
  };
  return {
  async GET(request?:Request){const auth=authorize(request);if(auth instanceof Response)return auth;
    if(request&&[...new URL(request.url).searchParams.keys()].some(key=>key!=='jobId'))return Response.json({error:'Unknown query parameter'},{status:400,headers});
    const id=request?new URL(request.url).searchParams.get('jobId'):null;
    if(id!==null){if(!validStandaloneJobToken(id))return Response.json({error:'Invalid job token'},{status:400,headers});
      try{const job=await standaloneJobs().status(id,auth.principal);return Response.json(job??{error:'Unknown job'},{status:job?200:404,headers});}
      catch{return Response.json({error:'Shared job service unavailable'},{status:503,headers});}}
    return Response.json({...config.describe(),capacity:e209ResearchCapacity()}, {headers});
  },
  async POST(request:Request){const auth=authorize(request);if(auth instanceof Response)return auth;
    if(new URL(request.url).search)return Response.json({error:'Use JSON data-sample parameters'},{status:400,headers});
    let input;
    try{const reader=request.body?.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
      if(reader){try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
        if(bytes>STANDALONE_REQUEST_MAX_BYTES){await reader.cancel();return Response.json({error:'Research request too large'},{status:413,headers});}
        raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
      input=config.parse(JSON.parse(raw));
    }catch{return Response.json({error:'Invalid research request'},{status:400,headers});}
    try{config.assert?.(input);}catch(error){return Response.json({error:(error as Error).message,researchOnly:true,productionReady:false},{status:422,headers});}
    const id=request.headers.get('X-E209-Job-Id')??randomUUID();
    if(!validStandaloneJobToken(id))return Response.json({error:'Invalid job token'},{status:400,headers});
    let jobs;try{jobs=standaloneJobs();}catch{return Response.json({error:'Shared job control is not configured'},{status:503,headers});}
    if(config.stream&&request.headers.get('Accept')==='application/x-ndjson'){
      const controller=new AbortController(),abort=()=>controller.abort();
      request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
      let cancelled=false,bytes=0;
      const body=new ReadableStream<Uint8Array>({start(stream){
        const emit=(value:unknown)=>{
          if(cancelled||controller.signal.aborted)return;
          const chunk=new TextEncoder().encode(JSON.stringify(value)+'\n');bytes+=chunk.byteLength;
          if(bytes>32*1024*1024){controller.abort();throw Error('Research stream exceeded output bound');}
          stream.enqueue(chunk);
        };
        void jobs.run(id,auth.principal,controller.signal,signal=>config.run(input,signal,request,value=>emit({type:'segment',value})))
          .then(value=>emit({type:'complete',value}))
          .catch(error=>{if(!cancelled)stream.enqueue(new TextEncoder().encode(JSON.stringify({type:'error',...failure(error,controller.signal.aborted)})+'\n'));})
          .finally(()=>{request.signal.removeEventListener('abort',abort);if(!cancelled)stream.close();});
      },cancel(){cancelled=true;controller.abort();}});
      const gzip=request.headers.get('Accept-Encoding')?.split(',').some(value=>{
        const [coding,...params]=value.trim().split(';'),quality=params.find(p=>p.trim().startsWith('q='));
        return coding==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);
      });
      if(gzip){
        // Flush each segment; pipeline propagates reader cancellation back to the owned job.
        const compressed=createGzip({level:1,flush:constants.Z_SYNC_FLUSH});
        pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream),compressed,()=>{});
        return new Response(Readable.toWeb(compressed) as ReadableStream<Uint8Array>,{headers:{...headers,
          'Content-Type':'application/x-ndjson','Content-Encoding':'gzip','Vary':'Accept-Encoding','X-Accel-Buffering':'no'}});
      }
      return new Response(body,{headers:{...headers,'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'}});
    }
    try{return Response.json(await jobs.run(id,auth.principal,request.signal,signal=>config.run(input,signal,request)),{headers});}
    catch(error){const {status,...body}=failure(error,request.signal.aborted);
      return Response.json(body,{status,headers:{...headers,...(status===429?{'Retry-After':'30'}:{})}});}
  },
  async DELETE(request:Request){const auth=authorize(request);if(auth instanceof Response)return auth;
    const id=new URL(request.url).searchParams.get('jobId');if(!id||!validStandaloneJobToken(id))return Response.json({error:'Invalid job token'},{status:400,headers});
    try{const result=await standaloneJobs().cancel(id,auth.principal);
      return Response.json(result??{error:'Unknown job'},{status:result?result.childExited?200:202:404,headers});}
    catch{return Response.json({error:'Shared cancellation service unavailable; exit not confirmed',childExited:false},{status:503,headers});}
  },
};}
