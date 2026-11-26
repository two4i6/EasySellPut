/** Equal-side variance per strike, then log-strike variance interpolation at spot.
 * Zero-OI contracts still carry quote IV. No OI weighting or synthetic IV fallback.
 */
import { qqqIvUsable } from './qqqIvQuality';
export const QQQ_ATM_IV_METHOD = 'strike-variance-interpolation-usable-iv-v2';
export function qqqAtmIv(calls: readonly {strike:number;iv:number}[], puts: readonly {strike:number;iv:number}[], spot: number): number {
  if (!Number.isFinite(spot) || spot <= 0) return 0;
  const sides = [calls,puts].map(rows => {
    const grouped = new Map<number,number[]>();
    for(const p of rows)if(Number.isFinite(p.strike)&&p.strike>0&&qqqIvUsable(p.iv)){
      const values=grouped.get(p.strike)??[];values.push(p.iv*p.iv);grouped.set(p.strike,values);
    }
    return new Map([...grouped].map(([k,v])=>[k,v.sort((a,b)=>a-b).reduce((s,x)=>s+x,0)/v.length]));
  });
  const strikes=[...new Set(sides.flatMap(s=>[...s.keys()]))].sort((a,b)=>a-b);
  if(!strikes.length)return 0;
  const variance=(k:number)=>{const values=sides.flatMap(s=>s.has(k)?[s.get(k)!]:[]);return values.reduce((s,x)=>s+x,0)/values.length;};
  const upper=strikes.find(k=>k>=spot);
  if(upper===spot)return Math.sqrt(variance(upper));
  const lower=strikes.filter(k=>k<spot).at(-1);
  if(lower===undefined)return Math.sqrt(variance(upper!));
  if(upper===undefined)return Math.sqrt(variance(lower));
  const weight=(Math.log(spot)-Math.log(lower))/(Math.log(upper)-Math.log(lower));
  return Math.sqrt(variance(lower)*(1-weight)+variance(upper)*weight);
}
