import {expect,test} from 'bun:test';
import {exposureReplayDisplayDelta,exposureReplayDisplayDeltaDetails,exposureReplayModelTotals,exposureReplayDisplayPayload,exposureReplayExpiries,exposureReplayTableRows,type QqqExposureReplayContext} from './qqqExposureReplay';
import {buildQqqGammaModel,qqqGammaExpiryTime} from './qqqGammaModel';
import {blackScholesEngine} from './engines/pricing/BlackScholesEngine';
import type {ExposureFrame} from './qqqExposureWorkbench';
import type {QqqPcsApiResponse} from '@/types/qqqGex';
import {exposureValues,exposureStrikeMetric} from './qqqExposureWorkbench';
const time=Date.parse('2026-10-09T14:00:00Z');
const strike={strike:750,callGex:20,putGex:-10,totalGex:10,callOi:100,putOi:50,callIv:.2,putIv:.2,isCallWall:true,isPutWall:true,isGammaFlip:true,calculationVersion:'test-v3',gexUnit:'per-1pct' as const};
const frame=():ExposureFrame=>({time,profiles:[{expiry:'2026-10-09',time:time-60_000,strikes:[{...strike}]}],missing:[]});
test('partial deltas require the same valid strike set, definition and session',()=>{
 const first=frame(), second=frame();second.time+=120_000;
 for(const f of [first,second])Object.assign(f.profiles[0]!.strikes[0]!,{inputComplete:false,calculationVersion:'qqq-gex-full-1pct-v3'});
 second.profiles[0]!.strikes[0]!.totalGex=15;
 let [a,b]=exposureReplayTableRows([first,second],[]);
 expect(exposureReplayDisplayDelta(b!,a)).toBe(5);
 expect(exposureReplayDisplayDelta(a!)).toBeNull();
 expect(exposureReplayDisplayDelta({...b!,time:a!.time+300_001},a)).toBeNull();
 expect(exposureReplayDisplayDelta({...b!,time:Date.parse('2026-10-10T14:00:00Z')},a)).toBeNull();
 second.profiles[0]!.strikes[0]!.strike=751;
 [a,b]=exposureReplayTableRows([first,second],[]);
 expect(exposureReplayDisplayDelta(b!,a)).toBeNull();
 second.profiles[0]!.strikes[0]!.strike=750;
 second.missing=['2026-10-12'];
 [a,b]=exposureReplayTableRows([first,second],[]);
 expect(exposureReplayDisplayDelta(b!,a)).toBeNull();
 second.missing=[];
 Object.assign(second.profiles[0]!.strikes[0]!,{inputComplete:true});
 [a,b]=exposureReplayTableRows([first,second],[]);
 expect(exposureReplayDisplayDelta(b!,a)).toBeNull();
});
test('partial current-schema captures display valid strikes without enabling full-chain summaries',()=>{
 const f=frame();
 f.profiles[0]!.strikes=[
  Object.assign({...strike},{calculationVersion:'qqq-gex-full-1pct-v3',inputComplete:false}),
  Object.assign({...strike,strike:751,totalGex:9000,callGex:9010,callOi:undefined},{calculationVersion:'qqq-gex-full-1pct-v3',inputComplete:false}),
 ];
 expect([...exposureValues(f,'gamma',750)]).toEqual([[750,10],[751,null]]);
 expect([...exposureStrikeMetric(f,'gex')]).toEqual([[750,10],[751,null]]);
 const row=exposureReplayTableRows([f],[])[0]!;
 expect(row).toMatchObject({net:null,displayNet:10,partial:true,validStrikes:1,totalStrikes:2,displayCall:750,displayPut:750});
 expect(exposureReplayExpiries(f)[0]!.gexSummary).toBeNull();
 const model=buildQqqGammaModel(exposureReplayExpiries(f),750,new Date(time).toISOString());
 expect(model.excluded).toContain('2026-10-09');
 f.profiles[0]!.strikes[0]!.putIv=0;
 expect(exposureReplayTableRows([f],[])[0]!.displayNet).toBeNull();
});
const bars=[{timestamp:new Date(time-120_000).toISOString(),close:750,volume:0},{timestamp:new Date(time).toISOString(),close:900,volume:0}];
test('deployed v4 partial captures display valid exposures; delta resumes only within v4',()=>{
 const a=frame(),b=frame();b.time+=120_000;
 const p={...strike,inputComplete:false,calculationVersion:'qqq-gex-full-1pct-usable-iv-v4'};
 a.profiles[0]!.strikes=[{...p},{...p,strike:751,callOi:undefined}];
 b.profiles[0]!.strikes=[{...p,totalGex:15},{...p,strike:751,putIv:.00001}];
 const rows=exposureReplayTableRows([a,b],[]);
 expect(rows[0]).toMatchObject({partial:true,displayNet:10,validStrikes:1,net:null});
 expect(exposureReplayDisplayDelta(rows[1]!,rows[0])).toBe(5);
 expect([...exposureValues(a,'gamma',750)]).toEqual([[750,10],[751,null]]);
 a.profiles[0]!.strikes.forEach(s=>Object.assign(s,{calculationVersion:'qqq-gex-full-1pct-v3'}));
 const transition=exposureReplayTableRows([a,b],[]);
 expect(exposureReplayDisplayDelta(transition[1]!,transition[0])).toBeNull();
});
test('partial delta compares common valid strikes without counting coverage arrivals as exposure change',()=>{
 const a=frame(),b=frame();b.time+=120_000;
 const p={...strike,inputComplete:false,calculationVersion:'qqq-gex-full-1pct-v3'};
 a.profiles[0]!.strikes=[{...p},{...p,strike:751,totalGex:1000}];
 b.profiles[0]!.strikes=[{...p,totalGex:15},{...p,strike:752,totalGex:9000}];
 const rows=exposureReplayTableRows([a,b],[]);
 expect(rows[1]!.displayNet!-rows[0]!.displayNet!).toBe(8005);
 expect(exposureReplayDisplayDelta(rows[1]!,rows[0])).toBe(5);
 expect(exposureReplayDisplayDeltaDetails(rows[1]!,rows[0])).toMatchObject({value:5,comparedStrikes:1,commonCoverage:true});
 b.profiles[0]!.strikes[0]!.callOi=undefined;
 const empty=exposureReplayTableRows([a,b],[]);
 expect(exposureReplayDisplayDelta(empty[1]!,empty[0])).toBeNull();
 b.profiles[0]!.strikes[0]!.callOi=100;
 b.profiles[0]!.expiry='2026-10-12';
 const changed=exposureReplayTableRows([a,b],[]);
 expect(exposureReplayDisplayDelta(changed[1]!,changed[0])).toBeNull();
});
test('legacy multi-expiry summary uses complete common-time model, never stored unknown totals',()=>{
 const f=frame();f.profiles.push({expiry:'2026-10-12',strikes:[{...strike}]});
 for(const profile of f.profiles) Object.assign(profile.strikes[0]!,{calculationVersion:undefined,gexUnit:undefined});
 expect(exposureReplayTableRows([f],bars)[0]!.net).toBeNull();
 const model=buildQqqGammaModel(exposureReplayExpiries(f),750,new Date(time).toISOString());
 const totals=exposureReplayModelTotals(f,model)!;
 const unit=f.profiles.reduce((sum,p)=>sum+blackScholesEngine.price({S:750,K:750,T:(qqqGammaExpiryTime(p.expiry)-time)/(365*86400000),r:0,sigma:.2,type:'call'}).gamma*100*750**2*.01,0);
 expect(totals.call).toBeCloseTo(unit*100,5);expect(totals.put).toBeCloseTo(unit*50,5);expect(totals.net).toBeCloseTo(unit*50,5);
 expect(exposureReplayModelTotals({...f,missing:['2026-10-13']},model)).toBeNull();
 expect(exposureReplayModelTotals(f,{...model,excluded:['2026-10-12']})).toBeNull();
 expect(exposureReplayModelTotals(f,{...model,asOf:new Date(time-1).toISOString()})).toBeNull();
 expect(exposureReplayModelTotals(f,{...model,expiries:['2026-10-09']})).toBeNull();
});
const context=():QqqExposureReplayContext=>({date:'2026-10-09',selectedExpiry:'2026-10-09',scope:'selected',followingLatest:false,frame:frame(),bars});
const base={candidate:{status:'READY'},daily:{eligibility:{value:'OPEN'},reasons:[]},timing:{value:'NOW'},regime:{unified:'LATEST'},factors:{latest:true},asOf:new Date(time+3600_000).toISOString(),view:{date:'2026-10-09',mode:'live'},intraday:{bars,gexExpiries:[],gammaModels:{selected:{spot:900}},terminal:{latest:true},directional:{current:{latest:true}},gammaPositionHistory:[{latest:true}]}} as unknown as QqqPcsApiResponse;
test('replay freezes receipt and closed candles, removes future models and decisions',()=>{
 const result=exposureReplayDisplayPayload(base,context());
 expect(result.observedAt).toBe(new Date(time).toISOString());
 expect(result.intraday?.bars).toEqual([bars[0]!]);
 expect(result.intraday?.gammaModels).toBeUndefined();
 expect(result.intraday?.terminal).toBeNull();
 expect(result.intraday?.directional).toBeUndefined();
 expect(result.intraday?.gammaPositionHistory).toEqual([]);
 expect(result.intraday?.gexExpiries![0]!.asOf).toBe(new Date(time-60_000).toISOString());
 expect(base.intraday?.bars).toHaveLength(2);
});
test('absent selected expiry remains empty; never falls back to another DTE',()=>{
 const replay={...context(),selectedExpiry:'2026-10-12'};
 const e=exposureReplayDisplayPayload(base,replay).intraday!.gexExpiries![0]!;
 expect(e.expiryDate).toBe('2026-10-12');expect(e.gexSummary).toBeNull();expect(e.fullGexProfile).toEqual([]);
 const noFrame=exposureReplayDisplayPayload(base,{...replay,frame:null});
 expect(noFrame.intraday?.bars).toEqual([]);
 expect(noFrame.intraday?.gexExpiries?.every(e=>!e.fullGexProfile.length)).toBe(true);
});
test('unclosed or stale prices cannot supply replay valuation',()=>{
 expect(exposureReplayDisplayPayload(base,{...context(),bars:bars.slice(1)}).intraday?.bars).toEqual([]);
 expect(exposureReplayDisplayPayload(base,{...context(),frame:{...frame(),time:time+600_000}}).intraday?.bars).toEqual([]);
});
test('snapshot sums preserve saved unit and refuse mixed/unknown aggregate calculations',()=>{
 const f=frame();f.profiles.push({expiry:'2026-10-12',strikes:[{...strike}]});
 expect(exposureReplayTableRows([f],bars)[0]!.net).toBe(20);
 Object.assign(f.profiles[1]!.strikes[0]!,{gexUnit:'per-point'});
 expect(exposureReplayTableRows([f],bars)[0]!.net).toBeNull();
 Object.assign(f.profiles[1]!.strikes[0]!,{gexUnit:undefined});
 expect(exposureReplayTableRows([f],bars)[0]!.net).toBeNull();
});
test('delta compatibility excludes unknown versions, missing expiry coverage and unit changes',()=>{
 const f=frame();
 expect(exposureReplayTableRows([f],bars)[0]!.comparisonKey).not.toBeNull();
 f.missing=['2026-10-12'];expect(exposureReplayTableRows([f],bars)[0]!.comparisonKey).toBeNull();
 f.missing=[];Object.assign(f.profiles[0]!.strikes[0]!,{calculationVersion:undefined});
 expect(exposureReplayTableRows([f],bars)[0]!.comparisonKey).toBeNull();
});
test('incomplete and future profiles never become a valid current snapshot',()=>{
 const f=frame();Object.assign(f.profiles[0]!.strikes[0]!,{inputComplete:false});
 expect(exposureReplayExpiries(f)[0]!.gexSummary).toBeNull();
 f.profiles[0]!.time=time+1;expect(exposureReplayExpiries(f)).toEqual([]);
});

test('replay payload cannot carry latest trade eligibility or scoring to later consumers',()=>{
 const r=exposureReplayDisplayPayload(base,context());
 expect(r.candidate.status).toBe('UNAVAILABLE');
 expect(r.daily.eligibility.value).toBe('UNAVAILABLE');
 expect(r.timing.value).toBe('INSUFFICIENT_DATA');
 expect(r.factors).toEqual({});
 expect(r.regime.unified).toBeNull();
 expect(r.intraday?.scoreSeries).toEqual([]);
 expect(r.intraday?.gexAsOf).toBe(r.observedAt);
});

test('replay King follows the stored net-exposure convention rather than gross Call magnitude',()=>{
 const f=frame();f.profiles[0]!.strikes.push({...strike,strike:751,callGex:15,putGex:-1,totalGex:14});
 expect(exposureReplayExpiries(f)[0]!.gexSummary).toMatchObject({king:{strike:751,magnitude:14,side:'call'},callTotal:24,putTotal:0});
 f.profiles[0]!.strikes.push({...strike,strike:752,callGex:1,putGex:-31,totalGex:-30});
 expect(exposureReplayExpiries(f)[0]!.gexSummary).toMatchObject({king:{strike:752,magnitude:-30,side:'put'},netGex:-6,callTotal:24,putTotal:-30});
});
