/** Generic actual-feedback statistics. Strategy owns source filtering and every response to these facts. */
import type {StrategyFeedback} from './strategy-module-v2';
export function settledFeedbackPnl(feedback:Readonly<StrategyFeedback>,invalidMessage='Actual finite settlement P&L required'):number|null{
  if(feedback.kind!=='close'&&feedback.kind!=='settle')return null;
  const pnl=feedback.payload.pnl;
  if(typeof pnl!=='number'||!Number.isFinite(pnl))throw Error(invalidMessage);
  return pnl;
}
/** Event-order peak, intentionally NOT a daily grouped account drawdown. */
export function accumulateRealizedPeak<T extends {realized:number;peak:number}>(state:T,feedback:Readonly<StrategyFeedback>):T{
  const pnl=settledFeedbackPnl(feedback);if(pnl===null)return state;
  const realized=state.realized+pnl;return {...state,realized,peak:Math.max(state.peak,realized)};
}
export function accumulateExecutionCounts<T extends {filled:number;closed:number;realized:number}>(state:T,feedback:Readonly<StrategyFeedback>):T{
  if(feedback.kind==='fill')return {...state,filled:state.filled+1};
  const pnl=settledFeedbackPnl(feedback);return pnl===null?state:{...state,closed:state.closed+1,realized:state.realized+pnl};
}
export function accumulateSettledWindow<T extends {lastSettledPnl:number|null;settledPnlHistory:number[]}>(state:T,
  feedback:Readonly<StrategyFeedback>,limit:number):T{
  if(!Number.isSafeInteger(limit)||limit<1)throw Error('Invalid settled history bound');
  const pnl=settledFeedbackPnl(feedback);return pnl===null?state:{...state,lastSettledPnl:pnl,
    settledPnlHistory:[...state.settledPnlHistory,pnl].slice(-limit)};
}
