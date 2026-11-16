/** Dedicated research credentials. Never reuse broker keys; never expose secrets in output. */
import {createHash,timingSafeEqual} from 'node:crypto';
function researchOrigin(request:Request){
  const url=new URL(request.url);
  return process.env.STANDALONE_RESEARCH_ORIGIN||`${url.protocol}//${request.headers.get('host')??url.host}`;
}
/** The embedded dashboard is available to visitors of this app; external clients use bearer auth. */
export function authorizeQqqTerminal(request?:Request):{principal:string}|Response {
  if(process.env.STANDALONE_JOBS_EMBEDDED==='1'&&request&&!request.headers.has('Authorization')){
    const expected=researchOrigin(request),origin=request.headers.get('Origin'),referer=request.headers.get('Referer');
    let referringOrigin:string|undefined;
    try{if(referer)referringOrigin=new URL(referer).origin;}catch{}
    if(request.headers.get('Sec-Fetch-Site')==='same-origin'&&(origin?origin===expected:referringOrigin===expected))
      return {principal:'embedded-browser'};
    return Response.json({error:'Same-origin browser request required'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  return authorizeStandalone(request);
}
export function authorizeStandalone(request?:Request):{principal:string}|Response {
  let users:Record<string,string>;
  try{users=JSON.parse(process.env.STANDALONE_RESEARCH_CREDENTIALS??'null');
    if(!users||Array.isArray(users)||typeof users!=='object'||!Object.keys(users).length
      ||Object.entries(users).some(([id,token])=>!id||typeof token!=='string'||token.length<32))throw Error();
  }catch{return Response.json({error:'Research authentication is not configured'},{status:503});}
  const supplied=request?.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]??'';
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  for(const [principal,token] of Object.entries(users))if(timingSafeEqual(hash(supplied),hash(token))){
    const origin=request?.headers.get('Origin');
    // Next's internal Request URL may use localhost behind its dev/reverse proxy.
    // Use the original Host; TLS-terminating deployments pin their public origin.
    const expected=request?researchOrigin(request):null;
    if(origin&&origin!==expected)return Response.json({error:'Cross-origin research request refused'},{status:403});
    return {principal};
  }
  return Response.json({error:'Research authentication required'},{status:401,headers:{'WWW-Authenticate':'Bearer','Cache-Control':'no-store'}});
}
