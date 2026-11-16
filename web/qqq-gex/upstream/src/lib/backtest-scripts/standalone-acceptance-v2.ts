/** Browser-safe acceptance surface; no strategy rules, pricing, file or server imports. */
import type {StandaloneResearchResponse} from './standalone-protocol-v2';
import {STANDALONE_OUTPUT_VERSION,STANDALONE_OUTPUT_MAX_BYTES} from './standalone-protocol-v2';
const keys=['accounts','decisions','events','execution','fullHostTrace','state'];
export function standaloneAcceptanceView(value:unknown){
  const r=value as StandaloneResearchResponse;
  if(!r||!r.summary||!r.request||!r.params||Array.isArray(r.params)||!r.performance
    ||r.audit?.status!=='ACCOUNT_MTM_PASS'||r.audit.trades!==r.summary.trades
    ||r.summary.candidateId!==r.request.strategyId||r.researchOnly!==true||r.productionReady!==false
    ||r.retention!=='strategy-source-only'||r.artifact!==null||r.traceArtifact!==null
    ||!r.digests||JSON.stringify(Object.keys(r.digests).sort())!==JSON.stringify(keys)
    ||[r.closureHash,r.strategyHash,r.dataChecksum,...Object.values(r.digests)].some(h=>!/^[a-f0-9]{64}$/.test(h))
    ||typeof r.modelVersion!=='string'||!r.modelVersion
    ||!Number.isSafeInteger(r.performance.hostBars)||r.performance.hostBars<1
    ||['trades','wins','losses','pl','mtmMdd','realizedMdd']
      .some(k=>!Number.isFinite((r.summary as unknown as Record<string,number>)[k])))throw new Error('Incomplete/failed standalone acceptance response');
  if(r.outputVersion!==STANDALONE_OUTPUT_VERSION||new TextEncoder().encode(JSON.stringify(r)).byteLength>STANDALONE_OUTPUT_MAX_BYTES
    ||!r.contract?.execution||!r.accounting?.final||!r.accounting.sourceAudits||!r.coverage||!r.outcomes||!r.conventions
    ||['winRatePct','cvar5','worst'].some(k=>r.summary.trades===0
      ?(r.summary as unknown as Record<string,unknown>)[k]!==null:!Number.isFinite((r.summary as unknown as Record<string,number>)[k]))
    ||r.summary.wins+r.summary.losses!==r.summary.trades||!Number.isFinite(r.audit.maxError)||r.audit.maxError>=1e-7
    ||r.provenance?.sdkVersion!==2||!r.provenance.runtime
    ||r.coverage.hostRecords!==r.performance.hostBars
    ||Object.values(r.accounting.sourceAudits).some(a=>a.status!=='ACCOUNT_MTM_PASS'||!Number.isFinite(a.maxError)||a.maxError>=1e-7)
    ||Object.values(r.outcomes).reduce((n,c)=>n+c.trades,0)!==r.summary.trades)
    throw new Error('Incomplete/failed standalone compact output');
  const final=r.accounting.final;
  const near=(a:unknown,b:unknown)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
  if(!near(final.realized,r.summary.pl)||!near(final.mtmMdd,r.summary.mtmMdd)||!near(final.realizedMdd,r.summary.realizedMdd)
    ||!near(final.equity,Number(r.contract.execution.initialCapital)+Number(final.realized)+Number(final.unrealized))
    ||!near(final.availableCash,Number(final.cash)-Number(final.margin))
    ||final.asOf!==r.summary.resolvedEndDate||r.coverage.lastObservation!==final.asOf
    ||!near(Object.values(r.outcomes).reduce((sum,group)=>sum+group.pl,0),r.summary.pl))
    throw new Error('Standalone final account reconciliation failed');
  return {request:r.request,summary:r.summary,digests:r.digests,audit:r.audit,params:r.params,
    closureHash:r.closureHash,strategyHash:r.strategyHash,dataChecksum:r.dataChecksum,modelVersion:r.modelVersion,
    hostBars:r.performance.hostBars,retention:r.retention,artifact:r.artifact,traceArtifact:r.traceArtifact,
    researchOnly:r.researchOnly,productionReady:r.productionReady,outputVersion:r.outputVersion,contract:r.contract,
    accounting:r.accounting,outcomes:r.outcomes,coverage:r.coverage,conventions:r.conventions,provenance:r.provenance,...(r.risk?{risk:r.risk}:{})};
}
