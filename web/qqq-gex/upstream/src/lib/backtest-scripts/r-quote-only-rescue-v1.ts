/** Unit-quantity quote construction. No NAV, cash, collateral or inventory inputs. */
import type {OptionChain} from '../engines/leveraged-overlay/types/input';
import {resolvePcsRescueShortDelta,resolvePcsRescueExtremeWidth} from './put-spread-kernel-v6';
import {selectAsymmetricPutSpread} from './asymmetric-put-spread-selection-v1';
import {R9_E226_PARAMS,r9E226RetryAllowed,type R9E226Market} from './strategies/r9-e226-policy-v5';
export function buildQuoteOnlyRRescue(input:{chain:OptionChain;asOf:string;market:Readonly<R9E226Market>;fee:number}){
 const m=input.market,p=R9_E226_PARAMS;
 const finite=(v:number|undefined):v is number=>typeof v==='number'&&Number.isFinite(v);
 const extremePressure=m.regime==='RISK_ON_EXTENDED'&&finite(m.vix)&&m.vix<14
  &&((finite(m.adx14)&&m.adx14>30)||(finite(m.priceExtensionAtr)&&m.priceExtensionAtr>=1.5)||(finite(m.sma200Pct)&&m.sma200Pct>=.15));
 const delta=resolvePcsRescueShortDelta({...m,extremePressure,mode:p.deltaMode as Parameters<typeof resolvePcsRescueShortDelta>[0]['mode'],
  vixTermStructureSlope:m.primaryTermSlope??(finite(m.vix)&&finite(m.vix3m)?m.vix3m-m.vix:undefined),priceVsSma200Pct:m.sma200Pct,
  calmDelta:p.calmDelta,normalDelta:p.normalDelta,pressureDelta:p.pressureDelta,extremeDelta:p.extremeDelta,extremeBaseDelta:p.extremeBaseDelta,extremeFallbackDelta:p.extremeFallbackDelta});
 const width=resolvePcsRescueExtremeWidth({...m,extremePressure,profile:'adx_split_v1',extremeWidthPct:p.extremeWidthPct,narrowWidthPct:p.extremeNarrowWidthPct})??(m.regime==='BULL'?p.widthPct:p.nonBullWidthPct);
 if(!Number.isFinite(input.chain.spot)||input.chain.spot<=0||!Number.isFinite(input.fee)||input.fee<0)throw Error('Invalid quote-only rescue observation');
 const select=(shortDelta:number,widthPct:number)=>selectAsymmetricPutSpread(input.chain,input.asOf,p.targetDte,{maximumShortDelta:.25,targetShortDelta:Math.min(.25,shortDelta),maximumWidth:Math.min(30,input.chain.spot*widthPct),minimumNetCredit:1,commissionPerContract:input.fee,maximumRelativeSpread:.5},2);
 const primary=select(delta,width),attempts=[{stage:'primary-quote-only',delta,width,accepted:!!primary,warning:null}];
 if(primary||!r9E226RetryAllowed(m))return {selected:primary,attempts};
 const tertiaryBlocked=m.regime==='BULL'&&m.slowSubregime==='SR02'||m.regime==='SIDEWAYS'&&m.slowSubregime==='SR01';
 for(const [index,uplift] of p.retryDeltaUplifts.entries()){
  if(index>=2&&tertiaryBlocked)continue;
  const retryDelta=Math.min(.25,delta+uplift),retryWidth=Math.min(width,p.retryWidthPct),selected=select(retryDelta,retryWidth);
  attempts.push({stage:`retry-quote-only-${index+1}`,delta:retryDelta,width:retryWidth,accepted:!!selected,warning:null});
  if(selected)return {selected,attempts};
 }
 return {selected:undefined,attempts};
}
