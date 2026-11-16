/** Effective E209 bar lifecycle kernel; shared by the versioned module and component tests. */
import { freezeStrategyData, type StrategyFeedback, type StrategySnapshot, type StrategyObject, type StrategyIntent } from '../strategy-module-v2';
import {accumulateRealizedPeak} from '../settlement-observations-v3';
import {validateNativeObservationBatch} from '../../engines/leveraged-overlay/v2/backtest/native-observation-contract-v2';
import { proposeE209SourceCurrentBar } from './eb7-e209-source-proposal-v2';
import { decideE209CurrentSourceGraph } from './eb7-e209-source-graph-v2';
import { initializeE209Rolling, feedbackE209Rolling, type E209RollingState } from './eb7-e209-rolling-rules-v2';
import { createEquityBoostDteHysteresisState, updateEquityBoostDteHysteresisState,
  type EquityBoostDteHysteresisState, type EquityBoostChain } from '../../engines/leveraged-overlay/v2/strategies/equity-boost-put-spread';

import {E209_SOURCE_BOOKS, e209SourceContract} from './e209-policy-v7';
import {createAdmissionTrace,type StrategyAdmissionGate} from '../strategy-admission-v1';
export {E209_SOURCE_BOOKS} from './e209-policy-v7';
export type E209BarRuntimeState = { lastBar: string | null; rolling: E209RollingState;
  pendingTransitions: Record<string, { signalDate: string; pre: boolean; post: boolean }>;
  sources: Record<string, { dte: EquityBoostDteHysteresisState; nextIndex: number | null; realized: number; peak: number }> };
type Book = { market: StrategyObject; account: StrategyObject; positions: StrategyObject[] };
export function initializeE209BarRuntime(): E209BarRuntimeState {
  return { lastBar: null, rolling: initializeE209Rolling(), pendingTransitions: {}, sources: Object.fromEntries(E209_SOURCE_BOOKS.map(id =>
    [id, { dte: createEquityBoostDteHysteresisState(), nextIndex: null, realized: 0, peak: 0 }])) };
}
export function feedbackE209BarRuntime(current: E209BarRuntimeState, feedback: Readonly<StrategyFeedback>) {
  if (current.lastBar !== null && feedback.asOf <= current.lastBar) throw new Error('Feedback must precede current decision');
  const owned=freezeStrategyData(current);
  const next={...owned,rolling:{...owned.rolling},pendingTransitions:{...owned.pendingTransitions},sources:{...owned.sources}};
  const executionKey = feedback.kind === 'fill' ? String(feedback.payload.positionId) : String(feedback.payload.key);
  const transition = next.pendingTransitions[executionKey];
  if (transition && (feedback.kind === 'fill' || feedback.kind === 'reject')) {
    // A rejected proposal is not a predecessor. Only observed fills advance
    // chronological source gaps; no knowledge of tomorrow's fill is used today.
    if (feedback.kind === 'fill') {
      if (transition.pre) next.rolling.previousPreDate = transition.signalDate;
      if (transition.post) next.rolling.previousPostDate = transition.signalDate;
    }
    delete next.pendingTransitions[executionKey];
  }
  next.rolling = feedbackE209Rolling(next.rolling, feedback, 'rolling-base');
  if (feedback.kind === 'close' || feedback.kind === 'settle') {
    const source = next.sources[String(feedback.payload.sourceAccount)];
    if (source) {
      // Candidate6 risk and cooldown use their own realized source ledger.
      next.sources[String(feedback.payload.sourceAccount)]=accumulateRealizedPeak(source,feedback);
    }
  }
  return next;
}
export function decideE209BarRuntime(current: E209BarRuntimeState, snapshot: Readonly<StrategySnapshot>,
  policy: { multiplier(context: Readonly<StrategyObject>): number;
    exit(input: { priorRegime: string; crisisPhase: string; unweightedPnl: number; creditReceived: number }): string | null },
  sourceGraph: typeof decideE209CurrentSourceGraph = decideE209CurrentSourceGraph) {
  const asOf = snapshot.asOf;
  if (current.lastBar !== null && asOf <= current.lastBar) throw new Error('Non-chronological E209 bar');
  const owned=freezeStrategyData(current);
  const next={...owned,sources:{...owned.sources},pendingTransitions:{...owned.pendingTransitions}};
  const books = snapshot.market.sourceAccounts as unknown as Record<string, Book>;
  if (!books) throw new Error('E209 requires isolated source execution books');
  for (const id of E209_SOURCE_BOOKS) {
    const book = books[id];
    let source = next.sources[id]!;
    if (!book || !Array.isArray(book.positions)) throw new Error(`Missing E209 source: ${id}`);
    const native = book.market.nativeState as StrategyObject;
    if (!native || native.asOf !== asOf) throw new Error('As-of native source observation required');
    if (native.available === false) continue;
    source={...source};next.sources[id]=source;
    const inputs = validateNativeObservationBatch(native.volatilityDecisionInputs,source.nextIndex);
    const contract = e209SourceContract(id);
    for (const vxn of inputs.values) {
      source.dte = updateEquityBoostDteHysteresisState(source.dte, vxn ?? undefined, contract.dte);
    }
    source.nextIndex = inputs.endIndexExclusive;
  }
  const sourceReasons: StrategyObject = {};
  const sourceGates=new Map<string,StrategyAdmissionGate[]>();
  function proposal(id: string) {
    const book = books[id]!, native = book.market.nativeState as StrategyObject, source = next.sources[id]!;
    if (native.available === false) { sourceReasons[id] = 'native-unavailable'; return null; }
    const contract = e209SourceContract(id, book.market.vxn);
    // Native rolling admission is filtered AFTER the full raw Candidate6 account.
    const riskId = contract.riskSource;
    const riskBook = books[riskId]!, riskSource = next.sources[riskId]!;
    const result = proposeE209SourceCurrentBar({ source: id, native, asOf, chain: book.market.chain as unknown as EquityBoostChain,
      riskState: { openCount: riskBook.positions.length, realizedDrawdown: Math.max(0, riskSource.peak - riskSource.realized) },
      policy: { broad: contract.broad, candidate6: contract.candidate6,
        targetDte: source.dte.riskState === 'high' ? contract.highRiskDte : contract.normalDte,
        widthTargetPct: contract.widthTargetPct,
        ratioMin: contract.ratioMin, ratioMax: contract.ratioMax, collarMode: 'full', positionMode: 'independent',
        macroMultiplier: contract.candidate6 ? 1 : policy.multiplier(native.marketContext as StrategyObject) } });
    sourceReasons[id] = result.reason;
    sourceGates.set(id,result.gates);
    return result.proposal;
  }
  const graph = sourceGraph({ asOf, vxn: Number(snapshot.market.vxn), rollingState: next.rolling,
    actualRollingBaseOverlap: books['rolling-base']!.positions.length, rolling: proposal('rolling-base'),
    e1Screen: proposal('e1-screen'), c4Screen: proposal('c4-screen'),
    high: { rawE1: proposal('high-raw'), e1: proposal('high-e1'), rawC4: proposal('high-c4') },
    low: { rawE1: proposal('low-raw'), e1: proposal('low-e1'), rawC4: proposal('low-c4') } });
  const prePassed = graph.rollingState.previousPreDate === asOf;
  const postPassed = graph.rollingState.previousPostDate === asOf;
  next.rolling = { ...graph.rollingState, previousPreDate: current.rolling.previousPreDate,
    previousPostDate: current.rolling.previousPostDate }; next.lastBar = asOf;
  const rollingRaw = proposal('rolling-raw');
  const intents: StrategyIntent[] = [];
  {
    for (const [id, positions] of [...E209_SOURCE_BOOKS.map(id => [id, books[id]!.positions] as const),
      ['portfolio', snapshot.positions] as const]) {
      for (const position of positions) {
        const owner = id === 'portfolio' ? String(position.entrySource) : id;
        const native = books[owner]?.market.nativeState as StrategyObject | undefined;
        if (!native || native.available === false) throw new Error('Position requires native entry-source observation');
        const reason = policy.exit({ priorRegime: String(native.priorRegime), crisisPhase: String(native.crisisPhase),
          unweightedPnl: Number(position.markPnl), creditReceived: Number(position.creditReceived) });
        if (reason && (e209SourceContract(id).profitTargetExit || reason === 'regime-or-crisis')) {
          intents.push({ kind: 'close-position', key: `close:${id}:${position.id}:${asOf}`, positionId: String(position.id), reason });
        }
      }
    }
    const admissions = [...(rollingRaw ? [rollingRaw] : []), ...graph.sourceAdmissions,
      ...(graph.proposal ? [{ ...graph.proposal, source: 'portfolio' }] : [])];
    for (const admission of admissions) {
      const contract = e209SourceContract(admission.source);
      if (admission.source === 'rolling-raw' || admission.source === 'rolling-base') {
        next.pendingTransitions[`open:${admission.source}:${asOf}`] = { signalDate: asOf,
          pre: admission.source === 'rolling-raw' && prePassed,
          post: admission.source === 'rolling-base' && postPassed };
      }
      intents.push({ kind: 'open-spread', key: `open:${admission.source}:${asOf}`,
        contract: { ...admission.contract, symbol: 'QQQ', type: 'put' },
        risk: { sourceAccount: admission.source, entrySource: admission.source === 'portfolio' ? graph.proposal!.source : admission.source,
          multiplier: Number(admission.contract.multiplier), ratioMin: contract.ratioMin, ratioMax: contract.ratioMax } });
    }
  }
  const score=(gates:StrategyAdmissionGate[])=>gates.filter(g=>g.status==='PASS').length;
  // If no source survived merging, describe the furthest evaluated current source, never a future fill.
  const diagnosticSource=graph.candidateSource??[...sourceGates].reduce<string|null>((best,[id,gates])=>
    best===null||score(gates)>score(sourceGates.get(best)!)?id:best,null);
  const trace=createAdmissionTrace(['上游与波动率','策略信号','变体风险闸','候选合约','组合准入']);
  if(diagnosticSource)trace.gates.splice(0,4,...sourceGates.get(diagnosticSource)!.slice(0,4).map(g=>({...g,detail:`${diagnosticSource} · ${g.detail}`})));
  if(trace.gates.slice(0,4).every(g=>g.status==='PASS'))trace.check(4,!!graph.proposal,
    `来源合并 ${graph.audit.e0}；末级筛选 ${graph.audit.final}`);
  return { state: next, intents, plots: { ...graph.audit, sourceReasons, selectedSource: graph.proposal?.source ?? null,
    diagnosticSource,gates:trace.gates } };
}
