// Real private AppView + isolated developer host. Offline fixture, not native WebView evidence.
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '../qqq-gex/node_modules/@playwright/test/index.mjs';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),scratch=await mkdtemp(path.join(tmpdir(),'app-sdk-browser-'));
let host,browser,preview;let diagnostics='';
try{
 const ui=path.join(scratch,'ui');await mkdir(ui);
 await copyFile(path.join(root,'web/app-sdk/client.mjs'),path.join(ui,'client.mjs'));
 await writeFile(path.join(ui,'index.html'),'<!doctype html><meta charset="utf-8"><title>Loading signed app fixture</title><h1>Signed AppView SDK fixture</h1><p id="status">Loading</p><script type="module" src="main.mjs"></script>');
 await writeFile(path.join(ui,'main.mjs'),`import{createAppClient}from'./client.mjs';const client=createAppClient();const catalog=await client.list();if(!catalog.operations.some(o=>o.name==='get_qqq_gex_retained_summary')||catalog.operations.some(o=>o.writes||o.name==='get_quotes'))throw Error('Wrong scope');const result=await client.call('get_qqq_gex_retained_summary');if(result.data.status!=='empty'||result.data.storageAvailable!==false)throw Error('Expected empty retained data');for(const operation of ['get_quotes','calculate_qqq_gex_local']){let denied=false;try{await client.call(operation,operation==='get_quotes'?{symbols:['QQQ']}:{})}catch{denied=true}if(!denied)throw Error('Foreign/write capability escaped');}window.fixtureClient=client;document.querySelector('#status').textContent='Actual app-owned engine completed · foreign and write calls blocked';document.title='Signed app READY';`);
 const archive=path.join(scratch,'fixture.espapp');
 execFileSync(process.platform==='win32'?'python':'python3',['build/pack-app.py','--development','--repository','test/source','--ui-dir',ui,'--output',archive],{cwd:root,stdio:'pipe'});
 const production=path.join(root,'src/Meili.Cli/bin/Release/net10.0/easysellput.dll');
 const before=createHash('sha256').update(await readFile(production)).digest('hex');
 host=spawn('dotnet',['tools/Meili.AppDev/bin/Release/net10.0/Meili.AppDev.dll','--package',archive,'--public-key',archive+'.public.pem','--repository','test/source'],{cwd:root,stdio:['pipe','pipe','pipe']});
 host.stderr.on('data',data=>{if(diagnostics.length<65536)diagnostics+=data;});
 preview=await new Promise((resolve,reject)=>{
  const reader=createInterface({input:host.stdout});const timeout=setTimeout(()=>reject(Error('Developer host startup timed out: '+diagnostics)),30000);
  reader.once('line',line=>{clearTimeout(timeout);try{resolve(JSON.parse(line));}catch(error){reject(error);}});
  host.once('error',error=>{clearTimeout(timeout);reject(error);});host.once('exit',code=>{clearTimeout(timeout);reject(Error('Developer host exited '+code+': '+diagnostics));});
 });
 if(!preview.development||!preview.readOnly||!path.basename(preview.temporaryProfile).startsWith('EasySellPut-AppDev-'))throw Error('Unexpected development isolation');
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],remote=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(new URL(preview.page).origin+'/'))remote.push(request.url());});
 await page.goto(preview.page);await page.waitForFunction(()=>document.title==='Signed app READY',null,{timeout:20000});
 const wrong=await page.request.get(new URL('/'+'0'.repeat(64)+'/host/catalog',preview.page).href);if(wrong.status()!==403)throw Error('Wrong token accepted');
 const foreign=await page.request.post(new URL('host/invoke',preview.page).href,{headers:{Origin:'https://foreign.invalid'},data:{operation:'get_qqq_gex_retained_summary',arguments:{}}});if(foreign.status()!==403)throw Error('Foreign origin accepted');
 await page.evaluate(async()=>{const stop=new AbortController();window.fixtureChanges=window.fixtureClient.presentationChanges(stop.signal);await window.fixtureChanges.next();window.fixtureWaiting=window.fixtureChanges.next();});
 if(existsSync(path.join(preview.temporaryProfile,'cache')))throw Error('Read-only UI created financial cache/storage');
 if(errors.length||remote.length)throw Error(JSON.stringify({errors,remote}));
 await page.close();await browser.close();browser=null;
 const exit=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Private request drain did not finish')),10000);host.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
 host.stdin.end('\n');if(await exit!==0)throw Error('Developer host failed to stop: '+diagnostics);
 if(existsSync(preview.temporaryProfile))throw Error('Developer scratch profile remained after awaited shutdown');
 if(createHash('sha256').update(await readFile(production)).digest('hex')!==before)throw Error('Production host changed during app preview');
 console.log('PASS: actual signed private AppView, browser SDK → app engine, token/origin/read-only scope, pending presentation cancellation and scratch cleanup; no remote traffic or host rebuild (Chromium fixture)');
}finally{
 if(browser)await browser.close();if(host&&host.exitCode===null)host.kill();
 await rm(scratch,{recursive:true,force:true});
}
