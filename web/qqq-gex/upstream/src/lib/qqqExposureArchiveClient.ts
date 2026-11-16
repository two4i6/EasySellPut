import type { ExposureArchiveManifest } from './qqqExposureArchive';
import { exposureArchiveWindow } from './qqqExposureArchive';
import type { ExposureHistoryDay } from './qqqExposureHistoryModel';
import { qqqMarketDateBounds } from './qqqMarketDate';

type Options = { signal: AbortSignal; ttlMs: number; force?: boolean; previous?: ExposureHistoryDay | null; onProgress?: (day: ExposureHistoryDay) => void; initialManifest?: ExposureArchiveManifest };
type Reader = <T>(path: string, options: { signal: AbortSignal; ttlMs: number; force?: boolean }) => Promise<T>;
const complete = new Map<string, { day: WeakRef<ExposureHistoryDay>; storedAt: number; until: number }>();
const projections = new WeakMap<ExposureHistoryDay, Map<string, ExposureHistoryDay>>();
const owner = Symbol('complete exposure archive');
const chunkOwners = new WeakMap<ExposureHistoryDay, {date:string;expiry:string|null;parts:Map<string,ExposureHistoryDay>}>();
const partKey = (part:ExposureArchiveManifest['windows'][number]) => JSON.stringify([part.from,part.to,part.version]);

/** Two bounded readers; publish recent observations first and complete history
 * only after every chunk version and the closing day revision agree. */
export async function readQqqExposureArchive(date: string, expiry: string | null, read: Reader, options: Options): Promise<ExposureHistoryDay> {
  options.signal.throwIfAborted();
  const prior = options.force ? null : options.previous ?? complete.get(`${date}:${expiry??'all'}`)?.day.deref();
  const candidate = prior ? chunkOwners.get(prior) : null;
  const retained = candidate?.date===date&&candidate.expiry===expiry ? candidate : null;
  const previous = retained ? prior : null;
  if (options.force) complete.clear();
  for (const [key, entry] of complete) if (!key.startsWith(date + ':') || entry.until <= Date.now() || !entry.day.deref()) complete.delete(key);
  const fresh = (key:string) => {
    const entry=complete.get(key);
    return entry && entry.until>Date.now() && entry.storedAt+options.ttlMs>Date.now() ? entry.day.deref() : undefined;
  };
  if (!options.force) {
    const cached=fresh(`${date}:${expiry??'all'}`);if(cached)return cached;
    const all=expiry?fresh(`${date}:all`):undefined;
    if (all && expiry) {
      let scopes=projections.get(all);if(!scopes){scopes=new Map();projections.set(all,scopes);}
      const known=scopes.get(expiry);if(known)return known;
      const projected={...all,items:all.items.filter(row=>row.expiryDate===expiry)};
      // Keep the weak owner's envelope alive only while a visible projection
      // uses it. Abandoned pages remain collectible, including this cycle.
      Object.defineProperty(projected,owner,{value:all});scopes.set(expiry,projected);
      return projected;
    }
  }
  const base = `/api/analysis/qqq/gex/exposure?date=${encodeURIComponent(date)}${expiry ? `&expiryDate=${encodeURIComponent(expiry)}` : ''}`;
  const manifestPath = base + '&format=manifest-v2';
  const index = async (initial?:ExposureArchiveManifest) => {
    const value = initial ?? await read<ExposureArchiveManifest>(manifestPath, { signal:options.signal,ttlMs:options.ttlMs,force:true });
    if (value.date !== date || !value.revision || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.windows) || value.windows.length > 25) throw Error('Invalid exposure manifest');
    const seen = new Set<string>();
    for (const part of value.windows) {
      const window = exposureArchiveWindow(date, part.from, part.to);
      if (!window || !/^[a-f0-9]{64}$/.test(part.version) || seen.has(part.from) || Date.parse(part.to) > Date.parse(value.observedAt)) throw Error('Invalid exposure window');
      seen.add(part.from);
    }
    if(value.bars!==undefined){
      const bounds=qqqMarketDateBounds(date);
      const seenBars=new Set<string>();
      if(!Array.isArray(value.bars)||value.bars.length>1000||value.bars.some(bar=>{
        const at=Date.parse(bar.timestamp),invalid=!Number.isFinite(at)||at<Date.parse(bounds.from)||at>=Date.parse(bounds.to)||at+120_000>Date.parse(value.observedAt)||!Number.isFinite(bar.close)||bar.close<=0||seenBars.has(bar.timestamp);
        seenBars.add(bar.timestamp);return invalid;
      }))throw Error('Invalid exposure prices');
    }
    return value;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal.throwIfAborted();
    const manifest = await index(attempt===0?options.initialManifest:undefined);
    if (!options.force && previous?.revision === manifest.revision) return previous;
    const chunks: ExposureHistoryDay[] = new Array(manifest.windows.length);
    const parts=new Map<string,ExposureHistoryDay>();
    let next = 0, failure: unknown;
    const controller = new AbortController(), signal = AbortSignal.any([options.signal, controller.signal]);
    await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, async () => {
      while (!signal.aborted && next < chunks.length) {
        const position = next++, part = manifest.windows[position];
        try {
          const day = (attempt===0&&!options.force?retained?.parts.get(partKey(part)):null) ?? await read<ExposureHistoryDay>(`${base}&format=lines-v2&from=${encodeURIComponent(part.from)}&to=${encodeURIComponent(part.to)}&source=${part.version}`, { ttlMs: options.ttlMs, signal, force: options.force || attempt > 0 });
          if (day.date !== date || !Array.isArray(day.items) || !Array.isArray(day.bars) || day.items.some(row => Date.parse(row.capturedAt) < Date.parse(part.from) || Date.parse(row.capturedAt) >= Date.parse(part.to) || expiry && row.expiryDate !== expiry)) throw Error('Invalid exposure chunk');
          chunks[position] = day;parts.set(partKey(part),day);
          if (position === 0 && attempt === 0) options.onProgress?.({ ...day, bars:manifest.bars??day.bars, observedAt: manifest.observedAt, revision: manifest.revision });
        } catch (error) { failure ??= error; controller.abort(); }
      }
    }));
    options.signal.throwIfAborted();
    if (failure) throw failure;
    if ((await index()).revision !== manifest.revision) continue;
    const items = chunks.flatMap(chunk => chunk.items).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.expiryDate.localeCompare(b.expiryDate));
    if (new Set(items.map(row => `${Date.parse(row.capturedAt)}:${row.expiryDate}`)).size !== items.length) throw Error('Duplicate exposure captures');
    const bars = (manifest.bars??chunks.flatMap(chunk => chunk.bars)).filter(bar => Date.parse(bar.timestamp) + 120_000 <= Date.parse(manifest.observedAt)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const day={ date, observedAt: manifest.observedAt, revision: manifest.revision, items, bars };
    chunkOwners.set(day,{date,expiry,parts});
    const storedAt=Date.now();complete.set(`${date}:${expiry??'all'}`,{day:new WeakRef(day),storedAt,until:storedAt+options.ttlMs});
    while(complete.size>4)complete.delete(complete.keys().next().value!);
    return day;
  }
  throw Error('Exposure source changed during chunked read; retry');
}

/** Warm the exact scope selected by the historical day RPC, concurrently with
 * that RPC. Failures remain optional: the visible archive retries normally. */
export async function preloadQqqExposureArchive(date:string,expiry:string|null,all:boolean,read:Reader,options:Options & {beforeProfiles?:()=>Promise<unknown>}) {
  const guide=await read<ExposureArchiveManifest>(`/api/analysis/qqq/gex/exposure?date=${encodeURIComponent(date)}&format=manifest-v2`,{signal:options.signal,ttlMs:options.ttlMs,force:options.force});
  if(guide.date!==date||!Array.isArray(guide.expiries)||guide.expiries.some(e=>!/^\d{4}-\d{2}-\d{2}$/.test(e))||guide.expiries.length>32)throw Error('Invalid exposure expiry index');
  await options.beforeProfiles?.();
  options.signal.throwIfAborted();
  const selected=expiry&&guide.expiries.includes(expiry)?expiry:guide.expiries.slice().sort()[0];
  if(!all&&!selected)return null;
  return readQqqExposureArchive(date,all?null:selected!,read,{...options,...(all?{initialManifest:guide}:{})});
}
