/** Apply the host's existing design tokens. No alternate palette, polling or market-side effects. */
export function applyTheme(value, root=globalThis.document?.documentElement){
 if(!root||!value||typeof value.dark!=='boolean')return false;
 let changed=false;
 function attribute(key,next){if(root.dataset[key]!==next){root.dataset[key]=next;changed=true;}}
 attribute('theme',value.dark?'dark':'light');attribute('reducedMotion',String(value.reducedMotion===true));
 const scheme=value.dark?'dark':'light';if(root.style.colorScheme!==scheme){root.style.colorScheme=scheme;changed=true;}
 const tokens={'--bg-primary':'background','--bg-secondary':'control','--bg-tertiary':'input','--bg-card':'control','--bg-hover':'hover','--border-color':'border','--border-light':'border','--border-subtle':'border','--text-primary':'text','--text-secondary':'muted','--text-tertiary':'muted','--accent-primary':'accent','--accent-info':'link','--accent-success':'up','--accent-danger':'down','--accent-warning':'accent','--border-focus':'focus'};
 for(const [key,role]of Object.entries(tokens))if(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value[role])&&root.style.getPropertyValue(key)!==value[role]){root.style.setProperty(key,value[role]);changed=true;}
 return changed;
}
export function applyPresentation(value,root=globalThis.document?.documentElement){
 if(!root||!value)return false;
 let changed=applyTheme(value.theme,root);
 if(['zh-CN','en-US'].includes(value.language)&&root.lang!==value.language){root.lang=value.language;changed=true;}
 return changed;
}
