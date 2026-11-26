type Operation = {path:string[];kind:'set';value:unknown}|{path:string[];kind:'delete'}|{path:string[];kind:'array';from:number;keep:number;tail:unknown[]};
export type JsonResponseDelta={qqqDisplayDelta:true;baseEtag:string;operations:Operation[]};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
/** Exact JSON changes; rolling time arrays retain their overlapping prefix. */
export function jsonResponseDelta(before:unknown,after:unknown,baseEtag:string):JsonResponseDelta {
 const operations:Operation[]=[];
 const visit=(a:unknown,b:unknown,path:string[])=>{
  if(equal(a,b))return;
  if(Array.isArray(a)&&Array.isArray(b)){
   if(a.length===b.length && a.every((v,i)=>object(v)&&object(b[i])&&typeof v.expiryDate==='string'&&v.expiryDate===b[i].expiryDate)){
    a.forEach((v,i)=>visit(v,b[i],[...path,String(i)]));return;
   }
   let from=b.length?a.findIndex(v=>equal(v,b[0])):0;if(from<0)from=0;
   let keep=0;while(keep<b.length&&from+keep<a.length&&equal(a[from+keep],b[keep]))keep++;
   operations.push({path,kind:'array',from,keep,tail:b.slice(keep)});return;
  }
  if(object(a)&&object(b)){
   for(const key of Object.keys(a))if(!(key in b))operations.push({path:[...path,key],kind:'delete'});
   for(const key of Object.keys(b))visit(a[key],b[key],[...path,key]);return;
  }
  operations.push({path,kind:'set',value:b});
 };
 visit(before,after,[]);return {qqqDisplayDelta:true,baseEtag,operations};
}
/** Copy-on-write keeps unchanged profiles stable for React; never mutate cache. */
export function applyJsonResponseDelta(before:unknown,delta:JsonResponseDelta):unknown {
 let result=before;
 for(const op of delta.operations){
  if(op.path.some(key=>['__proto__','prototype','constructor'].includes(key)))throw Error('Invalid response path');
  const change=(node:unknown,depth:number):unknown=>{
   if(depth===op.path.length){
    if(op.kind==='set')return op.value;
    if(op.kind==='array'){if(!Array.isArray(node))throw Error('Missing delta array');return node.slice(op.from,op.from+op.keep).concat(op.tail);}
    return undefined;
   }
   const key=op.path[depth]!;
   if(!object(node)&&!Array.isArray(node))throw Error('Missing delta base');
   const copy:any=Array.isArray(node)?node.slice():{...node};
   if(depth===op.path.length-1&&op.kind==='delete')delete copy[key];
   else copy[key]=change(copy[key],depth+1);
   return copy;
  };
  result=change(result,0);
 }
 return result;
}
