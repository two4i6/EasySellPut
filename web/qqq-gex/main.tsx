import './upstream/src/App.css';
import './upstream/src/app/globals.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
let localRevision='';
const localBase=new URL('.',location.href);
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.origin!==location.origin)return Promise.reject(new Error('Remote requests are disabled'));if(url.pathname.startsWith('/api/'))return originalFetch(new URL(url.pathname.slice(1)+url.search,localBase),init).then(response=>{if(url.pathname==='/api/analysis/qqq/pcs')document.title=response.ok?'QQQ GEX · 本地数据':'QQQ GEX · 缓存缺失';return response;});return originalFetch(input,init);};
// A cached viewing session never opens Yahoo's live stream.
window.EventSource=class {static CONNECTING=0;static OPEN=1;static CLOSED=2;readyState=2;CONNECTING=0;OPEN=1;CLOSED=2;addEventListener(){} removeEventListener(){} close(){}} as any;
try{const response=await originalFetch(new URL('api/analysis/qqq/local-state',localBase));if(response.ok){const state=await response.json();localRevision=state.revision??'';if(typeof state.latestDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(state.latestDate)){const saved=localStorage.getItem('qqq-gex:snapshot-date:v1');const selected=saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved)?saved:state.latestDate;localStorage.setItem('qqq-gex:date-mode:v1','fixed');localStorage.setItem('qqq-gex:snapshot-date:v1',selected);document.title=`QQQ GEX · ${selected} · 本地历史`;}}}catch{/* Cache-miss UI remains available. */}
const {QqqPcsGexStandaloneContent}=await import('./upstream/src/app/analysis/qqq/gex/page.component');
class Boundary extends React.Component<React.PropsWithChildren, {failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?<p role="alert">QQQ GEX 页面加载失败，请重新打开。</p>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<Boundary><QqqPcsGexStandaloneContent/></Boundary>);

let watching=false,watchAbort:AbortController|null=null,watchTimer:ReturnType<typeof setTimeout>|undefined;
async function watchLocalChanges(){
 if(watching||document.hidden)return;clearTimeout(watchTimer);watching=true;watchAbort=new AbortController();
 try{while(!document.hidden){const response=await originalFetch(new URL('events?after='+encodeURIComponent(localRevision),localBase),{signal:watchAbort.signal});if(!response.ok)break;const state=await response.json();if(typeof state.version==='string'&&state.version!==localRevision){localRevision=state.version;window.dispatchEvent(new CustomEvent('qqq-local-updated',{detail:state}));}}}
 catch{/* Retry the private local endpoint after interruption. */}finally{watching=false;if(!document.hidden)watchTimer=setTimeout(()=>void watchLocalChanges(),2000);}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(watchTimer);watchAbort?.abort();}else void watchLocalChanges();});window.addEventListener('pagehide',()=>{clearTimeout(watchTimer);watchAbort?.abort();});void watchLocalChanges();
