import{build}from'esbuild';import{mkdtempSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{createServer}from'node:http';import{chromium}from'@playwright/test';import assert from'node:assert/strict';
const dir=mkdtempSync(path.join(tmpdir(),'gex-pref-recovery-')),file=path.join(dir,'fixture.js');
await build({stdin:{contents:`import {restoreLocalPreferences} from './adapters/local-preferences';window.statuses=[];addEventListener('qqq-preferences-status',e=>window.statuses.push(e.detail));const fetcher=async(...args)=>{const r=await fetch(...args);if(window.dropAck&&args[1]?.method==='POST'&&r.ok){window.dropAck=false;if(window.externalOnLost){window.externalOnLost=false;await fetch('/external-change',{method:'POST'});}throw Error('fixture lost acknowledgement');}return r;};await restoreLocalPreferences(new URL('/',location.href),fetcher);window.ready=true;`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:file});
let revision=0,values={},posts=0,writes=0,unavailable=false;
const server=createServer(async(req,res)=>{
 if(req.url==='/external-change'){values['qqq-local:external']='external-after-commit';revision++;res.end('{}');return;}
 if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(file));return;}
 if(req.url!=='/preferences'){res.setHeader('content-type','text/html');res.end('<script type="module" src="/fixture.js"></script>');return;}
 res.setHeader('content-type','application/json');
 if(req.method==='GET'){res.end(JSON.stringify({revision:String(revision),values}));return;}
 posts++;let body='';for await(const b of req)body+=b;const change=JSON.parse(body);
 if(unavailable){unavailable=false;res.writeHead(503);res.end('{}');return;}
 if(change.revision!==String(revision)){res.writeHead(409);res.end('{}');return;}
 Object.assign(values,change.changes);revision++;writes++;res.end(JSON.stringify({revision:String(revision),values}));
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
const until=async predicate=>{const deadline=Date.now()+15000;while(!await predicate()){assert.ok(Date.now()<deadline,'preference recovery timeout');await new Promise(r=>setTimeout(r,50));}};
try{
 const context=await browser.newContext(),page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 await context.setOffline(true);await page.evaluate(()=>localStorage.setItem('qqq-local:test','offline-value'));await new Promise(r=>setTimeout(r,400));assert.equal(posts,0);await context.setOffline(false);await page.evaluate(()=>dispatchEvent(new Event('online')));await until(()=>values['qqq-local:test']==='offline-value');await until(()=>page.evaluate(()=>window.statuses.at(-1)===''));
 unavailable=true;await page.evaluate(()=>localStorage.setItem('qqq-local:test','after-503'));await until(()=>values['qqq-local:test']==='after-503');await until(()=>page.evaluate(()=>window.statuses.at(-1)===''));
 const priorWrites=writes,priorStatuses=await page.evaluate(()=>window.statuses.length);await page.evaluate(()=>{window.dropAck=true;localStorage.setItem('qqq-local:test','committed-without-response');});await until(()=>values['qqq-local:test']==='committed-without-response');await until(()=>page.evaluate(n=>window.statuses.length>=n+2&&window.statuses.at(-1)==='',priorStatuses));assert.equal(writes,priorWrites+1,'lost acknowledgement must reconcile without duplicate write');
 values['qqq-local:test']='external-change';revision++;const priorPosts=posts;await page.evaluate(()=>localStorage.setItem('qqq-local:test','unsaved-local-draft'));await until(()=>page.evaluate(()=>window.statuses.at(-1)?.includes('并发更改')));await new Promise(r=>setTimeout(r,1200));assert.equal(posts,priorPosts+1);assert.equal(values['qqq-local:test'],'external-change');assert.equal(await page.evaluate(()=>localStorage.getItem('qqq-local:test')),'unsaved-local-draft');
 await context.close();
 const second=await browser.newContext(),other=await second.newPage();await other.goto('http://127.0.0.1:'+server.address().port);await other.waitForFunction(()=>window.ready);const beforeMixed=posts;
 await other.evaluate(()=>{window.dropAck=true;window.externalOnLost=true;localStorage.setItem('qqq-local:test','own-committed-value');});
 await until(()=>other.evaluate(()=>window.statuses.at(-1)?.includes('并发更改')));assert.equal(values['qqq-local:external'],'external-after-commit');assert.equal(values['qqq-local:test'],'own-committed-value');assert.equal(posts,beforeMixed+1);await second.close();console.log('PASS preferences recover offline/503/lost acknowledgement; conflicts preserve external state and unsaved local draft, retries bounded');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
