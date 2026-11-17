// Explicit live cloud acceptance harness. Not shipped, scheduled, or a production alert monitor.
// Example: MEILI_LIVE=1 node tests/cloud-market-session.mjs --data-dir /tmp/gex-20261117 --start 2026-11-17T14:28:00Z --end 2026-11-17T21:18:00Z
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,readdirSync,readFileSync,writeFileSync,appendFileSync,existsSync,statSync,statfsSync} from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,x,i,a)=>i%2===0?[...pairs,[x,a[i+1]]]:pairs,[]));
assert.equal(process.env.MEILI_LIVE,'1','Explicit MEILI_LIVE=1 required');
const dir=path.resolve(args['--data-dir']??''),start=Date.parse(args['--start']??new Date().toISOString()),end=Date.parse(args['--end']);
assert.ok(args['--data-dir']&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end>Date.now()&&end-start<=9*3600000,'Explicit isolated directory and <=9h future window required');
const host=process.env.QQQ_CLOUD_HOST??path.resolve('../../tests/Meili.Qqq.CloudHost/bin/Debug/net10.0/Meili.Qqq.CloudHost.dll');
mkdirSync(dir,{recursive:true});const marker=path.join(dir,'cloud-acceptance.json');
assert.ok(!readdirSync(dir).length||existsSync(marker),'Refusing non-acceptance/user directory');
writeFileSync(marker,JSON.stringify({kind:'actual-cloud-live-acceptance',start:new Date(start).toISOString(),end:new Date(end).toISOString(),source:'existing routed providers',noSyntheticData:true}));
const events=path.join(dir,'observations.jsonl'),samples=[],errors=[];let stopping=false,child,server,browser,context,page,base,enabled=false,exitCode=0;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill('SIGTERM');});
const sleep=async ms=>{const until=Date.now()+ms;while(!stopping&&Date.now()<until)await new Promise(r=>setTimeout(r,Math.min(1000,until-Date.now())));};
function log(value){appendFileSync(events,JSON.stringify({observedAt:new Date().toISOString(),...value})+'\n');}
function bytes(folder){return readdirSync(folder,{withFileTypes:true}).reduce((sum,e)=>{const p=path.join(folder,e.name);return sum+(e.isDirectory()?bytes(p):e.isFile()?statSync(p).size:0);},0);}
async function capture(){
 return await new Promise((resolve,reject)=>{let output='',error='';child=spawn('dotnet',[host,'--capture-once',dir],{env:process.env,stdio:['ignore','pipe','pipe']});const active=child;
 const timer=setTimeout(()=>active.kill('SIGKILL'),200000);
 active.stdout.on('data',b=>{output+=b;if(output.length>2*1024*1024)active.kill('SIGKILL');});active.stderr.on('data',b=>error=(error+b).slice(-4096));
 active.once('error',e=>{clearTimeout(timer);reject(e);});active.once('exit',code=>{clearTimeout(timer);child=null;code===0?resolve(output.trim().split('\n').map(line=>JSON.parse(line))):reject(Error('Capture exit '+code+': '+error));});
 });
}
async function openViewer(){
 server=spawn('dotnet',[host,'--serve',path.join(dir,'cache/qqq-gex.db')],{stdio:['pipe','pipe','ignore']});const lines=createInterface({input:server.stdout});
 const uri=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Viewer startup timeout')),30000);lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line).pageUri);});server.once('exit',()=>{clearTimeout(timer);reject(Error('Viewer exited'));});});
 base=new URL('.',uri);browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['notifications']});
 await context.addInitScript(()=>{
  window.__gexAcceptance={tones:[],notifications:[]};
  if(window.AudioContext)window.AudioContext=new Proxy(window.AudioContext,{construct(Target,args){const ctx=new Target(...args),create=ctx.createOscillator.bind(ctx);ctx.createOscillator=()=>{const osc=create(),start=osc.start.bind(osc);osc.start=(...args)=>{window.__gexAcceptance.tones.push({at:Date.now(),state:ctx.state});return start(...args);};return osc;};return ctx;}});
  if(window.Notification)window.Notification=new Proxy(window.Notification,{construct(Target,args){const notification=new Target(...args);window.__gexAcceptance.notifications.push({at:Date.now(),title:args[0]});return notification;}});
 });
 page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(uri);// The date-selected historical workspace is now the only UI; decision evaluation is read separately through the canonical local API.

}
try{
 while(!stopping&&Date.now()<start){log({stage:'waiting',secondsUntilStart:Math.ceil((start-Date.now())/1000)});await sleep(Math.min(60000,start-Date.now()));}
 while(!stopping&&Date.now()<end){
  const began=Date.now(),size=bytes(dir),disk=statfsSync(dir);if(size>512*1024*1024||disk.bavail*disk.bsize<256*1024*1024)throw Error('Storage bound/reserve reached; unique history preserved, collection stopped');
  const stages=await capture();log({stage:'capture-publish',stages,directoryBytes:size});
  if(!page)await openViewer();
  let toggleTone=null;
  const toggle=page.getByRole('button',{name:'开启声音提醒',exact:true});
  if(!enabled&&await toggle.count()){await toggle.click();enabled=true;toggleTone=Date.now();log({stage:'alerts-enabled',toggleTone:'manual enable sound is not market-event delivery'});}
  const response=await context.request.get(new URL('api/analysis/qqq/pcs/local-decision',base).href);
  const decision=response.ok()?await response.json():{unavailable:true,httpStatus:response.status()};await response.dispose();
  const notifications=await page.evaluate(()=>window.__gexAcceptance);
  const db=new DatabaseSync(path.join(dir,'cache/qqq-gex.db'),{readOnly:true});let canonical=[],integrity;
  try{integrity=db.prepare('PRAGMA quick_check').get();if(db.prepare("SELECT name FROM sqlite_master WHERE name='qqq_gex_live_signals'").get())canonical=db.prepare('SELECT signal_id,day,anchor_at FROM qqq_gex_live_signals ORDER BY anchor_at').all();}finally{db.close();}
  const sample={stage:'observation',capture:stages.find(x=>x.stage==='capture')?.data,publish:stages.find(x=>x.stage==='publish')?.data,decision,canonical,notifications,toggleTone,integrity,errors:[...errors]};samples.push(sample);log(sample);
  await page.screenshot({path:path.join(dir,'latest.png')});await sleep(Math.min(Math.max(0,120000-(Date.now()-began)),end-Date.now()));
 }
}catch(e){exitCode=1;log({stage:'failed',error:String(e)});console.error(e);}
finally{
 await context?.close();await browser?.close();if(server&&server.exitCode===null){server.stdin.end('\n');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},10000);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
 const cutoffs=[...new Set(samples.flatMap(s=>s.capture?.asOf?[s.capture.asOf]:[]))];
 const report={start:new Date(start).toISOString(),end:new Date(end).toISOString(),finishedAt:new Date().toISOString(),interrupted:stopping,exitCode,samples:samples.length,distinctPublicationCutoffs:cutoffs,sourceQualityComplete:samples.length>0&&samples.every(s=>s.capture?.providerCoverageComplete===true),errors,fullSessionCertified:false,notificationDeliveryCertified:false,limitations:'Inspect actual source-time coverage, missing IV, all observation gaps and canonical signal/notification timestamps. Enabling sound is a test tone. Browser constructor/oscillator calls do not prove audible sound or native OS delivery. No qualifying event may occur; never synthesize one. Finite cloud process depends on runner lifetime; no automatic scheduling or deployment.'};
 writeFileSync(path.join(dir,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
process.exitCode=exitCode;
