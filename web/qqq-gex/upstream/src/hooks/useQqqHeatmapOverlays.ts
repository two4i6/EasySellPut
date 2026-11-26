'use client';
import { useEffect, useState } from 'react';
import { acquireHeatmapOverlays, type HeatmapOverlayInput, type HeatmapOverlaySeries } from '@/lib/qqqHeatmapOverlays';

export function useQqqHeatmapOverlays(input: HeatmapOverlayInput, enabled: boolean) {
  const [prepared,setPrepared]=useState<{input:HeatmapOverlayInput;series:HeatmapOverlaySeries}|null>(null);
  const [failure,setFailure]=useState<HeatmapOverlayInput|null>(null);
  const ready=prepared?.input===input;
  useEffect(()=>{
    if(!enabled){setPrepared(previous=>previous?.input===input?previous:null);return;}
    if(ready)return;
    let mounted=true;
    const task=acquireHeatmapOverlays(input);
    void task.promise.then(series=>{
      if(mounted){setPrepared({input,series});setFailure(null);}
    }).catch(()=>{if(mounted)setFailure(input);});
    return()=>{mounted=false;task.release();};
  },[input,enabled,ready]);
  return {series:ready?prepared.series:null,error:failure===input};
}
