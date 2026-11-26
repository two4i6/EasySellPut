import type {ExposureFrame,ExposureMode} from './qqqExposureWorkbench';
import {qqqIvUsable} from './qqqIvQuality';

export type HeatmapContrast='absolute'|'enhanced';
export function parseHeatmapContrast(raw:string|null):HeatmapContrast{
 return raw==='absolute'||raw==='"absolute"'?'absolute':'enhanced';
}
/** Display transform only. Both modes retain the same causal absolute maximum. */
export function heatmapIntensity(value:number,maximum:number,contrast:HeatmapContrast){
 if(!Number.isFinite(value)||!Number.isFinite(maximum)||maximum<=0)return 0;
 const ratio=Math.min(1,Math.abs(value)/maximum);
 return contrast==='enhanced'?Math.log1p(9999*ratio)/Math.log(10000):Math.sqrt(ratio);
}
/** Inverse display transform: the legend always reports actual exposure units. */
export function heatmapLegendValue(strength:number,maximum:number,contrast:HeatmapContrast){
 const sign=Math.sign(strength),ratio=Math.min(1,Math.abs(strength));
 return sign*maximum*(contrast==='enhanced'?Math.expm1(ratio*Math.log(10000))/9999:ratio*ratio);
}
export function heatmapCoverage(frame:ExposureFrame|undefined,strikes:readonly number[],values:ReadonlyMap<number,number|null>|null,side?:'call'|'put'){
 if(!frame||!values)return null;
 const selected=new Set(strikes),missingOi=new Set<number>(),invalidIv=new Set<number>(),unrecordedSide=new Set<number>();
 for(const p of frame.profiles)for(const s of p.strikes){
  if(!selected.has(s.strike))continue;
  const legacy=!(s as typeof s&{calculationVersion?:string}).calculationVersion;
  for(const selectedSide of side?[side]:['call','put'] as const){
   const oi=selectedSide==='call'?s.callOi:s.putOi,iv=selectedSide==='call'?s.callIv:s.putIv;
   if(legacy&&iv===undefined){unrecordedSide.add(s.strike);continue;}
   if(typeof oi!=='number'||!Number.isFinite(oi)||oi<0)missingOi.add(s.strike);
   else if(oi>0&&!qqqIvUsable(iv))invalidIv.add(s.strike);
  }
 }
 const valid=strikes.filter(s=>values.get(s)!=null&&Number.isFinite(values.get(s))).length;
 return {total:strikes.length,valid,unavailable:strikes.length-valid,missingOi:missingOi.size,invalidIv:invalidIv.size,unrecordedSide:unrecordedSide.size,missingExpiries:frame.missing.length};
}
/** Explain missing cells on inspection without adding marks to the heat field. */
export function heatmapCellInputStatus(frame:ExposureFrame|undefined,strike:number,mode:ExposureMode){
 if(!frame?.profiles.length)return '该时点没有可用的到期日快照';
 const sides=mode==='gamma-call'?['call'] as const:mode==='gamma-put'?['put'] as const:['call','put'] as const;
 const statuses=sides.map(side=>{
  const reasons=new Set<string>();
  for(const profile of frame.profiles){
   const point=profile.strikes.find(p=>p.strike===strike);
   if(!point){reasons.add('未返回该行权价');continue;}
   const oi=point[`${side}Oi`],iv=point[`${side}Iv`];
   if(typeof oi!=='number'||!Number.isFinite(oi)||oi<0)reasons.add('持仓量缺失');
   else if(oi>0&&!qqqIvUsable(iv))reasons.add(typeof iv==='number'&&Number.isFinite(iv)&&iv>0?'IV 无效（下限值）':'IV 缺失或无效');
  }
  return `${side==='call'?'Call':'Put'} ${reasons.size?[...reasons].join('、'):'OI / IV 有效'}`;
 });
 if(frame.missing.length)statuses.push(`缺少 ${frame.missing.length} 个到期日`);
 return statuses.join(' · ');
}
/** Metadata is evidence. Never infer legacy units or promote unknown inputs. */
export function heatmapDefinition(frame:ExposureFrame|undefined,source=frame){
 const points=frame?.profiles.flatMap(p=>p.strikes)??[];
 if(!points.length)return {label:'口径待更新',detail:'等待行权价快照。',legacy:false};
 const metadata=points as Array<typeof points[number]&{calculationVersion?:string;gexUnit?:string}>;
 const sourcePoints=source?.profiles.flatMap(p=>p.strikes)??[];
 const legacy=sourcePoints.some(s=>!(s as typeof s&{calculationVersion?:string;gexUnit?:string}).calculationVersion||!(s as typeof s&{gexUnit?:string}).gexUnit);
 const versions=new Set(metadata.map(s=>s.calculationVersion??'未知')),units=new Set(metadata.map(s=>s.gexUnit??'未知'));
 if(versions.size===1&&versions.has('qqq-exposure-gamma-model-v1'))return {label:'统一模型重算 · 每1%变动',detail:`使用已保存 OI / IV、统一价格与真实剩余期限重算。${legacy?'含旧输入：旧采集可能已删除合约，重算无法恢复缺失持仓；不能与旧保存值直接比较。':''}`,legacy};
 if(legacy)return {label:'历史旧口径 · 不可直接比较',detail:'旧记录未保存完整计算版本或单位。早期采集可能过滤低 IV 合约并将缺失一侧写为零，也曾使用至少一天的剩余期限；旧图的密度不代表完整输入。保留原始保存值。',legacy:true};
 const known=[...versions].every(v=>v==='qqq-gex-full-1pct-v3'||v==='qqq-gex-full-1pct-usable-iv-v4');
 if(known&&units.size===1&&units.has('per-1pct'))return {label:'实际剩余期限 · 每1%变动',detail:`使用真实到期时间，r=q=0，Call 正 / Put 负持仓假设。计算版本：${[...versions].join('、')}。输入不合格留空；不代表真实做市商账本。`,legacy:false};
 return {label:'混合或未识别口径 · 不可直接比较',detail:`保存版本：${[...versions].join('、')}；单位：${[...units].join('、')}。不推断兼容性，不改写原始值。`,legacy:false};
}
