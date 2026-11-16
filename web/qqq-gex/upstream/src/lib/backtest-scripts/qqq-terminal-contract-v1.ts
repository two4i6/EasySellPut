/** Browser-safe fixed QQQ contract. Only the data sample is configurable. */
import type {StrategyFeedback, StrategyIntent, StrategyObject} from './strategy-module-v2';
import type {StandaloneResearchResponse} from './standalone-protocol-v2';
import {STANDALONE_RESEARCH_FIXTURES} from './research-request-v3';
import {standaloneAcceptanceView} from './standalone-acceptance-v2';
import {verifyStandaloneAcceptanceEnvelope} from './standalone-acceptance-envelope-v1';

export const QQQ_TERMINAL_STRATEGIES = {pcs:'PCS.EPR', cs:'CCS.C3.E856'} as const;
export type QqqTerminalRequest = {sampleCount:number; asOfDate?:string; fixture?:typeof STANDALONE_RESEARCH_FIXTURES[number]};
export function parseQqqTerminalRequest(value:unknown):QqqTerminalRequest {
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Expected a data-sample object');
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!['sampleCount','asOfDate','fixture'].includes(key)))
    throw Error('Only sampleCount, asOfDate and fixture are supported; strategies are fixed SDK v2 artifacts');
  const sampleCount=input.sampleCount===undefined?252:input.sampleCount;
  if(typeof sampleCount!=='number'||!Number.isSafeInteger(sampleCount)||sampleCount<1||sampleCount>10000)
    throw Error('sampleCount must be an integer from 1 to 10000');
  if(input.asOfDate!==undefined && (typeof input.asOfDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)
    ||!Number.isFinite(Date.parse(input.asOfDate))||new Date(input.asOfDate).toISOString().slice(0,10)!==input.asOfDate))throw Error('Invalid asOfDate');
  if(input.fixture!==undefined && !STANDALONE_RESEARCH_FIXTURES.includes(input.fixture as QqqTerminalRequest['fixture'] & string))throw Error('Unknown complete market fixture');
  return {sampleCount,...(input.asOfDate!==undefined?{asOfDate:input.asOfDate as string}:{}),
    ...(input.fixture!==undefined?{fixture:input.fixture as NonNullable<QqqTerminalRequest['fixture']>}: {})};
}
export type QqqTerminalDay = {
  asOf:string; plots:StrategyObject; intents:StrategyIntent[];
  submittedIntents?:StrategyIntent[];
  account:StrategyObject; positions:StrategyObject[];
};
export type QqqTerminalStrategy = {
  acceptance:StandaloneResearchResponse; days:QqqTerminalDay[]; events:StrategyFeedback[];
};
export type QqqTerminalResponse = {
  sdkVersion:2; researchOnly:true; productionReady:false; retention:'strategy-source-only';
  request:QqqTerminalRequest; window:{startDate:string;endDate:string};
  prices:Array<{date:string;value:number}>;
  data:{checksum:string;fingerprint:string;source:string|null;completedThrough:string;warnings:string[]};
  pcs:QqqTerminalStrategy; cs:QqqTerminalStrategy; acceptanceDigest:string;
};
export type QqqTerminalView=Omit<QqqTerminalResponse,'pcs'|'cs'|'acceptanceDigest'> & Partial<Pick<QqqTerminalResponse,'pcs'|'cs'>>;
export type QqqTerminalSegment=Omit<QqqTerminalResponse,'pcs'|'cs'> & {side:'pcs'|'cs';result:QqqTerminalStrategy};
export const QQQ_TERMINAL_STREAM='application/x-ndjson';

export function qqqTerminalSegmentView(value:unknown):asserts value is QqqTerminalSegment{
  const segment=value as QqqTerminalSegment;
  if(segment?.side!=='pcs'&&segment?.side!=='cs')throw Error('Invalid QQQ segment side');
  validateQqqTerminal({...segment,[segment.side]:segment.result},[segment.side]);
}
/** Shared process/browser trust boundary; partial sides must bind one sample and snapshot. */
export async function acceptQqqTerminalSegment(value:unknown,previous:Partial<QqqTerminalResponse>|undefined,
  request:QqqTerminalRequest):Promise<QqqTerminalView>{
  qqqTerminalSegmentView(value);await verifyStandaloneAcceptanceEnvelope(value);
  const {side,result,acceptanceDigest:_digest,...metadata}=value;
  if(JSON.stringify(metadata.request)!==JSON.stringify(request)||previous?.[side])throw Error('Invalid QQQ segment identity/order');
  if(previous){const {pcs:_pcs,cs:_cs,...before}=previous;
    if(JSON.stringify(before)!==JSON.stringify(metadata))throw Error('QQQ segments use different market snapshots');}
  return {...metadata,...previous,[side]:result};
}

export function qqqTerminalAcceptanceView(value:unknown):asserts value is QqqTerminalResponse {
  validateQqqTerminal(value,['pcs','cs']);
}
function validateQqqTerminal(value:unknown,sides:readonly ('pcs'|'cs')[]){
  const result=value as QqqTerminalResponse;
  if(!result||result.sdkVersion!==2||result.researchOnly!==true||result.productionReady!==false
    ||result.retention!=='strategy-source-only'||!result.window||!result.data||!/^[a-f0-9]{64}$/.test(result.data.checksum))throw Error('Invalid QQQ response identity');
  parseQqqTerminalRequest(result.request);
  for(const side of sides){
    const output=result[side];standaloneAcceptanceView(output?.acceptance);
    if(!Array.isArray(output.days)||!Array.isArray(result.prices)||result.prices.length!==output.days.length
      ||result.prices.some((point,i)=>point.date!==output.days[i]?.asOf||!Number.isFinite(point.value)||point.value<=0))
      throw Error('QQQ price/window mismatch');
    const accepted=output.acceptance;
    if(accepted.request.strategyId!==QQQ_TERMINAL_STRATEGIES[side]||accepted.dataChecksum!==result.data.checksum
      ||accepted.summary.dataFingerprint!==result.data.fingerprint||accepted.request.startDate!==result.window.startDate
      ||accepted.request.endDate!==result.window.endDate||!Array.isArray(output.days)||!Array.isArray(output.events)
      ||output.days.length!==accepted.coverage.decisions||output.days[0]?.asOf!==result.window.startDate
      ||output.days.at(-1)?.asOf!==result.window.endDate||output.days.some((day,i)=>i>0&&day.asOf<=output.days[i-1]!.asOf))
      throw Error('QQQ strategy/window/coverage mismatch');
    const final=output.days.at(-1)!;
    if(Object.entries(accepted.accounting.final).some(([key,value])=>key!=='asOf'&&final.account[key]!==value)
      ||final.positions.length!==accepted.accounting.openPositions)throw Error('QQQ final account mismatch');
  }
}
