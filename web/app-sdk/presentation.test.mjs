import test from 'node:test';import assert from 'node:assert/strict';import {applyPresentation} from './presentation.mjs';
test('shared presentation reuses host colors and suppresses redundant expensive redraw work',()=>{
 const values=new Map();let writes=0;const root={dataset:{},lang:'',style:{colorScheme:'',getPropertyValue:key=>values.get(key),setProperty:(key,value)=>{values.set(key,value);writes++;}}};
 const value={language:'en-US',theme:{dark:true,reducedMotion:true,background:'#262624',text:'#FAF9F5',up:'#12345678'}};
 assert.equal(applyPresentation(value,root),true);assert.equal(root.lang,'en-US');assert.equal(root.dataset.reducedMotion,'true');assert.equal(values.get('--bg-primary'),'#262624');const first=writes;
 assert.equal(applyPresentation(value,root),false);assert.equal(writes,first);
 assert.equal(applyPresentation({...value,language:'zh-CN'},root),true);assert.equal(writes,first);
 applyPresentation({language:'foreign',theme:{...value.theme,background:'url(https://foreign.invalid/)'}},root);
 assert.equal(values.get('--bg-primary'),'#262624');assert.equal(root.lang,'zh-CN');
});
