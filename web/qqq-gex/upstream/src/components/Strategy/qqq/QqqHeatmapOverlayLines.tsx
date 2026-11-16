import { useMemo } from 'react';
import { heatmapLinePaths, heatmapOverlayAxes, type HeatmapOverlayFlags, type HeatmapOverlaySeries } from '@/lib/qqqHeatmapOverlays';
import { formatQqqMatrixGex } from './qqqGexMatrixModel';

const colors={vwap:'#facc15',delta:'#c4a5ff',iv:'#2dd4bf',putCall:'#f472b6'};
const names={vwap:'VWAP',delta:'模型净 Delta',iv:'ATM IV',putCall:'Put / Call'};
export default function QqqHeatmapOverlayLines({series,flags,cutoff,start,x,priceY,plotLeft,plotRight,plotHeight,expiry,scope='selected',error}:{series:HeatmapOverlaySeries|null;flags:HeatmapOverlayFlags;cutoff:number;start:number;x:(time:number)=>number;priceY:(value:number)=>number;plotLeft:number;plotRight:number;plotHeight:number;expiry:string|null;scope?:'selected'|'all';error:boolean}) {
  const axes=heatmapOverlayAxes(flags);
  const axisX=(key:keyof HeatmapOverlayFlags)=>plotRight+8+axes.indexOf(key as typeof axes[number])*68;
  const lines=useMemo(()=>Object.entries(flags).filter(([,enabled])=>enabled).map(([name])=>{
    const key=name as keyof HeatmapOverlayFlags;
    const points=(series?.[key]??[]).filter(p=>p.time>=start&&p.time<=cutoff);
    const values=points.flatMap(p=>p.value!==null?[p.value]:[]);
    const min=Math.min(...values),max=Math.max(...values),pad=Math.max(key==='iv'?.005:key==='putCall'?.05:1,(max-min)*.1);
    const low=key==='iv'||key==='putCall'?Math.max(0,min-pad):min-pad,high=max+pad;
    const y=key==='vwap'?priceY:(v:number)=>24+(high-v)/(high-low)*plotHeight;
    const format=(v:number)=>key==='iv'?`${(v*100).toFixed(1)}%`:key==='delta'?formatQqqMatrixGex(v):v.toFixed(2);
    const last=points.at(-1);
    return {key,points,paths:heatmapLinePaths(points,cutoff,x,y),low,high,y,format,last,valid:values.length>0};
  }),[series,flags,cutoff,start,x,priceY,plotHeight]);
  return <g aria-label="Heatmap 叠加曲线">
    {lines.map(line=><g key={line.key}>
      {line.key==='vwap'&&<text x={plotLeft} y="13" fill={colors.vwap} fontSize="10"><title>当天常规交易时段已收盘 K 线的成交量加权典型价</title>VWAP {line.last?.value!=null?line.format(line.last.value):error?'整理失败':series?'暂无数据':'—'}</text>}
      <g clipPath="url(#qqq-exposure-clip)">{line.key==='putCall'&&line.points.map(point=>point.value===null?null:<circle key={point.time} cx={x(point.time)} cy={line.y(point.value)} r="1.5" fill={colors.putCall} pointerEvents="none"/>)}<path aria-label={`${names[line.key]}覆盖变化连接线`} d={line.paths.transitions} fill="none" stroke={colors[line.key]} strokeWidth="1.6" strokeDasharray="3 3" opacity=".65" pointerEvents="none"><title>虚线连接两个有效快照；输入覆盖发生变化，不能把这段变化视为同口径趋势。</title></path><path aria-label={`${names[line.key]}线`} d={line.paths.solid} fill="none" stroke={colors[line.key]} strokeWidth="1.6" strokeLinejoin="round" pointerEvents="none" /></g>
      {line.key==='putCall'&&line.valid&&line.low<=1&&line.high>=1&&<line aria-label="Put / Call 等量参考线" x1={plotLeft} x2={plotRight} y1={line.y(1)} y2={line.y(1)} stroke={colors.putCall} strokeDasharray="3 4" opacity=".35" pointerEvents="none"/>}
      {line.key!=='vwap'&&<g aria-label={`${names[line.key]}独立刻度`}>
        <text x={axisX(line.key)} y="13" fill={colors[line.key]} fontSize="9"><title>{`${names[line.key]}${line.last?.partial?(line.key==='putCall'?'（部分有效成交量）':'（部分有效持仓）'):''} ${line.last?.value!=null?line.format(line.last.value):'暂无数据'}${line.key==='iv'||line.key==='putCall'?` · ${scope==='all'?'合计范围'+(line.key==='iv'?'（OI 加权）':''):'所选到期日 '+expiry}`:' · 持仓模型估算，不是 HIRO'}`}</title>{line.key==='iv'?'ATM IV':line.key==='putCall'?`P/C ${line.last?.value!=null?line.format(line.last.value):'—'}`:`模型 Δ$${line.last?.partial?'*':''}`}{line.key==='iv'&&line.last?.partial?'*':''}</text>
        {line.valid?[line.low,(line.low+line.high)/2,line.high].map((value,i)=><text key={i} x={axisX(line.key)} y={line.y(value)+4} fill={colors[line.key]} fontSize="9">{line.format(value)}</text>):<text x={axisX(line.key)} y="38" fill={colors[line.key]} fontSize="9">{error?'整理失败':'—'}</text>}
      </g>}
    </g>)}
  </g>;
}
