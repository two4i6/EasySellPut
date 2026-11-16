/** Coarse paired width vs PL tradeoff on registered E10467, unit positions. */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyIntent,type StrategySnapshot}from '../../strategy-module-v2';
import {selectedNativeStrategy as selected}from './e10495';
const parent=selected;type Open=Extract<StrategyIntent,{kind:'open-spread'}>;
const p={id:'E10530',fraction:.8,sameExpiry:true}as const;
function paired(o:Open,s:Readonly<StrategySnapshot>,fraction:number):Open{
 const ex=((s.market.chain as any).expirations as any[]).find(e=>e.date===o.contract.expiry);if(!ex)return o;
 const q=(ex.puts as any[]).filter(x=>Number(x.bid)>=0&&Number(x.ask)>0&&Number.isFinite(x.delta)&&Number(x.delta)<0),a=q.find(x=>x.strike===o.contract.shortStrike),b=q.find(x=>x.strike===o.contract.longStrike);if(!a||!b)return o;
 const oldWidth=Number(a.strike)-Number(b.strike),limit=oldWidth*fraction,oldBe=Number(a.strike)-(Number(a.bid)-Number(b.ask));
 const choices=q.flatMap(short=>{const longs=q.filter(l=>Number(l.strike)<Number(short.strike)&&Number(l.strike)>=Number(short.strike)-limit-1e-9).sort((a,b)=>Number(a.strike)-Number(b.strike));const long=longs[0];if(!long)return[];
  const width=Number(short.strike)-Number(long.strike),credit=Number(short.bid)-Number(long.ask),risk=width-credit,be=Number(short.strike)-credit,ratio=credit/risk;
  return credit>0&&risk>0&&be<=oldBe+1e-9&&ratio>=Number(o.risk.ratioMin)&&ratio<=Number(o.risk.ratioMax)?[{short,long,be,credit,width}]:[];
 }).sort((a,b)=>b.be-a.be||b.credit-a.credit||Number(a.short.strike)-Number(b.short.strike));
 const c=choices[0];if(!c)return o;
 if(!(c.width<=limit+1e-9&&c.be<=oldBe+1e-9))throw Error('Paired geometry invariant');
 const risk:any={...o.risk,quantity:1,multiplier:1};if(risk.longProtectionFallback!==undefined)risk.longProtectionFallback={maximumWidth:limit};
 return {...o,contract:{...o.contract,shortStrike:Number(c.short.strike),longStrike:Number(c.long.strike),multiplier:1},risk};
}

export function createSelectedStrategy():BarStrategyModule{
 const params=freezeStrategyData({parent:'E10495',profile:p,quantity:1,multiplier:1,commission:0,capitalLimits:'none'});
 return{...parent,manifest:{...parent.manifest,id:p.id,version:p.id+'-paired-width-tradeoff-v1'},params,
 initialize(a){assertFixedStrategyParams(a,params);return parent.initialize(parent.params);},onFeedback(i){assertFixedStrategyParams(i.params,params);return parent.onFeedback!({...i,params:parent.params});},
 onBar(i){assertFixedStrategyParams(i.params,params);const r=parent.onBar({...i,params:parent.params}),m=i.snapshot.market as any,weak=Number(m.qqq.close)<Number(m.restorationResearch.sma20)&&Number(m.extremePathResearch.roc5)<0;let changed=0,blocked=0;
 const rawStress=Number(m.extremePathResearch.roc63)<0&&Number(m.extremePathResearch.rv20)<=Number(m.extremePathResearch.rv63);
 const intents=r.intents.map(o=>{if(o.kind!=='open-spread'||o.risk.sourceAccount!=='portfolio')return o;let fraction=1;
 if(o.risk.entrySource==='high-c4'&&weak&&i.snapshot.positions.some(q=>q.entrySource==='high-c4'&&Number(q.markPnl)<0&&q.expiry===o.contract.expiry))fraction=.7;
 const raw=o.risk.entrySource==='high-raw'&&(!p.sameExpiry||i.snapshot.positions.some(q=>q.entrySource==='high-raw'&&q.expiry===o.contract.expiry));if(raw&&rawStress)fraction=p.fraction;
 const n=fraction<1?paired(o,i.snapshot,fraction):o;changed+=Number(n.contract.shortStrike!==o.contract.shortStrike||n.contract.longStrike!==o.contract.longStrike);return n;});return{...r,intents,plots:{...r.plots,research:{id:p.id,changed,blocked}}};}
 };
}

export const selectedNativeStrategy=createSelectedStrategy();
