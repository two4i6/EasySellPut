import {
  assertBarStrategyModule, assertStrategyStep, freezeStrategyData,
  type BarStrategyModule, type StrategyFeedback, type StrategyIntent, type StrategyJson,
  type StrategyObject, type StrategySnapshot,
} from './strategy-module-v2';

/**
 * A fresh adapter owns market loading, indicators, marks, fills and the ledger.
 * advanceTo applies earlier scheduled orders/expiry before returning the current
 * observation; submit queues new intents and MUST NOT fill them retrospectively.
 * Only the adapter may access full MarketDataSet; the script sees this bar only.
 * Shared spread/source adapters implement execution; shared independent audits
 * reconcile account curves and MTM outside the strategy lifecycle.
 */
export type StrategySubmissionExecution = {
  account: StrategySnapshot['account'];
  positions: StrategySnapshot['positions'];
  feedback: StrategyFeedback[];
};
export type BarStrategyExecutionAdapter = {
  dataFingerprint: string;
  /** Data identity alone cannot pin pricing/execution semantics. */
  modelVersion: string;
  /** Explicit opt-in; omitted adapters retain the original daily lifecycle. */
  decisionClock?: 'iso-utc-intraday-v1';
  /** Adapter declares final-sample order execution, never strategy admission. */
  terminalSubmission?: 'omit' | 'adapter';
  advanceTo(asOf: string): Promise<{ snapshot: StrategySnapshot; feedback: StrategyFeedback[] }>;
  submit(asOf: string, intents: readonly StrategyIntent[]): Promise<void | StrategySubmissionExecution>;
  /** Release incremental observation iterators on success, cancellation or failure. */
  close?(): void | Promise<void>;
};
export type StrategyHostRecord = {
  asOf: string;
  feedback: StrategyFeedback[];
  snapshot: StrategySnapshot;
  state: StrategyJson;
  intents: StrategyIntent[];
  submittedIntents?: StrategyIntent[];
  /** Post-decision execution, distinct from the as-of input seen by onBar. */
  executionAfterSubmission?: StrategySubmissionExecution;
  plots: StrategyObject;
};

/** Pure strategy lifecycle; no API/profile/builder calls, date admission or metric invention. */
export async function runBarStrategyWithAdapter(input: {
  module: BarStrategyModule;
  /** SHA-256 of the exact loaded script bytes, computed by the trusted loader. */
  codeHash: string;
  params?: StrategyObject;
  /** Actual chronological observations, including required warm-up, from the data adapter. */
  decisionBars: readonly string[];
  decisionClock?: 'iso-utc-intraday-v1';
  createAdapter: () => BarStrategyExecutionAdapter;
  signal?: AbortSignal;
  /** Stream to a validation sink without retaining a second trace; persistence is opt-in. */
  recordMode?: 'retain' | 'stream';
  onRecord?: (record: Readonly<StrategyHostRecord>) => Promise<void> | void;
}) {
  assertBarStrategyModule(input.module);
  if (!/^[a-f0-9]{64}$/.test(input.codeHash)) throw new Error('Missing/invalid strategy code hash');
  const manifest = freezeStrategyData(input.module.manifest);
  if (input.params !== undefined && (!input.params || typeof input.params !== 'object' || Array.isArray(input.params))) throw new Error('Invalid strategy parameters');
  const params = freezeStrategyData({ ...input.module.params, ...input.params });
  if (input.recordMode !== undefined && input.recordMode !== 'retain' && input.recordMode !== 'stream') throw new Error('Invalid record mode');
  if (input.recordMode === 'stream' && !input.onRecord) throw new Error('Streaming requires a complete evidence sink');
  const seenFeedback = new Set<string>();
  const records: StrategyHostRecord[] = [];
  if (input.decisionClock !== undefined && input.decisionClock !== 'iso-utc-intraday-v1') throw Error('Unsupported decision clock');
  const validTime = (value: string) => input.decisionClock === 'iso-utc-intraday-v1'
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
    : /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString().slice(0, 10) === value;
  let previous: string | undefined;
  for (const asOf of input.decisionBars) {
    if (!validTime(asOf) || (previous !== undefined && asOf <= previous)) {
      throw new Error('Decision bars must be valid and strictly chronological');
    }
    previous = asOf;
  }
  input.signal?.throwIfAborted();
  const adapter = input.createAdapter();
  try {
  if (adapter.decisionClock !== input.decisionClock) throw Error('Adapter decision clock mismatch');
  if (typeof adapter.dataFingerprint !== 'string' || !adapter.dataFingerprint) throw new Error('Missing data fingerprint');
  if (typeof adapter.modelVersion !== 'string' || !adapter.modelVersion) throw new Error('Missing execution model version');
  let state = freezeStrategyData(input.module.initialize(params));
  const applyFeedback = (feedback: readonly StrategyFeedback[], asOf: string) => {
    for (const event of feedback) {
      if (typeof event.id !== 'string' || !event.id || seenFeedback.has(event.id) || !validTime(event.asOf) || event.asOf > asOf
        || !event.payload || Array.isArray(event.payload) || typeof event.payload !== 'object'
        || !['fill', 'close', 'settle', 'reject'].includes(event.kind)) throw new Error('Invalid, future or duplicate execution feedback');
      seenFeedback.add(event.id);
      if (input.module.onFeedback) state = freezeStrategyData(input.module.onFeedback({state, params, feedback:event}));
    }
  };
  let recordCount = 0;
  let scheduledFeedbackEvents=0,terminalFeedbackEvents=0;
  for (const asOf of input.decisionBars) {
    input.signal?.throwIfAborted();
    const advanced = await adapter.advanceTo(asOf);
    input.signal?.throwIfAborted();
    const snapshot = freezeStrategyData(advanced.snapshot);
    if (snapshot.asOf !== asOf) throw new Error('Adapter observation does not match current bar');
    if (!snapshot.market || Array.isArray(snapshot.market) || typeof snapshot.market !== 'object'
      || !snapshot.account || Array.isArray(snapshot.account) || typeof snapshot.account !== 'object'
      || !Array.isArray(snapshot.positions) || snapshot.positions.some(position => !position || Array.isArray(position) || typeof position !== 'object')) throw new Error('Invalid adapter snapshot');
    const feedback = freezeStrategyData(advanced.feedback);
    applyFeedback(feedback, asOf);
    scheduledFeedbackEvents+=feedback.length;
    const step = input.module.onBar({ state, params, snapshot });
    assertStrategyStep(step);
    state = freezeStrategyData(step.state);
    const intents = freezeStrategyData(step.intents);
    input.signal?.throwIfAborted();
    // Ordinary submissions queue for the next bar. The adapter-declared sample
    // close may execute immediately and must return its complete new feedback.
    const omit = adapter.terminalSubmission === 'omit' && asOf === input.decisionBars.at(-1);
    const submitted = await adapter.submit(asOf, omit ? [] : intents);
    const executionAfterSubmission = submitted === undefined ? undefined : freezeStrategyData(submitted);
    if (executionAfterSubmission) {
      if(adapter.terminalSubmission!=='adapter'||asOf!==input.decisionBars.at(-1))throw new Error('Unexpected immediate submission execution');
      if (!executionAfterSubmission.account || Array.isArray(executionAfterSubmission.account)
        || !Array.isArray(executionAfterSubmission.positions) || !Array.isArray(executionAfterSubmission.feedback)) throw new Error('Invalid submission execution');
      // Feedback can update final state, but never rerun this bar's strategy decision.
      applyFeedback(executionAfterSubmission.feedback, asOf);
      terminalFeedbackEvents+=executionAfterSubmission.feedback.length;
    }
    const record = Object.freeze({ asOf, feedback, snapshot, state, intents,
      ...(omit && intents.length ? {submittedIntents: []} : {}),
      ...(executionAfterSubmission ? {executionAfterSubmission} : {}), plots: freezeStrategyData(step.plots ?? {}) });
    if (input.onRecord) await input.onRecord(record);
    if (input.recordMode !== 'stream') records.push(record);
    recordCount++;
  }
  return { candidateId: manifest.id, replayVersion: manifest.version, sdkVersion: 2 as const,
    ...(input.decisionClock ? {decisionClock: input.decisionClock} : {}),
    codeHash: input.codeHash, dataFingerprint: adapter.dataFingerprint, modelVersion: adapter.modelVersion,
    params, records, state, recordCount, recordMode: input.recordMode ?? 'retain',
    audit: { chronologicalLifecycle: true, feedbackBeforeDecision: terminalFeedbackEvents===0,
      scheduledFeedbackBeforeDecision:true,terminalFeedbackAfterDecision:terminalFeedbackEvents>0,
      scheduledFeedbackEvents,terminalFeedbackEvents,hostStateIsolated: true,
      executionAdapterRequired: true, researchOnly: true } };
  } finally {
    await adapter.close?.();
  }
}
