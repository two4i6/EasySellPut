/** Native observation seam. Market fields are lossless: never trim opaque policy history.
 * The sample window selects replay bars, not admission or continuation eligibility. */
import type {MarketEnvironmentSnapshot,SystemOutput} from '../../types/output';
import type {CrisisState} from '../../engines/crisis-state-machine';
/** Indexed as-of transport only. Null interpretation and reducers remain strategy policy. */
export type NativeObservationBatch={firstIndex:number;endIndexExclusive:number;values:readonly (number|null)[]};
export function validateNativeObservationBatch(value:unknown,nextIndex:number|null):NativeObservationBatch {
  const batch=value as NativeObservationBatch|undefined;
  if(!batch||!Number.isInteger(batch.firstIndex)||!Number.isInteger(batch.endIndexExclusive)
    ||batch.firstIndex<0||batch.endIndexExclusive<batch.firstIndex||!Array.isArray(batch.values)
    ||batch.values.length!==batch.endIndexExclusive-batch.firstIndex
    ||(nextIndex!==null&&nextIndex!==batch.firstIndex))throw Error('Non-contiguous native observation batch');
  for(const value of batch.values)if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))
    throw Error('Invalid native observation value');
  return batch;
}
export type NativeDecisionObservation={
  asOf:string;marketContext:MarketEnvironmentSnapshot;
  stockAccount:{netLiquidation:number;cash:number;positions:{symbol:string;quantity:number;marketValue:number;averageCost?:number}[]};
  priorRegime?:MarketEnvironmentSnapshot['regime'];crisisPhase:CrisisState['phase'];
  prevCloseNav:number;navDrawdownPeak:number;
  macro:{vix:number;vix3m?:number;vix5dAgo?:number;vxn?:number;vxnHistory:number[]};
  systemStatus:SystemOutput['systemStatus'];blockers:string[];qqqRoc5Slope?:number;upstreamStatuses:Record<string,string>;
};
/** SDK adds availability and contiguous DTE observations without altering native fields. */
export type NativeStrategyObservation=(NativeDecisionObservation & {
  available?:true;
  volatilityDecisionInputs:NativeObservationBatch;
})|{asOf:string;available:false;reason?:string};
export const NATIVE_OBSERVATION_CONTRACT={
  version:'native-stock-as-of-contract-v2',interval:'1d',
  phases:['append-as-of-market-history','sample-window-and-slow-state-lookup','leveraged-availability',
    'execute-pending-stock-orders','mark-stock-account-and-update-nav-peak',
    'advance-crisis-from-prior-raw-signal-and-macro-state','run-pipeline',
    'yield-pre-same-close-native-observation','apply-declared-same-close-stock-actions',
    'commit-close-nav-and-decision-memory','compute-next-crisis-raw-and-schedule-stock-orders'] as const,
  timing:{priorRegime:'previous-completed-decision',prevCloseNav:'previous-completed-close',
    stockAccount:'current-mark-after-pending-fills-before-same-close-actions',
    crisisPhase:'current-transition-from-previous-raw',navDrawdownPeak:'current-pre-decision-stock-peak',
    sourceOptionFeedback:'isolated-adapter-accounts-not-stock-nav'} as const,
  history:{minBarHistory:'resolved-spec-default-200',marketContext:'complete-opaque-history-compatible',
    vxnHistory:'complete-as-of-non-null-prefix',volatilityDecisionInputs:'since-last-native-decision-from-minBarHistory',
    weeklyMacro:'append-only-partial-current-week',slowState:'actual-snapshot-or-existing-native-resolver'} as const,
  missingValues:'preserve-native-undefined-null-and-strategy-specific-coercion',
} as const;
