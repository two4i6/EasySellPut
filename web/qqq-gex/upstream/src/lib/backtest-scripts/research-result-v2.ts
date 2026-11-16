/** Common in-memory recording and independent financial acceptance. No strategy rules/writers. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type {StrategyHostRecord} from './strategy-host-v2';
import type {StrategyFeedback,StrategyObject} from './strategy-module-v2';
import {isImmutableStrategyData} from './strategy-module-v2';
import {auditSpreadAccount,auditSpreadAccountWithTerminalPhase,type PreTerminalAccountPhase} from './spread-account-audit-v4';
import {unwrapSourceFeedback} from './source-book-feedback-v1';
export function createResearchResultCollector(input:{contextSource?:string;
  mode:'full-host'|'decisions';retainDecisions?:boolean;onRecord?:(record:Readonly<StrategyHostRecord>)=>Promise<void>|void}){
  const events:StrategyFeedback[]=[],accounts:StrategyObject[]=[],decisions:StrategyObject[]=[];
  const trace=createHash('sha256');
  const sourceAccounts=new Map<string,StrategyObject[]>(),sourcePostDecisionFeedback=new Set<string>();
  const eventsBySource=new Map<string,StrategyFeedback[]>();
  const decisionHash=createLosslessArrayDigest(),eventHash=createLosslessArrayDigest(),accountHash=createLosslessArrayDigest();
  let decisionCount=0;
  return {events,accounts,decisions,eventsBySource,sourceAccounts,sourcePostDecisionFeedback,
    async onRecord(record:Readonly<StrategyHostRecord>){
      if(input.mode==='full-host'){
        const {stringify,write}=createRecordEncoder();
        write(record,trace);
        const books=record.snapshot.market.sourceAccounts as Record<string,StrategyObject>|undefined;
        for(const [id,book] of Object.entries(books??{})){
          const list=sourceAccounts.get(id)??[];
          list.push({asOf:record.asOf,...book.account as StrategyObject});sourceAccounts.set(id,list);
        }
        for(const event of record.executionAfterSubmission?.feedback??[])sourcePostDecisionFeedback.add(event.id);
        const native=input.contextSource ? (books?.[input.contextSource]?.market as StrategyObject|undefined)?.nativeState as StrategyObject|undefined
          : record.snapshot.market.nativeState as StrategyObject|undefined;
        const decision={asOf:record.asOf,context:native?.marketContext??{},plots:record.plots,intents:record.intents,state:record.state,
          ...(record.submittedIntents ? {submittedIntents:record.submittedIntents} : {})};
        decisionHash.add(decision,stringify);decisionCount++;
        if(input.retainDecisions!==false)decisions.push(decision);
        for(const event of [...record.feedback,...(record.executionAfterSubmission?.feedback??[])]){
          events.push(event);eventHash.add(event);
          const source=String(event.payload.sourceAccount??'portfolio');
          const list=eventsBySource.get(source)??[];list.push(event);eventsBySource.set(source,list);
        }
        const account={asOf:record.asOf,...(record.executionAfterSubmission?.account??record.snapshot.account)};
        accounts.push(account);accountHash.add(account);
      }else trace.update(JSON.stringify({asOf:record.asOf,intents:record.intents,feedback:record.feedback,plots:record.plots}));
      await input.onRecord?.(record);
    },
    digest:()=>trace.copy().digest('hex'),
    digests:()=>({decisions:decisionHash.digest(),events:eventHash.digest(),accounts:accountHash.digest()}),
    get decisionCount(){return decisionCount;},
  };
}
/** Same JSON bytes; reuse repeated immutable branches only within this record. */
function createRecordEncoder(){
  const encoded=new WeakMap<object,string>();
  const encode=(value:unknown,depth:number):string|undefined=>{
    const immutable=isImmutableStrategyData(value);
    if(immutable){const cached=encoded.get(value);if(cached!==undefined)return cached;}
    let json:string|undefined;
    // Walk the shallow host/book structure; native JSON handles dense quote/history leaves.
    if(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(depth===0||immutable)&&depth<8){
      const fields:string[]=[];
      for(const key of Object.keys(value)){
        const child=encode((value as Record<string,unknown>)[key],depth+1);
        if(child!==undefined)fields.push(JSON.stringify(key)+':'+child);
      }
      json='{'+fields.join(',')+'}';
    }else json=JSON.stringify(value);
    if(immutable&&json!==undefined)encoded.set(value,json);
    return json;
  };
  return {stringify:(value:unknown)=>encode(value,0),write(value:unknown,hash:ReturnType<typeof createHash>){
    let parts:string[]=[],size=0;
    const flush=()=>{if(size){hash.update(parts.join(''));parts=[];size=0;}};
    const emit=(json:string)=>{
      if(size+json.length>65536)flush();
      if(json.length>=65536)hash.update(json);else{parts.push(json);size+=json.length;}
    };
    const visit=(item:unknown,depth:number)=>{
      const immutable=isImmutableStrategyData(item),cached=immutable?encoded.get(item):undefined;
      if(cached!==undefined){emit(cached);return;}
      if(item!==null&&typeof item==='object'&&!Array.isArray(item)&&(depth===0||immutable)&&depth<8){
        emit('{');let first=true;
        for(const key of Object.keys(item)){
          const child=(item as Record<string,unknown>)[key];
          if(child===undefined||typeof child==='function'||typeof child==='symbol')continue;
          if(!first)emit(',');first=false;emit(JSON.stringify(key)+':');
          // State/plots also feed the decision digest; encode them once per record.
          if(depth===0&&(key==='state'||key==='plots'))emit(encode(child,depth+1)!);
          else visit(child,depth+1);
        }
        emit('}');
      }else{const json=encode(item,depth);if(json!==undefined)emit(json);}
    };
    visit(value,0);flush();
  }};
}
/** Byte-identical to SHA256(JSON.stringify(array)), with no rounding or retained payload. */
export function createLosslessArrayDigest(){
  const hash=createHash('sha256');hash.update('[');let count=0;
  return {add(value:unknown,stringify:(value:unknown)=>string|undefined=JSON.stringify){const json=stringify(value);if(json===undefined)throw Error('Non-JSON digest element');
    if(count++)hash.update(',');hash.update(json);},digest:()=>hash.copy().update(']').digest('hex')};
}
export function acceptSpreadResearchAccount(data:MarketDataSet,
  config:Parameters<typeof auditSpreadAccount>[1],events:StrategyFeedback[],curves:StrategyObject[],phase?:PreTerminalAccountPhase){
  const result=phase?auditSpreadAccountWithTerminalPhase(data,config,events,curves,phase):undefined;
  const audit=result?.audit??auditSpreadAccount(data,config,events,curves);
  if(result&&result.preTerminalAudit.status!=='ACCOUNT_MTM_PASS')throw Error('Independent pre-terminal account/MTM audit failed');
  if(audit.status!=='ACCOUNT_MTM_PASS') throw new Error('Independent account/MTM audit failed');
  return {audit};
}
export const hashResearchValue=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Reconcile the host stream with the execution owner's complete book, including last-bar fills. */
export function assertResearchExecutionCoverage(events:readonly StrategyFeedback[],accounts:readonly StrategyObject[],
  book:{events:readonly StrategyFeedback[];curves:readonly StrategyObject[]},sourceAccount?:string){
  const owned=events.filter(e=>sourceAccount===undefined||e.payload.sourceAccount===sourceAccount).map(e=>{
    if(sourceAccount===undefined)return e;
    return unwrapSourceFeedback(e,sourceAccount);
  });
  if(!isDeepStrictEqual(owned,book.events)||!isDeepStrictEqual(accounts,book.curves))
    throw new Error('Host/execution coverage mismatch: missing feedback or final account');
}
