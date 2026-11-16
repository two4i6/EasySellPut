
'use client';
import {useEffect,useState} from 'react';
import {prepareAggregateGammaFrames,type ExposureFrame} from '@/lib/qqqExposureWorkbench';
const empty:readonly ExposureFrame[]=[];
type Input={frames:readonly ExposureFrame[];spotAt:(time:number)=>number|null;aggregate:boolean};
/** Shared immutable model frames feed heat cells, overlays and sidebar replay. */
export function useQqqAggregateExposureFrames(input:Input){
 const [prepared,setPrepared]=useState<{input:Input;frames:readonly ExposureFrame[]}|null>(null);
 const [failure,setFailure]=useState<Input|null>(null);
 const ready=prepared?.input===input;
 useEffect(()=>{
  if(!input.aggregate||ready)return;
  const controller=new AbortController();
  void prepareAggregateGammaFrames(input.frames,input.spotAt,controller.signal).then(frames=>{
   if(!controller.signal.aborted){setPrepared({input,frames});setFailure(null);}
  }).catch(()=>{if(!controller.signal.aborted)setFailure(input);});
  return()=>controller.abort();
 },[input,ready]);
 return {frames:input.aggregate?ready?prepared.frames:empty:input.frames,loading:input.aggregate&&!ready&&failure!==input,error:failure===input};
}
