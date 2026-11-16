import {createHash} from 'node:crypto';
/** Weak validator for source semantics; request observedAt remains truthful metadata. */
export function qqqExposureEtag(scope:unknown,revision:string){return `W/"${createHash('sha256').update(JSON.stringify(['qqq-exposure-source-v2',scope,revision])).digest('hex')}"`;}
export function qqqEtagMatches(header:string|null,etag:string){return !!header?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag.replace(/^W\//,''));}
export async function qqqClosedExposureConditional(input:{closed:boolean;scope:unknown;header:string|null;revision:()=>Promise<string>}){
 if(!input.closed||!input.header)return null;
 const started=performance.now();
 const revision=await input.revision(),etag=qqqExposureEtag(input.scope,revision);
 return qqqEtagMatches(input.header,etag)?new Response(null,{status:304,headers:{etag,'cache-control':'no-store','x-qqq-exposure-revision':revision,'x-cache':'SOURCE-VALIDATED','vary':'Accept-Encoding', 'server-timing':`source_validation;dur=${(performance.now()-started).toFixed(1)}`}}):null;
}

/** Preserve the HTTP condition through intermediaries; this is never source proof. */
export function qqqExposureRequestValidator(headers:Headers){const value=headers.get('if-none-match')??headers.get('x-qqq-exposure-if-none-match');return value&&value.length<=2048?value:null;}
