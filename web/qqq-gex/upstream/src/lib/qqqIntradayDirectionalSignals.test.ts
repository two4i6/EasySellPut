import { expect, test } from 'bun:test';
import { supabaseAdmin } from './supabase';
import { appendQqqIntradayDirectionalSignal } from './qqqIntradayDirectionalSignals';
import type { QqqIntradayDirectionalDecision } from './engines/analysis/QqqIntradayDirectional';

test('page writer does not mistake ignore-duplicate success for the requested alert being stored',async()=>{
  const original=supabaseAdmin.from;
  let stored='other',inserted:unknown[]=[];
  const decision={signalId:'requested',structureId:'structure',alertType:'OPPORTUNITY',anchorBar:'2026-10-09T14:08:00Z',status:'ALERT_LONG',reasonCodes:[]} as unknown as QqqIntradayDirectionalDecision;
  supabaseAdmin.from=(()=>{
    let writing=false;const chain:any={};
    chain.upsert=()=>{writing=true;return chain;};
    for(const method of ['select','eq','limit'])chain[method]=()=>chain;
    chain.abortSignal=async()=>({error:null,data:writing?inserted:[{output:{signalId:stored}}]});
    return chain;
  }) as typeof original;
  try {
    expect(await appendQqqIntradayDirectionalSignal({decision,factors:{}})).toBeFalse();
    stored='requested';
    expect(await appendQqqIntradayDirectionalSignal({decision,factors:{}})).toBeTrue();
    inserted=[{output:{signalId:'requested'}}];stored='other';
    expect(await appendQqqIntradayDirectionalSignal({decision,factors:{}})).toBeTrue();
  } finally {supabaseAdmin.from=original;}
});
