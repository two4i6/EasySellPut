'use client';
import { useEffect, useState } from 'react';
import { acquireExposureFrames, cachedExposureFrames, exposureFrames, type ExposureFrame } from '@/lib/qqqExposureWorkbench';

type Input = Parameters<typeof acquireExposureFrames>[0];
const empty: ExposureFrame[] = [];

/** Publish a complete immutable index; date/range changes cannot show old frames. */
export function useQqqExposureFrames(input: Input, enabled = true) {
  const [prepared,setPrepared]=useState<{input:Input;frames:ExposureFrame[]}|null>(null);
  const [failure,setFailure]=useState<Input|null>(null);
  const cached=cachedExposureFrames(input);
  // Preserve the immediate small overview/SSR chart. Full archives always use
  // cooperative indexing; checking lengths stops before inspecting big chains.
  let captures=0,strikes=0;
  const small=enabled&&input.frames.every(expiry=>{
    captures+=expiry.fullGexProfileHistory.length+1;
    if(captures>32)return false;
    strikes+=expiry.fullGexProfile.length;
    for(const point of expiry.fullGexProfileHistory){strikes+=point.strikes.length;if(strikes>2048)return false;}
    return strikes<=2048;
  });
  const ready=cached??(prepared?.input===input?prepared.frames:small?exposureFrames(input.frames,input.cutoff,input.scope,input.selected,input.sessionDate):null);
  useEffect(()=>{
    if(!enabled||ready)return;
    let active=true;
    const lease=acquireExposureFrames(input);
    void lease.promise.then(frames=>{if(active){setPrepared({input,frames});setFailure(null);}},()=>{if(active)setFailure(input);});
    return()=>{active=false;lease.release();};
  },[input,ready,enabled]);
  return {frames:ready??empty,loading:enabled&&!ready&&failure!==input,error:enabled&&failure===input};
}
