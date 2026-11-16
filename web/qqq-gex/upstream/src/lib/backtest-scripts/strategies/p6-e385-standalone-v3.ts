/** Same E385 economic policy, with eight logically covered OR releases removed. */
import type {BarStrategyModule} from '../strategy-module-v2';
import {p6E385StandaloneV2,decideP6E385CurrentBar} from './p6-e385-standalone-v2';
import {evaluateP6E385Admission} from './p6-e385-effective-admission-v2';
import {P6_COMPACT_RULES} from './p6-e385-compact-rules-v1';
export const p6E385StandaloneV3:BarStrategyModule={
  ...p6E385StandaloneV2,
  manifest:{...p6E385StandaloneV2.manifest,version:'p6-e385-standalone-current-bar-v3-compact-rules'},
  onBar(input){return decideP6E385CurrentBar(input,(context,state)=>evaluateP6E385Admission(context,state,P6_COMPACT_RULES));},
};
