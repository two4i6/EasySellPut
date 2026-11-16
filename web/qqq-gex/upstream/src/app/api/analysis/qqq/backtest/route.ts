import {standaloneHttpLifecycle} from '@/lib/backtest-scripts/standalone-http-v1';
import {parseQqqTerminalRequest,QQQ_TERMINAL_STRATEGIES} from '@/lib/backtest-scripts/qqq-terminal-contract-v1';
import {runQqqTerminalProcess} from '@/lib/backtest-scripts/e209-process-v2';
import {authorizeQqqTerminal} from '@/lib/backtest-scripts/standalone-auth-v1';

export const runtime='nodejs';
export const maxDuration=300;
export const {GET,POST,DELETE}=standaloneHttpLifecycle({
  authorize:authorizeQqqTerminal,
  describe:()=>({sdkVersion:2,strategies:QQQ_TERMINAL_STRATEGIES,defaults:parseQqqTerminalRequest({}),
    researchOnly:true,productionReady:false,retention:'strategy-source-only'}),
  parse:parseQqqTerminalRequest,
  stream:true,
  async run(input,signal,request,onSegment){
    const result=await runQqqTerminalProcess(input,signal,{refresh:request.headers.get('Cache-Control')==='no-cache',onSegment});
    return onSegment?{acceptanceDigest:result.acceptanceDigest}:result;
  },
});
