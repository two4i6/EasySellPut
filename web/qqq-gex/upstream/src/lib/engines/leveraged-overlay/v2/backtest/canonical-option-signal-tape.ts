import type { BacktestResult } from '../../backtest/types';
import type { OverlayProposal } from '../../types/pipeline';

export const CANONICAL_OPTION_SIGNAL_ANCHOR = '2010-02-11';

export type CanonicalOptionSignalTape = {
  version: 1;
  dataFingerprint: string;
  anchorStart: string;
  proposalsByDate: Readonly<Record<string, readonly OverlayProposal[]>>;
};

export function buildCanonicalOptionSignalTape(result: BacktestResult, dataFingerprint: string): CanonicalOptionSignalTape {
  const trace = result.debug?.trace;
  if (!trace) throw new Error('canonical option signal tape requires trace');
  const openedPcsSignalDates = new Set(result.tradeLog
    .filter((trade) => trade.action === 'OPEN' && trade.strategyTag === 'QQQ_PUT_CREDIT_SPREAD' && trade.signalDate)
    .map((trade) => trade.signalDate!));
  const proposalsByDate: Record<string, readonly OverlayProposal[]> = {};
  for (const entry of trace) {
    if (!Array.isArray(entry.optionProposals)) throw new Error(`canonical option signal tape is corrupt at ${entry.date}`);
    // PCS_RESCUE is an opt-in independent research layer; never freeze it into
    // the main canonical signal tape, otherwise one research arm could alter
    // the shared v1.2.6 eligibility baseline for every other arm.
    const proposals = entry.optionProposals.filter((proposal) => proposal.action !== 'ADD_PCS_RESCUE' && (proposal.action !== 'ADD_PUT_CREDIT_SPREAD' || openedPcsSignalDates.has(entry.date)));
    if (proposals.length) proposalsByDate[entry.date] = proposals;
  }
  return { version: 1, dataFingerprint, anchorStart: CANONICAL_OPTION_SIGNAL_ANCHOR, proposalsByDate };
}

/** Never regenerate from the active preset if the canonical tape is unusable. */
export function optionProposalsFromCanonicalTape(tape: CanonicalOptionSignalTape, date: string, dataFingerprint: string | undefined): readonly OverlayProposal[] {
  if (tape.version !== 1 || tape.anchorStart !== CANONICAL_OPTION_SIGNAL_ANCHOR || !dataFingerprint || tape.dataFingerprint !== dataFingerprint) {
    throw new Error('canonical option signal tape is unavailable or incompatible');
  }
  return tape.proposalsByDate[date] ?? [];
}
