import { memo, useMemo } from 'react';
import { discoveryIndexAt, type DiscoveryFlags, type DiscoverySeries } from '@/lib/qqqHeatmapDiscovery';
import { heatmapLinePath } from '@/lib/qqqHeatmapOverlays';
import type { QqqGammaPositionLevel } from '@/lib/qqqGammaPosition';
import { formatQqqMatrixGex } from './qqqGexMatrixModel';
import styles from './QqqHeatmapDiscovery.module.css';
import { QqqObservationHeading, QqqObservationEmpty } from './terminal/QqqObservationUi';
const colors = {call: '#60a5fa', put: '#fb923c', zero: '#c4a5ff', bands: '#d6e3f5', skew: '#f472b6'};
const clock = new Intl.DateTimeFormat('zh-CN', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

/** Historical bands retain each snapshot's bounds; current forecasts never replace them. */
export const DiscoveryLayers = memo(function DiscoveryLayers({series, flags, cutoff, start, x, y, left, right, height, gammaHistory, expiry, scope, scenarioBands, bandEnd}: {scenarioBands?: DiscoverySeries; bandEnd?: number; series: DiscoverySeries | null; flags: DiscoveryFlags; cutoff: number; start: number; x: (time: number) => number; y: (price: number) => number; left: number; right: number; height: number; gammaHistory: readonly QqqGammaPositionLevel[]; expiry: string | null; scope: 'selected' | 'all'}) {
  const paths = useMemo(() => {
    const rows = series?.rows ?? [];
    const track = (side: 'call' | 'put') => heatmapLinePath(rows.map(row => ({time: row.time, value: row[side]})), Infinity, x, y);
    // Only reuse a saved model zero; never infer it from per-strike sign changes.
    const zero = scope === 'selected' ? gammaHistory.filter(p => p.expiryDate === expiry && p.sourceAsOf !== null && Date.parse(p.sourceAsOf) <= Date.parse(p.time) && Date.parse(p.time) - Date.parse(p.sourceAsOf) <= 300_000).map(p => ({time: Date.parse(p.time), value: p.zeroGamma})).filter(p => Number.isFinite(p.time)).sort((a, b) => a.time - b.time) : [];
    const bands = [{kind: 'history', rows: rows.slice(0, discoveryIndexAt(rows, cutoff) + 1)}, ...(scenarioBands ? [{kind: 'forecast', rows: scenarioBands.rows}] : [])].map(({kind, rows: bandRows}) => {
      let band = '', run: typeof rows = [];
      const flush = () => {
        if (!run.length) return;
        band += `M${run.map(r => `${x(r.time).toFixed(2)},${y(r.upper!).toFixed(2)}`).join('L')}L${run.slice().reverse().map(r => `${x(r.time).toFixed(2)},${y(r.lower!).toFixed(2)}`).join('L')}Z`;
        run = [];
      };
      for (const row of bandRows) {
        if (row.lower === null || row.upper === null) {flush(); continue;}
        if (run.length && row.time - run.at(-1)!.time > 300_000) flush();
        run.push(row);
      }
      flush();
      return {kind, band, lower: heatmapLinePath(bandRows.map(r => ({time: r.time, value: r.lower})), Infinity, x, y), upper: heatmapLinePath(bandRows.map(r => ({time: r.time, value: r.upper})), Infinity, x, y)};
    });
    return {call: track('call'), put: track('put'), zero, bands};
  }, [series, x, y, gammaHistory, expiry, scope, scenarioBands, cutoff]);
  const zeroPath=useMemo(()=>heatmapLinePath(paths.zero,cutoff,x,y),[paths.zero,cutoff,x,y]);
  const events = useMemo(() => series?.events.slice(0, discoveryIndexAt(series.events, cutoff) + 1).slice(-80) ?? [], [series, cutoff]);
  const rangeLabels=useMemo(()=>{
    const rows=scenarioBands?.rows??series?.rows??[];
    const row=rows[discoveryIndexAt(rows,scenarioBands?bandEnd??cutoff:cutoff)];
    if(!row||row.upper===null||row.lower===null||!Number.isFinite(row.upper)||!Number.isFinite(row.lower))return [];
    const upperY=Math.max(34,Math.min(24+height-34,y(row.upper)));
    const lowerY=Math.max(upperY+24,Math.min(24+height-10,y(row.lower)));
    return [{key:'upper',label:'上沿',price:row.upper,y:upperY,time:row.time},{key:'lower',label:'下沿',price:row.lower,y:lowerY,time:row.time}];
  },[scenarioBands,series,bandEnd,cutoff,y,height]);
  return <g aria-label="关键位轨迹与波动带" clipPath="url(#qqq-exposure-clip)">
    <defs><clipPath id="qqq-discovery-cutoff"><rect x={left} y="24" width={Math.max(0, Math.min(right, x(cutoff)) - left)} height={height}/></clipPath><clipPath id="qqq-discovery-band-cutoff"><rect x={left} y="24" width={Math.max(0, Math.min(right, x(bandEnd ?? cutoff)) - left)} height={height}/></clipPath></defs>
    <g pointerEvents="none">
      {flags.bands && <g aria-label="预期波动带">{paths.bands.filter(band=>band.band).map(band=><g key={band.kind} aria-label={band.kind==='history'?'波动带历史变化':'当前快照预测波动带'} clipPath={`url(#${band.kind==='history'?'qqq-discovery-cutoff':'qqq-discovery-band-cutoff'})`}><title>{`${band.kind==='forecast' ? '日内情景推演 · 固定输入快照价格与 ATM IV · 从输入时刻向未来展开的 1SD 预测带' : '历史快照 · 当时价格与 ATM IV · 剩余到期 1SD 范围'} · ${scope==='all'?'可用合计 · 外侧包络':'所选到期日'}`}</title>
        <path d={band.band} fill={colors.bands} opacity=".08"/>
        {(['upper','lower'] as const).map(key => <g key={key} aria-label={key==='upper'?'预期波动带上沿':'预期波动带下沿'}>
          <path d={band[key]} stroke={colors.bands} strokeWidth="1.2" opacity=".85" fill="none" strokeDasharray={band.kind==='forecast'?'4 4':undefined} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        </g>)}
      </g>)}</g>}
      {flags.bands&&rangeLabels.length>0&&<g aria-label="预期价格范围">{rangeLabels.map(label=><g key={label.key} aria-label={`预期${label.label}价格`}>
        <title>{`${scenarioBands?'图中右端预测':'回放快照范围'} · ${clock.format(label.time)} ET · 1SD · ${scope==='all'?'可用合计 · 外侧包络':`所选到期日 ${expiry??'—'}`} · ${label.label} $${label.price.toFixed(2)}`}</title>
        <rect x={right-112} y={label.y-10} width="108" height="20" rx="3" fill="#10151e" fillOpacity=".9" stroke={colors.bands} strokeOpacity=".35"/>
        <text x={right-9} y={label.y+4} textAnchor="end" fill={colors.bands} fontSize="11" fontFamily="var(--font-geist-mono), monospace">{`${label.label} $${label.price.toFixed(2)}`}</text>
      </g>)}</g>}
      {flags.tracks && <g aria-label="关键位历史轨迹" clipPath="url(#qqq-discovery-cutoff)">{(['call','put','zero'] as const).map(side => <path key={side} aria-label={side === 'zero' ? '已保存模型零点轨迹' : `${side === 'call' ? 'Call' : 'Put'} 集中位轨迹`} d={side==='zero'?zeroPath:paths[side]} stroke={colors[side]} strokeWidth="1.5" fill="none" strokeDasharray={side === 'zero' ? '4 4' : undefined}/>)}</g>}
    </g>
    {flags.events && events.filter(e => e.time >= start).map((event, i) => <g key={`${event.time}:${event.kind}:${event.side}:${i}`} aria-label={event.kind === 'touch' ? '关键位触碰事件' : '关键位迁移事件'}><circle cx={x(event.time)} cy={y(event.price)} r={event.kind === 'touch' ? 3 : 2.5} fill={event.kind === 'touch' ? colors[event.side] : '#05070b'} stroke={colors[event.side]}/><title>{`${clock.format(event.time)} · ${event.side === 'call' ? 'Call' : 'Put'} ${event.kind === 'touch' ? '触碰' : '迁移'} ${event.from !== undefined ? event.from + ' → ' : ''}${event.price}${event.partial?' · 部分数据':''}`}</title></g>)}
  </g>;
});

export default memo(function DiscoveryPanels({series, flags, cutoff, minutes, onSeek, scope, error}: {series: DiscoverySeries | null; flags: DiscoveryFlags; cutoff: number; minutes: number; onSeek: (time: number, strike?: number) => void; scope: 'selected' | 'all'; error: boolean}) {
  const index = series ? discoveryIndexAt(series.rows, cutoff) : -1;
  const row = series?.rows[index];
  const changes = row?.changes[minutes] ?? [], maximum = Math.max(1, ...changes.map(p => Math.abs(p.value)));
  const events = series?.events.slice(0, discoveryIndexAt(series.events, cutoff) + 1).slice(-12).reverse() ?? [];
  const missing = error ? '整理失败' : series ? '数据不足' : '整理中…';
  return <div className={styles.panels}>
    {flags.changes && <section className={styles.card} aria-label="最大变化行权价"><QqqObservationHeading title="暴露变化排行" meta={`近 ${minutes} 分钟 · ${scope==='all'?'合计':'所选到期日'} · ${series?.unit==='per-point'?'$ / 点':'$ / 1%'}${row?.partial?' · 部分数据':''}`} info="所选范围净 GEX 的快照差值；旧口径复用 OI / IV 模型重算（Call 正、Put 负），按绝对变化排序；蓝为增加，橙为减少，均不表示买卖方向。仅比较覆盖、计算版本和单位一致的快照；未知口径、缺失与长间隔留空。窗口实际起点显示在下方。点击行权价在变化时刻回放。"/>
      <div className={styles.changes}>{changes.length ? changes.map(change => <button key={change.strike} type="button" onClick={() => onSeek(row!.time, change.strike)} title={`回放 ${clock.format(row!.time)} · 原值 ${formatQqqMatrixGex(change.before)} → ${formatQqqMatrixGex(change.current)}`}><b>{change.strike.toFixed(2)}</b><span className={styles.track}><i className={styles.zero}/><i style={{left: change.value >= 0 ? '50%' : `${50 - Math.abs(change.value) / maximum * 50}%`, width: `${Math.abs(change.value) / maximum * 50}%`, background: change.value >= 0 ? colors.call : colors.put}}/></span><output style={{color: change.value >= 0 ? colors.call : colors.put}}>{formatQqqMatrixGex(change.value)}</output></button>) : <QqqObservationEmpty>{error?'整理失败，请重新选择日期。':series?'等待可比较的快照，更新后显示变化排行。':'正在整理快照…'}</QqqObservationEmpty>}</div>
      {row?.comparedAt[minutes] != null && <footer>{clock.format(row.comparedAt[minutes]!)} → {clock.format(row.time)} ET</footer>}
    </section>}
    {flags.events && <section className={styles.card} aria-label="关键位事件回放"><QqqObservationHeading title="关键位事件" meta="最近 12 条 · 点击回放" info="实心点为已收盘两分钟 K 线触碰开盘时已知的集中位；空心点为同口径快照中两个持续有效集中位之间的迁移。部分数据仅使用输入有效的行权价；集中位消失或新出现不计为迁移，无关行权价失效不阻断事件。相同类型、方向、价位冷却 10 分钟。只显示回放时刻之前的事件，点击定位统一回放；不是交易信号。"/><div className={styles.events}>{events.length ? events.map((event, i) => <button type="button" key={`${event.time}:${event.side}:${event.kind}:${i}`} onClick={() => onSeek(event.time, event.price)} aria-label={`回放 ${clock.format(event.time)} ${event.side} ${event.kind === 'touch' ? '触碰' : '迁移'}`}><time>{clock.format(event.time)}</time><i style={{color: colors[event.side]}}>{event.kind === 'touch' ? '●' : '◇'}</i><span>{event.side === 'call' ? 'Call' : 'Put'} {event.kind === 'touch' ? '触碰' : '迁移'}{event.partial?'（部分）':''}</span><b>{event.from !== undefined ? `${event.from} → ` : ''}{event.price}</b><span>↗</span></button>) : <QqqObservationEmpty>{series ? '截至当前回放时刻，暂无关键位事件。' : missing}</QqqObservationEmpty>}</div></section>}
  </div>;
});

/** Independent pp axis occupies space only while IV skew is enabled. */
export const DiscoverySkewLine=memo(function DiscoverySkewLine({series,cutoff,start,x,left,right,height,axisOffset,scope}:{series:DiscoverySeries|null;cutoff:number;start:number;x:(time:number)=>number;left:number;right:number;height:number;axisOffset:number;scope:'selected'|'all'}){
  const line=useMemo(()=>{
    const points=series?.rows.slice(0,discoveryIndexAt(series.rows,cutoff)+1).filter(r=>r.time>=start).map(r=>({time:r.time,value:r.skew}))??[];
    const values=points.flatMap(p=>p.value===null?[]:[p.value]),min=Math.min(...values),max=Math.max(...values);
    const pad=Math.max(.001,(max-min)*.1),low=min-pad,high=max+pad;
    const y=(value:number)=>24+(high-value)/(high-low)*height;
    return {path:heatmapLinePath(points,cutoff,x,y),low,high,y,last:points.at(-1)?.value,valid:values.length>0};
  },[series,cutoff,start,x,height]);
  const axisX=right+8+axisOffset,format=(value:number)=>`${value>=0?'+':''}${(value*100).toFixed(2)}pp`;
  return <g aria-label="IV 偏斜叠加指标">
    <g clipPath="url(#qqq-exposure-clip)" pointerEvents="none"><path aria-label="IV 偏斜线" d={line.path} fill="none" stroke={colors.skew} strokeWidth="1.6"/>{line.valid&&line.low<=0&&line.high>=0&&<line x1={left} x2={right} y1={line.y(0)} y2={line.y(0)} stroke={colors.skew} opacity=".3" strokeDasharray="3 4"/>}</g>
    <g aria-label="IV 偏斜独立刻度"><text x={axisX} y="13" fill={colors.skew} fontSize="9"><title>{`25Δ Put IV − Call IV · ${scope==='all'?'合计 OI 加权':'所选到期日'} · ${line.last!=null?format(line.last):'暂无有效报价'}`}</title>IV 偏斜</text>{line.valid?[line.high,(line.low+line.high)/2,line.low].map((value,i)=><text key={i} x={axisX} y={line.y(value)+4} fill={colors.skew} fontSize="9">{format(value)}</text>):<text x={axisX} y="38" fill={colors.skew} fontSize="9">—</text>}</g>
  </g>;
});
