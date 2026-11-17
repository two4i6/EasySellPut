// Observes only this private GEX document. No native privileges or global key/pointer capture.
export function observeInteractions(){
 let pointer:{x:number;y:number;target:ReturnType<typeof describe>;trusted:boolean}|null=null,timer:ReturnType<typeof setTimeout>|undefined,last='',suspended=false;
 const key='qqq-local:observed-interaction:v1',documentId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 function describe(node:Element|null){
  if(!(node instanceof HTMLElement)&&!(node instanceof SVGElement))return null;
  const control=node.closest('button,input,select,textarea,[role="tab"],[tabindex],canvas')??node;
  const type=control instanceof HTMLInputElement?control.type:null;
  const redacted=control instanceof HTMLTextAreaElement||control instanceof HTMLInputElement&&!['number','range','checkbox','radio','button'].includes(control.type);
  const label=(control.getAttribute('aria-label')??(control instanceof HTMLInputElement||control instanceof HTMLSelectElement?control.labels?.[0]?.textContent:null)??(control.tagName==='BUTTON'?control.textContent:null)??control.closest('section[aria-label]')?.getAttribute('aria-label')??'').trim().slice(0,120);
  return {tag:control.tagName.toLowerCase(),role:control.getAttribute('role'),label,type,redacted,
   value:!redacted&&(control instanceof HTMLSelectElement||control instanceof HTMLInputElement)?control.value.slice(0,100):null,
   checked:control instanceof HTMLInputElement&&['checkbox','radio'].includes(control.type)?control.checked:null,
   disabled:'disabled'in control?Boolean(control.disabled):null,selected:control.getAttribute('aria-selected'),pressed:control.getAttribute('aria-pressed')};
 }
 function publish(inactive=false){
  clearTimeout(timer);timer=undefined;
  const visible=!inactive&&!document.hidden,focus=visible?describe(document.activeElement):null;
  const tooltips=visible?[...document.querySelectorAll('[role="tooltip"],[aria-label="K 线简洁信息"]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0'&&!e.closest('[aria-hidden="true"]')).slice(0,4).map(e=>({text:(e.textContent??'').trim().slice(0,1000),textTruncated:(e.textContent?.length??0)>1000})):[];
  let chartHover:any=null;const raw=visible?[...document.querySelectorAll('[data-qqq-hover]')].find(e=>e.parentElement?.getClientRects().length)?.getAttribute('data-qqq-hover'):null;
  if(raw)try{chartHover=JSON.parse(raw);}catch{chartHover={unavailable:'invalid_chart_hover'};}
  const state:any={scope:'private_gex_document',documentId,pointerUnits:'CSS viewport pixels',chartTimeUnits:'Unix seconds',visible,documentHasFocus:visible&&document.hasFocus(),focus,pointer:visible?pointer:null,tooltips,chartHover};
  let body=JSON.stringify(state);if(new TextEncoder().encode(body).length>6500){state.chartHover=chartHover?{hover:chartHover.hover,granularity:chartHover.granularity,detailsOmitted:'bounded observation exceeded; complete chart data remains in chartStudies/archive'}:null;state.detailsOmitted=true;body=JSON.stringify(state);}
  if(new TextEncoder().encode(body).length>6500){state.tooltips=[];state.detailsOmitted=true;body=JSON.stringify(state);}
  if(body===last)return;last=body;
  try{localStorage.setItem(key,JSON.stringify({observedAt:new Date().toISOString(),...state}));}catch{/* Presentation observation cannot block a chart. */}
 }
 const schedule=()=>{if(suspended)return;if(!timer)timer=setTimeout(()=>publish(),500);};
 document.addEventListener('pointermove',event=>{pointer={x:Math.round(event.clientX),y:Math.round(event.clientY),trusted:event.isTrusted,target:describe(event.target instanceof Element?event.target:null)};schedule();},{passive:true});
 document.addEventListener('pointerleave',()=>{pointer=null;schedule();});
 for(const event of ['focusin','focusout','change','input'])document.addEventListener(event,schedule,{passive:true});
 window.addEventListener('focus',schedule);window.addEventListener('blur',schedule);
 document.addEventListener('visibilitychange',()=>publish(document.hidden));window.addEventListener('pagehide',()=>{suspended=true;publish(true);},{capture:true});window.addEventListener('pageshow',()=>{suspended=false;schedule();});
 const changes=new MutationObserver(schedule);changes.observe(document.getElementById('root')??document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-qqq-hover','aria-selected','aria-pressed','aria-expanded']});
 schedule();
}
