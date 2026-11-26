export const QQQ_QUOTE_TIMING_POLICY='qqq-quote-timing-v1';
const time=(s:string|null|undefined)=>s?Date.parse(s):NaN;
/** Trade timestamps are evidence of trades, never substituted for quote times. */
export function qqqQuoteTiming(input:{receivedAt:string;underlyingQuoteAt?:string|null;optionQuoteAt?:string|null;latestTradeAt?:string|null}){
 const receipt=time(input.receivedAt),stock=time(input.underlyingQuoteAt),quote=time(input.optionQuoteAt),trade=time(input.latestTradeAt);
 const status=!Number.isFinite(receipt)?'INVALID_RECEIPT':!Number.isFinite(quote)?'QUOTE_TIME_UNKNOWN':!Number.isFinite(stock)?'STOCK_TIME_UNKNOWN':stock>receipt||quote>receipt?'FUTURE_SOURCE_TIME':Math.abs(stock-quote)>2000?'UNALIGNED_QUOTES':'ALIGNED';
 return {policy:QQQ_QUOTE_TIMING_POLICY,status,receivedAt:input.receivedAt,underlyingQuoteAt:Number.isFinite(stock)?new Date(stock).toISOString():null,optionQuoteAt:Number.isFinite(quote)?new Date(quote).toISOString():null,latestTradeAt:Number.isFinite(trade)?new Date(trade).toISOString():null,latestTradeLagMs:Number.isFinite(receipt)&&Number.isFinite(trade)?receipt-trade:null,canRecoverIv:status==='ALIGNED'};
}
