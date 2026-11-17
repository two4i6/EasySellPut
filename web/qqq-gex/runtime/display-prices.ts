import {qqqEasternDateKey} from '../upstream/src/lib/qqqMarketDate';
/** Independent stock observations; model bars and every original financial kernel remain unchanged. */
export function retainDisplayPrices(input:any,date:string,previous:any){
 if(input.displayPrices===undefined)return previous??null;
 const value=input.displayPrices;
 if(value?.schemaVersion!=='qqq-display-prices-v1'||!Array.isArray(value.bars)||value.bars.length>10000)throw Error('Invalid bounded display price input');
 if(!value.provenance)return previous??null;
 const cutoff=Date.parse(value.provenance.requestedUntil),observed=Date.parse(value.provenance.observedAt);
 if(!Number.isFinite(cutoff)||!Number.isFinite(observed)||cutoff>observed)throw Error('Invalid display observation clocks');
 const bars=value.bars.filter((b:any)=>{
  const time=Date.parse(b.timestamp);if(!Number.isFinite(time)||time%120000||time+120000>cutoff||![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.open<=0||b.close<=0||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0)throw Error('Invalid or future display price bucket');
  return qqqEasternDateKey(b.timestamp)===date;
 });
 const same=previous&&previous.provenance?.Source===value.provenance.Source&&previous.provenance?.Adjustment===value.provenance.Adjustment;
 const merged=new Map((same?previous.bars:[]).map((b:any)=>[b.timestamp,b]));for(const bar of bars)merged.set(bar.timestamp,bar);
 if(merged.size>2000)throw Error('Display day exceeds bound');
 return {schemaVersion:value.schemaVersion,basis:'display-only',date,provenance:value.provenance,bars:[...merged.values()].sort((a:any,b:any)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)),sourceChanged:Boolean(previous&&!same),coverage:'Observed stock buckets only; not the GEX valuation input, not a complete session or an option quote clock'};
}
