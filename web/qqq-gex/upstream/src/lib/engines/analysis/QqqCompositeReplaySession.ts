import { createBacktestSharedResourcesWithData } from '../leveraged-overlay/v2/backtest/runner';
import type { ReadonlyMarketPrecompute } from '../leveraged-overlay/v2/backtest/day-loop';
import type { CanonicalOptionSignalTape } from '../leveraged-overlay/v2/backtest/canonical-option-signal-tape';
import type { ResolvedBacktestRunSpec } from '../leveraged-overlay/v2/backtest/run-spec';
import type { MarketDataSet } from '../leveraged-overlay/v2/backtest/fixtures';
import type { OptionChain } from '../leveraged-overlay/types/input';
import type { computeRollingAdmission, computeScreenAdmission } from './QqqE1DynamicAdmission';

/** Pure, data-relative EB2 admission intermediates shared by high/low EB7 arms. */
export type QqqEb2AdmissionCacheEntry = {
  rolling: ReturnType<typeof computeRollingAdmission>;
  e1Screen: ReturnType<typeof computeScreenAdmission>;
  c4Screen: ReturnType<typeof computeScreenAdmission>;
};

/**
 * Read-only resources shared by every layer of one composite replay.
 *
 * The session deliberately contains no strategy state or ledger state. Its
 * admission cache stores only pure, data-relative intermediates. That keeps
 * the seam safe: layers may share expensive market-derived work without
 * affecting one another's chronological replay.
 */
export type QqqCompositeReplaySession = {
  data: MarketDataSet;
  marketPrecompute: ReadonlyMarketPrecompute;
  mockOptionChainCache: Map<string, OptionChain>;
  canonicalOptionSignalTapeCache: Map<string, CanonicalOptionSignalTape>;
  eb2AdmissionCache: Map<string, QqqEb2AdmissionCacheEntry>;
};

/** The execution context accepted by the v2 runner and the dynamic adapters. */
export type QqqCompositeReplayExecution = Pick<
  QqqCompositeReplaySession,
  'marketPrecompute' | 'mockOptionChainCache' | 'canonicalOptionSignalTapeCache'
  | 'eb2AdmissionCache'
>;

/** Research-only timing seam; omitted from production execution. */
export type QqqReplayProfiler = { record: (stage: string, milliseconds: number) => void };

/**
 * Build once per composite replay. Callers must pass a resolved spec whose
 * data coordinates match the other layers in the composition.
 */
export function createQqqCompositeReplaySession(
  spec: ResolvedBacktestRunSpec,
  data: MarketDataSet,
): QqqCompositeReplaySession {
  return {
    data,
    ...createBacktestSharedResourcesWithData(spec, data),
    eb2AdmissionCache: new Map(),
  };
}

export function executionFromQqqCompositeReplaySession(
  session: QqqCompositeReplaySession,
): QqqCompositeReplayExecution {
  return {
    marketPrecompute: session.marketPrecompute,
    mockOptionChainCache: session.mockOptionChainCache,
    canonicalOptionSignalTapeCache: session.canonicalOptionSignalTapeCache,
    eb2AdmissionCache: session.eb2AdmissionCache,
  };
}
