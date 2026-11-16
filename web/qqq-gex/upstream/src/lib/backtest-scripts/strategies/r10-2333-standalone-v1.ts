import {buildQuoteOnlyRRescue} from '../r-quote-only-rescue-v1';
import {rCoreEntrySignalAllowed} from '../r-core-entry-signal-filter-v1';
/** R10.2333: fixed research child of R10.1477 (unit quote-only, price-dual-credit2).
 * Parent R10.1477; fixed defaults, no profile override; no production registration.
 * Complete owned SDK2 fork, not a research-grid wrapper.
 * Narrow a selected protection leg using current quotes while retaining a
 * declared fraction of signal net credit. Same short/expiry, qty1, no money cap.
 * Parent management and original admission remain owned below. No promotion.
 */
import {assertFixedStrategyParams,freezeStrategyData,type BarStrategyModule,type StrategyObject,type StrategyIntent,type StrategySnapshot} from '../strategy-module-v2';
import type {OptionChain} from '../../engines/leveraged-overlay/types/input';
import type {PutSpreadBounds} from '../bounded-put-spread-selection-v1';
import {selectAsymmetricPutSpread} from '../asymmetric-put-spread-selection-v1';
import {resolveOptionQuote} from '../../optionQuote';
import type {PutCreditSpreadOpen} from '../put-spread-kernel-v6';
import type {PcsAnalyticalProbe} from '../qqq-pcs-analytics-v2';
import {resolveVolatilityCoordinates} from '../market-coordinates-v3';
import {projectNativeMarketFacts} from '../native-market-facts-v7';
import {settledFeedbackPnl} from '../settlement-observations-v3';
import {stressOnlyPcsSelectionProfile} from '../pcs-selection-v6';
import {isPcsV12GateBlocked} from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import {isCallCreditSpreadPreCrisis} from '../put-spread-kernel-v6';
import {R9_MAIN_PCS_CONTRACT,r9MainPcsStress,selectR9MainPcs} from './r9-e226-main-pcs-v3';
import {R9_E226_SOURCE_CONTRACT} from './r9-e226-source-contract-v1';
import {createAdmissionTrace} from '../strategy-admission-v1';
import {R9_E226_PARAMS,r9E226DualMainQuality,r9E226SourceAdmission,r9E226LowRvBlocked,
  r9E226ProposalPriority,type R9E226Market} from './r9-e226-policy-v5';

// Coverage-focused historical candidate: retain near-baseline openings rather than a positive-momentum-only pool.
export const R10_85_DEFAULT_PROFIT_FRACTION=.35;
export const R102333_CLOSING_COMMISSION_MODE='account-default-v1' as const;
export function r102333CreditAllowed(creditPerShare:number|undefined,commissionPerContract:number,minimumNetCredit:number){
  return typeof creditPerShare==='number'&&Number.isFinite(creditPerShare)&&creditPerShare>0
    &&Number.isFinite(commissionPerContract)&&commissionPerContract>=0&&Number.isFinite(minimumNetCredit)&&minimumNetCredit>=0
    &&100*creditPerShare-2*commissionPerContract>=minimumNetCredit;
}
export function r102333ProfitExits(snapshot:Readonly<StrategySnapshot>,fraction:number,coverageFraction=.25,fallbackProfitFraction=.10,maturityWideProfitFraction=0):StrategyIntent[]{
  if(fraction===0||snapshot.market.sampleTerminal===true)return [];
  return snapshot.positions.flatMap<StrategyIntent>(position=>{
    const credit=Number(position.creditReceived),mark=Number(position.markPnl);
    if(!(credit>0)||!Number.isFinite(mark))throw Error('Invalid R10.2333 position economics');
    const floor=credit*(String(position.id).startsWith('r9-maturity:')?(String(position.id).startsWith('r9-maturity:wide:')&&maturityWideProfitFraction>0?maturityWideProfitFraction:fallbackProfitFraction):String(position.id).startsWith('r9-coverage:')?coverageFraction:fraction);
    return [{kind:'close-position',key:`r10-profit:${String(position.id)}:${snapshot.asOf}`,
      positionId:String(position.id),reason:'r10-net-profit-target',minimumUnweightedPnl:floor}];
  });
}
type CoverageMode='legacy'|'recovery'|'term-normal';
const mandatoryUpstream=['dataQuality','regime','hardRisk','intradayGate'];
export function r102333MandatoryBlocked(upstream:Readonly<StrategyObject>){
  return Object.values(upstream).some(value=>value==='ERROR')||mandatoryUpstream.some(key=>upstream[key]==='BLOCK');
}
export function r102333CoverageAllowed(input:{mode:CoverageMode;legacySafe:boolean;upstream:Readonly<StrategyObject>;
  regime:string;crisisPhase:string;primary?:number;primary3m?:number;macroVix?:number;macroVix3m?:number;roc5?:number;roc20?:number}){
  if(r102333MandatoryBlocked(input.upstream))return false;
  if(input.legacySafe)return true;
  if(input.mode==='legacy'||!['PASS','WARN'].includes(String(input.upstream.dataQuality)))return false;
  if(input.regime==='CRISIS'||['CONFIRMED','PENDING'].includes(input.crisisPhase))return false;
  if(![input.primary,input.primary3m,input.macroVix,input.macroVix3m].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))return false;
  if(!(input.primary3m!>input.primary!&&input.macroVix3m!>input.macroVix!))return false;
  return input.mode==='term-normal'||(Number.isFinite(input.roc5)&&Number.isFinite(input.roc20)&&input.roc5!>0&&input.roc20!>0);
}
export function r102333MaturityDeltaBounds(bounds:PutSpreadBounds,delta:number,mode:'parent-bounded'|'independent'|'volatility-scaled',vol?:number,anchor=25,power=1){
 if(!Number.isFinite(delta)||delta<.03||delta>.15||!['parent-bounded','independent','volatility-scaled'].includes(mode))throw Error('Invalid maturity delta rule');
 if(!Number.isFinite(anchor)||anchor<15||anchor>40)throw Error('Invalid maturity volatility anchor');
 if(mode==='volatility-scaled'&&(!Number.isFinite(vol)||vol!<=0))return undefined;
 if(!Number.isFinite(power)||power<.25||power>3)throw Error('Invalid maturity volatility exponent');
 const active=mode==='volatility-scaled'?Math.max(.03,Math.min(.15,(power===1?delta*vol!/anchor:delta*Math.pow(vol!/anchor,power)))):delta;
 return {...bounds,maximumShortDelta:mode!=='parent-bounded'?active:Math.min(bounds.maximumShortDelta,active),targetShortDelta:mode!=='parent-bounded'?active:Math.min(bounds.targetShortDelta!,active)};
}
export function r102333SelectMaturityFallback(chain:OptionChain,asOf:string,minimumDte:number,bounds:PutSpreadBounds,protectionQuoteSpread:number,order:readonly number[]=[63,56,42,35]){
  if(![35,42,56,63].includes(minimumDte))throw Error('Invalid fallback minimum DTE');
  for(const targetDte of order.filter(d=>d>=minimumDte)){
    const contract=selectAsymmetricPutSpread(chain,asOf,targetDte,bounds,protectionQuoteSpread);
    if(contract)return {contract,targetDte};
  }
  return undefined;
}
/** Pure signal-quote search. The short and expiry stay fixed; only a farther put with strictly better credit is eligible. */
export function r102333WidenProtection(chain:OptionChain,reference:PutCreditSpreadOpen,maximumWidth:number,fee:number):PutCreditSpreadOpen|undefined{
  if(!Number.isFinite(maximumWidth)||maximumWidth<=0||maximumWidth>200||!Number.isFinite(fee)||fee<0||reference.quantity!==1)throw Error('Invalid single-spread protection budget');
  const stamp=Date.parse(chain.timestamp);
  if(!Number.isFinite(stamp)||!reference.expiry||reference.expiry<=chain.timestamp.slice(0,10)||!Number.isFinite(reference.credit)||reference.credit!<=0)return undefined;
  const expiry=chain.expirations.find(e=>e.date===reference.expiry);
  const valid=(p:OptionChain['expirations'][number]['puts'][number])=>Number.isFinite(p.strike)&&p.strike>0&&Number.isFinite(p.delta)&&p.delta<=0&&Number.isFinite(p.openInterest)&&p.openInterest>0&&Number.isFinite(p.volume)&&p.volume>=0;
  const short=expiry?.puts.find(p=>p.strike===reference.shortStrike&&valid(p));
  const shortQuote=short?resolveOptionQuote(short,.5,stamp/1000):undefined;
  if(!short||shortQuote?.source!=='market')return undefined;
  const choices=(expiry?.puts??[]).flatMap(long=>{
    if(!valid(long)||long.strike>=reference.longStrike||Math.abs(long.delta)>Math.abs(short.delta))return [];
    const width=short.strike-long.strike,quote=resolveOptionQuote(long,2,stamp/1000);
    if(width>maximumWidth||quote?.source!=='market')return [];
    const credit=shortQuote.sell-quote.buy,maxLoss=width*100-credit*100;
    return credit>reference.credit!&&credit*100-2*fee>=1&&maxLoss>0?[{long,credit,maxLoss,width}]:[];
  }).sort((a,b)=>b.credit-a.credit||a.width-b.width);
  const best=choices[0];
  return best?{...reference,longStrike:best.long.strike,credit:best.credit,maxLoss:best.maxLoss,quantity:1,pairSearchUsed:true}:undefined;
}
/** Narrow only an already selected signal pair. Never read accounts or realized outcomes. */
export function narrowCreditProtection(chain:OptionChain,reference:PutCreditSpreadOpen,retention:number,fee:number):PutCreditSpreadOpen|undefined{
 if(!Number.isFinite(retention)||retention<.5||retention>1||!Number.isFinite(fee)||fee<0||reference.quantity!==1)throw Error('Invalid credit-preserving geometry');
 const stamp=Date.parse(chain.timestamp),expiry=chain.expirations.find(e=>e.date===reference.expiry);
 if(!Number.isFinite(stamp)||!reference.expiry||reference.expiry<=chain.timestamp.slice(0,10)||!Number.isFinite(reference.credit)||reference.credit!<=0)return undefined;
 const valid=(p:OptionChain['expirations'][number]['puts'][number])=>Number.isFinite(p.strike)&&p.strike>0&&Number.isFinite(p.delta)&&p.delta<=0&&Number.isFinite(p.openInterest)&&p.openInterest>0&&Number.isFinite(p.volume)&&p.volume>=0;
 const short=expiry?.puts.find(p=>p.strike===reference.shortStrike&&valid(p));
 const sq=short?resolveOptionQuote(short,.5,stamp/1000):undefined;
 if(!short||sq?.source!=='market')return undefined;
 const choices=(expiry?.puts??[]).flatMap(long=>{
  if(!valid(long)||long.strike<=reference.longStrike||long.strike>=reference.shortStrike||Math.abs(long.delta)>Math.abs(short.delta))return [];
  const lq=resolveOptionQuote(long,2,stamp/1000);if(lq?.source!=='market')return [];
  const credit=sq.sell-lq.buy,width=reference.shortStrike-long.strike,maxLoss=width*100-credit*100;
  if(credit*100-2*fee<Math.max(1,retention*(reference.credit!*100-2*fee))||maxLoss<=0||maxLoss>=Number(reference.maxLoss))return [];
  return [{long,credit,width,maxLoss}];
 }).sort((a,b)=>a.width-b.width||b.credit-a.credit);
 const best=choices[0];return best?{...reference,longStrike:best.long.strike,credit:best.credit,maxLoss:best.maxLoss,quantity:1,pairSearchUsed:true}:undefined;
}
export const R102333_EXIT_POLICIES=['static','runner','quality','rotation','combined'] as const;
export type R102333ExitPolicy=typeof R102333_EXIT_POLICIES[number];
/** All peaks use currently observed close marks after a closing-fee reserve. A release is a next-open limit, never an intrabar stop fill. */
export function r102333AdaptiveExits(snapshot:Readonly<StrategySnapshot>,priorMemory:Readonly<StrategyObject>,input:{policy:R102333ExitPolicy;intensity:number;scope:'core'|'all';rotationScope?:'core'|'all'|'core-maturity'|'core-coverage';quality:number;vol?:number;baseFraction:number;coverageFraction:number;maturityFraction:number;maturityWideProfitFraction?:number;recycleFraction?:number;rotationRatio?:number;runnerCapture?:number;runnerArm?:number;runnerQuality?:number;harvestArm?:number;maturityHarvestArm?:number;harvestQuality?:number;harvestScope?:'core'|'all'|'core-coverage';harvestRetention?:number;lossReleaseFraction?:number;lossReleaseQuality?:number;qualityObserved?:boolean;opportunity?:{credit:number;margin:number;days:number}}){
  if(!R102333_EXIT_POLICIES.includes(input.policy)||![input.intensity,input.quality,input.baseFraction,input.coverageFraction,input.maturityFraction].every(Number.isFinite)
    ||input.intensity<0||input.intensity>1||!['core','all'].includes(input.scope))throw Error('Invalid adaptive exits');
  for(const [value,lo,hi] of [[input.recycleFraction,.1,.35],[input.rotationRatio,1,3],[input.runnerCapture,.35,.85],[input.runnerArm,.35,.75],[input.runnerQuality,0,1]] as const)if(value!==undefined&&(!Number.isFinite(value)||value<lo||value>hi))throw Error('Invalid calibrated exit settings');
  if(input.maturityWideProfitFraction!==undefined&&(!Number.isFinite(input.maturityWideProfitFraction)||input.maturityWideProfitFraction<0||input.maturityWideProfitFraction>1))throw Error('Invalid entry-owned wide profit target');
  if(input.harvestArm!==undefined&&(!Number.isFinite(input.harvestArm)||input.harvestArm<0||input.harvestArm>.35))throw Error('Invalid harvest arm');
  if(input.harvestQuality!==undefined&&(!Number.isFinite(input.harvestQuality)||input.harvestQuality<-.5||input.harvestQuality>.5))throw Error('Invalid harvest quality');
  if(input.harvestScope!==undefined&&!['core','all','core-coverage'].includes(input.harvestScope))throw Error('Invalid harvest scope');
  if(input.harvestRetention!==undefined&&(!Number.isFinite(input.harvestRetention)||input.harvestRetention<0||input.harvestRetention>1||input.harvestRetention>0&&!(Number(input.harvestArm)>0)))throw Error('Invalid harvest retention');
  if(input.lossReleaseFraction!==undefined&&(!Number.isFinite(input.lossReleaseFraction)||input.lossReleaseFraction<0||input.lossReleaseFraction>1))throw Error('Invalid loss release fraction');
  if(input.lossReleaseQuality!==undefined&&(!Number.isFinite(input.lossReleaseQuality)||input.lossReleaseQuality<-.75||input.lossReleaseQuality>0))throw Error('Invalid loss release quality');
  if(input.policy==='static'||input.intensity===0)return {intents:r102333ProfitExits(snapshot,input.baseFraction,input.coverageFraction,input.maturityFraction,input.maturityWideProfitFraction??0),memory:{...priorMemory}};
  if(snapshot.market.sampleTerminal===true)return {intents:[] as StrategyIntent[],memory:{...priorMemory}};
  const fee=Number((snapshot.market.executionCapabilities as StrategyObject|undefined)?.commissionPerContract);
  if(!Number.isFinite(fee)||fee<0)throw Error('Adaptive exits require the actual closing commission');
  const current=Date.parse(snapshot.asOf),memory:StrategyObject={...priorMemory};
  if(!Number.isFinite(current))throw Error('Invalid adaptive as-of');
  const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
  const quality=clamp(input.quality,-1,1),intensity=input.intensity;
  const intents=snapshot.positions.map<StrategyIntent>(position=>{
    const id=String(position.id),credit=Number(position.creditReceived),mark=Number(position.markPnl),opened=Date.parse(String(position.openDate)),expiry=Date.parse(String(position.expiry));
    if(!(credit>0)||!Number.isFinite(mark)||!Number.isFinite(opened)||!Number.isFinite(expiry)||expiry<=opened||opened>current||position.quantity!==1||position.multiplier!==1)throw Error('Invalid adaptive position');
    const held=priorMemory[id] as StrategyObject|undefined;
    if(!held||!Number.isFinite(held.peakNet)||Number(held.peakNet)<0||typeof held.release!=='boolean')throw Error('Missing adaptive position memory');
    const net=mark-2*fee,peak=Math.max(Number(held.peakNet),net,0),daysLeft=Math.max(0,(expiry-current)/86400000);
    const maturity=id.startsWith('r9-maturity:'),coverage=id.startsWith('r9-coverage:'),base=maturity?(id.startsWith('r9-maturity:wide:')&&(input.maturityWideProfitFraction??0)>0?input.maturityWideProfitFraction!:input.maturityFraction):coverage?input.coverageFraction:input.baseFraction;
    let fraction=base,release=held.release,extended=held.extended===true;
    let lossMarketRelease=held.lossMarketRelease===true;
    if(held.lossMarketRelease!==undefined&&typeof held.lossMarketRelease!=='boolean')throw Error('Invalid owned market release');
    let harvestFloor=held.harvestFloor===undefined?undefined:Number(held.harvestFloor);
    if(harvestFloor!==undefined&&(!Number.isFinite(harvestFloor)||harvestFloor<.5))throw Error('Invalid owned harvest limit');
    const applies=input.scope==='all'||(!maturity&&!coverage);
    const qqq=snapshot.market.qqq as StrategyObject|undefined,chain=snapshot.market.chain as StrategyObject|undefined,spot=Number(qqq?.close??chain?.spot),short=Number(position.shortStrike);
    const distance=Number.isFinite(spot)&&spot>0&&Number.isFinite(short)&&Number.isFinite(input.vol)&&input.vol!>0
      ?(spot-short)/(spot*(input.vol!/100)*Math.sqrt(Math.max(1,daysLeft)/365)):Infinity;
    if(applies){
      if(input.policy==='quality'||input.policy==='combined'){
        // The initial target may increase before the parent 35% limit would fill.
        // Incomplete observations and weakening quality return to the exact parent limit.
        if(Number.isFinite(distance)&&distance>=.75&&daysLeft>=21&&quality>=(input.runnerQuality??.5))
          fraction=base+intensity*Math.max(0,(input.runnerCapture??.45)-base);
      }
      if(input.policy==='runner'){
        if(typeof held.extended!=='boolean')throw Error('Missing runner entry state');
        if(!extended&&Number.isFinite(distance)&&net>=credit*(input.runnerArm??.45)&&quality>=(input.runnerQuality??.5)&&daysLeft>=21&&distance>=.75)extended=true;
        if(extended&&(net<Math.max(credit*base,peak-credit*.10)||quality<.1||daysLeft<=14))release=true;
        fraction=extended?(input.runnerCapture??.65):base;
      }
    }
    const rotates=input.rotationScope===undefined?applies:input.rotationScope==='all'||(!maturity&&!coverage)||(input.rotationScope==='core-maturity'&&maturity)||(input.rotationScope==='core-coverage'&&coverage);
    if(rotates&&(input.policy==='rotation'||input.policy==='combined')){
        const fresh=input.opportunity,margin=Number(position.margin);
        if(!Number.isFinite(margin)||margin<=0)throw Error('Rotation requires observed position margin');
        const oldYield=Math.max(0,credit-net)/margin/Math.max(7,daysLeft);
        const newYield=fresh&&[fresh.credit,fresh.margin,fresh.days].every(Number.isFinite)&&fresh.credit>0&&fresh.margin>0&&fresh.days>0?fresh.credit/fresh.margin/Math.max(7,fresh.days):0;
        // Both yields are current quote proxies. They do not predict a future fill.
        // No quality or age shortcut: this branch isolates capital recycling.
        if(net>=Math.max(.5,credit*(input.recycleFraction??.25))&&newYield>oldYield*(input.rotationRatio??1.5)){release=true;harvestFloor=undefined;}
      }
    const harvestApplies=input.harvestScope==='all'||(!maturity&&!coverage)||(input.harvestScope==='core-coverage'&&coverage);
    const activeHarvestArm=maturity?(input.maturityHarvestArm??input.harvestArm??0):(input.harvestArm??0);
    const harvest=activeHarvestArm>0&&input.qualityObserved===true&&harvestApplies
      &&(current-opened)/86400000>=5&&quality<=(input.harvestQuality??0)
      &&peak>=credit*activeHarvestArm&&net>=.5;
    if(harvest){
      if(!release&&(input.harvestRetention??0)>0)harvestFloor=Math.max(.5,Math.min(credit*base,net*input.harvestRetention!));
      release=true;
    }
    const lossRelease=coverage&&(input.lossReleaseFraction??0)>0&&harvestApplies&&input.qualityObserved===true
      &&(current-opened)/86400000>=5&&quality<=(input.lossReleaseQuality??-.25)&&net<=-credit*input.lossReleaseFraction!&&peak>=credit*(input.harvestArm??0);
    if(lossRelease){release=true;lossMarketRelease=true;}
    if(!release&&peak>=credit*0.65&&net>=.5&&net<=peak*0.75){release=true;harvestFloor=Math.max(.5,net*1);}
    memory[id]={peakNet:peak,release,extended,...(harvestFloor===undefined?{}:{harvestFloor}),...(lossMarketRelease?{lossMarketRelease:true}:{})};
    return {kind:'close-position',key:`r10-profit:${id}:${snapshot.asOf}`,positionId:id,reason:lossMarketRelease?'r10-coverage-profit-giveback-market-close':harvest?'r10-positive-harvest-release':!applies||!release&&fraction===base?'r10-net-profit-target':release?'r10-adaptive-profit-release':`r10-adaptive-${input.policy}`,
      ...(lossMarketRelease?{}:{minimumUnweightedPnl:release?(harvestFloor??.5):fraction===base?credit*base:Math.max(.5,credit*clamp(fraction,.08,.85))})};
  });
  return {intents,memory};
}
export const R102333_DYNAMIC_POLICIES=['off','delta-term','quality-width','balanced'] as const;
export type R102333DynamicPolicy=typeof R102333_DYNAMIC_POLICIES[number];
/** Signal-time geometry only. Shadow positions are causal observations, never selected EPR holdings. */
export function r102333DynamicGeometry(input:{policy:R102333DynamicPolicy;intensity:number;baseDelta:number;baseWidth:number;baseDte:number;
  spot:number;vol?:number;realizedVol:number;roc5?:number;roc20?:number;term?:number;heldCount:number}){
  const {policy,intensity,baseDelta,baseWidth,baseDte}=input;
  if(!R102333_DYNAMIC_POLICIES.includes(policy)||![intensity,baseDelta,baseWidth,baseDte,input.heldCount].every(Number.isFinite)
    ||intensity<0||intensity>2||baseDelta<=0||baseDelta>.25||baseWidth<=0||baseWidth>150||!Number.isInteger(input.heldCount)||input.heldCount<0)throw Error('Invalid dynamic geometry inputs');
  const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
  if(policy==='off'||intensity===0)return {delta:baseDelta,width:baseWidth,dte:baseDte,quality:0,pressure:0};
  if(![input.spot,input.vol,input.realizedVol,input.roc5,input.roc20,input.term].every(v=>typeof v==='number'&&Number.isFinite(v))
    ||input.spot<=0||input.vol!<=0||input.realizedVol<0)return {delta:Math.min(baseDelta,.10),width:Math.min(baseWidth,10),dte:70,quality:-1,pressure:0};
  const quality=clamp(.5*Math.tanh(input.roc20!/.06)+.5*Math.tanh(input.roc5!/.025)-.5*Math.max(0,input.realizedVol/(input.vol!/100)-1),-1,1);
  const pressure=clamp((input.heldCount-6)/12,0,1);
  let delta=baseDelta,width=baseWidth,dte=baseDte;
  delta=clamp(baseDelta+.05*intensity*quality,.10,.25);
  if(['quality-width','balanced'].includes(policy))width=clamp(baseWidth*(1+.25*intensity*quality),12,25);
  if(input.vol!>=25&&quality>=.35&&input.term!>0)dte=63;
  if(input.vol!<=18&&quality>=.35&&input.term!>0)dte=75;
  if(policy==='balanced')width=clamp(width*(1-.2*pressure),10,25);
  return {delta,width,dte,quality,pressure};
}
/** Causal incremental return-on-risk proxy. It neither predicts fills nor
 * reads account collateral, completed trades or a book admission budget.
 */
export function r102333MaturityWidenScore(reference:PutCreditSpreadOpen,wider:PutCreditSpreadOpen,asOf:string,quality:number){
 if(reference.quantity!==1||wider.quantity!==1||reference.expiry!==wider.expiry||reference.shortStrike!==wider.shortStrike||!(wider.longStrike<reference.longStrike)||![reference.credit,wider.credit,reference.maxLoss,wider.maxLoss,quality].every(v=>typeof v==='number'&&Number.isFinite(v))||quality< -1||quality>1)throw Error('Invalid maturity widening quote pair');
 const days=(Date.parse(String(reference.expiry))-Date.parse(asOf))/86400000;
 if(!(days>0)||!Number.isFinite(days))throw Error('Invalid maturity widening as-of');
 const extraCredit=100*(Number(wider.credit)-Number(reference.credit)),extraRisk=Number(wider.maxLoss)-Number(reference.maxLoss),positiveQuality=Math.max(0,quality);
 if(extraCredit<=0||positiveQuality===0)return 0;
 return extraRisk<=0?Number.MAX_VALUE:extraCredit/extraRisk*365/days*positiveQuality;
}
/** Per-contract geometry, never current book collateral or an entry count. */
export function r102333CoverageWidth(parentWidth:number,maximumWidth:number){
 if(!Number.isFinite(parentWidth)||parentWidth<=0||parentWidth>150||!Number.isFinite(maximumWidth)||maximumWidth<0||maximumWidth>30)throw Error('Invalid role-specific coverage width');
 return maximumWidth>0?Math.min(parentWidth,maximumWidth):parentWidth;
}
export type R102333Profile={
 protectionCreditRetention?:number;protectionNarrowScope?:'all'|'core';
 profitFraction?:number;targetDelta?:number;rescueTargetDte?:number;coverageDelta?:number;coverageFraction?:number;
 fallbackMinimumDte?:number;fallbackDelta?:number;fallbackProfitFraction?:number;
 coverageMaximumSpreadWidth?:number;
 coreDeltaMode?:'native'|'fixed';maximumSpreadWidth?:number;dynamicPolicy?:R102333DynamicPolicy;intensity?:number;
 exitPolicy?:R102333ExitPolicy;exitIntensity?:number;exitScope?:'core'|'all';rotationScope?:'core'|'all'|'core-maturity'|'core-coverage';recycleFraction?:number;rotationRatio?:number;
 runnerCapture?:number;runnerArm?:number;runnerQuality?:number;coverageTargetDte?:number;
 fallbackVolAnchor?:number;fallbackVolPower?:number;maturityMaximumSpreadWidth?:number;maturityWidenMaximumWidth?:number;maturityWidenScoreFloor?:number;maturityWideProfitFraction?:number;fallbackDeltaMode?:'parent-bounded'|'independent'|'volatility-scaled';fallbackOrder?:'legacy'|'intermediate'|'long';harvestArm?:number;maturityHarvestArm?:number;harvestQuality?:number;harvestScope?:'core'|'all'|'core-coverage';harvestRetention?:number;lossReleaseFraction?:number;lossReleaseQuality?:number;
};
export const R102333_OBSERVATION_DTES=[28,35,42,56,63,70,75,90,105,120,135,150] as const;
export const R102333_RELEASE_PROFILE:Readonly<R102333Profile>=Object.freeze({protectionCreditRetention:.9,protectionNarrowScope:'all',dynamicPolicy:'balanced',intensity:1,harvestArm:.2,harvestRetention:1,harvestScope:'core-coverage',profitFraction:.4,fallbackDeltaMode:'volatility-scaled',fallbackDelta:.15,fallbackProfitFraction:.9,fallbackVolAnchor:35,maturityHarvestArm:.35,runnerCapture:.85,runnerQuality:.65,recycleFraction:.2,fallbackVolPower:1.375,maturityMaximumSpreadWidth:5,maturityWidenMaximumWidth:10,maturityWidenScoreFloor:.025,maturityWideProfitFraction:.9,coverageMaximumSpreadWidth:5,coverageTargetDte:90,coverageFraction:.35,rotationScope:'core-maturity'});
/** Current quote geometry only; never an account or inventory budget. */
export function r102333RecoveryNarrowAllowed(input:{core:boolean;maturity:boolean;restored:boolean;quality:number;carry:number}):boolean{
 const scope=input.core&&!input.maturity;
 const quality=true;
 return scope&&quality&&Number.isFinite(input.carry)&&input.carry>=.15&&input.carry<.225;
}

/** Causal market state only; no capital amounts, inventory or eventual outcome. */
export function r102333FloatingGuard(input:{core:boolean;restored:boolean;regime:string;roc5?:number;roc20?:number}):boolean{return input.core&&input.restored&&(input.regime==='RANGE_BOUND'&&(Number.isFinite(input.roc5)&&Number.isFinite(input.roc20)&&input.roc5!>0&&input.roc20!>0&&input.roc5!<input.roc20!*.25));}

export function createR102333Module():BarStrategyModule{
  const input:Readonly<R102333Profile>={...R102333_RELEASE_PROFILE};
  const protectionCreditRetention=input.protectionCreditRetention??0,protectionNarrowScope=input.protectionNarrowScope??'all';
  if(!Number.isFinite(protectionCreditRetention)||protectionCreditRetention!==0&&(protectionCreditRetention<.5||protectionCreditRetention>1)||!['all','core'].includes(protectionNarrowScope))throw Error('Invalid narrowing rule');
  if('maximumSelectedPolicyMargin' in input)throw Error('Selected-R aggregate margin cap has been removed');
  const {profitFraction=.35,targetDelta=.20,rescueTargetDte=70,coverageDelta=.075,coverageFraction=.35,
    fallbackMinimumDte=35,fallbackDelta=.075,fallbackProfitFraction=.85}=input;
  const minimumSignalCredit=1,maximumRelativeSpread=.5,widthBudget=30,protectionQuoteSpread=2,
    coverageMode:CoverageMode='term-normal',enableMaturityFallback=true,protectionWidthBudget=20;
  const geometry=input;
  const coverageMaximumSpreadWidth=input.coverageMaximumSpreadWidth??0;
  r102333CoverageWidth(20,coverageMaximumSpreadWidth);
  const maturityWidenMaximumWidth=input.maturityWidenMaximumWidth??0,maturityWidenScoreFloor=input.maturityWidenScoreFloor??0,maturityWideProfitFraction=input.maturityWideProfitFraction??0;
  if(!Number.isFinite(maturityWidenMaximumWidth)||maturityWidenMaximumWidth<0||maturityWidenMaximumWidth>30||!Number.isFinite(maturityWidenScoreFloor)||maturityWidenScoreFloor<0||maturityWidenScoreFloor>2||!Number.isFinite(maturityWideProfitFraction)||maturityWideProfitFraction<0||maturityWideProfitFraction>1)throw Error('Invalid observed quote-yield width/capture rule');
  const maturityMaximumSpreadWidth=input.maturityMaximumSpreadWidth??0;
  if(!Number.isFinite(maturityMaximumSpreadWidth)||maturityMaximumSpreadWidth<0||maturityMaximumSpreadWidth>30)throw Error('Invalid one-spread maturity width');
  if(maturityWidenMaximumWidth>0&&maturityWidenMaximumWidth<(maturityMaximumSpreadWidth||input.maximumSpreadWidth||20))throw Error('Wider protection maximum is below the narrow reference');
  const fallbackVolPower=input.fallbackVolPower??1;
  if(!Number.isFinite(fallbackVolPower)||fallbackVolPower<.25||fallbackVolPower>3)throw Error('Invalid maturity volatility exponent');
  const fallbackOrder=input.fallbackOrder??'legacy',fallbackDeltaMode=input.fallbackDeltaMode??'parent-bounded',fallbackVolAnchor=input.fallbackVolAnchor??25;
  if(!['parent-bounded','independent','volatility-scaled'].includes(fallbackDeltaMode)||!Number.isFinite(fallbackVolAnchor)||fallbackVolAnchor<15||fallbackVolAnchor>40)throw Error('Invalid maturity delta mode');
  if(!['legacy','intermediate','long'].includes(fallbackOrder))throw Error('Invalid causal maturity order');
  if(!Number.isFinite(profitFraction)||profitFraction<0||profitFraction>1||!Number.isFinite(targetDelta)||targetDelta<.03||targetDelta>.25||!Number.isFinite(minimumSignalCredit)||minimumSignalCredit<0||minimumSignalCredit>1000)throw Error('Invalid R10.2333 profit fraction');
  if(!Number.isFinite(maximumRelativeSpread)||maximumRelativeSpread<=0||maximumRelativeSpread>2)throw Error('Invalid quote spread bound');
  if(![28,35,42,56,63,70,75].includes(rescueTargetDte))throw Error('Unsupported research rescue maturity');
  if(!Number.isFinite(widthBudget)||widthBudget<0||widthBudget>30)throw Error('Invalid width budget');
  if(!Number.isFinite(protectionQuoteSpread)||protectionQuoteSpread<=0||protectionQuoteSpread>2)throw Error('Invalid protection quote tolerance');
  if(!Number.isFinite(coverageDelta)||coverageDelta<.03||coverageDelta>.15||!Number.isFinite(coverageFraction)||coverageFraction<=0||coverageFraction>1)throw Error('Invalid coverage policy');
  if(!['legacy','recovery','term-normal'].includes(coverageMode))throw Error('Invalid coverage mode');
  if(![35,42,56,63].includes(fallbackMinimumDte)||!Number.isFinite(fallbackDelta)||fallbackDelta<.03||fallbackDelta>.15||typeof enableMaturityFallback!=='boolean'||!Number.isFinite(fallbackProfitFraction)||fallbackProfitFraction<=0||fallbackProfitFraction>1)throw Error('Invalid maturity fallback policy');
  if(!Number.isFinite(protectionWidthBudget)||protectionWidthBudget<0||protectionWidthBudget>150)throw Error('Invalid protection search width budget');
  const coverageTargetDte=geometry.coverageTargetDte??120;
  if(![35,42,56,63,70,75,90,105,120,135,150].includes(coverageTargetDte))throw Error('Invalid coverage maturity');
  const coreDeltaMode=geometry.coreDeltaMode??'native',maximumSpreadWidth=geometry.maximumSpreadWidth??20;
  const dynamicPolicy=geometry.dynamicPolicy??'off',intensity=geometry.intensity??.5,captureBoost=0;
  const exitPolicy=geometry.exitPolicy??'combined',exitIntensity=geometry.exitIntensity??.5,exitScope=geometry.exitScope??'core';
  const recycleFraction=geometry.recycleFraction??.25,rotationRatio=geometry.rotationRatio??1.5;
  const rotationScope=geometry.rotationScope??exitScope;
  if(!['core','all','core-maturity','core-coverage'].includes(rotationScope))throw Error('Invalid rotation inventory scope');
  const maturityHarvestArm=input.maturityHarvestArm??input.harvestArm??0;
  if(!Number.isFinite(maturityHarvestArm)||maturityHarvestArm<0||maturityHarvestArm>.85||maturityHarvestArm>0&&!(Number(input.harvestArm)>0))throw Error('Invalid maturity harvest arm');
  const harvestArm=input.harvestArm??0,harvestQuality=input.harvestQuality??0,harvestScope=input.harvestScope??'core';
  if(!Number.isFinite(harvestArm)||harvestArm<0||harvestArm>.35||!Number.isFinite(harvestQuality)||harvestQuality<-.5||harvestQuality>.5||!['core','all','core-coverage'].includes(harvestScope))throw Error('Invalid harvest profile');
  if(harvestArm>0&&(exitPolicy==='static'||exitIntensity===0))throw Error('Harvest requires adaptive exit state');
  const lossReleaseFraction=input.lossReleaseFraction??0,lossReleaseQuality=input.lossReleaseQuality??-.25;
  if(!Number.isFinite(lossReleaseFraction)||lossReleaseFraction<0||lossReleaseFraction>1||!Number.isFinite(lossReleaseQuality)||lossReleaseQuality<-.75||lossReleaseQuality>0||lossReleaseFraction>0&&(harvestArm===0||harvestScope==='core'))throw Error('Invalid coverage loss release profile');
  const harvestRetention=input.harvestRetention??0;
  if(!Number.isFinite(harvestRetention)||harvestRetention<0||harvestRetention>1||harvestRetention>0&&harvestArm===0)throw Error('Invalid harvest retention profile');
  const runnerCapture=geometry.runnerCapture??.65,runnerArm=geometry.runnerArm??.45,runnerQuality=geometry.runnerQuality??.5;
  if(!Number.isFinite(runnerCapture)||runnerCapture<.35||runnerCapture>.85||!Number.isFinite(runnerArm)||runnerArm<.35||runnerArm>.75||!Number.isFinite(runnerQuality)||runnerQuality<0||runnerQuality>1)throw Error('Invalid runner bounds');
  if(!Number.isFinite(recycleFraction)||recycleFraction<.1||recycleFraction>.35||!Number.isFinite(rotationRatio)||rotationRatio<1||rotationRatio>3)throw Error('Invalid calibrated exit bounds');
  if(!R102333_EXIT_POLICIES.includes(exitPolicy)||!Number.isFinite(exitIntensity)||exitIntensity<0||exitIntensity>1||!['core','all'].includes(exitScope))throw Error('Invalid adaptive exit policy');
  if(exitPolicy!=='static'&&captureBoost!==0)throw Error('Adaptive exit replaces the legacy capture boost');
  if(!Number.isFinite(captureBoost)||captureBoost<0||captureBoost>.15)throw Error('Invalid dynamic capture boost');
  if(!R102333_DYNAMIC_POLICIES.includes(dynamicPolicy)||!Number.isFinite(intensity)||intensity<0||intensity>2)throw Error('Invalid dynamic geometry policy');
  if(!['native','fixed'].includes(coreDeltaMode)||!Number.isFinite(maximumSpreadWidth)||maximumSpreadWidth<0||maximumSpreadWidth>150)throw Error('Invalid R10.2333 geometry');
  const marketRules=Object.fromEntries(Object.entries(R9_E226_PARAMS).filter(([key])=>!['riskBudgetNav','retryRiskCap'].includes(key))) as StrategyObject;
  const defaults:StrategyObject=freezeStrategyData({...marketRules,
    maturityRiskPolicy:{"parent":"R10.2301","guard":"coverage-quality","maximumDelta":0.1,"maximumWidth":null,"targetDte":null,"takeProfit":null,"notAccountBudget":true,"noDateFilter":true},floatingAvoidancePolicy:{"parent":"R10.2286","guard":"range-weak-quarter","action":"block","maximumWidth":null,"maximumDelta":null,"targetDte":null,"notAccountBudget":true,"exitAlgorithm":"exact2286","noDateFilter":true},recoveryHybridPolicy:{"parent":"R10.1974","coreNarrowReference":"R10.2268","maturityCarryReference":"R10.2253","maturityCarry":0.15,"coreCarry":0.225,"coreCreditRetention":0.65,"notAccountBudget":true,"exitAlgorithm":"exact1974","notAdditivePnL":true},recoveryGeometryPolicy:{"parent":"R10.1974","retention":0.65,"scope":"core","gate":"none","carryBand":[0.15,0.225],"finalCarryFloor":0.225,"notAccountBudget":true,"exitAlgorithm":"exact1974"},ladderPolicy:{"parent":"R10.1477","id":"R10.2333","generation":17,"stage":11,"carry":0.225,"releaseDecay":null,"stressCarry":null,"stressRetention":null,"stressGuard":"vol35","stressArm":null,"notAccountBudget":true},riskReleasePolicy:{family:'global-positive-peak',entryCreditRatioBelow:0,ageCalendarDays:0,positiveCaptureCap:0,globalPeakArm:0.65,givebackFraction:0.75,triggerProfitRetention:1,scope:'positive-exit-limits-only; no order sizing or monetary admission budget'},quoteCarryAdmission:{threshold:0.225,scope:'all',basis:'signal-credit-per-quoted-maxloss-per-actual-days',exitOpportunity:'unchanged-before-admission-filter',notAccountBudget:true},restoredPositivePolicy:{enabled:true,peakArm:0,givebackFraction:0.5,triggerProfitRetention:0.5,geometry:'none',safeQuoteGuardBasis:'reference-contract-quality-before-substitution',safeDeltaMaximum:.075,safeWidthMaximum:5,safeExpiry:'same-as-reference',safePairCreditRule:'minimum-positive-fee-adjusted-quote; no90percent-reference-credit-guarantee'},unitQuoteOnlyRescue:true,additionalEntryRisk:'restored-parent-unchanged',unitEntryFilter:'price-dual-positive-extension-credit2',sourceNavScope:'legacy-main-observation-only;not-traded-R',RExecutionRetry:'exact-signal-pair-only',protectionCreditRetention,protectionNarrowScope,lineage:{parent:'R10.2301',artifact:'r10-2333-standalone-v1',admissionSource:'R9.E226',comparedWith:'R10.95/E9230/P11262',researchAlias:'restore-0',researchFamily:'numbered-R10.104-descendants',id:'R10.2333'},mainPcs:{...R9_MAIN_PCS_CONTRACT},coverageTargetDte,coverageMaximumSpreadWidth,coverageWidthPolicy:'regular-coverage-only-contract-width; zero-keeps-parent; maturity-and-core-own-geometry; no-book-budget',requiredPutTargetDtes:[...R102333_OBSERVATION_DTES],fallbackOrder,fallbackDeltaMode,fallbackVolAnchor,fallbackVolPower,maturityMaximumSpreadWidth,maturityWidenMaximumWidth,maturityWidenScoreFloor,maturityWideProfitFraction,maturityWidenPolicy:'same-short-expiry; additional-signal-credit-over-additional-quoted-max-loss-per-year-times-positive-asof-quality; unobserved-quality-retains-narrow; no-book-budget',maturityWideExitPolicy:'entry-owned-wide-tag-profit-fraction; zero-inherits-maturity-parent',maturityWidthPolicy:'only-fallback-selected-put-protection-width; zero-inherits-parent; no-book-admission-budget',maturityDeltaPolicy:'clamp-baseDelta-times-observed-primary-vol-over-anchor-to-power; .03-to-.15',maturityHarvestArm,harvestArm,harvestQuality,harvestScope,harvestRetention,lossReleaseFraction,lossReleaseQuality,lossReleasePolicy:'regular-coverage-only; observed-loss-threshold-after-positive-peak; unconditional-next-open-market-close; actual-loss-not-bounded-by-trigger',harvestProfitFloorPolicy:'anchor-to-observed-net-profit-on-first-harvest-signal; parent-rotation-may-exit-at-own-floor',harvestObservation:'owned-close-mark-peak-and-observed-market-quality',harvestTiming:'asof-signal-next-open-net-positive-limit',runnerCapture,runnerArm,runnerQuality,recycleFraction,rotationRatio,rotationScope,opportunityProxy:'current-signal-net-credit-per-quoted-max-loss-per-day-versus-held-remaining-credit-per-observed-margin-per-day',exitPolicy,exitIntensity,exitScope,exitTiming:'close-observation-then-next-open-positive-net-profit-limit',exitMemory:'actual-own-shadow-open-position-peak-net-after-close-fees-and-latched-release',minimumReleaseNetProfit:.5,dynamicPolicy,intensity,captureBoost,capturePolicy:'current-asof-positive-quality-core-only',positionPressureScope:'independent-R-shadow-asof-only',dynamicObservation:'native-asof-vol-trend-and-own-shadow-positions',coreDeltaMode,maximumSpreadWidth,protectionWidthBudget,selectedPolicyMarginLimit:null,marginCapScope:'none-report-only',protectionPolicy:'same-signal-short-and-expiry-farther-long-only',protectionSizing:'one-unit-quote-geometry;no-NAV-budget;exact-saved-pair',
    positionMode:'independent-one-contract',exitMode:profitFraction===0?'hold-to-expiry':'daily-next-open-net-profit-limit',
    sourceNav:'legacy-main-observations-only;R-entry-no-NAV',sampleExecution:'adapter-owned',fillRetryVersion:'none-exact-signal-pair',
    admission:'parent-core-plus-term-normal-low-delta-coverage-with-mandatory-data-and-hard-risk-gates',contractSelection:'nearest-original-delta-feasible-fee-credit-within-delta-and-native-width-bounds',
    closingCommissionMode:R102333_CLOSING_COMMISSION_MODE,fallbackMinimumDte,fallbackDelta,enableMaturityFallback,fallbackProfitFraction,coverageMode,coverageDelta,coverageFraction,mandatoryUpstream:[...mandatoryUpstream],profitFraction,targetDelta,minimumSignalCredit,maximumRelativeSpread,rescueTargetDte,widthBudget,protectionQuoteSpread,fillFallbackQuotes:'strict-pair-parent-preserving',
    creditFloorObservation:'signal-close-net-after-both-opening-leg-fees'});
  const n=(o:Readonly<StrategyObject>,key:string)=>typeof o[key]==='number'?Number(o[key]):undefined;
  const object=(value:unknown,label:string):StrategyObject=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Missing R9 ${label}`);
    return value as StrategyObject;
  };
  /** The native independent PCS/Rescue books never credit option profits to stock NAV. */
  function r9NativeStockNav(native:Readonly<StrategyObject>){
    const nav=Number(object(native.stockAccount,'stock account').netLiquidation);
    if(!Number.isFinite(nav)||nav<=0)throw new Error('Invalid R9 current stock NAV');return nav;
  }
  function r9CurrentCoordinates(native:Readonly<StrategyObject>,includeAdmission=true){
    const c=object(native.marketContext,'current context'),macro=object(native.macro,'macro');
    if(typeof c.regime!=='string')throw new Error('Missing R9 regime');
    const coordinates=resolveVolatilityCoordinates(macro,{positiveVixRequired:true,rawTermFallback:true});
    const primary=coordinates.primaryVol,term=coordinates.primaryVol3m,change=coordinates.primaryChange5d;
    const facts=projectNativeMarketFacts(c,n);
    const market:R9E226Market={regime:c.regime,slowSubregime:typeof c.slowSubregime==='string'?c.slowSubregime:undefined,
      vix:facts.vix??primary,vix3m:term,primaryTermSlope:primary!==undefined&&term!==undefined?term-primary:undefined,
      rv20:facts.tqqqRealisedVol20d,adx14:facts.adx14,trendScore:facts.trendScore,sma200Pct:facts.priceVsSma200Pct,
      priceExtensionAtr:facts.priceExtensionAtr,regimePriceExtensionAtr:facts.priceExtensionAtr,
      range20dPct:facts.range20dPct,roc5:facts.roc5,roc20:facts.roc20,er20:facts.qqqEr20,rsi14:facts.rsi14,
      weakeningCount:facts.weakeningSignalCount,ma50SlopePct:facts.ma50SlopePct,
      drawdownFromRecentHighPct:facts.drawdownFromRecentHighPct,vixChange5d:change,regimeVixChange5d:facts.vixChange5d};
    if(includeAdmission){market.versionPressure=isPcsV12GateBlocked({enabled:true,v11ReleaseMode:'rv20_lt_067_or_sr02_adx20',
      regime:market.regime,slowSubregime:market.slowSubregime,vix:market.vix,adx14:market.adx14,
      tqqqRealisedVol20d:market.rv20,priceVsSma200Pct:market.sma200Pct,range20dPct:market.range20dPct,
      priceExtensionAtr:market.priceExtensionAtr,roc5:market.roc5,roc20:market.roc20,rsi14:market.rsi14,
      weakeningSignalCount:market.weakeningCount,drawdownFromRecentHighPct:market.drawdownFromRecentHighPct});
    market.preCrisisActive=isCallCreditSpreadPreCrisis({regime:market.regime,vix:primary,
      tqqqRealisedVol20d:market.rv20,tqqqRoc20:facts.tqqqRoc20});}
    return {market,primaryVol:primary,primaryVol3m:term};
  }
  const contract=(expiry:string,shortStrike:number,longStrike:number,targetDte:number):StrategyObject=>({symbol:'QQQ',type:'put',
    expiry,shortStrike,longStrike,targetDte});
  return {
    // Adaptive memory belongs to this returned strategy state and follows actual owned source feedback.
    manifest:{sdkVersion:2,id:'R10.2333',version:'r10-2333-standalone-v1',researchOnly:true,
      migration:{complete:true,missing:[]}},params:defaults,
    initialize(params){assertFixedStrategyParams(params,defaults);
      return (exitPolicy==='static'?{}:{exitMemory:{}}) as StrategyObject;},
    onFeedback({state,params,feedback}){
      assertFixedStrategyParams(params,defaults);
      const id=String(feedback.payload.sourceAccount);
      if(!['portfolio',R9_E226_SOURCE_CONTRACT.contextSource].includes(id))throw new Error('Unknown R9 feedback source');
      settledFeedbackPnl(feedback);
      if(exitPolicy==='static')return {};
      if(id!=='portfolio')return state;
      const memory={...((state as StrategyObject).exitMemory as StrategyObject)};
      const positionId=String(feedback.payload.positionId);
      if(feedback.kind==='fill'){
        if(!positionId||positionId==='undefined'||feedback.payload.quantity!==1||feedback.payload.multiplier!==1||Object.hasOwn(memory,positionId))throw Error('Invalid adaptive owned fill');
        memory[positionId]={peakNet:0,release:false,extended:false};
      }else if(feedback.kind==='close'||feedback.kind==='settle'){
        if(!Object.hasOwn(memory,positionId))throw Error('Missing adaptive closing feedback ownership');
        delete memory[positionId];
      }
      return {exitMemory:memory};
    },
    planObservations({params,nativeState,annualizedQqqRv20,sourceId}){
      assertFixedStrategyParams(params,defaults);
      if(sourceId!==R9_E226_SOURCE_CONTRACT.contextSource)return null;
      const coordinates=r9CurrentCoordinates(nativeState,false),p=R9_MAIN_PCS_CONTRACT;
      const stressed=r9MainPcsStress({regime:coordinates.market.regime,...coordinates,annualizedQqqRv20});
      return {widths:[p.widthPct],sigmas:stressOnlyPcsSelectionProfile(stressed).candidateSigmas,targetDte:p.targetDte,
        nav:r9NativeStockNav(nativeState),riskBudget:p.riskBudgetNav,forceMinimumContract:p.forceMinimumContract,includeTail:false};
    },
    onBar({state:priorState,params,snapshot}){
      assertFixedStrategyParams(params,defaults);
      if((snapshot.market.executionCapabilities as StrategyObject|undefined)?.closingCommissionMode!==R102333_CLOSING_COMMISSION_MODE)
        throw Error('R10.2333 requires the declared account-default closing commission contract');
      if(coverageTargetDte>75&&(snapshot.market.executionCapabilities as StrategyObject).putMaturityMode!=='extended-365-v1')throw Error('Extended coverage maturity capability required');
      const dtes=(snapshot.market.executionCapabilities as StrategyObject).putTargetDtes;
      if(!Array.isArray(dtes)||![...R102333_OBSERVATION_DTES,Number(params.rescueTargetDte),coverageTargetDte,...(dynamicPolicy==='off'?[]:[63,70,75])].every(d=>dtes.includes(d)))throw Error('R10.2333 requires its declared put maturity observation and execution capability');
      let state:StrategyObject=exitPolicy==='static'?{}:priorState as StrategyObject;
      const source=object(object(snapshot.market.sourceAccounts,'source observations')[R9_E226_SOURCE_CONTRACT.contextSource],'PCS source');
      const facts=object(source.market,'source market'),native=object(facts.nativeState,'native observation');
      const trace=createAdmissionTrace(['上游数据','原有机会池准入','原有低波动风控','原有救援合约','原有同日优先级']);
      let exits:StrategyIntent[]=[];
      const updateExits=(quality:number,vol?:number,opportunity?:{credit:number;margin:number;days:number},qualityObserved=false)=>{
        const response=r102333AdaptiveExits(snapshot,exitPolicy==='static'?{}:((priorState as StrategyObject).exitMemory as StrategyObject),{
          policy:exitPolicy,intensity:exitIntensity,scope:exitScope,rotationScope,quality,vol,harvestArm,maturityHarvestArm,harvestQuality,harvestScope,harvestRetention,lossReleaseFraction,lossReleaseQuality,qualityObserved,recycleFraction,rotationRatio,runnerCapture,runnerArm,runnerQuality,opportunity,baseFraction:Number(params.profitFraction),coverageFraction,maturityFraction:fallbackProfitFraction,maturityWideProfitFraction});
        exits=response.intents;state=exitPolicy==='static'?{}:{exitMemory:response.memory};
      };
      updateExits(0);
      const none=(reason:string)=>({state,intents:exits,plots:{reason,gates:trace.gates}});
      if(native.available===false)return none('native-warmup-unavailable');
      const upstream=object(native.upstreamStatuses,'upstream statuses');
      trace.check(0,!Object.values(upstream).some(s=>s==='BLOCK'||s==='ERROR'),'上游观测与数据质量检查');
      const legacyUpstreamBlocked=Object.values(upstream).some(s=>s==='BLOCK'||s==='ERROR');
      if(r102333MandatoryBlocked(upstream))return none('upstream-block');
      const coordinates=r9CurrentCoordinates(native),{market,primaryVol,primaryVol3m}=coordinates;
      const quoteFee=Number((snapshot.market.executionCapabilities as StrategyObject).commissionPerContract);
      // Reactive PCS timing uses raw VIX/VIX3M; VXN-derived term belongs to contract selection.
      const macro=object(native.macro,'macro');
      const admission=r9E226SourceAdmission({market,macroVix:n(macro,'vix'),macroVix3m:n(macro,'vix3m'),
        crisisPhase:String(native.crisisPhase),backwardation:primaryVol!==undefined&&primaryVol3m!==undefined&&primaryVol3m<primaryVol,
        hasOpenCollar:false,collarTriggered:false});
      const analytics=object(facts.pcsAnalytics,'PCS analytics');
      if(!Array.isArray(analytics.candidates))throw new Error('Missing R9 analytical candidates');
      const main=selectR9MainPcs({...coordinates,originalSignal:admission.originalSignal,
        annualizedQqqRv20:Number(analytics.annualizedQqqRv20),candidates:analytics.candidates as unknown as PcsAnalyticalProbe[]});
      const lowRvBlocked=r9E226LowRvBlocked(market);
      const built=!legacyUpstreamBlocked&&admission.sourceActive&&!lowRvBlocked
        ? buildQuoteOnlyRRescue({chain:snapshot.market.chain as unknown as OptionChain,asOf:snapshot.asOf,market,fee:quoteFee}):null;
      const rescue=built?.selected;
      const priority=r9E226ProposalPriority({market,sourceActive:admission.sourceActive,
        mainPcsProposalBuilt:!!main.selected,rescueProposalBuilt:!!rescue});
      const fee=Number((snapshot.market.executionCapabilities as StrategyObject).commissionPerContract),minimum=Number(params.minimumSignalCredit);
      if(!Number.isFinite(fee)||fee<0)throw Error('R10.2333 requires the actual account commission');
      const restoredPositive=!admission.originalSignal&&Number.isFinite(market.roc5)&&market.roc5!>0&&Number.isFinite(market.roc20)&&market.roc20!>0;
      const core=!legacyUpstreamBlocked&&admission.sourceActive&&!!rescue&&(!admission.originalSignal||admission.complement||r9E226DualMainQuality(market));
      const coverage=!core&&r102333CoverageAllowed({mode:coverageMode,legacySafe:!legacyUpstreamBlocked&&admission.safety&&admission.softTiming,
        upstream,regime:market.regime,crisisPhase:String(native.crisisPhase),primary:primaryVol,primary3m:primaryVol3m,
        macroVix:n(macro,'vix'),macroVix3m:n(macro,'vix3m'),roc5:market.roc5,roc20:market.roc20});
      const coverageBuilt=coverage?buildQuoteOnlyRRescue({chain:snapshot.market.chain as unknown as OptionChain,asOf:snapshot.asOf,market,fee:quoteFee}):null;
      const floatingParentGeometry=r102333DynamicGeometry({policy:dynamicPolicy,intensity,baseDelta:Number(params.targetDelta),baseWidth:maximumSpreadWidth||protectionWidthBudget,
        baseDte:Number(params.rescueTargetDte),spot:Number((snapshot.market.chain as StrategyObject).spot),vol:primaryVol,
        realizedVol:Number(analytics.annualizedQqqRv20),roc5:market.roc5,roc20:market.roc20,term:primaryVol!==undefined&&primaryVol3m!==undefined?primaryVol3m/primaryVol-1:undefined,heldCount:snapshot.positions.length});
      // FLOATING_ENTRY_BEGIN
      const floatingRiskGuard=r102333FloatingGuard({core,restored:restoredPositive,regime:market.regime,roc5:market.roc5,roc20:market.roc20});
      const dynamic=floatingRiskGuard?floatingParentGeometry:floatingParentGeometry;
      // FLOATING_ENTRY_END
      const harvestObserved=[primaryVol,primaryVol3m,Number(analytics.annualizedQqqRv20),market.roc5,market.roc20].every(v=>typeof v==='number'&&Number.isFinite(v))&&Number(primaryVol)>0&&Number(primaryVol3m)>0;
      const exitQuality=r102333DynamicGeometry({policy:'delta-term',intensity:1,baseDelta:Number(params.targetDelta),baseWidth:maximumSpreadWidth||protectionWidthBudget,baseDte:Number(params.rescueTargetDte),spot:Number((snapshot.market.chain as StrategyObject).spot),vol:primaryVol,realizedVol:Number(analytics.annualizedQqqRv20),roc5:market.roc5,roc20:market.roc20,term:primaryVol!==undefined&&primaryVol3m!==undefined?primaryVol3m/primaryVol-1:undefined,heldCount:snapshot.positions.length}).quality;
      updateExits(exitQuality,primaryVol,undefined,harvestObserved);
      if(dynamicPolicy!=='off'&&captureBoost>0)exits=r102333ProfitExits(snapshot,Math.min(1,Number(params.profitFraction)+captureBoost*Math.max(0,dynamic.quality)),coverageFraction,fallbackProfitFraction);
      const strictWidth=(width:number)=>dynamic.width>0?Math.min(width,dynamic.width):width;
      const activeDte=coverage?coverageTargetDte:dynamic.dte;
      const bounds=core?{maximumShortDelta:dynamic.delta,targetShortDelta:coreDeltaMode==='fixed'?dynamic.delta:Math.min(built!.attempts[0]!.delta,dynamic.delta),
        maximumWidth:strictWidth(Number(params.widthBudget)),
        minimumNetCredit:minimum,commissionPerContract:fee,maximumRelativeSpread:Number(params.maximumRelativeSpread)}
        :coverage?{maximumShortDelta:coverageDelta,targetShortDelta:Math.min(coverageBuilt!.attempts[0]!.delta,coverageDelta),
          maximumWidth:r102333CoverageWidth(strictWidth(Number(params.widthBudget)),coverageMaximumSpreadWidth),minimumNetCredit:minimum,
          commissionPerContract:fee,maximumRelativeSpread:Number(params.maximumRelativeSpread)}:undefined;
      if(bounds&&(admission.originalSignal||primaryVol!==undefined&&primaryVol>=35)){bounds.maximumShortDelta=Math.min(bounds.maximumShortDelta,0.075);bounds.targetShortDelta=Math.min(bounds.targetShortDelta,0.075);bounds.maximumWidth=Math.min(bounds.maximumWidth,5);}
      const parentChosen=bounds?selectAsymmetricPutSpread(snapshot.market.chain as unknown as OptionChain,snapshot.asOf,activeDte,bounds,Number(params.protectionQuoteSpread)):undefined;
      // MATURITY_RISK_WIDTH_BEGIN
      const maturityRiskGuard=coverage&&Number.isFinite(exitQuality)&&exitQuality<=0;
      const maturityRiskParentWidth=maturityMaximumSpreadWidth>0?Math.min(dynamic.width,maturityMaximumSpreadWidth):dynamic.width;
      const maturityWidth=maturityRiskGuard?maturityRiskParentWidth:maturityRiskParentWidth;
      // MATURITY_RISK_WIDTH_END
      const maturityBounds=bounds?r102333MaturityDeltaBounds(bounds,fallbackDelta,fallbackDeltaMode,primaryVol,fallbackVolAnchor,fallbackVolPower):undefined;
      // MATURITY_RISK_DELTA_BEGIN
      if(maturityRiskGuard&&maturityBounds){maturityBounds.maximumShortDelta=Math.min(maturityBounds.maximumShortDelta,0.1);maturityBounds.targetShortDelta=Math.min(maturityBounds.targetShortDelta!,0.1);}
      // MATURITY_RISK_DELTA_END
      if(maturityBounds&&(admission.originalSignal||primaryVol!==undefined&&primaryVol>=35)){maturityBounds.maximumShortDelta=Math.min(maturityBounds.maximumShortDelta,0.075);maturityBounds.targetShortDelta=Math.min(maturityBounds.targetShortDelta!,0.075);}
      const maturityFallback=!parentChosen&&maturityBounds&&enableMaturityFallback?r102333SelectMaturityFallback(snapshot.market.chain as unknown as OptionChain,snapshot.asOf,fallbackMinimumDte,
        {...maturityBounds,
          maximumWidth:Math.min(strictWidth(Number(params.widthBudget)),maturityWidth)},Number(params.protectionQuoteSpread),!coverage||fallbackOrder==='legacy'?[63,56,42,35]:fallbackOrder==='intermediate'?[90,75,70,63,56,42,35]:[105,90,75,70,63,56,42,35]):undefined;
      const reference=parentChosen??maturityFallback?.contract;
      const activeProtectionWidth=(admission.originalSignal||primaryVol!==undefined&&primaryVol>=35)?5:maturityFallback?maturityWidth:coverage?r102333CoverageWidth(dynamic.width,coverageMaximumSpreadWidth):dynamic.width;
      const wider=reference&&activeProtectionWidth>0?r102333WidenProtection(snapshot.market.chain as unknown as OptionChain,reference,Math.min(Math.max(activeProtectionWidth,reference.shortStrike-reference.longStrike),activeProtectionWidth),fee):undefined;
      const narrowChosen=wider??reference;
      const maturityWide=!!maturityFallback&&maturityWidenMaximumWidth>0&&narrowChosen&&harvestObserved
        ?r102333WidenProtection(snapshot.market.chain as unknown as OptionChain,narrowChosen,Math.min(dynamic.width,maturityWidenMaximumWidth,(admission.originalSignal||primaryVol!==undefined&&primaryVol>=35)?5:Infinity),fee):undefined;
      const wideningScore=maturityWide&&narrowChosen?r102333MaturityWidenScore(narrowChosen,maturityWide,snapshot.asOf,exitQuality):0;
      const wideAccepted=!!maturityWide&&wideningScore>0&&wideningScore>=maturityWidenScoreFloor;
      const parentFinal=wideAccepted?maturityWide!:narrowChosen;
      const effectiveProtectionRetention=protectionCreditRetention;
      const protectedPair=parentFinal&&protectionCreditRetention>0&&(protectionNarrowScope==='all'||core&&!maturityFallback)?narrowCreditProtection(snapshot.market.chain as unknown as OptionChain,parentFinal,effectiveProtectionRetention,fee):undefined;
      // RECOVERY_GEOMETRY_BEGIN
      const recoveryReference=protectedPair??parentFinal;
      const recoveryDays=recoveryReference?(Date.parse(recoveryReference.expiry)-Date.parse(snapshot.asOf))/86400000:NaN;
      const recoveryCarry=recoveryReference&&Number(recoveryReference.maxLoss)>0&&recoveryDays>0?(100*Number(recoveryReference.credit)-2*fee)/Number(recoveryReference.maxLoss)/recoveryDays*365:NaN;
      const recoveryNarrowAllowed=r102333RecoveryNarrowAllowed({core,maturity:!!maturityFallback,restored:restoredPositive,quality:exitQuality,carry:recoveryCarry});
      const recoveryNarrow=parentFinal&&recoveryNarrowAllowed?narrowCreditProtection(snapshot.market.chain as unknown as OptionChain,parentFinal,0.65,fee):undefined;
      const chosen=recoveryNarrow??recoveryReference,selectedDte=maturityFallback?.targetDte??activeDte;
      // RECOVERY_GEOMETRY_END
      const opportunity=chosen?{credit:100*Number(chosen.credit)-2*fee,margin:Number(chosen.maxLoss),days:(Date.parse(chosen.expiry)-Date.parse(snapshot.asOf))/86400000}:undefined;
      if(exitPolicy==='rotation'||exitPolicy==='combined')updateExits(exitQuality,primaryVol,opportunity,harvestObserved);
      const priceEntryAllowed=rCoreEntrySignalAllowed('not-price-dual-positive-extension',{originalSignal:admission.originalSignal,dualQuality:r9E226DualMainQuality(market),priceExtensionAtr:market.priceExtensionAtr});
      const signalWidth=chosen?Number(chosen.shortStrike)-Number(chosen.longStrike):NaN;
      const signalRatio=chosen&&signalWidth>0?(100*Number(chosen.credit)-2*fee)/(100*signalWidth):NaN;
      const quoteEntryAllowed=(!core||!!maturityFallback||Number.isFinite(signalRatio)&&signalRatio>=.02);
      const quotedDays=chosen?(Date.parse(chosen.expiry)-Date.parse(snapshot.asOf))/86400000:NaN;
      const quotedCarry=chosen&&Number(chosen.maxLoss)>0&&quotedDays>0?(100*Number(chosen.credit)-2*fee)/Number(chosen.maxLoss)/quotedDays*365:NaN;
      const hybridCarryThreshold=maturityFallback?0.15:.225;
      const carryEntryAllowed=Number.isFinite(quotedCarry)&&quotedCarry>=hybridCarryThreshold;
      const creditAllowed=(!floatingRiskGuard||!!maturityFallback)&&!!chosen&&priceEntryAllowed&&quoteEntryAllowed&&carryEntryAllowed&&((!admission.originalSignal&&((Number.isFinite(market.roc5)&&market.roc5!<=0)||(Number.isFinite(market.roc20)&&market.roc20!<=0)||restoredPositive))||(admission.originalSignal&&(Number.isFinite(market.priceExtensionAtr)&&market.priceExtensionAtr!<=0)));
      trace.check(1,admission.sourceActive,`safety=${admission.safety}; scope=${admission.scope}; complement=${admission.complement}`);
      if(admission.sourceActive){
        trace.check(2,!lowRvBlocked,lowRvBlocked?'低波动风险阻断':'低波动风控通过');
        if(!lowRvBlocked){
          trace.check(3,!!rescue&&creditAllowed,rescue?`信号时费后信用金下限 ${minimum}; passed=${creditAllowed}`:'救援候选不可构建');
          if(rescue&&creditAllowed)trace.check(4,priority.rescue,`main=${priority.main}; rescue=${priority.rescue}; dual=${priority.dual}`);
        }
      }
      const intents:StrategyIntent[]=[...exits];
      const risk=(sourceAccount:string):StrategyObject=>({sourceAccount,multiplier:1,quantity:1,
        ratioMin:0,ratioMax:Number.MAX_VALUE,entrySource:sourceAccount==='portfolio'?'r9-rescue':'r9-main-pcs'});
      if(!legacyUpstreamBlocked&&priority.main&&main.selected)intents.push({kind:'open-spread',key:`r9-main:${snapshot.asOf}`,
        contract:contract(main.selected.expiry,main.selected.shortStrike,main.selected.longStrike,R9_MAIN_PCS_CONTRACT.targetDte),risk:risk(R9_E226_SOURCE_CONTRACT.contextSource)});
      if((core||coverage)&&creditAllowed){
        const {shortStrike:short,longStrike:long,expiry}=chosen!;
        if(short===undefined||long===undefined||!expiry)throw new Error('Incomplete R9 rescue contract');
        // Exact saved pair only: no legacy NAV/riskBudget retry payload.
        intents.push({kind:'open-spread',key:`${(maturityFallback?(wideAccepted?'r9-maturity:wide':'r9-maturity'):coverage?'r9-coverage':'r9-rescue')+(restoredPositive?':restored-positive':'')}:${snapshot.asOf}`,contract:contract(expiry,short,long,selectedDte),
          risk:risk('portfolio')});
      }
      return {state,intents,plots:{reason:(core||coverage)?creditAllowed?'rescue-admitted':'r10-87-parent-credit-below-fees-floor':main.reason,
        quotedCarry:Number.isFinite(quotedCarry)?quotedCarry:null,maturityRiskGuard,floatingRiskGuard,hybridCarryThreshold,recoveryNarrowAllowed,recoveryCarry:Number.isFinite(recoveryCarry)?recoveryCarry:null,carryEntryAllowed,restoredPositive,riskRouteWanted:false,positiveRiskRouted:false,unitQuoteOnlyRescue:true,priceEntryAllowed,quoteEntryAllowed,dynamicGeometry:{...dynamic,policy:dynamicPolicy,intensity},sourceActive:admission.sourceActive,lowRvBlocked,...priority,coverage,maturityFallback:!!maturityFallback,selectedDte,legacyUpstreamBlocked,coverageMode,coverageAdmission:coverage?coverageMode:'inactive',coverageContractAllowed:coverage&&creditAllowed,creditAllowed,gates:trace.gates}};
    },
  };

}
export const r102333StandaloneV1=createR102333Module();
