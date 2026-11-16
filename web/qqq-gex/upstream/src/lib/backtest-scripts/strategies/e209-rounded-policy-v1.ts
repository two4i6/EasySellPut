/** Frozen two-decimal macro buckets. Admission, geometry and exits remain separate. */
import {freezeStrategyData,type StrategyObject} from '../strategy-module-v2';
export const E209_ROUNDED_COEFFICIENTS=freezeStrategyData({
  vixMultiplier:2.85,upMultiplier:2.20,rangeMultiplier:1.50,downMultiplier:.63,
  bullNeutralSr01Multiplier:.74,bullNeutralSr02Multiplier:2.06,bullSr02BullTrendMultiplier:1.40,
} as const);

/** Factor the common neutral-trend condition before applying regime-specific buckets. */
export function e209RoundedRiskMultiplier(context:Readonly<StrategyObject>):number{
  const {regime,trend,slowSubregime}=context,c=E209_ROUNDED_COEFFICIENTS;
  let macro:number=1;
  if(trend==='NEUTRAL'){
    if(regime==='BULL')macro=slowSubregime==='SR01'?c.bullNeutralSr01Multiplier
      :slowSubregime==='SR02'?c.bullNeutralSr02Multiplier:c.upMultiplier;
    else if(regime==='RANGE_BOUND')macro=c.rangeMultiplier;
    else if(regime==='RISK_ON_WEAKENING')macro=slowSubregime==='CURRENT'?c.downMultiplier:c.upMultiplier;
  }else if(trend==='BEAR'&&slowSubregime==='SR01')macro=c.downMultiplier;
  else if(regime==='BULL'&&slowSubregime==='SR02'&&(trend==='BULL'||trend==='STRONG_BULL'))macro=c.bullSr02BullTrendMultiplier;
  return macro*c.vixMultiplier;
}
