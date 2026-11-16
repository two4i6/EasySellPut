/** Framework contract-selection machinery at scheduled execution, not strategy admission. */
import { buildPutCreditSpreadOpen, buildPutCreditSpreadOpenNearestFeasibleExpiry } from './put-spread-kernel-v6';
import type { OptionChain } from '../engines/leveraged-overlay/types/input';
import {assertPutSpreadBounds,selectBoundedPutSpread,type PutSpreadBounds} from './bounded-put-spread-selection-v1';
import { assertStrategyData, type StrategyJson } from './strategy-module-v2';
export type SpreadFillRetryPolicy = {
  version:'delta-parent-preserving-v1'|'bounded-put-pairs-v1'|'bounded-put-pairs-extended-v1'; bounds?:PutSpreadBounds; targetDte:number; shortDelta:number; widthPct:number;
  nav:number; riskBudget:number; forceMinimumContract:boolean;
  pairSearchMode?:'quote_only_width_v1'; expandedSearch:'none'|'nearest-feasible';
};
export function assertSpreadFillRetryPolicy(value: unknown): asserts value is SpreadFillRetryPolicy {
  assertStrategyData(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fill retry policy');
  const p = value as SpreadFillRetryPolicy;
  if (Object.keys(p).some(k => !['version','targetDte','shortDelta','widthPct','nav','riskBudget','forceMinimumContract','pairSearchMode','expandedSearch','bounds'].includes(k))
    || !['delta-parent-preserving-v1','bounded-put-pairs-v1','bounded-put-pairs-extended-v1'].includes(p.version)
    || (p.version==='bounded-put-pairs-extended-v1'?(!Number.isInteger(p.targetDte)||p.targetDte<1||p.targetDte>365):p.version==='bounded-put-pairs-v1'?(!Number.isInteger(p.targetDte)||p.targetDte<1||p.targetDte>75):![28,35].includes(p.targetDte))
    || ![p.shortDelta,p.widthPct,p.nav,p.riskBudget].every(n => Number.isFinite(n) && n > 0)
    || p.shortDelta > 1 || p.widthPct >= 1 || p.riskBudget > 1 || typeof p.forceMinimumContract !== 'boolean'
    || (p.pairSearchMode !== undefined && p.pairSearchMode !== 'quote_only_width_v1')
    || !['none','nearest-feasible'].includes(p.expandedSearch)) throw new Error('Invalid fill retry policy');
  if(p.version==='bounded-put-pairs-v1'||p.version==='bounded-put-pairs-extended-v1'){assertPutSpreadBounds(p.bounds);if(p.shortDelta!==p.bounds!.maximumShortDelta)throw Error('Inconsistent retry delta bounds');}
  else if(p.bounds!==undefined)throw Error('Bounds require versioned pair selection');
}
/** Preserve an executable ordinary-chain contract before searching additional expiries. */
export function selectSpreadFillRetry(input: { policy:SpreadFillRetryPolicy; asOf:string;
  chain:OptionChain; expandedChain:()=>OptionChain }) {
  assertSpreadFillRetryPolicy(input.policy);
  if(input.policy.version==='bounded-put-pairs-v1'||input.policy.version==='bounded-put-pairs-extended-v1'){
    const open=selectBoundedPutSpread(input.chain,input.asOf,input.policy.targetDte,input.policy.bounds!);
    if(open||input.policy.expandedSearch==='none')return {built:{open},expanded:false};
    return {built:{open:selectBoundedPutSpread(input.expandedChain(),input.asOf,input.policy.targetDte,input.policy.bounds!,true)},expanded:true};
  }
  const { version:_, expandedSearch, bounds:_bounds, ...policy } = input.policy;
  const contract = { ...policy, date:input.asOf, underlying:'QQQ', chain:input.chain };
  const baseline = buildPutCreditSpreadOpen(contract);
  if (baseline.open || expandedSearch === 'none') return { built:baseline, expanded:false };
  return { built:buildPutCreditSpreadOpenNearestFeasibleExpiry({...contract,chain:input.expandedChain()}), expanded:true };
}
export const fillRetryPolicyJson = (policy:SpreadFillRetryPolicy): StrategyJson => ({...policy});
