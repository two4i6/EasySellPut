/** Source-specific capital release on fixed E10530; no monetary budgets. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategySnapshot}from '../../strategy-module-v2';
import {selectedNativeStrategy as parent}from './e10530';
type Open=Extract<StrategyIntent,{kind:'open-spread'}>;
const p={id:'E10548',mode:'same',fraction:.8,joint:true}as const;
function paired(o:Open,s:Readonly<StrategySnapshot>,fraction:number):Open{
 const ex=((s.market.chain as any).expirations as any[]).find(e=>e.date===o.contract.expiry);if(!ex)return o;
 const q=(ex.puts as any[]).filter(x=>Number(x.bid)>=0&&Number(x.ask)>0&&Number.isFinite(x.delta)&&Number(x.delta)<0),a=q.find(x=>x.strike===o.contract.shortStrike),b=q.find(x=>x.strike===o.contract.longStrike);if(!a||!b)return o;
 const oldWidth=Number(a.strike)-Number(b.strike),limit=oldWidth*fraction,oldBe=Number(a.strike)-(Number(a.bid)-Number(b.ask));
 const oldCredit=Number(a.bid)-Number(b.ask),oldRisk=oldWidth-oldCredit;
 const choices:any[]=[];for(const short of q)for(const long of q){const width=Number(short.strike)-Number(long.strike);if(!(width>0&&width<=limit+1e-9))continue;const credit=Number(short.bid)-Number(long.ask),risk=width-credit,be=Number(short.strike)-credit,ratio=credit/risk;
 if(credit>=oldCredit*fraction-1e-9&&risk>0&&risk<=oldRisk+1e-9&&be<=oldBe+1e-9&&ratio>=Number(o.risk.ratioMin)&&ratio<=Number(o.risk.ratioMax))choices.push({short,long,be,credit,width});}
 choices.sort((a,b)=>b.credit-a.credit||b.be-a.be||Number(a.short.strike)-Number(b.short.strike));
 const c=choices[0];if(!c)return o;
 if(!(c.width<=limit+1e-9&&c.be<=oldBe+1e-9))throw Error('Paired geometry invariant');
 const risk:any={...o.risk,quantity:1,multiplier:1};if(risk.longProtectionFallback!==undefined)risk.longProtectionFallback={maximumWidth:limit};
 return {...o,contract:{...o.contract,shortStrike:Number(c.short.strike),longStrike:Number(c.long.strike),multiplier:1},risk};
}


export function createSelectedStrategy():BarStrategyModule{
 const params=freezeStrategyData({parent:'E10530',profile:p,quantity:1,multiplier:1,commission:0,capitalLimits:'none'});
 return{...parent,manifest:{...parent.manifest,id:p.id,version:p.id+'-source-capital-v1'},params,
 initialize(a){assertFixedStrategyParams(a,params);return parent.initialize(parent.params);},onFeedback(i){assertFixedStrategyParams(i.params,params);return parent.onFeedback!({...i,params:parent.params});},
 onBar(i){assertFixedStrategyParams(i.params,params);const r=parent.onBar({...i,params:parent.params}),m=i.snapshot.market as any,f=m.extremePathResearch,weak=Number(m.qqq.close)<Number(m.restorationResearch.sma20)&&Number(f.roc5)<0;let changed=0;
 const intents=r.intents.map(o=>{if(o.kind!=='open-spread'||o.risk.sourceAccount!=='portfolio'||p.mode==='none')return o;let fraction=1;
 if(o.risk.entrySource==='low-e1'){
  const repeated=i.snapshot.positions.some(q=>q.entrySource==='low-e1'&&(p.mode==='same'?q.expiry===o.contract.expiry:Number(q.markPnl)<0));
  if(repeated&&(p.mode!=='weak'||weak))fraction=p.fraction;
 }
 if(p.joint&&Number(f.roc63)<0&&['high-e1','high-raw'].includes(String(o.risk.entrySource))&&i.snapshot.positions.some(q=>q.entrySource===o.risk.entrySource&&q.expiry===o.contract.expiry))fraction=.9;
 const n=fraction<1?paired(o,i.snapshot,fraction):o;changed+=Number(n.contract.shortStrike!==o.contract.shortStrike||n.contract.longStrike!==o.contract.longStrike);return n;});return{...r,intents,plots:{...r.plots,research:{id:p.id,changed,blocked:0}}};}
 };
}

export const selectedNativeStrategy=createSelectedStrategy();
