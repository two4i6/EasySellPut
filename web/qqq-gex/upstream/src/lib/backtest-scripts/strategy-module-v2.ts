/** Research-only bar strategy SDK. Separate from the v1 API orchestration protocol. */
export type StrategyJson = null | boolean | number | string | StrategyJson[] | { [key: string]: StrategyJson };
export type StrategyObject = { [key: string]: StrategyJson };
export type StrategyFeedback = {
  id: string;
  asOf: string;
  kind: 'fill' | 'close' | 'settle' | 'reject';
  payload: StrategyObject;
};
export type StrategySnapshot = {
  asOf: string;
  market: StrategyObject;
  account: StrategyObject;
  positions: StrategyObject[];
};
export type StrategyIntent =
  | { kind: 'open-spread'; key: string; contract: StrategyObject; risk: StrategyObject }
  | { kind: 'close-position'; key: string; positionId: string; reason: string;
      /** Minimum whole-position P&L after closing costs, before research multiplier. */
      minimumUnweightedPnl?: number };
export type StrategyStep = { state: StrategyJson; intents: StrategyIntent[]; plots?: StrategyObject };
export type BarStrategyModule = {
  manifest: {
    sdkVersion: 2;
    id: string;
    version: string;
    researchOnly: true;
    migration: { complete: boolean; missing: string[] };
  };
  params: StrategyObject;
  initialize(params: Readonly<StrategyObject>): StrategyJson;
  /** Pure as-of analytics plan; no data access, execution or mutable strategy state. */
  planObservations?(input: { asOf: string; params: Readonly<StrategyObject>;
    nativeState: Readonly<StrategyObject>; annualizedQqqRv20: number;
    sourceId?: string; account?: Readonly<StrategyObject> }): StrategyObject | null;
  onFeedback?(input: { state: StrategyJson; params: Readonly<StrategyObject>; feedback: Readonly<StrategyFeedback> }): StrategyJson;
  onBar(input: { state: StrategyJson; params: Readonly<StrategyObject>; snapshot: Readonly<StrategySnapshot> }): StrategyStep;
};

/** Reject lossy/non-data values instead of silently dropping them in JSON.stringify. */
export function assertStrategyData(value: unknown): void {
  assertStrategyDataGraph(value, 'strict');
}

/** Observation-only policy; strict strategy state never permits undefined. */
function assertStrategyDataGraph(value: unknown, policy:'strict'|'observation'|'seal',
  copies?:WeakMap<object,StrategyJson[]|StrategyObject>,
  prepared?:Map<object,{nodes:number;height:number}>,reuseImmutable=false):unknown {
  const normalizeObservation=policy==='observation',sealOwned=policy==='seal';
  const active = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number, objectField = false): unknown => {
    if (++nodes > 1_000_000) throw new Error('Strategy data graph exceeds node budget');
    if (depth > 64) throw new Error('Strategy data nesting exceeds 64');
    if (normalizeObservation && objectField && item === undefined) return;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object') throw new Error('Strategy data must be finite JSON');
    const immutable=immutableGraphSizes.get(item);
    if(immutable&&(!copies||reuseImmutable)){
      nodes+=immutable.nodes-1;
      if(nodes>1_000_000)throw new Error('Strategy data graph exceeds node budget');
      if(depth+immutable.height>64)throw new Error('Strategy data nesting exceeds 64');
      return item;
    }
    if(Array.isArray(item)&&Object.getPrototypeOf(item)!==Array.prototype)throw new Error('Strategy arrays must have plain prototypes');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error('Strategy data must be plain JSON');
    }
    if (active.has(item)) throw new Error('Strategy data contains a cycle');
    active.add(item);
    const existing=copies?.get(item);
    const result=copies?(existing??(Array.isArray(item)?[]:{})):undefined;
    if(copies&&!existing)copies.set(item,result!);
    let copiedNodes=1,copiedHeight=0;
    const include=(child:unknown)=>{
      if(!prepared||existing||child===undefined)return;
      const shape=child!==null&&typeof child==='object'?(prepared.get(child)??immutableGraphSizes.get(child))!:undefined;
      copiedNodes+=shape?.nodes??1;copiedHeight=Math.max(copiedHeight,(shape?.height??0)+1);
    };
    if (Object.getOwnPropertySymbols(item).length) throw new Error('Strategy data must not contain symbol keys');
    if (Array.isArray(item)) {
      if (item.length > 1_000_000) throw new Error('Strategy data graph exceeds node budget');
      const ownIndices=normalizeObservation||sealOwned;
      const keys = ownIndices ? Object.getOwnPropertyNames(item) : Object.keys(item);
      const extra=()=>keys.some(key => (ownIndices&&key==='length')?false:!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=item.length);
      // A dense observation has exactly length indices plus its length property.
      if((!normalizeObservation||keys.length!==item.length+1)&&extra())throw new Error('Strategy JSON arrays must not contain extra properties');
      for (let i = 0; i < item.length; i++) {
        const key=ownIndices?keys[i]!:String(i);
        const descriptor = ownIndices&&Number(key)!==i?undefined:Object.getOwnPropertyDescriptor(item,key);
        if (!descriptor || !('value' in descriptor)) {
          if(normalizeObservation&&extra())throw new Error('Strategy JSON arrays must not contain extra properties');
          throw new Error('Strategy data must not contain holes or getters');
        }
        if(sealOwned&&!descriptor.enumerable)throw Error('Hidden/accessor data cannot be sealed');
        const child=visit(descriptor.value, depth + 1);
        if(result&&!existing)(result as StrategyJson[]).push(child as StrategyJson);
        include(child);
      }
    } else {
      const descriptors=Object.getOwnPropertyDescriptors(item);
      for (const key of Object.keys(descriptors)) {
        const descriptor=descriptors[key]!;
        if(sealOwned&&!descriptor.enumerable)throw Error('Hidden/accessor data cannot be sealed');
        if (normalizeObservation && !('value' in descriptor)) throw new Error('Strategy data must not contain getters');
        if (normalizeObservation && !descriptor.enumerable) throw new Error('Hidden observation data cannot be normalized');
        if (!descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw new Error('Strategy data must not contain getters');
        const child=visit(descriptor.value, depth + 1, true);
        if(result&&!existing&&child!==undefined)Object.defineProperty(result,key,{value:child,enumerable:true,writable:true,configurable:true});
        include(child);
      }
    }
    active.delete(item);
    if(prepared&&result&&!existing)prepared.set(result,{nodes:copiedNodes,height:copiedHeight});
    return result;
  };
  return visit(value, 0);
}

/** Clone native observations, omitting only undefined enumerable object fields.
 * Descriptors avoid invoking accessors. Validate every alias path before copying
 * so clone memoization cannot bypass graph budgets. Never reuse simulator data,
 * even frozen/branded branches: the returned graph is fresh and safe to seal. */
export function normalizeObservationData(value: unknown): StrategyJson {
  return assertStrategyDataGraph(value,'observation',new WeakMap()) as StrategyJson;
}

/** Validate/copy mutable native data once. Opt-in reuse trusts only SDK-owned immutable subgraphs. */
export function freezeObservationData(value: unknown,reuseImmutable=false): StrategyJson {
  const prepared=new Map<object,{nodes:number;height:number}>();
  const copy=assertStrategyDataGraph(value,'observation',new WeakMap(),prepared,reuseImmutable) as StrategyJson;
  // Only fresh copies are listed; no graph is frozen until all validation succeeds.
  for(const [item,shape] of prepared){
    Object.freeze(item);immutableStrategyData.add(item);immutableGraphSizes.set(item,shape);
  }
  return copy;
}

export function copyStrategyData<T>(value: T): T {
  assertStrategyData(value);
  return structuredClone(value);
}

/** Fixed versioned artifacts must reject overrides they do not implement. */
const immutableStrategyData=new WeakSet<object>();
const immutableGraphSizes=new WeakMap<object,{nodes:number;height:number}>();
/** Only SDK-owned deep-frozen graphs qualify for immutable computation reuse. */
export function isImmutableStrategyData(value:unknown):value is StrategyJson[]|StrategyObject{
  return value!==null&&typeof value==='object'&&immutableStrategyData.has(value);
}
const validatedFixedParams=new WeakMap<object,WeakSet<object>>();
export function assertFixedStrategyParams(actual: Readonly<StrategyObject>, expected: Readonly<StrategyObject>): void {
  const immutable=immutableStrategyData.has(actual)&&immutableStrategyData.has(expected);
  if(immutable&&validatedFixedParams.get(expected)?.has(actual))return;
  assertStrategyData(actual);
  assertStrategyData(expected);
  const equal = (a: StrategyJson, b: StrategyJson): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((v,i) => equal(v,b[i]!));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && equal(a[k]!,b[k]!));
  };
  if (!equal(actual as StrategyObject,expected as StrategyObject)) throw new Error('Unsupported fixed strategy parameter override');
  if(immutable){let validated=validatedFixedParams.get(expected);
    if(!validated){validated=new WeakSet();validatedFixedParams.set(expected,validated);}validated.add(actual);}
}

export function freezeStrategyData<T>(value: T): T {
  if(value&&typeof value==='object'&&immutableStrategyData.has(value))return value;
  // Validate the complete graph, including shared branches, so depth/node limits
  // cannot be bypassed by wrapping previously validated immutable data.
  assertStrategyData(value);
  const copies=new WeakMap<object,object>();
  const clone=(item:unknown):unknown=>{
    if(!item||typeof item!=='object'||immutableStrategyData.has(item))return item;
    const existing=copies.get(item);if(existing)return existing;
    const result:unknown[]|Record<string,unknown>=Array.isArray(item)?[]:{};
    copies.set(item,result);
    if(Array.isArray(item)){
      for(let i=0;i<item.length;i++)(result as unknown[]).push(clone(Object.getOwnPropertyDescriptor(item,String(i))!.value));
      return result;
    }
    for(const key of Object.keys(item)){
      const descriptor=Object.getOwnPropertyDescriptor(item,key)!;
      Object.defineProperty(result,key,{value:clone(descriptor.value),enumerable:true,writable:true,configurable:true});
    }
    return result;
  };
  const copy = clone(value) as T;
  return freezeValidatedStrategyData(copy);
}

/** Finalize trusted completed execution evidence without duplicating its ledger.
 * This is irreversible: callers must never advance the execution book afterwards. */
export function sealStrategyData<T>(value:T):T{
  if(value&&typeof value==='object'&&immutableStrategyData.has(value))return value;
  assertStrategyDataGraph(value,'seal');
  return freezeValidatedStrategyData(value);
}
function freezeValidatedStrategyData<T>(value:T):T{
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object'||immutableStrategyData.has(item)) return;
    let nodes=1,height=0;
    for(const child of Array.isArray(item)?item:Object.values(item)){
      if(child&&typeof child==='object'){
        freeze(child);const shape=immutableGraphSizes.get(child)!;
        nodes+=shape.nodes;height=Math.max(height,shape.height+1);
      }else{nodes++;height=Math.max(height,1);}
    }
    Object.freeze(item);
    immutableStrategyData.add(item);
    // Only SDK-owned, fully validated frozen graphs qualify; alias paths still count.
    immutableGraphSizes.set(item,{nodes,height});
  };
  freeze(value);
  return value;
}

export function assertBarStrategyModule(value: unknown): asserts value is BarStrategyModule {
  const strategyModule = value as Partial<BarStrategyModule> | null;
  const manifest = strategyModule?.manifest;
  if (!manifest || manifest.sdkVersion !== 2 || manifest.researchOnly !== true
    || typeof manifest.id !== 'string' || !manifest.id.trim()
    || typeof manifest.version !== 'string' || !manifest.version.trim()
    || !manifest.migration || typeof manifest.migration.complete !== 'boolean'
    || !Array.isArray(manifest.migration.missing)
    || manifest.migration.missing.some(item => typeof item !== 'string')
    || typeof strategyModule?.initialize !== 'function' || typeof strategyModule.onBar !== 'function'
    || (strategyModule.onFeedback !== undefined && typeof strategyModule.onFeedback !== 'function')
    || (strategyModule.planObservations !== undefined && typeof strategyModule.planObservations !== 'function')
    || !strategyModule.params || Array.isArray(strategyModule.params) || typeof strategyModule.params !== 'object') {
    throw new Error('Invalid research bar strategy SDK v2 module');
  }
  copyStrategyData(strategyModule.params);
  if (!manifest.migration.complete || manifest.migration.missing.length) {
    throw new Error(`Strategy migration incomplete: ${manifest.migration.missing.join(', ') || manifest.id}`);
  }
}

export function assertStrategyStep(value: StrategyStep): void {
  assertStrategyData(value);
  if (!value || !Array.isArray(value.intents) || !('state' in value)) throw new Error('Invalid strategy step');
  const keys = new Set<string>();
  for (const intent of value.intents) {
    if (!intent || typeof intent.key !== 'string' || !intent.key || keys.has(intent.key)) throw new Error('Invalid/duplicate intent key');
    keys.add(intent.key);
    if (intent.kind === 'open-spread') {
      if (!intent.contract || Array.isArray(intent.contract) || typeof intent.contract !== 'object'
        || !intent.risk || Array.isArray(intent.risk) || typeof intent.risk !== 'object') throw new Error('Invalid spread intent');
    } else if (intent.kind === 'close-position') {
      if (typeof intent.positionId !== 'string' || !intent.positionId || typeof intent.reason !== 'string' || !intent.reason) {
        throw new Error('Invalid close intent');
      }
      if (intent.minimumUnweightedPnl !== undefined && (typeof intent.minimumUnweightedPnl !== 'number'
        || !Number.isFinite(intent.minimumUnweightedPnl) || intent.minimumUnweightedPnl < 0))
        throw new Error('Invalid profit close limit');
    } else throw new Error('Unknown strategy intent');
  }
}
