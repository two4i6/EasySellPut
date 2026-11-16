/** Selected fixed-unit kernel. Drops fitted allocation/corroboration overwritten by units1.
 * Native admission and original raw multiplier remain: raw still drives inherited geometry.
 */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyJson,type StrategyIntent} from '../../strategy-module-v2';
import {createAdmissionSource} from './admission-core-v19';
import {selectEb8940Entry} from '../eb8-940-standalone-v1';
import {eb81298Protection} from '../eb8-1298-standalone-v1';
export const E9249_SELECTED_ADMISSION=freezeStrategyData({"e64":["E64.0.0","E64.1.3","E64.3.0","E64.6.0"],"rescue":["E67","E70","E76","E82","E84","E100","E102","E108","E110","E116"],"broad":["E126","E128","E132","E135","E137","E139","E140","E141","E142","E143","E146","E148","E149","E151","E152","E154","E156","E158","E160","E162","E164","E166","E168","E170","E172","E176","E178","E182","E184","E186","E190","E198","E200"],"score":["E202","E204","E206","E208","E210","E216","E220","E222","E226","E228","E230","E234"],"armRelease":true,"probe":true,"upstream":true,"residual":true,"c4Readmission":true,"upstreamRawRelease":true,"upstreamC4Release":true,"upstreamQuality":true,"upstreamReplacement":false,"upstreamVeto":false,"upstreamAdxRelease":true,"mergeVeto":true,"logicEdits":[],"logicDesign":"whole7229"});
export function createE9264UnitKernel(admission:any):BarStrategyModule{
const source=createAdmissionSource(admission);
const params=freezeStrategyData({id:'E9249-unit-kernel',admission,quantity:1,multiplier:1,capitalLimits:'none'});
type State={source:StrategyJson;profitPeaks:Record<string,number>};
return {
 manifest:{sdkVersion:2,id:'E9249.UNIT',version:'e9249-unit-kernel-v1',researchOnly:true,migration:{complete:true,missing:[]}},params,
 initialize(p){assertFixedStrategyParams(p,params);return{source:source.initialize(source.params),profitPeaks:{}};},
 onFeedback(i){assertFixedStrategyParams(i.params,params);const s=i.state as State;return{...s,source:source.onFeedback!({...i,state:s.source,params:source.params})};},
 onBar(i){assertFixedStrategyParams(i.params,params);const s=i.state as State,fee=(i.snapshot.market.executionCapabilities as any)?.commissionPerContract;if(typeof fee!=='number')throw Error('Missing fixed execution commission');
 const step=source.onBar({...i,state:s.source,params:source.params}),owned=new Set(i.snapshot.positions.map(p=>String(p.id)));
 const intents=step.intents.flatMap<StrategyIntent>(o=>{if(o.kind==='close-position')return owned.has(o.positionId)?[]:[o];const selected=selectEb8940Entry(o,i.snapshot,fee);return selected?[selected]:[];});
 const originals=intents.filter(o=>o.kind==='open-spread'&&o.risk.sourceAccount==='portfolio');if(originals.length>1)throw Error('Multiple native E portfolio proposals');
 const original=originals[0] as Extract<StrategyIntent,{kind:'open-spread'}>|undefined;
 const main=original?{...original,contract:{...original.contract,multiplier:1},risk:{...original.risk,quantity:1,multiplier:1}}:null;
 const protection=eb81298Protection(i.snapshot,s.profitPeaks);
 return{...step,state:{source:step.state,profitPeaks:protection.state},plots:{...step.plots,gates:{parent:step.plots?.gates??null,originalMainWeight:original?Number(original.contract.multiplier):null}},intents:[...protection.intents,...intents.filter(o=>o.kind!=='open-spread'||o.risk.sourceAccount!=='portfolio'),...(main?[main]:[])]};
 }};

}
