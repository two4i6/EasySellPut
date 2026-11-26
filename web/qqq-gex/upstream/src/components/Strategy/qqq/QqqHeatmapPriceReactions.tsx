import { createQqqSharedPreparation } from '@/lib/qqqSharedPreparation';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { prepareExposureChartReplay, exposureReplayChartPayload } from '@/lib/qqqExposureChartReplay';
import { buildQqqChartObservationBands } from '@/lib/qqqChartObservationBands';
import { buildQqqShortTermReversalObservations } from '@/lib/qqqIntradaySetup';
import { qqqReadableMarkers } from '@/lib/qqqChartReadability';
import { buildQqqPcsIntradayChartData, buildObservedPriceLowMarkers, buildShortTermReversalMarkers } from './QqqPcsIntradayChart.shared';

export type HeatmapReactionFlags={markers:boolean;low:boolean;high:boolean};
export type HeatmapReactionInput={data:QqqPcsApiResponse;frames:NonNullable<QqqExposureReplayContext['frames']>;bars:QqqExposureReplayContext['bars'];scope:QqqExposureReplayContext['scope'];expiry:string|null;date:string};

/** Reuse the K-line's exact normalizer, bands, observations and marker builders.
 * The archive is prepared once; the cursor only clips the causal prefix. */
export async function prepareHeatmapPriceReactions(input:HeatmapReactionInput,signal:AbortSignal){
  await prepareExposureChartReplay(input.frames,input.bars,signal);
  await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();
  const frame=input.frames.at(-1)??null;
  const projected=exposureReplayChartPayload(input.data,{date:input.date,selectedExpiry:input.expiry,scope:input.scope,followingLatest:false,frame,bars:input.bars,frames:input.frames});
  const data=buildQqqPcsIntradayChartData(projected.intraday?.bars??[],[],undefined,undefined,projected.intraday?.gex??[],'2m');
  const bars=data.normalizedBars.map(b=>({...b,time:Number(b.time)}));
  const gex=data.gexTotal.map(p=>({time:Number(p.time),value:p.value}));
  const wallHistory=(projected.intraday?.wallHistory??[]).map(p=>({time:Math.floor(Date.parse(p.time)/1000),callWallPrice:p.callWallPrice,putWallPrice:p.putWallPrice}));
  const bands=buildQqqChartObservationBands({bars,vwap:data.vwap.map(p=>({time:Number(p.time),value:p.value})),wallHistory,gammaFlip:data.gammaFlip.map(p=>({time:Number(p.time),value:p.value})),asOf:(frame?.time??0)/1000});
  await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();
  const markers=buildShortTermReversalMarkers(buildQqqShortTermReversalObservations(bars,gex,wallHistory));
  return {bars:data.normalizedBars,bands:bands.zones,markers};
}

export const acquireHeatmapPriceReactions = createQqqSharedPreparation<HeatmapReactionInput, Awaited<ReturnType<typeof prepareHeatmapPriceReactions>>>(
  input => JSON.stringify([input.date,input.scope,input.scope==='all'?null:input.expiry]), prepareHeatmapPriceReactions,
);

export default function QqqHeatmapPriceReactions({input,flags,cutoff,start,end,x,y,plotLeft,plotRight}:{input:HeatmapReactionInput;flags:HeatmapReactionFlags;cutoff:number;start:number;end:number;x:(time:number)=>number;y:(price:number)=>number;plotLeft:number;plotRight:number}){
  const [prepared,setPrepared]=useState<{input:HeatmapReactionInput;result:Awaited<ReturnType<typeof prepareHeatmapPriceReactions>>}|null>(null);
  const enabled=flags.markers||flags.low||flags.high,ready=prepared?.input===input;
  useEffect(()=>{
    if(!enabled||ready)return;
    const lease=acquireHeatmapPriceReactions(input);
    let active=true;
    void lease.promise.then(result=>{if(active)setPrepared({input,result});}).catch(()=>{ /* Missing observations leave the chart unchanged. */ });
    return()=>{active=false;lease.release();};
  },[input,enabled,ready]);
  const model=ready?prepared.result:null;
  const markers=useMemo(()=>{
    if(!model||!flags.markers)return [];
    const visibleBars=model.bars.filter(b=>(Number(b.time)+120)*1000<=cutoff);
    const markers=[...model.markers.filter(m=>(Number(m.time)+120)*1000<=cutoff),...buildObservedPriceLowMarkers(visibleBars)].sort((a,b)=>Number(a.time)-Number(b.time));
    return qqqReadableMarkers(markers.map(m=>({...m,label:m.text})),m=>x((Number(m.time)+120)*1000)-plotLeft,plotRight-plotLeft);
  },[model,flags.markers,cutoff,x,plotLeft,plotRight]);
  const zonePaths=useMemo(()=>{
    const paths={low:{fill:'',anchor:''},high:{fill:'',anchor:''}};
    if(!model)return paths;
    for(let i=0;i<model.bands.length;i++){
      const point=model.bands[i]!,time=(point.time+120)*1000,next=model.bands[i+1];
      if(time>cutoff||time<start)continue;
      const right=Math.min(cutoff,end,(next?next.time+120:point.time+240)*1000,time+300000);
      if(right<=time)continue;
      for(const side of ['low','high'] as const){
        const zone=point[side];if(!zone||!(side==='low'?flags.low:flags.high))continue;
        const leftX=x(time),rightX=x(right),top=y(zone.upper),bottom=y(zone.lower),anchor=y(zone.anchor);
        paths[side].fill+=`M${leftX},${top}H${rightX}V${bottom}H${leftX}Z`;
        paths[side].anchor+=`M${leftX},${anchor}H${rightX}`;
      }
    }
    return paths;
  },[model,cutoff,start,end,x,y,flags.low,flags.high]);
  if(!model||!enabled)return null;
  return <g clipPath="url(#qqq-exposure-clip)" aria-label="价格反应观察">
    {(['low','high'] as const).map(side=>{
      const paths=zonePaths[side];if(!paths.fill)return null;
      const color=side==='low'?'#22c997':'#fb7185';
      return <g key={side} aria-label={side==='low'?'支撑观察区':'阻力观察区'}><title>{side==='low'?'支撑观察区 · 复用 K 线价格反应规则':'阻力观察区 · 复用 K 线价格反应规则'}</title><path d={paths.fill} fill={color} opacity=".12"/><path d={paths.anchor} fill="none" stroke={color} strokeWidth="1" opacity=".8"/></g>;
    })}
    {markers.map((marker,i)=>{
      const time=(Number(marker.time)+120)*1000;if(time<start||time>end)return null;
      const px=x(time),py=y(marker.price),below=marker.position==='belowBar'||marker.position==='atPriceBottom';
      const cy=py+(below?9:-9);
      return <g key={`${time}:${i}`} aria-label={marker.label||'价格观察标记'}><title>{marker.label||'价格观察标记'} · 研究观察</title>{marker.shape==='circle'?<circle cx={px} cy={cy} r="3" fill={marker.color}/>:<path d={below?`M${px-4},${cy+4}L${px},${cy-3}L${px+4},${cy+4}Z`:`M${px-4},${cy-4}L${px},${cy+3}L${px+4},${cy-4}Z`} fill={marker.color}/>}{marker.text&&<text x={px} y={cy+(below?15:-9)} textAnchor="middle" fontSize="9" fill={marker.color}>{marker.text}</text>}</g>;
    })}
  </g>;
}
