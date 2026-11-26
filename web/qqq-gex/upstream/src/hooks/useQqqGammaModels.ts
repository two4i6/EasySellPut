'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveSelectedGexExpiry } from '@/lib/qqqGexSelection';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { QQQ_GAMMA_INPUT_VERSION, type GammaModelStrike } from '@/lib/qqqGammaModel';
import type { QqqGammaModelJob, QqqGammaModels } from '@/lib/qqqGammaModelJob';
import { qqqClosedBarPrice } from '@/lib/qqqMarketSession';

const identities=new WeakMap<object,number>();let nextIdentity=0;
const identity=(value:object)=>{let key=identities.get(value);if(key===undefined){key=++nextIdentity;identities.set(value,key);}return key;};
type Reply={key:string;date:string;selectedExpiry:string|null;models?:QqqGammaModels;error?:string};

/** Single in-flight worker job plus one replaceable pending cursor. No queued
 * archive sweep, stale result publication, or scenario math on the UI thread. */
export function useQqqGammaModels(data:QqqPcsApiResponse,selectedExpiry:string|null,enabled:boolean) {
  const input=useMemo(()=>{
    const expiries=data.intraday?.gexExpiries??[];
    const active=resolveSelectedGexExpiry(expiries,selectedExpiry);
    const asOf=data.observedAt??data.asOf,stored=data.intraday?.gammaModels;
    const selected=active?.expiryDate??selectedExpiry;
    const last=qqqClosedBarPrice(data.intraday?.bars??[],asOf,data.intraday?.granularity==='5m'?300:120);
    const spot=last?.close??(stored?.available.asOf===asOf?stored.available.spot:NaN);
    const matching=stored&&stored.selected.inputQualityVersion===QQQ_GAMMA_INPUT_VERSION&&active&&stored.selected.spot===spot&&stored.selected.asOf===asOf&&stored.selected.expiries.length===1&&stored.selected.expiries[0]===active.expiryDate?stored:null;
    const key=JSON.stringify([data.view.date,asOf,spot,selected,...expiries.map(expiry=>[expiry.expiryDate,expiry.asOf,identity(expiry.fullGexProfile)])]);
    return {key,date:data.view.date??'',asOf,spot,selectedExpiry:selected,expiries,matching,availableModel:stored?.available.inputQualityVersion===QQQ_GAMMA_INPUT_VERSION&&stored.available.asOf===asOf&&stored.available.spot===spot&&stored.available.points.length?stored.available:undefined};
  },[data,selectedExpiry]);
  const [reply,setReply]=useState<Reply|null>(null);
  const worker=useRef<Worker|null>(null),busy=useRef(false);
  const latest=useRef({input,enabled});latest.current={input,enabled};
  const cache=useRef(new Map<string,Reply>());
  const send=useRef<()=>void>(()=>{});
  send.current=()=>{
    const current=latest.current;
    if(!current.enabled||current.input.matching||busy.current||cache.current.has(current.input.key)||!worker.current)return;
    const { key, date, asOf, spot, selectedExpiry, availableModel } = current.input;
    const job:QqqGammaModelJob={key,date,asOf,spot,selectedExpiry,availableModel,expiries:current.input.expiries.map(expiry=>({expiryDate:expiry.expiryDate,asOf:expiry.asOf,fullGexProfile:expiry.fullGexProfile.map((profile)=>{const p=profile as GammaModelStrike;return {strike:p.strike,callOi:p.callOi,putOi:p.putOi,callIv:p.callIv,putIv:p.putIv,callReceivedAt:p.callReceivedAt,putReceivedAt:p.putReceivedAt,inputComplete:p.inputComplete,computedAt:p.computedAt};})}))};
    busy.current=true;
    try { worker.current.postMessage(job); }
    catch { busy.current=false; const failure={key,date,selectedExpiry,error:'Gamma 后台计算输入传输失败'};cache.current.set(key,failure);setReply(failure); }
  };
  useEffect(()=>{
    if(!enabled||input.matching||cache.current.has(input.key))return;
    if(!worker.current){
      try {worker.current=new Worker(new URL('../lib/qqqGammaModel.worker.ts',import.meta.url));}
      catch {setReply({key:input.key,date:input.date,selectedExpiry:input.selectedExpiry,error:'无法启动 Gamma 后台计算'});return;}
      worker.current.onmessage=({data:result}:MessageEvent<Reply>)=>{
        busy.current=false;
        if(result.models||result.error){cache.current.set(result.key,result);while(cache.current.size>16)cache.current.delete(cache.current.keys().next().value!);}
        if(result.key===latest.current.input.key&&latest.current.enabled)setReply(result);
        send.current();
      };
      worker.current.onerror=()=>{busy.current=false;setReply({key:latest.current.input.key,date:latest.current.input.date,selectedExpiry:latest.current.input.selectedExpiry,error:'Gamma 后台计算失败'});worker.current?.terminate();worker.current=null;};
    }
    send.current();
  },[input,enabled]);
  useEffect(()=>()=>{worker.current?.terminate();worker.current=null;busy.current=false;},[]);
  const result=cache.current.get(input.key)??(reply?.key===input.key?reply:null);
  const retained=reply?.date===input.date&&reply.selectedExpiry===input.selectedExpiry?reply.models:null;
  return {models:input.matching??result?.models??retained??null,loading:enabled&&!input.matching&&!result,error:result?.error??null};
}
