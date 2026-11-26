import {projectQqqGexDisplayPayload} from 'source:qqq-pcs';
import {buildHistoricalGexExpiries,historicalGexDisplayPayload} from '../upstream/src/lib/qqqGexDisplayState';
/** Rebuild the original display envelope from one lossless retained copy. Accepts v1 and v2 days. */
export function displayLocalDay(day:any,date:string,expiry:string|null){
 const order=new Map((day.expiries??[]).map((value:any,index:number)=>[value.expiryDate,index]));const expiries=buildHistoricalGexExpiries(day.rows).sort((a,b)=>Number(order.get(a.expiryDate)??0)-Number(order.get(b.expiryDate)??0));
 for(const item of expiries)(item as any).research=day.expiries?.find((value:any)=>value.expiryDate===item.expiryDate)?.research??null;
 const value=historicalGexDisplayPayload(null,date,expiries,day.bars,expiry);
 value.dataIssues.push(...(day.issues??[]));return projectQqqGexDisplayPayload(value,expiry,day.bars);
}
