import React from 'react';
import Original from '../upstream/src/components/Strategy/qqq/QqqNextActionCard';
export {QqqMarketQuote} from '../upstream/src/components/Strategy/qqq/QqqNextActionCard';
/** Local cached observations use the original historical action state, never a live quote badge. */
export default function LocalNextAction(props:React.ComponentProps<typeof Original>){return <Original {...props} marketQuote={false} controls={props.controls??<span>{props.historicalDate??'本地缓存'}</span>}/>;}
