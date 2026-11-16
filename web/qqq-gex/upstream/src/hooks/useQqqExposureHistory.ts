'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readQqqHistoryClient } from '@/lib/qqqHistoryClient';
import { qqqMarketDateBounds as exposureDayBounds } from '@/lib/qqqMarketDate';
import type { ExposureHistoryDay } from '@/lib/qqqExposureHistoryModel';
import { startQqqRefreshLoop,qqqExposureRefreshInterval } from '@/lib/qqqRefreshLoop';
import { readQqqExposureArchive } from '@/lib/qqqExposureArchiveClient';

/** Complete history transport, independent of the chart/replay renderer. */
export function useQqqExposureHistory(date: string | null, archiveExpiry: string | null, active: boolean) {
  const [archive,setArchive]=useState<{key:string;day:ExposureHistoryDay}|null>(null);
  const [archiveStatus,setArchiveStatus]=useState<{key:string;loading:boolean;error:string|null}|null>(null);
  const [archiveRetry,setArchiveRetry]=useState(0);
  const completed = useRef<{key:string;day:ExposureHistoryDay}|null>(null);
  const retryConsumed = useRef(0);
  const archiveKey=`${date}:${archiveExpiry??'all'}`;
  const archived=archive?.key===archiveKey?archive.day:null;
  const archiveLoading=active&&Boolean(date)&&(archiveStatus?.key!==archiveKey||archiveStatus.loading);
  const archiveError=archiveStatus?.key===archiveKey?archiveStatus.error:null;
  const retryArchive=useCallback(()=>setArchiveRetry(value=>value+1),[]);
  useEffect(()=>{
    
    if(!active||!date)return;
    const controller=new AbortController();
    const ttlMs=Date.parse(exposureDayBounds(date).to)<Date.now()-3600_000?900_000:15_000;
    let busy=false;
    let force=archiveRetry>retryConsumed.current;retryConsumed.current=archiveRetry;
    const refresh=async()=>{
      if(busy||controller.signal.aborted)return;
      busy=true;setArchiveStatus({key:archiveKey,loading:true,error:null});
      try {
        const day=await readQqqExposureArchive(date,archiveExpiry,readQqqHistoryClient,{
          signal:controller.signal,ttlMs,force,
          previous:completed.current?.key===archiveKey?completed.current.day:null,
          onProgress:day=>{if(!controller.signal.aborted)setArchive({key:archiveKey,day});},
        });
        if(!controller.signal.aborted){completed.current={key:archiveKey,day};setArchive(previous=>previous?.key===archiveKey&&previous.day===day?previous:{key:archiveKey,day});}
      } catch {
        if(!controller.signal.aborted)setArchiveStatus({key:archiveKey,loading:false,error:'完整历史读取失败，已显示的快照可能不完整。'});
      } finally {
        busy=false;force=false;if(!controller.signal.aborted)setArchiveStatus(previous=>previous?.key===archiveKey?{...previous,loading:false}:previous);
      }
    };
    void refresh();
    // Closed archives cannot receive intraday captures. Revisit/manual retry
    // still observes the normal cache TTL; do not poll them every 15 minutes.
    if(Date.parse(exposureDayBounds(date).to)<Date.now()-3600_000)return()=>controller.abort();
    // Keep a loaded day fresh too. Visibility avoids background request churn.
    const stop=startQqqRefreshLoop(refresh,qqqExposureRefreshInterval);
    return()=>{controller.abort();stop();};
  },[active,archiveKey,archiveExpiry,date,archiveRetry]);
  return { archived, archiveLoading, archiveError, retryArchive };
}
