'use client';
import QqqInfoTooltip from '../QqqInfoTooltip';
import { QqqObservationHeading, QqqObservationEmpty } from './QqqObservationUi';

import { QQQ_GEX_LABELS } from '@/lib/qqqGexLabels';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { QqqGammaModel } from '@/lib/qqqGammaModel';
import { qqqGammaModelPresentation } from '@/lib/qqqGammaModelPresentation';
import styles from './QqqGammaModelPanel.module.css';

const money = (value: number) => `${value < 0 ? '−' : ''}$${(Math.abs(value) / (Math.abs(value) >= 1e9 ? 1e9 : 1e6)).toFixed(1)}${Math.abs(value) >= 1e9 ? 'B' : 'M'}`;
const price = (value: number | null) => value === null ? '—' : value.toFixed(2);
const etTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '—';
const ageLabel = (seconds: number) => !Number.isFinite(seconds) || seconds < 0 ? '时间未知' : seconds < 3600 ? `${Math.max(1,Math.floor(seconds/60))} 分钟前` : seconds < 86400 ? `${Math.floor(seconds/3600)} 小时前` : `${Math.floor(seconds/86400)} 天前`;
export function QqqGammaModelPanel({ partial = false, scenarioCoverage, inputQuality, models, lockedScope, historical = false, loading = false, stale = false }: { partial?:boolean; scenarioCoverage?:string; inputQuality?:string|null; lockedScope?:'selected'|'available'; models?: { selected: QqqGammaModel; available: QqqGammaModel }; historical?: boolean; loading?: boolean; stale?: boolean }) {
  const [scope, setScope] = useState<'selected' | 'available'>('selected');
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const model = models?.[lockedScope??scope];
  const [showRemaining, setShowRemaining] = useState(true);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(historical)return;const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>window.clearInterval(timer);},[historical]);
  const presentation=qqqGammaModelPresentation(model,{historical,stale,loading,now});
  const points = model?.points;
  const geometry = useMemo(() => {
    if (!points?.length) return null;
    const min = points[0]!.price, max = points.at(-1)!.price;
    const values = points.flatMap(p => [p.gamma, ...(showRemaining && p.exNearest !== null ? [p.exNearest] : [])]);
    const lower = Math.min(0, ...values), upper = Math.max(0, ...values);
    const padding = Math.max((upper - lower) * .08, 1);
    const bottom = lower - padding, top = upper + padding;
    const x = (v: number) => 52 + (v - min) / (max - min) * 336;
    const y = (v: number) => 28 + (top - v) / (top - bottom) * 248;
    const path = (remaining: boolean) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.price).toFixed(2)},${y(remaining ? p.exNearest ?? 0 : p.gamma).toFixed(2)}`).join(' ');
    return { min, max, top, bottom, x, y, path };
  }, [points, showRemaining]);
  const levels = model ? [
    { label: '看跌集中位', value: model.levels.putWall, color: '#f87171', detail: '看跌 Gamma 集中位' },
    { label: '看涨集中位', value: model.levels.callWall, color: '#45d6c5', detail: '看涨 Gamma 集中位' },
    { label: '持仓集中位', value: model.levels.absoluteGamma, color: '#e78bc0', detail: 'Call + Put 总 Gamma 最大位' },
    { label: QQQ_GEX_LABELS.modelZero, value: model.levels.zeroGamma, color: '#b7a5ef', detail: '整体情景曲线最近的零交点' },
    { label: QQQ_GEX_LABELS.volatilityTrigger, value: model.volatilityTrigger.price, color: '#a5d66f', detail: model.volatilityTrigger.price === null ? model.volatilityTrigger.reason : '持续正 Gamma 缓冲区下边界' },
    { label: '参考现价', value: model.spot > 0 ? model.spot : null, color: '#7ba8ef', detail: '所选日期的模型估值参考价' },
  ] : [];
  const nearby = Object.values(levels.filter(l => l.label !== '参考现价' && l.value !== null && Number.isFinite(l.value)).reduce<Record<string, {value:number; labels:string[]}>>((groups,l)=>{const key=String(l.value);(groups[key] ??= {value:l.value!,labels:[]}).labels.push(l.label);return groups;},{})).sort((a,b)=>Math.abs(a.value-(model?.spot ?? 0))-Math.abs(b.value-(model?.spot ?? 0)) || a.value-b.value).slice(0,3);
  const receivedAt=model?.dataTimes?model.dataTimes.receivedAt:model?.sourceAsOf ?? null;
  const sourceAgeSeconds = receivedAt ? (now-Date.parse(receivedAt))/1000 : Infinity;
  const maxNearbyDistance = Math.max(.1,...nearby.map(level=>Math.abs((level.value/(model?.spot || 1)-1)*100)));
  const positionLevels = model ? [
    {label:'参考价',value:model.spot,color:'#7ba8ef'},
    {label:'零交点',value:model.levels.zeroGamma,color:'#b7a5ef'},
    {label:'VT 下沿',value:model.volatilityTrigger.price,color:'#a5d66f'},
  ] : [];
  const positionValues = positionLevels.flatMap(level => level.value !== null && Number.isFinite(level.value) && level.value > 0 ? [level.value] : []);
  const positionMin = Math.min(...positionValues), positionMax = Math.max(...positionValues);
  const positionPadding = Math.max((positionMax-positionMin)*.2, (model?.spot ?? 0)*.0005, .05);
  const positionX = (value:number) => 100*(value-positionMin+positionPadding)/(positionMax-positionMin+positionPadding*2);
  const hover = hoverPrice === null ? null : points?.reduce((best, p) => Math.abs(p.price - hoverPrice) < Math.abs(best.price - hoverPrice) ? p : best);
  return <section aria-label="Gamma 波动地图">
    <div className={styles.panel}><QqqObservationHeading title="Gamma 价格情景" meta={partial?`部分数据情景${scenarioCoverage ? ` · ${scenarioCoverage} 行权价` : ''} · 每 1% 价格变动`:"持仓模型 · 每 1% 价格变动"} info={<><p>横轴是价格情景，竖线是模型价位。正负 Gamma 描述潜在波动环境，不表示涨跌。</p>{partial&&<p>仅使用 OI 与 IV 有效的行权价，剔除 IV 接近零（≤0.001%）的行权价，不补造 IV。零交点、集中位和 VT 下沿是部分持仓情景，可能与完整链不同。</p>}<p>模型按收到的 OI 和 IV 重算；数据接收时间不等于 OI 更新日期。集中位不是支撑、阻力或入场信号。</p><p>灰线剔除最近到期。淡色带是 IV ±5% 或时间推进 60 秒的敏感范围，不是预测区间；部分情景可能没有零交点或缓冲区。Volatility Trigger 是自研观察指标，尚待历史回放验证。</p></>}/>
      {!model || !geometry ? <QqqObservationEmpty>{loading?'正在计算价格情景…':model?.reason ?? (inputQuality ? '暂无有效模型。' : '等待期权持仓与 IV 更新。')}</QqqObservationEmpty> : <div className={styles.chartDetails}>
        <div className={styles.regime}><strong style={{color:model.spotGamma! < 0 ? 'var(--accent-danger)' : '#45d6c5'}}>{model.spotGamma! > 0 ? '正 Gamma' : model.spotGamma! < 0 ? '负 Gamma' : '零 Gamma'}</strong><span>{money(model.spotGamma!)} / 1% 变动</span></div>
        <svg className={styles.chart} viewBox="0 0 420 320" role="img" tabIndex={0} aria-label="QQQ 价格情景与整体 Gamma 敞口曲线，左右箭头查看数值" onKeyDown={e=>{if(e.key!=='ArrowLeft' && e.key!=='ArrowRight')return;e.preventDefault();const index=points?.findIndex(p=>p.price===hover?.price) ?? -1;const next=Math.max(0,Math.min((points?.length ?? 1)-1,(index<0 ? Math.floor((points?.length ?? 1)/2) : index)+(e.key==='ArrowLeft' ? -1 : 1)));setHoverPrice(points?.[next]?.price ?? null);}} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setHoverPrice(geometry.min + Math.max(0, Math.min(1, ((e.clientX - rect.left) / rect.width * 420 - 52) / 336)) * (geometry.max - geometry.min)); }} onPointerLeave={() => setHoverPrice(null)}>
          <title>QQQ Gamma Model：青线为当前持仓情景，灰线为剔除最近到期持仓</title>
          {[0, 1, 2, 3, 4].map(i => { const v = geometry.bottom + (geometry.top - geometry.bottom) * i / 4; return <g key={i}><line x1="52" x2="388" y1={geometry.y(v)} y2={geometry.y(v)} stroke="var(--border-subtle)" strokeDasharray="3 5" /><text x="47" y={geometry.y(v) + 3} textAnchor="end">{money(v)}</text><text x={52 + i * 84} y="294" textAnchor="middle">{(geometry.min + (geometry.max - geometry.min) * i / 4).toFixed(0)}</text></g>; })}
          <line x1="52" x2="388" y1={geometry.y(0)} y2={geometry.y(0)} stroke="var(--text-tertiary)" />
          {model.sensitivity && ([['零交点',model.sensitivity.zeroGamma,'#b7a5ef'],['缓冲下沿',model.sensitivity.volatilityTrigger,'#a5d66f']] as const).map(([label,range,color])=>range.low!==null&&range.high!==null&&range.high>=geometry.min&&range.low<=geometry.max?<rect key={label} x={geometry.x(Math.max(geometry.min,range.low))} width={Math.max(1,geometry.x(Math.min(geometry.max,range.high))-geometry.x(Math.max(geometry.min,range.low)))} y="28" height="248" fill={color} opacity=".13"><title>{`${label}敏感区间 ${range.low.toFixed(2)}–${range.high.toFixed(2)}；IV ±5% 或时间推进 60 秒${range.missingScenarios?'；部分情景下价位消失':''}。不是预测区间。`}</title></rect>:null)}
          {levels.filter(l => l.value !== null && l.value >= geometry.min && l.value <= geometry.max).map(l => <line key={l.label} x1={geometry.x(l.value!)} x2={geometry.x(l.value!)} y1="28" y2="276" stroke={l.color} strokeDasharray={l.label === '参考现价' ? '3 3' : undefined} opacity=".7"><title>{l.label}: {price(l.value)}</title></line>)}
          {showRemaining && model.expiries.length > 1 && <path d={geometry.path(true)} stroke="#a1a1aa" strokeWidth="1.5" fill="none" />}
          <path d={geometry.path(false)} stroke="#45d6c5" strokeWidth="2" fill="none" />
          {hover && <g><line x1={geometry.x(hover.price)} x2={geometry.x(hover.price)} y1="28" y2="276" stroke="var(--text-primary)" strokeDasharray="2 3" /><circle cx={geometry.x(hover.price)} cy={geometry.y(hover.gamma)} r="3" fill="#45d6c5" /></g>}
          <text x="220" y="314" textAnchor="middle">QQQ 价格情景</text>
        </svg>
        <section className={styles.positionObservation} aria-label="参考价相对 Gamma 零交点与 VT 下沿的位置">
          <div className={styles.positionTitle}><span>{historical ? '回放价格位置' : presentation.stale ? '快照价格位置' : '模型价格位置'}</span><span title={presentation.context}>低价 ← → 高价</span></div>
          {presentation.stale && <div className={styles.positionHint}>模型参考时间 {etTime(model.asOf)} ET</div>}
          <div className={styles.positionTrack} role="img" aria-label={positionLevels.map(level=>`${level.label} ${price(level.value)}`).join('，')}>
            {model?.volatilityTrigger.price !== null && model?.volatilityTrigger.price !== undefined && <span className={styles.positionBuffer} style={{left:`${positionX(model.volatilityTrigger.price)}%`}} title="VT 下沿以上的模型缓冲区域；不是预测震荡区间" />}
            {positionLevels.filter(level=>level.value!==null && Number.isFinite(level.value) && level.value>0).map(level=><i key={level.label} style={{left:`${positionX(level.value!)}%`,background:level.color}} title={`${level.label} ${price(level.value)}`} />)}
          </div>
          <div className={styles.positionLegend}>{positionLevels.map(level=><div key={level.label}><span><i style={{background:level.color}} />{level.label}</span><b>{price(level.value)}</b></div>)}</div>
          {model && <div className={styles.positionHint}>{model.volatilityTrigger.price !== null ? (model.spot >= model.volatilityTrigger.price ? '参考价在 VT 下沿上方' : '参考价尚未站上 VT 下沿') : 'VT 下沿暂不可用'}</div>}
          <QqqInfoTooltip label="模型位置观察说明" content={<><p>{presentation.detail}</p>{presentation.nextStep&&<p>{presentation.nextStep}</p>}<p>位置描述模型结构，不代表涨跌方向或买卖信号。</p></>}/>
          {!partial && presentation.canCheckEntry && <Link href="/analysis/qqq#entry-check">开仓检查 →</Link>}
        </section>
        {hover && <div className={styles.readout}>{hover ? `${price(hover.price)} → ${money(hover.gamma)}${showRemaining && hover.exNearest !== null ? ` · 剔除后 ${money(hover.exNearest)}` : ''}` : null}</div>}
        <div className={styles.legend}><span title="根据期权持仓量 OI 与隐含波动率估算，并非真实做市商仓位">持仓模型</span>{model.sensitivity && <span title="IV 上下浮动 5% 或时间推进 60 秒得到的价位范围；不是支撑阻力或预测区间">淡色带：参数敏感范围</span>}{model.expiries.length > 1 && <label><input type="checkbox" checked={showRemaining} onChange={e => setShowRemaining(e.target.checked)} />剔除最近到期</label>}</div>
      </div>}
      {!lockedScope && <select aria-label="Gamma 模型范围" value={scope} onChange={e=>{setScope(e.target.value as typeof scope);setHoverPrice(null);}}><option value="selected">当前到期日</option><option value="available">可用到期日合计</option></select>}
      {nearby.length > 0 && <section className={styles.nearby} aria-label={`附近 Gamma 关键位，参考价 ${price(model!.spot)}`}>
        <div className={styles.nearbyTitle}><strong>附近关键位</strong><span>现价 {price(model!.spot)}</span></div>
        {nearby.map(l=>{const pct=(l.value/model!.spot-1)*100;const target=Math.min(46,Math.abs(pct)/maxNearbyDistance*46);const color=levels.find(level=>level.value===l.value)?.color ?? '#a1a1aa';return <div className={styles.levelRow} key={l.value}>
          <div className={styles.levelHeading}><span><i style={{backgroundColor:color}} />{l.labels.join(' / ')}</span><strong>{price(l.value)}</strong><small className={pct<0?styles.below:styles.above}>{pct>0?'↑':pct<0?'↓':'•'} {Math.abs(pct).toFixed(2)}%</small></div>
          <div className={styles.ruler} aria-hidden="true"><i />{pct!==0&&<span className={pct<0?styles.rulerBelow:styles.rulerAbove} style={{left:pct<0?`${50-target}%`:'50%',width:`${target}%`,backgroundColor:color}}/>}<b style={{left:`${50+(pct<0?-target:target)}%`,backgroundColor:color}}/></div>
        </div>})}
      </section>}
      {levels.length>0&&<details className={styles.allLevels}><summary>全部模型价位</summary><div className={styles.levels}>{levels.map(l => <div key={l.label} title={l.detail}><span style={{ color: l.color }}>{l.label}</span><strong>{price(l.value)}{l.value!==null && model && model.spot>0 && l.label!=='参考现价' && <small>{((l.value/model.spot-1)*100)>=0 ? '+' : ''}{((l.value/model.spot-1)*100).toFixed(2)}%</small>}</strong></div>)}</div></details>}
      {model && <p className={styles.note} title={`纳入：${model.expiries.join('、') || '无'}；未纳入：${model.excluded.join('、') || '无'}`}>{model.expiries.length} 个到期日{model.excluded.length > 0 ? `可用，${model.excluded.length} 个未纳入` : '可用'}{model.nearestExpiry ? ` · 最近 ${model.nearestExpiry}` : ''}</p>}
    </div>
  </section>;
}
