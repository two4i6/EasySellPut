import { readQqqGammaPositionHistory } from './qqqGammaPositionHistory';
import {supabaseAdmin} from './supabase';
import {normalizeQqqIntradayBacktestBars} from './qqqIntradayBacktestHistory';
import { buildQqqGammaModel } from './qqqGammaModel';
import { qqqDirectionalGexTime } from './qqqDirectionalGexTime';
import {readQqqChartWindowRevision,readQqqChartWindowManifest,isChartSourceRolloutMissing} from './qqqChartSource';
import {createRevisionedJsonCache} from './revisionedJsonCache';

type Row = Record<string, any>;
function isDaySource(value:unknown):value is Row{
 if(!value||typeof value!=='object')return false;const day=value as Row;
 const snapshots=(rows:unknown)=>Array.isArray(rows)&&rows.every(row=>!!row&&typeof row==='object'&&Number.isFinite(Date.parse(row.captured_at))&&typeof row.expiry_date==='string'&&(row.profile==null||Array.isArray(row.profile)));
 return snapshots(day.items)&&snapshots(day.expiries)&&Array.isArray(day.bars)&&day.bars.every((bar:Row)=>!!bar&&typeof bar==='object'&&Number.isFinite(Date.parse(bar.bar_at)))&&(day.latestProfile==null||Array.isArray(day.latestProfile));
}
const daySourceCache=createRevisionedJsonCache<Row>('qqq-day-source-v1',isDaySource);
const latestProfilesCache=createRevisionedJsonCache<Row[]>('qqq-latest-full-profiles-v1',(value):value is Row[]=>Array.isArray(value)&&value.every(row=>!!row&&typeof row.captured_at==='string'&&typeof row.expiry_date==='string'&&Array.isArray(row.profile)));

async function readLatestProfiles(input:{from:string;to:string},capturedAt:string,revision?:string){
 const load=async()=>{
  const result=await supabaseAdmin.from('qqq_gex_expiry_snapshot').select('captured_at,expiry_date,profile')
   .eq('symbol','QQQ').eq('policy_id','qqq-pcs-intraday-v1').eq('captured_at',capturedAt).limit(32)
   .setHeader('cache-control','no-cache').abortSignal(AbortSignal.timeout(4000));
  if(result.error)throw Error('Latest full profiles unavailable');return (result.data??[]) as Row[];
 };
 try{
  const manifest=await readQqqChartWindowManifest(input.from,input.to);
  if(revision&&'scoped:'+manifest.revision!==revision)throw Error('Latest profile source changed during read');
  const keys=manifest.items.filter(row=>Date.parse(row.captured_at)===Date.parse(capturedAt));
  if(keys.length>32)throw Error('Latest profile scope exceeds budget');
  const matches=(rows:Row[])=>rows.length===keys.length&&new Set(rows.map(row=>row.expiry_date)).size===keys.length&&rows.every(row=>Date.parse(row.captured_at)===Date.parse(capturedAt)&&keys.some(key=>key.expiry_date===row.expiry_date));
  return await latestProfilesCache({keys},async()=>{
   const rows=keys.length?await load():[];
   const after=await readQqqChartWindowManifest(input.from,input.to,true);
   const closing=after.items.filter(row=>Date.parse(row.captured_at)===Date.parse(capturedAt));
   if(revision&&'scoped:'+after.revision!==revision||JSON.stringify(keys)!==JSON.stringify(closing)||!matches(rows))throw Error('Latest profile source changed during read');
   return rows;
  },matches);
 }catch(error){if(!isChartSourceRolloutMissing(error))throw error;return load();}
}
export function decodeQqqGexDisplayDay(value: any,range:{from:string;to:string}) {
  const snapshot = (row: Row) => ({capturedAt:row.captured_at,expiryDate:row.expiry_date,dte:row.dte,spot:row.spot,
    netGex:row.net_gex,gammaFlip:row.gamma_flip,callWallPrice:row.call_wall_price,callWallMagnitude:row.call_wall_magnitude,
    putWallPrice:row.put_wall_price,putWallMagnitude:row.put_wall_magnitude,kingStrike:row.king_strike,kingMagnitude:row.king_magnitude,
    kingSide:row.king_side,profile:row.profile ?? []});
  const items = (value.items as Row[]).map(row=>({...snapshot(row),strikeCoverage:'top8' as 'full'|'top8'}));
  if (items.length && Array.isArray(value.latestProfile)) items[items.length-1] = {...items.at(-1)!,profile:value.latestProfile,strikeCoverage:'full'};
  return {selectedExpiry:value.selectedExpiry,items,expiries:(value.expiries as Row[]).map(snapshot),
    bars:normalizeQqqIntradayBacktestBars(value.bars,range).bars};
}
export async function readQqqGexDisplayDay(input:{from:string;to:string;expiryDate:string|null},onTiming?:(stage:string,milliseconds:number)=>void,revision?:string) {
  const measured=async<T>(stage:string,read:()=>PromiseLike<T>)=>{const start=performance.now();try{return await read();}finally{onTiming?.(stage,performance.now()-start);}};
  const load=async()=>{
   const result=await measured('day_db',()=>supabaseAdmin.rpc('qqq_gex_display_day',{p_policy_id:'qqq-pcs-intraday-v1',p_from:input.from,p_to:input.to,p_expiry_date:input.expiryDate})
    .setHeader('cache-control','no-cache').abortSignal(AbortSignal.timeout(15000)));
   if(result.error||!result.data)throw Error('历史 GEX 展示读取不可用');return result.data as Row;
  };
  let value:Row;
  try{
   revision??=await readQqqChartWindowRevision(input.from,input.to,null);
   const expected=revision;
   value=await daySourceCache({input,revision},async()=>{
    const result=await load();
    if(await readQqqChartWindowRevision(input.from,input.to,null,true)!==expected)throw Error('Day source changed during read');
    return result;
   });
  }catch(error){if(!isChartSourceRolloutMissing(error))throw error;value=await load();}
  const base = decodeQqqGexDisplayDay(value,input);
  const gammaTask=base.selectedExpiry ? measured('gamma_history',()=>readQqqGammaPositionHistory({ ...input, expiryDate: base.selectedExpiry, policyId: 'qqq-pcs-intraday-v1',revision })) : Promise.resolve([]);
  const latest = base.items.at(-1);
  // Read only the final bucket's model fields; do not inflate every chart-history profile.
  if (!latest) return {...base,gammaPositionHistory:await gammaTask};
  const profilesTask = measured('latest_profiles',()=>readLatestProfiles(input,latest.capturedAt,revision)
    .then(data=>({data,error:false}),error=>{if(error instanceof Error&&error.message==='Latest full profiles unavailable')return {data:null,error:true};throw error;}));
  const [gammaPositionHistory,profiles]=await Promise.all([gammaTask,profilesTask]);
  const decoded={...base,gammaPositionHistory};
  if (profiles.error) return decoded;
  const expiries = ((profiles.data ?? []) as Row[]).map(row => ({asOf:row.captured_at,expiryDate:row.expiry_date,fullGexProfile:row.profile ?? []}));
  const profileByCapture = new Map(expiries.map(expiry => [`${expiry.expiryDate}:${Date.parse(expiry.asOf)}`, expiry.fullGexProfile]));
  const matrixDecoded = { ...decoded, expiries: decoded.expiries.map(expiry => ({ ...expiry, profile: profileByCapture.get(`${expiry.expiryDate}:${Date.parse(expiry.capturedAt)}`) ?? expiry.profile })) };
  const valuationTime = Math.max(Date.parse(latest.capturedAt), ...expiries.map(e => Date.parse(qqqDirectionalGexTime(e.asOf,null,e.fullGexProfile))));
  if (!Number.isFinite(valuationTime) || valuationTime >= Date.parse(input.to)) return matrixDecoded;
  const modelAsOf = new Date(valuationTime).toISOString();
  return {...matrixDecoded,gammaModels:{
    selected:buildQqqGammaModel(expiries.filter(e=>e.expiryDate===decoded.selectedExpiry),latest.spot,modelAsOf),
    available:buildQqqGammaModel(expiries,latest.spot,modelAsOf),
  }};
}
