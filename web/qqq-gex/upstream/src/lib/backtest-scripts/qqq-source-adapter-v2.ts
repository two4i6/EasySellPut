/** Shared chronological source-account execution. No admission rules or legacy replay calls. */
import { createHash } from 'node:crypto';
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type { BarStrategyExecutionAdapter } from './strategy-host-v2';
import { assertBarStrategyModule, copyStrategyData, freezeStrategyData, type BarStrategyModule, type StrategyFeedback, type StrategyIntent, type StrategyObject } from './strategy-module-v2';
import { createQqqSpreadExecutionAdapter, QQQ_SPREAD_ADAPTER_VERSION, type QqqSpreadAdapterConfig } from './qqq-spread-adapter-v2';
import type { ResolvedBacktestRunSpec } from '../engines/leveraged-overlay/v2/backtest/run-spec';
import { QQQ_NATIVE_OBSERVATION_VERSION } from './qqq-native-observation-v2';
import type { OptionChain } from '../engines/leveraged-overlay/types/input';
import {createQqqObservationSession} from './qqq-observation-session-v1';
import {createQqqMarketContext} from './qqq-market-context-v5';
import {createSourceBookFeedback} from './source-book-feedback-v1';

export type QqqSourceAccountDefinition = { id: string; config: QqqSpreadAdapterConfig };
export const QQQ_SOURCE_ADAPTER_VERSION = 'qqq-source-accounts-sdk-v2-v3-source-initialization';
/**
 * `portfolio` is the selected traded overlay. Other books are isolated source
 * simulations; their profits/cash/margin MUST NOT be summed into the portfolio.
 * Strategy owns every source's admission/contract/exit and chooses portfolio
 * intents as of this bar. The adapter never chooses from completed cycles.
 */
export function createQqqSourceExecutionAdapter(data: MarketDataSet, portfolio: QqqSpreadAdapterConfig,
  definitions: readonly QqqSourceAccountDefinition[],
  nativeSpecs: Readonly<Record<string, ResolvedBacktestRunSpec>> = {},
  observationPolicy?: { module: BarStrategyModule; params?: StrategyObject },
  options:{shareMarket?:boolean;fillContractGroups?:Readonly<Record<string,readonly string[]>>}={}) {
  const market=options.shareMarket===false?undefined:createQqqMarketContext(data);
  const fillContractGroups=options.fillContractGroups===undefined?undefined:copyStrategyData(options.fillContractGroups);
  // Opt-in: existing books retain their observation shape and model identity.
  if (observationPolicy) assertBarStrategyModule(observationPolicy.module);
  const resolved = copyStrategyData([{ id: 'portfolio', config: portfolio }, ...definitions]);
  const ids = new Set<string>();
  for (const definition of resolved) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id) || ids.has(definition.id)) throw new Error('Invalid/duplicate source account');
    ids.add(definition.id);
    if (definition.config.startDate !== portfolio.startDate || definition.config.endDate !== portfolio.endDate) throw new Error('Source windows must match portfolio');
  }
  for (const [id, spec] of Object.entries(nativeSpecs)) {
    if (!ids.has(id)) throw new Error('Unknown native observation source account');
    if (!spec.config.startDate || spec.config.startDate < portfolio.startDate
      || spec.config.endDate !== portfolio.endDate) throw new Error('Native observation windows must be contained in portfolio');
  }
  for(const members of Object.values(fillContractGroups??{})){
    if(!members.length||new Set(members).size!==members.length||members.some(id=>!ids.has(id)||id==='portfolio'))
      throw Error('Invalid source fill-contract group');
  }
  const books = resolved.map(definition => ({ id: definition.id, execution: createQqqSpreadExecutionAdapter(data, definition.config,market) }));
  // Identical stock-only specifications have identical state transitions.
  // Reuse their observation stream within this run; option books stay isolated.
  const observations=createQqqObservationSession(data,nativeSpecs,market,observationPolicy);
  const main = books[0]!.execution;
  if (books.some(book => JSON.stringify(book.execution.decisionBars) !== JSON.stringify(main.decisionBars))) throw new Error('Source calendars must match');
  const feedbackOwnership=createSourceBookFeedback(resolved.map(book=>book.id)),intentKeys = new Set<string>();
  const definitionsHash = createHash('sha256').update(JSON.stringify(resolved)).digest('hex');
  const nativeObservationIdentity = observations.identity;
  const nativeHash = createHash('sha256').update(JSON.stringify(nativeObservationIdentity)).digest('hex');
  let closed = false;
  const close = () => { closed = true; observations.close(); };
  const adapter: BarStrategyExecutionAdapter = {
    close,
    terminalSubmission: main.adapter.terminalSubmission,
    dataFingerprint: data.fingerprint,
    modelVersion: `${QQQ_SOURCE_ADAPTER_VERSION}:${QQQ_SPREAD_ADAPTER_VERSION}:${definitionsHash}:${QQQ_NATIVE_OBSERVATION_VERSION}:${nativeHash}`
      + (observations.plannerIdentity ? `:${observations.plannerIdentity}` : '')
      + (fillContractGroups?`:fill-contract-groups=${createHash('sha256').update(JSON.stringify(fillContractGroups)).digest('hex')}`:''),
    async advanceTo(asOf) {
      if (closed) throw new Error('Source adapter is closed');
      let nativeStates:Map<string,StrategyObject>;
      try {
        nativeStates=observations.advanceTo(asOf,'native-data-or-warmup-unavailable');
      } catch (error) { close(); throw error; }
      const advanced = await Promise.all(books.map(async book => ({ id: book.id, value: await book.execution.adapter.advanceTo(asOf) })));
      const feedback: StrategyFeedback[] = [], sources: StrategyObject = {};
      for (const { id, value } of advanced) {
        const nativeState = nativeStates.get(id);
        if (nativeState?.available !== false && nativeState && observationPolicy?.module.planObservations) {
          // Actual fills/settlements in every book have already been applied.
          // Only this book's as-of account and native observations enter the plan.
          const facts=observations.observe({asOf,sourceId:id,account:value.snapshot.account,nativeState,
            chain:value.snapshot.market.chain as unknown as OptionChain});
          if(facts!==null)value.snapshot.market.pcsAnalytics=facts;
        }
        if (id !== 'portfolio') sources[id] = { market: { ...value.snapshot.market,
          ...(nativeStates.has(id) ? { nativeState: nativeStates.get(id)! } : {}) }, account: value.snapshot.account, positions: value.snapshot.positions };
        feedback.push(...feedbackOwnership.ingest(id,value.feedback));
      }
      const snapshot = advanced[0]!.value.snapshot;
      return { snapshot: { ...snapshot, market: { ...snapshot.market,
        ...(nativeStates.has('portfolio') ? { nativeState: nativeStates.get('portfolio')! } : {}), sourceAccounts: sources,
        sourceExecutionCapabilities: { isolatedLedgers: true, sourceCapitalNotSummed: true, completeE209: false } } }, feedback };
    },
    async submit(asOf, intents) {
      if (closed) throw new Error('Source adapter is closed');
      const incoming = freezeStrategyData(intents), batches = new Map(books.map(book => [book.id, [] as StrategyIntent[]]));
      const batchKeys = new Set<string>();
      for (const intent of incoming) {
        if (batchKeys.has(intent.key) || intentKeys.has(intent.key)) throw new Error('Duplicate coordinated source intent');
        batchKeys.add(intent.key);
        const id = intent.kind === 'open-spread' ? String(intent.risk.sourceAccount ?? 'portfolio') : feedbackOwnership.ownerOf(intent.positionId);
        if (!id || !batches.has(id)) throw new Error('Unknown source account/position owner');
        batches.get(id)!.push(intent);
      }
      if(fillContractGroups&&asOf===main.resolvedEndDate){
        // Each isolated source keeps its declared host terminal submission convention.
        for(const book of books)if(book.id!=='portfolio'&&book.execution.adapter.terminalSubmission==='omit')batches.set(book.id,[]);
      }
      const scopedPools=new Map<string,Record<string,readonly StrategyObject[]>>();
      for (const book of books) {
        const batch=batches.get(book.id)!;
        const pools:Record<string,readonly StrategyObject[]>={};
        if(fillContractGroups)for(const intent of batch){
          if(intent.kind!=='open-spread')continue;
          const group=fillContractGroups[book.id==='portfolio'?String(intent.risk.executionPolicy):book.id];
          if(!group)throw Error('Missing source fill-contract group');
          pools[intent.key]=incoming.filter(i=>i.kind==='open-spread'&&group.includes(String(i.risk.sourceAccount??'portfolio')))
            .map(i=>(i as Extract<StrategyIntent,{kind:'open-spread'}>).contract);
        }
        scopedPools.set(book.id,pools);
      }
      // All preflights are pure; an invalid source does not partially queue the others.
      for (const book of books) batches.set(book.id,book.execution.validateSubmission(asOf, batches.get(book.id)!) as StrategyIntent[]);
      const terminalFeedback:StrategyFeedback[]=[];
      const fillContracts=incoming.filter(i=>i.kind==='open-spread').map(i=>i.contract);
      let portfolioResult:Awaited<ReturnType<BarStrategyExecutionAdapter['submit']>>=undefined;
      for (const book of books) {
        const result = await book.execution.submitWithFillContracts(asOf, batches.get(book.id)!,
          fillContracts,fillContractGroups?scopedPools.get(book.id):undefined);
        if (book.id==='portfolio') portfolioResult=result;
        if (result) terminalFeedback.push(...feedbackOwnership.ingest(book.id,result.feedback));
      }
      for (const key of batchKeys) intentKeys.add(key);
      if(portfolioResult)return {...portfolioResult,feedback:terminalFeedback};
      if(terminalFeedback.length){
        const final=main.evidence();
        const {asOf:_asOf,...account}=final.curves.at(-1)!;
        return {account,positions:final.positions,feedback:terminalFeedback};
      }
    },
  };
  return { adapter, close, decisionBars: main.decisionBars, resolvedEndDate: main.resolvedEndDate, definitionsHash,
    nativeObserverCount: observations.count,marketStats:()=>market?.stats()??null,
    // Each book's evidence() validates/clones its own bounded ledger. A trusted
    // multi-book archive may exceed the hook input node limit; do not clone and
    // validate all books again as if this archive were a single strategy input.
    evidence: (mode:'copy'|'seal'='copy') => ({ version: QQQ_SOURCE_ADAPTER_VERSION, definitionsHash, definitions: copyStrategyData(resolved),
      nativeObservationIdentity: copyStrategyData(nativeObservationIdentity),
      portfolio: main.evidence(mode), sources: Object.fromEntries(books.slice(1).map(book => [book.id, book.execution.evidence(mode)])),
      sourceCapitalNotSummed: true, completeE209: false, productionReady: false }) };
}
