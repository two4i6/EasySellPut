// App-owned public facades. Original pinned financial bundles remain the sole model implementation.
import {readRequest,writeResult,writeError} from '../../app-sdk/engine.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const request=await readRequest(),root=request.context.dataDirectory,db=join(root,'cache','qqq-gex.db'),args=request.arguments;
class InputError extends Error{}
function hasRows(tables){
 if(!existsSync(db))return false;
 const database=new DatabaseSync(db,{readOnly:true});
 try{database.exec('PRAGMA busy_timeout=5000;BEGIN');return tables.some(table=>!!database.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)&&!!database.prepare('SELECT 1 FROM '+table+' LIMIT 1').get());}
 finally{database.close();}
}
function hasHistory(){
 if(!existsSync(db))return false;
 const database=new DatabaseSync(db,{readOnly:true});
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
 const database=new DatabaseSync(db,{readOnly:true});
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
try{
 let result;
 switch(request.operation){
  case 'calculate_qqq_gex_local':
   if(!request.context.allowWrites){const error=Error('Explicit write permission required');error.appCode='permission_denied';throw error;}
   result=await execute('import.mjs',[join(root,'cache','qqq-gex-input.json'),db]);break;
  case 'rebuild_qqq_gex_history':{
   if(!request.context.allowWrites){const error=Error('Explicit write permission required');error.appCode='permission_denied';throw error;}
   const limit=args.limit??100;if(!Number.isInteger(limit)||limit<1||limit>400)throw new InputError('Invalid history batch limit');
   result=hasHistory()?await execute('history.mjs',[db,JSON.stringify({limit,retryFailed:args.retryFailed??false})]):{status:'no_observed_inputs',complete:false,processed:0};break;
  }
  case 'get_qqq_gex_replay':{
   const from=utc(args.from),to=utc(args.to),first=instantTicks(from),last=instantTicks(to);
   if(last<=first||last-first>366n*864000000000n)throw new InputError('Replay range must increase and be at most 366 days');
   const page=args.page??1,pageSize=args.pageSize??200;if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>200)throw new InputError('Invalid replay pagination');
   if(!hasHistory()){result={status:'cache_miss',available:false,complete:false};break;}
   const query='/api/analysis/qqq/pcs/backtest?stream=signals&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+'&page='+page+'&pageSize='+pageSize;
   result=await execute('query.mjs',[db,query.length>8192?'--query-stdin':query],query.length>8192?query:undefined);break;
  }
  case 'get_qqq_gex_archive':{
   const resource=args.resource,page=pageNumber('page',1,100000),pageSize=pageNumber('pageSize',100,200);
   if(!['dates','providers'].includes(resource)&&args.date===undefined)throw new InputError('Trading date is required');
   if(resource==='profile'&&(args.expiry===undefined||args.capturedAt===undefined))throw new InputError('Profile requires expiry and capturedAt from snapshots');
   if(page>1&&args.revision===undefined)throw new InputError('Continuation requires revision');
   const parameters=new URLSearchParams({resource,page:String(page),pageSize:String(pageSize)});
   if(args.archiveState!==undefined){if(!['published','partial'].includes(args.archiveState)||resource==='providers')throw new InputError('Invalid archive state');parameters.set('archiveState',args.archiveState);}
   for(const key of ['date','expiry'])if(args[key]!==undefined)parameters.set(key,day(args[key]));
   for(const key of ['capturedAt','revision'])if(args[key]!==undefined)parameters.set(key,args[key]);
   result=existsSync(db)?await query('/api/analysis/qqq/local-archive?'+parameters):{status:'cache_miss',available:false,complete:false};break;
  }
  case 'get_qqq_gex_live_decision':
   result=hasRows(['qqq_gex_observed_inputs','qqq_gex_raw'])?await query('/api/analysis/qqq/pcs/local-decision?regimeMode='+encodeURIComponent(args.regimeMode??'unified')):{status:'cache_miss',available:false,complete:false};break;
  case 'get_qqq_gex_lifecycle':result=lifecycle(day(args.date));break;
  default:throw new InputError('Unsupported GEX facade');
 }
 writeResult(result);
}catch(error){writeError(error instanceof InputError?'invalid_arguments':error.appCode??'invalid_data',String(error.message??'App operation failed').slice(0,1000));}
