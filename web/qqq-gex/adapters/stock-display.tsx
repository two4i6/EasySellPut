import React,{createContext,useContext,useEffect,useState}from'react';
import {qqqEasternDateKey}from'../upstream/src/lib/qqqMarketDate';
import {buildQqqPcsIntradayChartData}from'../upstream/src/components/Strategy/qqq/QqqPcsIntradayChart.shared';
const Context=createContext<any>(null);
const et=(value:string)=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'未知';
export function useIndependentStockPrices(modelBars:readonly any[]){const value=useContext(Context);return value&&modelBars.length&&qqqEasternDateKey(modelBars[0].timestamp)===value.date?value:null;}
/** Replace drawing coordinates only. Original setup/RSI/PCS/valuation series stay on modelData. */
export function projectStockChart(modelData:any,stock:any,granularity:string){
 if(!stock||granularity==='1d'||!stock.bars.length)return modelData;
 const display=buildQqqPcsIntradayChartData(stock.bars,[],undefined,undefined,[],granularity as any);
 return {...modelData,price:display.price,candles:display.candles,normalizedBars:display.normalizedBars};
}
export default function DisplayPrices({date,archiveState,revision,children}:{date:string;archiveState:string;revision:string;children:React.ReactNode}){
 const [all,setAll]=useState(false),[data,setData]=useState<any>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');(async()=>{
  async function read(resource:string,expected?:string){let page=1,items:any[]=[],first:any;do{const query=new URLSearchParams({resource,priceBasis:'display',archiveState,date,pageSize:'200',page:String(page),...(expected?{revision:expected}:{})});const response=await fetch('/api/analysis/qqq/local-archive?'+query,{signal:controller.signal});if(!response.ok)throw Error('行情暂不可读');const v=await response.json();if(!v.available)throw Error(v.status==='display_prices_missing'?'行情未单独采集':'行情已更新，请重试');if(v.scope?.date!==date||v.scope?.priceBasis!=='display')throw Error('行情日期/用途不匹配');if(!first)first=v;expected=v.revision;items.push(...v.items);if(!v.hasMore)return {...first,items};page++;}while(page<=10);throw Error('行情超过读取上限');}
  const regular=await read('bars'),extended=await read('extendedBars',regular.revision);
  if(!controller.signal.aborted){setData({regular,extended});localStorage.setItem('qqq-local:observed-stock-display:v1',JSON.stringify({observedAt:new Date().toISOString(),date,archiveState,priceBasis:'display',revision:regular.revision,regularCount:regular.items.length,extendedCount:extended.items.length,complete:false}));}
 })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[date,archiveState,revision,retry]);
 const selected=data?(all||!data.regular.items.length?[...data.regular.items,...data.extended.items].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)):data.regular.items):[];
 const provenance=data?.regular.barProvenance,last=selected.at(-1),end=last?new Date(Date.parse(last.timestamp)+120000).toISOString():null;
 const value=data?{date,bars:selected,provenance,priceBasis:'display-only'}:null;
 return <Context.Provider value={value}><div className="qqq-price-workspace"><section className="qqq-stock-display" aria-label="独立股票行情"><header><strong>行情 K线</strong><span>{provenance?.Source??'—'} · {end?et(end)+' ET':'—'} · {last?.close?.toFixed(2)??'—'}{provenance?.OfflineCache?' · 缓存':''}</span><span title="下方估值指标继续使用原价格前缀；股票价格仅更新图表">模型指标 ≤ {provenance?.valuationCutoff?et(provenance.valuationCutoff)+' ET':'未知'}</span><label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>盘前盘后</label><details><summary>时点</summary><pre>{JSON.stringify(provenance??{reason:error},null,2)}</pre></details>{error&&<span role="status">{error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></span>}</header></section>{children}</div></Context.Provider>;
}
