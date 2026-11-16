// Presentation state only. Native storage survives random loopback ports; no credentials.
export async function restoreLocalPreferences(base:URL,fetcher:typeof fetch){
 const allowed=(key:string)=>key.length<=200&&['qqq-gex:','qqq-pcs:','qqq-terminal:','qqq-local:'].some(p=>key.startsWith(p))&&!/token|password|secret|api[-_]key|credential|auth/i.test(key);
 let revision:string;try{const r=await fetcher(new URL('preferences',base));if(!r.ok)return;const state=await r.json();revision=state.revision;if(typeof revision!=='string'||!state.values)return;for(const [key,value]of Object.entries(state.values))if(allowed(key)&&typeof value==='string')localStorage.setItem(key,value);}catch{return;}
 const pending=new Map<string,string|null>();let timer:ReturnType<typeof setTimeout>|undefined,busy=false,blocked=false;
 const status=(message:string)=>window.dispatchEvent(new CustomEvent('qqq-preferences-status',{detail:message}));
 const flush=async()=>{if(busy||blocked||!pending.size)return;busy=true;const changes=Object.fromEntries(pending);try{const response=await fetcher(new URL('preferences',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,changes}),keepalive:true});if(!response.ok){blocked=true;status(response.status===409?'视图设置有并发更改；重新打开后再保存':'视图设置保存失败；本次视图仍可使用');return;}const state=await response.json();revision=state.revision;for(const[key,value]of Object.entries(changes))if(pending.get(key)===value)pending.delete(key);status('');}catch{blocked=true;status('视图设置保存失败；本次视图仍可使用');}finally{busy=false;if(pending.size&&!blocked)timer=setTimeout(()=>void flush(),250);}};
 const changed=(key:string,value:string|null)=>{if(!allowed(key))return;pending.set(key,value);clearTimeout(timer);timer=setTimeout(()=>void flush(),250);};
 const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
 Storage.prototype.setItem=function(key,value){set.call(this,key,value);if(this===localStorage)changed(String(key),String(value));};
 Storage.prototype.removeItem=function(key){remove.call(this,key);if(this===localStorage)changed(String(key),null);};
 window.addEventListener('pagehide',()=>void flush());document.addEventListener('visibilitychange',()=>{if(document.hidden)void flush();});
}
