/** One research composition graph and one complete host/audit/result lifecycle. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {StrategySnapshot,BarStrategyModule} from './strategy-module-v2';
import type {ResolvedBacktestRunSpec} from '../engines/leveraged-overlay/v2/backtest/run-spec';
import {runBarStrategyWithAdapter,type StrategyHostRecord} from './strategy-host-v2';
import {createQqqSourceExecutionAdapter} from './qqq-source-adapter-v2';
import {createQqqObservedSpreadAdapter} from './qqq-observed-spread-adapter-v2';
import {createResearchResultCollector,acceptSpreadResearchAccount,assertResearchExecutionCoverage,hashResearchValue} from './research-result-v2';
import {resolveSpreadExecutionConfig} from './spread-execution-config-v3';
import {resolveStandaloneIdentity} from './standalone-identity-v4';
import {resolveSpreadExecutionProfile} from './spread-execution-profiles-v3';
import type {ResearchReplayRequest} from './research-request-v3';
import type {resolveE209SourceContract} from './e209-source-initialization-v2';
import type {resolveP6E385SourceContract} from './p6-source-initialization-v2';
import {createNativeSourceSpec} from './native-source-initialization-v2';
import {loadStandaloneStrategy} from './standalone-strategy-loader-v4';
import {standaloneStrategyRepositoryPath,standaloneStrategyCatalog,assertStandaloneExecutionProfile,type StandaloneId} from './standalone-strategy-catalog-v4';
import type {QqqSpreadAdapterConfig} from './qqq-spread-adapter-v2';
import {spreadTradeStatistics} from './spread-research-metrics-v2';
import {assessStandaloneRisk} from './standalone-risk-v1';

export {STANDALONE_IDS,type StandaloneId} from './standalone-strategy-catalog-v4';
export type ResearchRunOptions={codeHash?:string;signal?:AbortSignal;retainDecisions?:boolean;shareMarket?:boolean;onRecord?:(record:Readonly<StrategyHostRecord>)=>Promise<void>|void};
type RunWindow=Pick<ResearchReplayRequest,'startDate'|'endDate'|'executionProfile'>&{fixture?:ResearchReplayRequest['fixture'];terminalExit?:'mark-only'};
type SourceContract=ReturnType<typeof resolveE209SourceContract>|ReturnType<typeof resolveP6E385SourceContract>|ReturnType<typeof createNativeSourceSpec>;
type Composition={sourceContract:SourceContract;portfolioConfig:QqqSpreadAdapterConfig;sourceConfig:QqqSpreadAdapterConfig|null;
  nativeSpecs:Record<string,ResolvedBacktestRunSpec>;contextSource?:string;
  definitions:Array<{id:string;config:QqqSpreadAdapterConfig}>;observationPolicy?:boolean;single?:boolean;
  fillContractGroups?:Readonly<Record<string,readonly string[]>>;mapSnapshot?:(snapshot:StrategySnapshot)=>StrategySnapshot};

export const standalonePlugins:Record<StandaloneId,{module:BarStrategyModule;path:string;
  compose:(data:MarketDataSet,request:RunWindow)=>Composition}>={
  'EB8.412':{get module(){return loadStandaloneStrategy('EB8.412');},path:standaloneStrategyRepositoryPath('EB8.412'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.412',request.executionProfile);
      return standalonePlugins['EB8.411'].compose(data,request);}},
  'EB8.3896':{get module(){return loadStandaloneStrategy('EB8.3896');},path:standaloneStrategyRepositoryPath('EB8.3896'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.3896',request.executionProfile);return standalonePlugins['EB8.1298'].compose(data,request);}},
  'EB8.1298':{get module(){return loadStandaloneStrategy('EB8.1298');},path:standaloneStrategyRepositoryPath('EB8.1298'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.1298',request.executionProfile);return standalonePlugins['EB8.940'].compose(data,request);}},
  'EB8.940':{get module(){return loadStandaloneStrategy('EB8.940');},path:standaloneStrategyRepositoryPath('EB8.940'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.940',request.executionProfile);
      return standalonePlugins['EB8.412'].compose(data,request);}},
  'EB8.411':{get module(){return loadStandaloneStrategy('EB8.411');},path:standaloneStrategyRepositoryPath('EB8.411'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.411',request.executionProfile);
      return standalonePlugins['EB8.1'].compose(data,request);}},
  'EB8.1':{get module(){return loadStandaloneStrategy('EB8.1');},path:standaloneStrategyRepositoryPath('EB8.1'),
    compose(data,request){assertStandaloneExecutionProfile('EB8.1',request.executionProfile);
      const composition=standalonePlugins['EB7.E209'].compose(data,request);
      return {...composition,portfolioConfig:{...composition.portfolioConfig,quantityMode:'signal-integer-v1',terminalMarkOnly:true}};}},
  'EB8':{get module(){return loadStandaloneStrategy('EB8');},path:standaloneStrategyRepositoryPath('EB8'),
    compose(data,request){assertStandaloneExecutionProfile('EB8',request.executionProfile);
      return standalonePlugins['EB7.E209'].compose(data,request);}},
  'EB7.E209':{get module(){return loadStandaloneStrategy('EB7.E209');},path:standaloneStrategyRepositoryPath('EB7.E209'),
    compose(data,request){assertStandaloneExecutionProfile('EB7.E209',request.executionProfile);
      const {resolveE209SourceContract}=require('./e209-source-initialization-v2') as typeof import('./e209-source-initialization-v2');
      const {E209_SOURCE_BOOKS,E209_NATIVE_SOURCE_CONTRACT}=require('./strategies/e209-source-contract-v1') as typeof import('./strategies/e209-source-contract-v1');
      const sourceContract=resolveE209SourceContract(data,request.startDate,request.endDate);
      return {sourceContract,portfolioConfig:resolveSpreadExecutionProfile(sourceContract.config,request.executionProfile??'weighted-reference'),
        sourceConfig:sourceContract.config,nativeSpecs:sourceContract.nativeSpecs,contextSource:E209_NATIVE_SOURCE_CONTRACT.contextSource,
        definitions:E209_SOURCE_BOOKS.map(id=>({id,config:sourceContract.config}))};}},
  'EB.SIMPLE':{get module(){return loadStandaloneStrategy('EB.SIMPLE');},path:standaloneStrategyRepositoryPath('EB.SIMPLE'),
    compose(data,request){
      assertStandaloneExecutionProfile('EB.SIMPLE',request.executionProfile);
      const {EB_SIMPLE_NATIVE_POLICY}=require('./strategies/eb-simple-contract-v1') as typeof import('./strategies/eb-simple-contract-v1');
      const sourceContract=createNativeSourceSpec(data,request.startDate,request.endDate,EB_SIMPLE_NATIVE_POLICY);
      return {sourceContract,portfolioConfig:{...resolveSpreadExecutionConfig(sourceContract.spec.config,request.startDate,
        sourceContract.resolvedEndDate,{}),quantityMode:'signal-integer-v1'},sourceConfig:null,
        nativeSpecs:{observations:sourceContract.spec},definitions:[],single:true};
    }},
  'EB7.E209.PRUNE':{get module(){return loadStandaloneStrategy('EB7.E209.PRUNE');},path:standaloneStrategyRepositoryPath('EB7.E209.PRUNE'),
    compose(data,request){assertStandaloneExecutionProfile('EB7.E209.PRUNE',request.executionProfile);
      return standalonePlugins['EB7.E209'].compose(data,request);}},
  'P6.E385':{get module(){return loadStandaloneStrategy('P6.E385');},path:standaloneStrategyRepositoryPath('P6.E385'),
    compose(data,request){assertStandaloneExecutionProfile('P6.E385',request.executionProfile);
      return composeP6(data,request,true);}},
  'R9.E226':{get module(){return loadStandaloneStrategy('R9.E226');},path:standaloneStrategyRepositoryPath('R9.E226'),
    compose(data,request){assertStandaloneExecutionProfile('R9.E226',request.executionProfile);
      const {R9_E226_SOURCE_CONTRACT}=require('./strategies/r9-e226-source-contract-v1') as typeof import('./strategies/r9-e226-source-contract-v1');
      const declaration=R9_E226_SOURCE_CONTRACT;
      const sourceContract=createNativeSourceSpec(data,request.startDate,request.endDate,declaration.nativePolicy,
        {config:{appendTerminalPcsOpen:declaration.terminalOpenAtClose,includeTerminalMarkOnly:declaration.terminalMarkOnly}});
      const resolved=resolveSpreadExecutionConfig(sourceContract.spec.config,request.startDate,sourceContract.resolvedEndDate,
        {terminalOpenAtClose:declaration.terminalOpenAtClose,terminalMarkOnly:declaration.terminalMarkOnly});
      // Preserve original insertion order in execution evidence; identity is lossless JSON, not rounded metrics.
      const {terminalOpenAtClose,terminalMarkOnly,...base}=resolved;
      const common={...base,quantityMode:declaration.quantityMode,terminalOpenAtClose};
      const portfolioConfig={...common,terminalMarkOnly:declaration.terminalMarkOnly,fillRetry:{...declaration.fillRetry}};
      const sourceConfig={...common,terminalMarkOnly};
      return {sourceContract,portfolioConfig,sourceConfig,nativeSpecs:{[declaration.contextSource]:sourceContract.spec},
        contextSource:declaration.contextSource,definitions:[{id:declaration.contextSource,config:sourceConfig}],observationPolicy:true};}},
  'PCS.EPR':{get module(){return loadStandaloneStrategy('PCS.EPR');},path:standaloneStrategyRepositoryPath('PCS.EPR'),
    compose(data,request){
      assertStandaloneExecutionProfile('PCS.EPR',request.executionProfile);
      const c=composeEpr(data,request,'EB8.3896',true);
      const eLineage=(standalonePlugins['PCS.EPR'].module.params.lineage as readonly string[])[0];
      if(eLineage!=='EB8.9230'&&eLineage!=='EB8.9332'&&eLineage!=='E10467'&&eLineage!=='E10576')return c;
      const {createE9230SnapshotMapper,E9230_PUT_DTES}=require('./e9230-market-contract-v1') as typeof import('./e9230-market-contract-v1');
      const eConfig={...c.definitions.find(b=>b.id==='e209')!.config,putTargetDtes:[...E9230_PUT_DTES]};
      return {...c,portfolioConfig:{...c.portfolioConfig,putTargetDtes:[...new Set([...(c.portfolioConfig.putTargetDtes??[]),...E9230_PUT_DTES])].sort((a,b)=>a-b)},
        definitions:c.definitions.map(b=>b.id==='e209'?{...b,config:eConfig}:b),mapSnapshot:createE9230SnapshotMapper(data,eConfig)};
    }},
  'PCS.EPR.PRUNE':{get module(){return loadStandaloneStrategy('PCS.EPR.PRUNE');},path:standaloneStrategyRepositoryPath('PCS.EPR.PRUNE'),
    compose(data,request){assertStandaloneExecutionProfile('PCS.EPR.PRUNE',request.executionProfile);
      return composeEpr(data,request,'EB7.E209');}},
  'CCS.C3.E856':{get module(){return loadStandaloneStrategy('CCS.C3.E856');},path:standaloneStrategyRepositoryPath('CCS.C3.E856'),
    compose(data,request){
      assertStandaloneExecutionProfile('CCS.C3.E856',request.executionProfile);
      const {CCS_C3_E856_RUNTIME_CONTRACT}=require('./strategies/ccs-c3-e856-contract-v1') as typeof import('./strategies/ccs-c3-e856-contract-v1');
      const declaration=CCS_C3_E856_RUNTIME_CONTRACT;
      const sourceContract=createNativeSourceSpec(data,request.startDate,request.endDate,declaration.nativePolicy);
      const portfolioConfig:QqqSpreadAdapterConfig={
        ...resolveSpreadExecutionConfig(sourceContract.spec.config,request.startDate,sourceContract.resolvedEndDate,
          {terminalOpenAtClose:declaration.terminalOpenAtClose,terminalMarkOnly:declaration.terminalMarkOnly,
            executionVersion:declaration.executionVersion,intrabarStops:declaration.intrabarStops}),
        quantityMode:declaration.quantityMode,
        callCreditSpread:{version:'call-credit-v1',targetDtes:[...declaration.targetDtes]},
      };
      return {sourceContract,portfolioConfig,sourceConfig:null,nativeSpecs:{observations:sourceContract.spec},definitions:[],single:true};
    }}
};

export async function runStandalonePluginWithData(data:MarketDataSet,id:StandaloneId,request:RunWindow,
  options:ResearchRunOptions={}){
  options.signal?.throwIfAborted();
  if(request.terminalExit!==undefined&&request.terminalExit!=='mark-only')throw Error('Unsupported terminal exit policy');
  const plugin=standalonePlugins[id];
  if(!plugin)throw Error('Unknown registered strategy');
  const codeHash=options.codeHash??(await resolveStandaloneIdentity(id)).strategyHash;
  const composition=plugin.compose(data,request),{sourceContract,portfolioConfig,sourceConfig,nativeSpecs}=composition;
  // Shadow books retain strategy feedback; only the requested portfolio's sample-end accounting changes.
  if(request.terminalExit==='mark-only'){
    portfolioConfig.terminalMarkOnly=true;
    if(portfolioConfig.coordinated)for(const policy of Object.values(portfolioConfig.coordinated.policies))policy.terminalMarkOnly=true;
  }
  if(Boolean(composition.single)!==(standaloneStrategyCatalog[id].adapter==='qqq-observed-spread-adapter-v2'))
    throw Error('Standalone composition differs from declared adapter');
  const execution=composition.single
    ?createQqqObservedSpreadAdapter(data,{executionConfig:portfolioConfig,nativeSpec:nativeSpecs.observations!,module:plugin.module,shareMarket:options.shareMarket})
    :createQqqSourceExecutionAdapter(data,portfolioConfig,composition.definitions,nativeSpecs,
      composition.observationPolicy?{module:plugin.module}:undefined,{shareMarket:options.shareMarket,
        ...(composition.fillContractGroups?{fillContractGroups:composition.fillContractGroups}:{})});
  const collector=createResearchResultCollector({mode:'full-host',contextSource:composition.contextSource,
    retainDecisions:options.retainDecisions,onRecord:options.onRecord});
  const replay=await runBarStrategyWithAdapter({module:plugin.module,codeHash,decisionBars:execution.decisionBars,
    createAdapter:()=>composition.mapSnapshot?{...execution.adapter,async advanceTo(asOf){const advanced=await execution.adapter.advanceTo(asOf);return {...advanced,snapshot:composition.mapSnapshot!(advanced.snapshot)};}}:execution.adapter,signal:options.signal,recordMode:'stream',onRecord:collector.onRecord});
  // Host has finished and closed the adapter; seal each complete ledger in place.
  const evidence=execution.evidence('seal'),{events,accounts,decisions,eventsBySource}=collector;
  const portfolio='portfolio' in evidence?evidence.portfolio:evidence;
  assertResearchExecutionCoverage(events,accounts,portfolio,composition.single?undefined:'portfolio');
  const {audit}=acceptSpreadResearchAccount(data,portfolioConfig,
    eventsBySource.get('portfolio')??[],accounts);
  const statistics=spreadTradeStatistics(audit.trades.map(t=>Number(t.pnl)));
  const sourceAudits=Object.fromEntries(composition.definitions.map(definition=>{
    if(!('sources' in evidence))throw Error('Missing execution source books');
    const book=evidence.sources[definition.id]!;
    const sourceEvents=eventsBySource.get(definition.id)??[];
    // Verify every source's feedback coverage too, not only the selected portfolio.
    const observed=collector.sourceAccounts.get(definition.id);
    if(!observed||observed.length!==book.curves.length)throw Error('Missing source-account host observations');
    const terminal=sourceEvents.filter(e=>collector.sourcePostDecisionFeedback.has(e.id));
    const {audit:check}=acceptSpreadResearchAccount(data,definition.config,sourceEvents,book.curves,
      terminal.length?{accounts:observed,terminalEventIds:new Set(terminal.map(e=>e.id))}:undefined);
    if(terminal.length){
      // Last-bar source fills happen AFTER the decision snapshot. Verify the
      // delivered pre-submission account independently, not against a post-fill curve.
      assertResearchExecutionCoverage(sourceEvents,observed.slice(0,-1),
        {...book,curves:book.curves.slice(0,-1)},definition.id);
    }else assertResearchExecutionCoverage(sourceEvents,observed,book,definition.id);
    return [definition.id,{...check,trades:check.trades.length}];
  }));
  const digest=collector.digest();
  const summary={candidateId:replay.candidateId,replayVersion:replay.replayVersion,...statistics,
      pl:audit.pl,mtmMdd:audit.mtmMdd,realizedMdd:audit.realizedMdd,
      ...(composition.single||portfolioConfig.coordinated?{openPositions:audit.openPositions,markedEquity:portfolio.curves.at(-1)?.equity??null}:{}),
      resolvedEndDate:execution.resolvedEndDate,dataFingerprint:data.fingerprint,
      ...(request.executionProfile?{executionProfile:request.executionProfile}:{})};
  const risk=assessStandaloneRisk(events,accounts,portfolioConfig.initialCapital,summary);
  return {summary,risk,
    replay,events,accounts,decisions,decisionCount:collector.decisionCount,execution:evidence,curves:portfolio.curves,trades:audit.trades,
    audit:composition.single?audit:{...audit,trades:audit.trades.length},sourceAudits,portfolioConfig,
    executionConfig:portfolioConfig,sourceConfig,sourceContract,nativeSpecs,
    digests:{...collector.digests(),
      execution:hashResearchValue(evidence),state:hashResearchValue(replay.state),fullHostTrace:digest},
    digest,researchOnly:true as const,productionReady:false as const,retention:'in-memory only'};
}

/** Pin historical PRUNE composition while the active EPR E book adopts3896 sizing. */
function composeEpr(data:MarketDataSet,request:RunWindow,eStrategy:'EB7.E209'|'EB8.3896',zeroCommission=false):Composition{
      // E5444 uses the unchanged3896 sizing/source composition. Costs apply only to active EPR.
      const resolve=(composition:Composition):Composition=>zeroCommission?{...composition,
        portfolioConfig:{...composition.portfolioConfig,commissionPerContract:0},
        sourceConfig:composition.sourceConfig?{...composition.sourceConfig,commissionPerContract:0}:null,
        definitions:composition.definitions.map(book=>({...book,config:{...book.config,commissionPerContract:0}}))}:composition;
      const e=resolve(standalonePlugins[eStrategy].compose(data,request)),p=resolve(composeP6(data,request,zeroCommission)),
        r=resolve(standalonePlugins['R9.E226'].compose(data,request));
      const common=(c:QqqSpreadAdapterConfig)=>JSON.stringify([c.startDate,c.endDate,c.initialCapital,c.commissionPerContract,
        c.pricing,c.realStrikeGrid,c.liquidityModel]);
      if(common(e.portfolioConfig)!==common(p.portfolioConfig)||common(e.portfolioConfig)!==common(r.portfolioConfig))
        throw Error('EPR source pricing/cost/calendar contracts differ');
      const eBooks=['e209',...e.definitions.map(book=>book.id)],rBooks=['r9',...r.definitions.map(book=>book.id)];
      const policy=(c:QqqSpreadAdapterConfig)=>({terminalOpenAtClose:c.terminalOpenAtClose??false,
        terminalMarkOnly:c.terminalMarkOnly??false,...(c.quantityMode?{quantityMode:c.quantityMode}:{}),
        ...(c.fillRetry?{fillRetry:c.fillRetry}:{})});
      const portfolioConfig:QqqSpreadAdapterConfig={...e.portfolioConfig,terminalOpenAtClose:true,terminalMarkOnly:true,
        coordinated:{version:'ordered-fill-v1',policies:{e:policy(e.portfolioConfig),p:policy(p.portfolioConfig),r:policy(r.portfolioConfig)}}};
      const composition={sourceContract:e.sourceContract,portfolioConfig,sourceConfig:null,
        nativeSpecs:{...e.nativeSpecs,p6:p.nativeSpecs.observations!,...r.nativeSpecs},contextSource:e.contextSource,
        definitions:[{id:'e209',config:e.portfolioConfig},...e.definitions,{id:'p6',config:p.portfolioConfig},
          {id:'r9',config:r.portfolioConfig},...r.definitions],observationPolicy:true,
        fillContractGroups:{...Object.fromEntries(eBooks.map(id=>[id,eBooks])),p6:['p6'],
          ...Object.fromEntries(rBooks.map(id=>[id,rBooks])),e:eBooks,p:['p6'],r:rBooks}};
      if(eStrategy==='EB8.3896'){
        const {withR2465ExecutionContract}=require('./strategies/r2465-execution-contract-v1') as typeof import('./strategies/r2465-execution-contract-v1');
        const {withP63922ExecutionContract}=require('./strategies/p6-3922-execution-contract-v1') as typeof import('./strategies/p6-3922-execution-contract-v1');
        return withP63922ExecutionContract(withR2465ExecutionContract(composition));
      }
      return composition;
}

/** Keep historical PRUNE pricing/surface independent of the active public P child. */
function composeP6(data:MarketDataSet,request:RunWindow,current:boolean):Composition{
      const {resolveP6E385SourceContract}=require('./p6-source-initialization-v2') as typeof import('./p6-source-initialization-v2');
      const {P6_E385_RUNTIME_CONTRACT}=require('./strategies/p6-e385-parameters-v2') as typeof import('./strategies/p6-e385-parameters-v2');
      const sourceContract=resolveP6E385SourceContract(data,request.startDate,request.endDate);
      const composition:Composition={sourceContract,portfolioConfig:{...resolveSpreadExecutionConfig(sourceContract.nativeSpec.config,request.startDate,sourceContract.resolvedEndDate,
        {terminalOpenAtClose:P6_E385_RUNTIME_CONTRACT.terminalFill==='sample-close',terminalMarkOnly:P6_E385_RUNTIME_CONTRACT.terminalExit==='mark-only'}),quantityMode:'signal-integer-v1'},
        sourceConfig:null,nativeSpecs:{observations:sourceContract.nativeSpec},definitions:[],single:true};
      if(!current){
        // The retained PRUNE P child emits unqualified one-group intents.
        // Do not inherit the public P integer-quantity requirement.
        const {quantityMode:_publicQuantityMode,...portfolioConfig}=composition.portfolioConfig;
        return {...composition,portfolioConfig};
      }
      const {p63922ExecutionConfig}=require('./strategies/p6-3922-execution-contract-v1') as typeof import('./strategies/p6-3922-execution-contract-v1');
      return {...composition,portfolioConfig:p63922ExecutionConfig(composition.portfolioConfig)};
}
