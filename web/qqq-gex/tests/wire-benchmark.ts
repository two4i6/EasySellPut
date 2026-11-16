import {serializeExposureWire,parseExposureWire} from '../upstream/src/lib/qqqExposureWire';
import {writeFileSync,mkdirSync} from 'node:fs';
import {cpus,totalmem,platform,arch} from 'node:os';
const items=Array.from({length:120*8},(_,i)=>({capturedAt:new Date(Date.UTC(2026,0,2,14,30)+Math.floor(i/8)*120000).toISOString(),expiryDate:`2026-01-${String(2+i%8).padStart(2,'0')}`,dte:i%8,profile:Array.from({length:100},(_,k)=>({strike:500+k,callGex:k,putGex:-k/2,totalGex:k/2,isCallWall:false,isPutWall:false,isGammaFlip:false}))}));
const day={date:'2026-01-02',observedAt:'2026-01-03T00:00:00Z',revision:'synthetic-benchmark',bars:[],items};
const start=performance.now(),wire=serializeExposureWire(day,true),encoded=performance.now();const restored=await parseExposureWire(wire),decoded=performance.now();
if(restored.items.length!==items.length||restored.items.at(-1)!.profile.at(-1)!.totalGex!==49.5)throw Error('Round trip mismatch');
const result={dataset:'synthetic only; not historical data',sourceCommit:'d60e24b56e308a81723f6c206fb52d22ddc0e9f8',runtime:process.version,platform:platform(),architecture:arch(),cpu:cpus()[0]?.model,cpus:cpus().length,systemMemoryBytes:totalmem(),snapshots:120,expiries:8,strikesPerExpiry:100,rows:96000,wireBytes:Buffer.byteLength(wire),serializeMs:encoded-start,parseMs:decoded-encoded,rssBytes:process.memoryUsage().rss,peakRssKb:process.resourceUsage().maxRSS};
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/wire-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
