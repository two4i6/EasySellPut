/** E209 residual releases with the obsolete seven-condition parent veto removed. */
import type {StrategyObject} from '../strategy-module-v2';
type Context=Readonly<StrategyObject>;
const n=(c:Context,key:string)=>Number(c[key]);
export const E209_RESIDUAL_RULES_V2 = [
  { id: 'E2', accepts: (c: Context) => c.slowSubregimeHealth === 'STALE_OR_MISSING' && c.regime === 'RISK_ON_WEAKENING'
    && n(c, 'vix') >= 16 && n(c, 'tqqqRealisedVol20d') >= .4 },
  { id: 'E3', accepts: (c: Context) => n(c, 'vixTermStructureSlope') >= 4 && n(c, 'range20dPct') < .05
    && n(c, 'adx14') >= 12 && n(c, 'vix') >= 16 },
  { id: 'E4', accepts: (c: Context) => n(c, 'tqqqRealisedVol20d') < .3 && n(c, 'vix') >= 16 && n(c, 'rsi14') >= 70
    && n(c, 'roc20') < .1 && n(c, 'adx14') < 35 },
  { id: 'E5', accepts: (c: Context) => c.trend === 'BEAR' && n(c, 'distanceToSma50Pct') >= 0
    && n(c, 'vixTermStructureSlope') < 2 && n(c, 'tqqqRealisedVol20d') < .8 && n(c, 'sma20SlopePct') < .02 },
  { id: 'E6', accepts: (c: Context) => n(c, 'rsi14') >= 70 && c.trend === 'BULL'
    && n(c, 'vixTermStructureSlope') < 2 && n(c, 'adx14') < 30 },
  { id: 'E7', accepts: (c: Context) => n(c, 'vixTermStructureSlope') >= 4 && n(c, 'priceExtensionAtr') < 1
    && n(c, 'adx14') >= 18 && n(c, 'priceVsSma200Pct') >= .05 },
  { id: 'E8', accepts: (c: Context) => n(c, 'tqqqRoc20') < -.1 && n(c, 'navDrawdownPct') < .05
    && n(c, 'qqqEr20') >= .2 && n(c, 'vix') >= 18 },
] as const;


export function evaluateE209ResidualStage(input:{context:Context;e0Admitted:boolean;residualEligible:boolean}){
 if(input.e0Admitted)return {admitted:true,reason:'E0-parent'};
 if(!input.residualEligible)return {admitted:false,reason:'upstream-unavailable'};
 const match=E209_RESIDUAL_RULES_V2.find(rule=>rule.accepts(input.context));
 return {admitted:!!match,reason:match?.id??'residual-no-match'};
}
