import type {ExposureHistoryDay} from './qqqExposureHistoryModel';

type Row=unknown[];
type Wire=Omit<ExposureHistoryDay,'items'> & {
  exposureFormat:'rows-v1'; schemas:string[][]; strings?:string[]; exposureDictionary?:true;
  items:Array<Omit<ExposureHistoryDay['items'][number],'profile'> & {profile:Row[];constants?:Array<[number,Array<[number,unknown]>]>}>;
};
/** Explicit wire negotiation only. No rounding, sampling or invented defaults:
 * schemas preserve absent fields separately from explicit null/false/zero. */
export function encodeExposureWire(day:ExposureHistoryDay):Wire {
  const schemas:string[][]=[],indices=new Map<string,number>();
  const items=day.items.map(item=>({...item,profile:item.profile.map(strike=>{
    const keys=Object.keys(strike),signature=JSON.stringify(keys);
    let index=indices.get(signature);
    if(index===undefined){index=schemas.length;schemas.push(keys);indices.set(signature,index);}
    return [index,...keys.map(key=>(strike as unknown as Record<string,unknown>)[key])];
  })}));
  return {...day,exposureFormat:'rows-v1',schemas,items};
}

/** One complete profile per line bounds JSON.parse too, not just hydration. */
export function serializeExposureWire(day:ExposureHistoryDay, dictionary=false):string {
  const wire=encodeExposureWire(day);
  if(dictionary)compactExposureWire(wire);
  const {items,...header}=wire;
  return [JSON.stringify(header),...items.map(item=>JSON.stringify(item))].join('\n');
}

export async function parseExposureWire(body:string,signal?:AbortSignal,schedule=()=>new Promise<void>(resolve=>setTimeout(resolve,0))):Promise<ExposureHistoryDay> {
  let end=body.indexOf('\n');
  const header=JSON.parse(end<0?body:body.slice(0,end)) as Wire;
  const items:ExposureHistoryDay['items']=[];
  // Validate the negotiated schema before processing any profile.
  await decodeExposureWire({...header,items:[]},signal,schedule);
  let cursor=end<0?body.length:end+1,started=performance.now();
  while(cursor<body.length){
    signal?.throwIfAborted();end=body.indexOf('\n',cursor);if(end<0)end=body.length;
    const item=JSON.parse(body.slice(cursor,end)) as Wire['items'][number];
    const {constants:_constants,...metadata}=item;
    items.push({...metadata,profile:hydrateProfile(item.profile,header.schemas,header.strings,item.constants)});
    cursor=end+1;
    if(performance.now()-started>=6){await schedule();signal?.throwIfAborted();started=performance.now();}
  }
  signal?.throwIfAborted();
  const {exposureFormat:_format,schemas:_schemas,strings:_strings,exposureDictionary:_dictionary,...day}=header;
  return {...day,items};
}

/** Intern repeated timing/version strings and omit per-profile constant columns.
 * Numeric values, absent fields and explicit null/false/zero remain lossless. */
function compactExposureWire(wire:Wire) {
  const strings:string[]=[],indices=new Map<string,number>();
  const pack=(value:unknown)=>{
    if(typeof value!=='string')return value;
    let index=indices.get(value);
    if(index===undefined){index=strings.length;strings.push(value);indices.set(value,index);}
    return [index];
  };
  for(const item of wire.items){
    const groups=new Map<number,Row[]>();
    for(const row of item.profile){
      for(let i=1;i<row.length;i++)row[i]=pack(row[i]);
      const schema=row[0] as number;const group=groups.get(schema)??[];group.push(row);groups.set(schema,group);
    }
    item.constants=[];
    const omitted=new Map<number,Set<number>>();
    for(const [schema,rows] of groups){
      const constants:Array<[number,unknown]>=[];
      if(rows.length>1)for(let i=1;i<rows[0].length;i++){
        const value=rows[0][i];
        if(rows.every(row=>Object.is(row[i],value)||Array.isArray(value)&&Array.isArray(row[i])&&(row[i] as unknown[])[0]===value[0]))constants.push([i-1,value]);
      }
      item.constants.push([schema,constants]);omitted.set(schema,new Set(constants.map(([i])=>i+1)));
    }
    item.profile=item.profile.map(row=>row.filter((_value,i)=>i===0||!omitted.get(row[0] as number)?.has(i)));
  }
  wire.strings=strings;wire.exposureDictionary=true;
}

function hydrateProfile(rows:Row[],schemas:string[][],strings?:string[],constants?:Array<[number,Array<[number,unknown]>]>){
  if(!Array.isArray(rows))throw Error('Invalid exposure profile');
  const bySchema=new Map<number,Map<number,unknown>>();
  if(constants!==undefined){
    if(!strings||!Array.isArray(constants))throw Error('Invalid exposure constants');
    for(const entry of constants){
      if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||!schemas[entry[0]]||!Array.isArray(entry[1])||bySchema.has(entry[0]))throw Error('Invalid exposure constants');
      const values=new Map<number,unknown>();
      for(const pair of entry[1]){
        if(!Array.isArray(pair)||pair.length!==2||!Number.isSafeInteger(pair[0])||pair[0]<0||pair[0]>=schemas[entry[0]].length||values.has(pair[0]))throw Error('Invalid exposure constants');
        values.set(pair[0],pair[1]);
      }
      bySchema.set(entry[0],values);
    }
  }
  const unpack=(value:unknown)=>{
    if(!strings||!Array.isArray(value))return value;
    if(value.length!==1||!Number.isSafeInteger(value[0])||value[0]<0||value[0]>=strings.length)throw Error('Invalid exposure string');
    return strings[value[0]];
  };
  return rows.map(row=>{
    if(!Array.isArray(row)||!Number.isSafeInteger(row[0]))throw Error('Invalid exposure row');
    const schema=row[0] as number,keys=schemas[schema],fixed=bySchema.get(schema);
    if(!keys||row.length!==keys.length+1-(fixed?.size??0))throw Error('Invalid exposure row width');
    const strike:Record<string,unknown>={};let index=1;
    for(let i=0;i<keys.length;i++)strike[keys[i]]=unpack(fixed?.has(i)?fixed.get(i):row[index++]);
    return strike as unknown as ExposureHistoryDay['items'][number]['profile'][number];
  });
}

/** Hydrate in bounded slices rather than allocating a complete day in one
 * main-thread task. Caller shares this work and publishes only after completion. */
export async function decodeExposureWire<T>(value:T,signal?:AbortSignal,schedule=()=>new Promise<void>(resolve=>setTimeout(resolve,0))):Promise<T> {
  if(!value||typeof value!=='object'||!('exposureFormat' in value))return value;
  const wire=value as unknown as Wire;
  if(wire.exposureFormat!=='rows-v1'||!Array.isArray(wire.schemas)||!Array.isArray(wire.items))throw Error('Invalid exposure wire format');
  if(wire.exposureDictionary!==undefined&&(wire.exposureDictionary!==true||!Array.isArray(wire.strings)||wire.strings.some(value=>typeof value!=='string')))throw Error('Invalid exposure dictionary');
  if(wire.strings!==undefined&&wire.exposureDictionary!==true)throw Error('Invalid exposure dictionary');
  for(const keys of wire.schemas)if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))||new Set(keys).size!==keys.length)throw Error('Invalid exposure schema');
  await schedule();signal?.throwIfAborted();
  const items:ExposureHistoryDay['items']=[];
  let started=performance.now();
  for(const item of wire.items){
    signal?.throwIfAborted();
    const profile=hydrateProfile(item.profile,wire.schemas,wire.strings,item.constants);
    const {constants:_constants,...metadata}=item;items.push({...metadata,profile});
    if(performance.now()-started>=6){await schedule();signal?.throwIfAborted();started=performance.now();}
  }
  signal?.throwIfAborted();
  const {exposureFormat:_format,schemas:_schemas,strings:_strings,exposureDictionary:_dictionary,...day}=wire;
  return {...day,items} as T;
}
