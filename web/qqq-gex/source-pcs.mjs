// Build-time extraction of the pinned route's pure PCS rules. No server I/O is bundled.
import ts from 'typescript';import {readFile} from 'node:fs/promises';import path from 'node:path';
export async function sourcePcsModule(root){
 const text=await readFile(path.join(root,'upstream/src/app/api/analysis/qqq/pcs/route.ts'),'utf8'),tree=ts.createSourceFile('route.ts',text,ts.ScriptTarget.Latest,true);
 const names=['projectQqqGexDisplayPayload','easternDateKey','resolveCompletedCloseDate','calendarDaysUntilExpiration','calendarDaysToExpiration','isRegularSession','isPremarketSession','dailyEvaluationPhase','resolveDateAlignedLiveRegime','shouldEnforcePreviousClosePcsGate','shouldExposeLivePcsCandidate','dailySessionProgress','dailyConfirmationScore','intradayFactors','dailyEligibility','optionQuote','optionIv','deriveOptionGreeks','normalizeOptionContract','selectQqqOptionExpirations','buildPcsReplayModelTarget','buildPcsContractCandidate','tradingSessionsUntilExpiration','buildPcsProbabilityContext'];
 const functions=names.map(name=>{const node=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);if(!node)throw Error('Pinned PCS function missing: '+name);return node.getText(tree);}).join('\n');
 const constants=['MAX_INTRADAY_AGE_MS','PCS_HELPER_REFERENCE_DTE','PCS_EXPIRY_LOOKAHEAD_DAYS','GEX_MAX_DTE'].map(name=>{const declarations=tree.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]);const declaration=declarations.find(n=>n.name.getText(tree)===name);if(!declaration)throw Error('PCS constant missing '+name);return 'const '+declaration.getText(tree)+';';}).join('\n');
 const start=text.indexOf('    const dailyMarketBase = buildQqqDailyMarketBase({'),end=text.indexOf('    const candidateInput = {',start);if(start<0||end<0)throw Error('Pinned PCS factor pipeline markers changed');
 const factors=text.slice(start,end).replace(/    if \(isHistorical\) \{[\s\S]*?\n    \}/,'');
 return {functions:names,contents:`
import {MacroDataService} from 'source:qqq-macro';
import {createRawFactor,createDerivedFactor,fallbackFactor} from '@/lib/factor';
import {qqqMarketSession,qqqPreviousTradingDate} from '@/lib/qqqMarketSession';
import {qqqSessionVwap} from '@/lib/qqqSessionVwap';
import {indicatorEngine} from '@/lib/engines/indicators/IndicatorEngine';
import {buildQqqDailyMarketBase} from '@/lib/engines/analysis/QqqDailyMarketBase';
import {buildQqqPcsEntrySnapshot} from '@/lib/engines/analysis/QqqPcsEntrySnapshot';
import {addReactivePcsProductionFactors} from '@/lib/engines/analysis/SellerOpportunityFactors';
import {qqqAtmIv} from '@/lib/qqqAtmIv';
import {qqqChartProfile} from '@/lib/qqqChartProfile';
import {qqqDirectionalGexTime} from '@/lib/qqqDirectionalGexTime';
import {qqqGammaExpiryTime,QQQ_GAMMA_INPUT_VERSION,buildQqqGammaModel,type GammaModelExpiry} from '@/lib/qqqGammaModel';
import {blackScholesEngine} from '@/lib/engines/pricing/BlackScholesEngine';
import {selectPcsContractProfile} from '@/lib/engines/leveraged-overlay/v2/strategies/pcs-contract-profile';
import {CS_SPREAD_WIDTH_PCT,SPREAD_TARGET_DTE} from '@/lib/engines/leveraged-overlay/constants';
import {buildMockOptionChain,normalizeVolIndexForMockOptions,marketTradingDates} from '@/lib/engines/leveraged-overlay/backtest/mockOptions';
import {buildPutCreditSpreadOpen} from '@/lib/engines/leveraged-overlay/v2/strategies/put-credit-spread';
import {calculateGeneralAPR} from '@/lib/apr';
import {buildStrikeSurvivalCondition,computeConditionalStrikeSurvivalForHorizon,computeSellerStats,computeStrikeSurvivalForHorizon} from '@/lib/engines/analysis/SellerStatsEngine';
import {snapshotQqqLifecycleFactors} from '@/lib/qqqLifecycleFactors';
import {twoMinuteBucket} from '@/lib/engineTimeline';
const QQQ='QQQ';const loadQqqOptionChainSnapshot=()=>{throw Error('Missing local option snapshot; remote fallback is forbidden');};
${constants}\n${functions}
export async function evaluateSourcePcs(input:any){
 const now=new Date(input.evaluationAt);if(!Number.isFinite(now.getTime()))throw Error('Invalid local evaluation time');const today=easternDateKey(now),livePhase=dailyEvaluationPhase(now),isHistorical=false,selectedAsOf=null,regimeMode=input.regimeMode==='overlay'?'overlay':'unified';let macro:any=null;const macroIssues:string[]=[];
 const rawMacro=input.marketInputs?.macro;if(rawMacro){const symbols=['^GSPC','^VIX','^VIX3M','^TNX','^IRX','CL=F','GC=F','DX-Y.NYB','SPY'];const quotes:any={};for(const symbol of symbols){const q=rawMacro.quotes?.find((v:any)=>v.Symbol===symbol||v.symbol===symbol);const value=q?.Price??q?.price,at=Date.parse(q?.AsOf??q?.asOf);if(!Number.isFinite(value)||value<=0||!Number.isFinite(at)||at>now.getTime()||now.getTime()-at>30*60000){macroIssues.push('Missing/stale macro quote '+symbol);continue;}quotes[symbol]={value:{price:value,changePercent:q.ChangePercent??q.changePercent??0},confidence:10,source:{type:'raw',api:q.Source??q.source}};}const history=(symbol:string)=>(input.marketInputs.daily?.[symbol]?.bars??[]).filter((b:any)=>b.date<today&&Date.parse(b.date)>=now.getTime()-365*86400000).map((b:any)=>({...b,date:b.date}));const spx=history('^GSPC'),vix=history('^VIX');if(spx.length<200||vix.length<63||spx.at(-1)?.date!==vix.at(-1)?.date)macroIssues.push('Macro history missing or dates disagree');if(!macroIssues.length)macro=await new MacroDataService().fetchMacroData(JSON.stringify({quotes,spx,vix}),{includeOptionsIV:false});}

 const dailyInputs=input.marketInputs?.daily??{},qqqDailyBars=(dailyInputs.QQQ?.bars??[]).filter((b:any)=>b.date<=today).sort((a:any,b:any)=>a.date.localeCompare(b.date)),completedCloseDate=resolveCompletedCloseDate(now,qqqDailyBars),slowDailyAsOf=completedCloseDate,previousCloseQqqDailyBars=qqqDailyBars.filter((b:any)=>!completedCloseDate||b.date<=completedCloseDate),closes=qqqDailyBars.map((b:any)=>b.close);
 const point=(symbol:string,previous=false)=>{const rows=(dailyInputs[symbol]?.bars??[]).filter((b:any)=>b.date<=completedCloseDate).sort((a:any,b:any)=>a.date.localeCompare(b.date));const value=rows.at(previous?-2:-1);return value?{close:value.close,asOf:value.date,source:dailyInputs[symbol].source}:null;};
 const vix=point('^VIX'),vix3m=point('^VIX3M'),previousVix=point('^VIX',true),vxnPoint=point('^VXN'),priorVxnPoint=point('^VXN',true),vxn=vxnPoint?.close??0,priorVxn=priorVxnPoint?.close??0;
 const alignedVix=vix&&vix3m&&vix.asOf===completedCloseDate&&vix3m.asOf===completedCloseDate&&completedCloseDate===qqqPreviousTradingDate(today);
 const session={bars:input.bars??[]},selectedLiveSession={regularSessionIsCurrent:session.bars.some((b:any)=>easternDateKey(new Date(b.timestamp))===today)};
 const underlyingTime=(c:any)=>c.underlyingLastTradeAt??(Date.parse(c.valuationAt)===Date.parse(input.marketInputs?.optionSnapshotAsOf)?input.marketInputs?.underlyingLastTradeAt:null);
 const selected=selectQqqOptionExpirations(input.captures.map((c:any)=>c.expiry),now,false),capture=input.captures.find((c:any)=>c.expiry===selected[0]&&Number.isFinite(Date.parse(underlyingTime(c)))&&easternDateKey(new Date(underlyingTime(c)))===today&&Date.parse(underlyingTime(c))<=now.getTime()&&now.getTime()-Date.parse(underlyingTime(c))<=MAX_INTRADAY_AGE_MS&&easternDateKey(new Date(c.valuationAt))===today&&Date.parse(c.valuationAt)<=now.getTime()&&now.getTime()-Date.parse(c.valuationAt)<=MAX_INTRADAY_AGE_MS);
 let optionSnapshot:any=null;if(capture){const options=capture.result.options?.[0],puts=(options?.puts??[]).map((p:any)=>normalizeOptionContract(p,{spot:capture.spot,expiry:capture.expiry,now,type:'put',receivedAt:capture.result.receivedAt})),calls=(options?.calls??[]).map((p:any)=>normalizeOptionContract(p,{spot:capture.spot,expiry:capture.expiry,now,type:'call',receivedAt:capture.result.receivedAt}));optionSnapshot={expiry:capture.expiry,daysToExpiration:calendarDaysToExpiration(capture.expiry,now),gexDte:calendarDaysUntilExpiration(capture.expiry,now),puts,calls,atmIV:qqqAtmIv(calls,puts,capture.spot),source:input.source,capturedAt:capture.valuationAt};}
 const price=qqqDailyBars.at(-1)?.close??0,priceFactor=createRawFactor(price,(v:number)=>Number.isFinite(v)&&v>0,'Local routed QQQ daily source',undefined,0);
 ${text.slice(text.indexOf('    const closesFactor = createRawFactor(closes,'),text.indexOf('    // GEX：纯展示信息',text.indexOf('    const closesFactor = createRawFactor(closes,')))}
 ${text.slice(text.indexOf('    const ivHistory = closesFactor.confidence'),text.indexOf('    // During pre-market Yahoo',text.indexOf('    const ivHistory = closesFactor.confidence')))}
 ${factors}
 const previousCloseEligibility=previousCloseDaily?.value??daily.value;const expose=shouldExposeLivePcsCandidate(livePhase,daily.value,previousCloseEligibility);
 const candidate=expose&&optionSnapshot?await buildPcsContractCandidate({now,spot:Number(priceFactor.value),regime:String(factors.pcs_market_regime.value),vix:Number(factors.vix_price.value),vix3m:Number(factors.vix3m_price.value),vxn:Number(factors.vxn_price.value),annualizedRv20:Number(historicalVolatility.value)},optionSnapshot):{status:'UNAVAILABLE',reason:optionSnapshot?daily.reasons.join('；'):'缺少同日且时效合格的真实目标到期日期权链'};
 const probabilityContext=buildPcsProbabilityContext(qqqDailyBars,candidate,price,Number(historicalVolatility.value),easternDateKey(now));
 ${text.slice(text.indexOf('    const canRecordIntraday = isRegularSession(now)'),text.indexOf('    // Unified Supabase collector owns GEX history',text.indexOf('    const canRecordIntraday = isRegularSession(now)'))).replaceAll('!isHistorical &&','')}
 for(const value of Object.values(snapshot.factors) as any[]){if(value?.source?.description)value.source.description=value.source.description.replaceAll('Yahoo','Local routed');if(value?.source?.api)value.source.api=value.source.api.replaceAll('Yahoo','Local routed');}if(!macro){for(const id of ['pcs_market_regime','market_state'])if(snapshot.factors[id]?.source)snapshot.factors[id].source.description='Pinned source completed-day Overlay fallback; local routed daily inputs';}
 return {symbol:'QQQ',asOf:now.toISOString(),modelSource:'option-seller/work@8abee90a',regime:{mode:regimeMode,selectedEngine:regimeMode,unified:unifiedPcsRegime,overlay:overlayPcsRegime,disagreement:unifiedPcsRegime.value!==overlayPcsRegime.value,macroAvailable:!!macro,issues:macroIssues},view:{mode:'live',date:today},dataStatus:!alignedVix||daily.value==='UNAVAILABLE'?'INSUFFICIENT':input.marketInputs?.delayed?'DELAYED':'LIVE',dataIssues:[...daily.reasons,...macroIssues,...(!capture?['同日且新鲜的期权链/标的成交时点未对齐；候选不可用']:[]),...(!alignedVix?['QQQ/VIX/VIX3M 完成收盘日期缺失或未对齐']:[])],daily:{eligibility:snapshot.dailyEligibility,reasons:daily.reasons,phase:livePhase,asOf:completedCloseDate,priceBasis:'PREVIOUS_CLOSE',confirmation:factors.pcs_daily_confirmation},timing:snapshot.intradayTiming,candidate,previousCloseEligibility,probabilityContext,evaluatedLifecyclePoint:currentLifecyclePoint,factors:snapshot.factors,sourceMetadata:input.marketInputs,accountScope:'Analysis-only; original zero-position assumption is not actual account permission'};
}`};
}
