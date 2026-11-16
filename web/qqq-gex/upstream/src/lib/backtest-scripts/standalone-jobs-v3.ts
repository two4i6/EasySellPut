/** Shared job metadata only. No strategy evidence, ledgers or results are persisted. */
import Redis from 'ioredis';
import {randomUUID,createHash} from 'node:crypto';
import {ResearchCapacityError,ResearchCancelledError} from './e209-process-v2';
import {validStandaloneJobToken,STANDALONE_MAX_CONCURRENT,STANDALONE_JOB_LEASE_MS} from './standalone-protocol-v2';
const claim=`if redis.call('EXISTS',KEYS[1])==1 then return 0 end
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',ARGV[3])
if redis.call('ZCARD',KEYS[2])>=${STANDALONE_MAX_CONCURRENT} then return -1 end
redis.call('HSET',KEYS[1],'principal',ARGV[1],'owner',ARGV[2],'status','running','childExited','false')
redis.call('EXPIRE',KEYS[1],3600) redis.call('ZADD',KEYS[2],ARGV[4],KEYS[1]) return 1`;
const cancel=`if redis.call('EXISTS',KEYS[1])==0 then
redis.call('HSET',KEYS[1],'principal',ARGV[1],'status','cancelled','childExited','false') redis.call('EXPIRE',KEYS[1],3600) return 1 end
if redis.call('HGET',KEYS[1],'principal')~=ARGV[1] then return -1 end
if redis.call('HGET',KEYS[1],'status')=='running' then redis.call('HSET',KEYS[1],'cancelRequested','true') end return 1`;
const finish=`if redis.call('HGET',KEYS[1],'owner')~=ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'status',ARGV[2],'childExited','true') redis.call('EXPIRE',KEYS[1],3600)
redis.call('ZREM',KEYS[2],KEYS[1]) return 1`;
export function createStandaloneJobService(redis:Redis,prefix='option-seller:standalone-jobs:v3'){
  const owner=randomUUID(),active=`${prefix}:active`,key=(id:string)=>`${prefix}:job:${id}`;
  let connecting:Promise<void>|undefined;
  async function ready(){
    if(redis.status!=='ready'){
      connecting??=new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(Error('Shared Redis unavailable'));},2000);
        const success=()=>{cleanup();resolve();},fail=(error:Error)=>{cleanup();reject(error);};
        const cleanup=()=>{clearTimeout(timer);redis.off('ready',success);redis.off('error',fail);};
        redis.once('ready',success);redis.once('error',fail);
      }).finally(()=>{connecting=undefined;});
      await connecting;
    }
    const info=await redis.info('memory');
    if(!info.includes('maxmemory_policy:noeviction'))throw Error('Shared job Redis must use noeviction, not a disposable cache');
  }
  const check=(id:string)=>{if(!validStandaloneJobToken(id))throw Error('Invalid job token');};
  async function status(id:string,principal:string){
    check(id);await ready();const row=await redis.hgetall(key(id));
    if(!row.principal||row.principal!==principal)return null;
    return {id,status:row.status,childExited:row.childExited==='true'};
  }
  return {status,
    async run<T>(id:string,principal:string,signal:AbortSignal,execute:(signal:AbortSignal)=>Promise<T>):Promise<T>{
      check(id);signal.throwIfAborted();await ready();
      const result=Number(await redis.eval(claim,2,key(id),active,principal,owner,Date.now(),Date.now()+STANDALONE_JOB_LEASE_MS));
      if(result===-1)throw new ResearchCapacityError('Shared research capacity exhausted');
      if(result===0){const row=await status(id,principal);if(row?.status==='cancelled')throw new ResearchCancelledError('Cancelled before start');throw Error('Job token already used');}
      const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
      let polling=false;
      const timer=setInterval(()=>{if(polling)return;polling=true;void redis.hgetall(key(id))
        .then(row=>{if(row.cancelRequested==='true'||row.owner!==owner)abort();}).catch(abort).finally(()=>{polling=false;});},100);
      let terminal='failed';
      try{const value=await execute(controller.signal);terminal=controller.signal.aborted?'cancelled':'completed';
        if(controller.signal.aborted)throw new ResearchCancelledError('Cancelled; worker exited');return value;
      }catch(error){if(controller.signal.aborted)terminal='cancelled';throw error;}
      finally{clearInterval(timer);signal.removeEventListener('abort',abort);
        // execute resolves/rejects only after its owned child exits. A Redis outage
        // must never fabricate an acknowledgement; leave running/unknown metadata.
        await redis.eval(finish,2,key(id),active,owner,terminal);}
    },
    async cancel(id:string,principal:string){check(id);await ready();
      if(Number(await redis.eval(cancel,1,key(id),principal))<0)return null;
      const deadline=Date.now()+3000;
      do{const row=await status(id,principal);if(row?.childExited)return row;
        await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
      return status(id,principal);
    },
  };
}
const services=new Map<string,ReturnType<typeof createStandaloneJobService>>();
export function standaloneJobs(){
  // The launcher supplies its dedicated noeviction child for a single app instance.
  const url=process.env.STANDALONE_JOBS_REDIS_URL;
  if(!url)throw Error('STANDALONE_JOBS_REDIS_URL required: shared job control is unavailable');
  let service=services.get(url);
  if(!service){const redis=new Redis(url,{maxRetriesPerRequest:0,enableOfflineQueue:false,commandTimeout:1500,
      connectTimeout:1500,retryStrategy:()=>null});redis.on('error',()=>{});
    // ioredis initiates connection asynchronously; requests fail closed until ready.
    service=createStandaloneJobService(redis,`option-seller:standalone:v3:${createHash('sha256').update(process.env.STANDALONE_JOBS_NAMESPACE??'default').digest('hex').slice(0,16)}`);services.set(url,service);}
  return service;
}
