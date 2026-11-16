'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { findExposureTile, type ExposureTile } from './qqqExposureRenderModel';
import { moveHeatmapSelection } from './qqqHeatmapInteraction';
import { createQqqLayoutFrame } from './terminal/qqqLayoutFrame';
import type { DayScenarioField } from '@/lib/qqqDayScenario';
import { dayScenarioCellAt, dayScenarioTile, moveDayScenarioCell } from './qqqDayScenarioRenderModel';
import { heatmapCellInputStatus } from '@/lib/qqqHeatmapPresentation';
import type { ExposureFrame, ExposureMode } from '@/lib/qqqExposureWorkbench';

const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Pointer updates stay in this small subtree, away from chart/series preparation. */
export default memo(function QqqHeatmapInspector({ tiles, rowHeight, width, height, plot, label, priceAxis=false, scenario, frames=[], mode='gamma' }: {
  tiles: readonly ExposureTile[]; rowHeight: number; width: number; height: number;
  plot: { left: number; top: number; width: number; height: number }; label: string; priceAxis?:boolean;
  scenario?:{field:DayScenarioField;low:number;high:number};
  frames?:readonly ExposureFrame[]; mode?:ExposureMode;
}) {
  const [selected, setSelected] = useState<ExposureTile | null>(null);
  const [scenarioSelection,setScenarioSelection]=useState<{field:DayScenarioField;column:number;row:number}|null>(null);
  const [frame] = useState(() => createQqqLayoutFrame());
  const keyboard = useRef(false);
  // A mode, range or replay change must not leave the old value on screen.
  const current = scenario?scenarioSelection?.field===scenario.field?dayScenarioTile(scenario.field,scenarioSelection.column,scenarioSelection.row,scenario.low,scenario.high,plot):null:selected && tiles.includes(selected) ? selected : null;
  const inputStatus=current?.value===null&&!scenario?heatmapCellInputStatus(frames.find(f=>f.time===current.time),current.strike,mode):null;
  useEffect(() => () => frame.cancel(), [frame]);
  const clear = () => { frame.cancel(); setSelected(null);setScenarioSelection(null); };
  return <g data-heatmap-inspector>
    <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} fill="transparent"
      tabIndex={0} role="group" aria-label={`热力图数值检查：方向键查看时间和${priceAxis?'情景价格':'行权价'}，Home / End 到首末${priceAxis?'估值时刻':'快照'}，Escape 退出`}
      onFocus={() => { keyboard.current = true;
        if(scenario){const cell=dayScenarioCellAt(scenario.field,scenario.field.times.at(-1)??NaN,(scenario.low+scenario.high)/2);setScenarioSelection(cell?{field:scenario.field,...cell}:null);}
        else setSelected(tiles.at(-1) ?? null);
      }}
      onBlur={clear} onPointerLeave={() => { if (!keyboard.current) clear(); }}
      onPointerMove={event => {
        keyboard.current = false;
        const svg = event.currentTarget.ownerSVGElement;
        const clientX = event.clientX, clientY = event.clientY;
        frame.schedule(() => {
          const bounds = svg?.getBoundingClientRect();
          if (!bounds?.width || !bounds.height) return;
          const x=(clientX-bounds.left)*width/bounds.width,y=(clientY-bounds.top)*height/bounds.height;
          if(scenario){const time=scenario.field.start+(x-plot.left)/plot.width*(scenario.field.end-scenario.field.start),price=scenario.high-(y-plot.top)/plot.height*(scenario.high-scenario.low);
            const cell=dayScenarioCellAt(scenario.field,time,price);setScenarioSelection(cell?{field:scenario.field,...cell}:null);
          }else setSelected(findExposureTile(tiles,x,y,rowHeight));
        });
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') { clear(); event.currentTarget.blur(); return; }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); frame.cancel(); keyboard.current = true;
        if(scenario){
          const cell=scenarioSelection?.field===scenario.field?scenarioSelection:dayScenarioCellAt(scenario.field,scenario.field.times.at(-1)??NaN,(scenario.low+scenario.high)/2);
          setScenarioSelection(cell?{field:scenario.field,...moveDayScenarioCell(scenario.field,cell,event.key)}:null);
        }else setSelected(moveHeatmapSelection(tiles, current, event.key));
      }} />
    {current && <g pointerEvents="none">
      <rect x={current.left} y={current.top} width={current.width} height={current.height??rowHeight} fill="none" stroke="#f8fafc" strokeWidth="1" />
      <foreignObject x={plot.left + 4} y={plot.top + 4} width={Math.max(1, Math.min(460, plot.width - 8))} height={inputStatus?116:82}>
        <div role="status" aria-live={keyboard.current ? 'polite' : 'off'} style={{ background: '#111827f2', color: '#f8fafc', padding: '5px 7px', border: '1px solid #64748b', borderRadius: 4, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>
          {clock.format(current.time)} ET · {priceAxis?'情景价格 ':''}{Number(current.strike.toFixed(3))} · {label}<br />
          {current.value === null ? '未知：输入无效或没有该档记录，不按零计算' : `${scenario?'情景估值':'原始值'} $${String(current.value)}`}
          {inputStatus&&<div>{inputStatus}</div>}
          <div style={{color:'#9ca3af',fontSize:10}}>{scenario?(scenario.field.coverage.partial?'有效合约贡献，缺失贡献未知':'固定 OI / IV 的假设估值'):'快照时间不等于期权报价时间'}</div>
        </div>
      </foreignObject>
    </g>}
  </g>;
});
