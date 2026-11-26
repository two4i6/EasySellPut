import { QQQ_GAMMA_INPUT_VERSION, prepareQqqGammaInventory, prepareQqqGammaContract, qqqGammaExpiryTime, qqqGammaContractAt, qqqGammaContractExposure, type GammaModelExpiry, type QqqPreparedGammaContract } from './qqqGammaModel';
import { qqqIvUsable } from './qqqIvQuality';
import { qqqLosslessGexDefinitionSupported } from './qqqGexInputQuality';
import { qqqEasternDateKey, qqqEasternMidnightUtc } from './qqqMarketDate';
import { QQQ_MARKET_CALENDAR_VERSION, qqqSessionForDate } from './qqqMarketSession';
import type { ExposureFrame } from './qqqExposureWorkbench';

export const QQQ_DAY_SCENARIO_VERSION = 'qqq-day-gamma-fixed-inventory-v2';
export type DayScenarioMode = 'gamma' | 'gamma-call' | 'gamma-put';
export type DayScenarioPolicy = 'complete' | 'partial';
export type DayScenarioCoverage = { policy:DayScenarioPolicy; partial:boolean; totalSides:number; validSides:number; missingSides:number; missingOi:number; missingIv:number; invalidTime:number; invalidInput:number; expiredSides:number; totalStrikes:number; completeStrikes:number; missingExpiries:number; unverifiedScope:boolean };
export type DayScenarioInput = { date: string; observationAt: number; spot: number; expiries: readonly GammaModelExpiry[]; missing: readonly string[] };
export type DayScenarioField = {
  version: string; observationAt: number; sourceAsOf: string | null; start: number; end: number;
  prices: number[]; times: number[]; values: Float64Array; maximum: number;
  included: string[]; excluded: string[]; reason: string | null; mode: DayScenarioMode; coverage:DayScenarioCoverage;
};

export function dayScenarioSessionBounds(date:string) {
  const midnight=qqqEasternMidnightUtc(date).getTime(),session=qqqSessionForDate(date);
  return {start:midnight+session.openMinute*60_000,end:midnight+session.optionCloseMinute*60_000,trading:session.trading};
}

/** Only the selected causal raw frame; never transport or recompute the archive. */
export function dayScenarioInput(frame: ExposureFrame | undefined, date: string, spot: number | null): DayScenarioInput {
  return { date, observationAt: frame?.time ?? NaN, spot: spot ?? NaN, missing: frame?.missing ?? [],
    expiries: frame?.profiles.map(p => ({ expiryDate: p.expiry, asOf: new Date(p.time ?? frame.time).toISOString(), fullGexProfile: p.strikes })) ?? [] };
}

/** Key includes all effective input bytes, time policy and model, not LIVE price/radius. */
export function dayScenarioKey(input: DayScenarioInput, mode: DayScenarioMode, policy:DayScenarioPolicy='complete') {
  return JSON.stringify([QQQ_DAY_SCENARIO_VERSION, QQQ_GAMMA_INPUT_VERSION, QQQ_MARKET_CALENDAR_VERSION, mode, policy, input.date, input.observationAt, input.spot, input.missing,
    input.expiries.map(e => [e.expiryDate, e.asOf, e.fullGexProfile.map(p => [p.strike,p.callOi,p.putOi,p.callIv,p.putIv,p.callReceivedAt,p.putReceivedAt,p.inputComplete,p.computedAt,p.calculationVersion,p.gexUnit,p.callInputComplete,p.putInputComplete])])]);
}

/** Coverage counts the raw inventory, including known zero OI. Never alter inputs. */
function observedInventory(input:DayScenarioInput,policy:DayScenarioPolicy) {
  const coverage:DayScenarioCoverage={policy,partial:false,totalSides:0,validSides:0,missingSides:0,missingOi:0,missingIv:0,invalidTime:0,invalidInput:0,expiredSides:0,totalStrikes:0,completeStrikes:0,missingExpiries:new Set(input.missing).size,unverifiedScope:false};
  const contracts:QqqPreparedGammaContract[]=[],included:string[]=[],excluded:string[]=[];
  let sourceAsOf:string|null=null,validCall=0,validPut=0;
  const available=(time:string|undefined)=>time===undefined||Number.isFinite(Date.parse(time))&&Date.parse(time)<=input.observationAt;
  for(const expiry of [...input.expiries].sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate))){
    const start=coverage.validSides;
    const live=qqqGammaExpiryTime(expiry.expiryDate)>input.observationAt;
    if(!expiry.fullGexProfile.length)coverage.unverifiedScope=true;
    for(const p of expiry.fullGexProfile){
      coverage.totalStrikes++;let valid=0;
      if(p.inputComplete===false)coverage.unverifiedScope=true;
      for(const side of ['call','put'] as const){
        coverage.totalSides++;
        const oi=p[`${side}Oi`],iv=p[`${side}Iv`],receipt=p[`${side}ReceivedAt`];
        const contract=oi===0?null:prepareQqqGammaContract(p.strike,oi,iv,side==='call'?1:-1,expiry.expiryDate,input.observationAt);
        let reason:keyof Pick<DayScenarioCoverage,'missingOi'|'missingIv'|'invalidTime'|'invalidInput'|'expiredSides'>|null=null;
        if(!live)reason='expiredSides';
        else if(!Number.isFinite(Date.parse(expiry.asOf))||!available(expiry.asOf)||!available(receipt)||!available(p.computedAt))reason='invalidTime';
        else if(!(typeof oi==='number'&&Number.isFinite(oi)&&oi>=0))reason='missingOi';
        else if(oi>0&&!qqqIvUsable(iv))reason='missingIv';
        else if(!(p.strike>0)||!Number.isFinite(p.strike)||oi>0&&!contract||p.inputComplete===false&&!qqqLosslessGexDefinitionSupported(p)&&p[`${side}InputComplete`]!==true)reason='invalidInput';
        if(reason){coverage[reason]++;coverage.missingSides++;continue;}
        valid++;coverage.validSides++;if(side==='call')validCall++;else validPut++;
        if(contract)contracts.push(contract);
        const source=receipt??expiry.asOf;
        if(sourceAsOf===null||Date.parse(source)<Date.parse(sourceAsOf))sourceAsOf=source;
      }
      if(valid===2)coverage.completeStrikes++;
    }
    (coverage.validSides>start?included:excluded).push(expiry.expiryDate);
  }
  coverage.partial=coverage.missingSides>0||coverage.missingExpiries>0||coverage.unverifiedScope;
  return {coverage,contracts,included,excluded,sourceAsOf,validCall,validPut};
}

export function dayScenarioCoverageLabel(coverage:DayScenarioCoverage) {
  const reasons=[coverage.missingOi?`OI 缺失 ${coverage.missingOi}`:'',coverage.missingIv?`IV 缺失 ${coverage.missingIv}`:'',coverage.invalidTime?`来源时间无效/晚于输入 ${coverage.invalidTime}`:'',coverage.invalidInput?`其他输入未验证 ${coverage.invalidInput}`:'',coverage.expiredSides?`已到期 ${coverage.expiredSides}`:'',coverage.missingExpiries?`缺少 ${coverage.missingExpiries} 个到期日（合约数未知）`:'',coverage.unverifiedScope?'上游链完整性未确认':''].filter(Boolean);
  return `有效合约贡献${coverage.partial?' · 缺失贡献未知':''} · 合约侧有效 ${coverage.validSides}/${coverage.totalSides}，缺失/排除 ${coverage.missingSides} · 行权价双侧有效 ${coverage.completeStrikes}/${coverage.totalStrikes}${reasons.length?' · '+reasons.join('；'):''}`;
}

/** A whole-day counterfactual under the selected snapshot, NOT reconstructed history.
 * Every valuation uses inventory already available at observationAt. */
export function buildDayScenario(input: DayScenarioInput, mode: DayScenarioMode, policy:DayScenarioPolicy='complete'): DayScenarioField {
  const inventory=observedInventory(input,policy);
  const field: DayScenarioField = { version: QQQ_DAY_SCENARIO_VERSION, observationAt: input.observationAt, sourceAsOf: null, start: NaN, end: NaN,
    prices: [], times: [], values: new Float64Array(), maximum: 0, included: [], excluded: [...input.missing], reason: null, mode,coverage:inventory.coverage };
  let bounds:ReturnType<typeof dayScenarioSessionBounds>;
  try { bounds=dayScenarioSessionBounds(input.date); } catch { return {...field, reason:'无效交易日期'}; }
  field.start=bounds.start;field.end=bounds.end;
  if (!bounds.trading) return {...field, reason:'所选日期不是交易日'};
  if (!Number.isFinite(input.observationAt) || qqqEasternDateKey(input.observationAt)!==input.date || !(input.spot>0) || !Number.isFinite(input.spot))
    return {...field, reason:'等待同日有效快照与已收盘参考价格'};
  if (input.observationAt>=field.end) return {...field, reason:'期权交易时段已结束，请回放盘中快照'};
  if(new Set(input.expiries.map(e=>e.expiryDate)).size!==input.expiries.length || input.expiries.some(e=>new Set(e.fullGexProfile.map(p=>p.strike)).size!==e.fullGexProfile.length))
    return {...field,reason:'快照包含重复到期日或行权价，无法确认持仓口径'};
  if(policy==='complete'&&input.expiries.some(e=>e.fullGexProfile.some(p=>[p.callReceivedAt,p.putReceivedAt,p.computedAt].some(time=>time!==undefined&&!Number.isFinite(Date.parse(time))))))
    return {...field,reason:'快照来源时间无效'};
  const prepared=policy==='complete'?prepareQqqGammaInventory(input.expiries,input.spot,new Date(input.observationAt).toISOString()):null;
  const observed=prepared?{...prepared.result,contracts:prepared.contracts,included:prepared.result.expiries}:inventory;
  field.sourceAsOf=observed.sourceAsOf;
  field.included=observed.included;
  field.excluded=[...new Set([...input.missing,...observed.excluded])];
  if(policy==='partial'&&(mode==='gamma-call'?inventory.validCall:mode==='gamma-put'?inventory.validPut:inventory.coverage.validSides)===0)
    return {...field,reason:inventory.coverage.expiredSides===inventory.coverage.totalSides&&inventory.coverage.totalSides>0?'所选合约已到期，请回放到到期前':'所选合约侧没有有效 OI / IV 输入'};
  if (policy==='complete'&&!observed.contracts.length) return {...field, reason:'完整链模式要求全部 OI / IV 与来源有效；可切换部分链情景查看有效贡献'};
  // A complete requested scope is required; an unknown expiry has no price-local mask.
  if (policy==='complete'&&field.excluded.length) return {...field, reason:'所选范围 OI / IV 或到期日覆盖不完整，无法计算完整情景'};
  const center=Math.round(input.spot*4)/4;
  field.prices=Array.from({length:641},(_,i)=>center-80+i*.25).filter(p=>p>0);
  field.prices=[...new Set([...field.prices,input.spot,...observed.contracts.map(c=>c.strike).filter(p=>Math.abs(p-center)<=80)])].sort((a,b)=>a-b);
  field.times=Array.from({length:Math.ceil((field.end-field.start)/120_000)},(_,i)=>field.start+i*120_000);
  // Include the actual observation and the final tradable minute, never exact expiry.
  if(input.observationAt>=field.start)field.times.push(input.observationAt);
  field.times.push(field.end-60_000);
  field.times=[...new Set(field.times)].sort((a,b)=>a-b);
  const values=new Float64Array(field.prices.length*field.times.length);
  values.fill(NaN);
  // Fixed prices/strikes share exact log ratios across every valuation time.
  const logMoneyness=new Map([...new Set(observed.contracts.map(c=>c.strike))].map(strike=>[strike,Float64Array.from(field.prices,price=>Math.log(price/strike))]));
  field.times.forEach((time,column)=>{
    const contracts=observed.contracts.map(c=>qqqGammaContractAt(c,time));
    // Never reinterpret an expired/invalid constituent as zero inventory.
    if(contracts.some(c=>c===null))return;
    const selected=contracts.flatMap(c=>!c||mode==='gamma-call'&&c.sign<0||mode==='gamma-put'&&c.sign>0?[]:[{contract:c,ratios:logMoneyness.get(c.strike)!}]);
    field.prices.forEach((price,row)=>{
      let value=0;
      for(const {contract:c,ratios} of selected){
        value+=c.sign*qqqGammaContractExposure(c,price,ratios[row]);
      }
      if(Number.isFinite(value)){values[column*field.prices.length+row]=value;field.maximum=Math.max(field.maximum,Math.abs(value));}
    });
  });
  field.values=values;
  return field;
}
