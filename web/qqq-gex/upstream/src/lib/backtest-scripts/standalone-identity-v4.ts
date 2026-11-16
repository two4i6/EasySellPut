/** Cold-worker identity: no strategy/host execution import before source verification. */
import {standaloneStrategyPaths,standaloneStrategyRepositoryPath,standaloneStrategyCatalog} from './standalone-strategy-catalog-v4';
import {resolveStrategyIdentity} from './strategy-identity-v3';
export function resolveStandaloneIdentity(id:keyof typeof standaloneStrategyPaths,entryRoots:readonly string[]=[]){
  const path=standaloneStrategyRepositoryPath(id);
  return resolveStrategyIdentity(process.cwd(),path,
    [path,'src/lib/backtest-scripts/standalone-registry-v2.ts','scripts/research/run-standalone-worker-v2.ts',...entryRoots],
    [{loaderPath:'src/lib/backtest-scripts/standalone-strategy-loader-v4.ts',selected:standaloneStrategyPaths[id],
      alternatives:Object.values(standaloneStrategyPaths)},
    {loaderPath:'src/lib/backtest-scripts/standalone-research-v3.ts',selected:standaloneStrategyCatalog[id].composition,
      alternatives:[...new Set(Object.values(standaloneStrategyCatalog).flatMap(c=>[...c.composition]))]}]);
}
