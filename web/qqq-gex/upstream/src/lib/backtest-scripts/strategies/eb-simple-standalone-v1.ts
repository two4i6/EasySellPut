/** Simple bullish put-spread baseline. No source graph, rescue rules or learned coefficients. */
import {findNearestExpiry} from '../../engines/leveraged-overlay/utils';
import type {EquityBoostChain} from '../../engines/leveraged-overlay/v2/strategies/equity-boost-put-spread';
import {assertFixedStrategyParams,type BarStrategyModule,type StrategyIntent,type StrategyObject} from '../strategy-module-v2';
import {createAdmissionTrace} from '../strategy-admission-v1';
import {EB_SIMPLE_PARAMS as p} from './eb-simple-contract-v1';

export function selectSimpleEbContract(chain:EquityBoostChain,asOf:string){
  if(!Number.isFinite(chain.spot)||chain.spot<=0)return null;
  const expiry=findNearestExpiry(chain.expirations,asOf,p.targetDte);
  const puts=chain.expirations.find(e=>e.date===expiry)?.puts.filter(c=>
    Number.isFinite(c.strike)&&c.strike>0&&Number.isFinite(c.bid)&&c.bid>0
    &&Number.isFinite(c.ask)&&c.ask>=c.bid&&c.openInterest>0&&c.volume>=0)??[];
  const short=puts.filter(c=>Math.abs(c.strike/chain.spot-1)<=p.maxShortDistancePct)
    .sort((a,b)=>Math.abs(a.strike-chain.spot)-Math.abs(b.strike-chain.spot)||a.strike-b.strike)[0];
  if(!short)return null;
  const target=short.strike-chain.spot*p.widthTargetPct;
  const long=puts.filter(c=>c.strike<short.strike)
    .sort((a,b)=>Math.abs(a.strike-target)-Math.abs(b.strike-target)||a.strike-b.strike)[0];
  if(!long)return null;
  const credit=(short.bid-long.ask)*100,width=short.strike-long.strike;
  if(!(credit>0&&credit<width*100)||Math.abs(width/chain.spot-p.widthTargetPct)>p.maxShortDistancePct)return null;
  return {symbol:'QQQ',type:'put' as const,expiry:expiry!,shortStrike:short.strike,longStrike:long.strike,targetDte:p.targetDte};
}

export const ebSimpleStandaloneV1:BarStrategyModule={
  manifest:{sdkVersion:2,id:'EB.SIMPLE',version:'eb-simple-standalone-v1',researchOnly:true,migration:{complete:true,missing:[]}},
  params:p,
  initialize(params){assertFixedStrategyParams(params,p);return {lastBar:null};},
  onBar({params,state,snapshot}){
    assertFixedStrategyParams(params,p);
    const lastBar=(state as StrategyObject).lastBar;
    if(typeof lastBar==='string'&&snapshot.asOf<=lastBar)throw Error('Non-chronological simple EB bar');
    const trace=createAdmissionTrace(['当前数据','市场方向','持仓数量','ATM 合约','固定一组']);
    const check=(index:number,passed:boolean,detail:string)=>{trace.check(index,passed,detail);return passed;};
    const intents:StrategyIntent[]=[];
    const finish=(reason:string)=>({state:{lastBar:snapshot.asOf},intents,plots:{reason,gates:trace.gates}});
    const native=snapshot.market.nativeState as StrategyObject|undefined;
    if(!native||native.asOf!==snapshot.asOf||native.available===false){
      if(snapshot.positions.length)throw Error('Simple EB position requires current observation');
      trace.check(0,false,'当前市场观测不可用');return finish('native-unavailable');
    }
    const c=native.marketContext as StrategyObject,macro=native.macro as StrategyObject;
    const statuses=native.upstreamStatuses as StrategyObject;
    const chain=snapshot.market.chain as unknown as EquityBoostChain;
    const vix=Number(macro?.vix),term=Number(macro?.vix3m);
    const trend=typeof c?.priceVsSma200Pct==='number'?c.priceVsSma200Pct:NaN;
    const dataOk=!!c&&!!statuses&&Object.keys(statuses).length>0&&!!chain
      &&Number.isFinite(chain.spot)&&chain.spot>0&&Number.isFinite(trend)
      &&typeof macro?.vix==='number'&&Number.isFinite(vix)&&vix>0;
    if(!check(0,dataOk,'当前价格、长期均线、波动率与上游状态完整'))return finish('data-unavailable');
    const riskOff=c.regime==='BEAR'||c.regime==='CRISIS'||c.crisisPhase==='PENDING'||c.crisisPhase==='CONFIRMED'||trend<0;
    for(const position of snapshot.positions){
      const pnl=Number(position.markPnl),credit=Number(position.creditReceived);
      if(!Number.isFinite(pnl)||!Number.isFinite(credit)||credit<=0)throw Error('Invalid simple EB position mark');
      const reason=riskOff?'market-risk-off':pnl>=credit*p.profitTarget?'profit-target'
        :pnl<=-credit*p.stopLossCreditMultiple?'loss-limit':null;
      if(reason)intents.push({kind:'close-position',key:`close:${position.id}:${snapshot.asOf}`,positionId:String(position.id),reason});
    }
    const marketOk=!riskOff&&['BULL','RISK_ON_EXTENDED','RISK_ON_WEAKENING','RANGE_BOUND','SIDEWAYS'].includes(String(c.regime))
      &&typeof macro?.vix3m==='number'&&Number.isFinite(term)&&term>=vix
      &&!Object.values(statuses).some(s=>s==='BLOCK'||s==='ERROR');
    if(!check(1,marketOk,'价格不低于长期均线、无危机或上游阻断，波动率期限结构未倒挂'))return finish('market-block');
    if(!check(2,snapshot.positions.length<p.maxOpenPositions,'最多同时持有一笔 EB'))return finish('position-limit');
    const contract=selectSimpleEbContract(chain,snapshot.asOf);
    if(!check(3,!!contract,'固定 35 天、卖出最接近 ATM 的 Put、约 3% 宽度'))return finish('contract-unavailable');
    trace.check(4,true,'固定一组，风险倍数为 1；成交时再次检查 ATM 距离');
    intents.push({kind:'open-spread',key:`open:eb-simple:${snapshot.asOf}`,contract:contract!,risk:{
      multiplier:1,quantity:p.quantity,ratioMin:0,ratioMax:Number.MAX_VALUE,
      minUnderlyingPrice:contract!.shortStrike/(1+p.maxShortDistancePct),
      maxUnderlyingPrice:contract!.shortStrike/(1-p.maxShortDistancePct),
    }});
    return finish('simple-eb-proposal');
  },
};
