/** EB8.3896: original weighted1298 orders plus one narrow, capacity/quality-gated extra. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,
 type StrategyJson,type StrategyObject,type StrategySnapshot} from '../strategy-module-v2';
import {eb8StandaloneV1 as source} from './eb8-standalone-v1';
import {selectEb8940Entry} from './eb8-940-standalone-v1';
import {EB81298_PARAMS,eb81298Protection} from './eb8-1298-standalone-v1';
import {e209RoundedRiskMultiplier} from './e209-rounded-policy-v1';
export const EB83896_VERSION='eb8-3896-weighted-capacity-quality-v1';
export const EB83896_PARAMS=freezeStrategyData({...EB81298_PARAMS,parent:'EB8.1298',researchParent:'EB8.3759',source:'EB8.3896',
 lineage:[...(EB81298_PARAMS.lineage as string[]),'EB8.3896'],sourceVersion:'eb8-1298-guarded45-profit-protection-v1',
 extraEntry:{sources:['rolling-base','rolling-raw','e1-screen'],maximumEntries:1,baselineDayOnly:true,
  maximumWidth:5,estimatedPortfolioMarginBudget:17000,excludedRegime:'RISK_ON_WEAKENING',e1MinimumRoc5:0,
  referenceCommission:.65,referenceRatioMinimum:.325,referenceRatioMaximum:.84,
  multiplier:'source-native-times-eb-macro',ranking:'source-order'}});
type Open=Extract<StrategyIntent,{kind:'open-spread'}>;
export type Eb83896Source={intent:Open;context:StrategyObject};
type State={source:StrategyJson;profitPeaks:Record<string,number>};
const policy=EB83896_PARAMS.extraEntry;
function readState(value:StrategyJson):State{
 if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'source'))throw Error('Invalid EB8.3896 source state');
 const peaks=value.profitPeaks;
 if(!peaks||typeof peaks!=='object'||Array.isArray(peaks)||Object.values(peaks).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid EB8.3896 profit state');
 return value as State;
}
function puts(snapshot:Readonly<StrategySnapshot>,expiry:StrategyJson){
 const chain=snapshot.market.chain as StrategyObject;
 return (((chain.expirations as StrategyObject[]).find(e=>e.date===expiry)?.puts??[]) as StrategyObject[]);
}
function quote(entry:Open,snapshot:Readonly<StrategySnapshot>,fee:number){
 const q=puts(snapshot,entry.contract.expiry),short=q.find(x=>Number(x.strike)===(entry.contract.shortStrike as number)),long=q.find(x=>Number(x.strike)===(entry.contract.longStrike as number));
 if(!short||!long)return null;
 const credit=(Number(short.bid)-Number(long.ask))*100-2*fee,risk=((entry.contract.shortStrike as number)-(entry.contract.longStrike as number))*100-credit;
 return credit>0&&risk>0?{credit,risk,breakEven:(entry.contract.shortStrike as number)-credit/100}:null;
}
function narrow(entry:Open,snapshot:Readonly<StrategySnapshot>,fee:number):Open|null{
 if((entry.contract.shortStrike as number)-(entry.contract.longStrike as number)<=policy.maximumWidth)return entry;
 const reference=quote(entry,snapshot,fee);if(!reference)return null;
 const q=puts(snapshot,entry.contract.expiry).filter(x=>Number(x.bid)>0&&Number(x.ask)>=Number(x.bid)).sort((a,b)=>Number(a.strike)-Number(b.strike));
 let best:{entry:Open;credit:number;breakEven:number}|undefined;
 for(const short of q){
  const strike=Number(short.strike),minimum=strike-policy.maximumWidth-1e-8;let lo=0,hi=q.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(Number(q[mid]!.strike)<minimum)lo=mid+1;else hi=mid;}
  const long=q[lo];if(!long||Number(long.strike)>=strike)continue;
  const candidate={...entry,contract:{...entry.contract,shortStrike:strike,longStrike:Number(long.strike)}};
  const credit=(Number(short.bid)-Number(long.ask))*100-2*fee,risk=(strike-Number(long.strike))*100-credit,breakEven=strike-credit/100;
  if(!(credit>0&&risk>0&&breakEven<=reference.breakEven+1e-8))continue;
  if(!best||breakEven>best.breakEven||breakEven===best.breakEven&&(credit>best.credit||credit===best.credit&&strike<(best.entry.contract.shortStrike as number)))best={entry:candidate,credit,breakEven};
 }
 return best?.entry??null;
}
const signature=(entry:Open)=>JSON.stringify([entry.contract.expiry,(entry.contract.shortStrike as number),(entry.contract.longStrike as number)]);
/** Two-stage source deduplication then quality/capacity selection, matching the frozen3896 policy. */
export function selectEb83896Extras(baseline:Open|null,sources:readonly Eb83896Source[],snapshot:Readonly<StrategySnapshot>,fee:number):Open[]{
 if(!baseline)return [];
 if(!(Number.isFinite(fee)&&fee>=0))throw Error('Invalid current EB8.3896 commission');
 let used=Number(snapshot.account.margin);if(!(Number.isFinite(used)&&used>=0))throw Error('Missing current portfolio margin');
 const baseQuote=quote(baseline,snapshot,fee);if(!baseQuote)return [];
 used+=baseQuote.risk*Number(baseline.contract.multiplier);
 const seenAdmission=new Set([signature(baseline)]),proposals:Array<{entry:Open;context:StrategyObject}>=[];
 for(const id of policy.sources){
  const source=sources.find(s=>s.intent.risk.sourceAccount===id);if(!source)continue;
  const raw=source.intent,proposed:Open={...raw,key:`open:portfolio:${snapshot.asOf}:extra:${id}`,
   risk:{...raw.risk,sourceAccount:'portfolio',entrySource:id,quantity:1,ratioMin:.325,ratioMax:1.4}};
  const selected=selectEb8940Entry(proposed,snapshot,fee);if(!selected||seenAdmission.has(signature(selected)))continue;
  const reference=quote(selected,snapshot,policy.referenceCommission);if(!reference)continue;
  const ratio=reference.credit/reference.risk;if(ratio<policy.referenceRatioMinimum||ratio>policy.referenceRatioMaximum)continue;
  seenAdmission.add(signature(selected));
  const context=source.context;
  if(['regime','trend','slowSubregime'].some(k=>typeof context[k]!=='string'))throw Error('Missing current source macro context');
  const multiplier=Number(raw.contract.multiplier)*e209RoundedRiskMultiplier(context);
  if(!(Number.isFinite(multiplier)&&multiplier>0))throw Error('Invalid EB8.3896 extra weight');
  proposals.push({entry:{...selected,contract:{...selected.contract,multiplier},risk:{...selected.risk,multiplier}},context});
 }
 const seen=new Set([signature(baseline)]);
 for(const {entry,context} of proposals){
  if(context.regime===policy.excludedRegime||entry.risk.entrySource==='e1-screen'&&!(Number(context.roc5)>=policy.e1MinimumRoc5))continue;
  const selected=narrow(entry,snapshot,fee);if(!selected||seen.has(signature(selected)))continue;
  const actual=quote(selected,snapshot,fee),reference=quote(selected,snapshot,policy.referenceCommission);if(!actual||!reference)continue;
  const ratio=reference.credit/reference.risk;if(ratio<policy.referenceRatioMinimum||ratio>policy.referenceRatioMaximum)continue;
  if(used+actual.risk*Number(selected.contract.multiplier)>policy.estimatedPortfolioMarginBudget)continue;
  return [selected];
 }
 return [];
}
export const eb83896StandaloneV1:BarStrategyModule={
 manifest:{sdkVersion:2,id:'EB8.3896',version:EB83896_VERSION,researchOnly:true,migration:{complete:true,missing:[]}},params:EB83896_PARAMS,
 initialize(params){assertFixedStrategyParams(params,EB83896_PARAMS);return {source:source.initialize(source.params),profitPeaks:{}};},
 onFeedback(input){assertFixedStrategyParams(input.params,EB83896_PARAMS);const state=readState(input.state);return {...state,source:source.onFeedback!({...input,state:state.source,params:source.params})};},
 onBar(input){
  assertFixedStrategyParams(input.params,EB83896_PARAMS);const state=readState(input.state),capabilities=input.snapshot.market.executionCapabilities as StrategyObject|undefined;
  if(typeof capabilities?.commissionPerContract!=='number')throw Error('EB8.3896 requires current execution commission');
  const fee=capabilities.commissionPerContract,step=source.onBar({...input,state:state.source,params:source.params}),owned=new Set(input.snapshot.positions.map(p=>String(p.id)));
  const intents=step.intents.flatMap<StrategyIntent>(intent=>{
   if(intent.kind==='close-position')return owned.has(intent.positionId)?[]:[intent];
   const selected=selectEb8940Entry(intent,input.snapshot,fee);return selected?[selected]:[];
  });
  const opens=intents.filter((i):i is Open=>i.kind==='open-spread'),baseline=opens.find(i=>i.risk.sourceAccount==='portfolio')??null;
  if(opens.filter(i=>i.risk.sourceAccount==='portfolio').length>1)throw Error('Unexpected multiple EB8 baseline proposals');
  const books=input.snapshot.market.sourceAccounts as StrategyObject;
  const sources=baseline?opens.filter(i=>i.risk.sourceAccount!=='portfolio').map(intent=>{
   const book=books[String(intent.risk.sourceAccount)] as StrategyObject,native=(book.market as StrategyObject).nativeState as StrategyObject;
   return {intent,context:native.marketContext as StrategyObject};
  }):[];
  const protection=eb81298Protection(input.snapshot,state.profitPeaks),extras=selectEb83896Extras(baseline,sources,input.snapshot,fee);
  return {...step,state:{source:step.state,profitPeaks:protection.state},intents:[...protection.intents,
   ...intents.filter(i=>i.kind!=='open-spread'||i.risk.sourceAccount!=='portfolio'),...(baseline?[baseline]:[]),...extras]};
 },
};
