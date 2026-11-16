'use client';

import { memo, useEffect, useRef, useState } from 'react';

/** The thumb responds locally. Expensive linked panels receive at most one
 * update per animation frame, and releasing the pointer commits the final value. */
export default memo(function QqqReplaySlider({value,max,resetKey,onChange,formatValue}:{value:number;max:number;resetKey:string;onChange:(value:number)=>void;formatValue?:(value:number)=>string}) {
  const [draft,setDraft]=useState(value);
  const pending=useRef<number|null>(null),task=useRef<number|null>(null);
  const callback=useRef(onChange);
  callback.current=onChange;
  const flush=()=>{
    if(task.current!==null)cancelAnimationFrame(task.current);
    task.current=null;
    const next=pending.current;pending.current=null;
    if(next!==null)callback.current(next);
  };
  useEffect(()=>{if(pending.current===null)setDraft(value);},[value]);
  useEffect(()=>{
    pending.current=null;setDraft(value);
    return()=>{if(task.current!==null)cancelAnimationFrame(task.current);task.current=null;pending.current=null;};
    // A different date/scope discards any queued input from the old archive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resetKey]);
  return <input aria-label="统一回放时间" aria-valuetext={formatValue?.(Math.min(max,draft))} disabled={max===0} type="range" min="0" max={max} value={Math.min(max,draft)} onChange={event=>{
    const next=Number(event.target.value);setDraft(next);pending.current=next;
    if(task.current===null)task.current=requestAnimationFrame(flush);
  }} onPointerUp={flush} onPointerCancel={flush} onBlur={flush}/>;
});
