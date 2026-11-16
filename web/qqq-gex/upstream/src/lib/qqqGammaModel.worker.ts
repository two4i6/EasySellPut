import { runQqqGammaModelJob, type QqqGammaModelJob, type QqqGammaModels } from './qqqGammaModelJob';

const cache=new Map<string,QqqGammaModels>();
const worker=self as unknown as {onmessage:(event:MessageEvent<QqqGammaModelJob>)=>void;postMessage:(value:unknown)=>void};
worker.onmessage=({data:job})=>{
  try {
    const models=cache.get(job.key)??runQqqGammaModelJob(job);
    cache.delete(job.key);cache.set(job.key,models);
    while(cache.size>16)cache.delete(cache.keys().next().value!);
    worker.postMessage({key:job.key,date:job.date,selectedExpiry:job.selectedExpiry,models});
  } catch {worker.postMessage({key:job.key,date:job.date,selectedExpiry:job.selectedExpiry,error:'Gamma 模型计算失败'});}
};
