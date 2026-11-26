import {applyJsonResponseDelta,type JsonResponseDelta} from './jsonResponseDelta';
import {decodeExposureWire} from './qqqExposureWire';
import {parseExposureWireClient as parseExposureWire} from './qqqExposureWireClient';
type Page = { items?: unknown[]; bars?: unknown[]; hasMore?: boolean; nextPage?: number | null;
  page?: number; fingerprint?: string; error?: string; [key: string]: unknown };

export function qqqHistoryTimeout(url: URL): number {
  return url.pathname === '/api/analysis/qqq/gex/exposure' && !url.searchParams.get('expiryDate') ? 100_000 : 45_000;
}

/** Browser history transport: complete pagination, shared requests, bounded reuse. */
export function createQqqHistoryClient(fetcher: typeof fetch = fetch, now = Date.now, limits: {maxEntryBytes?:number;maxBytes?:number} = {}) {
  const cache = new Map<string, { value: Page; storedAt: number; until: number; bytes: number; etag?: string }>();
  // Do not pin a 100-MB all-expiry day in a second strong cache. Reuse it while
  // React still owns it; garbage collection is free to reclaim abandoned days.
  const weakCache=new Map<string,{reference:WeakRef<Page>;storedAt:number;until:number;etag?:string}>();
  // DTEs and the compact aggregate exceed the parsed-object cache. Retain
  // lossless wire text within a byte budget, so GC does not cause new DB reads.
  const archiveWire=new Map<string,{body:string;storedAt:number;until:number;etag?:string;lines:boolean}>();
  let archiveBytes=0;
  type Shared = { task:Promise<Page>; controller:AbortController; users:number };
  const pending = new Map<string, Shared>();
  const restoring = new Map<string, Shared>();
  // Derived scopes retain identity without keeping abandoned full days alive.
  const projections=new WeakMap<Page,Map<string,Page>>();
  const consume = async (entry:Shared, signal?:AbortSignal) => {
    entry.users++;
    let onAbort:(()=>void)|undefined;
    try {
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(!signal)return await entry.task;
      return await Promise.race([entry.task,new Promise<never>((_resolve,reject)=>{
        onAbort=()=>reject(new DOMException('Aborted','AbortError'));
        signal.addEventListener('abort',onAbort,{once:true});
      })]);
    } finally {
      if(onAbort)signal?.removeEventListener('abort',onAbort);
      entry.users--;
      if(!entry.users)entry.controller.abort();
    }
  };
  let bytes = 0;
  const remove = (key: string) => { const value = cache.get(key); if (value) bytes -= value.bytes; cache.delete(key);weakCache.delete(key); };
  const rememberWeak = (key:string,value:Page,stamp:{storedAt:number;until:number;etag?:string}) => {
    if(typeof WeakRef==='undefined')return;
    weakCache.delete(key);
    weakCache.set(key,{reference:new WeakRef(value),storedAt:stamp.storedAt,until:stamp.until,etag:stamp.etag});
    for(const [entryKey,entry] of weakCache)if(entry.until<=now()||!entry.reference.deref())weakCache.delete(entryKey);
    while(weakCache.size>4)weakCache.delete(weakCache.keys().next().value!);
  };
  return async function read<T>(path: string, options: { ttlMs?: number; signal?:AbortSignal; force?: boolean } = {}): Promise<T> {
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const url = new URL(path, 'http://qqq.local');
    // The transport always starts with page=1. Include that default in the
    // cache identity so callers spelling it explicitly share the same load.
    if (!url.searchParams.has('page')) url.searchParams.set('page', '1');
    url.searchParams.sort();
    const key = `${url.pathname}?${url.searchParams}`;
    const timeoutMs=qqqHistoryTimeout(url);
    // A fresh complete day already contains every recorded DTE. Reuse that
    // exact snapshot contract instead of requesting the same rows separately.
    if(url.pathname==='/api/analysis/qqq/gex/exposure'&&url.searchParams.get('expiryDate')&&!options.force){
      const allUrl=new URL(url);allUrl.searchParams.delete('expiryDate');allUrl.searchParams.sort();
      const allKey=`${allUrl.pathname}?${allUrl.searchParams}`;
      const strong=cache.get(allKey),weakAll=weakCache.get(allKey),all=strong?.value??weakAll?.reference.deref();
      const stamp=strong??weakAll;
      const own=cache.get(key)??weakCache.get(key)??archiveWire.get(key);
      if(all&&stamp&&stamp.storedAt>(own?.storedAt??-Infinity)&&stamp.until>now()&&stamp.storedAt+(options.ttlMs??30_000)>now()&&Array.isArray(all.items)){
        const expiry=url.searchParams.get('expiryDate')!;
        let scopes=projections.get(all);
        const existing=scopes?.get(expiry);
        if(existing)return existing as T;
        const items=all.items.filter(item=>(item as {expiryDate?:string}).expiryDate===expiry);
        if(items.length){
          scopes??=new Map();const value={...all,items};scopes.set(expiry,value);
          projections.set(all,scopes);return value as T;
        }
      }
    }
    const wire=archiveWire.get(key);
    let weak=weakCache.get(key);
    let weakValue=weak?.reference.deref();
    // Restoration uses the same pending/cancellation contract as a network
    // read, including cooperative decoding of compact archives.
    let wireValue:Page|undefined;
    if(wire&&!weakValue&&!cache.has(key)){
      let entry=restoring.get(key);
      if(!entry||entry.controller.signal.aborted){
        const controller=new AbortController();
        const task=(wire.lines?parseExposureWire(wire.body,controller.signal) as Promise<Page>:decodeExposureWire(JSON.parse(wire.body) as Page,controller.signal)).then(value=>{
          controller.signal.throwIfAborted();
          const restored={...value,hasMore:false,nextPage:null};rememberWeak(key,restored,wire);return restored;
        });
        entry={task,controller,users:0};restoring.set(key,entry);
        const current=entry,cleanup=()=>{if(restoring.get(key)===current)restoring.delete(key);};void task.then(cleanup,cleanup);
      }
      wireValue=await consume(entry,options.signal);weak=weakCache.get(key);weakValue=wireValue;
    }
    // A DTE restored from the wire archive must keep its parsed identity while
    // React owns it. Otherwise every refresh reparses megabytes on the UI thread.
    const cached = cache.get(key) ?? (weak&&weakValue?{value:weakValue,storedAt:weak.storedAt,until:weak.until,etag:weak.etag,bytes:0}:wire&&wireValue?{value:wireValue,storedAt:wire.storedAt,until:wire.until,etag:wire.etag,bytes:0}:undefined);
    if (!options.force && cached && cached.until > now() && cached.storedAt + (options.ttlMs ?? 30_000) > now()) {
      if(cache.has(key)){cache.delete(key);cache.set(key,cached);}
      if(wire){archiveWire.delete(key);archiveWire.set(key,wire);}
      return cached.value as T;
    }
    // Keep the expired body until revalidation completes; 304 has no JSON body.
    const existing = pending.get(key);
    if (existing && !existing.controller.signal.aborted) return consume(existing,options.signal) as Promise<T>;
    const controller=new AbortController();
    const request = (async () => {
      let first: Page | undefined;
      let pageNumber = Number(url.searchParams.get('page') ?? '1');
      const items: unknown[] = []; const bars: unknown[] = [];
      let etag: string | undefined;
      let wireCharacters=0, patched=false;
      for (;;) {
        url.searchParams.set('page', String(pageNumber));
        const response = await fetcher(`${url.pathname}?${url.searchParams}`, { cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs),controller.signal]),
          headers: cached?.etag ? {'if-none-match':cached.etag, ...(url.pathname==='/api/analysis/qqq/gex/exposure'?{'x-qqq-exposure-if-none-match':cached.etag}:{}), ...(url.searchParams.get('gexDisplay')==='1' ? {'x-qqq-gex-delta':'1'} : {})} : undefined });
        controller.signal.throwIfAborted();
        if(response.status===304) {
          if(!cached)throw Error('服务返回未变化但没有本地数据');
          cached.storedAt=now();cached.until=now()+(options.ttlMs??30_000);
          if(weak){weak.storedAt=cached.storedAt;weak.until=cached.until;}
          if(wire){wire.storedAt=cached.storedAt;wire.until=cached.until;}
          return cached.value;
        }
        if(!first)etag=response.headers.get('etag')??undefined;
        const body=await response.text();
        controller.signal.throwIfAborted();
        wireCharacters+=body.length;
        const lines=response.headers.get('content-type')?.includes('application/x-ndjson')??false;
        let page = lines?await parseExposureWire(body,controller.signal) as Page:await decodeExposureWire(JSON.parse(body) as Page,controller.signal);
        if(response.headers.get('x-qqq-gex-delta')==='1') {
          patched=true;
          const patch=page as unknown as JsonResponseDelta;
          if(!cached || patch.baseEtag!==cached.etag || patch.qqqDisplayDelta!==true){remove(key);throw Error('展示数据版本不匹配，请重试');}
          page=applyJsonResponseDelta(cached.value,patch) as Page;
        }
        if (!response.ok) throw new Error(page.error ?? `History HTTP ${response.status}`);
        const archiveBudget=url.searchParams.get('expiryDate')?24*1024*1024:lines?128*1024*1024:0;
        if(url.pathname==='/api/analysis/qqq/gex/exposure'&&!page.hasMore&&pageNumber===1&&body.length*2<=archiveBudget){
          const old=archiveWire.get(key);if(old)archiveBytes-=old.body.length*2;
          archiveWire.delete(key);archiveWire.set(key,{body,storedAt:now(),until:now()+(options.ttlMs??30_000),etag,lines});archiveBytes+=body.length*2;
          while(archiveBytes>192*1024*1024||archiveWire.size>16){const firstKey=archiveWire.keys().next().value!;archiveBytes-=archiveWire.get(firstKey)!.body.length*2;archiveWire.delete(firstKey);}
        }
        if (first?.fingerprint && first.fingerprint !== page.fingerprint) throw new Error('历史数据在分页期间发生变化，请重试');
        first ??= page;
        if (page.items) items.push(...page.items);
        if (page.bars) bars.push(...page.bars);
        if (!page.hasMore) break;
        const next = page.nextPage ?? pageNumber + 1;
        if (!Number.isSafeInteger(next) || next <= pageNumber) throw new Error('无效历史分页游标');
        pageNumber = next;
      }
      if (!first) throw new Error('历史响应为空');
      const value = { ...first, ...(first.items ? { items } : {}), ...(first.bars ? { bars } : {}), hasMore: false, nextPage: null };
      // Budget is a conservative estimate for parsed object storage.
      // Count the complete received JSON rather than serializing a large parsed
      // archive a second time on the UI thread. Delta responses need the full base.
      const size = (patched ? JSON.stringify(value).length : wireCharacters+128) * 4;
      for (const [entryKey, entry] of cache) if (entry.until <= now()) remove(entryKey);
      // A full 195-bucket day can exceed 10 MB of JSON for one expiry.
      // Retain at most a few complete days, rather than refetching on every switch.
      if (!archiveWire.has(key) && size <= (limits.maxEntryBytes??64 * 1024 * 1024)) {
        const storedAt = now();
        remove(key);cache.set(key, { value, storedAt, until: storedAt + (options.ttlMs ?? 30_000), bytes: size,etag }); bytes += size;
        while (cache.size > 16 || bytes > (limits.maxBytes??96 * 1024 * 1024)) remove(cache.keys().next().value!);
      } else if(typeof WeakRef!=='undefined') {
        remove(key);
        rememberWeak(key,value,{storedAt:now(),until:now()+(options.ttlMs??30_000),etag});
      }
      return value;
    })().catch(error => {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`请求超时（${timeoutMs/1000} 秒），请重试；已有数据不会被清空。`);
      throw error;
    });
    const entry:Shared={task:request,controller,users:0};
    pending.set(key,entry);
    const cleanup=()=>{if(pending.get(key)===entry)pending.delete(key);};
    void request.then(cleanup,cleanup);
    return consume(entry,options.signal) as Promise<T>;
  };
}

export const readQqqHistoryClient = createQqqHistoryClient();
