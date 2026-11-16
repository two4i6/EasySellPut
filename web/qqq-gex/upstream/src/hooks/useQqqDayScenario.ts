'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dayScenarioKey, type DayScenarioInput, type DayScenarioMode, type DayScenarioField, type DayScenarioPolicy } from '@/lib/qqqDayScenario';
import { dayScenarioDisplay, type DayScenarioReply } from './qqqDayScenarioDisplay';
import { createDayScenarioWorker } from './qqqDayScenarioWorker';

// Bounded memory cache: immutable input bytes, no persistent archive or new API.
const cache=new Map<string,{field:DayScenarioField;input:DayScenarioInput}>();
export function useQqqDayScenario(input:DayScenarioInput,mode:DayScenarioMode,enabled:boolean,policy:DayScenarioPolicy='complete',scope='') {
  const key=useMemo(()=>dayScenarioKey(input,mode,policy),[input,mode,policy]);
  const context=JSON.stringify([input.date,mode,policy,scope]);
  const latest=useRef({input,mode,policy});latest.current={input,mode,policy};
  const [reply,setReply]=useState<DayScenarioReply|null>(null),[attempt,setAttempt]=useState(0);
  const replay=useRef<ReturnType<typeof createDayScenarioWorker>|null>(null);
  useEffect(()=>{
    if(!enabled)return;
    const controller=createDayScenarioWorker(result=>{
      if(result.field&&result.input){cache.delete(result.key);cache.set(result.key,{field:result.field,input:result.input});while(cache.size>4)cache.delete(cache.keys().next().value!);}
      setReply(result);
    },()=>new Worker(new URL('../lib/qqqDayScenario.worker.ts',import.meta.url)));
    replay.current=controller;
    return()=>{controller.dispose();replay.current=null;};
  },[context,enabled,attempt]);
  useEffect(()=>{
    if(!enabled)return;
    const cached=cache.get(key);
    // A cache hit is also the last displayed result for the next seek.
    if(cached){replay.current?.request(null);cache.delete(key);cache.set(key,cached);setReply({key,context,...cached});return;}
    replay.current?.request({key,context,...latest.current});
  },[key,context,enabled,attempt]);
  const cached=cache.get(key);
  const display=dayScenarioDisplay(key,context,cached?.field,reply,cached?.input,input);
  return {field:display.field,input:display.input,error:display.error,retained:enabled&&display.retained,loading:enabled&&display.pending,retry:()=>{setReply(null);setAttempt(n=>n+1);}};
}
