import {certifyDay} from 'source:qqq-day-coverage';
import {qqqStoredGexTiming} from '../upstream/src/lib/qqqDirectionalGexTime';
export function replayDay(date:string,value:any,start=-Infinity,end=Infinity){
 const day={date,complete:false,bars:value.bars.filter((b:any)=>Date.parse(b.timestamp)>=start&&Date.parse(b.timestamp)<end),expiries:value.expiries.map((e:any)=>({expiryDate:e.expiryDate,dte:e.dte,snapshots:value.rows.filter((r:any)=>r.expiryDate===e.expiryDate&&Date.parse(r.capturedAt)>=start&&Date.parse(r.capturedAt)<end).map((r:any)=>({...qqqStoredGexTiming({captured_at:r.capturedAt,source_as_of:r.sourceAsOf,calculation_version:r.calculationVersion,input_complete:r.inputComplete,profile:r.profile}),netGex:r.netGex,gammaFlip:r.gammaFlip,callWallPrice:r.callWallPrice,putWallPrice:r.putWallPrice}))}))};
 day.complete=certifyDay(day);return day;
}
