import {expect,test} from 'bun:test';
import {exposureArchiveManifest,exposureArchiveWindow,exposureWindowVersion} from './qqqExposureArchive';
import type {SourceManifest} from './qqqVersionedHistoryStore';

test('archive manifests seek recent profiles first, preserve DST and bind revisions to every row',async()=>{
 const source:SourceManifest={revision:'r1',items:[{captured_at:'2026-11-01T14:30:00Z',expiry_date:'2026-11-02',version:'a'}],bars:[{bar_at:'2026-11-01T23:00:00Z',version:'b'}]};
 const manifest=await exposureArchiveManifest('2026-11-01',source,'2026-11-02T06:00:00Z');
 expect(manifest.windows).toHaveLength(2);expect(manifest.windows[0].profiles).toBe(true);
 expect(exposureArchiveWindow('2026-11-01','2026-11-02T04:00:00Z','2026-11-02T05:00:00Z')).toBeDefined();
 expect(()=>exposureArchiveWindow('2026-11-01','2026-11-02T04:00:00Z','2026-11-02T05:01:00Z')).toThrow();
 expect(()=>exposureArchiveWindow('2026-11-01','2026-11-01T13:00:00Z','2026-11-01T15:00:00Z')).toThrow();
 const reordered={...source,items:[...source.items].reverse()};expect(await exposureWindowVersion(reordered)).toBe(await exposureWindowVersion(source));
 expect(await exposureWindowVersion({...source,items:[{...source.items[0],version:'repair'}]})).not.toBe(await exposureWindowVersion(source));
 expect(await exposureWindowVersion({...source,items:[]})).not.toBe(await exposureWindowVersion(source));
});

test('v2 consolidates causal prices and removes price-only windows without changing profile versions',async()=>{
 const source:SourceManifest={revision:'p1',items:[{captured_at:'2026-10-15T14:30:00Z',expiry_date:'2026-10-16',version:'a'}],bars:[{bar_at:'2026-10-15T08:00:00Z',version:'b'},{bar_at:'2026-10-15T14:30:00Z',version:'c'}]};
 const bars=[{timestamp:'2026-10-15T08:00:00Z',close:750,volume:1},{timestamp:'2026-10-15T14:30:00Z',close:751,volume:2},{timestamp:'2026-10-15T14:31:00Z',close:752,volume:3}];
 const old=await exposureArchiveManifest('2026-10-15',source,'2026-10-15T14:32:00Z');
 const next=await exposureArchiveManifest('2026-10-15',source,'2026-10-15T14:32:00Z',bars);
 expect(old.windows).toHaveLength(2);expect(next.windows).toEqual(old.windows.filter(p=>p.profiles));
 expect(next.bars).toEqual(bars.slice(0,2));expect(next.expiries).toEqual(['2026-10-16']);
});
