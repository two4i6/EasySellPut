/** Decision state contains only feedback facts actually consumed by admission.
 * Execution histories remain in the common in-memory result collector. */
import type {StrategyFeedback} from '../strategy-module-v2';
import {settledFeedbackPnl} from '../settlement-observations-v3';
export {evaluateP6E385Admission} from './p6-e385-effective-admission-v2';
export {P6_E385_LINEAGE,P6_E385_EFFECTIVE_PARAMETERS} from './p6-e385-parameters-v2';
export type P6SettlementState={lastSettledPnl:number|null};
export const initializeP6Settlement=():P6SettlementState=>({lastSettledPnl:null});
export function applyP6Settlement(state:P6SettlementState,feedback:Readonly<StrategyFeedback>):P6SettlementState{
  if(feedback.payload.entrySource!=='p6-e385')return state;
  const pnl=settledFeedbackPnl(feedback);return pnl===null?state:{lastSettledPnl:pnl};
}
