import type { DayScenarioInput, DayScenarioMode, DayScenarioPolicy } from '@/lib/qqqDayScenario';
import type { DayScenarioReply } from './qqqDayScenarioDisplay';

type Request = {key:string;context:string;input:DayScenarioInput;mode:DayScenarioMode;policy:DayScenarioPolicy};
type Reply = Pick<DayScenarioReply, 'key'|'field'|'error'>;
type ReplayWorker = Pick<Worker, 'postMessage'|'terminate'|'onmessage'|'onerror'>;

/** Finish one job while scrubbing, then compute only the latest requested snapshot. */
export function createDayScenarioWorker(onReply:(reply:DayScenarioReply)=>void, createWorker:()=>ReplayWorker) {
  let worker:ReplayWorker|null=null,active:Request|null=null,pending:Request|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{clearTimeout(timer);worker?.terminate();worker=null;};
  const finish=(result:Reply,restart=false)=>{
    const request=active;
    if(!request||result.key!==request.key)return;
    clearTimeout(timer);active=null;
    if(restart)stop();
    onReply({...result,context:request.context,input:result.field?request.input:undefined});
    send();
  };
  const send=()=>{
    if(active||!pending)return;
    active=pending;pending=null;
    if(!worker){
      try {worker=createWorker();}
      catch {finish({key:active.key,error:'无法启动日内情景计算'});return;}
      worker.onmessage=({data}:MessageEvent<Reply>)=>finish(data);
      worker.onerror=()=>{if(active)finish({key:active.key,error:'日内情景计算失败，请重试'},true);};
    }
    timer=setTimeout(()=>{if(active)finish({key:active.key,error:'日内情景计算超时，请重试'},true);},15_000);
    try {worker.postMessage(active);}
    catch {finish({key:active.key,error:'日内情景推演输入传输失败，请重试'},true);}
  };
  return {
    request(request:Request|null){pending=request&&active?.key!==request.key?request:null;send();},
    dispose(){active=null;pending=null;stop();},
  };
}
