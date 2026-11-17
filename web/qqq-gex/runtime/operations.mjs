// App-owned public facades. Original pinned financial bundles remain the sole model implementation.
import {readRequest,writeResult,writeError} from '../../app-sdk/engine.mjs';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createFacade,InputError} from './facade.mjs';
const request=await readRequest();
const {root,db,args,execute,utc,day,pageNumber,query,lifecycle,hasHistory,hasRows}=createFacade(request);
function instantTicks(value){return BigInt(Math.floor(Date.parse(value)/1000))*10000000n+BigInt(value.match(/\.(\d{7})/)[1]);}
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
