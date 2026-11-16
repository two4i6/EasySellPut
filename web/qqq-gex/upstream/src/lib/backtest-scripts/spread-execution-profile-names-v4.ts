/** Bootstrap request vocabulary, independent of executable execution resolvers. */
export const SPREAD_EXECUTION_PROFILES=['weighted-reference','funded-integer-v1','funded-stress-v1'] as const;
export type SpreadExecutionProfile=typeof SPREAD_EXECUTION_PROFILES[number];
