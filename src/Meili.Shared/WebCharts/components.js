/* Shared non-modal popover: native HTML, bounded positioning, outside/Escape dismissal and focus return. */
'use strict';
(()=>{
  for(const group of document.querySelectorAll('[role=tablist].app-segmented'))group.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    const tabs=[...group.querySelectorAll('button[role=tab]:not(:disabled)')],index=tabs.indexOf(document.activeElement);if(index<0)return;
    e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();
  });
  for(const root of document.querySelectorAll('[data-app-popover]')){
    const trigger=root.querySelector('summary'),panel=root.querySelector('.app-popover-panel');
    if(!trigger||!panel)continue;
    function place(){
      if(!root.open)return;
      const r=trigger.getBoundingClientRect(),gap=8,edge=16;
      const available=Math.max(120,innerHeight-edge*2);
      panel.style.maxHeight=available+'px';
      const width=Math.min(panel.offsetWidth,innerWidth-edge*2),height=panel.offsetHeight;
      panel.style.left=Math.max(edge,Math.min(innerWidth-edge-width,r.right-width))+'px';
      panel.style.top=Math.max(edge,Math.min(innerHeight-edge-height,r.bottom+gap))+'px';
    }
    let wasOpen=false;
    function sync(){trigger.setAttribute('aria-expanded',String(root.open));if(root.open){place();if(!wasOpen)window.meiliMotion?.enter(panel);}wasOpen=root.open;}
    trigger.addEventListener('click',e=>{e.preventDefault();root.open=!root.open;sync();});
    root.addEventListener('toggle',sync);
    function dismiss(e){if(e.key==='Escape'&&root.open){e.preventDefault();e.stopPropagation();root.open=false;trigger.focus();}}
    root.addEventListener('keydown',dismiss);document.addEventListener('keydown',dismiss);
    document.addEventListener('pointerdown',e=>{if(root.open&&!root.contains(e.target))root.open=false;});
    root.addEventListener('focusout',e=>{if(root.open&&e.relatedTarget&&!root.contains(e.relatedTarget))root.open=false;});
    window.addEventListener('blur',()=>root.open=false);
    window.addEventListener('resize',place);
    document.addEventListener('scroll',e=>{if(root.open&&!panel.contains(e.target))place();},true);
    new ResizeObserver(place).observe(panel);
  }
})();
