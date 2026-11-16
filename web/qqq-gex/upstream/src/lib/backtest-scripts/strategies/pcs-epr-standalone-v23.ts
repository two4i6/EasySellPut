/** Research composition: independent child books propose; the adapter arbitrates future fills. */
import { assertFixedStrategyParams, freezeStrategyData, type BarStrategyModule, type StrategyJson,
  type StrategyObject, type StrategySnapshot, type StrategyIntent } from '../strategy-module-v2';
import {e10576StandaloneV1} from './e10576-standalone-v1';
import {p11262StandaloneV1} from './p11262-standalone-v1';
import {r2465StandaloneV1 as defaultR} from './r2465-simplified-v2';
import { E209_SOURCE_BOOKS } from './e209-source-contract-v1';
import {R9_E226_SOURCE_CONTRACT} from './r9-e226-source-contract-v1';

export function createEpr10576P11262R2465Composition(r2465StandaloneV1:BarStrategyModule=defaultR):BarStrategyModule{
if(r2465StandaloneV1.manifest.id!=='R2465'||r2465StandaloneV1.params.selectedPolicyMarginLimit!==null)throw Error('Expected complete R2465 child');
const layers = ['e', 'p', 'r'] as const;
const PCS_EPR_10576_11262_R2465_PARAMS = freezeStrategyData({
  lineage: ['E10576', 'P11262', 'R2465'], priority: [...layers],
  executionVersion: 'epr-future-bar-priority-v1',commissionPerContract:0,rParams:r2465StandaloneV1.params,
  childVersions: { e: e10576StandaloneV1.manifest.version,
    p: p11262StandaloneV1.manifest.version, r: r2465StandaloneV1.manifest.version },
});
const children = { e: e10576StandaloneV1, p: p11262StandaloneV1, r: r2465StandaloneV1 };
const shadowIds = { e: 'e209', p: 'p6', r: 'r9' } as const;
type Layer = keyof typeof children;
type State = Record<Layer, StrategyJson>;
type Book = Pick<StrategySnapshot, 'market' | 'account' | 'positions'>;
function assertParams(params: Readonly<StrategyObject>) {
  assertFixedStrategyParams(params, PCS_EPR_10576_11262_R2465_PARAMS);
  for (const layer of layers) if (children[layer].manifest.version !== PCS_EPR_10576_11262_R2465_PARAMS.childVersions[layer])
    throw new Error(`EPR child version mismatch: ${layer}`);
}
function unwrap(value: string, layer: Layer) {
  const prefix = `epr-${layer}:`;
  if (!value.startsWith(prefix) || value.length === prefix.length) throw new Error(`Invalid EPR ${layer} namespace`);
  return value.slice(prefix.length);
}
function childBook(books: Record<string, Book>, id: string, layer: Layer): Book {
  const book = books[id];
  if (!book || !book.market || !book.account || !Array.isArray(book.positions)) throw new Error(`Missing EPR source book: ${id}`);
  return { ...book, positions: book.positions.map(position => ({ ...position, id: unwrap(String(position.id), layer) })) };
}

return {
  manifest: { sdkVersion: 2, id: 'PCS.EPR', version: 'pcs-epr-e10576-p11262-r2465-zero-cost-v1', researchOnly: true,
    migration: { complete: true, missing: [] } },
  params: PCS_EPR_10576_11262_R2465_PARAMS,
  initialize(params) {
    assertParams(params);
    return Object.fromEntries(layers.map(layer => [layer, children[layer].initialize(children[layer].params)]));
  },
  planObservations(input) {
    assertParams(input.params);
    const child = input.sourceId === shadowIds.p ? children.p : input.sourceId === R9_E226_SOURCE_CONTRACT.contextSource ? children.r : null;
    return child?.planObservations?.({ ...input, params: child.params }) ?? null;
  },
  onFeedback({ state, params, feedback }) {
    assertParams(params);
    const source = feedback.payload.sourceAccount;
    if (source === undefined || source === 'portfolio') return state;
    const layer: Layer | undefined = source === shadowIds.e || E209_SOURCE_BOOKS.some(id => id === source) ? 'e'
      : source === shadowIds.p ? 'p' : source === shadowIds.r || source === R9_E226_SOURCE_CONTRACT.contextSource ? 'r' : undefined;
    if (!layer) throw new Error(`Unknown EPR feedback source: ${String(source)}`);
    const child = children[layer], payload = { ...feedback.payload };
    for (const key of ['key', 'positionId']) if (typeof payload[key] === 'string') payload[key] = unwrap(payload[key], layer);
    let id = feedback.id;
    if (source === shadowIds[layer]) {
      if (!id.startsWith(`${source}:`)) throw new Error('Invalid EPR source feedback namespace');
      id = id.slice(source.length + 1);
      // P6's native single-book feedback has no sourceAccount field.
      if (layer === 'p') delete payload.sourceAccount;
      else payload.sourceAccount = 'portfolio';
    }
    const s = state as State;
    return { ...s, [layer]: child.onFeedback?.({ state: s[layer], params: child.params,
      feedback: { ...feedback, id, payload } }) ?? s[layer] };
  },
  onBar({ state, params, snapshot }) {
    assertParams(params);
    const books = snapshot.market.sourceAccounts as unknown as Record<string, Book>;
    if (!books || typeof books !== 'object' || Array.isArray(books)) throw new Error('Missing EPR source books');
    const next = { ...state as State }, intents: StrategyIntent[] = [], plots: StrategyObject = {};
    for (const [priority, layer] of layers.entries()) {
      const child = children[layer], book = childBook(books, shadowIds[layer], layer);
      const sources = layer === 'e' ? Object.fromEntries(E209_SOURCE_BOOKS.map(id => [id, childBook(books, id, layer)]))
        : layer === 'r' ? { [R9_E226_SOURCE_CONTRACT.contextSource]: childBook(books,R9_E226_SOURCE_CONTRACT.contextSource,layer) } : null;
      const market = { ...book.market };
      delete market.sourceAccounts;
      if (sources) market.sourceAccounts = sources as unknown as StrategyObject;
      const step = child.onBar({ state: next[layer], params: child.params,
        snapshot: { asOf: snapshot.asOf, ...book, market } });
      next[layer] = step.state;
      const proposed: string[] = [];
      for (const intent of step.intents) {
        const key = `epr-${layer}:${intent.key}`;
        if (intent.kind === 'open-spread') {
          const source = intent.risk.sourceAccount ?? 'portfolio';
          intents.push({ ...intent, key, risk: { ...intent.risk,
            sourceAccount: source === 'portfolio' ? shadowIds[layer] : source } });
          if (source === 'portfolio') {
            const key = `epr-portfolio-${layer}:${intent.key}`;
            proposed.push(key);
            intents.push({ ...intent, key, risk: { ...intent.risk, sourceAccount: 'portfolio',
              executionPolicy: layer, openingPriority: priority,
              ...(layer==='p'&&intent.risk.researchSleeve==='extra'?{openingParentKey:key.slice(0,-':research-extra'.length)}:{}) } });
          }
        } else {
          intents.push({ ...intent, key, positionId: `epr-${layer}:${intent.positionId}` });
          if (book.positions.some(position => position.id === intent.positionId)) {
            const positionId = `epr-portfolio-${layer}:${intent.positionId}`;
            if (snapshot.positions.some(position => position.id === positionId))
              intents.push({ ...intent, key: `epr-portfolio-${layer}:${intent.key}`, positionId });
          }
        }
      }
      plots[layer] = { eligible: proposed.length > 0,
        reason: step.plots?.reason ?? step.plots?.selectedSource ?? 'no-portfolio-proposal', proposedKeys: proposed,
        ...(step.plots?.gates?{gates:step.plots.gates}:{}) };
    }
    return { state: next, intents, plots };
  },
};

}
export const pcsEprStandaloneV23=createEpr10576P11262R2465Composition();
