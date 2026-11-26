import { qqqMarketSession } from './qqqMarketSession';

export function qqqGexRefreshInterval(now = new Date()): number {
  const session=qqqMarketSession(now);
  return session.stockAcquisitionOpen || session.optionsOpen ? 30_000 : 0;
}

/** Display-only stored snapshots; never increases upstream option collection. */
export function qqqExposureRefreshInterval(now = new Date()): number {
  return qqqGexRefreshInterval(now) ? 15_000 : 0;
}

type RefreshEnvironment={now:()=>number;setTimer:(run:()=>void,delay:number)=>unknown;clearTimer:(timer:unknown)=>void;eligible:()=>boolean;subscribe:(wake:()=>void)=>()=>void};

/** One refresh at a time. Shared lifecycle, independent endpoint/cache owners. */
export function createQqqRefreshLoop(refresh:()=>Promise<unknown>,interval:()=>number,env:RefreshEnvironment) {
  let stopped=false,busy=false,timer:unknown,lastStarted=env.now();
  const schedule=()=>{if(!stopped)timer=env.setTimer(()=>{void tick();},interval()||60_000);};
  const tick=async()=>{
    if(stopped||busy)return;
    const period=interval();
    if(period&&env.eligible()&&env.now()-lastStarted>=period){
      busy=true;lastStarted=env.now();
      try{await refresh();}catch{/* The owner exposes errors; keep future retries alive. */}
      finally{busy=false;}
    }
    schedule();
  };
  const unsubscribe=env.subscribe(()=>{
    if(stopped||busy||!env.eligible()||!interval()||env.now()-lastStarted<interval())return;
    env.clearTimer(timer);void tick();
  });
  schedule();
  return()=>{stopped=true;env.clearTimer(timer);unsubscribe();};
}

export function startQqqRefreshLoop(refresh:()=>Promise<unknown>,interval:()=>number) {
  return createQqqRefreshLoop(refresh,interval,{
    now:Date.now,setTimer:(run,delay)=>window.setTimeout(run,delay),clearTimer:timer=>window.clearTimeout(timer as number),
    eligible:()=>navigator.onLine&&document.visibilityState==='visible',
    subscribe:wake=>{
      document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
      return()=>{document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);};
    },
  });
}
