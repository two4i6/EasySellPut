// Actual signed GEX UI + the production document core inside source-only AppDev.
// Chromium/synthetic normalized input; not native or live-market evidence.
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '../qqq-gex/node_modules/@playwright/test/index.mjs';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),scratch=await mkdtemp(path.join(tmpdir(),'actual-gex-dev-'));
let host,browser,preview,diagnostics='';
try{
 const archive=path.join(scratch,'gex.espapp'),seed=path.join(root,'tests/fixtures/qqq-gex/app-input.json');
 const seedBefore=await readFile(seed),production=path.join(root,'src/Meili.Cli/bin/Release/net10.0/easysellput.dll');
 const before=createHash('sha256').update(await readFile(production)).digest('hex');
 execFileSync(process.platform==='win32'?'python':'python3',['build/pack-app.py','--development','--repository','test/source','--ui-dir','web/qqq-gex/dist','--output',archive],{cwd:root,stdio:'pipe'});
 host=spawn('dotnet',['tools/Meili.AppDev/bin/Release/net10.0/Meili.AppDev.dll','--package',archive,'--public-key',archive+'.public.pem','--repository','test/source','--node',process.execPath,'--seed-input',seed],{cwd:root,stdio:['pipe','pipe','pipe']});
 host.stderr.on('data',data=>{if(diagnostics.length<65536)diagnostics+=data;});
 preview=await new Promise((resolve,reject)=>{
  const reader=createInterface({input:host.stdout}),timeout=setTimeout(()=>reject(Error('GEX developer startup timed out: '+diagnostics)),60000);
  reader.once('line',line=>{clearTimeout(timeout);try{resolve(JSON.parse(line));}catch(error){reject(error);}});
  host.once('error',error=>{clearTimeout(timeout);reject(error);});host.once('exit',code=>{clearTimeout(timeout);reject(Error('GEX developer exited '+code+': '+diagnostics));});
 });
 if(!preview.development||!preview.readOnly||!path.basename(preview.temporaryProfile).startsWith('EasySellPut-AppDev-'))throw Error('Wrong source isolation');
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 const page=await browser.newPage({viewport:{width:1920,height:1080},locale:'zh-CN'}),errors=[],remote=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(new URL(preview.page).origin+'/'))remote.push(request.url());});
 await page.goto(preview.page);
 await page.waitForFunction(()=>document.body.innerText.includes('600')&&document.querySelector('canvas'),null,{timeout:30000});
 const state=await(await page.request.get(new URL('api/analysis/qqq/local-state',preview.page).href)).json();
 if(!state.ready||state.latestDate!=='2026-01-02')throw Error('Actual original model not readable');
 const catalog=await(await page.request.get(new URL('host/catalog',preview.page).href)).json();
 if(catalog.allowWrites||catalog.operations.some(op=>op.writes||op.name==='get_quotes')||!catalog.operations.some(op=>op.name==='get_qqq_gex_view'))throw Error('Wrong app scope');
 const write=await page.request.post(new URL('host/invoke',preview.page).href,{headers:{Origin:new URL(preview.page).origin},data:{operation:'capture_qqq_gex_input',arguments:{}}});
 if(write.status()!==403)throw Error('Development page granted business writes');
 for(const name of ['GEX矩阵','Heatmap','K线']){await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('QQQ GEX 视图暂时无法显示'));}
 const output=path.join(root,'web/qqq-gex/test-results');await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,'app-dev-gex-1920x1080.png')});
 await page.setViewportSize({width:1280,height:1080});await page.reload();
 await page.waitForFunction(()=>document.body.innerText.includes('600')&&document.querySelector('canvas'));
 await page.screenshot({path:path.join(output,'app-dev-gex-1280x1080.png')});
 await page.evaluate(async()=>{const current=await(await fetch('host/presentation')).json();window.__pendingPresentation=fetch('host/presentation?version='+current.version).catch(()=>null);});
 if(errors.length||remote.length)throw Error(JSON.stringify({errors,remote}));
 await page.close();await browser.close();browser=null;
 const exit=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('GEX session failed to drain')),15000);host.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
 host.stdin.end('\n');if(await exit!==0)throw Error('GEX development shutdown failed: '+diagnostics);
 if(existsSync(preview.temporaryProfile))throw Error('GEX scratch profile remained after awaited shutdown');
 if(!(await readFile(seed)).equals(seedBefore)||createHash('sha256').update(await readFile(production)).digest('hex')!==before)throw Error('Original input/production host changed');
 console.log('PASS: actual signed original GEX UI in headless AppDev, shared native document core, seeded model/history/three charts, read-only scope, 1080p wide/compact, request drain and scratch cleanup; no remote traffic or production rebuild (Chromium fixture)');
}finally{if(browser)await browser.close();if(host&&host.exitCode===null)host.kill();await rm(scratch,{recursive:true,force:true});}
