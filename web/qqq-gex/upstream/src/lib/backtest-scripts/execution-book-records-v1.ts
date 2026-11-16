/** Completed adapter-owned ledgers are collections of independently bounded records.
 * They are never registered as one SDK-owned observation graph: hook limits remain unchanged. */
import {copyStrategyData,sealStrategyData} from './strategy-module-v2';
type Book={events:unknown[];curves:unknown[];positions:unknown[]};
function records(rows:unknown[],seal:boolean){
  if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length>1_000_000||Object.getOwnPropertySymbols(rows).length
    ||Object.getOwnPropertyNames(rows).length!==rows.length+1)throw Error('Invalid completed execution ledger');
  const copied:unknown[]=[];
  for(let i=0;i<rows.length;i++){
    const d=Object.getOwnPropertyDescriptor(rows,String(i));
    if(!d||!('value' in d)||!d.enumerable||!d.value||typeof d.value!=='object'||Array.isArray(d.value))throw Error('Invalid execution record');
    if(seal)sealStrategyData(d.value);else copied.push(copyStrategyData(d.value));
  }
  return seal?Object.freeze(rows):copied;
}
export function finalizeExecutionBookRecords<T extends Book>(book:T,mode:'copy'|'seal'):T{
  if(mode!=='copy'&&mode!=='seal')throw Error('Invalid execution evidence mode');
  if(!book||typeof book!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(book))
    ||Object.getOwnPropertySymbols(book).length)throw Error('Invalid execution book');
  for(const key of Object.getOwnPropertyNames(book)){
    const d=Object.getOwnPropertyDescriptor(book,key)!;
    if(!('value' in d)||!d.enumerable)throw Error('Invalid execution book field');
  }
  const {events,curves,positions,...metadata}=book,seal=mode==='seal';
  const tail=seal?sealStrategyData(metadata):copyStrategyData(metadata);
  const result={events:records(events,seal),curves:records(curves,seal),positions:records(positions,seal),...tail};
  return (seal?Object.freeze(result):result) as T;
}
