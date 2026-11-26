/** Last-bar correction/append can use update(); older correction/prepend resets. */
export function qqqChartSeriesUpdate(previous: readonly unknown[] | undefined,next: readonly unknown[],liveTailTime?:number|null) {
 if (!previous?.length || next.length<previous.length) return {reset:true,points:next};
 const last=previous.length-1;
 for(let i=0;i<last;i++) if(JSON.stringify(previous[i])!==JSON.stringify(next[i]))return {reset:true,points:next};
 const time=(point:unknown)=>(point as {time?:unknown})?.time;
 if(time(previous[last])!==time(next[last]))return {reset:true,points:next};
 const points=next.slice(JSON.stringify(previous[last])===JSON.stringify(next[last])?previous.length:last);
 // A live tick may have already inserted a newer candle into the chart.
 // update() cannot modify older timestamps; retain the safe full-sync path.
 if(liveTailTime!=null && points.some(point=>Number(time(point))<liveTailTime))return {reset:true,points:next};
 return {reset:false,points};
}
