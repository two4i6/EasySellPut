import QqqInfoTooltip from '../QqqInfoTooltip';
import { QqqObservationHeading, QqqObservationEmpty } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareQqqAtmIvObservation, qqqAtmIvAt, qqqAtmIvObservationCutoff } from '@/lib/qqqAtmIvObservation';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { qqqEasternDateKey } from '@/lib/qqqMarketDate';
import { EMPTY_OBSERVATION_EXPIRIES, EMPTY_OBSERVATION_FRAMES, EMPTY_OBSERVATION_BARS } from '@/lib/qqqOptionObservationHistory';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
const timeFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const timeLabel=(time:number)=>timeFormatter.format(time);
const pct=(iv:number|null|undefined)=>iv==null?'—':(iv*100).toFixed(1)+'%';
export default function QqqAtmIvCard({data,replay,selectedExpiry}:{selectedExpiry:string|null;data:QqqPcsApiResponse;replay:QqqExposureReplayContext|null}){
  const visible=useQqqTerminalTabVisible();
  const host=useRef<HTMLDivElement>(null),[width,setWidth]=useState(300);
  useEffect(()=>{if(!visible||!host.current)return;const observer=new ResizeObserver(([entry])=>{if(entry.contentRect.width>0)setWidth(Math.max(100,Math.round(entry.contentRect.width)-18));});observer.observe(host.current);return()=>observer.disconnect();},[visible]);
  const cutoff=qqqAtmIvObservationCutoff(Date.parse(data.observedAt??data.asOf),replay);
  const expiries=data.intraday?.gexExpiries??EMPTY_OBSERVATION_EXPIRIES;
  const frames=replay?.rawFrames??replay?.frames??EMPTY_OBSERVATION_FRAMES;
  const bars=replay?.bars??data.intraday?.bars??EMPTY_OBSERVATION_BARS;
  const date=data.view.date??qqqEasternDateKey(data.asOf);
  const input=useMemo(()=>({expiries,frames,bars,date}),[expiries,frames,bars,date]);
  const [prepared,setPrepared]=useState<{input:typeof input;tracks:Awaited<ReturnType<typeof prepareQqqAtmIvObservation>>}|null>(null);
  const [failure,setFailure]=useState<typeof input|null>(null);
  const ready=prepared?.input===input;
  useEffect(()=>{
    if(!visible||ready)return;
    const controller=new AbortController();
    void prepareQqqAtmIvObservation(input.expiries,input.frames,input.bars,input.date,controller.signal).then(tracks=>{
      if(!controller.signal.aborted){setPrepared({input,tracks});setFailure(null);}
    }).catch(()=>{if(!controller.signal.aborted)setFailure(input);});
    return()=>controller.abort();
  },[input,visible,ready]);
  const cachedTracks=useMemo(()=>prepared?.input===input?prepared.tracks:[],[prepared,input]);
  const labels=useMemo(()=>new Map(cachedTracks.flatMap(track=>track.history.map(point=>[point.time,timeLabel(point.time)] as const))),[cachedTracks]);
  const labelAt=(time:number)=>labels.get(time)??timeLabel(time);
  const tracks=useMemo(()=>qqqAtmIvAt(cachedTracks,cutoff),[cachedTracks,cutoff]);
  const expiry=selectedExpiry??replay?.selectedExpiry??data.intraday?.gexExpiries?.[0]?.expiryDate;
  const track=tracks.find(t=>t.expiry===expiry);
  const values=tracks.flatMap(t=>t.latest?.iv!=null?[t.latest.iv]:[]);
  const historyValues=track?.history.flatMap(p=>p.iv!=null?[p.iv]:[])??[];
  const plot=(kind:'term'|'history'|'drift')=>{
    const term=kind!=='history';
    const points=term?tracks.map(t=>({x:t.dte,value:kind==='drift'?t.change:t.latest?.iv,time:t.latest?.time,label:t.expiry})):track?.history.map(p=>({x:p.time,value:p.iv,time:p.time,label:labelAt(p.time)}))??[];
    const all=kind==='drift'?points.flatMap(p=>p.value!=null?[p.value]:[]):kind==='term'?values:historyValues;
    if (!all.length) return <QqqObservationEmpty>{failure===input?'IV 整理失败，请重新选择到期日。':prepared?.input!==input?'正在整理 IV 曲线…':kind==='drift'?'至少需要两个有效 IV 时点才能计算漂移。':'等待有效 IV 报价与同期价格。'}</QqqObservationEmpty>;
    const low=Math.min(...all,...(kind==='drift'?[0]:[])),high=Math.max(...all,...(kind==='drift'?[0]:[])),pad=Math.max(.01,(high-low)*.15);
    const axisLow=kind==='drift'?low-pad:Math.max(0,low-pad),axisHigh=high+pad;
    const valueLabel=(value:number)=>kind==='drift'?`${value>=0?'+':''}${(value*100).toFixed(2)} pp`:pct(value);
    const from=points[0]?.x??0,to=points.at(-1)?.x??from;
    const left=kind==='drift'?58:40;
    const x=(value:number)=>from===to?(left+width-20)/2:left+(value-from)/Math.max(1,to-from)*(width-left-20),y=(value:number)=>18+(axisHigh-value)/(axisHigh-axisLow)*90;
    let lastLabelX=-Infinity;
    const labels=points.filter((p,i)=>{const px=x(p.x);if(i===points.length-1)return true;if(i===0||term&&px-lastLabelX>=55&&x(points.at(-1)!.x)-px>=55){lastLabelX=px;return true;}return false;});
    return <svg width="100%" height="138" viewBox={`0 0 ${width} 138`} role="img" aria-label={kind==='drift'?'各到期日 ATM IV 漂移':kind==='term'?'各到期日 ATM IV 曲线':'所选到期日 ATM IV 历史变化'}>
      {all.length>0&&[axisLow,(axisLow+axisHigh)/2,axisHigh].map((v,i)=><g key={i}><line x1={left} x2={width-20} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)"/><text x={left-5} y={y(v)+3} textAnchor="end" fill="#9ca3af" fontSize="9">{valueLabel(v)}</text></g>)}
      {kind==='drift'&&<line x1={left} x2={width-20} y1={y(0)} y2={y(0)} stroke="var(--text-secondary)" strokeDasharray="4 3"/>}
      {points.map((p,i)=>p.value!=null?<g key={p.x}>{i>0&&points[i-1].value!=null&&(term||p.x-points[i-1].x<=300000)&&<line x1={x(points[i-1].x)} y1={y(points[i-1].value!)} x2={x(p.x)} y2={y(p.value)} stroke="#2dd4bf" strokeWidth="1.5"/>}<circle cx={x(p.x)} cy={y(p.value)} r={term?p.label===expiry?5:3:1.2} fill="#2dd4bf" stroke={term&&p.label===expiry?'#e5e7eb':'none'} strokeWidth="1.5"/><title>{`${p.label} · ${valueLabel(p.value)} · ${p.time!=null?labelAt(p.time)+' ET':''}`}</title></g>:null)}
      {labels.map(p=><text key={p.x} x={x(p.x)} y="129" textAnchor="middle" fill="#9ca3af" fontSize="10">{term?p.label.slice(5):p.label}</text>)}
    </svg>;
  };

  return <div ref={host} aria-busy={prepared?.input!==input} style={{display:'grid',gap:8,minWidth:0}}>
    <section aria-label="ATM IV 期限曲线" className={styles.card}>
      <QqqObservationHeading title="IV 期限曲线" meta={`${replay&&!replay.followingLatest?'回放':'最新'} · 年化`} info="各到期日的平值隐含波动率，使用同期已收盘价格。白圈为所选到期日；缺失报价留空，跨到期日快照可能不同步。"/>
      {plot('term')}
    </section>
    <section aria-label="Volatility Drift · ATM IV 漂移" className={styles.card}>
      <QqqObservationHeading title="Volatility Drift" meta="ATM IV 变化 · pp" info="定义为当前 ATM IV 减去所选交易日已加载历史中的首个有效 ATM IV，单位为百分点（pp）；各到期日基线可能不同，不代表第三方同名指标的算法。至少需要两个有效时点；跟随统一回放。"/>
      {plot('drift')}
      <table className={styles.observationTable}>
        <thead><tr><th>到期日</th><th>Δ IV</th><th>基线 → 当前 ET</th></tr></thead>
        <tbody>{tracks.map(t=><tr key={t.expiry}><td>{t.expiry.slice(5)}</td><td>{t.change==null?'—':`${t.change>=0?'+':''}${(t.change*100).toFixed(2)} pp`}</td><td>{t.change!=null?`${labelAt(t.history.find(p=>p.iv!=null)!.time)} → ${labelAt(t.latest!.time)}`:'待两个有效时点'}</td></tr>)}</tbody>
      </table>
    </section>
    <section aria-label="当前 DTE 历史 IV" className={styles.card}>
      <QqqObservationHeading title="IV 历史变化" meta={track?`${track.dte}D · ${track.expiry.slice(5)}`:expiry??'未选择到期日'}/>
      {track?.latest?.iv!=null&&<div className={styles.metrics}><strong className={styles.value}>{pct(track?.latest?.iv)}</strong><span className={styles.delta}>{track?.change!=null?(track.change>=0?'↑ +':'↓ ')+(track.change*100).toFixed(2)+' pp':'—'} <QqqInfoTooltip label="IV 历史变化说明" content="相对首个有效快照的变化，单位为百分点（pp）。跟随顶部 DTE 与统一回放；曲线仅覆盖已加载历史，缺失不补值。"/></span></div>}
      {plot('history')}
      {track?.latest?.iv!=null&&<div className={styles.footer}><span>{timeLabel(track.latest.time)} ET</span><span>ATM · 年化</span></div>}
    </section>
  </div>;
}
