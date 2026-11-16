/** Small shared CLI/HTTP/frontend result protocol. Full evidence lives in verified compressed blobs. */
import type { E209ResearchRequest } from './e209-research-run-v2';
import type { runE209ResearchWithData } from './e209-research-run-v2';
export const E209_WORKER_VERSION = 'e209-causal-worker-v1';
export {STANDALONE_MAX_CONCURRENT as E209_MAX_CONCURRENT,STANDALONE_PROCESS_TIMEOUT_MS as E209_TIMEOUT_MS} from './standalone-protocol-v2';
export type E209ResearchResponse = {
  runId: string; request: E209ResearchRequest; summary: Awaited<ReturnType<typeof runE209ResearchWithData>>['summary'];
  digests: Awaited<ReturnType<typeof runE209ResearchWithData>>['digests'];
  artifact: string; traceArtifact: string; payloadSha256: string; closureHash: string;
  researchOnly: true; productionReady: false;
  performance: { elapsedMs: number; peakRssBytes: number; hostBars: number };
};
