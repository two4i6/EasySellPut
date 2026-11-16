import { gzip, gunzipSync } from 'node:zlib';
import {promisify} from 'node:util';
import { createHash } from 'node:crypto';
import {jsonResponseDelta} from './jsonResponseDelta';

type Envelope = { body: string | Buffer; status: number; headers: Array<[string, string]>; bytes: number };
export type ResponseCacheEntry = { value: Envelope; expiresAt: number };
type Entry=ResponseCacheEntry;
const compress=promisify(gzip);

/** Object key order must not create duplicate work for the same JSON request. */
export function canonicalJsonRequestKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item) ?? 'null';
}

/** Bounded L1 with an optional disposable shared cache; no Supabase writes. */
export function createResponseCache(options: {
  maxEntries?: number; maxBytes?: number; maxEntryBytes?: number; maxBodyBytes?: number; now?: () => number;
  /** A source revision check; false/errors always fall back to a complete read. */
  revalidate?: (key: string, headers: Headers) => Promise<boolean>;
  /** Versioned archives require validation even inside their freshness TTL. */
  validateFresh?: boolean;
  generation?:()=>Promise<string>;
  shared?: {get:(key:string)=>Promise<Entry|null>;set:(key:string,entry:Entry)=>Promise<unknown>};
} = {}) {
  const maxEntries = options.maxEntries ?? 32;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const maxEntryBytes = options.maxEntryBytes ?? 4 * 1024 * 1024;
  const maxBodyBytes = options.maxBodyBytes ?? 32 * 1024 * 1024;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Envelope>>();
  const sharedReads=new Map<string,Promise<Entry|null>>();
  let retainedBytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) retainedBytes -= entry.value.bytes;
    entries.delete(key);
  };
  const retain = (key: string, value: Envelope, ttlMs: number) => {
    // TTL forbids serving without validation; it does not discard another
    // bounded candidate before that source can cheaply validate its revision.
    remove(key); entries.set(key, { value, expiresAt: now() + ttlMs }); retainedBytes += value.bytes;
    while (entries.size > maxEntries || retainedBytes > maxBytes) remove(entries.keys().next().value!);
  };
  const reply = (value: Envelope, cache: string, ifNoneMatch?: string | null, base?:Envelope, acceptEncoding?:string|null) => {
    const unchanged = Boolean(ifNoneMatch && value.status === 200
      && value.headers.some(([key, etag]) => key === 'etag' && etag.replace(/^W\//,'') === ifNoneMatch?.replace(/^W\//,'')));
    // Archive routes can send the already-retained gzip bytes. Avoid inflating
    // tens of MB and recompressing them for each replay consumer/cache hit.
    const acceptsGzip=Boolean(acceptEncoding?.split(',').some(part=>{
      const [encoding,...params]=part.trim().toLowerCase().split(';');
      const quality=params.find(param=>param.trim().startsWith('q='));
      const q=quality?Number(quality.trim().slice(2)):1;
      return encoding==='gzip'&&Number.isFinite(q)&&q>0&&q<=1;
    }));
    let gzip=Boolean(!unchanged&&!base&&typeof value.body!=='string'&&acceptsGzip);
    let body=unchanged||gzip?null:typeof value.body === 'string' ? value.body : gunzipSync(value.body).toString('utf8');
    let delta=false;
    if(body && value.status===200 && base?.headers.some(([name,etag])=>name==='etag'&&etag.replace(/^W\//,'')===ifNoneMatch?.replace(/^W\//,''))){
      const oldBody=typeof base.body==='string'?base.body:gunzipSync(base.body).toString('utf8');
      const patch=JSON.stringify(jsonResponseDelta(JSON.parse(oldBody),JSON.parse(body),ifNoneMatch!));
      if(patch.length<body.length*.8){body=patch;delta=true;}
    }
    // A patch can exceed the full JSON budget. Keep the fallback compressed
    // too; negotiating delta must not disable gzip for large live updates.
    if(!unchanged&&!delta&&typeof value.body!=='string'&&acceptsGzip){gzip=true;body=null;}
    const headers=new Headers(value.headers);
    headers.set('x-cache',cache);headers.set('cache-control','no-store');
    if(acceptEncoding!==undefined){
      const vary=headers.get('vary');headers.set('vary',vary?`${vary}, Accept-Encoding`:'Accept-Encoding');
      // This validator identifies canonical decoded JSON across encodings,
      // rather than claiming byte identity between gzip and plain responses.
      const etag=headers.get('etag');if(etag&&!etag.startsWith('W/'))headers.set('etag',`W/${etag}`);
    }
    if(gzip)headers.set('content-encoding','gzip');
    if(delta)headers.set('x-qqq-gex-delta','1');
    return new Response(gzip?new Uint8Array(value.body as Buffer):body, {
      status: unchanged ? 304 : value.status,
      headers,
    });
  };
  return {
    async run(key: string, load: () => Promise<Response>, ttlMs: number, ifNoneMatch?: string | null, delta=false, acceptEncoding?:string|null): Promise<Response> {
      const sourceKey=key;
      if(options.generation)try{key=canonicalJsonRequestKey({generation:await options.generation(),key});}catch{}
      let cached = entries.get(key);
      if(!cached&&options.shared){
        let lookup=sharedReads.get(key);
        if(!lookup&&sharedReads.size<maxEntries){lookup=options.shared.get(key).catch(()=>null);sharedReads.set(key,lookup);const owned=lookup;void owned.finally(()=>{if(sharedReads.get(key)===owned)sharedReads.delete(key);}).catch(()=>{});}
        let shared:Entry|null=null;try{shared=lookup?await lookup:null;}catch{/* Cache failure must not block source reads. */}
        cached=entries.get(key);
        if(!cached&&shared&&shared.value.status===200&&shared.value.bytes<=maxEntryBytes&&shared.value.bytes<=maxBytes){
          retain(key,shared.value,shared.expiresAt-now());cached=entries.get(key);
        }
      }
      if(cached && cached.expiresAt>now() && options.validateFresh && options.revalidate){
        let valid=false;try{valid=await options.revalidate(sourceKey,new Headers(cached.value.headers));}catch{/* Source unavailable cannot bless this candidate. */}
        if(!valid){remove(key);cached=undefined;}
      }
      if (cached && cached.expiresAt > now()) {
        entries.delete(key); entries.set(key, cached);
        return reply(cached.value, 'HIT',ifNoneMatch,undefined,acceptEncoding);
      }
      remove(key);
      const inFlight = pending.get(key);
      if (inFlight) return reply(await inFlight, 'INFLIGHT',ifNoneMatch,undefined,acceptEncoding);
      const request = (async () => {
        if (cached && ttlMs > 0 && options.revalidate) {
          let unchanged = false;
          try { unchanged = await options.revalidate(sourceKey, new Headers(cached.value.headers)); }
          catch { /* A failed revision probe must never bless old data. */ }
          if (unchanged) { retain(key, cached.value, ttlMs);if(options.shared)try{await options.shared.set(key,{value:cached.value,expiresAt:now()+ttlMs});}catch{}return cached.value; }
        }
        const response = await load();
        const body = await response.text();
        const headers = [...response.headers.entries()].filter(([name]) => name !== 'content-length' && name !== 'content-encoding');
        if(response.status===200 && ifNoneMatch!==undefined && !headers.some(([name])=>name==='etag')) { const etag='"'+createHash('sha256').update(body).digest('hex')+'"';
          const existing=headers.findIndex(([name])=>name==='etag');if(existing>=0)headers.splice(existing,1);headers.push(['etag',etag]); }
        const bodyBytes = Buffer.byteLength(body);
        // Lossless, fast compression keeps a complete day's profiles cacheable.
        // Transport is either exact UTF-8 JSON or negotiated lossless gzip.
        // Large cold archives must not hold the API event loop while zlib runs.
        const retainedBody = ttlMs > 0 && bodyBytes >= 64 * 1024 && bodyBytes <= maxBodyBytes ? await compress(body, { level: 1 }) : body;
        const bytes = (typeof retainedBody === 'string' ? Math.max(body.length * 2, bodyBytes) : retainedBody.byteLength) + JSON.stringify(headers).length * 2;
        const value: Envelope = { body: retainedBody, status: response.status, headers, bytes };
        if (response.status === 200 && ttlMs > 0 && bodyBytes <= maxBodyBytes && bytes <= maxEntryBytes && bytes <= maxBytes) {
          retain(key, value, ttlMs);
          if(options.shared)try{await options.shared.set(key,{value,expiresAt:now()+ttlMs});}catch{/* Cache failure cannot fail a valid response. */}
        }
        return value;
      })();
      pending.set(key, request);
      try {
        const value = await request;
        return reply(value, ttlMs > 0 ? 'MISS' : value.headers.find(([name]) => name === 'x-cache')?.[1] ?? 'MISS',ifNoneMatch,delta?cached?.value:undefined,acceptEncoding);
      }
      finally { if (pending.get(key) === request) pending.delete(key); }
    },
  };
}
