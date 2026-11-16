import {prepareExposureChartReplay,exposureReplayChartPayload,exposureReplayMatrixExpiries} from '../upstream/src/lib/qqqExposureChartReplay';
import {prepareHedgeObservations,hedgeObservationWindow} from '../upstream/src/lib/qqqHedgeObservations';
import {prepareHeatmapDiscovery} from '../upstream/src/lib/qqqHeatmapDiscovery';
import {prepareHeatmapOverlays} from '../upstream/src/lib/qqqHeatmapOverlays';
import {qqqSpreadStudy} from '../upstream/src/lib/qqqSpreadStudy';
import {readLocalContext} from './local-context';
import {prepareWallTouchEvents,summarizeWallTouches} from '../upstream/src/lib/qqqWallTouchStats';
import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {hydrateDay} from './local-rows';import {displayLocalDay} from './display-day';
import {exposureFrames,exposureSpotIndex,exposureValues,exposureStrikeMetric,exposureStrikeComparisons,exposureConcentrationLevels,exposureActivity,prepareAggregateGammaFrames,prepareExposureField} from '../upstream/src/lib/qqqExposureWorkbench';
import {exposureReplayDisplayPayload,exposureReplayTableRows,exposureReplayDisplayDeltaDetails} from '../upstream/src/lib/qqqExposureReplay';
import {prepareQqqAtmIvObservation,qqqAtmIvAt,qqqSnapshotAtmIv} from '../upstream/src/lib/qqqAtmIvObservation';
import {prepareQqqMaxPain,qqqMaxPainAt} from '../upstream/src/lib/qqqMaxPain';
import {createQqqDisplayGammaModels} from '../upstream/src/lib/qqqDisplayGammaModels';
import {qqqGammaObservationInput} from '../upstream/src/lib/qqqGammaObservationInput';
import {qqqOptionOverview} from '../upstream/src/lib/qqqOptionObservation';
import {qqqRegularBarIndex,qqqPulseSeries,qqqWindowVolatility,qqqRegularObservationCutoff,prepareRvolBaseline,qqqRvolFromBaseline} from '../upstream/src/lib/qqqIntradayIndicators';
import {buildDayScenario,dayScenarioInput} from '../upstream/src/lib/qqqDayScenario';
import {qqqMarketDateBounds} from '../upstream/src/lib/qqqMarketDate';
/** Original UI kernels; no substitute for absent prices or IV. */
export async function readMcpAnalysis(dbPath:string,url:URL){
 const p=url.searchParams,date=p.get('date')??'',expiry=p.get('expiry'),at=Date.parse(p.get('at')??''),analysis=p.get('analysis')??'',scope=p.get('scope')??'selected',mode=p.get('mode')??'gamma',metric=p.get('metric')??'gex';qqqMarketDateBounds(date);
 if(!Number.isFinite(at)||!['selected','0dte','all'].includes(scope)||!['gamma','gamma-call','gamma-put','delta','charm'].includes(mode)||!['gex','oi','volume'].includes(metric)||!['exposure','replayTable','gammaModel','atmIv','maxPain','pulse','optionOverview','dayScenario','wallTouches','spreadStudy','structureEvents','activityResponse','overlays','chart','heatmapField'].includes(analysis)||[...p.keys()].some(k=>!['date','expiry','at','analysis','scope','mode','metric','side','shortStrike','longStrike','ivShockPp','fees','basis','manualCredit','minutes','strikes'].includes(k)))throw Error('Invalid original analysis scope');
 if(expiry)qqqMarketDateBounds(expiry);if(scope==='selected'&&!expiry)throw Error('Selected scope requires expiry');if(['pulse','spreadStudy','wallTouches'].includes(analysis)&&scope!=='selected')throw Error('This study requires a selected expiry');if(analysis!=='spreadStudy'&&['side','shortStrike','longStrike','ivShockPp','fees','basis','manualCredit'].some(k=>p.has(k)))throw Error('Spread parameters require spreadStudy');
 const db=new DatabaseSync(dbPath,{readOnly:true});db.exec('PRAGMA busy_timeout=5000;BEGIN');try{
 const record=db.prepare('SELECT d.revision,d.payload,h.sha256 FROM qqq_gex_local_days d JOIN qqq_gex_local_day_hashes h ON d.day=h.day WHERE d.day=?').get(date) as any;
 if(!record)return {available:false,status:'cache_miss',complete:false};if(Buffer.byteLength(record.payload)>128*1024*1024||createHash('sha256').update(record.payload).digest('hex')!==record.sha256)throw Error('Analysis day integrity failed');
 const day=hydrateDay(db,JSON.parse(record.payload)),data=displayLocalDay(day,date,expiry),expiries=(data.intraday?.gexExpiries??[]).filter(e=>scope==='all'||e.expiryDate===(scope==='0dte'?date:expiry)),bars=day.bars,rawFrames=exposureFrames(expiries,at,scope as any,expiry,date),spotAt=exposureSpotIndex(bars),controller=new AbortController(),frames=scope==='all'?await prepareAggregateGammaFrames(rawFrames,spotAt,controller.signal):rawFrames,frame=frames.at(-1),spot=frame?spotAt(frame.time):null;let result:any;const strikes=p.has('strikes')?new Set(p.get('strikes')!.split(',').map(Number)):undefined;if(strikes&&(strikes.size>2000||[...strikes].some(v=>!Number.isFinite(v)||v<=0)))throw Error('Invalid selected strikes');
 if(!frame)return {available:false,status:'causal_frame_missing',complete:false,revision:record.revision,date,expiry,at:new Date(at).toISOString()};
 const replay={date,selectedExpiry:expiry,scope:scope as any,followingLatest:false,frame,bars,frames,rawFrames};
 switch(analysis){
 case 'chart':await prepareExposureChartReplay(frames,bars,controller.signal);{const projected=exposureReplayChartPayload(data,replay);result={display:projected,matrixExpiries:exposureReplayMatrixExpiries(expiries,projected.intraday?.gexExpiries??[],date)};}break;
 case 'heatmapField':{const field=await prepareExposureField({frames,mode:mode as any,metric:metric as any,spotAt,selectedStrikes:strikes??new Set(frames.flatMap(f=>f.profiles.flatMap(p=>p.strikes.map(s=>s.strike)))),comparisons:true,activity:true},controller.signal);result={cells:field.cells.map(c=>({time:c.frame.time,missing:c.frame.missing,values:[...c.values]})),activity:field.activity};break;}
 case 'structureEvents':result=await prepareHeatmapDiscovery({frames,bars,expiry,scope:scope==='all'?'all':'selected'},undefined,controller.signal);break;
 case 'activityResponse':{const series=await prepareHedgeObservations({frames,bars},controller.signal),minutes=Number(p.get('minutes')??10);if(![2,10,30].includes(minutes))throw Error('Unsupported observation window');result={series,window:hedgeObservationWindow(series,at,minutes)};break;}
 case 'overlays':result=await prepareHeatmapOverlays({frames,bars,date,expiry,scope:scope==='all'?'all':'selected',flags:{vwap:true,delta:true,iv:true,putCall:true}},controller.signal);break;
 case 'exposure':result={time:frame.time,missing:frame.missing,values:[...exposureValues(frame,mode as any,spot,strikes)],strikeMetric:[...exposureStrikeMetric(frame,metric as any,strikes)],comparisons:exposureStrikeComparisons(frames,frame,metric as any,strikes),concentration:exposureConcentrationLevels(frame),activity:exposureActivity(frames.at(-2),frame)};break;
 case 'replayTable':{const rows=exposureReplayTableRows(frames,bars);result=rows.map((row,i)=>({...row,displayValues:[...row.displayValues],delta:exposureReplayDisplayDeltaDetails(row,rows[i-1])}));break;}
 case 'gammaModel':{const isolated=exposureReplayDisplayPayload(data,replay),observation=qqqGammaObservationInput(isolated);result={models:createQqqDisplayGammaModels()(observation.data,expiry),coverage:[...observation.coverage]};break;}
 case 'atmIv':result=qqqAtmIvAt(await prepareQqqAtmIvObservation(expiries,rawFrames,bars,date,controller.signal),at);break;
 case 'maxPain':result=qqqMaxPainAt(await prepareQqqMaxPain(expiries,rawFrames,date,controller.signal),at);break;
 case 'optionOverview':result=qqqOptionOverview(frame.profiles.flatMap(p=>p.strikes));break;
 case 'wallTouches':{const dte=expiry?Math.round((Date.parse(expiry)-Date.parse(date))/86400000):0,context=readLocalContext(db,date,dte,'all',new Date(at).toISOString()),events=await prepareWallTouchEvents(context.days,date,controller.signal);result={events,summary:summarizeWallTouches(events),missingDates:context.missingDates,referenceComplete:context.referenceComplete};break;}
 case 'pulse':{const cutoff=qqqRegularObservationCutoff(date,at),index=qqqRegularBarIndex(bars,date),points=qqqPulseSeries(index).filter(p=>p.time<=cutoff),iv=qqqSnapshotAtmIv(frame.profiles.flatMap(p=>p.strikes),spot)||null;result={points,volatility:[10,30].map(minutes=>qqqWindowVolatility(index,cutoff,minutes as 10|30,iv,frame.time,expiry)),referenceComplete:false,rvol:qqqRvolFromBaseline(points.at(-1),await prepareRvolBaseline(readLocalContext(db,date,0,'volume',new Date(at).toISOString()).days,date,controller.signal),cutoff),issues:['Only retained reference days; inspect context missingDates; missing volume is never zero-filled']};break;}
 case 'spreadStudy':if(scope!=='selected'||!expiry)throw Error('Spread study requires selected expiry');result=qqqSpreadStudy({profile:frame.profiles.flatMap(p=>p.strikes),expiry,at:frame.time,cutoff:at,spot,side:(p.get('side')??'put') as any,shortStrike:Number(p.get('shortStrike')),longStrike:Number(p.get('longStrike')),ivShockPp:Number(p.get('ivShockPp')??0),fees:Number(p.get('fees')??0),basis:(p.get('basis')??'bidAsk') as any,manualCredit:p.has('manualCredit')?Number(p.get('manualCredit')):null});break;
 case 'dayScenario':if(!['gamma','gamma-call','gamma-put'].includes(mode))throw Error('Day scenario requires gamma mode');result=buildDayScenario(dayScenarioInput(rawFrames.at(-1),date,spot),mode as any,'complete');break;
 }
 return {available:true,complete:false,date,expiry,at:new Date(at).toISOString(),scope,analysis,revision:record.revision,source:'Pinned original UI kernels; retained local observations only',coverage:'Inspect per-row inputComplete, source timing and model versions. No missing history or prices synthesized.',result};
 }finally{db.close();}
}
export const analysisJson=(value:any)=>JSON.stringify(value,(_key,v)=>v instanceof Map?[...v]:ArrayBuffer.isView(v)?Array.from(v as any):typeof v==='number'&&!Number.isFinite(v)?null:v);
