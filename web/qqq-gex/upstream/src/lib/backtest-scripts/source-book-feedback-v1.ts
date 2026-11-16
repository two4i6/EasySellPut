/** Book-local feedback namespace and global position ownership. No admission/accounting. */
import type {StrategyFeedback} from './strategy-module-v2';

/** Coverage must verify the namespace, not silently strip an arbitrary prefix. */
export function unwrapSourceFeedback(event:StrategyFeedback,source:string):StrategyFeedback {
  const prefix=`${source}:`;
  if(event.payload.sourceAccount!==source||!event.id.startsWith(prefix)||event.id.length===prefix.length)
    throw Error('Invalid source feedback namespace');
  const {sourceAccount:_source,...payload}=event.payload;
  return {...event,id:event.id.slice(prefix.length),payload};
}

export function createSourceBookFeedback(sourceIds:readonly string[]) {
  const sources=new Set(sourceIds),positions=new Map<string,string>();
  return {
    ownerOf:(positionId:string)=>positions.get(positionId),
    ingest(source:string,events:readonly StrategyFeedback[]):StrategyFeedback[] {
      if(!sources.has(source))throw Error('Unknown source account/position owner');
      return events.map(event=>{
        if(event.kind==='fill'){
          const positionId=String(event.payload.positionId);
          if(positions.has(positionId))throw Error('Source position identity collision');
          positions.set(positionId,source);
        }
        return {...event,id:`${source}:${event.id}`,payload:{...event.payload,sourceAccount:source}};
      });
    },
  };
}
