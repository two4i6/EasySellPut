/** Browser-safe finalized financial/contract envelope; excludes only run telemetry and itself. */
export function standaloneAcceptanceBytes(output:object):string{
  const {runId:_id,performance:_performance,acceptanceDigest:_digest,...financial}=output as Record<string,unknown>;
  const sorted=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(sorted);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort()
      .map(key=>[key,sorted((value as Record<string,unknown>)[key])]));
    return value;
  };
  return JSON.stringify(sorted(financial));
}
export async function verifyStandaloneAcceptanceEnvelope(output:object){
  const digest=(output as {acceptanceDigest?:unknown}).acceptanceDigest;
  if(typeof digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(digest))throw Error('Missing finalized standalone acceptance digest');
  const bytes=new TextEncoder().encode(standaloneAcceptanceBytes(output));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  if(digest!==`sha256:${actual}`)throw Error('Standalone finalized acceptance digest mismatch');
}
