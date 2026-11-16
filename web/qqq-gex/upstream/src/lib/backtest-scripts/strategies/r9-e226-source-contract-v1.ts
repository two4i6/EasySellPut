/** Strategy-owned capabilities, with no host/account implementation dependencies. */
import {freezeStrategyData} from '../strategy-module-v2';
export const R9_E226_SOURCE_CONTRACT = freezeStrategyData({
  nativePolicy:{replayVariant:'v1_2_6' as const},contextSource:'pcs-main',
  quantityMode:'signal-integer-v1' as const,terminalOpenAtClose:true,terminalMarkOnly:true,
  fillRetry:{version:'delta-parent-chain-v2' as const,commissionPerContract:0},
} as const);
