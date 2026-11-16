import type {SourceManifest,SourceKey,CandleKey} from './qqqVersionedHistoryStore';
export const QQQ_CHART_ARCHIVE_VERSION=1;
export const QQQ_CHART_ARCHIVE_RAW_LIMIT=16*1024*1024;
export const QQQ_CHART_ARCHIVE_GZIP_LIMIT=4*1024*1024;
export type ChartArchivePart={index:number;expiryDate:string|null;profiles:SourceKey[];candles:CandleKey[]};
export type ChartArchiveReference={index:number;expiryDate:string|null;sha256:string;rawBytes:number;compressedBytes:number;profileCount:number;candleCount:number};
export type ChartArchiveIndex={version:1;revision:string;parts:ChartArchiveReference[]};
/** Same partition is used by the resumable worker and manual pre-generator. */
export function planQqqChartArchive(manifest:SourceManifest):ChartArchivePart[]{
 const expiries=[...new Set(manifest.items.map(row=>row.expiry_date))].sort();
 const result:ChartArchivePart[]=[];
 for(const expiryDate of expiries){const keys=manifest.items.filter(row=>row.expiry_date===expiryDate);for(let offset=0;offset<keys.length;offset+=384)result.push({index:result.length,expiryDate,profiles:keys.slice(offset,offset+384),candles:[]});}
 if(manifest.bars.length)result.push({index:result.length,expiryDate:null,profiles:[],candles:manifest.bars});
 if(result.length>48)throw Error('Chart archive partition exceeds budget');
 return result;
}
export function validQqqChartArchiveIndex(value:unknown):value is ChartArchiveIndex{
 const v=value as ChartArchiveIndex;
 return !!v&&v.version===1&&typeof v.revision==='string'&&v.revision.length>0&&v.revision.length<=256&&Array.isArray(v.parts)&&v.parts.length<=48&&v.parts.every(p=>p&&typeof p==='object')&&new Set(v.parts.map(p=>p.index)).size===v.parts.length&&v.parts.every(p=>Number.isInteger(p.index)&&p.index>=0&&p.index<48&&(p.expiryDate===null||/^\d{4}-\d{2}-\d{2}$/.test(p.expiryDate))&&/^[a-f0-9]{64}$/.test(p.sha256)&&Number.isSafeInteger(p.rawBytes)&&p.rawBytes>0&&p.rawBytes<=QQQ_CHART_ARCHIVE_RAW_LIMIT&&Number.isSafeInteger(p.compressedBytes)&&p.compressedBytes>0&&p.compressedBytes<=QQQ_CHART_ARCHIVE_GZIP_LIMIT&&Number.isInteger(p.profileCount)&&p.profileCount>=0&&p.profileCount<=384&&Number.isInteger(p.candleCount)&&p.candleCount>=0&&p.candleCount<=1000)&&v.parts.reduce((n,p)=>n+p.compressedBytes,0)<=64*1024*1024;
}
