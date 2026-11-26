import {decodeQqqChartProfile,QQQ_CHART_PROFILE_FIELDS} from './qqqChartProfileTransport';
import type {SourceRow,CandleRow} from './qqqVersionedHistoryStore';
/** Flat RPC output has the same field/order contract as the independent readers. */
export function decodeQqqChartCombined(value:unknown):{profiles:SourceRow[];candles:CandleRow[]}{
 if(!Array.isArray(value)||value.length>256)throw Error('Invalid combined chart rows');
 const profiles:SourceRow[]=[],candles:CandleRow[]=[];
 for(const row of value){
  if(row.kind==='profile')profiles.push({captured_at:row.captured_at,expiry_date:row.expiry_date,dte:row.dte,spot:row.spot,version:row.version,profile:decodeQqqChartProfile(row.packed_profile,QQQ_CHART_PROFILE_FIELDS)});
  else if(row.kind==='candle')candles.push({bar_at:row.bar_at,open:row.open,high:row.high,low:row.low,close:row.close,volume:row.volume,version:row.version});
  else throw Error('Unknown combined chart row kind');
 }
 return {profiles,candles};
}
