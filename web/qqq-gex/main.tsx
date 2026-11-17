import {observeInteractions} from './adapters/interaction-state';
import {RecoveryBoundary as Boundary} from './adapters/recovery-boundary';
import {captureLabel} from './adapters/cache-health';
import {applyLocalPresentation} from './adapters/local-presentation';
import PartialWorkspace from './adapters/partial-workspace';
import LocalDataNotice from './adapters/local-data-notice';
import {restoreLocalPreferences} from './adapters/local-preferences';
import './local.css';
import './upstream/src/App.css';
import './upstream/src/app/globals.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
let localRevision='',latestLocalDate:string|null=null,initialPartial:any=null,initialStorage:any=null,initialCapture:any=null,initialReady=false;
const localBase=new URL('.',location.href);
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.origin!==location.origin)return Promise.reject(new Error('Remote requests are disabled'));if(url.pathname.startsWith('/api/'))return originalFetch(new URL(url.pathname.slice(1)+url.search,localBase),init).then(response=>{if(url.pathname==='/api/analysis/qqq/pcs')document.title=response.ok?'QQQ GEX · 本地数据':'QQQ GEX · 缓存缺失';if(url.pathname==='/api/analysis/qqq/pcs'||url.pathname==='/api/analysis/qqq/gex/day')window.dispatchEvent(new CustomEvent('qqq-local-request-state',{detail:{ok:response.ok}}));return response;});return originalFetch(input,init);};
// A cached viewing session never opens Yahoo's live stream.
window.EventSource=class {static CONNECTING=0;static OPEN=1;static CLOSED=2;readyState=2;CONNECTING=0;OPEN=1;CLOSED=2;addEventListener(){} removeEventListener(){} close(){}} as any;
await restoreLocalPreferences(localBase,originalFetch);
// One historical workspace; ignore the retired outer-tab preference without deleting saved data.
localStorage.setItem('qqq-local:mode','history');
observeInteractions();
try{const response=await originalFetch(new URL('presentation',localBase));if(response.ok)applyLocalPresentation(await response.json());}catch{/* Native theme unavailable in standalone browser. */}
try{const response=await originalFetch(new URL('api/analysis/qqq/local-state',localBase));if(response.ok){const state=await response.json();localRevision=state.revision??'';latestLocalDate=state.latestDate??null;initialPartial=state.partial??null;initialStorage=state.storage??null;initialCapture=state.capture??null;initialReady=state.ready??Boolean(state.latestDate);if(typeof state.latestDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(state.latestDate)){const saved=localStorage.getItem('qqq-gex:snapshot-date:v1');const selected=saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved)?saved:state.latestDate;localStorage.setItem('qqq-gex:date-mode:v1','fixed');localStorage.setItem('qqq-gex:snapshot-date:v1',selected);document.title=`QQQ GEX · ${selected} · 本地历史`;}}}catch{/* Cache-miss UI remains available. */}
const {QqqPcsGexStandaloneContent}=await import('./upstream/src/app/analysis/qqq/gex/page.component');
function Workbench(){
 const [storage,setStorage]=React.useState<any>(initialStorage);
 const [readable,setReadable]=React.useState(initialReady);
 const [capture,setCapture]=React.useState<any>(initialCapture);
 const [partial,setPartial]=React.useState<any>(initialPartial);
 const [latestDate,setLatestDate]=React.useState(latestLocalDate);
 const [revision,setRevision]=React.useState(localRevision);
 const [preferenceStatus,setPreferenceStatus]=React.useState('');
 React.useEffect(()=>{if(!readable)document.title=['capturing','calculating','enriching'].includes(capture?.phase)?'QQQ GEX · 准备中':'QQQ GEX · 缓存缺失';},[readable,capture?.phase]);
 React.useEffect(()=>{const handle=(e:Event)=>setPreferenceStatus((e as CustomEvent).detail);window.addEventListener('qqq-preferences-status',handle);return()=>window.removeEventListener('qqq-preferences-status',handle);},[]);
 React.useEffect(()=>{const update=(event:Event)=>{const value=(event as CustomEvent).detail;setRevision(value?.version??value?.revision??localRevision);if(value?.latestDate)setLatestDate(value.latestDate);setStorage(value?.storage??null);setPartial(value?.partial??null);setCapture(value?.capture??null);if(typeof value?.ready==='boolean')setReadable(value.ready);};window.addEventListener('qqq-local-quote',update);return()=>window.removeEventListener('qqq-local-quote',update);},[]);
 return <div className="qqq-local-shell"><LocalDataNotice partial={partial} storage={storage} preferenceStatus={preferenceStatus}/><div className="qqq-local-view"><Boundary onDiagnostic={value=>{void originalFetch(new URL('diagnostics',localBase),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(2000)}).catch(()=>{});}}><PartialWorkspace partial={partial} latestDate={latestDate} revision={revision}>{readable?<QqqPcsGexStandaloneContent/>:<section role="status" style={{padding:"24px"}}><h2>{captureLabel({ready:false,capture,status:storage?.error?"UNAVAILABLE":"WARMING"})}</h2><p>先采集原始输入，再执行本地计算，提交后图表才可读取。当前没有可读页面，不代表采集已成功。</p><p>已有历史与部分输入不会被删除；缺失的历史不会补造。保持本页可见，提交后会自动加载。</p></section>}</PartialWorkspace></Boundary></div></div>;
}
createRoot(document.getElementById('root')!,{onCaughtError:()=>{}}).render(<Workbench/>);

let watching=false,watchAbort:AbortController|null=null,watchTimer:ReturnType<typeof setTimeout>|undefined;
async function watchLocalChanges(){
 if(watching||document.hidden)return;clearTimeout(watchTimer);watching=true;watchAbort=new AbortController();
 try{while(!document.hidden){const response=await originalFetch(new URL('events?after='+encodeURIComponent(localRevision),localBase),{signal:watchAbort.signal});if(!response.ok)break;const state=await response.json();applyLocalPresentation(state.presentation);window.dispatchEvent(new CustomEvent('qqq-local-quote',{detail:{version:state.version,latestDate:state.latestDate,storage:state.storage??null,quote:state.quote??null,partial:state.partial??null,capture:state.capture??null,ready:state.ready}}));if(state.latestDate)latestLocalDate=state.latestDate;if(typeof state.version==='string'&&state.version!==localRevision){localRevision=state.version;window.dispatchEvent(new CustomEvent('qqq-local-updated',{detail:state}));}}}
 catch{/* Retry the private local endpoint after interruption. */}finally{watching=false;if(!document.hidden)watchTimer=setTimeout(()=>void watchLocalChanges(),2000);}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(watchTimer);watchAbort?.abort();}else void watchLocalChanges();});window.addEventListener('pagehide',()=>{clearTimeout(watchTimer);watchAbort?.abort();});void watchLocalChanges();
