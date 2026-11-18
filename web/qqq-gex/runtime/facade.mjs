import {ArchiveDatabase} from './archive-database.ts';
// Shared app-owned facade validation and authenticated original-model execution.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
export class InputError extends Error{}
export function createFacade(request){
const root=request.context.dataDirectory,db=join(root,'cache','qqq-gex.db'),args=request.arguments;
function hasRows(tables){
 if(!existsSync(db))return false;
 const database=new ArchiveDatabase(db,{readOnly:true});
 try{database.exec('PRAGMA busy_timeout=5000;BEGIN');return tables.some(table=>!!database.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)&&!!database.prepare('SELECT 1 FROM '+table+' LIMIT 1').get());}
 finally{database.close();}
}
function hasHistory(){
 if(!existsSync(db))return false;
 const database=new ArchiveDatabase(db,{readOnly:true});
 try{database.exec('PRAGMA busy_timeout=5000;BEGIN');return !!database.prepare("SELECT 1 FROM sqlite_master WHERE name='qqq_gex_local_days'").get()&&!!database.prepare('SELECT 1 FROM qqq_gex_local_days LIMIT 1').get();}
 finally{database.close();}
}
async function execute(asset,arguments_,input){
 const script=request.context.assets?.['engine/'+asset];if(typeof script!=='string')throw Error('Signed model dependency unavailable');
 const child=spawn(process.execPath,[script,...arguments_],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const chunks=[];let bytes=0,errors=0,fault;
 const timer=setTimeout(()=>{fault={code:'cancelled',message:'Original model deadline exceeded'};child.kill();},110000);
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>128*1024*1024){fault={code:'invalid_data',message:'Original model output exceeds bound'};child.kill();}else chunks.push(chunk);});
 child.stderr.on('data',chunk=>{errors+=chunk.length;if(errors>65536){fault={code:'invalid_data',message:'Original model diagnostics exceed bound'};child.kill();}});
 // A source process can reject input before it consumes stdin; its exit result remains authoritative.
 child.stdin.on('error',error=>{if(error.code!=='EPIPE')fault={code:'invalid_data',message:'Original model input failed'};});
 child.stdin.end(input);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timer));
 if(fault){const error=Error(fault.message);error.appCode=fault.code;throw error;}
 if(code!==0)return {status:'calculation_failed',complete:false,exitCode:code,reason:'Pinned source runtime rejected input; raw normalized input retained'};
 return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
}
function instantTicks(value){return BigInt(Math.floor(Date.parse(value)/1000))*10000000n+BigInt(value.match(/\.(\d{7})/)[1]);}
function utc(value){
 if(typeof value!=='string'||!value.includes('T')||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new InputError('An ISO instant with timezone is required');
 const date=value.match(/^(\d{4})-(\d{2})-(\d{2})T/),offset=value.match(/([+-])(\d{2}):(\d{2})$/);
 if(!date||+date[1]<1||+date[2]<1||+date[2]>12||+date[3]<1||+date[3]>new Date(Date.UTC(+date[1],+date[2],0)).getUTCDate()||offset&&(+offset[2]>14||+offset[3]>59||+offset[2]===14&&+offset[3]!==0))throw new InputError('Invalid ISO instant');
 const raw=value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??'';
 let ticks=Number(raw.padEnd(7,'0').slice(0,7));if(raw.length>7&&Number(raw[7])>=5)ticks++;
 const seconds=Math.floor(Date.parse(value)/1000)+(ticks===10000000?1:0);if(ticks===10000000)ticks=0;
 const formatted=new Date(seconds*1000).toISOString();if(!/^\d{4}-/.test(formatted))throw new InputError('Instant exceeds supported range');
 return formatted.slice(0,19)+'.'+String(ticks).padStart(7,'0')+'+00:00';
}
function day(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value<'0001-01-01')throw new InputError('Invalid trading date');
 return value;
}
function pageNumber(name,fallback,max){const value=args[name]??fallback;if(!Number.isInteger(value)||value<1||value>max)throw new InputError('Invalid pagination');return value;}
function query(path){return execute('query.mjs',[db,path.length>8192?'--query-stdin':path],path.length>8192?path:undefined);}
function lifecycle(date){
 const result={available:true,storageAvailable:false,date,recorded:false,complete:false,points:[],coverage:'Only explicitly captured local PCS observations; missing historical blobs are not reconstructed'};
 if(!existsSync(db))return result;
 const database=new ArchiveDatabase(db,{readOnly:true});
 try{
  database.exec('PRAGMA busy_timeout=5000;BEGIN');result.storageAvailable=!!database.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_pcs_lifecycle'").get();
  if(result.storageAvailable)for(const row of database.prepare('SELECT body,sha256 FROM qqq_gex_pcs_lifecycle WHERE day=? ORDER BY time LIMIT 1001').iterate(date)){
   if(result.points.length>=1000||typeof row.body!=='string'||Buffer.byteLength(row.body)>1048576||createHash('sha256').update(row.body).digest('hex').toLowerCase()!==String(row.sha256).toLowerCase())throw Error('PCS lifecycle integrity failed');
   const point=JSON.parse(row.body),time=Date.parse(point.time);
   if(typeof point.time!=='string'||!Number.isFinite(time)||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time))!==date)throw Error('PCS lifecycle date mismatch');
   result.points.push(point);
  }
  result.recorded=result.points.length>0;return result;
 }finally{database.close();}
}
return {root,db,args,execute,utc,instantTicks,day,pageNumber,query,lifecycle,hasHistory,hasRows};
}

// Preserve the established System.Text.Json default encoder used by chunked facade bytes.
export function dotnetJson(value){
 function quoted(text){return '"'+[...text].map(character=>{
  if(character==='\\')return '\\\\';
  const short={'\b':'\\b','\t':'\\t','\n':'\\n','\f':'\\f','\r':'\\r'}[character];if(short)return short;
  if(character.charCodeAt(0)<32||character.charCodeAt(0)>=127||['"',"'",'&','+','<','>','`'].includes(character))return Array.from({length:character.length},(_,i)=>'\\u'+character.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0')).join('');
  return character;
 }).join('')+'"';}
 if(typeof value==='string')return quoted(value);
 if(value===null||typeof value==='number'||typeof value==='boolean')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(dotnetJson).join(',')+']';
 return '{'+Object.entries(value).map(([key,item])=>quoted(key)+':'+dotnetJson(item)).join(',')+'}';
}
