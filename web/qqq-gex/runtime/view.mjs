// App-owned view routing/projections. Shared providers remain in the host; original financial math stays in query.mjs.
import {createHostEngine} from '../../app-sdk/engine-host.mjs';
import {createFacade,InputError,dotnetJson} from './facade.mjs';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {decodeArchiveBytes,archiveEncoding} from './archive-body.ts';
import {hydrateRow} from './local-rows.ts';
const engine=await createHostEngine(),{request}=engine,{root,db,args,utc,day,query}=createFacade(request);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const present=key=>Object.hasOwn(args,key);
function integer(key,fallback,min,max){const value=args[key]??fallback;if(!Number.isInteger(value)||value<min||value>max)throw new InputError('Invalid '+key);return value;}
function required(key){if(!present(key))throw new InputError(key+' is required');return args[key];}
function instant(key){const value=required(key);utc(value);return value;}
function date(key){return day(required(key));}
function range(from,to,max){const first=Date.parse(instant(from)),last=Date.parse(instant(to));if(last<=first||last-first>max)throw new InputError('Invalid bounded '+from+'/'+to+' window');}
function chunks(resource,body,contentType='application/json'){
 const bytes=Buffer.isBuffer(body)?body:Buffer.from(body),offset=integer('offset',0,0,134217728),length=integer('length',65536,1,262144);
 if(offset>0&&!present('sha256'))throw new InputError('Continuation requires first chunk sha256');
 const sha256=hash(bytes);
 if(present('sha256')&&args.sha256.toLowerCase()!==sha256)return {status:'revision_changed',available:false,complete:false,sha256,restartOffset:0};
 if(offset>bytes.length)throw new InputError('Offset exceeds response length');
 const count=Math.min(length,bytes.length-offset),next=offset+count;
 const coverage={workspace:'Allowlisted saved UI preferences and timestamped last desktop observation; not guaranteed current screen or live quote.',partial:'Same native partial-capture projection; not a published complete day.',providerRaw:'Original hash-verified retained provider bytes, not a model reconstruction or arbitrary file.'}[resource]??'Exact retained UI-kernel response bytes; not full historical/input completeness.';
 return {available:true,complete:false,resource,contentType,sha256,totalBytes:bytes.length,offset,chunkBytes:count,encoding:'base64',bodyBase64:bytes.subarray(offset,next).toString('base64'),hasMore:next<bytes.length,nextOffset:next<bytes.length?next:null,coverage:coverage+' Concatenate decoded chunks and verify SHA256; changes restart. No remote fallback. Re-read exposure manifest after all windows.'};
}
function readDatabase(action){const database=new DatabaseSync(db,{readOnly:true});try{database.exec('PRAGMA busy_timeout=5000;BEGIN');return action(database);}finally{database.close();}}

async function workspace(){
 const preferencesBody=(await engine.call('read_app_snapshot',{key:'preferences'})).body;
 let values={};if(preferencesBody!==null){values=JSON.parse(preferencesBody);if(!values||Array.isArray(values)||typeof values!=='object'||Object.values(values).some(value=>typeof value!=='string'))throw Error('Invalid GEX preferences');}
 values=Object.fromEntries(Object.entries(values).filter(([key])=>key.length<=200&&['qqq-gex:','qqq-pcs:','qqq-terminal:','qqq-local:'].some(prefix=>key.startsWith(prefix))&&!['token','password','secret','api-key','api_key','credential','auth'].some(word=>key.toLowerCase().includes(word))));
 let lastObserved=null,status='not_observed',fresh=false;
 try{const body=(await engine.call('read_app_snapshot',{key:'desktop'})).body;if(body!==null){lastObserved=JSON.parse(body);const age=Date.now()-Date.parse(lastObserved.observedAt);if(!Number.isFinite(age))throw Error('Invalid observation time');fresh=age>=0&&age<=30000;status=fresh?'recent_desktop_observation':'stale_desktop_observation';}}
 catch{lastObserved=null;status='desktop_observation_unavailable';}
 const analyticalSelections={};for(const name of ['exposure','wallTouches','spreadStudy','interaction'])try{const value=JSON.parse(values['qqq-local:observed-'+name+':v1']);if(value&&typeof value==='object'&&!Array.isArray(value))analyticalSelections[name]=value;}catch{}
 return {preferences:{revision:hash(preferencesBody??'').toUpperCase(),values},analyticalSelections,desktop:{available:lastObserved!==null,status,fresh,lastObserved},coverage:'Allowlisted persisted UI preferences and last desktop observation only. A recent observation does not certify a running/visible window or live market freshness; source timestamps remain authoritative. No network, capture, preference mutation or process control.'};
}
function partial(){return readDatabase(database=>{
 if(!database.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_partial_days'").get())return null;
 const row=database.prepare('SELECT payload,sha256 FROM qqq_gex_partial_days ORDER BY day DESC LIMIT 1').get();if(!row)return null;
 if(hash(row.payload).toLowerCase()!==String(row.sha256).toLowerCase())throw Error('Partial GEX integrity failed');
 const value=JSON.parse(row.payload),last=new Map();for(const r of value.rows)last.set(r.expiryDate,r);
 return {date:value.date,source:value.source,complete:false,extendedHoursBars:value.extendedHoursBars?.length??0,regularBars:value.bars.length,underlyingLastTradeAt:value.underlyingLastTradeAt??null,issues:value.issues,expiries:[...last.values()].map(r=>({expiry:r.expiryDate,asOf:r.capturedAt,calculationVersion:r.calculationVersion,inputComplete:r.inputComplete,modelInputComplete:r.modelInputComplete??r.inputComplete,sourceTimeAligned:r.sourceTimeAligned??null,netGex:r.netGex,strikes:r.profileCount??r.profile.length}))};
});}
async function view(){
 const resource=args.resource,allowed=new Set(['resource','offset','length','sha256']);let route;const parameters=new URLSearchParams();
 const permit=(...keys)=>keys.forEach(key=>allowed.add(key)),add=(key,value)=>parameters.append(key,String(value));
 function applicable(){if(Object.keys(args).some(key=>!allowed.has(key)))throw new InputError('Parameter is not applicable to this resource');}
 switch(resource){
 case 'workspace':applicable();return chunks(resource,dotnetJson(await workspace()));
 case 'partial':applicable();if(!existsSync(db))return {available:false,status:'cache_miss',complete:false};{const value=partial();return chunks(resource,dotnetJson({available:value!==null,complete:false,partial:value}));}
 case 'providerRaw':{
  permit('providerHash');applicable();const sourceHash=required('providerHash');if(!/^[0-9a-fA-F]{64}$/.test(sourceHash))throw new InputError('providerHash must be a hash from archive resource=providers');
  if(!existsSync(db))return {available:false,status:'cache_miss',complete:false};
  return readDatabase(database=>{const fields=database.prepare('PRAGMA table_info(qqq_gex_provider_raw)').all();const row=database.prepare("SELECT body,"+(fields.some(field=>field.name==='encoding')?'encoding':"'identity' AS encoding")+' FROM qqq_gex_provider_raw WHERE sha256=?').get(sourceHash.toUpperCase());if(!row)throw Error('Original provider body is missing');const bytes=row.encoding==='identity'?Buffer.from(row.body):['gzip-v1','brotli-v2'].includes(row.encoding)&&row.encoding===archiveEncoding(row.body)?decodeArchiveBytes(row.body):null;if(!bytes||bytes.length>134217728||hash(bytes)!==sourceHash.toLowerCase())throw Error('Original provider body integrity failed');return chunks(resource,bytes,'application/octet-stream');});
 }
 case 'display':case 'evidence':
  route='/api/analysis/qqq/pcs';permit('expiry','from','to','regimeMode');add('gexDisplay',1);add('gexOverview',1);if(present('expiry'))add('gexExpiry',date('expiry'));
  if(present('from')||present('to')){range('from','to',90*60000);add('from',instant('from'));add('to',instant('to'));}else add('gexWindow','latest');
  if(resource==='evidence')add('gexEvidence',1);if(present('regimeMode'))add('regimeMode',args.regimeMode);break;
 case 'context':route='/api/analysis/qqq/gex/intraday-context';permit('date','dte','include','at');add('asOf',instant('at'));add('date',date('date'));add('dte',integer('dte',0,0,60));add('include',args.include??'all');break;
 case 'exposureManifest':case 'exposureWindow':
  route='/api/analysis/qqq/gex/exposure';permit('date','expiry');add('date',date('date'));if(present('expiry'))add('expiryDate',date('expiry'));add('format',resource==='exposureManifest'?'manifest-v2':'lines-v2');
  if(resource==='exposureWindow'){permit('from','to','source');range('from','to',3600000);add('from',instant('from'));add('to',instant('to'));add('source',required('source'));add('profiles','true');}break;
 case 'analysis':{
  route='/api/analysis/qqq/local-analysis';permit('date','expiry','at','analysis','scope','mode','metric','side','shortStrike','longStrike','ivShockPp','fees','basis','manualCredit','minutes','strikes','overlays','reactions','viewportFrom','viewportTo','plotWidth','policy','preset','hiddenLegends','discovery','wallHorizon','wallGamma','wallPeriod','wallSide');
  add('date',date('date'));add('at',instant('at'));const analysis=required('analysis');add('analysis',analysis);
  if(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(args.at))!==args.date)throw new InputError('Analysis cursor must belong to requested Eastern date');
  for(const [key,study,choices]of [['hiddenLegends','chartStudies',['kc','directional_markers','price','live','vwap','rsi','score','confirmation','gex_table','gex_positive','gex_negative','wall_history','markers','session_shade','king','call_wall','put_wall','gamma_flip','gamma_position','net_gex','trade_low','trade_high']],['discovery','structureEvents',['changes','tracks','events','skew','bands']],['overlays','overlays',['vwap','delta','iv','putCall']],['reactions','priceReactions',['markers','low','high']]])if(present(key)){const values=args[key];if(analysis!==study||values.length>choices.length||new Set(values).size!==values.length||values.some(value=>!choices.includes(value)))throw new InputError('Invalid '+key+' selection');add(key,values.join(','));}
  for(const [key,study,choices]of [['preset','chartStudies',['simple','structure','all']],['policy','dayScenario',['partial','complete']]])if(present(key)){if(analysis!==study||!choices.includes(args[key]))throw new InputError('Invalid '+key);add(key,args[key]);}
  if(present('viewportFrom')||present('viewportTo')||present('plotWidth')){range('viewportFrom','viewportTo',25*3600000);const width=required('plotWidth');if(analysis!=='priceReactions'||!Number.isFinite(width)||width<1||width>10000)throw new InputError('Invalid price reaction viewport');for(const key of ['viewportFrom','viewportTo','plotWidth'])add(key,args[key]);}
  for(const [key,choices]of [['wallHorizon',[10,30]],['wallGamma',['all','positive','negative','zero']],['wallPeriod',['all','open','middle','late']],['wallSide',['all','put','call']]])if(present(key)){if(analysis!=='wallTouches'||!choices.includes(args[key]))throw new InputError('Invalid wall-touch filter');add(key,args[key]);}
  if(present('minutes')&&(!['activityResponse','structureEvents'].includes(analysis)||![2,10,30].includes(args.minutes)))throw new InputError('Unsupported observation window');
  if(present('strikes')){if(!['exposure','heatmapField'].includes(analysis)||args.strikes.length>2000||args.strikes.some(value=>!Number.isFinite(value)||value<=0))throw new InputError('Invalid selected strikes');add('strikes',args.strikes.join(','));}
  for(const key of ['expiry','scope','mode','metric','side','shortStrike','longStrike','ivShockPp','fees','basis','manualCredit','minutes'])if(present(key))add(key,key==='expiry'?date(key):args[key]);break;
 }
 case 'spreadQuote':{
  permit('date','expiry','at','shortStrike','longStrike');applicable();const tradingDate=date('date'),expiry=date('expiry'),cutoff=Date.parse(instant('at')),short=required('shortStrike'),long=required('longStrike');
  if(!Number.isFinite(short)||!Number.isFinite(long)||short<=0||long<=0||short===long)throw new InputError('Spread strikes must differ and be positive');
  integer('offset',0,0,134217728);integer('length',65536,1,262144);if((args.offset??0)>0&&!present('sha256'))throw new InputError('Continuation requires first chunk sha256');
  const miss={status:'cache_miss',available:false,complete:false};if(!existsSync(db)||expiry<tradingDate||cutoff>Date.now()||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(cutoff))!==tradingDate)return miss;
  return readDatabase(database=>{
   const record=database.prepare('SELECT d.revision,d.payload,d.updated_at,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day=?').get(tradingDate);if(!record)return miss;
   if(hash(record.payload).toLowerCase()!==String(record.sha256).toLowerCase())throw Error('Local GEX day integrity failed');
   const candidates=JSON.parse(record.payload).rows.filter(row=>row.expiryDate===expiry&&Date.parse(row.capturedAt)<=cutoff&&Date.parse(row.capturedAt)>=cutoff-300000).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)).slice(0,3).filter(row=>Number.isFinite(Date.parse(row.sourceAsOf))&&Date.parse(row.sourceAsOf)<=cutoff&&Date.parse(row.sourceAsOf)>=cutoff-300000).sort((a,b)=>Date.parse(b.sourceAsOf)-Date.parse(a.sourceAsOf));
   const best=candidates[0],profile=best?hydrateRow(database,best).profile.filter(point=>point.strike===short||point.strike===long):[];
   return chunks(resource,dotnetJson({date:tradingDate,expiry,cutoff,time:best?Date.parse(best.sourceAsOf):null,profile}));
  });
 }
 default:throw new InputError('Unknown GEX view resource');
 }
 applicable();integer('offset',0,0,134217728);integer('length',65536,1,262144);if((args.offset??0)>0&&!present('sha256'))throw new InputError('Continuation requires first chunk sha256');
 if(!existsSync(db))return {status:'cache_miss',available:false,complete:false};
 const response=await query(route+'?'+parameters);if(Object.hasOwn(response,'status'))return response;
 return chunks(resource,Object.hasOwn(response,'body')?response.body:dotnetJson(response),response.contentType??'application/json');
}
try{engine.finish(await view());}catch(error){engine.finish({$appError:{code:error instanceof InputError?'invalid_arguments':error.appCode??'invalid_data',message:String(error.message??'App operation failed').slice(0,1000)}});}finally{engine.close();}
