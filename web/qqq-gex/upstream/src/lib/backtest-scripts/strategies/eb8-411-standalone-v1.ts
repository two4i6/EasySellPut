/** EB8.411 promotes C068 exactly; source admissions remain isolated EB8. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategyObject,type StrategySnapshot} from '../strategy-module-v2';
import {eb8StandaloneV1 as eb8} from './eb8-standalone-v1';
export const EB8411_PARAMS=freezeStrategyData({parent:'EB8.10-C068',source:'EB8.411',
  lineage:[...(eb8.params.lineage as string[]),'EB8.411'],sourceVersion:eb8.manifest.version,
  quantity:1,multiplier:1,maximumSpreadWidth:34,referenceWidth:30,ratioMax:1.4,profitTarget:.25});
type Open=Extract<StrategyIntent,{kind:'open-spread'}>;
export function selectEb8411Entry(intent:Open,snapshot:Readonly<StrategySnapshot>,commission:number):Open|null{
  if(intent.risk.sourceAccount!=='portfolio')return intent;
  if(!Number.isFinite(commission)||commission<0)throw Error('Invalid observed execution commission');
  const chain=snapshot.market.chain as StrategyObject;
  const expiry=(chain.expirations as StrategyObject[]).find(e=>e.date===intent.contract.expiry);
  if(!expiry||!Array.isArray(expiry.puts))throw Error('Missing current expiry');
  const q=(expiry.puts as StrategyObject[]).filter(q=>Number(q.bid)>0&&Number(q.ask)>=Number(q.bid));
  const original=intent.contract,oldShort=Number(original.shortStrike),oldWidth=oldShort-Number(original.longStrike);
  const protection=(short:number,width:number)=>q.filter(l=>Number(l.strike)<short&&Number(l.strike)>=short-Math.min(oldWidth,width)-1e-8)
    .sort((a,b)=>Number(a.strike)-Number(b.strike))[0];
  const referenceShort=q.find(s=>Number(s.strike)===oldShort),referenceLong=protection(oldShort,EB8411_PARAMS.referenceWidth);
  if(!referenceShort||!referenceLong)return null;
  const referenceBreakEven=oldShort-(Number(referenceShort.bid)-Number(referenceLong.ask))+2*commission/100;
  const pairs=q.flatMap(short=>{
    const strike=Number(short.strike),long=protection(strike,EB8411_PARAMS.maximumSpreadWidth);if(!long)return [];
    const credit=(Number(short.bid)-Number(long.ask))*100-2*commission,risk=(strike-Number(long.strike))*100-credit;
    const breakEven=strike-credit/100;
    return credit>0&&risk>0&&breakEven<=referenceBreakEven+1e-8?[{short,long,credit,breakEven}]:[];
  }).sort((a,b)=>b.breakEven-a.breakEven||b.credit-a.credit||Number(a.short.strike)-Number(b.short.strike));
  const chosen=pairs[0];if(!chosen)return null;
  return {...intent,contract:{...original,shortStrike:Number(chosen.short.strike),longStrike:Number(chosen.long.strike),multiplier:1},
    risk:{...intent.risk,quantity:1,multiplier:1,ratioMax:EB8411_PARAMS.ratioMax}};
}
export function eb8411Exits(snapshot:Readonly<StrategySnapshot>):StrategyIntent[]{
  return snapshot.positions.filter(p=>Number(p.markPnl)>=Number(p.creditReceived)*EB8411_PARAMS.profitTarget).map(p=>({
    kind:'close-position',key:`close:portfolio:${p.id}:${snapshot.asOf}`,positionId:String(p.id),reason:'profit-target',minimumUnweightedPnl:0}));
}
export const eb8411StandaloneV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'EB8.411',version:'eb8-411-joint-reference30-width34-v1',researchOnly:true,migration:{complete:true,missing:[]}},
  params:EB8411_PARAMS,
  initialize(params){assertFixedStrategyParams(params,EB8411_PARAMS);return eb8.initialize(eb8.params);},
  onFeedback(input){assertFixedStrategyParams(input.params,EB8411_PARAMS);return eb8.onFeedback!({...input,params:eb8.params});},
  onBar(input){
    assertFixedStrategyParams(input.params,EB8411_PARAMS);
    const capabilities=input.snapshot.market.executionCapabilities as StrategyObject|undefined;
    if(typeof capabilities?.commissionPerContract!=='number')throw Error('EB8.411 requires current execution commission');
    const step=eb8.onBar({...input,params:eb8.params}),owned=new Set(input.snapshot.positions.map(p=>String(p.id)));
    const intents=step.intents.flatMap<StrategyIntent>(i=>{
      if(i.kind==='close-position')return owned.has(i.positionId)?[]:[i];
      const changed=selectEb8411Entry(i,input.snapshot,capabilities.commissionPerContract as number);return changed?[changed]:[];
    });
    return {...step,intents:[...eb8411Exits(input.snapshot),...intents]};
  },
};
