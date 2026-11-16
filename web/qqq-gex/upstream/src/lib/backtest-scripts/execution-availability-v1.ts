/** Daily closes become available after that session, never at its opening. */
import type {MarketDataSet} from '../engines/leveraged-overlay/v2/backtest/fixtures';
export const EXECUTION_AVAILABILITY_VERSION='next-open-prior-session-close-v1';
export function previousSession(data:MarketDataSet,asOf:string):string {
  let lo=0,hi=data.qqqBars.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(data.qqqBars[mid]!.date<asOf)lo=mid+1;else hi=mid;}
  if(!lo)throw Error(`Opening execution requires preceding session: ${asOf}`);
  return data.qqqBars[lo-1]!.date;
}
