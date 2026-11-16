import type { DayScenarioField } from '@/lib/qqqDayScenario';
import type { ExposureTile } from './qqqExposureRenderModel';

type Plot={left:number;top:number;width:number;height:number};
export function dayScenarioPriceBounds(field:DayScenarioField,row:number){
  const price=field.prices[row]!;
  return {lower:row>0?(field.prices[row-1]!+price)/2:price-.125,upper:row<field.prices.length-1?(field.prices[row+1]!+price)/2:price+.125};
}
export function dayScenarioTile(field:DayScenarioField,column:number,row:number,low:number,high:number,plot:Plot):ExposureTile {
  const time=field.times[column]!,next=field.times[column+1]??field.end,{lower,upper}=dayScenarioPriceBounds(field,row);
  const value=field.values[column*field.prices.length+row]!;
  return {time,strike:field.prices[row]!,value:Number.isFinite(value)?value:null,
    left:plot.left+(time-field.start)/(field.end-field.start)*plot.width,width:(next-time)/(field.end-field.start)*plot.width,
    top:plot.top+(high-upper)/(high-low)*plot.height,height:(upper-lower)/(high-low)*plot.height};
}
/** Virtual cell lookup avoids creating/passing tens of thousands of React props on wheel. */
export function dayScenarioCellAt(field:DayScenarioField,time:number,price:number){
  if(field.reason||!field.prices.length||time<field.start||time>=field.end)return null;
  let lo=0,hi=field.times.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(field.times[mid]!<=time)lo=mid+1;else hi=mid;}
  const column=lo-1;
  lo=0;hi=field.prices.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(dayScenarioPriceBounds(field,mid).upper<=price)lo=mid+1;else hi=mid;}
  if(column<0||lo>=field.prices.length||price<dayScenarioPriceBounds(field,lo).lower)return null;
  return {column,row:lo};
}

export function moveDayScenarioCell(field:DayScenarioField,cell:{column:number;row:number},key:string){
  return {column:Math.max(0,Math.min(field.times.length-1,key==='Home'?0:key==='End'?field.times.length-1:cell.column+(key==='ArrowLeft'?-1:key==='ArrowRight'?1:0))),
    row:Math.max(0,Math.min(field.prices.length-1,cell.row+(key==='ArrowUp'?1:key==='ArrowDown'?-1:0)))};
}

/** Geometry only: wheel/quotes never invoke the model, and hover uses exact cells. */
export function dayScenarioTiles(field:DayScenarioField|null,low:number,high:number,plot:{left:number;top:number;width:number;height:number}):ExposureTile[] {
  if(!field||field.reason||!(high>low)||!(field.end>field.start))return [];
  const rows=field.prices.flatMap((price,index)=>{
    const lower=index>0?(field.prices[index-1]!+price)/2:price-.125;
    const upper=index<field.prices.length-1?(field.prices[index+1]!+price)/2:price+.125;
    return upper>=low&&lower<=high?[{price,index,lower,upper}]:[];
  });
  return field.times.flatMap((time,column)=>{
    const next=field.times[column+1]??field.end;
    const left=plot.left+(time-field.start)/(field.end-field.start)*plot.width;
    const width=(next-time)/(field.end-field.start)*plot.width;
    return rows.map(row=>{
      const value=field.values[column*field.prices.length+row.index]!;
      return {time,strike:row.price,value:Number.isFinite(value)?value:null,left,width,
        top:plot.top+(high-row.upper)/(high-low)*plot.height,height:(row.upper-row.lower)/(high-low)*plot.height};
    });
  });
}
