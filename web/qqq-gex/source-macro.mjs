// Preserve the pinned macro pipeline; replace only its I/O boundary with retained provider inputs.
import {readFile} from 'node:fs/promises';import path from 'node:path';
export async function sourceMacroModule(root){
 const file=path.join(root,'upstream/src/services/orchestrators/macroDataService.ts');let text=await readFile(file,'utf8');
 const start=text.indexOf('    const baseSymbols ='),end=text.indexOf("    _dbg('STAGE', 'RAW_DATA_INGESTION');",start);
 const historyStart=text.indexOf('    let parsedSPXHistory ='),historyEnd=text.indexOf('    const { factors: enrichedFactors }',historyStart);
 if([start,end,historyStart,historyEnd].some(x=>x<0))throw Error('Pinned macro ingress changed');
 text=text.slice(0,historyStart)+`    const parsedSPXHistory={closes:local.spx.map((b:any)=>b.close),items:local.spx};\n    const parsedVIXHistory={closes:local.vix.map((b:any)=>b.close),items:local.vix};\n`+text.slice(historyEnd);
 text=text.slice(0,start)+`    const local=JSON.parse(specificSymbol!);specificSymbol=undefined;const quoteResults=local.quotes;const isServer=true;\n`+text.slice(end);
 text=text.replace("import { indicatorEngine, decisionEngine, UnifiedRegime, unifiedRegimeEngine, hmmRegimeEngine } from '../../lib/engines';","import {indicatorEngine} from '../../lib/engines/indicators/IndicatorEngine';import {decisionEngine} from '../../lib/engines/core/DecisionEngine';import {unifiedRegimeEngine} from '../../lib/engines/regime/UnifiedRegimeEngine';import {hmmRegimeEngine} from '../../lib/engines/regime/HMMRegimeEngine';");
 text=text.replace(/import \{ apiManager \}.*?;\n/,'').replace(/import \{ fetchHistoricalDataCore.*?;\n/,'').replace("const { fetchATMIVCurve } = await import('../adapters/yahooFinance');","const fetchATMIVCurve=()=>{throw Error('Remote options IV is disabled for retained local macro inputs');};");
 return {contents:text,resolveDir:path.dirname(file)};
}
