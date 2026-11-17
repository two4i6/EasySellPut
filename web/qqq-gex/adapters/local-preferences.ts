// Presentation state only. Native storage survives random loopback ports; no credentials.
export async function restoreLocalPreferences(base:URL,fetcher:typeof fetch){
 const allowed=(key:string)=>key.length<=200&&['qqq-gex:','qqq-pcs:','qqq-terminal:','qqq-local:'].some(p=>key.startsWith(p))&&!/token|password|secret|api[-_]key|credential|auth/i.test(key);
 let revision:string,known:Record<string,string>={};try{const r=await fetcher(new URL('preferences',base));if(!r.ok)return;const state=await r.json();revision=state.revision;if(typeof revision!=='string'||!state.values)return;known={...state.values};for(const[key,value]of Object.entries(state.values))if(allowed(key)&&typeof value==='string')localStorage.setItem(key,value);}catch{return;}
 const pending=new Map<string,string|null>();let timer:ReturnType<typeof setTimeout>|undefined,busy=false,blocked=false,retries=0,uncertain:Record<string,string|null>|null=null;
 const status=(message:string)=>window.dispatchEvent(new CustomEvent('qqq-preferences-status',{detail:message}));
 const waiting=()=>status('视图设置等待网络恢复；本次视图仍可使用');
 const conflict=()=>{blocked=true;status('视图设置有并发更改；重新打开后再保存');};
 const acknowledge=(changes:Record<string,string|null>)=>{for(const[key,value]of Object.entries(changes))if(pending.get(key)===value)pending.delete(key);};
 const flush=async()=>{
  if(busy||blocked||!pending.size)return;if(!navigator.onLine){waiting();return;}busy=true;let sent:Record<string,string|null>|null=null;
  try{
   // A lost response may follow a committed write. Reconcile its exact values
   // before retrying; never blindly overwrite a new external revision.
   if(uncertain){
    const response=await fetcher(new URL('preferences',base),{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('Preference reconciliation unavailable');const state=await response.json();
    if(state.revision!==revision){const expected={...known};for(const[key,value]of Object.entries(uncertain))if(value===null)delete expected[key];else expected[key]=value;if(Object.keys(expected).length!==Object.keys(state.values).length||!Object.entries(expected).every(([key,value])=>state.values[key]===value)){conflict();return;}revision=state.revision;known={...state.values};acknowledge(uncertain);}
    uncertain=null;
   }
   if(!pending.size){status('');retries=0;return;}
   sent=Object.fromEntries(pending);
   const response=await fetcher(new URL('preferences',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,changes:sent}),keepalive:true,signal:AbortSignal.timeout(3000)});
   if(response.status===409){conflict();return;}
   if(response.status>=500)throw Error('Preference service unavailable');
   if(!response.ok){blocked=true;status('视图设置保存失败；本次视图仍可使用');return;}
   const state=await response.json();revision=state.revision;known={...state.values};acknowledge(sent);retries=0;status('');
  }catch{if(sent)uncertain=sent;retries++;waiting();}
  finally{busy=false;if(pending.size&&!blocked&&navigator.onLine&&retries<=3)timer=setTimeout(()=>void flush(),retries?1000:250);}
 };
 const changed=(key:string,value:string|null)=>{if(!allowed(key))return;pending.set(key,value);clearTimeout(timer);timer=setTimeout(()=>void flush(),250);};
 const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
 Storage.prototype.setItem=function(key,value){set.call(this,key,value);if(this===localStorage)changed(String(key),String(value));};
 Storage.prototype.removeItem=function(key){remove.call(this,key);if(this===localStorage)changed(String(key),null);};
 const resumed=()=>{if(!blocked){retries=0;clearTimeout(timer);void flush();}};
 window.addEventListener('online',resumed);window.addEventListener('pagehide',()=>void flush());document.addEventListener('visibilitychange',()=>{if(document.hidden)void flush();else resumed();});
}
