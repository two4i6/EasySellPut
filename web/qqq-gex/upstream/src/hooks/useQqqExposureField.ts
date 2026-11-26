'use client';
import { useEffect, useState } from 'react';
import { prepareExposureField } from '@/lib/qqqExposureWorkbench';

type Input=Parameters<typeof prepareExposureField>[0];
type Result=Awaited<ReturnType<typeof prepareExposureField>>;

/** Retain one completed visible field across mode switches; raw archives own
 * history storage. A stale input is never presented as the new date/window. */
export function useQqqExposureField(input:Input,active:boolean) {
  const [prepared,setPrepared]=useState<{input:Input;result:Result}|null>(null);
  const [failure,setFailure]=useState<{input:Input;message:string}|null>(null);
  const ready=prepared?.input===input;
  useEffect(()=>{
    if(!active){setPrepared(previous=>previous?.input===input?previous:null);return;}
    if(ready)return;
    const controller=new AbortController();
    void prepareExposureField(input,controller.signal).then(result=>{
      if(!controller.signal.aborted){setPrepared({input,result});setFailure(null);}
    }).catch(()=>{if(!controller.signal.aborted)setFailure({input,message:'热力图整理失败，请重新选择范围。'});});
    return()=>controller.abort();
  },[input,active,ready]);
  const error=failure?.input===input?failure.message:null;
  return {field:ready?prepared.result:null,loading:active&&!ready&&!error,error};
}
