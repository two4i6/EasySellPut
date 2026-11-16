'use client';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import { exposureChartLatestPrices, exposureChartReplayReady, exposureReplayChartPayload, acquireExposureChartReplay, preparedExposureReplayRows } from '@/lib/qqqExposureChartReplay';
import { exposureReplayDisplayPayload, type QqqExposureReplayContext } from '@/lib/qqqExposureReplay';

/** Compose shared observation data; cold history preparation never blocks render. */
export function useQqqExposureChartProjection(data: QqqPcsApiResponse | null, replay: QqqExposureReplayContext | null, project: 'chart'|'snapshot'|'none' = 'chart') {
  const [,setRevision]=useState(0);
  const [error,setError]=useState<{frames:QqqExposureReplayContext['frames'];message:string}|null>(null);
  const frames=replay?.frames,bars=replay?.bars;
  const chart = project === 'chart';
  useEffect(()=>{
    if(!frames||!bars)return;
    const lease=acquireExposureChartReplay({frames,bars,chart});
    let active=true;
    void lease.promise.then(()=>{if(active){setError(null);setRevision(value=>value+1);}}).catch(()=>{if(active)setError({frames,message:'图表历史整理失败，请重新选择日期。'});});
    return()=>{active=false;lease.release();};
  },[frames,bars,chart]);
  const ready=!frames||!bars||(chart?exposureChartReplayReady(frames,bars):Boolean(preparedExposureReplayRows(frames,bars)));
  const chartData=useMemo(()=>project==='none'||!data||!replay?data:exposureChartLatestPrices(data,replay,project==='chart'&&ready?exposureReplayChartPayload(data,replay):exposureReplayDisplayPayload(data,replay)),[data,replay,ready,project]);
  return {chartData,loading:!ready,error:error&&error.frames===frames?error.message:null};
}
