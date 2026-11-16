import type { CompactGexStrike } from './qqqGexHistory';
/** Display projection only; no rounding or strike sampling. */
export function qqqChartProfile(profile: readonly CompactGexStrike[]): CompactGexStrike[] {
 return profile.map(({strike,callGex,putGex,totalGex,callOi,putOi,callVolume,putVolume,callIv,putIv,callReceivedAt,putReceivedAt,isCallWall,isPutWall,isGammaFlip,calculationVersion,gexUnit,inputComplete,computedAt,sourceAsOf})=>Object.fromEntries(Object.entries({
  strike,callGex,putGex,totalGex,callOi,putOi,callVolume,putVolume,callIv,putIv,callReceivedAt,putReceivedAt,isCallWall,isPutWall,isGammaFlip,calculationVersion,gexUnit,inputComplete,computedAt,sourceAsOf,
 }).filter(([,value])=>value!==undefined)) as unknown as CompactGexStrike);
}
