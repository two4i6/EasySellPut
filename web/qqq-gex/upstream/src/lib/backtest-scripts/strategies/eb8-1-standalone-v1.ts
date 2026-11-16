/** EB8.1: preserve EB8 decisions, execute one lot with a protective width cap. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategyObject,type StrategySnapshot} from '../strategy-module-v2';
import {eb8StandaloneV1 as eb8} from './eb8-standalone-v1';

export const EB81_PARAMS=freezeStrategyData({parent:'EB8',source:'EB8.1',
  lineage:[...(eb8.params.lineage as string[]),'EB8.1'],sourceVersion:eb8.manifest.version,
  quantity:1,multiplier:1,maximumSpreadWidth:38,ratioMin:.325,ratioMax:1.425,profitTarget:.225});

/** Change only the actual book. Source account sizes preserve EB8 admission state. */
export function capEb81Entry(intent:Extract<StrategyIntent,{kind:'open-spread'}>,snapshot:Readonly<StrategySnapshot>):StrategyIntent|null{
  if(intent.risk.sourceAccount!=='portfolio')return intent;
  const original=intent.contract,short=Number(original.shortStrike),oldLong=Number(original.longStrike);
  const chain=snapshot.market.chain as StrategyObject;
  const expiry=(chain.expirations as StrategyObject[]).find(e=>e.date===original.expiry);
  if(!expiry||!Array.isArray(expiry.puts))throw Error('Missing current expiry chain');
  const target=short-Math.min(short-oldLong,EB81_PARAMS.maximumSpreadWidth);
  const long=(expiry.puts as StrategyObject[])
    .filter(p=>Number(p.bid)>0&&Number(p.ask)>=Number(p.bid)&&Number(p.strike)>=target-1e-8
      &&Number(p.strike)<short&&Number(p.strike)>=oldLong)
    .sort((a,b)=>Number(a.strike)-Number(b.strike))[0];
  if(!long)return null;
  return {...intent,contract:{...original,shortStrike:short,longStrike:Number(long.strike),multiplier:1},
    risk:{...intent.risk,multiplier:1,quantity:1}};
}

export const eb81StandaloneV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'EB8.1',version:'eb8-1-fixed-one-lot-cap38-v1',researchOnly:true,
    migration:{complete:true,missing:[]}},
  params:EB81_PARAMS,
  initialize(params){assertFixedStrategyParams(params,EB81_PARAMS);return eb8.initialize(eb8.params);},
  onFeedback(input){assertFixedStrategyParams(input.params,EB81_PARAMS);return eb8.onFeedback!({...input,params:eb8.params});},
  onBar(input){
    assertFixedStrategyParams(input.params,EB81_PARAMS);
    const step=eb8.onBar({...input,params:eb8.params});
    return {...step,intents:step.intents.flatMap(intent=>{
      if(intent.kind!=='open-spread')return [intent];
      const capped=capEb81Entry(intent,input.snapshot);return capped?[capped]:[];
    })};
  },
};
