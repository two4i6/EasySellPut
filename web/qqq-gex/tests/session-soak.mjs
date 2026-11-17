// Real private .NET session + Chromium, synthetic input in an isolated data dir.
// Bounded endurance/renderer test, not a real session, fresh alert, or native WebView certification.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {chromium} from '@playwright/test';
const root=path.resolve('../../'),host=process.env.QQQ_CLOUD_HOST??path.join(root,'tests/Meili.Qqq.CloudHost/bin/Debug/net10.0/Meili.Qqq.CloudHost.dll');
const cycles=Number(process.env.QQQ_SOAK_CYCLES??12),pauseMs=Number(process.env.QQQ_SOAK_PAUSE_MS??100);
assert.ok(Number.isInteger(cycles)&&cycles>=4&&cycles<=1000);
assert.ok(Number.isFinite(pauseMs)&&pauseMs>=0&&pauseMs<=60000);
const dir=mkdtempSync(path.join(tmpdir(),'qqq-session-soak-')),dbPath=path.join(dir,'cache/qqq-gex.db');mkdirSync(path.dirname(dbPath));
const start=Date.parse('2026-01-02T14:30:00Z'),iso=minutes=>new Date(start+minutes*60000).toISOString();
const capture=Array.from({length:16},(_,i)=>[2,5].map(d=>({valuationAt:iso(i*2),expiry:Date.parse(`2026-01-0${d}`)/1000,spot:600+i*.1,result:{receivedAt:iso(i*2+.1),options:[{
 calls:Array.from({length:101},(_,j)=>({strike:550+j,impliedVolatility:.2,openInterest:100+j+i})),
 puts:Array.from({length:101},(_,j)=>({strike:550+j,impliedVolatility:.22,openInterest:90+j+i}))
}]}}))).flat();
const input=path.join(dir,'input.json');writeFileSync(input,JSON.stringify({symbol:'QQQ',source:'synthetic-session-endurance-test',captures:capture,bars:Array.from({length:16},(_,i)=>({timestamp:iso(i*2),open:600+i*.1,high:601+i*.1,low:599+i*.1,close:600+i*.1,volume:100+i}))}));
execFileSync(process.execPath,['runtime-dist/import.mjs',input,dbPath],{stdio:['ignore','pipe','pipe']});
function digest(){const db=new DatabaseSync(dbPath,{readOnly:true});try{const h=createHash('sha256');for(const row of db.prepare('SELECT row_key,body,sha256 FROM qqq_gex_local_rows ORDER BY row_key').iterate()){h.update(row.row_key);h.update(row.sha256);h.update(typeof row.body==='string'?row.body:Buffer.from(row.body));}return h.digest('hex');}finally{db.close();}}
function rss(pid){try{return Number(readFileSync(`/proc/${pid}/status`,'utf8').match(/VmRSS:\s+(\d+)/)?.[1])*1024;}catch{return null;}}
const protectedBefore=digest(),errors=[],remote=[],samples=[],restarts=[];let processHost,browser,context,expectedRows=null;
const began=performance.now();
async function launch(){
 let stderr='';processHost=spawn('dotnet',[host,'--serve',dbPath],{stdio:['pipe','pipe','pipe']});processHost.stderr.on('data',b=>stderr+=b);const lines=createInterface({input:processHost.stdout});
 return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cloud host startup timeout: '+stderr.slice(-300))),30000);lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line).pageUri);});processHost.once('exit',code=>{clearTimeout(timer);reject(Error('Host exited '+code+': '+stderr.slice(-300)));});});
}
async function shutdown(){if(!processHost||processHost.exitCode!==null)return;const child=processHost;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Cloud host did not exit gracefully'));},10000);child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('Cloud host exit '+code));});child.stdin.end('\n');});}
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 for(let generation=0;generation<2;generation++){
  const uri=await launch(),base=new URL('.',uri);context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.name+': '+e.message));page.on('request',r=>{if(new URL(r.url()).origin!==base.origin)remote.push(r.url());});
  await page.goto(uri);
  // Previous process may have persisted Matrix/Heatmap. Select the candle
  // renderer explicitly before asserting its canvas, without clearing preferences.
  await page.getByRole('button',{name:'K线',exact:true}).click();await page.locator('canvas:visible').first().waitFor({timeout:60000});
  await page.waitForFunction(()=>document.querySelectorAll('section[aria-label="回放 GEX 快照表"] tbody tr:not([aria-hidden])').length>1,{},{timeout:60000});
  await page.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem('qqq-local:observed-exposure:v1')??'null')?.effectiveAt!==null;}catch{return false;}},{},{timeout:30000});
  // Wait for the existing bounded preference bridge, then read it through the actual application operation.
  let browserSelection;
  for(let attempt=0;attempt<100;attempt++){const current=await page.evaluate(()=>localStorage.getItem('qqq-local:observed-exposure:v1'));const saved=await(await context.request.get(new URL('preferences',base).href)).json();if(current&&saved.values['qqq-local:observed-exposure:v1']===current){browserSelection=current;break;}await new Promise(r=>setTimeout(r,100));}
  assert.ok(browserSelection,'current browser selection must reach native preference storage');
  await context.request.get(new URL('api/analysis/qqq/local-state',base).href);
  const operation=JSON.parse(execFileSync('dotnet',[host,'--operation',dir,'get_qqq_gex_view',JSON.stringify({resource:'workspace'})],{encoding:'utf8',maxBuffer:1048576}));
  assert.equal(operation.success,true);const workspace=JSON.parse(Buffer.from(operation.data.bodyBase64,'base64').toString('utf8'));
  const selection=JSON.parse(workspace.preferences.values['qqq-local:observed-exposure:v1']);assert.equal(selection.date,'2026-01-02');assert.deepEqual(selection,JSON.parse(browserSelection));assert.deepEqual(workspace.analyticalSelections.exposure,selection);assert.ok(selection.effectiveAt>0);assert.ok(selection.selectedStrikes.length>0);
  assert.equal(workspace.desktop.fresh,true);assert.equal(workspace.desktop.lastObserved.state.capture.phase,'idle');assert.equal(workspace.desktop.lastObserved.state.ready,true);
  async function interactionRead(){
   let observed;
   for(let n=0;n<100;n++){const raw=await page.evaluate(()=>localStorage.getItem('qqq-local:observed-interaction:v1'));const saved=await(await context.request.get(new URL('preferences',base).href)).json();if(raw&&saved.values['qqq-local:observed-interaction:v1']===raw){observed=JSON.parse(raw);break;}await new Promise(r=>setTimeout(r,100));}
   assert.ok(observed,'interaction must reach native storage');
   const response=JSON.parse(execFileSync('dotnet',[host,'--operation',dir,'get_qqq_gex_view',JSON.stringify({resource:'workspace'})],{encoding:'utf8',maxBuffer:1048576}));assert.equal(response.success,true);
   const data=JSON.parse(Buffer.from(response.data.bodyBase64,'base64').toString('utf8'));assert.deepEqual(data.analyticalSelections.interaction,observed);return observed;
  }
  const canvas=page.locator('canvas:visible').first(),bounds=await canvas.boundingBox();assert.ok(bounds);
  for(const fraction of [.3,.5,.7]){await page.mouse.move(bounds.x+bounds.width*fraction,bounds.y+bounds.height*.3);await new Promise(r=>setTimeout(r,150));if(await page.locator('[data-qqq-hover]').count())break;}
  await page.locator('[data-qqq-hover]').waitFor({state:'attached',timeout:30000});const hovered=JSON.parse(await page.locator('[data-qqq-hover]').first().getAttribute('data-qqq-hover'));
  // One cursor time can render first without GEX, then with asynchronously loaded walls.
  // Wait for the entire source payload, not just its unchanged time.
  await page.waitForFunction(expected=>JSON.stringify(JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.chartHover)===expected,JSON.stringify(hovered));
  const hoverRead=await interactionRead();assert.deepEqual(hoverRead.chartHover,hovered);assert.ok(hoverRead.pointer);assert.equal(hoverRead.chartTimeUnits,'Unix seconds');await page.screenshot({path:`test-results/qqq-hover-${generation}.png`});
  const speed=page.getByLabel('播放速度',{exact:true});await speed.focus();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.focus?.label==='播放速度');const focusRead=await interactionRead();assert.equal(focusRead.focus.value,await speed.inputValue());await page.screenshot({path:`test-results/qqq-focus-${generation}.png`});
  await page.mouse.move(1,1);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('qqq-local:observed-interaction:v1')??'null')?.chartHover===null);assert.equal((await interactionRead()).chartHover,null);
  await page.getByRole('button',{name:'Heatmap',exact:true}).click();
  for(const scope of ['all','selected']){await page.getByLabel('到期日范围',{exact:true}).selectOption(scope);await page.waitForFunction(scope=>JSON.parse(localStorage.getItem('qqq-local:observed-exposure:v1')??'null')?.scope===scope,scope);}
  const api=new URL('api/analysis/qqq/gex/day?date=2026-01-02&from=2026-01-02T05%3A00%3A00Z&to=2026-01-03T05%3A00%3A00Z&expiryDate=2026-01-02',base);
  const before=await (await context.request.get(new URL('api/analysis/qqq/local-state',base).href)).json();assert.equal(before.ready,true);assert.equal(before.capture.phase,'idle','test host must not claim live capture');
  for(let i=0;i<cycles;i++){
   const mode=['GEX矩阵','Heatmap','K线'][i%3];await page.getByRole('button',{name:mode,exact:true}).click();
   const tab=['Gamma 地图','行权价分布','成交持仓','结构事件','活动响应','日内节奏','组合分析','触位统计','Max Pain / Time','ATM IV'][i%10];await page.getByRole('tab',{name:tab,exact:true}).click();
   const t=performance.now(),response=await context.request.get(api.href);assert.equal(response.status(),200);const payload=await response.json();await response.dispose();assert.equal(payload.items.length,16);
   // Snapshot the rows in the same browser turn as the readiness check: mode
   // changes may revalidate/unmount between two independent browser round trips.
   const table=await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('section[aria-label="回放 GEX 快照表"] tbody tr:not([aria-hidden])')];return rows.length>1?rows.map(row=>row.textContent):false;},{},{timeout:30000});
   const observedRows=await table.jsonValue();await table.dispose();const rows=observedRows.length;if(expectedRows===null)expectedRows=rows;assert.equal(rows,expectedRows);assert.equal(rows,16);
   console.error(`session ${generation} cycle ${i} rendered ${mode}/${tab}, retained rows ${rows}`);
   samples.push({generation,cycle:i,chartMode:mode,tab,elapsedMs:performance.now()-began,readAndRenderMs:performance.now()-t,hostRssBytes:rss(processHost.pid)});
   if(i===Math.floor(cycles/2)){
    const cdp=await context.newCDPSession(page);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await new Promise(r=>setTimeout(r,250));await cdp.send('Page.setWebLifecycleState',{state:'active'});
    await context.setOffline(true);await new Promise(r=>setTimeout(r,250));await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await cdp.detach();
   }
   assert.equal(await page.getByText('视图设置保存失败；本次视图仍可使用',{exact:true}).count(),0,'transient offline must not permanently block preference writes');   assert.equal(await page.getByText('QQQ GEX 视图暂时无法显示',{exact:true}).count(),0);await new Promise(r=>setTimeout(r,pauseMs));
  }
  await page.screenshot({path:`test-results/qqq-session-soak-${generation}.png`});
  const after=await (await context.request.get(new URL('api/analysis/qqq/local-state',base).href)).json();assert.equal(after.revision,before.revision);assert.equal(digest(),protectedBefore);
  restarts.push({generation,visibleSnapshotRows:expectedRows,protectedHistoryUnchanged:true,storageReady:after.ready});await context.close();context=null;await shutdown();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 const sorted=samples.map(s=>s.readAndRenderMs).sort((a,b)=>a-b),report={kind:'synthetic-private-session-endurance',cyclesPerProcess:cycles,processes:2,elapsedMs:performance.now()-began,environment:{node:process.version,platform:process.platform,architecture:process.arch,chromium:browser.version()},dataset:{captures:32,expiries:2,strikesPerProfile:101,bars:16},p95ReadAndRenderMs:sorted[Math.ceil(sorted.length*.95)-1],samples,restarts,errors,remote,protectedHistoryUnchanged:true,limitations:'Linux cloud Chromium and actual QqqGexSession. Synthetic isolated observations; finite stress, not full trading-session/native desktop/live acquisition/alert acceptance. RSS samples are not container peak or leak proof.'};
 writeFileSync('test-results/qqq-session-soak.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(context){const pages=context.pages();if(pages[0]){await pages[0].screenshot({path:'test-results/qqq-session-soak-failure.png'});writeFileSync('test-results/qqq-session-soak-failure.txt',await pages[0].locator('body').innerText());}}throw error;}finally{await context?.close();await browser?.close();if(processHost?.exitCode===null)await shutdown();rmSync(dir,{recursive:true,force:true});}
