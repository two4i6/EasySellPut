import type {HostEngine} from './engine-host.mjs';
export interface SourceReceipt {receipt:string;size:number;sha256:string;}
export type MarketSource =
 | {kind:'chain';symbol:string;expiry?:string;timeoutMs?:number}
 | {kind:'bars';symbol:string;interval?:'1m'|'5m'|'15m'|'30m'|'1h'|'1d'|'1w'|'1mo';from?:string;to?:string;timeoutMs?:number}
 | {kind:'quotes';symbols:string[];timeoutMs?:number}
 | {kind:'expirations';symbol:string;timeoutMs?:number};
export function readSnapshotReceipt(engine:HostEngine,receipt:SourceReceipt):Promise<Buffer>;
export function openMarketSnapshot<T=unknown>(engine:HostEngine,arguments_:MarketSource):Promise<{value:T;raw:SourceReceipt|null}>;
export function publishAppInput(engine:HostEngine,value:string|Uint8Array):Promise<{bytes:number;sha256:string}>;
