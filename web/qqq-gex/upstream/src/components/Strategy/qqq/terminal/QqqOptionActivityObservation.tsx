'use client';

import { useMemo } from 'react';
import QqqInfoTooltip from '../QqqInfoTooltip';
import { QqqObservationSection, QqqObservationEmpty } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';
import type { PcsGexExpiry } from '@/types/qqqGex';
import { formatQqqMatrixGex } from '../qqqGexMatrixModel';
import { qqqOptionOverview } from '@/lib/qqqOptionObservation';

const number = (value: number | null) => value === null ? '—' : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toFixed(0);
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const snapshotTime = (value: string) => Number.isFinite(Date.parse(value)) ? `${timeFormat.format(new Date(value))} ET` : '时间未知';

export function QqqOptionActivityObservation({ expiry, scopeLabel, hideTitle=false, gexAvailable=true }: { expiry: PcsGexExpiry | null; scopeLabel?: string; hideTitle?:boolean; gexAvailable?:boolean }) {
  const overview = useMemo(() => qqqOptionOverview(expiry?.fullGexProfile ?? []), [expiry?.fullGexProfile]);
  if (!expiry || !overview.strikes) return <QqqObservationSection title="成交与持仓"><QqqObservationEmpty>等待当前范围的期权成交与持仓快照。</QqqObservationEmpty></QqqObservationSection>;

  const comparison = (label: string, call: number | null, put: number | null, format = number, coverage?: [number, number]) => {
    const total = call !== null && put !== null ? call + put : null;
    const share = total !== null && total > 0 ? call! / total * 100 : null;
    const partial = coverage?.some(count => count < overview.strikes);
    return <div style={{display:'grid',gap:4}} key={label} title={coverage ? `有效覆盖：Call ${coverage[0]}/${overview.strikes}，Put ${coverage[1]}/${overview.strikes}；缺失不计为零。` : undefined}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{color:'#60a5fa'}}>{format(call)}</span><span style={{color:'var(--text-tertiary)'}}>{label}{partial ? ' · 部分' : ''}</span><span style={{color:'#fb923c'}}>{format(put)}</span></div>
      <div style={{display:'flex',height:6,borderRadius:3,overflow:'hidden',background:'var(--border-subtle)'}} aria-label={`${label}：Call ${format(call)}，Put ${format(put)}`}>
        {share !== null && <><span style={{width:`${share}%`,background:'#60a5fa'}}/><span style={{flex:1,background:'#fb923c'}}/></>}
      </div>
    </div>;
  };
  return <section aria-label="期权成交与持仓观察" title={`${scopeLabel ?? expiry.expiryDate} · ${snapshotTime(expiry.asOf)}`} style={{display:'grid',gap:0}}>
    <QqqObservationSection className={styles.comparisons} title="成交与持仓" meta={`${scopeLabel??expiry.expiryDate} · ${snapshotTime(expiry.asOf)}`}><div style={{display:'flex',justifyContent:'space-between'}}><strong style={{color:'#60a5fa'}}>Call</strong><strong style={{color:'#fb923c'}}>Put</strong></div>
    {comparison('成交量',overview.call.volume,overview.put.volume,number,[overview.call.volumeCoverage,overview.put.volumeCoverage])}
    {comparison('持仓量 OI',overview.call.oi,overview.put.oi,number,[overview.call.oiCoverage,overview.put.oiCoverage])}
    {comparison('绝对 GEX',gexAvailable?overview.call.absoluteGex:null,gexAvailable?overview.put.absoluteGex:null,formatQqqMatrixGex,[overview.call.gexCoverage,overview.put.gexCoverage])}
    <div className={styles.ratio}><svg viewBox="0 0 48 48" role="img" aria-label={overview.putShare===null?'Put 成交占比不可用':`Put 成交占比 ${overview.putShare.toFixed(0)}%${overview.completeVolume?'':' · 部分数据'}`}><circle cx="24" cy="24" r="19" fill="none" stroke="var(--border-subtle)" strokeWidth="5"/>{overview.putShare!==null&&<><circle cx="24" cy="24" r="19" fill="none" stroke="#60a5fa" strokeWidth="5"/><circle cx="24" cy="24" r="19" fill="none" stroke="#fb923c" strokeWidth="5" pathLength={100} strokeDasharray={`${overview.putShare} 100`} transform="rotate(-90 24 24)"/></>}<text x="24" y="27" textAnchor="middle" fill="var(--text-primary)" fontSize="10">{overview.putShare===null?'—':`${overview.putShare.toFixed(0)}%`}</text></svg><div><span className={styles.meta}>Put / Call 成交比{overview.completeVolume?'':' · 部分'}</span><br/><strong>{overview.putCallRatio?.toFixed(2)??'—'}</strong><QqqInfoTooltip label="Put / Call 成交比说明" content={`已观察累计 Put 成交量 / Call 成交量，1 表示两侧相等。环形图为已观察成交的 Put 占比。有效成交覆盖：Call ${overview.call.volumeCoverage}/${overview.strikes}，Put ${overview.put.volumeCoverage}/${overview.strikes}；覆盖不全时仅代表部分数据，两侧覆盖可能不同。缺失不计为零，成交与持仓分布不代表买卖方向。`}/></div></div>
    <span className={styles.meta}>OI 为日结持仓，同日快照可能不变。</span>
    </QqqObservationSection>
    {(['call','put'] as const).map(side=>{
      const item=overview[side],color=side==='call'?'#60a5fa':'#fb923c';
      const maximum=Math.max(1,...item.top.map(point=>point.volume));
      return <QqqObservationSection key={side} title={`${side==='call'?'Call':'Put'} 成交集中价`} meta={`成交覆盖 ${item.volumeCoverage}/${overview.strikes} · OI ${item.oiCoverage}/${overview.strikes}`}>
        {item.top.map((point,index)=><div key={`${point.strike}:${index}`} style={{display:'grid',gridTemplateColumns:'55px minmax(0,1fr) 48px',gap:6,alignItems:'center'}} title={`行权价 ${point.strike.toFixed(2)} · 成交 ${point.volume} 张`}><span>{point.strike.toFixed(2)}</span><div style={{height:5,background:'var(--border-subtle)',borderRadius:3}}><div style={{height:'100%',width:`${point.volume/maximum*100}%`,background:color,borderRadius:3}}/></div><span style={{textAlign:'right'}}>{number(point.volume)}</span></div>)}
        {!item.top.length&&<span style={{color:'var(--text-tertiary)'}}>暂无有效成交排行</span>}
      </QqqObservationSection>;
    })}
    <div className={styles.footer}><span>{snapshotTime(expiry.asOf)}</span><QqqInfoTooltip label="成交持仓范围与覆盖说明" content={`${scopeLabel??expiry.expiryDate}。蓝色 Call，橙色 Put。覆盖数字表示有效成交量 / OI 记录数，不代表成交方向。`}/></div>
  </section>;
}
