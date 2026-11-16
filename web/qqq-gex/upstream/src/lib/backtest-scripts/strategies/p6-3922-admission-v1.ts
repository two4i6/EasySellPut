/** P6.3922 fixed effective admission: rounded VIX grants, one state-sequence grant removed. */
import * as base from './p6-3922-admission-leaves-v1';
import {MERGED_RULES} from './p6-3922-release-rules-v1';
import * as grantApi from './p6-3922-grants-v1';
import {createDecisionMemo} from '../current-bar-facts-v4';

const recoveries=[base.isQqqP4E56RecoveryCurrentBar_db5cca,base.isQqqP4E57RecoveryCurrentBar_db5cca,base.isQqqP4E58RecoveryCurrentBar_db5cca,base.isQqqP4E59RecoveryCurrentBar_db5cca,base.isQqqP4E61RecoveryCurrentBar_db5cca,base.isQqqP4E62RecoveryCurrentBar_db5cca,base.isQqqP4E63RecoveryCurrentBar_db5cca,base.isQqqP4E65RecoveryCurrentBar_db5cca,base.isQqqP4E66RecoveryCurrentBar_db5cca,base.isQqqP4E67RecoveryCurrentBar_db5cca,base.isQqqP4E68RecoveryCurrentBar_db5cca,base.isQqqP4E104RecoveryCurrentBar_db5cca];
const finite=(v:any)=>Number.isFinite(v)?v:NaN;
function roleRow(row:any){const r={...row};Object.defineProperty(r,'evaluationMemo',{value:createDecisionMemo(),enumerable:false});return r;}
export function evaluateP63922Admission(context:any,state:any){
 const original=base.p6ContextRow(context);

 const hard=base,risk=base,grant=grantApi,authority=base;
 const h=roleRow(original),r=roleRow(original),g=roleRow(original),a=roleRow(original),m=original.market;
 const reject=(reason:string)=>({allowed:false,reason});
 if(hard.p6CurrentBlock(m)||hard.p6PriceSmaBlock(m))return reject('P4_CURRENT_STATE_BLOCK');
 if(hard.p6P1Block(h)||(m.regime==='RANGE_BOUND'&&m.slowSubregime==='SR01'&&(m.vix??Infinity)>=15&&(m.vix??Infinity)<20&&(m.tqqqRealisedVol20d??-Infinity)>=.5&&(m.tqqqRealisedVol20d??-Infinity)<.6&&(m.priceExtensionAtr??-Infinity)>=.75))return reject('P3_BASE_COMPACT_OR_RANGE_BLOCK');
 if(m.regime==='RISK_ON_WEAKENING'&&m.slowSubregime==='SR02'&&(m.adx14??Infinity)<15&&(m.rsi14??Infinity)<35&&state.lastSettledPnl!==null&&state.lastSettledPnl<=0)return reject('P3_PRIOR_SETTLED_LOSS_BLOCK');
 const residual=risk.isQqqP4E54FlatMergedCurrentBarReject_db5cca(r)&&!recoveries.some(fn=>fn(r));
 const bull=m.slowSubregime==='SR01'&&m.regime==='BULL'&&finite(m.adx14)<15&&finite(m.roc20)<0&&finite(m.tqqqRealisedVol20d)>=.43&&finite(m.tqqqRealisedVol20d)<.6;
 let range=false;
 if(m.regime==='RANGE_BOUND'&&m.slowSubregime==='SR01'&&Number.isFinite(m.roc5)&&finite(m.roc5)<0&&Number.isFinite(m.vix)){
  const vix=finite(m.vix),extension=finite(m.priceExtensionAtr),term=finite(m.vixTermStructureSlope);
  range=vix>=26?true:vix<20.75?false:vix<22.5?!Number.isFinite(extension)||(extension>=0&&(!Number.isFinite(term)||term<1)):!Number.isFinite(extension)||!Number.isFinite(term)||extension>=.5||term<1;
 }
 const volatile=finite(m.tqqqRealisedVol20d)>=.95&&finite(m.roc20)>=.04&&finite(m.range20dPct)>=.13&&finite(m.vixTermStructureSlope)>=3;
 const negative=finite(m.roc5)<0&&finite(m.range20dPct)>=.15&&finite(m.vix)<=22.25;
 const researchRisk=residual||bull||range||volatile||negative;
 const authorized=m.regime==='RISK_ON_EXTENDED'&&m.slowSubregime==='SR02'&&Number.isFinite(m.roc5)&&m.roc5!>=.0044&&Number.isFinite(m.range20dPct)&&m.range20dPct!>=.0651&&authority.p6RejectQualityGuard(a);
 if(researchRisk&&!authorized)return reject('P4_RESEARCH_ADDITIONAL_REJECT');
 const normal=!authorized&&grant.p6CurrentArm(context,g),market=!authorized&&grant.p6CandidateA(m),rule=!authorized&&MERGED_RULES.some(([,fn]:any)=>fn(g));
 const additional=authorized||grant.p6E307(g)||grant.p6E348(g)||grant.p6E354(g)||grant.p6ExtraAdmission(g);
 const final=hard.p6FinalReject(h,!hard.p6ProtectionBypass(h));if(final)return reject(final);
 const allowed=authorized||(!researchRisk&&(normal||market||rule||additional));
 return {allowed,reason:allowed?'P6_NET_SCOPED_ADMISSION':'P4_NO_PARENT_OR_RULE_MATCH'};
}
