/** Small common response. Complete comparisons stay in worker memory, not client/disk traces. */
import type { StandaloneRequest, runStandaloneResearchWithData } from './standalone-registry-v2';
import type {StrategyObject} from './strategy-module-v2';
export const STANDALONE_MAX_CONCURRENT=2;
/** Parent enforces child exit; worker aborts earlier to allow cooperative cleanup. */
export const STANDALONE_PROCESS_TIMEOUT_MS=300_000;
export const STANDALONE_WORKER_TIMEOUT_MS=290_000;
/** Distributed capacity reservation outlives the process deadline, including exit handling. */
export const STANDALONE_JOB_LEASE_MS=900_000;
export const STANDALONE_REQUEST_MAX_BYTES=4096;
export function validStandaloneJobToken(id:string){return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);}
export const STANDALONE_OUTPUT_VERSION='standalone-summary-v1' as const;
export const STANDALONE_OUTPUT_MAX_BYTES=16*1024;
export type StandaloneExecutionRequest=Omit<StandaloneRequest,'fixture'>&{fixture?:StandaloneRequest['fixture']};
export type StandaloneResearchResponse = {
  /** New workers bind finalized financial/risk/contract output, separately from six raw evidence digests. */
  acceptanceDigest?:string;
  runId:string; request:StandaloneExecutionRequest;
  summary:Awaited<ReturnType<typeof runStandaloneResearchWithData>>['summary'];
  digests:Record<'decisions'|'events'|'accounts'|'execution'|'state'|'fullHostTrace',string>; audit:{status:string;trades:number;maxError:number;maximumErrorField:string};
  params:StrategyObject;
  closureHash:string; strategyHash:string; dataChecksum:string; modelVersion:string;
  retention:'strategy-source-only'; artifact:null; traceArtifact:null;
  researchOnly:true; productionReady:false;
  performance:{elapsedMs:number;peakRssBytes:number;hostBars:number};
  outputVersion:'standalone-summary-v1';
  risk?:ReturnType<typeof import('./standalone-risk-v1').assessStandaloneRisk>;
  contract:{interval:'1d';availability:'as-of-full-fixture'|'as-of-complete-market-snapshot';execution:StrategyObject;sourceExecution:StrategyObject|null;sourceWindows:Record<string,{startDate:string;endDate:string}>};
  accounting:{openPositions:number;final:StrategyObject;capacity:StrategyObject;sourceAudits:Record<string,{status:string;trades:number;openPositions:number;maxError:number}>};
  outcomes:Record<'expirySettlements'|'earlyCloses'|'terminalLiquidations',{
    trades:number;wins:number;losses:number;winRatePct:number|null;worst:number|null;cvar5:number|null;pl:number}>;
  coverage:{events:number;decisions:number;accounts:number;hostRecords:number;firstObservation:string|null;lastObservation:string|null};
  provenance:{sdkVersion:2;runtime:{node:string;bun:string|null};dependencyContract:string;snapshot:{source:string|null;createdAt:string|null}};
  conventions:{trades:'closed-including-terminal-liquidation';win:'pnl>0';cvar5:'worst-ceil-5pct-closed-trades';mtm:'all-open-exposure-daily-close'};
};
