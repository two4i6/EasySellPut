/** Bootstrap data only: no executable strategy dispatcher or policy imports. */
import {SPREAD_EXECUTION_PROFILES,type SpreadExecutionProfile} from './spread-execution-profile-names-v4';
const e209Composition=['./e209-source-initialization-v2','./strategies/e209-source-contract-v1'] as const;
const simpleComposition=['./strategies/eb-simple-contract-v1'] as const;
const p6Composition=['./p6-source-initialization-v2','./strategies/p6-e385-parameters-v2'] as const;
const r9Composition=['./strategies/r9-e226-source-contract-v1'] as const;
const ccsComposition=['./strategies/ccs-c3-e856-contract-v1'] as const;
export const standaloneStrategyCatalog={
  'EB8.412':{path:'./strategies/eb8-412-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8.3896':{path:'./strategies/eb8-3896-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8.1298':{path:'./strategies/eb8-1298-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8.940':{path:'./strategies/eb8-940-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8.411':{path:'./strategies/eb8-411-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8.1':{path:'./strategies/eb8-1-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:e209Composition},
  'EB8':{path:'./strategies/eb8-standalone-v1',adapter:'qqq-source-adapter-v2',executionProfiles:SPREAD_EXECUTION_PROFILES,composition:e209Composition},
  'EB7.E209':{path:'./strategies/eb7-e209-causal-v6',adapter:'qqq-source-adapter-v2',executionProfiles:SPREAD_EXECUTION_PROFILES,composition:e209Composition},
  'EB.SIMPLE':{path:'./strategies/eb-simple-standalone-v1',adapter:'qqq-observed-spread-adapter-v2',executionProfiles:[],composition:simpleComposition},
  'EB7.E209.PRUNE':{path:'./strategies/eb7-e209-pruned-v1',adapter:'qqq-source-adapter-v2',executionProfiles:SPREAD_EXECUTION_PROFILES,composition:e209Composition},
  'P6.E385':{path:'./strategies/p6-3922-standalone-v1',adapter:'qqq-observed-spread-adapter-v2',executionProfiles:[],composition:[...p6Composition,'./strategies/p6-3922-execution-contract-v1']},
  'R9.E226':{path:'./strategies/r9-e226-standalone-v4',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:r9Composition},
  'PCS.EPR':{path:'./strategies/pcs-epr-standalone-v23',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:['./e9230-market-contract-v1',...e209Composition,...p6Composition,...r9Composition,'./strategies/r2465-execution-contract-v1','./strategies/p6-3922-execution-contract-v1']},
  'PCS.EPR.PRUNE':{path:'./strategies/pcs-epr-pruned-v1',adapter:'qqq-source-adapter-v2',executionProfiles:[],composition:[...e209Composition,...p6Composition,...r9Composition]},
  'CCS.C3.E856':{path:'./strategies/ccs-c3-e856-standalone-v1',adapter:'qqq-observed-spread-adapter-v2',executionProfiles:[],composition:ccsComposition},
} as const;
export type StandaloneId=keyof typeof standaloneStrategyCatalog;
export const DEFAULT_STANDALONE_STRATEGY='EB8.1298' satisfies StandaloneId;
export const standaloneStrategyPaths=Object.fromEntries(Object.entries(standaloneStrategyCatalog).map(([id,c])=>[id,c.path])) as
  {[K in StandaloneId]:typeof standaloneStrategyCatalog[K]['path']};
export function assertStandaloneExecutionProfile(id:StandaloneId,profile:SpreadExecutionProfile|undefined){
  if(profile!==undefined&&!(standaloneStrategyCatalog[id].executionProfiles as readonly string[]).includes(profile))
    throw Error('Unsupported strategy execution profile');
}
/** Preserve declaration order; bootstrap and execution share a single version map. */
export const STANDALONE_IDS=Object.keys(standaloneStrategyPaths) as readonly StandaloneId[];
export function standaloneStrategyRepositoryPath(id:StandaloneId){
  return `src/lib/backtest-scripts${standaloneStrategyPaths[id].slice(1)}.ts`;
}
