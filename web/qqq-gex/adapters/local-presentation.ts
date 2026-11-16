export function applyLocalPresentation(value:any){
 if(!value||typeof value.dark!=='boolean')return;
 const root=document.documentElement;root.dataset.theme=value.dark?'dark':'light';root.style.colorScheme=value.dark?'dark':'light';root.dataset.reducedMotion=String(value.reducedMotion===true);
 const tokens:Record<string,string>={'--bg-primary':'background','--bg-secondary':'control','--bg-tertiary':'input','--bg-card':'control','--bg-hover':'hover','--border-color':'border','--border-light':'border','--border-subtle':'border','--text-primary':'text','--text-secondary':'muted','--text-tertiary':'muted','--accent-primary':'accent','--accent-info':'link','--accent-success':'up','--accent-danger':'down','--accent-warning':'accent','--border-focus':'focus'};
 for(const [key,role]of Object.entries(tokens))if(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value[role]))root.style.setProperty(key,value[role]);
 window.dispatchEvent(new Event('resize'));window.dispatchEvent(new CustomEvent('qqq-local-theme',{detail:value}));
}
