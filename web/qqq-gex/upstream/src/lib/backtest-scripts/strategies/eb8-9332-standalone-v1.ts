/** User-selected E9332 owned SDK artifact, registered in EPR on 2026-11-16. */
import type {BarStrategyModule} from '../strategy-module-v2';
import {selectedNativeStrategy} from './e9332/strategy';
export const eb89332StandaloneV1:BarStrategyModule={...selectedNativeStrategy,
 manifest:{...selectedNativeStrategy.manifest,version:'eb8-9332-owned-v1'}};
