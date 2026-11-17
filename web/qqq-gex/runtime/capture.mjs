// App-owned routed-input ingestion. No model substitutions, network sockets, provider implementation or background timer.
import {createHostEngine} from '../../app-sdk/engine-host.mjs';
import {readSnapshotReceipt,openMarketSnapshot,publishAppInput} from '../../app-sdk/market.mjs';
import {createFacade,dotnetJson} from './facade.mjs';
import {encodeArchiveBody,decodeArchiveBody} from './archive-body.ts';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,statfsSync} from 'node:fs';
import {dirname,join} from 'node:path';
const engine=await createHostEngine(),{request}=engine,{root,db,utc,instantTicks}=createFacade(request),started=Date.now();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const minute=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function date(time){return eastern.format(new Date(time));}
function sourceError(message,type='InvalidDataException'){const error=Error(message);error.sourceException=type;if(type==='IOException')error.code='io_error';return error;}
function budget(){const remaining=90000-(Date.now()-started);if(remaining<=0){const error=sourceError('Source capture deadline reached','OperationCanceledException');error.code='cancelled';throw error;}return remaining;}
async function source(arguments_){return openMarketSnapshot(engine,{...arguments_,timeoutMs:budget()});}
function availableSpace(incoming){const space=statfsSync(dirname(db));if(Number(space.bavail)*Number(space.bsize)<268435456+incoming*2)throw sourceError('GEX storage reserve reached; existing history preserved','IOException');}
function validBar(bar){const epsilon=Math.abs(bar.close)*1e-9;return !bar.incomplete&&[bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite)&&bar.volume>=0&&bar.low<=Math.min(bar.open,bar.close)+epsilon&&bar.high>=Math.max(bar.open,bar.close)-epsilon&&bar.low<=bar.high+epsilon;}
function enumNumber(value,choices){const index=choices.indexOf(value);if(index<0)throw sourceError('Unknown source enum value');return index;}
const adjustment=value=>enumNumber(value,['Unknown','None','Split','SplitDividend']);
const capitalize=value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key[0].toUpperCase()+key.slice(1),key==='marketState'?enumNumber(item,['Unknown','PreMarket','Regular','AfterHours','Closed','Overnight']):item]));
function marketTime(chain){
 if(!Number.isFinite(Date.parse(chain.asOf)))return null;
 const publication=Date.parse(chain.asOf),trade=Date.parse(chain.underlyingLastTradeAt);
 if(chain.source.toLowerCase()!=='cboe')return Number.isFinite(trade)&&date(trade)!==date(publication)?null:chain.asOf;
 if(!Number.isFinite(trade)||(!Number.isInteger(chain.delayMinutes)||chain.delayMinutes<0))return null;
 const lag=instantTicks(utc(chain.asOf))-instantTicks(utc(chain.underlyingLastTradeAt)),difference=lag-BigInt(chain.delayMinutes)*600000000n;return lag>=0n&&(difference<0n?-difference:difference)<=1200000000n&&date(trade)===date(publication)?chain.underlyingLastTradeAt:null;
}
async function capture(){
 if(!request.context.allowWrites){const error=Error('Explicit write permission required');error.code='permission_denied';throw error;}
 const fresh=!existsSync(db);mkdirSync(dirname(db),{recursive:true});const database=new DatabaseSync(db);
 try{
 database.exec('PRAGMA busy_timeout=5000');if(fresh)database.exec('PRAGMA auto_vacuum=INCREMENTAL');
 database.exec('CREATE TABLE IF NOT EXISTS qqq_gex_cache_meta(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);INSERT OR IGNORE INTO qqq_gex_cache_meta VALUES(1,0);CREATE TABLE IF NOT EXISTS qqq_gex_wire(snapshot TEXT NOT NULL,request_key TEXT NOT NULL,content_type TEXT NOT NULL,body TEXT NOT NULL,revision TEXT NOT NULL,as_of INTEGER NOT NULL,expires_at INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(snapshot,request_key));CREATE TABLE IF NOT EXISTS qqq_gex_local_days(day TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS qqq_gex_local_day_hashes(day TEXT PRIMARY KEY,sha256 TEXT NOT NULL)');
 const expected=[...new Set((await source({kind:'expirations',symbol:'QQQ'})).value)].sort();
 if(expected.length<1||expected.length>128)return {status:'source_unavailable',symbol:'QQQ',complete:false,reason:'Expiry index must contain 1–128 dates'};
 let missingOi=0,missingIv=0,allRealtime=true,delayKnown=true,maxDelay=0,underlyingLastTradeAt=null,marketAt=null,timingVerified=true,selectedSource=null,asOf=null,spot=null,rawHash=null;
 const captures=[],missing=[],provenance=[];
 for(const expiry of expected)try{
  const received=await source({kind:'chain',symbol:'QQQ',expiry}),chain=received.value,contracts=chain.contracts;
  if(!Number.isFinite(Date.parse(chain.asOf))||!Number.isFinite(Date.parse(chain.fetchedAt))||!(chain.underlyingPrice>0)||!Number.isFinite(chain.underlyingPrice)||!Array.isArray(contracts)||!contracts.length||contracts.some(c=>c.expiration!==expiry)||new Set(contracts.map(c=>c.right+'|'+c.strike)).size!==contracts.length)throw sourceError('Missing source time/spot, wrong expiry or duplicate contract');
  allRealtime=allRealtime&&chain.isRealtime;delayKnown=delayKnown&&chain.delayMinutes!==null;maxDelay=Math.max(maxDelay,chain.delayMinutes??0);underlyingLastTradeAt??=chain.underlyingLastTradeAt;
  selectedSource??=chain.source;asOf??=chain.asOf;spot??=chain.underlyingPrice;
  if(chain.source!==selectedSource||utc(chain.asOf)!==utc(asOf)||chain.underlyingPrice!==spot)throw sourceError('Source, snapshot time or underlying spot changed across expiry reads');
  const sourceMarketAt=marketTime(chain);timingVerified=timingVerified&&sourceMarketAt!==null;marketAt??=sourceMarketAt;
  if((sourceMarketAt===null)!==(marketAt===null)||sourceMarketAt!==null&&utc(sourceMarketAt)!==utc(marketAt))throw sourceError('Source market event changed across expiry reads');
  if(received.raw){const candidate=received.raw.sha256.toUpperCase();if(rawHash!==null&&rawHash!==candidate)throw sourceError('Provider raw revision changed across expiry reads');if(rawHash!==candidate){const body=await readSnapshotReceipt(engine,received.raw);availableSpace(body.length);database.exec('BEGIN IMMEDIATE');try{database.exec('CREATE TABLE IF NOT EXISTS qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,as_of INTEGER NOT NULL,fetched_at INTEGER NOT NULL,body BLOB NOT NULL)');if(!database.prepare('PRAGMA table_info(qqq_gex_provider_raw)').all().some(field=>field.name==='encoding'))database.exec("ALTER TABLE qqq_gex_provider_raw ADD COLUMN encoding TEXT NOT NULL DEFAULT 'identity'");database.prepare("INSERT OR IGNORE INTO qqq_gex_provider_raw(sha256,source,as_of,fetched_at,body,encoding) VALUES(?,?,?,?,?,'gzip-v1')").run(candidate,chain.source,Date.parse(chain.asOf),Date.parse(chain.fetchedAt),gzipSync(body,{level:1}));database.exec('COMMIT');rawHash=candidate;}catch(error){database.exec('ROLLBACK');throw error;}}}
  const mapped=c=>({strike:c.strike,impliedVolatility:c.impliedVolatility,openInterest:c.openInterest,bid:c.bid,ask:c.ask,lastPrice:c.last,volume:c.volume,lastTradeDate:c.lastTradeTime===null?null:Math.floor(Date.parse(c.lastTradeTime)/1000),inTheMoney:c.inTheMoney});
  const oi=contracts.filter(c=>c.openInterest===null).length,iv=contracts.filter(c=>c.openInterest>0&&!(c.impliedVolatility>0)).length;missingOi+=oi;missingIv+=iv;
  const calls=contracts.filter(c=>c.right==='Call').map(mapped),puts=contracts.filter(c=>c.right==='Put').map(mapped);if(!calls.length||!puts.length)throw sourceError('One option side is absent');
  captures.push({underlyingLastTradeAt:chain.underlyingLastTradeAt,sourcePublicationAt:chain.asOf,sourceTimeAligned:sourceMarketAt!==null,sourceTimeBasis:chain.source==='cboe'?'reported-underlying-trade; exact option quote event time unavailable':'provider-asof',valuationAt:utc(sourceMarketAt??chain.asOf),expiry:Math.floor(Date.parse(expiry+'T00:00:00Z')/1000),spot:chain.underlyingPrice,result:{receivedAt:utc(chain.fetchedAt),options:[{calls,puts}]}});
  provenance.push({expiry,Source:chain.source,AsOf:chain.asOf,UnderlyingLastTradeAt:chain.underlyingLastTradeAt,FetchedAt:chain.fetchedAt,DelayMinutes:chain.delayMinutes,IsRealtime:chain.isRealtime,contracts:contracts.length,rawPayloadSha256:rawHash,missingOi:oi,missingIv:iv,greeks:'recomputed by original versioned source algorithm; provider Greeks are not substituted for the source model'});
 }catch(error){missing.push({expiry,error:error.sourceException??'InvalidDataException'});}
 const bars=[];let matchingBars=0,matchingRegularBars=0,barMetadata=null;const priceCutoff=marketAt??asOf;
 if(priceCutoff!==null)try{
  const snapshot=(await source({kind:'bars',symbol:'QQQ',interval:'1m',from:new Date(Date.parse(priceCutoff)-7*86400000).toISOString(),to:priceCutoff})).value,series=snapshot.series,groups=new Map(),sessions=new Map(series.bars.map((bar,index)=>[Date.parse(bar.time),snapshot.marketSessions[index]]));
  for(const bar of series.bars.filter(validBar)){const bucket=Math.floor(Date.parse(bar.time)/120000);const group=groups.get(bucket)??[];group.push(bar);groups.set(bucket,group);}
  for(const [bucket,group]of [...groups].sort((a,b)=>a[0]-b[0])){const rows=group.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),start=bucket*120000;if(rows.length!==2||Date.parse(rows[0].time)!==start||Date.parse(rows[1].time)!==start+60000||start+120000>Date.parse(priceCutoff))continue;if(date(start)===date(priceCutoff)){matchingBars++;if(sessions.get(start)==='Regular')matchingRegularBars++;}bars.push({timestamp:utc(new Date(start).toISOString()),open:rows[0].open,high:Math.max(...rows.map(row=>row.high)),low:Math.min(...rows.map(row=>row.low)),close:rows[1].close,volume:rows.reduce((sum,row)=>sum+row.volume,0)});}
  barMetadata={Source:series.source,AsOf:series.asOf,FetchedAt:series.fetchedAt,DelayMinutes:series.delayMinutes,IsRealtime:series.isRealtime,OfflineCache:series.offlineCache,Adjustment:adjustment(series.adjustment),availableBarDates:[...new Set(series.bars.map(bar=>date(bar.time)))].sort(),priceCutoff,sourceTimeBasis:'closed buckets end at or before reported source event; no future price bars',aggregation:'complete consecutive 1m pairs only; missing buckets omitted'};
 }catch(error){barMetadata={error:error.sourceException??'InvalidDataException'};}
 const daily={};const includeContext=true;
 if(captures.length)for(const symbol of ['QQQ','^VIX','^VIX3M','^VXN','^GSPC','^TNX','^IRX','CL=F','GC=F','DX-Y.NYB','SPY']){
  if(Date.now()-started>=90000)break;
  try{const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-3);const series=(await source({kind:'bars',symbol,interval:'1d',from:from.toISOString()})).value.series;daily[symbol]={source:series.source,asOf:series.asOf,fetchedAt:series.fetchedAt,delayMinutes:series.delayMinutes,isRealtime:series.isRealtime,offlineCache:series.offlineCache,adjustment:adjustment(series.adjustment),bars:series.bars.filter(validBar).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(-1000).map(bar=>({date:new Date(bar.time).toISOString().slice(0,10),timestamp:utc(bar.time),open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume}))};}
  catch(error){daily[symbol]={error:error.sourceException??'InvalidDataException',bars:[]};}
 }
 let macroQuotes=[];try{if(captures.length)macroQuotes=(await source({kind:'quotes',symbols:['^GSPC','^VIX','^VIX3M','^TNX','^IRX','CL=F','GC=F','DX-Y.NYB','SPY']})).value.map(capitalize);}catch{}
 const evaluationAt=utc(new Date().toISOString()),sourceTimeAligned=timingVerified&&marketAt!==null,qualityComplete=sourceTimeAligned&&captures.length===expected.length&&matchingRegularBars>0&&missingOi===0&&missingIv===0,timing=matchingBars>0?'same-market-date-bars-present':'no-aligned-price-bars';
 const document={symbol:'QQQ',source:selectedSource??'unavailable',basis:'normalized-provider-input',receivedAt:evaluationAt,evaluationAt,marketInputs:{contextDeferred:!includeContext,daily,macro:{quotes:macroQuotes,coverage:'actual routed quotes; missing/stale inputs reject macro computation'},optionSource:selectedSource,optionSnapshotAsOf:marketAt??asOf,optionPublicationAsOf:asOf,sourceMarketAt:marketAt,sourceTimeBasis:'CBOE uses reported underlying trade, not inferred option quote event time',underlyingLastTradeAt,optionDelayMinutes:delayKnown?maxDelay:null,optionIsRealtime:allRealtime,delayed:!allRealtime||maxDelay>0,coverage:'routed provider daily observations; missing or misaligned dates block source PCS evaluation'},expectedExpiries:expected,missingExpiries:missing,captures,bars,provenance,barMetadata,quality:{missingOi,missingIv,matchingBars,matchingRegularBars,sourceTimeAligned,timing,repair:'next scheduled capture retries original provider inputs; no IV inversion or timestamp shifting'},complete:false,providerCoverageComplete:qualityComplete,coverage:'one observed provider snapshot; not historical completeness'};
 let body=dotnetJson(document);
 if(Buffer.byteLength(body)>134217728)throw Error('Input exceeds 128 MB');availableSpace(Buffer.byteLength(body));
 if(captures.length){const semantic=JSON.parse(body);delete semantic.receivedAt;delete semantic.evaluationAt;for(const value of Object.values(semantic.marketInputs.daily))delete value.fetchedAt;for(const quote of semantic.marketInputs.macro.quotes)delete quote.FetchedAt;for(const capture of semantic.captures)delete capture.result.receivedAt;for(const row of semantic.provenance)delete row.FetchedAt;if(semantic.barMetadata)delete semantic.barMetadata.FetchedAt;const identity=hash(dotnetJson(semantic));database.exec('CREATE TABLE IF NOT EXISTS qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER NOT NULL,body_sha256 TEXT NOT NULL,body TEXT NOT NULL)');database.prepare('INSERT OR IGNORE INTO qqq_gex_observed_inputs VALUES(?,?,?,?)').run(identity,Date.now(),hash(body),encodeArchiveBody(body));const row=database.prepare('SELECT body,body_sha256 FROM qqq_gex_observed_inputs WHERE identity=?').get(identity);body=decodeArchiveBody(row.body);if(hash(body)!==row.body_sha256)throw Error('Observed input integrity failed');}
 await publishAppInput(engine,body);
 return {status:captures.length?'captured_input':'source_unavailable',symbol:'QQQ',basis:'normalized-provider-input',complete:false,providerCoverageComplete:qualityComplete,calculated:false,contextDeferred:!includeContext,expectedExpiries:expected.length,capturedExpiries:captures.length,missingExpiries:missing.length,bars:bars.length,matchingBars,matchingRegularBars,sourceTimeAligned,missingOi,missingIv,timing,source:selectedSource,asOf,sourceMarketAt:marketAt,sourceDelayMinutes:delayKnown?maxDelay:null,inputPath:join(root,'cache','qqq-gex-input.json'),runtime:'Run the pinned source calculation importer; this operation does not claim a published archive'};
 }finally{database.close();}
}
try{engine.finish(await capture());}catch(error){engine.finish({$appError:{code:error.code??'invalid_data',message:String(error.message??'App capture failed').slice(0,1000)}});}finally{engine.close();}
