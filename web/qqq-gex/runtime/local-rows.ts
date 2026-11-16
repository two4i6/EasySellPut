import {decodeArchiveBody} from './archive-body';
import {createHash} from 'node:crypto';
export const rowHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function verifyRow(db:any,row:any){const stored=db.prepare('SELECT body,sha256 FROM qqq_gex_local_rows WHERE row_key=?').get(row.profileRef);if(!stored||stored.sha256!==row.rowSha256)throw Error('Lossless profile row missing/corrupt');const body=decodeArchiveBody(stored.body,16*1024*1024);if(rowHash(body)!==stored.sha256)throw Error('Lossless profile row corrupt');return body;}
/** Original lossless row bodies, independently bounded and verified. No generated values. */
export function hydrateRow(db:any,row:any){if(!row.profileRef)return row;const body=verifyRow(db,row);const value=JSON.parse(body);if(value.capturedAt!==row.capturedAt||value.expiryDate!==row.expiryDate)throw Error('Lossless profile identity mismatch');Object.defineProperty(value,'__localArchive',{value:row,enumerable:false});return value;}
export function hydrateDay(db:any,day:any){return {...day,rows:day.rows.map((row:any)=>hydrateRow(db,row))};}
export function displayRows(db:any,day:any,expiry:string|null){const selected=expiry??day.expiries?.[0]?.expiryDate;const latest=new Map<string,any>();for(const row of day.rows){const prior=latest.get(row.expiryDate);if(!prior||Date.parse(row.capturedAt)>Date.parse(prior.capturedAt))latest.set(row.expiryDate,row);}return day.rows.filter((row:any)=>row.expiryDate===selected||latest.get(row.expiryDate)===row).map((row:any)=>hydrateRow(db,row));}
