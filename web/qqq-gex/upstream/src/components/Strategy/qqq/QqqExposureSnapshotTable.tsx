'use client';

import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualTableViewport } from '@/hooks/useVirtualTableViewport';
import { matrixRowWindow } from './qqqExposureRenderModel';
import { formatQqqMatrixGex } from './qqqGexMatrixModel';
import type { exposureReplayTableRows } from '@/lib/qqqExposureReplay';
import { exposureReplayDisplayDeltaDetails } from '@/lib/qqqExposureReplay';

type Row = ReturnType<typeof exposureReplayTableRows>[number];
const et=new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const price=(value:number|null)=>value===null?'—':value.toFixed(2);

export default function QqqExposureSnapshotTable({rows,index,target,followingLatest}:{rows:readonly Row[];index:number;target:HTMLElement|null;followingLatest:boolean}) {
  const scroller=useRef<HTMLDivElement>(null);
  const visible=useMemo(()=>rows.slice(0,index+1).reverse(),[rows,index]);
  const viewport = useVirtualTableViewport(scroller, { initialHeight: 160, revision: target });
  // Keep the observer/listener for the archive's lifetime. A new cursor only
  // resets an actually scrolled table, instead of reconnecting and measuring it.
  useEffect(()=>{if(scroller.current&&viewport.top>0)scroller.current.scrollTop=0;},[index,target]);
  const windowRows=matrixRowWindow(visible.length,viewport.top,viewport.height);
  if(!target)return null;
  const cell={padding:'5px 10px',whiteSpace:'nowrap' as const,textAlign:'right' as const,borderBottom:'1px solid var(--border-subtle)'};
  return createPortal(<section aria-label="回放 GEX 快照表" style={{display:'flex',flex:1,minHeight:0,minWidth:0,flexDirection:'column',fontFamily:'var(--font-mono)',fontSize:'.65rem'}}>
    <div ref={scroller} style={{overflow:'auto',flex:1,minHeight:0}}>
      <table style={{borderCollapse:'collapse',width:'100%'}}><thead style={{position:'sticky',top:0,zIndex:1,background:'var(--bg-card)'}}><tr>{['时间 ET','参考价','净 GEX','ΔGEX','看涨集中位','看跌集中位','覆盖 / 单位'].map(label=><th key={label} style={cell}>{label}</th>)}</tr></thead><tbody>
        {windowRows.before>0&&<tr aria-hidden="true"><td colSpan={7} style={{height:windowRows.before,padding:0}}/></tr>}
        {visible.slice(windowRows.start,windowRows.end).map((row,i)=>{
          const previous=visible[windowRows.start+i+1];
          const comparison=exposureReplayDisplayDeltaDetails(row,previous);
          const delta=comparison.value;
          const shown=row.displayNet;
          return <tr key={row.time} style={{height:32,background:windowRows.start+i===0?'var(--bg-hover)':undefined}}><td style={cell}>{et.format(row.time)}</td><td style={cell}>{price(row.spot)}</td><td style={{...cell,color:shown===null?'var(--text-tertiary)':shown>=0?'#60a5fa':'#fb923c'}} title={row.partial?'仅合计输入有效的行权价，非完整链净 GEX':undefined}>{shown===null?'—':<>{formatQqqMatrixGex(shown)}{row.partial?'（部分）':''}</>}</td><td style={cell} title={comparison.reason??`相邻快照共同有效的 ${comparison.comparedStrikes} 个行权价的 GEX 变化；新增或缺失覆盖不计入变化`}>{delta===null?'—':<>{formatQqqMatrixGex(delta)}{comparison.commonCoverage?`（共同 ${comparison.comparedStrikes}）`:row.partial?'（部分）':''}</>}</td><td style={cell}>{price(row.displayCall)}{row.partial&&row.displayCall!==null?'*':''}</td><td style={cell}>{price(row.displayPut)}{row.partial&&row.displayPut!==null?'*':''}</td><td style={cell} title={`${row.quality??''} * 集中位仅在输入有效的行权价中比较。纳入 ${row.expiries.join('、')||'无'}；缺少 ${row.missing.join('、')||'无'}`}>{row.partial?`部分数据 ${row.validStrikes}/${row.totalStrikes} 行权价 · `:row.quality?'输入不完整 · ':''}{row.expiries.length} 个到期日{row.missing.length?` · 缺 ${row.missing.length}`:''} · {row.unit==='per-1pct'?'/1%':row.unit==='per-point'?'/点':'旧口径'}</td></tr>;
        })}
        {windowRows.after>0&&<tr aria-hidden="true"><td colSpan={7} style={{height:windowRows.after,padding:0}}/></tr>}
      </tbody></table>
      {!visible.length&&<p role="status" style={{padding:10}}>当前时刻没有有效快照。</p>}
    </div>
  </section>,target);
}
