/** Independent process ownership: cancellation is acknowledged only AFTER child exit.
 * No arbitrary command or strategy upload is exposed by HTTP.
 */
import { spawn } from 'node:child_process';
import { parseResearchReplayRequest as parseE209ResearchRequest, type ResearchReplayRequest as E209ResearchRequest } from './research-request-v3';
import type { E209ResearchResponse } from './e209-worker-protocol-v2';
import { parseStandaloneRequest, assertStandaloneRunnable, type StandaloneRequest } from './standalone-registry-v2';
import type { StandaloneResearchResponse } from './standalone-protocol-v2';
import {standaloneAcceptanceView} from './standalone-acceptance-v2';
import {STANDALONE_OUTPUT_MAX_BYTES,STANDALONE_MAX_CONCURRENT,STANDALONE_PROCESS_TIMEOUT_MS} from './standalone-protocol-v2';
import {parseQqqTerminalRequest,qqqTerminalAcceptanceView,acceptQqqTerminalSegment,type QqqTerminalRequest,type QqqTerminalResponse,type QqqTerminalSegment} from './qqq-terminal-contract-v1';
import {verifyStandaloneAcceptanceEnvelope} from './standalone-acceptance-envelope-v1';

export class ResearchCapacityError extends Error { readonly code = 'E209_RESEARCH_CAPACITY'; }
export class ResearchCancelledError extends Error { readonly code = 'E209_RESEARCH_CANCELLED'; }
export class ResearchTimeoutError extends Error { readonly code = 'E209_RESEARCH_TIMEOUT'; }
/** Stable across HMR: a retained pool must not rely on a reloaded constructor's identity. */
export function researchErrorKind(error: unknown): 'capacity' | 'cancelled' | 'timeout' | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (code === 'E209_RESEARCH_CAPACITY') return 'capacity';
  if (code === 'E209_RESEARCH_CANCELLED') return 'cancelled';
  if (code === 'E209_RESEARCH_TIMEOUT') return 'timeout';
  // Transitional old pools may still be draining during the first upgrade.
  const constructor = error.constructor?.name;
  return constructor === 'ResearchCapacityError' ? 'capacity' : constructor === 'ResearchCancelledError' ? 'cancelled'
    : constructor === 'ResearchTimeoutError' ? 'timeout' : null;
}
export function createResearchProcessPool(limit = STANDALONE_MAX_CONCURRENT,draining?:{readonly active:number}) {
  let active = 0;
  return {
    errorProtocolVersion: 3 as const,
    get active() { return active+(draining?.active??0); },
    async execute(input: { executable: string; args: string[]; stdin: string; signal?: AbortSignal; timeoutMs?: number;
      maxOutputBytes?:number; onSpawn?: (pid: number) => void;onStdout?:(chunk:string)=>void }): Promise<string> {
      input.signal?.throwIfAborted();
      if (active+(draining?.active??0) >= limit) throw new ResearchCapacityError('Research worker capacity exhausted');
      active++;
      try {
        return await new Promise<string>((resolve, reject) => {
          const child = spawn(input.executable, input.args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          let stdout = '', stdoutBytes=0, stderr = '', reason: Error | undefined, settled = false;
          let hardKill: ReturnType<typeof setTimeout> | undefined;
          const stop = (error: Error) => {
            if (settled || reason) return;
            reason = error; child.kill('SIGTERM');
            hardKill = setTimeout(() => child.kill('SIGKILL'), 1000);
          };
          const abort = () => stop(new ResearchCancelledError('Research cancelled; child exited'));
          const timeout = setTimeout(() => stop(new ResearchTimeoutError('Research worker timeout')), input.timeoutMs ?? STANDALONE_PROCESS_TIMEOUT_MS);
          const cleanup = () => { clearTimeout(timeout); if (hardKill) clearTimeout(hardKill); input.signal?.removeEventListener('abort', abort); };
          input.signal?.addEventListener('abort', abort, { once: true });
          child.stdout.setEncoding('utf8');
          child.stdout.on('data', chunk => {
            stdoutBytes+=Buffer.byteLength(chunk,'utf8');
            if(stdoutBytes>(input.maxOutputBytes??128*1024))stop(new Error('Worker output exceeded bound'));
            else {stdout+=chunk;try{input.onStdout?.(chunk);}catch(error){stop(error as Error);}}
          });
          child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
          child.stdin.on('error', () => {});
          child.once('error', error => { settled = true; cleanup(); reject(error); });
          child.once('close', code => {
            if (settled) return; settled = true; cleanup();
            if (reason) reject(reason);
            else if (code !== 0) reject(new Error(`Research worker failed (${code}): ${stderr}`));
            else resolve(stdout.trim());
          });
          if (child.pid) input.onSpawn?.(child.pid);
          child.stdin.end(input.stdin);
          if (input.signal?.aborted) abort();
        });
      } finally { active--; }
    },
  };
}
// Share the budget across dev hot reloads. This is service capacity, never strategy state.
const serviceGlobal = globalThis as typeof globalThis & { e209ResearchPoolV1?: ReturnType<typeof createResearchProcessPool> };
const previous = serviceGlobal.e209ResearchPoolV1;
// Streaming callbacks changed the pool contract; old workers drain without reusing their stale execute closure.
const pool = previous?.errorProtocolVersion === 3 ? previous : createResearchProcessPool(STANDALONE_MAX_CONCURRENT,previous);
serviceGlobal.e209ResearchPoolV1 = pool;
export function e209ResearchCapacity() { return { active: pool.active, limit: STANDALONE_MAX_CONCURRENT }; }
/** Registered workers share service capacity, output bounds and real CPU cancellation. */
export function runRegisteredResearchWorker(worker:'e209',request:E209ResearchRequest,signal?:AbortSignal):Promise<never>;
export function runRegisteredResearchWorker(worker:'p6',request:E209ResearchRequest,signal?:AbortSignal):Promise<StandaloneResearchResponse>;
export async function runRegisteredResearchWorker(worker: 'e209' | 'p6', request: E209ResearchRequest, signal?: AbortSignal) {
  // Keep historical writers intact, but never auto-archive via a framework entry.
  if(worker==='e209')throw new Error('Legacy E209 automatic archival is disabled; use scripts/research/run-standalone-cli-v2.ts (strategy-source-only)');
  return runStandaloneResearchProcess({...request,strategyId:'P6.E385'},signal);
}
export async function runE209ResearchProcess(raw: E209ResearchRequest, signal?: AbortSignal): Promise<E209ResearchResponse> {
  const request = parseE209ResearchRequest(raw);
  return runRegisteredResearchWorker('e209', request, signal);
}

/** All public strategy plugins share this process pool, cancellation and output budget. */
export async function runStandaloneResearchProcess(raw: StandaloneRequest, signal?: AbortSignal): Promise<StandaloneResearchResponse> {
  const request = parseStandaloneRequest(raw);
  assertStandaloneRunnable(request);
  const stdout = await pool.execute({ executable:process.env.E209_RESEARCH_BUN ?? 'bun',
    args:['scripts/research/run-standalone-worker-v2.ts'], stdin:JSON.stringify(request), signal,
    maxOutputBytes:STANDALONE_OUTPUT_MAX_BYTES+1 }); // Minified JSON + exactly one newline.
  const result = JSON.parse(stdout);
  if (!result.runId || result.productionReady !== false || result.researchOnly !== true
    || JSON.stringify(result.request) !== JSON.stringify(request)
    || result.retention !== 'strategy-source-only' || result.artifact !== null || result.traceArtifact !== null)
    throw new Error('Invalid standalone worker response identity');
  standaloneAcceptanceView(result);
  await verifyStandaloneAcceptanceEnvelope(result);
  return result;
}

type QqqSubscriber={signal?:AbortSignal;onSegment?:(segment:QqqTerminalSegment)=>void};
type QqqFlight={controller:AbortController;subscribers:Set<QqqSubscriber>;segments:QqqTerminalSegment[];promise:Promise<QqqTerminalResponse>};
const qqqFlights=new Map<string,QqqFlight>();
/** Only identical public market requests share work; cancelling one reader never kills another's run. */
export async function runQqqTerminalProcess(raw:QqqTerminalRequest,signal?:AbortSignal,
  options:{refresh?:boolean;onSegment?:(segment:QqqTerminalSegment)=>void}={}):Promise<QqqTerminalResponse>{
  const request=parseQqqTerminalRequest(raw);signal?.throwIfAborted();
  const key=JSON.stringify([request,Boolean(options.refresh)]);
  let flight=qqqFlights.get(key);
  if(!flight||flight.controller.signal.aborted){
    flight={controller:new AbortController(),subscribers:new Set(),segments:[],promise:undefined!};
    const current=flight;
    current.promise=executeQqqTerminalProcess(request,current.controller.signal,{refresh:options.refresh,onSegment(segment){
      current.segments.push(segment);
      for(const reader of current.subscribers)if(!reader.signal?.aborted)reader.onSegment?.(segment);
    }}).finally(()=>{if(qqqFlights.get(key)===current)qqqFlights.delete(key);});
    qqqFlights.set(key,current);
  }
  const subscriber={signal,onSegment:options.onSegment};flight.subscribers.add(subscriber);
  const owned=flight;
  const abort=()=>{if([...owned.subscribers].every(reader=>reader.signal?.aborted))owned.controller.abort();};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    for(const segment of owned.segments)options.onSegment?.(segment);
    const result=await owned.promise;if(signal?.aborted)throw new ResearchCancelledError('Cancelled; shared worker exited');return result;
  }finally{signal?.removeEventListener('abort',abort);owned.subscribers.delete(subscriber);
    if(!owned.subscribers.size)owned.controller.abort();}
}
async function executeQqqTerminalProcess(raw:QqqTerminalRequest,signal:AbortSignal,options:{refresh?:boolean;onSegment:(segment:QqqTerminalSegment)=>void}):Promise<QqqTerminalResponse>{
  const request=parseQqqTerminalRequest(raw);
  const protocolAbort=new AbortController();
  let buffer='',result:Partial<QqqTerminalResponse>|undefined,complete=false,sequence=Promise.resolve();
  await pool.execute({executable:process.env.E209_RESEARCH_BUN??'bun',
    args:['scripts/research/run-qqq-standalone-worker-v1.ts','--stream',...(options.refresh?['--refresh']:[])],stdin:JSON.stringify(request),
    signal:AbortSignal.any([signal,protocolAbort.signal]),maxOutputBytes:32*1024*1024,
    onStdout(chunk){buffer+=chunk;let end:number;
      while((end=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
        sequence=sequence.then(async()=>{
          if(complete)throw Error('Unexpected QQQ frame after completion');
          if(frame.type==='segment'){
            result=await acceptQqqTerminalSegment(frame.value,result,request);options.onSegment(frame.value);
          }else if(frame.type==='complete'){
            if(!result)throw Error('QQQ completion without segments');
            result.acceptanceDigest=frame.value.acceptanceDigest;complete=true;
          }else throw Error('Invalid QQQ worker frame');
        });
        void sequence.catch(()=>protocolAbort.abort());
      }
    }}).catch(async error=>{await sequence;throw error;});
  await sequence;
  if(!complete||buffer.trim())throw Error('Incomplete QQQ worker stream');
  qqqTerminalAcceptanceView(result);
  if(JSON.stringify(result.request)!==JSON.stringify(request))throw Error('Invalid QQQ worker request identity');
  await verifyStandaloneAcceptanceEnvelope(result);
  return result;
}
