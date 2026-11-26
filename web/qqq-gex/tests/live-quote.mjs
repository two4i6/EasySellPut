import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';

// Loopback fixture only: tests the private rendered channel, not a public market connection.
const root=path.resolve(new URL('../dist/',import.meta.url).pathname);
const evidence=path.resolve(new URL('../test-results/',import.meta.url).pathname);
let streamState="active";let revision=1,price=501,at=new Date().toISOString(),quoteRequests=0,analysisRequests=0,prefsRevision=0;
const preferences={'qqq-local:mode':'latest'};
let storage=null,partial=null;
const palette={dark:true,reducedMotion:true,background:'#262624',control:'#30302E',text:'#FAF9F6',muted:'#B8B7B4',border:'#41413E',accent:'#D97757',up:'#70A580',down:'#D16C65'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=createServer(async(req,res)=>{
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/session/presentation')return json(palette);
 if(req.url==='/session/preferences'){
  if(req.method==='POST'){let body='';for await(const part of req)body+=part;Object.assign(preferences,JSON.parse(body).changes);prefsRevision++;}
  return json({revision:String(prefsRevision),values:preferences});
 }
 if(req.url.startsWith('/session/quotes?')){
  quoteRequests++;const after=Number(new URL(req.url,'http://local').searchParams.get('after'));
  for(let i=0;i<20&&revision===after&&!res.destroyed;i++)await pause(50);
  if(!res.destroyed)json({revision,quote:{Symbol:'QQQ',Price:price,Source:'yahoo',Delivery:'websocket',StreamState:streamState,AsOf:at,FetchedAt:at,IsRealtime:false,DelayMinutes:null}});return;
 }
 if(req.url.startsWith('/session/events?')){await pause(200);if(!res.destroyed)json({version:'fixed-history',presentation:palette,quote:null,latestDate:null,storage,partial});return;}
 if(req.url.includes('/api/')){analysisRequests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"code":"LOCAL_CACHE_MISS","offline":true}');return;}
 try{const file=path.join(root,req.url.replace(/^\/session\//,'').split('?')[0]);const body=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html'});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});let navigations=0,websockets=0;
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});page.on('websocket',()=>websockets++);
 await page.goto(`http://127.0.0.1:${server.address().port}/session/index.html`);
 await page.getByRole('button',{name:'数据与存储说明',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'实时观察',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'历史回放',exact:true}).count(),0);
 assert.equal(await page.getByTestId('qqq-live-quote').count(),0);
 assert.equal(await page.evaluate(()=>localStorage.getItem('qqq-local:mode')),'history','A legacy tab preference must not restore the removed realtime workspace');
 await pause(500);const before=analysisRequests;
 // Native quote delivery remains available to other app/MCP consumers, but this historical document must not subscribe or rerun chain-time analysis.
 price=502;revision++;at=new Date().toISOString();await pause(500);
 assert.equal(quoteRequests,0,'The historical workspace must not open the retired latest-only quote channel');
 assert.equal(analysisRequests,before,'Native quote updates must not rerun historical analysis');
 const notice=page.getByTestId('qqq-local-notice');assert.ok((await notice.boundingBox()).height<=36);
 await page.getByRole('button',{name:'数据与存储说明',exact:true}).click();
 await page.getByText('不能视为实时或完整交易日。',{exact:false}).waitFor();
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='数据与存储说明');assert.ok(await page.getByRole('button',{name:'数据与存储说明',exact:true}).evaluate(e=>e===document.activeElement));
 storage={canCapture:true,archiveWarning:true};await notice.filter({hasText:'历史归档超过 1 GiB'}).waitFor();
 await page.getByRole('button',{name:'数据与存储说明',exact:true}).click();await page.getByText('不会自动删除唯一历史。',{exact:false}).waitFor();await page.keyboard.press('Escape');
 storage={canCapture:false,error:'fixture disk fault'};await notice.filter({hasText:'GEX 存储不可用，写入暂停'}).waitFor();
 await page.getByRole('button',{name:'数据与存储说明',exact:true}).click();await page.getByText('保留原文件，请检查存储错误',{exact:false}).waitFor();await page.keyboard.press('Escape');
 storage={canCapture:false};await notice.filter({hasText:'磁盘空间不足，写入暂停'}).waitFor();
 partial={date:'2026-01-02',source:'fixture-provider',regularBars:0,extendedHoursBars:3,issues:['No original price bars'],expiries:[{expiry:'2026-01-05',modelInputComplete:false,sourceTimeAligned:false,strikes:2,netGex:null}]};
 partial.regularBars=[{timestamp:'2026-01-02T14:30:00Z',open:1,high:1,low:1,close:1,volume:1}];partial.extendedHoursBars=null;
 await notice.filter({hasText:'部分采集'}).waitFor();await page.getByRole('button',{name:'数据与存储说明',exact:true}).click();await page.getByText('OI/IV 缺失 · 源时间未核实',{exact:true}).waitFor();await page.getByText('常规价格桶 1 · 盘前盘后桶 未知',{exact:false}).waitFor();await page.getByText('非完整交易日归档',{exact:false}).waitFor();await page.keyboard.press('Escape');
 await mkdir(evidence,{recursive:true});
 for(const width of [1000,1920]){await page.setViewportSize({width,height:800});for(const dark of [true,false]){Object.assign(palette,{dark,background:dark?'#262624':'#FAF9F6',text:dark?'#FAF9F6':'#252524',muted:dark?'#B8B7B4':'#686865',border:dark?'#41413E':'#D9D8D3',control:dark?'#30302E':'#F0EFEB'});await pause(300);assert.ok((await notice.boundingBox()).height<=36);await page.screenshot({path:path.join(evidence,`historical-notice-${width}-${dark?'dark':'light'}.png`)});}}
 await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'historical-workspace-1080p.png'),fullPage:false});
 await page.reload();await page.getByRole('button',{name:'数据与存储说明',exact:true}).waitFor();await pause(300);assert.equal(quoteRequests,0,'Reload must not resurrect the retired quote channel');assert.equal(navigations,2,'Only explicit reload may navigate');
 assert.equal(websockets,0,'The WebView must reuse native quotes, not open a public socket');
 await writeFile(path.join(evidence,'live-quote.json'),JSON.stringify({fixture:true,viewport:[1920,1080],quoteRequests,navigations,websockets,historicalRecalculationOnQuote:false}));
 console.log('PASS: one historical workspace, legacy latest preference normalized, compact keyboard-accessible notices, no retired quote subscription or GEX recalculation; native quote/MCP services remain independently tested');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
